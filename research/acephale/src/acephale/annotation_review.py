"""Explicit machine audit provenance, separate from the existing human review mode."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import canonical_v1, hash_v1
from acephale.infra_data import audit_gate, read_jsonl
from acephale.storage import file_hash

MACHINE_PROTOCOL = "machine_audited_exploratory"
HUMAN_PROTOCOL = "human_reviewed"
REVIEWER = "gpt-5.4-2026-03-05"
INDEPENDENCE = "separate_request_and_prompt_same_model"
METADATA_KEYS = ("reviewProtocol", "humanReviewCount", "machineReviewCount", "machineAuditHash", "reviewerModel", "reviewIndependence")


def require(value: Any, message: str) -> None:
    if not value:
        raise ValueError(message)


def content_checked(value: dict[str, Any]) -> dict[str, Any]:
    require(value.get("contentHash") == hash_v1({key: item for key, item in value.items() if key != "contentHash"}),
            "Machine audit content hash differs")
    return value


def review_metadata(value: dict[str, Any]) -> dict[str, Any]:
    """Absent protocol remains the historical human mode; machine mode is explicit."""
    protocol = value.get("reviewProtocol", HUMAN_PROTOCOL)
    require(protocol in {HUMAN_PROTOCOL, MACHINE_PROTOCOL}, "Unknown annotation review protocol")
    if protocol == HUMAN_PROTOCOL:
        require(not value.get("machineReviewCount", 0) and not value.get("machineAuditHash")
                and not value.get("reviewerModel") and not value.get("reviewIndependence"),
                "Machine review cannot be admitted as human review")
        return {"reviewProtocol": HUMAN_PROTOCOL, "humanReviewCount": value.get("audited", value.get("humanReviewCount", 20)),
                "machineReviewCount": 0}
    require(type(value.get("humanReviewCount")) is int and type(value.get("machineReviewCount")) is int
            and value.get("humanReviewCount") == 0 and value.get("machineReviewCount") == 20
            and re.fullmatch(r"[a-f0-9]{64}", str(value.get("machineAuditHash", "")))
            and value.get("reviewerModel") == REVIEWER and value.get("reviewIndependence") == INDEPENDENCE,
            "Exploratory machine review requires its exact zero-human,20-model provenance")
    return {key: value[key] for key in METADATA_KEYS}


def verify_machine_review(pilot: dict[str, Any], reviews: list[dict[str, Any]], annotations: list[dict[str, Any]],
                          artifact_path: Path, *, calibration: bool = False) -> dict[str, Any]:
    """Recheck exact reviewed labels and retained request/response evidence before fitting."""
    artifact_path = Path(artifact_path)
    receipt = content_checked(json.loads(artifact_path.read_text(encoding="utf-8")))
    receipt_sha = file_hash(artifact_path)
    by_id = {row["checkpoint_id"]: row for row in annotations}
    expected = [row["checkpoint_id"] for row in pilot["audit"]]
    require(len(expected) == len(set(expected)) == len(reviews) == 20 and len(by_id) == len(annotations)
            and {row["checkpoint_id"] for row in reviews} == set(expected),
            "Machine review must cover exactly the original20 audit identities")
    require(receipt.get("schemaVersion") == 1 and receipt.get("kind") == "acephale-machine-annotation-audit-v1"
            and receipt.get("reviewProtocol") == MACHINE_PROTOCOL
            and type(receipt.get("humanReviewCount")) is int and type(receipt.get("machineReviewCount")) is int
            and receipt.get("humanReviewCount") == 0
            and receipt.get("machineReviewCount") == 20 and receipt.get("reviewerModel") == REVIEWER
            and receipt.get("teacherModel") == REVIEWER and receipt.get("reviewIndependence") == INDEPENDENCE
            and receipt.get("pilotHash") == hash_v1(pilot) and receipt.get("reviewsHash") == hash_v1(reviews)
            and re.fullmatch(r"[a-f0-9]{64}", str(receipt.get("packetHash", "")))
            and re.fullmatch(r"[a-f0-9]{64}", str(receipt.get("promptHash", ""))),
            "Machine audit must bind the exact pilot, complete labels, packet and declared reviewer")
    pilot_ids = [row["checkpoint_id"] for row in pilot["checkpoints"]]
    require(len(pilot_ids) == len(set(pilot_ids)) == 100 and set(expected) <= set(pilot_ids) <= set(by_id)
            and receipt.get("pilotAnnotationHashes") == sorted(hash_v1(by_id[checkpoint]) for checkpoint in pilot_ids)
            and (calibration or receipt.get("annotationHashes") == sorted(hash_v1(row) for row in annotations)),
            "Machine audit must retain the exact original100 labels; fitting also binds the complete372 source")
    files = receipt.get("evidenceFiles", {})
    require(isinstance(files, dict) and {"api-requests.jsonl", "raw-responses.jsonl", "public-inputs.jsonl", "machine-packet.json", "summary.json"} <= files.keys(),
            "Machine audit needs immutable actual request and raw response evidence")
    for name, digest in files.items():
        path = artifact_path.parent / name
        require(isinstance(name, str) and Path(name).name == name and name not in {".", ".."}
                and path.is_file() and not path.is_symlink() and file_hash(path) == digest,
                "Machine audit evidence file changed")
    packet = content_checked(json.loads((artifact_path.parent / "machine-packet.json").read_text(encoding="utf-8")))
    require(packet["contentHash"] == receipt["packetHash"], "Machine review packet changed")
    public_rows = read_jsonl(artifact_path.parent / "public-inputs.jsonl")
    public = {row["checkpoint_id"]: row for row in public_rows}
    require(len(public_rows) == len(public) == 20 and set(public) == set(expected)
            and all(row.get("input_hash") == hash_v1(row.get("input")) for row in public_rows),
            "Machine review must use the exact20 source-grounded public inputs")
    require(packet.get("kind") == "acephale-amended-machine-audit-packet-v1"
            and packet.get("pilotHash") == hash_v1(pilot) and type(packet.get("humanReviewCount")) is int
            and packet.get("humanReviewCount") == 0 and packet.get("originalPacketHash") == receipt.get("originalPacketHash")
            and re.fullmatch(r"[a-f0-9]{64}", str(packet.get("originalPacketHash", "")))
            and packet.get("cases") == [{"checkpointId": checkpoint, "publicInput": public[checkpoint],
                 "annotationHash": hash_v1(by_id[checkpoint]), "candidateAnnotation": by_id[checkpoint]} for checkpoint in expected],
            "Machine packet must bind the same20 identities, exact public inputs and current annotations")
    summary = content_checked(json.loads((artifact_path.parent / "summary.json").read_text(encoding="utf-8")))
    require(all(type(summary.get(key)) is int and summary[key] == 20 for key in ("planned", "retained", "completed", "machineReviewCount"))
            and all(type(summary.get(key)) is int and summary[key] == 0 for key in ("failed", "notDispatched", "unresolvedRequests", "humanReviewCount"))
            and summary.get("allWorkersDrained") is True and summary.get("fatalErrorType") is None
            and summary.get("stopped") is False and summary.get("rateLimited") is False
            and receipt.get("unresolvedRequests") == 0 and receipt.get("machineThresholdPassed") is True
            and receipt.get("humanReviewGateSatisfied") is False and receipt.get("trainingAuthorized") is False,
            "Machine audit requires all20 completed, drained and accounted judgments without claiming human approval")
    requests = read_jsonl(artifact_path.parent / "api-requests.jsonl")
    responses = read_jsonl(artifact_path.parent / "raw-responses.jsonl")
    request_map = {row["requestId"]: row for row in requests}
    response_map = {row["requestId"]: row for row in responses}
    require(len(request_map) == len(requests) and len(response_map) == len(responses)
            and set(response_map) <= set(request_map), "Duplicate or uncorrelated machine review evidence")
    require(receipt.get("acceptedRequests") == [{"checkpointId": row["checkpoint_id"], "requestId": row["requestId"]} for row in reviews]
            and len({row["requestId"] for row in reviews}) == 20,
            "Each accepted machine judgment requires its own correlated request")
    for row in reviews:
        annotation = by_id.get(row["checkpoint_id"])
        require(annotation is not None and row.get("annotationHash") == hash_v1(annotation)
                and row.get("input_hash") == annotation.get("input_hash")
                and row.get("packetHash") == receipt["packetHash"] and row.get("review_kind") == "independent_model"
                and row.get("reviewer") == row.get("reviewer_model") == REVIEWER
                and row.get("status") == "completed" and row.get("decision") in {"accept", "incorrect", "uncertain"}
                and isinstance(row.get("reason"), str) and bool(row["reason"].strip())
                and isinstance(row.get("rubric_version"), str) and bool(row["rubric_version"].strip())
                and type(row.get("semantics_acceptable")) is bool and type(row.get("unsupported_binding")) is bool
                and row["semantics_acceptable"] == (row["decision"] == "accept")
                and isinstance(row.get("unsupportedBindings"), list)
                and row["unsupported_binding"] == bool(row["unsupportedBindings"]),
                "Machine judgment must bind the exact label and distinguish uncertainty from acceptance")
        request = request_map.get(row["requestId"])
        response = response_map.get(row["requestId"])
        require(request is not None and response is not None, "Accepted machine review lacks actual provider evidence")
        body = request["body"]
        checkpoint = public[row["checkpoint_id"]]
        payload = {"public_checkpoint": checkpoint, "candidate_annotation": annotation}
        require(request.get("inputHash") == hash_v1(body) == row.get("requestHash")
                and body.get("model") == REVIEWER and hash_v1(body.get("instructions")) == receipt["promptHash"]
                and body.get("store") is False and checkpoint["input_hash"] == row["input_hash"]
                and body.get("input") == [{"role": "user", "content": canonical_v1(payload).decode()}],
                "Actual review request differs from the exact current public input, annotation, model or prompt")
        require(response.get("model") == REVIEWER and response.get("status") == "completed"
                and response.get("responseHash") == hash_v1(response.get("output")) == row.get("responseHash"),
                "Actual review response identity or output hash differs")
        text = "".join(part["text"] for item in response["output"] if item.get("type") == "message"
                       for part in item.get("content", []) if part.get("type") == "output_text")
        require(response.get("text") == text, "Review text differs from actual provider output")
        verdict = json.loads(text)
        require(all(verdict.get(key) == row.get(key) for key in ("decision", "reason", "unsupportedBindings", "sourceReferences")),
                "Accepted review differs from the retained model judgment")
        sources = {source["id"]: source for source in checkpoint["input"]["sources"]}
        require(isinstance(row.get("sourceReferences"), list)
                and (row["decision"] != "accept" or bool(row["sourceReferences"]))
                and all(isinstance(reference, dict) and set(reference) == {"sourceId"}
                        and reference["sourceId"] in sources for reference in row["sourceReferences"]),
                "Machine review references must name currently visible sources")
    audit = audit_gate(pilot, reviews)
    require(audit["goal_conditioning_allowed"], "Machine annotation audit failed the unchanged90%/zero-unsupported threshold")
    require(file_hash(artifact_path) == receipt_sha
            and all(file_hash(artifact_path.parent / name) == digest for name, digest in files.items()),
            "Machine audit evidence changed during validation")
    metadata = {"reviewProtocol": MACHINE_PROTOCOL, "humanReviewCount": 0, "machineReviewCount": 20,
                "machineAuditHash": receipt["contentHash"], "reviewerModel": REVIEWER, "reviewIndependence": INDEPENDENCE}
    return {**audit, **metadata, "pilotHash": hash_v1(pilot), "reviewsHash": hash_v1(reviews),
            "annotationHashes": sorted(hash_v1(row) for row in annotations), "packetHash": receipt["packetHash"],
            "machineAuditEvidenceHash": hash_v1(files),
            "limitation": "Exploratory machine audit; zero human reviews; same teacher model in a separate request and prompt"}
