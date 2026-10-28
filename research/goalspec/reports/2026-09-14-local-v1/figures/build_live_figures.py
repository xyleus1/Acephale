"""Render standalone figures from the immutable local held-out live analysis."""
import hashlib
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[5]
SOURCE = ROOT / "research/goalspec/runs/local-heldout-analysis-v1-20260915"
OUTPUT = Path(__file__).resolve().parent
ARMS = ("base", "neutral_memory_prefetch", "goalspec")
LABELS = ("Base", "Neutral memory", "GoalSpec")
COLORS = ("#425a70", "#218680", "#bd5c34")
summary = json.loads((SOURCE / "summary.json").read_text(encoding="utf-8"))
trials = [json.loads(line) for line in (SOURCE / "trial-results.jsonl").read_text(encoding="utf-8").splitlines()]
assert len(trials) == 192
assert all(summary["arms"][arm]["trials"] == 64 for arm in ARMS)

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11, "axes.titlesize": 13,
    "axes.labelcolor": "#243442", "text.color": "#243442",
    "axes.edgecolor": "#bac4cc", "xtick.color": "#425263", "ytick.color": "#425263",
    "axes.spines.top": False, "axes.spines.right": False,
    "svg.fonttype": "none", "svg.hashsalt": "goalspec-live-v1",
})


def finish(figure, basename, footer):
    figure.text(.08, .03, footer, fontsize=9, color="#52616f", va="bottom", linespacing=1.5)
    for extension in ("svg", "png"):
        target = OUTPUT / f"{basename}.{extension}"
        if target.exists():
            raise FileExistsError(target)
        figure.savefig(target, dpi=180, facecolor="white", metadata={"Creator": "GoalSpec local analysis"})
    plt.close(figure)


figure, axis = plt.subplots(figsize=(10.5, 5.6))
figure.subplots_adjust(left=.21, right=.88, top=.74, bottom=.22)
figure.text(.08, .91, "Held-out live task success", fontsize=20, weight="bold")
figure.text(.08, .845, "192 declared trials across 16 families; 64 trials per arm", fontsize=11)
for index, (arm, color) in enumerate(zip(ARMS, COLORS, strict=True)):
    metric = summary["arms"][arm]
    value = metric["nativeSuccess"] * 100
    low, high = np.array(metric["successInterval"]["ci95"]) * 100
    axis.errorbar(value, index, xerr=[[value - low], [high - value]], fmt="o",
                  color=color, capsize=6, markersize=10, elinewidth=2)
    axis.text(102, index, f"{metric['successes']}/64\n{value:.2f}%", va="center", fontsize=11,
              color=color, weight="bold")
axis.set_yticks(range(3), LABELS)
axis.set_ylim(2.55, -.55)
axis.set_xlim(0, 100)
axis.set_xticks(range(0, 101, 20), [f"{value}%" for value in range(0, 101, 20)])
axis.set_xlabel("Successful trials")
axis.grid(axis="x", color="#e3e9ed")
axis.set_axisbelow(True)
axis.spines["left"].set_visible(False)
axis.tick_params(axis="y", length=0, pad=12)
finish(figure, "heldout-success", "Intervals: exploratory 95% family-clustered bootstrap, stratified by domain (2,000 samples).\nAll failures retained. Custom tau-compatible pilot; not an official full-benchmark score.")

figure, (mean_axis, distribution_axis) = plt.subplots(1, 2, figsize=(12, 6), gridspec_kw={"width_ratios": [1, 1.5]})
figure.subplots_adjust(left=.14, right=.97, top=.71, bottom=.23, wspace=.26)
figure.text(.07, .92, "Held-out live latency", fontsize=20, weight="bold")
figure.text(.07, .855, "Whole trial: actor, prediction, tools, freshness checks and orchestration", fontsize=11)
generator = np.random.default_rng(42)
for index, (arm, color) in enumerate(zip(ARMS, COLORS, strict=True)):
    metric = summary["arms"][arm]
    mean = metric["latency"]["mean"] / 1000
    values = np.array([row["latencyMs"] / 1000 for row in trials if row["arm"] == arm])
    assert len(values) == 64 and np.all((values >= .02) & (values <= 1500))
    mean_axis.barh(index, mean, color=color, height=.48)
    mean_axis.text(mean + 2, index, f"{mean:.2f}s", va="center", fontsize=10, weight="bold", color=color)
    distribution_axis.scatter(values, index + generator.uniform(-.18, .18, len(values)), s=20,
                              color=color, alpha=.57, linewidths=0)
    distribution_axis.scatter(metric["latency"]["p95"] / 1000, index, marker="D", s=65,
                              color="white", edgecolor=color, linewidth=1.8, zorder=4,
                              label="Observed p95" if index == 0 else None)
mean_axis.set_yticks(range(3), [f"{label}\n(n = 64)" for label in LABELS])
mean_axis.set_xlim(0, 112)
mean_axis.set_xticks([0, 25, 50, 75, 100])
mean_axis.set_xlabel("Seconds")
mean_axis.set_title("Mean elapsed time", loc="left", pad=13)
distribution_axis.set_yticks(range(3), [""] * 3)
distribution_axis.set_xscale("log")
distribution_axis.set_xlim(.02, 1500)
distribution_axis.set_xticks([.03, .1, 1, 10, 100, 1000], ["0.03", "0.1", "1", "10", "100", "1,000"])
distribution_axis.set_xlabel("Seconds (log scale)")
distribution_axis.set_title("Every measured trial, including failures", loc="left", pad=13)
distribution_axis.legend(loc="upper center", bbox_to_anchor=(.52, -.19), frameon=False, fontsize=9)
for axis in (mean_axis, distribution_axis):
    axis.set_ylim(2.55, -.55)
    axis.grid(axis="x", color="#e3e9ed")
    axis.set_axisbelow(True)
    axis.spines["left"].set_visible(False)
    axis.tick_params(axis="y", length=0, pad=10)
finish(figure, "heldout-latency", "p95: Base 38.24s; Neutral memory 122.59s; GoalSpec 147.53s. Sample tails are descriptive.\nAll 192 declared trials retained. Local machine contention and provider failures remain in measured latency.")

manifest = {
    "schemaVersion": "1.0.0",
    "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
    "sourceHashes": {name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()
                     for name in ("summary.json", "trial-results.jsonl")},
    "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(OUTPUT.iterdir()) if path.suffix in {".svg", ".png", ".py"}},
    "trials": 192,
    "trialsPerArm": 64,
    "allFailuresRetained": True,
    "latencyUnit": "seconds",
    "successIntervals": "exploratory_family_clustered_95_percent_bootstrap_stratified_by_domain",
    "matplotlibVersion": matplotlib.__version__,
}
with (OUTPUT / "manifest.json").open("x", encoding="utf-8") as stream:
    json.dump(manifest, stream, indent=2)
    stream.write("\n")
print(json.dumps({"status": "complete", "output": str(OUTPUT), "figures": 4}))
