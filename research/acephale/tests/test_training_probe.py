from __future__ import annotations

import copy
import importlib.metadata
import json
import sys
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.training import (
    PROBE_CONTEXT,
    TRAINING_VERSIONS,
    _probe_logits,
    _verify_probe_context,
    tokenizer_identity,
    verify_export,
)
from acephale.training_data import BASE, file_inventory, hashed


def test_probe_enters_explicit_precision_and_inference_context(monkeypatch):
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

    class Logits:
        def __getitem__(self, indexes):
            assert indexes == (slice(None), -1, slice(None))
            return self

        def float(self):
            assert active == {"inference", "bf16"}
            return self

        def cpu(self):
            return "full_last_token_logits"

    class Model:
        training = False

        def __call__(self, *, input_ids):
            assert active == {"inference", "bf16"}
            return SimpleNamespace(logits=Logits())

    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(
        inference_mode=inference, autocast=autocast, bfloat16="bf16"))
    ids = SimpleNamespace(device=SimpleNamespace(type="cuda"))
    assert _probe_logits(Model(), ids) == "full_last_token_logits"
    assert not active
    model = Model()
    model.training = True
    with pytest.raises(ValueError, match="eval mode"):
        _probe_logits(model, ids)
    ids.device.type = "cpu"
    with pytest.raises(ValueError, match="matching input device"):
        _probe_logits(Model(), ids)


@pytest.mark.parametrize("field,value", [("autocastDtype", "float32"), ("deviceType", "cpu"),
                                        ("inferenceMode", False), ("inferenceMode", 1),
                                        ("selection", "top_tokens_only")])
def test_changed_or_legacy_probe_context_fails_closed(field, value):
    context = copy.deepcopy(PROBE_CONTEXT)
    _verify_probe_context({"context": context}, {"probeContext": context})
    modified = {**context, field: value}
    for probe, specification in (({}, {"probeContext": context}),
                                 ({"context": context}, {}),
                                 ({"context": modified}, {"probeContext": context}),
                                 ({"context": context}, {"probeContext": modified})):
        with pytest.raises(ValueError, match="precision context"):
            _verify_probe_context(probe, specification)


def test_actual_export_verifier_rejects_legacy_or_tampered_probe_context(tmp_path):
    # Synthetic artifact bytes exercise the complete verifier, not model parity.
    model = tmp_path / "model"
    model.mkdir()
    (model / "model.safetensors").write_bytes(b"synthetic weight inventory")
    (model / "tokenizer.json").write_text('{"fixture":true}')
    (model / "tokenizer_config.json").write_text('{"chat_template":"fixture"}')
    tokenizer, template = tokenizer_identity(model)
    dataset = hashed({"base": BASE, "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"],
                      "tokenizerHash": tokenizer, "chatTemplateHash": template})
    specification = hashed({"base": BASE, "datasetManifestHash": dataset["contentHash"],
                            "probeContext": dict(PROBE_CONTEXT)})
    adapters = [{"path": "adapter.safetensors", "bytes": 1, "sha256": "a" * 64}]
    receipt = hashed({"status": "completed", "trainingManifestHash": dataset["contentHash"],
                      "specificationHash": specification["contentHash"], "frozenBeforeHash": "b" * 64,
                      "frozenAfterHash": "b" * 64, "adapterBeforeHash": "c" * 64, "adapterAfterHash": "d" * 64,
                      "gradientChecks": 1, "adapterFiles": adapters, "binaryTokenIds": {"zero": 15, "one": 16}})
    files = file_inventory(model)
    artifact = hashed({"schemaVersion": 1, "kind": "acephale-trained-predictor", "base": BASE,
        "protocol": "rank_binary_v1", "trainingManifestHash": specification["contentHash"],
        "weightFitFamilies": dataset["weightFitFamilies"], "calibrationFamilies": dataset["calibrationFamilies"],
        "tokenizerHash": tokenizer, "chatTemplateHash": template, "adapterHash": hash_v1(adapters),
        "mergedWeightsHash": hash_v1(files), "servedModel": "acephale-predictor-" + hash_v1(files)[:12],
        "binaryTokenIds": receipt["binaryTokenIds"]})
    verification = hashed({"artifactHash": artifact["contentHash"], "receiptHash": receipt["contentHash"],
        "mergedFiles": files, "adapterFiles": adapters, "probeContext": dict(PROBE_CONTEXT),
        "reloadMaximumLogitError": 0, "mergeMaximumLogitError": 0, "topTokenStable": True,
        "reload": {"atol": 0.03, "rtol": 0.02, "referenceMaximumAbsolute": 1, "allClose": True},
        "merge": {"atol": 0.06, "rtol": 0.03, "referenceMaximumAbsolute": 1, "allClose": True}})
    documents = {"predictor.json": artifact, "training-manifest.json": specification,
                 "dataset-manifest.json": dataset, "training-receipt.json": receipt, "verification.json": verification}
    for name, document in documents.items():
        (tmp_path / name).write_text(json.dumps(document))
    assert verify_export(tmp_path) == artifact
    for name in ("training-manifest.json", "verification.json"):
        original = documents[name]
        for context in (None, {**PROBE_CONTEXT, "autocastDtype": "float32"}, {**PROBE_CONTEXT, "inferenceMode": 1}):
            changed = {key: value for key, value in original.items() if key not in {"contentHash", "probeContext"}}
            if context is not None:
                changed["probeContext"] = context
            (tmp_path / name).write_text(json.dumps(hashed(changed)))
            with pytest.raises(ValueError, match="precision context"):
                verify_export(tmp_path)
        (tmp_path / name).write_text(json.dumps(original))
    assert verify_export(tmp_path) == artifact


