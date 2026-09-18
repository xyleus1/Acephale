import json
import subprocess
import zipfile

import pytest

from goalspec.source_freeze import (
    EXPLICIT_FILES,
    SOURCE_TREES,
    canonical,
    development_calibration,
    digest_bytes,
    freeze_source,
    verify_source,
)


def repository(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    for name in SOURCE_TREES:
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / "scripts").mkdir()
    for name in EXPLICIT_FILES:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("uncommitted source bytes\n", encoding="utf-8")
    (root / "src/lib/goalspec/runtime.ts").write_text("const exactBytes = 1;\r\n", encoding="utf-8", newline="")
    (root / "research/goalspec/src/evaluation_v1.py").write_text("# analysis\n")
    subprocess.run(["git", "init", "--quiet"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.name=GoalSpec fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "--allow-empty", "-m", "fixture baseline"], cwd=root, check=True)
    inputs = {}
    for name in ("fixtures", "records", "development_design", "development_outcomes"):
        path = root / "research/goalspec/runs" / (name + ".json")
        path.parent.mkdir(exist_ok=True)
        path.write_text("{}\n")
        inputs[name] = path
    design = {"phase": "development", "trials": [{"family": "f", "variant": 0, "trial": 0, "arm": "base", "seed": 5}]}
    outcome = {"runId": "development-0", "familyId": "f", "variant": 0, "trial": 0, "arm": "base", "seed": 5, "budget_terminated": False, "billedUsd": 1.10}
    inputs["development_design"].write_text(json.dumps(design))
    inputs["development_outcomes"].write_text(json.dumps(outcome) + "\n")
    return root, inputs


def test_freeze_contains_actual_uncommitted_bytes_not_runs_and_is_immutable(tmp_path):
    root, inputs = repository(tmp_path)
    frozen = tmp_path / "frozen"
    manifest = freeze_source(root, frozen, inputs, require_native=False)
    assert len(manifest["baselineGitHead"]) == 40
    assert manifest["developmentCostCalibration"]["allowanceUsd"] == 1.5
    assert manifest["developmentCostCalibration"]["heldoutFamilies"] == 12
    assert all(not value["archived"] for value in manifest["inputs"].values())
    with zipfile.ZipFile(frozen / "source.zip") as archive:
        assert archive.read("src/lib/goalspec/runtime.ts") == b"const exactBytes = 1;\r\n"
        assert not any("/runs/" in name for name in archive.namelist())
    assert verify_source(root, frozen)["allSourceBytesUnchanged"]
    with pytest.raises(FileExistsError):
        freeze_source(root, frozen, inputs, require_native=False)


def test_execution_changes_added_files_and_input_drift_fail_but_analysis_is_disclosed(tmp_path):
    root, inputs = repository(tmp_path)
    frozen = tmp_path / "frozen"
    freeze_source(root, frozen, inputs, require_native=False)
    analysis = root / "research/goalspec/src/evaluation_v1.py"
    analysis.write_text("# report format changed\n")
    result = verify_source(root, frozen)
    assert result["passed"] and not result["allSourceBytesUnchanged"]
    assert result["disclosedOtherChanges"][0]["category"] == "analysis"
    (root / "src/lib/goalspec/new_predictor.ts").write_text("// new behavior\n")
    result = verify_source(root, frozen)
    assert not result["passed"]
    assert result["protectedChanges"][0]["change"] == "added"
    inputs["fixtures"].write_text('{"changed":true}\n')
    result = verify_source(root, frozen)
    assert not result["frozenInputsUnchanged"]


def test_censored_development_allowance_and_incomplete_grid_are_checked(tmp_path):
    root, inputs = repository(tmp_path)
    design = json.loads(inputs["development_design"].read_text())
    outcome = json.loads(inputs["development_outcomes"].read_text())
    design["trials"].append({**design["trials"][0], "arm": "goalspec"})
    inputs["development_design"].write_text(json.dumps(design))
    with pytest.raises(ValueError, match="Every declared"):
        development_calibration(inputs["development_design"], inputs["development_outcomes"])
    inputs["development_outcomes"].write_text(json.dumps(outcome) + "\n" + json.dumps({**outcome, "arm": "goalspec", "runId": "development-1", "budget_terminated": True, "billedUsd": None}) + "\n")
    assert development_calibration(inputs["development_design"], inputs["development_outcomes"])["allowanceUsd"] == 2.5


