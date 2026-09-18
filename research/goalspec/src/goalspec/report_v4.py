"""Offline, immutable analysis of closed custom tau-compatible v4 cohorts.

This module does not import the native environment, model client, or budget ledger.
Trial artifacts (which contain final private state) are opened only after closure
and complete outcome/design validation. Missing observations are never zeros.
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import rfc8785

from goalspec.report_v3 import (
    ARMS,
    closed_event_records,
    distribution,
    file_hash,
    number,
    percentile,
)

VERSION = "goalspec-custom-native-report-v4.1"
LABEL = "custom tau-compatible pilot"
PAIR_FIELDS = ("domain", "family", "variant", "trial", "seed")
COUNTS = ("authoritativeCalls", "speculativeCalls", "physicalCalls", "usefulCalls",
          "unpromotedCalls", "freshnessChecks", "consumptionLeaseChecks", "recordedLeaseChecks",
          "revalidationCalls", "rejectedCalls", "cancelledCalls")
TIMES = ("totalTrialSeconds", "nativeOrchestrationSeconds", "serviceDrainSeconds",
         "evaluationSeconds", "totalIncludingEvaluationSeconds")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


class Sources:
    def __init__(self):
        self.hashes = {}

    def track(self, path):
        path = Path(path).resolve()
        current = file_hash(path)
        if str(path) in self.hashes and self.hashes[str(path)] != current:
            raise ValueError(f"Input changed during analysis: {path}")
        self.hashes[str(path)] = current
        return path

    def read(self, path):
        return json.loads(self.track(path).read_text(encoding="utf-8"))

    def jsonl(self, path):
        payload = self.track(path).read_text(encoding="utf-8")
        if payload and not payload.endswith("\n"):
            raise ValueError("JSONL lacks a committed final newline")
        return [json.loads(line) for line in payload.splitlines() if line.strip()]

    def verify(self):
        for path, expected in self.hashes.items():
            if file_hash(path) != expected:
                raise ValueError(f"Input changed during analysis: {path}")


def family_key(row):
    return row["domain"], row["family"]


def pair_key(row):
    return tuple(row[key] for key in PAIR_FIELDS)


def load_stage(directory, sources=None, event_paths=()):
    sources = sources or Sources()
    directory = Path(directory).resolve()
    # Reading these three public closure artifacts precedes all private state.
    summary = sources.read(directory / "summary.json")
    design = sources.read(directory / "design.json")
    rows = sources.jsonl(directory / "outcomes.jsonl")
    if summary.get("version") != "goalspec-live-v4" or summary.get("label") != LABEL:
        raise ValueError("Expected closed custom v4 summary")
    body = {key: value for key, value in design.items() if key != "designHash"}
    if design.get("designHash") != digest(body) or summary.get("designHash") != design["designHash"]:
        raise ValueError("Design hash does not match closed summary")
    for field in ("studyId", "studyStage"):
        if summary.get(field) != design.get(field):
            raise ValueError("Summary identity differs from design")
    trials = design.get("trials", [])
    if not rows or len(rows) != len(trials) or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("Closed report requires every declared outcome exactly once")
    fields = (*PAIR_FIELDS, "taskId", "arm")
    if Counter(tuple(row[key] for key in fields) for row in rows) != Counter(
            tuple(row[key] for key in fields) for row in trials):
        raise ValueError("Outcome family/variant/arm/seed pairing differs from declared design")
    if any(count != 1 for count in Counter((pair_key(row), row["arm"]) for row in rows).values()):
        raise ValueError("Duplicate design arm/paired trial")
    declared_by_id = {
        f"v4-{digest(design['studyId'])[:10]}-{design['studyStage']}-{index:04d}-{digest([design['designHash'], trial])[:12]}": trial
        for index, trial in enumerate(trials)
    }
    if {row["runId"] for row in rows} != set(declared_by_id) or any(
            any(row.get(field) != declared_by_id[row["runId"]].get(field) for field in fields) for row in rows):
        raise ValueError("Per-run identity differs from its declared task/variant/trial/seed/arm")
    if summary.get("counts") != dict(Counter(row["arm"] for row in rows)):
        raise ValueError("Summary arm counts differ from outcomes")
    if summary.get("successes") != sum(row.get("success") is True for row in rows):
        raise ValueError("Summary successes differ from outcomes")
    for row in rows:
        if row["arm"] not in ARMS or not isinstance(row.get("success"), bool):
            raise ValueError("Invalid outcome arm or success")
        if row.get("officialReward") is not None or "officialReward" not in row or row.get("label") != LABEL:
            raise ValueError("Custom trials must explicitly have officialReward null")
        if any(row.get(field) != design.get(field) for field in ("studyId", "studyStage")):
            raise ValueError("Outcome identity differs from design")
        run_id = row["runId"]
        if not isinstance(run_id, str) or Path(run_id).name != run_id or "/" in run_id or "\\" in run_id:
            raise ValueError("Invalid artifact identifier")
    # All grid and identity checks above finish before the first trial read.
    manifest = sources.read(directory / "service-manifest.json")
    expected_runs = {row["runId"]: row["arm"] for row in rows}
    declared_runs = manifest.get("runs", [])
    if len(declared_runs) != len(expected_runs) or {run["runId"]: run["arm"] for run in declared_runs} != expected_runs:
        raise ValueError("Service manifest differs from outcome run set")
    events, audits = [], []
    for path in event_paths:
        if events:
            raise ValueError("A native v4 cohort must have one original closed service log")
        records, audit = closed_event_records(sources.track(path), set(expected_runs), manifest)
        events.extend(records)
        audits.append(audit)
    for row in rows:
        artifact = sources.read(directory / f"{row['runId']}.json")
        if artifact.get("record") != row:
            raise ValueError("Trial artifact differs from immutable outcome")
        verdict = artifact.get("verdict")
        if row["success"] and (not isinstance(verdict, dict) or verdict.get("success") is not True):
            raise ValueError("Successful custom outcome lacks independent successful verdict")
        row["verdict"] = verdict
        row["nativeToolTimings"] = artifact.get("nativeToolTimings")
        measured = isinstance(artifact.get("nativeToolTimings"), list)
        unstarted = row.get("termination") in ("service_startup_error", "stage_aborted_before_slot")
        row["physicalCalls"] = (row["authoritativeCalls"] + row["speculativeCalls"]
                                if (measured or unstarted) and all(number(row.get(k)) and row[k] >= 0
                                    for k in ("authoritativeCalls", "speculativeCalls")) else None)
        messages = (artifact.get("simulation") or {}).get("messages", [])
        responses = [message for message in messages if message.get("role") == "tool"]
        row["toolResponses"] = len(responses) if "simulation" in artifact else None
        row["toolErrorResponses"] = sum(message.get("error") is True for message in responses) if "simulation" in artifact else None
        row["consumedPromotionReceipts"] = sum(event.get("status") == "consumed" for event in artifact.get("promotionEvents", []))
        row["consumptionLeaseChecks"] = (sum(event.get("status") in ("consumed", "stale_fallback")
                                               for event in artifact["promotionEvents"])
                                         if isinstance(artifact.get("promotionEvents"), list) else None)
        row["recordedLeaseChecks"] = (row["freshnessChecks"] + row["consumptionLeaseChecks"]
                                      if number(row.get("freshnessChecks")) and number(row["consumptionLeaseChecks"]) else None)
    sources.verify()
    return {"directory": str(directory), "design": design, "summary": summary, "manifest": manifest, "rows": rows,
            "events": events, "eventIntegrity": audits}


def ratio(pair):
    return pair[0] / pair[1] if pair[1] else None


def sum_pairs(pairs):
    pairs = list(pairs)
    return sum(p[0] for p in pairs), sum(p[1] for p in pairs)


def cluster_interval(pairs, samples=5000, seed=20260916, controls=None):
    """Resample every family, including failed families with zero successes.

    Filtering zero-denominator clusters would understate physical calls per
    successful task. A draw with no successes has no finite ratio and is reported.
    """
    estimate = ratio(sum_pairs(pairs))
    if controls is not None:
        if len(controls) != len(pairs):
            raise ValueError("Paired cluster counts differ")
        control = ratio(sum_pairs(controls))
        estimate = estimate - control if estimate is not None and control is not None else None
    draws = []
    if len(pairs) >= 2 and estimate is not None:
        rng = random.Random(seed)
        for _ in range(samples):
            indices = rng.choices(range(len(pairs)), k=len(pairs))
            value = ratio(sum_pairs(pairs[i] for i in indices))
            control = ratio(sum_pairs(controls[i] for i in indices)) if controls is not None else 0
            if value is not None and control is not None:
                draws.append(value - control)
    lower, upper = percentile(draws, .025), percentile(draws, .975)
    return {"estimate": estimate, "lower": lower, "upper": upper,
            "families": len(pairs), "bootstrapSamplesUsed": len(draws),
            "undefinedDraws": samples - len(draws) if draws or (len(pairs) >= 2 and estimate is not None) else None,
            "degenerateInterval": bool(draws) and lower == upper,
            "intervalCaveat": "A degenerate bootstrap interval reflects no observed cluster variation, not certainty about population performance." if draws and lower == upper else None,
            "intervalMeaning": "pointwise family-clustered percentile 95%; no multiplicity correction"}


def two_trial_groups(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["domain"], row["family"], row["variant"])].append(row)
    complete = [group for group in groups.values() if len(group) == 2 and {row["trial"] for row in group} == {0, 1}]
    return groups, complete


def metric_pairs(rows):
    _, repeated = two_trial_groups(rows)
    live = [row["totalTrialSeconds"] for row in rows if number(row.get("totalTrialSeconds")) and row["totalTrialSeconds"] >= 0]
    calls = [row["physicalCalls"] for row in rows if number(row.get("physicalCalls"))]
    responses = [row for row in rows if number(row.get("toolResponses"))]
    # Ratios that require all physical calls are unavailable when any are unknown.
    physical = (sum(calls), sum(row["success"] for row in rows)) if len(calls) == len(rows) else (0, 0)
    return {"pass1": (sum(row["success"] for row in rows), len(rows)),
            "pass2": (sum(all(row["success"] for row in group) for group in repeated), len(repeated)),
            "liveTotalMeanSeconds": (sum(live), len(live)),
            "physicalCallsMean": (sum(calls), len(calls)), "physicalCallsPerSuccess": physical,
            "toolNonErrorRate": (sum(row["toolResponses"] - row["toolErrorResponses"] for row in responses),
                                 sum(row["toolResponses"] for row in responses))}


def cost_summary(rows):
    unknown = [row for row in rows if row.get("unknownProviderCharge") or not number(row.get("billedUsd"))]
    known = [row.get("knownUsageSubtotalUsd") for row in rows]
    committed = [row.get("reservedUsd") if row in unknown else row.get("billedUsd") for row in rows]
    return {"knownUsageSubtotalUsd": sum(value for value in known if number(value)),
            "knownUsageMeasuredTrials": sum(number(value) for value in known),
            "settledRecordedUsd": sum(row["billedUsd"] for row in rows if row not in unknown),
            "unknownChargeTrials": len(unknown),
            "allChargesKnown": not unknown,
            "recordedTotalUsd": sum(row["billedUsd"] for row in rows) if not unknown else None,
            "reservationBoundUsd": sum(committed) if all(number(value) for value in committed) else None,
            "meaning": "Recorded request usage, not an invoice. Unknown trials retain their full reservation; known subtotals are not added twice."}


def summarize_arm(rows, samples=5000, seed=20260916):
    groups = defaultdict(list)
    for row in rows:
        groups[family_key(row)].append(row)
    pairs = [metric_pairs(group) for _, group in sorted(groups.items())]
    units, repeated = two_trial_groups(rows)
    consistency = Counter(sum(row["success"] for row in group) for group in repeated)
    timings = [timing for row in rows for timing in row.get("nativeToolTimings") or []]
    metrics = {metric: cluster_interval([pair[metric] for pair in pairs], samples, seed)
               for metric in metric_pairs(rows)}
    if any(not number(row.get("physicalCalls")) for row in rows):
        metrics["physicalCallsPerSuccess"] = {**metrics["physicalCallsPerSuccess"], "estimate": None,
                                             "lower": None, "upper": None, "unavailableReason": "unknown physical work in one or more trials"}
    return {"trials": len(rows), "families": len(groups), "familyVariants": len(units),
            "successes": sum(row["success"] for row in rows), "failures": sum(not row["success"] for row in rows),
            "metrics": metrics, "terminationCounts": dict(Counter(row.get("termination", "unknown") for row in rows)),
            "twoTrialConsistency": {"eligibleFamilyVariants": len(repeated), "ineligibleFamilyVariants": len(units) - len(repeated),
                                    "bothSucceeded": consistency[2], "exactlyOneSucceeded": consistency[1], "neitherSucceeded": consistency[0]},
            "timingSeconds": {key: distribution([row.get(key) for row in rows]) for key in TIMES},
            "nativeLatencyMs": distribution([row.get("latencyMs") for row in rows]),
            "nativeToolTimingMilliseconds": {operation: distribution([timing.get("durationMs") for timing in timings if timing.get("operation") == operation])
                                              for operation in sorted({timing["operation"] for timing in timings})},
            "authoritativeReadMilliseconds": distribution([timing.get("durationMs") for timing in timings
                                                             if timing.get("operation") == "authoritative_tool" and timing.get("isRead") is True]),
            "counts": {key: {"knownSum": sum(row[key] for row in rows if number(row.get(key))),
                             "measuredTrials": sum(number(row.get(key)) for row in rows),
                             "missingTrials": sum(not number(row.get(key)) for row in rows)} for key in COUNTS},
            "constraints": {"measuredTrials": sum(number(row.get("constraintViolations")) for row in rows),
                            "violations": sum(row["constraintViolations"] for row in rows if number(row.get("constraintViolations"))),
                            "meaning": "Custom completion checks and recorded constraints; not an exhaustive native policy audit."},
            "countMeaning": "Physical calls are authoritative calls plus isolated speculative read attempts, once each; nested snapshot timings, consumed promotions and lease checks are not added. Freshness checks count lease refreshes; consumption lease checks count recorded consumed/stale-fallback receipts. Recorded lease checks are their sum, a lower bound if an exceptional consumption lacks a receipt. Revalidation calls are native tool reruns and remain separately recorded.",
            "cost": cost_summary(rows)}


def paired_comparison(rows, treatment, control="base", samples=5000, seed=20260916):
    left = {pair_key(row): row for row in rows if row["arm"] == treatment}
    right = {pair_key(row): row for row in rows if row["arm"] == control}
    keys = sorted(left.keys() & right.keys())
    families = defaultdict(list)
    for key in keys:
        families[key[:2]].append(key)
    left_pairs, right_pairs = [], []
    for group in families.values():
        # Latency and count deltas require observation on both members of a pair.
        lrows, rrows = [dict(left[key]) for key in group], [dict(right[key]) for key in group]
        for lrow, rrow in zip(lrows, rrows, strict=True):
            for field in ("totalTrialSeconds", "physicalCalls"):
                if not number(lrow.get(field)) or not number(rrow.get(field)):
                    lrow[field] = rrow[field] = None
        left_pairs.append(metric_pairs(lrows))
        right_pairs.append(metric_pairs(rrows))
    metrics = {metric: cluster_interval([p[metric] for p in left_pairs], samples, seed,
                                        [p[metric] for p in right_pairs])
               for metric in ("pass1", "pass2", "liveTotalMeanSeconds", "physicalCallsMean")}
    return {"treatment": treatment, "control": control, "matchedTrials": len(keys), "families": len(families),
            "unmatchedTreatment": [list(key) for key in sorted(left.keys() - right.keys())],
            "unmatchedControl": [list(key) for key in sorted(right.keys() - left.keys())],
            "pairedMeasuredLatencyTrials": sum(number(left[key].get("totalTrialSeconds")) and number(right[key].get("totalTrialSeconds")) for key in keys),
            "differences": metrics, "sign": "treatment minus control"}


def exposure_audit(rows, records, samples=5000, seed=20260916):
    outcomes = {row["runId"]: row for row in rows}
    assignments, seen, exposed = [], set(), set()
    for outer in records:
        event = outer.get("event", outer)
        run_id = outer.get("runId", event.get("runId"))
        if event.get("type") == "exposed":
            exposed.add((run_id, event.get("key")))
        if event.get("type") != "exposure_assignment":
            continue
        key, probability = (run_id, event.get("key")), event.get("propensity")
        if key in seen or run_id not in outcomes or not isinstance(key[1], str):
            raise ValueError("Invalid or repeated run-invocation exposure assignment")
        if not number(probability) or not 0 < probability < 1 or not isinstance(event.get("expose"), bool):
            raise ValueError("Invalid randomized exposure propensity")
        expected = probability if event["expose"] else 1 - probability
        if abs(event.get("assignedGroupProbability", expected) - expected) > 1e-12:
            raise ValueError("Assigned exposure probability inconsistent with logged propensity")
        seen.add(key)
        assignments.append({"runId": run_id, **event})
    if any((assignment["runId"], assignment["key"]) in exposed and not assignment["expose"] for assignment in assignments):
        raise ValueError("Withheld randomized assignment was exposed")
    # One outcome per run: repeating a terminal outcome for every adaptive later
    # assignment creates pseudo-replication and conditions on earlier treatment.
    first = {}
    for assignment in assignments:
        assignment["actuallyExposed"] = (assignment["runId"], assignment["key"]) in exposed
        first.setdefault(assignment["runId"], assignment)
    groups = defaultdict(list)
    for run_id, assignment in first.items():
        groups[family_key(outcomes[run_id])].append((outcomes[run_id], assignment))
    estimates = {}
    for metric in ("success", "totalTrialSeconds", "physicalCalls"):
        treated, withheld = [], []
        for group in groups.values():
            a = b = c = d = 0.0
            for row, assignment in group:
                value = int(row[metric]) if metric == "success" else row.get(metric)
                if not number(value):
                    continue
                if assignment["expose"]:
                    weight = 1 / assignment["propensity"]
                    a += weight * value
                    b += weight
                else:
                    weight = 1 / (1 - assignment["propensity"])
                    c += weight * value
                    d += weight
            treated.append((a, b))
            withheld.append((c, d))
        estimates[metric] = cluster_interval(treated, samples, seed, withheld)
    return {"assignments": assignments, "assignmentCount": len(assignments), "runsWithAssignments": len(first),
            "assignedExpose": sum(a["expose"] for a in assignments), "actuallyExposed": sum(a["actuallyExposed"] for a in assignments),
            "firstAssignmentGroups": {"expose": sum(a["expose"] for a in first.values()), "withhold": sum(not a["expose"] for a in first.values())},
            "firstAssignmentPerRunITT": estimates,
            "meaning": "Exploratory assignment intent-to-treat, conditional on the deterministic eligible pool. First assignment per run uses inverse-propensity weighted group means and family clusters; later assignments remain logged but do not duplicate terminal outcomes. Assigned exposure may fail freshness, readiness or context limits. With only a few runs, task mix and later assignments cannot be separated reliably, and zero success differences can produce degenerate intervals. These are not isolated causal read-usefulness labels, a validated utility calibration or exposure-head training targets."}


def analyze_stage(stage, samples=5000, seed=20260916):
    rows = stage["rows"]
    by_arm = defaultdict(list)
    arms_by_run = {row["runId"]: row["arm"] for row in rows}
    for outer in stage["events"]:
        event = outer.get("event", outer)
        arm = arms_by_run.get(outer.get("runId", event.get("runId")))
        if arm:
            by_arm[arm].append(event)
    telemetry = {}
    for arm, events in by_arm.items():
        counts = Counter(event.get("type", "untyped") for event in events)
        telemetry[arm] = {"eventCounts": dict(counts),
                          "latencyMs": {kind: distribution([event.get("latencyMs", event.get("details", {}).get("latencyMs"))
                                                            for event in events if event.get("type") == kind])
                                        for kind in sorted(counts)},
                          "controllerLatencyMeasured": any(event.get("type") == "controller_decision" and number(event.get("latencyMs")) for event in events),
                          "meaning": "Event counts are job/lifecycle counts, not additional physical tool executions. Prediction timings are descriptive; concurrent timings must not be summed into live latency."}
    read_timings = [timing.get("durationMs") for row in rows for timing in row.get("nativeToolTimings") or []
                    if timing.get("operation") == "authoritative_tool" and timing.get("isRead") is True]
    configuration = stage["manifest"].get("v4Configuration", {})
    return {"directory": stage["directory"], "studyId": stage["design"]["studyId"], "studyStage": stage["design"]["studyStage"],
            "label": LABEL, "designHash": stage["design"]["designHash"],
            "arms": {arm: summarize_arm([row for row in rows if row["arm"] == arm], samples, seed) for arm in ARMS},
            "paired": {f"{arm}-vs-{control}": paired_comparison(rows, arm, control, samples, seed)
                       for arm, control in (("paste", "base"), ("salesforce", "base"), ("goalspec", "base"), ("goalspec", "paste"), ("goalspec", "salesforce"))},
            "exposureExperiment": exposure_audit(rows, stage["events"], samples, seed),
            "eventIntegrity": stage["eventIntegrity"], "cost": cost_summary(rows),
            "telemetry": telemetry,
            "utilityCalibration": {"frozenEstimate": configuration.get("estimate"), "experiment": configuration.get("experiment"),
                                   "nativeAuthoritativeReadMilliseconds": distribution(read_timings),
                                   "meaning": "Native authoritative-read timing is the measured execution work potentially avoided by exact reuse. Speculative snapshot transport and freshness validation are separate added costs; their timing cannot be substituted for saved native execution. Goal latency is asynchronous but drain-inclusive total trial latency captures unfinished work. The tiny exposure experiment cannot establish positive causal exposure benefit; recorded configured credit is not an empirical estimate."},
            "statisticalLimitations": {"families": len({family_key(row) for row in rows}), "allObservedTrialsSucceeded": all(row["success"] for row in rows),
                                       "meaning": "Few families limit precision. An all-success sample yields degenerate empirical-bootstrap accuracy intervals; this does not establish population success of 100% or equality/superiority of arms."},
            "serviceStartupSeconds": stage["summary"].get("serviceStartupSeconds"),
            "finalServiceDrainSeconds": stage["summary"].get("finalServiceDrainSeconds"),
            "serviceExitCode": stage["summary"].get("serviceExitCode"),
            "latencyMeaning": "Headline totalTrialSeconds includes native orchestration and per-trial service drain. Native latencyMs is separate. Shared startup, final shared drain, and independent evaluation are outside the headline. Failures with measured time remain included; missing timing is not zero."}


def goal_replay(directory, sources):
    directory = Path(directory).resolve()
    summary = sources.read(directory / "summary.json")
    rows = sources.jsonl(directory / "assessments.jsonl")
    if len(rows) != summary.get("revisions") or len({row["revision"] for row in rows}) != len(rows):
        raise ValueError("Goal replay has incomplete or duplicate revisions")
    paired = [row for row in rows if isinstance(row.get("grade"), dict) and row["grade"].get("status") == "completed"
              and isinstance(row.get("originalGrade"), dict) and row["originalGrade"].get("status") == "completed"]
    def hit(row, field, k):
        return any(row[field].get("matches", [])[:k])
    scored = [row for row in rows if isinstance(row.get("grade"), dict) and row["grade"].get("status") == "completed"]
    related = {}
    for row in paired:
        family_ids = row.get("familyIds") or ["unattributed"]
        for family in family_ids:
            related.setdefault(family, family)
        def root(key):
            while related[key] != key:
                key = related[key]
            return key
        for family in family_ids[1:]:
            related[root(family)] = root(family_ids[0])
    grouped = defaultdict(list)
    for row in paired:
        family = (row.get("familyIds") or ["unattributed"])[0]
        while related[family] != family:
            family = related[family]
        grouped[family].append(row)
    intervals = {f"top{k}": cluster_interval([(sum(hit(row, "grade", k) for row in group), len(group)) for group in grouped.values()],
                    controls=[(sum(hit(row, "originalGrade", k) for row in group), len(group)) for group in grouped.values()]) for k in (1, 3)}
    references = {}
    for name in ("plan.json", "second-annotations-frozen.json", "second-annotations.jsonl", "field-reviews.jsonl"):
        path = directory / name
        if path.exists():
            references[name] = {"sha256": file_hash(sources.track(path))}
    frozen_verified = False
    frozen_order = None
    plan_path = directory / "plan.json"
    if plan_path.exists():
        plan = sources.read(plan_path)
        reused_annotations = None
        if "revisionIds" in plan and set(plan["revisionIds"]) != {row["revision"] for row in rows}:
            raise ValueError("Goal replay revisions differ from its frozen plan")
        for item in plan.get("inputFiles", []):
            path = sources.track(item["path"])
            if file_hash(path) != item["sha256"]:
                raise ValueError("Original goal reference hash differs from replay plan")
            if path.name == "requested-grades.jsonl":
                original_grades = {row["revision"]: row["grade"] for row in sources.jsonl(path)}
                if any(row.get("originalGrade") != original_grades.get(row["revision"]) for row in rows):
                    raise ValueError("Original frozen goal grades were changed")
            if path.name == "second-annotations.jsonl":
                if reused_annotations is not None:
                    raise ValueError("Multiple reused annotation sources are ambiguous")
                reused_annotations = sources.jsonl(path)
        frozen_path = directory / "second-annotations-frozen.json"
        if frozen_path.exists():
            annotations = sources.jsonl(directory / "second-annotations.jsonl")
            by_revision = {row["revision"]: row for row in annotations}
            order = plan.get("secondAnnotationRevisions", [])
            frozen = sources.read(frozen_path)
            if len(by_revision) != len(annotations) or set(by_revision) != set(order):
                raise ValueError("Second annotation set differs from frozen plan")
            if reused_annotations is not None and annotations != reused_annotations:
                raise ValueError("Copied blinded annotations differ from hash-pinned source")
            frozen_order = "reused source JSONL order" if reused_annotations is not None else "original plan revision order"
            frozen_rows = annotations if reused_annotations is not None else [by_revision[revision] for revision in order]
            actual_hash = hashlib.sha256(rfc8785.dumps(frozen_rows)).hexdigest()
            if frozen.get("count") != len(annotations) or frozen.get("hash") != actual_hash:
                raise ValueError("Second annotation freeze hash mismatch")
            frozen_verified = True
    field_summary = {"reviewed": 0, "missing": 0}
    field_path = directory / "field-reviews.jsonl"
    if field_path.exists():
        reviews = sources.jsonl(field_path)
        fields = [row["fields"] for row in reviews if isinstance(row.get("fields"), dict)]
        field_summary = {"reviewed": len(fields), "missing": len(reviews) - len(fields),
                         "uncertain": sum(row.get("uncertain") is True for row in fields),
                         "originalReferenceSupported": sum(row.get("originalReferenceSupported") is True for row in fields),
                         "models": {model: {"literalCoverage": distribution([row.get(model, {}).get("literalCoverage") for row in fields]),
                                            "staleIntent": sum(row.get(model, {}).get("staleIntent") is True for row in fields),
                                            "contradiction": sum(row.get(model, {}).get("contradiction") is True for row in fields)} for model in ("v3", "v4")}}
        field_summary["meaning"] = "Selected previously missed goal revisions, not a random sample. Coverage, stale intent and contradictions include failed or empty predictions; fewer contradiction flags alone do not imply improvement. Teacher review is not independent goal truth."
    receipt = sources.read(directory / "execution-receipt.json") if (directory / "execution-receipt.json").exists() else None
    return {"directory": str(directory), "summary": summary, "revisions": len(rows), "scored": len(scored), "missingGrades": len(rows) - len(scored),
            "top1": ratio((sum(hit(row, "grade", 1) for row in scored), len(scored))),
            "top3": ratio((sum(hit(row, "grade", 3) for row in scored), len(scored))),
            "operationalTop1AllRevisions": ratio((sum(hit(row, "grade", 1) for row in scored), len(rows))),
            "pairedScored": len(paired), "pairedDifference": intervals, "frozenReferences": references,
            "secondAnnotationFreezeVerified": frozen_verified, "secondAnnotationFreezeOrder": frozen_order,
            "fieldReviews": field_summary, "executionReceipt": receipt,
            "meaning": "Agreement with frozen teacher annotations on historical checkpoints, not task success or independent goal truth. Shared revisions are scored once; overlapping family references are grouped into connected components for intervals."}


def _fmt(value, percent=False):
    return "unavailable" if value is None else f"{100 * value:.1f}%" if percent else f"{value:.3f}"


def markdown(report):
    lines = ["# GoalSpec v4 local results", "", "These are custom tau-compatible pilot results, not an official full-benchmark score. All four implementations are local arms; PASTE and Salesforce are paper-based baselines, not verified upstream reproductions.", ""]
    lines += ["V4 GoalSpec uses frozen workflow patterns and its current-state candidate graph. The older remote-candidate prompt containing episodic transitions and confusion records is inactive in the GoalSpec path; it remains available in the Salesforce-style control. These results do not establish a GoalSpec episodic-prompt benefit.", ""]
    for cohort in report["cohorts"]:
        lines += [f"## {cohort['studyStage']}", "", "| Arm | Task success / trials (pass1) | pass2 | Total live mean / p95 seconds (n) | Physical calls | Known usage USD |",
                  "| --- | --- | --- | --- | --- | --- |"]
        for arm, data in cohort["arms"].items():
            timing, calls = data["timingSeconds"]["totalTrialSeconds"], data["counts"]["physicalCalls"]
            lines.append(f"| {arm} | {data['successes']}/{data['trials']} ({_fmt(data['metrics']['pass1']['estimate'], True)}) | {_fmt(data['metrics']['pass2']['estimate'], True)} | {_fmt(timing['mean'])} / {_fmt(timing['p95'])} ({timing['n']}) | {calls['knownSum']} ({calls['missingTrials']} unmeasured trials) | {_fmt(data['cost']['knownUsageSubtotalUsd'])} ({data['cost']['unknownChargeTrials']} unknown-charge trials) |")
        lines += ["", "pass2 is the proportion of family/variant units that succeed in both trials 0 and 1, not squared pooled accuracy or at-least-once success. All failures remain in the task-success denominator.", "", cohort["latencyMeaning"], "",
                  "| Paired comparison | Matched trials | Task-success difference [95% CI] | Total live seconds difference [95% CI] |",
                  "| --- | --- | --- | --- |"]
        for name, pair in cohort["paired"].items():
            a, b = pair["differences"]["pass1"], pair["differences"]["liveTotalMeanSeconds"]
            lines.append(f"| {name} | {pair['matchedTrials']} | {_fmt(a['estimate'], True)} [{_fmt(a['lower'], True)}, {_fmt(a['upper'], True)}] | {_fmt(b['estimate'])} [{_fmt(b['lower'])}, {_fmt(b['upper'])}] |")
        lines += ["", "Differences are treatment minus control. Pointwise intervals resample families and retain their variants, trials and paired arms. Few families limit precision; intervals do not establish improvement on every metric.", "", cohort["exposureExperiment"]["meaning"], ""]
        if cohort["statisticalLimitations"]["allObservedTrialsSucceeded"]:
            lines += [f"Every observed trial succeeded across {cohort['statisticalLimitations']['families']} families. The resulting degenerate bootstrap accuracy intervals reflect the observed sample, not certainty of 100% population success or equivalence of the arms.", ""]
        elif any(data["metrics"]["pass1"]["degenerateInterval"] for data in cohort["arms"].values()):
            lines += ["Some task-success intervals are degenerate because the observed family rates are identical. This reflects no observed cluster variation, not certainty about population performance.", ""]
        experiment = cohort["exposureExperiment"]
        lines += [f"Exposure experiment: {experiment['assignmentCount']} assignments across {experiment['runsWithAssignments']} runs; {experiment['assignedExpose']} assigned exposure, {experiment['actuallyExposed']} actually exposed. First-assignment groups contain {experiment['firstAssignmentGroups']['expose']} exposed-assigned and {experiment['firstAssignmentGroups']['withhold']} withheld-assigned runs.", ""]
        utility = cohort["utilityCalibration"]
        measured = utility["nativeAuthoritativeReadMilliseconds"]
        lines += [f"Native authoritative reads: mean {_fmt(measured['mean'])} ms, p95 {_fmt(measured['p95'])} ms, n={measured['n']}. Controller, snapshot transport, validation and asynchronous goal timings are reported separately in report.json.", "", utility["meaning"], ""]
        if (cohort["studyStage"] == "confirmation" and
                all(data["counts"]["speculativeCalls"]["missingTrials"] == 0 and
                    data["counts"]["speculativeCalls"]["knownSum"] == 0 for data in cohort["arms"].values())):
            lines += ["No arm executed speculative reads in this confirmation cohort. GoalSpec's frozen utility policy abstained; these confirmation outcomes do not measure a benefit from active prefetching or evidence exposure. Development speculative execution is reported separately above.", ""]
    lines += ["## Separate supporting analyses", "", "Supporting artifacts are included under `supporting` in report.json and hashed in manifest.json. Candidate coverage and controller action matching are prediction diagnostics; they are not causal usefulness or live task accuracy. The controller's exposure head is untrained unless its own training report says otherwise. Historical v3 official-task results use a different, previously exposed cohort and are not a head-to-head comparison with v4.", "",
              "Exact promotions are a lower bound on reuse. Unpromoted calls are not automatically wasted when evidence was exposed. Freshness leases and revalidation queries are counted separately. Tool non-error rate is descriptive and does not establish correct tool arguments. Request usage is not an invoice; unknown charges retain their full reservation without adding the known subtotal twice.", ""]
    supporting = report["supporting"]
    if "candidateAudit" in supporting:
        audit = supporting["candidateAudit"]["report"]
        lines += ["### Candidate graph coverage", "", "| Pool | Exact next-read arguments present |", "| --- | --- |"]
        for pool, hits in audit.get("exactArgumentPoolCoverage", {}).items():
            lines.append(f"| {pool} | {hits}/{audit.get('readTargets')} |")
        lines += ["", "The v4 pool contains up to 32 candidates while saved per-arm v3 pools contain at most three. This is a coverage diagnostic, not a controlled ranking improvement.", ""]
    if "controllerTraining" in supporting:
        training = supporting["controllerTraining"]["report"]
        lines += ["### CPU controller training", "", f"Selected checkpoint: `{training.get('selectedCheckpoint')}`. These are historical selection-family metrics; calibration-family scores were fitted and are not fresh test results.", "",
                  "| Checkpoint | Next-read exact arguments | READ/NO_READ accuracy | Masked BCE |", "| --- | --- | --- | --- |"]
        for name, score in training.get("selectionMetrics", {}).items():
            lines.append(f"| {name} | {score.get('exactArgumentHits')}/{score.get('readDecisions')} | {_fmt(score.get('actionAccuracy'), True)} | {_fmt(score.get('maskedBce'))} |")
        attempts = training.get("soupAttempts", [])
        lines += ["", f"Soup additions accepted: {sum(attempt.get('accepted') is True for attempt in attempts)}/{len(attempts)}. The report does not imply that weight averaging improved performance. Causal exposure head trained: {training.get('causalExposureHeadTrained')}.", ""]
    if "controllerAblation" in supporting:
        ablation = supporting["controllerAblation"]["report"]
        lines += ["### Identical-pool historical replay", "", "| Pool / ranker | Exact arguments Top1 | Tool Top1 | READ/NO_READ NLL | Next-tool cross-entropy estimate |", "| --- | --- | --- | --- | --- |"]
        for universe, rankers in ablation.get("summary", {}).items():
            for ranker, splits in rankers.items():
                score = splits.get("all-development", {})
                lines.append(f"| {universe} / {ranker} | {_fmt(score.get('exactArgumentTop1'), True)} | {_fmt(score.get('toolTop1'), True)} | {_fmt(score.get('actionNllNats'))} | {_fmt(score.get('nextToolCrossEntropyEstimateNats'))} |")
        lines += ["", "This replay includes development prefixes partly reused for training. Cross-entropy is a predictive loss estimate, not true conditional entropy. It does not establish live latency or task success.", ""]
    for key, title in (("freshControllerDevelopment", "Fresh development prefixes: frozen-controller prediction"),
                       ("freshControllerConfirmation", "Held-out confirmation prefixes: frozen-controller prediction")):
        if key not in supporting:
            continue
        replay = supporting[key]["report"]
        lines += [f"### {title}", "", f"{replay['uniqueCheckpoints']} retained Base checkpoints. The controller is frozen; all rankers use identical candidates within each universe. Unavailable known-read predictions remain failed hits. Unknown actual actions and unmeasured losses are counted separately.", "",
                  "| Universe / ranker | Completed / checkpoints | Read labels / unknown actions | Exact arguments Top1 / Top3 | Tool Top1 / Top3 | READ/NO_READ NLL (n) | Next-tool cross-entropy (n) |",
                  "| --- | --- | --- | --- | --- | --- | --- |"]
        for universe, rankers in replay.get("summary", {}).items():
            for ranker, score in rankers.items():
                metrics = score["metrics"]
                action, tool = metrics["actionNllNats"], metrics["nextToolCrossEntropyEstimateNats"]
                lines.append(f"| {universe} / {ranker} | {score['completed']}/{score['checkpoints']} | {score['readActions']} / {score['unknownActions']} | {_fmt(metrics['exactTop1']['estimate'], True)} / {_fmt(metrics['exactTop3']['estimate'], True)} | {_fmt(metrics['toolTop1']['estimate'], True)} / {_fmt(metrics['toolTop3']['estimate'], True)} | {_fmt(action['estimate'])} ({action['denominator']}) | {_fmt(tool['estimate'])} ({tool['denominator']}) |")
        lines += ["", "| Universe / ranker | Exact Top1 after admission gates (n) | READ sensitivity (n) | NO_READ specificity (n) |",
                  "| --- | --- | --- | --- |"]
        for universe, rankers in replay.get("summary", {}).items():
            for ranker, score in rankers.items():
                metrics = score["metrics"]
                cells = [f"{_fmt(metrics[name]['estimate'], True)} ({metrics[name]['denominator']})"
                         for name in ("gatedExactTop1", "readSensitivity", "noReadSpecificity")]
                lines.append(f"| {universe} / {ranker} | " + " | ".join(cells) + " |")
        lines += ["", "Ungated ranking and admission answer different questions. Admission requires READ classification plus learned readiness and within-two-action use thresholds. Better candidate ranking can coexist with fewer correct admitted reads when these gates suppress actual read boundaries. These action labels do not measure causal usefulness.", "",
                  "| Same-pool frozen logistic minus prior | Matched checkpoints | Exact arguments Top1 difference [95% CI] | Gated exact Top1 difference [95% CI] | READ/NO_READ NLL difference [95% CI] |",
                  "| --- | --- | --- | --- | --- |"]
        for universe, pair in replay.get("pairedDifferences", {}).items():
            exact, gated, loss = (pair["differences"][key] for key in ("exactTop1", "gatedExactTop1", "actionNllNats"))
            lines.append(f"| {universe} | {len(pair['matchedCheckpointIds'])} | {_fmt(exact['estimate'], True)} [{_fmt(exact['lower'], True)}, {_fmt(exact['upper'], True)}] (n={exact['matchedMeasuredCheckpoints']}) | {_fmt(gated['estimate'], True)} [{_fmt(gated['lower'], True)}, {_fmt(gated['upper'], True)}] (n={gated['matchedMeasuredCheckpoints']}) | {_fmt(loss['estimate'])} [{_fmt(loss['lower'])}, {_fmt(loss['upper'])}] (n={loss['matchedMeasuredCheckpoints']}) |")
        lines += ["", "Intervals resample whole families. Negative paired loss differences favor the controller. The tool loss normalizes summed independent candidate confidences with an epsilon over the tool catalog; it is not true conditional entropy. This offline replay provides no live latency, causal usefulness or task-success estimate.", ""]
    if "goalReplay" in supporting:
        goals = supporting["goalReplay"]
        lines += ["### Current frozen-reference goal agreement", "", f"Source: `{goals['directory']}`.", "", f"Top1 {_fmt(goals['top1'], True)}; Top3 {_fmt(goals['top3'], True)}; {goals['scored']}/{goals['revisions']} grades available. Missing grades: {goals['missingGrades']}. Paired original/current grades: {goals['pairedScored']}.", "", goals["meaning"], ""]
        if "v3Matches" in goals["summary"] and "v4Matches" in goals["summary"]:
            lines += [f"Frozen original Top1 matches: {goals['summary']['v3Matches']}/{goals['pairedScored']}; current Top1 matches: {goals['summary']['v4Matches']}/{goals['pairedScored']}. Recovered protocol validity does not imply recovered semantic agreement.", ""]
    if supporting.get("earlierGoalReplays"):
        lines += ["### Preserved earlier goal-replay iterations", "", "Earlier development iterations remain separate. Current results do not overwrite or replace these outcomes.", "",
                  "| Earlier source | Top1 | Top3 | Grades / revisions | Missing grades |", "| --- | --- | --- | --- | --- |"]
        for goals in supporting["earlierGoalReplays"]:
            lines.append(f"| {goals['directory']} | {_fmt(goals['top1'], True)} | {_fmt(goals['top3'], True)} | {goals['scored']}/{goals['revisions']} | {goals['missingGrades']} |")
        lines += ["", "These sequential development revisions reuse the original teacher references. They are not independent held-out experiments, and the report makes no selection-adjusted significance claim.", ""]
    if "historicalV3" in supporting:
        historical = supporting["historicalV3"]["report"]
        lines += ["### Historical v3 native official-task subset", "", "| Arm | Task successes / trials | Mean total live seconds |", "| --- | --- | --- |"]
        for arm, score in historical.get("arms", {}).items():
            timing = score.get("timingSeconds", {}).get("totalTrialSeconds", {})
            lines.append(f"| {arm} | {score.get('successes')}/{score.get('trials')} | {_fmt(timing.get('mean'))} |")
        lines += ["", "Separate previously exposed historical cohort; not an official full-benchmark score and not a matched v3-v4 experiment.", ""]
    if "accounting" in supporting:
        accounting = supporting["accounting"]["report"]
        lines += ["### Cumulative project accounting", "",
                  f"Settled logical-request usage: ${_fmt(accounting.get('totalKnownUsageCostUsd'))}. Spent or reserved: ${_fmt(accounting.get('totalSpentOrReservedUsd'))} of the ${_fmt(accounting.get('totalCeilingUsd'))} ceiling. Unresolved requests: {accounting.get('unresolvedRequests')}. AWS charges: ${_fmt(accounting.get('awsChargesUsd'))}.", "",
                  "This cumulative ledger and the cohort known-usage subtotals have different boundaries: successful-attempt usage inside an unresolved logical request can appear in a trial subtotal before that request settles. Do not add cohort subtotals to cumulative ledger amounts or treat either as a reconciled invoice. Unresolved charges remain bounded by retained reservations.", ""]
    if "confirmationFailureAudit" in supporting:
        diagnostic = supporting["confirmationFailureAudit"]["report"]
        lines += ["### Post-hoc confirmation failure audit", "",
                  f"Source: `{supporting['confirmationFailureAudit']['source']}`. The complete diagnostic is embedded in report.json. This is a trace inspection after outcomes closed, not a new evaluation or a causal attribution. Original scores and frozen completion checks remain unchanged.", ""]
        limitation = diagnostic.get("simulatorAndVerifierLimitation", {})
        for field in ("finding", "causalClaim"):
            if limitation.get(field):
                lines += [limitation[field], ""]
        gate = diagnostic.get("gateAudit", {})
        if gate.get("readinessFinding"):
            lines += [gate["readinessFinding"], "", "No admission thresholds were changed after confirmation. This diagnostic is separate from the frozen confirmation scores.", ""]
    if "reproduction" in report:
        reproduction = report["reproduction"]
        lines += ["## Reproduce this analysis without provider calls", "",
                  "Run from the repository root using the existing analysis environment and a new output directory:", "",
                  "```powershell", reproduction["command"], "```", "", reproduction["relocationCaveat"], ""]
    return "\n".join(lines)


def _numeric_rows(value, prefix=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _numeric_rows(item, (*prefix, str(key)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _numeric_rows(item, (*prefix, str(index)))
    elif number(value):
        yield (".".join(prefix), value)


def write_report(plan_path, output, expected_sha256=None):
    sources = Sources()
    plan_path, output = Path(plan_path).resolve(), Path(output).resolve()
    if expected_sha256 and file_hash(plan_path) != expected_sha256:
        raise ValueError("Report plan differs from expected hash")
    if output.exists():
        raise FileExistsError("Report output must be a new immutable directory")
    plan = sources.read(plan_path)
    samples, seed = plan.get("bootstrapSamples", 5000), plan.get("seed", 20260916)
    if not isinstance(samples, int) or not 100 <= samples <= 100000:
        raise ValueError("Invalid bounded bootstrap sample count")
    stages = [load_stage(item["directory"], sources, item.get("eventPaths", [])) for item in plan["cohorts"]]
    if len({(stage["design"]["studyId"], stage["design"]["studyStage"]) for stage in stages}) != len(stages):
        raise ValueError("Duplicate native cohort")
    supporting = {}
    allowed = {"candidateAudit", "controllerTraining", "controllerAblation", "historicalV3", "accounting", "confirmationFailureAudit",
               "freshControllerDevelopment", "freshControllerConfirmation"}
    for key, path in plan.get("supporting", {}).items():
        if key not in allowed:
            raise ValueError(f"Unknown supporting report: {key}")
        supporting[key] = {"source": str(Path(path).resolve()), "report": sources.read(path)}
        if key in ("freshControllerDevelopment", "freshControllerConfirmation"):
            expected_stage = "development" if key == "freshControllerDevelopment" else "confirmation"
            replay = supporting[key]["report"]
            if replay.get("version") != "goalspec-frozen-controller-native-report-v1" or replay.get("cohortStage") != expected_stage:
                raise ValueError("Fresh controller report cohort stage or version mismatch")
    if plan.get("goalReplayDirectory"):
        supporting["goalReplay"] = goal_replay(plan["goalReplayDirectory"], sources)
    earlier = [Path(path).resolve() for path in plan.get("earlierGoalReplayDirectories", [])]
    if len(set(earlier)) != len(earlier) or (plan.get("goalReplayDirectory") and Path(plan["goalReplayDirectory"]).resolve() in earlier):
        raise ValueError("Earlier goal replays must be distinct from each other and the current replay")
    if earlier:
        supporting["earlierGoalReplays"] = [goal_replay(directory, sources) for directory in earlier]
    report = {"version": VERSION, "label": LABEL, "officialBenchmarkScore": None,
              "bootstrapSamples": samples, "seed": seed,
              "cohorts": [analyze_stage(stage, samples, seed) for stage in stages], "supporting": supporting}
    plan_argument = str(plan_path).replace("'", "''")
    report["reproduction"] = {
        "planPath": str(plan_path), "planSha256": file_hash(plan_path), "providerCalls": 0,
        "command": "& research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/report_native_v4.py "
                   f"--plan '{plan_argument}' --expected-sha256 {file_hash(plan_path)} "
                   "--output research/goalspec/runs/local-v4-report-reproduction",
        "relocationCaveat": "Artifacts contain absolute paths. On another checkout, create a new input plan with explicit mappings to repository-relative files, resolve them from the repository root, and rehash the new plan and any derived manifests. Nested frozen references must also remain resolvable and hash-verified. Preserve every original manifest and source artifact; do not rewrite original hashes to hide relocation. The command above reproduces the original analysis in its recorded workspace, not an automatically relocatable archive."}
    for stage in stages:
        if output.is_relative_to(Path(stage["directory"])):
            raise ValueError("Report output cannot modify source cohort directories")
    for path in sources.hashes:
        source = Path(path)
        if source.is_relative_to(output):
            raise ValueError("Report output cannot contain or modify source artifact directories")
    sources.track(Path(__file__))
    sources.track(Path(__file__).with_name("report_v3.py"))
    sources.track(Path(__file__).resolve().parents[2] / "scripts" / "report_native_v4.py")
    sources.verify()
    output.mkdir(parents=True, exist_ok=False)
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    (output / "README.md").write_text(markdown(report), encoding="utf-8")
    with (output / "metrics.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["metric_path", "value"])
        writer.writerows(_numeric_rows(report))
    sources.verify()
    manifest = {"version": VERSION, "planSha256": file_hash(plan_path), "sources": sources.hashes,
                "outputs": {path.name: file_hash(path) for path in sorted(output.iterdir())},
                "immutable": True, "noProviderCalls": True, "privateArtifactsReadOnlyAfterClosedOutcomes": True}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report
