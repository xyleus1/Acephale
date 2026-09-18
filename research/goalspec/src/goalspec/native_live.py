"""Local three-arm driver. Native state/evaluation stay in Python; models stay in Node."""
from __future__ import annotations

import json
import os
import random
import secrets
import subprocess
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from goalspec.fresh_tasks import digest, native_environment, preflight, verify_outcome
from goalspec.live_design import ARMS, freeze_heldout


def build_user_policy(base_policy, *, is_v2):
    if not is_v2:
        return base_policy
    return base_policy + "\n\n" + (
        "Conversation completion clarification for this user simulation: Never emit ###STOP### in a message "
        "that gives confirmation, supplies a new requirement, or answers a prerequisite question. After confirming, "
        "allow the assistant to perform the requested work. Wait until the assistant reports completion of ALL "
        "requested clauses before ending the conversation. If a requested clause remains unresolved, continue "
        "the conversation. You may stop after the assistant explicitly reports inability to help, or when you "
        "explicitly abandon the remaining request. Base this decision only on the conversation and your scenario "
        "instructions; do not assume that agreement or authorization means the work has already been completed."
    )


def exchange_user_message(broker, run_id, messages, policy):
    # Only the user worker receives this policy. Native validation and STOP handling
    # consume the original returned object, without stripping or changing content.
    return broker.exchange(run_id + ":user", {"messages": messages, "policy": policy, "tools": []})


def summarize_costs(outcomes):
    unknown = sum(row.get("unknownProviderCharge", False) or row["billedUsd"] is None for row in outcomes)
    known = round(sum(row.get("knownUsageSubtotalUsd", row["billedUsd"] or 0) for row in outcomes), 6)
    return {"billedUsd": None if unknown else round(sum(row["billedUsd"] for row in outcomes), 6),
            "knownUsageSubtotalUsd": known, "unknownCharges": unknown}


def phase_design(manifest, phase, development=None, seed=20260915):
    tasks = [task for task in manifest["tasks"] if task["split"] == phase]
    if phase == "heldout":
        if not development:
            raise ValueError("Heldout size must be frozen using development outcomes")
        costs = [row["billedUsd"] for row in development if not row["budget_terminated"] and row["billedUsd"] is not None]
        censored = any(row["budget_terminated"] or row["billedUsd"] is None for row in development)
        if not costs:
            raise ValueError("No completed development cost calibration")
        return freeze_heldout(sorted({task["familyId"] for task in tasks}), costs, censored, seed)
    if phase not in {"train", "development"}:
        raise ValueError("Unknown phase")
    rng, trials = random.Random(seed), []
    allowance = 1.25 if phase == "train" else 1.0
    for task in tasks:
        arms = ["base"] if phase == "train" else list(ARMS)
        rng.shuffle(arms)
        trial_seed = rng.randrange(2**31)
        trials.extend({"family": task["familyId"], "variant": task["variant"], "trial": 0, "seed": trial_seed,
                       "arm": arm, "reserved_usd": allowance} for arm in arms)
    return {"label": "custom tau-compatible pilot", "phase": phase, "families": sorted({t["familyId"] for t in tasks}),
            "allowance_usd": allowance, "reserved_usd": round(sum(t["reserved_usd"] for t in trials), 6), "trials": trials}


def _write(path, value):
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write("\n")


def _event_rows(directory):
    for path in directory.glob("events-*.jsonl"):
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                if not line.endswith("\n"):
                    continue  # Another request may be synchronously appending its event.
                event = json.loads(line)["body"]["event"]
                if "event" in event and "runId" in event:
                    event = {**event["event"], "runId": event["runId"]}
                yield event


def telemetry(directory, run_id, managed_work_drained=None):
    events = [event for event in _event_rows(directory) if event.get("runId") == run_id or str(event.get("id", "")).startswith(run_id + ":")]
    model = [event for event in events if event.get("type") in {"model_attempt", "embedding"}]
    unknown = any(event.get("type") in {"model_attempt_failed", "embedding_failed"} for event in events)
    known_subtotal = round(sum(event.get("costMicrodollars", 0) for event in model) / 1_000_000, 6)
    result = {"billedUsd": None if unknown else known_subtotal, "knownUsageSubtotalUsd": known_subtotal,
            "providerCalls": len(model), "unknownProviderCharge": unknown,
            "rejectedCalls": sum(event.get("type") == "rejected" for event in events),
            "cancelledCalls": sum(event.get("type") == "cancellation_confirmed" for event in events)}
    if managed_work_drained is False:
        result.update({"billedUsd": None, "unknownProviderCharge": True,
                       "costCensoringReason": "managed_work_drain_not_acknowledged"})
    return result


