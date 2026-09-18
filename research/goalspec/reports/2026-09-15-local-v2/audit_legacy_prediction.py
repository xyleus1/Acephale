"""Independently check the closed legacy prediction replay; never open a ledger."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("legacy-prediction-audit.json"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    base = root / "research/goalspec/runs/local-v2-legacy-replay-20260915"
    output = base / "predictions"
    host_path = root / "research/goalspec/runs/local-v2-legacy-replay-predict-host-20260915/events.jsonl"
    queue = rows(base / "queue.jsonl")
    predictions = rows(output / "requested-predictions.jsonl")
    frozen = rows(output / "frozen-goals.jsonl")
    events = rows(output / "events.jsonl")
    progress = rows(output / "progress.jsonl")
    report = json.loads((output / "report.json").read_text())
    host = rows(host_path)
    errors = []

    def check(condition, name):
        if not condition:
            errors.append(name)

    for name, data in [("events", events), ("progress", progress)]:
        previous = "0" * 64
        for position, row in enumerate(data):
            check(row["body"]["sequence"] == position and row["body"]["previousHash"] == previous
                  and hashlib.sha256(canonical(row["body"])).hexdigest() == row["hash"], f"{name}:chain:{position}")
            previous = row["hash"]
    check(len(queue) == len(predictions) == len(frozen) == len(progress) == 213, "row_counts")
    check(len({row["id"] for row in queue}) == 213, "unique_queue_ids")
    check([row["id"] for row in queue] == [row["id"] for row in predictions], "prediction_order")
    check(hashlib.sha256(canonical(queue)).hexdigest() == report["queueHash"], "queue_hash")
    check(report["attemptedJobs"] == report["completed"] == 213 and report["failed"] == 0
          and report["status"] == "complete", "report_counts")
    payloads = [row["body"]["event"] for row in events]
    attempts = [event for event in payloads if event.get("type") == "model_attempt"]
    responses = [event for event in payloads if event.get("type") == "prediction_response"]
    compilers = [event for event in payloads if event.get("compilerVersion") == "compact-goals-v2"]
    model = "gpt-4.1-mini-2025-04-14"
    check(len(attempts) == len(responses) == len(compilers) == 213, "event_call_counts")
    check(len({event["id"] for event in attempts}) == 213, "unique_attempt_ids")
    check({event["id"] for event in attempts} == {"prediction:" + row["id"] for row in queue}, "call_queue_mapping")
    check({event["checkpointId"] for event in responses} == {row["id"] for row in queue}, "response_queue_mapping")
    check(all(event["attempt"] == 0 and event["model"] == event["requestedModel"] == model
              and event["status"] == "completed" and not event["refusals"] and event["incomplete"] is None
              for event in attempts), "one_completed_pinned_attempt_each")
    check(not any(event.get("type", "").endswith("_failed") for event in payloads), "no_failure_events")
    schema = json.loads((root / "src/lib/goalspec/contracts/v1.schema.json").read_text())
    validator = Draft202012Validator({"$ref": "#/$defs/GoalSet", "$defs": schema["$defs"]})
    requested_unknown = endpoint_unknown = endpoint_partial_unknown = references = 0
    for position, (job, prediction, endpoint) in enumerate(zip(queue, predictions, frozen, strict=True)):
        check(prediction["status"] == "completed" and prediction["model"] == model
              and prediction["requested_input_hash"] == job["requested_input_hash"], f"prediction_identity:{position}")
        check(hashlib.sha256(canonical(job["requested_input"])).hexdigest() == job["requested_input_hash"],
              f"causal_input_hash:{position}")
        goals = prediction["requested_goals"]
        check(not list(validator.iter_errors(goals)), f"goal_schema:{position}")
        mass = [goals["unknown"]] + [hypothesis["probability"] for hypothesis in goals["hypotheses"]]
        check(all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1 for value in mass)
              and abs(sum(mass) - 1) < 1e-6, f"goal_mass:{position}")
        requested_unknown += goals["unknown"] >= 1 - 1e-6
        for hypothesis in goals["hypotheses"]:
            refs = hypothesis["sources"] + [ref for constraint in hypothesis["constraints"] for ref in constraint["sources"]]
            for ref in refs:
                references += 1
                check(ref["sourceId"] in job["requested_input"]["sources"] and ref["path"] == [], f"causal_source:{position}")
        check(endpoint["trajectory_id"] == job["trajectory_id"]
              and endpoint["through_seq"] == endpoint["posterior"]["through_seq"] == job["through_seq"]
              and endpoint["visible_input_hash"] == job["visible_input_hash"]
              and endpoint["status"] == "completed" and endpoint["posterior"]["model_id"] == model,
              f"endpoint_identity:{position}")
        probabilities = endpoint["posterior"]["probabilities"]
        allowed = {"__unknown__"} | {entry["goal_id"] for entry in job["pattern_goal_catalog"]}
        check(set(probabilities) <= allowed and "__unknown__" in probabilities
              and all(math.isfinite(value) and 0 <= value <= 1 for value in probabilities.values())
              and abs(sum(probabilities.values()) - 1) < 1e-6, f"endpoint_distribution:{position}")
        endpoint_unknown += probabilities["__unknown__"] >= 1 - 1e-6
        endpoint_partial_unknown += probabilities["__unknown__"] > 0
    positions = []
    for row in progress:
        event = row["body"]["event"]
        position = event["position"]
        positions.append(position)
        check(event["result"] == predictions[position] and event["frozen"] == frozen[position],
              f"progress_output_match:{position}")
    check(sorted(positions) == list(range(213)), "progress_positions_once_each")
    heartbeats = [event for event in host if event["event"] == "heartbeat"]
    final = host[-1]
    acquired = next(event for event in host if event["event"] == "execution_state_acquired")
    released = next(event for event in host if event["event"] == "execution_state_released")
    check(final["event"] == "guard_closed" and final["childExitCode"] == final["guardExitCode"] == 0
          and final["executionStateReleased"] and not final["childStillRunning"] and not final["degradedDuringRun"], "host_closure")
    check(all(event["healthy"] and event["networkConnected"] for event in heartbeats[:-1])
          and heartbeats[-1]["reasons"] == ["guard_closed"], "host_health")
    check(acquired["threadId"] == released["threadId"], "same_thread_hold_release")
    check(not any(event["event"] in {"guard_failed", "status_publish_failed"} for event in host), "host_no_failures")
    usage = {"inputTokens": sum(event["usage"]["input_tokens"] for event in attempts),
             "cachedInputTokens": sum(event["usage"]["input_tokens_details"]["cached_tokens"] for event in attempts),
             "outputTokens": sum(event["usage"]["output_tokens"] for event in attempts)}
    result = {"schemaVersion": 1, "passed": not errors, "discrepancies": errors, "checkpoints": 213, "model": model,
              "completedCalls": len(attempts), "failedCalls": len([e for e in payloads if e.get("type", "").endswith("_failed")]),
              "observedAttemptIndices": sorted({event["attempt"] for event in attempts}), "events": len(events),
              "progressEntries": len(progress), "sourceReferencesVerified": references,
              "fullyUnknownRequestedGoals": requested_unknown, "fullyUnknownCatalogPosteriors": endpoint_unknown,
              "catalogPosteriorsWithAnyUnknownMass": endpoint_partial_unknown,
              "catalogPosteriorsWithPositiveKnownMass": 213 - endpoint_unknown, "providerReportedUsage": usage,
              "knownPredictionCostMicrodollars": sum(event["costMicrodollars"] for event in attempts),
              "reportSpentOrReservedMicrodollars": report["spentOrReservedMicrodollars"],
              "reportCostScope": "cumulative shared ledger commitments at prediction closure, not prediction-only cost",
              "host": {"heartbeats": len(heartbeats), "maximumGapMs": max(event["heartbeatGapMs"] or 0 for event in heartbeats),
                       "closed": final, "sameThreadHoldReleased": acquired["threadId"] == released["threadId"]},
              "sources": [{"path": path.relative_to(root).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size}
                          for path in [base / "queue.jsonl", output / "events.jsonl", output / "progress.jsonl",
                                       output / "report.json", output / "requested-predictions.jsonl", output / "frozen-goals.jsonl", host_path]],
              "limitations": ["Schema, probability, and visible-source validity do not establish semantic correctness.",
                              "These are previously observed v1 checkpoints and development evidence only.",
                              "Provider usage prices are not invoice reconciliation."],
              "providerCallsByAudit": 0, "ledgerOpenedByAudit": False}
    with args.output.open("x", encoding="utf-8") as target:
        json.dump(result, target, indent=2)
        target.write("\n")
    print(json.dumps({key: value for key, value in result.items() if key != "sources"}, indent=2))


if __name__ == "__main__":
    main()
