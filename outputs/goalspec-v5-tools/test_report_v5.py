import copy
import importlib.util
from collections import defaultdict
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("report_v5", Path(__file__).with_name("report_v5.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def stage():
    trials = [{"family": f"{domain}:family", "domain": domain, "taskId": domain, "variant": 0, "trial": repeat,
        "seed": repeat + 10, "arm": arm, "reserved_usd": 1.25} for domain in ("retail", "airline") for repeat in (0, 1)
        for arm in ("base", "v4", "goalspec")]
    design = {"studyId": "synthetic-v5-report", "studyStage": "confirmation", "label": "selected official tau3 subset",
        "trials": trials, "models": {"actor": "gpt-5.4-2026-03-05"}}
    design["designHash"] = MODULE.digest(design)
    rows = []
    for index, trial in enumerate(trials):
        run_id = f"v5-{MODULE.digest(design['studyId'])[:10]}-confirmation-{index:04d}-{MODULE.digest([design['designHash'], trial])[:12]}"
        rows.append({**trial, "runId": run_id, "studyId": design["studyId"], "studyStage": "confirmation",
            "success": trial["arm"] != "base", "budget_terminated": False, "termination": "user_stop", "serviceDrainSucceeded": True,
            "totalTrialSeconds": 11 if trial["arm"] == "goalspec" else 10, "nativeOrchestrationSeconds": 9, "serviceDrainSeconds": 1,
            "evaluationSeconds": 1, "totalIncludingEvaluationSeconds": 12, "latencyMs": 9000, "nativeToolTimings": [],
            "authoritativeCalls": 3, "speculativeCalls": 1, "physicalCalls": 4, "usefulCalls": 1, "unpromotedCalls": 0,
            "freshnessChecks": 1, "consumptionLeaseChecks": 1, "recordedLeaseChecks": 2, "revalidationCalls": 0,
            "rejectedCalls": 0, "cancelledCalls": 0, "toolResponses": 4, "toolErrorResponses": 0, "constraintViolations": 0,
            "billedUsd": .1, "knownUsageSubtotalUsd": .1, "reservedUsd": 1.25, "unknownProviderCharge": False})
    return {"rows": rows, "design": design, "events": defaultdict(list), "manifest": {"v5Configuration": {"actorContext": "none"}},
        "summary": {}, "eventAudit": None}


def test_exact_grid_and_budget_failure_cannot_be_hidden():
    value = stage()
    MODULE.verify_grid(value["design"], value["rows"])
    with pytest.raises(ValueError, match="exactly once"):
        MODULE.verify_grid(value["design"], value["rows"][:-1])
    changed = copy.deepcopy(value["rows"])
    changed[-1]["budget_terminated"] = True
    with pytest.raises(ValueError, match="Success cannot hide"):
        MODULE.verify_grid(value["design"], changed)


def test_family_paired_differences_two_trial_consistency_and_signs():
    report = MODULE.analyze(stage(), samples=100)
    assert report["arms"]["goalspec"]["successes"] == 4
    assert report["arms"]["goalspec"]["twoTrialConsistency"]["bothSucceeded"] == 2
    paired = report["paired"]["goalspec-minus-base"]
    assert paired["families"] == 2 and paired["matchedTrials"] == 4
    assert paired["differences"]["pass1"]["estimate"] == 1
    assert paired["differences"]["liveTotalMeanSeconds"]["estimate"] == 1
    assert paired["differences"]["pass1"]["degenerateInterval"] is True
    assert "frozen v4" in report["arms"]["v4"]["description"].lower()


def test_failed_trials_stay_in_call_per_success_denominator_and_missing_calls_are_not_zero():
    value = stage()
    gs = [row for row in value["rows"] if row["arm"] == "goalspec"]
    gs[0]["success"] = False
    report = MODULE.analyze(value, samples=100)
    assert report["arms"]["goalspec"]["physicalCallsPerSuccessfulTrial"]["estimate"] == 16 / 3
    gs[0]["physicalCalls"] = None
    report = MODULE.analyze(value, samples=100)
    counts = report["arms"]["goalspec"]["physicalCallsPerSuccessfulTrial"]
    assert counts["estimate"] is None and counts["knownAttempts"] == 12 and counts["missingTrials"] == 1


def test_unknown_cost_is_distinct_from_observed_response_subtotal():
    value = stage()
    value["rows"][-1].update(billedUsd=None, unknownProviderCharge=True, knownUsageSubtotalUsd=.03)
    report = MODULE.analyze(value, samples=100)
    cost = report["arms"]["goalspec"]["cost"]
    assert cost["unknownChargeTrials"] == 1 and cost["recordedTotalUsd"] is None
    assert cost["knownUsageSubtotalUsd"] == pytest.approx(.33)
    assert cost["reservationBoundUsd"] == pytest.approx(1.55)


def test_provider_roles_tokens_and_failed_attempts_have_explicit_missing_usage():
    result = MODULE.provider_summary([
        {"type": "model_attempt", "id": "boundary:actor", "model": "actor", "usage": {"input_tokens": 100, "input_tokens_details": {"cached_tokens": 40}, "output_tokens": 10}, "costMicrodollars": 10},
        {"type": "model_attempt_failed", "id": "boundary:actor", "model": "actor"},
        {"type": "model_attempt", "id": "goal-spans:run:0", "model": "mini", "usage": {"input_tokens": 20, "output_tokens": 5}}])
    assert result["actor"]["physicalProviderAttempts"] == 2 and result["actor"]["attemptsWithoutUsage"] == 1
    assert result["actor"]["tokensKnownSubtotal"]["cachedInput"] == 40
    assert result["goal"]["tokensKnownSubtotal"]["input"] == 20


def test_host_interruption_preserves_raw_clocks_and_failure_denominator():
    value = stage()
    gs = [row for row in value["rows"] if row["arm"] == "goalspec"]
    gs[0].update(success=False, termination="host_interruption", hostInterrupted=True, measuredTimingValid=False,
        totalTrialSeconds=999, nativeOrchestrationSeconds=998, serviceDrainSeconds=1, evaluationSeconds=777,
        totalIncludingEvaluationSeconds=1776, latencyMs=998000,
        hostHealthSamples=[{"phase": "after_trial", "healthy": False}],
        nativeToolTimings=[{"operation": "authoritative_tool", "isRead": True, "durationMs": 600000}])
    MODULE.verify_grid(value["design"], value["rows"])
    original = copy.deepcopy(value)
    report = MODULE.analyze(value, samples=100)
    arm = report["arms"]["goalspec"]
    assert arm["successes"] == 3 and arm["trials"] == 4 and arm["metrics"]["pass1"]["estimate"] == .75
    assert arm["metrics"]["liveTotalMeanSeconds"]["estimate"] == 11
    assert arm["timingSeconds"]["totalTrialSeconds"]["n"] == 3
    assert arm["timingSeconds"]["totalTrialSeconds"]["missing"] == 1
    assert arm["timingSeconds"]["evaluationSeconds"]["mean"] == 1
    assert arm["rawTimingSeconds"]["totalTrialSeconds"]["mean"] == (999 + 33) / 4
    assert arm["timingQuality"]["explicitlyInvalidTimingTrials"] == 1
    assert arm["authoritativeReadMilliseconds"]["n"] == 0
    assert arm["counts"]["physicalCalls"]["knownSum"] == 16
    assert report["paired"]["goalspec-minus-base"]["matchedTrials"] == 4
    assert report["paired"]["goalspec-minus-base"]["pairedMeasuredLatencyTrials"] == 3
    assert report["paired"]["goalspec-minus-base"]["differences"]["liveTotalMeanSeconds"]["estimate"] == 1
    retained = next(row for row in report["trials"] if row["runId"] == gs[0]["runId"])
    assert retained["rawTiming"]["totalTrialSeconds"] == 999 and retained["totalTrialSeconds"] is None
    assert retained["rawTiming"]["nativeToolTimings"][0]["durationMs"] == 600000
    assert retained["hostHealthSamples"] == gs[0]["hostHealthSamples"]
    assert value == original


def test_all_explicitly_invalid_clocks_are_unavailable_without_dropping_trials():
    value = stage()
    for row in value["rows"]:
        row.update(measuredTimingValid=False, hostInterrupted=False)
    report = MODULE.analyze(value, samples=100)
    for arm in report["arms"].values():
        assert arm["trials"] == 4
        assert arm["metrics"]["liveTotalMeanSeconds"]["estimate"] is None
        assert arm["timingQuality"]["primaryLiveMissingTrials"] == 4
        assert arm["timingQuality"]["hostInterruptedTrials"] == 0
        assert arm["timingQuality"]["explicitlyInvalidTimingTrials"] == 4
    assert report["paired"]["goalspec-minus-base"]["pairedMeasuredLatencyTrials"] == 0
    assert report["paired"]["goalspec-minus-base"]["differences"]["pass1"]["estimate"] == 1


def test_host_interruption_cannot_be_declared_successful():
    value = stage()
    value["rows"][-1]["hostInterrupted"] = True
    with pytest.raises(ValueError, match="Success cannot hide"):
        MODULE.verify_grid(value["design"], value["rows"])
