"""Training-only native component calibration, isolated projection versus full DB."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["TAU2_DATA_DIR"] = str(ROOT / "research/goalspec/.benchmarks/tau3/data")
import dotenv  # noqa: E402
dotenv.load_dotenv = lambda *args, **kwargs: False
from tau2.data_model.message import ToolCall  # noqa: E402
from goalspec.adapters.tau_snapshot import ALLOWED, PURE, NativeSnapshotEnvironment  # noqa: E402
from goalspec.adapters.step_gateway import StepBroker, server  # noqa: E402
from goalspec.contracts_v1 import hash_v1  # noqa: E402
from goalspec.fresh_tasks import native_environment  # noqa: E402
from goalspec.report_v3 import distribution  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def measured(callback):
    start = time.perf_counter_ns()
    result = callback()
    return result, (time.perf_counter_ns() - start) / 1e6


def main(args):
    output = args.output.resolve()
    if output.exists():
        raise ValueError("New profile output directory required")
    source_hashes = {}
    def track(path):
        path = Path(path).resolve()
        source_hashes[str(path)] = sha(path)
        return path
    pipeline = read(track(args.pipeline))
    if pipeline["contentHash"] != hash_v1({key: value for key, value in pipeline.items() if key != "contentHash"}):
        raise ValueError("Pipeline content hash mismatch")
    for item in pipeline["inputs"]:
        if sha(track(item["path"])) != item["sha256"]:
            raise ValueError("Frozen pipeline input changed")
    directory = Path(pipeline["cohort"]["directory"])
    fixture_path = track(pipeline["cohort"]["fixtureManifest"]["path"])
    fixtures = read(fixture_path)
    if fixtures["studyStage"] != "training" or fixtures["generator"] != "fresh-native-v5":
        raise ValueError("Only fresh v5 training fixtures allowed")
    fixture_by_id = {row["taskId"]: row for row in fixtures["tasks"]}
    outcomes = [json.loads(line) for line in track(directory / "outcomes.jsonl").read_text(encoding="utf-8").splitlines()]
    design = read(track(directory / "design.json"))
    summary = read(track(directory / "summary.json"))
    manifest = read(track(directory / "service-manifest.json"))
    contexts = read(track(directory / "public-contexts.json"))
    if len(outcomes) != 40 or len(design["trials"]) != 40 or summary["serviceExitCode"] != 0:
        raise ValueError("Whole training cohort closure required")
    controller = track(args.controller)
    cases, environments, selected_families = [], {}, []
    # The family split and variant select before reading any individual trace.
    selected = sorted([row for row in outcomes if pipeline["freshSplits"].get(row["family"]) == "train" and row["variant"] == 0],
        key=lambda row: (row["domain"], row["family"]))
    if len(selected) != 12 or any(row["family"] not in pipeline["allowedMemoryFamilies"] or row["arm"] != "base" for row in selected):
        raise ValueError("Expected twelve fitting families only")
    for row in selected:
        fixture = fixture_by_id[row["taskId"]]
        artifact = read(track(directory / f"{row['runId']}.json"))
        if artifact["record"] != row or fixture["familyId"] != row["family"]:
            raise ValueError("Training fixture lineage changed")
        messages = artifact["simulation"]["messages"]
        seen = set()
        selected_families.append(row["family"])
        for index, message in enumerate(messages):
            calls = message.get("tool_calls") or []
            if any(call["name"] not in ALLOWED[row["domain"]] | PURE[row["domain"]] for call in calls):
                break
            for call in calls:
                if call["name"] not in ALLOWED[row["domain"]] or call["name"] in seen:
                    continue
                seen.add(call["name"])
                identifier = f"profile-{len(cases):03d}"
                original = native_environment(fixture)
                observation = original.get_response(ToolCall(id="reference", name=call["name"], arguments=call["arguments"]))
                if observation.error:
                    raise ValueError("Selected public read returns error; retain failure instead of replacing")
                item = {"id": identifier, "runId": row["runId"], "familyId": row["family"], "domain": row["domain"],
                    "tool": call["name"], "arguments": call["arguments"], "prefix": messages[:index],
                    "policy": contexts[row["runId"]]["policy"], "tools": contexts[row["runId"]]["tools"],
                    "observation": {"content": observation.content, "error": observation.error}}
                cases.append(item)
                environments[identifier] = NativeSnapshotEnvironment(native_environment(fixture), projection_snapshots=True)
                if len(seen) == 3:
                    break
            if len(seen) == 3:
                break
    if not 15 <= len(cases) <= 36:
        raise ValueError("Expected bounded15-36 unique fitting-prefix read cases")
    # Capture all sources before measurement; no mutable runtime edits are made.
    for relative in ["outputs/goalspec-v5-tools/native_component_profile.py", "outputs/goalspec-v5-tools/native-component-profile.ts",
        "research/goalspec/src/goalspec/adapters/tau_snapshot.py", "research/goalspec/src/goalspec/adapters/step_gateway.py",
        "research/goalspec/src/goalspec/fresh_tasks.py", "research/goalspec/src/goalspec/fresh_tasks_v5.py",
        "services/goalspec-runtime/gateway-client.ts", "services/goalspec-runtime/native-read-policy.ts", "services/goalspec-runtime/native-candidate-graph.ts",
        "services/goalspec-runtime/actor.ts", "src/lib/goalspec/scheduler.ts", "src/lib/goalspec/controller-v5.ts",
        "src/lib/goalspec/controller-v5-features.ts", "src/lib/goalspec/obligation-ledger.ts", "scripts/goalspec-prediction-v3.ts"]:
        track(ROOT / relative)
    for relative in ["environment/environment.py", "domains/retail/tools.py", "domains/airline/tools.py"]:
        track(ROOT / "research/goalspec/.benchmarks/tau3/src/tau2" / relative)
    output.mkdir(parents=True)
    selection = [{key: item[key] for key in ("id", "runId", "familyId", "domain", "tool", "arguments")} | {"publicPrefixHash": hash_v1(item["prefix"])} for item in cases]
    plan = {"version": "goalspec-native-component-profile-v5", "selected": selection, "selectionHash": hash_v1(selection),
        "repetitions": 2, "warmupsPerCasePerPath": 1, "sources": source_hashes,
        "trainingFamiliesOnly": selected_families, "modelsChanged": False, "providerCalls": 0,
        "selection": "All twelve fitting families, variant0, first three distinct audited reads before any state-changing call. No success or expected-answer selection."}
    (output / "plan.json").write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    samples = []
    before_states = {identifier: env.get_db_hash() for identifier, env in environments.items()}
    for item in cases:
        fixture = fixture_by_id[next(row["taskId"] for row in selected if row["runId"] == item["runId"])]
        env, legacy = environments[item["id"]], NativeSnapshotEnvironment(native_environment(fixture), projection_snapshots=False)
        for repeat in range(-1, 2):
            message = ToolCall(id=f"profile-{repeat}", name=item["tool"], arguments=item["arguments"])
            direct, direct_ms = measured(lambda: env.get_response(message))
            receipt, read_ms = measured(lambda: env.read(item["tool"], item["arguments"]))
            refreshed, refresh_ms = measured(lambda: env.refresh(receipt["lease"], item["tool"], item["arguments"]))
            def promote():
                env.stage(SimpleNamespace(tool_calls=[message]), {message.id: refreshed["lease"]})
                return env.get_response(message)
            promoted, consume_ms = measured(promote)
            old, legacy_read_ms = measured(lambda: legacy.read(item["tool"], item["arguments"]))
            old_refresh, legacy_refresh_ms = measured(lambda: legacy.refresh(old["lease"], item["tool"], item["arguments"]))
            old_result, legacy_consume_ms = measured(lambda: legacy.consume(message, old_refresh["lease"]))
            expected = (direct.content, direct.error, direct.id)
            if (promoted.content, promoted.error, promoted.id) != expected or (old_result.content, old_result.error, old_result.id) != expected:
                raise ValueError("Projection/full snapshot observation or real-call identity parity failed")
            if env.get_db_hash() != before_states[item["id"]]:
                raise ValueError("Native read mutated authoritative state")
            if repeat >= 0:
                samples.append({"id": item["id"], "familyId": item["familyId"], "domain": item["domain"], "tool": item["tool"], "repeat": repeat,
                    "directReadMs": direct_ms, "projectionReadMs": read_ms, "projectionRefreshMs": refresh_ms, "projectionConsumeMs": consume_ms,
                    "legacyReadMs": legacy_read_ms, "legacyRefreshMs": legacy_refresh_ms, "legacyConsumeMs": legacy_consume_ms, "parity": True})
    (output / "native-samples.jsonl").write_text("".join(json.dumps(value) + "\n" for value in samples), encoding="utf-8")
    token, broker = secrets.token_hex(32), StepBroker()
    http = server(broker, token, reads=environments)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        payload = {"url": f"http://127.0.0.1:{http.server_port}", "token": token, "cases": cases, "controllerPath": str(controller),
            "snapshotId": manifest["snapshotId"], "allowed": {key: sorted(value) for key, value in ALLOWED.items()}, "repetitions": 2}
        result = subprocess.run(["node", "--import", "tsx", str(ROOT / "outputs/goalspec-v5-tools/native-component-profile.ts")],
            cwd=ROOT, input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True, timeout=90, check=False)
        if result.returncode:
            (output / "failure.json").write_text(json.dumps({"stage": "node_gateway", "exitCode": result.returncode,
                "stderr": result.stderr, "nativeSamplesRetained": len(samples), "providerCalls": 0}, indent=2) + "\n", encoding="utf-8")
            raise RuntimeError(result.stderr)
        node = json.loads(result.stdout)
    finally:
        broker.close(); http.shutdown(); http.server_close(); thread.join(timeout=5)
    for identifier, env in environments.items():
        if env.get_db_hash() != before_states[identifier] or env.reads.leases:
            raise ValueError("Gateway measurement mutated state or left unconsumed leases")
    for path, expected in source_hashes.items():
        if sha(path) != expected:
            raise ValueError("Measurement source changed")
    for name, values in [("native-samples.jsonl", samples), ("gateway-samples.jsonl", node["samples"])]:
        (output / name).write_text("".join(json.dumps(value) + "\n" for value in values), encoding="utf-8")
    native_times = {key: distribution([row[key] for row in samples]) for key in samples[0] if key.endswith("Ms")}
    node_times = {key: distribution([row[key] for row in node["samples"]]) for key in node["samples"][0] if key.endswith("Ms")}
    combined = [{**native, **gateway} for native, gateway in zip(samples, node["samples"], strict=True)]
    if any((a["id"], a["repeat"]) != (b["id"], b["repeat"]) for a, b in zip(samples, node["samples"], strict=True)):
        raise ValueError("Component sample pairing changed")
    eligible = [row for row in combined if row["policyEligible"]]
    if not eligible:
        raise ValueError("No policy-eligible measurements; no utility estimate available")
    validation = distribution([row["gatewayRefreshMs"] + row["projectionConsumeMs"] if row["policyEligible"] else None for row in combined])
    eligible_direct = distribution([row["directReadMs"] if row["policyEligible"] else None for row in combined])
    estimates = {"toolMs": eligible_direct["mean"], "validationMs": validation["mean"],
        "schedulingMs": node_times["schedulerOverheadMs"]["mean"], "predictionMs": node_times["localGraphControllerMs"]["mean"],
        "contentionMs": 0, "contextMs": node_times["literalContextMs"]["mean"], "measuredExposureBenefitMs": 0}
    upper_saving = estimates["toolMs"] - sum(estimates[key] for key in ("validationMs", "schedulingMs", "predictionMs", "contentionMs", "contextMs"))
    report = {**plan, "samplesPerPath": len(samples), "parityChecksPassed": True, "native": native_times, "node": node_times,
        "combinedValidation": validation, "pairedEligibleDirect": eligible_direct,
        "gatewayEligibility": {"selectedSamples": len(combined), "eligibleMeasured": len(eligible), "policyRejected": len(combined) - len(eligible), "replacements": 0},
        "recommendation": {"estimate": estimates, "probabilityOneSavingUpperBoundMs": upper_saving,
            "admissionStillNonpositive": upper_saving <= 0, "meanBasedComponentEstimateOnly": True,
            "contentionStatus": "Unmeasured production contention. Zero is an optimistic lower bound, not an estimate of loaded operation.",
            "exposureStatus": "No causal exposure/actor-round benefit was measured; keep zero credit.",
            "missingComponents": ["memory retrieval/binding", "remote prediction when enabled", "model/network cost of extra actor context", "loaded contention"]},
        "perTool": {tool: {"native": {key: distribution([row[key] for row in samples if row["tool"] == tool]) for key in native_times},
            "gateway": {key: distribution([row[key] for row in node["samples"] if row["tool"] == tool]) for key in node_times}}
            for tool in sorted({row["tool"] for row in samples})},
        "host": {"platform": platform.platform(), "python": sys.version.split()[0]},
        "limitations": ["Training-only fixed component workload; repeated measurements are not independent tasks or live task latency.",
            "No provider, model, policy, controller weight, benchmark score or runtime source was changed.",
            "Gateway measurements use actual Node NativeReadExecutor/policy and scheduler with forced matching reads solely to measure overhead, not predict usefulness.",
            "Authoritative reads can precede speculative ownership prerequisites. Those preselected gateway rows remain explicit policy rejections; recommendations use only paired eligible samples, without replacements.",
            "Python direct consumption is the real promotion path. Diagnostic /validate RPC adds an extra network trip and is not included in the recommended validationMs.",
            "Snapshot startup cost is separately reported and is not an avoided authoritative read; speculative waste and contention cannot make the optimistic saving bound larger.",
            "Actual controller pools come only from current public prefixes. Graph+controller latency excludes memory retrieval and remote inference.",
            "Context estimate includes literal ledger/render CPU only; common actor compilation is separately reported, and added actor/network work is unmeasured.",
            "Zero assigned exposure credit is a cold-start causal-data limitation, not proof that useful early evidence cannot save an actor round."]}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps({"version": plan["version"], "sources": source_hashes,
        "outputs": {path.name: sha(path) for path in output.iterdir()}, "immutable": True, "providerCalls": 0}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "samples": len(samples), "recommendation": report["recommendation"], "reportSha256": sha(output / "report.json")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pipeline", type=Path, required=True)
    parser.add_argument("--controller", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    main(parser.parse_args())
