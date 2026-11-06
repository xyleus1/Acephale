"""Read-only AWS candidate inspection. No account calls occur without an explicit flag.

This is not an AWS provisioner or credit-balance checker. Passing the inspected
checks cannot authorize GPU execution, bypass gross limits or prove model fit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
QUOTA_CODE = "L-DB2E81BA"
DEFAULT_INSTANCE = "g6e.2xlarge"
ALLOWED_READS = frozenset({
    ("sts", "get-caller-identity"),
    ("ec2", "describe-instance-types"),
    ("ec2", "describe-instance-type-offerings"),
    ("service-quotas", "get-service-quota"),
    ("pricing", "get-products"),
})
OUTSTANDING_GATES = [
    "account_credit_grant_balance_expiry_and_ec2_eligibility_unverified",
    "original_study_and_infrastructure_ledgers_not_reconciled_or_reserved",
    "aws_lifecycle_controller_not_live_verified",
    "two_independent_aws_watchdogs_not_verified",
    "aws_iam_network_storage_and_export_plan_not_verified",
    "current_quota_usage_and_launch_capacity_not_verified",
    "actual_host_images_models_concurrent_fit_and_telemetry_not_verified",
]


class InspectionError(ValueError):
    """Safe category only; provider stderr and credential process output stay private."""


def _sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _decimal(value, label, *, positive=False):
    if isinstance(value, bool):
        raise InspectionError(f"invalid_{label}")
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise InspectionError(f"invalid_{label}") from error
    if not result.is_finite() or result < 0 or positive and result == 0:
        raise InspectionError(f"invalid_{label}")
    return result


def _positive_integer(value, label):
    if type(value) is not int or value <= 0:
        raise InspectionError(f"invalid_{label}")
    return value


def _validate_selection(profile, region, instance_type):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}", profile):
        raise InspectionError("invalid_profile_name")
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", region):
        raise InspectionError("invalid_region")
    if not re.fullmatch(r"[a-z][a-z0-9-]*\.[a-z0-9-]+", instance_type):
        raise InspectionError("invalid_instance_type")


def read_commands(profile, region, instance_type):
    """Exactly five bounded read operations; the price endpoint is not the target region."""
    _validate_selection(profile, region, instance_type)
    filters = {"instanceType": instance_type, "regionCode": region, "operatingSystem": "Linux",
               "tenancy": "Shared", "capacitystatus": "Used", "preInstalledSw": "NA"}
    operations = {
        "identity": (region, ["sts", "get-caller-identity"]),
        "hardware": (region, ["ec2", "describe-instance-types", "--instance-types", instance_type]),
        "offering": (region, ["ec2", "describe-instance-type-offerings", "--location-type", "region",
                               "--filters", f"Name=instance-type,Values={instance_type}", f"Name=location,Values={region}"]),
        "quota": (region, ["service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", QUOTA_CODE]),
        "pricing": ("us-east-1", ["pricing", "get-products", "--service-code", "AmazonEC2", "--format-version", "aws_v1",
                                  "--filters", *[f"Type=TERM_MATCH,Field={key},Value={value}" for key, value in filters.items()],
                                  "--max-items", "100", "--page-size", "100"]),
    }
    return {name: ["aws", *command, "--profile", profile, "--region", endpoint_region, "--output", "json",
                   "--no-cli-pager", "--no-cli-auto-prompt", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"]
            for name, (endpoint_region, command) in operations.items()}


def run_readonly(command):
    if command[0] != "aws" or tuple(command[1:3]) not in ALLOWED_READS:
        raise InspectionError("non_read_operation_forbidden")
    try:
        result = subprocess.run(command, shell=False, text=True, capture_output=True, timeout=45, check=False,
                                env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off", "AWS_MAX_ATTEMPTS": "1"})
    except FileNotFoundError as error:
        raise InspectionError("aws_cli_missing") from error
    except subprocess.TimeoutExpired as error:
        raise InspectionError("aws_cli_timeout") from error
    except OSError as error:
        raise InspectionError("aws_cli_execution_failed") from error
    if result.returncode:
        raise InspectionError(f"aws_cli_exit_{result.returncode}")
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise InspectionError("aws_cli_invalid_json") from error
    if not isinstance(value, dict):
        raise InspectionError("aws_cli_invalid_shape")
    return value


def hardware_report(response, instance_type):
    rows = response.get("InstanceTypes", [])
    if response.get("NextToken") or len(rows) != 1 or rows[0].get("InstanceType") != instance_type:
        raise InspectionError("instance_type_missing_or_ambiguous")
    row = rows[0]
    cpu = _positive_integer(row.get("VCpuInfo", {}).get("DefaultVCpus"), "vcpu_count")
    memory = _positive_integer(row.get("MemoryInfo", {}).get("SizeInMiB"), "host_memory")
    architectures = row.get("ProcessorInfo", {}).get("SupportedArchitectures", [])
    gpus = row.get("GpuInfo", {}).get("Gpus", [])
    blockers = []
    if "x86_64" not in architectures:
        blockers.append("x86_64_required")
    if not instance_type.startswith("g"):
        blockers.append("candidate_outside_inspected_g_vt_quota_family")
    if "on-demand" not in row.get("SupportedUsageClasses", []):
        blockers.append("on_demand_usage_not_supported")
    # Current compose allocates both servers on one device. Two small GPUs do
    # not satisfy a single 48 GB-class device requirement.
    single_nvidia = (len(gpus) == 1 and gpus[0].get("Manufacturer") == "NVIDIA"
                     and type(gpus[0].get("Count")) is int and gpus[0]["Count"] == 1)
    gpu_memory = None
    if not single_nvidia:
        blockers.append("one_nvidia_gpu_required_by_current_compose")
    else:
        gpu_memory = _positive_integer(gpus[0].get("MemoryInfo", {}).get("SizeInMiB"), "gpu_memory")
        # EC2 reports its documented 48 GB L40S as 45,776 MiB (decimal GB),
        # not 49,152 MiB. Admit that exact known shape, not arbitrary smaller GPUs.
        l40s_decimal_48gb = (instance_type == "g6e.2xlarge" and gpus[0].get("Name") == "L40S" and gpu_memory >= 45776)
        if instance_type == "g6e.2xlarge" and gpus[0].get("Name") != "L40S":
            blockers.append("approved_g6e_l40s_identity_mismatch")
        if gpu_memory < 46000 and not l40s_decimal_48gb:
            blockers.append("single_gpu_memory_below_48gb_class")
    if cpu < 8 or memory < 65536:
        blockers.append("below_conservative_8vcpu_64gib_stack_candidate")
    return {"vcpus": cpu, "hostMemoryMiB": memory, "gpuMemoryMiB": gpu_memory,
            "gpuName": gpus[0].get("Name") if single_nvidia else None,
            "candidateHardwareChecksPassed": not blockers, "actualModelFitVerified": False, "blockers": blockers}


def price_report(response, instance_type, region, now):
    if response.get("NextToken"):
        raise InspectionError("incomplete_price_result")
    matches = []
    expected = {"instanceType": instance_type, "regionCode": region, "operatingSystem": "Linux",
                "tenancy": "Shared", "capacitystatus": "Used", "preInstalledSw": "NA"}
    for encoded in response.get("PriceList", []):
        try:
            product = json.loads(encoded) if isinstance(encoded, str) else encoded
            attributes = product["product"]["attributes"]
            if product["product"].get("productFamily") != "Compute Instance" or any(attributes.get(k) != v for k, v in expected.items()):
                raise InspectionError("price_product_identity_mismatch")
            for term in product.get("terms", {}).get("OnDemand", {}).values():
                effective = datetime.fromisoformat(term["effectiveDate"].replace("Z", "+00:00"))
                if effective.tzinfo is None or effective > now:
                    raise InspectionError("price_effective_date_invalid")
                dimensions = list(term["priceDimensions"].values())
                if len(dimensions) != 1:
                    raise InspectionError("tiered_or_ambiguous_price")
                dimension = dimensions[0]
                if (dimension.get("unit") != "Hrs" or dimension.get("beginRange") != "0"
                        or dimension.get("endRange") != "Inf" or dimension.get("appliesTo")):
                    raise InspectionError("unsupported_price_dimension")
                rate = _decimal(dimension["pricePerUnit"]["USD"], "hourly_price", positive=True)
                matches.append({"hourlyUsd": str(rate), "sku": product["product"]["sku"],
                                "rateCode": dimension["rateCode"], "effectiveDate": term["effectiveDate"]})
        except (KeyError, TypeError, ValueError) as error:
            if isinstance(error, InspectionError):
                raise
            raise InspectionError("invalid_price_document") from error
    if len(matches) != 1:
        raise InspectionError("missing_or_ambiguous_on_demand_price")
    return {**matches[0], "currency": "USD", "purchaseOption": "OnDemand", "operatingSystem": "Linux",
            "tenancy": "Shared", "targetRegion": region, "pricingEndpointRegion": "us-east-1",
            "source": "AWS Pricing GetProducts", "responseSha256": _sha(response),
            "fetchedAt": now.isoformat(), "creditsApplied": False,
            "includes": "EC2 instance compute only", "excludes": ["EBS", "public IPv4", "data transfer", "tax", "other services"],
            "launchQuote": False}


def quota_report(response, vcpus):
    quota = response.get("Quota", {})
    if quota.get("QuotaCode") != QUOTA_CODE or quota.get("ServiceCode") != "ec2" or quota.get("GlobalQuota") is not False:
        raise InspectionError("quota_identity_mismatch")
    value = _decimal(quota.get("Value"), "quota_value")
    return {"code": QUOTA_CODE, "approvedVcpus": str(value), "requiredVcpusForOneInstance": vcpus,
            "approvedQuotaAtLeastOneInstance": value >= vcpus, "usedVcpus": None, "availableVcpus": None,
            "launchCapacityVerified": False, "note": "This is the account's regional quota, not unused capacity."}


def inspect_account(profile, region, instance_type, *, runner=run_readonly, now=None):
    commands = read_commands(profile, region, instance_type)
    now = now or datetime.now(timezone.utc)
    responses, errors = {}, {}
    for name, command in commands.items():
        try:
            responses[name] = runner(command)
        except InspectionError as error:
            errors[name] = str(error)
    result = {"inspectionCompleted": not errors, "readCommandsAttempted": len(commands), "errors": errors,
              "checks": {}, "blockers": []}
    parsers = {
        "hardware": lambda value: hardware_report(value, instance_type),
        "pricing": lambda value: price_report(value, instance_type, region, now),
    }
    for name, parse in parsers.items():
        if name in responses:
            try:
                result["checks"][name] = parse(responses[name])
            except (InspectionError, TypeError) as error:
                errors[name] = str(error) if isinstance(error, InspectionError) else "invalid_response_shape"
    identity = responses.get("identity", {})
    if "identity" not in errors:
        if re.fullmatch(r"\d{12}", str(identity.get("Account", ""))):
            result["checks"]["identity"] = {"authenticated": True, "accountId": identity["Account"]}
        else:
            errors["identity"] = "invalid_account_identity"
    if "offering" in responses:
        response = responses["offering"]
        if response.get("NextToken"):
            errors["offering"] = "incomplete_offering_result"
        else:
            offered = any(row.get("InstanceType") == instance_type and row.get("Location") == region
                          and row.get("LocationType") == "region" for row in response.get("InstanceTypeOfferings", []))
            result["checks"]["offering"] = {"offeredInRegion": offered, "capacityAvailable": None}
            if not offered:
                result["blockers"].append("instance_not_offered_in_region")
    hardware = result["checks"].get("hardware")
    if hardware:
        result["blockers"].extend(hardware["blockers"])
    if "quota" in responses and hardware:
        try:
            quota = quota_report(responses["quota"], hardware["vcpus"])
            result["checks"]["quota"] = quota
            if not quota["approvedQuotaAtLeastOneInstance"]:
                result["blockers"].append("approved_g_vt_vcpu_quota_below_one_instance")
        except InspectionError as error:
            errors["quota"] = str(error)
    elif "quota" not in errors:
        errors["quota"] = "hardware_required_to_assess_quota"
    result["inspectionCompleted"] = not errors
    result["blockers"].extend(f"{name}_inspection_failed" for name in errors)
    return result


def readiness(*, inspect=False, profile=None, region=None, instance_type=DEFAULT_INSTANCE, runner=run_readonly):
    versions = json.loads((HERE / "versions.json").read_text(encoding="utf-8"))
    result = {"version": "goalspec-aws-readiness-v1", "provider": "aws", "instanceType": instance_type,
              "region": region, "profile": profile, "awsCliAvailable": shutil.which("aws") is not None,
              "accountInspectionRequested": inspect, "inspection": None, "grossLimits": versions["limits"],
              "credits": {"status": "unverified", "balanceUsd": None, "eligibleServices": None},
              "readyToProvision": False, "readyForGpuExecution": False, "blockers": list(OUTSTANDING_GATES),
              "note": "Read-only evidence. No credentials printed, quota requests, resource mutations, model calls or reservations."}
    if inspect:
        if not profile or not region:
            raise InspectionError("explicit_profile_and_region_required")
        inspection = inspect_account(profile, region, instance_type, runner=runner)
        result["inspection"] = inspection
        result["blockers"].extend(inspection["blockers"])
        quote = inspection["checks"].get("pricing")
        if quote:
            within = Decimal(quote["hourlyUsd"]) <= Decimal(str(versions["limits"]["hourlyUsd"]))
            result["hourlyGrossLimitSatisfied"] = within
            if not within:
                result["blockers"].append("live_ec2_compute_price_exceeds_existing_hourly_gross_limit")
    else:
        result["blockers"].append("aws_account_not_inspected")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect-account", action="store_true", help="Explicitly allow the five read-only AWS API queries")
    parser.add_argument("--profile")
    parser.add_argument("--region")
    parser.add_argument("--instance-type", default=DEFAULT_INSTANCE)
    parser.add_argument("--output", type=Path, help="Write a new report file without overwriting existing evidence")
    args = parser.parse_args(argv)
    if args.inspect_account and (not args.profile or not args.region):
        parser.error("--inspect-account requires explicit --profile and --region")
    try:
        report = readiness(inspect=args.inspect_account, profile=args.profile, region=args.region, instance_type=args.instance_type)
        encoded = json.dumps(report, indent=2, allow_nan=False) + "\n"
        if args.output:
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(encoded)
        print(encoded, end="")
    except (InspectionError, OSError) as error:
        print(json.dumps({"error": str(error) if isinstance(error, InspectionError) else type(error).__name__, "readyForGpuExecution": False}))
    # This inspector intentionally cannot satisfy the lifecycle/credit/host gates.
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
