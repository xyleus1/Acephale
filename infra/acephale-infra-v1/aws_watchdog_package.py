"""Build two regional watchdog CloudFormation templates and a deterministic ZIP offline."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from aws_bootstrap import ACCOUNT, REGION, ec2, policy, scope, statement
from aws_control import config, deployment_hash, require, write_new
from aws_serverless_watchdog import CODE_FILES

HERE = Path(__file__).resolve().parent


def utc_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0, "Explicit UTC timestamp required")
    return parsed.timestamp()


def private_bucket():
    return {"Type": "AWS::S3::Bucket", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
        "PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True, "RestrictPublicBuckets": True},
        "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
        "VersioningConfiguration": {"Status": "Enabled"}, "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}}}


def transport_policy(bucket):
    return {"Type": "AWS::S3::BucketPolicy", "Properties": {"Bucket": {"Ref": bucket}, "PolicyDocument": policy([
        {"Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": [{"Fn::GetAtt": [bucket, "Arn"]},
          {"Fn::Join": ["", [{"Fn::GetAtt": [bucket, "Arn"]}, "/*"]]}], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}])}}


def artifact_template():
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Private versioned watchdog code artifacts, no compute.",
            "Resources": {"CodeBucket": private_bucket(), "CodeBucketTls": transport_policy("CodeBucket")},
            "Outputs": {"CodeBucket": {"Value": {"Ref": "CodeBucket"}}}}


def regional_template(plan, suffix, host_region, starts, ends, code_manifest_hash):
    require(plan["accountId"] == ACCOUNT and plan["region"] == REGION, "Exact target account and region required")
    public_plan = {key: value for key, value in plan.items() if key not in {"profile", "studyLedgerPath", "studyCheckpointPath", "exportRoot", "infrastructureLedgerPath"}}
    plan_hash = deployment_hash(plan)
    function_name = "acephale-watchdog-" + suffix.lower()
    role_name = "AcephaleWatchdog" + suffix
    scheduler_role = role_name + "Schedule"
    settings = {"plan": public_plan, "planHash": plan_hash, "controllerId": function_name, "hostRegion": host_region,
                "roleArn": f"arn:aws:iam::{ACCOUNT}:role/{role_name}", "coverageStartsAt": starts, "coverageEndsAt": ends,
                "codeManifestSha256": code_manifest_hash}
    settings_json = json.dumps(settings, separators=(",", ":"))
    require(len(settings_json.encode()) < 3400, "Watchdog settings exceed bounded environment budget")
    bucket_arn = {"Fn::GetAtt": ["EvidenceBucket", "Arn"]}
    object_arn = lambda key: {"Fn::Join": ["", [bucket_arn, "/" + key]]}
    role_permissions = [
        statement("Identity", "sts:GetCallerIdentity", "*"),
        statement("DiscoverTargetInstances", "ec2:DescribeInstances", "*", {"StringEquals": {"aws:RequestedRegion": REGION}}),
        statement("TerminateOnlyThisResearchDeployment", "ec2:TerminateInstances", ec2("instance/*"), {
            "StringEquals": {**scope(plan), "ec2:InstanceType": "g6e.2xlarge"}}),
        statement("ReadOperatorEnrollmentOnly", "s3:GetObject", object_arn("enrollment.json")),
        statement("WriteEvidenceAndHeartbeatOnly", "s3:PutObject", [object_arn("evidence/*"), object_arn("heartbeat.json"), object_arn("armed.json")]),
        statement("WriteOwnLogs", ["logs:CreateLogStream", "logs:PutLogEvents"], {"Fn::GetAtt": ["WatchdogLogs", "Arn"]}),
        statement("RetainInvocationFailures", "sqs:SendMessage", {"Fn::GetAtt": ["FailureQueue", "Arn"]}),
    ]
    resources = {
        "EvidenceBucket": private_bucket(), "EvidenceBucketTls": transport_policy("EvidenceBucket"),
        "FailureQueue": {"Type": "AWS::SQS::Queue", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
            "SqsManagedSseEnabled": True, "MessageRetentionPeriod": 1209600}},
        "WatchdogLogs": {"Type": "AWS::Logs::LogGroup", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain",
                         "Properties": {"LogGroupName": "/aws/lambda/" + function_name, "RetentionInDays": 30}},
        "WatchdogRole": {"Type": "AWS::IAM::Role", "Properties": {"RoleName": role_name,
            "AssumeRolePolicyDocument": policy([{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]),
            "Policies": [{"PolicyName": "AcephaleTerminationAndEvidence", "PolicyDocument": policy(role_permissions)}]}},
        "WatchdogFunction": {"Type": "AWS::Lambda::Function", "Properties": {"FunctionName": function_name,
            "Role": {"Fn::GetAtt": ["WatchdogRole", "Arn"]}, "Runtime": "python3.12", "Architectures": ["x86_64"],
            "Handler": "aws_serverless_watchdog.handler", "MemorySize": 128, "Timeout": 120,
            "Code": {"S3Bucket": {"Ref": "CodeBucket"}, "S3Key": {"Ref": "CodeObjectKey"}, "S3ObjectVersion": {"Ref": "CodeObjectVersion"}},
            "Environment": {"Variables": {"ACEPHALE_WATCHDOG_SETTINGS": settings_json, "ACEPHALE_EVIDENCE_BUCKET": {"Ref": "EvidenceBucket"}}}}},
        "InvocationFailures": {"Type": "AWS::Lambda::EventInvokeConfig", "Properties": {
            "FunctionName": {"Ref": "WatchdogFunction"}, "Qualifier": "$LATEST", "MaximumEventAgeInSeconds": 60, "MaximumRetryAttempts": 0,
            "DestinationConfig": {"OnFailure": {"Destination": {"Fn::GetAtt": ["FailureQueue", "Arn"]}}}}},
        "ScheduleGroup": {"Type": "AWS::Scheduler::ScheduleGroup", "Properties": {"Name": function_name + "-" + plan_hash[:12]}},
        "ScheduleRole": {"Type": "AWS::IAM::Role", "Properties": {"RoleName": scheduler_role,
            "AssumeRolePolicyDocument": policy([{"Effect": "Allow", "Principal": {"Service": "scheduler.amazonaws.com"}, "Action": "sts:AssumeRole",
                "Condition": {"StringEquals": {"aws:SourceAccount": ACCOUNT}, "ArnEquals": {"aws:SourceArn": {"Fn::GetAtt": ["ScheduleGroup", "Arn"]}}}}]),
            "Policies": [{"PolicyName": "InvokeOnlyOwnWatchdog", "PolicyDocument": policy([
                statement("InvokeWatchdog", "lambda:InvokeFunction", {"Fn::GetAtt": ["WatchdogFunction", "Arn"]}),
                statement("RetainSchedulerFailures", "sqs:SendMessage", {"Fn::GetAtt": ["FailureQueue", "Arn"]})])}]}},
        "Schedule": {"Type": "AWS::Scheduler::Schedule", "DependsOn": "InvocationFailures", "Properties": {
            "Name": function_name, "GroupName": {"Ref": "ScheduleGroup"}, "ScheduleExpression": "rate(1 minute)", "ScheduleExpressionTimezone": "UTC",
            "StartDate": datetime.fromtimestamp(starts, timezone.utc).isoformat(), "EndDate": datetime.fromtimestamp(ends, timezone.utc).isoformat(),
            "FlexibleTimeWindow": {"Mode": "OFF"}, "State": {"Ref": "ScheduleState"},
            "Target": {"Arn": {"Fn::GetAtt": ["WatchdogFunction", "Arn"]}, "RoleArn": {"Fn::GetAtt": ["ScheduleRole", "Arn"]},
                       "Input": json.dumps({"planHash": plan_hash}), "RetryPolicy": {"MaximumEventAgeInSeconds": 60, "MaximumRetryAttempts": 0},
                       "DeadLetterConfig": {"Arn": {"Fn::GetAtt": ["FailureQueue", "Arn"]}}}}},
    }
    # Wrong-account/region deployments create no resources; expected outputs must
    # be checked before the actual schedules can be armed.
    for resource in resources.values():
        resource["Condition"] = "IntendedAccountAndRegion"
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Independent Acephale watchdog, disabled until budget and live verification.",
        "Parameters": {"CodeBucket": {"Type": "String"}, "CodeObjectKey": {"Type": "String", "Default": "acephale-watchdog.zip"},
                       "CodeObjectVersion": {"Type": "String", "MinLength": 1},
                       "ScheduleState": {"Type": "String", "Default": "DISABLED", "AllowedValues": ["DISABLED", "ENABLED"]}},
        "Conditions": {"IntendedAccountAndRegion": {"Fn::And": [{"Fn::Equals": [{"Ref": "AWS::AccountId"}, ACCOUNT]},
                                                                 {"Fn::Equals": [{"Ref": "AWS::Region"}, host_region]}]}},
        "Resources": resources,
        "Outputs": {key: {"Condition": "IntendedAccountAndRegion", "Value": value} for key, value in {
            "FunctionArn": {"Fn::GetAtt": ["WatchdogFunction", "Arn"]}, "EvidenceBucket": {"Ref": "EvidenceBucket"},
            "FailureQueueUrl": {"Ref": "FailureQueue"}, "ScheduleArn": {"Fn::GetAtt": ["Schedule", "Arn"]},
            "PlanHash": plan_hash, "CodeManifestSha256": code_manifest_hash}.items()}}


def build(plan, output, start, end):
    require(not output.exists(), "Use a new output directory")
    starts, ends = utc_time(start), utc_time(end)
    require(0 < ends - starts <= 24 * 3600, "Schedule coverage must be positive and at most 24 hours")
    require(plan["accountId"] == ACCOUNT and plan["region"] == REGION, "Exact account and target region required")
    files = {name: (HERE / name).read_bytes() for name in sorted(CODE_FILES)}
    manifest = {"schemaVersion": 1, "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
    files["watchdog-code-manifest.json"] = manifest_bytes
    output.mkdir(parents=True)
    archive = output / "acephale-watchdog.zip"
    with ZipFile(archive, "x", compression=ZIP_DEFLATED) as bundle:
        for name, data in sorted(files.items()):
            item = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            item.external_attr = 0o644 << 16
            item.compress_type = ZIP_DEFLATED
            bundle.writestr(item, data)
    archive_hash = hashlib.sha256(archive.read_bytes()).digest()
    write_new(output / "watchdog-artifacts.template.json", artifact_template())
    for suffix, region in (("A", "us-east-1"), ("B", "us-west-2")):
        write_new(output / f"watchdog-{suffix.lower()}.template.json", regional_template(plan, suffix, region, starts, ends, manifest_hash))
    invocations = 2 * (math.ceil((ends - starts) / 60) + 2)
    report = {"schemaVersion": 1, "planHash": deployment_hash(plan), "codeManifestSha256": manifest_hash,
              "zipSha256": archive_hash.hex(), "lambdaCodeSha256Base64": base64.b64encode(archive_hash).decode(), "zipBytes": archive.stat().st_size,
              "coverageStartsAt": starts, "coverageEndsAt": ends, "scheduleState": "DISABLED", "awsCalls": 0, "deployed": False,
              "costEstimateRequiredBeforeDeploymentOrActivation": True, "grossCostEstimateUsd": None,
              "workloadUpperBounds": {"scheduledInvocationsAcrossBothRegions": invocations,
                  "lambdaGiBSecondsAtFullTimeout": invocations * 120 * 0.125, "s3PutRequests": invocations * 10,
                  "s3GetRequests": invocations, "pollAttempts": invocations * 3, "sqsFailureMessages": invocations * 2},
              "notIncludedInWorkloadBound": ["manual invocations", "at-least-once duplicate delivery", "logs bytes", "retained versioned storage", "artifact uploads", "transfer", "tax"],
              "note": "These workload bounds assume each scheduled occurrence is delivered once. Price both regions at current gross rates and reserve overhead in the original infrastructure ledger."}
    write_new(output / "package.json", report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start-at", required=True)
    parser.add_argument("--end-at", required=True)
    args = parser.parse_args(argv)
    print(json.dumps(build(config(args.config.resolve()), args.output, args.start_at, args.end_at)))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError):
        print(json.dumps({"error": "Watchdog package preparation failed; no AWS calls were made"}))
        raise SystemExit(1) from None
