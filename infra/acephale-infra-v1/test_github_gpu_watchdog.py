"""Actual watchdog/public admission with only external observations intercepted."""
import base64
import copy
import hashlib
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import control
import github_gpu_watchdog as worker
import github_watchdog_admission as admission
import github_watchdog_protocol as p
import lambda_gpu_watchdog as core
from github_watchdog_store import GitHubFailure, GitHubStore

KEY = base64.b64encode(b"x" * 32).decode()


def binding():
    identifier = "11111111-1111-4111-8111-111111111111"
    return {"kind": p.KIND, "backend": p.BACKEND, "repository": "owner/private-control", "repositoryId": 42,
        "sessionId": "22222222-2222-4222-8222-222222222222", "workflowPath": ".github/workflows/watchdogs.yml",
        "workflowCommit": "a" * 40, "workflowSha256": "b" * 64, "sourceCommit": "c" * 40,
        "stateBranch": "owner-state-222222222222", "statePath": p.STATE_PATH,
        "sharedControlPlane": "github.com", "regionIndependent": False,
        "leasePolicy": {"purpose": "cleanup_canary", "recoveryControllerId": "acephale-gha-a"},
        "sourceFiles": {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest() for name in p.SOURCE_NAMES},
        "controllers": [{"controllerId": "acephale-gha-a", "jobName": "watchdog_a", "evidenceBranch": "watchdog-a-222222222222"},
                        {"controllerId": "acephale-gha-b", "jobName": "watchdog_b", "evidenceBranch": "watchdog-b-222222222222"}],
        "leaseIdentity": {"leaseId": identifier, "expectedName": "acephale-infra-" + identifier,
            "planHash": "d" * 64, "reservedAt": 1000, "setupDeadline": 1500, "deadline": 1600}}


def state(b):
    return {**b["leaseIdentity"], "version": 1, "profile": "acephale-infra-v1", "instanceId": "instance1",
        "status": "active", "ready": False, "ownerHeartbeatAt": 1100, "ownerHeartbeatTimeoutSeconds": 120,
        "purpose": "cleanup_canary", "recoveryControllerId": "acephale-gha-a"}


def identity(b, index=0):
    return {"repositoryId": b["repositoryId"], "repository": b["repository"], "workflowCommit": b["workflowCommit"],
        "workflowPath": b["workflowPath"], "runId": 10, "runAttempt": 1, "jobId": 20 + index,
        "jobName": b["controllers"][index]["jobName"], "runnerId": 30 + index, "runnerName": "runner" + str(index),
        "jobStartedAt": 900, "controllerExpiresAt": 900 + p.CONTROLLER_SECONDS,
        "cleanupUntil": 900 + p.CLEANUP_SECONDS, "jobTimeoutMinutes": p.JOB_MINUTES, "observedAt": 1100}


class MemoryStore:
    def __init__(self, b, record):
        self.rows = {(b["stateBranch"], b["statePath"]): (record, "1" * 40)}
        self.owner_branch = b["stateBranch"]
        self.owner_error = None
        self.writes_fail = False
        self.lose_ack_response = False
        self.calls = []

    def read(self, branch, path):
        self.calls.append(("GET", branch, path))
        if branch == self.owner_branch and self.owner_error:
            raise self.owner_error
        if (branch, path) not in self.rows:
            raise GitHubFailure(404)
        return copy.deepcopy(self.rows[(branch, path)])

    def cas(self, branch, path, value, prior_sha=None):
        self.calls.append(("PUT", branch, path))
        if self.writes_fail:
            raise GitHubFailure(429)
        prior = self.rows.get((branch, path))
        if (prior and prior[1] != prior_sha) or (not prior and prior_sha is not None):
            raise GitHubFailure(409)
        sha = hashlib.sha1(p.canonical(value)).hexdigest()
        self.rows[(branch, path)] = (copy.deepcopy(value), sha)
        if path == p.ACK_PATH and self.lose_ack_response:
            self.lose_ack_response = False
            raise GitHubFailure()
        return sha


