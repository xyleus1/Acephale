"""Offline safety tests. No API, Docker, credential, or model access."""
from __future__ import annotations

import importlib.util
import json
import re
import shlex
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("infra_control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


class Provider:
    def __init__(self, cents=199, fail_launch=False):
        self.calls = []
        self.cents = cents
        self.fail_launch = fail_launch
        self.status = "active"

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path == "/instance-types":
            return {"gpu_1x_a100_sxm4": {"instance_type": {"name": "gpu_1x_a100_sxm4", "price_cents_per_hour": self.cents, "specs": {"gpus": 1}, "architecture": "x86_64"}, "regions_with_capacity_available": [{"name": "test-region"}]}}
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
        self.budget_calls = []
        def budget(plan, operation, lease=None):
            self.budget_calls.append(operation)
            result = {"committedMicrodollars": 166891414, "infrastructureMicrodollars": 0}
            if lease:
                result.update(reservationId="lambda-infra:" + lease["id"], maximumMicrodollars=lease["reservedMicrodollars"])
            return result
        self.budget = budget
        self.plan = {"version": 1, "provider": "lambda", "profile": control.PROFILE, "hardwareProfile": "a100-40gb-v1",
                     "sourceCommit": "a" * 40,
                     "region": "test-region", "sshKeyName": "research-key", "firewallRulesetId": "firewall-1",
                     "infrastructureLedgerPath": str(self.ledger.resolve())}
        self.initial = control.init_bound_ledger(self.ledger, self.plan, 0, budget=self.budget)
        self.client = Provider()
        self.now = 10000.0
        self.watchdog = self.root / "watchdog.json"
        self.prepared = None

    def prepare(self):
        if self.prepared is None:
            self.prepared = control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now, budget=self.budget)
        lease = self.prepared
        controllers = [{"profile": control.PROFILE, "controllerKind": "independent_always_on", "hostingKind": "aws_lambda",
                        "maxPollSeconds": 60, "verifiedAt": self.now, "planHash": control.digest(self.plan),
                        "leaseId": lease["id"], "expectedName": lease["name"], "deadline": lease["deadline"], "setupDeadline": lease["setupDeadline"],
                        "controllerId": "acephale-watchdog-" + suffix,
                        "hostId": f"arn:aws:lambda:{region}:123456789012:function:acephale-watchdog-{suffix}",
                        "codeSha256": control.sha256(control.HERE / "lambda_gpu_watchdog.py"), "recoveryEvidenceSha256": "b" * 64,
                        "readOnlyProbeSucceeded": True, "recoveryTestPassed": True}
                       for suffix, region in [("a", "us-east-1"), ("b", "us-west-2")]]
        control.atomic_json(self.watchdog, {"version": 1, "controllers": controllers})
        return lease

    def tearDown(self):
        self.temp.cleanup()

    def launch(self):
        lease = self.prepare()
        return control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget)

    def test_configuration_is_private_and_pinned(self):
        result = control.validate_config()
        self.assertTrue(result["valid"])
        self.assertFalse(result["containerExecutionValidated"])

    def test_source_amendment_preserves_original_slice_and_binding(self):
        evidence, output = self.root / "readiness.json", self.root / "source-amendment.json"
        control.write_new(evidence, {"awsConcurrentExecutions": 10, "reservedConcurrencyAvailable": False})
        before = self.ledger.read_bytes()
        value = control.record_source_amendment(self.ledger, output, "Use conditional S3 locks for observed account quota", evidence,
            source_probe=lambda _: "b" * 40, budget=self.budget)
        self.assertEqual(self.ledger.read_bytes(), before)
        self.assertEqual(value["planHash"], self.initial["planHash"])
        self.assertFalse(value["financialBindingChanged"])
        self.assertEqual(self.budget_calls[-1], "inspect")
        actual = control.deployment_source(self.initial, output, source_probe=lambda _: "b" * 40)
        self.assertEqual(actual["executingSourceCommit"], "b" * 40)
        with self.assertRaisesRegex(ValueError, "required"):
            control.deployment_source(self.initial, None, source_probe=lambda _: "b" * 40)
        with self.assertRaisesRegex(ValueError, "does not bind"):
            control.deployment_source(self.initial, output, source_probe=lambda _: "c" * 40)
        value["planHash"] = "f" * 64
        value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
        control.atomic_json(output, value)
        with self.assertRaisesRegex(ValueError, "does not bind"):
            control.deployment_source(self.initial, output, source_probe=lambda _: "b" * 40)

    def test_missing_actual_capacity_field_is_not_assumed_available(self):
        request = self.client.request
        def old_api(method, path, payload=None):
            result = request(method, path, payload)
            if path == "/instance-types":
                item = result["gpu_1x_a100_sxm4"]
                item["regions_with_capacity"] = item.pop("regions_with_capacity_available")
            return result
        self.client.request = old_api
        with self.assertRaisesRegex(ValueError, "no reported capacity"):
            control.quote(self.client, "test-region", self.now)

    def test_unbound_numeric_slice_cannot_launch(self):
        path = self.root / "unbound.json"
        control.init_ledger(path, 100, 0, 0)
        with self.assertRaisesRegex(ValueError, "Original-study-bound"):
            control.prepare_lease(self.client, path, 1, 0, budget=self.budget)
        self.assertEqual(self.client.calls, [])

    def test_uncertain_original_reservation_blocks_second_attempt(self):
        def fail(plan, operation, lease=None):
            if operation == "reserve":
                raise RuntimeError("uncertain journal response")
            return self.budget(plan, operation, lease)
        with self.assertRaises(RuntimeError):
            control.prepare_lease(self.client, self.ledger, 1, 0, now=self.now, budget=fail)
        rows = control.read_json(self.ledger)["leases"]
        self.assertEqual(rows[0]["status"], "reservation_pending")
        with self.assertRaisesRegex(ValueError, "unresolved"):
            control.prepare_lease(self.client, self.ledger, 1, 0, now=self.now, budget=self.budget)
        self.assertFalse(any(call[0] == "POST" for call in self.client.calls))

    def test_associated_charges_and_compute_have_separate_ceilings(self):
        control.reserve_overhead(self.ledger, "11111111-1111-4111-8111-111111111111", 5, budget=self.budget)
        with self.assertRaisesRegex(ValueError, "five dollars"):
            control.reserve_overhead(self.ledger, "22222222-2222-4222-8222-222222222222", 0.01, budget=self.budget)
        with self.assertRaisesRegex(ValueError, "allocation"):
            control.prepare_lease(self.client, self.ledger, 1, 0.01, now=self.now, budget=self.budget)
        value = control.prepare_lease(self.client, self.ledger, 8, 0, now=self.now, budget=self.budget)
        self.assertEqual(value["reservedComputeUsd"], 15.92)

    def test_a100_profile_changes_concurrency_without_lowering_legacy_guard(self):
        selected = control.hardware_profile("a100-40gb-v1")
        legacy = control.hardware_profile("a6000-48gb-v1")
        self.assertEqual(selected["minimumGpuMemoryMiB"], 39000)
        self.assertEqual(legacy["minimumGpuMemoryMiB"], 46000)
        value = control.read_json(control.HERE / "compose.json")
        control.apply_hardware(value, selected["id"])
        for role, context in (("actor", "32768"), ("predictor", "8192")):
            command = value["services"][role]["command"]
            self.assertEqual(command[command.index("--max-num-seqs") + 1], "1")
            self.assertEqual(command[command.index("--max-model-len") + 1], context)

    def test_training_window_is_bound_and_cumulatively_limited(self):
        lease = self.launch()
        probe = self.root / "preflight.json"
        control.write_new(probe, {"profile": "acephale-training-preflight-v1", "observedAt": self.now,
            "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": lease["quote"]["hardwareProfileHash"],
            "actorStopped": True, "gpuProcesses": 0})
        with patch.object(control.time, "time", return_value=self.now):
            first = control.training_lease(self.ledger, lease["id"], probe, self.root / "train1.json", 1)
            second = control.training_lease(self.ledger, lease["id"], probe, self.root / "train2.json", 1)
            self.assertEqual(first["studyReservation"], lease["studyReservation"])
            self.assertEqual(first["deadline"], second["deadline"])
            with self.assertRaisesRegex(ValueError, "two-hour"):
                control.training_lease(self.ledger, lease["id"], probe, self.root / "train3.json", 0.01)

    def test_runtime_image_contains_serving_and_compiler_identity_inputs(self):
        root = Path(__file__).resolve().parents[2]
        dockerfile = Path(__file__).with_name("runtime.Dockerfile").read_text()
        copies = []
        for line in dockerfile.splitlines():
            fields = shlex.split(line)
            if fields and fields[0] == "COPY":
                copies.extend((Path(source), Path(fields[-1])) for source in fields[1:-1])
        identity = root / "services/acephale-runtime/infra-compiler-identity.ts"
        referenced = [identity.parent / source for source in re.findall(r'"(\.{1,2}/[^"\n]+\.(?:ts|sql))"', identity.read_text())]
        required = [root / "infra/acephale-infra-v1/compose.json", *referenced]
        for path in required:
            target = path.resolve().relative_to(root)
            self.assertTrue(path.is_file(), str(target))
            self.assertTrue(any((source == target and destination == target)
                                or (root / source).is_dir() and target.is_relative_to(source)
                                and destination / target.relative_to(source) == target
                                for source, destination in copies), f"Runtime image omits {target}")
        # SQL and the lifecycle port affect ranked examples and latency calibration.
        bound = {path.resolve().relative_to(root).as_posix() for path in referenced}
        self.assertTrue({"src/lib/acephale/episodic-postgres.ts", "services/acephale-runtime/infra-memory-services.ts",
                         "services/acephale-runtime/migrations/002-episodic-memory.sql"} <= bound)

    def test_runtime_installs_only_standalone_database_dependencies(self):
        dockerfile = Path(__file__).with_name("runtime.Dockerfile").read_text()
        lines = dockerfile.splitlines()
        root = Path(__file__).resolve().parents[2]
        dependencies = json.loads((root / "package.json").read_text())["dependencies"]
        self.assertIn("pg", dependencies)
        self.assertFalse(any("prisma" in name.lower() for name in dependencies))
        self.assertNotIn("prisma", dockerfile.lower())
        installs = [(index, line) for index, line in enumerate(lines) if line.startswith("RUN ") and "npm ci" in line]
        self.assertEqual(len(installs), 1)
        self.assertIn("--ignore-scripts", installs[0][1])
        self.assertLess(installs[0][0], next(i for i, line in enumerate(lines) if line.startswith("USER ")))
        self.assertFalse(any(line.startswith("ENV ") and "DATABASE_URL" in line for line in lines))
        self.assertNotIn(".env", "\n".join(line for line in lines if line.startswith("COPY ")))

    def test_data_worker_preserves_the_shared_contract_layout(self):
        root = Path(__file__).resolve().parents[2]
        dockerfile = Path(__file__).with_name("worker.Dockerfile").read_text()
        self.assertIn("WORKDIR /app/research/acephale", dockerfile)
        self.assertIn("COPY research/acephale/src ./src", dockerfile)
        self.assertIn("COPY src/lib/acephale/contracts /app/src/lib/acephale/contracts", dockerfile)
        self.assertTrue((root / "src/lib/acephale/contracts/v1.schema.json").is_file())
        self.assertIn('/app/research/acephale/.venv/bin:$PATH', dockerfile)
        self.assertNotIn(".env", "\n".join(line for line in dockerfile.splitlines() if line.startswith("COPY ")))

    def test_quote_uses_live_price_and_pins_image(self):
        value = control.quote(self.client, "test-region", self.now)
        self.assertEqual(value["hourlyUsd"], 1.99)
        self.assertEqual(value["imageId"], "image-1")
        self.assertTrue(all(call[0] == "GET" for call in self.client.calls))

    def test_quote_rejects_expensive_or_unavailable_host(self):
        for provider, region in [(Provider(251), "test-region"), (Provider(), "missing")]:
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
                self.assertEqual(payload["instance_type_name"], "gpu_1x_a100_sxm4")
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
        lease = self.prepare()
        self.client.calls.clear()
        original = control.read_json(self.watchdog)
        for change in ({"verifiedAt": 1}, {"planHash": "elsewhere"}, {"controllerKind": "laptop"}, {"maxPollSeconds": 120}):
            data = json.loads(json.dumps(original))
            data["controllers"][0].update(change)
            control.atomic_json(self.watchdog, data)
            with self.assertRaises(ValueError):
                control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget)
        self.assertEqual(self.client.calls, [])

    def test_expired_quote_and_future_quote_rejected(self):
        quote = control.quote(self.client, "test-region", self.now)
        for now in (self.now + 301, self.now - 1):
            with self.assertRaises(ValueError):
                control.reserve_lease(self.initial, quote, 2, 1, now)

    def test_setup_allowance_is_prospective_and_keeps_funded_deadline(self):
        quote = control.quote(self.client, "test-region", self.now)
        default = control.reserve_lease(self.initial, quote, 2, 1, self.now)
        longer = control.reserve_lease(self.initial, quote, 2, 1, self.now, setup_seconds=3600)
        self.assertEqual(default["setupDeadline"], self.now + 1800)
        self.assertEqual(longer["setupDeadline"], self.now + 3600)
        for key in ("deadline", "reservedHours", "reservedUsd", "reservedComputeUsd", "ready"):
            self.assertEqual(default[key], longer[key])
        self.assertEqual(self.initial["leases"], [])

    def test_setup_allowance_never_outlives_short_lease(self):
        quote = control.quote(self.client, "test-region", self.now)
        lease = control.reserve_lease(self.initial, quote, .1, 0, self.now, setup_seconds=3600)
        self.assertEqual(lease["setupDeadline"], lease["deadline"])

    def test_invalid_setup_allowance_cannot_create_reservation(self):
        for seconds in (False, 0, 119, 3601, 1800.0, float("nan"), "3600"):
            before = control.read_json(self.ledger)
            reserved = self.budget_calls.count("reserve")
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now,
                                      budget=self.budget, setup_seconds=seconds)
            self.assertEqual(control.read_json(self.ledger), before)
            self.assertEqual(self.budget_calls.count("reserve"), reserved)

    def test_prepare_lease_persists_explicit_setup_deadline(self):
        lease = control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now,
                                      budget=self.budget, setup_seconds=3600)
        self.assertEqual(lease["setupDeadline"], self.now + 3600)
        self.assertEqual(control.read_json(self.ledger)["leases"][0], lease)

    def test_budget_and_cumulative_hours_fail_closed(self):
        quote = control.quote(self.client, "test-region", self.now)
        for ledger, hours, allowance in [({**self.initial, "priorInfraUsd": 34}, 2, 1), ({**self.initial, "priorGpuHours": 23}, 2, 1), (self.initial, 9, 1), (self.initial, 2, -1), (self.initial, float("nan"), 1)]:
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
        with control.ledger_lock(self.ledger), self.assertRaises(FileExistsError), control.ledger_lock(self.ledger):
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
        self.launch()
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

    def access_amendment(self):
        original = self.client.request
        self.access_key = {"id": "new-key", "name": "acephale-new-key", "public_key": "ssh-ed25519 test-public-key"}
        def request(method, path, payload=None):
            if path == "/ssh-keys":
                return [self.access_key]
            if path == "/firewall-rulesets/new-firewall":
                return original(method, "/firewall-rulesets/firewall-1", payload)
            return original(method, path, payload)
        self.client.request = request
        output = self.root / "new-access.json"
        before = self.ledger.read_bytes()
        value = control.record_access_amendment(self.client, self.ledger, output, "acephale-new-key", "new-firewall",
            "Replace access resources deleted after verified cleanup", source_probe=lambda _: "b" * 40)
        self.assertEqual(self.ledger.read_bytes(), before)
        self.assertFalse(value["financialBindingChanged"])
        return output

    def test_access_amendment_preserves_plan_and_binds_actual_launch_resources(self):
        output = self.access_amendment()
        self.prepared = control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now, budget=self.budget,
                                              access_amendment=output)
        lease = self.launch()
        payload = next(payload for _, path, payload in self.client.calls if path == "/instance-operations/launch")
        self.assertEqual(payload["ssh_key_names"], ["acephale-new-key"])
        self.assertEqual(payload["firewall_rulesets"], [{"id": "new-firewall"}])
        self.assertEqual(control.read_json(self.ledger)["plan"], self.plan)
        self.assertEqual(lease["accessAmendment"], control.read_json(output))

    def test_access_public_key_change_after_reservation_blocks_dispatch(self):
        output = self.access_amendment()
        self.prepared = control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now, budget=self.budget,
                                              access_amendment=output)
        self.access_key["public_key"] = "ssh-ed25519 replaced-public-key"
        with self.assertRaisesRegex(ValueError, "public-key identity"):
            self.launch()
        self.assertFalse(any(path == "/instance-operations/launch" for _, path, _ in self.client.calls))
        self.assertEqual(control.read_json(self.ledger)["leases"][0]["status"], "reserved")

    def test_resealed_access_amendment_cannot_change_financial_plan(self):
        output = self.access_amendment()
        value = control.read_json(output)
        value["planHash"] = "f" * 64
        value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
        control.atomic_json(output, value)
        with self.assertRaisesRegex(ValueError, "financial plan"):
            control.prepare_lease(self.client, self.ledger, 2, 1, now=self.now, budget=self.budget, access_amendment=output)
        self.assertEqual(control.read_json(self.ledger)["leases"], [])


if __name__ == "__main__":
    unittest.main()
