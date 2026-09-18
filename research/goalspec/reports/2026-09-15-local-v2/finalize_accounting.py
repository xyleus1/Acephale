"""Close local research accounting after explicit authorization; no provider calls.

One existing budget-report invocation acquires and releases its normal lock.
All other operations read closed artifacts or create new immutable copies.
Failures retain partial output; no locks, credentials, processes or files are removed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def now():
    return datetime.now(UTC).isoformat()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def metadata(path, root):
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)}


def write_new(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def lines(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.endswith("\n"):
                raise RuntimeError("incomplete_jsonl_record")
            if line.strip():
                yield json.loads(line)


def closed_hosts(root):
    names = ["development-1", "development-2", "confirmation", "smoke-predict", "smoke-predict-b",
             "smoke-grade", "user-stop-probe", "legacy-replay-predict", "legacy-replay-grade"]
    paths = {
        "development-1": "local-v2-development-1-host-20260915", "development-2": "local-v2-development-2-host-20260915",
        "confirmation": "local-v2-confirmation-host-20260915", "smoke-predict": "local-v2-smoke-predict-host-20260915",
        "smoke-predict-b": "local-v2-smoke-predict-host-b-20260915", "smoke-grade": "local-v2-smoke-grade-host-20260915",
        "user-stop-probe": "local-v2-user-stop-probe-host-20260915",
        "legacy-replay-predict": "local-v2-legacy-replay-predict-host-20260915",
        "legacy-replay-grade": "local-v2-legacy-replay-grade-host-20260915",
    }
    result = []
    for name in names:
        path = root / "research/goalspec/runs" / paths[name] / "events.jsonl"
        events = list(lines(path))
        final = events[-1]
        if final.get("event") != "guard_closed" or final.get("childStillRunning") is not False or final.get("executionStateReleased") is not True:
            raise RuntimeError("paid_host_not_fully_closed:" + name)
        result.append({"stage": name, "source": metadata(path, root), "closure": final})
    return result


def process_snapshot():
    if sys.platform != "win32":
        raise RuntimeError("windows_process_check_required")
    # Return only matching process IDs and image names, never command lines.
    command = r"""
