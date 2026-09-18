import hashlib
import json
from pathlib import Path

import pytest
import rfc8785

from goalspec import archive_v3
from goalspec.archive_v3 import digest, export_archive

pytest.importorskip("pyarrow", reason="Archive requires the optional analysis dependencies")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_events(path, manifest, *, closed=True):
    events = [{"type": "research_manifest", "manifestHash": hashlib.sha256(rfc8785.dumps(manifest)).hexdigest(),
               "runs": [{"id": row["runId"], "arm": row["arm"]} for row in manifest["runs"]]},
              {"type": "runtime_event", "runId": manifest["runs"][0]["runId"] + ":user",
               "event": {"type": "model_response", "latencyMs": 1.2345678901234567e-7}}]
    if closed:
        events.append({"type": "service_closed", "aborted": False})
    previous, lines = "0" * 64, []
    for sequence, event in enumerate(events):
        body = {"sequence": sequence, "previousHash": previous, "event": event, "recordedAtUnixMs": 1780000000000 + sequence}
        previous = hashlib.sha256(rfc8785.dumps(body)).hexdigest()
        lines.append(rfc8785.dumps({"body": body, "hash": previous}) + b"\n")
    path.write_bytes(b"".join(lines))


def fixture(root):
    directory = root / "cohort"
    directory.mkdir()
    trials = [{"domain": "retail", "taskId": "synthetic", "trial": 0, "seed": 17, "arm": arm} for arm in sorted(archive_v3.ARMS)]
    outcomes = [{**trial, "runId": f"synthetic-{trial['arm']}", "success": index % 2 == 0,
                 "termination": "user_stop", "latencyMs": 10.0} for index, trial in enumerate(trials)]
    manifest = {"runtimeVersion": "v3", "snapshotId": "synthetic-frozen",
                "runs": [{"runId": row["runId"], "arm": row["arm"], "domain": row["domain"]} for row in outcomes]}
    write_json(directory / "service-manifest.json", manifest)
    write_json(directory / "summary.json", {"studyId": "synthetic-study", "studyStage": "development-1",
                                            "counts": {arm: 1 for arm in sorted(archive_v3.ARMS)}, "successes": 2})
    write_json(directory / "design.json", {"trials": trials})
    write_json(directory / "public-contexts.json", {row["runId"]: {"domain": row["domain"]} for row in outcomes})
    (directory / "outcomes.jsonl").write_bytes(b"\r\n".join(json.dumps(row).encode() for row in outcomes) + b"\r\n")
    for row in outcomes:
        write_json(directory / f"{row['runId']}.json", {"record": row, "officialTask": {"description": "synthetic only"}})
    events = root / "events.jsonl"
    write_events(events, manifest)
    configuration = {"schemaVersion": 1, "archiveId": "synthetic-v3", "packageRoot": str(root),
                     "cohorts": [{"directory": str(directory), "events": [str(events)]}]}
    return configuration, directory, outcomes, manifest


def test_exact_four_arm_original_bytes_and_parquet_roundtrip(tmp_path):
    import pyarrow.parquet as pq

    configuration, _, _, _ = fixture(tmp_path)
    attachment = tmp_path / "predictions.jsonl"
    raw = b'{ "integer":9007199254740993, "number":1.2300, "word":"caf\xc3\xa9" }\r\n\r\n{"array":[true,null]}\n'
    attachment.write_bytes(raw)
    configuration["attachments"] = [{"path": str(attachment), "kind": "prediction"}]
    license_file = tmp_path / "LICENSE"
    license_file.write_text("Synthetic upstream license fixture.\n", encoding="utf-8")
    configuration["packageFiles"] = ["LICENSE"]
    output = tmp_path / "archive"
    report = export_archive(configuration, output, closed_confirmed=True)
    assert report["parquetRoundTripVerified"] and report["originalSourceRoundTripVerified"]
    assert report["cohorts"][0]["arms"] == ["base", "goalspec", "paste", "salesforce"]
    assert not report["legacyExperimentManifestUsed"] and not report["databaseAccessed"]
    rows = [json.loads(row) for row in pq.read_table(output / "artifact_record.parquet")["canonical_json"].to_pylist()]
    source = next(row for row in report["sources"] if row["path"] == str(attachment.resolve()))
    assert b"".join(row["raw_utf8"].encode() for row in rows if row["source_id"] == source["source_id"]) == raw
    user_event = next(row for row in rows if row["event_type"] == "model_response")
    assert user_event["run_id"] == "synthetic-base:user" and user_event["arm"] == "base"
    inventory = json.loads((output / "package-inventory.json").read_text())
    license_row = next(row for row in inventory["files"] if row["path"] == "LICENSE")
    assert license_row["sha256"] == digest(license_file)
    assert all("package-inventory" not in row["path"] for row in inventory["files"])
    assert (output / "manifest.sha256").read_text().split()[0] == digest(output / "manifest.json")
    for item in report["files"]:
        assert item["sha256"] == digest(output / item["filename"])


