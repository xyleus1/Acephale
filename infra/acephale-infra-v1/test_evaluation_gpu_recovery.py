"""GPU5 preserves the complete money/count/history chain while adding hours."""
# ruff: noqa: F811 -- imported pytest fixtures are injected by the same name.
import copy
from pathlib import Path
from unittest.mock import patch

import pytest
from test_evaluation_recovery_funding import (  # noqa: F401
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
    recovery_funding,
)


def recover(path, ledger):
    history = path.with_name("gpu5-history.json")
    control.write_new(history, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    with patch.object(control.time, "time", return_value=NOW + 8):
        return control.record_gpu_hour_capacity_recovery(path,
            "Prospective bounded GPU allowance under the existing necessary-resource instruction.",
            history, source_probe=lambda _: "e" * 40, budget=lambda _plan, op: {"operation": op})


def test_actual_full_chain_creation_and_reservation_preserve_money_count_and_old_bytes(recovery_funding):
    from evaluation_lease_capacity import effective_limit
    path, ledger, funding, parent = recovery_funding
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    before_count = effective_limit(ledger, funding)
    value = recover(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    assert control.effective_gpu_hour_capacity(ledger) == (300, value)
    assert control.infrastructure_caps(ledger) == (1050, 815, 235)
    assert effective_limit(ledger, funding) == before_count == (15, None)
    assert value["parentCapacityHash"] == parent["contentHash"]
    assert value["fundingHash"] == funding["contentHash"]
    assert value["leaseCountAuthorityChanged"] is False
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303000000
    assert all(p.read_bytes() == data for p, data in originals.items())
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, 8, 4.776, NOW + 9)
    assert row["gpuHourCapacityAddendumHash"] == value["contentHash"]
    assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
    row.update(status="terminated", instanceId="gpu5", name="gpu5")
    ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    with pytest.raises(ValueError, match="overwritten"):
        control.record_gpu_hour_capacity_recovery(path, "repeat", path.with_name("gpu5-history.json"))


@pytest.mark.parametrize("field,value", [
    ("parentCapacityHash", "f" * 64), ("parentCapacitySha256", "f" * 64),
    ("fundingHash", "f" * 64), ("fundingSha256", "f" * 64),
    ("policyHash", "f" * 64), ("engineeringMaximumGpuHours", 301),
    ("leaseCountAuthorityChanged", True), ("recordedAt", NOW),
])
def test_resealed_authority_cannot_change_parent_policy_or_scope(recovery_funding, field, value):
    path, ledger, *_ = recovery_funding
    authority = recover(path, ledger)
    authority[field] = value
    authority["contentHash"] = control.digest({k: v for k, v in authority.items() if k != "contentHash"})
    control.atomic_json(control.gpu_hour_capacity_path(path, 5), authority)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_historical_unknown_holds_and_funding_parent_remain_checked(recovery_funding):
    path, ledger, *_ = recovery_funding
    recover(path, ledger)
    changed = copy.deepcopy(ledger)
    changed["leases"][0]["reservedHours"] = 0
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(changed)
    parent_path = Path(ledger["plan"]["studyLedgerPath"] + ".infrastructure-funding-v5.json")
    parent = control.read_json(parent_path)
    parent["baselineLeases"][0]["reservedUsd"] = 0
    parent["contentHash"] = control._budget_digest({k: v for k, v in parent.items() if k != "contentHash"})
    control.atomic_json(parent_path, parent)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_original_count_horizon_is_not_restarted_by_gpu5(recovery_funding):
    path, ledger, *_ = recovery_funding
    recover(path, ledger)
    # Actual reserve admits each short lease; prior funding5 usage still consumes one slot.
    for index in range(15):
        row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, .0597, NOW + 9)
        row.update(status="terminated", instanceId=f"gpu5-{index}", name=f"gpu5-{index}")
        ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, 0, NOW + 9)


@pytest.mark.parametrize("hours,rate", [(8.01, 1.99), (8, 2)])
def test_per_lease_limits_and_optimizer_denial_survive_gpu5(recovery_funding, hours, rate):
    path, ledger, *_ = recovery_funding
    recover(path, ledger)
    with pytest.raises(ValueError, match="eight hours|approved rate"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9, "hourlyUsd": rate}, hours, 0, NOW + 9)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "irrelevant", path, path.with_name("denied"), 1)


def test_cli_uses_creation_only_recovery_writer(tmp_path, capsys):
    with patch.object(control, "record_gpu_hour_capacity_recovery", return_value={"verified": True}) as writer:
        assert control.main(["record-gpu-hour-capacity-recovery", "--ledger", str(tmp_path / "ledger.json"),
            "--authorization-reason", "existing authority", "--operational-history", str(tmp_path / "history.json")]) == 0
    writer.assert_called_once_with(tmp_path / "ledger.json", "existing authority", tmp_path / "history.json")
    assert '"verified": true' in capsys.readouterr().out


def test_actual_frozen4438_reader_accepts_gpu5_evaluation_receipt(recovery_funding, tmp_path):
    import os

    from test_evaluation_recovery_funding import (
        test_actual_frozen4438_execution_reader_accepts_evaluation_only,
    )
    frozen = os.environ.get("ACEPHALE_FROZEN_IMAGE_ROOT")
    if not frozen:
        pytest.skip("Exact frozen4438 checkout required")
    path, ledger, *_ = recovery_funding
    recover(path, ledger)
    test_actual_frozen4438_execution_reader_accepts_evaluation_only(recovery_funding, tmp_path)


def test_writer_rejects_policy_bytes_changed_during_budget_observation(recovery_funding):
    path, ledger, *_ = recovery_funding
    history = path.with_name("gpu5-history.json")
    control.write_new(history, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    real_sha = control.sha256
    policy = control.ROOT / "src/lib/acephale/contracts/gpu-hour-capacity-v5.json"
    changed = False

    def budget(_plan, operation):
        nonlocal changed
        changed = True
        return {"operation": operation}

    def observed_sha(target):
        # Inject only an observed post-budget byte change; never edit a source file.
        return "f" * 64 if target == policy and changed else real_sha(target)

    with patch.object(control, "sha256", side_effect=observed_sha), \
         patch.object(control.time, "time", return_value=NOW + 8), \
         pytest.raises(ValueError, match="changed during"):
        control.record_gpu_hour_capacity_recovery(path, "existing authority", history,
            source_probe=lambda _: "e" * 40, budget=budget)
    assert not control.gpu_hour_capacity_path(path, 5).exists()
