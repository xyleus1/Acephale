"""Authenticated public-boundary queue. Private native state never enters frames."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import queue
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class Boundary:
    run_id: str
    boundary_id: str
    public: dict[str, Any] | None = None
    operation: str = "decision"
    response: queue.Queue = field(default_factory=lambda: queue.Queue(maxsize=1))


class StepBroker:
    def __init__(self, expected_manifest_hash: str | None = None, expected_experiment_manifest_hash: str | None = None):
        self.pending: queue.Queue[Boundary] = queue.Queue()
        self.active: dict[tuple[str, str], Boundary] = {}
        self.lock = threading.Lock()
        self.closed = False
        if expected_manifest_hash is not None and (len(expected_manifest_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_manifest_hash)):
            raise ValueError("Invalid readiness manifest hash")
        self.expected_manifest_hash = expected_manifest_hash
        if expected_experiment_manifest_hash is not None and (expected_manifest_hash is None
                or len(expected_experiment_manifest_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_experiment_manifest_hash)):
            raise ValueError("Invalid experiment readiness manifest hash")
        self.expected_experiment_manifest_hash = expected_experiment_manifest_hash
        self.ready = threading.Event()
        self.ready_at = None

    def mark_ready(self, manifest_hash: str, experiment_manifest_hash: str | None = None):
        """Accept readiness only for this process's authenticated immutable manifest."""
        with self.lock:
            if self.closed or self.expected_manifest_hash is None or manifest_hash != self.expected_manifest_hash \
                    or experiment_manifest_hash != self.expected_experiment_manifest_hash:
                raise ValueError("Unexpected service readiness manifest")
            if self.ready_at is None:
                self.ready_at = time.perf_counter()
                self.ready.set()
            return {"ready": True}

    def wait_ready(self, timeout: float = 180):
        """Return before trial timers start, or fail without creating a timed trial."""
        if self.expected_manifest_hash is None:
            raise ValueError("Service readiness was not configured")
        if not self.ready.wait(timeout):
            raise TimeoutError("Service readiness timeout")
        with self.lock:
            if self.closed or self.ready_at is None:
                raise RuntimeError("Service closed before readiness")
            return self.ready_at

    def exchange(self, run_id: str, public: dict[str, Any], timeout: float = 180):
        # Explicit public contract. Do not accept Task, Results, rewards or evaluator objects.
        if set(public) != {"messages", "policy", "tools"}:
            raise ValueError("Only public messages, policy and tools are permitted")
        boundary = Boundary(run_id, secrets.token_hex(16), copy.deepcopy(public))
        return self._exchange(boundary, timeout)

    def finish(self, run_id: str, timeout: float = 180):
        """Wait until the matching worker acknowledges physical managed-work drain."""
        response = self._exchange(Boundary(run_id, secrets.token_hex(16), operation="close"), timeout)
        if response != {"closed": True}:
            raise RuntimeError("Worker did not acknowledge managed-work drain")
        return response

    def _exchange(self, boundary: Boundary, timeout: float):
        run_id = boundary.run_id
        with self.lock:
            if self.closed:
                raise RuntimeError("Gateway closed")
            self.active[run_id, boundary.boundary_id] = boundary
            self.pending.put(boundary)
        try:
            response = boundary.response.get(timeout=timeout)
            if isinstance(response, Exception):
                raise response
            if isinstance(response, dict) and "_acephaleError" in response:
                raise RuntimeError(response["_acephaleError"]["type"])
            return response
        finally:
            with self.lock:
                self.active.pop((run_id, boundary.boundary_id), None)

    def next(self, timeout: float = 1):
        deadline = time.monotonic() + timeout
        while True:
            try:
                boundary = self.pending.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                return None
            with self.lock:
                if (boundary.run_id, boundary.boundary_id) in self.active:
                    if boundary.operation == "close":
                        return {"runId": boundary.run_id, "boundaryId": boundary.boundary_id, "operation": "close"}
                    return {"runId": boundary.run_id, "boundaryId": boundary.boundary_id, "public": copy.deepcopy(boundary.public)}

    def respond(self, run_id: str, boundary_id: str, response: dict):
        with self.lock:
            boundary = self.active.get((run_id, boundary_id))
            if boundary is None or boundary.response.full():
                raise ValueError("Unknown, expired or duplicate boundary response")
            boundary.response.put_nowait(copy.deepcopy(response))
            # Remove now, so a second response cannot race the queue consumer.
            self.active.pop((run_id, boundary_id))

    def close(self):
        with self.lock:
            self.closed = True
            self.ready.set()
            for boundary in self.active.values():
                if not boundary.response.full():
                    boundary.response.put_nowait(RuntimeError("Gateway closed"))
            self.active.clear()


