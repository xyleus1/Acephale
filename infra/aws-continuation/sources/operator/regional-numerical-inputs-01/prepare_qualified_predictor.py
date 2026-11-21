"""Bind current AWS qualification and retained original training to frozen public inputs.
Only operational provenance/path/guard transport differs from the original producer.
Original manifest, data, weight, schedule, checkpoint and public validation rules remain.
No provider, model, evaluator or journal access is performed by this metadata producer.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

COMMIT = '5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
NUMERICAL_ADAPTER = {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/closure02/closure_adapter.py', 'sha256': '1f6035beb63571a879bf6ed1d5350f7b079ac6b7a2fcf5bb3c328bf19a6b4714'}
PATH_MAPPER = {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/closure02/path_projection.py', 'sha256': '20dba410747597ba49f46effb268b460de529cd1f48c8e439d4e8d16a4069cbf'}
RETAINED_EVIDENCE_PATH = Path('/srv/acephale/workspaces/operator/cloud-serving-01/retained-evidence.json')
RETAINED_EVIDENCE_SHA = '417070091c1add6c9ac77af7de296e53b39129fe967cb5d0d2b6b21e5de56faf'
RETAINED_MAIN = Path('/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-47/evaluation-stage-01')
EXECUTION = '4438b56c3053f0ee4a354d0e89ad31de82a766f7'

DATASET = '9ddee2130c383b8c62b9459f219b62a45a1fddd866cf5bb89f74bcccfacf568b'
MEMORY = 'ca232fec7cf17d57e312b74ba4a150a84c8302d869aacd7e993f6ade1f4b3d53'


def read(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Regular declared evidence required')
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def closed_inventory(archive, extracted, name, expected_sha):
    require(sha(archive) == expected_sha, 'Closed archive bytes changed')
    with tarfile.open(archive, 'r:gz') as bundle, bundle.extractfile(name) as stream:
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == sha(extracted / name),
                'Extracted inventory differs from its closed archive')
    inventory = read(extracted / name)
    for row in inventory['files']:
        path = extracted / row['path']
        require(path.resolve().is_relative_to(extracted) and path.is_file() and not path.is_symlink()
            and path.stat().st_size == row['bytes'] and sha(path) == row['sha256'], 'Extracted closed evidence changed')
    return inventory


def public_api(source):
    source = Path(source).resolve()
    require(subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
        and not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain=v1'], text=True).strip(),
        'Exact clean5a runtime source required')
    require(not any(name == 'acephale' or name.startswith('acephale.') for name in sys.modules),
            'Fresh source-bound Python process required')
    sys.path.insert(0, str(source / 'research/acephale/src'))
    from acephale.contracts_v1 import hash_v1
    from acephale.infra_data import verify_bundle
    from acephale.infra_split_guard import load_guard
    from acephale.training_data import verify_hashed
    return hash_v1, verify_bundle, load_guard, verify_hashed


def assemble_manifest(template, deployment, artifact, training, split, memory, checkpoint, policy, actor_seeds, experiment_id, hash_value):
    families = split.get('declared_family_policy', split['families'])
    manifest = copy.deepcopy(template)
    manifest.update(experimentId=experiment_id, sourceCommit=COMMIT,
        createdAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        **{key: copy.deepcopy(deployment[key]) for key in ('actor', 'predictor', 'runtime', 'hardware')})
    require(deployment['sourceCommit'] == COMMIT and deployment['predictor']['trainedPredictor'] == artifact,
            'Actual final-source deployment and trained artifact must agree')
    require(set(actor_seeds) == set(template['seeds']) or set(template['seeds']).issubset(actor_seeds),
            'Predeclared actor trial seeds cannot be removed')
    require(actor_seeds and len(actor_seeds) == len(set(actor_seeds))
        and all(type(seed) is int and 0 <= seed < 2**31 for seed in actor_seeds), 'Explicit actor trial seeds required')
    manifest['seeds'] = actor_seeds
    manifest['data'].update(datasetHash=DATASET, splitHash=hash_value(split), memoryHash=memory['contentHash'],
        calibrationHash=hash_value({'kind': 'not-created', 'scope': 'per-weight-calibration', 'artifactHash': artifact['contentHash']}))
    for field, partition in (('trainingFamilies', 'train'), ('developmentFamilies', 'development'), ('heldoutFamilies', 'test')):
        manifest['data'][field] = sorted(family for family, value in families.items() if value == partition)
        require(manifest['data'][field], 'Every original family partition must remain nonempty')
    require(set(artifact['weightFitFamilies'] + artifact['calibrationFamilies']) <= set(manifest['data']['trainingFamilies']),
            'Predictor fitting/calibration families cross public dataset partitions')
    require(checkpoint.get('budgetPolicyHash') == hash_value(policy) and policy['version'] == 3,
            'Current separately supplied v3 budget checkpoint required')
    manifest['budgets'].update(totalCeilingMicrodollars=policy['totalMicrodollars'],
        trancheMicrodollars=policy['totalMicrodollars'], infrastructureMicrodollars=policy['allocationsMicrodollars']['infrastructure'],
        maximumGpuHours=policy['maxGpuHours'], ledgerCheckpointHash=hash_value(checkpoint),
        budgetPolicyHash=checkpoint['budgetPolicyHash'], budgetAmendmentHash=checkpoint['budgetAmendmentHash'])
    manifest['protocol'].update(annotationReview=training['annotationReview'],
        cachePolicy='native-isolated-snapshot-lease-and-validated-promotion-v1', scheduleHash=hash_value([]))
    return manifest


def native_configuration(original_path):
    original_path = Path(original_path).resolve()
    original = read(original_path)
    return {'version': 1, 'manifestPath': 'manifest.json', 'splitGuardPath': 'guard.json',
        'actorBaseUrl': 'http://127.0.0.1:8000/v1', 'predictorBaseUrl': 'http://127.0.0.1:8001/v1',
        'otlpBaseUrl': 'http://127.0.0.1:4318', 'stream': False,
        'customTaskBundleDirectory': str((original_path.parent / original['customTaskBundleDirectory']).resolve()),
        'customTaskReceiptHash': original['customTaskReceiptHash']}



def checked_ref(reference):
    require(type(reference) is dict and set(reference) == {'path', 'sha256'}, 'Exact AWS evidence FileRef required')
    path = Path(reference['path'])
    require(path.is_absolute() and path.is_file() and not any(p.is_symlink() for p in (path, *path.parents))
        and sha(path) == reference['sha256'], 'Current AWS evidence bytes/origin changed')
    return path

def current_numerical(value):
    adapter_ref = NUMERICAL_ADAPTER
    path = checked_ref(adapter_ref)
    mapper = checked_ref(PATH_MAPPER)
    loaded_mapper = sys.modules.get('path_projection')
    require(loaded_mapper is None or Path(loaded_mapper.__file__).resolve() == mapper.resolve(),
        'Foreign path projection module')
    require(mapper.parent == path.parent, 'Exact numerical adapter sibling')
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location('aws_qualified_numeric_admission', path)
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    context = read(checked_ref(value['currentContext']))
    require(context['scienceSourceDirectory'] == value['sourceDirectory']
        and context['occurrenceId'] == value['occurrenceId'], 'Qualified context belongs to this original occurrence')
    binding = adapter.ORIGINAL_SOURCES
    precision, refs = adapter.current_numerical_inputs(context, binding)
    with adapter.original_modules(binding, context['scienceSourceDirectory'], precision) as modules:
        numerical = modules.numerical.load(context['runRoot'], context['occurrenceId'])
    adapter.current_numerical_inputs(context, binding)
    require(sha(path) == adapter_ref['sha256'] and sha(mapper) == PATH_MAPPER['sha256'], 'Numerical admission source changed')
    owner = read(checked_ref(context['currentQualification']))
    projection = read(checked_ref(context['servingProjection']))
    completed = read(checked_ref(projection['servingCompleted']))
    return context, owner, projection, completed, numerical, refs

def retained_closure(value, owner, verify_hashed):
    evidence = owner['result']['retainedEvidence']
    require(evidence == read(RETAINED_EVIDENCE_PATH) and sha(RETAINED_EVIDENCE_PATH) == RETAINED_EVIDENCE_SHA,
        'Only the accepted retained original export/training closure')
    for reference in evidence.values():
        checked_ref(reference)
    main = RETAINED_MAIN
    export = read(checked_ref(evidence['originalExport']))
    summary = verify_hashed(read(checked_ref(evidence['originalExportCompletion'])))
    require(export.get('completed') is True and export.get('failureType') is None
        and export.get('trainingSourceCommit') == COMMIT and export.get('executionSourceCommit') == EXECUTION
        and export.get('declaredSeeds') == export.get('completedTrainingSeeds') == [17, 29]
        and export.get('optimizerRerun') is False, 'Retained two-seed export is not a new scientific claim')
    require(summary.get('trainingSourceCommit') == COMMIT and summary.get('exportSourceCommit') == EXECUTION
        and summary.get('optimizerRerun') is False and summary.get('trainingStagesExecuted') is False
        and summary.get('completedTrainingSeeds') == [17, 29], 'Exact original completed training/export summary')
    archive = main / 'evaluated-main-evidence.tar.gz'
    inventory = closed_inventory(archive, main/'verified', 'evaluated-main-inventory.json', export['archiveSha256'])
    require(sha(main/'verified/evaluated-main-inventory.json') == evidence['retainedExportInventory']['sha256'],
        'Retained inventory differs from accepted original')
    require(owner['result']['mainExportSha256'] == evidence['originalExport']['sha256']
        and owner['result']['mainRecoveryCompletionSha256'] == evidence['originalExportCompletion']['sha256'],
        'Current qualified export is detached from retained original evidence')
    return {'summary': summary, 'inventory': inventory, 'executionSourceCommit': EXECUTION,
        'retainedEvidence': evidence, 'historicalAuthorityOnly': True}

def prepare(configuration, output):
    value, output = read(configuration), Path(output)
    context, owner, projection, completed, numerical, current_refs = current_numerical(value)
    source = Path(value['sourceDirectory']).resolve()
    hash_value, verify_bundle, load_guard, verify_hashed = public_api(source)
    occurrence = value['occurrenceId']
    extracted = Path(context['runRoot']) / f'serving-{occurrence}-stage/verified'
    verify_hashed(completed)
    require(completed['occurrenceId'] == occurrence and completed['completed'] is True
        and completed['sourceCommit'] == COMMIT and completed['seed'] == value['predictorTrainingSeed'],
        'Actual qualified serving occurrence identity differs')
    deployment_path = extracted / 'serving/inventory-after/observed-deployment.json'
    evidence_path = extracted / 'serving/inventory-after/inventory-evidence.json'
    deployment, evidence = read(deployment_path), read(evidence_path)
    require(sha(deployment_path) == completed['deploymentSha256'] and sha(evidence_path) == completed['inventorySha256'],
            'Completed occurrence must bind exact fresh post-probe observations')
    main = RETAINED_MAIN
    closure = retained_closure(value, owner, verify_hashed)
    main_inventory = closure['inventory']
    seed = value['predictorTrainingSeed']
    main_files = {row['path']: row for row in main_inventory['files']}
    def main_json(relative):
        path = main / 'verified' / relative
        require(relative in main_files and sha(path) == main_files[relative]['sha256'], 'Closed main-training evidence changed')
        return verify_hashed(read(path))
    training = main_json(f'main-run/seed{seed}-recover/artifacts/artifacts/receipt.json')
    specification = main_json(f'main-run/seed{seed}-recover/artifacts/artifacts/training-specification.json')
    artifact = main_json(f'main-run/seed{seed}-export/artifacts/artifacts/predictor.json')
    require(training['status'] == 'completed' and training['seed'] == seed and training['steps'] == 204
        and training['specificationHash'] == specification['contentHash'] == artifact['trainingManifestHash']
        and artifact['adapterHash'] == hash_value(training['adapterFiles'])
        and completed['servingWeightsHash'] == artifact['servingWeightsHash'], 'Serving weight differs from the completed declared seed')
    bundle_path = Path(value['datasetDirectory'])
    require(verify_bundle(bundle_path)['bundle_hash'] == DATASET, 'Original common746 public dataset required')
    split = read(bundle_path / 'split.json')
    memory = verify_hashed(read(value['memoryPath']))
    require(memory['contentHash'] == MEMORY, 'Original frozen lexical memory required')
    checkpoint = read(value['ledgerCheckpointPath'])
    require(checkpoint['entriesHash'] == hash_value(checkpoint['entries']), 'Externally supplied ledger checkpoint is malformed')
    policy = read(source / 'src/lib/acephale/contracts/budget-policy-v3.json')
    template = read(value['templateManifestPath'])
    require(len(value['scheduleReceipts']) == 2, 'Original development and heldout-target scheduling receipts required')
    actor_seeds = set()
    schedule_inputs = {}
    for path in value['scheduleReceipts']:
        receipt = verify_hashed(read(path))
        original = Path(receipt['originalSchedulePath'])
        schedule = read(original)
        require(receipt['kind'] == 'acephale-native-paired-serving-segments-v1'
            and sha(original) == receipt['originalScheduleSha256'] and hash_value(schedule) == receipt['originalScheduleHash'],
            'Original prospective actor trial schedule changed')
        actor_seeds.update(row['seed'] for row in schedule)
        schedule_inputs[str(Path(path).resolve())] = sha(path)
        schedule_inputs[str(original.resolve())] = sha(original)
    manifest = assemble_manifest(template, deployment, artifact, training, split, memory, checkpoint, policy,
        sorted(actor_seeds), value['experimentId'], hash_value)
    require(type(value['maximumGuardSeconds']) is int and 1 <= value['maximumGuardSeconds'] <= 28800,
            'Explicit bounded guard lifetime required')
    output.mkdir(parents=True, exist_ok=False)
    for name, path in (('deployment.json', deployment_path), ('inventory.json', evidence_path),
                       ('ledger-checkpoint.json', Path(value['ledgerCheckpointPath']))):
        shutil.copyfile(path, output / name)
    profile = {'predictionProtocol': artifact['protocol'], 'binaryTokenIds': artifact['binaryTokenIds'], 'trainedPredictor': artifact}
    native = native_configuration(value['originalTaskConfigurationPath'])
    require(evidence['provider']['instanceId'] == completed['instanceId'], 'Actual AWS post-probe instance')
    guard = {'version': 1, 'provider': 'aws', 'expectedInstanceId': completed['instanceId'],
        'sshDestination': 'aws-local-' + completed['instanceId'], 'sshPort': 22,
        'maximumLifetimeSeconds': value['maximumGuardSeconds'],
        'localPorts': {'actor': 8000, 'predictor': 8001, 'otlp': 4318}, 'configurationPath': 'native.json',
        'deploymentPath': 'deployment.json', 'inventoryEvidencePath': 'inventory.json'}
    for name, body in (('manifest.json', manifest), ('profile.json', profile), ('native.json', native), ('guard.json', guard)):
        write(output / name, body)
    _, provenance = load_guard(output / 'guard.json')
    require(bool(provenance.get('nativeLoraQualificationHash')), 'Actual unchanged native LoRA serving proof is mandatory')
    validator = ("const fs=require('node:fs');"
        "require('./src/lib/acephale/infra-manifest.ts').validateInfraManifest(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));"
        "require('./src/lib/acephale/predictor-artifact.ts').resolvePredictorProfile(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));")
    subprocess.run([value['nodeExecutable'], '--import', 'tsx', '-e', validator,
        str((output / 'manifest.json').resolve()), str((output / 'profile.json').resolve())], cwd=source, check=True)
    inputs = {str(Path(value[key]).resolve()): sha(value[key]) for key in ('templateManifestPath', 'originalTaskConfigurationPath',
        'memoryPath', 'ledgerCheckpointPath')}
    inputs.update({row['path']: row['sha256'] for row in current_refs})
    inputs.update({row['path']: row['sha256'] for row in closure['retainedEvidence'].values()})
    inputs.update({str(extracted / 'serving/serving-completed.json'): sha(extracted / 'serving/serving-completed.json')})
    inputs.update(schedule_inputs)
    for reference in current_refs:
        checked_ref(reference)
    body = {'kind': 'acephale-aws-qualified-evaluated-predictor-inputs-v1', 'sourceCommit': COMMIT, 'occurrenceId': occurrence,
        'recoveredMainCompletionHash': closure['summary']['contentHash'],
        'exportSourceCommit': closure['executionSourceCommit'], 'optimizerRepeated': False,
        'historicalInfrastructureCapacityAuthorization': closure['summary']['infrastructureCapacityAuthorization'],
        'currentAWSDeployment': owner['deployment'], 'servingProjection': context['servingProjection'],
        'retainedExportReclaimed': False, 'originalWindowsCompletion': False,
        'guardTransport': 'same_host_owned_loopback_relays_v1', 'sshConnectionPerformed': False,
        'numericalBindingHash': numerical['contentHash'], 'financialAuthorityValidatedHere': False,
        'originalTrainingArchiveHashes': closure['summary']['originalArchiveHashes'],
        'optimizerRerun': False, 'predictorTrainingSeed': seed, 'predictorArtifactHash': artifact['contentHash'], 'inputs': inputs,
        'manifestHash': hash_value(manifest), 'profileHash': hash_value(profile), 'guardProvenance': provenance,
        'annotationReview': training['annotationReview'], 'sourceDatasetHash': DATASET, 'memoryHash': MEMORY,
        'calibrationState': 'not-created; required before speculative native trials',
        'nativeScheduleState': 'empty; paired preparation supplies unchanged original segment',
        'budgetJournalRead': False, 'dispatchPerformed': False, 'nativeTaskAccuracyMeasured': False}
    write(output / 'preparation.json', {**body, 'contentHash': hash_value(body)})
    return body


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--configuration', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = prepare(args.configuration, args.output)
    print(json.dumps({'occurrenceId': result['occurrenceId'], 'dispatchPerformed': False}))
