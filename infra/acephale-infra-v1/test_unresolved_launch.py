"""A failed launch stays funded and independently fenced before replacement."""
import copy
import io
import json
import unittest
from unittest.mock import patch

import lambda_watchdog_deploy as deployment
import test_control as original_tests
import unresolved_launch as fences

control = original_tests.control


def seal(value):
    value["contentHash"] = control.digest({k: v for k, v in value.items() if k != "contentHash"})
    return value


class FenceTests(unittest.TestCase):
    tearDown = original_tests.ControlTests.tearDown

    def setUp(self):
        original_tests.ControlTests.setUp(self)
        original_tests.ControlTests.prepare(self)
        enrollment = control.read_json(self.watchdog)
        for index, row in enumerate(enrollment["controllers"], 1):
            name = "acephale-old-fence-" + str(index)
            row["hostId"] = row["hostId"].rsplit(":", 1)[0] + ":" + name
            row["controllerId"] = name
        control.atomic_json(self.watchdog, enrollment)
        self.client.fail_launch = True
        with self.assertRaises(RuntimeError):
            control.launch(self.client, self.ledger, self.prepared["id"], self.watchdog, now=self.now, budget=self.budget)
        self.client.fail_launch = False
        self.prior = copy.deepcopy(control.read_json(self.ledger)["leases"][0])
        self.now += 200
        self.prepared = None
        self.proof = self.make_proof()
        self.proof_path = self.root / "fence.json"
        control.write_new(self.proof_path, self.proof)

    def make_proof(self):
        ledger = control.read_json(self.ledger)
        previous = self.prior
        rows = []
        for original in previous["watchdogs"]:
            enrollment = copy.deepcopy(original)
            host, name = enrollment["hostId"], enrollment["controllerId"]
            region, account = host.split(":")[3:5]
            state = {"version": 1, "profile": control.PROFILE, "planHash": ledger["planHash"],
                "leaseId": previous["id"], "expectedName": previous["name"], "instanceId": None, "status": "reserved",
                **{k: previous[k] for k in ("reservedAt", "deadline", "setupDeadline", "ready")},
                "ownerHeartbeatAt": previous["reservedAt"], "ownerHeartbeatTimeoutSeconds": 120}
            enrollment["verifiedAt"] = self.now
            enrollment["observed"] = {"leaseId": previous["id"], "expectedName": previous["name"], "instanceId": None,
                "observedAt": self.now, "observedStatus": "absent", "terminationRequested": False, "terminationVerified": False,
                "readOnlyProbeSucceeded": True, "reason": "owner_heartbeat_expired", "stateHash": control.digest(state)}
            rule_arn = f"arn:aws:events:{region}:{account}:rule/{name}"
            rows.append({"enrollment": enrollment, "state": state, "deploymentId": "acephale-old-fence",
                "stack": {"StackId": f"arn:aws:cloudformation:{region}:{account}:stack/{name}/" + "a" * 36,
                    "StackName": name, "StackStatus": "CREATE_COMPLETE", "Tags": [{"Key": "AcephaleDeployment", "Value": "acephale-old-fence"}],
                    "Outputs": [{"OutputKey": "FunctionArn", "OutputValue": host}]},
                "schedule": {"Name": name, "Arn": rule_arn, "State": "ENABLED", "ScheduleExpression": "rate(1 minute)"},
                "targets": [{"Id": "cleanup", "Arn": host}],
                "function": {"FunctionArn": host, "State": "Active", "LastUpdateStatus": "Successful"},
                "reservedConcurrency": None,
                "invokePermission": {"Effect": "Allow", "Action": "lambda:InvokeFunction", "Resource": host,
                    "Principal": {"Service": "events.amazonaws.com"}, "Condition": {"ArnLike": {"AWS:SourceArn": rule_arn}}}})
        return seal({"version": 1, "profile": fences.PROFILE, "planHash": ledger["planHash"],
            "financialBindingHash": control._financial_binding_hash(ledger), "financialBindingChanged": False,
            "predecessorReservationRetained": True,
            "predecessor": {"id": previous["id"], "name": previous["name"], "leaseHash": control.digest(previous)},
            "observedAt": self.now, "expiresAt": self.now + 120, "controllers": rows})

    def prepare_replacement(self, **kwargs):
        self.prepared = control.prepare_lease(self.client, self.ledger, .1, 0, now=self.now, budget=self.budget,
                                              unresolved_fence=self.proof_path, **kwargs)
        original_tests.ControlTests.prepare(self)
        return self.prepared

    def test_replacement_keeps_unknown_cost_and_uses_new_controllers(self):
        lease = self.prepare_replacement()
        launched = control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget,
                                  unresolved_fence=self.proof_path)
        ledger = control.read_json(self.ledger)
        self.assertEqual(ledger["leases"][0], self.prior)
        self.assertEqual(launched["status"], "active")
        self.assertEqual(launched["unresolvedPredecessor"]["launchFence"], self.proof)
        self.assertGreater(sum(row["reservedUsd"] for row in ledger["leases"]), self.prior["reservedUsd"])

    def test_canary_still_needs_explicit_old_fence_and_new_controllers(self):
        lease = self.prepare_replacement(purpose="cleanup_canary", recovery_controller_id="acephale-new-controller")
        launched = control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget,
                                  unresolved_fence=self.proof_path)
        self.assertEqual(launched["purpose"], "cleanup_canary")
        self.assertEqual(control.read_json(self.ledger)["leases"][0], self.prior)

    def test_missing_fence_does_not_reserve(self):
        before = self.ledger.read_bytes()
        with self.assertRaises(ValueError):
            control.prepare_lease(self.client, self.ledger, .1, 0, now=self.now, budget=self.budget)
        self.assertEqual(before, self.ledger.read_bytes())

    def test_each_actual_fence_requirement_rejects_resealed_tampering(self):
        mutations = [
            lambda p: p.update(expiresAt=self.now + 121),
            lambda p: p.update(observedAt=self.now - 121),
            lambda p: p["predecessor"].update(leaseHash="f" * 64),
            lambda p: p["controllers"][0]["schedule"].update(State="DISABLED"),
            lambda p: p["controllers"][0]["targets"][0].update(Arn="other"),
            lambda p: p["controllers"][0]["function"].update(State="Pending"),
            lambda p: p["controllers"][0].update(reservedConcurrency=0),
            lambda p: p["controllers"][0]["invokePermission"].update(Condition={}),
            lambda p: p["controllers"][0]["stack"].update(Tags=[]),
            lambda p: p["controllers"][0]["state"].update(ownerHeartbeatAt=self.now),
            lambda p: p["controllers"][0]["enrollment"]["observed"].update(terminationVerified=True),
            lambda p: p["controllers"][0]["enrollment"]["observed"].update(stateHash="f" * 64),
            lambda p: p["controllers"].__setitem__(1, copy.deepcopy(p["controllers"][0])),
        ]
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index):
                value = copy.deepcopy(self.proof)
                mutation(value)
                with self.assertRaises(ValueError):
                    fences.checked_fence(control.read_json(self.ledger), seal(value), self.now)

    def test_launch_needs_fresh_proof_and_dedicated_new_controllers(self):
        lease = self.prepare_replacement()
        before = self.ledger.read_bytes()
        with self.assertRaises(ValueError):
            control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget)
        with self.assertRaises(ValueError):
            control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now + 121, budget=self.budget,
                           unresolved_fence=self.proof_path)
        enrolled = control.read_json(self.watchdog)
        enrolled["controllers"][0].update({key: self.prior["watchdogs"][0][key] for key in ("controllerId", "hostId")})
        control.atomic_json(self.watchdog, enrolled)
        with self.assertRaisesRegex(ValueError, "two new controllers"):
            control.launch(self.client, self.ledger, lease["id"], self.watchdog, now=self.now, budget=self.budget,
                           unresolved_fence=self.proof_path)
        self.assertEqual(before, self.ledger.read_bytes())

    def test_full_old_reservation_still_counts_and_other_unresolved_work_rejects(self):
        ledger = control.read_json(self.ledger)
        quote = control.quote(self.client, self.plan["region"], self.now, self.plan["hardwareProfile"])
        ledger["priorInfraUsd"] = 24
        proof = copy.deepcopy(self.proof)
        proof["financialBindingHash"] = control._financial_binding_hash(ledger)
        with self.assertRaisesRegex(ValueError, "allocation"):
            control.reserve_lease(ledger, quote, 2, 0, self.now, unresolved_fence=seal(proof))
        ledger = control.read_json(self.ledger)
        ledger["leases"].append({**self.prior, "id": "second"})
        with self.assertRaisesRegex(ValueError, "Exactly one"):
            fences.checked_fence(ledger, self.proof, self.now)

    def test_publish_cannot_overwrite_absent_unresolved_name(self):
        lease = self.prepare_replacement()
        class S3:
            def get_object(self, **kwargs):
                return {"Body": io.BytesIO(json.dumps(self_state).encode())}
            def put_object(self, **kwargs):
                raise AssertionError("Old fence overwritten")
        self_state = self.proof["controllers"][0]["state"]
        class Session:
            def client(self, kind):
                return S3()
        with patch.object(deployment, "checked_receipt", return_value={"config": {}, "controllers": [{"region": "us-east-1", "bucket": "old"}]}), \
                patch.object(deployment, "session", return_value=Session()), \
                self.assertRaisesRegex(ValueError, "unresolved controller"):
            deployment.publish(self.root / "unused", self.ledger, lease["id"])

    def test_late_arrival_is_terminated_without_touching_replacement(self):
        state = self.proof["controllers"][0]["state"]
        owned = {"id": "late-old", "name": self.prior["name"], "status": "active"}
        replacement = {"id": "replacement", "name": "acephale-infra-other", "status": "active"}
        class Provider:
            def __init__(self):
                self.items, self.terminated = [owned, replacement], []
            def request(self, method, path, body=None):
                if method == "GET":
                    return {"data": self.items}
                self.terminated.extend(body["instance_ids"])
                self.items = [row for row in self.items if row["id"] not in body["instance_ids"]]
                return {"data": {"terminated_instances": [owned]}}
        provider = Provider()
        result = fences.watchdog.tick(state, provider, self.now)
        self.assertEqual(provider.terminated, ["late-old"])
        self.assertEqual(provider.items, [replacement])
        self.assertTrue(result["terminationVerified"])
        self.assertEqual(control.read_json(self.ledger)["leases"][0], self.prior)


if __name__ == "__main__":
    unittest.main()
