"""Explicit AWS lifecycle operations. Import and --help perform no account calls.

The sole launch request follows durable reservations in both the original study
journal and its infrastructure slice. Unknown outcomes never release a budget.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from decimal import ROUND_CEILING, Decimal
from pathlib import Path

import aws_readiness as readiness
from control import atomic_json as _atomic_json
from control import (
    finite_number,
    ledger_lock,
    read_json,
    sha256,
    validate_config,
    verify_export,
)
from control import write_new as _write_new

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PROFILE = "acephale-infra-v1"
READS = readiness.ALLOWED_READS | frozenset(("ec2", name) for name in (
    "describe-images", "describe-security-groups", "describe-subnets", "describe-key-pairs", "describe-instances", "describe-volumes"))
WRITES = frozenset(("ec2", name) for name in ("run-instances", "terminate-instances", "create-tags"))
APPROVED_TYPES = frozenset({"g6e.2xlarge"})


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def sync_directory(path):
    if os.name != "nt":
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def atomic_json(path, value):
    _atomic_json(path, value)
    sync_directory(path)


def write_new(path, value):
    _write_new(path, value)
    sync_directory(path)


def deployment_hash(plan):
    # External watchdog hosts may use different paths and named profiles.
    local = {"profile", "studyLedgerPath", "studyCheckpointPath", "exportRoot", "infrastructureLedgerPath"}
    return digest({key: value for key, value in plan.items() if key not in local})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def limits():
    return read_json(HERE / "versions.json")["limits"]


def config(path):
    value = read_json(path)
    readiness._validate_selection(value["profile"], value["region"], value["instanceType"])
    require(value["instanceType"] in APPROVED_TYPES, "Unapproved AWS hardware candidate")
    for key, pattern in {"accountId": r"\d{12}", "imageOwnerId": r"\d{12}", "imageId": r"ami-[a-f0-9]{8,17}",
                         "subnetId": r"subnet-[a-f0-9]{8,17}", "securityGroupId": r"sg-[a-f0-9]{8,17}",
                         "deploymentId": r"[a-z0-9][a-z0-9-]{7,48}"}.items():
        require(re.fullmatch(pattern, str(value.get(key, ""))), f"Invalid explicit {key}")
    require(re.fullmatch(r"arn:aws:iam::" + value["accountId"] + r":role/[A-Za-z0-9+=,.@_/-]+", value.get("operatorRoleArn", "")), "Expected operator IAM role required")
    require(isinstance(value.get("keyName"), str) and value["keyName"] and len(value["keyName"]) <= 255, "Existing SSH key name required")
    require(type(value.get("rootVolumeGiB")) is int and 80 <= value["rootVolumeGiB"] <= 250, "Explicit 80-250 GiB root volume required")
    require(type(value.get("associatePublicIp")) is bool, "Explicit network address choice required")
    require(re.fullmatch(r"[a-f0-9]{64}", value.get("studyCheckpointHash", "")), "Original study checkpoint hash required")
    for key in ("studyLedgerPath", "studyCheckpointPath", "exportRoot", "infrastructureLedgerPath"):
        require(isinstance(value.get(key), str) and value[key], f"Explicit {key} required")
        value[key] = str((path.parent / value[key]).resolve())
    require(value.get("sshCidrs") and len(value["sshCidrs"]) <= 4, "Explicit restricted SSH CIDRs required")
    for cidr in value["sshCidrs"]:
        network = ipaddress.ip_network(cidr, strict=True)
        require(network.prefixlen >= (24 if network.version == 4 else 64), "SSH CIDR too broad")
    return value


class AwsClient:
    def __init__(self, plan, profile=None):
        self.plan = plan
        self.profile = profile or plan["profile"]
        readiness._validate_selection(self.profile, plan["region"], plan["instanceType"])

    def call(self, service, operation, payload=None):
        require((service, operation) in READS | WRITES, "Unsupported AWS operation")
        region = "us-east-1" if service == "pricing" else self.plan["region"]
        command = ["aws", service, operation, "--profile", self.profile, "--region", region,
                   "--output", "json", "--no-cli-pager", "--no-cli-auto-prompt", "--no-paginate",
                   "--cli-connect-timeout", "10", "--cli-read-timeout", "20"]
        if payload:
            command += ["--cli-input-json", json.dumps(payload, separators=(",", ":"), allow_nan=False)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, shell=False, timeout=45, check=False,
                                    env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off", "AWS_MAX_ATTEMPTS": "1",
                                         "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS": "true"})
            if result.returncode:
                raise RuntimeError("AWS operation failed or uncertain; provider output omitted")
            value = json.loads(result.stdout or "{}")
            require(isinstance(value, dict) and not value.get("NextToken"), "Incomplete AWS response")
            return value
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            raise RuntimeError("AWS operation uncertain; reservations retained") from None


def identity(client, plan, role_arn=None):
    value = client.call("sts", "get-caller-identity")
    role = role_arn or plan["operatorRoleArn"]
    require(re.fullmatch(r"arn:aws:iam::" + plan["accountId"] + r":role/[A-Za-z0-9+=,.@_/-]+", role), "IAM role account mismatch")
    expected = "arn:aws:sts::" + plan["accountId"] + ":assumed-role/" + role.rsplit("/", 1)[-1] + "/"
    require(value.get("Account") == plan["accountId"] and str(value.get("Arn", "")).startswith(expected), "AWS account or assumed IAM role mismatch")
    return value


def study_budget(plan, operation, lease=None):
    request = {"operation": operation, "ledgerPath": plan["studyLedgerPath"], "checkpointPath": plan["studyCheckpointPath"],
               "checkpointHash": plan["studyCheckpointHash"], "sliceLedgerPath": plan["infrastructureLedgerPath"],
               "deploymentHash": deployment_hash(plan)}
    if lease:
        request.update(reservationId="aws-infra:" + lease["id"], maximumMicrodollars=lease["reservedMicrodollars"], requireNewReservation=True)
    # Request contains paths and monetary limits only, never credentials.
    with tempfile.TemporaryDirectory(prefix="acephale-aws-budget-") as directory:
        path = Path(directory) / "request.json"
        write_new(path, request)
        try:
            result = subprocess.run(["node", "--import", "tsx", "scripts/acephale-aws-budget.ts", str(path)], cwd=ROOT,
                                    capture_output=True, text=True, timeout=180, check=False, shell=False)
        except (OSError, subprocess.SubprocessError):
            raise RuntimeError("Original study reservation uncertain; retain slice reservation") from None
        require(result.returncode == 0, "Original study reservation unavailable; retain slice reservation")
        return json.loads(result.stdout)


def init_ledger(path, plan, prior_gpu_hours, budget=study_budget):
    hours = finite_number(prior_gpu_hours, "reconciled prior GPU hours")
    require(hours <= limits()["cumulativeGpuHours"], "Prior GPU hours exceed original cap")
    require(path.resolve() == Path(plan["infrastructureLedgerPath"]).resolve(), "Only the configured AWS slice ledger is allowed")
    require(not path.exists(), "Existing AWS slice ledger cannot be initialized again")
    checkpoint = budget(plan, "bind")
    require(checkpoint["infrastructureMicrodollars"] <= limits()["infrastructureUsd"] * 1_000_000, "Prior infrastructure budget exceeded")
    value = {"schemaVersion": 1, "provider": "aws", "profile": PROFILE, "plan": plan, "planHash": digest(plan),
             "versionsSha256": sha256(HERE / "versions.json"), "priorGpuHours": hours,
             "priorInfrastructureMicrodollars": checkpoint["infrastructureMicrodollars"], "initialStudyEvidence": checkpoint, "leases": []}
    write_new(path, value)
    return value


def checked_ledger(path, plan):
    require(path.resolve() == Path(plan["infrastructureLedgerPath"]).resolve(), "Only the configured AWS slice ledger is allowed")
    value = read_json(path)
    require(value.get("provider") == "aws" and value.get("schemaVersion") == 1 and value.get("planHash") == digest(plan)
            and value.get("versionsSha256") == sha256(HERE / "versions.json"), "AWS ledger/configuration/limits mismatch")
    return value


def reserved_infrastructure(ledger):
    return ledger["priorInfrastructureMicrodollars"] + sum(row["reservedMicrodollars"] for row in ledger["leases"] + ledger.get("overheads", []))


def reserve_overhead(path, plan, reservation_id, maximum_usd, cost_path, *, package_path, now=None, budget=study_budget):
    """Reserve real serverless/storage overhead before deployment, without AWS calls."""
    now = time.time() if now is None else now
    require(str(uuid.UUID(reservation_id)) == reservation_id, "Canonical overhead UUID required")
    maximum = int((Decimal(str(finite_number(maximum_usd, "overhead maximum", 0.01))) * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
    cost = read_json(cost_path)
    package = read_json(package_path)
    coverage_start = finite_number(package.get("coverageStartsAt"), "package coverage start")
    coverage_end = finite_number(package.get("coverageEndsAt"), "package coverage end")
    require(package.get("planHash") == deployment_hash(plan) and 0 < coverage_end - coverage_start <= 24 * 3600
            and re.fullmatch(r"[a-f0-9]{64}", package.get("codeManifestSha256", ""))
            and sha256(package_path.parent / "acephale-watchdog.zip") == package.get("zipSha256"), "Exact rendered package evidence required")
    estimate = Decimal(str(cost.get("estimatedGrossUsd")))
    require(estimate.is_finite() and estimate > 0 and estimate * 1_000_000 <= maximum
            and cost.get("creditsApplied") is False and cost.get("freeTierDiscountsApplied") is False
            and set(cost.get("regions", [])) == {"us-east-1", "us-west-2"}
            and 0 < finite_number(cost.get("coverageHours"), "cost coverage") <= 24,
            "Gross two-region cost estimate must fit reservation without discounts")
    require(cost["coverageHours"] * 3600 >= coverage_end - coverage_start, "Cost estimate does not cover package schedule window")
    amounts = [Decimal(str(value)) for value in cost.get("lineItemsUsd", {}).values()]
    require(amounts and all(value.is_finite() and value >= 0 for value in amounts) and sum(amounts) == estimate,
            "Cost estimate line items do not reconcile")
    require(cost.get("priceEvidence"), "Actual price evidence required")
    for evidence in cost["priceEvidence"]:
        source = (cost_path.parent / evidence["path"]).resolve()
        require(sha256(source) == evidence["sha256"], "Price evidence changed")
    with ledger_lock(path):
        ledger = checked_ledger(path, plan)
        require(not any(row["id"] == reservation_id for row in ledger["leases"] + ledger.get("overheads", [])), "Reservation already attempted; retain and reconcile")
        require(reserved_infrastructure(ledger) + maximum <= limits()["infrastructureUsd"] * 1_000_000, "Infrastructure slice exhausted")
        row = {"id": reservation_id, "kind": "serverless_overhead", "status": "reservation_pending", "createdAt": now,
               "reservedMicrodollars": maximum, "costReceiptSha256": sha256(cost_path), "costReceiptPath": str(cost_path.resolve()),
               "coverageHours": cost["coverageHours"], "planHash": deployment_hash(plan), "packageReceiptSha256": sha256(package_path),
               "codeManifestSha256": package["codeManifestSha256"], "coverageStartsAt": coverage_start, "coverageEndsAt": coverage_end}
        ledger.setdefault("overheads", []).append(row)
        atomic_json(path, ledger)
        row["studyReservation"] = budget(plan, "reserve", row)
        row["status"] = "reserved"
        atomic_json(path, ledger)
        return row.copy()


def one(response, key):
    values = response.get(key, [])
    require(not response.get("NextToken") and len(values) == 1, f"Missing or ambiguous {key}")
    return values[0]


def instances(response, account):
    require(not response.get("NextToken"), "Incomplete instance inventory")
    output = []
    for reservation in response.get("Reservations", []):
        require(reservation.get("OwnerId") == account, "Instance owner mismatch")
        output.extend(reservation.get("Instances", []))
    return output


def quote(client, plan, now=None):
    now = time.time() if now is None else now
    evidence = {"identity": identity(client, plan)}
    evidence["hardware"] = client.call("ec2", "describe-instance-types", {"InstanceTypes": [plan["instanceType"]]})
    hardware = readiness.hardware_report(evidence["hardware"], plan["instanceType"])
    require(hardware["candidateHardwareChecksPassed"], "Pinned single-NVIDIA 48GB hardware check failed")
    evidence["pricing"] = client.call("pricing", "get-products", {"ServiceCode": "AmazonEC2", "FormatVersion": "aws_v1", "MaxResults": 100,
        "Filters": [{"Type": "TERM_MATCH", "Field": key, "Value": value} for key, value in {
            "instanceType": plan["instanceType"], "regionCode": plan["region"], "operatingSystem": "Linux",
            "tenancy": "Shared", "capacitystatus": "Used", "preInstalledSw": "NA"}.items()]})
    price = readiness.price_report(evidence["pricing"], plan["instanceType"], plan["region"], datetime.fromtimestamp(now, timezone.utc))
    require(Decimal(price["hourlyUsd"]) <= Decimal(str(limits()["hourlyUsd"])), "Live gross compute rate exceeds unchanged hourly cap")
    evidence["image"] = client.call("ec2", "describe-images", {"ImageIds": [plan["imageId"]], "Owners": [plan["imageOwnerId"]]})
    image = one(evidence["image"], "Images")
    require(image.get("ImageId") == plan["imageId"] and image.get("OwnerId") == plan["imageOwnerId"] and image.get("State") == "available"
            and image.get("Architecture") == "x86_64" and image.get("VirtualizationType") == "hvm" and image.get("RootDeviceType") == "ebs"
            and not image.get("ProductCodes") and image.get("PlatformDetails") == "Linux/UNIX", "Explicit pinned free Linux AMI verification failed")
    mappings = image.get("BlockDeviceMappings", [])
    require(len(mappings) == 1 and mappings[0].get("DeviceName") == image.get("RootDeviceName") and "Ebs" in mappings[0]
            and mappings[0]["Ebs"].get("VolumeSize", 0) <= plan["rootVolumeGiB"], "Unexpected AMI storage mapping")
    evidence["subnet"] = client.call("ec2", "describe-subnets", {"SubnetIds": [plan["subnetId"]]})
    subnet = one(evidence["subnet"], "Subnets")
    require(subnet.get("SubnetId") == plan["subnetId"] and subnet.get("OwnerId") == plan["accountId"]
            and subnet.get("State") == "available" and subnet.get("AvailableIpAddressCount", 0) > 0, "Subnet identity/capacity mismatch")
    evidence["offering"] = client.call("ec2", "describe-instance-type-offerings", {"LocationType": "availability-zone", "Filters": [
        {"Name": "instance-type", "Values": [plan["instanceType"]]}, {"Name": "location", "Values": [subnet["AvailabilityZone"]]}]})
    offered = one(evidence["offering"], "InstanceTypeOfferings")
    require(offered.get("InstanceType") == plan["instanceType"] and offered.get("Location") == subnet["AvailabilityZone"], "Candidate not offered in selected AZ")
    evidence["securityGroup"] = client.call("ec2", "describe-security-groups", {"GroupIds": [plan["securityGroupId"]]})
    group = one(evidence["securityGroup"], "SecurityGroups")
    require(group.get("GroupId") == plan["securityGroupId"] and group.get("OwnerId") == plan["accountId"]
            and group.get("VpcId") == subnet.get("VpcId"), "Security group scope mismatch")
    allowed = {str(ipaddress.ip_network(cidr, strict=True)) for cidr in plan["sshCidrs"]}
    actual = set()
    for rule in group.get("IpPermissions", []):
        require(rule.get("IpProtocol") == "tcp" and rule.get("FromPort") == rule.get("ToPort") == 22
                and not rule.get("UserIdGroupPairs") and not rule.get("PrefixListIds"), "Only restricted SSH ingress is allowed")
        for row in rule.get("IpRanges", []) + rule.get("Ipv6Ranges", []):
            actual.add(str(ipaddress.ip_network(row.get("CidrIp", row.get("CidrIpv6", "")), strict=True)))
    require(actual and actual <= allowed, "Security group SSH CIDRs exceed pinned addresses")
    evidence["key"] = client.call("ec2", "describe-key-pairs", {"KeyNames": [plan["keyName"]]})
    require(one(evidence["key"], "KeyPairs").get("KeyName") == plan["keyName"], "Existing SSH key not found")
    evidence["quota"] = client.call("service-quotas", "get-service-quota", {"ServiceCode": "ec2", "QuotaCode": readiness.QUOTA_CODE})
    quota = readiness.quota_report(evidence["quota"], hardware["vcpus"])
    evidence["usage"] = client.call("ec2", "describe-instances", {"Filters": [{"Name": "instance-state-name", "Values": ["pending", "running"]}]})
    active = [row for row in instances(evidence["usage"], plan["accountId"])
              if not row.get("InstanceLifecycle") and re.match(r"(?:g\d|vt\d)", row.get("InstanceType", ""))]
    types = sorted({row["InstanceType"] for row in active})
    counts = {}
    if types:
        evidence["usageHardware"] = client.call("ec2", "describe-instance-types", {"InstanceTypes": types})
        counts = {row["InstanceType"]: row["VCpuInfo"]["DefaultVCpus"] for row in evidence["usageHardware"].get("InstanceTypes", [])}
        require(set(counts) == set(types) and all(type(v) is int and v > 0 for v in counts.values()), "Incomplete quota usage hardware")
    used = sum(counts[row["InstanceType"]] for row in active)
    require(Decimal(quota["approvedVcpus"]) >= used + hardware["vcpus"], "Insufficient current G/VT On-Demand vCPU headroom")
    validate_config()
    return {"quotedAt": now, "planHash": deployment_hash(plan), "hourlyUsd": price["hourlyUsd"], "hardware": hardware, "pricing": price,
            "usedVcpus": used, "rootDeviceName": image["RootDeviceName"], "availabilityZone": subnet["AvailabilityZone"],
            "evidence": evidence, "capacityGuaranteed": False}


def watchdog_receipts(paths, plan, now, required_until=None, *, bootstrap=False):
    require(len(paths) == 2, "Exactly two independent watchdog enrollments required")
    values = [read_json(path) for path in paths]
    for value in values:
        require(value.get("profile") == PROFILE and value.get("provider") == "aws" and value.get("planHash") == deployment_hash(plan)
                and value.get("accountId") == plan["accountId"] and value.get("region") == plan["region"]
                and value.get("controllerKind") == "independent_always_on" and value.get("discovery") == "ec2_tags"
                and 0 < finite_number(value.get("maxPollSeconds"), "watchdog poll") <= 60
                and 0 <= now - finite_number(value.get("heartbeatAt"), "watchdog heartbeat") <= 120
                , "Missing/stale watchdog identity or heartbeat")
        if bootstrap:
            require(value.get("receiptKind") == "healthy_deployed_watchdog_arming" and value.get("hostingKind") == "aws_lambda"
                    and value.get("terminationRecoveryTestPassed") is False and value.get("deployedCodeVerified") is True,
                    "Canary requires live healthy deployed watchdog arming evidence")
        else:
            require(0 <= now - finite_number(value.get("verifiedAt"), "watchdog verification") <= 300
                    and value.get("terminationRecoveryTestPassed") is True
                    and re.fullmatch(r"[a-f0-9]{64}", value.get("recoveryEvidenceSha256", "")), "Missing/stale watchdog enrollment or recovery evidence")
        if value.get("hostingKind") == "aws_lambda":
            require(value.get("scheduleCadenceSeconds") == 60 and value.get("schedulerPrecisionSeconds") == 60
                    and value.get("internalPollOffsetsSeconds") == [0, 30, 60] and value.get("deliveryGuaranteed") is False
                    and (bootstrap or value.get("recoveryEvidenceKind") == "live_provider_recovery")
                    and re.fullmatch(r"[a-f0-9]{64}", value.get("codeManifestSha256", ""))
                    and re.fullmatch(r"[a-f0-9]{64}", value.get("lastEvidenceSha256", ""))
                    and finite_number(value.get("coverageStartsAt"), "watchdog coverage start") <= now
                    and finite_number(value.get("coverageEndsAt"), "watchdog coverage end") >= (required_until or now) + 300,
                    "Serverless watchdog cadence/evidence/coverage does not cover this lease")
            suffix = "a" if value.get("failureDomain") == "aws-region:us-east-1" else "b"
            host_region = "us-east-1" if suffix == "a" else "us-west-2"
            require(value.get("failureDomain") == "aws-region:" + host_region
                    and value.get("controllerId") == "acephale-watchdog-" + suffix
                    and value.get("hostId") == f"arn:aws:lambda:{host_region}:{plan['accountId']}:function:acephale-watchdog-{suffix}",
                    "Serverless controller identity mismatch")
    for field in ("controllerId", "hostId", "failureDomain"):
        require(all(isinstance(value.get(field), str) and value[field] for value in values)
                and len({value[field] for value in values}) == 2, "Watchdogs must have distinct controllers, hosts and failure domains")
    return [{"controllerId": value["controllerId"], "receiptSha256": sha256(path),
             **({key: value[key] for key in ("codeManifestSha256", "coverageStartsAt", "coverageEndsAt")} if value.get("hostingKind") == "aws_lambda" else {})}
            for path, value in zip(paths, values)]


def tags(plan, lease):
    value = {"AcephaleProfile": PROFILE, "AcephaleDeployment": plan["deploymentId"], "AcephalePlanHash": deployment_hash(plan),
            "AcephaleLease": lease["id"], "AcephaleDeadline": str(lease["deadline"]), "AcephaleSetupDeadline": str(lease["setupDeadline"]),
            "AcephaleReady": "false", "Name": "acephale-" + lease["id"]}
    if lease.get("purpose") == "watchdog_recovery_canary":
        value.update(AcephalePurpose="watchdog_recovery_canary", AcephaleRecoveryController=lease["recoveryController"],
                     AcephaleCanaryStopAt=str(lease["canaryStopAt"]))
    return value


def launch_payload(plan, lease, current_quote):
    tagged = [{"Key": key, "Value": value} for key, value in tags(plan, lease).items()]
    return {"ClientToken": lease["clientToken"], "ImageId": plan["imageId"], "InstanceType": plan["instanceType"], "MinCount": 1, "MaxCount": 1,
            "KeyName": plan["keyName"], "Placement": {"AvailabilityZone": current_quote["availabilityZone"], "Tenancy": "default"},
            "NetworkInterfaces": [{"DeviceIndex": 0, "SubnetId": plan["subnetId"], "Groups": [plan["securityGroupId"]],
                                   "AssociatePublicIpAddress": plan["associatePublicIp"], "DeleteOnTermination": True}],
            "BlockDeviceMappings": [{"DeviceName": current_quote["rootDeviceName"], "Ebs": {
                "VolumeSize": plan["rootVolumeGiB"], "VolumeType": "gp3", "Encrypted": True, "DeleteOnTermination": True}}],
            "MetadataOptions": {"HttpTokens": "required", "HttpEndpoint": "enabled", "HttpPutResponseHopLimit": 1},
            "CapacityReservationSpecification": {"CapacityReservationPreference": "none"}, "Monitoring": {"Enabled": False},
            "InstanceInitiatedShutdownBehavior": "terminate", "DisableApiTermination": False,
            "TagSpecifications": [{"ResourceType": kind, "Tags": tagged} for kind in ("instance", "volume")]}


def launch(client, path, plan, lease_id, hours, extra_allowance, watchdog_paths, *, now=None, budget=study_budget, recovery_controller=None):
    supplied_now = now
    now = time.time() if now is None else now
    require(str(uuid.UUID(lease_id)) == lease_id, "Canonical lease UUID required")
    hours = finite_number(hours, "session hours", 0.01)
    allowance = finite_number(extra_allowance, "storage/IP/tax/transfer allowance", 1)
    require(hours <= limits()["sessionHours"], "Session exceeds original limit")
    bootstrap = recovery_controller is not None
    if bootstrap:
        require(recovery_controller in {"acephale-watchdog-a", "acephale-watchdog-b"} and hours == 5 / 60,
                "Recovery canary must target one known controller for exactly five minutes")
    reserved_hours = 10 / 60 if bootstrap else hours
    with ledger_lock(path):
        ledger = checked_ledger(path, plan)
        require(not any(row["id"] == lease_id for row in ledger["leases"] + ledger.get("overheads", [])), "Lease already attempted; reconcile, never relaunch")
        require(all(row["status"] == "terminated" for row in ledger["leases"]), "Unresolved AWS lease blocks launch")
        require(ledger["priorGpuHours"] + sum(row["reservedHours"] for row in ledger["leases"]) + reserved_hours <= limits()["cumulativeGpuHours"], "Cumulative GPU-hour cap exceeded")
        enrollments = watchdog_receipts(watchdog_paths, plan, now, now + hours * 3600, bootstrap=bootstrap)
        for enrollment in enrollments:
            if "codeManifestSha256" in enrollment:
                require(any(row.get("status") == "reserved" and row.get("kind") == "serverless_overhead"
                            and all(row.get(key) == enrollment[key] for key in ("codeManifestSha256", "coverageStartsAt", "coverageEndsAt"))
                            for row in ledger.get("overheads", [])),
                        "Reserve this exact serverless package/window in the original study before any GPU launch")
        current_quote = quote(client, plan, now)
        maximum = int(((Decimal(current_quote["hourlyUsd"]) * Decimal(str(reserved_hours)) + Decimal(str(allowance))) * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
        require(reserved_infrastructure(ledger) + maximum
                <= limits()["infrastructureUsd"] * 1_000_000, "Infrastructure slice exhausted")
        lease = {"id": lease_id, "clientToken": "acephale-" + lease_id, "status": "reservation_pending", "instanceId": None,
                 "reservedHours": reserved_hours, "reservedMicrodollars": maximum, "createdAt": now,
                 "deadline": int(now + hours * 3600), "setupDeadline": int(now + min(hours * 3600, limits()["setupMinutes"] * 60)),
                 "watchdogs": enrollments, "quote": current_quote, "ready": False}
        if bootstrap:
            lease.update(purpose="watchdog_recovery_canary", recoveryController=recovery_controller, canaryStopAt=int(now + 120),
                         operatorCleanupRequired=True, inferenceAllowed=False)
        ledger["leases"].append(lease)
        atomic_json(path, ledger)
        # Slice intention comes first. A crash before/after the study write stays
        # reserved/blocked; reconciliation never repeats RunInstances.
        lease["studyReservation"] = budget(plan, "reserve", lease)
        before_dispatch = time.time() if supplied_now is None else now
        require(0 <= before_dispatch - current_quote["quotedAt"] <= 300 and before_dispatch < lease["setupDeadline"], "Evidence expired before dispatch; reservations retained")
        watchdog_receipts(watchdog_paths, plan, before_dispatch, lease["deadline"], bootstrap=bootstrap)
        lease["status"] = "launching"
        payload = launch_payload(plan, lease, current_quote)
        lease["launchPayloadSha256"] = digest(payload)
        atomic_json(path, ledger)
        try:
            result = client.call("ec2", "run-instances", payload)
            row = one(result, "Instances")
            require(re.fullmatch(r"i-[a-f0-9]{8,17}", row.get("InstanceId", "")), "Ambiguous launch response")
            lease["instanceId"] = row["InstanceId"]
            lease["status"] = "launched_unverified"
        except Exception:
            lease["status"] = "launch_unknown"
            atomic_json(path, ledger)
            raise
        atomic_json(path, ledger)
        return {key: lease[key] for key in ("id", "status", "instanceId", "reservedMicrodollars", "deadline", "setupDeadline")}


def checked_instance(row, plan, lease=None):
    require(row.get("InstanceType") == plan["instanceType"] and row.get("ImageId") == plan["imageId"]
            and row.get("SubnetId") == plan["subnetId"], "Provider instance identity differs from pinned plan")
    labels = {item["Key"]: item["Value"] for item in row.get("Tags", [])}
    require(labels.get("AcephaleProfile") == PROFILE and labels.get("AcephaleDeployment") == plan["deploymentId"]
            and labels.get("AcephalePlanHash") == deployment_hash(plan), "Instance tag scope mismatch")
    if lease:
        require(row.get("ClientToken") == lease["clientToken"] and labels.get("AcephaleLease") == lease["id"]
                and str(lease["deadline"]) == labels.get("AcephaleDeadline") and str(lease["setupDeadline"]) == labels.get("AcephaleSetupDeadline")
                and (not lease["instanceId"] or row["InstanceId"] == lease["instanceId"]), "Lease/provider identity mismatch")
    return labels


def reconcile(client, path, plan, lease_id, now=None):
    now = time.time() if now is None else now
    identity(client, plan)
    with ledger_lock(path):
        ledger = checked_ledger(path, plan)
        lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
        response = client.call("ec2", "describe-instances", {"Filters": [{"Name": "client-token", "Values": [lease["clientToken"]]}]})
        rows = instances(response, plan["accountId"])
        require(len(rows) == 1, "Unresolved launch visibility; reservation retained, never retry launch")
        row = rows[0]
        checked_instance(row, plan, lease)
        lease["instanceId"] = row["InstanceId"]
        evidence = path.with_name(path.name + ".evidence") / (lease_id + ".describe-instances." + digest(response) + ".json")
        if not evidence.exists():
            write_new(evidence, response)
        lease["providerEvidencePath"], lease["providerEvidenceSha256"] = str(evidence.resolve()), sha256(evidence)
        state = row.get("State", {}).get("Name")
        if state == "terminated":
            lease["status"] = "terminated"
            lease.setdefault("terminationVerifiedAt", now)
        elif lease["status"] != "termination_requested":
            lease["status"] = "active" if state == "running" else "launched_unverified"
        atomic_json(path, ledger)
        return lease.copy()


def terminate(client, path, plan, lease_id, export_receipt=None, emergency=False, now=None):
    lease = reconcile(client, path, plan, lease_id, now)
    if lease["status"] == "terminated":
        return lease
    with ledger_lock(path):
        ledger = checked_ledger(path, plan)
        lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
        if not emergency:
            require(export_receipt is not None, "Normal termination requires verified exported files")
            lease["export"] = verify_export(Path(plan["exportRoot"]), export_receipt, lease_id)
        else:
            lease["emergencyTermination"] = True
        lease["status"] = "termination_requested"
        atomic_json(path, ledger)
        client.call("ec2", "terminate-instances", {"InstanceIds": [lease["instanceId"]]})
    return reconcile(client, path, plan, lease_id, now)


def mark_ready(client, path, plan, lease_id, smoke_path, now=None):
    now = time.time() if now is None else now
    lease = reconcile(client, path, plan, lease_id, now)
    require(lease.get("purpose") != "watchdog_recovery_canary", "Recovery canary cannot become inference-ready")
    smoke = read_json(smoke_path)
    require(lease["status"] == "active" and now < lease["setupDeadline"] and now < lease["deadline"], "Active lease within setup window required")
    provider = instances(read_json(Path(lease["providerEvidencePath"])), plan["accountId"])[0]
    require({row.get("GroupId") for row in provider.get("SecurityGroups", [])} == {plan["securityGroupId"]}
            and not provider.get("IamInstanceProfile"), "Unexpected live security group or instance IAM role")
    mappings = provider.get("BlockDeviceMappings", [])
    require(len(mappings) == 1 and mappings[0].get("Ebs", {}).get("DeleteOnTermination") is True, "Live root volume cleanup mismatch")
    volume = one(client.call("ec2", "describe-volumes", {"VolumeIds": [mappings[0]["Ebs"]["VolumeId"]]}), "Volumes")
    require(volume.get("VolumeId") == mappings[0]["Ebs"]["VolumeId"] and volume.get("Encrypted") is True
            and volume.get("VolumeType") == "gp3" and volume.get("Size") == plan["rootVolumeGiB"], "Live encrypted root volume mismatch")
    required = {"pinnedImages", "pinnedModels", "driver", "concurrentModels", "toolParsing", "telemetry", "export", "watchdogRecovery"}
    require(smoke.get("profile") == PROFILE and smoke.get("leaseId") == lease_id and smoke.get("instanceId") == lease["instanceId"]
            and smoke.get("passed") is True and all(smoke.get("checks", {}).get(key) is True for key in required), "Actual host smoke checks required")
    client.call("ec2", "create-tags", {"Resources": [lease["instanceId"]], "Tags": [{"Key": "AcephaleReady", "Value": "true"}]})
    # An uncertain tag write retains the budget and requires reconciliation.
    with ledger_lock(path):
        ledger = checked_ledger(path, plan)
        lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
        lease["ready"], lease["smokeReceiptSha256"] = True, sha256(smoke_path)
        atomic_json(path, ledger)
    return {"leaseId": lease_id, "smokeReceiptSha256": sha256(smoke_path)}


def watchdog_tick(client, plan, role_arn, now=None, controller_id=None):
    """Independent controllers discover deadlines from EC2, not the launcher disk."""
    now = time.time() if now is None else now
    identity(client, plan, role_arn)
    response = client.call("ec2", "describe-instances", {"Filters": [
        {"Name": "tag:AcephaleDeployment", "Values": [plan["deploymentId"]]}, {"Name": "tag:AcephalePlanHash", "Values": [deployment_hash(plan)]}]})
    results = []
    for row in instances(response, plan["accountId"]):
        if row.get("State", {}).get("Name") == "terminated":
            # A later poll can confirm asynchronous canary termination. Recovery
            # enrollment also requires this controller's earlier request receipt.
            try:
                labels = checked_instance(row, plan)
                deadline = float(labels.get("AcephaleDeadline", "nan"))
                if (labels.get("AcephalePurpose") == "watchdog_recovery_canary"
                        and labels.get("AcephaleRecoveryController") == controller_id and now < deadline):
                    results.append({"instanceId": row["InstanceId"], "leaseId": labels["AcephaleLease"], "terminationVerified": True,
                                    "terminationRequested": False, "recoveryController": controller_id, "evidenceSha256": digest(row)})
            except (ValueError, RuntimeError, KeyError, TypeError):
                pass
            continue
        try:
            labels = checked_instance(row, plan)
            deadline = finite_number(float(labels.get("AcephaleDeadline", "nan")), "provider deadline")
            setup = finite_number(float(labels.get("AcephaleSetupDeadline", "nan")), "provider setup deadline")
            require(setup <= deadline and deadline - setup <= limits()["sessionHours"] * 3600, "Invalid provider deadline tags")
            cutoff = deadline if labels.get("AcephaleReady") == "true" else min(deadline, setup)
            if labels.get("AcephalePurpose") == "watchdog_recovery_canary":
                # Other controllers retain the hard deadline. Only the target can
                # prove early recovery; a fallback termination is a failed test.
                cutoff = min(deadline, setup)
                if labels.get("AcephaleRecoveryController") == controller_id:
                    early = finite_number(float(labels.get("AcephaleCanaryStopAt", "nan")), "canary stop")
                    require(0 < deadline - early <= 180 and setup == deadline and labels.get("AcephaleReady") == "false",
                            "Invalid recovery canary deadline tags")
                    cutoff = early
            if now < cutoff:
                continue
            client.call("ec2", "terminate-instances", {"InstanceIds": [row["InstanceId"]]})
            after = client.call("ec2", "describe-instances", {"InstanceIds": [row["InstanceId"]]})
            observed = instances(after, plan["accountId"])
            verified = len(observed) == 1 and observed[0].get("InstanceId") == row["InstanceId"] and observed[0].get("State", {}).get("Name") == "terminated"
            results.append({"instanceId": row["InstanceId"], "leaseId": labels.get("AcephaleLease"), "terminationRequested": True,
                            "recoveryController": controller_id, "terminationVerified": verified, "evidenceSha256": digest(after)})
        except (ValueError, RuntimeError, KeyError, TypeError):
            results.append({"instanceId": row.get("InstanceId"), "error": "Watchdog instance cleanup unresolved", "terminationVerified": False})
    return results


def monitor_canary(client, path, plan, lease_id, *, clock=time.time, sleep=time.sleep):
    """Operator cleanup process stays attached; no model/SSH work is performed."""
    lease = next(row for row in checked_ledger(path, plan)["leases"] if row["id"] == lease_id)
    require(lease.get("purpose") == "watchdog_recovery_canary", "Only recovery canaries may use this monitor")
    last_error = None
    # Remain available for provider confirmation for five minutes after the hard
    # stop. Uncertainty retains reservations and is reported for operator action.
    while clock() <= lease["deadline"] + 300:
        try:
            result = reconcile(client, path, plan, lease_id, clock())
            if result["status"] == "terminated":
                return {"leaseId": lease_id, "status": "terminated", "providerEvidencePath": result["providerEvidencePath"],
                        "recoveryPassed": False, "note": "Import the target watchdog's actual request and confirmation evidence separately"}
            if clock() >= lease["deadline"]:
                terminate(client, path, plan, lease_id, emergency=True, now=clock())
        except (ValueError, RuntimeError, OSError, KeyError, StopIteration, TypeError):
            last_error = "provider_state_or_cleanup_unresolved"
        sleep(10)
    raise RuntimeError(last_error or "Canary termination remains unverified; independent cleanup continues and reservations remain")


def enroll_canary(path, plan, lease_id, armed_path, request_path, confirmation_path, output, *, now=None):
    """Import downloaded, operator-reviewed provider evidence; never fabricate success."""
    now = time.time() if now is None else now
    ledger = checked_ledger(path, plan)
    lease = next(row for row in ledger["leases"] if row["id"] == lease_id)
    require(lease.get("purpose") == "watchdog_recovery_canary" and lease["status"] == "terminated"
            and lease.get("studyReservation") and lease.get("terminationVerifiedAt", now) < lease["deadline"],
            "An original-budget-reserved canary must be provider-confirmed terminated before its fallback deadline")
    provider_path = Path(lease["providerEvidencePath"])
    require(sha256(provider_path) == lease["providerEvidenceSha256"], "Provider termination evidence changed")
    rows = instances(read_json(provider_path), plan["accountId"])
    require(len(rows) == 1 and rows[0].get("State", {}).get("Name") == "terminated", "Provider termination evidence missing")
    checked_instance(rows[0], plan, lease)
    armed, requested, confirmed = [read_json(item) for item in (armed_path, request_path, confirmation_path)]
    require(armed.get("receiptKind") == "healthy_deployed_watchdog_arming" and armed.get("planHash") == deployment_hash(plan)
            and armed.get("controllerId") == lease["recoveryController"] and armed.get("deployedCodeVerified") is True
            and 0 <= now - finite_number(armed.get("heartbeatAt"), "current arming heartbeat") <= 120,
            "Fresh target-controller arming receipt required")
    for evidence in (requested, confirmed):
        require(evidence.get("provider") == "aws" and evidence.get("planHash") == deployment_hash(plan)
                and evidence.get("controllerId") == lease["recoveryController"] and evidence.get("functionArn") == armed.get("hostId")
                and evidence.get("codeManifestSha256") == armed.get("codeManifestSha256")
                and evidence.get("coverageStartsAt") == armed.get("coverageStartsAt") and evidence.get("coverageEndsAt") == armed.get("coverageEndsAt")
                and lease["canaryStopAt"] <= evidence.get("startedAt", 0) <= evidence.get("finishedAt", 0) < lease["deadline"],
                "Canary evidence belongs to another deployment or the fallback deadline")
    def matching(evidence, flag):
        return any(item.get("instanceId") == lease["instanceId"] and item.get("leaseId") == lease_id
                   and item.get("recoveryController") == lease["recoveryController"] and item.get(flag) is True
                   for item in evidence.get("results", []))
    require(matching(requested, "terminationRequested") and matching(confirmed, "terminationVerified")
            and requested["startedAt"] <= confirmed["finishedAt"], "Actual target-controller request and provider confirmation required")
    proof = {"requestSha256": sha256(request_path), "confirmationSha256": sha256(confirmation_path),
             "providerSha256": lease["providerEvidenceSha256"], "leaseId": lease_id, "instanceId": lease["instanceId"]}
    enrollment = {**armed, "receiptKind": "operator_reviewed_recovery_enrollment", "terminationRecoveryTestPassed": True,
                  "recoveryEvidenceKind": "live_provider_recovery", "recoveryEvidenceSha256": digest(proof), "recoveryProof": proof,
                  "recoveryVerifiedAt": confirmed["finishedAt"], "verifiedAt": now}
    write_new(output, enrollment)
    return {"enrollmentPath": str(output.resolve()), "recoveryEvidenceSha256": enrollment["recoveryEvidenceSha256"], "awsCalls": 0}


def recovery_canary(client, path, plan, lease_id, allowance, armed_paths, controller_id):
    try:
        launch(client, path, plan, lease_id, 5 / 60, allowance, armed_paths, recovery_controller=controller_id)
    except (ValueError, RuntimeError, OSError, KeyError, TypeError):
        lease = next((row for row in checked_ledger(path, plan)["leases"] if row["id"] == lease_id), None)
        if not lease or lease["status"] not in {"launching", "launch_unknown", "launched_unverified"}:
            raise
        # A lost launch response still requires operator cleanup, never a retry.
    try:
        return monitor_canary(client, path, plan, lease_id)
    except KeyboardInterrupt:
        terminate(client, path, plan, lease_id, emergency=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init-ledger")
    init.add_argument("--ledger", type=Path, required=True)
    init.add_argument("--prior-gpu-hours", type=float, required=True)
    pricing = commands.add_parser("quote")
    pricing.add_argument("--output", type=Path, required=True)
    overhead = commands.add_parser("reserve-overhead")
    overhead.add_argument("--ledger", type=Path, required=True)
    overhead.add_argument("--reservation-id", required=True)
    overhead.add_argument("--maximum-usd", type=float, required=True)
    overhead.add_argument("--cost-receipt", type=Path, required=True)
    overhead.add_argument("--package-receipt", type=Path, required=True)
    for name in ("launch", "recovery-canary", "enroll-canary", "reconcile", "terminate", "mark-ready"):
        command = commands.add_parser(name)
        command.add_argument("--ledger", type=Path, required=True)
        command.add_argument("--lease-id", required=True)
        if name in {"launch", "recovery-canary"}:
            if name == "launch":
                command.add_argument("--hours", type=float, required=True)
            else:
                command.add_argument("--controller-id", choices=["acephale-watchdog-a", "acephale-watchdog-b"], required=True)
            command.add_argument("--extra-allowance-usd", type=float, required=True)
            command.add_argument("--watchdog-receipts", type=Path, nargs=2, required=True)
        elif name == "enroll-canary":
            command.add_argument("--armed-receipt", type=Path, required=True)
            command.add_argument("--request-evidence", type=Path, required=True)
            command.add_argument("--confirmation-evidence", type=Path, required=True)
            command.add_argument("--output", type=Path, required=True)
        elif name == "terminate":
            command.add_argument("--export-receipt", type=Path)
            command.add_argument("--emergency", action="store_true")
        elif name == "mark-ready":
            command.add_argument("--smoke-receipt", type=Path, required=True)
    watchdog = commands.add_parser("watchdog")
    watchdog.add_argument("--profile", required=True)
    watchdog.add_argument("--role-arn", required=True)
    watchdog.add_argument("--enrollment", type=Path, required=True)
    watchdog.add_argument("--heartbeat", type=Path, required=True)
    watchdog.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    plan = config(args.config.resolve())
    client = AwsClient(plan, args.profile if args.command == "watchdog" else None)
    if args.command == "init-ledger":
        init_ledger(args.ledger, plan, args.prior_gpu_hours)
        value = {"ledgerCreated": True, "providerCalls": 0}
    elif args.command == "quote":
        value = quote(client, plan)
        write_new(args.output, value)
        value = {"quoteEvidencePath": str(args.output), "hourlyUsd": value["hourlyUsd"], "capacityGuaranteed": False}
    elif args.command == "launch":
        value = launch(client, args.ledger, plan, args.lease_id, args.hours, args.extra_allowance_usd, args.watchdog_receipts)
    elif args.command == "reserve-overhead":
        reserved = reserve_overhead(args.ledger, plan, args.reservation_id, args.maximum_usd, args.cost_receipt, package_path=args.package_receipt)
        value = {key: reserved[key] for key in ("id", "status", "reservedMicrodollars", "costReceiptSha256")}
    elif args.command == "recovery-canary":
        value = recovery_canary(client, args.ledger, plan, args.lease_id, args.extra_allowance_usd, args.watchdog_receipts, args.controller_id)
    elif args.command == "enroll-canary":
        value = enroll_canary(args.ledger, plan, args.lease_id, args.armed_receipt, args.request_evidence, args.confirmation_evidence, args.output)
    elif args.command == "reconcile":
        value = reconcile(client, args.ledger, plan, args.lease_id)
    elif args.command == "terminate":
        value = terminate(client, args.ledger, plan, args.lease_id, args.export_receipt, args.emergency)
    elif args.command == "mark-ready":
        value = mark_ready(client, args.ledger, plan, args.lease_id, args.smoke_receipt)
    else:
        enrollment = read_json(args.enrollment)
        require(enrollment.get("planHash") == deployment_hash(plan) and enrollment.get("controllerKind") == "independent_always_on"
                and enrollment.get("terminationRecoveryTestPassed") is True, "Verified independent controller enrollment required")
        while True:
            started = time.time()
            try:
                results = watchdog_tick(client, plan, args.role_arn, started)
                require(not any(row.get("error") or row.get("terminationVerified") is False for row in results), "Watchdog cleanup unresolved; heartbeat not renewed")
                atomic_json(args.heartbeat, {**enrollment, "heartbeatAt": time.time(), "lastTick": results})
            except (ValueError, RuntimeError, OSError):
                # Preserve old heartbeat, making new launch fail closed, and retry
                # cleanup next tick rather than stopping the always-on controller.
                if args.once:
                    raise
            if args.once:
                value = {"watchdogTick": results}
                break
            time.sleep(max(1, 30 - (time.time() - started)))
    # Detailed evidence stays on disk. Never print account response bodies.
    if args.command in {"reconcile", "terminate"}:
        value = {key: value.get(key) for key in ("id", "status", "instanceId", "providerEvidencePath", "providerEvidenceSha256")}
    print(json.dumps(value, allow_nan=False))
    return 2 if args.command == "terminate" and value["status"] != "terminated" else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, KeyError, StopIteration, TypeError):
        print(json.dumps({"error": "AWS lifecycle gate failed or operation uncertain; inspect local evidence and retain reservations"}))
        raise SystemExit(1) from None
