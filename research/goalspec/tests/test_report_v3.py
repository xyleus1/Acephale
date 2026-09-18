import hashlib
import json
from pathlib import Path

import pytest
import rfc8785

from goalspec.report_v3 import (
    ARMS,
    analyze_stage,
    assertion_audit,
    cluster_interval,
    file_hash,
    gold_recall,
    load_stage,
    summarize_events,
    write_report,
)


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def event_log(path, events, manifest, *, aborted=False):
    payloads = [{"type": "research_manifest", "manifestHash": hashlib.sha256(rfc8785.dumps(manifest)).hexdigest(),
                 "runs": [{"id": run["runId"], "arm": run["arm"]} for run in manifest["runs"]]},
                *events, {"type": "service_closed", "aborted": aborted}]
    previous, records = "0" * 64, []
    for sequence, event in enumerate(payloads):
        body = {"event": event, "sequence": sequence, "previousHash": previous, "recordedAtUnixMs": 1000 + sequence}
        digest = hashlib.sha256(rfc8785.dumps(body)).hexdigest()
        records.append({"body": body, "hash": digest})
        previous = digest
    path.write_bytes(b"".join(rfc8785.dumps(record) + b"\n" for record in records))
    return records


def cohort(tmp_path):
    directory = tmp_path / "closed"
    directory.mkdir()
    rows = []
    trials = []
    for task in range(3):
        for arm in ARMS:
            for trial in range(2):
                successful = arm == "goalspec" or (arm == "base" and trial == 0)
                run_id = f"run-{task}-{arm}-{trial}"
                row = {"runId": run_id, "domain": "retail", "taskId": str(task), "arm": arm,
                       "trial": trial, "seed": 100 + task * 2 + trial, "success": successful,
                       "officialReward": int(successful), "termination": "user_stop",
                       "nativeOrchestrationSeconds": 2 + trial, "serviceDrainSeconds": .1,
                       "totalTrialSeconds": 2.1 + trial, "evaluationSeconds": 7,
                       "totalIncludingEvaluationSeconds": 9.1 + trial,
                       "nativeToolResponses": 2, "nativeToolErrorResponses": 1,
                       "authoritativeCalls": 2, "speculativeCalls": 1, "usefulCalls": 1,
                       "wastedCalls": 0, "freshnessChecks": 2, "revalidationCalls": 0,
                       "reservedUsd": 2.5, "billedUsd": .1, "knownUsageSubtotalUsd": .1,
                       "unknownProviderCharge": False, "knownEvaluatorUsageUsd": .03,
                       "unknownEvaluatorCharge": False, "judgeAssertionCoverage": True,
                       "constraintStatus": "passed_evaluated_assertions", "constraintViolations": 0}
                if task == 2 and arm == "goalspec" and trial == 1:
                    row.update(success=False, officialReward=None, termination="execution_error",
                               nativeOrchestrationSeconds=None, totalTrialSeconds=None,
                               billedUsd=None, unknownProviderCharge=True)
                artifact = {"record": row, "officialTask": {"evaluation_criteria": {"actions": [
                    {"name": "lookup", "arguments": {"id": "42"}},
                    {"name": "lookup", "arguments": {"id": "42"}},
                    {"requestor": "user", "name": "other", "arguments": {}},
                ]}}, "simulation": {"messages": [{"role": "assistant", "tool_calls": [
                    {"id": "call-1", "name": "lookup", "arguments": {"id": "42"}},
                    {"id": "call-2", "name": "lookup", "arguments": {"id": "wrong"}},
                ]}]}, "promotionEvents": [{"call_id": "call-1", "status": "consumed"}],
                    "nativeToolTimings": [{"operation": "authoritative_tool", "tool": "lookup", "isRead": True, "durationMs": .2},
                                          {"operation": "speculative_native_tool", "tool": "lookup", "isRead": True, "durationMs": .3},
                                          {"operation": "speculative_snapshot_wrapper", "tool": "lookup", "isRead": True, "durationMs": 7}]}
                write(directory / f"{run_id}.json", artifact)
                rows.append(row)
                trials.append({key: row[key] for key in ("domain", "taskId", "arm", "trial", "seed")})
    write(directory / "design.json", {"trials": trials, "designHash": "design"})
    write(directory / "service-manifest.json", {"runs": [{"runId": row["runId"], "arm": row["arm"]} for row in rows]})
    write(directory / "summary.json", {"studyId": "fixture", "studyStage": "development-1",
                                       "serviceExitCode": 0, "label": "official task fixture",
                                       "serviceStartupSeconds": 12, "startupOutsideTrialClocks": True,
                                       "judgeOutsideLiveLatency": True})
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return directory


