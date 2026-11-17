"""GitHub-specific launch/fence admission, separate from the AWS contract."""
from __future__ import annotations

import os
from datetime import datetime

import github_watchdog_protocol as p
from lambda_gpu_watchdog import number, reason, require


def stamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def checked_qualification_transfer(record, key, binding, proofs, now):
    """Explicit operator-signed transport of tested code, never job readiness."""
    value = p.unseal(record, key)
    ids = {row["controllerId"] for row in binding["controllers"]}
    require(type(proofs) is dict and set(proofs) == ids,
            "Both original controller recovery proofs are required")
    old = [p.checked_binding(p.unseal(proofs[cid]["binding"], key)) for cid in sorted(ids)]
    source = {"id": old[0]["repositoryId"], "full_name": old[0]["repository"], "private": True}
    destination = {"id": binding["repositoryId"], "full_name": binding["repository"], "private": True}
    require(source["id"] != destination["id"] and source["full_name"] != destination["full_name"]
        and all(row["repositoryId"] == source["id"] and row["repository"] == source["full_name"] for row in old),
        "Qualification transfer requires one exact separate source repository")
    require(value.get("kind") == "acephale-github-qualification-transfer-v1"
        and value.get("sourceRepository") == source and value.get("destinationRepository") == destination
        and value.get("destinationBindingHash") == p.digest(binding)
        and value.get("sourceCommit") == binding["sourceCommit"]
        and value.get("sourceFiles") == binding["sourceFiles"]
        and value.get("workflowSha256") == binding["workflowSha256"]
        and value.get("qualificationHashes") == {cid: p.digest(proofs[cid]) for cid in sorted(ids)}
        and value.get("currentJobsPerformedHistoricalRecovery") is False
        and value.get("freshDestinationEnrollmentRequired") is True
        and number(value.get("authorizedAt")) and value["authorizedAt"] <= now,
        "Explicit same-version repository qualification transfer required")
    for cid in sorted(ids):
        qualified_version(proofs[cid], key, binding, cid, now, transfer=value)
    return value


def qualified_version(proof, key, binding, controller_id, now, *, transfer=None):
    old = p.checked_binding(p.unseal(proof["binding"], key))
    recovery = p.unseal(proof["recovery"], key)
    request = p.unseal(recovery["requestEvidence"], key)
    state = p.check_owner(request["ownerRecord"], key, old)["state"]
    same_repository = old["repositoryId"] == binding["repositoryId"] and old["repository"] == binding["repository"]
    transferred = (transfer is not None
        and transfer.get("sourceRepository") == {"id": old["repositoryId"], "full_name": old["repository"], "private": True}
        and transfer.get("destinationBindingHash") == p.digest(binding)
        and transfer.get("qualificationHashes", {}).get(controller_id) == p.digest(proof))
    require(old["sourceFiles"] == binding["sourceFiles"] and old["sourceCommit"] == binding["sourceCommit"]
        and old["workflowSha256"] == binding["workflowSha256"] and (same_repository or transferred),
        "Recovery tested a different backend version")
    require(recovery.get("kind") == "acephale-github-recovery-v1"
        and request.get("kind") == "acephale-github-termination-ack-v1"
        and recovery.get("controllerId") == request.get("controllerId") == controller_id
        and recovery.get("bindingHash") == request.get("bindingHash") == p.digest(old)
        and recovery.get("identity") == request.get("identity")
        and recovery.get("sourceFiles") == request.get("sourceFiles") == binding["sourceFiles"],
        "Recovery evidence lacks exact controller/code identity")
    a, b = request["observed"], recovery["observed"]
    require(state.get("purpose") == "cleanup_canary" and state.get("recoveryControllerId") == controller_id
        and state["deadline"] - state["reservedAt"] <= 600 and state.get("instanceId")
        and a.get("terminationRequested") is True and b.get("terminationVerified") is True
        and a.get("instanceId") == b.get("instanceId") == state["instanceId"]
        and a.get("leaseId") == b.get("leaseId") == state["leaseId"]
        and a.get("expectedName") == b.get("expectedName") == state["expectedName"]
        and b.get("observedStatus") in {"absent", "terminated"}
        and number(request.get("recordedAt")) and number(recovery.get("recordedAt"))
        and request["recordedAt"] <= recovery["recordedAt"] <= now,
        "An actual exact-instance canary termination and absence are required")
    return p.digest(proof)


