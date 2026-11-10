"""Prepare a fixed native base collection from pinned local source, without model calls."""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from acephale.contracts_v1 import hash_v1
from acephale.infra_native_runner import (
    REVISION,
    ROOT,
    NativeTauExecutor,
    _verify_checkout,
    validate_task_bundle,
    verify_sources,
)
from acephale.native_common import native_evaluation_type, read, write


def empty_shadow_memory(snapshot_id: str) -> dict:
    """Match the server-owned TypeScript v5 empty memory bootstrap exactly."""
    body = {"schemaVersion": 1, "compilerVersion": "acephale-memory-v5",
            "sourcePolicy": "v5-and-permitted-training-only", "repositorySnapshotId": snapshot_id,
            "sourceFiles": [], "runs": [], "episodes": [], "misses": [], "transitions": [], "confusions": []}
    return {**body, "contentHash": hash_v1(body)}


def build_collection(plan: dict, deployment: dict, catalog: dict, source_commit: str,
                     checkpoint_hash: str, shadow_memory: dict | None = None) -> tuple[dict, dict, dict]:
    """Assemble measured deployment metadata and predeclared local task selections.

    Limits are operational policy, not invented performance measurements. The
    absent memory/calibration hashes explicitly identify the collection phase.
    """
    if deployment.get("version") != 1 or deployment.get("observed") is not True:
        raise ValueError("An observed deployment inventory is required")
    if not isinstance(plan.get("experimentId"), str) or not plan["experimentId"]:
        raise ValueError("A collection experimentId is required")
    if type(plan.get("shadowPrediction", False)) is not bool or plan.get("stage", "collection") != "collection":
        raise ValueError("Shadow collection requires an explicit boolean and collection stage")
    shadow = plan.get("shadowPrediction", False)
    evaluation_type = native_evaluation_type(plan.get("evaluationType", "ALL"))
    if shadow and not plan.get("predictorBaseUrl"):
        raise ValueError("Shadow prediction requires the pinned predictor endpoint")
    if plan.get("memoryPath") and (not shadow or shadow_memory is None):
        raise ValueError("A shadow memory path needs the actually loaded frozen memory artifact")
    for field in ("actorBaseUrl", "predictorBaseUrl"):
        if field == "predictorBaseUrl" and not plan.get(field):
            continue
        endpoint = urlsplit(plan.get(field, ""))
        if endpoint.scheme not in {"http", "https"} or not endpoint.netloc or endpoint.username \
                or endpoint.password or endpoint.query or endpoint.fragment:
            raise ValueError("Model endpoint must be a credential-free HTTP URL")
    selections, seeds = plan.get("tasks"), plan.get("seeds")
    if not isinstance(selections, list) or not selections or not isinstance(seeds, list) or not seeds:
        raise ValueError("Explicit task selections and seeds are required")
    if len(set(seeds)) != len(seeds) or any(type(seed) is not int or not 0 <= seed < 2**31 for seed in seeds):
        raise ValueError("Invalid or repeated collection seed")
    family_splits, task_keys, tasks, runs = {}, set(), [], []
    for selected in selections:
        domain, task_id, family, split = (selected.get(key) for key in ("domain", "taskId", "familyId", "split"))
        if domain not in {"retail", "airline"} or not isinstance(task_id, str) or not task_id:
            raise ValueError("Invalid native task selection")
        if not isinstance(family, str) or not family or split not in {"train", "development", "test"}:
            raise ValueError("A task requires an explicit family and split")
        if family in family_splits and family_splits[family] != split or (domain, task_id) in task_keys:
            raise ValueError("Repeated task or family crosses split")
        family_splits[family] = split
        task_keys.add((domain, task_id))
        task = catalog[domain]["tasks"].get(task_id)
        if task is None:
            raise ValueError("Selected task is absent from the pinned upstream catalog")
        tasks.append({"domain": domain, "taskId": task_id, "familyId": family, "task": task})
        if split == "test" or shadow and split != "train":
            continue
        for seed in seeds:
            identity = [plan["experimentId"], domain, task_id, family, seed]
            runs.append({"runId": "collect-" + hash_v1(identity)[:24], "domain": domain, "taskId": task_id,
                         "familyId": family, "seed": seed, "arm": "base", "tools": catalog[domain]["tools"],
                         "maxBoundaries": plan.get("maxSteps", 40)})
    if not runs:
        raise ValueError("Collection needs at least one eligible task; shadow prediction requires training")
    families = {name: sorted(family for family, value in family_splits.items() if value == split)
                for name, split in (("trainingFamilies", "train"), ("developmentFamilies", "development"),
                                    ("heldoutFamilies", "test"))}
    if any(not values for values in families.values()):
        raise ValueError("Predeclare nonempty training, development and heldout families")
    bundle = {"version": 1, "upstreamRevision": REVISION, "tasks": tasks}
    config = {"version": 1, "stage": "collection", "manifestPath": "manifest.json",
              "ledgerCheckpointPath": "ledger-checkpoint.json", "actorBaseUrl": plan["actorBaseUrl"],
              "snapshotId": "collection-" + hash_v1([source_commit, bundle]), "stream": False,
              "maximumLifetimeSeconds": plan.get("maximumLifetimeSeconds", 3600), "runs": runs,
              "taskBundleHash": hash_v1(bundle), "hosted": {"allocation": "training",
                  "maxCostMicrodollarsPerRun": plan.get("maxCostMicrodollarsPerRun", 1_250_000),
                  "maxSteps": plan.get("maxSteps", 40), "maxErrors": plan.get("maxErrors", 5),
                  "timeoutSeconds": plan.get("timeoutSeconds", 600), "evaluationType": evaluation_type}}
    if plan.get("predictorBaseUrl"):
        config["predictorBaseUrl"] = plan["predictorBaseUrl"]
    if shadow:
        config["shadowPrediction"] = True
        if shadow_memory is None:
            shadow_memory = empty_shadow_memory(config["snapshotId"])
    if shadow_memory is not None:
        if not shadow or shadow_memory.get("contentHash") != hash_v1({key: value for key, value in shadow_memory.items() if key != "contentHash"}):
            raise ValueError("Shadow memory must bind a verified frozen artifact")
        if not isinstance(shadow_memory.get("repositorySnapshotId"), str) or not shadow_memory["repositorySnapshotId"] \
                or any(run.get("split") != "train" or run.get("familyId") not in families["trainingFamilies"] for run in shadow_memory.get("runs", [])):
            raise ValueError("Shadow memory must contain only declared training families")
        config["memoryPath"] = plan.get("memoryPath", "shadow-memory.json")
        config["snapshotId"] = shadow_memory["repositorySnapshotId"]
    for field in ("otlpBaseUrl", "splitGuardPath"):
        if plan.get(field):
            config[field] = plan[field]
    manifest = {"version": 2, "profile": "acephale-infra-v1", "experimentId": plan["experimentId"],
                "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"), "sourceCommit": source_commit,
                **{key: deployment[key] for key in ("actor", "predictor", "runtime", "hardware")},
                "data": {"datasetHash": hash_v1(bundle), "splitHash": hash_v1(family_splits),
                    "memoryHash": shadow_memory["contentHash"] if shadow_memory else hash_v1({"artifact": "memory", "state": "not-created", "stage": "collection"}),
                    "calibrationHash": hash_v1({"artifact": "calibration", "state": "not-created", "stage": "collection"}),
                    "toolSchemaHash": hash_v1([{"domain": domain, "tools": catalog[domain]["tools"]}
                                               for domain in sorted({run["domain"] for run in runs})]),
                    "environmentRevision": REVISION, **families},
                "arms": ["demand-only", "goal-neutral", "goal-conditioned"], "seeds": seeds,
                "budgets": {"totalCeilingMicrodollars": 500_000_000, "trancheMicrodollars": 150_000_000,
                    "infrastructureMicrodollars": 35_000_000, "protectedContingencyMicrodollars": 65_000_000,
                    "maximumGpuHours": 24, "ledgerCheckpointHash": checkpoint_hash},
                "protocol": {"actorContext": "none", "exposeEvidence": False, "frozenMemory": True,
                    "sameCandidatePool": True, "lookaheadHops": 1, "rankedCandidates": 3, "perRunConcurrency": 2,
                    "globalConcurrency": 4, "startsPerRun": 12, "deadlineMs": 5000,
                    "cachePolicy": "base-collection-shadow-prediction-no-speculation" if shadow else "base-collection-no-speculation", "scheduleHash": hash_v1(runs)}}
    validate_task_bundle(config, manifest, bundle)
    return config, manifest, bundle


