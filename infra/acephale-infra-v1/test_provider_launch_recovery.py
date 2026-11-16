"""Actual public launch, one POST, and bounded uncertainty recovery without cloud calls."""
import copy
import io
import json
import urllib.error

import provider_launch_recovery as recovery
import pytest
import test_control as base


@pytest.fixture
def scenario(monkeypatch):
    case = base.ControlTests()
    case.setUp()
    case.prepare()
    current = [case.now]
    monkeypatch.setattr(recovery.time, 'time', lambda: current[0])
    monkeypatch.setattr(recovery.time, 'sleep', lambda seconds: current.__setitem__(0, current[0] + seconds))
    case.clock = current
    case.attempted = False
    case.phases = []
    case.rows = []
    case.detail_change = lambda row: row
    case.post_delay = 30
    case.refresh_delay = 0
    case.cancelled = False
    case.post_error = recovery.UncertainProviderResponse('TimeoutError')
    original = case.client.request

    def request(method, path, payload=None):
        if path == '/instance-operations/launch':
            case.client.calls.append((method, path, copy.deepcopy(payload)))
            assert base.control.read_json(case.ledger)['leases'][0]['status'] == 'launching'
            case.attempted = True
            case.clock[0] += case.post_delay
            case.candidate = {'id': 'a' * 32, 'name': payload['name'], 'status': 'booting',
                'region': {'name': payload['region_name']},
                'instance_type': {'name': payload['instance_type_name']},
                'ssh_key_names': payload['ssh_key_names'], 'image': payload['image'],
                'firewall_rulesets': payload['firewall_rulesets'], 'jupyter_token': 'DO_NOT_PERSIST'}
            if case.post_error is not None:
                raise case.post_error
            return {'instance_ids': [case.candidate['id']]}
        if path == '/instances':
            case.client.calls.append((method, path, None))
            return case.rows if not case.attempted else case.matches(case.candidate)
        if path.startswith('/instances/'):
            case.client.calls.append((method, path, None))
            return case.detail_change(copy.deepcopy(case.candidate))
        return original(method, path, payload)

    case.client.request = request
    case.matches = lambda row: [copy.deepcopy(row)]

    def heartbeat(lease, phase, *, not_after, state, ledger_sha256):
        case.phases.append(phase)
        assert base.control.sha256(case.ledger) == ledger_sha256
        actual = base.control.watchdog_state(case.ledger, lease['id'])
        assert {**actual, 'ownerHeartbeatAt': 0} == state
        if phase != 'before_post':
            case.clock[0] += case.refresh_delay
        if case.clock[0] >= not_after:
            raise TimeoutError('State-read/publication guard expired before PUT')
        actual['ownerHeartbeatAt'] = case.clock[0]
        rows = [{'region': region, 'ownerHeartbeatAt': case.clock[0], 'stateHash': base.control.digest(actual)}
                for region in ('us-east-1', 'us-west-2')]
        return {'verified': True, 'phase': phase, 'leaseId': lease['id'], 'instanceId': lease['instanceId'],
            'status': lease['status'], 'deadline': lease['deadline'], 'setupDeadline': lease['setupDeadline'],
            'watchdogTimeoutSeconds': 120, 'publicationCompletedAt': case.clock[0], 'controllers': rows}

    case.heartbeat = heartbeat
    case.run = lambda: base.control.launch(case.client, case.ledger, case.prepared['id'], case.watchdog,
        now=case.now, budget=case.budget, reconciliation_heartbeat=case.heartbeat, cancelled=lambda: case.cancelled)
    yield case
    case.tearDown()


def test_actual_single_post_reconciles_accepted_instance_and_retains_failure(scenario):
    case = scenario
    before = copy.deepcopy(case.prepared)
    result = case.run()
    assert result['status'] == 'active' and result['instanceId'] == 'a' * 32
    assert result['launchFailure']['uncertaintyCategory'] == 'TimeoutError'
    assert result['launchRecovery']['postAttempts'] == 1
    assert case.phases == ['before_post', 'uncertain_response', 'before_accept']
    assert sum(method == 'POST' for method, _, _ in case.client.calls) == 1
    assert case.budget_calls.count('reserve') == 1
    for key in ('reservedUsd', 'reservedHours', 'deadline', 'setupDeadline', 'studyReservation'):
        assert result[key] == before[key]
    assert 'DO_NOT_PERSIST' not in case.ledger.read_text()
    assert result['launchRecovery']['listIdentity']['imageVerified'] is True


def test_successful_post_has_no_reconciliation_get_or_extra_publisher(scenario):
    scenario.post_error = None
    assert scenario.run()['status'] == 'active'
    assert scenario.phases == ['before_post']
    assert sum(path == '/instances' for _, path, _ in scenario.client.calls) == 1


def test_existing_exact_name_prevents_the_only_post(scenario):
    scenario.rows = [{'id': 'b' * 32, 'name': scenario.prepared['name']}]
    with pytest.raises(ValueError, match='already exists'):
        scenario.run()
    assert not scenario.attempted


