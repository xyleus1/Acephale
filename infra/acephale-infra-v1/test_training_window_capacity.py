"""An extra operator window preserves all financial and frozen model contracts."""
import ast
import hashlib
import inspect
from pathlib import Path
from unittest.mock import patch

import pytest
from test_budget_policy import amended, control, expand_v3  # noqa: F401
from test_gpu_hour_capacity import NOW, capacity_base, quote  # noqa: F401
from test_infrastructure_funding import funded  # noqa: F401


REQUEST = {"version": 1, "windows": [{"name": "profile-and-main", "kind": "fit", "seconds": 14400}]}


def add_used_windows(ledger, amendment):
    for index, (kind, seconds) in enumerate((("smoke", 900), ("fit", 14400), ("fit", 14400))):
        start = NOW - 70000 + index * 15000
        ledger["trainingWindows"].append({"leaseId": "old", "reservedSeconds": seconds,
            "startedAt": start, "deadline": start + seconds, "receiptHash": str(index) * 64,
            "trainingKind": kind, "budgetAmendmentHash": amendment["contentHash"]})


@pytest.fixture
def exhausted(amended):  # noqa: F811
    path, ledger, parent = amended
    ledger["trainingWindows"].append({"reservedSeconds": 900, "trainingKind": "smoke", "budgetAmendmentHash": parent["contentHash"]})
    amendment = expand_v3(ledger, parent)
    add_used_windows(ledger, amendment)
    control.atomic_json(path, ledger)
    return path, ledger, amendment


def record(path, ledger, *, budget=None):
    history_path = path.with_name("training-history.json")
    control.write_new(history_path, control.training_window_history(ledger, control.sha256(path)))
    with patch.object(control.time, "time", return_value=NOW):
        return control.record_training_window_capacity_addendum(path, "Continue the original declared fitting work.", history_path,
            source_probe=lambda _: "b" * 40, budget=budget or (lambda _plan, operation: {"operation": operation}))


def active_lease(path, ledger, *, allowance=0):
    lease = control.reserve_lease(ledger, quote(), 8, allowance, NOW)
    lease.update(status="active", instanceId="new-instance", name="owned-" + lease["id"],
                 studyReservation={"reservationId": "lambda-infra:" + lease["id"], "maximumMicrodollars": lease["reservedMicrodollars"]})
    ledger["leases"].append(lease)
    control.atomic_json(path, ledger)
    preflight = path.with_name("preflight.json")
    control.write_new(preflight, {"profile": "acephale-training-preflight-v1", "observedAt": NOW, "actorStopped": True,
        "gpuProcesses": 0, "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": quote()["hardwareProfileHash"]})
    return lease, preflight


def third_window(path, ledger):
    lease, preflight = active_lease(path, ledger)
    receipt_path = path.with_name("fit.json")
    with patch.object(control.time, "time", return_value=NOW):
        receipt = control.training_lease(path, lease["id"], preflight, receipt_path, 4, "fit")
    return lease, preflight, receipt_path, receipt


def test_creation_only_preserves_both_policy_files_slice_and_all_windows(exhausted):
    path, ledger, amendment = exhausted
    files = [path, *[Path(ledger["plan"]["studyLedgerPath"] + f".policy-v{version}.json") for version in (2, 3)]]
    before = {item: item.read_bytes() for item in files}
    calls = []
    def budget(_plan, operation):
        calls.append(operation)
        return {"operation": operation}
    with pytest.raises(ValueError, match="kind allowance"):
        control.training_window_headroom(path, REQUEST)
    capacity = record(path, ledger, budget=budget)
    assert calls == ["inspect"]
    assert all(item.read_bytes() == data for item, data in before.items())
    assert control.effective_budget_policy(ledger) == amendment
    gate = control.training_window_headroom(path, REQUEST)
    assert gate["verified"] and gate["usedSeconds"] == {"fit": 28800, "smoke": 900}
    assert gate["effectiveAdditionalSeconds"] == {"fit": 43200, "smoke": 900}
    assert gate["remainingSeconds"] == {"fit": 0, "smoke": 0}
    assert gate["infrastructureSliceSha256"] == control.sha256(path)
    assert capacity["operationalHistory"]["trainingWindows"] == ledger["trainingWindows"]
    assert sum(row["reservedSeconds"] for row in ledger["trainingWindows"] if row.get("trainingKind") == "smoke") == 1800
    with pytest.raises(ValueError, match="overwritten"):
        control.record_training_window_capacity_addendum(path, "Again", path.with_name("training-history.json"))


