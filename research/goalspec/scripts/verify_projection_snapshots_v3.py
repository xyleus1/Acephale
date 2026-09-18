"""No-provider checks of installed projection snapshots against pinned native tools."""
# ruff: noqa: E402
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
import dotenv

dotenv.load_dotenv = lambda *args, **kwargs: False

from tau2.data_model.message import ToolCall, ToolMessage
from tau2.environment.environment import Environment
from tau2.registry import registry

from goalspec.adapters.tau_snapshot import ALLOWED, PURE, NativeSnapshotEnvironment


class ProjectionChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.templates = {domain: registry.get_env_constructor(domain)(solo_mode=False) for domain in ("retail", "airline")}

    def environment(self, domain, projected=True):
        template = self.templates[domain]
        original = Environment(domain, template.policy, type(template.tools)(template.tools.db.model_copy(deep=True)))
        return NativeSnapshotEnvironment(original, projection_snapshots=projected)

    def queries(self, domain):
        db = self.templates[domain].tools.db
        user_id, user = next(iter(db.users.items()))
        if domain == "retail":
            product_id, product = next(iter(db.products.items()))
            return {
                "find_user_id_by_email": {"email": user.email},
                "find_user_id_by_name_zip": {"first_name": user.name.first_name, "last_name": user.name.last_name, "zip": user.address.zip},
                "get_user_details": {"user_id": user_id}, "get_order_details": {"order_id": next(iter(db.orders))},
                "get_product_details": {"product_id": product_id}, "get_item_details": {"item_id": next(iter(product.variants))},
                "list_all_product_types": {},
            }
        flight_number, flight = next(iter(db.flights.items()))
        date = next(iter(flight.dates))
        return {"get_user_details": {"user_id": user_id}, "get_reservation_details": {"reservation_id": next(iter(db.reservations))},
            "get_flight_status": {"flight_number": flight_number, "date": date}, "list_all_airports": {},
            "search_direct_flight": {"origin": flight.origin, "destination": flight.destination, "date": date},
            "search_onestop_flight": {"origin": flight.origin, "destination": flight.destination, "date": date}}

    def check_query(self, domain, tool, arguments):
        projected, legacy = self.environment(domain), self.environment(domain, False)
        before = projected.get_db_hash()
        wanted = legacy.read(tool, arguments)["observation"]
        observed = projected.read(tool, arguments)
        self.assertEqual(observed["observation"], wanted)
        refreshed = projected.refresh(observed["lease"], tool, arguments)
        self.assertEqual(refreshed["observation"], wanted)
        message = ToolCall(id="actor-call", name=tool, arguments=arguments)
        projected.stage(type("Decision", (), {"tool_calls": [message]})(), {message.id: refreshed["lease"]})
        response = projected.get_response(message)
        self.assertEqual(response.content, wanted["content"])
        self.assertEqual(response.error, wanted["error"])
        self.assertEqual(response.id, message.id)
        self.assertEqual(projected.get_db_hash(), before)
        self.assertEqual(projected.promotion_events, [{"call_id": "actor-call", "status": "consumed"}])

    def test_every_audited_tool_preserves_native_content_errors_and_state(self):
        for domain in self.templates:
            queries = self.queries(domain)
            self.assertEqual(set(queries), set(ALLOWED[domain]))
            for tool, arguments in queries.items():
                with self.subTest(domain=domain, tool=tool):
                    self.check_query(domain, tool, arguments)

    def test_missing_and_invalid_inputs_preserve_native_error_output(self):
        cases = [("retail", "find_user_id_by_email", {"email": "missing@example.invalid"}),
            ("retail", "get_user_details", {"user_id": "missing"}), ("retail", "get_order_details", {"order_id": "#missing"}),
            ("retail", "get_item_details", {"item_id": "missing"}), ("retail", "get_product_details", {"product_id": "missing"}),
            ("retail", "get_user_details", {"user_id": []}), ("airline", "get_reservation_details", {"reservation_id": "missing"}),
            ("airline", "get_flight_status", {"flight_number": "missing", "date": "2024-05-15"})]
        for domain, tool, arguments in cases:
            with self.subTest(domain=domain, tool=tool, arguments=arguments):
                self.check_query(domain, tool, arguments)

    def test_keyed_projection_has_no_unrelated_tables_or_mutable_alias(self):
        env = self.environment("retail")
        query = self.queries("retail")["get_user_details"]
        snapshot = env._clone("get_user_details", query)
        self.assertEqual(len(snapshot.tools.db.users), 1)
        self.assertEqual(snapshot.tools.db.orders, {})
        self.assertEqual(snapshot.tools.db.products, {})
        snapshot.tools.db.users[query["user_id"]].address.city = "isolated mutation"
        self.assertNotEqual(env.tools.db.users[query["user_id"]].address.city, "isolated mutation")

    def test_projection_rejects_read_mutation_without_touching_authoritative_db(self):
        env = self.environment("retail")
        args = self.queries("retail")["get_user_details"]
        snapshot = env._clone("get_user_details", args)
        original = env.get_db_hash()
        def corrupt(message):
            snapshot.tools.db.users[args["user_id"]].address.city = "changed"
            return ToolMessage(id=message.id, role="tool", requestor="assistant", content="changed", error=False)
        snapshot.get_response = corrupt
        with self.assertRaisesRegex(ValueError, "changed projection"):
            env._execute_projected_snapshot(snapshot, "get_user_details", args)
        self.assertEqual(env.get_db_hash(), original)

    def test_direct_record_and_ownership_changes_invalidate_refresh(self):
        for domain, tool, table, key_field, field in [("retail", "get_user_details", "users", "user_id", "email"),
            ("retail", "get_order_details", "orders", "order_id", "user_id"),
            ("airline", "get_reservation_details", "reservations", "reservation_id", "user_id")]:
            with self.subTest(domain=domain, tool=tool):
                env = self.environment(domain)
                args = self.queries(domain)[tool]
                receipt = env.read(tool, args)
                setattr(getattr(env.tools.db, table)[args[key_field]], field, "externally_changed")
                with self.assertRaisesRegex(ValueError, "state changed"):
                    env.refresh(receipt["lease"], tool, args)

    def test_direct_scan_order_changes_invalidate_identity_and_search(self):
        for domain, tool, table in [("retail", "find_user_id_by_email", "users"), ("retail", "get_item_details", "products"),
                                   ("airline", "search_direct_flight", "flights"), ("airline", "search_onestop_flight", "flights")]:
            with self.subTest(domain=domain, tool=tool):
                env = self.environment(domain)
                args = self.queries(domain)[tool]
                receipt = env.read(tool, args)
                setattr(env.tools.db, table, dict(reversed(list(getattr(env.tools.db, table).items()))))
                with self.assertRaisesRegex(ValueError, "state changed"):
                    env.validate(receipt["lease"], tool, args)

    def test_external_insert_missing_key_and_identity_scan_invalidate(self):
        env = self.environment("retail")
        for tool, args in [("get_user_details", {"user_id": "previously_absent"}),
                           ("find_user_id_by_email", {"email": "inserted@example.invalid"})]:
            receipt = env.read(tool, args)
            new_user = next(iter(env.tools.db.users.values())).model_copy(deep=True)
            new_user.user_id, new_user.email = "previously_absent", "inserted@example.invalid"
            env.tools.db.users[new_user.user_id] = new_user
            with self.assertRaisesRegex(ValueError, "state changed"):
                env.validate(receipt["lease"], tool, args)
            del env.tools.db.users[new_user.user_id]

    def test_external_flight_date_mutation_invalidates_status(self):
        env = self.environment("airline")
        args = self.queries("airline")["get_flight_status"]
        receipt = env.read("get_flight_status", args)
        del env.tools.db.flights[args["flight_number"]].dates[args["date"]]
        with self.assertRaisesRegex(ValueError, "state changed"):
            env.validate(receipt["lease"], "get_flight_status", args)

    def test_audited_reads_preserve_projection_lease_but_legacy_invalidates(self):
        args = self.queries("retail")["get_user_details"]
        for projected in (True, False):
            env = self.environment("retail", projected)
            receipt = env.read("get_user_details", args)
            env.use_tool("get_user_details", **args)
            if projected:
                self.assertEqual(env.validate(receipt["lease"], "get_user_details", args), receipt["observation"])
            else:
                with self.assertRaises(ValueError):
                    env.validate(receipt["lease"], "get_user_details", args)

    def test_native_write_and_set_state_invalidate_lease(self):
        for operation in ("write", "set_state"):
            env = self.environment("retail")
            args = self.queries("retail")["get_user_details"]
            receipt = env.read("get_user_details", args)
            if operation == "write":
                address = env.tools.db.users[args["user_id"]].address.model_dump()
                env.use_tool("modify_user_address", **args, **{**address, "address1": "new address"})
            else:
                env.set_state(None, None, [], strict=True)
            with self.assertRaises(ValueError):
                env.validate(receipt["lease"], "get_user_details", args)


    def test_calculate_preserves_lease_and_native_result_without_becoming_speculative(self):
        for domain in self.templates:
            for expression in ("2 + 2", "1 / 0", "invalid"):
                with self.subTest(domain=domain, expression=expression):
                    env = self.environment(domain)
                    args = self.queries(domain)["get_user_details"]
                    receipt = env.read("get_user_details", args)
                    before = env.get_db_hash()
                    call = ToolCall(id="math", name="calculate", arguments={"expression": expression})
                    expected = self.environment(domain).get_response(call)
                    env.stage(type("Decision", (), {"tool_calls": [call]})(), {})
                    actual = env.get_response(call)
                    self.assertEqual((actual.content, actual.error), (expected.content, expected.error))
                    self.assertEqual(env.get_db_hash(), before)
                    self.assertEqual(env.validate(receipt["lease"], "get_user_details", args), receipt["observation"])
                    self.assertNotIn("calculate", ALLOWED[domain])
                    self.assertEqual(PURE[domain], {"calculate"})
                    with self.assertRaises(ValueError):
                        env.read("calculate", {"expression": "2 + 2"})

    def test_calculate_and_read_batch_promotes_only_real_read_and_legacy_still_invalidates(self):
        for domain in self.templates:
            env = self.environment(domain)
            args = self.queries(domain)["get_user_details"]
            receipt = env.read("get_user_details", args)
            calculate = ToolCall(id="math", name="calculate", arguments={"expression": "2+2"})
            read = ToolCall(id="profile", name="get_user_details", arguments=args)
            env.stage(type("Decision", (), {"tool_calls": [calculate, read]})(), {read.id: receipt["lease"]})
            self.assertFalse(env.get_response(calculate).error)
            result = env.get_response(read)
            self.assertEqual(result.content, receipt["observation"]["content"])
            self.assertEqual(env.promotion_events, [{"call_id": "profile", "status": "consumed"}])
            with self.assertRaisesRegex(ValueError, "Only audited reads"):
                env.stage(type("Decision", (), {"tool_calls": [calculate]})(), {calculate.id: "bogus"})
            legacy = self.environment(domain, False)
            legacy_receipt = legacy.read("get_user_details", args)
            legacy.get_response(calculate)
            with self.assertRaises(ValueError):
                legacy.validate(legacy_receipt["lease"], "get_user_details", args)

    def test_pure_calculate_does_not_hide_mixed_mutation_or_unknown_calls(self):
        for tool in ("modify_user_address", "unknown_tool"):
            env = self.environment("retail")
            args = self.queries("retail")["get_user_details"]
            receipt = env.read("get_user_details", args)
            calls = [ToolCall(id="math", name="calculate", arguments={"expression": "2+2"}),
                     ToolCall(id="mutation", name=tool, arguments={})]
            env.stage(type("Decision", (), {"tool_calls": calls})(), {})
            with self.assertRaises(ValueError):
                env.validate(receipt["lease"], "get_user_details", args)


if __name__ == "__main__":
    unittest.main(verbosity=2)
