import json

import pytest

from goalspec.controller_native_v4_report import RANKERS, UNIVERSES, analyze, write_report
from goalspec.report_v4 import file_hash


def fixture(directory):
    rows = []
    for index in range(4):
        actual = index in (0, 2)
        for universe in UNIVERSES:
            for ranker in RANKERS:
                hit = actual and ranker == "frozen-logistic"
                rows.append({"id": str(index), "runId": f"run-{index}", "familyId": f"family-{index // 2}", "domain": "retail",
                             "boundary": index, "universe": universe, "ranker": ranker, "status": "completed", "unavailableReason": None,
                             "actualRead": actual, "poolSize": 2, "poolHash": f"pool-{index}-{universe}", "poolCovered": actual,
                             "toolTop1": hit, "toolTop3": actual, "exactTop1": hit, "exactTop3": actual, "gatedExactTop1": hit,
                             "predictedRead": actual if ranker == "frozen-logistic" else True, "actionReadProbability": .8 if actual else .2,
                             "actionNll": .2 if ranker == "frozen-logistic" else 1.2, "actionBrier": .04,
                             "toolCrossEntropyEstimateNats": (.3 if ranker == "frozen-logistic" else .8) if actual else None})
    (directory / "checkpoints.jsonl").write_text("".join(json.dumps({"id": str(index), "publicPrefix": True}) + "\n" for index in range(4)), encoding="utf-8")
    manifest = {"version": "synthetic", "cohortStage": "confirmation", "heldoutFamilies": ["family-0", "family-1"],
                "completeDeclaredCohort": True, "sourceInputsExcludePrivateFields": True, "frozenControllerHash": "a" * 64,
                "controllerFileSha256": "b" * 64, "sourceFiles": [], "codeFiles": []}
    save(directory, rows, manifest)
    return rows, manifest


def save(directory, rows, manifest):
    (directory / "scores.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    manifest.update(scoresSha256=file_hash(directory / "scores.jsonl"), checkpointsSha256=file_hash(directory / "checkpoints.jsonl"))
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_identical_pool_metrics_use_family_clusters_and_paired_losses(tmp_path):
    fixture(tmp_path)
    result = analyze(tmp_path, samples=100)
    score = result["summary"]["policy-ready"]["frozen-logistic"]
    assert result["uniqueCheckpoints"] == 4 and result["scoreRows"] == 16
    assert score["metrics"]["exactTop1"]["estimate"] == 1
    assert score["metrics"]["exactTop1"]["families"] == 2
    assert score["metrics"]["noReadSpecificity"]["estimate"] == 1
    pair = result["pairedDifferences"]["policy-ready"]
    assert pair["differences"]["actionNllNats"]["estimate"] == pytest.approx(-1)
    assert pair["differences"]["nextToolCrossEntropyEstimateNats"]["matchedMeasuredCheckpoints"] == 2


def test_unavailable_known_reads_remain_failures_and_unknown_labels_stay_missing(tmp_path):
    rows, manifest = fixture(tmp_path)
    for row in rows:
        if row["id"] not in ("0", "1"):
            continue
        row.update(status="unavailable", unavailableReason="incomplete_actor", actualRead=True if row["id"] == "0" else None,
                   predictedRead=None, actionReadProbability=None, actionNll=None, actionBrier=None, toolCrossEntropyEstimateNats=None)
        for field in ("toolTop1", "toolTop3", "exactTop1", "exactTop3", "gatedExactTop1"):
            row[field] = False if row["id"] == "0" else None
    save(tmp_path, rows, manifest)
    score = analyze(tmp_path, samples=100)["summary"]["proposal"]["frozen-logistic"]
    assert score["metrics"]["exactTop1"]["estimate"] == .5
    assert score["knownReadPredictionFailures"] == 1 and score["unknownActions"] == 1
    assert score["missingLosses"]["actionNllNats"] == 1


@pytest.mark.parametrize("mutation", ["pool", "identity", "missing", "duplicate"])
def test_pairing_mismatch_is_rejected(tmp_path, mutation):
    rows, manifest = fixture(tmp_path)
    if mutation == "pool":
        rows[0]["poolHash"] = "different-same-size"
    elif mutation == "identity":
        rows[0]["familyId"] = "different"
    elif mutation == "missing":
        rows.pop()
    else:
        rows.append(rows[0])
    save(tmp_path, rows, manifest)
    with pytest.raises(ValueError):
        analyze(tmp_path, samples=100)


def test_hash_checked_before_score_parse_and_output_is_immutable(tmp_path):
    fixture(tmp_path)
    output = tmp_path / "report.json"
    write_report(tmp_path, output, samples=100)
    with pytest.raises(FileExistsError):
        write_report(tmp_path, output, samples=100)
    (tmp_path / "scores.jsonl").write_text("invalid changed bytes")
    with pytest.raises(ValueError, match="hash mismatch"):
        analyze(tmp_path, samples=100)


def test_omitted_whole_checkpoint_cannot_shrink_denominator(tmp_path):
    rows, manifest = fixture(tmp_path)
    rows = [row for row in rows if row["id"] != "0"]
    save(tmp_path, rows, manifest)
    with pytest.raises(ValueError, match="complete checkpoint artifact"):
        analyze(tmp_path, samples=100)
