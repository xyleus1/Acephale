"""Measurements for three-arm live trials and frozen prediction replay.

Every outcome remains in the declared cohort. Missing telemetry is unmeasured,
never zero. Bootstrap units are complete families, stratified by domain.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from goalspec.contracts_v1 import hash_v1
from goalspec.live_design import ARMS

COUNT_FIELDS = (
    "authoritativeCalls", "speculativeCalls", "usefulCalls", "wastedCalls",
    "rejectedCalls", "cancelledCalls", "revalidationCalls", "freshnessChecks",
)
NLL_FLOOR = 1e-12


class TrialResult(BaseModel):
    """Additive native runner telemetry, with required identity and verdict fields."""

    model_config = ConfigDict(extra="allow", frozen=True, allow_inf_nan=False)
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    experimentId: str
    snapshotId: str
    familyId: str
    domain: str
    taskId: str
    variant: int | str
    trial: int = Field(ge=0)
    seed: int = Field(ge=0)
    arm: Literal["base", "neutral_memory_prefetch", "goalspec"]
    success: bool
    constraintViolations: int = Field(ge=0)
    termination: str
    latencyMs: float | None = Field(default=None, ge=0)
    billedUsd: float | None = Field(default=None, ge=0)
    authoritativeCalls: int | None = Field(default=None, ge=0)
    speculativeCalls: int | None = Field(default=None, ge=0)
    usefulCalls: int | None = Field(default=None, ge=0)
    wastedCalls: int | None = Field(default=None, ge=0)
    rejectedCalls: int | None = Field(default=None, ge=0)
    cancelledCalls: int | None = Field(default=None, ge=0)
    revalidationCalls: int | None = Field(default=None, ge=0)
    freshnessChecks: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def consistent_outcome(self):
        if any(not value for value in (self.experimentId, self.snapshotId, self.familyId,
                                        self.domain, self.taskId, self.termination)):
            raise ValueError("Trial identity and termination cannot be empty")
        if self.success and (self.constraintViolations or "budget" in self.termination.lower()
                             or self.model_extra.get("budget_terminated", False)):
            raise ValueError("Constraint violations and budget terminations are failures")
        if self.usefulCalls is not None and self.speculativeCalls is not None and self.usefulCalls > self.speculativeCalls:
            raise ValueError("Useful executions cannot exceed speculative starts")
        return self

    @property
    def pair_key(self):
        return self.familyId, self.taskId, str(self.variant), self.trial


def _mean(values):
    return float(np.mean(values)) if len(values) else None


def _cluster_values(rows: Iterable[Any], value: Callable[[Any], float]):
    by_family = defaultdict(list)
    for row in rows:
        by_family[(row.domain, row.familyId)].append(value(row))
    by_domain = defaultdict(list)
    for (domain, family), values in sorted(by_family.items()):
        by_domain[domain].append((family, float(np.mean(values))))
    return by_domain


def cluster_interval(rows, value, *, seed=42, bootstrap_samples=2000):
    """Equal domains, equal family means; each cluster keeps all its trials."""
    if bootstrap_samples < 100:
        raise ValueError("At least 100 bootstrap samples required")
    by_domain = _cluster_values(rows, value)
    arrays = [np.asarray([item[1] for item in values]) for values in by_domain.values()]
    result = {
        "estimate": _mean([float(a.mean()) for a in arrays]),
        "ci95": None, "families": sum(map(len, arrays)), "domains": len(arrays),
        "weighting": "equal_domain_equal_family_equal_observation_within_family",
        "bootstrapSamples": bootstrap_samples, "bootstrapSeed": seed,
    }
    if not arrays or any(len(a) < 2 for a in arrays):
        result["intervalUnavailable"] = "At least two independent families in every domain required"
        return result
    rng = np.random.default_rng(seed)
    draws = np.mean([
        a[rng.integers(0, len(a), size=(bootstrap_samples, len(a)))].mean(axis=1)
        for a in arrays
    ], axis=0)
    result["ci95"] = np.quantile(draws, [0.025, 0.975]).tolist()
    return result


def validate_trials(rows: list[TrialResult], expected: list[dict] | None = None):
    if not rows:
        raise ValueError("Live results are empty")
    if len({r.experimentId for r in rows}) != 1 or len({r.snapshotId for r in rows}) != 1:
        raise ValueError("Cannot pool different experiments or frozen snapshots")
    keys = [(r.arm, *r.pair_key) for r in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate trial result")
    identities = defaultdict(set)
    families = defaultdict(set)
    for row in rows:
        identities[row.pair_key].add((row.seed, row.domain))
        families[row.familyId].add(row.domain)
    if any(len(value) != 1 for value in identities.values()):
        raise ValueError("Paired arms must share seed and domain")
    if any(len(value) != 1 for value in families.values()):
        raise ValueError("A family cannot span domains")
    by_arm = {arm: {r.pair_key for r in rows if r.arm == arm} for arm in ARMS}
    if any(value != by_arm[ARMS[0]] for value in by_arm.values()):
        raise ValueError("The complete three-arm paired cohort is required, including failures")
    if expected is not None:
        # Existing live_design manifests identify variants without a redundant task ID.
        expected_keys = [(str(t.get("familyId", t.get("family"))), str(t["variant"]),
                          t["trial"], t["arm"]) for t in expected]
        actual = [(r.familyId, str(r.variant), r.trial, r.arm) for r in rows]
        if len(set(expected_keys)) != len(expected_keys) or set(actual) != set(expected_keys):
            raise ValueError("Results do not cover the frozen predeclared design")
        expected_seed = {key: t["seed"] for key, t in zip(expected_keys, expected, strict=True)}
        if any(row.seed != expected_seed[key] for key, row in zip(actual, rows, strict=True)):
            raise ValueError("Trial seed differs from the frozen design")


def _telemetry(rows, key):
    values = [getattr(row, key) for row in rows if getattr(row, key) is not None]
    return {"measuredTrials": len(values), "missingTrials": len(rows) - len(values),
            "sum": sum(values) if len(values) == len(rows) else None,
            "observedSum": sum(values) if values else None}


def summarize_live(rows: list[TrialResult], *, expected=None, seed=42, bootstrap_samples=2000):
    validate_trials(rows, expected)
    metrics = {}
    for arm in ARMS:
        cohort = [row for row in rows if row.arm == arm]
        tasks = defaultdict(list)
        for row in cohort:
            tasks[(row.familyId, row.taskId, str(row.variant))].append(row)
        successes = sum(row.success for row in cohort)
        times = [row.latencyMs for row in cohort if row.latencyMs is not None]
        complete_pairs = [values for values in tasks.values() if len(values) == 2]
        counts = {key: _telemetry(cohort, key) for key in COUNT_FIELDS}
        all_physical = [row.authoritativeCalls + row.speculativeCalls + row.revalidationCalls
                        for row in cohort if all(getattr(row, k) is not None for k in
                                                 ("authoritativeCalls", "speculativeCalls", "revalidationCalls"))]
        spec = counts["speculativeCalls"]["sum"]
        useful = counts["usefulCalls"]["sum"]
        metrics[arm] = {
            "trials": len(cohort), "tasks": len(tasks), "families": len({r.familyId for r in cohort}),
            "successes": successes, "nativeSuccess": successes / len(cohort),
            "successInterval": cluster_interval(cohort, lambda r: float(r.success), seed=seed, bootstrap_samples=bootstrap_samples),
            "constraintViolations": sum(row.constraintViolations for row in cohort),
            "constraintCompliantTrials": sum(row.constraintViolations == 0 for row in cohort),
            "budgetTerminations": sum("budget" in row.termination.lower() or row.model_extra.get("budget_terminated", False) for row in cohort),
            "terminationCounts": {key: sum(r.termination == key for r in cohort) for key in sorted({r.termination for r in cohort})},
            "pass1": _mean([_mean([float(r.success) for r in values]) for values in tasks.values()]),
            "twoTrialConsistency": {
                "eligibleTasks": len(complete_pairs), "ineligibleTasks": len(tasks) - len(complete_pairs),
                "bothSucceed": _mean([float(all(r.success for r in values)) for values in complete_pairs]),
                "sameOutcome": _mean([float(len({r.success for r in values}) == 1) for values in complete_pairs]),
            },
            "calls": counts,
            "authoritativeCallsPerSuccessfulTask": counts["authoritativeCalls"]["sum"] / successes if successes and counts["authoritativeCalls"]["sum"] is not None else None,
            "physicalCallsPerSuccessfulTask": sum(all_physical) / successes if successes and len(all_physical) == len(cohort) else None,
            "speculationHitRate": useful / spec if spec and useful is not None else None,
            "billedUsd": {**_telemetry(cohort, "billedUsd"),
                          "measurement": "provider_reported_usage_times_configured_standard_prices",
                          "invoiceReconciled": False},
            "latency": {"measurement": "whole_live_trial_including_prediction_and_validation", "unit": "ms",
                        "measuredTrials": len(times), "missingTrials": len(cohort) - len(times),
                        "mean": _mean(times), "median": float(np.median(times)) if times else None,
                        "p95": float(np.quantile(times, .95)) if times else None,
                        "p99": float(np.quantile(times, .99)) if times else None,
                        "maximum": max(times) if times else None},
        }
    comparisons = []
    for baseline, treatment in (("base", "neutral_memory_prefetch"), ("base", "goalspec"), ("neutral_memory_prefetch", "goalspec")):
        controls = {row.pair_key: row for row in rows if row.arm == baseline}
        treated = [row for row in rows if row.arm == treatment]
        for metric, sign in (("success", 1), ("latencyMs", -1), ("billedUsd", -1), ("authoritativeCalls", -1)):
            paired = [row for row in treated if getattr(row, metric) is not None and getattr(controls[row.pair_key], metric) is not None]
            estimate = cluster_interval(paired, lambda row, s=sign, m=metric, c=controls: s * (getattr(row, m) - getattr(c[row.pair_key], m)), seed=seed, bootstrap_samples=bootstrap_samples)
            comparisons.append({"baseline": baseline, "treatment": treatment, "metric": metric,
                                "direction": "positive_favors_treatment", "pairedTrials": len(paired),
                                "missingPairs": len(treated) - len(paired), **estimate})
    return {"schemaVersion": "1.0.0", "label": "custom tau-compatible pilot",
            "experimentId": rows[0].experimentId, "snapshotId": rows[0].snapshotId,
            "cohortPolicy": "all_predeclared_trials_retained_failures_never_replaced",
            "designVerified": expected is not None, "arms": metrics, "pairedDifferences": comparisons,
            "definitions": {"pass1": "mean per-task trial success; not best-of-k",
                            "bothSucceed": "all two declared trials succeed; not pass@2",
                            "callsPerSuccessfulTask": "all trial calls divided by successful trial count",
                            "physicalCalls": "executed authoritative calls after promotions plus speculative executions plus validation DB/tool rereads; excludes native freshness lease checks",
                            "revalidationCalls": "physical DB/tool rereads for freshness validation; native snapshot leases perform no such rereads",
                            "freshnessChecks": "native Python freshness lease validation calls, counted separately from physical DB/tool rereads; overhead remains included in whole-trial latency",
                            "usefulCalls": "verified exact-call speculative reuse, a lower bound on broader usefulness; evidence may influence actor decisions without a matching call",
                            "wastedCalls": "speculative executions unused by an exact matching call, an upper bound on waste; this does not establish absence of semantic influence from exposed evidence",
                            "speculationHitRate": "verified exact-call reuse divided by physical speculative executions; not a measure of all evidence influence",
                            "billedUsd": "legacy field name for provider-reported usage priced at configured standard rates; usage-calculated cost, not invoice-reconciled charges; unknown usage stays unmeasured",
                            "intervals": "exploratory percentile 95% family-clustered bootstrap intervals; unadjusted multiple comparisons",
                            "latencyTail": "observed sample quantiles, with counts; not stable population-tail guarantees"}}


def _format(value, *, percent=False):
    if value is None:
        return "unmeasured"
    return f"{value * 100:.1f}%" if percent else f"{value:.4f}"


def publish_live_report(rows: list[TrialResult], output: Path, *, expected=None, seed=42, bootstrap_samples=2000):
    result = summarize_live(rows, expected=expected, seed=seed, bootstrap_samples=bootstrap_samples)
    output.mkdir(parents=True, exist_ok=False)
    files = {"summary.json": result, "trial-results.jsonl": [r.model_dump(mode="json") for r in rows]}
    (output / "summary.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (output / "trial-results.jsonl").write_text("".join(json.dumps(r, allow_nan=False) + "\n" for r in files["trial-results.jsonl"]), encoding="utf-8")
    lines = ["# GoalSpec local live evaluation", "", "Custom tau-compatible pilot. This is not an official full-benchmark score.", "",
             "Every declared outcome, including budget and infrastructure failures, remains in the cohort. "
             "Reported latency includes actor, prediction, tools, freshness validation and orchestration. "
             "Frozen replay timing is reported separately. Costs use provider-reported usage and configured standard prices; "
             "they are not reconciled against an invoice.", "",
             "| Arm | Trials | Success | pass^1 | Both trials succeed | Mean latency ms | p95 ms (n) | Usage-priced USD |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    csv_rows = []
    for arm, metric in result["arms"].items():
        latency = metric["latency"]
        lines.append(f"| {arm} | {metric['trials']} | {_format(metric['nativeSuccess'], percent=True)} | {_format(metric['pass1'], percent=True)} | {_format(metric['twoTrialConsistency']['bothSucceed'], percent=True)} | {_format(latency['mean'])} | {_format(latency['p95'])} ({latency['measuredTrials']}) | {_format(metric['billedUsd']['sum'])} |")
        csv_rows.append({"arm": arm, "trials": metric["trials"], "nativeSuccess": metric["nativeSuccess"],
                         "pass1": metric["pass1"], "bothSucceed": metric["twoTrialConsistency"]["bothSucceed"],
                         "latencyMeanMs": latency["mean"], "p95Ms": latency["p95"], "latencySamples": latency["measuredTrials"],
                         "usagePricedUsd": metric["billedUsd"]["sum"],
                         **{key: value["sum"] for key, value in metric["calls"].items()}})
    lines.extend(["", "| Arm | Authoritative executions | Speculative executions | Exact-call reuse | Unmatched executions | Rejected | Cancelled | Validation DB/tool rereads | Native lease checks |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"])
    for arm, metric in result["arms"].items():
        counts = [str(metric["calls"][key]["sum"]) if metric["calls"][key]["sum"] is not None else "unmeasured" for key in COUNT_FIELDS]
        lines.append(f"| {arm} | " + " | ".join(counts) + " |")
    lines.extend(["", "Native freshness lease checks are counted separately from validation DB/tool rereads and are included in measured live latency. "
                  "Exact-call reuse is a lower bound on broader usefulness. Unmatched speculative executions are an upper bound on waste: "
                  "verified evidence exposed to the actor may influence decisions without a matching tool call."])
    lines.extend(["", "Paired estimates use equal domain and family weights. Confidence intervals resample complete "
                  "families within domains. They are exploratory and not adjusted for multiple comparisons.", "",
                  "| Comparison | Metric | Improvement | Family-clustered 95% interval | Paired trials |",
                  "| --- | --- | ---: | --- | ---: |"])
    for value in result["pairedDifferences"]:
        interval = value["ci95"]
        ci = f"[{interval[0]:.4f}, {interval[1]:.4f}]" if interval else "unavailable"
        metric_label = "usage-priced USD" if value["metric"] == "billedUsd" else value["metric"]
        lines.append(f"| {value['treatment']} vs {value['baseline']} | {metric_label} | {_format(value['estimate'])} | {ci} | {value['pairedTrials']} |")
    lines.extend(["", "Positive improvement favors the treatment. A favorable replay result does not establish "
                  "live success or latency improvement. No superiority over upstream PASTE or state of the art is claimed. "
                  "Complete call accounting, missing telemetry, constraints, failures and tail counts are in summary.json.", ""])
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    with (output / "arms.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(csv_rows[0]))
        writer.writeheader()
        writer.writerows(csv_rows)
    import hashlib
    manifest = {"schemaVersion": "1.0.0", "inputHash": hash_v1(files["trial-results.jsonl"]),
                "designHash": hash_v1(expected) if expected is not None else None,
                "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(output.iterdir())}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return result
