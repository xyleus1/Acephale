"""Offline v5 reporting after whole-cohort closure; never changes native grades."""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.fresh_tasks import digest  # noqa: E402
from goalspec.report_v3 import closed_event_records, distribution, number  # noqa: E402
from goalspec.report_v4 import TIMES, Sources, cost_summary, paired_comparison, summarize_arm  # noqa: E402

VERSION = "goalspec-native-v5-report-v1"
FIELDS = ("family", "domain", "taskId", "variant", "trial", "seed", "arm")
ARM_ORDER = ("base", "v4", "literal", "hypotheses", "goalspec")
ARM_DESCRIPTIONS = {"base": "Same actor without GoalSpec context/prefetch",
    "v4": "Frozen v4 controller/actor-context policy inside the common v5 native harness; not historical v4 results",
    "literal": "V5 current-only literal obligation context", "hypotheses": "V5 current-only context with experimental inferred hypotheses",
    "goalspec": "Frozen selected v5 policy; exact configuration embedded"}


def verify_grid(design, rows):
    if design.get("designHash") != digest({key: value for key, value in design.items() if key != "designHash"}):
        raise ValueError("Design hash changed")
    expected = {f"v5-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}": trial
        for index, trial in enumerate(design["trials"])}
    if len(rows) != len(expected) or len({row["runId"] for row in rows}) != len(rows) or {row["runId"] for row in rows} != set(expected):
        raise ValueError("Every declared v5 trial must appear exactly once")
    if len({tuple(row[key] for key in FIELDS) for row in design["trials"]}) != len(expected):
        raise ValueError("Duplicated declared paired slot")
    for row in rows:
        if any(row.get(key) != expected[row["runId"]].get(key) for key in FIELDS):
            raise ValueError("Outcome differs from declared family/task/arm/seed")
        if row.get("studyId") != design["studyId"] or row.get("studyStage") != design["studyStage"]:
            raise ValueError("Outcome stage changed")
        if row["arm"] not in ARM_ORDER or type(row.get("success")) is not bool:
            raise ValueError("Unknown arm or nonboolean success")
        if row["success"] and (row.get("budget_terminated") or row.get("hostInterrupted") is True or row.get("termination") not in {"user_stop", "agent_stop"}
                               or row.get("serviceDrainSucceeded") is not True):
            raise ValueError("Success cannot hide budget, limit or unacknowledged drain failure")
    return expected


def provider_summary(events):
    groups = defaultdict(list)
    for event in events:
        if event.get("type") not in {"model_attempt", "model_attempt_failed", "embedding", "embedding_failed"}:
            continue
        identity = event.get("id", "")
        role = ("actor" if identity.endswith(":actor") else "user" if identity.endswith(":user") else
            "evaluator" if identity.endswith(":evaluator") else "goal" if identity.startswith(("goal:", "goal-spans:")) else
            "candidate" if identity.startswith("candidate-") else "embedding" if event["type"].startswith("embedding") else "other")
        groups[role].append(event)
    result = {}
    for role, rows in groups.items():
        usages = [row["usage"] for row in rows if isinstance(row.get("usage"), dict)]
        tokens = {"input": sum(value.get("input_tokens", value.get("prompt_tokens", 0)) for value in usages),
            "cachedInput": sum(value.get("input_tokens_details", {}).get("cached_tokens", 0) for value in usages),
            "output": sum(value.get("output_tokens", 0) for value in usages),
            "reasoningOutput": sum(value.get("output_tokens_details", {}).get("reasoning_tokens", 0) for value in usages)}
        result[role] = {"physicalProviderAttempts": len(rows), "responsesWithUsage": len(usages),
            "attemptsWithoutUsage": len(rows) - len(usages), "failedAttempts": sum(row["type"].endswith("failed") for row in rows),
            "retryAttempts": sum(row.get("attempt", 0) > 0 for row in rows), "tokensKnownSubtotal": tokens,
            "knownResponseUsageUsd": sum(row.get("costMicrodollars", 0) for row in rows) / 1e6,
            "models": dict(Counter(row.get("model", "unrecorded") for row in rows)),
            "latencyMs": distribution([row.get("latencyMs") for row in rows])}
    return result


