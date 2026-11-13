import copy
import json

import pytest

from acephale import custom_native_tasks
from acephale.infra_native_runner import validate_native_task_source


def source(tmp_path, monkeypatch):
    directory = tmp_path / "data/tau2/domains/retail"
    directory.mkdir(parents=True)
    (directory / "tasks.json").write_text(json.dumps([{"id": "official"}]))
    item = {"domain": "retail", "taskId": "custom", "familyId": "fit", "task": {"id": "custom"}}
    bundle = {"tasks": [item]}
    receipt = {"contentHash": "a" * 64}
    partition = {"families": {"fit": "weight_fit"}}
    monkeypatch.setattr(custom_native_tasks, "verify_custom_bundle", lambda *args: (receipt, bundle, partition))
    config = {"stage": "collection", "customTaskBundleDirectory": str(tmp_path),
              "customTaskReceiptHash": "a" * 64, "collectionPartitions": ["weight_fit", "calibration"],
              "runs": [{"domain": "retail", "taskId": "custom", "familyId": "fit"}]}
    return config, {("retail", "custom"): copy.deepcopy(item)}


def test_custom_native_source_requires_exact_receipt_task_and_partition(tmp_path, monkeypatch):
    config, tasks = source(tmp_path, monkeypatch)
    validate_native_task_source(config, tasks, tmp_path)
    for changed in ({**config, "customTaskReceiptHash": "b" * 64},
                    {**config, "customTaskReceiptHash": ""},
                    {**config, "stage": "heldout"},
                    {**config, "collectionPartitions": ["test"]}):
        with pytest.raises(ValueError):
            validate_native_task_source(changed, tasks, tmp_path)
    tasks["retail", "custom"]["task"]["id"] = "tampered"
    with pytest.raises(ValueError, match="differs"):
        validate_native_task_source(config, tasks, tmp_path)


def test_missing_custom_provenance_cannot_replace_official_tasks(tmp_path, monkeypatch):
    config, tasks = source(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="pinned upstream"):
        validate_native_task_source({"runs": config["runs"]}, tasks, tmp_path)
