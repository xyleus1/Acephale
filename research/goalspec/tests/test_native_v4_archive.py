"""Source archive integrity checks without reading or executing any task fixture."""
import hashlib
import zipfile

import pytest

from goalspec.native_live_v4 import execution_sources, verify_source_archive


def metadata(content):
    return {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in content.items()}


def archive(path, content):
    with zipfile.ZipFile(path, "x") as bundle:
        for name, data in content.items():
            bundle.writestr(name, data)


def test_archive_matches_captured_bytes_even_after_a_document_changes(tmp_path):
    source = tmp_path / "document.md"
    source.write_bytes(b"captured source")
    captured = {"docs/goalspec/document.md": source.read_bytes()}
    manifest = metadata(captured)
    source.write_bytes(b"new report written during source freeze")
    path = tmp_path / "source.zip"
    archive(path, captured)
    verify_source_archive(path, manifest)


def test_archive_rejects_same_length_changed_bytes_and_wrong_membership(tmp_path):
    content = {"src/lib/goalspec/goal-state.ts": b"original"}
    path = tmp_path / "source.zip"
    archive(path, {"src/lib/goalspec/goal-state.ts": b"tampered"})
    with pytest.raises(ValueError, match="bytes differ"):
        verify_source_archive(path, metadata(content))
    with pytest.raises(ValueError, match="membership"):
        verify_source_archive(path, metadata({"another-file.ts": b"tampered"}))


def test_archive_rejects_duplicate_members(tmp_path):
    path = tmp_path / "source.zip"
    with zipfile.ZipFile(path, "x") as bundle:
        bundle.writestr("source.ts", b"old")
        with pytest.warns(UserWarning, match="Duplicate name"):
            bundle.writestr("source.ts", b"new")
    with pytest.raises(ValueError, match="membership"):
        verify_source_archive(path, metadata({"source.ts": b"new"}))


def test_runtime_membership_excludes_only_documented_analysis_and_verification():
    files = {name: name for name in (
        "docs/goalspec/current.md", "research/goalspec/src/goalspec/report_v4.py",
        "research/goalspec/scripts/report_native_v4.py", "research/goalspec/tests/test_native_v4_archive.py",
        "src/lib/goalspec/goal-state-protocol-v4.ts", "src/lib/goalspec/goal-state.ts",
        "services/goalspec-runtime/research-bootstrap.ts", "research/goalspec/src/goalspec/native_live_v4.py",
    )}
    assert set(execution_sources(files)) == {
        "src/lib/goalspec/goal-state-protocol-v4.ts", "src/lib/goalspec/goal-state.ts",
        "services/goalspec-runtime/research-bootstrap.ts", "research/goalspec/src/goalspec/native_live_v4.py",
    }
