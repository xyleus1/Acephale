"""A complete run's HF operation estimate must not prevent receipt publication."""

import math

import pytest

from acephale.contracts_v1 import canonical_v1, hash_v1
from acephale.training import _receipt_training_metrics


def test_actual_full_run_operation_estimate_fits_shared_receipt():
    # Retained checkpoint-204 total_flos from the November 13 failed receipt.
    metrics = {"total_flos": 7.51775264009134e16, "train_loss": 0.2518, "epoch": 3.0}
    with pytest.raises(ValueError, match="outside shared wire profile"):
        canonical_v1(metrics)
    retained = _receipt_training_metrics(metrics)
    assert retained == {**metrics, "total_flos": "7.51775264009134e+16"}
    assert float(retained["total_flos"]) == metrics["total_flos"]
    assert type(metrics["total_flos"]) is float
    assert len(hash_v1({"trainingMetrics": retained})) == 64


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, -1, True, "123", None])
def test_invalid_operation_estimate_remains_rejected(value):
    with pytest.raises(ValueError, match="finite and nonnegative"):
        _receipt_training_metrics({"total_flos": value})


def test_other_unsafe_metrics_do_not_gain_a_wire_exception():
    retained = _receipt_training_metrics({"total_flos": 10, "train_loss": math.nan})
    with pytest.raises(ValueError, match="outside shared wire profile"):
        canonical_v1(retained)


def test_missing_operation_estimate_is_not_fabricated():
    assert _receipt_training_metrics({"train_loss": .2}) == {"train_loss": .2}


def test_large_integer_estimate_is_preserved_without_float_rounding():
    value = 2**60 + 1
    retained = _receipt_training_metrics({"total_flos": value})
    assert int(retained["total_flos"]) == value
    assert canonical_v1(retained)
