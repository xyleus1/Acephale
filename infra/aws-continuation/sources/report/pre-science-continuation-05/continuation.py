"""One root-approved pre-science continuation; the permanent assignment is never replaced."""
from pathlib import Path
import argparse,base64,copy,hashlib,importlib.util,json,math,os,re,stat,time,sys
ROOT=Path('/srv/acephale')
ATTEMPT='unit-b8dae1aff90e4b838cb08b973c6e6ec6'
UNIT='seed17/opportunity'
RESOURCE='cap-7bbb0f23-5f46-4dca-848c-41f37ad02883'
INSTANCE='i-06e316e5f1954f51b'
SCIENCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
INPUT='2d22c77ae0536d9257e329526b5c0e4cec0563ee96fdfb66e68179527ae5068d'
FAILED='b390420c2ba5b8a029915095757092e029862d81eaf8123f6eb035f6aadde7c3'
BUCKET='acephale-aws-20261121-971290362335'
TABLE='acephale-aws-20261121'
PREFIX='results/seed17-opportunity/'+ATTEMPT
RESULT_KEY=PREFIX+'/operational-generations/05/result.json'
PREVIOUS_FAILED='f32f0700abf0fb594a15ffe62596b012471884892a5aab4aa3bcc37e173e4e2a'
PARENT_AUTHORITY={'path':'/srv/acephale/artifacts/seed17-opportunity-continuation-04.json','sha256':'29ddf1473ed480dd20ea5eeffd7f9d8b7359c11079f0cb6b1b8f6de1311f1ecf'}
NATIVE_PYTHON='/srv/acephale/workspaces/operator/native-profile-environment-04/venv/bin/python'
AUTHORITY_PATH=ROOT/'artifacts/seed17-opportunity-continuation-05.json'
MAP={'path':'/srv/acephale/workspaces/operator/regional-numerical-inputs-01/source-map.json','sha256':'699c5719951e580ee4b4372195e4a4e0f7f427a49a10b859c8e5c91e2027086e'}
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)+chr(10)).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def ref(p):return {'path':str(p),'sha256':sha(Path(p).read_bytes())}
def checked(r):
 need(type(r)is dict and set(r)=={'path','sha256'},'Exact local FileRef')
 p=Path(r['path']);need(p.is_absolute()and '..'not in p.parts and p.is_relative_to(ROOT)and p.is_file()and not any(q.is_symlink()for q in(p,*p.parents)),'Exact regular cloud file')
 need(sha(p.read_bytes())==r['sha256'],'Immutable referenced bytes');return p
def load(name,r):
 p=checked(r);s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);sys.modules[name]=m;sys.path.insert(0,str(p.parent))
 try:s.loader.exec_module(m)
 finally:sys.path.pop(0)
 return m
