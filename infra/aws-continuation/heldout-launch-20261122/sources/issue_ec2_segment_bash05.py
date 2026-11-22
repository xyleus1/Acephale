import argparse,base64,fcntl,hashlib,json,os,time,uuid
from pathlib import Path
import boto3
from boto3.dynamodb.types import TypeSerializer,TypeDeserializer
B='EXAMPLE_ARTIFACT_BUCKET';T='acephale-aws-20261121';P='audit/parallel-rescue-20261121/ROOT/heldout-dispatch-01/'
S=boto3.client('s3',region_name='us-east-1');D=boto3.client('dynamodb',region_name='us-east-1')
ser=TypeSerializer();des=TypeDeserializer()
def enc(v):return {k:ser.serialize(x)for k,x in v.items()}
def get(pk):
 x=D.get_item(TableName=T,Key=enc({'pk':pk}),ConsistentRead=True).get('Item')
 return {k:des.deserialize(v)for k,v in x.items()}if x else None
def canonical(v):return (json.dumps(v,sort_keys=True,indent=2,default=str)+'\n').encode()
def write(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);raw=canonical(v)
 with p.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 return p
def pub(p):
 raw=p.read_bytes();h=hashlib.sha256(raw).hexdigest();k=P+'objects/'+h+'/'+p.name
 v=S.put_object(Bucket=B,Key=k,Body=raw)['VersionId']
 return {'path':str(p),'bucket':B,'key':k,'versionId':v,'sha256':h,'bytes':len(raw)}
def readref(r):
 p=Path(r['path']);raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==r['sha256'];return json.loads(raw)
def cond(pk,fields):
 names={f'#n{i}':k for i,k in enumerate(fields)};values={f':v{i}':ser.serialize(v)for i,v in enumerate(fields.values())}
 return {'ConditionCheck':{'TableName':T,'Key':enc({'pk':pk}),'ConditionExpression':' AND '.join(f'#n{i}=:v{i}'for i in range(len(fields))),'ExpressionAttributeNames':names,'ExpressionAttributeValues':values}}
