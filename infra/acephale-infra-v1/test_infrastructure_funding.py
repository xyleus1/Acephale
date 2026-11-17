"""Separate financial authority retains the frozen training and native contracts."""
import copy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from test_gpu_hour_capacity import (  # noqa: F401 -- shared original policy fixtures
    NOW,
    amended,
    capacity_base,
    control,
    quote,
    record,
)


@pytest.fixture
def funded(capacity_base):  # noqa: F811
    path, ledger, amendment = capacity_base
    old = ledger["leases"][-1]
    totals = control._infrastructure_reserved_totals(ledger)
    old["reservedUsd"] += 191.801503 - totals["infrastructureUsd"]
    old["reservedComputeUsd"] += 142.285002 - totals["computeUsd"]
    old["reservedMicrodollars"] = round(old["reservedUsd"] * 1_000_000)
    control.atomic_json(path, ledger)
    capacity = record(path, ledger)
    journal = Path(ledger["plan"]["studyLedgerPath"])
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v1.json")
    body = {"version": 1, "profile": "acephale-infrastructure-funding-v1", "policy": policy,
        "policyHash": control._budget_digest(policy), "baseBudgetPolicyHash": amendment["policyHash"],
        "baseBudgetAmendmentHash": amendment["contentHash"],
        "baseBudgetAmendmentSha256": control.sha256(Path(str(journal) + ".policy-v3.json")),
        "studyLedgerPathHash": control._budget_digest(str(journal.resolve())),
        "infrastructureLedgerPathHash": control._budget_digest(str(path.resolve())),
        "infrastructureBindingHash": control._budget_binding_hash(ledger), "infrastructurePlanHash": ledger["planHash"],
        "baselineEntries": [{"id": "retained", "allocation": "infrastructure", "maximum": 191801503}],
        "baselineLeases": copy.deepcopy(ledger["leases"]), "baselineOverheads": copy.deepcopy(ledger["overheads"]),
        "baselineTrainingWindows": copy.deepcopy(ledger["trainingWindows"]),
        "authorizedAt": datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
        "authorizationSource": "explicit_user_instruction", "authorizationReason": "Continue necessary work.",
        "sourceCommit": "b" * 40, "basePolicyBytesChanged": False, "effectiveFinancialCeilingsChanged": True,
        "existingReservationsChanged": False, "modelContractsChanged": False}
    funding = {**body, "contentHash": control._budget_digest(body)}
    target = Path(str(journal) + ".infrastructure-funding-v1.json")
    control.write_new(target, funding)
    return path, ledger, amendment, capacity, target, funding


def test_funding_adds_money_without_changing_v3_contract_or_capacity_history(funded):
    path, ledger, amendment, capacity, _, funding = funded
    original = path.read_bytes()
    assert control.infrastructure_caps(ledger) == (300, 225, 75)
    assert control.effective_budget_policy(ledger) == amendment
    assert control.effective_gpu_hour_capacity(ledger) == (128, capacity)
    lease = control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
    assert lease["infrastructureFundingSupplementHash"] == funding["contentHash"]
    assert lease["reservedMicrodollars"] == 20696000
    ledger["leases"].append(lease)
    assert control._infrastructure_reserved_totals(ledger) == {
        "infrastructureUsd": 212.497503, "computeUsd": 158.205002, "associatedUsd": 54.292501}
    assert control.infrastructure_funding(ledger) == funding
    assert path.read_bytes() == original


@pytest.mark.parametrize("change", [
    lambda value: value.update(baseBudgetPolicyHash="f" * 64),
    lambda value: value.update(infrastructureLedgerPathHash="f" * 64),
    lambda value: value.update(authorizedAt="2020-01-01T00:00:00Z"),
    lambda value: value.update(effectiveFinancialCeilingsChanged=False),
    lambda value: value["policy"].update(version=True),
    lambda value: value["policy"].update(effectiveComputeMicrodollars=500000000),
])
def test_resealed_invalid_funding_is_rejected(funded, change):
    path, _, _, _, target, funding = funded
    change(funding)
    funding["contentHash"] = control._budget_digest({key: value for key, value in funding.items() if key != "contentHash"})
    control.atomic_json(target, funding)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


