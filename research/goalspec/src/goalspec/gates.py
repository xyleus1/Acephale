"""Preregistered A/B evidence gates bound to complete input and artifact provenance."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from collections.abc import Iterable
from typing import Literal

from pydantic import Field

from goalspec.goals import canonical_goal
from goalspec.metrics import UNKNOWN_GOAL, PairwiseEstimate, ScoreRow, canonical_json, paired_nll
from goalspec.replay import decision_points
from goalspec.schemas import Record, Trajectory

GateStatus = Literal["passed", "failed", "insufficient_evidence"]


class GateEvidence(Record):
    benchmark: str
    split: str
    source_kind: Literal["benchmark", "synthetic"]
    declared_trajectory_ids: tuple[str, ...]
    declared_steps: tuple[tuple[str, int], ...]
    input_hashes: dict[str, str] = Field(default_factory=dict)
    artifact_hashes: dict[str, str] = Field(default_factory=dict)
    train_only_artifacts_verified: bool = False
    frozen_goal_ids: tuple[str, ...] = ()
    frozen_goal_scopes: dict[str, tuple[str, ...]] = Field(default_factory=dict)


class GateDecision(Record):
    status: GateStatus
    reasons: tuple[str, ...]
    estimate: PairwiseEstimate | None = None
    threshold: float
    observed_fraction: float | None = None


class GateReport(Record):
    schema_version: Literal[1] = 1
    status: GateStatus
    scheduler_allowed: bool
    evidence: GateEvidence
    experiment_a: GateDecision
    experiment_b: GateDecision
    score_rows_hash: str
    trajectories_hash: str
    goal_label_coverage: float
    unknown_goal_steps: int
    report_hash: str = ""

    def verify(self) -> None:
        """Detect modified JSON, including nested data in a frozen Pydantic object.

        This provides integrity, not a cryptographic attestation that a caller's
        experimental provenance is truthful. Artifact verification precedes gating.
        """
        expected = _digest(self.model_dump(mode="json", exclude={"report_hash"}))
        if self.report_hash != expected:
            raise ValueError("Gate report integrity check failed")
        if self.scheduler_allowed != (self.status == "passed"):
            raise ValueError("Gate report scheduler decision is inconsistent")


def _digest(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def goal_scope_key(benchmark: str, domain: str) -> str:
    return canonical_json([benchmark, domain])


def validate_task_endpoints(traces: Iterable[Trajectory]) -> None:
    """A reviewed endpoint is a task property and cannot vary with actor trials."""
    labels: dict[tuple[str, str, str], set[str | None]] = defaultdict(set)
    groups: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for trace in traces:
        key = (trace.benchmark, trace.domain, trace.task_id)
        goal = canonical_goal(trace)
        labels[key].add(goal.goal_id if goal is not None else None)
        groups[key].add(trace.group_id)
    if any(len(values) != 1 for values in labels.values()):
        raise ValueError("Canonical endpoint labels must remain identical across trials of a task")
    if any(len(values) != 1 for values in groups.values()):
        raise ValueError("Template group assignments must remain identical across trials of a task")


def _eligibility(
    rows: list[ScoreRow],
    traces: list[Trajectory],
    evidence: GateEvidence,
    conditions: tuple[str, ...],
) -> list[str]:
    reasons: list[str] = []
    if evidence.benchmark != "tau3" or any(trace.benchmark != "tau3" for trace in traces):
        reasons.append("Scientific gates require the preregistered tau3 cohort")
    if evidence.split != "development":
        reasons.append("Only development data may determine the A/B gates")
    if evidence.source_kind != "benchmark" or any(trace.source_kind != "benchmark" for trace in traces):
        reasons.append("Synthetic data may show diagnostics but cannot open the scheduler gate")
    configs: dict[str, set[tuple[str, str | None]]] = defaultdict(set)
    actor_models: dict[str, set[str]] = defaultdict(set)
    trial_seeds: dict[tuple[str, str], list[int]] = defaultdict(list)
    for trace in traces:
        if trace.source_kind != "benchmark":
            continue
        provenance = trace.provenance
        if provenance is None:
            reasons.append("Benchmark trials require captured model, configuration, seed, and source provenance")
            continue
        if not provenance.actor_model.strip() or provenance.actor_model in {"unknown", "unspecified"}:
            reasons.append("A pinned actor model identifier is required for benchmark trials")
        hashes = (
            provenance.actor_config_hash, provenance.user_config_hash,
            provenance.run_config_hash, provenance.raw_results_hash,
            provenance.public_context_hash, provenance.endpoint_labels_hash,
        )
        if any(value is None or not re.fullmatch(r"[a-f0-9]{64}", value) for value in hashes):
            reasons.append("Benchmark configuration, source, public-context, and endpoint-label hashes must be SHA-256")
        if provenance.capture_manifest_hash is not None and not re.fullmatch(r"[a-f0-9]{64}", provenance.capture_manifest_hash):
            reasons.append("Capture manifest hash must be a SHA-256 digest when supplied")
        configs[trace.domain].add((provenance.actor_config_hash, provenance.user_config_hash))
        actor_models[trace.domain].add(provenance.actor_model)
        if provenance.trial_seed is None:
            reasons.append("Every benchmark trial requires its recorded independent seed")
        else:
            trial_seeds[(trace.domain, trace.task_id)].append(provenance.trial_seed)
    if any(len(values) != 1 for values in configs.values()) or any(len(values) != 1 for values in actor_models.values()):
        reasons.append("Actor and user configurations must remain fixed within each domain")
    if any(len(values) != len(set(values)) for values in trial_seeds.values()):
        reasons.append("Repeated trials of a task require distinct recorded seeds")
    if not evidence.train_only_artifacts_verified:
        reasons.append("Training-only artifacts and their split boundaries must be verified")
    if not evidence.frozen_goal_ids or len(evidence.frozen_goal_ids) != len(set(evidence.frozen_goal_ids)):
        reasons.append("A nonempty frozen training goal ontology with unique IDs is required")
    if UNKNOWN_GOAL in evidence.frozen_goal_ids:
        reasons.append("The unknown-goal fallback must remain separate from learned endpoint IDs")
    if not evidence.frozen_goal_scopes:
        reasons.append("The frozen training ontology must declare benchmark/domain goal scopes")
    if any(len(ids) != len(set(ids)) or not set(ids) <= set(evidence.frozen_goal_ids) for ids in evidence.frozen_goal_scopes.values()):
        reasons.append("Scope goal IDs must be unique members of the frozen training ontology")
    if not evidence.input_hashes or not evidence.artifact_hashes:
        reasons.append("Input and frozen training-artifact hashes are required")
    if any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in [*evidence.input_hashes.values(), *evidence.artifact_hashes.values()]):
        reasons.append("Provenance hashes must be lowercase SHA-256 digests")
    if not traces:
        reasons.append("A nonempty declared cohort is required")
    identifiers = [trace.trajectory_id for trace in traces]
    if len(identifiers) != len(set(identifiers)):
        reasons.append("Duplicate trajectories in cohort")
    if len(evidence.declared_trajectory_ids) != len(set(evidence.declared_trajectory_ids)) or set(identifiers) != set(evidence.declared_trajectory_ids):
        reasons.append("Actual trajectories do not match the complete declared cohort")
    if len(evidence.declared_steps) != len(set(evidence.declared_steps)):
        reasons.append("Duplicate declared prediction steps")
    actual_steps = {
        (trace.trajectory_id, event.seq)
        for trace in traces for event in trace.events if event.kind == "tool_request"
    }
    if not actual_steps or actual_steps != set(evidence.declared_steps):
        reasons.append("Declared steps must contain every authoritative tool request")
    if any(trace.outcome.status == "incomplete" or trace.outcome.success is None for trace in traces):
        reasons.append("Every declared trial needs a resolved outcome, including failures")
    if any(not trace.benchmark_revision or trace.benchmark_revision in {"unknown", "unverified"} for trace in traces):
        reasons.append("Every benchmark trajectory requires a pinned revision")
    trials: dict[tuple[str, str], list[int]] = defaultdict(list)
    task_groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    revisions: dict[str, set[str]] = defaultdict(set)
    for trace in traces:
        trials[(trace.domain, trace.task_id)].append(trace.trial)
        task_groups[(trace.domain, trace.task_id)].add(trace.group_id)
        revisions[trace.domain].add(trace.benchmark_revision)
    if any(len(versions) != 1 for versions in revisions.values()):
        reasons.append("Benchmark revisions must be consistent within each domain")
    if any(trace.outcome.goal is None for trace in traces):
        reasons.append("Every declared trial requires an offline endpoint label, including failures")
    if any(not next((
        event.content for event in trace.events
        if event.kind == "message" and event.role == "user"
        and event.seq < min((item.seq for item in trace.events if item.kind == "tool_request"), default=float("inf"))
    ), "") for trace in traces):
        reasons.append("Every trial requires a nonempty initial user query visible before action")
    if any(len(numbers) != len(set(numbers)) for numbers in trials.values()):
        reasons.append("Duplicate trial seeds/identifiers for a task")
    if any(len(set(numbers)) < 4 for numbers in trials.values()):
        reasons.append("At least four independently recorded trials per task are required")
    if any(len(groups) != 1 for groups in task_groups.values()):
        reasons.append("Task/template group assignments must remain fixed across trials")
    try:
        validate_task_endpoints(traces)
    except ValueError as error:
        reasons.append(str(error))
    by_id = {trace.trajectory_id: trace for trace in traces}
    normalized_goals = {trace.trajectory_id: canonical_goal(trace) for trace in traces}
    causal_boundaries: dict[tuple[str, int], int] = {}
    invalid_tool_steps: set[tuple[str, int]] = set()
    for trace in traces:
        requests = {event.call_id for event in trace.events if event.kind == "tool_request"}
        resolved = {event.call_id for event in trace.events if event.kind == "tool_result"}
        if requests != resolved:
            reasons.append("Unresolved authoritative tool calls make the recorded trajectory incomplete")
        try:
            for point in decision_points(trace):
                catalog = {tool.name for tool in point.prefix.tools}
                for target in point.targets:
                    causal_boundaries[(trace.trajectory_id, target.seq)] = point.prefix.through_seq
                    if target.tool not in catalog:
                        invalid_tool_steps.add((trace.trajectory_id, target.seq))
                        result = next((
                            event for event in trace.events
                            if event.kind == "tool_result" and event.call_id == target.call_id
                        ), None)
                        if result is None or result.status != "error":
                            reasons.append("Invalid observed tool requests require a recorded error result")
        except ValueError as error:
            reasons.append(f"Invalid causal replay: {error}")
    expected_events = {
        (trace.trajectory_id, event.seq): event
        for trace in traces for event in trace.events if event.kind == "tool_request"
    }
    for condition in conditions:
        selected = [row for row in rows if row.condition == condition]
        keys = [row.step_key for row in selected]
        if len(keys) != len(set(keys)) or set(keys) != actual_steps:
            reasons.append(f"Incomplete or duplicated paired steps for condition {condition}")
        for row in selected:
            trace = by_id.get(row.trajectory_id)
            event = expected_events.get(row.step_key)
            if trace is None or event is None:
                continue
            fields = ("benchmark", "domain", "task_id", "group_id", "trial")
            if any(getattr(row, field) != getattr(trace, field) for field in fields):
                reasons.append(f"Prediction metadata differs from trace in condition {condition}")
                break
            if event.tool != row.actual_tool or canonical_json(event.arguments) != canonical_json(row.actual_arguments):
                reasons.append(f"Prediction target differs from actual trace in condition {condition}")
                break
            if row.prediction is None:
                reasons.append(f"Missing predictor output in condition {condition}")
                break
            posterior = row.prediction.goal_posterior
            if posterior is not None and posterior.through_seq > causal_boundaries.get(row.step_key, -1):
                reasons.append(f"Goal posterior includes information beyond the pre-batch boundary in condition {condition}")
                break
            if row.step_key in invalid_tool_steps and row.prediction.tool_distribution.get(row.actual_tool, 0) != 0:
                reasons.append(f"Invalid observed tool requests must have zero prediction probability in condition {condition}")
                break
            if row.expected_goal is None:
                reasons.append(f"Missing normalized goal labels in condition {condition}")
                break
            normalized_goal = normalized_goals[trace.trajectory_id]
            if normalized_goal is not None:
                expected_goal = (
                    normalized_goal.goal_id
                    if normalized_goal.goal_id in evidence.frozen_goal_scopes.get(goal_scope_key(trace.benchmark, trace.domain), ()) else UNKNOWN_GOAL
                )
                if row.expected_goal != expected_goal:
                    reasons.append(f"Goal labels do not match the frozen ontology in condition {condition}")
                    break
    return list(dict.fromkeys(reasons))


def evaluate_gates(
    rows: Iterable[ScoreRow],
    trajectories: Iterable[Trajectory],
    evidence: GateEvidence,
    *,
    baseline: str = "paste",
    oracle: str = "oracle",
    inferred: str = "goalspec",
    seed: int = 0,
    bootstrap_samples: int = 2000,
) -> GateReport:
    """Compute diagnostics even when synthetic/unverified inputs cannot pass.

    Thresholds are fixed here before inspecting any data: oracle relative NLL
    reduction >= 10%, inferred recovery >= 25%, both lower 95% bounds > 0.
    """
    predictions = list(rows)
    traces = list(trajectories)
    reasons = _eligibility(predictions, traces, evidence, (baseline, oracle, inferred))
    estimates: dict[str, PairwiseEstimate | None] = {}
    estimate_errors: dict[str, str] = {}
    for condition in (oracle, inferred):
        try:
            estimates[condition] = paired_nll(
                predictions, baseline=baseline, treatment=condition,
                seed=seed, bootstrap_samples=bootstrap_samples,
            )
        except ValueError as error:
            estimates[condition] = None
            estimate_errors[condition] = str(error)
    oracle_estimate = estimates[oracle]
    inferred_estimate = estimates[inferred]
    oracle_fraction = oracle_estimate.relative_improvement if oracle_estimate else None
    recovery = (
        inferred_estimate.improvement / oracle_estimate.improvement
        if oracle_estimate and inferred_estimate and oracle_estimate.improvement > 0 else None
    )
    a_reasons = [*reasons, *([estimate_errors[oracle]] if oracle in estimate_errors else [])]
    b_reasons = [*reasons, *([estimate_errors[inferred]] if inferred in estimate_errors else [])]
    if oracle in estimate_errors:
        b_reasons.append("Oracle improvement could not be estimated")
    a_status: GateStatus = "insufficient_evidence" if a_reasons else "passed"
    b_status: GateStatus = "insufficient_evidence" if b_reasons else "passed"
    if not a_reasons:
        assert oracle_estimate is not None
        if oracle_fraction is None or oracle_fraction < 0.10:
            a_reasons.append("Oracle relative held-out NLL reduction is below 10%")
        if oracle_estimate.ci_lower <= 0:
            a_reasons.append("Oracle paired 95% interval does not exclude zero improvement")
        a_status = "failed" if a_reasons else "passed"
    if not b_reasons:
        assert inferred_estimate is not None
        if recovery is None or recovery < 0.25:
            b_reasons.append("Inferred goals recover less than 25% of the positive oracle gap")
        if inferred_estimate.ci_lower <= 0:
            b_reasons.append("Inferred paired 95% interval does not exclude zero improvement")
        b_status = "failed" if b_reasons else "passed"
    statuses = {a_status, b_status}
    status: GateStatus = (
        "insufficient_evidence" if "insufficient_evidence" in statuses
        else "failed" if "failed" in statuses else "passed"
    )
    report = GateReport(
        status=status, scheduler_allowed=status == "passed", evidence=evidence,
        experiment_a=GateDecision(
            status=a_status, reasons=tuple(a_reasons), estimate=oracle_estimate,
            threshold=0.10, observed_fraction=oracle_fraction,
        ),
        experiment_b=GateDecision(
            status=b_status, reasons=tuple(b_reasons), estimate=inferred_estimate,
            threshold=0.25, observed_fraction=recovery,
        ),
        score_rows_hash=_digest([
            row.model_dump(mode="json")
            for row in sorted(predictions, key=lambda row: (row.condition, *row.step_key))
        ]),
        trajectories_hash=_digest([
            trace.model_dump(mode="json")
            for trace in sorted(traces, key=lambda trace: trace.trajectory_id)
        ]),
        goal_label_coverage=(
            sum(row.expected_goal is not None for row in predictions if row.condition == oracle)
            / sum(row.condition == oracle for row in predictions)
            if any(row.condition == oracle for row in predictions) else 0.0
        ),
        unknown_goal_steps=sum(
            row.expected_goal == UNKNOWN_GOAL for row in predictions if row.condition == oracle
        ),
    )
    result = report.model_copy(update={"report_hash": _digest(report.model_dump(mode="json", exclude={"report_hash"}))})
    result.verify()
    return result