$ErrorActionPreference = 'Stop'
$goalspecDispatcherPattern = '(?i)(goalspec-(prediction-replay|service|execution-replay|native-execution-replay|provider-smoke|annotate)\.(ts|js)|run_native_(live|v2)\.py|native_execution_replay_v2\.(py|ts)|run_user_stop_probe\.ts)'
$goalspecDispatchMatches = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('node.exe','python.exe','pythonw.exe') -and $_.CommandLine -match $goalspecDispatcherPattern
} | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; image=$_.Name} })
ConvertTo-Json -InputObject $goalspecDispatchMatches -Compress
"""
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                            check=True, capture_output=True, text=True)
    matches = json.loads(result.stdout)
    if matches:
        raise RuntimeError("active_research_dispatch_processes")
    return {"observedAtUtc": now(), "activeMatchingProcesses": [],
            "selection": "Known native, replay, annotation and user-stop research dispatcher entrypoints only",
            "unrelatedProcessesUntouched": True}


def copy_verified(source, destination):
    before = sha256(source)
    with source.open("rb") as reader, destination.open("xb") as writer:
        shutil.copyfileobj(reader, writer, 1024 * 1024)
    if sha256(source) != before or sha256(destination) != before:
        raise RuntimeError("source_changed_during_copy")
    return before


def load_journal(path):
    """Read the exported copy, reconstructing v1 snapshots and v2 deltas."""
    current = {}
    for row in lines(path):
        body = row["body"]
        if "version" not in body:
            current = dict(body["entries"])
        elif body["version"] == 2:
            current.update(body["changes"])
        else:
            raise RuntimeError("unknown_budget_journal_version")
    return current


def totals(entries):
    parents = {entry["parentId"] for entry in entries.values() if entry.get("parentId")}
    requests = {key: entry for key, entry in entries.items() if key not in parents}
    roots = [entry for entry in entries.values() if not entry.get("parentId")]
    return {"knownUsageMicrodollars": sum(entry.get("actual", 0) for entry in requests.values()),
            "spentOrReservedMicrodollars": sum(entry.get("actual", entry["maximum"]) for entry in roots),
            "unresolvedRequests": sum("actual" not in entry for entry in requests.values()),
            "retainedRootMaximumMicrodollars": sum(entry["maximum"] for entry in roots if "actual" not in entry),
            "requestLeaves": len(requests), "rootReservations": len(roots)}


def stage_accounting(root, journal_copy, report):
    runs = root / "research/goalspec/runs"
    baseline_dir = runs / "local-final-accounting-v1-20260915"
    baseline_report = json.loads((baseline_dir / "budget-report.json").read_text())
    baseline_manifest = json.loads((baseline_dir / "manifest.json").read_text())
    expected = next(entry["sha256"] for entry in baseline_manifest["files"] if entry["path"] == "budget-journal.jsonl")
    if sha256(baseline_dir / "budget-journal.jsonl") != expected:
        raise RuntimeError("baseline_journal_hash_mismatch")
    baseline = load_journal(baseline_dir / "budget-journal.jsonl")
    current = load_journal(journal_copy)
    categories = {}
    for stage in ("development-1", "development-2", "confirmation"):
        manifest = json.loads((runs / f"local-v2-{stage}-20260915/service-manifest.json").read_text())
        categories.update({"trial:" + run["runId"]: stage for run in manifest["runs"]})
    event_paths = {
        "smoke-prediction": "local-v2-protocol-smoke-b-20260915/predictions/events.jsonl",
        "smoke-grade": "local-v2-protocol-smoke-b-20260915/grades/events.jsonl",
        "user-stop-probe": "local-v2-user-stop-probe-20260915/results/events.jsonl",
        "legacy-prediction": "local-v2-legacy-replay-20260915/predictions/events.jsonl",
        "legacy-grade": "local-v2-legacy-replay-20260915/grades/events.jsonl",
    }
    for stage, relative in event_paths.items():
        for row in lines(runs / relative):
            event = row["body"]["event"]
            if event.get("type") in {"model_attempt", "model_attempt_failed", "embedding", "embedding_failed"}:
                identifier = event["id"]
                if identifier in categories and categories[identifier] != stage:
                    raise RuntimeError("ambiguous_stage_request_id")
                categories[identifier] = stage
    groups = {}
    for identifier, entry in current.items():
        owner = entry.get("parentId", identifier)
        stage = "v1-baseline" if identifier in baseline else categories.get(owner, "other-post-v1")
        groups.setdefault(stage, {})[identifier] = entry
    result = {"schemaVersion": 1, "basis": report["basis"],
              "method": "Known usage sums request leaves; commitments sum root actuals or retained maxima. Child maxima are never added to their parent's commitment.",
              "stages": [{"stage": stage, **totals(entries)} for stage, entries in sorted(groups.items())],
              "baselineReport": metadata(baseline_dir / "budget-report.json", root),
              "baselineJournalSha256": expected,
              "v1FinalKnownUsageUsd": baseline_report["totalKnownUsageCostUsd"],
              "v1FinalSpentOrReservedUsd": baseline_report["totalSpentOrReservedUsd"],
              "finalKnownUsageUsd": report["totalKnownUsageCostUsd"],
              "finalSpentOrReservedUsd": report["totalSpentOrReservedUsd"],
              "postV1KnownUsageUsd": report["totalKnownUsageCostUsd"] - baseline_report["totalKnownUsageCostUsd"],
              "postV1CommitmentChangeUsd": report["totalSpentOrReservedUsd"] - baseline_report["totalSpentOrReservedUsd"],
              "expectedUnresolvedRequests": 43, "actualUnresolvedRequests": report["unresolvedRequests"],
              "expectedUnresolvedCountMatches": report["unresolvedRequests"] == 43,
              "baselineEntriesUnchanged": all(current.get(key) == value for key, value in baseline.items()),
              "otherPostV1Meaning": "Post-baseline ledger rows not matched to the explicitly named native, smoke, probe or legacy replay stages"}
    actual = totals(current)
    if not (math.isclose(actual["knownUsageMicrodollars"] / 1e6, report["totalKnownUsageCostUsd"], abs_tol=1e-6)
            and math.isclose(actual["spentOrReservedMicrodollars"] / 1e6, report["totalSpentOrReservedUsd"], abs_tol=1e-6)
            and actual["unresolvedRequests"] == report["unresolvedRequests"]):
        raise RuntimeError("copied_journal_disagrees_with_budget_report")
    for field in ("knownUsageMicrodollars", "spentOrReservedMicrodollars", "unresolvedRequests"):
        if sum(stage[field] for stage in result["stages"]) != actual[field]:
            raise RuntimeError("stage_accounting_does_not_reconcile")
    result["stageTotalsMatchBudgetReport"] = True
    return result


def new_output(root, requested):
    runs = (root / "research/goalspec/runs").resolve(strict=True)
    output = requested if requested.is_absolute() else root / requested
    output = output.resolve()
    if output.parent != runs or output.exists():
        raise RuntimeError("output_must_be_new_direct_child_of_research_runs")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--event-output", type=Path, required=True)
    parser.add_argument("--all-paid-closed", action="store_true", required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    output = new_output(root, args.output)
    event_output = new_output(root, args.event_output)
    if output == event_output:
        raise RuntimeError("separate_output_directories_required")
    hosts = closed_hosts(root)
    process_before = process_snapshot()
    budget_dir = root / "research/goalspec/runs/local-evaluation-20260914"
    journal, lock = budget_dir / "budget.jsonl", budget_dir / "budget.jsonl.lock"
    if lock.exists():
        raise RuntimeError("budget_owner_active")
    for mode in ("predictions", "grades"):
        report = json.loads((root / f"research/goalspec/runs/local-v2-legacy-replay-20260915/{mode}/report.json").read_text())
        if report["attemptedJobs"] != 213 or report["completed"] + report["failed"] != 213 or not report["status"].startswith("complete"):
            raise RuntimeError("legacy_replay_phase_incomplete:" + mode)
    before = sha256(journal)
    output.mkdir(exist_ok=False)
    event_output.mkdir(exist_ok=False)
    subprocess.run(["node", "--import", "tsx", "scripts/goalspec-budget-report.ts", str(budget_dir), str(output / "budget-report.json")],
                   cwd=root, check=True, capture_output=True, text=True)
    if lock.exists() or sha256(journal) != before:
        raise RuntimeError("ledger_changed_or_lock_retained_after_report")
    report = json.loads((output / "budget-report.json").read_text())
    print(json.dumps({"event": "budget_report_closed", "budgetLockAbsent": True, "reporterInvocations": 1,
                      "knownUsageUsd": report["totalKnownUsageCostUsd"], "spentOrReservedUsd": report["totalSpentOrReservedUsd"],
                      "unresolvedRequests": report["unresolvedRequests"]}), flush=True)
    if report["totalSpentOrReservedUsd"] > 500 + 1e-6:
        raise RuntimeError("authorized_total_ceiling_exceeded")
    for allocation in report["allocations"]:
        if allocation["spentOrReservedUsd"] > allocation["ceilingUsd"] + 1e-6:
            raise RuntimeError("allocation_ceiling_exceeded")
    copy_verified(journal, output / "budget-journal.jsonl")
    native_sources = sorted(budget_dir.glob("events-*.jsonl"))
    copied = []
    for source in native_sources:
        target = event_output / source.name
        copy_verified(source, target)
        copied.append({"source": metadata(source, root), "copy": metadata(target, root)})
    write_new(event_output / "manifest.json", {"schemaVersion": 1, "createdAtUtc": now(), "scope": "all_shared_native_service_event_logs_including_retained_prior_attempts",
                                               "separateReplayEvents": "Prediction, annotation and grading event JSONL remain in their phase artifacts",
                                               "verbatimCopiesVerified": True, "files": copied})
    telemetry = subprocess.run([str(root / "research/goalspec/.venv/Scripts/python.exe"), "research/goalspec/scripts/export_otel.py",
                                "--events", str(event_output), "--output", str(output / "otel.json")],
                               cwd=root, check=True, capture_output=True, text=True)
    telemetry_report = json.loads(telemetry.stdout)
    accounting = stage_accounting(root, output / "budget-journal.jsonl", report)
    write_new(output / "stage-accounting.json", accounting)
    if lock.exists() or sha256(journal) != before or sorted(budget_dir.glob("events-*.jsonl")) != native_sources:
        raise RuntimeError("live_accounting_changed_before_closure")
    for pair in copied:
        if sha256(root / pair["source"]["path"]) != pair["source"]["sha256"]:
            raise RuntimeError("native_event_changed_before_closure")
    process_after = process_snapshot()
    if lock.exists() or sha256(journal) != before:
        raise RuntimeError("ledger_changed_during_final_process_check")
    closure = {"schemaVersion": 1, "createdAtUtc": now(), "allPaidClosedExplicitlyConfirmed": True,
               "budgetLockAbsent": not lock.exists(), "journalUnchanged": sha256(journal) == before,
               "hosts": hosts, "processBefore": process_before, "processAfter": process_after,
               "providerCallsByFinalizer": 0, "budgetReporterInvocations": 1,
               "credentialsReadOrDeleted": False, "processesTerminated": False}
    write_new(output / "closure.json", closure)
    manifest = {"schemaVersion": 1, "status": "complete", "createdAtUtc": now(), "providerCallsByFinalizer": 0,
                "sourceJournal": metadata(journal, root), "sourceJournalSha256": before, "verbatimJournalCopyVerified": True,
                "budgetOwnerAbsent": not lock.exists(), "knownUsageUsd": report["totalKnownUsageCostUsd"],
                "spentOrReservedUsd": report["totalSpentOrReservedUsd"], "unknownReservationsRetained": report["unresolvedRequests"],
                "costBasis": report["basis"], "otlp": {**telemetry_report, "scope": "native_service_events_only"},
                "eventCopyManifest": metadata(event_output / "manifest.json", root),
                "finalizerSha256": sha256(Path(__file__)), "awsResourcesCreated": False,
                "files": [metadata(path, root) for path in sorted(output.iterdir()) if path.is_file()]}
    if lock.exists() or manifest["sourceJournal"]["sha256"] != before:
        raise RuntimeError("ledger_changed_before_final_manifest")
    write_new(output / "manifest.json", manifest)
    print(json.dumps({"status": "complete", "knownUsageUsd": manifest["knownUsageUsd"], "spentOrReservedUsd": manifest["spentOrReservedUsd"],
                      "unresolvedRequests": report["unresolvedRequests"], "expectedUnresolvedCountMatches": accounting["expectedUnresolvedCountMatches"],
                      "stageTotalsMatch": True, "baselineEntriesUnchanged": accounting["baselineEntriesUnchanged"],
                      "nativeEventFiles": len(copied), "otlp": telemetry_report}), flush=True)


if __name__ == "__main__":
    main()
