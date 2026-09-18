"""Regression cases from the independent causal-replay review."""

import pytest

from goalspec.fixtures import demo_corpus
from goalspec.replay import initial_prefix
from goalspec.schemas import Event, Outcome, ToolContract, Trajectory
from goalspec.splits import make_splits


def make_trace(events):
    return Trajectory(
        trajectory_id="review", benchmark="fixture", domain="review", task_id="task",
        group_id="template", trial=0, source_kind="synthetic", benchmark_revision="fixture",
        policy="Visible policy", initial_tools=(), events=tuple(events),
        outcome=Outcome(status="completed", success=True),
    )


def test_catalog_metadata_does_not_truncate_the_initial_user_request():
    tool = ToolContract(name="lookup")
    trace = make_trace([
        Event(seq=0, kind="tools", tools=(tool,)),
        Event(seq=1, kind="message", role="user", content="Find my shipment"),
        Event(seq=2, kind="tool_request", call_id="a", tool="lookup", arguments={}),
        Event(seq=3, kind="tool_result", call_id="a", tool="lookup", result={}, status="success"),
    ])
    prefix = initial_prefix(trace)
    assert prefix.query == "Find my shipment"
    assert prefix.tools == (tool,)
    assert prefix.through_seq == 1


def test_completed_recordings_require_every_authoritative_tool_result():
    with pytest.raises(ValueError, match="resolve every tool request"):
        make_trace([
            Event(seq=0, kind="message", role="user", content="Find my shipment"),
            Event(seq=1, kind="tool_request", call_id="a", tool="lookup", arguments={}),
        ])


def test_initial_goal_context_includes_request_after_native_actor_greeting():
    trace = make_trace([
        Event(seq=0, kind="message", role="assistant", content="How may I help?"),
        Event(seq=1, kind="message", role="user", content="Return my order"),
        Event(seq=2, kind="message", role="assistant", content="FUTURE_RETURN_ARGUMENT"),
        Event(seq=3, kind="tool_request", call_id="a", tool="lookup", arguments={}),
        Event(seq=4, kind="tool_result", call_id="a", tool="lookup", result={}, status="success"),
    ])
    prefix = initial_prefix(trace)
    assert prefix.query == "Return my order"
    assert prefix.through_seq == 1
    assert "FUTURE_RETURN_ARGUMENT" not in prefix.model_dump_json()


@pytest.mark.parametrize("corruption", ["missing", "duplicate", "out_of_range"])
def test_split_requires_the_full_declared_unique_trial_grid(corruption):
    corpus = demo_corpus(groups=5, trials=4)
    if corruption == "missing":
        corpus = corpus[:-1]
    elif corruption == "duplicate":
        corpus.append(corpus[0].model_copy(update={"trajectory_id": "duplicated-trial"}))
    else:
        corpus[-1] = corpus[-1].model_copy(update={"trial": 8})
    with pytest.raises(ValueError, match="complete declared unique trial grid"):
        make_splits(corpus, expected_trials=4)
