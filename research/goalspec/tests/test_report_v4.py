import hashlib
import json

import pytest
import rfc8785

from goalspec.report_v4 import (
    ARMS,
    LABEL,
    Sources,
    analyze_stage,
    cluster_interval,
    cost_summary,
    digest,
    exposure_audit,
    goal_replay,
    load_stage,
    paired_comparison,
    summarize_arm,
    write_report,
)


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def jsonl(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def fixture(tmp_path):
    directory = tmp_path / "closed"
    directory.mkdir()
    rows, trials = [], []
    for family in range(2):
        for variant in range(2):
            for trial in range(2):
                for arm in ARMS:
                    row = {"studyId": "fixture", "studyStage": "confirmation", "runId": f"r-{family}-{variant}-{trial}-{arm}",
                           "domain": "retail", "family": str(family), "variant": variant, "trial": trial,
                           "taskId": f"task-{family}-{variant}", "seed": 100 + trial, "arm": arm,
                           "success": trial == 0 or arm == "goalspec", "officialReward": None, "label": LABEL,
                           "termination": "user_stop", "latencyMs": 2000, "nativeOrchestrationSeconds": 2,
                           "serviceDrainSeconds": 3, "totalTrialSeconds": 5, "evaluationSeconds": 9,
                           "authoritativeCalls": 2, "speculativeCalls": 1, "freshnessChecks": 2, "revalidationCalls": 0,
                           "usefulCalls": 1, "unpromotedCalls": 0, "constraintViolations": 0,
                           "billedUsd": .1, "knownUsageSubtotalUsd": .1, "unknownProviderCharge": False, "reservedUsd": 2.5}
                    trials.append({key: row[key] for key in ("family", "domain", "taskId", "variant", "trial", "seed", "arm")})
                    rows.append(row)
    design = {"version": "goalspec-live-v4", "studyId": "fixture", "studyStage": "confirmation", "trials": trials}
    design["designHash"] = digest(design)
    for index, (row, trial) in enumerate(zip(rows, trials, strict=True)):
        row["runId"] = f"v4-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}"
        artifact = {"record": row, "verdict": {"success": row["success"]}, "nativeToolTimings": [],
                    "simulation": {"messages": [{"role": "tool", "error": False}, {"role": "tool", "error": True}]},
                    "promotionEvents": [{"status": "consumed"}]}
        write(directory / f"{row['runId']}.json", artifact)
    write(directory / "design.json", design)
    write(directory / "summary.json", {"version": "goalspec-live-v4", "studyId": "fixture", "studyStage": "confirmation",
          "label": LABEL, "designHash": design["designHash"], "counts": {arm: 8 for arm in ARMS}, "successes": 20, "serviceExitCode": 0})
    write(directory / "service-manifest.json", {"runs": [{"runId": row["runId"], "arm": row["arm"]} for row in rows]})
    jsonl(directory / "outcomes.jsonl", rows)
    return directory, rows


def alter_outcome(directory, rows, index, **changes):
    rows[index].update(changes)
    artifact = json.loads((directory / f"{rows[index]['runId']}.json").read_text())
    artifact["record"] = rows[index]
    write(directory / f"{rows[index]['runId']}.json", artifact)
    jsonl(directory / "outcomes.jsonl", rows)


def test_custom_success_pass2_family_cluster_and_total_live_latency(tmp_path):
    directory, _ = fixture(tmp_path)
    report = analyze_stage(load_stage(directory), samples=100)
    base, goal = report["arms"]["base"], report["arms"]["goalspec"]
    assert base["metrics"]["pass1"]["estimate"] == .5
    assert base["metrics"]["pass2"]["estimate"] == 0
    assert goal["metrics"]["pass2"]["estimate"] == 1
    assert goal["metrics"]["pass1"]["families"] == 2
    assert base["twoTrialConsistency"]["eligibleFamilyVariants"] == 4
    assert base["timingSeconds"]["totalTrialSeconds"]["p95"] == 5
    assert base["nativeLatencyMs"]["mean"] == 2000
    assert base["counts"]["physicalCalls"]["knownSum"] == 24
    assert base["counts"]["freshnessChecks"]["knownSum"] == 16
    assert base["counts"]["consumptionLeaseChecks"]["knownSum"] == 8
    assert base["counts"]["recordedLeaseChecks"]["knownSum"] == 24
    assert base["metrics"]["physicalCallsPerSuccess"]["estimate"] == 6
    assert report["paired"]["goalspec-vs-base"]["matchedTrials"] == 8


def test_missing_outcome_rejected_before_private_trial_read(tmp_path, monkeypatch):
    directory, rows = fixture(tmp_path)
    jsonl(directory / "outcomes.jsonl", rows[:-1])
    original = Sources.read
    opened = []
    def guarded(self, path):
        opened.append(path.name)
        return original(self, path)
    monkeypatch.setattr(Sources, "read", guarded)
    with pytest.raises(ValueError, match="every declared outcome"):
        load_stage(directory)
    assert not any(name.startswith("v4-") for name in opened)


def test_same_arm_run_ids_cannot_be_swapped_across_tasks(tmp_path, monkeypatch):
    directory, rows = fixture(tmp_path)
    rows[0]["runId"], rows[16]["runId"] = rows[16]["runId"], rows[0]["runId"]
    jsonl(directory / "outcomes.jsonl", rows)
    original, opened = Sources.read, []
    def guarded(self, path):
        opened.append(path.name)
        return original(self, path)
    monkeypatch.setattr(Sources, "read", guarded)
    with pytest.raises(ValueError, match="Per-run identity"):
        load_stage(directory)
    assert not any(name.startswith("v4-") for name in opened)


def test_official_reward_cannot_be_misreported_as_custom(tmp_path):
    directory, rows = fixture(tmp_path)
    alter_outcome(directory, rows, 0, officialReward=1)
    with pytest.raises(ValueError, match="officialReward null"):
        load_stage(directory)


def test_success_requires_independent_verdict(tmp_path):
    directory, rows = fixture(tmp_path)
    path = directory / f"{rows[0]['runId']}.json"
    artifact = json.loads(path.read_text())
    artifact["verdict"]["success"] = False
    write(path, artifact)
    with pytest.raises(ValueError, match="independent successful verdict"):
        load_stage(directory)


def test_paired_seed_mismatch_excluded_and_unmeasured_latency_not_zero(tmp_path):
    directory, _ = fixture(tmp_path)
    rows = load_stage(directory)["rows"]
    next(row for row in rows if row["arm"] == "goalspec")["seed"] = -1
    pair = paired_comparison(rows, "goalspec", samples=100)
    assert pair["matchedTrials"] == 7
    assert len(pair["unmatchedControl"]) == len(pair["unmatchedTreatment"]) == 1
    for row in rows:
        if row["arm"] == "base":
            row["totalTrialSeconds"] = None
    pair = paired_comparison(rows, "goalspec", samples=100)
    assert pair["differences"]["liveTotalMeanSeconds"]["estimate"] is None
    assert pair["pairedMeasuredLatencyTrials"] == 0


def test_absent_physical_work_does_not_count_as_zero(tmp_path):
    directory, rows = fixture(tmp_path)
    path = directory / f"{rows[0]['runId']}.json"
    artifact = json.loads(path.read_text())
    del artifact["nativeToolTimings"]
    write(path, artifact)
    rows = load_stage(directory)["rows"]
    result = summarize_arm([row for row in rows if row["arm"] == "base"], samples=100)
    assert result["counts"]["physicalCalls"]["missingTrials"] == 1
    assert result["metrics"]["physicalCallsPerSuccess"]["estimate"] is None


def test_unknown_cost_reservation_not_double_counted():
    result = cost_summary([{"billedUsd": .1, "knownUsageSubtotalUsd": .1, "reservedUsd": 2.5},
                           {"billedUsd": None, "knownUsageSubtotalUsd": .2, "reservedUsd": 2.5, "unknownProviderCharge": True}])
    assert result["reservationBoundUsd"] == 2.6
    assert result["knownUsageSubtotalUsd"] == pytest.approx(.3)
    assert result["recordedTotalUsd"] is None


def test_bootstrap_preserves_zero_success_family_costs():
    result = cluster_interval([(10, 0), (2, 1)], samples=1000)
    assert result["estimate"] == 12
    assert result["families"] == 2
    assert result["undefinedDraws"] > 0
    assert result["upper"] == 12


def test_exposure_itt_uses_first_assignment_per_run_and_validates_withholding(tmp_path):
    directory, _ = fixture(tmp_path)
    rows = load_stage(directory)["rows"]
    run = rows[0]["runId"]
    events = [{"runId": run, "event": {"type": "exposure_assignment", "key": str(i), "expose": i == 0,
               "propensity": .5, "assignedGroupProbability": .5}} for i in range(2)]
    result = exposure_audit(rows, events, samples=100)
    assert result["assignmentCount"] == 2 and result["runsWithAssignments"] == 1
    assert result["firstAssignmentPerRunITT"]["success"]["estimate"] is None
    with pytest.raises(ValueError, match="repeated"):
        exposure_audit(rows, events + [events[0]])
    with pytest.raises(ValueError, match="was exposed"):
        exposure_audit(rows, events + [{"runId": run, "event": {"type": "exposed", "key": "1"}}])
    events[0]["event"]["propensity"] = 0
    with pytest.raises(ValueError, match="propensity"):
        exposure_audit(rows, events)


def test_closed_service_log_hash_verified(tmp_path):
    directory, rows = fixture(tmp_path)
    manifest = json.loads((directory / "service-manifest.json").read_text())
    payloads = [{"type": "research_manifest", "manifestHash": hashlib.sha256(rfc8785.dumps(manifest)).hexdigest(),
                 "runs": [{"id": row["runId"], "arm": row["arm"]} for row in rows]}, {"type": "service_closed"}]
    records, previous = [], "0" * 64
    for sequence, event in enumerate(payloads):
        body = {"event": event, "sequence": sequence, "previousHash": previous}
        previous = hashlib.sha256(rfc8785.dumps(body)).hexdigest()
        records.append({"body": body, "hash": previous})
    path = directory / "events.jsonl"
    path.write_bytes(b"".join(rfc8785.dumps(row) + b"\n" for row in records))
    assert load_stage(directory, event_paths=[path])["eventIntegrity"][0]["serviceClosed"]
    records[-1]["hash"] = "0" * 64
    path.write_bytes(b"".join(rfc8785.dumps(row) + b"\n" for row in records))
    with pytest.raises(ValueError, match="hash chain"):
        load_stage(directory, event_paths=[path])


def test_goal_replay_missing_grades_and_shared_family_components(tmp_path):
    rows = [{"revision": str(i), "familyIds": families,
             "grade": {"status": "completed", "matches": [True]},
             "originalGrade": {"status": "completed", "matches": [False]}}
            for i, families in enumerate([["a"], ["a", "b"], ["b"], ["c"]])]
    rows.append({"revision": "missing", "grade": None})
    write(tmp_path / "summary.json", {"revisions": 5})
    jsonl(tmp_path / "assessments.jsonl", rows)
    report = goal_replay(tmp_path, Sources())
    assert report["missingGrades"] == 1 and report["top1"] == 1
    assert report["operationalTop1AllRevisions"] == .8
    assert report["pairedDifference"]["top1"]["families"] == 2


def test_output_immutable_inputs_hashed_and_no_overwrite(tmp_path):
    directory, _ = fixture(tmp_path)
    plan = tmp_path / "plan.json"
    write(plan, {"cohorts": [{"directory": str(directory)}], "bootstrapSamples": 100})
    output = tmp_path / "report"
    write_report(plan, output)
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["privateArtifactsReadOnlyAfterClosedOutcomes"]
    assert str(directory / "outcomes.jsonl") in manifest["sources"]
    assert set(manifest["outputs"]) == {"report.json", "README.md", "metrics.csv"}
    readme = (output / "README.md").read_text()
    assert str(plan.resolve()) in readme and manifest["planSha256"] in readme
    assert "--expected-sha256" in readme and "Preserve every original manifest" in readme
    with pytest.raises(FileExistsError):
        write_report(plan, output)
    with pytest.raises(ValueError, match="source cohort"):
        write_report(plan, directory / "not-allowed")


def test_preserves_failed_goal_iteration_separately_from_current(tmp_path):
    paths = [tmp_path / "earlier-goals", tmp_path / "current-goals"]
    for index, directory in enumerate(paths):
        directory.mkdir()
        write(directory / "summary.json", {"revisions": 2, "predicted": index + 1})
        jsonl(directory / "assessments.jsonl", [
            {"revision": "one", "familyIds": ["family"], "grade": {"status": "completed", "matches": [bool(index)]},
             "originalGrade": {"status": "completed", "matches": [False]}},
            {"revision": "two", "grade": None},
        ])
    plan = tmp_path / "plan.json"
    write(plan, {"cohorts": [], "goalReplayDirectory": str(paths[1]),
                 "earlierGoalReplayDirectories": [str(paths[0])], "bootstrapSamples": 100})
    output = tmp_path / "report"
    result = write_report(plan, output)
    assert result["supporting"]["goalReplay"]["top1"] == 1
    assert result["supporting"]["earlierGoalReplays"][0]["top1"] == 0
    assert result["supporting"]["earlierGoalReplays"][0]["missingGrades"] == 1
    text = (output / "README.md").read_text()
    assert "Preserved earlier goal-replay iterations" in text
    assert str(paths[0]) in text and str(paths[1]) in text
    write(plan, {"cohorts": [], "goalReplayDirectory": str(paths[1]), "earlierGoalReplayDirectories": [str(paths[1])]})
    with pytest.raises(ValueError, match="distinct"):
        write_report(plan, tmp_path / "duplicate-report")


def test_copied_blinded_annotations_retain_original_hash_and_order(tmp_path):
    annotations = [{"revision": "b", "annotation": {"status": "completed"}},
                   {"revision": "a", "annotation": {"status": "completed"}}]
    write(tmp_path / "summary.json", {"revisions": 2})
    jsonl(tmp_path / "assessments.jsonl", [{"revision": "a", "grade": None}, {"revision": "b", "grade": None}])
    jsonl(tmp_path / "second-annotations.jsonl", annotations)
    write(tmp_path / "plan.json", {"revisionIds": ["a", "b"], "secondAnnotationRevisions": ["a", "b"]})
    write(tmp_path / "second-annotations-frozen.json", {
        "count": 2, "hash": hashlib.sha256(rfc8785.dumps(list(reversed(annotations)))).hexdigest()})
    assert goal_replay(tmp_path, Sources())["secondAnnotationFreezeVerified"]
    annotations[0]["annotation"]["status"] = "changed"
    jsonl(tmp_path / "second-annotations.jsonl", annotations)
    with pytest.raises(ValueError, match="freeze hash"):
        goal_replay(tmp_path, Sources())


def test_controller_latency_is_reported_only_when_explicitly_measured(tmp_path):
    directory, _ = fixture(tmp_path)
    stage = load_stage(directory)
    run = next(row["runId"] for row in stage["rows"] if row["arm"] == "goalspec")
    stage["events"] = [{"runId": run, "event": {"type": "controller_decision", "latencyMs": 2.75}},
                       {"runId": run, "event": {"type": "controller_decision"}}]
    telemetry = analyze_stage(stage, samples=100)["telemetry"]["goalspec"]
    assert telemetry["controllerLatencyMeasured"]
    assert telemetry["latencyMs"]["controller_decision"]["mean"] == 2.75
    assert telemetry["latencyMs"]["controller_decision"]["missing"] == 1


def test_reused_blinded_annotations_use_hash_pinned_source_order(tmp_path):
    original, current = tmp_path / "original", tmp_path / "current"
    original.mkdir()
    current.mkdir()
    annotations = [{"revision": "b", "annotation": {"status": "completed"}},
                   {"revision": "a", "annotation": {"status": "completed"}}]
    source = original / "second-annotations.jsonl"
    jsonl(source, annotations)
    jsonl(current / "second-annotations.jsonl", annotations)
    write(current / "summary.json", {"revisions": 2})
    jsonl(current / "assessments.jsonl", [{"revision": "a", "grade": None}, {"revision": "b", "grade": None}])
    write(current / "plan.json", {"revisionIds": ["a", "b"], "secondAnnotationRevisions": ["a", "b"],
                                  "inputFiles": [{"path": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]})
    write(current / "second-annotations-frozen.json", {"count": 2, "hash": hashlib.sha256(rfc8785.dumps(annotations)).hexdigest()})
    report = goal_replay(current, Sources())
    assert report["secondAnnotationFreezeVerified"]
    assert report["secondAnnotationFreezeOrder"] == "reused source JSONL order"
    jsonl(current / "second-annotations.jsonl", list(reversed(annotations)))
    with pytest.raises(ValueError, match="hash-pinned source"):
        goal_replay(current, Sources())


def test_fresh_controller_stages_are_separate_and_cannot_be_relabeled(tmp_path):
    supporting = {}
    for stage, key in (("development", "freshControllerDevelopment"), ("confirmation", "freshControllerConfirmation")):
        path = tmp_path / f"controller-{stage}.json"
        write(path, {"version": "goalspec-frozen-controller-native-report-v1", "cohortStage": stage,
                     "uniqueCheckpoints": 2, "summary": {}, "pairedDifferences": {}})
        supporting[key] = str(path)
    plan = tmp_path / "plan.json"
    write(plan, {"cohorts": [], "supporting": supporting})
    output = tmp_path / "report"
    write_report(plan, output)
    text = (output / "README.md").read_text()
    assert "Fresh development prefixes" in text and "Held-out confirmation prefixes" in text
    supporting["freshControllerConfirmation"] = supporting["freshControllerDevelopment"]
    write(plan, {"cohorts": [], "supporting": supporting})
    with pytest.raises(ValueError, match="cohort stage"):
        write_report(plan, tmp_path / "invalid-report")


def test_final_report_distinguishes_ranking_gate_and_cumulative_accounting(tmp_path):
    # A ranker improves while its READ gate gets worse. Both belong in the report.
    metrics = {name: {"estimate": .5, "denominator": 4} for name in (
        "exactTop1", "exactTop3", "toolTop1", "toolTop3", "gatedExactTop1",
        "readSensitivity", "noReadSpecificity", "actionNllNats", "nextToolCrossEntropyEstimateNats")}
    pair = {name: {"estimate": value, "lower": value, "upper": value, "matchedMeasuredCheckpoints": 4}
            for name, value in (("exactTop1", .25), ("gatedExactTop1", -.25), ("actionNllNats", -.1))}
    controller = tmp_path / "controller.json"
    write(controller, {"version": "goalspec-frozen-controller-native-report-v1", "cohortStage": "confirmation",
                       "uniqueCheckpoints": 4, "summary": {"policy-ready": {"frozen-logistic": {
                           "metrics": metrics, "completed": 4, "checkpoints": 4, "readActions": 4, "unknownActions": 0}}},
                       "pairedDifferences": {"policy-ready": {"differences": pair, "matchedCheckpointIds": [1, 2, 3, 4]}}})
    accounting, audit = tmp_path / "accounting.json", tmp_path / "audit.json"
    write(accounting, {"totalKnownUsageCostUsd": 12, "totalSpentOrReservedUsd": 25,
                       "totalCeilingUsd": 500, "unresolvedRequests": 2, "awsChargesUsd": 0})
    write(audit, {"posthoc": True, "scoresChanged": False})
    plan, output = tmp_path / "plan.json", tmp_path / "report"
    write(plan, {"cohorts": [], "supporting": {"freshControllerConfirmation": str(controller),
                 "accounting": str(accounting), "confirmationFailureAudit": str(audit)}})
    write_report(plan, output)
    text = (output / "README.md").read_text()
    assert "Exact Top1 after admission gates" in text and "-25.0%" in text
    assert "READ sensitivity" in text and "NO_READ specificity" in text
    assert "Settled logical-request usage: $12.000" in text and "Spent or reserved: $25.000" in text
    assert "Do not add cohort subtotals" in text and "Post-hoc confirmation failure audit" in text
