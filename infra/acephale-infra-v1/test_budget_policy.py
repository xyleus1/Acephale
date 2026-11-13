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
    plan = {"studyLedgerPath": str(journal), "infrastructureLedgerPath": str(path)}
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
