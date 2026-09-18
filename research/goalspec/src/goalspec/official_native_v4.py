"""Frozen v4 runtime on original pinned tau3 tasks; no benchmark retuning."""
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

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.fresh_tasks import digest
from goalspec.native_live import drain_trial, summarize_costs, telemetry
from goalspec.native_live_v4 import MODELS, RUNTIME_EXCLUSIONS, verify_source_archive
from goalspec.official_native import (
    api_actor_instruction,
    clone_with_globals,
    evaluator_usage,
    native_ports,
    retain_slot_failure,
    service_manifest_hash,
)
from goalspec.source_freeze import category, collect_sources, file_digest
from goalspec.study_v2 import read, write
from goalspec.study_v3 import ARMS, REVISION, ROOT, source_inventory

VERSION = "official-tau-v4-dispatch-v1"
LABEL = "Pinned official tau3 retail/airline task subset with custom frozen v4 agent scaffold"
EXCLUSIONS = RUNTIME_EXCLUSIONS | frozenset({
    "research/goalspec/src/goalspec/report_official_v4.py",
    "research/goalspec/scripts/report_official_native_v4.py",
})


def execution_sources(sources):
    return {name: value for name, value in sources.items()
            if category(name) == "execution" and name not in EXCLUSIONS}


def declared_trials(study, design):
    return [(f"official-v4-{digest(study['studyId'])[:10]}-{index:04d}-{digest([design['designHash'], trial])[:12]}", trial)
            for index, trial in enumerate(design["trials"])]


def calibrated_allowance(cohorts):
    """Read costs only from complete paired development grids, never confirmation."""
    if len(cohorts) != 2:
        raise ValueError("Both official-v3 and custom-v4 development calibration required")
    costs, censored, kinds = [], False, set()
    for summary, design, rows in cohorts:
        stage = design.get("studyStage")
        if stage not in {"development-3", "development"} or summary.get("studyStage") != stage:
            raise ValueError("Only declared development costs may calibrate this cohort")
        kinds.add(stage)
        if len(rows) != 16 or len({row["runId"] for row in rows}) != 16 or len(design["trials"]) != 16:
            raise ValueError("Calibration requires all sixteen declared trial outcomes")
        fields = ("family", "domain", "taskId", "variant", "trial", "seed", "arm")
        if Counter(tuple(row[k] for k in fields) for row in rows) != Counter(tuple(row[k] for k in fields) for row in design["trials"]):
            raise ValueError("Calibration outcome grid differs from declared design")
        groups = {}
        for row in rows:
            if row.get("studyStage") != stage or row.get("studyId") != design.get("studyId"):
                raise ValueError("Calibration study identity mismatch")
            groups.setdefault((row["domain"], row["family"], row["variant"], row["trial"], row["seed"]), []).append(row["arm"])
            cost = row.get("billedUsd")
            bad = row.get("unknownProviderCharge") or row.get("budget_terminated") or cost is None
            censored |= bool(bad)
            if not bad:
                if type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0:
                    raise ValueError("Invalid development cost")
                costs.append(cost)
        if len(groups) != 4 or any(Counter(arms) != Counter(ARMS) for arms in groups.values()):
            raise ValueError("Calibration must contain four complete paired task blocks")
    if kinds != {"development-3", "development"} or not costs:
        raise ValueError("Both calibration types and at least one measured cost required")
    allowance = math.ceil(4 * max(1.25, 1.25 * max(costs), 2.5 if censored else 0)) / 4
    return allowance, {"largestCompletedCostUsd": max(costs), "censored": censored, "completedCosts": len(costs),
                       "uses": "Only completed official-v3 development-3 and custom-v4 development costs; no model or policy tuning"}


