"""Package explicit official v3 artifacts after root confirms all work has closed.

Standard library only. No network, provider, database, or subprocess calls.
Inventory mode lists names only; it never hashes or opens the shared journal.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath

BLOCK = 1024 * 1024
REPORT = "research/goalspec/reports/2026-09-15-local-v3"
DENIED_DIRS = {".git", ".aws", ".ssh", ".codex", ".venv", "node_modules", "__pycache__",
               ".pytest_cache", ".ruff_cache", "credentials", "secrets", "pg_wal", "pg_stat", "pgdata", "postgres-data", "database-data"}
DENIED_SUFFIXES = {".pem", ".key", ".pfx", ".p12", ".dpapi", ".clixml", ".sqlite", ".sqlite3", ".db", ".exe", ".dll", ".pyc"}
TEXT_SUFFIXES = {".ts", ".py", ".json", ".jsonl", ".ndjson", ".sql", ".md", ".toml", ".lock", ".ps1", ".sh",
                 ".yaml", ".yml", ".txt", ".log", ".csv", ".html", ".svg", ".xml", ".sha256"}
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".sql", ".ps1", ".sh"}
KEY = re.compile(rb"(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")
TOKEN = re.compile(rb'"(?:api[_-]?key|auth[_-]?token|gateway[_-]?token|authorization|password|secret|token)"\s*:\s*"[A-Za-z0-9_./+=:-]{24,}', re.IGNORECASE)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def relative(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ValueError("Expected a repository-relative POSIX path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in name.split("/")):
        raise ValueError(f"Unsafe path: {name}")
    return path


def denied_directory(name):
    return name.lower() in DENIED_DIRS or name.lower().startswith(("pytest", ".env"))


def check_name(name):
    path = relative(name)
    if (any(denied_directory(part) for part in path.parts[:-1])
            or path.name.lower() in DENIED_DIRS or path.name.lower().startswith(".env")
            or any("credential" in part.lower() for part in path.parts)):
        raise ValueError(f"Excluded secret/cache path: {name}")
    if path.suffix.lower() in DENIED_SUFFIXES or path.name.lower() in {".npmrc", "id_rsa", "id_ed25519"}:
        raise ValueError(f"Excluded secret/runtime file: {name}")
    if re.search(r"(?:^|[._-])(?:secrets?|passwords?|api[-_]?keys?|access[-_]?tokens?|auth[-_]?tokens?)(?:[._-]|$)", path.name.lower()):
        raise ValueError(f"Credential-like filename excluded: {name}")
    if path.suffix == ".lock" and path.name != "uv.lock":
        raise ValueError(f"Active lock cannot be packaged: {name}")


def text_name(name):
    path = PurePosixPath(name)
    return path.suffix.lower() in TEXT_SUFFIXES or path.name.lower() in {"license", "notice", "copying"}


def safe_path(root, name, *, directory=False):
    check_name(name)
    cursor = root
    for part in relative(name).parts:
        cursor /= part
        if cursor.is_symlink() or (hasattr(cursor, "is_junction") and cursor.is_junction()):
            raise ValueError(f"Link or junction excluded: {name}")
    result = cursor.resolve(strict=True)
    if not result.is_relative_to(root):
        raise ValueError(f"Path escapes repository: {name}")
    if directory and not result.is_dir():
        raise ValueError(f"Expected directory: {name}")
    if not directory and not stat.S_ISREG(result.stat().st_mode):
        raise ValueError(f"Expected regular file: {name}")
    return result


def artifact_root(name):
    parts = relative(name).parts
    if parts[:3] == ("research", "goalspec", "runs") and len(parts) >= 4:
        if parts[3].lower().startswith(("pg", "pytest", "test-", "windows-sdk")):
            raise ValueError(f"Runtime/test directory excluded: {name}")
        return
    if name == REPORT or name.startswith(REPORT + "/"):
        return
    raise ValueError(f"Select one exact named run or v3 report path: {name}")


def paths_in(directory, recursive):
    # Never traverse a broad repository/home root or excluded child trees.
    for base, dirs, files in os.walk(directory, followlinks=False):
        admitted = []
        for name in sorted(dirs) if recursive else []:
            child = Path(base) / name
            if (not denied_directory(name) and not child.is_symlink()
                    and not (hasattr(child, "is_junction") and child.is_junction())):
                admitted.append(name)
        dirs[:] = admitted
        for name in sorted(files):
            yield Path(base) / name


def collect(root, specification):
    selected, groups, missing = {}, [], []
    for group in specification["groups"]:
        name = group.get("path")
        if not name:
            missing.append(f"{group['name']}: final path not supplied")
            continue
        artifact_root(name)
        candidate = root.joinpath(*relative(name).parts)
        if not candidate.exists():
            missing.append(f"{group['name']}: missing {name}")
            continue
        directory = candidate.is_dir()
        path = safe_path(root, name, directory=directory)
        if directory:
            patterns = group.get("patterns", [])
            if not patterns or any("/" in p or "\\" in p or p in {"*", "**"} for p in patterns):
                raise ValueError(f"Explicit filename patterns required: {group['name']}")
            matches = {p for p in paths_in(path, group.get("recursive", False)) if any(fnmatch.fnmatchcase(p.name, pattern) for pattern in patterns)}
            for required in group.get("requiredFiles", []):
                required_path = path.joinpath(*relative(required).parts)
                if required_path.is_file():
                    matches.add(required_path)
                else:
                    missing.append(f"{group['name']}: missing {name}/{required}")
        else:
            matches = {path}
        if len(matches) < group.get("minimumFiles", 1):
            missing.append(f"{group['name']}: found {len(matches)} files")
        for item in sorted(matches):
            key = item.relative_to(root).as_posix()
            selected.setdefault(key, {"path": safe_path(root, key), "groups": []})["groups"].append(group["name"])
        groups.append({"name": group["name"], "path": name, "files": len(matches)})
    source_ids = set()
    for source in specification["sourceArchives"]:
        if source["id"] in source_ids:
            raise ValueError("Duplicate source archive ID")
        source_ids.add(source["id"])
        name = source.get("directory")
        if not name:
            missing.append(f"Source {source['id']}: final directory not supplied")
            continue
        artifact_root(name)
        for basename in ("manifest.json", "manifest.sha256", "source.zip", "inputs.zip"):
            key = name + "/" + basename
            try:
                selected.setdefault(key, {"path": safe_path(root, key), "groups": []})["groups"].append("source:" + source["id"])
            except FileNotFoundError:
                missing.append(f"Missing source artifact: {key}")
    for entry in specification.get("looseFiles", []):
        name = entry["path"]
        if not entry.get("purpose"):
            raise ValueError("Every explicit loose file requires a stated purpose")
        permitted = (name.startswith("docs/goalspec/") or name in {"docs/AI_HANDOFF.md", "docs/DECISIONS.md", "docs/ENGINEERING_LOG.md"}
                     or name.startswith(REPORT + "/")
                     or name == "research/goalspec/reports/2026-09-15-local-v2/README.md"
                     or name in {"research/goalspec/.benchmarks/tau3/" + base for base in ("LICENSE", "README.md", "pyproject.toml", "uv.lock")})
        if not permitted:
            raise ValueError(f"Unsupported loose-file scope: {name}")
        try:
            selected.setdefault(name, {"path": safe_path(root, name), "groups": []})["groups"].append("loose:" + entry["purpose"])
        except FileNotFoundError:
            missing.append("Missing explicit loose file: " + name)
    for entry in specification.get("currentAllowedSources", []):
        name = entry["path"]
        try:
            selected.setdefault(name, {"path": safe_path(root, name), "groups": []})["groups"].append("current_allowed_analysis_export_source")
        except FileNotFoundError:
            missing.append("Missing current allowed analysis/export source: " + name)
    allowed_zips = {source["directory"] + "/" + base for source in specification["sourceArchives"] if source.get("directory") for base in ("source.zip", "inputs.zip")}
    if len({name.casefold() for name in selected}) != len(selected):
        raise ValueError("Selected package paths have a case-fold collision")
    if any(PurePosixPath(name).suffix.lower() == ".zip" and name not in allowed_zips for name in selected):
        raise ValueError("Only explicitly declared source and frozen-input ZIPs may be embedded")
    if specification.get("finalSourceId") not in source_ids:
        missing.append("Final source archive ID not supplied")
    accounting = specification.get("accountingCopy", {})
    for key in ("journalPath", "sha256", "closureReceiptPath", "closureReceiptSha256"):
        if not accounting.get(key):
            missing.append(f"Final accounting {key} not supplied")
    for key in ("manifestPath", "manifestSha256"):
        if not specification.get("portableArchive", {}).get(key):
            missing.append(f"Final portable archive {key} not supplied")
    return selected, groups, missing


def digest_stream(stream, scan_name=None, target=None):
    digest, size, tail = hashlib.sha256(), 0, b""
    for block in iter(lambda: stream.read(BLOCK), b""):
        if scan_name and (KEY.search(tail + block) or TOKEN.search(tail + block)):
            raise ValueError(f"Credential-like value detected in included text: {scan_name}")
        tail = (tail + block)[-256:]
        digest.update(block)
        size += len(block)
        if target is not None:
            target.write(block)
    return {"bytes": size, "sha256": digest.hexdigest()}


def digest_file(path, scan=False):
    with path.open("rb") as stream:
        return digest_stream(stream, path.as_posix() if scan else None)


def ensure_closed(root, specification):
    if specification.get("finalized") is not True:
        raise ValueError("Root must finalize artifact paths and accounting before building")
    if specification.get("pending"):
        raise ValueError("Final package has unresolved pending inputs or receipts")
    for name in specification["mustBeAbsent"]:
        if root.joinpath(*relative(name).parts).exists():
            raise ValueError(f"Final build requires absent active lock: {name}")


def byte_identity(entry):
    if (not isinstance(entry, dict) or type(entry.get("bytes")) is not int or entry["bytes"] < 0
            or not isinstance(entry.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])):
        raise ValueError("Invalid declared byte/hash identity")
    return {key: entry[key] for key in ("bytes", "sha256")}


def original_input_name(value):
    """Validate historical absolute metadata without dereferencing its old host path."""
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Invalid original input path metadata")
    path = PureWindowsPath(value) if "\\" in value or re.match(r"^[A-Za-z]:", value) else PurePosixPath(value)
    if not path.is_absolute():
        raise ValueError("Original input metadata must retain its absolute historical path")
    parts = [part for part in path.parts if part != path.anchor]
    name = "/".join(parts)
    check_name(name)
    if PurePosixPath(name).suffix.lower() == ".zip":
        raise ValueError("A frozen input cannot conceal another nested ZIP")
    return name


def verify_member_archive(path, expected, label, *, root=None, compare_current=False):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if (len(names) != len(expected) or set(names) != set(expected)
                or len({name.casefold() for name in names}) != len(names)):
            raise ValueError(f"Archive membership or duplicate-name mismatch: {label}")
        for member in archive.infolist():
            name = member.filename
            check_name(name)
            if (member.orig_filename != name or member.is_dir() or member.flag_bits & 1
                    or stat.S_ISLNK(member.external_attr >> 16) or name.lower().endswith(".zip")):
                raise ValueError(f"Unsupported nested archive member: {label}:{name}")
            entry = expected[name]
            identity = byte_identity(entry)
            if member.file_size != identity["bytes"]:
                raise ValueError(f"Declared member size mismatch: {label}:{name}")
            original = entry.get("originalName", name)
            # Frozen input ZIPs have extensionless labels; scan according to
            # their original source name, never by a fabricated path on disk.
            text = text_name(original)
            with archive.open(member) as stream:
                actual = digest_stream(stream, f"{label}:{name}" if text else None)
            if actual != identity:
                raise ValueError(f"Archived member hash mismatch: {label}:{name}")
            if compare_current and entry.get("category") == "execution" and digest_file(safe_path(root, name)) != actual:
                raise ValueError(f"Final protected execution changed: {name}")


def verify_capture(root, source, selected, compare_current=False):
    directory = source["directory"]
    for basename in ("manifest.json", "manifest.sha256", "source.zip", "inputs.zip"):
        if directory + "/" + basename not in selected:
            raise ValueError(f"Allowlist omits captured artifact: {source['id']}:{basename}")
    manifest_path = safe_path(root, directory + "/manifest.json")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("captureProtocol") != "official-tau-stage-freeze-v3":
        raise ValueError("Expected the distinct official v3 source/input capture protocol")
    declared = safe_path(root, directory + "/manifest.sha256").read_text(encoding="ascii").split()[0]
    if digest_file(manifest_path)["sha256"] != declared or source.get("manifestSha256", declared) != declared:
        raise ValueError(f"Source manifest hash mismatch: {source['id']}")
    if (hashlib.sha256(canonical(manifest["sources"])).hexdigest() != manifest["sourceTreeHash"]
            or source.get("sourceTreeHash", manifest["sourceTreeHash"]) != manifest["sourceTreeHash"]):
        raise ValueError(f"Source map hash mismatch: {source['id']}")
    for field, basename in (("archive", "source.zip"), ("inputArchive", "inputs.zip")):
        archive_path = safe_path(root, directory + "/" + basename)
        if manifest[field].get("path") != basename or digest_file(archive_path) != byte_identity(manifest[field]):
            raise ValueError(f"Captured archive hash or path mismatch: {source['id']}:{basename}")
    inputs = {}
    for label, entry in manifest["inputs"].items():
        member = entry.get("archiveMember")
        if entry.get("archived") is not True or not isinstance(member, str) or member in inputs:
            raise ValueError(f"Missing or duplicate frozen input member declaration: {label}")
        check_name(member)
        inputs[member] = {**entry, "originalName": original_input_name(entry.get("path"))}
    verify_member_archive(safe_path(root, directory + "/source.zip"), manifest["sources"], source["id"] + ":source",
                          root=root, compare_current=compare_current)
    verify_member_archive(safe_path(root, directory + "/inputs.zip"), inputs, source["id"] + ":inputs")
    return {"id": source["id"], "directory": directory, "sourceTreeHash": manifest["sourceTreeHash"],
            "manifestSha256": declared, "archiveSha256": manifest["archive"]["sha256"],
            "inputArchiveSha256": manifest["inputArchive"]["sha256"], "members": len(manifest["sources"]),
            "inputMembers": len(inputs), "currentExecutionCompared": compare_current,
            "originalInputPathsDereferenced": False}


def verify_sources(root, specification, selected):
    return [verify_capture(root, source, selected, source["id"] == specification["finalSourceId"])
            for source in specification["sourceArchives"]]


def verify_final_execution(root, specification):
    final = next(source for source in specification["sourceArchives"] if source["id"] == specification["finalSourceId"])
    manifest = json.loads(safe_path(root, final["directory"] + "/manifest.json").read_bytes())
    for name, entry in manifest["sources"].items():
        if entry.get("category") == "execution" and digest_file(safe_path(root, name)) != byte_identity(entry):
            raise ValueError(f"Final protected execution changed during packaging: {name}")


def verify_allowed_sources(root, specification, metadata):
    final = next(source for source in specification["sourceArchives"] if source["id"] == specification["finalSourceId"])
    frozen = json.loads(safe_path(root, final["directory"] + "/manifest.json").read_bytes())["sources"]
    results, seen = [], set()
    for declared in specification.get("currentAllowedSources", []):
        name = declared["path"]
        entry = frozen.get(name)
        if name in seen or not entry or entry.get("category") not in {"analysis", "artifact_export"}:
            raise ValueError(f"Current source is not an allowed frozen analysis/export file: {name}")
        seen.add(name)
        if declared.get("frozenCategory") != entry["category"] or declared.get("frozenSha256") != entry["sha256"]:
            raise ValueError(f"Current source declaration differs from its frozen identity: {name}")
        actual = metadata.get(name, {}).get("sha256")
        current = declared.get("currentSha256")
        if (name not in metadata or not isinstance(current, str) or not re.fullmatch(r"[0-9a-f]{64}", current)
                or actual != current):
            raise ValueError(f"Current allowed source hash differs or is absent: {name}")
        changed = actual != entry["sha256"]
        if changed and (not isinstance(declared.get("amendmentReason"), str) or not declared["amendmentReason"].strip()):
            raise ValueError(f"Changed analysis/export source requires an explicit amendment: {name}")
        results.append({"path": name, "category": entry["category"], "frozenSha256": entry["sha256"],
                        "currentSha256": actual, "changedSinceConfirmationCapture": changed,
                        "amendmentReason": declared.get("amendmentReason")})
    return results


def verify_source_overlays(root, specification, metadata):
    """Disclose new packaging/analysis helpers without relabeling captured files."""
    final = next(source for source in specification["sourceArchives"] if source["id"] == specification["finalSourceId"])
    frozen = json.loads(safe_path(root, final["directory"] + "/manifest.json").read_bytes())["sources"]
    required = {name for name in metadata if PurePosixPath(name).suffix.lower() in SOURCE_SUFFIXES and name not in frozen}
    results, seen = [], set()
    for declared in specification.get("sourceOverlays", []):
        name = declared["path"]
        check_name(name)
        if name in seen or name in frozen or name not in required:
            raise ValueError(f"Overlay must be a unique selected addition, never a captured source: {name}")
        seen.add(name)
        if declared.get("frozenSha256", "missing") is not None:
            raise ValueError(f"New source overlay must explicitly have no frozen identity: {name}")
        actual = metadata[name]["sha256"]
        declared_hash = declared.get("sha256")
        if (not isinstance(declared_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", declared_hash)
                or actual != declared_hash or not isinstance(declared.get("reason"), str) or not declared["reason"].strip()):
            raise ValueError(f"New source overlay requires its exact hash and reason: {name}")
        results.append({"path": name, "sha256": actual, "frozenSha256": None, "reason": declared["reason"],
                        "usedForConfirmationExecution": False})
    if seen != required:
        raise ValueError("Selected new source lacks an explicit overlay: " + ", ".join(sorted(required - seen)))
    return results


def verify_document_overlays(root, specification, metadata):
    """Disclose current documentation while preserving its captured version."""
    final = next(source for source in specification["sourceArchives"] if source["id"] == specification["finalSourceId"])
    frozen = json.loads(safe_path(root, final["directory"] + "/manifest.json").read_bytes())["sources"]
    changed = {name for name, actual in metadata.items() if name in frozen
               and frozen[name].get("category") == "documentation" and actual["sha256"] != frozen[name]["sha256"]}
    results, seen = [], set()
    for declared in specification.get("documentOverlays", []):
        name = declared["path"]
        entry = frozen.get(name)
        if name in seen or name not in metadata or not entry or entry.get("category") != "documentation":
            raise ValueError(f"Document overlay must identify unique selected captured documentation: {name}")
        seen.add(name)
        sha = declared.get("sha256")
        if (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha) or sha != metadata[name]["sha256"]
                or declared.get("frozenSha256") != entry["sha256"]
                or not isinstance(declared.get("reason"), str) or not declared["reason"].strip()):
            raise ValueError(f"Document overlay requires exact frozen/current hashes and reason: {name}")
        results.append({"path": name, "sha256": sha, "frozenSha256": entry["sha256"], "reason": declared["reason"],
                        "changedSinceConfirmationCapture": name in changed})
    if changed - seen:
        raise ValueError("Changed captured documentation lacks an explicit overlay: " + ", ".join(sorted(changed - seen)))
    return results


def zip_info(name):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type, info.external_attr = zipfile.ZIP_DEFLATED, 0o100644 << 16
    return info


def add_bytes(archive, name, content):
    archive.writestr(zip_info(name), content)
    return {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "kind": "package_metadata"}


def build(root, inputs, specification, output):
    ensure_closed(root, specification)
    selected, groups, missing = collect(root, specification)
    if missing:
        raise ValueError("Unresolved final inputs:\n" + "\n".join(missing))
    if inputs.relative_to(root).as_posix() not in selected:
        raise ValueError("Package input specification must itself be selected")
    references = specification.get("priorPackageReferences", [])
    for reference in references:
        checksum = safe_path(root, reference["checksumFile"])
        if checksum.read_text(encoding="ascii").strip().split() != [reference["sha256"], reference["filename"]]:
            raise ValueError("Historical package checksum reference mismatch")
    # Check existing checksum sidecars without reopening or embedding old ZIPs.
    sources = verify_sources(root, specification, selected)
    accounting = specification["accountingCopy"]
    if accounting["journalPath"] not in selected or accounting["closureReceiptPath"] not in selected:
        raise ValueError("Final accounting copy and closure receipt must be explicitly selected")
    if accounting["journalPath"].startswith("research/goalspec/runs/local-evaluation-20260914/"):
        raise ValueError("Package a finalized consistent accounting copy, never the live shared journal")
    if not re.fullmatch(r"[0-9a-f]{64}", accounting["sha256"]):
        raise ValueError("Root-supplied final accounting SHA256 is required")
    if not re.fullmatch(r"[0-9a-f]{64}", accounting["closureReceiptSha256"]):
        raise ValueError("Root-supplied final closure receipt SHA256 is required")
    output = output if output.is_absolute() else root / output
    if output.parent != root / "outputs" or output.suffix != ".zip":
        raise ValueError("Output must be a new ZIP directly under repository outputs/")
    safe_path(root, "outputs", directory=True)
    if output.is_symlink() or (hasattr(output, "is_junction") and output.is_junction()):
        raise ValueError("Output cannot be a link or junction")
    sidecars = [Path(str(output) + suffix) for suffix in ("", ".sha256", ".manifest.json", ".verification.json")]
    if any(path.exists() for path in sidecars):
        raise FileExistsError("ZIP and every verification sidecar must be new")
    metadata = {}
    for name, entry in selected.items():
        metadata[name] = digest_file(entry["path"], text_name(name))
    if metadata[accounting["journalPath"]]["sha256"] != accounting["sha256"]:
        raise ValueError("Copied final journal does not match the root-supplied SHA256")
    if metadata[accounting["closureReceiptPath"]]["sha256"] != accounting["closureReceiptSha256"]:
        raise ValueError("Final closure receipt does not match its root-supplied SHA256")
    for name, expected_hash in specification.get("expectedFileHashes", {}).items():
        if name not in metadata or metadata[name]["sha256"] != expected_hash:
            raise ValueError(f"Pinned package file differs or is absent: {name}")
    allowed_sources = verify_allowed_sources(root, specification, metadata)
    source_overlays = verify_source_overlays(root, specification, metadata)
    document_overlays = verify_document_overlays(root, specification, metadata)
    portable = specification.get("portableArchive", {})
    manifest_name = portable.get("manifestPath")
    if manifest_name not in selected or metadata[manifest_name]["sha256"] != portable.get("manifestSha256"):
        raise ValueError("Final portable archive manifest is not pinned and selected")
    portable_manifest = json.loads(selected[manifest_name]["path"].read_bytes())
    if (portable_manifest.get("contract") != "official-native-v3-archive" or portable_manifest.get("status") != "complete"
            or portable_manifest.get("parquetRoundTripVerified") is not True or portable_manifest.get("originalSourceRoundTripVerified") is not True):
        raise ValueError("Final portable archive is incomplete or unverified")
    expected_portable_files = {f"{table}.{suffix}" for table in ("cohort_manifest", "artifact_file", "artifact_record") for suffix in ("jsonl", "parquet")}
    if len(portable_manifest["files"]) != 6 or {entry["filename"] for entry in portable_manifest["files"]} != expected_portable_files:
        raise ValueError("Portable archive requires exactly three JSONL/Parquet pairs")
    archive_directory = str(PurePosixPath(manifest_name).parent)
    for declared_file in portable_manifest["files"]:
        name = archive_directory + "/" + declared_file["filename"]
        check_name(name)
        if name not in metadata or metadata[name] != byte_identity(declared_file):
            raise ValueError(f"Portable JSONL/Parquet file differs or is absent: {name}")
    ensure_closed(root, specification)
    entries = []
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name, entry in sorted(selected.items()):
            member = "repository/" + name
            with entry["path"].open("rb") as stream, archive.open(zip_info(member), "w", force_zip64=True) as target:
                actual = digest_stream(stream, name if text_name(name) else None, target)
            if actual != metadata[name]:
                raise ValueError(f"Input changed while writing: {name}")
            entries.append({"path": member, "sourcePath": name, "groups": entry["groups"], "kind": "original_artifact", **actual})
        entries.append(add_bytes(archive, "PRIOR_PACKAGE_REFERENCES.json", encoded({"references": references, "embedded": False, "archiveBytesRehashed": False,
            "verification": "Existing checksum sidecars match the preserved historical handoff references"})))
        entries.append(add_bytes(archive, "SOURCE_ARCHIVES.json", encoded(sources)))
        entries.append(add_bytes(archive, "ALLOWED_SOURCE_VERSIONS.json", encoded(allowed_sources)))
        entries.append(add_bytes(archive, "SOURCE_OVERLAYS.json", encoded(source_overlays)))
        entries.append(add_bytes(archive, "DOCUMENTATION_OVERLAYS.json", encoded(document_overlays)))
        entries.append(add_bytes(archive, "PACKAGE_INPUTS.json", encoded(specification)))
        entries.append(add_bytes(archive, "PACKAGE_README.md", (
            b"# GoalSpec official v3 local artifacts\n\nOriginal selected files are preserved under repository/. "
            b"SOURCE_ARCHIVES.json identifies each dispatched stage's source.zip and frozen inputs.zip. "
            b"Both archives remain byte-identical and their declared members are individually verified. "
            b"Original absolute input paths are historical metadata, not extraction destinations. Use manifest archiveMember mappings to restore frozen inputs. "
            b"Use the nominated final capture to reconstruct confirmation execution; development captures intentionally differ. "
            b"Prior v1/v2 ZIPs are separate historical evidence referenced by checksum, never a causal official-task control. "
            b"The journal is a finalized consistent copy supplied after paid work closed. Unknown charges and failed outcomes remain included.\n\n"
            b"PACKAGE_MANIFEST.json lists every payload hash and excludes its own self-hash. External verification records that hash, "
            b"and the .sha256 sidecar covers the complete ZIP. Every member is read back and hash-verified. "
            b"Dependency installations, credentials, database runtime directories, and temporary test trees are excluded.\n")))
        manifest = {"schemaVersion": 1, "createdAtUtc": datetime.now(UTC).isoformat(), "packageLabel": specification["packageLabel"],
                    "sourceArchives": sources, "finalSourceId": specification["finalSourceId"], "priorPackageReferences": references,
                    "portableArchive": portable, "lineageReferences": specification.get("lineageReferences", []),
                    "currentAllowedSources": allowed_sources,
                    "sourceOverlays": source_overlays,
                    "documentOverlays": document_overlays,
                    "accountingCopy": accounting, "originalFilesPreservedVerbatim": True, "manifestSelfHashExcluded": True,
                    "groups": groups, "entries": sorted(entries, key=lambda row: row["path"])}
        content = encoded(manifest)
        manifest_record = add_bytes(archive, "PACKAGE_MANIFEST.json", content)
    ensure_closed(root, specification)
    for name, entry in selected.items():
        if digest_file(entry["path"]) != metadata[name]:
            raise ValueError(f"Input changed during packaging: {name}")
    expected = {entry["path"]: entry for entry in [*entries, manifest_record]}
    with zipfile.ZipFile(output) as archive:
        if len(archive.namelist()) != len(expected) or set(archive.namelist()) != set(expected):
            raise ValueError("Final ZIP membership mismatch")
        for name, entry in expected.items():
            with archive.open(name) as stream:
                if digest_stream(stream) != {k: entry[k] for k in ("bytes", "sha256")}:
                    raise ValueError(f"Final ZIP member hash mismatch: {name}")
    whole = digest_file(output)
    ensure_closed(root, specification)
    verify_final_execution(root, specification)
    with sidecars[1].open("x", encoding="ascii") as stream:
        stream.write(whole["sha256"] + "  " + output.name + "\n")
    with sidecars[2].open("xb") as stream:
        stream.write(content)
    verification = {"schemaVersion": 1, "verifiedAtUtc": datetime.now(UTC).isoformat(), "archive": output.name, **whole,
                    "manifestSha256": manifest_record["sha256"], "verifiedMembers": len(expected), "artifactFiles": len(selected),
                    "sourceArchiveCount": len(sources), "allArchivedHashesVerified": True, "frozenInputsVerified": True,
                    "finalProtectedExecutionVerified": True, "budgetLocksAbsent": True, "copiedJournalSha256": accounting["sha256"],
                    "priorArchivesEmbedded": False, "sourceAndInputArchiveMembersVerified": True,
                    "portableArchiveHashesVerified": True, "providerCalls": 0, "databaseCalls": 0}
    with sidecars[3].open("xb") as stream:
        stream.write(encoded(verification))
    return verification


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--inputs", type=Path, default=Path(__file__).with_name("package-inputs.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-inputs", action="store_true")
    parser.add_argument("--final-confirmed", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    lexical_inputs = args.inputs if args.inputs.is_absolute() else Path.cwd() / args.inputs
    if not lexical_inputs.is_relative_to(root):
        parser.error("Input specification must be inside this repository")
    inputs = safe_path(root, lexical_inputs.relative_to(root).as_posix())
    specification = json.loads(inputs.read_bytes())
    if specification.get("schemaVersion") != 3:
        parser.error("Unsupported specification version")
    if args.check_inputs:
        selected, groups, missing = collect(root, specification)
        print(json.dumps({"selectedFiles": len(selected), "groups": groups, "missingInputs": missing, "contentHashesRead": False}, indent=2))
        return int(bool(missing))
    if not args.output or not args.final_confirmed:
        parser.error("Final build requires --output NEW_ZIP and --final-confirmed after root finalizes work")
    print(json.dumps(build(root, inputs, specification, args.output), indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
