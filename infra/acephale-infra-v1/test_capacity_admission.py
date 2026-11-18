"""Real preparation/launch paths with a synthetic provider, clock and funded ledger."""
import copy

import pytest

import test_control as base
from test_provider_launch_recovery import scenario

control = base.control


def unavailable(provider):
    original = provider.request

    def request(method, path, payload=None):
        result = original(method, path, payload)
        if path == '/instance-types':
            result['gpu_1x_a100_sxm4']['regions_with_capacity_available'] = []
        return result

    provider.request = request


def test_metadata_quote_and_real_reservation_do_not_claim_capacity():
    case = base.ControlTests()
    case.setUp()
    try:
        unavailable(case.client)
        with pytest.raises(control.CapacityUnavailable):
            control.prepare_lease(case.client, case.ledger, 1, 0, now=case.now, budget=case.budget)
        assert control.read_json(case.ledger)['leases'] == []
        assert 'reserve' not in case.budget_calls
        value = control.prepare_lease(case.client, case.ledger, 1, 0, now=case.now,
                                      budget=case.budget, require_capacity=False)
        assert value['status'] == 'reserved'
        assert value['quote']['capacityChecked'] is False
        assert case.budget_calls.count('reserve') == 1
        assert not any(method == 'POST' for method, _, _ in case.client.calls)
    finally:
        case.tearDown()


@pytest.mark.parametrize('change', ['sku', 'shape', 'architecture', 'price', 'image'])
def test_metadata_mode_still_checks_identity_and_price(change):
    provider = base.Provider()
    original = provider.request

    def request(method, path, payload=None):
        value = original(method, path, payload)
        if path == '/instance-types':
            item = value['gpu_1x_a100_sxm4']
            item['regions_with_capacity_available'] = []
            if change == 'sku':
                return {}
            if change == 'shape':
                item['instance_type']['specs']['gpus'] = 8
            if change == 'architecture':
                item['instance_type']['architecture'] = 'aarch64'
            if change == 'price':
                item['instance_type']['price_cents_per_hour'] = 100000
        if path == '/images' and change == 'image':
            return []
        return value

    provider.request = request
    with pytest.raises(ValueError):
        control.quote(provider, 'test-region', require_capacity=False)


def launch_wait(case, *, progress=None, seconds=90, until=None):
    case.post_error = None
    case.ticks = []
    original = case.client.request
    attempts = [0]
    case.events = []

    def request(method, path, payload=None):
        value = original(method, path, payload)
        if path == '/instance-types':
            attempts[0] += 1
            case.events.append(('quote', attempts[0]))
            if attempts[0] <= 2:
                value['gpu_1x_a100_sxm4']['regions_with_capacity_available'] = []
        return value

    case.client.request = request

    def budget(plan, operation, lease=None):
        case.events.append(('budget', operation))
        return case.budget(plan, operation, lease)

    def tick(lease, *, not_after, ledger_sha256):
        assert case.ledger.with_name(case.ledger.name + '.lock').exists()
        assert control.sha256(case.ledger) == ledger_sha256
        assert lease == case.prepared
        assert case.clock[0] < not_after
        case.ticks.append(case.clock[0])
        if progress:
            progress(lease)

    return lambda: control.launch(case.client, case.ledger, case.prepared['id'], case.watchdog,
        now=case.now, budget=budget, reconciliation_heartbeat=case.heartbeat,
        cancelled=lambda: case.cancelled, capacity_wait_seconds=seconds,
        capacity_progress=tick, capacity_not_after=case.now + 300 if until is None else until)


def test_final_wait_after_inspection_keeps_funds_owner_and_single_post(scenario):
    case = scenario
    before = copy.deepcopy(case.prepared)
    run = launch_wait(case)
    result = run()
    assert result['status'] == 'active'
    assert case.events.index(('budget', 'inspect')) < case.events.index(('quote', 2))
    assert case.phases == ['before_post']
    assert case.clock[0] >= case.now + 30
    assert all(b - a <= 10 for a, b in zip(case.ticks, case.ticks[1:]))
    assert case.budget_calls.count('reserve') == 1
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    for key in ('reservedUsd', 'reservedHours', 'deadline', 'setupDeadline', 'studyReservation', 'quote'):
        assert result[key] == before[key]
    assert not case.ledger.with_name(case.ledger.name + '.lock').exists()


@pytest.mark.parametrize('problem', ['timeout', 'cancel', 'authority', 'ledger', 'late-positive'])
def test_wait_rejects_changed_or_expired_admission_without_post(scenario, problem):
    case = scenario

    def progress(lease):
        if problem == 'cancel':
            case.cancelled = True
        if problem == 'authority':
            raise ValueError('Current financial/source authority changed')
        if problem == 'ledger':
            actual = control.read_json(case.ledger)
            actual['leases'][0]['reservedHours'] += 1
            control.atomic_json(case.ledger, actual)

    run = launch_wait(case, progress=progress, seconds=20 if problem == 'timeout' else 90)
    if problem == 'late-positive':
        original = case.client.request

        def delayed(method, path, payload=None):
            value = original(method, path, payload)
            if path == '/images' and case.ticks:
                case.clock[0] += 100
            return value

        case.client.request = delayed
    with pytest.raises((ValueError, TimeoutError, InterruptedError)):
        run()
    assert not any(method == 'POST' for method, _, _ in case.client.calls)
    assert control.read_json(case.ledger)['leases'][0]['status'] == 'reserved'
    assert case.budget_calls.count('reserve') == 1
    assert not case.ledger.with_name(case.ledger.name + '.lock').exists()


