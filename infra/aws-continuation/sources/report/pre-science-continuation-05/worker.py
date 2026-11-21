# Original-command worker. No provider or claim mutations; every output is a new attempt artifact.
from __future__ import annotations
import copy,base64
import argparse,hashlib,importlib.util,json,math,os,signal,subprocess,sys,time,threading
from pathlib import Path
from controller import SCIENCE,Store,Claims,need,sha,canonical,exact_ref
REPLAY_OBSERVATION_SOURCE={'path': '/srv/acephale/workspaces/review/replay-evidence-01/replay_evidence_03.py', 'sha256': 'e9361469f7ade31e4ea6bb82b03ff222e9ecc57acc42e585d3934c1e616b33a6'}

NATIVE_UNITS=['seed17/opportunity', 'seed29/opportunity', 'development/1', 'development/2', 'heldout/1', 'heldout/2']
NATIVE_EVIDENCE_SOURCE={'path': '/srv/acephale/workspaces/operator/native-evidence-recovery-05/native_evidence.py', 'sha256': '85f4f5fbfed8b5933659b414040426e7aa35faa79a9a58795d1d441fe9a98362'}
CALIBRATION_ADOPTION_SOURCE={'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/calibration_adoption.py', 'sha256': 'f3950a5dc484d8ac45ced3a79280e85844b7e0dd20d752e483e51ebfd06130e8'}
ORIGINAL_DEVELOPMENT_SEGMENTS={'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/paired-development-weight-groups-01/segments.json', 'sha256': 'f6f39258eea0e0251095380a34971d9a31918324e1eef91b7502493921886be9'}
DEVELOPMENT_SEGMENTS={'path': '/srv/acephale/workspaces/report/cloud-qualified-inputs-01/inputs/developmentSegmentsReceiptPath.json', 'sha256': '6f03dfb3f1f7c789ddec55c9e9cc1110daea3acd9e9971b3288c953b8978e4b7'}

def native_observation_cli(source,argv,maximum_seconds,managed_guard):
 need(managed_guard is None and maximum_seconds==300 and checked(source)==Path(argv[1]),'Exact bounded standalone native observation')
 if source==NATIVE_EVIDENCE_SOURCE:
  need(argv[2:4] in (['--mode','before'],['--mode','complete']),'Exact native evidence mode')
  expected=['--context','--context-sha256','--native-configuration','--configuration-sha256','--output']
  if argv[3]=='complete':expected+=['--phase-dispatch','--phase-dispatch-sha256','--phase-result','--phase-result-sha256']
  need(argv[4::2]==expected and len(argv)==(22 if argv[3]=='complete' else 14),'Exact native helper-only CLI')
 elif source==CALIBRATION_ADOPTION_SOURCE:
  need(argv[2::2]==['--context','--context-sha256','--dependency','--dependency-sha256','--output'] and len(argv)==12,'Exact calibration metadata-only CLI')
 else:raise ValueError('Unreviewed native observation source')

def native_evidence(inp,submission,bindings,stepdir,mode,cwd,environment,gate,owner,context_ref,phase=None):
 spec=inp['nativeEvidence'];need(spec['source']==NATIVE_EVIDENCE_SOURCE and spec['maximumSeconds']==300,'Exact accepted native evidence')
 config=file_ref(stepdir/'owner-admission-input.json');output=stepdir/'native-evidence'/(mode+'-helper-receipt.json')
 argv=[bindings['nativePython'],spec['source']['path'],'--mode',mode,'--context',context_ref['path'],'--context-sha256',context_ref['sha256'],'--native-configuration',config['path'],'--configuration-sha256',config['sha256'],'--output',str(output)]
 if mode=='complete':
  need(phase is not None,'Actual completed native science required')
  for name in ('dispatch','result'):argv.extend(['--phase-'+name,phase[name]['path'],'--phase-'+name+'-sha256',phase[name]['sha256']])
 else:need(mode=='before' and phase is None,'Only before/complete evidence')
 receipt=run_command(argv,cwd=cwd,environment=environment,maximum_seconds=300,hard_deadline=submission['hardDeadline'],output=stepdir/('native-evidence-'+mode+'-process'),gate=gate,owner=owner,native_observation=spec['source'])
 value=json.loads(output.read_text())
 need(value.get('kind')=='acephale-aws-native-evidence-helper-v1' and value.get('completed') is True and value.get('mode')==mode and value.get('context')==context_ref,'Actual exact native helper completion')
 if mode=='complete':
  need(all(value.get(k) is True for k in ('originalCompletionVerifierPassed','originalArchiveVerifierPassed','originalNumericalChecksPassed')),'All original native completion gates')
  for key,item in value['outputs'].items():checked(item);bindings['nativeOutput:'+key]=item['path']
 return {**receipt,'helperReceipt':file_ref(output)}

