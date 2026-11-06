"""Offline Lambda transport, independent cleanup, evidence and template tests."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

import aws_control as control
import aws_serverless_watchdog as serverless
import aws_watchdog_package as package
from test_aws_control import NOW, Provider, plan


class Clock:
    def __init__(self):
        self.now = NOW
        self.sleeps = []

    def time(self):
        return self.now

    def sleep(self, delay):
        self.sleeps.append(delay)
        self.now += delay


class Store:
    def __init__(self, enrollment):
        self.value, self.objects, self.fail_evidence = enrollment, {}, False

    def enrollment(self):
        if self.value is None:
            raise ValueError("No enrollment")
        return copy.deepcopy(self.value)

    def write(self, key, value):
        if self.fail_evidence and key.startswith("evidence/"):
            raise RuntimeError("Fixture storage outage")
        self.objects[key] = copy.deepcopy(value)
        return control.digest(value)


def fixture(root, suffix="A"):
    region = "us-east-1" if suffix == "A" else "us-west-2"
    p = {**plan(root), "accountId": package.ACCOUNT, "operatorRoleArn": "arn:aws:iam::971290362335:role/GoalSpecResearch"}
    role = f"arn:aws:iam::{package.ACCOUNT}:role/GoalSpecWatchdog{suffix}"
    settings = {"plan": p, "planHash": control.deployment_hash(p), "controllerId": "goalspec-watchdog-" + suffix.lower(), "hostRegion": region,
                "roleArn": role, "functionArn": f"arn:aws:lambda:{region}:{package.ACCOUNT}:function:goalspec-watchdog-{suffix.lower()}",
                "coverageStartsAt": NOW - 60, "coverageEndsAt": NOW + 10 * 3600, "codeManifestSha256": "c" * 64}
    enrollment = {"profile": control.PROFILE, "provider": "aws", "planHash": settings["planHash"], "controllerId": settings["controllerId"],
                  "accountId": package.ACCOUNT, "region": "us-east-1", "hostId": settings["functionArn"], "failureDomain": "aws-region:" + region,
                  "terminationRecoveryTestPassed": True, "recoveryEvidenceSha256": "b" * 64, "recoveryEvidenceKind": "live_provider_recovery", "verifiedAt": NOW,
                  "recoveryVerifiedAt": NOW, "codeManifestSha256": settings["codeManifestSha256"],
                  "coverageStartsAt": settings["coverageStartsAt"], "coverageEndsAt": settings["coverageEndsAt"]}
    provider = Provider(p)
    provider.data[("sts", "get-caller-identity")] = {"Account": package.ACCOUNT,
        "Arn": f"arn:aws:sts::{package.ACCOUNT}:assumed-role/GoalSpecWatchdog{suffix}/fixture"}
    return settings, enrollment, provider


class ServerlessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="goalspec-serverless-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.settings, self.enrollment, self.provider = fixture(self.root)
        self.store, self.clock, self.logs = Store(self.enrollment), Clock(), []

    def run_once(self, **kwargs):
        return serverless.run_invocation(self.settings, self.provider, self.store, request_id="fixture-request",
            clock=self.clock.time, sleep=self.clock.sleep, log=self.logs.append, **kwargs)

    def expired_instance(self):
        lease = {"id": "11111111-1111-4111-8111-111111111111", "clientToken": "fixture-token", "deadline": int(NOW + 3600), "setupDeadline": int(NOW)}
        self.provider.rows = [{"InstanceId": "i-0123456789abcdef0", "InstanceType": self.settings["plan"]["instanceType"],
            "ImageId": self.settings["plan"]["imageId"], "SubnetId": self.settings["plan"]["subnetId"], "State": {"Name": "running"},
            "Tags": [{"Key": key, "Value": value} for key, value in control.tags(self.settings["plan"], lease).items()]}]

    def test_three_bounded_polls_publish_only_verified_recent_evidence(self):
        result = self.run_once()
        self.assertEqual(len(result["polls"]), 3)
        self.assertEqual(result["heartbeatsPublished"], 3)
        self.assertEqual(self.clock.sleeps, [30, 30])
        receipt = self.store.objects["heartbeat.json"]
        self.assertEqual(receipt["scheduleCadenceSeconds"], 60)
        self.assertEqual(receipt["internalPollOffsetsSeconds"], [0, 30, 60])
        self.assertFalse(receipt["deliveryGuaranteed"])
        self.assertEqual(receipt["heartbeatAt"], NOW + 60)
        self.assertIn("evidence/fixture-request/invocation.json", self.store.objects)

    def test_missing_or_fabricated_enrollment_never_stops_emergency_cleanup(self):
        for enrollment in (None, {**self.enrollment, "recoveryEvidenceKind": "offline_fixture"}):
            self.store = Store(enrollment)
            self.clock = Clock()
            self.expired_instance()
            result = self.run_once()
            self.assertEqual(self.provider.rows[0]["State"]["Name"], "terminated")
            self.assertEqual(result["heartbeatsPublished"], 0)
            self.assertNotIn("heartbeat.json", self.store.objects)
            self.assertTrue(result["failures"])
            self.assertIn("evidence/fixture-request/poll-0.json", self.store.objects)
            self.assertFalse(self.store.objects["armed.json"]["terminationRecoveryTestPassed"])

    def test_stable_recovery_proof_keeps_publishing_after_five_minutes(self):
        self.clock.now += 301
        result = self.run_once()
        self.assertEqual(result["heartbeatsPublished"], 3)
        self.assertEqual(self.store.objects["heartbeat.json"]["recoveryVerifiedAt"], NOW)
        self.assertEqual(self.store.objects["heartbeat.json"]["verifiedAt"], NOW)
        self.assertEqual(self.store.objects["heartbeat.json"]["heartbeatAt"], NOW + 361)

    def test_changed_code_or_coverage_rejects_old_recovery_but_keeps_cleanup(self):
        for changes in ({"codeManifestSha256": "d" * 64}, {"coverageEndsAt": NOW + 11 * 3600}, {"coverageStartsAt": NOW - 120}):
            self.clock = Clock()
            self.store = Store(self.enrollment)
            self.expired_instance()
            settings = {**self.settings, **changes}
            result = serverless.run_invocation(settings, self.provider, self.store, request_id="changed-deployment", clock=self.clock.time,
                                               sleep=self.clock.sleep, log=lambda _value: None)
            self.assertEqual(result["heartbeatsPublished"], 0)
            self.assertEqual(self.provider.rows[0]["State"]["Name"], "terminated")
            self.assertEqual(self.store.objects["armed.json"]["codeManifestSha256"], settings["codeManifestSha256"])

    def test_unenrolled_healthy_pair_can_arm_canary_but_cannot_launch_experiment(self):
        paths = []
        for suffix in ("A", "B"):
            settings, _enrollment, provider = fixture(self.root, suffix)
            store, clock = Store(None), Clock()
            serverless.run_invocation(settings, provider, store, request_id="arming-" + suffix, clock=clock.time,
                                      sleep=clock.sleep, log=lambda _value: None)
            path = self.root / f"armed-{suffix}.json"
            control.write_new(path, store.objects["armed.json"])
            paths.append(path)
        self.assertEqual(len(control.watchdog_receipts(paths, self.settings["plan"], NOW + 60, NOW + 360, bootstrap=True)), 2)
        with self.assertRaises(ValueError):
            control.watchdog_receipts(paths, self.settings["plan"], NOW + 60, NOW + 360)

    def test_unconfirmed_termination_preserves_failure_and_never_renews_heartbeat(self):
        self.expired_instance()
        self.provider.terminate_immediately = False
        self.store.objects["heartbeat.json"] = {"heartbeatAt": NOW - 1000}
        result = self.run_once()
        self.assertEqual(result["heartbeatsPublished"], 0)
        self.assertEqual(self.store.objects["heartbeat.json"]["heartbeatAt"], NOW - 1000)
        self.assertTrue(all(not self.store.objects[f"evidence/fixture-request/poll-{i}.json"]["healthy"] for i in range(3)))

    def test_s3_failure_retains_log_evidence_and_never_publishes_heartbeat(self):
        self.store.fail_evidence = True
        result = self.run_once()
        self.assertEqual(result["heartbeatsPublished"], 0)
        self.assertGreaterEqual(len(self.logs), 3)
        self.assertIn("durable_evidence_export_failed", json.dumps(result))

    def test_wrong_identity_or_expired_window_rejected_before_provider_calls(self):
        for changed in ({"planHash": "0" * 64}, {"hostRegion": "eu-west-1"}, {"coverageEndsAt": NOW - 1},
                        {"functionArn": "arn:aws:lambda:us-east-1:999999999999:function:goalspec-watchdog-a"}):
            settings = {**self.settings, **changed}
            with self.assertRaises(ValueError):
                serverless.run_invocation(settings, self.provider, self.store, request_id="fixture", clock=self.clock.time, sleep=self.clock.sleep)
        self.assertEqual(self.provider.calls, [])

    def test_runtime_budget_never_sleeps_past_remaining_execution(self):
        result = self.run_once(remaining=lambda: 35)
        self.assertEqual(result["polls"], [])
        self.assertEqual(self.clock.sleeps, [])
        self.assertTrue(result["failures"])

    def test_serverless_pair_is_accepted_only_with_session_coverage(self):
        paths = []
        for suffix in ("A", "B"):
            settings, enrollment, provider = fixture(self.root, suffix)
            store, clock = Store(enrollment), Clock()
            serverless.run_invocation(settings, provider, store, request_id="fixture-" + suffix, clock=clock.time, sleep=clock.sleep, log=lambda _x: None)
            path = self.root / f"{suffix}.json"
            control.write_new(path, store.objects["heartbeat.json"])
            paths.append(path)
        self.assertEqual(len(control.watchdog_receipts(paths, self.settings["plan"], NOW + 60, NOW + 8 * 3600)), 2)
        receipt = control.read_json(paths[1])
        receipt["coverageEndsAt"] = NOW + 8 * 3600
        control.atomic_json(paths[1], receipt)
        with self.assertRaisesRegex(ValueError, "coverage"):
            control.watchdog_receipts(paths, self.settings["plan"], NOW + 60, NOW + 8 * 3600)

    def test_sdk_adapter_normalizes_dates_audits_and_denies_extra_operations(self):
        class Client:
            def describe_instances(self, **_kwargs):
                return {"Reservations": [], "ObservedAt": datetime(2026, 11, 6, tzinfo=timezone.utc)}
        transport = serverless.BotoTransport({"ec2": Client()}, clock=self.clock.time)
        result = transport.call("ec2", "describe-instances", {})
        self.assertIsInstance(result["ObservedAt"], str)
        self.assertTrue(transport.audit[0]["ok"])
        with self.assertRaisesRegex(ValueError, "denied"):
            transport.call("ec2", "run-instances", {})

    def test_s3_store_pins_owner_encrypts_and_bounds_enrollment(self):
        class Storage:
            def __init__(self):
                self.calls = []
            def get_object(self, **kwargs):
                self.calls.append(kwargs)
                return {"Body": io.BytesIO(b'{"operator":true}')}
            def put_object(self, **kwargs):
                self.calls.append(kwargs)
                return {}
        client = Storage()
        store = serverless.S3Evidence(client, "fixture-private-bucket", package.ACCOUNT)
        self.assertEqual(store.enrollment(), {"operator": True})
        store.write("evidence/fixture.json", {"healthy": False})
        self.assertTrue(all(call["ExpectedBucketOwner"] == package.ACCOUNT for call in client.calls))
        self.assertEqual(client.calls[-1]["ServerSideEncryption"], "AES256")
        self.assertEqual(client.calls[-1]["IfNoneMatch"], "*")

    def test_package_is_deterministic_pinned_and_disabled_with_costs_unestimated(self):
        first = package.build(self.settings["plan"], self.root / "one", "2026-11-06T00:00:00Z", "2026-11-06T12:00:00Z")
        second = package.build(self.settings["plan"], self.root / "two", "2026-11-06T00:00:00Z", "2026-11-06T12:00:00Z")
        self.assertEqual(first["zipSha256"], second["zipSha256"])
        self.assertFalse(first["deployed"])
        self.assertIsNone(first["grossCostEstimateUsd"])
        self.assertTrue(first["costEstimateRequiredBeforeDeploymentOrActivation"])
        with ZipFile(self.root / "one" / "goalspec-watchdog.zip") as bundle:
            manifest_bytes = bundle.read("watchdog-code-manifest.json")
            self.assertEqual(hashlib.sha256(manifest_bytes).hexdigest(), first["codeManifestSha256"])
            manifest = json.loads(manifest_bytes)
            self.assertEqual(set(manifest["files"]), serverless.CODE_FILES)
            for name, value in manifest["files"].items():
                self.assertEqual(hashlib.sha256(bundle.read(name)).hexdigest(), value)

    def test_templates_have_separate_regions_roles_storage_failure_queues_and_scoped_permissions(self):
        package.build(self.settings["plan"], self.root / "package", "2026-11-06T00:00:00Z", "2026-11-06T12:00:00Z")
        for suffix, region in (("a", "us-east-1"), ("b", "us-west-2")):
            template = control.read_json(self.root / "package" / f"watchdog-{suffix}.template.json")
            resources = template["Resources"]
            self.assertEqual(template["Parameters"]["ScheduleState"]["Default"], "DISABLED")
            self.assertEqual(resources["Schedule"]["Properties"]["ScheduleExpression"], "rate(1 minute)")
            self.assertIn("EndDate", resources["Schedule"]["Properties"])
            self.assertEqual(resources["InvocationFailures"]["Properties"]["MaximumRetryAttempts"], 0)
            self.assertEqual(resources["EvidenceBucket"]["Properties"]["VersioningConfiguration"]["Status"], "Enabled")
            self.assertEqual(resources["EvidenceBucket"]["DeletionPolicy"], "Retain")
            permissions = resources["WatchdogRole"]["Properties"]["Policies"][0]["PolicyDocument"]
            encoded = json.dumps(permissions)
            for denied in ("RunInstances", "CreateTags", "iam:PassRole", "s3:Delete", "s3:List"):
                self.assertNotIn(denied, encoded)
            self.assertIn("ec2:ResourceTag/GoalSpecPlanHash", encoded)
            self.assertIn(region, resources["WatchdogFunction"]["Properties"]["Environment"]["Variables"]["GOALSPEC_WATCHDOG_SETTINGS"])
            trust = resources["ScheduleRole"]["Properties"]["AssumeRolePolicyDocument"]
            self.assertEqual(trust["Statement"][0]["Condition"]["ArnEquals"]["aws:SourceArn"], {"Fn::GetAtt": ["ScheduleGroup", "Arn"]})


if __name__ == "__main__":
    unittest.main()
