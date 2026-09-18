"""Pinned BFCL single-turn actor component test, never an overall leaderboard score."""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import importlib
import json
import re
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "research/goalspec/.benchmarks/bfcl-f7cf735"
PACKAGE = UPSTREAM / "berkeley-function-call-leaderboard"
REVISION = "f7cf7359b7ac615a0b294831c5ba2bc95ee4a000"
CATEGORIES = ("multiple", "irrelevance")
STUDY = "goalspec-bfcl-component-20260916"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n")


def upstream_functions():
    """Load exact converter function ASTs and unmodified official scoring code.

    Only the model-name registry dependency is supplied locally, with the single
    official OpenAI name-normalization flag. No provider SDK is instantiated.
    """
    sys.path.insert(0, str(PACKAGE))
    from bfcl_eval.constants.enums import Language, ModelStyle
    from bfcl_eval.constants.type_mappings import GORILLA_TO_OPENAPI

    registry = types.ModuleType("bfcl_eval.constants.model_config")
    registry.MODEL_CONFIG_MAPPING = {"goalspec-gpt54-FC": types.SimpleNamespace(underscore_to_dot=True)}
    sys.modules[registry.__name__] = registry
    checker = importlib.import_module("bfcl_eval.eval_checker.ast_eval.ast_checker")
    path = PACKAGE / "bfcl_eval/model_handler/utils.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in {"_cast_to_openai_type", "convert_to_tool"}]
    if len(selected) != 2:
        raise ValueError("Pinned upstream conversion functions changed")
    namespace = {"copy": copy, "re": re, "json": json, "ModelStyle": ModelStyle, "GORILLA_TO_OPENAPI": GORILLA_TO_OPENAPI}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), "exec"), namespace)
    return namespace["convert_to_tool"], checker.ast_checker, Language, ModelStyle, GORILLA_TO_OPENAPI


def prepare(output, per_category=32):
    import subprocess
    if output.exists() or per_category != 32:
        raise ValueError("New output and predeclared 32 entries per category required")
    revision = subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise ValueError("Upstream revision mismatch")
    convert, _, _, style, mapping = upstream_functions()
    entries, sources, counts = [], [], {}
    for category in CATEGORIES:
        path = PACKAGE / f"bfcl_eval/data/BFCL_v4_{category}.json"
        rows = lines(path)
        if len({row["id"] for row in rows}) != len(rows):
            raise ValueError("Duplicate upstream IDs")
        counts[category] = len(rows)
        order = sorted(rows, key=lambda row: hashlib.sha256(json.dumps([STUDY, 20260916, category, row["id"]], separators=(",", ":")).encode()).hexdigest())
        for row in order[:per_category]:
            if len(row["question"]) != 1:
                raise ValueError("Single-turn category unexpectedly changed")
            tools = convert(row["function"], mapping, style.OPENAI_RESPONSES)
            for tool in tools:
                # Preserve optional arguments rather than enabling strict-all-required.
                tool["strict"] = False
            if len({tool["name"] for tool in tools}) != len(tools):
                raise ValueError("OpenAI name normalization creates a collision")
            entries.append({"id": row["id"], "category": category, "input": row["question"][0], "tools": tools,
                            "originalEntrySha256": hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()})
        sources.append({"path": str(path), "sha256": sha(path)})
        if category == "multiple":
            answer = PACKAGE / "bfcl_eval/data/possible_answer/BFCL_v4_multiple.json"
            sources.append({"path": str(answer), "sha256": sha(answer)})
    code = [PACKAGE / "bfcl_eval/model_handler/utils.py", PACKAGE / "bfcl_eval/constants/enums.py",
            PACKAGE / "bfcl_eval/constants/type_mappings.py", PACKAGE / "bfcl_eval/model_handler/api_inference/openai_response.py",
            PACKAGE / "bfcl_eval/eval_checker/ast_eval/ast_checker.py", PACKAGE / "bfcl_eval/eval_checker/eval_runner.py",
            *sorted((PACKAGE / "bfcl_eval/eval_checker/ast_eval/type_convertor").glob("*.py")), Path(__file__)]
    sources.extend({"path": str(path), "sha256": sha(path)} for path in code)
    output.mkdir(parents=True, exist_ok=False)
    write(output / "public-cases.json", {"studyId": STUDY, "entries": entries})
    manifest = {"schemaVersion": 1, "studyId": STUDY, "revision": REVISION, "sourceCounts": counts,
                "cases": len(entries), "sources": sources, "publicCasesSha256": sha(output / "public-cases.json"),
                "label": "BFCL v4 multiple/irrelevance subset, frozen research actor component, not full GoalSpec or overall BFCL score",
                "model": "gpt-5.4-2026-03-05", "reasoning": "medium", "maxOutputTokens": 4096,
                "selection": "SHA256 ID-only ordering before answer loading, 32 per category",
                "protocol": "Single turn, native Responses tool calls, no system prompt or tool execution; strict=false preserves optional fields",
                "checkerAdapter": "Unmodified upstream AST checker; isolated model registry contains only underscore_to_dot=True; exact upstream converter function ASTs",
                "license": "Apache-2.0", "runtimeTuned": False}
    write(output / "dataset-manifest.json", manifest)
    print(json.dumps({"cases": len(entries), "manifestSha256": sha(output / "dataset-manifest.json")}))


