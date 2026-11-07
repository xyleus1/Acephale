from __future__ import annotations

import json
import os
import secrets
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.contracts_v1 import hash_v1
from goalspec.infra_data import read_jsonl, verify_bundle
from goalspec.infra_import_fresh import ACTOR, import_fresh
from goalspec.infra_native_runner import (
    REVISION,
    _run_cohort,
    _verify_checkout,
    service_command,
    validate_task_bundle,
)
from goalspec.storage import file_hash


class Telemetry:
    def __init__(self, *_):
        self.bound = False

    def bind(self, _):
        self.bound = True

    def summary(self, _run, drained):
        return {"billedUsd": 0 if drained else None, "knownUsageSubtotalUsd": 0,
                "unknownProviderCharge": not drained, "providerCalls": 0}


class Process:
    pid = 12345
    returncode = 0

    def wait(self, **_):
        return 0


@pytest.fixture
def cohort_inputs(monkeypatch):
    tools = [{"type": "function", "function": {"name": "get_user_details",
              "parameters": {"type": "object", "properties": {"user_id": {"type": "string"}},
                             "required": ["user_id"]}}}]
    runs = [{"runId": f"run-{index}", "taskId": str(index), "familyId": family,
             "domain": "retail", "arm": "base", "seed": index, "tools": tools, "maxBoundaries": 10}
            for index, family in enumerate(["train", "dev"])]
    bundle = {"version": 1, "upstreamRevision": REVISION, "tasks": [
        {"domain": row["domain"], "taskId": row["taskId"], "familyId": row["familyId"],
         "task": {"id": row["taskId"]}} for row in runs]}
    config = {"version": 1, "stage": "collection", "runs": runs, "taskBundleHash": hash_v1(bundle),
              "hosted": {"allocation": "training", "maxSteps": 10}}
    manifest = {"actor": ACTOR, "data": {"trainingFamilies": ["train"], "developmentFamilies": ["dev"],
                "heldoutFamilies": ["test"], "environmentRevision": REVISION},
                "protocol": {"scheduleHash": hash_v1(runs)}}
    monkeypatch.setattr("goalspec.infra_native_runner.await_service_ready", lambda *_: (1.0, None))
    monkeypatch.setattr("goalspec.infra_native_runner.close_failed_workers", lambda *_args, **_kwargs: None)
    return config, manifest, bundle


class Executor:
    def __init__(self, config, fail_slot=None):
        self.fail_slot = fail_slot
        self.contexts = {row["runId"]: {"capturedBeforeExecution": True,
                         "policy": "Read the requested user", "tools": row["tools"]} for row in config["runs"]}

    def execute(self, run, _broker, _reads, telemetry):
        if run["runId"] == self.fail_slot:
            raise RuntimeError("fixture failure")
        row = {key: value for key, value in run.items() if key != "tools"}
        row.update(success=True, termination="agent_stop", latencyMs=12,
                   **telemetry.summary(run["runId"], True))
        return {"record": row, "simulation": {"messages": [
            {"role": "user", "content": f"For task {run['taskId']}, find user U1"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "name": "get_user_details", "arguments": {"user_id": "U1"}}]},
            {"role": "tool", "id": "c1", "content": '{"id":"U1"}'},
            {"role": "assistant", "content": "Found user"},
        ]}, "verdict": {"passed": True, "evaluationValid": True, "constraintViolations": 0,
                        "officialReward": 1, "evaluatorVersion": "fixture"}}


def test_launcher_uses_new_runtime_and_keeps_native_task_identity(cohort_inputs, tmp_path):
    config, manifest, bundle = cohort_inputs
    command = service_command(tmp_path / "config.json", tmp_path / "output")
    assert command[:4] == ["node", "--import", "tsx", "scripts/goalspec-infra-native.ts"]
    assert len(validate_task_bundle(config, manifest, bundle)) == 2
    bundle["tasks"][0]["task"]["id"] = "other"
    with pytest.raises(ValueError, match="hash"):
        validate_task_bundle(config, manifest, bundle)
    config["taskBundleHash"] = hash_v1(bundle)
    with pytest.raises(ValueError, match="payload identity"):
        validate_task_bundle(config, manifest, bundle)


