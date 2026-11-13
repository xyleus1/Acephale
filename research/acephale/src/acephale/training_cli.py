"""Prepare immutable data and explicitly run bounded predictor fine-tuning."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from acephale.infra_data import read_jsonl
from acephale.training_data import prepare_dataset, verify_dataset, verify_review


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--rows", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    for name in ("review-pilot", "reviews", "annotations"):
        prepare.add_argument(f"--{name}", type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("directory", type=Path)
    verify_export_parser = commands.add_parser("verify-export", help="Verify trained weights and their complete immutable artifact chain without loading a model")
    verify_export_parser.add_argument("directory", type=Path)
    train = commands.add_parser("train")
    for name in ("dataset", "model", "output", "lease"):
        train.add_argument(f"--{name}", type=Path, required=True)
    train.add_argument("--seed", type=int, choices=[17, 29], required=True)
    train.add_argument("--max-steps", type=int, default=500)
    train.add_argument("--maximum-seconds", type=int, default=3600)
    train.add_argument("--micro-batch", type=int, choices=[1, 2, 4], default=1)
    train.add_argument("--gradient-accumulation", type=int, choices=[4, 8, 16], default=16)
    smoke = commands.add_parser("smoke", help="One actual optimizer step plus explicit export verification on prepared real examples")
    for name in ("dataset", "model", "output", "lease"):
        smoke.add_argument(f"--{name}", type=Path, required=True)
    smoke.add_argument("--artifact-mode", choices=["merged", "unmerged_lora"], default="merged")
    profile = commands.add_parser("profile", help="Measure fit-only batch capacity before either main seed")
    for name in ("dataset", "model", "output", "lease"):
        profile.add_argument(f"--{name}", type=Path, required=True)
    profile.add_argument("--maximum-seconds", type=int, default=600)
    export = commands.add_parser("export")
    for name in ("dataset", "model", "run", "output", "lease"):
        export.add_argument(f"--{name}", type=Path, required=True)
    export.add_argument("--artifact-mode", choices=["merged", "unmerged_lora"], default="merged")
    evaluate = commands.add_parser("evaluate")
    for name in ("dataset", "model", "output", "lease"):
        evaluate.add_argument(f"--{name}", type=Path, required=True)
    evaluate.add_argument("--predictor-export", type=Path, help="Verified unmerged adapter export; --model remains its exact base snapshot")
    evaluate.add_argument("--partition", choices=["calibration", "development", "test"], default="development")
    args = parser.parse_args(argv)
    if args.command == "prepare":
        supplied = [args.review_pilot, args.reviews, args.annotations]
        if any(supplied) and not all(supplied):
            parser.error("Review requires --review-pilot, --reviews and --annotations together")
        review = verify_review(json.loads(args.review_pilot.read_text(encoding="utf-8")),
                               read_jsonl(args.reviews), read_jsonl(args.annotations)) if all(supplied) else None
        result = prepare_dataset(read_jsonl(args.rows), args.output, review=review)
    elif args.command == "verify":
        result = verify_dataset(args.directory)
    elif args.command == "verify-export":
        from acephale.training import verify_export

        result = verify_export(args.directory)
    elif args.command == "train":
        from acephale.training import train

        batch_options = {} if (args.micro_batch, args.gradient_accumulation) == (1, 16) else {
            "micro_batch": args.micro_batch, "gradient_accumulation": args.gradient_accumulation}
        result = train(args.dataset, args.model, args.output, args.lease, seed=args.seed,
                       max_steps=args.max_steps, maximum_seconds=args.maximum_seconds, **batch_options)
    elif args.command == "profile":
        from acephale.training_profile import profile

        result = profile(args.dataset, args.model, args.output, args.lease, maximum_seconds=args.maximum_seconds)
    elif args.command == "export":
        from acephale.training import export_model

        if args.artifact_mode == "unmerged_lora":
            from acephale.training_lora import export_unmerged

            result = export_unmerged(args.dataset, args.model, args.run, args.output, args.lease)
        else:
            result = export_model(args.dataset, args.model, args.run, args.output, args.lease)
    elif args.command == "smoke":
        import gc

        from acephale.training import export_model, train
        from acephale.training_data import write_new

        args.output.mkdir(parents=True, exist_ok=False)
        receipt = train(args.dataset, args.model, args.output / "training", args.lease,
                        seed=17, max_steps=1, maximum_seconds=900, smoke=True)
        gc.collect()
        import torch

        torch.cuda.empty_cache()
        exporter = export_model
        if args.artifact_mode == "unmerged_lora":
            from acephale.training_lora import export_unmerged

            exporter = export_unmerged
        artifact = exporter(args.dataset, args.model, args.output / "training", args.output / "export", args.lease)
        result = {"kind": "acephale-real-model-training-smoke", "receiptHash": receipt["contentHash"],
                  "predictorHash": artifact["contentHash"], "nativeTaskAccuracyMeasured": False,
                  "limitation": "One optimizer step proves machinery, not predictive performance"}
        if args.artifact_mode == "unmerged_lora":
            result.update(artifactMode="unmerged_lora", vllmQualificationRequired=True, vllmQualificationPassed=False)
        write_new(args.output / "smoke.json", result)
    else:
        from acephale.training import evaluate

        options = {"predictor_export": args.predictor_export} if args.predictor_export else {}
        result = evaluate(args.dataset, args.model, args.output, args.lease, partition=args.partition, **options)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
