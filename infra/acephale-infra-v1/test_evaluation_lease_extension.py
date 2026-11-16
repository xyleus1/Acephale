"""A sixth slot composes with original count, funding and GPU authorities."""
import copy
from pathlib import Path
from unittest.mock import patch

import evaluation_lease_capacity as capacity
import pytest
from test_lease_count_history import (  # noqa: F401 -- original public chain fixtures
    NOW,
    amended,
    both_capacities,
    capacity_base,
    control,
    evaluation_capacity,
    quote,
)


@pytest.fixture
def five_used(both_capacities):  # noqa: F811 -- shared pytest fixture
    path, ledger, funding, gpu, original = both_capacities
    fifth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    fifth.update(status="terminated", instanceId="fifth", name="fifth")
    ledger["leases"].append(fifth)
    control.atomic_json(path, ledger)
    return path, ledger, funding, gpu, original


def record(path, recorded_at=NOW, source_probe=None):
    with patch.object(control.time, "time", return_value=recorded_at):
        return capacity.record_extension(path, "One sixth evaluation under unchanged financial limits.",
            controller=control, source_probe=source_probe or (lambda _: "c" * 40))


def test_sixth_slot_preserves_exact_v1_bytes_and_nested_160_hour_authority(five_used):
    path, ledger, funding, gpu, original = five_used
    files = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    value = record(path)
    assert capacity.effective_limit(ledger, funding) == (6, value)
    assert control.checked_bound_ledger(path) == ledger
    assert control.infrastructure_caps(ledger) == (420, 315, 105)
    assert control.effective_gpu_hour_capacity(ledger) == (160, gpu)
    assert all(p.read_bytes() == data for p, data in files.items())
    assert value["parentCapacityHash"] == original["contentHash"]
    assert value["parentCapacitySha256"] == capacity.sha(capacity.capacity_path(path))
    assert ledger["leases"][-1]["evaluationLeaseCapacityHash"] == original["contentHash"]
    sixth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    assert sixth["evaluationLeaseCapacityHash"] == value["contentHash"]
    sixth.update(status="terminated", instanceId="sixth", name="sixth")
    ledger["leases"].append(sixth)
    assert control.infrastructure_funding(ledger) == funding
    assert control.effective_gpu_hour_capacity(ledger) == (160, gpu)
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    with pytest.raises(ValueError, match="overwritten"):
        record(path)


@pytest.mark.parametrize("change", [
    lambda value: value.update(baseMaximumNewLeases=True),
    lambda value: value.update(effectiveMaximumNewLeases=True),
    lambda value: value.update(effectiveMaximumNewLeases=7),
    lambda value: value.update(additionalLeases=True),
    lambda value: value.update(parentCapacityHash="f" * 64),
    lambda value: value.update(parentCapacitySha256="f" * 64),
    lambda value: value.update(parentSourceCommit="f" * 40),
    lambda value: value.update(fundingHash="f" * 64),
    lambda value: value.update(financialCeilingsChanged=True),
    lambda value: value.update(gpuHoursChanged=True),
    lambda value: value.update(optimizerPermitted=True),
    lambda value: value.update(recordedAt=0),
    lambda value: value["baselineLeases"].pop(),
    lambda value: value["baselineLeases"][-1].update(evaluationLeaseCapacityHash="f" * 64),
])
def test_resealed_extension_cannot_change_its_contract(five_used, change):
    path, ledger, _, _, _ = five_used
    value = record(path)
    change(value)
    value["contentHash"] = capacity.digest({key: item for key, item in value.items() if key != "contentHash"})
    control.atomic_json(capacity.capacity_path(path, version=2), value)
    with pytest.raises(ValueError):
        control.infrastructure_funding(ledger)


@pytest.mark.parametrize("change", [
    lambda ledger: ledger["leases"].pop(),
    lambda ledger: ledger["leases"][-1].update(reservedUsd=0),
    lambda ledger: ledger["leases"][-1].update(deadline=0),
    lambda ledger: ledger["leases"][-1].update(status="active"),
    lambda ledger: ledger["leases"][-1].pop("evaluationLeaseCapacityHash"),
    lambda ledger: ledger["trainingWindows"].append({"syntheticExtraTraining": True}),
])
def test_current_history_cannot_be_rewritten_or_trained(five_used, change):
    path, ledger, _, _, _ = five_used
    record(path)
    altered = copy.deepcopy(ledger)
    change(altered)
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(altered)
    with pytest.raises(ValueError):
        control.infrastructure_funding(altered)