def test_v2_calibration_accepts_only_same_study_development_namespace(tmp_path):
    _, inputs = repository(tmp_path)
    study = "goalspec-v2-test"
    design = json.loads(inputs["development_design"].read_text())
    design.update(studyId=study, studyStage="development-1")
    row = json.loads(inputs["development_outcomes"].read_text())
    row.update(studyId=study, studyStage="development-1", runId=f"v2-{digest_bytes(canonical(study))[:10]}-development-1-0000-fixture")
    inputs["development_design"].write_text(json.dumps(design))
    inputs["development_outcomes"].write_text(json.dumps(row) + "\n")
    result = development_calibration(inputs["development_design"], inputs["development_outcomes"])
    assert result["allowanceUsd"] == 1.5 and result["heldoutFamilies"] == 8
    for mutation in ({"studyId": "another-study"}, {"studyStage": "confirmation"}, {"runId": "development-forged"}):
        inputs["development_outcomes"].write_text(json.dumps({**row, **mutation}) + "\n")
        with pytest.raises(ValueError, match="Only completed development"):
            development_calibration(inputs["development_design"], inputs["development_outcomes"])


def combined_v2_inputs(tmp_path):
    _, inputs = repository(tmp_path)
    study = "goalspec-v2-test"
    design = json.loads(inputs["development_design"].read_text())
    trial = design["trials"][0]
    stages = ["development-1", "development-2"]
    design.update(studyId=study, developmentStudyStages=stages,
                  trials=[{**trial, "studyStage": stage, "seed": index + 5} for index, stage in enumerate(stages)])
    row = json.loads(inputs["development_outcomes"].read_text())
    rows = [{**row, "studyId": study, "studyStage": stage, "seed": index + 5, "success": False,
             "runId": f"v2-{digest_bytes(canonical(study))[:10]}-{stage}-0000-fixture", "billedUsd": index + .1}
            for index, stage in enumerate(stages)]
    return inputs, design, rows


def test_combined_v2_calibration_retains_same_family_trials_from_both_stages(tmp_path):
    inputs, design, rows = combined_v2_inputs(tmp_path)
    inputs["development_design"].write_text(json.dumps(design))
    inputs["development_outcomes"].write_text("".join(json.dumps(row) + "\n" for row in rows))
    result = development_calibration(inputs["development_design"], inputs["development_outcomes"])
    assert result["developmentTrials"] == 2 and result["completedKnownCostTrials"] == 2
    assert result["largestCompletedCostUsd"] == 1.1 and result["allowanceUsd"] == 1.5
    assert result["developmentStudyStages"] == ["development-1", "development-2"]
    assert result["trialIdentityIncludesStudyStage"]


@pytest.mark.parametrize("change", ["missing_declared_stage", "forged_declared_stage", "same_stage_duplicate", "wrong_stage_seed", "missing_actual_stage"])
def test_combined_v2_calibration_rejects_ambiguous_or_mismatched_stage_identity(tmp_path, change):
    inputs, design, rows = combined_v2_inputs(tmp_path)
    if change == "missing_declared_stage":
        del design["trials"][1]["studyStage"]
    elif change == "forged_declared_stage":
        design["trials"][1]["studyStage"] = "confirmation"
    elif change == "same_stage_duplicate":
        design["trials"][1]["studyStage"] = "development-1"
    elif change == "wrong_stage_seed":
        rows[1]["seed"] = rows[0]["seed"]
    else:
        del rows[1]["studyStage"]
    inputs["development_design"].write_text(json.dumps(design))
    inputs["development_outcomes"].write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError, match="development|Development"):
        development_calibration(inputs["development_design"], inputs["development_outcomes"])


def test_corrupt_archive_and_secret_paths_cannot_pass_freeze_verification(tmp_path):
    root, inputs = repository(tmp_path)
    frozen = tmp_path / "frozen"
    freeze_source(root, frozen, inputs, require_native=False)
    with (frozen / "source.zip").open("ab") as stream:
        stream.write(b"tampered")
    with pytest.raises(ValueError, match="archive integrity"):
        verify_source(root, frozen)
    secret = root / ".env.local"
    secret.write_text("fixture only, not a credential")
    with pytest.raises(ValueError, match="Invalid experiment input"):
        freeze_source(root, tmp_path / "secret-freeze", {**inputs, "extra": secret}, require_native=False)


@pytest.mark.parametrize("change", ["input", "membership"])
def test_concurrent_changes_cannot_produce_a_complete_manifest(tmp_path, monkeypatch, change):
    root, inputs = repository(tmp_path)
    original_write = zipfile.ZipFile.writestr
    changed = False

    def change_during_archive(bundle, *args, **kwargs):
        nonlocal changed
        result = original_write(bundle, *args, **kwargs)
        if not changed:
            changed = True
            if change == "input":
                inputs["records"].write_text('{"changed":true}\n')
            else:
                (root / "src/lib/goalspec/late.ts").write_text("// concurrent file addition\n")
        return result

    monkeypatch.setattr(zipfile.ZipFile, "writestr", change_during_archive)
    frozen = tmp_path / "incomplete"
    with pytest.raises(RuntimeError, match="changed while freezing"):
        freeze_source(root, frozen, inputs, require_native=False)
    assert not (frozen / "manifest.json").exists()
