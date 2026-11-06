"""Identical manifest schema and canonical-hash fixtures across Python and Node."""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from goalspec.contracts_v1 import hash_v1

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "src/lib/goalspec/contracts/infra-manifest-v2.schema.json"
FIXTURE = ROOT / "research/goalspec/examples/infra-manifest-v2.fixture.json"


def test_same_manifest_fixture_validates_and_hashes_in_both_languages():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    validator.validate(fixture)
    variants = [fixture]
    for section, field, value in [
        ("protocol", "exposeEvidence", True),
        ("actor", "weightsFrozen", False),
        ("budgets", "totalCeilingMicrodollars", 501000000),
        ("runtime", "vllm", "latest"),
    ]:
        invalid = copy.deepcopy(fixture)
        invalid[section][field] = value
        variants.append(invalid)
    expected = [validator.is_valid(value) for value in variants]
    assert expected == [True, False, False, False, False]
    node = shutil.which("node")
    if not node or not (ROOT / "node_modules/tsx").is_dir():
        pytest.skip("Node/tsx required for cross-language fixture validation")
    script = """
const { readFileSync } = require('node:fs');
const { validateInfraManifest } = require('./src/lib/goalspec/infra-manifest.ts');
const { hash } = require('./src/lib/goalspec/canonical.ts');
const values = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify({ valid: values.map(value => {
  try { validateInfraManifest(value); return true; } catch { return false; }
}), hash: hash(values[0]) }));
"""
    result = subprocess.run(
        [node, "--import", "tsx", "-e", script],
        input=json.dumps(variants), text=True, capture_output=True,
        check=True, cwd=ROOT, timeout=30,
    )
    output = json.loads(result.stdout)
    assert output["valid"] == expected
    assert output["hash"] == hash_v1(fixture)
