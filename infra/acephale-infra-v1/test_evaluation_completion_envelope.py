"""Finite completion through normal readers/writers, retaining the unused slot."""
# ruff: noqa: F401,F811 -- import the existing complete fixture ancestry.
import copy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import evaluation_completion as envelope
import evaluation_lease_capacity as capacity
import pytest
from test_evaluation_count_followup import (
    NOW, amended, authorize, both_capacities, capacity_base, completion_funding,
    continue_capacity, continued_funding, control, digest_scope, evaluation_capacity,
    exhausted, extend, five_used, four_used, continue_count, eight_used,
    successor_count, twelve_used, followup_count, quote, record, recover,
    recovery_funding, reserve,
)


def fund7(path, ledger, parent):
    approved = control.read_json(control.ROOT / 'src/lib/acephale/contracts/infrastructure-funding-v7.json')
    body = {**copy.deepcopy(parent), 'version': 7, 'profile': 'acephale-infrastructure-funding-v7',
        'policy': approved, 'policyHash': control._budget_digest(approved),
        'parentFundingHash': parent['contentHash'],
        'parentFundingSha256': control.sha256(envelope.funding_path(ledger, 6)),
        'baselineLeases': copy.deepcopy(ledger['leases']),
        'baselineOverheads': copy.deepcopy(ledger['overheads']),
        'baselineTrainingWindows': copy.deepcopy(ledger['trainingWindows']),
        'sourceCommit': 'f' * 40, 'authorizedAt': datetime.fromtimestamp(NOW + 18, timezone.utc).isoformat()}
    body.pop('contentHash')
    value = {**body, 'contentHash': control._budget_digest(body)}
    control.write_new(envelope.funding_path(ledger, 7), value)
    return value


def add(path, kind, source_probe=lambda _: 'f' * 40):
    with patch.object(control.time, 'time', return_value=NOW + 20):
        return envelope.record(path, kind, 'Complete the authorized saved-model evaluation.',
            source_probe=source_probe, budget=lambda _plan, operation: {'operation': operation})


