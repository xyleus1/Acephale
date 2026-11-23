"""Execute one bounded, source-pinned telemetry observation; no model or lifecycle mutations."""
from pathlib import Path
import argparse,fcntl,hashlib,importlib.util,json,os,sys,time,traceback
import boto3
from botocore.config import Config
def need(x,m):
 if not x: raise ValueError(m)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def raw(v): return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def write(p,b):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 p.chmod(0o600)
def fetch(s3,r):
 need(all(r.get(k) for k in ('bucket','key','versionId','sha256')),'Immutable versioned input required')
 b=s3.get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])['Body'].read()
 need(sha(b)==r['sha256'] and len(b)==r['bytes'],'Immutable input bytes changed');return b
def module(p,name):
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
def execute(envelope_ref):
 s3=boto3.client('s3',config=Config(connect_timeout=5,read_timeout=15,retries={'max_attempts':1}))
 e=json.loads(fetch(s3,envelope_ref));need(e['kind']=='acephale-native-telemetry-worker-envelope-v1','Exact telemetry envelope')
 need(Path('/sys/devices/virtual/dmi/id/board_asset_tag').read_text().strip()==e['instanceId'],'Actual instance differs')
 root=Path(e['workerRoot']);need(root.is_absolute() and root.is_relative_to('/REQUIRED_BINDINGS/research-root') and '..' not in root.parts,'Contained fresh telemetry root')
 root.mkdir(parents=True,exist_ok=True)
 lock=(root/'owner.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 terminal_key=e['outputPrefix']+'/TERMINAL.json'
 def put(label,b):
  key=e['outputPrefix']+'/objects/'+sha(b)+'/'+label
  r=s3.put_object(Bucket=e['bucket'],Key=key,Body=b)
  return {'bucket':e['bucket'],'key':key,'versionId':r['VersionId'],'sha256':sha(b),'bytes':len(b)}
 if (root/'TERMINAL.ref.json').exists():return json.loads((root/'TERMINAL.ref.json').read_text())
 need(not (root/'ISSUE-INTENT.json').exists(),'Prior telemetry intent exists; adopt existing evidence, never duplicate query')
 write(root/'ISSUE-INTENT.json',raw({'envelope':envelope_ref,'at':time.time(),'modelCalls':False}))
 result={'kind':'acephale-native-telemetry-worker-terminal-v1','operationId':e['operationId'],'resourceAttemptId':e['resourceAttemptId'],'instanceId':e['instanceId'],'envelope':envelope_ref,'startedAt':time.time(),'modelCalls':False,'scientificAcceptance':False}
 try:
  for row in e['files']:
   p=Path(row['path']);need(p.is_relative_to(root) and '..' not in p.parts,'Contained immutable staged file')
   data=fetch(s3,row['ref'])
   if p.exists():need(p.is_file() and not p.is_symlink() and p.read_bytes()==data,'Existing staged file differs')
   else:write(p,data)
  c=dict(e['configuration']);c['deadline']=min(time.time()+235,c['hardDeadline']-30)
  need(c['deadline']>time.time()+30,'Insufficient finite observation window')
  helper=module(c['helperPath'],'native_telemetry_observer')
  if c.get('lateManagedObservationPlanPath'):
   need(sha(Path(c['lateManagedObservationHelperPath']).read_bytes())==c['lateManagedObservationHelperSha256'],'Exact late observation helper')
   late=module(c['lateManagedObservationHelperPath'],'late_managed_observation')
   managed=late.materialize(c['lateManagedObservationPlanPath'],c,helper,root/'managed-observation.json')
   c['managedObservationPath']=managed['path'];c['managedObservationSha256']=managed['sha256']
   result['managedObservation']=put('managed-observation.json',Path(managed['path']).read_bytes())
  write(root/'configuration.json',raw(c))
  receipt=helper.bounded_query(c)
  archive=Path(receipt['archive']);data=archive.read_bytes()
  need(sha(data)==receipt['sha256'] and len(data)==receipt['bytes'],'Actual archive receipt differs')
  verified=helper.verify_local_archive(archive,receipt)
  result.update(status='completed',archive=put('telemetry.tar.gz',data),archiveReceipt=put('archive-receipt.json',raw(receipt)),workerVerification=put('worker-verification.json',raw(verified)),queryConfiguration=put('configuration.json',raw(c)),selectedTraceCount=receipt['selectedTraceCount'],actualNativeTraceEvidenceCount=receipt['actualNativeTraceEvidenceCount'],failure=None)
 except BaseException as exc:
  result.update(status='failed',failure={'type':type(exc).__name__,'message':str(exc),'traceback':traceback.format_exc()})
 finally:
  if result.get('status')=='failed':
   partial=Path('/REQUIRED_BINDINGS/research-root/artifacts')/('telemetry-'+e['operationId']);saved=[];total=0
   if partial.is_dir():
    for item in sorted(partial.iterdir()):
     if item.is_file() and not item.is_symlink():
      data=item.read_bytes();total+=len(data)
      if len(data)<=4*1024**2 and total<=64*1024**2:
       try:saved.append({'path':str(item),'ref':put(item.name,data)})
       except Exception as export_error:saved.append({'path':str(item),'sha256':sha(data),'exportFailure':str(export_error)})
   result['retainedPartialFiles']=saved
  result['finishedAt']=time.time();result['observationFinished']=True
  write(root/'TERMINAL.json',raw(result));z=raw(result)
  response=s3.put_object(Bucket=e['bucket'],Key=terminal_key,Body=z)
  rr={'bucket':e['bucket'],'key':terminal_key,'versionId':response['VersionId'],'sha256':sha(z),'bytes':len(z)}
  write(root/'TERMINAL.ref.json',raw(rr))
 return rr
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--envelope-ref',required=True);a=p.parse_args()
 print(json.dumps(execute(json.loads(a.envelope_ref))))
