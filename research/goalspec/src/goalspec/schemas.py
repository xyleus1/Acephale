"""Versioned wire contracts; evaluator state never belongs in PrefixView."""

from __future__ import annotations

import json
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ToolContract(Record):
    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object"})
    version: str = "unknown"
    side_effects: Literal["read_only", "mutating", "unknown"] = "unknown"
    cacheable: bool = False
    freshness: Literal["state_epoch", "dependencies", "unverifiable"] = "unverifiable"


class GoalSignature(Record):
    goal_id: str
    objective: str
    object_type: str
    completion: tuple[str, ...]
    constraints: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        return " ".join((self.objective, self.object_type, *self.completion, *self.constraints))


class GoalPosterior(Record):
    probabilities: dict[str, float]
    through_seq: int
    model_id: str = "unspecified"

    @model_validator(mode="after")
    def valid_distribution(self) -> GoalPosterior:
        validate_distribution(self.probabilities)
        return self


def validate_distribution(values: dict[str, float]) -> None:
    if not values or any(not math.isfinite(p) or p < 0 for p in values.values()):
        raise ValueError("Probabilities must be finite, nonnegative, and nonempty")
    if not math.isclose(sum(values.values()), 1.0, abs_tol=1e-6):
        raise ValueError("Probabilities must sum to one")


class Event(Record):
    seq: int = Field(ge=0)
    kind: Literal["message", "tool_request", "tool_result", "tools"]
    role: Literal["system", "user", "assistant", "tool"] = "assistant"
    content: str | None = None
    call_id: str | None = None
    tool: str | None = None
    arguments: dict[str, Any] | None = None
    result: Any = None
    status: Literal["success", "error"] | None = None
    batch_id: str | None = None
    observed_at_ns: int | None = Field(default=None, ge=0)
    duration_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    state_version: str | None = None
    tools: tuple[ToolContract, ...] | None = None

    @model_validator(mode="after")
    def valid_event(self) -> Event:
        if self.kind in {"tool_request", "tool_result"} and (not self.call_id or not self.tool):
            raise ValueError("Tool events require call_id and tool")
        if self.kind == "tool_request" and self.arguments is None:
            raise ValueError("Tool requests require arguments")
        if self.kind == "tool_result" and self.status is None:
            raise ValueError("Tool results require status")
        if self.kind == "tools" and self.tools is None:
            raise ValueError("Catalog updates require tools")
        return self


class Outcome(Record):
    status: Literal["completed", "failed", "error", "incomplete"]
    success: bool | None = None
    goal: GoalSignature | None = None
    native_reward: float | None = Field(default=None, allow_inf_nan=False)
    evaluator_version: str = "unknown"
    native_termination_reason: str | None = None
    native_excluded_from_success: bool = False


class TraceProvenance(Record):
    actor_model: str
    user_model: str | None = None
    actor_config_hash: str
    user_config_hash: str | None = None
    run_config_hash: str
    trial_seed: int | None = None
    raw_results_hash: str
    public_context_hash: str
    endpoint_labels_hash: str | None = None
    capture_manifest_hash: str | None = None


class Trajectory(Record):
    schema_version: Literal[1] = 1
    trajectory_id: str
    benchmark: str
    domain: str
    task_id: str
    group_id: str
    trial: int = Field(ge=0)
    source_kind: Literal["benchmark", "synthetic"]
    benchmark_revision: str
    policy: str
    initial_tools: tuple[ToolContract, ...]
    events: tuple[Event, ...]
    outcome: Outcome
    provenance: TraceProvenance | None = None
    total_elapsed_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_order(self) -> Trajectory:
        seqs = [event.seq for event in self.events]
        if seqs != sorted(set(seqs)):
            raise ValueError("Event sequence numbers must be strictly increasing")
        requests: dict[str, Event] = {}
        completed: set[str] = set()
        for event in self.events:
            if event.kind == "tool_request":
                if event.call_id in requests:
                    raise ValueError("Duplicate call_id")
                requests[event.call_id] = event
            elif event.kind == "tool_result":
                request = requests.get(event.call_id)
                if request is None or request.tool != event.tool or event.call_id in completed:
                    raise ValueError("Result must resolve one preceding matching request")
                completed.add(event.call_id)
        if self.outcome.status == "completed" and set(requests) != completed:
            raise ValueError("Completed trajectories must resolve every tool request")
        return self


class PrefixView(Record):
    """The entire permitted predictor input, without outcomes or future events."""

    trajectory_id: str
    benchmark: str
    domain: str
    task_id: str
    trial: int
    through_seq: int
    policy: str
    tools: tuple[ToolContract, ...]
    events: tuple[Event, ...]

    @model_validator(mode="after")
    def no_future(self) -> PrefixView:
        if any(event.seq > self.through_seq for event in self.events):
            raise ValueError("Future event in public prefix")
        return self

    @property
    def query(self) -> str:
        return next((e.content or "" for e in self.events if e.kind == "message" and e.role == "user"), "")

    @property
    def signatures(self) -> tuple[str, ...]:
        completed = {e.call_id: e for e in self.events if e.kind == "tool_result"}
        batches: dict[str, list[Event]] = {}
        for event in self.events:
            if event.kind == "tool_request":
                batches.setdefault(event.batch_id or f"call:{event.call_id}", []).append(event)
        signatures = []
        for requests in batches.values():
            if any(event.call_id not in completed for event in requests):
                continue
            values = sorted(f"{event.tool}:{completed[event.call_id].status}" for event in requests)
            signatures.append(values[0] if len(values) == 1 else "batch[" + "|".join(values) + "]")
        return tuple(signatures)

    @property
    def text(self) -> str:
        observations = []
        for event in self.events:
            if event.kind == "message":
                observations.append(event.content or "")
            elif event.kind == "tool_result":
                observations.append(json.dumps(event.result, sort_keys=True, ensure_ascii=False))
        return "\n".join([self.policy, *observations])


class Candidate(Record):
    tool: str
    arguments: dict[str, Any]
    probability: float = Field(ge=0, le=1, allow_inf_nan=False)
    pattern_id: str | None = None


class Prediction(Record):
    tool_distribution: dict[str, float]
    candidates: tuple[Candidate, ...] = ()
    goal_posterior: GoalPosterior | None = None

    @model_validator(mode="after")
    def valid_distribution(self) -> Prediction:
        validate_distribution(self.tool_distribution)
        return self