def test_complete_activation_preserves_ancestry_and_admits_exactly_nine(twelve_used):
    path, ledger, old_funding, old_gpu, _ = twelve_used
    old_count = followup_count(path)
    for index in range(3):
        reserve(ledger, f'last-parent-{index}', NOW + 17)
    control.atomic_json(path, ledger)
    remaining = capacity.effective_limit(ledger, old_funding)[0] - len(ledger['leases']) + len(old_funding['baselineLeases'])
    assert remaining == 1
    original_rows = copy.deepcopy(ledger['leases'])
    original_files = {p: p.read_bytes() for p in path.parent.iterdir() if p.is_file()}
    funding = fund7(path, ledger, old_funding)
    assert control.checked_bound_ledger(path) == ledger
    assert control.infrastructure_caps(ledger) == (1350, 1000, 350)
    assert control.effective_gpu_hour_capacity(ledger) == (300, old_gpu)
    assert capacity.effective_limit(ledger, funding) == (0, None)
    with pytest.raises(ValueError, match='lease count'):
        control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 21}, 5.5, 5.2835, NOW + 21, setup_seconds=7200)
    with pytest.raises(ValueError, match='funding7 then GPU6 then count8'):
        add(path, 'count')
    assert not envelope.path(ledger, 'count').exists()

    unexpected = Path(str(Path(ledger['plan']['studyLedgerPath'])) + '.unexpected-authority.json')
    def racing_source(_):
        control.write_new(unexpected, {'test': True})
        return 'f' * 40
    with pytest.raises(ValueError, match='changed during'):
        add(path, 'gpu', racing_source)
    assert not envelope.path(ledger, 'gpu').exists()
    unexpected.unlink()
    gpu = add(path, 'gpu')
    assert control.checked_bound_ledger(path) == ledger
    assert control.effective_gpu_hour_capacity(ledger) == (350, gpu)
    assert capacity.effective_limit(ledger, funding) == (0, None)
    with pytest.raises(ValueError, match='lease count'):
        control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 21}, 1, 0, NOW + 21)
    count = add(path, 'count')
    assert count['parentCapacityHash'] == old_count['contentHash']
    assert count['parentSourceCommit'] == old_count['sourceCommit'] != count['sourceCommit']
    assert count['consumedOriginalLeases'] == 31
    assert count['inheritedUnusedLeases'] == 1 and count['additionalLeases'] == 8
    assert count['effectiveOriginalMaximumNewLeases'] == 40
    assert capacity.effective_limit(ledger, funding) == (9, count)
    assert all(p.read_bytes() == raw for p, raw in original_files.items())

    for kind in ('gpu', 'count'):
        with pytest.raises(ValueError, match='overwritten'):
            add(path, kind)
    with pytest.raises(ValueError, match='does not authorize optimizer'):
        control.training_lease(path, 'unused', path, path.with_name('not-created'), 1)
    for index in range(9):
        row = control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 21}, .1, .0597, NOW + 21)
        assert row['infrastructureFundingSupplementHash'] == funding['contentHash']
        assert row['gpuHourCapacityAddendumHash'] == gpu['contentHash']
        assert row['evaluationLeaseCapacityHash'] == count['contentHash']
        row.update(name=f'completion-{index}', status='terminated', instanceId=None)
        ledger['leases'].append(row)
    control.atomic_json(path, ledger)
    assert control.checked_bound_ledger(path) == ledger
    assert ledger['leases'][:len(original_rows)] == original_rows
    before = path.read_bytes()
    with pytest.raises(ValueError, match='lease count'):
        control.reserve_lease(ledger, {**quote(), 'quotedAt': NOW + 21}, .1, 0, NOW + 21)
    assert path.read_bytes() == before

    for key, replacement in (('additionalLeases', 9), ('inheritedUnusedLeases', 2),
            ('effectiveMaximumNewLeases', 10), ('effectiveOriginalMaximumNewLeases', 41),
            ('parentCapacityHash', 'e' * 64), ('parentSourceCommit', 'e' * 40),
            ('fundingSha256', 'e' * 64), ('gpuHourCapacityHash', 'e' * 64),
            ('optimizerPermitted', True), ('version', True), ('recordedAt', NOW)):
        changed = copy.deepcopy(count)
        changed[key] = replacement
        changed['contentHash'] = control._budget_digest({k: v for k, v in changed.items() if k != 'contentHash'})
        with pytest.raises(ValueError):
            envelope.count_limit(ledger, funding, candidate=changed)
    for key, replacement in (('engineeringMaximumGpuHours', 351), ('parentCapacitySha256', 'e' * 64),
                              ('fundingHash', 'e' * 64), ('leaseCountAuthorityChanged', True)):
        changed = copy.deepcopy(gpu)
        changed[key] = replacement
        changed['contentHash'] = control._budget_digest({k: v for k, v in changed.items() if k != 'contentHash'})
        with pytest.raises(ValueError):
            envelope.gpu_capacity(ledger, funding, candidate=changed)
    for key in ('reservedUsd', 'reservedHours', 'deadline', 'setupDeadline', 'instanceId'):
        changed = copy.deepcopy(ledger)
        changed['leases'][len(original_rows) - 1][key] = 'wrong' if key == 'instanceId' else 0
        with pytest.raises(ValueError):
            envelope.count_limit(changed, funding)
    for target in (envelope.path(ledger, 'count'), envelope.path(ledger, 'gpu'),
                   capacity.capacity_path(path, version=7), envelope.funding_path(ledger, 7)):
        raw = target.read_bytes()
        target.unlink()
        try:
            with pytest.raises((ValueError, FileNotFoundError)):
                control.checked_bound_ledger(path)
        finally:
            target.write_bytes(raw)
    assert all(p.read_bytes() == raw for p, raw in original_files.items() if p != path)
    assert control.checked_bound_ledger(path) == ledger


def test_selected_nine_host_route_fits_finite_caps_without_releasing_holds():
    # Planning arithmetic only, using the retained observation, not a live quote.
    hosts, hours, rate, runner_minutes, runner_rate = 9, 5.5, 1.99, 350, .006
    new_compute = hosts * (hours * rate + 4 * runner_minutes * runner_rate)
    new_associated = new_compute * .30 + hosts * 2
    assert 257.02194532891116 + hosts * hours <= 350
    assert 688.873679 + new_compute <= 1000
    assert 221.057636 + new_associated <= 350
    assert 909.931315 + new_compute + new_associated <= 1350
