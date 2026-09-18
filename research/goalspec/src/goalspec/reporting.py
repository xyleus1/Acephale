"""Reproducible benchmark tables and honest conclusions from frozen replay logs."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

from goalspec.metrics import ScoreRow, negative_log_likelihood, paired_nll, score_predictions
from goalspec.storage import file_hash, write_json

LABELS = {
    "paste": "PASTE-style local implementation",
    "oracle": "Oracle GoalSpec",
    "goalspec_initial": "GoalSpec, initial request",
    "goalspec": "GoalSpec, configured updates",
    "shuffled": "Shuffled predicted goals",
    "shuffled_initial": "Shuffled initial goals",
    "shuffled_oracle": "Shuffled oracle goals",
}


def verified_replay(directory: Path) -> tuple[dict, list[ScoreRow]]:
    run = json.loads((directory / "run.json").read_text(encoding="utf-8"))
    if run["status"] != "complete" or run["summary_hash"] != file_hash(directory / "summary.json"):
        raise ValueError("Replay is incomplete or its summary was changed")
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    expected = {"predictions.jsonl", "observations.jsonl", "initial-goals.jsonl", "gates.json", "goal-backend.json"}
    if set(summary.get("output_hashes", {})) != expected:
        raise ValueError("Replay artifact manifest is incomplete or unexpected")
    for name, digest in summary["output_hashes"].items():
        if Path(name).name != name or file_hash(directory / name) != digest:
            raise ValueError(f"Replay artifact failed integrity verification: {name}")
    with (directory / "predictions.jsonl").open(encoding="utf-8") as stream:
        rows = [ScoreRow.model_validate_json(line) for line in stream if line.strip()]
    if score_predictions(rows) != summary["metrics"]:
        raise ValueError("Published metrics differ from the recorded predictions")
    return summary, rows


def _percent(value: float | None) -> str:
    return "unmeasured" if value is None else f"{100 * value:.2f}%"


def generate_report(directory: Path, output: Path, *, plots: bool = False) -> Path:
    summary, rows = verified_replay(directory)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Report directory must be new or empty")
    output.mkdir(parents=True, exist_ok=True)
    conditions = sorted(summary["metrics"])
    comparisons = []
    tables = []
    scopes = [None, *sorted({(row.benchmark, row.domain) for row in rows})]
    for scope in scopes:
        scoped = rows if scope is None else [row for row in rows if (row.benchmark, row.domain) == scope]
        scope_label = "ALL" if scope is None else "/".join(scope)
        for condition, metrics in score_predictions(scoped).items():
            tables.append({"domain": scope_label, "condition": condition,
                           **{key: value for key, value in metrics.items() if key != "goals"}})
        for treatment in conditions:
            if treatment == "paste":
                continue
            try:
                estimate = paired_nll(scoped, treatment=treatment, seed=42)
                comparisons.append({"domain": scope_label, **estimate.model_dump(mode="json")})
            except ValueError as error:
                if "at least two template groups" not in str(error):
                    raise
                comparisons.append({"domain": scope_label, "treatment": treatment, "unavailable": str(error)})
    with (output / "benchmarks.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(tables[0]))
        writer.writeheader()
        writer.writerows(tables)
    write_json(output / "comparisons.json", comparisons)
    write_json(output / "summary.json", summary)
    overall = {row["treatment"]: row for row in comparisons if row["domain"] == "ALL"}
    lines = [
        "# GoalSpec frozen-actor replay benchmark", "",
        f"Partition: `{summary['partition']}`. Source SHA-256: `{summary['source_hash']}`.", "",
        "This is a paired next-action prediction experiment on recorded actor trajectories. "
        "PASTE denotes this repository's independent pattern-mining and symbolic-binding implementation. "
        "It is not an execution of the original PASTE paper's released system. "
        "No actor task-success or latency improvement can be attributed to an offline predictor.", "",
        f"Goal predictor: `{json.dumps(summary['goal_backend_config'], sort_keys=True)}`.", "",
        "## Overall predictions", "",
        "Tool and full tool-plus-argument accuracies below are micro averages over all recorded authoritative calls. "
        "Missing bindings count as misses. Top-3 coverage does not mean a tool call was speculatively executed.", "",
        "| Condition | Calls | Tool Top-1 | Tool Top-3 | Full match Top-1 | Full match Top-3 | Micro NLL (nats) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for condition in conditions:
        value = summary["metrics"][condition]
        lines.append(f"| {LABELS.get(condition, condition)} | {value['steps']} | {_percent(value['tool_top1'])} | {_percent(value['tool_top3'])} | {_percent(value['tool_arguments_top1'])} | {_percent(value['tool_arguments_top3'])} | {value['next_tool_nll']:.4f} |")
    lines.extend(["", "## Primary paired comparison", "",
                  "Held-out next-tool negative log likelihood is a predictive cross-entropy estimate, "
                  "not direct measurement of the unknown true conditional entropy. It includes model error. "
                  "Every condition uses the same structural context C selected without goals. "
                  "Each task averages its trials and each domain receives equal weight. "
                  "Confidence intervals resample complete task-family clusters within domains (2,000 bootstrap replicates, seed 42). "
                  "Positive improvement means lower loss than PASTE. These are exploratory, unadjusted intervals across multiple comparisons.", "",
                  "| Condition | Macro NLL | NLL improvement | Relative reduction | 95% CI for improvement |",
                  "| --- | ---: | ---: | ---: | ---: |"])
    for condition, value in overall.items():
        if "unavailable" in value:
            continue
        lines.append(f"| {LABELS.get(condition, condition)} | {value['treatment_nll']:.4f} | {value['improvement']:+.4f} | {_percent(value['relative_improvement'])} | [{value['ci_lower']:+.4f}, {value['ci_upper']:+.4f}] |")
    goals = summary["initial_goal_accuracy"]
    lines.extend(["", "## Initial goal prediction", "",
                  f"Labeled trials: {goals['labeled_trials']}/{goals['trials']}. "
                  f"Top-1: {_percent(goals['top1'])}; Top-3: {_percent(goals['top3'])}. "
                  f"Equal-domain/task Top-1: {_percent(goals['macro_domain_top1'])}; Top-3: {_percent(goals['macro_domain_top3'])}. "
                  "Unseen endpoints are scored as the explicit unknown class; automatic endpoint annotations require human review before confirmatory claims.", "",
                  "## Recorded actor outcomes", ""])
    actor = summary["base_actor"]
    lines.extend([f"{actor['tasks']} tasks, {actor['trials']} trials; "
                  f"task success {_percent(actor['task_success'])}, "
                  f"pass^1 {_percent(actor['pass_k_all_trials']['1']['value'])}, "
                  f"pass^4 {_percent(actor['pass_k_all_trials']['4']['value'])}. "
                  f"Authoritative calls per successful trial: {actor['authoritative_calls_per_successful_trial']}. "
                  f"Retained infrastructure errors: {actor['retained_error_trials']}; "
                  f"incomplete trials: {actor['retained_incomplete_trials']}. "
                  "These frozen actor outcomes are shared by every prediction condition. "
                  "pass^k is all-k-trials success, not best-of-k pass@k.", "",
                  "## Conclusion", ""])
    inferred = overall.get("goalspec_initial", {})
    oracle = overall.get("oracle", {})
    if inferred.get("ci_lower", -1) > 0:
        lines.append(f"Initial goal conditioning lowers paired held-out next-tool NLL by {_percent(inferred['relative_improvement'])} relative to the local PASTE-style predictor. "
                     "This supports a prediction-quality improvement for this cohort and configuration. "
                     "It does not establish superiority to the original PASTE system or a systems speedup.")
    else:
        lines.append("This run does not establish that inferred initial goals outperform the local PASTE-style predictor on the primary paired NLL metric. "
                     "A favorable secondary accuracy or oracle result does not override that conclusion.")
    if oracle.get("ci_lower", -1) > 0:
        lines.append(f"Oracle endpoint conditioning reduces paired NLL by {_percent(oracle['relative_improvement'])}. "
                     "This is evidence that endpoint information can help this predictor, conditional on annotation and catalog validity.")
    else:
        lines.append("The oracle comparison does not establish a reliable held-out NLL reduction. "
                     "The central endpoint-conditioning hypothesis remains unconfirmed for this implementation and cohort.")
    lines.extend([f"Scientific gate: `{summary['gate_status']}`; scheduler allowed: `{summary['scheduler_allowed']}`.", "",
                  "Executed speculation hit rate, useful/wasted execution ratio, treatment tool-call count, "
                  "treatment pass rates, and end-to-end latency reduction including p95/p99 are unmeasured. "
                  "Salesforce Memory, PlanBench-XL, ToolSandbox, BFCL V4 and GTA-2 comparisons require their actual corresponding experiments; "
                  "this report does not substitute trace-retrieval heuristics for published baselines.", "",
                  "Per-domain metrics are in `benchmarks.csv`; complete paired intervals are in `comparisons.json`. "
                  "See the run's source-release and annotation audits for version and catalog reconstruction limitations."])
    (output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if plots:
        _plot(directory, output, rows)
    write_json(output / "manifest.json", {"input_summary_sha256": file_hash(directory / "summary.json"),
                                          "files": {path.name: file_hash(path) for path in sorted(output.iterdir()) if path.is_file()}})
    return output / "report.md"


def _plot(directory: Path, output: Path, rows: list[ScoreRow]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    depths = {}
    with (directory / "observations.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            item = json.loads(line)
            depths[(item["trajectory_id"], item["turn"])] = item["depth"]
    groups = defaultdict(list)
    for row in rows:
        if row.condition in {"paste", "oracle", "goalspec_initial"}:
            depth_bin = min(depths[row.step_key] // 5 * 5, 30)
            groups[(row.condition, depth_bin)].append(negative_log_likelihood(row))
    figure, axes = plt.subplots(figsize=(8, 4.5), layout="constrained")
    for condition in ("paste", "goalspec_initial", "oracle"):
        bins = sorted(depth for arm, depth in groups if arm == condition)
        axes.plot(bins, [np.mean(groups[(condition, depth)]) for depth in bins], marker="o", label=LABELS[condition])
    axes.set(xlabel="Decision depth (bins of 5; 30 includes all later steps)", ylabel="Mean next-tool NLL (nats)", title="Exploratory depth profile, micro averages")
    axes.legend(fontsize="small")
    axes.grid(alpha=0.2)
    figure.savefig(output / "depth-profile.svg")
    figure.savefig(output / "depth-profile.png", dpi=180)
    plt.close(figure)
