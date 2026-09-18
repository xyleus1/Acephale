"""Unchanged upstream tau tasks and evaluators through separately budgeted model ports."""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import threading
import time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from types import FunctionType, MethodType

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.fresh_tasks import digest
from goalspec.native_live import _event_rows, drain_trial, summarize_costs, telemetry
from goalspec.study_v2 import file_hash, read, write
from goalspec.study_v3 import ROOT, load_study


def clone_with_globals(function, replacements):
    """Preserve native bytecode while replacing only its scoped dependency ports."""
    result = FunctionType(function.__code__, {**function.__globals__, **replacements}, function.__name__,
                          function.__defaults__, function.__closure__)
    result.__kwdefaults__ = function.__kwdefaults__
    return result


def api_actor_instruction(native):
    old = "Always make sure you generate valid JSON only."
    if native.count(old) != 1:
        raise ValueError("Upstream actor protocol instruction changed; repeat audit")
    return native.replace(old, "Use the API's function tool calls for actions. For a message turn, write ordinary text for the user, without a JSON envelope.")


def model_port(broker, worker_id, *, evaluator=False):
    def generate(*, model, messages, tools=None, call_name=None, **kwargs):
        from tau2.data_model.message import AssistantMessage
        if tools is not None and tools != []:
            raise ValueError("Official retail/airline user and evaluator must have no tools")
        if not messages or messages[0].role != "system" or any(message.role == "system" for message in messages[1:]):
            raise ValueError("Unexpected native model prompt structure")
        response = broker.exchange(worker_id, {"policy": messages[0].content,
            "messages": [{"role": message.role, "content": message.content or ""} for message in messages[1:]], "tools": []})
        expected = "assistant" if evaluator else "user"
        if response.get("role") != expected or response.get("tool_calls"):
            raise ValueError("Unexpected native model-port response")
        # Costs are owned by the Node ledger; native serialization must not invent them.
        return AssistantMessage(role="assistant", content=response.get("content"), cost=0.0)
    return generate


def native_ports(broker, run_id, task, models):
    """Keep upstream state transitions, prompt text, JSON parser and reward combination."""
    from tau2.evaluator.evaluator import evaluate_simulation
    from tau2.evaluator.evaluator_nl_assertions import NLAssertionsEvaluator
    from tau2.user.user_simulator import UserSimulator

    user = UserSimulator(llm=models["user"], instructions=str(task.user_scenario), tools=None, llm_args={"temperature": 0.0})
    user._generate_next_message = MethodType(clone_with_globals(UserSimulator._generate_next_message,
        {"generate": model_port(broker, run_id + ":user")}), user)
    judge_function = clone_with_globals(NLAssertionsEvaluator.evaluate_nl_assertions.__func__,
        {"generate": model_port(broker, run_id + ":evaluator", evaluator=True), "DEFAULT_LLM_NL_ASSERTIONS": models["teacher"]})
    local_judge = type("BudgetedNativeNLAssertionsEvaluator", (NLAssertionsEvaluator,), {"evaluate_nl_assertions": classmethod(judge_function)})
    evaluate = clone_with_globals(evaluate_simulation, {"NLAssertionsEvaluator": local_judge})
    return user, evaluate


def verify_claim(directory, design_path, output):
    study = load_study(directory)
    design = read(design_path)
    stage = design["studyStage"]
    claim = read(directory / f"{stage}-claim.json")
    if (design["studyHash"] != study["studyHash"] or design["designHash"] != digest({k: v for k, v in design.items() if k != "designHash"})
            or file_hash(design_path) != claim["designSha256"] or Path(claim["outputPath"]) != output.resolve()):
        raise ValueError("Official stage claim or design changed")
    if file_hash(Path(claim["runtimeConfigPath"])) != claim["runtimeConfigSha256"]:
        raise ValueError("Claimed session configuration changed")
    from goalspec.source_freeze_v3 import verify_stage_freeze
    frozen = Path(claim["runtimeFreezeDirectory"])
    if file_hash(frozen / "manifest.json") != claim["runtimeFreezeManifestSha256"]:
        raise ValueError("Stage freeze changed")
    verification = verify_stage_freeze(ROOT, frozen, directory, stage, read(Path(claim["runtimeConfigPath"])))
    write(directory / f"{stage}-dispatch.json", {"studyId": study["studyId"], "stage": stage,
        "designSha256": claim["designSha256"], "outputPath": str(output.resolve()), "singleUseDispatch": True,
        "runtimeFreezeVerification": verification})
    return study, design, read(Path(claim["runtimeConfigPath"]))


