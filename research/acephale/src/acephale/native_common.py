"""Native benchmark lifecycle, strict accounting and immutable control artifacts.

Upstream simulation and evaluation stay in the pinned Python environment. These
helpers do not implement an actor or own provider credentials or budget writes.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import time
from collections import Counter
from pathlib import Path
from types import FunctionType, MethodType

from acephale.contracts_v1 import hash_v1

ROOT = Path(__file__).resolve().parents[4]
REVISION = "2174a603f6d014ef94473ffa95957f6ce27100db"
MODELS = {"teacher": "gpt-5.4-2026-03-05", "user": "gpt-4.1-mini-2025-04-14"}

READS = {
    "retail": frozenset(
        {
            "find_user_id_by_name_zip",
            "find_user_id_by_email",
            "get_order_details",
            "get_product_details",
            "get_item_details",
            "get_user_details",
            "list_all_product_types",
        }
    ),
    "airline": frozenset(
        {
            "get_reservation_details",
            "get_user_details",
            "list_all_airports",
            "search_direct_flight",
            "search_onestop_flight",
            "get_flight_status",
        }
    ),
}


def read(path: Path):
    return json.loads(path.read_bytes())


def write(path: Path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def summarize_costs(outcomes):
    unknown = sum(
        row.get("unknownProviderCharge", False) or row["billedUsd"] is None for row in outcomes
    )
    known = round(
        sum(row.get("knownUsageSubtotalUsd", row["billedUsd"] or 0) for row in outcomes), 6
    )
    return {
        "billedUsd": None if unknown else round(sum(row["billedUsd"] for row in outcomes), 6),
        "knownUsageSubtotalUsd": known,
        "unknownCharges": unknown,
    }


def drain_trial(broker, run_id, started, native_seconds, clock=time.perf_counter):
    """Include both managed workers' acknowledged drain without altering native latency."""
    drain_started = clock()
    errors = []
    for worker_id in (run_id, run_id + ":user"):
        try:
            broker.finish(worker_id)
        except Exception as error:
            errors.append({"workerId": worker_id, "exceptionType": type(error).__name__})
    stopped = clock()
    return {
        "nativeOrchestrationSeconds": native_seconds,
        "serviceDrainSeconds": stopped - drain_started,
        "totalTrialSeconds": stopped - started,
        "serviceDrainSucceeded": not errors,
        "serviceDrainErrors": errors,
    }


def observe_host_health(phase, *, status_path=None, now_ms=None):
    """Mirror the provider heartbeat validity checks without changing thresholds.

    Native local studies require a configured guard. A broken newest immutable
    publication never falls back to an older healthy heartbeat.
    """
    now = time.time() * 1000 if now_ms is None else now_ms
    sample = {"phase": phase, "checkedAtUnixMs": now, "healthy": False}
    path = status_path if status_path is not None else os.environ.get("ACEPHALE_HOST_STATUS_FILE")
    if not path:
        return {**sample, "reason": "host_guard_not_configured"}
    try:
        latest, sequence = Path(path), None
        if latest.is_dir():
            names = sorted(
                item.name
                for item in latest.iterdir()
                if re.fullmatch(r"[0-9]{16}\.json", item.name)
            )
            if not names:
                raise ValueError("No heartbeat")
            latest = latest / names[-1]
            sequence = int(names[-1][:16])
        raw = latest.read_bytes()
        sample.update(
            {"publication": latest.name, "publicationSha256": hashlib.sha256(raw).hexdigest()}
        )
        status = json.loads(raw)
        if (
            not isinstance(status, dict)
            or sequence is not None
            and (
                not 1 <= sequence <= 9007199254740991
                or type(status.get("heartbeatSequence")) not in (int, float)
                or status.get("heartbeatSequence") != sequence
            )
        ):
            raise ValueError("Invalid heartbeat sequence")

        def numeric(value):
            return type(value) in (int, float) and math.isfinite(value) and value > 0

        if (
            status.get("healthy") is not True
            or status.get("networkConnected") is not True
            or not numeric(status.get("observedAtUnixMs"))
            or not numeric(status.get("maxStatusAgeMs"))
        ):
            return {**sample, "reason": "invalid_or_degraded_host_status"}
        age, limit = now - status["observedAtUnixMs"], min(status["maxStatusAgeMs"], 3000)
        sample.update(
            {
                "heartbeatSequence": status.get("heartbeatSequence"),
                "observedAtUnixMs": status["observedAtUnixMs"],
                "ageMs": age,
                "maxStatusAgeMs": limit,
            }
        )
        if status.get("state") != "healthy" or age < -1000 or age > limit:
            return {**sample, "reason": "degraded_or_stale_heartbeat"}
        return {**sample, "healthy": True, "reason": None}
    except Exception as error:
        return {**sample, "reason": "host_status_unavailable", "errorType": type(error).__name__}


