"""Build admission artifacts from retained measurements and independently graded goals.

These commands consume evidence. They do not invent timing defaults, perform
semantic grading, or treat source-valid annotations as human-approved labels.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import (
    GoalAnnotation,
    audit_gate,
    read_jsonl,
    validate_annotation,
    verify_bundle,
)
from acephale.storage import file_hash

COMPONENTS = ("actorLeadMs", "contentionMs", "predictionMs", "schedulingMs", "toolMs", "validationMs")
OPPORTUNITY_PROFILE_KEYS = ("hardwareHash", "servingHash", "modelHash", "memoryHash", "compilerHash", "retrievalHash", "promptHash", "protocolHash")


def validate_opportunity_profile(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != set(OPPORTUNITY_PROFILE_KEYS) or any(
        not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) for digest in value.values()
    ):
        raise ValueError("Opportunity requires the complete measured deployment and predictor profile")
    return dict(value)


def validate_predicted_goals(goals: dict[str, Any], prefix: dict[str, Any]) -> None:
    schema = _json(Path(__file__).resolve().parents[4] / "src/lib/acephale/contracts/v1.schema.json")
    Draft202012Validator({"$ref": "#/$defs/GoalSet", "$defs": schema["$defs"]}).validate(goals)
    if not math.isclose(sum(goal["probability"] for goal in goals["hypotheses"]) + goals["unknown"], 1, abs_tol=1e-6):
        raise ValueError("Invalid predicted goal probability distribution")
    sources = {source["id"]: source["value"] for source in prefix["input"]["sources"]}
    for event in prefix["input"].get("events", []):
        if event.get("kind") == "message" and event.get("role") == "user":
            sources[f"requirement:{event['seq']}"] = event["content"]
    for goal in goals["hypotheses"]:
        references = [*goal["sources"], *(ref for constraint in goal["constraints"] for ref in constraint["sources"])]
        for ref in references:
            try:
                value = sources[ref["sourceId"]]
                for part in ref["path"]:
                    if isinstance(value, list) and type(part) is not int:
                        raise ValueError("Array source paths require integer indexes")
                    value = value[part]
            except (KeyError, IndexError, TypeError) as error:
                raise ValueError("Predicted goal refers to evidence outside the public checkpoint") from error


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _hashed(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("contentHash") != hash_v1({key: item for key, item in value.items() if key != "contentHash"}):
        raise ValueError("Evidence document content hash mismatch")
    return value


def _dataset(directory: Path) -> tuple[str, dict[str, dict[str, Any]]]:
    manifest = verify_bundle(directory)
    rows = read_jsonl(directory / "public.jsonl")
    public = {row["checkpoint_id"]: row for row in rows}
    if not rows or len(public) != len(rows):
        raise ValueError("Unique public checkpoints required")
    partitions: dict[str, str] = {}
    for row in rows:
        if row["input_hash"] != hash_v1(row["input"]) or row["split"] not in {"train", "development", "test"}:
            raise ValueError("Invalid public checkpoint input identity or partition")
        if partitions.setdefault(row["family_id"], row["split"]) != row["split"]:
            raise ValueError("A family crosses dataset partitions")
    return manifest["bundle_hash"], public


def _prefix(row: dict[str, Any], public: dict[str, dict[str, Any]]) -> dict[str, Any]:
    prefix = public.get(row.get("checkpoint_id"))
    if prefix is None or any(row.get(field) != prefix[field] for field in ("input_hash", "family_id", "split")):
        raise ValueError("Evidence checkpoint identity mismatch")
    if prefix["split"] == "test":
        raise ValueError("Held-out test evidence cannot set admission parameters")
    return prefix


def _closed_rows(document: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    ids = [row["checkpoint_id"] for row in rows]
    if ids != document.get("rowIds") or not ids or len(set(ids)) != len(ids):
        raise ValueError("Every declared evidence row must be retained exactly once in order")


def _quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def measured_duration(span: dict[str, Any], *, comparison: bool = False) -> float:
    if comparison and span.get("method") == "paired_difference":
        if set(span) != {"method", "baseline", "concurrent"}:
            raise ValueError("Contention comparison requires two observed intervals")
        baseline, concurrent = span["baseline"], span["concurrent"]
        if baseline.get("clockId") != concurrent.get("clockId"):
            raise ValueError("Contention comparison must use one monotonic clock")
        excess = measured_duration(concurrent) - measured_duration(baseline)
        if excess < 0:
            raise ValueError("Negative paired excess is unresolved, not a fabricated zero contention cost")
        return excess
    if set(span) != {"clockId", "startMs", "endMs"} or not isinstance(span["clockId"], str) or not span["clockId"]:
        raise ValueError("Each timing interval needs a monotonic clock identity")
    if any(type(span[key]) not in {int, float} or not math.isfinite(span[key]) or span[key] < 0 for key in ("startMs", "endMs")) or span["endMs"] < span["startMs"]:
        raise ValueError("Invalid measured timing interval")
    return span["endMs"] - span["startMs"]


def build_opportunity(bundle_directory: Path, measurements_path: Path) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Use lower benefits and upper costs from a closed measured cohort.

Each component is an observed interval on one monotonic clock. `actorLeadMs`
is the baseline interval from the public checkpoint to the returned actor
decision, when its tool request becomes available. `contentionMs` may be an
explicit paired difference of observed concurrent and baseline actor durations.
The difference is a noisy profiling estimate, not a causal attribution claim.
A measured zero is explicit, not an omitted field. Retain raw evidence locally.
"""
    dataset_hash, public = _dataset(bundle_directory)
    input_sha = file_hash(measurements_path)
    document = _hashed(_json(measurements_path))
    if document.get("version") != 2 or document.get("kind") != "measured_infra_opportunity" or document.get("sourceDatasetHash") != dataset_hash:
        raise ValueError("A measured opportunity cohort for this dataset is required")
    if not isinstance(document.get("protocol"), str) or not document["protocol"].strip():
        raise ValueError("Measurement protocol must define the recorded intervals")
    profile = validate_opportunity_profile(document.get("profile"))
    if profile["protocolHash"] != hash_v1(document["protocol"]):
        raise ValueError("Opportunity protocol identity differs from its recorded interval definition")
    rows = document.get("rows", [])
    _closed_rows(document, rows)
    observations, failures, raw_hashes = [], [], {}
    for row in rows:
        _prefix(row, public)
        if row.get("status") == "failed":
            if not row.get("errorType"):
                raise ValueError("Failed measurements need an attributed error type")
            failures.append(row["checkpoint_id"])
            continue
        if row.get("status") != "completed" or set(row.get("spans", {})) != set(COMPONENTS):
            raise ValueError("Every completed measurement requires all six observed intervals")
        evidence = row.get("evidence", {})
        relative = Path(evidence.get("path", ""))
        base = measurements_path.parent.resolve()
        source = (base / relative).resolve()
        if not evidence.get("path") or relative.is_absolute() or not source.is_relative_to(base) or not source.is_file() or file_hash(source) != evidence.get("sha256"):
            raise ValueError("Measurement raw evidence file is absent, outside the cohort or changed")
        raw = _json(source)
        raw_hashes[source] = evidence["sha256"]
        if raw.get("kind") != "observed_infra_timing" or raw.get("checkpoint_id") != row["checkpoint_id"] or raw.get("spans") != row["spans"]:
            raise ValueError("Measurement intervals differ from retained raw timing evidence")
        if raw.get("profileHash") != hash_v1(profile) or row.get("profileHash") != hash_v1(profile):
            raise ValueError("Measurement profile differs from retained raw timing evidence")
        durations = {}
        for name in COMPONENTS:
            durations[name] = measured_duration(row["spans"][name], comparison=name == "contentionMs")
        observations.append({"checkpoint_id": row["checkpoint_id"], "family_id": row["family_id"], "split": row["split"], **durations})
    if len(observations) < 10:
        raise ValueError("At least ten complete measured checkpoints are required")
    estimate = {name: _quantile([row[name] for row in observations], .1 if name in {"toolMs", "actorLeadMs"} else .9) for name in COMPONENTS}
    body = {"version": 2, "profile": profile, "sourceDatasetHash": dataset_hash, "families": sorted({row["family_id"] for row in observations}),
            "sampleCount": len(observations), "estimate": estimate,
            "provenance": {"measurementHash": document["contentHash"], "measurementFileHash": input_sha,
                           "method": "nearest_rank_lower_benefits_p10_upper_costs_p90", "protocol": document["protocol"],
                           "declaredCount": len(rows), "failedCheckpointIds": failures}}
    if file_hash(measurements_path) != input_sha or any(file_hash(path) != digest for path, digest in raw_hashes.items()):
        raise ValueError("Measurement cohort changed during aggregation")
    artifact = {**body, "contentHash": hash_v1(body)}
    report = {"opportunityHash": artifact["contentHash"], "declaredCount": len(rows), "completedCount": len(observations),
              "failedCheckpointIds": failures, "heldoutClaim": False,
              "limitations": ["Recorded intervals require a live profiler; this command cannot authenticate how evidence was collected",
                              "Marginal quantiles are a conservative admission heuristic, not a confidence bound or a live speedup result"]}
    return artifact, report, observations


