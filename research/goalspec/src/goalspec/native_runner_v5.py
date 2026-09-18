"""Local native runner shared by fresh training/development and official confirmation."""
from __future__ import annotations

import json
import hashlib
import math
import os
import re
import secrets
import subprocess
import threading
import time
from collections import Counter
from pathlib import Path

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.fresh_tasks import digest, native_environment, preflight, verify_outcome
from goalspec.fresh_tasks_v5 import preflight_v5
from goalspec.native_live import drain_trial, summarize_costs
from goalspec.contracts_v1 import hash_v1
from goalspec.official_native import api_actor_instruction, native_ports, service_manifest_hash
from goalspec.study_v2 import read, write
from goalspec.study_v3 import MODELS, ROOT


def observe_host_health(phase, *, status_path=None, now_ms=None):
    """Mirror the provider heartbeat validity checks without changing thresholds.

    Native local studies require a configured guard. A broken newest immutable
    publication never falls back to an older healthy heartbeat.
    """
    now = time.time() * 1000 if now_ms is None else now_ms
    sample = {"phase": phase, "checkedAtUnixMs": now, "healthy": False}
    path = status_path if status_path is not None else os.environ.get("GOALSPEC_HOST_STATUS_FILE")
    if not path:
        return {**sample, "reason": "host_guard_not_configured"}
    try:
        latest, sequence = Path(path), None
        if latest.is_dir():
            names = sorted(item.name for item in latest.iterdir() if re.fullmatch(r"[0-9]{16}\.json", item.name))
            if not names:
                raise ValueError("No heartbeat")
            latest = latest / names[-1]
            sequence = int(names[-1][:16])
        raw = latest.read_bytes()
        sample.update({"publication": latest.name, "publicationSha256": hashlib.sha256(raw).hexdigest()})
        status = json.loads(raw)
        if not isinstance(status, dict) or sequence is not None and (not 1 <= sequence <= 9007199254740991
                or type(status.get("heartbeatSequence")) not in (int, float) or status.get("heartbeatSequence") != sequence):
            raise ValueError("Invalid heartbeat sequence")
        numeric = lambda value: type(value) in (int, float) and math.isfinite(value) and value > 0
        if status.get("healthy") is not True or status.get("networkConnected") is not True or not numeric(status.get("observedAtUnixMs")) or not numeric(status.get("maxStatusAgeMs")):
            return {**sample, "reason": "invalid_or_degraded_host_status"}
        age, limit = now - status["observedAtUnixMs"], min(status["maxStatusAgeMs"], 3000)
        sample.update({"heartbeatSequence": status.get("heartbeatSequence"), "observedAtUnixMs": status["observedAtUnixMs"],
                       "ageMs": age, "maxStatusAgeMs": limit})
        if status.get("state") != "healthy" or age < -1000 or age > limit:
            return {**sample, "reason": "degraded_or_stale_heartbeat"}
        return {**sample, "healthy": True, "reason": None}
    except Exception as error:
        return {**sample, "reason": "host_status_unavailable", "errorType": type(error).__name__}


def apply_host_health(row, samples):
    """Retain raw clocks and native verdict; interrupt the measured-study row."""
    row["hostHealthSamples"] = samples
    row["hostInterrupted"] = any(sample["healthy"] is not True for sample in samples)
    row["successWithoutHostGuard"] = row.get("success", False)
    phases = {sample["phase"] for sample in samples}
    row["measuredTimingValid"] = not row["hostInterrupted"] and {"before_native", "after_actor_user_drain", "after_trial"}.issubset(phases)
    if row["hostInterrupted"]:
        row["terminationBeforeHostGuard"] = row.get("termination")
        row["success"], row["termination"] = False, "host_interruption"


def await_service_ready(broker, process):
    """A failed startup is terminated once, before any trial drain is attempted."""
    try:
        return broker.wait_ready(timeout=600), None
    except Exception as error:
        failure = type(error).__name__
        broker.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=15)
        return None, failure


def close_failed_workers(broker, run_id, *, custom, ready_at):
    # Never enqueue close requests for workers that have not acknowledged ready.
    if ready_at is None:
        return
    for worker in (run_id, run_id + ":user", *(() if custom else (run_id + ":evaluator",))):
        try:
            broker.finish(worker)
        except Exception:
            pass