def main():
 a=argparse.ArgumentParser();a.add_argument('--ready',required=True);a.add_argument('--segment',type=int,required=True);v=a.parse_args()
 ready_path=Path(v.ready);ready=json.loads(ready_path.read_text());n=v.segment;unit=f'heldout/{n}';attempt=f'direct-heldout-{n}-20261122-01'
 assert ready['unitId']==unit and ready['unitAttemptId']==attempt and len(ready['originalRunIds'])==48
 contract=readref(ready['contract']);cap=ready['targetResourceAttemptId'];instance=contract['instanceId']
 assert int(ready['hardDeadline'])==1795413600 and time.time()+contract['timeoutSeconds']+300<1795413600
 out=Path('/workspace/acephale/workspaces/review/heldout-dispatch-01')/f'segment{n}';out.mkdir(parents=True,exist_ok=True)
 with open('/workspace/acephale/state/continuation-controller.lock','a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  if (out/'DISPATCH-INTENT.json').exists():
   print('ADOPT_EXISTING',str(out/'DISPATCH-RESULT.json'));return
  if (out/'READY-PUBLISHED.json').exists():
   published=json.loads((out/'READY-PUBLISHED.json').read_text())
   assert all(published[k]['sha256']==ready[k]['sha256'] for k in ['contract','delivery','archive','plan','claimIntent','preparation','launcher'])
   rr=pub(out/'READY-PUBLISHED.json')
  else:
   published=dict(ready)
   for k in ['contract','delivery','archive','plan','claimIntent','preparation','launcher']:published[k]=pub(Path(ready[k]['path']))
   rr=pub(write(out/'READY-PUBLISHED.json',published))
  parent=get('coordinator');journal=get('journal#sole-owner');resource=get('resource#'+cap)
  assert parent['executionEnabled'] is True and parent['stopRequested'] is False
  assert journal['queueRoot']=='/workspace/acephale/shared/execution-budget-rpc01/production03-heldout' and journal['operationalState']=='ready-original-backend-single-writer'
  assert resource['attemptId']==cap and resource['providerService']=='ec2' and resource['region']=='us-east-1' and int(resource['deadline'])>=1795413600
  missing_resource_owner='scientificUnitId' not in resource
  if missing_resource_owner:
   assert n==2 and cap=='RESOURCE_1' and instance=='INSTANCE_1'
   assert resource.get('scientificUnitAttemptId')=='direct-seed29-20261122-01'
   oldblock=get('native-block#development/1#00')
   assert oldblock['resourceAttemptId']==cap and oldblock['instanceId']==instance and oldblock['attemptId']=='direct-development-1-20261122-01'
   previous_unit='development/1';previous_attempt=oldblock['attemptId']
  else:
   previous_unit=resource['scientificUnitId'];previous_attempt=resource['scientificUnitAttemptId']
  prior=get('unit#'+previous_unit)
  assert prior['attemptId']==previous_attempt and prior['directExecutionCompleted'] is True
  now=int(time.time());common={'unitId':unit,'attemptId':attempt,'permanent':True,'claimedAt':now,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'qualificationAsserted':False,'newHostedDispatchHeld':False,'scientificDispatchIssued':False,'automaticRetry':False,'hardDeadline':1795413600}
  owner=dict(common,pk='unit#'+unit,status='running',sourceCommit=parent['sourceCommit'],originalJobSha256=ready['originalJob']['sha256'],inputSha256=rr['sha256'],originalRunIds=ready['originalRunIds'],claimedNativeBlocks=[n],predictorTrainingSeed=ready['predictorTrainingSeed'],actorTrialSeed=17,sharedBudgetOwner=journal['attemptId'],operationalState='original-whole-heldout-segment-claimed',sourceReady=rr,wholeCohortReservation=ready['ownerCohortReservation'],directExecutionCompleted=False)
  block=dict(common,pk=f'native-block#{unit}#{n:02d}',blockIndex=n,runIds=ready['originalRunIds'],resourceAttemptId=cap,planSha256=ready['plan']['sha256'],contractSha256=ready['contract']['sha256'],readySha256=rr['sha256'],status='claimed-not-issued',operationalState='whole-selected-serving-segment',perRunAllowanceMicrodollars=1250000,providerService='ec2',region='us-east-1',instanceId=instance)
  tx=[{'Put':{'TableName':T,'Item':enc(x),'ConditionExpression':'attribute_not_exists(pk)'}}for x in [owner,block]]
  for run in ready['originalRunIds']:
   item=dict(common,pk='native-run#'+run,runId=run,blockIndex=n,resourceAttemptId=cap,status='claimed-not-issued',perRunAllowanceMicrodollars=1250000)
   tx.append({'Put':{'TableName':T,'Item':enc(item),'ConditionExpression':'attribute_not_exists(pk)'}})
  tx += [cond('coordinator',{k:parent[k]for k in ['controllerInstanceId','sourceCommit','controllerSourceSha256','stopRequested','executionEnabled']}),cond('journal#sole-owner',{k:journal[k]for k in ['attemptId','unitId','brokerPID','queueRoot','operationalState','hardDeadline']}),cond('unit#'+previous_unit,{'attemptId':previous_attempt,'directExecutionCompleted':True})]
  tx.append({'Update':{'TableName':T,'Key':enc({'pk':'resource#'+cap}),'UpdateExpression':'SET scientificUnitId=:newunit, scientificUnitAttemptId=:newattempt, directPriorScientificOwner=:oldattempt, directResourceTransferReason=:reason','ConditionExpression':'attemptId=:cap AND scientificUnitId=:oldunit AND scientificUnitAttemptId=:oldattempt AND deadline=:deadline','ExpressionAttributeValues':{':newunit':ser.serialize(unit),':newattempt':ser.serialize(attempt),':oldunit':ser.serialize(previous_unit),':oldattempt':ser.serialize(previous_attempt),':cap':ser.serialize(cap),':deadline':ser.serialize(resource['deadline']),':reason':ser.serialize('actual-completed-development-to-original-whole-heldout-segment')}}})
  if missing_resource_owner:
   update=tx[-1]['Update']
   update['ConditionExpression']='attemptId=:cap AND attribute_not_exists(scientificUnitId) AND scientificUnitAttemptId=:observedowner AND deadline=:deadline'
   update['ExpressionAttributeValues'][':observedowner']=ser.serialize(resource['scientificUnitAttemptId'])
   update['UpdateExpression']+=', directPriorResourceOwner=:observedowner'
   del update['ExpressionAttributeValues'][':oldunit']
   tx.append(cond('native-block#development/1#00',{'attemptId':previous_attempt,'resourceAttemptId':cap,'instanceId':instance}))
  token=hashlib.sha256((unit+rr['sha256']).encode()).hexdigest()[:36]
  write(out/'CLAIM-TRANSACTION.json',{'TransactItems':tx,'ClientRequestToken':token})
  response=D.transact_write_items(TransactItems=tx,ClientRequestToken=token);write(out/'CLAIM-RESULT.json',response)
  claim={'kind':'acephale-unvalidated-whole-heldout-claim-v1','unitId':unit,'unitAttemptId':attempt,'ready':published,'block':{'blockIndex':n,'runIds':ready['originalRunIds']},'originalRunIds':ready['originalRunIds'],'wholeCohortReservation':ready['ownerCohortReservation'],'canonicalAcceptance':False,'qualificationAsserted':False,'previousOwner':{'unitId':previous_unit,'attemptId':previous_attempt},'claimTransactionRequestId':response['ResponseMetadata']['RequestId']}
  claimref=pub(write(out/'CLAIMED.json',claim))
  spec={'claimRef':claimref,'instanceId':instance,'resourceAttemptId':cap,'dispatchRoot':f'/workspace/acephale/workspaces/rescue/execution/heldout-segment{n}-direct01','outputPrefix':f'workers/{cap}/unvalidated/heldout-segment{n}-direct01/'}
  original=Path('/workspace/acephale/workspaces/rescue/execution/ec2-dispatch02/ec2_stage_run_collect02.py').read_bytes()
  assert hashlib.sha256(original).hexdigest()=='fcf4239ec5a2205e74dac145d9e80cbc328e8bb524103b41bb1e4d261acdab0f'
  payload='SPEC_B64='+repr(base64.b64encode(canonical(spec)).decode())+'\n'+original.decode()
  shell="set -euo pipefail\n/workspace/acephale/ops-venv/bin/python - <<'PY'\n"+payload+"\nPY\n"
  shell="bash -s <<'HELDOUT_BASH_PAYLOAD'\n"+shell+"\nHELDOUT_BASH_PAYLOAD\n"
  (out/'worker-command.sh').write_text(shell)
  write(out/'DISPATCH-INTENT.json',{'at':time.time(),'spec':spec,'commandSha256':hashlib.sha256(shell.encode()).hexdigest(),'attemptId':attempt,'automaticRetry':False})
  cmd=boto3.client('ssm',region_name='us-east-1').send_command(InstanceIds=[instance],DocumentName='AWS-RunShellScript',Parameters={'commands':[shell],'executionTimeout':['6200']},TimeoutSeconds=600,Comment=f'Original selected heldout segment {n} once unvalidated')['Command']
  result={'at':time.time(),'commandId':cmd['CommandId'],'instanceId':instance,'resourceAttemptId':cap,'unitId':unit,'attemptId':attempt,'claimRef':claimref,'outputPrefix':spec['outputPrefix'],'service':contract['service'],'runRoot':contract['nativeCommand'][contract['nativeCommand'].index('--output')+1],'ownerRoot':contract['command'][contract['command'].index('--output')+1],'scientificAcceptance':False}
  ref=pub(write(out/'DISPATCH-RESULT.json',result))
  D.update_item(TableName=T,Key=enc({'pk':'unit#'+unit}),ConditionExpression='attemptId=:a AND inputSha256=:h',UpdateExpression='SET currentCommandId=:c, scientificDispatchIssued=:t, operationalState=:s, currentDispatchReceipt=:r',ExpressionAttributeValues={':a':ser.serialize(attempt),':h':ser.serialize(rr['sha256']),':c':ser.serialize(cmd['CommandId']),':t':ser.serialize(True),':s':ser.serialize('original-whole-heldout-segment-issued'),':r':ser.serialize(ref)})
  print(json.dumps({'dispatch':result,'receipt':ref}))
if __name__=='__main__':main()
