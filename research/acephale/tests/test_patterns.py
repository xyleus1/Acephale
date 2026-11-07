import pytest

from acephale.binding import (
    ArgumentBinding,
    Expression,
    Reference,
    _schema_validator,
    infer_binding,
    resolve,
)
from acephale.goals import UNKNOWN_GOAL, canonical_goal
from acephale.patterns import Pattern, PatternPool, fit_patterns, frequent_contexts, subsequences
from acephale.replay import decision_points
from acephale.schemas import Event, GoalPosterior, GoalSignature, Outcome, ToolContract, Trajectory


def tool(name, field=None):
    return ToolContract(name=name, parameters={"type": "object", "properties": {field: {"type": "string"}} if field else {}, "required": [field] if field else [], "additionalProperties": False})


def trace(index, objective="RETURN_ITEM", *, fail=False, noise=False, domain="retail"):
    events = [Event(seq=0, kind="message", role="user", content=f"{objective.lower()} for my item")]

    def call(name, arguments, result, status="success"):
        call_id = f"call-{len(events)}"
        events.append(Event(seq=len(events), kind="tool_request", tool=name, arguments=arguments, call_id=call_id))
        events.append(Event(seq=len(events), kind="tool_result", tool=name, result=result, status=status, call_id=call_id))

    call("search", {"query": "item"}, {"list": [{"url": f"https://example.test/{index}/first"}, {"url": f"https://example.test/{index}/second"}], "item_id": f"item-{index}"})
    if noise:
        call("noise", {}, {})
    if objective == "RESEARCH":
        call("fetch", {"url": f"https://example.test/{index}/first"}, {"text": "missing" if fail else "found"}, "error" if fail else "success")
        if fail:
            call("fetch", {"url": f"https://example.test/{index}/second"}, {"text": "found"})
    else:
        call("return_item" if objective == "RETURN_ITEM" else "expedite", {"item_id": f"item-{index}"}, {"ok": True})
    return Trajectory(trajectory_id=f"trajectory-{index}", benchmark="fixture", domain=domain, task_id=f"task-{index}", group_id=f"group-{index}", trial=0, source_kind="synthetic", benchmark_revision="test-v1", policy="Follow the requested outcome", initial_tools=(tool("search", "query"), tool("fetch", "url"), tool("return_item", "item_id"), tool("expedite", "item_id"), tool("noise")), events=tuple(events), outcome=Outcome(status="completed", success=True, goal=GoalSignature(goal_id=f"source-{index}", objective=objective, object_type="item", completion=(f"{objective.lower()} completed",))))


def test_prefix_projection_finds_gaps_repeats_and_group_support():
    projected = dict(frequent_contexts((("a", "x", "b", "a"), ("a", "b", "a"), ("x", "b")), ("g1", "g2", "g3"), 3, 2))
    assert projected[("a", "b", "a")] == (0, 1)
    assert projected[("a", "a")] == (0, 1)
    assert projected[("x", "b")] == (0, 2)
    assert ("b", "x") not in projected
    assert ("a",) in subsequences(("a", "b"), 1)
    assert not frequent_contexts((("a",), ("a",)), ("one-task", "one-task"), 2, 2)


def test_paste_search_then_fetch_and_failure_alternate_symbolic_index():
    pool = fit_patterns([trace(1, "RESEARCH", fail=True), trace(2, "RESEARCH", fail=True)])
    points = list(decision_points(trace(99, "RESEARCH", fail=True)))
    first = pool.predict(points[1].prefix)
    second = pool.predict(points[2].prefix)
    assert first.candidates[0].tool == "fetch"
    assert first.candidates[0].arguments == {"url": "https://example.test/99/first"}
    assert second.candidates[0].arguments == {"url": "https://example.test/99/second"}
    assert first.tool_distribution["fetch"] > 0
    assert any(pattern.context == ("search:success", "fetch:error") for pattern in pool.patterns)
    assert PatternPool.model_validate_json(pool.model_dump_json()).predict(points[2].prefix) == second


