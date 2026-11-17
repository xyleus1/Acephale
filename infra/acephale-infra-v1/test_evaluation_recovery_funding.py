"""Money-only funding6 preserves GPU4 and the original funding5 count horizon."""
import copy
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from test_evaluation_finance import (  # noqa: F401
    NOW,
    amended,
    authorize,
    both_capacities,
    capacity_base,
    completion_funding,
    continue_capacity,
    continued_funding,
    control,
    evaluation_capacity,
    five_used,
    quote,
    record,
)


@pytest.fixture
def recovery_funding(continued_funding):  # noqa: F811
    path, ledger, parent, _ = continued_funding
    gpu = continue_capacity(path, ledger)
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 6}, 1, .597, NOW + 6)
    row.update(status="terminated", instanceId="retained-v5", name="retained-v5")
    ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    journal = Path(ledger["plan"]["studyLedgerPath"])
    policy = control.read_json(control.ROOT / "src/lib/acephale/contracts/infrastructure-funding-v6.json")
    body = {**copy.deepcopy(parent), "version": 6, "profile": "acephale-infrastructure-funding-v6",
        "policy": policy, "policyHash": control._budget_digest(policy),
        "parentFundingHash": parent["contentHash"],
        "parentFundingSha256": control.sha256(Path(str(journal) + ".infrastructure-funding-v5.json")),
        "baselineLeases": copy.deepcopy(ledger["leases"]),
        "baselineOverheads": copy.deepcopy(ledger["overheads"]),
        "baselineTrainingWindows": copy.deepcopy(ledger["trainingWindows"]),
        "authorizedAt": datetime.fromtimestamp(NOW + 7, timezone.utc).isoformat()}
    body.pop("contentHash")
    funding = {**body, "contentHash": control._budget_digest(body)}
    control.write_new(Path(str(journal) + ".infrastructure-funding-v6.json"), funding)
    return path, ledger, funding, gpu


@pytest.fixture(autouse=True)
def digest_scope():
    with control.budget_digest_scope():
        yield


def test_funding6_preserves_gpu200_and_original16_slot_horizon(recovery_funding):
    from evaluation_lease_capacity import effective_limit
    path, ledger, funding, gpu = recovery_funding
    assert control.checked_bound_ledger(path) == ledger
    assert control.infrastructure_caps(ledger) == (1050, 815, 235)
    assert control.effective_gpu_hour_capacity(ledger) == (200, gpu)
    remaining, count_authority = effective_limit(ledger, funding)
    assert remaining == 15 and count_authority is None
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, .0597, NOW + 9)
    assert row["infrastructureFundingSupplementHash"] == funding["contentHash"]
    assert row["gpuHourCapacityAddendumHash"] == gpu["contentHash"]
    row.update(status="terminated", instanceId="v6", name="v6")
    ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    # Existing unknown holds remain. Synthetic closed suffix fills the exact
    # remaining count; the final real reservation then proves the shared bound.
    for index in range(13):
        ledger["leases"].append({**row, "id":f"retained-count-{index}",
            "instanceId":f"retained-count-{index}", "name":f"retained-count-{index}"})
    last = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, 0, NOW + 9)
    last.update(status="terminated", instanceId="final", name="final")
    ledger["leases"].append(last)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    with pytest.raises(ValueError, match="lease count"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, .1, 0, NOW + 9)


@pytest.mark.parametrize("field", ["reservedUsd", "reservedHours", "deadline", "instanceId"])
def test_retained_v5_rows_and_holds_cannot_change(recovery_funding, field):
    _path, ledger, *_ = recovery_funding
    ledger["leases"][-1][field] = "changed" if field == "instanceId" else 0
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(ledger)


@pytest.mark.parametrize("hours,rate", [(8.01, 1.99), (8, 2)])
def test_new_lease_is_still_bounded(recovery_funding, hours, rate):
    _path, ledger, *_ = recovery_funding
    with pytest.raises(ValueError, match="eight hours|approved rate"):
        control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9, "hourlyUsd": rate}, hours, 0, NOW + 9)


def test_funding6_requires_exact_parent_and_protected_api_policy(recovery_funding):
    path, ledger, funding, _ = recovery_funding
    target = Path(ledger["plan"]["studyLedgerPath"] + ".infrastructure-funding-v6.json")
    for key in ("parentFundingHash", "parentFundingSha256"):
        value = {**funding, key: "f" * 64}
        value["contentHash"] = control._budget_digest({k: v for k, v in value.items() if k != "contentHash"})
        control.atomic_json(target, value)
        with pytest.raises(ValueError, match="parent"):
            control.checked_bound_ledger(path)
    control.atomic_json(target, funding)
    assert funding["policy"]["frozenApiHeadroomMicrodollars"] == 303000000
    assert funding["policy"]["frozenApiPlanMicrodollars"] == {
        "preparation": 0, "training": 0, "development": 65000000, "heldout": 238000000, "replay": 0}
    with pytest.raises(ValueError, match="does not authorize optimizer"):
        control.training_lease(path, "irrelevant", path, path.with_name("denied"), 1)


