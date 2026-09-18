"""Export descriptive v2 development and confirmation figures from final summaries."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent


def main(output: Path):
    output = output.resolve()
    if output.exists() or output.parent != HERE:
        raise ValueError("Use a new output directory directly under the v2 report")
    paired_path = HERE / "legacy-comparison/summary.json"
    native_path = HERE / "final-three-stage-analysis/summary.json"
    paired = json.loads(paired_path.read_text(encoding="utf-8"))
    native = json.loads(native_path.read_text(encoding="utf-8"))
    confirmation = [stage for stage in native["stages"] if stage["studyStage"] == "confirmation"]
    if paired["pairedCheckpoints"] != 213 or len(confirmation) != 1:
        raise ValueError("Unexpected study cohort")
    arms = confirmation[0]["arms"]
    names = ["base", "neutral_memory_prefetch", "goalspec"]
    if any(arms[name]["trials"] != 16 for name in names):
        raise ValueError("Expected all 16 confirmation trials per arm")
    colors = ["#8493a7", "#38a397", "#4563bf"]
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.fonttype": "none", "savefig.facecolor": "white"})
    fig, axes = plt.subplots(1, 3, figsize=(14.4, 5.1), gridspec_kw={"width_ratios": [1.25, 1, 1]})
    fig.subplots_adjust(left=.055, right=.985, top=.73, bottom=.28, wspace=.36)
    fig.suptitle("Reliable goal output; no live success or speed gain established", x=.055, ha="left", y=.97,
                 fontsize=17, weight="bold")
    fig.text(.055, .895, "Two separate datasets: archived-checkpoint development and fresh native confirmation", fontsize=11, color="#45546a")
    ax = axes[0]
    xs = np.arange(2)
    metrics = [paired["goalMetrics"][name] for name in ("Valid", "SemanticTop1")]
    for offset, version, color in ((-.18, "v1", "#8493a7"), (.18, "v2", "#4563bf")):
        values = [metric[version + "Rate"] for metric in metrics]
        bars = ax.bar(xs + offset, values, .32, label=version.upper(), color=color)
        for bar, metric in zip(bars, metrics):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + .035,
                    f"{metric[version + 'Count']}/213", ha="center", fontsize=10)
    ax.set_title("A  Archived checkpoints\nDevelopment, same 213 inputs", loc="left", fontsize=12, pad=14)
    ax.set_xticks(xs, ["Valid canonical\ngoal output", "Teacher complete-\nrequest match"])
    ax.set_ylim(0, 1.17)
    ax.set_yticks([0, .25, .5, .75, 1], ["0%", "25%", "50%", "75%", "100%"])
    handles, labels = ax.get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower left", bbox_to_anchor=(.055, .15),
               ncol=2, frameon=False, borderaxespad=0)

    ax = axes[1]
    values = [arms[name]["nativeSuccess"] for name in names]
    intervals = [arms[name]["successInterval"]["ci95"] for name in names]
    bars = ax.bar(np.arange(3), values, color=colors, width=.62,
                  yerr=np.asarray([[v - ci[0] for v, ci in zip(values, intervals)],
                                   [ci[1] - v for v, ci in zip(values, intervals)]]),
                  capsize=4, error_kw={"elinewidth": 1.2, "ecolor": "#273449"})
    for bar, name in zip(bars, names):
        ax.text(bar.get_x() + bar.get_width() / 2, 1.065, f"{arms[name]['successes']}/16", ha="center")
    ax.set_title("B  Fresh confirmation\nPrimary native success", loc="left", fontsize=12, pad=14)
    ax.set_xticks(np.arange(3), ["Base", "Neutral", "GoalSpec"])
    ax.set_ylim(0, 1.17)
    ax.set_yticks([0, .25, .5, .75, 1], ["0%", "25%", "50%", "75%", "100%"])

    ax = axes[2]
    means = [arms[name]["timings"]["totalTrialSeconds"]["mean"] for name in names]
    bars = ax.bar(np.arange(3), means, color=colors, width=.62)
    for bar, mean in zip(bars, means):
        ax.text(bar.get_x() + bar.get_width() / 2, mean + 1, f"{mean:.2f} s", ha="center")
    ax.set_title("C  Fresh confirmation\nMean total trial time, n=16/arm", loc="left", fontsize=12, pad=14)
    ax.set_xticks(np.arange(3), ["Base", "Neutral", "GoalSpec"])
    ax.set_ylim(0, 49)
    ax.set_ylabel("Seconds, including worker drain")
    for ax in axes:
        ax.set_axisbelow(True)
        ax.grid(axis="y", alpha=.16)
    fig.text(.055, .11, "A: failures remain misses; automated teacher match is not an exhaustive constraint audit. Previously observed inputs are development evidence.", fontsize=9)
    fig.text(.055, .073, "B: all failures retained, including one GoalSpec lexical verifier false negative; bars show family-bootstrap 95% intervals (4 families).", fontsize=9)
    fig.text(.055, .036, "C: all observed trials retained, including startup waiting assigned unevenly across arms. Separate dataset from A; no cross-dataset causal claim.", fontsize=9)
    output.mkdir()
    for extension in ("svg", "png"):
        fig.savefig(output / f"goal-and-native-results.{extension}", dpi=180)
    plt.close(fig)
    sources = [{"path": str(path.relative_to(HERE)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
               for path in (paired_path, native_path, Path(__file__))]
    (output / "manifest.json").write_text(json.dumps({"sources": sources,
        "files": [{"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(output.iterdir())]}, indent=2) + "\n", encoding="utf-8")
    print(str(output))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    main(parser.parse_args().output)