def enrollments(data, ledger, lease, now, source_files, *, key=None, fence=False):
    """Prelaunch admission (or explicit expired predecessor fence), not runtime readiness.

Active study phases use check_ack's ready-dependent deadline rule and their
current authoritative lease. This entrypoint intentionally retains setup bounds
because control.launch invokes it before paid dispatch.
    """
    key = key or os.environ["ACEPHALE_WATCHDOG_HMAC_KEY"]
    require(data.get("version") == 1 and data.get("backend") == p.BACKEND,
            "Explicit Actions backend required")
    binding = p.checked_binding(p.unseal(data["binding"], key))
    require(binding["sourceFiles"] == source_files, "Current controller source closure differs")
    require(binding["leaseIdentity"] == {"leaseId": lease["id"], "expectedName": lease["name"],
        "planHash": ledger["planHash"], "reservedAt": lease["reservedAt"],
        "setupDeadline": lease["setupDeadline"], "deadline": lease["deadline"]}, "Wrong funded lease assignment")
    require(binding["leasePolicy"] == p.lease_policy(lease),
            "Funded canary policy differs from controller binding")
    observation = p.unseal(data["apiObservation"], key)
    require(observation.get("kind") == "acephale-github-api-observation-v1"
        and observation.get("bindingHash") == p.digest(binding)
        and number(observation.get("observedAt")) and 0 <= now - observation["observedAt"] <= 60,
        "Fresh actual GitHub observation required")
    repo, run, jobs = observation["repository"], observation["run"], observation["jobs"]
    require(repo.get("id") == binding["repositoryId"] and repo.get("full_name") == binding["repository"]
        and repo.get("private") is True, "Dedicated private repository identity changed")
    require(run.get("head_sha") == binding["workflowCommit"] and run.get("path") == binding["workflowPath"]
        and run.get("event") == "workflow_dispatch" and run.get("status") == "in_progress"
        and run.get("repository", {}).get("id") == binding["repositoryId"], "Current exact workflow is not running")
    require(type(jobs) is list and len(jobs) == 2
        and {j.get("name") for j in jobs} == {"watchdog_a", "watchdog_b"}, "Exact two running jobs required")
    require(type(data.get("controllers")) is list and len(data["controllers"]) == 2, "Two live signed ACKs required")
    transfer = None
    if data.get("qualificationTransfer") is not None:
        transfer = checked_qualification_transfer(data["qualificationTransfer"], key, binding,
                                                   data.get("qualification"), now)
    values, job_ids, runner_ids = [], set(), set()
    for config in binding["controllers"]:
        matching = [v for v in data["controllers"] if p.unseal(v, key).get("controllerId") == config["controllerId"]]
        require(len(matching) == 1, "Missing or duplicate controller ACK")
        ack = p.check_ack(matching[0], key, binding, config["controllerId"], now,
                          exact_owner=data.get("ownerRecord"), healthy=not fence)
        identity, state = ack["identity"], p.check_owner(ack["ownerRecord"], key, binding)["state"]
        job = next(j for j in jobs if j["name"] == config["jobName"])
        started = stamp(job["started_at"])
        require(job.get("status") == "in_progress" and job.get("conclusion") is None
            and job.get("run_id") == run["id"] and job.get("head_sha") == binding["workflowCommit"]
            and identity.get("repositoryId") == binding["repositoryId"]
            and identity.get("runId") == run["id"] and identity.get("runAttempt") == run["run_attempt"]
            and identity.get("jobId") == job["id"] and identity.get("jobName") == config["jobName"]
            and type(job.get("runner_id")) is int and job["runner_id"] > 0
            and identity.get("runnerId") == job["runner_id"] and identity.get("runnerName") == job["runner_name"]
            and identity.get("jobStartedAt") == started
            and identity.get("controllerExpiresAt") == started + p.CONTROLLER_SECONDS
            and identity.get("cleanupUntil") == started + p.CLEANUP_SECONDS
            and identity.get("jobTimeoutMinutes") == p.JOB_MINUTES,
            "Controller identity/lifetime is not backed by current Actions API")
        require(now < identity["controllerExpiresAt"] - p.MARGIN_SECONDS
            and lease["deadline"] <= identity["controllerExpiresAt"] - p.MARGIN_SECONDS,
            "Insufficient actual controller lifetime")
        require(ack.get("sourceFiles") == source_files and ack.get("workflowSha256") == binding["workflowSha256"]
            and ack.get("stateReadErrorType") is None and ack.get("cancelled") is False
            and ack.get("sharedControlPlane") == "github.com" and ack.get("regionIndependent") is False
            and ack.get("maxPollSeconds") == 60, "Current controller health/source differs")
        observed = ack["observed"]
        require(number(observed.get("observedAt")) and 0 <= now - observed["observedAt"] <= 60
            and observed.get("leaseId") == lease["id"] and observed.get("expectedName") == lease["name"],
            "Provider observation stale or differently owned")
        if fence:
            require(state.get("instanceId") is None and observed.get("instanceId") is None
                and observed.get("observedStatus") == "absent" and observed.get("terminationVerified") is False
                and observed.get("terminationRequested") is False
                and observed.get("reason") == reason(state, observed["observedAt"])
                and observed.get("reason") in {"owner_heartbeat_expired", "setup_deadline", "lease_deadline"},
                "Actual expired-name fence observation required")
        else:
            require(state.get("instanceId") == lease.get("instanceId") and state.get("ready") == lease["ready"]
                and state.get("status") == lease["status"] and 0 <= now - state["ownerHeartbeatAt"] <= 60
                and now < lease["setupDeadline"] and now < lease["deadline"]
                and observed.get("reason") is None, "Current owned lease is not launch ready")
        canary = lease.get("purpose") == "cleanup_canary"
        if canary:
            require(lease["deadline"] - lease["reservedAt"] <= 600, "Canary exceeds ten minutes")
            recovery_hash = None
        else:
            recovery_hash = qualified_version(data["qualification"][config["controllerId"]], key, binding,
                                             config["controllerId"], now, transfer=transfer)
        host = f"github:{binding['repositoryId']}:{identity['runId']}:{identity['runAttempt']}:{identity['jobId']}"
        values.append({"profile": "acephale-infra-v1", "controllerKind": "bounded_actions_job",
            "hostingKind": "github_actions", "controllerId": config["controllerId"], "hostId": host,
            "leaseId": lease["id"], "expectedName": lease["name"], "planHash": ledger["planHash"],
            "deadline": lease["deadline"], "setupDeadline": lease["setupDeadline"], "maxPollSeconds": 60,
            "readOnlyProbeSucceeded": True, "recoveryTestPassed": not canary,
            "recoveryEvidenceSha256": recovery_hash, "codeSha256": source_files["lambda_gpu_watchdog.py"],
            "backendSourceFiles": source_files, "verifiedAt": ack["verifiedAt"], "observed": observed,
            "controllerExpiresAt": identity["controllerExpiresAt"], "sharedControlPlane": "github.com",
            "regionIndependent": False, "identity": identity, "ackSha256": p.digest(matching[0])})
        job_ids.add(job["id"])
        runner_ids.add(job["runner_id"])
    require(len(job_ids) == len(runner_ids) == 2, "Separate actual jobs and runners required")
    return values


