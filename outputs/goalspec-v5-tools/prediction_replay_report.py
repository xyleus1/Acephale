"""Frozen same-pool prediction replay: family bootstrap, no fitting or rescoring."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.contracts_v1 import hash_v1  # noqa: E402

VERSION = "goalspec-v5-confirmation-prediction-report-v1"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line]


def ci(rows, value, samples=5000, seed=20260919):
    groups = defaultdict(list)
    for row in rows:
        groups[row["familyId"]].append(row)
    def estimate(items):
        observed = [value(row) for row in items]
        numbers = [item for item in observed if isinstance(item, (int, float)) and math.isfinite(item)]
        return sum(numbers) / len(numbers) if numbers else None
    point = estimate(rows)
    if point is None:
        return {"estimate": None, "lower": None, "upper": None, "observed": 0, "denominator": len(rows), "families": len(groups)}
    rng, family_ids, boot = random.Random(seed), sorted(groups), []
    for _ in range(samples):
        batch = [row for family in rng.choices(family_ids, k=len(family_ids)) for row in groups[family]]
        result = estimate(batch)
        if result is not None:
            boot.append(result)
    boot.sort()
    return {"estimate": point, "lower": boot[int(.025 * (len(boot) - 1))], "upper": boot[int(.975 * (len(boot) - 1))],
            "observed": sum(value(row) is not None for row in rows), "denominator": len(rows), "families": len(groups)}


def verify_input(directory):
    manifest, plan = read(directory / "manifest.json"), read(directory / "plan.json")
    if manifest.get("version") != "goalspec-v5-confirmation-prediction-replay-v1" or manifest.get("planned") != 16 or manifest.get("retained") != 16:
        raise ValueError("Closed sixteen-prefix replay required")
    if sha(directory / "plan.json") != manifest["planSha256"] or hash_v1(plan["selected"]) != manifest["selectedHash"]:
        raise ValueError("Frozen replay plan/selection changed")
    for entry in manifest["files"]:
        if sha(directory / entry["name"]) != entry["sha256"]:
            raise ValueError("Closed replay output hash mismatch")
    for entry in manifest["sources"]:
        if sha(entry["path"]) != entry["sha256"]:
            raise ValueError("Native input changed")
    for entry in manifest["code"]:
        relative = Path(entry["path"]).resolve().relative_to(ROOT)
        if sha(directory / "source" / relative) != entry["sha256"]:
            raise ValueError("Frozen replay source archive changed")
    scores, annotations = jsonl(directory / "scores.jsonl"), jsonl(directory / "annotations.jsonl")
    selected = {row["id"]: row for row in plan["selected"]}
    rankers = manifest["primaryRankers"] + manifest["sensitivityRankers"]
    if len(scores) != 16 * len(rankers) or len(annotations) != 16 or {row["id"] for row in annotations} != set(selected):
        raise ValueError("Incomplete annotation/ranker denominator")
    expected = {(identifier, ranker) for identifier in selected for ranker in rankers}
    if {(row["id"], row["ranker"]) for row in scores} != expected:
        raise ValueError("Missing same-pool score cell")
    for identifier, selection in selected.items():
        group = [row for row in scores if row["id"] == identifier]
        if len({(row["poolHash"], row["poolSize"], row["poolCovered"], row["actualRead"]) for row in group}) != 1:
            raise ValueError("Rankers did not share the candidate/label pool")
        if any(row["familyId"] != selection["familyId"] or row["domain"] != selection["domain"] for row in group):
            raise ValueError("Checkpoint family/domain identity changed")
        if manifest.get("matchedTemperatureDiagnostic"):
            matched = [row for row in group if row["ranker"] in {"matched-temperature-neutral", "matched-temperature-full-goal"}]
            if len(matched) != 2:
                raise ValueError("Missing matched-temperature diagnostic pair")
            completed = [row for row in matched if row.get("decision") is not None]
            if completed and (len(completed) != 2 or any(row.get("analysisOnly") is not True
                or row.get("appliedTemperature") != manifest["matchedTemperatureDiagnostic"]["temperature"] for row in completed)
                or completed[0].get("contextHash") != completed[1].get("contextHash")
                or completed[0].get("calibrationOverride") != completed[1].get("calibrationOverride")
                or not completed[0].get("calibrationOverride", {}).get("offlineOnly")):
                raise ValueError("Matched-temperature weights/context/calibration lineage changed")
    previous, known_cost, attempts, unknown = "0" * 64, 0, 0, 0
    for sequence, row in enumerate(jsonl(directory / "provider-events.jsonl")):
        body = row["body"]
        if body["sequence"] != sequence or body["previousHash"] != previous or hash_v1(body) != row["hash"]:
            raise ValueError("Provider event chain changed")
        previous = row["hash"]
        event = body["event"]
        if event["type"].startswith("model_attempt"):
            attempts += 1
            if isinstance(event.get("costMicrodollars"), int):
                known_cost += event["costMicrodollars"]
            else:
                unknown += 1
    return manifest, plan, scores, annotations, {"physicalProviderAttempts": attempts, "attemptsWithoutKnownCost": unknown,
        "knownResponseUsageUsd": known_cost / 1e6, "reservedMaximumUsd": plan["maximumMicrodollars"] / 1e6,
        "invoiceClaim": False, "providerEventFinalHash": previous}


def summarize(directory, samples=5000):
    manifest, plan, scores, annotations, costs = verify_input(directory)
    summaries, by_domain, paired = {}, {}, {}
    rankers = manifest["primaryRankers"] + manifest["sensitivityRankers"]
    metrics = ["toolTop1", "toolTop3", "exactTop1", "exactTop3", "jointReadExactTop1", "poolCovered"]
    losses = ["binaryReadNllNats", "categoryNllNats", "exactSetNllNats", "toolSetNllNats"]

    def summary(rows):
        reads = [row for row in rows if row["actualRead"] is True]
        no_reads = [row for row in rows if row["actualRead"] is False]
        return {"checkpoints": len(rows), "readCheckpoints": len(reads), "noReadCheckpoints": len(no_reads),
            "unknownActionLabels": sum(row["actualRead"] is None for row in rows),
            "unavailablePredictions": sum(row["status"] != "completed" for row in rows),
            "metrics": {key: ci(reads, lambda row, key=key: float(row.get(key) is True), samples) for key in metrics},
            "noReadSpecificity": ci(no_reads, lambda row: float(row.get("noReadCorrect") is True), samples),
            "losses": {key: ci(rows, lambda row, key=key: row.get(key), samples) for key in losses},
            "exactLossFloorCount": sum(row.get("exactLossFloored") is True for row in rows),
            "toolLossFloorCount": sum(row.get("toolLossFloored") is True for row in rows),
            "goalCorrectionStatuses": dict(Counter((row.get("decision") or {}).get("goalCorrectionStatus", "unavailable") for row in rows))}

    for ranker in rankers:
        rows = [row for row in scores if row["ranker"] == ranker]
        summaries[ranker] = summary(rows)
        by_domain[ranker] = {domain: summary([row for row in rows if row["domain"] == domain]) for domain in ("retail", "airline")}
    full = {row["id"]: row for row in scores if row["ranker"] == "full-goal"}
    for ranker in rankers:
        if ranker == "full-goal":
            continue
        controls = [row for row in scores if row["ranker"] == ranker]
        read_rows = [row for row in controls if row["actualRead"] is True]
        paired[ranker] = {key: ci(read_rows, lambda row, key=key: float(full[row["id"]].get(key) is True) - float(row.get(key) is True), samples)
            for key in metrics if key != "poolCovered"}
        paired[ranker]["categoryNllNats"] = ci(controls, lambda row: (full[row["id"]]["categoryNllNats"] - row["categoryNllNats"])
            if full[row["id"]].get("categoryNllNats") is not None and row.get("categoryNllNats") is not None else None, samples)
    gradeable = [row for row in annotations if row["grades"] is not None]
    matched_temperature = None
    if manifest.get("matchedTemperatureDiagnostic"):
        control_rows = [row for row in scores if row["ranker"] == "matched-temperature-neutral"]
        treated = {row["id"]: row for row in scores if row["ranker"] == "matched-temperature-full-goal"}
        read_rows = [row for row in control_rows if row["actualRead"] is True]
        matched_temperature = {**manifest["matchedTemperatureDiagnostic"], "primaryControlChanged": False,
            "differencesFullResidualMinusNeutral": {
                **{key: ci(read_rows, lambda row, key=key: float(treated[row["id"]].get(key) is True) - float(row.get(key) is True), samples)
                    for key in metrics if key != "poolCovered"},
                **{key: ci(control_rows, lambda row, key=key: (treated[row["id"]][key] - row[key])
                    if treated[row["id"]].get(key) is not None and row.get(key) is not None else None, samples) for key in losses}},
            "meaning": "Offline matched-temperature residual sensitivity only. Same current-goal context, memory, candidate pool and frozen weights. No live policy override or model fit."}
    agreement = {"selected": 16, "graded": len(gradeable), "missingGrades": 16 - len(gradeable),
        "goalTop1AllSelected": ci(annotations, lambda row: float(row["goalTop1"] is True), samples),
        "goalTop3AllSelected": ci(annotations, lambda row: float(row["goalTop3"] is True), samples),
        "goalTop1GradedOnly": ci(gradeable, lambda row: float(row["goalTop1"] is True), samples),
        "goalTop3GradedOnly": ci(gradeable, lambda row: float(row["goalTop3"] is True), samples),
        "sourceGroundedNonempty": sum(row["sourceGrounded"] for row in annotations),
        "emittedHypothesisCounts": dict(Counter(len((row.get("goals") or {}).get("hypotheses", [])) for row in annotations)),
        "failuresByStage": dict(Counter(failure["stage"] for row in annotations for failure in row["failures"]))}
    return {"version": VERSION, "label": "Frozen public official-task Base-prefix replay; not a pristine heldout or live task score",
        "manifestSha256": sha(directory / "manifest.json"), "planSha256": manifest["planSha256"], "controllerSha256": manifest["controllerSha256"],
        "reportGeneratorSha256": sha(Path(__file__)),
        "bootstrap": {"samples": samples, "seed": 20260919, "unit": "familyId", "interval": "percentile95",
            "caveat": "Small family count; a zero-width sample interval does not establish population certainty"},
        "primaryRankers": manifest["primaryRankers"], "sensitivityRankers": manifest["sensitivityRankers"],
        "agreement": agreement, "summary": summaries, "byDomain": by_domain, "pairedFullGoalMinusControl": paired,
        "matchedTemperatureResidualDiagnostic": matched_temperature, "cost": costs,
        "metricDefinitions": {
            "toolTop1/toolTop3": "Read-only tool-name match among the ranked read candidates, conditional on a next batch containing an audited read. Denominator is readCheckpoints, including prediction failures as misses. Writes and NO_READ do not earn tool accuracy credit.",
            "exactTop1/exactTop3": "Read-only full-argument match to any audited read in the next actor batch, among ranked read candidates. Denominator is readCheckpoints. Ungated ranking does not require the joint decision to select READ and does not predict an entire batch.",
            "jointReadExactTop1": "Same read-only exact-match denominator, additionally requiring joint argmax READ. This is not scheduler admission.",
            "poolCovered": "At least one actual audited read invocation including arguments is in the shared pool; denominator is readCheckpoints.",
            "noReadSpecificity": "NO_READ selected when the next actor batch contains no audited read. Denominator is noReadCheckpoints. This aggregates writes, messages, stopping and other non-read behavior; no exact write tool or write argument is predicted.",
            "categoryNllNats": "Coarsened next-read decision/set-event log loss over pool read invocations, NO_READ and READ_UNCOVERED. Covered batches use summed probability of matching read invocations. Uncovered read batches use READ_UNCOVERED mass, which gives no exact tool/argument prediction. Observed known-label predictions only, with denominator and coverage reported. Not full native next-action tool-and-argument log loss.",
            "binaryReadNllNats": "Binary audited READ versus NO_READ log loss; it does not resolve which write, message or stop occurs.",
            "exactSetNllNats/toolSetNllNats": "Summed matching read-invocation or read-tool probability under the joint distribution, scored only on observed read-labeled predictions. Missing pool mass is floored at1e-12, never replaced by READ_UNCOVERED mass. Loss observed counts can be smaller than the primary read accuracy denominator."},
        "interpretation": {"positiveAccuracyDifference": "Full GoalSpec is better", "positiveLossDifference": "Full GoalSpec is worse",
            "entropy": "Coarsened next-read decision/set-event cross-entropy estimates, not full native action log loss, true conditional entropy or causal information gain",
            "outsidePoolLoss": "Exact/tool mass floored at1e-12; READ_UNCOVERED category is reported separately and is not an exact argument prediction",
            "teacher": "Agreement and teacher-goal hints remain fallible; no private answers or next actions entered annotation",
            "temperature": "Primary controls preserve frozen-policy neutral and goal-active temperatures, which can differ. Their probability/loss differences combine residual and calibration effects. A separately declared matched-temperature pair isolates the residual at the frozen goal-active temperature without changing primary controls.",
            "shuffled": manifest["shuffledControl"], "samePool": "No-memory is a ranking ablation on the same candidate pool; not an end-to-end generation comparison",
            "policy": manifest.get("poolPolicy", "Pre-policy pool; joint argmax is not scheduler admission"),
            "failedRows": "Missing goal grades count as misses in all-selected agreement; known-label prediction failures count as accuracy misses; unknown action labels and log-loss coverage stay explicit"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    args = parser.parse_args()
    if args.output.exists() or not 100 <= args.bootstrap_samples <= 10000:
        raise ValueError("New output path and bounded bootstrap required")
    report = summarize(args.input.resolve(), args.bootstrap_samples)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.output), "sha256": sha(args.output), "agreement": report["agreement"]}))


if __name__ == "__main__":
    main()