class SnapshotReads:
    """Python owns isolation and freshness; native mutations invalidate every lease.

    clone and execute must be audited native-environment implementations. A deep
    copy of a remote/browser handle is not isolation and must not be supplied.
    """
    def __init__(self, clone: Callable[..., Any], execute: Callable[[Any, str, dict], Any], allowed: set[str], lease_seconds: float = 120, *, contextual_clone: bool = False):
        if not 0 < lease_seconds <= 120:
            raise ValueError("Invalid lease lifetime")
        self.clone, self.execute, self.allowed = clone, execute, frozenset(allowed)
        self.contextual_clone = contextual_clone
        self.lease_seconds = lease_seconds
        self.lock = threading.RLock()
        self.epoch = 0
        self.leases: dict[str, tuple[int, float, str, Any]] = {}

    def read(self, tool: str, arguments: dict):
        with self.lock:
            if tool not in self.allowed:
                raise ValueError("Speculative tool denied")
            snapshot = self.clone(tool, copy.deepcopy(arguments)) if self.contextual_clone else self.clone()
            epoch = self.epoch
        result = self.execute(snapshot, tool, copy.deepcopy(arguments))
        invocation = json.dumps([tool, arguments], sort_keys=True, allow_nan=False)
        lease = secrets.token_hex(24)
        with self.lock:
            if epoch != self.epoch:
                raise ValueError("Snapshot invalidated during read")
            now = time.monotonic()
            self.leases = {key: value for key, value in self.leases.items() if value[1] >= now}
            if len(self.leases) >= 64:
                raise ValueError("Freshness lease capacity exhausted")
            self.leases[lease] = (epoch, time.monotonic() + self.lease_seconds, invocation, copy.deepcopy(result))
        return {"lease": lease, "observation": result}

    def validate(self, lease: str, tool: str, arguments: dict):
        with self.lock:
            entry = self.leases.pop(lease, None)
            invocation = json.dumps([tool, arguments], sort_keys=True, allow_nan=False)
            if entry is None or entry[0] != self.epoch or entry[1] < time.monotonic() or entry[2] != invocation:
                raise ValueError("Freshness lease invalid")
            return copy.deepcopy(entry[3])

    def authoritative(self, callback: Callable[[], Any]):
        with self.lock:
            self.epoch += 1
            self.leases.clear()
            return callback()

    def refresh(self, lease: str, tool: str, arguments: dict):
        with self.lock:
            entry = self.leases.get(lease)
            observation = self.validate(lease, tool, arguments)
            replacement = secrets.token_hex(24)
            self.leases[replacement] = entry  # Preserve the original expiry.
            return {"lease": replacement, "observation": observation}