@pytest.mark.parametrize('problem', ['auth', 'malformed', 'missing-field', 'price', 'image'])
def test_only_explicit_unavailable_capacity_is_polled(scenario, problem):
    case = scenario
    run = launch_wait(case)
    original = case.client.request
    calls = [0]

    def request(method, path, payload=None):
        if path == '/instance-types':
            calls[0] += 1
            if calls[0] == 2 and problem == 'auth':
                raise PermissionError('Synthetic denied request')
        value = original(method, path, payload)
        if path == '/instance-types' and calls[0] == 2:
            if problem == 'malformed':
                return []
            item = value['gpu_1x_a100_sxm4']
            if problem == 'missing-field':
                item.pop('regions_with_capacity_available')
            else:
                item['regions_with_capacity_available'] = [{'name': 'test-region'}]
            if problem == 'price':
                item['instance_type']['price_cents_per_hour'] = 200
        if path == '/images' and calls[0] == 2 and problem == 'image':
            value[0]['id'] = 'changed-image'
        return value

    case.client.request = request
    with pytest.raises((ValueError, PermissionError)):
        run()
    assert calls[0] == 2
    assert not any(method == 'POST' for method, _, _ in case.client.calls)


def test_provider_rejection_is_never_a_second_post(scenario):
    case = scenario
    run = launch_wait(case)
    case.post_error = RuntimeError('Synthetic capacity race after final GET')
    with pytest.raises(RuntimeError, match='capacity race'):
        run()
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert control.read_json(case.ledger)['leases'][0]['status'] == 'launch_unknown'


@pytest.mark.parametrize('seconds', [-1, 901, True, 1.5])
def test_invalid_wait_configuration_has_no_provider_action(scenario, seconds):
    case = scenario
    run = launch_wait(case, seconds=seconds)
    before = len(case.client.calls)
    with pytest.raises(ValueError, match='Capacity wait'):
        run()
    assert len(case.client.calls) == before


def test_wait_requires_both_live_owner_and_final_heartbeat(scenario):
    case = scenario
    with pytest.raises(ValueError, match='live owner'):
        control.launch(case.client, case.ledger, case.prepared['id'], case.watchdog,
                       capacity_wait_seconds=90, capacity_progress=lambda *a, **k: None,
                       capacity_not_after=case.now + 100)


def test_explicit_cutoff_rejects(scenario):
    case = scenario
    run = launch_wait(case, until=case.now + 5)
    with pytest.raises(TimeoutError):
        run()
    assert not any(method == 'POST' for method, _, _ in case.client.calls)


def test_progress_cannot_mutate_in_memory_reserved_row(scenario):
    case = scenario
    run = launch_wait(case, progress=lambda lease: lease.update(reservedHours=999))
    result = run()
    assert result['reservedHours'] == case.prepared['reservedHours']


def test_wait_allowance_starts_after_expensive_budget_inspection(scenario):
    case = scenario
    original = case.budget

    def slow_budget(plan, operation, lease=None):
        result = original(plan, operation, lease)
        if operation == 'inspect':
            case.clock[0] += 180
        return result

    case.budget = slow_budget
    result = launch_wait(case)()
    assert result['status'] == 'active'
    assert case.ticks[0] == case.now + 180
    assert case.events.index(('budget', 'inspect')) < case.events.index(('quote', 2))


def test_final_gate_cannot_cross_capacity_admission_cutoff(scenario):
    case = scenario
    original = case.heartbeat

    def slow_final_gate(*args, **kwargs):
        case.clock[0] += 300
        return original(*args, **kwargs)

    case.heartbeat = slow_final_gate
    with pytest.raises(TimeoutError, match='cutoff expired during final'):
        launch_wait(case)()
    assert control.read_json(case.ledger)['leases'][0]['status'] == 'reserved'
    assert not any(method == 'POST' for method, _, _ in case.client.calls)


def test_backward_clock_rejects_before_another_provider_read(scenario):
    case = scenario
    run = launch_wait(case, progress=lambda lease: case.clock.__setitem__(0, case.clock[0] - 1))
    with pytest.raises(ValueError, match='clock moved backwards'):
        run()
    assert case.events.count(('quote', 2)) == 0
    assert not any(method == 'POST' for method, _, _ in case.client.calls)


def test_original_setup_limit_clips_later_caller_cutoff(scenario):
    case = scenario
    case.clock[0] = case.prepared['setupDeadline'] - 5
    run = launch_wait(case, until=case.prepared['deadline'])
    with pytest.raises(TimeoutError, match='capacity wait window'):
        run()
    assert not case.ticks
    assert not any(method == 'POST' for method, _, _ in case.client.calls)


def test_clock_jump_between_reads_never_creates_negative_sleep(tmp_path, monkeypatch):
    ledger = tmp_path / 'ledger.json'
    ledger.write_text('{}', encoding='utf-8')
    sleeps = []
    # Move the clock forward at different observation boundaries, including the
    # interval between the sleep-loop guard and its remaining-delay calculation.
    for jump_at in range(2, 26):
        clock, reads = [0.0], [0]

        def now():
            reads[0] += 1
            if reads[0] == jump_at:
                clock[0] = max(clock[0], 35.0)
            return clock[0]

        def sleep(seconds):
            assert seconds >= 0
            sleeps.append(seconds)
            clock[0] += seconds

        provider = base.Provider()
        unavailable(provider)
        with monkeypatch.context() as patch:
            patch.setattr(control.time, 'time', now)
            patch.setattr(control.time, 'sleep', sleep)
            with pytest.raises(TimeoutError):
                control._wait_for_launch_capacity(provider, ledger,
                    {'setupDeadline': 200, 'deadline': 300}, 'test-region', 'a100-40gb-v1',
                    40, 40, lambda *args, **kwargs: None, None, control.sha256(ledger))
    assert 0 in sleeps