def service_manifest_hash(path):
    """Use the runtime's actual number/string canonicalization, before service timing."""
    script = "const fs=require('node:fs'); const {hash}=require('./src/lib/goalspec/canonical.ts'); process.stdout.write(hash(JSON.parse(fs.readFileSync(process.argv[1],'utf8'))));"
    result = subprocess.check_output(["node", "--import", "tsx", "-e", script, str(path.resolve())], cwd=ROOT, text=True).strip()
    if len(result) != 64 or any(char not in "0123456789abcdef" for char in result):
        raise ValueError("Invalid canonical service-manifest hash")
    return result


def evaluator_usage(directory, run_id):
    events = [event for event in _event_rows(directory) if event.get("runId") == run_id and ":evaluator" in str(event.get("id", ""))]
    priced = [event for event in events if event.get("type") == "model_attempt"]
    return {"knownEvaluatorUsageUsd": sum(event.get("costMicrodollars", 0) for event in priced) / 1_000_000,
            "evaluatorProviderResponses": len(priced), "unknownEvaluatorCharge": any(event.get("type") == "model_attempt_failed" for event in events)}


def declared_trials(study, design):
    return [(f"v3-{digest(study['studyId'])[:10]}-{design['studyStage']}-{i:04d}-{digest([design['designHash'], trial])[:12]}", trial)
            for i, trial in enumerate(design["trials"])]


def retain_stage_failure(directory, design_path, output, budget_directory, error):
    """Preserve finished rows and account for every unexecuted slot after local abort."""
    study, design = read(directory / "study.json"), read(design_path)
    output.mkdir(parents=True, exist_ok=True)
    if not (output / "design.json").exists():
        write(output / "design.json", design)
    outcomes_path = output / "outcomes.jsonl"
    rows = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line] if outcomes_path.exists() else []
    expected = declared_trials(study, design)
    completed = {row["runId"] for row in rows}
    if len(completed) != len(rows) or not completed <= {run_id for run_id, _ in expected}:
        raise ValueError("Cannot append failure rows to unrelated or duplicate outcomes")
    with outcomes_path.open("a", encoding="utf-8") as results:
        for run_id, trial in expected:
            if run_id in completed:
                continue
            row = {"schemaVersion": "1.0.0", "runId": run_id, "studyId": study["studyId"], "studyStage": design["studyStage"],
                "family": trial["family"], "familyId": trial["family"], "domain": trial["domain"], "taskId": trial["taskId"],
                "variant": trial["variant"], "trial": trial["trial"], "seed": trial["seed"], "arm": trial["arm"],
                "reservedUsd": trial["reserved_usd"], "label": study["label"], "upstreamRevision": study["upstreamRevision"],
                "success": False, "officialReward": None, "termination": "stage_abort", "exceptionType": type(error).__name__,
                "budget_terminated": False, "constraintViolations": None, "constraintStatus": "not_measured",
                "latencyMs": None, "nativeOrchestrationSeconds": None, "serviceDrainSeconds": None, "totalTrialSeconds": None,
                "evaluationSeconds": None, "serviceDrainSucceeded": False, "serviceReadyBeforeTrial": False,
                **telemetry(budget_directory, run_id, False)}
            write(output / f"{run_id}-stage-abort.json", {"record": row, "retainedStageFailure": True, "notRetried": True})
            results.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            results.flush()
            os.fsync(results.fileno())
            rows.append(row)
    summary = {"schemaVersion": 1, "studyId": study["studyId"], "studyStage": design["studyStage"], "studyHash": study["studyHash"],
        "designHash": design["designHash"], "label": study["label"], "counts": dict(Counter(row["arm"] for row in rows)),
        "successes": sum(row["success"] for row in rows), **summarize_costs(rows), "stageAborted": True,
        "exceptionType": type(error).__name__, "allDeclaredSlotsRetained": True, "notRetried": True}
    if not (output / "summary.json").exists():
        write(output / "summary.json", summary)
    write(output / "stage-abort.json", summary)
    return summary


