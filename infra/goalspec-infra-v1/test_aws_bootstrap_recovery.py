"""Offline bootstrap reservations and recovery-canary guardrail tests only."""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

import aws_control as aws
from test_aws_control import LEASE, NOW, Budget, Provider, plan
from test_aws_readiness import price_response

OVERHEAD = "22222222-2222-4222-8222-222222222222"
OTHER = "33333333-3333-4333-8333-333333333333"


class BootstrapRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="goalspec-bootstrap-recovery-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.plan = plan(self.root)
        self.provider, self.budget = Provider(self.plan), Budget()
        self.ledger = self.root / "slice.json"
        aws.init_ledger(self.ledger, self.plan, 0, self.budget)
        price = self.root / "offline-price-fixture.json"
        aws.write_new(price, {"fixtureOnly": True, "notProviderPriceEvidence": True})
        self.cost = self.root / "offline-cost-fixture.json"
        aws.write_new(self.cost, {
            "regions": ["us-east-1", "us-west-2"], "creditsApplied": False,
            "freeTierDiscountsApplied": False, "coverageHours": 12, "estimatedGrossUsd": 0.50,
            "lineItemsUsd": {"fixtureCompute": 0.20, "fixtureStorageAndRequests": 0.30},
            "priceEvidence": [{"path": price.name, "sha256": aws.sha256(price)}],
        })
        archive = self.root / "goalspec-watchdog.zip"
        with ZipFile(archive, "x") as bundle:
            bundle.writestr("OFFLINE-TEST-ONLY.txt", "Not deployable code or provider evidence.\n")
        self.package = self.root / "package.json"
        aws.write_new(self.package, {"planHash": aws.deployment_hash(self.plan), "codeManifestSha256": "c" * 64,
            "coverageStartsAt": NOW, "coverageEndsAt": NOW + 12 * 3600, "zipSha256": aws.sha256(archive)})
        self.watchdogs = []
        for suffix, region in (("a", "us-east-1"), ("b", "us-west-2")):
            path = self.root / f"offline-armed-{suffix}.json"
            aws.write_new(path, {
                "profile": aws.PROFILE, "provider": "aws", "planHash": aws.deployment_hash(self.plan),
                "accountId": self.plan["accountId"], "region": self.plan["region"],
                "controllerKind": "independent_always_on", "discovery": "ec2_tags", "maxPollSeconds": 60,
                "heartbeatAt": NOW, "verifiedAt": NOW, "hostingKind": "aws_lambda",
                "receiptKind": "healthy_deployed_watchdog_arming", "terminationRecoveryTestPassed": False,
                "deployedCodeVerified": True, "controllerId": "goalspec-watchdog-" + suffix,
                "hostId": f"arn:aws:lambda:{region}:{self.plan['accountId']}:function:goalspec-watchdog-{suffix}",
                "failureDomain": "aws-region:" + region, "scheduleCadenceSeconds": 60,
                "schedulerPrecisionSeconds": 60, "internalPollOffsetsSeconds": [0, 30, 60],
                "deliveryGuaranteed": False, "codeManifestSha256": "c" * 64, "lastEvidenceSha256": "d" * 64,
                "coverageStartsAt": NOW, "coverageEndsAt": NOW + 12 * 3600,
            })
            self.watchdogs.append(path)

    def reserve(self, maximum=1, reservation_id=OVERHEAD, budget=None):
        return aws.reserve_overhead(self.ledger, self.plan, reservation_id, maximum, self.cost,
                                    package_path=self.package, now=NOW, budget=budget or self.budget)

    def launch(self, **changes):
        args = {"hours": 5 / 60, "extra_allowance": 1, "now": NOW, "budget": self.budget,
                "recovery_controller": "goalspec-watchdog-a", "watchdog_paths": self.watchdogs}
        args.update(changes)
        return aws.launch(self.provider, self.ledger, self.plan, LEASE, **args)

    def writes(self):
        return [call for call in self.provider.calls if call[:2] in aws.WRITES]

    def watchdog_tick(self, suffix, now):
        key = ("sts", "get-caller-identity")
        identity = copy.deepcopy(self.provider.data[key])
        role = "GoalSpecWatchdog" + suffix.upper()
        self.provider.data[key]["Arn"] = f"arn:aws:sts::{self.plan['accountId']}:assumed-role/{role}/offline-test"
        try:
            return aws.watchdog_tick(self.provider, self.plan,
                f"arn:aws:iam::{self.plan['accountId']}:role/{role}", now, "goalspec-watchdog-" + suffix)
        finally:
            self.provider.data[key] = identity

    def canary_evidence(self, *, suffix="a", when=NOW + 120):
        armed = aws.read_json(self.watchdogs[0])
        results = self.watchdog_tick(suffix, when)
        evidence = {"profile": aws.PROFILE, "provider": "aws", "planHash": aws.deployment_hash(self.plan),
                    "controllerId": "goalspec-watchdog-" + suffix, "functionArn": armed["hostId"],
                    "codeManifestSha256": armed["codeManifestSha256"], "coverageStartsAt": armed["coverageStartsAt"],
                    "coverageEndsAt": armed["coverageEndsAt"], "startedAt": when, "finishedAt": when + 1,
                    "results": results}
        path = self.root / f"offline-canary-{suffix}-evidence.json"
        aws.write_new(path, evidence)
        aws.reconcile(self.provider, self.ledger, self.plan, LEASE, when + 2)
        aws.atomic_json(self.watchdogs[0], {**armed, "heartbeatAt": when + 2})
        return path

    def test_overhead_is_durable_before_original_journal_reservation(self):
        def original_budget(p, operation, reservation=None):
            if operation == "reserve":
                row = aws.read_json(self.ledger)["overheads"][0]
                self.assertEqual(row["status"], "reservation_pending")
                self.assertEqual(row["reservedMicrodollars"], 1_000_000)
                self.assertEqual(row["costReceiptSha256"], aws.sha256(self.cost))
            return self.budget(p, operation, reservation)

        row = self.reserve(budget=original_budget)
        self.assertEqual(row["status"], "reserved")
        self.assertEqual(self.budget.reservations, {OVERHEAD: 1_000_000})
        self.assertEqual(aws.read_json(self.ledger)["leases"], [])
        self.assertEqual(self.provider.calls, [])

    def test_unknown_original_reservation_is_retained_and_cannot_retry(self):
        self.budget.fail = True
        with self.assertRaisesRegex(RuntimeError, "response lost"):
            self.reserve()
        row = aws.read_json(self.ledger)["overheads"][0]
        self.assertEqual(row["status"], "reservation_pending")
        self.assertEqual(self.budget.reservations, {OVERHEAD: 1_000_000})
        self.budget.fail = False
        with self.assertRaisesRegex(ValueError, "already attempted"):
            self.reserve()
        with self.assertRaisesRegex(ValueError, "exact serverless package/window"):
            self.launch()
        self.assertEqual(self.provider.calls, [])

    def test_cost_evidence_and_gross_estimate_must_reconcile_before_reservation(self):
        original = aws.read_json(self.cost)
        for change in ({"creditsApplied": True}, {"freeTierDiscountsApplied": True},
                       {"regions": ["us-east-1"]}, {"coverageHours": 25},
                       {"estimatedGrossUsd": 1.01}, {"lineItemsUsd": {"incorrectSum": 0.49}},
                       {"priceEvidence": [{"path": "offline-price-fixture.json", "sha256": "0" * 64}]}):
            with self.subTest(change=change):
                aws.atomic_json(self.cost, {**original, **change})
                with self.assertRaises(ValueError):
                    self.reserve()
                self.assertEqual(self.budget.reservations, {})
                self.assertEqual(aws.read_json(self.ledger).get("overheads", []), [])
        self.assertEqual(self.provider.calls, [])

    def test_overhead_uses_original_slice_cap_and_uncertain_costs_still_count(self):
        self.budget.fail = True
        with self.assertRaises(RuntimeError):
            self.reserve(maximum=34.5)
        self.budget.fail = False
        with self.assertRaisesRegex(ValueError, "slice exhausted"):
            self.reserve(maximum=1, reservation_id=OTHER)
        self.assertEqual(self.budget.reservations, {OVERHEAD: 34_500_000})
        self.assertEqual(len(aws.read_json(self.ledger)["overheads"]), 1)

    def test_overhead_and_canary_share_35_dollar_cap(self):
        self.reserve(maximum=34)
        with self.assertRaisesRegex(ValueError, "slice exhausted"):
            self.launch()
        self.assertEqual(aws.read_json(self.ledger)["leases"], [])
        self.assertEqual(self.budget.reservations, {OVERHEAD: 34_000_000})
        self.assertEqual(self.writes(), [])

    def test_canary_requires_completed_original_overhead_reservation(self):
        with self.assertRaisesRegex(ValueError, "exact serverless package/window"):
            self.launch()
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.budget.reservations, {})

    def test_canary_is_one_five_minute_no_inference_lease_after_both_reservations(self):
        self.reserve()
        dispatch = self.provider.call

        def checked_dispatch(service, operation, payload=None):
            if operation == "run-instances":
                row = aws.read_json(self.ledger)["leases"][0]
                self.assertEqual(row["status"], "launching")
                self.assertEqual(set(self.budget.reservations), {OVERHEAD, LEASE})
            return dispatch(service, operation, payload)

        self.provider.call = checked_dispatch
        result = self.launch()
        row = aws.read_json(self.ledger)["leases"][0]
        self.assertEqual(result["deadline"], NOW + 300)
        self.assertEqual(result["setupDeadline"], NOW + 300)
        self.assertEqual(row["canaryStopAt"], NOW + 120)
        self.assertEqual(row["purpose"], "watchdog_recovery_canary")
        self.assertEqual(row["recoveryController"], "goalspec-watchdog-a")
        self.assertFalse(row["inferenceAllowed"])
        self.assertFalse(row["ready"])
        self.assertTrue(row["operatorCleanupRequired"])
        self.assertEqual(row["reservedHours"], 10 / 60)
        self.assertGreaterEqual(row["reservedMicrodollars"], 1_200_000)
        self.assertEqual(len(self.writes()), 1)
        payload = self.writes()[0][2]
        self.assertEqual((payload["MinCount"], payload["MaxCount"]), (1, 1))
        self.assertNotIn("UserData", payload)
        tags = {tag["Key"]: tag["Value"] for tag in payload["TagSpecifications"][0]["Tags"]}
        self.assertEqual(tags["GoalSpecReady"], "false")
        self.assertEqual(tags["GoalSpecCanaryStopAt"], str(int(NOW + 120)))
        with self.assertRaisesRegex(ValueError, "cannot become inference-ready"):
            aws.mark_ready(self.provider, self.ledger, self.plan, LEASE, self.root / "absent-smoke.json", NOW + 1)
        self.assertEqual([call for call in self.writes() if call[1] == "create-tags"], [])

    def test_canary_only_accepts_exact_duration_and_known_controller(self):
        self.reserve()
        for change in ({"hours": 1 / 60}, {"hours": 6 / 60}, {"recovery_controller": "other"}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "exactly five minutes"):
                self.launch(**change)
        self.assertEqual(self.provider.calls, [])

    def test_normal_launch_cannot_use_armed_receipts(self):
        self.reserve()
        with self.assertRaisesRegex(ValueError, "enrollment or recovery evidence"):
            self.launch(hours=2, recovery_controller=None)
        self.assertEqual(self.provider.calls, [])
        self.assertNotIn(LEASE, self.budget.reservations)

    def test_canary_requires_two_current_independent_arming_receipts(self):
        self.reserve()
        path = self.watchdogs[1]
        original = aws.read_json(path)
        for change in ({"terminationRecoveryTestPassed": True, "recoveryEvidenceSha256": "e" * 64},
                       {"receiptKind": "completed_recovery"}, {"deployedCodeVerified": False},
                       {"heartbeatAt": NOW - 121}, {"coverageEndsAt": NOW + 599},
                       {"failureDomain": "aws-region:us-east-1"}, {"codeManifestSha256": "bad"}):
            with self.subTest(change=change):
                aws.atomic_json(path, {**original, **change})
                with self.assertRaises(ValueError):
                    self.launch()
        aws.atomic_json(path, original)
        with self.assertRaisesRegex(ValueError, "Exactly two"):
            self.launch(watchdog_paths=self.watchdogs[:1])
        self.assertEqual(self.provider.calls, [])

    def test_canary_keeps_original_hourly_price_and_quota_limits(self):
        self.reserve()
        self.provider.data[("pricing", "get-products")] = price_response("2.24208")
        with self.assertRaisesRegex(ValueError, "hourly cap"):
            self.launch()
        self.provider.data[("pricing", "get-products")] = price_response("1.20")
        self.provider.data[("service-quotas", "get-service-quota")]["Quota"]["Value"] = 0
        with self.assertRaisesRegex(ValueError, "headroom"):
            self.launch()
        self.assertEqual(self.budget.reservations, {OVERHEAD: 1_000_000})
        self.assertEqual(self.writes(), [])

    def test_canary_counts_prior_and_terminated_gpu_hours_toward_24(self):
        self.reserve()
        ledger = aws.read_json(self.ledger)
        ledger["priorGpuHours"] = 23.9
        ledger["leases"].append({"id": OTHER, "status": "terminated", "reservedHours": 0.09, "reservedMicrodollars": 1})
        aws.atomic_json(self.ledger, ledger)
        with self.assertRaisesRegex(ValueError, "Cumulative GPU-hour"):
            self.launch()
        self.assertEqual(self.provider.calls, [])

    def test_unknown_canary_creation_retains_reservation_and_never_retries(self):
        self.reserve()
        self.provider.unknown_launch = True
        with self.assertRaisesRegex(RuntimeError, "after creation"):
            self.launch()
        before = copy.deepcopy(self.budget.reservations)
        self.assertIn(LEASE, before)
        self.assertEqual(aws.read_json(self.ledger)["leases"][0]["status"], "launch_unknown")
        with self.assertRaisesRegex(ValueError, "already attempted"):
            self.launch()
        self.assertEqual(self.budget.reservations, before)
        self.assertEqual(len([call for call in self.writes() if call[1] == "run-instances"]), 1)

    def test_only_target_controller_can_terminate_early_and_prove_recovery(self):
        self.reserve()
        self.launch()
        self.assertEqual(self.watchdog_tick("a", NOW + 119), [])
        self.assertEqual(self.watchdog_tick("b", NOW + 121), [])
        self.assertEqual(self.provider.rows[0]["State"]["Name"], "running")
        evidence = self.canary_evidence()
        output = self.root / "offline-enrollment.json"
        aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], evidence, evidence, output, now=NOW + 125)
        receipt = aws.read_json(output)
        self.assertTrue(receipt["terminationRecoveryTestPassed"])
        self.assertEqual(receipt["controllerId"], "goalspec-watchdog-a")
        self.assertEqual(receipt["codeManifestSha256"], "c" * 64)
        self.assertEqual(receipt["coverageEndsAt"], NOW + 12 * 3600)
        self.assertEqual(receipt["recoveryVerifiedAt"], NOW + 121)
        self.assertEqual(receipt["verifiedAt"], NOW + 125)
        self.assertEqual(receipt["recoveryProof"]["requestSha256"], aws.sha256(evidence))

    def test_other_controller_fallback_never_qualifies_target_recovery(self):
        self.reserve()
        self.launch()
        evidence = self.canary_evidence(suffix="b", when=NOW + 300)
        self.assertEqual(self.provider.rows[0]["State"]["Name"], "terminated")
        with self.assertRaisesRegex(ValueError, "before its fallback deadline"):
            aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], evidence, evidence,
                              self.root / "must-not-exist.json", now=NOW + 305)
        self.assertFalse((self.root / "must-not-exist.json").exists())

    def test_recovery_proof_rejects_other_controller_code_window_or_missing_request(self):
        self.reserve()
        self.launch()
        evidence = self.canary_evidence()
        original = aws.read_json(evidence)
        for change in ({"controllerId": "goalspec-watchdog-b"}, {"codeManifestSha256": "f" * 64},
                       {"coverageEndsAt": NOW + 3600}, {"finishedAt": NOW + 300},
                       {"results": [{**original["results"][0], "terminationRequested": False}]}):
            with self.subTest(change=change):
                aws.atomic_json(evidence, {**original, **change})
                with self.assertRaises(ValueError):
                    aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], evidence, evidence,
                                      self.root / "must-not-exist.json", now=NOW + 125)
                self.assertFalse((self.root / "must-not-exist.json").exists())

    def test_later_reconciliation_preserves_first_termination_verification(self):
        self.reserve()
        self.launch()
        evidence = self.canary_evidence()
        lease = aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW + 301)
        self.assertEqual(lease["terminationVerifiedAt"], NOW + 122)
        armed = aws.read_json(self.watchdogs[0])
        aws.atomic_json(self.watchdogs[0], {**armed, "heartbeatAt": NOW + 301})
        aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], evidence, evidence,
                          self.root / "offline-late-enrollment.json", now=NOW + 305)
        enrollment = aws.read_json(self.root / "offline-late-enrollment.json")
        self.assertEqual(enrollment["recoveryVerifiedAt"], NOW + 121)
        self.assertEqual(enrollment["verifiedAt"], NOW + 305)

    def test_separate_target_request_and_later_provider_confirmation_are_required(self):
        self.reserve()
        self.launch()
        self.provider.terminate_immediately = False
        requested = self.canary_evidence()
        self.assertFalse(aws.read_json(requested)["results"][0]["terminationVerified"])
        self.provider.rows[0]["State"]["Name"] = "terminated"
        confirmed_data = aws.read_json(requested)
        confirmed_data.update(startedAt=NOW + 140, finishedAt=NOW + 141,
                              results=self.watchdog_tick("a", NOW + 140))
        confirmed = self.root / "offline-later-confirmation.json"
        aws.write_new(confirmed, confirmed_data)
        self.assertFalse(confirmed_data["results"][0]["terminationRequested"])
        self.assertTrue(confirmed_data["results"][0]["terminationVerified"])
        aws.reconcile(self.provider, self.ledger, self.plan, LEASE, NOW + 142)
        aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], requested, confirmed,
                          self.root / "offline-separated-enrollment.json", now=NOW + 145)
        with self.assertRaisesRegex(ValueError, "request and provider confirmation"):
            aws.enroll_canary(self.ledger, self.plan, LEASE, self.watchdogs[0], confirmed, confirmed,
                              self.root / "must-not-exist.json", now=NOW + 145)

    def test_operator_monitor_waits_for_hard_stop_and_never_claims_recovery(self):
        self.reserve()
        self.launch()
        clock = [NOW + 299]
        termination_times = []
        dispatch = self.provider.call

        def observed_dispatch(service, operation, payload=None):
            if operation == "terminate-instances":
                termination_times.append(clock[0])
            return dispatch(service, operation, payload)

        def sleep(seconds):
            clock[0] += seconds

        self.provider.call = observed_dispatch
        before = copy.deepcopy(self.budget.reservations)
        result = aws.monitor_canary(self.provider, self.ledger, self.plan, LEASE,
                                    clock=lambda: clock[0], sleep=sleep)
        self.assertEqual(result["status"], "terminated")
        self.assertFalse(result["recoveryPassed"])
        self.assertTrue(termination_times)
        self.assertGreaterEqual(min(termination_times), NOW + 300)
        self.assertEqual(self.budget.reservations, before)

    def test_operator_monitor_reports_bounded_failure_without_releasing_unknown_cost(self):
        self.reserve()
        self.launch()
        clock = [NOW + 300]
        self.provider.terminate_immediately = False
        self.provider.unknown_termination = True

        def sleep(seconds):
            clock[0] += seconds

        before = copy.deepcopy(self.budget.reservations)
        with self.assertRaises(RuntimeError):
            aws.monitor_canary(self.provider, self.ledger, self.plan, LEASE, clock=lambda: clock[0], sleep=sleep)
        self.assertLessEqual(clock[0], NOW + 610)
        self.assertEqual(self.budget.reservations, before)
        self.assertEqual(aws.read_json(self.ledger)["leases"][0]["status"], "termination_requested")
        self.assertEqual(len([call for call in self.writes() if call[1] == "run-instances"]), 1)

    def test_overhead_binds_actual_package_archive_and_costed_schedule_window(self):
        original = aws.read_json(self.package)
        for change in ({"planHash": "f" * 64}, {"zipSha256": "0" * 64},
                       {"codeManifestSha256": "invalid"}, {"coverageEndsAt": NOW + 13 * 3600}):
            with self.subTest(change=change):
                aws.atomic_json(self.package, {**original, **change})
                with self.assertRaises(ValueError):
                    self.reserve()
                self.assertEqual(self.budget.reservations, {})
                self.assertEqual(aws.read_json(self.ledger).get("overheads", []), [])

    def test_previous_package_or_schedule_reservation_cannot_authorize_new_canary(self):
        self.reserve()
        path = self.watchdogs[1]
        original = aws.read_json(path)
        for change in ({"codeManifestSha256": "f" * 64}, {"coverageStartsAt": NOW - 1},
                       {"coverageEndsAt": NOW + 11 * 3600}):
            with self.subTest(change=change):
                aws.atomic_json(path, {**original, **change})
                with self.assertRaisesRegex(ValueError, "exact serverless package/window"):
                    self.launch()
        self.assertEqual(self.provider.calls, [])
        self.assertNotIn(LEASE, self.budget.reservations)


if __name__ == "__main__":
    unittest.main()
