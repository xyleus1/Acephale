"""Read-only numerical diagnosis of an already completed predictor checkpoint.

This never creates an optimizer or publishes a replacement acceptance probe.
Every comparison uses the original saved logits and unchanged reload tolerance.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import inspect
import json
import sys
import time
from pathlib import Path

from acephale.training_data import file_hash, file_inventory, verify_hashed, write_new


def inputs(run: Path, output: Path) -> tuple[dict, dict]:
    if output.exists() or output.resolve().is_relative_to(run.resolve()):
        raise ValueError("A new output outside the immutable training run is required")
    spec = json.loads((run / "training-specification.json").read_text())
    receipt = json.loads((run / "receipt.json").read_text())
    verify_hashed(spec)
    verify_hashed(receipt)
    if (receipt.get("status") != "completed" or receipt.get("steps") != 204
            or receipt.get("specificationHash") != spec["contentHash"]
            or receipt.get("frozenBeforeHash") != receipt.get("frozenAfterHash")
            or receipt.get("adapterBeforeHash") == receipt.get("adapterAfterHash")
            or receipt.get("probeHash") != file_hash(run / "reload-probe.pt")
            or sorted(receipt.get("adapterFiles", []), key=lambda row: row["path"])
            != sorted(file_inventory(run / "adapter"), key=lambda row: row["path"])):
        raise ValueError("Exact completed checkpoint, unchanged base and original probe required")
    return spec, receipt


def compare(actual, expected) -> dict:
    import torch

    if actual.shape != expected.shape or not torch.isfinite(actual).all() or not torch.isfinite(expected).all():
        raise ValueError("Finite matching full-vocabulary probe tensors required")
    delta = (actual - expected).abs()
    close = torch.isclose(actual, expected, rtol=0.02, atol=0.03)
    return {"rtol": 0.02, "atol": 0.03, "elements": actual.numel(),
            "mismatches": int((~close).sum()), "maximumAbsoluteError": float(delta.max()),
            "meanAbsoluteError": float(delta.mean()), "exact": bool(torch.equal(actual, expected)),
            "passesOriginalGate": bool(close.all())}


def tensor_hash(value) -> str:
    import torch

    return hashlib.sha256(value.detach().contiguous().view(torch.uint8).cpu().numpy().tobytes()).hexdigest()


def model_observation(model) -> dict:
    return {"trainingModules": [name for name, child in model.named_modules() if child.training],
            "trainableParameters": [name for name, value in model.named_parameters() if value.requires_grad],
            "buffers": [{"name": name, "dtype": str(value.dtype), "shape": list(value.shape),
                         "sha256": tensor_hash(value)} for name, value in model.named_buffers()],
            "configs": [{"name": name, "useCache": getattr(child.config, "use_cache", None),
                         "attentionImplementation": getattr(child.config, "_attn_implementation", None)}
                        for name, child in model.named_modules() if hasattr(child, "config")],
            "gradientCheckpointing": bool(model.is_gradient_checkpointing)}


def kernel_observation(modules=None) -> list[dict]:
    """Read selected Triton launch configurations without clearing or tuning them."""
    modules = list(sys.modules.items()) if modules is None else modules
    rows, seen = [], set()
    for module_name, module in modules:
        if not module_name.startswith("fla.") or module is None:
            continue
        for name, candidate in list(vars(module).items()):
            chain_seen = set()
            while candidate is not None and id(candidate) not in chain_seen:
                chain_seen.add(id(candidate))
                cache = getattr(candidate, "cache", None)
                if isinstance(cache, dict) and id(candidate) not in seen and hasattr(candidate, "configs"):
                    seen.add(id(candidate))
                    rows.append({"module": module_name, "name": name,
                                 "keyNames": list(getattr(candidate, "keys", [])),
                                 "selected": [{"key": str(key), "kwargs": dict(config.kwargs),
                                               "numWarps": config.num_warps, "numStages": config.num_stages}
                                              for key, config in cache.items() if hasattr(config, "kwargs")]})
                candidate = getattr(candidate, "fn", None)
    return rows


@contextlib.contextmanager
def temporary_flag(owner, name, value):
    original = getattr(owner, name)
    setattr(owner, name, value)
    try:
        yield
    finally:
        setattr(owner, name, original)


def diagnose(model_path: Path, run: Path, output: Path, lease_path: Path, *, maximum_seconds: int = 600) -> dict:
    from acephale.training import (PROBE_CONTEXT, _load_model, _parameter_hash, _probe_logits,
                                  _verify_probe_context, training_versions, validate_execution_lease, verify_base)
    from acephale.training_precision import require_training_precision

    if type(maximum_seconds) is not int or not 1 <= maximum_seconds <= 600:
        raise ValueError("Diagnostic deadline must be at most 600 seconds")
    lease = validate_execution_lease(lease_path, action="diagnostic")
    deadline = min(time.monotonic() + maximum_seconds, time.monotonic() + lease["deadline"] - time.time())
    spec, receipt = inputs(run, output)
    verify_base(model_path)
    versions = training_versions()
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "started.json", {"kind": "acephale-reload-diagnostic-v1", "seed": spec["seed"],
              "specificationHash": spec["contentHash"], "probeHash": receipt["probeHash"],
              "leaseId": lease["leaseId"], "instanceId": lease["instanceId"],
              "maximumSeconds": maximum_seconds, "optimizerCreated": False})

    def guard():
        if validate_execution_lease(lease_path, action="diagnostic") != lease:
            raise ValueError("Diagnostic authority changed")
        if time.monotonic() >= deadline:
            raise TimeoutError("Diagnostic deadline expired")

    import torch
    from peft import PeftModel, get_peft_model_state_dict
    from safetensors.torch import load_file
    from transformers import set_seed

    set_seed(spec["seed"])
    saved = torch.load(run / "reload-probe.pt", map_location="cpu", weights_only=True)
    _verify_probe_context(saved, spec)
    guard()
    base, _ = _load_model(model_path)
    require_training_precision(base, spec)
    model = PeftModel.from_pretrained(base, run / "adapter", is_trainable=False, local_files_only=True).eval()
    original_hashes = {"frozen": _parameter_hash(model, adapter=False), "adapter": _parameter_hash(model, adapter=True)}
    if original_hashes != {"frozen": receipt["frozenAfterHash"], "adapter": receipt["adapterAfterHash"]}:
        write_new(output / "parameter-mismatch.json", original_hashes)
        raise ValueError("Reloaded parameter bytes differ from the saved training hashes")
    stored = load_file(run / "adapter" / "adapter_model.safetensors")
    loaded = get_peft_model_state_dict(model)
    if set(stored) != set(loaded) or any(not torch.equal(value, loaded[name].cpu()) for name, value in stored.items()):
        raise ValueError("PEFT reload changed stored adapter tensors")
    modules = [torch, __import__("peft.peft_model", fromlist=["x"]),
               __import__("transformers.models.qwen3_5.modeling_qwen3_5", fromlist=["x"]),
               __import__("fla.ops.gated_delta_rule.chunk", fromlist=["x"]),
               __import__("fla.ops.gated_delta_rule.chunk_fwd", fromlist=["x"]),
               __import__("fla.ops.common.chunk_delta_h", fromlist=["x"]),
               __import__("fla.ops.common.chunk_o", fromlist=["x"]),
               __import__("fla.modules.norm.fused_norm_gate", fromlist=["x"])]
    write_new(output / "runtime.json", {"versions": versions, "torchCuda": torch.version.cuda,
              "cudnn": torch.backends.cudnn.version(), "gpu": torch.cuda.get_device_name(),
              "matmulPrecision": torch.get_float32_matmul_precision(),
              "matmulTf32": torch.backends.cuda.matmul.allow_tf32,
              "cudnnTf32": torch.backends.cudnn.allow_tf32,
              "bf16ReducedPrecisionReduction": torch.backends.cuda.matmul.allow_bf16_reduced_precision_reduction,
              "deterministicAlgorithms": torch.are_deterministic_algorithms_enabled(),
              "parameterHashes": original_hashes, "adapterStorageExact": True,
              "context": PROBE_CONTEXT, "historicalImageDigest": spec["implementation"]["imageDigest"],
              "sourceFiles": [{"module": module.__name__, "sha256": file_hash(Path(inspect.getfile(module)))}
                              for module in modules], "model": model_observation(model)})
    ids = saved["input_ids"].to("cuda")
    reference = saved["logits"]
    results = []

    def probe(name, operation=None, setup=None):
        guard()
        began = time.monotonic()
        try:
            if setup is not None:
                setup()
            values = _probe_logits(model, ids) if operation is None else operation()
            comparison = compare(values, reference)
            torch.save(values, output / f"{name}-logits.pt")
            result = {"mode": name, "comparison": comparison, "elapsedSeconds": time.monotonic() - began,
                      "kernelConfigurations": kernel_observation()}
        except Exception as error:
            result = {"mode": name, "errorType": type(error).__name__, "message": str(error)[:2000]}
        write_new(output / f"{name}.json", result)
        results.append(result)

    def explicit_cache(value):
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            return model(input_ids=ids, use_cache=value).logits[:, -1, :].float().cpu()

    try:
        probe("01-fresh-eval")
        probe("02-fresh-eval-repeat")
        probe("03-explicit-no-cache", lambda: explicit_cache(False))
        probe("04-explicit-cache", lambda: explicit_cache(True))
        with temporary_flag(torch.backends.cuda.matmul, "allow_bf16_reduced_precision_reduction", False):
            probe("09-disable-bf16-reduced-reduction")
        with temporary_flag(torch.backends.cuda.matmul, "allow_tf32", False):
            probe("10-disable-tf32")
        with temporary_flag(torch.backends.cuda.matmul, "allow_tf32", True):
            probe("11-enable-tf32")
        for name, value in model.named_parameters():
            if "lora_" in name:
                value.requires_grad_(True)
        probe("05-trainable-adapter-eval")

        def trl_setup():
            from trl.trainer.utils import add_fused_lm_head
            add_fused_lm_head(model.get_base_model(), outputs=("log_probs", "entropy", "is_top1"))

        def input_grad_setup():
            model.enable_input_require_grads()
            model.gradient_checkpointing_enable()
            model.eval()

        probe("06-trl-forward-wrapper", setup=trl_setup)
        probe("07-input-grad-checkpoint-eval", setup=input_grad_setup)
        original_forward = model.forward

        def accelerate_setup():
            from accelerate.utils import convert_outputs_to_fp32
            model.forward = convert_outputs_to_fp32(torch.autocast("cuda", dtype=torch.bfloat16)(original_forward))

        try:
            probe("08-accelerate-forward-wrapper", setup=accelerate_setup)
        finally:
            model.forward = original_forward
        guard()
        final_hashes = {"frozen": _parameter_hash(model, adapter=False), "adapter": _parameter_hash(model, adapter=True)}
        if final_hashes != original_hashes:
            raise ValueError("Diagnostic changed model parameters")
        result = {"kind": "acephale-reload-diagnostic-v1", "status": "completed", "seed": spec["seed"],
                  "optimizerCreated": False, "weightsUnchanged": True, "originalProbeUnchanged": True,
                  "isExportAcceptance": False, "qualified": False, "results": results}
        if file_hash(run / "reload-probe.pt") != receipt["probeHash"]:
            raise ValueError("Original probe changed")
        write_new(output / "result.json", result)
        return result
    except BaseException as error:
        write_new(output / "failure.json", {"kind": type(error).__name__, "message": str(error)[:2000],
                  "results": results, "optimizerCreated": False, "isExportAcceptance": False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("model", "run", "output", "lease"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--maximum-seconds", type=int, default=600)
    args = parser.parse_args()
    diagnose(args.model, args.run, args.output, args.lease, maximum_seconds=args.maximum_seconds)


if __name__ == "__main__":
    main()
