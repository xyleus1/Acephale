"""Closed-cohort telemetry selection, protected issue, immutable export and original verification."""
from pathlib import Path
import argparse,fcntl,hashlib,importlib.util,json,os,re,shlex,subprocess,sys,time
import boto3
from botocore.config import Config
import tarfile
HERE=Path(__file__).resolve().parent
ORIGINAL=Path('/REQUIRED_BINDINGS/research-root/workspaces/root/corrective-telemetry-01')
PIN={'selector':'4791ec1ed04a9d8ac2b1be3320641f5755630c46af32257517da3394b34368c6','observer':'e088c613a823f3fa44babcc14fd930195d6bb74f1016d1a70f7b4af030c3e4ea','capture':'b7f67a70f7163936006031d8ca2e2fe03250adcaf443f413bdb7941c91f8c222','verifier':'5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358','adapter':'55a99df6e34dd84e8f6ef005cf375f8d2b207a7dd61076b09c546555a33ca69b'}
SOURCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return(json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def ref(p):p=Path(p);return {'path':str(p),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
def write(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);data=v if isinstance(v,bytes) else raw(v)
 with p.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 p.chmod(0o600);return ref(p)
def checked(r):
 p=Path(r['path']);need(p.is_absolute() and p.is_file() and not any(q.is_symlink() for q in(p,*p.parents)),'Regular absolute input')
 b=p.read_bytes();need(sha(b)==r['sha256'] and ('bytes' not in r or len(b)==r['bytes']),'Input bytes changed');return p
def read(r):return json.loads(checked(r).read_text())
def module(p,name):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def originals():
 rows={'selector':ORIGINAL/'imports/select_native_telemetry_traces.py','observer':ORIGINAL/'imports/telemetry_observation_5a.py','capture':ORIGINAL/'imports/closeout_host.py','verifier':ORIGINAL/'summarize_scheduler_events.py','adapter':ORIGINAL/'prepare_observer_paths02.py'}
 for k,p in rows.items():need(sha(p.read_bytes())==PIN[k],'Pinned original changed: '+k)
 return rows
def fetched(r,s3):
 if r.get('path') and Path(r['path']).is_file():return checked(r).read_bytes()
 need(all(r.get(k) for k in ('bucket','key','versionId','sha256','bytes')),'Versioned source required')
 b=s3.get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])['Body'].read()
 need(sha(b)==r['sha256'] and len(b)==r['bytes'],'Versioned bytes differ');return b
def drained(index):
 state=index.get('unitState',{})
 if isinstance(state,str):state=dict(l.split('=',1) for l in state.splitlines() if '=' in l)
 if isinstance(state,dict) and str(state.get('MainPID'))=='0' and state.get('ActiveState') in ('inactive','failed') and state.get('SubState') in ('dead','exited','failed'):return True
 return index.get('ownedProcessesDrained') is True and index.get('remainingPids')==[] and index.get('drainErrors',[])==[]
