"""Lossless closed v4 custom-pilot exports, separate from official and legacy archives."""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from pathlib import Path

from goalspec import archive_v3 as common
from goalspec.fresh_tasks import digest as native_hash

VERSION = "goalspec-native-artifact-export-v4"
CONTRACT = "custom-native-v4-archive"
ARMS = {"base", "paste", "salesforce", "goalspec"}
LABEL = "custom tau-compatible pilot"
V4_KEY_PREFIX = re.compile(r"(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")


def _load_cohort(specification):
    directory = common._lexical_path(specification["directory"])
    summary = common._read(directory / "summary.json")
    design = common._read(directory / "design.json")
    plan = common._read(directory / "dispatch-plan.json")
    manifest = common._read(directory / "service-manifest.json")
    readiness = common._read(directory / "service-readiness.json")
    if (summary.get("version") != "goalspec-live-v4" or design.get("version") != "goalspec-live-v4"
            or manifest.get("runtimeVersion") != "v4" or not manifest.get("snapshotId")
            or summary.get("label") != LABEL or design.get("label") != LABEL
            or design.get("studyStage") not in {"development", "confirmation"}):
        raise ValueError("A distinct custom native v4 cohort is required")
    if (native_hash({key: value for key, value in design.items() if key != "designHash"}) != design.get("designHash")
            or summary.get("designHash") != design["designHash"]
            or plan.get("version") != "goalspec-dispatch-v4" or plan.get("design") != design
            or native_hash({key: value for key, value in plan.items() if key != "planHash"}) != plan.get("planHash")):
        raise ValueError("Frozen v4 design or dispatch plan changed")
    if any(summary.get(key) != design.get(key) or manifest.get(key) != design.get(key) for key in ("studyId", "studyStage")):
        raise ValueError("V4 cohort study identity mismatch")
    rows = [common._loads(line) for line in common._safe_path(directory / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    trials = design.get("trials", [])
    if not rows or len(rows) != len(trials) or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("Every declared outcome must exist before task artifacts are read")
    fields = ("family", "domain", "taskId", "variant", "trial", "seed", "arm")
    if Counter(tuple(row.get(key) for key in fields) for row in rows) != Counter(tuple(row.get(key) for key in fields) for row in trials):
        raise ValueError("Outcomes do not match the complete paired v4 design")
    blocks = {}
    for trial in trials:
        blocks.setdefault((trial["domain"], trial["family"], trial["variant"], trial["trial"]), []).append(trial)
    if any(len(block) != 4 or {item["arm"] for item in block} != ARMS or len({item["seed"] for item in block}) != 1 for block in blocks.values()):
        raise ValueError("Each paired block must contain all four arms and the same seed")
    expected = {}
    for index, trial in enumerate(trials):
        run_id = f"v4-{native_hash(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{native_hash([design['designHash'], trial])[:12]}"
        expected[run_id] = trial
    declarations = manifest.get("runs", [])
    declared = {row["runId"]: row for row in declarations}
    if len(declared) != len(declarations) or set(declared) != set(expected) or {row["runId"] for row in rows} != set(expected):
        raise ValueError("V4 run identities differ from the frozen design")
    for row in rows:
        trial = expected[row["runId"]]
        if (row.get("arm") != declared[row["runId"]].get("arm") or row.get("domain") != declared[row["runId"]].get("domain")
                or any(row.get(key) != trial.get(key) for key in fields) or not isinstance(row.get("success"), bool)
                or row.get("officialReward", "missing") is not None or row.get("label") != LABEL
                or row.get("studyId") != design["studyId"] or row.get("studyStage") != design["studyStage"]):
            raise ValueError("V4 outcome identity or custom-score label mismatch")
        if row["success"] and (row.get("termination") not in {"user_stop", "agent_stop"} or row.get("serviceDrainSucceeded") is not True):
            raise ValueError("A timeout, failure or undrained run cannot become an archived success")
    if dict(Counter(row["arm"] for row in rows)) != summary.get("counts") or sum(row["success"] for row in rows) != summary.get("successes"):
        raise ValueError("Summary counts differ from immutable outcomes")
    cohort_id = common._hash(manifest)
    if readiness.get("manifestHash") != cohort_id:
        raise ValueError("Readiness belongs to another service manifest")
    events = specification.get("events", [])
    startup_failure = (readiness.get("ready") is False and readiness.get("trialClocksStartedAfterReady") is False
        and all(row.get("termination") in {"service_startup_error", "stage_aborted_before_slot"}
                and row["success"] is False and row.get("latencyMs") is None for row in rows))
    if not events and not startup_failure:
        raise ValueError("A started v4 cohort requires its explicit closed event log")
    sources = [common._source(directory / filename, kind, cohort_id) for filename, kind in (
        ("summary.json", "summary"), ("design.json", "design"), ("dispatch-plan.json", "dispatch_plan"),
        ("service-manifest.json", "service_manifest"), ("service-readiness.json", "service_readiness"),
        ("public-contexts.json", "public_contexts"), ("outcomes.jsonl", "outcome"))]
    # Completeness, identities and score semantics are checked before private per-trial artifacts.
    for row in rows:
        path = directory / f"{row['runId']}.json"
        artifact = common._read(path)
        if artifact.get("record") != row:
            raise ValueError("Native artifact record differs from immutable outcome")
        if row["success"] and (not isinstance(artifact.get("verdict"), dict) or artifact["verdict"].get("success") is not True):
            raise ValueError("Successful custom outcome lacks an independent successful verdict")
        sources.append(common._source(path, "native_artifact", cohort_id))
    sources.extend(common._source(path, "native_events", cohort_id, cohort_id) for path in events)
    cohort = {"cohort_id": cohort_id, "contract": CONTRACT, "schema_version": 1,
              "study_id": design["studyId"], "stage": design["studyStage"], "snapshot_id": manifest["snapshotId"],
              "identity_basis": {"kind": "custom_native_service_manifest_v4", "manifest_sha256": common.digest(directory / "service-manifest.json"),
                                 "design_hash": design["designHash"], "dispatch_plan_hash": plan["planHash"]},
              "arms": sorted(ARMS), "run_ids": list(expected), "outcomes": len(rows), "successes": sum(row["success"] for row in rows),
              "score_label": LABEL, "official_reward": None,
              "event_coverage": "explicit_closed_logs" if events else "absent_with_startup_readiness_receipt"}
    return cohort, sources, declared


def _write_table(output, name, rows):
    import pyarrow as pa
    import pyarrow.parquet as pq

    fields = ("cohort_id", "source_id", "run_id", "arm", "event_type", "kind")
    schema = pa.schema([pa.field("row_index", pa.uint64(), nullable=False),
        *[pa.field(field, pa.string()) for field in fields], pa.field("source_row", pa.int64()),
        pa.field("canonical_json", pa.large_string(), nullable=False), pa.field("row_sha256", pa.binary(32), nullable=False)],
        metadata={b"archive_contract": VERSION.encode(), b"canonical_payload": b"RFC8785"})
    jsonl, parquet = output / f"{name}.jsonl", output / f"{name}.parquet"
    count, batch = 0, []
    with jsonl.open("xb") as stream, pq.ParquetWriter(parquet, schema, compression="zstd") as writer:
        for value in rows:
            payload = common._canonical(value)
            stream.write(payload + b"\n")
            batch.append({"row_index": count, "canonical_json": payload.decode("utf-8"), "row_sha256": hashlib.sha256(payload).digest(),
                          **{field: value.get(field) for field in fields}, "source_row": value.get("source_row")})
            count += 1
            if len(batch) >= 128:
                writer.write_table(pa.Table.from_pylist(batch, schema=schema))
                batch = []
        if batch:
            writer.write_table(pa.Table.from_pylist(batch, schema=schema))
    reconstructed, index = hashlib.sha256(), 0
    for arrow_batch in pq.ParquetFile(parquet).iter_batches(batch_size=128):
        for row in arrow_batch.to_pylist():
            payload = row["canonical_json"].encode("utf-8")
            if row["row_index"] != index or hashlib.sha256(payload).digest() != row["row_sha256"]:
                raise ValueError("Parquet row hash or order mismatch")
            reconstructed.update(payload + b"\n")
            index += 1
    if index != count or reconstructed.hexdigest() != common.digest(jsonl):
        raise ValueError("Parquet does not reconstruct exact canonical JSONL")
    return [{"table": name, "filename": path.name, "format": kind, "rows": count, "bytes": path.stat().st_size,
             "sha256": common.digest(path)} for path, kind in ((jsonl, "canonical-jsonl"), (parquet, "parquet"))]


def export_archive(configuration, output, *, closed_confirmed=False):
    # Offline, single-process export only. The v3 scanner can mistake a random
    # interior substring in opaque encrypted continuation data for a key. Use
    # the actual token boundary in this operation, then restore the shared
    # primitive so importing/calling the historical v3 exporter is unchanged.
    original = common.KEY_PREFIX
    try:
        common.KEY_PREFIX = V4_KEY_PREFIX
        return _export_archive(configuration, output, closed_confirmed=closed_confirmed)
    finally:
        common.KEY_PREFIX = original


def _export_archive(configuration, output, *, closed_confirmed=False):
    import pyarrow as pa
    import pyarrow.parquet as pq

    if not closed_confirmed:
        raise ValueError("Explicit closed-work confirmation is required")
    if configuration.get("schemaVersion") != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", configuration.get("archiveId", "")):
        raise ValueError("Invalid v4 archive input manifest")
    cohorts, sources, declarations = [], [], {}
    for specification in configuration.get("cohorts", []):
        cohort, extra, declared = _load_cohort(specification)
        if cohort["cohort_id"] in declarations:
            raise ValueError("Duplicate cohort manifest")
        cohorts.append(cohort)
        sources.extend(extra)
        declarations[cohort["cohort_id"]] = declared
    if not cohorts:
        raise ValueError("At least one closed custom v4 cohort is required")
    for entry in configuration.get("attachments", []):
        if entry.get("kind") not in {"prediction", "annotation", "grading", "analysis", "receipt"}:
            raise ValueError("Unsupported explicit attachment kind")
        sources.append(common._source(entry["path"], entry["kind"]))
    if len({source["path"] for source in sources}) != len(sources):
        raise ValueError("Duplicate artifact path")
    output = common._lexical_path(output)
    if output.exists() or any(output.is_relative_to(Path(spec["directory"]).resolve()) for spec in configuration["cohorts"]):
        raise ValueError("Use a new archive directory outside input cohorts")
    output.mkdir(parents=True, exist_ok=False)
    files = _write_table(output, "cohort_manifest", cohorts)
    files += _write_table(output, "artifact_record", common._records(sources, declarations))
    files += _write_table(output, "artifact_file", ({key: value for key, value in source.items() if key != "expected_manifest"} for source in sources))
    rebuilt = {source["source_id"]: {"hash": hashlib.sha256(), "bytes": 0, "rows": 0} for source in sources}
    for batch in pq.ParquetFile(output / "artifact_record.parquet").iter_batches(batch_size=128, columns=["canonical_json"]):
        for item in batch.to_pylist():
            row = common._loads(item["canonical_json"])
            state = rebuilt[row["source_id"]]
            if row["source_row"] != state["rows"]:
                raise ValueError("Original source record order mismatch")
            raw = row["raw_utf8"].encode("utf-8")
            state["hash"].update(raw)
            state["bytes"] += len(raw)
            state["rows"] += 1
    for source in sources:
        state = rebuilt[source["source_id"]]
        if (state["hash"].hexdigest() != source["original_sha256"] or state["bytes"] != source["original_bytes"]
                or state["rows"] != source["records"] or common.digest(source["path"]) != source["original_sha256"]):
            raise ValueError("Original artifact changed or cannot be reconstructed from Parquet")
    manifest = {"schemaVersion": 1, "archiveId": configuration["archiveId"], "exporterVersion": VERSION,
        "status": "complete", "contract": CONTRACT, "legacyExperimentManifestUsed": False, "cohorts": cohorts,
        "inputConfigurationHash": common._hash(configuration), "sources": sources, "files": files,
        "parquetRoundTripVerified": True, "originalSourceRoundTripVerified": True,
        "databaseAccessed": False, "paidApiCalls": 0, "ledgerOpened": False, "frozenMemoryModified": False,
        "pyarrowVersion": pa.__version__, "exporterSha256": common.digest(Path(__file__)),
        "sharedArchivePrimitiveSha256": common.digest(Path(common.__file__))}
    with (output / "manifest.json").open("xb") as stream:
        stream.write(common._canonical(manifest) + b"\n")
    (output / "manifest.sha256").write_text(common.digest(output / "manifest.json") + "  manifest.json\n", encoding="ascii")
    common.write_package_inventory(configuration, output, sources)
    return manifest