def test_closed_runner_output_imports_into_fresh_memory_without_provider_calls(cohort_inputs, tmp_path):
    config, manifest, bundle = cohort_inputs
    output = tmp_path / "cohort"
    summary = _run_cohort(config, manifest, bundle, output, tmp_path,
                          lambda: Executor(config), lambda: None,
                          process_factory=lambda *_args, **_kwargs: Process(), telemetry_factory=Telemetry)
    assert summary["successes"] == 2 and summary["stageAborted"] is False
    receipt = json.loads((output / "cohort-receipt.json").read_text())
    assert receipt["closed"] and receipt["completed"] and receipt["allDeclaredSlotsRetained"]
    assert all(file_hash(output / row["path"]) == row["sha256"] for row in receipt["files"])
    destination = tmp_path / "bundle"
    import_fresh(output, destination)
    verify_bundle(destination)
    rows = read_jsonl(destination / "runtime-runs.jsonl")
    assert [row["id"] for row in rows if row["memoryEligible"]] == ["run-0"]
    with pytest.raises(FileExistsError):
        _run_cohort(config, manifest, bundle, output, tmp_path,
                    lambda: Executor(config), lambda: None,
                    process_factory=lambda *_args, **_kwargs: Process(), telemetry_factory=Telemetry)


def test_failed_slot_is_preserved_without_retry_and_later_slot_runs(cohort_inputs, tmp_path):
    config, manifest, bundle = cohort_inputs
    output = tmp_path / "cohort"
    summary = _run_cohort(config, manifest, bundle, output, tmp_path,
                          lambda: Executor(config, "run-0"), lambda: None,
                          process_factory=lambda *_args, **_kwargs: Process(), telemetry_factory=Telemetry)
    rows = read_jsonl(output / "outcomes.jsonl")
    assert [row["runId"] for row in rows] == ["run-0", "run-1"]
    assert rows[0]["termination"] == "slot_failure" and rows[0]["unknownProviderCharge"]
    assert rows[1]["success"] and summary["notRetried"] and summary["unknownCharges"] == 1
    import_fresh(output, tmp_path / "bundle")
    assert len(read_jsonl(tmp_path / "bundle/verdicts.jsonl")) == 2


def test_source_failure_retains_every_declared_slot_without_launch(cohort_inputs, tmp_path):
    config, manifest, bundle = cohort_inputs
    output = tmp_path / "cohort"

    def fail_verification():
        raise ValueError("fixture changed source")

    def forbidden_process(*_args, **_kwargs):
        pytest.fail("source failure must precede process creation")

    summary = _run_cohort(config, manifest, bundle, output, tmp_path,
                          lambda: Executor(config), fail_verification,
                          process_factory=forbidden_process, telemetry_factory=Telemetry)
    rows = read_jsonl(output / "outcomes.jsonl")
    assert len(rows) == 2 and all(row["termination"] == "stage_aborted_before_slot" for row in rows)
    assert summary["stageAborted"] and summary["allDeclaredSlotsRetained"]
    receipt = json.loads((output / "cohort-receipt.json").read_text())
    assert receipt["closed"] and not receipt["completed"]


@pytest.mark.parametrize("setup", ["gateway", "telemetry"])
def test_early_setup_failure_retains_slots(cohort_inputs, tmp_path, monkeypatch, setup):
    config, manifest, bundle = cohort_inputs

    def fail(*_args, **_kwargs):
        raise OSError("fixture setup error")

    if setup == "gateway":
        monkeypatch.setattr("goalspec.infra_native_runner.server", fail)
    output = tmp_path / "cohort"
    summary = _run_cohort(config, manifest, bundle, output, tmp_path,
                          lambda: Executor(config), lambda: None,
                          telemetry_factory=fail if setup == "telemetry" else Telemetry)
    assert summary["stageAborted"] and summary["allDeclaredSlotsRetained"]
    assert len(read_jsonl(output / "outcomes.jsonl")) == 2


