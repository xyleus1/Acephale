"""Small pure-file fixtures, no real experiment/log/database reads."""
import hashlib
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("prepare_v5_archive", Path(__file__).with_name("prepare_archive_plan.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def fixture(tmp_path, *, runtime_hash=None, unsafe=False):
    entries = {"src/runtime.ts": b"export const value = 1;\n", "docs/frozen.md": b"Original captured documentation.\n"}
    if unsafe:
        entries["../outside.txt"] = b"x"
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as stream:
        for name, value in entries.items():
            stream.writestr(name, value)
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"sourceArchiveSha256": module.sha(archive), "runtimeSources": {
        "src/runtime.ts": {"sha256": runtime_hash or hashlib.sha256(entries["src/runtime.ts"]).hexdigest()}}}), encoding="utf-8")
    return {"path": "source.zip", "plan": "plan.json"}


def test_full_zip_inventory_includes_nonruntime_members(tmp_path):
    item, receipt = module.source_members(tmp_path, fixture(tmp_path))
    assert set(item["members"]) == {"src/runtime.ts", "docs/frozen.md"}
    assert receipt["completeZipMembers"] == 2
    assert receipt["runtimeSubsetMembers"] == 1
    assert receipt["runtimeSourcesAreOnlyExecutionSubset"] is True


def test_runtime_subset_hash_must_match_original_bytes(tmp_path):
    with pytest.raises(ValueError, match="Runtime-source subset"):
        module.source_members(tmp_path, fixture(tmp_path, runtime_hash="0" * 64))


def test_source_archive_rejects_traversal(tmp_path):
    with pytest.raises(ValueError, match="Unsafe source ZIP"):
        module.source_members(tmp_path, fixture(tmp_path, unsafe=True))


def test_event_encoding_never_treats_budget_as_provider_log(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text('{"body":{"previous":"abc","sequence":0},"hash":"x"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="declared explicitly"):
        module.event_encoding(path)
    path.write_text('{"body":{"previousHash":"abc","sequence":0},"hash":"x"}\n', encoding="utf-8")
    assert module.event_encoding(path) == "events"
    path.write_text('{"sequence":0,"healthy":false}\n', encoding="utf-8")
    assert module.event_encoding(path) == "plain-jsonl"


def test_preparation_requires_all_closure_signals_before_reading_inputs(tmp_path):
    with pytest.raises(ValueError, match="Paid clocks"):
        module.prepare(tmp_path, {"version": module.VERSION, "closed": True}, tmp_path / "missing.json")


@pytest.mark.parametrize("name", [".env", "a/.env.local", "secrets/token.json", "../outside.json", "a/node_modules/code.js"])
def test_sensitive_or_external_paths_rejected(tmp_path, name):
    with pytest.raises(ValueError):
        module.relative(tmp_path, name)