class ServiceTelemetry:
    """Read only new bytes from this service's exclusively owned event log."""
    def __init__(self, directory, manifest_hash):
        self.directory, self.manifest_hash = Path(directory), manifest_hash
        self.before = {path.name for path in self.directory.glob("events-*.jsonl")}
        self.path = self.identity = None
        self.offset, self.sequence, self.previous = 0, 0, "0" * 64
        self.pending, self.runs, self.manifest_seen, self.failure = b"", {}, False, None

    def bind(self, pid):
        if self.path is not None:
            raise ValueError("Service telemetry already bound")
        lock = read(self.directory / "budget.jsonl.lock")
        added = [path for path in self.directory.glob("events-*.jsonl") if path.name not in self.before]
        if lock.get("pid") != pid or len(added) != 1:
            raise ValueError("Service event log does not have one exclusive spending owner")
        self.path = added[0]
        stat = self.path.stat()
        self.identity = (stat.st_dev, stat.st_ino)
        self._read()
        if not self.manifest_seen:
            raise ValueError("Service event log has no matching research manifest")

    def _read(self):
        stat = self.path.stat()
        if (stat.st_dev, stat.st_ino) != self.identity or stat.st_size < self.offset:
            raise ValueError("Active service event log was replaced or truncated")
        with self.path.open("rb") as stream:
            stream.seek(self.offset)
            while True:
                block = stream.read(65536)
                if not block:
                    break
                self.offset += len(block)
                self.pending += block
                while b"\n" in self.pending:
                    line, self.pending = self.pending.split(b"\n", 1)
                    record = json.loads(line)
                    body = record["body"]
                    if body["sequence"] != self.sequence or body["previousHash"] != self.previous or hash_v1(body) != record["hash"]:
                        raise ValueError("Active service event chain changed")
                    self.sequence += 1
                    self.previous = record["hash"]
                    event = body["event"]
                    if event.get("type") == "research_manifest":
                        if self.manifest_seen or event.get("manifestHash") != self.manifest_hash:
                            raise ValueError("Service telemetry manifest mismatch")
                        self.manifest_seen = True
                    if "event" in event and "runId" in event:
                        event = {**event["event"], "runId": event["runId"]}
                    run = event.get("runId")
                    if not run:
                        continue
                    totals = self.runs.setdefault(run, {"knownMicrodollars": 0, "providerCalls": 0, "unknown": False, "rejectedCalls": 0, "cancelledCalls": 0})
                    kind = event.get("type")
                    if kind in {"model_attempt", "embedding"}:
                        totals["knownMicrodollars"] += event.get("costMicrodollars", 0)
                        totals["providerCalls"] += 1
                    totals["unknown"] |= kind in {"model_attempt_failed", "embedding_failed"}
                    totals["rejectedCalls"] += kind == "rejected"
                    totals["cancelledCalls"] += kind == "cancellation_confirmed"
                if len(self.pending) > 8 * 1024 * 1024:
                    raise ValueError("Service event row exceeds telemetry bound")

    def summary(self, run_id, managed_work_drained):
        if self.path is not None and self.failure is None:
            try:
                self._read()
            except Exception as error:
                self.failure = type(error).__name__
        totals = self.runs.get(run_id, {})
        known = round(totals.get("knownMicrodollars", 0) / 1_000_000, 6)
        unknown = totals.get("unknown", False) or not managed_work_drained or not self.manifest_seen or self.failure is not None
        return {"billedUsd": None if unknown else known, "knownUsageSubtotalUsd": known,
                "providerCalls": totals.get("providerCalls", 0), "unknownProviderCharge": bool(unknown),
                "rejectedCalls": totals.get("rejectedCalls", 0), "cancelledCalls": totals.get("cancelledCalls", 0),
                **({"telemetryIntegrityError": self.failure} if self.failure else {}),
                **({"costCensoringReason": "managed_work_drain_or_service_log_unavailable"} if unknown and not managed_work_drained else {})}


def assess_official_reward(task, reward):
    """Preserve upstream reward while rejecting an incomplete required judge."""
    criteria = task.evaluation_criteria
    expected = criteria.nl_assertions or [] if criteria else []
    assertions = reward.nl_assertions or [] if reward else []
    coverage = Counter(item.nl_assertion for item in assertions) == Counter(expected)
    required = criteria is not None and "NL_ASSERTION" in criteria.reward_basis
    valid = not required or coverage
    return {"passed": bool(reward is not None and reward.reward == 1 and valid),
            "officialReward": reward.reward if reward is not None else None,
            "constraintViolations": sum(not item.met for item in assertions) if assertions else None,
            "judgeAssertionCoverage": coverage, "requiredJudgeAssertionCoverage": coverage if required else None,
            "evaluationValid": valid, "evaluationErrorType": None if valid else "IncompleteRequiredNLAssertions"}


