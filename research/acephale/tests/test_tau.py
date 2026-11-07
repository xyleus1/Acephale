import copy
import json

import pytest

from acephale.adapters.tau import TAU_REVISION, ContextBundle, PublicContext, import_tau
from acephale.schemas import ToolContract
from acephale.storage import content_hash, file_hash


@pytest.fixture
def tau_files(tmp_path):
    raw = {
        "info": {
            "git_commit": TAU_REVISION,
            "num_trials": 1,
            "agent_info": {
                "implementation": "llm_agent",
                "llm": "test/actor",
                "llm_args": {"temperature": 0},
            },
            "environment_info": {"domain_name": "retail", "policy": "Public policy"},
            "user_info": {
                "llm": "test/user",
                "llm_args": {"temperature": 0},
                "global_simulation_guidelines": "HIDDEN_USER_INSTRUCTIONS",
            },
        },
        "tasks": [{"id": "task-1", "evaluation_criteria": {"expected": "SECRET_REFERENCE_PATH"}}],
        "simulations": [
            {
                "id": "sim-1",
                "task_id": "task-1",
                "trial": 0,
                "mode": "half_duplex",
                "duration": 2.5,
                "termination_reason": "user_stop",
                "reward_info": {"reward": 1.0, "action_checks": [{"private": "SECRET_EVALUATOR"}]},
                "messages": [
                    {"role": "assistant", "content": "How can I help?"},
                    {"role": "user", "content": "Please return the item."},
                    {
                        "role": "user",
                        "content": "HIDDEN_USER_ACTION",
                        "tool_calls": [
                            {
                                "id": "private-1",
                                "name": "private_tool",
                                "arguments": {},
                                "requestor": "user",
                            }
                        ],
                    },
                    {
                        "role": "tool",
                        "id": "private-1",
                        "requestor": "user",
                        "content": "SECRET_USER_STATE",
                    },
                    {
                        "role": "assistant",
                        "content": None,
                        "raw_data": {"future": "PRIVATE_REASONING"},
                        "tool_calls": [
                            {"id": "call-a", "name": "get_order", "arguments": {"id": "1"}},
                            {"id": "call-b", "name": "get_policy", "arguments": {}},
                        ],
                    },
                    {
                        "role": "tool",
                        "tool_messages": [
                            {"role": "tool", "id": "call-b", "content": "eligible", "error": False},
                            {
                                "role": "tool",
                                "id": "call-a",
                                "content": '{"item": "book"}',
                                "error": False,
                            },
                        ],
                    },
                    {
                        "role": "assistant",
                        "content": "Your return is initiated.",
                        "generation_time_seconds": 0.2,
                    },
                ],
            }
        ],
    }
    context = ContextBundle(
        domain="retail",
        capture_source="external_audit",
        contexts={
            "sim-1": PublicContext(
                policy="Public policy",
                tools=(
                    ToolContract(name="get_order"),
                    ToolContract(name="get_policy"),
                    ToolContract(name="unused_public_tool"),
                ),
                system_messages=("Exact public system prompt",),
            ),
        },
    )
    results_path = tmp_path / "native.json"
    contexts_path = tmp_path / "contexts.json"
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    contexts_path.write_text(context.model_dump_json(), encoding="utf-8")
    return raw, results_path, contexts_path


def test_native_mock_domain_is_never_scientific_evidence(tau_files):
    raw, results_path, contexts_path = tau_files
    raw["info"]["environment_info"]["domain_name"] = "mock"
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    contexts = json.loads(contexts_path.read_text(encoding="utf-8"))
    contexts["domain"] = "mock"
    contexts_path.write_text(json.dumps(contexts), encoding="utf-8")
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.source_kind == "synthetic"


def test_native_projection_keeps_public_causal_order_and_reward(tau_files):
    _, results_path, contexts_path = tau_files
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.outcome.native_reward == 1.0
    assert trajectory.outcome.success is True
    assert trajectory.total_elapsed_ms == 2500
    assert trajectory.group_id == "retail:ungrouped"
    encoded = trajectory.model_dump_json()
    assert not any(secret in encoded for secret in ("HIDDEN", "SECRET", "PRIVATE_REASONING"))
    requests = [event for event in trajectory.events if event.kind == "tool_request"]
    results = [event for event in trajectory.events if event.kind == "tool_result"]
    assert [event.call_id for event in requests] == ["call-a", "call-b"]
    assert requests[0].batch_id == requests[1].batch_id
    assert [event.call_id for event in results] == ["call-b", "call-a"]
    assert results[1].result == {"item": "book"}
    assert all(event.observed_at_ns is None for event in trajectory.events)
    assert all(event.duration_ms is None for event in results)
    assert trajectory.events[-1].duration_ms == 200
    assert "unused_public_tool" in {tool.name for tool in trajectory.initial_tools}
    assert all(tool.side_effects == "unknown" for tool in trajectory.initial_tools)


