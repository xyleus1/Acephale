"""Streaming research corpus ingestion, with explicit lineage and quarantine.

Source-reported verification never admits executable native workflows. Family
assignments must exist before ingestion/annotation, rather than being inferred
from completed trajectories or independent evaluator outcomes.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from collections.abc import Iterator
from itertools import islice
from pathlib import Path

from jsonschema import Draft202012Validator, SchemaError

from acephale.binding import canonical

SOURCES = {
    "apigen": ("Salesforce/APIGen-MT-5k", "cc-by-nc-4.0", "conversations", "tools"),
    "toucan": ("Agent-Ark/Toucan-1.5M", "apache-2.0", "messages", "available_tools"),
    "nemotron": ("nvidia/Nemotron-SFT-Agentic-v2", "mixed-source:cc-by-4.0,apache-2.0,mit", "messages", "tools"),
    "nnetnav": ("stanfordnlp/nnetnav-wa", "apache-2.0", "messages", "tools"),
}


def records(path: Path) -> Iterator[dict]:
    if path.suffix == ".parquet":
        import pyarrow.parquet as pq
        for batch in pq.ParquetFile(path).iter_batches(batch_size=128):
            yield from batch.to_pylist()
        return
    if path.suffix == ".jsonl":
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                if len(line) > 8_000_000:
                    raise ValueError("Record exceeds ingest size bound")
                if line.strip():
                    yield json.loads(line)
        return
    # Decode a top-level JSON array without loading the corpus into memory.
    decoder = json.JSONDecoder()
    with path.open(encoding="utf-8") as stream:
        buffer, started, ended, need_separator, after_comma = "", False, False, False, False
        while chunk := stream.read(65_536):
            buffer += chunk
            while True:
                buffer = buffer.lstrip()
                if not buffer:
                    break
                if ended:
                    raise ValueError("Content after JSON array")
                if not started:
                    if not buffer.startswith("["):
                        raise ValueError("Expected a JSON array")
                    buffer, started = buffer[1:], True
                    continue
                if buffer.startswith(","):
                    if not need_separator:
                        raise ValueError("Unexpected JSON separator")
                    buffer = buffer[1:]
                    need_separator, after_comma = False, True
                    continue
                if buffer.startswith("]"):
                    if after_comma:
                        raise ValueError("Trailing JSON separator")
                    buffer, ended = buffer[1:].strip(), True
                    break
                if need_separator:
                    raise ValueError("Missing JSON separator")
                try:
                    item, end = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    if len(buffer) > 8_000_000:
                        raise ValueError("Record exceeds ingest size bound") from None
                    break
                yield item
                buffer = buffer[end:]
                need_separator, after_comma = True, False
        if not ended or buffer.strip():
            raise ValueError("Incomplete JSON corpus")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def normalized_source(raw: dict, source: str):
    """Retain source-specific fields while checking tool and message compatibility.

    Native eligibility requires an independent environment adapter and replay.
    Textual browser/Hermes actions remain research examples, never native calls.
    """
    if not isinstance(raw, dict):
        raise ValueError("unsupported_schema")
    _, _, message_key, tool_key = SOURCES[source]
    messages = _json(raw[message_key])
    tools = _json(raw.get(tool_key, raw.get("tools", [])))
    if not isinstance(messages, list) or not messages or not isinstance(tools, list):
        raise ValueError("unsupported_schema")
    if source == "nnetnav" and (not isinstance(raw.get("output"), (str, dict, list)) or not isinstance(raw.get("task_name", raw.get("id")), str)):
        raise ValueError("nnetnav_output_and_task_identity_required")
    normalized_tools, names = [], set()
    for tool in tools:
        if not isinstance(tool, dict):
            raise ValueError("unsupported_tool_schema")
        function = tool.get("function", tool)
        if not isinstance(function, dict) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,128}", function.get("name", "")):
            raise ValueError("unsupported_tool_name")
        parameters = function.get("parameters", function.get("inputSchema"))
        if not isinstance(parameters, dict):
            raise ValueError("tool_parameters_required")
        try:
            Draft202012Validator.check_schema(parameters)
        except SchemaError as exc:
            raise ValueError("malformed_tool_json_schema") from exc
        if function["name"] in names:
            raise ValueError("duplicate_tool_name")
        names.add(function["name"])
        normalized_tools.append({"name": function["name"], "description": function.get("description", ""), "parameters": parameters})
    roles = {"human": "user", "gpt": "assistant", "observation": "tool"}
    normalized, call_ids, tool_calls = [], set(), 0
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("unsupported_message_schema")
        role = roles.get(message.get("role", message.get("from")), message.get("role", message.get("from")))
        if role not in {"system", "developer", "user", "assistant", "tool", "function", "function_call"}:
            raise ValueError("unsupported_message_role")
        # Preserve call IDs, names, reasoning, content parts, and other native
        # continuation fields. Role/content aliases alone are normalized.
        item = {key: value for key, value in message.items() if key not in {"from", "value", "role", "content"}}
        item.update(role=role, content=message.get("content", message.get("value")))
        if item["content"] is not None and not isinstance(item["content"], (str, list, dict)):
            raise ValueError("unsupported_message_content")
        if "tool_calls" in item:
            if role != "assistant" or not isinstance(item["tool_calls"], list):
                raise ValueError("malformed_tool_calls")
            for call in item["tool_calls"]:
                if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
                    raise ValueError("malformed_tool_call")
                function = call["function"]
                if function.get("name") not in names or not isinstance(_json(function.get("arguments")), dict):
                    raise ValueError("unknown_tool_or_malformed_arguments")
                if call.get("id"):
                    if call["id"] in call_ids:
                        raise ValueError("duplicate_tool_call_id")
                    call_ids.add(call["id"])
                tool_calls += 1
        if role == "tool" and item.get("tool_call_id") and item["tool_call_id"] not in call_ids:
            raise ValueError("unmatched_tool_result")
        normalized.append(item)
    policy = raw.get("system", "")
    if not isinstance(policy, str):
        raise ValueError("unsupported_policy_schema")
    if not policy:
        policy = "\n".join(message["content"] for message in normalized if message["role"] in {"system", "developer"} and isinstance(message["content"], str))
    metadata = {key: value for key, value in raw.items() if key not in {message_key, tool_key, "tools", "system", "output"}}
    metadata["original_tool_schemas"] = tools
    compatibility = {"version": "corpus-compatibility-v2", "source_schema": source,
                     "protocol": "browser_text" if source == "nnetnav" else "structured_tool_calls" if tool_calls else "legacy_or_text_calls",
                     "tool_schema_hash": hashlib.sha256(canonical(normalized_tools).encode()).hexdigest(),
                     "policy_hash": hashlib.sha256(policy.encode()).hexdigest(),
                     "replay_blockers": ["source_reported_only", "native_environment_not_bound"] + ([] if tools else ["no_explicit_tool_schema"])}
    return normalized, normalized_tools, policy, metadata, compatibility


def ingest(path: Path, destination: Path, source: str, revision: str, license_text: str,
           families: dict[str, tuple[str, str]], dedup_database: Path, max_records: int | None = None):
    if source not in SOURCES or len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision) or not license_text:
        raise ValueError("Pinned source revision and license required")
    if max_records is not None and (not isinstance(max_records, int) or isinstance(max_records, bool) or max_records < 1):
        raise ValueError("Positive record limit required")
    family_splits = defaultdict(set)
    for family, split in families.values():
        family_splits[family].add(split)
    if any(len(splits) > 1 for splits in family_splits.values()):
        raise ValueError("Task family crosses dataset splits")
    destination.mkdir(parents=True, exist_ok=False)
    raw_hash = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            raw_hash.update(chunk)
    repository, license_id, _, _ = SOURCES[source]
    counts = defaultdict(int)
    dedup_database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(dedup_database) as db, (destination / "episodes.jsonl").open("x", encoding="utf-8") as admitted, (destination / "quarantine.jsonl").open("x", encoding="utf-8") as rejected, (destination / "duplicates.jsonl").open("x", encoding="utf-8") as duplicates:
        # v1 indexed message-only hashes. Keep it untouched, and never compare
        # those keys with v2 complete protocol/policy/tool hashes.
        db.execute("CREATE TABLE IF NOT EXISTS seen_v2 (hash TEXT PRIMARY KEY, source TEXT NOT NULL, revision TEXT NOT NULL, source_id TEXT NOT NULL, episode_id TEXT NOT NULL, family_id TEXT NOT NULL, split TEXT NOT NULL)")
        duplicate_count, cross_split_duplicate_count = 0, 0
        for index, raw in enumerate(islice(records(path), max_records)):
            counts["raw"] += 1
            try:
                normalized, tools, policy, metadata, compatibility = normalized_source(raw, source)
                digest = hashlib.sha256(canonical({"messages": normalized, "tools": tools, "policy": policy, "source_output": raw.get("output")}).encode()).hexdigest()
                nested_metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
                source_id = str(raw.get("id", raw.get("uuid", nested_metadata.get("uuid", index))))
                if source_id not in families:
                    raise ValueError("family_assignment_required")
                family, split = families[source_id]
                if split not in {"train", "development", "test"}:
                    raise ValueError("invalid_split")
                previous = db.execute("SELECT source,revision,source_id,episode_id,family_id,split FROM seen_v2 WHERE hash = ?", (digest,)).fetchone()
                if previous:
                    duplicate = {"source_id": source_id, "content_hash": digest, "duplicate_of": dict(zip(("source", "revision", "source_id", "episode_id", "family_id", "split"), previous, strict=True)), "cross_split": split != previous[5]}
                    duplicates.write(canonical(duplicate) + "\n")
                    duplicate_count += 1
                    cross_split_duplicate_count += int(duplicate["cross_split"])
                    raise ValueError("cross_source_duplicate")
                episode = {"id": f"{repository}@{revision}:{source_id}", "source": repository, "revision": revision,
                           "license": license_id, "license_text": license_text, "source_id": source_id,
                           "family_id": family, "split": split, "messages": normalized, "tools": tools,
                           "policy": policy, "content_hash": digest, "content_hash_version": "full-protocol-v2",
                           "source_output": raw.get("output"), "source_metadata": metadata,
                           "source_raw_hash": hashlib.sha256(canonical(raw).encode()).hexdigest(), "compatibility": compatibility,
                           "verification_tier": "source_reported", "native_executable": False}
                admitted.write(canonical(episode) + "\n")
                db.execute("INSERT INTO seen_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", (digest, repository, revision, source_id, episode["id"], family, split))
                counts["admitted"] += 1
            except (KeyError, TypeError, ValueError) as exc:
                reason = str(exc) if isinstance(exc, ValueError) else "unsupported_schema"
                rejected.write(canonical({"index": index, "reason": reason, "raw": raw}) + "\n")
                counts["quarantined"] += 1
        manifest = {"source": repository, "revision": revision, "license": license_id, "license_text": license_text,
                    "source_hash": raw_hash.hexdigest(), "parser_version": "acephale-corpus-v2", "counts": dict(counts), "native_executable_count": 0,
                    "dedup_version": "full-protocol-v2", "duplicate_count": duplicate_count, "cross_split_duplicate_count": cross_split_duplicate_count, "record_limit": max_records}
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def annotation_pilot(episodes: list[dict], count: int = 100):
    strata = defaultdict(list)
    for episode in episodes:
        if episode["split"] == "train":
            strata[episode["family_id"]].append(episode)
    for rows in strata.values():
        rows.sort(key=lambda r: r["content_hash"])
    selected = []
    while len(selected) < count and any(strata.values()):
        for family in sorted(strata):
            if strata[family] and len(selected) < count:
                selected.append(strata[family].pop(0))
    if len(selected) != count:
        raise ValueError("Not enough eligible nonduplicated training records for annotation pilot")
    return selected
