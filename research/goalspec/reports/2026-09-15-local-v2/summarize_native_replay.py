"""Describe admitted-candidate native replay without changing live outcome scores."""
from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = ROOT / "research/goalspec/runs/local-v2-confirmation-native-replay-20260915"


def main():
    output = HERE / "native-replay-analysis"
    if output.exists():
        raise ValueError("Native replay summary already exists")
    method = json.loads((SOURCE / "method-report.json").read_text(encoding="utf-8"))
    scheduler = json.loads((SOURCE / "scheduler-summary.json").read_text(encoding="utf-8"))
    coverage, runs, audit = method["coverage"], method["runs"], method["sourceAudit"]
    if (len(coverage) != 48 or len(runs) != 32 or method["providerCalls"] != 0
            or not all(run["observationParity"] and run["stateParity"] for run in runs)
            or not method["inputSourcesUnchanged"] or not method["finalProtectedExecutionUnchanged"]):
        raise ValueError("Incomplete or inconsistent native replay")
    counts = []
    for name in ("neutral_memory_prefetch", "goalspec"):
        selected = [run for run in runs if run["arm"] == name]
        if len(selected) != 16:
            raise ValueError("Expected all 16 speculative-arm tapes")
        row = {"arm": name, "runs": len(selected)}
        for key in ("nativeCalls", "authoritativeCalls", "speculativeCalls", "consumptions", "wastedCalls",
                    "physicalAuthoritativeReads", "physicalReads", "freshnessChecks", "revalidationCalls"):
            row[key] = sum(run[key] for run in selected)
        if row["nativeCalls"] - row["consumptions"] != row["authoritativeCalls"] or row["speculativeCalls"] - row["consumptions"] != row["wastedCalls"]:
            raise ValueError("Native consumption accounting did not reconcile")
        times = [run["replayLatencyMs"] for run in selected]
        row["observedReplayMeanMs"] = float(np.mean(times))
        row["observedReplayMedianMs"] = float(np.median(times))
        row["observedReplayP95Ms"] = float(np.quantile(times, .95))
        row["observedReplayMaximumMs"] = max(times)
        counts.append(row)
    sources = [SOURCE / name for name in ("method-report.json", "report.json", "scheduler-summary.json",
               "candidate-source-audit.json", "replay-method-manifest.json")]
    sources.append(Path(__file__))
    receipts = [{"path": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sources]
    summary = {"schemaVersion": "v2-native-replay-summary-1", "coverage": coverage, "arms": counts,
               "candidateAudit": {key: value for key, value in audit.items() if key not in ("records", "logReceipts")},
               "scheduler": scheduler, "sourceInputs": receipts, "providerCalls": 0,
               "all32ObservationAndStateChecksPassed": True, "liveOutcomesRescored": False,
               "latencyInterpretation": "Local fixed-tape timings include setup and exclude model work; they do not measure live trial latency or comparative speed improvement",
               "availabilityInterpretation": method["candidateAvailabilityInterpretation"]}
    lines = ["# Native execution replay", "",
             "All 32 recorded speculative-arm tapes (16 neutral and 16 GoalSpec) replayed against fresh native states with identical tool observations and final database states. All 48 original confirmation rows are retained in coverage; 16 base-arm rows have no candidate session and are explicitly excluded from this replay. Original success and termination values remain unchanged. No provider calls or paid inference occurred.", "",
             f"The source audit verified {audit['candidateEvents']} candidate events: {audit['originallyAdmitted']} originally admitted and replayable, and 425 excluded admissions (402 invalid/low-confidence/already-observed, 23 original scheduler rejections). The replay scheduler received 147 candidates across 263 actor boundaries, admitted 125 and rejected 22. Thirty of 32 tapes had at least one admitted candidate. Every event chain, service-manifest ownership, source binding, immutable design, fixture and final runtime hash check passed.", "",
             "| Native physical behavior | Neutral (16 tapes) | GoalSpec (16 tapes) |",
             "| --- | ---: | ---: |"]
    fields = [("Authoritative tool calls, including writes", "authoritativeCalls"),
              ("Physical authoritative reads", "physicalAuthoritativeReads"),
              ("Physical speculative reads", "speculativeCalls"), ("Total physical reads", "physicalReads"),
              ("Exact native lease consumptions", "consumptions"), ("Unmatched speculative reads", "wastedCalls"),
              ("Native freshness lease checks", "freshnessChecks"), ("Physical revalidation calls", "revalidationCalls")]
    for label, key in fields:
        lines.append(f"| {label} | {counts[0][key]} | {counts[1][key]} |")
    lines += ["", "Native speculative executions total 110, while scheduler `physical_read_completed` events total 125. They retain separate denominators; scheduler job completion is not automatically a native read execution. Exact consumption is a lower bound on broader evidence usefulness, and unmatched speculation an upper bound on waste.", "",
              "| Local replay duration | Neutral (n=16) | GoalSpec (n=16) |",
              "| --- | ---: | ---: |"]
    for label, key in (("Mean ms", "observedReplayMeanMs"), ("Median ms", "observedReplayMedianMs"),
                       ("Observed p95 ms", "observedReplayP95Ms"), ("Maximum ms", "observedReplayMaximumMs")):
        lines.append(f"| {label} | {counts[0][key]:.6f} | {counts[1][key]:.6f} |")
    lines += ["", "These are local fixed-tape timings, with no model work. The first GoalSpec tape includes service startup (3,766.816700 ms), retained without correction. They are neither original live timing nor evidence of a comparative live speed improvement. Sample quantiles have only 16 observations per arm.", "",
              "The corrected report-local adapter admits only candidates with original `admission === true`; rejected predictions never become counterfactual accepted inputs. It schedules those candidates at their numbered boundaries. Asynchronous source events do not prove their availability before the original actor decision. The reused frozen `report.json` contains legacy wording that says otherwise; `method-report.json` explicitly qualifies that inherited label. No canonical runtime, predictor, native fixture, verifier or original outcome was edited.", "",
              "The replay establishes observation/state parity and measured physical reuse on fixed action tapes. It does not generate new actor decisions, evaluate the 213 legacy goals in native execution, or replace the primary confirmation result.", "",
              "Detailed source-event IDs, exclusions, scope checks and coverage are in [method-report.json](../../../runs/local-v2-confirmation-native-replay-20260915/method-report.json), with the [input manifest](../../../runs/local-v2-confirmation-native-replay-20260915/replay-method-manifest.json)."]
    output.mkdir()
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (output / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with (output / "arms.csv").open("x", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(counts[0]))
        writer.writeheader()
        writer.writerows(counts)
    (output / "manifest.json").write_text(json.dumps({"sourceInputs": receipts, "files": [
        {"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(output.iterdir())]}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "arms": counts}))


if __name__ == "__main__":
    main()
