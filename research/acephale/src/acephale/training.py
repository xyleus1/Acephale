"""Bounded real LoRA training. Heavy dependencies are imported only by GPU commands."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1
from acephale.storage import file_hash
from acephale.training_data import (
    BASE,
    RECIPE,
    calibration_families,
    file_inventory,
    hashed,
    load_partition,
    verify_dataset,
    verify_hashed,
    write_new,
)

TRAINING_VERSIONS = {"torch": "2.13.0", "transformers": "5.10.1", "peft": "0.21.0", "trl": "1.16.0",
                     "accelerate": "1.15.0", "datasets": "5.2.0"}
TARGET_SUFFIXES = {"q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj",
                   "in_proj_qkv", "in_proj_z", "in_proj_b", "in_proj_a", "out_proj"}
TOKENIZER_FILES = {"tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json",
                   "vocab.json", "merges.txt", "chat_template.jinja"}
PROBE_CONTEXT = {"version": 1, "deviceType": "cuda", "autocastDtype": "bfloat16",
                 "inferenceMode": True, "modelMode": "eval", "selection": "last_token_full_vocabulary",
                 "outputDtype": "float32"}


def training_versions() -> dict[str, str]:
    observed = {name: importlib.metadata.version(name) for name in TRAINING_VERSIONS}
    if any(observed[name].split("+")[0] != version for name, version in TRAINING_VERSIONS.items()):
        raise ValueError("Training package versions differ from the locked recipe")
    return observed


def validate_training_lease(path: Path, *, now: float | None = None) -> dict[str, Any]:
    lease = json.loads(path.read_text(encoding="utf-8"))
    now = time.time() if now is None else now
    if lease.get("version") != 1 or lease.get("profile") != "acephale-training-lease-v1" or lease.get("phase") != "predictor_training" or lease.get("status") != "active" or lease.get("actorStopped") is not True:
        raise ValueError("Active predictor-training lease with stopped actor required")
    started, deadline = lease.get("startedAt"), lease.get("deadline")
    if any(type(value) not in {int, float} or not math.isfinite(value) for value in (started, deadline)) or not started <= now < deadline or not 0 < deadline - started <= 7200:
        raise ValueError("Training lease is expired or exceeds two hours")
    if lease.get("hardwareProfile") != "a100-40gb-v1" or not lease.get("instanceId") or not lease.get("leaseId"):
        raise ValueError("Training lease lacks verified hardware/instance identity")
    reservation = lease.get("studyReservation", {})
    if not str(reservation.get("reservationId", "")).startswith("lambda-infra:") or type(reservation.get("maximumMicrodollars")) is not int or not 0 < reservation["maximumMicrodollars"] <= 35_000_000:
        raise ValueError("Existing study infrastructure reservation required")
    from acephale.training_data import DIGEST

    if any(not DIGEST.fullmatch(str(lease.get(key, ""))) for key in ("studyBindingHash", "providerLeaseHash")):
        raise ValueError("Training lease must bind the original study and provider lease")
    return lease


def tokenizer_identity(directory: Path) -> tuple[str, str]:
    files = [row for row in file_inventory(directory) if row["path"] in TOKENIZER_FILES]
    if not any(row["path"] == "tokenizer_config.json" for row in files) or not any(row["path"] == "tokenizer.json" for row in files):
        raise ValueError("Complete pinned tokenizer files required")
    config = json.loads((directory / "tokenizer_config.json").read_text(encoding="utf-8"))
    template = (directory / "chat_template.jinja").read_text(encoding="utf-8") if (directory / "chat_template.jinja").exists() else config.get("chat_template")
    if not template:
        raise ValueError("Pinned chat template required")
    return hash_v1(files), hash_v1(template)


def preserve_tokenizer(source: Path, destination: Path) -> None:
    """Preserve pinned bytes, rather than serializer-version dependent rewrites."""
    for name in TOKENIZER_FILES:
        original, target = source / name, destination / name
        if original.is_file():
            shutil.copyfile(original, target)
        elif target.exists():
            target.unlink()
    if tokenizer_identity(source) != tokenizer_identity(destination):
        raise ValueError("Exported tokenizer differs from the compiled training inputs")


def training_implementation() -> dict[str, Any]:
    image = os.environ.get("ACEPHALE_TRAINER_IMAGE_DIGEST", "")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise ValueError("Observed immutable trainer image digest required")
    package = Path(__file__).resolve().parents[2]
    lock = package / "training" / "uv.lock"
    if not lock.is_file():
        raise ValueError("Actual training environment lock required")
    sources = [row for row in file_inventory(package / "src") if row["path"].endswith(".py")]
    return {"imageDigest": image, "lockHash": file_hash(lock), "pythonSourceFiles": sources,
            "pythonSourceHash": hash_v1(sources)}


def verify_base(directory: Path) -> dict[str, Any]:
    receipt = json.loads((directory / "acephale-model.receipt.json").read_text(encoding="utf-8"))
    if {key: receipt.get(key) for key in BASE} != BASE or receipt.get("role") != "predictor":
        raise ValueError("Only the exact pinned predictor may be trained")
    root = directory.resolve()
    for row in receipt.get("files", []):
        path = (directory / row["path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file() or file_hash(path) != row["sha256"] or path.stat().st_size != row["bytes"]:
            raise ValueError("Base model snapshot changed")
    if not any(row["path"].endswith(".safetensors") for row in receipt.get("files", [])):
        raise ValueError("Base model receipt contains no actual weights")
    return receipt


def tokenize_example(row: dict[str, Any], tokenizer, *, max_length: int = 8192) -> dict[str, Any]:
    """Use the serving template, retain completion-only labels, never truncate."""
    options = {"tokenize": False, "enable_thinking": False}
    prompt = tokenizer.apply_chat_template(row["prompt"], add_generation_prompt=True, **options)
    complete = tokenizer.apply_chat_template([*row["prompt"], {"role": "assistant", "content": row["completion"]}], add_generation_prompt=False, **options)
    prompt_ids = tokenizer.encode(prompt, add_special_tokens=False)
    input_ids = tokenizer.encode(complete, add_special_tokens=False)
    if not complete.startswith(prompt) or input_ids[:len(prompt_ids)] != prompt_ids:
        raise ValueError("Training completion does not preserve the exact serving prompt prefix")
    if len(prompt_ids) != row["promptTokens"]:
        raise ValueError("Serving and training token counts differ")
    completion_length = len(input_ids) - len(prompt_ids)
    if not 0 < completion_length <= 1024 or len(input_ids) > max_length:
        raise ValueError("Training example exceeds the declared input/output budget")
    return {"input_ids": input_ids, "attention_mask": [1] * len(input_ids),
            "labels": [-100] * len(prompt_ids) + input_ids[len(prompt_ids):]}


def binary_token_ids(tokenizer) -> dict[str, int]:
    result = {}
    for key, text in (("zero", "0"), ("one", "1")):
        ids = tokenizer.encode(text, add_special_tokens=False)
        if len(ids) != 1 or tokenizer.decode(ids) != text:
            raise ValueError("Binary scoring requires distinct single-token digits")
        result[key] = ids[0]
    if result["zero"] == result["one"]:
        raise ValueError("Binary scoring token IDs collide")
    # Reject tokenizers that merge the binary labels into punctuation or neighbours.
    text = '{"action":"READ","hits":[0,1,0]}'
    ids = tokenizer.encode(text, add_special_tokens=False)
    if [value for value in ids if value in result.values()] != [result["zero"], result["one"], result["zero"]]:
        raise ValueError("Binary digits cannot be aligned in the actual output format")
    return result


def _parameter_hash(model, *, adapter: bool) -> str:
    import torch

    digest = hashlib.sha256()
    for name, parameter in sorted(model.named_parameters()):
        if ("lora_" in name) != adapter:
            continue
        digest.update(name.encode())
        digest.update(str(parameter.dtype).encode())
        digest.update(str(tuple(parameter.shape)).encode())
        raw = parameter.detach().contiguous().view(torch.uint8).cpu().numpy()
        digest.update(memoryview(raw))
    return digest.hexdigest()


def resolve_targets(model) -> list[str]:
    import torch

    names = [name for name, module in model.named_modules()
             if isinstance(module, torch.nn.Linear) and ".layers." in name and "visual" not in name
             and name.rsplit(".", 1)[-1] in TARGET_SUFFIXES]
    if {name.rsplit(".", 1)[-1] for name in names} != TARGET_SUFFIXES:
        raise ValueError("Pinned text attention, Gated DeltaNet and MLP targets were not all found")
    return sorted(names)


def _collator(tokenizer):
    import torch

    def collate(rows):
        width = max(len(row["input_ids"]) for row in rows)
        return {key: torch.tensor([row[key] + [padding] * (width - len(row[key])) for row in rows])
                for key, padding in (("input_ids", tokenizer.pad_token_id), ("attention_mask", 0), ("labels", -100))}
    return collate


def _load_model(model_path: Path):
    import torch
    from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration

    if not torch.cuda.is_available():
        raise RuntimeError("The approved real-model trainer requires a qualified CUDA GPU")
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = Qwen3_5ForConditionalGeneration.from_pretrained(model_path, local_files_only=True,
            torch_dtype=torch.bfloat16, attn_implementation="sdpa").to("cuda")
    model.config.use_cache = False
    return model, tokenizer


def effective_training_recipe(steps: int, *, smoke: bool = False) -> dict[str, Any]:
    if not 1 <= steps <= 500 or (smoke and steps != 1):
        raise ValueError("Smoke requires exactly one optimizer step")
    # ceil(0.03 * 1) creates a single warmup step at learning rate zero.
    # The smoke must update an adapter; the declared fitting schedule is unchanged.
    return {**RECIPE, "maxSteps": steps, "warmupRatio": 0.0 if smoke else RECIPE["warmupRatio"]}


def _probe_logits(model, input_ids, *, device_type: str = "cuda"):
    """Use one explicit precision context with or without Accelerate's wrapper."""
    import torch

    if model.training or input_ids.device.type != device_type:
        raise ValueError("Probe requires eval mode and matching input device")
    with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=torch.bfloat16):
        return model(input_ids=input_ids).logits[:, -1, :].float().cpu()


