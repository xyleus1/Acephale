import copy
import json
import math

import pytest

from goalspec.prediction_report_v3 import (
    ARMS,
    CONTROLS,
    EPSILON,
    REQUIRED,
    analyze,
    canonical,
    checkpoint_metrics,
    cluster_interval,
    digest,
    file_hash,
    goal_statistics,
    load_replay,
    markdown,
    tool_distribution,
    write_report,
)


def candidate(tool="read_a", probability=.9, arguments=None):
    return {"id": "candidate-" + tool, "probability": probability,
            "invocation": {"tool": tool, "arguments": arguments or {"id": "current"}}}


def checkpoint(identifier="c1", family="family1", kind="read_only"):
    return {"id": identifier, "familyId": family, "runId": "run-" + identifier, "domain": "retail", "boundary": 0,
            "actual": [{"id": "actual-" + identifier, "tool": "read_a", "arguments": {"id": "current"}}] if kind != "message" else [],
            "decisionKind": kind, "unavailableReason": None, "readToolSchemaNames": ["read_a", "read_b", "read_c"]}


def dataset():
    rows, annotations, grades = [], [], []
    for index in range(2):
        cp = checkpoint(f"c{index}", f"family{index}")
        predictions = [{"arm": arm, "status": "failed" if arm == "paste" else "completed", "failureCode": "fixture" if arm == "paste" else None,
                        "candidates": [] if arm == "paste" else [candidate()]} for arm in ARMS]
        pool = [candidate()]
        rows.append({"version": "goalspec-prediction-v3.3", "checkpoint": cp, "predictions": predictions,
                     "sharedPool": {"candidates": pool, "rankings": {control: [{"candidateId": pool[0]["id"], "score": 0}] for control in CONTROLS}}})
        revision = "revision-" + str(index)
        reference = {"status": "completed", "requested_input_hash": revision, "annotation": {"unknown": False}}
        prediction = {"status": "completed", "requested_input_hash": revision}
        annotations.append({"revision": revision, "checkpointIds": [cp["id"]], "reference": reference})
        grades.append({"revision": revision, "checkpointIds": [cp["id"]], "runIds": [cp["runId"]], "familyIds": [cp["familyId"]],
                       "referenceHash": digest(reference), "prediction": prediction,
                       "grade": {"status": "completed", "annotation_hash": digest(reference), "prediction_hash": digest(prediction),
                                 "ranked_ids": ["g1", "g2"], "matches": [index == 0, True]}})
    selection = {"method": "all_checkpoints", "seed": "fixture", "inputCheckpointIds": [row["checkpoint"]["id"] for row in rows],
                 "selectedCheckpointIds": [row["checkpoint"]["id"] for row in rows], "omittedCheckpointIds": [], "maximumMicrodollars": 1000}
    return {"rows": rows, "annotations": annotations, "grades": grades,
            "selection": {**selection, "contentHash": digest(selection)}, "sources": []}


def test_categorical_distribution_matches_predeclared_full_schema_max_rule():
    distribution = tool_distribution([candidate("read_a", .8), candidate("read_a", .4), candidate("read_b", .2)], ["read_a", "read_b", "read_c"])
    assert distribution["read_a"] == pytest.approx((1 - EPSILON) * .8 + EPSILON / 3)
    assert distribution["read_c"] == pytest.approx(EPSILON / 3)
    assert sum(distribution.values()) == pytest.approx(1)
    assert tool_distribution([], ["a", "b"]) == {"a": .5, "b": .5}
    with pytest.raises(ValueError):
        tool_distribution([candidate("future_unknown")], ["read_a"])


def test_read_only_metrics_exclude_writes_compute_messages_and_mixed_calls():
    for kind in ("write_only", "other_tool", "message", "mixed"):
        metrics = checkpoint_metrics(checkpoint(kind=kind), {"candidates": [candidate()]})
        assert metrics["toolTop1"] == (0, 0)
        assert metrics["nextReadToolCrossEntropyNats"] == (0, 0)
        assert metrics["binaryReadNllNats"][1] == 1
    cp = checkpoint()
    absent = checkpoint_metrics(cp, {"status": "failed", "candidates": []})
    assert absent["toolTop1"] == (0, 1)
    assert absent["nextReadToolCrossEntropyNats"][0] == pytest.approx(math.log(3))
    cp.update(actual=None, unavailableReason="actor_returned_no_saved_response", decisionKind="no_response")
    assert all(value == (0, 0) for value in checkpoint_metrics(cp, {"candidates": []}).values())


