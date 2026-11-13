"""Synthetic provider records exercise protocol validation, not an actual machine audit."""

import copy
import json

import pytest

from acephale.annotation_review import (
    INDEPENDENCE,
    MACHINE_PROTOCOL,
    REVIEWER,
    review_metadata,
    verify_machine_review,
)
from acephale.contracts_v1 import canonical_v1, hash_v1
from acephale.storage import file_hash
from acephale.training_data import hashed, verify_review


def fixture(tmp_path, acceptable=18):
    inputs = [
        {
            "checkpoint_id": str(index),
            "input": {"sources": [{"id": "user", "value": "test request"}]},
            "request_revision": "fixture",
        }
        for index in range(100)
    ]
    for row in inputs:
        row["input_hash"] = hash_v1(row["input"])
    annotations = [
        {"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"], "goals": []}
        for row in inputs
    ]
    pilot = {
        "checkpoints": [{"checkpoint_id": row["checkpoint_id"]} for row in inputs],
        "audit": [{"checkpoint_id": row["checkpoint_id"]} for row in inputs[:20]],
    }
    packet = hashed(
        {
            "kind": "acephale-amended-machine-audit-packet-v1",
            "pilotHash": hash_v1(pilot),
            "humanReviewCount": 0,
            "originalPacketHash": "a" * 64,
            "cases": [
                {
                    "checkpointId": row["checkpoint_id"],
                    "publicInput": row,
                    "annotationHash": hash_v1(annotation),
                    "candidateAnnotation": annotation,
                }
                for row, annotation in zip(inputs[:20], annotations[:20], strict=True)
            ],
        }
    )
    reviews, requests, responses = [], [], []
    for index, (public, annotation) in enumerate(zip(inputs[:20], annotations[:20], strict=True)):
        body = {
            "model": REVIEWER,
            "instructions": "synthetic reviewer instruction",
            "store": False,
            "input": [
                {
                    "role": "user",
                    "content": canonical_v1(
                        {"public_checkpoint": public, "candidate_annotation": annotation}
                    ).decode(),
                }
            ],
        }
        decision = "accept" if index < acceptable else "uncertain"
        verdict = {
            "decision": decision,
            "reason": "synthetic fixture",
            "unsupportedBindings": [],
            "sourceReferences": [{"sourceId": "user"}],
        }
        text = canonical_v1(verdict).decode()
        output = [{"type": "message", "content": [{"type": "output_text", "text": text}]}]
        request_id = f"request-{index}"
        requests.append({"requestId": request_id, "body": body, "inputHash": hash_v1(body)})
        responses.append(
            {
                "requestId": request_id,
                "model": REVIEWER,
                "status": "completed",
                "output": output,
                "text": text,
                "responseHash": hash_v1(output),
            }
        )
        reviews.append(
            {
                **verdict,
                "checkpoint_id": public["checkpoint_id"],
                "input_hash": public["input_hash"],
                "annotationHash": hash_v1(annotation),
                "packetHash": packet["contentHash"],
                "reviewer": REVIEWER,
                "reviewer_model": REVIEWER,
                "review_kind": "independent_model",
                "rubric_version": "fixture",
                "semantics_acceptable": decision == "accept",
                "unsupported_binding": False,
                "status": "completed",
                "requestId": request_id,
                "requestHash": hash_v1(body),
                "responseHash": hash_v1(output),
            }
        )
    contents = {
        "api-requests.jsonl": requests,
        "raw-responses.jsonl": responses,
        "public-inputs.jsonl": inputs[:20],
    }
    for name, rows in contents.items():
        (tmp_path / name).write_bytes(b"".join(canonical_v1(row) + b"\n" for row in rows))
    (tmp_path / "machine-packet.json").write_bytes(canonical_v1(packet))
    summary = hashed(
        {
            "planned": 20,
            "retained": 20,
            "completed": 20,
            "machineReviewCount": 20,
            "failed": 0,
            "notDispatched": 0,
            "unresolvedRequests": 0,
            "humanReviewCount": 0,
            "allWorkersDrained": True,
            "fatalErrorType": None,
            "stopped": False,
            "rateLimited": False,
        }
    )
    (tmp_path / "summary.json").write_bytes(canonical_v1(summary))
    receipt = {
        "schemaVersion": 1,
        "kind": "acephale-machine-annotation-audit-v1",
        "reviewProtocol": MACHINE_PROTOCOL,
        "humanReviewCount": 0,
        "machineReviewCount": 20,
        "reviewerModel": REVIEWER,
        "teacherModel": REVIEWER,
        "reviewIndependence": INDEPENDENCE,
        "pilotHash": hash_v1(pilot),
        "packetHash": packet["contentHash"],
        "originalPacketHash": "a" * 64,
        "unresolvedRequests": 0,
        "machineThresholdPassed": True,
        "humanReviewGateSatisfied": False,
        "trainingAuthorized": False,
        "reviewsHash": hash_v1(reviews),
        "annotationHashes": sorted(hash_v1(row) for row in annotations),
        "pilotAnnotationHashes": sorted(hash_v1(row) for row in annotations),
        "promptHash": hash_v1("synthetic reviewer instruction"),
        "evidenceFiles": {
            name: file_hash(tmp_path / name)
            for name in [*contents, "machine-packet.json", "summary.json"]
        },
        "acceptedRequests": [
            {"checkpointId": row["checkpoint_id"], "requestId": row["requestId"]} for row in reviews
        ],
    }
    path = tmp_path / "receipt.json"
    path.write_bytes(canonical_v1(hashed(receipt)))
    return pilot, reviews, annotations, path


