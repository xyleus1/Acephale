from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from acephale.adapters.tau import TAU_REVISION
from acephale.contracts_v1 import hash_v1
from acephale.infra_data import read_jsonl, verify_bundle
from acephale.infra_import_fresh import (
    ACTOR,
    import_fresh,
    import_fresh_cohorts,
    verify_parent_audit_source,
)
from acephale.storage import file_hash


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def seal(cohort):
    configuration = json.loads((cohort / "configuration.json").read_text())
    manifest = json.loads((cohort / "manifest.json").read_text())
    write(cohort / "cohort-receipt.json", {
        "version": 1, "stage": "collection", "closed": True, "completed": True, "allDeclaredSlotsRetained": True,
        "configurationHash": hash_v1(configuration), "manifestHash": hash_v1(manifest),
        "serviceExitCode": 0,
        "files": [{"path": path.name, "sha256": file_hash(path)} for path in sorted(cohort.iterdir()) if path.name != "cohort-receipt.json"],
    })


@pytest.fixture
def cohort(tmp_path):
    source = tmp_path / "cohort"
    source.mkdir()
    tools = [{"type": "function", "function": {"name": "get_user_details", "description": "Read user", "parameters": {"type": "object", "properties": {"user_id": {"type": "string"}}, "required": ["user_id"]}}}]
    runs, outcomes, contexts = [], [], {}
    families = {"trainingFamilies": ["train-ok", "train-fail", "train-unknown"], "developmentFamilies": ["dev"], "heldoutFamilies": ["test"]}
    for index, family in enumerate(["train-ok", "train-fail", "train-unknown", "dev"]):
        key = f"run-{index}"
        configured = {"runId": key, "taskId": f"task-{index}", "familyId": family, "domain": "retail", "arm": "base", "seed": index, "tools": tools, "maxBoundaries": 10}
        runs.append(configured)
        row = {key: value for key, value in configured.items() if key not in {"tools", "maxBoundaries"}}
        row.update(success=family != "train-fail", termination="agent_stop", elapsedMs=100)
        outcomes.append(row)
        contexts[key] = {"capturedBeforeExecution": True, "policy": "Only read user records", "tools": tools}
        messages = [
            {"role": "user", "content": f"Find user U{index}."},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "name": "get_user_details", "arguments": {"user_id": f"U{index}"}}]},
            {"role": "tool", "id": "c1", "content": json.dumps({"id": f"U{index}", "name": "Example"})},
            {"role": "assistant", "content": "Found user"},
        ]
        write(source / f"{key}.json", {"record": row, "simulation": {"messages": messages},
              "verdict": {"passed": row["success"], "evaluationValid": True, "constraintViolations": None if family == "train-unknown" else 0, "officialReward": 1 if row["success"] else 0, "evaluatorVersion": "test-fixture"},
              "finalDatabase": {"privateInstructions": "never import me"}})
    tasks = {"version": 1, "tasks": []}
    configuration = {"version": 1, "stage": "collection", "runs": runs, "taskBundleHash": hash_v1(tasks)}
    manifest = {"actor": ACTOR, "data": {**families, "environmentRevision": TAU_REVISION}, "protocol": {"scheduleHash": hash_v1(runs)}}
    for name, document in {"configuration.json": configuration, "manifest.json": manifest, "design.json": {"version": 1, "stage": "collection", **families, "runs": runs}, "public-contexts.json": contexts, "tasks.json": tasks}.items():
        write(source / name, document)
    (source / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in outcomes), encoding="utf-8")
    seal(source)
    return source