def test_gold_recall_preserves_duplicate_actions_and_is_stricter_than_compare_args():
    artifact = {"officialTask": {"evaluation_criteria": {"actions": [
        {"name": "get", "arguments": {"id": 1}, "compare_args": []},
        {"name": "get", "arguments": {"id": 1}},
        {"name": "get", "arguments": {"id": 2}, "requestor": "user"},
    ]}}, "simulation": {"messages": [{"role": "assistant", "tool_calls": [
        {"name": "get", "arguments": {"id": 1.0}}, {"name": "get", "arguments": {"id": 3}},
    ]}]}}
    result = gold_recall(artifact)
    assert result["goldActions"] == 2
    assert result["toolNameMatches"] == 2
    assert result["fullArgumentsMatches"] == 1
    assert gold_recall({})["goldActions"] is None
    artifact["officialTask"]["evaluation_criteria"]["actions"] = []
    assert gold_recall(artifact)["goldActions"] == 0


def test_reports_failures_missing_latency_and_nonadditive_unknown_reserves(tmp_path):
    result = analyze_stage(cohort(tmp_path), samples=200)
    data = result["arms"]["goalspec"]
    assert data["trials"] == 6
    assert data["successes"] == 5
    assert data["failures"] == 1
    assert data["metrics"]["successRate"]["estimate"] == 5 / 6
    assert data["metrics"]["bothTrialsSuccessRate"]["estimate"] == 2 / 3
    assert data["metrics"]["nativeToolNonErrorRate"]["estimate"] == .5
    assert data["metrics"]["goldFullArgumentsRecall"]["estimate"] == .5
    assert data["timingSeconds"]["totalTrialSeconds"]["n"] == 5
    assert data["timingSeconds"]["totalTrialSeconds"]["missing"] == 1
    assert data["timingSeconds"]["evaluationSeconds"]["mean"] == 7
    assert result["service"]["serviceStartupSeconds"] == 12
    assert data["cost"]["unknownChargeTrials"] == 1
    assert data["cost"]["knownUsageSubtotalUsd"] == pytest.approx(.6)
    assert data["cost"]["retainedTrialAllowanceMaximumUsd"] == 2.5
    assert data["cost"]["spentOrReservedTrialEstimateUsd"] == pytest.approx(3)
    assert data["physicalNativeToolAttemptsFromTimings"] == 12
    assert data["nativeToolTimingMilliseconds"]["speculative_snapshot_wrapper"]["n"] == 6
    assert data["consumedPromotionReceipts"] == 6
    assert data["promotionCountDiscrepancies"] == []
    assert data["nativeAssertionAudit"]["judgeCoverageTrue"] == 6
    assert data["nativeAssertionAudit"]["failedAssertions"] == 0
    difference = next(c for c in result["pairedDifferences"] if c["treatment"] == "goalspec" and c["control"] == "base" and c["metric"] == "successRate")
    assert difference["estimate"] == pytest.approx(1 / 3)
    assert difference["clusters"] == 3
    assert difference["bootstrapSamplesUsed"] == 200
    timing_difference = next(c for c in result["pairedDifferences"] if c["treatment"] == "goalspec" and c["control"] == "base" and c["metric"] == "liveTotalMeanSeconds")
    assert timing_difference["estimate"] == 0
    assert timing_difference["matchedTrials"] == 5


