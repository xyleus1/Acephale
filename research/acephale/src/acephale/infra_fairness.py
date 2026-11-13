"""Reviewed family controls and audited cross-weight development comparisons."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import read_jsonl, verify_bundle
from acephale.storage import file_hash
from acephale.training_data import BASE, calibration_families

FAMILY_KEYS = ("weightFitFamilies", "calibrationFamilies", "developmentFamilies", "testFamilies")


def _hashed(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("contentHash") != hash_v1({key: item for key, item in value.items() if key != "contentHash"}):
        raise ValueError("Artifact content hash mismatch")
    return value


def load_reviewed_selection(partitions_path: Path, memory_path: Path, source_hash: str,
                            public_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Use the same immutable proposal/review chain as the fit-only memory builder."""
    paths = [partitions_path, partitions_path.parent / "partition.json", partitions_path.parent / "source-design-review.json", memory_path]
    snapshots = {path: file_hash(path) for path in paths}
    partition, proposal, review, memory = [_hashed(json.loads(path.read_text(encoding="utf-8"))) for path in paths]
    reviewed = partition.get("review", {})
    if (partition.get("schemaVersion") != 1 or partition.get("kind") != "acephale-candidate-only-family-partition"
            or partition.get("executionAuthorized") is not True or partition.get("evaluationEligible") is not True
            or partition.get("efficacyClaimAllowed") is not False or reviewed.get("status") != "completed"
            or reviewed.get("reviewerKind") != "assistant_source_design" or reviewed.get("humanAnnotationLabelReview") is not False
            or review.get("kind") != "acephale-source-family-review" or review.get("reviewer", {}).get("kind") != "assistant_source_design"
            or review.get("humanAnnotationLabelReview") is not False or review.get("historicalAPIGenExcluded") is not True
            or reviewed.get("sourceDesignReviewHash") != review["contentHash"] or review.get("partitionProposalHash") != proposal["contentHash"]):
        raise ValueError("Completed candidate-only source-design review required")
    expected: dict[str, str] = {}
    for key, split in zip(FAMILY_KEYS, ("train", "train", "development", "test"), strict=True):
        families = partition.get(key)
        if not isinstance(families, list) or not families or families != proposal.get(key):
            raise ValueError("Approved family lists differ from reviewed proposal")
        for family in families:
            if not isinstance(family, str) or not family or family in expected:
                raise ValueError("Reviewed family partitions overlap or repeat")
            expected[family] = split
    if any(row.get("family_id") not in expected or row.get("split") != expected[row["family_id"]] for row in public_rows):
        raise ValueError("Reviewed families reassign or omit a source partition")
    selection = _hashed(memory.get("familySelection"))
    bindings = {"sourceDatasetHash": source_hash, "partitionHash": partition["contentHash"],
                "partitionSourceSha256": snapshots[partitions_path], "partitionProposalHash": proposal["contentHash"],
                "partitionProposalSourceSha256": snapshots[paths[1]], "sourceDesignReviewHash": review["contentHash"],
                "sourceDesignReviewSha256": snapshots[paths[2]]}
    if (selection.get("version") != 1 or selection.get("kind") != "weight_fit" or any(selection.get(key) != value for key, value in bindings.items())
            or any(selection.get(key) != sorted(partition[key]) for key in FAMILY_KEYS)
            or not isinstance(memory.get("runs"), list)
            or any(run.get("familyId") not in partition["weightFitFamilies"] or run.get("split") != "train" for run in memory["runs"])):
        raise ValueError("Frozen memory is not bound to the reviewed weight-fit families")
    if any(file_hash(path) != digest for path, digest in snapshots.items()):
        raise ValueError("Reviewed selection changed during validation")
    body = {"version": 1, **bindings, **{key: sorted(partition[key]) for key in FAMILY_KEYS},
            "memoryHash": memory["contentHash"], "memoryFamilySelectionHash": selection["contentHash"]}
    return {**body, "contentHash": hash_v1(body)}


def validate_model_selection(model: dict[str, Any], selection: dict[str, Any]) -> None:
    reserved = calibration_families(model)
    if reserved is not None:
        artifact = model["trainedPredictor"]
        if (sorted(artifact["calibrationFamilies"]) != selection["calibrationFamilies"]
                or sorted(artifact["weightFitFamilies"]) != selection["weightFitFamilies"]):
            raise ValueError("Trained artifact disagrees with the reviewed fitting/calibration families")


