"""Render reviewable IAM/network payloads locally. Never calls AWS or reads credentials."""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
from pathlib import Path

from aws_control import PROFILE, config, deployment_hash, require, write_new

ACCOUNT = "971290362335"
REGION = "us-east-1"
USER = "goalspec-operator"
ROLE = "GoalSpecResearch"
USER_ARN = f"arn:aws:iam::{ACCOUNT}:user/{USER}"
ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/{ROLE}"
POLICY_VERSION = "2012-10-17"


def policy(statements):
    return {"Version": POLICY_VERSION, "Statement": statements}


def statement(sid, actions, resources, condition=None, effect="Allow"):
    row = {"Sid": sid, "Effect": effect, "Action": actions, "Resource": resources}
    if condition:
        row["Condition"] = condition
    return row


def ec2(resource):
    return f"arn:aws:ec2:{REGION}:{ACCOUNT}:{resource}"


def reads():
    actions = ["DescribeInstances", "DescribeInstanceTypes", "DescribeInstanceTypeOfferings", "DescribeImages",
               "DescribeSecurityGroups", "DescribeSubnets", "DescribeKeyPairs", "DescribeVolumes", "DescribeVpcs",
               "DescribeRouteTables", "DescribeInternetGateways", "DescribeNetworkInterfaces"]
    return [
        statement("ReadOnlyRegionalEc2Evidence", ["ec2:" + name for name in actions], "*", {"StringEquals": {"aws:RequestedRegion": REGION}}),
        statement("CallerIdentity", "sts:GetCallerIdentity", "*"),
        statement("ReadCurrentPublicPrice", "pricing:GetProducts", "*", {"StringEquals": {"aws:RequestedRegion": "us-east-1"}}),
        statement("ReadOnlyGpuQuota", "servicequotas:GetServiceQuota", f"arn:aws:servicequotas:{REGION}:{ACCOUNT}:ec2/L-DB2E81BA"),
        statement("NoInstanceCredentialsOrRoleDelegation", ["iam:PassRole", "ec2:AssociateIamInstanceProfile", "ec2:ReplaceIamInstanceProfileAssociation"], "*", effect="Deny"),
    ]


def trust(principal):
    require(re.fullmatch(r"arn:aws:iam::\d{12}:(?:user|role)/[A-Za-z0-9+=,.@_/-]+", principal), "An explicit non-root IAM user/role ARN is required")
    return policy([{"Effect": "Allow", "Principal": {"AWS": principal}, "Action": "sts:AssumeRole"}])


def bootstrap():
    # Passwords and login-profile secrets are deliberately absent. Configure the
    # console password/MFA interactively, then aws login manages temporary tokens.
    return {
        "01-create-user.json": {"UserName": USER, "Tags": [{"Key": "GoalSpecProfile", "Value": PROFILE}]},
        "02-attach-signin-policy.json": {"UserName": USER, "PolicyArn": "arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess"},
        "03-create-research-role.json": {"RoleName": ROLE, "AssumeRolePolicyDocument": json.dumps(trust(USER_ARN)),
            "MaxSessionDuration": 3600, "Description": "GoalSpec research, temporary operator access, no instance role", "Tags": [{"Key": "GoalSpecProfile", "Value": PROFILE}]},
        "04-user-assume-role-policy.json": {"UserName": USER, "PolicyName": "GoalSpecResearchOnly", "PolicyDocument": json.dumps(policy([
            statement("AssumeOnlyResearchRole", "sts:AssumeRole", ROLE_ARN),
            statement("ChangeOnlyOwnConsolePassword", "iam:ChangePassword", USER_ARN),
            statement("ReadPasswordPolicy", "iam:GetAccountPasswordPolicy", "*"),
            statement("NoLongLivedAccessKeys", "iam:CreateAccessKey", "*", effect="Deny"),
        ]))},
        "05-readonly-research-role-policy.json": {"RoleName": ROLE, "PolicyName": "GoalSpecReadiness", "PolicyDocument": json.dumps(policy(reads()))},
        "temporary-profile.config": "[profile goalspec-runtime]\nrole_arn = " + ROLE_ARN + "\nsource_profile = goalspec-operator\nregion = us-east-1\nduration_seconds = 3600\nrole_session_name = goalspec-research\n",
    }


