"""Narrow replacement admission while an uncertain launch remains fully funded.

An absent provider listing is not termination evidence. Two existing, independently
hosted controllers must remain dedicated to the predecessor's exact name.
"""
from __future__ import annotations

import re

import control
import lambda_gpu_watchdog as watchdog

PROFILE = "acephale-unresolved-launch-fence-v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identities(value):
    return {(row["enrollment"]["controllerId"], row["enrollment"]["hostId"])
            for row in value["controllers"]}


def checked_fence(ledger: dict, value: dict, now: float, *, current_lease_id=None) -> dict:
    pending = [row for row in ledger["leases"] if row["id"] != current_lease_id and row["status"] != "terminated"]
    require(len(pending) == 1, "Exactly one unresolved predecessor is required")
    previous = pending[0]
    require(previous["status"] == "launch_unknown" and previous.get("instanceId") is None
            and bool(previous.get("studyReservation")), "Only an unknown funded launch without an instance ID can be fenced")
    require(isinstance(value, dict) and value.get("version") == 1 and value.get("profile") == PROFILE
            and value.get("contentHash") == control.digest({k: v for k, v in value.items() if k != "contentHash"})
            and value.get("planHash") == ledger["planHash"]
            and value.get("financialBindingHash") == control._financial_binding_hash(ledger)
            and value.get("financialBindingChanged") is False and value.get("predecessorReservationRetained") is True
            and value.get("predecessor") == {"id": previous["id"], "name": previous["name"], "leaseHash": control.digest(previous)},
            "Fence does not preserve the exact unresolved lease and original financial binding")
    observed = control.finite_number(value.get("observedAt"), "fence observation")
    expires = control.finite_number(value.get("expiresAt"), "fence expiry")
    require(0 <= now - observed <= 120 and observed < expires <= observed + 120 and now < expires,
            "Fresh bounded unresolved-launch observations required")
    rows = value.get("controllers")
    require(isinstance(rows, list) and len(rows) == 2, "Two independently hosted old-name fences required")
    ids, hosts, regions, stacks = set(), set(), set(), set()
    for row in rows:
        enrollment, state = row.get("enrollment", {}), row.get("state", {})
        watchdog.checked_state(state)
        host = enrollment.get("hostId", "")
        match = re.fullmatch(r"arn:aws:lambda:([a-z0-9-]+):(\d{12}):function:(acephale-[a-z0-9-]+)", host)
        require(match is not None, "Exact owned Lambda controller ARN required")
        region, account, name = match.groups()
        require(enrollment.get("controllerId") == name and enrollment.get("profile") == control.PROFILE
                and enrollment.get("hostingKind") == "aws_lambda" and enrollment.get("controllerKind") == "independent_always_on"
                and enrollment.get("readOnlyProbeSucceeded") is True and enrollment.get("recoveryTestPassed") is True
                and enrollment.get("codeSha256") == control.sha256(control.HERE / "lambda_gpu_watchdog.py")
                and re.fullmatch(r"[a-f0-9]{64}", enrollment.get("recoveryEvidenceSha256", ""))
                and 0 < control.finite_number(enrollment.get("maxPollSeconds"), "poll interval") <= 60,
                "Verified existing recovery controller required")
        require(0 <= now - control.finite_number(enrollment.get("verifiedAt"), "controller observation") <= 120,
                "Stale controller enrollment")
        for key, expected in {"leaseId": previous["id"], "expectedName": previous["name"], "planHash": ledger["planHash"],
                              "deadline": previous["deadline"], "setupDeadline": previous["setupDeadline"]}.items():
            require(enrollment.get(key) == expected and state.get(key) == expected, "Controller no longer owns the unresolved name")
        require(state.get("instanceId") is None and state.get("reservedAt") == previous["reservedAt"]
                and state.get("ready") is previous["ready"]
                and state.get("status") in {"reserved", "launching", "launch_unknown"}
                and now - state["ownerHeartbeatAt"] > 120, "Prior controller heartbeat must remain expired")
        result = enrollment.get("observed", {})
        at = control.finite_number(result.get("observedAt"), "actual controller result")
        require(0 <= now - at <= 120 and at <= observed
                and result.get("stateHash") == control.digest(state)
                and result.get("leaseId") == previous["id"] and result.get("expectedName") == previous["name"]
                and result.get("instanceId") is None and result.get("observedStatus") == "absent"
                and result.get("readOnlyProbeSucceeded") is True
                and result.get("terminationRequested") is False and result.get("terminationVerified") is False
                and result.get("reason") == watchdog.reason(state, at)
                and result.get("reason") in {"owner_heartbeat_expired", "setup_deadline", "lease_deadline"},
                "Actual absent-name fence observation required, not an invented termination")
        stack, rule, function = row.get("stack", {}), row.get("schedule", {}), row.get("function", {})
        deployment = row.get("deploymentId", "")
        require(re.fullmatch(r"acephale-[a-z0-9-]{4,35}", deployment)
                and name in {deployment + "-1", deployment + "-2"}
                and stack.get("StackName") == name
                and re.fullmatch(re.escape(f"arn:aws:cloudformation:{region}:{account}:stack/{name}/") + r"[a-f0-9-]{36}", stack.get("StackId", ""))
                and stack.get("StackStatus") in {"CREATE_COMPLETE", "UPDATE_COMPLETE"}
                and {"Key": "AcephaleDeployment", "Value": deployment} in stack.get("Tags", [])
                and {"OutputKey": "FunctionArn", "OutputValue": host} in stack.get("Outputs", []),
                "Actual owned controller stack identity required")
        rule_arn = f"arn:aws:events:{region}:{account}:rule/{name}"
        require(rule.get("Name") == name and rule.get("Arn") == rule_arn and rule.get("State") == "ENABLED"
                and rule.get("ScheduleExpression") == "rate(1 minute)"
                and isinstance(row.get("targets"), list) and len(row["targets"]) == 1
                and row["targets"][0].get("Id") == "cleanup" and row["targets"][0].get("Arn") == host,
                "Old exact-name schedule must remain enabled")
        concurrency = row.get("reservedConcurrency", "missing")
        require(function.get("FunctionArn") == host and function.get("State") == "Active"
                and function.get("LastUpdateStatus") == "Successful"
                and (concurrency is None or type(concurrency) is int and concurrency > 0),
                "Old scheduled function must remain callable")
        permission = row.get("invokePermission", {})
        principal = permission.get("Principal")
        conditions = permission.get("Condition", {})
        source_arns = [body.get("AWS:SourceArn") for kind, body in conditions.items()
                       if kind in {"ArnLike", "ArnEquals", "StringEquals"} and isinstance(body, dict)]
        require(permission.get("Effect") == "Allow" and permission.get("Action") == "lambda:InvokeFunction"
                and permission.get("Resource") == host and principal in ({"Service": "events.amazonaws.com"}, "events.amazonaws.com")
                and rule_arn in source_arns, "Exact schedule invocation permission required")
        ids.add(name)
        hosts.add(host)
        regions.add(region)
        stacks.add(stack["StackId"])
    require(all(len(items) == 2 for items in (ids, hosts, regions, stacks)), "Old fences must remain independent in two regions")
    previous_controllers = {(row.get("controllerId"), row.get("hostId")) for row in previous.get("watchdogs", [])}
    require(identities(value) == previous_controllers, "Fence must preserve the controllers recorded for the uncertain launch")
    return value


def check_new_controllers(fence: dict, enrollments: list[dict]) -> None:
    old = identities(fence)
    require(not ({row[0] for row in old} & {row.get("controllerId") for row in enrollments})
            and not ({row[1] for row in old} & {row.get("hostId") for row in enrollments}),
            "Replacement must use two new controllers and preserve both predecessor fences")
