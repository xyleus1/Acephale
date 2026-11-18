"""Append-only evaluation lease counts under unchanged monetary authority."""
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
EXTENSION_PROFILE = "acephale-evaluation-lease-capacity-v2"
EXTENDED_LIMIT = 6


def capacity_path(ledger_path: Path, *, version: int = 1) -> Path:
    if type(version) is not int or version not in (1, 2, 3, 4, 5, 6, 7):
        raise ValueError("Unknown evaluation lease-count capacity version")
    return Path(str(ledger_path.resolve()) + f".evaluation-lease-capacity-v{version}.json")


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
    if funding["version"] == 6:
        # Funding6 adds money only. Count from the unchanged funding5 baseline,
        # deducting slots already consumed before the successor was recorded.
        path = Path(str(Path(ledger["plan"]["studyLedgerPath"]).resolve()) + ".infrastructure-funding-v5.json")
        parent = read(path)
        consumed = len(funding["baselineLeases"]) - len(parent["baselineLeases"])
        if (type(parent.get("version")) is not int or parent["version"] != 5
                or funding["policy"].get("leaseCountParentFundingVersion") != 5
                or original != 16 or parent["policy"].get("maximumNewLeases") != original
                or funding.get("parentFundingHash") != parent.get("contentHash")
                or funding.get("parentFundingSha256") != sha(path)
                or parent.get("contentHash") != canonical_digest({k: v for k, v in parent.items() if k != "contentHash"})
                or not 0 <= consumed <= original):
            raise ValueError("Money-only funding must retain the original evaluation lease-count horizon")
        followup = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=7)
        if followup.exists():
            value = validate_funding6_followup(read(followup), ledger, funding, canonical_digest=canonical_digest)
            return original - consumed + 4 * RECOVERY_SLOTS, value
        successor = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=6)
        if successor.exists():
            value = validate_funding6_successor(read(successor), ledger, funding, canonical_digest=canonical_digest)
            return original - consumed + 3 * RECOVERY_SLOTS, value
        extension = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=5)
        if extension.exists():
            value = validate_funding6_extension(read(extension), ledger, funding, canonical_digest=canonical_digest)
            return original - consumed + 2 * RECOVERY_SLOTS, value
        path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=4)
        if path.exists():
            value = validate_funding6_capacity(read(path), ledger, funding, canonical_digest=canonical_digest)
            return original - consumed + RECOVERY_SLOTS, value
        if any("evaluationLeaseCapacityHash" in row for row in ledger["leases"][len(funding["baselineLeases"]):]):
            raise ValueError("Current funding6 evaluation count authority is missing")
        return original - consumed, None
    if funding["version"] == 4:
        path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=3)
        if path.exists():
            value = validate_funding4_capacity(read(path), ledger, funding, canonical_digest=canonical_digest)
            return COMPLETION_LIMIT, value
        if any("evaluationLeaseCapacityHash" in row for row in ledger["leases"][len(funding["baselineLeases"]):]):
            raise ValueError("Current funding4 evaluation count authority is missing")
        return original, None
    if funding["version"] != 3:
        return original, None
    path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]))
    extension = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=2)
    if extension.exists():
        return EXTENDED_LIMIT, validate_extension(read(extension), ledger, funding,
                                                  canonical_digest=canonical_digest)
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