def test_bootstrap_resamples_tasks_jointly_and_reports_small_cluster_limits():
    pairs = [(1, 2), (0, 2), (2, 2)]
    difference = cluster_interval(pairs, 200, 5, controls=pairs)
    assert difference["estimate"] == difference["lower"] == difference["upper"] == 0
    assert cluster_interval(pairs, 200, 5) == cluster_interval(pairs, 200, 5)
    assert cluster_interval([(1, 1)], 200, 5)["lower"] is None
    assert cluster_interval([], 200, 5)["estimate"] is None


def test_unpaired_seeds_are_explicit_and_do_not_enter_paired_intervals(tmp_path):
    directory = cohort(tmp_path)
    rows = [json.loads(line) for line in (directory / "outcomes.jsonl").read_text().splitlines()]
    changed = next(row for row in rows if row["arm"] == "base" and row["taskId"] == "0")
    changed["seed"] = 999
    path = directory / f"{changed['runId']}.json"
    artifact = json.loads(path.read_text())
    artifact["record"] = changed
    write(path, artifact)
    design = json.loads((directory / "design.json").read_text())
    next(trial for trial in design["trials"] if trial["arm"] == "base" and trial["taskId"] == "0")["seed"] = 999
    write(directory / "design.json", design)
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    report = analyze_stage(directory, samples=100)
    comparison = next(c for c in report["pairedDifferences"] if c["control"] == "base" and c["treatment"] == "goalspec" and c["metric"] == "successRate")
    assert comparison["pairedTasks"] == 2
    assert comparison["excludedUnpairedTasks"] == [{"domain": "retail", "taskId": "0"}]
    assert report["arms"]["base"]["trials"] == 6


def test_no_task_artifacts_are_read_for_incomplete_or_mismatched_outcomes(tmp_path):
    directory = cohort(tmp_path)
    lines = (directory / "outcomes.jsonl").read_text().splitlines()
    (directory / "outcomes.jsonl").write_text("\n".join(lines[:-1]) + "\n")
    for path in directory.glob("run-*.json"):
        path.write_text("must not be parsed as task content")
    with pytest.raises(ValueError, match="every declared outcome"):
        load_stage(directory)


def test_stage_abort_uses_matching_suffix_and_requires_closed_cohort_receipt(tmp_path):
    directory = cohort(tmp_path)
    rows = [json.loads(line) for line in (directory / "outcomes.jsonl").read_text().splitlines()]
    row = rows[0]
    row.update(success=False, officialReward=None, termination="stage_abort")
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(value) + "\n" for value in rows))
    (directory / f"{row['runId']}.json").write_text("retained incomplete original must not be parsed")
    write(directory / f"{row['runId']}-stage-abort.json", {"record": row})
    with pytest.raises(FileNotFoundError):
        load_stage(directory)
    write(directory / "stage-abort.json", {"exceptionType": "RuntimeError"})
    stage = load_stage(directory)
    assert stage["rows"][0]["success"] is False
    assert stage["rows"][0]["goldDiagnostic"]["available"] is False
    assert directory / "stage-abort.json" in stage["sources"]


def test_events_separate_actor_user_evaluator_and_reject_duplicate_copies(tmp_path):
    events = []
    for identifier, kind in [("r:b:actor", "model_attempt"), ("b:user", "model_attempt"), ("b:evaluator", "model_attempt_failed")]:
        event = {"type": kind, "id": identifier, "attempt": 0, "latencyMs": 10}
        if kind == "model_attempt":
            event.update(costMicrodollars=12, usage={"input_tokens": 10, "input_tokens_details": {"cached_tokens": 4}, "output_tokens": 2})
        events.append({"runId": "r", "event": event})
    path = tmp_path / "events.jsonl"
    event_log(path, events, {"runs": [{"runId": run_id, "arm": "base"} for run_id in ("r", "missing")]})
    result, sources = summarize_events([path], {"r", "missing"})
    assert sources == [path]
    assert result["uncoveredRunIds"] == ["missing"]
    provider = result["runs"]["r"]["provider"]
    assert provider["actor"]["cachedTokens"] == 4
    assert provider["user"]["knownCostMicrodollars"] == 12
    assert provider["evaluator"]["failedRequests"] == 1
    assert provider["evaluator"]["retryAttempts"] == 0
    with pytest.raises(ValueError, match="double-count"):
        summarize_events([path, path], {"r", "missing"})


