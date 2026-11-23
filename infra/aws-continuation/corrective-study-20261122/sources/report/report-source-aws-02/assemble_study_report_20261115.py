"""Assemble closed study evidence without opening the financial journal or models."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import hashlib
import importlib.util
import json
import math
from report_path_view import Path
import subprocess
import sys
import tarfile

ANALYSIS = 'c8a662c97c5daae33d4868d7e50494d8355fbc2c'
RUNTIME = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
ANALYSIS_ROOT = Path('/REQUIRED_BINDINGS/research-root/workspaces/report/analysis-source-c8')
sys.path.insert(0, str(ANALYSIS_ROOT / 'research/acephale/src'))
from acephale.contracts_v1 import hash_v1
from acephale.experiment_runner import verify_source
from acephale.infra_data import read_jsonl, verify_bundle
from acephale.infra_evaluation import TrialDesign, TrialResult, _paired_interval, report_trials, score_candidate_panels, score_fixed_panel_replay
from acephale.infra_fairness import compare_predictor_replays, load_reviewed_selection
from acephale.native_common import summarize_costs

ROOT = Path('/REQUIRED_BINDINGS/research-root/migration/raw/REQUIRED_BINDINGS_WORKSPACE/outputs/acephale-staged-study-20261113')
SCHEDULER_SHA = '5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358'
CLOSED_REPLAY_SHA = 'bbb97221d410f5601265a17f6dd7be46589a0bb03ee68cf5da824597e9b3ead1'
CALLS = ('authoritativeCalls', 'speculativeCalls', 'freshnessChecks', 'revalidationCalls')
COUNTS = ('started', 'useful', 'wasted', 'rejected', 'cancel_requested', 'cancellation_confirmed', 'revalidation_completed')
NODE = Path('/REQUIRED_BINDINGS/research-root/workspaces/operator/tools/node-v22.23.4-linux-x64/bin/node')


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sealed(value):
    require(value.get('contentHash') == hash_v1({key: item for key, item in value.items() if key != 'contentHash'}), 'Canonical receipt changed')
    return value


def dependency(path, expected, name):
    require(sha(path) == expected, 'Reviewed reporting dependency changed')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checked_file(reference, inputs):
    path = Path(reference['path']).resolve()
    require(path.is_file() and not path.is_symlink() and sha(path) == reference['sha256'], 'Reporting input bytes differ')
    inputs[str(path)] = reference['sha256']
    return path


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def counter(value):
    return type(value) is int and value >= 0


def scope(manifest, task_hash):
    data, protocol = copy.deepcopy(manifest['data']), copy.deepcopy(manifest['protocol'])
    data.pop('calibrationHash')
    protocol.pop('scheduleHash')
    return hash_v1({'sourceCommit': manifest['sourceCommit'], 'actor': manifest['actor'], 'data': data,
        'protocol': protocol, 'taskBundleHash': task_hash, 'runtime': manifest['runtime'], 'hardware': manifest['hardware']})


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


def native_report(reference, inputs):
    plan_path = checked_file(reference['plan'], inputs)
    plan = read(plan_path)
    require(plan.get('version') == 1 and plan['stage'] in ('development', 'heldout'), 'Original complete paired plan required')
    original, scheduled = plan['originalRuns'], plan['runs']
    require(original and plan['originalScheduleHash'] == hash_v1(original)
        and len({row['runId'] for row in original}) == len(original)
        and len(scheduled) == len(original)
        and {row['runId']: row for row in original} == {row['runId']: row for row in scheduled}, 'Original native denominator/order membership changed')
    if plan['stage'] == 'heldout':
        frozen = sealed(read(checked_file(reference['heldoutSelection'], inputs)))
        # The freeze seals scheduling fields before preparation attaches domain tools.
        # Remove only that added field; every assignment and its order remain bound.
        declared = [{key: value for key, value in run.items() if key != 'tools'} for run in original]
        require(all(isinstance(run.get('tools'), list) for run in original), 'Expanded schedule requires domain tools')
        require(frozen.get('developmentOnly') is True and frozen.get('heldoutOutcomesRead') is False
            and frozen['scheduleHash'] == hash_v1(declared)
            and set(frozen['families']) == {row['familyId'] for row in original}, 'Actual development-only heldout freeze required')
    expected = {row['runId']: row for row in original}
    reporter = dependency(ROOT / 'summarize_scheduler_events.py', SCHEDULER_SHA, 'study_scheduler_counts')
    actual, scopes, sources = {}, [], []
    for item in reference['cohorts']:
        receipt_path = checked_file(item, inputs)
        directory = receipt_path.parent
        require(receipt_path.name == 'cohort-receipt.json', 'Actual closed cohort receipt required')
        events = reporter.summarize(directory, RUNTIME)
        receipt = read(receipt_path)
        indexed = {row['path']: row['sha256'] for row in receipt['files']}
        for name, digest in indexed.items():
            checked_file({'path': directory / name, 'sha256': digest}, inputs)
        def member(name):
            require(name in indexed and sha(directory / name) == indexed[name], 'Closed native artifact changed during reporting')
            inputs[str((directory / name).resolve())] = indexed[name]
            return read(directory / name)
        config, manifest = member('configuration.json'), member('manifest.json')
        require(config['stage'] == plan['stage'] and scope(manifest, config['taskBundleHash']) == plan['scopeHash'], 'Native scope differs from frozen complete cohort')
        require(all(run['runId'] in expected and run == expected[run['runId']] for run in config['runs']), 'A native segment changed its original declared slots')
        rows = read_jsonl(directory / 'outcomes.jsonl')
        require(len(rows) == len(config['runs']) and {row['runId'] for row in rows} == {row['runId'] for row in config['runs']}, 'Closed native segment omitted or repeated a slot')
        observed = {row['runId']: row for row in events['rows']}
        for row in rows:
            key = row['runId']
            require(key not in actual, 'A physical native run appeared in more than one segment')
            actual[key] = safe_native_row(expected[key], row, member(key + '.json'), observed[key])
        scopes.append(manifest)
        sources.append({'cohortReceiptSha256': sha(receipt_path), 'runtimeEventsSha256': events['runtimeEventsSha256'],
            'schedulerCountsComplete': events['complete'], 'declaredSlots': len(rows)})
    require(set(actual) == set(expected), 'Final native report requires every original slot, including failures')
    rows = [actual[slot['runId']] for slot in original]
    actor_hash, memory_hash = hash_v1(scopes[0]['actor']), scopes[0]['data']['memoryHash']
    require(all(hash_v1(value['actor']) == actor_hash and value['data']['memoryHash'] == memory_hash for value in scopes), 'Actor or frozen memory changed across native segments')
    design = TrialDesign.model_validate({'measurement_kind': 'live', 'label': 'Custom tau-compatible paired ' + plan['stage'],
        'source_commit': RUNTIME, 'actor_config_hash': actor_hash, 'memory_snapshot_hash': memory_hash,
        'frozen_before_execution': True, 'annotation_review': scopes[0]['protocol'].get('annotationReview'),
        'trials': [{'slot_id': row['runId'], 'task_id': row['taskId'], 'family_id': row['familyId'], 'domain': row['domain'],
            'trial': row['trial'], 'seed': row['seed'], 'arm': row['arm']} for row in rows]})
    def results(success='success', clock='totalTrialSeconds'):
        return [TrialResult.model_validate({'slot_id': row['runId'], 'run_id': row['runId'], 'status': row['status'],
            'success': row[success], 'latency_valid': row['timingValid'] and row[clock] is not None,
            'latency_ms': 1000 * row[clock] if row[clock] is not None else None, 'cost_usd': row['billedUsd'],
            'logical_calls': row['logicalCalls'], 'physical_calls': row['physicalCalls'], 'revalidation_calls': row['revalidationCalls'],
            'speculative_starts': row['schedulerCounts']['started'] if row['schedulerCounts'] is not None else None,
            'useful_speculations': row['schedulerCounts']['useful'] if row['schedulerCounts'] is not None else None,
            'constraint_violations': row['constraintViolations'], 'actor_config_hash': actor_hash, 'memory_snapshot_hash': memory_hash}) for row in rows]
    native = report_trials(design, results())
    clean = report_trials(design, results('knownConstraintCleanSuccess'))
    full = report_trials(design, results(clock='totalIncludingEvaluationSeconds'))
    # Public reporting groups two executions per task. These executions change
    # both actor and predictor seed in this frozen study, so this is not pass^2
    # for a single fixed checkpoint.
    consistency = 'joint_actor_and_predictor_seed_consistency'
    for report in (native, clean, full):
        for arm in report['arms'].values():
            arm[consistency] = arm.pop('two_trial_consistency')
        report['twoTrialInterpretation'] = 'Joint actor/predictor-seed consistency; not same-fixed-checkpoint pass^2'
    extra = {}
    for arm in native['arms']:
        group = [row for row in rows if row['arm'] == arm]
        cost = summarize_costs(group)
        families = defaultdict(list)
        for row in group:
            families[row['domain'] + ':' + row['familyId']].append(float(row['success']))
        interval = _paired_interval(families, seed=42, samples=2000)
        interval['weighting'] = 'equal_family_mean_of_native_completion_indicators'
        interval['trials'] = interval.pop('paired_trials')
        seed_metrics = {}
        for seed in sorted({row['predictorTrainingSeed'] for row in group}):
            subset = [row for row in group if row['predictorTrainingSeed'] == seed]
            seed_metrics[str(seed)] = {'declaredTrials': len(subset), 'nativeSuccesses': sum(row['success'] for row in subset),
                'knownConstraintCleanSuccesses': sum(row['knownConstraintCleanSuccess'] for row in subset),
                'actorSeeds': sorted({row['seed'] for row in subset})}
        extra[arm] = {'nativePass1FamilyBootstrap': interval, 'byPredictorTrainingSeed': seed_metrics,
            'constraintAuditCompleteTrials': sum(row['constraintAuditComplete'] for row in group),
            'knownConstraintCleanPass1': clean['arms'][arm]['pass1'], 'knownConstraintCleanJointSeedConsistency': clean['arms'][arm][consistency],
            'hostedUsage': {**cost, 'missingKnownSubtotalTrials': sum(row['knownUsageSubtotalMissing'] for row in group),
                'scope': 'hosted_user_and_judge_only', 'gpuCostsIncluded': False, 'invoiceVerified': False},
            'schedulerEvents': {kind: {'knownTotal': sum(row['schedulerCounts'][kind] for row in group if row['schedulerCounts'] is not None),
                'missingTrials': sum(row['schedulerCounts'] is None for row in group)} for kind in COUNTS},
            'nativeUnpromotedPhysicalCalls': {'knownTotal': sum(row['unpromotedCalls'] for row in group if row['unpromotedCalls'] is not None),
                'missingTrials': sum(row['unpromotedCalls'] is None for row in group)}}
    return {'status': 'closed', 'stage': plan['stage'], 'officialFullBenchmarkScore': False, 'planHash': hash_v1(plan),
        'declaredSlots': len(rows), 'sources': sources, 'nativeCompletionAndLiveLatency': native,
        'knownConstraintCleanPairedDifferences': clean['paired_comparisons'], 'evaluatorInclusiveLatency': full,
        'additionalArmMetrics': extra, 'predictorSeedTrialCounts': dict(Counter(str(row['predictorTrainingSeed']) for row in rows)),
        'seedDesignLimitation': ('Heldout trial0 uses actor17/predictor17 and trial1 actor29/predictor29; consistency changes both seeds.'
            if plan['stage'] == 'heldout' else 'Development variantv0 uses predictor17 and variantv1 predictor29, actor17 in both; between-weight comparison is confounded by task variant.'),
        'causalComparisonScope': 'Paired arm differences within the original frozen blocks; no causal contrast between predictor seeds',
        'constraintScope': 'Configured complete NL assertion audit, not a complete policy compliance proof',
        'physicalCalls': 'Authoritative + speculative + freshness validation + revalidation; unknown counts stay unknown',
        'schedulerCountSource': 'Verified runtime events; rejected/cancelled cost-log defaults are ignored',
        'latencyScope': 'Live totalTrialSeconds includes actor/user drain; evaluator-inclusive elapsed time reported separately'}


def token_diagnostic(value):
    sealed(value)
    require(value.get('kind') == 'acephale-teacher-forced-training-diagnostic' and value.get('nativeTaskAccuracy') is None,
        'Actual teacher-forced diagnostic required')
    groups = defaultdict(list)
    require(value.get('rows'), 'Actual nonempty teacher-forced rows required')
    for row in value['rows']:
        require(counter(row['completionTokens']) and row['completionTokens'] > 0 and counter(row['correctTokens'])
            and row['correctTokens'] <= row['completionTokens'] and numeric(row['completionLoss']), 'Invalid teacher-forced token counts')
        groups[row['task']].append(row)
        groups['all_completion_tokens'].append(row)
    return {'partition': value['partition'], 'nativeTaskAccuracy': None, 'freeRunningToolAccuracy': None,
        'metrics': {name: {'examples': len(rows), 'completionTokens': sum(row['completionTokens'] for row in rows),
            'tokenAccuracy': sum(row['correctTokens'] for row in rows) / sum(row['completionTokens'] for row in rows),
            'completionCrossEntropyNats': sum(row['completionLoss'] * row['completionTokens'] for row in rows) / sum(row['completionTokens'] for row in rows)}
            for name, rows in groups.items()}, 'interpretation': 'Teacher-forced completion-token accuracy/loss; not tool or task accuracy'}


def main_training(reference, inputs):
    proof_path = checked_file(reference['localVerification'], inputs)
    proof = read(proof_path)
    root = proof_path.parent
    receipt_path = checked_file(reference['exportReceipt'], inputs)
    receipt = read(receipt_path)
    archive = checked_file({'path': str(root / 'main-evidence.tar.gz'), 'sha256': receipt['archiveSha256']}, inputs)
    require(proof.get('verified') is True and proof.get('completed') is True and proof.get('completedTrainingSeeds') == [17, 29]
        and receipt.get('completed') is True and receipt.get('declaredSeeds') == receipt.get('completedTrainingSeeds') == [17, 29]
        and proof['archiveSha256'] == receipt['archiveSha256'] and receipt['bytes'] == archive.stat().st_size
        and proof['trainingSourceCommit'] == receipt['trainingSourceCommit'] == RUNTIME
        and all(proof[key] == receipt[key] for key in ('leaseId', 'instanceId')), 'Both actual closed main seeds required')
    with tarfile.open(archive, 'r:gz') as bundle:
        inventory = json.load(bundle.extractfile('main-inventory.json'))
        indexed = {row['path']: row for row in inventory['files']}
        require(len(indexed) == len(inventory['files']) == proof['filesVerified'] == receipt['fileCount']
            and all(inventory.get(key) == receipt[key] for key in ('leaseId', 'instanceId', 'trainingSourceCommit'))
            and len(bundle.getnames()) == len(set(bundle.getnames()))
            and set(bundle.getnames()) == {'main-inventory.json', *indexed}, 'Verified main inventory differs')
        def member(name):
            require(name in indexed, 'Main metadata absent from closed inventory')
            data = bundle.extractfile(name).read()
            require(len(data) == indexed[name]['bytes'] and hashlib.sha256(data).hexdigest() == indexed[name]['sha256'], 'Main metadata bytes changed')
            return sealed(json.loads(data))
        summary = member('main-continuation/main-completed.json')
        completion = member('main-run/completion.json')
        require(completion['status'] == 'completed'
            and [row['stage'] for row in completion['stages']] == [f'seed{seed}-{stage}' for seed in (17, 29) for stage in ('train', 'export', 'evaluate')]
            and summary['experimentCompletionHash'] == completion['contentHash']
            and [row['seed'] for row in summary['seeds']] == [17, 29], 'Both complete managed training sequences required')
        seeds = {}
        for seed in (17, 29):
            base = f'main-run/seed{seed}-'
            training = member(base + 'train/artifacts/artifacts/receipt.json')
            specification = member(base + 'train/artifacts/artifacts/training-specification.json')
            artifact = member(base + 'export/artifacts/artifacts/predictor.json')
            verification = member(base + 'export/artifacts/artifacts/verification.json')
            evaluation = member(base + 'evaluate/artifacts/artifacts/evaluation.json')
            require(training['status'] == 'completed' and training['seed'] == seed and training['steps'] == 204
                and training['specificationHash'] == specification['contentHash'] == artifact['trainingManifestHash']
                and training['trainingManifestHash'] == specification['datasetManifestHash']
                and training['frozenBeforeHash'] == training['frozenAfterHash'] and training['adapterBeforeHash'] != training['adapterAfterHash']
                and training['gradientChecks'] > 0 and hash_v1(training['adapterFiles']) == artifact['adapterHash']
                and verification['receiptHash'] == training['contentHash'] and verification['artifactHash'] == artifact['contentHash']
                and verification['reload']['allClose'] is True and verification['reload']['atol'] == .03 and verification['reload']['rtol'] == .02,
                'Main weight update/reload lineage differs')
            require(evaluation['trainingManifestHash'] == training['trainingManifestHash'] and evaluation['partition'] == 'development', 'Teacher-forced dataset identity differs')
            seeds[str(seed)] = {'optimizerSteps': training['steps'], 'elapsedSeconds': training['elapsedSeconds'],
                'peakGpuBytes': training['peakGpuBytes'], 'predictorArtifactHash': artifact['contentHash'],
                'trainingSpecificationHash': specification['contentHash'], 'actualAdapterChanged': True, 'frozenBaseUnchanged': True,
                'strictReloadPassed': True, 'servingQualificationAssumed': False, 'teacherForced': token_diagnostic(evaluation)}
    return {'status': 'closed', 'trainingSourceCommit': RUNTIME, 'archiveSha256': receipt['archiveSha256'], 'seeds': seeds,
        'winnerSelected': False, 'nativeTaskSuccessMeasuredByTraining': False}


def replay_reports(config, inputs, main):
    bundle = Path(config['bundleDirectory'])
    bundle_manifest = verify_bundle(bundle)
    inputs[str((bundle / 'manifest.json').resolve())] = sha(bundle / 'manifest.json')
    for name, metadata in bundle_manifest['files'].items():
        checked_file({'path': bundle / name, 'sha256': metadata['sha256']}, inputs)
    labels = {row['checkpoint_id']: row for row in read_jsonl(bundle / 'labels.jsonl')}
    partitions = checked_file(config['partitions'], inputs)
    memory = checked_file(config['memory'], inputs)
    for name in ('partition.json', 'source-design-review.json'):
        checked_file({'path': partitions.parent / name, 'sha256': sha(partitions.parent / name)}, inputs)
    selection = load_reviewed_selection(partitions, memory, bundle_manifest['bundle_hash'], read_jsonl(bundle / 'public.jsonl'))
    partition_names = ('weightFitFamilies', 'calibrationFamilies', 'developmentFamilies')
    family_partition = {family: key for key in partition_names for family in selection[key]}
    all_rows, reports, seed_conditions, neutral_runs = [], [], defaultdict(set), {}
    compiler_identity = None
    require(config['conditions'] and len({item['name'] for item in config['conditions']}) == len(config['conditions'])
        and len({(item.get('predictorTrainingSeed'), item['condition']) for item in config['conditions']}) == len(config['conditions']),
        'Unique named replay conditions and predictor seeds required')
    for item in config['conditions']:
        verification_path = checked_file(item['localVerification'], inputs)
        verification = read(verification_path)
        checked_file({'path': item['archivePath'], 'sha256': verification['archiveSha256']}, inputs)
        require(verification.get('localExportVerified') is True and verification.get('completed') is True
            and verification.get('containerDrained') is True and verification.get('nativeActorTrials') == 0
            and verification.get('timingScope') == 'prediction_replay_only', 'Closed prediction-only local export required')
        root = Path(item['directory'])
        manifest = sealed(read(root / 'manifest.json'))
        identity = {key: manifest[key] for key in ('sourceDatasetHash', 'memoryHash', 'predictorContractHash',
            'candidateCompilerHash', 'retrievalHash', 'predictionMode', 'rawScoreSemantics', 'panelSelection',
            'partition', 'predictionProtocol', 'binaryTokenIds', 'serving', 'selection', 'limit', 'rowIds', 'compilerAuditVersion', 'episodic')}
        require(manifest['memoryHash'] == selection['memoryHash'] and (compiler_identity is None or compiler_identity == identity),
            'Replay compiler, memory, tokenizer, panel selection or checkpoint universe changed')
        compiler_identity = identity
        condition = item['condition']
        seed = item.get('predictorTrainingSeed')
        if seed is None:
            counts = verification['counts']
            require(condition == 'base-neutral' and 'trainedPredictor' not in manifest['model'], 'Explicit untrained base replay required')
        else:
            require(seed in (17, 29) and main.get('status') == 'closed' and condition in ('neutral-fixed', 'goals-fixed'), 'Both trained seed artifacts must already be closed')
            counts = verification['counts'][condition]
            artifact = manifest['model']['trainedPredictor']
            require(verification['sourceCommit'] == RUNTIME and artifact['contentHash'] == main['seeds'][str(seed)]['predictorArtifactHash'], 'Replay used another trained seed')
            closure = dependency(ROOT / 'phase2-orchestration/closed_replay.py', CLOSED_REPLAY_SHA, 'study_closed_replay')
            closure.verify(root)
            seed_conditions[seed].add(condition)
        if condition in ('base-neutral', 'neutral-fixed'):
            neutral_runs[item['name']] = root
        require(counts['manifestSha256'] == sha(root / 'manifest.json') and (counts.get('receiptSha256') or counts.get('predictionReceiptSha256')) == sha(root / 'receipt.json'),
            'Prediction files differ from verified export')
        report, rows = score_fixed_panel_replay(bundle, root)
        # Bind all retained response payloads too, beyond the public scorer's
        # exact ordered prediction/receipt and response-hash validation.
        for path in root.rglob('*'):
            if path.is_file():
                checked_file({'path': path, 'sha256': sha(path)}, inputs)
        raw = {row['checkpoint_id']: row for row in read_jsonl(root / 'predictions.jsonl')}
        tool_counts = defaultdict(lambda: defaultdict(lambda: {'eligibleKnownReadPrefixes': 0, 'correctToolNameTop1': 0, 'correctToolAndFullArgumentsTop1': 0}))
        action_counts = defaultdict(lambda: defaultdict(Counter))
        for row in rows:
            original_condition = row['condition']
            row['condition'] = item['name'] + '/' + original_condition
            require(row['family_id'] in family_partition, 'Unexpected heldout or undeclared family in replay')
            action = action_counts[family_partition[row['family_id']]][original_condition]
            action['declaredPrefixes'] += 1
            action['status_' + row['status']] += 1
            if row['status'] != 'unobserved_actor_action':
                action['knownNoReadPrefixes' if not row['actual_reads'] else 'knownReadPrefixes'] += 1
                if row['status'] == 'completed':
                    predicted = raw[row['checkpoint_id']][original_condition]['action']
                    action['predicted_' + predicted] += 1
                    if not row['actual_reads'] and predicted == 'NO_READ':
                        action['correctNoRead'] += 1
            if row['actual_reads'] and row['status'] != 'unobserved_actor_action':
                require(row['family_id'] in family_partition, 'Unexpected heldout or undeclared family in replay')
                count = tool_counts[family_partition[row['family_id']]][original_condition]
                count['eligibleKnownReadPrefixes'] += 1
                if row['status'] == 'completed' and row['candidate_panel']:
                    first = sorted(row['candidate_panel'], key=lambda key: (-row['probabilities'][key], key))[0]
                    invocations = {hash_v1({'tool': candidate['invocation']['tool'], 'arguments': candidate['invocation']['arguments']}): candidate['invocation'] for candidate in raw[row['checkpoint_id']]['candidates']}
                    tool = invocations[first]['tool']
                    count['correctToolNameTop1'] += any(value['tool'] == tool for value in labels[row['checkpoint_id']]['eligible_reads'])
                    count['correctToolAndFullArgumentsTop1'] += first in row['actual_reads']
        for partition in tool_counts.values():
            for value in partition.values():
                value['toolNameTop1Rate'] = value['correctToolNameTop1'] / value['eligibleKnownReadPrefixes']
                value['exactInvocationTop1Rate'] = value['correctToolAndFullArgumentsTop1'] / value['eligibleKnownReadPrefixes']
                value['fullArgumentsMatchGivenCorrectTool'] = value['correctToolAndFullArgumentsTop1'] / value['correctToolNameTop1'] if value['correctToolNameTop1'] else None
        all_rows.extend(rows)
        for name in ('manifest.json', 'receipt.json', 'predictions.jsonl'):
            inputs[str((root / name).resolve())] = sha(root / name)
        times = {}
        for partition in partition_names:
            values = [row.get('audit', {}).get('rowWallMs') for row in raw.values() if row['family_id'] in selection[partition]]
            known = [value for value in values if numeric(value)]
            times[partition] = {'declaredCheckpoints': len(values), 'samples': len(known), 'meanReplayWallMs': sum(known) / len(known) if known else None,
                'missingTimingRows': len(values) - len(known), 'liveLatencyMeasured': False}
        reports.append({'name': item['name'], 'predictorTrainingSeed': seed, 'executionSourceCommit': verification['sourceCommit'],
            'predictionManifestHash': manifest['contentHash'], 'supplementalFitInclusiveScores': report,
            'partitionScores': {key: score_candidate_panels([row for row in rows if row['family_id'] in selection[key]]) for key in partition_names},
            'readToolNameAndArgumentScoresByPartition': {key: dict(value) for key, value in tool_counts.items()},
            'readStateAndFailureCountsByPartition': {key: {condition: {**counts,
                'noReadAccuracyOverDeclaredKnownNoRead': counts['correctNoRead'] / counts['knownNoReadPrefixes'] if counts['knownNoReadPrefixes'] else None}
                for condition, counts in value.items()} for key, value in action_counts.items()},
            'denominator': 'Known immediate next-batch eligible read prefixes; failures retained as misses. Not all tools or task success.',
            'liveLatencyMeasured': False, 'replayTiming': times,
            'timingLimitation': 'Observed per-checkpoint replay wall time includes prediction overhead; not native task latency.'})
    if seed_conditions:
        require(dict(seed_conditions) == {17: {'neutral-fixed', 'goals-fixed'}, 29: {'neutral-fixed', 'goals-fixed'}}, 'Both seeds and both fixed conditions required; no winner selection')
    comparison = None
    if seed_conditions:
        require(len(neutral_runs) == 3, 'One base plus both trained neutral runs required for primary weight comparison')
        comparison, _ = compare_predictor_replays(bundle, neutral_runs, partitions, memory)
    return {'status': 'closed', 'sourceDatasetHash': bundle_manifest['bundle_hash'], 'reviewedSelection': selection, 'conditions': reports,
        'primaryDevelopmentNeutralWeightComparison': comparison,
        'developmentFixedPanelComparison': score_candidate_panels([row for row in all_rows if row['family_id'] in selection['developmentFamilies']]),
        'supplementalFitInclusivePanelComparison': score_candidate_panels(all_rows),
        'selectedOperationalHitRate': None, 'selectedOperationalHitRateMeasured': False,
        'fitInclusiveResultsAreDiagnosticOnly': True, 'nativeTaskAccuracy': None, 'trueConditionalEntropyMeasured': False}


def verify_goal_batches(plan_path, union_path, inputs):
    helper = ROOT / 'verify_report_goal_grades.mts'
    checked_file({'path': helper, 'sha256': sha(helper)}, inputs)
    checked_file({'path': ROOT / 'calibration_goal_grading_analysis.ts',
        'sha256': '6b44336ac208c8bb03e05e40d51dc7911d99a913a3043ad8931d827f67ff2803'}, inputs)
    process = subprocess.run([str(NODE), '--import', 'tsx', str(helper), str(plan_path), str(union_path)],
        cwd=ANALYSIS_ROOT, capture_output=True, text=True, encoding='utf-8', timeout=600, check=True)
    result = json.loads(process.stdout)
    require(result['modelCallsPerformed'] is False and result['journalOpened'] is False,
        'Only strict read-only grading ancestry replay permitted')
    return result['batches']


def goal_agreement(references, inputs, main):
    """Read the strict sealer's immutable highest-goal grades, never regrade."""
    require(main.get('status') == 'closed' and len(references) == 2, 'Both actual trained seed grading unions required')
    result = {}
    for reference in references:
        path = checked_file(reference, inputs)
        union = sealed(read(path))
        plan_path = checked_file(reference['plan'], inputs)
        plan = sealed(read(plan_path))
        seed = union['predictorTrainingSeed']
        require(seed in (17, 29) and str(seed) not in result
            and union['kind'] == 'acephale-calibration-grade-union-v1'
            and union['predictorArtifactHash'] == main['seeds'][str(seed)]['predictorArtifactHash']
            and union['declared'] == union['retained'] == len(union['rowIds']) == len(set(union['rowIds'])) == 141
            and union['failuresCountAsDisagreement'] is True and union['allWorkersDrained'] is True
            and union['humanAuditPerformed'] is False and union['crossWeightGradeReuse'] is False,
            'Exact per-weight complete calibration grading union required')
        require(plan['contentHash'] == union['selectionPlanHash']
            and plan['runtimeSourceCommit'] == RUNTIME and plan['analysisSourceCommit'] == ANALYSIS
            and plan['model'] == 'gpt-5.4-2026-03-05' and plan['rowIds'] == union['rowIds']
            and plan['predictorTrainingSeed'] == seed and plan['predictorArtifactHash'] == union['predictorArtifactHash']
            and plan['predictionManifestHash'] == union['predictionManifestHash']
            and plan['annotationsHash'] == union['annotationsHash'] and plan['sourceFiles'] == union['sourceFiles']
            and plan['sourceFiles'], 'Original strict per-weight grading plan and ancestry required')
        grades_path = checked_file({'path': path.parent / 'grades.jsonl', 'sha256': union['gradesSha256']}, inputs)
        grades = read_jsonl(grades_path)
        require([row['checkpoint_id'] for row in grades] == union['rowIds']
            and union['agreed'] == sum(row['agreed'] is True for row in grades)
            and union['completed'] == sum(row['status'] == 'completed' for row in grades), 'Grading denominator changed')
        batches, known, unknown, sdk = [], 0, 0, 0
        required_files = {'plan.json', 'summary.json', 'grades.jsonl', 'compiler.jsonl', 'api-requests.jsonl', 'raw-responses.jsonl', 'provider-events.jsonl'}
        require([batch['number'] for batch in union['batches']] == [1, 2], 'Both original grading batches required')
        verified_batches = verify_goal_batches(plan_path, path, inputs)
        require(len(verified_batches) == 2, 'Both strict SDK history checks required')
        for batch, verified in zip(union['batches'], verified_batches, strict=True):
            directory = Path(batch['directory'])
            require(set(batch['files']) == required_files, 'Full strict grading provenance inventory required')
            for name, digest in batch['files'].items():
                checked_file({'path': directory / name, 'sha256': digest}, inputs)
            summary = sealed(read(directory / 'summary.json'))
            require(summary['contentHash'] == batch['summaryHash'] and summary['allWorkersDrained'] is True,
                'Actual closed grading batch required')
            batch_rows = read_jsonl(directory / 'grades.jsonl')
            require(verified['number'] == batch['number'] and verified['summaryHash'] == batch['summaryHash']
                and verified['files'] == batch['files'] and verified['gradesHash'] == hash_v1(batch_rows),
                'Strict original wire/history verifier disagrees with grade union')
            batches.extend(batch_rows)
            known += summary['knownMicrodollars']
            unknown += summary['unresolvedRequests']
            sdk += summary['actualApiDispatches']
        require(batches == grades and all(type(row['agreed']) is bool and (row['status'] == 'completed' or row['agreed'] is False)
            and row['reviewer'] == 'gpt-5.4-2026-03-05' and row['grading_kind'] == 'independent_model' for row in grades),
            'Failed/missing grades remain disagreements and exact teacher identity is required')
        for name, digest in union['sourceFiles'].items():
            checked_file({'path': name, 'sha256': digest}, inputs)
        result[str(seed)] = {'declaredCalibrationPrefixes': len(grades), 'completedGrades': union['completed'],
            'agreed': union['agreed'], 'goalTop1Agreement': union['agreed'] / len(grades), 'goalTop3Agreement': None,
            'statusCounts': dict(Counter(row['status'] for row in grades)), 'receiptHash': union['contentHash'],
            'knownGradingCostUsd': known / 1_000_000, 'unknownRequests': unknown, 'actualSdkRequests': sdk,
            'humanReviews': 0, 'scope': 'Highest-probability complete inferred goal against highest-confidence teacher goal; calibration only'}
    return {'status': 'closed', 'seeds': result, 'top3Measured': False,
        'limitation': 'The declared semantic rubric grades only Top1; calibration agreement is not heldout goal accuracy.'}


