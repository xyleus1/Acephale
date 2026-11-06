"""Own private SSH forwards and publish locally clocked remote-serving health.

This guard does not rent, terminate or otherwise change a GPU host. The separate
provider watchdogs remain mandatory. It performs no model generation requests.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

from goalspec.contracts_v1 import hash_v1
from goalspec.study_v2 import read, write


def load_guard(path: Path):
    path = path.resolve()
    config = read(path)
    if config.get("version") != 1 or not re.fullmatch(r"[A-Za-z0-9_.@-]+", config.get("sshDestination", "")) or config["sshDestination"].startswith("-"):
        raise ValueError("Explicit SSH alias/user/host required")
    if not re.fullmatch(r"i-[0-9a-f]{8,17}", config.get("expectedInstanceId", "")):
        raise ValueError("Observed EC2 instance identity required")
    if type(config.get("sshPort")) is not int or not 1 <= config["sshPort"] <= 65535:
        raise ValueError("Explicit SSH port required")
    if type(config.get("maximumLifetimeSeconds")) is not int or not 1 <= config["maximumLifetimeSeconds"] <= 28800:
        raise ValueError("Bounded guard lifetime required")
    ports = config.get("localPorts", {})
    if set(ports) != {"actor", "predictor", "otlp"} or any(type(port) is not int or not 1024 <= port <= 65535 for port in ports.values()) or len(set(ports.values())) != 3:
        raise ValueError("Three unique unprivileged loopback ports required")
    source_path = (path.parent / config["configurationPath"]).resolve()
    source = read(source_path)
    manifest = read((source_path.parent / source["manifestPath"]).resolve())
    deployment = read((path.parent / config["deploymentPath"]).resolve())
    inventory = read((path.parent / config["inventoryEvidencePath"]).resolve())
    evidence_hash = hashlib.sha256(json.dumps(inventory, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if deployment.get("observed") is not True or deployment.get("evidenceHash") != evidence_hash \
            or inventory.get("provider", {}).get("instanceId") != config["expectedInstanceId"] \
            or deployment.get("sourceCommit") != manifest.get("sourceCommit") \
            or any(deployment.get(key) != manifest.get(key) for key in ("actor", "predictor", "runtime", "hardware")):
        raise ValueError("Split guard deployment/instance inventory does not match the frozen experiment")
    containers = {role: {key: inventory["containers"][role][key] for key in ("id", "imageId", "startedAt")} for role in ("actor", "predictor")}
    if any(not re.fullmatch(r"[0-9a-f]{64}", row["id"]) for row in containers.values()):
        raise ValueError("Observed serving container identities required")
    if (source_path.parent / source.get("splitGuardPath", "")).resolve() != path:
        raise ValueError("Native configuration must bind this split guard")
    endpoints = {role: f"http://127.0.0.1:{ports[role]}" for role in ports}
    for role, field in (("actor", "actorBaseUrl"), ("predictor", "predictorBaseUrl"), ("otlp", "otlpBaseUrl")):
        if source.get(field, "").rstrip("/").removesuffix("/v1") != endpoints[role]:
            raise ValueError("Native endpoint differs from guard-owned loopback forwarding")
    provenance = {"version": 1, "manifestHash": hash_v1(manifest), "sshDestination": config["sshDestination"],
                  "sshPort": config["sshPort"], "expectedInstanceId": config["expectedInstanceId"],
                  "endpoints": endpoints, "remotePorts": {"actor": 8000, "predictor": 8001, "otlp": 4318},
                  "deploymentEvidenceHash": evidence_hash, "servingContainers": containers,
                  "servedModels": {role: manifest[role]["servedModel"] for role in ("actor", "predictor")}}
    return config, provenance


def ssh_base(config: dict):
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=2",
            "-o", "ServerAliveInterval=1", "-o", "ServerAliveCountMax=2", "-p", str(config["sshPort"])]


def tunnel_command(config: dict):
    command = [*ssh_base(config), "-N", "-o", "ExitOnForwardFailure=yes"]
    for role, remote in (("actor", 8000), ("predictor", 8001), ("otlp", 4318)):
        command.extend(["-L", f"127.0.0.1:{config['localPorts'][role]}:127.0.0.1:{remote}"])
    return [*command, config["sshDestination"]]


REMOTE_PROBE = '''import json,socket,urllib.request,subprocess
from pathlib import Path
result={"instanceId":Path("/sys/devices/virtual/dmi/id/board_asset_tag").read_text().strip()}
result["containers"]={}
for role,identifier in CONTAINER_IDS.items():
    format='{"id":{{json .Id}},"imageId":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}}}'
    result["containers"][role]=json.loads(subprocess.check_output(["docker","--host","unix:///var/run/docker.sock","inspect","--format",format,identifier],text=True,timeout=1))
for role,port in (("actor",8000),("predictor",8001)):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health",timeout=1) as response:
        if response.status!=200: raise ValueError("Unhealthy model server")
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/models",timeout=1) as response:
        result[role]=json.load(response)
with socket.create_connection(("127.0.0.1",4318),timeout=1): result["otlpListening"]=True
print(json.dumps(result,separators=(",",":")))'''


def probe_command(config: dict, provenance: dict):
    prefix = "CONTAINER_IDS=" + repr({role: row["id"] for role, row in provenance["servingContainers"].items()}) + "\n"
    encoded = base64.b64encode((prefix + REMOTE_PROBE).encode()).decode()
    # The only remote shell text is fixed code plus base64, never caller text.
    command = "python3 -c 'import base64;exec(base64.b64decode(\"" + encoded + "\"))'"
    return [*ssh_base(config), config["sshDestination"], command]


def verify_observation(provenance: dict, remote: dict, local_models: dict):
    if remote.get("instanceId") != provenance["expectedInstanceId"] or remote.get("otlpListening") is not True:
        raise ValueError("Remote instance or collector identity mismatch")
    for role in ("actor", "predictor"):
        container = remote.get("containers", {}).get(role, {})
        if container.get("running") is not True or any(container.get(key) != value for key, value in provenance["servingContainers"][role].items()):
            raise ValueError("Observed serving container changed since deployment inventory")
        remote_ids = [row["id"] for row in remote.get(role, {}).get("data", [])]
        local_ids = [row["id"] for row in local_models.get(role, {}).get("data", [])]
        if remote_ids != [provenance["servedModels"][role]] or local_ids != remote_ids:
            raise ValueError("Forwarded model endpoint identity mismatch")


def observe(config: dict, provenance: dict, *, runner=subprocess.run, opener=urllib.request.urlopen):
    started = time.time() * 1000
    remote = runner(probe_command(config, provenance), capture_output=True, text=True, check=True, timeout=2.5,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    remote_value, local = json.loads(remote.stdout), {}
    for role in ("actor", "predictor"):
        with opener(provenance["endpoints"][role] + "/v1/models", timeout=0.5) as response:
            local[role] = json.load(response)
    verify_observation(provenance, remote_value, local)
    completed = time.time() * 1000
    if completed - started > 2500:
        raise TimeoutError("Remote observation exceeded heartbeat freshness budget")
    return {"remoteInstanceId": remote_value["instanceId"], "probeStartedAtUnixMs": started,
            "observedAtUnixMs": completed, "remoteResponseHash": hash_v1(remote_value), "localResponseHash": hash_v1(local)}


def publish(directory: Path, sequence: int, provenance: dict, healthy: bool, details: dict):
    value = {"healthy": healthy, "state": "healthy" if healthy else "degraded", "networkConnected": healthy,
             "observedAtUnixMs": time.time() * 1000, "maxStatusAgeMs": 3000, "heartbeatSequence": sequence,
             "endpointProvenanceHash": hash_v1(provenance), "manifestHash": provenance["manifestHash"], **details}
    temporary = directory / f"{sequence:016d}.pending"
    write(temporary, value)
    temporary.rename(directory / f"{sequence:016d}.json")
    return value


def run_guard(configuration: Path, output: Path):
    config, provenance = load_guard(configuration)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    write(output / "provenance.json", {**provenance, "contentHash": hash_v1(provenance), "guardConfigurationHash": hash_v1(config)})
    deadline, sequence, tunnel = time.monotonic() + config["maximumLifetimeSeconds"], 0, None
    try:
        with (output / "ssh-tunnel.log").open("x", encoding="utf-8") as log:
            tunnel = subprocess.Popen(tunnel_command(config), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log,
                                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            while time.monotonic() < deadline:
                sequence += 1
                try:
                    if tunnel.poll() is not None:
                        raise RuntimeError("Guard-owned SSH forwarding process exited")
                    details = observe(config, provenance)
                    if tunnel.poll() is not None:
                        raise RuntimeError("SSH tunnel exited during observation")
                    publish(output, sequence, provenance, True, details)
                except Exception as error:
                    publish(output, sequence, provenance, False, {"errorType": type(error).__name__})
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait(timeout=5)
        publish(output, sequence + 1, provenance, False, {"reason": "guard_stopped", "tunnelClosed": tunnel is None or tunnel.poll() is not None})
    return {"statusDirectory": str(output), "endpointProvenanceHash": hash_v1(provenance), "providerResourcesChanged": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run_guard(args.config, args.output)))


if __name__ == "__main__":
    main()
