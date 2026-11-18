"""Signed GitHub control records. No provider, financial or GitHub effects."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re

from lambda_gpu_watchdog import checked_state, number, require

BACKEND = "github_actions_v1"
KIND = "acephale-github-watchdog-binding-v1"
LEASE_FIELDS = ("leaseId", "expectedName", "planHash", "reservedAt", "setupDeadline", "deadline")
SOURCE_NAMES = ("lambda_gpu_watchdog.py", "github_watchdog_protocol.py", "github_watchdog_store.py",
                "github_gpu_watchdog.py", "github_watchdog_admission.py")
STATE_PATH = "control/owner-state.json"
ACK_PATH = "control/ack.json"
POLL_SECONDS = 20
# Stay below the 20s poll: last_ack records CAS completion, so 40s often waits 60s.
ACK_SECONDS = 10
JOB_MINUTES = 350
CONTROLLER_SECONDS = 330 * 60
CLEANUP_SECONDS = 345 * 60
MARGIN_SECONDS = 300


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def key_bytes(key):
    require(isinstance(key, str), "Expected private 256-bit HMAC key")
    try:
        decoded = base64.b64decode(key, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Expected canonical base64 private key") from None
    require(len(decoded) == 32 and base64.b64encode(decoded).decode() == key,
            "Expected canonical base64 256-bit private key")
    return decoded


def seal(payload, key):
    raw = canonical(payload)
    return {"payload": payload, "hmacSha256": hmac.new(key_bytes(key), raw, hashlib.sha256).hexdigest()}


def unseal(record, key):
    require(type(record) is dict and set(record) == {"payload", "hmacSha256"}, "Invalid signed record")
    expected = hmac.new(key_bytes(key), canonical(record["payload"]), hashlib.sha256).hexdigest()
    require(isinstance(record["hmacSha256"], str) and hmac.compare_digest(expected, record["hmacSha256"]),
            "Control record signature mismatch")
    return record["payload"]


def checked_binding(value):
    require(type(value) is dict and value.get("kind") == KIND and value.get("backend") == BACKEND,
            "Explicit GitHub backend binding required")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value.get("repository", ""))
            and type(value.get("repositoryId")) is int and value["repositoryId"] > 0,
            "Exact private repository identity required")
    require(re.fullmatch(r"[a-f0-9-]{36}", value.get("sessionId", "")), "Unique session required")
    require(value.get("workflowPath") == ".github/workflows/watchdogs.yml"
            and re.fullmatch(r"[a-f0-9]{40}", value.get("workflowCommit", ""))
            and re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            and re.fullmatch(r"[a-f0-9]{64}", value.get("workflowSha256", "")), "Pinned workflow/source required")
    suffix = value["sessionId"].replace("-", "")[:12]
    require(value.get("stateBranch") == "owner-state-" + suffix and value.get("statePath") == STATE_PATH,
            "Fixed owner control path required")
    require(value.get("sharedControlPlane") == "github.com" and value.get("regionIndependent") is False,
            "Shared GitHub control plane must be disclosed")
    files = value.get("sourceFiles", {})
    require(set(files) == set(SOURCE_NAMES) and all(re.fullmatch(r"[a-f0-9]{64}", x) for x in files.values()),
            "Complete worker source closure required")
    rows = value.get("controllers", [])
    require(type(rows) is list and len(rows) == 2, "Two explicit controllers required")
    require({(r.get("jobName"), r.get("evidenceBranch")) for r in rows}
            == {("watchdog_a", "watchdog-a-" + suffix), ("watchdog_b", "watchdog-b-" + suffix)},
            "Separate immutable session branches required")
    require(len({r.get("controllerId") for r in rows}) == 2
            and all(re.fullmatch(r"acephale-[a-z0-9-]+", r.get("controllerId", "")) for r in rows),
            "Distinct exact controller IDs required")
    lease = value.get("leaseIdentity", {})
    require(set(lease) == set(LEASE_FIELDS), "Exact immutable lease identity required")
    policy = value.get("leasePolicy")
    require(policy == {} or (type(policy) is dict and set(policy) == {"purpose", "recoveryControllerId"}
        and policy.get("purpose") == "cleanup_canary"
        and policy.get("recoveryControllerId") in {r["controllerId"] for r in rows}
        and lease["deadline"] - lease["reservedAt"] <= 600), "Exact canary or ordinary lease policy required")
    checked_state({**lease, "version": 1, "profile": "acephale-infra-v1", "instanceId": None,
                   "status": "reserved", "ready": False, "ownerHeartbeatAt": lease["reservedAt"],
                   "ownerHeartbeatTimeoutSeconds": 120})
    return value


def check_state_identity(state, binding):
    checked_state(state)
    require({k: state[k] for k in LEASE_FIELDS} == binding["leaseIdentity"], "Lease identity or original deadlines changed")
    require(lease_policy(state) == binding["leasePolicy"],
            "Canary termination policy changed")
    return state


def lease_policy(value):
    if value.get("purpose", "research") == "research" and value.get("recoveryControllerId") is None:
        return {}
    require(value.get("purpose") == "cleanup_canary" and value.get("recoveryControllerId"),
            "Unknown lease termination policy")
    return {"purpose": value["purpose"], "recoveryControllerId": value["recoveryControllerId"]}


def owner_record(binding, state, sequence, key, previous=None):
    checked_binding(binding)
    check_state_identity(state, binding)
    require(type(sequence) is int and sequence >= 0, "Nonnegative owner sequence required")
    if previous is not None:
        prior = check_owner(previous, key, binding)
        require(sequence == prior["sequence"] + 1, "Owner publication must increment exact prior sequence")
    else:
        require(sequence == 0, "First owner record must start at zero")
    record = seal({"kind": "acephale-github-owner-state-v1", "sessionId": binding["sessionId"],
                   "bindingHash": digest(binding), "sequence": sequence,
                   "previousHash": digest(previous) if previous else None, "state": state}, key)
    check_owner(record, key, binding, previous)
    return record


def check_owner(record, key, binding, previous=None):
    body = unseal(record, key)
    require(type(body) is dict and body.get("kind") == "acephale-github-owner-state-v1"
            and body.get("sessionId") == binding["sessionId"] and body.get("bindingHash") == digest(binding)
            and type(body.get("sequence")) is int and body["sequence"] >= 0, "Wrong owner state scope")
    state = check_state_identity(body["state"], binding)
    require((body["sequence"] == 0 and body.get("previousHash") is None)
            or (body["sequence"] > 0 and re.fullmatch(r"[a-f0-9]{64}", body.get("previousHash", ""))),
            "Owner record lacks predecessor commitment")
    if previous is not None:
        old = unseal(previous, key)
        require(body["sequence"] >= old["sequence"], "Owner sequence rolled back")
        if body["sequence"] == old["sequence"]:
            require(record == previous, "Owner sequence reused with changed state")
        else:
            if body["sequence"] == old["sequence"] + 1:
                require(body["previousHash"] == digest(previous), "Owner history forked")
            prior = old["state"]
            require(state["ownerHeartbeatAt"] >= prior["ownerHeartbeatAt"], "Heartbeat rolled back")
            require(not prior.get("instanceId") or state.get("instanceId") == prior["instanceId"], "Instance ID replaced or erased")
            require(not prior["ready"] or state["ready"], "Readiness rolled back")
            transitions = {"reserved": {"reserved", "launching", "launch_unknown", "active", "termination_requested", "terminated"},
                "launching": {"launching", "launch_unknown", "active", "termination_requested", "terminated"},
                "launch_unknown": {"launch_unknown", "active", "termination_requested", "terminated"},
                "active": {"active", "termination_requested", "terminated"},
                "termination_requested": {"termination_requested", "terminated"}, "terminated": {"terminated"}}
            require(state["status"] in transitions[prior["status"]], "Lease status rolled back")
    return body


def check_ack(record, key, binding, controller_id, now, *, exact_owner=None, healthy=True):
    body = unseal(record, key)
    require(body.get("kind") == "acephale-github-watchdog-ack-v1" and body.get("bindingHash") == digest(binding)
            and body.get("sessionId") == binding["sessionId"] and body.get("controllerId") == controller_id,
            "Wrong controller ACK scope")
    require(number(body.get("verifiedAt")) and 0 <= now - body["verifiedAt"] <= 60,
            "Controller ACK is stale or future dated")
    owner = check_owner(body["ownerRecord"], key, binding)
    require(body.get("ownerRecordHash") == digest(body["ownerRecord"])
            and body.get("ownerSequence") == owner["sequence"], "ACK owner commitment changed")
    effective = checked_state(body.get("effectiveState"))
    expected = dict(owner["state"])
    if body.get("cancelled") or now >= body["identity"]["controllerExpiresAt"]:
        expected["status"] = "termination_requested"
    if effective.get("instanceId") != expected.get("instanceId"):
        require(expected.get("instanceId") is None and body.get("terminationAcknowledgment"),
                "Controller cannot replace owner instance identity")
        pending = unseal(body["terminationAcknowledgment"], key)
        require(pending.get("bindingHash") == digest(binding) and pending.get("controllerId") == controller_id
                and pending["observed"].get("terminationRequested") is True
                and effective.get("instanceId") == pending["observed"].get("instanceId"),
                "Instance resolution lacks actual termination acknowledgment")
        expected["instanceId"] = pending["observed"]["instanceId"]
    require(effective == expected and body["observed"].get("stateHash") == digest(effective)
            and body["observed"].get("readOnlyProbeSucceeded") is True,
            "ACK lacks real matching provider observation")
    if exact_owner is not None:
        require(body["ownerRecord"] == exact_owner, "Startup ACK must match paused owner publication exactly")
    if healthy:
        require(body.get("stateReadErrorType") is None and body.get("cancelled") is False
                and body["observed"].get("reason") is None
                and 0 <= now - owner["state"]["ownerHeartbeatAt"] < 120
                and now < owner["state"]["deadline"]
                and (owner["state"]["ready"] or now < owner["state"]["setupDeadline"]),
                "Cleanup-only or expired owner ACK cannot establish readiness")
    return body
