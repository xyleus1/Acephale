"""Conservative replay of public Sierra Results with reconstructed tool catalogs.

This importer is deliberately separate from the strict native capture importer.
Public releases often name unpublished source revisions and omit tool schemas.
Their observations and rewards are real, but exact actor-input parity cannot be
established. They therefore use a separate benchmark identity which cannot pass
the preregistered native tau3 scheduler gate.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import model_validator

from goalspec.adapters.tau import (
    TERMINATIONS,
    LabelBundle,
    PublicContext,
    _events,
    _load_results,
)
from goalspec.schemas import Outcome, Record, ToolContract, TraceProvenance, Trajectory
from goalspec.storage import content_hash, file_hash

PUBLIC_BENCHMARK = "tau3-public-replay"


class PublicCatalog(Record):
    """Schema-only snapshot, obtained independently of task/trajectory contents."""

    schema_version: Literal[1] = 1
    source_revision: str
    domain: Literal["airline", "retail", "telecom", "banking_knowledge"]
    retrieval_config: str | None = None
    tools: tuple[ToolContract, ...]
    agent_instruction: str
    system_prompt_template: str
    source_hashes: dict[str, str]

    @model_validator(mode="after")
    def safe_reconstruction(self) -> PublicCatalog:
        if not self.tools or len({tool.name for tool in self.tools}) != len(self.tools):
            raise ValueError("Public catalog requires unique tools")
        if not re.fullmatch(r"[0-9a-f]{40}", self.source_revision):
            raise ValueError("Catalog source revision must be an exact git hash")
        if not self.source_hashes:
            raise ValueError("Catalog requires independently captured source hashes")
        if any(tool.cacheable or tool.side_effects != "unknown" for tool in self.tools):
            raise ValueError("Reconstructed catalogs cannot authorize speculative execution")
        return self


class PublicReleaseAudit(Record):
    schema_version: Literal[1] = 1
    source_url: str
    results_sha256: str
    submission_sha256: str
    catalog_sha256: str
    native_revision: str
    native_evaluator_claim: str
    benchmark_identity: Literal["tau3-public-replay"] = PUBLIC_BENCHMARK
    limitations: tuple[str, ...] = (
        "Published real actor traces, not a new live benchmark run.",
        "Recorded source revision is retained; exact actor catalog was not published.",
        "Tool schemas and system prompt are reconstructed from pinned public source.",
        "Replay cannot establish scheduler latency gains or changed actor task success.",
        "Native reported rewards are preserved; they were not independently regraded.",
        "Public release diagnostic evidence cannot open the native tau3 scheduler gate.",
    )


def import_public_tau(
    results_path: Path | str,
    catalog_path: Path | str,
    submission_path: Path | str,
    labels_path: Path | str,
    *,
    source_url: str,
) -> tuple[list[Trajectory], PublicReleaseAudit]:
    """Project complete published cohorts without relabeling their source revision."""
    results_path, catalog_path = Path(results_path), Path(catalog_path)
    submission_path, labels_path = Path(submission_path), Path(labels_path)
    parsed = urlparse(source_url)
    if parsed.scheme != "https" or parsed.hostname != (
        "sierra-tau-bench-public.s3.us-west-2.amazonaws.com"
    ):
        raise ValueError("Public release source must be the official Sierra HTTPS bucket")
    raw = _load_results(results_path)
    catalog = PublicCatalog.model_validate_json(catalog_path.read_text(encoding="utf-8"))
    labels = LabelBundle.model_validate_json(labels_path.read_text(encoding="utf-8"))
    submission = json.loads(submission_path.read_text(encoding="utf-8"))
    if submission.get("submission_type", "standard") != "standard":
        raise ValueError("Only standard native-scaffold public releases are supported")
    if submission.get("modality", "text") != "text":
        raise ValueError("Voice public releases require a different projection")
    verification = submission.get("methodology", {}).get("verification", {})
    if verification.get("modified_prompts") is not False:
        raise ValueError("Public release must declare unmodified native prompts")
    expected_name = submission.get("trajectory_files", {}).get(catalog.domain)
    if not expected_name or not parsed.path.endswith("/trajectories/" + expected_name):
        raise ValueError("Source URL does not match submission trajectory manifest")
    info = raw["info"]
    revision = info.get("git_commit", "")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Published results must retain an explicit native source revision")
    actor, user = info["agent_info"], info["user_info"]
    if actor.get("implementation") != "llm_agent" or not actor.get("llm"):
        raise ValueError("Only recorded native llm_agent runs are supported")
    # Native Results serialize a default text_streaming_config even for ordinary
    # text runs. Simulation mode, ticks and message chunks establish actual mode.
    if info.get("audio_native_config"):
        raise ValueError("Only ordinary half-duplex text runs are supported")
    env = info["environment_info"]
    if env["domain_name"] != catalog.domain:
        raise ValueError("Public catalog and native domain differ")
    if catalog.domain == "banking_knowledge" and info.get("retrieval_config") != (
        catalog.retrieval_config
    ):
        raise ValueError("Banking catalog must match the recorded retrieval variant")
    task_ids = [str(task["id"]) for task in raw["tasks"]]
    if len(task_ids) != len(set(task_ids)) or set(task_ids) != set(labels.tasks):
        raise ValueError("Offline endpoint labels must cover the exact native task cohort")
    trials = info.get("num_trials")
    if not isinstance(trials, int) or isinstance(trials, bool) or trials < 1:
        raise ValueError("Public cohort requires an explicit positive trial count")
    audit = PublicReleaseAudit(
        source_url=source_url,
        results_sha256=file_hash(results_path),
        submission_sha256=file_hash(submission_path),
        catalog_sha256=file_hash(catalog_path),
        native_revision=revision,
        native_evaluator_claim=str(submission.get("methodology", {}).get(
            "tau2_bench_version", "not reported"
        )),
    )
    provenance = dict(
        actor_model=actor["llm"], user_model=user.get("llm"),
        actor_config_hash=content_hash(actor), user_config_hash=content_hash(user),
        run_config_hash=content_hash(info), raw_results_hash=audit.results_sha256,
        public_context_hash=content_hash({
            "catalog": audit.catalog_sha256,
            "recorded_policies": [sim.get("policy") for sim in raw["simulations"]],
            "environment_policy": env.get("policy"),
        }),
        endpoint_labels_hash=file_hash(labels_path),
        # Reconstruction must never masquerade as a native pre-execution capture.
        capture_manifest_hash=None,
    )
    seen_ids: set[str] = set()
    seen_trials: set[tuple[str, int]] = set()
    traces = []
    for sim in raw["simulations"]:
        identifier, task_id, trial = sim["id"], str(sim["task_id"]), sim.get("trial")
        if not identifier or identifier in seen_ids:
            raise ValueError("Duplicate or missing published simulation ID")
        if not isinstance(trial, int) or isinstance(trial, bool):
            raise ValueError("Explicit integer simulation trial is required")
        if task_id not in labels.tasks or (task_id, trial) in seen_trials:
            raise ValueError("Unexpected or duplicate published task/trial")
        seen_ids.add(identifier)
        seen_trials.add((task_id, trial))
        if sim.get("mode", "half_duplex") != "half_duplex" or sim.get("ticks"):
            raise ValueError("Only text half-duplex simulations are supported")
        reason = sim.get("termination_reason")
        if reason not in TERMINATIONS:
            raise ValueError("Unknown native termination reason")
        policy = sim.get("policy") or env.get("policy")
        if not isinstance(policy, str) or not policy:
            raise ValueError("Public release omitted recorded actor-visible policy")
        context = PublicContext(
            policy=policy, tools=catalog.tools,
            system_messages=(catalog.system_prompt_template.format(
                domain_policy=policy, agent_instruction=catalog.agent_instruction
            ),),
        )
        reward = (sim.get("reward_info") or {}).get("reward")
        if reward is not None and (isinstance(reward, bool) or not isinstance(reward, (int, float))):
            raise ValueError("Native reward must be numeric or null")
        success = abs(reward - 1.0) <= 1e-6 if reward is not None else None
        errors = {"agent_error", "user_error", "infrastructure_error", "unexpected_error",
                  "too_many_errors"}
        status = "error" if reason in errors else (
            "incomplete" if reward is None else "completed" if success else "failed"
        )
        messages = sim.get("messages")
        if messages is None and reason in errors:
            messages = []
        if not isinstance(messages, list):
            raise ValueError("Published completed simulation requires messages")
        traces.append(Trajectory(
            trajectory_id=f"{PUBLIC_BENCHMARK}:{catalog.domain}:{identifier}",
            benchmark=PUBLIC_BENCHMARK, domain=catalog.domain,
            task_id=task_id, group_id=labels.tasks[task_id].group_id, trial=trial,
            source_kind="benchmark", benchmark_revision=revision, policy=policy,
            initial_tools=catalog.tools, events=_events(messages, context),
            provenance=TraceProvenance(**provenance, trial_seed=sim.get("seed")),
            outcome=Outcome(
                status=status, success=success, goal=labels.tasks[task_id].goal,
                native_reward=reward, evaluator_version=f"published:{audit.native_evaluator_claim}",
                native_termination_reason=reason,
                native_excluded_from_success=reason == "infrastructure_error",
            ),
            total_elapsed_ms=sim["duration"] * 1000 if sim.get("duration") is not None else None,
        ))
    if seen_trials != {(task, trial) for task in task_ids for trial in range(trials)}:
        raise ValueError("Published native task/trial cohort is incomplete")
    return traces, audit
