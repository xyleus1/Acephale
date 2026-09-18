"""Supplement a closed synthetic Derya cohort without changing its original scores."""
from __future__ import annotations
import argparse
import hashlib
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.contracts_v1 import hash_v1  # noqa: E402
from goalspec.report_v3 import distribution, percentile  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def interval(values, seed=20260919, samples=5000):
    if not values:
        return {"estimate": None, "lower": None, "upper": None, "n": 0}
    rng = random.Random(seed)
    boot = [sum(rng.choices(values, k=len(values))) / len(values) for _ in range(samples)]
    return {"estimate": sum(values) / len(values), "lower": percentile(boot, .025), "upper": percentile(boot, .975),
        "n": len(values), "clusters": len(values), "bootstrapSamples": samples, "seed": seed}


def main(args):
    output, directory = args.output.resolve(), args.run.resolve()
    if output.exists():
        raise ValueError("New supplementary output required")
    sources = {}
    def load(path, lines=False):
        path = Path(path).resolve(); sources[str(path)] = sha(path)
        text = path.read_text(encoding="utf-8")
        return [json.loads(line) for line in text.splitlines() if line] if lines else json.loads(text)
    plan = load(args.plan); summary = load(directory / "summary.json"); rows = load(directory / "outcomes.jsonl", True)
    dispatch = load(directory / "dispatch.json"); guarded = load(args.guard, True)
    if plan["hash"] != hash_v1({k: v for k, v in plan.items() if k != "hash"}) or sha(args.plan) != dispatch["planSha256"]:
        raise ValueError("Frozen plan changed")
    if summary["version"] != "derya-live-read-v5.1" or summary["planHash"] != plan["hash"] or summary["trials"] != rows:
        raise ValueError("Original summary/outcome equality failed")
    if not summary["completeDeclaredCohort"] or not summary["integrityPassed"] or summary["globalFailure"] is not None:
        raise ValueError("Whole healthy closed cohort required")
    close = guarded[-1]
    if close.get("event") != "guard_closed" or close.get("guardExitCode") != 0 or close.get("childExitCode") != 0 or close.get("degradedDuringRun") is not False:
        raise ValueError("Healthy closed guard required")
    tasks = {task["taskId"]: task for task in plan["tasks"]}
    if len(tasks) != 12 or len({task["familyId"] for task in tasks.values()}) != 12 or len(rows) != 36 or len(plan["trials"]) != 36:
        raise ValueError("Expected twelve predeclared families and36trials")
    expected = {trial["runId"]: trial for trial in plan["trials"]}
    if len(expected) != 36 or {row["runId"] for row in rows} != set(expected):
        raise ValueError("Incomplete or duplicated trial grid")
    for row in rows:
        trial = expected[row["runId"]]
        if row["taskId"] != trial["taskId"] or row["arm"] != trial["arm"] or row["familyId"] != tasks[row["taskId"]]["familyId"] or type(row["success"]) is not bool:
            raise ValueError("Declared trial identity changed")
    for entry in [*plan["sources"], plan["privateTruth"], plan["fixtureSource"], plan["profileReport"]]:
        path = Path(entry["path"]); sources[str(path.resolve())] = sha(path)
        if sources[str(path.resolve())] != entry["sha256"]:
            raise ValueError("Frozen source/input changed")
    events = load(directory / "events.jsonl", True); previous = "0" * 64; by_run = defaultdict(list); outcome_events = {}
    for sequence, event in enumerate(events):
        body = event["body"]
        if body["sequence"] != sequence or body["previousHash"] != previous or hash_v1(body) != event["hash"]:
            raise ValueError("Provider/runtime event chain changed")
        previous = event["hash"]; record = body["event"]
        if record.get("runId") in expected:
            by_run[record["runId"]].append(record)
        if record.get("type") == "trial_outcome":
            if record["runId"] in outcome_events:
                raise ValueError("Duplicated event outcome")
            outcome_events[record["runId"]] = {k: v for k, v in record.items() if k != "type"}
    if outcome_events != {row["runId"]: row for row in rows}:
        raise ValueError("Event/outcome grid differs")
    reports = []
    for original in summary["arms"]:
        selected = [row for row in rows if row["arm"] == original["arm"]]
        if len(selected) != 12 or len({row["familyId"] for row in selected}) != 12 or sum(row["success"] for row in selected) != original["successes"]:
            raise ValueError("Arm/family counts changed")
        provider = [event for row in selected for event in by_run[row["runId"]] if event.get("type") in {"model_attempt", "model_attempt_failed"}]
        known = sum(event.get("costMicrodollars", 0) for event in provider)
        if known != sum(row["knownUsageSubtotalMicrodollars"] for row in selected):
            raise ValueError("Provider known-cost sum differs")
        groups = defaultdict(list)
        for event in provider:
            role = "actor" if ":actor:" in event.get("id", "") else "goal_predictor"
            groups[role].append(event)
        physical = {key: {"knownSum": sum(row.get(key) or 0 for row in selected), "missingTrials": sum(row.get(key) is None for row in selected)}
            for key in ("physicalToolReads", "physicalSqlStatements", "logicalToolCalls", "authoritativeReads", "speculativeReads", "revalidationCalls", "projectionReads", "actorRequests", "predictionRequests")}
        reports.append({**original, "metrics": {"taskSuccess": interval([int(row["success"]) for row in selected]),
            "meanLiveSeconds": interval([row["totalTrialSeconds"] for row in selected if isinstance(row.get("totalTrialSeconds"), (int, float))]),
            "allPhysicalToolReadsPerSuccess": physical["physicalToolReads"]["knownSum"] / original["successes"] if original["successes"] and physical["physicalToolReads"]["missingTrials"] == 0 else None},
            "liveSeconds": distribution([row.get("totalTrialSeconds") for row in selected]), "counts": physical,
            "provider": {role: {"physicalAttempts": len(items), "missingUsage": sum(not isinstance(item.get("usage"), dict) for item in items),
                "inputTokens": sum((item.get("usage") or {}).get("input_tokens", 0) for item in items),
                "outputTokens": sum((item.get("usage") or {}).get("output_tokens", 0) for item in items),
                "cachedInputTokens": sum((item.get("usage") or {}).get("input_tokens_details", {}).get("cached_tokens", 0) for item in items),
                "reasoningTokens": sum((item.get("usage") or {}).get("output_tokens_details", {}).get("reasoning_tokens", 0) for item in items)} for role, items in groups.items()},
            "cost": {"knownResponseUsageUsd": known / 1e6, "unknownRequestCount": sum(row["unknownRequestCount"] for row in selected), "invoiceClaim": False}})
    base = {row["familyId"]: row for row in rows if row["arm"] == "base"}
    paired = {}
    for arm in [item["arm"] for item in summary["arms"] if item["arm"] != "base"]:
        selected = [row for row in rows if row["arm"] == arm]
        if len(selected) != 12:
            raise ValueError("Missing declared comparison arm")
        paired[f"{arm}-minus-base"] = {"families": 12, "matchedTrials": 12,
            "latencySeconds": interval([row["totalTrialSeconds"] - base[row["familyId"]]["totalTrialSeconds"] for row in selected]),
            "success": interval([int(row["success"]) - int(base[row["familyId"]]["success"]) for row in selected])}
    report = {**summary, "arms": reports, "supplementVersion": "derya-live-v5-supplement-v1", "paired": paired,
        "verification": {"declaredTrials": 36, "predeclaredFamilies": 12, "eventRecords": len(events), "eventFinalHash": previous, "guardClosedHealthy": True, "originalScoresChanged": False},
        "limitations": ["Twelve predeclared synthetic request families share five tools and common fixture state; family bootstrap does not remove shared-tool/database correlation.",
            "Observed p95 has only12samples per arm; no precise tail or population-success claim follows from12/12success.",
            "Clock includes per-trial connection setup, actor/tool work, managed predictor drain and disconnect; shared ledger recovery and source/fixture preflight are excluded.",
            "All physical tool reads, SQL statements and provider attempts are different quantities. Known response usage is not an invoice.",
            "Cold business controller and no business memory; no epoch reuse or official benchmark claim. Positive paired latency means slower."]}
    for path in [Path(__file__), ROOT / "research/goalspec/src/goalspec/report_v3.py", ROOT / "research/goalspec/src/goalspec/contracts_v1.py"]:
        sources[str(path.resolve())] = sha(path)
    for path, expected_hash in sources.items():
        if sha(path) != expected_hash:
            raise ValueError("Source changed during analysis")
    output.mkdir(parents=True)
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    table = ["Synthetic Derya live read tasks; original36scores retained.", "", "| Arm | Success | Mean seconds | p95(n12) | Tool reads | SQL statements | Usage USD |", "|---|---:|---:|---:|---:|---:|---:|"]
    for arm in reports:
        table.append(f"| {arm['arm']} | {arm['successes']}/12 | {arm['meanTotalTrialSeconds']:.6f} | {arm['liveSeconds']['p95']:.6f} | {arm['counts']['physicalToolReads']['knownSum']} | {arm['counts']['physicalSqlStatements']['knownSum']} | {arm['cost']['knownResponseUsageUsd']:.6f} |")
    table += ["", "Paired intervals and provider token/attempt counts are in report.json.", "", *[f"- {item}" for item in report["limitations"]]]
    (output / "README.md").write_text("\n".join(table) + "\n", encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({"version": report["supplementVersion"], "sources": sources,
        "outputs": {path.name: sha(path) for path in output.iterdir()}, "providerCalls": 0, "immutable": True}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "paired": paired, "arms": [{"arm": row["arm"], "counts": row["counts"], "provider": row["provider"], "cost": row["cost"], "p95": row["liveSeconds"]["p95"]} for row in reports], "reportSha256": sha(output / "report.json")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("run", "plan", "guard", "output"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    main(parser.parse_args())