def native_run_id(manifest, design, index, trial):
    if manifest.get("generator") == "fresh-native-v2":
        identity = {"studyId": manifest["studyId"], "stage": manifest["studyStage"], "designHash": design["designHash"], "trial": trial}
        return f"v2-{digest(manifest['studyId'])[:10]}-{manifest['studyStage']}-{index:04d}-{digest(identity)[:12]}"
    return f"{design.get('phase', 'heldout')}-{index:04d}-{digest(trial)[:12]}"


def drain_trial(broker, run_id, started, native_seconds, clock=time.perf_counter):
    """Include both managed workers' acknowledged drain without altering native latency."""
    drain_started = clock()
    errors = []
    for worker_id in (run_id, run_id + ":user"):
        try:
            broker.finish(worker_id)
        except Exception as error:
            errors.append({"workerId": worker_id, "exceptionType": type(error).__name__})
    stopped = clock()
    return {"nativeOrchestrationSeconds": native_seconds, "serviceDrainSeconds": stopped - drain_started,
            "totalTrialSeconds": stopped - started, "serviceDrainSucceeded": not errors, "serviceDrainErrors": errors}


def run_phase(manifest_path: Path, output: Path, phase: str, budget_directory: Path, records_path: Path | None = None,
              development_path: Path | None = None, max_steps=40, seed=20260915, concurrency=3,
              frozen_design_path: Path | None = None):
    """Reserve the whole paired design, then execute every slot including failures.

    The inherited provider environment is never inspected or serialized. Node alone
    owns credential use, provider retries, per-trial caps, and the durable $500 ledger.
    """
    from tau2.agent.llm_agent import AGENT_INSTRUCTION
    from tau2.data_model.message import MultiToolMessage, UserMessage
    from tau2.data_model.tasks import Task, UserScenario
    from tau2.orchestrator.orchestrator import Orchestrator
    from tau2.user.user_simulator import UserSimulator

    from goalspec.adapters.step_gateway import StepBroker, server
    from goalspec.adapters.tau_external_agent import ExternalGoalSpecAgent
    from goalspec.adapters.tau_snapshot import NativeSnapshotEnvironment

    class ExternalUser(UserSimulator):
        def __init__(self, instructions, broker, run_id):
            super().__init__(llm="gpt-4.1-mini-2025-04-14", instructions=instructions)
            self.broker, self.run_id = broker, run_id
            self.dispatched_policy = build_user_policy(self.system_prompt, is_v2=is_v2)

        def generate_next_message(self, message, state):
            if isinstance(message, MultiToolMessage):
                state.messages.extend(message.tool_messages)
            elif message.has_content() or message.is_tool_call():
                state.messages.append(message)
            response = exchange_user_message(self.broker, self.run_id,
                [{"role": item.role, "content": item.content or ""} for item in state.flip_roles()], self.dispatched_policy)
            user_message = UserMessage.model_validate(response)
            state.messages.append(user_message)
            return user_message, state

    class CountedEnvironment(NativeSnapshotEnvironment):
        def __init__(self, original):
            super().__init__(original)
            self.authoritative_calls = 0
            self.speculative_calls = 0
            self.refresh_calls = 0

        def use_tool(self, tool_name, **kwargs):
            self.authoritative_calls += 1
            return super().use_tool(tool_name, **kwargs)

        def read(self, tool, arguments):
            self.speculative_calls += 1
            return super().read(tool, arguments)

        def refresh(self, lease, tool, arguments):
            self.refresh_calls += 1
            return super().refresh(lease, tool, arguments)

    if concurrency not in {1, 2, 3}:
        raise ValueError("Local trial concurrency must be 1, 2, or 3")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    supplied_hash = manifest.pop("manifestHash")
    if digest(manifest) != supplied_hash:
        raise ValueError("Task manifest changed after preflight")
    manifest["manifestHash"] = supplied_hash
    development = None
    if development_path:
        development = [json.loads(line) for line in development_path.read_text(encoding="utf-8").splitlines() if line]
    is_v2 = manifest.get("generator") == "fresh-native-v2"
    if is_v2:
        from goalspec.study_v2 import file_hash, load_study, read
        if frozen_design_path is None:
            raise ValueError("V2 phases require a claimed precommitted study design")
        study_directory = frozen_design_path.parent
        study = load_study(study_directory)
        design = read(frozen_design_path)
        claim = read(study_directory / f"{manifest['studyStage']}-claim.json")
        if (design.get("designHash") != digest({k: v for k, v in design.items() if k != "designHash"})
                or design.get("studyHash") != study["studyHash"] or design.get("fixtureManifestHash") != supplied_hash
                or design.get("studyId") != manifest["studyId"] or design.get("studyStage") != manifest["studyStage"]
                or design.get("phase") != phase or max_steps != study["maxSteps"]
                or concurrency != study["localConcurrency"] or design.get("localConcurrency") != concurrency
                or design.get("concurrencyUnit") != "paired block; arms within each block remain sequential" or records_path is None
                or file_hash(records_path) != study["frozenLibrary"]["recordsSha256"]
                or claim["designSha256"] != file_hash(frozen_design_path) or Path(claim["outputPath"]) != output.resolve()):
            raise ValueError("V2 study claim, design, fixture, or execution-limit mismatch")
        dispatch_freeze = None
        if manifest["studyStage"] == "confirmation":
            from goalspec.source_freeze import verify_source
            freeze_directory = Path(claim["runtimeFreezeDirectory"])
            if file_hash(freeze_directory / "manifest.json") != claim["runtimeFreezeManifestSha256"]:
                raise ValueError("Claimed confirmation source-freeze manifest changed")
            dispatch_freeze = verify_source(Path(__file__).resolve().parents[4], freeze_directory)
            if not dispatch_freeze["passed"]:
                raise ValueError("Candidate runtime changed between confirmation claim and dispatch")
        _write(study_directory / f"{manifest['studyStage']}-dispatch.json",
               {"studyId": study["studyId"], "studyStage": manifest["studyStage"], "designSha256": claim["designSha256"],
                "outputPath": str(output.resolve()), "singleUseDispatch": True, "runtimeFreezeVerification": dispatch_freeze})
    else:
        if frozen_design_path is not None:
            raise ValueError("External stage designs apply only to explicitly versioned v2 manifests")
        design = phase_design(manifest, phase, development, seed)
        design["localConcurrency"] = concurrency
        design["concurrencyUnit"] = "paired block; arms within each block remain sequential"
    design_hash = design["designHash"] if is_v2 else digest(design)
    output.mkdir(exist_ok=False, parents=True)
    _write(output / "design.json", design)
    task_index = {(task["familyId"], task["variant"]): task for task in manifest["tasks"]}
    experiment_id = (f"{manifest['generator']}:{manifest['studyId']}:{manifest['studyStage']}:{design_hash[:16]}" if is_v2
                     else f"{manifest['generator']}:{phase}:{digest(design)[:16]}")
    repository_records = [] if records_path is None else json.loads(records_path.read_text(encoding="utf-8"))
    snapshot_ids = {entry["pattern"]["snapshotId"] for entry in repository_records}
    if len(snapshot_ids) > 1:
        raise ValueError("Experience records span incompatible frozen snapshots")
    snapshot_id = next(iter(snapshot_ids), "empty-training")
    broker = StepBroker()
    reads, configured, trials = {}, [], []
    # Independent expected states are checked again before the first paid request.
    for index, trial in enumerate(design["trials"]):
        record = task_index[trial["family"], trial["variant"]]
        if preflight(record) != manifest["checks"][record["taskId"]]:
            raise ValueError("Native fixture/check drift")
        run_id = native_run_id(manifest, design, index, trial)
        environment = CountedEnvironment(native_environment(record))
        reads[run_id] = environment
        configured.append({"runId": run_id, "arm": "neutral" if trial["arm"] == "neutral_memory_prefetch" else trial["arm"],
                           "domain": record["domain"], "allocation": "training" if phase == "train" else phase,
                           "maxCostMicrodollars": round(trial["reserved_usd"] * 1_000_000), "maxBoundaries": max_steps,
                           "tools": [tool.openai_schema for tool in environment.get_tools()]})
        trials.append((run_id, trial, record, environment))
    service_manifest = {"schemaVersion": 1, "snapshotId": snapshot_id, "heldoutFamilies": design["families"] if phase != "train" else [],
                        "runs": configured, "maxDecisions": max_steps * len(configured) * 2}
    if is_v2:
        service_manifest.update({"studyId": manifest["studyId"], "studyStage": manifest["studyStage"], "studyHash": design["studyHash"], "perRunCloseAcknowledgement": True})
        service_manifest["maxDecisions"] += 2 * len(configured)
    if records_path:
        service_manifest["recordsPath"] = str(records_path.resolve())
    _write(output / "service-manifest.json", service_manifest)
    _write(output / "public-contexts.json", {run_id: {"policy": AGENT_INSTRUCTION + "\n\n" + environment.get_policy(),
                                                     "tools": configured[index]["tools"], "capturedBeforeExecution": True}
                                              for index, (run_id, _, _, environment) in enumerate(trials)})
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    thread.start()
    root = Path(__file__).resolve().parents[4]
    log_path = output / "service.log"
    outcomes = []
    write_lock = threading.Lock()
    ordered_rows, completed_count, next_row = {}, 0, 0
    trial_indexes = {run_id: index for index, (run_id, _, _, _) in enumerate(trials)}
    service_started = time.perf_counter()
    final_service_drain_seconds = None
    with log_path.open("x", encoding="utf-8") as log:
        process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-service.ts", "services/goalspec-runtime/research-bootstrap.ts", str(budget_directory.resolve())], cwd=root,
                                   env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token,
                                        "GOALSPEC_MANIFEST_PATH": str((output / "service-manifest.json").resolve())}, stdout=log, stderr=log)
        def monitor():
            process.wait()
            broker.close()
        threading.Thread(target=monitor, daemon=True).start()
        try:
            with (output / "outcomes.jsonl").open("x", encoding="utf-8") as results:
                def execute_trial(entry):
                    nonlocal completed_count, next_row
                    run_id, trial, record, environment = entry
                    task = Task(id=record["taskId"], user_scenario=UserScenario(instructions=record["userInstructions"]))
                    actor = ExternalGoalSpecAgent(environment.get_tools(), environment.get_policy(), broker, run_id, environment)
                    user = ExternalUser(record["userInstructions"], broker, run_id)
                    orchestrator = Orchestrator(domain=record["domain"], agent=actor, user=user, environment=environment,
                                                task=task, max_steps=max_steps, seed=trial["seed"], timeout=600)
                    started = time.perf_counter()
                    failure = None
                    try:
                        simulation = orchestrator.run()
                        messages = simulation.messages
                        termination = simulation.termination_reason.value
                        simulation_record = simulation.model_dump(mode="json")
                    except Exception as error:
                        failure = "budget_exhausted" if "budget" in str(error).lower() else "execution_error"
                        messages = orchestrator.get_messages()
                        termination = failure
                        simulation_record = {"messages": [message.model_dump(mode="json") for message in messages], "failure": failure, "exceptionType": type(error).__name__}
                    latency = (time.perf_counter() - started) * 1000
                    native_termination = termination
                    drain_timing = drain_trial(broker, run_id, started, latency / 1000) if is_v2 else {}
                    if is_v2 and not drain_timing["serviceDrainSucceeded"]:
                        failure = failure or "service_drain_error"
                        termination = failure
                    check = manifest["checks"][record["taskId"]]
                    verdict = verify_outcome(record, check, environment, messages)
                    budget_terminated = failure == "budget_exhausted"
                    finished = native_termination in {"user_stop", "agent_stop", "user_stop_token", "agent_stop_token"}
                    # Native names are recorded unchanged, with an explicit failure override.
                    if failure or not finished:
                        verdict["success"] = False
                    useful = sum(event["status"] == "consumed" for event in environment.promotion_events)
                    row = {"schemaVersion": "1.0.0", "experimentId": experiment_id, "snapshotId": snapshot_id, "runId": run_id,
                           "family": record["familyId"], "familyId": record["familyId"], "domain": record["domain"], "taskId": record["taskId"],
                           "variant": trial["variant"], "trial": trial["trial"], "seed": trial["seed"], "arm": trial["arm"],
                           "success": verdict["success"], "constraintViolations": verdict["constraintViolations"], "termination": termination,
                           "latencyMs": latency, "budget_terminated": budget_terminated, "reservedUsd": trial["reserved_usd"],
                           "authoritativeCalls": environment.authoritative_calls, "speculativeCalls": environment.speculative_calls,
                           "usefulCalls": useful, "wastedCalls": max(0, environment.speculative_calls - useful),
                           "revalidationCalls": 0, "freshnessChecks": environment.refresh_calls,
                           "label": "custom tau-compatible pilot", "fixtureHash": record["fixtureHash"], "verifierHash": digest(check),
                           "nativeStopObserved": finished, **telemetry(budget_directory, run_id, drain_timing.get("serviceDrainSucceeded")), **drain_timing}
                    if is_v2:
                        row.update({"studyId": manifest["studyId"], "studyStage": manifest["studyStage"], "nativeTermination": native_termination,
                                    "userPolicyHash": digest(user.dispatched_policy)})
                    _write(output / f"{run_id}.json", {"record": row, "simulation": simulation_record, "verdict": verdict,
                                                      "independentCheck": check, "promotionEvents": environment.promotion_events,
                                                      **({"userSimulatorPrompt": {"policy": user.dispatched_policy, "policyHash": digest(user.dispatched_policy),
                                                          "basePolicyHash": digest(user.system_prompt), "protocol": "v2-user-completion-guidance-v1"}} if is_v2 else {}),
                                                      "finalDatabase": environment.tools.db.model_dump(mode="json")})
                    with write_lock:
                        completed_count += 1
                        ordered_rows[trial_indexes[run_id]] = row
                        while next_row in ordered_rows:
                            ordered = ordered_rows.pop(next_row)
                            results.write(json.dumps(ordered, ensure_ascii=False) + "\n")
                            outcomes.append(ordered)
                            next_row += 1
                        results.flush()
                        os.fsync(results.fileno())
                        print(json.dumps({"phase": phase, "completed": completed_count, "total": len(trials), "arm": row["arm"],
                                          "success": row["success"], "cost": row["billedUsd"], "termination": termination}), flush=True)
                blocks = paired_blocks(trials)
                def execute_block(block):
                    for entry in block:
                        execute_trial(entry)
                with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="native-paired-block") as executor:
                    list(executor.map(execute_block, blocks))
        finally:
            final_drain_started = time.perf_counter()
            broker.close()
            # Node observes broker closure, drains speculative jobs, and releases budget ownership.
            try:
                process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=15)
            gateway.shutdown()
            gateway.server_close()
            final_service_drain_seconds = time.perf_counter() - final_drain_started
    summary = {"schemaVersion": 1, "experimentId": experiment_id, "snapshotId": snapshot_id, "phase": phase,
               "label": "custom tau-compatible pilot", "counts": dict(Counter(row["arm"] for row in outcomes)),
               "successes": sum(row["success"] for row in outcomes), **summarize_costs(outcomes), "designHash": design_hash,
               "fixtureManifestHash": manifest["manifestHash"], "serviceExitCode": process.returncode}
    if is_v2:
        summary.update({"studyId": manifest["studyId"], "studyStage": manifest["studyStage"], "studyHash": design["studyHash"],
                        "serviceWallSeconds": time.perf_counter() - service_started, "finalServiceDrainSeconds": final_service_drain_seconds,
                        "trialTiming": {"nativeOrchestrationSeconds": sum(row["nativeOrchestrationSeconds"] for row in outcomes),
                                        "serviceDrainSeconds": sum(row["serviceDrainSeconds"] for row in outcomes),
                                        "totalTrialSeconds": sum(row["totalTrialSeconds"] for row in outcomes),
                                        "drainFailures": sum(not row["serviceDrainSucceeded"] for row in outcomes),
                                        "summedTrialTimesAreNotPhaseWallTime": True}})
    _write(output / "summary.json", summary)
    return summary


def paired_blocks(trials):
    """Preserve every randomized arm ordering while grouping independent blocks."""
    blocks = []
    previous = None
    seen = set()
    for entry in trials:
        trial = entry[1]
        key = trial["family"], trial["variant"], trial["trial"]
        if key != previous:
            if key in seen:
                raise ValueError("A paired block must be contiguous in the frozen design")
            seen.add(key)
            blocks.append([])
            previous = key
        blocks[-1].append(entry)
    return blocks