def test_assertion_coverage_uses_selected_basis_and_matches_duplicate_assertions():
    artifact = {"officialTask": {"evaluation_criteria": {"reward_basis": ["DB", "NL_ASSERTION"],
                "nl_assertions": ["first", "first", "second"]}},
                "officialRewardInfo": {"reward_basis": ["DB", "COMMUNICATE"], "nl_assertions": None}}
    audit = assertion_audit(artifact)
    assert audit["status"] == "not_selected"
    assert audit["coverageComplete"] is None
    assert audit["missingRequiredAssertions"] is None
    artifact["officialRewardInfo"]["reward_basis"] = ["DB", "NL_ASSERTION"]
    artifact["officialRewardInfo"]["nl_assertions"] = [{"nl_assertion": "first", "met": True}, {"nl_assertion": "second", "met": False}]
    audit = assertion_audit(artifact)
    assert audit["status"] == "selected_missing"
    assert audit["missingRequiredAssertions"] == 1
    artifact["officialRewardInfo"]["nl_assertions"].append({"nl_assertion": "first", "met": False})
    assert assertion_audit(artifact)["status"] == "selected_covered"
    artifact["officialTask"]["evaluation_criteria"]["nl_assertions"] = None
    assert assertion_audit(artifact)["status"] == "selected_empty"
    assert assertion_audit({})["status"] == "basis_unknown"


def test_exposed_unpromoted_reads_are_not_aggregated_as_waste(tmp_path):
    directory = cohort(tmp_path)
    path = directory / "run-0-goalspec-0.json"
    artifact = json.loads(path.read_text())
    artifact["simulation"]["messages"][0]["raw_data"] = {"goalspecVerifiedEvidence": [{"id": "evidence-1"}, {"id": "evidence-1"}]}
    write(path, artifact)
    event_path = tmp_path / "exposure-events.jsonl"
    event_log(event_path, [{"runId": "run-0-goalspec-0", "event": {"type": kind}}
                          for kind in ["exposed", "exposed", "useful", "wasted"]],
              json.loads((directory / "service-manifest.json").read_text(encoding="utf-8")))
    report = analyze_stage(directory, [event_path], samples=100)
    data = report["arms"]["goalspec"]
    audit = data["speculationAudit"]
    assert audit["distinctRecordedEvidenceIds"] == 1
    assert audit["recordedEvidenceAppearances"] == 2
    assert audit["schedulerExposedJobs"] == 2
    assert audit["schedulerPromotionHandoffs"] == 1
    assert audit["schedulerUnexposedUnconsumedWasteCandidates"] == 1
    assert audit["eventMeasuredTrials"] == 1
    assert "wastedCalls" not in data["counts"]
    assert "reportedUnpromotedCalls" in data["counts"]
    assert "actual evidence consumption is unknown" in audit["meaning"]
    assert report["arms"]["base"]["speculationAudit"]["eventMeasuredTrials"] == 0


def test_output_is_immutable_hashed_and_v2_context_is_separate(tmp_path):
    directory = cohort(tmp_path)
    historical = tmp_path / "v2"
    historical.mkdir()
    write(historical / "summary.json", {"label": "custom tau-compatible pilot", "studyStage": "confirmation"})
    (historical / "outcomes.jsonl").write_text(json.dumps({"arm": "base", "success": True, "totalTrialSeconds": 5}) + "\n")
    output = tmp_path / "report"
    result = write_report(directory, output, samples=100, v2_directory=historical)
    assert "not an official-task control" in result["historicalV2Context"]["purpose"]
    assert result["historicalV2Context"]["arms"]["base"]["successRate"] == 1
    manifest = json.loads((output / "manifest.json").read_text())
    assert len(manifest["outputs"]) == 5
    for artifact in manifest["outputs"]:
        assert file_hash(output / artifact["path"]) == artifact["sha256"]
    assert "not the full upstream benchmark" in (output / "README.md").read_text()
    assert "None" not in (output / "trials.csv").read_text()
    with pytest.raises(ValueError, match="new output"):
        write_report(directory, output, samples=100)
    with pytest.raises(ValueError, match="outside immutable"):
        write_report(directory, directory / "report", samples=100)
    assert Path(result["sources"][0]["path"]).is_absolute()


