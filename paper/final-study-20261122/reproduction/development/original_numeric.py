from __future__ import annotations
import json, math, re
from collections import Counter, defaultdict
from typing import Any, Literal
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

"""Shared runtime wire profile. The historical pilot canonicalizer stays unchanged."""
import hashlib
import math

import rfc8785


def canonical_v1(value) -> bytes:
    def check(node):
        if type(node) in {int, float} and (not math.isfinite(node) or abs(node) > 2**53 - 1):
            raise ValueError("Number outside shared wire profile")
        if isinstance(node, dict):
            for child in node.values():
                check(child)
        elif isinstance(node, list):
            for child in node:
                check(child)
    check(value)
    return rfc8785.dumps(value)


def hash_v1(value) -> str:
    return hashlib.sha256(canonical_v1(value)).hexdigest()

class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


MACHINE_PROTOCOL = "machine_audited_exploratory"


HUMAN_PROTOCOL = "human_reviewed"


REVIEWER = "gpt-5.4-2026-03-05"


INDEPENDENCE = "separate_request_and_prompt_same_model"


METADATA_KEYS = ("reviewProtocol", "humanReviewCount", "machineReviewCount", "machineAuditHash", "reviewerModel", "reviewIndependence")


def require(value: Any, message: str) -> None:
    if not value:
        raise ValueError(message)


def review_metadata(value: dict[str, Any]) -> dict[str, Any]:
    """Absent protocol remains the historical human mode; machine mode is explicit."""
    protocol = value.get("reviewProtocol", HUMAN_PROTOCOL)
    require(protocol in {HUMAN_PROTOCOL, MACHINE_PROTOCOL}, "Unknown annotation review protocol")
    if protocol == HUMAN_PROTOCOL:
        require(not value.get("machineReviewCount", 0) and not value.get("machineAuditHash")
                and not value.get("reviewerModel") and not value.get("reviewIndependence"),
                "Machine review cannot be admitted as human review")
        return {"reviewProtocol": HUMAN_PROTOCOL, "humanReviewCount": value.get("audited", value.get("humanReviewCount", 20)),
                "machineReviewCount": 0}
    require(type(value.get("humanReviewCount")) is int and type(value.get("machineReviewCount")) is int
            and value.get("humanReviewCount") == 0 and value.get("machineReviewCount") == 20
            and re.fullmatch(r"[a-f0-9]{64}", str(value.get("machineAuditHash", "")))
            and value.get("reviewerModel") == REVIEWER and value.get("reviewIndependence") == INDEPENDENCE,
            "Exploratory machine review requires its exact zero-human,20-model provenance")
    return {key: value[key] for key in METADATA_KEYS}


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


def summarize_costs(outcomes):
    unknown = sum(
        row.get("unknownProviderCharge", False) or row["billedUsd"] is None for row in outcomes
    )
    known = round(
        sum(row.get("knownUsageSubtotalUsd", row["billedUsd"] or 0) for row in outcomes), 6
    )
    return {
        "billedUsd": None if unknown else round(sum(row["billedUsd"] for row in outcomes), 6),
        "knownUsageSubtotalUsd": known,
        "unknownCharges": unknown,
    }


RUNTIME = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'


COUNTS = ('started', 'useful', 'wasted', 'rejected', 'cancel_requested', 'cancellation_confirmed', 'revalidation_completed')


