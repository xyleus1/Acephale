"""Exercise v7 through the real current reader and reservation path."""
# ruff: noqa: F811 -- imported pytest fixtures retain their public names.
import copy
import os
from pathlib import Path
from unittest.mock import patch

import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_count_successor import (  # noqa: F401
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
    four_used,
    continue_count,
    eight_used,
    successor_count,
    quote,
    record,
    recover,
    recovery_funding,
    reserve,
)


@pytest.fixture
def twelve_used(eight_used):
    path, ledger, funding, gpu, _ = eight_used
    parent = successor_count(path)
    for index in range(4):
        reserve(ledger, index, NOW + 15)
    # An undispatched reservation remains counted and keeps its original hold.
    ledger["leases"][-1]["instanceId"] = None
    control.atomic_json(path, ledger)
    return path, ledger, funding, gpu, parent


def followup_count(path, source_probe=lambda _: "b" * 40):
    with patch.object(control.time, "time", return_value=NOW + 16):
        return capacity.record_funding6_followup(path, "Continue the authorized saved-model evaluation.",
                                                  controller=control, source_probe=source_probe)


def test_real_reader_limits_parent_bindings_and_money_are_preserved(twelve_used, tmp_path):
    path, ledger, funding, gpu, parent = twelve_used
    before = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    prior_rows = copy.deepcopy(ledger["leases"])
    for purpose in ("research", "cleanup_canary"):
        with pytest.raises(ValueError, match="lease count"):
            control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 17}, .1, .0597,
                                  NOW + 17, purpose=purpose)
    value = followup_count(path)
    target = capacity.capacity_path(path, version=7)
    original = target.read_bytes()
    assert value["parentCapacityHash"] == parent["contentHash"]
    assert value["parentSourceCommit"] == parent["sourceCommit"] == "a" * 40
    assert value["sourceCommit"] == "b" * 40
    assert value["effectiveOriginalMaximumNewLeases"] == 32
    assert capacity.effective_limit(ledger, funding) == (31, value)
    for field, replacement in (
        ("version", True), ("additionalLeases", 5), ("additionalLeases", True),
        ("effectiveMaximumNewLeases", 32), ("parentCapacityHash", "e" * 64),
        ("parentCapacitySha256", "e" * 64), ("parentSourceCommit", "e" * 40),
        ("fundingHash", "e" * 64), ("gpuHourCapacityHash", "e" * 64),
        ("optimizerPermitted", True), ("financialCeilingsChanged", True),
        ("gpuHoursChanged", True), ("recordedAt", NOW),
    ):
        changed = copy.deepcopy(value)
        changed[field] = replacement
        changed["contentHash"] = control._budget_digest({k: v for k, v in changed.items() if k != "contentHash"})
        with pytest.raises(ValueError):
            capacity.validate_funding6_followup(changed, ledger, funding)
    for field in ("reservedUsd", "reservedHours", "deadline", "setupDeadline", "studyReservation"):
        changed = copy.deepcopy(ledger)
        changed["leases"][-1][field] = {} if field == "studyReservation" else 0
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    changed = copy.deepcopy(ledger)
    changed["trainingWindows"].append({"id": "forbidden"})
    with pytest.raises(ValueError):
        capacity.effective_limit(changed, funding)
    parent_path = capacity.capacity_path(path, version=6)
    parent_bytes = parent_path.read_bytes()
    parent_path.unlink()
    try:
        with pytest.raises(ValueError):
            capacity.effective_limit(ledger, funding)
    finally:
        parent_path.write_bytes(parent_bytes)
    with pytest.raises(ValueError, match="predate its lease-count"):
        reserve(ledger, "early", NOW + 15)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", path, tmp_path / "denied", 1)
    for index, purpose in enumerate(("cleanup_canary", "research", "cleanup_canary", "research")):
        row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 17}, .1, .0597,
                                    NOW + 17, purpose=purpose)
        assert row["evaluationLeaseCapacityHash"] == value["contentHash"]
        assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
        assert row["gpuHourCapacityAddendumHash"] == gpu["contentHash"]
        row.update(id=f"purpose-{index}", status="terminated", instanceId=None, purpose=purpose)
        ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    assert control.infrastructure_caps(ledger) == (1050, 815, 235)
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303000000
    assert control.effective_gpu_hour_capacity(ledger) == (300, gpu)
    assert ledger["leases"][:len(prior_rows)] == prior_rows
    assert all(p.read_bytes() == raw for p, raw in before.items() if p != path)
    assert target.read_bytes() == original
    for purpose in ("research", "cleanup_canary"):
        with pytest.raises(ValueError, match="lease count"):
            control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 17}, .1, .0597,
                                  NOW + 17, purpose=purpose)
    for index, wrong_hash in ((-1, parent["contentHash"]), (-5, value["contentHash"])):
        changed = copy.deepcopy(ledger)
        changed["leases"][index]["evaluationLeaseCapacityHash"] = wrong_hash
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    with pytest.raises(ValueError, match="overwritten"):
        followup_count(path)
    target.unlink()
    with pytest.raises(ValueError):
        capacity.effective_limit(ledger, funding)


def test_creation_requires_exhausted_closed_history_and_no_concurrent_authority(twelve_used):
    path, ledger, *_ = twelve_used
    original = copy.deepcopy(ledger)
    ledger["leases"].pop()
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="exhausted v6"):
        followup_count(path)
    original["leases"][-1]["status"] = "active"
    control.atomic_json(path, original)
    with pytest.raises(ValueError, match="closed work"):
        followup_count(path)
    original["leases"][-1]["status"] = "terminated"
    control.atomic_json(path, original)
    journal = Path(original["plan"]["studyLedgerPath"])
    original_sha = capacity.sha
    def no_raw_journal_hash(target):
        assert target != journal
        return original_sha(target)
    def changing_source(_):
        control.write_new(Path(str(journal) + ".unexpected-authority.json"), {"test": True})
        return "a" * 40
    with patch.object(capacity, "sha", side_effect=no_raw_journal_hash), pytest.raises(ValueError, match="changed during"):
        followup_count(path, changing_source)
    assert not capacity.capacity_path(path, version=7).exists()


@pytest.mark.skipif(not os.environ.get("ACEPHALE_FROZEN_IMAGE_ROOT"), reason="Exact frozen4438 checkout required")
def test_actual_frozen4438_execution_reader_admits_v7_and_rejects_training(twelve_used, tmp_path):
    import test_evaluation_recovery_funding as frozen_test
    path, ledger, funding, gpu, _ = twelve_used
    followup_count(path)
    with patch.object(frozen_test, "NOW", NOW + 8):
        frozen_test.test_actual_frozen4438_execution_reader_accepts_evaluation_only((path, ledger, funding, gpu), tmp_path)
