"""Count9 composes with complete authority readers and ordinary reservations."""
# ruff: noqa: F401,F811 -- retain the established complete ancestry fixtures.
import copy
from pathlib import Path
from unittest.mock import patch

import evaluation_completion as envelope
import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_completion_envelope import (
    NOW, add, amended, authorize, both_capacities, capacity_base, completion_funding,
    continue_capacity, continued_funding, control, digest_scope, evaluation_capacity,
    exhausted, extend, five_used, four_used, continue_count, eight_used,
    successor_count, twelve_used, followup_count, quote, record, recover,
    recovery_funding, reserve, fund7,
)


@pytest.fixture
def one_remaining(twelve_used):
    path, ledger, previous_funding, *_ = twelve_used
    followup_count(path)
    for index in range(3):
        reserve(ledger, f'parent-{index}', NOW + 17)
    control.atomic_json(path, ledger)
    funding = fund7(path, ledger, previous_funding)
    gpu, parent = add(path, 'gpu'), add(path, 'count')
    for index in range(8):
        row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 21}, .1, .0597, NOW + 21)
        row.update(name=f'closed-{index}', status='terminated', instanceId=None)
        ledger['leases'].append(row)
    control.atomic_json(path, ledger)
    return path, ledger, funding, gpu, parent


def extend_count(path, **kwargs):
    with patch.object(control.time, 'time', return_value=NOW + 30):
        return capacity.record_funding7_recovery(path, 'Complete the authorized paired evaluation.',
            source_probe=kwargs.pop('source_probe', lambda _: 'c' * 40),
            budget=kwargs.pop('budget', lambda _plan, operation: {'operation': operation}), **kwargs)


def reseal(value):
    value['contentHash'] = control._budget_digest({key: item for key, item in value.items() if key != 'contentHash'})
    return value


def test_normal_writer_retains_parent_and_admits_eight_future_leases(one_remaining):
    path, ledger, funding, gpu, parent = one_remaining
    original = copy.deepcopy(ledger)
    before = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    assert capacity.effective_limit(ledger, funding)[0] - len(ledger['leases']) + len(funding['baselineLeases']) == 1
    value = extend_count(path)
    target = capacity.capacity_path(path, version=9)
    assert target.exists()
    assert value['parentCapacityHash'] == parent['contentHash']
    assert value['parentSourceCommit'] == parent['sourceCommit'] != value['sourceCommit']
    assert value['inheritedUnusedLeases'] == 1 and value['additionalLeases'] == 7
    assert value['prospectiveLeaseLimit'] == 8 and value['effectiveMaximumNewLeases'] == 16
    assert value['effectiveOriginalMaximumNewLeases'] == 47
    assert value['baselineCounts']['leases'] == len(original['leases'])
    assert control.checked_bound_ledger(path) == original
    assert capacity.effective_limit(ledger, funding) == (16, value)
    assert control.infrastructure_caps(ledger) == (1350, 1000, 350)
    assert control.effective_gpu_hour_capacity(ledger) == (350, gpu)
    assert all(p.read_bytes() == data for p, data in before.items())
    with pytest.raises(ValueError, match='overwritten'):
        extend_count(path)
    for index in range(8):
        row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 31}, .1, .0597, NOW + 31)
        assert row['evaluationLeaseCapacityHash'] == value['contentHash']
        assert row['infrastructureFundingSupplementHash'] == funding['contentHash']
        assert row['gpuHourCapacityAddendumHash'] == gpu['contentHash']
        row.update(name=f'new-{index}', status='terminated', instanceId=None)
        ledger['leases'].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    assert ledger['leases'][:len(original['leases'])] == original['leases']
    assert all(p.read_bytes() == data for p, data in before.items() if p != path)
    with pytest.raises(ValueError, match='lease count'):
        control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 31}, .1, 0, NOW + 31)


