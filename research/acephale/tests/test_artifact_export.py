import hashlib
import json

import pytest
import rfc8785

from acephale.artifact_export import convert_export

pytest.importorskip("pyarrow", reason="Parquet verification requires the optional analysis dependencies")


def fixture(directory, rows):
    directory.mkdir()
    payload = b"".join(rfc8785.dumps(row) + b"\n" for row in rows)
    (directory / "episode.jsonl").write_bytes(payload)
    manifest = {"status": "jsonl-complete", "applicationTablesRead": False, "readOnlyTransaction": True,
                "files": [{"table": "episode", "filename": "episode.jsonl", "format": "canonical-jsonl", "rows": len(rows), "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}]}
    (directory / "jsonl-manifest.json").write_text(json.dumps(manifest))


def test_parquet_roundtrips_heterogeneous_arguments_and_empty_tables(tmp_path):
    import pyarrow.parquet as pq
    for name, rows in [("records", [{"id": "one", "metadata": {"arguments": {"value": 4}}}, {"id": "two", "metadata": {"arguments": {"value": ["text", False]}}}]), ("empty", [])]:
        directory = tmp_path / name
        fixture(directory, rows)
        report = convert_export(directory)
        assert report["parquetRoundTripVerified"] and report["tableRows"] == len(rows)
        parquet = pq.read_table(directory / "parquet" / "episode.parquet")
        assert [json.loads(row) for row in parquet["canonical_json"].to_pylist()] == rows
        with pytest.raises(ValueError, match="already exists"):
            convert_export(directory)


def test_tampered_jsonl_and_active_budget_are_rejected(tmp_path):
    directory = tmp_path / "bad"
    fixture(directory, [{"id": "one"}])
    (directory / "episode.jsonl").write_text('{"id":"other"}\n')
    with pytest.raises(ValueError, match="hash or size"):
        convert_export(directory)
    directory = tmp_path / "budget"
    fixture(directory, [])
    journal = tmp_path / "budget.jsonl"
    journal.write_text('{"version":2,"changes":[]}\n')
    journal.with_name("budget.jsonl.lock").touch()
    with pytest.raises(ValueError, match="owner is active"):
        convert_export(directory, journal)
