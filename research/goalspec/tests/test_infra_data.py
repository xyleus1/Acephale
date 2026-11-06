from __future__ import annotations

import json
from pathlib import Path

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_cli import main
from goalspec.infra_data import (
    EpisodeMeta,
    GoalAnnotation,
    all_checkpoints,
    audit_gate,
    bind_annotation_draft,
    build_memory,
    build_split,
    export_rows,
    public_context,
    publish_bundle,
    select_pilot,
    validate_annotation,
    verify_bundle,
    verify_split,
)
from goalspec.schemas import Event, GoalSignature, Outcome, ToolContract, Trajectory


def corpus(families=10):
    trajectories, metadata = [], {}
    tools = (
        ToolContract(name="find", side_effects="read_only", cacheable=True, version="env1", parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
        ToolContract(name="get", side_effects="read_only", cacheable=True, version="env1", parameters={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}),
    )
    for index in range(families):
        trajectory = Trajectory(
            trajectory_id=f"episode-{index}", benchmark="fixture-only", domain="docs",
            task_id=f"task-{index}", group_id=f"family-{index}", trial=0,
            source_kind="synthetic", benchmark_revision="env1", policy="Read approved documents.",
            initial_tools=tools,
            events=(
                Event(seq=0, kind="message", role="user", content=f"Find document {index}"),
                Event(seq=1, kind="message", role="assistant", content="FUTURE_PLAN_SENTINEL"),
                Event(seq=2, kind="tool_request", tool="find", call_id="find-1", arguments={"query": f"document {index}"}),
                Event(seq=3, kind="tool_result", role="tool", tool="find", call_id="find-1", status="success", result={"id": f"DOC-{index}"}),
                Event(seq=4, kind="tool_request", tool="get", call_id="get-1", arguments={"id": f"DOC-{index}"}),
                Event(seq=5, kind="tool_result", role="tool", tool="get", call_id="get-1", status="success", result={"text": "public document"}),
                Event(seq=6, kind="message", role="assistant", content="The document explains it."),
            ),
            outcome=Outcome(status="completed", success=True, evaluator_version="independent-fixture-v1", goal=GoalSignature(goal_id="PRIVATE_ENDPOINT_SENTINEL", objective="PRIVATE_ENDPOINT_SENTINEL", object_type="hidden", completion=("private",))),
        )
        context = public_context(trajectory)
        meta = EpisodeMeta(
            episode_id=trajectory.trajectory_id, family_id=trajectory.group_id,
            scope={"tenant_id": "research", "principal_id": "operator", "authorization_revision": "auth1"},
            request_revision="req1", environment_version="env1", tool_schema_hash=hash_v1(context["tools"]),
            public_context_hash=hash_v1(context), captured_before_execution=True,
            verification_tier="independent_replay", license="fixture-only", source_revision="fixture1",
        )
        trajectories.append(trajectory)
        metadata[trajectory.trajectory_id] = meta
    return trajectories, metadata


def annotation(public):
    source = public["input"]["sources"][1]
    return GoalAnnotation.model_validate({
        "checkpoint_id": public["checkpoint_id"], "input_hash": public["input_hash"],
        "request_revision": public["request_revision"], "annotation_version": "pilot1",
        "teacher_model": "test-only", "unknown_probability": .1,
        "goals": [{"action": "retrieve", "object_type": "document", "objective": "Find requested document", "confidence": .9, "sources": [{"source_id": source["id"], "value_hash": hash_v1(source["value"])}]}],
    })


def test_public_prefix_projection_and_no_read():
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    public, labels, verdicts = export_rows(trajectories, metadata, split)
    assert len(public) == 30
    first = public[0]
    text = json.dumps(first)
    assert "PRIVATE_ENDPOINT_SENTINEL" not in json.dumps(public)
    assert "FUTURE_PLAN_SENTINEL" not in text
    assert "DOC-0" not in text
    assert "outcome" not in text
    assert "referenceActions" not in text
    assert labels[0]["next_invocations"][0]["tool"] == "find"
    assert labels[2]["target_kind"] == "NO_READ"
    assert labels[2]["next_invocations"] == []
    assert "goal" not in verdicts[0]["outcome"]
    assert all(row["input_hash"] == hash_v1(row["input"]) for row in public)


def test_split_does_not_depend_on_endpoint_or_reward():
    trajectories, metadata = corpus()
    before = build_split(trajectories, metadata)
    changed = [row.model_copy(update={"outcome": Outcome(status="failed", success=False)}) for row in trajectories]
    assert build_split(changed, metadata) == before
    assert set(before["families"].values()) == {"train", "development", "test"}


def test_split_rejects_same_task_across_families():
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    train = next(row for row in trajectories if split["families"][row.group_id] == "train")
    test = next(row for row in trajectories if split["families"][row.group_id] == "test")
    changed = [row.model_copy(update={"task_id": train.task_id}) if row == test else row for row in trajectories]
    with pytest.raises(ValueError, match="crosses"):
        verify_split(split, changed, metadata)


def test_export_rejects_private_join_and_capture_hash_change():
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    first = trajectories[0]
    events = list(first.events)
    events[3] = events[3].model_copy(update={"result": {"referenceActions": ["PRIVATE"]}})
    changed = [first.model_copy(update={"events": tuple(events)}), *trajectories[1:]]
    with pytest.raises(ValueError, match="Private field"):
        export_rows(changed, metadata, split)
    changed = [first.model_copy(update={"policy": "modified"}), *trajectories[1:]]
    with pytest.raises(ValueError, match="capture hash"):
        export_rows(changed, metadata, split)


def test_unresolved_calls_cannot_be_no_read_checkpoints():
    trajectories, _ = corpus()
    row = trajectories[0]
    altered = row.model_copy(update={"events": row.events[:3] + (Event(seq=3, kind="message", role="assistant", content="done"),)})
    with pytest.raises(ValueError, match="unresolved"):
        all_checkpoints(altered)


def test_goal_provenance_and_semantics_are_separate():
    trajectories, metadata = corpus()
    public, _, _ = export_rows(trajectories, metadata, build_split(trajectories, metadata))
    goal = annotation(public[0])
    result = validate_annotation(goal, public[0])
    assert result["provenance_valid"]
    assert result["semantic_correctness"] == "not_established_by_source_validation"
    with pytest.raises(ValueError, match="Stale"):
        validate_annotation(goal.model_copy(update={"request_revision": "old"}), public[0])
    wrong_source = goal.goals[0].sources[0].model_copy(update={"source_id": "event:999"})
    wrong_goal = goal.goals[0].model_copy(update={"sources": (wrong_source,)})
    with pytest.raises(ValueError, match="non-visible"):
        validate_annotation(goal.model_copy(update={"goals": (wrong_goal,)}), public[0])
    wrong_source = goal.goals[0].sources[0].model_copy(update={"value_hash": "0" * 64})
    wrong_goal = goal.goals[0].model_copy(update={"sources": (wrong_source,)})
    with pytest.raises(ValueError, match="value changed"):
        validate_annotation(goal.model_copy(update={"goals": (wrong_goal,)}), public[0])


def test_teacher_selects_sources_while_server_owns_hashes_and_identity():
    trajectories, metadata = corpus()
    public, _, _ = export_rows(trajectories, metadata, build_split(trajectories, metadata))
    draft = {"unknown_probability": .1, "goals": [{"action": "retrieve", "object_type": "document", "objective": "Find the document", "confidence": .9, "sources": [{"source_id": "event:0"}]}]}
    result = bind_annotation_draft(draft, public[0], teacher_model="test-only", annotation_version="test")
    assert result.input_hash == public[0]["input_hash"]
    assert result.goals[0].sources[0].value_hash == hash_v1("Find document 0")
    draft["goals"][0]["sources"][0]["value_hash"] = "0" * 64
    with pytest.raises(ValueError, match="not generate"):
        bind_annotation_draft(draft, public[0], teacher_model="test-only", annotation_version="test")


def test_pilot_requires_enough_rows_and_never_selects_test():
    trajectories, metadata = corpus()
    public, _, _ = export_rows(trajectories, metadata, build_split(trajectories, metadata))
    with pytest.raises(ValueError, match="Insufficient"):
        select_pilot(public)
    pilot = select_pilot(public, count=10, audit_count=4)
    assert pilot == select_pilot(public, count=10, audit_count=4)
    training = {row["checkpoint_id"] for row in public if row["split"] == "train"}
    assert {row["checkpoint_id"] for row in pilot["checkpoints"]} <= training
    assert len({row["checkpoint_id"] for row in pilot["audit"]}) == 4
    assert any("unavailable" in row["reason"] for row in pilot["audit"])


def test_pilot_cli_binds_the_frozen_source_bundle_and_split(tmp_path):
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    public, _, _ = export_rows(trajectories, metadata, split)
    dataset = tmp_path / "source"
    manifest = publish_bundle(dataset, {"public.jsonl": public, "split.json": split})
    output = tmp_path / "pilot"
    main(["pilot", "--dataset", str(dataset), "--output", str(output), "--count", "10", "--audit-count", "4"])
    verify_bundle(output)
    declaration = json.loads((output / "pilot.json").read_text(encoding="utf-8"))
    assert declaration["source_dataset_hash"] == manifest["bundle_hash"]
    assert declaration["source_split_hash"] == hash_v1(split)


def test_audit_gate_retains_disagreement_and_missing_audit():
    trajectories, metadata = corpus()
    public, _, _ = export_rows(trajectories, metadata, build_split(trajectories, metadata))
    pilot = select_pilot(public, count=10, audit_count=4)
    reviews = [{"checkpoint_id": row["checkpoint_id"], "reviewer": "human", "rubric_version": "v1", "semantics_acceptable": True, "unsupported_binding": False} for row in pilot["audit"]]
    assert audit_gate(pilot, reviews)["goal_conditioning_allowed"]
    reviews[0]["semantics_acceptable"] = False
    assert not audit_gate(pilot, reviews)["goal_conditioning_allowed"]
    with pytest.raises(ValueError, match="exactly once"):
        audit_gate(pilot, reviews[:-1])


def test_memory_is_frozen_scoped_training_only_and_endpoint_free():
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    snapshot = build_memory(trajectories, metadata, split)
    assert snapshot["frozen"]
    assert "PRIVATE_ENDPOINT_SENTINEL" not in json.dumps(snapshot)
    assert snapshot["prediction_misses"] == []
    assert snapshot["confusions"] == []
    assert snapshot["training_families"] == sorted(family for family, value in split["families"].items() if value == "train")
    assert len(snapshot["exclusions"]) == 4
    assert snapshot["snapshot_hash"] == hash_v1({key: value for key, value in snapshot.items() if key != "snapshot_hash"})
    assert snapshot["pattern_partitions"]
    assert all(pattern["goal_id"] is None for partition in snapshot["pattern_partitions"] for pattern in partition["pattern_pool"]["patterns"])


def test_memory_excludes_source_reported_and_partitions_scope():
    trajectories, metadata = corpus()
    split = build_split(trajectories, metadata)
    training = [row for row in trajectories if split["families"][row.group_id] == "train"]
    first, second = training[:2]
    metadata[first.trajectory_id] = metadata[first.trajectory_id].model_copy(update={"verification_tier": "source_reported"})
    other = metadata[second.trajectory_id]
    metadata[second.trajectory_id] = other.model_copy(update={"scope": other.scope.model_copy(update={"tenant_id": "another-tenant"})})
    split = build_split(trajectories, metadata)
    snapshot = build_memory(trajectories, metadata, split)
    assert len(snapshot["pattern_partitions"]) == 2
    assert {row["episode_id"]: row["reason"] for row in snapshot["exclusions"]}[first.trajectory_id] == "not_independently_verified"


def test_publication_is_immutable_and_tampering_detected(tmp_path):
    destination = tmp_path / "bundle"
    manifest = publish_bundle(destination, {"rows.jsonl": [{"hello": "world"}]})
    assert verify_bundle(destination) == manifest
    with pytest.raises(FileExistsError):
        publish_bundle(destination, {"rows.jsonl": []})
    (destination / "rows.jsonl").write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        verify_bundle(destination)
    with pytest.raises(ValueError, match="single path"):
        publish_bundle(tmp_path / "bad", {"../escape.json": {}})


def test_parquet_roundtrip_preserves_arbitrary_nested_payloads(tmp_path):
    parquet = pytest.importorskip("pyarrow.parquet")
    rows = [{"nested": {"a": [None, 1, "value"], "varying": {"new": True}}}, {"unrelated": []}]
    publish_bundle(tmp_path / "bundle", {"public.jsonl": rows}, parquet=True)
    restored = parquet.read_table(tmp_path / "bundle/public.parquet").to_pydict()
    assert [json.loads(value) for value in restored["canonical_json"]] == rows
    verify_bundle(tmp_path / "bundle")


def test_cli_end_to_end_is_offline_and_exclusive(tmp_path: Path, capsys):
    trajectories, metadata = corpus()
    trace_path, meta_path = tmp_path / "traces.jsonl", tmp_path / "meta.jsonl"
    trace_path.write_text("".join(row.model_dump_json() + "\n" for row in trajectories), encoding="utf-8")
    meta_path.write_text("".join(row.model_dump_json() + "\n" for row in metadata.values()), encoding="utf-8")
    shared = ["--trajectories", str(trace_path), "--metadata", str(meta_path)]
    main(["split", *shared, "--output", str(tmp_path / "split")])
    main(["export", *shared, "--split", str(tmp_path / "split/split.json"), "--output", str(tmp_path / "dataset"), "--parquet"])
    main(["pilot", "--dataset", str(tmp_path / "dataset"), "--count", "10", "--audit-count", "4", "--output", str(tmp_path / "pilot")])
    main(["memory", *shared, "--split", str(tmp_path / "split/split.json"), "--output", str(tmp_path / "memory")])
    main(["replay-patterns", "--trajectories", str(trace_path), "--bundle", str(tmp_path / "dataset"), "--memory", str(tmp_path / "memory/memory.json"), "--output", str(tmp_path / "replay")])
    main(["verify", str(tmp_path / "dataset")])
    assert "bundle_hash" in capsys.readouterr().out
    assert (tmp_path / "pilot/annotation-inputs.jsonl").is_file()
    report = json.loads((tmp_path / "replay/report.json").read_text(encoding="utf-8"))
    assert report["measurement_kind"] == "frozen_prediction_replay"
    assert report["eligible_read_decisions"] == 4
    assert report["paid_requests"] == 0
