"""Prospective local transport for the unchanged public serving-proof guard.

The native manifest and probe checks remain public APIs. No SSH key, provider
mutation, model restart or qualification fabrication is permitted here.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

SOURCE_COMMIT = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
TRANSPORT = 'same_host_owned_loopback_relays_v1'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def require(value, message):
    if not value:
        raise ValueError(message)


def public_api(source):
    source = Path(source).resolve()
    require(subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True, timeout=5).strip() == SOURCE_COMMIT,
            'Exact prospective guard source required')
    require(not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain=v1'], text=True, timeout=5).strip(),
            'Clean prospective guard source required')
    package = source / 'research/acephale/src'
    require(not any(name == 'acephale' or name.startswith('acephale.') for name in sys.modules),
            'Fresh source-bound Python process required')
    sys.path.insert(0, str(package))
    from acephale import infra_split_guard
    return infra_split_guard


def local_probe_factory(api, config, provenance, *, popen=subprocess.Popen, python=sys.executable):
    """Only replace the public SSH transport; retain its exact nonce protocol."""
    expected = api.persistent_probe_command(config, provenance)
    code = api.persistent_probe_script(provenance)
    def launch(argv, **options):
        require(argv == expected, 'Unexpected public guard transport command')
        environment = {key: value for key, value in os.environ.items() if key not in {
            'DOCKER_HOST', 'DOCKER_CONTEXT', 'OPENAI_API_KEY', 'LAMBDA_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'}}
        options.pop('creationflags', None)
        # The workstation-owned host supervisor creates one process group for
        # this guard and its probe. Its final group drain also covers Docker CLI
        # descendants after either Python leader exits.
        return popen([python, '-I', '-u', '-c', code], **options, env=environment, start_new_session=False)
    return launch


def drain_group(process):
    """Close the complete local probe group, including an exited leader's child."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=2)


def relay_validator(configuration, provenance):
    """Use the already reviewed relay ownership checks, never mutate a unit."""
    path = Path(configuration['relayHelperPath'])
    require(sha(path) == configuration['relayHelperSha256'], 'Reviewed relay validator bytes differ')
    spec = importlib.util.spec_from_file_location('replay_relay_validation', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    initial, current, _ = helper.load_receipts(configuration,
        Path(configuration['initialRelayReceiptPath']), configuration['initialRelayReceiptSha256'],
        Path(configuration['currentRelayReceiptPath']) if configuration.get('currentRelayReceiptPath') else None,
        configuration.get('currentRelayReceiptSha256'))
    rows = {row['service']: row for row in current['relays']}
    for role in ('actor', 'predictor'):
        require(rows[role]['containerId'] == provenance['servingContainers'][role]['id'],
                'Current model relay points at a different qualified container')
    require(sha('/usr/bin/socat') == initial['socatSha256'], 'Relay executable differs')
    def check():
        for role in ('actor', 'predictor'):
            helper.verify_unit(rows[role], initial['socatSha256'], expected_pid=rows[role]['pid'])
            observed = helper.container(role, rows[role]['containerId'])
            require(observed['address'] == rows[role]['address'], 'Relay target changed after qualification')
    return check


from aws_replay_provider import validate_provider

def run(configuration, stop, *, api=None, relays=None):
    require(configuration['transport'] == TRANSPORT and configuration['sourceCommit'] == SOURCE_COMMIT,
            'Explicit same-host transport and prospective source required')
    require(configuration['helperSha256'] == sha(__file__), 'Reviewed local guard bytes differ')
    require(time.time() < configuration['deadline'] <= configuration['hardDeadline'] - 300,
            'Current provider deadline must bound the entire replay guard')
    validate_provider(configuration)
    api = api or public_api(configuration['sourceDirectory'])
    config, provenance = api.load_guard(Path(configuration['guardPath']))
    native_path = Path(configuration['guardPath']).parent / config['configurationPath']
    native = read(native_path)
    manifest = read(native_path.parent / native['manifestPath'])
    require(manifest['sourceCommit'] == SOURCE_COMMIT, 'Serving proof belongs to another source')
    require('identityFilePath' not in config, 'Same-host transport never accepts a private SSH key')
    require(config['provider'] == 'aws' and config['expectedInstanceId'] == configuration['instanceId']
            and config['localPorts'] == {'actor': 8000, 'predictor': 8001, 'otlp': 4318}
            and provenance.get('nativeLoraQualificationHash'), 'Current qualified LoRA and owned loopback relays required')
    relays = relays or relay_validator(configuration, provenance)
    output = Path(configuration['statusDirectory'])
    output.mkdir(parents=True, exist_ok=False)
    write(output / 'transport.json', {'transport': TRANSPORT, 'sourceCommit': SOURCE_COMMIT,
        'leaseId': configuration['leaseId'], 'deadline': configuration['deadline'],
        'publicEndpointProvenanceHash': api.hash_v1(provenance), 'guardConfigurationHash': api.hash_v1(config),
        'localProbeScriptSha256': hashlib.sha256(api.persistent_probe_script(provenance).encode()).hexdigest(),
        'sshPrivateKeyUsed': False, 'qualificationCreated': False, 'providerResourcesChanged': False})
    sequence, session, drained = 0, None, False
    try:
        with (output / 'local-probe.log').open('x', encoding='utf-8') as log:
            require(not stop.is_set() and time.time() < configuration['deadline'], 'Guard stopped before probe dispatch')
            session = api.PersistentProbeSession(config, provenance, stderr=log,
                popen=local_probe_factory(api, config, provenance))
            while time.time() < configuration['deadline'] and not stop.is_set():
                sequence += 1
                started = time.monotonic()
                if not session.ready():
                    api.publish(output, sequence, provenance, False, {'reason': 'probe_connecting'})
                else:
                    relays()
                    details = api.observe_persistent(provenance, session)
                    require(time.monotonic() - started <= api.OBSERVATION_SECONDS,
                            'Full relay and public observation exceeded freshness bound')
                    api.publish(output, sequence, provenance, True, details)
                stop.wait(.5)
    except BaseException as error:
        api.publish(output, sequence + 1, provenance, False, {'errorType': type(error).__name__, 'reason': 'local_probe_failed'})
        sequence += 1
        raise
    finally:
        if session:
            try:
                session.close()
                drained = True
            finally:
                api.publish(output, sequence + 1, provenance, False,
                    {'reason': 'guard_stopped', 'probeClosed': drained, 'transport': TRANSPORT})
        write(output / 'closeout.json', {'localProbeDrained': drained, 'supervisorGroupDrainRequired': True, 'sshPrivateKeyUsed': False,
            'leaseId': configuration['leaseId'], 'sourceCommit': SOURCE_COMMIT, 'providerResourcesChanged': False})
    return {'statusDirectory': str(output), 'localProbeDrained': drained}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--configuration', type=Path, required=True)
    args = parser.parse_args()
    stop = threading.Event()
    def interrupted(*_):
        stop.set()
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    config = read(args.configuration)
    def expired(*_):
        raise TimeoutError('Absolute same-host guard deadline expired')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, max(.001, config['deadline'] - time.time()))
    run(config, stop)
