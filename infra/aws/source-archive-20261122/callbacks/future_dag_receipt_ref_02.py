"""Prepare original CPU callbacks; never select, reserve, dispatch or accept results."""
from __future__ import annotations
import ast
import hashlib
import json
import math
import os
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path

HERE = Path("/srv/acephale/workspaces/review/future-dag-callbacks-01")
KIND = "acephale-direct-future-dag-v1"
HARD = 1795413600
SOURCE = "5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
MANIFEST_SHA = "bb1abf775ef97f9dff7299fac09a383887e5e65607a470d6e6954d7fa07d3945"
CONFIG_FIELDS = {"sourceDirectory", "developmentSegmentsReceiptPath",
    "targetSegmentsReceiptPath", "developmentCohortReceipts", "remainingHeldoutMicrodollars"}

class Blocked(ValueError):
    pass

def need(ok, message):
    if not ok:
        raise Blocked(message)

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def file_ref(path):
    p = Path(path)
    return {"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size}

def checked(ref):
    need(isinstance(ref, dict) and isinstance(ref.get("path"), str), "Materialized FileRef required")
    p = Path(ref["path"])
    need(p.is_absolute() and p.is_file(), "Regular absolute FileRef required")
    data = p.read_bytes()
    need(hashlib.sha256(data).hexdigest() == ref.get("sha256"), "FileRef changed: " + str(p))
    need("bytes" not in ref or ref["bytes"] == len(data), "FileRef byte count changed")
    return p

def read_ref(ref):
    return json.loads(checked(ref).read_text())

def same_ref(left, right):
    return (str(Path(left["path"]).resolve()), left["sha256"]) == (str(Path(right["path"]).resolve()), right["sha256"])

def store_identity(ref):
    need(isinstance(ref, dict) and all(isinstance(ref.get(k), str) and ref[k]
        for k in ("bucket", "key", "versionId", "sha256")), "Versioned owner raw index required")
    return tuple(ref[k] for k in ("bucket", "key", "versionId", "sha256"))

def write_once(path, value):
    p = Path(path)
    data = canonical(value)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        with p.open("xb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        need(p.is_file() and not p.is_symlink() and p.read_bytes() == data, "Immutable prepared input collision")
    return file_ref(p)

def load_sources():
    raw = (HERE / "original-sources.json").read_bytes()
    need(hashlib.sha256(raw).hexdigest() == MANIFEST_SHA, "Original callback source manifest changed")
    manifest = json.loads(raw)
    for ref in manifest["files"].values():
        checked(ref)
    return manifest

def original_remaining(report, source_ref):
    text = checked(source_ref).read_text()
    tree = ast.parse(text)
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "remaining_from_report"]
    need(len(nodes) == 1, "Original accounting function absent")
    namespace = {"Decimal": Decimal, "ROUND_CEILING": ROUND_CEILING,
        "ROUND_FLOOR": ROUND_FLOOR, "require": need}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), source_ref["path"], "exec"), namespace)
    return namespace["remaining_from_report"](report, 238_000_000)

def rows_at(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]

def source_rows(sources, seed):
    label = "partitions" + str(seed)
    parts = read_ref(sources["files"][label])
    segment = "development-1" if seed == 29 else "development-2"
    return parts[segment]["blocks"]