def prepare(config_ref,output):
 c=read(config_ref);need(c['kind']=='acephale-native-telemetry-closure-input-v1','Explicit telemetry closure input')
 need(re.fullmatch('[a-z][a-z0-9-]{0,63}',c['operationId']) is not None,'Finite operation name')
 for n in ('providerLease','providerReceipt','servingReceipt'):read(c[n])
 if c.get('lateManagedObservation'):
  need(len(c['lateManagedObservation']['closedResults'])==2,'Both host final segments required')
 else:read(c['managedObservation'])
 lease=read(c['providerLease']);need(lease['id']==c['resourceAttemptId'] and lease['instanceId']==c['instanceId'],'Actual lease ownership')
 out=Path(output);need(out.is_absolute() and out.is_relative_to('/REQUIRED_BINDINGS/research-root/workspaces') and not out.exists(),'Fresh isolated output')
 original=originals();s3=boto3.client('s3',region_name=c['region'])
 cohorts=[]
 for row in c['closedCohorts']:
  directory=Path(row['directory']);receipt=directory/'cohort-receipt.json'
  need(checked(row['receipt'])==receipt,'Exact restored cohort receipt')
  index=json.loads(fetched(row['rawIndex'],s3))
  need(index.get('resourceAttemptId',index.get('leaseId'))==c['resourceAttemptId'],'Closed cohort belongs to another resource')
  if not drained(index):
   terminal_ref=row.get('terminal')
   need(terminal_ref is not None,'Actual current worker terminal required')
   terminal_bytes=fetched(terminal_ref,s3);terminal=json.loads(terminal_bytes)
   need(index.get('ownedProcessesDrained') is True and terminal.get('ownedProcessesDrained') is True,'Actual owned drain required')
   need(index.get('terminal',{}).get('sha256')==terminal_ref['sha256'] and any(f.get('path')==index['terminal']['path'] and f.get('sha256')==terminal_ref['sha256'] for f in index.get('files',[])),'Terminal must belong to exact raw export')
   need(all(terminal.get(k)==index.get(k) for k in ('unitId','attemptId','inputSha256','resourceAttemptId','instanceId')),'Terminal/index ownership differs')
   result=terminal.get('result') or {}
   need(result.get('drained') is True and result.get('localOwnedProcessesDrained') is True and result.get('guardDrained') is True and result.get('providerWatcherDrained') is True,'Original generic worker physical drain required')
  need(any(f.get('sha256')==row['receipt']['sha256'] and f.get('path')==row.get('originalReceiptPath',str(receipt)) for f in index.get('files',[])),'Cohort receipt is not in exact raw export')
  cohorts.append({'directory':str(directory),'receiptSha256':row['receipt']['sha256']})
 need(cohorts,'No actual closed cohort: no selection or worker observation')
 selection_config={'sourceCommit':SOURCE,'maximumTraces':16,'providerLeasePath':c['providerLease']['path'],'providerLeaseSha256':c['providerLease']['sha256'],'cohorts':cohorts}
 sys.path.insert(0,str(Path(c['sourceDirectory'])/'research/acephale/src'));selector=module(original['selector'],'original_native_trace_selector')
 selection=selector.select(selection_config)
 out.mkdir(parents=True,exist_ok=False);write(out/'selection-configuration.json',selection_config);selection_ref=write(out/'trace-selection.json',selection)
 worker_root=Path('/REQUIRED_BINDINGS/research-root/workspaces/root/corrective-telemetry-closure-01/worker')/c['operationId']
 paths={'sourceDirectory':c['sourceDirectory'],'providerReceiptPath':str(worker_root/'provider-receipt.json'),'servingReceiptPath':str(worker_root/'serving-receipt.json')}
 adapter=module(original['adapter'],'original_telemetry_path_adapter');adapted=adapter.prepare(paths,out/'telemetry_observer.py')
 bucket=c['bucket'];prefix='audit/parallel-rescue-20261121/ROOT/corrective-telemetry-closure-01'
 def put(p):
  p=Path(p);b=p.read_bytes();h=sha(b);key=prefix+'/objects/'+h+'/'+p.name;r=s3.put_object(Bucket=bucket,Key=key,Body=b)
  return {'bucket':bucket,'key':key,'versionId':r['VersionId'],'sha256':h,'bytes':len(b)}
 files=[]
 def stage(local,name):
  r=put(local);p=str(worker_root/name);files.append({'path':p,'ref':r});return p,r
 observer_path,observer_ref=stage(out/'telemetry_observer.py','telemetry_observer.py')
 capture_path,capture_ref=stage(original['capture'],'closeout_host.py')
 worker_path,worker_ref=stage(HERE/'worker_observe.py','worker_observe.py')
 cfg={'sourceCommit':SOURCE,'sourceDirectory':c['sourceDirectory'],'helperPath':observer_path,'helperSha256':observer_ref['sha256'],'occurrenceId':c['occurrenceId'],'observationId':c['operationId'],'leaseId':lease['id'],'instanceId':lease['instanceId'],'hardDeadline':lease['deadline'],'captureHelperPath':capture_path,'captureHelperSha256':capture_ref['sha256']}
 for name,file_name in [('providerLease','provider-lease.json'),('providerReceipt','provider-receipt.json'),('servingReceipt','serving-receipt.json')]+([] if c.get('lateManagedObservation') else [('managedObservation','managed-observation.json')]):
  p,r=stage(checked(c[name]),file_name);cfg[name+'Path']=p;cfg[name+'Sha256']=r['sha256']
 if c.get('lateManagedObservation'):
  plan={'kind':'acephale-late-managed-observation-plan-v1','expectedSemanticUnits':c['lateManagedObservation']['expectedSemanticUnits'],'closedResults':[]}
  for ordinal,cr in enumerate(c['lateManagedObservation']['closedResults']):
   closed=read(cr);p,r=stage(checked(cr),'closed-'+str(ordinal)+'.json');closed_ref={'path':p,'sha256':r['sha256'],'bytes':r['bytes']}
   p,r=stage(checked(closed['terminal']),'closed-terminal-'+str(ordinal)+'.json')
   plan['closedResults'].append({'closedResult':closed_ref,'terminal':{'path':p,'sha256':r['sha256'],'bytes':r['bytes']}})
  plan_ref=write(out/'late-managed-plan.json',plan)
  p,r=stage(checked(plan_ref),'late-managed-plan.json');cfg['lateManagedObservationPlanPath']=p
  p,r=stage(HERE/'late_managed_observation.py','late_managed_observation.py');cfg['lateManagedObservationHelperPath']=p;cfg['lateManagedObservationHelperSha256']=r['sha256']
 p,r=stage(checked(selection_ref),'trace-selection.json');cfg['traceSelectionPath']=p;cfg['traceSelectionSha256']=r['sha256']
 output_prefix='workers/'+c['resourceAttemptId']+'/corrective-native-telemetry01/'+c['operationId']
 envelope={'kind':'acephale-native-telemetry-worker-envelope-v1','operationId':c['operationId'],'instanceId':c['instanceId'],'resourceAttemptId':c['resourceAttemptId'],'bucket':bucket,'workerRoot':str(worker_root),'outputPrefix':output_prefix,'configuration':cfg,'files':files,'closedCohorts':c['closedCohorts'],'selection':selection_ref,'queryMaximumSeconds':235,'scientificAcceptance':False}
 er=write(out/'envelope.json',envelope);store=put(checked(er))
 ready={'kind':'acephale-native-telemetry-closure-ready-v1','configuration':config_ref,'envelope':store,'workerSource':worker_ref,'workerPath':worker_path,'workerRoot':str(worker_root),'instanceId':c['instanceId'],'region':c['region'],'pythonExecutable':c['pythonExecutable'],'operationId':c['operationId'],'terminalKey':output_prefix+'/TERMINAL.json','bucket':bucket,'selection':selection_ref,'selectedTraceCount':selection['selectedTraceCount'],'originalSources':{k:ref(v) for k,v in original.items()},'adaptedObserver':ref(out/'telemetry_observer.py'),'workerInvocationPerformed':False}
 return write(out/'READY.json',ready)
