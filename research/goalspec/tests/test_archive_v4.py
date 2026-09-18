"""Synthetic closed-cohort export tests; no real task fixtures are opened."""
import hashlib
import json
from pathlib import Path

import pytest
import rfc8785

from goalspec import archive_v3 as common
from goalspec.archive_v4 import ARMS, CONTRACT, LABEL, VERSION, export_archive, native_hash

pytest.importorskip("pyarrow", reason="Archive requires existing optional analysis dependencies")


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def outcomes(directory, rows):
    (directory / "outcomes.jsonl").write_bytes(b"".join(json.dumps(row).encode() + b"\r\n" for row in rows))
    for row in rows:
        write(directory / f"{row['runId']}.json", {"record": row, "verdict": {"success": row["success"]},
              "simulation": {"messages": []}, "finalDatabase": {"synthetic": True}})


def event_log(path, manifest, closed=True):
    events = [{"type": "research_manifest", "manifestHash": common._hash(manifest),
               "runs": [{"id": row["runId"], "arm": row["arm"]} for row in manifest["runs"]]},
              {"type": "runtime", "runId": manifest["runs"][0]["runId"] + ":user", "event": {"type": "model_attempt", "latencyMs": 1.125}}]
    if closed:
        events.append({"type": "service_closed", "aborted": False})
    previous, payload = "0" * 64, []
    for index, event in enumerate(events):
        body = {"sequence": index, "previousHash": previous, "event": event}
        previous = common._hash(body)
        payload.append(rfc8785.dumps({"body": body, "hash": previous}) + b"\n")
    path.write_bytes(b"".join(payload))


def fixture(root):
    directory = root / "cohort"
    directory.mkdir()
    trials = [{"family": f"family-{family}", "domain": "retail", "taskId": f"synthetic-{family}",
               "variant": 0, "trial": 0, "seed": 17 + family, "arm": arm, "reserved_usd": 1.25}
              for family in range(2) for arm in sorted(ARMS)]
    design = {"version": "goalspec-live-v4", "label": LABEL, "studyId": "synthetic-study", "studyStage": "development", "trials": trials}
    design["designHash"] = native_hash(design)
    plan = {"version": "goalspec-dispatch-v4", "design": design}
    plan["planHash"] = native_hash(plan)
    rows = [{**trial, "runId": f"v4-{native_hash(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{native_hash([design['designHash'], trial])[:12]}",
             "studyId": design["studyId"], "studyStage": design["studyStage"], "label": LABEL, "officialReward": None,
             "success": trial["arm"] == "goalspec", "termination": "user_stop", "latencyMs": 10.0, "serviceDrainSucceeded": True}
            for index, trial in enumerate(trials)]
    manifest = {"schemaVersion": 1, "runtimeVersion": "v4", "snapshotId": "synthetic-frozen", "studyId": design["studyId"], "studyStage": design["studyStage"],
                "runs": [{"runId": row["runId"], "arm": row["arm"], "domain": row["domain"]} for row in rows]}
    write(directory / "design.json", design)
    write(directory / "dispatch-plan.json", plan)
    write(directory / "service-manifest.json", manifest)
    write(directory / "service-readiness.json", {"ready": True, "trialClocksStartedAfterReady": True, "manifestHash": common._hash(manifest)})
    write(directory / "summary.json", {"version": "goalspec-live-v4", "label": LABEL, "studyId": design["studyId"], "studyStage": design["studyStage"],
          "designHash": design["designHash"], "counts": {arm: 2 for arm in ARMS}, "successes": 2})
    write(directory / "public-contexts.json", {row["runId"]: {"policy": "synthetic only"} for row in rows})
    outcomes(directory, rows)
    event_path = root / "events.jsonl"
    event_log(event_path, manifest)
    configuration = {"schemaVersion": 1, "archiveId": "synthetic-v4", "packageRoot": str(root),
                     "cohorts": [{"directory": str(directory), "events": [str(event_path)]}]}
    return configuration, directory, rows, manifest


def test_custom_contract_preserves_original_bytes_and_parquet_roundtrip(tmp_path):
    import pyarrow.parquet as pq

    configuration, directory, rows, _ = fixture(tmp_path)
    attachment = tmp_path / "predictions.jsonl"
    raw = b'{ "integer":9007199254740993,"word":"caf\xc3\xa9" }\r\n\r\n{"values":[true,null]}\n'
    attachment.write_bytes(raw)
    configuration["attachments"] = [{"path": str(attachment), "kind": "prediction"}]
    before = hashlib.sha256((directory / "outcomes.jsonl").read_bytes()).hexdigest()
    output = tmp_path / "archive"
    report = export_archive(configuration, output, closed_confirmed=True)
    assert report["contract"] == CONTRACT
    assert report["cohorts"][0]["official_reward"] is None
    assert report["cohorts"][0]["score_label"] == LABEL
    assert report["cohorts"][0]["outcomes"] == len(rows)
    assert report["parquetRoundTripVerified"] and report["originalSourceRoundTripVerified"]
    assert not report["databaseAccessed"] and report["paidApiCalls"] == 0
    parquet = pq.read_table(output / "artifact_record.parquet")
    assert parquet.schema.metadata[b"archive_contract"] == VERSION.encode()
    records = [json.loads(row) for row in parquet["canonical_json"].to_pylist()]
    source_id = next(source["source_id"] for source in report["sources"] if source["path"] == str(attachment))
    assert b"".join(row["raw_utf8"].encode() for row in records if row["source_id"] == source_id) == raw
    event = next(row for row in records if row["event_type"] == "model_attempt")
    assert event["arm"] == "base" and event["run_id"].endswith(":user")
    assert common.digest(directory / "outcomes.jsonl") == before
    assert (output / "package-inventory.json").is_file()
    assert (output / "manifest.sha256").read_text().split()[0] == common.digest(output / "manifest.json")


