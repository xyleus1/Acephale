"""Real local subprocess protocol tests; no SSH host, model or provider calls."""
from __future__ import annotations

import ast
import base64
import io
import json
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from test_infra_split_guard import fixture, lambda_fixture, responses

from acephale.contracts_v1 import hash_v1
from acephale.infra_split_guard import (
    PersistentProbeSession,
    observe_persistent,
    persistent_probe_command,
    persistent_probe_script,
    run_guard,
)


def test_owner_stop_event_joins_real_probe_and_publishes_degraded(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    session, opener, _ = responder(config, provenance)
    ready(session)
    stop = threading.Event()
    monkeypatch.setattr("acephale.infra_split_guard.PersistentProbeSession", lambda *_args, **_kwargs: session)
    original = observe_persistent
    def observe(current, active):
        value = original(current, active, opener=opener)
        stop.set()
        return value
    monkeypatch.setattr("acephale.infra_split_guard.observe_persistent", observe)
    output = tmp_path / "owner-stop"
    worker = threading.Thread(target=run_guard, args=(tmp_path / "guard.json", output), kwargs={"stop_event": stop})
    worker.start()
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert session.process.poll() is not None
    assert all(not thread.is_alive() for thread in session.workers)
    publications = [json.loads(path.read_text()) for path in sorted(output.glob("[0-9]*.json"))]
    assert publications[0]["healthy"] is True
    assert publications[-1]["healthy"] is False
    assert publications[-1]["reason"] == "guard_stopped"
    assert publications[-1]["tunnelClosed"] and publications[-1]["probeClosed"]


def test_owner_pre_cancel_does_not_launch_probe(tmp_path, monkeypatch):
    fixture(tmp_path)
    stop = threading.Event()
    stop.set()
    monkeypatch.setattr("acephale.infra_split_guard.PersistentProbeSession", lambda *_args, **_kwargs: pytest.fail("Cancelled owner launched SSH"))
    output = tmp_path / "owner-cancelled"
    run_guard(tmp_path / "guard.json", output, stop_event=stop)
    value = json.loads((output / "0000000000000001.json").read_text())
    assert value["reason"] == "guard_stopped" and not value["healthy"]


def responder(config, provenance, *, behavior="normal", startup=0, delay=0, startup_seconds=2):
    remote, local = responses(provenance)
    if provenance.get("provider") == "lambda":
        remote.update({key: provenance[key] for key in ("hostKeySha256", "machineIdSha256")})
    if behavior == "identity":
        remote["actor"] = {"data": [{"id": "wrong-model"}]}
    code = '''import json,sys,time
remote=json.loads(sys.argv[1]); behavior=sys.argv[2]
time.sleep(float(sys.argv[3]))
print(json.dumps({"protocol":True if behavior=="ready_bool" else 1,"type":"ready"}),flush=True)
for line in sys.stdin:
    request=json.loads(line)
    if behavior=="eof": break
    time.sleep(float(sys.argv[4]))
    if behavior=="malformed":
        print("not-json",flush=True); continue
    response={"protocol":1,"type":"observation","nonce":request["nonce"],"sequence":request["sequence"],"observation":remote}
    if behavior=="nonce": response["nonce"]="0"*32
    if behavior=="sequence": response["sequence"]+=1
    if behavior=="protocol_bool": response["protocol"]=True
    print(json.dumps(response),flush=True)
'''
    launches = []
    def popen(command, **kwargs):
        launches.append(command)
        return subprocess.Popen([sys.executable, "-u", "-c", code, json.dumps(remote), behavior, str(startup), str(delay)], **kwargs)
    session = PersistentProbeSession(config, provenance, popen=popen, startup_seconds=startup_seconds)
    def opener(url, **_):
        return io.BytesIO(json.dumps(local["actor" if ":18000/" in url else "predictor"]).encode())
    return session, opener, launches


def ready(session):
    while not session.ready():
        time.sleep(0.005)


def test_persistent_command_owns_forward_ports_and_has_no_multiplex_dependency(tmp_path):
    config, provenance = lambda_fixture(tmp_path)
    command = persistent_probe_command(config, provenance)
    assert "-N" not in command
    assert "ExitOnForwardFailure=yes" in command
    assert "ControlMaster=no" in command and "ControlPath=none" in command
    assert "StrictHostKeyChecking=yes" in command and "GlobalKnownHostsFile=none" in command
    assert command[-2] == config["sshDestination"]
    assert command.count("-L") == 3
    assert "python3 -u -c" in command[-1]
    assert config["sshDestination"] not in command[-1]


def test_one_process_supplies_distinct_fresh_nonces_and_complete_local_checks(tmp_path):
    config, provenance = fixture(tmp_path)
    session, opener, launches = responder(config, provenance)
    try:
        ready(session)
        first = observe_persistent(provenance, session, opener=opener)
        second = observe_persistent(provenance, session, opener=opener)
        assert first["probeNonce"] != second["probeNonce"]
        assert first["probeSequence"] == 1 and second["probeSequence"] == 2
        assert first["observedAtUnixMs"] >= first["probeStartedAtUnixMs"]
        assert second["observedAtUnixMs"] - second["probeStartedAtUnixMs"] <= 2500
        assert len(launches) == 1
    finally:
        session.close()
    assert session.process.poll() is not None and not session.reader.is_alive()


@pytest.mark.parametrize("behavior", ["nonce", "sequence", "malformed", "eof", "protocol_bool"])
def test_uncorrelated_malformed_and_eof_responses_poison_session(tmp_path, behavior):
    config, provenance = fixture(tmp_path)
    session, _, _ = responder(config, provenance, behavior=behavior)
    try:
        ready(session)
        with pytest.raises((ValueError, RuntimeError)):
            session.request(time.monotonic()+1)
        with pytest.raises(RuntimeError, match="unavailable"):
            session.request(time.monotonic()+1)
    finally:
        session.close()


def test_boolean_ready_protocol_is_rejected(tmp_path):
    config, provenance = fixture(tmp_path)
    session, _, _ = responder(config, provenance, behavior="ready_bool")
    try:
        with pytest.raises(ValueError, match="startup frame"):
            ready(session)
    finally:
        session.close()


def test_startup_has_its_own_deadline_and_never_reports_health(tmp_path):
    config, provenance = fixture(tmp_path)
    session, _, _ = responder(config, provenance, startup=0.3, startup_seconds=0.05)
    try:
        assert session.ready() is False
        time.sleep(0.06)
        with pytest.raises(TimeoutError, match="startup"):
            session.ready()
        assert not session.ready_received
    finally:
        session.close()


def test_timeout_late_output_is_discarded_before_new_connection(tmp_path):
    config, provenance = fixture(tmp_path)
    old, _, _ = responder(config, provenance, delay=0.2)
    ready(old)
    with pytest.raises(TimeoutError):
        old.request(time.monotonic()+0.03)
    old.close()
    assert old.frames.empty() and old.process.poll() is not None and not old.reader.is_alive()
    replacement, opener, _ = responder(config, provenance)
    try:
        ready(replacement)
        observed = observe_persistent(provenance, replacement, opener=opener)
        assert observed["probeSequence"] == 1
        assert replacement.process.pid != old.process.pid
    finally:
        replacement.close()


def test_remote_and_local_work_share_one_total_deadline(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    session, opener, _ = responder(config, provenance, delay=0.06)
    def slow_local(*args, **kwargs):
        time.sleep(0.08)
        return opener(*args, **kwargs)
    try:
        ready(session)
        monkeypatch.setattr("acephale.infra_split_guard.OBSERVATION_SECONDS", 0.1)
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            observe_persistent(provenance, session, opener=slow_local)
        assert time.monotonic()-started < 0.18
        assert session.failed
        assert session.observation_diagnostics["observationStage"] == "overall"
        assert session.observation_diagnostics["observationBudgetMs"] == 100
        assert session.observation_diagnostics["observationRemainingMs"] == 0
    finally:
        session.close()
    assert all(not worker.is_alive() for worker in session.workers)


def test_real_local_catalogs_may_take_point_six_seconds_within_total_budget(tmp_path):
    config, provenance = fixture(tmp_path)
    _, local = responses(provenance)
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            role = "actor" if self.path.startswith("/actor/") else "predictor"
            calls.append(role)
            time.sleep(0.6)
            body = json.dumps(local[role]).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *_args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    provenance["endpoints"] = {role: f"http://127.0.0.1:{server.server_port}/{role}" for role in ("actor", "predictor")}
    session, _, launches = responder(config, provenance)
    try:
        ready(session)
        observed = observe_persistent(provenance, session)
        assert 600 <= observed["observationElapsedMs"] < 2500
        assert observed["observationBudgetMs"] == 2500
        assert observed["observationRemainingMs"] > 0
        assert sorted(calls) == ["actor", "predictor"] and len(launches) == 1
    finally:
        session.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert all(not worker.is_alive() for worker in session.workers)


@pytest.mark.parametrize("role", ["actor", "predictor"])
def test_failed_catalog_records_only_bounded_stage_and_elapsed_fields(tmp_path, role):
    config, provenance = fixture(tmp_path)
    session, opener, _ = responder(config, provenance)
    def failed_catalog(url, **kwargs):
        if (":18000/" in url) == (role == "actor"):
            raise TimeoutError("private exception details must never be published")
        return opener(url, **kwargs)
    try:
        ready(session)
        with pytest.raises(TimeoutError):
            observe_persistent(provenance, session, opener=failed_catalog)
        diagnostics = session.observation_diagnostics
        assert diagnostics["observationStage"] == "local_" + role
        assert 0 <= diagnostics["observationElapsedMs"] < 2500
        assert diagnostics["observationBudgetMs"] == 2500
        assert "private" not in json.dumps(diagnostics)
        with pytest.raises(RuntimeError, match="unavailable"):
            session.request(time.monotonic()+1)
    finally:
        session.close()
    assert all(not worker.is_alive() for worker in session.workers)


def test_remote_timeout_has_remote_stage_and_cannot_be_reused(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    session, _, launches = responder(config, provenance, delay=0.1)
    try:
        ready(session)
        monkeypatch.setattr("acephale.infra_split_guard.OBSERVATION_SECONDS", 0.03)
        with pytest.raises(TimeoutError):
            observe_persistent(provenance, session)
        assert session.observation_diagnostics["observationStage"] == "remote_probe"
        assert session.observation_diagnostics["observationRemainingMs"] == 0
        assert session.failed and len(launches) == 1 and not session.workers
    finally:
        session.close()


def test_identity_mismatch_and_key_change_cannot_reuse_session(tmp_path):
    config, provenance = lambda_fixture(tmp_path)
    session, opener, _ = responder(config, provenance, behavior="identity")
    try:
        ready(session)
        with pytest.raises(ValueError, match="endpoint"):
            observe_persistent(provenance, session, opener=opener)
        assert session.failed
    finally:
        session.close()
    session, opener, _ = responder(config, provenance)
    try:
        ready(session)
        with (tmp_path/"known_hosts").open("a") as stream:
            stream.write("# changed\n")
        with pytest.raises(ValueError, match="changed"):
            observe_persistent(provenance, session, opener=opener)
        assert session.sequence == 0 and session.failed
    finally:
        session.close()


def test_remote_loop_collects_again_after_each_valid_nonce(monkeypatch):
    provenance = {"servingContainers": {}, "provider": "aws"}
    tree = ast.parse(persistent_probe_script(provenance))
    tree.body = [node for node in tree.body if not isinstance(node, ast.FunctionDef)]
    requests = [{"protocol": 1, "nonce": digit*32, "sequence": index} for index, digit in enumerate(("a", "b"), 1)]
    stdin, stdout = io.StringIO("".join(json.dumps(row)+"\n" for row in requests)), io.StringIO()
    calls = []
    def collect():
        calls.append(len(calls)+1)
        return {"freshObservation": len(calls)}
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)
    exec(compile(tree, "remote-probe-loop-test", "exec"), {"collect_observation": collect})
    frames = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert frames[0] == {"protocol": 1, "type": "ready"}
    assert [row["nonce"] for row in frames[1:]] == [row["nonce"] for row in requests]
    assert [row["observation"]["freshObservation"] for row in frames[1:]] == [1, 2]


def test_generated_remote_program_runs_in_actual_child_and_recollects_every_request(tmp_path):
    config, provenance = fixture(tmp_path)
    for role, container in provenance["servingContainers"].items():
        container["commandHash"] = hash_v1(["serve", role])
    remote, local = responses(provenance)
    # Replace only external host services inside the test child. The production
    # remote program, imports, framing, nonce loop and collect function run whole.
    shim = '''import base64,contextlib,io,json,socket,subprocess,sys,urllib.request
from pathlib import Path
remote=json.loads(sys.argv[2]); count=0
original_read=Path.read_text
def read(path,*args,**kwargs):
    if path.as_posix()=="/sys/devices/virtual/dmi/id/board_asset_tag": return remote["instanceId"]
    return original_read(path,*args,**kwargs)
Path.read_text=read
def inspect(command,**kwargs):
    global count
    count+=1
    role,row=next((role,value) for role,value in remote["containers"].items() if value["id"]==command[-1])
    return json.dumps({**row,"command":["serve",role],"testFreshInspectNumber":count})
subprocess.check_output=inspect
class Response(io.BytesIO):
    status=200
def open_url(url,**kwargs):
    return Response(json.dumps(remote["actor" if ":8000/" in url else "predictor"]).encode())
urllib.request.urlopen=open_url
socket.create_connection=lambda *args,**kwargs:contextlib.nullcontext()
exec(base64.b64decode(sys.argv[1]))
'''
    encoded = base64.b64encode(persistent_probe_script(provenance).encode()).decode()
    def popen(command, **kwargs):
        assert "ExitOnForwardFailure=yes" in command and command.count("-L") == 3
        return subprocess.Popen([sys.executable, "-u", "-c", shim, encoded, json.dumps(remote)], **kwargs)
    session = PersistentProbeSession(config, provenance, popen=popen)
    def opener(url, **_):
        return io.BytesIO(json.dumps(local["actor" if ":18000/" in url else "predictor"]).encode())
    try:
        ready(session)
        first = observe_persistent(provenance, session, opener=opener)
        second = observe_persistent(provenance, session, opener=opener)
        assert first["probeNonce"] != second["probeNonce"]
        assert first["remoteResponseHash"] != second["remoteResponseHash"]
        assert second["probeSequence"] == 2
    finally:
        session.close()


def test_remote_program_rejects_boolean_protocol_before_observation(monkeypatch):
    tree = ast.parse(persistent_probe_script({"servingContainers": {}}))
    tree.body = [node for node in tree.body if not isinstance(node, ast.FunctionDef)]
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"protocol": True, "nonce": "a"*32, "sequence": 1})+"\n"))
    monkeypatch.setattr(sys, "stdout", io.StringIO())
    with pytest.raises(ValueError, match="nonce"):
        exec(compile(tree, "remote-probe-malformed-test", "exec"), {"collect_observation": lambda: pytest.fail("Bad request must not collect")})


