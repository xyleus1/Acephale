"""Public progress ports with real local ledgers and synthetic external calls."""
from contextlib import contextmanager
import copy
import math
from pathlib import Path

import pytest

import provider_launch_recovery as recovery
import test_control as base
from test_provider_launch_recovery import scenario

control = base.control


class Progress:
    def __init__(self, case):
        self.case = case
        self.events = []
        self.active = False
        self.closed = False
        self.hooks = {}
        self.proof_delay = 0

    def record(self, phase):
        assert not self.closed
        assert self.case.ledger.with_name(self.case.ledger.name + '.lock').exists()
        self.events.append((phase, len(self.case.client.calls)))
        if phase in self.hooks:
            self.hooks[phase]()

    @contextmanager
    def scope(self, path):
        assert path == self.case.ledger
        self.record('enter')
        try:
            yield self
        finally:
            self.record('close')
            self.active = False
            self.closed = True

    def validated(self, ledger, lease, digest):
        assert ledger == control.read_json(self.case.ledger)
        assert lease == self.case.prepared
        assert digest == control.sha256(self.case.ledger)
        self.active = True
        self.record('validated')

    def tick(self):
        assert self.active
        self.record('tick')

    def invalidate(self):
        self.active = False
        self.record('invalidate')

    def uncertain(self, ledger, lease, digest, *, failure):
        assert not self.active and lease['status'] == 'launch_unknown'
        assert lease['instanceId'] is None
        assert lease['launchFailure'] == failure
        assert ledger == control.read_json(self.case.ledger)
        assert digest == control.sha256(self.case.ledger)
        self.active = True
        self.record('uncertain')

    def uncertain_heartbeat(self, lease, phase, *, not_after):
        assert self.active and phase == 'uncertain_response'
        self.record('unknown-proof')
        self.case.clock[0] += self.proof_delay
        ledger = control.read_json(self.case.ledger)
        return self.case.heartbeat(lease, phase, not_after=not_after,
            state=control.watchdog_payload(ledger, lease, 0),
            ledger_sha256=control.sha256(self.case.ledger))

    def committed(self, ledger, lease, digest, *, instance_id, failure, recovery):
        assert not self.active and lease['status'] == 'active'
        assert instance_id == lease['instanceId']
        assert failure == lease.get('launchFailure')
        assert recovery == lease.get('launchRecovery')
        assert ledger == control.read_json(self.case.ledger)
        assert digest == control.sha256(self.case.ledger)
        self.active = True
        self.record('committed')


def launch(case, progress):
    return control.launch(case.client, case.ledger, case.prepared['id'], case.watchdog,
        now=case.now, budget=case.budget, reconciliation_heartbeat=case.heartbeat,
        cancelled=lambda: case.cancelled, launch_progress=progress.scope)


def assert_closed(case, progress):
    assert progress.closed and not progress.active
    assert progress.events[-1][0] == 'close'
    assert not case.ledger.with_name(case.ledger.name + '.lock').exists()


def test_launch_progress_is_inside_lock_and_wraps_gets_without_repeating_post(scenario):
    case = scenario
    case.post_error = None
    progress = Progress(case)
    before = copy.deepcopy(case.prepared)
    result = launch(case, progress)
    assert result['status'] == 'active'
    phases = [phase for phase, _ in progress.events]
    assert phases[:2] == ['enter', 'validated']
    assert phases[-3:] == ['invalidate', 'committed', 'close']
    ticks = [count for phase, count in progress.events if phase == 'tick']
    assert len(ticks) % 2 == 0
    assert all(after == before + 1 for before, after in zip(ticks[::2], ticks[1::2]))
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert case.budget_calls.count('reserve') == 1
    for key in ('deadline', 'setupDeadline', 'reservedUsd', 'reservedHours', 'studyReservation'):
        assert result[key] == before[key]
    assert_closed(case, progress)


