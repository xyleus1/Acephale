"""Offline exact-ownership, provider-race and deployed-handler evidence tests."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import zipfile
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

    class Conditional(Exception):
        def __init__(self, status=412):
            self.response = {"ResponseMetadata": {"HTTPStatusCode": status}, "Error": {
                "Code": "PreconditionFailed" if status == 412 else "ConditionalRequestConflict"}}

    def __init__(self, state):
        self.objects = {"state.json": json.dumps(state).encode()} if state else {}
        self.exceptions = SimpleNamespace(NoSuchKey=self.Missing)

    def get_object(self, **kwargs):
        if kwargs["Key"] not in self.objects:
            raise self.Missing()
        data = self.objects[kwargs["Key"]]
        return {"Body": io.BytesIO(data), "ETag": '"' + hashlib.sha256(data).hexdigest() + '"'}

    def put_object(self, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and kwargs["Key"] in self.objects:
            raise self.Conditional()
        if kwargs.get("IfMatch") and (kwargs["Key"] not in self.objects or self.get_object(Key=kwargs["Key"])["ETag"] != kwargs["IfMatch"]):
            raise self.Conditional()
        self.objects[kwargs["Key"]] = kwargs["Body"]
        return {"ETag": self.get_object(Key=kwargs["Key"])["ETag"]}


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
        context = SimpleNamespace(invoked_function_arn="arn:aws:lambda:us-east-2:123456789012:function:acephale-test-1", aws_request_id=request,
                                  get_remaining_time_in_millis=lambda: 45000)
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

    def test_acknowledged_termination_survives_followup_observation_failure(self):
        state, client = lease(), Provider(lease(), asynchronous=True)
        s3 = S3(state)
        original = client.request
        def failed_verification(method, path, payload=None):
            if method == "GET" and client.instance["status"] == "terminating":
                raise RuntimeError("read-only status request timed out")
            return original(method, path, payload)
        with patch.object(client, "request", side_effect=failed_verification):
            with self.assertRaises(RuntimeError):
                self.invoke(s3, client)
        pending = json.loads(s3.objects["pending/" + state["leaseId"] + ".json"])
        self.assertTrue(pending["terminationRequested"])
        self.assertFalse(pending["terminationVerified"])
        self.assertNotIn("recovery.json", s3.objects)
        client.instance["status"] = "terminated"
        result = self.invoke(s3, client, "recovered")
        self.assertTrue(result["recoveryTestPassed"])

    def test_malformed_success_response_is_not_termination_acknowledgment(self):
        for response in (None, [], {}, {"error": "failed"}, {"data": {"terminated_instances": []}},
                         {"data": {"terminated_instances": [{"id": "other-instance"}]}},
                         {"data": {"terminated_instances": [{"id": "instance1", "name": "other-owner"}]}}):
            state, client = lease(), Provider(lease())
            original = client.request
            client.request = lambda method, path, payload=None: response if method == "POST" else original(method, path, payload)
            acknowledgments = []
            with self.assertRaisesRegex(ValueError, "acknowledgment"):
                watchdog.tick(state, client, 1201, on_termination_ack=acknowledgments.append)
            self.assertEqual(acknowledgments, [])

    def test_template_has_scoped_secret_and_storage_and_minute_schedule(self):
        value = deployment.template("acephale-test-1", "private-bucket", "arn:secret:test", "a" * 64)
        resources = value["Resources"]
        self.assertEqual(resources["Schedule"]["Properties"]["ScheduleExpression"], "rate(1 minute)")
        statements = resources["Role"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        self.assertEqual(statements[0]["Resource"], "arn:secret:test")
        self.assertFalse(any(row["Resource"] == "*" for row in statements))
        self.assertNotIn("ReservedConcurrentExecutions", resources["Function"]["Properties"])
        self.assertEqual(resources["Function"]["Properties"]["Timeout"], 45)
        for action in ("s3:GetObject", "s3:PutObject"):
            row = next(value for value in statements if value["Action"] == action)
            self.assertIn("arn:aws:s3:::private-bucket/controller-lock.json", row["Resource"])
        self.assertEqual(deployment.package_bytes(), deployment.package_bytes())
        with zipfile.ZipFile(io.BytesIO(deployment.package_bytes())) as archive:
            item = archive.getinfo("lambda_gpu_watchdog.py")
            self.assertEqual(item.create_system, 3)
            self.assertEqual(item.external_attr >> 16, 0o100644)

    def test_conditional_lock_serializes_invocations_and_releases_only_own_etag(self):
        s3 = S3(None)
        first = watchdog.ControllerLock.acquire(s3, "bucket", "one", 1000)
        self.assertIsNotNone(first)
        self.assertIsNone(watchdog.ControllerLock.acquire(s3, "bucket", "two", 1059))
        second = watchdog.ControllerLock.acquire(s3, "bucket", "two", 1060)
        self.assertIsNotNone(second)
        first.release()
        with patch.object(watchdog.time, "time", return_value=1061):
            second.check()
            with self.assertRaisesRegex(ValueError, "expired"):
                first.check()
        self.assertEqual(json.loads(s3.objects[watchdog.LOCK_KEY])["owner"], "two")
        second.release()
        self.assertIsNotNone(watchdog.ControllerLock.acquire(s3, "bucket", "three", 1061))

    def test_stale_lock_reclaim_loses_etag_race_without_overwriting_new_owner(self):
        s3 = S3(None)
        watchdog.ControllerLock.acquire(s3, "bucket", "old", 1000)
        original = s3.put_object
        def raced(**kwargs):
            if "IfMatch" in kwargs:
                s3.objects[watchdog.LOCK_KEY] = json.dumps({"version": 1, "owner": "winner", "acquiredAt": 1061, "expiresAt": 1121}).encode()
            return original(**kwargs)
        with patch.object(s3, "put_object", side_effect=raced):
            self.assertIsNone(watchdog.ControllerLock.acquire(s3, "bucket", "loser", 1061))
        self.assertEqual(json.loads(s3.objects[watchdog.LOCK_KEY])["owner"], "winner")

    def test_conditional_conflict_and_unknown_error_never_admit_unlocked_work(self):
        s3 = S3(None)
        with patch.object(s3, "put_object", side_effect=S3.Conditional(409)):
            self.assertIsNone(watchdog.ControllerLock.acquire(s3, "bucket", "one", 1000))
        with patch.object(s3, "put_object", side_effect=RuntimeError("unavailable")):
            with self.assertRaises(RuntimeError):
                watchdog.ControllerLock.acquire(s3, "bucket", "one", 1000)

    def test_busy_handler_makes_no_provider_calls_or_enrollment(self):
        s3, client = S3(lease()), Provider(lease())
        watchdog.ControllerLock.acquire(s3, "private-bucket", "scheduled-invocation", 1200)
        result = self.invoke(s3, client)
        self.assertEqual(result["status"], "busy")
        self.assertEqual(client.calls, [])
        self.assertNotIn("enrollment.json", s3.objects)

    def test_fresh_heartbeat_before_termination_cancels_stale_cleanup(self):
        state, client = lease(), Provider(lease())
        with patch.object(watchdog.time, "time", return_value=1201):
            result = watchdog.tick(state, client, 1201, refresh_state=lambda: {**state, "ownerHeartbeatAt": 1201})
        self.assertFalse(result["terminationRequested"])
        self.assertEqual([call[0] for call in client.calls], ["GET"])

    def test_enrollment_busy_retries_are_bounded_and_never_fabricate_success(self):
        arn, code = "arn:test", "a" * 64
        busy = {"status": "busy", "hostId": arn, "codeSha256": code}
        ready = {"hostId": arn, "codeSha256": code, "readOnlyProbeSucceeded": True}
        responses = [busy, ready]
        client = SimpleNamespace(invoke=lambda **_: {"Payload": io.BytesIO(json.dumps(responses.pop(0)).encode())})
        sleeps = []
        self.assertEqual(deployment.invoke_enrollment(client, arn, code, sleeper=sleeps.append), ready)
        self.assertEqual(sleeps, [10])
        client.invoke = lambda **_: {"Payload": io.BytesIO(json.dumps(busy).encode())}
        sleeps.clear()
        with self.assertRaisesRegex(ValueError, "busy"):
            deployment.invoke_enrollment(client, arn, code, sleeper=sleeps.append)
        self.assertEqual(sleeps, [10] * 6)


if __name__ == "__main__":
    unittest.main()
