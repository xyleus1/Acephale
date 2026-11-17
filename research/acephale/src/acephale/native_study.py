"""Freeze reviewed family selections and paired schedules without model dispatch."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.custom_native_tasks import verify_custom_bundle
from acephale.storage import file_hash
from acephale.training_data import FAMILY_KEYS, file_inventory, hashed, verify_dataset, write_new

ARMS = ("base", "neutral_memory_prefetch", "acephale")


def paired_schedule(tasks: list[dict], families: dict[str, str], *, stage: str, experiment_id: str) -> list[dict]:
    if stage not in {"development", "heldout"}:
        raise ValueError("A paired schedule requires development or heldout")
    partition = "development" if stage == "development" else "test"
    selected = [task for task in tasks if families[task["familyId"]] == partition]
    blocks = [(task, trial, seed) for task in selected
              for trial, seed in enumerate((17,) if stage == "development" else (17, 29))]
    blocks.sort(key=lambda block: hash_v1([experiment_id, stage, block[0]["taskId"], block[1], block[2]]))
    rows = []
    for task, trial, seed in blocks:
        block_id = hash_v1([experiment_id, stage, task["taskId"], trial, seed])[:24]
        # Development uses one trial per variant; heldout crosses both seeds.
        predictor_seed = (17 if task["taskId"].endswith("-v0") else 29) if stage == "development" else seed
        arms = sorted(ARMS, key=lambda arm: hash_v1([block_id, arm]))
        for position, arm in enumerate(arms):
            rows.append({"runId": stage + "-" + hash_v1([block_id, arm])[:24], "pairedBlockId": block_id,
                         "domain": task["domain"], "taskId": task["taskId"], "familyId": task["familyId"],
                         "trial": trial, "seed": seed, "predictorTrainingSeed": predictor_seed,
                         "arm": arm, "armOrder": position, "maxBoundaries": 40})
    validate_schedule(rows)
    return rows


def validate_schedule(rows: list[dict]) -> None:
    grouped = {}
    if not rows or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("A paired schedule requires unique nonempty runs")
    for row in rows:
        grouped.setdefault(row["pairedBlockId"], []).append(row)
    for block in grouped.values():
        if len(block) != 3 or {row["arm"] for row in block} != set(ARMS):
            raise ValueError("Every paired block must contain all three arms")
        for field in ("domain", "taskId", "familyId", "trial", "seed", "predictorTrainingSeed", "maxBoundaries"):
            if len({row[field] for row in block}) != 1:
                raise ValueError("Paired arms must use the same task, seed, model and limits")
        if [row["armOrder"] for row in block] != [0, 1, 2]:
            raise ValueError("Paired arm order must be explicit")


def reviewed_partitions(receipt: dict, partition: dict) -> tuple[dict, dict, dict]:
    families = partition["families"]
    lists = {key: sorted(family for family, value in families.items() if value == split)
             for split, key in FAMILY_KEYS.items()}
    if [len(lists[key]) for key in FAMILY_KEYS.values()] != [24, 6, 6, 8]:
        raise ValueError("Source design must contain the full declared family partition")
    proposal = hashed({"schemaVersion": 1, "kind": "acephale-candidate-only-family-partition", **lists,
                       "families": families, "customTaskReceiptHash": receipt["contentHash"],
                       "customPartitionHash": partition["contentHash"], "executionAuthorized": False,
                       "evaluationEligible": False, "efficacyClaimAllowed": False})
    review = hashed({"schemaVersion": 1, "kind": "acephale-source-family-review",
                     "reviewer": {"kind": "assistant_source_design", "name": "Acephale source-design audit"},
                     "partitionProposalHash": proposal["contentHash"], "customTaskReceiptHash": receipt["contentHash"],
                     "historicalAPIGenExcluded": True, "humanAnnotationLabelReview": False,
                     "scope": "Source and family eligibility for candidate/workflow memory; not annotation-label approval",
                     "checks": {"nativeReferenceOutcomes": 88, "mutationAblationFailures": 200,
                                "disjointOperationSets": True, "freshOwnedEntities": True,
                                "fixedNativeCatalogsAndPolicy": True, "sharedPrimitiveOverlapDisclosed": True},
                     "limitations": ["Compositional families share primitive intents and native catalog facts.",
                                     "No live actor results, goal-label acceptance or performance advantage follows from this review."]})
    approved = hashed({**{key: value for key, value in proposal.items() if key != "contentHash"},
                       "executionAuthorized": True, "evaluationEligible": True,
                       "review": {"status": "completed", "reviewerKind": "assistant_source_design",
                                  "humanAnnotationLabelReview": False, "sourceDesignReviewHash": review["contentHash"]}})
    return proposal, review, approved


def smoke_command(*, python: str, dataset: str, model: str, image_receipt: str, lease: str,
                  actor_container: str, output: str) -> list[str]:
    """Bind observed paths and container identity when the Linux host is qualified."""
    if not re.fullmatch(r"[a-f0-9]{64}", actor_container) or any(not value for value in (python, dataset, model, image_receipt, lease, output)):
        raise ValueError("Smoke requires actual paths and the complete stopped actor container ID")
    return [python, "-m", "acephale.training_container", "run", "--receipt", image_receipt,
            "--action", "smoke", "--dataset", dataset, "--model", model, "--lease", lease,
            "--actor-container", actor_container, "--output", output]


def prepare_study(custom_directory: Path, upstream_root: Path, output: Path, *,
                  experiment_id: str = "acephale-native-compositions-v1", diagnostic_dataset: Path | None = None) -> dict:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", experiment_id):
        raise ValueError("A safe explicit experiment ID is required")
    receipt, bundle, partition = verify_custom_bundle(custom_directory, upstream_root)
    verification = json.loads((custom_directory / "verification.json").read_text(encoding="utf-8"))
    if len(verification["checks"]) != 88 or sum(len(row["ablationChecks"]) for row in verification["checks"]) != 200:
        raise ValueError("Full native reference and mutation-ablation evidence required")
    families = partition["families"]
    tasks = [{"domain": row["domain"], "taskId": row["taskId"], "familyId": row["familyId"],
              "split": "train" if families[row["familyId"]] in {"weight_fit", "calibration"} else families[row["familyId"]]}
             for row in bundle["tasks"]]
    tasks.sort(key=lambda row: hash_v1([17, row["domain"], row["taskId"]]))
    plan = {"experimentId": experiment_id, "stage": "collection",
            "customTaskBundleDirectory": str(custom_directory.resolve()), "customTaskReceiptHash": receipt["contentHash"],
            "collectionPartitions": ["weight_fit", "calibration"], "actorBaseUrl": "http://127.0.0.1:8000",
            "predictorBaseUrl": "http://127.0.0.1:8001", "shadowPrediction": False, "seeds": [17],
            "maxSteps": 40, "maxErrors": 5, "timeoutSeconds": 600, "maximumLifetimeSeconds": 7200,
            "maxCostMicrodollarsPerRun": 400000, "evaluationType": "ALL_WITH_NL_ASSERTIONS", "tasks": tasks}
    expected = [row for row in tasks if row["split"] == "train"]
    if len(expected) != 60 or Counter(row["domain"] for row in expected) != {"retail": 30, "airline": 30}:
        raise ValueError("Collection requires exactly 60 fitting/calibration slots, balanced by domain")
    proposal, review, approved = reviewed_partitions(receipt, partition)
    development = paired_schedule(bundle["tasks"], families, stage="development", experiment_id=plan["experimentId"])
    heldout = paired_schedule(bundle["tasks"], families, stage="heldout", experiment_id=plan["experimentId"])
    output.mkdir(parents=True, exist_ok=False)
    for name, value in (("collection-plan.json", plan), ("partition.json", proposal),
                        ("source-design-review.json", review), ("partition.approved.json", approved),
                        ("development-schedule.json", development), ("heldout-target-schedule.json", heldout)):
        write_new(output / name, value)
    if diagnostic_dataset is not None:
        diagnostic = verify_dataset(diagnostic_dataset)
        if diagnostic.get("review") is not None or diagnostic.get("testFamilies") or diagnostic["counts"].get("test"):
            raise ValueError("The machinery smoke may reuse only the closed neutral diagnostic dataset")
        write_new(output / "smoke-source.json", hashed({"kind": "acephale-training-smoke-source",
            "datasetDirectory": str(diagnostic_dataset.resolve()), "datasetManifestHash": diagnostic["contentHash"],
            "datasetManifestSha256": file_hash(diagnostic_dataset / "manifest.json"), "counts": diagnostic["counts"],
            "originalCompilerHash": diagnostic["compilerHash"], "base": diagnostic["base"],
            "purpose": "Fresh one-step optimizer/reload/merge machinery diagnosis on preserved neutral inputs",
            "mainTrainingAllowed": False, "efficacyClaimAllowed": False, "oldArtifactsResealed": False,
            "requiredLeaseKind": "smoke", "maximumSeconds": 900,
            "prerequisites": ["qualified pinned Linux trainer image", "actor and predictor stopped",
                              "actual renewed smoke lease", "original dataset and tokenizer hashes", "verified provider cleanup watchdog"]}))
    result = hashed({"kind": "acephale-staged-native-study", "helperSourceHash": file_hash(Path(__file__)),
                     "customTaskReceiptHash": receipt["contentHash"], "approvedPartitionHash": approved["contentHash"],
                     "declaredTasks": 88, "collectionSlots": 60, "collectionReservationMicrodollars": 24000000,
                     "developmentSlots": len(development), "heldoutTargetSlots": len(heldout),
                     "heldoutSizeFrozen": False, "heldoutRequiresDevelopmentCostSizing": True,
                     "runtimeDeploymentVerified": False, "budgetReserved": False, "modelCalls": 0,
                     "humanGoalAnnotationReviewCompleted": False, "files": file_inventory(output)})
    write_new(output / "receipt.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("custom-directory", "upstream-root", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--diagnostic-dataset", type=Path)
    parser.add_argument("--experiment-id", default="acephale-native-compositions-v1")
    args = parser.parse_args(argv)
    print(json.dumps(prepare_study(args.custom_directory, args.upstream_root, args.output,
                                  experiment_id=args.experiment_id, diagnostic_dataset=args.diagnostic_dataset), indent=2))


if __name__ == "__main__":
    main()