def test_fresh_bridge_retains_failures_and_excludes_unknown_and_development(cohort, tmp_path):
    output = tmp_path / "bundle"
    import_fresh(cohort, output, pilot_count=2, audit_count=1)
    verify_bundle(output)
    runtime = read_jsonl(output / "runtime-runs.jsonl")
    assert len(runtime) == 4
    assert [row["id"] for row in runtime if row["memoryEligible"]] == ["run-0"]
    assert [row["id"] for row in runtime if row["contrastiveEligible"]] == ["run-1"]
    assert read_jsonl(output / "metadata.jsonl")[1]["verification_tier"] == "native_verified"
    assert runtime[2]["constraintViolations"] is None
    assert len(read_jsonl(output / "verdicts.jsonl")) == 4
    public = read_jsonl(output / "public.jsonl")
    assert {row["split"] for row in public} == {"train", "development"}
    assert all(row["runtime_tool_schema_hash"] != row["tool_schema_hash"] for row in public)
    assert "privateInstructions" not in (output / "runtime-runs.jsonl").read_text()
    assert "privateInstructions" not in (output / "public.jsonl").read_text()
    memory = json.loads((output / "memory.json").read_text())
    assert memory["training_families"] == ["train-ok"]
    assert {row["episode_id"] for row in memory["episodes"]} == {"run-0"}
    verify_bundle(output / "annotation-pilot")
    pilot = json.loads((output / "annotation-pilot/pilot.json").read_text())
    assert pilot["source_dataset_hash"] == verify_bundle(output)["bundle_hash"]
    assert pilot["source_split_hash"] == hash_v1(json.loads((output / "split.json").read_text()))
    assert {row["checkpoint_id"] for row in pilot["checkpoints"]} <= {row["checkpoint_id"] for row in public if row["split"] == "train"}


def test_fresh_bridge_runs_in_typescript_memory(cohort, tmp_path):
    root = Path(__file__).resolve().parents[3]
    if not (root / "node_modules" / "tsx").exists():
        pytest.skip("Node dependencies are not installed")
    bundle, destination = tmp_path / "bundle", tmp_path / "runtime"
    import_fresh(cohort, bundle)
    result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-infra-memory.ts", "--fresh", str(bundle), str(destination)], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["declaredRuns"] == 4 and receipt["runs"] == 2 and receipt["episodes"] == 4
    artifact = json.loads((destination / "runtime/artifact.json").read_text())
    assert {run["id"] for run in artifact["runs"]} == {"run-0", "run-1"}
    assert receipt["verifiedFailures"] == 1
    assert len(receipt["exclusions"]) == 2


def test_censored_verification_is_retained_but_not_taught_as_a_task_failure(cohort, tmp_path):
    outcomes = read_jsonl(cohort / "outcomes.jsonl")
    outcomes[1]["termination"] = "provider_timeout"
    raw = json.loads((cohort / "run-1.json").read_text())
    raw["record"] = outcomes[1]
    write(cohort / "run-1.json", raw)
    (cohort / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in outcomes), encoding="utf-8")
    seal(cohort)
    output = tmp_path / "bundle"
    import_fresh(cohort, output)
    row = read_jsonl(output / "runtime-runs.jsonl")[1]
    assert row["outcomeVerified"] is True
    assert row["contrastiveEligible"] is False and row["outcomeClass"] == "censored_or_unknown"


@pytest.mark.parametrize("case", ["missing-failure", "unclosed", "service-failed", "missing-close", "actor", "family", "raw-tamper", "unknown-success"])
def test_fresh_bridge_rejects_invalid_lineage(cohort, tmp_path, case):
    if case == "missing-failure":
        rows = read_jsonl(cohort / "outcomes.jsonl")
        (cohort / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows if row["success"]), encoding="utf-8")
        seal(cohort)
    elif case == "unclosed":
        receipt = json.loads((cohort / "cohort-receipt.json").read_text())
        receipt["completed"] = False
        write(cohort / "cohort-receipt.json", receipt)
    elif case in {"service-failed", "missing-close"}:
        receipt = json.loads((cohort / "cohort-receipt.json").read_text())
        if case == "service-failed":
            receipt["serviceExitCode"] = 1
        else:
            del receipt["closed"]
        write(cohort / "cohort-receipt.json", receipt)
    elif case == "actor":
        manifest = json.loads((cohort / "manifest.json").read_text())
        manifest["actor"]["repository"] = "other/model"
        write(cohort / "manifest.json", manifest)
        seal(cohort)
    elif case == "family":
        design = json.loads((cohort / "design.json").read_text())
        design["trainingFamilies"].append("dev")
        write(cohort / "design.json", design)
        seal(cohort)
    elif case == "raw-tamper":
        write(cohort / "run-0.json", {})
    else:
        raw = json.loads((cohort / "run-0.json").read_text())
        raw["verdict"]["evaluationValid"] = False
        write(cohort / "run-0.json", raw)
        seal(cohort)
    with pytest.raises(ValueError):
        import_fresh(cohort, tmp_path / "bundle")
    assert not (tmp_path / "bundle").exists()