def prepare_native(plan_path: Path, deployment_path: Path, budget_directory: Path,
                   upstream_root: Path, output: Path) -> dict:
    plan, deployment = read(plan_path), read(deployment_path)
    upstream_root, output = upstream_root.resolve(), output.resolve()
    _verify_checkout(upstream_root, REVISION)
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    verify_sources({"sourceCommit": source_commit}, upstream_root)
    # This imports the pinned native environment for its schemas and official
    # task bytes only. No actor, user, or evaluator is dispatched.
    native = NativeTauExecutor({"runs": []}, {}, upstream_root)
    catalog = {}
    for domain in sorted({row["domain"] for row in plan["tasks"]}):
        if domain not in {"retail", "airline"}:
            raise ValueError("Unsupported native domain")
        environment = native.registry.get_env_constructor(domain)(solo_mode=False)
        catalog[domain] = {"tools": [tool.openai_schema for tool in environment.get_tools()],
            "tasks": {str(task["id"]): task for task in read(upstream_root / f"data/tau2/domains/{domain}/tasks.json")}}
    output.mkdir(parents=True, exist_ok=False)
    checkpoint = output / "ledger-checkpoint.json"
    subprocess.run(["node", "--import", "tsx", "scripts/acephale-infra-native.ts", "checkpoint",
                    str(budget_directory.resolve() / "budget.jsonl"), str(checkpoint)], cwd=ROOT, check=True,
                   capture_output=True, text=True)
    runtime_plan, shadow_memory = dict(plan), None
    if plan.get("memoryPath"):
        memory_path = (plan_path.resolve().parent / plan["memoryPath"]).resolve()
        shadow_memory = read(memory_path)
        runtime_plan["memoryPath"] = str(memory_path)
    config, manifest, bundle = build_collection(runtime_plan, deployment, catalog, source_commit, hash_v1(read(checkpoint)), shadow_memory)
    if config.get("shadowPrediction") and not plan.get("memoryPath"):
        write(output / "shadow-memory.json", empty_shadow_memory(config["snapshotId"]))
    for name, value in (("configuration.json", config), ("manifest.json", manifest), ("tasks.json", bundle),
                        ("preparation-plan.json", plan), ("deployment-inventory.json", deployment)):
        write(output / name, value)
    script = "const {loadInfraNativeConfiguration}=require('./scripts/acephale-infra-native.ts'); loadInfraNativeConfiguration(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});"
    subprocess.run(["node", "--import", "tsx", "-e", script, str(output / "configuration.json")], cwd=ROOT, check=True)
    receipt = {"version": 1, "configurationHash": hash_v1(config), "manifestHash": hash_v1(manifest),
               "taskBundleHash": hash_v1(bundle), "sourceCommit": source_commit, "upstreamRevision": REVISION,
               "declaredCollectionRuns": len(config["runs"]), "modelCalls": 0, "gpuProvisioned": False,
               "deploymentVerifiedByThisCommand": False}
    write(output / "preparation-receipt.json", receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("plan", "deployment", "budget-directory", "upstream-root", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    args = parser.parse_args(argv)
    print(json.dumps(prepare_native(args.plan, args.deployment, args.budget_directory,
                                    args.upstream_root, args.output), indent=2))


if __name__ == "__main__":
    main()
