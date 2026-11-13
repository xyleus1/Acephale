"""Explicit deployment operations. Importing this module never accesses credentials.

No operation provisions resources by default. Provider calls use an injected
transport in tests. Uncertain launch/termination responses retain reservations.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import ipaddress
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

HERE = Path(__file__).resolve().parent
API = "https://cloud.lambda.com/api/v1"
PROFILE = "acephale-infra-v1"
ROOT = HERE.parent.parent
USER_AGENT = "Acephale-Research-Lifecycle/1.0"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def hardware_profile(name: str) -> dict[str, Any]:
    profiles = read_json(HERE / "hardware-profiles.json")
    if profiles.get("schemaVersion") != 1 or name not in profiles.get("profiles", {}):
        raise ValueError("Explicit approved hardware profile required")
    return {"id": name, **profiles["profiles"][name]}


def limits() -> dict[str, Any]:
    return read_json(HERE / "versions.json")["limits"]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def atomic_json(path: Path, value: Any) -> None:
    staging = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    write_new(staging, value)
    os.replace(staging, path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_number(value: Any, name: str, minimum: float = 0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f"Invalid {name}")
    return value


def preflight(hardware: str = "a6000-48gb-v1") -> dict[str, Any]:
    """Inspect program availability and credential presence, never their values."""
    selected = hardware_profile(hardware)
    programs = {name: shutil.which(name) is not None for name in ("docker", "node", "python", "nvidia-smi", "ssh")}
    blockers = [f"missing_{name}" for name in ("docker", "nvidia-smi") if not programs[name]]
    commands: dict[str, Any] = {}
    for name, command in {
        "docker": ["docker", "version", "--format", "{{.Server.Version}}"],
        "compose": ["docker", "compose", "version", "--short"],
        "gpu": ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader,nounits"],
    }.items():
        if shutil.which(command[0]):
            try:
                result = subprocess.run(command, text=True, capture_output=True, timeout=10, check=False)
                commands[name] = {"ok": result.returncode == 0, "output": result.stdout.strip()[:1000]}
                if result.returncode:
                    blockers.append(f"failed_{name}")
                if name == "gpu" and result.returncode == 0:
                    rows = [row.split(",") for row in result.stdout.strip().splitlines()]
                    if not rows or any(len(row) != 3 or int(row[1].strip().split(".")[0]) < 580 for row in rows):
                        blockers.append("driver_below_580")
                    if len(rows) != 1 or selected["gpuNameContains"] not in rows[0][0]:
                        blockers.append("gpu_identity_differs_from_hardware_profile")
                    if not rows or max(float(row[2]) for row in rows) < selected["minimumGpuMemoryMiB"]:
                        blockers.append("gpu_memory_below_hardware_profile")
            except (OSError, subprocess.TimeoutExpired, ValueError):
                commands[name] = {"ok": False}
                blockers.append(f"failed_{name}")
    return {"profile": PROFILE, "hardwareProfile": selected, "hardwareProfileHash": digest(selected), "platform": platform.system(), "python": platform.python_version(),
            "programs": programs, "checks": commands,
            "credentialPresence": {name: bool(os.environ.get(name)) for name in ("LAMBDA_API_KEY", "OPENAI_API_KEY")},
            "blockers": sorted(set(blockers)), "readyForGpuExecution": not blockers,
            "note": "No credentials read from files, no model calls, no downloads, no provisioning."}


def validate_config() -> dict[str, Any]:
    config = read_json(HERE / "compose.json")
    versions = read_json(HERE / "versions.json")
    services = config["services"]
    assert config["networks"]["research"]["internal"] is True
    assert "ports" not in services["postgres"], "Research database must not publish a port"
    for name, service in services.items():
        assert service.get("restart") == "no", f"Unbounded restart policy: {name}"
        assert "mem_limit" in service and "cpus" in service
        for port in service.get("ports", []):
            assert port.startswith("127.0.0.1:"), f"Public listener: {name}"
        assert not service.get("privileged")
        assert not any("docker.sock" in volume for volume in service.get("volumes", []))
    for name in ("actor", "predictor"):
        service = services[name]
        assert service["image"] == versions["images"]["vllm"]
        assert "@sha256:" in service["image"]
        assert service["environment"]["HF_HUB_OFFLINE"] == "1"
        assert any(volume.endswith(":/models:ro") for volume in service["volumes"])
    for path in (HERE / "prometheus.json", HERE / "loki.json", HERE / "tempo.json"):
        read_json(path)
    for path in (HERE / "grafana" / "dashboards").glob("*.json"):
        read_json(path)
    return {"valid": True, "services": len(services), "containerExecutionValidated": False,
            "note": "Static configuration and isolation checks only; Docker config/startup still required."}


def download_models(root: Path, roles: list[str]) -> dict[str, Any]:
    if importlib.metadata.version("huggingface_hub") != "2.4.0":
        raise ValueError("Use a dedicated downloader with huggingface_hub==2.4.0")
    from huggingface_hub import snapshot_download
    models = read_json(HERE / "versions.json")["models"]
    records = []
    for role in roles:
        model = models[role]
        target = root / model["directory"]
        receipt = target / "acephale-model.receipt.json"
        if receipt.exists():
            verify_model(target, model)
            records.append(read_json(receipt))
            continue
        snapshot_download(repo_id=model["repository"], revision=model["revision"], local_dir=target)
        files = []
        for path in sorted(target.rglob("*")):
            if path.is_file() and ".cache" not in path.relative_to(target).parts:
                files.append({"path": path.relative_to(target).as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)})
        names = {row["path"] for row in files}
        if not any(name.endswith(".safetensors") for name in names) or "config.json" not in names or "tokenizer_config.json" not in names:
            raise ValueError(f"Incomplete model download: {role}")
        result = {"profile": PROFILE, "role": role, **model, "files": files}
        write_new(receipt, result)
        records.append(result)
    return {"models": [{"role": item["role"], "revision": item["revision"], "files": len(item["files"])} for item in records]}


def verify_model(root: Path, expected: dict[str, Any]) -> None:
    manifest = read_json(root / "acephale-model.receipt.json")
    if manifest["repository"] != expected["repository"] or manifest["revision"] != expected["revision"]:
        raise ValueError("Model identity mismatch")
    base = root.resolve()
    for row in manifest["files"]:
        path = (root / row["path"]).resolve()
        if not path.is_relative_to(base) or not path.is_file() or path.stat().st_size != row["bytes"] or sha256(path) != row["sha256"]:
            raise ValueError("Model content verification failed")


def lock_images(output: Path) -> dict[str, Any]:
    """Explicit network/pull operation, never called by preflight."""
    if output.exists():
        raise FileExistsError(output)
    images = read_json(HERE / "versions.json")["images"]
    locked = {}
    for name, image in images.items():
        subprocess.run(["docker", "pull", "--platform", "linux/amd64", image], check=True)
        result = subprocess.run(["docker", "image", "inspect", image], text=True, capture_output=True, check=True)
        inspected = json.loads(result.stdout)[0]
        digests = inspected.get("RepoDigests", [])
        if inspected.get("Architecture") != "amd64" or not digests:
            raise ValueError(f"No amd64 immutable image for {name}")
        pinned = image if "@sha256:" in image else digests[0]
        locked[name] = {"requested": image, "pinned": pinned, "imageId": inspected["Id"]}
    write_new(output, {"profile": PROFILE, "images": locked})
    return {"path": str(output), "sha256": sha256(output), "images": len(locked)}


def locked_compose(lock_path: Path, output: Path, hardware: str | None = None,
                   models_root: Path | None = None, predictor_export: Path | None = None) -> dict[str, Any]:
    lock = read_json(lock_path)
    versions = read_json(HERE / "versions.json")
    if lock.get("profile") != PROFILE:
        raise ValueError("Wrong image lock profile")
    pins = {}
    for name, expected in versions["images"].items():
        record = lock["images"].get(name, {})
        pin = record.get("pinned", "")
        if record.get("requested") != expected or "@sha256:" not in pin or len(pin.rsplit("@sha256:", 1)[1]) != 64:
            raise ValueError("Missing or incompatible immutable image lock")
        pins[name] = pin
    config = read_json(HERE / "compose.json")
    if hardware is not None:
        apply_hardware(config, hardware)
    if predictor_export is not None:
        if models_root is None:
            raise ValueError("Explicit model root required for trained predictor serving")
        apply_predictor_export(config, models_root, predictor_export)
    for name in ("postgres", "grafana", "prometheus", "tempo", "loki", "alloy"):
        config["services"][name]["image"] = pins[name]
    for name in ("actor", "predictor"):
        config["services"][name]["image"] = pins["vllm"]
    config["services"]["acephale-runtime"]["build"]["args"]["NODE_IMAGE"] = pins["node"]
    config["services"]["python-worker"]["build"]["args"]["PYTHON_IMAGE"] = pins["python"]
    # Keep the generated file beside the source so relative mounts remain correct.
    if output.resolve().parent != HERE:
        raise ValueError("Write locked Compose beside compose.json to preserve relative paths")
    write_new(output, config)
    return {"path": str(output), "sha256": sha256(output), "imageLockSha256": sha256(lock_path)}


def apply_hardware(value: dict, hardware: str) -> None:
    selected = hardware_profile(hardware)
    for role in ("actor", "predictor"):
        command = value["services"][role]["command"]
        for flag, setting in (("--max-num-seqs", selected[role + "MaxSequences"]),
                              ("--gpu-memory-utilization", selected[role + "GpuMemoryUtilization"])):
            command[command.index(flag) + 1] = str(setting)
        if int(command[command.index("--max-model-len") + 1]) != selected[role + "Context"]:
            raise ValueError("Hardware profile cannot change pinned context limits")
    value["x-acephale-hardware-profile"] = {**selected, "contentHash": digest(selected)}


def checked_predictor_export(path: Path) -> dict:
    # Reuse the training package's verifier; no second artifact/hash contract.
    sys.path.insert(0, str(ROOT / "research/acephale/src"))
    try:
        from acephale.training import verify_export as verify_trained_export
        artifact = verify_trained_export(path)
        manifests = [{"path": name, "sha256": sha256(path / name), "bytes": (path / name).stat().st_size}
                     for name in ("predictor.json", "training-manifest.json", "dataset-manifest.json", "training-receipt.json", "verification.json")]
        return {"artifact": artifact, "verifiedManifestFiles": manifests,
                "mergedFiles": read_json(path / "verification.json")["mergedFiles"]}
    finally:
        sys.path.pop(0)


def apply_predictor_export(value: dict, models_root: Path, predictor_export: Path) -> dict:
    root, exported = models_root.resolve(), predictor_export.resolve()
    if predictor_export.is_symlink() or not exported.is_relative_to(root) or exported == root:
        raise ValueError("Trained export must be a regular directory inside the read-only model root")
    verified = checked_predictor_export(exported)
    artifact = verified["artifact"]
    command = value["services"]["predictor"]["command"]
    command[command.index("--model") + 1] = "/models/" + (exported / "model").relative_to(root).as_posix()
    command[command.index("--served-model-name") + 1] = artifact["servedModel"]
    value["x-acephale-trained-predictor"] = {"artifactHash": artifact["contentHash"], "servedModel": artifact["servedModel"]}
    return verified


def serving_compose(hardware: str, output: Path) -> dict[str, Any]:
    selected = hardware_profile(hardware)
    value = read_json(HERE / "compose.json")
    apply_hardware(value, hardware)
    if output.resolve().parent != HERE:
        raise ValueError("Write hardware Compose beside compose.json to preserve mounts")
    write_new(output, value)
    return {"path": str(output), "sha256": sha256(output), "hardwareProfileHash": digest(selected), "fitVerified": False}


def training_preflight(hardware: str) -> dict[str, Any]:
    value = preflight(hardware)
    if value["blockers"]:
        raise ValueError("GPU training host prerequisites not satisfied")
    # No environment inspection or arbitrary container commands are serialized.
    running = subprocess.run(["docker", "ps", "--filter", "label=com.docker.compose.service=actor", "--format", "{{.ID}}"],
                             text=True, capture_output=True, check=True, timeout=20).stdout.strip()
    processes = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory", "--format=csv,noheader,nounits"],
                               text=True, capture_output=True, check=True, timeout=20).stdout.strip()
    if running or processes:
        raise ValueError("Stop actor/predictor serving and all GPU compute before training")
    return {"version": 1, "profile": "acephale-training-preflight-v1", "observedAt": time.time(),
            "hardwareProfile": hardware, "hardwareProfileHash": digest(hardware_profile(hardware)),
            "actorStopped": True, "gpuProcesses": 0, "hostPreflight": value}


def training_lease(ledger_path: Path, lease_id: str, preflight_path: Path, output: Path, hours: float,
                   kind: str = "fit") -> dict[str, Any]:
    with ledger_lock(ledger_path):
        return _training_lease(ledger_path, lease_id, preflight_path, output, hours, kind)


def _training_lease(ledger_path: Path, lease_id: str, preflight_path: Path, output: Path, hours: float,
                    kind: str = "fit") -> dict[str, Any]:
    ledger = checked_bound_ledger(ledger_path)
    amendment = effective_budget_policy(ledger)
    policy = amendment["policy"] if amendment else None
    lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
    current = time.time()
    checked = read_json(preflight_path)
    duration = finite_number(hours, "training hours", 0.01)
    max_seconds = policy["maxTrainingWindowSeconds"] if policy else 7200
    if (kind not in {"fit", "smoke"} or lease["status"] != "active" or not lease["instanceId"] or duration * 3600 > max_seconds
            or checked.get("profile") != "acephale-training-preflight-v1" or checked.get("actorStopped") is not True
            or checked.get("gpuProcesses") != 0 or not 0 <= current - checked.get("observedAt", 0) <= 120
            or checked.get("hardwareProfileHash") != lease["quote"]["hardwareProfileHash"]):
        raise ValueError("Active funded lease and actual recent idle-GPU preflight required")
    deadline = min(current + duration * 3600, lease["deadline"])
    if deadline <= current:
        raise ValueError("GPU lease expired")
    windows = ledger.setdefault("trainingWindows", [])
    if policy:
        extra = windows[len(amendment["baselineTrainingWindows"]):]
        limit = policy["additionalSmokeSeconds"] if kind == "smoke" else policy["additionalFittingSeconds"]
        if sum(row["reservedSeconds"] for row in extra if row["trainingKind"] == kind) + deadline - current > limit:
            raise ValueError("Additional training windows exceed the approved kind allowance")
    elif sum(row["reservedSeconds"] for row in windows) + deadline - current > 7200:
        raise ValueError("Combined training windows exceed the approved two-hour ceiling")
    if output.exists():
        raise ValueError("Training lease output must be new")
    value = {"version": 1, "profile": "acephale-training-lease-v1", "phase": "predictor_training", "status": "active",
             "leaseId": lease_id, "instanceId": lease["instanceId"], "hardwareProfile": checked["hardwareProfile"],
             "startedAt": current, "deadline": deadline, "actorStopped": True,
             "studyReservation": lease["studyReservation"], "studyBindingHash": ledger["planHash"],
             "providerLeaseHash": digest(lease), "preflightHash": sha256(preflight_path)}
    if policy:
        value.update(version=2, profile="acephale-training-lease-v2", trainingKind=kind, budgetPolicy=policy,
                     budgetPolicyHash=amendment["policyHash"], budgetAmendmentHash=amendment["contentHash"])
    windows.append({"leaseId": lease_id, "reservedSeconds": deadline - current, "startedAt": current, "deadline": deadline,
                    "receiptHash": digest(value), **({"trainingKind": kind, "budgetAmendmentHash": amendment["contentHash"]} if policy else {})})
    atomic_json(ledger_path, ledger)
    write_new(output, value)
    return value


def watchdog_state(ledger_path: Path, lease_id: str) -> dict[str, Any]:
    ledger = checked_bound_ledger(ledger_path)
    lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
    if lease["status"] not in {"reserved", "launching", "launch_unknown", "active", "termination_requested", "terminated"}:
        raise ValueError("Lease funding has not completed")
    return {"version": 1, "profile": PROFILE, "planHash": ledger["planHash"], "leaseId": lease_id,
            "expectedName": lease["name"], "instanceId": lease["instanceId"], "status": lease["status"],
            "reservedAt": lease["reservedAt"], "deadline": lease["deadline"], "setupDeadline": lease["setupDeadline"],
            "ready": lease["ready"], "ownerHeartbeatAt": time.time(), "ownerHeartbeatTimeoutSeconds": 120,
            "purpose": lease.get("purpose", "research"), "recoveryControllerId": lease.get("recoveryControllerId")}


def provider_receipt(client: Any, ledger_path: Path, lease_id: str, ssh_observation: Path, output: Path) -> dict:
    ledger = checked_bound_ledger(ledger_path)
    lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
    if lease["status"] != "active" or not lease["instanceId"]:
        raise ValueError("Active funded instance required")
    item = client.request("GET", "/instances/" + lease["instanceId"])
    ssh = read_json(ssh_observation)
    if (item.get("id") != lease["instanceId"] or item.get("name") != lease["name"] or item.get("status") != "active"
            or item.get("instance_type", {}).get("name") != lease["quote"]["instanceType"]
            or ssh.get("host") != item.get("ip") or ssh.get("port") != 22 or ssh.get("user") != "ubuntu"
            or not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", ssh.get("hostKeySha256", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", ssh.get("machineIdSha256", ""))):
        raise ValueError("Live provider identity and pinned SSH host observation disagree")
    ipaddress.ip_address(item["ip"])
    value = {"version": 1, "profile": PROFILE, "provider": "lambda", "observedAt": time.time(),
             "leaseId": lease_id, "leaseName": lease["name"], "hardwareProfile": lease["quote"]["hardwareProfile"],
             "hardwareProfileHash": lease["quote"]["hardwareProfileHash"], "instance": item,
             "ssh": ssh, "providerResponseHash": digest(item), "studyBindingHash": ledger["planHash"],
             "launchImageId": lease["quote"]["imageId"]}
    value["contentHash"] = digest(value)
    write_new(output, value)
    return {"path": str(output), "sha256": sha256(output), "instanceId": item["id"]}


class LambdaClient:
    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("LAMBDA_API_KEY is not configured")
        self._key = api_key
        self._last_request = 0.0

    def request(self, method: str, path: str, payload: Any = None) -> Any:
        if not path.startswith("/") or "://" in path:
            raise ValueError("Invalid provider endpoint")
        # Respect the provider's one request/second general API limit.
        time.sleep(max(0, 1.05 - (time.monotonic() - self._last_request)))
        self._last_request = time.monotonic()
        data = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        request = urllib.request.Request(API + path, data=data, method=method,
            headers={"Authorization": "Bearer " + self._key, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise RuntimeError("Provider redirect rejected; credentials were not forwarded")
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                value = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Lambda request failed with HTTP {error.code}; response omitted") from None
        except (OSError, ValueError):
            raise RuntimeError("Lambda response uncertain; reservation must remain") from None
        if "data" not in value:
            raise RuntimeError("Malformed provider response; reservation must remain")
        return value["data"]


def quote(client: Any, region: str, now: float | None = None, hardware: str = "a100-40gb-v1") -> dict[str, Any]:
    selected = hardware_profile(hardware)
    kinds = client.request("GET", "/instance-types")
    item = kinds.get(selected["instanceType"])
    if not item or region not in {value["name"] for value in item.get("regions_with_capacity_available", [])}:
        raise ValueError("Requested hardware profile region has no reported capacity")
    instance_type = item["instance_type"]
    cents = finite_number(instance_type["price_cents_per_hour"], "price", 1)
    if instance_type["name"] != selected["instanceType"] or instance_type["specs"]["gpus"] != 1 or instance_type.get("architecture", "x86_64") != "x86_64":
        raise ValueError("Unexpected hardware shape")
    if cents > limits()["hourlyUsd"] * 100:
        raise ValueError("Current quote exceeds the authorized hourly ceiling")
    images = client.request("GET", "/images")
    compatible = [image for image in images if image["family"] == "gpu-base-24-04" and image["architecture"] == "x86_64" and image["region"]["name"] == region]
    if not compatible:
        raise ValueError("Required GPU Base 24.04 image unavailable")
    image = max(compatible, key=lambda value: (value["created_time"], value["id"]))
    return {"profile": PROFILE, "quotedAt": time.time() if now is None else now, "region": region,
            "hardwareProfile": hardware, "hardwareProfileHash": digest(selected),
            "instanceType": instance_type["name"], "hourlyUsd": cents / 100,
            "imageId": image["id"], "imageFamily": image["family"], "specs": instance_type["specs"]}


@contextlib.contextmanager
def ledger_lock(path: Path):
    lock = path.with_name(path.name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    # A crash lock is deliberately not automatically removed by a new process.
    with lock.open("x", encoding="utf-8") as stream:
        stream.write(str(os.getpid()))
        stream.flush()
    try:
        yield
    finally:
        lock.unlink()


def init_ledger(path: Path, overall_reserved_usd: float, prior_infra_usd: float, prior_hours: float) -> dict[str, Any]:
    """Legacy unbound slice constructor. Unbound slices cannot launch instances."""
    overall = finite_number(overall_reserved_usd, "overall reservations")
    infra = finite_number(prior_infra_usd, "prior infrastructure")
    hours = finite_number(prior_hours, "prior GPU hours")
    if overall + 65 + 35 > 500 or infra > 35 or hours > 24 or overall < infra:
        raise ValueError("Budget checkpoint cannot support the protected allocation")
    value = {"profile": PROFILE, "schemaVersion": 1, "overallReservedAtInitializationUsd": overall,
             "priorInfraUsd": infra, "priorGpuHours": hours, "infrastructureAllocationUsd": 35,
             "protectedContingencyUsd": 65, "leases": []}
    write_new(path, value)
    return value


def load_plan(path: Path) -> dict[str, Any]:
    value = read_json(path)
    if value.get("version") != 1 or value.get("provider") != "lambda" or value.get("profile") != PROFILE:
        raise ValueError("Explicit versioned Lambda launch plan required")
    hardware_profile(value.get("hardwareProfile", ""))
    for key in ("studyCheckpointHash", "sourceCommit"):
        length = 64 if key.endswith("Hash") else 40
        if not re.fullmatch(r"[a-f0-9]{" + str(length) + r"}", value.get(key, "")):
            raise ValueError(f"Invalid {key}")
    for key in ("studyLedgerPath", "studyCheckpointPath", "infrastructureLedgerPath", "exportRoot"):
        if not isinstance(value.get(key), str) or not value[key]:
            raise ValueError(f"Explicit {key} required")
        value[key] = str((path.parent / value[key]).resolve())
    for key in ("region", "sshKeyName", "firewallRulesetId", "deploymentId"):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value.get(key, "")):
            raise ValueError(f"Invalid {key}")
    return value


def study_budget(plan: dict[str, Any], operation: str, lease: dict[str, Any] | None = None) -> dict[str, Any]:
    request = {"provider": "lambda", "operation": operation, "ledgerPath": plan["studyLedgerPath"],
               "checkpointPath": plan["studyCheckpointPath"], "checkpointHash": plan["studyCheckpointHash"],
               "sliceLedgerPath": plan["infrastructureLedgerPath"], "deploymentHash": digest(plan)}
    if lease:
        request.update(reservationId="lambda-infra:" + lease["id"], maximumMicrodollars=lease["reservedMicrodollars"], requireNewReservation=True)
    with tempfile.TemporaryDirectory(prefix="acephale-lambda-budget-") as directory:
        request_path = Path(directory) / "request.json"
        write_new(request_path, request)
        try:
            result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-aws-budget.ts", str(request_path)],
                                    cwd=ROOT, text=True, capture_output=True, timeout=180, check=False, shell=False)
        except (OSError, subprocess.SubprocessError):
            raise RuntimeError("Original study budget operation uncertain; reservations retained") from None
        if result.returncode:
            raise RuntimeError("Original study budget operation rejected; reservations retained")
        return json.loads(result.stdout)


def init_bound_ledger(path: Path, plan: dict[str, Any], prior_hours: float, *, budget=study_budget) -> dict[str, Any]:
    if path.resolve() != Path(plan["infrastructureLedgerPath"]).resolve() or path.exists():
        raise ValueError("Only a new explicitly bound infrastructure slice may initialize")
    hours = finite_number(prior_hours, "reconciled prior GPU hours")
    if hours > 24:
        raise ValueError("Reconciled GPU hours exceed the original limit")
    checkpoint = budget(plan, "bind")
    prior = checkpoint["infrastructureMicrodollars"] / 1_000_000
    if prior > 35:
        raise ValueError("Original infrastructure allocation exhausted")
    value = {"profile": PROFILE, "schemaVersion": 2, "provider": "lambda", "plan": plan, "planHash": digest(plan),
             "versionsSha256": sha256(HERE / "versions.json"), "hardwareProfilesSha256": sha256(HERE / "hardware-profiles.json"),
             "initialStudyEvidence": checkpoint, "overallReservedAtInitializationUsd": checkpoint["committedMicrodollars"] / 1_000_000,
             "priorInfraUsd": prior, "priorGpuHours": hours, "infrastructureAllocationUsd": 35,
             "computeAllocationUsd": 30, "protectedContingencyUsd": 65, "leases": [], "overheads": []}
    write_new(path, value)
    return value


def _checked_bound_ledger_identity(path: Path) -> dict[str, Any]:
    value = read_json(path)
    plan = value.get("plan", {})
    if (value.get("schemaVersion") != 2 or value.get("provider") != "lambda" or value.get("profile") != PROFILE
            or value.get("planHash") != digest(plan) or Path(plan.get("infrastructureLedgerPath", "")).resolve() != path.resolve()
            or value.get("hardwareProfilesSha256") != sha256(HERE / "hardware-profiles.json")):
        raise ValueError("Original-study-bound Lambda slice and exact source profiles required")
    return value


def versions_amendment_path(ledger_path: Path) -> Path:
    return ledger_path.with_name(ledger_path.name + ".versions-metadata-amendment.json")


def _cuda_metadata_evidence(original_text: str, effective_text: str, evidence: dict) -> dict:
    """Verify one metadata correction against the unchanged, immutable OCI image."""
    original, effective = json.loads(original_text), json.loads(effective_text)
    expected = {**original, "servingCuda": "13.0.2", "servingCudaSource": "immutable_image_cuda_version",
                "servingTorchCuda": "13.0"}
    image = "vllm/vllm-openai:v0.32.0@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34"
    if (original.get("servingCuda") != "13.0.3" or "servingCudaSource" in original or "servingTorchCuda" in original
            or effective != expected or original.get("images", {}).get("vllm") != image):
        raise ValueError("Only the declared three-field CUDA identity metadata correction is permitted")
    if set(evidence) != {"indexUtf8", "manifestUtf8", "configUtf8"} or any(not isinstance(v, str) for v in evidence.values()):
        raise ValueError("Complete raw immutable OCI evidence required")
    hashes = {key: "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest() for key, text in evidence.items()}
    index, manifest, config = (json.loads(evidence[key]) for key in ("indexUtf8", "manifestUtf8", "configUtf8"))
    candidates = [row for row in index.get("manifests", []) if row.get("platform") == {"architecture": "amd64", "os": "linux"}]
    if (hashes["indexUtf8"] != image.split("@", 1)[1] or len(candidates) != 1
            or candidates[0].get("digest") != hashes["manifestUtf8"]
            or candidates[0].get("size") != len(evidence["manifestUtf8"].encode("utf-8"))
            or manifest.get("config", {}).get("digest") != hashes["configUtf8"]
            or manifest.get("config", {}).get("size") != len(evidence["configUtf8"].encode("utf-8"))
            or config.get("architecture") != "amd64" or config.get("os") != "linux"):
        raise ValueError("Raw OCI index, platform manifest and config do not match the pinned digest chain")
    environment = config.get("config", {}).get("Env", [])
    if [row for row in environment if row.startswith("CUDA_VERSION=")] != ["CUDA_VERSION=13.0.2"]:
        raise ValueError("Pinned image does not establish the declared CUDA image-base release")
    return {"image": image, "indexDigest": hashes["indexUtf8"], "platformDigest": hashes["manifestUtf8"],
            "configDigest": hashes["configUtf8"], "cudaIdentitySource": "immutable_image_cuda_version",
            "cudaImageBaseRelease": "13.0.2", "torchCudaRequiredAtQualification": "13.0",
            "installedToolkitPatchEstablished": False}


def _financial_binding_hash(ledger: dict) -> str:
    # These append-only operational records change under the controller's own
    # admission checks; the original plan and financial ceilings do not.
    return digest({key: value for key, value in ledger.items() if key not in {"leases", "overheads", "trainingWindows"}})


def effective_budget_policy(ledger: dict) -> dict | None:
    """Validate an explicit amendment while preserving all prior funded work."""
    journal = ledger.get("plan", {}).get("studyLedgerPath")
    if not journal:
        return None
    path = Path(str(Path(journal).resolve()) + ".policy-v2.json")
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Invalid budget amendment file")
    value = read_json(path)
    approved = read_json(ROOT / "src/lib/acephale/contracts/budget-policy-v2.json")
    if (value.get("version") != 2 or value.get("profile") != "acephale-budget-amendment-v2"
            or value.get("contentHash") != _budget_digest({key: item for key, item in value.items() if key != "contentHash"})
            or value.get("policy") != approved or value.get("policyHash") != _budget_digest(approved)
            or value.get("studyLedgerPathHash") != _budget_digest(str(Path(journal).resolve()))
            or value.get("infrastructureBindingHash") != _budget_binding_hash(ledger)
            or value.get("infrastructurePlanHash") != ledger["planHash"]):
        raise ValueError("Budget amendment does not bind the original study and approved policy")
    for baseline, field in (("baselineLeases", "leases"), ("baselineOverheads", "overheads"),
                            ("baselineTrainingWindows", "trainingWindows")):
        prior = value.get(baseline)
        current = ledger.get(field, [])
        if not isinstance(prior, list) or current[:len(prior)] != prior:
            raise ValueError("Budget amendment operational history changed or disappeared")
    if (sum(row["reservedSeconds"] for row in value["baselineTrainingWindows"]) > approved["priorTrainingSeconds"]
            or any(row["status"] != "terminated" for row in value["baselineLeases"])):
        raise ValueError("Budget amendment requires closed prior work")
    extra = ledger.get("trainingWindows", [])[len(value["baselineTrainingWindows"]):]
    if any(row.get("trainingKind") not in {"fit", "smoke"} or row.get("budgetAmendmentHash") != value["contentHash"] for row in extra):
        raise ValueError("Training window does not bind the budget amendment")
    for kind, key in (("fit", "additionalFittingSeconds"), ("smoke", "additionalSmokeSeconds")):
        if sum(row["reservedSeconds"] for row in extra if row["trainingKind"] == kind) > approved[key]:
            raise ValueError("Training windows exceed the approved amendment")
    return value


def _budget_digest(value: Any) -> str:
    # The amendment is written by TypeScript. Use the same RFC 8785 wire hash.
    import rfc8785
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def _budget_binding_hash(ledger: dict) -> str:
    return _budget_digest({key: value for key, value in ledger.items() if key not in {"leases", "overheads", "trainingWindows"}})


def infrastructure_caps(ledger: dict) -> tuple[float, float, float]:
    amendment = effective_budget_policy(ledger)
    if not amendment:
        return 35, 30, 5
    policy = amendment["policy"]
    return policy["allocationsMicrodollars"]["infrastructure"] / 1_000_000, policy["infrastructureComputeUsd"], policy["infrastructureAssociatedUsd"]


def effective_versions_metadata(ledger_path: Path, ledger: dict) -> dict:
    current = sha256(HERE / "versions.json")
    if ledger.get("versionsSha256") == current:
        return {"originalVersionsSha256": current, "effectiveVersionsSha256": current, "amendmentHash": None}
    path = versions_amendment_path(ledger_path)
    if not path.is_file():
        raise ValueError("Original source versions changed without an append-only metadata amendment")
    value = read_json(path)
    if (value.get("contentHash") != digest({key: item for key, item in value.items() if key != "contentHash"})
            or value.get("version") != 1 or value.get("profile") != "acephale-versions-metadata-amendment-v1"
            or value.get("planHash") != ledger["planHash"] or value.get("financialBindingChanged") is not False
            or value.get("financialBindingHash") != _financial_binding_hash(ledger)
            or value.get("originalVersionsSha256") != ledger["versionsSha256"]
            or value.get("effectiveVersionsSha256") != current
            or value.get("hardwareProfilesSha256") != ledger["hardwareProfilesSha256"]
            or value.get("initialSourceCommit") != ledger["plan"]["sourceCommit"]
            or not re.fullmatch(r"[a-f0-9]{40}", str(value.get("executingSourceCommit", "")))
            or not isinstance(value.get("reason"), str) or not value["reason"].strip()):
        raise ValueError("Metadata amendment does not bind the original financial/source identities")
    for name, target in (("originalVersionsUtf8", ledger["versionsSha256"]), ("effectiveVersionsUtf8", current)):
        if not isinstance(value.get(name), str) or hashlib.sha256(value[name].encode("utf-8")).hexdigest() != target:
            raise ValueError("Metadata amendment raw versions bytes changed")
    observed = _cuda_metadata_evidence(value["originalVersionsUtf8"], value["effectiveVersionsUtf8"], value.get("ociEvidence", {}))
    if value.get("observedCudaIdentity") != observed:
        raise ValueError("Metadata amendment OCI evidence summary changed")
    return {"originalVersionsSha256": ledger["versionsSha256"], "effectiveVersionsSha256": current,
            "amendmentHash": value["contentHash"]}


def checked_bound_ledger(path: Path) -> dict[str, Any]:
    value = _checked_bound_ledger_identity(path)
    effective_versions_metadata(path, value)
    effective_budget_policy(value)
    return value


def record_versions_metadata_amendment(ledger_path: Path, original_versions: Path, oci_directory: Path, reason: str,
                                      *, source_probe=None, budget=study_budget) -> dict:
    """Write one immutable sidecar; leave the original ledger and journal untouched."""
    source_probe = source_probe or committed_source
    with ledger_lock(ledger_path):
        ledger = _checked_bound_ledger_identity(ledger_path)
        output = versions_amendment_path(ledger_path)
        if output.exists():
            raise ValueError("Metadata amendment already exists and cannot be overwritten")
        original = original_versions.read_bytes().decode("utf-8")
        effective = (HERE / "versions.json").read_bytes().decode("utf-8")
        if hashlib.sha256(original.encode("utf-8")).hexdigest() != ledger["versionsSha256"]:
            raise ValueError("Original versions bytes do not match the existing ledger")
        evidence = {key: (oci_directory / name).read_bytes().decode("utf-8") for key, name in
                    (("indexUtf8", "pinned-manifest.json"), ("manifestUtf8", "linux-amd64-manifest.json"),
                     ("configUtf8", "linux-amd64-config.json"))}
        observed = _cuda_metadata_evidence(original, effective, evidence)
        current = source_probe(ledger["plan"]["sourceCommit"])
        if not re.fullmatch(r"[a-f0-9]{40}", current) or current == ledger["plan"]["sourceCommit"] or not reason.strip() or len(reason) > 1024:
            raise ValueError("Distinct clean committed source and explicit bounded reason required")
        before, versions_before = sha256(ledger_path), sha256(HERE / "versions.json")
        journal = budget(ledger["plan"], "inspect")
        if sha256(ledger_path) != before or sha256(HERE / "versions.json") != versions_before:
            raise ValueError("Original infrastructure/source changed while recording metadata amendment")
        value = {"version": 1, "profile": "acephale-versions-metadata-amendment-v1", "planHash": ledger["planHash"],
                 "initialSourceCommit": ledger["plan"]["sourceCommit"], "executingSourceCommit": current,
                 "recordedAt": time.time(), "reason": reason.strip(), "originalVersionsSha256": ledger["versionsSha256"],
                 "effectiveVersionsSha256": versions_before, "originalVersionsUtf8": original, "effectiveVersionsUtf8": effective,
                 "hardwareProfilesSha256": ledger["hardwareProfilesSha256"], "ociEvidence": evidence,
                 "observedCudaIdentity": observed, "infrastructureSliceSha256": before, "originalJournalEvidence": journal,
                 "financialBindingHash": _financial_binding_hash(ledger), "financialBindingChanged": False}
        value["contentHash"] = digest(value)
        write_new(output, value)
        effective_versions_metadata(ledger_path, ledger)
        return value


def committed_source(initial_commit: str) -> str:
    def git(*arguments):
        result = subprocess.run(["git", *arguments], cwd=ROOT, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise ValueError("Source revision must descend from the original committed plan")
        return result.stdout.strip()
    if git("status", "--porcelain=v1", "--untracked-files=normal"):
        raise ValueError("Source provenance requires a clean committed checkout")
    current = git("rev-parse", "HEAD")
    if not re.fullmatch(r"[a-f0-9]{40}", current):
        raise ValueError("Invalid executing source revision")
    git("merge-base", "--is-ancestor", initial_commit, current)
    return current


def controller_source_files() -> list[dict]:
    return [{"path": name, "sha256": sha256(HERE / name)} for name in
            ("control.py", "lambda_gpu_watchdog.py", "lambda_watchdog_deploy.py", "versions.json", "hardware-profiles.json")]


def record_source_amendment(ledger_path: Path, output: Path, reason: str, readiness_evidence: Path,
                            *, source_probe=committed_source, budget=study_budget) -> dict:
    """Append external provenance, never rewrite a financial binding or reservation."""
    ledger = checked_bound_ledger(ledger_path)
    initial = ledger["plan"]["sourceCommit"]
    current = source_probe(initial)
    if current == initial or not reason.strip() or len(reason) > 1024 or not readiness_evidence.is_file():
        raise ValueError("A distinct committed amendment, reason and existing readiness evidence are required")
    before = sha256(ledger_path)
    evidence = budget(ledger["plan"], "inspect")
    if sha256(ledger_path) != before:
        raise ValueError("Infrastructure slice changed while recording source amendment")
    value = {"version": 1, "profile": "acephale-source-amendment-v1", "planHash": ledger["planHash"],
             "initialSourceCommit": initial, "executingSourceCommit": current, "recordedAt": time.time(),
             "reason": reason.strip(), "readinessEvidenceSha256": sha256(readiness_evidence),
             "infrastructureSliceSha256": before, "originalJournalEvidence": evidence,
             "versionsSha256": ledger["versionsSha256"], "hardwareProfilesSha256": ledger["hardwareProfilesSha256"],
             "sourceFiles": controller_source_files(), "financialBindingChanged": False,
             "effectiveVersionsMetadata": effective_versions_metadata(ledger_path, ledger)}
    value["contentHash"] = digest(value)
    write_new(output, value)
    return value


def deployment_source(ledger: dict, amendment: Path | None, *, source_probe=committed_source) -> dict:
    initial = ledger["plan"]["sourceCommit"]
    current = source_probe(initial)
    if current == initial:
        return {"initialSourceCommit": initial, "executingSourceCommit": current, "amendment": None}
    if amendment is None:
        raise ValueError("A source-amendment receipt is required after the initial plan commit")
    value = read_json(amendment)
    if (value.get("contentHash") != digest({key: item for key, item in value.items() if key != "contentHash"})
            or value.get("version") != 1 or value.get("profile") != "acephale-source-amendment-v1"
            or value.get("planHash") != ledger["planHash"] or value.get("initialSourceCommit") != initial
            or value.get("executingSourceCommit") != current or value.get("financialBindingChanged") is not False
            or value.get("versionsSha256") != ledger["versionsSha256"]
            or value.get("effectiveVersionsMetadata", {"originalVersionsSha256": ledger["versionsSha256"],
                "effectiveVersionsSha256": ledger["versionsSha256"], "amendmentHash": None})
                != effective_versions_metadata(Path(ledger["plan"]["infrastructureLedgerPath"]), ledger)
            or value.get("hardwareProfilesSha256") != ledger["hardwareProfilesSha256"]
            or value.get("sourceFiles") != controller_source_files()):
        raise ValueError("Source-amendment receipt does not bind the unchanged plan and executing code")
    return {"initialSourceCommit": initial, "executingSourceCommit": current, "amendment": value}


def reserve_overhead(path: Path, reservation_id: str, maximum_usd: float, *, budget=study_budget) -> dict[str, Any]:
    if str(uuid.UUID(reservation_id)) != reservation_id:
        raise ValueError("Explicit unique overhead reservation UUID required")
    maximum = finite_number(maximum_usd, "overhead allowance", 0.01)
    with ledger_lock(path):
        value = checked_bound_ledger(path)
        all_rows = value["leases"] + value.get("overheads", [])
        if any(row["id"] == reservation_id for row in all_rows):
            raise ValueError("Overhead reservation already attempted")
        infrastructure, _, associated = infrastructure_caps(value)
        if value["priorInfraUsd"] + sum(row["reservedUsd"] for row in all_rows) + maximum > infrastructure:
            raise ValueError("Original infrastructure allocation exhausted")
        charges = sum(row["reservedUsd"] - row.get("reservedComputeUsd", 0) for row in all_rows)
        if charges + maximum > associated:
            raise ValueError("Associated infrastructure charges exceed five dollars" if associated == 5
                             else "Associated infrastructure charges exceed the approved allowance")
        row = {"id": reservation_id, "kind": "watchdog_storage_export", "status": "reservation_pending",
               "reservedUsd": maximum, "reservedMicrodollars": math.ceil(maximum * 1_000_000)}
        value["overheads"].append(row)
        atomic_json(path, value)
        row["studyReservation"] = budget(value["plan"], "reserve", row)
        row["status"] = "reserved"
        atomic_json(path, value)
        return row


def reserve_lease(ledger: dict[str, Any], current_quote: dict[str, Any], hours: float, extra_allowance_usd: float,
                  now: float) -> dict[str, Any]:
    hours = finite_number(hours, "session hours", 0.01)
    allowance = finite_number(extra_allowance_usd, "tax/storage/export allowance", 0)
    rate = finite_number(current_quote["hourlyUsd"], "hourly quote", 0.01)
    quoted_at = finite_number(current_quote["quotedAt"], "quote timestamp")
    selected = hardware_profile(current_quote.get("hardwareProfile", ""))
    if not 0 <= now - quoted_at <= 300 or rate > limits()["hourlyUsd"] or hours > limits()["sessionHours"]:
        raise ValueError("Expired quote, excessive rate, or session longer than eight hours")
    if (current_quote["instanceType"] != selected["instanceType"] or current_quote["imageFamily"] != "gpu-base-24-04"
            or current_quote.get("hardwareProfileHash") != digest(selected)):
        raise ValueError("Unapproved instance or image")
    leases = ledger["leases"]
    if any(lease["status"] != "terminated" for lease in leases):
        raise ValueError("Another lease is active or unresolved")
    used_hours = ledger["priorGpuHours"] + sum(lease["reservedHours"] for lease in leases)
    reserved = ledger["priorInfraUsd"] + sum(lease["reservedUsd"] for lease in leases + ledger.get("overheads", []))
    cost = round(rate * hours + allowance, 6)
    compute = ledger.get("priorComputeUsd", ledger["priorInfraUsd"]) + sum(lease.get("reservedComputeUsd", lease["reservedUsd"]) for lease in leases)
    charges = sum(row["reservedUsd"] - row.get("reservedComputeUsd", 0) for row in leases + ledger.get("overheads", []))
    infrastructure_cap, compute_cap, associated_cap = infrastructure_caps(ledger)
    if used_hours + hours > 24 or reserved + cost > infrastructure_cap or compute + rate * hours > compute_cap or charges + allowance > associated_cap:
        raise ValueError("Cumulative infrastructure allocation exceeded")
    # Do not release reservations after termination without invoice reconciliation.
    return {"id": str(uuid.uuid4()), "status": "reserved", "quote": current_quote,
            "reservedAt": now, "deadline": now + hours * 3600,
            "setupDeadline": now + min(1800, hours * 3600), "reservedHours": hours,
            "reservedUsd": cost, "reservedComputeUsd": round(rate * hours, 6),
            "reservedMicrodollars": math.ceil(cost * 1_000_000), "instanceId": None, "ready": False}


def validate_firewall(client: Any, ruleset_id: str, region: str) -> None:
    if not ruleset_id or not all(character.isalnum() or character == "-" for character in ruleset_id):
        raise ValueError("An explicit restricted firewall ruleset is required")
    selected = client.request("GET", "/firewall-rulesets/" + ruleset_id)
    if selected.get("region", {}).get("name") != region or not selected.get("rules"):
        raise ValueError("Firewall ruleset missing or in a different region")
    global_rules = client.request("GET", "/firewall-rulesets/global")
    for rule in [*selected["rules"], *global_rules.get("rules", [])]:
        source = ipaddress.ip_network(rule["source_network"], strict=True)
        if rule.get("protocol") != "tcp" or rule.get("port_range") != [22, 22] or source.prefixlen < (24 if source.version == 4 else 64):
            raise ValueError("Firewall must allow only SSH from restricted source networks; global rules are included")


def checked_access_amendment(ledger: dict, value: dict) -> dict:
    if (value.get("version") != 1 or value.get("profile") != "acephale-access-amendment-v1"
            or value.get("contentHash") != digest({key: item for key, item in value.items() if key != "contentHash"})
            or value.get("planHash") != ledger["planHash"] or value.get("financialBindingHash") != _financial_binding_hash(ledger)
            or value.get("region") != ledger["plan"]["region"] or value.get("financialBindingChanged") is not False
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("publicKeySha256", ""))
            or any(not re.fullmatch(r"[A-Za-z0-9_-]+", value.get(key, "")) for key in ("sshKeyName", "sshKeyId", "firewallRulesetId"))):
        raise ValueError("Access amendment does not bind the original financial plan")
    return value


def verify_access_key(client: Any, access: dict) -> None:
    keys = [row for row in client.request("GET", "/ssh-keys") if row.get("name") == access["sshKeyName"]]
    if (len(keys) != 1 or keys[0].get("id") != access["sshKeyId"]
            or hashlib.sha256(keys[0].get("public_key", "").encode()).hexdigest() != access["publicKeySha256"]):
        raise ValueError("Exact amended SSH public-key identity required")


def record_access_amendment(client: Any, ledger_path: Path, output: Path, ssh_key_name: str,
                            firewall_ruleset_id: str, reason: str, *, source_probe=committed_source) -> dict:
    """Bind newly created access resources without replacing the budget plan."""
    with ledger_lock(ledger_path):
        ledger = checked_bound_ledger(ledger_path)
        if any(row["status"] != "terminated" for row in ledger["leases"]) or not reason.strip() or len(reason) > 1024:
            raise ValueError("Closed prior leases and an explicit access-change reason required")
        validate_firewall(client, firewall_ruleset_id, ledger["plan"]["region"])
        keys = [row for row in client.request("GET", "/ssh-keys") if row.get("name") == ssh_key_name]
        if len(keys) != 1 or not keys[0].get("public_key"):
            raise ValueError("One actual named SSH public key required")
        body = {"version": 1, "profile": "acephale-access-amendment-v1", "planHash": ledger["planHash"],
                "financialBindingHash": _financial_binding_hash(ledger), "financialBindingChanged": False,
                "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]), "recordedAt": time.time(), "reason": reason.strip(),
                "region": ledger["plan"]["region"], "sshKeyName": ssh_key_name, "sshKeyId": keys[0]["id"],
                "publicKeySha256": hashlib.sha256(keys[0]["public_key"].encode()).hexdigest(), "firewallRulesetId": firewall_ruleset_id}
        value = checked_access_amendment(ledger, {**body, "contentHash": digest(body)})
        write_new(output, value)
        return value


def prepare_lease(client: Any, ledger_path: Path, hours: float, extra_allowance_usd: float,
                  *, now: float | None = None, budget=study_budget, purpose: str = "research",
                  recovery_controller_id: str | None = None, access_amendment: Path | None = None) -> dict[str, Any]:
    current = time.time() if now is None else now
    if purpose not in {"research", "cleanup_canary"} or (purpose == "cleanup_canary" and not 0 < hours <= 1 / 6):
        raise ValueError("Cleanup canary must reserve at most ten minutes")
    if purpose == "cleanup_canary" and not re.fullmatch(r"acephale-[a-z0-9-]+", recovery_controller_id or ""):
        raise ValueError("Canary must identify the independent controller being tested")
    with ledger_lock(ledger_path):
        ledger = checked_bound_ledger(ledger_path)
        plan = ledger["plan"]
        access = checked_access_amendment(ledger, read_json(access_amendment)) if access_amendment else plan
        if access_amendment:
            verify_access_key(client, access)
        budget(plan, "inspect")
        current_quote = quote(client, plan["region"], current, plan["hardwareProfile"])
        validate_firewall(client, access["firewallRulesetId"], plan["region"])
        lease = reserve_lease(ledger, current_quote, hours, extra_allowance_usd, current)
        lease["name"] = "acephale-infra-" + lease["id"]
        lease["purpose"] = purpose
        lease["recoveryControllerId"] = recovery_controller_id
        if access_amendment:
            lease["accessAmendment"] = access
        lease["status"] = "reservation_pending"
        ledger["leases"].append(lease)
        atomic_json(ledger_path, ledger)
        lease["studyReservation"] = budget(plan, "reserve", lease)
        lease["status"] = "reserved"
        atomic_json(ledger_path, ledger)
        return lease.copy()


def watchdog_enrollments(receipt_path: Path, ledger: dict[str, Any], lease: dict[str, Any], now: float) -> list[dict[str, Any]]:
    data = read_json(receipt_path)
    values = data.get("controllers", [])
    if data.get("version") != 1 or len(values) != 2:
        raise ValueError("Two actual independent watchdog enrollments required")
    hosts, controllers, regions = set(), set(), set()
    recovery_required = lease.get("purpose") != "cleanup_canary"
    if not recovery_required and lease["reservedHours"] > 1 / 6:
        raise ValueError("Canary exceeds ten minutes")
    for value in values:
        if (value.get("profile") != PROFILE or value.get("controllerKind") != "independent_always_on"
                or value.get("hostingKind") != "aws_lambda" or value.get("leaseId") != lease["id"]
                or value.get("expectedName") != lease["name"] or value.get("planHash") != ledger["planHash"]
                or value.get("deadline") != lease["deadline"] or value.get("setupDeadline") != lease["setupDeadline"]
                or not 0 < value.get("maxPollSeconds", 999) <= 60 or value.get("readOnlyProbeSucceeded") is not True
                or (recovery_required and value.get("recoveryTestPassed") is not True)
                or not re.fullmatch(r"[a-f0-9]{64}", value.get("codeSha256", ""))
                or value.get("codeSha256") != sha256(HERE / "lambda_gpu_watchdog.py")
                or (recovery_required and not re.fullmatch(r"[a-f0-9]{64}", value.get("recoveryEvidenceSha256") or ""))
                or not 0 <= now - finite_number(value.get("verifiedAt"), "watchdog verification") <= 300
                or not re.fullmatch(r"arn:aws:lambda:[a-z0-9-]+:\d{12}:function:acephale-[a-z0-9-]+", value.get("hostId", ""))):
            raise ValueError("Missing, stale or incompatible live watchdog enrollment")
        hosts.add(value["hostId"])
        controllers.add(value.get("controllerId"))
        regions.add(value["hostId"].split(":")[3])
    if len(hosts) != 2 or len(controllers) != 2 or len(regions) != 2 or None in controllers:
        raise ValueError("Watchdogs must be separate controllers in separate regions")
    return values


def request_canary_termination(ledger_path: Path, lease_id: str) -> dict:
    with ledger_lock(ledger_path):
        ledger = checked_bound_ledger(ledger_path)
        lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
        if lease.get("purpose") != "cleanup_canary" or lease["reservedHours"] > 1 / 6 or lease["status"] != "active":
            raise ValueError("Only an active funded cleanup canary accepts this test trigger")
        lease["status"] = "termination_requested"
        atomic_json(ledger_path, ledger)
        return {"leaseId": lease_id, "status": lease["status"], "providerCalls": 0}


def observe_termination(client: Any, ledger_path: Path, lease_id: str) -> dict:
    with ledger_lock(ledger_path):
        ledger = checked_bound_ledger(ledger_path)
        lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
        if not lease["instanceId"]:
            raise ValueError("Known instance identity required for termination observation")
        instances = client.request("GET", "/instances")
        matches = [row for row in instances if row.get("id") == lease["instanceId"] or row.get("name") == lease["name"]]
        if matches and (len(matches) != 1 or matches[0].get("id") != lease["instanceId"]
                        or matches[0].get("name") != lease["name"] or matches[0].get("status") != "terminated"):
            raise ValueError("Provider has not verified exact-instance termination")
        lease["status"] = "terminated"
        lease["terminationVerifiedAt"] = time.time()
        lease["terminationEvidenceHash"] = digest(instances)
        atomic_json(ledger_path, ledger)
        return lease.copy()


def launch(client: Any, ledger_path: Path, lease_id: str, watchdog_receipt: Path,
           *, now: float | None = None, budget=study_budget) -> dict[str, Any]:
    current = time.time() if now is None else now
    with ledger_lock(ledger_path):
        ledger = checked_bound_ledger(ledger_path)
        plan = ledger["plan"]
        lease = next(item for item in ledger["leases"] if item["id"] == lease_id)
        if lease["status"] != "reserved" or not lease.get("studyReservation") or current >= lease["setupDeadline"]:
            raise ValueError("Only an unattempted, funded lease within setup window can launch")
        if any(item["id"] != lease_id and item["status"] != "terminated" for item in ledger["leases"]):
            raise ValueError("Another unresolved lease blocks launch")
        enrollments = watchdog_enrollments(watchdog_receipt, ledger, lease, current)
        access = checked_access_amendment(ledger, lease["accessAmendment"]) if "accessAmendment" in lease else plan
        if "accessAmendment" in lease:
            verify_access_key(client, access)
        current_quote = quote(client, plan["region"], current, plan["hardwareProfile"])
        if any(current_quote[key] != lease["quote"][key] for key in ("region", "instanceType", "imageId", "hardwareProfileHash")) or current_quote["hourlyUsd"] > lease["quote"]["hourlyUsd"]:
            raise ValueError("Provider quote changed after reservation; no launch attempted")
        validate_firewall(client, access["firewallRulesetId"], plan["region"])
        budget(plan, "inspect")
        lease["watchdogs"] = enrollments
        lease["status"] = "launching"
        atomic_json(ledger_path, ledger)
        try:
            result = client.request("POST", "/instance-operations/launch", {
                "region_name": plan["region"], "instance_type_name": current_quote["instanceType"],
                "ssh_key_names": [access["sshKeyName"]], "name": lease["name"], "image": {"id": current_quote["imageId"]},
                "firewall_rulesets": [{"id": access["firewallRulesetId"]}]})
            ids = result.get("instance_ids", [])
            if len(ids) != 1:
                raise RuntimeError("Ambiguous launch response")
            lease["instanceId"] = ids[0]
            lease["status"] = "active"
        except Exception:
            lease["status"] = "launch_unknown"
            atomic_json(ledger_path, ledger)
            raise
        atomic_json(ledger_path, ledger)
        return lease.copy()


def verify_export(root: Path, receipt: Path, expected_lease: str) -> dict[str, Any]:
    data = read_json(receipt)
    if data.get("leaseId") != expected_lease or not data.get("files"):
        raise ValueError("Export receipt does not cover this lease")
    base = root.resolve()
    seen = set()
    for item in data["files"]:
        path = (base / item["path"]).resolve()
        if path in seen or not path.is_relative_to(base) or not path.is_file():
            raise ValueError("Invalid exported artifact path")
        seen.add(path)
        if sha256(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise ValueError("Export content verification failed")
    return {"receiptSha256": sha256(receipt), "verifiedFiles": len(seen)}


def terminate(client: Any, ledger_path: Path, lease_id: str, export_root: Path | None = None,
              export_receipt: Path | None = None, emergency: bool = False) -> dict[str, Any]:
    with ledger_lock(ledger_path):
        ledger = read_json(ledger_path)
        lease = next(item for item in ledger["leases"] if item["id"] == lease_id)
        if lease["status"] == "terminated":
            return lease.copy()
        if not emergency:
            if export_root is None or export_receipt is None:
                raise ValueError("Normal cleanup requires a verified local export")
            lease["export"] = verify_export(export_root, export_receipt, lease_id)
        else:
            lease["emergencyTermination"] = True
        if not lease["instanceId"]:
            instances = client.request("GET", "/instances")
            matches = [item for item in instances if item.get("name") == lease["name"]]
            if len(matches) != 1:
                raise RuntimeError("Unresolved launch: identify the exact instance in provider console; reservation retained")
            lease["instanceId"] = matches[0]["id"]
        instance_id = lease["instanceId"]
        state = client.request("GET", "/instances/" + instance_id)
        if state.get("status") == "terminated":
            lease["status"] = "terminated"
            lease["terminationVerifiedAt"] = time.time()
            atomic_json(ledger_path, ledger)
            return lease.copy()
        lease["status"] = "termination_requested"
        atomic_json(ledger_path, ledger)
        client.request("POST", "/instance-operations/terminate", {"instance_ids": [instance_id]})
        state = client.request("GET", "/instances/" + instance_id)
        if state.get("status") == "terminated":
            lease["status"] = "terminated"
            lease["terminationVerifiedAt"] = time.time()
        atomic_json(ledger_path, ledger)
        return lease.copy()


def watchdog_tick(client: Any, ledger_path: Path, now: float | None = None) -> list[dict[str, Any]]:
    current = time.time() if now is None else now
    ledger = read_json(ledger_path)
    results = []
    for lease in ledger["leases"]:
        if lease["status"] == "terminated":
            continue
        deadline = lease["deadline"] if lease.get("ready") else min(lease["deadline"], lease["setupDeadline"])
        if current >= deadline or lease["status"] == "termination_requested":
            results.append(terminate(client, ledger_path, lease["id"], emergency=True))
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preflight_command = commands.add_parser("preflight")
    preflight_command.add_argument("--hardware-profile", default="a6000-48gb-v1")
    commands.add_parser("validate-config")
    download = commands.add_parser("download-models")
    download.add_argument("--root", type=Path, required=True)
    download.add_argument("--roles", nargs="+", choices=["actor", "predictor", "predictor_capacity_ablation"], default=["actor", "predictor"])
    lock = commands.add_parser("lock-images")
    lock.add_argument("--output", type=Path, required=True)
    render = commands.add_parser("locked-compose")
    render.add_argument("--lock", type=Path, required=True)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--hardware-profile")
    render.add_argument("--models-root", type=Path)
    render.add_argument("--predictor-export", type=Path)
    hardware_compose = commands.add_parser("serving-compose")
    hardware_compose.add_argument("--hardware-profile", required=True)
    hardware_compose.add_argument("--output", type=Path, required=True)
    training_probe = commands.add_parser("training-preflight")
    training_probe.add_argument("--hardware-profile", required=True)
    training_probe.add_argument("--output", type=Path, required=True)
    trainer = commands.add_parser("training-lease")
    trainer.add_argument("--ledger", type=Path, required=True)
    trainer.add_argument("--lease-id", required=True)
    trainer.add_argument("--preflight", type=Path, required=True)
    trainer.add_argument("--output", type=Path, required=True)
    trainer.add_argument("--hours", type=float, required=True)
    trainer.add_argument("--kind", choices=["fit", "smoke"], default="fit")
    state = commands.add_parser("watchdog-state")
    state.add_argument("--ledger", type=Path, required=True)
    state.add_argument("--lease-id", required=True)
    state.add_argument("--output", type=Path, required=True)
    identity = commands.add_parser("provider-receipt")
    identity.add_argument("--ledger", type=Path, required=True)
    identity.add_argument("--lease-id", required=True)
    identity.add_argument("--ssh-observation", type=Path, required=True)
    identity.add_argument("--output", type=Path, required=True)
    pricing = commands.add_parser("quote")
    pricing.add_argument("--region", required=True)
    pricing.add_argument("--output", type=Path, required=True)
    pricing.add_argument("--hardware-profile", required=True)
    initialize = commands.add_parser("init-ledger")
    initialize.add_argument("--ledger", type=Path, required=True)
    initialize.add_argument("--plan", type=Path, required=True)
    initialize.add_argument("--prior-gpu-hours", type=float, required=True)
    overhead = commands.add_parser("reserve-overhead")
    overhead.add_argument("--ledger", type=Path, required=True)
    overhead.add_argument("--reservation-id", required=True)
    overhead.add_argument("--maximum-usd", type=float, required=True)
    source_amendment = commands.add_parser("record-source-amendment")
    source_amendment.add_argument("--ledger", type=Path, required=True)
    source_amendment.add_argument("--output", type=Path, required=True)
    source_amendment.add_argument("--reason", required=True)
    source_amendment.add_argument("--readiness-evidence", type=Path, required=True)
    metadata_amendment = commands.add_parser("record-versions-metadata-amendment")
    metadata_amendment.add_argument("--ledger", type=Path, required=True)
    metadata_amendment.add_argument("--original-versions", type=Path, required=True)
    metadata_amendment.add_argument("--oci-evidence", type=Path, required=True)
    metadata_amendment.add_argument("--reason", required=True)
    access_amendment = commands.add_parser("record-access-amendment")
    access_amendment.add_argument("--ledger", type=Path, required=True)
    access_amendment.add_argument("--output", type=Path, required=True)
    access_amendment.add_argument("--ssh-key-name", required=True)
    access_amendment.add_argument("--firewall-ruleset-id", required=True)
    access_amendment.add_argument("--reason", required=True)
    prepare = commands.add_parser("prepare-lease")
    prepare.add_argument("--ledger", type=Path, required=True)
    prepare.add_argument("--hours", type=float, required=True)
    prepare.add_argument("--extra-allowance-usd", type=float, required=True)
    prepare.add_argument("--purpose", choices=["research", "cleanup_canary"], default="research")
    prepare.add_argument("--recovery-controller-id")
    prepare.add_argument("--access-amendment", type=Path)
    canary_stop = commands.add_parser("request-canary-termination")
    canary_stop.add_argument("--ledger", type=Path, required=True)
    canary_stop.add_argument("--lease-id", required=True)
    observe_stop = commands.add_parser("observe-termination")
    observe_stop.add_argument("--ledger", type=Path, required=True)
    observe_stop.add_argument("--lease-id", required=True)
    start = commands.add_parser("launch")
    start.add_argument("--ledger", type=Path, required=True)
    start.add_argument("--lease-id", required=True)
    start.add_argument("--watchdog-receipt", type=Path, required=True)
    ready = commands.add_parser("mark-ready")
    ready.add_argument("--ledger", type=Path, required=True)
    ready.add_argument("--lease-id", required=True)
    ready.add_argument("--smoke-receipt", type=Path, required=True)
    stop = commands.add_parser("terminate")
    stop.add_argument("--ledger", type=Path, required=True)
    stop.add_argument("--lease-id", required=True)
    stop.add_argument("--export-root", type=Path)
    stop.add_argument("--export-receipt", type=Path)
    stop.add_argument("--emergency", action="store_true")
    watchdog = commands.add_parser("watchdog")
    watchdog.add_argument("--ledger", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "preflight":
        value = preflight(args.hardware_profile)
    elif args.command == "validate-config":
        value = validate_config()
    elif args.command == "download-models":
        value = download_models(args.root, args.roles)
    elif args.command == "lock-images":
        value = lock_images(args.output)
    elif args.command == "locked-compose":
        value = locked_compose(args.lock, args.output, args.hardware_profile, args.models_root, args.predictor_export)
    elif args.command == "serving-compose":
        value = serving_compose(args.hardware_profile, args.output)
    elif args.command == "training-preflight":
        value = training_preflight(args.hardware_profile)
        write_new(args.output, value)
    elif args.command == "training-lease":
        value = training_lease(args.ledger, args.lease_id, args.preflight, args.output, args.hours, args.kind)
    elif args.command == "watchdog-state":
        value = watchdog_state(args.ledger, args.lease_id)
        atomic_json(args.output, value)
    elif args.command == "request-canary-termination":
        value = request_canary_termination(args.ledger, args.lease_id)
    elif args.command == "init-ledger":
        value = init_bound_ledger(args.ledger, load_plan(args.plan), args.prior_gpu_hours)
    elif args.command == "reserve-overhead":
        value = reserve_overhead(args.ledger, args.reservation_id, args.maximum_usd)
    elif args.command == "record-source-amendment":
        value = record_source_amendment(args.ledger, args.output, args.reason, args.readiness_evidence)
    elif args.command == "record-versions-metadata-amendment":
        artifact = record_versions_metadata_amendment(args.ledger, args.original_versions, args.oci_evidence, args.reason)
        value = {"path": str(versions_amendment_path(args.ledger)), "contentHash": artifact["contentHash"],
                 "originalVersionsSha256": artifact["originalVersionsSha256"], "effectiveVersionsSha256": artifact["effectiveVersionsSha256"],
                 "financialBindingChanged": False}
    elif args.command == "mark-ready":
        smoke = read_json(args.smoke_receipt)
        if smoke.get("profile") != PROFILE or smoke.get("leaseId") != args.lease_id or smoke.get("passed") is not True:
            raise ValueError("A passing smoke receipt for this lease is required")
        with ledger_lock(args.ledger):
            value = checked_bound_ledger(args.ledger)
            lease = next(item for item in value["leases"] if item["id"] == args.lease_id)
            if time.time() >= lease["setupDeadline"] or lease["status"] != "active":
                raise ValueError("Lease not active within setup window")
            if smoke.get("hardwareProfileHash") != lease["quote"]["hardwareProfileHash"]:
                raise ValueError("Smoke hardware identity differs from the funded profile")
            required = ({"pinnedModels", "driver", "actorStopped", "cudaTraining", "export", "watchdogRecovery"}
                        if smoke.get("purpose") == "predictor_training" else
                        {"pinnedModels", "pinnedImages", "driver", "concurrentModels", "toolParsing", "telemetry", "export", "watchdogRecovery"})
            if not required <= set(smoke.get("checks", {})) or any(smoke["checks"][name] is not True for name in required):
                raise ValueError("Actual smoke checks required for the declared serving or training purpose")
            lease["ready"] = True
            lease["smokeReceiptSha256"] = sha256(args.smoke_receipt)
            atomic_json(args.ledger, value)
    else:
        client = LambdaClient(os.environ.get("LAMBDA_API_KEY", ""))
        if args.command == "quote":
            value = quote(client, args.region, hardware=args.hardware_profile)
            write_new(args.output, value)
        elif args.command == "prepare-lease":
            value = prepare_lease(client, args.ledger, args.hours, args.extra_allowance_usd, purpose=args.purpose,
                                  recovery_controller_id=args.recovery_controller_id, access_amendment=args.access_amendment)
        elif args.command == "record-access-amendment":
            value = record_access_amendment(client, args.ledger, args.output, args.ssh_key_name, args.firewall_ruleset_id, args.reason)
        elif args.command == "provider-receipt":
            value = provider_receipt(client, args.ledger, args.lease_id, args.ssh_observation, args.output)
        elif args.command == "observe-termination":
            value = observe_termination(client, args.ledger, args.lease_id)
        elif args.command == "launch":
            value = launch(client, args.ledger, args.lease_id, args.watchdog_receipt)
        elif args.command == "terminate":
            value = terminate(client, args.ledger, args.lease_id, args.export_root, args.export_receipt, args.emergency)
        elif args.command == "watchdog":
            value = watchdog_tick(client, args.ledger)
        else:
            raise AssertionError("Unknown command")
    print(json.dumps(value, indent=2, allow_nan=False))
    return 2 if args.command == "preflight" and value["blockers"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from None
