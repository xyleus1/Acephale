"""Package closed benchmark results from an explicit allowlist; no providers or DB writes.

The JSON plan contains version=goalspec-benchmark-bundle-input-v1, files=[{path,
role,sha256?}], native={directory,events:[path],sourceArchive,expectedTrials:112},
tauAnalysis=directory, and externalInputs=[{name,pin,reason}]. Paths are relative
to --root. Roles: analysis, plan, selection, budget, helper, component, metadata.
Every analysis/report/plan file must be individually named; no directory scans.
Upstream dependencies and raw APIGen data remain external pinned inputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

VERSION = "goalspec-benchmark-results-bundle-v1"
PLAN_VERSION = "goalspec-benchmark-bundle-input-v1"
ROLES = {"analysis", "plan", "selection", "budget", "helper", "component", "metadata"}
SUFFIXES = {".json", ".jsonl", ".csv", ".md", ".txt", ".py", ".ts", ".parquet"}
BLOCKED_PARTS = {"node_modules", ".git", ".benchmarks", ".venv", "__pycache__", ".aws", ".ssh"}
NATIVE_METADATA = ("summary.json", "design.json", "dispatch-plan.json", "service-manifest.json", "outcomes.jsonl")
ARMS = {"base", "paste", "salesforce", "goalspec"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def hash_stream(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1 << 20), b""):
        digest.update(chunk)
    return digest.hexdigest()


def sha256(path):
    with Path(path).open("rb") as stream:
        return hash_stream(stream)


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_new(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def safe_name(value, *, pinned_native_source=False):
    require(isinstance(value, str) and "\\" not in value and ":" not in value, "Use portable relative paths")
    path = PurePosixPath(value)
    require(value and not path.is_absolute() and all(p not in {"", ".", ".."} for p in value.split("/")), "Unsafe archive path")
    for part in path.parts:
        lowered = part.lower()
        embedded_native = pinned_native_source and path.parts[:4] == ("research", "goalspec", ".benchmarks", "tau3") and lowered == ".benchmarks"
        require(lowered not in BLOCKED_PARTS or embedded_native, "Dependency or private directory is excluded")
        require(not (lowered == ".env" or lowered.startswith(".env.") or
                     re.search(r"(^|[._-])(credentials?|secrets?|api[._-]?keys?|access[._-]?tokens?)([._-]|$)", lowered)),
                "Credential-related filenames are excluded")
    return path


def located(root, value):
    relative = safe_name(value)
    path = root.joinpath(*relative.parts)
    require(path.resolve().is_relative_to(root), "Source resolves outside repository")
    # Disallow symlinks/junctions that rename data into the explicit allowlist.
    require(path.resolve() == path.absolute(), "Source path redirects through a link")
    return path


def validate_rows(rows, expected=112):
    require(expected == 112 and len(rows) == expected, "Expected all 112 native outcomes")
    ids = [row.get("runId") for row in rows]
    require(len(set(ids)) == expected and all(isinstance(i, str) and re.fullmatch(r"official-v4-[a-z0-9-]+", i) for i in ids), "Invalid or repeated native run ID")
    require(Counter(row.get("arm") for row in rows) == {arm: 28 for arm in ARMS}, "Native arm grid is incomplete")
    groups = {}
    for row in rows:
        require(row.get("domain") in {"retail", "airline"} and isinstance(row.get("success"), bool), "Invalid native outcome")
        key = row["domain"], str(row["taskId"])
        groups.setdefault(key, []).append(row)
    require(len(groups) == 14 and Counter(domain for domain, _ in groups) == {"retail": 7, "airline": 7}, "Native task grid differs")
    for members in groups.values():
        require(len(members) == 8 and Counter(row["arm"] for row in members) == {arm: 2 for arm in ARMS}, "Native task repetition grid differs")
        signatures = [{(row["trial"], row["seed"]) for row in members if row["arm"] == arm} for arm in sorted(ARMS)]
        require(len(signatures[0]) == 2 and all(s == signatures[0] for s in signatures), "Native paired trials differ")


def export_outcomes(source, output, rows):
    """Preserve each original line as binary, including its exact line ending.

    Semantic columns support analysis; original_line is the lossless authority
    for missing/null distinctions, numeric spelling, ordering, and UTF-8 bytes.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    output = Path(output)
    require(not output.exists(), "Outcome export must be a new directory")
    payload = Path(source).read_bytes()
    lines = payload.splitlines(keepends=True)
    require(len(lines) == len(rows) and all(line.strip() for line in lines), "Outcome lines must be nonempty and complete")
    require([json.loads(line) for line in lines] == rows, "Outcome rows changed before export")
    output.mkdir(parents=True, exist_ok=False)
    jsonl, parquet = output / "outcomes.jsonl", output / "outcomes.parquet"
    shutil.copyfile(source, jsonl)
    table = pa.table({"ordinal": pa.array(range(len(rows)), type=pa.int32()),
        "run_id": [r["runId"] for r in rows], "domain": [r["domain"] for r in rows],
        "task_id": [str(r["taskId"]) for r in rows], "arm": [r["arm"] for r in rows],
        "trial": [r["trial"] for r in rows], "success": [r["success"] for r in rows],
        "original_line": pa.array(lines, type=pa.binary())})
    pq.write_table(table, parquet, compression="zstd")
    restored = pq.read_table(parquet)
    require(restored.equals(table), "Parquet typed-column roundtrip changed values")
    reconstructed = b"".join(restored.column("original_line").to_pylist())
    source_hash = hashlib.sha256(payload).hexdigest()
    require(reconstructed == payload and sha256(jsonl) == source_hash == sha256(source), "Lossless outcome roundtrip failed")
    manifest = {"version": VERSION, "rows": len(rows), "sourceSha256": source_hash,
        "losslessColumn": "original_line (binary, including original line endings)",
        "byteIdenticalJsonl": True, "parquetReconstructedBytesIdentical": True,
        "files": {p.name: sha256(p) for p in (jsonl, parquet)}}
    write_new(output / "manifest.json", manifest)
    return [jsonl, parquet, output / "manifest.json"]


