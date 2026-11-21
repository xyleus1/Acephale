# Durable operational control; original science commands remain external and pinned.
from __future__ import annotations
import argparse,base64,hashlib,json,math,os,re,shlex,time,subprocess
from pathlib import Path
SCIENCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
UNITS=('export','seed17/replay','seed17/analysis','seed17/opportunity','seed29/replay','seed29/analysis','seed29/opportunity','development/1','development/2','heldout/1','heldout/2','heldout/selection')
CLOSED=('export','seed17/replay','seed17/analysis')
ACCOUNT='971290362335'
DEPENDENCIES={'seed29/replay': ['export'], 'seed29/analysis': ['seed29/replay'], 'seed17/opportunity': ['seed17/analysis'], 'seed29/opportunity': ['seed29/analysis'], 'development/1': ['seed29/analysis', 'seed29/opportunity'], 'development/2': ['development/1', 'seed17/analysis', 'seed17/opportunity'], 'heldout/selection': ['development/1', 'development/2'], 'heldout/1': ['heldout/selection', 'seed17/analysis', 'seed17/opportunity'], 'heldout/2': ['heldout/1', 'heldout/selection', 'seed29/analysis', 'seed29/opportunity']}
def need(ok,msg):
 if not ok:raise ValueError(msg)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(value):return hashlib.sha256(canonical(value)).hexdigest()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def finite(v):return type(v) in (int,float) and math.isfinite(v)
def exact_ref(value):
 need(type(value) is dict and set(value)=={'path','sha256'} and type(value['path']) is str and re.fullmatch('[a-f0-9]{64}',value['sha256']),'Exact source FileRef required');return value
class Store:
 def __init__(self,s3,bucket):self.s3,self.bucket=s3,bucket
 def get(self,key,expected=None):
  need(type(key) is str and not key.startswith('/') and '..' not in key.split('/'),'Safe S3 key required')
  r=self.s3.get_object(Bucket=self.bucket,Key=key)
  with r['Body'] as stream:raw=stream.read(64*1024*1024+1)
  need(len(raw)<=64*1024*1024 and r.get('VersionId') not in (None,'','null'),'Bounded versioned controller metadata')
  if expected:need(sha(raw)==expected,'S3 bytes changed')
  return json.loads(raw),{'key':key,'sha256':sha(raw),'versionId':r.get('VersionId')}
 def put(self,key,value):
  raw=canonical(value)
  try:r=self.s3.put_object(Bucket=self.bucket,Key=key,Body=raw,ContentType='application/json',IfNoneMatch='*')
  except Exception as e:
   if getattr(e,'response',{}).get('Error',{}).get('Code') not in ('PreconditionFailed','412'):raise
   old,ref=self.get(key,sha(raw));return ref
  need(r.get('VersionId') not in (None,'','null'),'Versioned immutable publication required')
  return {'key':key,'sha256':sha(raw),'versionId':r.get('VersionId')}
