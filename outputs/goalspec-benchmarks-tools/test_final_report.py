"""Small synthetic integrity tests; no benchmark outcomes or provider access."""
import copy
import json
from pathlib import Path

import pytest

import final_report as report


def metric(value=1, denominator=14):
    return {"estimate": value, "lower": value, "upper": value,
            "numerator": round(value * denominator), "denominator": denominator}


def summary(tasks):
    trials = 2 * tasks
    distribution = {"n": trials, "missing": 0, "mean": 2, "p95": 3}
    return {"trials": trials, "tasks": tasks, "successes": trials, "failures": 0,
            "twoTrialConsistency": {"eligibleTasks": tasks, "bothSucceeded": tasks},
            "metrics": {key: metric() for key in ("successRate", "bothTrialsSuccessRate", "nativeToolNonErrorRate", "goldToolNameRecall", "goldFullArgumentsRecall")},
            "timingSeconds": {key: distribution for key in ("totalTrialSeconds", "serviceDrainSeconds", "evaluationSeconds")},
            "counts": {key: {"sum": trials} for key in ("authoritativeCalls", "speculativeCalls")},
            "physicalCallsPerSuccess": {"measuredTrials": trials, "missingTrials": 0, "estimate": 2},
            "physicalNativeToolAttemptsFromTimings": 2 * trials, "consumedPromotionReceipts": 0,
            "nativeAssertionAudit": {"requiredAssertionTrials": 2, "missingRequiredAssertions": 0},
            "cost": {"knownUsageSubtotalUsd": 1}}


def inputs():
    selected = {domain: list(map(str, range(7))) for domain in ("retail", "airline")}
    rows = [{"runId": f"{domain}-{task}-{trial}-{arm}", "domain": domain, "taskId": task, "trial": trial,
             "seed": 20260916 + trial, "arm": arm, "success": True, "officialReward": 1, "nativeTermination": "user_stop"}
            for domain, tasks in selected.items() for task in tasks for trial in range(2) for arm in report.ARMS]
    tau = {"version": "official-tau-v4-report-v1", "trials": rows,
           "benchmark": {"selection": {"selectedByDomain": selected, "upstreamRevision": "a" * 40,
               "models": {"actor": "gpt-5.4-2026-03-05", "actorReasoning": "medium", "actorOutputCap": 4096, "userSimulator": "gpt-4.1-mini-2025-04-14"},
               "excludedIdsByDomain": {domain: list(map(str, range(20, 26))) for domain in selected},
               "historicalPublicExposure": {domain: {"tasks": 114 if domain == "retail" else 50, "selectedPreviouslyPublicExposed": ids} for domain, ids in selected.items()},
               "controllerExposure": {"frozenControllerContentHash": "c" * 64}}, "upstreamRevision": "a" * 40},
           "arms": {arm: summary(14) for arm in report.ARMS},
           "domains": {domain: {"arms": {arm: summary(7) for arm in report.ARMS}} for domain in selected},
           "service": {"startupOutsideTrialClocks": True, "judgeOutsideLiveLatency": True},
           "leaseChecks": {arm: {"refreshChecks": 0, "consumptionChecks": 0} for arm in report.ARMS},
           "label": "synthetic", "studyId": "test", "studyStage": "test", "designHash": "b" * 64,
           "method": {}, "cost": {"knownUsageSubtotalUsd": 4, "settledRecordedUsd": 3, "unknownChargeTrials": 1}, "pairedDifferences": []}
    bfcl = {"total": 64, "correct": 64, "providerRunSummary": {"closed": True, "declared": 64},
            "manifest": {"model": "gpt-5.4-2026-03-05", "reasoning": "medium", "maxOutputTokens": 4096},
            "categories": {category: {"correct": 32, "total": 32} for category in ("multiple", "irrelevance")},
            "results": [{"id": f"{category}-{i}", "category": category, "predictionStatus": "completed", "verdict": {"valid": True}}
                        for category in ("multiple", "irrelevance") for i in range(32)]}
    metrics = {name: metric(1, 3) for name in ("toolTop1", "toolTop3", "exactTop1", "exactTop3", "gatedExactTop1", "poolCoverage", "readSensitivity", "noReadSpecificity")}
    metrics["noReadSpecificity"] = metric(1, 2)
    apigen = {"version": "goalspec-apigen-controller-report-v1", "inputManifest": {"closedAt": "test", "completeDeclaredCorpus": True, "frozenControllerHash": "c" * 64},
              "checkpoints": 6, "summary": {ranker: {"checkpoints": 6, "knownActions": 5, "unknownActions": 1, "readActions": 3, "nonReadActions": 2, "metrics": metrics}
                                            for ranker in report.RANKERS},
              "pairedDifferences": {"samePoolVerified": True, "differences": {key: metric(0) for key in metrics}}}
    cpu = {"artifactHash": "c" * 64, "closedAt": "test", "providerCalls": 0, "fitting": False,
           "samples": 6, "measuredPasses": 2, "statesPerPass": 3, "perPass": [{"samples": 3}, {"samples": 3}],
           "p95Ms": 2, "p50Ms": 1, "meanMs": 1.5, "maximumMs": 3, "targetP95Ms": 10, "targetMet": True}
    budget = {"currency": "USD", "totalCeilingUsd": 500, "totalKnownUsageCostUsd": 10, "totalSpentOrReservedUsd": 12,
              "unresolvedRequests": 1, "allocations": [{"allocation": "synthetic", "ceilingUsd": 500, "knownUsageCostUsd": 10, "spentOrReservedUsd": 12, "unresolvedRequests": 1}]}
    return copy.deepcopy({"tau": tau, "bfcl": bfcl, "apigen": apigen, "cpu_initial": cpu, "cpu_isolated": cpu, "budget": budget})


