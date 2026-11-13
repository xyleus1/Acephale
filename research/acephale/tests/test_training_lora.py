from __future__ import annotations

import copy
import json
import struct
import sys
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_fairness import _model_identity
from acephale.training import PROBE_CONTEXT, TARGET_SUFFIXES, tokenizer_identity, verify_export
from acephale.training_data import BASE, file_inventory, hashed
from acephale.training_lora import (
    ASSISTANT_GENERATION_SUFFIX,
    PARITY_GATE,
    SERVING_SELECTION_RULE,
    adapter_inventory,
    base_weights_hash,
    select_serving_prompt,
    serving_weights_hash,
    validate_lora_artifact,
    validate_serving_probe,
    verify_unmerged_export,
)


def export_fixture(directory, *, probe_version=1, parameter_precision=None):
    adapter = directory / "adapter"
    adapter.mkdir(parents=True)
    targets = sorted("model.language_model.layers.0." + name for name in TARGET_SUFFIXES)
    # Pinned PEFT 0.21 minimizes the real 186 full target paths to these 12 suffixes.
    config = {"target_modules": sorted(TARGET_SUFFIXES), "r": 16, "lora_alpha": 32, "lora_dropout": 0.05,
              "bias": "none", "use_dora": False, "use_rslora": False, "modules_to_save": None,
              "rank_pattern": {}, "alpha_pattern": {}}
    (adapter / "adapter_config.json").write_text(json.dumps(config))
    header, offset = {}, 0
    for target in targets:
        for side, shape in (("A", [16, 32]), ("B", [32, 16])):
            header["base_model.model." + target + ".lora_" + side + ".weight"] = {
                "dtype": "F32", "shape": shape, "data_offsets": [offset, offset + 2048]}
            offset += 2048
    raw = json.dumps(header).encode()
    (adapter / "adapter_model.safetensors").write_bytes(struct.pack("<Q", len(raw)) + raw + bytes(offset))
    (adapter / "tokenizer.json").write_text('{"fixture":true}')
    (adapter / "tokenizer_config.json").write_text('{"chat_template":"fixture"}')
    tokenizer, template = tokenizer_identity(adapter)
    base = {**BASE, "role": "predictor", "files": [
        {"path": "config.json", "sha256": "a" * 64, "bytes": 2},
        {"path": "model.safetensors", "sha256": "b" * 64, "bytes": 10}]}
    dataset = hashed({"base": BASE, "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"], "counts": {"weight_fit": 2},
                      "tokenizerHash": tokenizer, "chatTemplateHash": template})
    specification = {"base": BASE, "baseReceiptHash": hash_v1(base), "datasetManifestHash": dataset["contentHash"],
                     "targets": targets, "trainableCount": offset // 4, "probeContext": PROBE_CONTEXT}
    if parameter_precision is not None:
        specification["kernelProfile"] = {"parameterPrecision": parameter_precision}
    specification = hashed(specification)
    files = file_inventory(adapter)
    receipt = hashed({"status": "completed", "trainingManifestHash": dataset["contentHash"],
                      "specificationHash": specification["contentHash"], "frozenBeforeHash": "b" * 64,
                      "frozenAfterHash": "b" * 64, "adapterBeforeHash": "c" * 64, "adapterAfterHash": "d" * 64,
                      "gradientChecks": 1, "adapterFiles": files, "binaryTokenIds": {"zero": 15, "one": 16}})
    probe = {"schemaVersion": 1, "kind": "acephale-lora-serving-probe", "inputTokenIds": [1, 2, 3],
             "binaryTokenIds": receipt["binaryTokenIds"], "referenceLogprobs": {"zero": -3.0, "one": -3.0},
             "referenceConditionalOneProbability": 0.5, "topTokenId": 17, "gate": PARITY_GATE,
             "nativeTaskAccuracyMeasured": False}
    if probe_version == 2:
        probe.update(schemaVersion=2, inputTokenIds=list(range(300)), inputHash=hash_v1(list(range(300))),
                     selection={"rule": SERVING_SELECTION_RULE, "datasetManifestHash": dataset["contentHash"],
                         "trainingManifestHash": specification["contentHash"], "rowId": "fit:neutral", "familyId": "fit",
                         "promptHash": hash_v1("prompt"), "promptTokens": 300, "eligibleRows": 2})
    artifact = {"schemaVersion": 2, "kind": "acephale-trained-predictor", "storageMode": "unmerged_lora", "base": BASE,
                "baseReceiptHash": hash_v1(base), "baseWeightsHash": base_weights_hash(base), "adapterHash": hash_v1(files),
                "adapterStorageDtype": "float32", "runtimeLoraDtype": "bfloat16", "servingProbeHash": hash_v1(probe),
                "tokenizerHash": tokenizer, "chatTemplateHash": template, "trainingManifestHash": specification["contentHash"],
                "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"], "protocol": "rank_binary_v1",
                "binaryTokenIds": receipt["binaryTokenIds"]}
    artifact["servingWeightsHash"] = serving_weights_hash(artifact)
    artifact["servedModel"] = "acephale-predictor-" + artifact["servingWeightsHash"][:12]
    artifact = hashed(artifact)
    verification = hashed({"artifactHash": artifact["contentHash"], "receiptHash": receipt["contentHash"],
        "adapterFiles": files, "adapterTensors": adapter_inventory(adapter, specification), "probeContext": PROBE_CONTEXT,
        "reloadMaximumLogitError": 0.001, "reload": {"atol": 0.03, "rtol": 0.02, "referenceMaximumAbsolute": 1, "allClose": True},
        "merged": False, "vllmQualificationRequired": True, "vllmQualificationPassed": False, "nativeTaskSuccessMeasured": False})
    documents = {"predictor.json": artifact, "base-receipt.json": base, "dataset-manifest.json": dataset,
                 "training-manifest.json": specification, "training-receipt.json": receipt,
                 "verification.json": verification, "serving-probe.json": probe}
    for name, document in documents.items():
        (directory / name).write_text(json.dumps(document))
    return documents