def validate_snapshot(cohort, sources):
    seed = cohort["seed"]
    need(type(seed) is int and seed in (29, 17), "Original development seed required")
    report_path = checked(cohort["receipt"])
    report = json.loads(report_path.read_text())
    directory = report_path.parent
    active = read_ref(cohort["activeGenerationManifest"])
    blocks = source_rows(sources, seed)
    expected_indices = [b["blockIndex"] for b in blocks]
    selected = active.get("blocks")
    need(isinstance(selected, list) and [b["blockIndex"] for b in selected] == expected_indices,
        "Owner must explicitly select every original block in order")
    expected = [row for b in blocks for row in b["runs"]]
    receipt_ref = file_ref(directory / "receipt-inputs.json")
    need(same_ref(report["receiptInputs"], receipt_ref), "REPORT receipt-input binding changed")
    receipts = read_ref(receipt_ref)
    provenance_ref = file_ref(directory / "raw-provenance.json")
    provenance = read_ref(provenance_ref)
    outcomes_ref = file_ref(directory / "outcomes.jsonl")
    rows = rows_at(checked(outcomes_ref))
    original_ref = file_ref(directory / "observed-original-run-rows.json")
    need(read_ref(original_ref) == expected, "Original development assignments/order changed")
    need(len(receipts) == len(provenance) == len(blocks), "Not every original block has a closed receipt")
    need([p["blockIndex"] for p in provenance] == expected_indices, "Snapshot block order changed")
    need([p["materializedReceipt"] for p in provenance] == receipts, "Receipt provenance mapping changed")
    actual = []
    members = [cohort["receipt"], cohort["activeGenerationManifest"], receipt_ref,
        provenance_ref, outcomes_ref, original_ref]
    for block, owner, prov, receipt_ref in zip(blocks, selected, provenance, receipts, strict=True):
        need(store_identity(owner["indexRef"]) == store_identity(prov["indexRef"]),
            "Snapshot is not the owner-selected generation")
        receipt_path = checked(receipt_ref)
        receipt = json.loads(receipt_path.read_text())
        need(receipt.get("stage") == "development" and receipt.get("closed") is True
            and receipt.get("allDeclaredSlotsRetained") is True, "Actual closed development receipt required")
        files = receipt["files"]
        names = [m["path"] for m in files]
        need(len(names) == len(set(names)) and
            {"configuration.json", "manifest.json", "summary.json", "outcomes.jsonl"} <= set(names),
            "Closed cohort payload incomplete")
        for member in files:
            p = receipt_path.parent / member["path"]
            need(p.resolve().is_relative_to(receipt_path.parent.resolve()), "Cohort payload escaped its root")
            r = {"path": str(p), "sha256": member["sha256"]}
            need(not p.is_symlink(), "Closed cohort payload symlink")
            checked(r)
            members.append(r)
        config = json.loads((receipt_path.parent / "configuration.json").read_text())
        declared = config["runs"]
        need(len(declared) == len(block["runs"]) and all(
            all(row.get(k) == v for k, v in original.items())
            for row, original in zip(declared, block["runs"], strict=True)),
            "Closed cohort changed original assignments")
        raw_rows = rows_at(receipt_path.parent / "outcomes.jsonl")
        need([r["runId"] for r in raw_rows] == block["runIds"], "Closed cohort original IDs/order changed")
        actual.extend(raw_rows)
        members.append(receipt_ref)
    need(rows == actual and [r["runId"] for r in rows] == [r["runId"] for r in expected],
        "Snapshot placeholders or altered outcome rows are not closed cohort evidence")
    need(len({r["runId"] for r in rows}) == len(rows), "Duplicate original development run")
    return {"seed": seed, "directory": str(directory), "receipts": receipts,
        "expected": expected, "rows": rows, "members": members,
        "sourceSnapshot": {"report": cohort["receipt"], "receiptInputs": file_ref(directory / "receipt-inputs.json"),
            "rawProvenance": provenance_ref, "rawOutcomes": outcomes_ref,
            "historicalRecordsNeverDeleted": True}}

def validate_combined(ref, cohorts):
    value = read_ref(ref)
    need(value["kind"] == "execution-unvalidated-development36-heldout-inputs-v1",
        "Original combined-input descriptor required")
    receipts = [r for c in cohorts for r in c["receipts"]]
    original = [r for c in cohorts for r in c["expected"]]
    need(value["cohortOrder"] == ["development/1", "development/2"]
        and value["originalUniqueRunCount"] == len(original)
        and value["cohortReceiptCount"] == len(receipts), "Combined original cohort identity changed")
    need(read_ref(value["receiptInputs"]) == receipts and read_ref(value["originalRunRows"]) == original,
        "Combined input differs from explicit owner snapshots")
    need(value["sourceSnapshots"] == [c["sourceSnapshot"] for c in cohorts],
        "Combined snapshot provenance differs")
    need(all(value[k] is False for k in
        ("selectionPerformed", "qualificationAsserted", "acceptedAsserted", "modelCallsPerformed")),
        "Combined input makes unsupported acceptance assertions")
    checked(value["originalCostValidation"])
    return value

def template_inputs(ref, sources):
    value = read_ref(ref)
    need(set(value) == CONFIG_FIELDS, "Original five-field selector configuration required")
    need(value["sourceDirectory"] == sources["scienceSourceDirectory"], "Original science source changed")
    for key, label in (("developmentSegmentsReceiptPath", "developmentSegments"),
                       ("targetSegmentsReceiptPath", "targetSegments")):
        need(str(Path(value[key]).resolve()) == str(checked(sources["files"][label]).resolve()),
            "Original path-only grouped schedule changed")
    return value