def reproduce_original_sections(value):
    rows = value["rows"]
    actor_hash = value["actorConfigHash"]
    memory_hash = value["memorySnapshotHash"]
    plan = {"stage": value["stage"]}
    scopes = [{"protocol": {"annotationReview": value["annotationReview"]}}]
    design = TrialDesign.model_validate({'measurement_kind': 'live', 'label': 'Custom tau-compatible paired ' + plan['stage'],
        'source_commit': RUNTIME, 'actor_config_hash': actor_hash, 'memory_snapshot_hash': memory_hash,
        'frozen_before_execution': True, 'annotation_review': scopes[0]['protocol'].get('annotationReview'),
        'trials': [{'slot_id': row['runId'], 'task_id': row['taskId'], 'family_id': row['familyId'], 'domain': row['domain'],
            'trial': row['trial'], 'seed': row['seed'], 'arm': row['arm']} for row in rows]})
    def results(success='success', clock='totalTrialSeconds'):
        return [TrialResult.model_validate({'slot_id': row['runId'], 'run_id': row['runId'], 'status': row['status'],
            'success': row[success], 'latency_valid': row['timingValid'] and row[clock] is not None,
            'latency_ms': 1000 * row[clock] if row[clock] is not None else None, 'cost_usd': row['billedUsd'],
            'logical_calls': row['logicalCalls'], 'physical_calls': row['physicalCalls'], 'revalidation_calls': row['revalidationCalls'],
            'speculative_starts': row['schedulerCounts']['started'] if row['schedulerCounts'] is not None else None,
            'useful_speculations': row['schedulerCounts']['useful'] if row['schedulerCounts'] is not None else None,
            'constraint_violations': row['constraintViolations'], 'actor_config_hash': actor_hash, 'memory_snapshot_hash': memory_hash}) for row in rows]
    native = report_trials(design, results())
    clean = report_trials(design, results('knownConstraintCleanSuccess'))
    full = report_trials(design, results(clock='totalIncludingEvaluationSeconds'))
    # Public reporting groups two executions per task. These executions change
    # both actor and predictor seed in this frozen study, so this is not pass^2
    # for a single fixed checkpoint.
    consistency = 'joint_actor_and_predictor_seed_consistency'
    for report in (native, clean, full):
        for arm in report['arms'].values():
            arm[consistency] = arm.pop('two_trial_consistency')
        report['twoTrialInterpretation'] = 'Joint actor/predictor-seed consistency; not same-fixed-checkpoint pass^2'
    extra = {}
    for arm in native['arms']:
        group = [row for row in rows if row['arm'] == arm]
        cost = summarize_costs(group)
        families = defaultdict(list)
        for row in group:
            families[row['domain'] + ':' + row['familyId']].append(float(row['success']))
        interval = _paired_interval(families, seed=42, samples=2000)
        interval['weighting'] = 'equal_family_mean_of_native_completion_indicators'
        interval['trials'] = interval.pop('paired_trials')
        seed_metrics = {}
        for seed in sorted({row['predictorTrainingSeed'] for row in group}):
            subset = [row for row in group if row['predictorTrainingSeed'] == seed]
            seed_metrics[str(seed)] = {'declaredTrials': len(subset), 'nativeSuccesses': sum(row['success'] for row in subset),
                'knownConstraintCleanSuccesses': sum(row['knownConstraintCleanSuccess'] for row in subset),
                'actorSeeds': sorted({row['seed'] for row in subset})}
        extra[arm] = {'nativePass1FamilyBootstrap': interval, 'byPredictorTrainingSeed': seed_metrics,
            'constraintAuditCompleteTrials': sum(row['constraintAuditComplete'] for row in group),
            'knownConstraintCleanPass1': clean['arms'][arm]['pass1'], 'knownConstraintCleanJointSeedConsistency': clean['arms'][arm][consistency],
            'hostedUsage': {**cost, 'missingKnownSubtotalTrials': sum(row['knownUsageSubtotalMissing'] for row in group),
                'scope': 'hosted_user_and_judge_only', 'gpuCostsIncluded': False, 'invoiceVerified': False},
            'schedulerEvents': {kind: {'knownTotal': sum(row['schedulerCounts'][kind] for row in group if row['schedulerCounts'] is not None),
                'missingTrials': sum(row['schedulerCounts'] is None for row in group)} for kind in COUNTS},
            'nativeUnpromotedPhysicalCalls': {'knownTotal': sum(row['unpromotedCalls'] for row in group if row['unpromotedCalls'] is not None),
                'missingTrials': sum(row['unpromotedCalls'] is None for row in group)}}
    return {"nativeCompletionAndLiveLatency": native, "knownConstraintCleanPairedDifferences": clean["paired_comparisons"], "evaluatorInclusiveLatency": full, "additionalArmMetrics": extra, "predictorSeedTrialCounts": dict(Counter(str(row["predictorTrainingSeed"]) for row in rows))}
