"""Lossless Parquet conversion of a completed, consistent research DB export.

Each Parquet row retains canonical JSON and its hash alongside useful scalar
indexes. Heterogeneous nested tool arguments cannot silently coerce each other.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

import rfc8785

INDEX_STRINGS = ("id", "episode_id", "run_id", "family_id", "snapshot_id", "pattern_id", "source", "verification_tier", "split", "arm", "event_type")
INDEX_INTEGERS = ("boundary", "seq", "checkpoint")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _rows(path: Path):
    with path.open("rb") as stream:
        for index, line in enumerate(stream):
            if not line.endswith(b"\n"):
                raise ValueError("Truncated canonical JSONL export")
            payload = line[:-1]
            value = json.loads(payload)
            if not isinstance(value, dict) or rfc8785.dumps(value) != payload:
                raise ValueError("Export row is not a canonical JSON object")
            row = {"row_index": index, "canonical_json": payload.decode("utf-8"), "row_sha256": hashlib.sha256(payload).digest()}
            row.update({key: str(value[key]) if value.get(key) is not None else None for key in INDEX_STRINGS})
            for key in INDEX_INTEGERS:
                number = value.get(key)
                if number is not None and (isinstance(number, bool) or not isinstance(number, int)):
                    raise ValueError(f"Nonintegral export index: {key}")
                row[key] = number
            yield row


def convert_export(directory: Path, budget_path: Path | None = None):
    import pyarrow as pa
    import pyarrow.parquet as pq

    manifest_path = directory / "jsonl-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != "jsonl-complete" or manifest.get("applicationTablesRead") is not False or manifest.get("readOnlyTransaction") is not True:
        raise ValueError("A completed read-only research export is required")
    if (directory / "manifest.json").exists():
        raise ValueError("Final artifact manifest already exists")
    parquet_directory = directory / "parquet"
    parquet_directory.mkdir(exist_ok=False)
    schema = pa.schema([pa.field("row_index", pa.uint64(), nullable=False),
                        *[pa.field(key, pa.string()) for key in INDEX_STRINGS],
                        *[pa.field(key, pa.int64()) for key in INDEX_INTEGERS],
                        pa.field("canonical_json", pa.large_string(), nullable=False),
                        pa.field("row_sha256", pa.binary(32), nullable=False)],
                       metadata={b"goalspec_export_version": b"1", b"canonical_payload": b"RFC8785", b"payload_hash": b"SHA256"})
    files = []
    for entry in manifest["files"]:
        filename = entry["filename"]
        if not re.fullmatch(r"[a-z_]+\.jsonl", filename) or entry["format"] != "canonical-jsonl":
            raise ValueError("Unsafe or unsupported export filename")
        source = directory / filename
        if file_hash(source) != entry["sha256"] or source.stat().st_size != entry["bytes"]:
            raise ValueError("JSONL export hash or size mismatch")
        target = parquet_directory / (source.stem + ".parquet")
        count, batch = 0, []
        with pq.ParquetWriter(target, schema, compression="zstd") as writer:
            for row in _rows(source):
                batch.append(row)
                if len(batch) >= 256:
                    writer.write_table(pa.Table.from_pylist(batch, schema=schema))
                    count += len(batch)
                    batch = []
            if batch:
                writer.write_table(pa.Table.from_pylist(batch, schema=schema))
                count += len(batch)
        if count != entry["rows"] or pq.ParquetFile(target).metadata.num_rows != count:
            raise ValueError("Parquet export row count mismatch")
        # Read the serialized payload back and verify every row independently.
        aggregate = hashlib.sha256()
        for arrow_batch in pq.ParquetFile(target).iter_batches(batch_size=256, columns=["canonical_json", "row_sha256"]):
            for row in arrow_batch.to_pylist():
                payload = row["canonical_json"].encode("utf-8")
                if hashlib.sha256(payload).digest() != row["row_sha256"]:
                    raise ValueError("Parquet payload hash mismatch")
                aggregate.update(payload + b"\n")
        if aggregate.hexdigest() != entry["sha256"]:
            raise ValueError("Parquet does not reconstruct the exact JSONL bytes")
        files.extend([entry, {"table": entry["table"], "filename": target.relative_to(directory).as_posix(), "format": "parquet",
                              "rows": count, "bytes": target.stat().st_size, "sha256": file_hash(target), "canonicalJsonlSha256": entry["sha256"]}])
    attachments = []
    if budget_path is not None:
        if budget_path.with_name(budget_path.name + ".lock").exists():
            raise ValueError("Budget owner is active; archive only after managed work has drained")
        target = directory / "budget-journal.jsonl"
        original_hash = file_hash(budget_path)
        with budget_path.open("rb") as source, target.open("xb") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
        if file_hash(budget_path) != original_hash or file_hash(target) != original_hash or budget_path.with_name(budget_path.name + ".lock").exists():
            raise ValueError("Budget journal changed during immutable archival")
        attachments.append({"filename": target.name, "sha256": original_hash, "bytes": target.stat().st_size,
                            "format": "verbatim-budget-journal", "interpretation": "mixed journal versions preserved; no accounting reinterpretation"})
    final = {**manifest, "status": "complete", "parquetExporterVersion": "goalspec-parquet-export-v1", "jsonlManifestSha256": file_hash(manifest_path),
             "parquetExporterSha256": file_hash(Path(__file__)), "pyarrowVersion": pa.__version__, "files": files, "attachments": attachments,
             "parquetRoundTripVerified": True, "tables": len(manifest["files"]), "tableRows": sum(entry["rows"] for entry in manifest["files"])}
    with (directory / "manifest.json").open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(final, indent=2) + "\n")
    with (directory / "manifest.sha256").open("x", encoding="ascii") as stream:
        stream.write(file_hash(directory / "manifest.json") + "  manifest.json\n")
    return final