def run_stage(plan, verify_runtime):
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    os.environ["LOGURU_LEVEL"] = "ERROR"
    os.environ["TAU2_DATA_DIR"] = str(Path(plan["upstreamRoot"]) / "data")
    from tau2.agent.llm_agent import AGENT_INSTRUCTION
    from tau2.data_model.tasks import Task, UserScenario
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
            return super().refresh(lease, tool, arguments)

    design, inputs = plan["design"], plan["inputs"]
    fixtures = read(Path(inputs["manifest"]["path"]))
    custom = fixtures.get("generator") == "fresh-native-v5"
    tasks = {(task["domain"], task["taskId"]): task for task in fixtures["tasks"]}
    official = {domain: {str(task["id"]): task for task in read(Path(plan["upstreamRoot"]) /
        f"data/tau2/domains/{domain}/tasks.json")} for domain in ("retail", "airline")} if not custom else {}
    configuration = read(Path(inputs["configuration"]["path"]))
    records = read(Path(inputs["records"]["path"]))
    snapshot_ids = {record["pattern"]["snapshotId"] for record in records}
    if len(snapshot_ids) != 1:
        raise ValueError("One frozen repository snapshot required")
    snapshot_id = next(iter(snapshot_ids))
    output, budget = Path(plan["outputPath"]), Path(plan["budgetDirectory"])
    output.mkdir(parents=True, exist_ok=False)
    write(output / "design.json", design)
    write(output / "dispatch-plan.json", plan)
    instruction = api_actor_instruction(AGENT_INSTRUCTION)
    entries, configured, contexts = [], [], {}
    for index, trial in enumerate(design["trials"]):
        fixture = tasks[trial["domain"], trial["taskId"]]
        if custom and preflight_v5(fixture) != fixtures["checks"][fixture["taskId"]]:
            raise ValueError("Independent target changed")
        environment = native_environment(fixture) if custom else registry.get_env_constructor(trial["domain"])(solo_mode=False)
        run_id = f"v5-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}"
        tools = [tool.openai_schema for tool in environment.get_tools()]
        contexts[run_id] = {"policy": instruction + "\n\n" + environment.get_policy(), "tools": tools, "capturedBeforeExecution": True}
        configured.append({"runId": run_id, "arm": trial["arm"], "domain": trial["domain"], "familyId": trial["family"], "allocation": design["phase"],
            "maxCostMicrodollars": round(trial["reserved_usd"] * 1_000_000), "maxBoundaries": design["maxSteps"],
            "tools": tools, "evaluator": not custom})
        entries.append((run_id, trial, fixture))
    manifest = {"schemaVersion": 1, "snapshotId": snapshot_id, "heldoutFamilies": design["families"],
        "runtimeVersion": "v5", "recordsPath": inputs["records"]["path"], "memoryPath": inputs["memory"]["path"],
        "v5Configuration": configuration, "v4Configuration": read(Path(configuration["legacyConfigurationPath"])),
        "runs": configured, "awaitReady": True, "perRunCloseAcknowledgement": True,
        "maxDecisions": (design["maxSteps"] * 3 + 6) * len(entries), "studyId": design["studyId"], "studyStage": design["studyStage"]}
    write(output / "service-manifest.json", manifest)
    write(output / "public-contexts.json", contexts)
    manifest_hash = service_manifest_hash(output / "service-manifest.json")
    broker, reads = StepBroker(expected_manifest_hash=manifest_hash), {}
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    rows, process, startup_failure, ready_at, startup_seconds = [], None, None, None, None
    service_telemetry = ServiceTelemetry(budget, manifest_hash)
    started = time.perf_counter()
    with (output / "service.log").open("x", encoding="utf-8") as log, (output / "outcomes.jsonl").open("x", encoding="utf-8") as results:
        try:
            verify_runtime()
            process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-service.ts",
                "services/goalspec-runtime/research-bootstrap.ts", str(budget)], cwd=ROOT, stdout=log, stderr=log,
                env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}",
                     "GOALSPEC_GATEWAY_TOKEN": token, "GOALSPEC_MANIFEST_PATH": str((output / "service-manifest.json").resolve())})
            def monitor():
                process.wait()
                broker.close()
            threading.Thread(target=monitor, daemon=True).start()
            ready_at, startup_failure = await_service_ready(broker, process)
            if ready_at is not None:
                service_telemetry.bind(process.pid)
            startup_seconds = (ready_at or time.perf_counter()) - started
            write(output / "service-readiness.json", {"ready": ready_at is not None, "manifestHash": manifest_hash,
                "serviceStartupSeconds": startup_seconds, "errorType": startup_failure,
                "eventPath": str(service_telemetry.path.resolve()) if service_telemetry.path else None,
                "telemetryMode": "one_exclusive_service_log_incremental"})
            for run_id, trial, fixture in entries:
                row = {**trial, "schemaVersion": "1.0.0", "experimentId": design["designHash"], "snapshotId": snapshot_id,
                    "runId": run_id, "studyId": design["studyId"], "studyStage": design["studyStage"], "familyId": trial["family"],
                    "label": design["label"], "success": False, "officialReward": None, "constraintViolations": None,
                    "budget_terminated": False, "termination": "execution_error", "serviceReadyBeforeTrial": ready_at is not None,
                    "totalTrialSeconds": None, "latencyMs": None, "serviceDrainSeconds": None, "evaluationSeconds": None}
                artifact = {"record": row}
                host_samples = []
                try:
                    if startup_failure:
                        raise RuntimeError("Service startup failed")
                    verify_runtime()
                    environment = CountedEnvironment(native_environment(fixture) if custom else registry.get_env_constructor(trial["domain"])(solo_mode=False))
                    reads[run_id] = environment
                    task = Task(id=fixture["taskId"], user_scenario=UserScenario(instructions=fixture["userInstructions"])) if custom else Task.model_validate(official[trial["domain"]][trial["taskId"]])
                    actor = ExternalGoalSpecAgent(environment.get_tools(), environment.get_policy(), broker, run_id, environment, instruction)
                    user, evaluate = native_ports(broker, run_id, task, MODELS)
                    orchestrator = Orchestrator(domain=trial["domain"], agent=actor, user=user, environment=environment, task=task,
                        max_steps=design["maxSteps"], max_errors=design["maxErrors"], seed=trial["seed"], timeout=design["trialTimeoutSeconds"])
                    host_samples.append(observe_host_health("before_native"))
                    if not host_samples[-1]["healthy"]:
                        raise RuntimeError("Research host unavailable before trial")
                    trial_started, failure, simulation = time.perf_counter(), None, None
                    try:
                        simulation = orchestrator.run()
                        termination = simulation.termination_reason.value
                    except Exception as error:
                        failure = "budget_exhausted" if "budget" in str(error).lower() else "execution_error"
                        termination = failure
                        artifact["exceptionType"] = type(error).__name__
                    messages = orchestrator.get_messages()
                    serialized = simulation.model_dump(mode="json") if simulation else {"messages": [m.model_dump(mode="json") for m in messages]}
                    native_seconds = time.perf_counter() - trial_started
                    drain = drain_trial(broker, run_id, trial_started, native_seconds)
                    host_samples.append(observe_host_health("after_actor_user_drain"))
                    if not drain["serviceDrainSucceeded"]:
                        failure = failure or "service_drain_error"
                    row.update({"nativeTermination": termination, "termination": failure or termination,
                        "latencyMs": 1000 * native_seconds, **drain, "budget_terminated": failure == "budget_exhausted",
                        "authoritativeCalls": environment.authoritative_calls, "speculativeCalls": environment.speculative_calls,
                        "freshnessChecks": environment.refresh_calls, "revalidationCalls": 0})
                    artifact.update({"simulation": serialized,
                        "promotionEvents": environment.promotion_events, "nativeToolTimings": environment.native_timings,
                        "finalDatabase": environment.tools.db.model_dump(mode="json")})
                    evaluation_started = time.perf_counter()
                    if custom:
                        verdict = verify_outcome(fixture, fixtures["checks"][fixture["taskId"]], environment, messages)
                        passed = verdict["success"]
                        artifact.update({"verdict": verdict, "independentCheck": fixtures["checks"][fixture["taskId"]]})
                        row.update({"constraintViolations": verdict["constraintViolations"], "fixtureHash": fixture["fixtureHash"]})
                    else:
                        reward = evaluate(simulation=simulation, task=task, evaluation_type=EvaluationType.ALL,
                            solo_mode=False, domain=trial["domain"], strict_replay=True) if simulation else None
                        assessment = assess_official_reward(task, reward)
                        passed = assessment["passed"]
                        if not assessment["evaluationValid"]:
                            failure = failure or "evaluation_error"
                        artifact.update({"officialTask": task.model_dump(mode="json"), "officialRewardInfo": reward.model_dump(mode="json") if reward else None})
                        row.update({key: value for key, value in assessment.items() if key != "passed"})
                        broker.finish(run_id + ":evaluator")
                    evaluation_seconds = time.perf_counter() - evaluation_started
                    useful = sum(event["status"] == "consumed" for event in environment.promotion_events)
                    row.update({"success": bool(passed and not failure and termination in {"user_stop", "agent_stop"}),
                        "termination": failure or termination, "nativeTermination": termination, "latencyMs": 1000 * native_seconds,
                        **drain, "evaluationSeconds": evaluation_seconds, "budget_terminated": failure == "budget_exhausted",
                        "authoritativeCalls": environment.authoritative_calls, "speculativeCalls": environment.speculative_calls,
                        "usefulCalls": useful, "unpromotedCalls": max(0, environment.speculative_calls - useful),
                        "freshnessChecks": environment.refresh_calls, "revalidationCalls": 0,
                        **service_telemetry.summary(run_id, drain["serviceDrainSucceeded"])})
                    artifact.update({"simulation": serialized,
                        "promotionEvents": environment.promotion_events, "nativeToolTimings": environment.native_timings,
                        "finalDatabase": environment.tools.db.model_dump(mode="json"),
                        "userSimulatorPrompt": {"policy": user.system_prompt, "policyHash": digest(user.system_prompt), "protocol": "unchanged-upstream-user-simulator"}})
                except Exception as error:
                    artifact["exceptionType"] = type(error).__name__
                    row["termination"] = "evaluation_error" if artifact.get("simulation") else "execution_error"
                    row["budget_terminated"] = row["budget_terminated"] or "budget" in str(error).lower()
                    close_failed_workers(broker, run_id, custom=custom, ready_at=ready_at)
                    row.update(service_telemetry.summary(run_id, False))
                finally:
                    if host_samples:
                        host_samples.append(observe_host_health("after_trial"))
                    apply_host_health(row, host_samples)
                    reads.pop(run_id, None)
                write(output / f"{run_id}.json", artifact)
                results.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                results.flush()
                os.fsync(results.fileno())
                rows.append(row)
                print(json.dumps({"stage": design["studyStage"], "completed": len(rows), "total": len(entries),
                    "arm": row["arm"], "success": row["success"], "cost": row["billedUsd"], "termination": row["termination"]}), flush=True)
        finally:
            for run_id, trial, _fixture in entries[len(rows):]:
                row = {**trial, "runId": run_id, "studyId": design["studyId"], "studyStage": design["studyStage"],
                    "familyId": trial["family"], "success": False, "termination": "stage_aborted_before_slot",
                    "totalTrialSeconds": None, "budget_terminated": False, **service_telemetry.summary(run_id, False)}
                write(output / f"{run_id}.json", {"record": row})
                results.write(json.dumps(row) + "\n")
                results.flush()
                rows.append(row)
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
            final_drain = time.perf_counter() - final_started
    summary = {"version": "goalspec-native-v5", "studyId": design["studyId"], "studyStage": design["studyStage"],
        "designHash": design["designHash"], "label": design["label"], "counts": dict(Counter(row["arm"] for row in rows)),
        "successes": sum(row["success"] for row in rows), **summarize_costs(rows), "serviceExitCode": process.returncode if process else None,
        "hostInterruptedTrials": sum(row.get("hostInterrupted") is True for row in rows),
        "timingValidityNote": "Raw native/live/judge clocks are retained. A failed pre/post host-health sample invalidates measured timing and study success without changing native STOP or verifier results. Health checks and stage setup are outside native/live clocks; no interrupted trial is retried.",
        "serviceStartupSeconds": startup_seconds, "finalServiceDrainSeconds": final_drain,
        "evaluatorModel": None if custom else MODELS["teacher"], "upstreamDefaultEvaluatorModel": "gpt-4.1-2025-04-14"}
    write(output / "summary.json", summary)
    return summary
