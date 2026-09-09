#!/usr/bin/env python3
"""Render audited benchmark figures without recomputing statistical estimates.

Adapted from the original share-figure themes. All values, intervals, labels,
and winners come from the current audited statistics. Figures are never marked
visually verified automatically. Inspect every output before changing that flag.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import MaxNLocator, PercentFormatter

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "7e23ff685bc88b3427e236d94e5463bae01a6304"
PROFILES = ("graph-small", "graph-medium", "graph-large")
PROFILE_LABELS = ("10K", "50K", "250K")
SYSTEMS = ("CURRENT_KEYWORD", "VECTOR_RAG", "STRONG_HYBRID_RAG", "DERYA_COLD", "DERYA_HOT")
LABELS = ("Current Keyword", "Vector RAG", "Strong Hybrid RAG", "Derya Cold", "Derya Hot")
QUERIES = ("exact", "semantic", "current_vs_stale", "temporal", "entity_hop", "routing_tenant", "autopilot_action")
COLORS = ("#747c78", "#4d5552", "#1b1d1c", "#a76b45", "#29485c")
MARKERS = ("D", "^", "s", "o", "o")
INPUTS = ("analysis/data/figure_data.csv", "analysis/data/confidence_intervals.csv", "analysis/findings.json")
ARTIFACTS: list[dict] = []


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def select(rows, **filters):
    matches = [row for row in rows if all(row.get(key, "") == value for key, value in filters.items())]
    require(len(matches) == 1, f"Expected exactly one row for {filters}; found {len(matches)}")
    return matches[0]


def number(row, key):
    value = float(row[key])
    require(math.isfinite(value), f"Non-finite {key}")
    return value


def aggregate(rows, profile, system):
    return select(rows, profile=profile, system=system, query_type="ALL")


def interval(rows, profile, system, metric, query_type="ALL", comparison=""):
    return select(rows, profile=profile, system=system, metric=metric,
                  query_type=query_type, comparison_system=comparison)


def errors(record, scale=1):
    estimate, low, high = [number(record, key) * scale for key in ("estimate", "ci_low", "ci_high")]
    require(low <= estimate + 1e-9 and estimate <= high + 1e-9, "Interval excludes its point estimate")
    return np.array([[max(0, estimate-low)], [max(0, high-estimate)]])


def verify_point_estimates(data, confidence):
    """Reject mixed point/interval tables even when both have valid row counts."""
    for ci in confidence:
        metric = ci["metric"]
        row = select(data, profile=ci["profile"], system=ci["system"], query_type=ci["query_type"])
        comparison = ci.get("comparison_system", "")
        expected = None
        if not comparison and metric in row and row[metric] != "":
            expected = number(row, metric)
        elif comparison and metric in ("evidence_recall_at_20_difference", "evidence_bandwidth_ratio"):
            other = select(data, profile=ci["profile"], system=comparison, query_type=ci["query_type"])
            if metric == "evidence_recall_at_20_difference":
                expected = number(row, "evidence_recall_at_20") - number(other, "evidence_recall_at_20")
            else:
                denominator = number(other, "evidence_bandwidth_per_second")
                require(denominator > 0, "Invalid bandwidth-ratio denominator")
                expected = number(row, "evidence_bandwidth_per_second") / denominator
        if expected is not None:
            require(math.isclose(number(ci,"estimate"), expected, rel_tol=1e-10, abs_tol=1e-10),
                    f"Mixed point and confidence-interval tables: {ci['profile']}/{ci['system']}/{metric}")


def setup():
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 12,
        "figure.facecolor": "#ffffff", "axes.facecolor": "#ffffff",
        "text.color": "#1b1d1c", "axes.labelcolor": "#1b1d1c",
        "xtick.color": "#4d5552", "ytick.color": "#4d5552",
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.edgecolor": "#c7ceca", "svg.hashsalt": "derya-memory-main-7e23ff6",
        "savefig.dpi": 150,
    })


def figure(title, subtitle, panels=1, figsize=(15, 9)):
    fig, axes = plt.subplots(1, panels, figsize=figsize, squeeze=False)
    fig.suptitle(title, x=.08, y=.98, ha="left", fontsize=23, weight="medium")
    fig.text(.08, .925, subtitle, ha="left", va="top", fontsize=11, color="#4d5552")
    fig.subplots_adjust(left=.16, right=.95, bottom=.20, top=.82, wspace=.45)
    for ax in axes.flat:
        ax.set_axisbelow(True)
        ax.grid(axis="x", color="#e0e4e2", linewidth=.7)
    return fig, list(axes.flat)


def finish(fig, name, note):
    fig.text(.08, .075, note, ha="left", va="bottom", fontsize=10, color="#4d5552", linespacing=1.5)
    fig.text(.08, .035, "Synthetic architecture comparison | source 7e23ff6 | 200 unique cases x 10 passes per profile",
             fontsize=9, color="#4d5552")
    fig.canvas.draw()
    for extension in ("png", "svg"):
        target = ROOT / "figures" / f"{name}.{extension}"
        require(not target.exists(), f"Refusing to overwrite {target}")
        metadata = {"Title": name, "Description": note} if extension == "svg" else {"Title": name}
        if extension == "svg":
            metadata["Date"] = None
        fig.savefig(target, metadata=metadata)
        ARTIFACTS.append({"path": target.relative_to(ROOT).as_posix(), "sha256": digest(target), "bytes": target.stat().st_size})
    plt.close(fig)


def recall_latency(data, confidence):
    fig, (recall, latency) = figure("Evidence recall and tail latency at 250K", "All five systems; error bars show case-cluster 95% recall intervals.", panels=2)
    positions = np.arange(len(SYSTEMS))
    for idx, system in enumerate(SYSTEMS):
        row = aggregate(data, "graph-large", system)
        ci = interval(confidence, "graph-large", system, "evidence_recall_at_20")
        value = number(row, "evidence_recall_at_20") * 100
        recall.errorbar(value, idx, xerr=errors(ci, 100), fmt=MARKERS[idx], color=COLORS[idx], capsize=4, markersize=8)
        recall.annotate(f"{value:.2f}%", (value, idx), xytext=(0, 13), textcoords="offset points", ha="center", fontsize=10)
        tail = number(row, "latency_p95_ms") / 1000
        latency.barh(idx, tail, height=.48, color=COLORS[idx])
        latency.text(tail, idx, f"  {tail:.2f}s", va="center", fontsize=11)
    recall.set_yticks(positions, LABELS)
    latency.set_yticks(positions, LABELS)
    for ax in (recall, latency):
        ax.invert_yaxis()
        ax.set_ylim(4.7, -.7)
    recall.set_xlim(0, 105)
    recall.xaxis.set_major_formatter(PercentFormatter(100))
    recall.set_xlabel("Evidence Recall@20 (higher is better)")
    max_latency = max(number(aggregate(data, "graph-large", s), "latency_p95_ms") / 1000 for s in SYSTEMS)
    latency.set_xlim(0, max_latency * 1.28)
    latency.set_xlabel("Retrieval/hydration p95 (seconds)")
    delta = interval(confidence, "graph-large", "DERYA_HOT", "evidence_recall_at_20_difference", comparison="STRONG_HYBRID_RAG")
    note = (f"Derya Hot minus Strong Hybrid recall: {number(delta,'estimate')*100:+.2f} pp; paired 95% CI "
            f"{number(delta,'ci_low')*100:+.2f} to {number(delta,'ci_high')*100:+.2f} pp.\n"
            "Derya additionally receives exact operational scope. Latency excludes separately measured validation; no RAM metric is measured.")
    finish(fig, "01_recall_latency", note)


def profiles(data, confidence, metric, ci_metric, title, ylabel, output, scale=1, log=False):
    fig, (ax,) = figure(title, "Separately completed profile trials; these are not controlled causal scaling measurements.")
    fig.subplots_adjust(left=.11, right=.96, bottom=.27, top=.80)
    x = np.arange(3)
    for idx, system in enumerate(SYSTEMS):
        values = [number(aggregate(data, p, system), metric)*scale for p in PROFILES]
        cis = [interval(confidence, p, system, ci_metric) for p in PROFILES]
        bounds = np.concatenate([errors(ci, scale) for ci in cis], axis=1)
        ax.errorbar(x, values, yerr=bounds, label=LABELS[idx], color=COLORS[idx], marker=MARKERS[idx],
                    markerfacecolor="#ffffff" if system == "DERYA_COLD" else COLORS[idx],
                    markersize=11 if system == "DERYA_COLD" else 7, capsize=4,
                    linestyle="--" if system == "DERYA_COLD" else "-", linewidth=1.5)
    ax.set_xticks(x, PROFILE_LABELS)
    ax.set_xlim(-.15, 2.15)
    ax.set_xlabel("Retrievable records")
    ax.set_ylabel(ylabel)
    ax.grid(axis="y", color="#e0e4e2", linewidth=.7)
    if log:
        require(all(number(aggregate(data, p, s), metric) > 0 for p in PROFILES for s in SYSTEMS), "Log metric must be positive")
        ax.set_yscale("log")
    else:
        ax.set_ylim(0, 100)
        ax.yaxis.set_major_formatter(PercentFormatter(100))
    ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(.5, -.15), fontsize=11)
    if log:
        ci = interval(confidence, "graph-large", "DERYA_HOT", "evidence_bandwidth_ratio", comparison="STRONG_HYBRID_RAG")
        note = (f"250K Derya Hot / Strong Hybrid: {number(ci,'estimate'):.3f}x; paired 95% CI "
                f"{number(ci,'ci_low'):.3f}x to {number(ci,'ci_high'):.3f}x.\n"
                "Ratio of summed correct gold evidence to summed retrieval/hydration time; not wall-clock concurrent throughput.")
    else:
        note = "Whiskers: 95% case-cluster intervals. Cold and Hot may overlap.\n10K/50K: completed retained profiles; 250K: entire new profile rerun. No interrupted 250K passes are included."
    finish(fig, output, note)


def query_types(data, confidence):
    fig, (ax, delta_ax) = figure("Evidence recall by query type at 250K", "Derya Hot and Strong Hybrid RAG; paired differences retain all ten repetitions within each case.", panels=2)
    fig.subplots_adjust(left=.20, right=.94, bottom=.20, top=.82, wspace=.45)
    labels = []
    for idx, query in enumerate(QUERIES):
        for system, shift, color, marker in (("STRONG_HYBRID_RAG", .13, COLORS[2], "s"), ("DERYA_HOT", -.13, COLORS[4], "o")):
            row = select(data, profile="graph-large", system=system, query_type=query)
            ci = interval(confidence, "graph-large", system, "evidence_recall_at_20", query_type=query)
            ax.errorbar(number(row, "evidence_recall_at_20")*100, idx+shift, xerr=errors(ci,100), fmt=marker, color=color, markersize=7, capsize=3)
        labels.append(f"{row['query_type_label']} (n={int(number(row,'case_count'))})")
        paired = interval(confidence, "graph-large", "DERYA_HOT", "evidence_recall_at_20_difference", query_type=query, comparison="STRONG_HYBRID_RAG")
        value = number(paired, "estimate")*100
        delta_ax.errorbar(value, idx, xerr=errors(paired,100), fmt="o", color=COLORS[4], capsize=4)
        delta_ax.annotate(f"{value:+.2f} pp", (value,idx), xytext=(0,10), textcoords="offset points", ha="center", fontsize=10)
    ax.set_yticks(np.arange(len(QUERIES)), labels)
    delta_ax.set_yticks([])
    for axis in (ax, delta_ax):
        axis.set_ylim(len(QUERIES)-.45, -.6)
    ax.set_xlim(0, 105)
    ax.xaxis.set_major_formatter(PercentFormatter(100))
    ax.set_xlabel("Evidence Recall@20")
    delta_ax.axvline(0, color="#747c78", linewidth=1)
    delta_ax.margins(x=.30)
    delta_ax.set_xlabel("Derya Hot minus Hybrid (pp)")
    ax.plot([], [], "s", color=COLORS[2], label="Strong Hybrid RAG")
    ax.plot([], [], "o", color=COLORS[4], label="Derya Hot")
    ax.legend(frameon=False, loc="lower left", bbox_to_anchor=(0,1.01), fontsize=10)
    finish(fig, "03_query_types", "Whiskers: 95% case-cluster intervals; paired query-type intervals use the preserved extension code.\nAn interval touching or crossing zero does not establish a positive difference for that category.")


def validation(data):
    row = aggregate(data, "graph-large", "DERYA_HOT")
    stale_total = int(number(row, "strict_scenario_execution_count"))
    matching_total = int(number(row, "unrelated_scenario_execution_count"))
    require(stale_total == matching_total == 200, "Unexpected fixture counts")
    rejected = round(stale_total * number(row, "strict_stale_detection_rate"))
    accepted = matching_total - round(matching_total * number(row, "false_conflict_rate"))
    fig, (outcomes, latency) = figure("Stale-read validation fixtures at 250K", "Real validator calls on seeded, single-dependency immutable reads. No action sends were executed.", panels=2)
    for idx, (label, count, total) in enumerate((("Stale reads rejected", rejected, stale_total), ("Matching reads accepted", accepted, matching_total))):
        outcomes.barh(idx, count, height=.45, color=COLORS[4])
        outcomes.text(count, idx, f"  {count}/{total}", va="center", fontsize=13)
    outcomes.set_yticks([0,1], ["Stale reads rejected", "Matching reads accepted"])
    outcomes.set_xlim(0, 250)
    outcomes.set_ylim(1.7,-.7)
    outcomes.set_xlabel("Validation checks")
    values = [number(row, key) for key in ("validation_p50_ms", "validation_p95_ms")]
    for idx, value in enumerate(values):
        latency.barh(idx, value, height=.45, color=(COLORS[4], COLORS[2])[idx])
        latency.text(value, idx, f"  {value:.1f} ms", va="center", fontsize=12)
    latency.set_yticks([0,1], ["p50", "p95"])
    latency.set_xlim(0, max(values)*1.4)
    latency.set_ylim(1.7,-.7)
    latency.set_xlabel("Separate validator latency (ms)")
    finish(fig, "05_semantic_concurrency", "20 unique stale fixtures and 20 matching fixtures, each repeated ten times. Stale hashes are substituted before insertion.\nNo post-read state mutation, post-read unrelated-change tolerance, live action-escape rate, or multi-dependency performance is established.")


def quality(data):
    fig, axes = plt.subplots(2,2,figsize=(15,11))
    fig.suptitle("Quality tradeoffs at 250K", x=.09,y=.98,ha="left",fontsize=23,weight="medium")
    fig.subplots_adjust(left=.20,right=.95,top=.88,bottom=.22,hspace=.35,wspace=.45)
    metrics = (("mrr","Mean reciprocal rank"), ("entity_resolution_accuracy","Entity-resolution accuracy"),
               ("current_state_accuracy","Typed current-state accuracy"), ("fact_recall_at_20","Typed fact Recall@20"))
    for axis, (metric,title) in zip(axes.flat,metrics):
        values = [number(aggregate(data,"graph-large",s),metric) for s in SYSTEMS]
        axis.barh(np.arange(5),values,color=COLORS,height=.5)
        axis.set_yticks(np.arange(5),LABELS,fontsize=10)
        axis.invert_yaxis()
        axis.set_xlim(0,1.16)
        axis.set_xticks([0,.25,.5,.75,1])
        axis.set_title(title,fontsize=13,loc="left",pad=12)
        axis.set_xlabel("Score (0 to 1)",fontsize=10)
        axis.grid(axis="x",color="#e0e4e2",linewidth=.7)
        axis.set_axisbelow(True)
        for idx,value in enumerate(values):
            axis.text(value,idx,f"  {value:.3f}",va="center",fontsize=10)
    finish(fig,"06_quality_tradeoffs","Typed-state/fact zeros for retrieval-only baselines describe output capability, not absence of relevant information in retrieved prose.\nEvidence Recall@20 is not state accuracy or LLM answer accuracy. All comparators and observed quality tradeoffs remain visible.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--render", action="store_true", help="Render only after audited full-profile composition exists")
    args = parser.parse_args()
    require(args.render, "Explicit --render is required; no figures are generated by default")
    findings = json.loads((ROOT / INPUTS[2]).read_text(encoding="utf-8-sig"))
    require(findings.get("audit",{}).get("runs") == 150 and findings["audit"].get("executions") == 30000, "Incomplete audited measurement set")
    require(findings["audit"]["source"][0] == COMMIT and findings["audit"]["source"][2] is False, "Wrong or dirty measured source")
    for relative in INPUTS[:2]:
        expected = findings.get("analysisDataHashes", {}).get(relative.removeprefix("analysis/"))
        require(isinstance(expected,str) and len(expected) == 64 and digest(ROOT/relative) == expected,
                f"Figure CSV is not bound to the audited analysis: {relative}")
    data, confidence = read_csv(ROOT / INPUTS[0]), read_csv(ROOT / INPUTS[1])
    verify_point_estimates(data, confidence)
    for profile in PROFILES:
        for system in SYSTEMS:
            row = aggregate(data,profile,system)
            require(number(row,"case_count") == 200 and number(row,"execution_count") == 2000 and number(row,"measurement_pass_count") == 10, "Incomplete profile/system")
    output = ROOT / "figures"
    require(not output.exists(), "Figure output already exists; preserve it rather than overwrite")
    output.mkdir()
    setup()
    recall_latency(data,confidence)
    profiles(data,confidence,"evidence_recall_at_20","evidence_recall_at_20","Evidence recall across corpus profiles","Evidence Recall@20","02_recall_scaling",scale=100)
    query_types(data,confidence)
    profiles(data,confidence,"evidence_bandwidth_per_second","evidence_bandwidth_per_second","Gold evidence per retrieval second","Correct gold evidence / second (log scale)","04_evidence_bandwidth",log=True)
    validation(data)
    quality(data)
    manifest = {"rendererPath":"figures-source/renderer.py", "rendererSha256":digest(Path(__file__)),
                "inputHashes":{path:digest(ROOT/path) for path in INPUTS}, "visualVerificationPassed":False,
                "renderingEnvironment":{"python":sys.version.split()[0],"matplotlib":matplotlib.__version__,"numpy":np.__version__},
                "artifacts":ARTIFACTS}
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"figures":len(ARTIFACTS),"visualVerificationPassed":False}))


if __name__ == "__main__":
    main()
