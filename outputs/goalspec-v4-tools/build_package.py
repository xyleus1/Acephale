"""Package only explicitly allowlisted, stable v4 results after work has closed.

Standard library only. Merely importing this module performs no artifact scans.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

VERSION = "goalspec-v4-results-package-v1"
WORKSPACE = Path(__file__).absolute().parents[2]
ROLES = frozenset({"artifact", "executed-source-archive", "analysis-overlay"})
CHUNK_BYTES = 1024 * 1024
MAX_ALLOWLIST_BYTES = 1024 * 1024
MAX_FILES = 100_000
MAX_FILE_BYTES = 2 * 1024**3
MAX_TOTAL_BYTES = 8 * 1024**3
MAX_MANIFEST_BYTES = 64 * 1024**2
TIMESTAMP = (1980, 1, 1, 0, 0, 0)
DENIED_DIRECTORIES = frozenset({".git", ".hg", ".svn", ".ssh", ".aws", ".azure", ".codex", ".config",
    "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".next", ".cache", "cache",
    "caches", "venv", ".venv", "env", ".tox", "credentials", "secrets"})
IMMUTABLE_LOCKS = frozenset({"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", "cargo.lock"})


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Use canonical forward-slash repository-relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Path is not a canonical repository-relative path")
    for part in path.parts:
        lower = part.lower()
        if (re.search(r'[<>:"|?*]', part) or part.endswith((".", " "))
                or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)):
            raise ValueError("Nonportable path rejected")
        if (lower in DENIED_DIRECTORIES or lower.startswith(".env") or lower.endswith(("_cache", "-cache"))
                or re.search(r"(^|[._-])(credentials?|secrets?|private[_-]?key|api[_-]?key)([._-]|$)", lower)
                or lower in {"id_rsa", "id_ed25519", "access_token", "refresh_token", "token.txt", "tokens.json"}
                or lower.endswith((".pem", ".key", ".p12", ".pfx", ".pyc", ".pyo"))):
            raise ValueError("Credential, environment or cache path rejected")
        if lower not in IMMUTABLE_LOCKS and (lower.endswith((".lock", ".lck", ".pid", ".sock", ".tmp", ".temp", ".partial", "-wal", "-shm"))
                or lower.startswith((".lock", ".~lock."))):
            raise ValueError("Mutable lock or temporary path rejected")
    return path


def checked_path(workspace, path, *, missing_ok=False):
    """Reject links and Windows junctions in every component, not just the leaf."""
    workspace = Path(workspace).absolute()
    path = Path(path).absolute()
    try:
        parts = path.relative_to(workspace).parts
    except ValueError as error:
        raise ValueError("Path is outside the workspace") from error
    if any(part in {".", ".."} for part in parts):
        raise ValueError("Parent traversal rejected")
    current = workspace
    for part in (None, *parts):
        if part is not None:
            current /= part
        try:
            info = current.lstat()
        except FileNotFoundError:
            if missing_ok:
                continue
            raise ValueError("Allowlisted path is missing") from None
        if stat.S_ISLNK(info.st_mode) or getattr(current, "is_junction", lambda: False)():
            raise ValueError("Symlink or junction rejected")
    if not path.resolve().is_relative_to(workspace.resolve()):
        raise ValueError("Resolved path is outside the workspace")
    return path


def identity(info):
    # Python 3.12 on Windows can expose creation time via stat.st_ctime and
    # metadata-change time via fstat.st_ctime for the same unchanged file.
    # Device, file ID, size, mtime and mode remain comparable across both APIs.
    change_time = info.st_ctime_ns if os.name != "nt" else 0
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, change_time, info.st_mode


def load_allowlist(path):
    with path.open("rb") as stream:
        raw = stream.read(MAX_ALLOWLIST_BYTES + 1)
    if len(raw) > MAX_ALLOWLIST_BYTES:
        raise ValueError("Allowlist exceeds bounded size")
    value = json.loads(raw)
    if (not isinstance(value, dict) or set(value) != {"schemaVersion", "entries"}
            or value["schemaVersion"] != 1 or not isinstance(value["entries"], list) or not value["entries"]
            or len(value["entries"]) > MAX_FILES):
        raise ValueError("Expected schemaVersion 1 and a nonempty entries array")
    seen = set()
    for entry in value["entries"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "role"} or entry["role"] not in ROLES:
            raise ValueError("Each allowlist entry requires exactly path and role")
        relative_path(entry["path"])
        if entry["path"].casefold() in seen:
            raise ValueError("Duplicate allowlist path")
        seen.add(entry["path"].casefold())
    value["entries"].sort(key=lambda entry: (entry["role"], entry["path"]))
    return value


def collect(workspace, allowlist, output):
    """Directory selections are bounded recursive expansions, with no defaults."""
    files, directories, seen, total = [], {}, set(), 0
    for entry in allowlist["entries"]:
        selected = checked_path(workspace, workspace.joinpath(*relative_path(entry["path"]).parts))
        if entry["role"] == "executed-source-archive" and (not selected.is_file() or selected.suffix.lower() != ".zip"):
            raise ValueError("Executed source archives must be explicit ZIP files")
        pending = [selected]
        while pending:
            path = checked_path(workspace, pending.pop())
            relative = path.relative_to(workspace).as_posix()
            relative_path(relative)
            info = path.stat()
            if stat.S_ISDIR(info.st_mode):
                if path == output.parent or output.is_relative_to(path):
                    raise ValueError("Output ZIP must be outside every selected directory")
                if len(directories) >= MAX_FILES:
                    raise ValueError("Directory expansion exceeds bounded count")
                directories[path] = identity(info)
                with os.scandir(path) as entries:
                    children = []
                    for child in entries:
                        if len(children) + len(pending) + len(files) > MAX_FILES:
                            raise ValueError("Directory expansion exceeds bounded count")
                        children.append(Path(child.path))
                pending.extend(sorted(children, reverse=True))
                continue
            if not stat.S_ISREG(info.st_mode) or path == output:
                raise ValueError("Only regular source files are allowed")
            folded = relative.casefold()
            if folded in seen:
                raise ValueError("Overlapping selections or duplicate paths rejected")
            seen.add(folded)
            total += info.st_size
            if len(files) >= MAX_FILES or info.st_size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError("Package exceeds bounded file count or byte limits")
            files.append({"path": path, "relative": relative, "role": entry["role"], "identity": identity(info),
                          "bytes": info.st_size, "member": f"{entry['role']}/{relative}"})
    if not files:
        raise ValueError("Allowlist contains no files")
    return sorted(files, key=lambda row: row["member"]), directories


def audit_zip(path):
    """Check nested archive names and link flags without extracting any content."""
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_FILES:
            raise ValueError("Selected ZIP has too many members")
        seen = set()
        for info in infos:
            name = info.filename.rstrip("/")
            relative_path(name)
            if name.casefold() in seen or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError("Selected ZIP has duplicate, linked or encrypted members")
            seen.add(name.casefold())


def zip_info(name):
    info = zipfile.ZipInfo(name, TIMESTAMP)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    # Stored members keep output deterministic across compression-library
    # versions and avoid recompressing already compressed executed source ZIPs.
    info.compress_type = zipfile.ZIP_STORED
    return info


def build_package(allowlist_path, output, workspace=WORKSPACE):
    workspace = checked_path(workspace, workspace)
    allowlist_path = checked_path(workspace, allowlist_path)
    relative_path(allowlist_path.relative_to(workspace).as_posix())
    allowlist_identity = identity(allowlist_path.stat())
    output = checked_path(workspace, output, missing_ok=True)
    relative_path(output.relative_to(workspace).as_posix())
    if output.suffix.lower() != ".zip" or os.path.lexists(output):
        raise ValueError("Output must be a new ZIP path")
    if not output.parent.is_dir():
        raise ValueError("Create the output directory before packaging")
    allowlist = load_allowlist(allowlist_path)
    files, directories = collect(workspace, allowlist, output)
    for row in files:
        if row["path"].suffix.lower() == ".zip":
            audit_zip(row["path"])
    # Exclusive creation fails if another process races to occupy this path.
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0)
    descriptor = os.open(output, flags, 0o600)
    created_identity = os.fstat(descriptor)
    members = []
    try:
        with os.fdopen(descriptor, "wb") as destination, zipfile.ZipFile(destination, "w", allowZip64=True) as archive:
            allowlist_bytes = canonical(allowlist)
            archive.writestr(zip_info("_package/allowlist.json"), allowlist_bytes)
            members.append({"member": "_package/allowlist.json", "role": "package-metadata", "bytes": len(allowlist_bytes), "sha256": digest(allowlist_bytes)})
            for row in files:
                source = checked_path(workspace, row["path"])
                info = zip_info(row["member"])
                info.file_size = row["bytes"]
                checksum, size = hashlib.sha256(), 0
                with source.open("rb") as incoming, archive.open(info, "w", force_zip64=True) as outgoing:
                    if identity(os.fstat(incoming.fileno())) != row["identity"]:
                        raise ValueError("Allowlisted file changed before packaging")
                    while chunk := incoming.read(CHUNK_BYTES):
                        checksum.update(chunk)
                        size += len(chunk)
                        if size > row["bytes"]:
                            raise ValueError("Allowlisted file grew during packaging")
                        outgoing.write(chunk)
                    if identity(os.fstat(incoming.fileno())) != row["identity"] or size != row["bytes"]:
                        raise ValueError("Allowlisted file changed during packaging")
                members.append({"member": row["member"], "repoPath": row["relative"], "role": row["role"], "bytes": size, "sha256": checksum.hexdigest()})
            manifest = {"schemaVersion": 1, "packagerVersion": VERSION, "compression": "ZIP_STORED", "timestamp": list(TIMESTAMP),
                "classificationSource": "Explicit allowlist; execution is not independently attested by this packager",
                "sourceArchivePolicy": "Executed source ZIP bytes are preserved unchanged and are not merged with later analysis overlays",
                "analysisOverlayPolicy": "Analysis overlays are later analysis code or documents, not a claim of executed native runtime",
                "directoryPolicy": "Selected directories expand to regular files; empty directories are listed only in the allowlist",
                "securityScope": "Path and archive-member checks; this tool does not claim to detect arbitrary secrets inside allowed file content",
                "members": sorted(members, key=lambda row: row["member"])}
            manifest_bytes = canonical(manifest)
            if len(manifest_bytes) > MAX_MANIFEST_BYTES:
                raise ValueError("Package manifest exceeds bounded size")
            archive.writestr(zip_info("_package/manifest.json"), manifest_bytes)
        for path, before in directories.items():
            if identity(checked_path(workspace, path).stat()) != before:
                raise ValueError("Selected directory changed during packaging")
        for row in files:
            if identity(checked_path(workspace, row["path"]).stat()) != row["identity"]:
                raise ValueError("Selected file changed after its packaging boundary")
        with zipfile.ZipFile(checked_path(workspace, output)) as archive:
            expected = {row["member"]: row for row in members}
            if archive.namelist() != ["_package/allowlist.json", *[row["member"] for row in files], "_package/manifest.json"]:
                raise ValueError("ZIP member ordering or membership differs")
            if archive.read("_package/manifest.json") != manifest_bytes:
                raise ValueError("ZIP manifest roundtrip failed")
            for name, row in expected.items():
                checksum, size = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    while chunk := stream.read(CHUNK_BYTES):
                        checksum.update(chunk)
                        size += len(chunk)
                if checksum.hexdigest() != row["sha256"] or size != row["bytes"]:
                    raise ValueError("ZIP member hash or byte-length roundtrip failed")
        if identity(checked_path(workspace, allowlist_path).stat()) != allowlist_identity:
            raise ValueError("Allowlist changed during packaging")
        for path, before in directories.items():
            if identity(checked_path(workspace, path).stat()) != before:
                raise ValueError("Selected directory changed during verification")
        for row in files:
            if identity(checked_path(workspace, row["path"]).stat()) != row["identity"]:
                raise ValueError("Selected file changed during verification")
        checksum, size = hashlib.sha256(), 0
        with output.open("rb") as stream:
            while chunk := stream.read(CHUNK_BYTES):
                checksum.update(chunk)
                size += len(chunk)
        return {"schemaVersion": 1, "packagerVersion": VERSION, "status": "verified", "zipSha256": checksum.hexdigest(),
                "zipBytes": size, "manifestSha256": digest(manifest_bytes), "payloadFiles": len(files),
                "payloadBytes": sum(row["bytes"] for row in files), "roundTripVerified": True}
    except BaseException:
        # Remove only the file this invocation exclusively created, never another
        # path that replaced it. Interrupted builds otherwise remain visibly failed.
        try:
            current = checked_path(workspace, output).stat()
            if (current.st_dev, current.st_ino) == (created_identity.st_dev, created_identity.st_ino):
                output.unlink()
        except (OSError, ValueError):
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allowlist", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    def from_workspace(path):
        return path if path.is_absolute() else WORKSPACE / path
    result = build_package(from_workspace(arguments.allowlist), from_workspace(arguments.output))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Paths or file contents are not included in diagnostics.
        print(f"Package build failed: {type(error).__name__}.", file=sys.stderr)
        raise SystemExit(1)