def test_third_window_works_with_frozen_trainer_then_watchdog_provider_and_cleanup(exhausted, tmp_path):
    from acephale import training

    path, ledger, amendment = exhausted
    capacity = record(path, ledger)
    lease, _, receipt_path, receipt = third_window(path, ledger)
    assert receipt["version"] == 3 and receipt["profile"] == "acephale-training-lease-v3"
    assert receipt["budgetPolicy"] == amendment["policy"] and receipt["budgetPolicy"]["additionalFittingSeconds"] == 28800
    assert receipt["trainingWindowCapacityAddendumHash"] == capacity["contentHash"]
    assert training.validate_training_lease(receipt_path, now=NOW) == receipt
    frozen_reader = ast.parse(inspect.getsource(training.validate_training_lease)).body[0]
    assert hashlib.sha256(ast.dump(frozen_reader, include_attributes=False).encode()).hexdigest() == \
        "10a91fe8126f78880cb7bb1515158da98ed460e5947a3f9690c55f4fb4029a18"
    checked = control.checked_bound_ledger(path)
    assert checked["trainingWindows"][:-1] == capacity["operationalHistory"]["trainingWindows"]
    assert checked["trainingWindows"][-1]["receiptHash"] == control.digest(receipt)
    assert control.watchdog_state(path, lease["id"])["deadline"] == lease["deadline"]
    ssh = tmp_path / "ssh.json"
    control.write_new(ssh, {"host": "192.0.2.1", "port": 22, "user": "ubuntu",
        "hostKeySha256": "SHA256:" + "A" * 43, "machineIdSha256": "c" * 64})
    class Provider:
        def request(self, method, endpoint):
            assert method == "GET"
            if endpoint == "/instances":
                return []
            assert endpoint == "/instances/new-instance"
            return {"id": lease["instanceId"], "name": lease["name"], "status": "active", "ip": "192.0.2.1",
                    "instance_type": {"name": quote()["instanceType"]}}
    control.provider_receipt(Provider(), path, lease["id"], ssh, tmp_path / "provider.json")
    observed = control.read_json(tmp_path / "provider.json")
    assert observed["trainingWindowCapacityAuthorization"]["contentHash"] == capacity["contentHash"]
    assert observed["trainingWindowCapacityAuthorization"]["effectiveAdditionalFittingSeconds"] == 43200
    terminated = control.observe_termination(Provider(), path, lease["id"])
    assert terminated["status"] == "terminated" and terminated["reservedUsd"] == lease["reservedUsd"]
    assert control.checked_bound_ledger(path)["leases"][-1]["reservedMicrodollars"] == lease["reservedMicrodollars"]
    assert control.training_window_headroom(path, {"version": 1, "windows": []})["usedSeconds"]["fit"] == 43200


def test_real_and_prelaunch_admission_share_remaining_and_per_window_limits(exhausted):
    path, ledger, _ = exhausted
    record(path, ledger)
    for windows in ([{"name": "too-long", "kind": "fit", "seconds": 14401}],
                    [{"name": "extra-smoke", "kind": "smoke", "seconds": 1}],
                    [{"name": str(index), "kind": "fit", "seconds": 14400} for index in range(2)]):
        with pytest.raises(ValueError):
            control.training_window_headroom(path, {"version": 1, "windows": windows})
    lease, preflight, _, _ = third_window(path, ledger)
    before = path.read_bytes()
    with patch.object(control.time, "time", return_value=NOW):
        with pytest.raises(ValueError, match="kind allowance"):
            control.training_lease(path, lease["id"], preflight, path.with_name("fourth.json"), .01, "fit")
        with pytest.raises(ValueError, match="kind allowance"):
            control.training_lease(path, lease["id"], preflight, path.with_name("extra-smoke.json"), .01, "smoke")
    assert path.read_bytes() == before and not path.with_name("fourth.json").exists()