def score(dataset, run, output):
    if output.exists():
        raise ValueError("Use a new scoring output")
    manifest = read(dataset / "dataset-manifest.json")
    if sha(dataset / "public-cases.json") != manifest["publicCasesSha256"]:
        raise ValueError("Public cases changed")
    for source in manifest["sources"]:
        if sha(Path(source["path"])) != source["sha256"]:
            raise ValueError("Pinned source changed")
    cases = read(dataset / "public-cases.json")["entries"]
    rows = lines(run / "predictions.jsonl")
    summary = read(run / "summary.json")
    if (summary.get("closed") is not True or len(rows) != len(cases) or len({row["id"] for row in rows}) != len(rows)
            or {row["id"] for row in rows} != {row["id"] for row in cases}):
        raise ValueError("Complete closed declared cohort required before scoring")
    _, checker, language, _, _ = upstream_functions()
    originals = {row["id"]: row for category in CATEGORIES for row in lines(PACKAGE / f"bfcl_eval/data/BFCL_v4_{category}.json")}
    answers = {row["id"]: row for row in lines(PACKAGE / "bfcl_eval/data/possible_answer/BFCL_v4_multiple.json")}
    results = []
    for row in rows:
        original = originals[row["id"]]
        expected_case = next(case for case in cases if case["id"] == row["id"])
        if row["category"] != expected_case["category"]:
            raise ValueError("Category changed")
        if row["status"] != "completed":
            verdict = {"valid": False, "error_type": "missing_or_failed_prediction"}
        elif row["category"] == "irrelevance":
            # Upstream FC irrelevance criterion: no decoded function calls.
            verdict = {"valid": not row["result"]["calls"], "error_type": "" if not row["result"]["calls"] else "irrelevance_error:decoder_success"}
        else:
            decoded = [{call["name"]: call["arguments"]} for call in row["result"]["calls"]]
            verdict = checker(original["function"], decoded, answers[row["id"]]["ground_truth"], language.PYTHON, "multiple", "goalspec-gpt54-FC")
        results.append({"id": row["id"], "category": row["category"], "verdict": verdict, "predictionStatus": row["status"], "latencyMs": row["latencyMs"]})
    categories = {category: {"correct": sum(row["verdict"]["valid"] for row in results if row["category"] == category),
                            "total": sum(row["category"] == category for row in results)} for category in CATEGORIES}
    report = {"schemaVersion": 1, "label": manifest["label"], "categories": categories, "correct": sum(row["verdict"]["valid"] for row in results),
              "total": len(results), "results": results, "manifest": manifest, "providerRunSummary": summary,
              "predictionSha256": sha(run / "predictions.jsonl"), "scorerSha256": sha(Path(__file__)),
              "limitations": ["Two-category deterministic subset, not an overall BFCL leaderboard score", "Actor/tool-call component only; no GoalSpec scheduler, memory, goals or live task-completion claim", "Reasoning-medium/output4096 custom configuration", "All declared failures retained; no retries of completed cases"]}
    output.mkdir(parents=True, exist_ok=False)
    write(output / "report.json", report)
    print(json.dumps({"categories": categories, "correct": report["correct"], "total": len(results)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare")
    create.add_argument("output", type=Path)
    evaluate = sub.add_parser("score")
    evaluate.add_argument("dataset", type=Path)
    evaluate.add_argument("run", type=Path)
    evaluate.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.output)
    else:
        score(args.dataset, args.run, args.output)
