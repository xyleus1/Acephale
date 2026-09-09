from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np


OUTPUT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = OUTPUT_ROOT.parents[1]
DEFAULT_BENCHMARK_ROOT = REPO_ROOT / ".benchmark-output" / "publication-benchmark"
DATA_DIR = OUTPUT_ROOT / "data"
FIGURES_DIR = OUTPUT_ROOT / "figures"
LINKEDIN_DIR = OUTPUT_ROOT / "linkedin"
NOTES_DIR = OUTPUT_ROOT / "notes"
CONTACT_SHEET_DIR = OUTPUT_ROOT / "contact-sheet"

PROFILE_SIZES = {
    "graph-small": 10_000,
    "graph-medium": 50_000,
    "graph-large": 250_000,
}
PROFILE_ORDER = ["graph-small", "graph-medium", "graph-large"]
EXPECTED_SYSTEM_ORDER = [
    "CURRENT_KEYWORD",
    "VECTOR_RAG",
    "STRONG_HYBRID_RAG",
    "DERYA_COLD",
    "DERYA_HOT",
]
SYSTEM_LABELS = {
    "CURRENT_KEYWORD": "Current Keyword",
    "VECTOR_RAG": "Vector RAG",
    "STRONG_HYBRID_RAG": "Strong Hybrid RAG",
    "DERYA_COLD": "Derya Cold",
    "DERYA_HOT": "Derya Hot",
}
NON_DERYA_SYSTEMS = {"CURRENT_KEYWORD", "VECTOR_RAG", "STRONG_HYBRID_RAG"}
QUERY_TYPE_ORDER = [
    "exact",
    "semantic",
    "current_vs_stale",
    "temporal",
    "entity_hop",
    "routing_tenant",
    "autopilot_action",
]
QUERY_TYPE_LABELS = {
    "exact": "Exact lookup",
    "semantic": "Semantic",
    "current_vs_stale": "Current vs stale",
    "temporal": "Temporal explanation",
    "entity_hop": "Entity hop",
    "routing_tenant": "Routing / tenant",
    "autopilot_action": "Autopilot action",
}

BOOTSTRAP_SAMPLES = 10_000
BOOTSTRAP_SEED = 20_260_827
MINIMUM_MEASURED_PASSES = 10
MINIMUM_WARMUP_PASSES = 3
EXPECTED_CASES_PER_PROFILE = 200

NUMERIC_COLUMNS = [
    "latency_ms",
    "retrieval_ms",
    "hydration_ms",
    "validation_ms",
    "recall_at_5",
    "recall_at_10",
    "recall_at_20",
    "fact_recall_at_20",
    "mrr",
    "current_state_accuracy",
    "temporal_order_accuracy",
    "entity_resolution_accuracy",
    "evidence_bandwidth_per_second",
    "fact_bandwidth_per_second",
    "correct_evidence_count",
    "correct_fact_count",
    "measurement_pass",
    "query_ordinal",
    "tenant_leak_count",
    "unrouted_leak_count",
    "strict_stale_detected",
    "stale_escape",
    "false_conflict",
]

REQUIRED_CORRECTED_COLUMNS = {
    "status",
    "run_id",
    "profile",
    "system_name",
    "case_id",
    "query_type",
    "latency_ms",
    "retrieval_ms",
    "hydration_ms",
    "recall_at_20",
    "fact_recall_at_20",
    "correct_evidence_count",
    "correct_fact_count",
    "measurement_pass",
    "query_ordinal",
    "component_timings_json",
}


