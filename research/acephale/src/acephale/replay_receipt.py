"""Validate replay closure and optional retained provider-response evidence."""

import json
import re
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import read_jsonl
from acephale.storage import file_hash


def verify_replay_receipt(directory: Path, manifest: dict, predictions: list[dict]) -> dict[Path, str]:
    receipt_path = directory / "receipt.json"
    snapshots = {receipt_path: file_hash(receipt_path)}
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    completed = sum(row.get("status") == "completed" for row in predictions)
    expected = {"declared": len(predictions), "completed": completed,
                "failed": len(predictions) - completed, "liveActorExecuted": False,
                "toolExecutionPerformed": False}
    body = {key: value for key, value in receipt.items() if key != "responsePayloads"}
    if (body != expected or any(type(body.get(key)) is not int for key in ("declared", "completed", "failed"))
            or body.get("liveActorExecuted") is not False or body.get("toolExecutionPerformed") is not False):
        raise ValueError("Prediction receipt does not close the declared cohort")
    if "responseRetentionVersion" not in manifest and "responsePayloads" not in receipt:
        return snapshots
    payload = receipt.get("responsePayloads")
    if (type(manifest.get("responseRetentionVersion")) is not int or manifest["responseRetentionVersion"] != 1
            or not isinstance(payload, dict) or set(payload) != {"version", "file", "count", "sha256"}
            or type(payload.get("version")) is not int or payload["version"] != 1
            or payload.get("file") != "model-responses.jsonl"
            or type(payload.get("count")) is not int or payload["count"] < 0
            or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("sha256", "")))):
        raise ValueError("Invalid retained response declaration")
    path = directory / payload["file"]
    snapshots[path] = file_hash(path)
    if snapshots[path] != payload["sha256"]:
        raise ValueError("Retained response file hash differs")
    records = read_jsonl(path)
    if len(records) != payload["count"]:
        raise ValueError("Retained response count differs")
    observed = []
    for record in records:
        response = record.get("response", {})
        if (response.get("version") != 1
                or response.get("contentHash") != hash_v1({key: value for key, value in response.items() if key != "contentHash"})
                or response.get("responseHash") != hash_v1(response.get("continuation"))):
            raise ValueError("Retained response content hash differs")
        observed.append((record.get("checkpoint_id"), record.get("publicInputHash"), response.get("requestId"),
                         response.get("inputHash"), response.get("requestContractHash"),
                         response.get("responseHash"), response.get("contentHash")))
    expected_responses = [(row["checkpoint_id"], row["input_hash"], event.get("requestId"),
                           event.get("inputHash"), event.get("requestContractHash"),
                           event.get("responseHash"), event.get("responsePayloadHash"))
                          for row in predictions for event in row.get("audit", {}).get("events", [])
                          if event.get("type") == "model_response_retained"]
    if observed != expected_responses:
        raise ValueError("Retained responses differ from checkpoint dispatch evidence")
    if any(file_hash(path) != digest for path, digest in snapshots.items()):
        raise ValueError("Replay receipt changed during validation")
    return snapshots
