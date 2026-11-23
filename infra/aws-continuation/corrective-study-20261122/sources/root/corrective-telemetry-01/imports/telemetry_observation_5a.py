"""Bounded read-only telemetry queries for the current qualified occurrence."""
import argparse
import base64
import hashlib
import importlib.util
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

import rfc8785

BASE = Path('/REQUIRED_BINDINGS/research-root')
SOURCE = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
SOURCE_PATH = BASE / 'training-source-5a36a8b3'
CAPTURE_SHA = 'b7f67a70f7163936006031d8ca2e2fe03250adcaf443f413bdb7941c91f8c222'
MAX_FILE, MAX_TOTAL = 4 * 1024**2, 64 * 1024**2
SERVICES = ('actor', 'predictor', 'postgres', 'prometheus', 'tempo', 'loki', 'alloy', 'grafana', 'acephale-runtime')
OCCURRENCES = ('seed17-01', 'seed29-01', 'seed17-02', 'seed29-02')


class ExportDeadline(BaseException):
    pass


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def read(path):
    path = Path(path)
    require(path.is_file() and not any(parent.is_symlink() for parent in (path, *path.parents)), 'Regular immutable input required')
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def sealed(value):
    require(value.get('contentHash') == digest({key: item for key, item in value.items() if key != 'contentHash'}),
        'Canonical immutable receipt differs')
    return value


def environment():
    return {key: value for key, value in os.environ.items() if key not in {
        'DOCKER_HOST', 'DOCKER_CONTEXT', 'OPENAI_API_KEY', 'LAMBDA_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'}}


def command(argv):
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=5, env=environment()).stdout.strip()


def docker(argv):
    return command(['docker', '--host', 'unix:///var/run/docker.sock', *argv])


def checked_file(config, name):
    path = Path(config[name + 'Path'])
    require(sha(path) == config[name + 'Sha256'], 'Exact ' + name + ' bytes changed')
    return read(path)


def trace_selection(value, config, provider, *, now):
    sealed(value)
    require(value.get('kind') == 'acephale-native-telemetry-trace-selection-v1'
        and all(value.get(key) == config[key] for key in ('sourceCommit', 'leaseId', 'instanceId', 'hardDeadline', 'providerLeaseSha256'))
        and value.get('selectionRule') == 'lexicographic_unique_actual_native_actor_decision_trace_ids_v1'
        and value.get('maximumTraces') == 16 and value.get('teacherOrSyntheticTracesSelected') is False,
        'Actual same-lease native trace selection required')
    rows = value['selected']
    require(type(value['availableTraceCount']) is int and type(value['selectedTraceCount']) is int
        and value['availableTraceCount'] >= 0 and len(rows) == value['selectedTraceCount'] == min(16, value['availableTraceCount'])
        and [row['traceId'] for row in rows] == sorted({row['traceId'] for row in rows}),
        'Bounded deterministic trace count or ordering changed')
    sources = {row['cohortReceiptSha256'] for row in value['cohorts']}
    require(len(sources) == len(value['cohorts']) and sources
        and all(row['sourceCommit'] == SOURCE and re.fullmatch('[a-f0-9]{64}', row['runtimeEventsSha256']) for row in value['cohorts']),
        'Closed source provenance is missing')
    for row in rows:
        require(re.fullmatch('[a-f0-9]{32}', row['traceId']) and row['sourceReceiptSha256'] in sources
            and row['spanIds'] == sorted(set(row['spanIds'])) and row['spanIds']
            and all(re.fullmatch('[a-f0-9]{16}', span) for span in row['spanIds'])
            and provider['observedAt'] - 5 <= row['firstObservedAt'] <= row['lastObservedAt'] <= now + 5,
            'Trace IDs or observed times are not from this actual host lifetime')
    return rows


def container_identity(row):
    return {'id': row['Id'], 'imageId': row['Image'], 'startedAt': row['State']['StartedAt'],
        'commandHash': digest(row['Config']['Cmd'])}