def test_explicit_pilot_size_is_not_silently_shrunk(cohort, tmp_path):
    with pytest.raises(ValueError, match="Insufficient"):
        import_fresh(cohort, tmp_path / "bundle", pilot_count=100)
    assert not (tmp_path / "bundle").exists()


@pytest.mark.parametrize("path", ["../cohort/configuration.json", "service/../configuration.json", "configuration.json\\extra", "C:/outside.json"])
def test_receipt_rejects_unsafe_paths(cohort, tmp_path, path):
    receipt = json.loads((cohort / "cohort-receipt.json").read_text())
    receipt["files"][0]["path"] = path
    write(cohort / "cohort-receipt.json", receipt)
    with pytest.raises(ValueError, match="Unsafe"):
        import_fresh(cohort, tmp_path / "bundle")
    assert not (tmp_path / "bundle").exists()


def test_failed_slot_without_public_messages_is_retained(cohort, tmp_path):
    raw = json.loads((cohort / "run-1.json").read_text())
    raw["simulation"]["messages"] = []
    raw["verdict"] = None
    write(cohort / "run-1.json", raw)
    seal(cohort)
    import_fresh(cohort, tmp_path / "bundle")
    rows = read_jsonl(tmp_path / "bundle/runtime-runs.jsonl")
    assert rows[1]["messages"] == [] and rows[1]["memoryEligible"] is False
    assert len(read_jsonl(tmp_path / "bundle/verdicts.jsonl")) == 4


def split_cohorts(cohort, tmp_path):
    """Independent sealed collections, not concatenated result files."""
    result = []
    for name, development in (("primary", False), ("auxiliary", True)):
        target = tmp_path / name
        shutil.copytree(cohort, target)
        config = json.loads((target / "configuration.json").read_text())
        config["runs"] = [run for run in config["runs"] if (run["familyId"] == "dev") is development]
        if development:
            config.update(collectionPurpose="auxiliary-development-validation", hosted={"allocation": "development"})
        ids = {run["runId"] for run in config["runs"]}
        manifest = json.loads((target / "manifest.json").read_text())
        manifest["protocol"]["scheduleHash"] = hash_v1(config["runs"])
        design = json.loads((target / "design.json").read_text())
        design["runs"] = config["runs"]
        contexts = json.loads((target / "public-contexts.json").read_text())
        for filename, value in (("configuration.json", config), ("manifest.json", manifest), ("design.json", design),
                                ("public-contexts.json", {key: value for key, value in contexts.items() if key in ids})):
            write(target / filename, value)
        outcomes = [row for row in read_jsonl(target / "outcomes.jsonl") if row["runId"] in ids]
        (target / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in outcomes))
        seal(target)
        result.append(target)
    return result