def _model_identity(model: dict[str, Any], token_ids: dict[str, int], selection: dict[str, Any]) -> str:
    if not isinstance(model, dict) or {key: model.get(key) for key in BASE} != BASE:
        raise ValueError("Comparison requires the exact pinned predictor base")
    artifact = model.get("trainedPredictor")
    if set(model) != set(BASE) | ({"trainedPredictor"} if artifact is not None else set()):
        raise ValueError("Unexpected predictor identity fields")
    if artifact is None:
        return BASE["repository"]
    _hashed(artifact)
    validate_model_selection(model, selection)
    if artifact.get("schemaVersion") == 2:
        from acephale.training_lora import validate_lora_artifact

        validate_lora_artifact(artifact)
        if artifact["binaryTokenIds"] != token_ids:
            raise ValueError("Trained predictor comparison tokenizer differs")
        return artifact["servedModel"]
    artifact_keys = {"schemaVersion", "kind", "base", "adapterHash", "mergedWeightsHash", "tokenizerHash", "chatTemplateHash", "trainingManifestHash",
                     "weightFitFamilies", "calibrationFamilies", "protocol", "binaryTokenIds", "servedModel", "contentHash"}
    if (artifact.get("schemaVersion") != 1 or artifact.get("protocol") != "rank_binary_v1" or artifact.get("binaryTokenIds") != token_ids
            or set(artifact) != artifact_keys
            or any(not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get(key, ""))) for key in
                   ("adapterHash", "mergedWeightsHash", "tokenizerHash", "chatTemplateHash", "trainingManifestHash"))
            or artifact.get("servedModel") != "acephale-predictor-" + artifact["mergedWeightsHash"][:12]):
        raise ValueError("Invalid trained predictor comparison identity")
    return artifact["servedModel"]


def _failed_undispatched_prefix(row: dict[str, Any], window: dict[str, Any], events: list[dict[str, Any]], served_model: str) -> bool:
    """Recognize the compiler's failed fixed-panel path without treating it as a prediction."""
    pool, ids = row.get("candidates", []), window.get("candidateIds")
    if row.get("status") != "failed" or not isinstance(ids, list) or len(ids) >= len(pool):
        return False
    # rawRankPanel rejects the shortened window before preparing or requesting
    # generation. An absent model_dispatch alone cannot establish that path.
    allowed = {"model_tokenizer_started", "model_tokenizer_completed", "infra_candidate_window"}
    if any(event.get("type") not in allowed or event.get("type") != "infra_candidate_window"
           and event.get("purpose") != "candidate_window" for event in events):
        return False
    if not events or events[-1] is not window or len(events[:-1]) % 2:
        return False
    for started, completed in zip(events[:-1:2], events[1:-1:2], strict=True):
        if (started.get("type") != "model_tokenizer_started" or completed.get("type") != "model_tokenizer_completed"
                or not isinstance(started.get("requestId"), str) or not started["requestId"]
                or completed.get("requestId") != started["requestId"]
                or started.get("model") != served_model or completed.get("model") != served_model):
            return False
    prefix, omitted = pool[:len(ids)], pool[len(ids):]
    if (ids != [candidate["id"] for candidate in prefix] or window.get("windowHash") != hash_v1(prefix)
            or window.get("omittedCandidateIds") != [candidate["id"] for candidate in omitted]):
        return False
    fields = ("inputBudget", "windowBudget", "reserveTokens", "mandatoryTokens", "tokenizerCalls")
    if any(type(window.get(key)) is not int or window[key] < 0 for key in fields):
        return False
    measurements = [event for event in events if event.get("type") == "model_tokenizer_completed"]
    if (len(measurements) < 2 or any(type(event.get("inputTokens")) is not int or event["inputTokens"] <= 0 for event in measurements)
            or len({event["requestId"] for event in measurements}) != len(measurements)):
        return False
    return ((window["inputBudget"], window["reserveTokens"], window["windowBudget"]) == (7168, 2048, 5120)
            and window["mandatoryTokens"] <= window["windowBudget"]
            and window["tokenizerCalls"] == len(measurements)
            and measurements[0]["inputTokens"] > window["windowBudget"] >= measurements[1]["inputTokens"]
            and any(event.get("inputTokens") == window["mandatoryTokens"] for event in measurements))


