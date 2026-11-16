"""Validate historical GPU parents under current, unchanged monetary authority."""
import copy
from pathlib import Path
from unittest.mock import patch

import pytest

import evaluation_lease_capacity as capacity
from test_gpu_hour_extension import (  # noqa: F401 -- original public fixtures
    NOW,
    amended,
    capacity_base,
    control,
    evaluation_capacity,
    quote,
    record_extension,
)


@pytest.fixture
def both_capacities(evaluation_capacity):  # noqa: F811 -- shared pytest fixture
    path, ledger, _, _, funding, _ = evaluation_capacity
    extension = record_extension(path, ledger)
    for index in range(4):
        lease = control.reserve_lease(ledger, quote(), 1, .597, NOW)
        lease.update(status="terminated", instanceId=f"count-{index}", name=f"count-{index}")
        ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    Path(ledger["plan"]["studyLedgerPath"]).write_text('{"syntheticTestJournal":true}\n', encoding="utf-8")
    with patch.object(control.time, "time", return_value=NOW):
        count = capacity.record_capacity(path, "One additional evaluation lease.", controller=control,
                                         source_probe=lambda _: "b" * 40)
    return path, ledger, funding, extension, count


def test_current_count_capacity_composes_with_authenticated_160_hour_parent(both_capacities):
    path, ledger, funding, extension, count = both_capacities
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    assert control.checked_bound_ledger(path) == ledger
    assert control.effective_gpu_hour_capacity(ledger) == (160, extension)
    assert control.infrastructure_funding(ledger) == funding
    assert control.infrastructure_caps(ledger) == (420, 315, 105)
    assert control.effective_budget_policy(ledger)["policy"]["maxGpuHours"] == 64
    fifth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    fifth.update(status="terminated", instanceId="fifth", name="fifth")
    assert fifth["evaluationLeaseCapacityHash"] == count["contentHash"]
    ledger["leases"].append(fifth)
    assert control.effective_gpu_hour_capacity(ledger) == (160, extension)
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    assert all(p.read_bytes() == data for p, data in originals.items())


@pytest.mark.parametrize("change", [
    lambda ledger: ledger["leases"].pop(),
    lambda ledger: ledger["leases"][-1].update(reservedUsd=0),
    lambda ledger: ledger["leases"][-1].update(deadline=0),
])
def test_historical_parent_handling_never_admits_truncated_or_rewritten_current_work(both_capacities, change):
    _, original, _, _, _ = both_capacities
    altered = copy.deepcopy(original)
    change(altered)
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(altered)
    with pytest.raises(ValueError):
        control.infrastructure_funding(altered)


def test_parent_binding_still_rejects_tampering_before_historical_validation(both_capacities):
    path, ledger, _, extension, _ = both_capacities
    changed = copy.deepcopy(extension)
    changed["parentCapacitySha256"] = "f" * 64
    changed["contentHash"] = control.digest({key: value for key, value in changed.items() if key != "contentHash"})
    control.atomic_json(control.gpu_hour_capacity_path(path, version=2), changed)
    with pytest.raises(ValueError, match="exact parent"):
        control.effective_gpu_hour_capacity(ledger)
