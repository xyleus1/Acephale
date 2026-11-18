"""CPU-only inspection of the exact serving image; no models or GPU qualification.

RepoDigest and installed source hashes are canonical. Docker's image ID is
recorded separately because backends can use different image representations.
The host needs Docker and 55 GiB free on Docker's storage filesystem before pull.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path

IMAGE = "vllm/vllm-openai@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34"
BUILD = "5df63a7203cdb9328d824a27b682e77c7b9928be"
SOURCE_HASHES = {
    "utils": "387444c1ca83d20e8a0f5c93d4886393a6040aab9f00c58086393670c24a6387",
    "kernel_utils": "31f0f3846633393c25d36c5b6fdd8513051d2318e3b75c2a53ee837b87333f17",
    "lora_shrink_op": "261e39f1831f2763691d746a8858ad5ed66d7a5fc9186fb361e9ab378324d113",
}
LABEL = "acephale.serving-image-preflight"
MIN_FREE_BYTES = 55 * 1024**3
PROBE = r"""
import hashlib, importlib.metadata, json, pathlib, shutil, sys
distribution = importlib.metadata.distribution('vllm')
console = pathlib.Path(shutil.which('vllm'))
paths = {name: pathlib.Path(distribution.locate_file('vllm/lora/ops/triton_ops/' + name + '.py'))
         for name in ('utils', 'kernel_utils', 'lora_shrink_op')}
devices = list(pathlib.Path('/dev').glob('nvidia*'))
assert not devices
assert console.is_file()
with console.open(encoding='utf-8') as stream:
    shebang = stream.readline().rstrip()