class Claims:
 def __init__(self,ddb,table):
  need(table.startswith('acephale-aws-20261121'),'Root study claim table required');self.ddb,self.table=ddb,table
 def item(self,key):return self.ddb.get_item(TableName=self.table,Key={'pk':{'S':key}},ConsistentRead=True).get('Item')
 def decoded(self,key):
  from boto3.dynamodb.types import TypeDeserializer
  item=self.item(key)
  def normalized(value):
   from decimal import Decimal
   if isinstance(value,Decimal):
    need(value.is_finite() and value==int(value),'Exact finite integer control metadata');return int(value)
   if isinstance(value,dict):return {k:normalized(v) for k,v in value.items()}
   if isinstance(value,list):return [normalized(v) for v in value]
   return value
  return None if item is None else normalized({k:TypeDeserializer().deserialize(v) for k,v in item.items()})
 def ready(self,dependencies):
  for unit in dependencies:
   need(unit in UNITS,'Foreign dependency')
   row=self.decoded('unit#'+unit)
   if not row or row.get('status')!='succeeded':return False
   need(row.get('pk')=='unit#'+unit and row.get('sourceCommit')==SCIENCE and row.get('permanent') is True and isinstance(row.get('attemptId'),str) and bool(row['attemptId']),'Exact immutable completed dependency')
  return True
 def claim(self,spec):
  unit=spec['unitId'];attempt=spec['unitAttemptId'];need(unit in UNITS and unit not in CLOSED,'Remaining original unit required')
  need(re.fullmatch('[a-zA-Z0-9_-]{8,128}',attempt) and self.ready(spec['dependencies']),'Immutable attempt and completed dependencies required')
  vals={':queued':{'S':'queued'},':claimed':{'S':'claimed'},':attempt':{'S':attempt},':source':{'S':SCIENCE},':input':{'S':spec['inputSha256']},':association':{'S':spec['associationSha256']},':qualification':{'S':spec['qualificationSha256']},':instance':{'S':spec['instanceId']},':lease':{'S':spec['resourceAttemptId']},':true':{'BOOL':True},':false':{'BOOL':False}}
  for name in ['inputSha256','associationSha256','qualificationSha256']:need(re.fullmatch('[a-f0-9]{64}',spec[name]),'Exact claim hashes required')
  update={'TableName':self.table,'Key':{'pk':{'S':'unit#'+unit}},'ConditionExpression':'attribute_not_exists(pk) OR (#s=:queued AND sourceCommit=:source AND attribute_not_exists(attemptId) AND (attribute_not_exists(permanent) OR permanent=:false))','UpdateExpression':'SET #s=:claimed, attemptId=:attempt, sourceCommit=:source, inputSha256=:input, associationSha256=:association, qualificationSha256=:qualification, instanceId=:instance, leaseId=:lease, permanent=:true','ExpressionAttributeNames':{'#s':'status'},'ExpressionAttributeValues':vals}
  need(re.fullmatch('[a-f0-9]{64}',spec['capacityConfigSha256']),'Exact capacity configuration hash')
  resource={'TableName':self.table,'Key':{'pk':{'S':'resource#'+spec['resourceAttemptId']}},'ConditionExpression':'(attribute_not_exists(retirementAuthorized) OR retirementAuthorized=:false) AND (#s=:active OR #s=:qualified) AND configSha256=:cfg AND evidence.instanceId=:instance','ExpressionAttributeNames':{'#s':'status'},'ExpressionAttributeValues':{':false':{'BOOL':False},':active':{'S':'instance-running'},':qualified':{'S':'qualified-running'},':cfg':{'S':spec['capacityConfigSha256']},':instance':{'S':spec['instanceId']}}}
  authority={'TableName':self.table,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'#k=:kind AND controllerInstanceId=:controller AND sourceCommit=:source AND controllerSourceSha256=:code AND executionEnabled=:true AND stopRequested=:false AND hardDeadline>:now','ExpressionAttributeNames':{'#k':'kind'},'ExpressionAttributeValues':{':kind':{'S':'acephale-aws-continuation-coordinator-v1'},':controller':{'S':'i-044c091a163a723bc'},':source':{'S':SCIENCE},':code':{'S':sha(Path(__file__).read_bytes())},':true':{'BOOL':True},':false':{'BOOL':False},':now':{'N':str(int(time.time()))}}}
  writes=[{'ConditionCheck':resource},{'ConditionCheck':authority},{'Update':update}]
  if spec.get('journalOwnerRequired'):
   writes.append({'Put':{'TableName':self.table,'Item':{'pk':{'S':'journal#sole-owner'},'unitId':{'S':unit},'attemptId':{'S':attempt},'permanentUntilObservedDrain':{'BOOL':True}},'ConditionExpression':'attribute_not_exists(pk)'}})
  self.ddb.transact_write_items(TransactItems=writes)
  return self.item('unit#'+unit)
 def transition(self,unit,attempt,prior,status,extra=None):
  need(prior in ('claimed','running') and status in ('running','succeeded','failed','unknown'),'No retry or terminal-state transition allowed')
  vals={':prior':{'S':prior},':next':{'S':status},':a':{'S':attempt}};expr='SET #s=:next'
  for i,(k,v) in enumerate((extra or {}).items()):
   need(k in ('commandId','resultKey','resultSha256'),'Restricted transition evidence')
   vals[':x'+str(i)]={'S':v};expr+=', '+k+'=:x'+str(i)
  self.ddb.update_item(TableName=self.table,Key={'pk':{'S':'unit#'+unit}},ConditionExpression='#s=:prior AND attemptId=:a',UpdateExpression=expr,ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues=vals)
 def journal(self,unit,attempt,acquire):
  key={'pk':{'S':'journal#sole-owner'}}
  if acquire:self.ddb.put_item(TableName=self.table,Item={**key,'unitId':{'S':unit},'attemptId':{'S':attempt},'permanentUntilObservedDrain':{'BOOL':True}},ConditionExpression='attribute_not_exists(pk)')
  else:self.ddb.delete_item(TableName=self.table,Key=key,ConditionExpression='unitId=:u AND attemptId=:a',ExpressionAttributeValues={':u':{'S':unit},':a':{'S':attempt}})
