"""Continue original native segments through the existing sole AWS owner."""
from pathlib import Path
import hashlib, importlib.util, json, os, subprocess, sys, time

def need(value, message):
    if not value:
        raise ValueError(message)

def ref(path):
    p = Path(path)
    return {"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}

def checked(value):
    p = Path(value["path"])
    need(p.is_absolute() and p.is_file() and not p.is_symlink(), "Absolute regular input required")
    need(ref(p)["sha256"] == value["sha256"], "Changed immutable input: " + str(p))
    return p

def read(value):
    return json.loads(checked(value).read_bytes().decode("utf-8-sig"))

def save(path, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    if p.exists():
        need(p.read_bytes() == data, "Immutable continuation result changed")
    else:
        with p.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    return ref(p)

def module(value, name):
    p = checked(value)
    spec = importlib.util.spec_from_file_location(name, p)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result

def first_segment_claim(queue, plan, stage):
    """Observe the successful atomic original claim; never write the journal."""
    participant = "corrective-" + stage + "-1-20261122-01:segment-1"
    expected = [{"id": "infra-claim-corrective:20261122-01:" + run_id,
                 "allocation": plan["hosted"]["allocation"], "maximum": 0}
                for run_id in plan["segments"][0]]
    for p in Path(queue).glob("*.request.json"):
        try:
            request = json.loads(p.read_bytes())
            if (request.get("participant") != participant or
                    request.get("action") != "ledger.reserveMany" or
                    request.get("args") != [expected]):
                continue
            result_path = p.with_name(p.name.replace(".request.json", ".result.json"))
            if not result_path.exists():
                continue
            result = json.loads(result_path.read_bytes())
            if result.get("ok") is True and result.get("pending") is not True:
                return {"request": ref(p), "result": ref(result_path)}
        except (OSError, ValueError):
            continue
    return None

def prepare_one(config, stage, number, profile, reservation, now):
    unit = stage + "/" + str(number)
    binding_ref = config["bindings"][unit]
    override_ref = config.get("operationOverrides", {}).get(unit)
    if override_ref:
        result = read(override_ref)
        if result.get("kind") == "goalspec-direct-owner-ready-operation-v1":
            owned = read(result["ownerReady"])
            prepared_ref = owned["preparedNative"]
            result = {"operation": override_ref, "configuration": owned["configuration"],
                      "preparedSegment": prepared_ref, "profileReady": owned["profileReady"],
                      "binding": read(prepared_ref)["evidence"]["hostObservationBinding"]}
        same = lambda a, b: (a["path"], a["sha256"]) == (b["path"], b["sha256"])
        prepared = read(result["preparedSegment"])
        op = read(result["operation"])
        need(same(result["profileReady"], profile) and same(result["binding"], binding_ref)
             and prepared["originalSemanticUnit"] == unit and op["unitId"] == "corrective/" + unit
             and same(prepared["evidence"]["profileEvidence"], profile)
             and same(prepared["evidence"]["hostObservationBinding"], binding_ref),
             "Operational continuation must preserve exact unit, profile and host")
        return result
    host = read(binding_ref)
    out = Path(config["operationRoot"]) / (stage + "-" + str(number))
    ready_path = out / "package" / "READY.json"
    if ready_path.exists():
        result = read(ref(ready_path))
        need(result["profileReady"] == profile and result["binding"] == binding_ref,
             "An existing native operation cannot be rebound")
        return result
    error_path = out / "PREPARATION-ERROR.json"
    if error_path.exists():
        return {"state": "retained-preparation-error", "evidence": ref(error_path)}
    out.mkdir(parents=True, exist_ok=True)
    try:
        package = module(config["packager"], "corrective_native_packager")
        existing_preparation = config.get("preparedSegments", {}).get(unit)
        if existing_preparation:
            prepared_path = checked(existing_preparation)
            prepared = read(existing_preparation)
            same = lambda a, b: (a["path"], a["sha256"]) == (b["path"], b["sha256"])
            need(same(prepared["evidence"]["profileEvidence"], profile)
                 and same(prepared["evidence"]["hostObservationBinding"], binding_ref)
                 and prepared["originalSemanticUnit"] == unit,
                 "Completed preparation must bind this exact profile and host")
        else:
            planner_path = checked(config["planner"])
            available = int(host["phaseDeadline"] - now - 900)
            maximum = min(config["maximumNativeSeconds"][stage], available)
            need(maximum >= 600, "Insufficient finite native window including cleanup reserve")
            plan_path = out / "plan" / "READY.json"
            if not plan_path.exists():
                planner_inputs = {
                    "kind": "acephale-corrective-native-bridge-input-v1",
                    "profiles": {str(host["seed"]): profile}, "stage": stage,
                    "actualPreparation": read(reservation["preparation"])["preparation"],
                    "actualReservation": reservation["reservation"],
                    "actualCheckpoint": reservation["checkpoint"],
                    "financialLineage": reservation["financialLineage"],
                    "nativeRuntime": {str(number): {
                        "maximumNativeSeconds": maximum,
                        "hostStatusFile": host["hostStatusFile"],
                        "hostObservationBinding": binding_ref}},
                    "developmentClosure": config.get("developmentClosure")}
                planner_input_ref = save(out / "planner-inputs.json", planner_inputs)
                planner_argv = ["/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/analysis5a/bin/python",
                                "-I", "-B", str(planner_path), "--inputs", planner_input_ref["path"],
                                "--sha256", planner_input_ref["sha256"], "--output", str(out / "plan")]
                with (out / "planner.stdout").open("xb") as stdout, (out / "planner.stderr").open("xb") as stderr:
                    done = subprocess.run(planner_argv, stdout=stdout, stderr=stderr,
                                          timeout=180, check=False)
                need(done.returncode == 0, "Original native planner failed; see planner.stderr")
            plan = read(ref(plan_path))
            operations = [x for x in plan["operations"] if x["originalSemanticUnit"] == unit]
            need(len(operations) == 1, "Exactly one original native segment")
            operation = operations[0]
            argv = operation["argv"]
            prepared_dir = Path(argv[argv.index("--output") + 1])
            prepared_path = prepared_dir / "READY.json"
            if not prepared_path.exists():
                need(not prepared_dir.exists(), "Preserve incomplete CPU preparation; explicit repair required")
                with (out / "prepare.stdout").open("xb") as stdout, (out / "prepare.stderr").open("xb") as stderr:
                    done = subprocess.run(argv, env={**os.environ, **operation["runtimeEnvironment"]},
                                          stdout=stdout, stderr=stderr, timeout=1200, check=False)
                need(done.returncode == 0, "Original segment preparation failed; see prepare.stderr")
        value = {"kind": "acephale-corrective-native-package-input-v1",
                 "binding": binding_ref, "preparedSegment": ref(prepared_path),
                 "profileReady": profile}
        if stage == "heldout":
            value["previousOwner"] = config["previousOwners"][unit]
        package.package(value, str(out / "package"))
        return read(ref(ready_path))
    except Exception as exc:
        evidence = save(error_path, {"unit": unit, "errorType": type(exc).__name__,
                        "error": str(exc), "at": time.time(), "automaticScientificRetry": False})
        return {"state": "retained-preparation-error", "evidence": evidence}

def adopt_closed(controller, operation_ref, collection):
    op = read(operation_ref)
    closed_ref = collection["closedResult"]
    closed = read(closed_ref)
    prepared = read(read(op["ownerReady"])["preparedNative"])
    need(collection["closed"] is True and collection["drained"] is True
         and closed["closed"] is True and closed["drained"] is True,
         "Actual closed and drained original native cohort")
    need(closed["operation"] == operation_ref and closed["unitId"] == op["unitId"]
         and closed["attemptId"] == op["attemptId"]
         and closed["inputSha256"] == op["inputSha256"]
         and closed["orderedRunIds"] == prepared["originalRunIds"],
         "Closure must retain this complete original segment")
    need(not read(closed["originalSummary"]).get("startupFailure"),
         "A global pre-trial startup failure requires operational repair, not completion")
    row = controller.claims.decoded("unit#" + op["unitId"])
    if row.get("currentNativeReady") == closed_ref:
        return
    from boto3.dynamodb.types import TypeSerializer
    serialize = TypeSerializer().serialize
    controller.claims.ddb.update_item(
        TableName=controller.claims.table, Key={"pk": {"S": "unit#" + op["unitId"]}},
        ConditionExpression="attemptId=:a AND inputSha256=:i AND directControllerOperation.operationId=:o AND directControllerOperation.descriptorSha256=:h",
        UpdateExpression="SET directExecutionCompleted=:yes, nativeCohortClosed=:yes, currentNativeReady=:r, nativeRuntimeLogsComplete=:logs, operationalState=:state",
        ExpressionAttributeValues={
            ":a": {"S": op["attemptId"]}, ":i": {"S": op["inputSha256"]},
            ":o": {"S": op["operationId"]}, ":h": {"S": operation_ref["sha256"]},
            ":yes": {"BOOL": True}, ":r": serialize(closed_ref),
            ":logs": {"BOOL": closed["nativeRuntimeLogsComplete"]},
            ":state": {"S": "original-native-closed-and-drained"}})

def development_closure(config):
    parts = []
    for number in (1, 2):
        p = Path(config["operationRoot"]) / ("development-" + str(number)) / "COLLECTION.json"
        if not p.exists():
            return None
        item = read(ref(p))
        if not item.get("closed") or not item.get("drained"):
            return None
        closed = read(item["closedResult"])
        if read(closed["originalSummary"]).get("startupFailure"):
            return None
        need(closed["originalSemanticUnit"] == "development/" + str(number),
             "Original development segment order")
        parts.append((item["closedResult"], closed))
    reservation = read(config["reservations"]["development"])
    plan = read(reservation["plan"])
    need([part[1]["orderedRunIds"] for part in parts] == plan["segments"],
         "Both closed development segments must exactly cover the original36")
    value = {"kind": "acephale-corrective-development-closure-v1",
             "closedSegments": [part[0] for part in parts],
             "reservation": config["reservations"]["development"],
             "observedCount": sum(len(part[1]["orderedRunIds"]) for part in parts),
             "allDeclaredSlotsRetained": True,
             "scientificAcceptanceAsserted": False}
    closure = save(Path(config["operationRoot"]) / "DEVELOPMENT-CLOSED.json", value)
    owners = {}
    for heldout_number, development_number in ((1, 2), (2, 1)):
        closed = parts[development_number - 1][1]
        owners["heldout/" + str(heldout_number)] = {
            "unitId": closed["unitId"], "attemptId": closed["attemptId"],
            "terminal": closed["terminal"]}
    return closure, owners


def continue_private_report(config):
    """Launch finite CPU reporting only after genuine closures; never hold native work."""
    hook = config.get("privateReportContinuation")
    if not hook:
        return []
    results = []
    try:
        callback = module(hook["source"], "corrective_private_report")
        settings = read(hook["configuration"])
        need(settings["operationRoot"] == config["operationRoot"],
             "Private reporting must observe the current native operation root")
        for stage in ("development", "heldout"):
            try:
                descriptor = callback.prepare_dispatch(settings, stage)
                result = {"stage": stage, "state": descriptor["state"]}
                if descriptor.get("launch"):
                    done = subprocess.run(descriptor["launchArgv"], capture_output=True,
                                          text=True, timeout=30, check=False)
                    evidence = save(Path(config["operationRoot"]) / "private-report-dispatch" /
                                    (descriptor["unit"] + ".json"), {
                        "command": descriptor["command"], "unit": descriptor["unit"],
                        "returncode": done.returncode, "stdout": done.stdout, "stderr": done.stderr,
                        "at": time.time(), "nativeExecutionBlocked": False})
                    result.update({"state": "cpu-report-dispatched" if done.returncode == 0
                                   else "retained-cpu-report-launch-error", "evidence": evidence})
                results.append(result)
            except Exception as error:
                results.append({"stage": stage, "state": "retained-private-report-error",
                                "errorType": type(error).__name__, "error": str(error)})
    except Exception as error:
        results.append({"state": "retained-private-report-config-error",
                        "errorType": type(error).__name__, "error": str(error)})
    return results


def close_host_telemetry(config):
    """Collect the existing telemetry proof only after both cohorts on a host finish."""
    ready_ref = config.get("hostTelemetryContinuation")
    if not ready_ref:
        return []
    outputs = []
    try:
        ready = read(ready_ref)
        for source in ready["sources"].values():
            checked(source)
        host_helper = module(ready["entry"], "corrective_host_telemetry")
        closure = module(ready["sources"]["telemetry_closure.py"], "corrective_telemetry_closure")
        for seed, units in ((17, ("development-2", "heldout-1")),
                            (29, ("development-1", "heldout-2"))):
            try:
                refs = []
                for unit in units:
                    path = Path(config["operationRoot"]) / unit / "COLLECTION.json"
                    if not path.exists():
                        break
                    item = read(ref(path))
                    if not item.get("closed") or not item.get("drained"):
                        break
                    closed = read(item["closedResult"])
                    if read(closed["originalSummary"]).get("startupFailure"):
                        break
                    refs.append(item["closedResult"])
                if len(refs) != 2:
                    outputs.append({"seed": seed, "state": "waiting-both-host-cohorts"})
                    continue
                out = Path(config["operationRoot"]) / ("telemetry-seed" + str(seed) + "-receipt02")
                prepared = out / "prepared" / "READY.json"
                if prepared.exists():
                    telemetry_ready = ref(prepared)
                else:
                    need(not out.exists(), "Incomplete telemetry preparation retained for repair")
                    telemetry_ready = host_helper.prepare_host(
                        ready["hostBindings"][str(seed)], refs, str(out))
                dispatched = closure.issue(telemetry_ready)
                result = closure.collect(telemetry_ready)
                outputs.append({"seed": seed, "ready": telemetry_ready,
                                "commandId": dispatched["commandId"], "result": result})
            except Exception as error:
                outputs.append({"seed": seed, "state": "retained-host-telemetry-error",
                                "errorType": type(error).__name__, "error": str(error)})
    except Exception as error:
        outputs.append({"state": "retained-host-telemetry-config-error",
                        "errorType": type(error).__name__, "error": str(error)})
    return outputs


def continue_final_paper(config):
    """Render the final private paper from existing statistics and actual host proofs."""
    hook = config.get("finalPrivatePaperContinuation")
    if not hook:
        return {"state": "not-configured"}
    try:
        callback = module(hook["source"], "corrective_final_private_paper")
        descriptor = callback.prepare(read(hook["configuration"]))
        result = {"state": descriptor["state"]}
        if descriptor.get("launch"):
            done = subprocess.run(descriptor["launchArgv"], capture_output=True,
                                  text=True, timeout=30, check=False)
            evidence = save(Path(config["operationRoot"]) / "private-report-dispatch" /
                            (descriptor["unit"] + ".json"), {
                "unit": descriptor["unit"], "inputs": descriptor["inputs"],
                "source": descriptor["source"], "output": descriptor["output"],
                "returncode": done.returncode, "stdout": done.stdout, "stderr": done.stderr,
                "at": time.time(), "statisticsInvoked": False, "publicPublication": False})
            result.update({"state": "final-private-paper-dispatched" if done.returncode == 0
                           else "retained-final-private-paper-launch-error", "evidence": evidence})
        return result
    except Exception as error:
        return {"state": "retained-final-private-paper-error",
                "errorType": type(error).__name__, "error": str(error)}


def post_export_retirement(config, now):
    """Once ROOT binds completed exports, retire resources instead of reconciling work."""
    hook = config.get("postExportRetirement")
    if not hook or not hook.get("authorization"):
        return None
    try:
        retirement = module(hook["source"], "corrective_post_export_retirement")
        result = retirement.tick(hook["configuration"], hook["authorization"], now=now)
        return {"state": "post-export-retirement", "retirement": result,
                "nativeDispatchDisabled": True, "studyComplete": False,
                "scientificAcceptanceAsserted": False}
    except Exception as error:
        return {"state": "retained-post-export-retirement-error",
                "errorType": type(error).__name__, "error": str(error),
                "nativeDispatchDisabled": True, "studyComplete": False,
                "scientificAcceptanceAsserted": False}


def tick(controller, config, profiles, now=None, allow_dispatch=True):
    now = time.time() if now is None else now
    need(config["hardDeadline"] == 1795413600, "Original finite horizon")
    retirement = post_export_retirement(config, now)
    if retirement is not None:
        return retirement
    config = dict(config)
    ready = {str(x["seed"]): x["ready"] for x in profiles if x["state"] == "profile-ready"}
    owner = module(config["ownerHandler"], "corrective_native_owner")
    outputs = []
    for stage in ("development", "heldout"):
        if stage == "heldout":
            actual = development_closure(config)
            if actual:
                config["developmentClosure"], config["previousOwners"] = actual
        stage_ref = config.get("reservations", {}).get(stage)
        if not stage_ref:
            continue
        if stage == "heldout" and not config.get("developmentClosure"):
            continue
        reservation = read(stage_ref)
        plan = read(reservation["plan"])
        for number, seed in ((1, 29), (2, 17)) if stage == "development" else ((1, 17), (2, 29)):
            unit = stage + "/" + str(number)
            if str(seed) not in ready or unit not in config["bindings"]:
                outputs.append({"unit": unit, "state": "waiting-own-profile"})
                continue
            package_ready = Path(config["operationRoot"]) / (stage + "-" + str(number)) / "package" / "READY.json"
            if not allow_dispatch and not package_ready.exists():
                outputs.append({"unit": unit, "state": "controller-stop-dispatch-held"})
                continue
            prior = None
            if number == 2:
                claim_path = Path(config["operationRoot"]) / (stage + "-2") / "PRIOR-SEGMENT-CLAIM.json"
                if claim_path.exists():
                    prior = read(ref(claim_path))
                    checked(prior["request"])
                    checked(prior["result"])
                else:
                    prior = first_segment_claim(config["rpcQueue"], plan, stage)
                    if prior is not None:
                        save(claim_path, prior)
            if number == 2 and prior is None:
                outputs.append({"unit": unit, "state": "waiting-original-segment-one-claim"})
                continue
            result = prepare_one(config, stage, number, ready[str(seed)], reservation, now)
            if "operation" not in result:
                outputs.append({"unit": unit, **result})
                continue
            dispatched = owner.reconcile_one(controller, config["ownerConfiguration"],
                                             result["operation"], time.time(), allow_dispatch)
            output = {"unit": unit, "operation": result["operation"], "owner": dispatched,
                      "priorSegmentClaim": prior}
            if config.get("collector"):
                try:
                    collector = module(config["collector"], "corrective_native_collector")
                    prepared = read(result["preparedSegment"])
                    descriptor = {"operation": result["operation"], "configuration": result["configuration"],
                                  "preparation": prepared["preparation"], "originalSemanticUnit": unit}
                    descriptor.update(config.get("collectionBindings", {}).get(unit, {}))
                    collection_path = Path(config["operationRoot"]) / (stage + "-" + str(number)) / "COLLECTION.json"
                    if collection_path.exists():
                        collection = read(ref(collection_path))
                    else:
                        collection = collector.collect_native(
                            descriptor, str(Path(config["collectionRoot"]) / (stage + "-" + str(number))),
                            now=time.time())
                        if collection.get("closed") and collection.get("drained"):
                            save(collection_path, collection)
                    output["collection"] = collection
                    if collection.get("closed") and collection.get("drained"):
                        closed = read(collection["closedResult"])
                        if read(closed["originalSummary"]).get("startupFailure"):
                            output["requiresOperationalStartupRepair"] = True
                        else:
                            adopt_closed(controller, result["operation"], collection)
                except Exception as error:
                    output["collection"] = {"state": "retained-collection-error",
                                            "errorType": type(error).__name__, "error": str(error),
                                            "operation": result["operation"],
                                            "scientificAcceptanceAsserted": False}
            outputs.append(output)
    return {"state": "continuing-original-native-segments", "units": outputs,
            "hostTelemetry": close_host_telemetry(config),
            "privateReport": continue_private_report(config),
            "finalPrivatePaper": continue_final_paper(config),
            "studyComplete": False, "scientificAcceptanceAsserted": False,
            "automaticScientificRetry": False}
