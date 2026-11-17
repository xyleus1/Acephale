from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from test_training_lora import export_fixture, reseal

from acephale.contracts_v1 import hash_v1
from acephale.training_lora import validate_lora_artifact


def test_python_and_typescript_validate_the_same_unmerged_artifact(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node required for actual cross-language artifact validation")
    root = Path(__file__).resolve().parents[3]
    artifact = export_fixture(tmp_path / "export")["predictor.json"]
    cases = [artifact,
             reseal({**artifact, "baseWeightsHash": hash_v1("foreign")}),
             reseal({**artifact, "adapterHash": hash_v1("foreign")}),
             reseal({**artifact, "adapterStorageDtype": "bfloat16"}),
             reseal({**artifact, "runtimeLoraDtype": "float16"}),
             reseal({**artifact, "calibrationFamilies": artifact["weightFitFamilies"]}),
             reseal({**artifact, "mergedWeightsHash": hash_v1("mislabelled")})]
    expected = []
    for value in cases:
        try:
            expected.append(validate_lora_artifact(value)["contentHash"])
        except ValueError:
            expected.append(None)
    command = """
import { readFileSync } from 'node:fs';
import { validateTrainedPredictor } from './src/lib/acephale/predictor-artifact.ts';
const result = JSON.parse(readFileSync(0, 'utf8')).map(value => {
  try { return validateTrainedPredictor(value).contentHash; } catch { return null; }
});
process.stdout.write(JSON.stringify(result));
"""
    actual = subprocess.run([node, "--import", "tsx", "--input-type=module", "-e", command],
                            input=json.dumps(cases), text=True, capture_output=True, cwd=root, check=True, timeout=30)
    assert json.loads(actual.stdout) == expected == [artifact["contentHash"], *([None] * 6)]
