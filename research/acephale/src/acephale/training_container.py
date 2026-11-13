"""Build and launch the isolated trainer using an observed Docker image receipt."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.storage import file_hash
from acephale.training import validate_training_lease
from acephale.training_data import hashed, training_recipe, verify_hashed, write_new

DOCKERFILE = "infra/acephale-infra-v1/trainer.Dockerfile"
LABEL = "org.acephale.training-inputs"
CACHE_ENVIRONMENT = {
    "HOME": "/output/home",
    "XDG_CACHE_HOME": "/output/cache/xdg",
    "HF_HOME": "/output/cache/huggingface",
    "HF_HUB_CACHE": "/output/cache/huggingface/hub",
    "HF_DATASETS_CACHE": "/output/cache/huggingface/datasets",
    "TORCH_HOME": "/output/cache/torch",
    "TORCHINDUCTOR_CACHE_DIR": "/output/cache/torchinductor",
    "TRITON_CACHE_DIR": "/output/cache/triton",
}


def writable_environment(output: Path) -> dict[str, str]:
    """Keep host-UID home and library caches in this run's retained output."""
    for value in CACHE_ENVIRONMENT.values():
        path = output.joinpath(*value.removeprefix("/output/").split("/"))
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        # A real write checks ACLs as well as ownership/mode; remove only this probe.
        probe = path / (".write-probe-" + uuid.uuid4().hex)
        with probe.open("xb") as stream:
            stream.write(b"cache preflight\n")
        probe.unlink()
    return dict(CACHE_ENVIRONMENT)


def checked(command: list[str], *, timeout: float = 30) -> str:
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{Path(command[0]).name} command failed with exit {result.returncode}")
    return result.stdout


def build_inputs(source: Path) -> list[dict]:
    names = {DOCKERFILE, "infra/acephale-infra-v1/trainer-system-packages.txt", ".dockerignore", "research/acephale/pyproject.toml", "research/acephale/training/pyproject.toml",
             "research/acephale/training/uv.lock"}
    for root in (source / "research/acephale/src", source / "src/lib/acephale/contracts"):
        names.update(path.relative_to(source).as_posix() for path in root.rglob("*") if path.is_file() and "__pycache__" not in path.parts)
    result = []
    for name in sorted(names):
        path = source / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Training build requires regular source files")
        result.append({"path": name, "sha256": file_hash(path), "bytes": path.stat().st_size})
    return result


def build(source: Path, output: Path) -> dict:
    source = source.resolve()
    if checked(["git", "-C", str(source), "status", "--porcelain=v1", "--untracked-files=normal"]).strip():
        raise ValueError("Trainer image must be built from a clean committed checkout")
    commit = checked(["git", "-C", str(source), "rev-parse", "HEAD"]).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Exact source commit required")
    inputs = build_inputs(source)
    output.mkdir(parents=True, exist_ok=False)
    command = ["docker", "build", "--file", str(source / DOCKERFILE), "--iidfile", str(output / "image.id"),
               "--label", f"{LABEL}={hash_v1(inputs)}", str(source)]
    with (output / "build.log").open("x", encoding="utf-8") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False, timeout=1800)
    if result.returncode:
        raise RuntimeError("Training image build failed; retained build.log")
    image_id = (output / "image.id").read_text().strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
        raise ValueError("Docker did not emit an immutable image identity")
    image = json.loads(checked(["docker", "image", "inspect", image_id]))[0]
    if image.get("Id") != image_id or image.get("Config", {}).get("Labels", {}).get(LABEL) != hash_v1(inputs):
        raise ValueError("Built image identity differs from observed source inputs")
    receipt = hashed({"schemaVersion": 1, "kind": "acephale-training-image", "sourceCommit": commit,
                      "imageId": image_id, "inputs": inputs, "inputHash": hash_v1(inputs), "imageInventory": image})
    write_new(output / "image-receipt.json", receipt)
    return receipt


def verify_image(receipt: dict, observed: dict) -> str:
    verify_hashed(receipt)
    image_id = receipt.get("imageId", "")
    if (receipt.get("kind") != "acephale-training-image" or not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)
            or receipt.get("inputHash") != hash_v1(receipt.get("inputs"))
            or observed.get("Id") != image_id or observed.get("Config", {}).get("Labels", {}).get(LABEL) != receipt["inputHash"]
            or observed != receipt.get("imageInventory")):
        raise ValueError("Observed Docker image differs from the immutable build receipt")
    return image_id


