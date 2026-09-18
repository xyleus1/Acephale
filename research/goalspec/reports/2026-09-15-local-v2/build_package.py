"""Package explicit local v2 artifacts after root confirms all work has closed.

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
from pathlib import Path, PurePosixPath

BLOCK = 1024 * 1024
REPORT = "research/goalspec/reports/2026-09-15-local-v2"
DENIED_DIRS = {".git", ".aws", ".ssh", ".codex", ".venv", "node_modules", "__pycache__",
               ".pytest_cache", ".ruff_cache", "credentials", "secrets", "pg_wal", "pg_stat"}
DENIED_SUFFIXES = {".pem", ".key", ".pfx", ".p12", ".dpapi", ".clixml", ".sqlite", ".sqlite3", ".db", ".exe", ".dll", ".pyc"}
TEXT_SUFFIXES = {".ts", ".py", ".json", ".jsonl", ".ndjson", ".sql", ".md", ".toml", ".lock", ".ps1", ".sh",
                 ".yaml", ".yml", ".txt", ".log", ".csv", ".html", ".svg", ".xml", ".sha256"}
KEY = re.compile(rb"\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}")
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
    raise ValueError(f"Select one exact named run or v2 report path: {name}")


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
        for basename in ("manifest.json", "manifest.sha256", "source.zip"):
            key = name + "/" + basename
            try:
                selected.setdefault(key, {"path": safe_path(root, key), "groups": []})["groups"].append("source:" + source["id"])
            except FileNotFoundError:
                missing.append(f"Missing source artifact: {key}")
    allowed_zips = {source["directory"] + "/source.zip" for source in specification["sourceArchives"] if source.get("directory")}
    if any(name.endswith(".zip") and name not in allowed_zips for name in selected):
        raise ValueError("Only explicitly declared source ZIPs may be embedded")
    if specification.get("finalSourceId") not in source_ids:
        missing.append("Final source archive ID not supplied")
    accounting = specification.get("accountingCopy", {})
    for key in ("journalPath", "sha256", "closureReceiptPath"):
        if not accounting.get(key):
            missing.append(f"Final accounting {key} not supplied")
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
    for name in specification["mustBeAbsent"]:
        if root.joinpath(*relative(name).parts).exists():
            raise ValueError(f"Final build requires absent active lock: {name}")


def verify_sources(root, specification, selected):
    results = []
    for source in specification["sourceArchives"]:
        directory = source["directory"]
        manifest_path = safe_path(root, directory + "/manifest.json")
        manifest = json.loads(manifest_path.read_bytes())
        declared = safe_path(root, directory + "/manifest.sha256").read_text(encoding="ascii").split()[0]
        if digest_file(manifest_path)["sha256"] != declared:
            raise ValueError(f"Source manifest hash mismatch: {source['id']}")
        if hashlib.sha256(canonical(manifest["sources"])).hexdigest() != manifest["sourceTreeHash"]:
            raise ValueError(f"Source map hash mismatch: {source['id']}")
        archive_path = safe_path(root, directory + "/source.zip")
        if manifest["archive"]["path"] != "source.zip" or digest_file(archive_path) != {k: manifest["archive"][k] for k in ("bytes", "sha256")}:
            raise ValueError(f"Source archive hash mismatch: {source['id']}")
        with zipfile.ZipFile(archive_path) as archive:
            if len(archive.namelist()) != len(manifest["sources"]) or set(archive.namelist()) != set(manifest["sources"]):
                raise ValueError(f"Source archive membership mismatch: {source['id']}")
            for name, expected in manifest["sources"].items():
                check_name(name)
                member = archive.getinfo(name)
                if stat.S_ISLNK(member.external_attr >> 16) or name.endswith(".zip"):
                    raise ValueError(f"Unsupported nested source member: {name}")
                with archive.open(name) as stream:
                    actual = digest_stream(stream, name if PurePosixPath(name).suffix in TEXT_SUFFIXES else None)
                if actual != {k: expected[k] for k in ("bytes", "sha256")}:
                    raise ValueError(f"Source member hash mismatch: {source['id']}:{name}")
                if source["id"] == specification["finalSourceId"] and expected["category"] == "execution":
                    if digest_file(safe_path(root, name)) != actual:
                        raise ValueError(f"Final protected execution changed: {name}")
        for label, entry in manifest["inputs"].items():
            if entry["path"] not in selected:
                raise ValueError(f"Allowlist omits frozen input {source['id']}:{label}:{entry['path']}")
            if digest_file(selected[entry["path"]]["path"]) != {k: entry[k] for k in ("bytes", "sha256")}:
                raise ValueError(f"Frozen input changed: {source['id']}:{label}")
        results.append({"id": source["id"], "directory": directory, "sourceTreeHash": manifest["sourceTreeHash"],
                        "manifestSha256": declared, "archiveSha256": manifest["archive"]["sha256"], "members": len(manifest["sources"]),
                        "currentExecutionCompared": source["id"] == specification["finalSourceId"]})
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
    reference = specification["v1PackageReference"]
    checksum = safe_path(root, reference["checksumFile"])
    if checksum.read_text(encoding="ascii").strip().split() != [reference["sha256"], reference["filename"]]:
        raise ValueError("V1 package checksum reference mismatch")
    # This checks the small existing checksum sidecar, never reopens or embeds v1 ZIP bytes.
    sources = verify_sources(root, specification, selected)
    accounting = specification["accountingCopy"]
    if accounting["journalPath"] not in selected or accounting["closureReceiptPath"] not in selected:
        raise ValueError("Final accounting copy and closure receipt must be explicitly selected")
    if accounting["journalPath"].startswith("research/goalspec/runs/local-evaluation-20260914/"):
        raise ValueError("Package a finalized consistent accounting copy, never the live shared journal")
    if not re.fullmatch(r"[0-9a-f]{64}", accounting["sha256"]):
        raise ValueError("Root-supplied final accounting SHA256 is required")
    output = output.resolve()
    if output.parent != (root / "outputs").resolve() or output.suffix != ".zip" or not output.parent.is_dir():
        raise ValueError("Output must be a new ZIP directly under repository outputs/")
    sidecars = [Path(str(output) + suffix) for suffix in ("", ".sha256", ".manifest.json", ".verification.json")]
    if any(path.exists() for path in sidecars):
        raise FileExistsError("ZIP and every verification sidecar must be new")
    metadata = {}
    for name, entry in selected.items():
        metadata[name] = digest_file(entry["path"], entry["path"].suffix.lower() in TEXT_SUFFIXES)
    if metadata[accounting["journalPath"]]["sha256"] != accounting["sha256"]:
        raise ValueError("Copied final journal does not match the root-supplied SHA256")
    ensure_closed(root, specification)
    entries = []
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name, entry in sorted(selected.items()):
            member = "repository/" + name
            with entry["path"].open("rb") as stream, archive.open(zip_info(member), "w", force_zip64=True) as target:
                actual = digest_stream(stream, name if entry["path"].suffix.lower() in TEXT_SUFFIXES else None, target)
            if actual != metadata[name]:
                raise ValueError(f"Input changed while writing: {name}")
            entries.append({"path": member, "sourcePath": name, "groups": entry["groups"], "kind": "original_artifact", **actual})
        entries.append(add_bytes(archive, "V1_PACKAGE_REFERENCE.json", encoded({**reference, "embedded": False, "archiveBytesRehashed": False,
            "verification": "Existing checksum sidecar matches the preserved v1 handoff reference"})))
        entries.append(add_bytes(archive, "SOURCE_ARCHIVES.json", encoded(sources)))
        entries.append(add_bytes(archive, "PACKAGE_INPUTS.json", encoded(specification)))
        entries.append(add_bytes(archive, "PACKAGE_README.md", (
            b"# GoalSpec local v2 artifacts\n\nOriginal selected files are preserved under repository/. "
            b"SOURCE_ARCHIVES.json identifies every retained runtime capture, including failed development evidence. "
            b"Use the nominated final capture to reconstruct confirmation execution; historical captures intentionally differ. "
            b"The preserved v1 handoff ZIP is required separately and is referenced by checksum, not embedded. "
            b"The journal is a finalized consistent copy supplied after paid work closed. Unknown charges and failed outcomes remain included.\n\n"
            b"PACKAGE_MANIFEST.json lists every payload hash and excludes its own self-hash. External verification records that hash, "
            b"and the .sha256 sidecar covers the complete ZIP. Every member is read back and hash-verified. "
            b"Dependency installations, credentials, database runtime directories, and temporary test trees are excluded.\n")))
        manifest = {"schemaVersion": 1, "createdAtUtc": datetime.now(UTC).isoformat(), "packageLabel": specification["packageLabel"],
                    "sourceArchives": sources, "finalSourceId": specification["finalSourceId"], "v1PackageReference": reference,
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
    with sidecars[1].open("x", encoding="ascii") as stream:
        stream.write(whole["sha256"] + "  " + output.name + "\n")
    with sidecars[2].open("xb") as stream:
        stream.write(content)
    verification = {"schemaVersion": 1, "verifiedAtUtc": datetime.now(UTC).isoformat(), "archive": output.name, **whole,
                    "manifestSha256": manifest_record["sha256"], "verifiedMembers": len(expected), "artifactFiles": len(selected),
                    "sourceArchiveCount": len(sources), "allArchivedHashesVerified": True, "frozenInputsVerified": True,
                    "finalProtectedExecutionVerified": True, "budgetLocksAbsent": True, "copiedJournalSha256": accounting["sha256"],
                    "v1ArchiveEmbedded": False, "providerCalls": 0, "databaseCalls": 0}
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
    root, inputs = args.root.resolve(strict=True), args.inputs.resolve(strict=True)
    if not inputs.is_relative_to(root):
        parser.error("Input specification must be inside this repository")
    specification = json.loads(inputs.read_bytes())
    if specification.get("schemaVersion") != 1:
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
