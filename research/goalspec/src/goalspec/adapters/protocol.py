"""Versioned, correlated JSONL messages for isolated benchmark processes."""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Literal, TextIO

from pydantic import Field, model_validator

from goalspec.schemas import Record


class NativeRunSpec(Record):
    domain: Literal["airline", "retail", "telecom", "banking_knowledge", "mock"]
    task_ids: tuple[str, ...] = Field(min_length=1)
    seeds: tuple[int, ...] = Field(min_length=1)
    actor_model: str = Field(min_length=1)
    user_model: str = Field(min_length=1)
    actor_args: dict[str, Any] = Field(default_factory=dict)
    user_args: dict[str, Any] = Field(default_factory=dict)
    task_set_name: str | None = None
    task_split_name: str | None = "base"
    retrieval_config: str | None = None
    max_steps: int = Field(default=100, ge=1)
    max_errors: int = Field(default=10, ge=1)
    output_dir: str

    @model_validator(mode="after")
    def explicit_cohort(self) -> NativeRunSpec:
        if len(set(self.task_ids)) != len(self.task_ids) or any(not task for task in self.task_ids):
            raise ValueError("Task IDs must be nonempty and unique")
        if len(set(self.seeds)) != len(self.seeds):
            raise ValueError("Each trial requires a distinct explicit seed")
        if not Path(self.output_dir).is_absolute():
            raise ValueError("output_dir must be absolute")
        if self.retrieval_config and any(
            word in self.retrieval_config.lower() for word in ("golden", "oracle")
        ):
            raise ValueError("Ground-truth retrieval is excluded")
        return self


class WorkerRequest(Record):
    protocol_version: Literal[1] = 1
    request_id: str = Field(min_length=1)
    operation: Literal["ping", "capture_context", "run"]
    payload: NativeRunSpec | None = None

    @model_validator(mode="after")
    def payload_matches_operation(self) -> WorkerRequest:
        if (self.operation == "ping") != (self.payload is None):
            raise ValueError("Only ping omits its run specification")
        if (
            self.operation == "capture_context"
            and self.payload is not None
            and self.payload.domain == "banking_knowledge"
            and self.payload.retrieval_config not in {"bm25", "bm25_grep", "grep_only"}
        ):
            raise ValueError(
                "Contexts-only banking capture requires explicit retrieval_config bm25, "
                "bm25_grep, or grep_only in the run spec. Dense/default retrieval performs "
                "embedding API calls during initialization; use a full run for that variant."
            )
        return self


class WorkerError(Record):
    code: str
    message: str


class WorkerResponse(Record):
    protocol_version: Literal[1] = 1
    request_id: str = Field(min_length=1)
    result: dict[str, Any] | None = None
    error: WorkerError | None = None

    @model_validator(mode="after")
    def one_payload(self) -> WorkerResponse:
        if (self.result is None) == (self.error is None):
            raise ValueError("Exactly one result or error is required")
        return self


def serve(
    handler: Callable[[WorkerRequest], dict[str, Any]],
    input_stream: TextIO,
    output_stream: TextIO,
    error_stream: TextIO,
) -> None:
    """Serve requests serially. Uncorrelatable input terminates with no fake ID."""
    seen: set[str] = set()
    for line in input_stream:
        try:
            raw = json.loads(line)
            identifier = raw.get("request_id") if isinstance(raw, dict) else None
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("A request_id is required for correlation")
        except (ValueError, TypeError) as error:
            print(f"Invalid uncorrelated request: {type(error).__name__}", file=error_stream)
            return
        try:
            request = WorkerRequest.model_validate(raw)
            if identifier in seen:
                raise ValueError("Duplicate request_id")
            seen.add(identifier)
            # Benchmark progress output must not contaminate the JSONL channel.
            with contextlib.redirect_stdout(error_stream):
                result = handler(request)
            response = WorkerResponse(request_id=identifier, result=result)
        except Exception as error:
            print(f"Worker request {identifier} failed: {type(error).__name__}", file=error_stream)
            response = WorkerResponse(
                request_id=identifier,
                error=WorkerError(code=type(error).__name__, message=str(error)),
            )
        output_stream.write(response.model_dump_json() + "\n")
        output_stream.flush()


def tau_worker_command(
    benchmark_dir: Path | str,
    *,
    uv: str | Sequence[str] | None = None,
) -> list[str]:
    """The benchmark owns its uv environment and pinned dependency lock."""
    if uv is None:
        uv = os.environ.get("UV", "uv")
    executable = [uv] if isinstance(uv, str) else list(uv)
    if not executable:
        raise ValueError("The uv executable command cannot be empty")
    return [
        *executable,
        "run",
        "--project",
        str(Path(benchmark_dir).resolve()),
        "--frozen",
        "--extra",
        "knowledge",
        "--extra",
        "voice",
        "--python",
        "3.12",
        "python",
        str(Path(__file__).with_name("tau_worker.py").resolve()),
    ]


def invoke_tau(
    benchmark_dir: Path | str,
    request: WorkerRequest,
    *,
    uv: str | Sequence[str] | None = None,
) -> WorkerResponse:
    """Invoke one request. Native/provider logs inherit stderr, never stdout."""
    environment = os.environ.copy()
    environment["PYTHON_DOTENV_DISABLED"] = "1"
    environment.pop("VIRTUAL_ENV", None)
    result = subprocess.run(
        tau_worker_command(benchmark_dir, uv=uv),
        cwd=Path(benchmark_dir).resolve(),
        input=request.model_dump_json() + "\n",
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        check=True,
        env=environment,
    )
    lines = result.stdout.splitlines()
    if len(lines) != 1:
        raise ValueError("Worker must return exactly one JSONL response")
    response = WorkerResponse.model_validate_json(lines[0])
    if response.request_id != request.request_id:
        raise ValueError("Worker response correlation mismatch")
    if response.error is not None:
        raise RuntimeError(f"Tau worker {response.error.code}: {response.error.message}")
    return response