def collect(root, plan, plan_path):
    require(plan.get("version") == PLAN_VERSION, "Unsupported bundle input plan")
    require(isinstance(plan.get("externalInputs"), list) and plan["externalInputs"], "Declare external pinned inputs")
    for item in plan["externalInputs"]:
        require(all(isinstance(item.get(k), str) and item[k] for k in ("name", "pin", "reason")), "Incomplete external input declaration")
    files = {}

    def add(value, role, expected=None):
        path = located(root, value)
        require(path.is_file(), f"Missing allowlisted source: {value}")
        require(value.lower() not in {name.lower() for name in files}, "Repeated bundle source")
        require(path.suffix.lower() in SUFFIXES or (role == "source-freeze" and path.name == "source.zip"), "Source extension is not allowed")
        if role == "helper":
            require(value.startswith(("outputs/goalspec-benchmarks-tools/", "outputs/goalspec-v4-tools/",
                "scripts/goalspec-", "research/goalspec/scripts/", "research/goalspec/src/goalspec/",
                "research/goalspec/tests/")), "Helper must be an explicitly named benchmark source")
        else:
            require(value.startswith(("research/goalspec/runs/", "research/goalspec/reports/", "outputs/")) or
                    (role == "metadata" and value in {"docs/AI_HANDOFF.md", "docs/ENGINEERING_LOG.md"}), "Source is outside results roots")
        lowered = value.lower()
        require(not ("apigen" in lowered and path.name in {"scores.jsonl", "checkpoints.jsonl", "public-cases.json", "records.jsonl"}), "Large raw APIGen rows are external inputs")
        digest = sha256(path)
        require(expected is None or digest == expected, f"Frozen hash mismatch: {value}")
        files[value] = {"path": path, "role": role, "sha256": digest, "bytes": path.stat().st_size}

    for entry in plan.get("files", []):
        require(entry.get("role") in ROLES, "Unknown bundle file role")
        add(entry["path"], entry["role"], entry.get("sha256"))
    tau_dir = located(root, plan["tauAnalysis"])
    report, manifest = read(tau_dir / "report.json"), read(tau_dir / "manifest.json")
    require(report.get("version") == "official-tau-v4-report-v1", "Closed official native analysis required")
    require(manifest.get("outputs", {}).get("report.json") == sha256(tau_dir / "report.json"), "Official report manifest mismatch")
    for name in ("report.json", "manifest.json"):
        require((tau_dir / name).relative_to(root).as_posix() in files, "Explicitly allowlist official report and manifest")
    native = plan["native"]
    directory = located(root, native["directory"])
    payload = (directory / "outcomes.jsonl").read_bytes()
    require(payload.endswith(b"\n") and all(line.strip() for line in payload.splitlines()), "Native outcomes are not complete JSONL")
    rows = [json.loads(line) for line in payload.splitlines()]
    validate_rows(rows, native.get("expectedTrials", 112))
    reported = {row["runId"]: row for row in report["trials"]}
    require(set(reported) == {r["runId"] for r in rows}, "Native report/outcome run IDs differ")
    for row in rows:
        require(all(reported[row["runId"]].get(k) == row.get(k) for k in ("arm", "domain", "taskId", "trial", "seed", "success")), "Native report/outcome association differs")
    sources = {str(Path(path).resolve()): digest for path, digest in manifest["sources"].items()}

    def native_add(path, role):
        expected = sources.get(str(path.resolve()))
        require(expected is not None, "Native source is not bound by closed official report manifest")
        add(path.relative_to(root).as_posix(), role, expected)

    for name in NATIVE_METADATA:
        native_add(directory / name, "native-metadata")
    for row in rows:
        suffix = "-stage-abort.json" if row.get("termination") == "stage_abort" else ".json"
        native_add(directory / f"{row['runId']}{suffix}", "native-trace")
    require(native.get("events"), "Explicit closed native service event path is required")
    for value in native["events"]:
        native_add(located(root, value), "native-events")
    archive_path = located(root, native["sourceArchive"])
    frozen_plan = read(directory / "dispatch-plan.json")
    add(native["sourceArchive"], "source-freeze", frozen_plan["sourceArchiveSha256"])
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Source freeze contains duplicate members")
        require(set(names) == set(frozen_plan["sources"]), "Source archive differs from frozen member manifest")
        for name in names:
            safe_name(name.rstrip("/"), pinned_native_source=True)
            with archive.open(name) as stream:
                require(hash_stream(stream) == frozen_plan["sources"][name]["sha256"], "Frozen source archive member changed")
            require(archive.getinfo(name).file_size == frozen_plan["sources"][name]["bytes"], "Frozen source archive member length changed")
    plan_relative = plan_path.relative_to(root).as_posix()
    if plan_relative not in files:
        add(plan_relative, "plan")
    limit = plan.get("maximumUncompressedBytes", 2 * 1024**3)
    require(isinstance(limit, int) and not isinstance(limit, bool) and 0 < limit <= 8 * 1024**3, "Invalid explicit bundle size allowance")
    require(sum(item["bytes"] for item in files.values()) <= limit, "Bundle exceeds explicit size allowance")
    return files, rows, directory / "outcomes.jsonl"


