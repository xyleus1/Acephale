"""Closed-cohort paired infrastructure reporting with explicit missing telemetry."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import Field, model_validator

from acephale.annotation_review import review_metadata
from acephale.contracts_v1 import hash_v1
from acephale.infra_data import read_jsonl, verify_bundle
from acephale.replay_receipt import verify_replay_receipt
from acephale.schemas import Record
from acephale.score_semantics import (
    LEGACY_NEXT_BATCH_HIT,
    NEXT_BATCH_MEMBERSHIP,
    RAW_SCORE_SEMANTICS,
    replay_score_semantics,
)
from acephale.storage import file_hash

ARMS = ("base", "neutral_memory_prefetch", "acephale")
Arm = Literal["base", "neutral_memory_prefetch", "acephale"]


class TrialSlot(Record):
    slot_id: str
    task_id: str
    family_id: str
    domain: str
    trial: int = Field(ge=0)
    seed: int
    arm: Arm

    @property
    def pair_key(self) -> tuple:
        return self.domain, self.family_id, self.task_id, self.trial, self.seed


class TrialDesign(Record):
    schema_version: Literal["acephale-infra-evaluation-v1"] = "acephale-infra-evaluation-v1"
    measurement_kind: Literal["live", "execution_replay", "deterministic_integration"]
    label: str = Field(min_length=1)
    source_commit: str = Field(min_length=1)
    actor_config_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    memory_snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    frozen_before_execution: Literal[True]
    annotation_review: dict[str, Any] | None = None
    trials: tuple[TrialSlot, ...] = Field(min_length=3)

    @model_validator(mode="after")
    def paired_blocks(self) -> TrialDesign:
        if self.annotation_review is not None:
            review_metadata(self.annotation_review)
        if len({slot.slot_id for slot in self.trials}) != len(self.trials):
            raise ValueError("Duplicate scheduled slot")
        blocks: dict[tuple, list[str]] = defaultdict(list)
        families: dict[tuple, set[str]] = defaultdict(set)
        for slot in self.trials:
            blocks[slot.pair_key].append(slot.arm)
            families[(slot.domain, slot.task_id)].add(slot.family_id)
        if any(sorted(arms) != sorted(ARMS) for arms in blocks.values()):
            raise ValueError("Reserve complete, unique three-arm paired blocks")
        if any(len(values) != 1 for values in families.values()):
            raise ValueError("A task cannot change family across trials")
        return self


class TrialResult(Record):
    slot_id: str
    run_id: str = Field(min_length=1)
    status: Literal["completed", "failed", "censored", "budget_terminated", "not_started"]
    success: bool
    latency_valid: bool
    latency_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    cost_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    logical_calls: int | None = Field(default=None, ge=0)
    physical_calls: int | None = Field(default=None, ge=0)
    revalidation_calls: int | None = Field(default=None, ge=0)
    speculative_starts: int | None = Field(default=None, ge=0)
    useful_speculations: int | None = Field(default=None, ge=0)
    constraint_violations: int | None = Field(default=None, ge=0)
    actor_config_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    memory_snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def coherent_result(self) -> TrialResult:
        if self.success and self.status != "completed":
            raise ValueError("Censored, failed and unstarted trials remain failures")
        if self.latency_valid and (self.latency_ms is None or self.status == "not_started"):
            raise ValueError("Valid latency needs an actual measured clock")
        if self.useful_speculations is not None and self.speculative_starts is not None and self.useful_speculations > self.speculative_starts:
            raise ValueError("Useful speculation exceeds starts")
        if self.revalidation_calls is not None and self.physical_calls is not None and self.revalidation_calls > self.physical_calls:
            raise ValueError("Revalidation calls must be counted as physical calls")
        return self


def _paired_interval(values: dict[str, list[float]], *, seed: int, samples: int) -> dict[str, Any]:
    if samples < 100:
        raise ValueError("At least 100 bootstrap samples required")
    means = np.array([np.mean(values[key]) for key in sorted(values)], dtype=float)
    if not len(means):
        return {"estimate": None, "ci95": None, "families": 0, "paired_trials": 0}
    result = {"estimate": float(means.mean()), "families": len(means), "paired_trials": sum(len(rows) for rows in values.values()), "weighting": "equal_family_mean_of_paired_trial_differences"}
    if len(means) < 2:
        return {**result, "ci95": None, "limitation": "At least two independent families required"}
    rng = np.random.default_rng(seed)
    draws = means[rng.integers(0, len(means), size=(samples, len(means)))].mean(axis=1)
    return {**result, "ci95": [float(value) for value in np.quantile(draws, [0.025, 0.975])], "bootstrap_samples": samples, "bootstrap_seed": seed}


def report_trials(design: TrialDesign, results: list[TrialResult], *, seed: int = 42, bootstrap_samples: int = 2000) -> dict[str, Any]:
    expected = {slot.slot_id for slot in design.trials}
    if {row.slot_id for row in results} != expected or len(results) != len(expected):
        raise ValueError("Final report requires every declared slot, including failures")
    if len({row.run_id for row in results}) != len(results):
        raise ValueError("Physical run reused across trial slots")
    for row in results:
        if row.actor_config_hash != design.actor_config_hash or row.memory_snapshot_hash != design.memory_snapshot_hash:
            raise ValueError("Actor configuration or frozen memory changed during evaluation")
    by_slot = {row.slot_id: row for row in results}
    by_arm: dict[str, list[tuple[TrialSlot, TrialResult]]] = defaultdict(list)
    by_pair: dict[tuple, dict[str, TrialResult]] = defaultdict(dict)
    for slot in design.trials:
        result = by_slot[slot.slot_id]
        by_arm[slot.arm].append((slot, result))
        by_pair[slot.pair_key][slot.arm] = result
    summaries = {}
    for arm, pairs in sorted(by_arm.items()):
        rows = [row for _, row in pairs]
        latency = [row.latency_ms for row in rows if row.latency_valid]
        tasks: dict[tuple, list[TrialResult]] = defaultdict(list)
        for slot, row in pairs:
            tasks[(slot.domain, slot.family_id, slot.task_id)].append(row)
        two_trials = [values for values in tasks.values() if len(values) == 2]
        summary = {
            "scheduled_trials": len(rows), "successes": sum(row.success for row in rows),
            "pass1": sum(row.success for row in rows) / len(rows),
            "two_trial_tasks": len(two_trials),
            "two_trial_consistency": sum(all(row.success for row in values) for values in two_trials) / len(two_trials) if two_trials else None,
            "latency_samples": len(latency),
            "mean_latency_ms": float(np.mean(latency)) if latency else None,
            "median_latency_ms": float(np.median(latency)) if latency else None,
            "observed_p95_latency_ms": float(np.quantile(latency, .95)) if latency else None,
            "p95_method": "linear_sample_quantile",
            "known_usage_usd": sum(row.cost_usd for row in rows if row.cost_usd is not None),
            "unknown_cost_trials": sum(row.cost_usd is None for row in rows),
            "status_counts": {status: sum(row.status == status for row in rows) for status in sorted({row.status for row in rows})},
        }
        for metric in ("logical_calls", "physical_calls", "revalidation_calls", "speculative_starts", "useful_speculations", "constraint_violations"):
            values = [getattr(row, metric) for row in rows]
            summary[metric] = {"known_total": sum(value for value in values if value is not None), "missing_trials": sum(value is None for value in values)}
        logical = summary["logical_calls"]
        physical = summary["physical_calls"]
        summary["physical_call_amplification"] = physical["known_total"] / logical["known_total"] if not logical["missing_trials"] and not physical["missing_trials"] and logical["known_total"] > 0 else None
        summary["physical_calls_per_success"] = physical["known_total"] / summary["successes"] if not physical["missing_trials"] and summary["successes"] else None
        summaries[arm] = summary
    comparisons = []
    for baseline, treatment in (("base", "neutral_memory_prefetch"), ("base", "acephale"), ("neutral_memory_prefetch", "acephale")):
        metrics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for key, block in by_pair.items():
            left, right = block[baseline], block[treatment]
            family = f"{key[0]}:{key[1]}"
            metrics["success_difference"][family].append(float(right.success) - float(left.success))
            if left.latency_valid and right.latency_valid:
                metrics["latency_ms_difference"][family].append(right.latency_ms - left.latency_ms)
            if left.physical_calls is not None and right.physical_calls is not None:
                metrics["physical_calls_difference"][family].append(right.physical_calls - left.physical_calls)
            if left.logical_calls is not None and right.logical_calls is not None:
                metrics["logical_calls_difference"][family].append(right.logical_calls - left.logical_calls)
        comparisons.append({"baseline": baseline, "treatment": treatment, "metrics": {metric: _paired_interval(metrics[metric], seed=seed, samples=bootstrap_samples) for metric in ("success_difference", "latency_ms_difference", "logical_calls_difference", "physical_calls_difference")}})
    report = {
        "schema_version": design.schema_version, "measurement_kind": design.measurement_kind,
        "label": design.label, "design_hash": hash_v1(design.model_dump(mode="json")),
        "results_hash": hash_v1([row.model_dump(mode="json") for row in sorted(results, key=lambda row: row.slot_id)]),
        "arms": summaries, "paired_comparisons": comparisons,
        "limitations": ["Usage-derived costs are not invoice-reconciled", "Missing telemetry is never imputed as zero", "Execution replay timing is not live latency", "Task success and exact-read prediction use different denominators"],
    }
    if design.annotation_review is not None:
        report["annotationReview"] = review_metadata(design.annotation_review)
        if report["annotationReview"]["reviewProtocol"] == "machine_audited_exploratory":
            report["limitations"].append("Exploratory machine-audited study; zero human reviews; reviewer and teacher use the same model in separate requests")
    return report


def score_candidate_panels(rows: list[dict[str, Any]], *, seed: int = 42, bootstrap_samples: int = 2000,
                           allow_unavailable_panels: bool = False) -> dict[str, Any]:
    """Score exact-read membership probabilities on identical fixed panels.

    A positive is membership anywhere in the immediate next authoritative
    batch. Multiple positives are valid. Missing predictions stay in the
    declared cohort and receive no fabricated probability or log loss.
    """
    if not rows:
        raise ValueError("A declared fixed-panel cohort is required")
    semantics = {row.get("probability_semantics") for row in rows}
    if len(semantics) != 1 or not semantics <= {LEGACY_NEXT_BATCH_HIT, NEXT_BATCH_MEMBERSHIP}:
        raise ValueError("One declared score semantics version is required")
    declared_semantics = next(iter(semantics))
    raw_semantics = {row.get("raw_score_semantics") for row in rows}
    if declared_semantics == NEXT_BATCH_MEMBERSHIP and (len(raw_semantics) != 1 or not raw_semantics <= set(RAW_SCORE_SEMANTICS.values())):
        raise ValueError("Explicit matching raw score semantics required")
    groups: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    identities: dict[str, str] = {}
    observed_panels: dict[str, str] = {}
    partitions: dict[str, str] = {}
    scored: dict[tuple[str, str], dict[str, float]] = {}
    for row in rows:
        condition, checkpoint = row.get("condition"), row.get("checkpoint_id")
        if not isinstance(condition, str) or not condition or not isinstance(checkpoint, str) or not checkpoint:
            raise ValueError("Condition and checkpoint identity required")
        if checkpoint in groups[condition]:
            raise ValueError("Duplicate condition/checkpoint")
        family, split = row.get("family_id"), row.get("split")
        if not isinstance(family, str) or not family or split not in {"train", "development", "test"}:
            raise ValueError("Family and declared partition required")
        if partitions.setdefault(family, split) != split:
            raise ValueError("A family crosses evaluation partitions")
        panel, actual = row.get("candidate_panel"), row.get("actual_reads")
        for values in (panel, actual):
            if not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values) or len(set(values)) != len(values):
                raise ValueError("Unique exact invocation identities required")
        if len(panel) > 3 or row.get("panel_hash") != hash_v1(sorted(panel)):
            raise ValueError("Fixed panel hash or size differs")
        identity = hash_v1({"family": family, "split": split, "actual": sorted(actual), **({} if allow_unavailable_panels else {
            "panel": sorted(panel), "panel_available": row.get("panel_available", True)})})
        if identities.setdefault(checkpoint, identity) != identity:
            raise ValueError("Conditions must share identical panels, labels and checkpoint identities")
        if row.get("panel_available", True):
            panel_identity = hash_v1(sorted(panel))
            if observed_panels.setdefault(checkpoint, panel_identity) != panel_identity:
                raise ValueError("Conditions must share identical observed panels")
        status = row.get("status")
        if status not in {"completed", "failed", "not_dispatched", "unobserved_actor_action"}:
            raise ValueError("Unknown fixed-panel prediction status")
        probabilities = row.get("probabilities")
        if row.get("panel_available", True) is not True:
            if status not in {"failed", "not_dispatched", "unobserved_actor_action"} or panel:
                raise ValueError("Unavailable panels must remain attributed failed or unobserved checkpoints")
        if status == "completed":
            if not isinstance(probabilities, dict) or set(probabilities) != set(panel):
                raise ValueError("Scores must cover every fixed panel candidate, including low scores")
            if any(type(value) not in {int, float} or not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities.values()):
                raise ValueError("Invalid next-batch membership probability")
            if panel:
                losses = [-math.log(max(1e-12, probabilities[key] if key in actual else 1 - probabilities[key])) for key in panel]
                briers = [(probabilities[key] - int(key in actual)) ** 2 for key in panel]
                rank = sorted(panel, key=lambda key: (-probabilities[key], key))
                scored[condition, checkpoint] = {"binary_log_loss_nats": float(np.mean(losses)), "brier": float(np.mean(briers)),
                                                 "exact_top1_any_hit": float(bool(set(rank[:1]) & set(actual))),
                                                 "exact_top3_any_hit": float(bool(set(rank[:3]) & set(actual)))}
        elif probabilities not in (None, {}):
            raise ValueError("Failed or unobserved predictions cannot carry fabricated scoring probabilities")
        groups[condition][checkpoint] = row
    checkpoint_sets = [set(values) for values in groups.values()]
    if any(values != checkpoint_sets[0] for values in checkpoint_sets[1:]):
        raise ValueError("Every condition must retain every declared checkpoint including failures")
    summaries = {}
    for condition, values in groups.items():
        available = [scored[condition, key] for key in values if (condition, key) in scored]
        observed = [row for row in values.values() if row["status"] != "unobserved_actor_action"]
        eligible = [row for row in observed if row["actual_reads"]]
        known_panels = [row for row in eligible if row.get("panel_available", True)]
        summaries[condition] = {
            "declared_checkpoints": len(values), "scored_checkpoints": len(available),
            "scored_candidates": sum(len(row["candidate_panel"]) for key, row in values.items() if (condition, key) in scored),
            "status_counts": {status: sum(row["status"] == status for row in values.values()) for status in sorted({row["status"] for row in values.values()})},
            "empty_panel_checkpoints": sum(not row["candidate_panel"] for row in values.values()),
            "unavailable_panel_checkpoints": sum(not row.get("panel_available", True) for row in values.values()),
            "eligible_read_checkpoints": len(eligible),
            "coverage_eligible_checkpoints": len(known_panels),
            "candidate_panel_any_hit_coverage": sum(bool(set(row["candidate_panel"]) & set(row["actual_reads"])) for row in known_panels) / len(known_panels) if known_panels else None,
            "no_read_checkpoints": len(observed) - len(eligible),
            **{metric: float(np.mean([value[metric] for value in available])) if available else None for metric in ("binary_log_loss_nats", "brier")},
            "exact_top1_any_hit_over_declared_eligible": sum(scored.get((condition, row["checkpoint_id"]), {}).get("exact_top1_any_hit", 0) for row in eligible) / len(eligible) if eligible else None,
            "exact_top3_any_hit_over_declared_eligible": sum(scored.get((condition, row["checkpoint_id"]), {}).get("exact_top3_any_hit", 0) for row in eligible) / len(eligible) if eligible else None,
        }
    comparisons = []
    for baseline, treatment in combinations(sorted(groups), 2):
        metrics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for checkpoint, row in groups[baseline].items():
            if (baseline, checkpoint) not in scored or (treatment, checkpoint) not in scored:
                continue
            for metric in ("binary_log_loss_nats", "brier"):
                metrics[metric][row["family_id"]].append(scored[treatment, checkpoint][metric] - scored[baseline, checkpoint][metric])
        comparisons.append({"baseline": baseline, "treatment": treatment, "metrics": {
            f"{metric}_difference": _paired_interval(metrics[metric], seed=seed, samples=bootstrap_samples)
            for metric in ("binary_log_loss_nats", "brier")}})
    return {"schema_version": "acephale-fixed-panel-report-v3" if declared_semantics == NEXT_BATCH_MEMBERSHIP else "acephale-fixed-panel-report-v2",
            "probability_semantics": declared_semantics, "raw_score_semantics": next(iter(raw_semantics)) or "legacy_unspecified",
            "conditions": summaries, "paired_comparisons": comparisons,
            "identical_candidate_panels": all(row.get("panel_available", True) for row in rows),
            "identical_observed_candidate_panels": True, "identical_checkpoint_sets": True,
            "test_partition_only": all(row["split"] == "test" for row in rows), "heldout_claim": False,
            "interpretation": "Checkpoint-mean binary log loss for membership anywhere in the next authoritative batch, not full-action cross-entropy or true conditional entropy",
            "limitations": ["At most three preselected candidates; panel coverage is reported separately", "Partition labels alone do not verify fresh held-out tasks or a preregistered freeze", "Missing predictions remain declared failures without invented probabilities", "Paired loss differences use jointly scored checkpoints only", "Task success, physical execution work and prediction hit rate are separate outcomes"]}


def score_fixed_panel_replay(bundle_directory: Path, prediction_directory: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Join a closed prediction replay to private next-batch labels after execution.

    This evaluates recorded raw scores without fitting on evaluation labels.
    Public predictor inputs never receive the label file or achieved outcome.
    """
    bundle = verify_bundle(bundle_directory)
    paths = [prediction_directory / name for name in ("manifest.json", "predictions.jsonl", "receipt.json")]
    hashes = {path: file_hash(path) for path in paths}
    manifest = json.loads(paths[0].read_text(encoding="utf-8"))
    if manifest.get("contentHash") != hash_v1({key: value for key, value in manifest.items() if key != "contentHash"}):
        raise ValueError("Prediction manifest hash mismatch")
    semantics = replay_score_semantics(manifest)
    if (manifest.get("kind") != "uncalibrated_prediction_replay"
            or manifest.get("executionAllowed") is not False
            or manifest.get("predictionMode") != "fixed_panel" or manifest.get("sourceDatasetHash") != bundle["bundle_hash"]):
        raise ValueError("A compatible fixed-panel replay for this dataset is required")
    public_rows = read_jsonl(bundle_directory / "public.jsonl")
    label_rows = read_jsonl(bundle_directory / "labels.jsonl")
    public = {row["checkpoint_id"]: row for row in public_rows}
    labels = {row["checkpoint_id"]: row for row in label_rows}
    if len(public) != len(public_rows) or len(labels) != len(label_rows) or set(public) != set(labels):
        raise ValueError("Unique public checkpoints and matching private labels required")
    predictions = read_jsonl(paths[1])
    ids = [row["checkpoint_id"] for row in predictions]
    if not ids or ids != manifest.get("rowIds") or len(set(ids)) != len(ids):
        raise ValueError("Every declared prediction must be retained exactly once in order")
    hashes.update(verify_replay_receipt(prediction_directory, manifest, predictions))
    conditions = ("neutral", "conditional") if manifest.get("inferGoals") is True else ("neutral",)
    joined = []
    for row in predictions:
        key = row["checkpoint_id"]
        prefix, label = public.get(key), labels.get(key)
        if prefix is None or label is None or prefix["input_hash"] != hash_v1(prefix["input"]):
            raise ValueError("Prediction checkpoint is not a verified public input")
        if label.get("input_hash") != prefix["input_hash"] or any(row.get(field) != prefix[field] for field in ("input_hash", "family_id", "split")):
            raise ValueError("Prediction and label checkpoint identity mismatch")
        status = row.get("status")
        if status not in {"completed", "failed", "not_dispatched"}:
            raise ValueError("Unknown prediction status")
        panel_available = "candidatePanel" in row
        if not panel_available and status == "completed":
            raise ValueError("Completed replay omitted its fixed panel")
        panel = row.get("candidatePanel", [])
        candidates = row.get("candidates", [])
        candidate_map = {candidate["id"]: candidate for candidate in candidates}
        if len(candidate_map) != len(candidates) or set(panel) != set(candidate_map) or len(panel) > 3 or len(panel) != len(set(panel)):
            raise ValueError("Fixed panel differs from the supplied candidate set")
        if panel_available and row.get("panelHash") != hash_v1(sorted(panel)):
            raise ValueError("Fixed panel hash mismatch")
        identities = {candidate_id: hash_v1({"tool": value["invocation"]["tool"], "arguments": value["invocation"]["arguments"]}) for candidate_id, value in candidate_map.items()}
        if len(set(identities.values())) != len(identities):
            raise ValueError("Duplicate exact invocation in fixed panel")
        if not isinstance(label.get("eligible_reads"), list):
            raise ValueError("Explicit next-batch eligible read labels required")
        actual = sorted({hash_v1({"tool": invocation["tool"], "arguments": invocation["arguments"]}) for invocation in label["eligible_reads"]})
        for condition in conditions:
            probabilities = None
            scoring_status = "unobserved_actor_action" if label.get("status") == "no_returned_actor_response" else status
            if status == "completed":
                output = row.get(condition)
                if not isinstance(output, dict) or output.get("action") not in {"READ", "NO_READ", "READ_UNCOVERED"}:
                    raise ValueError("Completed replay omitted its condition output")
                scores = output.get("scores", [])
                if len(scores) != len(panel) or {score["candidateId"] for score in scores} != set(panel):
                    raise ValueError("Every panel candidate needs an explicit membership score")
                if scoring_status == "completed":
                    probabilities = {identities[score["candidateId"]]: score["probability"] for score in scores}
            exact_panel = sorted(identities.values())
            joined.append({"condition": condition, "checkpoint_id": key, "family_id": row["family_id"], "split": row["split"],
                           "probability_semantics": semantics["probabilitySemantics"], "raw_score_semantics": semantics.get("rawScoreSemantics"), "candidate_panel": exact_panel,
                           "panel_hash": hash_v1(exact_panel), "panel_available": panel_available, "actual_reads": actual,
                           "status": scoring_status, "probabilities": probabilities})
    report = score_candidate_panels(joined)
    report["prediction_manifest_hash"] = manifest["contentHash"]
    report["source_dataset_hash"] = bundle["bundle_hash"]
    report["probabilities"] = "recorded_raw_scores_no_evaluation_label_fitting"
    if any(file_hash(path) != digest for path, digest in hashes.items()):
        raise ValueError("Prediction replay changed during evaluation")
    return report, joined


