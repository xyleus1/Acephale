"""Synthetic mechanism checks, explicitly ineligible as scientific gate evidence."""

from goalspec.schemas import Event, GoalSignature, Outcome, ToolContract, Trajectory


def demo_corpus(groups: int = 30, trials: int = 4) -> list[Trajectory]:
    goals = [
        GoalSignature(goal_id="return", objective="return item", object_type="order item",
                      completion=("return initiated", "refund selected"), constraints=("eligibility satisfied",)),
        GoalSignature(goal_id="expedite", objective="expedite shipment", object_type="shipment",
                      completion=("delivery before requested date",), constraints=("cost approved",)),
        GoalSignature(goal_id="track", objective="track shipment", object_type="shipment",
                      completion=("current delivery status communicated",)),
    ]
    targets = ["initiate_return", "expedite_shipment", "delivery_status"]
    queries = [
        "Please return my order item and select a refund after checking eligibility.",
        "Please expedite shipment delivery before the requested date with cost approval.",
        "Please track shipment and communicate its current delivery status.",
    ]
    tools = tuple(ToolContract(
        name=name, description=name.replace("_", " "), version="fixture-v1",
        parameters={"type": "object", "properties": {"item_id": {"type": "string"}}, "required": ["item_id"], "additionalProperties": False},
        side_effects="read_only" if name in {"lookup", "delivery_status"} else "mutating",
        cacheable=name in {"lookup", "delivery_status"}, freshness="state_epoch",
    ) for name in ["lookup", *targets])
    result = []
    for group in range(groups):
        for goal, target, query in zip(goals, targets, queries, strict=True):
            task_id = f"case-{group}-{goal.goal_id}"
            for trial in range(trials):
                item_id = f"item-{group}"
                result.append(Trajectory(
                    trajectory_id=f"synthetic/{task_id}/{trial}", benchmark="synthetic", domain="retail",
                    task_id=task_id, group_id=f"family-{group}", trial=trial, source_kind="synthetic",
                    benchmark_revision="mechanism-fixture-v1", policy="Respect eligibility and cost approval.",
                    initial_tools=tools,
                    events=(
                        Event(seq=0, kind="message", role="user", content=f"{query} Item reference: {item_id}"),
                        Event(seq=1, kind="tool_request", tool="lookup", call_id="lookup", arguments={"item_id": item_id}, batch_id="b0"),
                        Event(seq=2, kind="tool_result", role="tool", tool="lookup", call_id="lookup", result={"item_id": item_id}, status="success"),
                        Event(seq=3, kind="tool_request", tool=target, call_id="finish", arguments={"item_id": item_id}, batch_id="b1"),
                        Event(seq=4, kind="tool_result", role="tool", tool=target, call_id="finish", result={"done": True}, status="success"),
                        Event(seq=5, kind="message", role="assistant", content="Completed."),
                    ),
                    outcome=Outcome(status="completed", success=True, goal=goal, native_reward=1.0, evaluator_version="fixture-v1"),
                ))
    return result
