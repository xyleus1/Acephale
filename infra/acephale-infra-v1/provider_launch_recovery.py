"""Reconcile one uncertain POST with bounded GETs; never retry a launch."""
from __future__ import annotations

import copy
import math
import re
import time


class UncertainProviderResponse(RuntimeError):
    """Only a fixed category survives; no exception text, URL, or response body."""

    def __init__(self, category):
        allowed = {"TimeoutError", "URLError", "JSONDecodeError", "UnicodeDecodeError",
                   "OSError", "ValueError", "MalformedResponse", "AmbiguousLaunchResponse"}
        self.uncertainty_category = category if category in allowed else "OSError"
        super().__init__("Lambda response uncertain; reservation must remain")


def guard(lease, cancelled, *, until=None):
    now = time.time()
    if cancelled is not None and cancelled():
        raise InterruptedError("Provider launch reconciliation cancelled")
    if now >= min(lease["setupDeadline"] - 15, lease["deadline"] - 15,
                  math.inf if until is None else until):
        raise TimeoutError("Original provider launch reconciliation window expired")
    return now


def inventory(client, lease, cancelled, *, until=None):
    guard(lease, cancelled, until=until)
    rows = client.request("GET", "/instances")
    guard(lease, cancelled, until=until)
    if (type(rows) is not list or any(type(row) is not dict
            or not isinstance(row.get("id"), str) or not row["id"] for row in rows)
            or len({row["id"] for row in rows}) != len(rows)):
        raise ValueError("Complete unique provider inventory required")
    return rows


def prepare(client, lease, cancelled):
    rows = inventory(client, lease, cancelled)
    if any(row.get("name") == lease["name"] for row in rows):
        raise ValueError("Reserved instance name already exists before the only POST")
    return {"observedAt": time.time(), "existingInstanceIds": sorted(row["id"] for row in rows),
            "exactNameAbsent": True, "postAttempts": 1}


def pulse(refresh, lease, phase, enrollments, expected_state, digest, cancelled, *, until=None, previous=None):
    guard(lease, cancelled, until=until)
    not_after = min(lease["setupDeadline"] - 15, lease["deadline"] - 15,
                    math.inf if until is None else until,
                    math.inf if previous is None else previous["ownerHeartbeatAt"] + 105)
    proof = refresh(copy.deepcopy(lease), phase, not_after=not_after)
    now = guard(lease, cancelled, until=until)
    if type(proof) is not dict:
        raise ValueError("Actual synchronous heartbeat proof required")
    rows = proof.get("controllers", [])
    github = any(row.get("hostingKind") == "github_actions" for row in enrollments)
    if github:
        expected = {(row.get("controllerId"), row.get("hostId")) for row in enrollments}
        scope_matches = (len(enrollments) == 2 and len(expected) == 2
            and all(row.get("hostingKind") == "github_actions" for row in enrollments)
            and proof.get("backend") == "github_actions_v1"
            and proof.get("sharedControlPlane") == "github.com" and proof.get("regionIndependent") is False
            and {(row.get("controllerId"), row.get("hostId")) for row in rows} == expected
            and all("region" not in row for row in rows))
    else:
        regions = {row["hostId"].split(":")[3] for row in enrollments}
        scope_matches = proof.get("backend") != "github_actions_v1" and {row.get("region") for row in rows} == regions
    if (proof.get("verified") is not True or proof.get("phase") != phase
            or proof.get("leaseId") != lease["id"] or proof.get("instanceId") != lease["instanceId"]
            or proof.get("status") != lease["status"] or proof.get("deadline") != lease["deadline"]
            or proof.get("setupDeadline") != lease["setupDeadline"]
            or proof.get("watchdogTimeoutSeconds") != 120 or len(rows) != 2
            or not scope_matches):
        raise ValueError("Exact two-controller reconciliation heartbeat required")
    completed = proof.get("publicationCompletedAt")
    if (type(completed) not in (int, float) or not math.isfinite(completed) or completed > now
            or previous is not None and not 0 <= completed - previous["ownerHeartbeatAt"] < 120):
        raise ValueError("Publication must complete within the existing watchdog heartbeat window")
    for row in rows:
        stamp = row.get("ownerHeartbeatAt")
        if (type(stamp) not in (int, float) or not math.isfinite(stamp)
                or not 0 <= now - stamp <= 30
                or stamp > not_after
                or row.get("stateHash") != digest(expected_state(lease, stamp))):
            raise ValueError("Real current reconciliation publication/readbacks required")
    return {"phase": phase, "verifiedAt": now,
            "ownerHeartbeatAt": min(row["ownerHeartbeatAt"] for row in rows),
            "controllers": copy.deepcopy(rows)}


def heartbeat_fresh(proof, lease, cancelled, *, until=None):
    now = guard(lease, cancelled, until=until)
    if not 0 <= now - proof["ownerHeartbeatAt"] <= 105:
        raise TimeoutError("Reconciliation heartbeat cannot approach its original 120-second timeout")


