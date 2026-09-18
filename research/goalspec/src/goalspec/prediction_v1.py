"""Frozen paper-based predictor comparisons with identical argument-pool controls.

This module preserves the historical pilot. It executes no tools and makes no
provider calls. Provider-generated goal posteriors may be supplied in a frozen
checkpoint cache; the default lexical classifier is explicitly labelled.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal

from goalspec.binding import canonical
from goalspec.contracts_v1 import hash_v1
from goalspec.evaluation_v1 import NLL_FLOOR, cluster_interval
from goalspec.goals import (
    UNKNOWN_GOAL,
    canonical_goal,
    cosine_scores,
    fit_goals,
)
from goalspec.models import public_model_input
from goalspec.patterns import fit_patterns
from goalspec.replay import decision_points
from goalspec.schemas import Candidate, GoalPosterior, Prediction, Record, Trajectory

CONDITIONS = ("stateless", "local_paste", "paste_memory", "goalspec_no_memory",
              "goalspec", "oracle_goals", "shuffled_goals")


def scope_key(trace):
    return hash_v1({"domain": trace.domain, "benchmark": trace.benchmark,
                    "version": trace.benchmark_revision,
                    "tools": [t.model_dump(mode="json") for t in trace.initial_tools],
                    "policy": trace.policy})


class FrozenGoal(Record):
    trajectory_id: str
    through_seq: int
    visible_input_hash: str
    posterior: GoalPosterior
    status: Literal["completed", "failed"] = "completed"
    error_type: str | None = None


class ReplayScore(Record):
    condition: str
    rankingControl: bool
    trajectoryId: str
    familyId: str
    taskId: str
    domain: str
    trial: int
    seq: int
    actualTool: str
    actualArguments: dict
    goalExpected: str | None
    goalTop1: bool | None
    goalTop3: bool | None
    toolTop1: bool
    toolTop3: bool
    argumentsTop1: bool
    argumentsTop3: bool
    toolNll: float
    actionNll: float
    candidatePoolHash: str
    candidatePoolSize: int
    visibleInputHash: str
    toolDistribution: dict[str, float]
    candidates: tuple[Candidate, ...]
    goalDistribution: dict[str, float] | None

    @property
    def pair_key(self):
        return self.trajectoryId, self.seq


def _mix(base, memory, posterior=None, weight=.35):
    tools = base.tool_distribution
    distribution = {tool: (1 - weight) * value + weight * memory.get(tool, 0) for tool, value in tools.items()}
    # Existing bindings continue to resolve current values only. Historical
    # episodic entity values are never emitted as present invocation arguments.
    candidates = tuple(candidate.model_copy(update={"probability":
        min(1, candidate.probability * distribution[candidate.tool] / max(tools[candidate.tool], NLL_FLOOR))})
        for candidate in base.candidates)
    return Prediction(tool_distribution=distribution, candidates=candidates, goal_posterior=posterior)


def identical_candidate_pool(predictions: dict[str, Prediction]):
    """Union only already-bound predictions, before the held-out target is read."""
    pool = {}
    for prediction in predictions.values():
        for candidate in prediction.candidates:
            pool[(candidate.tool, canonical(candidate.arguments))] = candidate
    return tuple(pool[key] for key in sorted(pool))


def rank_identical_pool(prediction: Prediction, pool: tuple[Candidate, ...]):
    """Freeze binding opportunity; change only each condition's tool probabilities.

    With no trained within-tool argument ranker, split a tool's probability
    uniformly across its distinct bindings. Record this restriction explicitly.
    """
    counts = Counter(candidate.tool for candidate in pool)
    candidates = tuple(candidate.model_copy(update={"probability":
        prediction.tool_distribution.get(candidate.tool, 0) / counts[candidate.tool]})
        for candidate in pool)
    return prediction.model_copy(update={"candidates": candidates})


def _score(trace, target, prediction, condition, pool, input_hash, expected, control):
    tool_order = sorted(prediction.tool_distribution, key=lambda t: (-prediction.tool_distribution[t], t))
    unique = {}
    for candidate in prediction.candidates:
        key = (candidate.tool, canonical(candidate.arguments))
        unique[key] = max(unique.get(key, 0), candidate.probability)
    ordered = sorted(unique, key=lambda k: (-unique[k], k))
    actual = (target.tool, canonical(target.arguments))
    probabilities = prediction.goal_posterior.probabilities if prediction.goal_posterior else None
    goals = sorted(probabilities, key=lambda g: (-probabilities[g], g)) if probabilities else []
    # Candidates describe sparse action probability mass. Unbound mass stays
    # unresolved; do not renormalize surviving bindings upward after failure.
    if sum(unique.values()) > 1 + 1e-6:
        raise ValueError("Candidate action probabilities exceed one")
    return ReplayScore(
        condition=condition, rankingControl=control, trajectoryId=trace.trajectory_id,
        familyId=trace.group_id, taskId=trace.task_id, domain=trace.domain,
        trial=trace.trial, seq=target.seq, actualTool=target.tool,
        actualArguments=target.arguments, goalExpected=expected,
        goalTop1=expected in goals[:1] if expected is not None and probabilities else None,
        goalTop3=expected in goals[:3] if expected is not None and probabilities else None,
        toolTop1=target.tool in tool_order[:1], toolTop3=target.tool in tool_order[:3],
        argumentsTop1=actual in ordered[:1], argumentsTop3=actual in ordered[:3],
        toolNll=-math.log(max(prediction.tool_distribution.get(target.tool, 0), NLL_FLOOR)),
        actionNll=-math.log(max(unique.get(actual, 0), NLL_FLOOR)),
        candidatePoolHash=hash_v1([{"tool": c.tool, "arguments": c.arguments} for c in pool]),
        candidatePoolSize=len(pool), visibleInputHash=input_hash,
        toolDistribution=prediction.tool_distribution, candidates=prediction.candidates,
        goalDistribution=probabilities,
    )


def replay_predictions(training: list[Trajectory], heldout: list[Trajectory], *,
                       frozen_goals: list[FrozenGoal] | None = None, seed=42):
    if not training or not heldout:
        raise ValueError("Nonempty training and held-out cohorts required")
    if {t.group_id for t in training} & {t.group_id for t in heldout}:
        raise ValueError("Task families overlap training and held-out partitions")
    ids = [t.trajectory_id for t in training + heldout]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate training or held-out trajectory IDs")
    # Whole visible transcripts cannot appear in both partitions under new IDs.
    def content(t):
        return hash_v1({"scope": scope_key(t), "events": [e.model_dump(mode="json", exclude={"observed_at_ns", "duration_ms", "state_version"}) for e in t.events]})
    if {content(t) for t in training} & {content(t) for t in heldout}:
        raise ValueError("Duplicate trajectory content across partitions")
    scopes = defaultdict(list)
    for trace in training:
        scopes[scope_key(trace)].append(trace)
    frozen = {key: (fit_patterns(traces, max_context=3, min_support=2), fit_goals(traces)) for key, traces in scopes.items()}
    artifact_hash = hash_v1({key: [pool.model_dump(mode="json"), catalog.model_dump(mode="json")]
                            for key, (pool, catalog) in frozen.items()})
    cache = {(g.trajectory_id, g.through_seq): g for g in frozen_goals or []}
    if frozen_goals is not None and len(cache) != len(frozen_goals):
        raise ValueError("Duplicate cached checkpoint goals")
    points = {t.trajectory_id: list(decision_points(t)) for t in heldout}
    posteriors = {}
    used_cache = set()
    for trace in heldout:
        key = scope_key(trace)
        if key not in frozen:
            raise ValueError("Held-out tools, policy or environment lack a compatible training scope")
        _, catalog = frozen[key]
        for point in points[trace.trajectory_id]:
            prefix = point.prefix
            identity = (trace.trajectory_id, prefix.through_seq)
            if frozen_goals is None:
                posterior = catalog.predict(prefix)
            else:
                record = cache.get(identity)
                if record is None or record.visible_input_hash != hash_v1(public_model_input(prefix)) or record.posterior.through_seq != prefix.through_seq:
                    raise ValueError("Frozen goal cache missing or belongs to different visible input")
                posterior = record.posterior
                used_cache.add(identity)
            posteriors[identity] = posterior
    if frozen_goals is not None and used_cache != set(cache):
        raise ValueError("Frozen goal cache contains unscored or future checkpoints")
    # Family-level cyclic derangement, within compatibility scope. Trials and
    # variants share their donor family, and a family never donates to itself.
    donors = {}
    by_scope = defaultdict(lambda: defaultdict(list))
    for trace in heldout:
        by_scope[scope_key(trace)][trace.group_id].append(trace)
    rng = random.Random(seed)
    for families in by_scope.values():
        order = sorted(families)
        if len(order) < 2:
            raise ValueError("Shuffled-goal control requires at least two compatible held-out families")
        rng.shuffle(order)
        for index, family in enumerate(order):
            alternatives = sorted(families[order[(index + 1) % len(order)]], key=lambda t: (t.trial, t.task_id))
            for ordinal, trace in enumerate(sorted(families[family], key=lambda t: (t.trial, t.task_id))):
                donors[trace.trajectory_id] = alternatives[ordinal % len(alternatives)]
    rows = []
    for trace in heldout:
        scope = scope_key(trace)
        pool, catalog = frozen[scope]
        memory = [(point.prefix, target.tool, canonical_goal(t).goal_id if canonical_goal(t) else None)
                  for t in scopes[scope] for point in decision_points(t) for target in point.targets]
        known = {signature.goal_id for signature in catalog.signatures}
        goal = canonical_goal(trace)
        expected = goal.goal_id if goal and goal.goal_id in known else UNKNOWN_GOAL if goal else None
        donor = donors[trace.trajectory_id]
        donor_points = points[donor.trajectory_id]
        for depth, point in enumerate(points[trace.trajectory_id]):
            prefix = point.prefix
            posterior = posteriors[(trace.trajectory_id, prefix.through_seq)]
            donor_point = donor_points[min(depth, len(donor_points) - 1)] if donor_points else None
            shuffled = posteriors[(donor.trajectory_id, donor_point.prefix.through_seq)] if donor_point else GoalPosterior(probabilities={UNKNOWN_GOAL: 1}, through_seq=prefix.through_seq)
            shuffled = shuffled.model_copy(update={"through_seq": prefix.through_seq})
            oracle = GoalPosterior(probabilities={expected or UNKNOWN_GOAL: 1}, through_seq=prefix.through_seq, model_id="offline_oracle")
            plain = pool.predict(prefix)
            goal_prediction = pool.predict(prefix, posterior)
            # Stateless sees only this request and the present tool descriptions.
            names = [tool.name for tool in prefix.tools]
            similarities = cosine_scores(prefix.query, [tool.name + " " + tool.description for tool in prefix.tools])
            weights = [value + .1 for value in similarities]
            stateless = Prediction(tool_distribution={name: value / sum(weights) for name, value in zip(names, weights, strict=True)}) if names else plain

            def episodic(posterior_value=None, prefix=prefix, memory=memory, plain=plain):
                scores = cosine_scores(prefix.text, [past.text for past, _, _ in memory])
                selected = sorted(range(len(memory)), key=lambda i: (-scores[i], i))[:8]
                counts = {name: .5 for name in plain.tool_distribution}
                for index in selected:
                    past, tool, endpoint = memory[index]
                    if tool not in counts:
                        continue
                    context_overlap = len(set(prefix.signatures) & set(past.signatures))
                    weight = scores[index] * (1 + context_overlap)
                    if posterior_value:
                        weight *= .1 + posterior_value.probabilities.get(endpoint or UNKNOWN_GOAL, 0)
                    counts[tool] += weight
                total = sum(counts.values())
                return {name: value / total for name, value in counts.items()}

            predictions = {
                "stateless": stateless, "local_paste": plain,
                "paste_memory": _mix(plain, episodic()),
                "goalspec_no_memory": goal_prediction,
                "goalspec": _mix(goal_prediction, episodic(posterior), posterior),
                "oracle_goals": _mix(pool.predict(prefix, oracle), episodic(oracle), oracle),
                "shuffled_goals": _mix(pool.predict(prefix, shuffled), episodic(shuffled), shuffled),
            }
            # Build opportunity from ALL train-discovered goal branches. Oracle
            # and shuffled target labels cannot add a previously absent binding.
            bound_branches = {"unconditioned": plain}
            for signature in catalog.signatures:
                branch = GoalPosterior(probabilities={signature.goal_id: 1}, through_seq=prefix.through_seq)
                bound_branches[signature.goal_id] = pool.predict(prefix, branch)
            common_pool = identical_candidate_pool(bound_branches)
            input_hash = hash_v1(public_model_input(prefix))
            for target in point.targets:
                for condition, prediction in predictions.items():
                    own = identical_candidate_pool({condition: prediction})
                    rows.append(_score(trace, target, prediction, condition, own, input_hash, expected, False))
                    ranked = rank_identical_pool(prediction, common_pool)
                    rows.append(_score(trace, target, ranked, condition, common_pool, input_hash, expected, True))
    if artifact_hash != hash_v1({key: [pool.model_dump(mode="json"), catalog.model_dump(mode="json")]
                                for key, (pool, catalog) in frozen.items()}):
        raise RuntimeError("Frozen repository changed during replay")
    return rows, {"snapshotHash": artifact_hash, "trainingTrajectoryIds": sorted(t.trajectory_id for t in training),
                  "trainingFamilies": sorted({t.group_id for t in training}),
                  "heldoutFamilies": sorted({t.group_id for t in heldout}),
                  "goalBackend": sorted({g.model_id for g in posteriors.values()}),
                  "goalInput": "frozen_checkpoint_cache" if frozen_goals is not None else "lexical_uncalibrated_baseline",
                  "failedGoalPredictions": sum(g.status == "failed" for g in frozen_goals or []),
                  "goalReference": "independent_endpoint_labels_from_outcome_not_requested_goal_annotations",
                  "memory": "train_only_tfidf_top8_tool_distribution_mixture_weight_0.35",
                  "stateless": "visible_request_tool_description_tfidf_with_0.1_smoothing",
                  "rankingControl": "identical_all_training_branches_currently_bound_pool_uniform_within_tool",
                  "label": "paper-based local baselines, not verified reproductions of upstream systems",
                  "execution": "frozen_prediction_replay_no_tools_executed_no_live_latency_claim"}


def summarize_replay(rows: list[ReplayScore], *, seed=42, bootstrap_samples=2000):
    if not rows:
        raise ValueError("Prediction replay is empty")
    identities = [(r.condition, r.rankingControl, r.pair_key) for r in rows]
    if len(identities) != len(set(identities)):
        raise ValueError("Duplicate prediction score")
    result = {"conditions": {}, "comparisons": [], "nllFloor": NLL_FLOOR,
              "lossInterpretation": "held-out predictive cross-entropy estimates in nats, including model error; not true conditional entropy",
              "entropyReductionInterpretation": "difference in predictive cross-entropy estimates, not a direct entropy measurement",
              "speculationHitRate": None, "speculationHitRateReason": "No tools execute in prediction replay",
              "requestedGoalAccuracy": None,
              "goalLabelLimitation": "Endpoint-goal labels support endpoint classification and an oracle-endpoint diagnostic only. Independent pre-checkpoint requested-goal annotations are absent."}
    for control in (False, True):
        scoped = [r for r in rows if r.rankingControl == control]
        groups = {condition: [r for r in scoped if r.condition == condition] for condition in CONDITIONS}
        baseline = {row.pair_key: row for row in groups["local_paste"]}
        for condition, values in groups.items():
            if not values or {r.pair_key for r in values} != set(baseline):
                raise ValueError("Every condition must score identical held-out decisions")
            if control:
                pools = defaultdict(set)
                for row in scoped:
                    pools[row.pair_key].add(row.candidatePoolHash)
                if any(len(hashes) != 1 for hashes in pools.values()):
                    raise ValueError("Ranking control candidate pools differ across conditions")
            key = condition + ("__same_pool" if control else "")
            metrics = {name: sum(float(getattr(r, name)) for r in values) / len(values)
                       for name in ("toolTop1", "toolTop3", "argumentsTop1", "argumentsTop3", "toolNll", "actionNll")}
            for name in ("goalTop1", "goalTop3"):
                measured = [getattr(r, name) for r in values if getattr(r, name) is not None]
                metrics["endpoint" + name[0].upper() + name[1:]] = sum(measured) / len(measured) if measured else None
                metrics["endpoint" + name[0].upper() + name[1:] + "LabeledSteps"] = len(measured)
            result["conditions"][key] = {"steps": len(values), **metrics}
            if condition != "local_paste":
                for metric in ("toolNll", "actionNll"):
                    difference = cluster_interval(values, lambda row, b=baseline, m=metric: getattr(b[row.pair_key], m) - getattr(row, m), seed=seed, bootstrap_samples=bootstrap_samples)
                    base_loss = cluster_interval(list(baseline.values()), lambda r, m=metric: getattr(r, m), seed=seed, bootstrap_samples=bootstrap_samples)["estimate"]
                    result["comparisons"].append({"baseline": "local_paste", "treatment": condition,
                                                  "rankingControl": control, "metric": metric,
                                                  "relativeEstimatedReduction": difference["estimate"] / base_loss if base_loss else None,
                                                  **difference})
    return result


def publish_prediction_report(rows, provenance, output: Path, *, seed=42, bootstrap_samples=2000, requested_metrics=None):
    summary = summarize_replay(rows, seed=seed, bootstrap_samples=bootstrap_samples)
    if requested_metrics is not None:
        references = [{"trajectoryId": identifier, "visibleInputHash": digest}
                      for identifier, digest in sorted({(r.trajectoryId, r.visibleInputHash) for r in rows})]
        if requested_metrics.get("checkpointReferencesHash") != hash_v1(references):
            raise ValueError("Requested-goal metrics belong to different causal checkpoints")
        summary["requestedGoalAccuracy"] = requested_metrics
    output.mkdir(parents=True, exist_ok=False)
    (output / "predictions.jsonl").write_text("".join(r.model_dump_json() + "\n" for r in rows), encoding="utf-8")
    (output / "summary.json").write_text(json.dumps({**summary, "provenance": provenance}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = ["# Frozen GoalSpec prediction replay", "", provenance["label"] + ".", "",
             "This replay measures prediction on recorded held-out actor decisions. No speculative tool executions "
             "or live task-success changes are measured. Loss is predictive cross-entropy in nats, including model error. "
             "Its reduction is an estimated predictive improvement, not measurement of true conditional entropy.", "",
             f"Goal predictor: {', '.join(provenance['goalBackend'])}. Memory: {provenance['memory']}.", "",
             "| Condition | Steps | Tool Top-1 | Full arguments Top-1 | Tool loss | Action loss |",
             "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for key, values in summary["conditions"].items():
        lines.append(f"| {key} | {values['steps']} | {values['toolTop1']:.3f} | {values['argumentsTop1']:.3f} | {values['toolNll']:.4f} | {values['actionNll']:.4f} |")
    if requested_metrics is not None:
        lines.extend(["", "Independent requested-goal reference assessment", "",
                      f"Goal Top-1: {requested_metrics['goalTop1']}; Goal Top-3: {requested_metrics['goalTop3']}. "
                      f"Scored {requested_metrics['scoredCheckpoints']}/{requested_metrics['checkpoints']} causal checkpoints. "
                      "References and semantic matching use the pinned teacher and only visible user messages and policy. "
                      "This is automated reference assessment, not human ground truth. Failures, source hashes and clustered "
                      "intervals are included separately under requestedGoalAccuracy in summary.json."])
    lines.extend(["", "Conditions suffixed same_pool share exactly the same current-source-bound argument candidates, "
                  "formed from every compatible training goal branch before the target is scored. Their tool scores "
                  "are split uniformly across same-tool bindings. This control removes the prior binding-pool confound, "
                  "but does not evaluate a learned within-tool argument ranker. Missing bindings count as misses and "
                  "unassigned action probability remains unresolved. Candidate matches are not speculation hits.", "",
                  "Family-clustered paired estimates and complete endpoint-goal Top-1/Top-3, tool Top-3 and argument Top-3 "
                  "denominators are recorded in summary.json. Goal labels here describe independent endpoints. They do not "
                  "establish requested-goal annotation accuracy; oracle_goals is an oracle-endpoint diagnostic. "
                  "Intervals are exploratory and unadjusted for multiple comparisons.", ""])
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    manifest = {"schemaVersion": "1.0.0", "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.iterdir())}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return summary