def generate(root, plan_path, output, outcomes_export=None):
    root, plan_path, output = Path(root).resolve(), Path(plan_path).resolve(), Path(output).resolve()
    require(plan_path.is_relative_to(root) and output.is_relative_to(root / "outputs"), "Plan and bundle must stay in project results paths")
    receipt_path = output.with_suffix(output.suffix + ".receipt.json")
    require(output.suffix == ".zip" and not output.exists() and not receipt_path.exists(), "Bundle/receipt must be new ZIP paths")
    plan = read(plan_path)
    files, rows, outcomes = collect(root, plan, plan_path)
    if outcomes_export is not None:
        export_path = Path(outcomes_export).resolve()
        require(export_path.is_relative_to(root / "research/goalspec/runs"), "Outcome export must be a new research results directory")
        for path in export_outcomes(outcomes, export_path, rows):
            name = path.relative_to(root).as_posix()
            require(name not in files, "Outcome export duplicates bundle input")
            files[name] = {"path": path, "role": "lossless-outcomes-export", "sha256": sha256(path), "bytes": path.stat().st_size}
    require(sum(item["bytes"] for item in files.values()) <= plan.get("maximumUncompressedBytes", 2 * 1024**3), "Bundle with outcome export exceeds explicit size allowance")
    manifest = {"version": VERSION, "label": "Results bundle; pinned upstream dependencies and raw APIGen public data are external inputs",
        "providerCalls": 0, "databaseWrites": 0, "nativeOutcomes": len(rows),
        "sourceFreezeScope": "Exact original source.zip includes selected hash-bound native source files, not a full upstream checkout or installed dependencies.",
        "externalInputs": plan["externalInputs"], "inputPlanSha256": sha256(plan_path),
        "files": {name: {k: v for k, v in item.items() if k != "path"} for name, item in sorted(files.items())}}
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("BUNDLE-MANIFEST.json", manifest_bytes)
        for name, item in sorted(files.items()):
            archive.write(item["path"], name)
    with zipfile.ZipFile(output) as archive:
        require(set(archive.namelist()) == set(files) | {"BUNDLE-MANIFEST.json"}, "ZIP membership differs")
        require(archive.read("BUNDLE-MANIFEST.json") == manifest_bytes, "ZIP manifest bytes differ")
        for name, item in files.items():
            with archive.open(name) as stream:
                require(hash_stream(stream) == item["sha256"], f"ZIP roundtrip hash mismatch: {name}")
            require(sha256(item["path"]) == item["sha256"], "Source changed during packaging")
    receipt = {"version": VERSION, "zip": str(output), "zipSha256": sha256(output), "zipBytes": output.stat().st_size,
        "fileCount": len(files), "uncompressedBytes": sum(item["bytes"] for item in files.values()),
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "everyMemberRoundtripVerified": True,
        "sourceBytesUnchanged": True, "providerCalls": 0, "databaseWrites": 0,
        "generatorSha256": sha256(__file__), "inputPlanSha256": sha256(plan_path)}
    write_new(receipt_path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--outcomes-export", type=Path)
    args = parser.parse_args()
    print(json.dumps(generate(args.root, args.plan, args.output, args.outcomes_export)))


if __name__ == "__main__":
    main()
