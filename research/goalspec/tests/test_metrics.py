import math

import pytest

from goalspec.metrics import ScoreRow, paired_nll, score_predictions, summarize_trials
from goalspec.schemas import Candidate, Event, GoalPosterior, Outcome, Prediction, Trajectory


def row(condition="paste", task="task1", group="group1", probability=0.5, **updates):
    values = dict(
        condition=condition, trajectory_id=task, benchmark="tau3", domain="retail",
        task_id=task, group_id=group, trial=0, seq=1, actual_tool="lookup",
        actual_arguments={"id": 1},
        prediction=Prediction(tool_distribution={"lookup": probability, "other": 1 - probability}),
    )
    values.update(updates)
    return ScoreRow(**values)


def trace(task="task1", trial=0, success=True, **updates):
    values = dict(
        trajectory_id=f"{task}:{trial}", benchmark="tau3", domain="retail",
        task_id=task, group_id=task, trial=trial, source_kind="benchmark",
        benchmark_revision="abcdef", policy="policy", initial_tools=(),
        events=(
            Event(seq=1, kind="tool_request", call_id="c", tool="lookup", arguments={}),
            Event(seq=2, kind="tool_result", role="tool", call_id="c", tool="lookup", result={}, status="success"),
        ),
        outcome=Outcome(status="completed" if success else "failed", success=success),
    )
    values.update(updates)
    return Trajectory(**values)


def test_full_json_match_and_unbound_candidates_stay_in_denominator():
    prediction = Prediction(
        tool_distribution={"lookup": 0.9, "other": 0.1},
        candidates=(Candidate(tool="lookup", arguments={"id": True}, probability=0.9),),
    )
    result = score_predictions([
        row(prediction=prediction), row(task="task2", group="group2", probability=0.9),
    ])["paste"]
    assert result["tool_top1"] == 1.0
    assert result["tool_arguments_top1"] == 0.0
    assert result["argument_binding_coverage"] == 0.5


def test_candidate_duplicates_do_not_consume_topk_positions():
    wrong = Candidate(tool="lookup", arguments={"id": 2}, probability=0.8)
    correct = Candidate(tool="lookup", arguments={"id": 1}, probability=0.2)
    prediction = Prediction(tool_distribution={"lookup": 1.0}, candidates=(wrong, wrong, wrong, correct))
    result = score_predictions([row(prediction=prediction)])["paste"]
    assert result["tool_arguments_top1"] == 0.0
    assert result["tool_arguments_top3"] == 1.0


def test_zero_probability_and_missing_tool_use_fixed_logged_floor():
    result = score_predictions([row(prediction=Prediction(tool_distribution={"other": 1.0}))])["paste"]
    assert result["next_tool_nll"] == pytest.approx(-math.log(result["nll_floor"]))


def test_base_actor_has_no_predictor_accuracy():
    result = score_predictions([row(condition="base", prediction=None)])["base"]
    assert result["next_tool_nll"] is None
    assert result["tool_top1"] is None


def test_partial_predictor_failure_and_duplicate_steps_are_rejected():
    with pytest.raises(ValueError, match="Partially missing"):
        score_predictions([row(), row(task="task2", prediction=None)])
    with pytest.raises(ValueError, match="Duplicate"):
        score_predictions([row(), row()])


def test_goal_calibration_unknowns_and_missing_posteriors():
    prediction = Prediction(
        tool_distribution={"lookup": 1.0},
        goal_posterior=GoalPosterior(
            probabilities={"__unknown__": 0.8, "return": 0.2}, through_seq=0,
        ),
    )
    result = score_predictions([
        row(prediction=prediction, expected_goal="__unknown__"),
        row(task="task2", expected_goal="return"),
    ])["paste"]["goals"]
    assert result["top1"] == 0.5
    assert result["posterior_coverage"] == 0.5
    assert result["ece_10_bins"] == pytest.approx(0.2)
    assert result["brier"] == pytest.approx(0.08)
    assert result["unknown_recall"] == 1.0


def test_paired_nll_bootstrap_is_reproducible_and_task_clustered():
    rows = [
        row(condition, task=f"task{i}", group=f"group{i}", probability=probability)
        for i in range(4)
        for condition, probability in (("paste", 0.5), ("oracle", 0.8))
    ]
    estimate = paired_nll(rows, seed=9)
    assert estimate == paired_nll(reversed(rows), seed=9)
    assert estimate.baseline_nll == pytest.approx(-math.log(0.5))
    assert estimate.improvement == pytest.approx(math.log(0.8 / 0.5))
    assert estimate.ci_lower > 0
    assert estimate.tasks == estimate.clusters == 4


