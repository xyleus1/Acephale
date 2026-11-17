import json

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.replay_receipt import verify_replay_receipt
from acephale.storage import file_hash


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def retained_fixture(directory):
    message = {"role": "assistant", "content": '{"action":"READ","hits":[0]}'}
    body = {"version": 1, "requestId": "rank-1", "model": "test/model", "inputHash": "a" * 64,
            "requestContractHash": "b" * 64, "responseHash": hash_v1(message), "continuation": message,
            "text": message["content"], "logprobs": [], "finishReason": "stop", "usage": None}
    response = {**body, "contentHash": hash_v1(body)}
    record = {"checkpoint_id": "one", "publicInputHash": "c" * 64, "response": response}
    write(directory / "model-responses.jsonl", record)
    event = {"type": "model_response_retained", "requestId": body["requestId"], "inputHash": body["inputHash"],
             "requestContractHash": body["requestContractHash"], "responseHash": body["responseHash"],
             "responsePayloadHash": response["contentHash"]}
    rows = [{"checkpoint_id": "one", "input_hash": "c" * 64, "status": "failed", "audit": {"events": [event]}}]
    receipt = {"declared": 1, "completed": 0, "failed": 1, "liveActorExecuted": False, "toolExecutionPerformed": False,
               "responsePayloads": {"version": 1, "file": "model-responses.jsonl", "count": 1,
                                    "sha256": file_hash(directory / "model-responses.jsonl")}}
    write(directory / "receipt.json", receipt)
    return {"responseRetentionVersion": 1}, rows, receipt, record


def test_preserves_failed_response_and_checks_legacy_receipt(tmp_path):
    manifest, rows, receipt, _ = retained_fixture(tmp_path)
    assert len(verify_replay_receipt(tmp_path, manifest, rows)) == 2
    del receipt["responsePayloads"]
    write(tmp_path / "receipt.json", receipt)
    assert len(verify_replay_receipt(tmp_path, {}, rows)) == 1
    with pytest.raises(ValueError, match="declaration"):
        verify_replay_receipt(tmp_path, manifest, rows)


@pytest.mark.parametrize("defect", ["bytes", "count", "path", "version", "checkpoint", "inner_hash", "continuation", "event", "omitted"])
def test_rejects_corrupt_retention_or_dispatch_evidence(tmp_path, defect):
    manifest, rows, receipt, record = retained_fixture(tmp_path)
    if defect == "bytes":
        (tmp_path / "model-responses.jsonl").write_text("{}\n", encoding="utf-8")
    elif defect == "count":
        receipt["responsePayloads"]["count"] = 2
    elif defect == "path":
        receipt["responsePayloads"]["file"] = "../model-responses.jsonl"
    elif defect == "version":
        manifest["responseRetentionVersion"] = 2
    elif defect == "event":
        rows[0]["audit"]["events"][0]["requestId"] = "other"
    elif defect == "omitted":
        rows[0]["audit"]["events"] = []
    else:
        if defect == "checkpoint":
            record["checkpoint_id"] = "other"
        elif defect == "inner_hash":
            record["response"]["text"] = "rewritten"
        else:
            record["response"]["responseHash"] = "d" * 64
            record["response"]["contentHash"] = hash_v1({key: value for key, value in record["response"].items() if key != "contentHash"})
        write(tmp_path / "model-responses.jsonl", record)
        receipt["responsePayloads"]["sha256"] = file_hash(tmp_path / "model-responses.jsonl")
    write(tmp_path / "receipt.json", receipt)
    with pytest.raises(ValueError, match="[Rr]etained"):
        verify_replay_receipt(tmp_path, manifest, rows)


@pytest.mark.parametrize("field,value", [("completed", True), ("liveActorExecuted", 0), ("extra", "unknown")])
def test_rejects_changed_closure_fields(tmp_path, field, value):
    manifest, rows, receipt, _ = retained_fixture(tmp_path)
    receipt[field] = value
    write(tmp_path / "receipt.json", receipt)
    with pytest.raises(ValueError, match="close"):
        verify_replay_receipt(tmp_path, manifest, rows)