def qualification_handoff(proposal,claim,*,now):
 # Root-owned controller publishes this only from original actual qualification outputs.
 need(proposal.get('kind')=='acephale-aws-dual-model-qualification-proposal-v1' and proposal.get('qualificationSucceeded') is True and proposal.get('originalDualModelSettingsUnchanged') is True,'Actual unchanged dual-model qualification required')
 need(proposal.get('sourceCommit')==SCIENCE and proposal.get('account')==ACCOUNT and proposal.get('controllerInstanceId')=='i-044c091a163a723bc','Root deployment identity differs')
 need(finite(now) and finite(proposal.get('qualifiedAt')) and finite(proposal.get('bootstrapDeadlineEpoch')) and finite(proposal.get('hardStopEpoch')) and proposal['qualifiedAt']<=now<proposal['bootstrapDeadlineEpoch']<proposal['hardStopEpoch'],'Qualification handoff must fit original finite bootstrap')
 need(proposal.get('vllmImageDigest')=='vllm/vllm-openai:v0.32.0@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34','Original model runtime image required')
 for k in ['originalQualification','originalQualificationProcess','association','bootstrapSource']:exact_ref(proposal[k])
 need(proposal.get('originalExitCode')==0 and type(proposal.get('originalExitCode')) is int and proposal.get('originalDrained') is True,'Observed original successful process drain required')
 from boto3.dynamodb.types import TypeDeserializer
 item={k:TypeDeserializer().deserialize(v) for k,v in claim.items()}
 need(item.get('pk')=='unit#'+proposal['unitId'] and item.get('attemptId')==proposal['unitAttemptId'] and item.get('leaseId')==proposal['resourceAttemptId'] and item.get('instanceId')==proposal['instanceId'] and item.get('sourceCommit')==SCIENCE and item.get('status') in ('claimed','running') and item.get('permanent') is True and item.get('associationSha256')==proposal['association']['sha256'] and item.get('qualificationSha256')==proposal['originalQualification']['sha256'],'Qualification must bind same permanent scientific claim and distinct resource lease')
 return {'kind':'acephale-aws-qualified-capacity-v1',**{k:proposal[k] for k in ('account','region','instanceId','resourceAttemptId','unitAttemptId','configSha256','sourceCommit','vllmImageDigest','controllerInstanceId','hardStopEpoch','qualifiedAt')},'vllmImageDigest':proposal['vllmImageDigest'].split('@',1)[1],'originalVllmImage':proposal['vllmImageDigest'],'originalDualModelSettingsUnchanged':True,'qualificationSucceeded':True,'claimKey':item['pk'],'claimSha256':digest(claim),'associationSha256':item['associationSha256'],'qualificationSha256':item['qualificationSha256'],'evidence':{k:proposal[k] for k in ('originalQualification','originalQualificationProcess','association','bootstrapSource')}}
