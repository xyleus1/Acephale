import pytest

from goalspec.gates import GateEvidence, GateReport, evaluate_gates, goal_scope_key
from goalspec.goals import canonical_goal
from goalspec.metrics import ScoreRow
from goalspec.schemas import (
    Event,
    GoalPosterior,
    GoalSignature,
    Outcome,
    Prediction,
    ToolContract,
    TraceProvenance,
    Trajectory,
)


def cohort(*, synthetic=False, oracle_probability=0.8, inferred_probability=0.7):
    traces = []
    rows = []
    for task in range(3):
        for trial in range(4):
            trace = Trajectory(
                trajectory_id=f"task{task}:{trial}", benchmark="tau3", domain="retail",
                task_id=f"task{task}", group_id=f"template{task}", trial=trial,
                source_kind="synthetic" if synthetic else "benchmark",
                benchmark_revision="abc123", policy="policy", initial_tools=(ToolContract(name="lookup"),),
                events=(
                    Event(seq=0, kind="message", role="user", content="Find my order"),
                    Event(seq=1, kind="tool_request", call_id="c", tool="lookup", arguments={}),
                    Event(seq=2, kind="tool_result", role="tool", call_id="c", tool="lookup", result={}, status="success"),
                ),
                outcome=Outcome(
                    status="failed" if trial == 3 else "completed", success=trial != 3,
                    goal=GoalSignature(goal_id="lookup", objective="Find order", object_type="order", completion=("found",)),
                ),
                provenance=TraceProvenance(
                    actor_model="fixture-actor", user_model="fixture-user",
                    actor_config_hash="a" * 64, user_config_hash="b" * 64,
                    run_config_hash="c" * 64, trial_seed=trial,
                    raw_results_hash="d" * 64, public_context_hash="e" * 64,
                    endpoint_labels_hash="f" * 64,
                ),
            )
            traces.append(trace)
            for condition, probability in (("paste", 0.5), ("oracle", oracle_probability), ("goalspec", inferred_probability)):
                rows.append(ScoreRow(
                    condition=condition, trajectory_id=trace.trajectory_id, benchmark=trace.benchmark,
                    domain=trace.domain, task_id=trace.task_id, group_id=trace.group_id,
                    trial=trial, seq=1, actual_tool="lookup", actual_arguments={},
                    expected_goal=canonical_goal(trace).goal_id,
                    prediction=Prediction(tool_distribution={"lookup": probability, "other": 1 - probability}),
                ))
    evidence = GateEvidence(
        benchmark="tau3", split="development", source_kind="synthetic" if synthetic else "benchmark",
        declared_trajectory_ids=tuple(trace.trajectory_id for trace in traces),
        declared_steps=tuple((trace.trajectory_id, 1) for trace in traces),
        input_hashes={"corpus": "a" * 64}, artifact_hashes={"patterns": "b" * 64},
        train_only_artifacts_verified=True,
        frozen_goal_ids=(canonical_goal(traces[0]).goal_id,),
        frozen_goal_scopes={goal_scope_key("tau3", "retail"): (canonical_goal(traces[0]).goal_id,)},
    )
    return rows, traces, evidence


def test_complete_real_development_evidence_can_pass():
    report = evaluate_gates(*cohort(), bootstrap_samples=100)
    assert report.status == "passed"
    assert report.scheduler_allowed is True
    assert report.experiment_a.observed_fraction >= 0.10
    assert report.experiment_b.observed_fraction >= 0.25
    report.verify()
    loaded = GateReport.model_validate_json(report.model_dump_json())
    loaded.verify()
    assert loaded == report


def test_endpoint_identity_cannot_depend_on_which_actor_trial_ran():
    rows, traces, evidence = cohort()
    trace = traces[0]
    altered = trace.outcome.goal.model_copy(update={"completion": ("different endpoint",)})
    traces[0] = trace.model_copy(update={"outcome": trace.outcome.model_copy(update={"goal": altered})})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("endpoint labels must remain identical" in reason for reason in report.experiment_a.reasons)


def test_goal_known_only_in_another_domain_is_scored_as_unknown():
    rows, traces, evidence = cohort()
    goal_id = canonical_goal(traces[0]).goal_id
    evidence = evidence.model_copy(update={"frozen_goal_scopes": {goal_scope_key("tau3", "banking"): (goal_id,)}})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert any("Goal labels do not match" in reason for reason in report.experiment_a.reasons)
    rows = [row.model_copy(update={"expected_goal": "__unknown__"}) for row in rows]
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert not any("Goal labels do not match" in reason for reason in report.experiment_a.reasons)