def apply_host_health(row, samples):
    """Retain raw clocks and native verdict; interrupt the measured-study row."""
    row["hostHealthSamples"] = samples
    row["hostInterrupted"] = any(sample["healthy"] is not True for sample in samples)
    row["successWithoutHostGuard"] = row.get("success", False)
    phases = {sample["phase"] for sample in samples}
    row["measuredTimingValid"] = not row["hostInterrupted"] and {
        "before_native",
        "after_actor_user_drain",
        "after_trial",
    }.issubset(phases)
    if row["hostInterrupted"]:
        row["terminationBeforeHostGuard"] = row.get("termination")
        row["success"], row["termination"] = False, "host_interruption"


def await_service_ready(broker, process):
    """A failed startup is terminated once, before any trial drain is attempted."""
    try:
        return broker.wait_ready(timeout=600), None
    except Exception as error:
        failure = type(error).__name__
        broker.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=15)
        return None, failure


def close_failed_workers(broker, run_id, *, custom, ready_at):
    # Never enqueue close requests for workers that have not acknowledged ready.
    if ready_at is None:
        return
    for worker in (run_id, run_id + ":user", *(() if custom else (run_id + ":evaluator",))):
        try:
            broker.finish(worker)
        except Exception:
            pass


class ServiceTelemetry:
    """Read only new bytes from this service's exclusively owned event log."""

    def __init__(self, directory, manifest_hash):
        self.directory, self.manifest_hash = Path(directory), manifest_hash
        self.before = {path.name for path in self.directory.glob("events-*.jsonl")}
        self.path = self.identity = None
        self.offset, self.sequence, self.previous = 0, 0, "0" * 64
        self.pending, self.runs, self.manifest_seen, self.failure = b"", {}, False, None

    def bind(self, pid):
        if self.path is not None:
            raise ValueError("Service telemetry already bound")
        lock = read(self.directory / "budget.jsonl.lock")
        added = [
            path for path in self.directory.glob("events-*.jsonl") if path.name not in self.before
        ]
        if lock.get("pid") != pid or len(added) != 1:
            raise ValueError("Service event log does not have one exclusive spending owner")
        self.path = added[0]
        stat = self.path.stat()
        self.identity = (stat.st_dev, stat.st_ino)
        self._read()
        if not self.manifest_seen:
            raise ValueError("Service event log has no matching research manifest")

    def _read(self):
        stat = self.path.stat()
        if (stat.st_dev, stat.st_ino) != self.identity or stat.st_size < self.offset:
            raise ValueError("Active service event log was replaced or truncated")
        with self.path.open("rb") as stream:
            stream.seek(self.offset)
            while True:
                block = stream.read(65536)
                if not block:
                    break
                self.offset += len(block)
                self.pending += block
                while b"\n" in self.pending:
                    line, self.pending = self.pending.split(b"\n", 1)
                    record = json.loads(line)
                    body = record["body"]
                    if (
                        body["sequence"] != self.sequence
                        or body["previousHash"] != self.previous
                        or hash_v1(body) != record["hash"]
                    ):
                        raise ValueError("Active service event chain changed")
                    self.sequence += 1
                    self.previous = record["hash"]
                    event = body["event"]
                    if event.get("type") == "research_manifest":
                        if self.manifest_seen or event.get("manifestHash") != self.manifest_hash:
                            raise ValueError("Service telemetry manifest mismatch")
                        self.manifest_seen = True
                    if "event" in event and "runId" in event:
                        event = {**event["event"], "runId": event["runId"]}
                    run = event.get("runId")
                    if not run:
                        continue
                    totals = self.runs.setdefault(
                        run,
                        {
                            "knownMicrodollars": 0,
                            "providerCalls": 0,
                            "unknown": False,
                            "rejectedCalls": 0,
                            "cancelledCalls": 0,
                        },
                    )
                    kind = event.get("type")
                    if kind in {"model_attempt", "embedding"}:
                        totals["knownMicrodollars"] += event.get("costMicrodollars", 0)
                        totals["providerCalls"] += 1
                    totals["unknown"] |= kind in {"model_attempt_failed", "embedding_failed"}
                    totals["rejectedCalls"] += kind == "rejected"
                    totals["cancelledCalls"] += kind == "cancellation_confirmed"
                if len(self.pending) > 8 * 1024 * 1024:
                    raise ValueError("Service event row exceeds telemetry bound")

    def summary(self, run_id, managed_work_drained):
        if self.path is not None and self.failure is None:
            try:
                self._read()
            except Exception as error:
                self.failure = type(error).__name__
        totals = self.runs.get(run_id, {})
        known = round(totals.get("knownMicrodollars", 0) / 1_000_000, 6)
        unknown = (
            totals.get("unknown", False)
            or not managed_work_drained
            or not self.manifest_seen
            or self.failure is not None
        )
        return {
            "billedUsd": None if unknown else known,
            "knownUsageSubtotalUsd": known,
            "providerCalls": totals.get("providerCalls", 0),
            "unknownProviderCharge": bool(unknown),
            "rejectedCalls": totals.get("rejectedCalls", 0),
            "cancelledCalls": totals.get("cancelledCalls", 0),
            **({"telemetryIntegrityError": self.failure} if self.failure else {}),
            **(
                {"costCensoringReason": "managed_work_drain_or_service_log_unavailable"}
                if unknown and not managed_work_drained
                else {}
            ),
        }


