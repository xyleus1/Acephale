from __future__ import annotations

import hashlib
import io
import json
from types import SimpleNamespace

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_split_guard import (
    load_guard,
    observe,
    probe_command,
    publish,
    tunnel_command,
    verify_observation,
)


def fixture(tmp_path):
    manifest = {"actor": {"servedModel": "fixed-actor"}, "predictor": {"servedModel": "fixed-predictor"}, "runtime": {}, "hardware": {}, "sourceCommit": "a" * 40}
    configuration = {"manifestPath": "manifest.json", "splitGuardPath": "guard.json", "actorBaseUrl": "http://127.0.0.1:18000",
                     "predictorBaseUrl": "http://127.0.0.1:18001/v1", "otlpBaseUrl": "http://127.0.0.1:14318"}
    guard = {"version": 1, "configurationPath": "configuration.json", "sshDestination": "ubuntu@trusted-gpu", "sshPort": 22,
             "expectedInstanceId": "i-0123456789abcdef0", "localPorts": {"actor": 18000, "predictor": 18001, "otlp": 14318}, "maximumLifetimeSeconds": 60}
    inventory = {"provider": {"instanceId": guard["expectedInstanceId"]}, "containers": {
        role: {"id": letter * 64, "imageId": "sha256:" + "c" * 64, "startedAt": "2026-01-01T00:00:00Z"}
        for role, letter in (("actor", "a"), ("predictor", "b"))}}
    deployment = {**manifest, "observed": True, "evidenceHash": hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
    guard.update(deploymentPath="deployment.json", inventoryEvidencePath="inventory.json")
    for name, value in (("manifest.json", manifest), ("configuration.json", configuration), ("guard.json", guard), ("deployment.json", deployment), ("inventory.json", inventory)):
        (tmp_path / name).write_text(json.dumps(value))
    return load_guard(tmp_path / "guard.json")


def responses(provenance):
    remote = {"instanceId": provenance["expectedInstanceId"], "otlpListening": True,
              "containers": {role: {**value, "running": True} for role, value in provenance["servingContainers"].items()},
              **{role: {"data": [{"id": model}]} for role, model in provenance["servedModels"].items()}}
    return remote, {role: remote[role] for role in ("actor", "predictor")}


def test_private_tunnels_use_verified_host_keys_and_exact_loopback_destinations(tmp_path):
    config, provenance = fixture(tmp_path)
    command = tunnel_command(config)
    assert "StrictHostKeyChecking=yes" in command and "ExitOnForwardFailure=yes" in command
    assert "BatchMode=yes" in command
    assert {command[index + 1] for index, value in enumerate(command) if value == "-L"} == {
        "127.0.0.1:18000:127.0.0.1:8000", "127.0.0.1:18001:127.0.0.1:8001", "127.0.0.1:14318:127.0.0.1:4318"}
    assert probe_command(config, provenance)[-2] == "ubuntu@trusted-gpu"
    assert provenance["manifestHash"] == hash_v1(json.loads((tmp_path / "manifest.json").read_text()))


def test_mismatched_native_urls_wrong_remote_host_and_model_are_rejected(tmp_path):
    _, provenance = fixture(tmp_path)
    remote, local = responses(provenance)
    verify_observation(provenance, remote, local)
    remote["instanceId"] = "i-fedcba98765432100"
    with pytest.raises(ValueError, match="instance"):
        verify_observation(provenance, remote, local)
    remote, local = responses(provenance)
    local["actor"] = {"data": [{"id": "substituted"}]}
    with pytest.raises(ValueError, match="endpoint"):
        verify_observation(provenance, remote, local)
    config_path = tmp_path / "configuration.json"
    config = json.loads(config_path.read_text())
    config["actorBaseUrl"] = "http://127.0.0.1:19999"
    config_path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="endpoint"):
        load_guard(tmp_path / "guard.json")


def test_guard_uses_local_observation_clock_and_immutable_failed_heartbeat(tmp_path, monkeypatch):
    config, provenance = fixture(tmp_path)
    remote, local = responses(provenance)
    remote["observedAtUnixMs"] = 1  # A remote clock must not become the local freshness clock.
    times = iter([100.0, 100.1, 100.2, 100.3])
    monkeypatch.setattr("goalspec.infra_split_guard.time.time", lambda: next(times))
    observed = observe(config, provenance, runner=lambda *_args, **_kwargs: SimpleNamespace(stdout=json.dumps(remote)),
                       opener=lambda url, **_: io.BytesIO(json.dumps(local["actor" if ":18000/" in url else "predictor"]).encode()))
    assert observed["observedAtUnixMs"] == 100100
    output = tmp_path / "status"
    output.mkdir()
    publish(output, 1, provenance, True, observed)
    publish(output, 2, provenance, False, {"errorType": "TimeoutError"})
    latest = json.loads((output / "0000000000000002.json").read_text())
    assert latest["healthy"] is False and latest["state"] == "degraded"
    assert latest["endpointProvenanceHash"] == hash_v1(provenance)
    assert len(list(output.glob("*.json"))) == 2
    assert not list(output.glob("*.pending"))


@pytest.mark.parametrize("value", ["-oProxyCommand=bad", "ubuntu@host; bad", "host with spaces"])
def test_guard_rejects_ssh_option_or_shell_injection(tmp_path, value):
    fixture(tmp_path)
    path = tmp_path / "guard.json"
    config = json.loads(path.read_text())
    config["sshDestination"] = value
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="SSH"):
        load_guard(path)
