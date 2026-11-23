"""Read scheduler counts from sealed native runtime logs, not hosted cost logs."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath

from acephale.contracts_v1 import hash_v1

KINDS = (
    'started', 'rejected', 'ready', 'failed', 'physical_read_completed',
    'promotion_requested', 'useful', 'wasted', 'cancel_requested',
    'cancellation_confirmed', 'invalidated', 'late_result_discarded',
    'revalidation_completed', 'validation_deferred', 'validation_denied',
    'validation_stale', 'validation_failed', 'verified', 'exposed',
    'authoritative_started',
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def verified_files(root):
    """The upstream cohort receipt inventories every file at stage closure."""
    root = Path(root).resolve()
    receipt = read(root / 'cohort-receipt.json')
    require(receipt.get('closed') is True and receipt.get('allDeclaredSlotsRetained') is True,
            'A closed native cohort retaining all slots is required')
    listed = {}
    for row in receipt['files']:
        relative = PurePosixPath(row['path'])
        require(relative.parts and not relative.is_absolute() and '..' not in relative.parts
                and '\\' not in row['path'] and ':' not in row['path']
                and row['path'] not in listed, 'Unsafe or duplicate cohort file')
        path = root.joinpath(*relative.parts)
        require(path.is_file() and all(not parent.is_symlink() for parent in [path, *path.parents])
                and path.resolve().is_relative_to(root), 'Regular scoped cohort files required')
        require(sha(path) == row['sha256'], 'Closed cohort file bytes differ')
        listed[row['path']] = row['sha256']
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    require(actual == set(listed) | {'cohort-receipt.json'}, 'Closed cohort inventory membership differs')
    return receipt, listed


def summarize_stream(events, configuration, manifest, *, stage_drained):
    """Keep observed counts separately from complete counts after a valid close."""
    runs = {row['runId']: row['arm'] for row in configuration['runs']}
    require(len(runs) == len(configuration['runs']), 'Unique declared native run IDs required')
    counts, reasons = {run: Counter() for run in runs}, {run: Counter() for run in runs}
    clock = None
    previous_ns = -1
    started, closed, total = False, False, 0
    for index, event in enumerate(events):
        require(event.get('sequence') == index and isinstance(event.get('processClockId'), str),
                'Runtime event sequence is incomplete or duplicated')
        clock = clock or event['processClockId']
        raw_ns = event.get('monotonicNs')
        require(event['processClockId'] == clock and isinstance(raw_ns, str) and raw_ns.isdigit()
                and int(raw_ns) >= previous_ns, 'Runtime process clock changed or regressed')
        previous_ns, total = int(raw_ns), index + 1
        kind = event.get('type')
        if kind == 'infra_native_service_started':
            require(not started and not closed and event.get('configurationHash') == hash_v1(configuration)
                    and event.get('manifestHash') == hash_v1(manifest)
                    and event.get('runs') == list(runs), 'Exact native runtime start identity required')
            started = True
        elif kind == 'infra_native_service_closed':
            require(started and not closed, 'Unique ordered native service closure required')
            closed = True
        elif kind in KINDS:
            run = event.get('runId')
            require(started and not closed and run in runs and event.get('arm') == runs[run]
                    and isinstance(event.get('key'), str) and isinstance(event.get('details'), dict),
                    'Scheduler event lacks a current declared runtime identity')
            counts[run][kind] += 1
            if kind == 'rejected':
                reason = event['details'].get('reason')
                require(isinstance(reason, str) and reason, 'Rejected event requires its actual reason')
                reasons[run][reason] += 1
    complete = bool(started and closed and stage_drained)
    rows = []
    for run, arm in runs.items():
        observed = {kind: counts[run][kind] for kind in KINDS}
        require(observed['useful'] <= observed['started'], 'Consumed jobs exceed started speculative jobs')
        rows.append({'runId': run, 'arm': arm, 'complete': complete,
                     'counts': observed if complete else None, 'observedCounts': observed,
                     'observedRejectionReasons': dict(sorted(reasons[run].items()))})
    return {'events': total, 'processClockId': clock, 'serviceStartedObserved': started,
            'serviceClosedObserved': closed, 'complete': complete, 'rows': rows}


def summarize(root, source_commit):
    root = Path(root).resolve()
    initial_receipt_sha = sha(root / 'cohort-receipt.json')
    receipt, listed = verified_files(root)
    configuration, manifest, summary = (read(root / name) for name in ('configuration.json', 'manifest.json', 'summary.json'))
    require(manifest['sourceCommit'] == source_commit
            and receipt['configurationHash'] == summary['configurationHash'] == hash_v1(configuration)
            and receipt['manifestHash'] == summary['manifestHash'] == hash_v1(manifest)
            and receipt.get('serviceExitCode') == summary.get('serviceExitCode'),
            'Frozen native source, manifest or configuration differs')
    event_path = root / 'service/events.jsonl'
    events = []
    if event_path.is_file():
        require('service/events.jsonl' in listed, 'Runtime event log must be in the closed inventory')
        data = event_path.read_bytes()
        require(not data or data.endswith(b'\n'), 'Incomplete final runtime event record')
        events = [json.loads(line) for line in data.splitlines()]
    value = summarize_stream(events, configuration, manifest,
                             stage_drained=summary.get('serviceExitCode') == 0)
    value.update(kind='acephale-closed-native-scheduler-counts-v1', sourceCommit=source_commit,
                 cohortReceiptSha256=initial_receipt_sha,
                 runtimeEventsSha256=listed.get('service/events.jsonl'),
                 accountingSource='service/events.jsonl; hosted-cost counters are not used',
                 interpretations={
                     'rejected': 'admission decisions, not physical tool calls',
                     'cancellation_confirmed': 'confirmed cancellation events, distinct from requests',
                     'revalidation_completed': 'validation attempts, not an asserted physical-read count',
                     'wasted': 'scheduler close events; native unpromoted calls remain a separate measure',
                 })
    require(sha(root / 'cohort-receipt.json') == initial_receipt_sha
            and all(sha(root / name) == digest for name, digest in listed.items()), 'Cohort changed during reporting')
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    result = summarize(arguments.cohort, arguments.source_commit)
    result['contentHash'] = hash_v1(result)
    with arguments.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'contentHash': result['contentHash'], 'complete': result['complete']}))
