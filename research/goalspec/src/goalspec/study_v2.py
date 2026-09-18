"""Precommitted two-development/one-confirmation study with immutable stage claims."""
from __future__ import annotations

import hashlib
import json
import math
import random
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v2 import FAMILIES, VERSION, make_manifest
from goalspec.live_design import ARMS, MODELS, validate_completed_grid

STAGES = ("development-1", "development-2", "confirmation")
RECORDS_HASH = "ffec2bf1cfafb319bafa34320d9fd3277eba3da94fb0c3fd41c90b8acc32c8e8"
SNAPSHOT_ID = "native-training-v1-20260915"
SNAPSHOT_HASH = "90f5555ae711279cf085bde86fc3182dffdf9729ceecc99eb65bb6f4ef2bfb97"


def file_hash(path: Path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path: Path):
    return json.loads(path.read_bytes())


def write(path: Path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


@contextmanager
def study_lock(directory: Path):
    path = directory / ".stage-operation.lock"
    with path.open("x", encoding="ascii") as stream:
        stream.write("exclusive study transition; never reclaim based on age\n")
    try:
        yield
    finally:
        path.unlink()


def prepare_study(directory: Path, study_id: str, records: Path, seed: int = 20260916):
    if file_hash(records) != RECORDS_HASH:
        raise ValueError("V2 must retain the original frozen library bytes")
    if directory.exists():
        raise FileExistsError(directory)
    manifests = {stage: make_manifest(study_id, stage) for stage in STAGES}
    directory.mkdir(parents=True, exist_ok=False)
    fixtures = {}
    for stage, manifest in manifests.items():
        path = directory / f"{stage}-fixtures.json"
        write(path, manifest)
        fixtures[stage] = {"filename": path.name, "sha256": file_hash(path), "manifestHash": manifest["manifestHash"], "tasks": len(manifest["tasks"])}
    family_order = {domain: sorted((f"{domain}:{family}" for family in splits["heldout"]), key=lambda f: digest([study_id, seed, f]))
                    for domain, splits in FAMILIES.items()}
    study = {"schemaVersion": 1, "studyId": study_id, "generator": VERSION, "seed": seed, "createdAtUtc": datetime.now(UTC).isoformat(),
             "label": "custom tau-compatible pilot", "stages": list(STAGES), "maximumDevelopmentRounds": 2, "maximumConfirmationCohorts": 1,
             "primaryOutcome": "independent task success including every reserved failure", "secondaryOutcomes": ["latencyMs", "totalTrialSeconds", "serviceDrainSeconds", "cost"],
             "models": MODELS, "arms": list(ARMS), "actorReasoning": "medium", "actorOutputTokens": 4096, "predictorOutputTokens": 1024,
             "actorInputTokens": 32768, "predictorInputTokens": 8192, "maxSteps": 40, "localConcurrency": 3,
             "development": {"families": 4, "variants": 2, "trialsPerVariant": 1, "trialsPerRound": 24, "allowanceUsd": 1.25,
                             "secondRoundGate": "A fresh post-round-one budget report must show at least $30 development headroom; the live ledger atomically enforces its unchanged allocation ceiling."},
             "confirmation": {"candidateFamilies": 8, "variants": 2, "trialsPerVariant": 2, "maximumTrials": 96,
                              "maximumRemainingAllocationMicrodollars": 179447786, "familyOrder": family_order,
                              "allowanceRule": "ceil_to_0.25(max(1.25, 1.25 * largest completed new development cost, 2.50 if any new development cost is unknown or budget-censored))",
                              "familyCountRule": "min(8, 2 * floor(min(179.447786, current heldout headroom) / (24 * allowance)))",
                              "selectionUses": "new development costs and budget headroom only; no success, arm ranking, or confirmation outcomes"},
             "frozenLibrary": {"recordsPath": str(records.resolve()), "recordsSha256": RECORDS_HASH, "snapshotId": SNAPSHOT_ID, "snapshotContentHash": SNAPSHOT_HASH},
             "fixtures": fixtures, "priorV1HeldoutRole": "development evidence only; never confirmatory evidence for v2",
             "freshnessLimitation": "new synthetic request/constraint compositions with shared native tools and policy; no unseen-domain or real-world generalization claim",
             "failurePolicy": "Stage claims are consumed before dispatch. Never replace failed trials or rerun a confirmation cohort. An interrupted stage remains disclosed and consumed.",
             "freezePolicy": "Freeze this study and every candidate fixture before development. Freeze candidate runtime and final cost-selected confirmation design before confirmation dispatch."}
    study["studyHash"] = digest(study)
    write(directory / "study.json", study)
    return study


def load_study(directory: Path):
    study = read(directory / "study.json")
    if study.get("studyHash") != digest({k: v for k, v in study.items() if k != "studyHash"}):
        raise ValueError("Precommitted study was modified")
    if file_hash(Path(study["frozenLibrary"]["recordsPath"])) != study["frozenLibrary"]["recordsSha256"]:
        raise ValueError("Frozen library was modified")
    for entry in study["fixtures"].values():
        if file_hash(directory / entry["filename"]) != entry["sha256"]:
            raise ValueError("Precommitted fixtures were modified")
    return study


def budget_headroom(report: dict, allocation: str):
    if report.get("totalCeilingUsd") != 500:
        raise ValueError("Original shared $500 budget report is required")
    entry = next((item for item in report["allocations"] if item["allocation"] == allocation), None)
    if entry is None:
        raise ValueError("Missing budget allocation")
    values = [entry["ceilingUsd"], entry["spentOrReservedUsd"]]
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("Invalid spending or unresolved-reservation total")
    return max(0, round((values[0] - values[1]) * 1_000_000))


def design_stage(study: dict, manifest: dict, stage: str, headroom_microdollars: int, development: list[dict] | None = None):
    if stage not in STAGES or manifest["studyId"] != study["studyId"] or manifest["studyStage"] != stage:
        raise ValueError("Study stage or fixture identity mismatch")
    if stage == "confirmation":
        if not development:
            raise ValueError("Completed new development evidence is required")
        costs = [row["billedUsd"] for row in development if row.get("billedUsd") is not None and not row["budget_terminated"]]
        if not costs or any(not math.isfinite(cost) or cost < 0 for cost in costs):
            raise ValueError("Completed new development costs are required")
        censored = any(row.get("billedUsd") is None or row["budget_terminated"] for row in development)
        allowance = math.ceil(4 * max(1.25, 1.25 * max(costs), 2.5 if censored else 0)) / 4
        cap = min(headroom_microdollars, study["confirmation"]["maximumRemainingAllocationMicrodollars"])
        count = min(8, 2 * (cap // round(24 * allowance * 1_000_000)))
        if count < 2:
            raise ValueError("Insufficient headroom for one balanced confirmation cohort")
        families = [family for domain in ("retail", "airline") for family in study["confirmation"]["familyOrder"][domain][:count // 2]]
        repeats = 2
    else:
        allowance, repeats = study["development"]["allowanceUsd"], 1
        families = sorted({task["familyId"] for task in manifest["tasks"]})
    rng = random.Random(int(digest([study["studyId"], study["seed"], stage])[:16], 16))
    trials = []
    for family in families:
        for variant in range(2):
            for trial in range(repeats):
                arms = list(ARMS)
                rng.shuffle(arms)
                seed = rng.randrange(2**31)
                trials.extend({"family": family, "variant": variant, "trial": trial, "seed": seed, "arm": arm, "reserved_usd": allowance} for arm in arms)
    reserved = round(len(trials) * allowance * 1_000_000)
    if reserved > headroom_microdollars:
        raise ValueError("Insufficient allocation headroom for the complete paired stage")
    design = {"label": study["label"], "phase": "heldout" if stage == "confirmation" else "development", "studyId": study["studyId"],
              "studyStage": stage, "studyHash": study["studyHash"], "fixtureManifestHash": manifest["manifestHash"], "models": study["models"],
              "families": families, "allowance_usd": allowance, "reserved_usd": reserved / 1_000_000, "trials": trials,
              "primaryOutcome": study["primaryOutcome"], "secondaryOutcomes": study["secondaryOutcomes"], "maxSteps": study["maxSteps"],
              "localConcurrency": study["localConcurrency"], "concurrencyUnit": "paired block; arms within each block remain sequential"}
    design["designHash"] = digest(design)
    return design


def claim_stage(directory: Path, stage: str, output: Path, budget_report: Path, runtime_freeze: Path | None = None):
    """A claim is never removed after dispatch failure and cannot be replayed."""
    if stage not in STAGES or output.exists():
        raise ValueError("New bounded stage output required")
    with study_lock(directory):
        study = load_study(directory)
        claim = directory / f"{stage}-claim.json"
        if claim.exists() or (directory / "confirmation-claim.json").exists():
            raise ValueError("Stage already consumed or confirmation already claimed")
        development = []
        for prior in ("development-1", "development-2"):
            completed = directory / f"{prior}-complete.json"
            if completed.exists():
                completion = read(completed)
                source = Path(completion["outcomesPath"])
                if file_hash(source) != completion["outcomesSha256"]:
                    raise ValueError("Completed development outcomes changed")
                development.extend(json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line)
        if stage != "development-1" and not (directory / "development-1-complete.json").exists():
            raise ValueError("Round one must complete before another stage")
        if stage == "confirmation" and (directory / "development-2-claim.json").exists() and not (directory / "development-2-complete.json").exists():
            raise ValueError("An incomplete second development round must be resolved before confirmation")
        previous_completions = [p for p in directory.glob("development-*-complete.json")]
        if previous_completions and budget_report.stat().st_mtime_ns < max(p.stat().st_mtime_ns for p in previous_completions):
            raise ValueError("A new post-development budget reconciliation report is required")
        freeze_receipt = None
        if stage == "confirmation":
            if runtime_freeze is None:
                raise ValueError("Confirmation requires an immutable candidate-runtime source freeze")
            from goalspec.source_freeze import verify_source
            freeze_receipt = verify_source(Path(__file__).resolve().parents[4], runtime_freeze)
            if not freeze_receipt["passed"]:
                raise ValueError("Candidate runtime or frozen inputs changed after confirmation freeze")
        allocation = "heldout" if stage == "confirmation" else "development"
        manifest = read(directory / study["fixtures"][stage]["filename"])
        design = design_stage(study, manifest, stage, budget_headroom(read(budget_report), allocation), development)
        design_path = directory / f"{stage}-design.json"
        write(design_path, design)
        receipt = {"studyId": study["studyId"], "studyHash": study["studyHash"], "stage": stage, "claimedAtUtc": datetime.now(UTC).isoformat(),
                   "outputPath": str(output.resolve()), "designPath": str(design_path.resolve()), "designSha256": file_hash(design_path),
                   "budgetReportPath": str(budget_report.resolve()), "budgetReportSha256": file_hash(budget_report),
                   "runtimeFreezeDirectory": str(runtime_freeze.resolve()) if runtime_freeze is not None else None,
                   "runtimeFreezeManifestSha256": file_hash(runtime_freeze / "manifest.json") if runtime_freeze is not None else None,
                   "runtimeFreezeVerification": freeze_receipt, "failureConsumesStage": True}
        write(claim, receipt)
        return directory / study["fixtures"][stage]["filename"], design_path


def complete_stage(directory: Path, stage: str):
    claim = read(directory / f"{stage}-claim.json")
    output = Path(claim["outputPath"])
    design_path = Path(claim["designPath"])
    if file_hash(design_path) != claim["designSha256"]:
        raise ValueError("Claimed stage design bytes changed")
    design = read(design_path)
    if design.get("designHash") != digest({k: v for k, v in design.items() if k != "designHash"}):
        raise ValueError("Claimed stage design hash is invalid")
    outcomes_path = output / "outcomes.jsonl"
    outcomes = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line]
    validate_completed_grid(design, outcomes)
    expected = {(trial["family"], trial["variant"], trial["trial"], trial["arm"]): trial for trial in design["trials"]}
    for row in outcomes:
        trial = expected[row["family"], row["variant"], row["trial"], row["arm"]]
        if row.get("seed") != trial["seed"] or row.get("reservedUsd") != trial["reserved_usd"]:
            raise ValueError("Outcome seed or allowance differs from the claimed paired trial")
    if any(row.get("studyId") != claim["studyId"] or row.get("studyStage") != stage for row in outcomes):
        raise ValueError("Outcomes do not belong to the claimed new study stage")
    summary = read(output / "summary.json")
    if summary.get("studyId") != claim["studyId"] or summary.get("studyStage") != stage:
        raise ValueError("Completed service summary has another study identity")
    receipt = {"studyId": claim["studyId"], "stage": stage, "completedAtUtc": datetime.now(UTC).isoformat(), "trials": len(outcomes),
               "successes": sum(row["success"] for row in outcomes), "outcomesPath": str(outcomes_path.resolve()), "outcomesSha256": file_hash(outcomes_path),
               "summaryPath": str((output / "summary.json").resolve()), "summarySha256": file_hash(output / "summary.json"), "allFailuresRetained": True}
    with study_lock(directory):
        write(directory / f"{stage}-complete.json", receipt)
    return receipt
