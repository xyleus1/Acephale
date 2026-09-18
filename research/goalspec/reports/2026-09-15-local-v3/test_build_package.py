"""Synthetic capture-verification tests. Run only after live timing is closed."""
import copy
import hashlib
import importlib.util
import json
import stat
import warnings
import zipfile
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("goalspec_v3_package", Path(__file__).with_name("build_package.py"))
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n"


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value if isinstance(value, bytes) else encoded(value))


def zip_member(name, data, symlink=False):
    entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = (stat.S_IFLNK | 0o777 if symlink else stat.S_IFREG | 0o644) << 16
    return entry, data


def write_zip(path, members):
    path.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)  # Duplicate members are intentional attack fixtures.
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for info, data in members:
                bundle.writestr(info, data)


def fixture(root):
    directory = "research/goalspec/runs/source-fixture"
    folder = root / directory
    source_name, source_bytes = "services/goalspec-runtime/provider.ts", b"export const fixture = true;\n"
    documentation_name, documentation_bytes = "docs/goalspec/FIXTURE.md", b"Offline fixture\n"
    input_bytes = b'{"frozen":true,"numeric_text":10000000000000000001}\r\n'
    source_members = [zip_member(source_name, source_bytes), zip_member(documentation_name, documentation_bytes)]
    input_members = [zip_member("records", input_bytes)]
    write_zip(folder / "source.zip", source_members)
    write_zip(folder / "inputs.zip", input_members)
    entries = {source_name: {**digest(source_bytes), "category": "execution"}, documentation_name: {**digest(documentation_bytes), "category": "documentation"}}
    # Historical metadata is never dereferenced, and must not inherit pytest's
    # intentionally excluded cache-directory names from the synthetic root.
    absent_original = Path(root.anchor) / "goalspec-frozen-fixture-originals" / hashlib.sha256(str(root).encode()).hexdigest()[:16] / "records.json"
    manifest = {"schemaVersion": "1.0.0", "captureProtocol": "official-tau-stage-freeze-v3", "sources": entries,
                "sourceTreeHash": hashlib.sha256(package.canonical(entries)).hexdigest(),
                "archive": {"path": "source.zip", **digest((folder / "source.zip").read_bytes())},
                "inputArchive": {"path": "inputs.zip", **digest((folder / "inputs.zip").read_bytes())},
                "inputs": {"records": {"path": str(absent_original.resolve()), "archiveMember": "records", "archived": True, **digest(input_bytes)}}}
    write(root / source_name, source_bytes)
    write(root / documentation_name, documentation_bytes)
    source = {"id": "fixture", "directory": directory}
    selected = {directory + "/" + name: {"path": folder / name, "groups": ["source:fixture"]}
                for name in ("manifest.json", "manifest.sha256", "source.zip", "inputs.zip")}
    result = {"folder": folder, "manifest": manifest, "source": source, "selected": selected,
              "source_members": source_members, "input_members": input_members, "source_name": source_name,
              "documentation_name": documentation_name, "absent_original": absent_original}
    refresh(result)
    return result


def refresh(value, archive=None, members=None):
    folder, manifest = value["folder"], value["manifest"]
    if archive:
        write_zip(folder / archive, members)
        field = "archive" if archive == "source.zip" else "inputArchive"
        manifest[field].update(digest((folder / archive).read_bytes()))
    manifest["sourceTreeHash"] = hashlib.sha256(package.canonical(manifest["sources"])).hexdigest()
    write(folder / "manifest.json", manifest)
    write(folder / "manifest.sha256", (digest((folder / "manifest.json").read_bytes())["sha256"] + "  manifest.json\n").encode())


def verify(root, value, compare_current=False):
    return package.verify_capture(root, value["source"], value["selected"], compare_current=compare_current)


def test_capture_verifies_both_archives_without_dereferencing_historical_original_inputs(tmp_path):
    value = fixture(tmp_path)
    assert not value["absent_original"].exists()
    result = verify(tmp_path, value)
    assert result["id"] == "fixture"
    assert result["members"] == 2
    assert result["inputMembers"] == 1
    assert result["currentExecutionCompared"] is False
    assert result["archiveSha256"] == value["manifest"]["archive"]["sha256"]
    assert result["inputArchiveSha256"] == value["manifest"]["inputArchive"]["sha256"]


