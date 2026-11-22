'Prepare original complete selected cohorts and serving segments without dispatch.\nReservation remains with the existing original-journal owner. The declared direct-mode runtime does not assert qualification; original cohort, scope, training, order, budget and timeout checks remain.'
from __future__ import annotations
import os
import sys as _sys
_sys.path.insert(0, '/workspace/acephale/migration/raw/USER_HOME/outputs/acephale-staged-study-20261113/phase2-orchestration')

import argparse
import copy
import json
import subprocess
import time
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.experiment_runner import Experiment, verify_source
from acephale.infra_native_runner import validate_task_bundle
from acephale.infra_split_guard import load_guard
from acephale.storage import file_hash
from acephale.training_data import hashed, verify_hashed, write_new

from prepare_downstream import schedule_segments


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def observed_scope(manifest, task_hash):
    data, protocol = copy.deepcopy(manifest['data']), copy.deepcopy(manifest['protocol'])
    data.pop('calibrationHash')
    protocol.pop('scheduleHash')
    return hash_v1({'sourceCommit': manifest['sourceCommit'], 'actor': manifest['actor'], 'data': data,
                   'protocol': protocol, 'taskBundleHash': task_hash,
                   'runtime': manifest['runtime'], 'hardware': manifest['hardware']})


COHORT_SCOPE_AMENDMENT_HASH = '2abf91607b461eb26aeba8990941ea71ed33673c78faf5b65465219924fd6c47'
COHORT_SCOPE_MAPPING = {'716d8771026f9279d641fca01d79d8e06e90d8986b7b3d5d9c10c134f30c7854': '0ef224e790e4961045eff19ce6e441100548d4defe878bc61f3ffab2011b39a7', 'e5eedc498396fc5cc8d9c4818eb0eba87eb277829f26d428e5d4e5bb5dc36b8e': '0ef224e790e4961045eff19ce6e441100548d4defe878bc61f3ffab2011b39a7'}

def scope(manifest, task_hash):
    observed = observed_scope(manifest, task_hash)
    return COHORT_SCOPE_MAPPING.get(observed, observed)


def expand_schedule(rows, tools):
    # Preserve every original scheduling field, not merely the runtime subset.
    return [{**row, 'tools': tools[row['domain']]} for row in rows]


def preserved_segments(receipt, original):
    inherited = receipt.get('groupingInheritedFrom')
    if inherited is None:
        return schedule_segments(original, group_seed=receipt['groupOrderSeed'])
    from freeze_target_heldout import original_schedule
    parent_path = Path(inherited['path'])
    require(file_hash(parent_path) == inherited['sha256'], 'Original target grouping receipt changed')
    parent, target = original_schedule(parent_path)
    require(parent['contentHash'] == inherited['contentHash']
        and receipt['groupOrderSeed'] == parent['groupOrderSeed'], 'Inherited target grouping identity changed')
    families = {row['familyId'] for row in original}
    require(original == [row for row in target if row['familyId'] in families],
            'Heldout subset must retain whole original family grids and order')
    selected_ids = {row['runId'] for row in original}
    segments = []
    for part in parent['segments']:
        rows = [row for row in part['runs'] if row['runId'] in selected_ids]
        if rows:
            segments.append({'number': len(segments) + 1, 'predictorTrainingSeed': part['predictorTrainingSeed'], 'runs': rows})
    require([part['predictorTrainingSeed'] for part in segments] == [17, 29], 'Original heldout17-to29 order required')
    return segments


def segment_guard(qualified_configuration, configuration_path, maximum):
    qualified_configuration = Path(qualified_configuration).resolve()
    native = read(qualified_configuration)
    guard_path = (qualified_configuration.parent / native['splitGuardPath']).resolve()
    guard, _ = load_guard(guard_path)
    require(type(maximum) is int and 1 <= maximum <= 28800, 'Bounded current-segment guard duration required')
    updated = copy.deepcopy(guard)
    for key in ('knownHostsPath', 'identityFilePath', 'deploymentPath', 'inventoryEvidencePath'):
        if key in updated:
            updated[key] = str((guard_path.parent / updated[key]).resolve())
    updated['configurationPath'] = str(Path(configuration_path).resolve())
    updated['maximumLifetimeSeconds'] = maximum
    return updated, guard_path