class ReadOperations:
    """Retain IDs for the gateway lifetime: cancellation fences delayed requests.

    Cancellation is cooperative only in the sense of discarding results. A running
    callback remains running until it physically returns. Never evict tombstones:
    an old POST can arrive after a cancellation acknowledgment.
    """
    def __init__(self, capacity: int = 4096):
        self.lock = threading.Lock()
        self.entries: dict[tuple[str, str], dict] = {}
        self.capacity = capacity

    def _key(self, run_id, operation_id):
        if not isinstance(run_id, str) or not isinstance(operation_id, str) or not 16 <= len(operation_id) <= 128:
            raise ValueError("Invalid operation identity")
        return run_id, operation_id

    def _admit(self):
        if len(self.entries) >= self.capacity:
            raise ValueError("Operation registry exhausted; restart after draining")

    def start(self, run_id, operation_id, invocation, callback):
        key = self._key(run_id, operation_id)
        fingerprint = json.dumps(invocation, sort_keys=True, allow_nan=False)
        with self.lock:
            existing = self.entries.get(key)
            if existing is not None:
                if existing.get("invocation", fingerprint) != fingerprint:
                    raise ValueError("Operation identity reused with different arguments")
                return self._public(existing)
            self._admit()
            entry = {"state": "running", "invocation": fingerprint, "cancel": False}
            self.entries[key] = entry
        try:
            result = callback()
            # Validate before publishing; malformed values cannot strand running state.
            json.dumps(result, allow_nan=False)
            with self.lock:
                entry.update(state="cancelled" if entry["cancel"] else "completed")
                if not entry["cancel"]:
                    entry["result"] = copy.deepcopy(result)
        except Exception:
            with self.lock:
                entry["state"] = "cancelled" if entry["cancel"] else "failed"
        with self.lock:
            return self._public(entry)

    def status(self, run_id, operation_id, cancel=False):
        key = self._key(run_id, operation_id)
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                if not cancel:
                    return {"state": "unknown"}
                self._admit()
                entry = {"state": "cancelled", "cancel": True}
                self.entries[key] = entry
            elif cancel:
                entry["cancel"] = True
                if entry["state"] != "running":
                    entry["state"] = "cancelled"
                    entry.pop("result", None)
            return self._public(entry)

    @staticmethod
    def _public(entry):
        return {key: copy.deepcopy(entry[key]) for key in ("state", "result") if key in entry}


def server(broker: StepBroker, token: str, host: str = "127.0.0.1", port: int = 0,
           reads: dict[str, SnapshotReads] | None = None):
    if len(token) < 32:
        raise ValueError("Gateway token must have at least 32 characters")
    expected = hashlib.sha256(f"Bearer {token}".encode()).digest()
    operations = ReadOperations()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log credentials or actor payloads.

        def do_POST(self):
            supplied = hashlib.sha256(self.headers.get("Authorization", "").encode()).digest()
            if not hmac.compare_digest(supplied, expected):
                self.send_error(401)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_error(400)
                return
            if not 0 < length <= 2_000_000:
                self.send_error(413)
                return
            try:
                payload = json.loads(self.rfile.read(length))
                if self.path == "/next":
                    result = broker.next()
                elif self.path == "/status":
                    result = {"closed": broker.closed}
                elif self.path == "/ready":
                    expected_fields = {"manifestHash", "experimentManifestHash"} if broker.expected_experiment_manifest_hash else {"manifestHash"}
                    if set(payload) != expected_fields:
                        raise ValueError("Invalid readiness payload")
                    result = broker.mark_ready(payload["manifestHash"], payload.get("experimentManifestHash"))
                elif self.path == "/respond":
                    broker.respond(payload["runId"], payload["boundaryId"], payload["response"])
                    result = {"ok": True}
                elif self.path in {"/read", "/validate", "/refresh", "/operation"} and reads is not None:
                    adapter = reads[payload["runId"]]
                    if self.path == "/read":
                        result = operations.start(payload["runId"], payload["operationId"],
                                                  [payload["tool"], payload["arguments"]],
                                                  lambda: adapter.read(payload["tool"], payload["arguments"]))
                    elif self.path == "/operation":
                        if type(payload.get("cancel", False)) is not bool:
                            raise ValueError("Invalid cancellation flag")
                        result = operations.status(payload["runId"], payload["operationId"], payload.get("cancel", False))
                    elif self.path == "/refresh":
                        result = adapter.refresh(payload["lease"], payload["tool"], payload["arguments"])
                    else:
                        result = adapter.validate(payload["lease"], payload["tool"], payload["arguments"])
                else:
                    self.send_error(404)
                    return
                body = json.dumps(result, allow_nan=False).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, KeyError, TypeError):
                self.send_error(400, "Invalid or stale gateway request")
            except (BrokenPipeError, ConnectionResetError):
                pass  # Operation state survives a disconnected HTTP caller.

    return ThreadingHTTPServer((host, port), Handler)
