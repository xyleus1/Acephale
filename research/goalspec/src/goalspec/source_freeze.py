"""Freeze actual source bytes, including uncommitted work, before held-out trials."""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

VERSION = "goalspec-source-freeze-v1"
SOURCE_TREES = (
    "src/lib/goalspec", "src/lib/goalspec-adapters", "services/goalspec-runtime",
    "research/goalspec/src", "research/goalspec/tests", "research/goalspec/scripts",
)
EXPLICIT_FILES = (
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.goalspec.json",
    "src/lib/agent-chat.ts", "src/lib/gpt56-client.ts", "src/lib/document-readiness.ts",
    "src/lib/inquiry-status.ts", "research/goalspec/pyproject.toml", "research/goalspec/uv.lock",
    "research/goalspec/benchmarks.lock.json", "research/goalspec/dataset-releases.lock.json",
    "AGENTS.md", "src/lib/AGENTS.md",
    "prisma/schema.prisma",
)
DOCUMENTS = ("docs/AI_HANDOFF.md", "docs/DECISIONS.md", "docs/ENGINEERING_LOG.md")
SOURCE_SUFFIXES = {".ts", ".py", ".json", ".sql", ".md", ".toml", ".lock", ".ps1", ".sh", ".yaml", ".yml", ".txt", ".jinja", ".jinja2"}
ANALYSIS_FILES = {"evaluation_v1.py", "metrics.py", "reporting.py"}
EXPORT_FILES = {"training_export.py", "export_native_training.py", "export_otel.py", "export_parquet.py",
                "archive_public_evidence.py", "archive_v1_validation.py", "public_results.py", "plot_public_results.py",
                "goalspec-export-repository.ts", "goalspec-telemetry.ts"}
NATIVE_TREE = "research/goalspec/.benchmarks/tau3"
PRE_HELDOUT_ENGINEERING = [
    "Explicit SourceRef prompt guidance distinguishing source object keys from section labels.",
    "Invalid prediction contracts yield recorded unknown goals or empty candidates; provider and budget failures remain fatal.",
    "Validate bound pattern eligibility and arguments before deciding whether candidate fallback is needed.",
    "Memoize identical embedding queries within the frozen runtime.",
    "Atomically reserve the complete paired cohort before provider dispatch.",
    "Use version 2 delta budget journals with streamed recovery of earlier journal records.",
    "Expose current server policy through a named server_policy source for grounded constraints, without duplicating policy text.",
]
CONFIGURATION = {
    "models": {"actor": "gpt-5.4-2026-03-05", "teacher": "gpt-5.4-2026-03-05",
               "goal": "gpt-4.1-mini-2025-04-14", "candidate": "gpt-4.1-mini-2025-04-14",
               "user": "gpt-4.1-mini-2025-04-14", "embedding": "text-embedding-3-small",
               "deryaActor": "gpt-5.6"},
    "actorReasoning": "medium", "actorOutputTokens": 4096, "predictorOutputTokens": 1024,
    "actorInputTokens": 32768, "predictorInputTokens": 8192, "embeddingDimensions": 1536,
    "budgetCeilingUsd": 500,
    "allocationCeilingsUsd": {"infrastructure": 35, "preparation": 30, "training": 60,
                              "development": 40, "heldout": 240, "replay": 30, "contingency": 65},
    "infrastructure": "local_only_no_AWS",
    "engineeringDefaults": {"patternScoreThreshold": .8, "rankedCandidates": 3,
                            "speculativeConcurrencyPerRun": 2, "globalSpeculativeConcurrency": 4,
                            "startsPerRun": 12, "lookaheadHops": 2, "evidencePerBoundary": 2,
                            "speculativeDeadlineMs": 5000},
    "calibrationInterpretation": "0.8 is an engineering admission threshold, not a fitted probability calibration claim",
    "arms": ["base", "neutral_memory_prefetch", "goalspec"],
}