def prepare_cohort(configuration_path, output):
    value, output = read(configuration_path), Path(output)
    source = Path(value['sourceDirectory'])
    verify_source(source, value['sourceCommit'])
    schedule_receipt = verify_hashed(read(value['segmentsReceiptPath']))
    original_path = Path(schedule_receipt['originalSchedulePath'])
    original = read(original_path)
    require(file_hash(original_path) == schedule_receipt['originalScheduleSha256']
            and hash_v1(original) == schedule_receipt['originalScheduleHash'], 'Original paired schedule changed')
    segments = preserved_segments(schedule_receipt, original)
    require(segments == schedule_receipt['segments'], 'Whole-block serving grouping changed')
    manifest, bundle = read(value['templateManifestPath']), read(value['taskBundlePath'])
    require(manifest['sourceCommit'] == value['sourceCommit'] and value['stage'] in ('development', 'heldout'),
            'Exact prospective source and paired stage required')
    allowed = manifest['data']['developmentFamilies' if value['stage'] == 'development' else 'heldoutFamilies']
    require(all(row['familyId'] in allowed for row in original), 'Paired schedule crosses declared families')
    if value['stage'] == 'heldout':
        frozen = verify_hashed(read(value['heldoutSelectionReceiptPath']))
        require(frozen.get('developmentOnly') is True and frozen.get('heldoutOutcomesRead') is False
                and frozen['scheduleHash'] == hash_v1(original)
                and frozen['segmentsReceiptHash'] == schedule_receipt['contentHash']
                and set(frozen['families']) == {row['familyId'] for row in original},
                'Heldout size must already be frozen using development costs alone')
        require(value['hosted']['maxCostMicrodollarsPerRun'] == frozen['allowanceMicrodollarsPerRun']
                and len(original) * frozen['allowanceMicrodollarsPerRun'] == frozen['requiredReservationMicrodollars'],
                'Whole heldout reservation must use the actual frozen development allowance')
    tools = read(value['domainToolsPath'])
    runs = expand_schedule([row for segment in segments for row in segment['runs']], tools)
    plan = {'version': 1, 'stage': value['stage'], 'scopeHash': scope(manifest, hash_v1(bundle)),
            'originalRuns': expand_schedule(original, tools), 'runs': runs,
            'segments': [[row['runId'] for row in segment['runs']] for segment in segments], 'hosted': value['hosted']}
    plan['originalScheduleHash'] = hash_v1(plan['originalRuns'])
    require(value['hosted']['allocation'] == value['stage'], 'Paired hosted allocation mismatch')
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / 'cohort-plan.json', plan)
    validator = "const fs=require('node:fs');require('./services/acephale-runtime/infra-cohort-reservations.ts').validateNativeCohortPlan(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));"
    subprocess.run([value['nodeExecutable'], '--import', 'tsx', '-e', validator, str(output / 'cohort-plan.json')], cwd=source, check=True)
    inputs = {name: {'path': str(Path(value[name]).resolve()), 'sha256': file_hash(Path(value[name]))}
              for name in ('segmentsReceiptPath', 'templateManifestPath', 'taskBundlePath', 'domainToolsPath')}
    inputs['original-schedule'] = {'path': str(original_path.resolve()), 'sha256': file_hash(original_path)}
    if value['stage'] == 'heldout':
        inputs['heldout-selection'] = {'path': str(Path(value['heldoutSelectionReceiptPath']).resolve()),
                                      'sha256': file_hash(Path(value['heldoutSelectionReceiptPath']))}
    receipt = hashed({'kind': 'acephale-paired-cohort-preparation-v1', 'sourceCommit': value['sourceCommit'],
        'preparerVersion': 'acephale-paired-native-preserved-target-v2', 'preparerSha256': file_hash(Path(__file__)),
        'stage': value['stage'], 'planHash': hash_v1(plan), 'inputs': inputs,
        'declaredSlots': len(runs), 'segmentTrainingSeeds': [segment['predictorTrainingSeed'] for segment in segments],
        'reservationCommand': [value['nodeExecutable'], '--import', 'tsx', 'scripts/acephale-infra-cohort.ts',
            str(output / 'cohort-plan.json'), value['originalLedgerPath'], value['newReservationDirectory']],
        'exclusiveJournalOwnerRequired': True, 'dispatchPerformed': False, 'journalAccessed': False})
    write_new(output / 'preparation.json', receipt)
    return receipt


