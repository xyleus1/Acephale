"""Audit frozen CLI classifier captures without loading an entire trajectory corpus.

Example: python scripts/classifier_usage.py --cohort runs/public-pilot-20260911
    --bundle runs/public-pilot-20260911/artifacts-v2
    --output reports/2026-09-11-public-replay
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from goalspec.cli_classifier import parse_generation
from goalspec.goal_backends import _digest
from goalspec.goals import UNKNOWN_GOAL, GoalCatalog, canonical_goal
from goalspec.models import public_model_input
from goalspec.replay import initial_prefix
from goalspec.schemas import Trajectory
from goalspec.storage import content_hash, file_hash


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def percentile(values: list[float], quantile: float) -> float:
    """Linear interpolation, equivalent to NumPy's default percentile method."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def audit_capture(directory: Path, catalog: GoalCatalog, manifest: dict, split: dict) -> dict:
    capture_path = directory / "capture.json"
    backend_path = directory / "backend.json"
    capture, backend = read_json(capture_path), read_json(backend_path)
    require(capture["status"] == "complete", f"Incomplete capture: {directory}")
    require(capture["backend"] == "codex_cli", "Unexpected capture backend")
    require(capture["input_policy"] == "public_initial_context_only", "Unexpected classifier input policy")
    require(capture["batch_size"] == 1, "Request latency requires one request per batch")
    require(backend["backend"] == "cached_llm" and backend["update_policy"] == "initial", "Backend policy mismatch")
    require(Path(backend["cached_predictions"]).resolve() == capture_path.resolve(), "Backend points to a different capture")
    require(backend["cache_sha256"] == file_hash(capture_path), "Backend cache SHA-256 mismatch")
    require(backend["model"] == capture["model"], "Backend model mismatch")
    require(backend["calibration_temperature"] == capture["calibration_temperature"], "Backend calibration mismatch")
    require(capture["catalog_sha256"] == _digest(catalog.model_dump(mode="json")), "Catalog SHA-256 mismatch")
    require(capture["training_manifest_sha256"] == content_hash(manifest), "Training manifest SHA-256 mismatch")
    require(capture["split_sha256"] == content_hash(split), "Split SHA-256 mismatch")
    scoped_goals = defaultdict(set)
    for example in catalog.examples:
        scoped_goals[(example.benchmark, example.domain)].add(example.goal_id)
    predictions = {}
    for row in capture["predictions"]:
        key = (row["benchmark"], row["domain"], row["input_sha256"])
        require(key not in predictions, "Duplicate captured prediction")
        predictions[key] = row["probabilities"]
    require(bool(predictions), "Empty capture")
    batches = capture["batches"]
    require(sorted(row["id"] for row in batches) == list(range(len(batches))), "Missing or duplicate capture batches")
    verified_inputs = set()
    for batch in batches:
        require(batch["inputs"] == 1, "Batch contains multiple classifier requests")
        require(math.isfinite(batch["elapsed_seconds"]) and batch["elapsed_seconds"] >= 0, "Invalid request elapsed time")
        scope = tuple(batch["scope"])
        directory_batch = directory / f"batch-{batch['id']:04d}"
        prompt_path, events_path = directory_batch / "prompt.txt", directory_batch / "events.jsonl"
        require(file_hash(prompt_path) == batch["prompt_sha256"], "Prompt SHA-256 mismatch")
        require(file_hash(events_path) == batch["events_sha256"], "Events SHA-256 mismatch")
        prompt = json.loads(prompt_path.read_text(encoding="utf-8").split("\n", 1)[1])
        require(len(prompt["requests"]) == 1, "Prompt request count mismatch")
        request = prompt["requests"][0]
        public = {**prompt["public_contexts"][request["context_id"]], "observations": request["observations"]}
        require(_digest(public) == request["input_id"], "Prompt context SHA-256 mismatch")
        key = (*scope, request["input_id"])
        require(key not in verified_inputs and key in predictions, "Prompt prediction membership mismatch")
        verified_inputs.add(key)
        expected_goals = {goal.goal_id: goal.model_dump(mode="json") for goal in catalog.signatures if goal.goal_id in scoped_goals[scope]}
        require({goal["goal_id"]: goal for goal in prompt["goals"]} == expected_goals, "Prompt training goals mismatch")
        parsed, usage = parse_generation(events_path.read_text(encoding="utf-8"), {key[2]}, scoped_goals[scope] | {UNKNOWN_GOAL})
        require(parsed[key[2]] == predictions[key], "Captured prediction differs from native output")
        require(usage == batch["usage"], "Captured usage differs from native completion event")
        require(all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in usage.values()), "Invalid native token usage")
    require(verified_inputs == set(predictions), "Captured predictions lack verified request events")
    return {"capture": capture, "predictions": predictions, "provenance": {
        "capture_path": str(capture_path), "capture_sha256": file_hash(capture_path),
        "backend_path": str(backend_path), "backend_sha256": file_hash(backend_path),
        "model": capture["model"], "reasoning_effort": capture["reasoning_effort"],
        "cli_version": capture["cli_version"], "workers": capture["workers"],
        "catalog_sha256": capture["catalog_sha256"], "split_sha256": capture["split_sha256"],
        "training_manifest_sha256": capture["training_manifest_sha256"],
        "source_sha256": manifest["source_hash"], "all_request_artifact_hashes_verified": True,
    }}


