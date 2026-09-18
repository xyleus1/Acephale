"""Single-use, fully reserved, serial four-arm custom native v4 evaluation."""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import secrets
import subprocess
import threading
import time
import zipfile
from collections import Counter
from pathlib import Path

from goalspec.fresh_tasks import (
    NATIVE_COMMIT,
    digest,
    native_environment,
    preflight,
    verify_outcome,
)
from goalspec.native_live import drain_trial, summarize_costs, telemetry
from goalspec.source_freeze import category, collect_sources, file_digest
from goalspec.study_v2 import read, write

ROOT = Path(__file__).resolve().parents[4]
ARMS = ("base", "paste", "salesforce", "goalspec")
MODELS = {"actor": "gpt-5.4-2026-03-05", "teacher": "gpt-5.4-2026-03-05", "user": "gpt-4.1-mini-2025-04-14",
          "goal": "gpt-4.1-mini-2025-04-14", "candidate": "gpt-4.1-mini-2025-04-14", "embedding": "text-embedding-3-small"}
RUNTIME_EXCLUSIONS = frozenset({
    "research/goalspec/src/goalspec/report_v4.py", "research/goalspec/scripts/report_native_v4.py",
    "research/goalspec/src/goalspec/archive_v4.py", "research/goalspec/scripts/export_native_v4.py",
    "scripts/goalspec-controller-native-v4-replay.ts", "research/goalspec/src/goalspec/controller_native_v4_report.py",
    "research/goalspec/src/goalspec/controller_v4.py", "research/goalspec/scripts/train_controller_v4.py",
    "research/goalspec/scripts/evaluate_controller_v4.py", "scripts/goalspec-controller-dataset.ts",
    "scripts/goalspec-controller-benchmark.ts", "scripts/goalspec-controller-replay.ts", "scripts/goalspec-controller-generate.ts",
    "research/goalspec/src/goalspec/archive_import_v4.py", "research/goalspec/scripts/import_native_archive_v4.py",
    "scripts/goalspec-import-archive-v4.ts",
})


def execution_sources(sources):
    """Explicit non-runtime training/report tools may evolve; loaded execution bytes may not."""
    return {name: value for name, value in sources.items() if category(name) == "execution" and name not in RUNTIME_EXCLUSIONS}


def validate_manifest(manifest):
    if manifest.get("generator") != "fresh-native-v4" or manifest.get("nativeCommit") != NATIVE_COMMIT:
        raise ValueError("Pinned fresh v4 fixture manifest required")
    if manifest.get("manifestHash") != digest({k: v for k, v in manifest.items() if k != "manifestHash"}):
        raise ValueError("Fixture manifest changed")
    if len(manifest["tasks"]) != 8 or len({task["taskId"] for task in manifest["tasks"]}) != 8:
        raise ValueError("V4 stage requires four families with two variants")
    for task in manifest["tasks"]:
        if task["fixtureHash"] != digest({k: v for k, v in task.items() if k != "fixtureHash"}):
            raise ValueError("Fixture content changed")


