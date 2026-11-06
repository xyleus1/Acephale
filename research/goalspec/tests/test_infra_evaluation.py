from __future__ import annotations

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_evaluation import (
    ARMS,
    TrialDesign,
    TrialResult,
    report_trials,
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
    assert report["arms"]["goalspec"]["physical_call_amplification"] == 1.5
    latency = report["paired_comparisons"][0]["metrics"]["latency_ms_difference"]
    assert latency["estimate"] == -10
    assert latency["families"] == 2
    assert latency["paired_trials"] == 4
    assert latency["ci95"] == [-10, -10]
    assert report["paired_comparisons"][2]["metrics"]["latency_ms_difference"]["estimate"] == 0


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