def score_predictions(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Scores the declared exact-invocation universe, never true actor entropy."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    pool_hashes: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        key = row["condition"], row["checkpoint_id"]
        if key in seen:
            raise ValueError("Duplicate condition/checkpoint")
        seen.add(key)
        probabilities = row["probabilities"]
        if not probabilities or any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities.values()) or not math.isclose(sum(probabilities.values()), 1, abs_tol=1e-6):
            raise ValueError("Invalid probability distribution")
        if len(row["candidate_universe"]) != len(set(row["candidate_universe"])):
            raise ValueError("Duplicate candidate identity")
        allowed = {*row["candidate_universe"], "NO_READ", "READ_UNCOVERED"}
        if set(probabilities) != allowed:
            raise ValueError("Probabilities must cover the complete declared universe")
        if row["pool_hash"] != hash_v1(sorted(row["candidate_universe"])):
            raise ValueError("Candidate pool hash mismatch")
        pool_hashes[row["checkpoint_id"]].add(row["pool_hash"])
        groups[row["condition"]].append(row)
    summaries = {}
    for condition, values in groups.items():
        loss, brier, top1, top3, covered, no_read, no_read_correct = [], [], 0, 0, 0, 0, 0
        for row in values:
            actual = row["actual"]
            is_covered = actual == "NO_READ" or actual in row["candidate_universe"]
            target = actual if is_covered else "READ_UNCOVERED"
            distribution = row["probabilities"]
            rank = sorted(distribution, key=lambda key: (-distribution[key], key))
            loss.append(-math.log(max(distribution[target], 1e-12)))
            brier.append(sum((probability - float(key == target)) ** 2 for key, probability in distribution.items()))
            covered += is_covered
            top1 += is_covered and actual in rank[:1]
            top3 += is_covered and actual in rank[:3]
            if actual == "NO_READ":
                no_read += 1
                no_read_correct += rank[0] == actual
        summaries[condition] = {"checkpoints": len(values), "coverage_including_no_read": covered / len(values), "exact_top1": top1 / len(values), "exact_top3": top3 / len(values), "declared_universe_cross_entropy_nats": float(np.mean(loss)), "brier": float(np.mean(brier)), "no_read_examples": no_read, "no_read_specificity": no_read_correct / no_read if no_read else None}
    checkpoint_sets = [{row["checkpoint_id"] for row in values} for values in groups.values()]
    return {"conditions": summaries, "identical_candidate_pools": all(len(values) == 1 for values in pool_hashes.values()), "identical_checkpoint_sets": all(values == checkpoint_sets[0] for values in checkpoint_sets), "interpretation": "Exact invocation classification on a bounded universe; not true conditional entropy, task success, or execution hit rate"}
