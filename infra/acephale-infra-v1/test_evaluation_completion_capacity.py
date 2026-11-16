"""The final bounded allowance composes with all retained financial/GPU parents."""
import copy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from test_evaluation_lease_extension import (  # noqa: F401 -- full retained chain
    NOW,
    amended,
    both_capacities,
    capacity_base,
    control,
    evaluation_capacity,
    five_used,
    quote,
    record,
)


@pytest.fixture
def completion_funding(five_used):  # noqa: F811
    path, ledger, parent, gpu, _ = five_used
    record(path)
    sixth = control.reserve_lease(ledger, quote(), 1, .597, NOW)
    sixth.update(status="terminated", instanceId="sixth", name="sixth")
    ledger["leases"].append(sixth)
    control.atomic_json(path, ledger)
    journal = Path(ledger["plan"]["studyLedgerPath"])
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v4.json")
    body = {**copy.deepcopy(parent), "version": 4, "profile": "acephale-infrastructure-funding-v4",
        "policy": policy, "policyHash": control._budget_digest(policy),
        "parentFundingHash": parent["contentHash"],
        "parentFundingSha256": control.sha256(Path(str(journal) + ".infrastructure-funding-v3.json")),
        "baselineLeases": copy.deepcopy(ledger["leases"]),
        "baselineOverheads": copy.deepcopy(ledger["overheads"]),
        "baselineTrainingWindows": copy.deepcopy(ledger["trainingWindows"]),
        "authorizedAt": datetime.fromtimestamp(NOW + 1, timezone.utc).isoformat()}
    body.pop("contentHash")
    value = {**body, "contentHash": control._budget_digest(body)}
    target = Path(str(journal) + ".infrastructure-funding-v4.json")
    control.write_new(target, value)
    return path, ledger, value, gpu, target


def authorize(path, ledger):
    history = path.with_name("completion-history.json")
    control.write_new(history, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    with patch.object(control.time, "time", return_value=NOW + 2):
        return control.record_gpu_hour_capacity_completion(path, "Continue the user-authorized evaluation only.",
            history, source_probe=lambda _: "d" * 40, budget=lambda _plan, op: {"operation": op})


def new_lease(ledger):
    return control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 3}, 8, 4.776, NOW + 3)


def test_intermediate_funding_v4_and_final_gpu_v3_keep_the_whole_parent_chain(completion_funding):
    path, ledger, funding, parent, _ = completion_funding
    assert control.infrastructure_funding(ledger) == funding
    assert control.effective_gpu_hour_capacity(ledger) == (160, parent)
    assert control.checked_bound_ledger(path) == ledger
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    capacity = authorize(path, ledger)
    assert control.effective_gpu_hour_capacity(ledger) == (168, capacity)
    assert control.infrastructure_caps(ledger) == (450, 335, 115)
    assert control.effective_budget_policy(ledger)["policy"]["maxGpuHours"] == 64
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303_000_000
    assert all(p.read_bytes() == value for p, value in originals.items())
    lease = new_lease(ledger)
    assert lease["infrastructureFundingSupplementHash"] == funding["contentHash"]
    assert lease["gpuHourCapacityAddendumHash"] == capacity["contentHash"]
    assert "evaluationLeaseCapacityHash" not in lease
    lease.update(status="terminated", instanceId="completion", name="completion")
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    with pytest.raises(ValueError, match="lease count"):
        new_lease(ledger)
    with pytest.raises(ValueError, match="overwritten"):
        control.record_gpu_hour_capacity_completion(path, "repeat", path.with_name("completion-history.json"))


@pytest.mark.parametrize("field", ["reservedUsd", "reservedHours", "deadline", "setupDeadline", "instanceId"])
def test_old_holds_and_closed_identity_cannot_be_rewritten(completion_funding, field):
    path, ledger, *_ = completion_funding
    authorize(path, ledger)
    changed = copy.deepcopy(ledger)
    changed["leases"][-1][field] = "changed" if field == "instanceId" else 0
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(changed)


@pytest.mark.parametrize("change", [
    lambda v: v.update(version=True),
    lambda v: v.update(engineeringMaximumGpuHours=169),
    lambda v: v.update(parentEngineeringMaximumGpuHours=128),
    lambda v: v.update(parentCapacityHash="f" * 64),
    lambda v: v.update(parentCapacitySha256="f" * 64),
    lambda v: v.update(fundingHash="f" * 64),
    lambda v: v.update(evaluationOnly=False),
    lambda v: v.update(optimizerPermitted=True),
    lambda v: v.update(recordedAt=0),
])
def test_resealed_completion_cannot_expand_or_rebind_authority(completion_funding, change):
    path, ledger, *_ = completion_funding
    value = authorize(path, ledger)
    change(value)
    value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
    control.atomic_json(control.gpu_hour_capacity_path(path, 3), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_missing_current_or_historical_authority_and_training_fail(completion_funding, tmp_path):
    path, ledger, _, _, funding_path = completion_funding
    authorize(path, ledger)
    lease = new_lease(ledger)
    lease.update(status="terminated", instanceId="completion", name="completion")
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, lease["id"], tmp_path / "unused", tmp_path / "unused-result", 1)
    for target in (funding_path, control.gpu_hour_capacity_path(path),
                   control.gpu_hour_capacity_path(path, 2), control.gpu_hour_capacity_path(path, 3)):
        original = target.read_bytes()
        target.unlink()
        try:
            with pytest.raises((ValueError, FileNotFoundError)):
                control.checked_bound_ledger(path)
        finally:
            target.write_bytes(original)


@pytest.mark.parametrize("hours,rate", [(8.01, 1.99), (8, 2)])
def test_session_and_hourly_caps_remain_bounded(completion_funding, hours, rate):
    path, ledger, *_ = completion_funding
    authorize(path, ledger)
    with pytest.raises(ValueError, match="eight hours|approved rate"):
        control.reserve_lease(ledger, {**quote(), "hourlyUsd": rate, "quotedAt": NOW + 3}, hours, 0, NOW + 3)


def test_actual_frozen_execution_reader_accepts_evaluation_and_denies_training(completion_funding, tmp_path):
    from acephale.training import validate_execution_lease
    path, ledger, funding, *_ = completion_funding
    authorize(path, ledger)
    lease = new_lease(ledger)
    lease.update(status="active", instanceId="completion", name="completion",
        studyReservation={"reservationId": "lambda-infra:" + lease["id"],
            "maximumMicrodollars": lease["reservedMicrodollars"],
            "infrastructureFundingSupplementHash": funding["contentHash"]})
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    preflight, output = tmp_path / "preflight.json", tmp_path / "evaluation.json"
    control.write_new(preflight, {"profile": "acephale-evaluation-preflight-v1", "leaseId": lease["id"],
        "instanceId": lease["instanceId"], "studyBindingHash": ledger["planHash"], "machineIdSha256": "d" * 64,
        "providerReceiptSha256": "e" * 64, "actorStopped": True, "gpuProcesses": 0, "observedAt": NOW + 3,
        "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": quote()["hardwareProfileHash"]})
    before = path.read_bytes()
    with patch.object(control.time, "time", return_value=NOW + 3):
        receipt = control.evaluation_lease(path, lease["id"], preflight, output, 3600,
                                           source_probe=lambda _: "b" * 40)
    assert path.read_bytes() == before
    for action in ("diagnostic", "export", "evaluate"):
        assert validate_execution_lease(output, action=action, now=NOW + 4) == receipt
    with pytest.raises(ValueError):
        validate_execution_lease(output, action="train", now=NOW + 4)
