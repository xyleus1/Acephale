"""Freeze a deterministic native trace sample from complete closed runtime logs."""
import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re

import rfc8785

SOURCE = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
VERIFIER_SHA = '5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358'
MAX_TRACES = 16


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def verifier(path):
    require(sha(path) == VERIFIER_SHA, 'Reviewed closed-cohort verifier changed')
    spec = importlib.util.spec_from_file_location('closed_scheduler_counts', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def actor_spans(events):
    result = []
    for row in events:
        if row.get('type') != 'span_started' or row.get('name') != 'native.actor_decision':
            continue
        require(isinstance(row.get('traceId'), str) and re.fullmatch('[a-f0-9]{32}', row['traceId'])
            and isinstance(row.get('spanId'), str) and re.fullmatch('[a-f0-9]{16}', row['spanId']),
            'Actual native span has malformed trace or span identity')
        moment = datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))
        require(moment.utcoffset() is not None, 'Native span time requires an actual timezone')
        result.append({'traceId': row['traceId'], 'spanId': row['spanId'],
            'sequence': row['sequence'], 'observedAt': moment.timestamp()})
    require(len({(row['traceId'], row['spanId']) for row in result}) == len(result), 'Duplicate native span identity')
    return result


def select(config, *, closed_verifier=None):
    require(config['sourceCommit'] == SOURCE and config.get('maximumTraces', MAX_TRACES) == MAX_TRACES,
        'Final source and unchanged maximum sixteen native traces required')
    lease_path = Path(config['providerLeasePath'])
    require(sha(lease_path) == config['providerLeaseSha256'], 'Original provider lease bytes changed')
    lease = read(lease_path)
    checked = closed_verifier or verifier(Path(__file__).resolve().parents[1] / 'summarize_scheduler_events.py')
    traces, sources, seen = {}, [], set()
    for item in sorted(config['cohorts'], key=lambda row: row['receiptSha256']):
        root = Path(item['directory']).resolve()
        receipt = root / 'cohort-receipt.json'
        require(item['receiptSha256'] not in seen and sha(receipt) == item['receiptSha256'],
            'Distinct closed cohort receipt bytes required')
        seen.add(item['receiptSha256'])
        verified = checked.summarize(root, SOURCE)
        require(verified['complete'] is True and verified['cohortReceiptSha256'] == item['receiptSha256'],
            'Only complete drained runtime logs may supply final telemetry traces')
        path = root / 'service/events.jsonl'
        spans = actor_spans([json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()])
        for row in spans:
            current = traces.setdefault(row['traceId'], {'traceId': row['traceId'], 'spanIds': [], 'sourceReceiptSha256': item['receiptSha256'],
                'firstObservedAt': row['observedAt'], 'lastObservedAt': row['observedAt']})
            require(current['sourceReceiptSha256'] == item['receiptSha256'] and row['spanId'] not in current['spanIds'],
                'Trace identity was duplicated across independently closed cohorts')
            current['spanIds'].append(row['spanId'])
            current['firstObservedAt'] = min(current['firstObservedAt'], row['observedAt'])
            current['lastObservedAt'] = max(current['lastObservedAt'], row['observedAt'])
        require(sha(path) == verified['runtimeEventsSha256'] and sha(receipt) == item['receiptSha256'],
            'Closed native trace inputs changed during selection')
        sources.append({'cohortReceiptSha256': item['receiptSha256'], 'runtimeEventsSha256': verified['runtimeEventsSha256'],
            'sourceCommit': SOURCE, 'runtimeEventCount': verified['events'], 'nativeActorDecisionSpans': len(spans)})
    require(bool(sources), 'At least one complete actual native cohort required')
    selected = [traces[key] for key in sorted(traces)[:MAX_TRACES]]
    for row in selected:
        row['spanIds'].sort()
    body = {'schemaVersion': 1, 'kind': 'acephale-native-telemetry-trace-selection-v1', 'sourceCommit': SOURCE,
        'leaseId': lease['id'], 'instanceId': lease['instanceId'], 'hardDeadline': lease['deadline'],
        'providerLeaseSha256': config['providerLeaseSha256'], 'cohorts': sources,
        'selectionRule': 'lexicographic_unique_actual_native_actor_decision_trace_ids_v1',
        'maximumTraces': MAX_TRACES, 'availableTraceCount': len(traces),
        'availableActorDecisionSpanCount': sum(len(row['spanIds']) for row in traces.values()),
        'selectedTraceCount': len(selected), 'selected': selected,
        'teacherOrSyntheticTracesSelected': False, 'modelCallsPerformed': False,
        'selectorSha256': sha(__file__), 'closedCohortVerifierSha256': VERIFIER_SHA}
    return {**body, 'contentHash': digest(body)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configuration', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    value = select(read(args.configuration))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'contentHash': value['contentHash'], 'selectedTraceCount': value['selectedTraceCount']}))
