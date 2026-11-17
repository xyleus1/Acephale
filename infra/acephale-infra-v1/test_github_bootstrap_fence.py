"""Independent real funded prepare/launch and GHA bootstrap-fence composition.

Only temporary ledgers, synthetic HMAC credentials, and intercepted external
provider/GitHub/budget observations are used. Public admission is not mocked.
"""
import copy
from datetime import datetime, timezone

import control
import github_gpu_watchdog as worker
import github_watchdog_admission as admission
import github_watchdog_protocol as protocol
import pytest
import test_github_gpu_watchdog as github_fixture
import test_unresolved_launch as old_fixture
import unresolved_launch

KEY = github_fixture.KEY
SCOPE = {'purpose': 'cleanup_canary', 'recoveryControllerId': 'acephale-gha-a', 'maximumSeconds': 600}
MAIN = {'id': 42, 'full_name': 'owner/private-control', 'private': True}
FENCE = {'id': 43, 'full_name': 'owner/private-fence', 'private': True}


def signed_receipt(f, lease, *, fence, offset=0):
    b = github_fixture.binding()
    repository = FENCE if fence else MAIN
    b.update(repository=repository['full_name'], repositoryId=repository['id'])
    ledger = control.read_json(f.ledger)
    b['leaseIdentity'] = {'leaseId': lease['id'], 'expectedName': lease['name'], 'planHash': ledger['planHash'],
        **{k: lease[k] for k in ('reservedAt', 'setupDeadline', 'deadline')}}
    b['leasePolicy'] = protocol.lease_policy(lease)
    state = control.watchdog_payload(ledger, lease, lease['reservedAt'] if fence else f.now)
    owner = protocol.owner_record(b, state, 0, KEY)
    store = github_fixture.MemoryStore(b, owner)
    store.repository = b['repository']
    store.write_branch = b['stateBranch']
    jobs = []
    for i, row in enumerate(b['controllers']):
        identity = github_fixture.identity(b, i)
        identity.update(jobId=20 + offset + i, runnerId=30 + offset + i,
            jobStartedAt=f.now - 100, controllerExpiresAt=f.now - 100 + protocol.CONTROLLER_SECONDS,
            cleanupUntil=f.now - 100 + protocol.CLEANUP_SECONDS, observedAt=f.now)
        provider = github_fixture.Provider(state)
        provider.instance = None
        instance = worker.Worker(b, row['controllerId'], KEY, store, provider, identity,
            f.root / ('worker-' + str(offset) + '-' + str(i)), clock=lambda: f.now)
        instance.cycle()
        assert not any(call[0] == 'POST' for call in provider.calls)
        jobs.append({'id': identity['jobId'], 'run_id': identity['runId'], 'head_sha': b['workflowCommit'],
            'name': row['jobName'], 'status': 'in_progress', 'conclusion': None,
            'runner_id': identity['runnerId'], 'runner_name': identity['runnerName'],
            'started_at': datetime.fromtimestamp(identity['jobStartedAt'], timezone.utc).isoformat()})
    run = {'id': 10, 'run_attempt': 1, 'head_sha': b['workflowCommit'], 'path': b['workflowPath'],
        'event': 'workflow_dispatch', 'status': 'in_progress', 'conclusion': None,
        'repository': {'id': b['repositoryId']}}
    observation = {'kind': 'acephale-github-api-observation-v1', 'bindingHash': protocol.digest(b),
        'observedAt': f.now, 'repository': repository, 'run': run, 'jobs': jobs}
    def request(method, path, payload=None):
        assert method == 'GET' and payload is None
        if '/jobs?' in path:
            return {'total_count': 2, 'jobs': copy.deepcopy(jobs)}
        if '/actions/runs/' in path:
            return copy.deepcopy(run)
        assert path == '/'
        return dict(repository)
    store.request = request
    data = {'version': 1, 'backend': protocol.BACKEND, 'binding': protocol.seal(b, KEY),
        'ownerRecord': owner, 'apiObservation': protocol.seal(observation, KEY),
        'controllers': [store.read(row['evidenceBranch'], protocol.ACK_PATH)[0] for row in b['controllers']]}
    return data, store


