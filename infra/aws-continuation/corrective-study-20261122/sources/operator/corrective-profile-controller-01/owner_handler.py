"""Same-controller, finite, one-shot adapter for EXECUTION owner READY operations.
No provider allocation or scientific retry. Existing worker/publisher payloads only.
"""
import hashlib,json,os,re,signal,subprocess,time
from pathlib import Path
DEADLINE=1795413600
SCIENCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
UNITS=('corrective/seed17/opportunity','corrective/seed29/opportunity','corrective/development/1','corrective/development/2','corrective/heldout/1','corrective/heldout/2')
def digest(raw):return hashlib.sha256(raw).hexdigest()
def body(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),default=str)+'\n').encode()
def require(ok,message):
 if not ok:raise ValueError(message)
def checked(ref):
 p=Path(ref['path']);require(p.is_absolute() and not any(x.is_symlink()for x in (p,*p.parents)),'Owner path must be literal')
 raw=p.read_bytes();st=p.stat()
 require(st.st_uid==0 and not st.st_mode&0o022 and len(raw)<=8*1024*1024 and digest(raw)==ref['sha256'],'Owner FileRef changed')
 return raw
def pointer(value,path):
 for key in path.split('.'):
  value=value[int(key)] if isinstance(value,list) else value[key]
 return value
def evidence(ctl,spec):
 ref=spec['ref']
 if 'path'in ref:raw=checked(ref);resultref=ref
 else:
  args={'Bucket':ctl.store.bucket,'Key':ref['key']}
  if ref.get('versionId'):args['VersionId']=ref['versionId']
  try:r=ctl.store.s3.get_object(**args)
  except Exception as e:
   if getattr(e,'response',{}).get('Error',{}).get('Code')in('NoSuchKey','404'):return None
   raise
  raw=r['Body'].read(8*1024*1024+1)
  require(len(raw)<=8*1024*1024 and r.get('VersionId')not in(None,'','null'),'Finite versioned owner evidence')
  require(not ref.get('sha256')or digest(raw)==ref['sha256'],'Owner evidence hash')
  resultref={'key':ref['key'],'versionId':r['VersionId'],'sha256':digest(raw),'bytes':len(raw)}
 value=json.loads(raw)
 for path,want in spec.get('equals',{}).items():require(pointer(value,path)==want,'Evidence identity '+path)
 for path in spec.get('drained',[]):require(pointer(value,path)is True,'Physical drain '+path)
 for path in spec.get('drainedArrays',[]):
  rows=pointer(value,path['path']);require(rows and all(row.get(path['field'])is True for row in rows),'Owned children not drained')
 require(spec.get('drained')or spec.get('drainedArrays'),'A terminal receipt is not physical drain by itself')
 return value,resultref
def svalue(value):
 from boto3.dynamodb.types import TypeSerializer
 return TypeSerializer().serialize(value)
def equal_condition(values):
 names={};args={};parts=[]
 for i,(key,value)in enumerate(values.items()):
  names['#e'+str(i)]=key;args[':e'+str(i)]=svalue(value);parts.append('#e'+str(i)+'=:e'+str(i))
 return ' AND '.join(parts),names,args
def identity(row,op):
 return row and row.get('attemptId')==op['attemptId'] and row.get('inputSha256')==op['inputSha256'] and row.get('sourceCommit')==SCIENCE and row.get('permanent')is True and row.get('validationStatus')=='unvalidated' and row.get('scientificAcceptanceAsserted')is False
