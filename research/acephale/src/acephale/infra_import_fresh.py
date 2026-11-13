"""Publish a closed, fixed-Qwen collection as causal replay and runtime memory inputs.

No model calls occur here. Declared failures remain in the dataset and verified
task failures enter contrastive runtime memory. Positive pattern mining uses only
successful training endpoints with measured zero violations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PureWindowsPath
from typing import Any

from acephale.adapters.tau import TAU_REVISION, PublicContext, _events
from acephale.contracts_v1 import hash_v1
from acephale.infra_data import (
    VERSION,
    EpisodeMeta,
    Scope,
    _public_check,
    build_memory,
    canonical,
    export_rows,
    public_context,
    publish_bundle,
    read_jsonl,
    select_pilot,
    verify_bundle,
)
from acephale.native_common import READS
from acephale.schemas import Outcome, ToolContract, TraceProvenance, Trajectory
from acephale.storage import file_hash

ACTOR = {"repository": "Qwen/Qwen3.5-9B", "revision": "c202236235762e1c871ad0ccb60c8ee5ba337b9a"}
LINEAGE_VERSION = "acephale-infra-fresh-native-v1"
MULTI_COHORT_VERSION = "acephale-infra-fresh-native-v2"
AUXILIARY_DEVELOPMENT = "auxiliary-development-validation"


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


def _read_fresh_cohort(cohort: Path) -> dict[str, Any]:
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
        if independently_verified and verdict["passed"] != success:
            raise ValueError("Fresh verdict contradicts the recorded outcome")
        if success and (not independently_verified or verdict["passed"] is not True or not messages):
            raise ValueError("Fresh success requires independent endpoint evidence and public messages")
        termination = row.get("termination")
        if not isinstance(termination, str) or not termination or not isinstance(row.get("success"), bool):
            raise ValueError("Fresh outcome requires explicit success and termination")
        censored = bool(re.search(r"budget|censor|deadline|timeout|cancel|provider|transport|host|execution_error|not_started", termination, re.IGNORECASE))
        eligible = success and independently_verified and type(violations) is int and violations == 0 and not censored
        contrastive = independently_verified and not success and type(violations) is int and violations >= 0 and not censored
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
            captured_before_execution=True, verification_tier="native_verified" if independently_verified else "source_reported",
            license="MIT", source_revision=TAU_REVISION,
        )
        trajectories.append(trajectory)
        runtime_rows.append({"id": key, "familyId": family, "split": families[family], "scope": scope,
                             "policyHash": hash_v1(context.policy), "success": success,
                             "outcomeVerified": independently_verified, "constraintViolations": violations,
                             "memoryEligible": eligible and families[family] == "train", "termination": termination,
                             "contrastiveEligible": contrastive and families[family] == "train",
                             "outcomeClass": "success" if eligible else "task_failure" if contrastive else "censored_or_unknown",
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
    memory = build_memory(trajectories, metadata, split, eligible_episode_ids={row["id"] for row in runtime_rows if row["memoryEligible"]})
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
    final_receipt, final_inventory = _inventory(cohort)
    if final_receipt != receipt or final_inventory != inventory:
        raise ValueError("Fresh source changed during import")
    return files


def _publish_fresh(files: dict[str, Any], destination: Path, *, pilot_count: int | None,
                   audit_count: int, parquet: bool) -> dict[str, Any]:
    # The pilot binds the completed dataset hash. Publish it as a separate
    # sub-bundle to avoid a circular hash between the pilot and its source.
    pilot = select_pilot(files["public.jsonl"], count=pilot_count, audit_count=audit_count) if pilot_count is not None else None
    dataset = publish_bundle(destination, files, parquet=parquet)
    if pilot is not None:
        pilot["source_dataset_hash"] = dataset["bundle_hash"]
        pilot["source_split_hash"] = hash_v1(files["split.json"])
        publish_bundle(destination / "annotation-pilot", {
            "pilot.json": {key: value for key, value in pilot.items() if key != "annotation_inputs"},
            "annotation-inputs.jsonl": pilot["annotation_inputs"],
        }, parquet=parquet)
    return dataset


def import_fresh(cohort: Path, destination: Path, *, pilot_count: int | None = None, audit_count: int = 20, parquet: bool = False) -> dict[str, Any]:
    return _publish_fresh(_read_fresh_cohort(cohort), destination, pilot_count=pilot_count,
                          audit_count=audit_count, parquet=parquet)


def import_fresh_cohorts(cohorts: list[Path], destination: Path, *, pilot_count: int | None = None,
                         audit_count: int = 20, parquet: bool = False,
                         parent_bundles: list[Path] | None = None) -> dict[str, Any]:
    """Join closed base cohorts without rewriting their identities or paired slots.

    Additional cohorts are explicitly declared auxiliary development collection.
    Their observations validate calibration and never supply fitting memory.
    """
    if len(cohorts) < 2 or len({path.resolve() for path in cohorts}) != len(cohorts):
        raise ValueError("Multiple distinct closed cohort directories are required")
    parts = [_read_fresh_cohort(path) for path in cohorts]
    configurations = [_json(path / "configuration.json") for path in cohorts]
    manifests = [_json(path / "manifest.json") for path in cohorts]
    policy = parts[0]["split.json"]["declared_family_policy"]
    if any(part["split.json"]["declared_family_policy"] != policy for part in parts):
        raise ValueError("Cohorts must preserve the same predeclared family policy")
    if any(manifest["actor"] != manifests[0]["actor"] for manifest in manifests):
        raise ValueError("Cohorts must use the exact same fixed actor configuration")
    if any(config["taskBundleHash"] != configurations[0]["taskBundleHash"] for config in configurations):
        raise ValueError("Cohorts must use the same predeclared task bundle")
    if any(config.get("collectionPurpose") != AUXILIARY_DEVELOPMENT
           or config.get("hosted", {}).get("allocation") != "development"
           or any(policy[run["familyId"]] != "development" for run in config["runs"])
           for config in configurations[1:]):
        raise ValueError("Additional cohorts require explicit auxiliary development collection")
    # An auxiliary run is not a replacement for any paired development base arm.
    trials, episodes, checkpoints, domains = set(), set(), set(), {}
    for config, part in zip(configurations, parts, strict=True):
        for run in config["runs"]:
            identity = (run["domain"], run["taskId"], run["seed"])
            if identity in trials or run["runId"] in episodes:
                raise ValueError("Repeated trial or episode across closed cohorts")
            trials.add(identity)
            episodes.add(run["runId"])
        for row in part["public.jsonl"]:
            if row["checkpoint_id"] in checkpoints:
                raise ValueError("Repeated public checkpoint across closed cohorts")
            checkpoints.add(row["checkpoint_id"])
            contract = hash_v1({"policy": row["input"]["policy"], "tools": row["input"]["tools"],
                                "scope": row["scope"], "environment": row["environment_version"]})
            if domains.setdefault(row["domain"], contract) != contract:
                raise ValueError("Native public domain contract differs across cohorts")
    combined = {name: [row for part in parts for row in part[name]] for name in (
        "public.jsonl", "labels.jsonl", "verdicts.jsonl", "metadata.jsonl", "trajectories.jsonl", "runtime-runs.jsonl")}
    metadata = {row["episode_id"]: EpisodeMeta.model_validate(row) for row in combined["metadata.jsonl"]}
    trajectories = [Trajectory.model_validate(row) for row in combined["trajectories.jsonl"]]
    split = {**parts[0]["split.json"], "method": "preserved-fresh-infra-multiple-closed-cohorts-v2",
             "families": {family: policy[family] for family in sorted({row.group_id for row in trajectories})},
             "episodes": {row.trajectory_id: row.group_id for row in trajectories},
             "metadata_hash": hash_v1([metadata[key].model_dump(mode="json") for key in sorted(metadata)])}
    combined["split.json"] = split
    combined["memory.json"] = build_memory(trajectories, metadata, split,
        eligible_episode_ids={row["id"] for row in combined["runtime-runs.jsonl"] if row["memoryEligible"]})
    parents, source_map, episode_cohorts = [], {}, {}
    for path, config, manifest, part in zip(cohorts, configurations, manifests, parts, strict=True):
        lineage, receipt = part["lineage.json"], part["cohort-receipt.json"]
        cohort_id = hash_v1(receipt)
        run_ids = [run["runId"] for run in config["runs"]]
        parents.append({"cohortId": cohort_id, "receiptSha256": lineage["cohort_receipt_sha256"], "receipt": receipt,
                        "receiptText": (path / "cohort-receipt.json").read_bytes().decode("utf-8"),
                        "configuration": config, "manifest": manifest, "runIds": run_ids,
                        "purpose": config.get("collectionPurpose", "original-base-collection")})
        for key, source in lineage["fresh_sources"].items():
            source_map[key] = {**source, "cohort_id": cohort_id}
            episode_cohorts[key] = cohort_id
        # Recheck every original artifact after parsing all cohorts.
        if (_inventory(path) != (receipt, lineage["cohort_files"])
                or file_hash(path / "cohort-receipt.json") != lineage["cohort_receipt_sha256"]):
            raise ValueError("Fresh source changed during multi-cohort import")
    parent_datasets = []
    for directory in parent_bundles or []:
        original_manifest = verify_bundle(directory)
        original_lineage = _json(directory / "lineage.json")
        cohort_id = original_lineage.get("cohort_receipt_hash")
        matching = [part for part in parts if part["lineage.json"]["cohort_receipt_hash"] == cohort_id]
        if (len(matching) != 1 or original_lineage.get("version") != LINEAGE_VERSION
                or any(row["bundleHash"] == original_manifest["bundle_hash"] for row in parent_datasets)):
            raise ValueError("Parent dataset must be a unique original single-cohort import")
        part = matching[0]
        for name, expected in part.items():
            actual = read_jsonl(directory / name) if name.endswith(".jsonl") else _json(directory / name)
            if actual != expected:
                raise ValueError("Parent dataset differs from its original closed cohort")
        parent_datasets.append({"bundleHash": original_manifest["bundle_hash"], "manifest": original_manifest,
                                "cohortId": cohort_id, "split": part["split.json"],
                                "publicCheckpointIds": [row["checkpoint_id"] for row in part["public.jsonl"]]})
        if verify_bundle(directory) != original_manifest:
            raise ValueError("Parent dataset changed during multi-cohort import")
    receipt_body = {"version": 2, "kind": "acephale-fresh-native-multicohort", "closed": True,
                    "allDeclaredSlotsRetained": True, "pairedComparisonSlotsReused": False,
                    "cohorts": parents, "episodeCohorts": episode_cohorts, "parentDatasets": parent_datasets}
    aggregate = {**receipt_body, "contentHash": hash_v1(receipt_body)}
    combined["cohort-receipt.json"] = aggregate
    # This is a new aggregate receipt, not a relabeled execution receipt.
    lineage = {**parts[0]["lineage.json"], "version": MULTI_COHORT_VERSION,
               "label": "Closed base collection plus auxiliary development validation; no paired or heldout result",
               "cohort_receipt_hash": hash_v1(aggregate), "cohort_receipt_sha256": None,
               "fresh_sources": source_map, "cohort_files": None,
               "cohort_count": len(parents), "episodes": len(trajectories), "checkpoints": len(checkpoints),
               "training_checkpoints": sum(row["split"] == "train" for row in combined["public.jsonl"]),
               "endpoint_constraints_unknown": sum(row["constraintViolations"] is None for row in combined["runtime-runs.jsonl"])}
    # publish_bundle uses exactly this JSON encoding; bind the actual aggregate bytes.
    lineage["cohort_receipt_sha256"] = hashlib.sha256((canonical(aggregate) + "\n").encode("utf-8")).hexdigest()
    combined["lineage.json"] = lineage
    return _publish_fresh(combined, destination, pilot_count=pilot_count, audit_count=audit_count, parquet=parquet)


def verify_parent_audit_source(directory: Path, pilot: dict[str, Any]) -> dict[str, str]:
    """Reuse an unchanged audit only through its verified original dataset ancestry."""
    verify_bundle(directory)
    lineage = _json(directory / "lineage.json")
    aggregate = _json(directory / "cohort-receipt.json")
    if (lineage.get("version") != MULTI_COHORT_VERSION
            or aggregate.get("kind") != "acephale-fresh-native-multicohort"
            or aggregate.get("contentHash") != hash_v1({key: value for key, value in aggregate.items() if key != "contentHash"})
            or lineage.get("cohort_receipt_hash") != hash_v1(aggregate)
            or lineage.get("cohort_receipt_sha256") != file_hash(directory / "cohort-receipt.json")):
        raise ValueError("Human audit requires verified original parent dataset provenance")
    matches = [parent for parent in aggregate.get("parentDatasets", []) if parent.get("bundleHash") == pilot.get("source_dataset_hash")]
    if len(matches) != 1:
        raise ValueError("Human audit pilot is not a unique verified parent dataset")
    parent = matches[0]
    manifest, cohort_id = parent["manifest"], parent["cohortId"]
    if (manifest.get("bundle_hash") != parent["bundleHash"] or manifest["bundle_hash"] != hash_v1(manifest["files"])
            or sum(cohort.get("cohortId") == cohort_id for cohort in aggregate["cohorts"]) != 1):
        raise ValueError("Original audit dataset identity differs")
    public = [row for row in read_jsonl(directory / "public.jsonl") if aggregate["episodeCohorts"].get(row["episode_id"]) == cohort_id]
    encoded = "".join(canonical(row) + "\n" for row in public).encode("utf-8")
    encoded_split = (canonical(parent["split"]) + "\n").encode("utf-8")
    if ([row["checkpoint_id"] for row in public] != parent["publicCheckpointIds"]
            or hashlib.sha256(encoded).hexdigest() != manifest["files"]["public.jsonl"]["sha256"]
            or hashlib.sha256(encoded_split).hexdigest() != manifest["files"]["split.json"]["sha256"]
            or pilot.get("source_split_hash") != hash_v1(parent["split"])):
        raise ValueError("Original audited public checkpoint bytes or split changed")
    by_id = {row["checkpoint_id"]: row for row in public}
    for item in pilot.get("checkpoints", []):
        row = by_id.get(item["checkpoint_id"])
        if (row is None or row["input_hash"] != item.get("input_hash") or hash_v1(row["input"]) != row["input_hash"]
                or row["split"] != "train" or parent["split"]["families"].get(row["family_id"]) != "train"):
            raise ValueError("Original audit cannot move to changed or nontraining public inputs")
    return {"sourceDatasetHash": parent["bundleHash"], "aggregateReceiptHash": hash_v1(aggregate)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, action="append", required=True,
                        help="Closed base cohort; repeat only for explicitly declared auxiliary development cohorts")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--parent-bundle", type=Path, action="append",
                        help="Existing immutable single-cohort import whose audit provenance must remain usable")
    parser.add_argument("--pilot-count", type=int, help="Publish a dataset-bound pilot in OUTPUT/annotation-pilot")
    parser.add_argument("--audit-count", type=int, default=20)
    parser.add_argument("--parquet", action="store_true")
    args = parser.parse_args()
    importer = import_fresh if len(args.cohort) == 1 else import_fresh_cohorts
    if args.parent_bundle and len(args.cohort) == 1:
        parser.error("--parent-bundle requires explicit multi-cohort import")
    source = args.cohort[0] if len(args.cohort) == 1 else args.cohort
    options = {"parent_bundles": args.parent_bundle} if len(args.cohort) > 1 else {}
    print(json.dumps(importer(source, args.output, pilot_count=args.pilot_count, audit_count=args.audit_count, parquet=args.parquet, **options)))


if __name__ == "__main__":
    main()