def calibration_adoption(inp,submission,bindings,work,environment,cwd,gate,owner,current_context):
 spec=inp['calibrationAdoption'];need(spec['source']==CALIBRATION_ADOPTION_SOURCE and spec['maximumSeconds']==300,'Exact reviewed current calibration bridge')
 checked(spec['source']);dependency=work/'analysis-dependency.json';write(dependency,spec['dependency'])
 context_path=work/'calibration-adoption-context.json'
 context={**inp.get('verificationContext',{}),**current_context,'unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'resourceAttemptId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'inputSha256':submission['inputSha256'],'sourceCommit':SCIENCE,'hardDeadline':submission['hardDeadline'],'job':inp['job'],'runRoot':bindings['runRoot'],'attemptOutput':str(work),'scienceSourceDirectory':str(cwd),'providerConfiguration':file_ref(work/'provider-configuration.json')}
 write(context_path,context);ctx=file_ref(context_path);dep=file_ref(dependency)
 output=Path(bindings['runRoot'])/'calibration-adoption-receipt.json'
 argv=[bindings['nativePython'],spec['source']['path'],'--context',ctx['path'],'--context-sha256',ctx['sha256'],'--dependency',dep['path'],'--dependency-sha256',dep['sha256'],'--output',str(output)]
 receipt=run_command(argv,cwd=cwd,environment=environment,maximum_seconds=300,hard_deadline=submission['hardDeadline'],output=work/'calibration-adoption-process',gate=gate,owner=owner,native_observation=spec['source'])
 value=json.loads(output.read_text())
 need(value.get('kind')=='acephale-aws-calibration-adoption-helper-v1' and value.get('completed') is True and value.get('numericalEquivalenceAsserted') is False and value.get('originalArtifactsChanged') is False and value.get('scientificExecutionPerformed') is False,'Explicit current adoption without invented equivalence')
 need(value.get('context')==ctx and value.get('dependency')==dep and all(value.get(k)==submission[k]for k in ('unitId','unitAttemptId','resourceAttemptId','instanceId')),'Exact current adoption helper identity')
 need(all(value.get(k)==spec['dependency']['outputs'][k]for k in ('calibration','goalReliability')),'Original dependency outputs unchanged')
 checked(value['adoptionReceipt'])
 companion=value['calibrationCompanion'];checked(companion)
 current_context['calibrationCompanion']=companion;current_context['calibrationAdoption']=value['adoptionReceipt'];current_context['calibrationAdoptionHelper']=file_ref(output)
 return {**receipt,'adoptionReceipt':file_ref(output)}

def file_ref(path):
 p=Path(path);need(p.is_absolute() and p.is_file() and not any(x.is_symlink() for x in (p,*p.parents)),'Absolute regular source/artifact required')
 with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 return {'path':str(p),'sha256':h}
def checked(ref):
 exact_ref(ref);need(file_ref(ref['path'])==ref,'Declared input/source bytes changed');return Path(ref['path'])
def checked_executable(reference):
 exact_ref(reference);path=Path(reference['path'])
 need(path.is_absolute() and path.is_file(),'Exact declared interpreter/executable')
 with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
 need(digest==reference['sha256'],'Declared executable bytes changed')
 return path

def write(path,value):
 with Path(path).open('x') as f:json.dump(value,f,indent=2,allow_nan=False);f.write(chr(10));f.flush();os.fsync(f.fileno())
def resolve(value,bindings):
 if type(value) is dict:
  if set(value)=={'$binding'}:
   name=value['$binding'];need(name in bindings,'Missing real binding: '+name);out=bindings[name]
   need(out is not None and not(type(out) is dict and '$binding' in out),'Unresolved real binding: '+name);return out
  return {k:resolve(v,bindings) for k,v in value.items()}
 if type(value) is list:return [resolve(v,bindings) for v in value]
 return value

def group_alive(pgid):
 try:os.killpg(pgid,0);return True
 except ProcessLookupError:return False