def checked_fence(ledger, value, now, *, current_lease_id=None, key=None):
    """Explicit signed backend migration; never overwrite historical AWS rows."""
    import control
    key = key or os.environ["ACEPHALE_WATCHDOG_HMAC_KEY"]
    pending = [row for row in ledger["leases"] if row["id"] != current_lease_id and row["status"] != "terminated"]
    require(len(pending) == 1, "Exactly one unresolved predecessor required")
    previous = pending[0]
    require(previous["status"] == "launch_unknown" and previous.get("instanceId") is None
            and previous.get("studyReservation"), "Only the retained funded unknown launch may migrate")
    predecessor = {"id": previous["id"], "name": previous["name"], "leaseHash": control.digest(previous)}
    require(value.get("version") == 1 and value.get("profile") == "acephale-github-unresolved-launch-fence-v1"
        and value.get("contentHash") == control.digest({k: v for k, v in value.items() if k != "contentHash"})
        and value.get("predecessor") == predecessor and value.get("planHash") == ledger["planHash"]
        and value.get("financialBindingHash") == control._financial_binding_hash(ledger)
        and value.get("financialBindingChanged") is False and value.get("predecessorReservationRetained") is True,
        "Fence changed original predecessor or financial authority")
    require(number(value.get("observedAt")) and number(value.get("expiresAt"))
        and 0 <= now - value["observedAt"] <= 60 and now < value["expiresAt"] <= value["observedAt"] + 60,
        "Fresh bounded Actions predecessor fence required")
    receipt = value["backendReceipt"]
    binding = p.checked_binding(p.unseal(receipt["binding"], key))
    migration = p.unseal(value["backendMigration"], key)
    old = [{"controllerId": r["controllerId"], "hostId": r["hostId"]} for r in previous.get("watchdogs", [])]
    require(len(old) == 2 and migration.get("kind") == "acephale-github-fence-migration-v1"
        and migration.get("predecessor") == predecessor and migration.get("planHash") == ledger["planHash"]
        and migration.get("financialBindingHash") == value["financialBindingHash"]
        and migration.get("previousControllers") == old and migration.get("newBindingHash") == p.digest(binding)
        and migration.get("originalControllerHistoryPreserved") is True
        and migration.get("originalLeaseUnchanged") is True and migration.get("financialHoldsRetained") is True
        and number(migration.get("authorizedAt")) and migration["authorizedAt"] <= now
        and isinstance(migration.get("reason"), str) and 0 < len(migration["reason"]) <= 1024,
        "Explicit signed migration preserving original controller history required")
    files = {name: control.sha256(control.HERE / name) for name in p.SOURCE_NAMES}
    values = enrollments(receipt, ledger, previous, now, files, key=key, fence=True)
    # Controller ordering is canonical in the binding, never inferred from an
    # arbitrary receipt list. Identity extraction remains compatible with the
    # existing no-reuse replacement check in unresolved_launch.
    expected = []
    for e in values:
        ack = next(p.unseal(a, key) for a in receipt["controllers"]
                   if p.unseal(a, key)["controllerId"] == e["controllerId"])
        s = p.check_owner(ack["ownerRecord"], key, binding)["state"]
        require(s["status"] == previous["status"] and s["ready"] == previous["ready"]
                and now - s["ownerHeartbeatAt"] > 120, "Old owner heartbeat must remain expired")
        expected.append({"enrollment": e, "state": s})
    require(value.get("controllers") == expected, "Fence controller evidence differs from signed current observations")
    return value