def inspect_containers(expected, *, run=docker):
    require(set(expected) == set(SERVICES), 'All nine current serving identities are required')
    current = run(['ps', '--no-trunc', '--format', '{{.ID}}']).splitlines()
    require(len(current) == len(set(current)) == 9 and set(current) == {row['id'] for row in expected.values()},
        'Extra, missing or changed current container')
    rows = json.loads(run(['inspect', *current]))
    containers = {}
    for row in rows:
        role = row['Config'].get('Labels', {}).get('com.docker.compose.service')
        require(role in SERVICES and role not in containers and row['Name'] == '/acephale-infra-v1-' + role + '-1'
            and row['Config']['Labels'].get('com.docker.compose.project') == 'acephale-infra-v1'
            and row['State']['Running'] is True and container_identity(row) == expected[role],
            'Current serving process differs from its qualified ownership observation')
        address = ipaddress.ip_address(row['NetworkSettings']['Networks']['acephale-infra-v1_research']['IPAddress'])
        require(address.version == 4 and address.is_private and not address.is_loopback, 'Exact private container address required')
        containers[role] = {'identity': expected[role], 'address': str(address)}
    require(set(containers) == set(SERVICES), 'Incomplete actual Docker inspection')
    return containers


def bindings(config, *, run=command, inspect=inspect_containers, now=None):
    now = time.time() if now is None else now
    require(config['sourceCommit'] == SOURCE and config['sourceDirectory'] == str(SOURCE_PATH)
        and config['helperSha256'] == sha(__file__) and config['occurrenceId'] in OCCURRENCES
        and re.fullmatch('[a-z][a-z0-9-]{0,63}', config['observationId'])
        and type(config['deadline']) in (int, float) and math.isfinite(config['deadline'])
        and now < config['deadline'] <= min(now + 240, config['hardDeadline'] - 30),
        'Exact current source and bounded original provider window required')
    require(run(['git', '-C', str(SOURCE_PATH), 'rev-parse', 'HEAD']) == SOURCE
        and not run(['git', '-C', str(SOURCE_PATH), 'status', '--porcelain=v1']), 'Current final-source checkout changed')
    provider_path = BASE / 'provider-receipt.json'
    require(sha(provider_path) == config['providerReceiptSha256'], 'Original actual provider receipt changed')
    provider, lease = read(provider_path), checked_file(config, 'providerLease')
    require(provider['leaseId'] == lease['id'] == config['leaseId']
        and provider['instance']['id'] == lease['instanceId'] == config['instanceId']
        and lease['deadline'] == config['hardDeadline'], 'Original lease/instance/deadline binding differs')
    expected_path = BASE / 'artifacts' / ('serving-' + config['occurrenceId']) / 'serving-completed.json'
    require(Path(config['servingReceiptPath']) == expected_path, 'Exact current occurrence receipt path required')
    serving = sealed(checked_file(config, 'servingReceipt'))
    observed = checked_file(config, 'managedObservation')
    require(serving.get('completed') is True and serving['occurrenceId'] == config['occurrenceId']
        and all(serving[key] == config[key] for key in ('sourceCommit', 'leaseId', 'instanceId'))
        and observed.get('servingOwnershipConfirmed') is True and observed.get('temporaryWorkDrained') is True
        and observed.get('drainConfirmed') is False and observed.get('servingSourceCommit') == SOURCE
        and all(observed[key] == config[key] for key in ('leaseId', 'instanceId', 'hardDeadline')),
        'Actual completed qualification and deliberately live ownership observation required')
    for path_key, sha_key in (('proofPath', 'proofSha256'), ('inventoryPath', 'inventorySha256')):
        path = Path(serving[path_key])
        require(path.is_relative_to(BASE / 'artifacts') and sha(path) == serving[sha_key], 'Actual qualification or post-probe inventory changed')
        read(path)
    proof, inventory = read(serving['proofPath']), read(serving['inventoryPath'])
    require(sealed(proof).get('passed') is True and inventory['modelFiles']['predictor']['vllmQualificationPassed'] is True,
        'Actual numerical qualification must remain independently present')
    expected = observed['serviceContainers']
    for role, key in (('actor', 'actorContainerId'), ('predictor', 'predictorContainerId'), ('acephale-runtime', 'runtimeContainerId')):
        require(expected[role]['id'] == serving[key], 'Occurrence and managed process identity differ')
    for role in ('actor', 'predictor'):
        require(expected[role] == {key: inventory['containers'][role][key] for key in ('id', 'imageId', 'startedAt', 'commandHash')},
            'Current model differs from actual post-probe inventory')
    selection = checked_file(config, 'traceSelection')
    rows = trace_selection(selection, config, provider, now=now)
    return provider, serving, selection, rows, expected, inspect(expected)


def normalize_identifier(value, length):
    if not isinstance(value, str):
        return None
    if re.fullmatch('[a-fA-F0-9]{' + str(length * 2) + '}', value):
        return value.lower()
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        return None
    return raw.hex() if len(raw) == length else None


