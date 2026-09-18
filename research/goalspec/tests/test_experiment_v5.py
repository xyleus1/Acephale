import copy
import pytest

from goalspec.experiment_v5 import make_design, allowance_from_development, complete_grid, retain_setup_failure, select_v5_from_development
import json


def budget():
    return {"totalCeilingUsd": 500, "allocations": [
        {"allocation": name, "ceilingUsd": cap, "spentOrReservedUsd": 0}
        for name, cap in (("training", 60), ("development", 40), ("heldout", 240))]}


def tasks(families=4, variants=1):
    return [{"familyId": f"family-{index}", "domain": "retail" if index % 2 else "airline",
             "taskId": f"task-{index}-{variant}", "variant": variant}
            for index in range(families) for variant in range(variants)]


def development():
    design = make_design("test-study", "development", tasks(), budget())
    rows = [{**trial, "studyId": design["studyId"], "studyStage": "development", "billedUsd": .2,
             "success": False} for trial in design["trials"]]
    return design, rows


def test_complete_training_and_development_reservations():
    training = make_design("test-study", "training", tasks(20, 2), budget())
    assert len(training["trials"]) == 40
    assert training["reserved_usd"] == 50
    design, rows = development()
    assert len(rows) == 16 and design["reserved_usd"] == 20
    complete_grid(design, rows)


def test_confirmation_uses_only_development_costs_and_never_success():
    dev, rows = development()
    design = make_design("test-study", "confirmation", tasks(18), budget(), development=(dev, rows))
    assert len(design["trials"]) == 72 and design["reserved_usd"] == 90
    assert {t["arm"] for t in design["trials"]} == {"base", "v4", "goalspec"}
    changed = [{**row, "success": True} for row in rows]
    assert make_design("test-study", "confirmation", tasks(18), budget(), development=(dev, changed)) == design


def test_unknown_cost_shrinks_entire_paired_cohort():
    dev, rows = development()
    rows[0]["unknownProviderCharge"] = True
    allowance, _ = allowance_from_development(dev, rows)
    assert allowance == 2.5
    design = make_design("test-study", "confirmation", tasks(18), budget(), development=(dev, rows))
    assert len(design["trials"]) == 36 and design["reserved_usd"] == 90


def test_missing_repeated_and_foreign_slots_rejected():
    design, rows = development()
    for bad in (rows[:-1], rows + [rows[0]], [{**rows[0], "studyId": "foreign"}, *rows[1:]]):
        with pytest.raises(ValueError):
            complete_grid(design, bad)
    changed = copy.deepcopy(design)
    changed["studyStage"] = "confirmation"
    with pytest.raises(ValueError):
        allowance_from_development(changed, rows)


def test_headroom_failure_before_dispatch_and_frozen_seed():
    limited = budget()
    limited["allocations"][0]["spentOrReservedUsd"] = 11
    with pytest.raises(ValueError):
        make_design("test-study", "training", tasks(20, 2), limited)
    left, _ = development()
    assert left == make_design("test-study", "development", tasks(), budget())


def test_setup_failure_keeps_all_slots_and_is_idempotent(tmp_path):
    design, _ = development()
    plan = {"outputPath": str(tmp_path / "failed-stage"), "design": design}
    retain_setup_failure(plan, "FixtureSetupError")
    first = (tmp_path / "failed-stage/outcomes.jsonl").read_bytes()
    retain_setup_failure(plan, "AnotherError")
    assert (tmp_path / "failed-stage/outcomes.jsonl").read_bytes() == first
    rows = [json.loads(line) for line in first.decode().splitlines()]
    assert len(rows) == 16 and not any(row["success"] for row in rows)
    complete_grid(design, rows)


def test_duplicate_variant_rejected_but_same_id_in_distinct_domains_allowed():
    values = tasks(20, 2)
    values[1]["variant"] = 0
    with pytest.raises(ValueError, match="both declared variants"):
        make_design("test-study", "training", values, budget())
    dev, rows = development()
    values = tasks(12)
    values[0]["taskId"] = values[1]["taskId"]
    assert len(make_design("test-study", "confirmation", values, budget(), development=(dev, rows))["trials"]) == 72


def test_development_policy_selection_prioritizes_accuracy_and_constraints():
    design, rows = development()
    for row in rows:
        row.update(success=True, constraintViolations=0, totalTrialSeconds=10 if row["arm"] == "hypotheses" else 20)
    assert select_v5_from_development(design, rows)["selectedActorContext"] == "hypotheses"
    next(row for row in rows if row["arm"] == "hypotheses")["success"] = False
    assert select_v5_from_development(design, rows)["selectedActorContext"] == "literal"
    for row in rows:
        row["success"] = True
        if row["arm"] == "hypotheses":
            row["constraintViolations"] = 1
    assert select_v5_from_development(design, rows)["selectedActorContext"] == "literal"


def test_host_interrupted_raw_clock_cannot_win_development_latency_tiebreak():
    design, rows = development()
    for row in rows:
        row.update(success=False, constraintViolations=0, totalTrialSeconds=1 if row["arm"] == "hypotheses" else 20)
    next(row for row in rows if row["arm"] == "hypotheses")["measuredTimingValid"] = False
    selection = select_v5_from_development(design, rows)
    assert selection["selectedActorContext"] == "literal"
    assert next(candidate for candidate in selection["candidates"] if candidate["arm"] == "hypotheses")["meanLiveSeconds"] is None
