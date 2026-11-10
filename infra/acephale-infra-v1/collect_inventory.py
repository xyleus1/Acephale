"""Collect observed deployment identity from a running Linux GPU host, without network calls.

Only local files, nvidia-smi, a local Docker socket, and read-only process probes
are used. This does not start services, load models, or establish smoke readiness.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import re
import subprocess
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from control import apply_hardware, apply_predictor_export, hardware_profile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
RECEIPT = "acephale-model.receipt.json"
CONTAINER = re.compile(r"[a-f0-9]{64}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
LOCKS = ("package-lock.json", "research/acephale/uv.lock", "research/acephale/benchmarks.lock.json")
INSPECT = ('{"id":{{json .Id}},"image":{{json .Image}},"requestedImage":{{json .Config.Image}},'
           '"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},'
           '"command":{{json .Config.Cmd}},"mounts":{{json .Mounts}}}')
PYTHON_PROBE = """
import importlib.metadata as m, json, platform
packages = sorted([{'name': d.metadata['Name'], 'version': d.version} for d in m.distributions()],
                  key=lambda r: (r['name'].lower(), r['version']))
print(json.dumps({'python': platform.python_version(), 'packages': packages}))
"""
SERVING_PROBE = """
import importlib.metadata as m, json, platform
from pathlib import Path
import torch
packages = sorted([{'name': d.metadata['Name'], 'version': d.version} for d in m.distributions()],
                  key=lambda r: (r['name'].lower(), r['version']))
cuda_file = Path('/usr/local/cuda/version.json')
cuda = json.loads(cuda_file.read_text()).get('cuda', {}).get('version') if cuda_file.is_file() else None
print(json.dumps({'python': platform.python_version(), 'packages': packages,
    'vllm': m.version('vllm'), 'torch': m.version('torch'), 'transformers': m.version('transformers'),
    'cuda': cuda or torch.version.cuda, 'torchCuda': torch.version.cuda}))
"""
NODE_PROBE = """
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const packages = [];
function scan(base) {
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base, {withFileTypes:true})) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(base, entry.name);
    if (entry.isSymbolicLink()) throw Error('Symlinked package is not supported by inventory');
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) { scan(target); continue; }
    const bytes = fs.readFileSync(path.join(target, 'package.json'));
    const item = JSON.parse(bytes);
    packages.push({path:target.replaceAll('\\\\','/'), name:item.name, version:item.version,
      packageJsonHash:crypto.createHash('sha256').update(bytes).digest('hex')});
    scan(path.join(target, 'node_modules'));
  }
}
scan('node_modules');
packages.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
if (!packages.length) throw Error('No installed Node packages');
console.log(JSON.stringify({node:process.versions.node, packages}));
"""


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def digest(value: Any) -> str:
    """SHA-256 of compact sorted-key UTF-8 JSON; all hash inputs are retained."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def record(path: Path, relative: str) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Inventory requires regular local files")
    return {"path": relative, "bytes": path.stat().st_size, "sha256": file_hash(path)}


def run_readonly(argv: list[str], cwd: Path) -> str:
    # Never invoke a shell. Do not echo stderr: a misconfigured process may log credentials.
    result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=120, check=False)
    if result.returncode:
        raise ValueError(f"Local inventory probe failed: {Path(argv[0]).name}")
    return result.stdout


def source_identity(source: Path, runner: Callable[[list[str], Path], str]) -> str:
    if runner(["git", "status", "--porcelain=v1", "--untracked-files=normal"], source).strip():
        raise ValueError("Collect inventory from a clean committed source checkout")
    commit = runner(["git", "rev-parse", "HEAD"], source).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Invalid source commit")
    return commit


