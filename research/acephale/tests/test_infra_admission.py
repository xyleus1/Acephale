"""Synthetic evidence tests only; these artifacts are never live calibration."""

from __future__ import annotations

import json

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_admission import (
    COMPONENTS,
    OPPORTUNITY_PROFILE_KEYS,
    build_goal_reliability,
    build_opportunity,
    measured_duration,
    wilson_lower,
)
from acephale.infra_cli import main
from acephale.infra_data import publish_bundle
from acephale.storage import file_hash


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def lines(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def sealed(path, body):
    write(path, {**body, "contentHash": hash_v1(body)})


@pytest.fixture
def evidence(tmp_path):
    public, predictions, annotations, reviews, grades, measurements = [], [], [], [], [], []
    profile = {key: hash_v1(key) for key in OPPORTUNITY_PROFILE_KEYS}
    profile["protocolHash"] = hash_v1("synthetic fixture only")
    for index in range(22):
        key = f"fixture-{index}"
        partition = "train" if index < 20 else "development"
        value = {"sources": [{"id": "request", "value": "Find the order"}], "events": [], "tools": []}
        prefix = {"checkpoint_id": key, "input_hash": hash_v1(value), "family_id": f"family-{partition}", "split": partition,
                  "request_revision": "request-1", "input": value}
        public.append(prefix)
        identity = {field: prefix[field] for field in ("checkpoint_id", "input_hash", "family_id", "split")}
        goals = {"schemaVersion": 1, "hypotheses": [{"id": "goal", "objective": "Find order", "probability": 1,
                 "sources": [{"sourceId": "request", "path": []}], "constraints": []}], "unknown": 0, "revisionHash": hash_v1({})}
        predictions.append({**identity, "status": "completed", "goals": goals})
        spans = {name: {"clockId": "fixture-clock", "startMs": 1, "endMs": index + 2 if name in {"toolMs", "actorLeadMs"} else index + 1} for name in COMPONENTS}
        raw = tmp_path / f"raw-{index}.json"
        write(raw, {"kind": "observed_infra_timing", "checkpoint_id": key, "spans": spans, "profileHash": hash_v1(profile)})
        measurements.append({**identity, "status": "completed", "spans": spans, "profileHash": hash_v1(profile), "evidence": {"path": raw.name, "sha256": file_hash(raw)}})
        if partition == "train":
            annotation = {"checkpoint_id": key, "input_hash": prefix["input_hash"], "request_revision": "request-1",
                          "annotation_version": "fixture-v1", "teacher_model": "fixture-teacher", "goals": [], "unknown_probability": 1}
            annotations.append(annotation)
            reviews.append({"checkpoint_id": key, "annotationHash": hash_v1(annotation), "reviewer": "fixture-human",
                            "rubric_version": "fixture-v1", "semantics_acceptable": True, "unsupported_binding": False})
            grades.append({"checkpoint_id": key, "input_hash": prefix["input_hash"], "annotationHash": hash_v1(annotation),
                           "predictionGoalHash": hash_v1(goals), "reviewer": "fixture-grader", "rubric_version": "fixture-v1",
                           "grading_kind": "independent_model", "agreed": index < 18})
    bundle = tmp_path / "bundle"
    dataset = publish_bundle(bundle, {"public.jsonl": public})
    directory = tmp_path / "predictions"
    directory.mkdir()
    manifest = {"version": 1, "kind": "uncalibrated_prediction_replay", "executionAllowed": False, "inferGoals": True,
                "sourceDatasetHash": dataset["bundle_hash"], "model": {"repository": "fixture-predictor", "revision": "a" * 40},
                "memoryHash": "b" * 64, "predictorContractHash": "c" * 64, "candidateCompilerHash": "d" * 64, "retrievalHash": "e" * 64,
                "rowIds": [row["checkpoint_id"] for row in predictions]}
    sealed(directory / "manifest.json", manifest)
    lines(directory / "predictions.jsonl", predictions)
    write(directory / "receipt.json", {"declared": 22, "completed": 22, "failed": 0, "liveActorExecuted": False, "toolExecutionPerformed": False})
    for name, rows in (("annotations", annotations), ("reviews", reviews), ("grades", grades)):
        lines(tmp_path / f"{name}.jsonl", rows)
    pilot = {"source_dataset_hash": dataset["bundle_hash"], "checkpoints": [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"]} for row in annotations],
             "audit": [{"checkpoint_id": row["checkpoint_id"]} for row in annotations]}
    write(tmp_path / "pilot.json", pilot)
    timing = {"version": 2, "profile": profile, "kind": "measured_infra_opportunity", "sourceDatasetHash": dataset["bundle_hash"],
              "protocol": "synthetic fixture only", "rowIds": [row["checkpoint_id"] for row in measurements], "rows": measurements}
    sealed(tmp_path / "measurements.json", timing)
    return tmp_path, public, predictions, grades, reviews, timing


def reliability(root):
    return build_goal_reliability(root / "bundle", root / "predictions", root / "annotations.jsonl", root / "pilot.json", root / "reviews.jsonl", root / "grades.jsonl")


def test_opportunity_uses_lower_benefits_upper_costs_and_retains_source_hash(evidence):
    root, *_, timing = evidence
    artifact, report, observations = build_opportunity(root / "bundle", root / "measurements.json")
    assert artifact["estimate"] == {name: 3 if name in {"toolMs", "actorLeadMs"} else 19 for name in COMPONENTS}
    assert artifact["sampleCount"] == 22
    assert artifact["version"] == 2 and artifact["profile"] == timing["profile"]
    assert artifact["contentHash"] == hash_v1({key: value for key, value in artifact.items() if key != "contentHash"})
    assert len(observations) == 22 and report["heldoutClaim"] is False


def test_paired_contention_uses_two_observed_intervals_without_zero_fallback():
    comparison = {"method": "paired_difference", "baseline": {"clockId": "one", "startMs": 10, "endMs": 20},
                  "concurrent": {"clockId": "one", "startMs": 30, "endMs": 46}}
    assert measured_duration(comparison, comparison=True) == 6
    comparison["concurrent"]["endMs"] = 35
    with pytest.raises(ValueError, match="Negative"):
        measured_duration(comparison, comparison=True)
    comparison["concurrent"]["clockId"] = "other"
    with pytest.raises(ValueError, match="one monotonic"):
        measured_duration(comparison, comparison=True)


@pytest.mark.parametrize("defect", ["missing_cost", "raw_changed", "short_cohort", "unretained", "heldout", "negative", "legacy", "profile_changed", "profile_missing", "protocol_changed", "row_profile_changed"])
def test_opportunity_rejects_unmeasured_or_contaminated_inputs(evidence, defect):
    root, *_, timing = evidence
    if defect == "missing_cost":
        del timing["rows"][0]["spans"]["contentionMs"]
    elif defect == "raw_changed":
        write(root / "raw-0.json", {})
    elif defect == "short_cohort":
        timing["rows"] = timing["rows"][:9]
        timing["rowIds"] = timing["rowIds"][:9]
    elif defect == "unretained":
        timing["rows"].pop()
    elif defect == "heldout":
        timing["rows"][0]["split"] = "test"
    elif defect == "legacy":
        timing["version"] = 1
    elif defect == "profile_changed":
        timing["profile"]["hardwareHash"] = hash_v1("another accelerator")
    elif defect == "profile_missing":
        del timing["profile"]["servingHash"]
    elif defect == "protocol_changed":
        timing["protocol"] = "changed interval semantics"
    elif defect == "row_profile_changed":
        timing["rows"][0]["profileHash"] = hash_v1("other")
    else:
        timing["rows"][0]["spans"]["predictionMs"]["endMs"] = -1
    sealed(root / "measurements.json", timing)
    with pytest.raises(ValueError):
        build_opportunity(root / "bundle", root / "measurements.json")


def test_reliability_requires_audit_and_uses_wilson_not_raw_agreement(evidence):
    root = evidence[0]
    artifact, report, joined = reliability(root)
    assert artifact["gradedCount"] == 20 and artifact["agreedCount"] == 18
    assert artifact["reliability"] == wilson_lower(18, 20) < .9
    assert len(report["excludedDevelopmentCheckpoints"]) == 2
    assert len(joined) == 20


@pytest.mark.parametrize("defect", ["missing_grade", "stale_goal", "stale_review", "failed_audit", "self_grade", "missing_review", "unsupported_source"])
def test_reliability_refuses_partial_or_unbound_grading(evidence, defect):
    root, _, predictions, grades, reviews, _ = evidence
    if defect == "missing_grade":
        grades.pop()
    elif defect == "stale_goal":
        grades[0]["predictionGoalHash"] = "e" * 64
    elif defect == "stale_review":
        reviews[0]["annotationHash"] = "e" * 64
    elif defect == "failed_audit":
        reviews[0]["unsupported_binding"] = True
    elif defect == "self_grade":
        grades[0]["reviewer"] = "fixture-predictor"
    elif defect == "missing_review":
        reviews.pop()
    else:
        predictions[0]["goals"]["hypotheses"][0]["sources"][0]["sourceId"] = "private-answer"
    lines(root / "grades.jsonl", grades)
    lines(root / "reviews.jsonl", reviews)
    lines(root / "predictions/predictions.jsonl", predictions)
    with pytest.raises(ValueError):
        reliability(root)


def test_cli_publishes_exclusive_runtime_artifacts(evidence, capsys):
    root = evidence[0]
    main(["build-opportunity", "--bundle", str(root / "bundle"), "--measurements", str(root / "measurements.json"), "--output", str(root / "opportunity")])
    assert (root / "opportunity/opportunity.json").is_file()
    args = ["build-goal-reliability", "--bundle", str(root / "bundle"), "--predictions", str(root / "predictions"),
            "--annotations", str(root / "annotations.jsonl"), "--pilot", str(root / "pilot.json"), "--reviews", str(root / "reviews.jsonl"),
            "--grades", str(root / "grades.jsonl"), "--output", str(root / "reliability")]
    main(args)
    assert (root / "reliability/goal-reliability.json").is_file()
    with pytest.raises(FileExistsError):
        main(args)
    assert "bundle_hash" in capsys.readouterr().out