def test_source_freeze_rejects_untracked_executable_files(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / "runtime.py").write_text("pass\n")
    subprocess.run(["git", "add", "runtime.py"], cwd=tmp_path, check=True)
    subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
                    "commit", "-qm", "fixture"], cwd=tmp_path, check=True)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True).strip()
    _verify_checkout(tmp_path, revision)
    (tmp_path / "injected.py").write_text("pass\n")
    with pytest.raises(ValueError, match="untracked"):
        _verify_checkout(tmp_path, revision)


def test_real_python_gateway_new_node_runtime_handshake_and_otlp_export(tmp_path):
    root = Path(__file__).resolve().parents[3]
    manifest = json.loads((root / "research/goalspec/examples/infra-manifest-v2.fixture.json").read_text())
    received = []

    class FakeServing(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            # The standard OTLP/HTTP JSON exporter streams chunked request
            # bodies. Local model requests still use Content-Length.
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                chunks = []
                while True:
                    size = int(self.rfile.readline().split(b";", 1)[0].strip(), 16)
                    if size == 0:
                        while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                            pass
                        break
                    chunks.append(self.rfile.read(size))
                    assert self.rfile.read(2) == b"\r\n"
                payload = b"".join(chunks)
            else:
                payload = self.rfile.read(int(self.headers["Content-Length"]))
            body = json.loads(payload)
            if self.path == "/tokenize":
                result = {"count": 8, "max_model_len": 32768, "tokens": [1] * 8}
            elif self.path == "/v1/chat/completions":
                result = {"model": body["model"], "choices": [{"index": 0, "message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}],
                          "usage": {"prompt_tokens": 8, "completion_tokens": 1, "total_tokens": 9}}
            elif self.path in {"/v1/traces", "/v1/metrics"}:
                assert self.headers["Content-Type"].startswith("application/json")
                received.append((self.path, body))
                result = {}
            else:
                self.send_error(404)
                return
            payload = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    model = ThreadingHTTPServer(("127.0.0.1", 0), FakeServing)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    tools = [{"type": "function", "function": {"name": "list_all_airports", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}}]
    url = f"http://127.0.0.1:{model.server_port}"
    config = {"version": 1, "stage": "collection", "manifestPath": "manifest.json", "ledgerCheckpointPath": "checkpoint.json",
              "actorBaseUrl": url, "otlpBaseUrl": url, "snapshotId": "fixture", "stream": False, "maximumLifetimeSeconds": 30,
              "runs": [{"runId": "run", "taskId": "task", "familyId": "train", "domain": "airline", "arm": "base", "seed": 0, "maxBoundaries": 2, "tools": tools}]}
    manifest["data"].update(environmentRevision=REVISION, toolSchemaHash=hash_v1([{"domain": "airline", "tools": tools}]))
    manifest["protocol"]["scheduleHash"] = hash_v1(config["runs"])
    manifest["budgets"]["ledgerCheckpointHash"] = hash_v1({"fixture": True})
    for name, document in (("configuration.json", config), ("manifest.json", manifest), ("checkpoint.json", {"fixture": True})):
        (tmp_path / name).write_text(json.dumps(document))
    broker = StepBroker(hash_v1(config), hash_v1(manifest))
    with pytest.raises(ValueError):
        broker.mark_ready(hash_v1(config), "0" * 64)
    token = secrets.token_hex(32)
    gateway = server(broker, token)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    output = tmp_path / "output"
    process = subprocess.Popen(service_command(tmp_path / "configuration.json", output), cwd=root,
                               env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token},
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        broker.wait_ready(timeout=25)
        response = broker.exchange("run", {"policy": "List airports", "tools": tools, "messages": [{"role": "user", "content": "List airports"}]}, timeout=15)
        assert response["content"] == "done"
        broker.finish("run", timeout=5)
        broker.close()
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode == 0, stderr + stdout
        receipt = json.loads((output / "telemetry-export-receipt.json").read_text())
        assert receipt["tracesAccepted"] == receipt["metricsAccepted"] == 1 and receipt["failed"] == 0
        assert {path for path, _ in received} == {"/v1/traces", "/v1/metrics"}
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        broker.close()
        gateway.shutdown()
        gateway.server_close()
        model.shutdown()
        model.server_close()
