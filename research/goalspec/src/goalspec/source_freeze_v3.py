"""Stage-specific v3 byte archives, compatible with the legacy source verifier."""
from __future__ import annotations

import json
import subprocess
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from goalspec.source_freeze import (
    NATIVE_TREE,
    VERSION,
    canonical,
    category,
    collect_sources,
    digest_bytes,
    file_digest,
    verify_source,
)
from goalspec.study_v3 import REVISION, STAGES, load_study, validate_configuration

PROTOCOL = "official-tau-stage-freeze-v3"


def _archive(path, entries):
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in sorted(entries.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, data)


def freeze_stage(root, output, study_directory, stage, runtime_config, *, require_native=True):
    root = root.resolve(strict=True)
    if output.exists() or stage not in STAGES:
        raise ValueError("New output and bounded v3 stage required")
    study = load_study(study_directory)
    configuration = validate_configuration(json.loads(runtime_config.read_text(encoding="utf-8")))
    inputs = {"study": study_directory / "study.json", "runtime_config": runtime_config,
              "memory": Path(study["frozenExperienceMemory"]["path"]), "records": Path(study["frozenLibrary"]["recordsPath"])}
    inputs.update({f"native_input_{i:04d}": Path(entry["path"]) for i, entry in enumerate(study["sourceInventory"])})
    for path in inputs.values():
        if (not path.is_file() or path.name.startswith(".env") or path.suffix in {".pem", ".key"}
                or any(part in {".aws", "credentials", ".npmrc"} for part in path.parts)):
            raise ValueError("Invalid frozen experiment input")
    paths = collect_sources(root, require_native=require_native)
    source = {name: path.read_bytes() for name, path in paths.items()}
    entries = {name: {"sha256": digest_bytes(data), "bytes": len(data), "category": category(name)} for name, data in source.items()}
    input_bytes = {label: path.read_bytes() for label, path in inputs.items()}
    input_records = {label: {"path": str(path.resolve()), "sha256": digest_bytes(input_bytes[label]),
                            "bytes": len(input_bytes[label]), "archived": True, "archiveMember": label}
                     for label, path in sorted(inputs.items())}
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    native_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root / NATIVE_TREE, text=True).strip() if require_native else None
    if require_native and native_head != REVISION:
        raise ValueError("Native benchmark HEAD differs from the pinned release")
    output.mkdir(parents=True, exist_ok=False)
    _archive(output / "source.zip", source)
    _archive(output / "inputs.zip", input_bytes)
    if set(collect_sources(root, require_native=require_native)) != set(entries) or any(file_digest(paths[name]) != entry["sha256"] for name, entry in entries.items()):
        raise RuntimeError("Source changed during capture; incomplete freeze cannot authorize dispatch")
    if any(file_digest(inputs[label]) != entry["sha256"] for label, entry in input_records.items()):
        raise RuntimeError("Experiment input changed during capture; incomplete freeze cannot authorize dispatch")
    manifest = {"schemaVersion": "1.0.0", "freezerVersion": VERSION, "captureProtocol": PROTOCOL,
        "createdAtUtc": datetime.now(UTC).isoformat(), "baselineGitHead": head, "nativeGitHead": native_head,
        "sourceTreeHash": digest_bytes(canonical(entries)), "sources": entries, "inputs": input_records,
        "archive": {"path": "source.zip", "sha256": file_digest(output / "source.zip"), "bytes": (output / "source.zip").stat().st_size},
        "inputArchive": {"path": "inputs.zip", "sha256": file_digest(output / "inputs.zip"), "bytes": (output / "inputs.zip").stat().st_size},
        "studyId": study["studyId"], "studyHash": study["studyHash"], "studyStage": stage,
        "configuration": {"runtimeVersion": "v3", "sessionConfiguration": configuration, "models": study["models"],
            "arms": study["arms"], "maxSteps": study["maxSteps"], "localConcurrency": study["localConcurrency"]},
        "developmentCostCalibration": "Computed only from completed v3 development by claim_stage; no outcomes required for source capture",
        "selectionPolicy": "ID-only precommitted upstream train/test subsets; final size uses development cost and allocation headroom only",
        "historicalExposure": study["historicalExposure"], "nativeIncluded": require_native}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    (output / "manifest.sha256").write_text(file_digest(output / "manifest.json") + "  manifest.json\n", encoding="ascii")
    return manifest


def verify_stage_freeze(root, frozen, study_directory, stage, configuration):
    verification = verify_source(root, frozen)
    manifest = json.loads((frozen / "manifest.json").read_text(encoding="utf-8"))
    study = load_study(study_directory)
    if (not verification["passed"] or manifest.get("captureProtocol") != PROTOCOL or manifest.get("studyStage") != stage
            or manifest.get("studyHash") != study["studyHash"] or manifest["configuration"]["sessionConfiguration"] != validate_configuration(configuration)
            or manifest["inputs"]["study"]["sha256"] != file_digest(study_directory / "study.json")
            or manifest["inputs"]["memory"]["sha256"] != study["frozenExperienceMemory"]["sha256"]
            or manifest["inputs"]["records"]["sha256"] != study["frozenLibrary"]["recordsSha256"]):
        raise ValueError("Stage source freeze, study, configuration or immutable input differs")
    archive = frozen / manifest["inputArchive"]["path"]
    if archive.parent.resolve() != frozen.resolve() or file_digest(archive) != manifest["inputArchive"]["sha256"]:
        raise ValueError("Frozen input archive integrity failure")
    with zipfile.ZipFile(archive) as bundle:
        expected = {entry["archiveMember"]: entry for entry in manifest["inputs"].values()}
        if len(bundle.namelist()) != len(expected) or set(bundle.namelist()) != set(expected):
            raise ValueError("Frozen input archive membership differs")
        for member, entry in expected.items():
            data = bundle.read(member)
            if len(data) != entry["bytes"] or digest_bytes(data) != entry["sha256"]:
                raise ValueError("Frozen input archive bytes differ")
    return {**verification, "stageInputsAndArchiveUnchanged": True, "studyStage": stage}