def load_stage(directory, plan_path, event_path=None):
    sources = Sources()
    directory, plan_path = Path(directory).resolve(), Path(plan_path).resolve()
    plan = sources.read(plan_path)
    design = sources.read(directory / "design.json")
    rows = sources.jsonl(directory / "outcomes.jsonl")
    if plan.get("version") != "goalspec-experiment-v5" or plan.get("planHash") != digest({k: v for k, v in plan.items() if k != "planHash"}):
        raise ValueError("Frozen v5 plan invalid")
    if plan["design"] != design or Path(plan["outputPath"]).resolve() != directory:
        raise ValueError("Plan/output identity changed")
    expected = verify_grid(design, rows)
    summary_path = directory / "summary.json"
    if summary_path.exists():
        summary = sources.read(summary_path)
        if summary.get("version") != "goalspec-native-v5" or any(summary.get(key) != design.get(key) for key in ("studyId", "studyStage", "designHash")):
            raise ValueError("Closed native summary identity changed")
        if summary.get("counts") != dict(Counter(row["arm"] for row in rows)) or summary.get("successes") != sum(row["success"] for row in rows):
            raise ValueError("Closed summary counts changed")
    else:
        receipt = sources.read(directory / "dispatch-failure.json")
        if receipt.get("retainedSlots") != len(rows) or any(row["success"] for row in rows):
            raise ValueError("Closed setup failure receipt required")
        summary = {"setupFailure": receipt}
    archive_path = sources.track(plan_path.parent / "source.zip")
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != plan["sourceArchiveSha256"]:
        raise ValueError("Frozen source archive changed")
    with zipfile.ZipFile(archive_path) as archive:
        for name, record in plan["runtimeSources"].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != record["sha256"]:
                raise ValueError("Archived execution bytes differ from declared runtime hash")
    for record in plan["inputs"].values():
        path = sources.track(record["path"])
        if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("Frozen experiment input changed")
    manifest_path = directory / "service-manifest.json"
    manifest = sources.read(manifest_path) if manifest_path.exists() else None
    if manifest and (manifest.get("runtimeVersion") != "v5" or {run["runId"]: run["arm"] for run in manifest["runs"]} != {row["runId"]: row["arm"] for row in rows}):
        raise ValueError("Service manifest assignment changed")
    if manifest and manifest.get("v5Configuration") != sources.read(plan["inputs"]["configuration"]["path"]):
        raise ValueError("Dispatched configuration differs from frozen input")
    if any(row.get("serviceReadyBeforeTrial") for row in rows) and event_path is None:
        raise ValueError("Started cohort requires its original closed event log")
    events, audit = closed_event_records(sources.track(event_path), set(expected), manifest) if event_path else ([], None)
    by_run = defaultdict(list)
    for outer in events:
        event = outer.get("event", outer)
        run_id = outer.get("runId", event.get("runId"))
        if run_id in expected:
            by_run[run_id].append(event)
    # Only after the entire declared cohort is closed, open per-trial artifacts.
    for row in rows:
        artifact = sources.read(directory / f"{row['runId']}.json")
        if artifact.get("record") != row:
            raise ValueError("Trial artifact differs from immutable outcome")
        if row["success"]:
            if design["studyStage"] == "confirmation":
                if row.get("officialReward") != 1 or (artifact.get("officialRewardInfo") or {}).get("reward") != 1:
                    raise ValueError("Native success requires independent upstream reward one")
            elif (artifact.get("verdict") or {}).get("success") is not True:
                raise ValueError("Custom success requires independent fixture verdict")
        row["reservedUsd"] = expected[row["runId"]]["reserved_usd"]
        row["nativeToolTimings"] = artifact.get("nativeToolTimings")
        measured = isinstance(row["nativeToolTimings"], list)
        row["physicalCalls"] = row["authoritativeCalls"] + row["speculativeCalls"] if measured and all(number(row.get(key)) for key in ("authoritativeCalls", "speculativeCalls")) else None
        messages = (artifact.get("simulation") or {}).get("messages", [])
        row["toolResponses"] = sum(message.get("role") == "tool" for message in messages) if "simulation" in artifact else None
        row["toolErrorResponses"] = sum(message.get("role") == "tool" and message.get("error") is True for message in messages) if "simulation" in artifact else None
        row["consumptionLeaseChecks"] = sum(event.get("status") in {"consumed", "stale_fallback"} for event in artifact.get("promotionEvents", [])) if "promotionEvents" in artifact else None
        row["recordedLeaseChecks"] = row["freshnessChecks"] + row["consumptionLeaseChecks"] if number(row.get("freshnessChecks")) and number(row["consumptionLeaseChecks"]) else None
        row["totalIncludingEvaluationSeconds"] = row["totalTrialSeconds"] + row["evaluationSeconds"] if number(row.get("totalTrialSeconds")) and number(row.get("evaluationSeconds")) else None
        row["provider"] = provider_summary(by_run[row["runId"]])
    sources.verify()
    return {"plan": plan, "design": design, "rows": rows, "summary": summary, "manifest": manifest, "events": by_run, "eventAudit": audit, "sources": sources}


