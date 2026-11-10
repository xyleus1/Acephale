from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_prepare_native import build_collection, empty_shadow_memory


def inputs():
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "research/acephale/examples/infra-manifest-v2.fixture.json").read_text())
    deployment = {"version": 1, "observed": True,
                  **{key: fixture[key] for key in ("actor", "predictor", "runtime", "hardware")}}
    tools = [{"type": "function", "function": {"name": "get_user_details",
              "parameters": {"type": "object", "properties": {"user_id": {"type": "string"}}}}}]
    tasks = [{"domain": "retail", "taskId": str(index), "familyId": family, "split": split}
             for index, (family, split) in enumerate([("train", "train"), ("dev", "development"), ("test", "test")])]
    plan = {"experimentId": "fixture-collection", "actorBaseUrl": "http://127.0.0.1:8000", "seeds": [0, 1], "tasks": tasks}
    catalog = {"retail": {"tools": tools, "tasks": {str(index): {"id": str(index)} for index in range(3)}}}
    return root, plan, deployment, catalog


def test_preparation_builds_runtime_valid_base_only_nonheldout_collection(tmp_path):
    root, plan, deployment, catalog = inputs()
    checkpoint = {"fixture": True}
    configuration, manifest, bundle = build_collection(plan, deployment, catalog, "b" * 40, hash_v1(checkpoint))
    assert len(configuration["runs"]) == 4
    assert {row["familyId"] for row in configuration["runs"]} == {"train", "dev"}
    assert {row["arm"] for row in configuration["runs"]} == {"base"}
    assert len({row["runId"] for row in configuration["runs"]}) == 4
    assert manifest["budgets"]["totalCeilingMicrodollars"] == 500_000_000
    assert manifest["budgets"]["infrastructureMicrodollars"] == 35_000_000
    assert configuration["taskBundleHash"] == hash_v1(bundle)
    assert "memoryPath" not in configuration and "calibrationPath" not in configuration
    for name, value in (("configuration.json", configuration), ("manifest.json", manifest), ("ledger-checkpoint.json", checkpoint)):
        (tmp_path / name).write_text(json.dumps(value))
    script = "const {loadInfraNativeConfiguration}=require('./scripts/acephale-infra-native.ts'); loadInfraNativeConfiguration(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});"
    result = subprocess.run(["node", "--import", "tsx", "-e", script, str(tmp_path / "configuration.json")],
                            cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_explicit_additive_audit_binds_config_but_preserves_actor_and_private_task_bytes():
    _, plan, deployment, catalog = inputs()
    baseline, baseline_manifest, baseline_tasks = build_collection(plan, deployment, catalog, "b" * 40, "a" * 64)
    assert baseline["hosted"]["evaluationType"] == "ALL"
    plan["evaluationType"] = "ALL_WITH_NL_ASSERTIONS"
    audited, audited_manifest, audited_tasks = build_collection(plan, deployment, catalog, "b" * 40, "a" * 64)
    assert audited["hosted"]["evaluationType"] == "ALL_WITH_NL_ASSERTIONS"
    assert hash_v1(audited) != hash_v1(baseline)
    assert audited_tasks == baseline_tasks and audited["runs"] == baseline["runs"]
    assert audited_manifest["actor"] == baseline_manifest["actor"]
    assert audited_manifest["data"] == baseline_manifest["data"]
    assert audited_manifest["protocol"] == baseline_manifest["protocol"]
    assert {key: value for key, value in audited.items() if key != "hosted"} == {key: value for key, value in baseline.items() if key != "hosted"}
    for value in ("ALL_IGNORE_BASIS", "NL_ASSERTIONS", None, True):
        plan["evaluationType"] = value
        with pytest.raises(ValueError, match="evaluation type"):
            build_collection(plan, deployment, catalog, "b" * 40, "a" * 64)


@pytest.mark.parametrize("case", ["duplicate", "family", "missing-task", "unobserved", "seeds"])
def test_preparation_refuses_ambiguous_or_fabricated_inputs(case):
    _, plan, deployment, catalog = inputs()
    if case == "duplicate":
        plan["tasks"].append(plan["tasks"][0])
    elif case == "family":
        plan["tasks"][1]["familyId"] = "train"
    elif case == "missing-task":
        plan["tasks"][0]["taskId"] = "absent"
    elif case == "unobserved":
        deployment["observed"] = False
    else:
        plan["seeds"] = [0, 0]
    with pytest.raises(ValueError):
        build_collection(plan, deployment, catalog, "b" * 40, "a" * 64)


def test_shadow_collection_dispatches_training_only_and_preserves_declared_splits(tmp_path):
    root, plan, deployment, catalog = inputs()
    checkpoint = {"fixture": True}
    original, _, _ = build_collection(plan, deployment, catalog, "b" * 40, hash_v1(checkpoint))
    plan.update(shadowPrediction=True, predictorBaseUrl="http://127.0.0.1:8001")
    config, manifest, bundle = build_collection(plan, deployment, catalog, "b" * 40, hash_v1(checkpoint))
    memory = empty_shadow_memory(config["snapshotId"])
    assert config["shadowPrediction"] is True and config["memoryPath"] == "shadow-memory.json"
    assert manifest["data"]["memoryHash"] == memory["contentHash"]
    assert config["runs"] == [run for run in original["runs"] if run["familyId"] == "train"]
    assert manifest["data"]["trainingFamilies"] == ["train"]
    assert manifest["data"]["developmentFamilies"] == ["dev"]
    assert manifest["data"]["heldoutFamilies"] == ["test"]
    assert len(bundle["tasks"]) == 3
    assert all(run["arm"] == "base" for run in config["runs"])
    assert manifest["protocol"]["actorContext"] == "none"
    assert manifest["protocol"]["exposeEvidence"] is False
    assert "no-speculation" in manifest["protocol"]["cachePolicy"]
    assert "calibrationPath" not in config
    for name, value in (("configuration.json", config), ("manifest.json", manifest),
                        ("shadow-memory.json", memory), ("ledger-checkpoint.json", checkpoint)):
        (tmp_path / name).write_text(json.dumps(value))
    script = "const {loadInfraNativeConfiguration}=require('./scripts/acephale-infra-native.ts'); loadInfraNativeConfiguration(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});"
    result = subprocess.run(["node", "--import", "tsx", "-e", script, str(tmp_path / "configuration.json")],
                            cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_empty_shadow_memory_matches_typescript_builder():
    root, _, _, _ = inputs()
    script = "const {buildMemoryArtifact}=require('./src/lib/acephale/experience-memory.ts'); console.log(JSON.stringify(buildMemoryArtifact({repositorySnapshotId:'shadow-snapshot',sourceFiles:[],runs:[],episodes:[],misses:[]},{profile:'v5'})));"
    result = subprocess.run(["node", "--import", "tsx", "-e", script], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == empty_shadow_memory("shadow-snapshot")


@pytest.mark.parametrize("defect", ["missing_endpoint", "wrong_stage", "non_boolean", "unloaded_memory", "heldout_memory"])
def test_shadow_collection_rejects_invalid_or_contaminated_setup(defect):
    _, plan, deployment, catalog = inputs()
    plan.update(shadowPrediction=True, predictorBaseUrl="http://127.0.0.1:8001")
    memory = None
    if defect == "missing_endpoint":
        del plan["predictorBaseUrl"]
    elif defect == "wrong_stage":
        plan["stage"] = "heldout"
    elif defect == "non_boolean":
        plan["shadowPrediction"] = "yes"
    elif defect == "unloaded_memory":
        plan["memoryPath"] = "memory.json"
    else:
        plan["memoryPath"] = "memory.json"
        memory = empty_shadow_memory("snapshot")
        memory.pop("contentHash")
        memory["runs"] = [{"familyId": "test", "split": "test"}]
        memory["contentHash"] = hash_v1(memory)
    with pytest.raises(ValueError):
        build_collection(plan, deployment, catalog, "b" * 40, "a" * 64, memory)
