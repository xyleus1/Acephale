import pytest

from goalspec.replay import decision_points
from goalspec.schemas import Event, GoalSignature, Outcome, ToolContract, Trajectory


def trace(events, status="completed"):
    return Trajectory(
        trajectory_id="t", benchmark="fixture", domain="test", task_id="task", group_id="g",
        trial=0, source_kind="synthetic", benchmark_revision="fixture", policy="visible policy",
        initial_tools=(ToolContract(name="lookup"), ToolContract(name="fetch")), events=tuple(events),
        outcome=Outcome(status=status, success=True, goal=GoalSignature(
            goal_id="SECRET_GOAL", objective="hidden endpoint", object_type="item", completion=("done",))),
    )


def test_batch_withholds_assistant_reasoning_siblings_and_future():
    trajectory = trace([
        Event(seq=0, kind="message", role="user", content="public request"),
        Event(seq=1, kind="message", role="assistant", content="I will lookup hidden-id"),
        Event(seq=2, kind="tool_request", call_id="a", tool="lookup", arguments={"id": "hidden-id"}, batch_id="b"),
        Event(seq=3, kind="tool_request", call_id="b", tool="fetch", arguments={}, batch_id="b"),
        Event(seq=4, kind="tool_result", call_id="b", tool="fetch", result="FUTURE", status="success"),
        Event(seq=5, kind="tool_result", call_id="a", tool="lookup", result="FUTURE", status="success"),
    ])
    points = list(decision_points(trajectory))
    assert len(points) == 1
    point = points[0]
    assert len(point.targets) == 2
    assert point.prefix.through_seq == 0
    text = point.prefix.model_dump_json()
    assert all(secret not in text for secret in ["SECRET_GOAL", "hidden-id", "FUTURE"])


def test_catalog_is_not_inferred_from_future_calls():
    trajectory = trace([Event(seq=0, kind="tool_request", call_id="a", tool="hidden", arguments={})], status="error")
    point = next(decision_points(trajectory))
    assert point.targets[0].tool == "hidden"
    assert "hidden" not in {tool.name for tool in point.prefix.tools}


def test_unresolved_calls_cannot_create_new_decision():
    trajectory = trace([
        Event(seq=0, kind="tool_request", call_id="a", tool="lookup", arguments={}, batch_id="a"),
        Event(seq=1, kind="tool_request", call_id="b", tool="fetch", arguments={}, batch_id="b"),
    ], status="error")
    with pytest.raises(ValueError, match="unresolved"):
        list(decision_points(trajectory))