def reseal(document):
    return hashed({key: value for key, value in document.items() if key != "contentHash"})


def test_unmerged_export_retains_actual_adapter_bytes_and_requires_separate_runtime_gate(tmp_path):
    documents = export_fixture(tmp_path)
    before = file_inventory(tmp_path / "adapter")
    assert verify_export(tmp_path) == documents["predictor.json"]
    assert verify_unmerged_export(tmp_path) == documents["predictor.json"]
    assert file_inventory(tmp_path / "adapter") == before
    assert documents["verification.json"]["vllmQualificationPassed"] is False
    assert "mergedWeightsHash" not in documents["predictor.json"]
    assert not (tmp_path / "model").exists()
    artifact = documents["predictor.json"]
    selection = {"weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"]}
    assert _model_identity({**BASE, "trainedPredictor": artifact}, artifact["binaryTokenIds"], selection) == artifact["servedModel"]
    with pytest.raises(ValueError, match="tokenizer"):
        _model_identity({**BASE, "trainedPredictor": artifact}, {"zero": 15, "one": 999}, selection)


def test_complete_probe_export_keeps_the_same_weight_identity_and_strict_reload(tmp_path):
    old = export_fixture(tmp_path / "old")
    complete = export_fixture(tmp_path / "complete", probe_version=2)
    assert verify_unmerged_export(tmp_path / "complete") == complete["predictor.json"]
    assert old["predictor.json"]["servingWeightsHash"] == complete["predictor.json"]["servingWeightsHash"]
    assert old["predictor.json"]["servedModel"] == complete["predictor.json"]["servedModel"]
    assert old["predictor.json"]["servingProbeHash"] != complete["predictor.json"]["servingProbeHash"]
    assert old["verification.json"]["reload"] == complete["verification.json"]["reload"]
    assert complete["serving-probe.json"]["gate"] == PARITY_GATE


@pytest.mark.parametrize("mutation", [
    lambda p: p.update(inputHash="f" * 64),
    lambda p: p["selection"].update(familyId="cal"),
    lambda p: p["selection"].update(promptTokens=256),
    lambda p: p["selection"].update(trainingManifestHash="f" * 64),
    lambda p: p["selection"].update(eligibleRows=0),
    lambda p: p["selection"].update(rule="choose_by_output"),
])
def test_complete_probe_rejects_changed_selection_even_after_rehash(tmp_path, mutation):
    documents = export_fixture(tmp_path, probe_version=2)
    probe, artifact = documents["serving-probe.json"], documents["predictor.json"]
    mutation(probe)
    artifact["servingProbeHash"] = hash_v1(probe)
    with pytest.raises(ValueError, match="selection provenance"):
        validate_serving_probe(probe, artifact)


