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
RESULT_KEY=PREFIX+'/operational-generations/01/result.json'
AUTHORITY_PATH=ROOT/'artifacts/seed17-opportunity-continuation-01.json'
MAP={'path':'/srv/acephale/workspaces/operator/regional-numerical-inputs-01/source-map.json','sha256':'699c5719951e580ee4b4372195e4a4e0f7f427a49a10b859c8e5c91e2027086e'}
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
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
 p=checked(r);need(p==AUTHORITY_PATH,'Exact first-generation root authority path')
 st=p.stat();need(st.st_uid==0 and st.st_mode&0o022==0,'Protected root-owned authority')
 a=json.loads(p.read_text());now=time.time()if now is None else now
 need(a.get('kind')=='acephale-aws-pre-science-operational-continuation-v1'and a.get('approved')is True and a.get('authorityStatus')=='active','Explicit active root approval')
 need(a.get('unitId')==UNIT and a.get('unitAttemptId')==ATTEMPT and a.get('resourceAttemptId')==RESOURCE and a.get('instanceId')==INSTANCE and a.get('generation')=='01','Only exact retained first generation')
 need(a.get('inputSha256')==INPUT and a.get('sourceCommit')==SCIENCE and a.get('workerRegion')=='us-east-2'and a.get('accountId')=='971290362335','Original assignment and authority endpoint')
 need(type(a.get('issuedAt'))in(int,float)and math.isfinite(a['issuedAt'])and a['issuedAt']<=now and (not live or now<a['hardDeadline']) and a['hardDeadline']==1795336350,'Original finite hard deadline unchanged')
 for k in ('scientificAttemptReissued','scientificSettingsChanged','qualificationRepeated','checkpointRepeated','scientificMeasurementPreviouslyDispatched','originalFailureReclaimed'):
  need(a.get(k)is False,'Explicit false '+k)
 need(a['resultKey']==RESULT_KEY and a['failedResult']['key']==PREFIX+'/result.json'and a['failedResult']['sha256']==FAILED,'Retained failed result and fresh generation result')
 for k in ('runner','resumePreparation','controllerSource'):checked(a[k])
 need(a['runner']==ref(__file__),'Exact actual continuation runner')
 return a
def s3_json(s3,r):
 response=s3.get_object(Bucket=BUCKET,Key=r['key'],**({'VersionId':r['versionId']}if r.get('versionId')else {}))
 with response['Body']as b:data=b.read(64*1024*1024+1)
 need(len(data)<=64*1024*1024 and sha(data)==r['sha256']and response.get('VersionId')not in(None,'','null'),'Exact versioned bounded original bytes')
 return json.loads(data)