def test_labels_are_offline_and_required_for_audited_grouping(tau_files, tmp_path):
    _, results_path, contexts_path = tau_files
    labels = tmp_path / "labels.json"
    labels.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "tasks": {
                    "task-1": {
                        "group_id": "return-template",
                        "goal": {
                            "goal_id": "return",
                            "objective": "RETURN_ITEM",
                            "object_type": "order item",
                            "completion": ["return initiated"],
                            "constraints": [],
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    [trajectory] = import_tau(results_path, contexts_path=contexts_path, labels_path=labels)
    assert trajectory.group_id == "return-template"
    assert trajectory.outcome.goal.objective == "RETURN_ITEM"
    assert all("RETURN_ITEM" not in (event.content or "") for event in trajectory.events)


@pytest.mark.parametrize(
    "reason, reward, status",
    [
        ("user_stop", 0.0, "failed"),
        ("agent_error", None, "error"),
        ("max_steps", None, "incomplete"),
        ("timeout", 0.0, "failed"),
    ],
)
def test_failure_simulations_are_retained(tau_files, reason, reward, status):
    raw, results_path, contexts_path = tau_files
    simulation = raw["simulations"][0]
    simulation["termination_reason"] = reason
    simulation["reward_info"] = {"reward": reward} if reward is not None else None
    if reason != "user_stop":
        simulation["messages"] = None
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.outcome.status == status
    assert trajectory.outcome.native_reward == reward


@pytest.mark.parametrize(
    "mutation, match",
    [
        (lambda raw: raw["info"].update(git_commit="unknown"), "revision"),
        (lambda raw: raw["info"]["agent_info"].update(implementation="llm_agent_gt"), "audited"),
        (lambda raw: raw["info"].update(retrieval_config="golden_retrieval"), "Ground-truth"),
        (lambda raw: raw["simulations"][0].update(mode="full_duplex"), "half-duplex"),
        (lambda raw: raw["simulations"][0].update(trial=None), "trial"),
        (
            lambda raw: raw["simulations"][0].update(termination_reason="new_unknown_state"),
            "termination",
        ),
        (
            lambda raw: raw["simulations"][0]["messages"].append(
                {"role": "developer", "content": "x"}
            ),
            "role",
        ),
        (lambda raw: raw["info"].update(num_trials=2), "incomplete"),
    ],
)
def test_unsupported_or_unaudited_inputs_fail(tau_files, mutation, match):
    raw, results_path, contexts_path = tau_files
    mutation(raw)
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match=match):
        import_tau(results_path, contexts_path=contexts_path)


def test_directory_import_checks_simulation_index(tau_files, tmp_path):
    raw, _, contexts_path = tau_files
    directory = tmp_path / "directory"
    simulations = directory / "simulations"
    simulations.mkdir(parents=True)
    simulation = raw.pop("simulations")[0]
    raw["simulation_index"] = [{"id": "sim-1", "task_id": "task-1", "trial": 0}]
    (directory / "results.json").write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match="Missing or extra"):
        import_tau(directory, contexts_path=contexts_path)
    (simulations / "sim-1.json").write_text(json.dumps(simulation), encoding="utf-8")
    assert len(import_tau(directory, contexts_path=contexts_path)) == 1
    extra = copy.deepcopy(simulation)
    extra["id"] = "extra"
    (simulations / "extra.json").write_text(json.dumps(extra), encoding="utf-8")
    with pytest.raises(ValueError, match="Missing or extra"):
        import_tau(directory, contexts_path=contexts_path)


def test_missing_context_never_falls_back_to_future_tools(tau_files):
    _, results_path, contexts_path = tau_files
    bundle = json.loads(contexts_path.read_text(encoding="utf-8"))
    bundle["contexts"] = {}
    contexts_path.write_text(json.dumps(bundle), encoding="utf-8")
    with pytest.raises(ValueError, match="cohorts"):
        import_tau(results_path, contexts_path=contexts_path)


def test_native_success_uses_official_reward_tolerance_even_on_timeout(tau_files):
    raw, results_path, contexts_path = tau_files
    raw["simulations"][0]["reward_info"]["reward"] = 0.9999995
    raw["simulations"][0]["termination_reason"] = "timeout"
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.outcome.success is True
    assert trajectory.outcome.status == "completed"
    assert trajectory.outcome.native_termination_reason == "timeout"
    assert trajectory.outcome.native_excluded_from_success is False


def test_infrastructure_failure_kept_and_marked_for_native_exclusion(tau_files):
    raw, results_path, contexts_path = tau_files
    raw["simulations"][0].update(
        reward_info=None, messages=None, termination_reason="infrastructure_error"
    )
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.outcome.native_termination_reason == "infrastructure_error"
    assert trajectory.outcome.native_excluded_from_success is True
    assert trajectory.outcome.status == "error"


def test_import_provenance_links_models_configs_and_exact_source_files(tau_files):
    raw, results_path, contexts_path = tau_files
    [before] = import_tau(results_path, contexts_path=contexts_path)
    assert before.provenance.actor_model == "test/actor"
    assert before.provenance.user_model == "test/user"
    assert before.provenance.raw_results_hash == file_hash(results_path)
    assert before.provenance.public_context_hash == file_hash(contexts_path)
    assert before.provenance.actor_config_hash == content_hash(raw["info"]["agent_info"])
    raw["info"]["agent_info"]["llm_args"]["temperature"] = 0.5
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    [after] = import_tau(results_path, contexts_path=contexts_path)
    assert before.events == after.events
    assert before.provenance.actor_config_hash != after.provenance.actor_config_hash
    assert before.provenance.raw_results_hash != after.provenance.raw_results_hash
    assert content_hash(before) != content_hash(after)


def test_context_bytes_are_part_of_import_identity(tau_files):
    _, results_path, contexts_path = tau_files
    [before] = import_tau(results_path, contexts_path=contexts_path)
    contexts_path.write_text(contexts_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    [after] = import_tau(results_path, contexts_path=contexts_path)
    assert before.events == after.events
    assert before.provenance.public_context_hash != after.provenance.public_context_hash


def test_capture_manifest_must_match_native_models_and_completed_cohort(tau_files):
    raw, results_path, contexts_path = tau_files
    capture_path = results_path.parent / "capture_manifest.json"
    capture = {
        "schema_version": 1,
        "revision": TAU_REVISION,
        "complete": False,
        "native_evaluation": True,
        "trial_seeds": [None],
        "request": {
            "operation": "run",
            "payload": {
                "actor_model": "test/actor",
                "user_model": "test/user",
                "domain": "retail",
            },
        },
    }
    capture_path.write_text(json.dumps(capture), encoding="utf-8")
    with pytest.raises(ValueError, match="completed native"):
        import_tau(results_path, contexts_path=contexts_path)
    capture["complete"] = True
    capture_path.write_text(json.dumps(capture), encoding="utf-8")
    [trajectory] = import_tau(results_path, contexts_path=contexts_path)
    assert trajectory.provenance.capture_manifest_hash == file_hash(capture_path)
    raw["info"]["agent_info"]["llm"] = "different/actor"
    results_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match="models or domain"):
        import_tau(results_path, contexts_path=contexts_path)


def test_native_capture_artifact_hashes_reject_mutated_sources(tau_files):
    _, results_path, contexts_path = tau_files
    capture = {
        "schema_version": 1,
        "revision": TAU_REVISION,
        "complete": True,
        "native_evaluation": True,
        "trial_seeds": [None],
        "request": {
            "operation": "run",
            "payload": {
                "actor_model": "test/actor",
                "user_model": "test/user",
                "domain": "retail",
            },
        },
        "artifact_hashes": {
            "results.json": file_hash(results_path),
            "contexts.json": file_hash(contexts_path),
        },
    }
    (results_path.parent / "capture_manifest.json").write_text(
        json.dumps(capture), encoding="utf-8"
    )
    assert len(import_tau(results_path, contexts_path=contexts_path)) == 1
    contexts_path.write_text(contexts_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="artifact hash mismatch"):
        import_tau(results_path, contexts_path=contexts_path)
