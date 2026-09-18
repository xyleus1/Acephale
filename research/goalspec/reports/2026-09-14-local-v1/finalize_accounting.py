"""Archive the closed research ledger and native OTLP events without provider calls."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    output = args.output.resolve()
    output.relative_to(root)
    budget_directory = root / "research/goalspec/runs/local-evaluation-20260914"
    journal = budget_directory / "budget.jsonl"
    lock = budget_directory / "budget.jsonl.lock"
    if lock.exists():
        raise RuntimeError("A budget owner is active; wait for all managed work to drain")
    output.mkdir(parents=True, exist_ok=False)
    before = sha256(journal)
    reporter = subprocess.run(
        ["node", "--import", "tsx", "scripts/goalspec-budget-report.ts",
         str(budget_directory), str(output / "budget-report.json")],
        cwd=root, check=True, capture_output=True, text=True,
    )
    if not reporter.stdout.strip():
        raise RuntimeError("Budget reporter did not return a result")
    budget = json.loads((output / "budget-report.json").read_text(encoding="utf-8"))
    if budget["totalSpentOrReservedUsd"] > budget["totalCeilingUsd"] + 1e-6:
        raise RuntimeError("Recorded commitments exceed the authorized ceiling")
    if lock.exists() or sha256(journal) != before:
        raise RuntimeError("Journal changed or has an active owner after reconciliation")
    copy = output / "budget-journal.jsonl"
    with journal.open("rb") as source, copy.open("xb") as destination:
        shutil.copyfileobj(source, destination, 1024 * 1024)
    if lock.exists() or sha256(journal) != before or sha256(copy) != before:
        raise RuntimeError("Journal changed during archival")
    research_python = root / "research/goalspec/.venv/Scripts/python.exe"
    telemetry = subprocess.run(
        [str(research_python), "research/goalspec/scripts/export_otel.py", "--events",
         str(budget_directory), "--output", str(output / "otel.json")],
        cwd=root, check=True, capture_output=True, text=True,
    )
    otlp_report = json.loads(telemetry.stdout)
    source_events = [
        {"path": path.relative_to(root).as_posix(), "sha256": sha256(path),
         "bytes": path.stat().st_size}
        for path in sorted(budget_directory.glob("events-*.jsonl"))
    ]
    manifest = {
        "schemaVersion": 1,
        "status": "complete",
        "createdAtUtc": datetime.now(UTC).isoformat(),
        "providerCallsByFinalizer": 0,
        "budgetOwnerAbsent": not lock.exists(),
        "sourceJournal": journal.relative_to(root).as_posix(),
        "sourceJournalSha256": before,
        "verbatimJournalCopyVerified": True,
        "unknownReservationsRetained": budget["unresolvedRequests"],
        "costBasis": budget["basis"],
        "knownUsageUsd": budget["totalKnownUsageCostUsd"],
        "spentOrReservedUsd": budget["totalSpentOrReservedUsd"],
        "awsResourcesCreated": False,
        "otlp": {**otlp_report, "scope": "native_research_service_events",
                 "replayEvents": "Preserved separately in prediction/annotation/grading JSONL artifacts",
                 "sourceEvents": source_events},
        "files": [
            {"path": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}
            for path in (output / "budget-report.json", copy, output / "otel.json")
        ],
        "finalizerSha256": sha256(Path(__file__)),
    }
    if lock.exists() or sha256(journal) != before:
        raise RuntimeError("Budget ownership or contents changed before final manifest")
    with (output / "manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"status": "complete", "knownUsageUsd": manifest["knownUsageUsd"],
                      "spentOrReservedUsd": manifest["spentOrReservedUsd"],
                      "unknownReservations": manifest["unknownReservationsRetained"],
                      "otlpSpans": otlp_report["spans"], "journalCopyVerified": True}))


if __name__ == "__main__":
    main()
