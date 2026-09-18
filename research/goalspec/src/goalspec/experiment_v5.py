"""Bounded v5 studies: immutable inputs, complete paired reservations, no retesting."""
from __future__ import annotations

import json
import hashlib
import math
import random
import subprocess
import zipfile
from pathlib import Path

from goalspec.fresh_tasks import NATIVE_COMMIT, digest, preflight
from goalspec.fresh_tasks_v5 import preflight_v5
from goalspec.source_freeze import category, collect_sources, file_digest
from goalspec.study_v2 import read, write
from goalspec.study_v3 import ROOT, MODELS

VERSION = "goalspec-experiment-v5"
LIMITS = {"training": 50, "development": 25, "confirmation": 90}
ARMS = {"training": ("base",), "development": ("base", "v4", "literal", "hypotheses"),
        "confirmation": ("base", "v4", "goalspec")}


def complete_grid(design, rows):
    fields = ("family", "domain", "taskId", "variant", "trial", "seed", "arm")
    expected = [tuple(row[key] for key in fields) for row in design["trials"]]
    actual = [tuple(row[key] for key in fields) for row in rows]
    if len(set(expected)) != len(expected) or sorted(expected) != sorted(actual):
        raise ValueError("Every declared paired slot must appear exactly once")
    if any(row.get("studyId") != design["studyId"] or row.get("studyStage") != design["studyStage"] for row in rows):
        raise ValueError("Outcome study identity mismatch")


def allowance_from_development(design, rows):
    if design.get("version") != VERSION or design.get("studyStage") != "development":
        raise ValueError("Only v5 development costs can size confirmation")
    complete_grid(design, rows)
    if len(design["trials"]) != 16 or {row["arm"] for row in rows} != set(ARMS["development"]):
        raise ValueError("Sixteen development trials required")
    costs = [row["billedUsd"] for row in rows if row.get("billedUsd") is not None
             and not row.get("budget_terminated") and not row.get("unknownProviderCharge")]
    if not costs or any(type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0 for cost in costs):
        raise ValueError("Valid completed development costs required")
    censored = len(costs) != len(rows)
    allowance = math.ceil(4 * max(1.25, 1.25 * max(costs), 2.5 if censored else 0)) / 4
    return allowance, {"largestCompletedUsd": max(costs), "censored": censored,
                       "completedCosts": len(costs), "developmentDesignHash": design["designHash"]}


def select_v5_from_development(design, rows):
    """Declared before execution: accuracy, constraints, live time, then cost."""
    allowance_from_development(design, rows)
    candidates = []
    for arm in ("literal", "hypotheses"):
        group = [row for row in rows if row["arm"] == arm]
        times = [row.get("totalTrialSeconds") if row.get("measuredTimingValid") is not False and not row.get("hostInterrupted") else None for row in group]
        costs = [row.get("billedUsd") for row in group]
        violations = [row.get("constraintViolations") for row in group]
        valid = lambda value: type(value) in (int, float) and math.isfinite(value) and value >= 0
        candidates.append({"arm": arm, "successes": sum(row.get("success") is True for row in group),
            "violations": sum(violations) if all(valid(value) for value in violations) else None,
            "meanLiveSeconds": sum(times) / len(times) if all(valid(value) for value in times) else None,
            "costUsd": sum(costs) if all(valid(value) for value in costs) else None})
    infinity = lambda value: value if value is not None else float("inf")
    chosen = min(candidates, key=lambda row: (-row["successes"], infinity(row["violations"]),
        infinity(row["meanLiveSeconds"]), infinity(row["costUsd"]), row["arm"] != "literal"))
    result = {"version": "v5-development-selection-v1", "selectedActorContext": chosen["arm"],
        "goalConditioning": chosen["arm"] == "hypotheses", "candidates": candidates,
        "rule": "Higher success count, fewer constraint violations, lower mean total live seconds, lower billed cost, literal final tie-break; incomplete or host-invalid timing ranks last.",
        "developmentDesignHash": design["designHash"], "outcomesHash": digest(rows),
        "heldoutOutcomesUsed": False, "selectionUncertainty": "Four development families; not an independent accuracy estimate."}
    result["selectionHash"] = digest(result)
    return result


