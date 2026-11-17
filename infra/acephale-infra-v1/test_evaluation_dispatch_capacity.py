"""Compact dispatch authority composes with real funding4/GPU3 readers."""
import copy
from unittest.mock import patch

import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_completion_capacity import (  # noqa: F401
    NOW,
    amended,
    authorize,
    both_capacities,
    capacity_base,
    completion_funding,
    control,
    evaluation_capacity,
    five_used,
    new_lease,
    quote,
    record,
)


@pytest.fixture
def exhausted(completion_funding):  # noqa: F811 -- imported pytest fixture
    path, ledger, funding, *_ = completion_funding
    with control.budget_digest_scope():
        authorize(path, ledger)
        row = new_lease(ledger)
        row.update(status="terminated", instanceId="first-funding4", name="first-funding4")
        ledger["leases"].append(row)
        control.atomic_json(path, ledger)
        with patch.object(control.time, "time", return_value=NOW + 4):
            value = capacity.record_funding4_capacity(path, "Continue necessary evaluation under the user's broad authorization.",
                controller=control, source_probe=lambda _: "e" * 40)
    return path, ledger, funding, value


def test_real_complete_readers_preserve_caps_and_accept_next_evaluation(exhausted, tmp_path):
    path, ledger, funding, value = exhausted
    with control.budget_digest_scope():
        assert control.checked_bound_ledger(path) == ledger
        assert control.infrastructure_caps(ledger) == (450, 335, 115)
        assert control.effective_gpu_hour_capacity(ledger)[0] == 168
        assert capacity.effective_limit(ledger, funding, canonical_digest=control._budget_digest) == (16, value)
        row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 5}, .25, .14925, NOW + 5)
        assert row["evaluationLeaseCapacityHash"] == value["contentHash"]
        assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
        ledger["leases"].append(row)
        control.atomic_json(path, ledger)
        assert control.checked_bound_ledger(path) == ledger
        with pytest.raises(ValueError, match="does not authorize optimizer"):
            control.training_lease(path, row["id"], tmp_path/"input", tmp_path/"output", 1)
        with pytest.raises(ValueError, match="overwritten"):
            capacity.record_funding4_capacity(path, "repeat", controller=control)


def test_compact_prefix_and_authority_tampering_never_expand_other_capacity(exhausted):
    path, ledger, funding, value = exhausted
    target = capacity.capacity_path(path, version=3)
    original = target.read_bytes()
    assert target.stat().st_size < 20_000
    with control.budget_digest_scope():
        for key in ("reservedUsd", "reservedHours", "deadline", "setupDeadline", "instanceId"):
            changed = copy.deepcopy(ledger)
            changed["leases"][-1][key] = "different" if key == "instanceId" else 0
            with pytest.raises(ValueError):
                capacity.validate_funding4_capacity(value, changed, funding, canonical_digest=control._budget_digest)
        changed = copy.deepcopy(ledger)
        changed["leases"].pop()
        with pytest.raises(ValueError):
            capacity.validate_funding4_capacity(value, changed, funding)
        changed = copy.deepcopy(ledger)
        changed["trainingWindows"].append({"id": "forbidden"})
        with pytest.raises(ValueError, match="never permits training"):
            capacity.validate_funding4_capacity(value, changed, funding)
        for field, replacement in (("version", True), ("effectiveMaximumNewLeases", 17),
                ("fundingHash", "f"*64), ("fundingSha256", "f"*64),
                ("financialCeilingsChanged", True), ("gpuHoursChanged", True),
                ("optimizerPermitted", True), ("recordedAt", 0)):
            changed = copy.deepcopy(value)
            changed[field] = replacement
            changed["contentHash"] = control._budget_digest({k:v for k,v in changed.items() if k != "contentHash"})
            with pytest.raises(ValueError):
                capacity.validate_funding4_capacity(changed, ledger, funding, canonical_digest=control._budget_digest)
        assert target.read_bytes() == original


def test_suffix_limit_missing_authority_and_real_money_limits_remain(exhausted):
    path, ledger, funding, value = exhausted
    with control.budget_digest_scope():
        row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 5}, .25, .14925, NOW + 5)
        changed = copy.deepcopy(ledger)
        changed["leases"].append(row)
        capacity.validate_funding4_capacity(value, changed, funding)
        row["evaluationLeaseCapacityHash"] = "f"*64
        with pytest.raises(ValueError, match="bind the current"):
            capacity.validate_funding4_capacity(value, changed, funding)
        row["evaluationLeaseCapacityHash"] = value["contentHash"]
        changed["leases"].extend(copy.deepcopy(row) for _ in range(15))
        with pytest.raises(ValueError, match="Finite"):
            capacity.validate_funding4_capacity(value, changed, funding)
        target = capacity.capacity_path(path, version=3)
        original = target.read_bytes()
        target.unlink()
        try:
            missing = copy.deepcopy(ledger)
            missing["leases"].append(row)
            with pytest.raises(ValueError, match="authority is missing"):
                capacity.effective_limit(missing, funding)
        finally:
            target.write_bytes(original)
        for hours, rate in ((8.01, 1.99), (.25, 2)):
            with pytest.raises(ValueError, match="eight hours|approved rate"):
                control.reserve_lease(ledger, {**quote(), "quotedAt": NOW+5, "hourlyUsd": rate}, hours, 0, NOW+5)