def tempo_observation(value, selected):
    spans = []
    for resource in value.get('batches', value.get('resourceSpans', [])):
        for scope in resource.get('scopeSpans', resource.get('instrumentationLibrarySpans', [])):
            spans.extend(scope.get('spans', []))
    matching, all_trace_ids = [], set()
    for span in spans:
        trace = normalize_identifier(span.get('traceId', span.get('traceID')), 16)
        identifier = normalize_identifier(span.get('spanId', span.get('spanID')), 8)
        if trace:
            all_trace_ids.add(trace)
        if trace == selected['traceId'] and identifier in selected['spanIds'] and span.get('name') == 'native.actor_decision':
            matching.append(identifier)
    matched = sorted(set(matching))
    return {'returnedSpanCount': len(spans), 'returnedTraceIdentityCount': len(all_trace_ids),
        'requestedTraceIdentityObserved': selected['traceId'] in all_trace_ids,
        'selectedNativeActorDecisionSpanIdsObserved': matched,
        'selectedNativeActorDecisionSpansMissing': sorted(set(selected['spanIds']) - set(matched)),
        'nativeActorDecisionEvidenceObserved': bool(matched),
        'allSelectedNativeActorDecisionSpansObserved': set(matched) == set(selected['spanIds'])}


def http_bytes(address, port, path, timeout):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args):
            raise ValueError('Telemetry redirects are forbidden')
    request = urllib.request.Request(f'http://{address}:{port}{path}', headers={'Accept': 'application/json'})
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(MAX_FILE + 1)


def recheck_inputs(config):
    for name in ('providerLease', 'servingReceipt', 'managedObservation', 'traceSelection'):
        checked_file(config, name)
    require(sha(BASE / 'provider-receipt.json') == config['providerReceiptSha256']
        and command(['git', '-C', str(SOURCE_PATH), 'rev-parse', 'HEAD']) == SOURCE
        and not command(['git', '-C', str(SOURCE_PATH), 'status', '--porcelain=v1']),
        'Current source/provider identity changed during observation')


