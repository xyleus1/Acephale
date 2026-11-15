"""Test FLA shape-history effects using reconstructed fitting input, without optimization."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from acephale.reload_diagnostic import compare, inputs, kernel_observation, tensor_hash
from acephale.training_data import file_hash, load_partition, verify_dataset, write_new


def require_no_optimizer(trainer):
    if trainer.optimizer is not None or trainer.lr_scheduler is not None:
        raise ValueError("Warmup diagnosis must never construct an optimizer or scheduler")


def diagnose_warmup(dataset: Path, model_path: Path, run: Path, output: Path, lease_path: Path,
                    *, maximum_seconds: int = 600) -> dict:
    from acephale.training import (_collator, _load_model, _parameter_hash, _probe_logits,
                                  _verify_probe_context, tokenize_example, trainer_options,
                                  training_versions, validate_execution_lease, verify_base)
    from acephale.training_precision import require_training_precision

    if type(maximum_seconds) is not int or not 1 <= maximum_seconds <= 600:
        raise ValueError("Warmup diagnosis requires at most 600 seconds")
    lease = validate_execution_lease(lease_path, action="diagnostic")
    deadline = min(time.monotonic() + maximum_seconds, time.monotonic() + lease["deadline"] - time.time())
    spec, receipt = inputs(run, output)
    manifest = verify_dataset(dataset)
    if manifest["contentHash"] != spec["datasetManifestHash"]:
        raise ValueError("Only the frozen fitting dataset may select warmup inputs")
    verify_base(model_path)
    versions = training_versions()
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "started.json", {"kind": "acephale-reconstructed-warmup-diagnostic-v1",
              "seed": spec["seed"], "specificationHash": spec["contentHash"],
              "leaseId": lease["leaseId"], "instanceId": lease["instanceId"],
              "maximumSeconds": maximum_seconds, "optimizerCreated": False})

    def guard():
        if validate_execution_lease(lease_path, action="diagnostic") != lease:
            raise ValueError("Diagnostic authority changed")
        if time.monotonic() >= deadline:
            raise TimeoutError("Warmup diagnostic deadline expired")

    try:
        import torch
        from datasets import Dataset
        from peft import PeftModel
        from transformers import set_seed
        from trl import SFTConfig, SFTTrainer

        set_seed(spec["seed"])
        saved = torch.load(run / "reload-probe.pt", map_location="cpu", weights_only=True)
        _verify_probe_context(saved, spec)
        guard()
        base, tokenizer = _load_model(model_path)
        require_training_precision(base, spec)
        model = PeftModel.from_pretrained(base, run / "adapter", is_trainable=True, local_files_only=True)
        original = {"frozen": _parameter_hash(model, adapter=False), "adapter": _parameter_hash(model, adapter=True)}
        if original != {"frozen": receipt["frozenAfterHash"], "adapter": receipt["adapterAfterHash"]}:
            raise ValueError("Loaded parameters differ from the original trained checkpoint")
        fitting = [tokenize_example(row, tokenizer, max_length=spec["recipe"]["maxLength"])
                   for row in load_partition(dataset, "weight_fit")]
        config = SFTConfig(output_dir=str(output / "unused-trainer-output"),
            **trainer_options(spec["recipe"]), dataset_kwargs={"skip_prepare_dataset": True},
            seed=spec["seed"], data_seed=spec["seed"], logging_steps=1,
            save_strategy="steps", save_steps=50, save_total_limit=2,
            eval_strategy="no", report_to=[], remove_unused_columns=False, dataloader_num_workers=0)
        trainer = SFTTrainer(model=model, processing_class=tokenizer, args=config,
            data_collator=_collator(tokenizer), train_dataset=Dataset.from_list(fitting))
        require_no_optimizer(trainer)
        batch = next(iter(trainer.get_train_dataloader()))
        require_no_optimizer(trainer)
        write_new(output / "reconstructed-batch.json", {"selection": "reconstructed_first_weight_fit_batch",
            "historicalBatchIdentityProven": False, "historicalSamplerStateAvailable": False,
            "datasetManifestHash": manifest["contentHash"], "seed": spec["seed"],
            "trainingMode": False, "autogradEnabled": False, "versions": versions,
            "tensors": [{"name": name, "shape": list(value.shape), "dtype": str(value.dtype),
                         "sha256": tensor_hash(value)} for name, value in batch.items()]})
        model.eval()
        guard()
        before_warmup = kernel_observation()
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            warm = model(**{name: value.to("cuda") for name, value in batch.items() if name != "labels"},
                         use_cache=False, logits_to_keep=1)
            if not torch.isfinite(warm.logits).all():
                raise ValueError("Warmup produced nonfinite logits")
        del warm
        guard()
        require_no_optimizer(trainer)
        after_warmup = kernel_observation()
        first = _probe_logits(model, saved["input_ids"].to("cuda"))
        guard()
        second = _probe_logits(model, saved["input_ids"].to("cuda"))
        require_no_optimizer(trainer)
        final = {"frozen": _parameter_hash(model, adapter=False), "adapter": _parameter_hash(model, adapter=True)}
        if final != original or file_hash(run / "reload-probe.pt") != receipt["probeHash"]:
            raise ValueError("Warmup diagnostic changed retained parameters or reference")
        torch.save(first, output / "first-logits.pt")
        torch.save(second, output / "repeat-logits.pt")
        result = {"kind": "acephale-reconstructed-warmup-diagnostic-v1", "status": "completed",
            "seed": spec["seed"], "optimizerCreated": False, "weightsUnchanged": True,
            "originalProbeUnchanged": True, "isExportAcceptance": False, "qualified": False,
            "historicalBatchIdentityProven": False, "first": compare(first, saved["logits"]),
            "repeat": compare(second, saved["logits"]), "repeatability": compare(second, first),
            "kernelConfigurationsBefore": before_warmup, "kernelConfigurationsAfterWarmup": after_warmup,
            "kernelConfigurationsAfterProbes": kernel_observation()}
        guard()
        write_new(output / "result.json", result)
        return result
    except BaseException as error:
        write_new(output / "failure.json", {"kind": type(error).__name__, "message": str(error)[:2000],
                  "optimizerCreated": False, "isExportAcceptance": False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("dataset", "model", "run", "output", "lease"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--maximum-seconds", type=int, default=600)
    args = parser.parse_args()
    diagnose_warmup(args.dataset, args.model, args.run, args.output, args.lease,
                    maximum_seconds=args.maximum_seconds)


if __name__ == "__main__":
    main()
