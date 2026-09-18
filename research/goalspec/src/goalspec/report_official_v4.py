"""Read-only official-task v4 reporting with exact run identity and frozen inputs."""
from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

from goalspec import report_v3
from goalspec.fresh_tasks import digest
from goalspec.official_native import clone_with_globals
from goalspec.official_native_v4 import LABEL, VERSION, declared_trials
from goalspec.report_v4 import Sources, _numeric_rows, cost_summary
from goalspec.study_v2 import write

REPORT_VERSION = "official-tau-v4-report-v1"


def load_stage(directory, sources=None):
    sources = sources or Sources()
    directory = Path(directory).resolve()
    summary, design, plan = (sources.read(directory / name) for name in ("summary.json", "design.json", "dispatch-plan.json"))
    rows = sources.jsonl(directory / "outcomes.jsonl")
    if plan.get("version") != VERSION or plan.get("planHash") != digest({k: v for k, v in plan.items() if k != "planHash"}):
        raise ValueError("Official-v4 dispatch plan integrity failure")
    if design != plan["design"] or design.get("designHash") != digest({k: v for k, v in design.items() if k != "designHash"}):
        raise ValueError("Official-v4 outcome design changed")
    if any(summary.get(key) != design.get(key) for key in ("studyId", "studyStage", "studyHash", "designHash")) or summary.get("label") != LABEL:
        raise ValueError("Closed summary differs from official-v4 study/design")
    expected = dict(declared_trials(plan["study"], design))
    if len(rows) != len(expected) or len({row["runId"] for row in rows}) != len(rows) or {row["runId"] for row in rows} != set(expected):
        raise ValueError("Every official-v4 declared slot must be closed exactly once")
    fields = ("family", "domain", "taskId", "variant", "trial", "seed", "arm")
    for row in rows:
        if (any(row.get(key) != expected[row["runId"]].get(key) for key in fields)
                or row.get("reservedUsd") != expected[row["runId"]]["reserved_usd"]
                or row.get("studyId") != design["studyId"] or row.get("studyStage") != design["studyStage"]
                or row.get("label") != LABEL):
            raise ValueError("Per-run official task/arm/seed identity differs from its declared slot")
        if not isinstance(row.get("success"), bool) or (row["success"] and
                (row.get("officialReward") != 1 or row.get("nativeTermination") not in {"user_stop", "agent_stop"})):
            raise ValueError("Official success requires native reward one and successful native termination")
    if summary.get("counts") != dict(Counter(row["arm"] for row in rows)) or summary.get("successes") != sum(row["success"] for row in rows):
        raise ValueError("Official summary counts differ from retained outcomes")
    # All complete-grid and run association checks finish before private reads.
    manifest_path = directory / "service-manifest.json"
    if manifest_path.exists():
        manifest = sources.read(manifest_path)
        if (manifest.get("runtimeVersion") != "v4" or manifest.get("v4Configuration") != plan["v4Configuration"]
                or manifest.get("sessionConfiguration") != plan["baselineSessionConfiguration"]):
            raise ValueError("Service manifest differs from frozen v4 policy")
        runs = manifest["runs"]
        if len(runs) != len(rows) or {run["runId"]: run["arm"] for run in runs} != {row["runId"]: row["arm"] for row in rows}:
            raise ValueError("Service manifest run associations differ")
    elif any(row.get("serviceReadyBeforeTrial") for row in rows):
        raise ValueError("Started official trials require their service manifest")
    for record in plan["inputs"].values():
        path = sources.track(record["path"])
        if report_v3.file_hash(path) != record["sha256"]:
            raise ValueError("Frozen official benchmark report input changed")
    stage = clone_with_globals(report_v3.load_stage, {"read": sources.read})(directory)
    for row in stage["rows"]:
        row["reportedUnpromotedCalls"] = row.get("unpromotedCalls", row.get("wastedCalls"))
        name = f"{row['runId']}-stage-abort.json" if row.get("termination") == "stage_abort" else f"{row['runId']}.json"
        artifact = sources.read(directory / name)
        if row["success"] and (artifact.get("officialRewardInfo") or {}).get("reward") != 1:
            raise ValueError("Successful outcome differs from native reward artifact")
        promotions = artifact.get("promotionEvents")
        row["consumptionLeaseChecks"] = (sum(event.get("status") in {"consumed", "stale_fallback"} for event in promotions)
                                         if isinstance(promotions, list) else None)
        if row.get("unknownEvaluatorCharge"):
            row["unknownProviderCharge"] = True
    stage["plan"] = plan
    stage["sources"].extend(Path(path) for path in sources.hashes)
    sources.verify()
    return stage