def digest_bytes(data: bytes):
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def category(name: str):
    path = PurePosixPath(name)
    if name.startswith("docs/") or path.suffix == ".md":
        if name.startswith(NATIVE_TREE + "/data/"):
            return "execution"
        return "documentation"
    if "/tests/" in name or path.name.endswith(".test.ts"):
        return "verification"
    if path.name in EXPORT_FILES:
        return "artifact_export"
    if path.name in ANALYSIS_FILES or path.name in {"evaluate_v1.py", "audit_candidate_union.py"}:
        return "analysis"
    return "execution"


def _safe_source(root: Path, path: Path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or path.is_symlink() or not path.is_file():
        raise ValueError("Source path escapes repository or is not a regular file")
    relative = path.relative_to(root)
    if any(part in {".env", ".venv", "node_modules", "__pycache__", "runs", ".git"}
           or part.startswith(".env.") for part in relative.parts):
        raise ValueError("Secret, dependency cache or run artifact cannot enter source archive")
    return relative.as_posix()


def collect_sources(root: Path, *, require_native=True):
    root = root.resolve(strict=True)
    paths = set()
    for name in SOURCE_TREES:
        directory = root / name
        if not directory.is_dir():
            raise ValueError(f"Required source tree unavailable: {name}")
        paths.update(path for path in directory.rglob("*") if path.is_file() and path.suffix in SOURCE_SUFFIXES and "__pycache__" not in path.parts)
    paths.update(path for path in (root / "scripts").glob("goalspec-*") if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    paths.update(path for path in (root / "docs/goalspec").rglob("*") if path.is_file() and path.suffix in SOURCE_SUFFIXES)
    for name in EXPLICIT_FILES:
        path = root / name
        if not path.is_file():
            raise ValueError(f"Required source file unavailable: {name}")
        paths.add(path)
    paths.update(root / name for name in DOCUMENTS if (root / name).is_file())
    native = root / NATIVE_TREE
    if require_native and not (native / "src/tau2").is_dir():
        raise ValueError("Pinned native benchmark source unavailable")
    if (native / "src").is_dir():
        paths.update(path for path in (native / "src").rglob("*") if path.is_file() and path.suffix in SOURCE_SUFFIXES and "__pycache__" not in path.parts)
        for name in ("pyproject.toml", "uv.lock", "LICENSE", "data/tau2/domains/airline/policy.md", "data/tau2/domains/retail/policy.md"):
            if not (native / name).is_file():
                raise ValueError(f"Required native source unavailable: {name}")
            paths.add(native / name)
    return {_safe_source(root, path): path for path in sorted(paths)}


def development_calibration(design: Path, outcomes: Path):
    declared = json.loads(design.read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in outcomes.read_text(encoding="utf-8").splitlines() if line]
    study_id = declared.get("studyId")
    stages = declared.get("developmentStudyStages", [declared.get("studyStage")])
    v2 = bool(study_id) and bool(stages) and set(stages) <= {"development-1", "development-2"}
    if study_id and not v2:
        raise ValueError("Only completed development stages may determine held-out size")
    def development_identity(row):
        if not v2:
            return row.get("runId", "").startswith("development-")
        namespace = digest_bytes(canonical(study_id))[:10]
        return (row.get("studyId") == study_id and row.get("studyStage") in stages
                and row.get("runId", "").startswith(f"v2-{namespace}-{row['studyStage']}-"))
    if declared.get("phase") != "development" or not rows or any(not development_identity(row) for row in rows):
        raise ValueError("Only completed development design and outcomes may determine held-out size")
    def trial_key(row, *, declared_trial=False):
        key = (row["family" if declared_trial else "familyId"], row["variant"], row["trial"], row["arm"])
        if not v2:
            return key
        stage = row.get("studyStage", declared.get("studyStage")) if declared_trial else row.get("studyStage")
        if stage not in stages:
            raise ValueError("Every v2 development trial must identify its declared study stage")
        return (stage, *key)
    expected = {trial_key(r, declared_trial=True): r["seed"] for r in declared["trials"]}
    actual = [trial_key(r) for r in rows]
    if len(expected) != len(declared["trials"]) or len(set(actual)) != len(actual) or set(actual) != set(expected):
        raise ValueError("Every declared development trial must be present once")
    if any(row["seed"] != expected[key] for key, row in zip(actual, rows, strict=True)):
        raise ValueError("Development trial seeds differ from the frozen design")
    costs = [row["billedUsd"] for row in rows if not row["budget_terminated"] and row["billedUsd"] is not None]
    if not costs or any(not isinstance(cost, int | float) or not math.isfinite(cost) or cost < 0 for cost in costs):
        raise ValueError("Finite completed development costs are required")
    censored = any(row["budget_terminated"] or row["billedUsd"] is None for row in rows)
    allowance = math.ceil(4 * max(1.25, 2.5 if censored else 0, 1.25 * max(costs))) / 4
    return {"developmentTrials": len(rows), "completedKnownCostTrials": len(costs), "censored": censored,
            "largestCompletedCostUsd": max(costs), "allowanceUsd": allowance,
            **({"developmentStudyStages": sorted(stages), "trialIdentityIncludesStudyStage": True} if v2 else {}),
            "heldoutFamilies": min(8 if v2 else 16, 2 * math.floor((179.447786 if v2 else 240) / (24 * allowance))),
            "rule": ("V2 study cost rule; final count is additionally capped by current shared allocation headroom" if v2 else
                     "b=ceil(4*max(1.25,1.25*maxCompletedDevCost,2.50_if_censored))/4; N=min(16,2*floor(240/(24*b)))")}


def freeze_source(root: Path, output: Path, inputs: dict[str, Path], *, require_native=True):
    root = root.resolve(strict=True)
    if not {"fixtures", "records", "development_design", "development_outcomes"} <= set(inputs):
        raise ValueError("Fixture, frozen records and development calibration inputs required")
    inputs = {label: path.resolve(strict=True) for label, path in inputs.items()}
    for path in inputs.values():
        if (not path.is_file() or path.name.startswith(".env") or path.suffix in {".pem", ".key"}
                or any(part in {".aws", "credentials", ".npmrc"} for part in path.parts)):
            raise ValueError("Invalid experiment input path")
    calibration = development_calibration(inputs["development_design"], inputs["development_outcomes"])
    paths = collect_sources(root, require_native=require_native)
    source = {name: path.read_bytes() for name, path in paths.items()}
    entries = {name: {"sha256": digest_bytes(data), "bytes": len(data), "category": category(name)} for name, data in source.items()}
    input_records = {}
    for label, path in sorted(inputs.items()):
        path = path.resolve(strict=True)
        if not path.is_file() or path.name.startswith(".env") or path.suffix in {".pem", ".key"}:
            raise ValueError("Invalid experiment input path")
        input_records[label] = {"path": path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path),
                                "sha256": file_digest(path), "bytes": path.stat().st_size, "archived": False}
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    native_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root / NATIVE_TREE, text=True).strip() if require_native else None
    if require_native and native_head != "2174a603f6d014ef94473ffa95957f6ce27100db":
        raise ValueError("Native benchmark HEAD differs from the pinned release")
    output.mkdir(parents=True, exist_ok=False)
    archive = output / "source.zip"
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in sorted(source.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, data)
    # Capture once, then verify against disk before declaring the freeze complete.
    if any(file_digest(paths[name]) != record["sha256"] for name, record in entries.items()):
        raise RuntimeError("Source changed while freezing; incomplete archive cannot authorize held-out dispatch")
    if set(collect_sources(root, require_native=require_native)) != set(entries):
        raise RuntimeError("Source membership changed while freezing; incomplete archive cannot authorize held-out dispatch")
    if any(file_digest(inputs[label]) != record["sha256"] for label, record in input_records.items()):
        raise RuntimeError("Experiment input changed while freezing; incomplete archive cannot authorize held-out dispatch")
    configuration = json.loads(json.dumps(CONFIGURATION))
    configuration.update({"runtimeVersion": "goalspec-v2-background", "predictionProtocol": "compact-v2",
                          "hostHealthRequiredForLocalPaidRuns": True, "latencyIncludesManagedDrain": True})
    configuration["engineeringDefaults"].update({"rankedCandidates": 2, "minimumCandidateConfidence": .75,
                                                 "maximumPredictorCyclesPerRun": 12})
    engineering = ["Compact strict outputs with server-owned source references, envelopes and normalized weights.",
                   "One managed background prediction cycle per run; actor boundaries do not await prediction.",
                   "Discard candidates across changed checkpoints, policy/scope/snapshot revisions and mutations.",
                   "Compact historical hints and rejection of already observed reads.",
                   "Per-run actor/user drain acknowledgments and separate total-trial timing.",
                   "Windows idle-sleep hold, latched host-health gate, and safe provider failure diagnostics."]
    manifest = {"schemaVersion": "1.0.0", "freezerVersion": VERSION, "createdAtUtc": datetime.now(UTC).isoformat(),
                "baselineGitHead": head, "nativeGitHead": native_head, "sourceTreeHash": digest_bytes(canonical(entries)),
                "archive": {"path": "source.zip", "sha256": file_digest(archive), "bytes": archive.stat().st_size},
                "sources": entries, "inputs": input_records, "configuration": configuration,
                "developmentCostCalibration": calibration,
                "preHeldoutEngineeringChanges": engineering,
                "selectionPolicy": "fixed_allowlisted_source_trees_and_files; no environment files, runs, raw artifacts or dependency installations archived",
                "verificationPolicy": "execution/dependency/prediction/native/verifier bytes and frozen input hashes must stay identical; analysis/export/docs/tests changes are separately disclosed",
                "heldoutPolicy": "Freeze before the first held-out provider request. No scientific tuning on held-out results.",
                "nativeIncluded": require_native}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "manifest.sha256").write_text(file_digest(output / "manifest.json") + "  manifest.json\n", encoding="ascii")
    return manifest


