import json
from collections import Counter

import pytest
from test_official_native_v4 import inputs

from goalspec import report_official_v4 as module
from goalspec.official_native_v4 import LABEL, VERSION, declared_trials, make_design
from goalspec.report_v4 import Sources
from goalspec.study_v2 import write


def fixture(tmp_path):
    directory = tmp_path / "cohort"
    directory.mkdir()
    selection, budget, cohorts = inputs()
    budget["allocations"][0]["spentOrReservedUsd"] = 220
    design = make_design(selection, budget, cohorts)
    study = {"studyId": design["studyId"], "upstreamRevision": module.VERSION}
    study["studyHash"] = module.digest(study)
    design["studyHash"] = study["studyHash"]
    design["designHash"] = module.digest({k: v for k, v in design.items() if k != "designHash"})
    selection_path = tmp_path / "selection.json"
    write(selection_path, selection)
    plan = {"version": VERSION, "study": study, "design": design, "v4Configuration": {},
            "baselineSessionConfiguration": None, "inputs": {"selection": {"path": str(selection_path),
                "sha256": module.report_v3.file_hash(selection_path)}}}
    plan["planHash"] = module.digest(plan)
    rows = []
    for identifier, trial in declared_trials(study, design):
        row = {**trial, "reservedUsd": trial["reserved_usd"], "runId": identifier,
               "studyId": design["studyId"], "studyStage": "confirmation", "label": LABEL,
               "success": trial["trial"] == 0, "officialReward": int(trial["trial"] == 0),
               "nativeTermination": "user_stop", "termination": "user_stop", "totalTrialSeconds": 3,
               "nativeOrchestrationSeconds": 2, "serviceDrainSeconds": 1, "evaluationSeconds": .2,
               "authoritativeCalls": 1, "speculativeCalls": 0, "unpromotedCalls": 0, "usefulCalls": 0,
               "freshnessChecks": 0, "revalidationCalls": 0, "nativeToolResponses": 1,
               "nativeToolErrorResponses": 0, "billedUsd": .1, "knownUsageSubtotalUsd": .1,
               "unknownProviderCharge": False, "serviceReadyBeforeTrial": False}
        rows.append(row)
        write(directory / f"{identifier}.json", {"record": row, "nativeToolTimings": [
            {"operation": "authoritative_tool", "durationMs": 1, "isRead": True}], "promotionEvents": [],
            "officialRewardInfo": {"reward": row["officialReward"], "reward_basis": ["DB"]}})
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    write(directory / "summary.json", {**{k: design[k] for k in ("studyId", "studyStage", "studyHash", "designHash")},
          "version": VERSION, "label": LABEL, "counts": dict(Counter(row["arm"] for row in rows)),
          "successes": sum(row["success"] for row in rows)})
    write(directory / "design.json", design)
    write(directory / "dispatch-plan.json", plan)
    return directory, rows


def test_native_rewards_and_pass2_preserved_in_immutable_report(tmp_path):
    directory, _ = fixture(tmp_path)
    output = tmp_path / "report"
    result = module.write_report(directory, output, [], samples=100)
    assert result["arms"]["base"]["metrics"]["successRate"]["estimate"] == .5
    assert result["arms"]["base"]["metrics"]["bothTrialsSuccessRate"]["estimate"] == 0
    assert result["cost"]["unknownChargeTrials"] == 0
    assert result["leaseChecks"]["base"]["consumptionChecks"] == 0
    assert set(result["domains"]) == {"retail", "airline"}
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["providerCalls"] == 0 and manifest["privateReadsAfterCompleteOutcomeGrid"]
    with pytest.raises(ValueError, match="New report"):
        module.write_report(directory, output, [])


def test_run_id_swap_is_rejected_before_private_reads(tmp_path, monkeypatch):
    directory, rows = fixture(tmp_path)
    first = 0
    second = next(i for i, row in enumerate(rows) if row["arm"] == rows[first]["arm"] and row["family"] != rows[first]["family"])
    rows[first]["runId"], rows[second]["runId"] = rows[second]["runId"], rows[first]["runId"]
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    original, opened = Sources.read, []
    def observed(self, path):
        opened.append(path.name)
        return original(self, path)
    monkeypatch.setattr(Sources, "read", observed)
    with pytest.raises(ValueError, match="Per-run official"):
        module.load_stage(directory)
    assert not any("official-v4-" in name for name in opened)


def test_incomplete_cohort_never_opens_private_trials(tmp_path, monkeypatch):
    directory, rows = fixture(tmp_path)
    (directory / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows[:-1]))
    original, opened = Sources.read, []
    def observed(self, path):
        opened.append(path.name)
        return original(self, path)
    monkeypatch.setattr(Sources, "read", observed)
    with pytest.raises(ValueError, match="closed exactly once"):
        module.load_stage(directory)
    assert not any("official-v4-" in name for name in opened)


def test_reward_artifact_disagreement_rejected(tmp_path):
    directory, rows = fixture(tmp_path)
    row = next(row for row in rows if row["success"])
    path = directory / f"{row['runId']}.json"
    artifact = json.loads(path.read_text())
    artifact["officialRewardInfo"]["reward"] = 0
    path.write_text(json.dumps(artifact))
    with pytest.raises(ValueError, match="native reward artifact"):
        module.load_stage(directory)