@pytest.mark.parametrize("parent", [True, False])
def test_missing_parent_or_extension_fails_closed(five_used, parent):
    path, ledger, _, _, _ = five_used
    record(path)
    sixth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    ledger["leases"].append(sixth)
    capacity.capacity_path(path, version=1 if parent else 2).unlink()
    with pytest.raises(ValueError):
        control.infrastructure_funding(ledger)


def test_changed_parent_bytes_fail_even_with_same_json(five_used):
    path, ledger, _, _, _ = five_used
    record(path)
    parent = capacity.capacity_path(path)
    parent.write_bytes(parent.read_bytes() + b"\n")
    with pytest.raises(ValueError, match="exact v1 parent"):
        control.infrastructure_funding(ledger)


def test_sixth_must_bind_extension_and_follow_its_timestamp(five_used):
    path, ledger, funding, _, _ = five_used
    value = record(path, NOW + 10)
    with pytest.raises(ValueError, match="predate its lease-count"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, 1, .597, NOW + 9)
    sixth = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 10}, 1, .597, NOW + 10)
    for delta in ({"evaluationLeaseCapacityHash": value["parentCapacityHash"]}, {"reservedAt": NOW + 9}):
        changed = copy.deepcopy(ledger)
        changed["leases"].append({**sixth, **delta})
        with pytest.raises(ValueError, match="prospectively"):
            capacity.validate_extension(value, changed, funding)


def test_extension_creation_requires_completed_fifth_and_rescans_all_files(five_used):
    path, ledger, _, _, _ = five_used
    ledger["leases"][-1]["status"] = "active"
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="fifth lease must be terminated"):
        record(path)
    assert not capacity.capacity_path(path, version=2).exists()
    ledger["leases"][-1]["status"] = "terminated"
    control.atomic_json(path, ledger)

    def race(_):
        control.write_new(Path(ledger["plan"]["studyLedgerPath"] + ".new-test-authority.json"), {"test": True})
        return "c" * 40

    with pytest.raises(ValueError, match="changed during count extension"):
        record(path, source_probe=race)
    assert not capacity.capacity_path(path, version=2).exists()


def test_extension_keeps_monetary_session_rate_and_optimizer_gates(five_used, tmp_path):
    path, ledger, _, _, _ = five_used
    record(path)
    for hours, rate, allowance in ((8.01, 1.99, .597), (1, 2, .597), (1, 1.99, 200)):
        with pytest.raises(ValueError):
            control.reserve_lease(ledger, {**quote(), "hourlyUsd": rate}, hours, allowance, NOW)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", tmp_path / "unused-preflight", tmp_path / "unused-output", 1)


def test_pure_memo_does_not_cache_parent_or_extension_reads(five_used):
    path, ledger, funding, _, _ = five_used
    record(path)
    with control.budget_digest_scope():
        assert control.infrastructure_funding(ledger) == funding
        parent = capacity.capacity_path(path)
        parent.write_bytes(parent.read_bytes() + b"\n")
        with pytest.raises(ValueError, match="exact v1 parent"):
            control.infrastructure_funding(ledger)


def test_historical_unknown_hold_survives_and_still_needs_its_fence(five_used):
    path, ledger, funding, _, _ = five_used
    # Establish a synthetic v1 fixture with the fourth slot unresolved, then a
    # separately closed fifth slot. v2 must preserve both original identities.
    parent_path = capacity.capacity_path(path)
    parent = capacity.read(parent_path)
    index = len(funding["baselineLeases"]) + 3
    for row in (parent["baselineLeases"][index], ledger["leases"][index]):
        row.update(status="launch_unknown", instanceId=None)
    parent["contentHash"] = capacity.digest({key: item for key, item in parent.items() if key != "contentHash"})
    ledger["leases"][-1]["evaluationLeaseCapacityHash"] = parent["contentHash"]
    control.atomic_json(parent_path, parent)
    control.atomic_json(path, ledger)
    original = parent_path.read_bytes()
    value = record(path)
    assert parent_path.read_bytes() == original
    assert value["baselineLeases"][index] == ledger["leases"][index]
    assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match="active or unresolved"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    changed = copy.deepcopy(ledger)
    changed["leases"].pop(index)
    with pytest.raises(ValueError):
        control.infrastructure_funding(changed)
