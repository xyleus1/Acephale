"""Paired research measurements, with explicit denominators and no invented timings."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

import numpy as np
from pydantic import Field

from goalspec.schemas import Prediction, Record, Trajectory

NLL_FLOOR = 1e-12
UNKNOWN_GOAL = "__unknown__"


class ScoreRow(Record):
    condition: str
    trajectory_id: str
    benchmark: str
    domain: str
    task_id: str
    group_id: str
    trial: int = Field(ge=0)
    seq: int = Field(ge=0)
    actual_tool: str
    actual_arguments: dict[str, Any]
    prediction: Prediction | None = None
    expected_goal: str | None = None

    @property
    def step_key(self) -> tuple[str, int]:
        return self.trajectory_id, self.seq


class PairwiseEstimate(Record):
    baseline: str
    treatment: str
    baseline_nll: float
    treatment_nll: float
    improvement: float
    relative_improvement: float | None
    ci_lower: float
    ci_upper: float
    confidence: float = 0.95
    bootstrap_samples: int
    seed: int
    domains: tuple[str, ...]
    tasks: int
    clusters: int
    paired_steps: int
    nll_floor: float = NLL_FLOOR
    weighting: str = "macro_domain_task_equal_trial_equal_step_mean"


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def ranked(distribution: dict[str, float]) -> list[str]:
    return sorted(distribution, key=lambda item: (-distribution[item], item))


def negative_log_likelihood(row: ScoreRow) -> float:
    if row.prediction is None:
        raise ValueError(f"Condition {row.condition} has no predictor at {row.step_key}")
    return -math.log(max(row.prediction.tool_distribution.get(row.actual_tool, 0.0), NLL_FLOOR))


def _unique_rows(rows: Iterable[ScoreRow]) -> list[ScoreRow]:
    result = list(rows)
    keys = [(row.condition, *row.step_key) for row in result]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate prediction steps are not independent observations")
    return result


def score_predictions(rows: Iterable[ScoreRow]) -> dict[str, Any]:
    """Return micro step metrics per condition; paired_nll supplies the primary estimand.

    Full matches are candidate predictions, not execution hits. Runtime usefulness and
    saved latency require measured scheduler events and cannot be inferred here.
    """
    by_condition: dict[str, list[ScoreRow]] = defaultdict(list)
    for row in _unique_rows(rows):
        by_condition[row.condition].append(row)
    output: dict[str, Any] = {}
    for condition, condition_rows in sorted(by_condition.items()):
        predicted = [row for row in condition_rows if row.prediction is not None]
        if predicted and len(predicted) != len(condition_rows):
            raise ValueError(f"Partially missing predictions in condition {condition}")
        metrics: dict[str, Any] = {
            "steps": len(condition_rows),
            "prediction_steps": len(predicted),
            "nll_floor": NLL_FLOOR,
            "next_tool_nll": None,
            "tool_top1": None,
            "tool_top3": None,
            "tool_arguments_top1": None,
            "tool_arguments_top3": None,
            "argument_binding_coverage": None,
        }
        if predicted:
            tool_hits = {1: 0, 3: 0}
            full_hits = {1: 0, 3: 0}
            for row in predicted:
                assert row.prediction is not None
                tools = ranked(row.prediction.tool_distribution)
                candidates = sorted(
                    row.prediction.candidates,
                    key=lambda item: (-item.probability, item.tool, canonical_json(item.arguments)),
                )
                # A duplicated candidate must not consume a second top-k position.
                seen: set[tuple[str, str]] = set()
                unique = []
                for candidate in candidates:
                    identity = candidate.tool, canonical_json(candidate.arguments)
                    if identity not in seen:
                        seen.add(identity)
                        unique.append(candidate)
                for k in (1, 3):
                    tool_hits[k] += row.actual_tool in tools[:k]
                    full_hits[k] += any(
                        item.tool == row.actual_tool
                        and canonical_json(item.arguments) == canonical_json(row.actual_arguments)
                        for item in unique[:k]
                    )
            count = len(predicted)
            metrics.update(
                next_tool_nll=float(np.mean([negative_log_likelihood(row) for row in predicted])),
                tool_top1=tool_hits[1] / count,
                tool_top3=tool_hits[3] / count,
                tool_arguments_top1=full_hits[1] / count,
                tool_arguments_top3=full_hits[3] / count,
                argument_binding_coverage=sum(bool(row.prediction.candidates) for row in predicted) / count,
            )
        labeled = [row for row in condition_rows if row.expected_goal is not None]
        goal_rows = [
            row for row in labeled
            if row.prediction is not None and row.prediction.goal_posterior is not None
        ]
        goals: dict[str, Any] = {
            "labeled_steps": len(labeled),
            "label_coverage": len(labeled) / len(condition_rows),
            "unknown_label_steps": sum(row.expected_goal == UNKNOWN_GOAL for row in labeled),
            "posterior_steps": len(goal_rows),
            "posterior_coverage": len(goal_rows) / len(labeled) if labeled else None,
            "top1": None, "top3": None, "ece_10_bins": None, "brier": None,
            "unknown_prediction_rate": None, "unknown_recall": None,
        }
        if goal_rows:
            correct: list[bool] = []
            confidences: list[float] = []
            brier: list[float] = []
            top3 = 0
            unknown_predicted = 0
            unknown_actual = 0
            unknown_correct = 0
            for row in goal_rows:
                distribution = row.prediction.goal_posterior.probabilities
                order = ranked(distribution)
                correct.append(order[0] == row.expected_goal)
                confidences.append(distribution[order[0]])
                top3 += row.expected_goal in order[:3]
                support = set(distribution) | {row.expected_goal}
                brier.append(sum((distribution.get(goal, 0.0) - (goal == row.expected_goal)) ** 2 for goal in support))
                unknown_predicted += order[0] == UNKNOWN_GOAL
                unknown_actual += row.expected_goal == UNKNOWN_GOAL
                unknown_correct += row.expected_goal == UNKNOWN_GOAL and order[0] == UNKNOWN_GOAL
            ece = 0.0
            for bin_id in range(10):
                indexes = [index for index, confidence in enumerate(confidences) if min(int(confidence * 10), 9) == bin_id]
                if indexes:
                    ece += len(indexes) / len(goal_rows) * abs(
                        np.mean([correct[index] for index in indexes])
                        - np.mean([confidences[index] for index in indexes])
                    )
            goals.update(
                # Missing posteriors remain misses in labeled-step accuracy.
                top1=sum(correct) / len(labeled), top3=top3 / len(labeled),
                ece_10_bins=float(ece), brier=float(np.mean(brier)),
                unknown_prediction_rate=unknown_predicted / len(goal_rows),
                unknown_recall=unknown_correct / unknown_actual if unknown_actual else None,
            )
        metrics["goals"] = goals
        output[condition] = metrics
    return output


def paired_nll(
    rows: Iterable[ScoreRow],
    baseline: str = "paste",
    treatment: str = "oracle",
    *,
    seed: int = 0,
    bootstrap_samples: int = 2000,
) -> PairwiseEstimate:
    """Bootstrap whole template groups within domains, preserving paired task trials.

    Each trial averages its steps, each task averages its trials, and each domain
    averages its tasks. Domains receive equal weight. Sampling clusters preserves
    task/template and repeated-trial dependence; rows are never bootstrapped alone.
    """
    if bootstrap_samples < 100:
        raise ValueError("Use at least 100 bootstrap replicates")
    all_rows = _unique_rows(rows)
    left = {row.step_key: row for row in all_rows if row.condition == baseline}
    right = {row.step_key: row for row in all_rows if row.condition == treatment}
    if not left or set(left) != set(right):
        raise ValueError("Incomplete paired prediction cohort or absent condition")
    trial_losses: dict[tuple[str, str, str, str, int], list[tuple[float, float]]] = defaultdict(list)
    for key, base in left.items():
        other = right[key]
        fields = ("benchmark", "domain", "task_id", "group_id", "trial", "actual_tool", "expected_goal")
        if any(getattr(base, field) != getattr(other, field) for field in fields) or canonical_json(base.actual_arguments) != canonical_json(other.actual_arguments):
            raise ValueError("Paired conditions contain different authoritative observations or labels")
        trial_losses[(base.benchmark, base.domain, base.group_id, base.task_id, base.trial)].append(
            (negative_log_likelihood(base), negative_log_likelihood(other))
        )
    task_losses: dict[tuple[str, str, str, str], list[np.ndarray]] = defaultdict(list)
    for (benchmark, domain, group, task, _trial), losses in trial_losses.items():
        task_losses[(benchmark, domain, group, task)].append(np.mean(losses, axis=0))
    groups: dict[tuple[str, str], dict[str, list[np.ndarray]]] = defaultdict(lambda: defaultdict(list))
    for (benchmark, domain, group, _task), losses in task_losses.items():
        groups[(benchmark, domain)][group].append(np.mean(losses, axis=0))
    if any(len(domain_groups) < 2 for domain_groups in groups.values()):
        raise ValueError("Cluster confidence intervals require at least two template groups per domain")
    domain_arrays: list[np.ndarray] = []
    for domain in sorted(groups):
        # Sum of task means and number of tasks allow task-equal resampled estimates.
        domain_arrays.append(np.array([
            [*np.sum(tasks, axis=0), len(tasks)]
            for _, tasks in sorted(groups[domain].items())
        ]))
    point = np.mean([array[:, :2].sum(axis=0) / array[:, 2].sum() for array in domain_arrays], axis=0)
    rng = np.random.default_rng(seed)
    boot = np.zeros((bootstrap_samples, 2))
    for array in domain_arrays:
        indices = rng.integers(0, len(array), size=(bootstrap_samples, len(array)))
        sampled = array[indices].sum(axis=1)
        boot += sampled[:, :2] / sampled[:, 2, None] / len(domain_arrays)
    improvements = boot[:, 0] - boot[:, 1]
    lower, upper = np.quantile(improvements, [0.025, 0.975])
    return PairwiseEstimate(
        baseline=baseline, treatment=treatment,
        baseline_nll=float(point[0]), treatment_nll=float(point[1]),
        improvement=float(point[0] - point[1]),
        relative_improvement=float((point[0] - point[1]) / point[0]) if point[0] > 0 else None,
        ci_lower=float(lower), ci_upper=float(upper), bootstrap_samples=bootstrap_samples,
        seed=seed, domains=tuple(f"{benchmark}/{domain}" for benchmark, domain in sorted(groups)), tasks=len(task_losses),
        clusters=sum(map(len, groups.values())), paired_steps=len(left),
    )


def summarize_trials(trajectories: Iterable[Trajectory], ks: tuple[int, ...] = (1, 2, 4)) -> dict[str, Any]:
    """Native tau pass^k means all k trials succeed, not best-of-k pass@k."""
    traces = list(trajectories)
    if not traces:
        raise ValueError("Cannot summarize an empty cohort")
    identifiers = [trace.trajectory_id for trace in traces]
    trial_keys = [(trace.benchmark, trace.domain, trace.task_id, trace.trial) for trace in traces]
    if len(identifiers) != len(set(identifiers)) or len(trial_keys) != len(set(trial_keys)):
        raise ValueError("Duplicate trajectory or task trial")
    task_trials: dict[tuple[str, str, str], list[bool]] = defaultdict(list)
    native_task_trials: dict[tuple[str, str, str], list[bool]] = defaultdict(list)
    for trace in traces:
        # Native evaluators determine task success independently of the runtime
        # termination reason. For example, tau can award success at a step limit.
        task_trials[(trace.benchmark, trace.domain, trace.task_id)].append(
            trace.outcome.success is True
        )
        if not trace.outcome.native_excluded_from_success:
            native_task_trials[(trace.benchmark, trace.domain, trace.task_id)].append(
                trace.outcome.success is True
            )
    passes: dict[str, Any] = {}
    for k in ks:
        if k < 1:
            raise ValueError("pass^k requires positive k")
        insufficient = sum(len(trials) < k for trials in task_trials.values())
        passes[str(k)] = {
            "value": None if insufficient else float(np.mean([
                math.comb(sum(trials), k) / math.comb(len(trials), k)
                if sum(trials) >= k else 0.0
                for trials in task_trials.values()
            ])),
            "insufficient_tasks": insufficient,
        }
    times = [trace.total_elapsed_ms for trace in traces if trace.total_elapsed_ms is not None]
    successful = sum(sum(trials) for trials in task_trials.values())
    calls = sum(event.kind == "tool_request" for trace in traces for event in trace.events)
    native_traces = [trace for trace in traces if not trace.outcome.native_excluded_from_success]
    native_missing = sum(trace.outcome.success is None for trace in native_traces)
    native_passes = {}
    for k in ks:
        insufficient = sum(len(trials) < k for trials in native_task_trials.values())
        native_passes[str(k)] = {
            "value": None if insufficient or native_missing or not native_task_trials else float(np.mean([
                math.comb(sum(trials), k) / math.comb(len(trials), k)
                if sum(trials) >= k else 0.0
                for trials in native_task_trials.values()
            ])),
            "insufficient_tasks": insufficient,
        }
    return {
        "trials": len(traces), "tasks": len(task_trials), "successful_trials": successful,
        "task_success": successful / len(traces),
        "cohort_policy": "all_declared_trials_retained_no_native_infrastructure_exclusions",
        "resolved_native_success_trials": successful,
        "resolved_native_failure_trials": sum(trace.outcome.success is False for trace in traces),
        "retained_error_trials": sum(trace.outcome.status == "error" for trace in traces),
        "retained_incomplete_trials": sum(trace.outcome.status == "incomplete" for trace in traces),
        "successful_noncompleted_trials": sum(
            trace.outcome.success is True and trace.outcome.status != "completed" for trace in traces
        ),
        "native_exclusion_view": {
            "retained_in_full_cohort_but_excluded_by_native_scorer": sum(
                trace.outcome.native_excluded_from_success for trace in traces
            ),
            "excluded_trajectory_ids": [
                trace.trajectory_id for trace in traces if trace.outcome.native_excluded_from_success
            ],
            "trials": len(native_traces), "unresolved_outcomes": native_missing,
            "task_success": (
                sum(trace.outcome.success is True for trace in native_traces) / len(native_traces)
                if native_traces and not native_missing else None
            ),
            "pass_k_all_trials": native_passes,
        },
        "unresolved_outcomes_counted_unsuccessful": sum(trace.outcome.success is None for trace in traces),
        "pass_k_all_trials": passes,
        "authoritative_calls": calls,
        "authoritative_calls_per_successful_trial": calls / successful if successful else None,
        "latency": {
            "measured_trials": len(times), "missing_trials": len(traces) - len(times),
            "unit": "ms", "mean": float(np.mean(times)) if times else None,
            "p95": float(np.quantile(times, 0.95)) if times else None,
            "p99": float(np.quantile(times, 0.99)) if times else None,
            "complete_cohort": len(times) == len(traces),
        },
    }