def test_synthetic_diagnostic_never_opens_scientific_gate():
    report = evaluate_gates(*cohort(synthetic=True), bootstrap_samples=100)
    assert report.experiment_a.estimate.improvement > 0
    assert report.status == "insufficient_evidence"
    assert report.scheduler_allowed is False
    assert any("Synthetic" in reason for reason in report.experiment_a.reasons)


@pytest.mark.parametrize("split", ["train", "test"])
def test_gate_selection_never_uses_test_or_train_data(split):
    rows, traces, evidence = cohort()
    report = evaluate_gates(rows, traces, evidence.model_copy(update={"split": split}), bootstrap_samples=100)
    assert report.status == "insufficient_evidence"


def test_unverified_or_missing_artifact_provenance_is_insufficient():
    rows, traces, evidence = cohort()
    evidence = evidence.model_copy(update={"train_only_artifacts_verified": False, "artifact_hashes": {}})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert len(report.experiment_a.reasons) >= 2


def test_weak_oracle_effect_fails_a():
    report = evaluate_gates(*cohort(oracle_probability=0.51), bootstrap_samples=100)
    assert report.experiment_a.status == "failed"
    assert report.status == "failed"
    assert report.scheduler_allowed is False


def test_good_oracle_but_weak_inferred_effect_fails_b():
    report = evaluate_gates(*cohort(inferred_probability=0.51), bootstrap_samples=100)
    assert report.experiment_a.status == "passed"
    assert report.experiment_b.status == "failed"
    assert report.scheduler_allowed is False


def test_negative_oracle_gap_is_not_a_positive_recovery_fraction():
    report = evaluate_gates(*cohort(oracle_probability=0.4, inferred_probability=0.3), bootstrap_samples=100)
    assert report.experiment_b.observed_fraction is None
    assert report.status == "failed"


def test_missing_declared_failure_is_rejected_instead_of_dropped():
    rows, traces, evidence = cohort()
    removed = traces[-1].trajectory_id
    traces = traces[:-1]
    rows = [row for row in rows if row.trajectory_id != removed]
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("complete declared cohort" in reason for reason in report.experiment_a.reasons)
    assert any("four independently" in reason for reason in report.experiment_a.reasons)


