"""GoalSpec infrastructure commands; only the explicit native command launches paid work."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_data import (
    GoalAnnotation,
    audit_gate,
    build_memory,
    build_split,
    export_dataset,
    load_metadata,
    publish_bundle,
    read_jsonl,
    select_pilot,
    validate_annotation,
    verify_bundle,
)
from goalspec.infra_evaluation import TrialDesign, TrialResult, report_trials, score_predictions
from goalspec.storage import file_hash, load_trajectories


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("split", "export", "memory"):
        sub = commands.add_parser(command)
        sub.add_argument("--trajectories", required=True, type=Path)
        sub.add_argument("--metadata", required=True, type=Path)
        sub.add_argument("--output", required=True, type=Path)
        if command == "split":
            sub.add_argument("--seed", type=int, default=42)
        else:
            sub.add_argument("--split", type=Path, required=True)
        if command == "export":
            sub.add_argument("--parquet", action="store_true")
    pilot = commands.add_parser("pilot")
    pilot.add_argument("--dataset", type=Path, required=True)
    pilot.add_argument("--output", type=Path, required=True)
    pilot.add_argument("--count", type=int, default=100)
    pilot.add_argument("--audit-count", type=int, default=20)
    pilot.add_argument("--seed", type=int, default=42)
    pilot.add_argument("--diagnostics", type=Path)
    goals = commands.add_parser("validate-goals")
    goals.add_argument("--dataset", type=Path, required=True)
    goals.add_argument("--annotations", type=Path, required=True)
    goals.add_argument("--output", type=Path, required=True)
    audit = commands.add_parser("audit")
    audit.add_argument("--pilot", type=Path, required=True)
    audit.add_argument("--reviews", type=Path, required=True)
    audit.add_argument("--output", type=Path, required=True)
    report = commands.add_parser("report")
    report.add_argument("--design", type=Path, required=True)
    report.add_argument("--results", type=Path, required=True)
    report.add_argument("--output", type=Path, required=True)
    report.add_argument("--seed", type=int, default=42)
    report.add_argument("--bootstrap-samples", type=int, default=2000)
    predictions = commands.add_parser("score-predictions")
    predictions.add_argument("--rows", type=Path, required=True)
    predictions.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("directory", type=Path)
    historical = commands.add_parser("import-v5")
    historical.add_argument("--export-directory", type=Path, required=True)
    historical.add_argument("--cohort-directory", type=Path, required=True)
    historical.add_argument("--pipeline-directory", type=Path, required=True)
    historical.add_argument("--output", type=Path, required=True)
    historical.add_argument("--no-parquet", action="store_true")
    replay = commands.add_parser("replay-patterns")
    replay.add_argument("--trajectories", type=Path, required=True)
    replay.add_argument("--bundle", type=Path, required=True)
    replay.add_argument("--memory", type=Path)
    replay.add_argument("--output", type=Path, required=True)
    calibration = commands.add_parser("fit-calibration")
    calibration.add_argument("--bundle", type=Path, required=True)
    calibration.add_argument("--predictions", type=Path, required=True)
    calibration.add_argument("--condition", choices=["neutral", "conditional", "both"], default="neutral")
    calibration.add_argument("--output", type=Path, required=True)
    opportunity = commands.add_parser("build-opportunity")
    opportunity.add_argument("--bundle", type=Path, required=True)
    opportunity.add_argument("--measurements", type=Path, required=True)
    opportunity.add_argument("--output", type=Path, required=True)
    reliability = commands.add_parser("build-goal-reliability")
    for field in ("bundle", "predictions", "annotations", "pilot", "reviews", "grades", "output"):
        reliability.add_argument(f"--{field}", type=Path, required=True)
    native = commands.add_parser("native")
    for field in ("config", "tasks", "output", "budget-directory", "upstream-root"):
        native.add_argument(f"--{field}", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "verify":
        result = verify_bundle(args.directory)
    elif args.command == "native":
        from goalspec.infra_native_runner import run_native

        result = run_native(args.config, args.tasks, args.output, args.budget_directory, args.upstream_root)
    elif args.command == "import-v5":
        from goalspec.infra_import_v5 import import_v5

        result = import_v5(args.export_directory, args.cohort_directory, args.pipeline_directory, args.output, parquet=not args.no_parquet)
    elif args.command == "replay-patterns":
        from goalspec.infra_replay import replay_patterns

        report, rows = replay_patterns(args.trajectories, args.bundle, args.memory)
        result = publish_bundle(args.output, {"report.json": report, "predictions.jsonl": rows}, parquet=True)
    elif args.command == "fit-calibration":
        from goalspec.infra_calibration import fit_calibration, fit_paired_calibration

        if args.condition == "both":
            calibration, report, observations = fit_paired_calibration(args.bundle, args.predictions)
        else:
            calibration, report, observations = fit_calibration(args.bundle, args.predictions, condition=args.condition)
        result = publish_bundle(args.output, {"calibration.json": calibration, "report.json": report, "joined-scores.jsonl": observations}, parquet=True)
    elif args.command == "build-opportunity":
        from goalspec.infra_admission import build_opportunity

        artifact, report, observations = build_opportunity(args.bundle, args.measurements)
        result = publish_bundle(args.output, {"opportunity.json": artifact, "report.json": report, "measurements.jsonl": observations}, parquet=True)
    elif args.command == "build-goal-reliability":
        from goalspec.infra_admission import build_goal_reliability

        artifact, report, observations = build_goal_reliability(args.bundle, args.predictions, args.annotations, args.pilot, args.reviews, args.grades)
        result = publish_bundle(args.output, {"goal-reliability.json": artifact, "report.json": report, "graded-goals.jsonl": observations}, parquet=True)
    elif args.command == "export":
        result = export_dataset(args.trajectories, args.metadata, args.split, args.output, parquet=args.parquet)
    elif args.command in {"split", "memory"}:
        trajectories = load_trajectories(args.trajectories)
        metadata = load_metadata(args.metadata)
        if args.command == "split":
            document = build_split(trajectories, metadata, args.seed)
            result = publish_bundle(args.output, {"split.json": document, "lineage.json": {"trajectories_sha256": file_hash(args.trajectories), "metadata_sha256": file_hash(args.metadata)}})
        else:
            document = build_memory(trajectories, metadata, _json(args.split))
            result = publish_bundle(args.output, {"memory.json": document, "lineage.json": {"trajectories_sha256": file_hash(args.trajectories), "metadata_sha256": file_hash(args.metadata), "split_sha256": file_hash(args.split)}})
    elif args.command == "pilot":
        source_manifest = verify_bundle(args.dataset)
        document = select_pilot(read_jsonl(args.dataset / "public.jsonl"), count=args.count, audit_count=args.audit_count, seed=args.seed, diagnostics=_json(args.diagnostics) if args.diagnostics else None)
        document["source_dataset_hash"] = source_manifest["bundle_hash"]
        document["source_split_hash"] = hash_v1(_json(args.dataset / "split.json"))
        result = publish_bundle(args.output, {"pilot.json": {key: value for key, value in document.items() if key != "annotation_inputs"}, "annotation-inputs.jsonl": document["annotation_inputs"]})
    elif args.command == "validate-goals":
        verify_bundle(args.dataset)
        rows = {row["checkpoint_id"]: row for row in read_jsonl(args.dataset / "public.jsonl")}
        annotations = [GoalAnnotation.model_validate(row) for row in read_jsonl(args.annotations)]
        if len({row.checkpoint_id for row in annotations}) != len(annotations):
            raise ValueError("Duplicate annotation")
        validations = [validate_annotation(row, rows[row.checkpoint_id]) for row in annotations]
        result = publish_bundle(args.output, {"annotations.jsonl": [row.model_dump(mode="json") for row in annotations], "validation.jsonl": validations, "lineage.json": {"annotation_sha256": file_hash(args.annotations), "dataset_manifest_sha256": file_hash(args.dataset / "manifest.json")}})
    elif args.command == "audit":
        result = publish_bundle(args.output, {"audit.json": audit_gate(_json(args.pilot), read_jsonl(args.reviews)), "lineage.json": {"pilot_sha256": file_hash(args.pilot), "reviews_sha256": file_hash(args.reviews)}})
    elif args.command == "report":
        design = TrialDesign.model_validate(_json(args.design))
        rows = [TrialResult.model_validate(row) for row in read_jsonl(args.results)]
        result = publish_bundle(args.output, {"report.json": report_trials(design, rows, seed=args.seed, bootstrap_samples=args.bootstrap_samples), "lineage.json": {"design_sha256": file_hash(args.design), "results_sha256": file_hash(args.results)}})
    else:
        result = publish_bundle(args.output, {"prediction-report.json": score_predictions(read_jsonl(args.rows)), "lineage.json": {"rows_sha256": file_hash(args.rows)}})
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
