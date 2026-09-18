"""Freeze named closed staging roots into archive_results' fixed file allowlist.

Run only after all paid clocks, report writers and the cumulative budget owner
have closed. This preparation step may enumerate the roots explicitly named in
its input; export/import/pack never discover additional inputs. No database or
provider calls. Original artifacts are never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
VERSION = "goalspec-v5-archive-staging-v1"
CHUNK = 1024 * 1024
EXCLUDED_COMPONENTS = {"__pycache__", ".pytest_cache", "node_modules", ".venv", "venv", ".git", ".benchmarks"}
FORBIDDEN_COMPONENTS = {"credentials", "secrets", ".ssh", ".aws"}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            value.update(block)
    return value.hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def relative(root, value):
    path = Path(value)
    path = path if path.is_absolute() else root / path
    require(not path.is_symlink(), "Symlink input is not allowed")
    resolved = path.resolve()
    require(resolved.is_relative_to(root.resolve()), "Archive staging input escapes workspace")
    name = resolved.relative_to(root.resolve()).as_posix()
    parts = name.lower().split("/")
    require(not any(part in EXCLUDED_COMPONENTS | FORBIDDEN_COMPONENTS for part in parts), "Excluded archive path")
    require(not any(part == ".env" or part.startswith(".env.") for part in parts), "Environment files are not archive inputs")
    require(not any(part.endswith((".pem", ".key", ".pfx", ".p12")) for part in parts), "Key material is not an archive input")
    return name


def path_at(root, value):
    return root / relative(root, value)


def event_encoding(path):
    """Select a verifier from the actual first row; exporter verifies all rows."""
    with path.open("rb") as stream:
        raw = stream.readline(8 * CHUNK)
    if not raw:
        return "plain-jsonl"
    require(raw.endswith(b"\n"), "Incomplete or oversized first event row")
    row = json.loads(raw)
    body = row.get("body") if isinstance(row, dict) else None
    if isinstance(body, dict) and "previousHash" in body:
        require("sequence" in body and "hash" in row, "Malformed chained event row")
        return "events"
    require(not isinstance(body, dict) or "previous" not in body, "Budget journals must be declared explicitly")
    return "plain-jsonl"


def source_members(root, specification):
    archive_path = path_at(root, specification["path"])
    plan_path = path_at(root, specification["plan"])
    frozen = read(plan_path)
    expected = frozen.get("sourceArchiveSha256")
    require(isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected), "Source ZIP needs an original frozen hash")
    require("sha256" not in specification or specification["sha256"] == expected,
            "Source ZIP override must equal its original frozen hash")
    require(sha(archive_path) == expected, "Original source ZIP changed")
    members = {}
    with zipfile.ZipFile(archive_path) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())), "Duplicate source ZIP member")
        require(sum(item.file_size for item in archive.infolist()) <= 256 * CHUNK, "Source ZIP expansion exceeds bound")
        for entry in archive.infolist():
            require(not entry.is_dir(), "Source ZIP inventory must contain files only")
            name = PurePosixPath(entry.filename)
            require(not name.is_absolute() and ".." not in name.parts and "\\" not in entry.filename
                    and ":" not in entry.filename, "Unsafe source ZIP member")
            lowered = tuple(part.lower() for part in name.parts)
            require(not any(part in FORBIDDEN_COMPONENTS or part == ".env" or part.startswith(".env.") for part in lowered),
                    "Sensitive source ZIP member")
            require(".benchmarks" not in lowered or lowered[:4] == ("research", "goalspec", ".benchmarks", "tau3"),
                    "Unexpected upstream source prefix")
            value = archive.read(entry.filename)
            members[entry.filename] = {"sha256": hashlib.sha256(value).hexdigest(), "bytes": len(value)}
            if entry.filename in specification.get("syntheticUrlReviews", {}):
                review = specification["syntheticUrlReviews"][entry.filename]
                require(review["sourceSha256"] == members[entry.filename]["sha256"], "Synthetic ZIP source review changed")
                members[entry.filename]["syntheticUrlReview"] = review
    require(set(specification.get("syntheticUrlReviews", {})).issubset(members), "Synthetic review names missing source member")
    runtime = frozen.get("runtimeSources")
    require(isinstance(runtime, dict) and runtime, "Native source freeze needs its runtime subset")
    for name, value in runtime.items():
        require(name in members and members[name]["sha256"] == value["sha256"], "Runtime-source subset differs from archived bytes")
    return {"path": relative(root, archive_path), "role": "source-freeze", "sha256": expected, "members": members}, {
        "archive": relative(root, archive_path), "plan": relative(root, plan_path),
        "completeZipMembers": len(members), "runtimeSubsetMembers": len(runtime),
        "runtimeSourcesAreOnlyExecutionSubset": True,
    }


def prepare(root, config, config_path):
    require(config.get("version") == VERSION and config.get("closed") is True, "All staging inputs must be explicitly closed")
    require(config.get("allPaidClocksClosed") is True and config.get("budgetOwnerClosed") is True,
            "Paid clocks and cumulative budget owner must close before archive planning")
    require(config.get("maximumBytes", 2 * 1024**3) == 2 * 1024**3, "Keep the authorized 2 GiB total source bound")
    files, omitted, freezes = {}, [], []
    overrides = config.get("overrides", {})

    def add(value, role, **options):
        name = relative(root, value)
        target = root / name
        require(target.is_file(), "Required archive input missing: " + name)
        if name in files:
            previous = files[name]
            require(previous["role"] == role or options.pop("replaceRole", False), "Conflicting archive role: " + name)
            options.pop("replaceRole", None)
            previous.update(options)
            previous["role"] = role
            return previous
        options.pop("replaceRole", None)
        item = {"path": name, "role": role, "sha256": sha(target), **options}
        if role == "provider-events" and item.get("chain") in {None, "auto"}:
            item["chain"] = event_encoding(target)
        files[name] = item
        return item

    source_names = {relative(root, item["path"]) for item in config.get("sourceFreezes", [])}
    for specification in config.get("roots", []):
        directory = path_at(root, specification["path"])
        require(directory.is_dir(), "Required staging root missing: " + specification["path"])
        exclude = set(specification.get("exclude", []))
        seen_exclusions = set()
        for target in sorted(directory.rglob("*")):
            require(not target.is_symlink(), "Symlink below staging root")
            local = target.relative_to(directory).as_posix()
            if any(part.lower() in EXCLUDED_COMPONENTS for part in target.relative_to(directory).parts):
                if target.is_file(): omitted.append({"path": target.relative_to(root).as_posix(), "reason": "cache or external dependency"})
                continue
            if not target.is_file():
                continue
            if local in exclude:
                seen_exclusions.add(local)
                omitted.append({"path": target.relative_to(root).as_posix(), "reason": "explicit staging exclusion"})
                continue
            name = relative(root, target)
            if name in source_names:
                continue
            require(target.suffix.lower() != ".zip", "Every source ZIP needs an explicit original plan binding")
            item = overrides.get(name, {})
            role = item.get("role", specification["role"])
            if target.name in specification.get("providerEventNames", []):
                role = "provider-events"
            add(name, role, **{key: value for key, value in item.items() if key != "role"})
        require(seen_exclusions == exclude, "An explicit staging exclusion did not match an existing file")
    for specification in config.get("files", []):
        add(specification["path"], specification["role"], **{key: value for key, value in specification.items() if key not in {"path", "role"}})
    for specification in config.get("sourceFreezes", []):
        item, receipt = source_members(root, specification)
        require(item["path"] not in files, "Source freeze appeared as an ordinary input")
        files[item["path"]] = item
        freezes.append(receipt)
        add(specification["plan"], "plan", replaceRole=True)

    cohorts = []
    for specification in config.get("cohorts", []):
        directory = path_at(root, specification["path"])
        manifest = read(directory / "service-manifest.json")
        traces = {}
        for run in manifest["runs"]:
            run_id = run["runId"]
            require(isinstance(run_id, str) and re.fullmatch(r"[A-Za-z0-9_-]+", run_id), "Invalid native run identity")
            traces[run_id] = add(directory / (run_id + ".json"), "native-trace", replaceRole=True)["path"]
        require(len(traces) == len(manifest["runs"]), "Repeated native run identity")
        cohorts.append({"closed": True,
                        "design": add(directory / "design.json", "plan", replaceRole=True)["path"],
                        "serviceManifest": add(directory / "service-manifest.json", "plan", replaceRole=True)["path"],
                        "outcomes": add(directory / "outcomes.jsonl", "native-outcomes", replaceRole=True)["path"],
                        "traces": traces})
        readiness = read(directory / "service-readiness.json")
        if readiness.get("eventPath"):
            add(readiness["eventPath"], "provider-events")
        else:
            require(readiness.get("ready") is False, "Ready service omitted exact event path")

    bindings = []
    for specification in config.get("budgets", []):
        journal = path_at(root, specification["journal"])
        pointer = path_at(root, specification["pointer"])
        value = read(pointer)
        name = value.get("checkpointFile")
        require(isinstance(name, str) and Path(name).name == name, "Unsafe checkpoint pointer")
        checkpoint = pointer.parent / name
        add(journal, "ledger", chain="budget", maximumFileBytes=512 * CHUNK)
        add(pointer, "verification")
        add(checkpoint, "verification", sha256=value["sha256"])
        bindings.append({"journal": relative(root, journal), "pointer": relative(root, pointer),
                         "checkpoint": relative(root, checkpoint),
                         "originalJournalPath": specification.get("originalJournalPath", str(journal))})

    preserved = []
    for specification in config.get("preserveArchives", []):
        path = path_at(root, specification["path"])
        actual = sha(path)
        require(re.fullmatch(r"[0-9a-f]{64}", specification.get("sha256", "")), "Prior archive needs its original receipt hash")
        require(actual == specification["sha256"], "Existing archive hash changed")
        preserved.append({"path": relative(root, path), "sha256": actual})
    require(len(preserved) == 5, "Preserve all five previous archives")
    add(config_path, "plan")
    add(Path(__file__), "source", replaceRole=True)
    require(sum((root / name).stat().st_size for name in files) <= 2 * 1024**3, "Final explicit source allowlist exceeds 2 GiB")
    for name, item in files.items():
        require(item["sha256"] == sha(root / name), "Input changed during archive preparation: " + name)
    return {"version": "goalspec-v5-archive-plan-v1", "archiveId": config["archiveId"], "closed": True,
            "maximumBytes": 2 * 1024**3, "files": [files[name] for name in sorted(files)],
            "cohorts": cohorts, "preserveArchives": preserved, "budgetCheckpointBindings": bindings,
            "externalInputs": config["externalInputs"], "sourceFreezeBindings": freezes,
            "staging": {"version": VERSION, "input": relative(root, config_path), "sha256": sha(config_path),
                        "excludedFiles": omitted, "rootEnumerationFinished": True,
                        "exporterMayDiscoverAdditionalInputs": False}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("staging")
    parser.add_argument("output")
    args = parser.parse_args()
    source = path_at(ROOT, args.staging)
    output = path_at(ROOT, args.output)
    require(not output.exists(), "Archive plan must be new")
    result = prepare(ROOT, read(source), source)
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2)
        stream.write("\n")
    print(json.dumps({"path": str(output), "sha256": sha(output), "files": len(result["files"]),
                      "cohorts": len(result["cohorts"]), "priorArchives": len(result["preserveArchives"])}))


if __name__ == "__main__":
    main()
