from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_prepare_native import build_collection


def inputs():
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "research/goalspec/examples/infra-manifest-v2.fixture.json").read_text())
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
    script = "const {loadInfraNativeConfiguration}=require('./scripts/goalspec-infra-native.ts'); loadInfraNativeConfiguration(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});"
    result = subprocess.run(["node", "--import", "tsx", "-e", script, str(tmp_path / "configuration.json")],
                            cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


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
