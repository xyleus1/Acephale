"""Run declared experiment commands with immutable inputs and verified stage receipts.

This command does not provision resources or grant a budget. Existing collection,
training and replay commands retain their own authorization and budget checks.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import stat
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from acephale.contracts_v1 import hash_v1
from acephale.storage import file_hash
from acephale.training_data import file_inventory, hashed, verify_dataset, verify_hashed, write_new


class FrozenFile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ArtifactCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    kind: Literal["json", "hashed_json", "training_dataset", "training_export"]
    expected: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid(self):
        if self.kind in {"json", "hashed_json"} and not self.expected:
            raise ValueError("JSON output checks must declare successful result fields")
        return self


class Stage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    command: list[str] = Field(min_length=1)
    timeoutSeconds: int = Field(ge=1, le=28800)
    artifacts: list[ArtifactCheck] = Field(min_length=1)
    containerReceipt: str | None = None
    containerImage: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid(self):
        if any(not word or "\x00" in word for word in self.command):
            raise ValueError("Stage command must contain nonempty argv entries")
        if bool(self.containerReceipt) != bool(self.containerImage):
            raise ValueError("Container cleanup needs its receipt path and exact image")
        return self


class Experiment(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal[1]
    kind: Literal["acephale-experiment"]
    experimentId: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$")
    source: str
    sourceCommit: str = Field(pattern=r"^[a-f0-9]{40}$")
    inputs: dict[str, FrozenFile] = Field(min_length=1)
    stages: list[Stage] = Field(min_length=1)
    deadline: float = Field(gt=0, allow_inf_nan=False)
    maximumSeconds: int = Field(ge=1, le=28800)

    @model_validator(mode="after")
    def valid(self):
        if len({stage.id for stage in self.stages}) != len(self.stages):
            raise ValueError("Stage IDs must be unique")
        if any(not re.fullmatch(r"[a-zA-Z0-9_-]+", name) for name in self.inputs):
            raise ValueError("Input names must be identifiers")
        return self


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def child_path(root: Path, relative: str) -> Path:
    path = root / relative
    if Path(relative).is_absolute() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Artifact path must stay inside its stage")
    for parent in path.parents:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError("Artifact path cannot traverse a symlink")
    return path


def checked(command: list[str], *, timeout: float = 30) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{Path(command[0]).name} exited {result.returncode}")
    return result.stdout


def verify_source(source: Path, commit: str) -> None:
    if checked(["git", "-C", str(source), "rev-parse", "HEAD"]).strip() != commit:
        raise ValueError("Experiment source commit changed")
    if checked(["git", "-C", str(source), "status", "--porcelain=v1", "--untracked-files=normal"]).strip():
        raise ValueError("Experiment requires a clean committed source tree")


def input_metadata(inputs: dict[str, Path]) -> dict[str, tuple[int, ...]]:
    """Cheap change detection, not a substitute for boundary hash verification."""
    result = {}
    for name, path in inputs.items():
        try:
            metadata = path.lstat()
        except OSError as error:
            raise ValueError(f"Frozen input changed: {name}") from error
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"Frozen input changed: {name}")
        result[name] = (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_size,
                        metadata.st_mtime_ns, metadata.st_ctime_ns)
    return result


def verify_inputs(inputs: dict[str, Path], manifest: Experiment) -> dict[str, tuple[int, ...]]:
    before = input_metadata(inputs)
    for name, path in inputs.items():
        if file_hash(path) != manifest.inputs[name].sha256:
            raise ValueError(f"Frozen input changed: {name}")
    if input_metadata(inputs) != before:
        raise ValueError("Frozen input changed during hash verification")
    return before


def verify_artifacts(root: Path, checks: list[ArtifactCheck]) -> list[dict[str, Any]]:
    result = []
    for check in checks:
        path = child_path(root, check.path)
        if check.kind == "training_dataset":
            value = verify_dataset(path)
        elif check.kind == "training_export":
            from acephale.training import verify_export

            value = verify_export(path)
        else:
            value = read_json(path)
            if check.kind == "hashed_json":
                verify_hashed(value)
        if not isinstance(value, dict) or any(key not in value or hash_v1(value[key]) != hash_v1(expected) for key, expected in check.expected.items()):
            raise ValueError(f"Artifact does not satisfy its declared result: {check.path}")
        inventory = file_inventory(path) if path.is_dir() else [
            {"path": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path)}]
        result.append({"path": check.path, "kind": check.kind, "inventory": inventory})
    return result


def expand_command(stage: Stage, source: Path, inputs: dict[str, Path], completed: dict[str, Path], output: Path) -> list[str]:
    values = {"source": source, "output": output, **{f"input:{key}": path for key, path in inputs.items()},
              **{f"stage:{key}": path for key, path in completed.items()}}

    def replace(match):
        name = match.group(1)
        if name not in values:
            raise ValueError(f"Unknown or incomplete command binding: {name}")
        return str(values[name])

    return [re.sub(r"\{(source|output|input:[a-zA-Z0-9_-]+|stage:[a-zA-Z0-9_-]+)\}", replace, word)
            for word in stage.command]


@contextmanager
def stop_signals():
    """A cooperative stop sets a flag; cleanup cannot be interrupted by a second signal."""
    stopped = []
    previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}

    def request_stop(number, _frame):
        if not stopped:
            stopped.append(number)

    try:
        for number in previous:
            signal.signal(number, request_stop)
        yield stopped
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def drain_process(process: subprocess.Popen) -> None:
    if os.name == "nt":
        process.drain()
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    # The launcher may have exited while leaving descendants in its group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=10)


def drain_container(root: Path, stage: Stage) -> None:
    if stage.containerReceipt is None:
        return
    path = child_path(root, stage.containerReceipt)
    if not path.exists():
        return
    receipt = verify_hashed(read_json(path))
    name = receipt.get("containerName", "")
    if receipt.get("imageId") != stage.containerImage or not re.fullmatch(r"acephale-train-[a-f0-9]{32}", name):
        raise ValueError("Container ownership receipt differs; refusing unrelated cleanup")
    if not checked(["docker", "container", "ls", "--all", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"]).strip():
        return
    observed = json.loads(checked(["docker", "container", "inspect", name]))[0]
    if observed.get("Image") != stage.containerImage:
        raise ValueError("Owned container image changed")
    checked(["docker", "stop", "--time", "30", name], timeout=40)
    if checked(["docker", "container", "ls", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"]).strip():
        raise RuntimeError("Owned container did not drain")


def execute(command: list[str], directory: Path, stage: Stage, source: Path, guard, deadline: float, stopped: list[int]) -> None:
    if stopped:
        raise InterruptedError("Experiment stop requested before dispatch")
    if os.name not in {"posix", "nt"}:
        raise ValueError("Experiment process ownership requires Linux or Windows")
    process = None
    try:
        with (directory / "process.log").open("x", encoding="utf-8") as log:
            guard()
            if stopped:
                raise InterruptedError("Experiment stop requested before dispatch")
            if os.name == "nt":
                from acephale.windows_process import WindowsProcess

                process = WindowsProcess(command, cwd=source, stdout=log)
            else:
                process = subprocess.Popen(command, cwd=source, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            while process.poll() is None:
                if stopped:
                    raise InterruptedError("Experiment stop requested")
                if time.time() >= deadline:
                    raise TimeoutError("Stage or experiment deadline reached")
                guard()
                time.sleep(0.25)
            if stopped:
                raise InterruptedError("Experiment stop requested")
            if process.returncode:
                raise RuntimeError(f"Stage exited {process.returncode}; process.log retained")
            if time.time() >= deadline:
                raise TimeoutError("Stage or experiment deadline reached")
            guard()
    finally:
        try:
            if process is not None:
                drain_process(process)
        finally:
            drain_container(directory / "artifacts", stage)


def run(manifest_path: Path, output: Path, *, resume: bool = False) -> dict[str, Any]:
    raw = read_json(manifest_path)
    manifest = Experiment.model_validate(raw)
    manifest_hash = hashed(raw)["contentHash"]
    base = manifest_path.resolve().parent
    source = (base / manifest.source).resolve()
    inputs = {name: (base / value.path).absolute() for name, value in manifest.inputs.items()}
    output = output.resolve()
    process_owner_hash = file_hash(Path(__file__).with_name("windows_process.py")) if os.name == "nt" else None
    verify_source(source, manifest.sourceCommit)
    frozen_metadata = verify_inputs(inputs, manifest)
    if resume:
        run_receipt = verify_hashed(read_json(output / "run.json"))
        if run_receipt.get("manifestHash") != manifest_hash:
            raise ValueError("Resume manifest differs from the original run")
    else:
        output.mkdir(parents=True, exist_ok=False)
        run_receipt = hashed({"schemaVersion": 1, "kind": "acephale-experiment-run", "manifestHash": manifest_hash,
                              "manifest": raw, "startedAt": time.time(), "runnerHash": file_hash(Path(__file__)),
                              "processOwnerHash": process_owner_hash})
        write_new(output / "run.json", run_receipt)
    if run_receipt.get("runnerHash") != file_hash(Path(__file__)):
        raise ValueError("Resume requires the same runner implementation")
    if run_receipt.get("processOwnerHash") != process_owner_hash:
        raise ValueError("Resume requires the same process owner implementation")
    deadline = min(manifest.deadline, run_receipt["startedAt"] + manifest.maximumSeconds)
    completed: dict[str, Path] = {}
    receipts = []

    def guard():
        if time.time() >= deadline:
            raise TimeoutError("Original experiment deadline reached")
        if input_metadata(inputs) != frozen_metadata:
            raise ValueError("Frozen input changed during execution")

    def verify_completed_artifacts(phase: str):
        for earlier in manifest.stages:
            if earlier.id in completed:
                saved = verify_hashed(read_json(output / earlier.id / "receipt.json"))
                if saved["artifacts"] != verify_artifacts(completed[earlier.id], earlier.artifacts):
                    raise ValueError(f"A completed stage artifact changed {phase}")

    with stop_signals() as stopped:
        for stage in manifest.stages:
            if stopped:
                raise InterruptedError("Experiment stop requested between stages")
            directory = output / stage.id
            artifacts = directory / "artifacts"
            receipt_path = directory / "receipt.json"
            if directory.exists():
                if not resume or not receipt_path.is_file():
                    raise ValueError("Unclosed stage retained; recovery requires a new experiment manifest")
                receipt = verify_hashed(read_json(receipt_path))
                if (receipt.get("status") != "completed" or receipt.get("manifestHash") != manifest_hash
                        or receipt.get("stage") != stage.id or receipt.get("artifacts") != verify_artifacts(artifacts, stage.artifacts)):
                    raise ValueError("Only verified successful stages can be resumed; retain failures in a new recovery attempt")
            else:
                guard()
                verify_inputs(inputs, manifest)
                verify_source(source, manifest.sourceCommit)
                verify_completed_artifacts("before dispatch")
                if stopped:
                    raise InterruptedError("Experiment stop requested before dispatch")
                directory.mkdir()
                started = time.time()
                write_new(directory / "started.json", hashed({"manifestHash": manifest_hash, "stage": stage.id, "startedAt": started}))
                try:
                    command = expand_command(stage, source, inputs, completed, artifacts)
                    execute(command, directory, stage, source, guard, min(deadline, started + stage.timeoutSeconds), stopped)
                    verify_inputs(inputs, manifest)
                    verified = verify_artifacts(artifacts, stage.artifacts)
                    verify_source(source, manifest.sourceCommit)
                    verify_completed_artifacts("during execution")
                    receipt = hashed({"manifestHash": manifest_hash, "stage": stage.id, "status": "completed",
                                      "startedAt": started, "completedAt": time.time(), "artifacts": verified})
                except BaseException as error:
                    write_new(receipt_path, hashed({"manifestHash": manifest_hash, "stage": stage.id, "status": "failed",
                              "startedAt": started, "completedAt": time.time(), "errorType": type(error).__name__,
                              "failureRetained": True}))
                    raise
                write_new(receipt_path, receipt)
            receipts.append({"stage": stage.id, "receiptHash": receipt["contentHash"]})
            completed[stage.id] = artifacts
        result = hashed({"schemaVersion": 1, "kind": "acephale-experiment-completion", "status": "completed",
                         "manifestHash": manifest_hash, "stages": receipts})
        destination = output / "completion.json"
        if destination.exists():
            if verify_hashed(read_json(destination)) != result:
                raise ValueError("Experiment completion differs from verified stages")
        else:
            write_new(destination, result)
        return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.manifest, args.output, resume=args.resume), indent=2))


if __name__ == "__main__":
    main()