def validate_selection(result, prepared, sources):
    selection = read_ref(result["selection"])
    grouped = read_ref(result["segments"])
    schedule = read_ref(result["schedule"])
    target = read_ref(sources["files"]["targetSegments"])
    all_rows = read_ref({"path": target["originalSchedulePath"], "sha256": target["originalScheduleSha256"]})
    ids = [r["runId"] for r in schedule]
    need(len(ids) == len(set(ids)), "Selected IDs repeated")
    families = set(selection["families"])
    wanted = [r for r in all_rows if r["familyId"] in families]
    need(schedule == wanted, "Selection changed original IDs, assignments, family completeness or order")
    omitted = [r["runId"] for r in all_rows if r["familyId"] not in families]
    need(selection["sourceCommit"] == SOURCE and selection["selectedRunIds"] == ids
        and selection["omittedTargetRunIds"] == omitted, "Selected original identity mismatch")
    need(selection["kind"] == "acephale-development-only-heldout-selection-v1"
        and selection["developmentOnly"] is True and selection["heldoutOutcomesRead"] is False
        and selection["unknownCostsUseOriginalReservationCeiling"] is True
        and selection["newTrialIdentitiesGenerated"] is False
        and selection["withinBlockArmOrderChanged"] is False
        and selection["journalRead"] is False and selection["dispatchPerformed"] is False,
        "Original selector contract changed")
    need(selection["inputs"].get(prepared["configuration"]["path"]) == prepared["configuration"]["sha256"],
        "Selection does not bind the prepared original command input")
    need(selection["publicSizingImplementationSha256"] == sources["files"]["publicSizing"]["sha256"],
        "Original sizing source changed")
    input_config = read_ref(prepared["configuration"])
    need(selection["remainingHeldoutMicrodollarsSupplied"] == input_config["remainingHeldoutMicrodollars"],
        "Selected budget snapshot differs")
    parts = []
    for part in target["segments"]:
        runs = [r for r in part["runs"] if r["runId"] in set(ids)]
        if runs:
            parts.append({"number": len(parts) + 1, "predictorTrainingSeed": part["predictorTrainingSeed"], "runs": runs})
    need(grouped["segments"] == parts and grouped["originalRunIds"] == ids
        and grouped["executionRunIds"] == [r["runId"] for p in parts for r in p["runs"]]
        and grouped["declaredRuns"] == len(ids) and grouped["pairedBlocks"] == len(ids) // 3
        and grouped["targetOmittedRunIds"] == omitted and grouped["heldoutSizeFrozenByThisCommand"] is True
        and grouped["dispatchAuthorizedByThisCommand"] is False, "Selected segment receipt changed")
    need(grouped["originalScheduleSha256"] == result["schedule"]["sha256"]
        and Path(grouped["originalSchedulePath"]).resolve() == checked(result["schedule"]).resolve(),
        "Selected schedule FileRef mismatch")
    need(not parts or [p["predictorTrainingSeed"] for p in parts] == [17, 29],
        "Original heldout serving order changed")
    allowance = selection["allowanceMicrodollarsPerRun"]
    need(type(allowance) is int and allowance > 0
        and selection["requiredReservationMicrodollars"] == allowance * len(ids)
        and selection["dispatchEligibleSize"] is bool(ids), "Original cohort reservation amount mismatch")
    descriptors = []
    for part in parts:
        number = part["number"]
        descriptors.append({"unitId": "heldout/" + str(number),
            "predictorTrainingSeed": part["predictorTrainingSeed"],
            "originalRunIds": [r["runId"] for r in part["runs"]],
            "selectedHeldoutSegments": result["segments"], "heldoutSelectionReceipt": result["selection"],
            "selectedSchedule": result["schedule"], "heldoutAllowanceMicrodollarsPerRun": allowance,
            "wholeCohortReservationMicrodollars": selection["requiredReservationMicrodollars"],
            "reserveWholeCohortOnce": number == 1, "reuseFirstSegmentCohortReservation": number == 2,
            "dependencies": (["heldout/selection", "seed17/analysis", "seed17/opportunity"] if number == 1 else
                             ["heldout/1", "heldout/selection", "seed29/analysis", "seed29/opportunity"]),
            "workerDispatchPermittedByHelper": False, "validationStatus": "unvalidated"})
    return {"selection": result["selection"], "segments": result["segments"], "schedule": result["schedule"],
        "originalSelectedRunIds": ids, "omittedOriginalRunIds": omitted,
        "selectedFamilyIds": selection["families"], "materializationInputs": descriptors,
        "legitimateZeroHeldout": not ids, "canonicalAcceptance": False}

def command(operation, argv, timeout, output, sources, preconditions):
    return {"operationId": operation, "argv": argv, "cwd": str(HERE),
        "environment": sources["cpuEnvironment"], "timeoutSeconds": timeout,
        "outputRoot": str(output), "inputPreconditions": preconditions,
        "requiresExistingControllerLockAndExclusiveIntent": True, "automaticRetry": False,
        "workerCommands": False, "ledgerWrites": False, "validationStatus": "unvalidated"}

