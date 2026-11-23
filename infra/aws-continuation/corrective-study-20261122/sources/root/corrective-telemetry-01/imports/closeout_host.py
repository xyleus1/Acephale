"""Read-only bounded export of this lease's container logs and telemetry."""
from pathlib import Path
import argparse
import hashlib
import ipaddress
import json
import re
import selectors
import signal
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request

BASE = Path('/REQUIRED_BINDINGS/research-root')
MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024


class ExportDeadline(BaseException):
    pass


def bounded_export(lease_id, source, deadline, trace_file):
    """One absolute Linux timer also bounds slow HTTP bodies and TAR compression."""
    remaining = deadline - time.time()
    if not 0 < remaining <= 240:
        raise ValueError('A fresh absolute export deadline of at most 240 seconds is required')
    def expired(_signal, _frame):
        raise ExportDeadline('Absolute remote export deadline reached')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, remaining)
    try:
        return export(lease_id, source, deadline, trace_file)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def log_capture(command, path, deadline):
    """Bound retained bytes and client lifetime, even for continuously growing logs."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    size, reason = 0, None
    try:
        with selectors.DefaultSelector() as selector, path.open('xb') as stream:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                if time.time() >= deadline:
                    reason = 'log_timeout'
                    break
                if not selector.select(min(0.1, max(0, deadline - time.time()))):
                    if process.poll() is not None:
                        break
                    continue
                data = process.stdout.read1(min(65536, MAX_FILE - size + 1))
                if not data:
                    break
                retained = data[:MAX_FILE - size]
                stream.write(retained)
                size += len(retained)
                if len(data) > len(retained):
                    reason = 'log_byte_limit'
                    break
        if reason is None and process.poll() is None:
            try:
                process.wait(timeout=max(0.001, min(1, deadline - time.time())))
            except subprocess.TimeoutExpired:
                reason = 'log_timeout'
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        process.stdout.close()
    return reason or ('log_command_failed' if process.returncode else None)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)


def export(lease_id, source, deadline, trace_file):
    provider = json.loads((BASE / 'provider-receipt.json').read_text())
    configuration = json.loads((BASE / 'artifacts/bootstrap-configuration.json').read_text())
    actual_source = subprocess.check_output(['git', '-C', str(BASE / 'source'), 'rev-parse', 'HEAD'], text=True, timeout=5).strip()
    if (provider['leaseId'] != lease_id or actual_source != source or not re.fullmatch('[a-f0-9]{40}', source)
            or not re.fullmatch('[a-f0-9-]{36}', lease_id) or deadline > configuration['hardDeadline'] - 30
            or not time.time() < deadline <= time.time() + 240):
        raise ValueError('Exact lease/source and bounded pre-termination window required')
    traces = json.loads(trace_file.read_text()) if trace_file else []
    if (not isinstance(traces, list) or len(traces) > 1000 or len(set(traces)) != len(traces)
            or any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{32}', value) for value in traces)):
        raise ValueError('Bounded distinct actual native trace IDs required')
    output = BASE / ('closeout-' + lease_id)
    output.mkdir(exist_ok=False)
    omitted, containers, observations = [], {}, {}
    write(output / 'binding.json', {'leaseId': lease_id, 'sourceCommit': source, 'startedAt': time.time(),
        'providerReceiptSha256': sha(BASE / 'provider-receipt.json'), 'nativeTraceIds': traces,
        'readOnlyHostObservation': True, 'lokiMaximumEntries': 5000, 'maximumResponseBytes': MAX_FILE,
        'maximumTotalPayloadBytes': MAX_TOTAL, 'containerLogsTailLines': 100000})
    expected = json.loads((BASE / 'artifacts/deployment-inventory-01/inventory-evidence.json').read_text())['containers']
    for role in ('actor', 'predictor', 'acephale-runtime', 'postgres', 'alloy', 'tempo', 'loki', 'prometheus', 'grafana'):
        if time.time() >= deadline - 15:
            omitted.append({'item': role, 'reason': 'export_deadline'})
            continue
        name = 'acephale-infra-v1-' + role + '-1'
        try:
            row = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True, timeout=5))[0]
            if row['Name'] != '/' + name:
                raise ValueError('Container name changed')
            if role in ('actor', 'predictor') and any(row[key] != expected[role][field]
                    for key, field in [('Id', 'id'), ('Image', 'imageId')]):
                raise ValueError('Model container identity changed')
            if role in ('actor', 'predictor') and row['State']['StartedAt'] != expected[role]['startedAt']:
                raise ValueError('Model container restarted during collection')
            containers[role] = row
            write(output / (role + '-identity.json'), {'id': row['Id'], 'imageId': row['Image'],
                'name': row['Name'], 'state': row['State']})
            reason = log_capture(['docker', 'logs', '--timestamps', '--tail', '100000', name],
                                 output / (role + '.log'), min(time.time() + 5, deadline - 15))
            if reason:
                omitted.append({'item': role + '.log', 'reason': reason})
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            omitted.append({'item': role, 'reason': type(error).__name__})

    def fetch(role, port, path, name):
        if time.time() >= deadline - 15:
            omitted.append({'item': name, 'reason': 'export_deadline'})
            return
        if sum(item.stat().st_size for item in output.iterdir() if item.is_file()) + MAX_FILE > MAX_TOTAL:
            omitted.append({'item': name, 'reason': 'aggregate_byte_limit'})
            return
        try:
            address = containers[role]['NetworkSettings']['Networks']['acephale-infra-v1_research']['IPAddress']
            if not ipaddress.ip_address(address).is_private:
                raise ValueError('Expected private container address')
            request = urllib.request.Request('http://' + address + ':' + str(port) + path,
                                             headers={'Accept': 'application/json'})
            with urllib.request.urlopen(request, timeout=min(5, max(1, deadline - time.time() - 15))) as response:
                data = response.read(MAX_FILE + 1)
            if len(data) > MAX_FILE:
                raise ValueError('Response exceeded retained byte bound')
            value = json.loads(data)
            (output / name).write_bytes(data)
            observations[name] = {'receivedBytes': len(data), 'httpSucceeded': True}
            if role == 'prometheus':
                observations[name]['seriesCount'] = len(value.get('data', {}).get('result', []))
                observations[name]['status'] = value.get('status')
            elif role == 'loki':
                observations[name]['streamsCount'] = len(value.get('data', {}).get('result', []))
                observations[name]['status'] = value.get('status')
            elif role == 'tempo':
                observations[name]['resourceBatchCount'] = len(value.get('batches', value.get('resourceSpans', [])))
        except (ValueError, KeyError, OSError) as error:
            omitted.append({'item': name, 'reason': type(error).__name__})

    fetch('prometheus', 9090, '/api/v1/query?' + urllib.parse.urlencode({'query': '{__name__=~"acephale_.*"}'}), 'prometheus-native.json')
    fetch('loki', 3100, '/loki/api/v1/query_range?' + urllib.parse.urlencode({
        'query': '{job="acephale"}', 'limit': 5000, 'start': str(int(provider['observedAt']) * 10**9),
        'end': str(int(time.time()) * 10**9), 'direction': 'forward'}), 'loki-observation.json')
    for trace_id in traces:
        fetch('tempo', 3200, '/api/traces/' + trace_id, 'trace-' + trace_id + '.json')
    files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path)}
             for path in sorted(output.iterdir()) if path.is_file()]
    write(output / 'inventory.json', {'schemaVersion': 1, 'leaseId': lease_id, 'sourceCommit': source,
        'files': files, 'omitted': omitted, 'observations': observations, 'finishedAt': time.time(), 'lokiIsBoundedQuery': True,
        'nativeBenchmarkScore': False, 'localExportVerified': False})
    if time.time() >= deadline - 10:
        raise TimeoutError('Insufficient bounded time remains to archive closeout')
    archive = output.with_suffix('.tar.gz')
    if archive.exists():
        raise ValueError('Closeout archive already exists')
    with tarfile.open(archive, 'x:gz', compresslevel=1) as stream:
        stream.add(output, arcname='closeout')
    receipt = {'schemaVersion': 1, 'leaseId': lease_id, 'sourceCommit': source, 'archive': str(archive),
               'bytes': archive.stat().st_size, 'sha256': sha(archive), 'files': len(files), 'omitted': len(omitted)}
    write(output.with_suffix('.receipt.json'), receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lease-id', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--deadline', type=float, required=True)
    parser.add_argument('--trace-ids', type=Path)
    args = parser.parse_args()
    print(json.dumps(bounded_export(args.lease_id, args.source_commit, args.deadline, args.trace_ids)))
