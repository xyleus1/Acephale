"""Original full selected segments, CPU preparation/package only."""
from __future__ import annotations
import argparse
import ast
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
HARD = 1795413600
MANIFEST_SHA = "27072b46188094b72749e36ede7b7a5b36f6d5cf52d660fba8c2bba47b8ee07c"
KIND = "acephale-original-selected-segment-materializer-v1"

class Blocked(ValueError):
    pass

def need(ok, message):
    if not ok: raise Blocked(message)

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def digest(value): return hashlib.sha256(canonical(value)).hexdigest()

def ref(path):
    p = Path(path)
    return {"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size}

def checked(value):
    need(isinstance(value, dict) and isinstance(value.get("path"), str), "Materialized source FileRef required")
    p = Path(value["path"])
    need(p.is_absolute() and p.is_file(), "Absolute source file required")
    data = p.read_bytes()
    need(hashlib.sha256(data).hexdigest() == value.get("sha256"), "Source changed: " + str(p))
    need("bytes" not in value or value["bytes"] == len(data), "Source size changed")
    return p

def read(value): return json.loads(checked(value).read_text())

def save(path, value):
    p = Path(path); data = canonical(value); p.parent.mkdir(parents=True, exist_ok=True)
    try:
        with p.open("xb") as f: f.write(data); f.flush(); os.fsync(f.fileno())
    except FileExistsError:
        need(not p.is_symlink() and p.read_bytes() == data, "Immutable preparation collision")
    return ref(p)

def sources():
    raw = (HERE / "original-sources.json").read_bytes()
    need(hashlib.sha256(raw).hexdigest() == MANIFEST_SHA, "Materializer source manifest changed")
    value = json.loads(raw)
    for item in value["files"].values(): checked(item)
    return value

def load_future(source):
    spec = importlib.util.spec_from_file_location("source_bound_original_future", checked(source))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def resolve(value, bindings):
    if isinstance(value, dict):
        if set(value) == {"$binding"}:
            need(value["$binding"] in bindings, "Missing original binding " + value["$binding"])
            return copy.deepcopy(bindings[value["$binding"]])
        return {k: resolve(v, bindings) for k, v in value.items()}
    if isinstance(value, list): return [resolve(v, bindings) for v in value]
    return value

def references(value):
    result = []
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and "sha256" in value:
            checked(value); result.append(value)
        else:
            for child in value.values(): result += references(child)
    elif isinstance(value, list):
        for child in value: result += references(child)
    return result

def unique(items):
    result = {}
    for item in items:
        path = str(checked(item))
        need(path not in result or result[path]["sha256"] == item["sha256"], "Conflicting delivery source")
        result[path] = ref(path)
    return list(result.values())

def selected_parts(selected):
    need(isinstance(selected, dict) and selected.get("canonicalAcceptance") is False, "Unvalidated selected artifacts required")
    groups = read(selected["segments"]); selection = read(selected["selection"]); schedule = read(selected["schedule"])
    need(groups["originalRunIds"] == selected["originalSelectedRunIds"] == [r["runId"] for r in schedule],
        "Actual selected identity changed")
    parts = groups["segments"]
    need(not parts or [p["number"] for p in parts] == [1, 2]
        and [p["predictorTrainingSeed"] for p in parts] == [17, 29], "Original two complete serving segments required")
    need([r["runId"] for p in parts for r in p["runs"]] == groups["executionRunIds"],
        "Original serving order changed")
    need(sum(len(p["runs"]) for p in parts) == len(schedule), "Selected segment coverage changed")
    need(type(selection["allowanceMicrodollarsPerRun"]) is int and selection["allowanceMicrodollarsPerRun"] > 0
        and selection["requiredReservationMicrodollars"] == len(schedule) * selection["allowanceMicrodollarsPerRun"]
        and selection["requiredReservationMicrodollars"] <= selection["remainingHeldoutMicrodollarsSupplied"],
        "Original selected allowance and complete reserved amount required")
    return parts, selection

def inspect_host(assignment, part, source):
    spec = read(assignment["hostSpec"])
    native_path = checked(assignment["nativeConfiguration"])
    native = json.loads(native_path.read_text())
    manifest_path = (native_path.parent / native["manifestPath"]).resolve()
    need(manifest_path == checked(spec["actualManifest"]).resolve(), "Actual host manifest linkage changed")
    manifest = read(spec["actualManifest"])
    need(assignment["unitId"] == "heldout/" + str(part["number"]), "Wrong original unit assignment")
    need(re.fullmatch("[A-Za-z0-9_-]{8,128}", assignment["unitAttemptId"]) is not None, "Immutable owner attempt required")
    need(isinstance(assignment.get("targetResourceAttemptId"), str) and assignment["targetResourceAttemptId"],
        "Actual owner resource binding required")
    transport = read(assignment["transportIdentity"])
    need(transport["resourceAttemptId"] == assignment["targetResourceAttemptId"], "Actual transport resource differs")
    need(transport["providerService"] in ("ec2", "sagemaker-notebook", "sagemaker-hyperpod"),
        "Explicit actual provider identity required")
    hard = assignment["hardDeadline"]
    need(type(hard) in (int, float) and math.isfinite(hard) and hard <= HARD
         and hard <= transport["hardDeadline"], "Original actual finite resource deadline required")
    runner = assignment["nativeRunner"]; checked(runner)
    runtime = unique(assignment["runtimeFiles"])
    need(any(r["path"] == runner["path"] and r["sha256"] == runner["sha256"] for r in runtime),
        "Runtime source must be in owner source closure")
    environment = spec["environment"]
    need(environment.get("ACEPHALE_BUDGET_RPC_PARTICIPANT"), "Existing owner RPC participant required")
    need(not any(k.upper() in ("OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN") for k in environment),
        "Credentials must remain in the original child credential path")
    # Actual trained-artifact checks and exact scope equality remain in the original segment core.
    return {"assignment": assignment, "spec": spec, "native": native, "manifest": manifest,
            "transport": transport, "runtime": runtime}

def reservation_request(config, selected, source, cohort):
    preparation = read(cohort["preparation"]); plan = read(cohort["plan"])
    need(preparation["stage"] == plan["stage"] == "heldout", "Actual heldout cohort preparation required")
    need(preparation["preparerSha256"] in (source["files"]["preparer"]["sha256"], source["files"]["originalPreparer"]["sha256"], source["files"]["cohortPreparer"]["sha256"])
        and preparation["dispatchPerformed"] is False and preparation["journalAccessed"] is False,
        "Source-bound original CPU cohort preparation required")
    for member in preparation["inputs"].values(): checked(member)
    need(preparation["inputs"]["heldout-selection"]["sha256"] == selected["selection"]["sha256"]
        and preparation["inputs"]["segmentsReceiptPath"]["sha256"] == selected["segments"]["sha256"],
        "Cohort preparation does not bind actual selection")
    parts, selection = selected_parts(selected)
    need(plan["segments"] == [[r["runId"] for r in p["runs"]] for p in parts], "Whole original segments changed")
    need([r["runId"] for r in plan["originalRuns"]] == selected["originalSelectedRunIds"],
        "Whole selected cohort original order changed")
    need(plan["hosted"]["allocation"] == "heldout"
        and plan["hosted"]["maxCostMicrodollarsPerRun"] == selection["allowanceMicrodollarsPerRun"],
        "Cohort allowance changed")
    return {"kind": "acephale-owner-original-heldout-reservation-request-v1",
        "selection": selected["selection"], "cohortPreparation": cohort["preparation"], "cohortPlan": cohort["plan"],
        "originalRunIds": selected["originalSelectedRunIds"],
        "wholeCohortReservationMicrodollars": selection["requiredReservationMicrodollars"],
        "allocation": "heldout", "ownerMustReserveEntireCohortOnce": True,
        "useOriginalReserveNativeCohortAgainstExistingOwnerLedger": True,
        "controllerMustNotExecuteHistoricalReservationCommand": True,
        "noIndependentLedgerWriter": True, "reservationCreatedByHelper": False}

def validate_reservation(wrapper_ref, request):
    wrapper = read(wrapper_ref)
    need(wrapper["selection"]["sha256"] == request["selection"]["sha256"]
        and wrapper["cohortPlan"]["sha256"] == request["cohortPlan"]["sha256"]
        and wrapper["allocation"] == "heldout"
        and wrapper["originalRunIds"] == request["originalRunIds"]
        and wrapper["requiredReservationMicrodollars"] == request["wholeCohortReservationMicrodollars"],
        "Owner whole-cohort reservation differs from selected original plan")
    checked(wrapper["ownerReceipt"])
    native = read(wrapper["nativeCohortReservation"])
    need(native["kind"] == "acephale-native-cohort-reservation-v1"
        and native["plan"] == read(request["cohortPlan"]), "Genuine original reservation artifact required")
    checked(wrapper["freshLedgerCheckpoint"])
    need(wrapper["ownerBackend"] and wrapper["ownerAttemptId"], "Actual owner backend/attempt required")
    # Original segment CLI verifies all reservation/checkpoint content hashes and ledger identity.
    return wrapper

def cpu_command(operation, argv, out, source, preconditions, timeout=240):
    return {"operationId": operation, "argv": argv, "cwd": source["scienceSourceDirectory"],
        "environment": source["cpuEnvironment"], "timeoutSeconds": timeout, "outputRoot": str(out),
        "inputPreconditions": unique(preconditions), "automaticRetry": False,
        "requiresExistingControllerLockAndExclusiveIntent": True,
        "workerCommands": False, "ledgerWrites": False, "validationStatus": "unvalidated"}

def prepare_heldout_packages(controller, config, selectedArtifacts, ownerCohortReservation=None, *, now):
    result = {"state": "blocked", "preparedCpuCommands": [], "packages": [],
        "ownerReservationRequest": None, "blockedReasons": [], "canonicalAcceptance": False}
    try:
        need(config.get("kind") == KIND, "Exact selected-segment materializer configuration required")
        need(type(now) in (int, float) and math.isfinite(now), "Finite controller observation required")
        source = sources()
        future = load_future(source["files"]["futureCallback"])
        state = future.prepare_future(controller, read(config["futureConfiguration"]), now=now)
        need(state["state"] in ("selected-artifacts", "zero-heldout")
             and state["selectedArtifacts"] == selectedArtifacts, "Actual source-bound original selection required")
        parts, selection = selected_parts(selectedArtifacts)
        if not parts:
            result.update(state="zero-heldout"); return result
        assignments = config.get("assignments", [])
        need(assignments and len({a["unitId"] for a in assignments}) == len(assignments),
            "Explicit nonduplicate owner segment assignments required")
        need(all(a["unitId"] in ("heldout/1", "heldout/2") for a in assignments), "Only original heldout segment units are permitted")
        hosts = [inspect_host(a, next(p for p in parts if a["unitId"] == "heldout/" + str(p["number"])), source)
                 for a in assignments]
        template = read(config["cohortTemplateSpec"])
        checked(template["actualManifest"])
        root = Path(config["workRoot"])
        need(root.is_absolute() and root.resolve().is_relative_to(HERE / "prepared"), "Isolated package workRoot required")
        identity = digest({"selection": selectedArtifacts["selection"], "cohortTemplateSpec": config["cohortTemplateSpec"]})
        work = root / identity
        common = {"scienceSourceDirectory": source["scienceSourceDirectory"],
            "nodeExecutable": source["files"]["node"]["path"], "analysisPython": source["files"]["analysisPython"]["path"],
            "selectedHeldoutSegmentsPath": selectedArtifacts["segments"]["path"],
            "heldoutSelectionReceiptPath": selectedArtifacts["selection"]["path"],
            "heldoutAllowanceMicrodollarsPerRun": selection["allowanceMicrodollarsPerRun"],
            "qualifiedManifestPath": template["actualManifest"]["path"],
            "originalLedgerPath": "/workspace/acephale/shared/budget.jsonl",
            "cohortReservationDirectory": str(work / "owner-reservation")}
        if not config.get("cohortPreparation"):
            job = read(source["files"]["job1"])
            step = next(s["preparer"] for s in job["steps"] if s["id"] == "prepare-entire-original-cohort")
            value = resolve(step["configurationTemplate"], common)
            out = work / "cohort"
            need(not out.exists(), "Existing cohort CPU output needs explicit adoption")
            need(all(now + 240 < h["assignment"]["hardDeadline"] for h in hosts), "Cohort CPU runway expired")
            cfg = save(work / "cohort-configuration.json", value)
            argv = [source["files"]["analysisPython"]["path"], source["files"]["preparer"]["path"],
                    "cohort", "--configuration", cfg["path"], "--output", str(out)]
            result.update(state="prepare-cohort", preparedCpuCommands=[cpu_command("cohort-" + identity,
                argv, out, source, [config["futureConfiguration"], config["cohortTemplateSpec"], cfg]
                + references(selectedArtifacts) + references(template))])
            return result
        cohort = config["cohortPreparation"]
        request = reservation_request(config, selectedArtifacts, source, cohort)
        result["ownerReservationRequest"] = request
        if ownerCohortReservation is None:
            result.update(state="await-owner-reservation"); return result
        reservation = validate_reservation(ownerCohortReservation, request)
        for host in hosts:
            assignment, spec = host["assignment"], host["spec"]
            unit = assignment["unitId"]; number = int(unit.rsplit("/", 1)[1]); part = parts[number - 1]
            job = read(source["files"]["job" + str(number)])
            step = next(s["preparer"] for s in job["steps"] if s["id"] == "prepare-exact-original-segment")
            maximum = step["configurationTemplate"]["maximumNativeSeconds"]
            need(maximum == 5400 and now + maximum + 240 + 300 < assignment["hardDeadline"],
                "Original full segment and export margin exceed actual lease")
            binding = dict(common, heldoutCohortPreparationPath=cohort["preparation"]["path"],
                heldoutCohortReservationPath=reservation["nativeCohortReservation"]["path"],
                qualifiedNativeConfigurationPath=assignment["nativeConfiguration"]["path"],
                freshLedgerCheckpointPath=reservation["freshLedgerCheckpoint"]["path"],
                nativePython=spec["nativePython"], upstreamRoot=spec["upstreamRoot"],
                budgetDirectory=spec["budgetDirectory"], providerDeadline=assignment["hardDeadline"],
                experimentId=assignment["unitAttemptId"])
            for name in ("calibration", "goalReliability", "opportunity"):
                binding["seed" + str(part["predictorTrainingSeed"]) + name[0].upper() + name[1:] + "Path"] = spec[name]["path"]
            value = resolve(step["configurationTemplate"], binding)
            value.update(validationStatus="unvalidated", configurationLoader=source["files"]["loader" + str(part["predictorTrainingSeed"])],
                         nativeRunner=assignment["nativeRunner"], operationalEnvironment=spec["environment"])
            unit_work = work / ("segment-" + str(number)) / assignment["unitAttemptId"]
            output = unit_work / "package"
            if output.exists():
                adopted = config.get("preparedPackages", {}).get(unit)
                need(adopted is not None, "Existing segment package needs explicit owner adoption")
                ready = read(adopted)
                need(ready["unitId"] == unit and ready["unitAttemptId"] == assignment["unitAttemptId"]
                    and ready["selection"]["sha256"] == selectedArtifacts["selection"]["sha256"]
                    and ready["ownerCohortReservation"]["sha256"] == ownerCohortReservation["sha256"],
                    "Existing package owner identity differs")
                result["packages"].append(adopted); continue
            cfg = save(unit_work / "segment-configuration.json", value)
            req = {"kind": "acephale-original-selected-segment-package-request-v1",
                "unitId": unit, "unitAttemptId": assignment["unitAttemptId"],
                "targetResourceAttemptId": assignment["targetResourceAttemptId"],
                "transportIdentity": assignment["transportIdentity"], "hardDeadline": assignment["hardDeadline"],
                "configuration": cfg, "selection": selectedArtifacts["selection"],
                "selectedSegments": selectedArtifacts["segments"], "ownerCohortReservation": ownerCohortReservation,
                "originalRunIds": [r["runId"] for r in part["runs"]], "predictorTrainingSeed": part["predictorTrainingSeed"],
                "hostSpec": assignment["hostSpec"], "nativeRunner": assignment["nativeRunner"],
                "runtimeFiles": host["runtime"], "originalJob": source["files"]["job" + str(number)],
                "source": ref(Path(__file__)), "canonicalAcceptance": False}
            rr = save(unit_work / "package-request.json", req)
            argv = [source["files"]["sdkPython"]["path"], str(Path(__file__).resolve()),
                    "build", "--request", rr["path"], "--sha256", rr["sha256"], "--output", str(output)]
            result["preparedCpuCommands"].append(cpu_command("segment-" + digest(req), argv, output, source,
                [rr, cfg, ownerCohortReservation, config["futureConfiguration"]] + references(spec) +
                references(cohort) + references(reservation) + host["runtime"], timeout=300))
        result["state"] = "prepare-segments" if result["preparedCpuCommands"] else "packages-ready"
        return result
    except (Blocked, KeyError, TypeError, ValueError, OSError, StopIteration) as exc:
        result.update(state="blocked", preparedCpuCommands=[], packages=[], blockedReasons=[str(exc)])
        return result

def derive_launcher(parent_text, request):
    lines = parent_text.splitlines(True)
    changes = []
    for i, line in enumerate(lines):
        if "assert 1 <= block['blockIndex'] <= 5" in line:
            new = " block=plan['blocks'][0];assert block['blockIndex']==" + str(int(request["unitId"][-1])) + " and block['runIds']==" + repr(request["originalRunIds"]) + " and block['maximumSeconds']==5520\n"
            changes.append((line, new)); lines[i] = new
        elif line.lstrip().startswith("assert block['runIds'] == ["):
            new = " assert plan['selectedServingSegment'] is True and plan['selection']==" + repr(request["selection"]) + " and plan['ownerCohortReservation']==" + repr(request["ownerCohortReservation"]) + "\n"
            changes.append((line, new)); lines[i] = new
    text = "".join(lines)
    need(len(changes) == 2, "Exact original launcher identity seam changed")
    for old, new in [("'direct-development-2-20261122-01'", repr(request["unitAttemptId"])),
                     ("'development/2'", repr(request["unitId"]))]:
        need(text.count(old) == 1, "Original launcher owner literal changed")
        text = text.replace(old, new); changes.append((old, new))
    compile(text, "source_bound_selected_segment_launcher.py", "exec")
    return text, [{"old": a, "new": b} for a, b in changes]

def build(request_ref, output):
    source = sources(); req = read(request_ref)
    need(req["kind"] == "acephale-original-selected-segment-package-request-v1"
        and req["source"]["sha256"] == ref(Path(__file__))["sha256"], "Exact package producer binding required")
    config = read(req["configuration"]); spec = read(req["hostSpec"])
    need(config["cohortReservationPath"] == read(req["ownerCohortReservation"])["nativeCohortReservation"]["path"],
        "Actual owner cohort artifact required")
    output = Path(output)
    need(output.is_absolute() and output.resolve().is_relative_to(HERE / "prepared"), "Isolated package output required")
    output.mkdir(parents=True, exist_ok=False)
    prepared = output / "prepared"
    command = [source["files"]["analysisPython"]["path"], source["files"]["preparer"]["path"],
               "segment", "--configuration", req["configuration"]["path"], "--output", str(prepared)]
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "TMPDIR")}
    env.update(source["cpuEnvironment"])
    result = subprocess.run(command, cwd=source["scienceSourceDirectory"], env=env,
                            capture_output=True, text=True, timeout=240)
    (output / "preparation.stdout").write_text(result.stdout); (output / "preparation.stderr").write_text(result.stderr)
    save(output / "CPU-RESULT.json", {"argv": command, "exitCode": result.returncode,
        "workerCommands": False, "ledgerWrites": False})
    need(result.returncode == 0, "Original full-segment preparation failed; retain CPU stderr without automatic retry")
    receipt = json.loads((prepared / "preparation.json").read_text())
    experiment = json.loads((prepared / "experiment.json").read_text())
    need(receipt["runIds"] == req["originalRunIds"] and receipt["segmentNumber"] == int(req["unitId"][-1]),
        "Prepared full segment differs from actual selection")
    need(receipt["originalCohortChecksRetained"] is True and receipt["qualificationAsserted"] is False,
        "Truthful direct-mode preparation required")
    native_command = list(experiment["stages"][0]["command"])
    native_output = str(output / "native-run")
    native_command = [native_output if x == "{output}" else x for x in native_command]
    native_command = list(spec.get("commandPrefix", [])) + native_command
    block = {"blockIndex": receipt["segmentNumber"], "runIds": req["originalRunIds"],
        "command": native_command, "environment": spec["environment"], "maximumSeconds": 5520,
        "cwd": source["scienceSourceDirectory"]}
    plan = {"kind": "acephale-unvalidated-original-serving-segment-plan-v1",
        "selectedServingSegment": True, "unitId": req["unitId"], "unitAttemptId": req["unitAttemptId"],
        "selection": req["selection"], "ownerCohortReservation": req["ownerCohortReservation"],
        "originalRunIds": req["originalRunIds"], "blocks": [block],
        "validationStatus": "unvalidated", "qualificationAsserted": False, "dispatchPerformed": False}
    pr = save(output / "PLAN.json", plan)
    text, derivation = derive_launcher(checked(source["files"]["launcher"]).read_text(), req)
    lp = output / "launch_selected_segment.py"; lp.write_text(text)
    lr = ref(lp); save(output / "launcher-derivation.json", {"parent": source["files"]["launcher"], "derived": lr, "changes": derivation})
    service = "goalspec-heldout-" + req["unitId"][-1] + "-" + digest(req)[:20]
    actual_output = str(output / "owner-result")
    command = ["systemd-run", "--unit=" + service, "--service-type=exec", "--property=Restart=no",
        "--property=KillMode=control-group", "--property=TimeoutStopSec=90", "--property=RuntimeMaxSec=5640",
        "--wait", "--collect", "--", "/usr/bin/env", "-u", "LD_LIBRARY_PATH",
        source["files"]["sdkPython"]["path"], "-B", lr["path"], "--plan", pr["path"],
        "--sha256", pr["sha256"], "--output", actual_output]
    contract = dict(req, kind="acephale-unvalidated-selected-segment-dispatch-contract-v1",
        command=command, plan=pr, launcher=lr, nativeCommand=native_command, service=service,
        cwd="/workspace/acephale", timeoutSeconds=6000, mailboxSequence=None, instanceId=read(req["transportIdentity"])["instanceId"],
        publisherMustBindCurrentImmediateSuccessor=True, requiresOwnerFundingAdmission=True,
        claimMutationPerformed=False, dispatchPerformed=False, validated=False, qualificationAsserted=False,
        wholeCohortReservedByHelper=False, originalSelectedSegmentNotSharded=True,
        dependencies=read(req["originalJob"])["dependencies"],
        ownerRpcParticipant=spec["environment"]["ACEPHALE_BUDGET_RPC_PARTICIPANT"])
    cr = save(output / "CONTRACT.json", contract)
    intent = {"kind": "acephale-selected-segment-claim-intent-v1", "unitId": req["unitId"],
        "unitAttemptId": req["unitAttemptId"], "targetResourceAttemptId": req["targetResourceAttemptId"],
        "selection": req["selection"], "ownerCohortReservation": req["ownerCohortReservation"],
        "originalRunIds": req["originalRunIds"], "plan": pr, "contract": cr, "hardDeadline": req["hardDeadline"],
        "claimMutationPerformed": False, "canonicalAcceptance": False,
        "requiresExistingOwnerUnitResourceCAS": True, "noReplacementOfStartedOriginalTrial": True,
        "dependencies": read(req["originalJob"])["dependencies"], "requiresOwnerFundingAdmission": True}
    ir = save(output / "CLAIM-INTENT.json", intent)
    files = unique(req["runtimeFiles"] + references(req) + references(read(req["ownerCohortReservation"])) +
                   list(experiment["inputs"].values()) + [pr, cr, lr, ir] +
                   [ref(p) for p in prepared.iterdir() if p.is_file()] +
                   [source["files"]["credentials"]])
    for item in files:
        p = checked(item)
        need(p.resolve().is_relative_to(Path("/workspace/acephale")) and not p.is_symlink()
            and not str(p).startswith("/workspace/acephale/shared/") and not p.name.endswith(".lock"),
            "Only immutable source/data payloads may be archived; never the live journal")
    dr = save(output / "DELIVERY.json", files)
    archive = output / "segment.tar.gz"
    with tarfile.open(archive, "x:gz") as tf:
        for item in files + [dr]: tf.add(item["path"], arcname=item["path"].lstrip("/"), recursive=False)
    ready = dict(req, kind="acephale-unvalidated-selected-segment-package-ready-v1",
        plan=pr, contract=cr, claimIntent=ir, delivery=dr, archive=ref(archive), fileCount=len(files),
        preparation=ref(prepared / "preparation.json"), launcher=lr,
        originalSelectedSegmentNotSharded=True, originalCohortChecksRetained=True,
        validated=False, qualificationAsserted=False, claimMutationPerformed=False,
        dispatchPerformed=False, ledgerMutationPerformed=False)
    return save(output / "READY.json", ready)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["build"])
    parser.add_argument("--request", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(build({"path": args.request, "sha256": args.sha256}, args.output)))

if __name__ == "__main__": main()