@pytest.mark.parametrize("field", ["reservedUsd", "reservedComputeUsd", "reservedHours", "deadline"])
def test_old_holds_and_deadlines_cannot_be_released(funded, field):
    _, ledger, _, _, _, _ = funded
    ledger["leases"][-1][field] -= 1
    with pytest.raises(ValueError, match="retained|history"):
        control.infrastructure_funding(ledger)


def test_new_lease_requires_funding_hash_and_existing_time_limits(funded):
    _, ledger, _, _, target, _ = funded
    with pytest.raises(ValueError, match="predate"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW - 1}, 8, 4.776, NOW - 1)
    lease = control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
    ledger["leases"].append(lease)
    lease.pop("infrastructureFundingSupplementHash")
    with pytest.raises(ValueError, match="must bind"):
        control.infrastructure_funding(ledger)
    lease["infrastructureFundingSupplementHash"] = "f" * 64
    target.unlink()
    with pytest.raises(ValueError, match="missing"):
        control.infrastructure_funding(ledger)


def test_preparation_rejects_missing_or_exhausted_api_projection_before_journal_write(funded):
    path, ledger, _, _, _, funding = funded
    original = path.read_bytes()
    mock_ledger = copy.deepcopy(ledger)
    mock_ledger["plan"].update(region="test-region", firewallRulesetId="firewall", hardwareProfile="a100-40gb-v1")
    for inspection in ({}, {"infrastructureFundingSupplementHash": funding["contentHash"],
            "frozenApiHeadroomMicrodollars": 303000000, "frozenNonContingencyCeilingMicrodollars": 935000000,
            "frozenApiPlanHash": control._budget_digest(funding["policy"]["frozenApiPlanMicrodollars"]),
            "frozenProjectedNonContingencyMicrodollars": 930000000}):
        with patch.object(control, "checked_bound_ledger", return_value=mock_ledger), \
             patch.object(control, "infrastructure_funding", return_value=funding), \
             patch.object(control, "quote", return_value=quote()), \
             patch.object(control, "validate_firewall"), \
             patch.object(control, "reserve_lease", return_value={"id": "new", "reservedMicrodollars": 20696000}), \
             pytest.raises(ValueError, match="API headroom"):
            control.prepare_lease(None, path, 8, 4.776, now=NOW, budget=lambda *args, result=inspection: result)
    assert path.read_bytes() == original


def test_training_receipt_retains_v3_with_separate_provider_funding(funded, tmp_path):
    from acephale import training

    path, ledger, amendment, _, _, funding = funded
    lease = control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
    lease.update(status="active", instanceId="funded-instance", name="acephale-infra-" + lease["id"],
        studyReservation={"reservationId": "lambda-infra:" + lease["id"],
            "maximumMicrodollars": lease["reservedMicrodollars"], "infrastructureFundingSupplementHash": funding["contentHash"]})
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    preflight = tmp_path / "training-preflight.json"
    control.write_new(preflight, {"profile": "acephale-training-preflight-v1", "observedAt": NOW,
        "actorStopped": True, "gpuProcesses": 0, "hardwareProfile": "a100-40gb-v1",
        "hardwareProfileHash": quote()["hardwareProfileHash"]})
    target = tmp_path / "training-lease.json"
    with patch.object(control.time, "time", return_value=NOW):
        actual = control.training_lease(path, lease["id"], preflight, target, 4, "fit")
    assert actual["version"] == 3 and actual["budgetPolicy"] == amendment["policy"]
    assert actual["studyReservation"]["infrastructureFundingSupplementHash"] == funding["contentHash"]
    assert training.validate_training_lease(target, now=NOW) == actual


