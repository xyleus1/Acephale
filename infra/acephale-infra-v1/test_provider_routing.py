"""Regional routing keeps old money, hardware and exact access identities."""
import io
import unittest
import urllib.error
from unittest.mock import patch

import provider_routing as routing
from test_control import ControlTests, control


class RoutingTests(unittest.TestCase):
    access_amendment = ControlTests.access_amendment
    prepare = ControlTests.prepare
    launch = ControlTests.launch
    tearDown = ControlTests.tearDown

    def setUp(self):
        ControlTests.setUp(self)
        self.access = self.access_amendment()
        original = self.client.request
        self.rate, self.image = 199, "image-west"

        def request(method, path, payload=None):
            if path == "/instance-types":
                value = original(method, path, payload)
                item = value["gpu_1x_a100_sxm4"]
                item["instance_type"]["price_cents_per_hour"] = self.rate
                item["regions_with_capacity_available"].append({"name": "us-west-2"})
                return value
            if path == "/images":
                return [*original(method, path, payload), {"id": self.image, "family": "gpu-base-24-04",
                    "architecture": "x86_64", "region": {"name": "us-west-2"}, "created_time": "2026-11-01"}]
            if path == "/firewall-rulesets/west-firewall":
                return {"region": {"name": "us-west-2"}, "rules": [{"protocol": "tcp", "port_range": [22, 22],
                    "source_network": "192.0.2.1/32"}]}
            return original(method, path, payload)
        self.client.request = request
        self.route_path = self.root / "route.json"

    def route(self):
        before = self.ledger.read_bytes()
        value = routing.record_route(self.client, self.ledger, self.route_path, "us-west-2", "west-firewall",
                                     self.access, "Same hardware capacity moved", source_probe=lambda _: "b" * 40)
        self.assertEqual(before, self.ledger.read_bytes())
        return value

    def test_route_preserves_plan_and_uses_declared_region_image_and_firewall(self):
        route = self.route()
        self.prepared = control.prepare_lease(self.client, self.ledger, 2, 0, now=self.now, budget=self.budget,
                                             routing_amendment=self.route_path)
        self.launch()
        payload = next(value for _, path, value in self.client.calls if path == "/instance-operations/launch")
        self.assertEqual((payload["region_name"], payload["image"], payload["firewall_rulesets"]),
                         ("us-west-2", {"id": "image-west"}, [{"id": "west-firewall"}]))
        ledger = control.read_json(self.ledger)
        self.assertEqual(ledger["plan"], self.plan)
        self.assertEqual(ledger["leases"][0]["routingAmendment"], route)

    def test_route_is_creation_only_and_never_changes_prior_leases(self):
        ledger = control.read_json(self.ledger)
        prior = {"id": "prior", "status": "launch_unknown", "instanceId": None, "reservedUsd": 15.92}
        ledger["leases"].append(prior)
        control.atomic_json(self.ledger, ledger)
        self.route()
        self.assertEqual(control.read_json(self.ledger)["leases"], [prior])
        with self.assertRaises(FileExistsError):
            routing.record_route(self.client, self.ledger, self.route_path, "us-west-2", "west-firewall",
                                 self.access, "No overwrite", source_probe=lambda _: "b" * 40)

    def test_resealed_financial_or_hardware_change_is_rejected(self):
        valid = self.route()
        mutations = [("planHash", "f" * 64), ("financialBindingHash", "f" * 64),
                     ("financialBindingChanged", True), ("maximumHourlyUsd", 2.5), ("region", "eu-west-1")]
        for key, changed in mutations:
            with self.subTest(key=key):
                value = {**valid, key: changed}
                value["contentHash"] = control.digest({k: v for k, v in value.items() if k != "contentHash"})
                with self.assertRaises(ValueError):
                    routing.checked_route(control.read_json(self.ledger), value)

    def test_changed_key_image_or_price_prevents_any_dispatch(self):
        route = self.route()
        for field, changed in (("imageId", "different"), ("hardwareProfileHash", "f" * 64), ("hourlyUsd", 2.0)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                routing.verify_quote(route, {**route["quote"], field: changed})
        self.image = "replacement-image"
        with self.assertRaises(ValueError):
            control.prepare_lease(self.client, self.ledger, 2, 0, now=self.now, budget=self.budget,
                                  routing_amendment=self.route_path)
        self.assertEqual(control.read_json(self.ledger)["leases"], [])
        self.image = "image-west"
        self.prepared = control.prepare_lease(self.client, self.ledger, 2, 0, now=self.now, budget=self.budget,
                                             routing_amendment=self.route_path)
        self.access_key["public_key"] = "changed"
        with self.assertRaises(ValueError):
            self.launch()
        self.assertFalse(any(path == "/instance-operations/launch" for _, path, _ in self.client.calls))

    def test_unfunded_higher_price_and_wrong_region_firewall_fail_before_sidecar(self):
        self.rate = 200
        with self.assertRaises(ValueError):
            self.route()
        self.assertFalse(self.route_path.exists())
        self.rate = 199
        with self.assertRaises(ValueError):
            routing.record_route(self.client, self.ledger, self.route_path, "us-west-2", "new-firewall",
                                 self.access, "Wrong region firewall", source_probe=lambda _: "b" * 40)

    def test_http_failure_retains_only_safe_status_and_code(self):
        body = b'{"error":{"code":"instance-operations/launch/insufficient-capacity","message":"DO_NOT_LOG"}}'
        failure = urllib.error.HTTPError("https://example.invalid", 400, "DO_NOT_LOG", {}, io.BytesIO(body))
        with patch.object(control.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = failure
            with self.assertRaises(control.ProviderRequestError) as raised:
                control.LambdaClient("test-placeholder").request("GET", "/instances")
        self.assertEqual(raised.exception.http_status, 400)
        self.assertEqual(raised.exception.provider_code, "instance-operations/launch/insufficient-capacity")
        self.assertNotIn("DO_NOT_LOG", str(raised.exception))

    def test_failed_launch_preserves_status_and_reservation_with_safe_metadata(self):
        self.route()
        self.prepared = control.prepare_lease(self.client, self.ledger, 2, 0, now=self.now, budget=self.budget,
                                             routing_amendment=self.route_path)
        original = self.client.request
        def request(method, path, payload=None):
            if path == "/instance-operations/launch":
                raise control.ProviderRequestError(400, "insufficient-capacity")
            return original(method, path, payload)
        self.client.request = request
        with self.assertRaises(control.ProviderRequestError):
            self.launch()
        lease = control.read_json(self.ledger)["leases"][0]
        self.assertEqual(lease["status"], "launch_unknown")
        self.assertEqual(lease["reservedUsd"], self.prepared["reservedUsd"])
        self.assertEqual(lease["launchFailure"], {"errorType": "ProviderRequestError", "httpStatus": 400,
            "providerCode": "insufficient-capacity", "responseBodyRetained": False, "reservationReleased": False})


if __name__ == "__main__":
    unittest.main()
