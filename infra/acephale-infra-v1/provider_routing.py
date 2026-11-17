"""Explicit regional capacity routing without replacing the financial plan."""
from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

import control

PROFILE = "acephale-provider-region-route-v1"
REGIONS = {"us-east-1", "us-east-2", "us-west-2"}
MAXIMUM_HOURLY_USD = 1.99


def checked_route(ledger: dict, value: dict) -> dict:
    plan = ledger["plan"]
    quote = value.get("quote", {})
    if (value.get("version") != 1 or value.get("profile") != PROFILE
            or value.get("contentHash") != control.digest({key: item for key, item in value.items() if key != "contentHash"})
            or value.get("planHash") != ledger["planHash"]
            or value.get("financialBindingHash") != control._financial_binding_hash(ledger)
            or value.get("financialBindingChanged") is not False
            or value.get("fromRegion") != plan["region"]
            or value.get("region") not in REGIONS or value["region"] == plan["region"]
            or value.get("maximumHourlyUsd") != MAXIMUM_HOURLY_USD
            or quote.get("region") != value["region"]
            or quote.get("hardwareProfile") != plan["hardwareProfile"]
            or quote.get("hardwareProfileHash") != control.digest(control.hardware_profile(plan["hardwareProfile"]))
            or quote.get("instanceType") != control.hardware_profile(plan["hardwareProfile"])["instanceType"]
            or quote.get("imageFamily") != "gpu-base-24-04"
            or not isinstance(quote.get("hourlyUsd"), (int, float))
            or not 0 < quote["hourlyUsd"] <= MAXIMUM_HOURLY_USD
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("publicKeySha256", ""))
            or any(not re.fullmatch(r"[A-Za-z0-9_-]+", value.get(key, ""))
                   for key in ("sshKeyName", "sshKeyId", "firewallRulesetId"))):
        raise ValueError("Regional route does not preserve the original financial and hardware identities")
    return value


def verify_quote(route: dict, quote: dict) -> None:
    if (any(quote.get(key) != route["quote"].get(key) for key in
            ("region", "instanceType", "imageId", "imageFamily", "hardwareProfile", "hardwareProfileHash", "specs"))
            or quote["hourlyUsd"] > route["quote"]["hourlyUsd"]
            or quote["hourlyUsd"] > route["maximumHourlyUsd"]):
        raise ValueError("Regional hardware, image or price changed after explicit routing")


def record_route(client, ledger_path: Path, output: Path, region: str,
                 firewall_ruleset_id: str, access_amendment: Path, reason: str,
                 *, source_probe=control.committed_source) -> dict:
    """Create a new routing sidecar; existing leases, access and journal stay intact."""
    with control.ledger_lock(ledger_path):
        ledger = control.checked_bound_ledger(ledger_path)
        if region not in REGIONS or region == ledger["plan"]["region"] or not reason.strip() or len(reason) > 1024:
            raise ValueError("A distinct declared region and explicit routing reason are required")
        access = control.checked_access_amendment(ledger, control.read_json(access_amendment))
        control.verify_access_key(client, access)
        control.validate_firewall(client, firewall_ruleset_id, region)
        quote = control.quote(client, region, hardware=ledger["plan"]["hardwareProfile"])
        body = {"version": 1, "profile": PROFILE, "planHash": ledger["planHash"],
                "financialBindingHash": control._financial_binding_hash(ledger), "financialBindingChanged": False,
                "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]), "recordedAt": time.time(),
                "reason": reason.strip(), "fromRegion": ledger["plan"]["region"], "region": region,
                "quote": quote, "maximumHourlyUsd": MAXIMUM_HOURLY_USD,
                "originalAccessAmendmentHash": access["contentHash"],
                "originalAccessAmendmentSha256": hashlib.sha256(access_amendment.read_bytes()).hexdigest(),
                **{key: access[key] for key in ("sshKeyName", "sshKeyId", "publicKeySha256")},
                "firewallRulesetId": firewall_ruleset_id}
        value = checked_route(ledger, {**body, "contentHash": control.digest(body)})
        control.write_new(output, value)
        return value
