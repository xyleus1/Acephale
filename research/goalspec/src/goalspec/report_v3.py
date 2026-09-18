"""Offline reporting for closed official-task cohorts; never loads runtime credentials."""
from __future__ import annotations

import csv
import hashlib
import itertools
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import rfc8785

ARMS = ("base", "paste", "salesforce", "goalspec")
TIMINGS = ("nativeOrchestrationSeconds", "serviceDrainSeconds", "totalTrialSeconds",
           "evaluationSeconds", "totalIncludingEvaluationSeconds")
COUNTS = ("authoritativeCalls", "speculativeCalls", "usefulCalls", "reportedUnpromotedCalls",
          "freshnessChecks", "revalidationCalls", "nativeToolResponses", "nativeToolErrorResponses")
METRICS = ("successRate", "bothTrialsSuccessRate", "nativeToolNonErrorRate",
           "goldToolNameRecall", "goldFullArgumentsRecall", "liveTotalMeanSeconds")


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def percentile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * probability
    lo, hi = math.floor(position), math.ceil(position)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


def distribution(values, total=None):
    measured = [float(v) for v in values if number(v) and v >= 0]
    return {"n": len(measured), "missing": (len(values) if total is None else total) - len(measured),
            "mean": statistics.mean(measured) if measured else None,
            "median": statistics.median(measured) if measured else None,
            "p95": percentile(measured, .95), "sum": sum(measured) if measured else None}


def task_key(row):
    return row["domain"], str(row["taskId"])