def test_missing_outcome_rejected_before_native_task_artifacts_are_read(tmp_path, monkeypatch):
    configuration, directory, outcomes, _ = fixture(tmp_path)
    (directory / "outcomes.jsonl").write_text("\n".join(json.dumps(row) for row in outcomes[:-1]))
    original = archive_v3._read
    accessed = []

    def tracked(path):
        accessed.append(Path(path).name)
        return original(path)

    monkeypatch.setattr(archive_v3, "_read", tracked)
    with pytest.raises(ValueError, match="Every declared outcome"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert not any(name.startswith("synthetic-") for name in accessed)


@pytest.mark.parametrize("mutation", ["legacy", "summary", "design", "artifact"])
def test_incompatible_or_inconsistent_sources_are_not_reinterpreted(tmp_path, mutation):
    configuration, directory, outcomes, manifest = fixture(tmp_path)
    if mutation == "legacy":
        manifest["runs"][0]["arm"] = "neutral"
        write_json(directory / "service-manifest.json", manifest)
    elif mutation == "summary":
        summary = json.loads((directory / "summary.json").read_text())
        summary["successes"] = 4
        write_json(directory / "summary.json", summary)
    elif mutation == "design":
        design = json.loads((directory / "design.json").read_text())
        design["trials"][0]["seed"] = 999
        write_json(directory / "design.json", design)
    else:
        write_json(directory / f"{outcomes[0]['runId']}.json", {"record": {**outcomes[0], "success": False}})
    with pytest.raises(ValueError):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)


@pytest.mark.parametrize("mutation", ["hash", "active", "manifest", "run_set"])
def test_native_event_chain_binding_and_closure_are_required(tmp_path, mutation):
    configuration, _, _, manifest = fixture(tmp_path)
    events = tmp_path / "events.jsonl"
    if mutation == "active":
        write_events(events, manifest, closed=False)
    elif mutation == "hash":
        records = [json.loads(line) for line in events.read_text().splitlines()]
        records[1]["body"]["event"]["runId"] = "tampered"
        events.write_text("\n".join(json.dumps(row) for row in records))
    elif mutation == "manifest":
        write_events(events, {**manifest, "snapshotId": "different"})
    else:
        records = [json.loads(line) for line in events.read_text().splitlines()]
        records[0]["body"]["event"]["runs"].pop()
        previous = "0" * 64
        for record in records:
            record["body"]["previousHash"] = previous
            previous = hashlib.sha256(rfc8785.dumps(record["body"])).hexdigest()
            record["hash"] = previous
        events.write_bytes(b"".join(rfc8785.dumps(row) + b"\n" for row in records))
    with pytest.raises(ValueError):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert not (tmp_path / "archive" / "manifest.json").exists()