def verify_source(root: Path, frozen: Path):
    root = root.resolve(strict=True)
    manifest_path = frozen / "manifest.json"
    if (frozen / "manifest.sha256").read_text(encoding="ascii").split()[0] != file_digest(manifest_path):
        raise ValueError("Frozen manifest integrity failure")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["freezerVersion"] != VERSION or digest_bytes(canonical(manifest["sources"])) != manifest["sourceTreeHash"]:
        raise ValueError("Unsupported or changed frozen source map")
    archive = frozen / manifest["archive"]["path"]
    if archive.parent.resolve() != frozen.resolve() or file_digest(archive) != manifest["archive"]["sha256"]:
        raise ValueError("Frozen source archive integrity failure")
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.namelist()) != len(set(bundle.namelist())) or set(bundle.namelist()) != set(manifest["sources"]):
            raise ValueError("Archive source membership differs from manifest")
        for name, metadata in manifest["sources"].items():
            data = bundle.read(name)
            if len(data) != metadata["bytes"] or digest_bytes(data) != metadata["sha256"]:
                raise ValueError("Archived source bytes do not match manifest")
    current = collect_sources(root, require_native=manifest["nativeIncluded"])
    changes = []
    for name in sorted(set(current) | set(manifest["sources"])):
        before = manifest["sources"].get(name)
        after = file_digest(current[name]) if name in current else None
        if before and after == before["sha256"]:
            continue
        changes.append({"path": name, "category": before["category"] if before else category(name),
                        "change": "added" if not before else "deleted" if after is None else "modified",
                        "beforeSha256": before["sha256"] if before else None, "afterSha256": after})
    changed_inputs = []
    for label, metadata in manifest["inputs"].items():
        path = Path(metadata["path"])
        if not path.is_absolute():
            path = root / path
        after = file_digest(path) if path.is_file() else None
        if after != metadata["sha256"]:
            changed_inputs.append({"label": label, "path": metadata["path"], "beforeSha256": metadata["sha256"], "afterSha256": after})
    protected = [change for change in changes if change["category"] == "execution"]
    return {"schemaVersion": "1.0.0", "verifiedAtUtc": datetime.now(UTC).isoformat(),
            "sourceTreeHash": manifest["sourceTreeHash"], "manifestHash": file_digest(manifest_path),
            "protectedExecutionUnchanged": not protected, "frozenInputsUnchanged": not changed_inputs,
            "allSourceBytesUnchanged": not changes, "passed": not protected and not changed_inputs,
            "protectedChanges": protected, "disclosedOtherChanges": [c for c in changes if c["category"] != "execution"],
            "changedInputs": changed_inputs}
