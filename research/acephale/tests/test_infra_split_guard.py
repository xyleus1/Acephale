from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_split_guard import (
    inventory_hash,
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


def test_explicit_ssh_identity_resolves_without_reading_or_recording_key(tmp_path, monkeypatch):
    fixture(tmp_path)
    key = tmp_path / "private key"
    key.write_text("fixture key material must never enter provenance")
    path = tmp_path / "guard.json"
    value = json.loads(path.read_text())
    value["identityFilePath"] = key.name
    path.write_text(json.dumps(value))
    original = Path.open

    def open_without_key(self, *args, **kwargs):
        if self == key:
            pytest.fail("Guard must not read the private key")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_without_key)
    config, provenance = load_guard(path)
    for command in (tunnel_command(config), probe_command(config, provenance)):
        assert command[command.index("-i") + 1] == str(key.resolve())
        assert "IdentitiesOnly=yes" in command and "StrictHostKeyChecking=yes" in command
    assert "identityFilePath" not in provenance
    assert "fixture key material" not in json.dumps(provenance)
    key.unlink()
    with pytest.raises(ValueError, match="identityFilePath"):
        tunnel_command(config)


@pytest.mark.parametrize("value", [None, 1, True, [], "", "missing", ".", "private\nkey", "private\rkey", "private\x00key"])
def test_invalid_identity_file_rejected_before_ssh(tmp_path, value):
    fixture(tmp_path)
    path = tmp_path / "guard.json"
    config = json.loads(path.read_text())
    config["identityFilePath"] = value
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="identityFilePath"):
        load_guard(path)


def test_identity_symlink_is_rejected_before_resolution(tmp_path, monkeypatch):
    fixture(tmp_path)
    key = tmp_path / "key"
    key.write_text("fixture")
    path = tmp_path / "guard.json"
    config = json.loads(path.read_text())
    config["identityFilePath"] = key.name
    path.write_text(json.dumps(config))
    original = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: self == key or original(self))
    with pytest.raises(ValueError, match="symlinks"):
        load_guard(path)


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
    monkeypatch.setattr("acephale.infra_split_guard.time.time", lambda: next(times))
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


def lambda_fixture(tmp_path):
    fixture(tmp_path)
    guard = json.loads((tmp_path / "guard.json").read_text())
    key = base64.b64encode(b"synthetic ssh fixture").decode()
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(base64.b64decode(key)).digest()).decode().rstrip("=")
    instance = {"id": "lambda-instance", "name": "acephale-infra-lease", "ip": "203.0.113.1", "status": "active",
                "instance_type": {"name": "gpu_1x_a100_sxm4"}}
    ssh = {"host": instance["ip"], "port": 22, "user": "ubuntu", "hostKeySha256": fingerprint, "machineIdSha256": "e" * 64}
    body = {"version": 1, "profile": "acephale-infra-v1", "provider": "lambda", "leaseId": "lease",
            "leaseName": instance["name"], "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": "d" * 64,
            "instance": instance, "ssh": ssh, "providerResponseHash": inventory_hash(instance), "studyBindingHash": "c" * 64}
    receipt = {**body, "contentHash": inventory_hash(body)}
    inventory = json.loads((tmp_path / "inventory.json").read_text())
    inventory["provider"] = {"name": "lambda", "instanceId": instance["id"], "identityReceipt": receipt}
    deployment = json.loads((tmp_path / "deployment.json").read_text())
    deployment["evidenceHash"] = inventory_hash(inventory)
    guard.update(provider="lambda", expectedInstanceId=instance["id"], sshDestination="ubuntu@" + instance["ip"],
                 expectedHostKeySha256=fingerprint, expectedMachineIdSha256=ssh["machineIdSha256"], knownHostsPath="known_hosts")
    for name, value in (("guard.json", guard), ("inventory.json", inventory), ("deployment.json", deployment)):
        (tmp_path / name).write_text(json.dumps(value))
    (tmp_path / "known_hosts").write_text(instance["ip"] + " ssh-ed25519 " + key + "\n")
    return load_guard(tmp_path / "guard.json")


def test_lambda_pins_provider_association_ssh_key_and_machine_identity(tmp_path):
    config, provenance = lambda_fixture(tmp_path)
    command = tunnel_command(config)
    assert "GlobalKnownHostsFile=none" in command and "HostKeyAlgorithms=ssh-ed25519" in command
    remote, local = responses(provenance)
    del remote["instanceId"]  # Lambda does not masquerade as an EC2 DMI instance.
    remote.update({key: provenance[key] for key in ("hostKeySha256", "machineIdSha256")})
    verify_observation(provenance, remote, local)
    for key in ("hostKeySha256", "machineIdSha256"):
        changed = {**remote, key: "substituted", "instanceId": provenance["expectedInstanceId"]}
        with pytest.raises(ValueError, match="instance"):
            verify_observation(provenance, changed, local)
    assert provenance["identityMethod"] == "Lambda API IP + pinned SSH host key + local machine-id"


@pytest.mark.parametrize("field,value", [("sshDestination", "ubuntu@203.0.113.2"), ("expectedHostKeySha256", "SHA256:" + "A" * 43),
                                       ("expectedMachineIdSha256", "0" * 64), ("expectedInstanceId", "other-instance")])
def test_lambda_guard_rejects_substituted_identity(tmp_path, field, value):
    lambda_fixture(tmp_path)
    path = tmp_path / "guard.json"
    config = json.loads(path.read_text())
    config[field] = value
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError):
        load_guard(path)


def test_lambda_guard_detects_known_hosts_changes_before_contacting_remote(tmp_path):
    config, provenance = lambda_fixture(tmp_path)
    with (tmp_path / "known_hosts").open("a") as stream:
        stream.write("# changed after startup\n")
    with pytest.raises(ValueError, match="changed"):
        observe(config, provenance, runner=lambda *_args, **_kwargs: pytest.fail("Remote probe must not run"))


@pytest.mark.parametrize("provider", ["aws", "lambda"])
def test_actual_node_checker_accepts_python_guard_provenance(tmp_path, provider):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for the cross-language heartbeat check")
    _, provenance = (lambda_fixture if provider == "lambda" else fixture)(tmp_path)
    publish(tmp_path, 1, provenance, True, {"remoteInstanceId": provenance["expectedInstanceId"]})
    script = """const fs=require('node:fs'); const path=require('node:path');
const {nativeSplitGuard}=require('./services/acephale-runtime/infra-split-guard.ts');
const directory=process.argv[1];
const config=JSON.parse(fs.readFileSync(path.join(directory,'configuration.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
console.log(JSON.stringify(nativeSplitGuard(config,manifest,path.join(directory,'configuration.json'))()));"""
    result = subprocess.run([node, "--import", "tsx", "-e", script, str(tmp_path)],
                            cwd=Path(__file__).resolve().parents[3], capture_output=True, text=True, timeout=20,
                            env={**os.environ, "ACEPHALE_HOST_STATUS_FILE": str(tmp_path)})
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["endpointProvenanceHash"] == hash_v1(provenance)
