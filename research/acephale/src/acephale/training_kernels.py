"""Verify the actual Qwen DeltaNet implementation selected by the training image."""
from __future__ import annotations

from typing import Any


def _kernel_profile(model, delta_class, chunk, recurrent, norm_class) -> dict[str, Any]:
    layers = [module for module in model.modules() if isinstance(module, delta_class)]
    if not layers or not callable(chunk) or not callable(recurrent):
        raise RuntimeError("The declared FLA training profile requires Qwen Gated DeltaNet kernels")
    for layer in layers:
        if (layer.chunk_gated_delta_rule is not chunk or layer.recurrent_gated_delta_rule is not recurrent
                or not isinstance(layer.norm, norm_class)):
            raise RuntimeError("A Qwen layer silently selected a different DeltaNet training implementation")
        if layer.causal_conv1d_fn is not None:
            raise RuntimeError("This FLA profile declares PyTorch convolution, not an undeclared CUDA extension")
    return {"version": 1, "profile": "qwen3_5-fla-delta-v1", "gatedDeltaLayers": len(layers),
            "chunkKernel": f"{chunk.__module__}.{chunk.__name__}",
            "recurrentKernel": f"{recurrent.__module__}.{recurrent.__name__}",
            "normalization": f"{norm_class.__module__}.{norm_class.__name__}",
            "causalConvolution": "torch", "packing": False}


def training_kernel_profile(model) -> dict[str, Any]:
    from fla.modules import FusedRMSNormGated
    from fla.ops.gated_delta_rule import chunk_gated_delta_rule, fused_recurrent_gated_delta_rule
    from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5GatedDeltaNet

    precision = getattr(model, "acephale_parameter_precision", None)
    if not isinstance(precision, dict) or precision.get("exactCheckpointBytes") is not True:
        raise RuntimeError("Declared training kernels require verified checkpoint parameter precision")
    return {**_kernel_profile(model, Qwen3_5GatedDeltaNet, chunk_gated_delta_rule,
                             fused_recurrent_gated_delta_rule, FusedRMSNormGated),
            "version": 2, "profile": "qwen3_5-fla-delta-alog-fp32-v2", "parameterPrecision": precision}
