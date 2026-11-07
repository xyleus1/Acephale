"""Offline IAM/network artifact checks. No IAM policy simulator or AWS calls."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import aws_bootstrap as bootstrap
from test_aws_control import plan


class BootstrapTests(unittest.TestCase):
    def test_bootstrap_never_grants_compute_or_creates_access_keys(self):
        artifacts = bootstrap.bootstrap()
        user = artifacts["01-create-user.json"]
        self.assertNotIn("LoginProfile", user)
        trust = json.loads(artifacts["03-create-research-role.json"]["AssumeRolePolicyDocument"])
        self.assertEqual(trust["Statement"][0]["Principal"]["AWS"], bootstrap.USER_ARN)
        readonly = json.loads(artifacts["05-readonly-research-role-policy.json"]["PolicyDocument"])
        self.assertNotIn("ec2:RunInstances", json.dumps(readonly))
        self.assertNotIn("ec2:TerminateInstances", json.dumps(readonly))
        user_policy = json.loads(artifacts["04-user-assume-role-policy.json"]["PolicyDocument"])
        self.assertEqual(user_policy["Statement"][0]["Resource"], bootstrap.ROLE_ARN)
        self.assertEqual(user_policy["Statement"][-1]["Effect"], "Deny")
        self.assertEqual(user_policy["Statement"][-1]["Action"], "iam:CreateAccessKey")
        with self.assertRaises(ValueError):
            bootstrap.trust("arn:aws:iam::971290362335:root")

    def test_network_has_only_public_operator_host_ssh_and_no_compute(self):
        template = bootstrap.network("vpc-0123456789abcdef0", "8.8.8.8/32", "fixture-deployment")
        resources = template["Resources"]
        self.assertEqual(len(resources), 1)
        group = resources["ResearchSecurityGroup"]
        self.assertEqual(group["Type"], "AWS::EC2::SecurityGroup")
        ingress = group["Properties"]["SecurityGroupIngress"]
        self.assertEqual(ingress[0]["CidrIp"], "8.8.8.8/32")
        self.assertEqual((ingress[0]["FromPort"], ingress[0]["ToPort"]), (22, 22))
        for cidr in ("0.0.0.0/0", "8.8.8.0/24", "10.0.0.1/32", "::/0"):
            with self.assertRaises(ValueError):
                bootstrap.network("vpc-0123456789abcdef0", cidr, "fixture-deployment")

    def test_launch_policies_pin_account_type_resources_tags_and_no_instance_role(self):
        p = {**plan(Path("fixture")), "accountId": bootstrap.ACCOUNT, "operatorRoleArn": bootstrap.ROLE_ARN}
        value = bootstrap.launch_policy(p, "key-0123456789abcdef0", "snap-0123456789abcdef0")
        statements = {row["Sid"]: row for row in value["Statement"]}
        instance = statements["LaunchOnlyTaggedG6e"]
        self.assertEqual(instance["Resource"], "arn:aws:ec2:us-east-1:971290362335:instance/*")
        self.assertEqual(instance["Condition"]["StringEquals"]["ec2:InstanceType"], "g6e.2xlarge")
        self.assertEqual(instance["Condition"]["Null"]["ec2:InstanceProfile"], "true")
        self.assertEqual(statements["CreateOnlyEncryptedBoundedGp3"]["Condition"]["Bool"]["ec2:Encrypted"], "true")
        readiness = statements["ChangeOnlyReadinessOnOwnedInstances"]
        self.assertEqual(readiness["Condition"]["ForAllValues:StringEquals"]["aws:TagKeys"], ["AcephaleReady"])
        self.assertNotIn("iam:PassRole", json.dumps([row for row in value["Statement"] if row["Effect"] == "Allow"]))
        self.assertTrue(all(row["Resource"] != "*" for row in value["Statement"] if row["Effect"] == "Allow" and isinstance(row["Action"], str) and row["Action"] in {"ec2:RunInstances", "ec2:TerminateInstances", "ec2:CreateTags"}))

    def test_watchdogs_cannot_launch_retag_or_pass_roles(self):
        p = {**plan(Path("fixture")), "accountId": bootstrap.ACCOUNT, "operatorRoleArn": bootstrap.ROLE_ARN}
        artifacts = bootstrap.watchdog_artifacts(p)
        self.assertEqual(len(artifacts), 4)
        for suffix in ("a", "b"):
            value = json.loads(artifacts[f"watchdog-{suffix}-put-policy.json"]["PolicyDocument"])
            encoded = json.dumps(value)
            self.assertNotIn("RunInstances", encoded)
            self.assertNotIn("CreateTags", encoded)
            self.assertNotIn("PassRole", encoded)
            self.assertIn("AcephalePlanHash", encoded)
        self.assertIn("us-west-2", artifacts["watchdog-b-put-policy.json"]["PolicyDocument"])

    def test_renderer_does_not_overwrite_reviewed_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "new"
            result = bootstrap.emit(output, bootstrap.bootstrap())
            self.assertEqual(result["awsCalls"], 0)
            self.assertFalse(result["deployed"])
            with self.assertRaises(ValueError):
                bootstrap.emit(output, bootstrap.bootstrap())


if __name__ == "__main__":
    unittest.main()
