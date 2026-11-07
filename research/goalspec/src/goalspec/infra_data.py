"""Versioned, leakage-checked inputs for the fixed-actor infrastructure study.

This module never calls a model. Labels, public inputs and independent verdicts
are separate artifacts. Existing endpoint goals are deliberately not imported as
requested-goal annotations. Output directories are published once, never reused.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from goalspec.contracts_v1 import hash_v1
from goalspec.patterns import fit_patterns
from goalspec.replay import decision_points, public_prefix
from goalspec.schemas import Event, PrefixView, Record, Trajectory
from goalspec.storage import file_hash, load_trajectories

VERSION = "goalspec-infra-data-v1"
Partition = Literal["train", "development", "test"]
VERIFIED_TIERS = {"native_verified", "independent_replay"}
PRIVATE_KEYS = {
    "referenceactions", "privateinstructions", "privatestate", "evaluatorstate",
    "evaluatorinstructions", "hiddenstate", "endpointlabels", "finalstate",
    "independentcheck", "verdict", "outcome",
}


class Scope(Record):
    tenant_id: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    authorization_revision: str = Field(min_length=1)


class EpisodeMeta(Record):
    episode_id: str = Field(min_length=1)
    family_id: str = Field(min_length=1)
    scope: Scope
    request_revision: str = Field(min_length=1)
    environment_version: str = Field(min_length=1)
    tool_schema_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    public_context_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    captured_before_execution: Literal[True]
    verification_tier: Literal[
        "native_verified", "independent_replay", "source_reported", "unverified"
    ]
    license: str = Field(min_length=1)
    source_revision: str = Field(min_length=1)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _public_check(value: Any, path: str = "public") -> None:
    """Fail closed on accidentally joined private structured fields.

    Free-text provenance still depends on the trusted public capture. This check
    is an additional tripwire, not a claim to classify arbitrary prose secrets.
    """
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = "".join(character.lower() for character in key if character.isalnum())
            if normalized in PRIVATE_KEYS:
                raise ValueError(f"Private field in public capture: {path}.{key}")
            _public_check(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _public_check(child, f"{path}[{index}]")


def public_context(trajectory: Trajectory) -> dict[str, Any]:
    return {
        "policy": trajectory.policy,
        "tools": [tool.model_dump(mode="json") for tool in trajectory.initial_tools],
    }


def load_metadata(path: Path) -> dict[str, EpisodeMeta]:
    rows = read_jsonl(path)
    result: dict[str, EpisodeMeta] = {}
    for row in rows:
        meta = EpisodeMeta.model_validate(row)
        if meta.episode_id in result:
            raise ValueError("Duplicate episode metadata")
        result[meta.episode_id] = meta
    return result


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    result = []
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"Expected an object at line {number}")
                result.append(value)
    return result


def validate_corpus(trajectories: list[Trajectory], metadata: Mapping[str, EpisodeMeta]) -> None:
    ids = {trajectory.trajectory_id for trajectory in trajectories}
    if len(ids) != len(trajectories) or ids != set(metadata):
        raise ValueError("Metadata must account for every unique episode exactly once")
    for trajectory in trajectories:
        meta = metadata[trajectory.trajectory_id]
        if trajectory.group_id != meta.family_id:
            raise ValueError("Family identity differs between trajectory and metadata")
        if trajectory.benchmark_revision != meta.environment_version:
            raise ValueError("Environment version mismatch")
        context = public_context(trajectory)
        if hash_v1(context) != meta.public_context_hash:
            raise ValueError("Public capture hash mismatch")
        if hash_v1(context["tools"]) != meta.tool_schema_hash:
            raise ValueError("Tool schema hash mismatch")
        _public_check(context)


def _stable(seed: int, value: str) -> str:
    return hashlib.sha256(f"{seed}:{value}".encode()).hexdigest()


def build_split(
    trajectories: list[Trajectory], metadata: Mapping[str, EpisodeMeta], seed: int = 42,
) -> dict[str, Any]:
    """Family assignment reads public identity only, before annotation or mining."""
    validate_corpus(trajectories, metadata)
    strata: dict[tuple[str, str], set[str]] = defaultdict(set)
    family_stratum: dict[str, tuple[str, str]] = {}
    for trajectory in trajectories:
        stratum = trajectory.benchmark, trajectory.domain
        family = metadata[trajectory.trajectory_id].family_id
        if family in family_stratum and family_stratum[family] != stratum:
            raise ValueError("A global family cannot straddle benchmark/domain strata")
        family_stratum[family] = stratum
        strata[stratum].add(family)
    assignments: dict[str, Partition] = {}
    for families in strata.values():
        if len(families) < 5:
            raise ValueError("Need at least five independent families per stratum")
        ordered = sorted(families, key=lambda family: _stable(seed, family))
        train_end = int(len(ordered) * 0.6)
        dev_end = min(len(ordered) - 1, train_end + max(1, int(len(ordered) * 0.2)))
        for index, family in enumerate(ordered):
            assignments[family] = "train" if index < train_end else (
                "development" if index < dev_end else "test"
            )
    result = {
        "schema_version": VERSION,
        "seed": seed,
        "method": "family-stratified-before-labels",
        "families": assignments,
        "episodes": {
            trajectory.trajectory_id: metadata[trajectory.trajectory_id].family_id
            for trajectory in trajectories
        },
        "metadata_hash": hash_v1([metadata[key].model_dump(mode="json") for key in sorted(metadata)]),
    }
    verify_split(result, trajectories, metadata)
    return result


def verify_split(
    split: dict[str, Any], trajectories: list[Trajectory], metadata: Mapping[str, EpisodeMeta],
) -> None:
    validate_corpus(trajectories, metadata)
    expected = {trajectory.trajectory_id: metadata[trajectory.trajectory_id].family_id for trajectory in trajectories}
    if split.get("schema_version") != VERSION or split.get("episodes") != expected:
        raise ValueError("Split does not account for this corpus")
    if split.get("metadata_hash") != hash_v1([metadata[key].model_dump(mode="json") for key in sorted(metadata)]):
        raise ValueError("Metadata changed after split freeze")
    families = split.get("families", {})
    if set(families) != set(expected.values()) or any(value not in {"train", "development", "test"} for value in families.values()):
        raise ValueError("Split must assign every family exactly once")
    task_parts: dict[tuple, set[str]] = defaultdict(set)
    identical_requests: dict[str, set[str]] = defaultdict(set)
    for trajectory in trajectories:
        partition = families[expected[trajectory.trajectory_id]]
        task_parts[(trajectory.benchmark, trajectory.domain, trajectory.task_id)].add(partition)
        first_user = next((event.content for event in trajectory.events if event.kind == "message" and event.role == "user"), None)
        if first_user:
            fingerprint = hash_v1([trajectory.benchmark, trajectory.domain, trajectory.policy, first_user])
            identical_requests[fingerprint].add(partition)
    if any(len(values) > 1 for values in [*task_parts.values(), *identical_requests.values()]):
        raise ValueError("Repeated task or identical request crosses family split")


def _public_event(event: Event) -> dict[str, Any]:
    # Explicit projection is intentional. New Event fields are not exposed by default.
    record: dict[str, Any] = {"seq": event.seq, "kind": event.kind, "role": event.role}
    fields = {
        "message": ("content",),
        "tool_request": ("call_id", "tool", "arguments", "batch_id"),
        "tool_result": ("call_id", "tool", "result", "status", "state_version"),
        "tools": ("tools",),
    }
    values = event.model_dump(mode="json")
    for field in fields[event.kind]:
        if values[field] is not None:
            record[field] = values[field]
    _public_check(record)
    return record


def all_checkpoints(trajectory: Trajectory) -> list[tuple[PrefixView, tuple[Event, ...]]]:
    """Include terminal/message-only decisions so NO_READ is not fabricated."""
    points = {len(point.prefix.events): (point.prefix, point.targets) for point in decision_points(trajectory)}
    events = trajectory.events
    for index, event in enumerate(events):
        if event.kind != "message" or event.role != "assistant":
            continue
        if index and events[index - 1].kind == "message" and events[index - 1].role == "assistant":
            continue
        end = index + 1
        while end < len(events) and events[end].kind == "message" and events[end].role == "assistant":
            end += 1
        if end < len(events) and events[end].kind == "tool_request":
            continue
        prefix = public_prefix(trajectory, index)
        requested = {value.call_id for value in prefix.events if value.kind == "tool_request"}
        completed = {value.call_id for value in prefix.events if value.kind == "tool_result"}
        if requested != completed:
            raise ValueError("Message decision has unresolved authoritative calls")
        points[index] = prefix, ()
    return [points[index] for index in sorted(points)]


def export_rows(
    trajectories: list[Trajectory], metadata: Mapping[str, EpisodeMeta], split: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    verify_split(split, trajectories, metadata)
    public, labels, verdicts = [], [], []
    for trajectory in sorted(trajectories, key=lambda row: row.trajectory_id):
        meta = metadata[trajectory.trajectory_id]
        for ordinal, (prefix, targets) in enumerate(all_checkpoints(trajectory)):
            events = [_public_event(event) for event in prefix.events]
            sources = [{"id": "policy", "kind": "policy", "value": prefix.policy}]
            for event in events:
                if event["kind"] == "message":
                    sources.append({"id": f"event:{event['seq']}", "kind": event["role"], "value": event.get("content", "")})
                elif event["kind"] == "tool_result":
                    sources.append({"id": f"event:{event['seq']}", "kind": "observation", "value": event.get("result")})
            model_input = {
                "policy": prefix.policy,
                "tools": [tool.model_dump(mode="json") for tool in prefix.tools],
                "events": events,
                "sources": sources,
            }
            _public_check(model_input)
            revision = hash_v1([meta.request_revision, [event for event in events if event["kind"] == "message" and event["role"] == "user"]])
            checkpoint_id = hash_v1([trajectory.trajectory_id, ordinal, prefix.through_seq])
            record = {
                "schema_version": VERSION,
                "checkpoint_id": checkpoint_id,
                "episode_id": trajectory.trajectory_id,
                "family_id": meta.family_id,
                "split": split["families"][meta.family_id],
                "benchmark": trajectory.benchmark,
                "domain": trajectory.domain,
                "through_seq": prefix.through_seq,
                "request_revision": revision,
                "scope": meta.scope.model_dump(mode="json"),
                "environment_version": meta.environment_version,
                "tool_schema_hash": hash_v1(model_input["tools"]),
                "input": model_input,
                "input_hash": hash_v1(model_input),
            }
            public.append(record)
            contracts = {tool.name: tool for tool in prefix.tools}
            invocations = [{"tool": target.tool, "arguments": target.arguments} for target in targets]
            eligible = [invocation for invocation in invocations if invocation["tool"] in contracts and contracts[invocation["tool"]].side_effects == "read_only" and contracts[invocation["tool"]].cacheable]
            labels.append({
                "checkpoint_id": checkpoint_id, "input_hash": record["input_hash"],
                "next_invocations": invocations, "eligible_reads": eligible,
                "target_kind": "READ" if eligible else "NO_READ",
                "source": "observed-authoritative-next-decision",
            })
        verdicts.append({
            "episode_id": trajectory.trajectory_id,
            "family_id": meta.family_id,
            "split": split["families"][meta.family_id],
            "verification_tier": meta.verification_tier,
            "outcome": trajectory.outcome.model_dump(mode="json", exclude={"goal"}),
        })
    return public, labels, verdicts


def publish_bundle(destination: Path, files: Mapping[str, Any], *, parquet: bool = False) -> dict[str, Any]:
    """Exclusive publication; manifest is the completion marker. Never overwrite."""
    if any(Path(name).name != name for name in files):
        raise ValueError("Artifact names must be single path components")
    if "manifest.json" in files:
        raise ValueError("manifest.json is reserved")
    arrow = None
    parquet_writer = None
    if parquet:
        try:
            import pyarrow as arrow
            import pyarrow.parquet as parquet_writer
        except ImportError as error:
            raise RuntimeError("Parquet requires the existing analysis extra") from error
    destination.mkdir(parents=True, exist_ok=False)
    inventory = {}
    for name, content in files.items():
        path = destination / name
        if name.endswith(".jsonl"):
            data = "".join(canonical(row) + "\n" for row in content)
            row_count = len(content)
        else:
            data = canonical(content) + "\n"
            row_count = None
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(data)
        inventory[name] = {"sha256": file_hash(path), "rows": row_count}
        if parquet and name.endswith(".jsonl"):
            # Canonical JSON payload preserves nested and heterogeneous tool results
            # byte-for-byte, instead of lossy Arrow struct inference.
            parquet_path = path.with_suffix(".parquet")
            table = arrow.table({"ordinal": list(range(len(content))), "canonical_json": [canonical(row) for row in content]})
            parquet_writer.write_table(table, parquet_path, compression="zstd")
            inventory[parquet_path.name] = {"sha256": file_hash(parquet_path), "rows": len(content), "encoding": "canonical-json-column"}
    manifest = {"schema_version": VERSION, "files": inventory, "bundle_hash": hash_v1(inventory)}
    with (destination / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(canonical(manifest) + "\n")
    return manifest


def verify_bundle(directory: Path) -> dict[str, Any]:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    inventory = manifest.get("files", {})
    if manifest.get("schema_version") != VERSION or manifest.get("bundle_hash") != hash_v1(inventory):
        raise ValueError("Invalid bundle manifest")
    for name, row in inventory.items():
        if Path(name).name != name or file_hash(directory / name) != row["sha256"]:
            raise ValueError("Artifact content changed")
    return manifest


def export_dataset(trajectory_path: Path, metadata_path: Path, split_path: Path, destination: Path, *, parquet: bool = False) -> dict[str, Any]:
    trajectories = load_trajectories(trajectory_path)
    metadata = load_metadata(metadata_path)
    split = json.loads(split_path.read_text(encoding="utf-8"))
    public, labels, verdicts = export_rows(trajectories, metadata, split)
    return publish_bundle(destination, {
        "public.jsonl": public, "labels.jsonl": labels, "verdicts.jsonl": verdicts,
        "metadata.jsonl": [metadata[key].model_dump(mode="json") for key in sorted(metadata)],
        "split.json": split,
        "lineage.json": {
            "trajectories_sha256": file_hash(trajectory_path), "metadata_sha256": file_hash(metadata_path),
            "split_sha256": file_hash(split_path), "public_count": len(public),
            "endpoint_goals_imported": False, "model_input_field": "input",
        },
    }, parquet=parquet)


def select_pilot(public: list[dict[str, Any]], *, count: int = 100, audit_count: int = 20, seed: int = 42, diagnostics: Mapping[str, dict[str, bool]] | None = None) -> dict[str, Any]:
    if not 0 < audit_count <= count:
        raise ValueError("Audit count must be positive and no larger than pilot")
    rows = [row for row in public if row["split"] == "train"]
    if len({row["checkpoint_id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate checkpoint")
    if len(rows) < count:
        raise ValueError("Insufficient training checkpoints; do not silently shrink the pilot")
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in sorted(rows, key=lambda item: _stable(seed, item["checkpoint_id"])):
        buckets[(row["benchmark"], row["domain"])].append(row)
    selected = []
    while len(selected) < count:
        for key in sorted(buckets):
            if buckets[key] and len(selected) < count:
                selected.append(buckets[key].pop())
    ordered = sorted(selected, key=lambda item: _stable(seed + 1, item["checkpoint_id"]))
    random_count = audit_count // 2
    random_ids = {row["checkpoint_id"] for row in ordered[:random_count]}
    audits = [{"checkpoint_id": row["checkpoint_id"], "reason": "seeded_random"} for row in ordered[:random_count]]
    used = set(random_ids)
    diagnostics = diagnostics or {}
    for flag, quota in (("disagreement", (audit_count - random_count) // 2), ("ambiguous", audit_count - random_count - (audit_count - random_count) // 2)):
        preferred = [row for row in ordered if row["checkpoint_id"] not in used and diagnostics.get(row["checkpoint_id"], {}).get(flag) is True]
        remainder = [row for row in ordered if row["checkpoint_id"] not in used and row not in preferred]
        for row in (preferred + remainder)[:quota]:
            key = row["checkpoint_id"]
            audits.append({"checkpoint_id": key, "reason": flag if diagnostics.get(key, {}).get(flag) is True else f"{flag}_unavailable_seeded_fallback"})
            used.add(key)
    return {
        "schema_version": VERSION, "seed": seed, "pilot_count": count, "audit_count": audit_count,
        "checkpoints": [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"]} for row in selected],
        "audit": audits, "diagnostics_hash": hash_v1(dict(diagnostics)),
        "annotation_inputs": [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"], "request_revision": row["request_revision"], "input": row["input"]} for row in selected],
    }


class SourceReference(Record):
    source_id: str
    pointer: str = ""
    value_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class GroundedConstraint(Record):
    text: str = Field(min_length=1)
    sources: tuple[SourceReference, ...] = Field(min_length=1)


class GroundedGoal(Record):
    action: Literal["retrieve", "compare", "explain", "diagnose", "modify", "transact", "communicate", "unknown"]
    object_type: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    sources: tuple[SourceReference, ...] = Field(min_length=1)
    constraints: tuple[GroundedConstraint, ...] = ()


class GoalAnnotation(Record):
    checkpoint_id: str
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    request_revision: str
    annotation_version: str = Field(min_length=1)
    teacher_model: str = Field(min_length=1)
    goals: tuple[GroundedGoal, ...] = Field(max_length=3)
    unknown_probability: float = Field(ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def distribution(self) -> GoalAnnotation:
        if not math.isclose(sum(goal.confidence for goal in self.goals) + self.unknown_probability, 1.0, abs_tol=1e-6):
            raise ValueError("Goal and unknown probabilities must sum to one")
        return self


def _pointer(value: Any, pointer: str) -> Any:
    if pointer == "":
        return value
    if not pointer.startswith("/"):
        raise ValueError("Source pointer must be a JSON pointer")
    for token in pointer[1:].split("/"):
        if "~" in token.replace("~1", "").replace("~0", ""):
            raise ValueError("Invalid JSON pointer escape")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list) and token.isdigit() and str(int(token)) == token:
            value = value[int(token)]
        elif isinstance(value, dict):
            value = value[token]
        else:
            raise ValueError("Source pointer does not resolve")
    return value


def validate_annotation(annotation: GoalAnnotation, public: dict[str, Any]) -> dict[str, Any]:
    if annotation.checkpoint_id != public["checkpoint_id"] or annotation.input_hash != hash_v1(public["input"]) or annotation.input_hash != public["input_hash"]:
        raise ValueError("Annotation public input identity mismatch")
    if annotation.request_revision != public["request_revision"]:
        raise ValueError("Stale annotation request revision")
    sources = {source["id"]: source["value"] for source in public["input"]["sources"]}
    if len(sources) != len(public["input"]["sources"]):
        raise ValueError("Duplicate visible source ID")
    for goal in annotation.goals:
        refs = [*goal.sources, *(source for constraint in goal.constraints for source in constraint.sources)]
        for ref in refs:
            try:
                value = _pointer(sources[ref.source_id], ref.pointer)
            except (KeyError, IndexError, TypeError) as error:
                raise ValueError("Annotation refers to a non-visible source") from error
            if hash_v1(value) != ref.value_hash:
                raise ValueError("Annotation source value changed")
    return {"checkpoint_id": annotation.checkpoint_id, "provenance_valid": True, "semantic_correctness": "not_established_by_source_validation"}


def bind_annotation_draft(draft: dict[str, Any], public: dict[str, Any], *, teacher_model: str, annotation_version: str) -> GoalAnnotation:
    """Server fills hashes and identity; a teacher selects opaque source paths only."""
    if set(draft) != {"goals", "unknown_probability"}:
        raise ValueError("Teacher draft must contain only goals and unknown_probability")
    sources = {source["id"]: source["value"] for source in public["input"]["sources"]}

    def bind_reference(reference: dict[str, Any]) -> dict[str, Any]:
        if set(reference) - {"source_id", "pointer"} or "source_id" not in reference:
            raise ValueError("Teacher must select a source, not generate a source hash")
        pointer = reference.get("pointer", "")
        try:
            value = _pointer(sources[reference["source_id"]], pointer)
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("Teacher source is outside the current public input") from error
        return {"source_id": reference["source_id"], "pointer": pointer, "value_hash": hash_v1(value)}

    goals = []
    for goal in draft["goals"]:
        if set(goal) - {"action", "object_type", "objective", "confidence", "sources", "constraints"}:
            raise ValueError("Unknown teacher goal field")
        constraints = []
        for constraint in goal.get("constraints", []):
            if set(constraint) != {"text", "sources"}:
                raise ValueError("Invalid teacher constraint")
            constraints.append({"text": constraint["text"], "sources": [bind_reference(ref) for ref in constraint["sources"]]})
        goals.append({**goal, "sources": [bind_reference(ref) for ref in goal["sources"]], "constraints": constraints})
    annotation = GoalAnnotation.model_validate({
        "checkpoint_id": public["checkpoint_id"], "input_hash": public["input_hash"],
        "request_revision": public["request_revision"], "teacher_model": teacher_model,
        "annotation_version": annotation_version, "goals": goals,
        "unknown_probability": draft["unknown_probability"],
    })
    validate_annotation(annotation, public)
    return annotation


def audit_gate(pilot: dict[str, Any], audits: list[dict[str, Any]]) -> dict[str, Any]:
    expected = {row["checkpoint_id"] for row in pilot["audit"]}
    actual = {row["checkpoint_id"] for row in audits}
    if expected != actual or len(audits) != len(actual):
        raise ValueError("Every selected human audit must be completed exactly once")
    for row in audits:
        if not row.get("reviewer") or not row.get("rubric_version") or type(row.get("semantics_acceptable")) is not bool or type(row.get("unsupported_binding")) is not bool:
            raise ValueError("Human audit requires attributed rubric decisions")
    acceptable = sum(row["semantics_acceptable"] for row in audits)
    unsupported = sum(row["unsupported_binding"] for row in audits)
    return {"audited": len(audits), "acceptable": acceptable, "unsupported_bindings": unsupported, "goal_conditioning_allowed": unsupported == 0 and acceptable / len(audits) >= 0.9, "limitation": "Small pilot audit, not a semantic confidence interval"}


def build_memory(trajectories: list[Trajectory], metadata: Mapping[str, EpisodeMeta], split: dict[str, Any], *, eligible_episode_ids: set[str] | None = None) -> dict[str, Any]:
    verify_split(split, trajectories, metadata)
    partitions: dict[str, list[Trajectory]] = defaultdict(list)
    episodes, exclusions, transitions = [], [], defaultdict(lambda: {"observed_success": 0, "observed_failure": 0, "families": set()})
    for trajectory in trajectories:
        meta = metadata[trajectory.trajectory_id]
        if eligible_episode_ids is not None and trajectory.trajectory_id not in eligible_episode_ids:
            exclusions.append({"episode_id": trajectory.trajectory_id, "reason": "not_positive_endpoint_eligible"})
            continue
        if split["families"][meta.family_id] != "train":
            exclusions.append({"episode_id": trajectory.trajectory_id, "reason": "not_training"})
            continue
        if meta.verification_tier not in VERIFIED_TIERS:
            exclusions.append({"episode_id": trajectory.trajectory_id, "reason": "not_independently_verified"})
            continue
        compatibility = {
            "scope": meta.scope.model_dump(mode="json"), "environment_version": meta.environment_version,
            "tool_schema_hash": meta.tool_schema_hash, "verification_tier": meta.verification_tier,
            "license": meta.license, "source_revision": meta.source_revision,
        }
        key = hash_v1(compatibility)
        # Endpoint labels from historical task definitions never become requested goals.
        sanitized = trajectory.model_copy(update={"outcome": trajectory.outcome.model_copy(update={"goal": None})}, deep=True)
        for event in sanitized.events:
            _public_event(event)
        partitions[key].append(sanitized)
        episodes.append({"episode_id": trajectory.trajectory_id, "family_id": meta.family_id, "compatibility_key": key, "compatibility": compatibility, "policy": trajectory.policy, "tools": public_context(trajectory)["tools"], "events": [_public_event(event) for event in trajectory.events], "outcome": trajectory.outcome.model_dump(mode="json", exclude={"goal"})})
        previous = "START"
        for event in trajectory.events:
            if event.kind == "tool_result":
                transition_key = (key, previous, event.tool)
                counts = transitions[transition_key]
                counts["observed_success" if event.status == "success" else "observed_failure"] += 1
                counts["families"].add(meta.family_id)
                previous = f"{event.tool}:{event.status}"
    pools = []
    for key, values in sorted(partitions.items()):
        pool = fit_patterns(values, max_context=3, min_support=2)
        read_names = {tool.name for value in values for tool in value.initial_tools if tool.side_effects == "read_only" and tool.cacheable}
        document = pool.model_dump(mode="json")
        document["patterns"] = [pattern for pattern in document["patterns"] if pattern["tool"] in read_names and pattern["goal_id"] is None]
        pools.append({"compatibility_key": key, "pattern_pool": document})
    document = {
        "schema_version": VERSION, "frozen": True, "split_hash": hash_v1(split),
        "training_families": sorted({episode["family_id"] for episode in episodes}),
        "episodes": sorted(episodes, key=lambda row: row["episode_id"]), "pattern_partitions": pools,
        "transitions": [{"compatibility_key": key[0], "previous": key[1], "next_tool": key[2], "observed_success": counts["observed_success"], "observed_failure": counts["observed_failure"], "family_support": len(counts["families"])} for key, counts in sorted(transitions.items())],
        "prediction_misses": [], "confusions": [], "exclusions": exclusions,
        "notes": ["No prediction misses invented from demand-only traces", "Historical endpoints excluded from requested-goal labels", "Patterns require current-source binding at execution"],
    }
    return {**document, "snapshot_hash": hash_v1(document)}
