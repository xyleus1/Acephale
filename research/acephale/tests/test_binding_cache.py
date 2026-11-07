"""Independent cache correctness checks against the uncached binding language."""

import gc
import weakref

import pytest

import acephale.binding as binding
import acephale.patterns as patterns
from acephale.schemas import Event, GoalSignature, Outcome, PrefixView, ToolContract, Trajectory


def prefix(index, result=None):
    result = result if result is not None else {
        "items": [{"id": f"item-{index}-a"}, {"id": f"item-{index}-b"}],
        "owner_id": f"owner-{index}",
        "irrelevant": "unrelated output that is not an argument",
    }
    return PrefixView(
        trajectory_id=f"trace-{index}", benchmark="fixture", domain="cache-check",
        task_id=f"task-{index}", trial=0, through_seq=2, policy="Respect the requested result",
        tools=(ToolContract(name="lookup"), ToolContract(name="submit")),
        events=(
            Event(seq=0, kind="message", role="user", content="Use the requested items"),
            Event(seq=1, kind="tool_request", tool="lookup", arguments={"query": "lookup"}, call_id="lookup"),
            Event(seq=2, kind="tool_result", tool="lookup", result=result, status="success", call_id="lookup"),
        ),
    )


def arguments(view, mode):
    value = view.events[-1].result
    if mode == "root":
        return value
    if mode == "list":
        return {"selected": value["items"]}
    return {"owner_id": value["owner_id"], "nested": {"selected": [value["items"][1]["id"]]}}


@pytest.mark.parametrize("mode", ["root", "list", "nested"])
def test_cached_bindings_preserve_root_nested_and_list_references(mode):
    views = [prefix(index) for index in (1, 2)]
    examples = [(view, arguments(view, mode)) for view in views]
    contract = ToolContract(name="submit")
    cache = binding.FitReferenceCache(value for _, value in examples)
    plain = binding.infer_binding(examples, contract)
    cached = binding.infer_binding(examples, contract, reference_lookup=cache)
    assert plain is not None
    assert cached.model_dump_json() == plain.model_dump_json()
    heldout = prefix(99)
    assert cached.bind(heldout, contract) == arguments(heldout, mode)


def test_cache_reuses_same_object_without_aliasing_equal_metadata(monkeypatch):
    original = binding._references
    calls = []

    def counted(view):
        calls.append(id(view))
        return original(view)

    monkeypatch.setattr(binding, "_references", counted)
    one = prefix(1)
    two = prefix(2).model_copy(update={"trajectory_id": one.trajectory_id, "task_id": one.task_id})
    cache = binding.FitReferenceCache([arguments(one, "nested"), arguments(two, "nested")])
    first = cache(one)
    assert cache(one) == first
    second = cache(two)
    assert first != second
    assert len(calls) == 2
    assert cache.hits == 1


def test_cache_does_not_keep_public_history_alive():
    view = prefix(1)
    reference = weakref.ref(view)
    cache = binding.FitReferenceCache([arguments(view, "nested")])
    cache(view)
    del view
    gc.collect()
    assert reference() is None


def test_wanted_value_overflow_falls_back_to_complete_uncached_maps():
    view = prefix(1)
    cache = binding.FitReferenceCache([arguments(view, "nested")], wanted_budget_bytes=1)
    assert cache(view) == binding._references(view)
    assert cache(view) == binding._references(view)
    assert cache.hits == 0
    assert cache.used_bytes == 0


def test_lru_eviction_and_zero_budget_change_no_reference_content(monkeypatch):
    original = binding._references
    calls = []

    def counted(view):
        calls.append(id(view))
        return original(view)

    monkeypatch.setattr(binding, "_references", counted)
    one, two = prefix(1), prefix(2)
    wanted = [arguments(one, "nested"), arguments(two, "nested")]
    cache = binding.FitReferenceCache(wanted, max_entries=1)
    expected = cache(one)
    cache(two)
    assert cache(one) == expected
    assert len(calls) == 3
    assert cache.used_bytes <= 32 * 1024**2
    disabled = binding.FitReferenceCache(wanted, budget_bytes=0)
    assert disabled(one) == expected
    assert disabled(one) == expected
    assert disabled.hits == disabled.used_bytes == 0


def test_filtering_does_not_skip_irrelevant_nodes_to_extend_traversal_budget():
    view = prefix(1, {"aaa": list(range(binding.MAX_LEAVES + 20)), "zzz": "needle"})
    cache = binding.FitReferenceCache([{"selected": "needle"}])
    # The original language spends its leaf budget before reaching zzz.
    assert binding.canonical("needle") not in binding._references(view)
    assert binding.canonical("needle") not in cache(view)


def test_reference_filtering_keeps_json_types_and_rejects_failed_sources():
    view = prefix(1, {"boolean": True, "integer": 1, "decimal": 1.0, "string": "1"})
    cache = binding.FitReferenceCache([{"value": value} for value in (True, 1, 1.0, "1")])
    found = cache(view)
    keys = [binding.canonical(value) for value in (True, 1, 1.0, "1")]
    assert len(set(keys)) == 4
    assert all(key in found for key in keys)
    failed = view.model_copy(update={"events": (*view.events[:-1], view.events[-1].model_copy(update={"status": "error"}))})
    assert all(key not in cache(failed) for key in keys)


def training_trace(index):
    view = prefix(index)
    events = list(view.events)
    for turn in (1, 2):
        identifier = f"submit-{turn}"
        events.append(Event(seq=len(events), kind="tool_request", tool="submit", arguments=arguments(view, "nested"), call_id=identifier))
        events.append(Event(seq=len(events), kind="tool_result", tool="submit", result={"ok": True}, status="success", call_id=identifier))
    return Trajectory(
        trajectory_id=view.trajectory_id, benchmark=view.benchmark, domain=view.domain,
        task_id=view.task_id, group_id=f"family-{index}", trial=0, source_kind="synthetic",
        benchmark_revision="cache-test", policy=view.policy, initial_tools=view.tools,
        events=tuple(events), outcome=Outcome(
            status="completed", success=True,
            goal=GoalSignature(goal_id="submitted", objective="SUBMIT_ITEMS", object_type="items", completion=("items submitted",)),
        ),
    )


def test_complete_fitted_pool_bytes_match_uncached_implementation(monkeypatch):
    trajectories = [training_trace(index) for index in (1, 2, 3)]
    cached = patterns.fit_patterns(trajectories)
    monkeypatch.setattr(patterns, "FitReferenceCache", lambda *_args, **_kwargs: binding._references)
    uncached = patterns.fit_patterns(trajectories)
    assert any(pattern.binding is not None for pattern in cached.patterns)
    assert cached.model_dump_json() == uncached.model_dump_json()


def test_complete_fitted_pool_bytes_match_on_wanted_budget_overflow(monkeypatch):
    trajectories = [training_trace(index) for index in (1, 2, 3)]
    original = binding.FitReferenceCache
    normal = patterns.fit_patterns(trajectories)
    monkeypatch.setattr(patterns, "FitReferenceCache", lambda values: original(values, wanted_budget_bytes=1))
    overflow = patterns.fit_patterns(trajectories)
    assert normal.model_dump_json() == overflow.model_dump_json()