def issue(ready_ref):
 r=read(ready_ref);need(r.get('kind')=='acephale-native-telemetry-closure-ready-v1','Exact prepared telemetry');root=checked(ready_ref).parent
 with (root/'issue.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  result=root/'DISPATCH.json'
  if result.exists():return read(ref(result))
  need(not (root/'ISSUE-INTENT.json').exists(),'Unresolved issue intent: reconcile exact SSM handle; never duplicate')
  e=r['envelope'];w=r['workerSource']
  need(Path(r['pythonExecutable']).is_absolute(),'Exact existing worker interpreter')
  bootstrap="import boto3,hashlib,pathlib,subprocess,json; r="+repr(w)+"; b=boto3.client('s3').get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])['Body'].read(); assert hashlib.sha256(b).hexdigest()==r['sha256'] and len(b)==r['bytes']; p=pathlib.Path("+repr(r['workerPath'])+"); p.parent.mkdir(parents=True,exist_ok=True); assert not p.exists() or p.read_bytes()==b; p.write_bytes(b); subprocess.run(["+repr(r['pythonExecutable'])+",str(p),'--envelope-ref',"+repr(json.dumps(e))+ "],check=True)"
  command=shlex.quote(r['pythonExecutable'])+' -c '+shlex.quote(bootstrap)
  intent=write(root/'ISSUE-INTENT.json',{'ready':ready_ref,'commandSha256':sha(command.encode()),'at':time.time(),'modelCalls':False})
  response=boto3.client('ssm',region_name=r['region'],config=Config(connect_timeout=5,read_timeout=30,retries={'total_max_attempts':1})).send_command(InstanceIds=[r['instanceId']],DocumentName='AWS-RunShellScript',Comment='Native telemetry '+r['operationId'],Parameters={'commands':[command],'executionTimeout':['330']})
  value={'kind':'acephale-native-telemetry-dispatch-v1','ready':ready_ref,'intent':intent,'commandId':response['Command']['CommandId'],'instanceId':r['instanceId'],'region':r['region'],'issuedAt':time.time(),'modelCalls':False}
  write(result,value);return value
def collect(ready_ref):
 r=read(ready_ref);root=checked(ready_ref).parent
 if (root/'VERIFIED.json').exists():return read(ref(root/'VERIFIED.json'))
 dispatch=read(ref(root/'DISPATCH.json'));ssm=boto3.client('ssm',region_name=r['region'])
 v=ssm.get_command_invocation(CommandId=dispatch['commandId'],InstanceId=r['instanceId'])
 if v['Status'] in ('Pending','InProgress','Delayed'):return {'state':'running','commandId':dispatch['commandId']}
 s3=boto3.client('s3',region_name=r['region'])
 response=s3.get_object(Bucket=r['bucket'],Key=r['terminalKey']);data=response['Body'].read();t=json.loads(data)
 tr={'bucket':r['bucket'],'key':r['terminalKey'],'versionId':response['VersionId'],'sha256':sha(data),'bytes':len(data)}
 need(t['envelope']==r['envelope'] and t['instanceId']==r['instanceId'] and t['operationId']==r['operationId'],'Exact terminal lineage')
 if not (root/'worker-terminal.json').exists():write(root/'worker-terminal.json',data)
 if t['status']!='completed':return {'state':'failed','terminal':tr,'failure':t['failure'],'scientificAcceptance':False}
 archive=fetched(t['archive'],s3);receipt=json.loads(fetched(t['archiveReceipt'],s3))
 path=root/'telemetry.tar.gz'
 if path.exists():need(path.read_bytes()==archive,'Existing archive differs')
 else:write(path,archive)
 observer=module(checked(r['adaptedObserver']),'original_telemetry_archive_verifier')
 result=observer.verify_local_archive(path,receipt)
 with tarfile.open(path,'r:gz') as archive_file:inventory=json.load(archive_file.extractfile('telemetry/inventory.json'))
 telemetry_complete=inventory['selectedTraceCount']>0 and inventory['allSelectedNativeTracesObserved'] is True and inventory['allSelectedActorDecisionSpansObserved'] is True
 value={'kind':'acephale-native-telemetry-closure-verified-v1','state':'completed','ready':ready_ref,'terminal':tr,'archive':t['archive'],'archiveReceipt':t['archiveReceipt'],'originalVerification':result,'artifactExportVerified':True,'telemetryRequirementsSatisfied':telemetry_complete,'nativeBenchmarkScore':False,'scientificAcceptance':False,'modelCalls':False}
 write(root/'VERIFIED.json',value);return value
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','issue','collect']);p.add_argument('--input-ref',required=True);p.add_argument('--output');a=p.parse_args();r=json.loads(a.input_ref)
 print(json.dumps(prepare(r,a.output) if a.action=='prepare' else issue(r) if a.action=='issue' else collect(r)))
