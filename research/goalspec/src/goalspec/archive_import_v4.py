"""Offline, bounded verification of a closed v4 archive before database access."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import rfc8785

VERSION = "goalspec-native-archive-import-v4"
EXPORTER = "goalspec-native-artifact-export-v4"
CONTRACT = "custom-native-v4-archive"
TABLES = ("cohort_manifest", "artifact_file", "artifact_record")
MAX_ROW_BYTES = 64 * 1024 * 1024
MAX_METADATA_ROWS = 100_000


def _hash(value):
    return hashlib.sha256(value).hexdigest()


def _safe_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _integer(value):
    return type(value) is int and 0 <= value <= 2**53 - 1


def _object(raw):
    value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
    if not isinstance(value, dict):
        raise ValueError("Archive row must be an object")
    return value


def _path(directory, filename):
    path = directory / filename
    if path.is_symlink() or path.resolve().parent != directory or not path.is_file():
        raise ValueError("Archive file must be a regular file inside the archive")
    return path


def _file_hash(path):
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def canonical_rows(directory, declared):
    """Bound each row and hash the exact consumed bytes, including committed LF."""
    digest, size, count = hashlib.sha256(), 0, 0
    with _path(directory, declared["filename"]).open("rb") as stream:
        while raw := stream.readline(MAX_ROW_BYTES + 1):
            if len(raw) > MAX_ROW_BYTES:
                raise ValueError("Archive row exceeds bounded importer limit")
            value = _object(raw)
            if raw != rfc8785.dumps(value) + b"\n":
                raise ValueError("Archive JSONL must use canonical RFC8785 plus LF")
            digest.update(raw)
            size += len(raw)
            count += 1
            yield value
    if (digest.hexdigest(), size, count) != (declared["sha256"], declared["bytes"], declared["rows"]):
        raise ValueError("Archive JSONL hash, size or count mismatch")


def _parquet(directory, declared, jsonl):
    import pyarrow.parquet as pq

    path = _path(directory, declared["filename"])
    if _file_hash(path) != (declared["sha256"], declared["bytes"]):
        raise ValueError("Archive Parquet hash or size mismatch")
    parquet = pq.ParquetFile(path)
    metadata = parquet.schema_arrow.metadata or {}
    if metadata.get(b"archive_contract") != EXPORTER.encode() or metadata.get(b"canonical_payload") != b"RFC8785":
        raise ValueError("Archive Parquet schema contract mismatch")
    digest, size, count = hashlib.sha256(), 0, 0
    # Single-row decoding also bounds wide original artifacts without a 128-row
    # Python object batch. The exporter has already bounded its own row groups.
    for batch in parquet.iter_batches(batch_size=1):
        for row in batch.to_pylist():
            raw = row["canonical_json"].encode("utf-8")
            if len(raw) + 1 > MAX_ROW_BYTES:
                raise ValueError("Archive Parquet row exceeds bounded importer limit")
            value = _object(raw)
            if row["row_index"] != count or hashlib.sha256(raw).digest() != row["row_sha256"] or rfc8785.dumps(value) != raw:
                raise ValueError("Archive Parquet row hash, order or canonical payload mismatch")
            for field in ("cohort_id", "source_id", "run_id", "arm", "event_type", "kind", "source_row"):
                if row[field] != value.get(field):
                    raise ValueError("Archive Parquet index differs from canonical payload")
            digest.update(raw + b"\n")
            size += len(raw) + 1
            count += 1
    if (digest.hexdigest(), size, count) != (jsonl["sha256"], jsonl["bytes"], jsonl["rows"]) or count != declared["rows"]:
        raise ValueError("Archive Parquet cannot reconstruct exact canonical JSONL")


def verify_archive(directory, expected_manifest_sha256):
    """Never opens original sources or a database; operates on closed exports only."""
    directory = Path(directory).resolve(strict=True)
    manifest_path = _path(directory, "manifest.json")
    if manifest_path.stat().st_size > MAX_ROW_BYTES:
        raise ValueError("Archive manifest exceeds bounded importer limit")
    raw = manifest_path.read_bytes()
    if not _safe_hash(expected_manifest_sha256) or _hash(raw) != expected_manifest_sha256:
        raise ValueError("Archive manifest hash mismatch")
    manifest = _object(raw)
    if raw != rfc8785.dumps(manifest) + b"\n":
        raise ValueError("Archive manifest must be canonical")
    if (manifest.get("schemaVersion") != 1 or manifest.get("exporterVersion") != EXPORTER
            or manifest.get("status") != "complete" or manifest.get("contract") != CONTRACT
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", manifest.get("archiveId", ""))
            or manifest.get("parquetRoundTripVerified") is not True
            or manifest.get("originalSourceRoundTripVerified") is not True
            or manifest.get("legacyExperimentManifestUsed") is not False
            or not isinstance(manifest.get("files"), list) or len(manifest["files"]) != 6):
        raise ValueError("Unsupported or incomplete v4 archive manifest")
    files = {}
    for declared in manifest["files"]:
        table, kind = declared.get("table"), declared.get("format")
        extension = "jsonl" if kind == "canonical-jsonl" else "parquet"
        key = (table, kind)
        if (table not in TABLES or kind not in {"canonical-jsonl", "parquet"} or key in files
                or declared.get("filename") != f"{table}.{extension}"
                or not _integer(declared.get("rows")) or not _integer(declared.get("bytes"))
                or not _safe_hash(declared.get("sha256"))):
            raise ValueError("Invalid archive file declaration")
        files[key] = declared
    jsonl = {table: files[table, "canonical-jsonl"] for table in TABLES}
    if any(jsonl[table]["rows"] > MAX_METADATA_ROWS for table in TABLES[:2]):
        raise ValueError("Archive metadata exceeds bounded importer limit")
    cohorts = {}
    for row in canonical_rows(directory, jsonl["cohort_manifest"]):
        if (not _safe_hash(row.get("cohort_id")) or row["cohort_id"] in cohorts or row.get("contract") != CONTRACT
                or row.get("official_reward") is not None or row.get("score_label") != "custom tau-compatible pilot"
                or row.get("stage") not in {"development", "confirmation"}
                or not isinstance(row.get("run_ids"), list) or not row["run_ids"]
                or any(not isinstance(run, str) for run in row["run_ids"])
                or len(set(row["run_ids"])) != len(row["run_ids"])
                or row.get("arms") != ["base", "goalspec", "paste", "salesforce"]):
            raise ValueError("Invalid archived v4 cohort")
        cohorts[row["cohort_id"]] = row
    if not cohorts or list(cohorts.values()) != manifest.get("cohorts"):
        raise ValueError("Manifest cohort declaration differs from archived table")
    sources, state = {}, {}
    for row in canonical_rows(directory, jsonl["artifact_file"]):
        source_id = row.get("source_id")
        if (not _safe_hash(source_id) or source_id in sources or row.get("cohort_id") is not None and row.get("cohort_id") not in cohorts
                or not _integer(row.get("original_bytes")) or not _integer(row.get("records"))
                or not _safe_hash(row.get("original_sha256")) or row.get("format") not in {"json", "jsonl"}):
            raise ValueError("Invalid archived source metadata")
        sources[source_id] = row
        state[source_id] = {"hash": hashlib.sha256(), "bytes": 0, "rows": 0, "previous": "0" * 64, "closed": False}
    expected_sources = [{k: v for k, v in row.items() if k != "expected_manifest"} for row in manifest.get("sources", [])]
    if list(sources.values()) != expected_sources:
        raise ValueError("Manifest source declaration differs from archived table")
    for row in canonical_rows(directory, jsonl["artifact_record"]):
        source = sources.get(row.get("source_id"))
        if source is None:
            raise ValueError("Unknown archived record source")
        progress = state[source["source_id"]]
        if (row.get("cohort_id") != source["cohort_id"] or row.get("kind") != source["kind"]
                or not _integer(row.get("source_row")) or row.get("source_row") != progress["rows"] or not isinstance(row.get("raw_utf8"), str)
                or any(row.get(field) is not None and not isinstance(row.get(field), str) for field in ("run_id", "arm", "event_type"))):
            raise ValueError("Invalid archived record identity or order")
        raw_source = row["raw_utf8"].encode("utf-8")
        progress["hash"].update(raw_source)
        progress["bytes"] += len(raw_source)
        if source["kind"] == "native_events":
            event = _object(raw_source)
            body = event.get("body", {})
            if (raw_source != rfc8785.dumps(event) + b"\n" or progress["closed"]
                    or type(body.get("sequence")) is not int or body.get("sequence") != progress["rows"] or body.get("previousHash") != progress["previous"]
                    or _hash(rfc8785.dumps(body)) != event.get("hash")):
                raise ValueError("Archived native event chain mismatch")
            payload = body.get("event", {})
            if progress["rows"] == 0:
                if payload.get("type") != "research_manifest" or payload.get("manifestHash") != source["cohort_id"]:
                    raise ValueError("Archived native event manifest mismatch")
                announced = payload.get("runs", [])
                if (len(announced) != len(cohorts[source["cohort_id"]]["run_ids"])
                        or {run["id"] for run in announced} != set(cohorts[source["cohort_id"]]["run_ids"])
                        or any(run.get("arm") not in cohorts[source["cohort_id"]]["arms"] for run in announced)):
                    raise ValueError("Archived native event run declaration mismatch")
            elif payload.get("type") == "research_manifest":
                raise ValueError("Repeated archived event manifest")
            run_id = payload.get("runId")
            if run_id is not None and (not isinstance(run_id, str) or run_id.split(":", 1)[0] not in cohorts[source["cohort_id"]]["run_ids"]):
                raise ValueError("Archived event run outside cohort")
            progress["closed"] = payload.get("type") == "service_closed"
            progress["previous"] = event["hash"]
        progress["rows"] += 1
    for source_id, source in sources.items():
        progress = state[source_id]
        if (progress["hash"].hexdigest(), progress["bytes"], progress["rows"]) != (source["original_sha256"], source["original_bytes"], source["records"]):
            raise ValueError("Archive cannot reconstruct original source bytes")
        if source["kind"] == "native_events" and (not progress["closed"] or source.get("event_chain") != {
                "records": progress["rows"], "tail_sha256": progress["previous"], "service_closed": True}):
            raise ValueError("Archived native event stream lacks verified closure")
    for table in TABLES:
        _parquet(directory, files[table, "parquet"], jsonl[table])
    if _file_hash(manifest_path)[0] != expected_manifest_sha256:
        raise ValueError("Archive manifest changed during verification")
    return {"schemaVersion": 1, "importerVersion": VERSION, "archiveId": manifest["archiveId"], "status": "verified",
            "manifestSha256": expected_manifest_sha256, "tables": {table: jsonl[table]["rows"] for table in TABLES},
            "parquetRoundTripVerified": True, "originalSourceRoundTripVerified": True,
            "databaseAccessed": False, "paidApiCalls": 0}