def test_valid_system_fallback_scores_but_failed_model_output_does_not_disappear():
    metrics = checkpoint_metrics(checkpoint(), {"status": "failed", "candidates": [candidate()]})
    assert metrics["toolTop1"] == metrics["fullArgumentsTop1"] == (1, 1)
    assert metrics["completedPredictionToolTop1"] == metrics["completedPredictionArgumentsTop1"] == (0, 1)
    assert metrics["conditionalToolPrecision"] == (1, 1)
    assert metrics["completedPredictionConditionalToolPrecision"] == (0, 0)


def test_paired_cluster_intervals_keep_identical_draws_and_zero_conditional_family_denominators():
    values = {"a": (1, 1), "b": (0, 1)}
    same = cluster_interval(values, samples=100, control=values)
    assert same["estimate"] == same["lower"] == same["upper"] == 0
    assert same["denominator"] == same["controlDenominator"] == 2
    treatment, control = {"a": (1, 1), "b": (0, 0)}, {"a": (0, 0), "b": (0, 1)}
    conditional = cluster_interval(treatment, samples=100, control=control)
    assert conditional["estimate"] == 1
    assert conditional["clusters"] == 2
    assert conditional["bootstrapSamplesSkipped"] > 0
    assert conditional["bootstrapSamplesUsed"] > 0
    assert cluster_interval({"a": (1, 1)}, samples=100)["lower"] is None


def test_closed_replay_metrics_keep_failed_predictions_and_paste_ce_reduction_sign():
    report = analyze(dataset(), samples=100)
    assert report["arms"]["paste"]["toolTop1"]["estimate"] == 0
    assert report["arms"]["goalspec"]["toolTop1"]["estimate"] == 1
    assert report["arms"]["paste"]["nextReadToolCrossEntropyNats"]["estimate"] == pytest.approx(math.log(3))
    assert report["crossEntropyReductionVsPaste"]["goalspec"]["estimate"] > 0
    assert report["goalspecPairedDifferences"]["paste"]["fullArgumentsTop1"]["estimate"] == 1
    assert report["predictionStatuses"]["paste"]["failed"] == 2
    assert report["identicalPoolControls"]["uniform"]["poolOracleFullArguments"]["estimate"] == 1
    assert "not true conditional entropy" in markdown(report)


def test_identical_pool_diagnostic_rejects_a_control_with_a_private_extra_candidate():
    data = dataset()
    data["rows"][0]["sharedPool"]["rankings"]["uniform"].append({"candidateId": "future_gold", "score": 999})
    with pytest.raises(ValueError, match="identical pool"):
        analyze(data, samples=100)


def test_goal_unique_revision_and_checkpoint_weighting_differ_and_reuse_connects_families():
    data = dataset()
    repeated = copy.deepcopy(data["rows"][0])
    repeated["checkpoint"]["id"] = "repeat"
    repeated["checkpoint"]["runId"] = "repeat-run"
    repeated["checkpoint"]["familyId"] = "family2"
    data["rows"].append(repeated)
    data["annotations"][0]["checkpointIds"].append("repeat")
    data["grades"][0]["checkpointIds"].append("repeat")
    data["grades"][0]["runIds"].append("repeat-run")
    data["grades"][0]["familyIds"].append("family2")
    goals = goal_statistics(data, samples=100, seed=123)
    assert goals["uniqueRevisionWeighted"]["goalTop1"]["estimate"] == .5
    assert goals["checkpointWeighted"]["goalTop1"]["estimate"] == pytest.approx(2 / 3)
    assert goals["familyComponents"] == 2
    assert goals["uniqueRevisionWeighted"]["goalTop1"]["clusters"] == 2
    assert goals["checkpointWeighted"]["goalTop3"]["estimate"] == 1


