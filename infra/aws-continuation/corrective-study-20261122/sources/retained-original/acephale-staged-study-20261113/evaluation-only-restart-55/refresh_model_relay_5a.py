"""Refresh one exact lease-owned model relay after container recreation.

No provider, budget, actor-relay, CPU-relay or source mutation. Invoke only through
the leased host's bounded owner; ordinary failures remain available for repair.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request
import uuid

BASE = Path('/REQUIRED_BINDINGS/research-root')
EXPECTED_SOURCE = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
PROJECT = 'acephale-infra-v1'
BASE_MODELS = {'actor': 'Qwen/Qwen3.5-9B', 'predictor': 'Qwen/Qwen3.5-0.8B'}
PORTS = {'actor': 8000, 'predictor': 8001}
SHA = re.compile(r'[a-f0-9]{64}\Z')
LEASE = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z')
PROPERTIES = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ExecStart',
              'ControlGroup', 'User', 'Group', 'KillMode', 'Restart', 'Transient', 'RuntimeMaxUSec')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Regular receipt required')
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def checked(argv, *, timeout=15, allow_failure=False):
    environment = {key: value for key, value in os.environ.items() if key not in {
        'OPENAI_API_KEY', 'LAMBDA_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'DOCKER_HOST', 'DOCKER_CONTEXT'}}
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=environment, check=False)
    require(allow_failure or result.returncode == 0, 'Bounded local relay command failed')
    return result.stdout.strip()


def arguments(row):
    return ['/usr/bin/socat',
            f"TCP4-LISTEN:{row['listenPort']},bind=127.0.0.1,reuseaddr,fork",
            f"TCP4:{row['address']}:8000"]


def validate_row(row, lease_id, role):
    prefix = 'acephale-' + lease_id.split('-')[0] + '-' + role + '-relay'
    require(row.get('service') == role and row.get('mode') in ('systemd-socat-loopback', 'docker-loopback')
            and row.get('listenAddress') == '127.0.0.1' and row.get('listenPort') == PORTS[role]
            and row.get('targetPort') == 8000 and SHA.fullmatch(row.get('containerId', '')),
            'Exact recorded lease-owned model relay required')
    if row['mode'] == 'docker-loopback':
        require(row.get('pid') is None and row.get('unit') is None, 'Docker publication has no invented relay process')
    else:
        require(type(row.get('pid')) is int and row['pid'] > 0
            and re.fullmatch(re.escape(prefix) + r'(?:-r[a-f0-9]{12})?', row.get('unit', '')),
            'Exact recorded lease-owned systemd relay required')
    address = ipaddress.ip_address(row['address'])
    require(address.version == 4 and address.is_private and not address.is_loopback,
            'Recorded target must be a private container IPv4 address')


def unit_state(unit):
    output = checked(['systemctl', 'show', unit + '.service',
                      '--property=' + ','.join(PROPERTIES)], allow_failure=True)
    result = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        require(separator and key in PROPERTIES and key not in result, 'Unexpected systemd observation')
        result[key] = value
    return result


def runtime_seconds(value):
    # systemctl show renders RuntimeMaxUSec as a systemd time span.
    units = {'h': 3600, 'min': 60, 's': 1, 'ms': .001, 'us': .000001, 'µs': .000001}
    tokens = value.split()
    require(bool(tokens), 'Missing bounded unit runtime')
    total = 0.0
    for token in tokens:
        match = re.fullmatch(r'(\d+(?:\.\d+)?)(h|min|s|ms|us|µs)', token)
        require(match is not None, 'Unrecognized or unlimited unit runtime')
        total += float(match[1]) * units[match[2]]
    return total


def verify_unit(row, binary_hash, *, expected_pid=None, require_running=True):
    if row.get('mode') == 'docker-loopback':
        observed = container(row['service'], row['containerId'])
        require(observed['address'] == row['address'] and observed['publicationMode'] == 'docker-loopback'
            and expected_pid is None and row.get('pid') is None and row.get('unit') is None,
            'Actual Docker loopback publication differs from its receipt')
        return {'mode': 'docker-loopback', 'containerId': row['containerId']}
    state = unit_state(row['unit'])
    require(state.get('Id') == row['unit'] + '.service' and state.get('LoadState') == 'loaded'
            and state.get('Transient') == 'yes' and state.get('User') == 'ubuntu'
            and state.get('Group') == 'ubuntu' and state.get('KillMode') == 'control-group'
            and state.get('Restart') == 'no', 'Recorded unit ownership or isolation changed')
    expected = arguments(row)
    command = state.get('ExecStart', '')
    # Require one literal executable/argv record, without a second command.
    match = re.fullmatch(r'\{ path=([^;]+) ; argv\[\]=([^;]+) ; ignore_errors=no ; [^{}]*\}', command)
    require(match is not None and match[1] == expected[0] and match[2].split() == expected,
            'Recorded systemd ExecStart changed')
    pid = int(state.get('MainPID', '0'))
    if require_running:
        require(state.get('ActiveState') == 'active' and state.get('SubState') == 'running'
                and pid > 0 and (expected_pid is None or pid == expected_pid), 'Recorded relay PID is no longer current')
    if pid > 0:
        proc = Path('/proc') / str(pid)
        actual_argv = (proc / 'cmdline').read_bytes().split(b'\0')
        require([value.decode('utf-8') for value in actual_argv if value] == expected,
                'Observed process argv differs from the owned relay')
        # The installed Ubuntu package uses /usr/bin/socat -> socat1.
        # Compare canonical targets and actual file identity, retaining the
        # receipt's content hash; a pathname alias alone is not ownership.
        executable = proc / 'exe'
        expected_binary = Path('/usr/bin/socat')
        observation = {'expectedSha256': binary_hash}
        try:
            expected_target = expected_binary.resolve(strict=True)
            actual_target = executable.resolve(strict=True)
            observation.update(expectedPath=str(expected_target), actualPath=str(actual_target))
            expected_identity = expected_binary.stat()
            actual_identity = executable.stat()
            observation.update(sameFile=executable.samefile(expected_binary),
                               expectedSha256Observed=sha(expected_binary),
                               actualSha256Observed=sha(executable))
            valid = (actual_target == expected_target and observation['sameFile']
                     and observation['expectedSha256Observed'] == binary_hash
                     and observation['actualSha256Observed'] == binary_hash
                     and (actual_identity.st_dev, actual_identity.st_ino)
                         == (expected_identity.st_dev, expected_identity.st_ino)
                     and executable.samefile(expected_binary)
                     and (expected_binary.stat().st_dev, expected_binary.stat().st_ino)
                         == (expected_identity.st_dev, expected_identity.st_ino))
        except (OSError, RuntimeError) as error:
            observation['observationError'] = type(error).__name__
            valid = False
        require(valid, 'Observed relay executable identity mismatch: '
                + json.dumps(observation, sort_keys=True))
        group = '/system.slice/' + row['unit'] + '.service'
        require(state.get('ControlGroup') == group
                and any(line.split(':', 2)[-1] == group for line in (proc / 'cgroup').read_text().splitlines()),
                'Observed relay process belongs to another control group')
    return state


def stop_owned(row, binary_hash, *, original_pid=None):
    require(row.get('mode') == 'systemd-socat-loopback', 'Only an owned socat relay can be stopped')
    verify_unit(row, binary_hash, expected_pid=original_pid)
    checked(['sudo', '-n', 'systemctl', 'stop', row['unit'] + '.service'], timeout=20)
    state = unit_state(row['unit'])
    require(state.get('LoadState') == 'not-found'
            or (state.get('MainPID') == '0' and state.get('ActiveState') in ('inactive', 'failed')),
            'Owned relay process group did not stop')
    listeners = checked(['ss', '-H', '-ltn', f"sport = :{row['listenPort']}"])
    require(not listeners, 'Model listener remains occupied after owned relay drain')


def container(role, identifier):
    rows = json.loads(checked(['docker', 'inspect', identifier]))
    require(len(rows) == 1, 'One exact model container required')
    row = rows[0]
    labels = row.get('Config', {}).get('Labels', {})
    network = row.get('NetworkSettings', {}).get('Networks', {}).get(PROJECT + '_research', {})
    address = ipaddress.ip_address(network.get('IPAddress', ''))
    require(row.get('Id') == identifier and row.get('Name') == '/' + PROJECT + '-' + role + '-1'
            and row.get('State', {}).get('Running') is True
            and labels.get('com.docker.compose.project') == PROJECT
            and labels.get('com.docker.compose.service') == role
            and address.version == 4 and address.is_private and not address.is_loopback,
            'Expected running task-owned model container')
    published = row.get('NetworkSettings', {}).get('Ports', {}).get('8000/tcp')
    require(not published or published == [{'HostIp': '127.0.0.1', 'HostPort': str(PORTS[role])}],
            'Model publication must be the exact owned IPv4 loopback port')
    return {'containerId': identifier, 'address': str(address), 'startedAt': row['State']['StartedAt'],
            'imageId': row['Image'], 'publicationMode': 'docker-loopback' if published else 'systemd-socat-loopback',
            'commandHash': hashlib.sha256(json.dumps(row['Config']['Cmd'],
                separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()}


def http(port, path):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise ValueError('Model relay redirects are forbidden')
    with urllib.request.build_opener(NoRedirect).open(f'http://127.0.0.1:{port}{path}', timeout=3) as response:
        require(response.status == 200, 'Model relay health request failed')
        body = response.read(65537)
        require(len(body) <= 65536, 'Model relay response exceeds diagnostic bound')
        return body


def load_receipts(config, initial_path, initial_sha, prior_path=None, prior_sha=None):
    require(SHA.fullmatch(initial_sha or '') and sha(initial_path) == initial_sha,
            'Original externally verified relay receipt hash differs')
    initial = read(initial_path)
    require(initial.get('schemaVersion') == 1 and initial.get('leaseId') == config['leaseId']
            and initial.get('deadline') == config['hardDeadline'] and SHA.fullmatch(initial.get('socatSha256', '')),
            'Initial relay receipt differs from the original lease')
    require(bool(prior_path) == bool(prior_sha), 'Prior receipt requires its independently retained hash')
    current = initial
    if prior_path:
        require(SHA.fullmatch(prior_sha) and sha(prior_path) == prior_sha, 'Prior relay receipt hash differs')
        current = read(prior_path)
        require(current.get('schemaVersion') == 2 and current.get('refreshPassed') is True
                and current.get('initialReceiptSha256') == initial_sha
                and all(current.get(key) == initial[key] for key in ('leaseId', 'deadline', 'socatSha256')),
                'Prior relay receipt lineage differs')
    for value in (initial, current):
        require(len(value.get('relays', [])) == 5
                and {row.get('service') for row in value['relays']} == {'actor', 'predictor', 'alloy', 'prometheus', 'grafana'},
                'Complete unique original relay inventory required')
        for role in PORTS:
            validate_row(next(row for row in value['relays'] if row['service'] == role), config['leaseId'], role)
    original_cpu = [row for row in initial['relays'] if row['service'] not in PORTS]
    current_cpu = [row for row in current['relays'] if row['service'] not in PORTS]
    require(original_cpu == current_cpu, 'CPU relay records may not be changed by this helper')
    require(next(row for row in initial['relays'] if row['service'] == 'actor')
        == next(row for row in current['relays'] if row['service'] == 'actor'), 'Actor relay may not be changed by predictor refresh')
    return initial, current, prior_sha or initial_sha


def refresh(config, initial_path, initial_sha, role, identifier, models, output, *, prior_path=None, prior_sha=None):
    require(os.getuid() != 0 and config.get('sourceCommit') == EXPECTED_SOURCE
            and LEASE.fullmatch(config.get('leaseId', '')) and SHA.fullmatch(identifier)
            and role == 'predictor', 'Exact source, lease, ordinary operator and predictor identity required')
    require(config.get('relayRefreshOperatorSha256') == sha(__file__), 'Reviewed relay helper bytes changed')
    deadline = config.get('hardDeadline')
    require(type(deadline) in (int, float) and math.isfinite(deadline) and time.time() + 90 < deadline <= time.time() + 8 * 3600,
            'Original active provider deadline must leave a bounded refresh window')
    source = Path(config['sourceDirectory'])
    require(source == BASE / 'training-source-5a36a8b3', 'Explicit existing final5a serving checkout required')
    require(checked(['git', '-C', str(source), 'rev-parse', 'HEAD']) == EXPECTED_SOURCE
            and not checked(['git', '-C', str(source), 'status', '--porcelain=v1', '--untracked-files=normal']),
            'Frozen clean source required')
    provider = read(BASE / 'provider-receipt.json')
    require(provider.get('leaseId') == config['leaseId'] and provider.get('instance', {}).get('id') == config.get('instanceId')
            and bool(config.get('instanceId')), 'Exact provider receipt association required')
    require(len(models) == len(set(models)) and BASE_MODELS[role] in models
            and ((role == 'actor' and len(models) == 1)
                 or (role == 'predictor' and len(models) in (1, 2)
                     and all(model == BASE_MODELS[role] or re.fullmatch(r'acephale-predictor-[a-f0-9]{12}', model) for model in models))),
            'Expected exact pinned base plus optional declared predictor alias')
    initial, current, prior_hash = load_receipts(config, initial_path, initial_sha, prior_path, prior_sha)
    binary_hash = initial['socatSha256']
    require(sha('/usr/bin/socat') == binary_hash, 'Resident socat differs from initial relay receipt')
    old = next(row for row in current['relays'] if row['service'] == role)
    observed = container(role, identifier)
    require(observed['publicationMode'] == old['mode'], 'Publication mechanism cannot silently change during a seed refresh')
    actor = next(row for row in current['relays'] if row['service'] == 'actor')
    verify_unit(actor, binary_hash, expected_pid=actor['pid'])
    if old['mode'] == 'docker-loopback':
        output.mkdir(parents=True, exist_ok=False)
        write(output / 'refresh-plan.json', {'leaseId': config['leaseId'], 'deadline': deadline,
            'sourceCommit': EXPECTED_SOURCE, 'initialReceiptSha256': initial_sha, 'priorReceiptSha256': prior_hash,
            'role': role, 'oldRelay': old, 'observedModelContainer': observed, 'expectedModels': models,
            'operatorSha256': sha(__file__), 'mechanism': 'docker_loopback_validation', 'relayMutation': False})
        http(PORTS[role], '/health')
        catalog = json.loads(http(PORTS[role], '/v1/models'))
        actual = [row['id'] for row in catalog.get('data', [])]
        require(len(actual) == len(models) and set(actual) == set(models), 'Actual model catalog differs from expected base and alias')
        new = {**old, 'containerId': identifier, 'address': observed['address']}
        require(container(role, identifier) == observed, 'Model container changed during endpoint verification')
        verify_unit(new, binary_hash)
        verify_unit(actor, binary_hash, expected_pid=actor['pid'])
        result = {'schemaVersion': 2, 'kind': 'acephale-model-relay-refresh', 'refreshPassed': True,
            'leaseId': config['leaseId'], 'deadline': deadline, 'observedAt': time.time(),
            'sourceCommit': EXPECTED_SOURCE, 'socatSha256': binary_hash, 'initialReceiptSha256': initial_sha,
            'priorReceiptSha256': prior_hash, 'refreshedRole': role, 'originalDeadlinePreserved': True,
            'modelContainer': observed, 'modelCatalog': catalog, 'refreshMechanism': 'docker_loopback_validation',
            'relayMutation': False, 'relays': [new if row['service'] == role else row for row in current['relays']],
            'nativeModelQualityQualified': False}
        write(output / 'relay-receipt.json', result)
        return result
    verify_unit(old, binary_hash, expected_pid=old['pid'])
    output.mkdir(parents=True, exist_ok=False)
    unit = 'acephale-' + config['leaseId'].split('-')[0] + '-' + role + '-relay-r' + uuid.uuid4().hex[:12]
    new = {**old, 'containerId': identifier, 'address': observed['address'], 'unit': unit, 'pid': None}
    write(output / 'refresh-plan.json', {'leaseId': config['leaseId'], 'deadline': deadline,
        'sourceCommit': EXPECTED_SOURCE, 'initialReceiptSha256': initial_sha, 'priorReceiptSha256': prior_hash,
        'role': role, 'oldRelay': old, 'newUnit': unit, 'observedModelContainer': observed,
        'expectedModels': models, 'operatorSha256': sha(__file__)})
    require(unit_state(unit).get('LoadState') == 'not-found', 'New task-owned unit name is already occupied')
    stop_owned(old, binary_hash, original_pid=old['pid'])
    launched = False
    try:
        remaining = int(deadline - time.time()) - 25
        require(remaining > 30, 'Original deadline is too near for refresh')
        launched = True
        checked(['sudo', '-n', 'systemd-run', '--unit=' + unit,
            '--property=User=ubuntu', '--property=Group=ubuntu', '--property=NoNewPrivileges=true',
            '--property=PrivateTmp=true', '--property=ProtectSystem=strict', '--property=ProtectHome=true',
            '--property=RuntimeMaxSec=' + str(remaining), '--property=Restart=no', '--property=MemoryMax=128M',
            '--property=TasksMax=64', '--property=KillMode=control-group', *arguments(new)], timeout=20)
        state = verify_unit(new, binary_hash)
        new['pid'] = int(state['MainPID'])
        require(runtime_seconds(state['RuntimeMaxUSec']) == remaining and time.time() + remaining <= deadline,
                'Replacement relay would extend the original absolute deadline')
        require(container(role, identifier) == observed, 'Model container changed while refreshing relay')
        http(PORTS[role], '/health')
        catalog = json.loads(http(PORTS[role], '/v1/models'))
        actual = [row['id'] for row in catalog.get('data', [])]
        require(len(actual) == len(models) and set(actual) == set(models), 'Actual model catalog differs from expected base and alias')
        require(container(role, identifier) == observed, 'Model container changed during endpoint verification')
        verify_unit(new, binary_hash, expected_pid=new['pid'])
        verify_unit(actor, binary_hash, expected_pid=actor['pid'])
        result = {'schemaVersion': 2, 'kind': 'acephale-model-relay-refresh', 'refreshPassed': True,
            'leaseId': config['leaseId'], 'deadline': deadline, 'observedAt': time.time(),
            'sourceCommit': EXPECTED_SOURCE, 'socatSha256': binary_hash, 'initialReceiptSha256': initial_sha,
            'priorReceiptSha256': prior_hash, 'refreshedRole': role, 'originalDeadlinePreserved': True,
            'modelContainer': observed, 'unitRuntimeSeconds': remaining, 'modelCatalog': catalog,
            'relays': [new if row['service'] == role else row for row in current['relays']],
            'nativeModelQualityQualified': False}
        write(output / 'relay-receipt.json', result)
        return result
    except BaseException as error:
        cleanup = 'not_launched'
        if launched:
            try:
                state = unit_state(unit)
                if state.get('LoadState') == 'not-found':
                    cleanup = 'absent'
                else:
                    # Never stop an unexpected unit or process, even during recovery.
                    verify_unit(new, binary_hash, require_running=False)
                    checked(['sudo', '-n', 'systemctl', 'stop', unit + '.service'], timeout=20)
                    after = unit_state(unit)
                    require(after.get('LoadState') == 'not-found' or (after.get('MainPID') == '0'
                        and after.get('ActiveState') in ('inactive', 'failed')), 'Replacement relay cleanup unresolved')
                    cleanup = 'verified_stopped'
            except BaseException as cleanup_error:
                cleanup = 'unresolved_' + type(cleanup_error).__name__
        write(output / 'refresh-failure.json', {'leaseId': config['leaseId'], 'role': role,
            'errorType': type(error).__name__, 'replacementCleanup': cleanup,
            'originalRelayStopped': True, 'newUnit': unit, 'refreshPassed': False,
            'requiresProviderOwnerRecovery': True})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configuration', type=Path, required=True)
    parser.add_argument('--initial-receipt', type=Path, required=True)
    parser.add_argument('--initial-sha256', required=True)
    parser.add_argument('--prior-receipt', type=Path)
    parser.add_argument('--prior-sha256')
    parser.add_argument('--role', choices=('predictor',), required=True)
    parser.add_argument('--container-id', required=True)
    parser.add_argument('--expected-model', action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    def interrupted(_signal, _frame):
        raise InterruptedError('Bounded relay refresh interrupted')
    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
        signal.signal(name, interrupted)
    signal.setitimer(signal.ITIMER_REAL, 90)
    try:
        result = refresh(read(args.configuration), args.initial_receipt, args.initial_sha256, args.role,
            args.container_id, args.expected_model, args.output, prior_path=args.prior_receipt, prior_sha=args.prior_sha256)
        print(json.dumps({'refreshPassed': True, 'role': args.role, 'receiptSha256': sha(args.output / 'relay-receipt.json'),
                          'deadline': result['deadline']}))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


if __name__ == '__main__':
    main()
