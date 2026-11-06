"""Fit exact-read calibration on training families, validate on development only."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_admission import validate_predicted_goals
from goalspec.infra_data import read_jsonl, verify_bundle
from goalspec.storage import file_hash

BOUNDS = tuple(index / 10 for index in range(1, 11))


def fit_paired_calibration(bundle_directory: Path, prediction_directory: Path) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Keep the two independently fitted maps under one experiment artifact hash."""
    neutral, neutral_report, neutral_rows = fit_calibration(bundle_directory, prediction_directory)
    conditional, conditional_report, conditional_rows = fit_calibration(bundle_directory, prediction_directory, condition="conditional")
    for field in ("fittingFamilies", "validationFamilies", "sourceDatasetHash"):
        if neutral[field] != conditional[field]:
            raise ValueError("Paired calibration needs the same fitting and validation families")
    for field in ("model", "memoryHash", "predictorContractHash", "candidateCompilerHash", "predictionManifestHash", "predictionRowsHash"):
        if neutral["provenance"][field] != conditional["provenance"][field]:
            raise ValueError("Replay changed between calibration conditions")
    body = {key: value for key, value in neutral.items() if key != "contentHash"}
    body["conditionalCalibration"] = conditional
    artifact = {**body, "contentHash": hash_v1(body)}
    report = {"version": "goalspec-infra-paired-calibration-report-v1", "calibrationHash": artifact["contentHash"],
              "neutral": neutral_report, "conditional": conditional_report, "heldoutClaim": False}
    rows = [{**row, "condition": condition} for condition, records in (("neutral", neutral_rows), ("conditional", conditional_rows)) for row in records]
    return artifact, report, rows


def _digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _metrics(samples: list[dict[str, Any]], probability_field: str) -> dict[str, Any]:
    if not samples:
        return {"samples": 0, "brier": None, "binary_log_loss": None}
    probabilities = [row[probability_field] for row in samples]
    labels = [row["exact_match"] for row in samples]
    return {
        "samples": len(samples), "positives": sum(labels),
        "brier": sum((probability - label) ** 2 for probability, label in zip(probabilities, labels, strict=True)) / len(samples),
        "binary_log_loss": -sum(math.log(max(1e-12, min(1 - 1e-12, probability if label else 1 - probability))) for probability, label in zip(probabilities, labels, strict=True)) / len(samples),
    }


