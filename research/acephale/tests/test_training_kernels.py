from types import SimpleNamespace

import pytest

from acephale.training_kernels import _kernel_profile


def chunk():
    pass


def recurrent():
    pass


class Norm:
    pass


class Delta:
    def __init__(self):
        self.chunk_gated_delta_rule = chunk
        self.recurrent_gated_delta_rule = recurrent
        self.norm = Norm()
        self.causal_conv1d_fn = None


def observe(*layers):
    model = SimpleNamespace(modules=lambda: iter([object(), *layers]))
    return _kernel_profile(model, Delta, chunk, recurrent, Norm)


def test_profile_records_every_actual_delta_layer_and_partial_acceleration():
    result = observe(Delta(), Delta())
    assert result["gatedDeltaLayers"] == 2
    assert result["causalConvolution"] == "torch" and result["packing"] is False
    assert result["chunkKernel"].endswith(".chunk")


@pytest.mark.parametrize("attribute,value", [
    ("chunk_gated_delta_rule", lambda: None),
    ("recurrent_gated_delta_rule", None),
    ("norm", object()),
    ("causal_conv1d_fn", lambda: None),
])
def test_one_fallback_or_unexpected_kernel_rejects_the_whole_model(attribute, value):
    bad = Delta()
    setattr(bad, attribute, value)
    with pytest.raises(RuntimeError):
        observe(Delta(), bad)


def test_missing_model_layers_do_not_prove_acceleration():
    with pytest.raises(RuntimeError, match="requires Qwen"):
        observe()