def test_subsequence_context_can_match_across_unseen_irrelevant_tool():
    pool = fit_patterns([trace(1, "RESEARCH"), trace(2, "RESEARCH")])
    prefix = list(decision_points(trace(88, "RESEARCH", noise=True)))[2].prefix
    prediction = pool.predict(prefix)
    assert prediction.candidates[0].arguments == {"url": "https://example.test/88/first"}


def test_goal_posterior_mixture_and_unknown_fallback_are_exact():
    returns = [trace(1), trace(2)]
    expedited = [trace(3, "EXPEDITE"), trace(4, "EXPEDITE")]
    pool = fit_patterns([*returns, *expedited])
    prefix = list(decision_points(trace(100)))[1].prefix
    base = pool.predict(prefix)
    goal = canonical_goal(returns[0]).goal_id
    conditioned = pool.predict(prefix, GoalPosterior(probabilities={goal: 1.0}, through_seq=prefix.through_seq))
    assert conditioned.tool_distribution["return_item"] > base.tool_distribution["return_item"]
    mixed = pool.predict(prefix, GoalPosterior(probabilities={goal: 0.25, UNKNOWN_GOAL: 0.75}, through_seq=prefix.through_seq))
    for name in base.tool_distribution:
        assert mixed.tool_distribution[name] == pytest.approx(0.25 * conditioned.tool_distribution[name] + 0.75 * base.tool_distribution[name])
    unknown = pool.predict(prefix, GoalPosterior(probabilities={"unseen-goal": 1.0}, through_seq=prefix.through_seq))
    assert unknown.tool_distribution == base.tool_distribution
    assert next(candidate for candidate in mixed.candidates if candidate.tool == "return_item").arguments == {"item_id": "item-100"}
    with pytest.raises(ValueError, match="beyond"):
        pool.predict(prefix, GoalPosterior(probabilities={goal: 1.0}, through_seq=prefix.through_seq + 1))


def test_all_goal_conditions_share_unconditioned_structural_context():
    prefix = list(decision_points(trace(100, "RESEARCH", noise=True)))[2].prefix
    prefix = prefix.model_copy(update={"tools": (tool("fetch", "url"), tool("return_item", "item_id"))})
    rows = []

    def distribution(context, goal_id, counts, support):
        for name, count in counts.items():
            rows.append(Pattern(pattern_id=f"{goal_id}:{context}:{name}", benchmark="fixture", domain="retail", goal_id=goal_id, context=context, tool=name, support=2, context_support=support, observations=count, context_observations=sum(counts.values()), probability=count / sum(counts.values())))

    # Marginal support prefers search, but goal-specific support prefers noise.
    # Allowing G to choose C would report a .5 -> .88 change without comparing
    # the same structural context. At the fixed search context G adds nothing.
    distribution(("search:success",), None, {"fetch": 20, "return_item": 20}, 10)
    distribution(("noise:success",), None, {"fetch": 36, "return_item": 4}, 5)
    distribution(("search:success",), "goal-a", {"fetch": 2, "return_item": 2}, 2)
    distribution(("noise:success",), "goal-a", {"fetch": 18, "return_item": 2}, 3)
    # A goal with only a shorter context must fall back at the global search C.
    distribution((), "sparse-goal", {"fetch": 19, "return_item": 1}, 2)
    pool = PatternPool(patterns=tuple(rows), training_trajectory_ids=())
    assert pool.selected_context(prefix) == ("search:success",)
    baseline = pool.predict(prefix).tool_distribution
    assert baseline == {"fetch": 0.5, "return_item": 0.5}
    for probabilities in ({"goal-a": 1.0}, {"sparse-goal": 1.0}, {"goal-a": 0.3, "sparse-goal": 0.4, UNKNOWN_GOAL: 0.3}):
        posterior = GoalPosterior(probabilities=probabilities, through_seq=prefix.through_seq)
        assert pool.predict(prefix, posterior).tool_distribution == baseline
    assert pool.conditioning_context == "shared_unconditioned"