def stream_coverage(corpus: Path, split: dict, captures: dict, catalog: GoalCatalog) -> dict:
    """Keep only small counters/IDs; never retain trajectories or their events."""
    scoped_goals = defaultdict(set)
    for example in catalog.examples:
        scoped_goals[(example.benchmark, example.domain)].add(example.goal_id)
    groups = defaultdict(lambda: {"source_trials": 0, "task_ids": set(), "family_ids": set(), "contexts": set(), "requests": set(), "labeled_trials": 0, "unseen_goal_trials": 0, "goal_top1_hits": 0, "goal_top3_hits": 0, "seen_goal_top1_hits": 0, "seen_goal_top3_hits": 0, "unknown_goal_top1_hits": 0})
    seen_ids = set()
    observed = defaultdict(set)
    with corpus.open(encoding="utf-8") as stream:
        for line in stream:
            data = json.loads(line)
            identity = data["trajectory_id"]
            require(identity not in seen_ids and identity in split["assignments"], "Duplicate or unexpected corpus trajectory")
            seen_ids.add(identity)
            partition = split["assignments"][identity]
            if partition not in captures:
                continue
            trajectory = Trajectory.model_validate(data)
            scope = (trajectory.benchmark, trajectory.domain)
            public = public_model_input(initial_prefix(trajectory))
            key = (*scope, _digest(public))
            predictions = captures[partition]["predictions"]
            require(key in predictions, "A held-out source context lacks a prediction")
            observed[partition].add(key)
            goal = canonical_goal(trajectory)
            expected = None if goal is None else goal.goal_id if goal.goal_id in scoped_goals[scope] else UNKNOWN_GOAL
            ranked = sorted(predictions[key], key=lambda candidate: (-predictions[key][candidate], candidate))
            for domain in (trajectory.domain, "ALL"):
                row = groups[(partition, domain)]
                row["source_trials"] += 1
                row["task_ids"].add((*scope, trajectory.task_id))
                row["family_ids"].add((*scope, trajectory.group_id))
                row["contexts"].add(key)
                row["requests"].add((*scope, _digest(public["observations"])))
                if expected is not None:
                    row["labeled_trials"] += 1
                    row["unseen_goal_trials"] += expected == UNKNOWN_GOAL
                    row["goal_top1_hits"] += expected in ranked[:1]
                    row["goal_top3_hits"] += expected in ranked[:3]
                    if expected == UNKNOWN_GOAL:
                        row["unknown_goal_top1_hits"] += expected in ranked[:1]
                    else:
                        row["seen_goal_top1_hits"] += expected in ranked[:1]
                        row["seen_goal_top3_hits"] += expected in ranked[:3]
    require(seen_ids == set(split["assignments"]), "Corpus does not contain every split trajectory")
    for partition, audit in captures.items():
        require(observed[partition] == set(audit["predictions"]), "Classifier cache does not exactly cover the selected source contexts")
    return groups


