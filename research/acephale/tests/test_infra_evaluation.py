from __future__ import annotations

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_evaluation import (
    ARMS,
    TrialDesign,
    TrialResult,
    report_trials,
    score_candidate_panels,
    score_predictions,
)


def experiment():
    slots, results = [], []
    for family in range(2):
        for trial in range(2):
            for arm in ARMS:
                identity = f"{family}-{trial}-{arm}"
                slots.append({"slot_id": identity, "task_id": f"task-{family}", "family_id": f"family-{family}", "domain": "fixture", "trial": trial, "seed": trial, "arm": arm})
                results.append(TrialResult(
                    slot_id=identity, run_id=identity, status="completed", success=True,
                    latency_valid=True, latency_ms=100 if arm == "base" else 90,
                    cost_usd=0, logical_calls=2, physical_calls=2 if arm == "base" else 3,
                    revalidation_calls=0, speculative_starts=0 if arm == "base" else 2,
                    useful_speculations=0 if arm == "base" else 1,
                    constraint_violations=0, actor_config_hash="a" * 64, memory_snapshot_hash="b" * 64,
                ))
    design = TrialDesign(label="deterministic unit fixture, not benchmark performance", measurement_kind="deterministic_integration", source_commit="fixture", actor_config_hash="a" * 64, memory_snapshot_hash="b" * 64, frozen_before_execution=True, trials=slots)
    return design, results


def test_paired_differences_and_denominators():
    design, rows = experiment()
    report = report_trials(design, rows)
    assert report["measurement_kind"] == "deterministic_integration"
    assert report["arms"]["base"]["pass1"] == 1
    assert report["arms"]["base"]["two_trial_consistency"] == 1
    assert report["arms"]["base"]["latency_samples"] == 4
    assert report["arms"]["acephale"]["physical_call_amplification"] == 1.5
    latency = report["paired_comparisons"][0]["metrics"]["latency_ms_difference"]
    assert latency["estimate"] == -10
    assert latency["families"] == 2
    assert latency["paired_trials"] == 4
    assert latency["ci95"] == [-10, -10]
    assert report["paired_comparisons"][2]["metrics"]["latency_ms_difference"]["estimate"] == 0
    assert report["paired_comparisons"][0]["metrics"]["logical_calls_difference"]["estimate"] == 0
    assert report["paired_comparisons"][0]["metrics"]["physical_calls_difference"]["estimate"] == 1


def test_failed_unstarted_and_unknown_telemetry_stay_in_denominator():
    design, rows = experiment()
    rows[0] = rows[0].model_copy(update={"status": "not_started", "success": False, "latency_valid": False, "latency_ms": None, "cost_usd": None, "physical_calls": None})
    report = report_trials(design, rows)
    base = report["arms"]["base"]
    assert base["scheduled_trials"] == 4
    assert base["pass1"] == .75
    assert base["unknown_cost_trials"] == 1
    assert base["physical_call_amplification"] is None
    assert base["latency_samples"] == 3
    assert report["paired_comparisons"][0]["metrics"]["latency_ms_difference"]["paired_trials"] == 3


def test_report_rejects_missing_slots_duplicate_runs_and_changed_freeze():
    design, rows = experiment()
    with pytest.raises(ValueError, match="every declared"):
        report_trials(design, rows[:-1])
    with pytest.raises(ValueError, match="Physical run reused"):
        report_trials(design, [rows[0].model_copy(update={"run_id": rows[1].run_id}), *rows[1:]])
    with pytest.raises(ValueError, match="configuration"):
        report_trials(design, [rows[0].model_copy(update={"actor_config_hash": "c" * 64}), *rows[1:]])


def test_design_rejects_unpaired_blocks():
    design, _ = experiment()
    with pytest.raises(ValueError, match="complete"):
        TrialDesign.model_validate({**design.model_dump(), "trials": design.model_dump()["trials"][:-1]})


def test_exploratory_report_preserves_machine_review_identity():
    design, rows = experiment()
    metadata = {"reviewProtocol": "machine_audited_exploratory", "humanReviewCount": 0,
        "machineReviewCount": 20, "machineAuditHash": "d" * 64,
        "reviewerModel": "gpt-5.4-2026-03-05", "reviewIndependence": "separate_request_and_prompt_same_model"}
    design = TrialDesign.model_validate({**design.model_dump(), "annotation_review": metadata})
    report = report_trials(design, rows)
    assert report["annotationReview"] == metadata
    assert any("zero human reviews" in item for item in report["limitations"])
    with pytest.raises(ValueError, match="zero-human"):
        TrialDesign.model_validate({**design.model_dump(), "annotation_review": {**metadata, "humanReviewCount": False}})


def test_result_cannot_claim_success_when_budget_terminated():
    _, rows = experiment()
    with pytest.raises(ValueError, match="remain failures"):
        TrialResult.model_validate({**rows[0].model_dump(), "status": "budget_terminated"})


def test_prediction_scores_are_exact_universe_not_tool_accuracy():
    pool = [hash_v1({"tool": "get", "arguments": {"id": "a"}}), hash_v1({"tool": "get", "arguments": {"id": "b"}})]
    base = {"checkpoint_id": "cp", "candidate_universe": pool, "pool_hash": hash_v1(sorted(pool)), "actual": pool[1]}
    rows = [
        {**base, "condition": "neutral", "probabilities": {pool[0]: .6, pool[1]: .2, "NO_READ": .1, "READ_UNCOVERED": .1}},
        {**base, "condition": "goal", "probabilities": {pool[0]: .2, pool[1]: .6, "NO_READ": .1, "READ_UNCOVERED": .1}},
    ]
    result = score_predictions(rows)
    assert result["identical_candidate_pools"]
    assert result["conditions"]["neutral"]["exact_top1"] == 0
    assert result["conditions"]["goal"]["exact_top1"] == 1
    assert result["conditions"]["neutral"]["declared_universe_cross_entropy_nats"] > result["conditions"]["goal"]["declared_universe_cross_entropy_nats"]