def test_multiple_cohorts_preserve_parent_bytes_failures_and_development_exclusion(cohort, tmp_path):
    parents = split_cohorts(cohort, tmp_path)
    before = [path.joinpath("cohort-receipt.json").read_bytes() for path in parents]
    output = tmp_path / "combined"
    import_fresh_cohorts(parents, output, pilot_count=2, audit_count=1)
    verify_bundle(output)
    assert before == [path.joinpath("cohort-receipt.json").read_bytes() for path in parents]
    aggregate = json.loads((output / "cohort-receipt.json").read_text())
    assert aggregate["pairedComparisonSlotsReused"] is False
    assert len(aggregate["cohorts"]) == 2 and len(aggregate["episodeCohorts"]) == 4
    assert [row["receiptText"].encode() for row in aggregate["cohorts"]] == before
    lineage = json.loads((output / "lineage.json").read_text())
    assert lineage["version"] == "acephale-infra-fresh-native-v2"
    assert lineage["cohort_receipt_sha256"] == file_hash(output / "cohort-receipt.json")
    assert len(read_jsonl(output / "verdicts.jsonl")) == 4
    assert {row["split"] for row in read_jsonl(output / "public.jsonl")} == {"train", "development"}
    memory = json.loads((output / "memory.json").read_text())
    assert memory["training_families"] == ["train-ok"]
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-infra-memory.ts", "--fresh",
                             str(output), str(tmp_path / "runtime")], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    artifact = json.loads((tmp_path / "runtime/runtime/artifact.json").read_text())
    assert {row["id"] for row in artifact["runs"]} == {"run-0", "run-1"}


@pytest.mark.parametrize("case", ["duplicate-parent", "implicit-purpose", "wrong-allocation", "actor-configuration", "family-policy", "task-bundle", "cross-domain-policy"])
def test_multiple_cohorts_reject_incompatible_or_unattributed_sources(cohort, tmp_path, case):
    parents = split_cohorts(cohort, tmp_path)
    auxiliary = parents[1]
    if case == "duplicate-parent":
        parents[1] = parents[0]
    elif case in {"implicit-purpose", "wrong-allocation"}:
        config = json.loads((auxiliary / "configuration.json").read_text())
        if case == "implicit-purpose":
            del config["collectionPurpose"]
        else:
            config["hosted"]["allocation"] = "training"
        write(auxiliary / "configuration.json", config)
        seal(auxiliary)
    elif case in {"actor-configuration", "family-policy"}:
        manifest = json.loads((auxiliary / "manifest.json").read_text())
        if case == "actor-configuration":
            manifest["actor"]["temperature"] = 0.5
        else:
            manifest["data"]["heldoutFamilies"].append("undeclared-test")
            design = json.loads((auxiliary / "design.json").read_text())
            design["heldoutFamilies"].append("undeclared-test")
            write(auxiliary / "design.json", design)
        write(auxiliary / "manifest.json", manifest)
        seal(auxiliary)
    elif case == "task-bundle":
        tasks = {"version": 1, "tasks": [], "changed": True}
        config = json.loads((auxiliary / "configuration.json").read_text())
        config["taskBundleHash"] = hash_v1(tasks)
        write(auxiliary / "configuration.json", config)
        write(auxiliary / "tasks.json", tasks)
        seal(auxiliary)
    else:
        contexts = json.loads((auxiliary / "public-contexts.json").read_text())
        contexts["run-3"]["policy"] = "Changed policy"
        write(auxiliary / "public-contexts.json", contexts)
        seal(auxiliary)
    with pytest.raises(ValueError):
        import_fresh_cohorts(parents, tmp_path / "bad")
    assert not (tmp_path / "bad").exists()


