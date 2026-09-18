"""Export exploratory public-replay profiles from integrity-verified test records.

Usage: uv run --extra analysis python scripts/plot_public_results.py REPLAY OUTPUT
The output directory must be new. No prediction or annotation is recomputed here.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from goalspec.metrics import negative_log_likelihood
from goalspec.reporting import verified_replay
from goalspec.storage import file_hash, write_json

CONDITIONS = ("goalspec_initial", "oracle")
LABELS = {"goalspec_initial": "Inferred initial goal", "oracle": "Proxy oracle"}
DEPTH_BINS = ((0, 5), (5, 10), (10, 15), (15, 20), (20, 30), (30, None))
CONFIDENCE_BINS = ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0))


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"No measured records available for {path.name}")
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def paired_records(directory: Path, rows) -> list[dict]:
    """Validate identical targets, then join logged depth and initial confidence."""
    depths = {}
    for item in read_jsonl(directory / "observations.jsonl"):
        key = (item["trajectory_id"], item["turn"])
        if key in depths and depths[key] != item["depth"]:
            raise ValueError("Conditions disagree on decision depth")
        depths[key] = item["depth"]
    initial = {}
    for item in read_jsonl(directory / "initial-goals.jsonl"):
        identifier = item["trajectory_id"]
        if identifier in initial:
            raise ValueError("Duplicate initial posterior")
        probabilities = item["posterior"]["probabilities"]
        winner = min(probabilities, key=lambda goal: (-probabilities[goal], goal))
        initial[identifier] = (probabilities[winner], winner == "__unknown__")
    by_condition = {condition: {} for condition in ("paste", *CONDITIONS)}
    for row in rows:
        if row.condition in by_condition:
            collection = by_condition[row.condition]
            if row.step_key in collection:
                raise ValueError("Duplicate paired prediction")
            collection[row.step_key] = row
    baseline = by_condition["paste"]
    if not baseline or any(set(collection) != set(baseline) for collection in by_condition.values()):
        raise ValueError("Conditions must contain the same nonempty set of target calls")
    records = []
    for key, base in sorted(baseline.items()):
        if base.benchmark != "tau3-public-replay":
            raise ValueError("This report is scoped to public tau trajectory replay")
        confidence, unknown = initial[base.trajectory_id]
        base_loss = negative_log_likelihood(base)
        for condition in CONDITIONS:
            treated = by_condition[condition][key]
            if (treated.actual_tool, treated.actual_arguments) != (base.actual_tool, base.actual_arguments):
                raise ValueError("Paired conditions target different actual calls")
            treated_loss = negative_log_likelihood(treated)
            records.append({
                "benchmark": base.benchmark, "domain": base.domain,
                "trajectory_id": base.trajectory_id, "task_id": base.task_id,
                "group_id": base.group_id, "trial": base.trial, "seq": base.seq,
                "decision_depth": depths[key], "initial_goal_confidence": confidence,
                "initial_choice_unknown": unknown, "condition": condition,
                "paste_nll": base_loss, "treatment_nll": treated_loss,
                "nll_advantage": base_loss - treated_loss,
            })
    return records


def aggregate(records: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for record in records:
        for profile in ("decision_depth", "initial_goal_confidence"):
            value = record[profile]
            bins = DEPTH_BINS if profile == "decision_depth" else CONFIDENCE_BINS
            for index, (lower, upper) in enumerate(bins):
                in_bin = lower <= value and (
                    upper is None or value < upper
                    or (profile == "initial_goal_confidence" and index == len(bins) - 1 and value == upper)
                )
                if in_bin:
                    key = (record["benchmark"], record["domain"], profile, index, record["condition"])
                    groups[key].append(record)
                    break
            else:
                raise ValueError(f"Unbinned measured {profile}: {value}")
    aggregates = []
    for (benchmark, domain, profile, index, condition), members in sorted(groups.items()):
        bins = DEPTH_BINS if profile == "decision_depth" else CONFIDENCE_BINS
        lower, upper = bins[index]
        label = (
            f"{lower}+" if upper is None else f"{lower}-{upper - 1}"
        ) if profile == "decision_depth" else f"[{lower:.1f},{upper:.1f}{']' if index == len(bins) - 1 else ')'}"
        aggregates.append({
            "benchmark": benchmark, "domain": domain, "profile": profile,
            "bin_index": index, "bin_label": label, "bin_lower": lower,
            "bin_upper_exclusive": upper if not (profile == "initial_goal_confidence" and index == len(bins) - 1) else None,
            "condition": condition, "paired_calls": len(members),
            "tasks": len({row["task_id"] for row in members}),
            "trajectories": len({row["trajectory_id"] for row in members}),
            "families": len({row["group_id"] for row in members}),
            "mean_paste_nll": sum(row["paste_nll"] for row in members) / len(members),
            "mean_treatment_nll": sum(row["treatment_nll"] for row in members) / len(members),
            "mean_nll_advantage": sum(row["nll_advantage"] for row in members) / len(members),
            "initial_unknown_choice_fraction": sum(row["initial_choice_unknown"] for row in members) / len(members),
        })
    return aggregates


def plot_profiles(aggregates: list[dict], output: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    domains = sorted({row["domain"] for row in aggregates})
    figure, axes = plt.subplots(2, len(domains), figsize=(4.6 * len(domains), 8), squeeze=False, sharey="row")
    colors = {"goalspec_initial": "#1769aa", "oracle": "#ca562c"}
    for column, domain in enumerate(domains):
        for row_index, profile in enumerate(("decision_depth", "initial_goal_confidence")):
            axis = axes[row_index][column]
            for condition in CONDITIONS:
                scoped = [row for row in aggregates if row["domain"] == domain and row["profile"] == profile and row["condition"] == condition]
                shift = -0.09 if condition == "goalspec_initial" else 0.09
                # Discrete points avoid implying measured values in empty bins.
                axis.scatter([row["bin_index"] + shift for row in scoped],
                             [row["mean_nll_advantage"] for row in scoped],
                             label=LABELS[condition], color=colors[condition],
                             marker="o" if condition == "goalspec_initial" else "D", s=48)
                if condition == "goalspec_initial":
                    for row in scoped:
                        axis.annotate(f"n={row['paired_calls']}",
                                      (row["bin_index"] + shift, row["mean_nll_advantage"]),
                                      xytext=(0, 9), textcoords="offset points", ha="center", fontsize=7, color="#555555")
            axis.axhline(0, color="#444444", linewidth=0.9)
            axis.grid(axis="y", alpha=0.2)
            axis.set_title(domain.replace("_", " "))
            if profile == "decision_depth":
                labels = [f"{lower}+" if upper is None else f"{lower}-{upper - 1}" for lower, upper in DEPTH_BINS]
                axis.set_xlabel("Decision depth (zero based)")
            else:
                labels = [f"{lower:.1f}-{upper:.1f}" for lower, upper in CONFIDENCE_BINS]
                axis.set_xlabel("Maximum initial goal probability")
            axis.set_xticks(range(len(labels)), labels, rotation=25)
            axis.set_xlim(-0.5, len(labels) - 0.5)
            if column == 0:
                axis.set_ylabel("Mean NLL advantage vs PASTE-style (nats)")
    handles, labels = axes[0][0].get_legend_handles_labels()
    figure.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, 0.955), ncol=2, frameon=False)
    figure.suptitle("Endpoint-conditioned next-tool prediction on published test trajectories", y=0.995, fontsize=14)
    figure.text(0.5, 0.01,
                "Exploratory, call-weighted paired differences. Positive means lower loss. No cluster confidence intervals.\n"
                "n counts paired calls; repeated trials remain correlated. Confidence includes the unknown-goal class. Empty bins are unmeasured.",
                ha="center", fontsize=9)
    figure.tight_layout(rect=(0, 0.075, 1, 0.915), h_pad=2.2)
    figure.savefig(output / "prediction-profiles.png", dpi=200)
    figure.savefig(output / "prediction-profiles.svg")
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    summary, rows = verified_replay(args.replay)
    if summary["partition"] != "test":
        raise ValueError("This script only exports the frozen test replay")
    if args.output.exists():
        raise ValueError("Output directory must not already exist")
    records = paired_records(args.replay, rows)
    aggregates = aggregate(records)
    args.output.mkdir(parents=True)
    manifest = {
        "schema_version": 1, "status": "running", "partition": "test",
        "measurement": "exploratory_call_weighted_paired_next_tool_nll_advantage",
        "intervals": "none; consult primary domain-macro family-bootstrap comparisons separately",
        "confidence_definition": "maximum inferred initial posterior probability, including unknown",
        "replay": str(args.replay.resolve()),
        "replay_run_sha256": file_hash(args.replay / "run.json"),
        "replay_summary_sha256": file_hash(args.replay / "summary.json"),
        "replay_artifact_hashes": summary["output_hashes"],
        "plot_script_sha256": file_hash(Path(__file__)),
        "depth_bins": DEPTH_BINS, "confidence_bins": CONFIDENCE_BINS,
        "conditions": CONDITIONS, "files": {},
    }
    write_json(args.output / "manifest.json", manifest)
    try:
        write_csv(args.output / "paired-calls.csv", records)
        write_csv(args.output / "profiles.csv", aggregates)
        plot_profiles(aggregates, args.output)
        (args.output / "README.md").write_text(
            "# Exploratory prediction profiles\n\n"
            "![Paired next-tool NLL advantage](prediction-profiles.png)\n\n"
            "Every dot is a measured mean over paired authoritative calls from the integrity-verified test replay. "
            "Positive values mean lower loss than this repository's PASTE-style predictor. "
            "Counts, raw paired differences, and unknown-choice fractions are in the CSV files. "
            "These call-weighted profiles are exploratory, have no uncertainty intervals, and do not replace "
            "the primary task-equal/domain-macro estimator with family-cluster bootstrap. "
            "Initial confidence includes the unknown-goal class. Proxy-oracle curves use the same inferred-confidence bins. "
            "Empty bins have no observations and are not interpolated. No speculative tools were executed.\n",
            encoding="utf-8",
        )
        manifest["files"] = {path.name: file_hash(path) for path in sorted(args.output.iterdir()) if path.is_file() and path.name != "manifest.json"}
        manifest["status"] = "complete"
    except BaseException as error:
        manifest.update(status="failed", error_type=type(error).__name__)
        raise
    finally:
        write_json(args.output / "manifest.json", manifest)
    print(args.output / "prediction-profiles.png")


if __name__ == "__main__":
    main()