def prepare_segment(configuration_path, output):
    value, output = read(configuration_path), Path(output)
    source = Path(value['sourceDirectory'])
    verify_source(source, value['sourceCommit'])
    prepared = verify_hashed(read(value['cohortPreparationPath']))
    for item in prepared['inputs'].values():
        require(file_hash(Path(item['path'])) == item['sha256'], 'Frozen cohort preparation input changed')
    reservation = verify_hashed(read(value['cohortReservationPath']))
    plan = reservation['plan']
    require(hash_v1(plan) == prepared['planHash'] and prepared['sourceCommit'] == value['sourceCommit'],
            'Reservation differs from prepared complete cohort')
    number = value['segmentNumber']
    require(type(number) is int and 1 <= number <= len(plan['segments']), 'Explicit serving segment number required')
    expected_seed = prepared['segmentTrainingSeeds'][number - 1]
    native_path = Path(value['qualifiedNativeConfigurationPath'])
    native = read(native_path)
    manifest = read(native_path.parent / native['manifestPath'])
    artifact = verify_hashed(manifest['predictor']['trainedPredictor'])
    training = verify_hashed(read(value['trainingReceiptPath']))
    specification = verify_hashed(read(value['trainingSpecificationPath']))
    require(value['predictorTrainingSeed'] == expected_seed == training['seed'] == specification['seed']
            and training['status'] == 'completed' and training['specificationHash'] == specification['contentHash']
            and artifact['trainingManifestHash'] == specification['contentHash']
            and artifact['adapterHash'] == hash_v1(training['adapterFiles']),
            'Serving weights differ from preassigned training seed')
    checkpoint = read(value['freshLedgerCheckpointPath'])
    require(checkpoint['ledgerPathHash'] == reservation['ledgerPathHash']
            and checkpoint['entriesHash'] == hash_v1(checkpoint['entries']), 'Fresh original-ledger checkpoint required')
    wanted = plan['segments'][number - 1]
    runs = [row for row in plan['runs'] if row['runId'] in wanted]
    require([row['runId'] for row in runs] == wanted, 'Original segment order changed')
    memory = verify_hashed(read(value['memoryPath']))
    calibration = verify_hashed(read(value['calibrationPath']))
    require(not native.get('episodicEmbeddingsPath'), 'Frozen lexical memory required; qualification deferred under existing direct-unvalidated mode')
    manifest['experimentId'] = value['experimentId']
    manifest['budgets']['ledgerCheckpointHash'] = hash_v1(checkpoint)
    for field in ('budgetPolicyHash', 'budgetAmendmentHash'):
        require(manifest['budgets'].get(field) == checkpoint.get(field), 'Current budget policy differs from serving declaration')
    manifest['data']['memoryHash'] = memory['contentHash']
    manifest['data']['calibrationHash'] = calibration['contentHash']
    # Exact selected domains/tools; preserve every original tool schema.
    domain_tools = {}
    for row in runs:
        if row['domain'] in domain_tools:
            require(domain_tools[row['domain']] == row['tools'], 'Native domain tools changed')
        domain_tools[row['domain']] = row['tools']
    manifest['data']['toolSchemaHash'] = hash_v1([{'domain': domain, 'tools': domain_tools[domain]} for domain in sorted(domain_tools)])
    manifest['protocol']['scheduleHash'] = hash_v1(runs)
    bundle = read(value['taskBundlePath'])
    require(scope(manifest, hash_v1(bundle)) == plan['scopeHash'], 'Actor, protocol, memory, data, source or hardware changed between segments')
    maximum = value['maximumNativeSeconds']
    require(type(maximum) is int and 1 <= maximum <= 8 * 3600
            and time.time() + maximum + 300 < value['providerDeadline'], 'Full segment and export margin must fit the actual lease')
    config = {key: native[key] for key in ('version', 'actorBaseUrl', 'predictorBaseUrl', 'stream', 'otlpBaseUrl',
        'splitGuardPath', 'customTaskBundleDirectory', 'customTaskReceiptHash') if key in native}
    for field in ('customTaskBundleDirectory',):
        require(field in config, 'Verified custom task source required')
        config[field] = str((native_path.parent / config[field]).resolve())
    config.update(stage=plan['stage'], manifestPath=str((output / 'manifest.json').resolve()),
        ledgerCheckpointPath=str(Path(value['freshLedgerCheckpointPath']).resolve()),
        cohortReservationPath=str(Path(value['cohortReservationPath']).resolve()), snapshotId=memory['repositorySnapshotId'],
        runs=runs, maximumLifetimeSeconds=maximum, hosted=plan['hosted'], taskBundleHash=hash_v1(bundle))
    for field in ('memoryPath', 'calibrationPath', 'opportunityPath', 'goalReliabilityPath'):
        config[field] = str(Path(value[field]).resolve())
    config.pop('splitGuardPath', None)
    config['cohortScopeAmendmentHash'] = COHORT_SCOPE_AMENDMENT_HASH
    require(value.get('validationStatus') == 'unvalidated', 'Explicit existing direct-mode declaration required')
    validate_task_bundle(config, manifest, bundle)
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / 'manifest.json', manifest)
    write_new(output / 'configuration.json', config)
    loader = value['configurationLoader']
    runtime = value['nativeRunner']
    require(file_hash(Path(loader['path'])) == loader['sha256'] and file_hash(Path(runtime['path'])) == runtime['sha256'], 'Exact owner configuration loader and runtime required')
    validator = "import(process.argv[1]).then(m=>m.loadInfraNativeConfiguration(process.argv[2])).catch(e=>{console.error(e.message);process.exitCode=1});"
    subprocess.run([value['nodeExecutable'], '--import', 'tsx', '-e', validator, Path(loader['path']).resolve().as_uri(), str(output / 'configuration.json')], cwd=source, check=True, env={**os.environ, **value.get('operationalEnvironment', {})})
    paths = [Path(value[key]) for key in ('cohortPreparationPath', 'cohortReservationPath', 'freshLedgerCheckpointPath',
        'taskBundlePath', 'memoryPath', 'calibrationPath', 'opportunityPath', 'goalReliabilityPath', 'qualifiedNativeConfigurationPath',
        'trainingReceiptPath', 'trainingSpecificationPath')]
    paths += [output / 'manifest.json', output / 'configuration.json',
        Path(__file__), Path(loader['path']), Path(runtime['path'])]
    inputs = {f'file-{index}': {'path': str(path.resolve()), 'sha256': file_hash(path)} for index, path in enumerate(paths)}
    command = [value['nativePython'], '-I', runtime['path'], '--config', str(output / 'configuration.json'),
        '--tasks', value['taskBundlePath'], '--output', '{output}', '--budget-directory', value['budgetDirectory'], '--upstream-root', value['upstreamRoot']]
    execution = {'schemaVersion': 1, 'kind': 'acephale-experiment', 'experimentId': value['experimentId'],
        'source': str(source.resolve()), 'sourceCommit': value['sourceCommit'], 'inputs': inputs,
        'deadline': value['providerDeadline'] - 300, 'maximumSeconds': maximum + 120,
        'stages': [{'id': 'native', 'command': command, 'timeoutSeconds': maximum + 120,
                    'artifacts': [{'path': 'summary.json', 'kind': 'json', 'expected': {
                        'allDeclaredSlotsRetained': True, 'notRetried': True}}]}]}
    Experiment.model_validate(execution)
    write_new(output / 'experiment.json', execution)
    receipt = hashed({'kind': 'acephale-unvalidated-paired-native-segment-preparation-v1', 'sourceCommit': value['sourceCommit'],
        'cohortReservationHash': reservation['contentHash'], 'segmentNumber': number, 'predictorTrainingSeed': expected_seed,
        'predictorArtifactHash': artifact['contentHash'], 'runIds': wanted, 'experimentHash': hash_v1(execution),
        'configurationHash': hash_v1(config), 'manifestHash': hash_v1(manifest), 'annotationReview': manifest['protocol'].get('annotationReview'),
        'splitGuardPath': None, 'guardProvenanceHash': None, 'qualificationAsserted': False, 'validationStatus': 'unvalidated',
        'configurationLoader': loader, 'nativeRunner': runtime, 'originalCohortChecksRetained': True,
        'dispatchPerformed': False, 'ownerBudgetRpcRequired': True, 'externalManagedGuardRequired': False})
    write_new(output / 'preparation.json', receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['cohort', 'segment'])
    parser.add_argument('--configuration', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = (prepare_cohort if args.mode == 'cohort' else prepare_segment)(args.configuration, args.output)
    print(json.dumps({'kind': result['kind'], 'contentHash': result['contentHash'], 'dispatchPerformed': False}))


if __name__ == '__main__':
    main()
