# POSIX operational adapter; original scientific plan and guard functions retained.
import argparse,hashlib,json,re,sys,threading,time
from pathlib import Path
from types import SimpleNamespace
import phase_admission
SOURCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
PHASE2=Path('/REQUIRED_BINDINGS/research-root/migration/raw/REQUIRED_BINDINGS_WORKSPACE/outputs/acephale-staged-study-20261113/phase2-orchestration')
ROOT=PHASE2.parent/'aws-runtime'
CURRENT_PLAN=None
def serving_module():
 def identity(occurrence):
  require(CURRENT_PLAN is not None and CURRENT_PLAN.get('kind')=='acephale-unit-serving-plan-v1' and CURRENT_PLAN.get('sourceCommit')==SOURCE,'Root-bound actual serving plan required')
  order=CURRENT_PLAN['hostOccurrences']
  require(occurrence in ('seed17-01','seed29-01','seed17-02','seed29-02') and occurrence in order,'Current occurrence not assigned to host')
  return {'seed':int(occurrence[4:6]),'occurrenceId':occurrence}
 return SimpleNamespace(identity=identity)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def write(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')

def public_source(path):
    path = Path(path).resolve()
    package = path / 'research/acephale/src'
    for name, module in sys.modules.items():
        file = getattr(module, '__file__', None)
        require(not name.startswith('acephale') or not file or Path(file).resolve().is_relative_to(package),
                'Exact5a Python source imports required')
    sys.path.insert(0, str(package))
    from acephale.experiment_runner import verify_source
    verify_source(path, SOURCE)
    return path

def corrective_profile_entry(command,stage,source):
    base=Path('/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-opportunity-preparation-01')
    require(command[1]=='-I','Isolated original Python entry')
    if stage=='profile':
        require(len(command)==17 and command[3::2]==['--source','--application-root','--application-binding','--application-binding-sha256','--config','--output','--upstream-root'],'Exact fixed80 profile CLI')
        require(Path(command[2])==base/'profile_entry.py' and sha(command[2])=='0e021cea1952d98bd060b1e16b13f5306513b4ea5cc01e2ca6c0778554ff3584','Pinned original-profile routing entry')
        require(Path(command[4]).resolve()==source and sha(command[8])==command[10],'Exact clean Python/application binding')
        binding=read(command[8]);app=Path(command[6])
        require(binding['applicationSourceRoot']==str(app),'Exact application root')
        for row in binding['files']:
            p=app/row['path'];require(p.is_relative_to(app) and sha(p)==row['sha256'],'Bound application member')
        require(sha(app/'scripts/acephale-infra-native-profile.ts')=='4d7aa9221b955e7a5721f09bc8890bf80771da46d912f0b6d9725108dfcff1c5','Fixed prospective80 hook')
        config=read(command[12]);require(config.get('limit')==80 and config.get('maximumLifetimeSeconds')==15000,'Fixed80 and finite global bound')
    else:
        require(stage=='aggregate' and len(command)>=7 and Path(command[2])==base/'source_bound_analysis_5a.py'
            and sha(command[2])=='4385516913023fcf5806e81bf0384fbba7df207fcf3303bc7c21c3bd73c44530'
            and Path(command[3]).resolve()==source and command[4]==SOURCE
            and command[5:7]==['acephale.infra_cli','build-opportunity'],'Unchanged original opportunity estimator entry')

def corrective_native_entry(command,source):
    entry=Path("/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-native-path-03/native_entry.py")
    require(len(command)==21 and command[1]=="-I" and Path(command[2]).resolve()==entry
      and sha(entry)=="bb7b83f8489e8d48792d695cbc9081e3cc111992d31409089dd7d14b7d917d7a",
      "Pinned genuine-guard corrective native entry required")
    require(command[3:9:2]==["--application-binding","--application-sha256","--node"]
      and Path(command[9]).resolve()==source and command[10]==SOURCE
      and command[11::2]==["--config","--tasks","--output","--budget-directory","--upstream-root"],
      "Exact native routing prefix and original argument suffix required")
    require(sha(command[4])==command[6] and Path(command[8]).is_file(),"Actual application binding and Node")
    import importlib.util
    spec=importlib.util.spec_from_file_location("_guard_native_entry",entry)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.application_binding(command[4],command[6])
    require(sha(entry.with_name("rpc_service_telemetry.py"))==module.RPC_SHA,"Exact RPC service telemetry")
    return True

def validate_plan(value, lease):
    require(set(value) == {'kind', 'mode', 'stageId', 'sourceDirectory', 'sourceCommit', 'leaseId', 'instanceId',
        'hardDeadline', 'phaseDeadline', 'occurrenceId', 'experimentPath', 'experimentSha256', 'preparationSha256',
        'originalStudyJournalPath', 'exclusiveOriginalJournalOwnership', 'runnerPython', 'nodeExecutable'},
        'Only explicit nonsecret stage-owner configuration fields are accepted')
    source = public_source(value['sourceDirectory'])
    from acephale.contracts_v1 import hash_v1
    from acephale.experiment_runner import Experiment, verify_inputs
    from acephale.infra_split_guard import load_guard
    from acephale.training_data import verify_hashed
    require(value.get('kind') == 'acephale-aws-native-stage-owner-v1'
        and value['mode'] in ('opportunity', 'native') and re.fullmatch('[a-z][a-z0-9-]{0,63}', value['stageId'])
        and value.get('exclusiveOriginalJournalOwnership') is True
        and value['sourceCommit'] == SOURCE
        and value['leaseId'] == lease['id'] and value['instanceId'] == lease['instanceId']
        and value['hardDeadline'] == lease['deadline'], 'Actual source/lease and exclusive owner declaration required')
    experiment_path = Path(value['experimentPath']).resolve()
    preparation_path = experiment_path.with_name('preparation.json')
    require(sha(experiment_path) == value['experimentSha256'] and sha(preparation_path) == value['preparationSha256'],
            'Frozen prepared experiment bytes changed')
    raw = read(experiment_path)
    experiment = Experiment.model_validate(raw)
    prepared = verify_hashed(read(preparation_path))
    require(prepared['experimentHash'] == hash_v1(raw) and experiment.sourceCommit == SOURCE
        and Path(experiment.source).resolve() == source
        and prepared['sourceCommit'] == SOURCE, 'Original prospective experiment identity required')
    verify_inputs({key: Path(item.path) for key, item in experiment.inputs.items()}, experiment)
    native_path = experiment_path.with_name('configuration.json')
    native = read(native_path)
    guard_path = (native_path.parent / native['splitGuardPath']).resolve()
    guard, provenance = load_guard(guard_path)
    manifest = read(native_path.parent / native['manifestPath'])
    require(Path(guard['configurationPath']).resolve() == native_path
        and provenance['expectedInstanceId'] == lease['instanceId'] and provenance.get('nativeLoraQualificationHash')
        and provenance['manifestHash'] == hash_v1(manifest), 'Current qualified guard must bind this exact stage manifest')
    owner = serving_module()
    identity = owner.identity(value['occurrenceId'])
    require(prepared['predictorTrainingSeed'] == identity['seed'], 'Current occurrence weight assignment changed')
    stages = [stage.id for stage in experiment.stages]
    helpers = ROOT.parent / 'phase2-orchestration'
    for stage in experiment.stages:
        command = stage.command
        if value['mode']=='opportunity':
            corrective_profile_entry(command,stage.id,source)
        else:
            corrective_native_entry(command,source)
    if value['mode'] == 'opportunity':
        require(prepared['kind'] == 'acephale-native-opportunity-preparation-v1'
            and stages == ['profile', 'aggregate'] and value['occurrenceId'] in ('seed17-01', 'seed29-01'),
            'Original per-weight opportunity profile declaration required')
        journal = Path(native['budgetDirectory']).resolve() / 'budget.jsonl'
        run_ids = []
    else:
        require(prepared['kind'] == 'acephale-paired-native-segment-preparation-v1' and stages == ['native'],
                'Prepared paired native segment required')
        expected_segment = {('development', 29): 1, ('development', 17): 2,
            ('heldout', 17): 1, ('heldout', 29): 2}
        operational = prepared.get('correctiveOperationalPreparation', {})
        require(expected_segment.get((native['stage'], identity['seed'])) == prepared['segmentNumber']
            and operational.get('originalScientificConfigurationUnchanged') is True
            and operational.get('qualifiedServingOccurrence') == value['occurrenceId']
            and value['occurrenceId'] == 'seed'+str(identity['seed'])+'-01',
            'Original segment seed/order and genuine current qualification occurrence required')
        run_ids = [row['runId'] for row in native['runs']]
        require(run_ids == prepared['runIds'] and len(run_ids) == len(set(run_ids)), 'Original paired run IDs changed')
        command = experiment.stages[0].command
        journal = Path(command[command.index('--budget-directory') + 1]).resolve() / 'budget.jsonl'
    require(str(journal) == str(Path(value['originalStudyJournalPath']).resolve()), 'Original journal path differs')
    require(0 < experiment.maximumSeconds and time.time() + experiment.maximumSeconds + 180 < lease['deadline']
        and time.time() < experiment.deadline <= lease['deadline'] - 300,
        'Complete prepared stage and cleanup must fit the original lease')
    phase = phase_admission.effective(lease['deadline'], value['phaseDeadline'])
    phase_admission.full_window(min(experiment.deadline, phase - 180), experiment.maximumSeconds, time.time())
    require(not experiment_path.with_name('run').exists(), 'A prior experiment result cannot be replayed or overwritten')
    for name in ('runnerPython', 'nodeExecutable'):
        require(Path(value[name]).is_file(), 'Declared existing local executable required')
    return {'source': source, 'experiment': experiment, 'experimentPath': experiment_path, 'raw': raw,
        'prepared': prepared, 'native': native, 'guardPath': guard_path, 'provenance': provenance,
        'runIds': run_ids, 'journalPath': journal}

def current_health(status, expected):
    from acephale.contracts_v1 import hash_v1
    from acephale.native_common import observe_host_health
    sample = observe_host_health('managed_native_stage', status_path=status)
    if not sample['healthy']:
        return False
    publication = read(status / sample['publication'])
    return publication.get('endpointProvenanceHash') == hash_v1(expected) and publication.get('manifestHash') == expected['manifestHash']

def guard_child(source, configuration, output, stop_file):
    public_source(source)
    from acephale.infra_split_guard import run_guard
    event = threading.Event()
    def watch():
        while not event.wait(.1):
            if stop_file.exists():
                event.set()
    threading.Thread(target=watch, daemon=True).start()
    try:
        result = run_guard(configuration, output, stop_event=event)
        write(output / 'guard-exit.json', result)
    finally:
        event.set()
def checked_module(name,reference):
 import importlib.util
 path=Path(reference['path']);require(path.is_absolute() and sha(path)==reference['sha256'],'Exact local transport source')
 existing=sys.modules.get(name)
 if existing is not None:
  require(Path(existing.__file__).resolve()==path.resolve(),'Foreign transport import')
  return existing
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module
 try:spec.loader.exec_module(module)
 except BaseException:sys.modules.pop(name,None);raise
 return module
def guarded_local_transport(source,configuration,output,stop_file,transport_ref):
 require(sha(transport_ref['path'])==transport_ref['sha256'],'Actual local transport configuration changed')
 value=read(transport_ref['path']);config=value['configuration'];execution=config['awsExecution']
 checked_module('aws_execution_contract',execution['contract'])
 checked_module('aws_replay_provider',execution['helper'])
 helper=checked_module('aws_native_local_probe_transport',value['helper'])
 public_source(source)
 from acephale import infra_split_guard as api
 guard,provenance=api.load_guard(configuration)
 require(guard['provider']=='aws' and 'identityFilePath' not in guard and config['instanceId']==guard['expectedInstanceId'],'Explicit same-host AWS guard without SSH key')
 relays=helper.relay_validator(config,provenance)
 original_session,original_observe=api.PersistentProbeSession,api.observe_persistent
 def session(configuration,expected,*,stderr):
  return original_session(configuration,expected,stderr=stderr,popen=helper.local_probe_factory(api,configuration,expected))
 observation=value['linuxObservation']
 require(observation['source']['sha256']=='ca3034334730136fa5789eb76f50412e647e225618735d3436511efe2f704b87','Actual Linux process/GPU observer source')
 observer=checked_module('corrective_linux_host_observation',observation['source'])
 handle=observer.start_observation(observation['inputs'])
 status=Path(handle.descriptor['environmentAppend']['ACEPHALE_HOST_STATUS_FILE'])
 from acephale.native_common import observe_host_health
 def observe(expected,current):
  relays()
  require(handle.process.poll() is None,'Actual Linux host sampler exited')
  sample=observe_host_health('corrective_actual_linux_host',status_path=status)
  require(sample['healthy'] is True,'Actual Linux host observation unhealthy/stale')
  return original_observe(expected,current)
 api.PersistentProbeSession=session;api.observe_persistent=observe
 try:guard_child(source,configuration,output,stop_file)
 finally:
  api.PersistentProbeSession=original_session;api.observe_persistent=original_observe
  observer.stop_observation(handle)

def main():
 global CURRENT_PLAN
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['plan','guard','health']);p.add_argument('--source');p.add_argument('--configuration');p.add_argument('--output');p.add_argument('--stop-file');p.add_argument('--input');p.add_argument('--transport-input');p.add_argument('--transport-sha256');a=p.parse_args()
 if a.mode=='guard':guarded_local_transport(a.source,Path(a.configuration),Path(a.output),Path(a.stop_file),{'path':a.transport_input,'sha256':a.transport_sha256});return
 if a.mode=='health':
  public_source(a.source);plan=read(a.input);print(json.dumps({'healthy':current_health(Path(a.output),plan['provenance'])}));return
 value=read(a.input);reference=value['servingUnitPlan'];require(sha(reference['path'])==reference['sha256'],'Bound serving plan changed')
 CURRENT_PLAN=read(reference['path'])
 plan=validate_plan(value['value'],value['lease'])
 write(a.output,{'kind':'acephale-aws-public-native-admission-v1','guardPath':str(plan['guardPath']),'provenance':plan['provenance'],'maximumSeconds':plan['experiment'].maximumSeconds,'deadline':plan['experiment'].deadline,'phaseDeadline':value['value']['phaseDeadline'],'sourceDirectory':str(plan['source']),'guardFunctionsUnchanged':True,'actualCurrentAWSOwnershipExternal':True})
if __name__=='__main__':main()
