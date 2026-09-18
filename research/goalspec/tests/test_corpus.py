import json

import pytest

from goalspec.corpus import ingest, normalized_source, records


@pytest.mark.parametrize("text", ['[{},{}]', '[ {"x": 1}, {"x": 2} ]', '[]'])
def test_streaming_array(text, tmp_path):
    source = tmp_path / "data.json"
    source.write_text(text)
    assert list(records(source)) == json.loads(text)


@pytest.mark.parametrize("text", ['[{},]', '[{}{}]', '[,{}]', '[{}', '[{}]{}'])
def test_malformed_streaming_array(text, tmp_path):
    source = tmp_path / "data.json"
    source.write_text(text)
    with pytest.raises(ValueError):
        list(records(source))


def test_lineage_dedup_and_family_quarantine(tmp_path):
    source = tmp_path / "data.jsonl"
    row = {"messages": [{"role": "user", "content": "lookup"}], "available_tools": []}
    source.write_text(json.dumps(row) + "\n" + json.dumps(row) + "\n")
    manifest = ingest(source, tmp_path / "out", "toucan", "a" * 40, "source license text", {"0": ("family", "train"), "1": ("family", "train")}, tmp_path / "dedup.db")
    assert manifest["counts"] == {"raw": 2, "admitted": 1, "quarantined": 1}
    assert manifest["native_executable_count"] == 0
    with pytest.raises(ValueError, match="crosses"):
        ingest(source, tmp_path / "bad", "toucan", "a" * 40, "license", {"0": ("family", "train"), "1": ("family", "test")}, tmp_path / "dedup.db")


def test_dedup_includes_tools_policy_output_and_retains_duplicate_lineage(tmp_path):
    source = tmp_path / "data.jsonl"
    original = {"messages": [{"role": "user", "content": "lookup"}], "tools": [], "system": "policy A"}
    rows = [original, {**original, "system": "policy B"}, {**original, "tools": [{"name": "lookup", "parameters": {"type": "object"}}]}, original]
    source.write_text("\n".join(json.dumps(row) for row in rows))
    report = ingest(source, tmp_path / "out", "toucan", "a" * 40, "license", {str(i): ("family" if i < 3 else "test-family", "train" if i < 3 else "test") for i in range(4)}, tmp_path / "dedup.db")
    assert report["counts"] == {"raw": 4, "admitted": 3, "quarantined": 1}
    assert report["cross_split_duplicate_count"] == 1
    duplicate = json.loads((tmp_path / "out" / "duplicates.jsonl").read_text())
    assert duplicate["duplicate_of"]["source_id"] == "0"
    assert duplicate["duplicate_of"]["split"] == "train"
    assert duplicate["cross_split"]


def test_source_fields_protocol_and_browser_output_retained():
    tool = {"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}
    raw = {"messages": [{"role": "system", "content": "policy"}, {"role": "assistant", "content": None, "reasoning_content": "source reasoning", "tool_calls": [{"id": "real-id", "type": "function", "function": {"name": "lookup", "arguments": "{}"}}]}, {"role": "tool", "tool_call_id": "real-id", "content": "result"}], "tools": [tool], "metadata": {"uuid": "source-id"}, "processing_info": {"stages": ["tool_validation"]}}
    messages, tools, policy, metadata, compatible = normalized_source(raw, "nemotron")
    assert messages[-1]["tool_call_id"] == "real-id"
    assert messages[1]["reasoning_content"] == "source reasoning"
    assert tools[0]["name"] == "lookup" and policy == "policy"
    assert metadata["processing_info"] == raw["processing_info"]
    assert compatible["protocol"] == "structured_tool_calls"
    browser = {"id": "browser1", "task_name": "task1", "messages": [{"role": "user", "content": "visible page"}], "output": "click [2]", "prompt": "formatted prompt", "n_tokens": 8}
    assert normalized_source(browser, "nnetnav")[3]["prompt"] == "formatted prompt"
    with pytest.raises(ValueError, match="output_and_task"):
        normalized_source({"messages": browser["messages"]}, "nnetnav")


def test_malformed_protocol_quarantines_and_record_cap_stops_parser(tmp_path):
    source = tmp_path / "data.jsonl"
    tool = {"name": "lookup", "parameters": {"type": "object"}}
    bad = {"messages": [{"role": "tool", "tool_call_id": "missing", "content": "result"}], "tools": [tool]}
    good = {"messages": [{"role": "user", "content": "lookup"}], "tools": [tool], "metadata": {"source": "kept"}}
    source.write_text(json.dumps(bad) + "\n" + json.dumps(good) + "\nnot valid json")
    report = ingest(source, tmp_path / "out", "nemotron", "a" * 40, "license", {"0": ("family", "train"), "1": ("family", "train")}, tmp_path / "dedup.db", max_records=2)
    assert report["counts"] == {"raw": 2, "quarantined": 1, "admitted": 1}
    assert report["record_limit"] == 2
    row = json.loads((tmp_path / "out" / "episodes.jsonl").read_text())
    assert not row["native_executable"] and row["source_metadata"]["metadata"]["source"] == "kept"
    assert "native_environment_not_bound" in row["compatibility"]["replay_blockers"]


def test_nnetnav_output_changes_exact_duplicate_identity(tmp_path):
    source = tmp_path / "browser.jsonl"
    row = {"id": "one", "task_name": "task", "messages": [{"role": "user", "content": "visible page"}], "output": "click [2]"}
    source.write_text(json.dumps(row) + "\n" + json.dumps({**row, "id": "two", "output": "click [3]"}))
    report = ingest(source, tmp_path / "out", "nnetnav", "a" * 40, "license", {"one": ("family", "train"), "two": ("family", "train")}, tmp_path / "dedup.db")
    assert report["counts"]["admitted"] == 2
    assert [r["source_output"] for r in records(tmp_path / "out" / "episodes.jsonl")] == ["click [2]", "click [3]"]


def test_cross_source_duplicate_link_survives_source_format_changes(tmp_path):
    source_a, source_b = tmp_path / "apigen.jsonl", tmp_path / "toucan.jsonl"
    source_a.write_text(json.dumps({"conversations": [{"from": "human", "value": "lookup"}], "tools": "[]"}))
    source_b.write_text(json.dumps({"uuid": "other-id", "messages": [{"role": "user", "content": "lookup"}], "available_tools": "[]"}))
    database = tmp_path / "dedup.db"
    ingest(source_a, tmp_path / "a", "apigen", "a" * 40, "noncommercial source license", {"0": ("first", "train")}, database)
    report = ingest(source_b, tmp_path / "b", "toucan", "b" * 40, "apache source license", {"other-id": ("second", "test")}, database)
    assert report["counts"]["quarantined"] == 1 and report["cross_split_duplicate_count"] == 1
    duplicate = json.loads((tmp_path / "b" / "duplicates.jsonl").read_text())
    assert duplicate["duplicate_of"]["source"] == "Salesforce/APIGen-MT-5k"
    assert duplicate["duplicate_of"]["revision"] == "a" * 40