def test_resealed_authority_changes_do_not_expand_scope(one_remaining):
    path, ledger, funding, *_ = one_remaining
    value = extend_count(path)
    for key, replacement in (
        ('version', True), ('additionalLeases', 8), ('prospectiveLeaseLimit', 9),
        ('effectiveMaximumNewLeases', 17), ('effectiveOriginalMaximumNewLeases', 48),
        ('consumedParentLeases', 7), ('inheritedUnusedLeases', 2),
        ('parentCapacityHash', 'e' * 64), ('parentCapacitySha256', 'e' * 64),
        ('parentSourceCommit', 'e' * 40), ('fundingHash', 'e' * 64),
        ('fundingSha256', 'e' * 64), ('gpuHourCapacityHash', 'e' * 64),
        ('gpuHourCapacitySha256', 'e' * 64), ('policyHash', 'e' * 64),
        ('financialCeilingsChanged', True), ('gpuHoursChanged', True),
        ('optimizerPermitted', True), ('existingDeadlinesChanged', True),
        ('sourceCommit', 'not-a-commit'), ('recordedAt', NOW),
    ):
        changed = copy.deepcopy(value)
        changed[key] = replacement
        with pytest.raises(ValueError):
            capacity.validate_funding7_recovery(reseal(changed), ledger, funding)


def test_historical_funding6_reader_retains_count7_after_count9(one_remaining):
    path, ledger, funding, *_ = one_remaining
    historical, old_funding, original_count, _ = envelope.parents(ledger, funding)
    original = capacity.effective_limit(historical, old_funding)
    extend_count(path)
    # The launch adapter rereads this retained ancestry after current admission.
    assert capacity.effective_limit(historical, old_funding) == original
    assert original[1] == original_count and original_count['version'] == 7
    assert capacity.effective_limit(ledger, funding)[1]['version'] == 9


def test_closed_history_and_missing_parent_authority_fail_closed(one_remaining):
    path, ledger, funding, *_ = one_remaining
    extend_count(path)
    for key, replacement in (('reservedUsd', 0), ('reservedHours', 0), ('deadline', 0),
                             ('setupDeadline', 0), ('studyReservation', {}), ('status', 'reserved'),
                             ('instanceId', 'unobserved')):
        changed = copy.deepcopy(ledger)
        changed['leases'][-1][key] = replacement
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    changed = copy.deepcopy(ledger)
    changed['overheads'].pop()
    with pytest.raises(ValueError):
        capacity.effective_limit(changed, funding)
    for target in (capacity.capacity_path(path, version=8), envelope.path(ledger, 'gpu'),
                   envelope.funding_path(ledger, 7)):
        data = target.read_bytes()
        target.unlink()
        try:
            with pytest.raises((ValueError, FileNotFoundError)):
                control.checked_bound_ledger(path)
        finally:
            target.write_bytes(data)


@pytest.mark.parametrize('condition', ['active', 'two_remaining', 'exhausted'])
def test_writer_requires_exact_closed_prefix_and_one_retained_slot(one_remaining, condition):
    path, ledger, *_ = one_remaining
    if condition == 'active':
        ledger['leases'][-1]['status'] = 'reserved'
    elif condition == 'two_remaining':
        ledger['leases'].pop()
    else:
        row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 22}, .1, 0, NOW + 22)
        row.update(name='ninth', status='terminated', instanceId=None)
        ledger['leases'].append(row)
    control.atomic_json(path, ledger)
    before = path.read_bytes()
    with pytest.raises(ValueError, match='closed work|one retained unused'):
        extend_count(path)
    assert path.read_bytes() == before and not capacity.capacity_path(path, version=9).exists()