def orchestrator_inventory(*, source: Path = ROOT, python: str = sys.executable, node: str = "node",
                           runner: Callable[[list[str], Path], str] = run_readonly) -> dict:
    """Observe the actual benchmark process environment; never touch the budget journal."""
    source = source.resolve()
    commit = source_identity(source, runner)
    host_python = json.loads(runner([python, "-B", "-c", PYTHON_PROBE], source))
    host_node = json.loads(runner([node, "-e", NODE_PROBE], source))
    if host_node.get("node") != "22.23.4" or not host_node.get("packages") or not host_python.get("packages"):
        raise ValueError("Missing installed benchmark packages or incorrect Node version")
    if not re.fullmatch(r"3\.12\.\d+", host_python.get("python", "")):
        raise ValueError("Native benchmark Python must be an observed 3.12 runtime")
    body = {"version": 1, "profile": "acephale-infra-v1", "kind": "observed_orchestrator_inventory",
            "observed": True, "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sourceCommit": commit, "sourcePinsContentHash": digest(read(HERE / "versions.json")),
            "platform": {"system": platform.system(), "machine": platform.machine()},
            "dependencyLocks": [record(source / name, name) for name in sorted(LOCKS)],
            "benchmarkPython": host_python, "benchmarkNode": host_node,
            "networkCalls": 0, "modelCalls": 0, "journalRead": False, "credentialsRead": False}
    return {**body, "contentHash": digest(body)}


def checked_orchestrator(value: dict, commit: str, versions: dict) -> dict:
    body = {key: item for key, item in value.items() if key != "contentHash"}
    if (value.get("version") != 1 or value.get("profile") != "acephale-infra-v1"
            or value.get("kind") != "observed_orchestrator_inventory" or value.get("observed") is not True
            or value.get("contentHash") != digest(body) or value.get("sourceCommit") != commit
            or value.get("sourcePinsContentHash") != digest(versions)):
        raise ValueError("Orchestrator receipt hash, clean source commit or model/runtime pins differ")
    if (value.get("benchmarkNode", {}).get("node") != "22.23.4"
            or not re.fullmatch(r"3\.12\.\d+", value.get("benchmarkPython", {}).get("python", ""))
            or not value["benchmarkNode"].get("packages") or not value["benchmarkPython"].get("packages")
            or value.get("platform", {}).get("system") not in {"Windows", "Linux", "Darwin"}
            or not value["platform"].get("machine")):
        raise ValueError("Orchestrator receipt lacks compatible observed process inventories")
    locks = value.get("dependencyLocks", [])
    if (not isinstance(locks, list) or [r.get("path") for r in locks] != sorted(LOCKS)
            or any(type(r.get("bytes")) is not int or r["bytes"] <= 0
                   or not SHA.fullmatch(r.get("sha256", "")) for r in locks)):
        raise ValueError("Orchestrator dependency-lock inventory is incomplete")
    return value


