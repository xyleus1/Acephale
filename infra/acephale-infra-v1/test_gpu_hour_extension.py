"""A chained engineering allowance cannot change money, old work or model gates."""
import copy
from pathlib import Path
from unittest.mock import patch

import collect_inventory
import lambda_gpu_watchdog as watchdog
import pytest
from test_gpu_hour_capacity import NOW, amended, capacity_base, control, quote  # noqa: F401
from test_infrastructure_funding import continued, extended, funded
from test_lambda_gpu_watchdog import Provider


@pytest.fixture
def evaluation_capacity(capacity_base):  # noqa: F811
    initial = funded.__wrapped__(capacity_base)
    path, ledger, *_ = initial
    # Earlier lower-priced leases consume engineering hours even when money remains.
    for index in range(6):
        lease = control.reserve_lease(ledger, {**quote(), 'hourlyUsd': .5}, 8, 0, NOW)
        lease.update(status='terminated', instanceId=f'cheap-{index}', name=f'cheap-{index}')
        ledger['leases'].append(lease)
    control.atomic_json(path, ledger)
    ready = continued.__wrapped__(extended.__wrapped__(initial))
    assert control.gpu_hour_capacity_history(ledger, control.sha256(path))['reservedGpuHours'] == 123.5
    return ready


def record_extension(path, ledger, *, budget=None):
    history = path.with_name('extension-history.json')
    control.write_new(history, control.gpu_hour_capacity_history(ledger, control.sha256(path)))
    with patch.object(control.time, 'time', return_value=NOW):
        return control.record_gpu_hour_capacity_extension(path, 'Explicit user instruction to continue necessary evaluation.',
            history, source_probe=lambda _: 'b' * 40, budget=budget or (lambda _plan, operation: {'operation': operation}))


def append_active(ledger, funding):
    lease = control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
    lease.update(status='active', instanceId='new-instance', name='acephale-infra-' + lease['id'],
        studyReservation={'reservationId': 'lambda-infra:' + lease['id'],
            'maximumMicrodollars': lease['reservedMicrodollars'],
            'infrastructureFundingSupplementHash': funding['contentHash']})
    ledger['leases'].append(lease)
    return lease


def test_extension_preserves_original_bytes_and_crosses_128_with_new_authority(evaluation_capacity):
    path, ledger, _, _, funding, _ = evaluation_capacity
    originals = {p: p.read_bytes() for p in path.parent.glob('*.json')}
    with pytest.raises(ValueError, match='allocation'):
        control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
    extension = record_extension(path, ledger)
    assert control.effective_gpu_hour_capacity(ledger) == (160, extension)
    assert control.infrastructure_caps(ledger) == (420, 315, 105)
    assert control.effective_budget_policy(ledger)['policy']['maxGpuHours'] == 64
    assert all(p.read_bytes() == value for p, value in originals.items())
    assert extension['parentCapacitySha256'] == control.sha256(control.gpu_hour_capacity_path(path))
    lease = append_active(ledger, funding)
    assert lease['gpuHourCapacityAddendumHash'] == extension['contentHash']
    assert sum(row['reservedHours'] for row in ledger['leases']) == 131.5
    control.atomic_json(path, ledger)
    control.checked_bound_ledger(path)
    with pytest.raises(ValueError, match='cannot be overwritten'):
        control.record_gpu_hour_capacity_extension(path, 'repeat', path.with_name('extension-history.json'))


@pytest.mark.parametrize('change', [
    lambda v: v.update(version=True),
    lambda v: v.update(engineeringMaximumGpuHours=161),
    lambda v: v.update(parentEngineeringMaximumGpuHours=160),
    lambda v: v.update(parentCapacityHash='f' * 64),
    lambda v: v.update(parentCapacitySha256='f' * 64),
    lambda v: v.update(fundingHash='f' * 64),
    lambda v: v.update(fundingSha256='f' * 64),
    lambda v: v.update(financialBindingHash='f' * 64),
    lambda v: v.update(planHash='f' * 64),
    lambda v: v.update(recordedAt=0),
    lambda v: v.update(evaluationOnly=False),
    lambda v: v.update(optimizerPermitted=True),
    lambda v: v.update(existingReservationsChanged=True),
])
def test_resealed_extension_cannot_expand_or_rebind_authority(evaluation_capacity, change):
    path, ledger, *_ = evaluation_capacity
    value = record_extension(path, ledger)
    change(value)
    value['contentHash'] = control.digest({k: v for k, v in value.items() if k != 'contentHash'})
    control.atomic_json(control.gpu_hour_capacity_path(path, 2), value)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


