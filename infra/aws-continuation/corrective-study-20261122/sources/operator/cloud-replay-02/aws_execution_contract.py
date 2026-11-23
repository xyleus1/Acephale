"""Pure AWS execution contracts. No provider, claim, financial, or model writes."""
import hashlib
import json
import math
from pathlib import Path
import re

SCIENCE_COMMIT = "5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
ACCOUNT = "REQUIRED_AWS_ACCOUNT_ID"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def verified_json(path, expected_sha256):
    path = Path(path)
    require(path.is_absolute() and path.is_file()
            and not any(item.is_symlink() for item in (path, *path.parents)),
            "Absolute regular non-symlink binding required")
    require(re.fullmatch("[a-f0-9]{64}", expected_sha256) is not None,
            "Exact binding digest required")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha256,
            "Root-approved binding bytes changed")
    return json.loads(raw)


def ec2_association(binding, response, host_instance_id, *, now, observed_at):
    """Validate root-bound EC2 facts against an actual DescribeInstances response.

    Root separately supplies the hash-reviewed binding and provider observation.
    This does not call AWS, authorize a new instance, or translate a Lambda receipt.
    """
    require(binding.get("kind") == "acephale-aws-execution-association-v1"
            and binding.get("provider") == "aws"
            and binding.get("accountId") == ACCOUNT
            and binding.get("sourceCommit") == SCIENCE_COMMIT,
            "Explicit AWS association for original science required")
    require(finite(now) and finite(observed_at)
            and finite(binding.get("hardDeadline"))
            and now < binding["hardDeadline"]
            and 0 <= now - observed_at <= 120,
            "Fresh provider evidence inside original finite deadline required")
    instance_id = binding.get("instanceId", "")
    require(re.fullmatch("i-[a-f0-9]{8,17}", instance_id) is not None
            and host_instance_id == instance_id,
            "Worker DMI must identify the exact EC2 instance")
    region = binding.get("region", "")
    require(re.fullmatch("[a-z]{2}(?:-[a-z]+)+-[0-9]+", region) is not None
            and re.fullmatch("ami-[a-f0-9]{8,17}", binding.get("imageId", "")) is not None
            and re.fullmatch("[a-z0-9]+[.][a-z0-9]+", binding.get("instanceType", "")) is not None
            and type(binding.get("leaseId")) is str and binding["leaseId"],
            "Explicit region, image, hardware, and lease required")
    expected = binding.get("expectedTags")
    keys = binding.get("tagKeys")
    require(type(expected) is dict and expected
            and all(type(k) is str and k and type(v) is str for k, v in expected.items())
            and type(keys) is dict and set(keys) == {"leaseId", "hardDeadline"}
            and all(type(v) is str and v in expected for v in keys.values())
            and keys["leaseId"] != keys["hardDeadline"]
            and expected[keys["leaseId"]] == binding["leaseId"],
            "Exact lease and immutable deadline tags required")
    try:
        tag_deadline = float(expected[keys["hardDeadline"]])
    except (ValueError, TypeError):
        raise ValueError("Deadline tag must bind the original finite deadline") from None
    require(math.isfinite(tag_deadline) and tag_deadline == binding["hardDeadline"],
            "Deadline tag must bind the original finite deadline")
    reservations = response.get("Reservations")
    require(type(reservations) is list, "Genuine EC2 DescribeInstances shape required")
    matches = []
    for reservation in reservations:
        require(type(reservation) is dict and type(reservation.get("Instances")) is list,
                "Complete EC2 reservation response required")
        for instance in reservation["Instances"]:
            require(type(instance) is dict, "Complete EC2 instance response required")
            if instance.get("InstanceId") == instance_id:
                matches.append((reservation, instance))
    require(len(matches) == 1, "Exactly one matching EC2 instance required")
    reservation, instance = matches[0]
    require(reservation.get("OwnerId") == ACCOUNT
            and instance.get("State", {}).get("Name") == "running"
            and instance.get("ImageId") == binding["imageId"]
            and instance.get("InstanceType") == binding["instanceType"]
            and re.fullmatch(re.escape(region) + "[a-z]",
                             instance.get("Placement", {}).get("AvailabilityZone", "")) is not None,
            "Account, running state, region, image, or hardware differs")
    rows = instance.get("Tags")
    require(type(rows) is list and all(type(row) is dict and set(row) == {"Key", "Value"}
            and type(row["Key"]) is str and type(row["Value"]) is str for row in rows),
            "Exact EC2 tag observations required")
    tags = {row["Key"]: row["Value"] for row in rows}
    require(len(tags) == len(rows) and all(tags.get(k) == v for k, v in expected.items()),
            "EC2 lease/deployment/deadline tags changed")
    return {"provider": "aws", "accountId": ACCOUNT, "region": region,
            "instanceId": instance_id, "imageId": instance["ImageId"],
            "instanceType": instance["InstanceType"], "leaseId": binding["leaseId"],
            "hardDeadline": binding["hardDeadline"], "sourceCommit": SCIENCE_COMMIT,
            "identityMethod": "DescribeInstances matched to worker DMI board_asset_tag",
            "providerMutationPerformed": False}


def claimed_unit(claim, *, unit_id, attempt_id, input_sha256, association_sha256):
    """Check the root-coordinated permanent claim. No creation, renewal, or retry."""
    require(type(claim) is dict and claim.get("pk") == "unit#" + unit_id
            and claim.get("attemptId") == attempt_id and type(attempt_id) is str and attempt_id
            and claim.get("status") in {"claimed", "running"}
            and claim.get("sourceCommit") == SCIENCE_COMMIT
            and claim.get("inputSha256") == input_sha256
            and claim.get("associationSha256") == association_sha256,
            "Exact current immutable unit claim required")
    require(all(re.fullmatch("[a-f0-9]{64}", value) for value in (input_sha256, association_sha256)),
            "Claim must bind exact inputs and AWS association")
    return dict(claim)