def original_evidence(a,s3):
 failed=s3_json(s3,a['failedResult']);submission=s3_json(s3,a['submission'])
 need(submission['unitId']==UNIT and submission['unitAttemptId']==ATTEMPT and submission['resourceAttemptId']==RESOURCE and submission['instanceId']==INSTANCE and submission['inputSha256']==INPUT and submission['hardDeadline']==a['hardDeadline'],'Original immutable submission')
 need(failed['unitId']==UNIT and failed['attemptId']==ATTEMPT and failed['inputSha256']==INPUT and failed['workerSha256']==submission['workerSource']['sha256'],'Exact original failed worker')
 need(failed['completed']is False and failed['allChildrenDrained']is True and type(failed['exitCode'])is int and failed['exitCode']==1 and failed['failureType']=='ValueError','Only drained failed operational preparation')
 work=ROOT/'attempts'/ATTEMPT;phase=work/'00-current-qualified-inputs'
 artifacts={r['path']:r for r in failed['durableArtifacts']};need(len(artifacts)==len(failed['durableArtifacts']),'Unique original artifact inventory')
 phases=[r for r in artifacts if r.startswith(str(work)+'/')and r.endswith('/dispatch.json')]
 need(set(phases)=={str(phase/'checkpoint-process/dispatch.json'),str(phase/'qualified-process/dispatch.json')},'No original scientific step dispatched')
 for key in ('checkpoint','checkpointResult','checkpointDispatch','context','qualifiedConfiguration','failedProcess','failedStderr'):
  r=a[key];need(artifacts.get(r['path'],{}).get('sha256')==r['sha256'],'Exact exported original '+key);checked(r)
 cr=read(a['checkpointResult']);fr=read(a['failedProcess'])
 for r in (cr,fr):
  need(r['unitId']==UNIT and r['attemptId']==ATTEMPT and r['inputSha256']==INPUT and r['leaseId']==RESOURCE and r['instanceId']==INSTANCE and r['drained']is True and r['localOwnedProcessesDrained']is True and r['providerWatcherDrained']is True,'Exact original child ownership/drain')
 need(cr['completed']is True and type(cr['exitCode'])is int and cr['exitCode']==0,'Original successful checkpoint reused')
 need(fr['completed']is False and type(fr['exitCode'])is int and fr['exitCode']==1,'Only original qualified producer failed')
 need('current AWS association identity' in checked(a['failedStderr']).read_text(),'Exact proven regional identity failure')
 need(a['checkpoint']['path']==str(ROOT/'runs'/ATTEMPT/'downstream/checkpoints/qualified-seed17-01.json'),'Original checkpoint path')
 need(not any((work/x).exists()for x in ('01-prepare','02-measure-and-aggregate','calibration-adoption','provider-configuration.json')),'No original opportunity/adoption execution')
 need(not (ROOT/'runs'/ATTEMPT/'downstream/seed17-01/qualified').exists(),'Original failed producer created no qualified output')
 need(not any((ROOT/'runs'/ATTEMPT).rglob('prefix-*.json')),'No measured-prefix dispatch')
 need(not os.path.lexists(ROOT/'shared/budget.jsonl.lock'),'Original writer actually closed')
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
 out['operationalContinuation']={'authority':ref(AUTHORITY_PATH),'originalInputSha256':INPUT,'generation':'01'}
 out.setdefault('verificationContext',{})['operationalContinuation']=ref(AUTHORITY_PATH)
 return out
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
 m=read(a['sourceMap']);worker=mapped(m,s['workerSource'])
 return {'key':RESULT_KEY,'worker':worker,'authority':config['authority'],'generation':'01'}
def verify_result(result,route):
 need(result.get('operationalContinuation')==route['authority']and result.get('operationalExecutionGeneration')=='01'and result.get('originalFailedResultSha256')==FAILED and result.get('originalInputSha256')==INPUT,'Explicit truthful continuation result lineage')
 need(result.get('workerSha256')==route['worker']['sha256']and result.get('continuationRunner')==ref(__file__),'Actual executing sources')
