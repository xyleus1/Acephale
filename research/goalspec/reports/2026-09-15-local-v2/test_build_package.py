"""Tiny offline fixtures only. Run after root permits packager verification."""
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("goalspec_v2_package", Path(__file__).with_name("build_package.py"))
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


def write(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value if isinstance(value, bytes) else package.encoded(value))
    return path


def fixture(root):
    (root / "outputs").mkdir()
    write(root, "outputs/v1.zip.sha256", ("a" * 64 + "  v1.zip\n").encode())
    journal = "research/goalspec/runs/final-copy/budget-journal.jsonl"
    closure = "research/goalspec/runs/final-copy/manifest.json"
    write(root, journal, b'{"chargedUsd":0}\n')
    write(root, closure, {"closed": True})
    records = "research/goalspec/runs/frozen-input/records.json"
    write(root, records, {"frozen": True})
    sources = []
    for stage in ("historical", "final"):
        directory = "research/goalspec/runs/source-" + stage
        source = (stage + " runtime\n").encode()
        name = "services/goalspec-runtime/provider.ts"
        write(root, name, source)
        archive_path = root / directory / "source.zip"
        archive_path.parent.mkdir(parents=True)
        with zipfile.ZipFile(archive_path, "x") as archive:
            archive.writestr(package.zip_info(name), source)
        entries = {name: {"sha256": package.hashlib.sha256(source).hexdigest(), "bytes": len(source), "category": "execution"}}
        manifest = {"sources": entries, "sourceTreeHash": package.hashlib.sha256(package.canonical(entries)).hexdigest(),
                    "archive": {"path": "source.zip", **package.digest_file(archive_path)},
                    "inputs": {"records": {"path": records, **package.digest_file(root / records)}}}
        path = write(root, directory + "/manifest.json", manifest)
        write(root, directory + "/manifest.sha256", (package.digest_file(path)["sha256"] + "  manifest.json\n").encode())
        sources.append({"id": stage, "directory": directory})
    inputs = root / package.REPORT / "package-inputs.json"
    specification = {"schemaVersion": 1, "packageLabel": "offline fixture", "finalized": True, "finalSourceId": "final",
                     "mustBeAbsent": ["research/goalspec/runs/live/budget.jsonl.lock"], "sourceArchives": sources,
                     "v1PackageReference": {"filename": "v1.zip", "sha256": "a" * 64, "checksumFile": "outputs/v1.zip.sha256"},
                     "accountingCopy": {"journalPath": journal, "sha256": package.digest_file(root / journal)["sha256"], "closureReceiptPath": closure},
                     "groups": [{"name": "reports", "path": package.REPORT, "patterns": ["*.json"]},
                                {"name": "journal-copy", "path": "research/goalspec/runs/final-copy", "patterns": ["*.json", "*.jsonl"]},
                                {"name": "records", "path": records}]}
    write(root, inputs.relative_to(root).as_posix(), specification)
    return inputs, specification


def test_multiple_sources_round_trip_and_v1_is_reference_only(tmp_path):
    inputs, specification = fixture(tmp_path)
    result = package.build(tmp_path, inputs, specification, tmp_path / "outputs/final.zip")
    assert result["allArchivedHashesVerified"] and result["sourceArchiveCount"] == 2
    assert result["finalProtectedExecutionVerified"] and not result["v1ArchiveEmbedded"]
    assert not (tmp_path / "outputs/v1.zip").exists()
    with zipfile.ZipFile(tmp_path / "outputs/final.zip") as archive:
        assert archive.read("PACKAGE_MANIFEST.json") == (tmp_path / "outputs/final.zip.manifest.json").read_bytes()
        assert len([name for name in archive.namelist() if name.endswith("source.zip")]) == 2
        assert not any(name.endswith("/v1.zip") for name in archive.namelist())
        reference = json.loads(archive.read("V1_PACKAGE_REFERENCE.json"))
        assert not reference["embedded"] and not reference["archiveBytesRehashed"]
    with pytest.raises(FileExistsError):
        package.build(tmp_path, inputs, specification, tmp_path / "outputs/final.zip")


@pytest.mark.parametrize("change", ["journal", "frozen_input", "source_archive", "final_runtime", "active_lock"])
def test_changed_or_unclosed_evidence_cannot_produce_success(tmp_path, change):
    inputs, specification = fixture(tmp_path)
    paths = {"journal": specification["accountingCopy"]["journalPath"], "frozen_input": "research/goalspec/runs/frozen-input/records.json",
             "source_archive": specification["sourceArchives"][0]["directory"] + "/source.zip",
             "final_runtime": "services/goalspec-runtime/provider.ts", "active_lock": specification["mustBeAbsent"][0]}
    write(tmp_path, paths[change], b"changed fixture\n")
    with pytest.raises(ValueError):
        package.build(tmp_path, inputs, specification, tmp_path / "outputs/final.zip")
    assert not (tmp_path / "outputs/final.zip.verification.json").exists()


@pytest.mark.parametrize("name", ["api-key.json", ".env.json", "extra.zip"])
def test_secret_paths_and_undeclared_nested_archives_are_excluded(tmp_path, name):
    _, specification = fixture(tmp_path)
    directory = "research/goalspec/runs/unexpected"
    write(tmp_path, directory + "/" + name, b"offline fixture only")
    specification["groups"].append({"name": "unexpected", "path": directory, "patterns": ["*.json", "*.zip"]})
    with pytest.raises(ValueError):
        package.collect(tmp_path, specification)


def test_inventory_never_reads_journal_or_computes_hashes(tmp_path, monkeypatch):
    _, specification = fixture(tmp_path)
    specification["finalized"] = False
    specification["groups"].append({"name": "pending", "path": None})
    monkeypatch.setattr(package, "digest_file", lambda *_args, **_kwargs: pytest.fail("Inventory hashed content"))
    selected, _, missing = package.collect(tmp_path, specification)
    assert specification["accountingCopy"]["journalPath"] in selected
    assert "pending: final path not supplied" in missing


def test_artifact_groups_cannot_traverse_repository_or_home(tmp_path):
    _, specification = fixture(tmp_path)
    for path in ("research/goalspec/runs", "research/goalspec", "../outside", "C:/Users/example", "."):
        altered = {**specification, "groups": [{"name": "broad", "path": path, "patterns": ["*.json"]}]}
        with pytest.raises(ValueError):
            package.collect(tmp_path, altered)


def test_junit_report_is_retained_while_pytest_directories_are_pruned(tmp_path):
    _, specification = fixture(tmp_path)
    directory = "research/goalspec/runs/verification"
    report = directory + "/pytest-junit.xml"
    cache = directory + "/pytest/cache.xml"
    write(tmp_path, report, b"<testsuite tests='273' failures='0'/>")
    write(tmp_path, cache, b"temporary fixture")
    specification["groups"].append({"name": "tests", "path": directory, "patterns": ["*.xml"], "recursive": True})
    selected, _, missing = package.collect(tmp_path, specification)
    assert report in selected and cache not in selected and not missing
    with pytest.raises(ValueError):
        package.check_name(cache)