@pytest.mark.parametrize("change", ["dataset", "count"])
def test_complete_probe_selection_binds_the_retained_dataset_after_rehash(tmp_path, change):
    documents = export_fixture(tmp_path, probe_version=2)
    probe, artifact, verification = (documents[name] for name in ("serving-probe.json", "predictor.json", "verification.json"))
    if change == "dataset":
        probe["selection"]["datasetManifestHash"] = "f" * 64
    else:
        probe["selection"]["eligibleRows"] = 3
    artifact = reseal({**artifact, "servingProbeHash": hash_v1(probe)})
    verification = reseal({**verification, "artifactHash": artifact["contentHash"]})
    for name, value in [("serving-probe.json", probe), ("predictor.json", artifact), ("verification.json", verification)]:
        (tmp_path / name).write_text(json.dumps(value))
    with pytest.raises(ValueError, match="retained fitting dataset"):
        verify_unmerged_export(tmp_path)


def test_complete_prompt_selection_is_fit_only_neutral_deterministic_and_completion_free(monkeypatch):
    from acephale import training_data

    prompt = [{"role": "user", "content": "Visible request only"}]
    base = {"partition": "weight_fit", "task": "rank_binary", "condition": "neutral", "familyId": "fit",
            "prompt": prompt, "compiledInputHash": hash_v1(prompt), "promptTokens": 300,
            "completion": object()}
    rows = [{**base, "id": "b"}, {**base, "id": "a"}, {**base, "id": "long", "promptTokens": 400},
            {**base, "id": "cal", "partition": "calibration", "promptTokens": 1},
            {**base, "id": "conditional", "condition": "conditional", "promptTokens": 2},
            {**base, "id": "goal", "task": "goal", "condition": None, "promptTokens": 3}]
    monkeypatch.setattr(training_data, "load_partition", lambda path, partition: rows if partition == "weight_fit" else pytest.fail("other partition"))
    calls = []
    def template(messages, **options):
        assert messages == prompt
        assert options == {"tokenize": False, "add_generation_prompt": True, "enable_thinking": False}
        calls.append(messages)
        return "Complete input" + ASSISTANT_GENERATION_SUFFIX
    tokenizer = SimpleNamespace(apply_chat_template=template, encode=lambda rendered, **options: list(range(300)))
    ids, selection = select_serving_prompt(None, {"contentHash": "a" * 64, "weightFitFamilies": ["fit"]},
                                           {"contentHash": "b" * 64}, tokenizer)
    assert ids == list(range(300)) and selection["rowId"] == "a" and selection["eligibleRows"] == 3
    assert selection["promptTokens"] == 300 and selection["promptHash"] == hash_v1(prompt) and len(calls) == 1


@pytest.mark.parametrize("change", ["suffix", "tokens", "hash", "no_neutral"])
def test_complete_prompt_never_falls_back_to_truncation_or_other_partition(monkeypatch, change):
    from acephale import training_data

    prompt = [{"role": "user", "content": "Visible request"}]
    row = {"partition": "weight_fit", "task": "rank_binary", "condition": "neutral", "id": "a", "familyId": "fit",
           "prompt": prompt, "compiledInputHash": hash_v1(prompt), "promptTokens": 300}
    if change == "hash":
        row["compiledInputHash"] = "f" * 64
    if change == "no_neutral":
        row["condition"] = "conditional"
    monkeypatch.setattr(training_data, "load_partition", lambda *_: [row])
    tokenizer = SimpleNamespace(apply_chat_template=lambda *a, **k: "incomplete" if change == "suffix" else "prompt" + ASSISTANT_GENERATION_SUFFIX,
                                encode=lambda *a, **k: list(range(299 if change == "tokens" else 300)))
    with pytest.raises(ValueError, match="complete|Complete"):
        select_serving_prompt(None, {"contentHash": "a" * 64, "weightFitFamilies": ["fit"]}, {"contentHash": "b" * 64}, tokenizer)


@pytest.mark.parametrize("field,value", [("runtimeLoraDtype", "float32"), ("adapterStorageDtype", "bfloat16"),
    ("baseWeightsHash", "f" * 64), ("adapterHash", "e" * 64), ("servedModel", "Qwen/Qwen3.5-0.8B"),
    ("mergedWeightsHash", "e" * 64), ("calibrationFamilies", ["fit"])])
def test_derived_identity_rejects_changed_dtype_snapshot_or_alias(tmp_path, field, value):
    artifact = export_fixture(tmp_path)["predictor.json"]
    changed = reseal({**artifact, field: value})
    with pytest.raises(ValueError):
        validate_lora_artifact(changed)