def write_report(directory, output, event_paths, *, samples=5000, seed=20260916):
    directory, output = Path(directory).resolve(), Path(output).resolve()
    if output.exists() or output.is_relative_to(directory):
        raise ValueError("New report directory outside original cohort required")
    sources = Sources()
    stage = load_stage(directory, sources)
    if not event_paths and any(row.get("serviceReadyBeforeTrial") for row in stage["rows"]):
        raise ValueError("Started official cohort requires its closed original event log")
    if len(event_paths) > 1:
        raise ValueError("One original cohort service event log required")
    report = clone_with_globals(report_v3.analyze_stage, {"load_stage": lambda _: stage})(
        directory, event_paths, samples=samples, seed=seed)
    report["version"] = REPORT_VERSION
    report["benchmark"] = {"family": "tau3", "upstreamRevision": stage["plan"]["study"]["upstreamRevision"],
                           "scope": "Original published tasks and native evaluator, custom frozen agent scaffold, selected test subset",
                           "fullOfficialLeaderboardScore": None, "selection": sources.read(stage["plan"]["inputs"]["selection"]["path"])}
    report["cost"] = cost_summary(stage["rows"])
    report["leaseChecks"] = {arm: {
        "refreshChecks": sum(row["freshnessChecks"] for row in stage["rows"]
                             if row["arm"] == arm and report_v3.number(row.get("freshnessChecks"))),
        "missingRefreshTrials": sum(not report_v3.number(row.get("freshnessChecks")) for row in stage["rows"] if row["arm"] == arm),
        "consumptionChecks": sum(row["consumptionLeaseChecks"] for row in stage["rows"]
                                 if row["arm"] == arm and row["consumptionLeaseChecks"] is not None),
        "missingConsumptionTrials": sum(row["consumptionLeaseChecks"] is None for row in stage["rows"] if row["arm"] == arm),
        "meaning": "Refresh and consumption lease checks are added work, not physical native tool executions."}
        for arm in report_v3.ARMS}
    for item in report["sources"]:
        if report_v3.file_hash(sources.track(item["path"])) != item["sha256"]:
            raise ValueError("Input changed during official analysis")
    for path in (Path(__file__), Path(report_v3.__file__),
                 Path(__file__).resolve().parents[2] / "scripts/report_official_native_v4.py"):
        sources.track(path)
    sources.verify()
    output.mkdir(parents=True, exist_ok=False)
    write(output / "report.json", report)
    text = report_v3.markdown(report)
    text += ("\nThis is the frozen v4 agent on tau3 version1.0.1 official task data, not the original2024 tau-bench version or a full leaderboard reproduction. "
             "PASTE and Salesforce are local paper-based controls. The selection and ancestry audit are embedded in report.json; previously public-exposed tasks are not pristine held-out data. "
             "No actor, controller, gate, memory or utility setting was retuned on this cohort.\n")
    (output / "README.md").write_text(text, encoding="utf-8")
    with (output / "metrics.csv").open("x", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["metric_path", "value"])
        writer.writerows(_numeric_rows(report))
    sources.verify()
    write(output / "manifest.json", {"version": REPORT_VERSION, "sources": sources.hashes,
          "outputs": {path.name: report_v3.file_hash(path) for path in sorted(output.iterdir())},
          "providerCalls": 0, "immutable": True, "privateReadsAfterCompleteOutcomeGrid": True})
    return report