def test_only_explicit_current_capture_checks_protected_execution(tmp_path):
    value = fixture(tmp_path)
    assert verify(tmp_path, value, True)["currentExecutionCompared"] is True
    write(tmp_path / value["documentation_name"], b"Changed docs are not protected execution\n")
    verify(tmp_path, value, True)
    write(tmp_path / value["source_name"], b"Changed current execution\n")
    verify(tmp_path, value, False)
    with pytest.raises(ValueError):
        verify(tmp_path, value, True)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_capture_rejects_changed_outer_zip_bytes_even_when_zip_is_still_readable(tmp_path, archive):
    value = fixture(tmp_path)
    path = value["folder"] / archive
    path.write_bytes(path.read_bytes() + b"uncommitted trailing bytes")
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_member_hashes_checked_even_after_outer_archive_digest_is_refreshed(tmp_path, archive):
    value = fixture(tmp_path)
    members = copy.deepcopy(value["source_members"] if archive == "source.zip" else value["input_members"])
    members[0] = (members[0][0], b"different frozen bytes\n")
    refresh(value, archive, members)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
@pytest.mark.parametrize("mutation", ["missing", "extra", "duplicate"])
def test_exact_zip_membership_rejects_missing_extra_and_duplicate_members(tmp_path, archive, mutation):
    value = fixture(tmp_path)
    members = list(value["source_members"] if archive == "source.zip" else value["input_members"])
    if mutation == "missing":
        members.pop()
    elif mutation == "extra":
        members.append(zip_member("extra.json", b"{}\n"))
    else:
        members.append(members[0])
    refresh(value, archive, members)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("name", ["../outside.ts", "/absolute.ts", "C:/outside.ts", "services\\outside.ts", ".env.json", "secret.key", "extra.zip", "extra.ZIP"])
def test_matching_manifest_does_not_authorize_unsafe_source_members(tmp_path, name):
    value = fixture(tmp_path)
    data = b"offline fixture only\n"
    value["manifest"]["sources"] = {name: {**digest(data), "category": "execution"}}
    refresh(value, "source.zip", [zip_member(name, data)])
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("member", ["../records", "/records", "C:/records", "records\\nested", ".env", "credentials", "records.zip"])
def test_matching_manifest_does_not_authorize_unsafe_archived_input_members(tmp_path, member):
    value = fixture(tmp_path)
    original_data = value["input_members"][0][1]
    value["manifest"]["inputs"]["records"]["archiveMember"] = member
    refresh(value, "inputs.zip", [zip_member(member, original_data)])
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_source_or_input_symlink_members_are_rejected(tmp_path, archive):
    value = fixture(tmp_path)
    members = list(value["source_members"] if archive == "source.zip" else value["input_members"])
    name, data = members[0][0].filename, members[0][1]
    members[0] = zip_member(name, data, symlink=True)
    refresh(value, archive, members)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


def test_duplicate_input_archive_member_aliases_are_rejected(tmp_path):
    value = fixture(tmp_path)
    value["manifest"]["inputs"]["other"] = copy.deepcopy(value["manifest"]["inputs"]["records"])
    refresh(value)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("field,value", [("archived", False), ("bytes", 1), ("sha256", "0" * 64)])
def test_archived_input_flags_sizes_and_hashes_are_required(tmp_path, field, value):
    capture = fixture(tmp_path)
    capture["manifest"]["inputs"]["records"][field] = value
    refresh(capture)
    with pytest.raises(ValueError):
        verify(tmp_path, capture)


@pytest.mark.parametrize("archive_field", ["archive", "inputArchive"])
def test_archive_metadata_cannot_redirect_to_other_files(tmp_path, archive_field):
    value = fixture(tmp_path)
    value["manifest"][archive_field]["path"] = "../elsewhere.zip"
    refresh(value)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