def test_unpaired_steps_and_changed_targets_block_gate():
    rows, traces, evidence = cohort()
    report = evaluate_gates(rows[:-1], traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    changed = rows.copy()
    changed[0] = changed[0].model_copy(update={"actual_tool": "other"})
    report = evaluate_gates(changed, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"


def test_zero_step_failed_trials_are_still_required():
    rows, traces, evidence = cohort()
    removed_id = traces[-1].trajectory_id
    traces[-1] = traces[-1].model_copy(update={"events": (traces[-1].events[0],)})
    rows = [row for row in rows if row.trajectory_id != removed_id]
    evidence = evidence.model_copy(update={"declared_steps": tuple(key for key in evidence.declared_steps if key[0] != removed_id)})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "passed"
    assert removed_id in report.evidence.declared_trajectory_ids


def test_report_binds_prediction_inputs_and_detects_mutation():
    rows, traces, evidence = cohort()
    first = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    changed = rows.copy()
    changed[0] = changed[0].model_copy(update={"prediction": Prediction(tool_distribution={"lookup": 0.9, "other": 0.1})})
    second = evaluate_gates(changed, traces, evidence, bootstrap_samples=100)
    assert first.score_rows_hash != second.score_rows_hash
    assert first.report_hash != second.report_hash
    edited = first.model_copy(update={"scheduler_allowed": False})
    with pytest.raises(ValueError, match="integrity"):
        edited.verify()


def test_incomplete_outcomes_and_unpinned_revisions_block_gate():
    rows, traces, evidence = cohort()
    traces[0] = traces[0].model_copy(update={"outcome": Outcome(status="incomplete"), "benchmark_revision": "unknown"})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("resolved outcome" in reason for reason in report.experiment_a.reasons)
    assert any("pinned revision" in reason for reason in report.experiment_a.reasons)


def test_missing_goal_labels_are_insufficient_and_explicitly_reported():
    rows, traces, evidence = cohort()
    rows = [row.model_copy(update={"expected_goal": None}) for row in rows]
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert report.goal_label_coverage == 0.0


def test_novel_endpoints_use_unknown_fallback_without_learned_ontology_mutation():
    rows, traces, evidence = cohort()
    novel = GoalSignature(goal_id="novel", objective="Novel", object_type="order", completion=("new",))
    task_id = traces[0].task_id
    traces = [trace.model_copy(update={"outcome": trace.outcome.model_copy(update={"goal": novel})}) if trace.task_id == task_id else trace for trace in traces]
    rows = [row.model_copy(update={"expected_goal": "__unknown__"}) if row.task_id == task_id else row for row in rows]
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "passed"
    assert report.goal_label_coverage == 1.0
    assert report.unknown_goal_steps == 4


def test_inconsistent_revisions_or_empty_initial_query_are_insufficient():
    rows, traces, evidence = cohort()
    traces[0] = traces[0].model_copy(update={"benchmark_revision": "different", "events": traces[0].events[1:]})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("consistent within" in reason for reason in report.experiment_a.reasons)
    assert any("initial user query" in reason for reason in report.experiment_a.reasons)


def test_unresolved_calls_in_retained_failure_block_scientific_gate():
    rows, traces, evidence = cohort()
    traces[-1] = traces[-1].model_copy(update={"events": traces[-1].events[:-1]})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("Unresolved authoritative" in reason for reason in report.experiment_a.reasons)


def test_gate_rejects_future_goal_posterior_at_shared_batch_boundary():
    rows, traces, evidence = cohort()
    selected = traces[0]
    traces[0] = selected.model_copy(update={"events": (
        selected.events[0],
        selected.events[1].model_copy(update={"batch_id": "batch"}),
        Event(seq=2, kind="tool_request", call_id="sibling", tool="lookup", arguments={}, batch_id="batch"),
        selected.events[2].model_copy(update={"seq": 3}),
        Event(seq=4, kind="tool_result", role="tool", call_id="sibling", tool="lookup", result={}, status="success"),
    )})
    sibling_rows = []
    for row in rows:
        if row.trajectory_id == selected.trajectory_id:
            sibling = row.model_copy(update={"seq": 2})
            if row.condition == "oracle":
                sibling = sibling.model_copy(update={"prediction": row.prediction.model_copy(update={
                    "goal_posterior": GoalPosterior(probabilities={row.expected_goal: 1.0}, through_seq=1),
                })})
            sibling_rows.append(sibling)
    evidence = evidence.model_copy(update={"declared_steps": (*evidence.declared_steps, (selected.trajectory_id, 2))})
    report = evaluate_gates([*rows, *sibling_rows], traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("pre-batch boundary" in reason for reason in report.experiment_a.reasons)


@pytest.mark.parametrize("corruption", ["missing", "duplicate_seed", "different_actor", "bad_hash"])
def test_unverified_trial_provenance_cannot_open_scientific_gate(corruption):
    rows, traces, evidence = cohort()
    changes = {
        "missing": None,
        "duplicate_seed": traces[0].provenance.model_copy(update={"trial_seed": 1}),
        "different_actor": traces[0].provenance.model_copy(update={"actor_config_hash": "1" * 64}),
        "bad_hash": traces[0].provenance.model_copy(update={"endpoint_labels_hash": "unverified"}),
    }
    traces[0] = traces[0].model_copy(update={"provenance": changes[corruption]})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert report.scheduler_allowed is False


def test_invalid_observed_tool_request_is_retained_as_a_prediction_miss():
    rows, traces, evidence = cohort()
    selected = traces[0]
    traces[0] = selected.model_copy(update={"initial_tools": (), "events": (
        selected.events[0], selected.events[1],
        selected.events[2].model_copy(update={"status": "error", "result": "Unknown tool"}),
    )})
    rows = [row.model_copy(update={"prediction": Prediction(tool_distribution={"other": 1.0})})
            if row.trajectory_id == selected.trajectory_id else row for row in rows]
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.experiment_a.estimate.paired_steps == len(traces)
    assert report.status != "insufficient_evidence"
    traces[0] = traces[0].model_copy(update={"events": selected.events})
    report = evaluate_gates(rows, traces, evidence, bootstrap_samples=100)
    assert report.status == "insufficient_evidence"
    assert any("recorded error result" in reason for reason in report.experiment_a.reasons)
