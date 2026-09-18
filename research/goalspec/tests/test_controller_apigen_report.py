import copy
import pytest

from goalspec.controller_apigen_report import validate_rows
from goalspec.controller_native_v4_report import summarize


def rows():
    base = {"id": "checkpoint", "runId": "episode", "domain": "retail", "familyId": "retail:test", "boundary": 0,
            "universe": "proposal", "executionAllowed": False, "status": "completed", "actualRead": True,
            "predictedRead": True, "actionReadProbability": .8, "poolHash": "same", "poolSize": 2, "poolCovered": True,
            "toolTop1": True, "toolTop3": True, "exactTop1": False, "exactTop3": True, "gatedExactTop1": False,
            "actionNll": .223, "actionBrier": .04, "toolCrossEntropyEstimateNats": 1.0}
    return [{**base, "ranker": ranker} for ranker in ("current-prior", "frozen-logistic")]


def test_pairing_requires_same_pool_and_every_checkpoint():
    valid = rows()
    assert validate_rows({"checkpoint"}, valid) == valid
    bad = copy.deepcopy(valid)
    bad[1]["poolHash"] = "different"
    with pytest.raises(ValueError, match="pairing"):
        validate_rows({"checkpoint"}, bad)
    with pytest.raises(ValueError, match="coverage"):
        validate_rows({"checkpoint", "missing"}, valid)


def test_unknown_catalog_labels_remain_coverage_without_becoming_no_read():
    unknown = rows()[0]
    unknown.update(actualRead=None, status="unavailable", unavailableReason="tool_outside_source_catalog")
    result = summarize([unknown], 100, 1)
    assert result["checkpoints"] == 1
    assert result["unknownActions"] == 1
    assert result["nonReadActions"] == 0
    assert result["metrics"]["actionAccuracy"]["denominator"] == 0
    assert result["metrics"]["exactTop1"]["denominator"] == 0


def test_static_source_diagnostic_cannot_assert_execution():
    bad = rows()
    bad[0]["executionAllowed"] = True
    with pytest.raises(ValueError, match="non-executable"):
        validate_rows({"checkpoint"}, bad)
