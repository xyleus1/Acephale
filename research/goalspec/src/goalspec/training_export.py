"""Export verified native episodes with causal prefixes and immutable verifier lineage."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from goalspec.adapters.tau import PublicContext, _events
from goalspec.contracts_v1 import hash_v1
from goalspec.fresh_tasks import NATIVE_COMMIT, VERSION
from goalspec.replay import decision_points
from goalspec.schemas import GoalSignature, Outcome, ToolContract, TraceProvenance, Trajectory

READS = {
    "retail": {"find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"},
    "airline": {"get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"},
}


def _file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def export_native(source: Path, fixture_manifest: Path, destination: Path, phase="train"):
    if phase not in {"train", "development", "heldout"}:
        raise ValueError("Unknown native export phase")
    contexts = json.loads((source / "public-contexts.json").read_text(encoding="utf-8"))
    fixture_document = json.loads(fixture_manifest.read_text(encoding="utf-8"))
    fixtures = {record["taskId"]: record for record in fixture_document["tasks"]}
    generator = fixture_document.get("generator", VERSION)
    if generator not in {VERSION, "fresh-native-v4", "fresh-native-v5"}:
        raise ValueError("Unknown native fixture generator lineage")
    # V5 composes v1 primitives and still executes the v1 independent verifier.
    # Its additional preflight checks have separate lineage, not a new verdict.
    generator_file = "fresh_tasks.py" if generator == VERSION else generator.replace("fresh-native-", "fresh_tasks_") + ".py"
    lineage = {"generatorVersion": generator, "generatorCodeHash": _file_hash(Path(__file__).with_name(generator_file)),
               "verifierCodeHash": _file_hash(Path(__file__).with_name("fresh_tasks.py")),
               "preflightCodeHashes": {name: _file_hash(Path(__file__).with_name(name))
                                        for name in dict.fromkeys(["fresh_tasks.py", generator_file])}}
    all_rows = [json.loads(line) for line in (source / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]
    design = json.loads((source / "design.json").read_text(encoding="utf-8"))
    def slot(row):
        return row.get("family", row.get("familyId")), row["variant"], row["trial"], row["arm"]
    if len(all_rows) != len(design["trials"]) or {slot(row) for row in all_rows} != {slot(row) for row in design["trials"]}:
        raise ValueError("Every frozen trial, including failures, must exist before exporting")
    if any(fixtures[row["taskId"]]["split"] != phase for row in all_rows):
        raise ValueError("Source outcomes cross the requested family split")
    if any(row["arm"] not in {"base", "neutral_memory_prefetch", "goalspec"} for row in all_rows):
        raise ValueError("Unknown native evaluation arm")
    rows = [row for row in all_rows if row["arm"] == "base"]
    if not rows or (phase == "train" and len(rows) != len(all_rows)):
        raise ValueError("Training must be base-only; canonical replay requires base trajectories")
    if len({row["runId"] for row in all_rows}) != len(all_rows):
        raise ValueError("Repeated native run")
    destination.mkdir(parents=True, exist_ok=False)
    trajectories, mining, metadata, verdicts = [], [], [], []
    dataset_id = "fresh-native-" + phase + ":" + _file_hash(source / "outcomes.jsonl")[:20]
    verifier_hash = _file_hash(Path(__file__).with_name("fresh_tasks.py"))
    for row in rows:
        fixture = fixtures[row["taskId"]]
        if fixture["split"] != phase or row["arm"] != "base":
            raise ValueError("Canonical exports must preserve their declared split and base actor")
        run_id = row["runId"]
        path = source / f"{run_id}.json"
        artifact = json.loads(path.read_text(encoding="utf-8"))
        verdict = artifact.get("verdict")
        independent_check = artifact.get("independentCheck")
        verified = isinstance(verdict, dict)
        verifier_version = (verdict.get("verifierVersion") or (independent_check or {}).get("evaluatorVersion") or "unknown") if verified else "unavailable"
        if artifact["record"] != row or row.get("fixtureHash", fixture["fixtureHash"]) != fixture["fixtureHash"]:
            raise ValueError("Native outcome provenance mismatch")
        if row["success"] and (not verified or not verdict.get("success") or not artifact.get("simulation")):
            raise ValueError("Successful native outcome requires a completed independent verdict and transcript")
        captured = contexts[run_id]
        if captured["capturedBeforeExecution"] is not True:
            raise ValueError("Public tools/policy not captured before execution")
        tools = tuple(ToolContract(name=tool["function"]["name"], description=tool["function"].get("description", ""),
                                   parameters=tool["function"]["parameters"], version=NATIVE_COMMIT,
                                   side_effects="read_only" if tool["function"]["name"] in READS[row["domain"]] else "unknown",
                                   cacheable=tool["function"]["name"] in READS[row["domain"]],
                                   freshness="state_epoch" if tool["function"]["name"] in READS[row["domain"]] else "unverifiable")
                      for tool in captured["tools"])
        context = PublicContext(policy=captured["policy"], tools=tools, system_messages=(captured["policy"],))
        endpoint = "+".join(sorted({action["name"] for action in fixture["referenceActions"]})) or "informational_response"
        goal = GoalSignature(goal_id=row["domain"] + ":endpoint:" + endpoint, objective=endpoint,
                             object_type=row["domain"], completion=("independently verified final state and requested factual response",),
                             constraints=("explicit confirmation before mutations", "preserve unrelated state"))
        trajectory = Trajectory(trajectory_id=run_id, benchmark="custom-tau", domain=row["domain"], task_id=row["taskId"],
                                group_id=row["familyId"], trial=row["trial"], source_kind="synthetic", benchmark_revision=NATIVE_COMMIT,
                                policy=context.policy, initial_tools=tools, events=_events(artifact.get("simulation", {}).get("messages", []), context),
                                outcome=Outcome(status="completed" if row["success"] else "failed", success=row["success"], goal=goal,
                                                native_reward=None, evaluator_version=verifier_version,
                                                native_termination_reason=row["termination"], native_excluded_from_success=row["budget_terminated"]),
                                provenance=TraceProvenance(actor_model="gpt-5.4-2026-03-05", user_model="gpt-4.1-mini-2025-04-14",
                                                           actor_config_hash=hash_v1({"model": "gpt-5.4-2026-03-05", "reasoning": "medium", "outputCap": 4096}),
                                                           user_config_hash=hash_v1({"model": "gpt-4.1-mini-2025-04-14", "outputCap": 1024}),
                                                           run_config_hash=_file_hash(source / "design.json"), trial_seed=row["seed"],
                                                           raw_results_hash=_file_hash(path), public_context_hash=hash_v1(captured),
                                                           endpoint_labels_hash=hash_v1(independent_check) if independent_check is not None else None), total_elapsed_ms=row.get("latencyMs"))
        trajectories.append(trajectory.model_dump(mode="json"))
        checkpoints = []
        for point in decision_points(trajectory):
            prefix = point.prefix
            checkpoints.append({"prefix": {"events": [event.model_dump(mode="json") for event in prefix.events],
                                           "throughSeq": prefix.through_seq, "signatures": list(prefix.signatures),
                                           "tools": [{"name": tool.name, "parameters": tool.parameters} for tool in prefix.tools]},
                                "targets": [{"tool": target.tool, "arguments": target.arguments} for target in point.targets]})
        mining.append({"id": run_id, "family": row["familyId"], "benchmark": "custom-tau", "domain": row["domain"],
                       "canonicalGoalId": goal.goal_id, "verifiedSuccess": row["success"], "checkpoints": checkpoints})
        metadata.append({"id": run_id, "datasetId": dataset_id, "sourceId": row["taskId"], "domain": row["domain"], "familyId": row["familyId"],
                         "split": "test" if phase == "heldout" else phase, "environmentVersion": NATIVE_COMMIT, "toolSchemaHash": hash_v1(captured["tools"]),
                         "verificationTier": "native_verified" if verified else "source_reported", "transcriptUri": str(path.resolve()), "contentHash": _file_hash(path),
                         "metadata": {"success": row["success"], "fixtureHash": fixture["fixtureHash"], "trialSeed": row["seed"],
                                      "verifierAvailable": verified, "learningSplit": fixture.get("learningSplit"), "verifierLineage": lineage,
                                      "initialRequest": fixture["initialRequest"], "endpointGoal": goal.model_dump(mode="json"),
                                      "requestedGoalAnnotation": None, "label": "custom tau-compatible pilot"}})
        if verified:
            verdicts.append({"episodeId": run_id, "verifierVersion": verifier_version, "verifierCodeHash": verifier_hash,
                             "evidenceHash": _file_hash(path), "evidenceUri": str(path.resolve()), "success": row["success"],
                             "constraintsSatisfied": row.get("constraintViolations") == 0, "verdict": verdict})
    dataset = {"id": dataset_id, "source": "fresh-custom-tau-native", "revision": NATIVE_COMMIT, "contentHash": _file_hash(source / "outcomes.jsonl"),
               "license": "synthetic fixtures; native tau2 Apache-2.0 lineage", "parserVersion": generator + "-export-v2", "rawCount": len(rows), "admittedCount": len(rows),
               "metadata": {"fixtureManifestHash": _file_hash(fixture_manifest), "fixtureManifestUri": str(fixture_manifest.resolve()),
                            "label": "custom tau-compatible pilot", "failedTrialsRetained": True, "verifierLineage": lineage,
                            "verdictAmendment": json.loads((source / "amendment.json").read_text(encoding="utf-8")) if (source / "amendment.json").exists() else None}}
    _write(destination / "mining-episodes.json", mining)
    _write(destination / "repository-bundle.json", {"dataset": dataset, "episodes": metadata, "verifications": verdicts})
    with (destination / "trajectories.jsonl").open("x", encoding="utf-8") as stream:
        stream.write("".join(json.dumps(trajectory, ensure_ascii=False) + "\n" for trajectory in trajectories))
    summary = {"phase": phase, "arm": "base", "episodes": len(rows), "verifiedSuccesses": sum(row["success"] for row in rows),
               "families": len({row["familyId"] for row in rows}), "checkpoints": sum(len(episode["checkpoints"]) for episode in mining),
               "datasetId": dataset_id, "labels": "endpoint labels are offline; requested goal annotations remain separate"}
    _write(destination / "export-manifest.json", summary)
    return summary


def export_training(source: Path, fixture_manifest: Path, destination: Path):
    return export_native(source, fixture_manifest, destination, "train")
