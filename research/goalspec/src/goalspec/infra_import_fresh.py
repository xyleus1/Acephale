"""Publish a closed, fixed-Qwen collection as causal replay and runtime memory inputs.

No model calls occur here. Declared failures remain in the dataset; only independently
verified successful training endpoints with measured zero violations enter memory.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path, PureWindowsPath
from typing import Any

from goalspec.adapters.tau import TAU_REVISION, PublicContext, _events
from goalspec.contracts_v1 import hash_v1
from goalspec.infra_data import (
    VERSION,
    EpisodeMeta,
    Scope,
    _public_check,
    build_memory,
    export_rows,
    public_context,
    publish_bundle,
    read_jsonl,
    select_pilot,
)
from goalspec.schemas import Outcome, ToolContract, TraceProvenance, Trajectory
from goalspec.storage import file_hash
from goalspec.training_export import READS

ACTOR = {"repository": "Qwen/Qwen3.5-9B", "revision": "c202236235762e1c871ad0ccb60c8ee5ba337b9a"}
LINEAGE_VERSION = "goalspec-infra-fresh-native-v1"


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Expected JSON object")
    return value


def _inventory(directory: Path) -> tuple[dict[str, Any], dict[str, str]]:
    receipt = _json(directory / "cohort-receipt.json")
    if receipt.get("version") != 1 or receipt.get("stage") != "collection":
        raise ValueError("Only versioned collection cohorts may enter fresh fitting inputs")
    if (receipt.get("closed") is not True or receipt.get("completed") is not True
            or receipt.get("allDeclaredSlotsRetained") is not True
            or type(receipt.get("serviceExitCode")) is not int or receipt["serviceExitCode"] != 0):
        raise ValueError("A closed cohort retaining every declared slot is required")
    inventory: dict[str, str] = {}
    for row in receipt.get("files", []):
        name = row["path"]
        if (not isinstance(name, str) or name in inventory or "\\" in name or Path(name).is_absolute()
                or PureWindowsPath(name).drive or ".." in Path(name).parts):
            raise ValueError("Unsafe or duplicate cohort artifact path")
        raw_path = directory / name
        path = raw_path.resolve()
        if path == directory.resolve() or directory.resolve() not in path.parents:
            raise ValueError("Unsafe or duplicate cohort artifact path")
        if raw_path.is_symlink() or not path.is_file() or file_hash(path) != row["sha256"]:
            raise ValueError("Cohort source hash mismatch")
        inventory[name] = row["sha256"]
    required = {"configuration.json", "manifest.json", "design.json", "public-contexts.json", "outcomes.jsonl", "tasks.json"}
    if not required <= inventory.keys():
        raise ValueError("Incomplete cohort receipt inventory")
    return receipt, inventory


def _runtime_messages(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for item in raw:
        if item.get("role") == "tool" and "tool_messages" in item:
            children = item["tool_messages"]
        else:
            children = [item]
        for message in children:
            role = message["role"]
            if role == "user" and message.get("tool_calls") or role == "tool" and message.get("requestor") == "user":
                continue
            if role not in {"user", "assistant", "tool"}:
                raise ValueError("Unexpected public message role")
            content = message.get("content")
            observation = None
            if role == "tool":
                try:
                    observation = json.loads(content) if content is not None else None
                except json.JSONDecodeError:
                    observation = content
            result.append({
                "index": len(result), "role": role, "content": content,
                "calls": [{"id": call["id"], "tool": call["name"], "arguments": call["arguments"]} for call in message.get("tool_calls") or []],
                "callId": message.get("id") if role == "tool" else None,
                "observation": observation,
            })
    _public_check(result)
    return result


def import_fresh(cohort: Path, destination: Path, *, pilot_count: int | None = None, audit_count: int = 20, parquet: bool = False) -> dict[str, Any]:
    receipt, inventory = _inventory(cohort)
    configuration, manifest, design = [_json(cohort / name) for name in ("configuration.json", "manifest.json", "design.json")]
    if receipt.get("configurationHash") != hash_v1(configuration) or receipt.get("manifestHash") != hash_v1(manifest):
        raise ValueError("Cohort configuration or manifest identity mismatch")
    if configuration.get("stage") != "collection" or design.get("stage") != "collection":
        raise ValueError("Only base collection may supply fresh training data")
    if any(manifest.get("actor", {}).get(key) != value for key, value in ACTOR.items()):
        raise ValueError("Fresh actor does not match the fixed Qwen pin")
    if manifest["data"]["environmentRevision"] != TAU_REVISION:
        raise ValueError("Fresh environment revision differs from the audited native pin")
    if configuration.get("taskBundleHash") != hash_v1(_json(cohort / "tasks.json")):
        raise ValueError("Fresh task bundle changed after declaration")
    declared = configuration["runs"]
    if not declared or design.get("runs") != declared or manifest["protocol"]["scheduleHash"] != hash_v1(declared):
        raise ValueError("Fresh predeclared schedule mismatch")
    families: dict[str, str] = {}
    for key, partition in (("trainingFamilies", "train"), ("developmentFamilies", "development"), ("heldoutFamilies", "test")):
        if design.get(key) != manifest["data"][key]:
            raise ValueError("Fresh predeclared family policy changed")
        for family in design[key]:
            if family in families:
                raise ValueError("Family contamination between frozen partitions")
            families[family] = partition
    outcomes_list = read_jsonl(cohort / "outcomes.jsonl")
    outcomes = {row["runId"]: row for row in outcomes_list}
    if len(outcomes) != len(outcomes_list) or len({row["runId"] for row in declared}) != len(declared) or set(outcomes) != {row["runId"] for row in declared}:
        raise ValueError("Every declared slot, including failures, must be retained exactly once")
    contexts = _json(cohort / "public-contexts.json")
    if set(contexts) != set(outcomes):
        raise ValueError("Every declared slot requires a pre-execution public capture")
    trajectories, runtime_rows, metadata, sources = [], [], {}, {}
    for configured in declared:
        key = configured["runId"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", key) or f"{key}.json" not in inventory:
            raise ValueError("Unsafe or unrecorded raw run artifact")
        row, captured, raw = outcomes[key], contexts[key], _json(cohort / f"{key}.json")
        if any(row.get(field) != configured.get(field) for field in ("runId", "taskId", "familyId", "domain", "arm", "seed")) or raw.get("record") != row:
            raise ValueError("Fresh outcome differs from the declared slot")
        domain, family = configured["domain"], configured["familyId"]
        if domain not in READS or configured["arm"] != "base" or families.get(family) not in {"train", "development"}:
            raise ValueError("Fresh collection must be base-only with heldout families excluded")
        if captured.get("capturedBeforeExecution") is not True or captured.get("tools") != configured["tools"]:
            raise ValueError("Fresh public capture is missing or has changed tools")
        tools = tuple(ToolContract(
            name=tool["function"]["name"], description=tool["function"].get("description", ""),
            parameters=tool["function"]["parameters"], version=TAU_REVISION,
            side_effects="read_only" if tool["function"]["name"] in READS[domain] else "unknown",
            cacheable=tool["function"]["name"] in READS[domain],
            freshness="state_epoch" if tool["function"]["name"] in READS[domain] else "unverifiable",
        ) for tool in captured["tools"])
        context = PublicContext(policy=captured["policy"], tools=tools, system_messages=(captured["policy"],))
        messages = (raw.get("simulation") or {}).get("messages", [])
        verdict = raw.get("verdict") or {}
        violations = verdict.get("constraintViolations")
        independently_verified = verdict.get("evaluationValid") is True and isinstance(verdict.get("passed"), bool)
        success = row.get("success") is True
        if success and (not independently_verified or verdict["passed"] is not True or not messages):
            raise ValueError("Fresh success requires independent endpoint evidence and public messages")
        eligible = success and independently_verified and type(violations) is int and violations == 0
        termination = row.get("termination")
        if not isinstance(termination, str) or not termination or not isinstance(row.get("success"), bool):
            raise ValueError("Fresh outcome requires explicit success and termination")
        trajectory = Trajectory(
            trajectory_id=key, benchmark="custom-tau", domain=domain, task_id=configured["taskId"],
            group_id=family, trial=row.get("trial", 0), source_kind="benchmark", benchmark_revision=TAU_REVISION,
            policy=context.policy, initial_tools=tools, events=_events(messages, context),
            outcome=Outcome(status="completed" if success else "failed", success=success,
                            native_reward=verdict.get("officialReward"), evaluator_version=verdict.get("evaluatorVersion", "unavailable"),
                            native_termination_reason=termination),
            provenance=TraceProvenance(actor_model=ACTOR["repository"], actor_config_hash=hash_v1(manifest["actor"]),
                                       run_config_hash=inventory["design.json"], trial_seed=configured["seed"],
                                       raw_results_hash=inventory[f"{key}.json"], public_context_hash=hash_v1(captured)),
            total_elapsed_ms=row.get("elapsedMs", row.get("latencyMs")),
        )
        projection = public_context(trajectory)
        scope = {"tenantId": f"custom-tau-{domain}", "principalId": "native-actor", "authorizationVersion": "native-v1",
                 "environmentVersion": TAU_REVISION, "toolSchemaHash": hash_v1(captured["tools"])}
        metadata[key] = EpisodeMeta(
            episode_id=key, family_id=family,
            scope=Scope(tenant_id=scope["tenantId"], principal_id=scope["principalId"], authorization_revision=scope["authorizationVersion"]),
            request_revision=hash_v1([key, hash_v1(captured)]), environment_version=TAU_REVISION,
            tool_schema_hash=hash_v1(projection["tools"]), public_context_hash=hash_v1(projection),
            captured_before_execution=True, verification_tier="native_verified" if eligible else "source_reported",
            license="MIT", source_revision=TAU_REVISION,
        )
        trajectories.append(trajectory)
        runtime_rows.append({"id": key, "familyId": family, "split": families[family], "scope": scope,
                             "policyHash": hash_v1(context.policy), "success": success,
                             "outcomeVerified": independently_verified, "constraintViolations": violations,
                             "memoryEligible": eligible and families[family] == "train", "termination": termination,
                             "messages": _runtime_messages(messages), "rawSha256": inventory[f"{key}.json"]})
        sources[key] = {"raw_sha256": inventory[f"{key}.json"], "original_public_capture_hash": hash_v1(captured),
                        "original_tool_schema_hash": scope["toolSchemaHash"]}
    split = {"schema_version": VERSION, "seed": None, "method": "preserved-fresh-infra-predeclared-family-policy",
             "families": {family: families[family] for family in sorted({row.group_id for row in trajectories})},
             "episodes": {row.trajectory_id: row.group_id for row in trajectories},
             "metadata_hash": hash_v1([metadata[key].model_dump(mode="json") for key in sorted(metadata)]),
             "fresh_heldout": False, "declared_family_policy": families}
    public, labels, verdicts = export_rows(trajectories, metadata, split)
    for checkpoint in public:
        checkpoint["runtime_tool_schema_hash"] = sources[checkpoint["episode_id"]]["original_tool_schema_hash"]
    memory = build_memory(trajectories, metadata, split)
    lineage = {"version": LINEAGE_VERSION, "fresh_qwen_traces": True, "fresh_heldout": False,
               "label": "Fresh fixed-Qwen base collection; no heldout result or latency-improvement claim",
               "actor": ACTOR, "cohort_receipt_sha256": file_hash(cohort / "cohort-receipt.json"), "cohort_receipt_hash": hash_v1(receipt),
               "cohort_files": inventory, "fresh_sources": sources,
               "all_declared_slots_retained": True, "episodes": len(trajectories), "checkpoints": len(public),
               "training_checkpoints": sum(row["split"] == "train" for row in public),
               "teacher_annotations_completed": 0, "human_audits_completed": 0,
               "endpoint_constraints_unknown": sum(row["constraintViolations"] is None for row in runtime_rows)}
    files = {"public.jsonl": public, "labels.jsonl": labels, "verdicts.jsonl": verdicts,
             "metadata.jsonl": [metadata[key].model_dump(mode="json") for key in sorted(metadata)],
             "trajectories.jsonl": [row.model_dump(mode="json") for row in trajectories],
             "split.json": split, "memory.json": memory, "runtime-runs.jsonl": runtime_rows,
             "lineage.json": lineage, "cohort-receipt.json": receipt}
    # The pilot binds the completed dataset hash. Publish it as a separate
    # sub-bundle to avoid a circular hash between the pilot and its source.
    pilot = select_pilot(public, count=pilot_count, audit_count=audit_count) if pilot_count is not None else None
    # Verify source bytes again before publishing an immutable completion marker.
    final_receipt, final_inventory = _inventory(cohort)
    if final_receipt != receipt or final_inventory != inventory:
        raise ValueError("Fresh source changed during import")
    dataset = publish_bundle(destination, files, parquet=parquet)
    if pilot is not None:
        pilot["source_dataset_hash"] = dataset["bundle_hash"]
        pilot["source_split_hash"] = hash_v1(split)
        publish_bundle(destination / "annotation-pilot", {
            "pilot.json": {key: value for key, value in pilot.items() if key != "annotation_inputs"},
            "annotation-inputs.jsonl": pilot["annotation_inputs"],
        }, parquet=parquet)
    return dataset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pilot-count", type=int, help="Publish a dataset-bound pilot in OUTPUT/annotation-pilot")
    parser.add_argument("--audit-count", type=int, default=20)
    parser.add_argument("--parquet", action="store_true")
    args = parser.parse_args()
    print(json.dumps(import_fresh(args.cohort, args.output, pilot_count=args.pilot_count, audit_count=args.audit_count, parquet=args.parquet)))


if __name__ == "__main__":
    main()