@pytest.mark.parametrize("change", [
    lambda value: value.update(vllmQualificationPassed=True),
    lambda value: value.update(merged=True),
    lambda value: value.update(reloadMaximumLogitError=0.1),
    lambda value: value["reload"].update(atol=0.06),
    lambda value: value["reload"].update(allClose=False),
])
def test_verified_storage_cannot_claim_runtime_qualification_or_relax_reload(tmp_path, change):
    value = copy.deepcopy(export_fixture(tmp_path)["verification.json"])
    change(value)
    (tmp_path / "verification.json").write_text(json.dumps(reseal(value)))
    with pytest.raises(ValueError, match="reload evidence|qualification"):
        verify_export(tmp_path)


def test_changed_adapter_payload_and_probe_fail_before_serving(tmp_path):
    documents = export_fixture(tmp_path)
    tensor_file = tmp_path / "adapter/adapter_model.safetensors"
    original = tensor_file.read_bytes()
    tensor_file.write_bytes(original[:-1] + b"x")
    with pytest.raises(ValueError, match="bytes differ"):
        verify_export(tmp_path)
    tensor_file.write_bytes(original)
    probe = copy.deepcopy(documents["serving-probe.json"])
    probe["inputTokenIds"].append(4)
    (tmp_path / "serving-probe.json").write_text(json.dumps(probe))
    with pytest.raises(ValueError, match="probe identity"):
        verify_export(tmp_path)


def test_no_missing_or_cast_adapter_targets_are_accepted(tmp_path):
    documents = export_fixture(tmp_path)
    tensor_file = tmp_path / "adapter/adapter_model.safetensors"
    raw = tensor_file.read_bytes()
    length = struct.unpack("<Q", raw[:8])[0]
    header = json.loads(raw[8:8 + length])
    key = next(iter(header))
    header[key]["dtype"] = "BF16"
    changed = json.dumps(header).encode()
    tensor_file.write_bytes(struct.pack("<Q", len(changed)) + changed + raw[8 + length:])
    with pytest.raises(ValueError, match="FP32"):
        adapter_inventory(tmp_path / "adapter", documents["training-manifest.json"])
    del header[key]
    changed = json.dumps(header).encode()
    tensor_file.write_bytes(struct.pack("<Q", len(changed)) + changed + raw[8 + length:])
    with pytest.raises(ValueError, match="every trained"):
        adapter_inventory(tmp_path / "adapter", documents["training-manifest.json"])


@pytest.mark.parametrize("change", [lambda targets: targets[:-1], lambda targets: [*targets, "extra_projection"]])
def test_minimized_adapter_configuration_preserves_exact_target_suffixes_and_full_tensor_coverage(tmp_path, change):
    documents = export_fixture(tmp_path)
    config_path = tmp_path / "adapter/adapter_config.json"
    config = json.loads(config_path.read_text())
    specification = documents["training-manifest.json"]
    assert set(config["target_modules"]) == {target.rsplit(".", 1)[-1] for target in specification["targets"]}
    actual = adapter_inventory(tmp_path / "adapter", specification)
    assert actual["targets"] == specification["targets"]
    config["target_modules"] = change(config["target_modules"])
    config_path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="configuration differs"):
        adapter_inventory(tmp_path / "adapter", specification)


def test_export_cli_requires_explicit_native_lora_mode_and_preserves_merged_default(tmp_path, monkeypatch):
    from acephale import training, training_cli, training_lora

    calls = []
    def merged(*arguments):
        calls.append(("merged", arguments))
        return {"mode": "merged"}

    def unmerged(*arguments):
        calls.append(("unmerged_lora", arguments))
        return {"mode": "unmerged_lora"}

    monkeypatch.setattr(training, "export_model", merged)
    monkeypatch.setattr(training_lora, "export_unmerged", unmerged)
    args = ["export"]
    for name in ("dataset", "model", "run", "output", "lease"):
        args.extend(["--" + name, str(tmp_path / name)])
    training_cli.main(args)
    training_cli.main([*args, "--artifact-mode", "unmerged_lora"])
    assert [call[0] for call in calls] == ["merged", "unmerged_lora"]
    assert calls[0][1] == calls[1][1]


