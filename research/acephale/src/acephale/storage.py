"""Strict JSONL storage and content-addressed, credential-free manifests."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from acephale.schemas import Trajectory


def canonical_json(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value: Any) -> None:
    """Atomic artifact publication; partial files never look like complete runs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(canonical_json(value) + "\n")
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def load_trajectories(path: Path) -> list[Trajectory]:
    trajectories: list[Trajectory] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                trajectory = Trajectory.model_validate_json(line)
            except ValueError as error:
                raise ValueError(f"Invalid trajectory at line {number}: {error}") from error
            if trajectory.trajectory_id in seen:
                raise ValueError(f"Duplicate trajectory_id at line {number}")
            seen.add(trajectory.trajectory_id)
            trajectories.append(trajectory)
    if not trajectories:
        raise ValueError("Trajectory corpus is empty")
    return trajectories


def write_trajectories(path: Path, trajectories: Iterable[Trajectory]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        for trajectory in trajectories:
            stream.write(canonical_json(trajectory) + "\n")


def append_jsonl(path: Path, record: Any) -> None:
    """Append a completed observation immediately, retaining evidence on failure."""
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(canonical_json(record) + "\n")


def source_hash(root: Path) -> str:
    files = sorted(root.rglob("*.py"))
    return content_hash({path.relative_to(root).as_posix(): file_hash(path) for path in files})