def prepare_future(controller, config, *, now):
    """Controller owns intent/CAS, process execution, collection and publication."""
    answer = {"state": "blocked", "preparedCpuCommands": [], "selectedArtifacts": None,
              "blockedReasons": [], "canonicalAcceptance": False, "validationStatus": "unvalidated"}
    try:
        need(config.get("kind") == KIND and config.get("validationStatus") == "unvalidated",
            "Explicit direct unvalidated callback configuration required")
        need(type(now) in (int, float) and math.isfinite(now), "Finite controller observation required")
        sources = load_sources()
        entries = config.get("closedCohorts", [])
        need(len(entries) == 2 and {c["seed"] for c in entries} == {29, 17},
            "Both original closed development cohorts required")
        cohorts = [validate_snapshot(next(c for c in entries if c["seed"] == seed), sources) for seed in (29, 17)]
        members = [m for c in cohorts for m in c["members"]]
        identity = digest({"closedCohorts": [next(c for c in entries if c["seed"] == seed) for seed in (29, 17)],
                           "originalSources": sources})
        root = Path(config["workRoot"])
        need(root.is_absolute() and root.resolve().is_relative_to(HERE / "prepared") and not root.is_symlink(),
            "Callback staging must stay in its isolated prepared subtree")
        work = root / identity
        hard = config.get("hardDeadline")
        need(type(hard) in (int, float) and math.isfinite(hard) and hard <= HARD,
            "Finite original user deadline required")
        if not config.get("combinedInput"):
            out = work / "combined"
            need(not out.exists(), "Existing combined output requires explicit owner result adoption")
            need(now + 120 < hard, "Insufficient original deadline for combined CPU callback")
            argv = [sources["files"]["sdkPython"]["path"], sources["files"]["combine"]["path"],
                    "--seed17-snapshot", cohorts[1]["directory"],
                    "--seed29-snapshot", cohorts[0]["directory"], "--output", str(out)]
            answer.update(state="prepare-combined", preparedCpuCommands=[
                command("combine-" + identity, argv, 120, out, sources, members)])
            return answer
        combined = validate_combined(config["combinedInput"], cohorts)
        prepared_path = work / "selector-plan.json"
        if prepared_path.exists():
            prepared = json.loads(prepared_path.read_text())
            need(prepared["cohortIdentity"] == identity, "Prepared selector belongs to another owner lineage")
            for r in prepared["inputPreconditions"]:
                checked(r)
        else:
            need(not config.get("selectionResult"), "Selected outputs need their exact prepared plan")
            template = template_inputs(config["selectorConfiguration"], sources)
            observed = config.get("financialReportObservedAt")
            age = config.get("financialReportMaximumAgeSeconds", 180)
            need(type(age) in (int, float) and 0 < age <= 300, "Bounded financial snapshot age required")
            need(type(observed) in (int, float) and math.isfinite(observed) and 0 <= now - observed <= age,
                "Explicit current financial report snapshot required")
            report = read_ref(config["financialReport"])
            remaining = original_remaining(report, sources["files"]["budgetArithmetic"])
            template["developmentCohortReceipts"] = read_ref(combined["receiptInputs"])
            template["remainingHeldoutMicrodollars"] = remaining
            cfg_ref = write_once(work / "selection-configuration.json", template)
            preconditions = members + [config["combinedInput"], config["selectorConfiguration"],
                config["financialReport"], combined["receiptInputs"], combined["originalRunRows"],
                combined["originalCostValidation"], cfg_ref]
            prepared = {"cohortIdentity": identity, "configuration": cfg_ref,
                "financialReport": config["financialReport"], "financialReportObservedAt": observed,
                "financialReportMaximumAgeSeconds": age, "inputPreconditions": preconditions,
                "selectionSource": sources["files"]["selector"], "outputRoot": str(work / "selected")}
            write_once(prepared_path, prepared)
        if config.get("selectionResult"):
            selected = validate_selection(config["selectionResult"], prepared, sources)
            answer.update(state="zero-heldout" if selected["legitimateZeroHeldout"] else "selected-artifacts",
                          selectedArtifacts=selected)
            return answer
        out = Path(prepared["outputRoot"])
        need(not out.exists(), "Existing selector output requires explicit owner result adoption")
        need(0 <= now - prepared["financialReportObservedAt"] <= prepared["financialReportMaximumAgeSeconds"],
            "Prepared financial snapshot aged before dispatch; owner must resolve existing exclusive intent")
        need(now + 240 < hard, "Insufficient original deadline for selector CPU callback")
        argv = [sources["files"]["analysisPython"]["path"], sources["files"]["selector"]["path"],
            "--configuration", prepared["configuration"]["path"], "--output", str(out)]
        answer.update(state="prepare-selection", preparedCpuCommands=[
            command("select-" + identity, argv, 240, out, sources, prepared["inputPreconditions"])])
        return answer
    except (Blocked, KeyError, TypeError, ValueError, OSError) as exc:
        answer["blockedReasons"] = [str(exc)]
        return answer