@contextmanager
def retain_slot_failure(row, artifact, broker, budget_directory):
    """A setup failure consumes its declared slot and does not skip later tasks."""
    try:
        yield
    except Exception as error:
        failures = []
        for worker in (row["runId"], row["runId"] + ":user", row["runId"] + ":evaluator"):
            try:
                broker.finish(worker)
            except Exception as close_error:
                failures.append({"workerId": worker, "exceptionType": type(close_error).__name__})
        row.update({"success": False, "termination": "slot_setup_or_telemetry_error", "exceptionType": type(error).__name__,
                    "serviceDrainSucceeded": not failures, "serviceDrainErrors": failures,
                    **telemetry(budget_directory, row["runId"], not failures)})
        for field in ("latencyMs", "nativeOrchestrationSeconds", "serviceDrainSeconds", "totalTrialSeconds", "evaluationSeconds"):
            row.setdefault(field, None)
        artifact["retainedSlotFailure"] = {"exceptionType": type(error).__name__, "remainingDeclaredSlotsContinue": True}


def run_stage(directory, design_path, output, budget_directory):
    """Run each declared official task once per arm/seed after service readiness."""
    study, design, configuration = verify_claim(directory, design_path, output)
    # Upstream imports must never load a credential file or fetch a model-cost map.
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    os.environ["LOGURU_LEVEL"] = "ERROR"
    os.environ["TAU2_DATA_DIR"] = str(Path(study["upstreamRoot"]) / "data")
    from tau2.agent.llm_agent import AGENT_INSTRUCTION
    from tau2.data_model.tasks import Task
    from tau2.evaluator.evaluator import EvaluationType
    from tau2.orchestrator.orchestrator import Orchestrator
    from tau2.registry import registry

    from goalspec.adapters.tau_external_agent import ExternalGoalSpecAgent
    from goalspec.adapters.tau_snapshot import ALLOWED, NativeSnapshotEnvironment

    class CountedEnvironment(NativeSnapshotEnvironment):
        def __init__(self, original):
            super().__init__(original, projection_snapshots=True)
            self.authoritative_calls = self.speculative_calls = self.refresh_calls = 0
            self.native_timings = []

        def use_tool(self, tool_name, **kwargs):
            self.authoritative_calls += 1
            started = time.perf_counter()
            try:
                return super().use_tool(tool_name, **kwargs)
            finally:
                self.native_timings.append({"operation": "authoritative_tool", "tool": tool_name,
                    "isRead": tool_name in ALLOWED[self.domain_name], "durationMs": (time.perf_counter() - started) * 1000})

        def _clone(self, *args):
            snapshot = super()._clone(*args)
            original_use = snapshot.use_tool
            def timed_use(tool_name, **kwargs):
                started = time.perf_counter()
                try:
                    return original_use(tool_name, **kwargs)
                finally:
                    self.native_timings.append({"operation": "speculative_native_tool", "tool": tool_name,
                        "isRead": True, "durationMs": (time.perf_counter() - started) * 1000})
            snapshot.use_tool = timed_use
            return snapshot

        def read(self, tool, arguments):
            self.speculative_calls += 1
            started = time.perf_counter()
            try:
                return super().read(tool, arguments)
            finally:
                self.native_timings.append({"operation": "speculative_snapshot_wrapper", "tool": tool,
                    "isRead": True, "durationMs": (time.perf_counter() - started) * 1000})

        def refresh(self, lease, tool, arguments):
            self.refresh_calls += 1
            return super().refresh(lease, tool, arguments)

    output.mkdir(parents=True, exist_ok=False)
    write(output / "design.json", design)
    instruction = api_actor_instruction(AGENT_INSTRUCTION)
    task_sets, templates = {}, {}
    for domain in ("retail", "airline"):
        tasks = read(Path(study["upstreamRoot"]) / f"data/tau2/domains/{domain}/tasks.json")
        task_sets[domain] = {str(task["id"]): task for task in tasks}
        environment = registry.get_env_constructor(domain)(solo_mode=False)
        templates[domain] = {"policy": instruction + "\n\n" + environment.get_policy(),
                             "tools": [tool.openai_schema for tool in environment.get_tools()]}
    records = read(Path(study["frozenLibrary"]["recordsPath"]))
    snapshots = {record["pattern"]["snapshotId"] for record in records}
    if len(snapshots) != 1:
        raise ValueError("Exactly one frozen memory snapshot is required")
    snapshot_id = next(iter(snapshots))
    trials = declared_trials(study, design)
    configured = [{"runId": run_id, "arm": trial["arm"], "domain": trial["domain"], "allocation": design["phase"],
                   "maxCostMicrodollars": round(trial["reserved_usd"] * 1_000_000), "maxBoundaries": study["maxSteps"],
                   "tools": templates[trial["domain"]]["tools"], "evaluator": True} for run_id, trial in trials]
    service_manifest = {"schemaVersion": 1, "snapshotId": snapshot_id, "heldoutFamilies": design["families"],
        "runtimeVersion": "v3", "memoryPath": study["frozenExperienceMemory"]["path"], "sessionConfiguration": configuration,
        "runs": configured, "recordsPath": study["frozenLibrary"]["recordsPath"], "awaitReady": True,
        "studyId": study["studyId"], "studyStage": design["studyStage"], "studyHash": study["studyHash"],
        "perRunCloseAcknowledgement": True, "maxDecisions": (study["maxSteps"] * 2 + 4) * len(trials)}
    write(output / "service-manifest.json", service_manifest)
    write(output / "public-contexts.json", {run_id: {**templates[trial["domain"]], "capturedBeforeExecution": True} for run_id, trial in trials})
    manifest_hash = service_manifest_hash(output / "service-manifest.json")
    broker, reads = StepBroker(expected_manifest_hash=manifest_hash), {}
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    rows, startup_failure, ready_at = [], None, None
    started = time.perf_counter()
    with (output / "service.log").open("x", encoding="utf-8") as log:
        process = None
        try:
            process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-service.ts", "services/goalspec-runtime/research-bootstrap.ts", str(budget_directory.resolve())],
                cwd=ROOT, env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token,
                    "GOALSPEC_MANIFEST_PATH": str((output / "service-manifest.json").resolve())}, stdout=log, stderr=log)
        except Exception as error:
            startup_failure = type(error).__name__
            broker.close()
        def monitor():
            process.wait()
            broker.close()
        if process is not None:
            threading.Thread(target=monitor, daemon=True).start()
        try:
            try:
                if startup_failure is None:
                    ready_at = broker.wait_ready()
            except Exception as error:
                startup_failure = type(error).__name__
            startup_seconds = (ready_at or time.perf_counter()) - started
            write(output / "service-readiness.json", {"ready": ready_at is not None, "serviceStartupSeconds": startup_seconds,
                "manifestHash": manifest_hash, "errorType": startup_failure, "trialClocksStartedAfterReady": ready_at is not None})
            with (output / "outcomes.jsonl").open("x", encoding="utf-8") as results:
                for run_id, trial in trials:
                    row = {"schemaVersion": "1.0.0", "experimentId": f"official-v3:{study['studyId']}:{design['studyStage']}:{design['designHash'][:16]}",
                        "snapshotId": snapshot_id, "runId": run_id, "studyId": study["studyId"], "studyStage": design["studyStage"],
                        "family": trial["family"], "familyId": trial["family"], "domain": trial["domain"], "taskId": trial["taskId"],
                        "variant": 0, "trial": trial["trial"], "seed": trial["seed"], "arm": trial["arm"], "reservedUsd": trial["reserved_usd"],
                        "label": study["label"], "upstreamRevision": study["upstreamRevision"], "success": False, "officialReward": None,
                        "constraintViolations": None, "budget_terminated": False, "serviceReadyBeforeTrial": ready_at is not None}
                    artifact = {"record": row}
                    with retain_slot_failure(row, artifact, broker, budget_directory):
                        if startup_failure:
                            row.update({"termination": "service_startup_error", "latencyMs": None, "nativeOrchestrationSeconds": None,
                                "serviceDrainSeconds": None, "totalTrialSeconds": None, "evaluationSeconds": None,
                                "serviceDrainSucceeded": False, "serviceDrainErrors": [{"exceptionType": startup_failure}],
                                **telemetry(budget_directory, run_id)})
                        else:
                            task = Task.model_validate(task_sets[trial["domain"]][trial["taskId"]])
                            environment = CountedEnvironment(registry.get_env_constructor(trial["domain"])(solo_mode=False))
                            reads[run_id] = environment
                            actor = ExternalGoalSpecAgent(environment.get_tools(), environment.get_policy(), broker, run_id, environment, instruction)
                            user, evaluate = native_ports(broker, run_id, task, study["models"])
                            orchestrator = Orchestrator(domain=trial["domain"], agent=actor, user=user, environment=environment, task=task,
                                max_steps=study["maxSteps"], max_errors=study["maxErrors"], seed=trial["seed"], timeout=study["trialTimeoutSeconds"])
                            trial_started, failure, simulation = time.perf_counter(), None, None
                            try:
                                simulation = orchestrator.run()
                                simulation_record = simulation.model_dump(mode="json")
                                native_termination = simulation.termination_reason.value
                            except Exception as error:
                                failure = "budget_exhausted" if "budget" in str(error).lower() else "execution_error"
                                native_termination = failure
                                simulation_record = {"messages": [m.model_dump(mode="json") for m in orchestrator.get_messages()], "exceptionType": type(error).__name__}
                            native_seconds = time.perf_counter() - trial_started
                            drain = drain_trial(broker, run_id, trial_started, native_seconds)
                            if not drain["serviceDrainSucceeded"]:
                                failure = failure or "service_drain_error"
                            evaluation_started, reward, evaluator_error = time.perf_counter(), None, None
                            try:
                                if simulation is not None:
                                    reward = evaluate(simulation=simulation, task=task, evaluation_type=EvaluationType.ALL,
                                        solo_mode=False, domain=trial["domain"], strict_replay=True)
                            except Exception as error:
                                evaluator_error = type(error).__name__
                                failure = failure or "evaluation_error"
                            finally:
                                try:
                                    broker.finish(run_id + ":evaluator")
                                except Exception as error:
                                    evaluator_error = evaluator_error or type(error).__name__
                                    failure = failure or "evaluator_drain_error"
                            evaluation_seconds = time.perf_counter() - evaluation_started
                            messages = orchestrator.get_messages()
                            answered = [m for m in messages if m.role == "tool"]
                            useful = sum(event["status"] == "consumed" for event in environment.promotion_events)
                            reward_data = reward.model_dump(mode="json") if reward is not None else None
                            assertion_checks = [] if reward is None else (reward.nl_assertions or [])
                            expected_assertions = task.evaluation_criteria.nl_assertions or [] if task.evaluation_criteria else []
                            row.update({"success": bool(reward is not None and reward.reward == 1 and failure is None),
                                "officialReward": reward.reward if reward is not None else None, "termination": failure or native_termination,
                                "nativeTermination": native_termination, "latencyMs": native_seconds * 1000, **drain,
                                "evaluationSeconds": evaluation_seconds, "evaluationErrorType": evaluator_error,
                                "totalIncludingEvaluationSeconds": time.perf_counter() - trial_started,
                                "constraintStatus": ("failed_evaluated_assertions" if any(not check.met for check in assertion_checks)
                                    else "passed_evaluated_assertions" if assertion_checks else "not_measured"),
                                "constraintViolations": sum(not check.met for check in assertion_checks) if assertion_checks else None,
                                "constraintCountMeaning": "failed upstream natural-language assertions only; not an exhaustive policy-violation audit",
                                "nativeToolResponses": len(answered), "nativeToolErrorResponses": sum(bool(m.error) for m in answered),
                                "nativeToolExecutionSuccessRate": (sum(not bool(m.error) for m in answered) / len(answered)) if answered else None,
                                "nativeToolRateMeaning": "non-error tool responses; not policy compliance or precision against one gold path",
                                "judgeAssertionCoverage": Counter(c.nl_assertion for c in assertion_checks) == Counter(expected_assertions),
                                "budget_terminated": failure == "budget_exhausted", "authoritativeCalls": environment.authoritative_calls,
                                "speculativeCalls": environment.speculative_calls, "usefulCalls": useful, "wastedCalls": environment.speculative_calls - useful,
                                "freshnessChecks": environment.refresh_calls, "revalidationCalls": 0, "fixtureHash": digest(task_sets[trial["domain"]][trial["taskId"]]),
                                **telemetry(budget_directory, run_id, drain["serviceDrainSucceeded"] and evaluator_error is None), **evaluator_usage(budget_directory, run_id)})
                            artifact.update({"simulation": simulation_record, "officialRewardInfo": reward_data,
                                "nativeToolTimings": environment.native_timings,
                                "officialTask": task.model_dump(mode="json"), "promotionEvents": environment.promotion_events,
                                "userSimulatorPrompt": {"policy": user.system_prompt, "policyHash": digest(user.system_prompt), "protocol": "unchanged-upstream-user-simulator"},
                                "finalDatabase": environment.tools.db.model_dump(mode="json")})
                    reads.pop(run_id, None)
                    write(output / f"{run_id}.json", artifact)
                    results.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                    results.flush()
                    os.fsync(results.fileno())
                    rows.append(row)
                    print(json.dumps({"stage": design["studyStage"], "completed": len(rows), "total": len(trials), "arm": row["arm"],
                        "success": row["success"], "officialReward": row["officialReward"], "cost": row["billedUsd"], "termination": row["termination"]}), flush=True)
        finally:
            final_started = time.perf_counter()
            broker.close()
            if process is not None:
                try:
                    process.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=15)
            gateway.shutdown()
            gateway.server_close()
            final_drain_seconds = time.perf_counter() - final_started
    summary = {"schemaVersion": 1, "studyId": study["studyId"], "studyStage": design["studyStage"], "studyHash": study["studyHash"],
        "designHash": design["designHash"], "label": study["label"], "counts": dict(Counter(row["arm"] for row in rows)),
        "successes": sum(row["success"] for row in rows), **summarize_costs(rows), "serviceExitCode": process.returncode if process is not None else None,
        "serviceStartupSeconds": startup_seconds, "serviceWallSeconds": time.perf_counter() - started,
        "finalServiceDrainSeconds": final_drain_seconds, "startupOutsideTrialClocks": True, "judgeOutsideLiveLatency": True,
        "evaluatorModel": study["models"]["teacher"], "upstreamDefaultEvaluatorModel": "gpt-4.1-2025-04-14"}
    write(output / "summary.json", summary)
    return summary