def _verify_probe_context(probe: dict, specification: dict) -> None:
    expected = hash_v1(PROBE_CONTEXT)
    if hash_v1(probe.get("context")) != expected or hash_v1(specification.get("probeContext")) != expected:
        raise ValueError("Exact declared probe precision context required; legacy probes cannot be resealed")


def train(dataset: Path, model_path: Path, output: Path, lease_path: Path, *, seed: int,
          max_steps: int = 500, maximum_seconds: int = 3600, smoke: bool = False) -> dict[str, Any]:
    manifest = verify_dataset(dataset)
    lease = validate_training_lease(lease_path)
    base_receipt = verify_base(model_path)
    identities = tokenizer_identity(model_path)
    if identities != (manifest["tokenizerHash"], manifest["chatTemplateHash"]):
        raise ValueError("Dataset tokenizer or template differs from the actual model")
    if seed not in RECIPE["seeds"] or not 1 <= max_steps <= 500 or not 1 <= maximum_seconds <= 7200 or (smoke and max_steps != 1):
        raise ValueError("Training recipe bounds exceeded")
    versions = training_versions()
    implementation = training_implementation()
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import TrainerCallback, set_seed
    from trl import SFTConfig, SFTTrainer

    set_seed(seed)
    started = time.monotonic()
    deadline = min(started + maximum_seconds, started + lease["deadline"] - time.time())
    model, tokenizer = _load_model(model_path)
    targets = resolve_targets(model)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                                           target_modules=targets, task_type="CAUSAL_LM", bias="none"))
    trainable = {name: parameter.numel() for name, parameter in model.named_parameters() if parameter.requires_grad}
    if not trainable or any("lora_A" not in name and "lora_B" not in name for name in trainable):
        raise ValueError("Only LoRA tensors may receive gradients")
    fitting = [tokenize_example(row, tokenizer) for row in load_partition(dataset, "weight_fit")]
    development = [tokenize_example(row, tokenizer) for row in load_partition(dataset, "development")]
    steps = min(max_steps, math.ceil(len(fitting) / 16) * 3)
    recipe = effective_training_recipe(steps, smoke=smoke)
    binary_ids = binary_token_ids(tokenizer)
    frozen_before, adapter_before = _parameter_hash(model, adapter=False), _parameter_hash(model, adapter=True)
    output.mkdir(parents=True, exist_ok=False)
    specification = hashed({"schemaVersion": 1, "base": BASE, "datasetManifestHash": manifest["contentHash"],
        "seed": seed, "mode": "smoke" if smoke else "fit", "recipe": recipe, "versions": versions, "implementation": implementation, "targets": targets,
        "probeContext": dict(PROBE_CONTEXT),
        "trainableParameters": trainable, "trainableCount": sum(trainable.values()), "binaryTokenIds": binary_ids,
        "leaseHash": hash_v1(lease), "baseReceiptHash": hash_v1(base_receipt), "frozenBeforeHash": frozen_before,
        "adapterBeforeHash": adapter_before})
    write_new(output / "training-specification.json", specification)

    class Guard(TrainerCallback):
        gradient_checks = 0

        def on_step_begin(self, args, state, control, **kwargs):
            if validate_training_lease(lease_path) != lease:
                raise ValueError("Training lease changed during execution")
            if time.monotonic() >= deadline:
                raise TimeoutError("Bounded training deadline reached")

        on_substep_end = on_step_begin
        on_step_end = on_step_begin
        on_prediction_step = on_step_begin

        def on_pre_optimizer_step(self, args, state, control, **kwargs):
            self.on_step_begin(args, state, control, **kwargs)
            model = kwargs["model"]
            present = False
            nonzero = False
            for name, parameter in model.named_parameters():
                if parameter.grad is not None:
                    if name not in trainable or not parameter.requires_grad:
                        raise RuntimeError("Frozen parameter received a gradient")
                    if not torch.isfinite(parameter.grad).all():
                        raise RuntimeError("Nonfinite adapter gradient")
                    present = True
                    nonzero = nonzero or bool(torch.count_nonzero(parameter.grad).item())
            if not present or not nonzero:
                raise RuntimeError("No nonzero LoRA gradients were produced")
            self.gradient_checks += 1

    guard = Guard()
    config = SFTConfig(output_dir=str(output / "checkpoints"), learning_rate=1e-4, weight_decay=0.01,
        max_grad_norm=1.0, warmup_ratio=recipe["warmupRatio"], per_device_train_batch_size=1, per_device_eval_batch_size=1,
        gradient_accumulation_steps=16, gradient_checkpointing=True, bf16=True,
        max_steps=steps, num_train_epochs=3, max_length=8192, packing=False,
        dataset_kwargs={"skip_prepare_dataset": True}, completion_only_loss=True, seed=seed, data_seed=seed,
        logging_steps=1, save_strategy="steps", save_steps=50, save_total_limit=2,
        eval_strategy="steps" if development else "no", eval_steps=50, report_to=["tensorboard"],
        remove_unused_columns=False, optim="adamw_torch", dataloader_num_workers=0)
    trainer = SFTTrainer(model=model, processing_class=tokenizer, args=config, data_collator=_collator(tokenizer),
        train_dataset=Dataset.from_list(fitting), eval_dataset=Dataset.from_list(development) if development else None,
        callbacks=[guard])
    frozen_after = adapter_after = None
    try:
        result = trainer.train()
        frozen_after, adapter_after = _parameter_hash(model, adapter=False), _parameter_hash(model, adapter=True)
        if not guard.gradient_checks or frozen_after != frozen_before or adapter_after == adapter_before:
            raise RuntimeError("Actual adapter update and unchanged frozen weights were not proven")
        model.eval()
        probe = fitting[0]
        ids = torch.tensor([probe["input_ids"][:min(len(probe["input_ids"]), 256)]], device="cuda")
        probe_logits = _probe_logits(model, ids)
        adapter_dir = output / "adapter"
        model.save_pretrained(adapter_dir, safe_serialization=True)
        tokenizer.save_pretrained(adapter_dir)
        preserve_tokenizer(model_path, adapter_dir)
        torch.save({"input_ids": ids.cpu(), "logits": probe_logits, "context": dict(PROBE_CONTEXT)}, output / "reload-probe.pt")
        metrics = trainer.evaluate() if development else {}
        receipt = hashed({"schemaVersion": 1, "kind": "acephale-training-receipt", "status": "completed",
            "trainingManifestHash": manifest["contentHash"], "specificationHash": specification["contentHash"],
            "seed": seed, "steps": trainer.state.global_step, "gradientChecks": guard.gradient_checks,
            "adapterBeforeHash": adapter_before, "adapterAfterHash": adapter_after, "frozenBeforeHash": frozen_before,
            "frozenAfterHash": frozen_after, "elapsedSeconds": time.monotonic() - started,
            "trainingMetrics": result.metrics, "developmentMetrics": metrics,
            "peakGpuBytes": torch.cuda.max_memory_allocated(), "adapterFiles": file_inventory(adapter_dir),
            "probeHash": file_hash(output / "reload-probe.pt"), "binaryTokenIds": binary_ids})
        write_new(output / "receipt.json", receipt)
        return receipt
    except BaseException as error:
        write_new(output / "failure.json", {"status": "failed", "kind": type(error).__name__, "message": str(error),
                    "elapsedSeconds": time.monotonic() - started, "steps": trainer.state.global_step,
                    "gradientChecks": guard.gradient_checks, "frozenAfterHash": frozen_after,
                    "adapterAfterHash": adapter_after,
                    "trainingManifestHash": manifest["contentHash"], "paidTrainingMayHaveOccurred": True})
        raise