def validate_submission(s):
 need(s.get('kind')=='acephale-aws-unit-submission-v1' and s.get('unitId') in UNITS and s['unitId'] not in CLOSED,'Exact remaining original unit required')
 need(type(s.get('journalOwnerRequired')) is bool and s.get('dependencies')==DEPENDENCIES[s['unitId']],'Exact original ownership/dependencies required')
 need(s.get('sourceCommit')==SCIENCE and s.get('automaticRetry') is False and finite(s.get('hardDeadline')),'Frozen science and finite single attempt required')
 need(type(s.get('executionInput')) is dict and set(s['executionInput'])=={'key','sha256'} and s['executionInput']['sha256']==s['inputSha256'],'Exact immutable execution input required')
 for k in ['workerSource','workerEnvironment']:exact_ref(s[k])
 need(re.fullmatch('i-[0-9a-f]{8,17}',s['instanceId']) is not None,'Exact assigned EC2 worker required')
 return s

def capacity_decision(states):
 """Pure gate: permanent failed/unknown required work cannot be replaced by a new GPU."""
 need(type(states) is dict and set(states)==set(UNITS),'Exact canonical study state set')
 statuses={}
 for unit,row in states.items():
  if row is None:statuses[unit]='absent';continue
  need(type(row) is dict and row.get('pk')=='unit#'+unit and row.get('sourceCommit')==SCIENCE,'Canonical unit state identity')
  status=row.get('status');need(status in ('queued','claimed','running','succeeded','failed','unknown'),'Known permanent unit status')
  if status!='queued':need(row.get('permanent') is True and type(row.get('attemptId')) is str,'Permanent attempted unit')
  statuses[unit]=status
 fatal=[u for u in UNITS if statuses[u] in ('failed','unknown')]
 if fatal:return {'stop':True,'reason':'permanent-required-unit-failure','units':fatal,'studyComplete':False}
 if all(statuses[u]=='succeeded' for u in UNITS):return {'stop':True,'reason':'all-canonical-units-closed-awaiting-final-report','units':list(UNITS),'studyComplete':False}
 if any(statuses[u] in ('claimed','running') for u in UNITS):return {'stop':False,'reason':'owned-work-active','units':[],'studyComplete':False}
 pending=[u for u in DEPENDENCIES if statuses[u] in ('absent','queued')]
 runnable=[u for u in pending if all(statuses[d]=='succeeded' for d in DEPENDENCIES[u])]
 if runnable:return {'stop':False,'reason':'unattempted-runnable-work','units':runnable,'studyComplete':False}
 return {'stop':True,'reason':'no-admissible-canonical-work','units':pending,'studyComplete':False}

