import json

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import bind_annotation_draft, publish_bundle
from acephale.native_review import RUBRIC, prepare_native_review
from acephale.training_data import verify_review


def review_fixture(tmp_path, *, private=False):
    public, inputs, annotations = [], [], []
    split = {"families": {f"family-{index}": "train" for index in range(10)}}
    for index in range(100):
        value = {"policy": "Read only", "events": [], "tools": [], "sources": [
            {"id": "requirement:0", "kind": "user", "value": f"Read record {index} <script>alert('untrusted')</script>"}]}
        if private:
            value["private_state"] = {"future": "not public"}
        row = {"checkpoint_id": f"cp-{index}", "input_hash": hash_v1(value), "request_revision": f"request-{index}", "input": value}
        inputs.append(row)
        public.append({**row, "split": "train", "domain": "retail" if index % 2 else "airline", "family_id": f"family-{index % 10}"})
        annotation = bind_annotation_draft({"unknown_probability": 0, "goals": [{"action": "retrieve", "object_type": "record",
            "objective": f"Read record {index}", "confidence": 1, "sources": [{"source_id": "requirement:0", "pointer": ""}], "constraints": []}]},
            row, teacher_model="teacher-fixture", annotation_version="acephale-infra-annotation-v1")
        annotations.append(annotation.model_dump(mode="json"))
    dataset = tmp_path / "dataset"
    manifest = publish_bundle(dataset, {"public.jsonl": public, "split.json": split})
    pilot = {"pilot_count": 100, "audit_count": 20, "source_dataset_hash": manifest["bundle_hash"], "source_split_hash": hash_v1(split),
             "checkpoints": [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"]} for row in inputs],
             "audit": [{"checkpoint_id": row["checkpoint_id"], "reason": "predeclared"} for row in inputs[:20]]}
    pilot_directory = tmp_path / "pilot"
    publish_bundle(pilot_directory, {"pilot.json": pilot, "annotation-inputs.jsonl": inputs})
    annotations_path = tmp_path / "annotations.jsonl"
    annotations_path.write_text("".join(json.dumps(row) + "\n" for row in annotations), encoding="utf-8")
    return pilot_directory, dataset, annotations_path, pilot, annotations


def test_native_review_stays_pending_and_exports_source_bound_human_decisions(tmp_path):
    pilot_directory, dataset, annotations_path, pilot, annotations = review_fixture(tmp_path)
    output = tmp_path / "review"
    result = prepare_native_review(pilot_directory, dataset, annotations_path, output)
    packet = json.loads((output / "packet.json").read_text(encoding="utf-8"))
    page = (output / "review.html").read_text(encoding="utf-8")
    assert result["status"] == "pending_human_review" and len(packet["cases"]) == 20
    assert not (output / "reviews.jsonl").exists()
    assert " checked" not in page and 'id="download" disabled' in page
    assert "<script>alert('untrusted')</script>" not in page
    assert "&lt;script&gt;" in page and "join('\\n')" in page
    assert "connect-src 'none'" in page
    assert (output / "review-pilot.json").read_bytes() == (pilot_directory / "pilot.json").read_bytes()
    assert (output / "annotations.jsonl").read_bytes() == annotations_path.read_bytes()
    reviews = [{"checkpoint_id": case["checkpointId"], "annotationHash": case["annotationHash"], "reviewer": "test-fixture-only",
                "rubric_version": RUBRIC, "semantics_acceptable": True, "unsupported_binding": False} for case in packet["cases"]]
    assert verify_review(pilot, reviews, annotations)["goal_conditioning_allowed"] is True
    reviews[0]["unsupported_binding"] = True
    with pytest.raises(ValueError, match="audit failed"):
        verify_review(pilot, reviews, annotations)
    with pytest.raises(FileExistsError):
        prepare_native_review(pilot_directory, dataset, annotations_path, output)


@pytest.mark.parametrize("defect", ["missing", "duplicate", "stale_revision", "changed_binding"])
def test_native_review_rejects_incomplete_or_changed_annotations(tmp_path, defect):
    pilot_directory, dataset, annotations_path, _, annotations = review_fixture(tmp_path)
    if defect == "missing":
        annotations.pop()
    elif defect == "duplicate":
        annotations.append(annotations[0])
    elif defect == "stale_revision":
        annotations[0]["request_revision"] = "another-request"
    else:
        annotations[0]["goals"][0]["sources"][0]["value_hash"] = "0" * 64
    annotations_path.write_text("".join(json.dumps(row) + "\n" for row in annotations), encoding="utf-8")
    with pytest.raises(ValueError):
        prepare_native_review(pilot_directory, dataset, annotations_path, tmp_path / "review")
    assert not (tmp_path / "review").exists()


def test_native_review_rejects_private_fields_before_writing_a_packet(tmp_path):
    pilot_directory, dataset, annotations_path, _, _ = review_fixture(tmp_path, private=True)
    with pytest.raises(ValueError, match="Private field"):
        prepare_native_review(pilot_directory, dataset, annotations_path, tmp_path / "review")
