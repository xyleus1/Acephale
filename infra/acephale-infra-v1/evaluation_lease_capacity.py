"""One additional evaluation lease without changing any monetary authority."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import rfc8785

PROFILE = "acephale-evaluation-lease-capacity-v1"
BASE_LIMIT = 4
EFFECTIVE_LIMIT = 5


def capacity_path(ledger_path: Path) -> Path:
    return Path(str(ledger_path.resolve()) + ".evaluation-lease-capacity-v1.json")


def digest(value: dict) -> str:
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path: Path) -> dict:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Invalid evaluation lease-count capacity file")
    return json.loads(path.read_text(encoding="utf-8"))


def funding_path(ledger: dict) -> Path:
    return Path(str(Path(ledger["plan"]["studyLedgerPath"]).resolve()) + ".infrastructure-funding-v3.json")


def validate(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """The caller has already checked the unchanged v3 financial parent chain."""
    body = {key: item for key, item in value.items() if key != "contentHash"}
    if (funding.get("version") != 3 or funding["policy"].get("maximumNewLeases") != BASE_LIMIT
            or type(value.get("version")) is not int or value["version"] != 1
            or value.get("profile") != PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("fundingHash") != funding["contentHash"]
            or value.get("fundingSha256") != sha(funding_path(ledger))
            or value.get("fundingPolicyHash") != funding["policyHash"]
            or value.get("planHash") != ledger["planHash"]
            or value.get("infrastructureBindingHash") != funding["infrastructureBindingHash"]
            or value.get("infrastructureLedgerPathHash") != funding["infrastructureLedgerPathHash"]
            or value.get("studyLedgerPathHash") != funding["studyLedgerPathHash"]
            or type(value.get("baseMaximumNewLeases")) is not int or value["baseMaximumNewLeases"] != BASE_LIMIT
            or type(value.get("effectiveMaximumNewLeases")) is not int or value["effectiveMaximumNewLeases"] != EFFECTIVE_LIMIT
            or type(value.get("additionalLeases")) is not int or value["additionalLeases"] != 1
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str)
            or not value["authorizationReason"].strip() or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Lease-count capacity must bind exactly one slot and unchanged financial authority")
    authorized = datetime.fromisoformat(funding["authorizedAt"].replace("Z", "+00:00"))
    if authorized.tzinfo is None:
        authorized = authorized.replace(tzinfo=timezone.utc)
    recorded = value.get("recordedAt")
    if type(recorded) not in (float, int) or not math.isfinite(recorded) or recorded < authorized.timestamp():
        raise ValueError("Lease-count capacity cannot predate the financial parent")
    for field in ("leases", "overheads", "trainingWindows"):
        baseline = value.get("baseline" + field[0].upper() + field[1:])
        if not isinstance(baseline, list) or len(ledger.get(field, [])) < len(baseline):
            raise ValueError("Lease-count capacity requires retained operational history")
        if field != "leases" and ledger.get(field, [])[:len(baseline)] != baseline:
            raise ValueError("Lease-count capacity cannot change overhead or training history")
    baseline = value["baselineLeases"]
    if len(baseline) != len(funding["baselineLeases"]) + BASE_LIMIT:
        raise ValueError("Lease-count capacity starts only after the original four slots")
    for old, current in zip(baseline, ledger["leases"], strict=False):
        if (old.get("status") not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old.get("instanceId") is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old.get("instanceId")))
                or any(old.get(key) != current.get(key) for key in ("id", "name", "reservedAt", "deadline",
                    "setupDeadline", "quote", "studyReservation", "reservedUsd", "reservedComputeUsd",
                    "reservedHours", "reservedMicrodollars", "infrastructureFundingSupplementHash"))):
            raise ValueError("Lease-count capacity must retain closed work, old holds and deadlines")
    suffix = ledger["leases"][len(baseline):]
    if len(suffix) > 1:
        raise ValueError("Evaluation lease-count capacity permits only one additional lease")
    for lease in suffix:
        at = lease.get("reservedAt")
        if (lease.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or lease.get("infrastructureFundingSupplementHash") != funding["contentHash"]
                or type(at) not in (float, int) or not math.isfinite(at) or at < recorded):
            raise ValueError("New evaluation lease must bind its count authority prospectively")
    return value


def effective_limit(ledger: dict, funding: dict, *, canonical_digest=digest) -> tuple[int, dict | None]:
    original = funding["policy"]["maximumNewLeases"]
    if funding["version"] != 3:
        return original, None
    path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]))
    if not path.exists():
        if any("evaluationLeaseCapacityHash" in row for row in ledger["leases"]):
            raise ValueError("Evaluation lease-count authority is missing")
        return original, None
    value = validate(read(path), ledger, funding, canonical_digest=canonical_digest)
    return EFFECTIVE_LIMIT, value


def record_capacity(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Create only the count sidecar after a clean committed-source check."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path):
        output = capacity_path(ledger_path)
        if output.exists():
            raise ValueError("Evaluation lease-count capacity cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        if funding is None or funding["version"] != 3:
            raise ValueError("Exact existing v3 financial authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()
        def protected_files():
            existing = {ledger_path, journal, funding_path(ledger)}
            existing.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            existing.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return existing
        before = {path: sha(path) for path in protected_files()}
        body = {"version": 1, "profile": PROFILE, "fundingHash": funding["contentHash"],
            "fundingSha256": before[funding_path(ledger)], "fundingPolicyHash": funding["policyHash"],
            "planHash": ledger["planHash"], "infrastructureBindingHash": funding["infrastructureBindingHash"],
            "infrastructureLedgerPathHash": funding["infrastructureLedgerPathHash"],
            "studyLedgerPathHash": funding["studyLedgerPathHash"], "originalSliceSha256": before[ledger_path],
            "baseMaximumNewLeases": BASE_LIMIT, "effectiveMaximumNewLeases": EFFECTIVE_LIMIT, "additionalLeases": 1,
            "baselineLeases": ledger["leases"], "baselineOverheads": ledger.get("overheads", []),
            "baselineTrainingWindows": ledger.get("trainingWindows", []),
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                         canonical_digest=controller._budget_digest)
        if protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items()):
            raise ValueError("Existing financial authority or journal changed during count authorization")
        controller.write_new(output, value)
        return value