def activation_transaction(a,authority_ref):
 v={':unit':{'S':UNIT},':attempt':{'S':ATTEMPT},':input':{'S':INPUT},':lease':{'S':RESOURCE},':iid':{'S':INSTANCE},':source':{'S':SCIENCE},':failed':{'S':'failed'},':running':{'S':'running'},':yes':{'BOOL':True},':hash':{'S':FAILED},':oldkey':{'S':PREFIX+'/result.json'},':authority':{'M':{'path':{'S':authority_ref['path']},'sha256':{'S':authority_ref['sha256']}}}}
 return [
 {'ConditionCheck':{'TableName':TABLE,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:code AND executionEnabled=:yes AND stopRequested=:no','ExpressionAttributeValues':{':code':{'S':a['controllerSource']['sha256']},':yes':{'BOOL':True},':no':{'BOOL':False}}}},
 {'Update':{'TableName':TABLE,'Key':{'pk':{'S':'unit#'+UNIT}},'ConditionExpression':'#s=:failed AND permanent=:yes AND attemptId=:attempt AND inputSha256=:input AND leaseId=:lease AND instanceId=:iid AND sourceCommit=:source AND resultSha256=:hash AND resultKey=:oldkey AND attribute_not_exists(operationalContinuation)','UpdateExpression':'SET #s=:running, operationalContinuation=:authority, originalFailedResultSha256=:hash, originalFailedResultKey=:oldkey','ExpressionAttributeNames':{'#s':'status'},'ExpressionAttributeValues':{k:x for k,x in v.items()if k!=':unit'}}},
 {'Put':{'TableName':TABLE,'Item':{'pk':{'S':'journal#sole-owner'},'unitId':{'S':UNIT},'attemptId':{'S':ATTEMPT},'permanentUntilObservedDrain':{'BOOL':True}},'ConditionExpression':'attribute_not_exists(pk) OR (unitId=:unit AND attemptId=:attempt AND permanentUntilObservedDrain=:yes)','ExpressionAttributeValues':{k:v[k]for k in (':unit',':attempt',':yes')}}}]
def execute(a,authority_ref,s3,ddb):
 submission,failed=original_evidence(a,s3);m=source_map(a);claim_gate(ddb,a,require_journal=True)
 work=ROOT/'attempts'/ATTEMPT;generation=work/'operational-generations/01';mkdir_generation(generation)
 original=work/'execution-input.json';need(sha(original.read_bytes())==INPUT,'Original local input unchanged')
 inp=project_input(json.loads(original.read_text()),a,m);worker_ref=mapped(m,submission['workerSource'])
 controller_files=[r for r in m['addedFiles']if Path(r['path']).name=='controller.py'];need(len(controller_files)==1,'Exact colocated worker controller import');load('controller',controller_files[0])
 worker=load('approved_native_continuation_worker',worker_ref)
 write(generation/'authority.json',a);write(generation/'effective-input.json',inp)
 write(generation/'executed.json',{'kind':'acephale-exclusive-operational-generation-v1','authority':authority_ref,'generation':'01','unitId':UNIT,'attemptId':ATTEMPT,'inputSha256':INPUT,'scientificAttemptReissued':False,'startedAt':time.time()})
 worker.install_stop_handlers()
 result={'kind':'acephale-aws-unit-worker-result-v1','unitId':UNIT,'attemptId':ATTEMPT,'inputSha256':INPUT,'originalInputSha256':INPUT,'workerSha256':worker_ref['sha256'],'originalWorkerSource':submission['workerSource'],'continuationRunner':ref(__file__),'operationalContinuation':authority_ref,'operationalExecutionGeneration':'01','originalFailedResultSha256':FAILED,'startedAt':time.time(),'completed':False,'allChildrenDrained':False,'exitCode':None}
 try:
  bound=worker.bound_execution_input(inp,submission);provider=worker.provider_gate(bound['providerConfiguration'])
  def gate():claim_gate(ddb,a);provider()
  gate();out=worker.execute(bound,submission,work,gate,ref(original));result.update(out,completed=True,allChildrenDrained=True,exitCode=0)
 except BaseException as error:
  result.update(failureType=type(error).__name__,failure=str(error),exitCode=1)
  phases=[json.loads(p.read_text())for p in work.rglob('result.json')if p!=work/'result.json'and p!=generation/'result.json']
  result['allChildrenDrained']=bool(phases)and all(x.get('drained')is True for x in phases)
 finally:
  result['finishedAt']=time.time();write(generation/'result.json',result);artifacts=[]
  for path in worker.export_plan(work,inp):
   if path==generation/'result.json':continue
   r=ref(path);key=PREFIX+'/operational-generations/01/artifacts/'+path.relative_to(ROOT).as_posix();checksum=base64.b64encode(bytes.fromhex(r['sha256'])).decode()
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
  source_map(a);ddb.transact_write_items(TransactItems=activation_transaction(a,r));print(json.dumps({'sameLogicalAttemptReopened':True,'generation':'01'}));return
 if args.check:
  original_evidence(a,s3);source_map(a);print(json.dumps({'preScienceEvidenceVerified':True,'scientificExecutionPerformed':False}));return
 result=execute(a,r,s3,ddb);print(json.dumps({'completed':result['completed'],'resultKey':RESULT_KEY,'generation':'01'}))
if __name__=='__main__':main()