def test_real_cpu_mixed_precision_adapter_reload(tmp_path):
    """Tiny real LoRA roundtrip when the pinned CPU-capable stack is installed."""
    torch = pytest.importorskip("torch")
    peft = pytest.importorskip("peft")
    accelerate = pytest.importorskip("accelerate")
    for name in ("torch", "peft", "accelerate"):
        if importlib.metadata.version(name).split("+")[0] != TRAINING_VERSIONS[name]:
            pytest.skip("Real CPU regression requires the declared pinned training stack")

    class Tiny(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.linear = torch.nn.Linear(32, 32, bias=False, dtype=torch.bfloat16)

        def forward(self, input_ids, **_):
            return {"logits": self.linear(input_ids)}

    # A dict supports Accelerate's recursive float32 conversion. Adapt it only
    # at the outer boundary to the transformer output attribute interface.
    class OutputView(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, input_ids):
            return SimpleNamespace(logits=self.model(input_ids=input_ids)["logits"])

    torch.manual_seed(17)
    base = Tiny()
    original = copy.deepcopy(base.state_dict())
    model = peft.get_peft_model(base, peft.LoraConfig(r=4, lora_alpha=4, target_modules=["linear"]))
    with torch.no_grad():
        for name, parameter in model.named_parameters():
            if "lora_" in name:
                assert parameter.dtype == torch.float32
                parameter.normal_(std=0.4)
    ids = torch.randn(1, 4, 32, dtype=torch.bfloat16)
    prepared = accelerate.Accelerator(cpu=True, mixed_precision="bf16").prepare_model(model).eval()
    assert hasattr(prepared, "_original_forward")
    expected = _probe_logits(OutputView(prepared).eval(), ids, device_type="cpu")
    adapter = tmp_path / "adapter"
    model.save_pretrained(adapter, safe_serialization=True)
    restored_base = Tiny()
    restored_base.load_state_dict(original)
    restored = peft.PeftModel.from_pretrained(restored_base, adapter, local_files_only=True).eval()
    actual = _probe_logits(OutputView(restored).eval(), ids, device_type="cpu")
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    with torch.inference_mode():
        mismatched = restored(input_ids=ids)["logits"][:, -1, :].float().cpu()
    assert not torch.equal(mismatched, expected)
