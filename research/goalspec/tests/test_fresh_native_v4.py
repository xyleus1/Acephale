import copy
from collections import Counter

import pytest

from goalspec.fresh_tasks import build_tasks as build_v1
from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v2 import build_tasks as build_v2
from goalspec.fresh_tasks_v4 import STRUCTURES, build_tasks
from goalspec.native_live_v4 import (
    ARMS,
    _failure_row,
    completed_success,
    execution_sources,
    make_design,
    validate_manifest,
)


def manifest(stage="development"):
    value = {"generator": "fresh-native-v4", "nativeCommit": "2174a603f6d014ef94473ffa95957f6ce27100db",
             "studyStage": stage, "studyId": "study-v4-test", "tasks": build_tasks("study-v4-test", stage)}
    value["manifestHash"] = digest(value)
    return value


def budget(development=13.6, heldout=86.25):
    return {"totalCeilingUsd": 500, "allocations": [
        {"allocation": "development", "ceilingUsd": 40, "spentOrReservedUsd": development},
        {"allocation": "heldout", "ceilingUsd": 240, "spentOrReservedUsd": heldout}]}


def development_rows():
    design = make_design(manifest(), budget())
    return [{**trial, "studyId": "study-v4-test", "studyStage": "development", "billedUsd": .2, "budget_terminated": False}
            for trial in design["trials"]]


def test_splits_are_fixed_disjoint_compositions_before_annotation():
    dev, confirmation = build_tasks("study-v4-test", "development"), build_tasks("study-v4-test", "confirmation")
    assert len(dev) == len(confirmation) == 8
    assert Counter(task["domain"] for task in dev) == {"retail": 4, "airline": 4}
    assert not {task["familyId"] for task in dev} & {task["familyId"] for task in confirmation}
    old = build_v1() + build_v2("study-v2-test", "development-1") + build_v2("study-v2-test", "confirmation")
    assert not {task["familyId"] for task in old} & {task["familyId"] for task in dev + confirmation}
    assert len(STRUCTURES) == len(set(STRUCTURES.values())) == 8
    assert confirmation == build_tasks("study-v4-test", "confirmation")
    for task in dev + confirmation:
        assert task["fixtureHash"] == digest({key: value for key, value in task.items() if key != "fixtureHash"})
        assert "###STOP###" not in task["userInstructions"]


def test_variants_change_qualifier_decisions_and_preservation_scopes():
    tasks = build_tasks("study-v4-test", "confirmation")
    for family in {task["familyId"] for task in tasks}:
        variants = [task for task in tasks if task["familyId"] == family]
        assert len({task["branch"] for task in variants}) == 2
    cap = [task for task in tasks if task["familyId"].endswith("upgrade_before_nextday_retime")]
    assert [len(task["referenceActions"]) for task in cap] == [2, 0]
    assert cap[1]["responsePatterns"]
    routing = [task for task in tasks if task["familyId"].endswith("return_connection_other_passenger")]
    assert [len(task["referenceActions"][0]["arguments"]["flights"]) for task in routing] == [2, 1]
    for task in routing:
        moved, corrected = task["referenceActions"]
        assert moved["arguments"]["reservation_id"] != corrected["arguments"]["reservation_id"]


def test_full_dev_grid_is_reserved_and_paired_before_dispatch():
    design = make_design(manifest(), budget())
    assert len(design["trials"]) == 16
    assert design["reserved_usd"] == 20
    assert design["allowance_usd"] == 1.25
    assert design["localConcurrency"] == 1
    for index in range(0, 16, 4):
        block = design["trials"][index:index + 4]
        assert {row["arm"] for row in block} == set(ARMS)
        assert len({row["seed"] for row in block}) == 1
        assert {row["variant"] for row in block} == {0}
    assert design == make_design(manifest(), budget())
    with pytest.raises(ValueError, match="headroom"):
        make_design(manifest(), budget(development=21))


