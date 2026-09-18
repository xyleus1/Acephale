"""Precommitted four-arm study on unchanged pinned upstream tau task subsets."""
from __future__ import annotations

import json
import math
import random
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from goalspec.fresh_tasks import digest
from goalspec.live_design import MODELS, validate_completed_grid
from goalspec.study_v2 import file_hash, read, study_lock, write

ARMS = ("base", "paste", "salesforce", "goalspec")
STAGES = ("development-1", "development-2", "development-3", "confirmation")
ROOT = Path(__file__).resolve().parents[4]
UPSTREAM = ROOT / "research/goalspec/.benchmarks/tau3"
REVISION = "2174a603f6d014ef94473ffa95957f6ce27100db"


def validate_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) != {"eagerWaitMs", "maxCandidateCalls", "estimate"}:
        raise ValueError("Explicit complete v3 session configuration required")
    estimate = configuration["estimate"]
    names = {"toolMs", "validationMs", "schedulingMs", "exposedPredictionMs", "actorRoundMs"}
    if not isinstance(estimate, dict) or set(estimate) != names:
        raise ValueError("Complete admission latency estimates required")
    values = [configuration["eagerWaitMs"], configuration["maxCandidateCalls"], *estimate.values()]
    if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 2**53 - 1 for value in values):
        raise ValueError("Finite nonnegative configuration numbers required")
    if type(configuration["maxCandidateCalls"]) is not int or not 0 <= configuration["maxCandidateCalls"] <= 200 or configuration["eagerWaitMs"] > 5000:
        raise ValueError("Bounded candidate count and wait required")
    return configuration


def audit_memory(memory, official_ids):
    value = read(memory)
    allowed = {"v1-training", "v2-development-1", "v2-development-2"}
    runs = value.get("runs", [])
    if value.get("sourcePolicy") != "v1-training-plus-v2-development-only" or not runs:
        raise ValueError("Memory must declare the frozen training/development-only provenance")
    for run in runs:
        family = run.get("familyId", "")
        if run.get("stage") not in allowed or ":official:" in family or family in official_ids:
            raise ValueError("Official task or unapproved stage is present in frozen memory")
    sources = value.get("sourceFiles", [])
    if any("public-pilot" in source["path"] for source in sources):
        raise ValueError("Historical public benchmark traces cannot enter v3 memory")
    for source in sources:
        path = Path(source["path"])
        if file_hash(path if path.is_absolute() else ROOT / path) != source["sha256"]:
            raise ValueError("Frozen memory provenance source changed")
    return {"sourcePolicy": value["sourcePolicy"], "runs": len(runs), "stages": dict(Counter(run["stage"] for run in runs)),
            "sourceFilesVerified": len(sources), "officialTaskRuns": 0, "historicalPublicReplayTracesIncluded": False}


def source_inventory(upstream):
    """Bind task, policy, database, simulator, orchestrator and evaluator bytes."""
    paths = sorted((upstream / "src/tau2").rglob("*.py"))
    paths += sorted((upstream / "data/tau2/user_simulator").glob("*.md"))
    for domain in ("retail", "airline"):
        paths += [upstream / f"data/tau2/domains/{domain}/{name}" for name in ("tasks.json", "split_tasks.json", "db.json", "policy.md")]
    return [{"path": str(path.resolve()), "sha256": file_hash(path)} for path in paths]