def model_identity(models: Path, role: str, pin: dict, context: tuple[int, int, int]) -> tuple[dict, dict]:
    root = models / pin["directory"]
    if root.is_symlink():
        raise ValueError("Model root cannot be a symlink")
    receipt_path = root / RECEIPT
    receipt = read(receipt_path)
    if (receipt.get("profile") != "acephale-infra-v1" or receipt.get("role") != role
            or any(receipt.get(key) != pin[key] for key in ("repository", "revision", "directory", "dtype"))):
        raise ValueError("Model download receipt does not match the pinned identity")
    rows = receipt.get("files", [])
    if not isinstance(rows, list) or not rows:
        raise ValueError("Empty model download receipt")
    verified, seen = [], set()
    for row in rows:
        name = row.get("path", "")
        relative = PurePosixPath(name)
        if (not name or "\\" in name or relative.is_absolute() or ".." in relative.parts
                or ".cache" in relative.parts or name in seen or name == RECEIPT
                or relative.as_posix() != name):
            raise ValueError("Unsafe or duplicate model receipt path")
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Model path leaves the verified root")
        actual = record(path, name)
        if actual != row:
            raise ValueError("Model content differs from the download receipt")
        seen.add(name)
        verified.append(actual)
    actual_names = set()
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if ".cache" in relative.parts or relative.as_posix() == RECEIPT:
            continue
        if path.is_symlink():
            raise ValueError("Symlinks are not permitted in the served model")
        if path.is_file():
            actual_names.add(relative.as_posix())
    if actual_names != seen:
        raise ValueError("Unreceipted files exist in the served model")
    verified.sort(key=lambda row: row["path"])
    weights = [r for r in verified if r["path"].endswith((".safetensors", ".safetensors.index.json"))
               or r["path"] == "config.json"]
    tokenizer_names = {"tokenizer.json", "tokenizer.model", "tokenizer_config.json", "vocab.json",
                       "merges.txt", "added_tokens.json", "special_tokens_map.json"}
    tokenizer = [r for r in verified if r["path"] in tokenizer_names]
    if ("config.json" not in seen or "tokenizer_config.json" not in seen
            or not any(r["path"].endswith(".safetensors") for r in weights)
            or not seen.intersection({"tokenizer.json", "tokenizer.model", "vocab.json"})):
        raise ValueError("Model weights, configuration or tokenizer files are incomplete")
    templates = [r for r in verified if r["path"] == "chat_template.jinja"
                 or (r["path"].startswith("chat_templates/") and r["path"].endswith(".jinja"))]
    template: Any = {"files": templates} if templates else {
        "tokenizerConfigChatTemplate": read(root / "tokenizer_config.json").get("chat_template")}
    if not templates and not isinstance(template["tokenizerConfigChatTemplate"], (str, list)):
        raise ValueError("No observed chat template in the pinned tokenizer")
    identity = {"repository": pin["repository"], "revision": pin["revision"], "servedModel": pin["repository"],
                "weightsHash": digest(weights), "tokenizerHash": digest(tokenizer),
                "chatTemplateHash": digest(template), "precision": pin["dtype"],
                "contextWindow": context[0], "inputBudget": context[1], "outputCap": context[2],
                "temperature": 0, "topP": 1, "thinking": False, "weightsFrozen": True}
    return identity, {"receiptSha256": file_hash(receipt_path), "files": verified,
                      "weightsHashInput": weights, "tokenizerHashInput": tokenizer,
                      "chatTemplateHashInput": template}


def aws_identity(receipt_path: Path, host_root: Path) -> tuple[dict, dict]:
    receipt = read(receipt_path)
    instances = [i for r in receipt.get("Reservations", []) for i in r.get("Instances", [])]
    host_id = (host_root / "sys/devices/virtual/dmi/id/board_asset_tag").read_text().strip()
    matches = [i for i in instances if i.get("InstanceId") == host_id]
    if len(matches) != 1 or not re.fullmatch(r"i-[a-f0-9]{8,17}", host_id):
        raise ValueError("AWS provider receipt does not identify this host's DMI instance ID")
    item = matches[0]
    if (item.get("State", {}).get("Name") != "running"
            or not re.fullmatch(r"ami-[a-f0-9]{8,17}", item.get("ImageId", ""))
            or not re.fullmatch(r"[a-z0-9]+\.[a-z0-9]+", item.get("InstanceType", ""))):
        raise ValueError("Incomplete running AWS instance evidence")
    return {"provider": "aws", "instanceType": item["InstanceType"], "imageId": item["ImageId"]}, {
        "receiptSha256": file_hash(receipt_path), "instanceId": host_id,
        "identityMethod": "DescribeInstances receipt matched to local DMI board_asset_tag"}


