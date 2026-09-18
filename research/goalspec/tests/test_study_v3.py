import json
from collections import Counter

import pytest

from goalspec import study_v3 as study
from goalspec.adapters.step_gateway import StepBroker
from goalspec.fresh_tasks import digest


@pytest.fixture
def plan(tmp_path):
    upstream = tmp_path / "upstream"
    for domain in ("retail", "airline"):
        data = upstream / f"data/tau2/domains/{domain}"
        data.mkdir(parents=True)
        tasks = [{"id": str(i), "evaluation_criteria": {"reward_basis": ["DB"]}} for i in range(14)]
        study.write(data / "tasks.json", tasks)
        study.write(data / "split_tasks.json", {"train": [str(i) for i in range(4)], "test": [str(i) for i in range(4, 14)], "base": [str(i) for i in range(14)]})
        study.write(data / "db.json", {})
        (data / "policy.md").write_text("public domain policy", encoding="utf-8")
    records = tmp_path / "records.json"
    study.write(records, [])
    memory = tmp_path / "memory.json"
    study.write(memory, {"sourcePolicy": "v1-training-plus-v2-development-only", "runs": [{"stage": "v1-training", "familyId": "retail:custom"}], "sourceFiles": []})
    observed = tmp_path / "old-outcomes.jsonl"
    observed.write_text(json.dumps({"domain": "retail", "task_id": "4"}) + "\n", encoding="utf-8")
    directory = tmp_path / "study"
    return directory, study.prepare_study(directory, "test-official-v3", records, [observed], upstream=upstream, memory=memory)


def budget(path, spent=0):
    study.write(path, {"totalCeilingUsd": 500, "allocations": [{"allocation": "development", "ceilingUsd": 40, "spentOrReservedUsd": spent},
        {"allocation": "heldout", "ceilingUsd": 240, "spentOrReservedUsd": 71.145441}]})
    return path


