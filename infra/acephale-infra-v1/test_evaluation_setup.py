"""Long setup is prospective, evaluation-only, and bounded by the funded lease."""
import copy

import pytest
from test_evaluation_dispatch_capacity import (  # noqa: F401
    NOW, amended, authorize, both_capacities, capacity_base, completion_funding,
    control, evaluation_capacity, exhausted, five_used, new_lease, quote, record,
)
from test_infrastructure_funding import funded  # noqa: F401


def reserve(ledger, seconds=7200, **kwargs):
    return control.reserve_lease(ledger, {**quote(), "quotedAt": NOW + 5},
                                 kwargs.pop("hours", 4), 0, NOW + 5,
                                 setup_seconds=seconds, **kwargs)


def test_long_setup_keeps_existing_rows_and_financial_bounds(exhausted):
    path, ledger, funding, _ = exhausted
    original = copy.deepcopy(ledger)
    files = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    with control.budget_digest_scope():
        usual = reserve(ledger, 3600)
        longer = reserve(ledger)
    assert funding["policy"]["evaluationOnly"] is True
    assert longer["setupDeadline"] == NOW + 5 + 7200
    assert usual["setupDeadline"] == NOW + 5 + 3600
    assert {k: v for k, v in longer.items() if k not in {"id", "setupDeadline"}} == {
        k: v for k, v in usual.items() if k not in {"id", "setupDeadline"}}
    assert ledger == original
    assert all(p.read_bytes() == data for p, data in files.items())


def test_setup_remains_clipped_to_original_funded_deadline(exhausted):
    _, ledger, _, _ = exhausted
    with control.budget_digest_scope():
        lease = reserve(ledger, hours=.25)
    assert lease["setupDeadline"] == lease["deadline"] == NOW + 5 + 900


@pytest.mark.parametrize("seconds", [False, 119, 7201, 7200.0, float("nan"), "7200"])
def test_bad_setup_never_changes_ledger(exhausted, seconds):
    path, ledger, _, _ = exhausted
    original = path.read_bytes()
    with control.budget_digest_scope(), pytest.raises(ValueError):
        reserve(ledger, seconds)
    assert path.read_bytes() == original


def test_canary_cannot_use_long_setup(exhausted):
    _, ledger, _, _ = exhausted
    with control.budget_digest_scope(), pytest.raises(ValueError, match="evaluation-only research"):
        reserve(ledger, purpose="cleanup_canary")


def test_training_funding_keeps_original_setup_limit(funded):
    path, ledger, _, _, _, funding = funded
    original = path.read_bytes()
    assert funding["version"] == 1 and "evaluationOnly" not in funding["policy"]
    with control.budget_digest_scope():
        assert reserve(ledger, 3600)["setupDeadline"] == NOW + 5 + 3600
        with pytest.raises(ValueError, match="evaluation-only research"):
            reserve(ledger)
    assert path.read_bytes() == original


def test_long_setup_does_not_bypass_active_owner_or_budget(exhausted):
    _, ledger, _, _ = exhausted
    with control.budget_digest_scope():
        active = copy.deepcopy(ledger)
        active["leases"][-1]["status"] = "active"
        with pytest.raises(ValueError):
            reserve(active)
        with pytest.raises(ValueError):
            reserve(ledger, hours=9)
