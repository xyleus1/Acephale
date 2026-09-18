"""Freeze remaining official task IDs without inspecting outcomes or instructions."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.fresh_tasks import NATIVE_COMMIT, digest
from goalspec.source_freeze import file_digest
from goalspec.study_v2 import read, write


def prepare(previous_path, output, study_id):
    previous = read(previous_path)
    if previous["upstreamRevision"] != NATIVE_COMMIT or output.exists():
        raise ValueError("Pinned previous selection and unused output required")
    native = ROOT / "research/goalspec/.benchmarks/tau3"
    sources = [{"path": str(previous_path.resolve()), "sha256": file_digest(previous_path)}]
    tasks, exclusions = [], {}
    for domain in ("retail", "airline"):
        groups = previous["ancestry"][domain]["multiTaskGroups"]
        membership = {task: group for group, ids in groups.items() for task in ids}
        excluded = set(previous["excludedIdsByDomain"][domain]) | set(previous["selectedByDomain"][domain])
        for ids in groups.values():
            if excluded.intersection(ids):
                excluded.update(ids)
        seen_groups = set()
        for task in previous["candidateOrderByDomain"][domain]:
            family = membership.get(task, f"{domain}:official:{task}")
            if task not in excluded and family not in seen_groups:
                tasks.append({"domain": domain, "taskId": task, "familyId": family, "variant": 0})
                seen_groups.add(family)
        exclusions[domain] = sorted(excluded, key=int)
        for path in sorted((native / f"data/tau2/domains/{domain}").rglob("*")):
            if path.is_file() and path.suffix in {".json", ".md"}:
                sources.append({"path": str(path.resolve()), "sha256": file_digest(path)})
    manifest = {"schemaVersion": 1, "generator": "official-id-only-v5", "studyId": study_id,
        "studyStage": "confirmation", "nativeCommit": NATIVE_COMMIT, "tasks": tasks,
        "sources": sources, "excludedIdsByDomain": exclusions,
        "selectionPolicy": "Remaining prior eligible test IDs; prior live/controller IDs and known template relatives excluded; one ID per known family. Final balanced sample sized using development costs only.",
        "historicalExposure": "Public task prefixes were used in earlier project replay; this is not pristine project-wide held-out data.",
        "label": "Pinned official tau3 retail/airline subset, custom agent scaffold, historically public-exposed",
        "claimsExcluded": ["full official leaderboard reproduction", "original tau-bench version equivalence",
            "certified semantic independence from custom training", "verified PASTE or Salesforce reproduction"],
        "paidCalls": 0}
    manifest["manifestHash"] = digest(manifest)
    write(output, manifest)
    return {"manifest": str(output), "manifestHash": manifest["manifestHash"], "eligible": len(tasks),
        "domains": {domain: sum(task["domain"] == domain for task in tasks) for domain in ("retail", "airline")}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--study-id", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.previous, args.output, args.study_id)))
