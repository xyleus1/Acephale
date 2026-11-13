"""Explicit budget amendments preserve prior charges, GPU hours and windows."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest

SPEC = importlib.util.spec_from_file_location("budget_policy_control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


@pytest.fixture
def amended(tmp_path):
    journal, path = tmp_path / "journal.jsonl", tmp_path / "slice.json"
    plan = {"studyLedgerPath": str(journal), "infrastructureLedgerPath": str(path), "sourceCommit": "a" * 40}
    ledger = {"profile": control.PROFILE, "schemaVersion": 2, "provider": "lambda", "plan": plan,
              "planHash": control.digest(plan), "versionsSha256": control.sha256(control.HERE / "versions.json"),
              "hardwareProfilesSha256": control.sha256(control.HERE / "hardware-profiles.json"),
              "priorGpuHours": 0.0, "priorInfraUsd": 0.0,
              "leases": [{"id": "old", "status": "terminated", "reservedHours": 10.0,
                          "reservedUsd": 25.0, "reservedComputeUsd": 20.0}], "overheads": [],
              "trainingWindows": [{"reservedSeconds": 7200}]}
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/budget-policy-v2.json")
    body = {"version": 2, "profile": "acephale-budget-amendment-v2", "policy": policy,
            "policyHash": control.digest(policy), "studyLedgerPathHash": control.digest(str(journal.resolve())),
            "infrastructureBindingHash": control._budget_binding_hash(ledger), "infrastructurePlanHash": ledger["planHash"],
            "baselineEntries": [{"id": "old", "allocation": "infrastructure", "maximum": 25000000}],
            "baselineLeases": json.loads(json.dumps(ledger["leases"])), "baselineOverheads": [],
            "baselineTrainingWindows": ledger["trainingWindows"].copy(), "authorizedAt": "2026-11-13T00:00:00Z"}
    amendment = {**body, "contentHash": control._budget_digest(body)}
    control.write_new(Path(str(journal) + ".policy-v2.json"), amendment)
    control.write_new(path, ledger)
    return path, ledger, amendment


def test_amendment_extends_caps_without_discarding_prior_gpu_hours(amended):
    _, ledger, amendment = amended
    assert control.effective_budget_policy(ledger) == amendment
    assert control.infrastructure_caps(ledger) == (50, 41, 9)
    selected = control.hardware_profile("a100-40gb-v1")
    quote = {"hourlyUsd": 1.99, "quotedAt": 10000, "hardwareProfile": selected["id"],
             "hardwareProfileHash": control.digest(selected), "instanceType": selected["instanceType"],
             "imageFamily": "gpu-base-24-04"}
    lease = control.reserve_lease(ledger, quote, 8, 0, 10000)
    assert lease["reservedComputeUsd"] == 15.92
    ledger["leases"][0]["reservedHours"] = 23
    with pytest.raises(ValueError, match="history"):
        control.reserve_lease(ledger, quote, 8, 0, 10000)


def test_separate_added_fit_and_smoke_windows_preserve_original_two_hours(amended, tmp_path):
    path, ledger, amendment = amended
    selected = control.hardware_profile("a100-40gb-v1")
    ledger["leases"].append({"id": "new", "status": "active", "instanceId": "instance", "deadline": 40000,
                             "quote": {"hardwareProfileHash": control.digest(selected)}, "studyReservation": {"reservationId": "funded"}})
    control.atomic_json(path, ledger)
    preflight = tmp_path / "preflight.json"
    control.write_new(preflight, {"profile": "acephale-training-preflight-v1", "actorStopped": True,
        "gpuProcesses": 0, "observedAt": 10000, "hardwareProfile": selected["id"], "hardwareProfileHash": control.digest(selected)})
    with patch.object(control.time, "time", return_value=10000):
        fit = control.training_lease(path, "new", preflight, tmp_path / "fit.json", 4, "fit")
        smoke = control.training_lease(path, "new", preflight, tmp_path / "smoke.json", .25, "smoke")
        assert fit["version"] == 2 and fit["budgetAmendmentHash"] == amendment["contentHash"]
        assert fit["deadline"] - fit["startedAt"] == 14400
        assert smoke["deadline"] - smoke["startedAt"] == 900
        with pytest.raises(ValueError, match="kind allowance"):
            control.training_lease(path, "new", preflight, tmp_path / "extra.json", .01, "smoke")
    checked = control.checked_bound_ledger(path)
    assert sum(row["reservedSeconds"] for row in checked["trainingWindows"]) == 22500
    assert checked["trainingWindows"][0] == {"reservedSeconds": 7200}


def test_resealed_policy_or_history_change_cannot_expand_authorization(amended):
    path, ledger, amendment = amended
    amendment["policy"]["additionalFittingSeconds"] += 3600
    amendment["policyHash"] = control.digest(amendment["policy"])
    amendment["contentHash"] = control.digest({key: value for key, value in amendment.items() if key != "contentHash"})
    control.atomic_json(Path(ledger["plan"]["studyLedgerPath"] + ".policy-v2.json"), amendment)
    with pytest.raises(ValueError, match="approved policy"):
        control.checked_bound_ledger(path)


def test_financial_hash_matches_integral_json_numbers():
    assert control._budget_binding_hash({"priorGpuHours": 0.0, "priorInfraUsd": 1.5}) == control.digest({"priorGpuHours": 0, "priorInfraUsd": 1.5})


def test_original_caps_remain_available_without_an_external_binding():
    assert control.infrastructure_caps({"leases": [], "overheads": []}) == (35, 30, 5)


def suballocate(path, *, budget=None):
    return control.record_infrastructure_suballocation(path, "Reserve observed tax uncertainty within the same total",
        source_probe=lambda original: "b" * 40,
        budget=budget or (lambda plan, operation: {"operation": operation, "unchanged": True}))


def test_suballocation_preserves_original_files_and_changes_only_future_caps(amended):
    path, ledger, amendment = amended
    journal = Path(ledger["plan"]["studyLedgerPath"])
    journal.write_text('{"originalReservation":true}\n')
    policy_path = Path(str(journal) + ".policy-v2.json")
    before = {item: item.read_bytes() for item in (path, journal, policy_path)}
    result = suballocate(path)
    assert control.infrastructure_caps(ledger) == (50, 36.25, 13.75)
    assert result["budgetAmendmentHash"] == amendment["contentHash"]
    assert result["reservedAtAmendment"] == {"infrastructureUsd": 25, "computeUsd": 20, "associatedUsd": 5}
    assert result["otherAllocationsChanged"] is False and result["existingReservationsChanged"] is False
    assert result["originalJournalEvidence"]["operation"] == "inspect"
    assert all(item.read_bytes() == raw for item, raw in before.items())
    with pytest.raises(ValueError, match="already exists"):
        suballocate(path)


def test_suballocation_enforces_revised_compute_and_associated_caps(amended):
    path, ledger, _ = amended
    suballocate(path)
    selected = control.hardware_profile("a100-40gb-v1")
    quote = {"hourlyUsd": 1.99, "quotedAt": 10000, "hardwareProfile": selected["id"],
             "hardwareProfileHash": control.digest(selected), "instanceType": selected["instanceType"],
             "imageFamily": "gpu-base-24-04"}
    assert control.reserve_lease(ledger, quote, 1, 6, 10000)["reservedUsd"] == 7.99
    with pytest.raises(ValueError, match="Cumulative"):
        control.reserve_lease(ledger, quote, 1, 8.76, 10000)
    ledger["leases"].append({"id": "later", "status": "terminated", "reservedHours": 1,
                              "reservedUsd": 1, "reservedComputeUsd": 1})
    with pytest.raises(ValueError, match="Cumulative"):
        control.reserve_lease(ledger, quote, 8, 0, 10000)


def test_suballocation_cannot_drop_already_reserved_compute(amended):
    path, ledger, _ = amended
    ledger["leases"].append({"id": "retained", "status": "terminated", "reservedHours": 1,
                              "reservedUsd": 16.5, "reservedComputeUsd": 16.5})
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match="below already reserved"):
        suballocate(path)
    assert not control.infrastructure_suballocation_path(path).exists()


def test_suballocation_keeps_reservations_while_allowing_operational_status_updates(amended):
    path, ledger, _ = amended
    ledger["leases"].append({"id": "canary", "status": "active", "reservedHours": .1,
                              "reservedUsd": .3, "reservedComputeUsd": .2})
    control.atomic_json(path, ledger)
    suballocate(path)
    ledger["leases"][-1]["status"] = "terminated"
    assert control.infrastructure_caps(ledger) == (50, 36.25, 13.75)
    ledger["leases"][-1]["reservedUsd"] = .2
    with pytest.raises(ValueError, match="retained reservations"):
        control.infrastructure_caps(ledger)


def test_suballocation_rejects_resealed_caps_or_changed_policy_bytes(amended):
    path, ledger, _ = amended
    original = suballocate(path)
    changed = json.loads(json.dumps(original))
    changed["effectiveCaps"]["computeUsd"] = 40
    changed["contentHash"] = control.digest({key: value for key, value in changed.items() if key != "contentHash"})
    sidecar = control.infrastructure_suballocation_path(path)
    control.atomic_json(sidecar, changed)
    with pytest.raises(ValueError, match="unchanged financial"):
        control.checked_bound_ledger(path)
    control.atomic_json(sidecar, original)
    policy_path = Path(ledger["plan"]["studyLedgerPath"] + ".policy-v2.json")
    policy_path.write_text(policy_path.read_text() + " ")
    with pytest.raises(ValueError, match="unchanged financial"):
        control.checked_bound_ledger(path)


def test_suballocation_fails_if_source_slice_changes_during_journal_inspection(amended):
    path, ledger, _ = amended
    def change(plan, operation):
        ledger["overheads"].append({"id": "raced", "reservedUsd": .1})
        control.atomic_json(path, ledger)
        return {"operation": operation}
    with pytest.raises(ValueError, match="changed during"):
        suballocate(path, budget=change)
    assert not control.infrastructure_suballocation_path(path).exists()


def test_tax_allowance_keeps_an_explicit_kind_and_existing_overhead_default(amended):
    path, _, _ = amended
    def budget(plan, operation, row):
        return {"reservationId": row["id"], "maximumMicrodollars": row["reservedMicrodollars"]}
    tax = control.reserve_overhead(path, "11111111-1111-4111-8111-111111111111", 1,
                                   kind="provider_tax_allowance", budget=budget)
    normal = control.reserve_overhead(path, "22222222-2222-4222-8222-222222222222", 1, budget=budget)
    assert tax["kind"] == "provider_tax_allowance" and tax["reservedUsd"] == 1
    assert normal["kind"] == "watchdog_storage_export"
    before = path.read_bytes()
    with pytest.raises(ValueError, match="associated-charge kind"):
        control.reserve_overhead(path, "33333333-3333-4333-8333-333333333333", 1, kind="arbitrary", budget=budget)
    assert path.read_bytes() == before


def expand_v3(ledger, parent):
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/budget-policy-v3.json")
    body = {**{key: value for key, value in parent.items() if key != "contentHash"},
        "version": 3, "profile": "acephale-budget-amendment-v3", "policy": policy,
        "policyHash": control._budget_digest(policy), "parentAmendmentHash": parent["contentHash"],
        "baselineLeases": json.loads(json.dumps(ledger["leases"])),
        "baselineOverheads": json.loads(json.dumps(ledger["overheads"])),
        "baselineTrainingWindows": json.loads(json.dumps(ledger["trainingWindows"]))}
    value = {**body, "contentHash": control._budget_digest(body)}
    control.write_new(Path(ledger["plan"]["studyLedgerPath"] + ".policy-v3.json"), value)
    return value


def test_v3_retains_v2_windows_and_suballocation_but_applies_new_future_caps(amended):
    path, ledger, parent = amended
    suballocate(path)
    parent_bytes = Path(ledger["plan"]["studyLedgerPath"] + ".policy-v2.json").read_bytes()
    ledger["trainingWindows"].extend([
        {"reservedSeconds": 14400, "trainingKind": "fit", "budgetAmendmentHash": parent["contentHash"]},
        {"reservedSeconds": 900, "trainingKind": "smoke", "budgetAmendmentHash": parent["contentHash"]}])
    current = expand_v3(ledger, parent)
    ledger["leases"].append({"id": "v3-work", "status": "terminated", "reservedHours": 20,
                              "reservedUsd": 40, "reservedComputeUsd": 40})
    ledger["trainingWindows"].append({"reservedSeconds": 14400, "trainingKind": "fit", "budgetAmendmentHash": current["contentHash"]})
    assert control.effective_budget_policy(ledger) == current
    assert control.infrastructure_caps(ledger) == (200, 150, 50)
    assert Path(ledger["plan"]["studyLedgerPath"] + ".policy-v2.json").read_bytes() == parent_bytes
    selected = control.hardware_profile("a100-40gb-v1")
    quote = {"hourlyUsd": 1.99, "quotedAt": 10000, "hardwareProfile": selected["id"],
             "hardwareProfileHash": control.digest(selected), "instanceType": selected["instanceType"], "imageFamily": "gpu-base-24-04"}
    assert control.reserve_lease(ledger, quote, 8, 0, 10000)["reservedComputeUsd"] == 15.92
    ledger["trainingWindows"][-1]["budgetAmendmentHash"] = parent["contentHash"]
    with pytest.raises(ValueError, match="does not bind"):
        control.effective_budget_policy(ledger)


def test_v3_rejects_changed_parent_or_historical_v2_overrun(amended):
    _, ledger, parent = amended
    ledger["trainingWindows"].append({"reservedSeconds": 901, "trainingKind": "smoke", "budgetAmendmentHash": parent["contentHash"]})
    expand_v3(ledger, parent)
    with pytest.raises(ValueError, match="windows exceed"):
        control.effective_budget_policy(ledger)


def test_v3_training_lease_has_separate_added_allowance(amended, tmp_path):
    path, ledger, parent = amended
    current = expand_v3(ledger, parent)
    selected = control.hardware_profile("a100-40gb-v1")
    ledger["leases"].append({"id": "new", "status": "active", "instanceId": "instance", "deadline": 50000,
        "quote": {"hardwareProfileHash": control.digest(selected)}, "studyReservation": {"reservationId": "funded"}})
    control.atomic_json(path, ledger)
    preflight = tmp_path / "preflight.json"
    control.write_new(preflight, {"profile": "acephale-training-preflight-v1", "actorStopped": True,
        "gpuProcesses": 0, "observedAt": 10000, "hardwareProfile": selected["id"], "hardwareProfileHash": control.digest(selected)})
    with patch.object(control.time, "time", return_value=10000):
        first = control.training_lease(path, "new", preflight, tmp_path / "first.json", 4, "fit")
        control.training_lease(path, "new", preflight, tmp_path / "second.json", 4, "fit")
        assert first["version"] == 3 and first["budgetAmendmentHash"] == current["contentHash"]
        with pytest.raises(ValueError, match="kind allowance"):
            control.training_lease(path, "new", preflight, tmp_path / "third.json", .01, "fit")


@pytest.mark.parametrize("timestamp", [None, "not-a-date", "2026-11-12T23:59:59Z"])
def test_v3_requires_finite_authorization_no_earlier_than_its_parent(amended, timestamp):
    _, ledger, parent = amended
    current = expand_v3(ledger, parent)
    current["authorizedAt"] = timestamp
    current["contentHash"] = control._budget_digest({key: value for key, value in current.items() if key != "contentHash"})
    control.atomic_json(Path(ledger["plan"]["studyLedgerPath"] + ".policy-v3.json"), current)
    with pytest.raises(ValueError, match="timestamp|parent chain"):
        control.effective_budget_policy(ledger)
