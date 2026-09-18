import json
from types import SimpleNamespace

import pytest

from goalspec.cli_classifier import capture_initial_goals, parse_generation
from goalspec.experiment import fit
from goalspec.fixtures import demo_corpus
from goalspec.goal_backends import BackendConfig, GoalBackend
from goalspec.replay import initial_prefix
from goalspec.splits import make_splits


def generation(predictions, *, tool=None, complete=True):
    events = [{"type": "thread.started", "thread_id": "isolated"}, {"type": "turn.started"}]
    if tool:
        events.append({"type": "item.started", "item": {"type": tool}})
    events.append({"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps({"predictions": predictions})}})
    if complete:
        events.append({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 5}})
    return "\n".join(json.dumps(event) for event in events)


def prediction(input_id="input-a", goal_id="goal-a", probability=1.0):
    return {"input_id": input_id, "goals": [{"goal_id": goal_id, "probability": probability}]}


def test_classifier_parser_accepts_only_complete_scoped_probability_distributions():
    values, usage = parse_generation(generation([prediction()]), {"input-a"}, {"goal-a", "__unknown__"})
    assert values == {"input-a": {"goal-a": 1.0}}
    assert usage["input_tokens"] == 10


@pytest.mark.parametrize("tool", ["command_execution", "mcp_tool_call", "web_search", "file_change"])
def test_classifier_rejects_any_tool_use_even_with_valid_final_json(tool):
    with pytest.raises(ValueError, match="tool"):
        parse_generation(generation([prediction()], tool=tool), {"input-a"}, {"goal-a"})


@pytest.mark.parametrize("items", [[], [prediction("unexpected")], [prediction(), prediction()], [prediction(goal_id="not-in-catalog")], [{"input_id": "input-a", "goals": [{"goal_id": "goal-a", "probability": 0.5}, {"goal_id": "goal-a", "probability": 0.5}]}]])
def test_classifier_rejects_partial_duplicate_or_unknown_output(items):
    with pytest.raises(ValueError):
        parse_generation(generation(items), {"input-a"}, {"goal-a"})


@pytest.mark.parametrize("mass", [0.0, -0.1, 2.0, float("nan"), float("inf")])
def test_classifier_rejects_nonprobability_mass_instead_of_normalizing_it(mass):
    with pytest.raises(ValueError):
        parse_generation(generation([prediction(probability=mass)]), {"input-a"}, {"goal-a"})


def test_classifier_rejects_unfinished_generation():
    with pytest.raises(ValueError, match="did not complete"):
        parse_generation(generation([prediction()], complete=False), {"input-a"}, {"goal-a"})


def test_classifier_capture_with_mock_runner_passes_only_public_single_inputs(tmp_path):
    corpus = demo_corpus(groups=5, trials=1)
    split = make_splits(corpus, expected_trials=1)
    bundle = tmp_path / "bundle"
    fit(corpus, split, bundle)
    prompts = []

    def runner(arguments, **kwargs):
        if "--version" in arguments:
            return SimpleNamespace(returncode=0, stdout="codex mock-test", stderr="")
        assert "--ephemeral" in arguments and "--ignore-user-config" in arguments
        assert "read-only" in arguments and "--disable" in arguments
        prompt = kwargs["input"]
        body = json.loads(prompt.split("\n", 1)[1])
        assert len(body["requests"]) == 1
        assert "task_id" not in prompt and "group_id" not in prompt
        assert "native_reward" not in prompt and "outcome" not in prompt
        assert not any(event["kind"] in {"tool_request", "tool_result"} for request in body["requests"] for event in request["observations"])
        prompts.append(prompt)
        results = [prediction(item["input_id"], body["goals"][0]["goal_id"]) for item in body["requests"]]
        return SimpleNamespace(returncode=0, stdout=generation(results), stderr="")

    path = capture_initial_goals(corpus, split, bundle, tmp_path / "capture", model="mock/model", executable="mock-codex", runner=runner)
    config = BackendConfig.model_validate_json(path.read_text(encoding="utf-8"))
    from goalspec.experiment import load_bundle

    _, catalog, _ = load_bundle(corpus, split, bundle)
    backend = GoalBackend(catalog, config)
    for trace in split.select(corpus, "development"):
        assert backend.predict(initial_prefix(trace)).probabilities
    assert prompts
