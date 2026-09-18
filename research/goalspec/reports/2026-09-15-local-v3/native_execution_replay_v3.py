"""Zero-provider fixed-tape execution replay of the closed official v3 cohort."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
TREE = "39d7c7aaef4241d96fd9c274355862632eb45d6adec9882394fc7f45d6b8e022"
RUNS = ROOT / "research/goalspec/runs"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def record(path):
    path = path.resolve(strict=True)
    name = path.relative_to(ROOT).as_posix()
    data = path.read_bytes()
    return {"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def verify_source(freeze):
    path = freeze / "manifest.json"
    manifest = read(path)
    if manifest["sourceTreeHash"] != TREE or digest(manifest["sources"]) != TREE or record(path)["sha256"] != (freeze / "manifest.sha256").read_text(encoding="ascii").split()[0]:
        raise ValueError("Frozen source manifest mismatch")
    # Bind the full native tree and every imported runtime/core module. Unrelated
    # postrun report/export overlays are outside this executable dependency set.
    prefixes = ("services/goalspec-runtime/", "src/lib/goalspec/", "research/goalspec/.benchmarks/tau3/")
    exact = {"research/goalspec/src/goalspec/adapters/step_gateway.py", "research/goalspec/src/goalspec/adapters/tau_snapshot.py"}
    checked = []
    for name, expected in manifest["sources"].items():
        if name not in exact and not name.startswith(prefixes):
            continue
        actual = record(ROOT / name)
        if any(actual[key] != expected[key] for key in ("sha256", "bytes")):
            raise ValueError(f"Replay execution dependency changed: {name}")
        checked.append(actual)
    inputs = []
    for expected in manifest["inputs"].values():
        actual = record(Path(expected["path"]))
        if any(actual[key] != expected[key] for key in ("sha256", "bytes")):
            raise ValueError("Frozen official input changed")
        inputs.append(actual)
    return {"sourceTreeHash": TREE, "manifest": record(path), "checkedExecutionFiles": checked, "checkedFrozenInputs": inputs,
            "verificationScope": "All captured runtime/core/native modules plus the two Python adapters used here, and every frozen input; unrelated postrun report overlays are not imported"}


def prepare(source, freeze, logs, study_dir):
    study = read(study_dir / "study.json")
    design, summary = read(source / "design.json"), read(source / "summary.json")
    claim, completion = read(study_dir / "confirmation-claim.json"), read(study_dir / "confirmation-complete.json")
    rows = [json.loads(line) for line in (source / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]
    if summary.get("serviceExitCode") != 0 or design["studyStage"] != "confirmation" or design["studyHash"] != study["studyHash"]:
        raise ValueError("Require the closed official confirmation")
    if digest({k: v for k, v in study.items() if k != "studyHash"}) != study["studyHash"]:
        raise ValueError("Study content changed")
    if digest({k: v for k, v in design.items() if k != "designHash"}) != design["designHash"]:
        raise ValueError("Design content changed")
    if Path(claim["outputPath"]).resolve() != source or Path(claim["runtimeFreezeDirectory"]).resolve() != freeze:
        raise ValueError("Stage claim paths changed")
    if record(source / "design.json")["sha256"] != claim["designSha256"] or record(Path(claim["designPath"]))["sha256"] != claim["designSha256"]:
        raise ValueError("Stage design bytes changed")
    if completion["outcomesSha256"] != record(source / "outcomes.jsonl")["sha256"] or completion["summarySha256"] != record(source / "summary.json")["sha256"] or completion["allFailuresRetained"] is not True:
        raise ValueError("Stage completion receipt changed")
    expected = [(f"v3-{digest(study['studyId'])[:10]}-confirmation-{i:04d}-{digest([design['designHash'], trial])[:12]}", trial) for i, trial in enumerate(design["trials"])]
    if len(rows) != 64 or len(rows) != len(expected) or completion["trials"] != len(rows):
        raise ValueError("Declared confirmation denominator changed")
    for row, (run_id, trial) in zip(rows, expected, strict=True):
        if row["runId"] != run_id or any(row[key] != trial[key] for key in ("arm", "domain", "taskId", "trial", "seed")):
            raise ValueError("Official trial identity changed")
    verification = verify_source(freeze)
    if verification["manifest"]["sha256"] != claim["runtimeFreezeManifestSha256"]:
        raise ValueError("Claimed source manifest changed")
    contexts, service_manifest = read(source / "public-contexts.json"), read(source / "service-manifest.json")
    if {x["runId"] for x in service_manifest["runs"]} != {x["runId"] for x in rows} or service_manifest["runtimeVersion"] != "v3":
        raise ValueError("Service manifest ownership differs")
    frames = {}
    # The TS adapter independently validates original canonical event bytes,
    # full chain, genesis, saved service ownership and final service closure.
    for path in logs:
        for line in path.read_text(encoding="utf-8").splitlines():
            saved = json.loads(line)
            wrapper = saved["body"]["event"]
            event = wrapper.get("event", wrapper)
            if event.get("type") == "execution_frame":
                frame = event["frame"]
                key = (wrapper.get("runId"), frame["boundary"])
                if key in frames or key[0] != frame["runId"]:
                    raise ValueError("Repeated or misattributed execution frame")
                frames[key] = frame
    inputs = [source / name for name in ("summary.json", "outcomes.jsonl", "design.json", "public-contexts.json", "service-manifest.json")]
    inputs += [study_dir / name for name in ("study.json", "confirmation-claim.json", "confirmation-complete.json")]
    inputs += [HERE / "native_execution_replay_v3.ts", Path(__file__), *logs]
    artifacts, coverage, runs = {}, [], []
    for row in rows:
        path = source / f"{row['runId']}.json"
        artifact = read(path)
        if artifact.get("record") != row:
            raise ValueError("Native artifact differs from closed outcome")
        inputs.append(path)
        messages = (artifact.get("simulation") or {}).get("messages") or []
        turns = [message for i, message in enumerate(messages) if i and message["role"] == "assistant"]
        reason = "no_recorded_actor_turn" if not turns else "missing_native_final_state_or_task" if not artifact.get("finalDatabase") or not artifact.get("officialTask") else None
        if reason is None and any((row["runId"], i) not in frames for i in range(len(turns))):
            raise ValueError("Saved actor tape has no corresponding execution frame")
        terminal_missing = sum(run == row["runId"] and boundary >= len(turns) for run, boundary in frames)
        coverage.append({"runId": row["runId"], "arm": row["arm"], "domain": row["domain"], "taskId": row["taskId"], "trial": row["trial"],
                         "originalSuccess": row["success"], "originalReward": row["officialReward"], "originalTermination": row["termination"],
                         "unknownProviderCharge": row.get("unknownProviderCharge", False), "replayed": reason is None, "exclusionReason": reason,
                         "recordedActorTurns": len(turns), "unscorableTerminalDecisions": terminal_missing})
        if reason is None:
            runs.append({"runId": row["runId"], "domain": row["domain"], "scope": frames[(row["runId"], 0)]["scope"],
                         "reads": [], "turns": turns})
            artifacts[row["runId"]] = path
    method = {"schemaVersion": "native-execution-replay-v3-admitted-1", "finalSource": verification,
              "sourceInputs": [record(p) for p in dict.fromkeys(inputs)], "serviceManifest": record(source / "service-manifest.json"),
              "sourceLogs": [str(p) for p in logs], "coverage": coverage, "providerCalls": 0,
              "admissionRule": "Only original candidate_prediction.admission === true; fresh policy/scheduler checks may further abstain",
              "timingMeaning": "Fixed actor tape and real native tools; no model latency, artificial delay or claim of live acceleration",
              "availabilityMeaning": "Original numbered boundary is preserved; asynchronous admission does not prove pre-actor availability",
              "privateTaskUse": "Official task retained only in Python for original environment initialization and postrun input parity; no task/evaluator data supplied to Node"}
    return study, rows, artifacts, contexts, runs, method


def run(source, freeze, logs, study_dir, output):
    source, freeze, study_dir, output = [p.resolve() for p in (source, freeze, study_dir, output)]
    logs = [p.resolve() for p in logs]
    if output.exists() or output.parent != RUNS:
        raise ValueError("Use a new direct child of research/goalspec/runs")
    study, rows, artifacts, contexts, runs, method = prepare(source, freeze, logs, study_dir)
    # Disable credential file loading and remote model-price lookups before
    # importing native registry. No model or evaluator is instantiated.
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    os.environ["LOGURU_LEVEL"] = "ERROR"
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    os.environ["TAU2_DATA_DIR"] = str(Path(study["upstreamRoot"]) / "data")
    from tau2.data_model.message import AssistantMessage, ToolCall
    from tau2.data_model.tasks import Task
    from tau2.registry import registry
    from goalspec.adapters.step_gateway import StepBroker, server
    from goalspec.adapters.tau_snapshot import ALLOWED, NativeSnapshotEnvironment

    class CountedEnvironment(NativeSnapshotEnvironment):
        def __init__(self, original):
            super().__init__(original, projection_snapshots=True)
            self.authoritative_calls = self.speculative_calls = self.freshness_checks = 0
            self.speculative_native_calls = 0

        def _clone(self, *args):
            snapshot = super()._clone(*args)
            native_use = snapshot.use_tool
            def counted(tool_name, **kwargs):
                self.speculative_native_calls += 1
                return native_use(tool_name, **kwargs)
            snapshot.use_tool = counted
            return snapshot

        def use_tool(self, tool_name, **kwargs):
            self.authoritative_calls += 1
            return super().use_tool(tool_name, **kwargs)

        def read(self, tool, arguments):
            self.speculative_calls += 1
            return super().read(tool, arguments)

        def refresh(self, lease, tool, arguments):
            self.freshness_checks += 1
            return super().refresh(lease, tool, arguments)

    tasks = {domain: {str(task["id"]): task for task in read(Path(study["upstreamRoot"]) / f"data/tau2/domains/{domain}/tasks.json")} for domain in ("retail", "airline")}
    for config in runs:
        config["reads"] = sorted(ALLOWED[config["domain"]])
        artifact = read(artifacts[config["runId"]])
        original_task = Task.model_validate(tasks[config["domain"]][artifact["record"]["taskId"]])
        if original_task.model_dump(mode="json") != artifact["officialTask"]:
            raise ValueError("Saved official task differs from frozen native task")
        if original_task.initial_state is not None:
            raise ValueError("This report adapter requires audited empty initial histories; retain unsupported task as explicit blocker")
    output.mkdir(parents=True, exist_ok=False)
    write(output / "adapter-source.json", [{**record(path), "rawUtf8": path.read_bytes().decode("utf-8")}
          for path in (Path(__file__), HERE / "native_execution_replay_v3.ts")])
    input_path = output / "replay-input.json"
    write(input_path, {"runs": runs, "sourceLogs": method["sourceLogs"]})
    write(output / "replay-method-manifest.json", {**method, "replayInput": record(input_path)})
    broker, reads = StepBroker(), {}
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    env = {key: os.environ[key] for key in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA") if key in os.environ}
    env.update(GOALSPEC_GATEWAY_URL=f"http://127.0.0.1:{gateway.server_port}", GOALSPEC_GATEWAY_TOKEN=token)
    reports = []
    process = None
    with (output / "service.log").open("x", encoding="utf-8") as log:
        try:
            process = subprocess.Popen(["node", "--import", "tsx", str(HERE / "native_execution_replay_v3.ts"), str(input_path), str(output)], cwd=ROOT, env=env, stdout=log, stderr=log)
            def monitor():
                process.wait()
                broker.close()
            threading.Thread(target=monitor, daemon=True).start()
            with (output / "replay-outcomes.jsonl").open("x", encoding="utf-8") as journal:
                for coverage in method["coverage"]:
                    result = {**coverage, "observationParity": None, "stateParity": None, "replayError": None}
                    started = time.perf_counter()
                    environment = None
                    try:
                        if not coverage["replayed"]:
                            continue
                        run_id = coverage["runId"]
                        artifact = read(artifacts[run_id])
                        environment = CountedEnvironment(registry.get_env_constructor(coverage["domain"])(solo_mode=False))
                        environment.set_state(initialization_data=None, initialization_actions=None, message_history=[])
                        reads[run_id] = environment
                        messages = artifact["simulation"]["messages"]
                        observed = {message["id"]: message for message in messages if message["role"] == "tool"}
                        if len(observed) != sum(message["role"] == "tool" for message in messages):
                            raise ValueError("Duplicate native tool response IDs")
                        answered, public_history, unexecuted = set(), [], []
                        boundaries = 0
                        for index, message in enumerate(messages):
                            if index == 0 or message["role"] == "tool":
                                continue
                            if message["role"] == "user":
                                public_history.append(message)
                                continue
                            response = broker.exchange(run_id, {"messages": public_history, "policy": contexts[run_id]["policy"], "tools": contexts[run_id]["tools"]})
                            leases = response.pop("_goalspecPromotions", {})
                            actor = AssistantMessage.model_validate(response)
                            expected_actor = AssistantMessage.model_validate(message)
                            if actor != expected_actor:
                                raise ValueError("Recorded authoritative message changed")
                            environment.stage(actor, leases)
                            public_history.append(message)
                            boundaries += 1
                            for call in actor.tool_calls or []:
                                if call.id not in observed:
                                    unexecuted.append(call.id)
                                    continue
                                actual = environment.get_response(ToolCall.model_validate(call))
                                expected = observed[call.id]
                                if (actual.content, actual.error, actual.id, actual.requestor) != (expected["content"], expected.get("error", False), expected["id"], expected.get("requestor", "assistant")):
                                    raise ValueError(f"Native observation parity failed: {call.id}")
                                answered.add(call.id)
                                public_history.append(actual.model_dump(mode="json"))
                        if answered != set(observed):
                            raise ValueError("Recorded native response lacks a replayed call")
                        result["observationParity"] = True
                        result["stateParity"] = environment.tools.db.model_dump(mode="json") == artifact["finalDatabase"]
                        if not result["stateParity"]:
                            raise ValueError("Native final state parity failed")
                        result.update(nativeCalls=len(answered), replayedBoundaries=boundaries, emittedUnexecutedCallIds=unexecuted)
                    except Exception as error:
                        result["replayError"] = {"type": type(error).__name__, "message": str(error)}
                    finally:
                        if coverage["replayed"]:
                            try:
                                broker.finish(coverage["runId"])
                            except Exception as error:
                                result["closeError"] = {"type": type(error).__name__, "message": str(error)}
                        result["replayLatencyMs"] = (time.perf_counter() - started) * 1000
                        if environment is not None:
                            result.update(authoritativeCalls=environment.authoritative_calls, speculativeCalls=environment.speculative_calls,
                                speculativeNativeCalls=environment.speculative_native_calls,
                                physicalNativeCalls=environment.authoritative_calls + environment.speculative_native_calls,
                                freshnessChecks=environment.freshness_checks, revalidationCalls=0,
                                consumedPromotions=sum(event["status"] == "consumed" for event in environment.promotion_events), promotionEvents=environment.promotion_events)
                        reports.append(result)
                        journal.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
                        journal.flush()
                        os.fsync(journal.fileno())
                        reads.pop(coverage["runId"], None)
                        print(json.dumps({"completed": len(reports), "runId": coverage["runId"], "parity": result["observationParity"] is True and result["stateParity"] is True, "error": result["replayError"]}), flush=True)
        finally:
            broker.close()
            if process is not None:
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=10)
            gateway.shutdown()
            gateway.server_close()
    for item in method["sourceInputs"]:
        if record(ROOT / item["path"]) != item:
            raise ValueError("Replay source changed during execution")
    verify_source(freeze)
    completed = [row for row in reports if row["replayed"]]
    parity = bool(completed) and all(row["observationParity"] is True and row["stateParity"] is True and not row.get("closeError") for row in completed)
    report = {"schemaVersion": method["schemaVersion"], "status": "complete" if len(reports) == len(rows) and process.returncode == 0 else "incomplete",
        "label": "Real native execution replay of originally admitted predictions on a fixed saved actor tape; no new live task score",
        "declaredSourceTrials": len(rows), "replayedRuns": len(completed), "unscorableRuns": len(rows) - len(completed),
        "unscorableTerminalDecisions": sum(row["unscorableTerminalDecisions"] for row in reports),
        "allReplayObservationsAndStatesMatch": parity, "providerCalls": 0, "billedUsd": 0, "originalOutcomesUnchanged": True,
        "sourceTreeHash": TREE, "sourceOutcomeHash": record(source / "outcomes.jsonl")["sha256"], "runs": reports,
        "candidateSourceAudit": read(output / "candidate-source-audit.json") if (output / "candidate-source-audit.json").exists() else None,
        "scheduler": read(output / "scheduler-summary.json") if (output / "scheduler-summary.json").exists() else None,
        "limitations": [method["timingMeaning"], method["availabilityMeaning"], "Saved actor decisions may rely on live evidence whose replay scheduling differs; this checks execution parity, not actor planning or candidate efficacy.", "Original execution errors remain failed native trials even when their available prefixes replay exactly."]}
    write(output / "report.json", report)
    arm_rows = []
    for arm in ("base", "paste", "salesforce", "goalspec"):
        group = [row for row in reports if row["arm"] == arm]
        measured = [row for row in group if row["replayed"]]
        arm_rows.append({"arm": arm, "sourceSlots": len(group), "originalSuccesses": sum(row["originalSuccess"] for row in group),
            "replayedTapes": len(measured), "observationParityPassed": sum(row["observationParity"] is True for row in group),
            "recordedStateParityPassed": sum(row["stateParity"] is True for row in group),
            "unscorableTerminalDecisions": sum(row["unscorableTerminalDecisions"] for row in group),
            **{name: sum(row.get(name, 0) for row in group) for name in ("nativeCalls", "authoritativeCalls", "speculativeCalls", "speculativeNativeCalls", "physicalNativeCalls", "consumedPromotions", "freshnessChecks")},
            "meanReplayMs": sum(row["replayLatencyMs"] for row in measured) / len(measured) if measured else None,
            "replayTimingN": len(measured)})
    with (output / "execution-replay-metrics.csv").open("x", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(arm_rows[0]))
        writer.writeheader()
        writer.writerows(arm_rows)
    text = ["# V3 real native execution replay", "", report["label"] + ".", "",
        f"All {len(rows)} source slots are retained; {len(completed)} available action tapes were replayed. Observation and recorded final-state parity: {parity}. "
        f"There are {report['unscorableTerminalDecisions']} terminal decision frames without an actor response; no action is invented for them. Original outcomes remain unchanged.", "",
        "| Arm | Slots / tapes | Original successes | Observation / recorded-state parity | Authoritative | Speculative physical | Physical total | Exact promotions | Lease checks | Mean replay ms (n) |",
        "|---|---|---|---|---|---|---|---|---|---|"]
    for row in arm_rows:
        elapsed = "unmeasured" if row["meanReplayMs"] is None else f"{row['meanReplayMs']:.3f}"
        text.append(f"| {row['arm']} | {row['sourceSlots']} / {row['replayedTapes']} | {row['originalSuccesses']} | {row['observationParityPassed']} / {row['recordedStateParityPassed']} | {row['authoritativeCalls']} | {row['speculativeNativeCalls']} | {row['physicalNativeCalls']} | {row['consumedPromotions']} | {row['freshnessChecks']} | {elapsed} ({row['replayTimingN']}) |")
    audit = report["candidateSourceAudit"] or {}
    text += ["", f"The source contains {audit.get('candidateEvents')} candidate events: {audit.get('originallyAdmitted')} originally admitted and {audit.get('replayableAdmitted')} submitted as replay inputs. "
        "Original admission is necessary; the fresh scheduler and native authorization guard may reject or invalidate work again. Excluded source candidates and all replay scheduler decisions remain in the audit artifacts.", "",
        "The recorded authoritative action tape executes through the pinned native tool implementation against a fresh native environment. Every returned native observation is compared by content, error, call ID and requestor. "
        "Final native state is compared directly with each original artifact's finalDatabase, including partial execution-error traces. No evaluator, user model or actor model runs. "
        "The eight actual tasks have null initial_state; original task bytes and all dependency hashes were checked.", "",
        "Timing is fixed-tape replay under current local load, including replay transport and drain. It excludes actor/user/provider latency and is neither live trial latency nor evidence of a task-success or speed improvement. "
        "No artificial tool delay is inserted. Candidates are submitted at their original numbered boundary; asynchronous saved admission does not establish availability before the original actor decision. "
        "This replay validates tool reuse/isolation/execution parity; it cannot reproduce model-dependent actor planning or prove that exposed evidence was useful.", "",
        "[Full report](report.json), [all replay slots](replay-outcomes.jsonl), [candidate source audit](candidate-source-audit.json), [scheduler summary](scheduler-summary.json), "
        "[input and source manifest](replay-method-manifest.json), [CSV](execution-replay-metrics.csv), [completion receipt](completion.json).", ""]
    with (output / "execution-replay-summary.md").open("x", encoding="utf-8") as stream:
        stream.write("\n".join(text))
    write(output / "completion.json", {"status": report["status"], "allDeclaredSlotsRetained": len(reports) == len(rows), "parityPassed": parity,
        "providerCalls": 0, "ledgerOpened": False, "sourceInputsUnchanged": True, "nodeExitCode": process.returncode,
        "files": [record(path) for path in sorted(output.iterdir()) if path.is_file()]})
    return {"status": report["status"], "runs": len(completed), "sourceTrials": len(rows), "parity": parity, "providerCalls": 0}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=RUNS / "local-v3-confirmation-20260915")
    parser.add_argument("--freeze", type=Path, default=RUNS / "local-v3-confirmation-source-20260915")
    parser.add_argument("--study", type=Path, default=RUNS / "local-study-v3-20260915")
    parser.add_argument("--logs", type=Path, nargs="+", default=[RUNS / "local-evaluation-20260914/events-2b0cbcda-e863-46d2-9848-39c4018fbd92.jsonl"])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.freeze, args.logs, args.study, args.output)))
