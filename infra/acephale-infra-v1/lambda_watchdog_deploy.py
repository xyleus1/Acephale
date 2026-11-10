"""Explicit two-region AWS cleanup-controller deployment for Lambda GPU leases.

No provider mutation happens on import. The deploy command reads the already
authorized API token from the process environment and never serializes it locally.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import zipfile

from control import atomic_json, checked_bound_ledger, deployment_source, digest, read_json, sha256, study_budget, watchdog_state, write_new
from lambda_gpu_watchdog import Provider, select_instance

HERE = Path(__file__).resolve().parent


def configuration(path):
    value = read_json(path)
    if (value.get("version") != 1 or not re.fullmatch(r"acephale-[a-z0-9-]{4,35}", value.get("deploymentId", ""))
            or len(value.get("regions", [])) != 2 or len(set(value["regions"])) != 2
            or any(region not in {"us-east-1", "us-east-2", "us-west-2"} for region in value["regions"])
            or not value.get("awsProfile")):
        raise ValueError("Explicit new deployment name, two approved regions and AWS profile required")
    return value


def template(name, bucket, secret_arn, code_hash):
    """All permissions bind to the created bucket, function and token secret."""
    return {"AWSTemplateFormatVersion": "2010-09-09", "Resources": {
        "Logs": {"Type": "AWS::Logs::LogGroup", "Properties": {"LogGroupName": "/aws/lambda/" + name, "RetentionInDays": 3}},
        "Role": {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "exact-lease-cleanup", "PolicyDocument": {"Version": "2012-10-17", "Statement": [
                {"Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": secret_arn},
                {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::" + bucket},
                {"Effect": "Allow", "Action": "s3:GetObject", "Resource": ["arn:aws:s3:::" + bucket + "/state.json", "arn:aws:s3:::" + bucket + "/recovery.json", "arn:aws:s3:::" + bucket + "/pending/*", "arn:aws:s3:::" + bucket + "/controller-lock.json"]},
                {"Effect": "Allow", "Action": "s3:PutObject", "Resource": ["arn:aws:s3:::" + bucket + "/evidence/*", "arn:aws:s3:::" + bucket + "/pending/*", "arn:aws:s3:::" + bucket + "/recovery.json", "arn:aws:s3:::" + bucket + "/enrollment.json", "arn:aws:s3:::" + bucket + "/controller-lock.json"]},
                {"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"], "Resource": {"Fn::Sub": "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/" + name + ":*"}}
            ]}}]}},
        "Function": {"Type": "AWS::Lambda::Function", "DependsOn": "Logs", "Properties": {
            "FunctionName": name, "Role": {"Fn::GetAtt": ["Role", "Arn"]}, "Runtime": "python3.12",
            "Handler": "lambda_gpu_watchdog.handler", "Timeout": 45, "MemorySize": 128,
            "Code": {"S3Bucket": bucket, "S3Key": "package.zip"},
            "Environment": {"Variables": {"STATE_BUCKET": bucket, "STATE_KEY": "state.json", "TOKEN_SECRET_ARN": secret_arn,
                                            "CONTROLLER_ID": name, "CODE_SHA256": code_hash}}}},
        "Schedule": {"Type": "AWS::Events::Rule", "Properties": {"Name": name, "ScheduleExpression": "rate(1 minute)", "State": "ENABLED",
                     "Targets": [{"Id": "cleanup", "Arn": {"Fn::GetAtt": ["Function", "Arn"]}, "RetryPolicy": {"MaximumEventAgeInSeconds": 60, "MaximumRetryAttempts": 0}}]}},
        "InvokePermission": {"Type": "AWS::Lambda::Permission", "Properties": {"FunctionName": {"Ref": "Function"}, "Action": "lambda:InvokeFunction",
                              "Principal": "events.amazonaws.com", "SourceArn": {"Fn::GetAtt": ["Schedule", "Arn"]}}}
    }, "Outputs": {"FunctionArn": {"Value": {"Fn::GetAtt": ["Function", "Arn"]}}}}


def session(config, region):
    import boto3
    return boto3.Session(profile_name=config["awsProfile"], region_name=region)


def package_bytes():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        info = zipfile.ZipInfo("lambda_gpu_watchdog.py", date_time=(2026, 11, 10, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (HERE / "lambda_gpu_watchdog.py").read_bytes())
    return out.getvalue()


def deploy(config_path, receipt_path):
    config = configuration(config_path)
    budget = checked_bound_ledger(Path(config["infrastructureLedgerPath"]))
    source = deployment_source(budget, Path(config["sourceAmendmentPath"]) if config.get("sourceAmendmentPath") else None)
    overhead = next((row for row in budget.get("overheads", []) if row["id"] == config.get("overheadReservationId")), None)
    if not overhead or overhead.get("status") != "reserved" or not overhead.get("studyReservation") or overhead["reservedUsd"] > 5:
        raise ValueError("Funded original-journal overhead reservation within five dollars required")
    study_budget(budget["plan"], "inspect")
    token = os.environ.get("LAMBDA_API_KEY", "").strip()
    if not token:
        raise ValueError("Load LAMBDA_API_KEY securely before deployment")
    archive, code_hash = package_bytes(), sha256(HERE / "lambda_gpu_watchdog.py")
    value = {"version": 1, "config": config, "configHash": digest(config), "createdAt": time.time(),
             "codeSha256": code_hash, "packageSha256": hashlib.sha256(archive).hexdigest(), "sourceProvenance": source, "controllers": []}
    write_new(receipt_path, value)
    for index, region in enumerate(config["regions"]):
        aws = session(config, region)
        account = aws.client("sts").get_caller_identity()["Account"]
        name = config["deploymentId"] + "-" + str(index + 1)
        bucket = name + "-" + account
        row = {"region": region, "account": account, "name": name, "bucket": bucket, "stage": "creating_bucket"}
        value["controllers"].append(row)
        atomic_json(receipt_path, value)
        s3 = aws.client("s3")
        s3.create_bucket(Bucket=bucket, **({"CreateBucketConfiguration": {"LocationConstraint": region}} if region != "us-east-1" else {}))
        row["bucketCreated"] = True
        atomic_json(receipt_path, value)
        s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration={key: True for key in
            ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")})
        s3.put_bucket_encryption(Bucket=bucket, ServerSideEncryptionConfiguration={"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})
        s3.put_bucket_tagging(Bucket=bucket, Tagging={"TagSet": [{"Key": "AcephaleDeployment", "Value": config["deploymentId"]}]})
        s3.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration={"Rules": [{"ID": "bounded-artifact-retention", "Status": "Enabled", "Filter": {"Prefix": ""}, "Expiration": {"Days": 7}}]})
        row["stage"] = "creating_secret"
        atomic_json(receipt_path, value)
        secret = aws.client("secretsmanager").create_secret(Name=name + "-lambda-token", SecretString=token,
            Tags=[{"Key": "AcephaleDeployment", "Value": config["deploymentId"]}])
        row["secretArn"] = secret["ARN"]
        atomic_json(receipt_path, value)
        s3.put_object(Bucket=bucket, Key="package.zip", Body=archive, ServerSideEncryption="AES256")
        cf = aws.client("cloudformation")
        stack = cf.create_stack(StackName=name, TemplateBody=json.dumps(template(name, bucket, secret["ARN"], code_hash)),
            Capabilities=["CAPABILITY_IAM"], Tags=[{"Key": "AcephaleDeployment", "Value": config["deploymentId"]}])
        row.update(stackId=stack["StackId"], stage="creating_stack")
        atomic_json(receipt_path, value)
        cf.get_waiter("stack_create_complete").wait(StackName=stack["StackId"], WaiterConfig={"Delay": 5, "MaxAttempts": 120})
        result = cf.describe_stacks(StackName=stack["StackId"])["Stacks"][0]
        row.update(functionArn=next(r["OutputValue"] for r in result["Outputs"] if r["OutputKey"] == "FunctionArn"), stage="deployed")
        atomic_json(receipt_path, value)
    return {"deploymentReceipt": str(receipt_path), "controllers": len(value["controllers"]), "credentialsPrinted": False}


def checked_receipt(path):
    value = read_json(path)
    if value.get("version") != 1 or value.get("configHash") != digest(value.get("config")):
        raise ValueError("Deployment receipt changed")
    config = value["config"]
    for index, row in enumerate(value["controllers"]):
        expected = config["deploymentId"] + "-" + str(index + 1)
        if row["name"] != expected or row["region"] != config["regions"][index] or row["bucket"] != expected + "-" + row["account"]:
            raise ValueError("Resource does not belong to this deployment")
        prefix = "arn:aws:"
        if (not re.fullmatch(r"\d{12}", row["account"])
                or row.get("secretArn") and not re.fullmatch(re.escape(prefix + "secretsmanager:" + row["region"] + ":" + row["account"] + ":secret:" + expected + "-lambda-token-") + r"[A-Za-z0-9]{6}", row["secretArn"])
                or row.get("stackId") and not re.fullmatch(re.escape(prefix + "cloudformation:" + row["region"] + ":" + row["account"] + ":stack/" + expected + "/") + r"[a-f0-9-]{36}", row["stackId"])
                or row.get("functionArn") and row["functionArn"] != prefix + "lambda:" + row["region"] + ":" + row["account"] + ":function:" + expected):
            raise ValueError("Created resource ARN does not match exact deployment ownership")
    return value


def publish(receipt_path, ledger, lease_id):
    receipt = checked_receipt(receipt_path)
    state = watchdog_state(ledger, lease_id)
    data = json.dumps(state, sort_keys=True, separators=(",", ":")).encode()
    for row in receipt["controllers"]:
        s3 = session(receipt["config"], row["region"]).client("s3")
        try:
            previous = json.loads(s3.get_object(Bucket=row["bucket"], Key="state.json")["Body"].read())
        except s3.exceptions.NoSuchKey:
            previous = None
        if previous and previous["leaseId"] != lease_id:
            existing = select_instance(previous, Provider(os.environ.get("LAMBDA_API_KEY", "")).request("GET", "/instances")["data"])
            if existing and existing.get("status") != "terminated":
                raise ValueError("Cannot replace a live controller lease")
        s3.put_object(Bucket=row["bucket"], Key="state.json", Body=data,
            ContentType="application/json", ServerSideEncryption="AES256", ExpectedBucketOwner=row["account"])
    return {"leaseId": lease_id, "stateHash": digest(state), "ownerHeartbeatAt": state["ownerHeartbeatAt"]}


def invoke_enrollment(client, function_arn, code_hash, *, sleeper=time.sleep):
    for attempt in range(7):
        result = client.invoke(FunctionName=function_arn, InvocationType="RequestResponse", Payload=b"{}")
        value = json.loads(result["Payload"].read())
        if result.get("FunctionError") or value.get("hostId") != function_arn or value.get("codeSha256") != code_hash:
            raise ValueError("Actual controller invocation did not establish healthy enrollment")
        if value.get("status") != "busy":
            return value
        if attempt < 6:
            sleeper(10)
    raise ValueError("Controller remained busy through bounded enrollment retries")


def enroll(receipt_path, output):
    receipt, controllers = checked_receipt(receipt_path), []
    for row in receipt["controllers"]:
        aws = session(receipt["config"], row["region"])
        value = invoke_enrollment(aws.client("lambda"), row["functionArn"], receipt["codeSha256"])
        persisted = json.loads(aws.client("s3").get_object(Bucket=row["bucket"], Key="enrollment.json", ExpectedBucketOwner=row["account"])["Body"].read())
        if persisted != value:
            raise ValueError("Controller enrollment was not durably exported")
        controllers.append(value)
    value = {"version": 1, "controllers": controllers, "deploymentReceiptSha256": sha256(receipt_path)}
    atomic_json(output, value)
    return {"enrollment": str(output), "actualInvocations": len(controllers), "recoveryPassed": [row["recoveryTestPassed"] for row in controllers]}


def export(receipt_path, output):
    receipt = checked_receipt(receipt_path)
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "deployment.json", receipt)
    files = [{"path": "deployment.json", "sha256": sha256(output / "deployment.json"), "bytes": (output / "deployment.json").stat().st_size}]
    for row in receipt["controllers"]:
        if not row.get("bucketCreated"):
            continue
        s3 = session(receipt["config"], row["region"]).client("s3")
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=row["bucket"], ExpectedBucketOwner=row["account"]):
            for item in page.get("Contents", []):
                key = item["Key"]
                target = output / row["name"] / key
                if not target.resolve().is_relative_to(output.resolve()) or "\\" in key:
                    raise ValueError("Unsafe artifact key")
                target.parent.mkdir(parents=True, exist_ok=True)
                data = s3.get_object(Bucket=row["bucket"], Key=key, ExpectedBucketOwner=row["account"])["Body"].read()
                with target.open("xb") as stream:
                    stream.write(data)
                if target.read_bytes() != data:
                    raise ValueError("Artifact verification failed")
                files.append({"path": target.relative_to(output).as_posix(), "sha256": sha256(target), "bytes": len(data)})
    value = {"version": 1, "deploymentReceiptSha256": sha256(receipt_path), "files": files, "verifiedAt": time.time()}
    write_new(output / "export.json", value)
    return {"exportReceipt": str(output / "export.json"), "files": len(files)}


def cleanup(receipt_path, exported):
    receipt, proof = checked_receipt(receipt_path), read_json(exported)
    if proof.get("deploymentReceiptSha256") != sha256(receipt_path) or not proof.get("files"):
        raise ValueError("Verified exported controller artifacts required before cleanup")
    for row in proof["files"]:
        path = exported.parent / row["path"]
        if not path.resolve().is_relative_to(exported.parent.resolve()) or sha256(path) != row["sha256"]:
            raise ValueError("Exported controller artifact changed")
    for row in receipt["controllers"]:
        aws = session(receipt["config"], row["region"])
        s3 = aws.client("s3")
        if row.get("bucketCreated"):
            try:
                state = json.loads(s3.get_object(Bucket=row["bucket"], Key="state.json")["Body"].read())
            except s3.exceptions.NoSuchKey:
                state = None
            if state:
                existing = select_instance(state, Provider(os.environ.get("LAMBDA_API_KEY", "")).request("GET", "/instances")["data"])
                if existing and existing.get("status") != "terminated":
                    raise ValueError("Cleanup controller cannot be deleted while its GPU remains live")
        if row.get("stackId"):
            cf = aws.client("cloudformation")
            cf.delete_stack(StackName=row["stackId"])
            cf.get_waiter("stack_delete_complete").wait(StackName=row["stackId"], WaiterConfig={"Delay": 5, "MaxAttempts": 120})
        if row.get("secretArn"):
            aws.client("secretsmanager").delete_secret(SecretId=row["secretArn"], ForceDeleteWithoutRecovery=True)
        if row.get("bucketCreated"):
            try:
                tags = s3.get_bucket_tagging(Bucket=row["bucket"], ExpectedBucketOwner=row["account"])["TagSet"]
            except Exception as error:
                if getattr(error, "response", {}).get("Error", {}).get("Code") != "NoSuchTagSet" or row["stage"] != "creating_bucket":
                    raise
                tags = [{"Key": "AcephaleDeployment", "Value": receipt["config"]["deploymentId"]}]
            if {"Key": "AcephaleDeployment", "Value": receipt["config"]["deploymentId"]} not in tags:
                raise ValueError("Bucket ownership tag changed; cleanup refused")
            for page in s3.get_paginator("list_objects_v2").paginate(Bucket=row["bucket"], ExpectedBucketOwner=row["account"]):
                if page.get("Contents"):
                    s3.delete_objects(Bucket=row["bucket"], ExpectedBucketOwner=row["account"], Delete={"Objects": [{"Key": item["Key"]} for item in page["Contents"]]})
            s3.delete_bucket(Bucket=row["bucket"], ExpectedBucketOwner=row["account"])
    return {"deletedCreatedControllers": len(receipt["controllers"]), "artifactsVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    deploy_p = sub.add_parser("deploy")
    deploy_p.add_argument("--config", type=Path, required=True)
    deploy_p.add_argument("--receipt", type=Path, required=True)
    for name in ("publish", "heartbeat", "enroll", "export", "cleanup"):
        p = sub.add_parser(name)
        p.add_argument("--receipt", type=Path, required=True)
        if name in {"publish", "heartbeat"}:
            p.add_argument("--ledger", type=Path, required=True)
            p.add_argument("--lease-id", required=True)
        else:
            p.add_argument("--output" if name != "cleanup" else "--export-receipt", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "deploy":
        result = deploy(args.config, args.receipt)
    elif args.command == "publish":
        result = publish(args.receipt, args.ledger, args.lease_id)
    elif args.command == "heartbeat":
        while True:
            result = publish(args.receipt, args.ledger, args.lease_id)
            print(json.dumps(result), flush=True)
            if watchdog_state(args.ledger, args.lease_id)["status"] == "terminated":
                break
            time.sleep(30)
    elif args.command == "enroll":
        result = enroll(args.receipt, args.output)
    elif args.command == "export":
        result = export(args.receipt, args.output)
    else:
        result = cleanup(args.receipt, args.export_receipt)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Provider and AWS SDK errors may contain request data; never echo them.
        print(json.dumps({"ok": False, "errorType": type(error).__name__, "details": "Omitted; inspect nonsecret deployment stage receipt"}))
        raise SystemExit(2)
