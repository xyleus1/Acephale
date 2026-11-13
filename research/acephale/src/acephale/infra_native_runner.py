"""Pinned Qwen native collection/comparison with separately budgeted hosted ports.

This launcher never uses the legacy hosted-actor bootstrap. The existing native
environment, simulator prompts, independent evaluator and original budget journal
remain authoritative. Failed slots consume their declared position and are kept.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import secrets
import subprocess
import threading
import time
from collections import Counter
from pathlib import Path

from acephale.adapters.step_gateway import StepBroker, server
from acephale.contracts_v1 import hash_v1
from acephale.native_common import (
    MODELS,
    REVISION,
    ROOT,
    ServiceTelemetry,
    api_actor_instruction,
    apply_host_health,
    assess_official_reward,
    await_service_ready,
    close_failed_workers,
    drain_trial,
    native_evaluation_type,
    native_ports,
    observe_host_health,
    read,
    summarize_costs,
    write,
)

SERVICE_SCRIPT = "scripts/acephale-infra-native.ts"


def service_command(configuration: Path, output: Path) -> list[str]:
    return ["node", "--import", "tsx", SERVICE_SCRIPT, str(configuration), str(output)]


def validate_task_bundle(configuration: dict, manifest: dict, bundle: dict) -> dict:
    if bundle.get("version") != 1 or configuration.get("taskBundleHash") != hash_v1(bundle):
        raise ValueError("Native task bundle hash mismatch")
    if bundle.get("upstreamRevision") != REVISION or manifest["data"]["environmentRevision"] != REVISION:
        raise ValueError("Native upstream revision mismatch")
    if not configuration.get("hosted"):
        raise ValueError("Native launcher requires budgeted hosted user and evaluator ports")
    native_evaluation_type(configuration["hosted"].get("evaluationType", "ALL"))
    indexed = {}
    for item in bundle.get("tasks", []):
        key = (item["domain"], item["taskId"])
        if key in indexed or item["domain"] not in {"retail", "airline"} or not item.get("familyId"):
            raise ValueError("Duplicate or invalid native task identity")
        if str(item.get("task", {}).get("id")) != item["taskId"]:
            raise ValueError("Native task payload identity mismatch")
        indexed[key] = item
    run_ids = set()
    expected_allocation = "training" if configuration["stage"] == "collection" else configuration["stage"]
    if configuration["hosted"].get("allocation") != expected_allocation:
        raise ValueError("Native stage budget allocation mismatch")
    for run in configuration["runs"]:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", run["runId"]) or run["runId"] in run_ids:
            raise ValueError("Unsafe or duplicate native run identity")
        run_ids.add(run["runId"])
        item = indexed.get((run["domain"], run["taskId"]))
        if item is None or item["familyId"] != run["familyId"]:
            raise ValueError("Native schedule task or family mismatch")
        if run["maxBoundaries"] < configuration["hosted"]["maxSteps"]:
            raise ValueError("Actor boundary cap is below the native step cap")
    if not run_ids:
        raise ValueError("Empty native schedule")
    return indexed


def _verify_checkout(directory: Path, revision: str, paths: list[str] | None = None):
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=directory, text=True).strip()
    if actual != revision:
        raise ValueError("Pinned source checkout revision mismatch")
    result = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", *(paths or ["."])], cwd=directory, check=False)
    if result.returncode:
        raise ValueError("Pinned source has tracked modifications")
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "--", *(paths or ["."])],
        cwd=directory, text=True,
    )
    if untracked.strip():
        raise ValueError("Pinned source has untracked runtime files")


def verify_sources(manifest: dict, upstream_root: Path):
    _verify_checkout(ROOT, manifest["sourceCommit"], ["src/lib/acephale", "services/acephale-runtime",
        "scripts", "research/acephale/src", "package-lock.json", "research/acephale/uv.lock"])
    _verify_checkout(upstream_root, REVISION)


def verify_runtime_identity(manifest: dict):
    """Inventorying a portable binary must not leave dispatch on another PATH runtime."""
    actual_node = subprocess.check_output(["node", "-p", "process.versions.node"], cwd=ROOT, text=True).strip()
    if actual_node != manifest["runtime"]["node"] or platform.python_version() != manifest["runtime"]["python"]:
        raise ValueError("Actual benchmark Node/Python differs from observed runtime inventory")


def validate_native_task_source(configuration: dict, task_rows: dict, upstream_root: Path) -> None:
    """Official bytes or a complete independently verified custom bundle, never an implicit replacement."""
    custom = None
    if configuration.get("customTaskBundleDirectory") or configuration.get("customTaskReceiptHash"):
        from acephale.custom_native_tasks import verify_custom_bundle

        if not configuration.get("customTaskBundleDirectory") or not configuration.get("customTaskReceiptHash"):
            raise ValueError("Custom native tasks require their verified source directory and receipt")
        receipt, custom_bundle, partition = verify_custom_bundle(Path(configuration["customTaskBundleDirectory"]), upstream_root)
        if receipt["contentHash"] != configuration["customTaskReceiptHash"]:
            raise ValueError("Custom native receipt differs from the frozen configuration")
        custom = {(row["domain"], row["taskId"]): row for row in custom_bundle["tasks"]}
        allowed = {"collection": {"weight_fit", "calibration"}, "development": {"development"}, "heldout": {"test"}}
        if configuration["stage"] == "collection" and configuration.get("collectionPartitions") != ["weight_fit", "calibration"]:
            raise ValueError("Custom collection requires its explicit fitting/calibration selection")
        for key, item in task_rows.items():
            if custom.get(key) != item:
                raise ValueError("Custom task differs from its independently verified source")
        for run in configuration["runs"]:
            if partition["families"].get(run["familyId"]) not in allowed[configuration["stage"]]:
                raise ValueError("Custom task family crosses the frozen experiment partition")
    for domain in {row["domain"] for row in configuration["runs"]}:
        official = {str(task["id"]): task for task in read(upstream_root / f"data/tau2/domains/{domain}/tasks.json")}
        for (item_domain, task_id), item in task_rows.items():
            if custom is None and item_domain == domain and item["task"] != official.get(task_id):
                raise ValueError("Native task differs from its pinned upstream source")


class NativeTauExecutor:
    """Only this boundary imports tau2; offline validation needs no hosted SDK."""

    def __init__(self, configuration: dict, task_rows: dict, upstream_root: Path):
        import dotenv
        dotenv.load_dotenv = lambda *args, **kwargs: False
        os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
        os.environ["LOGURU_LEVEL"] = "ERROR"
        os.environ["TAU2_DATA_DIR"] = str(upstream_root / "data")
        import tau2
        from tau2.agent.llm_agent import AGENT_INSTRUCTION
        from tau2.registry import registry

        if not Path(tau2.__file__).resolve().is_relative_to(upstream_root.resolve()):
            raise ValueError("Imported tau2 is not the pinned upstream checkout")
        self.configuration, self.task_rows, self.registry = configuration, task_rows, registry
        self.instruction = api_actor_instruction(AGENT_INSTRUCTION)
        self.contexts = {}
        validate_native_task_source(configuration, task_rows, upstream_root)
        for run in configuration["runs"]:
            environment = registry.get_env_constructor(run["domain"])(solo_mode=False)
            tools = [tool.openai_schema for tool in environment.get_tools()]
            if hash_v1(tools) != hash_v1(run["tools"]):
                raise ValueError("Native tool catalog differs from frozen configuration")
            self.contexts[run["runId"]] = {"policy": self.instruction + "\n\n" + environment.get_policy(),
                "tools": tools, "capturedBeforeExecution": True}

    def execute(self, run: dict, broker, reads: dict, telemetry) -> dict:
        from tau2.data_model.tasks import Task
        from tau2.evaluator.evaluator import EvaluationType
        from tau2.orchestrator.orchestrator import Orchestrator

        from acephale.adapters.tau_external_agent import ExternalAcephaleAgent
        from acephale.adapters.tau_snapshot import ALLOWED, NativeSnapshotEnvironment

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
                        "isRead": tool_name in ALLOWED[self.domain_name], "durationMs": 1000 * (time.perf_counter() - started)})

            def read(self, tool, arguments):
                self.speculative_calls += 1
                started = time.perf_counter()
                try:
                    return super().read(tool, arguments)
                finally:
                    self.native_timings.append({"operation": "speculative_snapshot_wrapper", "tool": tool,
                        "isRead": True, "durationMs": 1000 * (time.perf_counter() - started)})

            def refresh(self, lease, tool, arguments):
                self.refresh_calls += 1
                started = time.perf_counter()
                try:
                    return super().refresh(lease, tool, arguments)
                finally:
                    self.native_timings.append({"operation": "freshness_validation", "tool": tool,
                        "isRead": True, "durationMs": 1000 * (time.perf_counter() - started)})

        run_id, hosted = run["runId"], self.configuration["hosted"]
        evaluation_type = native_evaluation_type(hosted.get("evaluationType", "ALL"))
        row = _empty_row(run)
        artifact = {"record": row, "simulation": {"messages": []}, "verdict": None}
        samples = []
        try:
            environment = CountedEnvironment(self.registry.get_env_constructor(run["domain"])(solo_mode=False))
            reads[run_id] = environment
            task = Task.model_validate(self.task_rows[run["domain"], run["taskId"]]["task"])
            actor = ExternalAcephaleAgent(environment.get_tools(), environment.get_policy(), broker, run_id, environment, self.instruction)
            user, evaluate = native_ports(broker, run_id, task, MODELS)
            orchestrator = Orchestrator(domain=run["domain"], agent=actor, user=user, environment=environment, task=task,
                max_steps=hosted["maxSteps"], max_errors=hosted["maxErrors"], seed=run["seed"], timeout=hosted["timeoutSeconds"])
            samples.append(observe_host_health("before_native"))
            if not samples[-1]["healthy"]:
                raise RuntimeError("Research host unavailable before native dispatch")
            started, simulation, failure = time.perf_counter(), None, None
            try:
                simulation = orchestrator.run()
                termination = simulation.termination_reason.value
            except Exception as error:
                failure = "budget_exhausted" if "budget" in str(error).lower() else "execution_error"
                termination = failure
                artifact["exceptionType"] = type(error).__name__
            native_seconds = time.perf_counter() - started
            artifact["simulation"] = simulation.model_dump(mode="json") if simulation else {
                "messages": [message.model_dump(mode="json") for message in orchestrator.get_messages()]}
            # Actor/user drain is timed separately and included in the live trial.
            drain = drain_trial(broker, run_id, started, native_seconds)
            samples.append(observe_host_health("after_actor_user_drain"))
            artifact.update({"promotionEvents": environment.promotion_events, "nativeToolTimings": environment.native_timings,
                "finalDatabase": environment.tools.db.model_dump(mode="json"), "officialTask": task.model_dump(mode="json")})
            row.update({"nativeTermination": termination, "latencyMs": native_seconds * 1000, **drain,
                "authoritativeCalls": environment.authoritative_calls, "speculativeCalls": environment.speculative_calls,
                "freshnessChecks": environment.refresh_calls, "revalidationCalls": 0})
            evaluation_started = time.perf_counter()
            reward = evaluate(simulation=simulation, task=task, evaluation_type=EvaluationType[evaluation_type],
                solo_mode=False, domain=run["domain"], strict_replay=True) if simulation else None
            verdict = {**assess_official_reward(task, reward, evaluation_type=evaluation_type),
                "evaluatorVersion": f"tau2:{REVISION}:{evaluation_type}",
                "judgeModel": MODELS["teacher"]}
            artifact.update({"verdict": verdict, "officialRewardInfo": reward.model_dump(mode="json") if reward else None})
            # A judge failure cannot release cost uncertainty or report full drain.
            broker.finish(run_id + ":evaluator")
            drained = drain["serviceDrainSucceeded"]
            if not drained:
                failure = failure or "service_drain_error"
            if not verdict["evaluationValid"]:
                failure = failure or "evaluation_error"
            useful = sum(event["status"] == "consumed" for event in environment.promotion_events)
            row.update({"success": bool(verdict["passed"] and not failure and termination in {"user_stop", "agent_stop"}),
                "termination": failure or termination, "constraintViolations": verdict["constraintViolations"],
                "evaluationValid": verdict["evaluationValid"], "evaluationSeconds": time.perf_counter() - evaluation_started,
                "totalIncludingEvaluationSeconds": time.perf_counter() - started,
                "budget_terminated": failure == "budget_exhausted", "usefulCalls": useful,
                "unpromotedCalls": max(0, environment.speculative_calls - useful), **telemetry.summary(run_id, drained)})
            artifact["userSimulatorPrompt"] = {"policy": user.system_prompt, "policyHash": hash_v1(user.system_prompt),
                "protocol": "unchanged-upstream-user-simulator"}
        except Exception as error:
            artifact["exceptionType"] = type(error).__name__
            row["termination"] = "evaluation_error" if artifact["simulation"]["messages"] else "execution_error"
            close_failed_workers(broker, run_id, custom=False, ready_at=True)
            row.update(telemetry.summary(run_id, False))
        finally:
            if samples:
                samples.append(observe_host_health("after_trial"))
            apply_host_health(row, samples)
            reads.pop(run_id, None)
        return artifact


def _empty_row(run: dict) -> dict:
    return {**{key: value for key, value in run.items() if key != "tools"}, "success": False,
        "termination": "not_started", "constraintViolations": None, "budget_terminated": False,
        "latencyMs": None, "totalTrialSeconds": None, "serviceDrainSucceeded": False,
        "accountingScope": "hosted_user_and_judge", "gpuCostStatus": "separate_infrastructure_ledger"}


def _stop_process(process):
    if process is None:
        return
    try:
        process.wait(timeout=60)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=15)


def _write_receipt(output: Path, configuration: dict, manifest: dict, summary: dict) -> dict:
    files = [{"path": path.relative_to(output).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted(output.rglob("*")) if path.is_file() and path.name != "cohort-receipt.json"]
    receipt = {"version": 1, "stage": configuration["stage"], "configurationHash": hash_v1(configuration),
        "manifestHash": hash_v1(manifest), "files": files, "allDeclaredSlotsRetained": True,
        "serviceExitCode": summary["serviceExitCode"], "closed": True, "completed": not summary["stageAborted"]}
    write(output / "cohort-receipt.json", receipt)
    return receipt


def _run_cohort(configuration: dict, manifest: dict, bundle: dict, output: Path, budget_directory: Path,
                executor_factory, verify_runtime, *, process_factory=subprocess.Popen, telemetry_factory=ServiceTelemetry) -> dict:
    """One shot lifecycle; injectable seams only support offline integration tests."""
    output.mkdir(parents=True, exist_ok=False)
    write(output / "configuration.json", configuration)
    write(output / "manifest.json", manifest)
    write(output / "tasks.json", bundle)
    write(output / "design.json", {"version": 1, "stage": configuration["stage"], "runs": configuration["runs"],
        **{key: manifest["data"][key] for key in ("trainingFamilies", "developmentFamilies", "heldoutFamilies")}})
    broker = StepBroker(expected_manifest_hash=hash_v1(configuration), expected_experiment_manifest_hash=hash_v1(manifest))
    token, reads = secrets.token_hex(32), {}
    telemetry, gateway, gateway_started = None, None, False
    process, ready_at, startup_failure, rows = None, None, None, []
    started = time.perf_counter()
    executor = None
    try:
        # Snapshot existing logs before starting the service. Setup failures
        # retain the declared slots and close every resource already created.
        telemetry = telemetry_factory(budget_directory, hash_v1(configuration))
        gateway = server(broker, token, reads=reads)
        threading.Thread(target=gateway.serve_forever, daemon=True).start()
        gateway_started = True
        verify_runtime()
        executor = executor_factory()
        write(output / "public-contexts.json", executor.contexts)
        with (output / "service.log").open("x", encoding="utf-8") as log:
            process = process_factory(service_command(output / "configuration.json", output / "service"), cwd=ROOT,
                env={**os.environ, "ACEPHALE_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}",
                    "ACEPHALE_GATEWAY_TOKEN": token, "ACEPHALE_BUDGET_DIRECTORY": str(budget_directory)},
                stdout=log, stderr=subprocess.STDOUT, text=True)
            def watch_service():
                process.wait()
                broker.close()
            threading.Thread(target=watch_service, daemon=True).start()
            ready_at, startup_failure = await_service_ready(broker, process)
            if ready_at is not None:
                telemetry.bind(process.pid)
            write(output / "readiness.json", {"configurationHash": hash_v1(configuration), "manifestHash": hash_v1(manifest),
                "serviceReady": ready_at is not None, "startupFailure": startup_failure,
                "serviceStartupSeconds": time.perf_counter() - started})
            with (output / "outcomes.jsonl").open("x", encoding="utf-8") as stream:
                for run in configuration["runs"]:
                    try:
                        if ready_at is None:
                            raise RuntimeError("Service never acknowledged readiness")
                        verify_runtime()
                        artifact = executor.execute(run, broker, reads, telemetry)
                    except Exception as error:
                        close_failed_workers(broker, run["runId"], custom=False, ready_at=ready_at)
                        artifact = {"record": {**_empty_row(run), "termination": "startup_failure" if ready_at is None else "slot_failure",
                            "exceptionType": type(error).__name__, **telemetry.summary(run["runId"], False)},
                            "simulation": {"messages": []}, "verdict": None}
                    artifact["record"]["serviceReadyBeforeTrial"] = ready_at is not None
                    _persist_slot(output, stream, artifact, rows)
            broker.close()
            _stop_process(process)
    except Exception as error:
        startup_failure = type(error).__name__
    finally:
        # No declared slot disappears when initialization, source checks or a
        # service transport fails. A subsequent invocation cannot overwrite it.
        with (output / "outcomes.jsonl").open("a", encoding="utf-8") as stream:
            for run in configuration["runs"][len(rows):]:
                artifact = {"record": {**_empty_row(run), "termination": "stage_aborted_before_slot",
                    "exceptionType": startup_failure, "serviceReadyBeforeTrial": False,
                    **(telemetry.summary(run["runId"], False) if telemetry else {
                        "billedUsd": None, "knownUsageSubtotalUsd": 0, "unknownProviderCharge": True,
                        "providerCalls": 0, "costCensoringReason": "service_not_started"})},
                    "simulation": {"messages": []}, "verdict": None}
                _persist_slot(output, stream, artifact, rows)
        drain_started = time.perf_counter()
        broker.close()
        _stop_process(process)
        if gateway_started:
            gateway.shutdown()
        if gateway:
            gateway.server_close()
        final_drain = time.perf_counter() - drain_started
    summary = {"version": "acephale-infra-native-v1", "stage": configuration["stage"],
        "configurationHash": hash_v1(configuration), "manifestHash": hash_v1(manifest),
        "counts": dict(Counter(row["arm"] for row in rows)), "successes": sum(row["success"] for row in rows),
        "allDeclaredSlotsRetained": len(rows) == len(configuration["runs"]), "notRetried": True,
        "serviceExitCode": process.returncode if process else None,
        "stageAborted": startup_failure is not None or process is None or process.returncode != 0,
        "startupFailure": startup_failure, "finalServiceDrainSeconds": final_drain,
        "stageWallSeconds": time.perf_counter() - started, "accountingScope": "hosted_user_and_judge",
        "gpuCostStatus": "separate_infrastructure_ledger", **summarize_costs(rows)}
    write(output / "summary.json", summary)
    _write_receipt(output, configuration, manifest, summary)
    return summary


def _persist_slot(output, stream, artifact, rows):
    row = artifact["record"]
    write(output / f"{row['runId']}.json", artifact)
    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
    stream.flush()
    os.fsync(stream.fileno())
    rows.append(row)


def run_native(configuration: Path, tasks: Path, output: Path, budget_directory: Path, upstream_root: Path) -> dict:
    configuration, tasks, output = configuration.resolve(), tasks.resolve(), output.resolve()
    budget_directory, upstream_root = budget_directory.resolve(), upstream_root.resolve()
    config = read(configuration)
    # Freeze absolute artifact paths into the exact service readiness identity.
    for field in ("manifestPath", "ledgerCheckpointPath", "memoryPath", "calibrationPath", "opportunityPath", "goalReliabilityPath", "splitGuardPath", "customTaskBundleDirectory"):
        if config.get(field):
            config[field] = str((configuration.parent / config[field]).resolve())
    manifest, bundle = read(Path(config["manifestPath"])), read(tasks)
    indexed = validate_task_bundle(config, manifest, bundle)
    if not (budget_directory / "budget.jsonl").is_file() or (budget_directory / "budget.jsonl").stat().st_size == 0:
        raise ValueError("Original budget journal is required; a replacement ledger is forbidden")
    # TypeScript remains the canonical manifest/artifact validator. This imports
    # no model, reads no credential files and performs no network request.
    script = "const fs=require('node:fs'); const {loadInfraNativeConfiguration}=require('./scripts/acephale-infra-native.ts'); loadInfraNativeConfiguration(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});"
    subprocess.run(["node", "--import", "tsx", "-e", script, str(configuration)], cwd=ROOT, check=True)
    def verify_runtime():
        verify_sources(manifest, upstream_root)
        verify_runtime_identity(manifest)
    return _run_cohort(config, manifest, bundle, output, budget_directory,
        lambda: NativeTauExecutor(config, indexed, upstream_root), verify_runtime)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("config", "tasks", "output", "budget-directory", "upstream-root"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args(argv)
    summary = run_native(args.config, args.tasks, args.output, args.budget_directory, args.upstream_root)
    print(json.dumps(summary, indent=2))
    return 1 if summary["stageAborted"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
