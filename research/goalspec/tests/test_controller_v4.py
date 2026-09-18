import json
import copy
from pathlib import Path

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.controller_v4 import build_decision_state, candidate_features, infer, validate_artifact

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "src/lib/goalspec/contracts/v4-controller.schema.json"
TRAINED = ROOT / "research/goalspec/runs/local-controller-v4-trained-20260916-b"
ACTION_KIND = ROOT / "research/goalspec/runs/local-controller-v4-action-kind-20260916/action-kind.json"


def fixture_artifact():
    artifact = {
        "version": "goalspec-controller-artifact-v1", "featureVersion": "goalspec-controller-features-v1",
        "goalFeaturePolicy": "public-request-only", "inputDimension": 216, "architecture": "logistic",
        "layers": [{"weights": [[0] * 216 for _ in range(5)], "bias": [2, 2, 2, 2, 100], "activation": "linear"}],
        "heads": ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"],
        "trainedHeads": {"actionRead": True, "nextAction": True, "usefulWithin2": True, "readiness": True, "exposure": False},
        "calibration": {"temperature": [1] * 5, "bias": [0] * 5, "method": "family-heldout-temperature-grid"},
        "thresholds": {"actionRead": 0.5, "usefulWithin2": 0.5, "readiness": 0.5, "exposure": 0.5},
        "lineage": {"datasetHash": "a" * 64, "trainFamilies": ["retail:train"], "selectionFamilies": ["retail:selection"],
                    "calibrationFamilies": ["retail:calibration"], "baseOnly": True, "seed": 1, "selectedCheckpoint": "fixture",
                    "soupMembers": [], "randomizedExposureDataHash": None,
                    "labelSemantics": "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked"},
    }
    artifact["contentHash"] = hash_v1(artifact)
    return artifact


def rehash(artifact):
    artifact["contentHash"] = hash_v1({k: v for k, v in artifact.items() if k != "contentHash"})
    return artifact


def test_shared_schema_and_head_validation():
    artifact = fixture_artifact()
    validate_artifact(artifact, SCHEMA)
    probabilities = infer(artifact, [0] * 216)
    assert 0.88 < probabilities[0] < 0.89
    artifact["heads"][0] = "nextAction"
    with pytest.raises(ValueError, match="head mismatch"):
        validate_artifact(rehash(artifact), SCHEMA)


def test_policy_injection_preserves_public_prefix_features_and_server_policy():
    frame = {"boundary": 2, "requestedObjective": "Find order AA17", "sources": {"requirement:10": "Please cancel it", "requirement:2": "Find order AA17", "_binding_events": []},
             "goals": {"hypotheses": [], "unknown": 1}}
    before = build_decision_state(frame)
    injected = copy.deepcopy(frame)
    injected["sources"]["server_policy"] = "Long server policy. " * 1000
    after = build_decision_state(injected)
    assert after == before
    assert after["unresolvedRequirements"] == ["Find order AA17", "Please cancel it"]
    assert candidate_features(before, None) == candidate_features(after, None)
    assert "server_policy" in injected["sources"]


def test_untrained_candidate_metadata_is_neutral_without_changing_sentinel():
    frame = {"boundary": 0, "requestedObjective": "Read order 17", "sources": {"requirement:0": "Read order 17"}, "goals": {"hypotheses": [], "unknown": 1}}
    state = build_decision_state(frame)
    candidate = {"id": "candidate", "probability": 0.86, "hop": 1, "patternId": None, "bindings": [{"sourceId": "requirement:0", "path": []}], "invocation": {"tool": "get_order_details", "arguments": {"order_id": "17"}}}
    changed = {**candidate, "hop": 2, "probability": 0.02, "patternId": "workflow-memory-pattern"}
    assert candidate_features(state, candidate) == candidate_features(state, changed)
    sentinel = candidate_features(state, None)
    assert [sentinel[i] for i in [8, 9, 14]] == [0, 0, 0]
    assert changed["hop"] == 2


@pytest.mark.parametrize("defect", ["hash", "matrix", "family", "exposure", "architecture"])
def test_corrupt_or_leaking_artifacts_rejected(defect):
    artifact = fixture_artifact()
    if defect == "hash":
        artifact["layers"][0]["bias"][0] += 1
    elif defect == "matrix":
        artifact["layers"][0]["weights"][0].pop(); rehash(artifact)
    elif defect == "family":
        artifact["lineage"]["calibrationFamilies"] = artifact["lineage"]["trainFamilies"]; rehash(artifact)
    elif defect == "architecture":
        artifact["architecture"] = "mlp-32-16"; rehash(artifact)
    else:
        artifact["trainedHeads"]["exposure"] = True; rehash(artifact)
    with pytest.raises(ValueError):
        validate_artifact(artifact, SCHEMA)


@pytest.mark.skipif(
    not all((TRAINED / name).exists() for name in ("controller.json", "parity-fixtures.json")),
    reason="Local training artifact or historical parity fixtures not available",
)
def test_actual_training_export_matches_shared_features_and_torch():
    artifact = json.loads((TRAINED / "controller.json").read_text(encoding="utf-8"))
    validate_artifact(artifact, SCHEMA)
    fixtures = json.loads((TRAINED / "parity-fixtures.json").read_text(encoding="utf-8"))
    for row in fixtures:
        values = candidate_features(row["state"], row["candidate"])
        assert values == pytest.approx(row["features"], abs=1e-12)
        assert infer(artifact, values) == pytest.approx(row["probabilities"], abs=1e-12)
        assert infer(artifact, values) == pytest.approx(row["torchProbabilities"], abs=1e-5)
    assert not artifact["trainedHeads"]["exposure"]
    assert artifact["lineage"]["baseOnly"] is True


@pytest.mark.skipif(not ACTION_KIND.exists(), reason="Local action-kind training artifact not available")
def test_action_kind_contract_keeps_stop_unavailable():
    import jsonschema
    schema = json.loads((ROOT / "src/lib/goalspec/contracts/v4-action-kind.schema.json").read_text(encoding="utf-8"))
    artifact = json.loads(ACTION_KIND.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(artifact)
    assert artifact["trained"] == [True, True, True, True, False]
    assert artifact["lineage"]["trainLabelCounts"][-2:] == [3, 0]
    assert artifact["contentHash"] == hash_v1({k: v for k, v in artifact.items() if k != "contentHash"})