def validate(op,config):
 require(op.get('kind')=='goalspec-direct-owner-ready-operation-v1'and op.get('owner')=='EXECUTION','Exact owner READY descriptor')
 require(op.get('unitId')in UNITS and re.fullmatch('[a-zA-Z0-9_-]{8,64}',op.get('operationId','')),'Finite original unit operation')
 require(op.get('validationStatus')=='unvalidated'and op.get('scientificAcceptanceAsserted')is False,'Never scientific acceptance')
 require(op.get('hardDeadline')==DEADLINE and op.get('automaticScientificRetry')is False,'Finite no-retry operation')
 require(op.get('transport')in('existing-regional-ssm','existing-owner-publisher'),'Existing owner transport only')
 require(op.get('providerMutation')is False and op.get('newReservation')is False,'Provider and reservation ownership remains external')
 require(op.get('fundingClass')in('aws-local','hosted-funded'),'Declared funding class')
 require(0<op['requiredRunwaySeconds']<=DEADLINE and 1<=op.get('publicationMaximumSeconds',60)<=60,'Bounded original runtime and publication')
 owner=json.loads(checked(op['ownerReady']));checked(op['payloadSource'])
 if op['transport']=='existing-regional-ssm' and not op.get('adoptExistingOwnerPublication'):
  require(op['workerRegion']in('us-east-1','us-east-2','us-west-2')and re.fullmatch('i-[0-9a-f]{17}',op['instanceId']),'Exact existing worker')
  require(pointer(owner,op.get('ownerArgvPath','command'))==op['workerArgv'],'Original owner READY argv unchanged')
  admission=json.loads(checked(op['ownerAdmission']))
  require(pointer(admission,op.get('ownerAdmissionCommandPath','command'))==op['workerAdmissionCommand'],'Original owner admission command unchanged')
 require(op['payloadSource']['path'].startswith('/REQUIRED_BINDINGS/research-root/workspaces/rescue/execution/'),'Existing EXECUTION scientific payload')
 if op['transport']=='existing-owner-publisher' and not op.get('adoptExistingOwnerPublication'):
  checked(op['publisher']['source'])
  require(op['publisher']['source']['path']in op['publisher']['argv'],'Exact existing publisher entry')
  require(op['publisher'].get('operation')=='publish-existing-command','No allocation/StartInstances seam')
 return op
def blocked(op,row,config,now):
 if not identity(row,op):return 'canonical-owner-or-input-changed'
 if row.get('directExecutionCompleted') is True:return 'direct-unit-already-completed'
 if row.get('status')not in('claimed','running'):return 'retained-terminal-canonical-state'
 if config.get('holdNewHostedDispatch',True)and op['fundingClass']!='aws-local':return 'pending-hosted-funding'
 if now+op['requiredRunwaySeconds']>min(DEADLINE,float(row.get('hardDeadline',0))):return 'insufficient-finite-runway'
 for k,v in op.get('expectedCanonical',{}).items():
  if row.get(k)!=v:return 'current-owner-generation-changed'
 if op['transport']=='existing-regional-ssm' and row.get('instanceId')!=op.get('instanceId'):return 'canonical-worker-changed'
 if op.get('executionClass')!='controller-cpu-operation' and not op.get('resource'):return 'exact-worker-resource-missing'
 if op.get('requiresSameAttemptResume')is True and not op.get('resumePlan'):return 'awaiting-owner-disk-recovery-resume-plan'
 return None
