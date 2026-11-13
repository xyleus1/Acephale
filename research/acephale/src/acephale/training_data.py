"""Validated, immutable training inputs. This module never loads model weights."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from acephale.contracts_v1 import canonical_v1, hash_v1
from acephale.infra_data import GoalAnnotation, audit_gate, read_jsonl, validate_annotation
from acephale.storage import file_hash

BASE = {"repository": "Qwen/Qwen3.5-0.8B", "revision": "2fc06364715b967f1860aea9cf38778875588b17"}
PARTITIONS = ("weight_fit", "calibration", "development", "test")
FAMILY_KEYS = dict(zip(PARTITIONS, ("weightFitFamilies", "calibrationFamilies", "developmentFamilies", "testFamilies"), strict=True))
DIGEST = re.compile(r"^[0-9a-f]{64}$")
RECIPE = {"rank": 16, "alpha": 32, "dropout": 0.05, "learningRate": 1e-4, "weightDecay": 0.01,
          "gradientClip": 1.0, "warmupRatio": 0.03, "microBatch": 1, "gradientAccumulation": 16,
          "maxLength": 8192, "maxOutputTokens": 1024, "epochs": 3, "maxSteps": 500,
          "seeds": [17, 29], "dtype": "bfloat16", "loss": "completion_only_cross_entropy"}


def training_recipe(*, micro_batch: int = 1, gradient_accumulation: int = 16) -> dict[str, Any]:
    """Allow the declared throughput profiles without changing effective batch size."""
    if (type(micro_batch) is not int or type(gradient_accumulation) is not int
            or (micro_batch, gradient_accumulation) not in {(1, 16), (2, 8), (4, 4)}):
        raise ValueError("Training batch profile must be 1/16, 2/8 or 4/4")
    return {**RECIPE, "seeds": list(RECIPE["seeds"]), "microBatch": micro_batch,
            "gradientAccumulation": gradient_accumulation}


class TrainingExample(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal[1]
    id: str = Field(min_length=1)
    familyId: str = Field(min_length=1)
    partition: Literal["weight_fit", "calibration", "development", "test"]
    task: Literal["goal", "rank_binary"]
    condition: Literal["neutral", "conditional"] | None
    prompt: list[dict[str, Any]] = Field(min_length=1)
    completion: str = Field(min_length=1)
    compiledInputHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    sourceFrameHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidateIds: list[str] = Field(max_length=128)
    candidateWindowHash: str | None
    promptTokens: int = Field(ge=1, le=7168)
    provenance: dict[str, Any]

    @model_validator(mode="after")
    def valid(self) -> TrainingExample:
        if hash_v1(self.prompt) != self.compiledInputHash:
            raise ValueError("Compiled prompt hash differs")
        for message in self.prompt:
            if message.get("role") not in {"system", "user", "assistant", "tool"} or not isinstance(message.get("content"), (str, type(None))):
                raise ValueError("Invalid compiled message")
        required = ("sourceDatasetHash", "publicInputHash", "labelHash", "compilerHash", "tokenizerHash", "chatTemplateHash")
        if any(not DIGEST.fullmatch(str(self.provenance.get(key, ""))) for key in required):
            raise ValueError("Frozen source/compiler/tokenizer provenance required")
        source_split = self.provenance.get("sourceSplit")
        if source_split not in {"train", "development", "test"}:
            raise ValueError("Original source split required")
        expected = "train" if self.partition in {"weight_fit", "calibration"} else self.partition
        if source_split != expected:
            raise ValueError("A historical evaluation partition cannot become training data")
        target = json.loads(self.completion)
        if self.task == "rank_binary":
            if self.condition not in {"neutral", "conditional"} or self.provenance.get("observedNextBatch") is not True:
                raise ValueError("Observed next batch and ranking condition required")
            if not self.candidateWindowHash or not DIGEST.fullmatch(self.candidateWindowHash):
                raise ValueError("Frozen candidate window required")
            if len(set(self.candidateIds)) != len(self.candidateIds) or any(not item for item in self.candidateIds):
                raise ValueError("Candidate identities must be unique")
            if set(target) != {"action", "hits"} or target["action"] not in {"READ", "NO_READ", "READ_UNCOVERED"}:
                raise ValueError("Invalid binary target")
            hits = target["hits"]
            if not isinstance(hits, list) or len(hits) != len(self.candidateIds) or any(type(value) is not int or value not in {0, 1} for value in hits):
                raise ValueError("Every supplied candidate needs an observed binary label")
            if (target["action"] == "READ") != any(hits):
                raise ValueError("Action and candidate membership disagree")
            if self.condition == "conditional" and not DIGEST.fullmatch(str(self.provenance.get("annotationHash", ""))):
                raise ValueError("Conditional ranking requires an audited goal annotation")
        else:
            if self.condition is not None or self.candidateIds or self.candidateWindowHash is not None:
                raise ValueError("Goal inference has no ranking window")
            if not DIGEST.fullmatch(str(self.provenance.get("annotationHash", ""))):
                raise ValueError("Audited annotation identity required")
            if set(target) != {"schemaVersion", "hypotheses", "unknown"} or target["schemaVersion"] != 1:
                raise ValueError("Goal target must omit server-owned revision identity")
            hypotheses = target["hypotheses"]
            if not isinstance(hypotheses, list) or len(hypotheses) > 3:
                raise ValueError("Invalid goal hypotheses")
            for goal in hypotheses:
                if not isinstance(goal, dict) or set(goal) != {"id", "objective", "probability", "sources", "constraints"}:
                    raise ValueError("Invalid goal fields")
                if any(not isinstance(goal[key], str) or not goal[key] for key in ("id", "objective")):
                    raise ValueError("Goal identity and objective required")
                if not isinstance(goal["constraints"], list):
                    raise ValueError("Goal constraints must be a list")
                for item in [goal, *goal["constraints"]]:
                    if item is not goal and (not isinstance(item, dict) or set(item) != {"text", "sources"} or not isinstance(item["text"], str) or not item["text"]):
                        raise ValueError("Invalid goal constraint")
                    sources = item["sources"]
                    if not isinstance(sources, list) or not sources:
                        raise ValueError("Every objective and constraint needs source references")
                    for source in sources:
                        if not isinstance(source, dict) or set(source) != {"sourceId", "path"} or not isinstance(source["sourceId"], str) or not source["sourceId"]:
                            raise ValueError("Invalid goal source reference")
                        path = source["path"]
                        if not isinstance(path, list) or len(path) > 8 or any(type(part) not in {str, int} or type(part) is int and part < 0 for part in path):
                            raise ValueError("Invalid goal source path")
            probabilities = [goal.get("probability") for goal in hypotheses] + [target["unknown"]]
            if any(type(value) not in {int, float} or not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities) or not math.isclose(sum(probabilities), 1, abs_tol=1e-6):
                raise ValueError("Invalid goal distribution")
        return self


def pointer_path(value: Any, pointer: str) -> list[str | int]:
    """Preserve numeric object keys as strings and actual array indices as ints."""
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError("JSON pointer must start with slash")
    path: list[str | int] = []
    for item in pointer[1:].split("/"):
        if "~" in item.replace("~1", "").replace("~0", ""):
            raise ValueError("Invalid JSON pointer escape")
        token = item.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list) and token.isdigit() and str(int(token)) == token:
            part: str | int = int(token)
        elif isinstance(value, dict):
            part = token
        else:
            raise ValueError("Source pointer cannot resolve")
        try:
            value = value[part]
        except (IndexError, KeyError, TypeError) as error:
            raise ValueError("Source pointer cannot resolve") from error
        path.append(part)
    if len(path) > 8:
        raise ValueError("Runtime source paths are limited to eight segments")
    return path


def annotation_goal_draft(annotation: dict[str, Any], public: dict[str, Any]) -> dict[str, Any]:
    parsed = GoalAnnotation.model_validate(annotation)
    validate_annotation(parsed, public)
    sources = {source["id"]: source["value"] for source in public["input"]["sources"]}

    def reference(ref):
        return {"sourceId": ref.source_id, "path": pointer_path(sources[ref.source_id], ref.pointer)}

    return {"schemaVersion": 1, "unknown": parsed.unknown_probability, "hypotheses": [
        {"id": f"{goal.action}:{goal.object_type}:{index}", "objective": goal.objective,
         "probability": goal.confidence, "sources": [reference(ref) for ref in goal.sources],
         "constraints": [{"text": constraint.text, "sources": [reference(ref) for ref in constraint.sources]}
                         for constraint in goal.constraints]}
        for index, goal in enumerate(parsed.goals)]}


def hashed(body: dict[str, Any]) -> dict[str, Any]:
    return {**body, "contentHash": hash_v1(body)}


def verify_hashed(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("contentHash") != hash_v1({key: item for key, item in value.items() if key != "contentHash"}):
        raise ValueError("Artifact content hash differs")
    return value


def write_new(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def file_inventory(directory: Path) -> list[dict[str, Any]]:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Artifact inventory requires a real directory")
    paths = sorted(directory.rglob("*"))
    if any(path.is_symlink() for path in paths):
        raise ValueError("Artifact inventory cannot contain symlinks")
    return [{"path": path.relative_to(directory).as_posix(), "bytes": path.stat().st_size, "sha256": file_hash(path)}
            for path in paths if path.is_file()]


def verify_review(pilot: dict[str, Any], reviews: list[dict[str, Any]], annotations: list[dict[str, Any]],
                  *, machine_audit: Path | None = None) -> dict[str, Any]:
    if machine_audit is not None:
        from acephale.annotation_review import verify_machine_review

        return verify_machine_review(pilot, reviews, annotations, machine_audit)
    if any(row.get("review_kind") not in {None, "human"} or row.get("reviewProtocol") == "machine_audited_exploratory" for row in reviews):
        raise ValueError("Machine judgments require the explicit exploratory review protocol")
    by_id = {row["checkpoint_id"]: row for row in annotations}
    if len(by_id) != len(annotations) or len(reviews) < 20:
        raise ValueError("Twenty attributed human reviews and unique annotations required")
    for row in reviews:
        if row.get("annotationHash") != hash_v1(by_id.get(row["checkpoint_id"])):
            raise ValueError("Review does not bind the actual annotation")
    result = audit_gate(pilot, reviews)
    if not result["goal_conditioning_allowed"]:
        raise ValueError("Human goal annotation audit failed")
    return {**result, "pilotHash": hash_v1(pilot), "reviewsHash": hash_v1(reviews),
            "annotationHashes": sorted(hash_v1(row) for row in annotations)}


def multitask_training_coverage(rows: list[TrainingExample]) -> dict[str, Any] | None:
    """Count independent fitting checkpoints, not three supervised rows per prefix."""
    fitting = [row for row in rows if row.partition == "weight_fit"]
    if not any(row.provenance.get("exportProtocol") == "native-multitask-v2" for row in fitting):
        return None
    if any(row.provenance.get("exportProtocol") != "native-multitask-v2" for row in fitting):
        raise ValueError("Native multitask fitting cannot silently include neutral-only or historical examples")
    grouped: dict[tuple[str, str, str], list[TrainingExample]] = defaultdict(list)
    for row in fitting:
        grouped[row.familyId, row.provenance["sourceDatasetHash"], row.provenance["publicInputHash"]].append(row)
    counts: dict[str, int] = defaultdict(int)
    positive = 0
    for (family, _, _), group in grouped.items():
        by_kind = {(row.task, row.condition): row for row in group}
        if len(group) != 3 or set(by_kind) != {("goal", None), ("rank_binary", "neutral"), ("rank_binary", "conditional")}:
            raise ValueError("Native fitting requires complete goal, neutral and conditional checkpoint triplets")
        neutral, conditional, goal = by_kind["rank_binary", "neutral"], by_kind["rank_binary", "conditional"], by_kind["goal", None]
        if (neutral.candidateIds != conditional.candidateIds or neutral.candidateWindowHash != conditional.candidateWindowHash
                or neutral.completion != conditional.completion or neutral.sourceFrameHash != conditional.sourceFrameHash
                or neutral.provenance["labelHash"] != conditional.provenance["labelHash"]
                or conditional.provenance["annotationHash"] != goal.provenance["annotationHash"]):
            raise ValueError("Native fitting triplet does not preserve matched labels, goals and candidate windows")
        counts[family] += 1
        positive += int(any(json.loads(neutral.completion)["hits"]))
    if len(counts) != 24 or min(counts.values()) < 4 or positive < 48:
        raise ValueError("Native fitting requires 24 families, four complete checkpoints per family and 48 positive-read checkpoints")
    return {"protocol": "native-multitask-v2", "fittingFamilies": len(counts), "completeCheckpoints": len(grouped),
            "positiveReadCheckpoints": positive, "checkpointsPerFamily": dict(sorted(counts.items()))}


def _dataset_body(rows: list[dict[str, Any]], review: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    if review is not None:
        from acephale.annotation_review import review_metadata

        review_metadata(review)
    parsed = [TrainingExample.model_validate(row) for row in rows]
    if not parsed or len({row.id for row in parsed}) != len(parsed):
        raise ValueError("Nonempty unique training example IDs required")
    coverage = multitask_training_coverage(parsed)
    families: dict[str, set[str]] = defaultdict(set)
    public_partitions: dict[str, set[str]] = defaultdict(set)
    identities: dict[str, set[str]] = defaultdict(set)
    grouped = {partition: [] for partition in PARTITIONS}
    for row in parsed:
        families[row.familyId].add(row.partition)
        public_partitions[row.provenance["publicInputHash"]].add(row.partition)
        for key in ("compilerHash", "tokenizerHash", "chatTemplateHash"):
            identities[key].add(row.provenance[key])
        if row.task == "goal" or row.condition == "conditional":
            if not review or review.get("goal_conditioning_allowed") is not True or review.get("audited", 0) < 20 or row.provenance.get("annotationHash") not in review.get("annotationHashes", []):
                if review and review.get("reviewProtocol") == "machine_audited_exploratory":
                    raise ValueError("Goal training requires completed exploratory machine annotation review")
                raise ValueError("Goal training requires completed human annotation review")
        grouped[row.partition].append(row.model_dump(mode="json"))
    if any(len(values) > 1 for values in [*families.values(), *public_partitions.values()]):
        raise ValueError("A family or public checkpoint crosses training partitions")
    if any(len(values) != 1 for values in identities.values()):
        raise ValueError("Mixed compiler, tokenizer or chat template identities")
    if not grouped["weight_fit"]:
        raise ValueError("Weight fitting partition is empty")
    for records in grouped.values():
        records.sort(key=lambda row: row["id"])
    dataset_hash = hash_v1({partition: [{"id": row["id"], "rowHash": hash_v1(row)} for row in records] for partition, records in grouped.items()})
    body = {"schemaVersion": 1, "kind": "acephale-predictor-training", "base": BASE,
            "datasetHash": dataset_hash, **{key: next(iter(values)) for key, values in identities.items()},
            **{key: sorted(family for family, parts in families.items() if partition in parts) for partition, key in FAMILY_KEYS.items()},
            "recipe": RECIPE, "review": review, "counts": {partition: len(records) for partition, records in grouped.items()}}
    if coverage is not None:
        body["multitaskCoverage"] = coverage
    return body, grouped


def prepare_dataset(rows: list[dict[str, Any]], output: Path, *, review: dict[str, Any] | None = None) -> dict[str, Any]:
    body, grouped = _dataset_body(rows, review)
    output.mkdir(parents=True, exist_ok=False)
    for partition, records in grouped.items():
        with (output / f"{partition}.jsonl").open("x", encoding="utf-8", newline="\n") as stream:
            for row in records:
                stream.write(canonical_v1(row).decode() + "\n")
    body["sourceFiles"] = file_inventory(output)
    manifest = hashed(body)
    write_new(output / "manifest.json", manifest)
    return manifest


def verify_dataset(directory: Path) -> dict[str, Any]:
    manifest = verify_hashed(json.loads((directory / "manifest.json").read_text(encoding="utf-8")))
    if manifest.get("kind") != "acephale-predictor-training" or manifest.get("base") != BASE:
        raise ValueError("Wrong training manifest or base model")
    if sorted(row.get("path", "") for row in manifest["sourceFiles"]) != sorted(f"{partition}.jsonl" for partition in PARTITIONS):
        raise ValueError("Training manifest must inventory every partition exactly once")
    root = directory.resolve()
    for row in manifest["sourceFiles"]:
        path = (directory / row["path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != row["bytes"] or file_hash(path) != row["sha256"]:
            raise ValueError("Training source file differs")
    rows = []
    for partition in PARTITIONS:
        part = load_partition(directory, partition)
        if any(row["partition"] != partition for row in part):
            raise ValueError("Training row is stored in the wrong partition")
        rows.extend(part)
    body, _ = _dataset_body(rows, manifest.get("review"))
    if any(manifest.get(key) != value for key, value in body.items()):
        raise ValueError("Training manifest differs from its validated rows")
    return manifest


def calibration_families(model: dict[str, Any]) -> set[str] | None:
    """Old frozen models keep legacy fitting; a trained model must reserve families."""
    artifact = model.get("trainedPredictor")
    if artifact is None:
        return None
    verify_hashed(artifact)
    if artifact.get("kind") != "acephale-trained-predictor" or artifact.get("base") != {key: model[key] for key in ("repository", "revision")}:
        raise ValueError("Invalid trained predictor identity")
    fit, calibration = artifact.get("weightFitFamilies"), artifact.get("calibrationFamilies")
    if not isinstance(fit, list) or not isinstance(calibration, list) or not fit or not calibration or set(fit) & set(calibration):
        raise ValueError("Trained predictor needs disjoint weight-fit and calibration families")
    return set(calibration)


def load_partition(directory: Path, partition: str) -> list[dict[str, Any]]:
    if partition not in PARTITIONS:
        raise ValueError("Unknown training partition")
    return [TrainingExample.model_validate(row).model_dump(mode="json") for row in read_jsonl(directory / f"{partition}.jsonl")]