def test_writer_detects_authority_set_and_journal_races(one_remaining):
    path, ledger, *_ = one_remaining
    journal = Path(ledger['plan']['studyLedgerPath'])
    extra = path.with_name(path.name + '.unexpected-authority.json')
    def changed_authority(_plan, operation):
        control.write_new(extra, {'new': True})
        return {'operation': operation}
    with pytest.raises(ValueError, match='changed during'):
        extend_count(path, budget=changed_authority)
    assert not capacity.capacity_path(path, version=9).exists()
    extra.unlink()
    before = journal.read_bytes()
    def changed_journal(_plan, operation):
        with journal.open('ab') as stream:
            stream.write(b'\n')
        return {'operation': operation}
    try:
        with pytest.raises(ValueError, match='changed during'):
            extend_count(path, budget=changed_journal)
        assert not capacity.capacity_path(path, version=9).exists()
    finally:
        journal.write_bytes(before)


def test_recording_cannot_predate_verified_closed_history(one_remaining):
    path, ledger, *_ = one_remaining
    ledger['leases'][-1]['terminationVerifiedAt'] = NOW + 35
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match='predate'):
        extend_count(path)
    assert not capacity.capacity_path(path, version=9).exists()


def test_normal_session_money_gpu_and_optimizer_limits_remain(one_remaining, tmp_path):
    path, ledger, funding, *_ = one_remaining
    extend_count(path)
    for hours, rate in ((8.01, 1.99), (.1, 2)):
        with pytest.raises(ValueError, match='eight hours|approved rate'):
            control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 31, 'hourlyUsd': rate}, hours, 0, NOW + 31)
    with pytest.raises(ValueError, match='does not authorize optimizer'):
        control.training_lease(path, 'unused', path, tmp_path / 'denied', 1)
    with pytest.raises(ValueError, match='predate its lease-count'):
        control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 29}, .1, 0, NOW + 29)
    row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 31}, .1, 0, NOW + 31)
    row.update(name='new', status='terminated', instanceId=None)
    ledger['leases'].append(row)
    target = capacity.capacity_path(path, version=9)
    data = target.read_bytes()
    target.unlink()
    try:
        with pytest.raises(ValueError, match='count8'):
            capacity.effective_limit(ledger, funding)
    finally:
        target.write_bytes(data)


def test_normal_reader_rejects_new_lease_funding_and_gpu_tag_changes(one_remaining):
    path, ledger, funding, *_ = one_remaining
    extend_count(path)
    row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 31}, .1, 0, NOW + 31)
    row.update(name='new', status='terminated', instanceId=None)
    ledger['leases'].append(row)
    for field in ('infrastructureFundingSupplementHash', 'gpuHourCapacityAddendumHash', 'evaluationLeaseCapacityHash'):
        changed = copy.deepcopy(ledger)
        changed['leases'][-1][field] = 'e' * 64
        control.atomic_json(path, changed)
        with pytest.raises(ValueError):
            control.checked_bound_ledger(path)
        with pytest.raises(ValueError):
            capacity.effective_limit(changed, funding)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger


def test_retained_unknown_hold_stays_exact_and_cannot_authorize_active_work(one_remaining):
    _, ledger, funding, *_ = one_remaining
    # Test the new closed-prefix layer separately; parent authority validation
    # and normal reservations are exercised by the complete-chain cases above.
    original = copy.deepcopy(ledger)
    original['leases'][0].update(status='launch_unknown', instanceId=None)
    value = envelope.baseline(original)
    prefix = capacity._count_recovery_prefix(value, original, funding)
    assert prefix['leases'][0] == original['leases'][0]
    assert prefix['leases'][0]['reservedUsd'] == ledger['leases'][0]['reservedUsd']
    for field, replacement in (('instanceId', 'invented'), ('status', 'active'),
                              ('reservedUsd', 0), ('deadline', 0)):
        changed = copy.deepcopy(original)
        changed['leases'][0][field] = replacement
        with pytest.raises(ValueError):
            capacity._count_recovery_prefix(value, changed, funding)
    unknown_new = copy.deepcopy(original)
    unknown_new['leases'][-1].update(status='launch_unknown', instanceId=None)
    with pytest.raises(ValueError, match='closed work'):
        capacity._count_recovery_prefix(envelope.baseline(unknown_new), unknown_new, funding)
