"""Real-file cancellation tests. Provider and Windows inventories are injected."""

import copy
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("cancel_unlaunched", HERE / "cancel_unlaunched.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

@pytest.fixture(scope="session")
def old_source(tmp_path_factory):
    if os.name != "nt":
        pytest.skip("Actual Windows exclusive lock is required")
    # Reproduce the reviewed Windows checkout from its immutable Git source.
    raw = subprocess.run(["git", "show", "7f1ebb176ad9243961d7398289cdea391b1c587b:infra/acephale-infra-v1/control.py"],
                         cwd=HERE, capture_output=True, check=True).stdout
    path = tmp_path_factory.mktemp("source") / "control.py"
    path.write_bytes(raw.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert module.sha(path) == module.PREDISPATCH_SOURCE_SHA256
    return path


class Provider:
    def __init__(self):
        self.inventory = {"data": [{"id": "unrelated", "name": "neighbor"}]}
        self.calls = []

    def request(self, method, path):
        self.calls.append((method, path))
        assert (method, path) == ("GET", "/instances")
        return copy.deepcopy(self.inventory)


@pytest.fixture
def case(tmp_path, old_source):
    if os.name != "nt":
        pytest.skip("Actual Windows exclusive lock is required")
    run = tmp_path / "run"
    run.mkdir()
    journal = tmp_path / "budget.jsonl"
    journal.write_bytes(b'{"held":13241829}\n{"tax":4172101}\n')
    authority = tmp_path / "budget.jsonl.policy-v3.json"
    authority.write_bytes(b'{"original":true}')
    ledger_path = tmp_path / "ledger.json"
    lock_path = tmp_path / "ledger.json.lock"
    # Impossible PIDs only in the injected OS inventory; no actual task query.
    pids = [900001, 900002]
    lock_path.write_bytes(str(pids[0]).encode())
    lease = {"id": "lease-1", "name": "acephale-infra-lease-1", "status": "reserved",
             "instanceId": None, "ready": False, "deadline": 4000, "setupDeadline": 2000,
             "reservedHours": 2, "reservedMicrodollars": 13241829,
             "studyReservation": {"reservationId": "held", "maximumMicrodollars": 13241829}}
    unknown = {"id": "unknown", "status": "launch_unknown", "instanceId": None,
               "reservedMicrodollars": 999, "deadline": 1000}
    ledger = {"plan": {"studyLedgerPath": str(journal)}, "leases": [unknown, lease],
              "overheads": [{"id": "tax", "reservedMicrodollars": 4172101}], "trainingWindows": []}
    module.write_new(ledger_path, ledger)
    module.write_new(run / "reserved.json", lease)
    stopped = {"kind": "acephale-stopped-predispatch-reservation-v1", "leaseId": lease["id"],
               "expectedName": lease["name"], "instanceId": None, "ledgerStatus": "reserved",
               "infrastructureSliceSha256": module.sha(ledger_path),
               "reservedReceiptSha256": module.sha(run / "reserved.json"),
               "stoppedProcessIds": pids, "exactProcessesAndChildrenAbsent": True,
               "originalStateTransitionRequiresLaunchingBeforeProviderPost": True,
               "deadline": 4000, "exactProviderMatches": 0, "financialMutationPerformed": False,
               "providerMutationPerformed": False, "providerTerminationClaimed": False,
               "crashLockPath": str(lock_path), "crashLockSha256": module.sha(lock_path)}
    module.write_new(run / "stopped.json", stopped)
    tasks = [{"name": "Acephale-Study-test", "required": True},
             {"name": "Acephale-Heartbeat-test", "required": False}]
    request = {"version": 1, "kind": "acephale-cancel-unlaunched-request-v1", "leaseId": lease["id"],
               "ledgerPath": str(ledger_path), "ledgerSha256": module.sha(ledger_path),
               "runDirectory": str(run), "reservedReceiptPath": str(run / "reserved.json"),
               "reservedReceiptSha256": module.sha(run / "reserved.json"),
               "stoppedReceiptPath": str(run / "stopped.json"), "stoppedReceiptSha256": module.sha(run / "stopped.json"),
               "predispatchSourcePath": str(old_source), "outputDirectory": str(tmp_path / "cancellation"),
               "stoppedProcessIds": pids, "tasks": tasks,
               "financialFiles": [{"path": str(path), "sha256": module.sha(path)} for path in (journal, authority)]}
    inventory = {"processes": [{"pid": 13, "parentPid": 12}],
                 "tasks": [{"name": tasks[0]["name"], "exists": True, "enabled": False, "state": 1},
                           {"name": tasks[1]["name"], "exists": False}]}
    provider = Provider()
    return {"request": request, "ledger": ledger, "provider": provider, "inventory": inventory,
            "ledger_path": ledger_path, "lock_path": lock_path, "run": run, "journal": journal,
            "validate": module.read}


def apply(case, snapshot=None):
    return module.cancel(case["request"], case["provider"], validate_ledger=case["validate"],
                         owner_snapshot=snapshot or (lambda _: copy.deepcopy(case["inventory"])), clock=lambda: 1100)


def repin(case):
    request = case["request"]
    request["ledgerSha256"] = module.sha(case["ledger_path"])
    request["reservedReceiptSha256"] = module.sha(case["run"] / "reserved.json")
    stopped = module.read(case["run"] / "stopped.json")
    stopped["infrastructureSliceSha256"] = request["ledgerSha256"]
    stopped["reservedReceiptSha256"] = request["reservedReceiptSha256"]
    (case["run"] / "stopped.json").write_text(json.dumps(stopped), encoding="utf-8")
    request["stoppedReceiptSha256"] = module.sha(case["run"] / "stopped.json")


def test_exact_cancellation_retains_holds_history_and_deadlines(case):
    before_financial = {row["path"]: Path(row["path"]).read_bytes() for row in case["request"]["financialFiles"]}
    result = apply(case)
    after = module.read(case["ledger_path"])
    closed = after["leases"][1]
    added = {"closureKind", "providerDispatchOccurred", "providerTerminationVerified", "cancellationVerifiedAt", "closureEvidenceHash"}
    assert {key: value for key, value in closed.items() if key not in added | {"status"}} == {
        key: value for key, value in case["ledger"]["leases"][1].items() if key != "status"}
    assert {**after, "leases": case["ledger"]["leases"]} == case["ledger"]
    assert after["leases"][0] == case["ledger"]["leases"][0]
    assert closed["status"] == "terminated" and closed["closureKind"] == "cancelled_before_provider_dispatch"
    assert closed["providerTerminationVerified"] is False and closed["providerDispatchOccurred"] is False
    assert "terminationVerifiedAt" not in closed and "terminationEvidenceHash" not in closed
    assert result["financialReservationsRetained"] is True
    assert not case["lock_path"].exists()
    assert case["provider"].calls == [("GET", "/instances")] * 2
    assert all(Path(path).read_bytes() == raw for path, raw in before_financial.items())
    output = Path(case["request"]["outputDirectory"])
    assert (output / "dead-owner-lock.original").read_bytes() == b"900001"
    assert module.read(output / "result.json")["deadOwnerLockRemoved"] is True


@pytest.mark.parametrize("status", ["launching", "launch_unknown", "active", "termination_requested", "terminated", "reservation_pending"])
def test_never_closes_other_states_even_with_matching_receipt(case, status):
    ledger = case["ledger"]
    ledger["leases"][1]["status"] = status
    case["ledger_path"].write_text(json.dumps(ledger), encoding="utf-8")
    (case["run"] / "reserved.json").write_text(json.dumps(ledger["leases"][1]), encoding="utf-8")
    repin(case)
    before = case["ledger_path"].read_bytes()
    with pytest.raises(ValueError, match="unattempted"):
        apply(case)
    assert case["ledger_path"].read_bytes() == before and case["lock_path"].read_bytes() == b"900001"


@pytest.mark.parametrize("field,value", [("instanceId", "actual-id"), ("ready", True), ("watchdogs", [])])
def test_attempt_evidence_disqualifies_cancellation(case, field, value):
    ledger = case["ledger"]
    ledger["leases"][1][field] = value
    case["ledger_path"].write_text(json.dumps(ledger), encoding="utf-8")
    (case["run"] / "reserved.json").write_text(json.dumps(ledger["leases"][1]), encoding="utf-8")
    repin(case)
    with pytest.raises(ValueError, match="unattempted"):
        apply(case)


@pytest.mark.parametrize("live", [[{"pid": 900001, "parentPid": 1}],
                                   [{"pid": 123, "parentPid": 900002}],
                                   [{"pid": 123, "parentPid": 900002}, {"pid": 124, "parentPid": 123}]])
def test_live_owner_or_descendant_rejected(case, live):
    case["inventory"]["processes"] = live
    with pytest.raises(ValueError, match="still alive"):
        apply(case)
    assert case["lock_path"].read_bytes() == b"900001"


@pytest.mark.parametrize("update", [{"enabled": True}, {"state": 4}, {"exists": False}])
def test_scheduled_owner_must_be_disabled(case, update):
    case["inventory"]["tasks"][0].update(update)
    with pytest.raises(ValueError, match="disabled"):
        apply(case)


def test_provider_name_present_is_not_termination(case):
    case["provider"].inventory["data"].append({"id": "any", "name": "acephale-infra-lease-1", "status": "terminated"})
    with pytest.raises(ValueError, match="provider name"):
        apply(case)
    assert case["lock_path"].read_bytes() == b"900001"


@pytest.mark.parametrize("marker", ["launched.json", "successor-sequence/anything.dispatch.json", "study-start-release.json"])
def test_any_dispatch_marker_prevents_cancellation(case, marker):
    path = case["run"] / marker
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="dispatch marker"):
        apply(case)


def test_changed_lock_never_removed(case):
    case["lock_path"].write_bytes(b"999999")
    before = case["ledger_path"].read_bytes()
    with pytest.raises(ValueError, match="lock bytes"):
        apply(case)
    assert case["lock_path"].read_bytes() == b"999999" and case["ledger_path"].read_bytes() == before


def test_exclusive_lock_blocks_other_owners(case):
    path = case["lock_path"]
    with module.DeadLock(path, module.sha(path), [900001]) as lock:
        with pytest.raises(OSError):
            path.open("wb")
        with pytest.raises(FileExistsError):
            path.open("x")
        lock.claim()
        lock.release()
    assert not path.exists()


def test_reparse_lock_cannot_modify_or_delete_another_file(case):
    target = case["lock_path"].with_name("unrelated-file")
    target.write_bytes(b"900001")
    case["lock_path"].unlink()
    try:
        case["lock_path"].symlink_to(target)
    except OSError as error:
        pytest.skip(f"Host does not permit creating test symlinks: {error.winerror}")
    with pytest.raises(ValueError, match="reparse point"):
        apply(case)
    assert target.read_bytes() == b"900001"
    assert case["lock_path"].is_symlink()


def test_late_financial_change_retains_claimed_lock_and_does_not_close(case):
    calls = 0

    def observe(_):
        nonlocal calls
        calls += 1
        if calls == 3:
            case["journal"].write_bytes(b"changed externally")
        return copy.deepcopy(case["inventory"])

    before = case["ledger_path"].read_bytes()
    with pytest.raises(ValueError, match="pinned input changed"):
        apply(case, observe)
    assert case["ledger_path"].read_bytes() == before
    assert case["lock_path"].read_bytes() == str(os.getpid()).encode()
    assert not (Path(case["request"]["outputDirectory"]) / "result.json").exists()


def test_new_sidecar_requires_explicit_pin(case):
    (case["journal"].parent / (case["journal"].name + ".new.json")).write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="every authority"):
        apply(case)