def test_paired_nll_does_not_silently_intersect_steps():
    rows = [row(), row("oracle"), row(task="task2", group="group2")]
    with pytest.raises(ValueError, match="Incomplete paired"):
        paired_nll(rows)


def test_paired_nll_rejects_changed_authoritative_arguments():
    with pytest.raises(ValueError, match="different authoritative"):
        paired_nll([row(), row("oracle", actual_arguments={"id": 2})])


def test_repeated_trials_cannot_create_independent_clusters():
    rows = [
        row(condition, task=f"task{i}", probability=probability)
        for i in range(4)
        for condition, probability in (("paste", 0.5), ("oracle", 0.8))
    ]
    with pytest.raises(ValueError, match="two template groups"):
        paired_nll(rows)


def test_macro_domains_have_equal_weight_and_trials_equal_weight():
    rows = []
    for domain, count, probability in (("retail", 2, 0.8), ("airline", 6, 0.6)):
        for task in range(count):
            for condition, value in (("paste", 0.5), ("oracle", probability)):
                rows.append(row(condition, task=f"{domain}{task}", group=f"{domain}{task}", domain=domain, probability=value))
    estimate = paired_nll(rows)
    assert estimate.treatment_nll == pytest.approx((-math.log(0.8) - math.log(0.6)) / 2)


def test_equal_domain_names_in_different_benchmarks_remain_distinct():
    rows = []
    for benchmark, count, probability in (("tau3", 2, 0.8), ("another", 6, 0.6)):
        for task in range(count):
            for condition, value in (("paste", 0.5), ("oracle", probability)):
                rows.append(row(condition, task=f"task{task}", group=f"group{task}", trajectory_id=f"{benchmark}/{task}", benchmark=benchmark, probability=value))
    estimate = paired_nll(rows)
    assert estimate.treatment_nll == pytest.approx((-math.log(0.8) - math.log(0.6)) / 2)
    assert estimate.tasks == 8
    assert set(estimate.domains) == {"tau3/retail", "another/retail"}


def test_native_passk_all_trials_is_not_best_of_k():
    result = summarize_trials([trace(trial=i, success=i < 3) for i in range(4)])
    assert result["pass_k_all_trials"]["1"]["value"] == 0.75
    assert result["pass_k_all_trials"]["2"]["value"] == 0.5
    assert result["pass_k_all_trials"]["4"]["value"] == 0.0
    assert result["authoritative_calls_per_successful_trial"] == pytest.approx(4 / 3)


def test_undersampled_tasks_are_not_dropped_and_latency_is_not_invented():
    result = summarize_trials([trace()])
    assert result["pass_k_all_trials"]["4"] == {"value": None, "insufficient_tasks": 1}
    assert result["latency"]["p95"] is None
    assert result["latency"]["missing_trials"] == 1
    assert result["latency"]["complete_cohort"] is False


def test_missing_outcome_counts_unsuccessful_and_partial_timings_are_explicit():
    traces = [
        trace(total_elapsed_ms=100),
        trace(trial=1, outcome=Outcome(status="incomplete")),
    ]
    result = summarize_trials(traces)
    assert result["task_success"] == 0.5
    assert result["unresolved_outcomes_counted_unsuccessful"] == 1
    assert result["latency"]["p99"] == 100
    assert result["latency"]["complete_cohort"] is False


def test_duplicate_trials_are_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        summarize_trials([trace(), trace(trajectory_id="different")])


def test_native_success_is_independent_of_termination_status():
    result = summarize_trials([
        trace(outcome=Outcome(status="incomplete", success=True, native_reward=1.0)),
        trace(trial=1, outcome=Outcome(status="error", success=False, native_reward=0.0)),
    ])
    assert result["task_success"] == 0.5
    assert result["pass_k_all_trials"]["1"]["value"] == 0.5
    assert result["successful_noncompleted_trials"] == 1
    assert result["retained_error_trials"] == 1
    assert result["retained_incomplete_trials"] == 1
    assert result["resolved_native_failure_trials"] == 1


def test_native_infrastructure_exclusions_are_separate_from_complete_cohort():
    result = summarize_trials([
        trace(),
        trace(trial=1, outcome=Outcome(
            status="error", success=None, native_termination_reason="infrastructure_error",
            native_excluded_from_success=True,
        )),
    ])
    assert result["task_success"] == 0.5
    assert result["trials"] == 2
    native = result["native_exclusion_view"]
    assert native["task_success"] == 1.0
    assert native["retained_in_full_cohort_but_excluded_by_native_scorer"] == 1
    assert native["excluded_trajectory_ids"] == ["task1:1"]
    assert native["pass_k_all_trials"]["2"]["value"] is None