def read(r):return json.loads(checked(r).read_text())
def write(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with os.fdopen(os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb')as f:f.write(raw(v));f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def mkdir_generation(path):
 path.mkdir(parents=True,exist_ok=False)
 for parent in (path.parent,path.parent.parent):
  fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
def includes(v,r):
 if type(v)is dict:
  if v.get('path')==r['path']and v.get('sha256')==r['sha256']:return True
  return any(includes(x,r)for x in v.values())
 if type(v)is list:return any(includes(x,r)for x in v)
 return False
def source_map(a):
 need(a['sourceMap']==MAP,'Exact independently reviewed regional helper map')
 m=read(MAP);need(m['kind']=='acephale-aws-regional-numerical-source-map-v1'and len(m['sourceMap'])==7,'Exact seven helper substitutions')
 review=read(a['sourceReview']);need(review.get('accepted')is True and includes(review,MAP),'Accepted map peer')
 for row in m['sourceMap']:
  checked(row['original']);checked(row['replacement'])
  need(includes(review,row['replacement']),'Direct reviewed replacement pin')
 for r in m['addedFiles']:checked(r)
 return m
def mapped(m,r):
 rows=[x['replacement']for x in m['sourceMap']if x['original']==r]
 need(len(rows)==1,'One exact mapped original source');return rows[0]
def authority(r,*,now=None,live=True):
 p=checked(r);need(p==AUTHORITY_PATH,'Exact second-generation root authority path')
 st=p.stat();need(st.st_uid==0 and st.st_mode&0o022==0,'Protected root-owned authority')
 a=json.loads(p.read_text());now=time.time()if now is None else now
 need(a.get('kind')=='acephale-aws-pre-science-operational-continuation-v1'and a.get('approved')is True and a.get('authorityStatus')=='active','Explicit active root approval')
 need(a.get('unitId')==UNIT and a.get('unitAttemptId')==ATTEMPT and a.get('resourceAttemptId')==RESOURCE and a.get('instanceId')==INSTANCE and a.get('generation')=='05','Only exact retained second generation')
 need(a.get('inputSha256')==INPUT and a.get('sourceCommit')==SCIENCE and a.get('workerRegion')=='us-east-2'and a.get('accountId')=='971290362335','Original assignment and authority endpoint')
 need(type(a.get('issuedAt'))in(int,float)and math.isfinite(a['issuedAt'])and a['issuedAt']<=now and (not live or now<a['hardDeadline']) and a['hardDeadline']==1795336350,'Original finite hard deadline unchanged')
 for k in ('scientificAttemptReissued','scientificSettingsChanged','qualificationRepeated','checkpointRepeated','originalFailureReclaimed','completedPreparationRepeated','calibrationAdoptionRepeated'):
  need(a.get(k)is False,'Explicit false '+k)
 need(a['resultKey']==RESULT_KEY and a['failedResult']['key']==PREFIX+'/result.json'and a['failedResult']['sha256']==FAILED,'Retained initial failed result')
 need(a.get('parentAuthority')==PARENT_AUTHORITY and a['previousFailedResult']['key']==PREFIX+'/operational-generations/04/result.json'and a['previousFailedResult']['sha256']==PREVIOUS_FAILED,'Retained failed first operational generation')
 need(a.get('priorProfileDispatched')is True and a.get('priorNativeModelRequestsDispatched')is False and a.get('failedPreModelMeasurementsRetained')==20 and a.get('recoveryNativePython')==NATIVE_PYTHON,'Truthful pre-model import recovery only')
 for k in ('runner','resumePreparation','controllerSource','workerSource','preparationCompletion','closureSource','retainedEvidence','nativeEvidenceSource'):checked(a[k])
 need(a.get('operationalStageId')=='native-9077d14518bc18af3b1ca6ad71c0dff6-op05' and a.get('priorNativeEvidenceFailedBeforeProfile')is True,'Exact generation-specific operational evidence stage')
 need(a['runner']==ref(__file__),'Exact actual continuation runner')
 need(a['controllerSource']['sha256']=='d911f47255018a771bb2e50408a2022de212c632c8629d72422fae898a13f2b0','Unchanged accepted controller source')
 return a
def s3_json(s3,r):
 response=s3.get_object(Bucket=BUCKET,Key=r['key'],**({'VersionId':r['versionId']}if r.get('versionId')else {}))
 with response['Body']as b:data=b.read(64*1024*1024+1)
 need(len(data)<=64*1024*1024 and sha(data)==r['sha256']and response.get('VersionId')not in(None,'','null'),'Exact versioned bounded original bytes')
 need(not r.get('versionId')or response.get('VersionId')==r['versionId'],'Requested immutable original version')
 need('bytes'not in r or len(data)==r['bytes'],'Original declared object length')
 return json.loads(data)
def original_evidence(a,s3):
 failed=s3_json(s3,a['previousFailedResult']);submission=s3_json(s3,a['submission'])
 need(all(submission[k]==v for k,v in {'unitId':UNIT,'unitAttemptId':ATTEMPT,'resourceAttemptId':RESOURCE,'instanceId':INSTANCE,'inputSha256':INPUT,'hardDeadline':a['hardDeadline']}.items()),'Original immutable submission')
 need(failed.get('unitId')==UNIT and failed.get('attemptId')==ATTEMPT and failed.get('inputSha256')==INPUT and failed.get('originalWorkerSource')==submission['workerSource'],'Same failed assignment')
 need(failed.get('operationalContinuation')==PARENT_AUTHORITY and failed.get('operationalExecutionGeneration')=='04'and failed.get('originalFailedResultSha256')==FAILED and failed.get('workerSha256')=='34a3d2292821c1b8a2322cb53eb4c61bff2d14d60a81bafc025c38a3d5640740','Exact retained second operational generation')
 need(failed.get('completed')is False and failed.get('allChildrenDrained')is True and type(failed.get('exitCode'))is int and failed['exitCode']==1,'Only drained failed original profile')
 artifacts={r['path']:r for r in failed['durableArtifacts']};need(len(artifacts)==len(failed['durableArtifacts']),'Unique artifact inventory')
 evidence=read(a['retainedEvidence']);need(evidence['previousFailedResult']==a['previousFailedResult']and evidence['parentAuthority']==PARENT_AUTHORITY,'Bound retained generation evidence')
 for r in evidence['files']:
  need(artifacts.get(r['path'],{}).get('sha256')==r['sha256'],'Exact previous exported bytes');checked(r)
 work=ROOT/'attempts'/ATTEMPT;prepared=work/'01-prepare/prepared';profile=prepared/'run/profile/artifacts'
 receipt=json.loads((profile/'receipt.json').read_text())
 need(receipt.get('declared')==20 and receipt.get('completed')==0 and receipt.get('failed')==20 and receipt.get('closed')is True and receipt.get('cleanupFailures')==[] and receipt.get('readyForAggregation')is False,'All twenty failure records closed, none completed')
 measurements=json.loads((profile/'measurements.json').read_text())
 need(len(measurements['rowIds'])==20 and len(set(measurements['rowIds']))==20,'Original twenty declared public rows')
 for i,key in enumerate(measurements['rowIds']):
  row=json.loads((profile/f'measurement-{i:04d}.json').read_text())
  need(row.get('checkpoint_id')==key and row.get('status')=='failed'and row.get('spans')=={}and row.get('errorType')=='ModuleNotFoundError'and row.get('error')=="No module named 'tau2'",'Only exact pre-model dependency import failure')
 need(not any(profile.glob('prefix-*.json'))and not any(profile.glob('node-measurement-*.json'))and not any(profile.glob('native-*.json')),'No native prefix or measured model call before recovery')
 for process in (work/'operational-generations/02/preparation-completion-process',work/'calibration-adoption-process'):
  r=json.loads((process/'result.json').read_text())
  need(r.get('completed')is True and r.get('exitCode')==0 and all(r.get(k)is True for k in ('drained','localOwnedProcessesDrained','providerWatcherDrained')),'Completed retained preparation and adoption')
 r=json.loads((work/'02-measure-and-aggregate/process/result.json').read_text())
 need(r.get('completed')is False and r.get('exitCode')==1 and all(r.get(k)is True for k in ('drained','localOwnedProcessesDrained','providerWatcherDrained')),'Actual original profile child drained')
 admitted=work/'operational-generations/04/02-measure-and-aggregate/owner-admission-process'
 admission=json.loads((admitted/'result.json').read_text())
 need(admission.get('completed')is True and admission.get('exitCode')==0 and all(admission.get(k)is True for k in ('drained','localOwnedProcessesDrained','providerWatcherDrained')),'Actual admitted retained graph')
 stopped=work/'operational-generations/04/02-measure-and-aggregate/native-evidence-before-process'
 stopped_result=json.loads((stopped/'result.json').read_text())
 need(stopped_result.get('completed')is False and stopped_result.get('exitCode')==1 and all(stopped_result.get(k)is True for k in ('drained','localOwnedProcessesDrained','providerWatcherDrained')),'Previous evidence child fully drained')
 error=(stopped/'stderr.log').read_text()
 need('FileExistsError'in error and 'native-9077d14518bc18af3b1ca6ad71c0dff6-inputs.json'in error,'Exact immutable pre-science evidence collision')
 need(not(work/'operational-generations/04/prepared/run').exists()and not(work/'operational-generations/04/02-measure-and-aggregate/process').exists(),'No generation04 profile dispatched')
 need(not(work/'verification-context.json').exists()and not os.path.lexists(ROOT/'shared/budget.jsonl.lock'),'No completion or open original writer')
 return submission,failed
def project_input(inp,a,m):
 def walk(v):
  if type(v)is dict:
   for row in m['sourceMap']:
    if v==row['original']:return copy.deepcopy(row['replacement'])
   return {k:walk(x)for k,x in v.items()}
  if type(v)is list:return [walk(x)for x in v]
  return v
 out=walk(inp)
 old_source=inp['closureValidator']['source'];new_source=mapped(m,old_source)
 need(out['closureValidator']['argv'].count(old_source['path'])==1,'One exact original closure argv source')
 out['closureValidator']['argv']=[new_source['path']if x==old_source['path']else x for x in out['closureValidator']['argv']]
 out['files']+=m['addedFiles']+[a['runner'],a['resumePreparation'],a['sourceMap']]
 out['qualificationPreparation']['workerHelper']=a['resumePreparation']
 out['nativeEvidence']['source']=a['nativeEvidenceSource'];out['files'].append(a['nativeEvidenceSource'])
 out['files']+=[a['workerSource'],a['preparationCompletion'],a['closureSource'],a['retainedEvidence']]
 old_closure=out['closureValidator']['source'];out['closureValidator']['source']=a['closureSource']
 out['closureValidator']['argv']=[a['closureSource']['path']if x==old_closure['path']else x for x in out['closureValidator']['argv']]
 out.setdefault('executables',[]).append({'path':NATIVE_PYTHON,'sha256':'4dbf3143240288fb2170257ffaa7bd030cdda5d2703d1f5f30b627042267e2e3'})
 out['operationalContinuation']={'authority':ref(AUTHORITY_PATH),'originalInputSha256':INPUT,'generation':'05'}
 out.setdefault('verificationContext',{})['operationalContinuation']=ref(AUTHORITY_PATH)
 return out
def recover_metadata(a,authority_ref,generation):
 target=ROOT/'attempts'/ATTEMPT/'operational-generations/04/prepared'
 need(a.get('retainedAdmittedPreparation')is True,'Reuse exact admitted generation04 preparation')
 expected={str(Path('/srv/acephale/attempts')/ATTEMPT/'operational-generations/04/prepared'/n)for n in('manifest.json','configuration.json','guard.json','experiment.json','preparation.json')}
 need({r['path']for r in a['retainedPreparationFiles']}==expected,'Exact retained five-file preparation graph')
 for r in a['retainedPreparationFiles']:checked(r)
 need(not(target/'run').exists(),'Retained profile output remains unexecuted')
 return ref(target/'preparation.json')

def numerical_evidence_paths(context,a):
 return [Path(context['runRoot'])/'downstream'/context['occurrenceId']/'numerical-policy'/(a['operationalStageId']+'-'+kind+'.json')for kind in ('inputs','outputs')]

def preflight(a,authority_ref):
 import tempfile,subprocess
 work=ROOT/'attempts'/ATTEMPT
 original_input=json.loads((work/'execution-input.json').read_text())
 context=json.loads((work/'operational-generations/04/02-measure-and-aggregate/native-context.json').read_text())
 targets=numerical_evidence_paths(context,a)
 need(all(not os.path.lexists(p)for p in targets),'Both operational input/output evidence destinations must be unused')
 with tempfile.TemporaryDirectory(prefix='guard-projection-',dir=Path(__file__).parent)as td:
  folder=Path(td);recover_metadata(a,authority_ref,folder);prepared=work/'operational-generations/04/prepared'
  previous=json.loads((work/'operational-generations/04/02-measure-and-aggregate/owner-admission-input.json').read_text())
  value=previous['value'];value['stageId']=a['operationalStageId'];value['experimentPath']=str(prepared/'experiment.json');value['experimentSha256']=ref(prepared/'experiment.json')['sha256'];value['preparationSha256']=ref(prepared/'preparation.json')['sha256']
  checked(original_input['publicGuard']['source'])
  input_path=folder/'admission.json';write(input_path,previous)
  env={**os.environ,**original_input.get('environment',{})}
  command=[original_input['bindings']['nativePython'],'-B',original_input['publicGuard']['source']['path'],'plan','--input',str(input_path),'--output',str(folder/'plan.json')]
  result=subprocess.run(command,cwd=original_input['bindings']['scienceSourceDirectory'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=60)
  need(result.returncode==0,'Actual unchanged native_guard.validate_plan rejected recovered graph: '+result.stderr[-4000:])
  need((folder/'plan.json').is_file(),'Actual admission plan produced')
 return {'actualOriginalValidatePlanPassed':True,'profileDispatched':False,'unusedNumericalEvidencePaths':[str(p)for p in targets]}

def claim_gate(ddb,a,*,require_journal=False):
 from boto3.dynamodb.types import TypeDeserializer
 def get(k):
  r=ddb.get_item(TableName=TABLE,Key={'pk':{'S':k}},ConsistentRead=True).get('Item',{});d=TypeDeserializer();return {k:d.deserialize(v)for k,v in r.items()}
 c=get('unit#'+UNIT)
 need(c.get('status')=='running'and c.get('permanent')is True and c.get('attemptId')==ATTEMPT and c.get('inputSha256')==INPUT and c.get('leaseId')==RESOURCE and c.get('instanceId')==INSTANCE and c.get('operationalContinuation')==ref(AUTHORITY_PATH),'Exact reopened same logical assignment')
 if require_journal:
  o=get('journal#sole-owner');need(o.get('unitId')==UNIT and o.get('attemptId')==ATTEMPT and o.get('permanentUntilObservedDrain')is True,'Exact original journal owner retained')
 return c
def result_route(controller,s):
 config=controller.config.get('operationalContinuation')
 if not config or s.get('unitAttemptId')!=ATTEMPT:return None
 a=authority(config['authority'],live=False);need(config['source']==a['runner'],'Exact controller helper binding')
 claim=controller.claims.decoded('unit#'+UNIT)
 if not claim or claim.get('operationalContinuation')!=config['authority']:return None
 need(claim.get('attemptId')==ATTEMPT and claim.get('inputSha256')==INPUT and claim.get('leaseId')==RESOURCE and claim.get('instanceId')==INSTANCE,'Retained claim identity')
 worker=a['workerSource']
 return {'key':RESULT_KEY,'worker':worker,'authority':config['authority'],'generation':'05'}
def verify_result(result,route):
 need(result.get('operationalContinuation')==route['authority']and result.get('operationalExecutionGeneration')=='05' and result.get('previousFailedResultSha256')==PREVIOUS_FAILED and result.get('originalFailedResultSha256')==FAILED and result.get('originalInputSha256')==INPUT,'Explicit truthful continuation result lineage')
 need(result.get('workerSha256')==route['worker']['sha256']and result.get('continuationRunner')==ref(__file__),'Actual executing sources')
def activation_transaction(a,authority_ref):
 v={':unit':{'S':UNIT},':attempt':{'S':ATTEMPT},':input':{'S':INPUT},':lease':{'S':RESOURCE},':iid':{'S':INSTANCE},':source':{'S':SCIENCE},':failed':{'S':'failed'},':running':{'S':'running'},':yes':{'BOOL':True},':hash':{'S':PREVIOUS_FAILED},':oldkey':{'S':PREFIX+'/operational-generations/04/result.json'},':parent':{'M':{'path':{'S':PARENT_AUTHORITY['path']},'sha256':{'S':PARENT_AUTHORITY['sha256']}}},':authority':{'M':{'path':{'S':authority_ref['path']},'sha256':{'S':authority_ref['sha256']}}}}
 return [
 {'ConditionCheck':{'TableName':TABLE,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:code AND executionEnabled=:yes AND stopRequested=:no','ExpressionAttributeValues':{':code':{'S':a['controllerSource']['sha256']},':yes':{'BOOL':True},':no':{'BOOL':False}}}},
 {'Update':{'TableName':TABLE,'Key':{'pk':{'S':'unit#'+UNIT}},'ConditionExpression':'#s=:failed AND permanent=:yes AND attemptId=:attempt AND inputSha256=:input AND leaseId=:lease AND instanceId=:iid AND sourceCommit=:source AND resultSha256=:hash AND resultKey=:oldkey AND operationalContinuation=:parent','UpdateExpression':'SET #s=:running, operationalContinuation=:authority, previousFailedResultSha256=:hash, previousFailedResultKey=:oldkey','ExpressionAttributeNames':{'#s':'status'},'ExpressionAttributeValues':{k:x for k,x in v.items()if k!=':unit'}}},
 {'Put':{'TableName':TABLE,'Item':{'pk':{'S':'journal#sole-owner'},'unitId':{'S':UNIT},'attemptId':{'S':ATTEMPT},'permanentUntilObservedDrain':{'BOOL':True}},'ConditionExpression':'attribute_not_exists(pk) OR (unitId=:unit AND attemptId=:attempt AND permanentUntilObservedDrain=:yes)','ExpressionAttributeValues':{k:v[k]for k in (':unit',':attempt',':yes')}}}]
def execute(a,authority_ref,s3,ddb):
 submission,failed=original_evidence(a,s3);m=source_map(a);claim_gate(ddb,a,require_journal=True)
 work=ROOT/'attempts'/ATTEMPT;generation=work/'operational-generations/05';mkdir_generation(generation)
 original=work/'execution-input.json';need(sha(original.read_bytes())==INPUT,'Original local input unchanged')
 inp=project_input(json.loads(original.read_text()),a,m);worker_ref=a['workerSource']
 controller_files=[r for r in m['addedFiles']if Path(r['path']).name=='controller.py'];need(len(controller_files)==1,'Exact colocated worker controller import');load('controller',controller_files[0])
 worker=load('approved_native_continuation_worker',worker_ref)
 write(generation/'authority.json',a);write(generation/'effective-input.json',inp)
 recover_metadata(a,authority_ref,generation)
 write(generation/'executed.json',{'kind':'acephale-exclusive-operational-generation-v1','authority':authority_ref,'generation':'05','unitId':UNIT,'attemptId':ATTEMPT,'inputSha256':INPUT,'scientificAttemptReissued':False,'startedAt':time.time()})
 worker.install_stop_handlers()
 result={'kind':'acephale-aws-unit-worker-result-v1','unitId':UNIT,'attemptId':ATTEMPT,'inputSha256':INPUT,'originalInputSha256':INPUT,'workerSha256':worker_ref['sha256'],'originalWorkerSource':submission['workerSource'],'continuationRunner':ref(__file__),'operationalContinuation':authority_ref,'operationalExecutionGeneration':'05','previousFailedResultSha256':PREVIOUS_FAILED,'originalFailedResultSha256':FAILED,'startedAt':time.time(),'completed':False,'allChildrenDrained':False,'exitCode':None}
 try:
  bound=worker.bound_execution_input(inp,submission);provider=worker.provider_gate(bound['providerConfiguration'])
  def gate():claim_gate(ddb,a);provider()
  gate();out=worker.execute(bound,submission,work,gate,ref(original));result.update(out,completed=True,allChildrenDrained=True,exitCode=0)
 except BaseException as error:
  result.update(failureType=type(error).__name__,failure=str(error),exitCode=1)
  phases=[json.loads(p.read_text())for p in work.rglob('result.json')if p not in (work/'result.json',generation/'result.json',work/'operational-generations/01/result.json',work/'operational-generations/02/result.json',work/'operational-generations/03/result.json',work/'operational-generations/04/result.json')]
  result['allChildrenDrained']=bool(phases)and all(x.get('drained')is True for x in phases)
 finally:
  result['finishedAt']=time.time();write(generation/'result.json',result);artifacts=[]
  for path in worker.export_plan(work,inp):
   if path==generation/'result.json':continue
   r=ref(path);key=PREFIX+'/operational-generations/05/artifacts/'+path.relative_to(ROOT).as_posix();checksum=base64.b64encode(bytes.fromhex(r['sha256'])).decode()
   with path.open('rb')as stream:response=s3.put_object(Bucket=BUCKET,Key=key,Body=stream,IfNoneMatch='*',ChecksumSHA256=checksum)
   need(response.get('VersionId')not in(None,'','null'),'Versioned generation artifact')
   h=s3.head_object(Bucket=BUCKET,Key=key,VersionId=response['VersionId'],ChecksumMode='ENABLED')
   need(h['ContentLength']==path.stat().st_size and h.get('ChecksumSHA256')==checksum and h.get('ChecksumType')=='FULL_OBJECT','Full server-verified generation bytes')
   artifacts.append({**r,'key':key,'versionId':response['VersionId'],'bytes':path.stat().st_size})
  result['durableArtifacts']=artifacts
  body=raw(result);response=s3.put_object(Bucket=BUCKET,Key=RESULT_KEY,Body=body,IfNoneMatch='*',ChecksumSHA256=base64.b64encode(bytes.fromhex(sha(body))).decode())
  need(response.get('VersionId')not in(None,'','null'),'Immutable versioned generation result')
 return result
def main():
 import boto3
 p=argparse.ArgumentParser();p.add_argument('--authority',required=True);p.add_argument('--sha256',required=True);p.add_argument('--activate-claim',action='store_true');p.add_argument('--check',action='store_true');args=p.parse_args()
 need(os.geteuid()==0,'Root-approved execution only');r={'path':args.authority,'sha256':args.sha256};a=authority(r)
 s3=boto3.client('s3',region_name='us-east-1');ddb=boto3.client('dynamodb',region_name='us-east-1')
 if args.activate_claim:
  source_map(a);ddb.transact_write_items(TransactItems=activation_transaction(a,r));print(json.dumps({'sameLogicalAttemptReopened':True,'generation':'05'}));return
 if args.check:
  original_evidence(a,s3);source_map(a);proof=preflight(a,r);print(json.dumps({'preScienceEvidenceVerified':True,'scientificExecutionPerformed':False,**proof}));return
 result=execute(a,r,s3,ddb);print(json.dumps({'completed':result['completed'],'resultKey':RESULT_KEY,'generation':'05'}))
if __name__=='__main__':main()