def export_model(dataset: Path, model_path: Path, run: Path, output: Path, lease_path: Path) -> dict[str, Any]:
    manifest = verify_dataset(dataset)
    if not manifest["calibrationFamilies"]:
        raise ValueError("Export requires declared independent calibration families")
    validate_training_lease(lease_path)
    verify_base(model_path)
    training_versions()
    receipt = verify_hashed(json.loads((run / "receipt.json").read_text(encoding="utf-8")))
    specification = verify_hashed(json.loads((run / "training-specification.json").read_text(encoding="utf-8")))
    if receipt.get("status") != "completed" or receipt.get("trainingManifestHash") != manifest["contentHash"]:
        raise ValueError("Only a completed, dataset-bound training receipt can be exported")
    if receipt.get("specificationHash") != specification["contentHash"] or specification.get("datasetManifestHash") != manifest["contentHash"]:
        raise ValueError("Exact immutable training specification required")
    if receipt.get("frozenBeforeHash") != receipt.get("frozenAfterHash") or receipt.get("adapterBeforeHash") == receipt.get("adapterAfterHash"):
        raise ValueError("Receipt does not establish isolated adapter training")
    if file_inventory(run / "adapter") != receipt["adapterFiles"] or file_hash(run / "reload-probe.pt") != receipt["probeHash"]:
        raise ValueError("Trained adapter or verification probe changed")
    import torch
    from peft import PeftModel

    probe = torch.load(run / "reload-probe.pt", map_location="cpu", weights_only=True)
    _verify_probe_context(probe, specification)
    base, tokenizer = _load_model(model_path)
    model = PeftModel.from_pretrained(base, run / "adapter", is_trainable=False, local_files_only=True).eval()
    reloaded = _probe_logits(model, probe["input_ids"].to("cuda"))
    torch.testing.assert_close(reloaded, probe["logits"], rtol=0.02, atol=0.03)
    merged = model.merge_and_unload(safe_merge=True).eval()
    merged_logits = _probe_logits(merged, probe["input_ids"].to("cuda"))
    torch.testing.assert_close(merged_logits, reloaded, rtol=0.03, atol=0.06)
    if merged_logits.argmax(-1).tolist() != reloaded.argmax(-1).tolist():
        raise ValueError("Merged predictor changed probe top-token decisions")
    validate_training_lease(lease_path)
    output.mkdir(parents=True, exist_ok=False)
    merged_dir = output / "model"
    merged.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)
    preserve_tokenizer(model_path, merged_dir)
    merged_files = file_inventory(merged_dir)
    weights_hash = hash_v1(merged_files)
    artifact = hashed({"schemaVersion": 1, "kind": "acephale-trained-predictor", "base": BASE,
        "adapterHash": hash_v1(receipt["adapterFiles"]), "mergedWeightsHash": weights_hash,
        "tokenizerHash": manifest["tokenizerHash"], "chatTemplateHash": manifest["chatTemplateHash"],
        "trainingManifestHash": specification["contentHash"], "weightFitFamilies": manifest["weightFitFamilies"],
        "calibrationFamilies": manifest["calibrationFamilies"], "servedModel": "acephale-predictor-" + weights_hash[:12],
        "protocol": "rank_binary_v1", "binaryTokenIds": receipt["binaryTokenIds"]})
    write_new(output / "predictor.json", artifact)
    write_new(output / "training-manifest.json", specification)
    write_new(output / "dataset-manifest.json", manifest)
    write_new(output / "training-receipt.json", receipt)
    write_new(output / "verification.json", hashed({"artifactHash": artifact["contentHash"],
        "receiptHash": receipt["contentHash"], "mergedFiles": merged_files, "adapterFiles": receipt["adapterFiles"],
        "probeContext": dict(PROBE_CONTEXT),
        "reloadMaximumLogitError": (reloaded - probe["logits"]).abs().max().item(),
        "mergeMaximumLogitError": (merged_logits - reloaded).abs().max().item(), "nativeTaskSuccessMeasured": False,
        "reload": {"atol": 0.03, "rtol": 0.02, "referenceMaximumAbsolute": probe["logits"].abs().max().item(), "allClose": True},
        "merge": {"atol": 0.06, "rtol": 0.03, "referenceMaximumAbsolute": reloaded.abs().max().item(), "allClose": True},
        "topTokenStable": True}))
    return artifact


