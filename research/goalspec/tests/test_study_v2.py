import json

import pytest

from goalspec import study_v2
from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v2 import build_tasks


@pytest.fixture
def study(tmp_path, monkeypatch):
    records = tmp_path / "records.json"
    records.write_text("[]\n", encoding="utf-8")
    monkeypatch.setattr(study_v2, "RECORDS_HASH", study_v2.file_hash(records))
    def fixture(study_id, stage):
        result = {"studyId": study_id, "studyStage": stage, "tasks": build_tasks(study_id, stage)}
        result["manifestHash"] = digest(result)
        return result
    monkeypatch.setattr(study_v2, "make_manifest", fixture)
    directory = tmp_path / "study"
    plan = study_v2.prepare_study(directory, "study-v2-test", records)
    return directory, plan


def report(path, development=2.348912):
    study_v2.write(path, {"totalCeilingUsd": 500, "allocations": [
        {"allocation": "development", "ceilingUsd": 40, "spentOrReservedUsd": development},
        {"allocation": "heldout", "ceilingUsd": 240, "spentOrReservedUsd": 60.552214}]})
    return path


def completed_development(directory, stage, output, *, success=False):
    design = study_v2.read(directory / f"{stage}-design.json")
    output.mkdir()
    rows = [{**trial, "reservedUsd": trial["reserved_usd"], "studyId": "study-v2-test", "studyStage": stage, "success": success, "budget_terminated": False, "billedUsd": .1}
            for trial in design["trials"]]
    (output / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    study_v2.write(output / "summary.json", {"studyId": "study-v2-test", "studyStage": stage})
    return study_v2.complete_stage(directory, stage)


def test_design_uses_paired_arms_and_cost_only_balanced_confirmation(study):
    directory, plan = study
    manifest = study_v2.read(directory / "confirmation-fixtures.json")
    dev = [{"billedUsd": .2, "budget_terminated": False, "success": False, "arm": "base"}]
    full = study_v2.design_stage(plan, manifest, "confirmation", 179447786, dev)
    assert len(full["families"]) == 8 and len(full["trials"]) == 96 and full["reserved_usd"] == 120
    assert full["localConcurrency"] == 3
    assert full["concurrencyUnit"] == "paired block; arms within each block remain sequential"
    assert full["designHash"] == digest({k: v for k, v in full.items() if k != "designHash"})
    assert full == study_v2.design_stage(plan, manifest, "confirmation", 179447786, [{**dev[0], "success": True, "arm": "goalspec"}])
    censored = study_v2.design_stage(plan, manifest, "confirmation", 179447786, [*dev, {"billedUsd": None, "budget_terminated": False}])
    assert len(censored["families"]) == 4 and len(censored["trials"]) == 48 and censored["reserved_usd"] == 120
    for offset in range(0, len(full["trials"]), 3):
        block = full["trials"][offset:offset + 3]
        assert {t["arm"] for t in block} == set(study_v2.ARMS)
        assert len({t["seed"] for t in block}) == 1


def test_stage_claims_are_single_use_and_unknown_costs_never_release_headroom(study, tmp_path):
    directory, _ = study
    first_report = report(tmp_path / "report.json")
    first_output = tmp_path / "dev1"
    study_v2.claim_stage(directory, "development-1", first_output, first_report)
    with pytest.raises(ValueError, match="consumed"):
        study_v2.claim_stage(directory, "development-1", tmp_path / "replacement", first_report)
    with pytest.raises(ValueError, match="Round one"):
        study_v2.claim_stage(directory, "development-2", tmp_path / "dev2", first_report)
    completion = completed_development(directory, "development-1", first_output)
    assert completion["trials"] == 24 and completion["successes"] == 0 and completion["allFailuresRetained"]
    with pytest.raises(ValueError, match="reconciliation"):
        study_v2.claim_stage(directory, "development-2", tmp_path / "dev2", first_report)
    insufficient = report(tmp_path / "report-unknown.json", development=32.348912)
    with pytest.raises(ValueError, match="headroom"):
        study_v2.claim_stage(directory, "development-2", tmp_path / "dev2", insufficient)


def test_confirmation_is_one_time_and_closes_development(study, tmp_path, monkeypatch):
    directory, _ = study
    first_report = report(tmp_path / "report.json")
    output = tmp_path / "dev1"
    study_v2.claim_stage(directory, "development-1", output, first_report)
    completed_development(directory, "development-1", output)
    current = report(tmp_path / "report-current.json", development=4.748912)
    with pytest.raises(ValueError, match="runtime"):
        study_v2.claim_stage(directory, "confirmation", tmp_path / "confirmation", current)
    from goalspec import source_freeze
    monkeypatch.setattr(source_freeze, "verify_source", lambda *_: {"passed": True})
    (tmp_path / "freeze").mkdir()
    study_v2.write(tmp_path / "freeze/manifest.json", {"fixture": "verified by the isolated test stub"})
    study_v2.claim_stage(directory, "confirmation", tmp_path / "confirmation", current, runtime_freeze=tmp_path / "freeze")
    for stage in ("confirmation", "development-2"):
        with pytest.raises(ValueError, match="consumed|claimed"):
            study_v2.claim_stage(directory, stage, tmp_path / "new-output", current, runtime_freeze=tmp_path / "freeze")
    with pytest.raises(ValueError, match="bounded"):
        study_v2.claim_stage(directory, "development-3", tmp_path / "dev3", current)


def test_precommitted_fixture_tampering_is_rejected(study):
    directory, _ = study
    path = directory / "confirmation-fixtures.json"
    path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="fixtures"):
        study_v2.load_study(directory)


def test_completion_rejects_design_tampering_before_grid_validation(study, tmp_path):
    directory, _ = study
    study_v2.claim_stage(directory, "development-1", tmp_path / "dev1", report(tmp_path / "report.json"))
    design = directory / "development-1-design.json"
    design.write_text(design.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="design bytes"):
        study_v2.complete_stage(directory, "development-1")


@pytest.mark.parametrize("changed", [{"seed": -1}, {"reservedUsd": .01}])
def test_completion_rejects_changed_paired_seed_or_allowance(study, tmp_path, changed):
    directory, _ = study
    output = tmp_path / "dev1"
    study_v2.claim_stage(directory, "development-1", output, report(tmp_path / "report.json"))
    design = study_v2.read(directory / "development-1-design.json")
    output.mkdir()
    rows = [{**trial, "reservedUsd": trial["reserved_usd"], "budget_terminated": False, "success": False} for trial in design["trials"]]
    rows[0].update(changed)
    (output / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    with pytest.raises(ValueError, match="seed or allowance"):
        study_v2.complete_stage(directory, "development-1")