assert shebang.startswith('#!') and len(shebang) < 256
print(json.dumps({
    'executable': sys.executable,
    'resolvedExecutable': str(pathlib.Path(sys.executable).resolve()),
    'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
    'vllmExecutable': str(console), 'vllmShebang': shebang,
    'vllmVersion': distribution.version,
    'distributionLocation': str(distribution.locate_file('')),
    'nvidiaDeviceCount': len(devices),
    'installedSourceHashes': {name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for name, path in paths.items()},
}))
"""


class PreflightError(ValueError):
    """A fixed diagnostic message, with no subprocess output or environment."""


def require(condition, message):
    if not condition:
        raise PreflightError(message)


def save(path, value):
    data = (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()
    require(len(data) <= 32_768, "Metadata receipt exceeded its size bound")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)


def docker(args, *, timeout, source=None, capture=True):
    return subprocess.run(["docker", *args], input=source, text=True, encoding="utf-8",
                          errors="replace", stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.PIPE if capture else subprocess.DEVNULL, timeout=timeout)


def cleanup(session):
    """Only remove containers bearing this exact random session and name prefix."""
    selector = ["ps", "-aq", "--no-trunc", "--filter", f"label={LABEL}={session}"]
    observed = docker(selector, timeout=15)
    require(observed.returncode == 0, "Owned-container query failed")
    identifiers = observed.stdout.split()
    require(len(identifiers) <= 2, "Unexpected owned-container count")
    for identifier in identifiers:
        require(re.fullmatch(r"[0-9a-f]{64}", identifier), "Malformed owned-container identity")
        inspected = docker(["inspect", "--format",
                            '{"name":{{json .Name}},"labels":{{json .Config.Labels}}}', identifier], timeout=15)
        require(inspected.returncode == 0, "Owned-container inspection failed")
        value = json.loads(inspected.stdout)
        require(value["labels"].get(LABEL) == session
                and value["name"] in {f"/acephale-preflight-{session}-python", f"/acephale-preflight-{session}-python3"},
                "Container ownership differs")
        removed = docker(["rm", "-f", identifier], timeout=15)
        require(removed.returncode == 0, "Owned-container removal failed")
    final = docker(selector, timeout=15)
    require(final.returncode == 0 and not final.stdout.strip(), "Owned containers remain")
    return {"ownedContainersRemoved": len(identifiers), "noOwnedContainersRemain": True}


def inspect_image():
    result = docker(["image", "inspect", IMAGE], timeout=30)
    require(result.returncode == 0, "Immutable image inspection failed")
    rows = json.loads(result.stdout)
    require(len(rows) == 1, "Exactly one immutable image required")
    image = rows[0]
    labels = image["Config"].get("Labels") or {}
    require(IMAGE in image["RepoDigests"] and image["Os"] == "linux"
            and image["Architecture"] == "amd64" and image["Config"]["Entrypoint"] == ["vllm", "serve"]
            and labels.get("ai.vllm.build.commit") == BUILD
            and labels.get("org.opencontainers.image.revision") == BUILD,
            "Serving image identity differs from the retained study")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image["Id"]), "Malformed observed image ID")
    return {"repoDigest": IMAGE, "imageId": image["Id"], "architecture": "amd64", "os": "linux",
            "entrypoint": ["vllm", "serve"], "buildCommit": BUILD, "revision": BUILD,
            "imageIdEqualityToRepoDigestRequired": False, "identityVerified": True}


def probe(session, receipt):
    receipt["stage"] = "disk_preflight"
    storage = docker(["info", "--format", "{{.DockerRootDir}}"], timeout=30)
    require(storage.returncode == 0, "Docker storage inspection failed")
    root = Path(storage.stdout.strip())
    require(root.is_absolute() and root.is_dir(), "Docker storage directory unavailable")
    free = shutil.disk_usage(root).free
    receipt["disk"] = {"freeBytesBeforePull": free, "minimumRequiredBytes": MIN_FREE_BYTES,
                       "sufficient": free >= MIN_FREE_BYTES}
    require(free >= MIN_FREE_BYTES, "Insufficient Docker storage: 55 GiB required before pull")
    receipt["stage"] = "image_pull"
    started = time.monotonic()
    pulled = docker(["pull", "--platform", "linux/amd64", IMAGE], timeout=1080, capture=False)
    receipt["pull"] = {"exitCode": pulled.returncode, "durationSeconds": round(time.monotonic() - started, 3)}
    require(pulled.returncode == 0, "Immutable image pull failed")
    receipt["stage"] = "image_identity"
    receipt["image"] = inspect_image()
    base = ["run", "--rm", "--network", "none", "--read-only", "--runtime", "runc",
            "--pids-limit", "128", "--memory", "5g", "--cpus", "2",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--tmpfs", "/tmp:rw,nosuid,noexec,size=256m",
            "--label", f"{LABEL}={session}", "-e", "PYTHONDONTWRITEBYTECODE=1"]
    receipt["stage"] = "original_python"
    original = docker([*base, "--name", f"acephale-preflight-{session}-python", "--entrypoint", "python",
                       IMAGE, "-c", "import sys; print(sys.executable)"], timeout=90)
    lookup_failure = "executable file not found" in original.stderr and "python" in original.stderr
    receipt["originalPython"] = {"exitCode": original.returncode, "commandLookupFailureReported": lookup_failure}
    require(original.returncode == 127 and lookup_failure, "Original python command failure differs")
    receipt["stage"] = "python3_metadata"
    observed = docker([*base, "--name", f"acephale-preflight-{session}-python3", "-i",
                       "--entrypoint", "python3", IMAGE, "-"], source=PROBE, timeout=120)
    require(observed.returncode == 0, "Python3 metadata probe failed")
    value = json.loads(observed.stdout)
    require(set(value) == {"executable", "resolvedExecutable", "pythonVersion", "vllmExecutable",
                           "vllmShebang", "vllmVersion", "distributionLocation",
                           "nvidiaDeviceCount", "installedSourceHashes"}
            and value["installedSourceHashes"] == SOURCE_HASHES and value["nvidiaDeviceCount"] == 0,
            "Installed source or CPU isolation differs")
    receipt["python3"] = value
    receipt["installedSourcesMatch"] = True
    receipt["stage"] = "completed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    require(not args.output.exists(), "Receipt destination must be new")
    if args.cleanup:
        owner = json.loads(args.owner.read_text(encoding="utf-8"))
        require(owner.get("kind") == "acephale-serving-image-preflight-owner-v1"
                and owner.get("image") == IMAGE and re.fullmatch(r"[0-9a-f]{32}", owner["session"]),
                "Exact probe owner required")
        save(args.output, {"kind": "acephale-serving-image-preflight-cleanup-v1", **cleanup(owner["session"])})
        return
    session = uuid.uuid4().hex
    save(args.owner, {"kind": "acephale-serving-image-preflight-owner-v1", "session": session, "image": IMAGE})
    receipt = {"kind": "acephale-serving-image-cpu-preflight-v1", "passed": False,
               "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "gpuKernelOrNumericalParityTest": False, "resolverSelectionTestPerformed": False,
               "modelWeightsLoaded": False, "modelMounts": False, "gpuDevicesRequested": False,
               "containerNetwork": "none", "containerReadOnly": True, "runtime": "runc"}
    error = None

    def cancelled(_signum, _frame):
        raise InterruptedError("Preflight cancelled")

    signal.signal(signal.SIGTERM, cancelled)
    try:
        probe(session, receipt)
        receipt["passed"] = True
    except BaseException as failure:
        error = failure
        receipt["failureType"] = type(failure).__name__
        if isinstance(failure, PreflightError):
            receipt["failureReason"] = str(failure)
    finally:
        try:
            receipt["cleanup"] = cleanup(session)
        except BaseException as failure:
            receipt["passed"] = False
            receipt["cleanup"] = {"noOwnedContainersRemain": False, "failureType": type(failure).__name__}
            if isinstance(failure, PreflightError):
                receipt["cleanup"]["failureReason"] = str(failure)
            error = error or failure
        save(args.output, receipt)
    print(json.dumps({"passed": receipt["passed"], "stage": receipt.get("stage"),
                      "failureReason": receipt.get("failureReason"),
                      "metadataBytes": args.output.stat().st_size,
                      "noOwnedContainersRemain": receipt["cleanup"]["noOwnedContainersRemain"]}))
    if error is not None:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
