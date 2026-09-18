import json

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.fixtures import demo_corpus
from goalspec.requested_replay import prepare_requested_replay, requested_goal_report


def test_requested_queue_omits_actor_actions_results_outcomes_and_future_users(tmp_path):
    corpus = demo_corpus(groups=4, trials=1)
    manifest = prepare_requested_replay(corpus[:6], corpus[6:], tmp_path / "queue")
    rows = [json.loads(line) for line in (tmp_path / "queue" / "queue.jsonl").read_text().splitlines()]
    assert manifest["checkpoints"] == 12
    assert manifest["noEndpointLabelsInTeacherInput"] is True
    for row in rows:
        assert set(row["requested_input"]) == {"policy", "sources"}
        assert set(row["requested_input"]["sources"]) == {"request:0"}
        assert row["requested_input_hash"] == hash_v1(row["requested_input"])
        assert "done" not in row["requested_input"]["sources"]["request:0"]
    with pytest.raises(ValueError, match="disjoint"):
        prepare_requested_replay(corpus[:6], corpus[:3], tmp_path / "bad")


def test_requested_accuracy_is_separate_from_endpoint_labels_and_requires_complete_provenance():
    queue, predictions, annotations, grades = [], [], [], []
    for number in range(4):
        checkpoint = {"id": f"c{number}", "familyId": f"family{number}", "domain": "retail", "trajectory_id": f"t{number}", "through_seq": 0, "requested_input_hash": f"source{number}", "visible_input_hash": hash_v1(number)}
        prediction = {"id": checkpoint["id"], "status": "completed" if number != 3 else "failed", "requested_input_hash": checkpoint["requested_input_hash"]}
        annotation = {"requested_input_hash": checkpoint["requested_input_hash"], "status": "completed", "annotation": {"unknown": False}}
        grade = {"id": checkpoint["id"], "prediction_hash": hash_v1(prediction), "annotation_hash": hash_v1(annotation), "status": "completed", "ranked_ids": ["first", "second", "unknown"], "matches": [number == 0, number == 1, False]}
        queue.append(checkpoint)
        predictions.append(prediction)
        annotations.append(annotation)
        grades.append(grade)
    result = requested_goal_report(queue, predictions, annotations, grades, bootstrap_samples=100)
    assert result["goalTop1"] == .25
    assert result["goalTop3"] == .5
    assert result["failures"]["prediction"] == 1
    assert result["goalTop1FamilyInterval"]["families"] == 4
    assert "automated" in result["label"]
    with pytest.raises(ValueError, match="Missing"):
        requested_goal_report(queue, predictions, annotations, grades[:-1], bootstrap_samples=100)
    grades[0]["prediction_hash"] = "tampered"
    with pytest.raises(ValueError, match="provenance changed"):
        requested_goal_report(queue, predictions, annotations, grades, bootstrap_samples=100)