@pytest.mark.parametrize('field', ['reservedHours', 'reservedUsd', 'deadline', 'setupDeadline', 'name', 'instanceId'])
def test_old_reservation_and_identity_are_immutable(evaluation_capacity, field):
    path, ledger, *_ = evaluation_capacity
    record_extension(path, ledger)
    ledger['leases'][-1][field] = 0 if isinstance(ledger['leases'][-1][field], (int, float)) else 'different'
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError):
        control.checked_bound_ledger(path)


def test_missing_parent_new_lease_binding_and_original_financial_limits(evaluation_capacity):
    path, ledger, _, _, funding, _ = evaluation_capacity
    record_extension(path, ledger)
    lease = append_active(ledger, funding)
    control.atomic_json(path, ledger)
    lease['gpuHourCapacityAddendumHash'] = 'f' * 64
    with pytest.raises(ValueError, match='must bind'):
        control.effective_gpu_hour_capacity(ledger)
    control.gpu_hour_capacity_path(path).unlink()
    with pytest.raises(ValueError, match='retained'):
        control.checked_bound_ledger(path)


def test_extension_rechecks_parent_bytes_and_rejects_creation_race(evaluation_capacity):
    path, ledger, *_ = evaluation_capacity
    parent = control.gpu_hour_capacity_path(path)
    def race(_plan, _operation):
        with parent.open('a') as stream:
            stream.write(' ')
        return {}
    with pytest.raises(ValueError, match='exact parent|changed during'):
        record_extension(path, ledger, budget=race)
    assert not control.gpu_hour_capacity_path(path, 2).exists()


def test_unknown_hold_is_retained_and_still_requires_a_real_fence(capacity_base):
    path, ledger, _ = capacity_base
    ledger['leases'][-2].update(status='launch_unknown', instanceId=None)
    control.atomic_json(path, ledger)
    initial = funded.__wrapped__(capacity_base)
    # Zero new leases is a valid financial chain. Keep the unknown launch in each
    # baseline; no replacement fence is fabricated to create the test authority.
    _, _, _, _, parent_path, parent = initial
    for version in (2, 3):
        policy = control.read_json(control.ROOT / f'src/lib/acephale/contracts/infrastructure-funding-v{version}.json')
        value = {**copy.deepcopy(parent), 'version': version,
            'profile': f'acephale-infrastructure-funding-v{version}', 'policy': policy,
            'policyHash': control._budget_digest(policy), 'parentFundingHash': parent['contentHash'],
            'parentFundingSha256': control.sha256(parent_path)}
        value['contentHash'] = control._budget_digest({k: v for k, v in value.items() if k != 'contentHash'})
        parent_path = Path(ledger['plan']['studyLedgerPath'] + f'.infrastructure-funding-v{version}.json')
        control.write_new(parent_path, value)
        parent = value
    original = copy.deepcopy(ledger['leases'][-2])
    extension = record_extension(path, ledger)
    assert control.effective_gpu_hour_capacity(ledger) == (160, extension)
    assert extension['operationalHistory']['leases'][-2] == original
    with pytest.raises(ValueError, match='active or unresolved'):
        control.reserve_lease(ledger, quote(), 1, 0, NOW)
    assert ledger['leases'][-2] == original


def test_new_optimizer_window_and_concurrent_work_are_denied(evaluation_capacity):
    path, ledger, _, _, funding, _ = evaluation_capacity
    extension = record_extension(path, ledger)
    ledger['trainingWindows'].append({'reservedSeconds': 1})
    with pytest.raises(ValueError):
        control.effective_gpu_hour_capacity(ledger)
    ledger['trainingWindows'].pop()
    lease = control.reserve_lease(ledger, quote(), 3, 0, NOW)
    lease.update(status='active', instanceId='active', name='active')
    ledger['leases'].append(lease)
    assert lease['gpuHourCapacityAddendumHash'] == extension['contentHash']
    assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match='active or unresolved'):
        control.reserve_lease(ledger, quote(), 1, 0, NOW)


def test_extension_cannot_be_created_during_an_active_lease(evaluation_capacity):
    path, ledger, *_ = evaluation_capacity
    lease = control.reserve_lease(ledger, quote(), 3, 0, NOW)
    lease.update(status='active', instanceId='active', name='active')
    ledger['leases'].append(lease)
    control.atomic_json(path, ledger)
    with pytest.raises(ValueError, match='closed work'):
        record_extension(path, ledger)
    assert not control.gpu_hour_capacity_path(path, 2).exists()