def test_confirmation_uses_only_development_costs_and_preserves_whole_balanced_families():
    results = development_rows()
    design = make_design(manifest("confirmation"), budget(), results)
    assert len(design["trials"]) == 64 and design["reserved_usd"] == 80
    assert Counter(row["domain"] for row in design["trials"]) == {"retail": 32, "airline": 32}
    scores_changed = [{**row, "success": index % 2 == 0} for index, row in enumerate(results)]
    assert design == make_design(manifest("confirmation"), budget(), scores_changed)
    censored = [{**row, "billedUsd": None} if index == 0 else row for index, row in enumerate(results)]
    smaller = make_design(manifest("confirmation"), budget(), censored)
    assert smaller["allowance_usd"] == 2.5 and len(smaller["trials"]) == 32
    assert Counter(row["domain"] for row in smaller["trials"]) == {"retail": 16, "airline": 16}
    for key in {(row["family"], row["variant"], row["trial"]) for row in smaller["trials"]}:
        assert {row["arm"] for row in smaller["trials"] if (row["family"], row["variant"], row["trial"]) == key} == set(ARMS)
    with pytest.raises(ValueError, match="sixteen"):
        make_design(manifest("confirmation"), budget(), results[:-1])
    with pytest.raises(ValueError, match="paired grid"):
        make_design(manifest("confirmation"), budget(), [results[0]] * 16)
    with pytest.raises(ValueError, match="balanced"):
        make_design(manifest("confirmation"), budget(heldout=225), results)


def test_fixture_or_total_budget_tampering_is_rejected():
    changed = manifest()
    changed["tasks"][0]["initialRequest"] += " New task"
    with pytest.raises(ValueError, match="manifest changed"):
        validate_manifest(changed)
    changed["manifestHash"] = digest({k: v for k, v in changed.items() if k != "manifestHash"})
    with pytest.raises(ValueError, match="content changed"):
        validate_manifest(changed)
    wrong_budget = copy.deepcopy(budget())
    wrong_budget["totalCeilingUsd"] = 600
    with pytest.raises(ValueError, match="ceilings"):
        make_design(manifest(), wrong_budget)


def test_failed_slots_keep_identity_budget_and_failure_in_primary_denominator():
    design = make_design(manifest(), budget())
    trial = design["trials"][0]
    row = _failure_row(design, "run", trial, "snapshot", "stage_aborted_before_slot")
    assert row["success"] is False and row["billedUsd"] is None
    assert row["unknownProviderCharge"] is True
    assert row["reservedUsd"] == 1.25
    assert row["familyId"] == trial["family"] and row["seed"] == trial["seed"]
    assert row["officialReward"] is None


def test_native_limit_termination_is_failure_even_if_partial_state_matches():
    for reason in ("timeout", "max_steps", "execution_error", "too_many_errors"):
        assert not completed_success({"success": True}, reason, None)
    assert completed_success({"success": True}, "user_stop", None)
    assert completed_success({"success": True}, "agent_stop", None)
    assert not completed_success({"success": True}, "user_stop", "service_drain_error")
    assert not completed_success({"success": False}, "user_stop", None)


def test_report_and_training_tools_are_explicitly_excluded_but_all_runtime_modules_remain_bound():
    sources = {name: name for name in ["docs/AI_HANDOFF.md", "research/goalspec/tests/test_fresh_native_v4.py",
        "research/goalspec/src/goalspec/report_v4.py", "research/goalspec/scripts/report_native_v4.py",
        "research/goalspec/src/goalspec/controller_v4.py", "src/lib/goalspec/controller.ts", "src/lib/goalspec/goal-state.ts",
        "services/goalspec-runtime/research-bootstrap.ts", "research/goalspec/src/goalspec/native_live_v4.py"]}
    runtime = execution_sources(sources)
    assert set(runtime) == {"src/lib/goalspec/controller.ts", "src/lib/goalspec/goal-state.ts",
                            "services/goalspec-runtime/research-bootstrap.ts", "research/goalspec/src/goalspec/native_live_v4.py"}
