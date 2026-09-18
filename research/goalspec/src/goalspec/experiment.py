"""Train-only artifacts and fully paired, frozen-actor pilot experiments."""

from __future__ import annotations

import random
import time
from collections import defaultdict
from pathlib import Path
from typing import Literal

from goalspec.gates import GateEvidence, evaluate_gates, goal_scope_key, validate_task_endpoints
from goalspec.goal_backends import BackendConfig, GoalBackend
from goalspec.goals import UNKNOWN_GOAL, GoalCatalog, canonical_goal, fit_goals
from goalspec.metrics import ScoreRow, paired_nll, score_predictions, summarize_trials
from goalspec.patterns import PatternPool, fit_patterns
from goalspec.replay import decision_points, initial_prefix
from goalspec.schemas import GoalPosterior, Record, Trajectory
from goalspec.splits import Partition, SplitManifest, corpus_digest
from goalspec.storage import append_jsonl, content_hash, file_hash, source_hash, write_json


class TrainingManifest(Record):
    schema_version: Literal[1] = 1
    corpus_hash: str
    split_hash: str
    source_hash: str
    training_trajectory_ids: tuple[str, ...]
    artifact_hashes: dict[str, str]
    max_context: int
    min_support: int
    goal_model: str
    phase: Literal["pre_scheduler_pilot"] = "pre_scheduler_pilot"


def fit(corpus: list[Trajectory], split: SplitManifest, output: Path, *,
        max_context: int = 3, min_support: int = 2) -> TrainingManifest:
    validate_task_endpoints(corpus)
    train = split.select(corpus, "train")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Training output must be new or empty; frozen artifacts are never overwritten")
    for trajectory in train:
        list(decision_points(trajectory))
    catalog = fit_goals(train)
    if not catalog.signatures:
        raise ValueError("No successful training endpoints available; provide offline endpoint labels")
    pool = fit_patterns(train, max_context=max_context, min_support=min_support)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "goals.json", catalog)
    write_json(output / "patterns.json", pool)
    manifest = TrainingManifest(
        corpus_hash=corpus_digest(corpus), split_hash=content_hash(split),
        source_hash=source_hash(Path(__file__).parent),
        training_trajectory_ids=tuple(sorted(t.trajectory_id for t in train)),
        artifact_hashes={name: file_hash(output / name) for name in ("goals.json", "patterns.json")},
        max_context=max_context, min_support=min_support, goal_model=catalog.model_id,
    )
    write_json(output / "manifest.json", manifest)
    return manifest


