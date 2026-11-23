"""Read-only EC2 identity and permanent claim gate for the unchanged replay body."""
import hashlib
from pathlib import Path
import re
import time
import aws_execution_contract as contract

PROJECT = "acephale-aws-20261121"
def _ref(value):
    contract.require(type(value) is dict and set(value) == {"path", "sha256"}, "Exact source or association FileRef required")
    return contract.verified_json(value["path"], value["sha256"])

def _source(value, actual):
    contract.require(type(value) is dict and set(value) == {"path", "sha256"}, "Exact approved helper FileRef required")
    path = Path(value["path"])
    contract.require(path.is_absolute() and path.resolve(strict=True) == Path(actual).resolve(strict=True)
        and not any(item.is_symlink() for item in (path, *path.parents))
        and re.fullmatch("[a-f0-9]{64}", value["sha256"]) is not None
        and hashlib.sha256(path.read_bytes()).hexdigest() == value["sha256"], "Approved provider helper origin or bytes differ")

def _read_evidence(association, execution):
    # Boto3 stays in the operational environment, outside the frozen science venv.
    import json
    import subprocess
    from decimal import Decimal
    reader = execution["sdkReader"]
    python = execution["sdkPython"]
    for item, allow_executable_link in ((reader, False), (python, True)):
        contract.require(type(item) is dict and set(item) == {"path", "sha256"},
                         "Exact operational SDK source and interpreter references required")
        path = Path(item["path"])
        contract.require(path.is_absolute() and path.is_file()
            and (allow_executable_link or not any(p.is_symlink() for p in (path, *path.parents)))
            and re.fullmatch("[a-f0-9]{64}", item["sha256"]) is not None
            and hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"],
            "Operational SDK source or interpreter bytes differ")
    request={"schemaVersion":1,"association":association,
             **{k:execution[k] for k in ("claimTable","claimRegion","unitId")}}
    result=subprocess.run([python["path"],reader["path"]], input=json.dumps(request),
        text=True,capture_output=True,timeout=45,check=False)
    contract.require(result.returncode==0 and len(result.stdout)<=4*1024*1024,
                     "Bounded read-only operational SDK observation failed")
    value=json.loads(result.stdout)
    contract.require(type(value) is dict and set(value)=={"response","claimAttributeValues"},
                     "Exact operational observation response required")
    def decode(value):
        contract.require(type(value) is dict and len(value)==1,"Exact DynamoDB attribute")
        tag,item=next(iter(value.items()))
        if tag=="S":
            contract.require(type(item) is str,"DynamoDB string");return item
        if tag=="N":
            number=Decimal(item);contract.require(number.is_finite(),"Finite DynamoDB number");return number
        if tag=="BOOL":
            contract.require(type(item) is bool,"DynamoDB bool");return item
        if tag=="NULL":
            contract.require(item is True,"DynamoDB null");return None
        if tag=="L":
            contract.require(type(item) is list,"DynamoDB list");return [decode(x) for x in item]
        if tag=="M":
            contract.require(type(item) is dict,"DynamoDB map");return {k:decode(v) for k,v in item.items()}
        raise ValueError("Unsupported claim attribute type")
    raw=value["claimAttributeValues"]
    contract.require(type(raw) is dict,"Actual strongly-consistent claim attributes required")
    return value["response"],{k:decode(v) for k,v in raw.items()}

def validate_provider(configuration, *, read_evidence=None, clock=time.time, dmi_path=None):
    execution = configuration.get("awsExecution")
    contract.require(type(execution) is dict, "Explicit AWS execution contract required")
    _source(execution["helper"], __file__)
    _source(execution["contract"], contract.__file__)
    association = _ref(execution["association"])
    contract.require(association.get("schemaVersion") == 1 and association.get("provider") == "aws"
        and association.get("accountId") == contract.ACCOUNT
        and association.get("scientificUnitClaimed") is False
        and association.get("controllerInstanceId") == "REQUIRED_INSTANCE_ID",
        "Root EC2 provisioning association required; it is not a scientific claim")
    contract.require(configuration.get("sourceCommit") == contract.SCIENCE_COMMIT
        and configuration.get("instanceId") == association.get("instanceId")
        and configuration.get("leaseId") == association.get("leaseId")
        and configuration.get("hardDeadline") == association.get("hardDeadline"),
        "Exact original source, worker, lease and hard deadline required")
    contract.require(contract.finite(association.get("hardDeadline")) and clock() < association["hardDeadline"],
        "Finite current EC2 lease deadline required before cloud observation")
    tags = association.get("expectedTags", {})
    contract.require(tags.get("Project") == PROJECT and tags.get("Role") == "worker"
        and tags.get("StudyId") == "acephale-frozen-5a36a8b3"
        and tags.get("LeaseId") == association["leaseId"],
        "Exact root-owned frozen-study worker tags required")
    contract.require(execution.get("claimRegion") == "us-east-1"
        and re.fullmatch(re.escape(PROJECT) + "[A-Za-z0-9_.-]*", execution.get("claimTable", "")) is not None
        and type(execution.get("unitId")) is str and execution["unitId"]
        and re.fullmatch("[a-f0-9]{64}", execution.get("qualificationSha256", "")) is not None,
        "Explicit canonical claim table, unit and actual qualification required")
    host = Path(dmi_path or "/sys/devices/virtual/dmi/id/board_asset_tag").read_text().strip()
    started = clock()
    response, claim = (read_evidence or _read_evidence)(association, execution)
    # This is an explicit schema adapter, not a synthetic Lambda provider receipt.
    checked = contract.ec2_association({
        "kind": "acephale-aws-execution-association-v1", "provider": "aws",
        "accountId": association["accountId"], "sourceCommit": configuration["sourceCommit"],
        "instanceId": association["instanceId"], "region": association["region"],
        "imageId": association["imageId"], "instanceType": association["instanceType"],
        "leaseId": association["leaseId"], "hardDeadline": association["hardDeadline"],
        "expectedTags": tags, "tagKeys": {"leaseId": "LeaseId", "hardDeadline": "HardStopEpoch"},
    }, response, host, now=clock(), observed_at=started)
    contract.claimed_unit(claim, unit_id=execution["unitId"], attempt_id=execution["attemptId"],
        input_sha256=execution["inputSha256"], association_sha256=execution["association"]["sha256"])
    contract.require(claim.get("qualificationSha256") == execution["qualificationSha256"],
        "Current permanent claim must bind actual hardware/serving qualification")
    return {**checked, "associationSha256": execution["association"]["sha256"],
        "unitId": execution["unitId"], "attemptId": execution["attemptId"],
        "qualificationSha256": execution["qualificationSha256"], "claimReadConsistent": True,
        "scientificClaimCreated": False, "scientificSourceVerification": "original caller and permanent claim"}