def fit_calibration(bundle_directory: Path, prediction_directory: Path, *, condition: Literal["neutral", "conditional"] = "neutral") -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    if condition not in {"neutral", "conditional"}:
        raise ValueError("Unknown calibration condition")
    bundle = verify_bundle(bundle_directory)
    manifest_path = prediction_directory / "manifest.json"
    prediction_path = prediction_directory / "predictions.jsonl"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_hash = manifest.get("contentHash")
    if manifest_hash != hash_v1({key: value for key, value in manifest.items() if key != "contentHash"}):
        raise ValueError("Prediction manifest hash mismatch")
    if manifest.get("kind") != "uncalibrated_prediction_replay" or manifest.get("executionAllowed") is not False or manifest.get("sourceDatasetHash") != bundle["bundle_hash"]:
        raise ValueError("Wrong prediction source dataset or experiment kind")
    model = manifest.get("model", {})
    if not isinstance(model, dict) or not isinstance(model.get("repository"), str) or not re.fullmatch(r"[0-9a-f]{40}", model.get("revision", "")):
        raise ValueError("Exact predictor model revision required")
    if any(not _digest(manifest.get(field)) for field in ("memoryHash", "predictorContractHash", "candidateCompilerHash")):
        raise ValueError("Frozen predictor prompt, candidate compiler and memory hashes required")
    if condition == "conditional" and manifest.get("inferGoals") is not True:
        raise ValueError("Conditional calibration requires actually executed goal predictions")
    public_rows = read_jsonl(bundle_directory / "public.jsonl")
    public = {row["checkpoint_id"]: row for row in public_rows}
    labels_list = read_jsonl(bundle_directory / "labels.jsonl")
    labels = {row["checkpoint_id"]: row for row in labels_list}
    if len(public) != len(public_rows) or len(labels) != len(labels_list) or set(public) != set(labels):
        raise ValueError("Dataset needs unique matching public prefixes and labels")
    predictions_hash = file_hash(prediction_path)
    predictions = read_jsonl(prediction_path)
    if [row["checkpoint_id"] for row in predictions] != manifest.get("rowIds") or len({row["checkpoint_id"] for row in predictions}) != len(predictions):
        raise ValueError("Every declared prediction row must be retained exactly once in order")
    receipt = json.loads((prediction_directory / "receipt.json").read_text(encoding="utf-8"))
    completed = sum(row.get("status") == "completed" for row in predictions)
    if receipt.get("declared") != len(predictions) or receipt.get("completed") != completed or receipt.get("failed") != len(predictions) - completed or receipt.get("liveActorExecuted") is not False or receipt.get("toolExecutionPerformed") is not False:
        raise ValueError("Prediction cohort is not closed or receipt differs")
    family_partitions: dict[str, set[str]] = defaultdict(set)
    joined = []
    failures, not_dispatched, empty, unknown_goals, unobserved_actions = [], [], [], [], []
    for row in predictions:
        key = row["checkpoint_id"]
        if key not in public:
            raise ValueError("Prediction has an unknown public prefix")
        prefix, label = public[key], labels[key]
        if prefix["input_hash"] != hash_v1(prefix["input"]) or row.get("input_hash") != prefix["input_hash"] or label["input_hash"] != prefix["input_hash"]:
            raise ValueError("Prediction/label public input hash mismatch")
        if row.get("family_id") != prefix["family_id"] or row.get("split") != prefix["split"] or prefix["split"] not in {"train", "development"}:
            raise ValueError("Family mismatch or held-out contamination")
        family_partitions[prefix["family_id"]].add(prefix["split"])
        if label.get("status") == "no_returned_actor_response":
            unobserved_actions.append(key)
            continue
        if row.get("status") in {"failed", "not_dispatched"}:
            failures.append(key)
            if row["status"] == "not_dispatched":
                not_dispatched.append(key)
            continue
        if row.get("status") != "completed":
            raise ValueError("Unknown prediction status")
        if condition == "conditional":
            validate_predicted_goals(row.get("goals", {}), prefix)
            if not row["goals"]["hypotheses"]:
                unknown_goals.append(key)
                continue
        raw = row.get(condition)
        if not isinstance(raw, dict) or raw.get("action") not in {"READ", "NO_READ", "READ_UNCOVERED"} or not isinstance(raw.get("scores"), list) or len(raw["scores"]) > 3:
            raise ValueError("Missing or invalid raw predictor output")
        candidates_list = row.get("candidates", [])
        candidates = {candidate["id"]: candidate for candidate in candidates_list}
        if len(candidates) != len(candidates_list) or len(candidates) > 128:
            raise ValueError("Invalid candidate universe")
        expected_scope = {"tenantId": prefix["scope"]["tenant_id"], "principalId": prefix["scope"]["principal_id"], "authorizationVersion": prefix["scope"]["authorization_revision"], "environmentVersion": prefix["environment_version"], "toolSchemaHash": prefix.get("runtime_tool_schema_hash", prefix["tool_schema_hash"])}
        tools = {tool["name"]: tool for tool in prefix["input"]["tools"]}
        invocation_ids = set()
        for candidate in candidates_list:
            invocation = candidate["invocation"]
            tool = tools.get(invocation.get("tool"))
            if invocation.get("scope") != expected_scope or not isinstance(invocation.get("arguments"), dict) or tool is None or tool.get("side_effects") != "read_only" or tool.get("cacheable") is not True:
                raise ValueError("Candidate scope or eligible read contract differs")
            Draft202012Validator(tool["parameters"]).validate(invocation["arguments"])
            identity = hash_v1({"tool": invocation["tool"], "arguments": invocation["arguments"]})
            if identity in invocation_ids:
                raise ValueError("Duplicate exact invocation in candidate pool")
            invocation_ids.add(identity)
        scores = raw["scores"]
        if len({score["candidateId"] for score in scores}) != len(scores):
            raise ValueError("Duplicate predicted candidate")
        if any(type(score.get("probability")) not in {int, float} or not math.isfinite(score["probability"]) or not 0 <= score["probability"] <= 1 or score["candidateId"] not in candidates for score in scores) or sum(score["probability"] for score in scores) > 1 + 1e-9:
            raise ValueError("Invalid raw candidate probabilities")
        if not scores:
            empty.append(key)
        actual = {hash_v1({"tool": invocation["tool"], "arguments": invocation["arguments"]}) for invocation in label["eligible_reads"]}
        for score in scores:
            invocation = candidates[score["candidateId"]]["invocation"]
            identity = hash_v1({"tool": invocation["tool"], "arguments": invocation["arguments"]})
            joined.append({"checkpoint_id": key, "input_hash": prefix["input_hash"], "family_id": prefix["family_id"], "split": prefix["split"], "candidate_id": score["candidateId"], "invocation_hash": identity, "raw_probability": score["probability"], "exact_match": int(identity in actual), "action": raw["action"]})
    if any(len(partitions) != 1 for partitions in family_partitions.values()):
        raise ValueError("A family crosses fitting and validation partitions")
    fitting = [row for row in joined if row["split"] == "train"]
    validation = [row for row in joined if row["split"] == "development"]
    if not fitting or not validation:
        raise ValueError("Observed raw candidate scores required in both training and development families")
    counts = [{"count": 0, "successes": 0} for _ in BOUNDS]
    for row in fitting:
        index = next(index for index, upper in enumerate(BOUNDS) if row["raw_probability"] <= upper)
        counts[index]["count"] += 1
        counts[index]["successes"] += row["exact_match"]
    bins = [{"upper": BOUNDS[index], "probability": (value["successes"] + 1) / (value["count"] + 2), "count": value["count"]} for index, value in enumerate(counts) if value["count"]]
    # Empty intervals merge forward; the last occupied interval also covers the
    # empty tail. Validation labels never decide boundaries or probabilities.
    bins[-1]["upper"] = 1
    for row in joined:
        row["calibrated_probability"] = next(value["probability"] for value in bins if row["raw_probability"] <= value["upper"])
    checkpoint_scores: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in joined:
        checkpoint_scores[row["checkpoint_id"]].append(row)
    for scores in checkpoint_scores.values():
        denominator = max(1, sum(row["calibrated_probability"] for row in scores))
        for row in scores:
            row["runtime_probability"] = row["calibrated_probability"] / denominator
    body = {
        "version": 1, "fittingFamilies": sorted({row["family_id"] for row in fitting}),
        "validationFamilies": sorted({row["family_id"] for row in validation}),
        "sourceDatasetHash": bundle["bundle_hash"], "bins": bins,
        "provenance": {
            "model": model, "memoryHash": manifest["memoryHash"], "condition": condition,
            "predictorContractHash": manifest["predictorContractHash"], "candidateCompilerHash": manifest["candidateCompilerHash"],
            "predictionManifestHash": manifest_hash, "predictionRowsHash": predictions_hash,
            "method": "fixed_deciles_empty_forward_merge_laplace_1_1",
        },
    }
    calibration = {**body, "contentHash": hash_v1(body)}
    report = {
        "version": "goalspec-infra-calibration-report-v1", "condition": condition,
        "calibrationHash": calibration["contentHash"], "declaredCheckpoints": len(predictions),
        "failedCheckpoints": failures, "notDispatchedCheckpoints": not_dispatched, "completedWithoutCandidateScores": empty,
        "unknownOnlyGoalsExcluded": unknown_goals,
        "unobservedActorActionsExcluded": unobserved_actions,
        "fit": {field: _metrics(fitting, field) for field in ("raw_probability", "calibrated_probability", "runtime_probability")},
        "development": {field: _metrics(validation, field) for field in ("raw_probability", "calibrated_probability", "runtime_probability")},
        "calibrationBins": bins, "validationUsedForFit": False, "heldoutClaim": False,
        "limitations": ["Calibration covers emitted candidate scores, not absent candidates or task success", "Development probabilities include the runtime top-three normalization", "No fallback values are fabricated for failed predictions", "Fitted values are specific to the recorded model, prompts, memory and condition"],
    }
    if file_hash(prediction_path) != predictions_hash or json.loads(manifest_path.read_text(encoding="utf-8")) != manifest:
        raise ValueError("Prediction artifacts changed during calibration")
    return calibration, report, joined