@pytest.mark.parametrize("hours", [8])
def test_no_gpu_capacity_reset_from_money_only_successor(recovery_funding, hours):
    _path, ledger, _, _ = recovery_funding
    lease = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, hours, 4.776, NOW + 9)
    assert lease["reservedHours"] == 8
    assert control.effective_gpu_hour_capacity(ledger)[0] == 200
    lease.update(status="terminated", instanceId="eight", name="eight")
    ledger["leases"].append(lease)
    assert control.effective_gpu_hour_capacity(ledger)[0] == 200


def test_prepare_rejects_original_port_ceiling_or_missing_port(recovery_funding):
    path, ledger, funding, _ = recovery_funding
    original = path.read_bytes()
    admitted = copy.deepcopy(ledger)
    admitted["plan"].update(region="synthetic-region", firewallRulesetId="synthetic-firewall", hardwareProfile="a100-40gb-v1")
    for extra in ({}, {"nativeBudgetPort": "acephale-infrastructure-aware-native-budget-v1",
                       "frozenNonContingencyCeilingMicrodollars": 1285000000}):
        inspection = {"infrastructureFundingSupplementHash": funding["contentHash"],
            "frozenApiHeadroomMicrodollars": 303000000, "frozenNonContingencyCeilingMicrodollars": 1785000000,
            "frozenApiPlanHash": control._budget_digest(funding["policy"]["frozenApiPlanMicrodollars"]),
            "frozenProjectedNonContingencyMicrodollars": 1000000000, **extra}
        with patch.object(control, "quote", return_value={**quote(), "quotedAt": NOW + 9}), \
             patch.object(control, "checked_bound_ledger", return_value=admitted), \
             patch.object(control, "infrastructure_funding", return_value=funding), \
             patch.object(control, "reserve_lease", return_value={"id": "prospective", "reservedMicrodollars": 20696000}), \
             patch.object(control, "validate_firewall"), pytest.raises(ValueError, match="API headroom"):
            control.prepare_lease(None, path, 8, 4.776, now=NOW + 9, budget=lambda *args, result=inspection: result)
        assert path.read_bytes() == original


@pytest.mark.skipif(not os.environ.get("ACEPHALE_FROZEN_IMAGE_ROOT"), reason="Exact frozen4438 checkout required")
def test_actual_frozen4438_execution_reader_accepts_evaluation_only(recovery_funding, tmp_path):
    path, ledger, funding, _ = recovery_funding
    row = control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 9}, 8, 4.776, NOW + 9)
    row.update(status="active", instanceId="v6-evaluation", name="v6-evaluation",
        studyReservation={"reservationId": "lambda-infra:" + row["id"],
            "maximumMicrodollars": row["reservedMicrodollars"], "infrastructureFundingSupplementHash": funding["contentHash"]})
    ledger["leases"].append(row)
    control.atomic_json(path, ledger)
    preflight, output = tmp_path / "preflight.json", tmp_path / "evaluation.json"
    control.write_new(preflight, {"profile": "acephale-evaluation-preflight-v1", "leaseId": row["id"],
        "instanceId": row["instanceId"], "studyBindingHash": ledger["planHash"], "machineIdSha256": "d" * 64,
        "providerReceiptSha256": "e" * 64, "actorStopped": True, "gpuProcesses": 0, "observedAt": NOW + 9,
        "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": quote()["hardwareProfileHash"]})
    with patch.object(control.time, "time", return_value=NOW + 9):
        control.evaluation_lease(path, row["id"], preflight, output, 3600, source_probe=lambda _: "b" * 40)
    frozen = Path(os.environ["ACEPHALE_FROZEN_IMAGE_ROOT"]).resolve()
    assert subprocess.check_output(["git", "-C", str(frozen), "rev-parse", "HEAD"], text=True).strip() == "4438b56c3053f0ee4a354d0e89ad31de82a766f7"
    code = """from pathlib import Path
import sys
from acephale import training
assert Path(training.__file__).resolve().is_relative_to(Path(sys.argv[2]).resolve())
for action in ('diagnostic','export','evaluate'):
    assert training.validate_execution_lease(Path(sys.argv[1]),action=action,now=float(sys.argv[3]))
try:
    training.validate_execution_lease(Path(sys.argv[1]),action='train',now=float(sys.argv[3]))
except ValueError:
    pass
else:
    raise AssertionError('Optimizer unexpectedly admitted')
print('actualFrozen4438ReaderPassed')
"""
    child = subprocess.run([sys.executable, "-c", code, str(output), str(frozen), str(NOW + 10)],
        cwd=tmp_path, env={**os.environ, "PYTHONPATH": str(frozen / "research/acephale/src")},
        text=True, capture_output=True, timeout=30, check=False)
    assert child.returncode == 0, child.stdout + child.stderr
    assert "actualFrozen4438ReaderPassed" in child.stdout