def test_guard_publishes_degraded_during_connect_and_drains_before_reconnect(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    config["maximumLifetimeSeconds"] = 2
    clock, events, sessions = [0.0], [], []
    class Session:
        def __init__(self, *_args, **_kwargs):
            self.number = len(sessions)
            self.ready_checks = 0
            sessions.append(self)
            events.append(("start", self.number))
        def ready(self):
            self.ready_checks += 1
            return self.ready_checks > 1
        def close(self):
            events.append(("close", self.number))
    def observe(_provenance, session):
        if session.number == 0:
            raise TimeoutError("test probe lost")
        return {"remoteInstanceId": provenance["expectedInstanceId"]}
    monkeypatch.setattr("acephale.infra_split_guard.load_guard", lambda _: (config, provenance))
    monkeypatch.setattr("acephale.infra_split_guard.PersistentProbeSession", Session)
    monkeypatch.setattr("acephale.infra_split_guard.observe_persistent", observe)
    monkeypatch.setattr("acephale.infra_split_guard.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("acephale.infra_split_guard.time.sleep", lambda seconds: clock.__setitem__(0, clock[0]+seconds))
    output = tmp_path/"statuses"
    run_guard(tmp_path/"guard.json", output)
    statuses = [json.loads(path.read_text()) for path in sorted(output.glob("[0-9]*.json"))]
    assert statuses[0]["healthy"] is False and statuses[0]["reason"] == "probe_connecting"
    assert events.index(("close", 0)) < events.index(("start", 1))
    assert any(row["healthy"] for row in statuses)
    assert statuses[-1]["healthy"] is False and statuses[-1]["tunnelClosed"] and statuses[-1]["probeClosed"]
    assert all(row["maxStatusAgeMs"] == 3000 for row in statuses)


def test_failed_process_drain_prevents_replacement_and_reports_unclosed_owner(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    starts = []
    class Session:
        def __init__(self, *_args, **_kwargs):
            starts.append(1)
        def ready(self):
            raise EOFError("test lost channel")
        def close(self):
            raise RuntimeError("test cannot confirm process drain")
    monkeypatch.setattr("acephale.infra_split_guard.load_guard", lambda _: (config, provenance))
    monkeypatch.setattr("acephale.infra_split_guard.PersistentProbeSession", Session)
    output = tmp_path/"failed-drain"
    with pytest.raises(RuntimeError, match="confirm process drain"):
        run_guard(tmp_path/"guard.json", output)
    statuses = [json.loads(path.read_text()) for path in sorted(output.glob("[0-9]*.json"))]
    assert len(starts) == 1
    assert all(not row["healthy"] for row in statuses)
    assert statuses[-1]["tunnelClosed"] is False and statuses[-1]["probeClosed"] is False
