"""A fifth slot retains funding, old reservations and every other admission gate."""
import copy
from pathlib import Path
from unittest.mock import patch

import pytest

import evaluation_lease_capacity as capacity
from test_infrastructure_funding import (  # noqa: F401 -- shared real public parent validators
    NOW,
    amended,
    capacity_base,
    continued,
    control,
    extended,
    funded,
    quote,
)


@pytest.fixture
def exhausted(continued):  # noqa: F811 -- shared pytest fixture
    path, ledger, _, _, funding, _ = continued
    for index in range(4):
        lease = control.reserve_lease(ledger, quote(), 1, .597, NOW)
        lease.update(status="terminated", instanceId=f"v3-{index}", name=f"v3-{index}")
        ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    journal = Path(ledger["plan"]["studyLedgerPath"])
    journal.write_text('{"syntheticTestJournal":true}\n', encoding="utf-8")
    return path, ledger, funding


def record(path, *, recorded_at=NOW):
    with patch.object(control.time, "time", return_value=recorded_at):
        return capacity.record_capacity(path, "Continue evaluation under unchanged financial limits.",
            controller=control, source_probe=lambda _: "b" * 40)


def test_fifth_slot_is_creation_only_and_sixth_is_denied(exhausted):
    path, ledger, funding = exhausted
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    value = record(path)
    assert all(p.read_bytes() == data for p, data in originals.items())
    assert control.infrastructure_funding(ledger) == funding
    assert control.infrastructure_caps(ledger) == (420, 315, 105)
    assert control.effective_gpu_hour_capacity(ledger)[0] == 128
    assert value["financialCeilingsChanged"] is False and value["gpuHoursChanged"] is False
    fifth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    assert fifth["evaluationLeaseCapacityHash"] == value["contentHash"]
    assert fifth["infrastructureFundingSupplementHash"] == funding["contentHash"]
    fifth.update(status="terminated", instanceId="fifth", name="fifth")
    ledger["leases"].append(fifth)
    assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    with pytest.raises(ValueError, match="overwritten"):
        record(path)
    assert all(p.read_bytes() == data for p, data in originals.items())


@pytest.mark.parametrize("change", [
    lambda value: value.update(effectiveMaximumNewLeases=6),
    lambda value: value.update(baseMaximumNewLeases=True),
    lambda value: value.update(effectiveMaximumNewLeases=True),
    lambda value: value.update(additionalLeases=2),
    lambda value: value.update(additionalLeases=True),
    lambda value: value.update(fundingHash="f" * 64),
    lambda value: value.update(fundingSha256="f" * 64),
    lambda value: value.update(infrastructureLedgerPathHash="f" * 64),
    lambda value: value.update(financialCeilingsChanged=True),
    lambda value: value.update(optimizerPermitted=True),
    lambda value: value.update(recordedAt=0),
    lambda value: value["baselineLeases"][-1].update(deadline=NOW + 99),
    lambda value: value["baselineLeases"][-1].update(reservedUsd=0),
    lambda value: value["baselineLeases"][-1].update(status="active"),
    lambda value: value["baselineLeases"].pop(),
])
def test_resealed_capacity_cannot_expand_or_rewrite_history(exhausted, change):
    path, ledger, _ = exhausted
    value = record(path)
    change(value)
    value["contentHash"] = capacity.digest({key: item for key, item in value.items() if key != "contentHash"})
    control.atomic_json(capacity.capacity_path(path), value)
    with pytest.raises(ValueError):
        control.infrastructure_funding(ledger)


def test_missing_authority_or_unbound_fifth_lease_is_rejected(exhausted):
    path, ledger, _ = exhausted
    record(path)
    fifth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    fifth.update(status="terminated", instanceId="fifth", name="fifth")
    ledger["leases"].append(fifth)
    original = fifth.pop("evaluationLeaseCapacityHash")
    with pytest.raises(ValueError, match="bind its count authority"):
        control.infrastructure_funding(ledger)
    fifth["evaluationLeaseCapacityHash"] = original
    capacity.capacity_path(path).unlink()
    with pytest.raises(ValueError, match="authority is missing"):
        control.infrastructure_funding(ledger)


