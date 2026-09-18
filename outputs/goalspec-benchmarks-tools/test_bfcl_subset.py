import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("bfcl_subset", Path(__file__).with_name("bfcl_subset.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DATASET = MODULE.ROOT / "research/goalspec/runs/local-bfcl-v4-dataset-20260916"


def synthetic_rows():
    answers = {row["id"]: row for row in MODULE.lines(MODULE.PACKAGE / "bfcl_eval/data/possible_answer/BFCL_v4_multiple.json")}
    for case in MODULE.read(DATASET / "public-cases.json")["entries"]:
        calls = []
        if case["category"] == "multiple":
            for expected in answers[case["id"]]["ground_truth"]:
                for name, values in expected.items():
                    args = {key: candidates[0] for key, candidates in values.items() if candidates[0] != ""}
                    calls.append({"id": "synthetic", "name": name.replace(".", "_"), "arguments": args})
        yield {"id": case["id"], "category": case["category"], "status": "completed", "latencyMs": 0,
               "result": {"calls": calls}}


def make_run(path, rows):
    path.mkdir()
    (path / "predictions.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    MODULE.write(path / "summary.json", {"closed": True})


def test_selected_gold_controls_match_unmodified_checker(tmp_path):
    make_run(tmp_path / "run", list(synthetic_rows()))
    MODULE.score(DATASET, tmp_path / "run", tmp_path / "score")
    report = MODULE.read(tmp_path / "score/report.json")
    assert report["correct"] == report["total"] == 64


def test_failed_requests_are_failures_even_for_irrelevance(tmp_path):
    rows = list(synthetic_rows())
    for row in rows:
        row["status"] = "failed"
        row["result"] = None
    make_run(tmp_path / "run", rows)
    MODULE.score(DATASET, tmp_path / "run", tmp_path / "score")
    assert MODULE.read(tmp_path / "score/report.json")["correct"] == 0


def test_missing_declared_case_rejected(tmp_path):
    make_run(tmp_path / "run", list(synthetic_rows())[:-1])
    with pytest.raises(ValueError, match="Complete closed"):
        MODULE.score(DATASET, tmp_path / "run", tmp_path / "score")


def test_wrong_function_and_argument_rejected_by_upstream():
    _, check, language, _, _ = MODULE.upstream_functions()
    original = MODULE.lines(MODULE.PACKAGE / "bfcl_eval/data/BFCL_v4_multiple.json")[0]
    answer = MODULE.lines(MODULE.PACKAGE / "bfcl_eval/data/possible_answer/BFCL_v4_multiple.json")[0]
    assert not check(original["function"], [{"wrong": {}}], answer["ground_truth"], language.PYTHON, "multiple", "goalspec-gpt54-FC")["valid"]
    assert not check(original["function"], [{"triangle_properties_get": {"side1": 999, "side2": 4, "side3": 3}}], answer["ground_truth"], language.PYTHON, "multiple", "goalspec-gpt54-FC")["valid"]
