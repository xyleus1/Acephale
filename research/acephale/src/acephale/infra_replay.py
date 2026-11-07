"""Measured symbolic prediction replay, with no model calls or latency claims."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import (
    all_checkpoints,
    export_rows,
    load_metadata,
    read_jsonl,
    verify_bundle,
)
from acephale.patterns import PatternPool
from acephale.storage import file_hash, load_trajectories


def replay_patterns(trajectory_path: Path, bundle_directory: Path, memory_path: Path | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = verify_bundle(bundle_directory)
    lineage = json.loads((bundle_directory / "lineage.json").read_text(encoding="utf-8"))
    source_hash = lineage.get("export_trajectories_sha256", lineage.get("trajectories_sha256"))
    if source_hash != file_hash(trajectory_path):
        raise ValueError("Replay trajectories differ from frozen public export")
    trajectories = load_trajectories(trajectory_path)
    metadata = load_metadata(bundle_directory / "metadata.jsonl")
    split = json.loads((bundle_directory / "split.json").read_text(encoding="utf-8"))
    public, labels, _ = export_rows(trajectories, metadata, split)
    frozen_public = read_jsonl(bundle_directory / "public.jsonl")
    if public != frozen_public or labels != read_jsonl(bundle_directory / "labels.jsonl"):
        raise ValueError("Replayed prefixes differ from frozen checkpoint input")
    memory = json.loads((memory_path or bundle_directory / "memory.json").read_text(encoding="utf-8"))
    if memory["snapshot_hash"] != hash_v1({key: value for key, value in memory.items() if key != "snapshot_hash"}) or memory["split_hash"] != hash_v1(split):
        raise ValueError("Memory snapshot mismatch")
    pools = {row["compatibility_key"]: PatternPool.model_validate(row["pattern_pool"]) for row in memory["pattern_partitions"]}
    checkpoints = {(row["episode_id"], row["through_seq"]): row for row in public}
    rows = []
    for trajectory in trajectories:
        meta = metadata[trajectory.trajectory_id]
        if split["families"][meta.family_id] != "development":
            continue
        compatibility = {"scope": meta.scope.model_dump(mode="json"), "environment_version": meta.environment_version, "tool_schema_hash": meta.tool_schema_hash, "verification_tier": meta.verification_tier, "license": meta.license, "source_revision": meta.source_revision}
        pool = pools.get(hash_v1(compatibility))
        for prefix, targets in all_checkpoints(trajectory):
            checkpoint = checkpoints[(trajectory.trajectory_id, prefix.through_seq)]
            eligible_names = {tool.name for tool in prefix.tools if tool.side_effects == "read_only" and tool.cacheable}
            actual = [{"tool": event.tool, "arguments": event.arguments} for event in targets if event.tool in eligible_names]
            predicted = pool.predict(prefix).candidates if pool else ()
            candidates = [{"tool": candidate.tool, "arguments": candidate.arguments} for candidate in predicted if candidate.tool in eligible_names][:128]
            identities = [hash_v1(candidate) for candidate in candidates]
            if len(set(identities)) != len(identities):
                raise ValueError("Duplicate symbolic candidate")
            actual_ids = {hash_v1(invocation) for invocation in actual}
            rows.append({
                "checkpoint_id": checkpoint["checkpoint_id"], "input_hash": checkpoint["input_hash"],
                "family_id": meta.family_id, "domain": trajectory.domain, "eligible_next_read": bool(actual),
                "actual": actual, "candidates": candidates, "pool_hash": hash_v1(sorted(identities)),
                "covered": bool(actual_ids & set(identities)),
                "exact_top1": bool(actual_ids & set(identities[:1])),
                "exact_top3": bool(actual_ids & set(identities[:3])),
                "tool_top1": bool(candidates and candidates[0]["tool"] in {item["tool"] for item in actual}),
                "no_read_prediction_available": False,
            })
    eligible = [row for row in rows if row["eligible_next_read"]]
    families: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in eligible:
        families[row["family_id"]].append(row)
    by_family = [{"family_id": family, "eligible_read_decisions": len(values), "exact_top1": sum(row["exact_top1"] for row in values) / len(values), "exact_top3": sum(row["exact_top3"] for row in values) / len(values), "coverage": sum(row["covered"] for row in values) / len(values)} for family, values in sorted(families.items())]
    means = np.array([row["exact_top1"] for row in by_family], dtype=float)
    ci = None
    if len(means) >= 2:
        rng = np.random.default_rng(42)
        draws = means[rng.integers(0, len(means), size=(2000, len(means)))].mean(axis=1)
        ci = [float(value) for value in np.quantile(draws, [.025, .975])]
    report = {
        "version": "acephale-infra-symbolic-replay-v1", "measurement_kind": "frozen_prediction_replay",
        "label": "Historical development prefixes; symbolic pattern baseline; no fresh or live performance claim",
        "pilot_bundle_hash": manifest["bundle_hash"], "memory_snapshot_hash": memory["snapshot_hash"],
        "development_checkpoints": len(rows), "eligible_read_decisions": len(eligible),
        "families_with_eligible_reads": len(by_family), "tool_top1": sum(row["tool_top1"] for row in eligible) / len(eligible) if eligible else None,
        "exact_top1": sum(row["exact_top1"] for row in eligible) / len(eligible) if eligible else None,
        "exact_top3": sum(row["exact_top3"] for row in eligible) / len(eligible) if eligible else None,
        "candidate_coverage": sum(row["covered"] for row in eligible) / len(eligible) if eligible else None,
        "family_macro_exact_top1": float(means.mean()) if len(means) else None,
        "family_bootstrap_ci95": ci, "bootstrap_samples": 2000, "bootstrap_seed": 42,
        "by_family": by_family, "paid_requests": 0,
        "limitations": ["Exact hit means one eligible invocation in the immediate next batch", "Message-only and mutation-only decisions are excluded from read-accuracy denominator", "This baseline has no calibrated NO_READ output", "No annotation or goal-conditioned comparison has run", "No native success or live latency is inferred from prediction replay"],
    }
    return report, rows
