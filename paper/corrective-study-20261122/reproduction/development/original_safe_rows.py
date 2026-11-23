import math
CALLS = ('authoritativeCalls', 'speculativeCalls', 'freshnessChecks', 'revalidationCalls')


def require(value, message):
    if not value:
        raise ValueError(message)


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def counter(value):
    return type(value) is int and value >= 0


def safe_native_row(slot, row, artifact, events):
    require(artifact.get('record') == row and all(row.get(key) == slot[key] for key in
        ('runId', 'domain', 'taskId', 'familyId', 'seed', 'arm', 'maxBoundaries')), 'Recorded native slot changed')
    require(type(row.get('success')) is bool, 'Actual boolean native completion required')
    verdict, audit = artifact.get('verdict') or {}, (artifact.get('verdict') or {}).get('constraintAudit') or {}
    if row['success']:
        require(verdict.get('passed') is True and verdict.get('evaluationValid') is True and verdict.get('officialReward') == 1
            and row.get('evaluationValid') is True and row.get('serviceDrainSucceeded') is True
            and row.get('hostInterrupted') is not True, 'Native completion contradicts its independent verdict/drain')
    complete = audit.get('status') == 'complete' and audit.get('completeMultisetCoverage') is True
    complete = bool(complete and counter(audit.get('expectedAssertions')) and audit['expectedAssertions'] > 0
        and audit.get('observedAssertions') == audit['expectedAssertions'] and counter(verdict.get('constraintViolations')))
    messages = artifact.get('simulation', {}).get('messages')
    logical = sum(len(message.get('tool_calls') or []) for message in messages if message.get('role') == 'assistant') if isinstance(messages, list) else None
    physical = sum(row[key] for key in CALLS) if all(counter(row.get(key)) for key in CALLS) else None
    timing = row.get('measuredTimingValid') is True and row.get('serviceDrainSucceeded') is True
    clocks = {key: row.get(key) if numeric(row.get(key)) else None for key in
        ('nativeOrchestrationSeconds', 'totalTrialSeconds', 'evaluationSeconds', 'totalIncludingEvaluationSeconds')}
    if all(clocks[key] is not None for key in ('nativeOrchestrationSeconds', 'totalTrialSeconds', 'totalIncludingEvaluationSeconds')):
        require(clocks['nativeOrchestrationSeconds'] <= clocks['totalTrialSeconds'] <= clocks['totalIncludingEvaluationSeconds'], 'Native elapsed clocks disagree')
    if row.get('budget_terminated') is True:
        status = 'budget_terminated'
    elif row.get('termination') in ('not_started', 'startup_failure', 'stage_aborted_before_slot'):
        status = 'not_started'
    elif row.get('hostInterrupted') is True or row.get('nativeTermination') in ('max_steps', 'timeout', 'too_many_errors', 'context_window_exceeded'):
        status = 'censored'
    else:
        status = 'completed' if row['success'] else 'failed'
    billed = row.get('billedUsd') if numeric(row.get('billedUsd')) and row.get('unknownProviderCharge') is False else None
    event_counts = events['counts'] if events['complete'] else None
    return {'runId': slot['runId'], 'domain': slot['domain'], 'familyId': slot['familyId'], 'taskId': slot['taskId'],
        'trial': slot['trial'], 'seed': slot['seed'], 'predictorTrainingSeed': slot['predictorTrainingSeed'], 'arm': slot['arm'],
        'status': status, 'success': row['success'], 'knownConstraintCleanSuccess': bool(row['success'] and complete and verdict['constraintViolations'] == 0),
        'constraintAuditComplete': complete, 'constraintViolations': verdict.get('constraintViolations') if complete else None,
        'logicalCalls': logical, 'physicalCalls': physical, 'revalidationCalls': row.get('revalidationCalls') if counter(row.get('revalidationCalls')) else None,
        'timingValid': timing and status != 'not_started', **clocks, 'billedUsd': billed,
        'knownUsageSubtotalUsd': row.get('knownUsageSubtotalUsd') if numeric(row.get('knownUsageSubtotalUsd')) else 0,
        'knownUsageSubtotalMissing': not numeric(row.get('knownUsageSubtotalUsd')),
        'unknownProviderCharge': billed is None, 'schedulerCounts': event_counts,
        'schedulerObservedCounts': events['observedCounts'], 'unpromotedCalls': row.get('unpromotedCalls') if counter(row.get('unpromotedCalls')) else None}

