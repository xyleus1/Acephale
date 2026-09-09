#!/usr/bin/env python3
"""Run the audited Derya publication statistics in a writable output tree.

The canonical statistics implementation remains in the measured source tree. This
launcher changes only the destination directories. Rendering is deliberately
disabled until both controlling reference images can be inspected.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path


OUTPUT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BENCHMARK_ROOT = Path(r"C:\Users\apexs\derya-publication-benchmark")
CANONICAL_SOURCE = Path(
    r"C:\Users\apexs\OneDrive\Desktop\derya-crm"
) / ".benchmark-output" / "linkedin-figures" / "source" / "make_figures.py"


def load_statistics_module():
    spec = importlib.util.spec_from_file_location(
        "derya_publication_statistics", CANONICAL_SOURCE
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load canonical statistics source: {CANONICAL_SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUTPUT_ROOT = OUTPUT_ROOT
    module.DATA_DIR = OUTPUT_ROOT / "data"
    module.FIGURES_DIR = OUTPUT_ROOT / "figures"
    module.LINKEDIN_DIR = OUTPUT_ROOT / "linkedin"
    module.NOTES_DIR = OUTPUT_ROOT / "notes"
    module.CONTACT_SHEET_DIR = OUTPUT_ROOT / "contact-sheet"
    return module


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--results",
        type=Path,
        default=DEFAULT_BENCHMARK_ROOT / "results.csv",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=DEFAULT_BENCHMARK_ROOT / "summary.json",
    )
    parser.add_argument("--data-only", action="store_true")
    parser.add_argument("--allow-incomplete", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--reference-image", action="append", type=Path, default=[])
    return parser.parse_args()


def install_extended_confidence_intervals(module) -> None:
    """Add paired intervals for the remaining publication comparisons."""

    canonical_builder = module.build_confidence_intervals

    def extended_builder(rows, aggregate_rows):
        records = canonical_builder(rows, aggregate_rows)
        groups = module.group_rows(rows)
        baseline = module.strongest_non_derya_baseline(aggregate_rows)
        if baseline is None:
            return records

        def append_difference(
            *,
            profile: str,
            query_type: str,
            metric: str,
            column: str,
            left_rows,
            right_rows,
            note: str,
        ) -> None:
            point, interval, case_count = module.paired_cluster_bootstrap(
                left_rows,
                right_rows,
                lambda row: row.get(column),
                lambda row: 1.0 if row.get(column) is not None else None,
                lambda row: row.get(column),
                lambda row: 1.0 if row.get(column) is not None else None,
                "difference",
                f"extended:{profile}:DERYA_HOT:{baseline}:{query_type}:{metric}",
            )
            if math.isfinite(point):
                records.append(module.ci_record(
                    profile=profile,
                    system="DERYA_HOT",
                    comparison_system=baseline,
                    query_type=query_type,
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(left_rows) + len(right_rows),
                    note=note,
                ))

        def append_bandwidth_difference(
            *, profile: str, metric: str, count_column: str, duration_column: str,
            left_rows, right_rows,
        ) -> None:
            point, interval, case_count = module.paired_cluster_bootstrap(
                left_rows,
                right_rows,
                lambda row: row.get(count_column),
                lambda row: (
                    float(row[duration_column]) / 1_000.0
                    if row.get(duration_column) is not None else None
                ),
                lambda row: row.get(count_column),
                lambda row: (
                    float(row[duration_column]) / 1_000.0
                    if row.get(duration_column) is not None else None
                ),
                "difference",
                f"extended:{profile}:DERYA_HOT:{baseline}:ALL:{metric}",
            )
            if math.isfinite(point):
                records.append(module.ci_record(
                    profile=profile,
                    system="DERYA_HOT",
                    comparison_system=baseline,
                    query_type="ALL",
                    metric=metric,
                    estimate=point,
                    interval=interval,
                    case_count=case_count,
                    execution_count=len(left_rows) + len(right_rows),
                    note=(
                        "Paired difference of aggregate gold-item counts divided by "
                        "aggregate wall time; all passes retained within case clusters."
                    ),
                ))

        for profile in module.PROFILE_ORDER:
            hot = groups.get((profile, "DERYA_HOT"), [])
            other = groups.get((profile, baseline), [])
            if not hot or not other:
                continue
            for metric, column in [
                ("temporal_order_accuracy_difference", "temporal_order_accuracy"),
                ("entity_resolution_accuracy_difference", "entity_resolution_accuracy"),
                ("strict_stale_detection_rate_difference", "strict_stale_detected"),
                ("stale_action_escape_rate_difference", "stale_escape"),
                ("false_conflict_rate_difference", "false_conflict"),
            ]:
                append_difference(
                    profile=profile,
                    query_type="ALL",
                    metric=metric,
                    column=column,
                    left_rows=hot,
                    right_rows=other,
                    note=(
                        "Primary paired comparison; case-cluster bootstrap with all "
                        "measured pass executions retained."
                    ),
                )
            append_bandwidth_difference(
                profile=profile,
                metric="evidence_bandwidth_per_second_difference",
                count_column="correct_evidence_count",
                duration_column="retrieval_ms",
                left_rows=hot,
                right_rows=other,
            )
            append_bandwidth_difference(
                profile=profile,
                metric="fact_bandwidth_per_second_difference",
                count_column="correct_fact_count",
                duration_column="hydration_ms",
                left_rows=hot,
                right_rows=other,
            )
            for query_type in module.QUERY_TYPE_ORDER:
                hot_type = [row for row in hot if row.get("query_type") == query_type]
                other_type = [row for row in other if row.get("query_type") == query_type]
                if not hot_type or not other_type:
                    continue
                for metric, column in [
                    ("evidence_recall_at_20_difference", "recall_at_20"),
                    ("fact_recall_at_20_difference", "fact_recall_at_20"),
                ]:
                    append_difference(
                        profile=profile,
                        query_type=query_type,
                        metric=metric,
                        column=column,
                        left_rows=hot_type,
                        right_rows=other_type,
                        note=(
                            "Primary paired query-type comparison; case-cluster "
                            "bootstrap with all measured pass executions retained."
                        ),
                    )
        return records

    module.build_confidence_intervals = extended_builder


def main() -> None:
    arguments = parse_arguments()
    module = load_statistics_module()
    if arguments.self_test:
        module.run_self_test()
        print(json.dumps({"ok": True, "mode": "self-test"}, indent=2))
        return
    if arguments.render:
        references = [path.resolve() for path in arguments.reference_image]
        if len(references) != 2 or not all(path.is_file() for path in references):
            raise RuntimeError(
                "Rendering requires exactly two accessible --reference-image files."
            )
        raise RuntimeError(
            "Reference files are present, but the visual renderer must be completed "
            "only after their pixels are inspected."
        )
    if not arguments.data_only:
        raise RuntimeError(
            "Use --data-only. Rendering remains blocked until both references are available."
        )
    install_extended_confidence_intervals(module)
    outputs = module.generate_data_outputs(
        arguments.results.resolve(),
        arguments.summary.resolve(),
        arguments.allow_incomplete,
    )
    print(json.dumps({
        "ok": True,
        "mode": "data-only",
        "bootstrapSamples": module.BOOTSTRAP_SAMPLES,
        "bootstrapUnit": "benchmark_case_cluster",
        "outputs": [str(path) for path in outputs],
    }, indent=2))


if __name__ == "__main__":
    main()
