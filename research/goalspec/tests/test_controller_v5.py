import copy
import json
from pathlib import Path
import pytest
from goalspec.contracts_v1 import hash_v1
from goalspec.controller_v5 import candidate_features, metrics, probabilities, validate_artifact

ROOT = Path(__file__).resolve().parents[3]
DATASET = ROOT / "research/goalspec/runs/local-controller-v5-dataset-20260916-b/dataset.jsonl"
ARTIFACT = ROOT / "research/goalspec/runs/local-controller-v5-trained-20260916/controller.json"


def _artifact():
    body = {"version": "goalspec-controller-v5", "featureVersion": "goalspec-controller-features-v5.1", "architecture": "listwise-linear-neutral-plus-goal-residual",
        "neutralWeights": [0] * 120, "goalWeights": [0] * 72,
        "calibration": {"neutralTemperature": 1, "goalTemperature": 1, "reliability": {"status": "unavailable", "bins": [], "sourceHashes": []}},
        "lineage": {"datasetHash": "a" * 64, "trainingFamilies": ["train"], "selectionFamilies": ["select"], "calibrationFamilies": ["cal"],
            "goalTraining": "literal-request-proxy", "excludedPriorHeldout": True, "sources": []}}
    return {**body, "contentHash": hash_v1(body)}


def _rehash(a):
    a["contentHash"] = hash_v1({k: v for k, v in a.items() if k != "contentHash"})
    return a


@pytest.mark.parametrize("defect", ["hash", "shape", "family", "semantic", "temperature"])
def test_invalid_artifact_rejected(defect):
    a = _artifact()
    if defect == "hash":
        a["neutralWeights"][0] = 5
    elif defect == "shape":
        a["neutralWeights"].pop(); _rehash(a)
    elif defect == "family":
        a["lineage"]["calibrationFamilies"] = ["train"]; _rehash(a)
    elif defect == "semantic":
        a["calibration"]["reliability"]["status"] = "teacher-calibrated"; _rehash(a)
    else:
        a["calibration"]["neutralTemperature"] = 0; _rehash(a)
    with pytest.raises(ValueError): validate_artifact(a)


def test_no_read_uncovered_and_current_candidates_normalize_jointly():
    row = {"features": [{"neutral": [1, 0], "goal": [0]}, {"neutral": [0, 1], "goal": [0]}, {"neutral": [0, 0], "goal": [0]}]}
    p = probabilities(row, [2, 1])
    assert sum(p) == pytest.approx(1)
    assert p[0] > p[1] > p[2]


@pytest.mark.skipif(not DATASET.exists(), reason="Local closed training-only dataset unavailable")
def test_actual_exported_ts_vectors_match_python_without_future_inputs():
    rows = [json.loads(line) for line in DATASET.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 239
    for row in rows:
        assert "confirmation" not in row["cohort"]
        for choice, expected in zip([*row["candidates"], "NO_READ", "READ_UNCOVERED"], row["features"]):
            actual = candidate_features(row["context"], choice)
            for head in ["neutral", "goal"]: assert actual[head] == pytest.approx(expected[head], abs=1e-12)
        altered = copy.deepcopy(row)
        altered["actual"] = [{"tool": "future_wrong", "arguments": {"hidden": "value"}}]
        assert candidate_features(altered["context"], "NO_READ") == candidate_features(row["context"], "NO_READ")


@pytest.mark.skipif(not ARTIFACT.exists(), reason="Local closed CPU artifact unavailable")
def test_actual_artifact_is_portable_and_semantic_reliability_is_explicitly_missing():
    a = validate_artifact(json.loads(ARTIFACT.read_text(encoding="utf-8")))
    assert a["calibration"]["reliability"] == {"status": "unavailable", "bins": [], "sourceHashes": []}
    assert any(a["neutralWeights"])


@pytest.mark.skipif(
    not ARTIFACT.exists() or not DATASET.exists(),
    reason="Local closed CPU artifact or historical training dataset unavailable",
)
def test_actual_artifact_reproduces_historical_calibration_metrics():
    a = validate_artifact(json.loads(ARTIFACT.read_text(encoding="utf-8")))
    rows = [json.loads(line) for line in DATASET.read_text(encoding="utf-8").splitlines()]
    result = metrics([row for row in rows if row["split"] == "calibration"], a["neutralWeights"], temperature=a["calibration"]["neutralTemperature"])
    assert result["checkpoints"] == 20
    assert result["estimatedActionCrossEntropyNats"] == pytest.approx(.7087777959191088)