def test_stage_abort_preserves_partial_and_explicit_missing_event_coverage(tmp_path):
    configuration, directory, outcomes, _ = fixture(tmp_path)
    row = {**outcomes[0], "success": False, "termination": "stage_abort", "latencyMs": None}
    outcomes[0] = row
    (directory / "outcomes.jsonl").write_text("\n".join(json.dumps(value) for value in outcomes))
    summary = json.loads((directory / "summary.json").read_text())
    summary["successes"] = 1
    write_json(directory / "summary.json", summary)
    write_json(directory / "stage-abort.json", {"failureKind": "synthetic-prelaunch-failure", "stageAborted": True, "allDeclaredSlotsRetained": True})
    write_json(directory / f"{row['runId']}-stage-abort.json", {"record": row})
    configuration["cohorts"][0]["events"] = []
    report = export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert report["cohorts"][0]["event_coverage"] == "absent_with_stage_abort_receipt"
    assert len([source for source in report["sources"] if source["kind"] == "retained_partial_native_artifact"]) == 1


def test_confirmation_new_directory_and_explicit_files_only(tmp_path):
    configuration, _, _, _ = fixture(tmp_path)
    output = tmp_path / "archive"
    with pytest.raises(ValueError, match="closed-work"):
        export_archive(configuration, output)
    assert not output.exists()
    export_archive(configuration, output, closed_confirmed=True)
    with pytest.raises(ValueError, match="new archive directory"):
        export_archive(configuration, output, closed_confirmed=True)
    with pytest.raises(ValueError, match="explicit artifact file"):
        archive_v3._safe_path(tmp_path)


@pytest.mark.parametrize("name", [".env", "credentials.json", "token.key", "node_modules/fixture.json", ".venv/fixture.json", "pgdata/fixture.json"])
def test_excluded_names_and_runtime_paths_fail_closed(tmp_path, name):
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Excluded artifact path"):
        archive_v3._safe_path(path)


def test_key_prefix_scan_fails_without_echoing_matching_text(tmp_path):
    configuration, _, _, _ = fixture(tmp_path)
    attachment = tmp_path / "predictions.jsonl"
    synthetic_key = "sk-" + "A" * 35
    attachment.write_text(json.dumps({"value": synthetic_key}) + "\n", encoding="utf-8")
    configuration["attachments"] = [{"path": str(attachment), "kind": "prediction"}]
    with pytest.raises(ValueError) as caught:
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert "Credential-like content" in str(caught.value) and synthetic_key not in str(caught.value)