def test_support_counts_independent_groups_and_excludes_failed_trajectories():
    one = trace(1)
    repeated = trace(2).model_copy(update={"group_id": one.group_id})
    failed = trace(3).model_copy(update={"outcome": Outcome(status="failed", success=False)})
    pool = fit_patterns([one, repeated, failed])
    assert not pool.patterns
    assert failed.trajectory_id not in pool.training_trajectory_ids
    with pytest.raises(ValueError, match="Duplicate"):
        fit_patterns([one, one])


def test_native_success_survives_noncompleted_termination_but_not_unresolved_calls():
    records = [trace(index) for index in (1, 2)]
    records = [record.model_copy(update={"outcome": record.outcome.model_copy(update={"status": "failed", "native_termination_reason": "max_steps"})}) for record in records]
    assert fit_patterns(records).patterns
    excluded = [record.model_copy(update={"outcome": record.outcome.model_copy(update={"native_excluded_from_success": True})}) for record in records]
    assert not fit_patterns(excluded).patterns
    pending = [record.model_copy(update={"events": (*record.events, Event(seq=len(record.events), kind="tool_request", tool="noise", arguments={}, call_id="unresolved"))}) for record in records]
    assert not fit_patterns(pending).patterns


def test_catalog_visibility_scope_and_schema_validity_control_candidates():
    pool = fit_patterns([trace(1), trace(2)])
    prefix = list(decision_points(trace(90)))[1].prefix
    isolated = pool.predict(prefix.model_copy(update={"domain": "unseen"}))
    assert len(set(isolated.tool_distribution.values())) == 1
    assert not isolated.candidates
    narrowed = prefix.model_copy(update={"tools": (tool("fetch", "url"),)})
    assert pool.predict(narrowed).tool_distribution == {"fetch": 1.0}
    invalid = ToolContract(name="return_item", parameters={"type": "object", "properties": {"item_id": {"type": "integer"}}, "required": ["item_id"]})
    prediction = pool.predict(prefix.model_copy(update={"tools": (invalid,)}))
    assert prediction.tool_distribution == {"return_item": 1.0}
    assert not prediction.candidates


def test_binding_uses_available_json_values_and_rejects_attribute_or_missing_access():
    prefixes = [list(decision_points(trace(index)))[1].prefix for index in (1, 2)]
    binding = infer_binding([(prefix, {"item_id": f"item-{index}"}) for prefix, index in zip(prefixes, (1, 2), strict=True)], tool("return_item", "item_id"))
    assert binding is not None
    heldout = list(decision_points(trace(42)))[1].prefix
    assert binding.bind(heldout, tool("return_item", "item_id")) == {"item_id": "item-42"}
    missing = ArgumentBinding(expression=Expression(kind="object", fields={"item_id": Expression(kind="reference", reference=Reference(source="result", tool="search", path=("missing",)))}), examples=2, total_examples=2)
    assert missing.bind(heldout, tool("return_item", "item_id")) is None
    with pytest.raises(LookupError):
        resolve(Expression(kind="reference", reference=Reference(source="result", tool="search", path=("__class__",))), heldout)
    assert binding.bind(list(decision_points(trace(42)))[0].prefix, tool("return_item", "item_id")) is None


def test_training_rejects_cross_sibling_argument_leakage():
    trajectories = []
    for index in (1, 2):
        base = trace(index, "RESEARCH")
        url = f"https://example.test/{index}/first"
        events = (base.events[0], Event(seq=1, kind="tool_request", tool="search", arguments={"query": url}, call_id="s", batch_id="batch"), Event(seq=2, kind="tool_request", tool="fetch", arguments={"url": url}, call_id="f", batch_id="batch"), Event(seq=3, kind="tool_result", tool="search", result={"url": url}, status="success", call_id="s"), Event(seq=4, kind="tool_result", tool="fetch", result={}, status="success", call_id="f"))
        trajectories.append(base.model_copy(update={"events": events}))
    pool = fit_patterns(trajectories)
    assert all(pattern.binding is None for pattern in pool.patterns if pattern.tool == "fetch")


@pytest.mark.parametrize("field", ["item_id", "itemId"])
def test_repeated_identity_literal_is_not_memorized(field):
    examples = [(list(decision_points(trace(index)))[0].prefix, {field: "some_customer"}) for index in (1, 2)]
    assert infer_binding(examples, tool("return_item", field)) is None


