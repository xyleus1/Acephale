"""Synthetic exports only; these checks never create a database connection."""
import hashlib
import json

import pytest
import rfc8785

from goalspec.archive_import_v4 import verify_archive
from goalspec.archive_v4 import _write_table, export_archive
from test_archive_v4 import fixture


def archive(tmp_path):
    configuration, _, _, _ = fixture(tmp_path)
    attachment = tmp_path / "attachment.jsonl"
    attachment.write_bytes(b'{ "large":9007199254740993,"word":"caf\xc3\xa9" }\r\n\r\n')
    configuration["attachments"] = [{"path": str(attachment), "kind": "analysis"}]
    output = tmp_path / "archive"
    manifest = export_archive(configuration, output, closed_confirmed=True)
    return output, manifest


def digest(output):
    return hashlib.sha256((output / "manifest.json").read_bytes()).hexdigest()


def replace_table(output, manifest, table, rows):
    replacement = output / f"replace-{table}"
    replacement.mkdir()
    declarations = _write_table(replacement, table, rows)
    for entry in declarations:
        (replacement / entry["filename"]).replace(output / entry["filename"])
    manifest["files"] = [entry for entry in manifest["files"] if entry["table"] != table] + declarations
    (output / "manifest.json").write_bytes(rfc8785.dumps(manifest) + b"\n")


def test_full_verification_preserves_raw_numeric_text_and_never_opens_originals(tmp_path):
    output, manifest = archive(tmp_path)
    for source in manifest["sources"]:
        # Archive verification must remain reproducible after original paths are unavailable.
        from pathlib import Path
        Path(source["path"]).rename(Path(source["path"]).with_suffix(".offline"))
    result = verify_archive(output, digest(output))
    assert result["archiveId"] == "synthetic-v4"
    assert result["parquetRoundTripVerified"] and result["originalSourceRoundTripVerified"]
    assert result["databaseAccessed"] is False and result["paidApiCalls"] == 0


def test_manifest_and_exact_jsonl_bytes_are_checked(tmp_path):
    output, _ = archive(tmp_path)
    with pytest.raises(ValueError, match="manifest hash"):
        verify_archive(output, "0" * 64)
    with (output / "artifact_record.jsonl").open("ab") as stream:
        stream.write(b"\n")
    with pytest.raises((ValueError, json.JSONDecodeError)):
        verify_archive(output, digest(output))


def test_full_parquet_decoding_rejects_forged_index_even_with_updated_file_digest(tmp_path):
    import pyarrow as pa
    import pyarrow.parquet as pq

    output, manifest = archive(tmp_path)
    path = output / "artifact_record.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    rows[0]["run_id"] = "forged-index"
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    entry = next(row for row in manifest["files"] if row["filename"] == path.name)
    entry.update(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size)
    (output / "manifest.json").write_bytes(rfc8785.dumps(manifest) + b"\n")
    with pytest.raises(ValueError, match="Parquet index"):
        verify_archive(output, digest(output))


def test_source_hash_cannot_be_forged_by_updating_archive_table_hashes(tmp_path):
    output, manifest = archive(tmp_path)
    rows = [json.loads(line) for line in (output / "artifact_file.jsonl").read_text(encoding="utf-8").splitlines()]
    rows[0]["original_sha256"] = "0" * 64
    manifest["sources"][0]["original_sha256"] = "0" * 64
    replace_table(output, manifest, "artifact_file", rows)
    with pytest.raises(ValueError, match="reconstruct original"):
        verify_archive(output, digest(output))


def test_active_event_chain_cannot_be_declared_closed(tmp_path):
    output, manifest = archive(tmp_path)
    rows = [json.loads(line) for line in (output / "artifact_record.jsonl").read_text(encoding="utf-8").splitlines()]
    event = next(row for row in rows if row["kind"] == "native_events" and '"service_closed"' in row["raw_utf8"])
    event["raw_utf8"] = event["raw_utf8"].replace('"service_closed"', '"still_running"')
    replace_table(output, manifest, "artifact_record", rows)
    with pytest.raises(ValueError, match="event chain"):
        verify_archive(output, digest(output))


def test_bounded_rows_and_path_declarations_fail_closed(tmp_path, monkeypatch):
    from goalspec import archive_import_v4
    output, manifest = archive(tmp_path)
    monkeypatch.setattr(archive_import_v4, "MAX_ROW_BYTES", 8)
    with pytest.raises(ValueError, match="bounded"):
        verify_archive(output, digest(output))
    monkeypatch.setattr(archive_import_v4, "MAX_ROW_BYTES", 64 * 1024 * 1024)
    manifest["files"][0]["filename"] = "../cohort_manifest.jsonl"
    (output / "manifest.json").write_bytes(rfc8785.dumps(manifest) + b"\n")
    with pytest.raises(ValueError, match="file declaration"):
        verify_archive(output, digest(output))