def test_incomplete_cohort_fails_before_private_artifact_read(tmp_path, monkeypatch):
    configuration, directory, rows, _ = fixture(tmp_path)
    outcomes(directory, rows[:-1])
    seen, original = [], common._read
    def tracked(path):
        seen.append(Path(path).name)
        return original(path)
    monkeypatch.setattr(common, "_read", tracked)
    with pytest.raises(ValueError, match="Every declared outcome"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert not any(path.startswith("v4-") for path in seen)


def test_same_arm_run_identity_cannot_be_swapped_between_tasks(tmp_path):
    configuration, directory, rows, _ = fixture(tmp_path)
    rows[0]["runId"], rows[4]["runId"] = rows[4]["runId"], rows[0]["runId"]
    outcomes(directory, rows)
    with pytest.raises(ValueError, match="outcome identity"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)


@pytest.mark.parametrize("failure", ["official_reward", "undrained", "timeout", "verdict"])
def test_invalid_custom_success_is_not_archived(tmp_path, failure):
    configuration, directory, rows, _ = fixture(tmp_path)
    row = next(row for row in rows if row["success"])
    if failure == "official_reward":
        row["officialReward"] = 1
    elif failure == "undrained":
        row["serviceDrainSucceeded"] = False
    elif failure == "timeout":
        row["termination"] = "max_steps"
    outcomes(directory, rows)
    if failure == "verdict":
        write(directory / f"{row['runId']}.json", {"record": row, "verdict": {"success": False}})
    with pytest.raises(ValueError):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)


@pytest.mark.parametrize("failure", ["active", "hash", "wrong_manifest", "missing"])
def test_started_cohort_requires_original_closed_event_chain(tmp_path, failure):
    configuration, _, _, manifest = fixture(tmp_path)
    event_path = tmp_path / "events.jsonl"
    if failure == "active":
        event_log(event_path, manifest, closed=False)
    elif failure == "hash":
        raw = event_path.read_bytes().replace(b'"latencyMs":1.125', b'"latencyMs":9.125')
        event_path.write_bytes(raw)
    elif failure == "wrong_manifest":
        event_log(event_path, {**manifest, "snapshotId": "other"})
    else:
        configuration["cohorts"][0]["events"] = []
    output = tmp_path / "archive"
    with pytest.raises(ValueError):
        export_archive(configuration, output, closed_confirmed=True)
    assert not (output / "manifest.json").exists()


def test_unstarted_failure_cohort_has_explicit_missing_event_coverage(tmp_path):
    configuration, directory, rows, manifest = fixture(tmp_path)
    for row in rows:
        row.update(success=False, termination="service_startup_error", latencyMs=None, serviceDrainSucceeded=False)
    outcomes(directory, rows)
    summary = common._read(directory / "summary.json")
    write(directory / "summary.json", {**summary, "successes": 0})
    write(directory / "service-readiness.json", {"ready": False, "trialClocksStartedAfterReady": False, "manifestHash": common._hash(manifest)})
    configuration["cohorts"][0]["events"] = []
    report = export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert report["cohorts"][0]["event_coverage"] == "absent_with_startup_readiness_receipt"


def test_requires_explicit_closure_and_new_output(tmp_path):
    configuration, directory, _, _ = fixture(tmp_path)
    with pytest.raises(ValueError, match="closed-work"):
        export_archive(configuration, tmp_path / "archive")
    with pytest.raises(ValueError, match="outside input"):
        export_archive(configuration, directory / "archive", closed_confirmed=True)
    output = tmp_path / "archive"
    export_archive(configuration, output, closed_confirmed=True)
    with pytest.raises(ValueError, match="new archive"):
        export_archive(configuration, output, closed_confirmed=True)


def test_v4_opaque_token_interior_is_preserved_and_v3_scanner_restored(tmp_path):
    configuration, _, _, _ = fixture(tmp_path)
    attachment = tmp_path / "opaque.json"
    write(attachment, {"encrypted_content": "opaque_" + "sk-" + "x" * 40 + "_continuation"})
    configuration["attachments"] = [{"path": str(attachment), "kind": "analysis"}]
    original = common.KEY_PREFIX
    export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert common.KEY_PREFIX is original
    records = [json.loads(line) for line in (tmp_path / "archive/artifact_record.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(row["raw_utf8"] == attachment.read_bytes().decode("utf-8") for row in records)


@pytest.mark.parametrize("prefix", ["", "Bearer ", "="])
def test_v4_token_boundary_key_is_rejected_and_scanner_restored(tmp_path, prefix):
    configuration, _, _, _ = fixture(tmp_path)
    attachment = tmp_path / "input.json"
    write(attachment, {"value": prefix + "sk-" + "x" * 40})
    configuration["attachments"] = [{"path": str(attachment), "kind": "analysis"}]
    original = common.KEY_PREFIX
    with pytest.raises(ValueError, match="Credential-like"):
        export_archive(configuration, tmp_path / "archive", closed_confirmed=True)
    assert common.KEY_PREFIX is original
