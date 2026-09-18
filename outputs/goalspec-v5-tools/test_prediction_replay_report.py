import importlib.util
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prediction_replay_report", Path(__file__).with_name("prediction_replay_report.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_family_bootstrap_retains_missing_observation_coverage_and_empty_groups():
    rows = [{"familyId": "a", "value": 1}, {"familyId": "a", "value": None}, {"familyId": "b", "value": 0}]
    result = MODULE.ci(rows, lambda row: row["value"], samples=100)
    assert result["estimate"] == .5 and result["observed"] == 2 and result["denominator"] == 3 and result["families"] == 2
    assert MODULE.ci([], lambda row: row["value"], samples=100)["estimate"] is None


def test_missing_goal_grade_is_primary_miss_and_conditional_coverage_is_separate(monkeypatch, tmp_path):
    rankers = ["neutral-no-memory", "neutral-active-memory", "full-goal", "teacher-goal-hint", "shuffled-goal", "shuffled-feature-corruption",
        "matched-temperature-neutral", "matched-temperature-full-goal"]
    annotations = [{"id": str(index), "familyId": f"f{index % 4}", "grades": [] if index < 12 else None,
        "goalTop1": index < 8 if index < 12 else None, "goalTop3": index < 10 if index < 12 else None,
        "sourceGrounded": index < 12, "failures": [] if index < 12 else [{"stage": "agreement"}]} for index in range(16)]
    scores = [{"id": str(index), "familyId": f"f{index % 4}", "domain": "retail" if index < 8 else "airline",
        "ranker": ranker, "status": "completed", "actualRead": index % 2 == 0, "poolCovered": index % 2 == 0,
        "toolTop1": False, "toolTop3": True, "exactTop1": False, "exactTop3": True, "jointReadExactTop1": False,
        "noReadCorrect": index % 2 != 0, "categoryNllNats": .75 if ranker == "matched-temperature-full-goal" else 1.0, "binaryReadNllNats": .5,
        "exactSetNllNats": 2.0 if index % 2 == 0 else None, "toolSetNllNats": 1.0 if index % 2 == 0 else None,
        "decision": {"goalCorrectionStatus": "test"}} for index in range(16) for ranker in rankers]
    manifest = {"primaryRankers": rankers[:5], "sensitivityRankers": rankers[5:], "planSha256": "plan",
        "controllerSha256": "controller", "shuffledControl": "Explicit offline sensitivity",
        "matchedTemperatureDiagnostic": {"temperature": .75, "policy": "Explicit offline-only matched temperature"}}
    monkeypatch.setattr(MODULE, "verify_input", lambda _: (manifest, {}, scores, annotations, {}))
    monkeypatch.setattr(MODULE, "sha", lambda _: "hash")
    report = MODULE.summarize(tmp_path, samples=100)
    assert report["agreement"]["goalTop1AllSelected"]["estimate"] == .5
    assert report["agreement"]["goalTop1GradedOnly"]["estimate"] == 8 / 12
    assert report["agreement"]["goalTop3AllSelected"]["estimate"] == 10 / 16
    assert report["agreement"]["missingGrades"] == 4
    assert report["summary"]["full-goal"]["noReadSpecificity"]["estimate"] == 1
    assert report["pairedFullGoalMinusControl"]["neutral-active-memory"]["exactTop3"]["estimate"] == 0
    diagnostic = report["matchedTemperatureResidualDiagnostic"]
    assert diagnostic["temperature"] == .75 and diagnostic["primaryControlChanged"] is False
    assert diagnostic["differencesFullResidualMinusNeutral"]["categoryNllNats"]["estimate"] == -.25
    assert report["pairedFullGoalMinusControl"]["neutral-active-memory"]["categoryNllNats"]["estimate"] == 0
