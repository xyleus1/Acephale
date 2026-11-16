"""Funding v5/GPU v4 retains every original authority and unknown hold."""
import copy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

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
    quote,
    record,
)


@pytest.fixture
def continued_funding(completion_funding):  # noqa: F811
    path, ledger, parent, _, _ = completion_funding
    gpu = authorize(path, ledger)
    old = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 3}, 1, .597, NOW + 3)
    old.update(status="terminated", instanceId="completed-v4", name="completed-v4")
    ledger["leases"].append(old)
    control.atomic_json(path, ledger)
    journal = Path(ledger["plan"]["studyLedgerPath"])
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v5.json")
    body = {**copy.deepcopy(parent), "version": 5, "profile": "acephale-infrastructure-funding-v5",
        "policy": policy, "policyHash": control._budget_digest(policy),
        "parentFundingHash": parent["contentHash"],
        "parentFundingSha256": control.sha256(Path(str(journal) + ".infrastructure-funding-v4.json")),
        "baselineLeases": copy.deepcopy(ledger["leases"]),
        "baselineOverheads": copy.deepcopy(ledger["overheads"]),
        "baselineTrainingWindows": copy.deepcopy(ledger["trainingWindows"]),
        "authorizedAt": datetime.fromtimestamp(NOW + 4, timezone.utc).isoformat()}
    body.pop("contentHash")
    funding = {**body, "contentHash": control._budget_digest(body)}
    control.write_new(Path(str(journal) + ".infrastructure-funding-v5.json"), funding)
    return path, ledger, funding, gpu


def continue_capacity(path, ledger):
    history = path.with_name("finance-v5-history.json")
    control.write_new(history, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    with patch.object(control.time, "time", return_value=NOW + 5):
        return control.record_gpu_hour_capacity_continuation(path, "Operator-bounded continuation under the user's necessary-resource instruction.",
            history, source_probe=lambda _: "e" * 40, budget=lambda _plan, op: {"operation": op})


def test_funding5_intermediate_then_gpu200_compose_all_parents(continued_funding):
    path, ledger, funding, parent = continued_funding
    assert control.infrastructure_funding(ledger) == funding
    assert control.effective_gpu_hour_capacity(ledger) == (168, parent)
    assert control.checked_bound_ledger(path) == ledger
    originals = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    capacity = continue_capacity(path, ledger)
    assert control.infrastructure_caps(ledger) == (550, 415, 135)
    assert control.effective_gpu_hour_capacity(ledger) == (200, capacity)
    assert all(p.read_bytes() == value for p, value in originals.items())
    for index in range(16):
        lease = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 6}, .1, .0597, NOW + 6)
        assert lease["infrastructureFundingSupplementHash"] == funding["contentHash"]
        assert lease["gpuHourCapacityAddendumHash"] == capacity["contentHash"]
        lease.update(status="terminated", instanceId=f"v5-{index}", name=f"v5-{index}")
        ledger["leases"].append(lease)
        control.atomic_json(path, ledger)
        assert control.checked_bound_ledger(path) == ledger
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 6}, .1, 0, NOW + 6)
    with pytest.raises(ValueError, match="overwritten"):
        control.record_gpu_hour_capacity_continuation(path, "repeat", path.with_name("finance-v5-history.json"))


@pytest.mark.parametrize("change", [
    lambda v: v.update(version=True), lambda v: v.update(engineeringMaximumGpuHours=201),
    lambda v: v.update(parentEngineeringMaximumGpuHours=160), lambda v: v.update(parentCapacityHash="f"*64),
    lambda v: v.update(parentCapacitySha256="f"*64), lambda v: v.update(fundingHash="f"*64),
    lambda v: v.update(fundingSha256="f"*64), lambda v: v.update(evaluationOnly=False),
    lambda v: v.update(optimizerPermitted=True), lambda v: v.update(recordedAt=0),
])
def test_new_gpu_authority_cannot_hide_modified_parent_or_expand(continued_funding, change):
    path, ledger, *_ = continued_funding
    value = continue_capacity(path, ledger)
    change(value)
    value["contentHash"] = control.digest({k:v for k,v in value.items() if k != "contentHash"})
    control.atomic_json(control.gpu_hour_capacity_path(path, 4), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


@pytest.mark.parametrize("field", ["reservedUsd", "reservedHours", "deadline", "instanceId"])
def test_historical_holds_identity_and_deadlines_are_not_released(continued_funding, field):
    path, ledger, *_ = continued_funding
    continue_capacity(path, ledger)
    ledger["leases"][-1][field] = "changed" if field == "instanceId" else 0
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(ledger)


@pytest.mark.parametrize("hours,rate", [(8.01,1.99),(8,2)])
def test_current_lease_limits_still_apply(continued_funding, hours, rate):
    path, ledger, *_ = continued_funding
    continue_capacity(path, ledger)
    with pytest.raises(ValueError, match="eight hours|approved rate"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 6, "hourlyUsd": rate}, hours, 0, NOW + 6)