def run(args) -> dict:
    recipe = training_recipe(micro_batch=getattr(args, "micro_batch", 1),
                             gradient_accumulation=getattr(args, "gradient_accumulation", 16))
    if os.name != "posix" or os.getuid() == 0:
        raise ValueError("Run the trainer as the ordinary Linux host operator")
    if not re.fullmatch(r"[a-f0-9]{64}", args.actor_container):
        raise ValueError("Actual full actor container identity required")
    lease = validate_training_lease(args.lease)
    receipt = json.loads(args.receipt.read_text(encoding="utf-8"))
    image_id = verify_image(receipt, json.loads(checked(["docker", "image", "inspect", receipt["imageId"]]))[0])
    actor = json.loads(checked(["docker", "container", "inspect", args.actor_container]))[0]
    if actor.get("Id") != args.actor_container or actor.get("State", {}).get("Running") is not False:
        raise ValueError("Actor container must actually be stopped before training")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    environment = writable_environment(output)
    name = "acephale-train-" + uuid.uuid4().hex
    command = ["docker", "run", "--rm", "--init", "--name", name, "--gpus", "all", "--network", "none",
               "--user", f"{os.getuid()}:{os.getgid()}", "--stop-timeout", "30",
               "--env", "ACEPHALE_TRAINER_IMAGE_DIGEST=" + image_id]
    for key, value in environment.items():
        command.extend(["--env", key + "=" + value])
    trained_evaluation = args.action == "evaluate" and (args.model.parent / "predictor.json").is_file()
    model_mount, model_target = (args.model.parent, "/trained-export") if trained_evaluation else (args.model, "/model")
    model_argument = "/trained-export/" + args.model.name if trained_evaluation else "/model"
    mounts = [(args.dataset, "/dataset", True), (model_mount, model_target, True), (args.lease, "/lease.json", True), (output, "/output", False)]
    if args.training_run:
        mounts.append((args.training_run, "/training-run", True))
    for path, target, readonly in mounts:
        resolved = path.resolve()
        if not resolved.exists() or "," in str(resolved):
            raise ValueError("Existing unambiguous bind-mount path required")
        command.extend(["--mount", f"type=bind,src={resolved},dst={target}" + (",readonly" if readonly else "")])
    command.extend([image_id, args.action, "--dataset", "/dataset", "--model", model_argument, "--lease", "/lease.json", "--output", "/output/artifacts"])
    if args.action == "train":
        command.extend(["--seed", str(args.seed), "--max-steps", str(args.max_steps), "--maximum-seconds", str(args.maximum_seconds)])
        command.extend(["--micro-batch", str(recipe["microBatch"]), "--gradient-accumulation", str(recipe["gradientAccumulation"])])
    if args.action == "export":
        if not args.training_run:
            raise ValueError("Export needs the completed --training-run directory")
        command.extend(["--run", "/training-run"])
    if args.action == "evaluate":
        command.extend(["--partition", args.partition])
    write_new(output / "launch.json", hashed({"imageReceiptHash": receipt["contentHash"], "imageId": image_id,
              "leaseHash": hash_v1(lease), "actorContainer": args.actor_container, "action": args.action, "containerName": name,
              "environment": environment, "launcherSourceHash": file_hash(Path(__file__))}))
    process = None
    next_actor_check = 0.0
    try:
        with (output / "container.log").open("x", encoding="utf-8") as log:
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
            while process.poll() is None:
                if validate_training_lease(args.lease) != lease:
                    raise ValueError("Host training lease changed")
                if time.monotonic() >= next_actor_check:
                    actor = json.loads(checked(["docker", "container", "inspect", args.actor_container], timeout=5))[0]
                    if actor.get("Id") != args.actor_container or actor.get("State", {}).get("Running") is not False:
                        raise ValueError("Actor restarted during predictor training")
                    next_actor_check = time.monotonic() + 5
                time.sleep(1)
        if process.returncode:
            raise RuntimeError(f"Training container failed with exit {process.returncode}; retained container.log")
        result = {"status": "completed", "imageId": image_id, "artifacts": str(output / "artifacts")}
        write_new(output / "completion.json", result)
        return result
    finally:
        # The provider watchdog remains independent; local failures also drain this container.
        subprocess.run(["docker", "stop", "--time", "30", name], capture_output=True, check=False, timeout=40)
        if process and process.poll() is None:
            process.wait(timeout=45)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build")
    make.add_argument("--source", type=Path, required=True)
    make.add_argument("--output", type=Path, required=True)
    launch = commands.add_parser("run")
    for name in ("receipt", "dataset", "model", "lease", "output"):
        launch.add_argument(f"--{name}", type=Path, required=True)
    launch.add_argument("--actor-container", required=True)
    launch.add_argument("--action", choices=["smoke", "train", "export", "evaluate"], required=True)
    launch.add_argument("--training-run", type=Path)
    launch.add_argument("--seed", type=int, choices=[17, 29], default=17)
    launch.add_argument("--max-steps", type=int, default=500)
    launch.add_argument("--maximum-seconds", type=int, default=3600)
    launch.add_argument("--micro-batch", type=int, choices=[1, 2, 4], default=1)
    launch.add_argument("--gradient-accumulation", type=int, choices=[4, 8, 16], default=16)
    launch.add_argument("--partition", choices=["calibration", "development", "test"], default="development")
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output) if args.command == "build" else run(args), indent=2))


if __name__ == "__main__":
    main()
