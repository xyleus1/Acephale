"""Run the frozen native replay orchestration with an admission-preserving v2 reader.

Only run after confirmation closes. No models, paid provider, or database service.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
FINAL_TREE = "93c2d973b2164ebed9e3a713541586722e4af91ef06f8b811dd8907ea1a09166"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_record(path):
    path = path.resolve(strict=True)
    if not path.is_relative_to(ROOT):
        raise ValueError("Replay sources must stay within this repository")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest.hexdigest(), "bytes": path.stat().st_size}


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def verify_final_source(directory):
    manifest_path = directory / "manifest.json"
    manifest = read(manifest_path)
    if manifest["sourceTreeHash"] != FINAL_TREE or file_record(manifest_path)["sha256"] != (directory / "manifest.sha256").read_text(encoding="ascii").split()[0]:
        raise ValueError("Final source capture mismatch")
    encoded = json.dumps(manifest["sources"], sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    if hashlib.sha256(encoded).hexdigest() != FINAL_TREE:
        raise ValueError("Final source map changed")
    checked = []
    for name, expected in manifest["sources"].items():
        if expected["category"] != "execution":
            continue
        actual = file_record(ROOT / name)
        if any(actual[key] != expected[key] for key in ("sha256", "bytes")):
            raise ValueError(f"Frozen execution source changed: {name}")
        checked.append(actual)
    checked_inputs = []
    for label, expected in manifest["inputs"].items():
        actual = file_record(ROOT / expected["path"])
        if any(actual[key] != expected[key] for key in ("sha256", "bytes")):
            raise ValueError(f"Frozen input changed: {label}")
        checked_inputs.append(actual)
    return {"sourceTreeHash": FINAL_TREE, "manifest": file_record(manifest_path),
            "checkedExecutionFiles": checked, "checkedFrozenInputs": checked_inputs}


def run(source, fixtures, logs, freeze, output):
    source, fixtures, freeze, output = (p.resolve() for p in (source, fixtures, freeze, output))
    logs = [p.resolve() for p in logs]
    if output.exists() or output.parent != ROOT / "research/goalspec/runs":
        raise ValueError("Replay output must be a new direct child of research/goalspec/runs")
    rows = [json.loads(line) for line in (source / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]
    design, summary, fixture_data = read(source / "design.json"), read(source / "summary.json"), read(fixtures)
    if any(x.get("studyStage") != "confirmation" for x in (design, summary, fixture_data)) or summary.get("serviceExitCode") != 0:
        raise ValueError("Only a completed confirmation service can be replayed")
    fixture_bytes = json.dumps({k: v for k, v in fixture_data.items() if k != "manifestHash"}, sort_keys=True,
                              ensure_ascii=False, separators=(",", ":")).encode()
    fixture_hashes = {task["taskId"]: task["fixtureHash"] for task in fixture_data["tasks"]}
    if (hashlib.sha256(fixture_bytes).hexdigest() != fixture_data["manifestHash"]
            or design["fixtureManifestHash"] != fixture_data["manifestHash"]
            or summary["fixtureManifestHash"] != fixture_data["manifestHash"]
            or any(row.get("fixtureHash") != fixture_hashes.get(row["taskId"]) for row in rows)):
        raise ValueError("Confirmation fixture manifest changed")
    slot = lambda r: (r.get("familyId", r.get("family")), r["variant"], r["trial"], r["arm"])
    if len(rows) != len(design["trials"]) or len({r["runId"] for r in rows}) != len(rows) or {slot(r) for r in rows} != {slot(r) for r in design["trials"]}:
        raise ValueError("Incomplete or duplicated confirmation cohort")
    if any(r.get("studyStage") != "confirmation" for r in rows):
        raise ValueError("Mixed native source stages")
    claim_path = ROOT / "research/goalspec/runs/local-study-v2-20260915/confirmation-claim.json"
    complete_path = claim_path.with_name("confirmation-complete.json")
    claim = read(claim_path)
    if Path(claim["outputPath"]).resolve() != source or Path(claim["runtimeFreezeDirectory"]).resolve() != freeze or not complete_path.is_file():
        raise ValueError("Confirmation closure or source claim mismatch")
    design_bytes = json.dumps({k: v for k, v in design.items() if k != "designHash"}, sort_keys=True,
                             ensure_ascii=False, separators=(",", ":")).encode()
    if (hashlib.sha256(design_bytes).hexdigest() != design["designHash"]
            or file_record(source / "design.json")["sha256"] != claim["designSha256"]
            or file_record(Path(claim["designPath"]))["sha256"] != claim["designSha256"]):
        raise ValueError("Native source design differs from its claimed immutable design")
    receipt = read(complete_path)
    if (receipt["outcomesSha256"] != file_record(source / "outcomes.jsonl")["sha256"]
            or receipt["summarySha256"] != file_record(source / "summary.json")["sha256"]
            or receipt["trials"] != len(rows) or receipt["allFailuresRetained"] is not True
            or any(item.get("studyId") != claim["studyId"] for item in (design, summary, fixture_data, receipt, *rows))):
        raise ValueError("Closed confirmation receipt mismatch")
    source_check = verify_final_source(freeze)
    if claim["runtimeFreezeManifestSha256"] != source_check["manifest"]["sha256"]:
        raise ValueError("Confirmation claimed a different source manifest")
    original = ROOT / "research/goalspec/scripts/native_execution_replay.py"
    runner = HERE / "native_execution_replay_v2.ts"
    service_manifest_path = source / "service-manifest.json"
    service_manifest = read(service_manifest_path)
    service_run_ids = [run["runId"] for run in service_manifest["runs"]]
    if len(service_run_ids) != len(rows) or set(service_run_ids) != {row["runId"] for row in rows}:
        raise ValueError("Source service manifest does not own exactly the declared confirmation cohort")
    sources = [source / n for n in ("outcomes.jsonl", "design.json", "summary.json", "public-contexts.json", "service-manifest.json")]
    sources += [fixtures, claim_path, complete_path, original, runner, Path(__file__), *logs]
    coverage = []
    native_records = {}
    for row in rows:
        path = source / f"{row['runId']}.json"
        native = read(path)
        if native["record"] != row:
            raise ValueError("Native record differs from the immutable outcome row")
        turns = [m for i, m in enumerate(native["simulation"]["messages"]) if i and m["role"] == "assistant"]
        reason = "base_arm_has_no_live_candidate_session" if row["arm"] == "base" else "no_recorded_actor_decision" if not turns else None
        coverage.append({"runId": row["runId"], "arm": row["arm"], "originalSuccess": row["success"],
                         "originalTermination": row["termination"], "replayed": reason is None, "exclusionReason": reason,
                         "recordedActorTurns": len(turns)})
        native_records[row["runId"]] = native
        sources.append(path)
    inputs = [file_record(path) for path in dict.fromkeys(sources)]
    method = {"schemaVersion": "native-execution-replay-v2-admitted-1", "finalSource": source_check,
              "sourceInputs": inputs, "sourceLogs": [str(p) for p in logs], "coverage": coverage,
              "serviceManifest": file_record(service_manifest_path),
              "admissionRule": "candidate_prediction.admission === true", "providerCalls": 0,
              "timingMeaning": "Fixed actor tape with fresh native reads; excludes model work and is not live trial latency",
              "methodChange": "Report-local v2 event reader excludes every unadmitted prediction; frozen native orchestration is reused unchanged"}
    # Disable native dependency dotenv loading in this strictly offline process.
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    spec = importlib.util.spec_from_file_location("frozen_native_replay", original)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    def launch(command, *args, **kwargs):
        if command[:4] != ["node", "--import", "tsx", "scripts/goalspec-native-execution-replay.ts"]:
            raise ValueError("Unexpected subprocess requested by frozen replay orchestration")
        config_path = Path(command[4])
        config = read(config_path)
        selected = {r["runId"] for r in coverage if r["replayed"]}
        if {r["runId"] for r in config["runs"]} != selected or config["sourceLogs"] != method["sourceLogs"]:
            raise ValueError("Frozen orchestration changed replay coverage or source logs")
        write(output / "replay-method-manifest.json", {**method, "replayInput": file_record(config_path)})
        return subprocess.Popen([*command[:3], str(runner), *command[4:]], *args, **kwargs)
    # Dependency injection is scoped to the imported module, not the global subprocess module.
    module.subprocess = SimpleNamespace(Popen=launch, TimeoutExpired=subprocess.TimeoutExpired)
    report = module.run(source, fixtures, logs, output)
    for item in inputs:
        if file_record(ROOT / item["path"]) != item:
            raise ValueError("A frozen replay input changed during execution")
    verify_final_source(freeze)
    reads = next(ast.literal_eval(n.value) for n in ast.parse((ROOT / "research/goalspec/src/goalspec/training_export.py").read_text(encoding="utf-8")).body
                 if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "READS" for t in n.targets))
    counts = []
    for row in report["runs"]:
        native = native_records[row["runId"]]
        messages = native["simulation"]["messages"]
        calls = {c["id"]: c for m in messages for c in m.get("tool_calls") or []}
        answered = {m["id"] for m in messages if m["role"] == "tool"}
        observed_reads = sum(calls[key]["name"] in reads[native["record"]["domain"]] for key in answered)
        if row["nativeCalls"] - row["consumptions"] != row["authoritativeCalls"] or row["consumptions"] > observed_reads:
            raise ValueError("Native replay read accounting mismatch")
        counts.append({**row, "physicalAuthoritativeReads": observed_reads - row["consumptions"],
                       "physicalReads": observed_reads - row["consumptions"] + row["speculativeCalls"]})
    write(output / "method-report.json", {"schemaVersion": method["schemaVersion"], "finalSourceTreeHash": FINAL_TREE,
          "coverage": coverage, "runs": counts, "sourceAudit": read(output / "candidate-source-audit.json"),
          "originalOutcomesUnchanged": True, "allReplayObservationsAndStatesMatch": True, "providerCalls": 0, "billedUsd": 0,
          "nativeLiveSuccessImprovementClaimed": False, "liveLatencyImprovementClaimed": False,
          "candidateAvailabilityInterpretation": "Originally admitted candidates are replayed at their numbered boundaries. Asynchronous live events do not establish availability before the original actor decision; the inherited frozen report label suggesting this is not applicable to v2.",
          "inputSourcesUnchanged": True, "finalProtectedExecutionUnchanged": True})
    return {"replayedRuns": len(counts), "declaredSourceTrials": len(rows), "providerCalls": 0, "allParityChecksPassed": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "fixtures", "freeze", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--logs", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.fixtures, args.logs, args.freeze, args.output)))