def test_changed_source_prevents_complete_receipt(tmp_path, monkeypatch):
    configuration, directory, _, _ = fixture(tmp_path)
    original, counts = archive_v3.digest, {}
    watched = (directory / "public-contexts.json").resolve()

    def changing(path):
        path = Path(path).resolve()
        counts[path] = counts.get(path, 0) + 1
        if path == watched and counts[path] > 1:
            return "0" * 64
        return original(path)

    monkeypatch.setattr(archive_v3, "digest", changing)
    with pytest.raises(ValueError, match="Source changed"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert not (tmp_path / "archive" / "manifest.json").exists()


def test_pre_service_stage_abort_needs_no_fabricated_manifest_or_contexts(tmp_path):
    from goalspec.official_native import declared_trials

    configuration, directory, outcomes, _ = fixture(tmp_path)
    design = json.loads((directory / "design.json").read_text())
    design.update(studyId="synthetic-study", studyStage="development-1", designHash="d" * 64)
    write_json(directory / "design.json", design)
    rows = []
    for original, (run_id, _) in zip(outcomes, declared_trials({"studyId": design["studyId"]}, design), strict=True):
        row = {**original, "runId": run_id, "success": False, "termination": "stage_abort", "latencyMs": None, "serviceReadyBeforeTrial": False}
        rows.append(row)
        write_json(directory / f"{run_id}-stage-abort.json", {"record": row, "retainedStageFailure": True})
    (directory / "outcomes.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
    summary = json.loads((directory / "summary.json").read_text())
    summary.update(successes=0, designHash=design["designHash"], stageAborted=True, allDeclaredSlotsRetained=True)
    write_json(directory / "summary.json", summary)
    write_json(directory / "stage-abort.json", summary)
    (directory / "service-manifest.json").unlink()
    (directory / "public-contexts.json").unlink()
    configuration["cohorts"][0]["events"] = []
    report = export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    cohort = report["cohorts"][0]
    assert cohort["identity_basis"]["kind"] == "unstarted_design_and_abort_receipt"
    assert cohort["snapshot_id"] is None and cohort["service_manifest_present"] is False
    assert not any(row["kind"] == "service_manifest" for row in report["sources"])
    assert cohort["successes"] == 0 and cohort["outcomes"] == 4


def test_popen_failure_is_bound_to_original_manifest_and_not_ready_receipt(tmp_path):
    configuration, directory, outcomes, manifest = fixture(tmp_path)
    rows = [{**row, "success": False, "termination": "service_startup_error", "latencyMs": None, "serviceReadyBeforeTrial": False} for row in outcomes]
    (directory / "outcomes.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
    for row in rows:
        write_json(directory / f"{row['runId']}.json", {"record": row})
    summary = json.loads((directory / "summary.json").read_text())
    summary["successes"] = 0
    write_json(directory / "summary.json", summary)
    write_json(directory / "service-readiness.json", {"ready": False, "trialClocksStartedAfterReady": False,
                                                     "manifestHash": hashlib.sha256(rfc8785.dumps(manifest)).hexdigest(), "errorType": "OSError"})
    configuration["cohorts"][0]["events"] = []
    report = export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert report["cohorts"][0]["event_coverage"] == "absent_with_startup_readiness_receipt"
    assert report["cohorts"][0]["service_manifest_present"] is True
    (directory / "service-readiness.json").unlink()
    with pytest.raises(ValueError, match="explicit closed event log"):
        export_archive(configuration, tmp_path / "bad-archive", closed_confirmed=True)


@pytest.mark.parametrize("mutation", ["final_newline", "blank_line", "noncanonical", "duplicate_key", "wrong_arm"])
def test_native_events_require_original_canonical_bytes_and_arm_ownership(tmp_path, mutation):
    configuration, _, _, _ = fixture(tmp_path)
    events = tmp_path / "events.jsonl"
    raw = events.read_bytes()
    if mutation == "final_newline":
        events.write_bytes(raw[:-1])
    elif mutation == "blank_line":
        events.write_bytes(raw.replace(b"\n", b"\n\n", 1))
    elif mutation == "noncanonical":
        events.write_bytes(raw.replace(b'{"body":', b'{ "body":', 1))
    elif mutation == "duplicate_key":
        events.write_bytes(raw.replace(b'"sequence":0', b'"sequence":0,"sequence":0', 1))
    else:
        records = [json.loads(line) for line in raw.splitlines()]
        records[0]["body"]["event"]["runs"][0]["arm"] = "goalspec"
        previous = "0" * 64
        for record in records:
            record["body"]["previousHash"] = previous
            previous = hashlib.sha256(rfc8785.dumps(record["body"])).hexdigest()
            record["hash"] = previous
        events.write_bytes(b"".join(rfc8785.dumps(row) + b"\n" for row in records))
    with pytest.raises(ValueError):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert not (tmp_path / "archive" / "manifest.json").exists()


def test_lexical_link_ancestors_are_checked_before_resolution(tmp_path, monkeypatch):
    configuration, directory, _, _ = fixture(tmp_path)
    original = Path.is_symlink

    def simulated_link(path):
        return path == directory or original(path)

    monkeypatch.setattr(Path, "is_symlink", simulated_link)
    with pytest.raises(ValueError, match="Linked artifact path"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)


def test_package_declared_source_hash_is_enforced(tmp_path):
    configuration, _, _, _ = fixture(tmp_path)
    license_file = tmp_path / "LICENSE"
    license_file.write_text("Synthetic license.\n", encoding="utf-8")
    configuration["packageFiles"] = [{"path": "LICENSE", "sha256": "0" * 64}]
    with pytest.raises(ValueError, match="declared source hash"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