def test_uncovered_target_not_counted_as_exact_match():
    result = score_predictions([{"condition": "test", "checkpoint_id": "cp", "candidate_universe": [], "pool_hash": hash_v1([]), "actual": "missing-invocation", "probabilities": {"NO_READ": .1, "READ_UNCOVERED": .9}}])
    assert result["conditions"]["test"]["coverage_including_no_read"] == 0
    assert result["conditions"]["test"]["exact_top1"] == 0
    assert result["conditions"]["test"]["declared_universe_cross_entropy_nats"] < .2


def test_probability_or_pool_corruption_fails_closed():
    row = {"condition": "test", "checkpoint_id": "cp", "candidate_universe": [], "pool_hash": hash_v1([]), "actual": "NO_READ", "probabilities": {"NO_READ": .1, "READ_UNCOVERED": .1}}
    with pytest.raises(ValueError, match="distribution"):
        score_predictions([row])
    row["probabilities"]["NO_READ"] = .9
    row["pool_hash"] = "0" * 64
    with pytest.raises(ValueError, match="pool hash"):
        score_predictions([row])


def panel_rows():
    rows = []
    for index in range(2):
        for condition in ("neutral", "goal"):
            rows.append({"condition": condition, "checkpoint_id": f"cp-{index}", "family_id": f"family-{index}", "split": "test",
                         "probability_semantics": "independent_next_batch_hit", "candidate_panel": ["a", "b", "c"],
                         "panel_hash": hash_v1(["a", "b", "c"]), "actual_reads": ["a", "b", "outside-pool"],
                         "status": "completed", "probabilities": {"a": .9, "b": .8, "c": .1} if condition == "goal" else {"a": .2, "b": .1, "c": .8}})
    return rows


def test_fixed_panel_scores_all_next_batch_hits_as_independent_marginals():
    report = score_candidate_panels(panel_rows(), bootstrap_samples=100)
    goal, neutral = report["conditions"]["goal"], report["conditions"]["neutral"]
    assert goal["binary_log_loss_nats"] < neutral["binary_log_loss_nats"]
    assert goal["brier"] < neutral["brier"]
    assert goal["candidate_panel_any_hit_coverage"] == 1
    assert goal["exact_top1_any_hit_over_declared_eligible"] == 1
    assert neutral["exact_top1_any_hit_over_declared_eligible"] == 0
    assert report["test_partition_only"] is True
    assert report["heldout_claim"] is False
    assert report["paired_comparisons"][0]["metrics"]["binary_log_loss_nats_difference"]["families"] == 2
    assert "not full-action" in report["interpretation"]


def test_binary_panel_reports_conditional_raw_scores_and_rejects_relabelling():
    rows = panel_rows()
    for row in rows:
        row.update(probability_semantics="next_batch_invocation_membership", raw_score_semantics="autoregressive_binary_conditional")
    report = score_candidate_panels(rows, bootstrap_samples=100)
    assert report["schema_version"] == "acephale-fixed-panel-report-v3"
    assert report["raw_score_semantics"] == "autoregressive_binary_conditional"
    rows[0]["probability_semantics"] = "independent_next_batch_hit"
    with pytest.raises(ValueError, match="semantics"):
        score_candidate_panels(rows)


@pytest.mark.parametrize("defect", ["missing_score", "different_panel", "different_labels", "missing_checkpoint", "nan", "first_call", "family_split"])
def test_fixed_panel_comparisons_fail_closed_on_noncomparable_outputs(defect):
    rows = panel_rows()
    if defect == "missing_score":
        del rows[0]["probabilities"]["c"]
    elif defect == "different_panel":
        rows[0]["candidate_panel"] = ["a", "b"]
        rows[0]["panel_hash"] = hash_v1(["a", "b"])
        del rows[0]["probabilities"]["c"]
    elif defect == "different_labels":
        rows[0]["actual_reads"] = ["a"]
    elif defect == "missing_checkpoint":
        rows.pop()
    elif defect == "nan":
        rows[0]["probabilities"]["a"] = float("nan")
    elif defect == "first_call":
        rows[0]["probability_semantics"] = "first_call"
    else:
        rows[1]["split"] = "train"
    with pytest.raises(ValueError):
        score_candidate_panels(rows)


def test_fixed_panel_failure_retained_without_log_loss_imputation():
    rows = panel_rows()
    rows[0].update(status="failed", probabilities=None)
    report = score_candidate_panels(rows, bootstrap_samples=100)
    neutral = report["conditions"]["neutral"]
    assert neutral["declared_checkpoints"] == 2 and neutral["scored_checkpoints"] == 1
    assert neutral["status_counts"]["failed"] == 1
    assert report["paired_comparisons"][0]["metrics"]["brier_difference"]["paired_trials"] == 1


def test_empty_panels_and_no_read_batches_have_explicit_denominators():
    rows = panel_rows()
    for row in rows:
        row.update(candidate_panel=[], panel_hash=hash_v1([]), probabilities={}, actual_reads=[])
    report = score_candidate_panels(rows)
    assert report["conditions"]["goal"]["binary_log_loss_nats"] is None
    assert report["conditions"]["goal"]["candidate_panel_any_hit_coverage"] is None
    assert report["conditions"]["goal"]["no_read_checkpoints"] == 2
