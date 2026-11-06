"""Read-only migration of the closed v5 Base training archive into infra inputs.

This is historical development material, never a fresh open-weight model score.
The prior family policy and original captured scopes are required, not invented.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from goalspec.adapters.tau import PublicContext, _events
from goalspec.contracts_v1 import hash_v1
from goalspec.infra_data import (
    VERSION,
    EpisodeMeta,
    Scope,
    build_memory,
    export_rows,
    public_context,
    publish_bundle,
    read_jsonl,
    select_pilot,
    verify_split,
)
from goalspec.storage import file_hash, load_trajectories


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def import_v5(export_directory: Path, cohort_directory: Path, pipeline_directory: Path, destination: Path, *, parquet: bool = True) -> dict[str, Any]:
    pipeline_path = pipeline_directory / "pipeline.json"
    pipeline = _json(pipeline_path)
    if pipeline.get("version") != "goalspec-v5-post-closure-training-pipeline-v1" or pipeline.get("contentHash") != hash_v1({key: value for key, value in pipeline.items() if key != "contentHash"}):
        raise ValueError("Invalid historical pipeline receipt")
    for name, expected in pipeline["cohort"]["files"].items():
        if Path(name).name != name or file_hash(cohort_directory / name) != expected:
            raise ValueError("Historical cohort source hash mismatch")
    dataset_path = pipeline_directory / "dataset/dataset.jsonl"
    dataset_manifest = _json(pipeline_directory / "dataset/manifest.json")
    if file_hash(dataset_path) != dataset_manifest["datasetHash"]:
        raise ValueError("Historical frame dataset hash mismatch")
    if dataset_manifest["freshSplits"] != pipeline["freshSplits"]:
        raise ValueError("Historical family partitions disagree")
    bundle = _json(export_directory / "repository-bundle.json")
    export_manifest = _json(export_directory / "export-manifest.json")
    if export_manifest.get("phase") != "train" or export_manifest.get("arm") != "base":
        raise ValueError("Only the closed Base training export is eligible")
    if bundle["dataset"]["contentHash"] != file_hash(cohort_directory / "outcomes.jsonl"):
        raise ValueError("Training export points to another outcome cohort")
    contexts = _json(cohort_directory / "public-contexts.json")
    outcomes = {row["runId"]: row for row in read_jsonl(cohort_directory / "outcomes.jsonl")}
    if len(outcomes) != len(_json(cohort_directory / "design.json")["trials"]):
        raise ValueError("Historical trial cohort is incomplete")
    episodes = {row["id"]: row for row in bundle["episodes"]}
    frame_rows: dict[str, dict[str, Any]] = {}
    for row in read_jsonl(dataset_path):
        if row["runId"] not in outcomes:
            continue
        frame = row["context"]["frame"]
        if hash_v1(frame) != row["frameHash"]:
            raise ValueError("Historical frame changed")
        previous = frame_rows.get(row["runId"])
        if previous and previous["context"]["frame"]["scope"] != frame["scope"]:
            raise ValueError("Historical run has incompatible scopes")
        if previous is None or row["boundary"] < previous["boundary"]:
            frame_rows[row["runId"]] = row
    trajectories = load_trajectories(export_directory / "trajectories.jsonl")
    if {row.trajectory_id for row in trajectories} != set(outcomes) or set(episodes) != set(outcomes):
        raise ValueError("Every historical declared outcome must be retained")
    metadata: dict[str, EpisodeMeta] = {}
    source_hashes = {}
    for trajectory in trajectories:
        key = trajectory.trajectory_id
        if key not in frame_rows:
            raise ValueError("Historical episode lacks an evidenced authorization scope")
        row, episode = outcomes[key], episodes[key]
        if row["arm"] != "base" or episode["split"] != "train":
            raise ValueError("Only historical Base training episodes can be imported")
        raw_path = cohort_directory / f"{key}.json"
        raw_hash = file_hash(raw_path)
        raw = _json(raw_path)
        captured = contexts[key]
        provenance = trajectory.provenance
        if provenance is None or raw_hash != provenance.raw_results_hash or raw_hash != episode["contentHash"] or raw.get("record") != row:
            raise ValueError("Historical episode provenance mismatch")
        if captured.get("capturedBeforeExecution") is not True or hash_v1(captured) != provenance.public_context_hash:
            raise ValueError("Historical public capture was not verified")
        if hash_v1(captured["tools"]) != episode["toolSchemaHash"]:
            raise ValueError("Historical tool schema mismatch")
        if provenance.run_config_hash != file_hash(cohort_directory / "design.json"):
            raise ValueError("Historical actor run configuration changed")
        context = PublicContext(policy=captured["policy"], tools=trajectory.initial_tools, system_messages=(captured["policy"],))
        reconstructed = _events(raw.get("simulation", {}).get("messages", []), context)
        if reconstructed != trajectory.events or trajectory.policy != captured["policy"]:
            raise ValueError("Exported public events differ from original native transcript")
        verdict = raw.get("verdict")
        if trajectory.outcome.success != row["success"] or (row["success"] and (not isinstance(verdict, dict) or verdict.get("success") is not True)):
            raise ValueError("Historical independent verdict mismatch")
        old_scope = frame_rows[key]["context"]["frame"]["scope"]
        if old_scope["toolSchemaHash"] != episode["toolSchemaHash"] or old_scope["environmentVersion"] != trajectory.benchmark_revision:
            raise ValueError("Historical scope schema/environment mismatch")
        context_projection = public_context(trajectory)
        metadata[key] = EpisodeMeta(
            episode_id=key, family_id=trajectory.group_id,
            scope=Scope(tenant_id=old_scope["tenantId"], principal_id=old_scope["principalId"], authorization_revision=old_scope["authorizationVersion"]),
            request_revision=frame_rows[key]["context"]["requestRevisionHash"],
            environment_version=trajectory.benchmark_revision,
            tool_schema_hash=hash_v1(context_projection["tools"]),
            public_context_hash=hash_v1(context_projection), captured_before_execution=True,
            verification_tier="native_verified" if isinstance(verdict, dict) else "source_reported",
            license=bundle["dataset"]["license"], source_revision=bundle["dataset"]["revision"],
        )
        source_hashes[key] = {"raw_sha256": raw_hash, "original_public_capture_hash": provenance.public_context_hash, "original_tool_schema_hash": old_scope["toolSchemaHash"], "scope_frame_hash": frame_rows[key]["frameHash"]}
    families = {row.group_id for row in trajectories}
    historical_roles = {family: pipeline["freshSplits"][family] for family in sorted(families)}
    allowed = set(pipeline["allowedMemoryFamilies"])
    excluded = set(pipeline["excludedMemoryFamilies"])
    if allowed & excluded:
        raise ValueError("Conflicting historical family policies")
    assignments = {}
    for family, role in historical_roles.items():
        if role == "train" and family in allowed and family not in excluded:
            assignments[family] = "train"
        elif role in {"selection", "calibration"} and family in excluded:
            assignments[family] = "development"
        else:
            raise ValueError("Historical family lacks an unambiguous allowed/excluded role")
    split = {
        "schema_version": VERSION, "seed": None,
        "method": "preserved-historical-v5-family-policy",
        "families": assignments, "historical_family_roles": historical_roles,
        "episodes": {row.trajectory_id: row.group_id for row in trajectories},
        "metadata_hash": hash_v1([metadata[key].model_dump(mode="json") for key in sorted(metadata)]),
        "fresh_heldout": False,
    }
    verify_split(split, trajectories, metadata)
    public, labels, verdicts = export_rows(trajectories, metadata, split)
    memory = build_memory(trajectories, metadata, split)
    pilot = select_pilot(public)
    lineage = {
        "label": "Historical GPT-5.4 Base training traces, development material only",
        "fresh_qwen_traces": False, "fresh_heldout": False, "teacher_annotations_completed": 0,
        "human_audits_completed": 0, "actor_models": sorted({row.provenance.actor_model for row in trajectories}),
        "episodes": len(trajectories), "checkpoints": len(public), "training_checkpoints": sum(row["split"] == "train" for row in public),
        "pilot_checkpoints": 100, "human_audits_pending": 20,
        "metadata_projection": "Original captured authorization scope; normalized public tool schema hash recorded separately",
        "pipeline_sha256": file_hash(pipeline_path), "prior_dataset_sha256": file_hash(dataset_path),
        "export_trajectories_sha256": file_hash(export_directory / "trajectories.jsonl"),
        "repository_bundle_sha256": file_hash(export_directory / "repository-bundle.json"),
        "historical_sources": source_hashes,
    }
    files = {
        "public.jsonl": public, "labels.jsonl": labels, "verdicts.jsonl": verdicts,
        "metadata.jsonl": [metadata[key].model_dump(mode="json") for key in sorted(metadata)],
        "split.json": split, "memory.json": memory,
        "pilot.json": {key: value for key, value in pilot.items() if key != "annotation_inputs"},
        "annotation-inputs.jsonl": pilot["annotation_inputs"], "lineage.json": lineage,
    }
    return publish_bundle(destination, files, parquet=parquet)
