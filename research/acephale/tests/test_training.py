from __future__ import annotations

import copy
import json

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.training import (
    binary_token_ids,
    preserve_tokenizer,
    tokenize_example,
    tokenizer_identity,
    validate_training_lease,
)
from acephale.training_container import LABEL, verify_image
from acephale.training_data import (
    BASE,
    TrainingExample,
    annotation_goal_draft,
    calibration_families,
    hashed,
    pointer_path,
    prepare_dataset,
    verify_dataset,
    verify_review,
)


def example(name="one", partition="weight_fit"):
    prompt = [{"role": "user", "content": "Find my existing order."}]
    return {"schemaVersion": 1, "id": name, "familyId": "family-" + name, "partition": partition,
            "task": "rank_binary", "condition": "neutral", "prompt": prompt,
            "completion": '{"action":"READ","hits":[1,0]}', "compiledInputHash": hash_v1(prompt),
            "sourceFrameHash": hash_v1(name), "candidateIds": ["read-one", "read-two"],
            "candidateWindowHash": hash_v1(["read-one", "read-two"]), "promptTokens": 15,
            "provenance": {"sourceDatasetHash": hash_v1("source"), "publicInputHash": hash_v1(name),
                           "labelHash": hash_v1("observed"), "compilerHash": hash_v1("compiler"),
                           "tokenizerHash": hash_v1("tokenizer"), "chatTemplateHash": hash_v1("template"),
                           "sourceSplit": "train" if partition in {"weight_fit", "calibration"} else partition,
                           "observedNextBatch": True}}


def test_training_publication_is_immutable_and_detects_tampering(tmp_path):
    directory = tmp_path / "dataset"
    manifest = prepare_dataset([example(), example("cal", "calibration"), example("dev", "development")], directory)
    assert verify_dataset(directory) == manifest
    assert manifest["weightFitFamilies"] == ["family-one"]
    assert manifest["calibrationFamilies"] == ["family-cal"]
    with pytest.raises(FileExistsError):
        prepare_dataset([example()], directory)
    with (directory / "weight_fit.jsonl").open("a") as stream:
        stream.write("\n")
    with pytest.raises(ValueError, match="differs"):
        verify_dataset(directory)


@pytest.mark.parametrize("change", [
    lambda row: row["provenance"].update(sourceSplit="test"),
    lambda row: row["provenance"].update(observedNextBatch=False),
    lambda row: row.update(completion='{"action":"READ","hits":[1]}'),
    lambda row: row.update(completion='{"action":"NO_READ","hits":[1,0]}'),
    lambda row: row.update(completion='{"action":"READ","hits":[true,0]}'),
    lambda row: row.update(candidateIds=["same", "same"]),
    lambda row: row["prompt"][0].update(content="Changed after compiler hashing"),
])
def test_training_rejects_leakage_and_unknown_or_incomplete_labels(change):
    row = example()
    change(row)
    with pytest.raises(ValueError):
        TrainingExample.model_validate(row)


def test_family_and_checkpoint_overlap_fail_before_publication(tmp_path):
    fitting, calibration = example(), example("cal", "calibration")
    calibration["familyId"] = fitting["familyId"]
    with pytest.raises(ValueError, match="crosses"):
        prepare_dataset([fitting, calibration], tmp_path / "family")
    calibration["familyId"] = "separate"
    calibration["provenance"]["publicInputHash"] = fitting["provenance"]["publicInputHash"]
    with pytest.raises(ValueError, match="crosses"):
        prepare_dataset([fitting, calibration], tmp_path / "checkpoint")
    assert not (tmp_path / "family").exists()


