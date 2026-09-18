"""Build and verify a local, explicitly allowlisted GoalSpec artifact archive.

No network, provider, database, subprocess, or credential APIs are used.
Run --check-inputs before completion; run the archive build only after root
confirms that all paid phases, exports, analyses, and documentation are final.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import stat
import sys
from datetime import datetime, timezone
import zipfile

BLOCK = 1024 * 1024
OPENAI_KEY = re.compile(rb"\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}")
AUTH_TOKEN_VALUE = re.compile(rb'"(?:api[_-]?key|auth[_-]?token|gateway[_-]?token|authorization|password|secret|token)"\s*:\s*"[A-Za-z0-9_./+=:-]{24,}', re.IGNORECASE)
TEXT_SUFFIXES = {".ts", ".py", ".json", ".jsonl", ".ndjson", ".sql", ".md", ".toml", ".lock", ".ps1", ".sh", ".yaml", ".yml", ".txt", ".log", ".csv", ".html", ".svg", ".otlp"}
ALLOWED_CATEGORIES = {"analysis", "artifact_export", "documentation", "verification"}
DENIED_PARTS = {".git", ".aws", ".ssh", ".codex", ".venv", "node_modules", "__pycache__",
    ".pytest_cache", ".ruff_cache", "credentials", "secrets", "pg_wal", "pg_stat"}
DENIED_SUFFIXES = {".pem", ".key", ".pfx", ".p12", ".dpapi", ".clixml", ".sqlite", ".sqlite3", ".db", ".exe", ".dll", ".pyc"}
SOURCE_TREES = ("src/lib/goalspec", "src/lib/goalspec-adapters", "services/goalspec-runtime",
    "research/goalspec/src", "research/goalspec/tests", "research/goalspec/scripts")
SOURCE_SUFFIXES = {".ts", ".py", ".json", ".sql", ".md", ".toml", ".lock", ".ps1", ".sh", ".yaml", ".yml", ".txt", ".jinja", ".jinja2"}
ANALYSIS_NAMES = {"evaluation_v1.py", "metrics.py", "reporting.py", "evaluate_v1.py", "audit_candidate_union.py"}
EXPORT_NAMES = {"training_export.py", "export_native_training.py", "export_otel.py", "export_parquet.py",
    "archive_public_evidence.py", "archive_v1_validation.py", "public_results.py", "plot_public_results.py",
    "goalspec-export-repository.ts", "goalspec-telemetry.ts"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def digest_stream(stream, *, scan_path=None):
    digest, size = hashlib.sha256(), 0
    tail = b""
    for block in iter(lambda: stream.read(BLOCK), b""):
        if scan_path and (OPENAI_KEY.search(tail + block) or AUTH_TOKEN_VALUE.search(tail + block)):
            raise ValueError(f"Credential-like key detected in included text: {scan_path}")
        tail = (tail + block)[-128:]
        digest.update(block)
        size += len(block)
    return {"bytes": size, "sha256": digest.hexdigest()}


def digest_file(path, *, scan_path=None):
    with path.open("rb") as source:
        return digest_stream(source, scan_path=scan_path)


def source_category(name):
    path = PurePosixPath(name)
    if name.startswith("docs/") or path.suffix == ".md":
        return "execution" if name.startswith("research/goalspec/.benchmarks/tau3/data/") else "documentation"
    if "/tests/" in name or path.name.endswith(".test.ts"):
        return "verification"
    if path.name in EXPORT_NAMES:
        return "artifact_export"
    if path.name in ANALYSIS_NAMES:
        return "analysis"
    return "execution"


def relative_path(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ValueError(f"Expected repository-relative POSIX path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in name.split("/")):
        raise ValueError(f"Unsafe relative path: {name}")
    return path


def deny_path(name):
    path = relative_path(name)
    lowered = [part.lower() for part in path.parts]
    if any(part in DENIED_PARTS or part.startswith(".env") or "credential" in part for part in lowered):
        raise ValueError(f"Excluded secret/cache/runtime path: {name}")
    if path.suffix.lower() in DENIED_SUFFIXES or lowered[-1] in {".npmrc", "id_rsa", "id_ed25519"}:
        raise ValueError(f"Excluded secret/cache/runtime file: {name}")
    if re.search(r"(?:^|[._-])(?:credentials?|secrets?|passwords?|api[-_]?keys?|access[-_]?tokens?|auth[-_]?tokens?)(?:[._-]|$)", lowered[-1]):
        raise ValueError(f"Credential-like filename excluded: {name}")
    if lowered[-1].endswith(".lock") and lowered[-1] not in {"uv.lock"}:
        raise ValueError(f"Active lock file cannot be packaged: {name}")


def safe_path(root, name, *, file=True):
    deny_path(name)
    path = root.joinpath(*relative_path(name).parts)
    cursor = root
    for part in path.relative_to(root).parts:
        cursor = cursor / part
        if cursor.is_symlink() or (hasattr(cursor, "is_junction") and cursor.is_junction()):
            raise ValueError(f"Link or junction excluded: {name}")
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise ValueError(f"Path escapes repository: {name}")
    if file and not stat.S_ISREG(path.stat().st_mode):
        raise ValueError(f"Not a regular file: {name}")
    return path


def artifact_root_allowed(name):
    parts = relative_path(name).parts
    if parts[:3] == ("research", "goalspec", "runs") and len(parts) >= 4:
        run = parts[3].lower()
        if run.startswith(("pg", "pytest", "test-", "windows-sdk")) or run.endswith("pytest"):
            raise ValueError(f"Runtime/test directory excluded: {name}")
        return
    if parts[:4] == ("research", "goalspec", "reports", "2026-09-14-local-v1"):
        return
    raise ValueError(f"Artifact group must select one named run or this report directory: {name}")


def collect_inputs(root, specification):
    selected, groups, missing = {}, [], []
    for group in specification.get("groups", []):
        label = group["name"]
        name = group.get("path")
        if not name:
            missing.append(f"{label}: no path supplied")
            continue
        artifact_root_allowed(name)
        try:
            path = safe_path(root, name, file=False)
        except FileNotFoundError:
            missing.append(f"{label}: missing {name}")
            continue
        matches = []
        if path.is_file():
            matches = [path]
        else:
            patterns = group.get("patterns", [])
            if not patterns:
                raise ValueError(f"Group {label} needs explicit filename patterns")
            for pattern in patterns:
                if "/" in pattern or "\\" in pattern or pattern in {"*", "**"}:
                    raise ValueError(f"Group {label} has an unbounded pattern: {pattern}")
                finder = path.rglob if group.get("recursive", False) else path.glob
                matches.extend(candidate for candidate in finder(pattern) if candidate.is_file())
            for required in group.get("requiredFiles", []):
                required_path = path.joinpath(*relative_path(required).parts)
                if not required_path.is_file():
                    missing.append(f"{label}: missing {name}/{required}")
                elif required_path not in matches:
                    matches.append(required_path)
        exclude = set(group.get("excludeFiles", []))
        matches = [candidate for candidate in matches if candidate.relative_to(path).as_posix() not in exclude] if path.is_dir() else matches
        matches = sorted(set(matches))
        if len(matches) < group.get("minimumFiles", 1):
            missing.append(f"{label}: found {len(matches)} files, require {group.get('minimumFiles', 1)} in {name}")
        for candidate in matches:
            relative = candidate.relative_to(root).as_posix()
            safe_path(root, relative)
            if candidate.suffix == ".zip" and relative != specification["freezeDirectory"] + "/source.zip":
                raise ValueError(f"Only the explicitly frozen source.zip may be nested: {relative}")
            selected.setdefault(relative, {"path": candidate, "groups": []})["groups"].append(label)
        groups.append({"name": label, "path": name, "files": len(matches)})
    return selected, groups, missing


def verify_freeze(root, specification):
    directory = specification["freezeDirectory"]
    manifest_path = safe_path(root, directory + "/manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    declared_hash = safe_path(root, directory + "/manifest.sha256").read_text(encoding="ascii").split()[0]
    if digest_file(manifest_path)["sha256"] != declared_hash:
        raise ValueError("Frozen manifest hash mismatch")
    if hashlib.sha256(canonical(manifest["sources"])).hexdigest() != manifest["sourceTreeHash"]:
        raise ValueError("Frozen source map hash mismatch")
    archive = safe_path(root, directory + "/" + manifest["archive"]["path"])
    if digest_file(archive) != {key: manifest["archive"][key] for key in ("bytes", "sha256")}:
        raise ValueError("Frozen source.zip integrity mismatch")
    with zipfile.ZipFile(archive) as source_zip:
        names = source_zip.namelist()
        if len(names) != len(set(names)) or set(names) != set(manifest["sources"]):
            raise ValueError("Frozen source.zip membership mismatch")
        for name, metadata in manifest["sources"].items():
            deny_path(name)
            with source_zip.open(name) as source:
                if digest_stream(source, scan_path=name if PurePosixPath(name).suffix in TEXT_SUFFIXES else None) != {key: metadata[key] for key in ("bytes", "sha256")}:
                    raise ValueError(f"Frozen source member mismatch: {name}")
    changes, overlays = [], {}
    current_names = set(manifest["sources"])
    for tree in SOURCE_TREES:
        directory_path = safe_path(root, tree, file=False)
        current_names.update(path.relative_to(root).as_posix() for path in directory_path.rglob("*")
            if path.is_file() and path.suffix in SOURCE_SUFFIXES and "__pycache__" not in path.parts)
    current_names.update(path.relative_to(root).as_posix() for path in (root / "scripts").glob("goalspec-*")
        if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    current_names.update(path.relative_to(root).as_posix() for path in (root / "docs/goalspec").rglob("*")
        if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    current_names.update(specification.get("additionalCurrentSourceFiles", []))
    for name in sorted(current_names):
        before = manifest["sources"].get(name)
        category = before["category"] if before else source_category(name)
        try:
            path = safe_path(root, name)
            after = digest_file(path)
        except FileNotFoundError:
            after, path = None, None
        changed = (before["sha256"] if before else None) != (after["sha256"] if after else None)
        if changed and category not in ALLOWED_CATEGORIES:
            raise ValueError(f"Protected execution source changed: {name}")
        if changed:
            changes.append(dict(path=name, category=category, change="added" if before is None else "deleted" if after is None else "modified",
                beforeSha256=before["sha256"] if before else None, afterSha256=after["sha256"] if after else None))
        if category in ALLOWED_CATEGORIES and path:
            overlays[name] = {"path": path, "category": category, **after}
    for label, record in manifest["inputs"].items():
        path = safe_path(root, record["path"])
        if digest_file(path) != {key: record[key] for key in ("bytes", "sha256")}:
            raise ValueError(f"Frozen input changed: {label}: {record['path']}")
    return manifest, changes, overlays


def ensure_closed(root, specification):
    for name in specification.get("mustBeAbsent", []):
        relative_path(name)
        if root.joinpath(*PurePosixPath(name).parts).exists():
            raise ValueError(f"Final package requires absent active lock: {name}")


def add_bytes(archive, name, content):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type, info.external_attr = zipfile.ZIP_DEFLATED, 0o100644 << 16
    archive.writestr(info, content)
    return {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "kind": "package_metadata"}


def build(root, inputs_path, specification, output):
    ensure_closed(root, specification)
    selected, groups, missing = collect_inputs(root, specification)
    if missing:
        raise ValueError("Missing required inputs:\n" + "\n".join(missing))
    frozen, changes, overlays = verify_freeze(root, specification)
    required_originals = {specification["freezeDirectory"] + "/" + name for name in ("manifest.json", "manifest.sha256", "source.zip")}
    required_originals.update(record["path"] for record in frozen["inputs"].values())
    absent_originals = required_originals - set(selected)
    if absent_originals:
        raise ValueError("Allowlist omits frozen evidence: " + ", ".join(sorted(absent_originals)))
    redactions = []
    for redaction in specification.get("redactedCopies", []):
        original_name, share_name = redaction["originalPath"], redaction["sharePath"]
        if original_name not in selected or not redaction.get("reason"):
            raise ValueError(f"Redaction must identify an included original and reason: {original_name}")
        artifact_root_allowed(share_name)
        share = safe_path(root, share_name)
        original = selected.pop(original_name)
        if share == original["path"]:
            raise ValueError(f"Redacted copy cannot overwrite its original: {original_name}")
        redactions.append(dict(originalPath=original_name, sharePath=share_name, reason=redaction["reason"],
            originalPreservedLocally=True, original=digest_file(original["path"]), share=digest_file(share)))
        selected[share_name] = dict(path=share, groups=original["groups"])
    suffixes = ("", ".sha256", ".manifest.json", ".verification.json")
    outputs = [Path(str(output) + suffix) for suffix in suffixes]
    if not output.parent.is_dir():
        raise ValueError(f"Output directory does not exist: {output.parent}")
    if any(path.exists() for path in outputs):
        raise ValueError("Every output must be new: " + ", ".join(str(path) for path in outputs if path.exists()))
    if output.suffix.lower() != ".zip":
        raise ValueError("Output must have .zip extension")
    if any(path.resolve() in {item.resolve() for item in outputs} for path in [entry["path"] for entry in selected.values()]):
        raise ValueError("Output self-inclusion is forbidden")
    source_files = {"repository/" + name: {**entry, "source": name, "kind": "original_artifact"} for name, entry in selected.items()}
    for name, entry in overlays.items():
        source_files["current-source/" + name] = {**entry, "source": name, "kind": "current_allowed_source"}
    entries = []
    for name, entry in source_files.items():
        entry["metadata"] = digest_file(entry["path"], scan_path=entry["source"] if entry["path"].suffix in TEXT_SUFFIXES else None)
        entry["stat"] = (entry["path"].stat().st_size, entry["path"].stat().st_mtime_ns)
    ensure_closed(root, specification)
    print(json.dumps({"stage": "writing", "sourceFiles": len(source_files), "sourceBytes": sum(entry['metadata']['bytes'] for entry in source_files.values())}), flush=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for index, (name, entry) in enumerate(sorted(source_files.items()), 1):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type, info.external_attr = zipfile.ZIP_DEFLATED, 0o100644 << 16
            digest, size = hashlib.sha256(), 0
            with entry["path"].open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                for block in iter(lambda: source.read(BLOCK), b""):
                    target.write(block)
                    digest.update(block)
                    size += len(block)
            if dict(bytes=size, sha256=digest.hexdigest()) != entry["metadata"]:
                raise ValueError(f"Input changed during archive build: {entry['source']}")
            entries.append(dict(path=name, sourcePath=entry["source"], kind=entry["kind"], groups=entry.get("groups", []), **entry["metadata"]))
            if index % 250 == 0:
                print(json.dumps({"stage": "writing", "completed": index, "total": len(source_files)}), flush=True)
        disclosure = dict(schemaVersion=1, sourceTreeHash=frozen["sourceTreeHash"], protectedExecutionUnchanged=True,
            frozenInputsUnchanged=True, disclosedAllowedChanges=changes,
            currentSourceFiles=[dict(path=name, category=entry["category"], bytes=entry["bytes"], sha256=entry["sha256"]) for name, entry in sorted(overlays.items())])
        entries.append(add_bytes(archive, "CURRENT_SOURCE_CHANGES.json", json_bytes(disclosure)))
        entries.append(add_bytes(archive, "REDACTION_RECEIPTS.json", json_bytes(dict(redactedCopies=redactions))))
        entries.append(add_bytes(archive, "PACKAGE_INPUTS.json", json_bytes(specification)))
        readme = ("# GoalSpec local artifact package\n\n"
            "This archive preserves original artifacts under repository/ using their original repository-relative paths. "
            "The frozen runtime and dependencies are in repository/" + specification["freezeDirectory"] + "/source.zip. "
            "Extract that archive to reconstruct the exact frozen source. Current allowed analysis, export, documentation, "
            "and verification files are under current-source/ and may be overlaid at their repository-relative paths "
            "when reproducing the final analyses. CURRENT_SOURCE_CHANGES.json discloses every allowed change detected. "
            "Protected execution bytes and frozen inputs were verified unchanged.\n\n"
            "PACKAGE_MANIFEST.json records each payload path, size, and SHA256. It excludes its own self-hash; "
            "the external .manifest.json is byte-identical and the external .verification.json records its hash. "
            "The external .sha256 covers the entire ZIP. Every archived member was read back and hash-verified.\n\n"
            "No credentials, dependency installations, database runtime/data directories, temporary tests, "
            "or unrelated historical runs are included. Original files are included verbatim except any explicit "
            "share copies listed in REDACTION_RECEIPTS.json, which retains original hashes and reasons. "
            "Unknown charge reservations and all unsuccessful outcomes remain present. Report instructions and "
            "manifests describe dependencies and any paid reproduction steps; this packager makes no network or paid calls.\n")
        entries.append(add_bytes(archive, "PACKAGE_README.md", readme.encode("utf-8")))
        manifest = dict(schemaVersion=1, createdAtUtc=datetime.now(timezone.utc).isoformat(),
            packageLabel=specification["packageLabel"], inputsManifestSource=inputs_path.relative_to(root).as_posix(),
            frozenSourceTreeHash=frozen["sourceTreeHash"], originalFilesPreservedVerbatim=not redactions,
            redactionReceipts="REDACTION_RECEIPTS.json", actualProductionDataIncluded=False,
            manifestSelfHashExcluded=True, entries=sorted(entries, key=lambda row: row["path"]), groups=groups)
        manifest_content = json_bytes(manifest)
        manifest_record = add_bytes(archive, "PACKAGE_MANIFEST.json", manifest_content)
    ensure_closed(root, specification)
    for entry in source_files.values():
        if (entry["path"].stat().st_size, entry["path"].stat().st_mtime_ns) != entry["stat"]:
            raise ValueError(f"Input changed while packaging: {entry['source']}")
    print(json.dumps({"stage": "verifying", "archiveMembers": len(entries)+1}), flush=True)
    expected = {entry["path"]: entry for entry in entries + [manifest_record]}
    with zipfile.ZipFile(output) as archive:
        if len(archive.namelist()) != len(expected) or set(archive.namelist()) != set(expected):
            raise ValueError("Final archive membership mismatch")
        for name, record in expected.items():
            with archive.open(name) as member:
                if digest_stream(member) != {key: record[key] for key in ("bytes", "sha256")}:
                    raise ValueError(f"Final archive member hash mismatch: {name}")
    archive_metadata = digest_file(output)
    with outputs[1].open("x", encoding="ascii") as target:
        target.write(archive_metadata["sha256"] + "  " + output.name + "\n")
    with outputs[2].open("xb") as target:
        target.write(manifest_content)
    verification = dict(schemaVersion=1, verifiedAtUtc=datetime.now(timezone.utc).isoformat(),
        archive=output.name, **archive_metadata, verifiedMembers=len(expected),
        manifestSha256=manifest_record["sha256"], originalArtifactCount=len(selected),
        currentAllowedSourceCount=len(overlays), protectedExecutionUnchanged=True,
        frozenInputsUnchanged=True, allArchivedHashesVerified=True, budgetLocksAbsent=True,
        disclosedAllowedChanges=changes)
    with outputs[3].open("xb") as target:
        target.write(json_bytes(verification))
    print(json.dumps(verification), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--inputs", type=Path, default=Path(__file__).with_name("package-inputs.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-inputs", action="store_true", help="List exact input omissions without opening the budget or writing a ZIP")
    parser.add_argument("--final-confirmed", action="store_true", help="Use only after root confirms paid phases, exports, analyses, and docs complete")
    args = parser.parse_args()
    root, inputs_path = args.root.resolve(strict=True), args.inputs.resolve(strict=True)
    if not inputs_path.is_relative_to(root):
        parser.error("Input manifest must be under repository root")
    specification = json.loads(inputs_path.read_text(encoding="utf-8"))
    if specification.get("schemaVersion") != 1:
        parser.error("Unsupported inputs manifest version")
    if args.check_inputs:
        selected, groups, missing = collect_inputs(root, specification)
        print(json.dumps(dict(selectedFiles=len(selected), groups=groups, missingInputs=missing), indent=2))
        return 1 if missing else 0
    if not args.output or not args.final_confirmed:
        parser.error("Build requires --output NEW_ZIP and --final-confirmed after root confirms completion")
    build(root, inputs_path, specification, args.output.resolve())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, FileNotFoundError, FileExistsError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
