"""Standalone entrypoint executed by the native tau uv environment.

stdin/stdout carry the protocol from protocol.py. Native imports and all logs
run under stdout redirection. No benchmark dependency is imported by the core.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from goalspec.adapters.protocol import WorkerRequest, serve
from goalspec.adapters.tau import TAU_REVISION, ContextBundle, PublicContext
from goalspec.schemas import ToolContract
from goalspec.storage import file_hash


def verify_checkout(path: Path) -> None:
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()
    if revision != TAU_REVISION:
        raise ValueError(f"Tau checkout must be pinned to {TAU_REVISION}")
    subprocess.run(["git", "diff", "--exit-code", "--quiet", "HEAD", "--"], cwd=path, check=True)


def _save(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def handle_request(request: WorkerRequest) -> dict[str, Any]:
    verify_checkout(Path.cwd())
    if request.operation == "ping":
        return {"benchmark": "tau3", "revision": TAU_REVISION, "mode": "half_duplex"}

    # Native imports are intentionally inside the worker's redirected handler.
    from tau2.data_model.simulation import Results, TextRunConfig
    from tau2.runner.build import _build_env_kwargs, build_text_orchestrator
    from tau2.runner.helpers import get_info, get_tasks
    from tau2.runner.simulation import run_simulation

    spec = request.payload
    assert spec is not None
    output = Path(spec.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    result_path = output / "results.json"
    context_path = output / "contexts.json"
    capture_path = output / "capture_manifest.json"
    if result_path.exists() or context_path.exists() or capture_path.exists():
        raise ValueError(
            "Use a new output directory; existing capture artifacts will not be overwritten"
        )
    capture_manifest = {
        "schema_version": 1,
        "revision": TAU_REVISION,
        "request": request.model_dump(mode="json"),
        "trial_seeds": list(spec.seeds),
        "complete": False,
        "native_evaluation": request.operation == "run",
        "actor_provider_payload_audited": False,
        "event_execution_clocks_available": False,
    }
    # Persist the intended cohort/config before environment construction, which
    # can itself call an embedding provider in a full banking run.
    _save(capture_path, capture_manifest)
    config = TextRunConfig(
        domain=spec.domain,
        agent="llm_agent",
        llm_agent=spec.actor_model,
        llm_args_agent=spec.actor_args,
        llm_user=spec.user_model,
        llm_args_user=spec.user_args,
        task_ids=list(spec.task_ids),
        task_set_name=spec.task_set_name,
        task_split_name=spec.task_split_name,
        num_trials=len(spec.seeds),
        max_steps=spec.max_steps,
        max_errors=spec.max_errors,
        seed=spec.seeds[0],
        retrieval_config=spec.retrieval_config,
    )
    tasks = get_tasks(
        spec.task_set_name or spec.domain,
        task_split_name=spec.task_split_name,
        task_ids=list(spec.task_ids),
    )
    by_id = {task.id: task for task in tasks}
    if set(by_id) != set(spec.task_ids):
        raise ValueError("Requested task IDs do not exactly match the native task cohort")
    info = get_info(config)
    if info.git_commit != TAU_REVISION:
        raise ValueError("Native benchmark provenance does not match the verified checkout")
    contexts: dict[str, PublicContext] = {}
    simulations = []
    fingerprint_payload = spec.model_dump(mode="json", exclude={"output_dir"})
    fingerprint = json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":"))
    for trial, seed in enumerate(spec.seeds):
        for task_id in spec.task_ids:
            task = by_id[task_id]
            simulation_id = hashlib.sha256(
                f"{fingerprint}:{task_id}:{trial}:{seed}".encode()
            ).hexdigest()[:32]
            orchestrator = build_text_orchestrator(
                config,
                task,
                seed=seed,
                simulation_id=simulation_id,
            )
            if type(orchestrator.agent).__name__ != "LLMAgent":
                raise ValueError("Native agent is not the audited LLMAgent implementation")
            tools = []
            for tool in orchestrator.agent.tools:
                function = tool.openai_schema["function"]
                tools.append(
                    ToolContract(
                        name=function["name"],
                        description=function.get("description", ""),
                        parameters=function["parameters"],
                        version=TAU_REVISION,
                    )
                )
            # This is the exact LLMAgent system prompt before execution. Task
            # descriptions, expected actions and user simulator instructions are excluded.
            contexts[simulation_id] = PublicContext(
                policy=orchestrator.environment.get_policy(),
                tools=tuple(tools),
                system_messages=(orchestrator.agent.system_prompt,),
            )
            bundle = ContextBundle(
                domain=spec.domain, capture_source="native_pre_execution", contexts=contexts
            )
            _save(context_path, bundle.model_dump(mode="json"))
            if request.operation == "run":
                simulation = run_simulation(
                    orchestrator,
                    env_kwargs=_build_env_kwargs(config, task) or None,
                )
                simulation.trial = trial
                simulation.seed = seed
                simulations.append(simulation)
                results = Results(info=info, tasks=tasks, simulations=simulations)
                _save(result_path, results.model_dump(mode="json"))
    artifact_hashes = {"contexts.json": file_hash(context_path)}
    if request.operation == "run":
        artifact_hashes["results.json"] = file_hash(result_path)
    _save(capture_path, {**capture_manifest, "complete": True, "artifact_hashes": artifact_hashes})
    return {
        "contexts_path": str(context_path),
        "simulations": len(simulations),
        "contexts": len(contexts),
        "results_path": str(result_path) if request.operation == "run" else None,
    }


if __name__ == "__main__":
    serve(handle_request, sys.stdin, sys.stdout, sys.stderr)