def assemble(config):
    verify_source(ANALYSIS_ROOT, ANALYSIS)
    inputs = {}
    missing = lambda reason: {'status': 'not_available', 'reason': reason}
    main = main_training(config['mainTraining'], inputs) if config.get('mainTraining') else missing('No complete verified two-seed main export supplied')
    prediction = replay_reports(config['predictionReplay'], inputs, main) if config.get('predictionReplay') else missing('No closed prediction replay supplied')
    native = {stage: native_report(value, inputs) for stage, value in config.get('nativeCohorts', {}).items()}
    require(all(stage == value['stage'] for stage, value in native.items()), 'Native stage label differs from actual plan')
    finance = missing('Original-journal owner has not supplied a read-only public budget report')
    if config.get('financialReport'):
        finance = read(checked_file(config['financialReport'], inputs))
        require(finance.get('schemaVersion') == 1 and finance.get('currency') == 'USD' and 'allocations' in finance
            and all(numeric(finance.get(key)) for key in ('totalKnownUsageCostUsd', 'totalSpentOrReservedUsd',
                'infrastructureKnownCostUsd', 'infrastructureSpentOrReservedUsd')) and counter(finance.get('unresolvedRequests')),
            'Public original-journal budget report required')
        finance = {'status': 'snapshot', 'publicBudgetReport': finance, 'invoiceReconciled': False,
            'interpretation': 'Settled known costs and unresolved commitments are separate; never add this total to native hosted subtotals.'}
    historical = []
    for item in config.get('historicalCollections', []):
        value = sealed(read(checked_file(item, inputs)))
        require(value.get('pairedComparisonPerformed') is False and value.get('arms') == ['base'], 'Historical collection must remain descriptive single-base evidence')
        historical.append({'label': value['label'], 'contentHash': value['contentHash'], 'overall': value['overall'],
            'usedAsPairedBenchmarkControl': False})
    body = {'kind': 'acephale-evidence-backed-study-report-v1', 'targetRuntimeSourceCommit': RUNTIME, 'analysisSourceCommit': ANALYSIS,
        'reporterSha256': sha(__file__), 'mainTraining': main, 'predictionReplay': prediction,
        'goalAgreement': goal_agreement(config['goalGrading'], inputs, main) if config.get('goalGrading') else {'status': 'not_available', 'top1': None, 'top3': None,
            'reason': 'No independently verified per-weight teacher grading union supplied; ranking and token accuracy do not substitute for goal agreement'},
        'nativeDevelopment': native.get('development', missing('No closed complete paired development cohort supplied')),
        'nativeHeldout': native.get('heldout', missing('No closed complete paired held-out cohort supplied')),
        'historicalCollections': historical, 'financialAccounting': finance, 'inputFiles': inputs,
        'modelCallsPerformed': False, 'journalOpened': False, 'winnerSelected': False,
        'limitations': ['Custom tau-compatible study, not an official full-benchmark score.',
            'Task success, exact-read ranking, binary membership log loss and teacher-forced token accuracy are distinct metrics.',
            'Prediction binary cross-entropy is not full-action cross-entropy or true conditional entropy.',
            'Observed p95 latency carries sample counts and is not a population tail guarantee.',
            'Native family-clustered paired intervals use equal-family means and retain all declared failures.',
            'Heldout two-trial consistency changes both actor and predictor seeds; it is not fixed-checkpoint pass^2.',
            'Development task variant is confounded with predictor seed; only within-block paired arm contrasts are causal comparisons.',
            'Unknown constraint audits are not known constraint-clean successes; missing telemetry and cost remain unknown.']}
    require(all(sha(path) == expected for path, expected in inputs.items()), 'Reporting inputs changed during assembly')
    return {**body, 'contentHash': hash_v1(body)}


