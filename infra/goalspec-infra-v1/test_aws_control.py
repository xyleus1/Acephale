"""Offline lifecycle tests, using fake account responses and temporary ledgers only."""
from __future__ import annotations

import copy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import aws_control as aws
from test_aws_readiness import fixtures, price_response

NOW = 1793923200.0
LEASE = "11111111-1111-4111-8111-111111111111"


def plan(root):
    return {"profile": "fixture", "accountId": "123456789012", "region": "us-east-1", "instanceType": "g6e.2xlarge",
            "imageId": "ami-0123456789abcdef0", "imageOwnerId": "123456789012", "subnetId": "subnet-0123456789abcdef0",
            "securityGroupId": "sg-0123456789abcdef0", "deploymentId": "fixture-deployment", "keyName": "fixture-key",
            "operatorRoleArn": "arn:aws:iam::123456789012:role/research", "rootVolumeGiB": 100,
            "associatePublicIp": True, "sshCidrs": ["203.0.113.4/32"], "studyCheckpointHash": "a" * 64,
            "studyLedgerPath": str(root / "original.jsonl"), "studyCheckpointPath": str(root / "checkpoint.json"), "exportRoot": str(root / "export"),
            "infrastructureLedgerPath": str(root / "slice.json")}


class Provider:
    def __init__(self, p):
        self.plan, self.data, self.calls, self.rows = p, fixtures(), [], []
        self.data[("sts", "get-caller-identity")]["Arn"] = "arn:aws:sts::123456789012:assumed-role/research/fixture"
        self.data[("pricing", "get-products")] = price_response("1.20")
        self.data[("ec2", "describe-images")] = {"Images": [{"ImageId": p["imageId"], "OwnerId": p["imageOwnerId"],
            "State": "available", "Architecture": "x86_64", "VirtualizationType": "hvm", "RootDeviceType": "ebs",
            "PlatformDetails": "Linux/UNIX", "RootDeviceName": "/dev/sda1", "BlockDeviceMappings": [{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 80}}]}]}
        self.data[("ec2", "describe-subnets")] = {"Subnets": [{"SubnetId": p["subnetId"], "OwnerId": p["accountId"], "VpcId": "vpc-fixture",
            "State": "available", "AvailableIpAddressCount": 100, "AvailabilityZone": "us-east-1a"}]}
        self.data[("ec2", "describe-security-groups")] = {"SecurityGroups": [{"GroupId": p["securityGroupId"], "OwnerId": p["accountId"],
            "VpcId": "vpc-fixture", "IpPermissions": [{"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "203.0.113.4/32"}]}]}]}
        self.data[("ec2", "describe-key-pairs")] = {"KeyPairs": [{"KeyName": p["keyName"]}]}
        self.data[("ec2", "describe-volumes")] = {"Volumes": [{"VolumeId": "vol-0123456789abcdef0", "Encrypted": True, "VolumeType": "gp3", "Size": 100}]}
        self.data[("ec2", "describe-instance-type-offerings")] = {"InstanceTypeOfferings": [{"InstanceType": p["instanceType"], "Location": "us-east-1a", "LocationType": "availability-zone"}]}
        self.unknown_launch = False
        self.unknown_termination = False
        self.terminate_immediately = True

    def call(self, service, operation, payload=None):
        self.calls.append((service, operation, copy.deepcopy(payload)))
        if operation == "run-instances":
            row = {"InstanceId": "i-0123456789abcdef0", "ImageId": payload["ImageId"], "InstanceType": payload["InstanceType"],
                   "SubnetId": payload["NetworkInterfaces"][0]["SubnetId"], "ClientToken": payload["ClientToken"],
                   "SecurityGroups": [{"GroupId": p} for p in payload["NetworkInterfaces"][0]["Groups"]],
                   "BlockDeviceMappings": [{"Ebs": {"VolumeId": "vol-0123456789abcdef0", "DeleteOnTermination": True}}],
                   "Tags": copy.deepcopy(payload["TagSpecifications"][0]["Tags"]), "State": {"Name": "running"}}
            self.rows.append(row)
            if self.unknown_launch:
                raise RuntimeError("Fixture timeout after creation")
            return {"Instances": [copy.deepcopy(row)]}
        if operation == "describe-instances":
            rows = self.rows
            if payload and "InstanceIds" in payload:
                rows = [row for row in rows if row["InstanceId"] in payload["InstanceIds"]]
            if payload and any(item["Name"] == "instance-state-name" for item in payload.get("Filters", [])):
                rows = [row for row in rows if row["State"]["Name"] in {"pending", "running"}]
            return {"Reservations": [{"OwnerId": self.plan["accountId"], "Instances": copy.deepcopy(rows)}]}
        if operation == "terminate-instances":
            if self.terminate_immediately:
                for row in self.rows:
                    if row["InstanceId"] in payload["InstanceIds"]:
                        row["State"]["Name"] = "terminated"
            if self.unknown_termination:
                raise RuntimeError("Fixture terminate timeout")
            return {"TerminatingInstances": []}
        if operation == "create-tags":
            for row in self.rows:
                if row["InstanceId"] in payload["Resources"]:
                    values = {item["Key"]: item["Value"] for item in row["Tags"]}
                    values.update({item["Key"]: item["Value"] for item in payload["Tags"]})
                    row["Tags"] = [{"Key": k, "Value": v} for k, v in values.items()]
            return {}
        return copy.deepcopy(self.data[(service, operation)])


class Budget:
    def __init__(self):
        self.reservations = {}
        self.fail = False

    def __call__(self, _plan, operation, lease=None):
        if operation == "reserve":
            self.reservations[lease["id"]] = lease["reservedMicrodollars"]
            if self.fail:
                raise RuntimeError("Fixture study response lost")
        return {"infrastructureMicrodollars": sum(self.reservations.values()), "checkpointHash": "a" * 64,
                "committedMicrodollars": 1000000 + sum(self.reservations.values())}


class AWSTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="goalspec-aws-tests-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.plan = plan(self.root)
        self.provider, self.budget = Provider(self.plan), Budget()
        self.ledger = self.root / "slice.json"
        aws.init_ledger(self.ledger, self.plan, 0, self.budget)
        self.watchdogs = []
        for i in range(2):
            path = self.root / f"watchdog-{i}.json"
            aws.write_new(path, {"profile": aws.PROFILE, "provider": "aws", "planHash": aws.deployment_hash(self.plan),
                "accountId": self.plan["accountId"], "region": self.plan["region"], "controllerKind": "independent_always_on",
                "discovery": "ec2_tags", "maxPollSeconds": 30, "verifiedAt": NOW, "heartbeatAt": NOW,
                "terminationRecoveryTestPassed": True, "recoveryEvidenceSha256": "b" * 64,
                "controllerId": f"controller-{i}", "hostId": f"host-{i}", "failureDomain": f"domain-{i}"})
            self.watchdogs.append(path)

    def launch(self, **kwargs):
        args = {"hours": 2, "extra_allowance": 2, "now": NOW, "budget": self.budget}
        args.update(kwargs)
        return aws.launch(self.provider, self.ledger, self.plan, LEASE, watchdog_paths=self.watchdogs, **args)

    def lease(self):
        return aws.read_json(self.ledger)["leases"][0]

    def writes(self):
        return [call for call in self.provider.calls if call[:2] in aws.WRITES]

    def test_initialization_uses_original_budget_without_provider_or_overwrite(self):
        self.assertEqual(self.provider.calls, [])
        with self.assertRaises(ValueError):
            aws.init_ledger(self.ledger, self.plan, 0, self.budget)
        with self.assertRaises(ValueError):
            aws.init_ledger(self.root / "bad.json", self.plan, 25, self.budget)

    def test_launch_reserves_both_ledgers_before_exact_one_bounded_request(self):
        original = self.provider.call
        def dispatch(service, operation, payload=None):
            if operation == "run-instances":
                self.assertEqual(self.lease()["status"], "launching")
                self.assertEqual(self.budget.reservations[LEASE], 4400000)
            return original(service, operation, payload)
        self.provider.call = dispatch
        value = self.launch()
        self.assertEqual(value["status"], "launched_unverified")
        writes = self.writes()
        self.assertEqual(len(writes), 1)
        payload = writes[0][2]
        self.assertEqual((payload["MinCount"], payload["MaxCount"]), (1, 1))
        self.assertEqual(payload["ClientToken"], "goalspec-" + LEASE)
        self.assertEqual(payload["BlockDeviceMappings"][0]["Ebs"], {"VolumeSize": 100, "VolumeType": "gp3", "Encrypted": True, "DeleteOnTermination": True})
        self.assertEqual(payload["MetadataOptions"]["HttpTokens"], "required")
        self.assertNotIn("IamInstanceProfile", payload)
        self.assertNotIn("InstanceMarketOptions", payload)
        self.assertNotIn("UserData", payload)
        self.assertEqual(payload["NetworkInterfaces"][0]["Groups"], [self.plan["securityGroupId"]])

    def test_rate_above_authorized_250_cap_blocks_before_reservation_or_mutation(self):
        self.provider.data[("pricing", "get-products")] = price_response("2.5000000001")
        with self.assertRaisesRegex(ValueError, "hourly cap"):
            self.launch()
        self.assertEqual(self.budget.reservations, {})
        self.assertEqual(self.writes(), [])
        self.assertEqual(aws.read_json(self.ledger)["leases"], [])

    def test_current_g6e_rate_and_exact_authorized_cap_pass_only_quote_gate(self):
        for hourly in ("2.24208", "2.50"):
            with self.subTest(hourly=hourly):
                self.provider.data[("pricing", "get-products")] = price_response(hourly)
                quote = aws.quote(self.provider, self.plan, NOW)
                self.assertEqual(quote["hourlyUsd"], hourly)
                self.assertFalse(quote["capacityGuaranteed"])
        self.assertEqual(self.budget.reservations, {})
        self.assertEqual(self.writes(), [])
        self.assertEqual(aws.read_json(self.ledger)["leases"], [])

    def test_wrong_account_or_role_never_dispatches(self):
        for defect in ({"Account": "999999999999"}, {"Arn": "arn:aws:iam::123456789012:root"}):
            original = self.provider.data[("sts", "get-caller-identity")].copy()
            self.provider.data[("sts", "get-caller-identity")].update(defect)
            with self.assertRaisesRegex(ValueError, "mismatch"):
                self.launch()
            self.provider.data[("sts", "get-caller-identity")] = original
        self.assertEqual(self.writes(), [])

    def test_ami_owner_marketplace_and_extra_storage_fail_closed(self):
        for key, value in [("OwnerId", "999999999999"), ("ProductCodes", [{"ProductCodeId": "paid"}]),
                           ("BlockDeviceMappings", [{"DeviceName": "/dev/other", "Ebs": {"VolumeSize": 80}}])]:
            original = copy.deepcopy(self.provider.data[("ec2", "describe-images")])
            self.provider.data[("ec2", "describe-images")]["Images"][0][key] = value
            with self.assertRaises(ValueError):
                self.launch()
            self.provider.data[("ec2", "describe-images")] = original
        self.assertEqual(self.writes(), [])

    def test_security_group_public_services_and_broad_ssh_rejected(self):
        rules = self.provider.data[("ec2", "describe-security-groups")]["SecurityGroups"][0]["IpPermissions"]
        for rule in [{"IpProtocol": "tcp", "FromPort": 8000, "ToPort": 8000, "IpRanges": [{"CidrIp": "203.0.113.4/32"}]},
                     {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]},
                     {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "UserIdGroupPairs": [{"GroupId": "sg-other"}]}]:
            rules.append(rule)
            with self.assertRaises(ValueError):
                self.launch()
            rules.pop()
        self.assertEqual(self.writes(), [])

    def test_gpu_quota_and_incomplete_inventory_rejected(self):
        self.provider.data[("service-quotas", "get-service-quota")]["Quota"]["Value"] = 0
        with self.assertRaisesRegex(ValueError, "headroom"):
            self.launch()
        self.provider.data[("service-quotas", "get-service-quota")]["Quota"]["Value"] = 8
        self.provider.data[("ec2", "describe-instance-types")]["InstanceTypes"][0]["GpuInfo"]["Gpus"][0]["MemoryInfo"]["SizeInMiB"] = 24000
        with self.assertRaisesRegex(ValueError, "hardware"):
            self.launch()
        self.assertEqual(self.writes(), [])

    def test_two_recent_independent_watchdogs_are_mandatory(self):
        path = self.watchdogs[1]
        good = aws.read_json(path)
        for field, value in [("hostId", "host-0"), ("failureDomain", "domain-0"), ("heartbeatAt", NOW - 121),
                             ("verifiedAt", NOW + 1), ("terminationRecoveryTestPassed", False), ("planHash", "f" * 64)]:
            aws.atomic_json(path, {**good, field: value})
            with self.assertRaises(ValueError):
                self.launch()
        self.assertEqual(self.writes(), [])

    def test_unknown_study_reservation_never_launches_or_releases(self):
        self.budget.fail = True
        with self.assertRaises(RuntimeError):
            self.launch()
        self.assertEqual(self.lease()["status"], "reservation_pending")
        self.assertIn(LEASE, self.budget.reservations)
        self.assertEqual(self.writes(), [])
        with self.assertRaisesRegex(ValueError, "already attempted"):
            self.launch()

    def test_lost_launch_response_reconciles_same_token_without_retry(self):
        self.provider.unknown_launch = True
        with self.assertRaises(RuntimeError):
            self.launch()
        self.assertEqual(self.lease()["status"], "launch_unknown")
        with self.assertRaisesRegex(ValueError, "already attempted"):
            self.launch()
        value = aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW + 20)
        self.assertEqual(value["status"], "active")
        evidence = aws.read_json(Path(value["providerEvidencePath"]))
        self.assertEqual(evidence["Reservations"][0]["Instances"][0]["ImageId"], self.plan["imageId"])
        self.assertEqual(len([row for row in self.writes() if row[1] == "run-instances"]), 1)

    def test_missing_or_ambiguous_instance_keeps_unknown_reservation(self):
        self.launch()
        original = self.provider.rows
        for rows in ([], original * 2):
            self.provider.rows = rows
            with self.assertRaisesRegex(ValueError, "Unresolved"):
                aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW)
            self.assertIn(LEASE, self.budget.reservations)

    def test_provider_identity_change_cannot_terminate_other_instance(self):
        self.launch()
        self.provider.rows[0]["ClientToken"] = "other-token"
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            aws.terminate(self.provider, self.ledger, self.plan, LEASE, emergency=True, now=NOW)
        self.assertEqual(len(self.writes()), 1)

    def test_normal_cleanup_requires_real_matching_export_hashes(self):
        self.launch()
        root = Path(self.plan["exportRoot"])
        root.mkdir()
        file = root / "trace.jsonl"
        file.write_text('{"fixture":true}\n', encoding="utf-8")
        receipt = root / "receipt.json"
        aws.write_new(receipt, {"leaseId": LEASE, "files": [{"path": file.name, "bytes": file.stat().st_size, "sha256": aws.sha256(file)}]})
        file.write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "verification"):
            aws.terminate(self.provider, self.ledger, self.plan, LEASE, receipt, now=NOW)
        self.assertEqual(len(self.writes()), 1)
        aws.atomic_json(receipt, {"leaseId": LEASE, "files": [{"path": file.name, "bytes": file.stat().st_size, "sha256": aws.sha256(file)}]})
        result = aws.terminate(self.provider, self.ledger, self.plan, LEASE, receipt, now=NOW)
        self.assertEqual(result["status"], "terminated")
        self.assertEqual(self.budget.reservations[LEASE], 4400000)

    def test_termination_response_alone_never_proves_termination(self):
        self.launch()
        self.provider.terminate_immediately = False
        result = aws.terminate(self.provider, self.ledger, self.plan, LEASE, emergency=True, now=NOW)
        self.assertEqual(result["status"], "termination_requested")
        self.assertNotIn("terminationVerifiedAt", result)
        self.provider.rows[0]["State"]["Name"] = "terminated"
        result = aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW + 30)
        self.assertEqual(result["status"], "terminated")
        self.assertIn(LEASE, self.budget.reservations)

    def test_uncertain_termination_keeps_reservation_until_provider_read(self):
        self.launch()
        self.provider.unknown_termination = True
        with self.assertRaises(RuntimeError):
            aws.terminate(self.provider, self.ledger, self.plan, LEASE, emergency=True, now=NOW)
        self.assertEqual(self.lease()["status"], "termination_requested")
        self.assertIn(LEASE, self.budget.reservations)
        self.assertEqual(aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW + 30)["status"], "terminated")

    def test_independent_watchdog_uses_provider_tags_without_local_ledger(self):
        self.launch()
        self.ledger.unlink()
        role = self.plan["operatorRoleArn"]
        self.assertEqual(aws.watchdog_tick(self.provider, self.plan, role, NOW + 1799), [])
        results = aws.watchdog_tick(self.provider, self.plan, role, NOW + 1800)
        self.assertTrue(results[0]["terminationVerified"])
        self.assertIn(LEASE, self.budget.reservations)

    def test_ready_tag_extends_only_to_original_session_deadline(self):
        self.launch()
        smoke = self.root / "smoke.json"
        aws.write_new(smoke, {"profile": aws.PROFILE, "leaseId": LEASE, "instanceId": self.provider.rows[0]["InstanceId"], "passed": True,
            "checks": {key: True for key in ["pinnedImages", "pinnedModels", "driver", "concurrentModels", "toolParsing", "telemetry", "export", "watchdogRecovery"]}})
        aws.mark_ready(self.provider, self.ledger, self.plan, LEASE, smoke, NOW + 600)
        self.assertEqual(aws.watchdog_tick(self.provider, self.plan, self.plan["operatorRoleArn"], NOW + 1800), [])
        self.assertTrue(aws.watchdog_tick(self.provider, self.plan, self.plan["operatorRoleArn"], NOW + 7200)[0]["terminationVerified"])

    def test_short_sessions_expire_before_setup_window(self):
        self.launch(hours=0.25)
        self.assertEqual(self.lease()["setupDeadline"], self.lease()["deadline"])
        self.assertTrue(aws.watchdog_tick(self.provider, self.plan, self.plan["operatorRoleArn"], NOW + 900)[0]["terminationVerified"])

    def test_bad_historical_row_does_not_block_independent_active_cleanup(self):
        self.launch()
        self.provider.rows.insert(0, {"InstanceId": "i-00000000000000000", "State": {"Name": "terminated"}})
        self.provider.rows.insert(1, {"InstanceId": "i-00000000000000001", "State": {"Name": "running"}})
        results = aws.watchdog_tick(self.provider, self.plan, self.plan["operatorRoleArn"], NOW + 1800)
        self.assertEqual(len(results), 2)
        self.assertIn("error", results[0])
        self.assertTrue(results[1]["terminationVerified"])

    def test_limits_cannot_be_reset_by_sessions_or_changed_configuration(self):
        for field, value in [("priorGpuHours", 23), ("priorInfrastructureMicrodollars", 34000000)]:
            original = aws.read_json(self.ledger)
            aws.atomic_json(self.ledger, {**original, field: value})
            with self.assertRaises(ValueError):
                self.launch()
            aws.atomic_json(self.ledger, original)
        with self.assertRaisesRegex(ValueError, "Session"):
            self.launch(hours=8.1)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            aws.checked_ledger(self.ledger, {**self.plan, "region": "us-west-2"})
        self.assertEqual(self.writes(), [])

    def test_external_watchdog_paths_do_not_change_deployment_identity(self):
        other = {**self.plan, "profile": "other", "studyLedgerPath": "/external/original.jsonl", "exportRoot": "/other/export"}
        self.assertEqual(aws.deployment_hash(self.plan), aws.deployment_hash(other))
        self.assertNotEqual(aws.deployment_hash(self.plan), aws.deployment_hash({**other, "accountId": "999999999999"}))

    def test_cli_transport_uses_exact_profile_region_no_retry_and_redacts_error(self):
        client = aws.AwsClient(self.plan)
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"PriceList":[]}', "")) as run:
            client.call("pricing", "get-products", {"ServiceCode": "AmazonEC2"})
        args, kwargs = run.call_args
        command = args[0]
        self.assertEqual(command[command.index("--profile") + 1], "fixture")
        self.assertEqual(command[command.index("--region") + 1], "us-east-1")
        self.assertEqual(kwargs["env"]["AWS_MAX_ATTEMPTS"], "1")
        self.assertFalse(kwargs["shell"])
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "PRIVATE FAILURE TOKEN")), self.assertRaisesRegex(RuntimeError, "output omitted") as error:
            client.call("ec2", "run-instances", {})
        self.assertNotIn("PRIVATE", str(error.exception))

    def test_configuration_requires_real_explicit_pins_and_narrow_cidrs(self):
        path = self.root / "config.json"
        aws.write_new(path, self.plan)
        self.assertEqual(aws.config(path)["imageId"], self.plan["imageId"])
        for field, value in [("imageId", "latest"), ("instanceType", "g6e.xlarge"), ("sshCidrs", ["0.0.0.0/0"]), ("rootVolumeGiB", True)]:
            aws.atomic_json(path, {**self.plan, field: value})
            with self.assertRaises(ValueError):
                aws.config(path)


if __name__ == "__main__":
    unittest.main()