@pytest.fixture
def case(monkeypatch):
    f = old_fixture.FenceTests('runTest')
    f.setUp()
    f.now = f.prior['deadline'] + 200
    monkeypatch.setattr(control.time, 'time', lambda: f.now)
    monkeypatch.setenv('ACEPHALE_WATCHDOG_HMAC_KEY', KEY)
    f.ready, f.store = signed_receipt(f, f.prior, fence=True)
    ledger = control.read_json(f.ledger)
    binding = protocol.unseal(f.ready['binding'], KEY)
    predecessor = {'id': f.prior['id'], 'name': f.prior['name'], 'leaseHash': control.digest(f.prior)}
    migration = {'kind': 'acephale-github-bootstrap-fence-migration-v1',
        'cleanupCanariesOnly': True, 'historicalRecoveryQualified': False,
        'predecessor': predecessor, 'planHash': ledger['planHash'],
        'financialBindingHash': control._financial_binding_hash(ledger),
        'previousControllers': [{'controllerId': r['controllerId'], 'hostId': r['hostId']}
                                for r in f.prior['watchdogs']],
        'newBindingHash': protocol.digest(binding), 'originalControllerHistoryPreserved': True,
        'originalLeaseUnchanged': True, 'financialHoldsRetained': True,
        'authorizedAt': f.now, 'reason': 'Test-only unqualified cleanup canary bootstrap'}
    values = admission.enrollments(f.ready, ledger, f.prior, f.now, binding['sourceFiles'],
                                  key=KEY, fence=True, bootstrap=True)
    expired_state = protocol.check_owner(f.ready['ownerRecord'], KEY, binding)['state']
    f.gha_fence = reseal({'version': 1, 'profile': 'acephale-github-bootstrap-canary-fence-v1',
        'cleanupCanariesOnly': True, 'historicalRecoveryQualified': False,
        'planHash': ledger['planHash'], 'financialBindingHash': control._financial_binding_hash(ledger),
        'predecessor': predecessor, 'observedAt': f.now, 'expiresAt': f.now + 60,
        'financialBindingChanged': False, 'predecessorReservationRetained': True,
        'backendReceipt': f.ready, 'backendMigration': protocol.seal(migration, KEY),
        'controllers': [{'enrollment': v, 'state': expired_state} for v in values]})
    unresolved_launch.checked_fence(ledger, f.gha_fence, f.now, successor_policy=SCOPE)
    f.gha_path = f.root / 'bootstrap-fence.json'
    control.write_new(f.gha_path, f.gha_fence)
    f.initial_ledger_bytes = f.ledger.read_bytes()
    f.initial_calls = list(f.client.calls)
    f.initial_reservations = f.budget_calls.count('reserve')
    try:
        yield f
    finally:
        f.tearDown()


def reseal(value):
    value['contentHash'] = control.digest({k: v for k, v in value.items() if k != 'contentHash'})
    return value


def prepare(f, **kwargs):
    return control.prepare_lease(f.client, f.ledger, 1 / 6, 0, now=f.now, budget=f.budget,
        unresolved_fence=f.gha_path, setup_seconds=600, **kwargs)


def assert_no_new_post(f):
    assert not any(c[0] == 'POST' for c in f.client.calls[len(f.initial_calls):])


def test_actual_prepare_preserves_old_row_hold_and_no_qualification(case):
    f = case
    assert f.gha_fence['cleanupCanariesOnly'] is True
    assert f.gha_fence['historicalRecoveryQualified'] is False
    assert 'qualification' not in f.gha_fence['backendReceipt']
    assert all(row['enrollment']['recoveryTestPassed'] is False for row in f.gha_fence['controllers'])
    lease = prepare(f, purpose='cleanup_canary', recovery_controller_id='acephale-gha-a')
    actual = control.checked_bound_ledger(f.ledger)
    assert actual['leases'][0] == f.prior
    assert lease['purpose'] == 'cleanup_canary' and lease['deadline'] - lease['reservedAt'] <= 600
    assert lease['studyReservation'] and f.budget_calls.count('reserve') == f.initial_reservations + 1
    assert_no_new_post(f)


@pytest.mark.parametrize('kwargs', [{}, {'purpose': 'research'},
    {'purpose': 'research', 'recovery_controller_id': 'acephale-gha-a'}])
def test_actual_prepare_never_uses_bootstrap_for_research(case, kwargs):
    with pytest.raises(ValueError, match='cleanup canar'):
        prepare(case, **kwargs)
    assert case.ledger.read_bytes() == case.initial_ledger_bytes
    assert case.budget_calls.count('reserve') == case.initial_reservations
    assert_no_new_post(case)


def test_actual_public_launch_uses_funded_canary_scope_and_disjoint_real_jobs(case):
    f = case
    lease = prepare(f, purpose='cleanup_canary', recovery_controller_id='acephale-gha-a')
    receipt, _ = signed_receipt(f, lease, fence=False, offset=100)
    enrollment = f.root / 'actual-canary-enrollment.json'
    control.write_new(enrollment, receipt)
    result = control.launch(f.client, f.ledger, lease['id'], enrollment, now=f.now, budget=f.budget,
        unresolved_fence=f.gha_path)
    assert result['status'] == 'active'
    assert control.read_json(f.ledger)['leases'][0] == f.prior
    posts = [c for c in f.client.calls[len(f.initial_calls):] if c[0] == 'POST']
    assert len(posts) == 1 and posts[0][1] == '/instance-operations/launch'
    assert f.budget_calls.count('reserve') == f.initial_reservations + 1


def test_actual_public_launch_rejects_research_even_with_bootstrap_fence(case):
    f = case
    lease = prepare(f, purpose='cleanup_canary', recovery_controller_id='acephale-gha-a')
    ledger = control.read_json(f.ledger)
    ledger['leases'][1].update(purpose='research', recoveryControllerId=None)
    control.atomic_json(f.ledger, ledger)
    before = f.ledger.read_bytes()
    with pytest.raises(ValueError, match='cleanup canar'):
        control.launch(f.client, f.ledger, lease['id'], f.root / 'unused-enrollment.json',
            now=f.now, budget=f.budget, unresolved_fence=f.gha_path)
    assert f.ledger.read_bytes() == before
    assert f.budget_calls.count('reserve') == f.initial_reservations + 1
    assert_no_new_post(f)


