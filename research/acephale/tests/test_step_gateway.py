import copy
import os
import secrets
import subprocess
import threading
import time
from pathlib import Path

import pytest

from acephale.adapters.step_gateway import ReadOperations, SnapshotReads, StepBroker, server


def test_correlated_boundary_and_duplicate_rejection():
    broker = StepBroker()
    result = []
    worker = threading.Thread(target=lambda: result.append(broker.exchange("r", {"messages": [], "policy": "p", "tools": []}, timeout=2)))
    worker.start()
    boundary = broker.next()
    assert boundary["public"] == {"messages": [], "policy": "p", "tools": []}
    with pytest.raises(ValueError):
        broker.respond("other-run", boundary["boundaryId"], {})
    broker.respond("r", boundary["boundaryId"], {"role": "assistant", "content": "hello"})
    with pytest.raises(ValueError):
        broker.respond("r", boundary["boundaryId"], {})
    worker.join(timeout=2)
    assert result == [{"role": "assistant", "content": "hello"}]


def test_private_fields_never_accepted_as_public_frame():
    broker = StepBroker()
    with pytest.raises(ValueError):
        broker.exchange("r", {"messages": [], "policy": "p", "tools": [], "reward": 1})


def test_run_finish_waits_for_correlated_close_ack_without_a_public_frame():
    broker = StepBroker()
    result = []
    worker = threading.Thread(target=lambda: result.append(broker.finish("r", timeout=2)))
    worker.start()
    boundary = broker.next()
    assert boundary == {"runId": "r", "boundaryId": boundary["boundaryId"], "operation": "close"}
    assert "public" not in boundary and result == []
    with pytest.raises(ValueError):
        broker.respond("other", boundary["boundaryId"], {"closed": True})
    broker.respond("r", boundary["boundaryId"], {"closed": True})
    worker.join(timeout=2)
    assert result == [{"closed": True}]


def test_run_finish_rejects_an_unconfirmed_drain():
    broker = StepBroker()
    errors = []
    def finish():
        try:
            broker.finish("r", timeout=2)
        except RuntimeError as error:
            errors.append(str(error))
    worker = threading.Thread(target=finish)
    worker.start()
    boundary = broker.next()
    broker.respond("r", boundary["boundaryId"], {"closed": False})
    worker.join(timeout=2)
    assert errors == ["Worker did not acknowledge managed-work drain"]


def test_snapshot_side_effects_are_isolated_and_leases_fenced():
    authoritative = {"value": 1}

    def execute(snapshot, tool, arguments):
        snapshot["value"] += 1
        return snapshot

    reads = SnapshotReads(lambda: copy.deepcopy(authoritative), execute, {"read"})
    observed = reads.read("read", {})
    assert observed["observation"] == {"value": 2}
    assert authoritative == {"value": 1}
    assert reads.validate(observed["lease"], "read", {}) == {"value": 2}
    with pytest.raises(ValueError):
        reads.validate(observed["lease"], "read", {})
    stale = reads.read("read", {})
    reads.authoritative(lambda: authoritative.update(value=3))
    with pytest.raises(ValueError):
        reads.validate(stale["lease"], "read", {})
    with pytest.raises(ValueError):
        reads.read("buy", {})


def test_operation_cancellation_waits_for_physical_completion_and_prevents_duplicate():
    operations = ReadOperations()
    started, release = threading.Event(), threading.Event()
    results = []

    def callback():
        started.set()
        assert release.wait(2)
        return {"secret_result": 1}

    identity = ("run", "operation-12345678")
    thread = threading.Thread(target=lambda: results.append(operations.start(*identity, ["read", {}], callback)))
    thread.start()
    assert started.wait(2)
    assert operations.status(*identity, cancel=True) == {"state": "running"}
    assert operations.start(*identity, ["read", {}], lambda: pytest.fail("duplicate")) == {"state": "running"}
    release.set()
    thread.join(2)
    assert results == [{"state": "cancelled"}]
    assert operations.status(*identity) == {"state": "cancelled"}


def test_cancel_before_delayed_post_fences_execution_and_run_ids_are_isolated():
    operations = ReadOperations()
    operation_id = "operation-12345678"
    assert operations.status("r1", operation_id, cancel=True) == {"state": "cancelled"}
    assert operations.start("r1", operation_id, [], lambda: pytest.fail("late execution")) == {"state": "cancelled"}
    assert operations.start("r2", operation_id, [], lambda: 42) == {"state": "completed", "result": 42}
    with pytest.raises(ValueError, match="different arguments"):
        operations.start("r2", operation_id, [1], lambda: None)


def test_failure_and_capacity_do_not_evict_tombstones():
    operations = ReadOperations(capacity=1)
    assert operations.start("r", "operation-12345678", [], lambda: float("nan")) == {"state": "failed"}
    with pytest.raises(ValueError, match="exhausted"):
        operations.start("r", "operation-87654321", [], lambda: pytest.fail("overflow"))
    assert operations.status("r", "operation-12345678", cancel=True) == {"state": "cancelled"}


def test_freshness_lease_storage_is_bounded(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("acephale.adapters.step_gateway.time.monotonic", lambda: clock[0])
    reads = SnapshotReads(lambda: {}, lambda *_: {}, {"read"}, lease_seconds=5)
    for _ in range(64):
        reads.read("read", {})
    with pytest.raises(ValueError, match="capacity"):
        reads.read("read", {})
    clock[0] += 6
    reads.read("read", {})
    assert len(reads.leases) == 1


def test_node_http_abort_waits_for_python_read_completion():
    started, finished = threading.Event(), threading.Event()
    calls = []

    class FixtureReads:
        def read(self, tool, arguments):
            calls.append(tool)
            started.set()
            time.sleep(0.3)
            finished.set()
            return {"lease": "discarded", "observation": {"data": 1}}

        def validate(self, lease, tool, arguments):
            if lease == "wait-until-started":
                assert started.wait(5)
                return {}
            return {"done": finished.is_set()}

    token = secrets.token_hex(32)
    gateway = server(StepBroker(), token, reads={"isolation": FixtureReads()})
    thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    thread.start()
    try:
        root = Path(__file__).resolve().parents[3]
        result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-gateway-cancellation-fixture.ts"],
                                cwd=root, env={**os.environ, "ACEPHALE_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}",
                                               "ACEPHALE_GATEWAY_TOKEN": token}, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        assert calls == ["read"]
        assert finished.is_set()
    finally:
        gateway.shutdown()
        gateway.server_close()


def test_refresh_rotates_one_shot_lease_without_extending_deadline(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("acephale.adapters.step_gateway.time.monotonic", lambda: clock[0])
    reads = SnapshotReads(lambda: {}, lambda *_: {"content": "value", "error": False}, {"read"}, lease_seconds=5)
    first = reads.read("read", {})
    clock[0] += 4
    second = reads.refresh(first["lease"], "read", {})
    assert first["observation"] == second["observation"]
    with pytest.raises(ValueError):
        reads.validate(first["lease"], "read", {})
    clock[0] += 2
    with pytest.raises(ValueError):
        reads.validate(second["lease"], "read", {})