def create_report(cohort: Path, bundle: Path, partitions: list[str]) -> dict:
    split = read_json(cohort / "split.json")
    manifest = read_json(bundle / "manifest.json")
    source = read_json(cohort / "public-cohort-manifest.json")
    corpus_path = cohort / "prediction-corpus.jsonl"
    require(file_hash(corpus_path) == source["prediction_corpus_sha256"], "Prediction corpus file SHA-256 mismatch")
    require(file_hash(cohort / "split.json") == source["split_sha256"], "Cohort split file SHA-256 mismatch")
    require(manifest["corpus_hash"] == split["corpus_hash"], "Training/corpus identity mismatch")
    require(manifest["split_hash"] == content_hash(split), "Training/split identity mismatch")
    require(file_hash(bundle / "goals.json") == manifest["artifact_hashes"]["goals.json"], "Training goal artifact SHA-256 mismatch")
    catalog = GoalCatalog.model_validate_json((bundle / "goals.json").read_text(encoding="utf-8"))
    captures = {partition: audit_capture(cohort / f"classifier-{partition}", catalog, manifest, split) for partition in partitions}
    for partition, audit in captures.items():
        require(audit["capture"]["partition"] == partition, "Capture partition mismatch")
    counts = stream_coverage(corpus_path, split, captures, catalog)
    rows = []
    for (partition, domain), coverage in sorted(counts.items()):
        batches = [batch for batch in captures[partition]["capture"]["batches"] if domain == "ALL" or batch["scope"][1] == domain]
        elapsed = [batch["elapsed_seconds"] for batch in batches]
        usage = Counter()
        for batch in batches:
            usage.update(batch["usage"])
        labeled = coverage["labeled_trials"]
        unseen = coverage["unseen_goal_trials"]
        seen = labeled - unseen
        rows.append({
            "partition": partition, "domain": domain, "model": captures[partition]["capture"]["model"],
            "source_trial_requests": coverage["source_trials"], "source_tasks": len(coverage["task_ids"]),
            "source_families": len(coverage["family_ids"]), "unique_observation_queries": len(coverage["requests"]),
            "unique_public_contexts": len(coverage["contexts"]), "classifier_requests": len(batches),
            "request_wall_mean_seconds": statistics.mean(elapsed), "request_wall_p95_seconds": percentile(elapsed, 0.95),
            "request_wall_p99_seconds": percentile(elapsed, 0.99), "request_wall_sum_seconds": sum(elapsed),
            **dict(usage), "labeled_trials": labeled, "unseen_goal_trials": coverage["unseen_goal_trials"],
            "initial_goal_top1_hits": coverage["goal_top1_hits"], "initial_goal_top3_hits": coverage["goal_top3_hits"],
            "initial_goal_top1_accuracy": coverage["goal_top1_hits"] / labeled if labeled else None,
            "initial_goal_top3_accuracy": coverage["goal_top3_hits"] / labeled if labeled else None,
            "seen_goal_trials": seen, "seen_goal_top1_hits": coverage["seen_goal_top1_hits"],
            "seen_goal_top3_hits": coverage["seen_goal_top3_hits"],
            "seen_goal_top1_accuracy": coverage["seen_goal_top1_hits"] / seen if seen else None,
            "seen_goal_top3_accuracy": coverage["seen_goal_top3_hits"] / seen if seen else None,
            "unknown_goal_top1_hits": coverage["unknown_goal_top1_hits"],
            "unknown_goal_top1_recall": coverage["unknown_goal_top1_hits"] / unseen if unseen else None,
        })
    return {
        "schema_version": 1, "status": "verified", "measurements": rows,
        "method": {
            "request_wall": "One isolated Codex CLI subprocess per unique public initial context; includes subprocess, provider, and inference time. Four concurrent workers. Sum of request times is not elapsed cohort wall time.",
            "quantiles": "Linear interpolation at (n-1)*q over request wall durations; no resampling or confidence interval.",
            "tokens": "Native turn.completed token counters summed without repricing. Cached input and reasoning output counters are reported separately; do not add them to input/output totals as extra tokens.",
            "reuse": "Repeated source trials with identical domain, policy, tool catalog, and public observations share one prediction. Token counts cover unique captured requests, not an uncached live deployment.",
            "goal_scoring": "Trial-weighted initial-context Top-1/Top-3 against unreviewed semantic proxy annotations; unseen labeled endpoints map to __unknown__; absent annotations excluded from accuracy denominator only. Ties broken by goal ID.",
            "not_measured": "Agent end-to-end latency, net latency reduction, speculative tool execution, live task-success effects, API cost, and concurrent cohort elapsed time.",
        },
        "provenance": {
            "prediction_corpus_sha256": source["prediction_corpus_sha256"],
            "cohort_manifest_sha256": file_hash(cohort / "public-cohort-manifest.json"),
            "captures": {partition: audit["provenance"] for partition, audit in captures.items()},
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--partition", action="append", choices=("development", "test"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paths = [args.output / f"classifier-usage.{extension}" for extension in ("json", "csv")]
    require(not any(path.exists() for path in paths), "Refusing to overwrite a classifier usage report")
    report = create_report(args.cohort, args.bundle, args.partition or ["development", "test"])
    args.output.mkdir(parents=True, exist_ok=True)
    paths[0].write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    with paths[1].open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(report["measurements"][0]))
        writer.writeheader()
        writer.writerows(report["measurements"])
    print(json.dumps({"status": "verified", "reports": [str(path) for path in paths], "partitions": [row for row in report["measurements"] if row["domain"] == "ALL"]}, indent=2))


if __name__ == "__main__":
    main()