def analysis_rows(rows):
    """Mask only analysis clocks, after immutable artifact/outcome equality checks."""
    result = []
    for original in rows:
        row = dict(original)
        row["rawTiming"] = {key: original.get(key) for key in (*TIMES, "latencyMs", "nativeToolTimings")}
        invalid = original.get("measuredTimingValid") is False or original.get("hostInterrupted") is True
        row["analysisTimingEligible"] = not invalid
        row["analysisTimingStatus"] = ("excluded_host_or_incomplete_health" if invalid else
            "explicitly_valid" if original.get("measuredTimingValid") is True else "legacy_health_unrecorded")
        if invalid:
            for key in row["rawTiming"]:
                row[key] = None
        result.append(row)
    return result


def summarize_v5_arm(rows, samples, seed):
    summary = summarize_arm(rows, samples, seed)
    timing = summary["timingSeconds"]["totalTrialSeconds"]
    summary["timingQuality"] = {
        "declaredTrials": len(rows),
        "hostInterruptedTrials": sum(row.get("hostInterrupted") is True for row in rows),
        "explicitlyInvalidTimingTrials": sum(row["analysisTimingEligible"] is False for row in rows),
        "healthUnrecordedTrials": sum(row["analysisTimingStatus"] == "legacy_health_unrecorded" for row in rows),
        "primaryLiveMeasuredTrials": timing["n"], "primaryLiveMissingTrials": timing["missing"],
        "meaning": "Only explicitly invalid host clocks are excluded; missing legacy health metadata does not prove host validity. Task and call denominators retain every declared trial."}
    summary["rawTimingSeconds"] = {key: distribution([row["rawTiming"].get(key) for row in rows]) for key in TIMES}
    summary["metrics"]["liveTotalMeanSeconds"].update({"measuredTrials": timing["n"], "missingTrials": timing["missing"]})
    return summary


def analyze(stage, samples=5000, seed=20260919):
    if not isinstance(samples, int) or samples < 100:
        raise ValueError("At least100 bootstrap draws required")
    rows, design = analysis_rows(stage["rows"]), stage["design"]
    arms = [arm for arm in ARM_ORDER if any(row["arm"] == arm for row in rows)]
    summaries = {arm: summarize_v5_arm([row for row in rows if row["arm"] == arm], samples, seed) for arm in arms}
    for arm, summary in summaries.items():
        selected = [row for row in rows if row["arm"] == arm]
        summary["description"] = ARM_DESCRIPTIONS[arm]
        summary["provider"] = provider_summary([event for row in selected for event in stage["events"].get(row["runId"], [])])
        summary["budgetTerminations"] = sum(row.get("budget_terminated") is True for row in selected)
        summary["physicalCallsPerSuccessfulTrial"] = {"estimate": summary["metrics"]["physicalCallsPerSuccess"]["estimate"],
            "knownAttempts": summary["counts"]["physicalCalls"]["knownSum"], "missingTrials": summary["counts"]["physicalCalls"]["missingTrials"],
            "successfulTrials": summary["successes"], "meaning": "All physical attempts including failures divided by successes; unavailable if any trial lacks telemetry"}
        summary["costPerSuccessfulTrial"] = summary["cost"]["recordedTotalUsd"] / summary["successes"] if summary["cost"]["recordedTotalUsd"] is not None and summary["successes"] else None
    return {"version": VERSION, "studyId": design["studyId"], "studyStage": design["studyStage"], "label": design["label"],
        "designHash": design["designHash"], "arms": summaries, "paired": {f"{treatment}-minus-{control}": paired_comparison(rows, treatment, control, samples, seed)
            for control, treatment in itertools.combinations(arms, 2)},
        "domains": {domain: {arm: summarize_v5_arm([row for row in rows if row["domain"] == domain and row["arm"] == arm], samples, seed)
            for arm in arms} for domain in sorted({row["domain"] for row in rows})},
        "cost": cost_summary(rows), "models": design["models"], "configuration": (stage["manifest"] or {}).get("v5Configuration"),
        "legacyConfiguration": (stage["manifest"] or {}).get("v4Configuration"), "eventIntegrity": stage["eventAudit"],
        "serviceTiming": {key: stage["summary"].get(key) for key in ("serviceStartupSeconds", "finalServiceDrainSeconds", "serviceExitCode")},
        "trials": rows, "limitations": ["No full-benchmark or SOTA claim; public-exposed task lineage remains material",
            "Live interaction includes orchestrator/model/tool execution, simulation serialization and acknowledged per-trial actor/user drain; excludes source verification, task/environment/agent/user setup, artifact persistence and shared service startup/shutdown",
            "Native judge and its drain are timed separately; judge54 differs from upstream defaultgpt4.1-2025-04-14",
            "Failures, budget terminations and missing observations stay in success denominators; missing telemetry is not zero",
            "Explicitly invalid host timing is excluded from primary latency means, tails and paired intervals, including judge/tool clocks; rawTiming and rawTimingSeconds preserve observed values. Measured/missing counts and host-health status remain explicit, and interrupted failures stay in task denominators. Provider timing distributions are unfiltered diagnostic clocks, not primary valid-host latency.",
            "pass1 is empirical per-execution success; pass2 is both successes in declared two-trial pairs, not at-least-once success or squared pooled pass1",
            "Pointwise family-clustered95% intervals; small or zero-width intervals do not establish population certainty; no multiplicity correction",
            "Positive treatment-minus-control latency means slower; positive success means better",
            "Provider tokens/costs are observed response usage or conservative reservations, not an invoice"]}


