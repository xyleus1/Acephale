"""One fixed-assignment GitHub job. Cleanup only, never provider launch.

GitHub is a shared control plane. A last authenticated owner record remains a
termination-only fallback when reads or evidence writes are unavailable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import time
from datetime import datetime
from pathlib import Path

import github_watchdog_protocol as protocol
import lambda_gpu_watchdog as core
from github_watchdog_store import GitHubStore

CONTROL_ERRORS = (OSError, RuntimeError, ValueError, TypeError, KeyError)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def job_identity(store, binding, controller, environment, now):
    """Derive job time/identity from actual API responses, not worker claims."""
    core.require(environment.get("GITHUB_REPOSITORY") == binding["repository"]
        and environment.get("GITHUB_REPOSITORY_ID") == str(binding["repositoryId"])
        and environment.get("GITHUB_SHA") == binding["workflowCommit"]
        and environment.get("GITHUB_JOB") == controller["jobName"]
        and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Wrong workflow execution environment")
    run_id, attempt = int(environment["GITHUB_RUN_ID"]), int(environment["GITHUB_RUN_ATTEMPT"])
    run = store.request("GET", f"/actions/runs/{run_id}/attempts/{attempt}")
    jobs = store.request("GET", f"/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    core.require(run.get("id") == run_id and run.get("run_attempt") == attempt
        and run.get("head_sha") == binding["workflowCommit"] and run.get("event") == "workflow_dispatch"
        and run.get("path") == binding["workflowPath"] and run.get("status") == "in_progress"
        and run.get("repository", {}).get("id") == binding["repositoryId"], "Actual workflow identity mismatch")
    core.require(type(jobs.get("total_count")) is int and jobs["total_count"] == 2
                 and len(jobs.get("jobs", [])) == 2, "Exactly two fixed workflow jobs required")
    matches = [j for j in jobs["jobs"] if j.get("name") == controller["jobName"]]
    core.require(len(matches) == 1, "Exact job absent or ambiguous")
    job = matches[0]
    core.require(job.get("run_id") == run_id and job.get("head_sha") == binding["workflowCommit"]
        and job.get("status") == "in_progress" and type(job.get("id")) is int and job["id"] > 0
        and type(job.get("runner_id")) is int and job["runner_id"] > 0
        and job.get("runner_name") == environment.get("RUNNER_NAME"), "Actual running job/runner required")
    started = timestamp(job["started_at"])
    core.require(0 <= now - started <= 600, "Job startup observation too old")
    expires = started + protocol.CONTROLLER_SECONDS
    core.require(binding["leaseIdentity"]["deadline"] <= expires - protocol.MARGIN_SECONDS,
                 "Lease exceeds actual remaining controller lifetime")
    return {"repositoryId": binding["repositoryId"], "repository": binding["repository"],
        "workflowCommit": binding["workflowCommit"], "workflowPath": binding["workflowPath"],
        "runId": run_id, "runAttempt": attempt, "jobId": job["id"], "jobName": job["name"],
        "runnerId": job["runner_id"], "runnerName": job["runner_name"], "jobStartedAt": started,
        "controllerExpiresAt": expires, "cleanupUntil": started + protocol.CLEANUP_SECONDS,
        "jobTimeoutMinutes": protocol.JOB_MINUTES, "observedAt": now}


class Worker:
    def __init__(self, binding, controller_id, key, store, provider, identity, output, *, clock=time.time):
        self.binding = protocol.checked_binding(binding)
        self.controller = next(r for r in binding["controllers"] if r["controllerId"] == controller_id)
        self.key, self.store, self.provider, self.identity = key, store, provider, identity
        self.output, self.clock = Path(output), clock
        self.output.mkdir(parents=True, exist_ok=False)
        self.owner = None
        self.owner_sha = None
        self.ack_sha = None
        self.last_ack = float("-inf")
        self.counter = 0
        self.pending = None
        self.recovery = None
        self.queue = []
        self.cancelled = False
        self.last_read_error = None
        self.claimed = False
        self.last_ack_error = None

    def claim(self):
        if self.claimed:
            return
        value = protocol.seal({"kind": "acephale-github-controller-claim-v1", "identity": self.identity,
            "bindingHash": protocol.digest(self.binding), "controllerId": self.controller["controllerId"]}, self.key)
        try:
            self.store.cas(self.controller["evidenceBranch"], "control/claim.json", value)
        except CONTROL_ERRORS:
            old, _ = self.store.read(self.controller["evidenceBranch"], "control/claim.json")
            core.require(old == value, "Controller branch already claimed by another job")
        self.claimed = True

    def read_owner(self):
        try:
            record, sha = self.store.read(self.binding["stateBranch"], self.binding["statePath"])
            protocol.check_owner(record, self.key, self.binding, self.owner)
            self.owner, self.owner_sha = record, sha
            self.last_read_error = None
        except CONTROL_ERRORS as error:
            self.last_read_error = type(error).__name__
            if self.owner is None:
                raise ValueError("No authenticated lease is available for cleanup") from None
        self.tick_state = self.effective_state()
        return self.tick_state

    def effective_state(self):
        state = dict(protocol.unseal(self.owner, self.key)["state"])
        if self.pending and not state.get("instanceId"):
            state["instanceId"] = self.pending["payload"]["observed"]["instanceId"]
        # A cancelled job must drain its own lease. This never refreshes owner time.
        if self.cancelled or self.clock() >= self.identity["controllerExpiresAt"]:
            state["status"] = "termination_requested"
        return core.checked_state(state)

    def evidence(self, kind, observed, **extra):
        self.counter += 1
        body = {"kind": kind, "backend": protocol.BACKEND, "controllerId": self.controller["controllerId"],
            "sessionId": self.binding["sessionId"], "bindingHash": protocol.digest(self.binding),
            "sourceFiles": self.binding["sourceFiles"], "workflowSha256": self.binding["workflowSha256"],
            "identity": self.identity, "ownerRecord": self.owner, "observed": observed,
            "recordedAt": self.clock(), "sequence": self.counter, **extra}
        signed = protocol.seal(body, self.key)
        filename = f"{self.counter:08d}-{kind.rsplit('-', 2)[-2]}.json"
        with (self.output / filename).open("xb") as stream:
            stream.write(protocol.canonical(signed))
        self.queue.append(("evidence/" + self.binding["sessionId"] + "/" + filename, signed))
        return signed

    def flush(self):
        # Persistence failure must not disable provider cleanup. Local evidence
        # remains available for the fixed workflow's final artifact step.
        while self.queue:
            path, value = self.queue[0]
            try:
                self.store.cas(self.controller["evidenceBranch"], path, value)
                self.queue.pop(0)
            except CONTROL_ERRORS:
                try:
                    retained, _ = self.store.read(self.controller["evidenceBranch"], path)
                    core.require(retained == value, "Immutable evidence path was replaced")
                    self.queue.pop(0)
                except CONTROL_ERRORS:
                    break

    def termination_ack(self, observed):
        self.pending = self.evidence("acephale-github-termination-ack-v1", observed)
        self.flush()

    def cycle(self):
        self.claim()
        prior_owner = self.owner
        state = self.read_owner()
        now = self.clock()
        observed = core.tick(state, self.provider, now, self.controller["controllerId"],
                             refresh_state=self.read_owner, on_termination_ack=self.termination_ack)
        # Keep raw provider fields and credentials out of all records.
        observed["providerObservedAt"] = self.clock()
        effective = self.tick_state
        new_recovery = observed["terminationVerified"] and self.pending and self.recovery is None
        if new_recovery:
            request = self.pending["payload"]["observed"]
            core.require(request["instanceId"] == observed["instanceId"]
                and request["leaseId"] == observed["leaseId"] and request["terminationRequested"] is True,
                "Recovery acknowledgment identity changed")
            self.recovery = self.evidence("acephale-github-recovery-v1", observed, requestEvidence=self.pending)
            path = "recovery/" + self.binding["sessionId"] + ".json"
            self.queue.append((path, self.recovery))
        changed = prior_owner is None or protocol.unseal(prior_owner, self.key)["sequence"] != protocol.unseal(self.owner, self.key)["sequence"]
        force = changed or observed["terminationRequested"] or new_recovery
        if force or self.clock() - self.last_ack >= protocol.ACK_SECONDS:
            owner = protocol.unseal(self.owner, self.key)
            body = {"kind": "acephale-github-watchdog-ack-v1", "backend": protocol.BACKEND,
                "sessionId": self.binding["sessionId"], "bindingHash": protocol.digest(self.binding),
                "controllerId": self.controller["controllerId"], "identity": self.identity,
                "sourceFiles": self.binding["sourceFiles"], "workflowSha256": self.binding["workflowSha256"],
                "ownerRecord": self.owner, "ownerRecordHash": protocol.digest(self.owner),
                "ownerSequence": owner["sequence"], "ownerBlobSha": self.owner_sha,
                "effectiveState": effective, "observed": observed, "verifiedAt": self.clock(),
                "stateReadErrorType": self.last_read_error, "cancelled": self.cancelled,
                "terminationAcknowledgment": self.pending, "recoveryEvidence": self.recovery,
                "sharedControlPlane": "github.com", "regionIndependent": False, "maxPollSeconds": 60}
            signed = protocol.seal(body, self.key)
            with (self.output / "latest-ack.json").open("wb") as stream:
                stream.write(protocol.canonical(signed))
            try:
                # On process restart or ambiguous prior PUT, learn the current
                # blob but never overwrite another job's signed enrollment.
                if self.ack_sha is None:
                    try:
                        old, self.ack_sha = self.store.read(self.controller["evidenceBranch"], protocol.ACK_PATH)
                        old_body = protocol.unseal(old, self.key)
                        core.require(old_body.get("identity") == self.identity, "ACK branch belongs to another job")
                    except CONTROL_ERRORS as error:
                        if getattr(error, "status", None) != 404:
                            raise
                self.ack_sha = self.store.cas(self.controller["evidenceBranch"], protocol.ACK_PATH, signed, self.ack_sha)
                self.last_ack = self.clock()
            except CONTROL_ERRORS:
                # A PUT can commit even when its response is lost. Re-read the
                # exact signed branch and advance only this job's expected CAS
                # token, so one lost response cannot poison every later ACK.
                try:
                    current, sha = self.store.read(self.controller["evidenceBranch"], protocol.ACK_PATH)
                    prior = protocol.unseal(current, self.key)
                    core.require(prior.get("identity") == self.identity
                        and prior.get("bindingHash") == protocol.digest(self.binding)
                        and type(prior.get("ownerSequence")) is int
                        and prior["ownerSequence"] <= owner["sequence"], "ACK CAS ownership changed")
                    self.ack_sha = sha
                except CONTROL_ERRORS as error:
                    self.last_ack_error = type(error).__name__
        self.flush()
        return observed


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--binding", type=Path, required=True)
    parser.add_argument("--controller-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    key = os.environ["ACEPHALE_WATCHDOG_HMAC_KEY"]
    binding = protocol.checked_binding(protocol.unseal(json.loads(args.binding.read_text()), key))
    here = Path(__file__).resolve().parent
    for name, expected in binding["sourceFiles"].items():
        core.require(hashlib.sha256((here / name).read_bytes()).hexdigest() == expected, "Worker source pin mismatch")
    workflow = Path(os.environ["GITHUB_WORKSPACE"]) / binding["workflowPath"]
    core.require(hashlib.sha256(workflow.read_bytes()).hexdigest() == binding["workflowSha256"], "Workflow source changed")
    controller = next(r for r in binding["controllers"] if r["controllerId"] == args.controller_id)
    store = GitHubStore(binding["repository"], os.environ["GITHUB_TOKEN"], write_branch=controller["evidenceBranch"])
    identity = job_identity(store, binding, controller, os.environ, time.time())
    worker = Worker(binding, args.controller_id, key, store, core.Provider(os.environ["LAMBDA_API_KEY"]),
                    identity, args.output)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: setattr(worker, "cancelled", True))
    while time.time() < identity["cleanupUntil"]:
        started = time.monotonic()
        try:
            result = worker.cycle()
            print(json.dumps({"controllerId": args.controller_id, "observedAt": time.time(),
                              "terminationVerified": result["terminationVerified"]}), flush=True)
        except Exception as error:  # noqa: BLE001 - preserve cleanup loop after unexpected external failures
            print(json.dumps({"controllerId": args.controller_id, "errorType": type(error).__name__,
                              "observedAt": time.time()}), flush=True)
        time.sleep(max(0, protocol.POLL_SECONDS - (time.monotonic() - started)))
    worker.flush()
    return 0 if worker.recovery is not None else 2


if __name__ == "__main__":
    raise SystemExit(main())
