import hashlib
import json
from pathlib import Path

import pytest

from goalspec.training_export import export_native


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(tmp_path, *, generator="fresh-native-v5", failed=False, missing_check=False):
    source = tmp_path / "source"
    source.mkdir()
    row = {"taskId": "synthetic-task", "familyId": "retail:synthetic-family", "variant": 0, "trial": 0,
           "arm": "base", "runId": "synthetic-run", "domain": "retail", "seed": 4,
           "success": not failed, "termination": "execution_error" if failed else "user_stop",
           "budget_terminated": failed, "constraintViolations": None if failed else 0, "latencyMs": None if failed else 10}
    if not failed:
        row["fixtureHash"] = "fixture-hash"
    write(source / "design.json", {"trials": [row]})
    (source / "outcomes.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    write(source / "public-contexts.json", {"synthetic-run": {"capturedBeforeExecution": True,
          "policy": "Synthetic policy", "tools": []}})
    artifact = {"record": row}
    if not failed:
        artifact.update({"verdict": {"verifierVersion": "fresh-native-v1-independent-v2", "success": True},
                         "simulation": {"messages": [{"role": "user", "content": "Inspect the order."}]}})
        if not missing_check:
            artifact["independentCheck"] = {"evaluatorVersion": "fresh-native-v1-independent-v1"}
    write(source / "synthetic-run.json", artifact)
    manifest = tmp_path / "fixtures.json"
    write(manifest, {"generator": generator, "tasks": [{"taskId": "synthetic-task", "fixtureHash": "fixture-hash",
          "split": "train", "learningSplit": "calibration", "referenceActions": [], "initialRequest": "Inspect the order."}]})
    return source, manifest, row


def test_v5_reports_actual_v1_verifier_and_separate_v5_preflight_lineage(tmp_path):
    source, manifest, _ = fixture(tmp_path, missing_check=True)
    output = tmp_path / "export"
    summary = export_native(source, manifest, output)
    assert summary["episodes"] == summary["verifiedSuccesses"] == 1
    bundle = json.loads((output / "repository-bundle.json").read_text())
    verdict = bundle["verifications"][0]
    verifier = Path(__file__).parents[1] / "src/goalspec/fresh_tasks.py"
    assert verdict["verifierCodeHash"] == hashlib.sha256(verifier.read_bytes()).hexdigest()
    assert verdict["verifierVersion"] == "fresh-native-v1-independent-v2"
    lineage = bundle["episodes"][0]["metadata"]["verifierLineage"]
    assert lineage["generatorVersion"] == "fresh-native-v5"
    assert set(lineage["preflightCodeHashes"]) == {"fresh_tasks.py", "fresh_tasks_v5.py"}
    assert bundle["episodes"][0]["metadata"]["learningSplit"] == "calibration"


def test_setup_failure_retained_without_inventing_verdict_or_mining_checkpoint(tmp_path):
    source, manifest, _ = fixture(tmp_path, failed=True)
    output = tmp_path / "export"
    summary = export_native(source, manifest, output)
    assert summary["episodes"] == 1 and summary["verifiedSuccesses"] == 0 and summary["checkpoints"] == 0
    bundle = json.loads((output / "repository-bundle.json").read_text())
    assert bundle["verifications"] == []
    assert bundle["episodes"][0]["metadata"]["verifierAvailable"] is False
    assert bundle["episodes"][0]["verificationTier"] == "source_reported"
    trajectory = json.loads((output / "trajectories.jsonl").read_text())
    assert all(event["role"] == "system" for event in trajectory["events"]) and trajectory["outcome"]["status"] == "failed"


def test_positive_outcome_without_verdict_is_rejected(tmp_path):
    source, manifest, row = fixture(tmp_path, failed=True)
    row["success"] = True
    write(source / "design.json", {"trials": [row]})
    (source / "outcomes.jsonl").write_text(json.dumps(row) + "\n")
    write(source / "synthetic-run.json", {"record": row})
    with pytest.raises(ValueError, match="requires a completed independent verdict"):
        export_native(source, manifest, tmp_path / "export")


def test_v1_verifier_fallback_remains_supported(tmp_path):
    source, manifest, _ = fixture(tmp_path, generator="fresh-native-v1")
    artifact = json.loads((source / "synthetic-run.json").read_text())
    del artifact["verdict"]["verifierVersion"]
    write(source / "synthetic-run.json", artifact)
    output = tmp_path / "export"
    export_native(source, manifest, output)
    bundle = json.loads((output / "repository-bundle.json").read_text())
    assert bundle["verifications"][0]["verifierVersion"] == "fresh-native-v1-independent-v1"
    assert set(bundle["episodes"][0]["metadata"]["verifierLineage"]["preflightCodeHashes"]) == {"fresh_tasks.py"}