def test_manifest_sidecar_and_source_tree_hashes_are_independently_checked(tmp_path):
    value = fixture(tmp_path)
    write(value["folder"] / "manifest.sha256", ("0" * 64 + "  manifest.json\n").encode())
    with pytest.raises(ValueError):
        verify(tmp_path, value)
    refresh(value)
    value["manifest"]["sourceTreeHash"] = "0" * 64
    write(value["folder"] / "manifest.json", value["manifest"])
    write(value["folder"] / "manifest.sha256", (digest((value["folder"] / "manifest.json").read_bytes())["sha256"] + "  manifest.json\n").encode())
    with pytest.raises(ValueError):
        verify(tmp_path, value)


def test_archived_input_original_path_metadata_rejects_traversal_and_secret_names(tmp_path):
    value = fixture(tmp_path)
    for original in ("../outside.json", str(tmp_path / "research/goalspec/runs/frozen-input/.env"),
                     str(tmp_path / "research/goalspec/runs/frozen-input/api-key.json")):
        value["manifest"]["inputs"]["records"]["path"] = original
        refresh(value)
        with pytest.raises(ValueError):
            verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_casefold_collisions_are_rejected_even_with_distinct_exact_member_names(tmp_path, archive):
    value = fixture(tmp_path)
    data = b"{}\n"
    if archive == "source.zip":
        names = ("services/runtime.ts", "services/RUNTIME.ts")
        value["manifest"]["sources"] = {name: {**digest(data), "category": "execution"} for name in names}
    else:
        names = ("records", "RECORDS")
        template = value["manifest"]["inputs"]["records"]
        value["manifest"]["inputs"] = {name: {**template, "archiveMember": name, **digest(data)} for name in names}
    refresh(value, archive, [zip_member(name, data) for name in names])
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_directory_members_are_rejected(tmp_path, archive):
    value = fixture(tmp_path)
    name, data = "unexpected/", b""
    if archive == "source.zip":
        value["manifest"]["sources"] = {name: {**digest(data), "category": "execution"}}
    else:
        value["manifest"]["inputs"]["records"].update(archiveMember=name, **digest(data))
    info, data = zip_member(name, data)
    info.external_attr = (stat.S_IFDIR | 0o755) << 16
    refresh(value, archive, [(info, data)])
    with pytest.raises(ValueError):
        verify(tmp_path, value)


@pytest.mark.parametrize("archive", ["source.zip", "inputs.zip"])
def test_credential_shaped_fixture_is_rejected_inside_verified_archive_members(tmp_path, archive):
    value = fixture(tmp_path)
    # Deliberately synthetic marker, never a credential read from the workspace.
    data = ('{"fixture":"sk-proj-' + "a" * 48 + '"}\n').encode()
    if archive == "source.zip":
        name = value["source_name"]
        value["manifest"]["sources"] = {name: {**digest(data), "category": "execution"}}
    else:
        name = "records"
        value["manifest"]["inputs"]["records"].update(digest(data))
    refresh(value, archive, [zip_member(name, data)])
    with pytest.raises(ValueError):
        verify(tmp_path, value)


