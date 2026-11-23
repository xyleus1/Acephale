"""One claimed fixed80 experiment; original process/guard owner functions reused verbatim."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,signal,subprocess,sys,time,threading,fcntl,traceback
def need(v,m):
 if not v:raise ValueError(m)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def exact_ref(r):need(type(r)is dict and set(r)=={'path','sha256'},'Exact local FileRef')
def checked(r):exact_ref(r);p=Path(r['path']);need(p.is_absolute()and p.is_file()and sha(p)==r['sha256'],'Pinned input/source');return p
def read(r):return json.loads(checked(r).read_text())
def ref(p):return {'path':str(Path(p)),'sha256':sha(p)}
def module(r,name):
 p=checked(r);sp=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(sp);sys.modules[name]=m;sp.loader.exec_module(m);return m
def file_ref(path):
 p=Path(path);need(p.is_absolute() and p.is_file() and not any(x.is_symlink() for x in (p,*p.parents)),'Absolute regular source/artifact required')
 with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 return {'path':str(p),'sha256':h}

def write(path,value):
 with Path(path).open('x') as f:json.dump(value,f,indent=2,allow_nan=False);f.write(chr(10));f.flush();os.fsync(f.fileno())

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

def execute(configref):
 c=read(configref);root=Path(c['outputRoot']);root.mkdir(parents=True,exist_ok=False)
 lock=(root/'worker.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 import boto3
 ddb=boto3.client('dynamodb',region_name='us-east-1')
 from boto3.dynamodb.types import TypeDeserializer
 de=TypeDeserializer()
 def row(key):
  v=ddb.get_item(TableName=c['claimTable'],Key={'pk':{'S':key}},ConsistentRead=True).get('Item',{})
  return {k:de.deserialize(x)for k,x in v.items()}
 def gate():
  need(time.time()+180<c['phaseDeadline']<=c['hardDeadline']==1795413600,'Finite science/cleanup boundary')
  need(Path('/sys/devices/virtual/dmi/id/board_asset_tag').read_text().strip()==c['instanceId'],'Fresh actual host')
  u=row('unit#'+c['unitId']);r=row('resource#'+c['resourceAttemptId'])
  need(u.get('attemptId')==c['attemptId']and u.get('inputSha256')==c['inputSha256']and u.get('status')in('claimed','running')and u.get('directExecutionCompleted')is not True,'Exact current corrective claim')
  need(r.get('attemptId')==c['resourceAttemptId']and r.get('scientificUnitAttemptId')==c['attemptId']and r.get('evidence',{}).get('instanceId')==c['instanceId']and float(r.get('deadline',0))==c['hardDeadline']and r.get('retirementAuthorized')is not True and r.get('reservationReleased')is not True,'Current finite resource ownership')
  need(subprocess.check_output(['systemctl','is-active',c['hardStopTimer']],text=True).strip()=='active','Original hard-stop timer')
 for x in c['sourceFiles']:checked(x)
 terminal=read(c['qualificationTerminal']);need(terminal['completed']is True and terminal['ownedProcessesDrained']is True and terminal['failure']is None,'Real completed qualification')
 gate()
 source=Path(c['sourceDirectory']);sys.path.insert(0,str(source/'research/acephale/src'));sys.path.insert(0,str(Path(c['guardSource']['path']).parent))
 guardapi=module(c['guardSource'],'corrective_native_guard')
 planinput=root/'owner-admission-input.json';write(planinput,c['admission']);admission=root/'owner-admission.json'
 env=dict(os.environ)
 for k in list(env):
  if k.startswith(('OPENAI_','ANTHROPIC_'))or k in ('HF_TOKEN','HUGGING_FACE_HUB_TOKEN','LAMBDA_API_KEY'):env.pop(k,None)
 env.update(c['environment']);env['ACEPHALE_HOST_STATUS_FILE']=str(root/'qualified-guard')
 owner={'unitId':c['unitId'],'attemptId':c['attemptId'],'inputSha256':c['inputSha256'],'resourceAttemptId':c['resourceAttemptId'],'instanceId':c['instanceId']}
 result=None;failure=None
 try:
  run_command([c['python'],'-B',c['guardSource']['path'],'plan','--input',str(planinput),'--output',str(admission)],cwd=source,environment=env,maximum_seconds=60,hard_deadline=c['hardDeadline'],output=root/'admission-process',gate=gate,owner=owner)
  plan=json.loads(admission.read_text());status=root/'qualified-guard';stop=root/'qualified-guard.stop'
  transport=root/'guard-transport.json';write(transport,c['transport'])
  guardargv=[c['python'],'-B',c['guardSource']['path'],'guard','--source',str(source),'--configuration',plan['guardPath'],'--output',str(status),'--stop-file',str(stop),'--transport-input',str(transport),'--transport-sha256',sha(transport)]
  healthargv=[c['python'],'-B',c['guardSource']['path'],'health','--source',str(source),'--input',str(admission),'--output',str(status)]
  managed={'argv':guardargv,'environment':env,'stopFile':str(stop),'source':c['guardSource'],'admission':ref(admission),'phaseCutoff':min(plan['deadline'],c['phaseDeadline']-180),'health':lambda:guard_health(healthargv,env,source)}
  argv=[c['python'],'-m','acephale.experiment_runner','--manifest',c['experiment']['path'],'--output',c['experimentOutput']]
  need(c['admission']['value']['mode']=='native','Credential injection only for original native mode')
  credentials=c['childCredentials'];need(credentials['source']=={'path':'/REQUIRED_BINDINGS/research-root/workspaces/report/full-dag-controller-02/child_credentials.py','sha256':'363a2a7460bccc9dad45cfc8398640bd62eb548f1942edf116e13220fa6a621a'},'Exact original credential loader')
  loader=module(credentials['source'],'corrective_native_child_credentials')
  with loader.child_environment(env,credentials['secret'],boto3.client('secretsmanager',region_name='us-east-1')) as child_env:
   result=run_command(argv,cwd=source,environment=child_env,maximum_seconds=plan['maximumSeconds'],hard_deadline=c['hardDeadline'],output=root/'experiment-process',gate=gate,owner=owner,managed_guard=managed)
 except BaseException as e:
  failure={'type':type(e).__name__,'message':str(e),'traceback':traceback.format_exc()}
 finally:
  local=result or (json.loads((root/'experiment-process/result.json').read_text())if(root/'experiment-process/result.json').exists()else (json.loads((root/'admission-process/result.json').read_text())if(root/'admission-process/result.json').exists()else None))
  value={'kind':'acephale-corrective-original-profile-terminal-v1',**owner,'configuration':configref,'completed':bool(result and result['completed']),'failure':failure,'ownedProcessesDrained':bool(local and local.get('localOwnedProcessesDrained'))if local else True,'result':local,'historicalFailuresPreserved':True,'automaticRetry':False,'scientificAcceptanceAsserted':False,'at':time.time()}
  write(root/'TERMINAL.json',value)
  s3=boto3.client('s3',region_name='us-east-1');files=[]
  roots=[root,Path(c['experiment']['path']).parent,Path(c['transport']['linuxObservation']['inputs']['outputRoot'])]
  for p in sorted({x for rr in roots if rr.exists()for x in rr.rglob('*')if x.is_file()and x.name!='worker.lock'}):
   data=p.read_bytes();h=hashlib.sha256(data).hexdigest();key=c['outputPrefix']+'/objects/'+h+'/'+p.name
   response=s3.put_object(Bucket=c['bucket'],Key=key,Body=data)
   files.append({'path':str(p),'bucket':c['bucket'],'key':key,'versionId':response['VersionId'],'sha256':h,'bytes':len(data)})
  index={'kind':'acephale-corrective-profile-export-v1',**owner,'completed':value['completed'],'ownedProcessesDrained':value['ownedProcessesDrained'],'terminal':ref(root/'TERMINAL.json'),'files':files,'at':time.time(),'automaticRetry':False}
  data=(json.dumps(index,sort_keys=True,indent=2)+'\n').encode();h=hashlib.sha256(data).hexdigest();key=c['outputPrefix']+'/RAW-INDEX-'+h+'.json';r=s3.put_object(Bucket=c['bucket'],Key=key,Body=data)
  write(root/'EXPORTED.json',{'bucket':c['bucket'],'key':key,'versionId':r['VersionId'],'sha256':h,'bytes':len(data)})
  s3.put_object(Bucket=c['bucket'],Key=c['outputPrefix']+'/CURRENT-EXPORT.json',Body=(json.dumps({'bucket':c['bucket'],'key':key,'versionId':r['VersionId'],'sha256':h,'bytes':len(data)})+'\n').encode())
 if failure:raise RuntimeError(failure['message'])
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--configuration',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();execute({'path':a.configuration,'sha256':a.sha256})
