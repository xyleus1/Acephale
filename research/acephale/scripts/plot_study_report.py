"""Plot a completed, verified study report without rescoring trials.

Usage: python plot_study_report.py --report report.json --completion result.json --output figures
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ARMS = ("base", "neutral_memory_prefetch", "acephale")
LABELS = {"base": "Base", "neutral_memory_prefetch": "Neutral prefetch", "acephale": "Goal prefetch"}
COLORS = ("#747b83", "#397f9b", "#c56b38")


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_report(path: Path, completion_path: Path) -> dict:
    report = json.loads(path.read_text(encoding="utf-8"))
    completion = json.loads(completion_path.read_text(encoding="utf-8"))
    if not (
        completion.get("completed") is True
        and completion.get("cleanupVerified") is True
        and completion.get("reportSha256") == sha(path)
        and completion.get("reportContentHash") == report.get("contentHash")
        and all(report.get(key, {}).get("status") == "closed" for key in
                ("mainTraining", "predictionReplay", "goalAgreement", "nativeDevelopment", "nativeHeldout"))
    ):
        raise ValueError("A completed verified study and its exact finalization receipt are required")
    return report


def save(figure, output: Path, name: str) -> list[Path]:
    paths = []
    for extension in ("png", "pdf", "svg"):
        path = output / f"{name}.{extension}"
        figure.savefig(path, dpi=180, bbox_inches="tight", facecolor="white")
        paths.append(path)
    return paths


def plot_stage(report: dict, stage: str, output: Path) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    section = report["native" + stage.capitalize()]
    scores = section["nativeCompletionAndLiveLatency"]
    rows = scores["arms"]
    if set(rows) != set(ARMS):
        raise ValueError("All three declared arms are required")
    figure, axes = plt.subplots(1, 3, figsize=(11.5, 3.6), layout="constrained")
    views = (
        ("Task success (%)", lambda row: 100 * row["pass1"], ".1f"),
        ("Mean live latency (s)", lambda row: None if row["mean_latency_ms"] is None
         else row["mean_latency_ms"] / 1000, ".2f"),
        ("Counted environment operations / trial", lambda row: None
         if row["physical_calls"]["missing_trials"] or not row["scheduled_trials"]
         else row["physical_calls"]["known_total"] / row["scheduled_trials"], ".2f"),
    )
    for axis, (title, metric, fmt) in zip(axes, views, strict=True):
        for index, arm in enumerate(ARMS):
            row = rows[arm]
            value = metric(row)
            if value is None:
                axis.text(index, 0, "Unavailable", ha="center", va="bottom", fontsize=9)
                continue
            axis.bar(index, value, color=COLORS[index], width=.64)
            label = (f"{row['successes']}/{row['scheduled_trials']}" if title.startswith("Task")
                     else format(value, fmt) + "\n(n=" + str(row["latency_samples"]
                         if title.startswith("Mean") else row["scheduled_trials"]) + ")")
            axis.annotate(label, (index, value), xytext=(0, 5), textcoords="offset points",
                          ha="center", fontsize=9)
        axis.set_title(title, fontsize=10)
        axis.set_xticks(range(3), [LABELS[arm] for arm in ARMS], rotation=20, ha="right")
        axis.set_ylim(bottom=0)
        if title.startswith("Task"):
            axis.set_ylim(0, 112)
        else:
            axis.margins(y=.2)
        axis.spines[["top", "right"]].set_visible(False)
        axis.set_axisbelow(True)
        axis.grid(axis="y", alpha=.15)
    figure.suptitle(f"Acephale: {stage} custom tau-compatible trials", fontsize=13)
    paths = save(figure, output, f"native-{stage}")
    plt.close(figure)

    comparisons = scores["paired_comparisons"]
    figure, axes = plt.subplots(1, 3, figsize=(15, 4.2), layout="constrained")
    views = (("success_difference", "Task success difference (percentage points)", 100),
             ("latency_ms_difference", "Live latency difference (seconds)", .001),
             ("physical_calls_difference", "Environment-operation difference", 1))
    labels = [LABELS[row["treatment"]] + " minus " + LABELS[row["baseline"]] for row in comparisons]
    for axis, (key, title, scale) in zip(axes, views, strict=True):
        axis.axvline(0, color="#969da3", linewidth=1)
        for index, comparison in enumerate(comparisons):
            metric = comparison["metrics"][key]
            if metric.get("estimate") is None:
                axis.text(0, index, "Unavailable", va="center", fontsize=9)
                continue
            estimate = metric["estimate"] * scale
            interval = metric.get("ci95")
            if interval is not None:
                axis.hlines(index, interval[0] * scale, interval[1] * scale, color=COLORS[2], linewidth=2)
            axis.plot(estimate, index, "o", color=COLORS[2], markersize=5)
        sample_labels = [label + f"\n{comparison['metrics'][key]['families']} families, "
            + f"{comparison['metrics'][key]['paired_trials']} paired trials"
            for label, comparison in zip(labels, comparisons, strict=True)]
        axis.set_yticks(range(len(labels)), sample_labels, fontsize=8)
        axis.set_title(title, fontsize=10)
        axis.spines[["top", "right"]].set_visible(False)
        axis.margins(y=.3, x=.15)
    figure.suptitle(f"{stage.capitalize()}: paired differences and 95% family-bootstrap intervals", fontsize=12)
    paths += save(figure, output, f"paired-{stage}")
    plt.close(figure)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("report", "completion", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    report = load_report(args.report, args.completion)
    args.output.mkdir(parents=True, exist_ok=False)
    paths = []
    for stage in ("heldout", "development"):
        paths += plot_stage(report, stage, args.output)
    manifest = {"reportSha256": sha(args.report), "reportContentHash": report["contentHash"],
        "scoresRecomputed": False, "modelCallsPerformed": False,
        "files": [{"path": path.name, "sha256": sha(path)} for path in paths],
        "notes": ["Custom tau-compatible study, not an official full-benchmark score.",
                  "All declared slots remain in task-success denominators.",
                  "Latency includes predictor and managed-drain effects; samples are in the source report.",
                  "Environment-operation counters include wrapper and validation attempts, not database queries.",
                  "Intervals are copied from the scored report, not recomputed by this renderer."]}
    (args.output / "figure-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"figures": len(paths), "reportContentHash": report["contentHash"]}))


if __name__ == "__main__":
    main()
