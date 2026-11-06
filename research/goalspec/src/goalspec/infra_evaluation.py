"""Closed-cohort paired infrastructure reporting with explicit missing telemetry."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Literal

import numpy as np
from pydantic import Field, model_validator

from goalspec.contracts_v1 import hash_v1
from goalspec.schemas import Record

ARMS = ("base", "neutral_memory_prefetch", "goalspec")
Arm = Literal["base", "neutral_memory_prefetch", "goalspec"]


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
    schema_version: Literal["goalspec-infra-evaluation-v1"] = "goalspec-infra-evaluation-v1"
    measurement_kind: Literal["live", "execution_replay", "deterministic_integration"]
    label: str = Field(min_length=1)
    source_commit: str = Field(min_length=1)
    actor_config_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    memory_snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    frozen_before_execution: Literal[True]
    trials: tuple[TrialSlot, ...] = Field(min_length=3)

    @model_validator(mode="after")
    def paired_blocks(self) -> TrialDesign:
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
    for baseline, treatment in (("base", "neutral_memory_prefetch"), ("base", "goalspec"), ("neutral_memory_prefetch", "goalspec")):
        metrics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for key, block in by_pair.items():
            left, right = block[baseline], block[treatment]
            family = f"{key[0]}:{key[1]}"
            metrics["success_difference"][family].append(float(right.success) - float(left.success))
            if left.latency_valid and right.latency_valid:
                metrics["latency_ms_difference"][family].append(right.latency_ms - left.latency_ms)
            if left.physical_calls is not None and right.physical_calls is not None:
                metrics["physical_calls_difference"][family].append(right.physical_calls - left.physical_calls)
        comparisons.append({"baseline": baseline, "treatment": treatment, "metrics": {metric: _paired_interval(metrics[metric], seed=seed, samples=bootstrap_samples) for metric in ("success_difference", "latency_ms_difference", "physical_calls_difference")}})
    return {
        "schema_version": design.schema_version, "measurement_kind": design.measurement_kind,
        "label": design.label, "design_hash": hash_v1(design.model_dump(mode="json")),
        "results_hash": hash_v1([row.model_dump(mode="json") for row in sorted(results, key=lambda row: row.slot_id)]),
        "arms": summaries, "paired_comparisons": comparisons,
        "limitations": ["Usage-derived costs are not invoice-reconciled", "Missing telemetry is never imputed as zero", "Execution replay timing is not live latency", "Task success and exact-read prediction use different denominators"],
    }


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
