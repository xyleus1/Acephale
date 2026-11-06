"""Offline AWS evidence tests. No accounts, providers, credentials or GPUs used."""
from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("aws_readiness", Path(__file__).with_name("aws_readiness.py"))
aws = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(aws)
NOW = datetime(2026, 11, 6, tzinfo=timezone.utc)


def price_response(price="2.2420800000"):
    document = {
        "product": {"sku": "EXAMPLE-SKU", "productFamily": "Compute Instance", "attributes": {
            "instanceType": "g6e.2xlarge", "regionCode": "us-east-1", "operatingSystem": "Linux",
            "tenancy": "Shared", "capacitystatus": "Used", "preInstalledSw": "NA"}},
        "terms": {"OnDemand": {"example-term": {"effectiveDate": "2026-01-01T00:00:00Z", "priceDimensions": {
            "example-rate": {"rateCode": "EXAMPLE-RATE", "unit": "Hrs", "beginRange": "0", "endRange": "Inf",
                             "appliesTo": [], "pricePerUnit": {"USD": price}}}}}},
    }
    return {"PriceList": [json.dumps(document)]}


def fixtures():
    return {
        ("sts", "get-caller-identity"): {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:role/research"},
        ("ec2", "describe-instance-types"): {"InstanceTypes": [{"InstanceType": "g6e.2xlarge",
            "VCpuInfo": {"DefaultVCpus": 8}, "MemoryInfo": {"SizeInMiB": 65536},
            "ProcessorInfo": {"SupportedArchitectures": ["x86_64"]}, "SupportedUsageClasses": ["on-demand", "spot"],
            "GpuInfo": {"Gpus": [{"Manufacturer": "NVIDIA", "Name": "L40S", "Count": 1, "MemoryInfo": {"SizeInMiB": 49152}}]}}]},
        ("ec2", "describe-instance-type-offerings"): {"InstanceTypeOfferings": [
            {"InstanceType": "g6e.2xlarge", "LocationType": "region", "Location": "us-east-1"}]},
        ("service-quotas", "get-service-quota"): {"Quota": {
            "QuotaCode": aws.QUOTA_CODE, "ServiceCode": "ec2", "GlobalQuota": False, "Value": 8.0}},
        ("pricing", "get-products"): price_response(),
    }


class AWSReadinessTests(unittest.TestCase):
    def test_exact_aws_l40s_decimal_memory_remains_48gb_class_without_claiming_fit(self):
        value = fixtures()[("ec2", "describe-instance-types")]
        gpu = value["InstanceTypes"][0]["GpuInfo"]["Gpus"][0]
        gpu["MemoryInfo"]["SizeInMiB"] = 45776
        report = aws.hardware_report(value, "g6e.2xlarge")
        self.assertTrue(report["candidateHardwareChecksPassed"])
        self.assertFalse(report["actualModelFitVerified"])
        gpu["MemoryInfo"]["SizeInMiB"] = 45775
        self.assertIn("single_gpu_memory_below_48gb_class", aws.hardware_report(value, "g6e.2xlarge")["blockers"])
        gpu["MemoryInfo"]["SizeInMiB"] = 45776
        gpu["Name"] = "other GPU"
        self.assertFalse(aws.hardware_report(value, "g6e.2xlarge")["candidateHardwareChecksPassed"])

    def test_default_does_not_run_aws_or_any_network_command(self):
        forbidden = Mock(side_effect=AssertionError("No external operation allowed"))
        with patch.object(aws.subprocess, "run", forbidden):
            report = aws.readiness(runner=forbidden)
        forbidden.assert_not_called()
        self.assertFalse(report["accountInspectionRequested"])
        self.assertFalse(report["readyForGpuExecution"])
        self.assertIsNone(report["credits"]["balanceUsd"])

    def test_explicit_inspection_requires_profile_and_region(self):
        forbidden = Mock(side_effect=AssertionError("No dispatch"))
        for profile, region in [(None, "us-east-1"), ("company", None), (None, None)]:
            with self.subTest(profile=profile, region=region), self.assertRaises(aws.InspectionError):
                aws.readiness(inspect=True, profile=profile, region=region, runner=forbidden)
        forbidden.assert_not_called()

    def test_successful_reads_still_cannot_authorize_launch_or_confirm_credits(self):
        data, calls = fixtures(), []
        def runner(command):
            calls.append(command)
            return data[tuple(command[1:3])]
        report = aws.readiness(inspect=True, profile="company", region="us-east-1", runner=runner)
        self.assertEqual({tuple(command[1:3]) for command in calls}, aws.ALLOWED_READS)
        self.assertEqual(len(calls), 5)
        self.assertTrue(report["inspection"]["inspectionCompleted"])
        self.assertEqual(report["inspection"]["checks"]["identity"]["accountId"], "123456789012")
        self.assertTrue(report["inspection"]["checks"]["hardware"]["candidateHardwareChecksPassed"])
        self.assertFalse(report["readyToProvision"])
        self.assertFalse(report["readyForGpuExecution"])
        self.assertTrue(report["hourlyGrossLimitSatisfied"])
        self.assertNotIn("live_ec2_compute_price_exceeds_existing_hourly_gross_limit", report["blockers"])
        self.assertIsNone(report["credits"]["balanceUsd"])
        self.assertIn("aws_lifecycle_controller_not_live_verified", report["blockers"])
        self.assertIsNone(report["inspection"]["checks"]["quota"]["availableVcpus"])

    def test_exact_authorized_250_boundary_never_removes_other_execution_gates(self):
        for hourly, within in (("2.50", True), ("2.5000000001", False)):
            with self.subTest(hourly=hourly):
                data = fixtures()
                data[("pricing", "get-products")] = price_response(hourly)
                report = aws.readiness(inspect=True, profile="company", region="us-east-1",
                                       runner=lambda command, data=data: data[tuple(command[1:3])])
                self.assertEqual(report["hourlyGrossLimitSatisfied"], within)
                self.assertEqual("live_ec2_compute_price_exceeds_existing_hourly_gross_limit" in report["blockers"], not within)
                self.assertFalse(report["readyToProvision"])
                self.assertFalse(report["readyForGpuExecution"])
                self.assertIn("original_study_and_infrastructure_ledgers_not_reconciled_or_reserved", report["blockers"])
                self.assertIn("two_independent_aws_watchdogs_not_verified", report["blockers"])
                self.assertEqual(report["grossLimits"]["infrastructureUsd"], 35)
                self.assertEqual(report["grossLimits"]["totalUsd"], 500)
                self.assertEqual(report["grossLimits"]["cumulativeGpuHours"], 24)
                self.assertEqual(report["grossLimits"]["sessionHours"], 8)
                self.assertEqual(report["grossLimits"]["protectedContingencyUsd"], 65)

    def test_price_filters_separate_target_region_from_api_endpoint(self):
        command = aws.read_commands("company", "us-west-2", "g6e.2xlarge")["pricing"]
        self.assertIn("Type=TERM_MATCH,Field=regionCode,Value=us-west-2", command)
        self.assertEqual(command[command.index("--region") + 1], "us-east-1")
        for field, value in [("operatingSystem", "Linux"), ("tenancy", "Shared"), ("capacitystatus", "Used"), ("preInstalledSw", "NA")]:
            self.assertIn(f"Type=TERM_MATCH,Field={field},Value={value}", command)

    def test_exact_on_demand_rate_keeps_identity_timestamp_and_gross_cost(self):
        report = aws.price_report(price_response("1.2345678901"), "g6e.2xlarge", "us-east-1", NOW)
        self.assertEqual(report["hourlyUsd"], "1.2345678901")
        self.assertEqual(report["fetchedAt"], NOW.isoformat())
        self.assertEqual(report["rateCode"], "EXAMPLE-RATE")
        self.assertFalse(report["creditsApplied"])
        self.assertFalse(report["launchQuote"])
        self.assertIn("EBS", report["excludes"])

    def test_wrong_product_prices_are_rejected_even_if_api_filter_returned_them(self):
        for field, value in [("regionCode", "us-west-2"), ("operatingSystem", "Windows"), ("tenancy", "Dedicated"),
                             ("capacitystatus", "UnusedCapacityReservation"), ("preInstalledSw", "SQL Std"), ("instanceType", "g5.xlarge")]:
            with self.subTest(field=field):
                response = price_response()
                document = json.loads(response["PriceList"][0])
                document["product"]["attributes"][field] = value
                response["PriceList"][0] = json.dumps(document)
                with self.assertRaisesRegex(aws.InspectionError, "identity"):
                    aws.price_report(response, "g6e.2xlarge", "us-east-1", NOW)

    def test_unbounded_ambiguous_future_and_nonfinite_price_data_fail_closed(self):
        cases = []
        response = price_response()
        response["NextToken"] = "more"
        cases.append(response)
        response = price_response()
        response["PriceList"] *= 2
        cases.append(response)
        for change in ("unit", "range", "effective", "reserved"):
            response = price_response()
            document = json.loads(response["PriceList"][0])
            term = document["terms"]["OnDemand"]["example-term"]
            dimension = term["priceDimensions"]["example-rate"]
            if change == "unit":
                dimension["unit"] = "Quantity"
            elif change == "range":
                dimension["beginRange"] = "100"
            elif change == "effective":
                term["effectiveDate"] = "2099-01-01T00:00:00Z"
            else:
                document["terms"]["Reserved"] = document["terms"].pop("OnDemand")
            response["PriceList"][0] = json.dumps(document)
            cases.append(response)
        cases += [price_response(value) for value in ("NaN", "Infinity", "-1", "0")]
        for response in cases:
            with self.subTest(response=response), self.assertRaises(aws.InspectionError):
                aws.price_report(response, "g6e.2xlarge", "us-east-1", NOW)

    def test_quota_uses_vcpus_not_gpu_count_and_never_claims_free_capacity(self):
        response = fixtures()["service-quotas", "get-service-quota"]
        response["Quota"]["Value"] = 4
        report = aws.quota_report(response, 8)
        self.assertFalse(report["approvedQuotaAtLeastOneInstance"])
        self.assertEqual(report["requiredVcpusForOneInstance"], 8)
        self.assertIsNone(report["usedVcpus"])
        self.assertFalse(report["launchCapacityVerified"])
        response["Quota"]["QuotaCode"] = "unrelated-quota"
        with self.assertRaises(aws.InspectionError):
            aws.quota_report(response, 8)

    def test_arm_non_nvidia_and_two_small_gpus_do_not_pass(self):
        baseline = fixtures()["ec2", "describe-instance-types"]
        for case in ("arm", "trainium", "24gb", "two-small", "small-host"):
            response = copy.deepcopy(baseline)
            row = response["InstanceTypes"][0]
            gpu = row["GpuInfo"]["Gpus"][0]
            if case == "arm":
                row["ProcessorInfo"]["SupportedArchitectures"] = ["arm64"]
            elif case == "trainium":
                gpu["Manufacturer"] = "AWS"
            elif case == "24gb":
                gpu["MemoryInfo"]["SizeInMiB"] = 24576
            elif case == "two-small":
                gpu["Count"], gpu["MemoryInfo"]["SizeInMiB"] = 2, 24576
            else:
                row["MemoryInfo"]["SizeInMiB"], row["VCpuInfo"]["DefaultVCpus"] = 32768, 4
            with self.subTest(case=case):
                report = aws.hardware_report(response, "g6e.2xlarge")
                self.assertFalse(report["candidateHardwareChecksPassed"])
                self.assertFalse(report["actualModelFitVerified"])

    def test_insufficient_quota_and_absent_offering_are_blockers(self):
        data = fixtures()
        data["ec2", "describe-instance-type-offerings"] = {"InstanceTypeOfferings": []}
        data["service-quotas", "get-service-quota"]["Quota"]["Value"] = 0
        report = aws.inspect_account("company", "us-east-1", "g6e.2xlarge", runner=lambda command: data[tuple(command[1:3])], now=NOW)
        self.assertIn("instance_not_offered_in_region", report["blockers"])
        self.assertIn("approved_g_vt_vcpu_quota_below_one_instance", report["blockers"])

    def test_mutating_cli_operations_are_rejected_before_process_creation(self):
        with patch.object(aws.subprocess, "run") as spawn:
            for operation in ("run-instances", "terminate-instances", "request-service-quota-increase", "create-key-pair"):
                with self.subTest(operation=operation), self.assertRaises(aws.InspectionError):
                    aws.run_readonly(["aws", "ec2", operation])
        spawn.assert_not_called()

    def test_provider_error_output_is_not_returned(self):
        fake_secret = "FAKE_TEST_CREDENTIAL_SHOULD_NOT_APPEAR"
        response = subprocess.CompletedProcess([], 255, "", fake_secret)
        with patch.object(aws.subprocess, "run", return_value=response), self.assertRaises(aws.InspectionError) as context:
            aws.run_readonly(aws.read_commands("company", "us-east-1", "g6e.2xlarge")["identity"])
        self.assertEqual(str(context.exception), "aws_cli_exit_255")
        self.assertNotIn(fake_secret, str(context.exception))

    def test_partial_inspection_keeps_known_evidence_and_errors(self):
        data = fixtures()
        def runner(command):
            if tuple(command[1:3]) == ("pricing", "get-products"):
                raise aws.InspectionError("aws_cli_exit_254")
            return data[tuple(command[1:3])]
        report = aws.inspect_account("company", "us-east-1", "g6e.2xlarge", runner=runner, now=NOW)
        self.assertFalse(report["inspectionCompleted"])
        self.assertTrue(report["checks"]["identity"]["authenticated"])
        self.assertNotIn("pricing", report["checks"])
        self.assertIn("pricing_inspection_failed", report["blockers"])


if __name__ == "__main__":
    unittest.main()