def test_capacity_extension_still_enforces_finite_lease_and_money_limits(evaluation_capacity):
    path, ledger, _, _, funding, _ = evaluation_capacity
    record_extension(path, ledger)
    for hours, rate in ((8.01, 1.99), (8, 2)):
        with pytest.raises(ValueError, match='eight hours|approved rate'):
            control.reserve_lease(ledger, {**quote(), 'hourlyUsd': rate}, hours, 0, NOW)
    for index in range(4):
        lease = control.reserve_lease(ledger, quote(), 8, 4.776, NOW)
        lease.update(status='terminated', instanceId=f'next-{index}', name=f'next-{index}')
        ledger['leases'].append(lease)
    assert sum(row['reservedHours'] for row in ledger['leases']) == 155.5
    assert control.effective_gpu_hour_capacity(ledger)[0] == 160
    assert control.infrastructure_funding(ledger) == funding
    with pytest.raises(ValueError, match='lease count'):
        control.reserve_lease(ledger, quote(), 1, 0, NOW)


def test_actual_evaluation_reader_inventory_and_frozen_watchdog_accept_v2(evaluation_capacity, tmp_path):
    from acephale.training import validate_execution_lease
    path, ledger, _, _, funding, _ = evaluation_capacity
    extension = record_extension(path, ledger)
    lease = append_active(ledger, funding)
    control.atomic_json(path, ledger)
    preflight, output = tmp_path / 'preflight.json', tmp_path / 'evaluation.json'
    control.write_new(preflight, {'profile': 'acephale-evaluation-preflight-v1', 'leaseId': lease['id'],
        'instanceId': lease['instanceId'], 'studyBindingHash': ledger['planHash'], 'machineIdSha256': 'd' * 64,
        'providerReceiptSha256': 'e' * 64, 'actorStopped': True, 'gpuProcesses': 0, 'observedAt': NOW,
        'hardwareProfile': 'a100-40gb-v1', 'hardwareProfileHash': quote()['hardwareProfileHash']})
    before = path.read_bytes()
    with patch.object(control.time, 'time', return_value=NOW):
        receipt = control.evaluation_lease(path, lease['id'], preflight, output, 3600, source_probe=lambda _: 'b' * 40)
        state = control.watchdog_state(path, lease['id'])
    assert path.read_bytes() == before
    for action in ('diagnostic', 'export', 'evaluate'):
        assert validate_execution_lease(output, action=action, now=NOW + 1) == receipt
    assert receipt['budgetPolicy']['maxGpuHours'] == 64 and receipt['optimizerAllowed'] is False
    with pytest.raises(ValueError):
        validate_execution_lease(output, action='train', now=NOW + 1)
    with pytest.raises(ValueError, match='does not authorize optimizer'):
        control.training_lease(path, lease['id'], preflight, tmp_path / 'forbidden.json', 1)
    assert control.sha256(Path(watchdog.__file__)) == '5a389fe895b4b136469b07370fb525145d8a049d88f4daad600700d1b463bf97'
    assert control.sha256(Path(collect_inventory.__file__)) == '97ff350d272be815a045d6d7d9337a9fc4365803ac5400aa6bbc343c93cc86ee'
    assert watchdog.tick(state, Provider(state), NOW + 1)['terminationRequested'] is False
    assert watchdog.tick(state, Provider(state), state['deadline'])['reason'] == 'lease_deadline'
    with pytest.raises(ValueError):
        watchdog.select_instance(state, [{'id': 'different', 'name': state['expectedName']}])
    machine = tmp_path / 'host/etc/machine-id'
    machine.parent.mkdir(parents=True); machine.write_text('fixture-machine-id', encoding='utf-8')
    ssh = tmp_path / 'ssh.json'
    control.write_new(ssh, {'host': '192.0.2.1', 'port': 22, 'user': 'ubuntu',
        'hostKeySha256': 'SHA256:' + 'A' * 43, 'machineIdSha256': control.sha256(machine)})
    class ActualReceiptProvider:
        def request(self, method, endpoint):
            assert method == 'GET' and endpoint == '/instances/new-instance'
            return {'id': lease['instanceId'], 'name': lease['name'], 'status': 'active', 'ip': '192.0.2.1',
                'instance_type': {'name': quote()['instanceType']}}
    provider = tmp_path / 'provider.json'
    control.provider_receipt(ActualReceiptProvider(), path, lease['id'], ssh, provider)
    observed = control.read_json(provider)
    assert observed['infrastructureCapacityAuthorization']['contentHash'] == extension['contentHash']
    assert observed['infrastructureCapacityAuthorization']['engineeringMaximumGpuHours'] == 160
    assert observed['infrastructureCapacityAuthorization']['sha256'] == control.sha256(control.gpu_hour_capacity_path(path, 2))
    _, evidence = collect_inventory.lambda_identity(provider, tmp_path / 'host', control.hardware_profile('a100-40gb-v1'))
    assert evidence['identityReceipt'] == observed