def test_missing_goal_grade_unmeasured_but_failed_prediction_with_completed_reference_is_miss():
    data = dataset()
    data["grades"][0]["grade"].update(status="failed", ranked_ids=[], matches=[])
    prediction = data["grades"][1]["prediction"]
    prediction["status"] = "failed"
    data["grades"][1]["grade"].update(matches=[False], ranked_ids=["__prediction_failed__"], prediction_hash=digest(prediction))
    goals = goal_statistics(data, samples=100, seed=123)
    assert goals["scoredRevisions"] == 1
    assert goals["missingAnnotationOrGrade"] == 1
    assert goals["failedGoalPredictions"] == 1
    assert goals["uniqueRevisionWeighted"]["goalTop1"]["estimate"] == 0


def save_fixture(directory, data):
    def write(name, value):
        (directory / name).write_bytes(canonical(value) + b"\n")
    def lines(name, rows):
        (directory / name).write_bytes(b"".join(canonical(row) + b"\n" for row in rows))
    for name in REQUIRED:
        write(name, {})
    selection = data["selection"]
    write("selection.json", selection)
    write("dispatch-plan.json", {"selection": selection, "checkpointIds": selection["selectedCheckpointIds"]})
    write("manifest.json", {"checkpointIds": selection["selectedCheckpointIds"]})
    previous, saved = "0" * 64, []
    for index, row in enumerate(data["rows"]):
        body = {"sequence": index, "previousHash": previous, "row": row}
        previous = digest(body)
        saved.append({"body": body, "hash": previous})
    lines("predictions.jsonl", saved)
    lines("requested-annotations.jsonl", data["annotations"])
    lines("requested-grades.jsonl", data["grades"])
    write("annotations-frozen.json", {"beforeAnyPredictorCall": True, "annotationsHash": digest(data["annotations"])})
    write("completion.json", {"rows": len(saved), "tailHash": previous, **{key: file_hash(directory / filename)
          for filename, key in (("manifest.json", "manifestHash"), ("predictions.jsonl", "predictionsHash"), ("summary.json", "summaryHash"), ("model-events.jsonl", "modelEventsHash"))}})
    write("execution-receipt.json", {"status": "complete", "planHash": file_hash(directory / "dispatch-plan.json"),
          "files": [{"path": name, "sha256": file_hash(directory / name)} for name in REQUIRED]})


def test_loader_verifies_closed_receipt_selection_hashchain_and_frozen_teacher_barrier(tmp_path):
    data = dataset()
    save_fixture(tmp_path, data)
    loaded = load_replay(tmp_path)
    assert len(loaded["rows"]) == 2
    assert analyze(loaded, samples=100)["decisions"] == 2
    (tmp_path / "predictions.jsonl").write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="receipt"):
        load_replay(tmp_path)


def test_loader_rejects_forged_selected_ids_even_with_recomputed_file_receipt(tmp_path):
    data = dataset()
    save_fixture(tmp_path, data)
    selection = json.loads((tmp_path / "selection.json").read_text())
    selection["selectedCheckpointIds"].append("future-injected")
    selection["contentHash"] = digest({key: value for key, value in selection.items() if key != "contentHash"})
    (tmp_path / "selection.json").write_bytes(canonical(selection) + b"\n")
    receipt = json.loads((tmp_path / "execution-receipt.json").read_text())
    for item in receipt["files"]:
        item["sha256"] = file_hash(tmp_path / item["path"])
    (tmp_path / "execution-receipt.json").write_bytes(canonical(receipt) + b"\n")
    with pytest.raises(ValueError, match="frozen plan"):
        load_replay(tmp_path)


def test_report_writes_hashed_tables_and_paired_denominators_without_overwriting(tmp_path):
    save_fixture(tmp_path, dataset())
    output = tmp_path / "analysis"
    report = write_report(tmp_path, output, samples=100)
    assert report["decisions"] == 2
    receipt = json.loads((output / "analysis-receipt.json").read_text(encoding="utf-8"))
    assert receipt["paidApiCalls"] == 0
    assert receipt["ledgerOpened"] is False
    for item in receipt["files"]:
        assert file_hash(output / item["path"]) == item["sha256"]
    assert "controlDenominator" in (output / "paired-differences.csv").read_text(encoding="utf-8")
    with pytest.raises(ValueError, match="new prediction report"):
        write_report(tmp_path, output, samples=100)