def _key(value):
    # JSON number 1 and 1.0 denote the same argument; booleans stay distinct.
    def normalize(item):
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: normalize(val) for key, val in item.items()}
        if isinstance(item, list):
            return [normalize(val) for val in item]
        return item
    return json.dumps(normalize(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def gold_recall(artifact):
    task = artifact.get("officialTask")
    criteria = task.get("evaluation_criteria") if isinstance(task, dict) else None
    if not isinstance(criteria, dict) or not isinstance(criteria.get("actions"), list):
        return {"available": False, "goldActions": None, "toolNameMatches": None, "fullArgumentsMatches": None}
    gold = [action for action in criteria["actions"] if action.get("requestor", "assistant") == "assistant"]
    actual = [call for message in (artifact.get("simulation") or {}).get("messages", [])
              if message.get("role") == "assistant" for call in message.get("tool_calls") or []
              if call.get("requestor", "assistant") == "assistant"]
    names = Counter(action["name"] for action in gold)
    calls = Counter(call["name"] for call in actual)
    full = Counter(_key([action["name"], action["arguments"]]) for action in gold)
    attempted = Counter(_key([call["name"], call["arguments"]]) for call in actual)
    return {"available": True, "goldActions": len(gold), "toolNameMatches": sum((names & calls).values()),
            "fullArgumentsMatches": sum((full & attempted).values()), "actualAssistantCalls": len(actual)}


def assertion_audit(artifact):
    criteria = (artifact.get("officialTask") or {}).get("evaluation_criteria")
    reward = artifact.get("officialRewardInfo") or {}
    basis = reward.get("reward_basis")
    source = "officialRewardInfo"
    if not isinstance(basis, list):
        basis = criteria.get("reward_basis") if isinstance(criteria, dict) else None
        source = "officialTask" if isinstance(basis, list) else None
    basis = basis if isinstance(basis, list) else None
    expected = (criteria.get("nl_assertions") or []) if isinstance(criteria, dict) else None
    expected = expected if isinstance(expected, list) else None
    checks = reward.get("nl_assertions") or []
    checks = checks if isinstance(checks, list) else []
    actual = Counter(_key(check["nl_assertion"]) for check in checks
                     if isinstance(check, dict) and "nl_assertion" in check and isinstance(check.get("met"), bool))
    matched = sum((Counter(_key(item) for item in expected) & actual).values()) if expected is not None else None
    selected = "NL_ASSERTION" in basis if basis is not None else None
    if selected is None:
        status = "basis_unknown"
    elif not selected:
        status = "not_selected"
    elif expected is None:
        status = "selected_expectations_missing"
    elif not expected:
        status = "selected_empty"
    else:
        status = "selected_covered" if matched == len(expected) else "selected_missing"
    return {"status": status, "rewardBasis": basis, "rewardBasisSource": source, "selectedByRewardBasis": selected,
            "expectedAssertions": len(expected) if expected is not None else None, "recordedChecks": len(checks),
            "matchedExpectedAssertions": matched, "missingRequiredAssertions": len(expected) - matched if selected and expected is not None else None,
            "coverageComplete": status in ("selected_empty", "selected_covered") if selected else None}


def exposed_evidence(artifact):
    identifiers = set()
    appearances = 0
    for message in (artifact.get("simulation") or {}).get("messages", []):
        raw = message.get("raw_data") or {}
        if message.get("role") != "assistant" or not isinstance(raw, dict):
            continue
        for evidence in raw.get("goalspecVerifiedEvidence") or []:
            if isinstance(evidence, dict) and isinstance(evidence.get("id"), str):
                identifiers.add(evidence["id"])
                appearances += 1
    return {"distinctRecordedEvidenceIds": len(identifiers), "recordedEvidenceAppearances": appearances,
            "meaning": "Typed evidence recorded in assistant runtime metadata; exposure does not prove consumption"}


def load_stage(directory):
    directory = Path(directory).resolve()
    # A summary is emitted after service closure. Do not inspect task contents
    # until outcomes exist and the complete declared cohort is accounted for.
    summary, design = read(directory / "summary.json"), read(directory / "design.json")
    with (directory / "outcomes.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    if len(rows) != len(design["trials"]) or not rows or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("Closed report requires every declared outcome exactly once")
    fields = ("domain", "taskId", "trial", "seed", "arm")
    if Counter(tuple(str(row[field]) for field in fields) for row in rows) != Counter(
            tuple(str(trial[field]) for field in fields) for trial in design["trials"]):
        raise ValueError("Outcome task/arm/seed pairing differs from declared design")
    sources = [directory / name for name in ("summary.json", "design.json", "outcomes.jsonl")]
    for row in rows:
        if row["arm"] not in ARMS or not isinstance(row.get("success"), bool):
            raise ValueError("Invalid official outcome arm or success value")
        if row["success"] and row.get("officialReward") != 1:
            raise ValueError("Successful outcome lacks native reward one")
        run_id = row["runId"]
        if not isinstance(run_id, str) or Path(run_id).name != run_id or "/" in run_id or "\\" in run_id:
            raise ValueError("Invalid artifact identifier")
        if row.get("termination") == "stage_abort":
            receipt = directory / "stage-abort.json"
            if not isinstance(read(receipt), dict):
                raise ValueError("Stage-abort outcome lacks cohort abort receipt")
            sources.append(receipt)
            path = directory / f"{run_id}-stage-abort.json"
        else:
            path = directory / f"{run_id}.json"
        artifact = read(path)
        if artifact.get("record") != row:
            raise ValueError("Native artifact record differs from immutable outcome")
        sources.append(path)
        row["goldDiagnostic"] = gold_recall(artifact)
        row["assertionAudit"] = assertion_audit(artifact)
        row["exposedEvidence"] = exposed_evidence(artifact)
        # The upstream harness calls speculative-minus-promoted "wasted".
        # Exposed evidence can replace a later call without an exact promotion.
        row["reportedUnpromotedCalls"] = row.get("wastedCalls")
        row["nativeToolTimings"] = artifact.get("nativeToolTimings")
        row["consumedPromotionReceipts"] = sum(event.get("status") == "consumed" for event in artifact.get("promotionEvents", []))
        row["promotionReceiptMatchesCount"] = row.get("usefulCalls") == row["consumedPromotionReceipts"] if "usefulCalls" in row else None
    return {"directory": directory, "summary": summary, "design": design, "rows": rows, "sources": sources}


def _ratio(pair):
    return pair[0] / pair[1] if pair[1] else None


def _pairs(rows):
    tools = [row for row in rows if number(row.get("nativeToolResponses")) and number(row.get("nativeToolErrorResponses"))]
    gold = [row["goldDiagnostic"] for row in rows if row["goldDiagnostic"]["available"]]
    live = [row["totalTrialSeconds"] for row in rows if number(row.get("totalTrialSeconds")) and row["totalTrialSeconds"] >= 0]
    complete_pair = len(rows) == 2 and len({row["trial"] for row in rows}) == 2
    return {"successRate": (sum(row["success"] for row in rows), len(rows)),
            "bothTrialsSuccessRate": (int(all(row["success"] for row in rows)) if complete_pair else 0, int(complete_pair)),
            "nativeToolNonErrorRate": (sum(row["nativeToolResponses"] - row["nativeToolErrorResponses"] for row in tools), sum(row["nativeToolResponses"] for row in tools)),
            "goldToolNameRecall": (sum(row["toolNameMatches"] for row in gold), sum(row["goldActions"] for row in gold)),
            "goldFullArgumentsRecall": (sum(row["fullArgumentsMatches"] for row in gold), sum(row["goldActions"] for row in gold)),
            "liveTotalMeanSeconds": (sum(live), len(live))}


def _sum_pairs(pairs):
    numerator = denominator = 0
    for first, second in pairs:
        numerator += first
        denominator += second
    return numerator, denominator


def cluster_interval(pairs, samples, seed, controls=None):
    estimate = _ratio(_sum_pairs(pairs))
    if controls is not None:
        control = _ratio(_sum_pairs(controls))
        estimate = estimate - control if estimate is not None and control is not None else None
    eligible = [i for i, pair in enumerate(pairs) if pair[1] and (controls is None or controls[i][1])]
    if len(eligible) < 2 or estimate is None:
        return {"estimate": estimate, "lower": None, "upper": None, "clusters": len(eligible), "bootstrapSamplesUsed": 0,
                "unavailableReason": "fewer than two measured task clusters"}
    # Resampling one task carries both repetitions and, for paired comparisons,
    # all matching arms. Denominator weighting remains that of the reported rate.
    rng = random.Random(seed)
    draws = []
    for _ in range(samples):
        indices = rng.choices(eligible, k=len(eligible))
        value = _ratio(_sum_pairs(pairs[i] for i in indices))
        if controls is not None:
            value -= _ratio(_sum_pairs(controls[i] for i in indices))
        draws.append(value)
    return {"estimate": estimate, "lower": percentile(draws, .025), "upper": percentile(draws, .975),
            "clusters": len(eligible), "bootstrapSamplesUsed": len(draws), "unavailableReason": None}


def summarize_arm(rows, samples, seed):
    groups = defaultdict(list)
    for row in rows:
        groups[task_key(row)].append(row)
    cluster_pairs = [_pairs(group) for _, group in sorted(groups.items())]
    known = [row.get("knownUsageSubtotalUsd", row.get("billedUsd")) for row in rows]
    uncertain = [row for row in rows if row.get("unknownProviderCharge") or row.get("unknownEvaluatorCharge")]
    commitment = [row.get("reservedUsd") if row in uncertain else row.get("billedUsd") for row in rows]
    native_timings = [timing for row in rows for timing in row.get("nativeToolTimings") or []]
    operations = sorted({timing["operation"] for timing in native_timings})
    successes = sum(row["success"] for row in rows)
    measured_tools = sum(isinstance(row.get("nativeToolTimings"), list) for row in rows)
    physical_attempts = sum(t["operation"] in ("authoritative_tool", "speculative_native_tool") for t in native_timings)
    measured_rewards = [row["officialReward"] for row in rows if number(row.get("officialReward"))]
    paired_tasks = [group for group in groups.values() if len(group) == 2 and len({row["trial"] for row in group}) == 2]
    consistency = Counter(sum(row["success"] for row in group) for group in paired_tasks)
    return {"trials": len(rows), "tasks": len(groups), "successes": sum(row["success"] for row in rows),
            "failures": sum(not row["success"] for row in rows), "terminationCounts": dict(Counter(row.get("termination", "unknown") for row in rows)),
            "twoTrialConsistency": {"eligibleTasks": len(paired_tasks), "ineligibleTasks": len(groups) - len(paired_tasks),
                                    "bothSucceeded": consistency[2], "exactlyOneSucceeded": consistency[1], "neitherSucceeded": consistency[0],
                                    "meaning": "Observed pass^2 is both-successful tasks divided by eligible two-trial tasks. It is not squared pooled pass1 or at-least-once success."},
            "officialRewardAudit": {"measuredTrials": len(measured_rewards), "missingTrials": len(rows) - len(measured_rewards),
                                    "rewardOneTrials": sum(value == 1 for value in measured_rewards),
                                    "rewardNotOneTrials": sum(value != 1 for value in measured_rewards),
                                    "meanAmongMeasured": statistics.mean(measured_rewards) if measured_rewards else None,
                                    "rewardOneButPrimaryFailure": sum(row.get("officialReward") == 1 and not row["success"] for row in rows),
                                    "evaluationErrorTrials": sum(row.get("evaluationErrorType") is not None for row in rows),
                                    "meaning": "Raw upstream reward availability and values are descriptive. Primary success still requires reward one and no execution, drain, or evaluation failure; missing rewards remain primary failures."},
            "nativeAssertionAudit": {"judgeCoverageTrue": sum(row.get("judgeAssertionCoverage") is True for row in rows),
                                     "judgeCoverageFalse": sum(row.get("judgeAssertionCoverage") is False for row in rows),
                                     "judgeCoverageUnmeasured": sum(not isinstance(row.get("judgeAssertionCoverage"), bool) for row in rows),
                                     "constraintStatusCounts": dict(Counter(row.get("constraintStatus", "not_measured") for row in rows)),
                                     "failedAssertions": sum(row["constraintViolations"] for row in rows if number(row.get("constraintViolations"))),
                                     "measuredTrials": sum(number(row.get("constraintViolations")) for row in rows),
                                     "applicabilityCounts": dict(Counter(row["assertionAudit"]["status"] for row in rows)),
                                     "requiredAssertionTrials": sum(row["assertionAudit"]["status"] in ("selected_covered", "selected_missing") for row in rows),
                                     "missingRequiredAssertions": sum(row["assertionAudit"]["missingRequiredAssertions"] or 0 for row in rows),
                                     "meaning": "Applicability follows the recorded reward basis. Raw judgeCoverage flags remain unchanged; false may mean NL_ASSERTION was not selected. Empty selected assertion sets need no judge. Assertion results are not an exhaustive policy audit."},
            "metrics": {metric: cluster_interval([pairs[metric] for pairs in cluster_pairs], samples, seed) for metric in METRICS},
            "timingSeconds": {key: distribution([row.get(key) for row in rows]) for key in TIMINGS},
            "counts": {key: {"sum": sum(row[key] for row in rows if number(row.get(key))),
                             "measuredTrials": sum(number(row.get(key)) for row in rows)} for key in COUNTS},
            "consumedPromotionReceipts": sum(row["consumedPromotionReceipts"] for row in rows),
            "speculationAudit": {"distinctRecordedEvidenceIds": sum(row["exposedEvidence"]["distinctRecordedEvidenceIds"] for row in rows),
                                 "recordedEvidenceAppearances": sum(row["exposedEvidence"]["recordedEvidenceAppearances"] for row in rows),
                                 "eventMeasuredTrials": sum(row.get("schedulerSpeculation") is not None for row in rows),
                                 "schedulerExposedJobs": sum((row.get("schedulerSpeculation") or {}).get("exposedJobs", 0) for row in rows),
                                 "schedulerPromotionHandoffs": sum((row.get("schedulerSpeculation") or {}).get("promotionHandoffs", 0) for row in rows),
                                 "schedulerUnexposedUnconsumedWasteCandidates": sum((row.get("schedulerSpeculation") or {}).get("unexposedUnconsumedWasteCandidates", 0) for row in rows),
                                 "meaning": "Consumed promotion receipts count exact tool reuse, a lower bound on usefulness. Exposed evidence may eliminate later authoritative calls; actual evidence consumption is unknown. Source wastedCalls is summarized as reportedUnpromotedCalls, not total waste. Scheduler waste candidates were unexposed and unconsumed at close; job counts are not physical execution counts."},
            "promotionCountDiscrepancies": [row["runId"] for row in rows if row["promotionReceiptMatchesCount"] is False],
            "goldDiagnosticMeasuredTrials": sum(row["goldDiagnostic"]["available"] for row in rows),
            "nativeToolTimingMeasuredTrials": sum(isinstance(row.get("nativeToolTimings"), list) for row in rows),
            "nativeToolTimingMilliseconds": {operation: distribution([t.get("durationMs") for t in native_timings if t["operation"] == operation]) for operation in operations},
            "physicalNativeToolAttemptsFromTimings": sum(t["operation"] in ("authoritative_tool", "speculative_native_tool") for t in native_timings)
            if any(isinstance(row.get("nativeToolTimings"), list) for row in rows) else None,
            "physicalCallsPerSuccess": {"knownAttempts": physical_attempts if measured_tools else None,
                                       "measuredTrials": measured_tools, "missingTrials": len(rows) - measured_tools,
                                       "successfulTrials": successes,
                                       "estimate": physical_attempts / successes if successes and measured_tools == len(rows) else None,
                                       "unavailableReason": "missing physical telemetry" if measured_tools != len(rows) else "no successful trials" if not successes else None,
                                       "meaning": "All physical native tool attempts, including failed trials, divided by successful trial executions. Nested snapshot wrappers and freshness lease checks are excluded. Partial telemetry is not silently zero-filled."},
            "cost": {"knownUsageSubtotalUsd": sum(value for value in known if number(value)),
                     "knownUsageMeasuredTrials": sum(number(value) for value in known), "unknownChargeTrials": len(uncertain),
                     "retainedTrialAllowanceMaximumUsd": sum(row["reservedUsd"] for row in uncertain if number(row.get("reservedUsd"))),
                     "spentOrReservedTrialEstimateUsd": sum(commitment) if all(number(value) for value in commitment) else None,
                     "plannedTrialAllowanceUsd": sum(row["reservedUsd"] for row in rows if number(row.get("reservedUsd"))),
                     "knownEvaluatorUsageUsd": sum(row["knownEvaluatorUsageUsd"] for row in rows if number(row.get("knownEvaluatorUsageUsd"))),
                     "unknownChargeMeaning": "Unknown request outcomes retain their trial allowance. Retained maxima include known child usage; never add them to known usage again."}}


def paired_comparisons(rows, samples, seed):
    grouped = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[task_key(row)][row["arm"]].append(row)
    comparisons = []
    for control, treatment in itertools.combinations(ARMS, 2):
        valid = []
        excluded = []
        for key, arms in sorted(grouped.items()):
            a, b = arms.get(treatment, []), arms.get(control, [])
            paired = a and b and Counter((row["trial"], row["seed"]) for row in a) == Counter((row["trial"], row["seed"]) for row in b)
            if paired:
                valid.append((a, b))
            else:
                excluded.append({"domain": key[0], "taskId": key[1]})
        for metric in METRICS:
            # Missing latency/gold data are explicit. Pair only measured tasks
            # for that diagnostic; primary success retains every paired task.
            measured = []
            matched_trials = 0
            for a, b in valid:
                def available(row, metric=metric):
                    if metric == "liveTotalMeanSeconds":
                        return number(row.get("totalTrialSeconds")) and row["totalTrialSeconds"] >= 0
                    if metric in ("goldToolNameRecall", "goldFullArgumentsRecall"):
                        return row["goldDiagnostic"]["available"] and row["goldDiagnostic"]["goldActions"] > 0
                    if metric == "nativeToolNonErrorRate":
                        return number(row.get("nativeToolResponses")) and row["nativeToolResponses"] > 0 and number(row.get("nativeToolErrorResponses"))
                    return True
                by_trial = {(row["trial"], row["seed"]): row for row in b}
                selected = [(row, by_trial[row["trial"], row["seed"]]) for row in a
                            if available(row) and available(by_trial[row["trial"], row["seed"]])]
                a_pair = _pairs([first for first, _ in selected])[metric]
                b_pair = _pairs([second for _, second in selected])[metric]
                if a_pair[1] and b_pair[1]:
                    measured.append((a_pair, b_pair))
                    matched_trials += len(selected)
            interval = cluster_interval([a for a, _ in measured], samples, seed, [b for _, b in measured])
            comparisons.append({"treatment": treatment, "control": control, "metric": metric,
                "direction": "treatment minus control", "pairedTasks": len(valid), "measuredTasks": len(measured),
                "matchedTrials": matched_trials, "excludedUnpairedTasks": excluded, **interval})
    return comparisons


def closed_event_records(path, run_ids, manifest=None):
    """Validate original append-only logs, including closure and cohort ownership."""
    previous, records = "0" * 64, []
    payload = Path(path).read_bytes()
    if not payload or not payload.endswith(b"\n"):
        raise ValueError("Event log is empty or lacks its committed final newline")
    for sequence, raw in enumerate(payload.splitlines()):
        record = json.loads(raw)
        if rfc8785.dumps(record) != raw:
            raise ValueError("Event log record is not original canonical JSON")
        body = record.get("body")
        if not isinstance(body, dict) or body.get("sequence") != sequence or isinstance(body.get("sequence"), bool):
            raise ValueError("Event log sequence is invalid")
        digest = hashlib.sha256(rfc8785.dumps(body)).hexdigest()
        if body.get("previousHash") != previous or record.get("hash") != digest:
            raise ValueError("Event log hash chain is invalid")
        event = body.get("event")
        if not isinstance(event, dict):
            raise ValueError("Event log payload is invalid")
        records.append(event)
        previous = digest
    first, last = records[0], records[-1]
    if first.get("type") != "research_manifest" or last.get("type") != "service_closed":
        raise ValueError("Event log lacks its research manifest or final service_closed event")
    if sum(event.get("type") == "service_closed" for event in records) != 1 or sum(event.get("type") == "research_manifest" for event in records) != 1:
        raise ValueError("Event log has repeated service lifecycle records")
    declared = first.get("runs", [])
    declared_ids = [run.get("id") for run in declared if isinstance(run, dict)]
    if len(declared_ids) != len(declared) or any(not isinstance(identifier, str) for identifier in declared_ids) or len(set(declared_ids)) != len(declared_ids) or set(declared_ids) != run_ids:
        raise ValueError("Event research manifest run set differs from closed outcomes")
    if any(event.get("runId") is not None and event["runId"] not in run_ids for event in records):
        raise ValueError("Event log contains a run outside its research manifest")
    if manifest is not None:
        saved_ids = [run["runId"] for run in manifest["runs"]]
        if len(set(saved_ids)) != len(saved_ids) or set(saved_ids) != run_ids:
            raise ValueError("Saved service manifest run set differs from closed outcomes")
        if first.get("manifestHash") != hashlib.sha256(rfc8785.dumps(manifest)).hexdigest():
            raise ValueError("Event research manifest hash differs from saved service manifest")
        expected_arms = {run["runId"]: run["arm"] for run in manifest["runs"]}
        if {run["id"]: run.get("arm") for run in declared} != expected_arms:
            raise ValueError("Event research manifest arm assignment differs from saved service manifest")
    return records, {"path": str(Path(path).resolve()), "records": len(records), "lastHash": previous,
                     "manifestHash": first.get("manifestHash"), "serviceClosed": True,
                     "serviceAborted": last.get("aborted"), "savedManifestVerified": manifest is not None}


def summarize_events(paths, run_ids, manifest=None):
    sources, seen = [], set()
    owned_runs = set()
    integrity = []
    by_run = defaultdict(lambda: {"types": Counter(), "provider": defaultdict(list), "timings": defaultdict(list)})
    for path in paths:
        path = Path(path).resolve()
        identity = file_hash(path)
        if identity in seen:
            raise ValueError("Duplicate event log content would double-count provider calls")
        seen.add(identity)
        sources.append(path)
        records, audit = closed_event_records(path, run_ids, manifest)
        declared_ids = {run["id"] for run in records[0]["runs"]}
        if owned_runs & declared_ids:
            raise ValueError("Overlapping service event logs would double-count declared runs")
        owned_runs.update(declared_ids)
        integrity.append(audit)
        for outer in records:
                event = outer.get("event", outer)
                run_id = outer.get("runId", event.get("runId"))
                if run_id not in run_ids:
                    continue
                slot = by_run[run_id]
                kind = event.get("type", "untyped")
                slot["types"][kind] += 1
                identifier = event.get("id", "")
                role = ("actor" if identifier.endswith(":actor") else "user" if identifier.endswith(":user") else
                        "evaluator" if identifier.endswith(":evaluator") else "goal" if identifier.startswith("goal:") else
                        "candidate" if identifier.startswith("candidate-") else "embedding" if kind.startswith("embedding") else "other")
                if kind in ("model_attempt", "model_attempt_failed", "embedding", "embedding_failed"):
                    slot["provider"][role].append(event)
                latency = event.get("details", {}).get("latencyMs", event.get("latencyMs"))
                if number(latency):
                    slot["timings"][kind].append(latency)
    result = {}
    for run_id, slot in by_run.items():
        provider = {}
        for role, events in slot["provider"].items():
            provider[role] = {"events": len(events), "failedRequests": sum(e["type"].endswith("failed") for e in events),
                "retryAttempts": sum(e.get("attempt", 0) > 0 for e in events),
                "knownCostMicrodollars": sum(e.get("costMicrodollars", 0) for e in events),
                "inputTokens": sum((e.get("usage") or {}).get("input_tokens", (e.get("usage") or {}).get("prompt_tokens", 0)) for e in events),
                "cachedTokens": sum((e.get("usage") or {}).get("input_tokens_details", {}).get("cached_tokens", 0) for e in events),
                "outputTokens": sum((e.get("usage") or {}).get("output_tokens", 0) for e in events),
                "reasoningTokens": sum((e.get("usage") or {}).get("output_tokens_details", {}).get("reasoning_tokens", 0) for e in events),
                "modelCounts": dict(Counter(e.get("model", "unrecorded") for e in events)),
                "latencyMs": distribution([e.get("latencyMs") for e in events])}
        result[run_id] = {"eventCounts": dict(slot["types"]), "provider": provider,
                          "speculation": {"exposedJobs": slot["types"]["exposed"], "promotionHandoffs": slot["types"]["useful"],
                                          "unexposedUnconsumedWasteCandidates": slot["types"]["wasted"]},
                          "latencyMs": {kind: distribution(values) for kind, values in slot["timings"].items()}}
    return {"provided": bool(paths), "integrity": integrity, "coveredRuns": len(result), "uncoveredRunIds": sorted(run_ids - result.keys()), "runs": result}, sources


def v2_context(directory):
    directory = Path(directory).resolve()
    summary = read(directory / "summary.json")
    with (directory / "outcomes.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    arms = {}
    for arm in sorted({row["arm"] for row in rows}):
        selected = [row for row in rows if row["arm"] == arm]
        arms[arm] = {"n": len(selected), "successes": sum(bool(row["success"]) for row in selected),
                     "successRate": sum(bool(row["success"]) for row in selected) / len(selected),
                     "totalTrialSeconds": distribution([row.get("totalTrialSeconds") for row in selected])}
    return {"purpose": "Separate historical custom-task cohort, not an official-task control or causal before/after comparison",
            "label": summary.get("label"), "studyStage": summary.get("studyStage"), "arms": arms}, [directory / "summary.json", directory / "outcomes.jsonl"]


def analyze_stage(directory, event_paths=(), *, samples=5000, seed=20260915, v2_directory=None):
    if not isinstance(samples, int) or isinstance(samples, bool) or not 100 <= samples <= 100_000:
        raise ValueError("Bootstrap samples must be between 100 and 100000")
    stage = load_stage(directory)
    rows = stage["rows"]
    manifest_path = stage["directory"] / "service-manifest.json"
    manifest = read(manifest_path) if event_paths else None
    if manifest is not None and {run["runId"]: run["arm"] for run in manifest["runs"]} != {row["runId"]: row["arm"] for row in rows}:
        raise ValueError("Saved service manifest arm assignment differs from closed outcomes")
    events, event_sources = summarize_events(event_paths, {row["runId"] for row in rows}, manifest)
    if event_paths:
        stage["sources"].append(manifest_path)
    for row in rows:
        row["schedulerSpeculation"] = events["runs"].get(row["runId"], {}).get("speculation")
    result = {"schemaVersion": 1, "label": stage["summary"].get("label"), "studyId": stage["summary"].get("studyId"),
        "studyStage": stage["summary"].get("studyStage"), "designHash": stage["design"].get("designHash"),
        "method": {"taskClustering": "domain plus official task ID; both repetitions resampled together",
                   "benchmarkScope": "Pinned upstream tau-bench retail/airline task subset; prior task exposure is audited separately and a new namespace does not establish unseen task IDs",
                   "predictionAccuracy": "Native task accuracy is separate from next-action prediction accuracy; this report does not infer prediction accuracy from task reward",
                   "interval": "pointwise percentile task-cluster bootstrap, 95%; not multiplicity adjusted",
                   "bootstrapSamples": samples, "seed": seed, "pass1": "observed success fraction across every declared trial, including failures; equal-task mean pass1 when each task has the same repetition count",
                   "bothTrials": "fraction of tasks with exactly two distinct trials that both succeeded; not pass-at-least-once",
                   "goldRecall": "multiset recall against one upstream reference trajectory, assistant actions only; full arguments ignore compare_args and include no policy/path correctness claim",
                   "toolRate": "fraction of native tool responses without an error; not policy compliance or unique-path action accuracy",
                   "timing": "recorded failures retain measured duration; absent times remain null, never zero-filled; paired timing/diagnostic differences use only repetitions measured in both arms",
                   "physicalCounts": "authoritative_tool plus speculative_native_tool attempted executions; wrapper timings are nested and excluded from physical totals; freshness checks are lease validation",
                   "speculationUsefulness": "Exact consumed promotions are a lower bound. Exposed evidence can eliminate authoritative calls without promotion; evidence consumption is unknown. Unpromoted calls are not all waste. Scheduler waste candidates are unexposed/unconsumed jobs, not necessarily executed calls.",
                   "assertions": "Evaluate assertion coverage only when NL_ASSERTION is selected in the recorded reward basis; stored assertions outside that basis require no judge. Preserve native rewards and raw coverage flags.",
                   "cost": "usage estimates and retained trial maxima from closed outcomes; no invoice or shared-ledger reconciliation"},
        "service": {key: stage["summary"].get(key) for key in ("serviceExitCode", "serviceStartupSeconds", "serviceWallSeconds", "finalServiceDrainSeconds", "startupOutsideTrialClocks", "judgeOutsideLiveLatency")},
        "arms": {arm: summarize_arm([row for row in rows if row["arm"] == arm], samples, seed) for arm in ARMS},
        "pairedDifferences": paired_comparisons(rows, samples, seed), "events": events, "trials": rows}
    result["domains"] = {domain: {
        "arms": {arm: summarize_arm([row for row in rows if row["domain"] == domain and row["arm"] == arm], samples, seed) for arm in ARMS},
        "pairedDifferences": paired_comparisons([row for row in rows if row["domain"] == domain], samples, seed)}
        for domain in sorted({row["domain"] for row in rows})}
    sources = stage["sources"] + event_sources
    if v2_directory is not None:
        result["historicalV2Context"], extra = v2_context(v2_directory)
        sources += extra
    result["sources"] = [{"path": str(path), "bytes": path.stat().st_size, "sha256": file_hash(path)} for path in dict.fromkeys(sources)]
    return result


def markdown(report):
    def fmt(value, percent=False):
        return "unavailable" if value is None else f"{100 * value:.2f}%" if percent else f"{value:.3f}"
    def interval(metric, percent=False):
        return f"{fmt(metric['estimate'], percent)} [{fmt(metric['lower'], percent)}, {fmt(metric['upper'], percent)}]"
    lines = ["# Closed official-task cohort report", "", f"Study: {report['studyId']}; stage: {report['studyStage']}.", "",
             "Every declared trial is retained. These scores describe the selected official-task subset and configured models, not the full upstream benchmark. The scope is the pinned upstream tau-bench retail/airline subset; prior exposure is audited separately. Native task accuracy is not next-action prediction accuracy.", "",
             "| Arm | Trials | Success | Both trials | Tool non-error | Gold full-argument recall | Live mean / median / p95 seconds | Known USD | Unknown trials |",
             "|---|---:|---:|---:|---:|---:|---|---:|---:|"]
    for arm, data in report["arms"].items():
        m, timing, cost = data["metrics"], data["timingSeconds"]["totalTrialSeconds"], data["cost"]
        lines.append(f"| {arm} | {data['trials']} | {fmt(m['successRate']['estimate'], True)} | {fmt(m['bothTrialsSuccessRate']['estimate'], True)} | {fmt(m['nativeToolNonErrorRate']['estimate'], True)} | {fmt(m['goldFullArgumentsRecall']['estimate'], True)} | {fmt(timing['mean'])} / {fmt(timing['median'])} / {fmt(timing['p95'])} (n={timing['n']}, missing={timing['missing']}) | {cost['knownUsageSubtotalUsd']:.6f} | {cost['unknownChargeTrials']} |")
    lines += ["", "Pass1 pools every declared repetition. Observed pass^2 requires both repetitions to succeed; it is not squared pooled pass1. The following intervals are pointwise 95% task-cluster intervals.", "",
              "| Scope | Arm | Pass1 successes / trials, interval | Pass^2 both / eligible tasks, interval | Exactly one / neither |",
              "|---|---|---|---|---|"]
    scopes = {"all": report["arms"], **{domain: data["arms"] for domain, data in report["domains"].items()}}
    for scope, arms in scopes.items():
        for arm, data in arms.items():
            consistency = data["twoTrialConsistency"]
            lines.append(f"| {scope} | {arm} | {data['successes']}/{data['trials']}, {interval(data['metrics']['successRate'], True)} | {consistency['bothSucceeded']}/{consistency['eligibleTasks']}, {interval(data['metrics']['bothTrialsSuccessRate'], True)} | {consistency['exactlyOneSucceeded']} / {consistency['neitherSucceeded']} |")
    lines += ["", "Raw upstream reward is shown separately from primary success. A reward-one trial can still fail primary success because execution, drain, or evaluation failed. Missing rewards remain primary failures.", "",
              "| Arm | Raw reward one / measured / declared | Reward one but primary failure | Evaluation errors | Physical calls / successful trial | Physical telemetry measured / declared |",
              "|---|---|---:|---:|---|---|"]
    for arm, data in report["arms"].items():
        reward, calls = data["officialRewardAudit"], data["physicalCallsPerSuccess"]
        lines.append(f"| {arm} | {reward['rewardOneTrials']} / {reward['measuredTrials']} / {data['trials']} | {reward['rewardOneButPrimaryFailure']} | {reward['evaluationErrorTrials']} | {calls['knownAttempts']} / {calls['successfulTrials']} = {fmt(calls['estimate'])} | {calls['measuredTrials']} / {data['trials']} |")
    lines += ["", "Physical calls per successful trial includes attempts from failed trials in its numerator. It excludes nested snapshot wrappers and lease validation. The ratio is unavailable if any physical telemetry is missing or no trial succeeds."]
    lines += ["", "Live time includes native orchestration and acknowledged actor/user drain. Judge time and service startup are reported separately in report.json. Missing timings remain unavailable; measured failure durations remain included.", "",
              "Tool non-error rate is an execution diagnostic. Gold recall measures overlap with one reference trajectory and does not require that trajectory to be the only correct solution. Both-trial success requires both repetitions to pass.", "",
              "Exact consumed promotions are a lower bound on useful speculation. Exposed evidence can eliminate later authoritative calls; its actual consumption is unknown. Unpromoted calls are not all waste. Scheduler waste candidates are unexposed, unconsumed jobs at close, not necessarily physical executions.", "",
              "| Arm | Exact consumed promotions | Recorded evidence IDs | Scheduler exposures | Unexposed/unconsumed job candidates | Event-covered trials |",
              "|---|---:|---:|---:|---:|---:|"]
    for arm, data in report["arms"].items():
        audit = data["speculationAudit"]
        lines.append(f"| {arm} | {data['consumedPromotionReceipts']} | {audit['distinctRecordedEvidenceIds']} | {audit['schedulerExposedJobs']} | {audit['schedulerUnexposedUnconsumedWasteCandidates']} | {audit['eventMeasuredTrials']} |")
    lines += ["", "Assertion coverage is assessed only for NL_ASSERTION selected by the upstream reward basis. Stored but unselected assertions require no judge; selected empty assertion sets are vacuous. Raw reward and coverage flags are preserved. These checks are not an exhaustive policy audit.", "",
              "| Arm | Assertion applicability | Missing required assertions |",
              "|---|---|---:|"]
    for arm, data in report["arms"].items():
        audit = data["nativeAssertionAudit"]
        statuses = ", ".join(f"{key}: {value}" for key, value in sorted(audit["applicabilityCounts"].items()))
        lines.append(f"| {arm} | {statuses} | {audit['missingRequiredAssertions']} |")
    lines += ["",
              "Intervals resample official tasks, preserving paired arms and repetitions. They are pointwise 95% bootstrap intervals, not multiplicity corrected. Fewer than two measured task clusters yields no interval.", "",
              "A small or uniform task sample can produce a zero-width bootstrap interval; that does not establish certainty about other benchmark tasks. Development stages reuse task IDs and are reported separately, never pooled as independent task clusters.", "",
              "| Scope | Paired difference | Pass1 difference [95% interval] | Live mean seconds difference [95% interval] | Paired task clusters / latency matched trials |", "|---|---|---|---|---|"]
    comparison_scopes = {"all": report["pairedDifferences"], **{domain: data["pairedDifferences"] for domain, data in report["domains"].items()}}
    for scope, comparisons in comparison_scopes.items():
        for comparison in comparisons:
            if comparison["metric"] == "successRate":
                timing = next(item for item in comparisons if item["metric"] == "liveTotalMeanSeconds" and item["treatment"] == comparison["treatment"] and item["control"] == comparison["control"])
                lines.append(f"| {scope} | {comparison['treatment']} minus {comparison['control']} | {interval(comparison, True)} | {interval(timing)} | {comparison['clusters']} / {timing['matchedTrials']} |")
    lines += ["", f"Event logs supplied: {report['events']['provided']}; event-covered trials: {report['events']['coveredRuns']}/{len(report['trials'])}. Supplied logs must pass canonical hash-chain, cohort-manifest, and final service-closure validation. No event log is inferred for startup failures. Integrity and aborted-close status are preserved in report.json."]
    lines += ["", "Unknown request charges retain their trial allowances. Those maxima already include known child usage; adding known costs to retained maxima would double-count. These estimates do not reconcile an invoice or reopen the shared budget ledger."]
    if "historicalV2Context" in report:
        lines += ["", "The separately labeled historicalV2Context in report.json describes the earlier custom-task cohort. Different tasks and study protocols prevent a causal v2-versus-v3 comparison."]
    return "\n".join(lines) + "\n"


def write_report(directory, output, event_paths=(), *, samples=5000, seed=20260915, v2_directory=None):
    output = Path(output).resolve()
    if output.exists() or output.is_relative_to(Path(directory).resolve()) or (v2_directory and output.is_relative_to(Path(v2_directory).resolve())):
        raise ValueError("Use a new output directory outside immutable input cohorts")
    report = analyze_stage(directory, event_paths, samples=samples, seed=seed, v2_directory=v2_directory)
    output.mkdir(parents=True, exist_ok=False)
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    (output / "README.md").write_text(markdown(report), encoding="utf-8")
    fields = ("runId", "domain", "taskId", "trial", "seed", "arm", "success", "officialReward", "termination", *TIMINGS, *COUNTS, "wastedCalls",
              "billedUsd", "knownUsageSubtotalUsd", "unknownProviderCharge", "knownEvaluatorUsageUsd", "unknownEvaluatorCharge")
    with (output / "trials.csv").open("x", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(report["trials"])
    paired_fields = ("domain", "treatment", "control", "metric", "estimate", "lower", "upper", "clusters", "pairedTasks", "measuredTasks", "matchedTrials")
    with (output / "paired-differences.csv").open("x", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=paired_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows({"domain": "all", **row} for row in report["pairedDifferences"])
        for domain, data in report["domains"].items():
            writer.writerows({"domain": domain, **row} for row in data["pairedDifferences"])
    with (output / "native-summary.csv").open("x", encoding="utf-8", newline="") as stream:
        fields = ("domain", "arm", "trials", "tasks", "successes", "pass1", "pass1Lower", "pass1Upper",
                  "bothSucceeded", "eligibleTwoTrialTasks", "pass2", "pass2Lower", "pass2Upper",
                  "liveMeanSeconds", "liveMedianSeconds", "liveP95Seconds", "liveN", "liveMissing",
                  "physicalCallsPerSuccess", "physicalMeasuredTrials", "physicalMissingTrials")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for domain, arms in {"all": report["arms"], **{key: value["arms"] for key, value in report["domains"].items()}}.items():
            for arm, data in arms.items():
                p1, p2 = data["metrics"]["successRate"], data["metrics"]["bothTrialsSuccessRate"]
                consistency, timing, calls = data["twoTrialConsistency"], data["timingSeconds"]["totalTrialSeconds"], data["physicalCallsPerSuccess"]
                writer.writerow({"domain": domain, "arm": arm, **{key: data[key] for key in ("trials", "tasks", "successes")},
                    "pass1": p1["estimate"], "pass1Lower": p1["lower"], "pass1Upper": p1["upper"],
                    "bothSucceeded": consistency["bothSucceeded"], "eligibleTwoTrialTasks": consistency["eligibleTasks"],
                    "pass2": p2["estimate"], "pass2Lower": p2["lower"], "pass2Upper": p2["upper"],
                    "liveMeanSeconds": timing["mean"], "liveMedianSeconds": timing["median"], "liveP95Seconds": timing["p95"],
                    "liveN": timing["n"], "liveMissing": timing["missing"], "physicalCallsPerSuccess": calls["estimate"],
                    "physicalMeasuredTrials": calls["measuredTrials"], "physicalMissingTrials": calls["missingTrials"]})
    outputs = [{"path": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path)} for path in sorted(output.iterdir())]
    (output / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "sources": report["sources"], "outputs": outputs}, indent=2) + "\n", encoding="utf-8")
    return report