def test_original_audit_follows_verified_unchanged_parent_prefixes(cohort, tmp_path):
    parents = split_cohorts(cohort, tmp_path)
    original = tmp_path / "original"
    original_manifest = import_fresh(parents[0], original, pilot_count=2, audit_count=1)
    pilot_path = original / "annotation-pilot/pilot.json"
    before = pilot_path.read_bytes()
    pilot = json.loads(before)
    merged = tmp_path / "merged"
    merged_manifest = import_fresh_cohorts(parents, merged, parent_bundles=[original])
    assert merged_manifest["bundle_hash"] != original_manifest["bundle_hash"]
    binding = verify_parent_audit_source(merged, pilot)
    assert binding["sourceDatasetHash"] == original_manifest["bundle_hash"]
    assert pilot_path.read_bytes() == before
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-infra-memory.ts", "--fresh",
                             str(merged), str(tmp_path / "runtime-parent")], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    pilot["checkpoints"][0]["input_hash"] = "0" * 64
    with pytest.raises(ValueError, match="changed"):
        verify_parent_audit_source(merged, pilot)
    pilot = json.loads(before)
    pilot["source_dataset_hash"] = "1" * 64
    with pytest.raises(ValueError, match="unique verified parent"):
        verify_parent_audit_source(merged, pilot)


def test_parent_lineage_cannot_reseal_changed_public_input(cohort, tmp_path):
    parents = split_cohorts(cohort, tmp_path)
    original = tmp_path / "original"
    import_fresh(parents[0], original, pilot_count=2, audit_count=1)
    merged = tmp_path / "merged"
    import_fresh_cohorts(parents, merged, parent_bundles=[original])
    public = read_jsonl(merged / "public.jsonl")
    public[0]["input"]["policy"] = "A new policy"
    public[0]["input_hash"] = hash_v1(public[0]["input"])
    path = merged / "public.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in public))
    manifest = json.loads((merged / "manifest.json").read_text())
    manifest["files"]["public.jsonl"]["sha256"] = file_hash(path)
    manifest["bundle_hash"] = hash_v1(manifest["files"])
    write(merged / "manifest.json", manifest)
    pilot = json.loads((original / "annotation-pilot/pilot.json").read_text())
    with pytest.raises(ValueError, match="bytes or split changed"):
        verify_parent_audit_source(merged, pilot)


def test_multiple_cohorts_reject_duplicated_trials_even_in_different_directories(cohort, tmp_path):
    parents = split_cohorts(cohort, tmp_path)
    duplicate = tmp_path / "duplicate-auxiliary"
    shutil.copytree(parents[1], duplicate)
    with pytest.raises(ValueError, match="Repeated trial or episode"):
        import_fresh_cohorts([*parents, duplicate], tmp_path / "bad")


def test_hidden_user_simulator_tools_do_not_enter_public_memory(cohort, tmp_path):
    raw = json.loads((cohort / "run-0.json").read_text())
    raw["simulation"]["messages"] = [
        {"role": "user", "content": "private simulator thought", "tool_calls": [{"id": "hidden", "name": "hidden_user_tool", "arguments": {}}]},
        {"role": "tool", "id": "hidden", "requestor": "user", "content": "private result"},
        *raw["simulation"]["messages"],
    ]
    write(cohort / "run-0.json", raw)
    seal(cohort)
    import_fresh(cohort, tmp_path / "bundle")
    for name in ("public.jsonl", "runtime-runs.jsonl", "trajectories.jsonl"):
        text = (tmp_path / "bundle" / name).read_text()
        assert "private simulator thought" not in text and "hidden_user_tool" not in text


def test_memory_bridge_rejects_rewritten_runtime_scope(cohort, tmp_path):
    root = Path(__file__).resolve().parents[3]
    if not (root / "node_modules" / "tsx").exists():
        pytest.skip("Node dependencies are not installed")
    output = tmp_path / "bundle"
    import_fresh(cohort, output)
    rows = read_jsonl(output / "runtime-runs.jsonl")
    rows[0]["scope"]["tenantId"] = "other-tenant"
    path = output / "runtime-runs.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    manifest = json.loads((output / "manifest.json").read_text())
    manifest["files"]["runtime-runs.jsonl"]["sha256"] = file_hash(path)
    manifest["bundle_hash"] = hash_v1(manifest["files"])
    write(output / "manifest.json", manifest)
    result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-infra-memory.ts", "--fresh", str(output), str(tmp_path / "memory")], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode != 0 and "scope or source mismatch" in result.stderr
    assert not (tmp_path / "memory").exists()