@pytest.fixture
def extended(funded):
    path, ledger, amendment, capacity, target, parent = funded
    old = control.reserve_lease(ledger, quote(), 6, 3.582, NOW)
    old.update(status="terminated", instanceId="previous-funded-instance", name="previous-funded-name")
    ledger["leases"].append(old)
    control.atomic_json(path, ledger)
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v2.json")
    body = {**copy.deepcopy(parent), "version": 2, "profile": "acephale-infrastructure-funding-v2",
            "policy": policy, "policyHash": control._budget_digest(policy),
            "parentFundingHash": parent["contentHash"], "parentFundingSha256": control.sha256(target),
            "baselineLeases": copy.deepcopy(ledger["leases"])}
    body.pop("contentHash")
    extension = {**body, "contentHash": control._budget_digest(body)}
    extension_path = Path(str(target).replace("-v1.json", "-v2.json"))
    control.write_new(extension_path, extension)
    return path, ledger, parent, target, extension, extension_path


def test_extension_retains_parent_and_reserves_exactly_one_six_hour_evaluation(extended):
    path, ledger, parent, target, extension, _ = extended
    before = target.read_bytes(), path.read_bytes()
    assert control.infrastructure_caps(ledger) == (320, 240, 80)
    assert control.infrastructure_funding(ledger) == extension
    with pytest.raises(ValueError, match="six hours"):
        control.reserve_lease(ledger, quote(), 6.01, 3.582, NOW)
    with pytest.raises(ValueError, match="approved rate"):
        control.reserve_lease(ledger, {**quote(), "hourlyUsd": 2.0}, 6, 3.582, NOW)
    lease = control.reserve_lease(ledger, quote(), 6, 3.582, NOW)
    assert lease["infrastructureFundingSupplementHash"] == extension["contentHash"]
    lease.update(status="terminated", instanceId="new-instance", name="new-name")
    ledger["leases"].append(lease)
    assert control.infrastructure_funding(ledger) == extension
    with pytest.raises(ValueError, match="only one"):
        control.reserve_lease(ledger, quote(), 1, 1, NOW)
    assert (target.read_bytes(), path.read_bytes()) == before


@pytest.mark.parametrize("change", [
    lambda value: value.update(parentFundingHash="f" * 64),
    lambda value: value.update(parentFundingSha256="f" * 64),
    lambda value: value["baselineLeases"][-1].update(infrastructureFundingSupplementHash="f" * 64),
    lambda value: value["baselineLeases"][0].update(reservedUsd=0),
    lambda value: value["policy"].update(effectiveComputeMicrodollars=241000000),
])
def test_extension_rejects_resealed_parent_history_or_cap_changes(extended, change):
    path, ledger, _, _, extension, target = extended
    change(extension)
    extension["contentHash"] = control._budget_digest({k:v for k,v in extension.items() if k != "contentHash"})
    control.atomic_json(target, extension)
    with pytest.raises(ValueError):
        control.infrastructure_funding(ledger)


def test_extension_cannot_authorize_optimizer_or_hide_parent(extended, tmp_path):
    path, ledger, _, parent_path, _, _ = extended
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", tmp_path/"unused-preflight", tmp_path/"unused-output", 1)
    parent_path.unlink()
    with pytest.raises(ValueError, match="missing|parent"):
        control.infrastructure_funding(ledger)


@pytest.mark.parametrize("funding_fixture", ["extended", "continued"])
def test_extended_funding_emits_unchanged_evaluation_contract(funding_fixture, request, tmp_path):
    from acephale.training import validate_execution_lease
    path, ledger, _, _, funding, _ = request.getfixturevalue(funding_fixture)
    lease = control.reserve_lease(ledger, quote(), 6, 3.582, NOW)
    lease.update(status="active", instanceId="evaluation-instance", name="evaluation-name",
        studyReservation={"reservationId":"lambda-infra:"+lease["id"],
            "maximumMicrodollars":lease["reservedMicrodollars"],"infrastructureFundingSupplementHash":funding["contentHash"]})
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    preflight, output = tmp_path/"preflight.json", tmp_path/"evaluation.json"
    control.write_new(preflight,{"profile":"acephale-evaluation-preflight-v1","leaseId":lease["id"],
        "instanceId":lease["instanceId"],"studyBindingHash":ledger["planHash"],"machineIdSha256":"d"*64,
        "providerReceiptSha256":"e"*64,"actorStopped":True,"gpuProcesses":0,"observedAt":NOW,
        "hardwareProfile":"a100-40gb-v1","hardwareProfileHash":quote()["hardwareProfileHash"]})
    before=path.read_bytes()
    with patch.object(control.time,"time",return_value=NOW):
        receipt=control.evaluation_lease(path,lease["id"],preflight,output,3600,source_probe=lambda _:"b"*40)
    assert path.read_bytes()==before
    assert receipt["optimizerAllowed"] is False
    assert receipt["newFinancialReservation"] is False
    for action in ("diagnostic","export","evaluate"):
        assert validate_execution_lease(output,action=action,now=NOW+1)==receipt
    with pytest.raises(ValueError):
        validate_execution_lease(output,action="train",now=NOW+1)