def make_design(study_id, stage, tasks, budget, *, development=None, seed=20260919):
    if stage not in ARMS or not study_id or budget.get("totalCeilingUsd") != 500:
        raise ValueError("Valid study, stage and original budget required")
    phase = "heldout" if stage == "confirmation" else stage
    allocation = next(row for row in budget["allocations"] if row["allocation"] == phase)
    if allocation["ceilingUsd"] != {"training": 60, "development": 40, "heldout": 240}[phase]:
        raise ValueError("Original allocation ceiling changed")
    available = min(LIMITS[stage], allocation["ceilingUsd"] - allocation["spentOrReservedUsd"])
    allowance, calibration = (1.25, None) if stage != "confirmation" else allowance_from_development(*development)
    if len({(task["domain"], task["taskId"]) for task in tasks}) != len(tasks):
        raise ValueError("Duplicate tasks")
    if stage == "training":
        if len(tasks) != 40 or len({task["familyId"] for task in tasks}) != 20:
            raise ValueError("Training requires twenty families, two variants each")
        if any(sorted(task.get("variant") for task in tasks if task["familyId"] == family) != [0, 1]
               for family in {task["familyId"] for task in tasks}):
            raise ValueError("Training requires both declared variants of every family")
        chosen = tasks
    elif stage == "development":
        chosen = [task for task in tasks if task.get("variant", 0) == 0]
        if len(chosen) != 4 or len({task["familyId"] for task in chosen}) != 4:
            raise ValueError("Development requires four distinct families")
    else:
        count = min(12, 2 * math.floor((available + 1e-9) / (12 * allowance)),
                    2 * min(sum(task["domain"] == domain for task in tasks) for domain in ("retail", "airline")))
        if count < 2:
            raise ValueError("Insufficient headroom for a complete balanced paired cohort")
        chosen = [task for domain in ("retail", "airline") for task in sorted(
            (task for task in tasks if task["domain"] == domain), key=lambda task: digest([seed, domain, task["taskId"]]))[:count // 2]]
    rng, trials = random.Random(seed), []
    chosen = sorted(chosen, key=lambda task: digest([seed, task["taskId"]]))
    for task in chosen:
        for repeat in range(2 if stage == "confirmation" else 1):
            order = list(ARMS[stage])
            rng.shuffle(order)
            trial_seed = rng.randrange(2**31)
            trials.extend({"family": task["familyId"], "domain": task["domain"], "taskId": task["taskId"],
                           "variant": task.get("variant", 0), "trial": repeat, "seed": trial_seed,
                           "arm": arm, "reserved_usd": allowance} for arm in order)
    reserved = len(trials) * allowance
    if reserved > available + 1e-9:
        raise ValueError("Cannot reserve all declared trials")
    design = {"version": VERSION, "studyId": study_id, "studyStage": stage, "phase": phase,
              "seed": seed, "trials": trials, "families": sorted({row["family"] for row in trials}),
              "allowance_usd": allowance, "reserved_usd": reserved, "costCalibration": calibration,
              "models": MODELS, "maxSteps": 200, "maxErrors": 10, "trialTimeoutSeconds": 600,
              "localConcurrency": 1, "userProtocol": "unchanged-upstream-user-simulator",
              "label": "selected official tau3 subset" if stage == "confirmation" else "custom tau-compatible pilot",
              "failurePolicy": "retain every declared failure; never replace or retry a task",
              "timing": {"startupSeparate": True, "liveIncludesDrain": True, "judgeSeparate": True}}
    design["designHash"] = digest(design)
    return design


def verify_hash(value, key):
    if value.get(key) != digest({name: item for name, item in value.items() if name != key}):
        raise ValueError(f"Frozen {key} changed")


def prepare(manifest_path, records_path, memory_path, configuration_path, budget_report_path,
            budget_directory, output, plan_directory, stage, *, development_directory=None, seed=20260919):
    manifest = read(manifest_path)
    verify_hash(manifest, "manifestHash")
    if manifest.get("nativeCommit") != NATIVE_COMMIT:
        raise ValueError("Pinned benchmark required")
    if stage != "confirmation":
        if manifest.get("generator") != "fresh-native-v5" or manifest.get("studyStage") != stage:
            raise ValueError("Fresh v5 custom fixtures required")
        for task in manifest["tasks"]:
            verify_hash(task, "fixtureHash")
            if preflight_v5(task) != manifest["checks"][task["taskId"]]:
                raise ValueError("Independent preflight drift")
    if output.exists() or plan_directory.exists() or not (budget_directory / "budget.jsonl").is_file():
        raise ValueError("New destinations and existing shared budget required")
    development = None
    inputs = {"manifest": manifest_path, "records": records_path, "memory": memory_path,
              "configuration": configuration_path, "budget_report": budget_report_path}
    for index, source in enumerate(manifest.get("sources", [])):
        source_path = Path(source["path"])
        if file_digest(source_path) != source["sha256"]:
            raise ValueError("Manifest source lineage changed")
        inputs[f"manifest_source_{index}"] = source_path
    configuration = read(configuration_path)
    for name, value in configuration.items():
        if name.endswith("Path"):
            inputs[f"configuration_{name}"] = Path(value)
    legacy = read(Path(configuration["legacyConfigurationPath"]))
    for name, value in legacy.items():
        if name.endswith("Path"):
            inputs[f"legacy_{name}"] = Path(value)
    if development_directory:
        development = (read(development_directory / "design.json"), [json.loads(line) for line in
            (development_directory / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line])
        inputs.update({"development_design": development_directory / "design.json", "development_outcomes": development_directory / "outcomes.jsonl"})
    design = make_design(manifest["studyId"], stage, manifest["tasks"], read(budget_report_path), development=development, seed=seed)
    native = ROOT / "research/goalspec/.benchmarks/tau3"
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=native, text=True).strip() != NATIVE_COMMIT:
        raise ValueError("Native checkout changed")
    sources = collect_sources(ROOT)
    source_bytes = {name: path.read_bytes() for name, path in sources.items()}
    runtime = {name: {"sha256": hashlib.sha256(value).hexdigest()} for name, value in source_bytes.items() if category(name) == "execution"}
    plan_directory.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(plan_directory / "source.zip", "x", zipfile.ZIP_DEFLATED) as archive:
        for name, value in source_bytes.items():
            archive.writestr(name, value)
    if any(file_digest(sources[name]) != hashlib.sha256(value).hexdigest() for name, value in source_bytes.items()):
        raise ValueError("Source changed during archive capture")
    plan = {"version": VERSION, "design": design, "outputPath": str(output.resolve()),
            "budgetDirectory": str(budget_directory.resolve()), "upstreamRoot": str(native.resolve()),
            "inputs": {name: {"path": str(path.resolve(strict=True)), "sha256": file_digest(path)} for name, path in inputs.items()},
            "runtimeSources": runtime, "sourceArchiveSha256": file_digest(plan_directory / "source.zip")}
    plan["planHash"] = digest(plan)
    write(plan_directory / "plan.json", plan)
    return plan


def verify_plan(plan, directory):
    verify_hash(plan, "planHash")
    verify_hash(plan["design"], "designHash")
    for record in plan["inputs"].values():
        if file_digest(Path(record["path"])) != record["sha256"]:
            raise ValueError("Frozen experiment input changed")
    for name, record in plan["runtimeSources"].items():
        if file_digest(ROOT / name) != record["sha256"]:
            raise ValueError(f"Frozen runtime changed: {name}")
    if file_digest(directory / "source.zip") != plan["sourceArchiveSha256"]:
        raise ValueError("Source archive changed")


def dispatch(plan_path, expected_sha256):
    if file_digest(plan_path) != expected_sha256:
        raise ValueError("Dispatch hash mismatch")
    plan = read(plan_path)
    verify_plan(plan, plan_path.parent)
    claim = plan_path.parent / "dispatch.json"
    write(claim, {"planHash": plan["planHash"], "oneAttemptOnly": True})
    from goalspec.native_runner_v5 import run_stage
    try:
        return run_stage(plan, lambda: verify_plan(plan, plan_path.parent))
    except Exception as error:
        retain_setup_failure(plan, type(error).__name__)
        raise


def retain_setup_failure(plan, error_type):
    """A consumed one-shot dispatch always leaves every declared slot visible."""
    output, design = Path(plan["outputPath"]), plan["design"]
    output.mkdir(parents=True, exist_ok=True)
    if not (output / "design.json").exists():
        write(output / "design.json", design)
    path = output / "outcomes.jsonl"
    existing = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line] if path.exists() else []
    completed = {row["runId"] for row in existing}
    with path.open("a", encoding="utf-8") as stream:
        for index, trial in enumerate(design["trials"]):
            run_id = f"v5-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}"
            if run_id in completed:
                continue
            row = {**trial, "runId": run_id, "studyId": design["studyId"], "studyStage": design["studyStage"],
                "familyId": trial["family"], "success": False, "termination": "stage_setup_or_dispatch_error",
                "billedUsd": None, "unknownProviderCharge": True, "budget_terminated": False,
                "latencyMs": None, "totalTrialSeconds": None, "exceptionType": error_type}
            artifact_path = output / f"{run_id}.json"
            if not artifact_path.exists():
                write(artifact_path, {"record": row})
            stream.write(json.dumps(row) + "\n")
            existing.append(row)
    complete_grid(design, existing)
    receipt = output / "dispatch-failure.json"
    if not receipt.exists():
        write(receipt, {"errorType": error_type, "retainedSlots": len(existing), "replacementsAllowed": False})