def test_complete_grid_and_scope_render():
    result = report.build(inputs())
    result["sources"] = {}
    text = report.render(result)
    assert "All 112 declared trials" in text
    assert "not pristine project-wide held-out" in text
    assert "Gated exact Top-1" in text
    assert "USD 10.000" in text and "USD 12.000" in text
    assert "\u2014" not in text


def test_partial_physical_telemetry_is_not_a_complete_total():
    result = report.build(inputs())
    result["sources"] = {}
    result["tau"]["arms"]["base"]["physicalCallsPerSuccess"].update(missingTrials=1, measuredTrials=27)
    text = report.render(result)
    assert "| base | unavailable (known subtotal: 56) | 27/28 | unavailable |" in text
    assert "acknowledged per-trial actor/user drain" in text
    assert "final shared service shutdown are outside" in text
    assert "latency difference means GoalSpec is slower" in text
    assert report.difference_interval(metric(.1), True) == "10.0 pp [10.0 pp, 10.0 pp]"
    assert report.difference_interval(metric(.1)) == "0.100 s [0.100 s, 0.100 s]"


@pytest.mark.parametrize("change", ["drop", "repeat", "seed", "reward", "consistency", "domain"])
def test_native_rejects_partial_or_changed_grid(change):
    value = inputs()["tau"]
    if change == "drop":
        value["trials"].pop()
    elif change == "repeat":
        value["trials"][0] = value["trials"][1]
    elif change == "seed":
        value["trials"][0]["seed"] += 1
    elif change == "reward":
        value["trials"][0]["officialReward"] = 0
    elif change == "consistency":
        value["arms"]["base"]["twoTrialConsistency"]["bothSucceeded"] = 13
    else:
        value["domains"]["retail"]["arms"]["base"]["successes"] = 13
    with pytest.raises(ValueError):
        report.validate_tau(value)


def test_bfcl_failures_must_remain_in_denominator():
    value = inputs()["bfcl"]
    value["results"][0]["predictionStatus"] = "failed"
    with pytest.raises(ValueError, match="cannot score correct"):
        report.validate_bfcl(value)


def test_apigen_rejects_dropped_unknowns_and_unmatched_pool():
    value = inputs()["apigen"]
    value["summary"]["current-prior"]["unknownActions"] = 0
    with pytest.raises(ValueError, match="coverage"):
        report.validate_apigen(value)
    value = inputs()["apigen"]
    value["pairedDifferences"]["samePoolVerified"] = False
    with pytest.raises(ValueError, match="identical"):
        report.validate_apigen(value)


def test_cpu_rejects_selected_samples():
    value = inputs()
    value["cpu_isolated"]["samples"] = 3
    with pytest.raises(ValueError, match="dropped samples"):
        report.validate_cpu(value["cpu_initial"], value["cpu_isolated"], "c" * 64)


def test_budget_does_not_add_known_to_reserved():
    value = inputs()["budget"]
    report.validate_budget(value)
    value["totalSpentOrReservedUsd"] += value["totalKnownUsageCostUsd"]
    with pytest.raises(ValueError, match="Reserved budget subtotal"):
        report.validate_budget(value)


def write_inputs(root):
    data = inputs()
    paths = {}
    for name, value in data.items():
        directory = root / "inputs" / name
        directory.mkdir(parents=True)
        if name == "cpu_isolated":
            samples = directory / "samples.jsonl"
            samples.write_text("{}\n" * 6, encoding="utf-8")
            value["samplesSha256"] = report.sha256(samples)
        path = directory / "report.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        paths[name] = path
    paths["tau"].with_name("manifest.json").write_text(json.dumps({"outputs": {"report.json": report.sha256(paths["tau"])}}), encoding="utf-8")
    paths["apigen"].with_name("manifest.json").write_text(json.dumps(data["apigen"]["inputManifest"]), encoding="utf-8")
    return paths


def test_immutable_outputs_and_hashes(tmp_path):
    paths = write_inputs(tmp_path)
    output = tmp_path / "final"
    manifest = report.generate(paths, output)
    assert set(manifest["outputs"]) == {"README.md", "report.json", "metrics.csv"}
    assert all(report.sha256(output / name) == digest for name, digest in manifest["outputs"].items())
    with pytest.raises(ValueError, match="already exists"):
        report.generate(paths, output)


def test_rejects_changed_native_report_before_writing(tmp_path):
    paths = write_inputs(tmp_path)
    with paths["tau"].open("a", encoding="utf-8") as stream:
        stream.write("\n")
    output = tmp_path / "final"
    with pytest.raises(ValueError, match="manifest"):
        report.generate(paths, output)
    assert not output.exists()
