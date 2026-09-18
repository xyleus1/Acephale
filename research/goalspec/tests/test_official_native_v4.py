import json
from collections import Counter
from pathlib import Path

import pytest

from goalspec import official_native_v4 as module


def calibration(stage):
    rows = []
    for index in range(4):
        for arm in module.ARMS:
            rows.append({"runId": f"{index}-{arm}", "studyId": stage, "studyStage": stage,
                         "family": f"family-{index}", "domain": "retail" if index < 2 else "airline",
                         "taskId": str(index), "variant": 0, "trial": 0, "seed": index, "arm": arm,
                         "billedUsd": .2, "budget_terminated": False, "unknownProviderCharge": False})
    return {"studyStage": stage}, {"studyStage": stage, "studyId": stage, "trials": rows}, rows


def inputs():
    selection = {"version": "official-tau-v4-id-selection-v1", "upstreamRevision": module.REVISION,
                 "studyId": "fixture", "seed": 123,
                 "selectedByDomain": {domain: [str(i) for i in range(7)] for domain in ("retail", "airline")}}
    budget = {"totalCeilingUsd": 500, "allocations": [{"allocation": "heldout", "ceilingUsd": 240, "spentOrReservedUsd": 95.409296}]}
    return selection, budget, [calibration("development-3"), calibration("development")]


def test_full_paired_design_uses_only_development_costs_and_original_allocation():
    design = module.make_design(*inputs())
    assert design["tasks"] == 14 and len(design["trials"]) == 112
    assert design["reserved_usd"] == 140 and design["allowance_usd"] == 1.25
    assert Counter(t["arm"] for t in design["trials"]) == {arm: 28 for arm in module.ARMS}
    for index in range(0, len(design["trials"]), 4):
        block = design["trials"][index:index + 4]
        assert len({(t["domain"], t["taskId"], t["trial"], t["seed"]) for t in block}) == 1
        assert {t["arm"] for t in block} == set(module.ARMS)
    ids = module.declared_trials({"studyId": "fixture"}, design)
    assert len({key for key, _ in ids}) == 112 and all(key.startswith("official-v4-") for key, _ in ids)


def test_unknown_cost_reduces_balanced_cohort_before_dispatch():
    selection, budget, cohorts = inputs()
    cohorts[0][2][0]["unknownProviderCharge"] = True
    design = module.make_design(selection, budget, cohorts)
    assert design["allowance_usd"] == 2.5 and design["tasks"] == 6
    assert len(design["trials"]) == 48 and design["reserved_usd"] == 120
    assert Counter(t["domain"] for t in design["trials"]) == {"retail": 24, "airline": 24}


def test_calibration_cannot_use_confirmation_or_incomplete_or_unpaired_grid():
    selection, budget, cohorts = inputs()
    cohorts[0][1]["studyStage"] = "confirmation"
    with pytest.raises(ValueError, match="development costs"):
        module.make_design(selection, budget, cohorts)
    selection, budget, cohorts = inputs()
    cohorts[0][2].pop()
    with pytest.raises(ValueError, match="sixteen"):
        module.make_design(selection, budget, cohorts)
    selection, budget, cohorts = inputs()
    cohorts[0][2][0]["seed"] = -1
    with pytest.raises(ValueError, match="paired task"):
        module.make_design(selection, budget, cohorts)


def test_original_budget_and_selected_id_bounds_required():
    selection, budget, cohorts = inputs()
    budget["allocations"][0]["ceilingUsd"] = 500
    with pytest.raises(ValueError, match="ceilings"):
        module.make_design(selection, budget, cohorts)
    selection, budget, cohorts = inputs()
    selection["selectedByDomain"]["retail"][0] = "1"
    with pytest.raises(ValueError, match="distinct"):
        module.make_design(selection, budget, cohorts)


def test_run_stage_preserves_native_evaluation_and_original_model_ports():
    import inspect

    from goalspec import official_native
    assert module.native_ports is official_native.native_ports
    assert module.api_actor_instruction is official_native.api_actor_instruction
    source = inspect.getsource(module.run_stage)
    assert 'evaluation_type=EvaluationType.ALL' in source and 'strict_replay=True' in source
    assert '"runtimeVersion": "v4"' in source and '"v4Configuration": configuration' in source
    assert '"sessionConfiguration"] = baseline_configuration' in source
    assert '"evaluator": True' in source


def test_single_use_dispatch_blocks_retry_even_when_launch_failed(tmp_path, monkeypatch):
    selection, budget, cohorts = inputs()
    design = module.make_design(selection, budget, cohorts)
    plan = {"study": {"studyId": "fixture"}, "design": design, "v4Configuration": {},
            "baselineSessionConfiguration": None, "outputPath": str(tmp_path / "output"), "budgetDirectory": str(tmp_path)}
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan))
    monkeypatch.setattr(module, "verify_plan", lambda *args: True)
    def fake_run(*args, **kwargs):
        Path(args[-2]).mkdir()
        return {"completed": True}
    monkeypatch.setattr(module, "run_stage", fake_run)
    assert module.run_plan(path, module.file_digest(path))["completed"]
    with pytest.raises(ValueError, match="already consumed"):
        module.run_plan(path, module.file_digest(path))


def test_new_report_paths_excluded_but_official_harness_is_frozen():
    source = {"research/goalspec/src/goalspec/report_official_v4.py": Path("report"),
              "research/goalspec/src/goalspec/official_native_v4.py": Path("runtime")}
    assert set(module.execution_sources(source)) == {"research/goalspec/src/goalspec/official_native_v4.py"}