def assess_official_reward(task, reward):
    """Preserve upstream reward while rejecting an incomplete required judge."""
    criteria = task.evaluation_criteria
    expected = criteria.nl_assertions or [] if criteria else []
    assertions = reward.nl_assertions or [] if reward else []
    coverage = Counter(item.nl_assertion for item in assertions) == Counter(expected)
    required = criteria is not None and "NL_ASSERTION" in criteria.reward_basis
    valid = not required or coverage
    return {
        "passed": bool(reward is not None and reward.reward == 1 and valid),
        "officialReward": reward.reward if reward is not None else None,
        "constraintViolations": sum(not item.met for item in assertions) if assertions else None,
        "judgeAssertionCoverage": coverage,
        "requiredJudgeAssertionCoverage": coverage if required else None,
        "evaluationValid": valid,
        "evaluationErrorType": None if valid else "IncompleteRequiredNLAssertions",
    }


def clone_with_globals(function, replacements):
    """Preserve native bytecode while replacing only its scoped dependency ports."""
    result = FunctionType(
        function.__code__,
        {**function.__globals__, **replacements},
        function.__name__,
        function.__defaults__,
        function.__closure__,
    )
    result.__kwdefaults__ = function.__kwdefaults__
    return result


def api_actor_instruction(native):
    old = "Always make sure you generate valid JSON only."
    if native.count(old) != 1:
        raise ValueError("Upstream actor protocol instruction changed; repeat audit")
    return native.replace(
        old,
        "Use the API's function tool calls for actions. For a message turn, write ordinary text for the user, without a JSON envelope.",
    )


def model_port(broker, worker_id, *, evaluator=False):
    def generate(*, model, messages, tools=None, call_name=None, **kwargs):
        from tau2.data_model.message import AssistantMessage

        if tools is not None and tools != []:
            raise ValueError("Official retail/airline user and evaluator must have no tools")
        if (
            not messages
            or messages[0].role != "system"
            or any(message.role == "system" for message in messages[1:])
        ):
            raise ValueError("Unexpected native model prompt structure")
        response = broker.exchange(
            worker_id,
            {
                "policy": messages[0].content,
                "messages": [
                    {"role": message.role, "content": message.content or ""}
                    for message in messages[1:]
                ],
                "tools": [],
            },
        )
        expected = "assistant" if evaluator else "user"
        if response.get("role") != expected or response.get("tool_calls"):
            raise ValueError("Unexpected native model-port response")
        # Costs are owned by the Node ledger; native serialization must not invent them.
        return AssistantMessage(role="assistant", content=response.get("content"), cost=0.0)

    return generate


def native_ports(broker, run_id, task, models):
    """Keep upstream state transitions, prompt text, JSON parser and reward combination."""
    from tau2.evaluator.evaluator import evaluate_simulation
    from tau2.evaluator.evaluator_nl_assertions import NLAssertionsEvaluator
    from tau2.user.user_simulator import UserSimulator

    user = UserSimulator(
        llm=models["user"],
        instructions=str(task.user_scenario),
        tools=None,
        llm_args={"temperature": 0.0},
    )
    user._generate_next_message = MethodType(
        clone_with_globals(
            UserSimulator._generate_next_message, {"generate": model_port(broker, run_id + ":user")}
        ),
        user,
    )
    judge_function = clone_with_globals(
        NLAssertionsEvaluator.evaluate_nl_assertions.__func__,
        {
            "generate": model_port(broker, run_id + ":evaluator", evaluator=True),
            "DEFAULT_LLM_NL_ASSERTIONS": models["teacher"],
        },
    )
    local_judge = type(
        "BudgetedNativeNLAssertionsEvaluator",
        (NLAssertionsEvaluator,),
        {"evaluate_nl_assertions": classmethod(judge_function)},
    )
    evaluate = clone_with_globals(evaluate_simulation, {"NLAssertionsEvaluator": local_judge})
    return user, evaluate
