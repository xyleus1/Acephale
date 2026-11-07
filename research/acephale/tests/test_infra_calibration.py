from __future__ import annotations

import json
from copy import deepcopy

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_calibration import fit_calibration, fit_paired_calibration
from acephale.infra_cli import main
from acephale.infra_data import publish_bundle
from acephale.infra_evaluation import score_fixed_panel_replay


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
    body = {"version": 2, "probabilitySemantics": "independent_next_batch_hit", "predictionMode": "selected_candidates", "kind": "uncalibrated_prediction_replay", "executionAllowed": False,
            "model": {"repository": "test/model", "revision": "b" * 40}, "memoryHash": "c" * 64,
            "sourceDatasetHash": bundle_manifest["bundle_hash"], "inferGoals": False,
            "predictorContractHash": "d" * 64, "candidateCompilerHash": "e" * 64, "retrievalHash": "f" * 64,
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
    assert calibration["version"] == 2
    assert calibration["probabilitySemantics"] == "independent_next_batch_hit"
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


@pytest.mark.parametrize("status", ["failed", "not_dispatched"])
def test_failed_and_unstarted_rows_are_retained_without_fabricated_scores(tmp_path, status):
    bundle, directory, predictions = fixture(tmp_path)
    predictions[0] = {key: value for key, value in predictions[0].items() if key not in {"candidates", "neutral", "conditional"}}
    predictions[0]["status"] = status
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    (directory / "receipt.json").write_text(json.dumps({"declared": 4, "completed": 3, "failed": 1, "liveActorExecuted": False, "toolExecutionPerformed": False}), encoding="utf-8")
    _, report, rows = fit_calibration(bundle, directory)
    assert report["declaredCheckpoints"] == 4
    assert report["failedCheckpoints"] == ["train-0"]
    assert report["notDispatchedCheckpoints"] == (["train-0"] if status == "not_dispatched" else [])
    assert len(rows) == 3 and all(row["checkpoint_id"] != "train-0" for row in rows)


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


def test_paired_calibration_fits_separate_conditions_and_binds_both_hashes(tmp_path):
    bundle, directory, predictions = fixture(tmp_path)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    manifest.pop("contentHash")
    manifest["inferGoals"] = True
    manifest["contentHash"] = hash_v1(manifest)
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for row in predictions:
        # No references would be invalid, so use the existing empty-source
        # fixture's current user event as public evidence for the conditional run.
        row["goals"] = {"schemaVersion": 1, "revisionHash": hash_v1({}), "unknown": 0,
                        "hypotheses": [{"id": "goal", "objective": "Read documents", "probability": 1,
                                        "constraints": [], "sources": [{"sourceId": "requirement:0", "path": []}]}]}
        row["conditional"] = {"action": "READ", "scores": [{"candidateId": "candidate", "probability": .2}]}
    public = [json.loads(line) for line in (bundle / "public.jsonl").read_text(encoding="utf-8").splitlines()]
    labels = [json.loads(line) for line in (bundle / "labels.jsonl").read_text(encoding="utf-8").splitlines()]
    for prefix, label, prediction in zip(public, labels, predictions, strict=True):
        prefix["input"]["events"] = [{"kind": "message", "role": "user", "seq": 0, "content": "Read documents"}]
        prefix["input_hash"] = hash_v1(prefix["input"])
        label["input_hash"] = prediction["input_hash"] = prefix["input_hash"]
    new_bundle = tmp_path / "conditional-bundle"
    new_manifest = publish_bundle(new_bundle, {"public.jsonl": public, "labels.jsonl": labels})
    manifest.pop("contentHash")
    manifest["sourceDatasetHash"] = new_manifest["bundle_hash"]
    manifest["contentHash"] = hash_v1(manifest)
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    artifact, report, joined = fit_paired_calibration(new_bundle, directory)
    conditional = artifact["conditionalCalibration"]
    assert conditional["bins"] != artifact["bins"]
    assert conditional["provenance"]["condition"] == "conditional"
    assert conditional["contentHash"] == hash_v1({key: value for key, value in conditional.items() if key != "contentHash"})
    assert artifact["contentHash"] == hash_v1({key: value for key, value in artifact.items() if key != "contentHash"})
    assert len(joined) == 8 and report["heldoutClaim"] is False


def test_independent_multihit_scores_are_not_normalized(tmp_path):
    bundle, directory, predictions = fixture(tmp_path)
    for row in predictions:
        second = deepcopy(row["candidates"][0])
        second["id"] = "second"
        second["invocation"]["arguments"] = {"id": "second"}
        row["candidates"].append(second)
        row["neutral"]["scores"].append({"candidateId": "second", "probability": .9})
    labels = [json.loads(line) for line in (bundle / "labels.jsonl").read_text(encoding="utf-8").splitlines()]
    for row in labels:
        row["eligible_reads"].append({"tool": "get", "arguments": {"id": "second"}})
    public = [json.loads(line) for line in (bundle / "public.jsonl").read_text(encoding="utf-8").splitlines()]
    multihit_bundle = tmp_path / "multihit"
    data_manifest = publish_bundle(multihit_bundle, {"public.jsonl": public, "labels.jsonl": labels})
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    manifest.pop("contentHash")
    manifest["sourceDatasetHash"] = data_manifest["bundle_hash"]
    (directory / "manifest.json").write_text(json.dumps({**manifest, "contentHash": hash_v1(manifest)}), encoding="utf-8")
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    _, _, joined = fit_calibration(multihit_bundle, directory)
    first = [row for row in joined if row["checkpoint_id"] == "train-0"]
    assert all(row["exact_match"] == 1 for row in first)
    assert sum(row["raw_probability"] for row in first) > 1
    assert sum(row["runtime_probability"] for row in first) > 1
    assert all(row["runtime_probability"] == row["calibrated_probability"] for row in joined)


def test_fixed_panel_replay_joins_private_labels_after_prediction_and_preserves_failures(tmp_path, capsys):
    bundle, directory, predictions = fixture(tmp_path)
    path = directory / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest.pop("contentHash")
    manifest["predictionMode"] = "fixed_panel"
    path.write_text(json.dumps({**manifest, "contentHash": hash_v1(manifest)}), encoding="utf-8")
    for row in predictions:
        row["candidatePanel"] = ["candidate"]
        row["panelHash"] = hash_v1(["candidate"])
    predictions[0]["status"] = "failed"
    del predictions[0]["neutral"]
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    (directory / "receipt.json").write_text(json.dumps({"declared": 4, "completed": 3, "failed": 1, "liveActorExecuted": False, "toolExecutionPerformed": False}), encoding="utf-8")
    report, joined = score_fixed_panel_replay(bundle, directory)
    assert report["conditions"]["neutral"]["declared_checkpoints"] == 4
    assert report["conditions"]["neutral"]["scored_checkpoints"] == 3
    assert report["heldout_claim"] is False
    assert len(joined) == 4 and joined[0]["probabilities"] is None
    output = tmp_path / "panel-report"
    main(["score-panel-replay", "--bundle", str(bundle), "--predictions", str(directory), "--output", str(output)])
    assert (output / "prediction-report.json").is_file()
    assert (output / "joined-panels.parquet").is_file()
    assert "bundle_hash" in capsys.readouterr().out
    predictions[1]["neutral"]["scores"] = []
    (directory / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in predictions), encoding="utf-8")
    with pytest.raises(ValueError, match="explicit independent score"):
        score_fixed_panel_replay(bundle, directory)


def test_legacy_categorical_calibration_cannot_be_relabelled_as_v2(tmp_path):
    bundle, directory, _ = fixture(tmp_path)
    path = directory / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest.pop("contentHash")
    manifest["version"] = 1
    path.write_text(json.dumps({**manifest, "contentHash": hash_v1(manifest)}), encoding="utf-8")
    with pytest.raises(ValueError, match="semantics"):
        fit_calibration(bundle, directory)
