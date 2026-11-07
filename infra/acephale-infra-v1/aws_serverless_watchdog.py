"""Lambda transport and evidence storage for the existing EC2 deadline watchdog.

Scheduled invocations occur once per minute. Three bounded polls at offsets
0/30/60 seconds overlap the following invocation; this is not a delivery SLA.
No enrollment is manufactured: an operator must supply independently verified
recovery evidence before a healthy poll can publish an admissible heartbeat.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import date, datetime
from pathlib import Path

from aws_control import (
    PROFILE,
    deployment_hash,
    digest,
    finite_number,
    require,
    watchdog_tick,
)

POLL_OFFSETS = (0, 30, 60)
HERE = Path(__file__).resolve().parent
CODE_FILES = {"aws_serverless_watchdog.py", "aws_control.py", "aws_readiness.py", "control.py", "versions.json"}


def normalize(value):
    def encoder(item):
        if isinstance(item, (datetime, date)):
            return item.isoformat()
        raise TypeError("Unsupported AWS response value")
    return json.loads(json.dumps(value, default=encoder, allow_nan=False))


class BotoTransport:
    """Only STS identity, EC2 discovery and scoped termination are callable."""
    ALLOWED = frozenset({("sts", "get-caller-identity"), ("ec2", "describe-instances"), ("ec2", "terminate-instances")})

    def __init__(self, clients, clock=time.time, provider_errors=()):
        self.clients, self.clock, self.audit = clients, clock, []
        self.errors = (ValueError, TypeError, KeyError, OSError, RuntimeError, *provider_errors)

    def call(self, service, operation, payload=None):
        require((service, operation) in self.ALLOWED, "Watchdog transport operation denied")
        record = {"service": service, "operation": operation, "requestSha256": digest(payload or {}), "startedAt": self.clock()}
        try:
            response = normalize(getattr(self.clients[service], operation.replace("-", "_"))(**(payload or {})))
            require(isinstance(response, dict) and not response.get("NextToken"), "Incomplete watchdog discovery")
            record.update(ok=True, responseSha256=digest(response))
            return response
        except self.errors:
            record["ok"] = False
            raise RuntimeError("AWS watchdog request failed or response incomplete; details omitted") from None
        finally:
            record["finishedAt"] = self.clock()
            self.audit.append(record)


class S3Evidence:
    def __init__(self, client, bucket, account, provider_errors=()):
        self.client, self.bucket, self.account = client, bucket, account
        self.errors = (ValueError, TypeError, KeyError, OSError, RuntimeError, *provider_errors)

    def enrollment(self):
        try:
            result = self.client.get_object(Bucket=self.bucket, Key="enrollment.json", ExpectedBucketOwner=self.account)
            body = result["Body"].read(65537)
            require(len(body) <= 65536, "Enrollment exceeds bound")
            value = json.loads(body)
            require(isinstance(value, dict), "Invalid operator enrollment")
            return value
        except self.errors:
            raise RuntimeError("Operator enrollment read failed") from None

    def write(self, key, value):
        body = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        try:
            conditional = {"IfNoneMatch": "*"} if key.startswith("evidence/") else {}
            self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json",
                                   ServerSideEncryption="AES256", ExpectedBucketOwner=self.account, **conditional)
        except self.errors:
            raise RuntimeError("Watchdog evidence export failed") from None
        return hashlib.sha256(body).hexdigest()


def verified_code(expected_manifest_hash):
    path = HERE / "watchdog-code-manifest.json"
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == expected_manifest_hash, "Watchdog code manifest mismatch")
    manifest = json.loads(data)
    require(manifest.get("schemaVersion") == 1 and set(manifest.get("files", {})) == CODE_FILES, "Unexpected watchdog source manifest")
    for name, expected in manifest["files"].items():
        require(hashlib.sha256((HERE / name).read_bytes()).hexdigest() == expected, "Watchdog deployed source differs from pinned package")


def validate_settings(settings):
    plan = settings["plan"]
    require(settings["planHash"] == deployment_hash(plan), "Watchdog plan identity mismatch")
    require(settings["hostRegion"] in {"us-east-1", "us-west-2"} and plan["region"] == "us-east-1", "Unexpected watchdog execution or target region")
    require(plan["accountId"] == "971290362335" and plan["instanceType"] == "g6e.2xlarge", "Unexpected watchdog account or instance family")
    suffix = "A" if settings["hostRegion"] == "us-east-1" else "B"
    require(settings["roleArn"] == f"arn:aws:iam::{plan['accountId']}:role/AcephaleWatchdog{suffix}", "Unexpected watchdog role")
    expected_function = f"arn:aws:lambda:{settings['hostRegion']}:{plan['accountId']}:function:acephale-watchdog-{suffix.lower()}"
    require(settings["functionArn"].split(":function:", 1)[0] + ":function:" + settings["functionArn"].split(":function:", 1)[1].split(":", 1)[0]
            == expected_function, "Unexpected executing watchdog function")
    start = finite_number(settings["coverageStartsAt"], "watchdog coverage start")
    end = finite_number(settings["coverageEndsAt"], "watchdog coverage end")
    require(0 < end - start <= 24 * 3600, "Watchdog coverage must be bounded to 24 hours")
    require(settings["controllerId"] == "acephale-watchdog-" + suffix.lower(), "Watchdog controller identity mismatch")


def enrollment_valid(value, settings, now):
    require(isinstance(value, dict) and value.get("profile") == PROFILE and value.get("provider") == "aws"
            and value.get("planHash") == settings["planHash"] and value.get("controllerId") == settings["controllerId"]
            and value.get("hostId") == settings["functionArn"].split(":function:", 1)[0] + ":function:" + settings["functionArn"].split(":function:", 1)[1].split(":", 1)[0]
            and value.get("failureDomain") == "aws-region:" + settings["hostRegion"]
            and value.get("accountId") == settings["plan"]["accountId"] and value.get("region") == settings["plan"]["region"], "Operator enrollment identity mismatch")
    require(value.get("terminationRecoveryTestPassed") is True and value.get("recoveryEvidenceKind") == "live_provider_recovery"
            and isinstance(value.get("recoveryEvidenceSha256"), str) and len(value["recoveryEvidenceSha256"]) == 64
            and all(character in "0123456789abcdef" for character in value["recoveryEvidenceSha256"]), "Actual provider recovery evidence required")
    require(value.get("codeManifestSha256") == settings["codeManifestSha256"]
            and value.get("coverageStartsAt") == settings["coverageStartsAt"] and value.get("coverageEndsAt") == settings["coverageEndsAt"],
            "Recovery enrollment belongs to a different code deployment or coverage window")
    require(settings["coverageStartsAt"] <= finite_number(value.get("recoveryVerifiedAt"), "recovery verification") <= now
            and finite_number(value.get("verifiedAt"), "operator verification") <= now < settings["coverageEndsAt"],
            "Recovery evidence is outside this deployment window")


def run_invocation(settings, transport, store, *, request_id, clock=time.time, sleep=time.sleep,
                   remaining=lambda: 120, log=print):
    """Inject clocks/provider/storage in offline tests; no fabricated heartbeats."""
    validate_settings(settings)
    require(isinstance(request_id, str) and request_id and all(c.isalnum() or c == "-" for c in request_id), "Invocation identity required")
    began = clock()
    require(settings["coverageStartsAt"] <= began < settings["coverageEndsAt"], "Invocation outside explicit coverage window")
    failures, polls, heartbeats = [], [], 0
    try:
        enrollment = store.enrollment()
    except (ValueError, RuntimeError, OSError, KeyError, TypeError):
        enrollment = None
    for number, offset in enumerate(POLL_OFFSETS):
        delay = max(0, began + offset - clock())
        if remaining() < delay + 40 or clock() + delay >= settings["coverageEndsAt"]:
            failures.append({"poll": number, "reason": "insufficient_runtime_or_coverage"})
            break
        if delay:
            sleep(delay)
        started = clock()
        calls_start = len(getattr(transport, "audit", []))
        result, healthy, failure = [], False, None
        try:
            result = watchdog_tick(transport, settings["plan"], settings["roleArn"], started, settings["controllerId"])
            healthy = not any(item.get("error") or item.get("terminationVerified") is False for item in result)
            if not healthy:
                failure = "provider_cleanup_unresolved"
        except (ValueError, RuntimeError, OSError, KeyError, TypeError):
            failure = "provider_discovery_or_cleanup_failed"
        evidence = {"schemaVersion": 1, "profile": PROFILE, "provider": "aws", "planHash": settings["planHash"],
                    "controllerId": settings["controllerId"], "functionArn": settings["functionArn"], "requestId": request_id,
                    "poll": number, "startedAt": started, "finishedAt": clock(), "healthy": healthy, "results": result,
                    "codeManifestSha256": settings["codeManifestSha256"], "runtimeSdkVersion": settings.get("runtimeSdkVersion"),
                    "coverageStartsAt": settings["coverageStartsAt"], "coverageEndsAt": settings["coverageEndsAt"],
                    "calls": getattr(transport, "audit", [])[calls_start:], "failure": failure}
        key = f"evidence/{request_id}/poll-{number}.json"
        stored = False
        try:
            evidence_hash = store.write(key, evidence)
            stored = True
        except (ValueError, RuntimeError, OSError, KeyError, TypeError):
            failure = "durable_evidence_export_failed"
        admitted = False
        if healthy and stored:
            now = clock()
            receipt = {"profile": PROFILE, "provider": "aws", "planHash": settings["planHash"], "controllerId": settings["controllerId"],
                       "accountId": settings["plan"]["accountId"], "region": settings["plan"]["region"],
                       "hostId": settings["functionArn"], "failureDomain": "aws-region:" + settings["hostRegion"],
                       "hostingKind": "aws_lambda", "controllerKind": "independent_always_on", "discovery": "ec2_tags",
                       "heartbeatAt": now, "maxPollSeconds": 60, "scheduleCadenceSeconds": 60, "schedulerPrecisionSeconds": 60,
                       "internalPollOffsetsSeconds": list(POLL_OFFSETS), "deliveryGuaranteed": False,
                       "coverageStartsAt": settings["coverageStartsAt"], "coverageEndsAt": settings["coverageEndsAt"], "roleArn": settings["roleArn"],
                       "codeManifestSha256": settings["codeManifestSha256"], "lastEvidenceKey": key, "lastEvidenceSha256": evidence_hash,
                       "requestId": request_id, "lastTick": result}
            try:
                store.write("armed.json", {**receipt, "receiptKind": "healthy_deployed_watchdog_arming", "deployedCodeVerified": True,
                                           "terminationRecoveryTestPassed": False})
            except (ValueError, RuntimeError, OSError, KeyError, TypeError):
                failure = "arming_evidence_export_unavailable"
            try:
                enrollment_valid(enrollment, settings, now)
                store.write("heartbeat.json", {**enrollment, **receipt})
                admitted, heartbeats = True, heartbeats + 1
            except (ValueError, RuntimeError, OSError, KeyError, TypeError):
                failure = "operator_enrollment_or_heartbeat_export_unavailable"
        if failure:
            failures.append({"poll": number, "reason": failure})
        summary = {"controllerId": settings["controllerId"], "requestId": request_id, "poll": number,
                   "healthy": healthy, "evidenceStored": stored, "heartbeatPublished": admitted, "failure": failure,
                   "evidenceSha256": digest(evidence)}
        log(json.dumps(summary, separators=(",", ":")))
        polls.append(summary)
    summary = {"schemaVersion": 1, "controllerId": settings["controllerId"], "requestId": request_id,
               "startedAt": began, "finishedAt": clock(), "polls": polls, "failures": failures, "heartbeatsPublished": heartbeats}
    try:
        store.write(f"evidence/{request_id}/invocation.json", summary)
    except (ValueError, RuntimeError, OSError, KeyError, TypeError):
        failures.append({"reason": "invocation_summary_export_failed"})
        log(json.dumps({"requestId": request_id, "failure": "invocation_summary_export_failed"}))
    return summary


def handler(event, context):
    # Lambda includes boto3. Its actual version is preserved in evidence, and the
    # deployment must verify the package digest before schedule activation.
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError

    settings = json.loads(os.environ["ACEPHALE_WATCHDOG_SETTINGS"])
    settings["functionArn"] = context.invoked_function_arn
    settings["runtimeSdkVersion"] = boto3.__version__
    require(event.get("planHash") == settings["planHash"], "Scheduled invocation plan mismatch")
    require(os.environ["AWS_REGION"] == settings["hostRegion"], "Executing region mismatch")
    verified_code(settings["codeManifestSha256"])
    options = Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 1})
    clients = {service: boto3.client(service, region_name=settings["plan"]["region"], config=options) for service in ("ec2", "sts")}
    storage = boto3.client("s3", region_name=settings["hostRegion"], config=options)
    provider_errors = (BotoCoreError, ClientError)
    store = S3Evidence(storage, os.environ["ACEPHALE_EVIDENCE_BUCKET"], settings["plan"]["accountId"], provider_errors)
    result = run_invocation(settings, BotoTransport(clients, provider_errors=provider_errors), store, request_id=context.aws_request_id,
                            remaining=lambda: context.get_remaining_time_in_millis() / 1000)
    if result["failures"]:
        # AWS async failure destinations retain the invocation separately from
        # per-poll S3 evidence. The next scheduled invocation keeps cleaning up.
        raise RuntimeError("Watchdog invocation incomplete; inspect immutable evidence and failure queue")
    return {"controllerId": result["controllerId"], "polls": len(result["polls"]), "heartbeatsPublished": result["heartbeatsPublished"]}
