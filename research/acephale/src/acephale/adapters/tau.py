"""Import the pinned tau text Results format without exposing evaluator inputs.

Only the audited native llm_agent is supported. Agent tools and system prompts
must come from a pre-execution capture, never from a trajectory's future calls.
Native timestamps are not execution clocks (initial history is timestamped
synthetically by tau), so imported event clocks and tool latency remain null.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from acephale.schemas import (
    Event,
    GoalSignature,
    Outcome,
    Record,
    ToolContract,
    TraceProvenance,
    Trajectory,
)
from acephale.storage import content_hash, file_hash

TAU_REVISION = "2174a603f6d014ef94473ffa95957f6ce27100db"
TAU_REPOSITORY = "https://github.com/sierra-research/tau2-bench.git"
SUPPORTED_DOMAINS = {"airline", "retail", "telecom", "banking_knowledge", "mock"}
TERMINATIONS = {
    "user_stop",
    "agent_stop",
    "max_steps",
    "timeout",
    "too_many_errors",
    "agent_error",
    "user_error",
    "infrastructure_error",
    "context_window_exceeded",
    "unexpected_error",
}


class PublicContext(Record):
    policy: str
    tools: tuple[ToolContract, ...]
    system_messages: tuple[str, ...]

    @model_validator(mode="after")
    def unique_tools(self) -> PublicContext:
        if len({tool.name for tool in self.tools}) != len(self.tools):
            raise ValueError("Duplicate tool in initial catalog")
        return self


class ContextBundle(Record):
    schema_version: Literal[1] = 1
    benchmark_revision: Literal[TAU_REVISION] = TAU_REVISION
    domain: str
    actor_implementation: Literal["llm_agent"] = "llm_agent"
    capture_source: Literal["native_pre_execution", "external_audit"]
    contexts: dict[str, PublicContext]
    limitations: tuple[str, ...] = (
        "Text llm_agent only; full-duplex, solo, and ground-truth actors are unsupported.",
        "Public tool schemas are captured before execution; hidden user tools are excluded.",
        "Native message timestamps are not reliable execution clocks; tool latency is unknown.",
        "Native actor input visibility is source-audited, not a provider payload audit.",
    )


class TaskLabel(Record):
    group_id: str = Field(min_length=1)
    goal: GoalSignature | None = None


class LabelBundle(Record):
    """Offline, independently reviewed labels. Never included in PrefixView."""

    schema_version: Literal[1] = 1
    tasks: dict[str, TaskLabel]


def _object(value: Any, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Expected object at {location}")
    return value


def _text(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Expected nonempty string at {location}")
    return value


def _load_results(path: Path) -> dict[str, Any]:
    meta_path = path / "results.json" if path.is_dir() else path
    raw = _object(json.loads(meta_path.read_text(encoding="utf-8")), "results")
    if not all(key in raw for key in ("info", "tasks")):
        raise ValueError("Expected native tau Results with info and tasks")
    if raw.get("format_version") not in (None, 1, 2):
        raise ValueError("Unsupported tau directory format version")
    sims_dir = meta_path.parent / "simulations"
    directory_format = path.is_dir() or raw.get("simulation_index") is not None
    if directory_format:
        index = raw.get("simulation_index")
        if not isinstance(index, list):
            raise ValueError("Directory imports require simulation_index for integrity checks")
        ids = [_text(_object(row, "simulation_index").get("id"), "simulation ID") for row in index]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate simulation_index ID")
        paths = list(sims_dir.glob("*.json"))
        if {item.stem for item in paths} != set(ids):
            raise ValueError("Missing or extra simulation files relative to simulation_index")
        by_id = {}
        for item in paths:
            sim = _object(json.loads(item.read_text(encoding="utf-8")), item.name)
            if sim.get("id") != item.stem:
                raise ValueError("Simulation filename does not match its ID")
            by_id[item.stem] = sim
        raw["simulations"] = [by_id[identifier] for identifier in ids]
    if not isinstance(raw.get("simulations"), list) or not isinstance(raw["tasks"], list):
        raise ValueError("Expected complete native tau Results lists")
    return raw


def _events(messages: list[Any], context: PublicContext) -> tuple[Event, ...]:
    events = [
        Event(seq=i, kind="message", role="system", content=text)
        for i, text in enumerate(context.system_messages)
    ]
    calls: dict[str, tuple[str, str]] = {}

    def append(**kwargs: Any) -> None:
        events.append(Event(seq=len(events), **kwargs))

    def tool_result(raw: dict[str, Any]) -> None:
        requestor = raw.get("requestor", "assistant")
        if requestor == "user":
            return
        if requestor != "assistant":
            raise ValueError("Unknown tool result requestor")
        identifier = _text(raw.get("id"), "tool result ID")
        if identifier not in calls:
            raise ValueError("Tool result does not match a visible assistant request")
        name, batch = calls[identifier]
        content = raw.get("content")
        if content is not None and not isinstance(content, str):
            raise ValueError("Unsupported native tool result content")
        result: Any = content
        if content:
            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                pass
        error = raw.get("error", False)
        if not isinstance(error, bool):
            raise ValueError("Native tool error must be boolean")
        append(
            kind="tool_result",
            role="tool",
            call_id=identifier,
            tool=name,
            batch_id=batch,
            result=result,
            content=content,
            status="error" if error else "success",
        )

    for index, item in enumerate(messages):
        raw = _object(item, f"messages[{index}]")
        role = raw.get("role")
        if raw.get("is_audio") or raw.get("chunk_id") is not None:
            raise ValueError("Voice and streaming trajectories require a separate adapter")
        if role == "tool":
            if "tool_messages" in raw:
                if not isinstance(raw["tool_messages"], list):
                    raise ValueError("Expected MultiToolMessage list")
                for child in raw["tool_messages"]:
                    child = _object(child, "tool_messages")
                    if child.get("role") != "tool":
                        raise ValueError("Invalid MultiToolMessage child")
                    tool_result(child)
            else:
                tool_result(raw)
            continue
        if role not in {"assistant", "user"}:
            raise ValueError(
                "Unexpected native message role; system messages require context audit"
            )
        native_calls = raw.get("tool_calls") or []
        if not isinstance(native_calls, list):
            raise ValueError("Expected native tool_calls list")
        # User simulator tool requests and associated content are hidden from the actor.
        if role == "user" and native_calls:
            continue
        content = raw.get("content")
        if content is not None:
            if not isinstance(content, str):
                raise ValueError("Only text native message content is supported")
            generation = raw.get("generation_time_seconds")
            append(
                kind="message",
                role=role,
                content=content,
                duration_ms=generation * 1000 if generation is not None else None,
            )
        batch = f"native-message-{index}"
        for call in native_calls:
            call = _object(call, "tool_calls")
            if call.get("requestor", "assistant") != "assistant":
                raise ValueError("Assistant message contains non-assistant tool request")
            identifier = _text(call.get("id"), "tool call ID")
            name = _text(call.get("name"), "tool name")
            arguments = _object(call.get("arguments"), "tool arguments")
            if identifier in calls:
                raise ValueError("Duplicate assistant tool call ID")
            calls[identifier] = (name, batch)
            append(
                kind="tool_request",
                role="assistant",
                call_id=identifier,
                tool=name,
                arguments=arguments,
                batch_id=batch,
            )
    return tuple(events)


def import_tau(
    path: Path | str,
    *,
    contexts_path: Path | str,
    labels_path: Path | str | None = None,
) -> list[Trajectory]:
    """Import native Results plus public context and optional offline labels.

    Missing group labels put every task in one domain-wide group, conservatively
    preventing an unaudited task-level split. Supply labels before experiments.
    Failed, errored and unfinished simulations are retained with native rewards.
    """
    source_path = Path(path)
    raw = _load_results(source_path)
    context_path = Path(contexts_path)
    contexts = ContextBundle.model_validate_json(context_path.read_text(encoding="utf-8"))
    labels = (
        LabelBundle.model_validate_json(Path(labels_path).read_text(encoding="utf-8"))
        if labels_path is not None
        else None
    )
    info = _object(raw["info"], "info")
    if info.get("git_commit") != TAU_REVISION:
        raise ValueError("Native results revision does not match audited tau pin")
    actor = _object(info.get("agent_info"), "agent_info")
    if actor.get("implementation") != "llm_agent":
        raise ValueError(
            "Only native llm_agent is audited; GT, solo, and custom actors are excluded"
        )
    actor_model = _text(actor.get("llm"), "native actor model")
    user = _object(info.get("user_info"), "user_info")
    user_model = user.get("llm")
    if user_model is not None:
        user_model = _text(user_model, "native user model")
    if info.get("audio_native_config") is not None:
        raise ValueError("Audio-native Results are unsupported")
    retrieval = info.get("retrieval_config")
    if retrieval and any(word in str(retrieval).lower() for word in ("golden", "oracle")):
        raise ValueError("Ground-truth retrieval is not permitted in the actor corpus")
    env_info = _object(info.get("environment_info"), "environment_info")
    domain = _text(env_info.get("domain_name"), "domain_name")
    if domain not in SUPPORTED_DOMAINS or contexts.domain != domain:
        raise ValueError("Unsupported or mismatched tau domain")
    source_dir = source_path if source_path.is_dir() else source_path.parent
    if source_path.is_dir() or raw.get("simulation_index") is not None:
        meta_path = source_path / "results.json" if source_path.is_dir() else source_path
        source_files = [meta_path, *sorted((source_dir / "simulations").glob("*.json"))]
        results_hash = content_hash(
            {item.relative_to(source_dir).as_posix(): file_hash(item) for item in source_files}
        )
    else:
        results_hash = file_hash(source_path)
    capture_path = source_dir / "capture_manifest.json"
    capture = None
    if capture_path.exists():
        capture = _object(json.loads(capture_path.read_text(encoding="utf-8")), "capture_manifest")
        if capture.get("complete") is not True or capture.get("native_evaluation") is not True:
            raise ValueError("Capture manifest does not declare a completed native evaluation")
        if capture.get("revision") != TAU_REVISION or capture.get("schema_version") != 1:
            raise ValueError("Capture manifest revision or schema does not match")
        capture_request = _object(capture.get("request"), "capture request")
        if capture_request.get("operation") != "run":
            raise ValueError("Context-only capture cannot establish a native evaluation run")
        capture_spec = _object(capture_request.get("payload"), "capture run specification")
        if (
            capture_spec.get("actor_model") != actor_model
            or capture_spec.get("user_model") != user_model
            or capture_spec.get("domain") != domain
        ):
            raise ValueError("Capture manifest models or domain differ from native Results")
        expected_artifacts = capture.get("artifact_hashes")
        if expected_artifacts is not None:
            expected_artifacts = _object(expected_artifacts, "capture artifact hashes")
            if expected_artifacts.get("results.json") != results_hash or expected_artifacts.get(
                "contexts.json"
            ) != file_hash(context_path):
                raise ValueError("Native capture source artifact hash mismatch")
    shared_provenance = {
        "actor_model": actor_model,
        "user_model": user_model,
        "actor_config_hash": content_hash(actor),
        "user_config_hash": content_hash(user),
        "run_config_hash": content_hash(info),
        "raw_results_hash": results_hash,
        "public_context_hash": file_hash(context_path),
        "endpoint_labels_hash": file_hash(Path(labels_path)) if labels_path is not None else None,
        "capture_manifest_hash": file_hash(capture_path) if capture is not None else None,
    }
    sims = raw["simulations"]
    ids = [str(_object(sim, "simulation").get("id", "")) for sim in sims]
    if len(ids) != len(set(ids)) or not all(ids):
        raise ValueError("Missing or duplicate simulation ID")
    if set(ids) != set(contexts.contexts):
        raise ValueError("Context and simulation cohorts must match exactly")
    task_ids = {_text(_object(task, "task").get("id"), "task ID") for task in raw["tasks"]}
    num_trials = info.get("num_trials")
    if not isinstance(num_trials, int) or isinstance(num_trials, bool) or num_trials < 1:
        raise ValueError("Explicit native num_trials is required")
    seen_trials: set[tuple[str, int]] = set()
    trajectories = []
    for sim in sims:
        task_id = _text(sim.get("task_id"), "task_id")
        if task_id not in task_ids:
            raise ValueError("Simulation task is absent from native task manifest")
        if sim.get("mode", "half_duplex") != "half_duplex" or sim.get("ticks"):
            raise ValueError("Only half-duplex text trajectories are supported")
        trial = sim.get("trial")
        if not isinstance(trial, int) or isinstance(trial, bool) or trial < 0:
            raise ValueError("Explicit nonnegative native trial is required")
        if (task_id, trial) in seen_trials:
            raise ValueError("Duplicate task/trial in native cohort")
        seen_trials.add((task_id, trial))
        trial_seed = sim.get("seed")
        if trial_seed is not None and (
            not isinstance(trial_seed, int) or isinstance(trial_seed, bool)
        ):
            raise ValueError("Native trial seed must be an integer or null")
        if capture is not None:
            seeds = capture.get("trial_seeds")
            if not isinstance(seeds, list) or trial >= len(seeds) or seeds[trial] != trial_seed:
                raise ValueError("Native trial seed differs from capture manifest")
        reason = sim.get("termination_reason")
        if reason not in TERMINATIONS:
            raise ValueError("Unknown native termination reason")
        messages = sim.get("messages")
        if messages is None and reason not in {"user_stop", "agent_stop"}:
            messages = []
        if not isinstance(messages, list):
            raise ValueError("Completed native text simulations require an explicit message list")
        reward_info = sim.get("reward_info")
        reward = (
            _object(reward_info, "reward_info").get("reward") if reward_info is not None else None
        )
        if reward is not None and (
            isinstance(reward, bool) or not isinstance(reward, (int, float))
        ):
            raise ValueError("Native reward must be numeric or null")
        context = contexts.contexts[sim["id"]]
        if sim.get("policy") is not None and sim["policy"] != context.policy:
            raise ValueError("Captured public policy differs from native simulation policy")
        label = labels.tasks.get(task_id) if labels is not None else None
        if labels is not None and label is None:
            raise ValueError(f"Missing offline group label for task {task_id}")
        success = 1.0 - 1e-6 <= reward <= 1.0 + 1e-6 if reward is not None else None
        error_reasons = {
            "too_many_errors",
            "agent_error",
            "user_error",
            "infrastructure_error",
            "unexpected_error",
        }
        status = (
            "error"
            if reason in error_reasons
            else "incomplete"
            if reward is None
            else "completed"
            if success
            else "failed"
        )
        trajectories.append(
            Trajectory(
                trajectory_id=f"tau3:{domain}:{sim['id']}",
                benchmark="tau3",
                domain=domain,
                task_id=task_id,
                group_id=label.group_id if label else f"{domain}:ungrouped",
                trial=trial,
                source_kind="synthetic" if domain == "mock" else "benchmark",
                benchmark_revision=TAU_REVISION,
                policy=context.policy,
                initial_tools=context.tools,
                events=_events(messages, context),
                provenance=TraceProvenance(**shared_provenance, trial_seed=trial_seed),
                outcome=Outcome(
                    status=status,
                    success=success,
                    goal=label.goal if label else None,
                    native_reward=reward,
                    evaluator_version=TAU_REVISION,
                    native_termination_reason=reason,
                    native_excluded_from_success=reason == "infrastructure_error",
                ),
                total_elapsed_ms=sim["duration"] * 1000
                if sim.get("duration") is not None
                else None,
            )
        )
    if seen_trials != {(task_id, trial) for task_id in task_ids for trial in range(num_trials)}:
        raise ValueError("Native task/trial cohort is incomplete or contains out-of-range trials")
    return trajectories