def claim_from_owner_intent(ctl,op,now):
 """Reuse the actual {claim, block, contract, ready} intent shape emitted by EXECUTION."""
 intent=json.loads(checked(op['ownerClaimIntent']));claim=intent['claim']
 require(identity(claim,op)and claim.get('pk')=='unit#'+op['unitId'],'Owner claim identity')
 require(claim.get('status')in('claimed','running')and float(claim['hardDeadline'])==DEADLINE,'Finite unvalidated claim')
 checked(intent['contract'])
 table=ctl.claims.table
 items=[{'Put':{'TableName':table,'Item':{k:svalue(v)for k,v in claim.items()},'ConditionExpression':'attribute_not_exists(pk)'}}]
 if intent.get('block'):
  block=intent['block'];idx=block['blockIndex'];runs=claim['originalRunIds']
  require(block['unitId']==op['unitId']and block['attemptId']==op['attemptId']and block['runIds']==runs[3*idx:3*idx+3]and len(block['runIds'])==3,'Exact original ordered triplet')
  require(block['pk']=='native-block#'+op['unitId']+'#'+str(idx).zfill(2),'Exact block identity')
  items.append({'Put':{'TableName':table,'Item':{k:svalue(v)for k,v in block.items()},'ConditionExpression':'attribute_not_exists(pk)'}})
 require(op.get('resource'),'Owner claim requires exact resource')
 resource=op['resource'];lease_key=resource.get('deadlineField','deadline');require(lease_key in('deadline','hardDeadline'),'Named existing lease field');expr,n,v=equal_condition(resource['equals']);n['#lease']=lease_key;v[':until']={'N':str(int(now+op['requiredRunwaySeconds']))};v[':no']={'BOOL':False}
 expr+=' AND #lease>:until AND (attribute_not_exists(retirementAuthorized) OR retirementAuthorized=:no) AND (attribute_not_exists(reservationReleased) OR reservationReleased=:no) AND (attribute_not_exists(evidence.reservationReleased) OR evidence.reservationReleased=:no)'
 current=ctl.claims.decoded(resource['key']);require(current,'Exact existing resource')
 require(claim.get('resourceAttemptId')==current.get('attemptId')==resource['equals'].get('attemptId'),'Original owner claim must bind this exact resource')
 require(current.get('reservationReleased')is not True and current.get('evidence',{}).get('reservationReleased')is not True,'Resource reservation already released')
 old_owner=current.get('scientificUnitAttemptId')
 if old_owner:
  require(op.get('previousResourceOwner')==old_owner,'Explicit previous resource owner')
  require(any(d.get('equals',{}).get('attemptId')==old_owner and(d['equals'].get('directExecutionCompleted')is True or d['equals'].get('status')in('succeeded','failed','unknown'))for d in op.get('dependencies',[])),'Previous assignment terminal/complete condition')
  require(any(old_owner in p.get('equals',{}).values()for p in op.get('priorDrainEvidence',[])),'Prior drain must bind the previous assignment')
  v[':oldOwner']={'S':old_owner};expr+=' AND scientificUnitAttemptId=:oldOwner'
 else:expr+=' AND attribute_not_exists(scientificUnitAttemptId)'
 v[':newOwner']={'S':op['attemptId']};v[':yes']={'BOOL':True}
 items.append({'Update':{'TableName':table,'Key':{'pk':{'S':resource['key']}},'ConditionExpression':expr,'UpdateExpression':'SET scientificUnitAttemptId=:newOwner, scientificUnitClaimed=:yes','ExpressionAttributeNames':n,'ExpressionAttributeValues':v}})
 items.append({'ConditionCheck':{'TableName':table,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:code AND executionEnabled=:yes AND stopRequested=:no AND hardDeadline>:now','ExpressionAttributeValues':{':code':{'S':ctl.controller_source_sha256},':yes':{'BOOL':True},':no':{'BOOL':False},':now':{'N':str(int(now))}}}})
 items.append({'ConditionCheck':{'TableName':table,'Key':{'pk':{'S':'coordinator#capacity-v1'}},'ConditionExpression':'stopRequested=:no AND studyComplete=:no','ExpressionAttributeValues':{':no':{'BOOL':False}}}})
 if op.get('journalOwnerRequired'):
  items.append({'Put':{'TableName':table,'Item':{'pk':{'S':'journal#sole-owner'},'unitId':{'S':op['unitId']},'attemptId':{'S':op['attemptId']},'permanentUntilObservedDrain':{'BOOL':True}},'ConditionExpression':'attribute_not_exists(pk)'}})
 for dep in op.get('dependencies',[]):
  expr,n,v=equal_condition(dep['equals']);items.append({'ConditionCheck':{'TableName':table,'Key':{'pk':{'S':'unit#'+dep['unitId']}},'ConditionExpression':expr,'ExpressionAttributeNames':n,'ExpressionAttributeValues':v}})
 ctl.claims.ddb.transact_write_items(TransactItems=items,ClientRequestToken=digest((op['operationId']+'-claim').encode())[:36])
 return ctl.claims.decoded('unit#'+op['unitId'])

def operation_key(op):return 'state/direct-owner-operations/'+op['operationId']
def read_optional(ctl,key):
 try:return ctl.store.get(key)
 except Exception as e:
  if getattr(e,'response',{}).get('Error',{}).get('Code')in('NoSuchKey','404'):return None
  raise
def own_operation(ctl,op,ref,row,now,adoption=False):
 """CAS only an auxiliary operation within the existing canonical assignment."""
 expected={'status':row['status'],'attemptId':op['attemptId'],'inputSha256':op['inputSha256'],'permanent':True,'sourceCommit':SCIENCE,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,**op.get('expectedCanonical',{})}
 cond,names,values=equal_condition(expected)
 if not adoption:
  values[':notCompleted']={'BOOL':False};cond+=' AND (attribute_not_exists(directExecutionCompleted) OR directExecutionCompleted=:notCompleted)'
 prior=row.get('directControllerOperation')
 if prior:
  if prior.get('operationId')==op['operationId'] and prior.get('descriptorSha256')==ref['sha256'] and prior.get('phase')=='publication-intent':return prior
  require(prior.get('phase')=='terminal'and prior.get('allChildrenDrained')is True,'Previous operation unresolved')
  names['#previous']='directControllerOperation';values[':previous']=svalue(prior);cond+=' AND #previous=:previous'
 else:cond+=' AND attribute_not_exists(directControllerOperation)'
 token={'operationId':op['operationId'],'descriptorSha256':ref['sha256'],'phase':'publication-intent','claimedAt':int(now),'hardDeadline':DEADLINE,'validationStatus':'unvalidated'}
 values[':op']=svalue(token)
 update={'TableName':ctl.claims.table,'Key':{'pk':{'S':'unit#'+op['unitId']}},'ConditionExpression':cond,'UpdateExpression':'SET directControllerOperation=:op','ExpressionAttributeNames':names,'ExpressionAttributeValues':values}
 root={'TableName':ctl.claims.table,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:code AND executionEnabled=:true AND stopRequested=:false AND hardDeadline>:now','ExpressionAttributeValues':{':code':{'S':ctl.controller_source_sha256},':true':{'BOOL':True},':false':{'BOOL':False},':now':{'N':str(int(now))}}}
 cap={'TableName':ctl.claims.table,'Key':{'pk':{'S':'coordinator#capacity-v1'}},'ConditionExpression':'stopRequested=:false AND studyComplete=:false','ExpressionAttributeValues':{':false':{'BOOL':False}}}
 if adoption:
  root['ConditionExpression']='controllerSourceSha256=:code';root['ExpressionAttributeValues']={':code':{'S':ctl.controller_source_sha256}}
 actions=[{'ConditionCheck':root},{'Update':update}] if adoption else [{'ConditionCheck':root},{'ConditionCheck':cap},{'Update':update}]
 if op.get('resource') and not adoption:
  resource=op['resource'];lease_key=resource.get('deadlineField','deadline');require(lease_key in('deadline','hardDeadline'),'Named existing lease field');current=ctl.claims.decoded(resource['key'])
  require(current and float(current[lease_key])>now+op['requiredRunwaySeconds'],'Current worker lease cannot fit')
  require(current.get('retirementAuthorized')is not True and current.get('reservationReleased')is not True and current.get('evidence',{}).get('reservationReleased')is not True,'Worker already retiring/released')
  require(row.get('resourceAttemptId',row.get('leaseId'))==current['attemptId'],'Same canonical resource only')
  expr,n,v=equal_condition(resource['equals']);n['#lease']=lease_key;v[':no']={'BOOL':False};v[':until']={'N':str(int(now+op['requiredRunwaySeconds']))};expr+=' AND (attribute_not_exists(retirementAuthorized) OR retirementAuthorized=:no) AND (attribute_not_exists(reservationReleased) OR reservationReleased=:no) AND (attribute_not_exists(evidence.reservationReleased) OR evidence.reservationReleased=:no) AND #lease>:until';actions.append({'ConditionCheck':{'TableName':ctl.claims.table,'Key':{'pk':{'S':resource['key']}},'ConditionExpression':expr,'ExpressionAttributeNames':n,'ExpressionAttributeValues':v}})
 for dep in ([] if adoption else op.get('dependencies',[])):
  expr,n,v=equal_condition(dep['equals'])
  actions.append({'ConditionCheck':{'TableName':ctl.claims.table,'Key':{'pk':{'S':'unit#'+dep['unitId']}},'ConditionExpression':expr,'ExpressionAttributeNames':n,'ExpressionAttributeValues':v}})
 ctl.claims.ddb.transact_write_items(TransactItems=actions)
 return token
def mark(ctl,op,ref,phase,extra):
 row={'operationId':op['operationId'],'descriptorSha256':ref['sha256'],'phase':phase,'validationStatus':'unvalidated',**extra}
 ctl.claims.ddb.update_item(TableName=ctl.claims.table,Key={'pk':{'S':'unit#'+op['unitId']}},ConditionExpression='attemptId=:attempt AND inputSha256=:input AND directControllerOperation.operationId=:op AND directControllerOperation.descriptorSha256=:sha',UpdateExpression='SET directControllerOperation=:value',ExpressionAttributeValues={':attempt':{'S':op['attemptId']},':input':{'S':op['inputSha256']},':op':{'S':op['operationId']},':sha':{'S':ref['sha256']},':value':svalue(row)})
 return row
def group_members(pgid):
 result=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    row=(p/'stat').read_text().rsplit(')',1)[1].split()
    if int(row[2])==pgid and row[0]!='Z':result.append(int(p.name))
   except (OSError,ValueError,IndexError):pass
 return result
def publish_once(ctl,op,work):
 if op['transport']=='existing-regional-ssm':
  argv=op['workerArgv'];require(op['payloadSource']['path']in argv,'Actual worker payload source required')
  import shlex
  line=shlex.join(argv)
  check='test "$(sha256sum '+shlex.quote(op['payloadSource']['path'])+' | cut -d " " -f1)" = '+shlex.quote(op['payloadSource']['sha256'])
  # Already-delivered owner payload and its original runner retain worker intent,
  # lease, output namespace and physical process-drain implementation.
  command=op['workerAdmissionCommand']
  require(line in command,'Exact owner argv in admission command')
  result=ctl.regional_ssm[op['workerRegion']].send_command(InstanceIds=[op['instanceId']],DocumentName='AWS-RunShellScript',Comment='direct-owner-'+op['operationId'],Parameters={'commands':[check+' && '+command],'executionTimeout':['60']},TimeoutSeconds=90)
  return {'commandId':result['Command']['CommandId'],'scientificExecutionNotAsserted':True}
 args=op['publisher']['argv'];out=work/'publisher.stdout';err=work/'publisher.stderr'
 with out.open('xb')as so,err.open('xb')as se:
  p=subprocess.Popen(args,cwd=op['publisher']['cwd'],stdout=so,stderr=se,start_new_session=True)
  try:code=p.wait(timeout=op.get('publicationMaximumSeconds',60))
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   raise RuntimeError('Publisher timed out: retain ambiguous publication; no repeat')
 remaining=group_members(p.pid)
 if remaining:
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  until=time.monotonic()+5
  while group_members(p.pid)and time.monotonic()<until:time.sleep(.1)
  if group_members(p.pid):
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   until=time.monotonic()+2
   while group_members(p.pid)and time.monotonic()<until:time.sleep(.1)
  require(not group_members(p.pid),'Publisher children not drained')
 require(code==0,'Publisher failed: reconcile durable owner receipt, never rerun automatically')
 return {'publisherExitCode':code,'publisherChildrenDrained':True,'scientificExecutionNotAsserted':True}
def release_owned_journal(ctl,op):
 if not op.get('journalOwnerRequired'):return {'journalRelease':'not-required'}
 proof=op.get('journalReleaseEvidence')
 if not proof:return {'journalRelease':'awaiting-original-lock-closure-proof'}
 require(op['attemptId'] in proof.get('equals',{}).values(),'Journal closure proof must bind the same attempt')
 observed=evidence(ctl,proof)
 if observed is None:return {'journalRelease':'awaiting-original-lock-closure-proof'}
 value,ref=observed
 require(pointer(value,proof['originalLockClosedField'])is True,'Original journal lock must be observed closed')
 owner=ctl.claims.decoded('journal#sole-owner')
 if owner is None:return {'journalRelease':'already-absent','journalProof':ref}
 require(owner.get('unitId')==op['unitId']and owner.get('attemptId')==op['attemptId'],'Never release another journal owner')
 ctl.claims.ddb.transact_write_items(TransactItems=[
 {'ConditionCheck':{'TableName':ctl.claims.table,'Key':{'pk':{'S':'unit#'+op['unitId']}},'ConditionExpression':'attemptId=:a AND directControllerOperation.operationId=:o AND directControllerOperation.#phase=:terminal AND directControllerOperation.allChildrenDrained=:yes','ExpressionAttributeNames':{'#phase':'phase'},'ExpressionAttributeValues':{':a':{'S':op['attemptId']},':o':{'S':op['operationId']},':terminal':{'S':'terminal'},':yes':{'BOOL':True}}}},
 {'Delete':{'TableName':ctl.claims.table,'Key':{'pk':{'S':'journal#sole-owner'}},'ConditionExpression':'unitId=:u AND attemptId=:a','ExpressionAttributeValues':{':u':{'S':op['unitId']},':a':{'S':op['attemptId']}}}}])
 return {'journalRelease':'same-owner-after-physical-and-lock-drain','journalProof':ref}

def reconcile_one(ctl,config,ref,now,allow_dispatch):
 op=validate(json.loads(checked(ref)),config);row=ctl.claims.decoded('unit#'+op['unitId'])
 if row is None and op.get('ownerClaimIntent'):
  if not allow_dispatch or now+op['requiredRunwaySeconds']>DEADLINE:return {'operationId':op['operationId'],'state':'claim-held-by-stop-or-runway'}
  if config.get('holdNewHostedDispatch',True)and op['fundingClass']!='aws-local':return {'operationId':op['operationId'],'state':'pending-hosted-funding'}
  require(op.get('priorDrainEvidence'),'Fresh claim requires prior resource drain')
  for prior in op['priorDrainEvidence']:require(evidence(ctl,prior)is not None,'Resource not physically drained')
  row=claim_from_owner_intent(ctl,op,now)
 if not identity(row,op):return {'operationId':op['operationId'],'state':'canonical-owner-or-input-changed'}
 key=operation_key(op);existing=read_optional(ctl,key+'/intent.json')
 if not existing and op.get('adoptExistingOwnerPublication'):
  observed=op['ownerPublicationEvidence'];proof=json.loads(checked(observed['ref']))
  require(observed.get('equals'),'Exact existing owner publication identity')
  for path,want in observed['equals'].items():require(pointer(proof,path)==want,'Existing publication identity '+path)
  canonical=op['ownerPublicationCanonical']
  require(any(k in canonical for k in ('currentCommandId','commandId','currentMailboxSequence','mailboxSequence')),'Actual existing dispatch handle required')
  require(all(row.get(k)==v for k,v in canonical.items()),'Existing owner dispatch handle changed')
  require(all(k in op.get('expectedCanonical',{}) and op['expectedCanonical'][k]==v for k,v in canonical.items()),'Publication handle must be atomically fenced')
  require(any(v in observed['equals'].values() for k,v in canonical.items() if k in ('currentCommandId','commandId','currentMailboxSequence','mailboxSequence')),'Receipt must bind the canonical dispatch handle')
  token=own_operation(ctl,op,ref,row,now,adoption=True)
  intent={'kind':'goalspec-direct-owner-operation-intent-v1','descriptor':ref,'unitId':op['unitId'],'attemptId':op['attemptId'],'token':token,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'existingOwnerPublicationAdopted':observed['ref']}
  ctl.store.put(key+'/intent.json',intent)
  pr=ctl.store.put(key+'/publication.json',{'descriptor':ref,'existingOwnerPublication':observed['ref'],'canonicalHandle':canonical,'newCommandSent':False})
  mark(ctl,op,ref,'issued',{'publication':pr,'scientificAcceptanceAsserted':False})
  existing=ctl.store.get(key+'/intent.json')
 if existing:
  require(existing[0]['descriptor']==ref,'Operation ID cannot be rebound')
  completed=evidence(ctl,op['completionEvidence']) if op.get('completionEvidence') else None
  if completed:
   value,er=completed
   mark(ctl,op,ref,'terminal',{'allChildrenDrained':True,'completionEvidence':er,'finishedAt':int(now),'executionClosed':True,'ownerReportedOutcome':op.get('ownerReportedFinalOutcome'),'scientificAcceptanceAsserted':False})
   return {'operationId':op['operationId'],'state':'terminal-owner-evidence-adopted','evidence':er,**release_owned_journal(ctl,op)}
  receipt=read_optional(ctl,key+'/publication.json')
  return {'operationId':op['operationId'],'state':'owner-publication-issued' if receipt else 'ambiguous-publication-await-owner-evidence','automaticRetry':False}
 reason=blocked(op,row,config,now)
 if reason:return {'operationId':op['operationId'],'state':reason}
 if not allow_dispatch:return {'operationId':op['operationId'],'state':'controller-stop-dispatch-held'}
 for prior in op.get('priorDrainEvidence',[]):
  require(evidence(ctl,prior)is not None,'Prior owned processes have no durable drain proof')
 if op.get('requiresSameAttemptResume'):checked(op['resumePlan'])
 require(op.get('priorDrainEvidence'),'Ready operation must retain exact prior drain')
 if op.get('deliveryEvidence'):checked(op['deliveryEvidence'])
 for dep in op.get('dependencies',[]):
  current=ctl.claims.decoded('unit#'+dep['unitId'])
  if not current or any(current.get(k)!=v for k,v in dep['equals'].items()):return {'operationId':op['operationId'],'state':'dependency-not-data-ready'}
 work=Path(config['stateDirectory'])/op['operationId'];work.mkdir(parents=True,exist_ok=True)
 token=own_operation(ctl,op,ref,row,now)
 intent={'kind':'goalspec-direct-owner-operation-intent-v1','descriptor':ref,'unitId':op['unitId'],'attemptId':op['attemptId'],'token':token,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False}
 ctl.store.put(key+'/intent.json',intent)
 # Exclusive local marker precedes any potentially ambiguous external call.
 marker=work/'publication-attempted.json'
 with marker.open('xb')as f:f.write(body(intent));f.flush();os.fsync(f.fileno())
 fd=os.open(work,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 receipt=publish_once(ctl,op,work)
 r=ctl.store.put(key+'/publication.json',{'descriptor':ref,'unitId':op['unitId'],'attemptId':op['attemptId'],'publishedAt':int(time.time()),**receipt})
 mark(ctl,op,ref,'issued',{'publication':r,'scientificAcceptanceAsserted':False})
 return {'operationId':op['operationId'],'state':'published-existing-owner-operation','receipt':r}
def tick(controller,config,now=None,allow_dispatch=True):
 now=time.time()if now is None else now
 require(config['hardDeadline']==DEADLINE and config['owner']=='EXECUTION','Direct owner configuration')
 observations=[]
 for unit in config.get('observedUnits',[]):
  row=controller.claims.decoded('unit#'+unit)
  observations.append({'unitId':unit,'canonicalStatus':(row or {}).get('status','absent'),'attemptId':(row or {}).get('attemptId'),'directExecutionCompleted':(row or {}).get('directExecutionCompleted',False),'operationalState':(row or {}).get('operationalState'),'currentCommandId':(row or {}).get('currentCommandId',(row or {}).get('commandId')),'currentPreparationSha256':(row or {}).get('currentPreparationSha256'),'scientificAcceptanceAsserted':(row or {}).get('scientificAcceptanceAsserted',False)})
 reports=[]
 for path in sorted(Path(config['readyDirectory']).glob('*.json')):
  if len(reports)>=config.get('maximumOperationsPerTick',8):break
  raw=path.read_bytes();ref={'path':str(path),'sha256':digest(raw)}
  try:reports.append(reconcile_one(controller,config,ref,now,allow_dispatch and now<DEADLINE))
  except Exception as e:reports.append({'descriptor':ref,'state':'retained-operation-error','errorType':type(e).__name__,'error':str(e),'automaticRetry':False})
 return {'kind':'goalspec-direct-owner-tick-v1','observedAt':now,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'newHostedDispatchHeld':config.get('holdNewHostedDispatch',True),'observedAssignments':observations,'operations':reports}