def test_added_slot_does_not_allow_earlier_or_longer_or_more_expensive_work(exhausted, tmp_path):
    path, ledger, _ = exhausted
    record(path, recorded_at=NOW + 10)
    with pytest.raises(ValueError, match="predate its lease-count"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, 1, .597, NOW + 9)
    for hours, rate in ((8.01, 1.99), (1, 2)):
        with pytest.raises(ValueError):
            control.reserve_lease(ledger, {**quote(), "hourlyUsd": rate, "quotedAt": NOW + 10}, hours, .597, NOW + 10)
    with pytest.raises(ValueError, match="allocation"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 10}, 1, 200, NOW + 10)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", tmp_path / "unused-preflight", tmp_path / "unused-output", 1)


def test_creation_rejects_an_active_prior_lease_without_writing(exhausted):
    path, ledger, _ = exhausted
    ledger["leases"][-1]["status"] = "active"
    control.atomic_json(path, ledger)
    original = path.read_bytes()
    with pytest.raises(ValueError, match="closed work"):
        record(path)
    assert path.read_bytes() == original and not capacity.capacity_path(path).exists()


def test_slot_cannot_be_created_early_or_reused_on_another_slice(exhausted, tmp_path):
    path, ledger, funding = exhausted
    prior = copy.deepcopy(ledger)
    prior["leases"].pop()
    control.atomic_json(path, prior)
    with pytest.raises(ValueError, match="original four slots"):
        record(path)
    control.atomic_json(path, ledger)
    value = record(path)
    other = copy.deepcopy(ledger)
    other["plan"]["infrastructureLedgerPath"] = str(tmp_path / "other.json")
    other["planHash"] = control.digest(other["plan"])
    with pytest.raises(ValueError):
        capacity.validate(value, other, funding)


def test_new_dependency_is_in_real_controller_inventory():
    rows = {row["path"]: row["sha256"] for row in control.controller_source_files()}
    assert rows["evaluation_lease_capacity.py"] == control.sha256(Path(capacity.__file__))


def test_unknown_launch_hold_survives_and_still_requires_original_fence(exhausted):
    path, ledger, funding = exhausted
    ledger["leases"][-1].update(status="launch_unknown", instanceId=None)
    control.atomic_json(path, ledger)
    original = copy.deepcopy(ledger["leases"][-1])
    value = record(path)
    assert value["baselineLeases"][-1] == original
    assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match="active or unresolved"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    assert ledger["leases"][-1] == original


def test_operation_hash_memo_never_caches_file_or_authority(exhausted):
    path, ledger, funding = exhausted
    value = record(path)
    with control.budget_digest_scope():
        assert control.infrastructure_funding(ledger) == funding
        changed = copy.deepcopy(value)
        changed["effectiveMaximumNewLeases"] = 6
        changed["contentHash"] = capacity.digest({key: item for key, item in changed.items() if key != "contentHash"})
        control.atomic_json(capacity.capacity_path(path), changed)
        with pytest.raises(ValueError, match="exactly one slot"):
            control.infrastructure_funding(ledger)


def test_new_financial_sidecar_during_creation_is_rejected(exhausted):
    path, ledger, _ = exhausted
    def racing_source(_):
        new = Path(ledger["plan"]["studyLedgerPath"] + ".unexpected-authority.json")
        control.write_new(new, {"syntheticTestRace": True})
        return "b" * 40
    with patch.object(control.time, "time", return_value=NOW), pytest.raises(ValueError, match="changed during count authorization"):
        capacity.record_capacity(path, "One more bounded evaluation.", controller=control, source_probe=racing_source)
    assert not capacity.capacity_path(path).exists()
