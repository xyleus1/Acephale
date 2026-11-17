"""Preserve checkpoint FP32 DeltaNet decay values when loading a BF16 model."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1

PRECISION_POLICY = {"version": 1, "profile": "qwen3_5-checkpoint-alog-fp32-v1",
                    "defaultParameterDtype": "bfloat16", "strictFp32Suffix": "A_log",
                    "expectedTensors": 18, "expectedShape": [16],
                    "loaderMechanism": "transformers_keep_in_fp32_modules_strict_scoped_subclass"}


def checkpoint_precision_class(model_class):
    """Use the pinned Transformers dtype plan without modifying its global class.

    Retain the architecture name for standard save/load interoperability. The
    subclass changes only the existing dtype plan, not layers or forward code.
    """
    strict = list(dict.fromkeys([*(model_class._keep_in_fp32_modules_strict or []), "A_log"]))
    return type(model_class.__name__, (model_class,), {"_keep_in_fp32_modules_strict": strict})


def checkpoint_decay_tensors(directory: Path):
    import torch
    from safetensors import safe_open

    tensors = {}
    for path in sorted(directory.glob("*.safetensors")):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Regular verified checkpoint weight files required")
        with safe_open(path, framework="pt", device="cpu") as weights:
            for name in weights.keys():
                if not name.endswith(".linear_attn.A_log"):
                    continue
                tensor = weights.get_tensor(name)
                if (name in tensors or tensor.dtype != torch.float32 or list(tensor.shape) != [16]
                        or not torch.isfinite(tensor).all()):
                    raise ValueError("Checkpoint requires unique original FP32 Qwen decay tensors")
                tensors[name] = tensor
    if len(tensors) != 18:
        raise ValueError("Pinned predictor must contain all 18 original FP32 decay tensors")
    return tensors


def verify_parameter_precision(model, checkpoint) -> dict[str, Any]:
    import torch

    actual = dict(model.named_parameters())
    names = {name for name in actual if name.endswith(".linear_attn.A_log")}
    if names != set(checkpoint) or len(names) != 18:
        raise ValueError("Loaded predictor decay targets differ from the checkpoint")
    rows = []
    for name in sorted(names):
        parameter, expected = actual[name], checkpoint[name]
        if (parameter.dtype != torch.float32 or expected.dtype != torch.float32
                or parameter.shape != expected.shape or list(parameter.shape) != [16]):
            raise ValueError("Loaded Qwen decay parameters must retain checkpoint FP32 storage")
        raw = parameter.detach().contiguous().view(torch.uint8).cpu()
        original = expected.contiguous().view(torch.uint8)
        if not torch.equal(raw, original):
            raise ValueError("Loaded FP32 decay bytes differ from the original checkpoint")
        rows.append({"name": name, "dtype": "float32", "shape": [16],
                     "sha256": hashlib.sha256(memoryview(original.numpy())).hexdigest()})
    if any(parameter.is_floating_point() and parameter.dtype != torch.bfloat16
           for name, parameter in actual.items() if name not in names):
        raise ValueError("Only the declared decay tensors may differ from the BF16 base dtype")
    return {**PRECISION_POLICY, "verifiedTensorCount": len(rows), "verifiedParameterCount": 288,
            "checkpointTensorHash": hash_v1(rows), "tensors": rows, "exactCheckpointBytes": True}


def require_training_precision(model, specification):
    """Never reload an old BF16-base adapter under a new precision claim."""
    expected = specification.get("kernelProfile", {}).get("parameterPrecision")
    actual = getattr(model, "acephale_parameter_precision", None)
    if expected is None or actual != expected:
        raise ValueError("Training and current loader parameter precision differ; use the original source for historical artifacts")
