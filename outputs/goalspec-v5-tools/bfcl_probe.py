"""Disjoint BFCL actor-conditioning diagnostic; exact pinned official checker."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import random
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("bfcl_prior_adapter", ROOT / "outputs/goalspec-benchmarks-tools/bfcl_subset.py")
PRIOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRIOR)
STUDY, SEED = "goalspec-bfcl-goal-conditioning-v5-20260916", 20260916
ARMS = ("direct", "goal_context_probe")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def select_ids(categories, exclusions, per_category=16):
    if per_category != 16:
        raise ValueError("Predeclared sixteen per category required")
    selected = {}
    for category in PRIOR.CATEGORIES:
        ids = categories[category]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate upstream IDs")
        available = [identity for identity in ids if identity not in exclusions]
        selected[category] = sorted(available, key=lambda identity: digest([STUDY, SEED, category, identity]))[:per_category]
        if len(selected[category]) != per_category:
            raise ValueError("Insufficient disjoint category")
    return selected


def prepare(output, prior_dataset):
    if output.exists():
        raise ValueError("New immutable dataset output required")
    if subprocess.check_output(["git", "-C", str(PRIOR.UPSTREAM), "rev-parse", "HEAD"], text=True).strip() != PRIOR.REVISION:
        raise ValueError("Pinned upstream revision changed")
    old_manifest, old_cases_path = PRIOR.read(prior_dataset / "dataset-manifest.json"), prior_dataset / "public-cases.json"
    if PRIOR.sha(old_cases_path) != old_manifest["publicCasesSha256"]:
        raise ValueError("Prior cohort changed")
    old = PRIOR.read(old_cases_path)["entries"]
    exclusions = {row["id"] for row in old}
    originals = {category: PRIOR.lines(PRIOR.PACKAGE / f"bfcl_eval/data/BFCL_v4_{category}.json") for category in PRIOR.CATEGORIES}
    # Exclude exact duplicate public prompt+function content across IDs, without answer inspection.
    old_signatures = {digest([row["question"], row["function"]]) for rows in originals.values() for row in rows if row["id"] in exclusions}
    exclusions.update(row["id"] for rows in originals.values() for row in rows if digest([row["question"], row["function"]]) in old_signatures)
    selected = select_ids({category: [row["id"] for row in rows] for category, rows in originals.items()}, exclusions)
    convert, _, _, style, mapping = PRIOR.upstream_functions()
    entries = []
    for category in PRIOR.CATEGORIES:
        by_id = {row["id"]: row for row in originals[category]}
        for identity in selected[category]:
            row = by_id[identity]
            if len(row["question"]) != 1:
                raise ValueError("Single-turn upstream structure changed")
            tools = convert(row["function"], mapping, style.OPENAI_RESPONSES)
            for tool in tools:
                tool["strict"] = False
            if len({tool["name"] for tool in tools}) != len(tools):
                raise ValueError("Normalized tool name collision")
            entries.append({"id": identity, "category": category, "input": row["question"][0], "tools": tools,
                            "originalEntrySha256": digest(row)})
    source_paths = [Path(row["path"]) for row in old_manifest["sources"]]
    source_paths += [old_cases_path, prior_dataset / "dataset-manifest.json", Path(__file__)]
    for source in old_manifest["sources"]:
        if PRIOR.sha(Path(source["path"])) != source["sha256"]:
            raise ValueError("Pinned converter/checker/source changed")
    output.mkdir(parents=True, exist_ok=False)
    PRIOR.write(output / "public-cases.json", {"studyId": STUDY, "entries": entries})
    manifest = {"schemaVersion": 1, "studyId": STUDY, "seed": SEED, "revision": PRIOR.REVISION, "cases": 32,
        "arms": list(ARMS), "selectedByCategory": selected, "excludedIds": sorted(exclusions), "priorCaseCount": len(old),
        "publicCasesSha256": PRIOR.sha(output / "public-cases.json"),
        "sources": [{"path": str(path.resolve()), "sha256": PRIOR.sha(path)} for path in sorted(set(source_paths))],
        "selection": "SHA256 ID order, sixteen/category, excludes prior64 IDs and identical public prompt+function content; no answer-based selection",
        "label": "BFCL public disjoint32 single-turn goal-conditioning diagnostic; not live GoalSpec, full BFCL, or pristine held-out data",
        "protocol": "Pinned actor54medium4096, original public user input/tools; paired direct vs synchronous mini1024 source-grounded goal context; official AST checker",
        "latencyScope": "Probe latency includes synchronous goal prediction; no latency-win hypothesis", "maximumReplayUsd": 8,
        "runtimeTuned": False, "noToolExecution": True}
    PRIOR.write(output / "dataset-manifest.json", manifest)
    return {"cases": 32, "manifestSha256": PRIOR.sha(output / "dataset-manifest.json"), "selectedByCategory": selected}


def score(dataset, run, output, samples=5000):
    if output.exists():
        raise ValueError("New immutable report output required")
    manifest = PRIOR.read(dataset / "dataset-manifest.json")
    if manifest.get("studyId") != STUDY or PRIOR.sha(dataset / "public-cases.json") != manifest["publicCasesSha256"]:
        raise ValueError("Diagnostic dataset changed")
    for source in manifest["sources"]:
        if PRIOR.sha(Path(source["path"])) != source["sha256"]:
            raise ValueError("Frozen source changed")
    cases = PRIOR.read(dataset / "public-cases.json")["entries"]
    summary, rows = PRIOR.read(run / "summary.json"), PRIOR.lines(run / "predictions.jsonl")
    plan = PRIOR.read(run / "dispatch-plan.json")
    if (summary.get("predictionsSha256") != PRIOR.sha(run / "predictions.jsonl")
            or summary.get("dispatchPlanSha256") != PRIOR.sha(run / "dispatch-plan.json")
            or plan.get("version") != STUDY):
        raise ValueError("Closed run hash binding changed")
    for source in plan["inputs"]:
        if PRIOR.sha(Path(source["path"])) != source["sha256"]:
            raise ValueError("Dispatch input changed")
    expected = {(case["id"], arm) for case in cases for arm in ARMS}
    actual = [(row["id"], row["arm"]) for row in rows]
    if summary.get("closed") is not True or len(actual) != len(set(actual)) or set(actual) != expected:
        raise ValueError("Complete closed paired64 grid required")
    _, checker, language, _, _ = PRIOR.upstream_functions()
    originals = {row["id"]: row for category in PRIOR.CATEGORIES for row in PRIOR.lines(PRIOR.PACKAGE / f"bfcl_eval/data/BFCL_v4_{category}.json")}
    answers = {row["id"]: row for row in PRIOR.lines(PRIOR.PACKAGE / "bfcl_eval/data/possible_answer/BFCL_v4_multiple.json")}
    results = []
    for row in rows:
        case = next(case for case in cases if case["id"] == row["id"])
        if case["category"] != row["category"]:
            raise ValueError("Category changed")
        if row["status"] != "completed":
            verdict = {"valid": False, "error_type": "missing_or_failed_prediction"}
        elif row["category"] == "irrelevance":
            verdict = {"valid": not row["result"]["calls"], "error_type": "" if not row["result"]["calls"] else "irrelevance_error:decoder_success"}
        else:
            decoded = [{call["name"]: call["arguments"]} for call in row["result"]["calls"]]
            verdict = checker(originals[row["id"]]["function"], decoded, answers[row["id"]]["ground_truth"], language.PYTHON, "multiple", "goalspec-gpt54-FC")
        results.append({"id": row["id"], "arm": row["arm"], "category": row["category"], "verdict": verdict,
            "predictionStatus": row["status"], "conditioning": row["conditioning"], "totalLatencyMs": row["totalLatencyMs"], "actorLatencyMs": row["actorLatencyMs"]})
    per_arm = {arm: {"correct": sum(row["verdict"]["valid"] for row in results if row["arm"] == arm), "total": len(cases),
        "categories": {category: {"correct": sum(row["verdict"]["valid"] for row in results if row["arm"] == arm and row["category"] == category),
            "total": sum(row["category"] == category for row in cases)} for category in PRIOR.CATEGORIES},
        "meanTotalLatencyMs": sum(row["totalLatencyMs"] for row in results if row["arm"] == arm) / len(cases)} for arm in ARMS}
    paired = {case["id"]: {row["arm"]: row for row in results if row["id"] == case["id"]} for case in cases}
    differences = [int(pair[ARMS[1]]["verdict"]["valid"]) - int(pair[ARMS[0]]["verdict"]["valid"]) for pair in paired.values()]
    rng = random.Random(SEED)
    boot = sorted(sum(rng.choices(differences, k=len(differences))) / len(differences) for _ in range(samples))
    report = {"version": STUDY, "label": manifest["label"], "perArm": per_arm, "cases": len(cases), "rows": len(rows), "results": results,
        "pairedAccuracyDifference": {"estimate": sum(differences) / len(differences), "lower": boot[int(.025 * samples)],
            "upper": boot[min(samples - 1, int(.975 * samples))], "clusters": len(cases), "clusterUnit": "public case", "bootstrapSamples": samples},
        "goalConditioning": dict(Counter(row["conditioning"]["status"] for row in rows if row["arm"] == ARMS[1])),
        "helpedCases": [identity for identity, pair in paired.items() if pair[ARMS[1]]["verdict"]["valid"] and not pair[ARMS[0]]["verdict"]["valid"]],
        "harmedCases": [identity for identity, pair in paired.items() if not pair[ARMS[1]]["verdict"]["valid"] and pair[ARMS[0]]["verdict"]["valid"]],
        "manifest": manifest, "providerRunSummary": summary, "predictionsSha256": PRIOR.sha(run / "predictions.jsonl"),
        "scorerSha256": PRIOR.sha(Path(__file__)), "limitations": ["No tool execution, memory, scheduler, or live task success",
            "Source grounding checks provenance, not semantic correctness", "Single stochastic response per arm/case; paired differences need not be caused by the hint alone",
            "Case bootstrap does not model shared function-family dependence", "All failed predictions and invalid/unknown goal fallbacks retained"]}
    output.mkdir(parents=True, exist_ok=False)
    PRIOR.write(output / "report.json", report)
    return {"perArm": per_arm, "pairedAccuracyDifference": report["pairedAccuracyDifference"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare")
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--prior-dataset", type=Path, required=True)
    evaluate = sub.add_parser("score")
    for name in ("dataset", "run", "output"):
        evaluate.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.output, args.prior_dataset) if args.command == "prepare" else score(args.dataset, args.run, args.output)))
