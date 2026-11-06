from __future__ import annotations

import json

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_calibration import fit_calibration
from goalspec.infra_cli import main
from goalspec.infra_data import publish_bundle


def fixture(tmp_path, *, reverse_development=False, heldout=False, cross_family=False):
    public, labels, predictions = [], [], []
    for partition in ("train", "development"):
        for index in range(2):
            key = f"{partition}-{index}"
            split = "test" if heldout and partition == "development" else partition
            family = "same-family" if cross_family else f"family-{partition}"
            value = {"policy": "Read documents", "tools": [{"name": "get", "parameters": {"type": "object", "additionalProperties": False, "properties": {"id": {"type": "string"}}, "required": ["id"]}, "side_effects": "read_only", "cacheable": True}], "events": [], "sources": []}
            public.append({"checkpoint_id": key, "input_hash": hash_v1(value), "family_id": family, "split": split, "scope": {"tenant_id": "research", "principal_id": "actor", "authorization_revision": "auth1"}, "environment_version": "env1", "tool_schema_hash": "a" * 64, "input": value})
            actual = "wrong" if reverse_development and partition == "development" else "correct"
            labels.append({"checkpoint_id": key, "input_hash": hash_v1(value), "eligible_reads": [{"tool": "get", "arguments": {"id": actual}}]})
            invocation = {"tool": "get", "arguments": {"id": "correct" if index == 0 else "wrong"}, "scope": {"tenantId": "research", "principalId": "actor", "authorizationVersion": "auth1", "environmentVersion": "env1", "toolSchemaHash": "a" * 64}}
            predictions.append({"checkpoint_id": key, "input_hash": hash_v1(value), "family_id": family, "split": split, "status": "completed", "candidates": [{"id": "candidate", "invocation": invocation}], "neutral": {"action": "READ", "scores": [{"candidateId": "candidate", "probability": .8 if index == 0 else .2}]}, "conditional": None})
    bundle = tmp_path / "bundle"
    bundle_manifest = publish_bundle(bundle, {"public.jsonl": public, "labels.jsonl": labels})
    prediction_directory = tmp_path / "predictions"
    prediction_directory.mkdir()
    body = {"version": 1, "kind": "uncalibrated_prediction_replay", "executionAllowed": False,
            "model": {"repository": "test/model", "revision": "b" * 40}, "memoryHash": "c" * 64,
            "sourceDatasetHash": bundle_manifest["bundle_hash"], "inferGoals": False,
            "predictorContractHash": "d" * 64, "candidateCompilerHash": "e" * 64,
            "rowIds": [row["checkpoint_id"] for row in predictions]}
    (prediction_directory / "manifest.json").write_text(json.dumps({**body, "contentHash": hash_v1(body)}), encoding="utf-8")
    (prediction_directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    (prediction_directory / "receipt.json").write_text(json.dumps({"declared": 4, "completed": 4, "failed": 0, "liveActorExecuted": False, "toolExecutionPerformed": False}), encoding="utf-8")
    return bundle, prediction_directory, predictions


def test_bins_fit_training_only_and_preserve_runtime_wire_hash(tmp_path):
    bundle, predictions, _ = fixture(tmp_path)
    calibration, report, joined = fit_calibration(bundle, predictions)
    assert calibration["bins"] == [{"upper": .2, "probability": 1 / 3, "count": 1}, {"upper": 1, "probability": 2 / 3, "count": 1}]
    assert calibration["fittingFamilies"] == ["family-train"]
    assert calibration["validationFamilies"] == ["family-development"]
    assert calibration["contentHash"] == hash_v1({key: value for key, value in calibration.items() if key != "contentHash"})
    assert calibration["provenance"]["condition"] == "neutral"
    assert calibration["provenance"]["model"]["revision"] == "b" * 40
    assert report["validationUsedForFit"] is False
    assert report["development"]["runtime_probability"]["samples"] == 2
    assert len(joined) == 4


def test_reversing_development_labels_cannot_change_fitted_bins(tmp_path):
    left = tmp_path / "left"
    right = tmp_path / "right"
    left.mkdir()
    right.mkdir()
    b1, p1, _ = fixture(left)
    b2, p2, _ = fixture(right, reverse_development=True)
    c1, r1, _ = fit_calibration(b1, p1)
    c2, r2, _ = fit_calibration(b2, p2)
    assert c1["bins"] == c2["bins"]
    assert r1["development"]["runtime_probability"]["brier"] != r2["development"]["runtime_probability"]["brier"]


def test_wrong_public_hash_or_missing_result_rejected(tmp_path):
    bundle, directory, predictions = fixture(tmp_path)
    predictions[0]["input_hash"] = "0" * 64
    path = directory / "predictions.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    with pytest.raises(ValueError, match="input hash"):
        fit_calibration(bundle, directory)
    path.write_text("".join(json.dumps(row) + "\n" for row in predictions[1:]), encoding="utf-8")
    with pytest.raises(ValueError, match="exactly once"):
        fit_calibration(bundle, directory)


@pytest.mark.parametrize("defect", ["heldout", "cross_family"])
def test_contamination_fails_closed(tmp_path, defect):
    bundle, directory, _ = fixture(tmp_path, **{defect: True})
    with pytest.raises(ValueError, match="contamination|crosses"):
        fit_calibration(bundle, directory)


def test_scope_mismatch_is_not_an_incorrect_but_usable_candidate(tmp_path):
    bundle, directory, predictions = fixture(tmp_path)
    predictions[0]["candidates"][0]["invocation"]["scope"]["tenantId"] = "other-tenant"
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    with pytest.raises(ValueError, match="scope"):
        fit_calibration(bundle, directory)


def test_missing_prompt_identity_and_unexecuted_conditional_fail(tmp_path):
    bundle, directory, _ = fixture(tmp_path)
    with pytest.raises(ValueError, match="actually executed"):
        fit_calibration(bundle, directory, condition="conditional")
    path = directory / "manifest.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    del document["contentHash"]
    del document["predictorContractHash"]
    document["contentHash"] = hash_v1(document)
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError, match="prompt"):
        fit_calibration(bundle, directory)


def test_calibration_cli_emits_exclusive_artifact(tmp_path, capsys):
    bundle, directory, _ = fixture(tmp_path)
    output = tmp_path / "calibration"
    arguments = ["fit-calibration", "--bundle", str(bundle), "--predictions", str(directory), "--output", str(output)]
    main(arguments)
    assert (output / "calibration.json").is_file()
    assert (output / "joined-scores.parquet").is_file()
    with pytest.raises(FileExistsError):
        main(arguments)
    assert "bundle_hash" in capsys.readouterr().out