def observable_identity(row, lease, payload, old_ids):
    if (type(row) is not dict or not re.fullmatch(r"[a-fA-F0-9-]{16,64}", row.get("id", ""))
            or row["id"] in old_ids or row.get("name") != lease["name"]
            or row.get("status") not in {"booting", "active"}
            or row.get("region", {}).get("name") != payload["region_name"]
            or row.get("instance_type", {}).get("name") != payload["instance_type_name"]
            or row.get("ssh_key_names") != payload["ssh_key_names"]):
        raise ValueError("New exact provider identity, region, hardware and access key required")
    image = row.get("image")
    if image is not None and (type(image) is not dict or image.get("id") != payload["image"]["id"]):
        raise ValueError("Observable provider image differs from the sole launch request")
    firewalls = row.get("firewall_rulesets")
    if firewalls is not None and (type(firewalls) is not list or any(type(value) is not dict for value in firewalls)
            or {value.get("id") for value in firewalls} != {value["id"] for value in payload["firewall_rulesets"]}):
        raise ValueError("Observable provider firewall differs from the sole launch request")
    # Return an allowlisted description only: provider rows may contain Jupyter secrets.
    return {"id": row["id"], "name": row["name"], "region": payload["region_name"],
            "instanceType": payload["instance_type_name"], "sshKeyNames": list(row["ssh_key_names"]),
            "imageVerified": image is not None, "firewallVerified": firewalls is not None,
            "status": row["status"]}


def reconcile(client, lease, payload, baseline, refresh, enrollments, expected_state, digest, cancelled, previous,
              *, started_at=None):
    current = guard(lease, cancelled)
    if started_at is not None and (type(started_at) not in (int, float)
            or not math.isfinite(started_at) or not 0 <= started_at <= current):
        raise ValueError("Original finite reconciliation start required")
    started = current if started_at is None else started_at
    until = min(started + 300, lease["setupDeadline"] - 15, lease["deadline"] - 15)
    pulses = [pulse(refresh, lease, "uncertain_response", enrollments, expected_state, digest,
                    cancelled, until=until, previous=previous)]
    observations = []
    get_seconds = 0.0
    while True:
        if get_seconds >= 60:
            raise TimeoutError("Bounded provider GET reconciliation exhausted")
        if time.time() - pulses[-1]["ownerHeartbeatAt"] > 20:
            pulses.append(pulse(refresh, lease, "poll_refresh", enrollments, expected_state, digest,
                                cancelled, until=until, previous=pulses[-1]))
        heartbeat_fresh(pulses[-1], lease, cancelled, until=until)
        get_started = time.time()
        rows = inventory(client, lease, cancelled, until=until)
        get_seconds += time.time() - get_started
        heartbeat_fresh(pulses[-1], lease, cancelled, until=until)
        matches = [row for row in rows if row.get("name") == lease["name"]]
        observations.append({"observedAt": time.time(), "exactNameMatches": len(matches)})
        if len(matches) > 1:
            raise ValueError("Ambiguous exact-name provider instances cannot be adopted")
        if matches:
            selected = observable_identity(matches[0], lease, payload, baseline["existingInstanceIds"])
            if time.time() - pulses[-1]["ownerHeartbeatAt"] > 20:
                pulses.append(pulse(refresh, lease, "poll_refresh", enrollments, expected_state, digest,
                                    cancelled, until=until, previous=pulses[-1]))
            guard(lease, cancelled, until=until)
            get_started = time.time()
            detail = client.request("GET", "/instances/" + selected["id"])
            get_seconds += time.time() - get_started
            heartbeat_fresh(pulses[-1], lease, cancelled, until=until)
            if get_seconds > 60:
                raise TimeoutError("Bounded provider GET reconciliation exhausted")
            verified = observable_identity(detail, lease, payload, baseline["existingInstanceIds"])
            if verified["id"] != selected["id"]:
                raise ValueError("Provider detail changed the exact candidate identity")
            # Final synchronous refresh drains before returning to the ordinary startup owner.
            pulses.append(pulse(refresh, lease, "before_accept", enrollments, expected_state,
                                digest, cancelled, until=until, previous=pulses[-1]))
            return selected["id"], {"kind": "acephale-uncertain-launch-reconciliation-v1", "verified": True,
                "startedAt": started, "completedAt": time.time(), "maximumReconciliationSeconds": 300,
                "maximumGetPollingSeconds": 60, "getPollingSeconds": get_seconds,
                "postAttempts": 1, "baseline": baseline, "observations": observations,
                "listIdentity": selected, "detailIdentity": verified, "heartbeats": pulses,
                "originalFailureRetained": True, "reservationReleased": False,
                "originalSetupDeadline": lease["setupDeadline"], "originalHardDeadline": lease["deadline"],
                "backgroundPublisherStarted": False}
        pause = min(3, max(0, until - time.time()), max(0, 60 - get_seconds))
        time.sleep(pause)
        get_seconds += pause