def verify_export(directory: Path) -> dict[str, Any]:
    """Validate the full local serving artifact chain without importing PyTorch."""
    artifact = verify_hashed(json.loads((directory / "predictor.json").read_text(encoding="utf-8")))
    specification = verify_hashed(json.loads((directory / "training-manifest.json").read_text(encoding="utf-8")))
    dataset = verify_hashed(json.loads((directory / "dataset-manifest.json").read_text(encoding="utf-8")))
    receipt = verify_hashed(json.loads((directory / "training-receipt.json").read_text(encoding="utf-8")))
    verification = verify_hashed(json.loads((directory / "verification.json").read_text(encoding="utf-8")))
    _verify_probe_context({"context": verification.get("probeContext")}, specification)
    calibration_families({**BASE, "trainedPredictor": artifact})
    if (artifact.get("schemaVersion") != 1 or artifact.get("base") != BASE or artifact.get("protocol") != "rank_binary_v1"
            or specification.get("base") != BASE or dataset.get("base") != BASE
            or artifact.get("trainingManifestHash") != specification["contentHash"]
            or specification.get("datasetManifestHash") != dataset["contentHash"]
            or receipt.get("status") != "completed" or receipt.get("trainingManifestHash") != dataset["contentHash"]
            or receipt.get("specificationHash") != specification["contentHash"]
            or receipt.get("frozenBeforeHash") != receipt.get("frozenAfterHash")
            or receipt.get("adapterBeforeHash") == receipt.get("adapterAfterHash")
            or type(receipt.get("gradientChecks")) is not int or receipt["gradientChecks"] < 1
            or any(artifact.get(key) != dataset.get(key) for key in ("weightFitFamilies", "calibrationFamilies", "tokenizerHash", "chatTemplateHash"))
            or artifact.get("adapterHash") != hash_v1(receipt.get("adapterFiles"))
            or artifact.get("binaryTokenIds") != receipt.get("binaryTokenIds")):
        raise ValueError("Trained predictor artifact chain is inconsistent")
    files = file_inventory(directory / "model")
    if (not any(row["path"].endswith(".safetensors") for row in files)
            or verification.get("artifactHash") != artifact["contentHash"] or verification.get("receiptHash") != receipt["contentHash"]
            or files != verification.get("mergedFiles") or hash_v1(files) != artifact.get("mergedWeightsHash")
            or verification.get("adapterFiles") != receipt["adapterFiles"]
            or artifact.get("servedModel") != "acephale-predictor-" + artifact["mergedWeightsHash"][:12]
            or tokenizer_identity(directory / "model") != (artifact["tokenizerHash"], artifact["chatTemplateHash"])):
        raise ValueError("Serving weights or tokenizer differ from the verified export")
    for stage, atol, rtol in (("reload", 0.03, 0.02), ("merge", 0.06, 0.03)):
        tolerance = verification.get(stage, {})
        error = verification.get(stage + "MaximumLogitError")
        reference = tolerance.get("referenceMaximumAbsolute")
        if (tolerance.get("atol") != atol or tolerance.get("rtol") != rtol or tolerance.get("allClose") is not True
                or any(type(value) not in {int, float} or not math.isfinite(value) or value < 0 for value in (error, reference))
                or error > atol + rtol * reference or verification.get("topTokenStable") is not True):
            raise ValueError("Export lacks bounded finite reload/merge parity evidence")
    return artifact