def complete(directory, stage, output):
    design = study.read(directory / f"{stage}-design.json")
    output.mkdir()
    rows = [{**trial, "studyId": design["studyId"], "studyStage": stage, "reservedUsd": trial["reserved_usd"],
        "success": False, "budget_terminated": False, "billedUsd": .1} for trial in design["trials"]]
    (output / "outcomes.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    study.write(output / "summary.json", {"studyId": design["studyId"], "studyStage": stage})
    return study.complete_stage(directory, stage)


def test_official_split_audits_prior_exposure_without_outcome_selection(plan):
    directory, value = plan
    assert value["taskPoolAudit"]["retail"]["previouslyObservedOfficialIds"] == ["4"]
    from pathlib import Path
    without_history = study.prepare_study(directory.parent / "without-history", value["studyId"], Path(value["frozenLibrary"]["recordsPath"]),
        upstream=Path(value["upstreamRoot"]), memory=Path(value["frozenExperienceMemory"]["path"]))
    assert without_history["tasks"] == value["tasks"]
    for domain in ("retail", "airline"):
        assert not set(value["tasks"][domain]["development"]) & set(value["tasks"][domain]["confirmation"])
    assert study.load_study(directory) == value
    path = next(item["path"] for item in value["sourceInventory"] if item["path"].endswith("policy.md"))
    Path(path).write_text("changed policy", encoding="utf-8")
    with pytest.raises(ValueError, match="Frozen upstream"):
        study.load_study(directory)


def test_balanced_arm_positions_shared_seeds_and_new_round_seeds(plan):
    _, value = plan
    first = study.design_stage(value, "development-1", 40_000_000)
    second = study.design_stage(value, "development-2", 40_000_000)
    assert len(first["trials"]) == 16 and first["reserved_usd"] == 20
    assert {row["taskId"] for row in first["trials"]} == {row["taskId"] for row in second["trials"]}
    assert [row["seed"] for row in first["trials"]] != [row["seed"] for row in second["trials"]]
    positions = [Counter() for _ in range(4)]
    for start in range(0, 16, 4):
        block = first["trials"][start:start + 4]
        assert len({row["seed"] for row in block}) == 1
        assert {row["arm"] for row in block} == set(study.ARMS)
        for position, row in enumerate(block):
            positions[position][row["arm"]] += 1
    assert all(set(counts.values()) == {1} for counts in positions)


def test_confirmation_selection_uses_cost_only_and_keeps_unknowns(plan):
    _, value = plan
    outcomes = [{"billedUsd": .25, "budget_terminated": False, "success": False}]
    full = study.design_stage(value, "confirmation", 168_854_559, outcomes)
    assert full["tasks"] == 16 and len(full["trials"]) == 128 and full["reserved_usd"] == 160
    assert full == study.design_stage(value, "confirmation", 168_854_559, [{**outcomes[0], "success": True}])
    censored = study.design_stage(value, "confirmation", 168_854_559, outcomes + [{"billedUsd": None, "budget_terminated": False}])
    assert censored["tasks"] == 8 and censored["reserved_usd"] == 160
    with pytest.raises(ValueError, match="headroom"):
        study.design_stage(value, "development-1", 19_999_999)


def test_three_development_rounds_and_one_confirmation_claim(plan, tmp_path, monkeypatch):
    directory, _ = plan
    from goalspec import source_freeze_v3
    monkeypatch.setattr(source_freeze_v3, "verify_stage_freeze", lambda *_: {"passed": True})
    freeze = tmp_path / "freeze"
    freeze.mkdir()
    study.write(freeze / "manifest.json", {})
    config = tmp_path / "config.json"
    study.write(config, configuration())
    for index in range(1, 4):
        stage, output = f"development-{index}", tmp_path / f"dev{index}"
        report = budget(tmp_path / f"budget{index}.json", spent=index)
        study.claim_stage(directory, stage, output, report, freeze, config)
        with pytest.raises(ValueError, match="consumed"):
            study.claim_stage(directory, stage, tmp_path / "retry", report)
        assert complete(directory, stage, output)["trials"] == 16
    report = budget(tmp_path / "final-budget.json")
    study.claim_stage(directory, "confirmation", tmp_path / "confirm", report, freeze, config)
    with pytest.raises(ValueError, match="consumed"):
        study.claim_stage(directory, "confirmation", tmp_path / "confirm-again", report, freeze)
    with pytest.raises(ValueError):
        study.claim_stage(directory, "development-4", tmp_path / "dev4", report)


def configuration():
    return {"eagerWaitMs": 80, "maxCandidateCalls": 6, "estimate": {"toolMs": 0, "validationMs": 8.5,
            "schedulingMs": 1, "exposedPredictionMs": 0, "actorRoundMs": 1000}}


def test_missing_configuration_does_not_consume_stage(plan, tmp_path):
    directory, _ = plan
    with pytest.raises(ValueError, match="complete v3 session"):
        study.claim_stage(directory, "development-1", tmp_path / "output", budget(tmp_path / "budget.json"))
    assert not (directory / "development-1-design.json").exists()
    assert not (directory / "development-1-claim.json").exists()


def test_memory_rejects_official_runs_and_public_corpus(tmp_path):
    memory = tmp_path / "memory.json"
    base = {"sourcePolicy": "v1-training-plus-v2-development-only", "runs": [{"stage": "v1-training", "familyId": "retail:4"}]}
    study.write(memory, base)
    with pytest.raises(ValueError, match="Official task"):
        study.audit_memory(memory, {"retail:4"})
    memory.write_text(json.dumps({**base, "runs": [{"stage": "v1-training", "familyId": "retail:custom"}],
        "sourceFiles": [{"path": "runs/public-pilot/corpus.jsonl"}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="public benchmark"):
        study.audit_memory(memory, set())


def test_stage_setup_abort_retains_declared_slots_and_existing_outcome(plan, tmp_path):
    from goalspec.official_native import declared_trials, retain_stage_failure
    directory, value = plan
    design = study.design_stage(value, "development-1", 40_000_000)
    path = directory / "development-1-design.json"
    study.write(path, design)
    output = tmp_path / "output"
    output.mkdir()
    run_id, trial = declared_trials(value, design)[0]
    original = {**trial, "runId": run_id, "success": True, "billedUsd": .1}
    initial_bytes = (json.dumps(original) + "\n").encode()
    (output / "outcomes.jsonl").write_bytes(initial_bytes)
    summary = retain_stage_failure(directory, path, output, tmp_path, RuntimeError("before service setup"))
    assert (output / "outcomes.jsonl").read_bytes().startswith(initial_bytes)
    rows = [json.loads(line) for line in (output / "outcomes.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 16 and rows[0] == original and summary["successes"] == 1
    assert all(row["termination"] == "stage_abort" and row["latencyMs"] is None for row in rows[1:])


def test_slot_setup_failure_drains_all_three_roles_without_truth_serialization(tmp_path):
    from goalspec.official_native import retain_slot_failure
    class Broker:
        closed = []
        def finish(self, worker):
            self.closed.append(worker)
    row, artifact, broker = {"runId": "v3-test", "success": False}, {}, Broker()
    with retain_slot_failure(row, artifact, broker, tmp_path):
        raise ValueError("private fixture contents must not be copied into errors")
    assert broker.closed == ["v3-test", "v3-test:user", "v3-test:evaluator"]
    assert row["success"] is False and row["termination"] == "slot_setup_or_telemetry_error"
    assert "private fixture" not in json.dumps({"row": row, "artifact": artifact})


def test_stage_freeze_archives_inputs_and_binds_stage_config(plan, tmp_path, monkeypatch):
    from goalspec import source_freeze, source_freeze_v3
    directory, _ = plan
    code = tmp_path / "runtime.py"
    code.write_text("immutable = True\n", encoding="utf-8")
    def collect(*args, **kwargs):
        return {"runtime.py": code}
    monkeypatch.setattr(source_freeze_v3, "collect_sources", collect)
    monkeypatch.setattr(source_freeze, "collect_sources", collect)
    monkeypatch.setattr(source_freeze_v3.subprocess, "check_output", lambda *args, **kwargs: "test-head\n")
    config = tmp_path / "config.json"
    study.write(config, configuration())
    frozen = tmp_path / "frozen"
    source_freeze_v3.freeze_stage(tmp_path, frozen, directory, "development-1", config, require_native=False)
    assert source_freeze.verify_source(tmp_path, frozen)["passed"]
    assert source_freeze_v3.verify_stage_freeze(tmp_path, frozen, directory, "development-1", configuration())["stageInputsAndArchiveUnchanged"]
    with pytest.raises(ValueError, match="differs"):
        source_freeze_v3.verify_stage_freeze(tmp_path, frozen, directory, "development-2", configuration())
    with pytest.raises(ValueError, match="differs"):
        source_freeze_v3.verify_stage_freeze(tmp_path, frozen, directory, "development-1", {**configuration(), "eagerWaitMs": 81})
    (frozen / "inputs.zip").write_bytes(b"altered archive")
    with pytest.raises(ValueError, match="input archive integrity"):
        source_freeze_v3.verify_stage_freeze(tmp_path, frozen, directory, "development-1", configuration())


def test_ready_handshake_rejects_other_service_and_closed_bootstrap():
    expected = digest({"runs": ["paired"]})
    broker = StepBroker(expected)
    with pytest.raises(TimeoutError):
        broker.wait_ready(.001)
    with pytest.raises(ValueError):
        broker.mark_ready("0" * 64)
    assert broker.mark_ready(expected) == {"ready": True}
    ready = broker.wait_ready(.01)
    assert broker.mark_ready(expected) == {"ready": True}
    assert broker.wait_ready(.01) == ready
    failed = StepBroker(expected)
    failed.close()
    with pytest.raises(RuntimeError, match="closed before"):
        failed.wait_ready(.01)
