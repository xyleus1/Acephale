"""Offline v2 report builder. Reads completed cohorts; never dispatches model work."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from jsonschema import Draft202012Validator

REPORT_ROOT = Path(__file__).resolve().parent
ROOT = REPORT_ROOT.parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from goalspec.contracts_v1 import hash_v1  # noqa: E402
from goalspec.evaluation_v1 import TrialResult, cluster_interval, summarize_live  # noqa: E402
from goalspec.live_design import ARMS  # noqa: E402
from goalspec.training_export import READS  # noqa: E402

STAGES = ("development-1", "development-2", "confirmation")
TIMINGS = {
    "latencyMs": ("ms", "native orchestration through termination, before managed-worker drain"),
    "totalTrialSeconds": ("s", "native orchestration plus acknowledged actor/user managed-work drain"),
    "serviceDrainSeconds": ("s", "time spent requesting and awaiting both managed-worker closes"),
}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def file_record(path):
    path = Path(path).resolve()
    with path.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path), "sha256": sha, "bytes": path.stat().st_size}


def distribution(values, total):
    present = [value for value in values if value is not None]
    if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in present):
        raise ValueError("Telemetry values must be finite and nonnegative")
    return {"measuredTrials": len(present), "missingTrials": total - len(present),
            "sum": sum(present) if len(present) == total else None,
            "observedSum": sum(present) if present else None,
            "mean": float(np.mean(present)) if present else None,
            "median": float(np.median(present)) if present else None,
            "p95": float(np.quantile(present, .95)) if present else None,
            "maximum": max(present) if present else None}


def independent_goal_check(goals, sources, validator):
    """Same structural/mass/current-source requirements as runtime validateGoals."""
    validator.validate(goals)
    weights = [goals["unknown"], *(goal["probability"] for goal in goals["hypotheses"])]
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in weights):
        raise ValueError("nonfinite_or_boolean_probability")
    if abs(sum(weights) - 1) > 1e-6:
        raise ValueError("invalid_probability_mass")
    for goal in goals["hypotheses"]:
        refs = goal["sources"] + [ref for constraint in goal["constraints"] for ref in constraint["sources"]]
        for ref in refs:
            if ref["sourceId"] not in sources:
                raise ValueError("source_not_visible")
            value = sources[ref["sourceId"]]
            for key in ref["path"]:
                if isinstance(value, list):
                    if type(key) is not int or not 0 <= key < len(value):
                        raise ValueError("array_source_path_not_visible")
                    value = value[key]
                elif isinstance(value, dict) and str(key) in value:
                    value = value[str(key)]
                else:
                    raise ValueError("source_path_not_visible")
    return sum(weights[1:]) > 1e-6


def event_files(paths):
    files = set()
    for raw in paths:
        path = Path(raw).resolve()
        if path.is_dir():
            files.update(path.glob("events*.jsonl"))
        elif path.is_file():
            files.add(path)
        else:
            raise FileNotFoundError(path)
    if paths and not files:
        raise ValueError("No event logs found in the supplied paths")
    return sorted(files)


def events(paths, evidence):
    """Snapshot existing byte prefixes, with full chained-event integrity checks."""
    for path in event_files(paths):
        remaining = path.stat().st_size
        snapshot_size = remaining
        digest = hashlib.sha256()
        previous, sequence, count, partial = "0" * 64, 0, 0, False
        with path.open("rb") as stream:
            while remaining:
                line = stream.readline(remaining)
                if not line:
                    raise ValueError(f"Event log shrank while reading: {path}")
                digest.update(line)
                remaining -= len(line)
                if not line.endswith(b"\n"):
                    partial = True
                    break
                record = json.loads(line)
                body = record["body"]
                if (body["previousHash"] != previous or body["sequence"] != sequence
                        or record["hash"] != hash_v1(body)):
                    raise ValueError(f"Event chain integrity failure: {path}:{sequence}")
                previous, sequence = record["hash"], sequence + 1
                count += 1
                payload = body["event"]
                wrapper_run = payload.get("runId")
                if isinstance(payload.get("event"), dict):
                    payload = payload["event"]
                yield wrapper_run or payload.get("runId"), payload
        evidence.append({"path": str(path), "snapshotBytes": snapshot_size,
                         "snapshotSha256": digest.hexdigest(), "completeRecords": count,
                         "partialTailIgnored": partial, "chainVerified": True})


def event_diagnostics(paths, runs, evidence):
    schema = read(ROOT / "src/lib/goalspec/contracts/v1.schema.json")
    validator = Draft202012Validator({**schema, "$ref": "#/$defs/GoalSet"})
    evidence.append(file_record(ROOT / "src/lib/goalspec/contracts/v1.schema.json"))
    by_run = defaultdict(lambda: {"events": Counter(), "goalInvalidReasons": Counter(),
        "predictionRejections": Counter(), "schedulerRejections": Counter(), "candidateAdmissionRejections": Counter(),
        "predictionCycleFailures": Counter(), "knownUsageByRoleMicrodollars": Counter(),
        "providerFailuresByRole": Counter(), "contexts": {}, "goalResponses": 0})
    for wrapper_run, event in events(paths, evidence):
        run = wrapper_run
        if run not in runs and isinstance(run, str) and run.endswith(":user"):
            run = run[:-5]
        if run not in runs:
            continue
        item = by_run[run]
        kind = event.get("type", "compiler_metadata" if "compilerVersion" in event else "other")
        item["events"][kind] += 1
        if kind == "decision_context":
            frame = event["frame"]
            key = frame["boundary"]
            signature = hash_v1({"goals": frame["goals"], "sources": frame["sources"]})
            if key in item["contexts"]:
                if item["contexts"][key]["signature"] != signature:
                    raise ValueError(f"Conflicting decision contexts for {run}:{key}")
                continue
            try:
                nonunknown = independent_goal_check(frame["goals"], frame["sources"], validator)
                valid = True
            except Exception as error:
                valid, nonunknown = False, False
                reason = str(error) if isinstance(error, ValueError) else type(error).__name__
                item["goalInvalidReasons"][reason] += 1
            item["contexts"][key] = {"signature": signature, "valid": valid, "nonunknown": nonunknown}
        if kind == "prediction_response" and event.get("role") == "goal":
            item["goalResponses"] += 1
        if kind == "prediction_rejected":
            item["predictionRejections"][f"{event.get('role', 'unknown')}:{event.get('reason', 'unknown')}"] += 1
        if kind == "prediction_cycle_failed":
            item["predictionCycleFailures"][event.get("errorType", "unknown")] += 1
        if kind == "rejected":
            item["schedulerRejections"][event.get("details", {}).get("reason", "unknown")] += 1
        if kind == "candidate_prediction" and event.get("admission") is False:
            item["candidateAdmissionRejections"][event.get("reason", "unknown")] += 1
        if kind in {"model_attempt", "embedding", "model_attempt_failed", "embedding_failed"}:
            identity = str(event.get("id", ""))
            role = ("embedding" if kind.startswith("embedding") else "user" if identity.endswith(":user")
                    else "actor" if identity.endswith(":actor") else "goal" if identity.startswith("goal:")
                    else "candidate" if identity.startswith("candidate-v2:") else "unclassified")
            if kind.endswith("failed"):
                item["providerFailuresByRole"][role] += 1
            else:
                cost = event.get("costMicrodollars")
                if type(cost) is not int or cost < 0:
                    raise ValueError("Priced provider events need integer microdollars")
                item["knownUsageByRoleMicrodollars"][role] += cost
    result = {}
    for run in runs:
        item = by_run[run]
        contexts = list(item.pop("contexts").values())
        item.update({"decisionContexts": len(contexts), "validGoalContexts": sum(c["valid"] for c in contexts),
                     "nonunknownGoalContexts": sum(c["nonunknown"] for c in contexts)})
        result[run] = dict(item)
    return result


def native_read_counts(path, row):
    """Separate read executions only when transcript calls reconcile with counters."""
    if not path.exists():
        return {"authoritativeReads": None, "physicalReads": None, "reason": "native_record_missing"}
    native = read(path)
    if native["record"] != row:
        raise ValueError("Native record differs from outcomes JSONL")
    calls, answered = {}, set()
    for message in native["simulation"]["messages"]:
        for call in message.get("tool_calls") or []:
            calls[call["id"]] = call
        if message.get("role") == "tool":
            answered.add(message["id"])
    consumed = {event["call_id"] for event in native.get("promotionEvents", []) if event["status"] == "consumed"}
    user_messages = [message.get("content") or "" for message in native["simulation"]["messages"] if message.get("role") == "user"]
    assistant_messages = [message["content"] for message in native["simulation"]["messages"] if message.get("role") == "assistant" and message.get("content")]
    panel = {"sourceRecord": str(path.resolve()), "publicUserMessages": user_messages,
             "lastAssistantMessage": assistant_messages[-1] if assistant_messages else None,
             "actorToolSequence": [{key: call.get(key) for key in ("id", "name", "arguments")} for call in calls.values()],
             "independentVerdict": {key: native["verdict"].get(key) for key in
                                    ("stateMatch", "communicationMatch", "constraintViolations", "violations")}}
    physical = answered - consumed
    if (not answered <= calls.keys() or not consumed <= answered or len(physical) != row.get("authoritativeCalls")
            or len(consumed) != row.get("usefulCalls")):
        return {"authoritativeReads": None, "physicalReads": None, "reason": "transcript_counter_mismatch", "panel": panel}
    reads = sum(calls[key]["name"] in READS[row["domain"]] for key in physical)
    spec, revalidation = row.get("speculativeCalls"), row.get("revalidationCalls")
    return {"authoritativeReads": reads,
            "physicalReads": reads + spec + revalidation if spec is not None and revalidation is not None else None,
            "reason": None, "panel": panel}


def stage_summary(stage, directory, study_directory, seed, samples, evidence):
    design_path, outcomes_path, summary_path = (directory / name for name in ("design.json", "outcomes.jsonl", "summary.json"))
    design, rows, native_summary = read(design_path), jsonl(outcomes_path), read(summary_path)
    if design.get("studyStage") != stage or any(row.get("studyStage") != stage for row in rows):
        raise ValueError("Stage identity mismatch")
    claim_path = study_directory / f"{stage}-claim.json"
    claim = read(claim_path)
    claimed_design_path = Path(claim["designPath"])
    claimed = read(claimed_design_path)
    if file_record(claimed_design_path)["sha256"] != claim["designSha256"] or Path(claim["outputPath"]).resolve() != directory:
        raise ValueError("Claimed design or output differs")
    if claimed["trials"] != design["trials"] or any(row.get("studyId") != claim["studyId"] for row in rows):
        raise ValueError("Claimed cohort identity differs")
    if native_summary.get("studyId") != claim["studyId"] or native_summary.get("studyStage") != stage:
        raise ValueError("Service summary belongs to another study stage")
    expected_allowances = {(trial["family"], str(trial["variant"]), trial["trial"], trial["arm"]): trial["reserved_usd"] for trial in claimed["trials"]}
    if any(row.get("reservedUsd") != expected_allowances[(row["familyId"], str(row["variant"]), row["trial"], row["arm"])] for row in rows):
        raise ValueError("Trial allowance differs from the claimed paired design")
    parsed = [TrialResult.model_validate(row) for row in rows]
    result = summarize_live(parsed, expected=claimed["trials"], seed=seed, bootstrap_samples=samples)
    for path in (design_path, outcomes_path, summary_path, claim_path, claimed_design_path):
        evidence.append(file_record(path))
    complete = study_directory / f"{stage}-complete.json"
    if complete.exists():
        receipt = read(complete)
        if receipt["outcomesSha256"] != file_record(outcomes_path)["sha256"]:
            raise ValueError("Completed outcomes changed")
        evidence.append(file_record(complete))
    reads_by_run = {}
    for row in rows:
        record_path = directory / f"{row['runId']}.json"
        reads_by_run[row["runId"]] = native_read_counts(record_path, row)
        if record_path.exists():
            evidence.append(file_record(record_path))
    for arm, metrics in result["arms"].items():
        cohort = [row for row in rows if row["arm"] == arm]
        metrics["latency"]["measurement"] = TIMINGS["latencyMs"][1]
        metrics["timings"] = {field: {**distribution([row.get(field) for row in cohort], len(cohort)), "unit": unit, "measurement": label}
                              for field, (unit, label) in TIMINGS.items()}
        metrics["drainFailures"] = sum(row.get("serviceDrainSucceeded") is False for row in cohort)
        metrics["unknownCostTrials"] = sum(row.get("billedUsd") is None or row.get("unknownProviderCharge") is True for row in cohort)
        metrics["knownUsageSubtotalUsd"] = sum(row.get("billedUsd") if row.get("billedUsd") is not None else row.get("knownUsageSubtotalUsd", 0) for row in cohort)
        metrics["knownUsageSubtotalSource"] = "native_outcome_rows"
        metrics["declaredTrialAllowanceUsd"] = sum(row["reservedUsd"] for row in cohort)
        metrics["readExecutions"] = {field: distribution([reads_by_run[row["runId"]][field] for row in cohort], len(cohort))
                                    for field in ("authoritativeReads", "physicalReads")}
        metrics["readCountUnavailableReasons"] = dict(Counter(reads_by_run[row["runId"]]["reason"] for row in cohort if reads_by_run[row["runId"]]["reason"]))
    for baseline, treatment in (("base", "neutral_memory_prefetch"), ("base", "goalspec"), ("neutral_memory_prefetch", "goalspec")):
        controls = {row.pair_key: row for row in parsed if row.arm == baseline}
        treated = [row for row in parsed if row.arm == treatment]
        for field in ("totalTrialSeconds", "serviceDrainSeconds"):
            paired = [row for row in treated if getattr(row, field, None) is not None and getattr(controls[row.pair_key], field, None) is not None]
            interval = cluster_interval(paired, lambda row, key=field, control=controls: getattr(control[row.pair_key], key) - getattr(row, key), seed=seed, bootstrap_samples=samples)
            result["pairedDifferences"].append({"baseline": baseline, "treatment": treatment, "metric": field,
                "direction": "positive_favors_treatment", "pairedTrials": len(paired), "missingPairs": len(treated) - len(paired), **interval})
    result["trialDiagnostics"] = [{**{key: row.get(key) for key in
        ("runId", "familyId", "taskId", "variant", "trial", "arm", "success", "constraintViolations", "termination", "nativeTermination",
         "latencyMs", "totalTrialSeconds", "serviceDrainSeconds", "serviceDrainSucceeded", "serviceDrainErrors", "billedUsd", "unknownProviderCharge")},
        **reads_by_run[row["runId"]]} for row in rows]
    result.update({"studyStage": stage, "studyId": claim["studyId"], "stageOutput": str(directory),
                   "completeReceiptPresent": complete.exists(), "nativeService": {key: native_summary.get(key) for key in
                   ("serviceWallSeconds", "finalServiceDrainSeconds", "serviceExitCode")}})
    result["definitions"].update({"latencyMs": TIMINGS["latencyMs"][1], "totalTrialSeconds": TIMINGS["totalTrialSeconds"][1],
        "serviceDrainSeconds": TIMINGS["serviceDrainSeconds"][1], "timingSums": "sum of overlapping per-trial times, never phase wall time",
        "physicalReads": "transcript-reconciled authoritative read executions plus speculative reads plus physical freshness rereads; excludes mutations and native lease checks",
        "knownUsageSubtotalUsd": "sum of observed usage-priced costs; incomplete lower bound when any trial is unresolved, never invoice reconciled",
        "declaredTrialAllowanceUsd": "original design allowance, not current ledger spent/reserved balance"})
    return result, rows


def aggregate_events(stage, rows, diagnostics, supplied):
    for arm, metrics in stage["arms"].items():
        cohort = [row for row in rows if row["arm"] == arm]
        items = [diagnostics[row["runId"]] for row in cohort]
        totals = {key: sum(item[key] for item in items) for key in
                  ("decisionContexts", "validGoalContexts", "nonunknownGoalContexts", "goalResponses")}
        for key in ("events", "goalInvalidReasons", "predictionRejections", "schedulerRejections", "candidateAdmissionRejections",
                    "predictionCycleFailures", "knownUsageByRoleMicrodollars", "providerFailuresByRole"):
            combined = Counter()
            for item in items:
                combined.update(item[key])
            totals[key] = dict(combined)
        totals.update({"eventLogsSupplied": supplied, "runsWithDecisionContexts": sum(item["decisionContexts"] > 0 for item in items),
                       "runsWithNonunknownGoals": sum(item["nonunknownGoalContexts"] > 0 for item in items),
                       "declaredTrials": len(cohort), "goalContextApplicable": arm != "base",
                       "validityMeaning": "canonical shape, probability mass and references visible in the same frame; not semantic goal accuracy",
                       "cycleCompletedMeaning": "settled cycles including failures; completed does not imply successful prediction"})
        if supplied:
            totals["knownUsageSubtotalUsd"] = sum(totals["knownUsageByRoleMicrodollars"].values()) / 1_000_000
            totals["nativeRowKnownSubtotalUsd"] = metrics["knownUsageSubtotalUsd"]
            totals["knownSubtotalDifferenceUsd"] = totals["knownUsageSubtotalUsd"] - metrics["knownUsageSubtotalUsd"]
            totals["pricedEventsObserved"] = totals["events"].get("model_attempt", 0) + totals["events"].get("embedding", 0)
            totals["pricedEventsInNativeRows"] = sum(row.get("providerCalls", 0) for row in cohort)
            totals["pricedEventsCoverNativeRows"] = all(item["events"].get("model_attempt", 0) + item["events"].get("embedding", 0) >= row.get("providerCalls", 0)
                                                        for row, item in zip(cohort, items, strict=True))
            if not totals["pricedEventsCoverNativeRows"]:
                raise ValueError(f"Supplied logs omit priced provider events for {stage['studyStage']}:{arm}")
            if totals["knownUsageSubtotalUsd"] + 1e-6 < metrics["knownUsageSubtotalUsd"]:
                raise ValueError("Event subtotal falls below native known usage; supplied logs are incomplete")
            metrics["knownUsageSubtotalUsd"] = totals["knownUsageSubtotalUsd"]
            metrics["knownUsageSubtotalSource"] = "verified_provider_event_logs"
        metrics["eventDiagnostics"] = totals


def smoke_summary(path, evidence):
    predictions = jsonl(path / "predictions/requested-predictions.jsonl")
    grades = jsonl(path / "grades/requested-grades.jsonl")
    queue = jsonl(path / "queue.jsonl")
    ids = {row["id"] for row in queue}
    if len(ids) != len(queue) or {row["id"] for row in predictions} != ids or {row["id"] for row in grades} != ids:
        raise ValueError("Smoke queue/cache identities differ")
    for name in ("manifest.json", "queue.jsonl", "predictions/requested-predictions.jsonl", "grades/requested-grades.jsonl"):
        evidence.append(file_record(path / name))
    return {"label": "development protocol smoke on previously observed v1 checkpoints", "checkpoints": len(queue),
            "validPredictions": sum(row["status"] == "completed" for row in predictions),
            "requestedGoalTop1Matches": sum(bool((row.get("matches") or [False])[0]) for row in grades),
            "timing": "score preceded the literal-identity-preservation prompt fix; no post-fix score supplied",
            "interpretation": "protocol validity and teacher semantic match are distinct; neither is live task success",
            "selection": read(path / "manifest.json")["selection"], "directory": str(path)}


def number(value, digits=3):
    return "unmeasured" if value is None else f"{value:.{digits}f}"


def interval_text(value, scale=1):
    ci = value["ci95"]
    return "unavailable" if ci is None else f"[{ci[0] * scale:.2f}, {ci[1] * scale:.2f}]"


def markdown(report, output):
    smoke = report["protocolSmoke"]
    lines = ["# GoalSpec local v2 study", "", "Custom tau-compatible pilot with separate development rounds and at most one confirmation cohort.", "",
             f"The earlier development protocol smoke produced {smoke['validPredictions']}/{smoke['checkpoints']} valid predictions and "
             f"{smoke['requestedGoalTop1Matches']}/{smoke['checkpoints']} teacher-scored complete-request matches. "
             "That score preceded the latest identity-preservation prompt fix. No post-fix prediction score is supplied.", "",
             "Every declared outcome, including failures, stays in its own stage. V1 scores are historical context, not a paired causal comparison on these new tasks. "
             "Development and confirmation stages are never pooled. No improvement claim is inferred from protocol validity.", "",
             "Development rounds 1 and 2 reuse the same four family IDs and request compositions, with fresh instance values and seeds. "
             "Those repeated families are not independent across stages. The confirmation family set is disjoint from the development families."]
    if not report["stages"]:
        lines += ["", "No completed live stage was supplied to this report."]
    for stage in report["stages"]:
        lines += ["", f"## {stage['studyStage']}", "", "| Arm | Success / n | Success % [family CI] | Native mean ms (n) | Total mean s (n) | Drain mean s (n) | Known usage USD | Unknown cost trials |",
                  "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |"]
        for arm, metric in stage["arms"].items():
            timing = metric["timings"]
            columns = [f"{number(timing[key]['mean'])} ({timing[key]['measuredTrials']})" for key in TIMINGS]
            success = f"{metric['nativeSuccess'] * 100:.2f} {interval_text(metric['successInterval'], 100)}"
            lines.append(f"| {arm} | {metric['successes']}/{metric['trials']} | {success} | " + " | ".join(columns)
                         + f" | {metric['knownUsageSubtotalUsd']:.6f} | {metric['unknownCostTrials']} |")
        lines += ["", "Native time ends before managed-worker drain. Total time includes that drain. Sample counts include failed trials with recorded times. "
                  "Per-trial sums overlap under concurrency and are not phase wall time. Known usage is a lower bound when costs remain unresolved, and is not invoice reconciled.", "",
                  "| Comparison | Success gain pp [family CI] | Native time saved ms [CI] | Total time saved s [CI] |",
                  "| --- | --- | --- | --- |"]
        for baseline, treatment in (("base", "neutral_memory_prefetch"), ("base", "goalspec"), ("neutral_memory_prefetch", "goalspec")):
            metrics = {row["metric"]: row for row in stage["pairedDifferences"] if row["baseline"] == baseline and row["treatment"] == treatment}
            cells = [f"{number(metrics[key]['estimate'] * scale if metrics[key]['estimate'] is not None else None)} {interval_text(metrics[key], scale)} (n={metrics[key]['pairedTrials']})"
                     for key, scale in (("success", 100), ("latencyMs", 1), ("totalTrialSeconds", 1))]
            lines.append(f"| {treatment} versus {baseline} | " + " | ".join(cells) + " |")
        lines += ["", "| Arm | Physical reads (n) | Speculative reads | Exact-call promotions | Unmatched reads | Scheduler rejections | Drain failures | Valid / observed goal contexts | Nonunknown contexts | Failed / settled cycles |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for arm, metric in stage["arms"].items():
            calls, event = metric["calls"], metric["eventDiagnostics"]
            physical = metric["readExecutions"]["physicalReads"]
            counts = [number(calls[key]["sum"], 0) for key in ("speculativeCalls", "usefulCalls", "wastedCalls", "rejectedCalls")]
            context = f"{event['validGoalContexts']}/{event['decisionContexts']}" if event["eventLogsSupplied"] and event["goalContextApplicable"] else "N/A"
            cycles = (f"{event['events'].get('prediction_cycle_failed', 0)}/{event['events'].get('prediction_cycle_completed', 0)}"
                      if event["eventLogsSupplied"] and event["goalContextApplicable"] else "N/A")
            lines.append(f"| {arm} | {number(physical['sum'], 0)} ({physical['measuredTrials']}) | " + " | ".join(counts)
                         + f" | {metric['drainFailures']} | {context} | {event['nonunknownGoalContexts'] if context != 'N/A' else 'N/A'} | {cycles} |")
        lines += ["", "Physical reads exclude mutations and lease checks; unavailable transcript/counter reconciliations stay unmeasured. "
                  "Exact-call promotions are a lower bound on usefulness; unmatched reads are an upper bound on waste. "
                  "Goal validity establishes structure and current-source references only. Cycle-completed events include failed cycles. "
                  "Scheduler rejection reasons, candidate admission rejections, and predictor contract rejections are separate JSON diagnostics."]
        lines += ["", "### Task diagnostic panels", "",
                  "These per-trial diagnostics support development decisions. They do not replace the complete cohort comparison above. "
                  "User-message excerpts and final replies are capped at 1,200 characters here; full text and tool arguments remain in summary.json."]
        for trial in stage["trialDiagnostics"]:
            panel = trial.get("panel", {})
            source = panel.get("sourceRecord")
            link = f"[native record]({Path(os.path.relpath(source, output)).as_posix()})" if source else "native record unavailable"
            lines += ["", f"<details><summary>{trial['familyId']} / variant {trial['variant']} / trial {trial['trial']} / {trial['arm']}: {'success' if trial['success'] else 'failure'}</summary>", "",
                      f"Termination: `{trial['termination']}`. Native: {number(trial['latencyMs'])} ms. "
                      f"Total: {number(trial['totalTrialSeconds'])} s. Drain: {number(trial['serviceDrainSeconds'])} s. "
                      f"Physical reads: {number(trial['physicalReads'], 0)}. {link}.", "",
                      "Public user messages:", ""]
            excerpt = "\n".join(panel.get("publicUserMessages", []))[:1200]
            lines += ["> " + line for line in excerpt.splitlines()]
            lines += ["", "Final assistant reply:", ""]
            lines += ["> " + line for line in (panel.get("lastAssistantMessage") or "No recorded final reply")[:1200].splitlines()]
            lines += ["", "Tool sequence: " + ", ".join(f"`{call['name']}`" for call in panel.get("actorToolSequence", [])),
                      "", "Independent verdict: `" + json.dumps(panel.get("independentVerdict", {}), ensure_ascii=True).replace("`", "'") + "`", "", "</details>"]
    lines += ["", "Intervals reuse evaluation_v1.py: 2,000 default percentile bootstrap draws of complete families within domains, "
              "equal domain and family weights. These exploratory 95% intervals are unadjusted for multiple comparisons; small family counts limit inference.", ""]
    return "\n".join(lines)


def publish(report, output):
    output = output.resolve()
    if not output.is_relative_to(REPORT_ROOT) or output == REPORT_ROOT:
        raise ValueError("Generated results must stay in a new subdirectory of this report directory")
    output.mkdir(parents=True, exist_ok=False)
    (output / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (output / "README.md").write_text(markdown(report, output), encoding="utf-8")
    rows = []
    differences = []
    for stage in report["stages"]:
        for arm, metric in stage["arms"].items():
            rows.append({"stage": stage["studyStage"], "arm": arm, "trials": metric["trials"], "successes": metric["successes"],
                "successRate": metric["nativeSuccess"], "successCiLow": (metric["successInterval"]["ci95"] or [None, None])[0],
                "successCiHigh": (metric["successInterval"]["ci95"] or [None, None])[1],
                **{f"{key}Mean": value["mean"] for key, value in metric["timings"].items()},
                **{f"{key}N": value["measuredTrials"] for key, value in metric["timings"].items()},
                "knownUsageSubtotalUsd": metric["knownUsageSubtotalUsd"], "unknownCostTrials": metric["unknownCostTrials"],
                "physicalReads": metric["readExecutions"]["physicalReads"]["sum"], "speculativeReads": metric["calls"]["speculativeCalls"]["sum"],
                "exactCallPromotions": metric["calls"]["usefulCalls"]["sum"], "schedulerRejections": metric["calls"]["rejectedCalls"]["sum"]})
        differences.extend({"stage": stage["studyStage"], **{key: row[key] for key in ("baseline", "treatment", "metric", "direction", "estimate", "pairedTrials", "missingPairs")},
                            "ciLow": (row["ci95"] or [None, None])[0], "ciHigh": (row["ci95"] or [None, None])[1]} for row in stage["pairedDifferences"])
    for name, data in (("arms.csv", rows), ("paired-differences.csv", differences)):
        if data:
            with (output / name).open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(data[0]))
                writer.writeheader()
                writer.writerows(data)
    manifest = {"files": [file_record(path) for path in sorted(output.iterdir()) if path.is_file()], "sourceInputs": report["sourceInputs"]}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, default=ROOT / "research/goalspec/runs/local-study-v2-20260915")
    parser.add_argument("--stage", action="append", default=[], help="development-1=DIR, development-2=DIR, or confirmation=DIR; completed cohorts only")
    parser.add_argument("--events", action="append", default=[], help="Explicit events JSONL file or directory; repeat for multiple logs")
    parser.add_argument("--smoke", type=Path, default=ROOT / "research/goalspec/runs/local-v2-protocol-smoke-b-20260915")
    parser.add_argument("--output", type=Path, required=True, help="New directory below this report directory")
    parser.add_argument("--bootstrap-samples", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    study = read(args.study / "study.json")
    evidence = [file_record(__file__), file_record(args.study / "study.json"), file_record(ROOT / "research/goalspec/src/goalspec/evaluation_v1.py")]
    stages, all_rows = [], []
    selections = {}
    for value in args.stage:
        stage, directory = value.split("=", 1)
        if stage not in STAGES or stage in selections:
            raise ValueError("Each bounded stage can appear at most once")
        selections[stage] = Path(directory).resolve()
    for stage in STAGES:
        if stage in selections:
            summary, rows = stage_summary(stage, selections[stage], args.study, args.seed, args.bootstrap_samples, evidence)
            if summary["studyId"] != study["studyId"]:
                raise ValueError("Stages cannot span studies")
            stages.append(summary)
            all_rows.extend(rows)
    if len({row["runId"] for row in all_rows}) != len(all_rows):
        raise ValueError("Stages reused a native run ID")
    diagnostics = event_diagnostics(args.events, {row["runId"] for row in all_rows}, evidence)
    for stage in stages:
        aggregate_events(stage, [row for row in all_rows if row["studyStage"] == stage["studyStage"]], diagnostics, bool(args.events))
    report = {"schemaVersion": "local-v2-report-1", "createdAtUtc": datetime.now(UTC).isoformat(), "studyId": study["studyId"],
              "stages": stages, "protocolSmoke": smoke_summary(args.smoke.resolve(), evidence), "sourceInputs": evidence,
              "developmentFamilyReuse": "both rounds reuse the same four development family IDs/compositions with fresh instances and seeds; not independent across stages",
              "interpretation": "separate exploratory development and one precommitted confirmation; no cross-stage pooling or v1 paired comparison"}
    publish(report, args.output)
    print(json.dumps({"output": str(args.output.resolve()), "stages": [stage["studyStage"] for stage in stages], "trials": len(all_rows)}))


if __name__ == "__main__":
    main()
