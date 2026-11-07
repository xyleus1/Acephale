import pytest

from acephale.goals import UNKNOWN_GOAL, GoalCatalog, canonical_goal, fit_goals, normalize_goal
from acephale.replay import initial_prefix
from acephale.schemas import Event, GoalSignature, Outcome, Trajectory


def trajectory(index, objective, query, *, domain="retail", success=True):
    return Trajectory(trajectory_id=f"trajectory-{index}", benchmark="fixture", domain=domain, task_id=f"task-{index}", group_id=f"group-{index}", trial=0, source_kind="synthetic", benchmark_revision="test", policy="Follow policy", initial_tools=(), events=(Event(seq=0, kind="message", role="user", content=query), Event(seq=1, kind="message", role="assistant", content="A future answer must not enter retrieval")), outcome=Outcome(status="completed" if success else "failed", success=success, goal=GoalSignature(goal_id=f"upstream-{index}", objective=objective, object_type="order item", completion=(objective.lower(),))))


def test_semantic_goal_ids_ignore_source_ids_order_and_explicit_identity_fields():
    first = GoalSignature(goal_id="first", objective="RETURN_ITEM", object_type="order", completion=("refund selected", "return initiated"), constraints=("order_id=ABC123 eligible",))
    second = GoalSignature(goal_id="second", objective=" return_item ", object_type="order", completion=("return initiated", "refund selected"), constraints=("order_id=XYZ987 eligible",))
    assert normalize_goal(first) == normalize_goal(second)
    assert "ABC123" not in normalize_goal(first).text
    assert normalize_goal(normalize_goal(first)) == normalize_goal(first)


def test_canonical_goal_does_not_use_realized_path_or_record_ids():
    base = trajectory(1, "RETURN_ITEM", "Return this")
    goal = base.outcome.goal.model_copy(update={"completion": ("return initiated",)})
    base = base.model_copy(update={"outcome": base.outcome.model_copy(update={"goal": goal})})
    events = (*base.events, Event(seq=2, kind="tool_request", tool="lookup", arguments={"customer_name": "return"}, call_id="a"), Event(seq=3, kind="tool_result", tool="lookup", result={"name": "initiated"}, status="success", call_id="a"))
    other = base.model_copy(update={"events": events, "trajectory_id": "return", "task_id": "initiated", "group_id": "return initiated"})
    assert canonical_goal(base) == canonical_goal(other)
    assert canonical_goal(other).completion == ("return initiated",)


def test_numeric_policy_constraints_are_preserved_and_explicit_slots_supported():
    first = GoalSignature(goal_id="a", objective="RETURN_ITEM", object_type="order item", completion=("return initiated",), constraints=("eligible within 30 days", "confirmation required above 100.50 USD"))
    second = first.model_copy(update={"constraints": ("eligible within 60 days", "confirmation required above 200.50 USD")})
    assert normalize_goal(first).goal_id != normalize_goal(second).goal_id
    assert "30 days" in normalize_goal(first).text
    assert "100.50 usd" in normalize_goal(first).text
    named = first.model_copy(update={"object_type": "order 1234 for Alice"})
    explicit = normalize_goal(named, instance_values=("1234", "Alice"))
    assert "1234" not in explicit.text and "alice" not in explicit.text
    assert "30 days" in explicit.text


def test_goal_catalog_uses_successful_initial_context_only_and_roundtrips():
    records = [trajectory(1, "RETURN_ITEM", "Return my purchase for refund"), trajectory(2, "EXPEDITE_SHIPMENT", "Deliver the shipment urgently before tomorrow"), trajectory(3, "FAILED_SECRET_GOAL", "ignored", success=False)]
    catalog = fit_goals(records)
    assert len(catalog.signatures) == 2
    assert all("future answer" not in example.text for example in catalog.examples)
    assert all("FAILED_SECRET" not in signature.objective for signature in catalog.signatures)
    public = initial_prefix(trajectory(99, "DO_NOT_READ_THIS", "Return my purchase for refund"))
    predicted = catalog.predict(public)
    expected = canonical_goal(records[0]).goal_id
    assert max(predicted.probabilities, key=predicted.probabilities.get) == expected
    assert sum(predicted.probabilities.values()) == pytest.approx(1)
    assert UNKNOWN_GOAL in predicted.probabilities
    assert "uncalibrated" in predicted.model_id
    assert GoalCatalog.model_validate_json(catalog.model_dump_json()).predict(public) == predicted


def test_unseen_scope_and_unknown_query_abstain():
    catalog = fit_goals([trajectory(1, "RETURN_ITEM", "Return refund")])
    unseen = initial_prefix(trajectory(2, "RETURN_ITEM", "Return refund", domain="banking"))
    assert catalog.predict(unseen).probabilities == {UNKNOWN_GOAL: 1.0}
    no_overlap = unseen.model_copy(update={"domain": "retail", "policy": "", "events": (Event(seq=0, kind="message", role="user", content="xyzzy quux"),)})
    assert catalog.predict(no_overlap).probabilities == {UNKNOWN_GOAL: 1.0}
    assert fit_goals([]).predict(unseen).probabilities == {UNKNOWN_GOAL: 1.0}


def test_visible_user_updates_change_goal_posterior_without_evaluator_access():
    records = [trajectory(1, "RETURN_ITEM", "Return refund purchase"), trajectory(2, "EXPEDITE_SHIPMENT", "Expedite shipment urgent delivery")]
    catalog = fit_goals(records)
    prefix = initial_prefix(trajectory(99, "RETURN_ITEM", "Return refund purchase"))
    updated = prefix.model_copy(update={"through_seq": 2, "events": (*prefix.events, Event(seq=2, kind="message", role="user", content="Expedite shipment urgent delivery expedite shipment urgent delivery"))})
    expedite = canonical_goal(records[1]).goal_id
    assert catalog.predict(updated).probabilities[expedite] > catalog.predict(prefix).probabilities[expedite]


def test_composite_completion_conditions_remain_distinct():
    base = GoalSignature(goal_id="a", objective="RETURN_ITEM", object_type="order item", completion=("return initiated",))
    composite = base.model_copy(update={"completion": ("return initiated", "refund selected")})
    assert normalize_goal(base).goal_id != normalize_goal(composite).goal_id


def test_native_success_is_separate_from_framework_termination_status():
    record = trajectory(1, "RETURN_ITEM", "Return refund")
    native_success = record.model_copy(update={"outcome": record.outcome.model_copy(update={"status": "failed", "native_termination_reason": "max_steps"})})
    assert len(fit_goals([native_success]).signatures) == 1
    for change in ({"status": "incomplete"}, {"native_excluded_from_success": True}, {"success": False}):
        excluded = native_success.model_copy(update={"outcome": native_success.outcome.model_copy(update=change)})
        assert not fit_goals([excluded]).signatures


def test_greeting_before_first_user_does_not_drop_initial_query():
    base = trajectory(1, "RETURN_ITEM", "Return purchase refund")
    events = (Event(seq=0, kind="message", role="assistant", content="How may I help?"), base.events[0].model_copy(update={"seq": 1}), base.events[1].model_copy(update={"seq": 2}))
    native = base.model_copy(update={"events": events})
    catalog = fit_goals([native])
    assert "Return purchase refund" in catalog.examples[0].text
    assert "future answer" not in catalog.examples[0].text