def markdown(value):
    lines = ['# Acephale study results', '', 'Custom tau-compatible study; distinct measurement denominators are retained.', '',
        '| Evidence | Status |', '| --- | --- |']
    for key in ('mainTraining', 'predictionReplay', 'nativeDevelopment', 'nativeHeldout', 'financialAccounting'):
        lines.append(f"| {key} | {value[key]['status']} |")
    for key in ('nativeDevelopment', 'nativeHeldout'):
        section = value[key]
        if section['status'] != 'closed':
            continue
        lines.extend(['', f'## {section["stage"]} native tasks', '', '| Arm | Pass1 | Known constraint-clean | Live mean / p95 (ms) | n |',
            '| --- | ---: | ---: | ---: | ---: |'])
        for arm, row in section['nativeCompletionAndLiveLatency']['arms'].items():
            extra = section['additionalArmMetrics'][arm]
            lines.append(f"| {arm} | {row['successes']}/{row['scheduled_trials']} | {extra['knownConstraintCleanPass1']:.3f} | "
                f"{row['mean_latency_ms']} / {row['observed_p95_latency_ms']} | {row['latency_samples']} |")
    lines += ['', 'Both optimizer seeds, exact-read/tool-name denominators, token diagnostics, counters, unknown costs and paired family intervals are preserved in report.json. Missing sections contain no invented results.', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configuration', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    value = assemble(read(args.configuration))
    args.output.mkdir(parents=True, exist_ok=False)
    for name, content in [('report.json', json.dumps(value, indent=2, allow_nan=False) + '\n'), ('report.md', markdown(value))]:
        with (args.output / name).open('x', encoding='utf-8') as stream:
            stream.write(content)
    print(json.dumps({'contentHash': value['contentHash'], 'output': str(args.output), 'journalOpened': False}))
