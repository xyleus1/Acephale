"""Causal paid replay queues and independently annotated requested-goal metrics.

Teacher annotation inputs contain user messages visible at the checkpoint, public
policy, and no actor actions, observations, outcomes, evaluator labels or future.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path

from goalspec.contracts_v1 import hash_v1
from goalspec.evaluation_v1 import cluster_interval
from goalspec.goals import fit_goals
from goalspec.models import public_model_input
from goalspec.prediction_v1 import scope_key
from goalspec.replay import decision_points
from goalspec.schemas import Record, Trajectory


def prepare_requested_replay(training: list[Trajectory], heldout: list[Trajectory], output: Path):
    if not training or not heldout or {t.group_id for t in training} & {t.group_id for t in heldout}:
        raise ValueError("Nonempty disjoint training and held-out families required")
    by_scope = defaultdict(list)
    for trace in training:
        by_scope[scope_key(trace)].append(trace)
    catalogs = {key: fit_goals(values) for key, values in by_scope.items()}
    queue = []
    for trace in heldout:
        key = scope_key(trace)
        if key not in catalogs:
            raise ValueError("Held-out checkpoint lacks compatible training catalog")
        for point in decision_points(trace):
            prefix = point.prefix
            requested = {f"request:{event.seq}": event.content or "" for event in prefix.events
                         if event.kind == "message" and event.role == "user"}
            annotation_input = {"policy": prefix.policy, "sources": requested}
            visible = public_model_input(prefix)
            queue.append({
                "schemaVersion": "1.0.0", "id": hash_v1([trace.trajectory_id, prefix.through_seq]),
                "trajectory_id": trace.trajectory_id, "through_seq": prefix.through_seq,
                "familyId": trace.group_id, "taskId": trace.task_id, "domain": trace.domain,
                "trial": trace.trial, "visible_input_hash": hash_v1(visible),
                "requested_input": annotation_input, "requested_input_hash": hash_v1(annotation_input),
                "pattern_goal_catalog": [g.model_dump(mode="json") for g in catalogs[key].signatures],
                "catalog_hash": hash_v1(catalogs[key].model_dump(mode="json")),
            })
    if len({row["id"] for row in queue}) != len(queue):
        raise ValueError("Duplicate causal checkpoint identity")
    output.mkdir(parents=True, exist_ok=False)
    (output / "queue.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in queue), encoding="utf-8")
    manifest = {"schemaVersion": "1.0.0", "checkpoints": len(queue),
                "uniqueRequestedInputs": len({r["requested_input_hash"] for r in queue}),
                "queueHash": hash_v1(queue), "trainingFamilies": sorted({t.group_id for t in training}),
                "heldoutFamilies": sorted({t.group_id for t in heldout}),
                "inputPolicy": "predict_requested_goals_from_current_visible_user_messages_and_public_policy_only",
                "noEndpointLabelsInTeacherInput": True,
                "predictionModel": "gpt-4.1-mini-2025-04-14", "teacherModel": "gpt-5.4-2026-03-05"}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


class RequestedScore(Record):
    familyId: str
    domain: str
    trajectoryId: str
    throughSeq: int
    top1: float
    top3: float
    teacherUnknown: bool


def requested_goal_report(queue: list[dict], predictions: list[dict], annotations: list[dict], grades: list[dict], *, bootstrap_samples=2000):
    if not queue or len({q["id"] for q in queue}) != len(queue):
        raise ValueError("Nonempty unique checkpoint queue required")
    pred = {row["id"]: row for row in predictions}
    truth = {row["requested_input_hash"]: row for row in annotations}
    judged = {row["id"]: row for row in grades}
    if len(pred) != len(predictions) or len(truth) != len(annotations) or len(judged) != len(grades):
        raise ValueError("Duplicate requested-goal records")
    if set(pred) != {q["id"] for q in queue} or set(judged) != set(pred) or set(truth) != {q["requested_input_hash"] for q in queue}:
        raise ValueError("Missing or unexpected requested-goal checkpoints")
    scores = []
    failures = defaultdict(int)
    for checkpoint in queue:
        prediction, grade, reference = pred[checkpoint["id"]], judged[checkpoint["id"]], truth[checkpoint["requested_input_hash"]]
        if (prediction["requested_input_hash"] != checkpoint["requested_input_hash"]
                or grade["prediction_hash"] != hash_v1(prediction)
                or grade["annotation_hash"] != hash_v1(reference)):
            raise ValueError("Requested-goal scoring provenance changed")
        if reference["status"] != "completed":
            failures["annotation"] += 1
            continue
        unknown = reference["annotation"]["unknown"]
        if prediction["status"] != "completed":
            failures["prediction"] += 1
        if grade["status"] != "completed":
            failures["grading"] += 1
            # No teacher verdict means accuracy is unmeasured, not a guess.
            continue
        matches = grade["matches"]
        if len(matches) != len(grade["ranked_ids"]) or len(matches) > 4:
            raise ValueError("Malformed requested-goal ranks")
        top1 = bool(matches[:1] and matches[0]) and prediction["status"] == "completed"
        top3 = any(matches[:3]) and prediction["status"] == "completed"
        scores.append(RequestedScore(familyId=checkpoint["familyId"], domain=checkpoint["domain"],
                                    trajectoryId=checkpoint["trajectory_id"], throughSeq=checkpoint["through_seq"],
                                    top1=float(top1), top3=float(top3), teacherUnknown=unknown))
    return {"schemaVersion": "1.0.0", "label": "automated teacher-referenced requested-goal assessment",
            "teacher": "gpt-5.4-2026-03-05", "predictor": "gpt-4.1-mini-2025-04-14",
            "checkpoints": len(queue), "scoredCheckpoints": len(scores), "unknownReferences": sum(s.teacherUnknown for s in scores),
            "checkpointReferencesHash": hash_v1(sorted([{"trajectoryId": q["trajectory_id"], "visibleInputHash": q["visible_input_hash"]} for q in queue], key=lambda value: (value["trajectoryId"], value["visibleInputHash"]))),
            "failures": dict(failures), "completeAnnotationAndGradingCoverage": len(scores) == len(queue),
            "goalTop1": sum(s.top1 for s in scores) / len(scores) if scores else None,
            "goalTop3": sum(s.top3 for s in scores) / len(scores) if scores else None,
            "goalTop1FamilyInterval": cluster_interval(scores, lambda r: r.top1, bootstrap_samples=bootstrap_samples),
            "goalTop3FamilyInterval": cluster_interval(scores, lambda r: r.top3, bootstrap_samples=bootstrap_samples),
            "limitations": ["Teacher references and semantic matching are automated, not human ground truth.",
                            "Annotation and grading share one teacher model and may share systematic errors.",
                            "Only currently visible user requirements and public policy determine requested references.",
                            "Endpoint/oracle action labels are separate and do not enter annotation or requested-goal matching.",
                            "Predictor failures count as misses. Missing teacher annotations or grades remain unmeasured with explicit coverage.",
                            "Top-3 ranks include explicit unknown alongside up to three goal hypotheses."]}


def publish_requested_report(queue_path: Path, prediction_directory: Path, annotation_directory: Path, grade_directory: Path, output: Path):
    def lines(path):
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    paths = [queue_path, prediction_directory / "requested-predictions.jsonl", annotation_directory / "requested-annotations.jsonl", grade_directory / "requested-grades.jsonl"]
    result = requested_goal_report(*(lines(path) for path in paths))
    output.mkdir(parents=True, exist_ok=False)
    (output / "summary.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    text = ("# Requested-goal evaluation\n\nAutomated teacher-referenced assessment, separate from achieved endpoints.\n\n"
            f"Scored checkpoints: {result['scoredCheckpoints']}/{result['checkpoints']}. "
            f"Goal Top-1: {result['goalTop1']}; Goal Top-3: {result['goalTop3']}.\n\n"
            "".join(f"- {limitation}\n" for limitation in result["limitations"]))
    (output / "report.md").write_text(text, encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({"inputHashes": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}, "summaryHash": hash_v1(result)}, indent=2) + "\n", encoding="utf-8")
    return result
