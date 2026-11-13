"""Capacity is prospective and cannot amend money, old leases or model contracts."""
import ast
import copy
import hashlib
import inspect
from pathlib import Path
from unittest.mock import patch

import collect_inventory
import pytest
from test_budget_policy import (  # noqa: F401 -- shared original v2 fixture
    amended,
    control,
    expand_v3,
)

NOW = 1794600000.0


@pytest.fixture
def capacity_base(amended):  # noqa: F811 -- pytest resolves the imported shared fixture
    path, ledger, parent = amended
    amendment = expand_v3(ledger, parent)
    for index, hours in enumerate((8, 8, 8, 8, 8, 8, 5.5)):
        ledger['leases'].append({'id': f'closed-{index}', 'name': f'owned-{index}', 'instanceId': f'instance-{index}',
            'status': 'terminated', 'reservedAt': NOW - 40000, 'deadline': NOW - 10000,
            'setupDeadline': NOW - 39000, 'reservedHours': hours, 'reservedUsd': hours * 1.99,
            'reservedComputeUsd': hours * 1.99, 'reservedMicrodollars': round(hours * 1.99 * 1_000_000)})
    control.atomic_json(path, ledger)
    return path, ledger, amendment


def history(path, ledger):
    target = path.with_name('capacity-history.json')
    control.write_new(target, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    return target


def record(path, ledger, **kwargs):
    with patch.object(control.time, 'time', return_value=NOW):
        return control.record_gpu_hour_capacity_addendum(path,
            'Explicit user instruction: continue necessary work within unchanged monetary allocations.',
            history(path, ledger), source_probe=lambda _: 'b' * 40,
            budget=kwargs.get('budget', lambda _plan, operation: {'operation': operation}))


def quote():
    selected = control.hardware_profile('a100-40gb-v1')
    return {'hourlyUsd': 1.99, 'quotedAt': NOW, 'hardwareProfile': selected['id'],
        'hardwareProfileHash': control.digest(selected), 'instanceType': selected['instanceType'],
        'imageFamily': 'gpu-base-24-04', 'imageId': 'pinned-image'}


def test_addendum_is_creation_only_and_preserves_all_original_bytes(capacity_base):
    path, ledger, amendment = capacity_base
    original = path.read_bytes()
    policy_path = Path(ledger['plan']['studyLedgerPath'] + '.policy-v3.json')
    policy_bytes = policy_path.read_bytes()
    with pytest.raises(ValueError, match='allocation'):
        control.reserve_lease(ledger, quote(), 8, 0, NOW)
    value = record(path, ledger)
    assert path.read_bytes() == original and policy_path.read_bytes() == policy_bytes
    assert value['operationalHistory']['reservedGpuHours'] == 63.5
    assert control.effective_budget_policy(ledger) == amendment
    assert control.effective_gpu_hour_capacity(ledger) == (128, value)
    assert control.infrastructure_caps(ledger) == (200, 150, 50)
    lease = control.reserve_lease(ledger, quote(), 8, 0, NOW)
    assert lease['gpuHourCapacityAddendumHash'] == value['contentHash']
    assert lease['reservedHours'] == 8 and lease['reservedComputeUsd'] == 15.92
    assert lease['deadline'] == NOW + 8 * 3600
    assert amendment['policy']['maxGpuHours'] == 64
    with pytest.raises(ValueError, match='cannot be overwritten'):
        control.record_gpu_hour_capacity_addendum(path, 'Repeat', path.with_name('capacity-history.json'))
    assert path.read_bytes() == original


def test_unknown_launch_is_retained_and_capacity_never_replaces_fence(capacity_base):
    path, ledger, _ = capacity_base
    ledger['leases'][-2].update(status='launch_unknown', instanceId=None)
    control.atomic_json(path, ledger)
    original = copy.deepcopy(ledger['leases'][-2])
    value = record(path, ledger)
    assert value['operationalHistory']['leases'][-2] == original
    assert original['reservedHours'] == 8
    with pytest.raises(ValueError, match='active or unresolved'):
        control.reserve_lease(ledger, quote(), 8, 0, NOW)
    assert control.read_json(path)['leases'][-2] == original


@pytest.mark.parametrize('change', [
    lambda value: value.update(engineeringMaximumGpuHours=256),
    lambda value: value.update(basePolicyMaximumGpuHours=128),
    lambda value: value.update(budgetAmendmentHash='f' * 64),
    lambda value: value.update(financialPolicyChanged=True),
    lambda value: value.update(existingReservationsChanged=True),
    lambda value: value.update(recordedAt=0),
])
def test_resealed_unauthorized_addendum_is_rejected(capacity_base, change):
    path, ledger, _ = capacity_base
    value = record(path, ledger)
    change(value)
    value['contentHash'] = control.digest({key: item for key, item in value.items() if key != 'contentHash'})
    control.atomic_json(control.gpu_hour_capacity_path(path), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


@pytest.mark.parametrize('field', ['reservedHours', 'reservedUsd', 'deadline', 'setupDeadline'])
def test_retained_reservations_and_deadlines_cannot_change(capacity_base, field):
    path, ledger, _ = capacity_base
    record(path, ledger)
    ledger['leases'][-1][field] -= 1
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_unchanged_financial_compute_cap_still_rejects_another_session(capacity_base):
    path, ledger, _ = capacity_base
    record(path, ledger)
    first = control.reserve_lease(ledger, quote(), 8, 0, NOW)
    ledger['leases'].append({**first, 'status': 'terminated'})
    assert control.effective_gpu_hour_capacity(ledger)[0] == 128
    with pytest.raises(ValueError, match='allocation'):
        control.reserve_lease(ledger, quote(), 8, 0, NOW)


def test_missing_addendum_or_new_unbound_lease_cannot_be_used(capacity_base):
    path, ledger, _ = capacity_base
    record(path, ledger)
    first = control.reserve_lease(ledger, quote(), 8, 0, NOW)
    ledger['leases'].append(first)
    control.atomic_json(path, ledger)
    control.checked_bound_ledger(path)
    changed = copy.deepcopy(ledger)
    changed['leases'][-1].pop('gpuHourCapacityAddendumHash')
    control.atomic_json(path, changed)
    with pytest.raises(ValueError, match='must bind'):
        control.checked_bound_ledger(path)
    control.atomic_json(path, ledger)
    control.gpu_hour_capacity_path(path).unlink()
    with pytest.raises(ValueError, match='requires its retained'):
        control.checked_bound_ledger(path)


def test_actual_policy_bytes_and_snapshot_are_rechecked(capacity_base):
    path, ledger, _ = capacity_base
    def race(_plan, operation):
        assert operation == 'inspect'
        with path.open('a') as stream:
            stream.write(' ')
        return {'operation': operation}
    with pytest.raises(ValueError, match='changed during'):
        record(path, ledger, budget=race)
    assert not control.gpu_hour_capacity_path(path).exists()


def test_no_current_work_can_be_reclassified_as_closed_for_authorization(capacity_base):
    path, ledger, _ = capacity_base
    ledger['leases'][-1]['status'] = 'active'
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match='closed work'):
        record(path, ledger)
    assert not control.gpu_hour_capacity_path(path).exists()


def test_capacity_is_prospective_and_keeps_exact_v3_policy_bytes(capacity_base):
    path, ledger, _ = capacity_base
    record(path, ledger)
    earlier = {**quote(), 'quotedAt': NOW - 1}
    with pytest.raises(ValueError, match='predate'):
        control.reserve_lease(ledger, earlier, 8, 0, NOW - 1)
    policy = Path(ledger['plan']['studyLedgerPath'] + '.policy-v3.json')
    with policy.open('a') as stream:
        stream.write(' ')
    with pytest.raises(ValueError, match='exact v3'):
        control.checked_bound_ledger(path)


def test_capacity_and_real_fence_validation_compose_without_overwriting_unknown():
    from test_unresolved_launch import FenceTests

    case = FenceTests()
    case.setUp()
    try:
        ledger = control.read_json(case.ledger)
        ledger['plan']['studyLedgerPath'] = str(case.root / 'journal.jsonl')
        ledger['planHash'] = control.digest(ledger['plan'])
        for enrolled in ledger['leases'][0]['watchdogs']:
            enrolled['planHash'] = ledger['planHash']
        ledger['trainingWindows'] = []
        parent = None
        for version in (2, 3):
            policy = control.read_json(control.ROOT / f'src/lib/acephale/contracts/budget-policy-v{version}.json')
            body = {'version': version, 'profile': f'acephale-budget-amendment-v{version}', 'policy': policy,
                'policyHash': control._budget_digest(policy), 'authorizedAt': '2026-11-13T00:00:00Z',
                'studyLedgerPathHash': control._budget_digest(str(Path(ledger['plan']['studyLedgerPath']).resolve())),
                'infrastructureBindingHash': control._budget_binding_hash(ledger), 'infrastructurePlanHash': ledger['planHash'],
                'baselineLeases': [], 'baselineOverheads': [], 'baselineTrainingWindows': []}
            if parent:
                body['parentAmendmentHash'] = parent['contentHash']
            parent = {**body, 'contentHash': control._budget_digest(body)}
            control.write_new(Path(ledger['plan']['studyLedgerPath'] + f'.policy-v{version}.json'), parent)
        ledger['leases'].append({'id': 'closed-history', 'status': 'terminated', 'reservedHours': 61.5,
            'reservedUsd': 61.5 * 1.99, 'reservedComputeUsd': 61.5 * 1.99})
        control.atomic_json(case.ledger, ledger)
        record(case.ledger, ledger)
        prior = copy.deepcopy(ledger['leases'][0])
        case.prior, case.now = prior, NOW
        case.plan = ledger['plan']
        case.proof = case.make_proof()
        import unresolved_launch
        for row in case.proof['controllers']:
            row['enrollment']['observed']['reason'] = unresolved_launch.watchdog.reason(row['state'], NOW)
        case.proof['contentHash'] = control.digest({key: item for key, item in case.proof.items() if key != 'contentHash'})
        control.atomic_json(case.proof_path, case.proof)
        lease = case.prepare_replacement()
        assert lease['gpuHourCapacityAddendumHash']
        case.client.fail_launch = False
        actual = control.launch(case.client, case.ledger, lease['id'], case.watchdog,
            now=NOW, budget=case.budget, unresolved_fence=case.proof_path)
        assert actual['status'] == 'active'
        assert control.read_json(case.ledger)['leases'][0] == prior
        assert prior['status'] == 'launch_unknown' and prior['reservedUsd'] > 0
        assert {row['controllerId'] for row in actual['watchdogs']}.isdisjoint(
            {row['controllerId'] for row in prior['watchdogs']})
    finally:
        case.tearDown()


def test_actual_training_lease_v3_and_provider_inventory_accept_external_capacity(capacity_base, tmp_path):
    from acephale import training

    path, ledger, amendment = capacity_base
    capacity = record(path, ledger)
    lease = control.reserve_lease(ledger, quote(), 8, 0, NOW)
    lease.update(status='active', instanceId='new-instance', name='acephale-infra-' + lease['id'],
        studyReservation={'reservationId': 'lambda-infra:' + lease['id'], 'maximumMicrodollars': lease['reservedMicrodollars']})
    ledger['leases'].append(lease)
    control.atomic_json(path, ledger)
    preflight = tmp_path / 'preflight.json'
    control.write_new(preflight, {'profile': 'acephale-training-preflight-v1', 'observedAt': NOW,
        'actorStopped': True, 'gpuProcesses': 0, 'hardwareProfile': 'a100-40gb-v1',
        'hardwareProfileHash': quote()['hardwareProfileHash']})
    with patch.object(control.time, 'time', return_value=NOW):
        actual = control.training_lease(path, lease['id'], preflight, tmp_path / 'fit.json', 4, 'fit')
    assert actual['version'] == 3 and actual['budgetPolicy'] == amendment['policy']
    assert actual['budgetPolicy']['maxGpuHours'] == 64
    assert 'gpuHourCapacityAddendumHash' not in actual
    assert actual['providerLeaseHash'] == control.digest(lease)
    assert training.validate_training_lease(tmp_path / 'fit.json', now=NOW)['version'] == 3
    # The deployed 5a reader is exactly the same function, not an assumed future decoder.
    # Frozen AST hash was read directly from 5a36a8b3's training.py Git blob.
    # Keeping it here also supports shallow CI checkouts with no historical tree.
    current = ast.parse(inspect.getsource(training.validate_training_lease)).body[0]
    assert hashlib.sha256(ast.dump(current, include_attributes=False).encode()).hexdigest() == \
        '10a91fe8126f78880cb7bb1515158da98ed460e5947a3f9690c55f4fb4029a18'
    machine = tmp_path / 'host/etc/machine-id'
    machine.parent.mkdir(parents=True)
    machine.write_text('fixture-machine-id', encoding='utf-8')
    ssh = tmp_path / 'ssh.json'
    control.write_new(ssh, {'host': '192.0.2.1', 'port': 22, 'user': 'ubuntu',
        'hostKeySha256': 'SHA256:' + 'A' * 43, 'machineIdSha256': control.sha256(machine)})
    class Provider:
        def request(self, method, endpoint):
            assert method == 'GET' and endpoint == '/instances/new-instance'
            return {'id': lease['instanceId'], 'name': lease['name'], 'status': 'active', 'ip': '192.0.2.1',
                'instance_type': {'name': quote()['instanceType']}}
    provider = tmp_path / 'provider.json'
    control.provider_receipt(Provider(), path, lease['id'], ssh, provider)
    observed = control.read_json(provider)
    assert observed['infrastructureCapacityAuthorization']['contentHash'] == capacity['contentHash']
    _, evidence = collect_inventory.lambda_identity(provider, tmp_path / 'host', control.hardware_profile('a100-40gb-v1'))
    assert evidence['identityReceipt'] == observed
    old_windows = copy.deepcopy(ledger['trainingWindows'])
    overhead = control.reserve_overhead(path, '11111111-1111-4111-8111-111111111111', 1, kind='provider_tax_allowance',
        budget=lambda _plan, _operation, row: {'reservationId': row['id'], 'maximumMicrodollars': row['reservedMicrodollars']})
    assert overhead['status'] == 'reserved'
    after = control.checked_bound_ledger(path)
    assert after['trainingWindows'][:len(old_windows)] == old_windows
    assert after['trainingWindows'][-1]['receiptHash'] == control.digest(actual)
    assert after['overheads'][-1]['reservedUsd'] == 1