def make_design(manifest, budget_report, development=(), seed=20260918):
    validate_manifest(manifest)
    stage = manifest["studyStage"]
    phase = "development" if stage == "development" else "heldout"
    if stage not in {"development", "confirmation"}:
        raise ValueError("Unsupported v4 stage")
    allocation = next(row for row in budget_report["allocations"] if row["allocation"] == phase)
    expected_ceiling = 40 if phase == "development" else 240
    if budget_report.get("totalCeilingUsd") != 500 or allocation["ceilingUsd"] != expected_ceiling:
        raise ValueError("Original shared budget ceilings required")
    available = math.floor((allocation["ceilingUsd"] - allocation["spentOrReservedUsd"]) * 1_000_000 + 1e-6)
    if stage == "development":
        allowance, repeats, variants = 1.25, 1, (0,)
        family_count = 4
    else:
        if not development or len(development) != 16 or any(row.get("studyId") != manifest["studyId"]
                or row.get("studyStage") != "development" for row in development):
            raise ValueError("All sixteen same-study development outcomes are required")
        blocks = {}
        for row in development:
            key = (row.get("family", row.get("familyId")), row.get("variant"), row.get("trial"))
            blocks.setdefault(key, []).append(row)
        if len(blocks) != 4 or any(key[1:] != (0, 0) or len(rows) != 4 or {row.get("arm") for row in rows} != set(ARMS)
                or len({row.get("seed") for row in rows}) != 1 for key, rows in blocks.items()):
            raise ValueError("Development results do not cover a complete paired grid")
        costs = [row["billedUsd"] for row in development if row.get("billedUsd") is not None and not row.get("budget_terminated")]
        if not costs:
            raise ValueError("No complete development cost calibration")
        censored = any(row.get("billedUsd") is None or row.get("budget_terminated") for row in development)
        allowance = max(1.25, math.ceil(1.25 * max(costs) * 4) / 4, 2.5 if censored else 0)
        repeats, variants = 2, (0, 1)
        family_count = min(4, 2 * (available // round(32 * allowance * 1_000_000)))
        if family_count < 2:
            raise ValueError("Budget cannot reserve a balanced confirmation cohort")
    families = []
    for domain in ("retail", "airline"):
        eligible = {task["familyId"] for task in manifest["tasks"] if task["domain"] == domain}
        families.extend(sorted(eligible, key=lambda family: digest([seed, family]))[:family_count // 2])
    rng, trials = random.Random(seed), []
    tasks = {(task["familyId"], task["variant"]): task for task in manifest["tasks"]}
    for family in families:
        for variant in variants:
            task = tasks[family, variant]
            for repeat in range(repeats):
                order = list(ARMS)
                rng.shuffle(order)
                trial_seed = rng.randrange(2**31)
                trials.extend({"family": family, "taskId": task["taskId"], "domain": task["domain"], "variant": variant,
                               "trial": repeat, "seed": trial_seed, "arm": arm, "reserved_usd": allowance} for arm in order)
    reserved = round(len(trials) * allowance * 1_000_000)
    if reserved > available:
        raise ValueError("Insufficient allocation headroom for every paired slot")
    design = {"version": "goalspec-live-v4", "studyId": manifest["studyId"], "studyStage": stage, "phase": phase,
              "fixtureManifestHash": manifest["manifestHash"], "label": "custom tau-compatible pilot", "models": MODELS,
              "trials": trials, "families": families, "reserved_usd": reserved / 1_000_000, "allowance_usd": allowance,
              "maxSteps": 200, "maxErrors": 10, "trialTimeoutSeconds": 600, "localConcurrency": 1,
              "userProtocol": "unchanged-upstream-user-simulator", "seed": seed,
              "confirmationSizing": "development costs only; minimum1.25, rounded-up quarter-dollar 1.25*max, censored minimum2.50; complete balanced families"}
    design["designHash"] = digest(design)
    return design


def prepare_plan(manifest_path, records_path, memory_path, configuration_path, budget_report_path,
                 budget_directory, output, plan_directory, development_path=None, seed=20260918):
    manifest = read(manifest_path)
    study_path = manifest_path.parent.parent / "study.json"
    study = read(study_path)
    if (study.get("version") != "goalspec-custom-study-v4" or study.get("studyId") != manifest["studyId"]
            or study.get("studyHash") != digest({key: value for key, value in study.items() if key != "studyHash"})
            or Path(study["fixtures"][manifest["studyStage"]]["path"]).resolve() != manifest_path.resolve()
            or study["fixtures"][manifest["studyStage"]]["manifestHash"] != manifest["manifestHash"]):
        raise ValueError("V4 split study identity or fixture lineage changed")
    claim_path = study_path.parent / f"{manifest['studyStage']}-claim.json"
    if claim_path.exists():
        raise ValueError("This v4 stage was already claimed")
    development = [json.loads(line) for line in development_path.read_text(encoding="utf-8").splitlines() if line] if development_path else []
    design = make_design(manifest, read(budget_report_path), development, seed)
    if not (budget_directory / "budget.jsonl").is_file() or output.exists():
        raise ValueError("Existing shared budget and unused output required")
    configuration = read(configuration_path)
    controller_path = Path(configuration["controllerPath"]).resolve(strict=True)
    expected = {"toolMs", "validationMs", "schedulingMs", "predictionMs", "contentionMs", "contextMs", "measuredExposureBenefitMs"}
    if set(configuration["estimate"]) != expected or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0
                                                         for value in configuration["estimate"].values()):
        raise ValueError("Invalid v4 cost estimates")
    if design["studyStage"] == "confirmation" and configuration.get("experiment"):
        raise ValueError("Confirmation must use the frozen selected policy, not randomized exposure exploration")
    for task in manifest["tasks"]:
        if preflight(task) != manifest["checks"][task["taskId"]]:
            raise ValueError("Independent native preflight drift")
    native_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT / "research/goalspec/.benchmarks/tau3", text=True).strip()
    if native_head != NATIVE_COMMIT:
        raise ValueError("Native source revision drift")
    inputs = {"study": study_path, "fixtures": manifest_path, "records": records_path, "memory": memory_path, "configuration": configuration_path,
              "controller": controller_path, "budget_report": budget_report_path}
    if configuration.get("actionKindPath"):
        inputs["action_kind_controller"] = Path(configuration["actionKindPath"]).resolve(strict=True)
    if development_path:
        inputs["development_outcomes"] = development_path
    input_hashes = {name: {"path": str(path.resolve(strict=True)), "sha256": file_digest(path)} for name, path in inputs.items()}
    sources = collect_sources(ROOT)
    # A report or documentation file can change concurrently. Capture once so
    # archived bytes and manifest hashes always describe the same observation.
    source_bytes = {name: path.read_bytes() for name, path in sources.items()}
    source_hashes = {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in source_bytes.items()}
    plan_directory.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(plan_directory / "source.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(source_bytes.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    plan = {"version": "goalspec-dispatch-v4", "design": design, "inputs": input_hashes, "sources": source_hashes,
            "runtimeSources": execution_sources(source_hashes), "runtimeSourceTreeHash": digest(execution_sources(source_hashes)),
            "runtimeVerificationPolicy": {"includedCategory": "execution", "explicitExclusions": sorted(RUNTIME_EXCLUSIONS),
                                          "archive": "all captured source bytes retained for reproducibility"},
            "sourceArchiveSha256": file_digest(plan_directory / "source.zip"), "outputPath": str(output.resolve()),
            "budgetDirectory": str(budget_directory.resolve()), "sourceTreeHash": digest(source_hashes),
            "claimPath": str(claim_path.resolve()),
            "providerOwnership": "existing shared Node ledger; whole-cohort reserveMany before readiness and first dispatch"}
    plan["planHash"] = digest(plan)
    verify_plan(plan, plan_directory)
    write(plan_directory / "plan.json", plan)
    write(claim_path, {"version": "goalspec-stage-claim-v4", "planPath": str((plan_directory / "plan.json").resolve()),
                       "planSha256": file_digest(plan_directory / "plan.json"), "outputPath": str(output.resolve()),
                       "studyId": manifest["studyId"], "stage": manifest["studyStage"]})
    return plan


def verify_source_archive(path, sources):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(sources):
            raise ValueError("Frozen source archive membership changed")
        for name, record in sources.items():
            data = archive.read(name)
            if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
                raise ValueError("Frozen source archive bytes differ from manifest")


def verify_plan(plan, plan_directory):
    if plan.get("version") != "goalspec-dispatch-v4" or plan.get("planHash") != digest({k: v for k, v in plan.items() if k != "planHash"}):
        raise ValueError("Plan integrity failure")
    if file_digest(plan_directory / "source.zip") != plan["sourceArchiveSha256"]:
        raise ValueError("Frozen source archive changed")
    verify_source_archive(plan_directory / "source.zip", plan["sources"])
    current = collect_sources(ROOT)
    runtime = execution_sources(current)
    if (set(runtime) != set(plan["runtimeSources"]) or digest(plan["sources"]) != plan["sourceTreeHash"]
            or digest(plan["runtimeSources"]) != plan["runtimeSourceTreeHash"]
            or plan["runtimeSources"] != execution_sources(plan["sources"])):
        raise ValueError("Frozen execution source membership changed")
    if any(file_digest(runtime[name]) != record["sha256"] for name, record in plan["runtimeSources"].items()):
        raise ValueError("Frozen execution source bytes changed")
    if any(file_digest(Path(record["path"])) != record["sha256"] for record in plan["inputs"].values()):
        raise ValueError("Frozen input changed")
    if not (Path(plan["budgetDirectory"]) / "budget.jsonl").is_file():
        raise ValueError("Shared ledger unavailable")
    return True


def _failure_row(design, run_id, trial, snapshot_id, reason):
    return {"schemaVersion": "1.0.0", "experimentId": f"custom-v4:{design['studyId']}:{design['studyStage']}:{design['designHash'][:16]}",
            "snapshotId": snapshot_id, "runId": run_id, "studyId": design["studyId"], "studyStage": design["studyStage"],
            "family": trial["family"], "familyId": trial["family"], "taskId": trial["taskId"], "domain": trial["domain"],
            "variant": trial["variant"], "trial": trial["trial"], "seed": trial["seed"], "arm": trial["arm"],
            "reservedUsd": trial["reserved_usd"], "label": "custom tau-compatible pilot", "upstreamRevision": NATIVE_COMMIT,
            "success": False, "officialReward": None, "termination": reason, "budget_terminated": False,
            "latencyMs": None, "totalTrialSeconds": None, "serviceDrainSucceeded": False,
            "authoritativeCalls": 0, "speculativeCalls": 0, "usefulCalls": 0, "freshnessChecks": 0,
            "revalidationCalls": 0, "constraintViolations": None, "billedUsd": None,
            "knownUsageSubtotalUsd": 0, "unknownProviderCharge": True}


def completed_success(verdict, native_termination, failure):
    return bool(verdict["success"] and failure is None and native_termination in {"user_stop", "agent_stop"})


def run_plan(plan_path, expected_sha256):
    if file_digest(plan_path) != expected_sha256:
        raise ValueError("Exact dispatch plan hash required")
    plan = read(plan_path)
    verify_plan(plan, plan_path.parent)
    claim = read(Path(plan["claimPath"]))
    if (Path(claim["planPath"]).resolve() != plan_path.resolve() or claim["planSha256"] != expected_sha256
            or claim["outputPath"] != plan["outputPath"]):
        raise ValueError("Single-use stage claim mismatch")
    # Native imports may not discover credential files or fetch pricing metadata.
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    os.environ["LOGURU_LEVEL"] = "ERROR"
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    os.environ["TAU2_DATA_DIR"] = str(ROOT / "research/goalspec/.benchmarks/tau3/data")
    from tau2.agent.llm_agent import AGENT_INSTRUCTION
    from tau2.data_model.tasks import Task, UserScenario
    from tau2.orchestrator.orchestrator import Orchestrator

    from goalspec.adapters.step_gateway import StepBroker, server
    from goalspec.adapters.tau_external_agent import ExternalGoalSpecAgent
    from goalspec.adapters.tau_snapshot import ALLOWED, NativeSnapshotEnvironment
    from goalspec.official_native import api_actor_instruction, native_ports, service_manifest_hash

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
                self.native_timings.append({"operation": "speculative_snapshot_wrapper", "tool": tool, "isRead": True,
                                            "durationMs": 1000 * (time.perf_counter() - started)})

        def refresh(self, lease, tool, arguments):
            self.refresh_calls += 1
            return super().refresh(lease, tool, arguments)

    design, inputs = plan["design"], plan["inputs"]
    output, budget_directory = Path(plan["outputPath"]), Path(plan["budgetDirectory"])
    fixtures = read(Path(inputs["fixtures"]["path"]))
    validate_manifest(fixtures)
    records = read(Path(inputs["records"]["path"]))
    snapshots = {record["pattern"]["snapshotId"] for record in records}
    if len(snapshots) != 1:
        raise ValueError("Exactly one frozen workflow snapshot required")
    snapshot_id = next(iter(snapshots))
    task_index = {task["taskId"]: task for task in fixtures["tasks"]}
    entries, configured, reads, contexts = [], [], {}, {}
    instruction = api_actor_instruction(AGENT_INSTRUCTION)
    for index, trial in enumerate(design["trials"]):
        fixture = task_index[trial["taskId"]]
        if preflight(fixture) != fixtures["checks"][fixture["taskId"]]:
            raise ValueError("Pre-dispatch independent target changed")
        run_id = f"v4-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}"
        environment = CountedEnvironment(native_environment(fixture))
        tools = [tool.openai_schema for tool in environment.get_tools()]
        contexts[run_id] = {"policy": instruction + "\n\n" + environment.get_policy(), "tools": tools, "capturedBeforeExecution": True}
        configured.append({"runId": run_id, "arm": trial["arm"], "domain": trial["domain"], "allocation": design["phase"],
                           "maxCostMicrodollars": round(trial["reserved_usd"] * 1_000_000), "maxBoundaries": design["maxSteps"], "tools": tools})
        entries.append((run_id, trial, fixture, environment))
    output.mkdir(parents=True, exist_ok=False)
    write(output / "dispatch-plan.json", plan)
    write(output / "design.json", design)
    manifest = {"schemaVersion": 1, "snapshotId": snapshot_id, "heldoutFamilies": design["families"], "runs": configured,
                "runtimeVersion": "v4", "recordsPath": inputs["records"]["path"], "memoryPath": inputs["memory"]["path"],
                "v4Configuration": read(Path(inputs["configuration"]["path"])), "awaitReady": True, "perRunCloseAcknowledgement": True,
                "maxDecisions": (design["maxSteps"] * 2 + 4) * len(entries), "studyId": design["studyId"], "studyStage": design["studyStage"]}
    write(output / "service-manifest.json", manifest)
    write(output / "public-contexts.json", contexts)
    manifest_hash = service_manifest_hash(output / "service-manifest.json")
    broker = StepBroker(expected_manifest_hash=manifest_hash)
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    rows, process, startup_failure, ready_at, startup_seconds = [], None, None, None, None
    started = time.perf_counter()
    with (output / "service.log").open("x", encoding="utf-8") as log, (output / "outcomes.jsonl").open("x", encoding="utf-8") as results:
        try:
            verify_plan(plan, plan_path.parent)
            process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-service.ts", "services/goalspec-runtime/research-bootstrap.ts",
                                        str(budget_directory)], cwd=ROOT, stdout=log, stderr=log,
                env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token,
                     "GOALSPEC_MANIFEST_PATH": str((output / "service-manifest.json").resolve())})
            def monitor():
                process.wait()
                broker.close()
            threading.Thread(target=monitor, daemon=True).start()
            try:
                ready_at = broker.wait_ready(timeout=600)
            except Exception as error:
                startup_failure = type(error).__name__
            startup_seconds = (ready_at or time.perf_counter()) - started
            write(output / "service-readiness.json", {"ready": ready_at is not None, "manifestHash": manifest_hash,
                  "serviceStartupSeconds": startup_seconds, "errorType": startup_failure, "trialClocksStartedAfterReady": ready_at is not None})
            for run_id, trial, fixture, environment in entries:
                row = _failure_row(design, run_id, trial, snapshot_id, "service_startup_error" if startup_failure else "execution_error")
                artifact = {"record": row, "independentCheck": fixtures["checks"][fixture["taskId"]]}
                try:
                    if startup_failure:
                        raise RuntimeError("Service failed before readiness")
                    verify_plan(plan, plan_path.parent)
                    reads[run_id] = environment
                    task = Task(id=fixture["taskId"], user_scenario=UserScenario(instructions=fixture["userInstructions"]))
                    actor = ExternalGoalSpecAgent(environment.get_tools(), environment.get_policy(), broker, run_id, environment, instruction)
                    user, _unused_evaluator = native_ports(broker, run_id, task, MODELS)
                    orchestrator = Orchestrator(domain=trial["domain"], agent=actor, user=user, environment=environment, task=task,
                                               max_steps=design["maxSteps"], max_errors=design["maxErrors"], seed=trial["seed"], timeout=design["trialTimeoutSeconds"])
                    trial_started, failure, simulation = time.perf_counter(), None, None
                    try:
                        simulation = orchestrator.run()
                        native_termination = simulation.termination_reason.value
                    except Exception as error:
                        failure = "budget_exhausted" if "budget" in str(error).lower() else "execution_error"
                        native_termination = failure
                        artifact["exceptionType"] = type(error).__name__
                    native_seconds = time.perf_counter() - trial_started
                    drain = drain_trial(broker, run_id, trial_started, native_seconds)
                    failure = failure or (None if drain["serviceDrainSucceeded"] else "service_drain_error")
                    messages = orchestrator.get_messages()
                    evaluation_started = time.perf_counter()
                    verdict = verify_outcome(fixture, fixtures["checks"][fixture["taskId"]], environment, messages)
                    evaluation_seconds = time.perf_counter() - evaluation_started
                    useful = sum(event["status"] == "consumed" for event in environment.promotion_events)
                    row.update({"success": completed_success(verdict, native_termination, failure), "termination": failure or native_termination,
                                "nativeTermination": native_termination, "latencyMs": 1000 * native_seconds, **drain,
                                "evaluationSeconds": evaluation_seconds, "totalIncludingEvaluationSeconds": time.perf_counter() - trial_started,
                                "constraintViolations": verdict["constraintViolations"], "constraintStatus": "custom_verifier_not_exhaustive_policy_audit",
                                "budget_terminated": failure == "budget_exhausted", "authoritativeCalls": environment.authoritative_calls,
                                "speculativeCalls": environment.speculative_calls, "usefulCalls": useful,
                                "unpromotedCalls": max(0, environment.speculative_calls - useful), "freshnessChecks": environment.refresh_calls,
                                "revalidationCalls": 0, "fixtureHash": fixture["fixtureHash"], "serviceReadyBeforeTrial": True,
                                **telemetry(budget_directory, run_id, drain["serviceDrainSucceeded"])})
                    artifact.update({"simulation": simulation.model_dump(mode="json") if simulation else {"messages": [message.model_dump(mode="json") for message in messages]},
                                     "verdict": verdict, "promotionEvents": environment.promotion_events, "nativeToolTimings": environment.native_timings,
                                     "userSimulatorPrompt": {"policy": user.system_prompt, "policyHash": digest(user.system_prompt), "protocol": "unchanged-upstream-user-simulator"},
                                     "finalDatabase": environment.tools.db.model_dump(mode="json")})
                except Exception as error:
                    artifact["exceptionType"] = type(error).__name__
                    for worker in (run_id, run_id + ":user"):
                        try:
                            broker.finish(worker)
                        except Exception:
                            pass
                    row.update(telemetry(budget_directory, run_id, False))
                finally:
                    reads.pop(run_id, None)
                write(output / f"{run_id}.json", artifact)
                results.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                results.flush()
                os.fsync(results.fileno())
                rows.append(row)
                print(json.dumps({"stage": design["studyStage"], "completed": len(rows), "total": len(entries), "arm": trial["arm"],
                                  "success": row["success"], "cost": row["billedUsd"], "termination": row["termination"]}), flush=True)
        finally:
            # Even startup aborts consume every declared slot. No task is replaced.
            for run_id, trial, _fixture, _environment in entries[len(rows):]:
                row = _failure_row(design, run_id, trial, snapshot_id, "stage_aborted_before_slot")
                row.update(telemetry(budget_directory, run_id, False))
                write(output / f"{run_id}.json", {"record": row})
                results.write(json.dumps(row) + "\n")
                results.flush()
                os.fsync(results.fileno())
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
            final_drain_seconds = time.perf_counter() - final_started
    summary = {"version": "goalspec-live-v4", "studyId": design["studyId"], "studyStage": design["studyStage"], "designHash": design["designHash"],
               "label": "custom tau-compatible pilot", "counts": dict(Counter(row["arm"] for row in rows)), "successes": sum(row["success"] for row in rows),
               **summarize_costs(rows), "serviceExitCode": process.returncode if process is not None else None,
               "serviceStartupSeconds": startup_seconds, "finalServiceDrainSeconds": final_drain_seconds,
               "startupOutsideTrialClocks": True, "independentVerifierOutsideLiveLatency": True, "userProtocol": "unchanged-upstream-user-simulator"}
    write(output / "summary.json", summary)
    return summary
