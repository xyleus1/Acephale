"""Exercise v5 through the real current reader and reservation path."""
# ruff: noqa: F811 -- imported pytest fixtures retain their public names.
import copy
import os
from pathlib import Path
from unittest.mock import patch

import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_count_recovery import (  # noqa: F401
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
    exhausted,
    extend,
    five_used,
    quote,
    record,
    recover,
    recovery_funding,
    reserve,
)


@pytest.fixture
def four_used(exhausted):
    path, ledger, funding, gpu = exhausted
    parent = extend(path)
    for index in range(4):
        reserve(ledger, index)
    # A closed, undispatched predecessor also consumes a count slot.
    ledger["leases"][-1]["instanceId"] = None
    control.atomic_json(path, ledger)
    return path, ledger, funding, gpu, parent


def continue_count(path, source_probe=lambda _: "a" * 40):
    with patch.object(control.time, "time", return_value=NOW + 12):
        return capacity.record_funding6_extension(path, "Continue the authorized saved-model evaluation.",
                                                  controller=control, source_probe=source_probe)


def test_real_reader_preserves_v4_and_admits_exactly_four_new_slots(four_used):
    path, ledger, funding, gpu, parent = four_used
    before = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    prior_rows = copy.deepcopy(ledger["leases"])
    with pytest.raises(ValueError, match="lease count"):
        reserve(ledger, "before", NOW + 13)
    value = continue_count(path)
    assert value["parentCapacityHash"] == parent["contentHash"]
    assert capacity.effective_limit(ledger, funding) == (23, value)
    for index in range(4):
        row = reserve(ledger, index, NOW + 13)
        assert row["evaluationLeaseCapacityHash"] == value["contentHash"]
        assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
        assert row["gpuHourCapacityAddendumHash"] == gpu["contentHash"]
        control.atomic_json(path, ledger)
        assert control.checked_bound_ledger(path) == ledger
        assert control.infrastructure_caps(ledger) == (1050, 815, 235)
        assert control.effective_gpu_hour_capacity(ledger) == (300, gpu)
    assert ledger["leases"][:len(prior_rows)] == prior_rows
    assert all(p.read_bytes() == raw for p, raw in before.items() if p != path)
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303000000
    with pytest.raises(ValueError, match="lease count"):
        reserve(ledger, "fifth", NOW + 13)
    with pytest.raises(ValueError, match="overwritten"):
        continue_count(path)


@pytest.mark.parametrize("field,replacement", [
    ("additionalLeases", 5), ("additionalLeases", True), ("effectiveMaximumNewLeases", 24),
    ("parentCapacityHash", "e" * 64), ("parentCapacitySha256", "e" * 64),
    ("parentSourceCommit", "e" * 40), ("fundingHash", "e" * 64), ("gpuHourCapacityHash", "e" * 64),
    ("optimizerPermitted", True), ("financialCeilingsChanged", True), ("recordedAt", NOW),
])
def test_resealed_continuation_cannot_change_authority(four_used, field, replacement):
    path, *_ = four_used
    value = continue_count(path)
    value[field] = replacement
    value["contentHash"] = control._budget_digest({k: v for k, v in value.items() if k != "contentHash"})
    control.atomic_json(capacity.capacity_path(path, version=5), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_old_and_new_suffix_bindings_cannot_be_relabelled(four_used):
    path, ledger, funding, _, parent = four_used
    value = continue_count(path)
    with pytest.raises(ValueError, match="predate its lease-count"):
        reserve(ledger, "early", NOW + 11)
    reserve(ledger, 0, NOW + 13)
    for index, wrong_hash in ((-1, parent["contentHash"]), (-2, value["contentHash"])):
        changed = copy.deepcopy(ledger)
        changed["leases"][index]["evaluationLeaseCapacityHash"] = wrong_hash
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    for field in ("reservedUsd", "reservedHours", "deadline", "setupDeadline", "studyReservation"):
        changed = copy.deepcopy(ledger)
        changed["leases"][-2][field] = {} if field == "studyReservation" else 0
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    capacity.capacity_path(path, version=5).unlink()
    with pytest.raises(ValueError):
        capacity.effective_limit(ledger, funding)


def test_parent_cannot_be_removed_or_rewritten(four_used):
    path, ledger, funding, _, parent = four_used
    continue_count(path)
    parent_path = capacity.capacity_path(path, version=4)
    parent_path.unlink()
    with pytest.raises(ValueError):
        capacity.effective_limit(ledger, funding)
    parent["additionalLeases"] = 5
    parent["contentHash"] = control._budget_digest({k: v for k, v in parent.items() if k != "contentHash"})
    control.atomic_json(parent_path, parent)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_extension_requires_exhausted_closed_prefix(four_used):
    path, ledger, *_ = four_used
    original = copy.deepcopy(ledger)
    ledger["leases"].pop()
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="exhausted v4"):
        continue_count(path)
    original["leases"][-1]["status"] = "active"
    control.atomic_json(path, original)
    with pytest.raises(ValueError, match="closed work"):
        continue_count(path)
    assert not capacity.capacity_path(path, version=5).exists()


def test_creation_detects_concurrent_source_or_authority_change_without_raw_journal_hash(four_used):
    path, ledger, *_ = four_used
    journal = Path(ledger["plan"]["studyLedgerPath"])
    original_sha = capacity.sha

    def checked_sha(target):
        assert target != journal
        return original_sha(target)

    def changing_source(_):
        control.write_new(Path(str(journal) + ".unexpected-authority.json"), {"test": True})
        return "a" * 40

    with patch.object(capacity, "sha", side_effect=checked_sha), pytest.raises(ValueError, match="changed during"):
        continue_count(path, changing_source)
    assert not capacity.capacity_path(path, version=5).exists()


@pytest.mark.skipif(not os.environ.get("ACEPHALE_FROZEN_IMAGE_ROOT"), reason="Exact frozen4438 checkout required")
def test_actual_frozen4438_execution_reader_admits_v5_and_rejects_training(four_used, tmp_path):
    import test_evaluation_recovery_funding as frozen_test
    path, ledger, funding, gpu, _ = four_used
    continue_count(path)
    with patch.object(frozen_test, "NOW", NOW + 4):
        frozen_test.test_actual_frozen4438_execution_reader_accepts_evaluation_only((path, ledger, funding, gpu), tmp_path)