def wilson_lower(agreed: int, count: int) -> float:
    if type(count) is not int or count < 1 or type(agreed) is not int or not 0 <= agreed <= count:
        raise ValueError("Invalid goal agreement counts")
    z, p = 1.959963984540054, agreed / count
    return (p + z * z / (2 * count) - z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count))) / (1 + z * z / count)


def build_goal_reliability(bundle_directory: Path, prediction_directory: Path, annotations_path: Path,
                           pilot_path: Path, reviews_path: Path, grades_path: Path) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Grade every declared training replay row and enforce the annotation audit."""
    dataset_hash, public = _dataset(bundle_directory)
    paths = [prediction_directory / name for name in ("manifest.json", "predictions.jsonl", "receipt.json")]
    paths.extend([annotations_path, pilot_path, reviews_path, grades_path])
    hashes = {str(path): file_hash(path) for path in paths}
    manifest = _hashed(_json(paths[0]))
    if manifest.get("kind") != "uncalibrated_prediction_replay" or manifest.get("executionAllowed") is not False or manifest.get("inferGoals") is not True or manifest.get("sourceDatasetHash") != dataset_hash:
        raise ValueError("Actually executed goal replay for this dataset is required")
    model = manifest.get("model", {})
    if not model.get("repository") or not re.fullmatch(r"[0-9a-f]{40}", model.get("revision", "")) or any(not re.fullmatch(r"[0-9a-f]{64}", manifest.get(field, "")) for field in ("memoryHash", "predictorContractHash", "candidateCompilerHash", "retrievalHash")):
        raise ValueError("Frozen model, prompt, compiler and memory identities required")
    predictions = read_jsonl(paths[1])
    _closed_rows(manifest, predictions)
    receipt = _json(paths[2])
    completed = sum(row.get("status") == "completed" for row in predictions)
    if receipt != {"declared": len(predictions), "completed": completed, "failed": len(predictions) - completed, "liveActorExecuted": False, "toolExecutionPerformed": False}:
        raise ValueError("Goal replay receipt does not close the declared cohort")
    for row in predictions:
        _prefix(row, public)
        if row.get("status") not in {"completed", "failed", "not_dispatched"}:
            raise ValueError("Unknown goal prediction status")
        if row["status"] == "completed" and not isinstance(row.get("goals"), dict):
            raise ValueError("Completed goal predictions must retain the actual GoalSet")
        if row["status"] == "completed":
            validate_predicted_goals(row["goals"], public[row["checkpoint_id"]])
    annotations = read_jsonl(annotations_path)
    annotation_map = {row["checkpoint_id"]: row for row in annotations}
    if len(annotation_map) != len(annotations):
        raise ValueError("Duplicate teacher annotation")
    for row in annotations:
        prefix = public.get(row["checkpoint_id"])
        if prefix is None or prefix["split"] != "train":
            raise ValueError("Reliability annotations must come from training families")
        validate_annotation(GoalAnnotation.model_validate(row), prefix)
    pilot = _json(pilot_path)
    if pilot.get("source_dataset_hash") != dataset_hash:
        raise ValueError("Human audit pilot dataset differs")
    checkpoints = pilot.get("checkpoints", [])
    if not checkpoints or len({row["checkpoint_id"] for row in checkpoints}) != len(checkpoints):
        raise ValueError("Unique pilot checkpoints required")
    for row in checkpoints:
        annotation = annotation_map.get(row["checkpoint_id"])
        if annotation is None or row.get("input_hash") != annotation["input_hash"]:
            raise ValueError("Every pilot checkpoint needs its exact annotation")
    if not {row["checkpoint_id"] for row in pilot.get("audit", [])} <= {row["checkpoint_id"] for row in checkpoints}:
        raise ValueError("Human audit selected outside the pilot")
    if len({row["checkpoint_id"] for row in pilot.get("audit", [])}) != len(pilot.get("audit", [])):
        raise ValueError("Human audit cannot select a checkpoint more than once")
    reviews = read_jsonl(reviews_path)
    for review in reviews:
        annotation = annotation_map.get(review["checkpoint_id"])
        if annotation is None or review.get("annotationHash") != hash_v1(annotation):
            raise ValueError("Human review must bind the exact teacher annotation hash")
    if len(reviews) < 20:
        raise ValueError("At least twenty human annotation reviews are required")
    audit = audit_gate(pilot, reviews)
    if not audit["goal_conditioning_allowed"]:
        raise ValueError("Human audit gate failed; goal-conditioned execution remains disabled")
    training = [row for row in predictions if row["split"] == "train"]
    grades = read_jsonl(grades_path)
    grade_map = {row["checkpoint_id"]: row for row in grades}
    if not training or len(grade_map) != len(grades) or set(grade_map) != {row["checkpoint_id"] for row in training}:
        raise ValueError("Independent grades must cover every declared training prediction exactly once")
    joined = []
    for row in training:
        key, grade = row["checkpoint_id"], grade_map[row["checkpoint_id"]]
        annotation = annotation_map.get(key)
        goal_hash = hash_v1(row["goals"]) if row["status"] == "completed" else None
        if annotation is None or grade.get("annotationHash") != hash_v1(annotation) or grade.get("predictionGoalHash") != goal_hash or grade.get("input_hash") != row["input_hash"]:
            raise ValueError("Goal grade is not bound to the exact prediction and teacher annotation")
        if type(grade.get("agreed")) is not bool or not grade.get("reviewer") or not grade.get("rubric_version") or grade.get("grading_kind") not in {"human", "independent_model"} or grade["reviewer"] == model["repository"]:
            raise ValueError("Attributed independent semantic grading is required")
        if row["status"] != "completed" and grade["agreed"]:
            raise ValueError("A failed goal prediction cannot count as agreement")
        joined.append({"checkpoint_id": key, "family_id": row["family_id"], "predictionGoalHash": goal_hash,
                       "annotationHash": grade["annotationHash"], "agreed": grade["agreed"], "status": row["status"],
                       "eligible_for_reliability": row["status"] != "completed" or bool(row["goals"]["hypotheses"])})
    eligible = [row for row in joined if row["eligible_for_reliability"]]
    if not eligible:
        raise ValueError("Nonempty predicted goals are required to estimate conditional reliability")
    agreed = sum(row["agreed"] for row in eligible)
    body = {"version": 1, "sourceDatasetHash": dataset_hash, "families": sorted({row["family_id"] for row in joined}),
            "annotationHash": hash_v1(annotations), "auditedCount": audit["audited"], "acceptedCount": audit["acceptable"],
            "unsupportedBindings": audit["unsupported_bindings"], "gradedCount": len(eligible), "agreedCount": agreed,
            "reliability": wilson_lower(agreed, len(eligible)),
            "provenance": {"model": model, "memoryHash": manifest["memoryHash"], "predictorContractHash": manifest["predictorContractHash"],
                           "candidateCompilerHash": manifest["candidateCompilerHash"], "retrievalHash": manifest["retrievalHash"], "predictionManifestHash": manifest["contentHash"],
                           "predictionRowsHash": hashes[str(paths[1])], "pilotHash": file_hash(pilot_path), "reviewsHash": file_hash(reviews_path),
                           "gradesHash": file_hash(grades_path), "method": "training_replay_full_cohort_wilson_lower_95"}}
    if any(file_hash(path) != hashes[str(path)] for path in paths):
        raise ValueError("Goal evidence changed during aggregation")
    artifact = {**body, "contentHash": hash_v1(body)}
    report = {"goalReliabilityHash": artifact["contentHash"], "audit": audit, "gradedCount": len(eligible), "agreedCount": agreed,
              "unknownOnlyCheckpoints": [row["checkpoint_id"] for row in joined if not row["eligible_for_reliability"]],
              "excludedDevelopmentCheckpoints": [row["checkpoint_id"] for row in predictions if row["split"] == "development"],
              "heldoutClaim": False, "limitations": ["Agreement with audited teacher labels is not calibrated task success",
                  "The Wilson interval treats checkpoints as independent; within-family dependence can make it optimistic"]}
    return artifact, report, joined