class Provider:
    def __init__(self, s):
        self.instance = {"id": s["instanceId"], "name": s["expectedName"], "status": "active"}
        self.calls = []
        self.asynchronous = False

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET":
            return {"data": [copy.deepcopy(self.instance)] if self.instance else []}
        if path != "/instance-operations/terminate" or payload != {"instance_ids": [self.instance["id"]]}:
            raise AssertionError("Worker attempted unowned operation")
        result = copy.deepcopy(self.instance)
        self.instance = {**self.instance, "status": "terminating"} if self.asynchronous else None
        return {"data": {"terminated_instances": [result]}}


class GitHubWatchdogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = 1100
        self.b = binding()
        self.s = state(self.b)
        self.record = p.owner_record(self.b, self.s, 0, KEY)
        self.store = MemoryStore(self.b, self.record)
        self.provider = Provider(self.s)
        self.w = worker.Worker(self.b, "acephale-gha-a", KEY, self.store, self.provider,
                               identity(self.b), Path(self.tmp.name) / "worker", clock=lambda: self.now)
        self.timepatch = patch.object(core.time, "time", lambda: self.now)
        self.timepatch.start()
        self.addCleanup(self.timepatch.stop)

    def test_real_tick_healthy_observation_and_signed_ack(self):
        result = self.w.cycle()
        self.assertFalse(result["terminationRequested"])
        ack, _ = self.store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        self.assertEqual(p.check_ack(ack, KEY, self.b, "acephale-gha-a", self.now, exact_owner=self.record)["ownerSequence"], 0)
        self.assertEqual([c[0] for c in self.provider.calls], ["GET"])

    def test_expired_owner_terminates_one_exact_id_and_records_real_recovery(self):
        self.w.cycle()
        self.now = 1221
        result = self.w.cycle()
        self.assertTrue(result["terminationVerified"])
        self.assertEqual([c for c in self.provider.calls if c[0] == "POST"],
                         [("POST", "/instance-operations/terminate", {"instance_ids": ["instance1"]})])
        proof = {"binding": p.seal(self.b, KEY), "recovery": self.w.recovery}
        self.assertEqual(len(admission.qualified_version(proof, KEY, self.b, "acephale-gha-a", self.now)), 64)
        for path in self.w.output.glob("*.json"):
            p.unseal(json.loads(path.read_text()), KEY)

    def test_all_state_failures_keep_cached_cleanup_live(self):
        for error in (GitHubFailure(401), GitHubFailure(403), GitHubFailure(404), GitHubFailure(429),
                      TimeoutError(), ValueError("malformed")):
            with self.subTest(error=type(error).__name__, status=getattr(error, "status", None)):
                self.w.cycle()
                self.store.owner_error = error
                self.store.writes_fail = True
                self.now = 1221
                self.assertTrue(self.w.cycle()["terminationVerified"])
                self.assertTrue(self.w.recovery)
                break_if_done = self.provider.instance is None
                self.assertTrue(break_if_done)
                self.store.owner_error, self.store.writes_fail = None, False
                self.provider.instance = {"id": "instance1", "name": self.s["expectedName"], "status": "active"}
                self.w.pending, self.w.recovery = None, None
                self.now = 1100

    def test_invalid_signature_does_not_erase_cached_identity(self):
        self.w.cycle()
        corrupt = copy.deepcopy(self.record)
        corrupt["payload"]["state"]["instanceId"] = "other"
        self.store.rows[(self.b["stateBranch"], p.STATE_PATH)] = (corrupt, "2" * 40)
        self.now = 1221
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertEqual(self.provider.calls[-2][2], {"instance_ids": ["instance1"]})

    def test_no_initial_authenticated_state_never_calls_provider(self):
        self.store.owner_error = GitHubFailure(404)
        with self.assertRaises(ValueError):
            self.w.cycle()
        self.assertEqual(self.provider.calls, [])

    def test_owner_replay_cannot_refresh_freshness(self):
        self.w.cycle()
        fresh = p.owner_record(self.b, {**self.s, "ownerHeartbeatAt": 1150}, 1, KEY, self.record)
        self.store.rows[(self.b["stateBranch"], p.STATE_PATH)] = (fresh, "2" * 40)
        self.now = 1150
        self.w.cycle()
        self.store.rows[(self.b["stateBranch"], p.STATE_PATH)] = (self.record, "1" * 40)
        self.now = 1271
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertEqual(p.unseal(self.w.owner, KEY)["sequence"], 1)

    def test_ack_ambiguous_success_recovers_exact_cas(self):
        self.store.lose_ack_response = True
        self.w.cycle()
        self.assertIsNotNone(self.w.ack_sha)
        self.now += 41
        self.w.cycle()
        self.assertEqual(self.w.last_ack, self.now)

    def test_ack_write_failure_does_not_block_actual_cleanup(self):
        self.w.cycle()
        self.store.writes_fail = True
        self.now = 1221
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertTrue(self.w.queue)

    def test_async_termination_preserves_ack_and_no_second_post(self):
        self.provider.asynchronous = True
        self.now = 1221
        self.assertFalse(self.w.cycle()["terminationVerified"])
        self.assertFalse(self.w.cycle()["terminationRequested"])
        self.provider.instance = None
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertEqual(sum(c[0] == "POST" for c in self.provider.calls), 1)

    def test_clean_absence_without_actual_termination_is_not_qualification(self):
        self.provider.instance = None
        self.now = 1221
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertIsNone(self.w.recovery)

    def test_cancel_terminates_without_redating_owner(self):
        self.w.cancelled = True
        self.assertTrue(self.w.cycle()["terminationVerified"])
        self.assertEqual(p.unseal(self.w.owner, KEY)["state"]["ownerHeartbeatAt"], 1100)

    def test_duplicate_or_changed_provider_identity_never_terminated(self):
        self.now = 1221
        for item in ({"id": "other", "name": self.s["expectedName"]},
                     {"id": "instance1", "name": "unrelated"}):
            self.provider.instance = item
            with self.assertRaises(ValueError):
                self.w.cycle()
        self.assertFalse(any(c[0] == "POST" for c in self.provider.calls))

    def test_signed_state_cannot_change_original_deadlines_or_instance(self):
        for field, value in (("deadline", 1700), ("setupDeadline", 1600), ("instanceId", "other"),
                             ("ownerHeartbeatAt", 1099), ("ready", False)):
            prior_state = {**self.s, "ready": True}
            prior = p.owner_record(self.b, prior_state, 0, KEY)
            with self.subTest(field=field), self.assertRaises(ValueError):
                p.owner_record(self.b, {**prior_state, field: value}, 1, KEY, prior)

    def test_startup_exact_ack_and_steady_prior_ack_are_distinct(self):
        self.w.cycle()
        ack, _ = self.store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        newer = p.owner_record(self.b, {**self.s, "ownerHeartbeatAt": 1120}, 1, KEY, self.record)
        p.check_ack(ack, KEY, self.b, "acephale-gha-a", 1120)
        with self.assertRaises(ValueError):
            p.check_ack(ack, KEY, self.b, "acephale-gha-a", 1120, exact_owner=newer)

    def test_cleanup_ack_is_not_readiness(self):
        self.w.cycle()
        self.now = 1221
        self.w.cycle()
        ack, _ = self.store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        with self.assertRaises(ValueError):
            p.check_ack(ack, KEY, self.b, "acephale-gha-a", self.now)
        p.check_ack(ack, KEY, self.b, "acephale-gha-a", self.now, healthy=False)

    def test_cas_port_uses_blob_sha_and_fixed_branch(self):
        store = GitHubStore("owner/repo", "private", write_branch="owner-state-example")
        with patch.object(store, "request", return_value={"content": {"sha": "c" * 40}}) as call:
            store.cas("owner-state-example", p.STATE_PATH, self.record, "b" * 40)
            self.assertEqual(call.call_args.args[2]["sha"], "b" * 40)
        with self.assertRaises(ValueError):
            store.cas("main", p.STATE_PATH, self.record)

    def test_actual_repository_request_removes_only_root_trailing_slash(self):
        captured = []
        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self, maximum):
                self.maximum = maximum
                return b'{"id":42}'
        class Opener:
            def open(self, request, timeout):
                captured.append((request.full_url, timeout))
                return Response()
        store = GitHubStore("owner/repo", "synthetic")
        with patch("github_watchdog_store.urllib.request.build_opener", return_value=Opener()):
            self.assertEqual(store.request("GET", "/"), {"id":42})
            store.request("GET", "/actions/runs/1/attempts/1")
        self.assertEqual(captured, [("https://api.github.com/repos/owner/repo",6),
            ("https://api.github.com/repos/owner/repo/actions/runs/1/attempts/1",6)])

    def test_ready_transition_forces_observed_ack_before_period(self):
        self.w.cycle()
        newer = p.owner_record(self.b, {**self.s, "ready": True, "ownerHeartbeatAt": 1101}, 1, KEY, self.record)
        self.store.rows[(self.b["stateBranch"], p.STATE_PATH)] = (newer, "2" * 40)
        self.now = 1101
        self.w.cycle()
        ack, _ = self.store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        self.assertEqual(p.check_ack(ack, KEY, self.b, "acephale-gha-a", self.now, exact_owner=newer)["ownerSequence"], 1)

    def test_every_new_owner_sequence_forces_actual_ack_without_status_change(self):
        self.w.cycle()
        newer = p.owner_record(self.b, {**self.s, "ownerHeartbeatAt": 1101}, 1, KEY, self.record)
        self.store.rows[(self.b["stateBranch"], p.STATE_PATH)] = (newer, "2" * 40)
        self.now = 1101
        before = len(self.provider.calls)
        self.w.cycle()
        self.assertEqual(len(self.provider.calls), before + 1)
        ack, _ = self.store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        self.assertEqual(p.check_ack(ack, KEY, self.b, "acephale-gha-a", self.now, exact_owner=newer)["ownerSequence"], 1)

    def test_claim_blocks_second_job_before_any_provider_operation(self):
        self.w.cycle()
        changed = {**identity(self.b), "jobId": 999}
        other = worker.Worker(self.b, "acephale-gha-a", KEY, self.store, self.provider,
            changed, Path(self.tmp.name) / "other", clock=lambda: self.now)
        before = len(self.provider.calls)
        with self.assertRaises(ValueError):
            other.cycle()
        self.assertEqual(len(self.provider.calls), before)

    def test_rate_reset_blocks_github_only_until_real_reset(self):
        store = GitHubStore("owner/repo", "private", clock=lambda: self.now)
        error = urllib.error.HTTPError("https://api.github.com", 429, "limited",
            {"Retry-After": "90", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1300"}, None)
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(GitHubFailure):
                store.request("GET", "/actions/runs/1")
            self.assertEqual(store.retry_not_before, 1301)
            with self.assertRaises(GitHubFailure):
                store.request("GET", "/actions/runs/1")
            self.assertEqual(opener.return_value.open.call_count, 1)

    def receipt(self):
        self.w.cycle()
        second = worker.Worker(self.b, "acephale-gha-b", KEY, self.store, Provider(self.s),
            identity(self.b, 1), Path(self.tmp.name) / "second", clock=lambda: self.now)
        second.cycle()
        jobs = [{"id": 20 + i, "run_id": 10, "head_sha": self.b["workflowCommit"],
            "name": "watchdog_" + letter, "status": "in_progress", "conclusion": None,
            "runner_id": 30 + i, "runner_name": "runner" + str(i), "started_at": "1970-01-01T00:15:00Z"}
            for i, letter in enumerate(("a", "b"))]
        run = {"id": 10, "run_attempt": 1, "head_sha": self.b["workflowCommit"],
            "path": self.b["workflowPath"], "event": "workflow_dispatch", "status": "in_progress",
            "repository": {"id": 42}}
        obs = {"kind": "acephale-github-api-observation-v1", "bindingHash": p.digest(self.b),
            "observedAt": self.now, "repository": {"id": 42, "full_name": self.b["repository"], "private": True},
            "run": run, "jobs": jobs}
        data = {"version": 1, "backend": p.BACKEND, "binding": p.seal(self.b, KEY),
            "apiObservation": p.seal(obs, KEY), "ownerRecord": self.record,
            "controllers": [self.store.read(r["evidenceBranch"], p.ACK_PATH)[0] for r in self.b["controllers"]]}
        lease = {"id": self.s["leaseId"], "name": self.s["expectedName"], "reservedAt": self.s["reservedAt"],
            "setupDeadline": self.s["setupDeadline"], "deadline": self.s["deadline"], "instanceId": "instance1",
            "ready": False, "status": "active", "purpose": "cleanup_canary", "recoveryControllerId": "acephale-gha-a", "reservedHours": 1 / 6}
        return data, {"planHash": self.s["planHash"]}, lease

    def test_actual_public_control_admits_only_current_actions_pair(self):
        data, ledger, lease = self.receipt()
        path = Path(self.tmp.name) / "enrollments.json"
        path.write_text(json.dumps(data))
        with patch.dict("os.environ", {"ACEPHALE_WATCHDOG_HMAC_KEY": KEY}):
            rows = control.watchdog_enrollments(path, ledger, lease, self.now)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["hostingKind"] == "github_actions" and not r["regionIndependent"] for r in rows))
        self.assertNotEqual(rows[0]["hostId"], rows[1]["hostId"])

    def test_admission_rejects_stale_job_replay_and_insufficient_lifetime(self):
        data, ledger, lease = self.receipt()
        for mutation in ("completed", "runner", "attempt", "workflow", "old", "public", "lifetime"):
            with self.subTest(mutation=mutation):
                bad = copy.deepcopy(data)
                obs = p.unseal(bad["apiObservation"], KEY)
                if mutation == "completed": obs["jobs"][0]["status"] = "completed"
                if mutation == "runner": obs["jobs"][1]["runner_id"] = obs["jobs"][0]["runner_id"]
                if mutation == "attempt": obs["run"]["run_attempt"] = 2
                if mutation == "workflow": obs["run"]["head_sha"] = "f" * 40
                if mutation == "old": obs["observedAt"] -= 61
                if mutation == "public": obs["repository"]["private"] = False
                if mutation == "lifetime": obs["jobs"][0]["started_at"] = "1969-12-31T18:45:00Z"
                bad["apiObservation"] = p.seal(obs, KEY)
                with self.assertRaises(ValueError):
                    admission.enrollments(bad, ledger, lease, self.now, self.b["sourceFiles"], key=KEY)

    def test_normal_research_lease_requires_actual_recovery_for_both_controllers(self):
        data, ledger, lease = self.receipt()
        lease.pop("purpose")
        data["qualification"] = {}
        with self.assertRaises((ValueError, KeyError)):
            admission.enrollments(data, ledger, lease, self.now, self.b["sourceFiles"], key=KEY)

    def test_actual_job_identity_uses_api_start_and_runner(self):
        data, _, _ = self.receipt()
        obs = p.unseal(data["apiObservation"], KEY)
        environment = {"GITHUB_REPOSITORY": self.b["repository"], "GITHUB_REPOSITORY_ID": "42",
            "GITHUB_SHA": self.b["workflowCommit"], "GITHUB_JOB": "watchdog_a", "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_RUN_ID": "10", "GITHUB_RUN_ATTEMPT": "1", "RUNNER_NAME": "runner0"}
        with patch.object(self.store, "request", create=True, side_effect=[obs["run"], {"total_count": 2, "jobs": obs["jobs"]}]):
            found = worker.job_identity(self.store, self.b, self.b["controllers"][0], environment, self.now)
        self.assertEqual(found, identity(self.b))
        environment["RUNNER_NAME"] = "forged"
        with patch.object(self.store, "request", create=True, side_effect=[obs["run"], {"total_count": 2, "jobs": obs["jobs"]}]), self.assertRaises(ValueError):
            worker.job_identity(self.store, self.b, self.b["controllers"][0], environment, self.now)

    def recovery_proofs(self):
        proofs = {}
        for i, config in enumerate(self.b["controllers"]):
            old = binding()
            old["leasePolicy"]["recoveryControllerId"] = config["controllerId"]
            s = {**state(old), "recoveryControllerId": config["controllerId"]}
            record = p.owner_record(old, s, 0, KEY)
            store = MemoryStore(old, record)
            w = worker.Worker(old, config["controllerId"], KEY, store, Provider(s), identity(old, i),
                Path(self.tmp.name) / ("recovery" + str(i)), clock=lambda: 1221)
            with patch.object(core.time, "time", lambda: 1221):
                w.cycle()
            proofs[config["controllerId"]] = {"binding": p.seal(old, KEY), "recovery": w.recovery}
        return proofs

    def ordinary_receipt(self, *, fence=False, destination=False):
        proofs = self.recovery_proofs()
        if destination:
            self.b.update(repository="owner/private-fence", repositoryId=43, workflowCommit="e" * 40)
        self.b["leasePolicy"] = {}
        self.s.pop("purpose")
        self.s.pop("recoveryControllerId")
        if fence:
            self.s.update(instanceId=None, status="launch_unknown")
            self.now = 1700
        else:
            self.now = 1300
            self.s["ownerHeartbeatAt"] = 1300
        self.s = control.watchdog_payload({"planHash": self.b["leaseIdentity"]["planHash"]},
            {"id": self.s["leaseId"], "name": self.s["expectedName"], "instanceId": self.s["instanceId"],
             "status": self.s["status"], "reservedAt": self.s["reservedAt"], "deadline": self.s["deadline"],
             "setupDeadline": self.s["setupDeadline"], "ready": self.s["ready"]}, self.s["ownerHeartbeatAt"])
        self.record = p.owner_record(self.b, self.s, 0, KEY)
        self.store = MemoryStore(self.b, self.record)
        self.provider = Provider(self.s)
        if fence:
            self.provider.instance = None
        self.w = worker.Worker(self.b, "acephale-gha-a", KEY, self.store, self.provider, identity(self.b),
            Path(self.tmp.name) / "ordinary", clock=lambda: self.now)
        # Build actual ACKs with each current worker. The fixture receipt helper
        # constructs the other provider with the same exact state.
        self.w.cycle()
        provider2 = Provider(self.s)
        if fence:
            provider2.instance = None
        second = worker.Worker(self.b, "acephale-gha-b", KEY, self.store, provider2, identity(self.b, 1),
            Path(self.tmp.name) / "ordinary-second", clock=lambda: self.now)
        second.cycle()
        jobs = [{"id": 20 + i, "run_id": 10, "head_sha": self.b["workflowCommit"],
            "name": "watchdog_" + letter, "status": "in_progress", "conclusion": None,
            "runner_id": 30 + i, "runner_name": "runner" + str(i), "started_at": "1970-01-01T00:15:00Z"}
            for i, letter in enumerate(("a", "b"))]
        obs = {"kind": "acephale-github-api-observation-v1", "bindingHash": p.digest(self.b), "observedAt": self.now,
            "repository": {"id": self.b["repositoryId"], "full_name": self.b["repository"], "private": True},
            "run": {"id": 10, "run_attempt": 1, "head_sha": self.b["workflowCommit"], "path": self.b["workflowPath"],
                    "event": "workflow_dispatch", "status": "in_progress", "repository": {"id": self.b["repositoryId"]}}, "jobs": jobs}
        data = {"version": 1, "backend": p.BACKEND, "binding": p.seal(self.b, KEY), "apiObservation": p.seal(obs, KEY),
            "ownerRecord": self.record, "qualification": proofs,
            "controllers": [self.store.read(r["evidenceBranch"], p.ACK_PATH)[0] for r in self.b["controllers"]]}
        lease = {"id": self.s["leaseId"], "name": self.s["expectedName"], "reservedAt": self.s["reservedAt"],
            "setupDeadline": self.s["setupDeadline"], "deadline": self.s["deadline"], "instanceId": self.s["instanceId"],
            "ready": False, "status": self.s["status"], "reservedHours": 1 / 6}
        return data, {"planHash": self.s["planHash"]}, lease

    def test_actual_public_payload_research_defaults_do_not_create_canary_policy(self):
        self.b["leasePolicy"] = {}
        lease = {"id": self.s["leaseId"], "name": self.s["expectedName"], "instanceId": "instance1",
            "status": "active", "reservedAt": 1000, "deadline": 1600, "setupDeadline": 1500, "ready": False}
        actual = control.watchdog_payload({"planHash": self.s["planHash"]}, lease, 1100)
        signed = p.owner_record(self.b, actual, 0, KEY)
        self.assertEqual(p.check_owner(signed, KEY, self.b)["state"], actual)
        with self.assertRaises(ValueError):
            p.owner_record(self.b, {**actual, "purpose": "cleanup_canary", "recoveryControllerId": "acephale-gha-a"}, 1, KEY, signed)

    def test_unknown_late_arrival_ack_retains_actual_tick_state_then_resolved_identity(self):
        self.b["leasePolicy"] = {}
        late = {**self.s, "instanceId": None, "status": "launch_unknown", "purpose": "research", "recoveryControllerId": None}
        record = p.owner_record(self.b, late, 0, KEY)
        store = MemoryStore(self.b, record)
        provider = Provider({**late, "instanceId": "late-exact-instance"})
        self.now = 1700
        w = worker.Worker(self.b, "acephale-gha-a", KEY, store, provider, identity(self.b),
                         Path(self.tmp.name) / "late", clock=lambda: self.now)
        self.assertTrue(w.cycle()["terminationVerified"])
        first, _ = store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        body = p.check_ack(first, KEY, self.b, "acephale-gha-a", self.now, healthy=False)
        self.assertIsNone(body["effectiveState"]["instanceId"])
        self.now += 41
        self.assertTrue(w.cycle()["terminationVerified"])
        second, _ = store.read(self.b["controllers"][0]["evidenceBranch"], p.ACK_PATH)
        body = p.check_ack(second, KEY, self.b, "acephale-gha-a", self.now, healthy=False)
        self.assertEqual(body["effectiveState"]["instanceId"], "late-exact-instance")
        self.assertEqual(sum(c[0] == "POST" for c in provider.calls), 1)

    def test_research_readiness_accepts_exact_version_canaries_from_different_jobs(self):
        data, ledger, lease = self.ordinary_receipt()
        rows = admission.enrollments(data, ledger, lease, self.now, self.b["sourceFiles"], key=KEY)
        self.assertTrue(all(r["recoveryTestPassed"] for r in rows))
        bad = copy.deepcopy(data)
        body = p.unseal(bad["qualification"]["acephale-gha-a"]["recovery"], KEY)
        body["observed"]["instanceId"] = "other"
        bad["qualification"]["acephale-gha-a"]["recovery"] = p.seal(body, KEY)
        with self.assertRaises(ValueError):
            admission.enrollments(bad, ledger, lease, self.now, self.b["sourceFiles"], key=KEY)

    def transfer_receipt(self):
        data, ledger, lease = self.ordinary_receipt(fence=True, destination=True)
        transfer = {"kind": "acephale-github-qualification-transfer-v1",
            "sourceRepository": {"id": 42, "full_name": "owner/private-control", "private": True},
            "destinationRepository": {"id": 43, "full_name": "owner/private-fence", "private": True},
            "destinationBindingHash": p.digest(self.b), "sourceCommit": self.b["sourceCommit"],
            "sourceFiles": self.b["sourceFiles"], "workflowSha256": self.b["workflowSha256"],
            "qualificationHashes": {cid: p.digest(proof) for cid, proof in data["qualification"].items()},
            "currentJobsPerformedHistoricalRecovery": False, "freshDestinationEnrollmentRequired": True,
            "authorizedAt": self.now}
        data["qualificationTransfer"] = p.seal(transfer, KEY)
        return data, ledger, lease

    def test_cross_repository_fence_requires_explicit_version_transfer(self):
        data, ledger, lease = self.transfer_receipt()
        rows = admission.enrollments(data, ledger, lease, self.now, self.b["sourceFiles"], key=KEY, fence=True)
        self.assertEqual({row["identity"]["repositoryId"] for row in rows}, {43})
        self.assertTrue(all(row["recoveryTestPassed"] for row in rows))
        del data["qualificationTransfer"]
        with self.assertRaises(ValueError):
            admission.enrollments(data, ledger, lease, self.now, self.b["sourceFiles"], key=KEY, fence=True)

    def test_cross_repository_transfer_rejects_changed_scope_or_proofs(self):
        data, ledger, lease = self.transfer_receipt()
        for field, replacement in (("sourceRepository", {"id": 44}), ("destinationRepository", {"id": 44}),
                ("sourceCommit", "f" * 40), ("sourceFiles", {}), ("workflowSha256", "f" * 64),
                ("qualificationHashes", {}), ("destinationBindingHash", "f" * 64),
                ("currentJobsPerformedHistoricalRecovery", True), ("freshDestinationEnrollmentRequired", False),
                ("authorizedAt", self.now + 1)):
            with self.subTest(field=field):
                bad = copy.deepcopy(data)
                value = p.unseal(bad["qualificationTransfer"], KEY)
                value[field] = replacement
                bad["qualificationTransfer"] = p.seal(value, KEY)
                with self.assertRaises(ValueError):
                    admission.enrollments(bad, ledger, lease, self.now, self.b["sourceFiles"], key=KEY, fence=True)

    def test_transferred_qualification_never_replaces_current_job_identity(self):
        data, ledger, lease = self.transfer_receipt()
        for field, replacement in (("runnerId", 999), ("repositoryId", 42), ("jobId", 999)):
            with self.subTest(field=field):
                bad = copy.deepcopy(data)
                value = p.unseal(bad["controllers"][0], KEY)
                value["identity"][field] = replacement
                bad["controllers"][0] = p.seal(value, KEY)
                with self.assertRaises(ValueError):
                    admission.enrollments(bad, ledger, lease, self.now, self.b["sourceFiles"], key=KEY, fence=True)

    def test_real_unresolved_fence_preserves_aws_history_and_hold(self):
        import unresolved_launch
        data, ledger, lease = self.ordinary_receipt(fence=True)
        lease["studyReservation"] = {"reservationId": "retained-unknown-hold"}
        lease["watchdogs"] = [{"controllerId": "old-a", "hostId": "arn:aws:lambda:region-a:123:function:old-a"},
                              {"controllerId": "old-b", "hostId": "arn:aws:lambda:region-b:123:function:old-b"}]
        ledger["leases"] = [lease]
        before = copy.deepcopy(ledger)
        predecessor = {"id": lease["id"], "name": lease["name"], "leaseHash": control.digest(lease)}
        migration = {"kind": "acephale-github-fence-migration-v1", "predecessor": predecessor,
            "planHash": ledger["planHash"], "financialBindingHash": "e" * 64,
            "previousControllers": lease["watchdogs"], "newBindingHash": p.digest(self.b),
            "originalControllerHistoryPreserved": True, "originalLeaseUnchanged": True,
            "financialHoldsRetained": True, "authorizedAt": 1600, "reason": "Explicit prospective backend migration"}
        values = admission.enrollments(data, ledger, lease, self.now, self.b["sourceFiles"], key=KEY, fence=True)
        value = {"version": 1, "profile": "acephale-github-unresolved-launch-fence-v1", "predecessor": predecessor,
            "planHash": ledger["planHash"], "financialBindingHash": "e" * 64, "financialBindingChanged": False,
            "predecessorReservationRetained": True, "observedAt": self.now, "expiresAt": self.now + 60,
            "backendReceipt": data, "backendMigration": p.seal(migration, KEY),
            "controllers": [{"enrollment": e, "state": self.s} for e in values]}
        value["contentHash"] = control.digest(value)
        with patch.dict("os.environ", {"ACEPHALE_WATCHDOG_HMAC_KEY": KEY}), patch.object(control, "_financial_binding_hash", return_value="e" * 64):
            self.assertEqual(unresolved_launch.checked_fence(ledger, value, self.now), value)
            self.assertEqual(ledger, before)
            bad = copy.deepcopy(value)
            bad["backendMigration"]["payload"]["financialHoldsRetained"] = False
            bad["contentHash"] = control.digest({k: v for k, v in bad.items() if k != "contentHash"})
            with self.assertRaises(ValueError):
                unresolved_launch.checked_fence(ledger, bad, self.now)


if __name__ == "__main__":
    unittest.main()