def query(config, *, context=None, fetch=http_bytes, inspect=inspect_containers, clock=time.time, capture=None,
          recheck=recheck_inputs):
    provider, serving, selection, selected, expected, containers = context or bindings(config, inspect=inspect, now=clock())
    output = BASE / 'artifacts' / ('telemetry-' + config['observationId'])
    output.mkdir(exist_ok=False)
    if capture is None:
        path = Path(config['captureHelperPath'])
        require(sha(path) == config['captureHelperSha256'] == CAPTURE_SHA, 'Reviewed bounded log capture helper required')
        specification = importlib.util.spec_from_file_location('bounded_closeout_capture', path)
        helper = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(helper)
        capture = helper.log_capture
    omissions, observations = [], {}
    write(output / 'binding.json', {'kind': 'acephale-current-native-telemetry-binding-v1',
        **{key: config[key] for key in ('sourceCommit', 'leaseId', 'instanceId', 'hardDeadline', 'occurrenceId', 'deadline',
            'providerLeaseSha256', 'providerReceiptSha256', 'servingReceiptSha256', 'managedObservationSha256', 'traceSelectionSha256')},
        'selectionHash': selection['contentHash'], 'availableTraceCount': selection['availableTraceCount'],
        'selectedTraceCount': len(selected), 'maximumFileBytes': MAX_FILE, 'maximumPayloadBytes': MAX_TOTAL,
        'maximumSeconds': 240, 'readOnlyHostObservation': True, 'nativeBenchmarkScore': False})
    write(output / 'current-container-identities.json', expected)
    write(output / 'trace-selection.json', selection)
    require(all(path.stat().st_size <= MAX_FILE for path in output.iterdir() if path.is_file()),
        'Telemetry binding metadata exceeds the per-file limit')

    def permitted(name):
        if clock() >= config['deadline'] - 30:
            omissions.append({'item': name, 'reason': 'absolute_deadline_margin'})
            return False
        used = sum(path.stat().st_size for path in output.iterdir() if path.is_file())
        if used + MAX_FILE > MAX_TOTAL - 1024**2:
            omissions.append({'item': name, 'reason': 'aggregate_byte_limit'})
            return False
        return True

    def request(role, port, path, name, trace=None):
        if not permitted(name):
            return
        try:
            status, data = fetch(containers[role]['address'], port, path, min(5, config['deadline'] - clock() - 30))
            retained = data[:MAX_FILE]
            with (output / name).open('xb') as stream:
                stream.write(retained)
            item = {'httpStatus': status, 'retainedBytes': len(retained), 'sha256': sha(output / name),
                'truncated': len(data) > MAX_FILE, 'httpSucceeded': status == 200,
                'nativeActorDecisionEvidenceObserved': False}
            observations[name] = item
            if len(data) > MAX_FILE:
                omissions.append({'item': name, 'reason': 'response_byte_limit'})
                return
            if status != 200:
                omissions.append({'item': name, 'reason': 'http_status', 'status': status})
                return
            value = json.loads(data)
            if role == 'tempo':
                item.update(tempo_observation(value, trace))
                if not item['allSelectedNativeActorDecisionSpansObserved']:
                    omissions.append({'item': name, 'reason': 'selected_native_span_not_returned'})
            elif role in ('prometheus', 'loki'):
                item['backendStatus'] = value.get('status')
                item['resultSeriesOrStreams'] = len(value.get('data', {}).get('result', []))
                if item['backendStatus'] != 'success' or item['resultSeriesOrStreams'] == 0:
                    omissions.append({'item': name, 'reason': 'no_matching_backend_data'})
            elif role == 'grafana':
                item['databaseStatus'] = value.get('database')
                if item['databaseStatus'] != 'ok':
                    omissions.append({'item': name, 'reason': 'grafana_database_not_ok'})
        except (ValueError, KeyError, TypeError, OSError) as error:
            omissions.append({'item': name, 'reason': type(error).__name__})

    for row in selected:
        request('tempo', 3200, '/api/traces/' + row['traceId'], 'trace-' + row['traceId'] + '.json', row)
    request('prometheus', 9090, '/api/v1/query?' + urllib.parse.urlencode({'query': '{__name__=~"acephale_.*"}'}), 'prometheus-native.json')
    request('loki', 3100, '/loki/api/v1/query_range?' + urllib.parse.urlencode({'query': '{job="acephale"}', 'limit': 5000,
        'start': str(int(provider['observedAt'] * 10**9)), 'end': str(int(clock() * 10**9)), 'direction': 'forward'}), 'loki-native.json')
    request('grafana', 3000, '/api/health', 'grafana-health.json')
    for role in SERVICES:
        name = role + '.log'
        if not permitted(name):
            continue
        try:
            reason = capture(['docker', '--host', 'unix:///var/run/docker.sock', 'logs', '--timestamps', '--tail', '100000', expected[role]['id']],
                output / name, min(clock() + 5, config['deadline'] - 30))
            require((output / name).stat().st_size <= MAX_FILE, 'Bounded log capture exceeded the reviewed file cap')
            if reason:
                omissions.append({'item': name, 'reason': reason})
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            omissions.append({'item': name, 'reason': type(error).__name__})
    stable = False
    try:
        inspect(expected)
        recheck(config)
        stable = True
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        omissions.append({'item': 'current-container-identities', 'reason': type(error).__name__})
    files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path)} for path in sorted(output.iterdir()) if path.is_file()]
    matched = sum(row.get('nativeActorDecisionEvidenceObserved') is True for row in observations.values())
    inventory = {'kind': 'acephale-current-native-telemetry-export-v1', 'sourceCommit': SOURCE,
        **{key: config[key] for key in ('leaseId', 'instanceId', 'occurrenceId')}, 'files': files,
        'observations': observations, 'omissions': omissions, 'availableTraceCount': selection['availableTraceCount'],
        'selectedTraceCount': len(selected), 'actualNativeTraceEvidenceCount': matched,
        'currentContainerIdentitiesStillMatch': stable,
        'allSelectedNativeTracesObserved': bool(selected) and matched == len(selected) and stable,
        'allSelectedActorDecisionSpansObserved': bool(selected) and stable and all(
            observations.get('trace-' + row['traceId'] + '.json', {}).get('allSelectedNativeActorDecisionSpansObserved') is True for row in selected),
        'otlpAcceptanceOnlyClaim': False, 'modelQualificationCreated': False, 'nativeBenchmarkScore': False,
        'localExportVerified': False, 'finishedAt': clock()}
    write(output / 'inventory.json', inventory)
    require(all(path.stat().st_size <= MAX_FILE for path in output.iterdir() if path.is_file()),
        'Telemetry inventory exceeds the per-file limit')
    require(sum(path.stat().st_size for path in output.iterdir() if path.is_file()) <= MAX_TOTAL, 'Aggregate telemetry payload cap exceeded')
    require(clock() < config['deadline'] - 10, 'Insufficient archive time remains')
    archive = output.with_suffix('.tar.gz')
    with tarfile.open(archive, 'x:gz', compresslevel=1) as bundle:
        bundle.add(output, arcname='telemetry')
    receipt = {'kind': 'acephale-current-native-telemetry-archive-v1', 'sourceCommit': SOURCE,
        **{key: config[key] for key in ('leaseId', 'instanceId', 'occurrenceId')}, 'archive': str(archive),
        'sha256': sha(archive), 'bytes': archive.stat().st_size, 'files': len(files), 'omissions': len(omissions),
        'selectedTraceCount': len(selected), 'actualNativeTraceEvidenceCount': matched,
        'currentContainerIdentitiesStillMatch': stable, 'localExportVerified': False}
    write(output.with_suffix('.receipt.json'), receipt)
    return receipt