def lambda_identity(receipt_path: Path, host_root: Path, selected: dict) -> tuple[dict, dict]:
    receipt = read(receipt_path)
    item, ssh = receipt.get("instance", {}), receipt.get("ssh", {})
    body = {key: value for key, value in receipt.items() if key != "contentHash"}
    if (receipt.get("version") != 1 or receipt.get("profile") != "acephale-infra-v1" or receipt.get("provider") != "lambda"
            or receipt.get("contentHash") != digest(body) or receipt.get("providerResponseHash") != digest(item)
            or receipt.get("hardwareProfile") != selected["id"] or receipt.get("hardwareProfileHash") != digest(selected)
            or receipt.get("leaseName") != "acephale-infra-" + receipt.get("leaseId", "")
            or item.get("name") != receipt["leaseName"] or item.get("status") != "active"
            or item.get("instance_type", {}).get("name") != selected["instanceType"]
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", item.get("id", ""))
            or ssh.get("host") != item.get("ip") or ssh.get("port") != 22 or ssh.get("user") != "ubuntu"
            or not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", ssh.get("hostKeySha256", ""))
            or ssh.get("machineIdSha256") != file_hash(host_root / "etc/machine-id")
            or not SHA.fullmatch(receipt.get("studyBindingHash", "")) or not receipt.get("launchImageId")):
        raise ValueError("Lambda provider receipt does not match pinned SSH host identity and hardware")
    return {"provider": "lambda", "instanceType": selected["instanceType"], "imageId": receipt["launchImageId"]}, {
        "name": "lambda", "receiptSha256": file_hash(receipt_path), "instanceId": item["id"], "identityReceipt": receipt,
        "identityMethod": "Lambda API IP + pinned SSH host key + local machine-id"}


def gpu_inventory(text: str, processes: str, host_root: Path, minimum_driver: int, selected: dict | None = None) -> tuple[dict, dict]:
    rows = list(csv.reader(text.strip().splitlines(), skipinitialspace=True))
    if len(rows) != 1 or len(rows[0]) != 4:
        raise ValueError("The initial profile requires exactly one observed GPU")
    name, driver, memory, uuid = (part.strip() for part in rows[0])
    if not name or not uuid.startswith("GPU-") or not re.fullmatch(r"\d+(?:\.\d+)+", driver):
        raise ValueError("Incomplete NVIDIA GPU inventory")
    memory_bytes = int(memory) * 1024**2
    minimum_mib = selected["minimumGpuMemoryMiB"] if selected else 45_000
    if (int(driver.split(".")[0]) < minimum_driver or memory_bytes < minimum_mib * 1024**2
            or (selected and selected["gpuNameContains"] not in name)):
        raise ValueError("Driver or GPU memory is below the pinned 48 GB profile")
    allocations = []
    for row in csv.reader(processes.strip().splitlines(), skipinitialspace=True):
        if len(row) != 3 or row[1].strip() != uuid:
            raise ValueError("Incomplete NVIDIA process allocation")
        pid, used = int(row[0]), int(row[2])
        if pid <= 0 or used <= 0:
            raise ValueError("GPU process allocation is not resident")
        allocations.append({"pid": pid, "gpuUuid": uuid, "usedMemoryMiB": used})
    if not allocations:
        raise ValueError("No resident GPU process allocations")
    cpu_text = (host_root / "proc/cpuinfo").read_text()
    cpu = next((line.split(":", 1)[1].strip() for line in cpu_text.splitlines()
                if line.startswith("model name") and ":" in line), "")
    ram = re.search(r"^MemTotal:\s+(\d+) kB$", (host_root / "proc/meminfo").read_text(), re.MULTILINE)
    if not cpu or not ram or int(ram[1]) <= 0:
        raise ValueError("Incomplete local CPU/RAM inventory")
    hardware = {"gpu": name, "gpuCount": 1, "gpuMemoryBytes": memory_bytes, "driver": driver,
                "cpu": cpu, "ramBytes": int(ram[1]) * 1024}
    return hardware, {"gpuUuid": uuid, "allocations": allocations}