def test_goal_pointer_conversion_preserves_actual_container_types():
    value = {"0": [{"a/b": {"~": 42}}]}
    assert pointer_path(value, "/0/0/a~1b/~0") == ["0", 0, "a/b", "~"]
    for path in ("/0/00", "/missing", "/0/-", "/0/0/a~2"):
        with pytest.raises(ValueError):
            pointer_path(value, path)
    public = {"checkpoint_id": "goal-1", "request_revision": "request-1", "input": {"sources": [{"id": "source", "value": value}]}}
    public["input_hash"] = hash_v1(public["input"])
    annotation = {"checkpoint_id": "goal-1", "input_hash": public["input_hash"], "request_revision": "request-1",
                  "teacher_model": "teacher", "annotation_version": "v1", "unknown_probability": 0,
                  "goals": [{"action": "retrieve", "object_type": "order", "objective": "Find order", "confidence": 1,
                             "sources": [{"source_id": "source", "pointer": "/0/0/a~1b/~0", "value_hash": hash_v1(42)}], "constraints": []}]}
    draft = annotation_goal_draft(annotation, public)
    assert "revisionHash" not in draft
    assert draft["hypotheses"][0]["sources"][0]["path"] == ["0", 0, "a/b", "~"]
    changed = copy.deepcopy(public)
    changed["input"]["sources"][0]["value"]["0"][0]["a/b"]["~"] = 43
    with pytest.raises(ValueError):
        annotation_goal_draft(annotation, changed)


def review_fixture():
    annotations = [{"checkpoint_id": str(index), "goal": "An independently reviewed target"} for index in range(20)]
    pilot = {"audit": [{"checkpoint_id": row["checkpoint_id"]} for row in annotations]}
    reviews = [{"checkpoint_id": row["checkpoint_id"], "annotationHash": hash_v1(row), "reviewer": "human",
                "rubric_version": "v1", "semantics_acceptable": True, "unsupported_binding": False} for row in annotations]
    return pilot, reviews, annotations


def test_goal_training_requires_actual_review_and_exact_annotation_hashes(tmp_path):
    row = example()
    row.update(task="goal", condition=None, candidateIds=[], candidateWindowHash=None,
               completion='{"schemaVersion":1,"hypotheses":[],"unknown":1}')
    pilot, reviews, annotations = review_fixture()
    row["provenance"]["annotationHash"] = hash_v1(annotations[0])
    with pytest.raises(ValueError, match="review"):
        prepare_dataset([row], tmp_path / "unreviewed")
    review = verify_review(pilot, reviews, annotations)
    assert prepare_dataset([row], tmp_path / "reviewed", review=review)["review"]["audited"] == 20
    reviews[0]["unsupported_binding"] = True
    with pytest.raises(ValueError, match="failed"):
        verify_review(pilot, reviews, annotations)
    reviews[0]["annotationHash"] = hash_v1("wrong")
    with pytest.raises(ValueError, match="bind"):
        verify_review(pilot, reviews, annotations)


class CharacterTokenizer:
    def apply_chat_template(self, messages, *, add_generation_prompt, **_):
        return "".join(f"{row['role']}:" + row["content"] + "\n" for row in messages) + ("assistant:" if add_generation_prompt else "")

    def encode(self, value, **_):
        return [ord(character) for character in value]

    def decode(self, values):
        return "".join(chr(value) for value in values)


def test_completion_masks_preserve_compiler_prefix_and_do_not_truncate():
    row = example()
    tokenizer = CharacterTokenizer()
    row["promptTokens"] = len(tokenizer.apply_chat_template(row["prompt"], add_generation_prompt=True))
    result = tokenize_example(row, tokenizer)
    assert result["labels"][:row["promptTokens"]] == [-100] * row["promptTokens"]
    assert all(value >= 0 for value in result["labels"][row["promptTokens"]:])
    assert binary_token_ids(tokenizer) == {"zero": 48, "one": 49}
    with pytest.raises(ValueError, match="budget"):
        tokenize_example(row, tokenizer, max_length=10)
    row["promptTokens"] += 1
    with pytest.raises(ValueError, match="counts"):
        tokenize_example(row, tokenizer)