def prepare_study(directory, study_id, records, prior_outcomes=(), seed=20260917, upstream=UPSTREAM, memory=None):
    """Choose ID-only disjoint subsets before examining their outcomes."""
    if directory.exists() or not study_id or not records.is_file():
        raise ValueError("New study directory, identity and frozen library required")
    memory = memory or ROOT / "research/goalspec/runs/local-memory-v3-20260915/artifact.json"
    if not memory.is_file():
        raise ValueError("Frozen v3 experience-memory artifact required")
    lock = read(ROOT / "research/goalspec/benchmarks.lock.json")["benchmarks"]["tau3"]
    if lock["revision"] != REVISION:
        raise ValueError("Pinned upstream revision changed")
    observed, lineage = set(), []
    for path in prior_outcomes:
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
        observed.update((row["domain"], str(row.get("taskId", row.get("task_id")))) for row in rows)
        if any(row.get("taskId", row.get("task_id")) is None for row in rows):
            raise ValueError("Historical lineage row has no task identity")
        lineage.append({"path": str(path.resolve()), "sha256": file_hash(path), "rows": len(rows)})
    pools, diagnostics, official_ids = {}, {}, set()
    for domain in ("retail", "airline"):
        data = upstream / f"data/tau2/domains/{domain}"
        tasks = read(data / "tasks.json")
        by_id = {str(task["id"]): task for task in tasks}
        official_ids.update(f"{domain}:{task_id}" for task_id in by_id)
        splits = read(data / "split_tasks.json")
        if len(by_id) != len(tasks) or set(splits["train"]) & set(splits["test"]):
            raise ValueError("Upstream task IDs or train/test disjointness changed")
        def ordered(split, domain=domain, splits=splits):
            return sorted((str(task_id) for task_id in splits[split]),
                          key=lambda task_id: digest([study_id, seed, domain, split, task_id]))
        development, confirmation = ordered("train")[:2], ordered("test")[:8]
        if len(development) != 2 or len(confirmation) != 8:
            raise ValueError("Insufficient official split tasks for balanced subsets")
        pools[domain] = {"development": development, "confirmation": confirmation}
        diagnostics[domain] = {"officialBaseTasks": len(splits["base"]), "officialTrainTasks": len(splits["train"]),
            "officialTestTasks": len(splits["test"]), "previouslyObservedOfficialIds": sorted(task_id for d, task_id in observed if d == domain and task_id in by_id),
            "selectedDevelopmentPreviouslyObservedIds": sorted(set(development) & {task_id for d, task_id in observed if d == domain}),
            "selectedConfirmationPreviouslyObservedIds": sorted(set(confirmation) & {task_id for d, task_id in observed if d == domain}),
            "rewardBasisCounts": dict(Counter("+".join(task["evaluation_criteria"]["reward_basis"]) for task in tasks))}
    memory_audit = audit_memory(memory, official_ids)
    study = {"schemaVersion": 1, "version": "official-tau-subset-v3", "studyId": study_id, "seed": seed,
        "createdAtUtc": datetime.now(UTC).isoformat(), "label": "Pinned upstream tau retail/airline subset with configured research models",
        "upstreamRevision": REVISION, "upstreamRoot": str(upstream.resolve()), "sourceInventory": source_inventory(upstream),
        "models": MODELS, "arms": list(ARMS), "maximumDevelopmentRounds": 3, "maximumConfirmationCohorts": 1,
        "tasks": pools, "taskPoolAudit": diagnostics, "priorOutcomeLineage": lineage,
        "frozenLibrary": {"recordsPath": str(records.resolve()), "recordsSha256": file_hash(records)},
        "frozenExperienceMemory": {"path": str(memory.resolve()), "sha256": file_hash(memory)}, "memoryProvenanceAudit": memory_audit,
        "historicalExposure": "Published official IDs were previously exposed in historical public replay. Selection uses IDs and a fixed hash only, never past outcomes. Confirmation is disjoint from v3 development, not unseen across project history.",
        "maxSteps": 200, "maxErrors": 10, "localConcurrency": 1, "trialTimeoutSeconds": 600,
        "development": {"tasks": 4, "trialsPerTask": 1, "trialsPerStage": 16, "allowanceUsd": 1.25,
            "sameTasksAcrossRounds": True, "newSeedsPerRound": True},
        "confirmation": {"maximumTasks": 16, "trialsPerTask": 2, "maximumTrials": 128,
            "selectionUses": "Completed development cost and current allocation headroom only",
            "allowanceRule": "ceil_0.25(max(1.25,1.25*largest_known_trial_cost,2.50_if_any_unknown_or_budget_censored))",
            "taskCountRule": "largest even balanced task count <=16 whose 8*task_count*allowance fits remaining heldout allocation"},
        "evaluation": {"type": "ALL", "strictReplay": True, "rewardBasis": "unchanged upstream task",
            "judgeModel": MODELS["teacher"], "upstreamDefaultJudgeModel": "gpt-4.1-2025-04-14",
            "userGuidance": "unmodified upstream UserSimulator system prompt and STOP semantics",
            "scope": "Subset score, not a full official leaderboard reproduction"},
        "timing": {"readyBeforeTrialClock": True, "startupSeparate": True, "liveIncludesActorUserDrain": True,
            "judgeOutsideLiveLatency": True, "armOrder": "balanced randomized rotations across matched task-seed blocks"},
        "failurePolicy": "Every stage claim is consumed before dispatch; every declared failure is retained; confirmation cannot be retried",
        "primaryOutcome": "upstream reward equals one; failed native or evaluator calls remain failures"}
    study["studyHash"] = digest(study)
    directory.mkdir(parents=True, exist_ok=False)
    write(directory / "study.json", study)
    return study


