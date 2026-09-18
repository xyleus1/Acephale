"""Lossless, offline v3 artifact archive, separate from legacy research contracts."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import rfc8785

ARMS = {"base", "paste", "salesforce", "goalspec"}
TABLES = ("cohort_manifest", "artifact_file", "artifact_record")
VERSION = "goalspec-native-artifact-export-v3"
FORBIDDEN_NAME = re.compile(r"(?:^\.env|credential|secret|private.?key|api.?key|budget|\.lock$)", re.I)
KEY_PREFIX = re.compile(r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")
EXCLUDED_PARTS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", "pgdata", "postgres-data", "database-data"}
PRIVATE_NAME = re.compile(r"(?:^\.env(?:\.|$)|credential|secret|private[._-]?key|api[._-]?key|\.lock$|\.(?:pem|pfx|p12|key|sqlite|sqlite3|db)$)", re.I)
TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".csv", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".ps1", ".sql", ".toml", ".yaml", ".yml", ".xml", ".html", ".sha256", ".license", ".lock"}
DEPENDENCY_LOCKS = {"uv.lock", "poetry.lock"}


def _lexical_path(path):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError(f"Linked artifact path is not allowed: {path.name}")
        if part.name.lower() in EXCLUDED_PARTS or PRIVATE_NAME.search(part.name) and part.name.lower() not in DEPENDENCY_LOCKS:
            raise ValueError(f"Excluded artifact path: {path.name}")
    return path.resolve()


def _safe_path(path):
    path = _lexical_path(path)
    if not path.is_file():
        raise ValueError(f"Expected explicit artifact file: {path.name}")
    return path


def _scan_text(path):
    if path.suffix.lower() not in TEXT_SUFFIXES and path.name.lower() not in ("license", "notice", "copying"):
        return "binary_not_scanned"
    tail = ""
    with path.open("r", encoding="utf-8") as stream:
        for block in iter(lambda: stream.read(1 << 20), ""):
            if KEY_PREFIX.search(tail + block):
                raise ValueError(f"Credential-like content in artifact: {path.name}")
            tail = block[-256:]
    return "text_key_prefix_scan_passed"


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def _invalid_constant(_value):
    raise ValueError("Nonfinite JSON value")


def _loads(text):
    return json.loads(text, parse_constant=_invalid_constant)


def _read(path):
    return _loads(_safe_path(path).read_text(encoding="utf-8"))


def _canonical(value):
    return rfc8785.dumps(value)


def _hash(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _source(path, kind, cohort_id=None, expected_manifest=None):
    path = _safe_path(path)
    if path.suffix not in (".json", ".jsonl") or FORBIDDEN_NAME.search(path.name):
        raise ValueError(f"Unsafe artifact filename: {path.name}")
    sha = digest(path)
    return {"source_id": _hash({"path": str(path), "sha256": sha}), "cohort_id": cohort_id,
            "kind": kind, "path": str(path), "format": "jsonl" if path.suffix == ".jsonl" else "json",
            "original_bytes": path.stat().st_size, "original_sha256": sha,
            "expected_manifest": expected_manifest}


def _load_cohort(specification):
    directory = _lexical_path(specification["directory"])
    summary = _read(directory / "summary.json")
    design = _read(directory / "design.json")
    rows = [_loads(line) for line in _safe_path(directory / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows or len(rows) != len(design["trials"]) or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("Every declared outcome must exist before task artifacts are read")
    fields = ("domain", "taskId", "trial", "seed", "arm")
    if Counter(tuple(str(row[key]) for key in fields) for row in rows) != Counter(
            tuple(str(row[key]) for key in fields) for row in design["trials"]):
        raise ValueError("Outcomes do not match the complete paired design")
    aborts = any(row.get("termination") == "stage_abort" for row in rows)
    abort = _read(directory / "stage-abort.json") if aborts else None
    if aborts and (not isinstance(abort, dict) or abort.get("stageAborted") is not True or abort.get("allDeclaredSlotsRetained") is not True):
        raise ValueError("Stage-abort outcomes require their explicit complete cohort receipt")
    manifest_path = directory / "service-manifest.json"
    manifest = _read(manifest_path) if manifest_path.exists() else None
    readiness_path = directory / "service-readiness.json"
    readiness = _read(readiness_path) if readiness_path.exists() else None
    if manifest is not None:
        if manifest.get("runtimeVersion") != "v3" or not manifest.get("snapshotId"):
            raise ValueError("A distinct official v3 service manifest is required")
        declarations = manifest.get("runs", [])
        cohort_id = _hash(manifest)
        identity_basis = {"kind": "native_service_manifest_v3", "manifest_sha256": digest(manifest_path)}
    else:
        if not aborts or any(row.get("termination") != "stage_abort" or row.get("success") is not False
                            or row.get("serviceReadyBeforeTrial") is not False or row.get("latencyMs") is not None for row in rows):
            raise ValueError("Missing service manifest requires a complete pre-service stage-abort cohort")
        if abort.get("studyId") != design.get("studyId") or abort.get("designHash") != design.get("designHash"):
            raise ValueError("Pre-service abort receipt is not bound to its design")
        # Match the official harness's declared run-ID formula without creating
        # or implying a service manifest that never existed.
        def native_hash(value):
            return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        declarations = [{"runId": f"v3-{native_hash(design['studyId'])[:10]}-{design['studyStage']}-{i:04d}-{native_hash([design['designHash'], trial])[:12]}",
                         "arm": trial["arm"], "domain": trial["domain"]} for i, trial in enumerate(design["trials"])]
        identity_basis = {"kind": "unstarted_design_and_abort_receipt", "design_sha256": digest(directory / "design.json"),
                          "abort_receipt_sha256": digest(directory / "stage-abort.json")}
        cohort_id = _hash(identity_basis)
    run_ids = [run["runId"] for run in declarations]
    if not run_ids or len(run_ids) != len(set(run_ids)) or any(not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", run_id) for run_id in run_ids):
        raise ValueError("Invalid or duplicate native run identity")
    if any(run.get("arm") not in ARMS for run in declarations):
        raise ValueError("Unsupported official v3 arm; never reinterpret legacy arms")
    if set(row["runId"] for row in rows) != set(run_ids):
        raise ValueError("Outcome identities differ from service manifest or unstarted design")
    declaration_map = {run["runId"]: run for run in declarations}
    for row in rows:
        declared = declaration_map[row["runId"]]
        if row["arm"] != declared["arm"] or row["domain"] != declared["domain"] or not isinstance(row.get("success"), bool):
            raise ValueError("Native outcome identity mismatch")
    if dict(Counter(row["arm"] for row in rows)) != summary.get("counts") or summary.get("successes") != sum(row["success"] for row in rows):
        raise ValueError("Summary counts differ from immutable outcomes")
    sources = [_source(directory / filename, kind, cohort_id) for filename, kind in (
        ("summary.json", "summary"), ("design.json", "design"), ("outcomes.jsonl", "outcome"))]
    if manifest is not None:
        sources.append(_source(manifest_path, "service_manifest", cohort_id))
    for filename, kind in (("public-contexts.json", "public_contexts"), ("service-readiness.json", "service_readiness")):
        if (directory / filename).exists():
            sources.append(_source(directory / filename, kind, cohort_id))
        elif filename == "public-contexts.json" and not aborts:
            raise ValueError("A started cohort requires its public-context artifact")
    if aborts:
        sources.append(_source(directory / "stage-abort.json", "stage_abort", cohort_id))
    for row in rows:
        suffix = "-stage-abort" if row.get("termination") == "stage_abort" else ""
        path = directory / f"{row['runId']}{suffix}.json"
        if _read(path).get("record") != row:
            raise ValueError("Native artifact record differs from immutable outcome")
        sources.append(_source(path, "native_artifact", cohort_id))
        partial = directory / f"{row['runId']}.json"
        if suffix and partial.exists():
            sources.append(_source(partial, "retained_partial_native_artifact", cohort_id))
    event_paths = specification.get("events", [])
    startup_failure = (manifest is not None and isinstance(readiness, dict) and readiness.get("ready") is False
                       and readiness.get("trialClocksStartedAfterReady") is False and readiness.get("manifestHash") == cohort_id
                       and all(row.get("termination") == "service_startup_error" and row.get("success") is False
                               and row.get("serviceReadyBeforeTrial") is False and row.get("latencyMs") is None for row in rows))
    if not event_paths and not aborts and not startup_failure:
        raise ValueError("A completed native cohort requires its explicit closed event log")
    if event_paths and manifest is None:
        raise ValueError("Native service events cannot be bound without the original service manifest")
    sources += [_source(path, "native_events", cohort_id, cohort_id) for path in event_paths]
    record = {"cohort_id": cohort_id, "contract": "official-native-v3-archive", "schema_version": 1,
              "study_id": summary.get("studyId"), "stage": summary.get("studyStage"), "snapshot_id": manifest["snapshotId"] if manifest else None,
              "identity_basis": identity_basis, "service_manifest_present": manifest is not None,
              "arms": sorted({run["arm"] for run in declarations}), "run_ids": run_ids,
              "outcomes": len(rows), "successes": sum(row["success"] for row in rows),
              "event_coverage": "explicit_closed_logs" if event_paths else "absent_with_startup_readiness_receipt" if startup_failure else "absent_with_stage_abort_receipt"}
    return record, sources, declaration_map


def _index(value, source, declarations):
    event = value
    if isinstance(value, dict):
        event = value.get("body", {}).get("event", value) if isinstance(value.get("body", {}), dict) else value
    if not isinstance(event, dict):
        event = {}
    inner = event.get("event", event)
    if not isinstance(inner, dict):
        inner = {}
    native = value.get("record", {}) if isinstance(value, dict) else {}
    if not isinstance(native, dict):
        native = {}
    run_id = event.get("runId", inner.get("runId", native.get("runId")))
    run_id = run_id if isinstance(run_id, str) else None
    declared = declarations.get(run_id, declarations.get(run_id.split(":", 1)[0], {}) if run_id else {})
    arm, event_type = declared.get("arm", event.get("arm")), inner.get("type")
    return {"run_id": run_id if isinstance(run_id, str) else None,
            "arm": arm if isinstance(arm, str) else None,
            "event_type": event_type if isinstance(event_type, str) else None}


def _records(sources, declarations):
    for source in sources:
        path = Path(source["path"])
        previous, sequence, first, last = "0" * 64, 0, None, None
        lifecycle = Counter()
        count = 0
        with path.open("rb") as stream:
            chunks = stream if source["format"] == "jsonl" else [stream.read()]
            for index, raw in enumerate(chunks):
                text = raw.decode("utf-8")
                if KEY_PREFIX.search(text):
                    raise ValueError(f"Credential-like content in artifact: {path.name}")
                value = _loads(text) if text.strip() else None
                if source["kind"] == "native_events":
                    if not isinstance(value, dict):
                        raise ValueError("Native event record must be an object")
                    if raw != _canonical(value) + b"\n":
                        raise ValueError("Native event bytes differ from canonical record plus committed newline")
                    body = value.get("body", {})
                    if not isinstance(body, dict) or type(body.get("sequence")) is not int or body.get("sequence") != sequence or body.get("previousHash") != previous or _hash(body) != value.get("hash"):
                        raise ValueError("Native event chain hash or sequence mismatch")
                    event = body.get("event", {})
                    if not isinstance(event, dict):
                        raise ValueError("Native event payload must be an object")
                    if first is None:
                        first = event
                        if event.get("type") != "research_manifest" or event.get("manifestHash") != source["expected_manifest"]:
                            raise ValueError("Native event manifest differs from cohort manifest")
                        declared = declarations[source["cohort_id"]]
                        announced = event.get("runs", [])
                        if len(announced) != len(declared) or {run["id"]: run.get("arm") for run in announced} != {key: row["arm"] for key, row in declared.items()}:
                            raise ValueError("Native event declaration differs from cohort runs")
                    event_run = event.get("runId")
                    if event_run is not None and (not isinstance(event_run, str) or event_run.split(":", 1)[0] not in declarations[source["cohort_id"]]):
                        raise ValueError("Native event run is outside the declared cohort")
                    last = event.get("type")
                    lifecycle[last] += 1
                    previous, sequence = value["hash"], sequence + 1
                indices = _index(value, source, declarations.get(source["cohort_id"], {}))
                yield {"source_id": source["source_id"], "source_row": index, "cohort_id": source["cohort_id"],
                       "kind": source["kind"], **indices, "raw_utf8": text}
                count += 1
        if source["kind"] == "native_events":
            if first is None or last != "service_closed" or lifecycle["research_manifest"] != 1 or lifecycle["service_closed"] != 1:
                raise ValueError("Native event log is active or lacks acknowledged service closure")
            source["event_chain"] = {"records": sequence, "tail_sha256": previous, "service_closed": True}
        if digest(path) != source["original_sha256"] or path.stat().st_size != source["original_bytes"]:
            raise ValueError("Source changed during archival")
        source["records"] = count


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
            payload = _canonical(value)
            stream.write(payload + b"\n")
            row = {"row_index": count, "canonical_json": payload.decode("utf-8"), "row_sha256": hashlib.sha256(payload).digest(),
                   **{field: value.get(field) for field in fields}, "source_row": value.get("source_row")}
            batch.append(row)
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
    if index != count or reconstructed.hexdigest() != digest(jsonl):
        raise ValueError("Parquet does not reconstruct exact canonical JSONL")
    return [{"table": name, "filename": path.name, "format": format_name, "rows": count, "bytes": path.stat().st_size,
             "sha256": digest(path)} for path, format_name in ((jsonl, "canonical-jsonl"), (parquet, "parquet"))]


def export_archive(configuration, output, *, closed_confirmed=False):
    import pyarrow as pa
    import pyarrow.parquet as pq

    if not closed_confirmed:
        raise ValueError("Explicit closed-work confirmation is required")
    if configuration.get("schemaVersion") != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", configuration.get("archiveId", "")):
        raise ValueError("Invalid v3 archive input manifest")
    cohorts, sources, declarations = [], [], {}
    for specification in configuration.get("cohorts", []):
        cohort, extra, declared = _load_cohort(specification)
        if cohort["cohort_id"] in declarations:
            raise ValueError("Duplicate cohort manifest")
        cohorts.append(cohort)
        sources.extend(extra)
        declarations[cohort["cohort_id"]] = declared
    if not cohorts:
        raise ValueError("At least one closed official cohort is required")
    for entry in configuration.get("attachments", []):
        if entry.get("kind") not in ("prediction", "annotation", "grading", "analysis", "receipt"):
            raise ValueError("Unsupported explicit attachment kind")
        sources.append(_source(entry["path"], entry["kind"]))
    if len({source["path"] for source in sources}) != len(sources):
        raise ValueError("Duplicate artifact path")
    output = _lexical_path(output)
    if output.exists() or any(output.is_relative_to(Path(spec["directory"]).resolve()) for spec in configuration["cohorts"]):
        raise ValueError("Use a new archive directory outside input cohorts")
    output.mkdir(parents=True, exist_ok=False)
    files = _write_table(output, "cohort_manifest", cohorts)
    files += _write_table(output, "artifact_record", _records(sources, declarations))
    files += _write_table(output, "artifact_file", ({key: value for key, value in source.items() if key != "expected_manifest"} for source in sources))
    # Independently reconstruct every original source from serialized Parquet,
    # including whitespace/newlines and numeric text that JSONB would normalize.
    rebuilt = {source["source_id"]: {"hash": hashlib.sha256(), "bytes": 0, "rows": 0} for source in sources}
    for batch in pq.ParquetFile(output / "artifact_record.parquet").iter_batches(batch_size=128, columns=["canonical_json"]):
        for item in batch.to_pylist():
            row = _loads(item["canonical_json"])
            state = rebuilt[row["source_id"]]
            if row["source_row"] != state["rows"]:
                raise ValueError("Original source record order mismatch")
            raw = row["raw_utf8"].encode("utf-8")
            state["hash"].update(raw)
            state["bytes"] += len(raw)
            state["rows"] += 1
    for source in sources:
        state = rebuilt[source["source_id"]]
        if state["hash"].hexdigest() != source["original_sha256"] or state["bytes"] != source["original_bytes"] or state["rows"] != source["records"]:
            raise ValueError("Parquet cannot reconstruct original artifact bytes")
        if digest(source["path"]) != source["original_sha256"]:
            raise ValueError("Source changed before archive closure")
    manifest = {"schemaVersion": 1, "archiveId": configuration["archiveId"], "exporterVersion": VERSION, "status": "complete",
                "contract": "official-native-v3-archive", "legacyExperimentManifestUsed": False, "cohorts": cohorts,
                "inputConfigurationHash": _hash(configuration), "sources": sources, "files": files,
                "parquetRoundTripVerified": True, "originalSourceRoundTripVerified": True,
                "databaseAccessed": False, "paidApiCalls": 0, "ledgerOpened": False, "pyarrowVersion": pa.__version__,
                "exporterSha256": digest(Path(__file__))}
    with (output / "manifest.json").open("xb") as stream:
        stream.write(_canonical(manifest) + b"\n")
    (output / "manifest.sha256").write_text(digest(output / "manifest.json") + "  manifest.json\n", encoding="ascii")
    write_package_inventory(configuration, output, sources)
    return manifest


def write_package_inventory(configuration, output, sources):
    """Hash an explicit final-package allowlist; never discover directory contents."""
    root = _lexical_path(configuration.get("packageRoot", Path.cwd()))
    output = _lexical_path(output)
    entries = {}
    requested = [(source["path"], "archive_source", source["original_sha256"]) for source in sources]
    requested += [(output / f"{table}.{suffix}", "archive_output", None) for table in TABLES for suffix in ("jsonl", "parquet")]
    requested += [(output / name, "archive_output", None) for name in ("manifest.json", "manifest.sha256")]
    for entry in configuration.get("packageFiles", []):
        if isinstance(entry, str):
            requested.append((root / entry, "explicit_package_file", None))
        elif isinstance(entry, dict) and isinstance(entry.get("path"), str) and re.fullmatch(r"[0-9a-f]{64}", entry.get("sha256", "")):
            requested.append((root / entry["path"], "explicit_package_file", entry["sha256"]))
        else:
            raise ValueError("Package files must be exact paths or path/SHA256 declarations")
    for raw_path, role, expected_hash in requested:
        path = _safe_path(raw_path)
        if not path.is_relative_to(root) or path.name in ("package-inventory.json", "package-inventory.sha256"):
            raise ValueError(f"Package input is outside declared root or self-including: {path.name}")
        relative = path.relative_to(root).as_posix()
        before = digest(path)
        if expected_hash is not None and before != expected_hash:
            raise ValueError(f"Package input differs from declared source hash: {path.name}")
        if relative in entries:
            continue
        scan = _scan_text(path)
        if digest(path) != before:
            raise ValueError(f"Package input changed during scan: {path.name}")
        entries[relative] = {"path": relative, "bytes": path.stat().st_size, "sha256": before, "role": role,
                             "expectedHashVerified": expected_hash is not None, "contentScan": scan}
    inventory = {"schemaVersion": 1, "archiveId": configuration["archiveId"], "kind": "explicit-package-file-inventory",
                 "packageRoot": str(root), "files": [entries[key] for key in sorted(entries)],
                 "filesCount": len(entries), "bytes": sum(row["bytes"] for row in entries.values()),
                 "recursiveDiscovery": False, "selfInclusion": False,
                 "binaryContentNotScanned": True, "zipCreationAndNestedArchiveVerificationRequired": True}
    with (output / "package-inventory.json").open("xb") as stream:
        stream.write(_canonical(inventory) + b"\n")
    with (output / "package-inventory.sha256").open("x", encoding="ascii") as stream:
        stream.write(digest(output / "package-inventory.json") + "  package-inventory.json\n")
    return inventory