def test_domain_consistency_raw_reward_and_all_attempts_per_success(tmp_path):
    directory = cohort(tmp_path)
    rows = [json.loads(line) for line in (directory / "outcomes.jsonl").read_text().splitlines()]
    for row in rows:
        if row["taskId"] == "2":
            row["domain"] = "airline"
        if row["arm"] == "goalspec" and row["success"] is False:
            row.update(officialReward=1, evaluationErrorType="TimeoutError")
        path = directory / f"{row['runId']}.json"
        artifact = json.loads(path.read_text())
        artifact["record"] = row
        write(path, artifact)
    design = json.loads((directory / "design.json").read_text())
    design["trials"] = [{field: row[field] for field in ("domain", "taskId", "arm", "trial", "seed")} for row in rows]
    write(directory / "design.json", design)
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    result = analyze_stage(directory, samples=100)
    data = result["arms"]["goalspec"]
    assert data["successes"] == 5
    assert data["officialRewardAudit"]["rewardOneTrials"] == 6
    assert data["officialRewardAudit"]["rewardOneButPrimaryFailure"] == 1
    assert data["officialRewardAudit"]["evaluationErrorTrials"] == 1
    assert data["twoTrialConsistency"]["eligibleTasks"] == 3
    assert data["twoTrialConsistency"]["bothSucceeded"] == 2
    assert data["twoTrialConsistency"]["exactlyOneSucceeded"] == 1
    assert data["physicalCallsPerSuccess"]["estimate"] == 12 / 5
    assert result["arms"]["paste"]["physicalCallsPerSuccess"]["estimate"] is None
    assert result["domains"]["airline"]["arms"]["goalspec"]["trials"] == 2
    assert result["domains"]["airline"]["arms"]["goalspec"]["metrics"]["successRate"]["lower"] is None
    assert result["domains"]["retail"]["arms"]["goalspec"]["successes"] == 4
    paired = next(item for item in result["domains"]["retail"]["pairedDifferences"]
                  if item["treatment"] == "goalspec" and item["control"] == "base" and item["metric"] == "successRate")
    assert paired["estimate"] == .5
    assert paired["clusters"] == 2


def test_missing_physical_telemetry_does_not_shrink_cost_per_success_numerator(tmp_path):
    directory = cohort(tmp_path)
    path = directory / "run-2-goalspec-1.json"
    artifact = json.loads(path.read_text())
    del artifact["nativeToolTimings"]
    write(path, artifact)
    data = analyze_stage(directory, samples=100)["arms"]["goalspec"]["physicalCallsPerSuccess"]
    assert data["knownAttempts"] == 10
    assert data["missingTrials"] == 1
    assert data["estimate"] is None


def test_event_integrity_rejects_valid_truncated_prefix_tampering_and_wrong_manifest(tmp_path):
    path = tmp_path / "events.jsonl"
    manifest = {"runs": [{"runId": "r", "arm": "goalspec"}], "small": 1.2345678901234567e-7}
    records = event_log(path, [{"runId": "r", "event": {"type": "completed", "latencyMs": 1.2345678901234567e-7}}], manifest, aborted=True)
    result, _ = summarize_events([path], {"r"}, manifest)
    assert result["integrity"][0]["serviceAborted"] is True
    assert result["integrity"][0]["savedManifestVerified"] is True
    with pytest.raises(ValueError, match="manifest hash"):
        summarize_events([path], {"r"}, {**manifest, "small": 1})
    with pytest.raises(ValueError, match="run set"):
        summarize_events([path], {"wrong"}, manifest)
    path.write_bytes(b"".join(rfc8785.dumps(record) + b"\n" for record in records[:-1]))
    with pytest.raises(ValueError, match="service_closed"):
        summarize_events([path], {"r"}, manifest)
    records[1]["body"]["event"]["event"]["latencyMs"] = 999
    path.write_bytes(b"".join(rfc8785.dumps(record) + b"\n" for record in records))
    with pytest.raises(ValueError, match="hash chain"):
        summarize_events([path], {"r"}, manifest)