@pytest.mark.parametrize('maximum', [601, True, float('nan')])
def test_bootstrap_scope_requires_finite_at_most_six_hundred_seconds(case, maximum):
    with pytest.raises(ValueError, match='cleanup canar'):
        unresolved_launch.checked_fence(control.read_json(case.ledger), case.gha_fence, case.now,
            successor_policy={**SCOPE, 'maximumSeconds': maximum})
    assert case.ledger.read_bytes() == case.initial_ledger_bytes
    assert_no_new_post(case)


@pytest.mark.parametrize('field,value', [('purpose', 'research'), ('studyReservation', None),
    ('instanceId', 'unexpected'), ('status', 'launching')])
def test_dispatch_scope_comes_from_actual_funded_row_not_fence_claim(case, field, value):
    f = case
    lease = prepare(f, purpose='cleanup_canary', recovery_controller_id='acephale-gha-a')
    ledger = control.read_json(f.ledger)
    ledger['leases'][1][field] = value
    # Direct typed reader must ignore a contradictory caller assertion once a
    # current funded row exists; public launch additionally validates the ledger.
    with pytest.raises(ValueError):
        unresolved_launch.checked_fence(ledger, f.gha_fence, f.now,
            current_lease_id=lease['id'], successor_policy=SCOPE)
    assert_no_new_post(f)


@pytest.mark.parametrize('mutation', ['stale', 'future', 'old-hold', 'old-controller', 'false-qualified',
    'recovery-smuggled', 'wrong-source', 'wrong-job', 'wrong-runner', 'cancelled-job', 'not-absent', 'two-same-jobs'])
def test_resealed_invalid_bootstrap_evidence_fails_closed(case, mutation):
    f = case
    value = copy.deepcopy(f.gha_fence)
    ledger = control.read_json(f.ledger)
    if mutation == 'stale':
        now = f.now + 61
    else:
        now = f.now
    if mutation == 'future':
        value['observedAt'] = f.now + 1
    elif mutation == 'old-hold':
        ledger['leases'][0]['studyReservation']['reservationId'] = 'different-hold'
    elif mutation in ('old-controller', 'false-qualified'):
        body = protocol.unseal(value['backendMigration'], KEY)
        if mutation == 'old-controller':
            body['previousControllers'][0]['hostId'] = 'different-host'
        else:
            body['historicalRecoveryQualified'] = True
        value['backendMigration'] = protocol.seal(body, KEY)
    elif mutation == 'recovery-smuggled':
        value['backendReceipt']['qualification'] = {}
    elif mutation == 'wrong-source':
        body = protocol.unseal(value['backendReceipt']['binding'], KEY)
        body['sourceFiles']['github_gpu_watchdog.py'] = 'f' * 64
        value['backendReceipt']['binding'] = protocol.seal(body, KEY)
    elif mutation in ('wrong-job', 'wrong-runner', 'cancelled-job', 'two-same-jobs'):
        body = protocol.unseal(value['backendReceipt']['apiObservation'], KEY)
        if mutation == 'wrong-job':
            body['jobs'][0]['id'] += 1
        elif mutation == 'wrong-runner':
            body['jobs'][0]['runner_id'] += 1
        elif mutation == 'cancelled-job':
            body['jobs'][0].update(status='completed', conclusion='cancelled')
        else:
            body['jobs'][1] = copy.deepcopy(body['jobs'][0])
        value['backendReceipt']['apiObservation'] = protocol.seal(body, KEY)
    elif mutation == 'not-absent':
        body = protocol.unseal(value['backendReceipt']['controllers'][0], KEY)
        body['observed']['observedStatus'] = 'active'
        value['backendReceipt']['controllers'][0] = protocol.seal(body, KEY)
    with pytest.raises((ValueError, KeyError)):
        unresolved_launch.checked_fence(ledger, reseal(value), now, successor_policy=SCOPE)
    assert case.ledger.read_bytes() == case.initial_ledger_bytes
    assert_no_new_post(f)


@pytest.mark.parametrize('key', ['repositoryId', 'jobId', 'runnerId'])
def test_logical_labels_only_may_repeat_not_actual_controller_identity(case, key):
    prior = [row['enrollment'] for row in case.gha_fence['controllers']]
    successor = copy.deepcopy(prior)
    for i, row in enumerate(successor):
        row['hostId'] += '-new'
        row['identity'].update(repositoryId=MAIN['id'], jobId=120 + i, runnerId=130 + i)
    unresolved_launch.check_new_controllers(case.gha_fence, successor)
    successor[0]['identity'][key] = prior[0]['identity'][key]
    with pytest.raises(ValueError, match='separate dedicated'):
        unresolved_launch.check_new_controllers(case.gha_fence, successor)