def test_current_failed_results_never_supply_values():
    prefix = list(decision_points(trace(77)))[1].prefix
    failed = prefix.model_copy(update={"events": tuple(event.model_copy(update={"status": "error"}) if event.kind == "tool_result" else event for event in prefix.events)})
    expression = Expression(kind="reference", reference=Reference(source="result", tool="search", path=("item_id",)))
    with pytest.raises(LookupError):
        resolve(expression, failed)


def test_same_tool_parallel_results_bind_by_issuance_not_completion_order():
    prefix = list(decision_points(trace(77)))[0].prefix
    requests = (Event(seq=1, kind="tool_request", tool="search", arguments={"query": "first"}, call_id="a", batch_id="batch"), Event(seq=2, kind="tool_request", tool="search", arguments={"query": "second"}, call_id="b", batch_id="batch"))
    first = Event(seq=3, kind="tool_result", tool="search", result={"url": "first"}, status="success", call_id="a")
    second = Event(seq=4, kind="tool_result", tool="search", result={"url": "second"}, status="success", call_id="b")
    ordered = prefix.model_copy(update={"through_seq": 4, "events": (*prefix.events, *requests, first, second)})
    reordered = prefix.model_copy(update={"through_seq": 4, "events": (*prefix.events, *requests, second.model_copy(update={"seq": 3}), first.model_copy(update={"seq": 4}))})
    expression = Expression(kind="reference", reference=Reference(source="result", tool="search", occurrence=1, path=("url",)))
    assert resolve(expression, ordered) == resolve(expression, reordered) == "second"
    assert ordered.signatures == reordered.signatures


def test_private_indexes_preserve_linear_lookup_semantics_and_artifact_bytes():
    pool = fit_patterns([trace(1), trace(2), trace(3, "EXPEDITE"), trace(4, "EXPEDITE")])
    serialized = pool.model_dump_json()
    prefix = list(decision_points(trace(100)))[1].prefix
    contexts = set(subsequences(prefix.signatures[-pool.max_history:], pool.max_context))
    eligible = [pattern for pattern in pool.patterns if pattern.goal_id is None and pattern.benchmark == prefix.benchmark and pattern.domain == prefix.domain and pattern.context in contexts]
    expected = max(eligible, key=lambda pattern: (len(pattern.context), pattern.context_support, pattern.context_observations, pattern.context)).context
    assert pool.selected_context(prefix) == expected
    for goal_id in {pattern.goal_id for pattern in pool.patterns}:
        linear = tuple(pattern for pattern in pool.patterns if pattern.benchmark == prefix.benchmark and pattern.domain == prefix.domain and pattern.goal_id == goal_id and pattern.context == expected)
        assert pool._matching(prefix, goal_id, expected) == linear
    before = pool.predict(prefix)
    assert pool.model_dump_json() == serialized
    assert pool.model_copy(deep=True).predict(prefix) == before
    cleared = pool.model_copy(update={"patterns": ()})
    assert cleared.selected_context(prefix) is None
    assert not cleared.predict(prefix).candidates
    assert pool.predict(prefix) == before
    assert PatternPool.model_validate_json(serialized).predict(prefix) == before


def test_compiled_schema_cache_keys_content_and_does_not_keep_mutable_schema():
    _schema_validator.cache_clear()
    contract = tool("return_item", "item_id")
    prefix = list(decision_points(trace(42)))[1].prefix
    binding = ArgumentBinding(expression=Expression(kind="object", fields={"item_id": Expression(kind="literal", value="item-42")}), examples=2, total_examples=2)
    assert binding.bind(prefix, contract) == {"item_id": "item-42"}
    assert binding.bind(prefix, contract) == {"item_id": "item-42"}
    assert _schema_validator.cache_info().hits == 1
    contract.parameters["properties"]["item_id"]["type"] = "integer"
    assert binding.bind(prefix, contract) is None
    assert _schema_validator.cache_info().misses == 2
    assert binding.bind(prefix, tool("return_item", "item_id")) == {"item_id": "item-42"}
