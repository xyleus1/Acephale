import json

import pytest

from goalspec.evaluation_v1 import TrialResult, publish_live_report, summarize_live
from goalspec.live_design import ARMS


def cohort():
    return [TrialResult(
        experimentId="unit-test", snapshotId="frozen-unit-test", familyId=f"{domain}:{family}",
        domain=domain, taskId=f"{domain}:{family}:{variant}", variant=variant,
        trial=trial, seed=trial, arm=arm,
        success=arm != "base" or trial == 0, constraintViolations=0, termination="completed",
        latencyMs=100 if arm == "base" else 90, billedUsd=.01,
        authoritativeCalls=3, speculativeCalls=0 if arm == "base" else 2,
        usefulCalls=0 if arm == "base" else 1, wastedCalls=0 if arm == "base" else 1,
        rejectedCalls=0, cancelledCalls=0, revalidationCalls=0 if arm == "base" else 2,
    ) for domain in ("retail", "airline") for family in range(2)
        for variant in range(2) for trial in range(2) for arm in ARMS]


def test_live_denominators_consistency_cost_and_family_paired_intervals():
    result = summarize_live(cohort(), bootstrap_samples=100)
    base = result["arms"]["base"]
    full = result["arms"]["goalspec"]
    assert base["nativeSuccess"] == .5
    assert base["pass1"] == .5
    assert base["twoTrialConsistency"]["bothSucceed"] == 0
    assert full["twoTrialConsistency"]["bothSucceed"] == 1
    assert base["authoritativeCallsPerSuccessfulTask"] == 6
    assert full["physicalCallsPerSuccessfulTask"] == 7
    assert full["speculationHitRate"] == .5
    assert base["latency"]["measuredTrials"] == 16
    assert base["billedUsd"]["sum"] == pytest.approx(.16)
    improvement = next(value for value in result["pairedDifferences"]
                       if value["baseline"] == "base" and value["treatment"] == "goalspec" and value["metric"] == "success")
    assert improvement["families"] == 4
    assert improvement["estimate"] == .5
    assert improvement["ci95"] == [.5, .5]


def test_rejects_incomplete_pairs_duplicate_seeds_and_budget_success():
    values = cohort()
    with pytest.raises(ValueError, match="complete three-arm"):
        summarize_live(values[:-1], bootstrap_samples=100)
    with pytest.raises(ValueError, match="Duplicate"):
        summarize_live(values + values[:1], bootstrap_samples=100)
    values[0] = values[0].model_copy(update={"seed": 999})
    with pytest.raises(ValueError, match="share seed"):
        summarize_live(values, bootstrap_samples=100)
    with pytest.raises(ValueError, match="budget terminations"):
        TrialResult.model_validate({**cohort()[0].model_dump(), "termination": "budget_exhausted", "success": True})


def test_missing_telemetry_stays_unmeasured_and_small_clusters_no_interval():
    rows = [row.model_copy(update={"latencyMs": None, "revalidationCalls": None})
            for row in cohort() if row.familyId.endswith(":0")]
    result = summarize_live(rows, bootstrap_samples=100)
    assert result["arms"]["base"]["latency"]["mean"] is None
    assert result["arms"]["goalspec"]["physicalCallsPerSuccessfulTask"] is None
    assert result["arms"]["base"]["successInterval"]["ci95"] is None


def test_design_hash_and_report_are_immutable(tmp_path):
    rows = cohort()
    design = [{"family": r.familyId, "variant": r.variant, "trial": r.trial,
               "arm": r.arm, "seed": r.seed} for r in rows]
    output = tmp_path / "report"
    result = publish_live_report(rows, output, expected=design, bootstrap_samples=100)
    assert result["designVerified"]
    manifest = json.loads((output / "manifest.json").read_text())
    assert len(manifest["designHash"]) == 64
    with pytest.raises(FileExistsError):
        publish_live_report(rows, output, expected=design, bootstrap_samples=100)
    design[0]["seed"] = 123
    with pytest.raises(ValueError, match="seed differs"):
        summarize_live(rows, expected=design, bootstrap_samples=100)
