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