def package_fixture(root):
    value = fixture(root)
    (root / "outputs").mkdir()
    final_copy = "research/goalspec/runs/final-accounting-fixture"
    journal, closure = final_copy + "/budget-journal.jsonl", final_copy + "/closure.json"
    write(root / journal, b'{"fixtureChargedUsd":0}\n')
    write(root / closure, {"closed": True, "fixture": True})
    portable = "research/goalspec/runs/portable-archive-fixture"
    files = []
    for table in ("cohort_manifest", "artifact_file", "artifact_record"):
        for suffix in ("jsonl", "parquet"):
            name = table + "." + suffix
            # Package verification trusts the separately validated exporter
            # receipt and checks exact bytes. It does not decode Parquet again.
            data = b'{"syntheticFixture":true}\n' if suffix == "jsonl" else b"synthetic Parquet hash fixture"
            write(root / portable / name, data)
            files.append({"filename": name, "table": table, "format": "canonical-jsonl" if suffix == "jsonl" else "parquet", "rows": 1, **digest(data)})
    portable_manifest = portable + "/manifest.json"
    write(root / portable_manifest, {"schemaVersion": 1, "contract": "official-native-v3-archive", "status": "complete",
                                    "parquetRoundTripVerified": True, "originalSourceRoundTripVerified": True, "files": files})
    inputs = root / package.REPORT / "package-inputs.json"
    specification = {"schemaVersion": 3, "packageLabel": "offline v3 package fixture", "finalized": True, "pending": [],
                     "mustBeAbsent": [], "sourceArchives": [value["source"]], "finalSourceId": "fixture", "priorPackageReferences": [],
                     "accountingCopy": {"journalPath": journal, "sha256": digest((root / journal).read_bytes())["sha256"],
                                        "closureReceiptPath": closure, "closureReceiptSha256": digest((root / closure).read_bytes())["sha256"]},
                     "portableArchive": {"manifestPath": portable_manifest, "manifestSha256": digest((root / portable_manifest).read_bytes())["sha256"]},
                     "groups": [{"name": "reports", "path": package.REPORT, "patterns": ["*.json"]},
                                {"name": "accounting-copy", "path": final_copy, "patterns": ["*.json", "*.jsonl"]},
                                {"name": "portable", "path": portable, "patterns": ["*.json", "*.jsonl", "*.parquet"]}]}
    write(inputs, specification)
    return inputs, specification, value


def test_whole_v3_package_preserves_both_archives_and_verifiable_sidecars_without_overwrite(tmp_path):
    inputs, specification, capture = package_fixture(tmp_path)
    output = tmp_path / "outputs/final-v3.zip"
    result = package.build(tmp_path, inputs, specification, output)
    assert result["allArchivedHashesVerified"] is True
    assert result["sourceArchiveCount"] == 1
    assert result["frozenInputsVerified"] is True
    assert result["finalProtectedExecutionVerified"] is True
    assert result["providerCalls"] == result["databaseCalls"] == 0
    with zipfile.ZipFile(output) as archive:
        for basename in ("source.zip", "inputs.zip"):
            name = "repository/" + capture["source"]["directory"] + "/" + basename
            assert archive.read(name) == (capture["folder"] / basename).read_bytes()
        assert archive.read("PACKAGE_MANIFEST.json") == Path(str(output) + ".manifest.json").read_bytes()
        assert archive.read("PACKAGE_INPUTS.json") == package.encoded(specification)
    sidecar = Path(str(output) + ".sha256").read_text(encoding="ascii").split()
    assert sidecar == [digest(output.read_bytes())["sha256"], output.name]
    verification = json.loads(Path(str(output) + ".verification.json").read_text(encoding="utf-8"))
    assert verification == result
    assert verification["manifestSha256"] == digest(Path(str(output) + ".manifest.json").read_bytes())["sha256"]
    assert not capture["absent_original"].exists()
    with pytest.raises(FileExistsError):
        package.build(tmp_path, inputs, specification, output)


def allowed_sources_fixture(root):
    capture = fixture(root)
    declared, metadata = [], {}
    members = list(capture["source_members"])
    for category in ("analysis", "artifact_export"):
        name = "research/goalspec/scripts/frozen_" + category + ".py"
        content = ("# Frozen " + category + " fixture\n").encode()
        write(root / name, content)
        identity = digest(content)
        capture["manifest"]["sources"][name] = {**identity, "category": category}
        members.append(zip_member(name, content))
        declared.append({"path": name, "frozenCategory": category, "frozenSha256": identity["sha256"], "currentSha256": identity["sha256"]})
        metadata[name] = identity
    refresh(capture, "source.zip", members)
    specification = {"sourceArchives": [capture["source"]], "finalSourceId": "fixture", "currentAllowedSources": declared}
    return capture, specification, metadata


def test_exact_frozen_analysis_export_sources_are_accepted_without_relabeling(tmp_path):
    _, specification, metadata = allowed_sources_fixture(tmp_path)
    result = package.verify_allowed_sources(tmp_path, specification, metadata)
    assert {entry["category"] for entry in result} == {"analysis", "artifact_export"}
    assert all(entry["changedSinceConfirmationCapture"] is False for entry in result)
    assert all(entry["currentSha256"] == entry["frozenSha256"] for entry in result)