def write_report(directory, plan, events, output, samples=5000, seed=20260919):
    output = Path(output).resolve()
    if output.exists() or output.is_relative_to(Path(directory).resolve()):
        raise ValueError("New report directory outside cohort required")
    stage = load_stage(directory, plan, events)
    report = analyze(stage, samples, seed)
    sources = stage["sources"]
    sources.track(__file__)
    for name in ("report_v3.py", "report_v4.py", "fresh_tasks.py"):
        sources.track(ROOT / "research/goalspec/src/goalspec" / name)
    sources.verify()
    output.mkdir(parents=True, exist_ok=False)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + "\n", encoding="utf-8")
    lines = [f"{report['label']}, {report['studyStage']}. Every declared trial is retained.", "",
        "| Arm | Success | Mean live interaction(s) | Primary timing n / missing / host-invalid | All physical attempts | Cost known response subtotal($) |",
        "|---|---:|---:|---:|---:|---:|"]
    for arm, item in report["arms"].items():
        latency, physical = item["metrics"]["liveTotalMeanSeconds"]["estimate"], item["counts"]["physicalCalls"]
        quality = item["timingQuality"]
        measured = f"{quality['primaryLiveMeasuredTrials']} / {quality['primaryLiveMissingTrials']} / {quality['explicitlyInvalidTimingTrials']}"
        display = str(physical["knownSum"]) if physical["missingTrials"] == 0 else f"{physical['knownSum']} known subtotal; {physical['missingTrials']} missing"
        latency_display = f"{latency:.3f}" if latency is not None else "unavailable"
        lines.append(f"| {arm} | {item['successes']}/{item['trials']} | {latency_display} | {measured} | {display} | {item['cost']['knownUsageSubtotalUsd']:.6f} |")
    lines += ["", "The v4 arm is the frozen legacy policy within the common current harness. It is not a pooled historical before/after comparison.", "",
        "Full family-paired intervals, domains, two-trial consistency, known/missing physical work, per-model tokens and cost distinctions are in report.json.", ""]
    lines += [f"- {item}" for item in report["limitations"]]
    (output / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    sources.verify()
    manifest = {"version": VERSION, "sources": sources.hashes, "outputs": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in output.iterdir()},
        "providerCalls": 0, "privateReadsAfterClosure": True, "scoresModified": False}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-directory", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--events", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20260919)
    args = parser.parse_args()
    report = write_report(args.run_directory, args.plan, args.events, args.output, args.bootstrap_samples, args.seed)
    print(json.dumps({"output": str(args.output), "trials": len(report["trials"]), "successes": {arm: row["successes"] for arm, row in report["arms"].items()}}))
