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
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

HERE = Path(__file__).resolve().parent
API = "https://cloud.lambda.com/api/v1"
PROFILE = "acephale-infra-v1"


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


def preflight() -> dict[str, Any]:
    """Inspect program availability and credential presence, never their values."""
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
                    if not rows or max(float(row[2]) for row in rows) < 46000:
                        blockers.append("gpu_memory_below_48gb_profile")
            except (OSError, subprocess.TimeoutExpired, ValueError):
                commands[name] = {"ok": False}
                blockers.append(f"failed_{name}")
    return {"profile": PROFILE, "platform": platform.system(), "python": platform.python_version(),
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


def locked_compose(lock_path: Path, output: Path) -> dict[str, Any]:
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
            headers={"Authorization": "Bearer " + self._key, "Content-Type": "application/json", "Accept": "application/json"})
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


def quote(client: Any, region: str, now: float | None = None) -> dict[str, Any]:
    kinds = client.request("GET", "/instance-types")
    item = kinds.get("gpu_1x_a6000")
    if not item or region not in {value["name"] for value in item["regions_with_capacity"]}:
        raise ValueError("Requested A6000 region has no reported capacity")
    instance_type = item["instance_type"]
    cents = finite_number(instance_type["price_cents_per_hour"], "price", 1)
    if instance_type["specs"]["gpus"] != 1 or instance_type.get("architecture", "x86_64") != "x86_64":
        raise ValueError("Unexpected hardware shape")
    if cents > 125:
        raise ValueError("Current quote exceeds $1.25/hour")
    images = client.request("GET", "/images")
    compatible = [image for image in images if image["family"] == "gpu-base-24-04" and image["architecture"] == "x86_64" and image["region"]["name"] == region]
    if not compatible:
        raise ValueError("Required GPU Base 24.04 image unavailable")
    image = max(compatible, key=lambda value: (value["created_time"], value["id"]))
    return {"profile": PROFILE, "quotedAt": time.time() if now is None else now, "region": region,
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


def reserve_lease(ledger: dict[str, Any], current_quote: dict[str, Any], hours: float, extra_allowance_usd: float,
                  now: float) -> dict[str, Any]:
    hours = finite_number(hours, "session hours", 0.01)
    allowance = finite_number(extra_allowance_usd, "tax/storage/export allowance", 1)
    rate = finite_number(current_quote["hourlyUsd"], "hourly quote", 0.01)
    quoted_at = finite_number(current_quote["quotedAt"], "quote timestamp")
    if not 0 <= now - quoted_at <= 300 or rate > 1.25 or hours > 8:
        raise ValueError("Expired quote, excessive rate, or session longer than eight hours")
    if current_quote["instanceType"] != "gpu_1x_a6000" or current_quote["imageFamily"] != "gpu-base-24-04":
        raise ValueError("Unapproved instance or image")
    leases = ledger["leases"]
    if any(lease["status"] != "terminated" for lease in leases):
        raise ValueError("Another lease is active or unresolved")
    used_hours = ledger["priorGpuHours"] + sum(lease["reservedHours"] for lease in leases)
    reserved = ledger["priorInfraUsd"] + sum(lease["reservedUsd"] for lease in leases)
    cost = round(rate * hours + allowance, 6)
    if used_hours + hours > 24 or reserved + cost > 35:
        raise ValueError("Cumulative infrastructure allocation exceeded")
    # Do not release reservations after termination without invoice reconciliation.
    return {"id": uuid.uuid4().hex, "status": "reserved", "quote": current_quote,
            "reservedAt": now, "deadline": now + hours * 3600,
            "setupDeadline": now + 1800, "reservedHours": hours,
            "reservedUsd": cost, "instanceId": None, "ready": False}


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


def launch(client: Any, ledger_path: Path, region: str, ssh_key_name: str, hours: float,
           extra_allowance_usd: float, watchdog_receipt: Path, now: float | None = None,
           firewall_ruleset_id: str | None = None) -> dict[str, Any]:
    current = time.time() if now is None else now
    watchdog = read_json(watchdog_receipt)
    if watchdog.get("profile") != PROFILE or watchdog.get("controllerKind") != "independent_always_on" or watchdog.get("maxPollSeconds", 999) > 60:
        raise ValueError("Independent always-on watchdog enrollment is required")
    if not 0 <= current - finite_number(watchdog.get("verifiedAt"), "watchdog verification") <= 300:
        raise ValueError("Watchdog enrollment is stale")
    if watchdog.get("ledgerPath") != str(ledger_path.resolve()):
        raise ValueError("Watchdog is not enrolled for this ledger")
    with ledger_lock(ledger_path):
        ledger = read_json(ledger_path)
        current_quote = quote(client, region, current)
        validate_firewall(client, firewall_ruleset_id or "", region)
        lease = reserve_lease(ledger, current_quote, hours, extra_allowance_usd, current)
        lease["name"] = "acephale-infra-" + lease["id"]
        ledger["leases"].append(lease)
        atomic_json(ledger_path, ledger)
        # Exactly one launch attempt. An uncertain response is not retried.
        lease["status"] = "launching"
        atomic_json(ledger_path, ledger)
        try:
            result = client.request("POST", "/instance-operations/launch", {
                "region_name": region, "instance_type_name": "gpu_1x_a6000", "ssh_key_names": [ssh_key_name],
                "name": lease["name"], "image": {"id": current_quote["imageId"]},
                "firewall_rulesets": [{"id": firewall_ruleset_id}]})
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
    commands.add_parser("preflight")
    commands.add_parser("validate-config")
    download = commands.add_parser("download-models")
    download.add_argument("--root", type=Path, required=True)
    download.add_argument("--roles", nargs="+", choices=["actor", "predictor", "predictor_capacity_ablation"], default=["actor", "predictor"])
    lock = commands.add_parser("lock-images")
    lock.add_argument("--output", type=Path, required=True)
    render = commands.add_parser("locked-compose")
    render.add_argument("--lock", type=Path, required=True)
    render.add_argument("--output", type=Path, required=True)
    pricing = commands.add_parser("quote")
    pricing.add_argument("--region", required=True)
    pricing.add_argument("--output", type=Path, required=True)
    initialize = commands.add_parser("init-ledger")
    initialize.add_argument("--ledger", type=Path, required=True)
    initialize.add_argument("--overall-reserved-usd", type=float, required=True)
    initialize.add_argument("--prior-infra-usd", type=float, required=True)
    initialize.add_argument("--prior-gpu-hours", type=float, required=True)
    start = commands.add_parser("launch")
    start.add_argument("--ledger", type=Path, required=True)
    start.add_argument("--region", required=True)
    start.add_argument("--ssh-key-name", required=True)
    start.add_argument("--hours", type=float, required=True)
    start.add_argument("--extra-allowance-usd", type=float, required=True)
    start.add_argument("--watchdog-receipt", type=Path, required=True)
    start.add_argument("--firewall-ruleset-id", required=True)
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
        value = preflight()
    elif args.command == "validate-config":
        value = validate_config()
    elif args.command == "download-models":
        value = download_models(args.root, args.roles)
    elif args.command == "lock-images":
        value = lock_images(args.output)
    elif args.command == "locked-compose":
        value = locked_compose(args.lock, args.output)
    elif args.command == "init-ledger":
        value = init_ledger(args.ledger, args.overall_reserved_usd, args.prior_infra_usd, args.prior_gpu_hours)
    elif args.command == "mark-ready":
        smoke = read_json(args.smoke_receipt)
        if smoke.get("profile") != PROFILE or smoke.get("leaseId") != args.lease_id or smoke.get("passed") is not True:
            raise ValueError("A passing smoke receipt for this lease is required")
        with ledger_lock(args.ledger):
            value = read_json(args.ledger)
            lease = next(item for item in value["leases"] if item["id"] == args.lease_id)
            if time.time() >= lease["setupDeadline"] or lease["status"] != "active":
                raise ValueError("Lease not active within setup window")
            lease["ready"] = True
            lease["smokeReceiptSha256"] = sha256(args.smoke_receipt)
            atomic_json(args.ledger, value)
    else:
        client = LambdaClient(os.environ.get("LAMBDA_API_KEY", ""))
        if args.command == "quote":
            value = quote(client, args.region)
            write_new(args.output, value)
        elif args.command == "launch":
            value = launch(client, args.ledger, args.region, args.ssh_key_name, args.hours, args.extra_allowance_usd, args.watchdog_receipt, firewall_ruleset_id=args.firewall_ruleset_id)
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