def make_design(selection, budget, cohorts):
    if selection.get("version") != "official-tau-v4-id-selection-v1" or selection.get("upstreamRevision") != REVISION:
        raise ValueError("Pinned ID-only selection required")
    selected = selection["selectedByDomain"]
    if set(selected) != {"retail", "airline"} or any(len(ids) != 7 or len(set(ids)) != 7 or
            any(not isinstance(item, str) for item in ids) for ids in selected.values()):
        raise ValueError("Seven distinct string task IDs per domain required")
    allocation = next(item for item in budget["allocations"] if item["allocation"] == "heldout")
    if budget.get("totalCeilingUsd") != 500 or allocation["ceilingUsd"] != 240:
        raise ValueError("Original total and heldout ceilings required")
    available = math.floor((allocation["ceilingUsd"] - allocation["spentOrReservedUsd"]) * 1_000_000 + 1e-6)
    allowance, calibration = calibrated_allowance(cohorts)
    count = min(14, 2 * (available // round(16 * allowance * 1_000_000)))
    if count < 2:
        raise ValueError("Insufficient headroom for a balanced fully paired cohort")
    rng = random.Random(selection["seed"])
    tasks = [(domain, identifier) for domain in ("retail", "airline") for identifier in selected[domain][:count // 2]]
    rng.shuffle(tasks)
    order, trials = list(ARMS), []
    rng.shuffle(order)
    for block, (domain, identifier, repeat) in enumerate((d, i, t) for d, i in tasks for t in (0, 1)):
        trial_seed = rng.randrange(2**31)
        rotation = block % 4
        for arm in order[rotation:] + order[:rotation]:
            trials.append({"family": f"{domain}:official:{identifier}", "domain": domain, "taskId": identifier,
                           "variant": 0, "trial": repeat, "seed": trial_seed, "arm": arm, "reserved_usd": allowance})
    design = {"version": VERSION, "studyId": selection["studyId"], "studyStage": "confirmation", "phase": "heldout",
              "label": LABEL, "models": MODELS, "trials": trials, "families": sorted({t["family"] for t in trials}),
              "tasks": count, "allowance_usd": allowance, "reserved_usd": len(trials) * allowance,
              "maxSteps": 200, "maxErrors": 10, "trialTimeoutSeconds": 600, "localConcurrency": 1,
              "costCalibration": calibration, "seed": selection["seed"], "selectionUsesOutcomes": False,
              "evaluation": {"type": "ALL", "strictReplay": True, "rewardBasis": "unchanged original task"},
              "timing": {"startupSeparate": True, "liveIncludesActorUserDrain": True, "judgeOutsideLiveLatency": True}}
    design["designHash"] = digest(design)
    return design


def prepare_plan(selection_path, calibration_directories, previous_dispatch_plan, previous_service_manifest,
                 budget_report_path, budget_directory, output, plan_directory):
    paths = {"selection": selection_path, "previous_dispatch": previous_dispatch_plan,
             "previous_service_manifest": previous_service_manifest, "budget_report": budget_report_path}
    cohorts = []
    for index, directory in enumerate(calibration_directories):
        for name in ("summary.json", "design.json", "outcomes.jsonl"):
            paths[f"calibration_{index}_{name}"] = directory / name
        cohorts.append((read(directory / "summary.json"), read(directory / "design.json"),
                        [json.loads(line) for line in (directory / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]))
    selection, prior = read(selection_path), read(previous_dispatch_plan)
    if selection.get("selectionHash") != digest({k: v for k, v in selection.items() if k != "selectionHash"}):
        raise ValueError("ID selection manifest changed")
    for index, record in enumerate(selection["sourceFiles"]):
        path = Path(record["path"])
        if not path.is_absolute():
            path = ROOT / path
        if file_digest(path) != record["sha256"]:
            raise ValueError("Selection ancestry source changed")
        paths[f"selection_source_{index}"] = path
    if prior.get("version") != "goalspec-dispatch-v4" or prior.get("planHash") != digest({k: v for k, v in prior.items() if k != "planHash"}):
        raise ValueError("Original v4 runtime freeze is invalid")
    if any(file_digest(ROOT / name) != record["sha256"] for name, record in prior["runtimeSources"].items()):
        raise ValueError("Frozen v4 runtime changed; this benchmark permits no retuning")
    for index, record in enumerate(prior["inputs"].values()):
        if file_digest(Path(record["path"])) != record["sha256"]:
            raise ValueError("Previous frozen controller/configuration input changed")
        paths[f"previous_input_{index}"] = Path(record["path"])
    manifest = read(previous_service_manifest)
    if manifest.get("runtimeVersion") != "v4" or manifest.get("studyId") != prior["design"]["studyId"]:
        raise ValueError("Previous manifest is not the frozen v4 cohort")
    if any(Path(manifest[field]).resolve() != Path(prior["inputs"][key]["path"]).resolve()
           for field, key in (("recordsPath", "records"), ("memoryPath", "memory"))):
        raise ValueError("Previous manifest repository/memory differs from frozen inputs")
    configuration = manifest["v4Configuration"]
    if configuration.get("experiment") or configuration != read(Path(prior["inputs"]["configuration"]["path"])):
        raise ValueError("Exact frozen confirmation policy without exploration required")
    # Absence preserves the already frozen research-bootstrap default verbatim.
    baseline = manifest.get("sessionConfiguration")
    if baseline is not None:
        raise ValueError("Frozen custom-v4 confirmation used the unchanged bootstrap baseline defaults")
    upstream = ROOT / "research/goalspec/.benchmarks/tau3"
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=upstream, text=True).strip() != REVISION:
        raise ValueError("Pinned native revision changed")
    for index, record in enumerate(source_inventory(upstream)):
        paths[f"upstream_{index}"] = Path(record["path"])
    for domain, ids in selection["selectedByDomain"].items():
        splits = read(upstream / f"data/tau2/domains/{domain}/split_tasks.json")
        if not set(ids) <= set(map(str, splits["test"])):
            raise ValueError("Selected IDs must belong to the upstream test split")
    paths["records"], paths["memory"] = Path(manifest["recordsPath"]), Path(manifest["memoryPath"])
    design = make_design(selection, read(budget_report_path), cohorts)
    study = {"version": VERSION, "studyId": design["studyId"], "label": LABEL, "upstreamRevision": REVISION,
             "upstreamRoot": str(upstream.resolve()), "models": MODELS, "maxSteps": 200, "maxErrors": 10,
             "trialTimeoutSeconds": 600, "frozenLibrary": {"recordsPath": str(paths["records"])},
             "frozenExperienceMemory": {"path": str(paths["memory"])},
             "historicalExposure": selection.get("ancestry"), "selectionPath": str(selection_path.resolve())}
    study["studyHash"] = digest(study)
    design["studyHash"] = study["studyHash"]
    design["designHash"] = digest({k: v for k, v in design.items() if k != "designHash"})
    if output.exists() or plan_directory.exists() or not (budget_directory / "budget.jsonl").is_file():
        raise ValueError("Unused plan/output paths and the existing shared ledger required")
    source_bytes = {name: path.read_bytes() for name, path in collect_sources(ROOT).items()}
    sources = {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in source_bytes.items()}
    inputs = {key: {"path": str(path.resolve(strict=True)), "sha256": file_digest(path)} for key, path in paths.items()}
    plan_directory.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(plan_directory / "source.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(source_bytes.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type, entry.external_attr = zipfile.ZIP_DEFLATED, 0o100644 << 16
            archive.writestr(entry, data)
    plan = {"version": VERSION, "study": study, "design": design, "v4Configuration": configuration,
            "baselineSessionConfiguration": baseline, "inputs": inputs, "sources": sources,
            "runtimeSources": execution_sources(sources), "sourceArchiveSha256": file_digest(plan_directory / "source.zip"),
            "outputPath": str(output.resolve()), "budgetDirectory": str(budget_directory.resolve()),
            "excludedNonRuntimeSources": sorted(EXCLUSIONS),
            "providerOwnership": "Existing shared Node ledger; reserve every paired run before readiness and dispatch"}
    plan["planHash"] = digest(plan)
    write(plan_directory / "study.json", study)
    write(plan_directory / "design.json", design)
    write(plan_directory / "plan.json", plan)
    verify_plan(plan, plan_directory)
    return plan


def verify_runtime_files(plan):
    runtime = execution_sources(collect_sources(ROOT))
    if set(runtime) != set(plan["runtimeSources"]) or plan["runtimeSources"] != execution_sources(plan["sources"]):
        raise ValueError("Frozen runtime membership changed")
    if any(file_digest(runtime[name]) != record["sha256"] for name, record in plan["runtimeSources"].items()):
        raise ValueError("Frozen runtime bytes changed")
    if any(file_digest(Path(record["path"])) != record["sha256"] for record in plan["inputs"].values()):
        raise ValueError("Frozen official benchmark input changed")
    return True


def verify_plan(plan, directory):
    if plan.get("version") != VERSION or plan.get("planHash") != digest({k: v for k, v in plan.items() if k != "planHash"}):
        raise ValueError("Official-v4 plan integrity failure")
    if file_digest(directory / "source.zip") != plan["sourceArchiveSha256"]:
        raise ValueError("Frozen source archive changed")
    verify_source_archive(directory / "source.zip", plan["sources"])
    verify_runtime_files(plan)
    if read(directory / "study.json") != plan["study"] or read(directory / "design.json") != plan["design"]:
        raise ValueError("Derived study/design changed")
    return True


def run_plan(plan_path, expected_sha256):
    if file_digest(plan_path) != expected_sha256:
        raise ValueError("Exact official dispatch plan SHA256 required")
    plan = read(plan_path)
    verify_plan(plan, plan_path.parent)
    output, budget = Path(plan["outputPath"]), Path(plan["budgetDirectory"])
    if output.exists():
        raise ValueError("Official cohort output already consumed")
    write(plan_path.parent / "dispatch.json", {"planSha256": expected_sha256, "singleUse": True})
    try:
        result = run_stage(plan["study"], plan["design"], plan["v4Configuration"],
                           plan["baselineSessionConfiguration"], output, budget,
                           verify_runtime=lambda: verify_runtime_files(plan))
    except Exception as error:
        from goalspec.official_native import retain_stage_failure
        retain = clone_with_globals(retain_stage_failure, {"declared_trials": declared_trials})
        retain(plan_path.parent, plan_path.parent / "design.json", output, budget, error)
        if not (output / "dispatch-plan.json").exists():
            write(output / "dispatch-plan.json", plan)
        raise
    write(output / "dispatch-plan.json", plan)
    return result


def run_stage(study, design, configuration, baseline_configuration, output, budget_directory, *, verify_runtime=None):
    """Run each declared official task once per arm/seed after service readiness."""
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
        "runtimeVersion": "v4", "memoryPath": study["frozenExperienceMemory"]["path"], "v4Configuration": configuration,
        "runs": configured, "recordsPath": study["frozenLibrary"]["recordsPath"], "awaitReady": True,
        "studyId": study["studyId"], "studyStage": design["studyStage"], "studyHash": study["studyHash"],
        "perRunCloseAcknowledgement": True, "maxDecisions": (study["maxSteps"] * 2 + 4) * len(trials)}
    if baseline_configuration is not None:
        service_manifest["sessionConfiguration"] = baseline_configuration
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
            if verify_runtime is not None:
                verify_runtime()
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
                    ready_at = broker.wait_ready(timeout=600)
            except Exception as error:
                startup_failure = type(error).__name__
            startup_seconds = (ready_at or time.perf_counter()) - started
            write(output / "service-readiness.json", {"ready": ready_at is not None, "serviceStartupSeconds": startup_seconds,
                "manifestHash": manifest_hash, "errorType": startup_failure, "trialClocksStartedAfterReady": ready_at is not None})
            with (output / "outcomes.jsonl").open("x", encoding="utf-8") as results:
                for run_id, trial in trials:
                    if verify_runtime is not None:
                        verify_runtime()
                    row = {"schemaVersion": "1.0.0", "experimentId": f"official-v4:{study['studyId']}:{design['studyStage']}:{design['designHash'][:16]}",
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
                            row.update({"success": bool(reward is not None and reward.reward == 1 and failure is None
                                                       and native_termination in {"user_stop", "agent_stop"}),
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
                                "speculativeCalls": environment.speculative_calls, "usefulCalls": useful, "unpromotedCalls": environment.speculative_calls - useful,
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
    summary = {"schemaVersion": 1, "version": VERSION, "studyId": study["studyId"], "studyStage": design["studyStage"], "studyHash": study["studyHash"],
        "designHash": design["designHash"], "label": study["label"], "counts": dict(Counter(row["arm"] for row in rows)),
        "successes": sum(row["success"] for row in rows), **summarize_costs(rows), "serviceExitCode": process.returncode if process is not None else None,
        "serviceStartupSeconds": startup_seconds, "serviceWallSeconds": time.perf_counter() - started,
        "finalServiceDrainSeconds": final_drain_seconds, "startupOutsideTrialClocks": True, "judgeOutsideLiveLatency": True,
        "evaluatorModel": study["models"]["teacher"], "upstreamDefaultEvaluatorModel": "gpt-4.1-2025-04-14"}
    write(output / "summary.json", summary)
    return summary