def verify_local_archive(path, receipt):
    """Verify downloaded bytes and each retained file; never contact the host."""
    path = Path(path)
    require(sha(path) == receipt['sha256'] and path.stat().st_size == receipt['bytes'], 'Downloaded telemetry archive differs')
    with tarfile.open(path, 'r:gz') as archive:
        names = archive.getnames()
        require(len(names) == len(set(names)), 'Duplicate telemetry archive member')
        inventory = json.load(archive.extractfile('telemetry/inventory.json'))
        require(all(inventory[key] == receipt[key] for key in ('sourceCommit', 'leaseId', 'instanceId', 'occurrenceId',
            'selectedTraceCount', 'actualNativeTraceEvidenceCount', 'currentContainerIdentitiesStillMatch')),
            'Downloaded telemetry scope differs')
        rows = inventory['files']
        require(len(rows) == receipt['files'] == len({row['path'] for row in rows})
            and len(inventory['omissions']) == receipt['omissions']
            and set(names) == {'telemetry', 'telemetry/inventory.json', *['telemetry/' + row['path'] for row in rows]},
            'Downloaded telemetry membership differs')
        require(archive.getmember('telemetry').isdir(), 'Expected exact telemetry archive root')
        for member in archive.getmembers():
            if member.name == 'telemetry':
                continue
            require(member.isfile() and member.name.startswith('telemetry/') and '/' not in member.name[len('telemetry/'):]
                and '\\' not in member.name and ':' not in member.name and member.name != 'telemetry/..',
                'Unsafe telemetry archive member')
        require(archive.getmember('telemetry/inventory.json').size <= MAX_FILE
            and archive.getmember('telemetry/inventory.json').size + sum(row['bytes'] for row in rows) <= MAX_TOTAL,
            'Downloaded payload exceeds bound')
        indexed = {}
        for row in rows:
            member = archive.getmember('telemetry/' + row['path'])
            with archive.extractfile(member) as stream:
                require(member.size == row['bytes'] <= MAX_FILE and hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256'],
                    'Downloaded telemetry member changed')
            indexed[row['path']] = row
        for name, value in inventory['observations'].items():
            require(name in indexed and value['sha256'] == indexed[name]['sha256']
                and value['retainedBytes'] == indexed[name]['bytes'], 'Raw HTTP response hash association differs')
    return {'kind': 'acephale-current-native-telemetry-local-export-v1', 'localExportVerified': True,
        'verificationScope': 'whole_archive_and_each_retained_file', 'archiveSha256': receipt['sha256'],
        **{key: receipt[key] for key in ('sourceCommit', 'leaseId', 'instanceId', 'occurrenceId', 'selectedTraceCount',
            'actualNativeTraceEvidenceCount', 'currentContainerIdentitiesStillMatch')},
        'filesVerified': len(rows), 'omissions': inventory['omissions'], 'otlpAcceptanceOnlyClaim': False,
        'nativeBenchmarkScore': False}


def bounded_query(config):
    remaining = config['deadline'] - time.time()
    require(0 < remaining <= 240, 'Absolute query bound must be at most240 seconds')
    for key in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'OPENAI_API_KEY', 'LAMBDA_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'):
        os.environ.pop(key, None)
    def expired(*_):
        raise ExportDeadline('Absolute telemetry observation deadline reached')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, remaining)
    try:
        return query(config)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configuration', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(bounded_query(read(args.configuration))), flush=True)
