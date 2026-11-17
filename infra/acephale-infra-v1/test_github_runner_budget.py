"""Actual original-slice writer and GPU admission, with journal effects stubbed."""
import pytest
import test_control as base

control = base.control


@pytest.fixture
def fixture():
    value = base.ControlTests()
    value.setUp()
    try:
        yield value
    finally:
        value.tearDown()


ID = "11111111-1111-4111-8111-111111111111"


def test_cpu_runner_hold_is_compute_without_gpu_hours_or_slots(fixture):
    before = control.read_json(fixture.ledger)
    row = control.reserve_overhead(fixture.ledger, ID, 16.8, kind="github_actions_compute", budget=fixture.budget)
    after = control.checked_bound_ledger(fixture.ledger)
    assert row["provider"] == "github" and row["reservedComputeUsd"] == row["reservedUsd"] == 16.8
    assert "reservedHours" not in row and after["leases"] == before["leases"]
    assert after["priorGpuHours"] == before["priorGpuHours"]
    totals = control._infrastructure_reserved_totals(after)
    assert totals["computeUsd"] == 16.8 and totals["associatedUsd"] == 0
    assert row["studyReservation"]["reservationId"] == "lambda-infra:" + ID


def test_gpu_admission_counts_retained_cpu_compute(fixture):
    control.reserve_overhead(fixture.ledger, ID, 29, kind="github_actions_compute", budget=fixture.budget)
    before = fixture.ledger.read_bytes()
    with pytest.raises(ValueError, match="allocation"):
        control.prepare_lease(fixture.client, fixture.ledger, 1, 0, now=fixture.now, budget=fixture.budget)
    assert fixture.ledger.read_bytes() == before
    assert not any(call[0] == "POST" for call in fixture.client.calls)


def test_cpu_writer_rejects_compute_cap_before_any_journal_write(fixture):
    before = fixture.ledger.read_bytes()
    count = len(fixture.budget_calls)
    with pytest.raises(ValueError, match="compute"):
        control.reserve_overhead(fixture.ledger, ID, 30.01, kind="github_actions_compute", budget=fixture.budget)
    assert fixture.ledger.read_bytes() == before and len(fixture.budget_calls) == count


def test_cpu_hold_does_not_consume_associated_storage_allowance(fixture):
    control.reserve_overhead(fixture.ledger, ID, 16.8, kind="github_actions_compute", budget=fixture.budget)
    storage = control.reserve_overhead(fixture.ledger, "22222222-2222-4222-8222-222222222222", 5, budget=fixture.budget)
    assert storage["kind"] == "watchdog_storage_export" and "reservedComputeUsd" not in storage
    totals = control._infrastructure_reserved_totals(control.checked_bound_ledger(fixture.ledger))
    assert totals == {"computeUsd":16.8,"associatedUsd":5.0,"infrastructureUsd":21.8}


def test_uncertain_cpu_journal_write_retains_hold_and_refuses_reentry(fixture):
    def fail(*_):
        raise RuntimeError("uncertain original journal response")
    with pytest.raises(RuntimeError):
        control.reserve_overhead(fixture.ledger, ID, 1, kind="github_actions_compute", budget=fail)
    row = control.read_json(fixture.ledger)["overheads"][0]
    assert row["status"] == "reservation_pending" and row["reservedComputeUsd"] == 1
    before = fixture.ledger.read_bytes()
    with pytest.raises(ValueError, match="already attempted"):
        control.reserve_overhead(fixture.ledger, ID, 1, kind="github_actions_compute", budget=fixture.budget)
    assert fixture.ledger.read_bytes() == before