def network(vpc_id, cidr, deployment_id):
    require(re.fullmatch(r"vpc-[a-f0-9]{8,17}", vpc_id), "Actual VPC ID required")
    address = ipaddress.ip_network(cidr, strict=True)
    require(address.version == 4 and address.prefixlen == 32 and address.network_address.is_global, "Actual public operator IPv4 /32 required")
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]{7,48}", deployment_id), "Deployment identity required")
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "GoalSpec SSH-only security group. No compute or paid network service.",
        "Conditions": {"IntendedAccountAndRegion": {"Fn::And": [{"Fn::Equals": [{"Ref": "AWS::AccountId"}, ACCOUNT]},
                                                                {"Fn::Equals": [{"Ref": "AWS::Region"}, REGION]}]}},
        "Resources": {"ResearchSecurityGroup": {"Type": "AWS::EC2::SecurityGroup", "Condition": "IntendedAccountAndRegion", "Properties": {
            "GroupDescription": "GoalSpec research, SSH only from the verified operator address", "VpcId": vpc_id,
            "SecurityGroupIngress": [{"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "CidrIp": str(address), "Description": "Verified operator SSH"}],
            "SecurityGroupEgress": [{"IpProtocol": "tcp", "FromPort": port, "ToPort": port, "CidrIp": "0.0.0.0/0", "Description": "Model/container/package downloads"} for port in (80, 443)],
            "Tags": [{"Key": "GoalSpecProfile", "Value": PROFILE}, {"Key": "GoalSpecDeployment", "Value": deployment_id}]
        }}}, "Outputs": {"SecurityGroupId": {"Condition": "IntendedAccountAndRegion", "Value": {"Fn::GetAtt": ["ResearchSecurityGroup", "GroupId"]}}}}


def scope(plan, *, request=False):
    prefix = "aws:RequestTag/" if request else "ec2:ResourceTag/"
    return {prefix + "GoalSpecProfile": PROFILE, prefix + "GoalSpecDeployment": plan["deploymentId"], prefix + "GoalSpecPlanHash": deployment_hash(plan)}


def launch_policy(plan, key_pair_id, root_snapshot_id):
    require(plan["accountId"] == ACCOUNT and plan["region"] == REGION and plan["operatorRoleArn"] == ROLE_ARN, "Pinned account/region/research role mismatch")
    require(re.fullmatch(r"key-[a-f0-9]{8,17}", key_pair_id), "Observed key-pair ID required")
    require(re.fullmatch(r"snap-[a-f0-9]{8,17}", root_snapshot_id), "Observed pinned AMI root snapshot required")
    created = scope(plan, request=True)
    mandatory = ["GoalSpecLease", "GoalSpecDeadline", "GoalSpecSetupDeadline"]
    tag_keys = ["GoalSpecProfile", "GoalSpecDeployment", "GoalSpecPlanHash", *mandatory, "GoalSpecReady", "Name",
                "GoalSpecPurpose", "GoalSpecRecoveryController", "GoalSpecCanaryStopAt"]
    rows = reads() + [
        statement("UseOnlyPinnedAmi", "ec2:RunInstances", f"arn:aws:ec2:{REGION}::image/{plan['imageId']}", {
            "StringEquals": {"ec2:Owner": plan["imageOwnerId"], "ec2:RootDeviceType": "ebs"}}),
        statement("UseOnlyPinnedExistingResources", "ec2:RunInstances", [ec2("subnet/" + plan["subnetId"]),
            ec2("security-group/" + plan["securityGroupId"]), ec2("key-pair/" + key_pair_id), f"arn:aws:ec2:{REGION}::snapshot/{root_snapshot_id}"]),
        statement("CreateNetworkInterfaceInPinnedSubnet", "ec2:RunInstances", ec2("network-interface/*"), {
            "ArnEquals": {"ec2:Subnet": ec2("subnet/" + plan["subnetId"])}}),
        statement("LaunchOnlyTaggedG6e", "ec2:RunInstances", ec2("instance/*"), {
            "StringEquals": {**created, "aws:RequestTag/GoalSpecReady": "false", "ec2:InstanceType": "g6e.2xlarge", "ec2:Tenancy": "default",
                             "ec2:MetadataHttpTokens": "required", "ec2:InstanceMarketType": "on-demand"},
            "Null": {"ec2:InstanceProfile": "true", **{"aws:RequestTag/" + key: "false" for key in mandatory}}}),
        statement("CreateOnlyEncryptedBoundedGp3", "ec2:RunInstances", ec2("volume/*"), {
            "StringEquals": {**created, "ec2:VolumeType": "gp3"}, "Bool": {"ec2:Encrypted": "true"},
            "NumericLessThanEquals": {"ec2:VolumeSize": plan["rootVolumeGiB"]},
            "NumericLessThanEqualsIfExists": {"ec2:VolumeIops": 3000, "ec2:VolumeThroughput": 125}}),
        statement("TagOnlyAtApprovedLaunch", "ec2:CreateTags", [ec2("instance/*"), ec2("volume/*")], {
            "StringEquals": {**created, "ec2:CreateAction": "RunInstances"}, "ForAllValues:StringEquals": {"aws:TagKeys": tag_keys}}),
        statement("ChangeOnlyReadinessOnOwnedInstances", "ec2:CreateTags", ec2("instance/*"), {
            "StringEquals": {**scope(plan), "aws:RequestTag/GoalSpecReady": "true"},
            "StringNotEquals": {"ec2:ResourceTag/GoalSpecPurpose": "watchdog_recovery_canary"},
            "ForAllValues:StringEquals": {"aws:TagKeys": ["GoalSpecReady"]}, "Null": {"aws:RequestTag/GoalSpecReady": "false"}}),
        statement("TerminateOnlyOwnedG6e", "ec2:TerminateInstances", ec2("instance/*"), {
            "StringEquals": {**scope(plan), "ec2:InstanceType": "g6e.2xlarge"}}),
    ]
    return policy(rows)


def watchdog_artifacts(plan):
    require(plan["accountId"] == ACCOUNT and plan["region"] == REGION, "Pinned account and region required")
    output = {}
    for suffix, host_region in (("A", "us-east-1"), ("B", "us-west-2")):
        name = "GoalSpecWatchdog" + suffix
        function = "goalspec-watchdog-" + suffix.lower()
        role_trust = policy([{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}])
        statements = [
            statement("VerifyCaller", "sts:GetCallerIdentity", "*"),
            statement("DiscoverResearchDeadlines", "ec2:DescribeInstances", "*", {"StringEquals": {"aws:RequestedRegion": REGION}}),
            statement("TerminateOnlyOwnedResearchGpu", "ec2:TerminateInstances", ec2("instance/*"), {
                "StringEquals": {**scope(plan), "ec2:InstanceType": "g6e.2xlarge"}}),
            statement("WriteOnlyOwnPrecreatedLogGroup", ["logs:CreateLogStream", "logs:PutLogEvents"],
                f"arn:aws:logs:{host_region}:{ACCOUNT}:log-group:/aws/lambda/{function}:*"),
        ]
        output[f"watchdog-{suffix.lower()}-create-role.json"] = {"RoleName": name, "AssumeRolePolicyDocument": json.dumps(role_trust),
            "Description": f"GoalSpec independent watchdog {suffix}, Lambda execution in {host_region}", "MaxSessionDuration": 3600}
        output[f"watchdog-{suffix.lower()}-put-policy.json"] = {"RoleName": name, "PolicyName": "GoalSpecTerminationOnly", "PolicyDocument": json.dumps(policy(statements))}
    return output


def emit(directory, artifacts):
    require(not directory.exists(), "Use a new output directory; generated artifacts are never overwritten")
    directory.mkdir(parents=True)
    for name, value in artifacts.items():
        path = directory / name
        if isinstance(value, str):
            with path.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(value)
        else:
            write_new(path, value)
    return {"output": str(directory.resolve()), "files": sorted(artifacts), "awsCalls": 0, "deployed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    initial = commands.add_parser("identity")
    initial.add_argument("--output", type=Path, required=True)
    net = commands.add_parser("network")
    net.add_argument("--vpc-id", required=True)
    net.add_argument("--operator-cidr", required=True)
    net.add_argument("--deployment-id", required=True)
    net.add_argument("--output", type=Path, required=True)
    launch = commands.add_parser("policies")
    launch.add_argument("--config", type=Path, required=True)
    launch.add_argument("--key-pair-id", required=True)
    launch.add_argument("--root-snapshot-id", required=True)
    launch.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "identity":
        artifacts = bootstrap()
    elif args.command == "network":
        artifacts = {"research-security-group.template.json": network(args.vpc_id, args.operator_cidr, args.deployment_id)}
    else:
        plan = config(args.config.resolve())
        launch = launch_policy(plan, args.key_pair_id, args.root_snapshot_id)
        artifacts = {"research-launch-policy.json": launch,
                     "research-put-launch-policy.json": {"RoleName": ROLE, "PolicyName": "GoalSpecBoundedGpu", "PolicyDocument": json.dumps(launch)},
                     **watchdog_artifacts(plan)}
    print(json.dumps(emit(args.output, artifacts)))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({"error": "Bootstrap rendering failed; check actual pins and use a new output directory", "awsCalls": 0}))
        raise SystemExit(1) from None
