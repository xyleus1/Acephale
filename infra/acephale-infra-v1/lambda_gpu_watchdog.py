"""AWS-hosted, exact-lease cleanup for Lambda GPU rentals.

This handler has no launch capability. It fetches one private S3 lease, polls
the provider, and terminates only that registered name and optional instance ID.
Successful invocations persist immutable evidence before returning enrollment.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import urllib.request
import uuid

API = "https://cloud.lambda.com/api/v1"
PROFILE = "acephale-infra-v1"
USER_AGENT = "Acephale-Research-Watchdog/1.0"
LOCK_KEY = "controller-lock.json"
LOCK_SECONDS = 60


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return type(value) in {int, float} and math.isfinite(value)


def conditional_conflict(error):
    response = getattr(error, "response", {})
    return (response.get("ResponseMetadata", {}).get("HTTPStatusCode") in {409, 412}
            or response.get("Error", {}).get("Code") in {"PreconditionFailed", "ConditionalRequestConflict"})


class ControllerLock:
    """S3 conditional writes fence one controller without Lambda quota reservations."""
    def __init__(self, s3, bucket, owner, record, etag):
        self.s3, self.bucket, self.owner, self.record, self.etag = s3, bucket, owner, record, etag

    @classmethod
    def acquire(cls, s3, bucket, owner, now):
        record = {"version": 1, "owner": owner, "acquiredAt": now, "expiresAt": now + LOCK_SECONDS, "nonce": uuid.uuid4().hex}
        body = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
        request = {"Bucket": bucket, "Key": LOCK_KEY, "Body": body, "ContentType": "application/json", "ServerSideEncryption": "AES256"}
        try:
            result = s3.put_object(**request, IfNoneMatch="*")
        except Exception as error:
            if not conditional_conflict(error):
                raise
            try:
                previous = s3.get_object(Bucket=bucket, Key=LOCK_KEY)
            except s3.exceptions.NoSuchKey:
                return None
            raw = previous["Body"].read(4097)
            require(len(raw) <= 4096, "Invalid controller lock")
            prior = json.loads(raw)
            require(prior.get("version") == 1 and isinstance(prior.get("owner"), str)
                    and number(prior.get("expiresAt")) and number(prior.get("acquiredAt"))
                    and prior["expiresAt"] <= prior["acquiredAt"] + LOCK_SECONDS, "Invalid controller lock")
            if prior["expiresAt"] > now:
                return None
            try:
                result = s3.put_object(**request, IfMatch=previous["ETag"])
            except Exception as error:
                if conditional_conflict(error):
                    return None
                raise
        require(isinstance(result.get("ETag"), str) and result["ETag"], "S3 did not return lock ETag")
        return cls(s3, bucket, owner, record, result["ETag"])

    def check(self):
        require(time.time() < self.record["expiresAt"], "Controller lock expired")
        current = self.s3.get_object(Bucket=self.bucket, Key=LOCK_KEY)
        require(current.get("ETag") == self.etag, "Controller lock ownership lost")
        require(time.time() < self.record["expiresAt"], "Controller lock expired during validation")

    def release(self):
        # A conditional overwrite avoids DeleteObject races with a newer owner.
        released = {**self.record, "released": True, "expiresAt": 0}
        try:
            self.s3.put_object(Bucket=self.bucket, Key=LOCK_KEY, Body=json.dumps(released, sort_keys=True).encode(),
                ContentType="application/json", ServerSideEncryption="AES256", IfMatch=self.etag)
        except Exception as error:
            if not conditional_conflict(error):
                raise


def checked_state(value):
    require(isinstance(value, dict) and value.get("version") == 1 and value.get("profile") == PROFILE, "Wrong lease state")
    require(re.fullmatch(r"[a-f0-9-]{36}", value.get("leaseId", "")), "Invalid lease ID")
    require(value.get("expectedName") == "acephale-infra-" + value["leaseId"], "Exact registered name required")
    require(re.fullmatch(r"[a-f0-9]{64}", value.get("planHash", "")), "Missing plan hash")
    require(value.get("instanceId") is None or re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value["instanceId"]), "Invalid instance ID")
    require(value.get("status") in {"reserved", "launching", "launch_unknown", "active", "termination_requested", "terminated"}, "Unfunded lease state")
    for key in ("reservedAt", "setupDeadline", "deadline", "ownerHeartbeatAt"):
        require(number(value.get(key)), "Invalid lease time")
    require(value["reservedAt"] < value["setupDeadline"] <= value["deadline"] <= value["reservedAt"] + 8 * 3600, "Lease exceeds session ceiling")
    require(type(value.get("ready")) is bool and value.get("ownerHeartbeatTimeoutSeconds") == 120, "Invalid owner heartbeat policy")
    if value.get("purpose") == "cleanup_canary":
        require(value["deadline"] - value["reservedAt"] <= 600
                and re.fullmatch(r"acephale-[a-z0-9-]+", value.get("recoveryControllerId", "")), "Unbounded recovery canary")
    return value


def select_instance(state, instances):
    require(isinstance(instances, list), "Incomplete instance list")
    matches = [row for row in instances if row.get("name") == state["expectedName"]]
    require(len(matches) <= 1, "Ambiguous registered instance name")
    if state.get("instanceId"):
        same_id = [row for row in instances if row.get("id") == state["instanceId"]]
        require(not same_id or (len(same_id) == 1 and same_id[0].get("name") == state["expectedName"]), "Instance ownership changed")
        require(not matches or matches[0].get("id") == state["instanceId"], "Registered instance ID changed")
    if matches:
        require(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", matches[0].get("id", "")), "Malformed provider instance ID")
    return matches[0] if matches else None


def reason(state, now):
    if state["status"] in {"termination_requested", "terminated"}:
        return "requested"
    if now >= state["deadline"]:
        return "lease_deadline"
    if not state["ready"] and now >= state["setupDeadline"]:
        return "setup_deadline"
    if now - state["ownerHeartbeatAt"] > 120 or state["ownerHeartbeatAt"] > now + 30:
        return "owner_heartbeat_expired"
    return None


def tick(state, client, now, controller_id=None, refresh_state=None, on_termination_ack=None):
    checked_state(state)
    item = select_instance(state, client.request("GET", "/instances")["data"])
    trigger = reason(state, now)
    if (state.get("purpose") == "cleanup_canary" and controller_id != state["recoveryControllerId"]
            and now < state["deadline"]):
        trigger = None  # The second controller remains backup at the hard deadline.
    result = {"stateHash": digest(state), "leaseId": state["leaseId"], "expectedName": state["expectedName"],
              "instanceId": item["id"] if item else state.get("instanceId"), "observedAt": now,
              "reason": trigger, "readOnlyProbeSucceeded": True, "terminationRequested": False,
              "terminationVerified": False, "observedStatus": item.get("status") if item else "absent"}
    if not item or item.get("status") == "terminated":
        result["terminationVerified"] = bool(trigger and state.get("instanceId"))
        return result
    if trigger and item.get("status") != "terminating":
        if refresh_state:
            latest = checked_state(refresh_state())
            require(latest["leaseId"] == state["leaseId"] and latest["expectedName"] == state["expectedName"]
                    and (not latest.get("instanceId") or latest["instanceId"] == item["id"]), "Registered lease changed before termination")
            trigger = reason(latest, time.time())
            if (latest.get("purpose") == "cleanup_canary" and controller_id != latest["recoveryControllerId"]
                    and time.time() < latest["deadline"]):
                trigger = None
            result.update(stateHash=digest(latest), reason=trigger)
            if not trigger:
                return result
        acknowledgment = client.request("POST", "/instance-operations/terminate", {"instance_ids": [item["id"]]})
        payload = acknowledgment.get("data") if isinstance(acknowledgment, dict) else None
        acknowledged = payload.get("terminated_instances") if isinstance(payload, dict) else None
        require(isinstance(acknowledgment, dict) and not acknowledgment.get("error")
                and isinstance(payload, dict) and not payload.get("error")
                and isinstance(acknowledged, list) and len(acknowledged) == 1 and isinstance(acknowledged[0], dict)
                and acknowledged[0].get("id") == item["id"]
                and acknowledged[0].get("name", item["name"]) == item["name"], "Provider termination acknowledgment does not identify the exact instance")
        result["terminationRequested"] = True
        if on_termination_ack:
            on_termination_ack(dict(result))
        verified = select_instance({**state, "instanceId": item["id"]}, client.request("GET", "/instances")["data"])
        result["terminationVerified"] = not verified or verified.get("status") == "terminated"
        result["observedStatus"] = verified.get("status") if verified else "absent"
    return result


class Provider:
    def __init__(self, token, guard=None):
        require(isinstance(token, str) and token.strip(), "Missing provider credential")
        self.token, self.last = token.strip(), 0.0
        self.guard = guard

    def request(self, method, path, payload=None):
        require((method, path) in {("GET", "/instances"), ("POST", "/instance-operations/terminate")}, "Operation denied")
        time.sleep(max(0, 1.05 - (time.monotonic() - self.last)))
        if self.guard:
            self.guard()
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(API + path, data=body, method=method,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json", "User-Agent": USER_AGENT})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise ValueError("Provider redirect denied")
        self.last = time.monotonic()
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                data = response.read(2_000_001)
                require(len(data) <= 2_000_000, "Provider response too large")
                return json.loads(data)
        except Exception:
            raise RuntimeError("Provider operation failed; credential and response omitted") from None


def _run_locked(event, context, s3, code_hash, lock):
    import boto3
    bucket, state_key = os.environ["STATE_BUCKET"], os.environ["STATE_KEY"]
    def read(key, optional=False):
        try:
            raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read(65537)
            require(len(raw) <= 65536, "Oversized watchdog record")
            return json.loads(raw)
        except s3.exceptions.NoSuchKey:
            if optional:
                return None
            raise
    def write(key, value, immutable=False):
        lock.check()
        body = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json", ServerSideEncryption="AES256",
                      **({"IfNoneMatch": "*"} if immutable else {}))
        return hashlib.sha256(body).hexdigest()
    state = read(state_key, optional=True)
    if state is None:
        return {"version": 1, "status": "idle_no_registered_lease", "codeSha256": code_hash}
    checked_state(state)
    secret = boto3.client("secretsmanager").get_secret_value(SecretId=os.environ["TOKEN_SECRET_ARN"])["SecretString"]
    client = Provider(secret, guard=lock.check)
    pending_key = "pending/" + state["leaseId"] + ".json"
    pending = read(pending_key, optional=True)
    if pending and pending.get("expectedName") == state["expectedName"] and not state.get("instanceId"):
        state = {**state, "instanceId": pending["instanceId"]}
    def refresh_state():
        lock.check()
        return read(state_key)
    def on_termination_ack(observed):
        nonlocal pending
        pending = {"version": 1, "profile": PROFILE, "controllerId": os.environ["CONTROLLER_ID"],
                   "hostId": context.invoked_function_arn, "codeSha256": code_hash, "invocationId": context.aws_request_id,
                   "acknowledgedAt": time.time(), **observed}
        write("evidence/" + state["leaseId"] + "/" + context.aws_request_id + "-termination-ack.json", pending, True)
        write(pending_key, pending)
    observed = tick(state, client, time.time(), os.environ["CONTROLLER_ID"], refresh_state=refresh_state,
                    on_termination_ack=on_termination_ack)
    evidence = {"version": 1, "profile": PROFILE, "controllerId": os.environ["CONTROLLER_ID"],
                "hostId": context.invoked_function_arn, "codeSha256": code_hash,
                "invocationId": context.aws_request_id, **observed}
    evidence_key = "evidence/" + state["leaseId"] + "/" + context.aws_request_id + ".json"
    evidence_hash = write(evidence_key, evidence, True)
    # A recovery receipt is created only after an actual provider termination.
    # A previous request in this controller survives asynchronous termination.
    if observed["terminationVerified"] and pending and pending.get("terminationRequested") is True:
        require(pending.get("codeSha256") == code_hash and pending.get("instanceId") == observed["instanceId"], "Recovery identity changed")
        write("recovery.json", {"version": 1, "actualProviderTermination": True, "codeSha256": code_hash,
                               "requestEvidenceHash": digest(pending), "verificationEvidenceHash": evidence_hash,
                               "instanceId": observed["instanceId"], "verifiedAt": time.time()})
    recovery = read("recovery.json", optional=True)
    recovered = bool(recovery and recovery.get("actualProviderTermination") is True and recovery.get("codeSha256") == code_hash
                     and re.fullmatch(r"[a-f0-9]{64}", recovery.get("requestEvidenceHash", ""))
                     and re.fullmatch(r"[a-f0-9]{64}", recovery.get("verificationEvidenceHash", "")))
    receipt = {"version": 1, "profile": PROFILE, "controllerKind": "independent_always_on", "hostingKind": "aws_lambda",
               "controllerId": os.environ["CONTROLLER_ID"], "hostId": context.invoked_function_arn,
               "leaseId": state["leaseId"], "expectedName": state["expectedName"], "planHash": state["planHash"],
               "deadline": state["deadline"], "setupDeadline": state["setupDeadline"], "maxPollSeconds": 60,
               "readOnlyProbeSucceeded": True, "recoveryTestPassed": recovered,
               "recoveryEvidenceSha256": digest(recovery) if recovered else None,
               "codeSha256": code_hash, "verifiedAt": time.time(), "evidenceKey": evidence_key,
               "evidenceSha256": evidence_hash, "observed": observed}
    write("enrollment.json", receipt)
    lock.check()
    return receipt


def handler(event, context):
    import boto3
    code_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    require(code_hash == os.environ["CODE_SHA256"], "Watchdog source hash changed")
    require(0 < context.get_remaining_time_in_millis() <= 45_000, "Controller timeout must be at most 45 seconds")
    s3, bucket = boto3.client("s3"), os.environ["STATE_BUCKET"]
    lock = ControllerLock.acquire(s3, bucket, context.aws_request_id, time.time())
    if lock is None:
        return {"version": 1, "status": "busy", "codeSha256": code_hash,
                "hostId": context.invoked_function_arn, "retryAfterSeconds": 10}
    try:
        return _run_locked(event, context, s3, code_hash, lock)
    finally:
        lock.release()
