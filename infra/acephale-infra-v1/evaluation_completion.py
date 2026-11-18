"""One finite completion envelope, retaining the full financial/capacity ancestry.

Funding7, GPU6 and count8 are independently append-only. Intermediate states can
be inspected but cannot reserve a lease. The count extension keeps unused parent
slots and validates the actually consumed prefix, rather than forcing waste.
"""
from __future__ import annotations

from pathlib import Path
import re

import control
import evaluation_lease_capacity as counts

FIELDS = ("leases", "overheads", "trainingWindows")
POLICY_FILE = "src/lib/acephale/contracts/evaluation-completion-envelope-v1.json"


def policy() -> dict:
    return control.read_json(control.ROOT / POLICY_FILE)


def funding_path(ledger: dict, version: int) -> Path:
    return Path(str(Path(ledger["plan"]["studyLedgerPath"]).resolve()) + f".infrastructure-funding-v{version}.json")


def path(ledger: dict, kind: str) -> Path:
    ledger_path = Path(ledger["plan"]["infrastructureLedgerPath"])
    if kind == "gpu":
        return control.gpu_hour_capacity_path(ledger_path, 6)
    if kind == "count":
        return counts.capacity_path(ledger_path, version=8)
    raise ValueError("Unknown completion authority")


def retained(ledger: dict, funding: dict) -> dict:
    return {**ledger, **{key: funding["baseline" + key[0].upper() + key[1:]] for key in FIELDS}}


def parents(ledger: dict, funding: dict) -> tuple[dict, dict, dict, int]:
    """The ordinary funding reader already checked funding7 against this prefix."""
    if funding.get("version") != 7:
        raise ValueError("Completion requires funding7")
    historical = retained(ledger, funding)
    old_funding = control._validate_infrastructure_funding_chain(historical, 6)
    parent_path = counts.capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=7)
    parent = counts.validate_funding6_followup(counts.read(parent_path), historical, old_funding,
                                              canonical_digest=control._budget_digest)
    original = counts.read(funding_path(ledger, 5))
    consumed = len(historical["leases"]) - len(original["baselineLeases"])
    if (parent["effectiveOriginalMaximumNewLeases"] != 32 or not 0 <= consumed <= 32
            or funding["parentFundingHash"] != old_funding["contentHash"]
            or funding["parentFundingSha256"] != counts.sha(funding_path(ledger, 6))):
        raise ValueError("Completion must retain the actual consumed count7 prefix")
    return historical, old_funding, parent, consumed


def projection(rows: list, field: str) -> list:
    return counts._stable_history(rows) if field in {"leases", "overheads"} else rows


def baseline(ledger: dict) -> dict:
    return {"baselineCounts": {key: len(ledger.get(key, [])) for key in FIELDS},
            "baselineHashes": {key: control._budget_digest(projection(ledger.get(key, []), key)) for key in FIELDS},
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]]}


def check_common(value: dict, ledger: dict, funding: dict, kind: str, parent: dict, parent_path: Path) -> None:
    approved = policy()
    version = 6 if kind == "gpu" else 8
    profile = f"acephale-gpu-hour-capacity-v{version}" if kind == "gpu" else f"acephale-evaluation-lease-capacity-v{version}"
    expected = {"version": version, "profile": profile, "policyHash": control._budget_digest(approved),
        "fundingHash": funding["contentHash"], "fundingSha256": counts.sha(funding_path(ledger, 7)),
        "fundingPolicyHash": funding["policyHash"], "planHash": ledger["planHash"],
        "financialBindingHash": control._financial_binding_hash(ledger),
        "parentCapacityHash": parent["contentHash"], "parentCapacitySha256": counts.sha(parent_path),
        "parentSourceCommit": parent["sourceCommit"], "evaluationOnly": True, "optimizerPermitted": False,
        "existingReservationsChanged": False, "existingDeadlinesChanged": False, "modelContractsChanged": False,
        "financialCeilingsChanged": False, "authorizationSource": "explicit_user_instruction"}
    if (any(type(value.get(key)) is not type(item) or value[key] != item for key, item in expected.items())
            or value.get("contentHash") != control._budget_digest({key: item for key, item in value.items() if key != "contentHash"})
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))
            or not isinstance(value.get("authorizationReason"), str)
            or not value["authorizationReason"].strip() or len(value["authorizationReason"]) > 1024):
        raise ValueError("Completion authority must bind exact policy, funding, parent and source")
    recorded = control.finite_number(value.get("recordedAt"), "completion timestamp")
    if recorded < max(parent["recordedAt"], control._budget_authorized_at(funding)):
        raise ValueError("Completion cannot predate its parent")
    sizes = value.get("baselineCounts")
    if (type(sizes) is not dict or set(sizes) != set(FIELDS)
            or any(type(n) is not int or n < 0 for n in sizes.values())
            or sizes["leases"] != len(funding["baselineLeases"])
            or sizes["trainingWindows"] != len(funding["baselineTrainingWindows"])):
        raise ValueError("Completion must retain the funding7 closed prefix")
    for field, count in sizes.items():
        rows = ledger.get(field, [])
        if (type(rows) is not list or len(rows) < count
                or control._budget_digest(projection(rows[:count], field)) != value.get("baselineHashes", {}).get(field)):
            raise ValueError("Completion cannot change historical holds or deadlines")
    if len(ledger.get("trainingWindows", [])) != sizes["trainingWindows"]:
        raise ValueError("Completion does not authorize optimizer windows")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != sizes["leases"]:
        raise ValueError("Completion requires original lifecycle identities")
    for old, current in zip(states, ledger["leases"], strict=False):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Completion cannot change closed or unresolved ownership")