@pytest.fixture
def continued(extended):
    path, ledger, _, _, parent, parent_path = extended
    old = control.reserve_lease(ledger, quote(), 6, 3.582, NOW)
    old.update(status="terminated", instanceId="v2-funded-instance", name="v2-funded-name")
    ledger["leases"].append(old)
    control.atomic_json(path, ledger)
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v3.json")
    body = {**copy.deepcopy(parent), "version": 3, "profile": "acephale-infrastructure-funding-v3",
            "policy": policy, "policyHash": control._budget_digest(policy),
            "parentFundingHash": parent["contentHash"], "parentFundingSha256": control.sha256(parent_path),
            "baselineLeases": copy.deepcopy(ledger["leases"])}
    body.pop("contentHash")
    funding = {**body, "contentHash": control._budget_digest(body)}
    target = Path(str(parent_path).replace("-v2.json", "-v3.json"))
    control.write_new(target, funding)
    return path, ledger, parent, parent_path, funding, target


def test_continuation_binds_parent_and_admits_four_bounded_evaluation_leases(continued):
    path, ledger, _, parent_path, funding, _ = continued
    before = path.read_bytes(), parent_path.read_bytes()
    assert control.infrastructure_caps(ledger) == (420, 315, 105)
    assert control.effective_gpu_hour_capacity(ledger)[0] == 128
    assert control.infrastructure_funding(ledger) == funding
    for hours, rate in ((8.01, 1.99), (8, 2)):
        with pytest.raises(ValueError, match="eight hours|session"):
            control.reserve_lease(ledger, {**quote(), "hourlyUsd": rate}, hours, 4.776, NOW)
    for index in range(4):
        hours = 8 if index == 0 else 1
        lease = control.reserve_lease(ledger, quote(), hours, hours * 1.99 * .3, NOW)
        assert lease["infrastructureFundingSupplementHash"] == funding["contentHash"]
        lease.update(status="terminated", instanceId=f"new-{index}", name=f"new-{index}")
        ledger["leases"].append(lease)
        assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, quote(), 1, .597, NOW)
    assert (path.read_bytes(), parent_path.read_bytes()) == before


@pytest.mark.parametrize("change", [
    lambda value: value.update(parentFundingHash="f" * 64),
    lambda value: value.update(parentFundingSha256="f" * 64),
    lambda value: value["baselineLeases"][-1].update(infrastructureFundingSupplementHash="f" * 64),
    lambda value: value["baselineLeases"][0].update(reservedUsd=0),
    lambda value: value["policy"].update(maximumNewLeases=5),
])
def test_continuation_rejects_resealed_parent_history_or_expanded_policy(continued, change):
    _, ledger, _, _, funding, target = continued
    change(funding)
    funding["contentHash"] = control._budget_digest({k:v for k,v in funding.items() if k != "contentHash"})
    control.atomic_json(target, funding)
    with pytest.raises(ValueError):
        control.infrastructure_funding(ledger)


def test_continuation_cannot_authorize_optimizer_or_hide_parent(continued, tmp_path):
    path, ledger, _, parent_path, _, _ = continued
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "unused", tmp_path/"unused-preflight", tmp_path/"unused-output", 1)
    parent_path.unlink()
    with pytest.raises(ValueError, match="missing|parent"):
        control.infrastructure_funding(ledger)
