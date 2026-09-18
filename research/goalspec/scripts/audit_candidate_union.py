"""Describe candidate-pool differences in one frozen replay without refitting."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path

from goalspec.metrics import canonical_json
from goalspec.storage import file_hash


def candidates(row: dict) -> tuple[tuple[str, str], ...]:
    ranked = sorted(row["prediction"]["candidates"], key=lambda item: (
        -item["probability"], item["tool"], canonical_json(item["arguments"]),
    ))
    return tuple(dict.fromkeys((item["tool"], canonical_json(item["arguments"])) for item in ranked))


def positive_support(row: dict) -> set[str]:
    return {goal_id for goal_id, probability in row["prediction"]["goal_posterior"]["probabilities"].items() if probability > 0}


def audit(directory: Path) -> dict:
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    path = directory / "predictions.jsonl"
    digest = file_hash(path)
    if summary["output_hashes"]["predictions.jsonl"] != digest:
        raise ValueError("Prediction file changed after summary publication")
    counts = Counter()
    per_condition = defaultdict(Counter)
    gain_by_scope_tool = Counter()
    seen = set()
    with path.open(encoding="utf-8") as stream:
        rows = (json.loads(line) for line in stream)
        for trajectory_id, trajectory_rows in groupby(rows, key=lambda row: row["trajectory_id"]):
            points = defaultdict(dict)
            for row in trajectory_rows:
                if row["condition"] in points[row["seq"]]:
                    raise ValueError("Duplicate condition/step")
                points[row["seq"]][row["condition"]] = row
            for seq, paired in points.items():
                identity = (trajectory_id, seq)
                if identity in seen or set(paired) != set(summary["metrics"]):
                    raise ValueError("Incomplete or duplicate step")
                seen.add(identity)
                counts["steps"] += 1
                target = (paired["paste"]["actual_tool"], canonical_json(paired["paste"]["actual_arguments"]))
                ranked = {condition: candidates(row) for condition, row in paired.items()}
                for condition, values in ranked.items():
                    per_condition[condition]["full_top1_hits"] += target in values[:1]
                    per_condition[condition]["full_top3_hits"] += target in values[:3]
                    per_condition[condition]["steps_with_candidates"] += bool(values)
                    per_condition[condition]["candidate_count"] += len(values)
                baseline, goal, shuffled = ranked["paste"], ranked["goalspec"], ranked["shuffled"]
                counts["goal_shuffled_same_candidate_set"] += set(goal) == set(shuffled)
                counts["goal_shuffled_same_candidate_order"] += goal == shuffled
                counts["goal_shuffled_same_top1_candidate"] += goal[:1] == shuffled[:1]
                counts["goal_shuffled_same_top1_hit_status"] += (target in goal[:1]) == (target in shuffled[:1])
                counts["goal_shuffled_same_top3_hit_status"] += (target in goal[:3]) == (target in shuffled[:3])
                counts["goal_strictly_expands_baseline_candidates"] += set(goal) > set(baseline)
                counts["goal_shuffled_different_tool_probabilities"] += paired["goalspec"]["prediction"]["tool_distribution"] != paired["shuffled"]["prediction"]["tool_distribution"]
                counts["goal_shuffled_same_positive_posterior_support"] += positive_support(paired["goalspec"]) == positive_support(paired["shuffled"])
                gain = target in goal[:1] and target not in baseline[:1]
                loss = target in baseline[:1] and target not in goal[:1]
                counts["goal_full_top1_gains_over_baseline"] += gain
                counts["goal_full_top1_losses_against_baseline"] += loss
                if gain:
                    counts["gains_target_absent_from_all_baseline_candidates"] += target not in baseline
                    counts["gains_target_present_in_baseline_but_reranked"] += target in baseline
                    counts["gains_also_hit_by_shuffled"] += target in shuffled[:1]
                    gain_by_scope_tool[(paired["paste"]["domain"], target[0])] += 1
    for condition, metrics in per_condition.items():
        expected = summary["metrics"][condition]
        if expected["prediction_steps"] != counts["steps"] or not math.isclose(metrics["full_top1_hits"] / counts["steps"], expected["tool_arguments_top1"], abs_tol=1e-12):
            raise ValueError("Recomputed full-argument accuracy disagrees with the frozen summary")
    return {
        "schema_version": 1, "partition": summary["partition"],
        "run_path": str(directory), "predictions_sha256": digest,
        "summary_sha256": file_hash(directory / "summary.json"), "source_sha256": summary["source_hash"],
        "counts": dict(counts), "condition_counts": dict(per_condition),
        "goal_top1_gains_by_domain_tool": [{"domain": domain, "tool": tool, "gains": value} for (domain, tool), value in sorted(gain_by_scope_tool.items())],
        "interpretation": "Observational audit only. The implementation mixes candidates from every goal with positive posterior mass. Equal candidate sets and correct-call gains under shuffled goals can arise from access to additional goal-specific argument bindings, independently of identifying the right endpoint. Prediction weights may still differ. This is not a new experiment, tuned configuration, or causal attribution.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.run)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps(report["counts"], indent=2))