def gpu_capacity(ledger: dict, funding: dict, *, candidate: dict | None = None) -> tuple[int, dict]:
    historical, old_funding, _, _ = parents(ledger, funding)
    parent_path = control.gpu_hour_capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), 5)
    parent = control._validate_gpu_hour_recovery(historical, control.effective_budget_policy(historical),
        control.read_gpu_hour_capacity(parent_path), current_funding=old_funding)
    target = path(ledger, "gpu")
    if candidate is None and not target.exists():
        if len(ledger["leases"]) != len(historical["leases"]):
            raise ValueError("Completion GPU authority missing for new leases")
        return 300, parent
    value = counts.read(target) if candidate is None else candidate
    check_common(value, ledger, funding, "gpu", parent, parent_path)
    if (type(value.get("engineeringMaximumGpuHours")) is not int or value["engineeringMaximumGpuHours"] != 350
            or value.get("parentEngineeringMaximumGpuHours") != 300
            or value.get("leaseCountAuthorityChanged") is not False):
        raise ValueError("Completion GPU ceiling must be exactly350 hours")
    for row in ledger["leases"][len(historical["leases"]):]:
        if (row.get("gpuHourCapacityAddendumHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != funding["contentHash"]
                or control.finite_number(row.get("reservedAt"), "GPU-bound reservation timestamp") < value["recordedAt"]):
            raise ValueError("New lease must bind GPU6 and funding7")
    hours = ledger["priorGpuHours"] + sum(row["reservedHours"] for row in ledger["leases"])
    caps = [funding["policy"][key] / 1_000_000 for key in
            ("effectiveInfrastructureMicrodollars", "effectiveComputeMicrodollars", "effectiveAssociatedMicrodollars")]
    totals = control._infrastructure_reserved_totals(ledger)
    if hours > 350 or any(totals[key] > cap for key, cap in zip(
            ("infrastructureUsd", "computeUsd", "associatedUsd"), caps, strict=True)):
        raise ValueError("Completion exceeds GPU or financial capacity")
    return 350, value


def count_limit(ledger: dict, funding: dict, *, candidate: dict | None = None) -> tuple[int, dict | None]:
    historical, _, parent, consumed = parents(ledger, funding)
    target = path(ledger, "count")
    if candidate is None and not target.exists():
        return 0, None  # Readable intermediate state; no reservation can be made.
    _, gpu = gpu_capacity(ledger, funding)
    if gpu["version"] != 6:
        raise ValueError("Count8 requires the current GPU6 authority")
    value = counts.read(target) if candidate is None else candidate
    parent_path = counts.capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=7)
    check_common(value, ledger, funding, "count", parent, parent_path)
    expected = {"parentOriginalMaximumNewLeases": 32, "effectiveOriginalMaximumNewLeases": 40,
        "consumedOriginalLeases": consumed, "inheritedUnusedLeases": 32 - consumed,
        "additionalLeases": 8, "effectiveMaximumNewLeases": 40 - consumed,
        "gpuHourCapacityHash": gpu["contentHash"], "gpuHourCapacitySha256": counts.sha(path(ledger, "gpu")),
        "gpuHoursChanged": False, "leaseCountAuthorityChanged": True}
    if (any(type(value.get(key)) is not type(item) or value[key] != item for key, item in expected.items())
            or value["recordedAt"] < gpu["recordedAt"]):
        raise ValueError("Count8 must add exactly8 and retain unused parent slots")
    suffix = ledger["leases"][len(historical["leases"]):]
    if len(suffix) > 40 - consumed:
        raise ValueError("Completion lease count exceeded")
    for row in suffix:
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or control.finite_number(row.get("reservedAt"), "count-bound reservation timestamp") < value["recordedAt"]):
            raise ValueError("New lease must bind prospective count8")
    return 40 - consumed, value