def test_training_lease_binds_active_reserved_gpu_and_deadline(tmp_path):
    lease = {"version": 1, "profile": "acephale-training-lease-v1", "phase": "predictor_training", "status": "active",
             "actorStopped": True, "startedAt": 100, "deadline": 200, "hardwareProfile": "a100-40gb-v1",
             "instanceId": "instance", "leaseId": "lease", "studyBindingHash": hash_v1("study"),
             "providerLeaseHash": hash_v1("provider"), "studyReservation": {"reservationId": "lambda-infra:lease", "maximumMicrodollars": 5000000}}
    path = tmp_path / "lease.json"
    path.write_text(json.dumps(lease))
    assert validate_training_lease(path, now=150) == lease
    with pytest.raises(ValueError, match="expired"):
        validate_training_lease(path, now=200)
    lease["actorStopped"] = False
    path.write_text(json.dumps(lease))
    with pytest.raises(ValueError, match="stopped actor"):
        validate_training_lease(path, now=150)


def test_trained_model_calibration_cannot_reuse_weight_fit_families():
    assert calibration_families(BASE) is None
    artifact = hashed({"kind": "acephale-trained-predictor", "base": BASE,
                       "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"]})
    assert calibration_families({**BASE, "trainedPredictor": artifact}) == {"cal"}
    body = {key: value for key, value in artifact.items() if key != "contentHash"}
    body["calibrationFamilies"] = ["fit"]
    with pytest.raises(ValueError, match="disjoint"):
        calibration_families({**BASE, "trainedPredictor": hashed(body)})


def test_conditional_ranking_cannot_bypass_human_annotation_audit(tmp_path):
    row = example()
    row["condition"] = "conditional"
    with pytest.raises(ValueError, match="audited"):
        prepare_dataset([row], tmp_path / "missing")
    pilot, reviews, annotations = review_fixture()
    row["provenance"]["annotationHash"] = hash_v1(annotations[0])
    with pytest.raises(ValueError, match="review"):
        prepare_dataset([row], tmp_path / "unreviewed")
    assert prepare_dataset([row], tmp_path / "reviewed", review=verify_review(pilot, reviews, annotations))["counts"]["weight_fit"] == 1


@pytest.mark.parametrize("field,value", [("weightFitFamilies", ["made-up"]), ("counts", {"weight_fit": 100}),
                                       ("datasetHash", "0" * 64), ("sourceFiles", [])])
def test_resealed_manifest_cannot_misrepresent_actual_partitions(tmp_path, field, value):
    directory = tmp_path / "data"
    original = prepare_dataset([example()], directory)
    body = {key: item for key, item in original.items() if key != "contentHash"}
    body[field] = value
    (directory / "manifest.json").write_text(json.dumps(hashed(body)))
    with pytest.raises(ValueError):
        verify_dataset(directory)


def test_export_retains_original_tokenizer_bytes(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    target.mkdir()
    (source / "tokenizer.json").write_bytes(b'{"fixture":true}\n')
    (source / "tokenizer_config.json").write_bytes(b'{"chat_template":"pinned template"}\n')
    (target / "tokenizer_config.json").write_bytes(b'{"chat_template":"silently changed"}\n')
    (target / "added_tokens.json").write_bytes(b'[]')
    preserve_tokenizer(source, target)
    assert tokenizer_identity(source) == tokenizer_identity(target)
    assert not (target / "added_tokens.json").exists()
    assert (target / "tokenizer_config.json").read_bytes() == (source / "tokenizer_config.json").read_bytes()


def test_training_image_receipt_requires_observed_docker_identity():
    inputs = [{"path": "training/uv.lock", "bytes": 1, "sha256": "a" * 64}]
    image = {"Id": "sha256:" + "c" * 64, "Config": {"Labels": {LABEL: hash_v1(inputs)}}}
    receipt = hashed({"kind": "acephale-training-image", "imageId": image["Id"], "inputs": inputs,
                      "inputHash": hash_v1(inputs), "imageInventory": image})
    assert verify_image(receipt, image) == image["Id"]
    for observed in ({**image, "Id": "sha256:" + "d" * 64}, {**image, "Config": {}}):
        with pytest.raises(ValueError, match="Docker image"):
            verify_image(receipt, observed)