def test_frozen_execution_contract_and_training_denial(continued_funding, tmp_path):
    from acephale.training import validate_execution_lease
    path, ledger, funding, _ = continued_funding
    continue_capacity(path, ledger)
    lease = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 6}, 8, 4.776, NOW + 6)
    lease.update(status="active", instanceId="v5-evaluation", name="v5-evaluation",
        studyReservation={"reservationId":"lambda-infra:"+lease["id"],
            "maximumMicrodollars":lease["reservedMicrodollars"],"infrastructureFundingSupplementHash":funding["contentHash"]})
    ledger["leases"].append(lease); control.atomic_json(path, ledger)
    preflight, output = tmp_path/"preflight.json", tmp_path/"evaluation.json"
    control.write_new(preflight, {"profile":"acephale-evaluation-preflight-v1","leaseId":lease["id"],
        "instanceId":lease["instanceId"],"studyBindingHash":ledger["planHash"],"machineIdSha256":"d"*64,
        "providerReceiptSha256":"e"*64,"actorStopped":True,"gpuProcesses":0,"observedAt":NOW+6,
        "hardwareProfile":"a100-40gb-v1","hardwareProfileHash":quote()["hardwareProfileHash"]})
    with patch.object(control.time,"time",return_value=NOW+6):
        receipt=control.evaluation_lease(path,lease["id"],preflight,output,3600,source_probe=lambda _:"b"*40)
    for action in ("diagnostic","export","evaluate"):
        assert validate_execution_lease(output,action=action,now=NOW+7)==receipt
    with pytest.raises(ValueError):
        validate_execution_lease(output,action="train",now=NOW+7)
    with pytest.raises(ValueError,match="does not authorize optimizer"):
        control.training_lease(path,lease["id"],preflight,tmp_path/"denied",1)


def test_prepare_requires_the_explicit_native_port_and_current_total(continued_funding):
    path, ledger, funding, _ = continued_funding
    continue_capacity(path, ledger)
    original = path.read_bytes()
    admitted = copy.deepcopy(ledger)
    admitted["plan"].update(region="synthetic-region",firewallRulesetId="synthetic-firewall",hardwareProfile="a100-40gb-v1")
    for extra in ({}, {"nativeBudgetPort": "acephale-infrastructure-aware-native-budget-v1", "frozenNonContingencyCeilingMicrodollars": 935000000}):
        inspection = {"infrastructureFundingSupplementHash":funding["contentHash"],
            "frozenApiHeadroomMicrodollars":303000000,"frozenNonContingencyCeilingMicrodollars":1285000000,
            "frozenApiPlanHash":control._budget_digest(funding["policy"]["frozenApiPlanMicrodollars"]),
            "frozenProjectedNonContingencyMicrodollars":955000000,**extra}
        with patch.object(control, "quote", return_value={**quote(),"quotedAt":NOW+6}), \
             patch.object(control, "checked_bound_ledger", return_value=admitted), \
             patch.object(control, "infrastructure_funding", return_value=funding), \
             patch.object(control, "reserve_lease", return_value={"id":"prospective","reservedMicrodollars":20696000}), \
             patch.object(control, "validate_firewall"), pytest.raises(ValueError,match="API headroom"):
            control.prepare_lease(None,path,8,4.776,now=NOW+6,budget=lambda *args,result=inspection:result)
        assert path.read_bytes()==original
