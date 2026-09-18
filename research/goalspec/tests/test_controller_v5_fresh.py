"""Synthetic proof that fresh Base labels fit neutral weights only."""
import copy
import hashlib
import json

import pytest

from goalspec.contracts_v1 import canonical_v1
from goalspec.controller_v5 import candidate_features, train


def fresh_rows():
    rows = []
    for split in ["train", "selection", "calibration"]:
        for boundary in range(2):
            context = {"frame": {"boundary": boundary, "requestedObjective": "Read order A",
                "sources": {"requirement:0": "Read order A"}, "goals": {"hypotheses": [], "unknown": 1}},
                "goals": {"grounded": False, "set": {"hypotheses": [], "unknown": 1}}, "memory": None, "workflows": []}
            candidate = {"id": "order", "bindings": [{"sourceId": "requirement:0", "path": []}],
                "invocation": {"tool": "get_order_details", "arguments": {"order_id": "A"}}}
            rows.append({"familyId": f"retail:{split}", "split": split, "cohort": "fresh-v5-training",
                "goalSupervision": "masked-until-independent-annotation-join", "context": context,
                "candidates": [candidate], "features": [candidate_features(context, c) for c in [candidate, "NO_READ", "READ_UNCOVERED"]],
                "targets": [0], "actualRead": True})
    return rows


def write_dataset(directory, rows):
    directory.mkdir()
    data = b"\n".join(canonical_v1(row) for row in rows) + b"\n"
    (directory / "dataset.jsonl").write_bytes(data)
    (directory / "manifest.json").write_bytes(canonical_v1({"version": "goalspec-controller-dataset-v5-fresh",
        "sourcePolicy": "prior-v4-train-families-plus-fresh-v5-training-only", "datasetHash": hashlib.sha256(data).hexdigest(),
        "splits": {"retail:train": "train", "retail:selection": "selection", "retail:calibration": "calibration", "retail:unobserved": "train"}}))


def test_fresh_training_updates_neutral_but_never_unlabeled_goal_weights(tmp_path):
    pytest.importorskip("torch")
    artifacts = []
    for changed_split in [None, "calibration", "train"]:
        rows = copy.deepcopy(fresh_rows())
        for row in rows:
            if row["split"] == changed_split:
                row["targets"] = [1]
                row["actualRead"] = False
        dataset = tmp_path / f"data-{changed_split}"
        output = tmp_path / f"fit-{changed_split}"
        write_dataset(dataset, rows)
        report = train(dataset, output, epochs=2)
        artifact = json.loads((output / "controller.json").read_text(encoding="utf-8"))
        assert artifact["goalWeights"] == [0] * 72
        assert artifact["lineage"]["goalTraining"] == "none"
        assert artifact["lineage"]["trainingFamilies"] == ["retail:train"]
        assert artifact["calibration"]["reliability"]["status"] == "unavailable"
        assert report["selectedEpochs"]["goalProxy"] == 0
        assert any(artifact["neutralWeights"])
        artifacts.append(artifact)
    # Calibration labels may change temperature but cannot update weights.
    assert artifacts[0]["neutralWeights"] == artifacts[1]["neutralWeights"]
    # Fresh training labels actually change the fitted neutral ranker.
    assert artifacts[0]["neutralWeights"] != artifacts[2]["neutralWeights"]


def test_fresh_training_rejects_fabricated_goal_supervision(tmp_path):
    pytest.importorskip("torch")
    rows = fresh_rows()
    rows[0]["goalSupervision"] = "guessed-teacher-label"
    directory = tmp_path / "data"
    write_dataset(directory, rows)
    with pytest.raises(ValueError, match="explicitly masked"):
        train(directory, tmp_path / "out", epochs=1)