@pytest.mark.parametrize('change', ['duplicate', 'old_id', 'region', 'type', 'key', 'image', 'firewall', 'unhealthy', 'terminal'])
def test_wrong_or_ambiguous_observable_identity_is_never_adopted(scenario, change):
    def candidates(row):
        value = copy.deepcopy(row)
        if change == 'duplicate':
            return [value, {**value, 'id': 'b' * 32}]
        if change == 'old_id':
            value['id'] = 'b' * 32
        elif change == 'region':
            value['region']['name'] = 'elsewhere'
        elif change == 'type':
            value['instance_type']['name'] = 'other-gpu'
        elif change == 'key':
            value['ssh_key_names'] = ['unrelated']
        elif change == 'image':
            value['image']['id'] = 'other-image'
        elif change == 'firewall':
            value['firewall_rulesets'] = [{'id': 'other-firewall'}]
        else:
            value['status'] = 'unhealthy' if change == 'unhealthy' else 'terminated'
        return [value]
    scenario.rows = [{'id': 'b' * 32, 'name': 'unrelated'}]
    scenario.matches = candidates
    with pytest.raises(ValueError):
        scenario.run()
    value = base.control.read_json(scenario.ledger)['leases'][0]
    assert value['status'] == 'launch_unknown' and value['instanceId'] is None
    assert value['launchFailure']['uncertaintyCategory'] == 'TimeoutError'
    assert sum(method == 'POST' for method, _, _ in scenario.client.calls) == 1


def test_absence_exhausts_bounded_get_window_without_post_retry(scenario):
    scenario.matches = lambda row: []
    with pytest.raises(TimeoutError, match='GET reconciliation'):
        scenario.run()
    assert scenario.clock[0] - scenario.now <= 100
    assert sum(method == 'POST' for method, _, _ in scenario.client.calls) == 1


def test_missing_optional_image_and_firewall_are_explicitly_unverified(scenario):
    def without_optional(row):
        return {key: value for key, value in row.items() if key not in ('image', 'firewall_rulesets')}
    scenario.matches = lambda row: [without_optional(row)]
    scenario.detail_change = without_optional
    result = scenario.run()['launchRecovery']
    assert result['listIdentity']['imageVerified'] is False
    assert result['detailIdentity']['firewallVerified'] is False


def test_detail_id_change_is_rejected(scenario):
    scenario.detail_change = lambda row: {**row, 'id': 'b' * 32}
    with pytest.raises(ValueError, match='detail changed'):
        scenario.run()


def test_two_seventy_second_publications_do_not_consume_sixty_second_get_budget(scenario):
    scenario.refresh_delay = 70
    result = scenario.run()['launchRecovery']
    assert result['completedAt'] - result['startedAt'] == 140
    assert result['getPollingSeconds'] == 0
    assert result['maximumReconciliationSeconds'] == 300


def test_old_heartbeat_gap_during_slow_refresh_rejects_before_gets(scenario):
    scenario.refresh_delay = 90
    with pytest.raises(TimeoutError, match='before PUT'):
        scenario.run()
    assert sum(path == '/instances' for _, path, _ in scenario.client.calls) == 1


@pytest.mark.parametrize('where', ['before_post', 'get', 'success_post'])
def test_cancellation_or_late_return_cannot_promote_instance(scenario, where):
    if where == 'before_post':
        scenario.cancelled = True
    elif where == 'get':
        def late(row):
            scenario.clock[0] = scenario.prepared['setupDeadline']
            return row
        scenario.detail_change = late
    else:
        scenario.post_error = None
        scenario.post_delay = 4000
    with pytest.raises((InterruptedError, TimeoutError)):
        scenario.run()
    value = base.control.read_json(scenario.ledger)['leases'][0]
    assert value['status'] != 'active'
    if where == 'success_post':
        assert value['instanceId'] == 'a' * 32


@pytest.mark.parametrize('failure,category', [
    (TimeoutError('SECRET'), 'TimeoutError'),
    (urllib.error.URLError('https://SECRET'), 'URLError'),
    (json.JSONDecodeError('SECRET', 'SECRET', 0), 'JSONDecodeError'),
    (OSError('SECRET'), 'OSError'),
])
def test_real_transport_retains_only_allowlisted_uncertainty_category(monkeypatch, failure, category):
    class Opener:
        def open(self, *args, **kwargs):
            assert kwargs['timeout'] == 30
            raise failure
    monkeypatch.setattr(base.control.urllib.request, 'build_opener', lambda *args: Opener())
    with pytest.raises(recovery.UncertainProviderResponse) as raised:
        base.control.LambdaClient('SECRET').request('POST', '/instance-operations/launch', {})
    assert raised.value.uncertainty_category == category
    assert 'SECRET' not in str(raised.value)


def test_real_transport_malformed_envelope_is_safely_classified(monkeypatch):
    class Response(io.BytesIO):
        pass
    class Opener:
        def open(self, *args, **kwargs):
            return Response(b'{"unrelated":"SECRET"}')
    monkeypatch.setattr(base.control.urllib.request, 'build_opener', lambda *args: Opener())
    with pytest.raises(recovery.UncertainProviderResponse) as raised:
        base.control.LambdaClient('test').request('POST', '/instance-operations/launch', {})
    assert raised.value.uncertainty_category == 'MalformedResponse'