class Controller:
 def __init__(self,config,clients):
  self.config=config;self.store=Store(clients['s3'],config['bucket']);self.claims=Claims(clients['dynamodb'],config['claimTable']);self.ssm=clients['ssm']
 def capacity_gate(self):
  states={u:self.claims.decoded('unit#'+u) for u in UNITS}
  decision=capacity_decision(states)
  if decision['stop']:
   # Stop future reservations only. Existing owned work retains its original drain policy.
   cfg=self.config
   self.claims.ddb.update_item(TableName=self.claims.table,Key={'pk':{'S':'coordinator#capacity-v1'}},
    ConditionExpression='#k=:kind AND sourceCommit=:source AND hardDeadline=:deadline AND capacityConfigSha256=:cfg AND studyComplete=:false',
    UpdateExpression='SET capacityEnabled=:false, stopRequested=:true, stopReason=:reason',
    ExpressionAttributeNames={'#k':'kind'},ExpressionAttributeValues={
     ':kind':{'S':'acephale-aws-capacity-coordinator-v1'},':source':{'S':SCIENCE},':deadline':{'N':str(cfg['hardDeadline'])},
     ':cfg':{'S':cfg['capacityConfigurationSha256']},':false':{'BOOL':False},':true':{'BOOL':True},':reason':{'S':decision['reason']}})
  return decision
 def handoff_observed(self,s):
  resource=self.claims.decoded('resource#'+s['resourceAttemptId'])
  if not resource or resource.get('status')!='qualified-running':return False
  evidence=resource.get('evidence',{})
  marker,mref=self.store.get('state/capacity-qualifications/'+s['resourceAttemptId']+'.json')
  need(resource.get('configSha256')==s['capacityConfigSha256'] and resource.get('retirementAuthorized')is not True,'Same retained qualified resource')
  need(evidence.get('bootstrapDisarmed')is True and evidence.get('instanceId')==s['instanceId'] and evidence.get('hardStopEpoch')==s['hardDeadline'],'Actual unchanged hard cutoff and bootstrap disarm')
  need(evidence.get('rootReceiptKey')==mref['key'] and evidence.get('rootReceiptSha256')==mref['sha256'] and evidence.get('rootReceiptVersionId')==mref['versionId'],'Exact observed protected handoff version')
  need(evidence.get('claimKey')=='unit#'+s['unitId'] and evidence.get('claimSha256')==marker['claimSha256'],'Capacity observed exact previously published claim snapshot')
  return True
 def ensure_dispatch(self,s):
  state=self.claims.decoded('unit#'+s['unitId'])
  need(state and state.get('attemptId')==s['unitAttemptId']and state.get('status')in('claimed','running'),'Adopt only the same active permanent attempt')
  if state['status']=='claimed':
   if not self.handoff_observed(s):
    # Wake only the existing root-owned singleton service, never a second capacity process.
    subprocess.run(['systemctl','start','--no-block','acephale-capacity.service'],check=True,capture_output=True,text=True)
    return {'awaitingObservedBootstrapDisarm':True,'unitId':s['unitId']}
   self.claims.transition(s['unitId'],s['unitAttemptId'],'claimed','running')
   state=self.claims.decoded('unit#'+s['unitId'])
  command_id=state.get('commandId')
  if command_id:
   try:observed=self.ssm.get_command_invocation(CommandId=command_id,InstanceId=s['instanceId'])
   except Exception as e:
    if getattr(e,'response',{}).get('Error',{}).get('Code')=='InvocationDoesNotExist':return {'pendingDispatchObservation':True}
    raise
   status=observed.get('Status')
   if status in ('Pending','InProgress','Delayed'):return {'pendingDispatchObservation':True}
   if status=='Success' and observed.get('ResponseCode')==0:
    out=json.loads(observed['StandardOutputContent'])
    need(out.get('kind')=='acephale-aws-attempt-dispatch-admission-v1'and out.get('unitAttemptId')==s['unitAttemptId']and out.get('scientificAttemptReissued')is False,'Exact same-attempt launch observation')
    if out.get('action')=='retain-executed-terminal':
     # collect already found no final durable result. Never replay executed science.
     self.claims.transition(s['unitId'],s['unitAttemptId'],'running','unknown')
     return {'retainedUnknownTerminal':True,'unitId':s['unitId']}
    need(out.get('action')in('launch','adopt-active'),'Known idempotent admission outcome')
    if time.time()-out['observedAt']<60:return {'ownedWorkerPending':True}
   elif status in ('Failed','Cancelled','TimedOut','Cancelling'):
    # Repeating only guarded admission is safe; exclusive execution marker forbids science repetition.
    pass
   else:return {'pendingDispatchObservation':True}
  launcher=exact_ref(self.config['dispatchSource']);need(sha(Path(launcher['path']).read_bytes())==launcher['sha256'],'Exact reviewed same-attempt launcher')
  key='state/unit-dispatch/'+s['unitAttemptId']+'.json';value,iref=self.store.get(key)
  need(value['unitId']==s['unitId']and value['unitAttemptId']==s['unitAttemptId']and value['inputSha256']==s['inputSha256'],'Exact durable same-attempt dispatch intent')
  argv=[self.config['workerPython'],'-B',launcher['path'],'admit','--intent-key',key,'--sha256',iref['sha256'],'--bucket',self.config['bucket']]
  check='test "$(sha256sum '+shlex.quote(launcher['path'])+' | cut -d " " -f1)" = '+shlex.quote(launcher['sha256'])
  correlation='acephale-'+sha(s['unitAttemptId'].encode())
  response=self.ssm.send_command(InstanceIds=[s['instanceId']],DocumentName='AWS-RunShellScript',Comment=correlation,Parameters={'commands':[check+' && '+shlex.join(argv)],'executionTimeout':['60']},TimeoutSeconds=90)
  command_id=response['Command']['CommandId']
  self.claims.transition(s['unitId'],s['unitAttemptId'],'running','running',{'commandId':command_id})
  self.store.put('state/unit-dispatch-receipts/'+s['unitAttemptId']+'/'+command_id+'.json',{'kind':'acephale-aws-attempt-dispatch-request-v1','unitId':s['unitId'],'unitAttemptId':s['unitAttemptId'],'intent':iref,'comment':correlation,'commandId':command_id,'scientificAttemptReissued':False})
  return {'dispatchAdmissionRequested':True,'unitId':s['unitId'],'attemptId':s['unitAttemptId'],'commandId':command_id}
 def dispatch(self,submission_key,expected_sha):
  s,_=self.store.get(submission_key,expected_sha);validate_submission(s)
  need(time.time()<s['hardDeadline'],'Execution deadline expired')
  if not self.claims.ready(s['dependencies']):return {'blocked':'dependencies','unitId':s['unitId']}
  state=self.claims.decoded('unit#'+s['unitId'])
  if state and state.get('status')not in('queued','claimed','running'):return {'retainedState':state['status'],'unitId':s['unitId']}
  if state and state.get('status')in('claimed','running'):
   need(state.get('attemptId')==s['unitAttemptId']and state.get('inputSha256')==s['inputSha256'],'Never replace a permanent scientific attempt')
   if state['status']=='running':return self.ensure_dispatch(s)
  inp,_=self.store.get(s['executionInput']['key'],s['inputSha256']);need(inp.get('unitId')==s['unitId'],'Execution input unit mismatch')
  proposal,_=self.store.get(s['qualificationProposal']['key'],s['qualificationProposal']['sha256'])
  need(proposal['configSha256']==s['capacityConfigSha256'],'Capacity configuration differs')
  need(proposal['unitId']==s['unitId']and proposal['unitAttemptId']==s['unitAttemptId']and proposal['resourceAttemptId']==s['resourceAttemptId'],'Qualification proposal attempt mismatch')
  anticipated={'pk':{'S':'unit#'+s['unitId']},'attemptId':{'S':s['unitAttemptId']},'leaseId':{'S':s['resourceAttemptId']},'instanceId':{'S':s['instanceId']},'sourceCommit':{'S':SCIENCE},'status':{'S':'claimed'},'permanent':{'BOOL':True},'associationSha256':{'S':s['associationSha256']},'qualificationSha256':{'S':s['qualificationSha256']}}
  qualification_handoff(proposal,anticipated,now=time.time())
  argv=[self.config['workerPython'],'-B',s['workerSource']['path'],'--submission-key',submission_key,'--submission-sha256',expected_sha,'--bucket',self.config['bucket'],'--claim-table',self.config['claimTable'],'--region',self.config['region']]
  intent={'kind':'acephale-aws-unit-dispatch-intent-v1','unitId':s['unitId'],'unitAttemptId':s['unitAttemptId'],'resourceAttemptId':s['resourceAttemptId'],'instanceId':s['instanceId'],'sourceCommit':SCIENCE,'inputSha256':s['inputSha256'],'hardDeadline':s['hardDeadline'],'workerSource':s['workerSource'],'submission':{'key':submission_key,'sha256':expected_sha},'argv':argv}
  self.store.put('state/unit-dispatch/'+s['unitAttemptId']+'.json',intent)
  claim=self.claims.item('unit#'+s['unitId'])if state and state.get('status')=='claimed'else self.claims.claim(s)
  marker=qualification_handoff(proposal,claim,now=time.time());self.store.put('state/capacity-qualifications/'+s['resourceAttemptId']+'.json',marker)
  return self.ensure_dispatch(s)
 def collect(self,s):
  key='results/'+s['unitId'].replace('/','-')+'/'+s['unitAttemptId']+'/result.json'
  try:r,ref=self.store.get(key)
  except Exception as e:
   if getattr(e,'response',{}).get('Error',{}).get('Code') in ('NoSuchKey','404'):return self.ensure_dispatch(s)
   raise
  need(r.get('unitId')==s['unitId'] and r.get('attemptId')==s['unitAttemptId'] and r.get('inputSha256')==s['inputSha256'] and r.get('workerSha256')==s['workerSource']['sha256'],'Owned worker result mismatch')
  success=r.get('completed') is True and r.get('allChildrenDrained') is True and r.get('exitCode')==0
  state='succeeded' if success else ('failed' if r.get('allChildrenDrained') is True else 'unknown')
  self.claims.transition(s['unitId'],s['unitAttemptId'],'running',state,{'resultKey':key,'resultSha256':ref['sha256']})
  if success and s['journalOwnerRequired']:self.claims.journal(s['unitId'],s['unitAttemptId'],False)
  return {'unitId':s['unitId'],'state':state,'result':ref}