@pytest.mark.parametrize("mutation", ["execution_relabel", "frozen_hash", "frozen_category", "missing_current_hash", "missing_metadata",
                                    "missing_both_with_reason", "wrong_current_hash", "invalid_current_hash", "duplicate"])
def test_allowed_source_provenance_cannot_be_weakened_by_declared_metadata(tmp_path, mutation):
    capture, specification, metadata = allowed_sources_fixture(tmp_path)
    declared = specification["currentAllowedSources"][0]
    if mutation == "execution_relabel":
        original = capture["manifest"]["sources"][capture["source_name"]]
        specification["currentAllowedSources"] = [{"path": capture["source_name"], "frozenCategory": "analysis",
                                                   "frozenSha256": original["sha256"], "currentSha256": original["sha256"]}]
        metadata[capture["source_name"]] = {key: original[key] for key in ("bytes", "sha256")}
    elif mutation == "frozen_hash":
        declared["frozenSha256"] = "0" * 64
    elif mutation == "frozen_category":
        declared["frozenCategory"] = "artifact_export"
    elif mutation == "missing_current_hash":
        declared.pop("currentSha256")
    elif mutation == "missing_metadata":
        metadata.pop(declared["path"])
    elif mutation == "missing_both_with_reason":
        metadata.pop(declared["path"])
        declared.pop("currentSha256")
        declared["amendmentReason"] = "Cannot substitute a reason for missing content"
    elif mutation == "wrong_current_hash":
        declared["currentSha256"] = "0" * 64
    elif mutation == "invalid_current_hash":
        declared["currentSha256"] = metadata[declared["path"]]["sha256"] = "not-a-hash"
        declared["amendmentReason"] = "Cannot substitute a reason for malformed identity"
    else:
        specification["currentAllowedSources"].append(copy.deepcopy(declared))
    with pytest.raises(ValueError):
        package.verify_allowed_sources(tmp_path, specification, metadata)


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_changed_allowed_source_requires_nonempty_amendment_reason(tmp_path, reason):
    _, specification, metadata = allowed_sources_fixture(tmp_path)
    declared = specification["currentAllowedSources"][0]
    content = b"# New analysis source, unrelated to actor execution\n"
    write(tmp_path / declared["path"], content)
    metadata[declared["path"]] = digest(content)
    declared["currentSha256"] = digest(content)["sha256"]
    if reason is not None:
        declared["amendmentReason"] = reason
    with pytest.raises(ValueError):
        package.verify_allowed_sources(tmp_path, specification, metadata)


def test_changed_allowed_source_is_disclosed_with_both_identities_and_reason(tmp_path):
    _, specification, metadata = allowed_sources_fixture(tmp_path)
    declared = specification["currentAllowedSources"][0]
    content = b"# Revised offline figure labels\n"
    write(tmp_path / declared["path"], content)
    metadata[declared["path"]] = digest(content)
    declared["currentSha256"] = digest(content)["sha256"]
    declared["amendmentReason"] = "Correct offline figure labels after evaluation; actor execution unchanged"
    result = package.verify_allowed_sources(tmp_path, specification, metadata)
    changed = next(entry for entry in result if entry["path"] == declared["path"])
    assert changed["changedSinceConfirmationCapture"] is True
    assert changed["frozenSha256"] != changed["currentSha256"]
    assert changed["amendmentReason"] == declared["amendmentReason"]


def overlay_fixture(root):
    capture = fixture(root)
    name, data = package.REPORT + "/new_figure_helper.py", b"# New offline figure helper\n"
    write(root / name, data)
    overlay = {"path": name, "sha256": digest(data)["sha256"], "frozenSha256": None, "reason": "New post-evaluation report helper, absent from captured execution"}
    specification = {"sourceArchives": [capture["source"]], "finalSourceId": "fixture", "sourceOverlays": [overlay]}
    metadata = {name: digest(data)}
    return capture, specification, metadata


def test_new_offline_source_overlay_requires_exact_hash_and_disclosed_reason(tmp_path):
    _, specification, metadata = overlay_fixture(tmp_path)
    result = package.verify_source_overlays(tmp_path, specification, metadata)
    assert len(result) == 1
    assert result[0]["path"] == specification["sourceOverlays"][0]["path"]
    assert result[0]["sha256"] == specification["sourceOverlays"][0]["sha256"]
    assert result[0]["frozenSha256"] is None


