"""Offline safety tests. No API, Docker, credential, or model access."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("infra_control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


class Provider:
    def __init__(self, cents=109, fail_launch=False):
        self.calls = []
        self.cents = cents
        self.fail_launch = fail_launch
        self.status = "active"

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path == "/instance-types":
            return {"gpu_1x_a6000": {"instance_type": {"name": "gpu_1x_a6000", "price_cents_per_hour": self.cents, "specs": {"gpus": 1}, "architecture": "x86_64"}, "regions_with_capacity": [{"name": "test-region"}]}}
        if path == "/images":
            return [{"id": "image-1", "family": "gpu-base-24-04", "architecture": "x86_64", "region": {"name": "test-region"}, "created_time": "2026-11-01"}]
        if path == "/instance-operations/launch":
            if self.fail_launch:
                raise RuntimeError("lost response")
            return {"instance_ids": ["instance-1"]}
        if path == "/instance-operations/terminate":
            self.status = "terminated"
            return {"terminated_instances": [{"id": "instance-1"}]}
        if path == "/instances/instance-1":
            return {"id": "instance-1", "status": self.status}
        if path == "/instances":
            return []
        if path == "/firewall-rulesets/firewall-1":
            return {"region": {"name": "test-region"}, "rules": [{"protocol": "tcp", "port_range": [22, 22], "source_network": "192.0.2.1/32"}]}
        if path == "/firewall-rulesets/global":
            return {"rules": []}
        raise AssertionError((method, path))


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ledger = self.root / "ledger.json"
        self.initial = control.init_ledger(self.ledger, 166.891414, 0, 0)
        self.client = Provider()
        self.now = 10000.0
        self.watchdog = self.root / "watchdog.json"
        control.write_new(self.watchdog, {"profile": control.PROFILE, "controllerKind": "independent_always_on", "maxPollSeconds": 60, "verifiedAt": self.now, "ledgerPath": str(self.ledger.resolve())})

    def tearDown(self):
        self.temp.cleanup()

    def launch(self):
        return control.launch(self.client, self.ledger, "test-region", "research-key", 2, 1, self.watchdog, self.now, "firewall-1")

    def test_configuration_is_private_and_pinned(self):
        result = control.validate_config()
        self.assertTrue(result["valid"])
        self.assertFalse(result["containerExecutionValidated"])

    def test_quote_uses_live_price_and_pins_image(self):
        value = control.quote(self.client, "test-region", self.now)
        self.assertEqual(value["hourlyUsd"], 1.09)
        self.assertEqual(value["imageId"], "image-1")
        self.assertTrue(all(call[0] == "GET" for call in self.client.calls))

    def test_quote_rejects_expensive_or_unavailable_host(self):
        for provider, region in [(Provider(126), "test-region"), (Provider(), "missing")]:
            with self.assertRaises(ValueError):
                control.quote(provider, region, self.now)

    def test_nonfinite_price_rejected(self):
        with self.assertRaises(ValueError):
            control.quote(Provider(float("nan")), "test-region", self.now)

    def test_reservation_precedes_exactly_one_launch(self):
        original = self.client.request
        def checked(method, path, payload=None):
            if path.endswith("/launch"):
                recorded = control.read_json(self.ledger)["leases"][0]
                self.assertEqual(recorded["status"], "launching")
                self.assertGreater(recorded["reservedUsd"], 0)
                self.assertEqual(payload["instance_type_name"], "gpu_1x_a6000")
                self.assertEqual(payload["firewall_rulesets"], [{"id": "firewall-1"}])
                self.assertEqual(payload["image"], {"id": "image-1"})
            return original(method, path, payload)
        self.client.request = checked
        lease = self.launch()
        self.assertEqual(lease["status"], "active")
        self.assertEqual(len([call for call in self.client.calls if call[1].endswith("/launch")]), 1)

    def test_uncertain_launch_keeps_budget_and_blocks_retry(self):
        self.client.fail_launch = True
        with self.assertRaises(RuntimeError):
            self.launch()
        before = control.read_json(self.ledger)
        self.assertEqual(before["leases"][0]["status"], "launch_unknown")
        with self.assertRaises(ValueError):
            self.launch()
        self.assertEqual(control.read_json(self.ledger), before)
        self.assertEqual(len([call for call in self.client.calls if call[1].endswith("/launch")]), 1)

    def test_launch_requires_fresh_watchdog_for_same_ledger(self):
        for change in ({"verifiedAt": 1}, {"ledgerPath": "elsewhere"}, {"controllerKind": "laptop"}, {"maxPollSeconds": 120}):
            data = control.read_json(self.watchdog)
            data.update(change)
            control.atomic_json(self.watchdog, data)
            with self.assertRaises(ValueError):
                self.launch()
        self.assertEqual(self.client.calls, [])

    def test_expired_quote_and_future_quote_rejected(self):
        quote = control.quote(self.client, "test-region", self.now)
        for now in (self.now + 301, self.now - 1):
            with self.assertRaises(ValueError):
                control.reserve_lease(self.initial, quote, 2, 1, now)

    def test_budget_and_cumulative_hours_fail_closed(self):
        quote = control.quote(self.client, "test-region", self.now)
        for ledger, hours, allowance in [({**self.initial, "priorInfraUsd": 34}, 2, 1), ({**self.initial, "priorGpuHours": 23}, 2, 1), (self.initial, 9, 1), (self.initial, 2, 0), (self.initial, float("nan"), 1)]:
            with self.assertRaises(ValueError):
                control.reserve_lease(ledger, quote, hours, allowance, self.now)

    def test_existing_ledger_is_never_overwritten(self):
        with self.assertRaises(FileExistsError):
            control.init_ledger(self.ledger, 0, 0, 0)
        self.assertEqual(control.read_json(self.ledger), self.initial)

    def test_protected_contingency(self):
        with self.assertRaises(ValueError):
            control.init_ledger(self.root / "too-high.json", 401, 0, 0)

    def test_lock_excludes_parallel_mutations(self):
        with control.ledger_lock(self.ledger):
            with self.assertRaises(FileExistsError):
                with control.ledger_lock(self.ledger):
                    self.fail("lock was not exclusive")

    def export(self, lease):
        payload = self.root / "results.jsonl"
        payload.write_text('{"result":"fixture"}\n')
        receipt = self.root / "export.json"
        control.write_new(receipt, {"leaseId": lease["id"], "files": [{"path": payload.name, "sha256": control.sha256(payload), "bytes": payload.stat().st_size}]})
        return receipt

    def test_normal_termination_requires_verified_export(self):
        lease = self.launch()
        with self.assertRaises(ValueError):
            control.terminate(self.client, self.ledger, lease["id"])
        self.assertFalse(any(call[1].endswith("/terminate") for call in self.client.calls))
        result = control.terminate(self.client, self.ledger, lease["id"], self.root, self.export(lease))
        self.assertEqual(result["status"], "terminated")
        self.assertEqual(result["reservedUsd"], lease["reservedUsd"])

    def test_export_rejects_changed_content_and_wrong_lease(self):
        lease = self.launch()
        receipt = self.export(lease)
        with self.assertRaises(ValueError):
            control.verify_export(self.root, receipt, "another-lease")
        (self.root / "results.jsonl").write_text("modified")
        with self.assertRaises(ValueError):
            control.verify_export(self.root, receipt, lease["id"])

    def test_export_rejects_path_escape(self):
        outside = self.root.parent / (self.root.name + "-outside")
        outside.write_text("outside")
        try:
            receipt = self.root / "export.json"
            control.write_new(receipt, {"leaseId": "x", "files": [{"path": "../" + outside.name, "bytes": outside.stat().st_size, "sha256": control.sha256(outside)}]})
            with self.assertRaises(ValueError):
                control.verify_export(self.root, receipt, "x")
        finally:
            outside.unlink()

    def test_watchdog_setup_deadline_and_emergency_cleanup(self):
        lease = self.launch()
        self.assertEqual(control.watchdog_tick(self.client, self.ledger, self.now + 1799), [])
        result = control.watchdog_tick(self.client, self.ledger, self.now + 1800)
        self.assertEqual(result[0]["status"], "terminated")
        self.assertTrue(result[0]["emergencyTermination"])

    def test_termination_is_idempotent_after_verification(self):
        lease = self.launch()
        control.terminate(self.client, self.ledger, lease["id"], emergency=True)
        count = len(self.client.calls)
        control.terminate(self.client, self.ledger, lease["id"], emergency=True)
        self.assertEqual(len(self.client.calls), count)

    def test_provider_failure_does_not_release_reservation(self):
        lease = self.launch()
        original = self.client.request
        def fail(method, path, payload=None):
            if path.endswith("/terminate"):
                raise RuntimeError("lost response")
            return original(method, path, payload)
        self.client.request = fail
        with self.assertRaises(RuntimeError):
            control.terminate(self.client, self.ledger, lease["id"], emergency=True)
        recorded = control.read_json(self.ledger)["leases"][0]
        self.assertEqual(recorded["status"], "termination_requested")
        self.assertEqual(recorded["reservedUsd"], lease["reservedUsd"])

    def test_preflight_does_not_print_credentials_or_call_provider(self):
        with patch.dict(control.os.environ, {"LAMBDA_API_KEY": "never-print-this", "OPENAI_API_KEY": "never-print-that"}), patch.object(control.shutil, "which", return_value=None):
            result = control.preflight()
        text = json.dumps(result)
        self.assertNotIn("never-print", text)
        self.assertTrue(result["credentialPresence"]["LAMBDA_API_KEY"])
        self.assertFalse(result["readyForGpuExecution"])

    def test_open_global_firewall_blocks_launch(self):
        original = self.client.request
        def request(method, path, payload=None):
            if path == "/firewall-rulesets/global":
                return {"rules": [{"protocol": "tcp", "port_range": [22, 22], "source_network": "0.0.0.0/0"}]}
            return original(method, path, payload)
        self.client.request = request
        with self.assertRaises(ValueError):
            self.launch()
        self.assertEqual(control.read_json(self.ledger)["leases"], [])

    def test_locked_compose_rejects_missing_pins(self):
        path = self.root / "images.json"
        control.write_new(path, {"profile": control.PROFILE, "images": {}})
        with self.assertRaises(ValueError):
            control.locked_compose(path, self.root / "compose.json")


if __name__ == "__main__":
    unittest.main()