@pytest.mark.parametrize('phase', ['validated', 'tick', 'invalidate'])
def test_progress_cannot_change_ledger_before_the_only_post(scenario, phase):
    case = scenario
    progress = Progress(case)

    def mutate():
        value = control.read_json(case.ledger)
        value['priorInfraUsd'] += 1
        control.atomic_json(case.ledger, value)

    progress.hooks[phase] = mutate
    with pytest.raises(ValueError, match='changed'):
        launch(case, progress)
    assert not case.attempted
    assert_closed(case, progress)


def test_failed_initial_validation_closes_context_before_unlock(scenario):
    case = scenario
    progress = Progress(case)
    value = control.read_json(case.ledger)
    value['planHash'] = 'f' * 64
    control.atomic_json(case.ledger, value)
    with pytest.raises(ValueError):
        launch(case, progress)
    assert [phase for phase, _ in progress.events] == ['enter', 'close']
    assert not case.attempted
    assert_closed(case, progress)


def test_failure_after_active_commit_keeps_single_post_and_closes_context(scenario):
    case = scenario
    case.post_error = None
    progress = Progress(case)

    def fail():
        raise RuntimeError('Active publication failed')

    progress.hooks['committed'] = fail
    with pytest.raises(RuntimeError, match='Active publication'):
        launch(case, progress)
    assert control.read_json(case.ledger)['leases'][0]['status'] == 'active'
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert_closed(case, progress)


def test_extra_unknown_proof_retains_original_recovery_start(scenario):
    case = scenario
    progress = Progress(case)
    progress.proof_delay = 20
    result = launch(case, progress)
    proof = result['launchRecovery']
    assert proof['startedAt'] == case.now + case.post_delay
    assert proof['completedAt'] - proof['startedAt'] >= progress.proof_delay
    assert proof['completedAt'] - proof['startedAt'] <= 300
    assert case.phases == ['before_post', 'uncertain_response', 'uncertain_response', 'before_accept']
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert_closed(case, progress)


def test_extra_unknown_proof_cannot_outlive_previous_105_second_cap(scenario):
    case = scenario
    progress = Progress(case)
    progress.proof_delay = 76  # The sole provider POST already consumed30 seconds.
    with pytest.raises(TimeoutError, match='before PUT'):
        launch(case, progress)
    row = control.read_json(case.ledger)['leases'][0]
    assert row['status'] == 'launch_unknown' and row['instanceId'] is None
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert_closed(case, progress)


def test_failed_recovery_invalidates_before_writing_retained_failure(scenario, monkeypatch):
    case = scenario
    progress = Progress(case)
    case.detail_change = lambda row: {**row, 'id': 'b' * 32}
    atomic = control.atomic_json
    writes = []

    def observe(path, value):
        if 'launchRecoveryFailure' in value['leases'][0]:
            assert not progress.active
            writes.append('invalidated')
        return atomic(path, value)

    monkeypatch.setattr(control, 'atomic_json', observe)
    with pytest.raises(ValueError, match='changed'):
        launch(case, progress)
    assert writes == ['invalidated']
    assert control.read_json(case.ledger)['leases'][0]['status'] == 'launch_unknown'
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert_closed(case, progress)


@pytest.mark.parametrize('offset', [math.nan, math.inf, 1, -20000])
def test_recovery_rejects_invalid_original_start_before_any_effect(scenario, offset):
    case = scenario
    denied = lambda *args, **kwargs: pytest.fail('Invalid recovery cannot publish or call providers')
    with pytest.raises(ValueError, match='start'):
        recovery.reconcile(None, case.prepared, {}, {}, denied, [], denied, denied, None, {},
            started_at=case.clock[0] + offset)


def test_recovery_expired_original_start_is_not_reset(scenario):
    case = scenario
    denied = lambda *args, **kwargs: pytest.fail('Expired recovery cannot publish or call providers')
    with pytest.raises(TimeoutError, match='window'):
        recovery.reconcile(None, case.prepared, {}, {}, denied, [], denied, denied, None, {},
            started_at=case.clock[0] - 300)


def test_dispatch_source_closure_includes_current_recovery_module():
    files = {row['path']: row['sha256'] for row in control.controller_source_files()}
    assert files['provider_launch_recovery.py'] == control.sha256(Path(control.HERE) / 'provider_launch_recovery.py')
