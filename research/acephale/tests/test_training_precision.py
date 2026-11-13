from types import SimpleNamespace

import pytest

from acephale.training_precision import checkpoint_precision_class, require_training_precision


def test_scoped_dtype_plan_preserves_inheritance_without_global_mutation():
    class Parent:
        _keep_in_fp32_modules_strict = ["existing"]

    class Model(Parent):
        pass

    scoped = checkpoint_precision_class(Model)
    assert issubclass(scoped, Model) and scoped is not Model
    assert scoped.__name__ == Model.__name__
    assert scoped._keep_in_fp32_modules_strict == ["existing", "A_log"]
    assert Model._keep_in_fp32_modules_strict == ["existing"]
    assert Parent._keep_in_fp32_modules_strict == ["existing"]
    assert checkpoint_precision_class(scoped)._keep_in_fp32_modules_strict == ["existing", "A_log"]


def test_historical_precision_is_not_silently_relabelled():
    model = SimpleNamespace(acephale_parameter_precision={"exactCheckpointBytes": True})
    require_training_precision(model, {"kernelProfile": {"parameterPrecision": model.acephale_parameter_precision}})
    for specification in ({}, {"kernelProfile": {}}, {"kernelProfile": {"parameterPrecision": {"different": True}}}):
        with pytest.raises(ValueError, match="original source"):
            require_training_precision(model, specification)


def torch_fixture():
    torch = pytest.importorskip("torch")
    safetensors = pytest.importorskip("safetensors.torch")
    from acephale.training_precision import checkpoint_decay_tensors, verify_parameter_precision

    values = torch.arange(16, dtype=torch.float32) / 11 + 1.001
    names = [f"model.language_model.layers.{i}.linear_attn.A_log" for i in range(18)]
    checkpoint = {name: values.clone() for name in names}
    actual = {name: torch.nn.Parameter(value.clone()) for name, value in checkpoint.items()}
    actual["model.language_model.embed_tokens.weight"] = torch.nn.Parameter(torch.ones(2, 2, dtype=torch.bfloat16))
    model = SimpleNamespace(named_parameters=lambda: actual.items())
    return torch, safetensors, checkpoint_decay_tensors, verify_parameter_precision, checkpoint, actual, model


def test_exact_checkpoint_decay_inventory_and_loaded_bytes(tmp_path):
    _, safetensors, read, verify, checkpoint, _, model = torch_fixture()
    safetensors.save_file(checkpoint, tmp_path / "model.safetensors")
    observed = read(tmp_path)
    result = verify(model, observed)
    assert result["verifiedTensorCount"] == 18 and result["verifiedParameterCount"] == 288
    assert result["exactCheckpointBytes"] is True
    assert len(result["tensors"]) == 18 and len(result["checkpointTensorHash"]) == 64


@pytest.mark.parametrize("change", ["rounded", "bf16", "other_fp32", "missing", "extra"])
def test_rounded_or_undeclared_loaded_precision_rejected(change):
    torch, _, _, verify, checkpoint, actual, model = torch_fixture()
    name = next(iter(checkpoint))
    if change == "rounded":
        actual[name] = torch.nn.Parameter(checkpoint[name].to(torch.bfloat16).float())
    elif change == "bf16":
        actual[name] = torch.nn.Parameter(checkpoint[name].to(torch.bfloat16))
    elif change == "other_fp32":
        actual["model.language_model.embed_tokens.weight"] = torch.nn.Parameter(torch.ones(2, 2))
    elif change == "missing":
        del actual[name]
    else:
        actual["model.language_model.layers.99.linear_attn.A_log"] = torch.nn.Parameter(torch.ones(16))
    with pytest.raises(ValueError):
        verify(model, checkpoint)


@pytest.mark.parametrize("change", ["missing", "dtype", "shape", "nonfinite", "duplicate"])
def test_bad_checkpoint_decay_inventory_rejected(tmp_path, change):
    torch, safetensors, read, _, checkpoint, _, _ = torch_fixture()
    name = next(iter(checkpoint))
    if change == "missing":
        del checkpoint[name]
    elif change == "dtype":
        checkpoint[name] = checkpoint[name].to(torch.bfloat16)
    elif change == "shape":
        checkpoint[name] = checkpoint[name][:15]
    elif change == "nonfinite":
        checkpoint[name][0] = float("nan")
    else:
        safetensors.save_file({name: checkpoint[name]}, tmp_path / "second.safetensors")
    safetensors.save_file(checkpoint, tmp_path / "model.safetensors")
    with pytest.raises(ValueError):
        read(tmp_path)


def test_pinned_transformers_loads_original_fp32_before_any_bf16_rounding(tmp_path):
    torch = pytest.importorskip("torch")
    transformers = pytest.importorskip("transformers")
    if transformers.__version__ != "5.10.1":
        pytest.skip("Actual loader contract requires pinned Transformers 5.10.1")

    class TinyDecayModel(transformers.PreTrainedModel):
        config_class = transformers.PretrainedConfig
        _keep_in_fp32_modules_strict = []

        def __init__(self, config):
            super().__init__(config)
            self.linear_attn = torch.nn.Module()
            self.linear_attn.A_log = torch.nn.Parameter(torch.arange(16, dtype=torch.get_default_dtype()) / 11 + 1.001)
            self.weight = torch.nn.Parameter(torch.ones(2, 2))
            self.post_init()

    original = TinyDecayModel(transformers.PretrainedConfig())
    original.save_pretrained(tmp_path)
    expected = original.linear_attn.A_log.detach().clone()
    baseline = TinyDecayModel.from_pretrained(tmp_path, dtype=torch.bfloat16, local_files_only=True)
    assert baseline.linear_attn.A_log.dtype == torch.bfloat16
    assert not torch.equal(baseline.linear_attn.A_log.float(), expected)
    scoped = checkpoint_precision_class(TinyDecayModel)
    restored = scoped.from_pretrained(tmp_path, dtype=torch.bfloat16, local_files_only=True)
    assert restored.linear_attn.A_log.dtype == torch.float32
    assert torch.equal(restored.linear_attn.A_log.detach().view(torch.uint8), expected.view(torch.uint8))
    assert restored.weight.dtype == torch.bfloat16
    assert TinyDecayModel._keep_in_fp32_modules_strict == []