@pytest.mark.parametrize("mutation", ["captured_execution", "missing_declaration", "missing_hash", "wrong_hash", "missing_reason", "blank_reason",
                                    "claimed_frozen_hash", "unselected", "duplicate"])
def test_source_overlay_cannot_replace_capture_or_hide_selected_new_execution(tmp_path, mutation):
    capture, specification, metadata = overlay_fixture(tmp_path)
    overlay = specification["sourceOverlays"][0]
    if mutation == "captured_execution":
        frozen = capture["manifest"]["sources"][capture["source_name"]]
        overlay["path"] = capture["source_name"]
        overlay["sha256"] = frozen["sha256"]
        metadata = {capture["source_name"]: {key: frozen[key] for key in ("bytes", "sha256")}}
    elif mutation == "missing_declaration":
        specification["sourceOverlays"] = []
    elif mutation == "missing_hash":
        overlay.pop("sha256")
    elif mutation == "wrong_hash":
        overlay["sha256"] = "0" * 64
    elif mutation == "missing_reason":
        overlay.pop("reason")
    elif mutation == "blank_reason":
        overlay["reason"] = "  "
    elif mutation == "claimed_frozen_hash":
        overlay["frozenSha256"] = "0" * 64
    elif mutation == "unselected":
        metadata = {}
    else:
        specification["sourceOverlays"].append(copy.deepcopy(overlay))
    with pytest.raises(ValueError):
        package.verify_source_overlays(tmp_path, specification, metadata)


def test_original_input_metadata_rejects_safe_but_nonabsolute_historical_paths(tmp_path):
    value = fixture(tmp_path)
    value["manifest"]["inputs"]["records"]["path"] = "research/goalspec/runs/frozen-input/records.json"
    refresh(value)
    with pytest.raises(ValueError):
        verify(tmp_path, value)


def test_final_execution_recheck_detects_drift_after_initial_capture_verification(tmp_path):
    value = fixture(tmp_path)
    specification = {"sourceArchives": [value["source"]], "finalSourceId": "fixture"}
    verify(tmp_path, value, True)
    package.verify_final_execution(tmp_path, specification)
    write(tmp_path / value["documentation_name"], b"Changed documentation is outside protected execution\n")
    package.verify_final_execution(tmp_path, specification)
    write(tmp_path / value["source_name"], b"Execution changed after initial source verification\n")
    with pytest.raises(ValueError):
        package.verify_final_execution(tmp_path, specification)


def test_whole_package_rejects_execution_drift_during_archive_write_before_success_sidecars(tmp_path, monkeypatch):
    inputs, specification, capture = package_fixture(tmp_path)
    original = package.digest_stream
    mutated = False

    def mutate_during_copy(stream, scan_name=None, target=None):
        nonlocal mutated
        if target is not None and not mutated:
            mutated = True
            write(tmp_path / capture["source_name"], b"Changed protected execution while copying other artifacts\n")
        return original(stream, scan_name, target)

    monkeypatch.setattr(package, "digest_stream", mutate_during_copy)
    output = tmp_path / "outputs/drifted-v3.zip"
    with pytest.raises(ValueError):
        package.build(tmp_path, inputs, specification, output)
    assert mutated is True
    assert not Path(str(output) + ".verification.json").exists()
    assert not Path(str(output) + ".sha256").exists()


def test_selected_package_paths_cannot_collide_when_extracted_case_insensitively(tmp_path):
    _, specification, _ = package_fixture(tmp_path)
    lower, upper = "docs/goalspec/case-note.md", "docs/goalspec/CASE-NOTE.md"
    write(tmp_path / lower, b"Synthetic same-content note\n")
    write(tmp_path / upper, b"Synthetic same-content note\n")
    specification["looseFiles"] = [{"path": name, "purpose": "synthetic case collision"} for name in (lower, upper)]
    with pytest.raises(ValueError):
        package.collect(tmp_path, specification)
