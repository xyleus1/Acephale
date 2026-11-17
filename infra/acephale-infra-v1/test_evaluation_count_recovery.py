"""The actual funding6/GPU5 chain permits exactly four additional evaluations."""
# ruff: noqa: F811 -- imported pytest fixtures retain their public names.
import copy
import os
from pathlib import Path
from unittest.mock import patch

import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_gpu_recovery import (  # noqa: F401
    NOW,
    amended,
    authorize,
    both_capacities,
    capacity_base,
    completion_funding,
    continue_capacity,
    continued_funding,
    control,
    digest_scope,
    evaluation_capacity,
    five_used,
    quote,
    record,
    recover,
    recovery_funding,
)


@pytest.fixture
def exhausted(recovery_funding):
    path, ledger, funding, _ = recovery_funding
    gpu = recover(path, ledger)
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, .0597, NOW + 9)
    # Fill retained prior slots from one real reservation; the test below uses
    # the actual reader and reserve path for all four prospective slots.
    for index in range(15):
        old = copy.deepcopy(row)
        old.update(id=f"retained-{index}", status="terminated", instanceId=f"retained-{index}", name=f"retained-{index}")
        ledger["leases"].append(old)
    control.atomic_json(path, ledger)
    return path, ledger, funding, gpu


def extend(path, source_probe=lambda _: "f" * 40):
    with patch.object(control.time, "time", return_value=NOW + 10):
        return capacity.record_funding6_capacity(path, "Continue the authorized evaluation with four prospective slots.",
                                                controller=control, source_probe=source_probe)


def reserve(ledger, index, now=NOW + 11):
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": now}, .1, .0597, now)
    row.update(status="terminated", instanceId=f"additional-{index}", name=f"additional-{index}")
    ledger["leases"].append(row)
    return row


def test_full_current_and_historical_readers_admit_exactly_four_without_rewriting(exhausted):
    path, ledger, funding, gpu = exhausted
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    with pytest.raises(ValueError, match="lease count"):
        reserve(ledger, "before")
    value = extend(path)
    assert value["originalMaximumNewLeases"] == 16 and value["effectiveOriginalMaximumNewLeases"] == 20
    assert capacity.effective_limit(ledger, funding) == (19, value)
    for index in range(4):
        row = reserve(ledger, index)
        assert row["evaluationLeaseCapacityHash"] == value["contentHash"]
        assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
        assert row["gpuHourCapacityAddendumHash"] == gpu["contentHash"]
        control.atomic_json(path, ledger)
        assert control.checked_bound_ledger(path) == ledger
        assert control.effective_gpu_hour_capacity(ledger) == (300, gpu)
        assert control.infrastructure_caps(ledger) == (1050, 815, 235)
    with pytest.raises(ValueError, match="lease count"):
        reserve(ledger, "fifth")
    with pytest.raises(ValueError, match="overwritten"):
        extend(path)
    assert all(p.read_bytes() == data for p, data in originals.items() if p != path)
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303000000
    assert value["financialCeilingsChanged"] is False and value["gpuHoursChanged"] is False


def test_resealed_extension_cannot_expand_or_change_its_authorities(exhausted):
    path, _ledger, *_ = exhausted
    value = extend(path)
    for field, replacement in (
        ("additionalLeases", 5), ("additionalLeases", True), ("originalMaximumNewLeases", 0),
        ("effectiveMaximumNewLeases", 20), ("fundingHash", "f" * 64),
        ("originalCountFundingSha256", "f" * 64), ("gpuHourCapacityHash", "f" * 64),
        ("financialCeilingsChanged", True), ("optimizerPermitted", True), ("recordedAt", NOW),
    ):
        changed = copy.deepcopy(value)
        changed[field] = replacement
        changed["contentHash"] = control._budget_digest({k: v for k, v in changed.items() if k != "contentHash"})
        control.atomic_json(capacity.capacity_path(path, version=4), changed)
        with pytest.raises(ValueError):
            control.checked_bound_ledger(path)


def test_truncated_history_and_changed_holds_fail_even_inside_hash_scope(exhausted):
    path, ledger, funding, _ = exhausted
    extend(path)
    for field in ("reservedUsd", "reservedHours", "deadline", "setupDeadline", "studyReservation"):
        changed = copy.deepcopy(ledger)
        changed["leases"][-1][field] = {} if field == "studyReservation" else 0
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding, canonical_digest=control._budget_digest)
    changed = copy.deepcopy(ledger)
    changed["leases"].pop()
    with pytest.raises(ValueError, match="truncate"):
        control.infrastructure_funding(changed)


def test_suffix_missing_or_wrong_count_and_early_or_long_lease_fail(exhausted):
    path, ledger, funding, _ = exhausted
    value = extend(path)
    for hours, rate in ((8.01, 1.99), (1, 2)):
        with pytest.raises(ValueError, match="eight hours|approved rate"):
            control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 11, "hourlyUsd": rate}, hours, 0, NOW + 11)
    with pytest.raises(ValueError, match="predate its lease-count"):
        reserve(ledger, "early", NOW + 9)
    row = reserve(ledger, 0)
    row["evaluationLeaseCapacityHash"] = "e" * 64
    with pytest.raises(ValueError, match="exact prospective"):
        capacity.effective_limit(ledger, funding)
    row["evaluationLeaseCapacityHash"] = value["contentHash"]
    target = capacity.capacity_path(path, version=4)
    target.unlink()
    with pytest.raises(ValueError, match="count authority is missing"):
        control.infrastructure_funding(ledger)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", path, path.with_name("denied"), 1)


def test_creation_before_exhaustion_or_with_active_predecessor_has_no_output(exhausted):
    path, ledger, *_ = exhausted
    saved = copy.deepcopy(ledger)
    ledger["leases"].pop()
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="exhausted original"):
        extend(path)
    saved["leases"][-1]["status"] = "active"
    control.atomic_json(path, saved)
    with pytest.raises(ValueError, match="closed work"):
        extend(path)
    assert not capacity.capacity_path(path, version=4).exists()


def test_creation_protects_source_authority_sets_and_does_not_read_raw_journal(exhausted):
    path, ledger, *_ = exhausted
    journal = Path(ledger["plan"]["studyLedgerPath"])
    original_sha = capacity.sha

    def no_raw_hash(target):
        assert target != journal, "Count-only writer must not rehash the raw journal"
        return original_sha(target)

    def changing_source(_):
        control.write_new(Path(str(journal) + ".new-authority.json"), {"syntheticTest": True})
        return "f" * 40

    with patch.object(capacity, "sha", side_effect=no_raw_hash), pytest.raises(ValueError, match="changed during"):
        extend(path, changing_source)
    assert not capacity.capacity_path(path, version=4).exists()


@pytest.mark.skipif(not os.environ.get("ACEPHALE_FROZEN_IMAGE_ROOT"), reason="Exact frozen4438 checkout required")
def test_actual_frozen4438_reader_accepts_new_count_bound_execution_lease(exhausted, tmp_path):
    import test_evaluation_recovery_funding as frozen_test
    path, ledger, funding, gpu = exhausted
    extend(path)
    with patch.object(frozen_test, "NOW", NOW + 2):
        frozen_test.test_actual_frozen4438_execution_reader_accepts_evaluation_only((path, ledger, funding, gpu), tmp_path)