@pytest.mark.parametrize("change", [
    lambda value: value["capacityPolicy"].update(additionalFittingSeconds=57600),
    lambda value: value["capacityPolicy"].update(additionalSmokeSeconds=1800),
    lambda value: value["capacityPolicy"].update(maxTrainingWindowSeconds=28800),
    lambda value: value["capacityPolicy"].update(version=True),
    lambda value: value.update(version=True),
    lambda value: value.update(budgetAmendmentHash="f" * 64),
    lambda value: value.update(financialAuthorityChanged=True),
    lambda value: value.update(existingWindowsChanged=True),
    lambda value: value.update(recordedAt=0),
])
def test_resealed_capacity_changes_are_denied(exhausted, change):
    path, ledger, _ = exhausted
    value = record(path, ledger)
    change(value)
    value["capacityPolicyHash"] = control.digest(value["capacityPolicy"])
    value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
    control.atomic_json(control.training_window_capacity_path(path), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


@pytest.mark.parametrize("change", [
    lambda ledger: ledger["trainingWindows"].pop(0),
    lambda ledger: ledger["trainingWindows"][-1].update(reservedSeconds=14399),
    lambda ledger: ledger["leases"][0].update(reservedUsd=1),
])
def test_retained_windows_and_financial_holds_cannot_change(exhausted, change):
    path, ledger, _ = exhausted
    record(path, ledger)
    change(ledger)
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_unknown_launch_is_retained_but_may_gain_a_verified_terminal_state(exhausted):
    path, ledger, _ = exhausted
    ledger["leases"].append({"id": "unknown", "status": "launch_unknown", "instanceId": None,
        "reservedHours": 8, "reservedUsd": 15.92, "reservedComputeUsd": 15.92,
        "reservedMicrodollars": 15920000, "deadline": NOW - 1})
    control.atomic_json(path, ledger)
    value = record(path, ledger)
    assert value["operationalHistory"]["leases"][-1]["status"] == "launch_unknown"
    ledger["leases"][-1].update(status="terminated", instanceId="later-identified-instance")
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path)["leases"][-1]["reservedMicrodollars"] == 15920000


@pytest.mark.parametrize("change", ["missing_sidecar", "missing_binding", "later_deadline"])
def test_new_window_requires_sidecar_and_unchanged_deadline(exhausted, change):
    path, ledger, _ = exhausted
    record(path, ledger)
    third_window(path, ledger)
    if change == "missing_sidecar":
        control.training_window_capacity_path(path).unlink()
    else:
        actual = control.read_json(path)
        if change == "missing_binding": actual["trainingWindows"][-1].pop("trainingWindowCapacityAddendumHash")
        else: actual["trainingWindows"][-1]["deadline"] += 1
        control.atomic_json(path, actual)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_capacity_coexists_with_gpu_hours_and_separate_financial_supplement(funded):  # noqa: F811
    path, ledger, amendment, gpu_capacity, funding_path, funding = funded
    add_used_windows(ledger, amendment)
    control.atomic_json(path, ledger)
    before_funding = funding_path.read_bytes()
    before_gpu = control.gpu_hour_capacity_path(path).read_bytes()
    record(path, ledger)
    lease, preflight = active_lease(path, ledger, allowance=4.776)
    with patch.object(control.time, "time", return_value=NOW):
        control.training_lease(path, lease["id"], preflight, path.with_name("fit.json"), 4, "fit")
    actual = control.checked_bound_ledger(path)
    assert control.effective_gpu_hour_capacity(actual) == (128, gpu_capacity)
    assert control.infrastructure_funding(actual) == funding
    assert control.infrastructure_caps(actual) == (300, 225, 75)
    assert control._infrastructure_reserved_totals(actual)["infrastructureUsd"] == 212.497503
    assert funding_path.read_bytes() == before_funding and control.gpu_hour_capacity_path(path).read_bytes() == before_gpu


def test_contract_is_bound_in_controller_source_inventory():
    rows = control.controller_source_files()
    matches = [row for row in rows if row["path"] == "training-window-capacity-v1.json"]
    assert matches == [{"path": "training-window-capacity-v1.json", "sha256": control.sha256(control.HERE / "training-window-capacity-v1.json")}]
