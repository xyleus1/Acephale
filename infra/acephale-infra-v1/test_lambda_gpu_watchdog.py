"""Offline exact-ownership, provider-race and deployed-handler evidence tests."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import lambda_gpu_watchdog as watchdog
import lambda_watchdog_deploy as deployment


def lease():
    identifier = "11111111-1111-4111-8111-111111111111"
    return {"version": 1, "profile": watchdog.PROFILE, "leaseId": identifier, "expectedName": "acephale-infra-" + identifier,
            "instanceId": "instance1", "planHash": "a" * 64, "status": "active", "reservedAt": 1000, "setupDeadline": 2800,
            "deadline": 8200, "ready": False, "ownerHeartbeatAt": 1050, "ownerHeartbeatTimeoutSeconds": 120}


class Provider:
    def __init__(self, state, status="active", asynchronous=False):
        self.instance = {"id": state["instanceId"], "name": state["expectedName"], "status": status}
        self.calls, self.asynchronous = [], asynchronous

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET":
            return {"data": [self.instance] if self.instance else []}
        if payload != {"instance_ids": [self.instance["id"]]}:
            raise AssertionError("Wrong termination target")
        self.instance["status"] = "terminating" if self.asynchronous else "terminated"
        return {"data": {"terminated_instances": [self.instance]}}


class S3:
    class Missing(Exception):
        pass

    def __init__(self, state):
        self.objects = {"state.json": json.dumps(state).encode()} if state else {}
        self.exceptions = SimpleNamespace(NoSuchKey=self.Missing)

    def get_object(self, **kwargs):
        if kwargs["Key"] not in self.objects:
            raise self.Missing()
        return {"Body": io.BytesIO(self.objects[kwargs["Key"]])}

    def put_object(self, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and kwargs["Key"] in self.objects:
            raise ValueError("Immutable receipt collision")
        self.objects[kwargs["Key"]] = kwargs["Body"]


class WatchdogTests(unittest.TestCase):
    def test_healthy_poll_does_not_mutate(self):
        state, client = lease(), Provider(lease())
        result = watchdog.tick(state, client, 1100)
        self.assertFalse(result["terminationRequested"])
        self.assertEqual([call[0] for call in client.calls], ["GET"])

    def test_setup_deadline_and_owner_loss_terminate_exact_registered_instance(self):
        for now in (1201, 2801, 8201):
            state, client = lease(), Provider(lease())
            result = watchdog.tick(state, client, now)
            self.assertTrue(result["terminationVerified"])
            self.assertEqual(client.calls[1][2], {"instance_ids": ["instance1"]})

    def test_ready_still_obeys_heartbeat_and_hard_deadline(self):
        state = {**lease(), "ready": True, "ownerHeartbeatAt": 2800}
        self.assertFalse(watchdog.tick(state, Provider(state), 2801)["terminationRequested"])
        self.assertEqual(watchdog.tick(state, Provider(state), 8200)["reason"], "lease_deadline")

    def test_ownership_and_ambiguous_matches_fail_closed(self):
        state = lease()
        for items in ([{"id": "other", "name": state["expectedName"]}],
                      [{"id": "instance1", "name": "somebody-else"}],
                      [{"id": "instance1", "name": state["expectedName"]}] * 2):
            with self.assertRaises(ValueError):
                watchdog.select_instance(state, items)

    def test_asynchronous_termination_does_not_launch_duplicate_stop(self):
        state, client = lease(), Provider(lease(), asynchronous=True)
        self.assertFalse(watchdog.tick(state, client, 1201)["terminationVerified"])
        self.assertFalse(watchdog.tick(state, client, 1202)["terminationRequested"])
        self.assertEqual(len([call for call in client.calls if call[0] == "POST"]), 1)

    def test_canary_targets_one_controller_but_backup_enforces_deadline(self):
        state = {**lease(), "purpose": "cleanup_canary", "recoveryControllerId": "acephale-test-1", "setupDeadline": 1600, "deadline": 1600}
        self.assertFalse(watchdog.tick(state, Provider(state), 1201, "acephale-test-2")["terminationRequested"])
        self.assertTrue(watchdog.tick(state, Provider(state), 1201, "acephale-test-1")["terminationVerified"])
        self.assertTrue(watchdog.tick(state, Provider(state), 1601, "acephale-test-2")["terminationVerified"])

    def invoke(self, s3, provider, request="one"):
        code = hashlib.sha256(Path(watchdog.__file__).read_bytes()).hexdigest()
        env = {"STATE_BUCKET": "private-bucket", "STATE_KEY": "state.json", "CODE_SHA256": code,
               "TOKEN_SECRET_ARN": "test-arn", "CONTROLLER_ID": "acephale-test-1"}
        secret = SimpleNamespace(get_secret_value=lambda **_: {"SecretString": "test-only-token"})
        aws = SimpleNamespace(client=lambda name: s3 if name == "s3" else secret)
        context = SimpleNamespace(invoked_function_arn="arn:aws:lambda:us-east-2:123456789012:function:acephale-test-1", aws_request_id=request)
        with patch.dict(os.environ, env), patch.dict("sys.modules", {"boto3": aws}), patch.object(watchdog, "Provider", return_value=provider), patch.object(watchdog.time, "time", return_value=1201):
            return watchdog.handler({}, context)

    def test_absent_state_is_idle_and_healthy_poll_is_not_recovery(self):
        client = Provider(lease())
        self.assertEqual(self.invoke(S3(None), client)["status"], "idle_no_registered_lease")
        self.assertEqual(client.calls, [])
        state = {**lease(), "ownerHeartbeatAt": 1200}
        s3 = S3(state)
        result = self.invoke(s3, client)
        self.assertFalse(result["recoveryTestPassed"])
        self.assertIn(result["evidenceKey"], s3.objects)

    def test_live_termination_receipt_requires_actual_request_and_verification(self):
        state, client = lease(), Provider(lease(), asynchronous=True)
        s3 = S3(state)
        self.assertFalse(self.invoke(s3, client)["recoveryTestPassed"])
        client.instance["status"] = "terminated"
        result = self.invoke(s3, client, "two")
        self.assertTrue(result["recoveryTestPassed"])
        proof = json.loads(s3.objects["recovery.json"])
        self.assertTrue(proof["actualProviderTermination"])
        self.assertEqual(proof["instanceId"], "instance1")

    def test_template_has_scoped_secret_and_storage_and_minute_schedule(self):
        value = deployment.template("acephale-test-1", "private-bucket", "arn:secret:test", "a" * 64)
        resources = value["Resources"]
        self.assertEqual(resources["Schedule"]["Properties"]["ScheduleExpression"], "rate(1 minute)")
        statements = resources["Role"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        self.assertEqual(statements[0]["Resource"], "arn:secret:test")
        self.assertFalse(any(row["Resource"] == "*" for row in statements))
        self.assertEqual(resources["Function"]["Properties"]["ReservedConcurrentExecutions"], 1)
        self.assertEqual(deployment.package_bytes(), deployment.package_bytes())


if __name__ == "__main__":
    unittest.main()