def parse_number(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def parse_bool_number(value: str | None) -> float | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized == "true":
        return 1.0
    if normalized == "false":
        return 0.0
    return None


def parse_component_timings(value: str | None) -> dict[str, float]:
    if value is None or not value.strip():
        return {}
    decoded = json.loads(value)
    if not isinstance(decoded, dict):
        raise ValueError("component_timings_json must contain a JSON object")
    result: dict[str, float] = {}
    for key, raw in decoded.items():
        if not isinstance(key, str) or not isinstance(raw, (int, float)):
            continue
        numeric = float(raw)
        if math.isfinite(numeric) and numeric >= 0:
            result[key] = numeric
    return result


def load_completed_results(path: Path) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    rows: list[dict[str, object]] = []
    unmeasured: list[dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        headers = set(reader.fieldnames or [])
        missing = REQUIRED_CORRECTED_COLUMNS - headers
        if missing:
            raise ValueError(
                "Measured results use the legacy schema and are not publication-safe. "
                f"Missing corrected columns: {', '.join(sorted(missing))}."
            )
        for source in reader:
            if source.get("status") != "completed":
                unmeasured.append(dict(source))
                continue
            row: dict[str, object] = dict(source)
            for column in NUMERIC_COLUMNS:
                row[column] = parse_number(source.get(column))
            row["projection_hit"] = parse_bool_number(source.get("projection_hit"))
            row["component_timings"] = parse_component_timings(
                source.get("component_timings_json")
            )
            for required_numeric in [
                "retrieval_ms",
                "hydration_ms",
                "recall_at_20",
                "fact_recall_at_20",
                "correct_evidence_count",
                "correct_fact_count",
                "measurement_pass",
                "query_ordinal",
            ]:
                if row[required_numeric] is None:
                    raise ValueError(
                        f"Completed row {source.get('run_id')} / {source.get('case_id')} "
                        f"has no {required_numeric}."
                    )
            rows.append(row)
    if not rows:
        raise ValueError(f"No completed measured rows found in {path}")
    return rows, unmeasured


def finite(values: Iterable[float | None]) -> np.ndarray:
    return np.asarray(
        [value for value in values if value is not None and math.isfinite(value)],
        dtype=float,
    )


def mean_or_none(values: Iterable[float | None]) -> float | None:
    measured = finite(values)
    return float(measured.mean()) if measured.size else None


def nearest_rank(values: Iterable[float | None], quantile: float) -> float | None:
    measured = np.sort(finite(values))
    if not measured.size:
        return None
    bounded = max(0.0, min(1.0, quantile))
    index = max(0, math.ceil(bounded * measured.size) - 1)
    return float(measured[index])


def sum_or_zero(values: Iterable[float | None]) -> float:
    return float(finite(values).sum())


def metric_rate(rows: Sequence[dict[str, object]], column: str) -> tuple[float | None, int]:
    values = finite(row.get(column) for row in rows)  # type: ignore[arg-type]
    return (float(values.mean()), int(values.size)) if values.size else (None, 0)


def component_aggregate(rows: Sequence[dict[str, object]]) -> dict[str, dict[str, float | int]]:
    names = sorted({
        name
        for row in rows
        for name in (row.get("component_timings") or {}).keys()  # type: ignore[union-attr]
    })
    result: dict[str, dict[str, float | int]] = {}
    for name in names:
        values = finite(
            (row.get("component_timings") or {}).get(name)  # type: ignore[union-attr]
            for row in rows
        )
        if not values.size:
            continue
        result[name] = {
            "sample_count": int(values.size),
            "total_ms": float(values.sum()),
            "mean_ms": float(values.mean()),
            "p50_ms": float(nearest_rank(values, 0.50) or 0.0),
            "p95_ms": float(nearest_rank(values, 0.95) or 0.0),
        }
    return result


def aggregate(rows: Sequence[dict[str, object]]) -> dict[str, object]:
    retrieval_ms = sum_or_zero(row.get("retrieval_ms") for row in rows)  # type: ignore[arg-type]
    hydration_ms = sum_or_zero(row.get("hydration_ms") for row in rows)  # type: ignore[arg-type]
    evidence_count = sum_or_zero(row.get("correct_evidence_count") for row in rows)  # type: ignore[arg-type]
    fact_count = sum_or_zero(row.get("correct_fact_count") for row in rows)  # type: ignore[arg-type]
    strict_detection, strict_execution_count = metric_rate(rows, "strict_stale_detected")
    stale_escape, stale_execution_count = metric_rate(rows, "stale_escape")
    false_conflict, unrelated_execution_count = metric_rate(rows, "false_conflict")
    validations = finite(row.get("validation_ms") for row in rows)  # type: ignore[arg-type]
    case_ids = {str(row["case_id"]) for row in rows}
    run_ids = {str(row["run_id"]) for row in rows}
    measurement_passes = {
        int(float(row["measurement_pass"]))
        for row in rows
        if row.get("measurement_pass") is not None
    }
    strict_cases = {
        str(row["case_id"])
        for row in rows
        if row.get("strict_stale_detected") is not None
    }
    unrelated_cases = {
        str(row["case_id"])
        for row in rows
        if row.get("false_conflict") is not None
    }
    return {
        "execution_count": len(rows),
        "case_count": len(case_ids),
        "run_count": len(run_ids),
        "measurement_pass_count": len(measurement_passes),
        "recall_at_5": mean_or_none(row.get("recall_at_5") for row in rows),  # type: ignore[arg-type]
        "recall_at_10": mean_or_none(row.get("recall_at_10") for row in rows),  # type: ignore[arg-type]
        "evidence_recall_at_20": mean_or_none(row.get("recall_at_20") for row in rows),  # type: ignore[arg-type]
        "fact_recall_at_20": mean_or_none(row.get("fact_recall_at_20") for row in rows),  # type: ignore[arg-type]
        "mrr": mean_or_none(row.get("mrr") for row in rows),  # type: ignore[arg-type]
        "current_state_accuracy": mean_or_none(row.get("current_state_accuracy") for row in rows),  # type: ignore[arg-type]
        "temporal_order_accuracy": mean_or_none(row.get("temporal_order_accuracy") for row in rows),  # type: ignore[arg-type]
        "entity_resolution_accuracy": mean_or_none(row.get("entity_resolution_accuracy") for row in rows),  # type: ignore[arg-type]
        "latency_p50_ms": nearest_rank((row.get("latency_ms") for row in rows), 0.50),  # type: ignore[arg-type]
        "latency_p95_ms": nearest_rank((row.get("latency_ms") for row in rows), 0.95),  # type: ignore[arg-type]
        "retrieval_p50_ms": nearest_rank((row.get("retrieval_ms") for row in rows), 0.50),  # type: ignore[arg-type]
        "retrieval_p95_ms": nearest_rank((row.get("retrieval_ms") for row in rows), 0.95),  # type: ignore[arg-type]
        "hydration_p50_ms": nearest_rank((row.get("hydration_ms") for row in rows), 0.50),  # type: ignore[arg-type]
        "hydration_p95_ms": nearest_rank((row.get("hydration_ms") for row in rows), 0.95),  # type: ignore[arg-type]
        "validation_p50_ms": nearest_rank(validations, 0.50) if validations.size else None,
        "validation_p95_ms": nearest_rank(validations, 0.95) if validations.size else None,
        "correct_evidence_count": evidence_count,
        "correct_fact_count": fact_count,
        "retrieval_wall_seconds": retrieval_ms / 1_000.0,
        "hydration_wall_seconds": hydration_ms / 1_000.0,
        "evidence_bandwidth_per_second": (
            evidence_count / (retrieval_ms / 1_000.0) if retrieval_ms > 0 else None
        ),
        "fact_bandwidth_per_second": (
            fact_count / (hydration_ms / 1_000.0) if hydration_ms > 0 else None
        ),
        "projection_hit_rate": mean_or_none(row.get("projection_hit") for row in rows),  # type: ignore[arg-type]
        "strict_stale_detection_rate": strict_detection,
        "stale_action_escape_rate": stale_escape,
        "false_conflict_rate": false_conflict,
        "strict_scenario_execution_count": strict_execution_count,
        "stale_scenario_execution_count": stale_execution_count,
        "unrelated_scenario_execution_count": unrelated_execution_count,
        "strict_scenario_case_count": len(strict_cases),
        "unrelated_scenario_case_count": len(unrelated_cases),
        "tenant_leak_count": int(sum_or_zero(row.get("tenant_leak_count") for row in rows)),  # type: ignore[arg-type]
        "unrouted_leak_count": int(sum_or_zero(row.get("unrouted_leak_count") for row in rows)),  # type: ignore[arg-type]
        "component_timings": component_aggregate(rows),
    }


def group_rows(
    rows: Sequence[dict[str, object]],
) -> dict[tuple[str, str], list[dict[str, object]]]:
    groups: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        groups[(str(row["profile"]), str(row["system_name"]))].append(row)
    return groups


def ordered_systems(rows: Sequence[dict[str, object]]) -> list[str]:
    measured = {str(row["system_name"]) for row in rows}
    known = [system for system in EXPECTED_SYSTEM_ORDER if system in measured]
    return known + sorted(measured - set(known))


def rng_for(key: str) -> np.random.Generator:
    digest = hashlib.sha256(f"{BOOTSTRAP_SEED}:{key}".encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big", signed=False)
    return np.random.default_rng(seed)


def percentile_ci(samples: np.ndarray) -> tuple[float, float]:
    measured = samples[np.isfinite(samples)]
    if not measured.size:
        return math.nan, math.nan
    low, high = np.quantile(measured, [0.025, 0.975])
    return float(low), float(high)


def case_cluster_sums(
    rows: Sequence[dict[str, object]],
    numerator: Callable[[dict[str, object]], float | None],
    denominator: Callable[[dict[str, object]], float | None],
    case_ids: Sequence[str] | None = None,
) -> tuple[list[str], np.ndarray, np.ndarray]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["case_id"])].append(row)
    ordered = list(case_ids) if case_ids is not None else sorted(grouped)
    numerators: list[float] = []
    denominators: list[float] = []
    for case_id in ordered:
        entries = grouped.get(case_id, [])
        num = finite(numerator(row) for row in entries)
        den = finite(denominator(row) for row in entries)
        numerators.append(float(num.sum()))
        denominators.append(float(den.sum()))
    return ordered, np.asarray(numerators), np.asarray(denominators)


def bootstrap_cluster_ratio(
    rows: Sequence[dict[str, object]],
    numerator: Callable[[dict[str, object]], float | None],
    denominator: Callable[[dict[str, object]], float | None],
    key: str,
) -> tuple[float, tuple[float, float], int]:
    case_ids, numerators, denominators = case_cluster_sums(rows, numerator, denominator)
    if not case_ids or denominators.sum() <= 0:
        return math.nan, (math.nan, math.nan), len(case_ids)
    indices = rng_for(key).integers(
        0, len(case_ids), size=(BOOTSTRAP_SAMPLES, len(case_ids))
    )
    sampled_denominators = denominators[indices].sum(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        samples = numerators[indices].sum(axis=1) / sampled_denominators
    point = float(numerators.sum() / denominators.sum())
    return point, percentile_ci(samples), len(case_ids)


def bootstrap_mean_metric(
    rows: Sequence[dict[str, object]],
    column: str,
    key: str,
) -> tuple[float, tuple[float, float], int]:
    return bootstrap_cluster_ratio(
        rows,
        lambda row: row.get(column),  # type: ignore[return-value]
        lambda row: 1.0 if row.get(column) is not None else None,
        key,
    )


def paired_cluster_bootstrap(
    left_rows: Sequence[dict[str, object]],
    right_rows: Sequence[dict[str, object]],
    left_numerator: Callable[[dict[str, object]], float | None],
    left_denominator: Callable[[dict[str, object]], float | None],
    right_numerator: Callable[[dict[str, object]], float | None],
    right_denominator: Callable[[dict[str, object]], float | None],
    operation: str,
    key: str,
) -> tuple[float, tuple[float, float], int]:
    left_cases = {str(row["case_id"]) for row in left_rows}
    right_cases = {str(row["case_id"]) for row in right_rows}
    case_ids = sorted(left_cases & right_cases)
    if not case_ids:
        return math.nan, (math.nan, math.nan), 0
    _, left_num, left_den = case_cluster_sums(
        left_rows, left_numerator, left_denominator, case_ids
    )
    _, right_num, right_den = case_cluster_sums(
        right_rows, right_numerator, right_denominator, case_ids
    )
    if left_den.sum() <= 0 or right_den.sum() <= 0:
        return math.nan, (math.nan, math.nan), len(case_ids)
    if operation == "ratio" and right_num.sum() <= 0:
        return math.nan, (math.nan, math.nan), len(case_ids)
    indices = rng_for(key).integers(
        0, len(case_ids), size=(BOOTSTRAP_SAMPLES, len(case_ids))
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        left_samples = left_num[indices].sum(axis=1) / left_den[indices].sum(axis=1)
        right_samples = right_num[indices].sum(axis=1) / right_den[indices].sum(axis=1)
        left_point = left_num.sum() / left_den.sum()
        right_point = right_num.sum() / right_den.sum()
        if operation == "difference":
            samples = left_samples - right_samples
            point = left_point - right_point
        elif operation == "ratio":
            samples = left_samples / right_samples
            point = left_point / right_point
        else:
            raise ValueError(f"Unknown paired operation: {operation}")
    return float(point), percentile_ci(samples), len(case_ids)


def ci_record(
    *,
    profile: str,
    system: str,
    query_type: str,
    metric: str,
    estimate: float,
    interval: tuple[float, float],
    case_count: int,
    execution_count: int,
    comparison_system: str = "",
    note: str = "Case-cluster bootstrap; all measured pass executions retained.",
) -> dict[str, object]:
    return {
        "profile": profile,
        "corpus_size": PROFILE_SIZES.get(profile, ""),
        "system": system,
        "comparison_system": comparison_system,
        "query_type": query_type,
        "metric": metric,
        "estimate": estimate,
        "ci_low": interval[0],
        "ci_high": interval[1],
        "bootstrap_samples": BOOTSTRAP_SAMPLES,
        "bootstrap_unit": "benchmark_case_cluster",
        "case_count": case_count,
        "execution_count": execution_count,
        "note": note,
    }


def strongest_non_derya_baseline(
    aggregates: Sequence[dict[str, object]],
) -> str | None:
    largest_profile = max(
        (str(row["profile"]) for row in aggregates if row["query_type"] == "ALL"),
        key=lambda profile: PROFILE_SIZES.get(profile, -1),
        default=None,
    )
    if largest_profile is None:
        return None
    candidates = [
        row
        for row in aggregates
        if row["profile"] == largest_profile
        and row["query_type"] == "ALL"
        and row["system"] in NON_DERYA_SYSTEMS
    ]
    if not candidates:
        return None
    candidates.sort(
        key=lambda row: (
            float(row.get("evidence_recall_at_20") or -1),
            -float(row.get("retrieval_p95_ms") or math.inf),
        ),
        reverse=True,
    )
    return str(candidates[0]["system"])


def preparation_metrics(summary: dict[str, object]) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    systems = summary.get("systems")
    if not isinstance(systems, list):
        return records
    for system in systems:
        if not isinstance(system, dict):
            continue
        profile = str(system.get("profile", ""))
        system_name = str(system.get("systemName", ""))
        preparations = system.get("preparations")
        if not isinstance(preparations, list):
            continue
        for preparation_index, preparation in enumerate(preparations, start=1):
            if not isinstance(preparation, dict):
                continue
            timings = preparation.get("componentTimings")
            if not isinstance(timings, dict):
                continue
            for component, timing in timings.items():
                if not isinstance(timing, dict):
                    continue
                records.append({
                    "profile": profile,
                    "system": system_name,
                    "preparation_index": preparation_index,
                    "projection_count": preparation.get("projectionCount"),
                    "failure_count": preparation.get("failureCount"),
                    "build_failure_count": preparation.get("buildFailureCount"),
                    "persistence_failure_count": preparation.get("persistenceFailureCount"),
                    "component": component,
                    "sample_count": timing.get("sampleCount"),
                    "total_ms": timing.get("totalMs"),
                    "p50_ms": timing.get("p50Ms"),
                    "p95_ms": timing.get("p95Ms"),
                })
    return records


def projection_amortization(
    aggregates: Sequence[dict[str, object]],
    preparation: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for profile in PROFILE_ORDER:
        cold = next((
            row for row in aggregates
            if row["profile"] == profile
            and row["system"] == "DERYA_COLD"
            and row["query_type"] == "ALL"
        ), None)
        hot = next((
            row for row in aggregates
            if row["profile"] == profile
            and row["system"] == "DERYA_HOT"
            and row["query_type"] == "ALL"
        ), None)
        builds = [
            row for row in preparation
            if row["profile"] == profile
            and row["system"] == "DERYA_HOT"
            and row["component"] == "projectionMaterializationMs"
        ]
        build_ms = mean_or_none(
            float(row["p50_ms"]) if isinstance(row.get("p50_ms"), (int, float)) else None
            for row in builds
        )
        cold_ms = float(cold["hydration_p50_ms"]) if cold and cold.get("hydration_p50_ms") is not None else None
        hot_ms = float(hot["hydration_p50_ms"]) if hot and hot.get("hydration_p50_ms") is not None else None
        savings = cold_ms - hot_ms if cold_ms is not None and hot_ms is not None else None
        break_even = build_ms / savings if build_ms is not None and savings is not None and savings > 0 else None
        result.append({
            "profile": profile,
            "corpus_size": PROFILE_SIZES[profile],
            "projection_build_p50_ms": build_ms,
            "cold_hydration_p50_ms": cold_ms,
            "hot_hydration_p50_ms": hot_ms,
            "per_read_savings_ms": savings,
            "repeated_reads_to_break_even": break_even,
            "reason": None if break_even is not None else (
                "hot_not_faster" if savings is not None and savings <= 0 else "timing_not_measured"
            ),
        })
    return result


def build_aggregate_rows(rows: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    groups = group_rows(rows)
    systems = ordered_systems(rows)
    result: list[dict[str, object]] = []
    for profile in PROFILE_ORDER:
        for system in systems:
            group = groups.get((profile, system), [])
            if not group:
                continue
            overall = aggregate(group)
            result.append({
                "profile": profile,
                "corpus_size": PROFILE_SIZES[profile],
                "system": system,
                "system_label": SYSTEM_LABELS.get(system, system),
                "query_type": "ALL",
                "query_type_label": "All queries",
                **overall,
            })
            by_query: dict[str, list[dict[str, object]]] = defaultdict(list)
            for row in group:
                by_query[str(row["query_type"])].append(row)
            for query_type in QUERY_TYPE_ORDER:
                query_rows = by_query.get(query_type, [])
                if not query_rows:
                    continue
                result.append({
                    "profile": profile,
                    "corpus_size": PROFILE_SIZES[profile],
                    "system": system,
                    "system_label": SYSTEM_LABELS.get(system, system),
                    "query_type": query_type,
                    "query_type_label": QUERY_TYPE_LABELS[query_type],
                    **aggregate(query_rows),
                })
    return result


def build_confidence_intervals(
    rows: Sequence[dict[str, object]],
    aggregate_rows: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    groups = group_rows(rows)
    systems = ordered_systems(rows)
    records: list[dict[str, object]] = []
    metric_columns = [
        ("evidence_recall_at_20", "recall_at_20"),
        ("fact_recall_at_20", "fact_recall_at_20"),
        ("current_state_accuracy", "current_state_accuracy"),
        ("temporal_order_accuracy", "temporal_order_accuracy"),
        ("entity_resolution_accuracy", "entity_resolution_accuracy"),
        ("strict_stale_detection_rate", "strict_stale_detected"),
        ("stale_action_escape_rate", "stale_escape"),
        ("false_conflict_rate", "false_conflict"),
    ]
    for profile in PROFILE_ORDER:
        for system in systems:
            group = groups.get((profile, system), [])
            if not group:
                continue
            for metric, column in metric_columns:
                point, interval, case_count = bootstrap_mean_metric(
                    group, column, f"{profile}:{system}:ALL:{metric}"
                )
                if not math.isfinite(point):
                    continue
                records.append(ci_record(
                    profile=profile,
                    system=system,
                    query_type="ALL",
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(group),
                ))
            for metric, count_column, duration_column in [
                ("evidence_bandwidth_per_second", "correct_evidence_count", "retrieval_ms"),
                ("fact_bandwidth_per_second", "correct_fact_count", "hydration_ms"),
            ]:
                point, interval, case_count = bootstrap_cluster_ratio(
                    group,
                    lambda row, name=count_column: row.get(name),  # type: ignore[return-value]
                    lambda row, name=duration_column: (
                        float(row[name]) / 1_000.0 if row.get(name) is not None else None
                    ),
                    f"{profile}:{system}:ALL:{metric}",
                )
                if not math.isfinite(point):
                    continue
                records.append(ci_record(
                    profile=profile,
                    system=system,
                    query_type="ALL",
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(group),
                ))
            by_query: dict[str, list[dict[str, object]]] = defaultdict(list)
            for row in group:
                by_query[str(row["query_type"])].append(row)
            for query_type in QUERY_TYPE_ORDER:
                query_rows = by_query.get(query_type, [])
                if not query_rows:
                    continue
                for metric, column in [
                    ("evidence_recall_at_20", "recall_at_20"),
                    ("fact_recall_at_20", "fact_recall_at_20"),
                ]:
                    point, interval, case_count = bootstrap_mean_metric(
                        query_rows,
                        column,
                        f"{profile}:{system}:{query_type}:{metric}",
                    )
                    records.append(ci_record(
                        profile=profile,
                        system=system,
                        query_type=query_type,
                        metric=metric,
                        estimate=point,
                        interval=interval,
                        case_count=case_count,
                        execution_count=len(query_rows),
                    ))

    baseline = strongest_non_derya_baseline(aggregate_rows)
    comparisons = [system for system in systems if system in NON_DERYA_SYSTEMS]
    if "DERYA_COLD" in systems:
        comparisons.append("DERYA_COLD")
    for profile in PROFILE_ORDER:
        hot = groups.get((profile, "DERYA_HOT"), [])
        if not hot:
            continue
        for comparison in comparisons:
            other = groups.get((profile, comparison), [])
            if not other:
                continue
            for metric, column in [
                ("evidence_recall_at_20_difference", "recall_at_20"),
                ("fact_recall_at_20_difference", "fact_recall_at_20"),
                ("current_state_accuracy_difference", "current_state_accuracy"),
            ]:
                point, interval, case_count = paired_cluster_bootstrap(
                    hot,
                    other,
                    lambda row, name=column: row.get(name),  # type: ignore[return-value]
                    lambda row, name=column: 1.0 if row.get(name) is not None else None,
                    lambda row, name=column: row.get(name),  # type: ignore[return-value]
                    lambda row, name=column: 1.0 if row.get(name) is not None else None,
                    "difference",
                    f"{profile}:DERYA_HOT:{comparison}:{metric}",
                )
                if not math.isfinite(point):
                    continue
                records.append(ci_record(
                    profile=profile,
                    system="DERYA_HOT",
                    comparison_system=comparison,
                    query_type="ALL",
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(hot) + len(other),
                    note=(
                        "Primary paired comparison; case-cluster bootstrap with all passes retained."
                        if comparison == baseline
                        else "Paired case-cluster bootstrap with all passes retained."
                    ),
                ))
            for metric, count_column, duration_column in [
                ("evidence_bandwidth_ratio", "correct_evidence_count", "retrieval_ms"),
                ("fact_bandwidth_ratio", "correct_fact_count", "hydration_ms"),
            ]:
                point, interval, case_count = paired_cluster_bootstrap(
                    hot,
                    other,
                    lambda row, name=count_column: row.get(name),  # type: ignore[return-value]
                    lambda row, name=duration_column: (
                        float(row[name]) / 1_000.0 if row.get(name) is not None else None
                    ),
                    lambda row, name=count_column: row.get(name),  # type: ignore[return-value]
                    lambda row, name=duration_column: (
                        float(row[name]) / 1_000.0 if row.get(name) is not None else None
                    ),
                    "ratio",
                    f"{profile}:DERYA_HOT:{comparison}:{metric}",
                )
                if not math.isfinite(point):
                    continue
                records.append(ci_record(
                    profile=profile,
                    system="DERYA_HOT",
                    comparison_system=comparison,
                    query_type="ALL",
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(hot) + len(other),
                    note=(
                        "Aggregate numerator / aggregate wall time, paired by case; not an average of per-query ratios."
                    ),
                ))
    return records


def validate_publication_measurement(
    rows: Sequence[dict[str, object]],
    summary: dict[str, object],
    allow_incomplete: bool,
    *,
    expected_cases_per_profile: int = EXPECTED_CASES_PER_PROFILE,
    minimum_measured_passes: int = MINIMUM_MEASURED_PASSES,
) -> dict[str, object]:
    groups = group_rows(rows)
    problems: list[str] = []
    profiles = sorted({str(row["profile"]) for row in rows})
    if not allow_incomplete and set(profiles) != set(PROFILE_ORDER):
        problems.append(f"expected profiles {PROFILE_ORDER}, measured {profiles}")
    profile_systems: dict[str, list[str]] = {}
    reference_profile_systems: set[str] | None = None
    for profile in profiles:
        systems = sorted({system for (candidate, system) in groups if candidate == profile})
        profile_systems[profile] = systems
        if not allow_incomplete and set(systems) != set(EXPECTED_SYSTEM_ORDER):
            problems.append(
                f"{profile}: expected systems {EXPECTED_SYSTEM_ORDER}, measured {systems}"
            )
        if reference_profile_systems is None:
            reference_profile_systems = set(systems)
        elif not allow_incomplete and set(systems) != reference_profile_systems:
            problems.append("runnable system set differs across corpus profiles")
        reference_cases: set[str] | None = None
        reference_passes: set[int] | None = None
        reference_order: dict[tuple[int, str], int] | None = None
        for system in systems:
            group = groups[(profile, system)]
            case_ids = {str(row["case_id"]) for row in group}
            passes = {int(float(row["measurement_pass"])) for row in group}
            cells = {
                (str(row["case_id"]), int(float(row["measurement_pass"])))
                for row in group
            }
            order = {
                (int(float(row["measurement_pass"])), str(row["case_id"])):
                    int(float(row["query_ordinal"]))
                for row in group
            }
            if not allow_incomplete and len(case_ids) != expected_cases_per_profile:
                problems.append(
                    f"{profile}/{system}: expected {expected_cases_per_profile} cases, found {len(case_ids)}"
                )
            if not allow_incomplete and len(passes) < minimum_measured_passes:
                problems.append(
                    f"{profile}/{system}: expected at least {minimum_measured_passes} passes, found {len(passes)}"
                )
            if not allow_incomplete and passes != set(range(1, len(passes) + 1)):
                problems.append(
                    f"{profile}/{system}: measured pass IDs must be contiguous from 1; found {sorted(passes)}"
                )
            if len(cells) != len(group):
                problems.append(f"{profile}/{system}: duplicate case/pass measurements")
            if not allow_incomplete:
                expected_cells = {
                    (case_id, pass_index)
                    for case_id in case_ids
                    for pass_index in passes
                }
                if cells != expected_cells:
                    missing_count = len(expected_cells - cells)
                    extra_count = len(cells - expected_cells)
                    problems.append(
                        f"{profile}/{system}: incomplete case/pass grid "
                        f"({missing_count} missing, {extra_count} unexpected cells)"
                    )
            if reference_cases is None:
                reference_cases = case_ids
                reference_passes = passes
                reference_order = order
            elif case_ids != reference_cases or passes != reference_passes:
                problems.append(
                    f"{profile}: systems do not share identical case and measured-pass sets"
                )
            elif order != reference_order:
                problems.append(
                    f"{profile}: systems do not share the same query order within each measured pass"
                )
            pass_orders = {
                pass_index: tuple(
                    case_id
                    for _, case_id in sorted(
                        (ordinal, case_id)
                        for (candidate_pass, case_id), ordinal in order.items()
                        if candidate_pass == pass_index
                    )
                )
                for pass_index in passes
            }
            if not allow_incomplete:
                expected_ordinals = set(range(1, len(case_ids) + 1))
                for pass_index in passes:
                    measured_ordinals = {
                        ordinal
                        for (candidate_pass, _case_id), ordinal in order.items()
                        if candidate_pass == pass_index
                    }
                    if measured_ordinals != expected_ordinals:
                        problems.append(
                            f"{profile}/{system}: pass {pass_index} query ordinals are not "
                            f"a complete 1..{len(case_ids)} permutation"
                        )
                if len(set(pass_orders.values())) != len(passes):
                    problems.append(
                        f"{profile}/{system}: measured pass query order was not independently re-randomized"
                    )
    configurations = summary.get("configurations")
    if isinstance(configurations, list):
        for configuration in configurations:
            if not isinstance(configuration, dict):
                continue
            warmups = configuration.get("warmupPassCount")
            order_policy = configuration.get("queryOrderPolicy")
            if not allow_incomplete and (not isinstance(warmups, (int, float)) or warmups < MINIMUM_WARMUP_PASSES):
                problems.append("summary configuration records fewer than 3 full warmup passes")
            if not allow_incomplete and order_policy != "seeded_random_per_pass_shared_across_systems":
                problems.append(f"unexpected query order policy: {order_policy}")
    elif not allow_incomplete:
        problems.append("summary has no configurations array")
    runs = summary.get("runs")
    if isinstance(runs, list):
        order_hashes: dict[tuple[str, int], set[str]] = defaultdict(set)
        for run in runs:
            if not isinstance(run, dict) or run.get("systemName") not in {
                system for systems in profile_systems.values() for system in systems
            }:
                continue
            configuration = run.get("configuration")
            if not isinstance(configuration, dict) or configuration.get("status") != "completed":
                continue
            profile = str(run.get("profile", configuration.get("profile", "")))
            run_index = configuration.get("runIndex")
            order_hash = configuration.get("queryOrderHash")
            if isinstance(run_index, (int, float)) and isinstance(order_hash, str):
                order_hashes[(profile, int(run_index))].add(order_hash)
        if not allow_incomplete and any(len(hashes) != 1 for hashes in order_hashes.values()):
            problems.append("summary query-order hashes differ across systems within a pass")
    if problems:
        raise ValueError("Publication measurement validation failed:\n- " + "\n- ".join(sorted(set(problems))))
    return {
        "profiles": profiles,
        "systems_by_profile": profile_systems,
        "completed_execution_count": len(rows),
        "minimum_measured_passes": minimum_measured_passes,
        "minimum_warmup_passes": MINIMUM_WARMUP_PASSES,
        "query_order_policy": "seeded_random_per_pass_shared_across_systems",
        "problems": problems,
        "allow_incomplete": allow_incomplete,
    }


def csv_safe(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return value


def write_csv(path: Path, rows: Sequence[dict[str, object]], fieldnames: Sequence[str] | None = None) -> Path:
    if not rows:
        raise ValueError(f"Refusing to write empty CSV: {path}")
    columns = list(fieldnames or rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: csv_safe(row.get(key)) for key in columns})
    return path


def figure_data_columns(rows: Sequence[dict[str, object]]) -> list[str]:
    excluded = {"component_timings"}
    preferred = [
        "profile",
        "corpus_size",
        "system",
        "system_label",
        "query_type",
        "query_type_label",
    ]
    remainder = sorted({key for row in rows for key in row} - set(preferred) - excluded)
    return preferred + remainder


def raw_aggregate_rows(
    aggregates: Sequence[dict[str, object]],
    preparation: Sequence[dict[str, object]],
    amortization: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    metrics = [
        ("evidence_recall_at_20", "fraction", None, None),
        ("fact_recall_at_20", "fraction", None, None),
        ("current_state_accuracy", "fraction", None, None),
        ("temporal_order_accuracy", "fraction", None, None),
        ("entity_resolution_accuracy", "fraction", None, None),
        ("latency_p50_ms", "ms", None, None),
        ("latency_p95_ms", "ms", None, None),
        ("retrieval_p50_ms", "ms", None, None),
        ("retrieval_p95_ms", "ms", None, None),
        ("hydration_p50_ms", "ms", None, None),
        ("hydration_p95_ms", "ms", None, None),
        ("validation_p50_ms", "ms", None, None),
        ("validation_p95_ms", "ms", None, None),
        ("evidence_bandwidth_per_second", "correct_gold_evidence_refs_per_second", "correct_evidence_count", "retrieval_wall_seconds"),
        ("fact_bandwidth_per_second", "correct_gold_facts_per_second", "correct_fact_count", "hydration_wall_seconds"),
        ("strict_stale_detection_rate", "fraction", None, None),
        ("stale_action_escape_rate", "fraction", None, None),
        ("false_conflict_rate", "fraction", None, None),
        ("projection_hit_rate", "fraction", None, None),
    ]
    for row in aggregates:
        for metric, unit, numerator_name, denominator_name in metrics:
            estimate = row.get(metric)
            if estimate is None:
                continue
            output.append({
                "profile": row["profile"],
                "corpus_size": row["corpus_size"],
                "system": row["system"],
                "system_label": row["system_label"],
                "query_type": row["query_type"],
                "metric": metric,
                "estimate": estimate,
                "unit": unit,
                "numerator": row.get(numerator_name) if numerator_name else "",
                "denominator": row.get(denominator_name) if denominator_name else "",
                "execution_count": row["execution_count"],
                "case_count": row["case_count"],
                "measurement_pass_count": row["measurement_pass_count"],
                "source": "measured_case_results",
            })
        components = row.get("component_timings")
        if isinstance(components, dict):
            for component, values in components.items():
                if not isinstance(values, dict):
                    continue
                for suffix, unit in [("p50_ms", "ms"), ("p95_ms", "ms"), ("total_ms", "ms")]:
                    output.append({
                        "profile": row["profile"],
                        "corpus_size": row["corpus_size"],
                        "system": row["system"],
                        "system_label": row["system_label"],
                        "query_type": row["query_type"],
                        "metric": f"component.{component}.{suffix}",
                        "estimate": values.get(suffix),
                        "unit": unit,
                        "numerator": "",
                        "denominator": "",
                        "execution_count": values.get("sample_count"),
                        "case_count": row["case_count"],
                        "measurement_pass_count": row["measurement_pass_count"],
                        "source": "component_timings_json",
                    })
    for row in preparation:
        for suffix in ["p50_ms", "p95_ms", "total_ms"]:
            output.append({
                "profile": row["profile"],
                "corpus_size": PROFILE_SIZES.get(str(row["profile"]), ""),
                "system": row["system"],
                "system_label": SYSTEM_LABELS.get(str(row["system"]), str(row["system"])),
                "query_type": "PREPARATION",
                "metric": f"projection_preparation.{row['component']}.{suffix}",
                "estimate": row.get(suffix),
                "unit": "ms",
                "numerator": "",
                "denominator": "",
                "execution_count": row.get("sample_count"),
                "case_count": row.get("projection_count"),
                "measurement_pass_count": 0,
                "source": "benchmark_summary_preparation",
            })
    for row in amortization:
        for metric, unit in [
            ("projection_build_p50_ms", "ms"),
            ("cold_hydration_p50_ms", "ms"),
            ("hot_hydration_p50_ms", "ms"),
            ("per_read_savings_ms", "ms"),
            ("repeated_reads_to_break_even", "reads"),
        ]:
            if row.get(metric) is None:
                continue
            output.append({
                "profile": row["profile"],
                "corpus_size": row["corpus_size"],
                "system": "DERYA_HOT",
                "system_label": SYSTEM_LABELS["DERYA_HOT"],
                "query_type": "AMORTIZATION",
                "metric": metric,
                "estimate": row[metric],
                "unit": unit,
                "numerator": "",
                "denominator": "",
                "execution_count": "",
                "case_count": "",
                "measurement_pass_count": "",
                "source": "derived_from_measured_projection_and_hydration_timings",
            })
    return output


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate_data_outputs(
    results_path: Path,
    summary_path: Path,
    allow_incomplete: bool = False,
) -> list[Path]:
    if not results_path.is_file():
        raise FileNotFoundError(f"Missing measured results: {results_path}")
    if not summary_path.is_file():
        raise FileNotFoundError(f"Missing benchmark summary: {summary_path}")
    for directory in [DATA_DIR, FIGURES_DIR, LINKEDIN_DIR, NOTES_DIR, CONTACT_SHEET_DIR]:
        directory.mkdir(parents=True, exist_ok=True)
    rows, unmeasured = load_completed_results(results_path)
    with summary_path.open(encoding="utf-8") as handle:
        source_summary = json.load(handle)
    if not isinstance(source_summary, dict):
        raise ValueError("Benchmark summary must be a JSON object")
    validation = validate_publication_measurement(rows, source_summary, allow_incomplete)
    aggregates = build_aggregate_rows(rows)
    confidence_intervals = build_confidence_intervals(rows, aggregates)
    preparation = preparation_metrics(source_summary)
    amortization = projection_amortization(aggregates, preparation)
    baseline = strongest_non_derya_baseline(aggregates)

    figure_path = write_csv(
        DATA_DIR / "figure_data.csv",
        aggregates,
        figure_data_columns(aggregates),
    )
    ci_path = write_csv(DATA_DIR / "confidence_intervals.csv", confidence_intervals)
    raw_path = write_csv(
        DATA_DIR / "raw_measured_aggregate.csv",
        raw_aggregate_rows(aggregates, preparation, amortization),
    )
    summary_document = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "analysis": {
            "bootstrapSamples": BOOTSTRAP_SAMPLES,
            "bootstrapSeed": BOOTSTRAP_SEED,
            "bootstrapUnit": "benchmark_case_cluster",
            "passHandling": "all measured executions retained within each sampled case",
            "bandwidthAggregation": "sum(correct required gold items) / sum(wall-clock seconds)",
            "latencyQuantiles": "nearest-rank over all measured query executions",
            "minimumMeasuredPasses": MINIMUM_MEASURED_PASSES,
            "minimumWarmupPasses": MINIMUM_WARMUP_PASSES,
            "strongestNonDeryaBaseline": baseline,
        },
        "inputValidation": validation,
        "sourceArtifacts": {
            "resultsCsv": str(results_path),
            "resultsSha256": sha256_file(results_path),
            "summaryJson": str(summary_path),
            "summarySha256": sha256_file(summary_path),
            "unmeasuredRowCount": len(unmeasured),
        },
        "aggregates": aggregates,
        "confidenceIntervals": confidence_intervals,
        "projectionPreparation": preparation,
        "projectionAmortization": amortization,
        "sourceBenchmarkSummary": source_summary,
    }
    benchmark_summary_path = DATA_DIR / "benchmark_summary.json"
    with benchmark_summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary_document, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return [figure_path, ci_path, raw_path, benchmark_summary_path]


def run_self_test() -> None:
    rows: list[dict[str, object]] = []
    for system, recall, facts, evidence, retrieval_ms, hydration_ms in [
        ("CURRENT_KEYWORD", 0.5, 0.0, 1.0, 100.0, 100.0),
        ("DERYA_HOT", 0.75, 2.0, 2.0, 200.0, 50.0),
    ]:
        for pass_index in range(1, 11):
            for case_index in range(1, 4):
                rows.append({
                    "run_id": f"{system}-{pass_index}",
                    "profile": "graph-small",
                    "system_name": system,
                    "case_id": f"case-{case_index}",
                    "query_type": "current_vs_stale",
                    "latency_ms": hydration_ms,
                    "retrieval_ms": retrieval_ms,
                    "hydration_ms": hydration_ms,
                    "validation_ms": 1.0 if system == "DERYA_HOT" else None,
                    "recall_at_5": recall,
                    "recall_at_10": recall,
                    "recall_at_20": recall,
                    "fact_recall_at_20": facts / 2.0,
                    "mrr": recall,
                    "current_state_accuracy": 1.0 if facts == 2.0 else 0.0,
                    "temporal_order_accuracy": None,
                    "entity_resolution_accuracy": None,
                    "correct_evidence_count": evidence,
                    "correct_fact_count": facts,
                    "measurement_pass": float(pass_index),
                    "query_ordinal": float(case_index),
                    "projection_hit": 1.0 if system == "DERYA_HOT" else None,
                    "component_timings": {"totalHydrationMs": hydration_ms},
                    "tenant_leak_count": 0.0,
                    "unrouted_leak_count": 0.0,
                    "strict_stale_detected": 1.0 if case_index == 1 and system == "DERYA_HOT" else None,
                    "stale_escape": 0.0 if case_index == 1 and system == "DERYA_HOT" else None,
                    "false_conflict": 0.0 if case_index == 2 and system == "DERYA_HOT" else None,
                })
    hot = [row for row in rows if row["system_name"] == "DERYA_HOT"]
    keyword = [row for row in rows if row["system_name"] == "CURRENT_KEYWORD"]
    hot_aggregate = aggregate(hot)
    assert math.isclose(float(hot_aggregate["evidence_bandwidth_per_second"]), 10.0)
    assert math.isclose(float(hot_aggregate["fact_bandwidth_per_second"]), 40.0)
    assert hot_aggregate["strict_scenario_case_count"] == 1
    assert hot_aggregate["unrelated_scenario_case_count"] == 1
    point, interval, cases = bootstrap_mean_metric(
        hot, "recall_at_20", "self-test-recall"
    )
    assert point == 0.75 and interval == (0.75, 0.75) and cases == 3
    difference, diff_interval, paired_cases = paired_cluster_bootstrap(
        hot,
        keyword,
        lambda row: row.get("recall_at_20"),  # type: ignore[return-value]
        lambda _row: 1.0,
        lambda row: row.get("recall_at_20"),  # type: ignore[return-value]
        lambda _row: 1.0,
        "difference",
        "self-test-difference",
    )
    assert difference == 0.25 and diff_interval == (0.25, 0.25) and paired_cases == 3

    with tempfile.TemporaryDirectory() as temporary:
        csv_path = Path(temporary) / "results.csv"
        headers = sorted(REQUIRED_CORRECTED_COLUMNS | {
            "projection_hit",
            "validation_ms",
            "strict_stale_detected",
            "stale_escape",
            "false_conflict",
        })
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerow({
                "status": "completed",
                "run_id": "run-1",
                "profile": "graph-small",
                "system_name": "DERYA_HOT",
                "case_id": "case-1",
                "query_type": "current_vs_stale",
                "latency_ms": "12",
                "retrieval_ms": "10",
                "hydration_ms": "12",
                "recall_at_20": "1",
                "fact_recall_at_20": "1",
                "correct_evidence_count": "2",
                "correct_fact_count": "3",
                "measurement_pass": "1",
                "query_ordinal": "1",
                "component_timings_json": '{"projectionLoadMs":2}',
                "projection_hit": "true",
            })
        loaded, skipped = load_completed_results(csv_path)
        assert not skipped and len(loaded) == 1
        assert loaded[0]["projection_hit"] == 1.0
        assert loaded[0]["component_timings"] == {"projectionLoadMs": 2.0}

    self_test_case_count = 3
    self_test_pass_count = 2
    publication_rows: list[dict[str, object]] = []
    for profile in PROFILE_ORDER:
        for system in EXPECTED_SYSTEM_ORDER:
            for pass_index in range(1, self_test_pass_count + 1):
                for case_index in range(1, self_test_case_count + 1):
                    publication_rows.append({
                        "profile": profile,
                        "system_name": system,
                        "case_id": f"{profile}-case-{case_index:03d}",
                        "measurement_pass": float(pass_index),
                        # A distinct cyclic permutation per pass, shared by systems.
                        "query_ordinal": float(
                            ((case_index + pass_index - 2) % self_test_case_count) + 1
                        ),
                    })
    publication_summary: dict[str, object] = {
        "configurations": [
            {
                "profile": profile,
                "warmupPassCount": MINIMUM_WARMUP_PASSES,
                "queryOrderPolicy": "seeded_random_per_pass_shared_across_systems",
            }
            for profile in PROFILE_ORDER
        ],
        "runs": [],
    }
    validation = validate_publication_measurement(
        publication_rows,
        publication_summary,
        allow_incomplete=False,
        expected_cases_per_profile=self_test_case_count,
        minimum_measured_passes=self_test_pass_count,
    )
    assert validation["systems_by_profile"] == {
        profile: sorted(EXPECTED_SYSTEM_ORDER) for profile in PROFILE_ORDER
    }

    def expect_validation_error(
        malformed: Sequence[dict[str, object]], expected_message: str
    ) -> None:
        try:
            validate_publication_measurement(
                malformed,
                publication_summary,
                allow_incomplete=False,
                expected_cases_per_profile=self_test_case_count,
                minimum_measured_passes=self_test_pass_count,
            )
        except ValueError as error:
            assert expected_message in str(error), str(error)
        else:
            raise AssertionError(f"Expected validation failure containing {expected_message!r}")

    expect_validation_error(publication_rows[1:], "incomplete case/pass grid")
    expect_validation_error(
        [
            row
            for row in publication_rows
            if not (
                row["profile"] == PROFILE_ORDER[0]
                and row["system_name"] == EXPECTED_SYSTEM_ORDER[0]
            )
        ],
        "expected systems",
    )
    noncontiguous_rows = [
        {
            **row,
            "measurement_pass": 11.0,
        }
        if (
            row["profile"] == PROFILE_ORDER[0]
            and row["system_name"] == EXPECTED_SYSTEM_ORDER[0]
            and row["measurement_pass"] == float(self_test_pass_count)
        )
        else row
        for row in publication_rows
    ]
    expect_validation_error(noncontiguous_rows, "pass IDs must be contiguous from 1")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Post-process corrected Derya benchmark measurements for publication."
    )
    parser.add_argument(
        "--results",
        type=Path,
        default=DEFAULT_BENCHMARK_ROOT / "results.csv",
        help="Corrected measured per-query CSV.",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=DEFAULT_BENCHMARK_ROOT / "summary.json",
        help="Corrected benchmark summary JSON.",
    )
    parser.add_argument(
        "--data-only",
        action="store_true",
        help="Generate publication data exports without rendering figures.",
    )
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Allow synthetic or partial inputs; never use for publication claims.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run deterministic synthetic schema/statistics checks and exit.",
    )
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    if arguments.self_test:
        run_self_test()
        print(json.dumps({"ok": True, "mode": "self-test"}, indent=2))
        return
    outputs = generate_data_outputs(
        arguments.results.resolve(),
        arguments.summary.resolve(),
        arguments.allow_incomplete,
    )
    if not arguments.data_only:
        raise RuntimeError(
            "This command owns audited statistical post-processing only. Figure rendering "
            "requires a separate pixel-audited visualization step. Re-run with --data-only."
        )
    print(json.dumps({
        "ok": True,
        "mode": "data-only",
        "bootstrapSamples": BOOTSTRAP_SAMPLES,
        "bootstrapUnit": "benchmark_case_cluster",
        "outputs": [str(path) for path in outputs],
    }, indent=2))


if __name__ == "__main__":
    main()
