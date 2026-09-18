"""Explicit closed v5 allowlist -> lossless JSONL/Parquet -> deterministic ZIP.

No directory globs, provider calls, database access, ledger opening, or edits to
source artifacts. Import is a separate opt-in Prisma bridge. Credential-looking
content is rejected, never silently redacted because that would break lineage.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
sys.path.insert(0, str(ROOT / "outputs/goalspec-v4-tools"))
from goalspec.archive_v4 import _write_table
from goalspec.contracts_v1 import hash_v1
from goalspec.fresh_tasks import digest as native_hash
from build_package import checked_path, relative_path

VERSION = "goalspec-results-archive-v5"
CONTRACT = "closed-research-v5-byte-archive"
ROLES = {"ledger", "provider-events", "native-outcomes", "native-trace", "controller", "memory", "library",
         "replay", "annotation", "analysis", "verification", "plan", "source", "source-freeze", "documentation", "failed-attempt"}
KEY = re.compile(rb"(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")
PASSWORD_URL = re.compile(rb"(?:postgres(?:ql)?|https?)://[^\s/:\"']+:[^\s/@\"']+@", re.I)
CHUNK = 1024 * 1024
TABLES = ("cohort_manifest", "artifact_file", "artifact_record")


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            value.update(block)
    return value.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2)
        stream.write("\n")


def located(root, name):
    safe = relative_path(name)
    require(".benchmarks" not in safe.parts, "Upstream checkouts are external pinned inputs")
    return checked_path(root, root.joinpath(*safe.parts))


def reviewed_synthetic_urls(specification, source_hash, role):
    review = specification.get("syntheticUrlReview")
    if review is None:
        return Counter()
    require(role in {"source", "documentation"}, "Only reviewed source examples may contain synthetic URL literals")
    require(review.get("sourceSha256") == source_hash and isinstance(review.get("reason"), str) and review["reason"],
            "Synthetic URL review must bind exact source bytes and provenance")
    counts = review.get("literalSha256Counts")
    require(isinstance(counts, dict) and counts and all(re.fullmatch(r"[0-9a-f]{64}", name) and type(count) is int and count > 0
            for name, count in counts.items()), "Synthetic URL review needs exact matched-literal counts")
    return Counter(counts)


def scan(path, specification=None, role=None):
    allowed = reviewed_synthetic_urls(specification or {}, digest(path), role) if specification and specification.get("syntheticUrlReview") else Counter()
    found = Counter()
    tail = b""
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            value = tail + block
            require(not KEY.search(value), "Credential-looking API-key content rejected")
            for match in PASSWORD_URL.finditer(value):
                if match.end() <= len(tail):
                    continue
                literal_hash = hashlib.sha256(match.group()).hexdigest()
                require(literal_hash in allowed, "Credential-looking URL content rejected")
                found[literal_hash] += 1
            tail = value[-512:]
    require(found == allowed, "Reviewed synthetic URL literal counts changed")


def validate_source_archive(path, specification):
    require(isinstance(specification.get("members"), dict) and specification["members"], "Source ZIP needs an exact pinned member inventory")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) == set(specification["members"]), "Source ZIP inventory mismatch")
        require(sum(item.file_size for item in archive.infolist()) <= 256 * CHUNK, "Source ZIP expansion exceeds bound")
        for name in names:
            relative = relative_path(name)
            require(".benchmarks" not in relative.parts or relative.parts[:4] == ("research", "goalspec", ".benchmarks", "tau3"), "Only exact pinned tau3 source members are allowed")
            # Only the pinned source inventory may contain selected upstream
            # source files. No outer upstream checkout directory is accepted.
            payload = archive.read(name)
            expected = specification["members"][name]
            actual_hash = hashlib.sha256(payload).hexdigest()
            require(actual_hash == expected["sha256"] and len(payload) == expected["bytes"], "Source ZIP member hash mismatch")
            require(not KEY.search(payload), "Credential-looking API-key source member rejected")
            allowed = reviewed_synthetic_urls(expected, actual_hash, "documentation" if name.startswith("docs/") else "source")
            found = Counter(hashlib.sha256(match.group()).hexdigest() for match in PASSWORD_URL.finditer(payload))
            require(found == allowed, "Unreviewed credential-looking source member rejected")


def check_chain(path, kind):
    require(kind in {"budget", "events", "plain-jsonl"}, "Declare the event/ledger encoding")
    previous, count = "0" * 64, 0
    with path.open("rb") as stream:
        for raw in stream:
            require(raw.endswith(b"\n") and raw.strip(), "Incomplete or empty log record")
            row = json.loads(raw)
            if kind != "plain-jsonl":
                body = row["body"]
                require(body["sequence"] == count and body["previous" if kind == "budget" else "previousHash"] == previous
                        and hash_v1(body) == row["hash"], "Journal/event hash chain changed")
                previous = row["hash"]
            count += 1
    return {"encoding": kind, "records": count, "lastHash": previous if kind != "plain-jsonl" else None}


def cohort(specification, files):
    def payload(key):
        name = specification[key]
        require(name in files, "Cohort metadata must be explicitly allowlisted")
        return read(files[name]["file"])
    design, manifest = payload("design"), payload("serviceManifest")
    require(design.get("version") == "goalspec-experiment-v5", "Expected custom v5 native design")
    require(native_hash({k: v for k, v in design.items() if k != "designHash"}) == design.get("designHash"), "Design hash changed")
    label = design.get("label", "custom tau-compatible pilot")
    require(label in {"custom tau-compatible pilot", "selected official tau3 subset"}, "Unknown benchmark score scope")
    name = specification["outcomes"]
    require(name in files and files[name]["role"] == "native-outcomes", "Native outcomes must be allowlisted")
    raw = files[name]["file"].read_bytes()
    require(raw.endswith(b"\n") and all(line.strip() for line in raw.splitlines()), "Outcomes are incomplete")
    rows = [json.loads(line) for line in raw.splitlines()]
    expected = {f"v5-{native_hash(design['studyId'])[:10]}-{design['studyStage']}-{i:04d}-{native_hash([design['designHash'], trial])[:12]}": trial for i, trial in enumerate(design["trials"])}
    declared = {row["runId"]: row for row in manifest["runs"]}
    require(len(rows) == len(expected) == len(declared) == len(manifest["runs"]) and set(expected) == set(declared) == {row["runId"] for row in rows}, "Complete declared v5 grid required")
    traces = specification["traces"]
    require(set(traces) == set(expected), "Every declared success or failure needs its exact trace path")
    for row in rows:
        run = row["runId"]
        require(all(row.get(k) == v for k, v in expected[run].items()), "Outcome/run identity association mismatch")
        require(all(declared[run].get(k) == row.get(k) for k in ("arm", "domain")), "Service/outcome association mismatch")
        require(isinstance(row.get("success"), bool), "Invalid native outcome")
        if label == "custom tau-compatible pilot": require(row.get("officialReward") is None, "Custom outcomes cannot acquire an official reward")
        require(traces[run] in files and read(files[traces[run]]["file"]).get("record") == row, "Trace differs from declared outcome")
        if row["success"]:
            require(row.get("termination") in {"user_stop", "agent_stop"} and row.get("serviceDrainSucceeded") is True, "Unfinished native trial cannot be successful")
            if label == "selected official tau3 subset": require(row.get("officialReward") == 1, "Official success must preserve the upstream full reward")
        else:
            require(row.get("termination"), "Failure needs explicit termination")
    require(specification.get("closed") is True, "Cohort must be explicitly closed")
    return {"cohort_id": hash_v1(manifest), "study_id": design["studyId"], "stage": design["studyStage"],
            "outcomes": len(rows), "successes": sum(row["success"] for row in rows), "run_ids": sorted(expected),
            "complete_declared_grid": True, "failed_slots_retained": True, "label": label}


def file_size_limit(item, *, default_limit=256 * CHUNK, ledger_limit=512 * CHUNK):
    """Only a declared full budget journal can opt into the larger bound."""
    if "maximumFileBytes" not in item:
        return default_limit
    limit = item["maximumFileBytes"]
    require(item.get("role") == "ledger" and item.get("chain") == "budget",
            "Only a full hash-chained budget ledger may override the file bound")
    require(type(limit) is int and default_limit <= limit <= ledger_limit,
            "Explicit budget ledger bound must stay within 512 MiB")
    return limit


def checkpoint_binding(specification, files):
    journal, pointer, checkpoint = (files[specification[key]] for key in ("journal", "pointer", "checkpoint"))
    require(journal["role"] == "ledger" and journal.get("chain") == "budget"
            and pointer["role"] == checkpoint["role"] == "verification", "Checkpoint sidecars are verification artifacts, never additional ledgers")
    link, value = read(pointer["file"]), read(checkpoint["file"])
    require(link.get("version") == 1 and link.get("checkpointFile") == checkpoint["file"].name
            and checkpoint["file"].parent == pointer["file"].parent == journal["file"].parent
            and link.get("sha256") == checkpoint["sha256"], "Checkpoint pointer changed")
    require(value.get("version") == 1 and value.get("contentHash") == hash_v1({k: v for k, v in value.items() if k != "contentHash"})
            and isinstance(specification.get("originalJournalPath"), str)
            and value.get("journalPathHash") == hash_v1(specification["originalJournalPath"])
            and isinstance(value.get("entries"), list) and len(value["entries"]) <= 100000
            and value.get("entriesHash") == hash_v1(value["entries"]), "Checkpoint metadata changed")
    length, sequence = value.get("prefixBytes"), value.get("nextSequence")
    require(type(length) is int and 0 <= length <= journal["bytes"] and type(sequence) is int and sequence >= 0, "Invalid checkpoint prefix")
    prefix, consumed, last = hashlib.sha256(), 0, None
    with journal["file"].open("rb") as stream:
        while consumed < length:
            raw = stream.readline()
            require(raw and raw.endswith(b"\n") and consumed + len(raw) <= length, "Checkpoint prefix is not a complete journal boundary")
            prefix.update(raw); consumed += len(raw); last = raw
    require(prefix.hexdigest() == value.get("prefixSha256"), "Checkpoint prefix hash changed")
    if last is None:
        require(sequence == 0 and value.get("lastChainHash") == "0" * 64 and not value["entries"], "Invalid empty checkpoint")
    else:
        terminal = json.loads(last)
        require(terminal["body"]["sequence"] == sequence - 1 and terminal["hash"] == value.get("lastChainHash"), "Checkpoint terminal record changed")
    return {"pointer": specification["pointer"], "checkpoint": specification["checkpoint"], "prefixBytes": length,
            "nextSequence": sequence, "prefixHashVerified": True, "checkpointContentHashVerified": True,
            "fullJournalPreserved": True, "independentLedger": False, "checkpointStateReplayed": False}


def collect(root, plan):
    require(plan.get("version") == "goalspec-v5-archive-plan-v1" and plan.get("closed") is True, "Explicit closed v5 archive plan required")
    require(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", plan.get("archiveId", "")), "Invalid archive ID")
    require(plan.get("externalInputs"), "Declare pinned external dependencies/public raw data")
    files, total = {}, 0
    for item in plan["files"]:
        name = item["path"]
        require(name.lower() not in {p.lower() for p in files} and item["role"] in ROLES, "Repeated path or invalid role")
        path = located(root, name)
        require(path.is_file() and path.stat().st_size <= file_size_limit(item), "Missing or oversized allowlisted file")
        require(digest(path) == item["sha256"], "Frozen source hash mismatch")
        require(not ("apigen" in name.lower() and path.name in {"checkpoints.jsonl", "scores.jsonl", "public-cases.json", "records.jsonl"}), "Raw APIGen rows remain pinned external inputs")
        if item["role"] == "source-freeze":
            validate_source_archive(path, item)
        else:
            require(path.suffix.lower() in {".json", ".jsonl", ".md", ".txt", ".log", ".csv", ".ts", ".py", ".cjs", ".sql", ".ps1", ".parquet", ".sha256"}, "File extension is not allowlisted")
            scan(path, item, item["role"])
        total += path.stat().st_size
        chain = check_chain(path, item.get("chain")) if item["role"] in {"ledger", "provider-events"} else None
        files[name] = {**item, "file": path, "bytes": path.stat().st_size, "source_id": hashlib.sha256(name.encode()).hexdigest(), "chainVerification": chain}
    require(files and total <= plan.get("maximumBytes", 2 * 1024**3) <= 8 * 1024**3, "Archive size bound exceeded")
    for binding in plan.get("budgetCheckpointBindings", []):
        require(all(binding.get(key) in files for key in ("journal", "pointer", "checkpoint")), "All checkpoint binding files must be explicitly allowlisted")
        files[binding["journal"]].setdefault("checkpointVerification", []).append(checkpoint_binding(binding, files))
    for old in plan.get("preserveArchives", []):
        require(digest(located(root, old["path"])) == old["sha256"], "Prior archive changed")
    cohorts = [cohort(spec, files) for spec in plan.get("cohorts", [])]
    return files, cohorts


def records(files):
    for name, item in sorted(files.items()):
        with item["file"].open("rb") as stream:
            for ordinal, raw in enumerate(iter(lambda: stream.read(CHUNK), b"")):
                yield {"source_id": item["source_id"], "source_row": ordinal, "kind": item["role"],
                       "raw_base64": base64.b64encode(raw).decode("ascii"), "raw_sha256": hashlib.sha256(raw).hexdigest()}


def inspect(directory, expected):
    import pyarrow.parquet as pq
    directory = Path(directory)
    require(digest(directory / "manifest.json") == expected, "Manifest hash changed")
    manifest = read(directory / "manifest.json")
    require(manifest.get("version") == VERSION and manifest.get("contract") == CONTRACT and manifest.get("complete") is True, "Unsupported archive")
    declared = {(item["table"], item["format"]): item for item in manifest["files"]}
    require(set(declared) == {(table, kind) for table in TABLES for kind in ("canonical-jsonl", "parquet")}, "Archive table set mismatch")
    rebuilt = {row["source_id"]: {"hash": hashlib.sha256(), "bytes": 0, "rows": 0} for row in manifest["sources"]}
    for table in TABLES:
        for kind in ("canonical-jsonl", "parquet"):
            item = declared[table, kind]
            require(item["filename"] == f"{table}.{'jsonl' if kind == 'canonical-jsonl' else 'parquet'}", "Unexpected export filename")
            require(digest(directory / item["filename"]) == item["sha256"], "Archive table changed")
        row_hash, count = hashlib.sha256(), 0
        for batch in pq.ParquetFile(directory / f"{table}.parquet").iter_batches(batch_size=16):
            for item in batch.to_pylist():
                raw = item["canonical_json"].encode()
                require(item["row_index"] == count and hashlib.sha256(raw).digest() == item["row_sha256"], "Parquet row changed")
                row_hash.update(raw + b"\n"); count += 1
                if table == "artifact_record":
                    value = json.loads(raw); state = rebuilt[value["source_id"]]
                    payload = base64.b64decode(value["raw_base64"], validate=True)
                    require(value["source_row"] == state["rows"] and hashlib.sha256(payload).hexdigest() == value["raw_sha256"], "Source chunk changed")
                    state["hash"].update(payload); state["bytes"] += len(payload); state["rows"] += 1
        require(count == declared[table, "parquet"]["rows"] == declared[table, "canonical-jsonl"]["rows"] and row_hash.hexdigest() == declared[table, "canonical-jsonl"]["sha256"], "Parquet/JSONL roundtrip differs")
    for item in manifest["sources"]:
        state = rebuilt[item["source_id"]]
        require(state["hash"].hexdigest() == item["sha256"] and state["bytes"] == item["bytes"], "Original file byte reconstruction differs")
    return {"verified": True, "manifestSha256": expected, "files": len(rebuilt), "bytes": sum(row["bytes"] for row in manifest["sources"]), "databaseAccessed": False}


def export(root, plan_path, output):
    root, plan_path, output = Path(root).resolve(), Path(plan_path).resolve(), Path(output).resolve()
    require(output.is_relative_to(root / "research/goalspec/runs") and not output.exists(), "Use a new research archive directory")
    plan = read(plan_path); files, cohorts = collect(root, plan)
    output.mkdir(parents=True, exist_ok=False)
    sources = [{k: v for k, v in row.items() if k not in {"file", "members"}} for _, row in sorted(files.items())]
    exports = _write_table(output, "cohort_manifest", cohorts)
    exports += _write_table(output, "artifact_file", sources)
    exports += _write_table(output, "artifact_record", records(files))
    collect(root, plan)  # Recheck immutable inputs and prior archives after IO.
    manifest = {"version": VERSION, "contract": CONTRACT, "archiveId": plan["archiveId"], "complete": True,
        "sources": sources, "files": exports, "cohorts": cohorts, "planSha256": digest(plan_path),
        "externalInputs": plan["externalInputs"], "preserveArchives": plan.get("preserveArchives", []),
        "sourceFiles": [{"path": str(Path(__file__)), "sha256": digest(__file__)}],
        "encoding": "Fixed maximum 1 MiB original-byte chunks, base64 in JSONL; exact byte reconstruction including line endings",
        "paidCalls": 0, "ledgerOpened": False, "databaseAccessed": False}
    write(output / "manifest.json", manifest)
    proof = inspect(output, digest(output / "manifest.json")); write(output / "verification.json", proof)
    return proof


def pack(root, plan_path, directory, expected, output):
    root, directory, output = Path(root).resolve(), Path(directory).resolve(), Path(output).resolve()
    require(output.is_relative_to(root / "outputs") and output.suffix == ".zip" and not output.exists(), "Use a new output ZIP")
    inspect(directory, expected)
    plan = read(plan_path); files, _ = collect(root, plan)
    manifest = read(directory / "manifest.json")
    require(manifest["planSha256"] == digest(plan_path), "ZIP plan differs from exported plan")
    members = {name: item["file"] for name, item in files.items()}
    for name in ("manifest.json", "verification.json", *[row["filename"] for row in manifest["files"]]):
        members[f"_archive/{name}"] = directory / name
    members["_archive/input-plan.json"] = Path(plan_path)
    inventory = {name: {"sha256": digest(path), "bytes": path.stat().st_size} for name, path in sorted(members.items())}
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, path in sorted(members.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16
            with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as destination:
                for chunk in iter(lambda: source.read(CHUNK), b""): destination.write(chunk)
        info = zipfile.ZipInfo("_bundle/manifest.json", (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16
        archive.writestr(info, json.dumps({"version": VERSION, "members": inventory, "externalInputs": plan["externalInputs"]}, sort_keys=True, separators=(",", ":")))
    with zipfile.ZipFile(output) as archive:
        require(set(archive.namelist()) == set(inventory) | {"_bundle/manifest.json"}, "ZIP member set differs")
        for name, item in inventory.items():
            value = hashlib.sha256()
            with archive.open(name) as stream:
                for chunk in iter(lambda: stream.read(CHUNK), b""): value.update(chunk)
            require(value.hexdigest() == item["sha256"] and archive.getinfo(name).file_size == item["bytes"], "ZIP roundtrip differs")
    collect(root, plan)
    receipt = {"version": VERSION, "zipSha256": digest(output), "bytes": output.stat().st_size, "members": len(inventory) + 1,
               "manifestSha256": expected, "zipRoundtripVerified": True, "preservedArchives": plan.get("preserveArchives", []), "externalInputs": plan["externalInputs"]}
    write(output.with_suffix(".zip.receipt.json"), receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("export", "inspect", "pack")); parser.add_argument("paths", nargs="+"); parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args()
    if args.command == "export": result = export(args.root, *args.paths)
    elif args.command == "inspect": result = inspect(*args.paths)
    else: result = pack(args.root, *args.paths)
    print(json.dumps(result))


if __name__ == "__main__":
    try: main()
    except Exception:
        print("V5 archive operation failed; source values and connection details withheld.", file=sys.stderr)
        raise SystemExit(1)