def test_machine_audit_requires_explicit_mode_and_preserves_zero_human_count(tmp_path):
    pilot, reviews, annotations, path = fixture(tmp_path)
    with pytest.raises(ValueError, match="explicit exploratory"):
        verify_review(pilot, reviews, annotations)
    result = verify_review(pilot, reviews, annotations, machine_audit=path)
    assert result["acceptable"] == 18 and result["goal_conditioning_allowed"]
    assert result["humanReviewCount"] == 0 and result["machineReviewCount"] == 20
    assert (
        review_metadata(result)["machineAuditHash"] == json.loads(path.read_text())["contentHash"]
    )


def test_three_uncertain_reviews_fail_unchanged_threshold(tmp_path):
    with pytest.raises(ValueError, match="90%"):
        verify_machine_review(*fixture(tmp_path, acceptable=17))


def test_rehashed_request_cannot_review_a_different_annotation(tmp_path):
    pilot, reviews, annotations, path = fixture(tmp_path)
    request_path = tmp_path / "api-requests.jsonl"
    requests = [json.loads(line) for line in request_path.read_text().splitlines()]
    payload = json.loads(requests[0]["body"]["input"][0]["content"])
    payload["candidate_annotation"]["goals"] = ["different"]
    requests[0]["body"]["input"][0]["content"] = canonical_v1(payload).decode()
    requests[0]["inputHash"] = reviews[0]["requestHash"] = hash_v1(requests[0]["body"])
    request_path.write_bytes(b"".join(canonical_v1(row) + b"\n" for row in requests))
    receipt = json.loads(path.read_text())
    receipt.pop("contentHash")
    receipt["reviewsHash"] = hash_v1(reviews)
    receipt["evidenceFiles"][request_path.name] = file_hash(request_path)
    path.write_bytes(canonical_v1(hashed(receipt)))
    with pytest.raises(ValueError, match="exact current public input"):
        verify_machine_review(pilot, reviews, annotations, path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("humanReviewCount", 20),
        ("humanReviewCount", False),
        ("reviewerModel", "other-model"),
        ("reviewIndependence", "human"),
    ],
)
def test_rehashed_receipt_cannot_claim_humans_or_other_model(tmp_path, field, value):
    pilot, reviews, annotations, path = fixture(tmp_path)
    receipt = json.loads(path.read_text())
    receipt.pop("contentHash")
    receipt[field] = value
    path.write_bytes(canonical_v1(hashed(receipt)))
    with pytest.raises(ValueError):
        verify_machine_review(pilot, reviews, annotations, path)


def test_calibration_reuse_retains_exact100_but_does_not_admit_calibration_as_fitting(tmp_path):
    pilot, reviews, annotations, path = fixture(tmp_path)
    extended = [*annotations, {"checkpoint_id": "cal", "input_hash": "b" * 64, "goals": []}]
    with pytest.raises(ValueError, match="complete372"):
        verify_machine_review(pilot, reviews, extended, path)
    assert (
        verify_machine_review(pilot, reviews, extended, path, calibration=True)[
            "machineReviewCount"
        ]
        == 20
    )
    changed = copy.deepcopy(extended)
    changed[99]["goals"] = ["changed"]
    with pytest.raises(ValueError, match="original100"):
        verify_machine_review(pilot, reviews, changed, path, calibration=True)


def test_resealed_packet_cannot_substitute_a_candidate(tmp_path):
    pilot, reviews, annotations, path = fixture(tmp_path)
    packet_path = tmp_path / "machine-packet.json"
    packet = json.loads(packet_path.read_text())
    packet.pop("contentHash")
    packet["cases"][0]["candidateAnnotation"]["goals"] = ["changed"]
    packet = hashed(packet)
    packet_path.write_bytes(canonical_v1(packet))
    for review in reviews:
        review["packetHash"] = packet["contentHash"]
    receipt = json.loads(path.read_text())
    receipt.pop("contentHash")
    receipt.update(packetHash=packet["contentHash"], reviewsHash=hash_v1(reviews))
    receipt["evidenceFiles"][packet_path.name] = file_hash(packet_path)
    path.write_bytes(canonical_v1(hashed(receipt)))
    with pytest.raises(ValueError, match="Machine packet"):
        verify_machine_review(pilot, reviews, annotations, path)


def test_closed_audit_cannot_hide_undrained_requests(tmp_path):
    pilot, reviews, annotations, path = fixture(tmp_path)
    summary_path = tmp_path / "summary.json"
    summary = json.loads(summary_path.read_text())
    summary.pop("contentHash")
    summary["allWorkersDrained"] = False
    summary_path.write_bytes(canonical_v1(hashed(summary)))
    receipt = json.loads(path.read_text())
    receipt.pop("contentHash")
    receipt["evidenceFiles"][summary_path.name] = file_hash(summary_path)
    path.write_bytes(canonical_v1(hashed(receipt)))
    with pytest.raises(ValueError, match="drained"):
        verify_machine_review(pilot, reviews, annotations, path)


@pytest.mark.parametrize(
    "field,value", [("reviewerModel", REVIEWER), ("reviewIndependence", INDEPENDENCE)]
)
def test_machine_metadata_cannot_masquerade_as_legacy_human(field, value):
    with pytest.raises(ValueError, match="human review"):
        review_metadata({field: value})