@pytest.mark.parametrize("legacy", [False, True])
def test_evaluation_loads_verified_base_and_exact_adapter_without_merging(tmp_path, monkeypatch, legacy):
    from acephale import training

    directory = tmp_path / "export"
    precision = {"profile": "qwen3_5-checkpoint-alog-fp32-v1", "exactCheckpointBytes": True}
    documents = export_fixture(directory, parameter_precision=None if legacy else precision)
    base_path = tmp_path / "base"
    identity = documents["predictor.json"]
    calls = []
    model = SimpleNamespace(eval=lambda: "evaluated-unmerged-model")
    def load_adapter(base, adapter, **options):
        calls.append((base, adapter, options))
        return model

    monkeypatch.setitem(sys.modules, "peft", SimpleNamespace(PeftModel=SimpleNamespace(from_pretrained=load_adapter)))
    monkeypatch.setattr(training, "verify_base", lambda path: documents["base-receipt.json"])
    original_tokenizer = training.tokenizer_identity
    monkeypatch.setattr(training, "tokenizer_identity", lambda path: (identity["tokenizerHash"], identity["chatTemplateHash"])
                        if path == base_path else original_tokenizer(path))
    exact_base = SimpleNamespace(acephale_parameter_precision=precision)
    monkeypatch.setattr(training, "_load_model", lambda path: (exact_base, "base-tokenizer"))
    if legacy:
        with pytest.raises(ValueError, match="original source"):
            training._load_evaluation_model(base_path, directory)
        assert calls == []
        return
    assert training._load_evaluation_model(base_path, directory) == ("evaluated-unmerged-model", "base-tokenizer", identity)
    assert calls == [(exact_base, directory / "adapter", {"is_trainable": False, "local_files_only": True})]
    changed = copy.deepcopy(documents["base-receipt.json"])
    changed["files"][0]["sha256"] = "c" * 64
    monkeypatch.setattr(training, "verify_base", lambda path: changed)
    with pytest.raises(ValueError, match="exact exported base"):
        training._load_evaluation_model(base_path, directory)
    assert len(calls) == 1
    with pytest.raises(ValueError, match="--predictor-export"):
        training._load_evaluation_model(directory / "adapter")


def test_unmerged_evaluation_uses_declared_bf16_context_and_remains_a_diagnostic(tmp_path, monkeypatch):
    from acephale import training

    artifact = export_fixture(tmp_path / "export")["predictor.json"]
    active = set()
    @contextmanager
    def inference():
        active.add("inference")
        yield
        active.remove("inference")

    @contextmanager
    def autocast(*, device_type, dtype):
        assert device_type == "cuda" and dtype == "bf16"
        active.add("bf16")
        yield
        active.remove("bf16")

    class Rows:
        def __iter__(self):
            assert active == {"inference", "bf16"}
            return iter([])

    manifest = {"contentHash": "e" * 64, "tokenizerHash": artifact["tokenizerHash"], "chatTemplateHash": artifact["chatTemplateHash"]}
    monkeypatch.setattr(training, "verify_dataset", lambda path: manifest)
    monkeypatch.setattr(training, "validate_training_lease", lambda path: {"active": True})
    monkeypatch.setattr(training, "training_versions", lambda: {})
    monkeypatch.setattr(training, "tokenizer_identity", lambda path: (artifact["tokenizerHash"], artifact["chatTemplateHash"]))
    monkeypatch.setattr(training, "_load_evaluation_model", lambda *args: (object(), object(), artifact))
    monkeypatch.setattr(training, "load_partition", lambda *args: Rows())
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(inference_mode=inference, autocast=autocast, bfloat16="bf16"))
    output = tmp_path / "evaluation"
    result = training.evaluate(tmp_path / "dataset", tmp_path / "base", output, tmp_path / "lease",
                               predictor_export=tmp_path / "export")
    assert result["examples"] == 0 and not active
    receipt = json.loads((output / "evaluation.json").read_text())
    assert receipt["modelIdentity"] == artifact and receipt["nativeTaskAccuracy"] is None


def test_evaluate_cli_forwards_optional_unmerged_export_without_reinterpreting_model(tmp_path, monkeypatch):
    from acephale import training, training_cli

    calls = []
    def evaluate(*arguments, **options):
        calls.append((arguments, options))
        return {"examples": 0}

    monkeypatch.setattr(training, "evaluate", evaluate)
    args = ["evaluate"]
    for name in ("dataset", "model", "output", "lease"):
        args.extend(["--" + name, str(tmp_path / name)])
    training_cli.main(args)
    training_cli.main([*args, "--predictor-export", str(tmp_path / "export")])
    assert calls[0][1] == {"partition": "development"}
    assert calls[1][1] == {"partition": "development", "predictor_export": tmp_path / "export"}
    assert calls[0][0] == calls[1][0]