def main():
 import boto3
 p=argparse.ArgumentParser();p.add_argument('--configuration',required=True);p.add_argument('--sha256',required=True);p.add_argument('--once',action='store_true');a=p.parse_args()
 raw=Path(a.configuration).read_bytes();need(sha(raw)==a.sha256,'Controller configuration changed');cfg=json.loads(raw)
 need(cfg.get('kind')=='acephale-aws-continuation-controller-v1' and cfg.get('region')=='us-east-1','Exact root controller configuration required')
 import fcntl
 lock_path=Path(cfg['lockPath']);need(lock_path.parent==Path('/srv/acephale/state') and not lock_path.is_symlink(),'Exact controller lock location')
 lock_stream=lock_path.open('a');fcntl.flock(lock_stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
 clients={n:boto3.client(n,region_name=cfg['region']) for n in ('s3','dynamodb','ssm')};ctl=Controller(cfg,clients)
 while True:
  decision=ctl.capacity_gate()
  print(json.dumps({'capacityDecision':decision}),flush=True)
  submissions=list(cfg['submissions'])
  if cfg.get('qualificationReconciler'):
   import importlib.util
   rr=cfg['qualificationReconciler'];path=Path(rr['source']['path']);need(sha(path.read_bytes())==rr['source']['sha256'],'Exact qualification reconciler')
   spec=importlib.util.spec_from_file_location('root_qualified_reconciler',path);reconciler=importlib.util.module_from_spec(spec);spec.loader.exec_module(reconciler)
   prepared=reconciler.replay_submission(ctl,rr,now=time.time(),allow_prepare=not decision['stop'])
   if prepared and prepared not in submissions:submissions.append(prepared)
  for row in submissions:
   try:
    s,_=ctl.store.get(row['key'],row['sha256']);state=ctl.claims.decoded('unit#'+s['unitId'])
    out=ctl.collect(s) if state and state.get('status')=='running' else ({'blocked':'capacity-stopped'} if decision['stop'] else ctl.dispatch(row['key'],row['sha256']));print(json.dumps(out),flush=True)
   except Exception as e:print(json.dumps({'submission':row['key'],'errorType':type(e).__name__,'error':str(e)}),flush=True)
  if a.once:return
  time.sleep(cfg.get('pollSeconds',15))
if __name__=='__main__':main()
