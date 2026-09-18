import json

import pytest

from goalspec.fresh_tasks import FAMILIES, build_tasks, digest, explicit_consent
from goalspec.native_live import paired_blocks, phase_design, telemetry
from goalspec.training_export import export_native


def test_family_split_and_fixtures_are_deterministic_and_disjoint():
    tasks = build_tasks()
    assert tasks == build_tasks()
    assert len(tasks) == 92
    expected = {"train": 48, "development": 12, "heldout": 32}
    for split, count in expected.items():
        assert len([task for task in tasks if task["split"] == split]) == count
    groups = [{task["familyId"] for task in tasks if task["split"] == split} for split in expected]
    assert all(not left & right for i, left in enumerate(groups) for right in groups[i + 1:])
    assert len({task["fixtureHash"] for task in tasks}) == 92
    for task in tasks:
        assert task["fixtureHash"] == digest({key: value for key, value in task.items() if key != "fixtureHash"})
        assert task["familyId"].split(":")[1] in FAMILIES[task["domain"]][task["split"]]


def test_consent_distinguishes_cancellation_reason_from_denial():
    assert explicit_consent("Yes, please go ahead and cancel the order since I no longer need it.") is True
    assert explicit_consent("No, don't cancel.") is False
    assert explicit_consent("I do not confirm. Do not proceed.") is False
    assert explicit_consent("Yes, I confirm, with no extra bags.") is True
    assert explicit_consent("My email is avery@example.test.") is None


def test_three_arm_design_reserves_whole_grid_and_pairs_seeds():
    manifest = {"tasks": build_tasks()}
    train = phase_design(manifest, "train")
    assert len(train["trials"]) == 48
    assert train["reserved_usd"] == 60
    assert {trial["arm"] for trial in train["trials"]} == {"base"}
    dev = phase_design(manifest, "development")
    assert len(dev["trials"]) == 36
    assert dev["reserved_usd"] == 36
    assert dev == phase_design(manifest, "development")
    for offset in range(0, 36, 3):
        block = dev["trials"][offset:offset + 3]
        assert len({trial["seed"] for trial in block}) == 1
        assert len({trial["arm"] for trial in block}) == 3
    heldout = phase_design(manifest, "heldout", [{"billedUsd": .5, "budget_terminated": False}])
    assert len(heldout["families"]) == 16
    assert len(heldout["trials"]) == 192
    assert heldout["reserved_usd"] == 240
    with pytest.raises(ValueError, match="development"):
        phase_design(manifest, "heldout")
    entries = [(str(index), trial, None, None) for index, trial in enumerate(dev["trials"])]
    blocks = paired_blocks(entries)
    assert len(blocks) == 12 and all(len(block) == 3 for block in blocks)
    assert [entry for block in blocks for entry in block] == entries
    with pytest.raises(ValueError, match="contiguous"):
        paired_blocks([*entries, entries[0]])


def test_nested_run_telemetry_counts_user_embedding_and_unknown_charges(tmp_path):
    events = [{"runId": "run", "event": {"type": kind, "costMicrodollars": cost}} for kind, cost in [("model_attempt", 20), ("embedding", 4), ("rejected", 0), ("cancellation_confirmed", 0)]]
    events.append({"runId": "other", "event": {"type": "model_attempt", "costMicrodollars": 999}})
    path = tmp_path / "events-test.jsonl"
    path.write_text("".join(json.dumps({"body": {"event": event}}) + "\n" for event in events), encoding="utf-8")
    result = telemetry(tmp_path, "run")
    assert result["billedUsd"] == .000024
    assert result["providerCalls"] == 2
    assert result["rejectedCalls"] == result["cancelledCalls"] == 1
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"body": {"event": {"runId": "run", "event": {"type": "model_attempt_failed"}}}}) + "\n")
    assert telemetry(tmp_path, "run")["billedUsd"] is None


def test_training_export_preserves_real_calls_causal_prefixes_and_independent_verdict(tmp_path):
    task = next(task for task in build_tasks() if task["taskId"] == "retail:status:v0")
    source = tmp_path / "source"
    source.mkdir()
    row = {"runId": "fixture-run", "taskId": task["taskId"], "familyId": task["familyId"], "domain": "retail", "arm": "base",
           "fixtureHash": task["fixtureHash"], "success": True, "variant": 0, "trial": 0, "seed": 17, "termination": "user_stop",
           "budget_terminated": False, "constraintViolations": 0, "latencyMs": 100.0}
    tool = {"type": "function", "function": {"name": "get_order_details", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}}}
    order_id = next(iter(task["initialDatabase"]["orders"]))
    messages = [{"role": "user", "content": task["initialRequest"]},
                {"role": "assistant", "content": "Decision-generated prose must not leak.", "tool_calls": [{"id": "real-call-id", "name": "get_order_details", "arguments": {"order_id": order_id}}]},
                {"role": "tool", "id": "real-call-id", "content": '{"status":"pending"}', "error": False},
                {"role": "assistant", "content": "The order is pending."}, {"role": "user", "content": "###STOP###"}]
    artifact = {"record": row, "simulation": {"messages": messages}, "independentCheck": {"evaluatorVersion": "fixture-independent-v1"},
                "verdict": {"success": True, "stateMatch": True, "constraintViolations": 0}}
    for name, value in [("fixture-run.json", artifact), ("public-contexts.json", {"fixture-run": {"policy": "fixture policy", "tools": [tool], "capturedBeforeExecution": True}}), ("design.json", {"trials": [row]})]:
        (source / name).write_text(json.dumps(value), encoding="utf-8")
    (source / "outcomes.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    fixture_path = tmp_path / "fixtures.json"
    fixture_path.write_text(json.dumps({"tasks": [task]}), encoding="utf-8")
    output = tmp_path / "export"
    result = export_native(source, fixture_path, output)
    assert result["episodes"] == result["verifiedSuccesses"] == result["checkpoints"] == 1
    mining = json.loads((output / "mining-episodes.json").read_text(encoding="utf-8"))[0]
    assert mining["checkpoints"][0]["targets"] == [{"tool": "get_order_details", "arguments": {"order_id": order_id}}]
    assert not any("Decision-generated" in (event.get("content") or "") for event in mining["checkpoints"][0]["prefix"]["events"])
    trajectory = json.loads((output / "trajectories.jsonl").read_text(encoding="utf-8"))
    assert any(event["call_id"] == "real-call-id" for event in trajectory["events"])
    assert trajectory["outcome"]["native_reward"] is None
    bundle = json.loads((output / "repository-bundle.json").read_text(encoding="utf-8"))
    assert bundle["episodes"][0]["metadata"]["requestedGoalAnnotation"] is None
    assert bundle["verifications"][0]["success"]
    with pytest.raises(ValueError, match="split"):
        export_native(source, fixture_path, tmp_path / "bad-export", phase="heldout")