def _row_evidence(row: dict[str, Any], served_model: str) -> dict[str, Any]:
    audit = _hashed(row.get("audit"))
    if audit.get("version") != 1 or not isinstance(audit.get("events"), list) or type(audit.get("rowWallMs")) not in (int, float) or not math.isfinite(audit["rowWallMs"]) or audit["rowWallMs"] < 0:
        raise ValueError("Invalid replay timing/audit")
    events = audit["events"]
    if any(not isinstance(event, dict) for event in events):
        raise ValueError("Invalid replay event")
    candidate_available = "candidates" in row
    pool = row.get("candidates", [])
    if candidate_available and row.get("orderedCandidatePoolHash") != hash_v1(pool):
        raise ValueError("Ordered candidate pool hash mismatch")
    if candidate_available and row.get("candidatePanel") != [candidate["id"] for candidate in pool]:
        raise ValueError("Candidate panel order differs from supplied candidates")
    types = ("infra_candidate_window", "infra_predictor_input", "model_dispatch", "infra_predictor_compiled", "model_completed")
    by_type = {kind: [event for event in events if event.get("type") == kind] for kind in types}
    if any(len(values) > 1 for values in by_type.values()):
        raise ValueError("Neutral replay must contain at most one ranking request")
    if row["status"] == "completed" and pool and any(len(values) != 1 for values in by_type.values()):
        raise ValueError("Completed prediction lacks its actual compilation audit")
    window = next(iter(by_type["infra_candidate_window"]), None)
    prepared = next(iter(by_type["infra_predictor_input"]), None)
    dispatch = next(iter(by_type["model_dispatch"]), None)
    compiled = next(iter(by_type["infra_predictor_compiled"]), None)
    completion = next(iter(by_type["model_completed"]), None)
    if window:
        if window.get("poolHash") != hash_v1(pool):
            raise ValueError("Actual fixed candidate window differs from the ordered panel")
        if (window.get("windowHash") != hash_v1(pool) or window.get("candidateIds") != row.get("candidatePanel")):
            if not _failed_undispatched_prefix(row, window, events, served_model):
                raise ValueError("Actual fixed candidate window differs from the ordered panel")
    if prepared and (not window or prepared.get("candidatePoolHash") != window["poolHash"] or prepared.get("candidateWindowHash") != window["windowHash"]):
        raise ValueError("Prepared prompt has no matching candidate window")
    if dispatch:
        if not prepared or dispatch.get("model") != served_model or any(not re.fullmatch(r"[0-9a-f]{64}", str(dispatch.get(key, ""))) for key in ("inputHash", "compiledMessagesHash", "compiledTokenIdsHash", "requestContractHash")):
            raise ValueError("Dispatch lacks actual model-independent input identity")
        indexes = dispatch.get("selectedMessageIndexes")
        if (not isinstance(indexes, list) or any(type(index) is not int or index < 0 for index in indexes)
                or indexes != sorted(set(indexes)) or not isinstance(dispatch.get("omittedGroups"), list)
                or any(not isinstance(item, str) for item in dispatch["omittedGroups"])
                or dispatch.get("compilerVersion") != "acephale-local-input-v1"
                or type(dispatch.get("inputTokens")) is not int or dispatch["inputTokens"] < 1):
            raise ValueError("Dispatch lacks tokenizer selection evidence")
    if compiled and (not dispatch or not prepared or compiled.get("compiledMessagesHash") != dispatch["compiledMessagesHash"]
                     or compiled.get("inputHash") != dispatch["inputHash"] or compiled.get("inputTokens") != dispatch["inputTokens"]
                     or compiled.get("preparedHash") != prepared["preparedHash"]):
        raise ValueError("Completed compiler evidence differs from dispatched input")
    if completion and (not dispatch or completion.get("requestId") != dispatch.get("requestId") or completion.get("model") != served_model or completion.get("inputHash") != dispatch["inputHash"]):
        raise ValueError("Completion differs from dispatched request")
    return {"pool": hash_v1(pool) if candidate_available else None,
            "prepared": prepared.get("preparedHash") if prepared else None,
            "dispatch": {key: dispatch.get(key) for key in ("compiledMessagesHash", "compiledTokenIdsHash", "requestContractHash", "inputTokens", "omittedGroups", "selectedMessageIndexes", "compilerVersion")} if dispatch else None,
            "rowWallMs": audit["rowWallMs"]}