def drain_group(process,seconds=10):
 if group_alive(process.pid):
  try:os.killpg(process.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 until=time.monotonic()+seconds
 while group_alive(process.pid) and time.monotonic()<until:
  process.poll();time.sleep(.05)
 if group_alive(process.pid):
  try:os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError:pass
 try:process.wait(timeout=seconds)
 except subprocess.TimeoutExpired:return False
 # Reap own direct child; descendants are process-group scoped and may need a short reap interval.
 until=time.monotonic()+seconds
 while group_alive(process.pid) and time.monotonic()<until:time.sleep(.05)
 return not group_alive(process.pid)

def run_command(argv,*,cwd,environment,maximum_seconds,hard_deadline,output,gate,owner=None,managed_guard=None,replay_observation=None,native_observation=None):
 need(type(argv) is list and argv and all(type(x) is str and x for x in argv),'Concrete argv only; no shell interpolation')
 if replay_observation is not None:
  need(replay_observation==REPLAY_OBSERVATION_SOURCE and checked(replay_observation)==Path(argv[1]),'Only the exact accepted operational replay observation may own its provider brackets')
  need(managed_guard is None and maximum_seconds==180 and len(argv) in (14,22),'Exact bounded helper CLI only')
  need(argv[2:4] in (['--mode','before'],['--mode','complete']),'Exact replay observation mode')
  expected=['--context','--context-sha256','--replay-configuration','--configuration-sha256','--output']
  if argv[3]=='complete':expected+=['--phase-dispatch','--phase-dispatch-sha256','--phase-result','--phase-result-sha256']
  need(argv[4::2]==expected and len(argv)==(22 if argv[3]=='complete' else 14),'No scientific command may select quiet observation ownership')
 if native_observation is not None:
  need(replay_observation is None,'One exact observation policy');native_observation_cli(native_observation,argv,maximum_seconds,managed_guard)
 need(type(maximum_seconds) in (int,float) and 0<maximum_seconds<=28800 and time.time()+maximum_seconds+10<hard_deadline,'Complete original finite command must fit lease')
 output=Path(output);output.mkdir(exist_ok=False);started=time.time();deadline=time.monotonic()+maximum_seconds;gate();process=None;guard=None;guard_log=None
 watch_stop=threading.Event();watch_errors=[];watcher=None;watch_calls=[]
 def watch_provider():
  while not watch_stop.wait(5):
   try:gate();watch_calls.append(time.time())
   except BaseException as error:watch_errors.append(error);return
 result={'kind':'acephale-aws-owned-process-result-v1','childCreated':False,**(owner or {}),'argv':argv,'cwd':str(cwd),'startedAt':started,'maximumSeconds':maximum_seconds,'exitCode':None,'drained':False,'completed':False,'gateCalls':1}
 try:
  with (output/'stdout.log').open('x') as out,(output/'stderr.log').open('x') as err:
   if managed_guard is not None:
    stop=Path(managed_guard['stopFile']);need(not stop.exists(),'Prior guard stop signal')
    guard_log=(output/'guard.log').open('x')
    write(output/'guard-dispatch.json',{'kind':'acephale-aws-public-guard-dispatch-v1',**(owner or {}),'command':managed_guard['argv'],'source':managed_guard['source'],'admission':managed_guard['admission'],'startedAt':time.time(),'automaticRetry':False})
    guard=subprocess.Popen(managed_guard['argv'],cwd=cwd,env=managed_guard['environment'],stdout=guard_log,stderr=subprocess.STDOUT,start_new_session=True)
    result['guardStarted']=True;ready=min(time.monotonic()+45,deadline)
    while True:
     need(guard.poll() is None and not stop.exists() and time.monotonic()<ready,'Fresh exact guard health was not published before dispatch')
     if managed_guard['health']():break
     gate();result['gateCalls']+=1;time.sleep(.1)
    need(guard.poll() is None and not stop.exists(),'Guard exited before experiment dispatch')
    # The original full experiment window is checked again after guard readiness.
    need(time.time()+maximum_seconds<managed_guard['phaseCutoff'],'Complete original experiment does not fit phase after guard readiness')
    deadline=time.monotonic()+maximum_seconds
    result['guardHealthVerified']=True
   write(output/'dispatch.json',{'kind':'acephale-aws-owned-process-dispatch-v1',**(owner or {}),'command':argv,'cwd':str(cwd),'startedAt':time.time(),'maximumSeconds':maximum_seconds,'automaticRetry':False})
   process=subprocess.Popen(argv,cwd=cwd,env=environment,stdout=out,stderr=err,start_new_session=True)
   result['childCreated']=True
   if replay_observation is None and native_observation is None:
    watcher=threading.Thread(target=watch_provider,name='aws-read-only-provider-watch',daemon=True);watcher.start()
   else:result['providerObservationPolicy']='exact-helper-brackets-plus-owned-pre-post; no overlapping SDK sibling'
   while process.poll() is None:
    if time.monotonic()>=deadline or time.time()>=hard_deadline:raise TimeoutError('Original command deadline expired')
    if managed_guard is not None:
     need(guard.poll() is None and not Path(managed_guard['stopFile']).exists() and time.time()<managed_guard['phaseCutoff'],'Guard exit, explicit stop or original phase deadline during execution')
    if watch_errors:raise watch_errors[0]
    time.sleep(.1)
   watch_stop.set()
   if watcher is not None:watcher.join(timeout=50);need(not watcher.is_alive(),'Provider watcher did not drain')
   if watch_errors:raise watch_errors[0]
   result['exitCode']=process.returncode
   if group_alive(process.pid):raise RuntimeError('Command exited while owned descendants remain')
   result['drained']=True
   need(process.returncode==0,'Original command failed; no retry')
   if managed_guard is not None:need(guard.poll() is None,'Guard exited before experiment completion')
   gate();result['gateCalls']+=1
   if managed_guard is not None:need(guard.poll() is None and time.time()<managed_guard['phaseCutoff'],'Guard or original phase failed during final provider check')
   result['completed']=True
 except BaseException as e:
  result['failureType']=type(e).__name__;result['failure']=str(e)
  if process is not None:
   result['drained']=drain_group(process);result['exitCode']=process.returncode
  raise
 finally:
  primary=sys.exception();watch_stop.set()
  if guard is not None:
   errors=[]
   try:
    stop=Path(managed_guard['stopFile'])
    if not stop.exists():write(stop,{'stop':True})
   except BaseException as error:errors.append(type(error).__name__)
   try:guard.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
   except BaseException as error:errors.append(type(error).__name__)
   try:guard_drained=drain_group(guard,seconds=15)
   except BaseException as error:guard_drained=False;errors.append(type(error).__name__)
   result['guardExitCode']=guard.returncode;result['guardDrained']=guard_drained;result['guardDrainErrors']=errors
   result['drained']=bool(result['drained'] and guard_drained and not errors)
   result['completed']=bool(result['completed'] and result['drained'])
   if guard_log:guard_log.close()
  if watcher is not None:watcher.join(timeout=50)
  result['providerWatcherDrained']=watcher is None or not watcher.is_alive();result['gateCalls']+=len(watch_calls)
  result['drained']=result['drained'] and result['providerWatcherDrained'];result['completed']=result['completed'] and result['drained']
  result['finishedAt']=time.time();result['elapsedSeconds']=result['finishedAt']-started;result['localOwnedProcessesDrained']=result['drained']
  result['logs']=[file_ref(output/x) for x in ('stdout.log','stderr.log','guard.log') if (output/x).exists()]
  write(output/'result.json',result)
  if primary is None:need(result['completed'],'Owned child/guard failed to drain')
 return {**result,'dispatch':file_ref(output/'dispatch.json'),'result':file_ref(output/'result.json')}

def guard_health(argv,environment,cwd):
 process=subprocess.Popen(argv,cwd=cwd,env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,text=True)
 try:
  stdout,stderr=process.communicate(timeout=10)
  need(process.returncode==0,'Original public health reader failed')
  need(not group_alive(process.pid),'Health reader descendants remain')
  return json.loads(stdout).get('healthy') is True
 finally:
  if group_alive(process.pid):need(drain_group(process),'Health reader failed to drain')

def native_command(inp,submission,bindings,job,stepdir,preparation,argv,cwd,environment,gate,owner,current_context,operational):
 helper=checked(inp['publicGuard']['source']);checked(inp['publicGuard']['phaseAdmission'])
 need(inp['publicGuard']['phaseAdmission']['path']==str(helper.with_name('phase_admission.py')),'Exact adjacent phase gate')
 plan_ref=inp['publicGuard']['servingUnitPlan'];checked(plan_ref)
 experiment=preparation/'experiment.json';prepared=preparation/'preparation.json'
 phase=bindings['phaseDeadline'];need(type(phase) in (int,float) and time.time()<phase<=submission['hardDeadline'],'Finite exact operational phase')
 mode='opportunity' if job['unitKind']=='opportunity' else 'native'
 config={'kind':'acephale-aws-native-stage-owner-v1','mode':mode,'stageId':'native-'+hashlib.sha256(submission['unitAttemptId'].encode()).hexdigest()[:32]+'-op05','sourceDirectory':str(cwd),'sourceCommit':SCIENCE,'leaseId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'hardDeadline':submission['hardDeadline'],'phaseDeadline':phase,'occurrenceId':job['occurrenceId'],'experimentPath':str(experiment),'experimentSha256':file_ref(experiment)['sha256'],'preparationSha256':file_ref(prepared)['sha256'],'originalStudyJournalPath':'/srv/acephale/shared/budget.jsonl','exclusiveOriginalJournalOwnership':submission['journalOwnerRequired'],'runnerPython':bindings['nativePython'],'nodeExecutable':bindings['nodeExecutable']}
 admission_input=stepdir/'owner-admission-input.json';admission_output=stepdir/'owner-admission.json'
 write(admission_input,{'value':config,'lease':{'id':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'deadline':submission['hardDeadline']},'servingUnitPlan':plan_ref})
 admission=run_command([bindings['nativePython'],'-B',str(helper),'plan','--input',str(admission_input),'--output',str(admission_output)],cwd=cwd,environment=environment,maximum_seconds=60,hard_deadline=submission['hardDeadline'],output=stepdir/'owner-admission-process',gate=gate,owner=owner)
 need(argv==[bindings['nativePython'],'-m','acephale.experiment_runner','--manifest',str(experiment),'--output',str(preparation/'run')],'Only exact original prepared experiment')
 context={**inp.get('verificationContext',{}),**current_context,'unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'resourceAttemptId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'sourceCommit':SCIENCE,'inputSha256':submission['inputSha256'],'hardDeadline':submission['hardDeadline'],'job':inp['job'],'runRoot':bindings['runRoot'],'attemptOutput':str(Path('/srv/acephale/attempts')/submission['unitAttemptId']),'occurrenceId':job['occurrenceId'],'scienceSourceDirectory':str(cwd),'unitScientificIds':inp['unitScientificIds'],'nativeExperiment':file_ref(experiment),'nativePreparation':file_ref(prepared),'providerConfiguration':file_ref(Path('/srv/acephale/attempts')/submission['unitAttemptId']/'provider-configuration.json'),'guardAdmission':file_ref(admission_output),'ownerAdmission':{'dispatch':admission['dispatch'],'result':admission['result']},'nativeGuardSource':inp['publicGuard']['source']}
 context_path=stepdir/'native-context.json';write(context_path,context);context_ref=file_ref(context_path)
 operational.append(native_evidence(inp,submission,bindings,stepdir,'before',cwd,environment,gate,owner,context_ref))
 plan=json.loads(admission_output.read_text());status=stepdir/'public-guard';stop=stepdir/'public-guard.stop'
 env={**environment,'ACEPHALE_HOST_STATUS_FILE':str(status),'PYTHONPATH':str(cwd/'research/acephale/src'),'PATH':str(Path(bindings['nodeExecutable']).parent)+os.pathsep+environment.get('PATH','')}
 for name in ('ACEPHALE_GITHUB_OWNER_TOKEN','ACEPHALE_WATCHDOG_HMAC_KEY','LAMBDA_API_KEY','HF_TOKEN','HUGGING_FACE_HUB_TOKEN'):env.pop(name,None)
 for key in ('OPENAI_API_KEY','OPENAI_ORG_ID','OPENAI_PROJECT_ID'):env.pop(key,None)
 guard_env=dict(env)
 transport=inp['publicGuard']['transport'];checked(transport['helper']);need(transport['configuration']['awsExecution']==inp['providerConfiguration']['awsExecution'],'Native transport/provider proof differs')
 transport_path=stepdir/'public-guard-transport.json';write(transport_path,transport)
 guard_argv=[bindings['nativePython'],'-B',str(helper),'guard','--source',str(cwd),'--configuration',plan['guardPath'],'--output',str(status),'--stop-file',str(stop),'--transport-input',str(transport_path),'--transport-sha256',file_ref(transport_path)['sha256']]
 health_argv=[bindings['nativePython'],'-B',str(helper),'health','--source',str(cwd),'--input',str(admission_output),'--output',str(status)]
 guard={'argv':guard_argv,'environment':guard_env,'stopFile':str(stop),'source':inp['publicGuard']['source'],'admission':file_ref(admission_output),'phaseCutoff':min(plan['deadline'],phase-180),'health':lambda:guard_health(health_argv,guard_env,cwd)}
 if mode=='native':
  credentials=inp['childCredentials'];loader=checked_module('aws_native_child_credentials',credentials['source'])
  import boto3
  with loader.child_environment(env,credentials['secret'],boto3.client('secretsmanager',region_name='us-east-1')) as child_env:
   result=run_command(argv,cwd=cwd,environment=child_env,maximum_seconds=plan['maximumSeconds'],hard_deadline=submission['hardDeadline'],output=stepdir/'process',gate=gate,owner=owner,managed_guard=guard)
 else:
  result=run_command(argv,cwd=cwd,environment=env,maximum_seconds=plan['maximumSeconds'],hard_deadline=submission['hardDeadline'],output=stepdir/'process',gate=gate,owner=owner,managed_guard=guard)
 operational.append(native_evidence(inp,submission,bindings,stepdir,'complete',cwd,environment,gate,owner,context_ref,result))
 return {**result,'ownerAdmission':{'dispatch':admission['dispatch'],'result':admission['result']},'guardAdmission':file_ref(admission_output)}


def provider_gate(configuration):
 cfg=configuration['awsExecution'];helper=checked(cfg['helper']);contract=checked(cfg['contract']);checked(cfg['association'])
 name='aws_execution_contract';existing=sys.modules.get(name)
 if existing is None:
  spec=importlib.util.spec_from_file_location(name,contract);existing=importlib.util.module_from_spec(spec);sys.modules[name]=existing
  try:spec.loader.exec_module(existing)
  except BaseException:sys.modules.pop(name,None);raise
 need(Path(existing.__file__).resolve()==contract.resolve(),'Foreign provider contract preload')
 name='acephale_aws_worker_provider';need(name not in sys.modules,'Foreign provider helper preload')
 spec=importlib.util.spec_from_file_location(name,helper);module=importlib.util.module_from_spec(spec);sys.modules[name]=module
 try:spec.loader.exec_module(module)
 except BaseException:sys.modules.pop(name,None);raise
 return lambda:module.validate_provider(configuration)

def validate_completion(evidence,unit,attempt,input_sha):
 need(evidence.get('kind')=='acephale-aws-component-closure-v1' and evidence.get('unitId')==unit and evidence.get('attemptId')==attempt and evidence.get('inputSha256')==input_sha,'Independent actual component closure identity required')
 need(evidence.get('originalValidatorsPassed') is True and evidence.get('allDeclaredOutputsPresent') is True and evidence.get('allProcessesDrained') is True and evidence.get('failedTrialsRetained') is True and evidence.get('scientificProtocolChanged') is False,'Complete original validation and retained failures required')
 files=evidence.get('files');need(type(files) is list and files,'Concrete output FileRefs required')
 for ref in files:checked(ref)
 return evidence

def checked_module(name,reference):
 path=checked(reference);previous=sys.modules.get(name)
 if previous is not None:
  need(Path(previous.__file__).resolve()==path.resolve() and getattr(previous,'__spec__',None) is not None and Path(previous.__spec__.origin).resolve()==path.resolve(),'Foreign loaded operational helper')
  return previous
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module
 try:spec.loader.exec_module(module)
 except BaseException:sys.modules.pop(name,None);raise
 return module

def replay_evidence(inp,submission,bindings,stepdir,mode,cwd,environment,gate,owner,phase=None):
 spec=inp['replayEvidence'];need(spec['source']==REPLAY_OBSERVATION_SOURCE,'Exact independently accepted replay evidence source');checked(spec['source'])
 context=file_ref(bindings['currentNumericalContextPath']);configuration=file_ref(stepdir/'replay-host-configuration.json')
 argv=[bindings['analysisPython'],spec['source']['path'],'--mode',mode,'--context',context['path'],'--context-sha256',context['sha256'],'--replay-configuration',configuration['path'],'--configuration-sha256',configuration['sha256'],'--output',str(Path(bindings['runRoot'])/'downstream'/'seed29-01'/'replay-provenance'/(mode+'-helper-receipt.json'))]
 if mode=='complete':
  need(phase is not None,'Actual scientific replay phase receipt required')
  for name in ('dispatch','result'):
   checked(phase[name]);argv.extend(['--phase-'+name,phase[name]['path'],'--phase-'+name+'-sha256',phase[name]['sha256']])
 else:need(mode=='before' and phase is None,'Exact replay evidence phase')
 return run_command(argv,cwd=cwd,environment=environment,maximum_seconds=180,hard_deadline=submission['hardDeadline'],output=stepdir/('evidence-'+mode+'-process'),gate=gate,owner=owner,replay_observation=spec['source'])

def execute(inp,submission,work,gate,execution_input_ref):
 need(submission['unitId'] in NATIVE_UNITS,'Six unchanged original native/opportunity jobs only')
 need(inp.get('kind')=='acephale-aws-unit-execution-input-v1' and inp.get('unitId')==submission['unitId'],'Exact prepared execution input required')
 job=json.loads(checked(inp['job']).read_text());need(job['unitId']==submission['unitId'] and job['sourceCommit']==SCIENCE and job['automaticRetry'] is False,'Original frozen unit packet required')
 for ref in inp['files']:checked(ref)
 for ref in inp.get('executables',[]):checked_executable(ref)
 bindings=dict(inp['bindings']);env=os.environ.copy();owner={'unitId':submission['unitId'],'attemptId':submission['unitAttemptId'],'leaseId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'sourceCommit':SCIENCE,'inputSha256':submission['inputSha256'],'job':inp['job']}
 allowed={'NODE_OPTIONS','ACEPHALE_NATIVE_BUDGET_PORT','ACEPHALE_NATIVE_BUDGET_PORT_SHA256','ACEPHALE_AWS_MIGRATION','ACEPHALE_AWS_MIGRATION_SHA256','PYTHONPATH','PYTHONHASHSEED','LD_LIBRARY_PATH'}
 need(set(inp.get('environment',{}))<=allowed,'Only explicit public runtime environment bindings may be serialized')
 for key in ('OPENAI_API_KEY','OPENAI_ORG_ID','OPENAI_PROJECT_ID'):env.pop(key,None)
 env.update(inp.get('environment',{}));cwd=Path(bindings['scienceSourceDirectory']);results=[];previous_preparation=None;operational=[];current_context={}
 if inp.get('qualificationPreparation'):
  preparer=checked_module('aws_current_qualified_preparation',inp['qualificationPreparation']['workerHelper'])
  bindings,current_context,operational,operational_receipt=preparer.prepare(inp,submission,bindings,work,env,cwd,gate,owner,run_command)
  prepared_receipt=json.loads(checked(operational_receipt).read_text())
  bindings['freshLedgerCheckpointPath']=prepared_receipt['checkpoint']['path'];checked(prepared_receipt['checkpoint'])
  bindings['qualifiedManifestPath']=str(Path(bindings['qualifiedDirectory'])/'manifest.json')
 else:raise ValueError('Native current qualified preparation is mandatory')
 continuation=preparer.core();approval=continuation.authority(inp['operationalContinuation']['authority'])
 need(file_ref(__file__)==approval['workerSource'],'Exact bounded continuation worker')
 need(submission['unitId']=='seed17/opportunity'and submission['unitAttemptId']=='unit-b8dae1aff90e4b838cb08b973c6e6ec6'and len(job['steps'])==2,'Only exact original two-step opportunity')
 need(json.loads((work/'provider-configuration.json').read_text())==inp['providerConfiguration'],'Original bound provider configuration retained')
 operational.append(preparer.reuse_adoption(inp,submission,bindings,work,gate,current_context))
 for number,step in enumerate(job['steps'],1):
  stepdir=work/f'{number:02d}-{step["id"]}'
  if number==1:
   need(step['id']=='prepare'and 'preparer'in step,'Original completed metadata preparation retained')
   previous_preparation=work/'operational-generations/04/prepared'
   need((previous_preparation/'experiment.json').is_file(),'Recovery experiment metadata exists')
   retained=work/'operational-generations/02/preparation-completion-process'
   results.append(preparer.receipt(continuation,{'dispatch':file_ref(retained/'dispatch.json'),'result':file_ref(retained/'result.json')}))
   continue
  stepdir=work/'operational-generations/05'/f'{number:02d}-{step["id"]}'
  stepdir.mkdir();scoped={**bindings,'configurationPath':str(stepdir/'configuration.json'),'preparationDirectory':str(stepdir/'prepared')}
  if 'preparer' in step:
   pre=step['preparer'];checked(pre['source']);config=resolve(pre['configurationTemplate'],scoped)
   if inp.get('nativeConfigurationProjection') is not None and step['id']=='prepare-entire-original-cohort':
    need(job['unitId']=='development/1' and config['segmentsReceiptPath']==ORIGINAL_DEVELOPMENT_SEGMENTS['path'] and inp['nativeConfigurationProjection']==DEVELOPMENT_SEGMENTS,'Only exact accepted development path projection')
    checked(ORIGINAL_DEVELOPMENT_SEGMENTS);checked(DEVELOPMENT_SEGMENTS);config['segmentsReceiptPath']=DEVELOPMENT_SEGMENTS['path']
   write(stepdir/'configuration.json',config)
   argv=resolve(pre['argv'],scoped);maximum=pre['maximumSeconds'];previous_preparation=stepdir/'prepared'
   results.append(run_command(argv,cwd=cwd,environment=env,maximum_seconds=maximum,hard_deadline=submission['hardDeadline'],output=stepdir/'process',gate=gate,owner=owner))
  elif step.get('commandsArtifact'):
   need(previous_preparation is not None,'Original command producer must precede sequence');commands=json.loads((previous_preparation/step['commandsArtifact']).read_text())['commands'];need([x['id'] for x in commands]==step['exactOrder'],'Original command order changed')
   for row in commands:
    journal=row.get('journalOwnerRequired',False);need(not journal or submission['journalOwnerRequired'],'Actual journal owner required')
    maximum=step['maximumHostedCommandSeconds'] if journal else step['maximumOtherCommandSeconds']
    results.append(run_command(row['command'],cwd=cwd,environment=env,maximum_seconds=maximum,hard_deadline=submission['hardDeadline'],output=stepdir/row['id'],gate=gate,owner=owner))
  elif step.get('argvFrom')=='preparation.json.reservationCommand':
   need(submission['journalOwnerRequired'] and previous_preparation is not None,'Root-exclusive journal owner and original cohort preparation required')
   argv=json.loads((previous_preparation/'preparation.json').read_text())['reservationCommand'];results.append(run_command(argv,cwd=cwd,environment=env,maximum_seconds=step['maximumSeconds'],hard_deadline=submission['hardDeadline'],output=stepdir/'process',gate=gate,owner=owner))
  else:
   command=step.get('command',step);argv=command['argv'];scoped.update(experimentPath=str(previous_preparation/'experiment.json') if previous_preparation else None,experimentOutput=str(previous_preparation/'run') if previous_preparation else None)
   argv=None if step['id']=='replay-original-linux-entry' else resolve(argv,scoped)
   if 'source' in step:checked(step['source'])
   if step['id']=='replay-original-linux-entry':
    need(job['unitId']=='seed29/replay' and previous_preparation is not None,'Exact remaining replay with original package')
    specification=inp['replayConfiguration'];builder=checked_module('aws_replay_configuration_builder',specification['builder'])
    value={**specification['inputs'],'unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'resourceAttemptId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'hardDeadline':submission['hardDeadline'],'sourceDirectory':str(cwd),'phaseDeadline':bindings['phaseDeadline'],'awsExecution':inp['providerConfiguration']['awsExecution'],'amendment':file_ref(previous_preparation/'amendment.json'),'archive':file_ref(previous_preparation.with_suffix('.tar.gz'))}
    config=builder.derive(value,now=time.time());config_path=stepdir/'replay-host-configuration.json';write(config_path,config)
    scoped['replayHostConfiguration']=str(config_path);argv=resolve(command['argv'],scoped)
    need(argv==[value['pythonExecutable']['path'],value['replayHelper']['path'],'--configuration',str(config_path)],'Original exact replay argv with accepted AWS provider transport')
    bindings['replayWorkDirectory']=config['workDirectory']
    operational.append(replay_evidence(inp,submission,bindings,stepdir,'before',cwd,env,gate,owner))
   if command.get('requiresExternalManagedGuard'):
    need(previous_preparation is not None,'Original native preparation required')
    results.append(native_command(inp,submission,bindings,job,stepdir,previous_preparation,argv,cwd,env,gate,owner,current_context,operational))
   else:
    phase=run_command(argv,cwd=cwd,environment=env,maximum_seconds=step['maximumSeconds'],hard_deadline=submission['hardDeadline'],output=stepdir/'process',gate=gate,owner=owner);results.append(phase)
    if step['id']=='replay-original-linux-entry':operational.append(replay_evidence(inp,submission,bindings,stepdir,'complete',cwd,env,gate,owner,phase))
 # Closure is produced by a separately pinned original-validator adapter, never by a list of guessed filenames.
 closure=inp['closureValidator'];checked(closure['source'])
 output_scope={**bindings,'attemptOutput':str(work),'preparationDirectory':str(previous_preparation) if previous_preparation else None}
 declared=resolve(inp['outputs'],output_scope);need(type(declared) is dict and declared,'Concrete original named output mapping required')
 outputs={}
 for name,value in declared.items():
  if type(value) is str:outputs[name]=file_ref(value)
  else:checked(value);outputs[name]=dict(value)
 context={**inp.get('verificationContext',{}),**current_context,'kind':'acephale-aws-component-verification-context-v1','unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'resourceAttemptId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'sourceCommit':SCIENCE,'inputSha256':submission['inputSha256'],'hardDeadline':submission['hardDeadline'],'job':inp['job'],'executionInput':execution_input_ref,'outputs':outputs,'unitScientificIds':inp['unitScientificIds'],'runRoot':bindings['runRoot'],'attemptOutput':str(work),'occurrenceId':job.get('occurrenceId'),'scienceSourceDirectory':str(cwd),'scientificPhaseReceipts':[{'dispatch':r['dispatch'],'result':r['result']} for r in results]}
 context_path=work/'verification-context.json';write(context_path,context)
 scope={**bindings,'attemptOutput':str(work),'componentClosurePath':str(work/'component-closure.json'),'unitAttemptId':submission['unitAttemptId'],'inputSha256':submission['inputSha256'],'verificationContextPath':str(context_path),'verificationContextSha256':file_ref(context_path)['sha256']}
 results.append(run_command(resolve(closure['argv'],scope),cwd=cwd,environment=env,maximum_seconds=closure['maximumSeconds'],hard_deadline=submission['hardDeadline'],output=work/'closure-process',gate=gate,owner=owner))
 evidence=validate_completion(json.loads((work/'component-closure.json').read_text()),submission['unitId'],submission['unitAttemptId'],submission['inputSha256'])
 return {'phases':results,'operationalPreparationPhases':operational,'componentClosure':file_ref(work/'component-closure.json'),'outputFiles':evidence['files']}

def export_plan(work,inp):
 # Only newly generated attempt/run/replay output roots; no credential or source tree sweep.
 roots=[Path(work)]
 run=Path(inp['bindings']['runRoot'])
 need(run.parent==Path('/srv/acephale/runs') and run.name==Path(work).name,'Exact scientific attempt export root')
 if run.exists():roots.append(run)
 for config in Path(work).glob('*/replay-host-configuration.json'):
  value=json.loads(config.read_text());replay=Path(value['workDirectory'])
  need(replay.parent==Path('/srv/acephale') and replay.name.startswith('trained-replay-seed29-'),'Exact original replay export root')
  if replay.exists():roots.append(replay)
  roots.extend(p for p in (replay.with_suffix('.tar.gz'),replay.with_suffix('.receipt.json')) if p.exists())
 files={}
 for root in roots:
  need(not any(p.is_symlink() for p in (root,*root.parents)),'No output symlink roots')
  paths=[root] if root.is_file() else sorted(root.rglob('*'))
  for path in paths:
   need(not path.is_symlink(),'No output symlink')
   if path.is_file():
    need(path.is_relative_to(Path('/srv/acephale')),'Contained explicit output')
    files[str(path)]=path
    need(len(files)<=50000,'Bounded explicit output count')
 return [files[k] for k in sorted(files)]

def bound_provider_configuration(inp,submission):
 config=copy.deepcopy(inp['providerConfiguration']);execution=config['awsExecution']
 need(execution.get('inputSha256') is None,'Self-referential execution input hashes must remain explicit until actual bytes are bound')
 need(config['sourceCommit']==SCIENCE and config['instanceId']==submission['instanceId'] and config['leaseId']==submission['resourceAttemptId'] and config['hardDeadline']==submission['hardDeadline'],'Actual submission provider identity')
 need(execution['unitId']==submission['unitId'] and execution['attemptId']==submission['unitAttemptId'] and execution['qualificationSha256']==submission['qualificationSha256'] and execution['association']['sha256']==submission['associationSha256'],'Exact actual attempt and evidence')
 execution['inputSha256']=submission['inputSha256']
 return config

class WorkerStopRequested(RuntimeError):
 pass

def install_stop_handlers():
 stopping=False
 def stop(signum,frame):
  nonlocal stopping
  if stopping:return
  stopping=True
  raise WorkerStopRequested('Owned worker stop requested: '+str(signum))
 for signum in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(signum,stop)
 return stop

def bound_execution_input(inp,submission):
 provider=bound_provider_configuration(inp,submission);bound={**inp,'providerConfiguration':provider}
 if inp.get('publicGuard'):
  guard=copy.deepcopy(inp['publicGuard']);transport=guard['transport']['configuration']
  need(transport['awsExecution']==inp['providerConfiguration']['awsExecution'],'Native transport must bind exact same originally unbound AWS execution identity')
  transport['awsExecution']=copy.deepcopy(provider['awsExecution'])
  bound['publicGuard']=guard
 return bound

def main():
 import boto3
 p=argparse.ArgumentParser();p.add_argument('--submission-key',required=True);p.add_argument('--submission-sha256',required=True);p.add_argument('--bucket',required=True);p.add_argument('--claim-table',required=True);p.add_argument('--region',required=True);a=p.parse_args()
 store=Store(boto3.client('s3',region_name=a.region),a.bucket);submission,_=store.get(a.submission_key,a.submission_sha256);need(file_ref(__file__)==submission['workerSource'],'Exact reviewed worker required')
 response=store.s3.get_object(Bucket=store.bucket,Key=submission['executionInput']['key'])
 with response['Body'] as body:raw_input=body.read(64*1024*1024+1)
 need(len(raw_input)<=64*1024*1024 and hashlib.sha256(raw_input).hexdigest()==submission['inputSha256'],'Exact bounded execution input bytes')
 inp=json.loads(raw_input);work=Path('/srv/acephale/attempts')/submission['unitAttemptId'];work.mkdir(parents=True,exist_ok=False)
 with (work/'execution-input.json').open('xb') as stream:stream.write(raw_input)
 execution_input_ref=file_ref(work/'execution-input.json')
 install_stop_handlers()
 result={'kind':'acephale-aws-unit-worker-result-v1','unitId':submission['unitId'],'attemptId':submission['unitAttemptId'],'inputSha256':submission['inputSha256'],'workerSha256':submission['workerSource']['sha256'],'startedAt':time.time(),'completed':False,'allChildrenDrained':False,'exitCode':None}
 try:
  inp=bound_execution_input(inp,submission);gate=provider_gate(inp['providerConfiguration']);gate();out=execute(inp,submission,work,gate,execution_input_ref);result.update(out,completed=True,allChildrenDrained=True,exitCode=0)
 except BaseException as e:
  result.update(failureType=type(e).__name__,failure=str(e),exitCode=1)
  phases=[json.loads(p.read_text()) for p in work.glob('**/result.json')];result['allChildrenDrained']=bool(phases) and all(x.get('drained') is True for x in phases)
  raise
 finally:
  result['finishedAt']=time.time();write(work/'result.json',result)
  prefix='results/'+submission['unitId'].replace('/','-')+'/'+submission['unitAttemptId']
  artifacts=[]
  for path in export_plan(work,inp):
   if path.name=='result.json' and path.parent==work:continue
   ref=file_ref(path);key=prefix+'/artifacts/'+path.relative_to(Path('/srv/acephale')).as_posix()
   checksum=base64.b64encode(bytes.fromhex(ref['sha256'])).decode()
   with path.open('rb') as stream:r=store.s3.put_object(Bucket=store.bucket,Key=key,Body=stream,IfNoneMatch='*',ChecksumSHA256=checksum)
   need(r.get('VersionId') not in (None,'','null'),'Versioned scientific artifact required')
   head=store.s3.head_object(Bucket=store.bucket,Key=key,VersionId=r['VersionId'],ChecksumMode='ENABLED')
   need(head.get('ContentLength')==path.stat().st_size and head.get('ChecksumSHA256')==checksum and head.get('ChecksumType')=='FULL_OBJECT','Server-verified full scientific output bytes')
   artifacts.append({'path':str(path),'key':key,'sha256':ref['sha256'],'versionId':r['VersionId'],'bytes':path.stat().st_size})
  result['durableArtifacts']=artifacts;store.put(prefix+'/result.json',result)
if __name__=='__main__':main()
