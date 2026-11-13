"""Measure a fitting batch before either main seed, using disposable LoRA weights."""

from __future__ import annotations

import argparse
import json
import math
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.training import validate_training_lease
from acephale.training_data import hashed, training_recipe, verify_dataset, verify_hashed, write_new


def longest_fitting_batch(rows: list[dict], tokenized: list[dict]) -> list[int]:
    if len(rows) != len(tokenized) or len(rows) < 16 or any(row.get("partition") != "weight_fit" for row in rows):
        raise ValueError("Profiling requires sixteen genuine fitting rows and matching tokenizations")
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Profiling cannot repeat fitting rows")
    return sorted(range(len(rows)), key=lambda index: (-len(tokenized[index]["input_ids"]), rows[index]["id"]))[:16]


def _fit_lease(path: Path) -> dict:
    lease = validate_training_lease(path)
    if lease["version"] in {2, 3} and lease["trainingKind"] != "fit":
        raise ValueError("Batch profiling consumes the fitting lease, never the smoke allowance")
    return lease


def _attempt(dataset: Path, model_path: Path, output: Path, lease_path: Path, micro_batch: int, deadline: float) -> dict:
    from acephale.training import (
        _collator,
        _load_model,
        _parameter_hash,
        binary_token_ids,
        lora_options,
        resolve_targets,
        tokenize_example,
        tokenizer_identity,
        trainer_options,
        training_implementation,
        training_versions,
        verify_base,
    )
    from acephale.training_data import load_partition

    manifest, lease = verify_dataset(dataset), _fit_lease(lease_path)
    if not math.isfinite(deadline) or not time.time() < deadline <= lease["deadline"]:
        raise ValueError("Profiling deadline must remain inside the active fitting lease")
    base = verify_base(model_path)
    if tokenizer_identity(model_path) != (manifest["tokenizerHash"], manifest["chatTemplateHash"]):
        raise ValueError("Profiling tokenizer differs from fitting data")
    versions, implementation = training_versions(), training_implementation()
    recipe = {**training_recipe(micro_batch=micro_batch, gradient_accumulation=16 // micro_batch),
              "maxSteps": 1, "warmupRatio": 0.0}
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import TrainerCallback, set_seed
    from trl import SFTConfig, SFTTrainer

    set_seed(17)
    started = time.monotonic()
    model, tokenizer = _load_model(model_path)
    kernel_profile = model.acephale_kernel_profile
    model = get_peft_model(model, LoraConfig(**lora_options(recipe, resolve_targets(model))))
    trainable = [name for name, parameter in model.named_parameters() if parameter.requires_grad]
    if not trainable or any("lora_A" not in name and "lora_B" not in name for name in trainable):
        raise ValueError("Profiling may update only disposable LoRA tensors")
    rows = load_partition(dataset, "weight_fit")
    tokenized = [tokenize_example(row, tokenizer) for row in rows]
    indices = longest_fitting_batch(rows, tokenized)
    fitting = [tokenized[index] for index in indices]
    frozen_before, adapter_before = _parameter_hash(model, adapter=False), _parameter_hash(model, adapter=True)
    output.mkdir(parents=True, exist_ok=False)
    specification = hashed({"kind": "acephale-batch-profile-attempt", "datasetManifestHash": manifest["contentHash"],
        "leaseHash": hash_v1(lease), "baseReceiptHash": hash_v1(base), "implementation": implementation,
        "versions": versions, "kernelProfile": kernel_profile, "recipe": recipe, "binaryTokenIds": binary_token_ids(tokenizer),
        "fittingIds": [rows[index]["id"] for index in indices], "seed": 17,
        "purpose": "Disposable batch capacity measurement; no trained weights are exported"})
    write_new(output / "specification.json", specification)

    class Guard(TrainerCallback):
        gradient_checks = 0

        def on_step_begin(self, args, state, control, **kwargs):
            if _fit_lease(lease_path) != lease or time.time() >= deadline:
                raise TimeoutError("Fitting profile lease or deadline no longer valid")

        on_substep_end = on_step_begin
        on_step_end = on_step_begin

        def on_pre_optimizer_step(self, args, state, control, **kwargs):
            self.on_step_begin(args, state, control, **kwargs)
            gradients = []
            for name, parameter in kwargs["model"].named_parameters():
                if parameter.grad is not None:
                    if name not in trainable or not parameter.requires_grad:
                        raise RuntimeError("Frozen parameter received a profiling gradient")
                    gradients.append(parameter.grad)
            if (not gradients or any(not torch.isfinite(gradient).all() for gradient in gradients)
                    or not any(torch.count_nonzero(gradient).item() for gradient in gradients)):
                raise RuntimeError("Profiling requires finite nonzero LoRA gradients")
            self.gradient_checks += 1

    guard = Guard()
    config = SFTConfig(output_dir=str(output / "diagnostics"), **trainer_options(recipe),
        dataset_kwargs={"skip_prepare_dataset": True}, seed=17, data_seed=17, logging_steps=1,
        save_strategy="no", eval_strategy="no", report_to=["tensorboard"],
        remove_unused_columns=False, dataloader_num_workers=0)
    trainer = SFTTrainer(model=model, processing_class=tokenizer, args=config,
        data_collator=_collator(tokenizer), train_dataset=Dataset.from_list(fitting), callbacks=[guard])
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    step_started = time.monotonic()
    trainer.train()
    torch.cuda.synchronize()
    step_seconds = time.monotonic() - step_started
    frozen_after, adapter_after = _parameter_hash(model, adapter=False), _parameter_hash(model, adapter=True)
    if trainer.state.global_step != 1 or guard.gradient_checks != 1 or frozen_after != frozen_before or adapter_after == adapter_before:
        raise RuntimeError("Profiling did not establish exactly one isolated adapter update")
    guard.on_step_begin(None, None, None)
    result = hashed({"kind": "acephale-batch-profile-measurement", "status": "completed",
        "specificationHash": specification["contentHash"], "datasetManifestHash": manifest["contentHash"],
        "microBatch": micro_batch, "gradientAccumulation": 16 // micro_batch, "optimizerSteps": 1,
        "stepSeconds": step_seconds, "totalSeconds": time.monotonic() - started,
        "peakAllocatedBytes": torch.cuda.max_memory_allocated(), "peakReservedBytes": torch.cuda.max_memory_reserved(),
        "fittingTokens": sum(len(row["input_ids"]) for row in fitting), "maximumSequenceTokens": max(len(row["input_ids"]) for row in fitting),
        "frozenBeforeHash": frozen_before, "frozenAfterHash": frozen_after,
        "adapterBeforeHash": adapter_before, "adapterAfterHash": adapter_after,
        "weightsExported": False, "nativeTaskAccuracyMeasured": False})
    write_new(output / "measurement.json", result)
    return result


def _run_attempt(command: list[str], log: Path, deadline: float) -> int:
    from acephale.experiment_runner import stop_signals

    with stop_signals() as stopped:
        process = None
        try:
            with log.open("x", encoding="utf-8") as stream:
                if stopped or time.time() >= deadline:
                    raise TimeoutError("Profile attempt cancelled before launch")
                process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
                while True:
                    if stopped:
                        raise InterruptedError("Profile attempt cancelled")
                    if time.time() >= deadline:
                        raise subprocess.TimeoutExpired(command, 0)
                    try:
                        return process.wait(timeout=min(0.1, deadline - time.time()))
                    except subprocess.TimeoutExpired:
                        pass
        finally:
            if process is not None:
                # Drain compiler descendants too, including when the leader already exited.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=30)


def profile(dataset: Path, model_path: Path, output: Path, lease_path: Path, *, maximum_seconds: int = 600) -> dict:
    if os.name != "posix" or type(maximum_seconds) is not int or not 1 <= maximum_seconds <= 1200:
        raise ValueError("Profiling requires Linux and a maximum of 1,200 seconds")
    manifest, lease = verify_dataset(dataset), _fit_lease(lease_path)
    deadline = min(time.time() + maximum_seconds, lease["deadline"])
    output.mkdir(parents=True, exist_ok=False)
    plan = hashed({"kind": "acephale-batch-profile-plan", "datasetManifestHash": manifest["contentHash"],
        "leaseHash": hash_v1(lease), "deadline": deadline, "orderedMicroBatches": [4, 2, 1],
        "effectiveBatch": 16, "selection": "first_successful_descending_microbatch", "fallbackOnlyOnCudaOutOfMemory": True})
    write_new(output / "plan.json", plan)
    attempts = []
    for micro_batch in plan["orderedMicroBatches"]:
        if time.time() >= deadline or _fit_lease(lease_path) != lease:
            raise TimeoutError("Batch profiling deadline reached")
        directory = output / f"micro-{micro_batch}"
        command = [sys.executable, "-m", "acephale.training_profile", "--attempt", "--dataset", str(dataset),
                   "--model", str(model_path), "--lease", str(lease_path), "--output", str(directory),
                   "--micro-batch", str(micro_batch), "--deadline", str(deadline)]
        code = _run_attempt(command, output / f"micro-{micro_batch}.log", deadline)
        attempts.append({"microBatch": micro_batch, "exitCode": code})
        if code == 2 and (directory / "failure.json").is_file():
            failure = json.loads((directory / "failure.json").read_text(encoding="utf-8"))
            if failure.get("kind") == "cuda_out_of_memory":
                continue
        if code != 0:
            raise RuntimeError("Batch profiling failed; retained attempt may not be replaced for another error")
        measurement = verify_hashed(json.loads((directory / "measurement.json").read_text(encoding="utf-8")))
        if (measurement.get("status") != "completed" or measurement.get("microBatch") != micro_batch
                or measurement.get("datasetManifestHash") != manifest["contentHash"]):
            raise ValueError("Profile measurement differs from its declared attempt")
        result = hashed({"kind": "acephale-batch-profile-selection", "planHash": plan["contentHash"],
            "measurementHash": measurement["contentHash"], "microBatch": micro_batch,
            "gradientAccumulation": 16 // micro_batch, "attempts": attempts, "weightsExported": False,
            "requiresFreshMainSeeds": [17, 29]})
        write_new(output / "selection.json", result)
        return result
    raise RuntimeError("No declared fitting batch fits; all OOM attempts retained")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("dataset", "model", "lease", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--attempt", action="store_true")
    parser.add_argument("--micro-batch", type=int, choices=[1, 2, 4])
    parser.add_argument("--deadline", type=float)
    args = parser.parse_args()
    if not args.attempt or args.micro_batch is None or args.deadline is None:
        parser.error("This internal entrypoint requires an explicit bounded profile attempt")
    try:
        _attempt(args.dataset, args.model, args.output, args.lease, args.micro_batch, args.deadline)
    except BaseException as error:
        import torch

        oom = isinstance(error, torch.OutOfMemoryError)
        args.output.mkdir(parents=True, exist_ok=True)
        write_new(args.output / "failure.json", {"status": "failed", "kind": "cuda_out_of_memory" if oom else type(error).__name__})
        if oom:
            raise SystemExit(2) from error
        raise


if __name__ == "__main__":
    main()