def load_study(directory):
    study = read(directory / "study.json")
    if study["studyHash"] != digest({key: value for key, value in study.items() if key != "studyHash"}):
        raise ValueError("Study was changed after precommitment")
    sources = study["sourceInventory"] + [study["frozenExperienceMemory"], {"path": study["frozenLibrary"]["recordsPath"], "sha256": study["frozenLibrary"]["recordsSha256"]}]
    for entry in sources + study["priorOutcomeLineage"]:
        if file_hash(Path(entry["path"])) != entry["sha256"]:
            raise ValueError("Frozen upstream, library or lineage source changed")
    return study


def headroom(report, allocation):
    if report.get("totalCeilingUsd") != 500:
        raise ValueError("Original shared $500 report required")
    item = next(item for item in report["allocations"] if item["allocation"] == allocation)
    values = [item["ceilingUsd"], item["spentOrReservedUsd"]]
    if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("Invalid budget headroom")
    return max(0, round((values[0] - values[1]) * 1_000_000))


def design_stage(study, stage, headroom_microdollars, development=()):
    if stage not in STAGES:
        raise ValueError("Unknown bounded stage")
    if stage == "confirmation":
        costs = [row["billedUsd"] for row in development if row.get("billedUsd") is not None and not row["budget_terminated"]]
        if not costs or any(type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0 for cost in costs):
            raise ValueError("Completed development cost calibration required")
        censored = any(row.get("billedUsd") is None or row["budget_terminated"] for row in development)
        allowance = math.ceil(4 * max(1.25, 1.25 * max(costs), 2.5 if censored else 0)) / 4
        count = min(16, 2 * (headroom_microdollars // round(16 * allowance * 1_000_000)))
        if count < 2:
            raise ValueError("Insufficient headroom for a balanced confirmation subset")
        repeats, split = 2, "confirmation"
    else:
        allowance, count, repeats, split = 1.25, 4, 1, "development"
    rng = random.Random(int(digest([study["studyId"], study["seed"], stage])[:16], 16))
    tasks = [(domain, task_id) for domain in ("retail", "airline") for task_id in study["tasks"][domain][split][:count // 2]]
    rng.shuffle(tasks)
    initial_order = list(ARMS)
    rng.shuffle(initial_order)
    trials = []
    for block, (domain, task_id, repeat) in enumerate((domain, task_id, repeat) for domain, task_id in tasks for repeat in range(repeats)):
        rotation = block % len(ARMS)
        order = initial_order[rotation:] + initial_order[:rotation]
        trial_seed = rng.randrange(2**31)
        trials.extend({"family": f"{domain}:official:{task_id}", "domain": domain, "taskId": task_id, "variant": 0,
                       "trial": repeat, "seed": trial_seed, "arm": arm, "reserved_usd": allowance} for arm in order)
    reserved = round(len(trials) * allowance * 1_000_000)
    if reserved > headroom_microdollars:
        raise ValueError("Insufficient headroom for every paired stage slot")
    result = {"studyId": study["studyId"], "studyHash": study["studyHash"], "studyStage": stage,
        "label": study["label"], "phase": "heldout" if stage == "confirmation" else "development",
        "models": study["models"], "trials": trials, "allowance_usd": allowance, "reserved_usd": reserved / 1_000_000,
        "families": sorted({trial["family"] for trial in trials}), "tasks": len(tasks), "localConcurrency": 1,
        "maxSteps": study["maxSteps"], "maxErrors": study["maxErrors"], "timing": study["timing"]}
    result["designHash"] = digest(result)
    return result


def claim_stage(directory, stage, output, budget_report, runtime_freeze=None, runtime_config=None):
    if stage not in STAGES or output.exists():
        raise ValueError("New bounded stage output required")
    with study_lock(directory):
        study = load_study(directory)
        if (directory / f"{stage}-claim.json").exists() or (directory / "confirmation-claim.json").exists():
            raise ValueError("Stage or final confirmation already consumed")
        development, completions = [], []
        for prior in STAGES[:3]:
            claimed, completed = directory / f"{prior}-claim.json", directory / f"{prior}-complete.json"
            if stage == prior:
                break
            if claimed.exists() and not completed.exists():
                raise ValueError("An earlier consumed stage is incomplete")
            if stage.startswith("development-") and not completed.exists():
                raise ValueError("Development rounds must be sequential")
            if completed.exists():
                receipt = read(completed)
                path = Path(receipt["outcomesPath"])
                if file_hash(path) != receipt["outcomesSha256"]:
                    raise ValueError("Completed development outcomes changed")
                development += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
                completions.append(completed)
        if stage == "confirmation" and not development:
            raise ValueError("Development must precede confirmation")
        if completions and budget_report.stat().st_mtime_ns < max(path.stat().st_mtime_ns for path in completions):
            raise ValueError("New post-development budget report required")
        configuration = validate_configuration({} if runtime_config is None else read(runtime_config))
        if runtime_freeze is None:
            raise ValueError("A runtime freeze is required before every v3 stage")
        from goalspec.source_freeze_v3 import verify_stage_freeze
        verification = verify_stage_freeze(ROOT, runtime_freeze, directory, stage, configuration)
        design = design_stage(study, stage, headroom(read(budget_report), "heldout" if stage == "confirmation" else "development"), development)
        design_path = directory / f"{stage}-design.json"
        write(design_path, design)
        configuration_path = directory / f"{stage}-runtime-config.json"
        write(configuration_path, configuration)
        write(directory / f"{stage}-claim.json", {"studyId": study["studyId"], "stage": stage,
            "outputPath": str(output.resolve()), "designPath": str(design_path.resolve()), "designSha256": file_hash(design_path),
            "budgetReportPath": str(budget_report.resolve()), "budgetReportSha256": file_hash(budget_report),
            "runtimeConfigPath": str(configuration_path.resolve()), "runtimeConfigSha256": file_hash(configuration_path),
            "runtimeFreezeDirectory": str(runtime_freeze.resolve()) if runtime_freeze else None,
            "runtimeFreezeManifestSha256": file_hash(runtime_freeze / "manifest.json") if runtime_freeze else None,
            "runtimeFreezeVerification": verification, "failureConsumesStage": True, "claimedAtUtc": datetime.now(UTC).isoformat()})
        return design_path


def complete_stage(directory, stage):
    claim = read(directory / f"{stage}-claim.json")
    output, design_path = Path(claim["outputPath"]), Path(claim["designPath"])
    if file_hash(design_path) != claim["designSha256"]:
        raise ValueError("Claimed design changed")
    design = read(design_path)
    outcomes_path = output / "outcomes.jsonl"
    outcomes = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line]
    validate_completed_grid(design, outcomes)
    expected = {(t["family"], t["trial"], t["arm"]): t for t in design["trials"]}
    for row in outcomes:
        trial = expected[row["family"], row["trial"], row["arm"]]
        if any(row[key] != trial[key] for key in ("seed", "taskId", "domain")) or row["reservedUsd"] != trial["reserved_usd"] or row["studyId"] != claim["studyId"] or row["studyStage"] != stage:
            raise ValueError("Outcome differs from its claimed identity")
    summary_path = output / "summary.json"
    summary = read(summary_path)
    if summary.get("studyId") != claim["studyId"] or summary.get("studyStage") != stage:
        raise ValueError("Completed summary has a different study identity")
    receipt = {"studyId": claim["studyId"], "stage": stage, "trials": len(outcomes), "successes": sum(row["success"] for row in outcomes),
        "outcomesPath": str(outcomes_path.resolve()), "outcomesSha256": file_hash(outcomes_path),
        "summaryPath": str(summary_path.resolve()), "summarySha256": file_hash(summary_path), "allFailuresRetained": True,
        "completedAtUtc": datetime.now(UTC).isoformat()}
    with study_lock(directory):
        write(directory / f"{stage}-complete.json", receipt)
    return receipt