def compare_predictor_replays(bundle_directory: Path, predictions: dict[str, Path], partitions_path: Path,
                              memory_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Compare raw neutral binary outputs on development only, retaining failures."""
    from acephale.infra_evaluation import score_candidate_panels, score_fixed_panel_replay

    if len(predictions) < 2 or any(not name for name in predictions):
        raise ValueError("At least two named predictor runs required")
    bundle = verify_bundle(bundle_directory)
    public = read_jsonl(bundle_directory / "public.jsonl")
    selection = load_reviewed_selection(partitions_path, memory_path, bundle["bundle_hash"], public)
    shared_fields = ("version", "kind", "sourceDatasetHash", "memoryHash", "predictorContractHash", "candidateCompilerHash", "retrievalHash",
                     "predictionMode", "rawScoreSemantics", "panelSelection", "partition", "predictionProtocol", "binaryTokenIds", "serving", "selection", "limit", "inferGoals", "rowIds", "compilerAuditVersion", "episodic")
    shared = None
    by_checkpoint: dict[str, dict[str, Any]] = {}
    joined, lineage, times = [], {}, {}
    model_hashes, trained_tokenizers = set(), set()
    untrained = 0
    unverifiable = set()
    for name, directory in predictions.items():
        paths = [directory / filename for filename in ("manifest.json", "predictions.jsonl", "receipt.json")]
        snapshots = {path: file_hash(path) for path in paths}
        manifest = _hashed(json.loads(paths[0].read_text(encoding="utf-8")))
        token_ids = manifest.get("binaryTokenIds")
        if (manifest.get("compilerAuditVersion") != 1 or manifest.get("predictionProtocol") != "rank_binary_v1"
                or manifest.get("inferGoals") is not False or manifest.get("partition") != "calibration"
                or manifest.get("episodic") is not None or manifest.get("memoryHash") != selection["memoryHash"]
                or not isinstance(token_ids, dict) or set(token_ids) != {"zero", "one"}
                or any(type(item) is not int or item < 0 for item in token_ids.values()) or token_ids["zero"] == token_ids["one"]):
            raise ValueError("Comparison requires audited neutral binary replay with the same fit-only lexical memory")
        if (manifest.get("predictionMode") != "fixed_panel"
                or manifest.get("panelSelection") != "first_three_common_compiler_candidates_before_goal_inference_v1"
                or manifest.get("selection") != "family-partition-round-robin-v1"
                or type(manifest.get("limit")) is not int or not 1 <= manifest["limit"] <= 1000
                or manifest.get("serving") != {"contextWindow": 8192, "inputBudget": 7168, "outputCap": 1024,
                                              "temperature": 0, "topP": 1, "seed": 0, "stream": True, "enableThinking": False}
                or any(not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get(key, ""))) for key in
                       ("sourceDatasetHash", "memoryHash", "predictorContractHash", "candidateCompilerHash", "retrievalHash"))):
            raise ValueError("Missing or incompatible frozen replay lineage")
        identity = {key: manifest.get(key) for key in shared_fields}
        if shared is not None and identity != shared:
            raise ValueError("Replay lineage, protocol, serving or checkpoint selection differs")
        shared = identity
        served = _model_identity(manifest.get("model"), token_ids, selection)
        model_hash = hash_v1(manifest["model"])
        if model_hash in model_hashes:
            raise ValueError("Comparison repeats the same weight identity")
        model_hashes.add(model_hash)
        artifact = manifest["model"].get("trainedPredictor")
        untrained += artifact is None
        if artifact:
            trained_tokenizers.add((artifact["tokenizerHash"], artifact["chatTemplateHash"]))
        _, rows = score_fixed_panel_replay(bundle_directory, directory)
        raw = read_jsonl(paths[1])
        for row in raw:
            evidence = _row_evidence(row, served)
            previous = by_checkpoint.setdefault(row["checkpoint_id"], {})
            for field in ("pool", "prepared", "dispatch"):
                value = evidence[field]
                if value is not None and field in previous and value != previous[field]:
                    raise ValueError("Predictors received different ordered candidates or compiled prompts")
                if value is not None:
                    previous[field] = value
            if row["split"] == "development" and (evidence["pool"] is None or row.get("candidates") and evidence["dispatch"] is None):
                unverifiable.add(row["checkpoint_id"])
        dev = [row for row in rows if row["split"] == "development"]
        if {row["family_id"] for row in dev} != set(selection["developmentFamilies"]):
            raise ValueError("Every reviewed development family must remain in the declared comparison")
        joined.extend({**row, "condition": name} for row in dev)
        values = [row["audit"]["rowWallMs"] for row in raw if row["split"] == "development"]
        times[name] = {"declaredCheckpoints": len(values), "meanReplayWallMs": sum(values) / len(values), "liveLatencyMeasured": False}
        lineage[name] = {"model": manifest["model"], "predictionManifestHash": manifest["contentHash"],
                         "predictionRowsSha256": snapshots[paths[1]], "receiptSha256": snapshots[paths[2]]}
        if any(file_hash(path) != digest for path, digest in snapshots.items()):
            raise ValueError("Replay changed during comparison")
    if untrained != 1 or len(trained_tokenizers) != 1:
        raise ValueError("Exactly one untrained baseline and tokenizer-identical trained predictors required")
    report = score_candidate_panels(joined, allow_unavailable_panels=True)
    report.update({"comparisonKind": "neutral_binary_predictor_weights_development", "reviewedSelection": selection,
                   "runs": lineage, "replayTiming": times, "unverifiableFailedPromptCheckpoints": sorted(unverifiable),
                   "allObservedComparableInputsMatched": True, "allDevelopmentInputsVerified": not unverifiable,
                   "developmentOnly": True, "heldout_claim": False})
    report["limitations"].extend(["Three-candidate top-3 hit rate measures panel coverage, not ranking improvement",
                                  "Timing is prediction replay wall time, not live task latency",
                                  "Failures before dispatch retain their denominator but have no fabricated compiled prompt"])
    return report, joined