def load_bundle(corpus: list[Trajectory], split: SplitManifest, directory: Path) -> tuple[TrainingManifest, GoalCatalog, PatternPool]:
    validate_task_endpoints(corpus)
    train = split.select(corpus, "train")
    manifest = TrainingManifest.model_validate_json((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.corpus_hash != corpus_digest(corpus) or manifest.split_hash != content_hash(split):
        raise ValueError("Training bundle belongs to a different corpus or split")
    if manifest.source_hash != source_hash(Path(__file__).parent):
        raise ValueError("Research source changed since fitting; create a new frozen training bundle")
    if manifest.training_trajectory_ids != tuple(sorted(t.trajectory_id for t in train)):
        raise ValueError("Training membership does not match the frozen split")
    if set(manifest.artifact_hashes) != {"goals.json", "patterns.json"}:
        raise ValueError("Unexpected training artifact manifest")
    for name, expected in manifest.artifact_hashes.items():
        if file_hash(directory / name) != expected:
            raise ValueError(f"Training artifact hash mismatch: {name}")
    catalog = GoalCatalog.model_validate_json((directory / "goals.json").read_text(encoding="utf-8"))
    pool = PatternPool.model_validate_json((directory / "patterns.json").read_text(encoding="utf-8"))
    allowed = {t.trajectory_id for t in train}
    if not set(pool.training_trajectory_ids) <= allowed:
        raise ValueError("Pattern pool contains held-out trajectories")
    # Recompute inexpensive endpoint catalog to verify its examples are train-only,
    # rather than trusting a user-written boolean provenance flag.
    if content_hash(fit_goals(train)) != content_hash(catalog):
        raise ValueError("Goal catalog differs from the training-only endpoint discovery")
    return manifest, catalog, pool


def shuffled_donors(trajectories: list[Trajectory], seed: int) -> dict[str, Trajectory]:
    """Permute complete tasks, keeping repeated trials coupled and domains intact."""
    by_domain: dict[tuple[str, str], dict[str, list[Trajectory]]] = defaultdict(lambda: defaultdict(list))
    for trajectory in trajectories:
        by_domain[(trajectory.benchmark, trajectory.domain)][trajectory.task_id].append(trajectory)
    result = {}
    for domain, tasks in sorted(by_domain.items()):
        ordered = sorted(tasks)
        shuffled = list(ordered)
        rng = random.Random(f"{seed}:{domain}")
        rng.shuffle(shuffled)
        for original, donor in zip(ordered, shuffled, strict=True):
            donor_trials = sorted(tasks[donor], key=lambda t: t.trial)
            for index, trajectory in enumerate(sorted(tasks[original], key=lambda t: t.trial)):
                result[trajectory.trajectory_id] = donor_trials[index % len(donor_trials)]
    return result


def replay(corpus: list[Trajectory], split: SplitManifest, bundle: Path, output: Path, *,
           partition: Partition = "development", bootstrap_samples: int = 2000,
           goal_config: BackendConfig | None = None) -> dict:
    if output.exists() and any(output.iterdir()):
        raise ValueError("Replay output must be new or empty")
    output.mkdir(parents=True, exist_ok=True)
    run = {"schema_version": 1, "status": "running", "partition": partition,
           "corpus_hash": corpus_digest(corpus), "split_hash": content_hash(split),
           "goal_config": (goal_config or BackendConfig()).model_dump(mode="json")}
    write_json(output / "run.json", run)
    try:
        result = _replay(corpus, split, bundle, output, partition=partition,
                         bootstrap_samples=bootstrap_samples, goal_config=goal_config)
    except BaseException as error:
        write_json(output / "run.json", {**run, "status": "failed", "error_type": type(error).__name__})
        raise
    write_json(output / "run.json", {**run, "status": "complete", "summary_hash": file_hash(output / "summary.json")})
    return result


def _replay(corpus: list[Trajectory], split: SplitManifest, bundle: Path, output: Path, *,
            partition: Partition, bootstrap_samples: int,
            goal_config: BackendConfig | None) -> dict:
    if partition == "train":
        raise ValueError("Research replay must use a held-out partition")
    manifest, catalog, pool = load_bundle(corpus, split, bundle)
    traces = split.select(corpus, partition)
    if not traces:
        raise ValueError("Selected partition is empty")
    donors = shuffled_donors(traces, split.seed)
    goal_backend = GoalBackend(catalog, goal_config)
    known_goals = {goal.goal_id for goal in catalog.signatures}
    known_by_scope: dict[str, set[str]] = defaultdict(set)
    for example in catalog.examples:
        known_by_scope[goal_scope_key(example.benchmark, example.domain)].add(example.goal_id)
    expected_by_id: dict[str, str | None] = {}
    for trajectory in traces:
        goal = canonical_goal(trajectory)
        scoped_goals = known_by_scope[goal_scope_key(trajectory.benchmark, trajectory.domain)]
        expected_by_id[trajectory.trajectory_id] = None if goal is None else goal.goal_id if goal.goal_id in scoped_goals else UNKNOWN_GOAL
    initial_posteriors = {t.trajectory_id: goal_backend.predict(initial_prefix(t)) for t in traces}
    points = {t.trajectory_id: list(decision_points(t)) for t in traces}
    for name in ("predictions.jsonl", "observations.jsonl", "initial-goals.jsonl"):
        (output / name).touch(exist_ok=False)
    rows: list[ScoreRow] = []
    observations: list[dict] = []
    goal_initial_scores: list[dict] = []
    for trajectory in traces:
        expected = expected_by_id[trajectory.trajectory_id]
        initial = initial_posteriors[trajectory.trajectory_id]
        order = sorted(initial.probabilities, key=lambda name: (-initial.probabilities[name], name))
        goal_initial_scores.append({
            "trajectory_id": trajectory.trajectory_id, "expected_goal": expected,
            "benchmark": trajectory.benchmark, "domain": trajectory.domain, "task_id": trajectory.task_id,
            "top1": None if expected is None else expected in order[:1],
            "top3": None if expected is None else expected in order[:3],
            "posterior": initial.model_dump(mode="json"),
        })
        append_jsonl(output / "initial-goals.jsonl", goal_initial_scores[-1])
        for depth, point in enumerate(points[trajectory.trajectory_id]):
            prefix = point.prefix
            begin = time.perf_counter_ns()
            posterior = initial.model_copy(update={"through_seq": prefix.through_seq}) if goal_backend.config.update_policy == "initial" else goal_backend.predict(prefix)
            goal_elapsed_ms = (time.perf_counter_ns() - begin) / 1e6
            donor = donors[trajectory.trajectory_id]
            donor_points = points[donor.trajectory_id]
            donor_prefix = donor_points[min(depth, len(donor_points) - 1)].prefix if donor_points else initial_prefix(donor)
            donor_posterior = initial_posteriors[donor.trajectory_id] if goal_backend.config.update_policy == "initial" else goal_backend.predict(donor_prefix)
            shuffled = donor_posterior.model_copy(update={"through_seq": prefix.through_seq, "model_id": "shuffled-task-goals"})
            shuffled_initial = initial_posteriors[donor.trajectory_id].model_copy(update={"through_seq": prefix.through_seq, "model_id": "shuffled-initial-task-goals"})
            shuffled_oracle = GoalPosterior(probabilities={expected_by_id[donor.trajectory_id] or UNKNOWN_GOAL: 1.0}, through_seq=prefix.through_seq, model_id="offline-shuffled-oracle")
            oracle = GoalPosterior(probabilities={expected or UNKNOWN_GOAL: 1.0}, through_seq=prefix.through_seq, model_id="offline-oracle")
            conditions = {
                "paste": None,
                "oracle": oracle,
                "goalspec_initial": initial,
                "goalspec": posterior,
                "shuffled": shuffled,
                "shuffled_initial": shuffled_initial,
                "shuffled_oracle": shuffled_oracle,
            }
            for condition, goal_posterior in conditions.items():
                before = time.perf_counter_ns()
                prediction = pool.predict(prefix, goal_posterior)
                prediction_elapsed_ms = (time.perf_counter_ns() - before) / 1e6
                for target in point.targets:
                    rows.append(ScoreRow(
                        condition=condition, trajectory_id=trajectory.trajectory_id,
                        benchmark=trajectory.benchmark, domain=trajectory.domain, task_id=trajectory.task_id,
                        group_id=trajectory.group_id, trial=trajectory.trial, seq=target.seq,
                        actual_tool=target.tool, actual_arguments=target.arguments,
                        prediction=prediction, expected_goal=expected,
                    ))
                    append_jsonl(output / "predictions.jsonl", rows[-1])
                    chosen = max(goal_posterior.probabilities, key=goal_posterior.probabilities.get) if goal_posterior else None
                    observations.append({
                        "schema_version": 1, "condition": condition,
                        "trajectory_id": trajectory.trajectory_id, "task_id": trajectory.task_id,
                        "benchmark": trajectory.benchmark, "domain": trajectory.domain,
                        "trial": trajectory.trial, "turn": target.seq, "depth": depth,
                        "query": prefix.query, "through_seq": prefix.through_seq,
                        "batch_id": target.batch_id, "call_id": target.call_id,
                        "goal_distribution": goal_posterior.probabilities if goal_posterior else None,
                        "chosen_goal": chosen, "goal_confidence": goal_posterior.probabilities[chosen] if chosen else None,
                        "observed_action_prefix": list(prefix.signatures),
                        "selected_context": pool.selected_context(prefix),
                        "predicted_tool_distribution": prediction.tool_distribution,
                        "predicted_arguments": [candidate.model_dump(mode="json") for candidate in prediction.candidates],
                        "actual_tool": target.tool, "actual_arguments": target.arguments,
                        "invalid_tool": target.tool not in {tool.name for tool in prefix.tools},
                        "speculation_started_at": None, "authoritative_started_at": target.observed_at_ns,
                        "speculation_hit": None, "tool_latency": None, "LLM_latency": None,
                        "goal_prediction_latency_ms": goal_elapsed_ms if condition == "goalspec" else None,
                        "pattern_prediction_latency_ms": prediction_elapsed_ms,
                        "task_success": trajectory.outcome.success,
                        "measurement_mode": "offline_prediction_no_execution",
                    })
                    append_jsonl(output / "observations.jsonl", observations[-1])
    backend_artifacts = goal_backend.artifacts()
    write_json(output / "goal-backend.json", backend_artifacts)
    evidence = GateEvidence(
        benchmark=traces[0].benchmark if len({t.benchmark for t in traces}) == 1 else "mixed",
        split=partition, source_kind="synthetic" if any(t.source_kind == "synthetic" for t in traces) else "benchmark",
        declared_trajectory_ids=tuple(sorted(t.trajectory_id for t in traces)),
        declared_steps=tuple(sorted((t.trajectory_id, target.seq) for t in traces for point in points[t.trajectory_id] for target in point.targets)),
        input_hashes={"corpus": corpus_digest(corpus), "split": content_hash(split)},
        artifact_hashes={**manifest.artifact_hashes, "training_manifest": content_hash(manifest), "goal_backend": content_hash(backend_artifacts)},
        train_only_artifacts_verified=True, frozen_goal_ids=tuple(sorted(known_goals)),
        frozen_goal_scopes={scope: tuple(sorted(ids)) for scope, ids in sorted(known_by_scope.items())},
    )
    gates = evaluate_gates(rows, traces, evidence, inferred="goalspec_initial", seed=split.seed, bootstrap_samples=bootstrap_samples)
    gates.verify()
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "gates.json", gates)
    result = {
        "schema_version": 1, "phase": "pre_scheduler_pilot", "partition": partition,
        "metrics": score_predictions(rows), "base_actor": summarize_trials(traces),
        "initial_goal_accuracy": {
            "weighting": "trial_micro_with_separate_macro_domain_task_equal",
            "trials": len(goal_initial_scores),
            "labeled_trials": sum(row["expected_goal"] is not None for row in goal_initial_scores),
            "top1": _mean_defined([row["top1"] for row in goal_initial_scores]),
            "top3": _mean_defined([row["top3"] for row in goal_initial_scores]),
            "macro_domain_top1": _macro_goal_accuracy(goal_initial_scores, "top1"),
            "macro_domain_top3": _macro_goal_accuracy(goal_initial_scores, "top3"),
        },
        "goal_backend_config": goal_backend.config.model_dump(mode="json"),
        "goal_configuration_policy": "frozen_in_run_manifest_before_scoring_no_automatic_tuning",
        "paired_comparisons": _paired_comparisons(rows, seed=split.seed, bootstrap_samples=bootstrap_samples),
        "gate_status": gates.status, "scheduler_allowed": gates.scheduler_allowed,
        "source_hash": source_hash(Path(__file__).parent),
        "training_manifest_hash": content_hash(manifest),
        "output_hashes": {name: file_hash(output / name) for name in ("predictions.jsonl", "observations.jsonl", "initial-goals.jsonl", "gates.json", "goal-backend.json")},
        "shuffled_donors": {key: value.trajectory_id for key, value in donors.items()},
        "limitations": [
            "Prediction accuracy is not executed speculation hit rate or measured latency reduction.",
            "Backend and calibration parameters must be selected on development data before final testing.",
            "The gate uses initial-request-only goals; dynamic posterior results are separate.",
            "Memory, scheduler and live guidance stages require real A/B evidence first.",
        ],
    }
    write_json(output / "summary.json", result)
    return result


def _mean_defined(values: list[bool | None]) -> float | None:
    known = [value for value in values if value is not None]
    return sum(known) / len(known) if known else None


def _macro_goal_accuracy(rows: list[dict], key: str) -> float | None:
    tasks: dict[tuple[str, str, str], list[bool | None]] = defaultdict(list)
    for row in rows:
        tasks[(row["benchmark"], row["domain"], row["task_id"])].append(row[key])
    domains: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (benchmark, domain, _task), values in tasks.items():
        score = _mean_defined(values)
        if score is not None:
            domains[(benchmark, domain)].append(score)
    means = [sum(values) / len(values) for values in domains.values()]
    return sum(means) / len(means) if means else None


def _paired_comparisons(rows: list[ScoreRow], *, seed: int, bootstrap_samples: int) -> dict:
    pairs = [("paste", condition) for condition in ("oracle", "goalspec_initial", "goalspec", "shuffled_initial", "shuffled_oracle", "shuffled")]
    pairs.extend((("shuffled_oracle", "oracle"), ("shuffled_initial", "goalspec_initial"), ("shuffled", "goalspec")))
    output = {}
    for baseline, treatment in pairs:
        key = f"{baseline}_vs_{treatment}"
        try:
            estimate = paired_nll(rows, baseline=baseline, treatment=treatment, seed=seed, bootstrap_samples=bootstrap_samples)
            output[key] = {"status": "estimated", "next_tool_nll": estimate.model_dump(mode="json")}
        except ValueError as error:
            output[key] = {"status": "insufficient_evidence", "reason": str(error)}
    return output