def test_late_new_authority_retains_claimed_lock_and_does_not_close(case):
    calls = 0

    def observe(_):
        nonlocal calls
        calls += 1
        if calls == 3:
            (case["journal"].parent / (case["journal"].name + ".new.json")).write_text("{}", encoding="utf-8")
        return copy.deepcopy(case["inventory"])

    before = case["ledger_path"].read_bytes()
    with pytest.raises(ValueError, match="new unpinned authority"):
        apply(case, observe)
    assert case["ledger_path"].read_bytes() == before
    assert case["lock_path"].read_bytes() == str(os.getpid()).encode()
    assert not (Path(case["request"]["outputDirectory"]) / "result.json").exists()


def test_unwrapped_provider_client_is_rejected(case):
    case["provider"].inventory = []
    with pytest.raises(TypeError, match="Actual provider inventory"):
        apply(case)


def test_unique_claim_prevents_retry_after_unknown_failure(case):
    output = Path(case["request"]["outputDirectory"])
    output.mkdir()
    (output / "claim.json").write_text("{}", encoding="utf-8")
    with pytest.raises(FileExistsError):
        apply(case)
    assert case["lock_path"].read_bytes() == b"900001"


def test_current_source_retains_durable_launch_before_post():
    import ast
    text = (HERE / "control.py").read_text(encoding="utf-8")
    source = ast.parse(text)
    launch = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "launch")
    lines = ast.get_source_segment(text, launch)
    durable = lines.index('lease["status"] = "launching"\n        atomic_json(ledger_path, ledger)')
    assert durable < lines.index('client.request("POST", "/instance-operations/launch"')