def validate_extension(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Keep v1's exact fifth slot, then admit one separately bound sixth slot."""
    parent_path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]))
    parent = read(parent_path)
    body = {key: item for key, item in value.items() if key != "contentHash"}
    if (funding.get("version") != 3 or funding["policy"].get("maximumNewLeases") != BASE_LIMIT
            or type(value.get("version")) is not int or value["version"] != 2
            or value.get("profile") != EXTENSION_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("parentCapacityHash") != parent.get("contentHash")
            or value.get("parentCapacitySha256") != sha(parent_path)
            or value.get("parentSourceCommit") != parent.get("sourceCommit")
            or any(value.get(key) != parent.get(key) for key in
                ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash", "infrastructureBindingHash",
                 "infrastructureLedgerPathHash", "studyLedgerPathHash"))
            or type(value.get("baseMaximumNewLeases")) is not int or value["baseMaximumNewLeases"] != EFFECTIVE_LIMIT
            or type(value.get("effectiveMaximumNewLeases")) is not int or value["effectiveMaximumNewLeases"] != EXTENDED_LIMIT
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
        raise ValueError("Count extension requires the exact v1 parent and one unchanged-finance slot")
    recorded = value.get("recordedAt")
    if (type(recorded) not in (int, float) or not math.isfinite(recorded)
            or recorded < parent["recordedAt"]):
        raise ValueError("Count extension cannot predate its parent")
    historical = dict(ledger)
    for field in ("leases", "overheads", "trainingWindows"):
        baseline = value.get("baseline" + field[0].upper() + field[1:])
        if not isinstance(baseline, list) or len(ledger.get(field, [])) < len(baseline):
            raise ValueError("Count extension requires retained operational history")
        if field != "leases" and ledger.get(field, [])[:len(baseline)] != baseline:
            raise ValueError("Count extension cannot rewrite overhead or training history")
        historical[field] = baseline
    baseline = historical["leases"]
    if len(baseline) != len(funding["baselineLeases"]) + EFFECTIVE_LIMIT:
        raise ValueError("Count extension requires all five previous slots")
    # Only the pure parent validator receives this authenticated snapshot. Full
    # funding/GPU validation always receives the actual current ledger.
    validate(parent, historical, funding, canonical_digest=canonical_digest)
    if baseline[-1].get("status") != "terminated":
        raise ValueError("The original fifth lease must be terminated before count extension")
    if ledger.get("trainingWindows", []) != historical["trainingWindows"]:
        raise ValueError("Evaluation count extension does not authorize new training windows")
    for old, current in zip(baseline, ledger["leases"], strict=False):
        if ((old.get("status") == "terminated" and
                (current.get("status") != "terminated" or current.get("instanceId") != old.get("instanceId")))
                or any(old.get(key) != current.get(key) for key in
                    ("id", "name", "reservedAt", "deadline", "setupDeadline", "quote", "studyReservation",
                     "reservedUsd", "reservedComputeUsd", "reservedHours", "reservedMicrodollars",
                     "infrastructureFundingSupplementHash", "evaluationLeaseCapacityHash",
                     "gpuHourCapacityAddendumHash", "routingAmendment", "purpose"))):
            raise ValueError("Count extension must retain old holds, tags, ownership and deadlines")
    suffix = ledger["leases"][len(baseline):]
    if len(suffix) > 1:
        raise ValueError("Count extension permits only one sixth lease")
    for lease in suffix:
        at = lease.get("reservedAt")
        if (lease.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or lease.get("infrastructureFundingSupplementHash") != funding["contentHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("Sixth lease must bind the count extension prospectively")
    return value


def record_extension(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Append v2 only; preserve every original authority and monetary reservation."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path):
        output = capacity_path(ledger_path, version=2)
        if output.exists():
            raise ValueError("Evaluation count extension cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        if funding is None or funding["version"] != 3:
            raise ValueError("Exact existing v3 financial authority required")
        parent_path = capacity_path(ledger_path)
        parent = validate(read(parent_path), ledger, funding, canonical_digest=controller._budget_digest)
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()

        def protected_files():
            existing = {ledger_path, journal, funding_path(ledger), parent_path}
            existing.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            existing.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return existing

        before = {path: sha(path) for path in protected_files()}
        body = {key: parent[key] for key in
                ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash", "infrastructureBindingHash",
                 "infrastructureLedgerPathHash", "studyLedgerPathHash")}
        body.update(version=2, profile=EXTENSION_PROFILE, parentCapacityHash=parent["contentHash"],
            parentCapacitySha256=before[parent_path], parentSourceCommit=parent["sourceCommit"],
            originalSliceSha256=before[ledger_path], baseMaximumNewLeases=EFFECTIVE_LIMIT,
            effectiveMaximumNewLeases=EXTENDED_LIMIT, additionalLeases=1,
            baselineLeases=ledger["leases"], baselineOverheads=ledger.get("overheads", []),
            baselineTrainingWindows=ledger.get("trainingWindows", []), recordedAt=controller.time.time(),
            sourceCommit=source_probe(ledger["plan"]["sourceCommit"]), authorizationSource="explicit_user_instruction",
            authorizationReason=reason.strip(), evaluationOnly=True, optimizerPermitted=False,
            leaseCountAuthorityChanged=True, financialCeilingsChanged=False, gpuHoursChanged=False,
            existingReservationsChanged=False, existingDeadlinesChanged=False, modelContractsChanged=False)
        value = validate_extension({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                   canonical_digest=controller._budget_digest)
        if protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items()):
            raise ValueError("Existing financial authority or journal changed during count extension")
        controller.write_new(output, value)
        return value


COMPLETION_PROFILE = "acephale-evaluation-lease-capacity-v3"
COMPLETION_LIMIT = 16
_HISTORY_KEYS = ("id", "name", "reservedAt", "deadline", "setupDeadline", "quote", "studyReservation",
                 "reservedUsd", "reservedComputeUsd", "reservedHours", "reservedMicrodollars",
                 "infrastructureFundingSupplementHash", "evaluationLeaseCapacityHash", "gpuHourCapacityAddendumHash")


def _stable_history(rows: list[dict]) -> list[dict]:
    return [{key: row[key] for key in _HISTORY_KEYS if key in row} for row in rows]


def _funding4_path(ledger: dict) -> Path:
    return Path(str(Path(ledger["plan"]["studyLedgerPath"]).resolve()) + ".infrastructure-funding-v4.json")


def validate_funding4_capacity(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Authenticate compact retained-prefix hashes; monetary/GPU validation remains external."""
    body = {key: item for key, item in value.items() if key != "contentHash"}
    if (funding.get("version") != 4 or funding["policy"].get("maximumNewLeases") != 1
            or type(value.get("version")) is not int or value["version"] != 3
            or value.get("profile") != COMPLETION_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("fundingHash") != funding["contentHash"]
            or value.get("fundingSha256") != sha(_funding4_path(ledger))
            or value.get("fundingPolicyHash") != funding["policyHash"]
            or value.get("planHash") != ledger["planHash"]
            or any(value.get(key) != funding.get(key) for key in
                   ("infrastructureBindingHash", "infrastructureLedgerPathHash", "studyLedgerPathHash"))
            or type(value.get("baseMaximumNewLeases")) is not int or value["baseMaximumNewLeases"] != 1
            or type(value.get("effectiveMaximumNewLeases")) is not int or value["effectiveMaximumNewLeases"] != COMPLETION_LIMIT
            or type(value.get("additionalLeases")) is not int or value["additionalLeases"] != COMPLETION_LIMIT - 1
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                   "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str) or not value["authorizationReason"].strip()
            or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Funding4 count supplement must preserve every financial and scientific authority")
    authorized = datetime.fromisoformat(funding["authorizedAt"].replace("Z", "+00:00"))
    if authorized.tzinfo is None:
        authorized = authorized.replace(tzinfo=timezone.utc)
    recorded = value.get("recordedAt")
    if type(recorded) not in (int, float) or not math.isfinite(recorded) or recorded < authorized.timestamp():
        raise ValueError("Count supplement must be prospective to its funding parent")
    counts = value.get("baselineCounts")
    if (not isinstance(counts, dict) or set(counts) != {"leases", "overheads", "trainingWindows"}
            or any(type(counts[key]) is not int or counts[key] < 0 for key in counts)
            or counts["leases"] != len(funding["baselineLeases"]) + 1):
        raise ValueError("Count supplement must retain the exact exhausted funding4 prefix")
    expected_hashes = value.get("baselineHashes", {})
    for key in counts:
        rows = ledger.get(key, [])
        if type(rows) is not list or len(rows) < counts[key]:
            raise ValueError("Retained operational prefix was truncated")
        prefix = rows[:counts[key]]
        projection = _stable_history(prefix) if key in {"leases", "overheads"} else prefix
        if canonical_digest(projection) != expected_hashes.get(key):
            raise ValueError("Retained holds, identities or deadlines changed")
    if len(ledger.get("trainingWindows", [])) != counts["trainingWindows"]:
        raise ValueError("Evaluation count authority never permits training")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != counts["leases"]:
        raise ValueError("Exact historical lifecycle identity summary required")
    for old, current in zip(states, ledger["leases"][:counts["leases"]], strict=True):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Count authority requires closed work and retained uncertain launch ownership")
    suffix = ledger["leases"][counts["leases"]:]
    if len(suffix) > COMPLETION_LIMIT - 1:
        raise ValueError("Finite evaluation dispatch count exceeded")
    for row in suffix:
        at = row.get("reservedAt")
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != funding["contentHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("New evaluation dispatch must bind the current count authority")
    return value


def record_funding4_capacity(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Create one compact count authority, retaining all original money and hours."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path):
        output = capacity_path(ledger_path, version=3)
        if output.exists():
            raise ValueError("Funding4 count authority cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        if funding is None or funding["version"] != 4:
            raise ValueError("Exact existing funding4 authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()
        def protected_files():
            result = {ledger_path, journal}
            result.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            result.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return result
        before = {path: sha(path) for path in protected_files()}
        counts = {key: len(ledger.get(key, [])) for key in ("leases", "overheads", "trainingWindows")}
        hashes = {key: controller._budget_digest(_stable_history(ledger.get(key, []))
                   if key in {"leases", "overheads"} else ledger.get(key, [])) for key in counts}
        body = {"version": 3, "profile": COMPLETION_PROFILE,
            "fundingHash": funding["contentHash"], "fundingSha256": before[_funding4_path(ledger)],
            "fundingPolicyHash": funding["policyHash"], "planHash": ledger["planHash"],
            **{key: funding[key] for key in ("infrastructureBindingHash", "infrastructureLedgerPathHash", "studyLedgerPathHash")},
            "originalSliceSha256": before[ledger_path], "baseMaximumNewLeases": 1,
            "effectiveMaximumNewLeases": COMPLETION_LIMIT, "additionalLeases": COMPLETION_LIMIT - 1,
            "baselineCounts": counts, "baselineHashes": hashes,
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]],
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate_funding4_capacity({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                          canonical_digest=controller._budget_digest)
        if protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items()):
            raise ValueError("Original financial files changed during count authorization")
        controller.write_new(output, value)
        return value


RECOVERY_PROFILE = "acephale-evaluation-lease-capacity-v4"
RECOVERY_SLOTS = 4


def _authority_path(ledger: dict, version: int) -> Path:
    return Path(str(Path(ledger["plan"]["studyLedgerPath"]).resolve()) + f".infrastructure-funding-v{version}.json")


def validate_funding6_capacity(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Add four slots after the exhausted funding5 horizon; never replace it."""
    parent_path = _authority_path(ledger, 5)
    parent = read(parent_path)
    gpu_path = Path(str(Path(ledger["plan"]["infrastructureLedgerPath"]).resolve()) + ".gpu-hour-capacity-v5.json")
    gpu = read(gpu_path)
    gpu_digest = hashlib.sha256(json.dumps({k: v for k, v in gpu.items() if k != "contentHash"},
        sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    consumed = len(funding["baselineLeases"]) - len(parent["baselineLeases"])
    body = {key: item for key, item in value.items() if key != "contentHash"}
    if (funding.get("version") != 6 or parent.get("version") != 5
            or funding["policy"].get("leaseCountParentFundingVersion") != 5
            or funding["policy"].get("maximumNewLeases") != 16 or parent["policy"].get("maximumNewLeases") != 16
            or funding.get("parentFundingHash") != parent.get("contentHash")
            or funding.get("parentFundingSha256") != sha(parent_path)
            or parent.get("contentHash") != canonical_digest({k: v for k, v in parent.items() if k != "contentHash"})
            or not 0 <= consumed <= 16
            or type(value.get("version")) is not int or value["version"] != 4
            or value.get("profile") != RECOVERY_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("fundingHash") != funding["contentHash"]
            or value.get("fundingSha256") != sha(_authority_path(ledger, 6))
            or value.get("fundingPolicyHash") != funding["policyHash"]
            or value.get("originalCountFundingHash") != parent["contentHash"]
            or value.get("originalCountFundingSha256") != sha(parent_path)
            or gpu.get("version") != 5 or gpu.get("profile") != "acephale-gpu-hour-capacity-v5"
            or gpu.get("contentHash") != gpu_digest
            or gpu.get("engineeringMaximumGpuHours") != 300 or gpu.get("fundingHash") != funding["contentHash"]
            or value.get("gpuHourCapacityHash") != gpu["contentHash"] or value.get("gpuHourCapacitySha256") != sha(gpu_path)
            or value.get("planHash") != ledger["planHash"]
            or any(value.get(key) != funding.get(key) for key in
                   ("infrastructureBindingHash", "infrastructureLedgerPathHash", "studyLedgerPathHash"))
            or any(type(value.get(key)) is not int or value[key] != expected for key, expected in (
                ("originalMaximumNewLeases", 16), ("effectiveOriginalMaximumNewLeases", 20),
                ("consumedBeforeFunding6", consumed), ("baseMaximumNewLeases", 16 - consumed),
                ("effectiveMaximumNewLeases", 20 - consumed), ("additionalLeases", RECOVERY_SLOTS)))
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                   "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str) or not value["authorizationReason"].strip()
            or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Funding6 count recovery requires exactly four slots and unchanged money, GPU and original count authority")
    authorized = datetime.fromisoformat(funding["authorizedAt"].replace("Z", "+00:00"))
    if authorized.tzinfo is None:
        authorized = authorized.replace(tzinfo=timezone.utc)
    recorded = value.get("recordedAt")
    if (type(recorded) not in (int, float) or not math.isfinite(recorded)
            or recorded < max(authorized.timestamp(), gpu["recordedAt"])):
        raise ValueError("Count recovery must follow its actual financial and GPU authorities")
    counts = value.get("baselineCounts")
    if (not isinstance(counts, dict) or set(counts) != {"leases", "overheads", "trainingWindows"}
            or any(type(counts[key]) is not int or counts[key] < 0 for key in counts)
            or counts["leases"] != len(parent["baselineLeases"]) + 16):
        raise ValueError("Count recovery requires the exhausted original funding5 horizon")
    for field, count in counts.items():
        rows = ledger.get(field, [])
        if type(rows) is not list or len(rows) < count:
            raise ValueError("Count recovery cannot truncate retained operational history")
        projection = _stable_history(rows[:count]) if field in {"leases", "overheads"} else rows[:count]
        if canonical_digest(projection) != value.get("baselineHashes", {}).get(field):
            raise ValueError("Count recovery cannot change retained holds, identities or deadlines")
    if len(ledger.get("trainingWindows", [])) != counts["trainingWindows"]:
        raise ValueError("Count recovery never permits optimizer windows")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != counts["leases"]:
        raise ValueError("Count recovery requires every original lifecycle identity")
    for old, current in zip(states, ledger["leases"][:counts["leases"]], strict=True):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Count recovery requires closed work and retained unresolved ownership")
    suffix = ledger["leases"][counts["leases"]:]
    if len(suffix) > RECOVERY_SLOTS:
        raise ValueError("Only four additional evaluation leases are authorized")
    for row in suffix:
        at = row.get("reservedAt")
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != funding["contentHash"]
                or row.get("gpuHourCapacityAddendumHash") != gpu["contentHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("New evaluation lease must bind its exact prospective count, funding and GPU authority")
    return value


def record_funding6_capacity(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Append four count slots; never write any existing authority or reservation."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path), controller.budget_digest_scope():
        output = capacity_path(ledger_path, version=4)
        if output.exists():
            raise ValueError("Funding6 count authority cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        maximum, gpu = controller.effective_gpu_hour_capacity(ledger)
        if funding is None or funding["version"] != 6 or gpu is None or gpu["version"] != 5 or maximum != 300:
            raise ValueError("Exact existing funding6 and GPU5 authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()

        def protected_files():
            result = {ledger_path, Path(__file__).resolve(), Path(controller.__file__).resolve()}
            result.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            result.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return result

        def journal_identity():
            info = journal.stat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

        before = {path: sha(path) for path in protected_files()}
        journal_before = journal_identity()
        parent_path = _authority_path(ledger, 5)
        parent = read(parent_path)
        consumed = len(funding["baselineLeases"]) - len(parent["baselineLeases"])
        counts = {key: len(ledger.get(key, [])) for key in ("leases", "overheads", "trainingWindows")}
        hashes = {key: controller._budget_digest(_stable_history(ledger.get(key, []))
                   if key in {"leases", "overheads"} else ledger.get(key, [])) for key in counts}
        body = {"version": 4, "profile": RECOVERY_PROFILE,
            "fundingHash": funding["contentHash"], "fundingSha256": before[_authority_path(ledger, 6)],
            "fundingPolicyHash": funding["policyHash"], "planHash": ledger["planHash"],
            "originalCountFundingHash": parent["contentHash"], "originalCountFundingSha256": before[parent_path],
            "gpuHourCapacityHash": gpu["contentHash"],
            "gpuHourCapacitySha256": before[controller.gpu_hour_capacity_path(ledger_path, 5)],
            **{key: funding[key] for key in ("infrastructureBindingHash", "infrastructureLedgerPathHash", "studyLedgerPathHash")},
            "originalSliceSha256": before[ledger_path], "originalMaximumNewLeases": 16,
            "effectiveOriginalMaximumNewLeases": 20, "consumedBeforeFunding6": consumed,
            "baseMaximumNewLeases": 16 - consumed, "effectiveMaximumNewLeases": 20 - consumed,
            "additionalLeases": RECOVERY_SLOTS, "baselineCounts": counts, "baselineHashes": hashes,
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]],
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate_funding6_capacity({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                          canonical_digest=controller._budget_digest)
        if (protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items())
                or journal_identity() != journal_before):
            raise ValueError("Original authorities, sources or journal stat changed during count authorization")
        controller.write_new(output, value)
        return value


CONTINUATION_PROFILE = "acephale-evaluation-lease-capacity-v5"


def validate_funding6_extension(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Validate v4's exhausted prefix before admitting four separately bound leases."""
    parent_path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=4)
    parent = read(parent_path)
    prefix_count = parent["baselineCounts"]["leases"] + RECOVERY_SLOTS
    historical = {**ledger, "leases": ledger["leases"][:prefix_count]}
    validate_funding6_capacity(parent, historical, funding, canonical_digest=canonical_digest)
    body = {key: item for key, item in value.items() if key != "contentHash"}
    inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                 "originalCountFundingHash", "originalCountFundingSha256",
                 "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                 "infrastructureLedgerPathHash", "studyLedgerPathHash")
    if (type(value.get("version")) is not int or value["version"] != 5
            or value.get("profile") != CONTINUATION_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("parentCapacityHash") != parent["contentHash"]
            or value.get("parentCapacitySha256") != sha(parent_path)
            or value.get("parentSourceCommit") != parent["sourceCommit"]
            or any(value.get(key) != parent[key] for key in inherited)
            or any(type(value.get(key)) is not int or value[key] != expected for key, expected in (
                ("originalMaximumNewLeases", 16), ("effectiveOriginalMaximumNewLeases", 24),
                ("consumedBeforeFunding6", parent["consumedBeforeFunding6"]),
                ("baseMaximumNewLeases", parent["effectiveMaximumNewLeases"]),
                ("effectiveMaximumNewLeases", parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS),
                ("additionalLeases", RECOVERY_SLOTS)))
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                   "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str) or not value["authorizationReason"].strip()
            or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Count continuation requires the exact v4 parent and four unchanged-finance slots")
    recorded = value.get("recordedAt")
    if (type(recorded) not in (int, float) or not math.isfinite(recorded) or recorded < parent["recordedAt"]):
        raise ValueError("Count continuation cannot predate its parent")
    counts = value.get("baselineCounts")
    if (type(counts) is not dict or set(counts) != {"leases", "overheads", "trainingWindows"}
            or any(type(counts[key]) is not int or counts[key] < 0 for key in counts)
            or counts["leases"] != prefix_count):
        raise ValueError("Count continuation requires the exhausted v4 horizon")
    for field, count in counts.items():
        rows = ledger.get(field, [])
        if type(rows) is not list or len(rows) < count:
            raise ValueError("Count continuation cannot truncate retained history")
        projection = _stable_history(rows[:count]) if field in {"leases", "overheads"} else rows[:count]
        if canonical_digest(projection) != value.get("baselineHashes", {}).get(field):
            raise ValueError("Count continuation cannot change retained holds, identities or deadlines")
    if len(ledger.get("trainingWindows", [])) != counts["trainingWindows"]:
        raise ValueError("Count continuation never permits optimizer windows")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != prefix_count:
        raise ValueError("Count continuation requires every prior lifecycle identity")
    for old, current in zip(states, ledger["leases"][:prefix_count], strict=True):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Count continuation requires closed work and retained unresolved ownership")
    suffix = ledger["leases"][prefix_count:]
    if len(suffix) > RECOVERY_SLOTS:
        raise ValueError("Count continuation permits only four additional evaluation leases")
    for row in suffix:
        at = row.get("reservedAt")
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != value["fundingHash"]
                or row.get("gpuHourCapacityAddendumHash") != value["gpuHourCapacityHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("New lease must bind the exact prospective continuation authority")
    return value


def record_funding6_extension(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Create v5 after v4 is exhausted, retaining every old reservation and authority."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path), controller.budget_digest_scope():
        output = capacity_path(ledger_path, version=5)
        if output.exists():
            raise ValueError("Count continuation cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        maximum, gpu = controller.effective_gpu_hour_capacity(ledger)
        if funding is None or funding["version"] != 6 or gpu is None or gpu["version"] != 5 or maximum != 300:
            raise ValueError("Exact existing funding6 and GPU5 authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()

        def protected_files():
            result = {ledger_path, Path(__file__).resolve(), Path(controller.__file__).resolve()}
            result.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            result.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return result

        def journal_identity():
            info = journal.stat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

        before = {path: sha(path) for path in protected_files()}
        journal_before = journal_identity()
        parent_path = capacity_path(ledger_path, version=4)
        parent = validate_funding6_capacity(read(parent_path), ledger, funding,
                                           canonical_digest=controller._budget_digest)
        counts = {key: len(ledger.get(key, [])) for key in ("leases", "overheads", "trainingWindows")}
        hashes = {key: controller._budget_digest(_stable_history(ledger.get(key, []))
                   if key in {"leases", "overheads"} else ledger.get(key, [])) for key in counts}
        inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                     "originalCountFundingHash", "originalCountFundingSha256",
                     "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                     "infrastructureLedgerPathHash", "studyLedgerPathHash")
        body = {"version": 5, "profile": CONTINUATION_PROFILE,
            **{key: parent[key] for key in inherited},
            "parentCapacityHash": parent["contentHash"], "parentCapacitySha256": before[parent_path],
            "parentSourceCommit": parent["sourceCommit"], "originalSliceSha256": before[ledger_path],
            "originalMaximumNewLeases": 16, "effectiveOriginalMaximumNewLeases": 24,
            "consumedBeforeFunding6": parent["consumedBeforeFunding6"],
            "baseMaximumNewLeases": parent["effectiveMaximumNewLeases"],
            "effectiveMaximumNewLeases": parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS,
            "additionalLeases": RECOVERY_SLOTS, "baselineCounts": counts, "baselineHashes": hashes,
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]],
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate_funding6_extension({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                           canonical_digest=controller._budget_digest)
        if (protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items())
                or journal_identity() != journal_before):
            raise ValueError("Original authorities, sources or journal stat changed during count continuation")
        controller.write_new(output, value)
        return value


SUCCESSOR_PROFILE = "acephale-evaluation-lease-capacity-v6"


def validate_funding6_successor(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Validate v5's exhausted prefix before admitting four separately bound leases."""
    parent_path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=5)
    parent = read(parent_path)
    prefix_count = parent["baselineCounts"]["leases"] + RECOVERY_SLOTS
    historical = {**ledger, "leases": ledger["leases"][:prefix_count]}
    validate_funding6_extension(parent, historical, funding, canonical_digest=canonical_digest)
    body = {key: item for key, item in value.items() if key != "contentHash"}
    inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                 "originalCountFundingHash", "originalCountFundingSha256",
                 "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                 "infrastructureLedgerPathHash", "studyLedgerPathHash")
    if (type(value.get("version")) is not int or value["version"] != 6
            or value.get("profile") != SUCCESSOR_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("parentCapacityHash") != parent["contentHash"]
            or value.get("parentCapacitySha256") != sha(parent_path)
            or value.get("parentSourceCommit") != parent["sourceCommit"]
            or any(value.get(key) != parent[key] for key in inherited)
            or any(type(value.get(key)) is not int or value[key] != expected for key, expected in (
                ("originalMaximumNewLeases", 16), ("effectiveOriginalMaximumNewLeases", 28),
                ("consumedBeforeFunding6", parent["consumedBeforeFunding6"]),
                ("baseMaximumNewLeases", parent["effectiveMaximumNewLeases"]),
                ("effectiveMaximumNewLeases", parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS),
                ("additionalLeases", RECOVERY_SLOTS)))
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                   "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str) or not value["authorizationReason"].strip()
            or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Count continuation requires the exact v5 parent and four unchanged-finance slots")
    recorded = value.get("recordedAt")
    if (type(recorded) not in (int, float) or not math.isfinite(recorded) or recorded < parent["recordedAt"]):
        raise ValueError("Count continuation cannot predate its parent")
    counts = value.get("baselineCounts")
    if (type(counts) is not dict or set(counts) != {"leases", "overheads", "trainingWindows"}
            or any(type(counts[key]) is not int or counts[key] < 0 for key in counts)
            or counts["leases"] != prefix_count):
        raise ValueError("Count continuation requires the exhausted v5 horizon")
    for field, count in counts.items():
        rows = ledger.get(field, [])
        if type(rows) is not list or len(rows) < count:
            raise ValueError("Count continuation cannot truncate retained history")
        projection = _stable_history(rows[:count]) if field in {"leases", "overheads"} else rows[:count]
        if canonical_digest(projection) != value.get("baselineHashes", {}).get(field):
            raise ValueError("Count continuation cannot change retained holds, identities or deadlines")
    if len(ledger.get("trainingWindows", [])) != counts["trainingWindows"]:
        raise ValueError("Count continuation never permits optimizer windows")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != prefix_count:
        raise ValueError("Count continuation requires every prior lifecycle identity")
    for old, current in zip(states, ledger["leases"][:prefix_count], strict=True):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Count continuation requires closed work and retained unresolved ownership")
    suffix = ledger["leases"][prefix_count:]
    if len(suffix) > RECOVERY_SLOTS:
        raise ValueError("Count continuation permits only four additional evaluation leases")
    for row in suffix:
        at = row.get("reservedAt")
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != value["fundingHash"]
                or row.get("gpuHourCapacityAddendumHash") != value["gpuHourCapacityHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("New lease must bind the exact prospective continuation authority")
    return value


def record_funding6_successor(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Create v6 after v5 is exhausted, retaining every old reservation and authority."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path), controller.budget_digest_scope():
        output = capacity_path(ledger_path, version=6)
        if output.exists():
            raise ValueError("Count continuation cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        maximum, gpu = controller.effective_gpu_hour_capacity(ledger)
        if funding is None or funding["version"] != 6 or gpu is None or gpu["version"] != 5 or maximum != 300:
            raise ValueError("Exact existing funding6 and GPU5 authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()

        def protected_files():
            result = {ledger_path, Path(__file__).resolve(), Path(controller.__file__).resolve()}
            result.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            result.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return result

        def journal_identity():
            info = journal.stat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

        before = {path: sha(path) for path in protected_files()}
        journal_before = journal_identity()
        parent_path = capacity_path(ledger_path, version=5)
        parent = validate_funding6_extension(read(parent_path), ledger, funding,
                                           canonical_digest=controller._budget_digest)
        counts = {key: len(ledger.get(key, [])) for key in ("leases", "overheads", "trainingWindows")}
        hashes = {key: controller._budget_digest(_stable_history(ledger.get(key, []))
                   if key in {"leases", "overheads"} else ledger.get(key, [])) for key in counts}
        inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                     "originalCountFundingHash", "originalCountFundingSha256",
                     "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                     "infrastructureLedgerPathHash", "studyLedgerPathHash")
        body = {"version": 6, "profile": SUCCESSOR_PROFILE,
            **{key: parent[key] for key in inherited},
            "parentCapacityHash": parent["contentHash"], "parentCapacitySha256": before[parent_path],
            "parentSourceCommit": parent["sourceCommit"], "originalSliceSha256": before[ledger_path],
            "originalMaximumNewLeases": 16, "effectiveOriginalMaximumNewLeases": 28,
            "consumedBeforeFunding6": parent["consumedBeforeFunding6"],
            "baseMaximumNewLeases": parent["effectiveMaximumNewLeases"],
            "effectiveMaximumNewLeases": parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS,
            "additionalLeases": RECOVERY_SLOTS, "baselineCounts": counts, "baselineHashes": hashes,
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]],
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate_funding6_successor({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                           canonical_digest=controller._budget_digest)
        if (protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items())
                or journal_identity() != journal_before):
            raise ValueError("Original authorities, sources or journal stat changed during count continuation")
        controller.write_new(output, value)
        return value


FOLLOWUP_PROFILE = "acephale-evaluation-lease-capacity-v7"


def validate_funding6_followup(value: dict, ledger: dict, funding: dict, *, canonical_digest=digest) -> dict:
    """Validate v6's exhausted prefix before admitting four separately bound leases."""
    parent_path = capacity_path(Path(ledger["plan"]["infrastructureLedgerPath"]), version=6)
    parent = read(parent_path)
    prefix_count = parent["baselineCounts"]["leases"] + RECOVERY_SLOTS
    historical = {**ledger, "leases": ledger["leases"][:prefix_count]}
    validate_funding6_successor(parent, historical, funding, canonical_digest=canonical_digest)
    body = {key: item for key, item in value.items() if key != "contentHash"}
    inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                 "originalCountFundingHash", "originalCountFundingSha256",
                 "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                 "infrastructureLedgerPathHash", "studyLedgerPathHash")
    if (type(value.get("version")) is not int or value["version"] != 7
            or value.get("profile") != FOLLOWUP_PROFILE or value.get("contentHash") != canonical_digest(body)
            or value.get("parentCapacityHash") != parent["contentHash"]
            or value.get("parentCapacitySha256") != sha(parent_path)
            or value.get("parentSourceCommit") != parent["sourceCommit"]
            or any(value.get(key) != parent[key] for key in inherited)
            or any(type(value.get(key)) is not int or value[key] != expected for key, expected in (
                ("originalMaximumNewLeases", 16), ("effectiveOriginalMaximumNewLeases", 32),
                ("consumedBeforeFunding6", parent["consumedBeforeFunding6"]),
                ("baseMaximumNewLeases", parent["effectiveMaximumNewLeases"]),
                ("effectiveMaximumNewLeases", parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS),
                ("additionalLeases", RECOVERY_SLOTS)))
            or value.get("evaluationOnly") is not True or value.get("optimizerPermitted") is not False
            or value.get("leaseCountAuthorityChanged") is not True
            or any(value.get(key) is not False for key in ("financialCeilingsChanged", "gpuHoursChanged",
                   "existingReservationsChanged", "existingDeadlinesChanged", "modelContractsChanged"))
            or value.get("authorizationSource") != "explicit_user_instruction"
            or not isinstance(value.get("authorizationReason"), str) or not value["authorizationReason"].strip()
            or len(value["authorizationReason"]) > 1024
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("originalSliceSha256", ""))):
        raise ValueError("Count continuation requires the exact v6 parent and four unchanged-finance slots")
    recorded = value.get("recordedAt")
    if (type(recorded) not in (int, float) or not math.isfinite(recorded) or recorded < parent["recordedAt"]):
        raise ValueError("Count continuation cannot predate its parent")
    counts = value.get("baselineCounts")
    if (type(counts) is not dict or set(counts) != {"leases", "overheads", "trainingWindows"}
            or any(type(counts[key]) is not int or counts[key] < 0 for key in counts)
            or counts["leases"] != prefix_count):
        raise ValueError("Count continuation requires the exhausted v6 horizon")
    for field, count in counts.items():
        rows = ledger.get(field, [])
        if type(rows) is not list or len(rows) < count:
            raise ValueError("Count continuation cannot truncate retained history")
        projection = _stable_history(rows[:count]) if field in {"leases", "overheads"} else rows[:count]
        if canonical_digest(projection) != value.get("baselineHashes", {}).get(field):
            raise ValueError("Count continuation cannot change retained holds, identities or deadlines")
    if len(ledger.get("trainingWindows", [])) != counts["trainingWindows"]:
        raise ValueError("Count continuation never permits optimizer windows")
    states = value.get("baselineStates")
    if type(states) is not list or len(states) != prefix_count:
        raise ValueError("Count continuation requires every prior lifecycle identity")
    for old, current in zip(states, ledger["leases"][:prefix_count], strict=True):
        if (set(old) != {"id", "status", "instanceId"} or old["id"] != current["id"]
                or old["status"] not in {"terminated", "launch_unknown"}
                or (old["status"] == "launch_unknown" and old["instanceId"] is not None)
                or (old["status"] == "terminated" and
                    (current.get("status") != "terminated" or current.get("instanceId") != old["instanceId"]))):
            raise ValueError("Count continuation requires closed work and retained unresolved ownership")
    suffix = ledger["leases"][prefix_count:]
    if len(suffix) > RECOVERY_SLOTS:
        raise ValueError("Count continuation permits only four additional evaluation leases")
    for row in suffix:
        at = row.get("reservedAt")
        if (row.get("evaluationLeaseCapacityHash") != value["contentHash"]
                or row.get("infrastructureFundingSupplementHash") != value["fundingHash"]
                or row.get("gpuHourCapacityAddendumHash") != value["gpuHourCapacityHash"]
                or type(at) not in (int, float) or not math.isfinite(at) or at < recorded):
            raise ValueError("New lease must bind the exact prospective continuation authority")
    return value


def record_funding6_followup(ledger_path: Path, reason: str, *, controller=None, source_probe=None) -> dict:
    """Create v7 after v6 is exhausted, retaining every old reservation and authority."""
    if controller is None:
        import control as controller
    source_probe = source_probe or controller.committed_source
    ledger_path = ledger_path.resolve()
    with controller.ledger_lock(ledger_path), controller.budget_digest_scope():
        output = capacity_path(ledger_path, version=7)
        if output.exists():
            raise ValueError("Count continuation cannot be overwritten")
        ledger = controller.checked_bound_ledger(ledger_path)
        funding = controller.infrastructure_funding(ledger)
        maximum, gpu = controller.effective_gpu_hour_capacity(ledger)
        if funding is None or funding["version"] != 6 or gpu is None or gpu["version"] != 5 or maximum != 300:
            raise ValueError("Exact existing funding6 and GPU5 authority required")
        journal = Path(ledger["plan"]["studyLedgerPath"]).resolve()

        def protected_files():
            result = {ledger_path, Path(__file__).resolve(), Path(controller.__file__).resolve()}
            result.update(path for path in journal.parent.glob(journal.name + ".*.json") if path.is_file())
            result.update(path for path in ledger_path.parent.glob(ledger_path.name + ".*.json") if path.is_file())
            return result

        def journal_identity():
            info = journal.stat()
            return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

        before = {path: sha(path) for path in protected_files()}
        journal_before = journal_identity()
        parent_path = capacity_path(ledger_path, version=6)
        parent = validate_funding6_successor(read(parent_path), ledger, funding,
                                           canonical_digest=controller._budget_digest)
        counts = {key: len(ledger.get(key, [])) for key in ("leases", "overheads", "trainingWindows")}
        hashes = {key: controller._budget_digest(_stable_history(ledger.get(key, []))
                   if key in {"leases", "overheads"} else ledger.get(key, [])) for key in counts}
        inherited = ("fundingHash", "fundingSha256", "fundingPolicyHash", "planHash",
                     "originalCountFundingHash", "originalCountFundingSha256",
                     "gpuHourCapacityHash", "gpuHourCapacitySha256", "infrastructureBindingHash",
                     "infrastructureLedgerPathHash", "studyLedgerPathHash")
        body = {"version": 7, "profile": FOLLOWUP_PROFILE,
            **{key: parent[key] for key in inherited},
            "parentCapacityHash": parent["contentHash"], "parentCapacitySha256": before[parent_path],
            "parentSourceCommit": parent["sourceCommit"], "originalSliceSha256": before[ledger_path],
            "originalMaximumNewLeases": 16, "effectiveOriginalMaximumNewLeases": 32,
            "consumedBeforeFunding6": parent["consumedBeforeFunding6"],
            "baseMaximumNewLeases": parent["effectiveMaximumNewLeases"],
            "effectiveMaximumNewLeases": parent["effectiveMaximumNewLeases"] + RECOVERY_SLOTS,
            "additionalLeases": RECOVERY_SLOTS, "baselineCounts": counts, "baselineHashes": hashes,
            "baselineStates": [{key: row.get(key) for key in ("id", "status", "instanceId")} for row in ledger["leases"]],
            "recordedAt": controller.time.time(), "sourceCommit": source_probe(ledger["plan"]["sourceCommit"]),
            "authorizationSource": "explicit_user_instruction", "authorizationReason": reason.strip(),
            "evaluationOnly": True, "optimizerPermitted": False, "leaseCountAuthorityChanged": True,
            "financialCeilingsChanged": False, "gpuHoursChanged": False, "existingReservationsChanged": False,
            "existingDeadlinesChanged": False, "modelContractsChanged": False}
        value = validate_funding6_followup({**body, "contentHash": controller._budget_digest(body)}, ledger, funding,
                                           canonical_digest=controller._budget_digest)
        if (protected_files() != set(before) or any(sha(path) != expected for path, expected in before.items())
                or journal_identity() != journal_before):
            raise ValueError("Original authorities, sources or journal stat changed during count continuation")
        controller.write_new(output, value)
        return value