def record(ledger_path: Path, kind: str, reason: str, *, source_probe=None, budget=None) -> dict:
    """Normal creation-only writer. It never edits the ledger or prior sidecars."""
    source_probe = source_probe or control.committed_source
    budget = budget or control.study_budget
    ledger_path = ledger_path.resolve()
    with control.ledger_lock(ledger_path), control.budget_digest_scope():
        ledger = control.checked_bound_ledger(ledger_path)
        funding = control.infrastructure_funding(ledger)
        target = path(ledger, kind)
        if target.exists():
            raise ValueError("Completion authority cannot be overwritten")
        historical, _, parent_count, consumed = parents(ledger, funding)
        if ledger["leases"] != historical["leases"] or not isinstance(reason, str) or not reason.strip() or len(reason) > 1024:
            raise ValueError("Completion must be authorized before new leases")
        _, gpu = gpu_capacity(ledger, funding)
        if (kind == "gpu" and gpu["version"] != 5) or (kind == "count" and gpu["version"] != 6):
            raise ValueError("Completion authorities must be recorded funding7 then GPU6 then count8")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()
        def protected():
            return {ledger_path, Path(__file__).resolve(), Path(control.__file__).resolve(), Path(counts.__file__).resolve(), control.ROOT / POLICY_FILE,
                *(p for p in journal.parent.glob(journal.name + ".*.json") if p.is_file()),
                *(p for p in ledger_path.parent.glob(ledger_path.name + ".*.json") if p.is_file())}
        def journal_identity():
            info = journal.stat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns
        before = {p: counts.sha(p) for p in protected()}
        journal_before = journal_identity()
        parent = gpu if kind == "gpu" else parent_count
        parent_path = control.gpu_hour_capacity_path(ledger_path, 5) if kind == "gpu" else counts.capacity_path(ledger_path, version=7)
        version = 6 if kind == "gpu" else 8
        body = {"version": version, "profile": f"acephale-gpu-hour-capacity-v{version}" if kind == "gpu" else f"acephale-evaluation-lease-capacity-v{version}",
            "policyHash": control._budget_digest(policy()), "fundingHash": funding["contentHash"],
            "fundingSha256": counts.sha(funding_path(ledger, 7)), "fundingPolicyHash": funding["policyHash"],
            "planHash": ledger["planHash"], "financialBindingHash": control._financial_binding_hash(ledger),
            "parentCapacityHash": parent["contentHash"], "parentCapacitySha256": before[parent_path],
            "parentSourceCommit": parent["sourceCommit"], "originalSliceSha256": before[ledger_path],
            "recordedAt": control.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False, "financialCeilingsChanged": False,
            "originalJournalEvidence": budget(ledger["plan"], "inspect"), **baseline(ledger)}
        if kind == "gpu":
            body.update(parentEngineeringMaximumGpuHours=300, engineeringMaximumGpuHours=350, leaseCountAuthorityChanged=False)
        else:
            body.update(parentOriginalMaximumNewLeases=32, effectiveOriginalMaximumNewLeases=40,
                consumedOriginalLeases=consumed, inheritedUnusedLeases=32 - consumed,
                additionalLeases=8, effectiveMaximumNewLeases=40 - consumed,
                gpuHourCapacityHash=gpu["contentHash"], gpuHourCapacitySha256=counts.sha(path(ledger, "gpu")),
                gpuHoursChanged=False, leaseCountAuthorityChanged=True)
        value = {**body, "contentHash": control._budget_digest(body)}
        (gpu_capacity if kind == "gpu" else count_limit)(ledger, funding, candidate=value)
        if (protected() != set(before) or any(counts.sha(p) != digest for p, digest in before.items())
                or journal_identity() != journal_before):
            raise ValueError("Completion source, authority or journal changed during authorization")
        control.write_new(target, value)
        return value
