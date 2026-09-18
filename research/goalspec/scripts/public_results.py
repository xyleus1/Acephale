"""Publish auditable public replay aggregates without making performance claims.

uv run python scripts/public_results.py --cohort runs/public-pilot-20260911 \
    --run lexical-development=runs/lexical-development \
    --output reports/2026-09-11-public-replay

Every supplied run must be complete and match the frozen prediction cohort.
Missing measurements remain blank in CSV and 'not measured' in Markdown.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from goalspec.annotations import AnnotationReport
from goalspec.metrics import ScoreRow, score_predictions, summarize_trials
from goalspec.reporting import verified_replay
from goalspec.schemas import Outcome, TraceProvenance, Trajectory
from goalspec.splits import SplitManifest
from goalspec.storage import file_hash, write_json


@dataclass(frozen=True, slots=True)
class ActorEventCount:
    kind: str = "tool_request"


@dataclass(frozen=True, slots=True)
class ActorAggregateInput:
    """Only the fields consumed by summarize_trials; never a replay trajectory."""

    trajectory_id: str
    benchmark: str
    domain: str
    task_id: str
    group_id: str
    trial: int
    events: tuple[ActorEventCount, ...]
    outcome: Outcome
    provenance: TraceProvenance
    total_elapsed_ms: float | None


def compact_actor_inputs(path: Path) -> dict[str, list[ActorAggregateInput]]:
    by_domain = defaultdict(list)
    seen = set()
    counted_request = ActorEventCount()
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            trajectory = Trajectory.model_validate_json(line)
            if trajectory.trajectory_id in seen or trajectory.provenance is None:
                raise ValueError("Duplicate or unprovenanced public actor trial")
            seen.add(trajectory.trajectory_id)
            calls = sum(event.kind == "tool_request" for event in trajectory.events)
            by_domain[trajectory.domain].append(ActorAggregateInput(
                trajectory_id=trajectory.trajectory_id, benchmark=trajectory.benchmark,
                domain=trajectory.domain, task_id=trajectory.task_id,
                group_id=trajectory.group_id, trial=trajectory.trial,
                events=(counted_request,) * calls, outcome=trajectory.outcome,
                provenance=trajectory.provenance, total_elapsed_ms=trajectory.total_elapsed_ms,
            ))
    return by_domain


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("x", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def fmt(value: float | None, *, percent: bool = False) -> str:
    if value is None:
        return "not measured"
    return f"{100 * value:.2f}%" if percent else f"{value:.4f}"


def table(headers: list[str], rows: list[list[str]]) -> str:
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *("| " + " | ".join(row) + " |" for row in rows),
    ])


def publish(cohort: Path, runs: list[tuple[str, Path]], output: Path) -> None:
    if output.exists():
        raise ValueError("Choose a new report directory; previous reports are immutable")
    manifest = read_json(cohort / "public-cohort-manifest.json")
    split = SplitManifest.model_validate_json((cohort / "split.json").read_text(encoding="utf-8"))
    for name, key in (("corpus.jsonl", "corpus_sha256"),
                      ("prediction-corpus.jsonl", "prediction_corpus_sha256"),
                      ("split.json", "split_sha256")):
        if file_hash(cohort / name) != manifest[key]:
            raise ValueError(f"Frozen cohort artifact changed: {name}")
    full = compact_actor_inputs(cohort / "corpus.jsonl")
    actor_rows, annotations, partitions, source_provenance = [], [], [], []
    for domain, traces in sorted(full.items()):
        native = summarize_trials(traces)
        domain_submission = read_json(cohort / "sources" / f"{domain}-submission.json")
        declared_pass1 = (domain_submission.get("results", {}).get(domain) or {}).get("pass_1")
        actor_rows.append({
            "domain": domain, "actor_model": traces[0].provenance.actor_model,
            "tasks": native["tasks"], "trials": native["trials"],
            "successful_trials": native["successful_trials"],
            "full_cohort_task_success": native["task_success"],
            "pass1_all_declared_trials": native["pass_k_all_trials"]["1"]["value"],
            "pass2_all_declared_trials": native["pass_k_all_trials"]["2"]["value"],
            "pass4_all_declared_trials": native["pass_k_all_trials"]["4"]["value"],
            "native_excluded_infrastructure_trials": native["native_exclusion_view"][
                "retained_in_full_cohort_but_excluded_by_native_scorer"],
            "native_available_trial_success": native["native_exclusion_view"]["task_success"],
            "native_available_task_equal_pass1": native["native_exclusion_view"][
                "pass_k_all_trials"]["1"]["value"],
            "published_submission_pass1_percent": declared_pass1,
            "authoritative_tool_calls": native["authoritative_calls"],
            "calls_per_successful_trial": native["authoritative_calls_per_successful_trial"],
            "historical_reported_latency_mean_ms": native["latency"]["mean"],
            "historical_reported_latency_p95_ms": native["latency"]["p95"],
            "historical_reported_latency_p99_ms": native["latency"]["p99"],
            "historical_latency_trials": native["latency"]["measured_trials"],
            "measured_goal_conditioned_latency_change": None,
            "measurement_type": "published_actor_outcomes_unmodified_by_replay",
        })
        audit = AnnotationReport.model_validate_json((cohort / "sources" / (
            f"{domain}-endpoint-audit.json")).read_text(encoding="utf-8"))
        labels_path = cohort / "sources" / f"{domain}-endpoint-labels.json"
        if file_hash(labels_path) != traces[0].provenance.endpoint_labels_hash:
            raise ValueError(f"Endpoint labels changed after corpus capture: {domain}")
        catalog_path = cohort / "sources" / f"{domain}-catalog.json"
        source_audit = read_json(cohort / "sources" / f"{domain}-source-audit.json")
        if file_hash(catalog_path) != source_audit["catalog_sha256"]:
            raise ValueError(f"Catalog changed after corpus capture: {domain}")
        catalog = read_json(catalog_path)
        source_provenance.append({
            "domain": domain, "source_audit": source_audit,
            "endpoint_labels_sha256": file_hash(labels_path),
            "endpoint_audit_sha256": file_hash(cohort / "sources" / f"{domain}-endpoint-audit.json"),
            "catalog_sha256": file_hash(catalog_path),
            "catalog_source_revision": catalog["source_revision"],
            "catalog_source_hashes": catalog["source_hashes"],
        })
        annotations.append({"domain": domain, "tasks": len(audit.tasks),
                            "labeled_tasks": sum(row.goal is not None for row in audit.tasks),
                            "families": len({row.group_id for row in audit.tasks}),
                            "annotation_status": audit.annotation_status})
        for partition in ("train", "development", "test"):
            selected = [trace for trace in traces if split.assignments.get(trace.trajectory_id) == partition]
            partitions.append({"domain": domain, "partition": partition,
                               "trials": len(selected), "tasks": len({t.task_id for t in selected}),
                               "families": len({t.group_id for t in selected}),
                               "labeled_trials": sum(t.outcome.goal is not None for t in selected)})
    del full
    metric_rows, paired_rows, initial_rows, provenance = [], [], [], []
    for label, run_dir in runs:
        run = read_json(run_dir / "run.json")
        summary_path = run_dir / "summary.json"
        if run["corpus_hash"] != split.corpus_hash:
            raise ValueError(f"Replay run differs from the frozen prediction cohort: {label}")
        summary, verified_rows = verified_replay(run_dir)
        partition = summary["partition"]
        if partition not in ("development", "test"):
            raise ValueError("Publish development and held-out test results separately")
        backend = summary.get("goal_backend_config", run.get("goal_config", {}))
        provenance.append({"label": label, "partition": partition, "run_path": str(run_dir),
                           "summary_sha256": file_hash(summary_path),
                           "source_hash": summary.get("source_hash"),
                           "training_manifest_hash": summary.get("training_manifest_hash"),
                           "goal_backend_config": backend,
                           "gate_status": summary["gate_status"],
                           "scheduler_allowed": summary["scheduler_allowed"]})
        domain_rows: dict[str, list[ScoreRow]] = defaultdict(list)
        for row in verified_rows:
            domain_rows[row.domain].append(row)
        metrics_by_domain = {"all_prediction_domains_micro": summary["metrics"]}
        metrics_by_domain.update({domain: score_predictions(rows) for domain, rows in domain_rows.items()})
        for domain, metrics in metrics_by_domain.items():
            for condition, values in metrics.items():
                metric_rows.append({
                    "run": label, "partition": partition, "domain": domain,
                    "condition": condition, "prediction_steps": values["prediction_steps"],
                    **{key: values.get(key) for key in (
                        "next_tool_nll", "tool_top1", "tool_top3", "tool_arguments_top1",
                        "tool_arguments_top3", "argument_binding_coverage")},
                    "goal_top1": values["goals"].get("top1"),
                    "goal_top3": values["goals"].get("top3"),
                    "measured_executed_speculation_hit_rate": None,
                    "measured_latency_reduction": None, "measured_task_success_change": None,
                    "measurement_type": "fixed_actor_prediction_replay",
                })
        initial_rows.append({"run": label, "partition": partition,
                             **summary.get("initial_goal_accuracy", {})})
        for comparison, estimate in summary.get("paired_comparisons", {}).items():
            row = {"run": label, "partition": partition, "comparison": comparison,
                   "status": estimate["status"]}
            row.update(estimate.get("next_tool_nll", {}))
            row["reason"] = estimate.get("reason")
            paired_rows.append(row)
        del domain_rows, verified_rows
    output.mkdir(parents=True)
    write_csv(output / "actor-outcomes.csv", actor_rows)
    write_csv(output / "annotations.csv", annotations)
    write_csv(output / "partitions.csv", partitions)
    write_csv(output / "prediction-metrics.csv", metric_rows)
    write_csv(output / "paired-comparisons.csv", paired_rows)
    write_csv(output / "initial-goal-accuracy.csv", initial_rows)
    write_json(output / "provenance.json", {
        "cohort_manifest_sha256": file_hash(cohort / "public-cohort-manifest.json"),
        "cohort": manifest, "runs": provenance, "source_artifacts": source_provenance,
        "reported_metrics_are_not_live_scheduler_measurements": True,
    })
    text = ["# GoalSpec public trajectory replay benchmarks", "",
            "These are paired predictions on published real actor trajectories. "
            "Tool schemas were reconstructed from the pinned public benchmark. "
            "Endpoint labels are automatic semantic proxies requiring review. "
            "This study does not measure executed speculation or changes in actor decisions.", "",
            "## Frozen corpus", "",
            f"The descriptive corpus contains {manifest['trajectories']} trials across four domains. "
            f"Prediction uses {manifest['prediction_trajectories']} trials across three domains. "
            "Telecom has three independent request families, below the existing five-family "
            "split requirement, and was excluded from prediction before fitting or examining metrics.", "",
            table(["Domain", "Tasks", "Trials", "Labeled tasks", "Families"], [[
                row["domain"], str(row["tasks"]), str(next(a["trials"] for a in actor_rows if a["domain"] == row["domain"])),
                str(row["labeled_tasks"]), str(row["families"])] for row in annotations]), "",
            "## Published actor outcomes", "",
            "These outcomes are fixed inputs shared by every replay condition. All declared trials "
            "remain in this table; unresolved infrastructure failures count as unsuccessful. "
            "Native available-trial statistics are separately exported in actor-outcomes.csv.", "",
            table(["Domain", "Pass1", "Pass2", "Pass4", "Tool calls", "Infrastructure errors"], [[
                r["domain"], fmt(r["pass1_all_declared_trials"], percent=True),
                fmt(r["pass2_all_declared_trials"], percent=True),
                fmt(r["pass4_all_declared_trials"], percent=True),
                str(r["authoritative_tool_calls"]), str(r["native_excluded_infrastructure_trials"])] for r in actor_rows]), "",
            "## Prediction comparisons", "",
            "Top-k full matches are exact tool-and-argument candidate matches, not executed "
            "speculation hit rates. NLL is held-out log loss in nats; lower is better. "
            "Aggregate accuracy is micro-averaged over steps. Paired NLL comparisons below "
            "weight domains equally, then tasks, trials and steps.", ""]
    discrepancies = [r for r in actor_rows if r["published_submission_pass1_percent"] is not None
                     and r["native_available_task_equal_pass1"] is not None
                     and abs(r["published_submission_pass1_percent"] -
                             100 * r["native_available_task_equal_pass1"]) > 0.01]
    if discrepancies:
        paragraph = " ".join(
            f"For {r['domain']}, native available-task Pass1 computed from the downloaded "
            f"trace rewards is {fmt(r['native_available_task_equal_pass1'], percent=True)}, "
            f"while the published submission metadata reports {r['published_submission_pass1_percent']:.2f}%. "
            "These aggregates have not been reconciled. The report uses the trace rewards."
            for r in discrepancies
        )
        marker = text.index("## Prediction comparisons")
        text[marker:marker] = [paragraph, ""]
    if not runs:
        text.extend(["No prediction replay runs were supplied to this report.", ""])
    for label, _ in runs:
        selected = [r for r in metric_rows if r["run"] == label and r["domain"] == "all_prediction_domains_micro"]
        text.extend([f"### {label}", "", table(
            ["Condition", "Micro NLL", "Tool Top1", "Tool Top3", "Full Top1", "Full Top3"],
            [[r["condition"], fmt(r["next_tool_nll"]), fmt(r["tool_top1"], percent=True),
              fmt(r["tool_top3"], percent=True), fmt(r["tool_arguments_top1"], percent=True),
              fmt(r["tool_arguments_top3"], percent=True)] for r in selected]), ""])
        selected_pairs = [r for r in paired_rows if r["run"] == label and r["status"] == "estimated"]
        text.extend([table(["Paired comparison", "NLL improvement", "Relative improvement", "95% interval"], [[
            r["comparison"], fmt(r["improvement"]), fmt(r.get("relative_improvement"), percent=True),
            f"[{fmt(r['ci_lower'])}, {fmt(r['ci_upper'])}]" ] for r in selected_pairs]), ""])
    text.extend(["## Measured and unmeasured", "", table(["Quantity", "Evidence"], [
        ["Goal classification and future-tool accuracy", "Measured in supplied frozen replay runs" if runs else "Not measured yet"],
        ["Actor task success and call counts", "Historical published actor outcomes; unchanged by replay"],
        ["End-to-end scheduler latency reduction", "Not measured"],
        ["Useful/wasted executed speculation", "Not measured"],
        ["Live goal-guided task-success change", "Not measured"],
        ["Comparison with the original full PASTE system", "Not established; local predictor reproduction only"],
        ["SOTA across primary/secondary benchmark suites", "Not established"],
    ]), "", "All source hashes, recorded revisions, catalog hashes, endpoint audits and run configurations "
        "are linked in provenance.json. Per-domain prediction metrics, initial-request goal accuracy, "
        "partition counts and paired estimates are also exported as CSV. Positive log-loss reduction "
        "supports improved prediction under these experimental assumptions; it does not establish "
        "causal entropy reduction or a production speedup.", ""])
    (output / "BENCHMARKS.md").write_text("\n".join(text), encoding="utf-8")
    print(json.dumps({"output": str(output), "runs": len(runs), "actor_domains": len(actor_rows)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", required=True, type=Path)
    parser.add_argument("--run", action="append", default=[], help="LABEL=completed-run-directory")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    parsed_runs = []
    for value in args.run:
        label, separator, path = value.partition("=")
        if not separator or not label or not path:
            parser.error("--run must use LABEL=directory")
        parsed_runs.append((label, Path(path)))
    if len({label for label, _ in parsed_runs}) != len(parsed_runs):
        parser.error("Run labels must be unique")
    publish(args.cohort, parsed_runs, args.output)
