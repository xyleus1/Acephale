"""Measure native reads through fresh pinned environments and the actual lease gateway.

This is component profiling, not an official task execution or an actor training
run. Only previously visible tool actions are replayed into an ephemeral database.
The proposed actions from the two newly measured actor calls are never executed.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import secrets
import subprocess
import threading
import time
from pathlib import Path

from acephale.adapters.step_gateway import StepBroker, server
from acephale.adapters.tau import PublicContext, _events
from acephale.contracts_v1 import hash_v1
from acephale.infra_data import _public_event, read_jsonl, verify_bundle
from acephale.infra_import_fresh import _inventory
from acephale.infra_native_runner import (
    NativeTauExecutor,
    validate_task_bundle,
    verify_runtime_identity,
    verify_sources,
)
from acephale.native_common import ROOT, observe_host_health, read, write
from acephale.schemas import ToolContract
from acephale.storage import file_hash

SCRIPT = "scripts/acephale-infra-native-profile.ts"


def public_prefix_messages(row: dict, messages: list[dict]) -> list[dict]:
    """Locate a whole native actor boundary without changing tool IDs or text.

    A prefix ending inside a message/call batch cannot be reproduced faithfully
    and is rejected. No later message or action enters the returned boundary.
    """
    context = PublicContext(policy=row["input"]["policy"], system_messages=(row["input"]["policy"],),
                            tools=tuple(ToolContract.model_validate(tool) for tool in row["input"]["tools"]))
    expected = row["input"]["events"]
    if row["input_hash"] != hash_v1(row["input"]) or row["through_seq"] != len(expected) - 1:
        raise ValueError("Public prefix identity mismatch")
    for end in range(len(messages) + 1):
        prefix = messages[:end]
        observed = [_public_event(event) for event in _events(prefix, context)]
        if len(observed) > len(expected):
            break
        if observed != expected:
            continue
        result = []
        pending: dict[str, dict] = {}
        for item in prefix:
            children = item.get("tool_messages", [item]) if item["role"] == "tool" else [item]
            for message in children:
                if message.get("requestor") == "user" or message["role"] == "user" and message.get("tool_calls"):
                    raise ValueError("Hidden user tools cannot be reconstructed by the native profiler")
                public = {key: copy.deepcopy(message[key]) for key in ("role", "content", "id", "tool_calls") if key in message}
                if public["role"] == "assistant":
                    for call in public.get("tool_calls") or []:
                        if call["id"] in pending:
                            raise ValueError("Duplicate native prefix call ID")
                        pending[call["id"]] = call
                elif public["role"] == "tool":
                    if public.get("id") not in pending:
                        raise ValueError("Native prefix tool result has no request")
                    pending.pop(public["id"])
                    public["error"] = message.get("error", False)
                result.append(public)
        if pending or not result or result[-1]["role"] not in {"user", "tool"}:
            raise ValueError("Prefix is not a complete native actor decision boundary")
        return result
    raise ValueError("Public checkpoint ends inside a native message or differs from its source")


def replay_public_tools(environment, messages: list[dict], make_call) -> list[dict]:
    """Replay completed prior actions, including mutations, only into private state."""
    pending, receipts = {}, []
    for message in messages:
        for call in message.get("tool_calls") or []:
            if call["id"] in pending:
                raise ValueError("Repeated prefix tool ID")
            pending[call["id"]] = call
        if message["role"] != "tool":
            continue
        call = pending.pop(message["id"])
        observed = environment.get_response(make_call(call))
        # Exact text and error matching detects drift, nondeterminism and skipped state.
        if observed.content != message.get("content") or observed.error != message.get("error", False):
            raise ValueError("Native prefix replay diverged from its public recorded observation")
        receipts.append({"callId": call["id"], "invocationHash": hash_v1({"tool": call["name"], "arguments": call["arguments"]}),
                         "observationHash": hash_v1({"content": observed.content, "error": observed.error})})
    if pending:
        raise ValueError("Unresolved native prefix calls")
    return receipts


class PrefixFactory:
    def __init__(self, cohort: Path, dataset: Path, upstream: Path):
        receipt, inventory = _inventory(cohort)
        self.cohort, self.inventory = cohort, inventory
        self.dataset = verify_bundle(dataset)
        self.lineage = read(dataset / "lineage.json")
        if (self.lineage.get("fresh_qwen_traces") is not True
                or self.lineage["cohort_receipt_hash"] != hash_v1(receipt)
                or self.lineage["cohort_receipt_sha256"] != file_hash(cohort / "cohort-receipt.json")
                or self.lineage["cohort_files"] != inventory):
            raise ValueError("Profile dataset does not derive from this closed native collection")
        configuration, manifest, bundle = [read(cohort / name) for name in ("configuration.json", "manifest.json", "tasks.json")]
        self.tasks = validate_task_bundle(configuration, manifest, bundle)
        self.runs = {run["runId"]: run for run in configuration["runs"]}
        self.executor = NativeTauExecutor(configuration, self.tasks, upstream)

    def build(self, row: dict):
        from tau2.data_model.message import ToolCall
        from tau2.data_model.tasks import Task

        from acephale.adapters.tau_snapshot import NativeSnapshotEnvironment

        run = self.runs[row["episode_id"]]
        if row["split"] not in {"train", "development"} or run["familyId"] != row["family_id"] or run["domain"] != row["domain"]:
            raise ValueError("Native profile family/domain mismatch or heldout prefix")
        raw_path = self.cohort / f"{run['runId']}.json"
        if file_hash(raw_path) != self.inventory[raw_path.name]:
            raise ValueError("Native source changed before reconstruction")
        raw = read(raw_path)
        messages = public_prefix_messages(row, raw["simulation"]["messages"])
        original = self.executor.registry.get_env_constructor(run["domain"])(solo_mode=False)
        task = Task.model_validate(self.tasks[run["domain"], run["taskId"]]["task"])
        initial = task.initial_state
        # Recreate native initialization, then replay each visible action exactly once.
        # Original task definitions remain in Python and never enter model inputs.
        original.set_state(initialization_data=initial.initialization_data if initial else None,
                           initialization_actions=initial.initialization_actions if initial else None, message_history=[])
        replay = replay_public_tools(original, messages, ToolCall.model_validate)
        environment = NativeSnapshotEnvironment(original, projection_snapshots=True)
        context = self.executor.contexts[run["runId"]]
        boundary = {"policy": context["policy"], "tools": context["tools"], "messages": messages}
        if row["input"]["policy"] != boundary["policy"] or row["runtime_tool_schema_hash"] != hash_v1(boundary["tools"]):
            raise ValueError("Native context/schema changed during reconstruction")
        proof = {"version": 1, "checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"],
                 "verifiedPublicPrefix": True, "sourceRunSha256": file_hash(raw_path), "boundary": boundary,
                 "boundaryHash": hash_v1(boundary), "replayedCalls": replay,
                 "stateHash": environment.get_db_hash(), "initialTaskHash": hash_v1(task.model_dump(mode="json"))}
        return environment, proof


class ObservedReads:
    """Retain Python operation clocks as evidence, without exporting private state."""
    def __init__(self, environment):
        self.environment, self.events = environment, []
        self.clock_id = f"python-native-profile:{os.getpid()}:{secrets.token_hex(12)}"
        self.condition, self.active = threading.Condition(), 0

    def _call(self, operation, *arguments):
        with self.condition:
            self.active += 1
        start = time.perf_counter() * 1000
        event = {"operation": operation, "clockId": self.clock_id, "startMs": start,
                 "tool": arguments[0] if operation == "read" else arguments[1]}
        try:
            result = getattr(self.environment, operation)(*arguments)
            event.update(status="completed", observationHash=hash_v1(result["observation"]))
            return result
        except Exception as error:
            event.update(status="failed", errorType=type(error).__name__)
            raise
        finally:
            event["endMs"] = time.perf_counter() * 1000
            with self.condition:
                self.events.append(event)
                self.active -= 1
                self.condition.notify_all()

    def read(self, tool, arguments):
        return self._call("read", tool, arguments)

    def refresh(self, lease, tool, arguments):
        return self._call("refresh", lease, tool, arguments)

    def drain(self, timeout=180):
        with self.condition:
            if not self.condition.wait_for(lambda: self.active == 0, timeout):
                raise TimeoutError("Native snapshot operation still running")


def _node(mode: str, configuration: Path, output: Path, *extra: str):
    return ["node", "--import", "tsx", SCRIPT, mode, str(configuration), str(output), *extra]


def cleanup_native_profile(*, process=None, broker=None, gateway=None, native_thread=None, observed=None, timeout=10):
    """Confirm physical cleanup, retaining uncertainty instead of losing evidence."""
    failures = []
    if process is not None and process.poll() is None:
        process.kill()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            failures.append("worker_drain_unconfirmed")
    if broker:
        broker.close()
    if gateway:
        def close_server():
            try:
                if native_thread and native_thread.is_alive():
                    gateway.shutdown()
                # server_close waits for admitted HTTP handler threads. A timed
                # out close remains unresolved, even if active is momentarily zero.
                gateway.server_close()
            except Exception:
                failures.append("gateway_close_failed")
        closer = threading.Thread(target=close_server, daemon=True)
        closer.start()
        closer.join(timeout)
        if closer.is_alive():
            failures.append("gateway_requests_drain_unconfirmed")
        if native_thread:
            native_thread.join(timeout)
            if native_thread.is_alive():
                failures.append("gateway_listener_close_unconfirmed")
    if observed:
        try:
            observed.drain(timeout=timeout)
        except Exception:
            failures.append("native_operations_drain_unconfirmed")
    return failures


def run_profile(configuration: Path, output: Path, upstream: Path):
    configuration, output = configuration.resolve(), output.resolve()
    config = read(configuration)
    def path(field):
        return (configuration.parent / config[field]).resolve()
    manifest = read(path("manifestPath"))
    verify_sources(manifest, upstream)
    verify_runtime_identity(manifest)
    # This offline preparation verifies the existing original journal without reserving or spending.
    subprocess.run(_node("prepare", configuration, output), cwd=ROOT, check=True, capture_output=True, text=True)
    plan = read(output / "profile-plan.json")
    factory, public, setup_failure = None, {}, None
    try:
        public = {row["checkpoint_id"]: row for row in read_jsonl(path("datasetPath") / "public.jsonl")}
        factory = PrefixFactory(path("cohortPath"), path("datasetPath"), upstream)
        if factory.dataset["bundle_hash"] != plan["sourceDatasetHash"]:
            raise ValueError("Native dataset changed after declaration")
    except Exception as error:
        setup_failure = f"{type(error).__name__}: {error}"
    started = time.monotonic()
    rows, unresolved_cleanup = [], []
    for declared in plan["rows"]:
        ordinal, key = declared["ordinal"], declared["checkpoint_id"]
        identity = {name: declared[name] for name in ("checkpoint_id", "input_hash", "family_id", "split")}
        observed, gateway, broker, native_thread, process = None, None, None, None, None
        raw = {"kind": "observed_infra_timing", **identity, "spans": {}, "status": "failed", "errorType": "not_dispatched"}
        samples = []
        try:
            if setup_failure:
                raise RuntimeError(f"Native profile setup failed: {setup_failure}")
            if unresolved_cleanup:
                raise RuntimeError("Previous native profile work has unconfirmed physical drain")
            remaining = config["maximumLifetimeSeconds"] - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError("Native profile global deadline exhausted")
            samples.append(observe_host_health("before_native_profile"))
            if not samples[-1]["healthy"]:
                raise RuntimeError("Research host guard unavailable before profile dispatch")
            environment, proof = factory.build(public[key])
            write(output / f"prefix-{ordinal}.json", proof)
            observed, broker, token = ObservedReads(environment), StepBroker(), secrets.token_hex(32)
            gateway = server(broker, token, reads={key: observed})
            native_thread = threading.Thread(target=gateway.serve_forever, daemon=True)
            native_thread.start()
            env = {**os.environ, "ACEPHALE_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}",
                   "ACEPHALE_GATEWAY_TOKEN": token, "ACEPHALE_PROFILE_REMAINING_MS": str(max(1, int(remaining * 1000)))}
            with (output / f"node-{ordinal}.log").open("x", encoding="utf-8") as stream:
                process = subprocess.Popen(_node("measure", configuration, output, str(ordinal)), cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT)
                # Abort controls live in Node. The extra interval permits reconciliation/drain.
                drain_deadline = time.monotonic() + min(remaining, 180) + 185
                while process.poll() is None:
                    if time.monotonic() > drain_deadline:
                        raise TimeoutError("Native measurement worker exceeded its drain deadline")
                    sample = observe_host_health("during_native_profile")
                    samples.append(sample)
                    if not sample["healthy"]:
                        raise RuntimeError("Research host guard degraded during native profile")
                    try:
                        process.wait(timeout=0.5)
                    except subprocess.TimeoutExpired:
                        pass
            observed.drain()
            if process.returncode != 0:
                raise RuntimeError("Native measurement worker did not close successfully")
            raw = {**read(output / f"node-measurement-{ordinal}.json"), **identity}
            raw["prefixEvidence"] = {"path": f"prefix-{ordinal}.json", "sha256": file_hash(output / f"prefix-{ordinal}.json")}
            if raw["status"] == "completed" and [event["operation"] for event in observed.events if event["status"] == "completed"] != ["read", "refresh"]:
                raise ValueError("Completed native measurement lacks one actual read and freshness refresh")
            samples.append(observe_host_health("after_native_profile"))
            if not samples[-1]["healthy"]:
                raise RuntimeError("Research host guard degraded during native profile")
        except Exception as error:
            raw.update(status="failed", errorType=type(error).__name__, error=str(error))
        finally:
            if process is not None and process.poll() is None:
                raw.update(status="failed", errorType="worker_interrupted_during_drain")
            cleanup = cleanup_native_profile(process=process, broker=broker, gateway=gateway, native_thread=native_thread, observed=observed)
            if cleanup:
                unresolved_cleanup.extend(cleanup)
                raw.update(status="failed", errorType="physical_drain_unconfirmed", cleanupFailures=cleanup)
            if observed:
                raw["nativeGatewayOperations"] = observed.events
                raw["nativeOperationsDrained"] = not cleanup and observed.active == 0
            raw["hostHealth"] = samples
        name = f"measurement-{ordinal:04d}.json"
        raw["profileHash"] = hash_v1(plan["profile"])
        write(output / name, raw)
        rows.append({**identity, "profileHash": raw["profileHash"], "status": raw["status"], **({"spans": raw["spans"]} if raw["status"] == "completed" else {"errorType": raw["errorType"]}),
                     "evidence": {"path": name, "sha256": file_hash(output / name)}})
    closed = not unresolved_cleanup
    body = {"version": 2, "kind": "measured_infra_opportunity" if closed else "incomplete_native_profile", "sourceDatasetHash": plan["sourceDatasetHash"], "profile": plan["profile"],
            "protocol": plan["protocol"], "profilePlanHash": plan["contentHash"], "rowIds": plan["rowIds"], "rows": rows}
    write(output / ("measurements.json" if closed else "incomplete-measurements.json"), {**body, "contentHash": hash_v1(body)})
    complete = sum(row["status"] == "completed" for row in rows)
    receipt = {"declared": len(rows), "completed": complete, "failed": len(rows) - complete,
               "closed": closed, "cleanupFailures": unresolved_cleanup,
               "readyForAggregation": closed and complete >= 10, "actorWeightsUpdated": False, "benchmarkClaim": False}
    write(output / "receipt.json", receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--upstream-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run_profile(args.config, args.output, args.upstream_root)))


if __name__ == "__main__":
    main()
