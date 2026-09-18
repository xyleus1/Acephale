"""Host guard regressions use fake clocks/network and non-paid child processes."""
import base64
import importlib.util
import json
import os
import threading
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/local_run_guard.py"
SPEC = importlib.util.spec_from_file_location("local_run_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class Host:
    def __init__(self, connected=True):
        self.connected = connected
        self.calls = []

    def acquire(self):
        self.calls.append(("acquire", threading.get_ident()))

    def release(self):
        self.calls.append(("release", threading.get_ident()))

    def network(self):
        return {"connected": self.connected}


class Child:
    pid = 12345

    def __init__(self, exit_code=0):
        self.polls = 0
        self.exit_code = exit_code

    def poll(self):
        self.polls += 1
        return None if self.polls == 1 else self.exit_code

    def wait(self):
        return self.exit_code


def test_gap_and_disconnect_latch_after_recovery():
    heartbeat = guard.Heartbeat()
    assert heartbeat.sample(100_000_000_000, 10_000_000_000, {"connected": True})["healthy"]
    paused = heartbeat.sample(110_000_000_000, 20_000_000_000, {"connected": False})
    assert paused["heartbeatGapMs"] == paused["wallGapMs"] == 10_000
    assert paused["reasons"] == ["heartbeat_gap", "network_disconnected"]
    recovered = heartbeat.sample(111_000_000_000, 21_000_000_000, {"connected": True})
    assert not recovered["healthy"]
    assert recovered["reasons"] == paused["reasons"]


def test_clock_reversal_and_unknown_network_fail_closed():
    heartbeat = guard.Heartbeat()
    heartbeat.sample(100_000_000_000, 10_000_000_000, {"connected": True})
    status = heartbeat.sample(90_000_000_000, 11_000_000_000, {"connected": None})
    assert status["reasons"] == ["clock_discontinuity", "network_status_unavailable"]
    assert status["clockSkewMs"] == -11_000


def test_child_gets_atomic_healthy_status_and_exact_arguments(tmp_path, monkeypatch):
    host = Host()
    output = tmp_path / "run"
    command = ["mock-child", "space in arg", 'quote"value', "never-log-this-value"]
    monkeypatch.delenv(guard.STATUS_ENVIRONMENT_KEY, raising=False)

    def spawn(args, **kwargs):
        assert args == command
        status = Path(os.environ[guard.STATUS_ENVIRONMENT_KEY])
        assert status == output / "status"
        assert json.loads((status / "0000000000000001.json").read_text())["healthy"] is True
        assert not list(status.glob("*.next"))
        return Child(7)

    assert guard.run_guard(command, output, host=host, spawn=spawn, sleep=lambda _: None) == 7
    assert host.calls == [("acquire", threading.get_ident()), ("release", threading.get_ident())]
    assert guard.STATUS_ENVIRONMENT_KEY not in os.environ
    events = (output / "events.jsonl").read_text()
    assert "never-log-this-value" not in events
    latest = sorted((output / "status").glob("*.json"))[-1]
    assert json.loads(latest.read_text())["reasons"] == ["guard_closed"]
    assert json.loads(events.splitlines()[-1])["executionStateReleased"] is True


def test_offline_preflight_never_starts_child_and_releases_hold(tmp_path):
    host = Host(False)

    def forbidden(*args, **kwargs):
        pytest.fail("Offline preflight must not spawn")

    assert guard.run_guard(["unused"], tmp_path / "offline", host=host, spawn=forbidden) == 70
    assert [call[0] for call in host.calls] == ["acquire", "release"]


def test_child_launch_error_releases_without_echoing_exception(tmp_path):
    host = Host()

    def failure(*args, **kwargs):
        raise OSError("sensitive child argument")

    output = tmp_path / "failed"
    assert guard.run_guard(["unused"], output, host=host, spawn=failure) == 70
    events = (output / "events.jsonl").read_text()
    assert "sensitive child argument" not in events
    assert json.loads(events.splitlines()[-1])["failureKind"] == "OSError"
    assert host.calls[-1][0] == "release"


def test_output_refuses_overwrite_and_outside_run_root(tmp_path):
    runs = tmp_path / "research/goalspec/runs"
    runs.mkdir(parents=True)
    (runs / "old").mkdir()
    with pytest.raises(FileExistsError):
        guard.safe_output(tmp_path, Path("research/goalspec/runs/old"))
    with pytest.raises(ValueError):
        guard.safe_output(tmp_path, Path("outside"))
    assert guard.safe_output(tmp_path, Path("research/goalspec/runs/new")) == runs / "new"


def test_execution_state_flags_and_thread_affinity():
    flags = []

    class Kernel:
        def SetThreadExecutionState(self, requested):
            flags.append(requested)
            return guard.ES_CONTINUOUS

    host = guard.WindowsHost.__new__(guard.WindowsHost)
    host.kernel = Kernel()
    host.owner_thread = None
    host.acquire()
    host.release()
    assert flags == [0x80000001, 0x80000000]
    host.owner_thread = -1
    with pytest.raises(RuntimeError, match="execution_state_thread_changed"):
        host.release()
    assert len(flags) == 2


def test_wrapper_command_transport_preserves_quotes_empty_and_unicode():
    command = ["python", "", 'embedded"quote', "space value", "backslash\\", "caf\u00e9"]
    encoded = base64.b64encode(json.dumps(command).encode()).decode()
    assert guard.decode_command(encoded, []) == command
    with pytest.raises(ValueError):
        guard.decode_command(encoded, ["other"])
    with pytest.raises(ValueError):
        guard.decode_command(base64.b64encode(b'{"bad":"shape"}').decode(), [])


def test_offline_during_child_run_marks_nonzero_even_if_child_exits_zero(tmp_path):
    host = Host()

    def sleep(_seconds):
        host.connected = False

    output = tmp_path / "offline-later"
    result = guard.run_guard(["unused"], output, host=host, spawn=lambda *a, **kw: Child(),
                             sleep=sleep)
    assert result == 70
    final = json.loads((output / "events.jsonl").read_text().splitlines()[-1])
    assert final["childExitCode"] == 0
    assert final["degradedDuringRun"] is True
    assert final["executionStateReleased"] is True


def test_hold_acquisition_failure_never_starts_child(tmp_path):
    class FailingHost(Host):
        def acquire(self):
            raise OSError("native hold unavailable")

        def release(self):
            pytest.fail("An unacquired hold must not be released")

    def forbidden(*args, **kwargs):
        pytest.fail("Hold failure must not spawn")

    assert guard.run_guard(["unused"], tmp_path / "no-hold", host=FailingHost(),
                           spawn=forbidden) == 70


def test_release_failure_is_reported_as_guard_failure(tmp_path):
    class FailingRelease(Host):
        def release(self):
            raise OSError("native release unavailable")

    output = tmp_path / "bad-release"
    result = guard.run_guard(["unused"], output, host=FailingRelease(),
                             spawn=lambda *a, **kw: Child(), sleep=lambda _: None)
    assert result == 70
    final = json.loads((output / "events.jsonl").read_text().splitlines()[-1])
    assert final["childExitCode"] == 0
    assert final["executionStateReleased"] is False
    assert final["failureKind"] == "OSError"


def windows_error(code=32):
    error = PermissionError(13, "never include this private exception text")
    error.winerror = code
    return error


def test_replace_retries_sharing_error_without_disturbing_previous_status(tmp_path):
    current, temporary = tmp_path / "status.json", tmp_path / "status.next.json"
    current.write_text('{"sequence":1}')
    temporary.write_text('{"sequence":2}')
    clock, attempts = [0.0], []

    def replacement(source, destination):
        attempts.append(clock[0])
        assert current.read_text() == '{"sequence":1}'
        if len(attempts) < 3:
            raise windows_error()
        os.replace(source, destination)

    result = guard.replace_status(temporary, current, 0.1, replace=replacement,
                                  monotonic=lambda: clock[0], sleep=lambda value: clock.__setitem__(0, clock[0] + value))
    assert json.loads(current.read_text())["sequence"] == 2
    assert result["retries"] == 2
    assert result["lastError"] == {"errorType": "PermissionError", "errno": 13, "winerror": 32}
    assert "private exception" not in json.dumps(result)


def test_persistent_replace_conflict_stops_at_deadline_and_keeps_old_status(tmp_path):
    current = tmp_path / "status.json"
    current.write_text('{"sequence":1}')
    clock, attempts = [0.0], []

    def replacement(*_args):
        attempts.append(clock[0])
        raise windows_error(5)

    with pytest.raises(PermissionError):
        guard.replace_status(tmp_path / "new", current, 0.05, replace=replacement,
                             monotonic=lambda: clock[0], sleep=lambda value: clock.__setitem__(0, clock[0] + value))
    assert clock[0] <= 0.05
    assert attempts[-1] < 0.05
    assert current.read_text() == '{"sequence":1}'


def test_nonsharing_failure_is_never_retried():
    attempts = []

    def replacement(*_args):
        attempts.append(1)
        error = OSError(28, "disk full")
        error.winerror = 112
        raise error

    with pytest.raises(OSError):
        guard.replace_status(Path("unused"), Path("unused"), 0.2, replace=replacement,
                             sleep=lambda _: pytest.fail("Non-sharing failures must not retry"))
    assert len(attempts) == 1


def test_replace_retry_budget_cannot_extend_the_previous_heartbeat_expiry(tmp_path, monkeypatch):
    evidence = guard.Evidence(tmp_path / "expiry")
    evidence.last_published = {"observedAtUnixMs": 1000, "maxStatusAgeMs": 300, "heartbeatSequence": 1}
    monkeypatch.setattr(guard.time, "time_ns", lambda: 1_280_000_000)
    budgets = []

    def replacement(_source, _destination, budget, **_kwargs):
        budgets.append(budget)
        raise windows_error()

    monkeypatch.setattr(guard, "replace_status", replacement)
    try:
        with pytest.raises(PermissionError):
            evidence.status({"observedAtUnixMs": 1280, "maxStatusAgeMs": 300, "heartbeatSequence": 2})
        assert budgets == [0]
        events = (evidence.output / "events.jsonl").read_text()
        assert "status_publish_failed" in events
        assert '"winerror": 32' in events
        assert "private exception" not in events
    finally:
        evidence.close()


@pytest.mark.skipif(os.name != "nt", reason="Real Windows file sharing behavior")
def test_real_windows_locked_immutable_status_cannot_block_new_heartbeat(tmp_path):
    evidence = guard.Evidence(tmp_path / "windows-sharing")
    heartbeat = guard.Heartbeat()
    evidence.status(heartbeat.sample(time.time_ns(), time.monotonic_ns(), {"connected": True}))
    first = evidence.status_path / "0000000000000001.json"
    original = first.read_bytes()
    reader = first.open("rb")
    probe = evidence.output / "probe.json"
    probe.write_text("unused probe")
    try:
        with pytest.raises(PermissionError) as failure:
            os.replace(probe, first)
        assert failure.value.winerror in {5, 32, 33}
        evidence.status(heartbeat.sample(time.time_ns(), time.monotonic_ns(), {"connected": True}))
        second = evidence.status_path / "0000000000000002.json"
        assert json.loads(second.read_text())["heartbeatSequence"] == 2
        assert first.read_bytes() == original
        assert reader.read() == original
        events = [json.loads(line) for line in (evidence.output / "events.jsonl").read_text().splitlines()]
        assert all(event["event"] == "heartbeat" for event in events)
        assert not list(evidence.status_path.glob("*.next"))
    finally:
        reader.close()
        evidence.close()


def test_published_sequence_cannot_be_overwritten_or_go_backwards(tmp_path):
    evidence = guard.Evidence(tmp_path / "immutable")
    heartbeat = guard.Heartbeat()
    status = heartbeat.sample(time.time_ns(), time.monotonic_ns(), {"connected": True})
    try:
        evidence.status(status)
        first = evidence.status_path / "0000000000000001.json"
        original = first.read_bytes()
        for sequence in (1, 0, True, 1.0, 10 ** 16):
            with pytest.raises(ValueError):
                evidence.status({**status, "heartbeatSequence": sequence})
        assert first.read_bytes() == original
        assert len(list(evidence.status_path.iterdir())) == 1
    finally:
        evidence.close()


def test_exhausted_publication_fails_closed_and_releases_hold(tmp_path, monkeypatch):
    original = guard.replace_status
    host = Host()

    def publication(source, destination, budget, **kwargs):
        if destination.name != "0000000000000001.json":
            raise windows_error(5)
        return original(source, destination, budget, **kwargs)

    monkeypatch.setattr(guard, "replace_status", publication)
    output = tmp_path / "publication-failed"
    assert guard.run_guard(["unused"], output, host=host, spawn=lambda *a, **kw: Child(),
                           sleep=lambda _: None) == 70
    events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines()]
    assert events[-1]["failureDetails"] == {"errorType": "PermissionError", "errno": 13, "winerror": 5}
    assert events[-1]["executionStateReleased"] is True
    assert len(list((output / "status").glob("*.json"))) == 1
    assert len([event for event in events if event["event"] == "status_publish_failed"]) == 2
    assert "private exception" not in json.dumps(events)