def evaluate(dataset: Path, model_path: Path, output: Path, lease_path: Path, *, partition: str = "development") -> dict[str, Any]:
    """Offline teacher-forced loss diagnostic, never a native task-success score."""
    manifest = verify_dataset(dataset)
    lease = validate_training_lease(lease_path)
    if partition not in {"calibration", "development", "test"}:
        raise ValueError("Evaluation requires a non-fitting partition")
    training_versions()
    if tokenizer_identity(model_path) != (manifest["tokenizerHash"], manifest["chatTemplateHash"]):
        raise ValueError("Evaluation tokenizer differs from the compiled dataset")
    if (model_path / "acephale-model.receipt.json").is_file():
        model_identity = {"baseReceiptHash": hash_v1(verify_base(model_path)), "base": BASE}
    else:
        model_identity = verify_export(model_path.parent)
    import torch

    model, tokenizer = _load_model(model_path)
    model.eval()
    rows = load_partition(dataset, partition)
    measured = []
    with torch.inference_mode():
        for row in rows:
            if validate_training_lease(lease_path) != lease:
                raise ValueError("Evaluation lease changed during execution")
            tokenized = tokenize_example(row, tokenizer)
            batch = {key: torch.tensor([value], device="cuda") for key, value in tokenized.items()}
            result = model(**batch)
            targets = batch["labels"][:, 1:]
            mask = targets != -100
            predictions = result.logits[:, :-1].argmax(-1)
            measured.append({"id": row["id"], "familyId": row["familyId"], "task": row["task"],
                             "completionLoss": result.loss.item(), "completionTokens": mask.sum().item(),
                             "correctTokens": ((predictions == targets) & mask).sum().item()})
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "evaluation.json", hashed({"kind": "acephale-teacher-forced-training-diagnostic",
        "trainingManifestHash": manifest["contentHash"], "modelIdentity": model_identity, "leaseHash": hash_v1(lease), "partition": partition, "rows": measured,
        "nativeTaskAccuracy": None, "limitation": "Teacher-forced completion metrics, not free-running prediction or task success"}))
    return {"examples": len(measured), "output": str(output)}
