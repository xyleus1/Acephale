"""Execute recorded live predictions against fresh native states, without models."""
# ruff: noqa: E402
import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from tau2.data_model.message import AssistantMessage, ToolCall

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.adapters.tau_snapshot import ALLOWED, NativeSnapshotEnvironment
from goalspec.fresh_tasks import native_environment


class ReplayEnvironment(NativeSnapshotEnvironment):
    def __init__(self, original):
        super().__init__(original)
        self.authoritative_calls = 0
        self.speculative_calls = 0
        self.freshness_checks = 0

    def use_tool(self, tool_name, **kwargs):
        self.authoritative_calls += 1
        return super().use_tool(tool_name, **kwargs)

    def read(self, tool, arguments):
        self.speculative_calls += 1
        return super().read(tool, arguments)

    def refresh(self, lease, tool, arguments):
        self.freshness_checks += 1
        return super().refresh(lease, tool, arguments)

    def validate(self, lease, tool, arguments):
        self.freshness_checks += 1
        return super().validate(lease, tool, arguments)


def write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def run(source, fixtures, source_logs, output):
    tasks = {task["taskId"]: task for task in json.loads(fixtures.read_text(encoding="utf-8"))["tasks"]}
    outcomes = [json.loads(line) for line in (source / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]
    contexts = json.loads((source / "public-contexts.json").read_text(encoding="utf-8"))
    if not (source / "summary.json").exists():
        raise ValueError("Freeze a completed live phase before execution replay")
    # Run scopes come only from already recorded pre-actor frames, not generated
    # from actor arguments or private evaluator data.
    scopes = {}
    for path in source_logs:
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                wrapper = json.loads(line)["body"]["event"]
                event = wrapper.get("event", wrapper)
                if event.get("type") == "execution_frame":
                    scopes[wrapper.get("runId", event["frame"]["runId"])] = event["frame"]["scope"]
    output.mkdir(parents=True, exist_ok=False)
    broker, reads, runs, cases = StepBroker(), {}, [], []
    for row in outcomes:
        if row["arm"] == "base":
            continue
        artifact = json.loads((source / f"{row['runId']}.json").read_text(encoding="utf-8"))
        messages = artifact["simulation"]["messages"]
        turns = [message for index, message in enumerate(messages) if message["role"] == "assistant" and index != 0]
        if not turns:
            continue
        if row["runId"] not in scopes:
            raise ValueError("Missing frozen execution frame")
        environment = ReplayEnvironment(native_environment(tasks[row["taskId"]]))
        reads[row["runId"]] = environment
        runs.append({"runId": row["runId"], "scope": scopes[row["runId"]], "reads": sorted(ALLOWED[row["domain"]]), "turns": turns})
        cases.append((row, artifact, environment))
    if not runs:
        raise ValueError("No completed speculative-arm actor decisions to replay")
    write(output / "replay-input.json", {"runs": runs, "sourceLogs": [str(path.resolve()) for path in source_logs]})
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads=reads)
    threading.Thread(target=gateway.serve_forever, daemon=True).start()
    reports = []
    with (output / "service.log").open("x", encoding="utf-8") as log:
        process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-native-execution-replay.ts", str((output / "replay-input.json").resolve()), str(output.resolve())], cwd=ROOT,
                                   env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token}, stdout=log, stderr=log)
        def monitor():
            if process.wait() != 0:
                broker.close()
        threading.Thread(target=monitor, daemon=True).start()
        try:
            for row, artifact, environment in cases:
                started = time.perf_counter()
                messages = artifact["simulation"]["messages"]
                observed = {message["id"]: message for message in messages if message["role"] == "tool"}
                public_history = []
                native_calls = 0
                for index, message in enumerate(messages):
                    if index == 0 or message["role"] == "tool":
                        continue
                    if message["role"] == "user":
                        public_history.append(message)
                        continue
                    response = broker.exchange(row["runId"], {"messages": public_history, "policy": contexts[row["runId"]]["policy"], "tools": contexts[row["runId"]]["tools"]})
                    leases = response.pop("_goalspecPromotions", {})
                    actor = AssistantMessage.model_validate(response)
                    if actor.tool_calls != AssistantMessage.model_validate(message).tool_calls:
                        raise ValueError("Recorded authoritative actions changed")
                    environment.stage(actor, leases)
                    public_history.append(message)
                    for call in actor.tool_calls or []:
                        if call.id not in observed:
                            # A native step cap may leave an emitted call unexecuted.
                            continue
                        result = environment.get_response(ToolCall.model_validate(call))
                        native_calls += 1
                        expected = observed[call.id]
                        if (result.content, result.error) != (expected["content"], expected.get("error", False)):
                            raise ValueError(f"Native observation parity failed for {row['runId']}")
                        public_history.append(result.model_dump(mode="json"))
                final = environment.tools.db.model_dump(mode="json")
                if final != artifact["finalDatabase"]:
                    raise ValueError(f"Native state parity failed for {row['runId']}")
                reports.append({"runId": row["runId"], "arm": row["arm"], "nativeCalls": native_calls,
                                "consumptions": sum(event["status"] == "consumed" for event in environment.promotion_events),
                                "replayLatencyMs": (time.perf_counter() - started) * 1000, "observationParity": True, "stateParity": True,
                                "originalSuccess": row["success"], "originalTermination": row["termination"]})
        finally:
            broker.close()
            try:
                process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=10)
            gateway.shutdown()
            gateway.server_close()
    if process.returncode:
        raise ValueError("Node replay did not complete")
    # Count after draining all managed jobs, including unused final-boundary reads.
    for row in reports:
        environment = reads[row["runId"]]
        row.update({"authoritativeCalls": environment.authoritative_calls, "speculativeCalls": environment.speculative_calls,
                    "usefulCalls": row["consumptions"], "wastedCalls": max(0, environment.speculative_calls - row["consumptions"]),
                    "freshnessChecks": environment.freshness_checks, "revalidationCalls": 0})
    report = {"label": "Native execution replay of frozen live predictions, separate from live timing", "providerCalls": 0, "billedUsd": 0,
              "predictionSource": "candidate_prediction records captured before original actor decisions; no oracle arguments",
              "sourceOutcomeHash": hashlib.sha256((source / "outcomes.jsonl").read_bytes()).hexdigest(), "runs": reports,
              "scheduler": json.loads((output / "scheduler-summary.json").read_text(encoding="utf-8"))}
    write(output / "report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--logs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.source, args.fixtures, args.logs, args.output)
    print(json.dumps({"runs": len(report["runs"]), "consumptions": sum(row["consumptions"] for row in report["runs"]), "providerCalls": 0}))
