"""Compare complete v1/v2 replay caches on the same 213 archived checkpoints."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RUNS = ROOT / "research/goalspec/runs"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.contracts_v1 import hash_v1  # noqa: E402
from goalspec.evaluation_v1 import cluster_interval  # noqa: E402
from summarize_study import independent_goal_check  # noqa: E402


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def unique(rows, key):
    result = {key(row): row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate paired checkpoint or prediction row")
    return result


def main(output):
    output = output.resolve()
    if output.exists() or output.parent != HERE:
        raise ValueError("Use a new output directory directly under the v2 report")
    base = RUNS / "local-v2-legacy-replay-20260915"
    files = {
        "v1Queue": RUNS / "local-requested-queue-v1-20260915/queue.jsonl",
        "v2Queue": base / "queue.jsonl", "map": base / "checkpoint-map.jsonl",
        "v1Predictions": RUNS / "local-requested-predict-v1-20260915/requested-predictions.jsonl",
        "v2Predictions": base / "predictions/requested-predictions.jsonl",
        "v1Grades": RUNS / "local-requested-grade-v1-20260915/requested-grades.jsonl",
        "v2Grades": base / "grades/requested-grades.jsonl",
        "v1Annotations": RUNS / "local-requested-annotate-v1-20260915/requested-annotations.jsonl",
        "v2Annotations": base / "annotations/requested-annotations.jsonl",
        "v1RequestedSummary": RUNS / "local-requested-analysis-v1-20260915/summary.json",
        "v2RequestedSummary": HERE / "legacy-requested-analysis/summary.json",
        "v1PredictionRows": RUNS / "local-prediction-analysis-v1-20260915/predictions.jsonl",
        "v2PredictionRows": HERE / "legacy-prediction-analysis/predictions.jsonl",
        "v1PredictionSummary": RUNS / "local-prediction-analysis-v1-20260915/summary.json",
        "v2PredictionSummary": HERE / "legacy-prediction-analysis/summary.json",
    }
    q1, q2 = [unique(lines(files[k]), lambda r: r["id"]) for k in ("v1Queue", "v2Queue")]
    mapping = lines(files["map"])
    if len(mapping) != 213 or len(q1) != 213 or len(q2) != 213 or {r["id"] for r in mapping} != set(q2) or {r["original_checkpoint_id"] for r in mapping} != set(q1):
        raise ValueError("Expected the exact paired 213-checkpoint cohort")
    if files["v1Annotations"].read_bytes() != files["v2Annotations"].read_bytes():
        raise ValueError("Paired teacher references changed")
    annotations = unique(lines(files["v1Annotations"]), lambda r: r["requested_input_hash"])
    if len(annotations) != 109:
        raise ValueError("Expected the original 109 unchanged teacher references")
    versions = {}
    for version in ("v1", "v2"):
        versions[version] = {
            "predictions": unique(lines(files[version + "Predictions"]), lambda r: r["id"]),
            "grades": unique(lines(files[version + "Grades"]), lambda r: r["id"]),
            "summary": read(files[version + "RequestedSummary"]),
        }
        expected_ids = set(q1 if version == "v1" else q2)
        if any(set(versions[version][kind]) != expected_ids for kind in ("predictions", "grades")):
            raise ValueError("Prediction and grade cache IDs must match exactly the paired queue")
    schema = read(ROOT / "src/lib/goalspec/contracts/v1.schema.json")
    validator = Draft202012Validator({**schema, "$ref": "#/$defs/GoalSet"})
    paired = []
    for item in mapping:
        old, new = q1[item["original_checkpoint_id"]], q2[item["id"]]
        if {k: v for k, v in old.items() if k != "id"} != {k: v for k, v in new.items() if k != "id"}:
            raise ValueError("A paired visible input, catalog, or checkpoint identity changed")
        if (item["requested_input_hash"], item["trajectory_id"], item["through_seq"]) != (new["requested_input_hash"], new["trajectory_id"], new["through_seq"]):
            raise ValueError("Checkpoint mapping provenance mismatch")
        row = {"originalCheckpointId": old["id"], "v2CheckpointId": new["id"], "familyId": old["familyId"],
               "domain": old["domain"], "trajectoryId": old["trajectory_id"], "throughSeq": old["through_seq"],
               "visibleInputHash": old["visible_input_hash"], "requestedInputHash": old["requested_input_hash"]}
        for version, checkpoint in (("v1", old), ("v2", new)):
            prediction = versions[version]["predictions"][checkpoint["id"]]
            grade = versions[version]["grades"][checkpoint["id"]]
            annotation = annotations[checkpoint["requested_input_hash"]]
            if (prediction["requested_input_hash"] != checkpoint["requested_input_hash"] or grade["prediction_hash"] != hash_v1(prediction)
                    or grade["annotation_hash"] != hash_v1(annotation) or grade["status"] != "completed" or annotation["status"] != "completed"):
                raise ValueError("Incomplete or mismatched paired teacher assessment")
            valid = prediction["status"] == "completed"
            if valid:
                independent_goal_check(prediction["requested_goals"], checkpoint["requested_input"]["sources"], validator)
            matches = grade["matches"]
            row[version + "Valid"] = valid
            row[version + "SemanticTop1"] = valid and bool(matches and matches[0])
            row[version + "SemanticTop3"] = valid and any(matches[:3])
        paired.append(row)
    aggregate = {}
    for metric in ("Valid", "SemanticTop1", "SemanticTop3"):
        old_count = sum(r["v1" + metric] for r in paired)
        new_count = sum(r["v2" + metric] for r in paired)
        observations = [SimpleNamespace(domain=r["domain"], familyId=r["familyId"], difference=int(r["v2" + metric]) - int(r["v1" + metric])) for r in paired]
        aggregate[metric] = {"checkpoints": 213, "v1Count": old_count, "v2Count": new_count,
            "v1Rate": old_count / 213, "v2Rate": new_count / 213, "rawPairedDifference": (new_count - old_count) / 213,
            "pairedFamilyInterval": cluster_interval(observations, lambda r: r.difference),
            "gained": sum(not r["v1" + metric] and r["v2" + metric] for r in paired),
            "lost": sum(r["v1" + metric] and not r["v2" + metric] for r in paired)}
    for version in ("v1", "v2"):
        result = versions[version]["summary"]
        if (result["checkpoints"] != 213 or result["scoredCheckpoints"] != 213 or not result["completeAnnotationAndGradingCoverage"]
                or not math.isclose(result["goalTop1"], aggregate["SemanticTop1"][version + "Rate"], abs_tol=1e-12)
                or not math.isclose(result["goalTop3"], aggregate["SemanticTop3"][version + "Rate"], abs_tol=1e-12)):
            raise ValueError("Paired scores differ from the frozen evaluation algorithm")
    key = lambda r: (r["trajectoryId"], r["seq"], r["condition"], r["rankingControl"])
    old_rows, new_rows = [unique(lines(files[k]), key) for k in ("v1PredictionRows", "v2PredictionRows")]
    if len(old_rows) != 2982 or set(old_rows) != set(new_rows):
        raise ValueError("Expected matching 14 x 213 prediction rows")
    unchanged = {"stateless", "local_paste", "paste_memory", "oracle_goals"}
    pool_hashes = defaultdict(set)
    for identity, new in new_rows.items():
        old = old_rows[identity]
        for field in ("actualTool", "actualArguments", "visibleInputHash", "familyId", "taskId", "domain", "goalExpected"):
            if old[field] != new[field]:
                raise ValueError("Paired prediction target or visible source changed")
        condition = new["condition"].removesuffix("__same_pool")
        if condition in unchanged and old != new:
            raise ValueError("A goal-cache-independent baseline prediction changed")
        if new["rankingControl"]:
            if old["candidatePoolHash"] != new["candidatePoolHash"]:
                raise ValueError("Identical-pool binding candidates changed between versions")
            pool_hashes[(new["trajectoryId"], new["seq"])].add(new["candidatePoolHash"])
    if len(pool_hashes) != 213 or any(len(v) != 1 for v in pool_hashes.values()):
        raise ValueError("Ranking controls do not share one candidate pool at every checkpoint")
    prediction_summary = read(files["v2PredictionSummary"])
    conditions = [{"condition": name, "rankingControl": name.endswith("__same_pool"), **value}
                  for name, value in prediction_summary["conditions"].items()]
    version_loss = []
    for name in ("goalspec", "goalspec_no_memory", "shuffled_goals"):
        for control in (False, True):
            for metric in ("toolNll", "actionNll"):
                observations = [SimpleNamespace(domain=new["domain"], familyId=new["familyId"],
                    difference=old_rows[identity][metric] - new[metric]) for identity, new in new_rows.items()
                    if new["condition"].removesuffix("__same_pool") == name and new["rankingControl"] == control]
                if len(observations) != 213:
                    raise ValueError("Expected 213 paired version-loss observations")
                version_loss.append({"condition": name, "rankingControl": control, "metric": metric,
                    "direction": "v1_minus_v2_positive_favors_v2", **cluster_interval(observations, lambda row: row.difference)})
    endpoint = {}
    for name in prediction_summary["conditions"]:
        values = [r for r in new_rows.values()
                  if r["condition"].removesuffix("__same_pool") == name.removesuffix("__same_pool")
                  and r["rankingControl"] == name.endswith("__same_pool")]
        if len(values) != 213:
            raise ValueError("Endpoint proxy condition must contain exactly 213 checkpoints")
        endpoint[name] = {"matches": sum(r["goalTop1"] is True for r in values),
                          "unknownMatches": sum(r["goalTop1"] is True and r["goalExpected"] == "__unknown__" for r in values)}
    result = {"schemaVersion": "local-v2-paired-legacy-comparison-1", "scope": "Previously observed v1 checkpoints used as v2 development evidence",
              "pairedCheckpoints": 213, "unchangedTeacherReferences": 109, "goalMetrics": aggregate,
              "predictionConditions": conditions, "pairedNllComparisons": prediction_summary["comparisons"],
              "pairedVersionLossDifferences": version_loss,
              "endpointGoalMatches": endpoint, "visibleInputsAndTargetsIdentical": True, "goalIndependentBaselinesUnchanged": True,
              "identicalPoolControlsVerified": True, "meanAndIntervalWeighting": "Condition means and raw rates weight checkpoints equally; family intervals weight domains and families equally",
              "protocolFailureInterpretation": "Original v1 parser/contract failures remain failures and cannot measure inferred-goal quality",
              "sourceInputs": [{"label": label, "path": p.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for label, p in {
                  **files, "formatter": Path(__file__), "goalValidator": HERE / "summarize_study.py",
                  "canonicalSchema": ROOT / "src/lib/goalspec/contracts/v1.schema.json",
                  "intervalAlgorithm": ROOT / "research/goalspec/src/goalspec/evaluation_v1.py",
              }.items()]}
    output.mkdir()
    (output / "summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for name, values in (("paired-goal-checkpoints.csv", paired), ("prediction-conditions.csv", conditions),
                         ("paired-version-loss-differences.csv", version_loss),
                         ("paired-nll-differences.csv", prediction_summary["comparisons"])):
        fields = list(dict.fromkeys(k for row in values for k in row))
        with (output / name).open("x", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(values)
    text = ["# Paired legacy checkpoint comparison", "", "Same 213 archived checkpoints and 109 unchanged automated teacher references. This is v2 development evidence, not fresh confirmation.", "",
            "| Metric | v1 | v2 | Raw paired change |", "| --- | ---: | ---: | ---: |"]
    for metric, value in aggregate.items():
        text.append(f"| {metric} | {value['v1Count']}/213 | {value['v2Count']}/213 | {value['rawPairedDifference']:+.6f} |")
    text += ["", "Paired family intervals and all seven prediction conditions plus their seven identical-pool controls are in summary.json. Raw checkpoint means and family-weighted interval estimates use different weights. Original v1 failures remain misses; validity is separate from semantic completeness.", "",
             "Visible inputs, targets, unchanged baseline predictions, and identical candidate pools were verified. Endpoint-label matches, including unknown matches, remain separate from teacher-scored requested-goal accuracy."]
    for control in (False, True):
        text += ["", "## " + ("Identical candidate pool ranking controls" if control else "Seven frozen prediction conditions"), "",
                 "All entries use 213 checkpoints. Full-argument accuracy requires the correct tool and the complete current argument object.", "",
                 "| Condition | Tool top-1 | Tool top-3 | Full args top-1 | Full args top-3 | Tool NLL | Action NLL |",
                 "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for row in conditions:
            if row["rankingControl"] != control:
                continue
            def rate(key):
                return f"{round(row[key] * 213)}/213 ({row[key]:.6f})"
            text.append(f"| {row['condition']} | {rate('toolTop1')} | {rate('toolTop3')} | {rate('argumentsTop1')} | {rate('argumentsTop3')} | {row['toolNll']:.9f} | {row['actionNll']:.9f} |")
        text += ["", "| Treatment vs local PASTE | Loss | Family-weighted reduction | 95% family interval | Relative reduction |",
                 "| --- | --- | ---: | --- | ---: |"]
        for row in prediction_summary["comparisons"]:
            if row["rankingControl"] == control:
                text.append(f"| {row['treatment']} | {row['metric']} | {row['estimate']:+.9f} | [{row['ci95'][0]:+.9f}, {row['ci95'][1]:+.9f}] | {row['relativeEstimatedReduction']:+.6%} |")
    text += ["", "NLL is in nats with probability floor 1e-12. Positive paired reduction favors the treatment. 'Entropy reduction' here is a predictive cross-entropy estimate, not a measurement of true conditional entropy. Intervals use 14 families in two domains, 2,000 bootstrap draws and seed 42, with no multiple-comparison adjustment.", "",
             "The identical-pool control verifies the same bound candidate actions for all seven rankers at each checkpoint. It changes only tool-level ranking and allocates each tool's probability uniformly across its candidate argument objects; it does not establish a learned within-tool argument ranker. These frozen prediction scores contain no new native execution and do not measure live latency or task success."]
    (output / "README.md").write_text("\n".join(text) + "\n", encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({"files": [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.iterdir())],
                 "sourceInputs": result["sourceInputs"]}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "goalMetrics": aggregate}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    main(parser.parse_args().output)
