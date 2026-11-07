"""Isolated reads for the pinned, in-memory retail and airline environments.

This module is loaded only inside the native benchmark Python environment.
The orchestrator must use this wrapper as its environment, not the original.
"""
from __future__ import annotations

import hashlib
import json

from tau2.data_model.message import ToolCall, ToolMessage
from tau2.domains.airline.tools import AirlineTools
from tau2.domains.retail.tools import RetailTools
from tau2.environment.environment import Environment
from tau2.environment.toolkit import ToolType

from acephale.native_common import READS

from .step_gateway import SnapshotReads

ALLOWED = READS


# Audited pinned implementations use only expression text, never environment or
# database state. Keep these OUTSIDE ALLOWED: they are not speculative reads.
PURE = {"retail": frozenset({"calculate"}), "airline": frozenset({"calculate"})}


class NativeSnapshotEnvironment(Environment):
    def __init__(self, original: Environment, *, projection_snapshots: bool = False):
        domain = original.get_domain_name()
        expected = {"retail": RetailTools, "airline": AirlineTools}.get(domain)
        if type(original) is not Environment or expected is None or type(original.tools) is not expected:
            raise ValueError("Only audited native retail and airline environments are supported")
        if original.user_tools is not None or original.solo_mode:
            raise ValueError("Unsupported native execution mode")
        for name in ALLOWED[domain]:
            if original.tools.tool_type(name) != ToolType.READ or original.tools.tool_mutates_state(name):
                raise ValueError("Native read metadata changed; repeat audit")
        if projection_snapshots:
            for name in PURE[domain]:
                if original.tools.tool_type(name) != ToolType.GENERIC or original.tools.tool_mutates_state(name):
                    raise ValueError("Native pure tool metadata changed; repeat audit")
        super().__init__(domain_name=domain, policy=original.policy, tools=original.tools)
        self.projection_snapshots = projection_snapshots
        execute = self._execute_projected_snapshot if projection_snapshots else self._execute_snapshot
        self.reads = SnapshotReads(self._clone, execute, set(ALLOWED[domain]), contextual_clone=projection_snapshots)
        self._lease_state: dict[str, str] = {}
        self._staged: dict[str, tuple[str, str, dict]] = {}
        self.promotion_events: list[dict] = []

    def _projection(self, tool, arguments):
        """Complete audited dependencies, preserving table order and missing keys.

        Broad scans copy whole tables; keyed reads copy complete records. No
        selected mutable record is shared with the authoritative environment.
        """
        if tool not in ALLOWED[self.domain_name]:
            raise ValueError("Unaudited projection tool")
        database = self.tools.db
        tables = {"retail": {"users", "orders", "products"}, "airline": {"users", "reservations", "flights"}}[self.domain_name]
        if set(type(database).model_fields) != tables:
            raise ValueError("Native database dependency schema changed")
        projection = {name: {} for name in type(database).model_fields}
        if self.domain_name == "retail":
            if tool in {"find_user_id_by_email", "find_user_id_by_name_zip"}:
                table, key = "users", None
            elif tool in {"get_item_details", "list_all_product_types"}:
                table, key = "products", None
            else:
                table, argument = {"get_user_details": ("users", "user_id"), "get_order_details": ("orders", "order_id"),
                                   "get_product_details": ("products", "product_id")}[tool]
                key = arguments.get(argument)
        else:
            if tool == "list_all_airports":
                return projection
            if tool in {"search_direct_flight", "search_onestop_flight"}:
                table, key = "flights", None
            else:
                table, argument = {"get_user_details": ("users", "user_id"), "get_reservation_details": ("reservations", "reservation_id"),
                                   "get_flight_status": ("flights", "flight_number")}[tool]
                key = arguments.get(argument)
        source = getattr(database, table)
        # Invalid/missing argument types retain the full dependency table so
        # the original native tool remains responsible for its error response.
        projection[table] = source if not isinstance(key, str) else {key: source[key]} if key in source else {}
        return projection

    @staticmethod
    def _projection_digest(projection):
        ordered = {table: {key: record.model_dump(mode="json") for key, record in records.items()} for table, records in projection.items()}
        # Dictionary insertion order affects native scan order and serialized
        # observations. Sorting keys here would miss an external order change.
        return hashlib.sha256(json.dumps(ordered, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()

    def _read_hash(self, tool, arguments):
        return self._projection_digest(self._projection(tool, arguments)) if self.projection_snapshots else self.get_db_hash()

    def _clone(self, tool=None, arguments=None):
        # Copy database values into a fresh toolkit. Never copy bound methods,
        # environment handles, browser sessions, or mutable toolkit caches.
        if self.projection_snapshots:
            projection = self._projection(tool, arguments)
            copied = {table: {key: record.model_copy(deep=True) for key, record in records.items()} for table, records in projection.items()}
            database = type(self.tools.db)(**copied)
        else:
            database = self.tools.db.model_copy(deep=True)
        return Environment(self.domain_name, self.policy, type(self.tools)(database))

    @staticmethod
    def _execute_projected_snapshot(snapshot, tool, arguments):
        def fingerprint():
            return NativeSnapshotEnvironment._projection_digest({name: getattr(snapshot.tools.db, name) for name in type(snapshot.tools.db).model_fields})
        before = fingerprint()
        response = snapshot.get_response(ToolCall(id="isolated-read", name=tool, arguments=arguments))
        if before != fingerprint():
            raise ValueError("Audited read changed projection state")
        return {"content": response.content, "error": response.error}

    @staticmethod
    def _execute_snapshot(snapshot, tool, arguments):
        before = snapshot.get_db_hash()
        response = snapshot.get_response(ToolCall(id="isolated-read", name=tool, arguments=arguments))
        if before != snapshot.get_db_hash():
            raise ValueError("Audited read changed snapshot state")
        return {"content": response.content, "error": response.error}

    def read(self, tool, arguments):
        with self.reads.lock:
            before = self._read_hash(tool, arguments)
        result = self.reads.read(tool, arguments)
        with self.reads.lock:
            if before != self._read_hash(tool, arguments):
                raise ValueError("Native state changed during snapshot execution")
            self._lease_state = {key: value for key, value in self._lease_state.items() if key in self.reads.leases}
            self._lease_state[result["lease"]] = before
            return result

    def validate(self, lease, tool, arguments):
        with self.reads.lock:
            state = self._lease_state.pop(lease, None)
            if state is None or state != self._read_hash(tool, arguments):
                self.reads.leases.pop(lease, None)
                raise ValueError("Native state changed since observation")
            return self.reads.validate(lease, tool, arguments)

    def consume(self, message: ToolCall, lease: str) -> ToolMessage:
        """Construct a native result only for an actual matching actor call."""
        if message.requestor != "assistant":
            raise ValueError("Only assistant reads may consume evidence")
        result = self.validate(lease, message.name, message.arguments)
        return ToolMessage(id=message.id, role="tool", requestor=message.requestor, **result)

    def refresh(self, lease, tool, arguments):
        with self.reads.lock:
            state = self._lease_state.get(lease)
            if state is None or state != self._read_hash(tool, arguments):
                raise ValueError("Native state changed since observation")
            result = self.reads.refresh(lease, tool, arguments)
            self._lease_state.pop(lease, None)
            self._lease_state[result["lease"]] = state
            return result

    def _side_effect_free(self, tool):
        return tool in ALLOWED[self.domain_name] or (self.projection_snapshots and tool in PURE[self.domain_name])

    def stage(self, assistant, leases):
        """Called by the trusted external agent after validating the actor response."""
        with self.reads.lock:
            self._staged.clear()
            calls = assistant.tool_calls or []
            if not isinstance(leases, dict) or set(leases) - {call.id for call in calls}:
                raise ValueError("Promotion does not match actor calls")
            if any(not self._side_effect_free(call.name) for call in calls):
                self.reads.authoritative(lambda: None)
                return  # Mixed batches execute entirely through native orchestration.
            for call in calls:
                if call.id in leases:
                    if call.name not in ALLOWED[self.domain_name]:
                        raise ValueError("Only audited reads may have promotion leases")
                    if not isinstance(leases[call.id], str):
                        raise ValueError("Invalid promotion lease")
                    self._staged[call.id] = (leases[call.id], call.name, dict(call.arguments))

    def get_response(self, message):
        with self.reads.lock:
            staged = self._staged.pop(message.id, None)
            if staged and staged[1:] == (message.name, message.arguments):
                try:
                    result = self.consume(message, staged[0])
                    self.promotion_events.append({"call_id": message.id, "status": "consumed"})
                    return result
                except ValueError:
                    self.promotion_events.append({"call_id": message.id, "status": "stale_fallback"})
            return super().get_response(message)

    def use_tool(self, tool_name, **kwargs):
        if self.projection_snapshots and self._side_effect_free(tool_name):
            # Audited reads and pure calculate do not change native state. Keep
            # independent leases across reads; dependency fingerprints still
            # detect direct external changes before refresh or consumption.
            with self.reads.lock:
                return super().use_tool(tool_name, **kwargs)
        # Preserve the native return value and exceptions. All authoritative calls
        # invalidate leases conservatively, including mixed read/write batches.
        return self.reads.authoritative(lambda: super(NativeSnapshotEnvironment, self).use_tool(tool_name, **kwargs))

    def set_state(self, *args, **kwargs):
        return self.reads.authoritative(lambda: super(NativeSnapshotEnvironment, self).set_state(*args, **kwargs))