def collect(models: Path, images_lock: Path, provider_receipt: Path, *,
            source: Path = ROOT, host_root: Path = Path("/"), project: str = "acephale-infra-v1",
            python: str = sys.executable, node: str = "node",
            orchestrator_receipt: Path | None = None,
            hardware_profile_name: str | None = None,
            predictor_export: Path | None = None,
            runner: Callable[[list[str], Path], str] = run_readonly) -> tuple[dict, dict]:
    models, source = models.resolve(), source.resolve()
    versions, compose = read(HERE / "versions.json"), read(HERE / "compose.json")
    selected = hardware_profile(hardware_profile_name) if hardware_profile_name else None
    if selected:
        apply_hardware(compose, hardware_profile_name)
    trained = apply_predictor_export(compose, models, predictor_export) if predictor_export else None
    lock = read(images_lock)
    expected_image = versions["images"]["vllm"]
    locked = lock.get("images", {}).get("vllm", {})
    if (lock.get("profile") != versions["profile"] or locked.get("requested") != expected_image
            or locked.get("pinned") != expected_image
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", locked.get("imageId", ""))):
        raise ValueError("Missing or incompatible resolved vLLM image lock")
    actual_digests = json.loads(runner(DOCKER + ["image", "inspect", "--format", "{{json .RepoDigests}}",
                                               locked["imageId"]], source))
    if not any(isinstance(value, str) and value.endswith("@" + expected_image.split("@", 1)[1])
               for value in actual_digests):
        raise ValueError("Resident Docker image content digest differs from the immutable pin")
    commit = source_identity(source, runner)
    orchestrator = checked_orchestrator(
        read(orchestrator_receipt) if orchestrator_receipt else orchestrator_inventory(
            source=source, python=python, node=node, runner=runner), commit, versions)
    provider, provider_evidence = (lambda_identity(provider_receipt, host_root, selected)
                                  if read(provider_receipt).get("provider") == "lambda" and selected
                                  else aws_identity(provider_receipt, host_root))
    hardware, gpu_evidence = gpu_inventory(
        runner(["nvidia-smi", "--query-gpu=name,driver_version,memory.total,uuid", "--format=csv,noheader,nounits"], source),
        runner(["nvidia-smi", "--query-compute-apps=pid,gpu_uuid,used_gpu_memory", "--format=csv,noheader,nounits"], source),
        host_root, versions["minimumDriverMajor"], selected)
    identities, model_evidence, containers, serving = {}, {}, {}, {}
    for role, context in (("actor", (32768, 28672, 4096)), ("predictor", (8192, 7168, 1024))):
        if role == "predictor" and trained:
            artifact = trained["artifact"]
            identities[role] = {**artifact["base"], "servedModel": artifact["servedModel"], "weightsHash": artifact["mergedWeightsHash"],
                "tokenizerHash": artifact["tokenizerHash"], "chatTemplateHash": artifact["chatTemplateHash"], "trainedPredictor": artifact,
                "precision": versions["models"][role]["dtype"], "contextWindow": context[0], "inputBudget": context[1], "outputCap": context[2],
                "temperature": 0, "topP": 1, "thinking": False, "weightsFrozen": True}
            model_evidence[role] = trained
        else:
            identities[role], model_evidence[role] = model_identity(models, role, versions["models"][role], context)
        ids = runner(DOCKER + ["ps", "--no-trunc", "--filter", f"label=com.docker.compose.project={project}",
                               "--filter", f"label=com.docker.compose.service={role}", "--format", "{{.ID}}"], source).split()
        if len(ids) != 1 or not CONTAINER.fullmatch(ids[0]) or ids[0] in {c["id"] for c in containers.values()}:
            raise ValueError("Require one distinct running Compose container per model")
        container = json.loads(runner(DOCKER + ["inspect", "--format", INSPECT, ids[0]], source))
        mount = [m for m in container.get("mounts", []) if m.get("Destination") == "/models"]
        if (container.get("id") != ids[0] or container.get("running") is not True
                or container.get("image") != locked["imageId"] or container.get("requestedImage") != expected_image
                or container.get("command") != compose["services"][role]["command"]
                or len(mount) != 1 or mount[0].get("Type") != "bind" or mount[0].get("RW") is not False
                or Path(mount[0].get("Source", "")).resolve() != models):
            raise ValueError("Resident model container does not match the pinned image, command or read-only model root")
        pids = runner(DOCKER + ["top", ids[0], "-eo", "pid"], source).splitlines()[1:]
        pids = [int(pid.strip()) for pid in pids if pid.strip()]
        resident = [a for a in gpu_evidence["allocations"] if a["pid"] in pids]
        if not resident:
            raise ValueError("Both model containers must have resident NVIDIA allocations")
        packages = json.loads(runner(DOCKER + ["exec", "--env", "PYTHONDONTWRITEBYTECODE=1",
                                             ids[0], "python", "-B", "-c", SERVING_PROBE], source))
        if (packages.get("vllm") != "0.32.0" or packages.get("torch", "").split("+")[0] != versions["servingTorch"]
                or packages.get("cuda") != versions["servingCuda"] or not packages.get("transformers")
                or not packages.get("packages")):
            raise ValueError("Observed serving packages/CUDA do not match the pinned runtime")
        # Raw command/mount data is deliberately not persisted; it could contain unintended secrets.
        containers[role] = {"id": ids[0], "imageId": container["image"], "startedAt": container["startedAt"],
                            "commandHash": digest(container["command"]), "modelMountReadOnly": True,
                            "residentAllocations": resident}
        serving[role] = packages
    if serving["actor"] != serving["predictor"]:
        raise ValueError("Actor and predictor have different actual serving package inventories")
    host_python, host_node = orchestrator["benchmarkPython"], orchestrator["benchmarkNode"]
    # Hashing weights can take minutes. Do not attest containers that exited or
    # restarted while the observation was being assembled.
    final_hardware, final_gpu = gpu_inventory(
        runner(["nvidia-smi", "--query-gpu=name,driver_version,memory.total,uuid", "--format=csv,noheader,nounits"], source),
        runner(["nvidia-smi", "--query-compute-apps=pid,gpu_uuid,used_gpu_memory", "--format=csv,noheader,nounits"], source),
        host_root, versions["minimumDriverMajor"], selected)
    if final_hardware != hardware or final_gpu["gpuUuid"] != gpu_evidence["gpuUuid"]:
        raise ValueError("GPU hardware changed during inventory collection")
    for saved in containers.values():
        current = json.loads(runner(DOCKER + ["inspect", "--format", INSPECT, saved["id"]], source))
        if (current.get("running") is not True or current.get("startedAt") != saved["startedAt"]
                or current.get("image") != saved["imageId"]):
            raise ValueError("A model container changed during inventory collection")
        pids = runner(DOCKER + ["top", saved["id"], "-eo", "pid"], source).splitlines()[1:]
        resident_pids = {int(pid.strip()) for pid in pids if pid.strip()}
        resident = [a for a in final_gpu["allocations"] if a["pid"] in resident_pids]
        if not resident:
            raise ValueError("A model lost GPU residency during inventory collection")
        saved["residentAllocations"] = resident
    gpu_evidence = final_gpu
    locks = orchestrator["dependencyLocks"]
    package_inventory = {"serving": serving, "benchmarkPython": host_python, "benchmarkNode": host_node,
                         "benchmarkPlatform": orchestrator["platform"]}
    runtime = {"imageDigest": expected_image, "vllm": serving["actor"]["vllm"],
               "torch": serving["actor"]["torch"].split("+")[0], "cuda": serving["actor"]["cuda"],
               "transformers": serving["actor"]["transformers"], "node": host_node["node"],
               "python": host_python["python"], "dependencyLockHash": digest(locks),
               "packageInventoryHash": digest(package_inventory), "toolParser": "qwen3_xml"}
    evidence = {"version": 1, "profile": versions["profile"], "sourceCommit": commit,
                "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "hashAlgorithm": "sha256-compact-sorted-key-utf8-json-v1", "modelFiles": model_evidence,
                "provider": provider_evidence, "nvidia": gpu_evidence, "containers": containers,
                "dependencyLocks": locks, "packageInventory": package_inventory,
                "topology": "split-orchestrator-and-gpu-host" if orchestrator_receipt else "single-host",
                "orchestratorInventory": orchestrator,
                "orchestratorReceiptSha256": file_hash(orchestrator_receipt) if orchestrator_receipt else None,
                "imageLockSha256": file_hash(images_lock), "sourcePinsSha256": file_hash(HERE / "versions.json"),
                "hardwareProfile": selected, "hardwareProfileHash": digest(selected) if selected else None,
                "sourceComposeSha256": file_hash(HERE / "compose.json"),
                "networkCalls": 0, "modelCalls": 0, "smokeReadinessVerified": False,
                "requestSettings": "Pinned experiment policy, not an observed inference request"}
    deployment = {"version": 1, "observed": True, **identities, "runtime": runtime,
                  "hardware": {**provider, **hardware}, "evidenceHash": digest(evidence),
                  "sourceCommit": commit, "smokeReadinessVerified": False}
    return deployment, evidence


def write_inventory(output: Path, deployment: dict, evidence: dict) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    for name, value in (("observed-deployment.json", deployment), ("inventory-evidence.json", evidence)):
        with (output / name).open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
    return {"observedDeployment": str(output / "observed-deployment.json"),
            "evidenceHash": deployment["evidenceHash"], "modelCalls": 0, "networkCalls": 0,
            "smokeReadinessVerified": False}


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "orchestrator":
        parser = argparse.ArgumentParser(description="Observe local benchmark packages; no GPU, credentials or journal access")
        parser.add_argument("--output", type=Path, required=True)
        parser.add_argument("--python-executable", default=sys.executable)
        parser.add_argument("--node-executable", default="node")
        args = parser.parse_args(argv[1:])
        if args.output.exists():
            parser.error("Orchestrator inventory output must be a new file")
        value = orchestrator_inventory(python=args.python_executable, node=args.node_executable)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
        print(json.dumps({"orchestratorInventory": str(args.output), "contentHash": value["contentHash"],
                          "networkCalls": 0, "modelCalls": 0, "journalRead": False, "credentialsRead": False}))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("models-root", "images-lock", "provider-receipt", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--python-executable", default=sys.executable)
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--compose-project", default="acephale-infra-v1")
    parser.add_argument("--hardware-profile")
    parser.add_argument("--predictor-export", type=Path)
    parser.add_argument("--orchestrator-inventory", type=Path,
                        help="Observed receipt from the actual local benchmark host; avoids probing benchmark tools on this GPU host")
    args = parser.parse_args(argv)
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "AMD64"}:
        parser.error("Run this read-only collector on the actual Linux x86-64 GPU host")
    if args.output.exists():
        parser.error("Inventory output must be a new directory")
    deployment, evidence = collect(args.models_root, args.images_lock, args.provider_receipt,
                                   python=args.python_executable, node=args.node_executable,
                                   project=args.compose_project, orchestrator_receipt=args.orchestrator_inventory,
                                   hardware_profile_name=args.hardware_profile, predictor_export=args.predictor_export)
    print(json.dumps(write_inventory(args.output, deployment, evidence), indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(f"Observed inventory rejected: {error}", file=sys.stderr)
        raise SystemExit(2)
    except (OSError, subprocess.TimeoutExpired, KeyError, TypeError):
        # Detailed provider, package or Docker outputs are never copied to terminal logs.
        print("Observed inventory failed; no deployment readiness was asserted. Check the local host prerequisites.",
              file=sys.stderr)
        raise SystemExit(2)
