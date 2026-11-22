"""Existing-controller child generation reconciler; financial operations stay on owner RPC."""
import hashlib,json,os,time
from pathlib import Path
from decimal import Decimal
DEADLINE=1795413600
def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):
 from boto3.dynamodb.types import TypeSerializer
 if isinstance(v,float):v=Decimal(str(v))
 return TypeSerializer().serialize(v)
def eq(values):
 names={};args={};parts=[]
 for i,(k,v) in enumerate(values.items()):
  a='#f'+str(i);b=':v'+str(i);names[a]=k;args[b]=encoded(v);parts.append(a+'='+b)
 return ' AND '.join(parts),names,args
def condition(ctl,key,values,extra=None):
 expr,n,v=eq(values)
 if extra:
  clause,nn,vv=extra;expr+=' AND '+clause;n.update(nn);v.update(vv)
 return {'ConditionCheck':{'TableName':ctl.claims.table,'Key':{'pk':{'S':key}},'ConditionExpression':expr,'ExpressionAttributeNames':n,'ExpressionAttributeValues':v}}
def readrow(ctl,key):return ctl.claims.decoded(key)
def checked(ref):
 p=Path(ref['path']);need(p.is_absolute()and not any(q.is_symlink()for q in(p,*p.parents)),'Literal source')
 b=p.read_bytes();s=p.stat();need(s.st_uid==0 and not s.st_mode&0o022 and sha(b)==ref['sha256'],'Exact source bytes')
 return b
def proof(ctl,r):
 if 'path'in r:b=checked(r)
 else:
  q=ctl.store.s3.get_object(Bucket=r.get('bucket',ctl.store.bucket),Key=r['key'],VersionId=r['versionId']);b=q['Body'].read(8*1024*1024+1);need(len(b)<=8*1024*1024 and sha(b)==r['sha256'],'Exact bounded proof')
 return json.loads(b)
def field(x,path):
 for p in path.split('.'):x=x[int(p)]if isinstance(x,list)else x[p]
 return x
def drained(ctl,spec):
 x=proof(ctl,spec['ref'])
 for k,v in spec.get('equals',{}).items():need(field(x,k)==v,'Predecessor identity '+k)
 if spec.get('allChildrenDrainedField'):need(field(x,spec['allChildrenDrainedField'])is True,'Physical predecessor drain')
 elif spec.get('unitStateField'):
  state=field(x,spec['unitStateField']);need('MainPID=0'in state and any(s in state for s in('ActiveState=inactive','ActiveState=failed')),'Physical systemd predecessor drain')
 else:raise ValueError('Actual physical drain evidence required')
 return x
def operation_id(item):return item['originalBlock']['unitId'].replace('/','-')+'-'+item['generation']+'-%02d'%item['blockIndex']
def claimed_generation(ctl,config,item,now):
 op=operation_id(item);key='direct-owner-generation#'+op
 present=readrow(ctl,key)
 if present:
  need(present.get('transportSha256')==item['transport']['sha256'],'Generation cannot be rebound')
  return present,False
 old=item['originalBlock'];parent=item['originalClaim'];unit='unit#'+old['unitId'];current=readrow(ctl,unit);block=readrow(ctl,old['pk']);resource=readrow(ctl,'resource#'+old['resourceAttemptId'])
 need(current and current['attemptId']==parent['attemptId']and current.get('permanent')is True,'Original permanent owner')
 need(current.get('status')in('claimed','running')and current.get('directExecutionCompleted')is not True,'Closed parent cannot dispatch')
 need(block and block.get('status')=='completed-unvalidated-runtime-failure','Only explicit terminal pre-dispatch predecessor')
 for k in('attemptId','unitId','resourceAttemptId','blockIndex','runIds'):need(block.get(k)==old[k],'Original block '+k)
 need(resource and resource.get('attemptId')==old['resourceAttemptId'],'Same allocated resource')
 need(resource.get('retirementAuthorized')is not True and resource.get('reservationReleased')is not True and resource.get('evidence',{}).get('reservationReleased')is not True,'Resource released/retiring')
 resource_owner=resource.get('scientificUnitAttemptId');need(resource_owner in(None,parent['attemptId']),'Resource belongs to a different current assignment')
 lease='hardDeadline'if 'hardDeadline'in resource else 'deadline';need(min(DEADLINE,float(resource[lease]))>now+6300,'Finite resource runway')
 journal=readrow(ctl,'journal#sole-owner');need(journal and journal.get('attemptId')=='execution-budget-rpc-production01-run01'and journal.get('operationalState')=='ready-original-backend-single-writer','Original RPC owner is not accepting clients')
 for p in item['priorDrain']:drained(ctl,p)
 need(current['inputSha256']==config['canonicalParent']['inputSha256'] and current['sourceCommit']==config['canonicalParent']['sourceCommit'] and current['originalRunIds']==parent['originalRunIds'],'Exact existing canonical scientific input and ordered runs')
 parent_eq={k:current[k]for k in('attemptId','inputSha256','sourceCommit','originalRunIds','permanent','validationStatus','status')}
 need(parent_eq['validationStatus']=='unvalidated'and current.get('scientificAcceptanceAsserted')is False,'No accepted-science claim')
 row={'pk':key,'operationId':op,'attemptId':parent['attemptId'],'unitId':old['unitId'],'generation':item['generation'],'blockIndex':item['blockIndex'],'runIds':old['runIds'],'resourceAttemptId':old['resourceAttemptId'],'transportSha256':item['transport']['sha256'],'phase':'publication-intent','claimedAt':int(now),'hardDeadline':DEADLINE,'scientificAcceptanceAsserted':False,'validationStatus':'unvalidated','originalCanonicalPredecessorRetained':True,'reservationAllocatedByController':False}
 expression,n,v=eq({k:block[k]for k in('attemptId','unitId','resourceAttemptId','blockIndex','runIds','status')})
 n['#gen']='directOperationalGeneration';expression+=' AND attribute_not_exists(#gen)';v[':gen']=encoded({'operationId':op,'generation':item['generation'],'transportSha256':item['transport']['sha256']})
 actions=[
 condition(ctl,'coordinator',{'controllerSourceSha256':ctl.controller_source_sha256,'directPublicationOwnerToken':config['publicationOwnerToken'],'executionEnabled':True,'stopRequested':False},('hardDeadline>:now',{}, {':now':{'N':str(int(now))}})),
 condition(ctl,'coordinator#capacity-v1',{'stopRequested':False,'studyComplete':False}),
 condition(ctl,'journal#sole-owner',{'attemptId':'execution-budget-rpc-production01-run01','operationalState':'ready-original-backend-single-writer'}),
 condition(ctl,unit,parent_eq,('(attribute_not_exists(directExecutionCompleted) OR directExecutionCompleted=:no)',{}, {':no':{'BOOL':False}})),
 condition(ctl,'resource#'+old['resourceAttemptId'],{'attemptId':old['resourceAttemptId'],lease:resource[lease]},(('scientificUnitAttemptId=:owner AND ' if resource_owner else 'attribute_not_exists(scientificUnitAttemptId) AND ')+'(attribute_not_exists(retirementAuthorized) OR retirementAuthorized=:no) AND (attribute_not_exists(reservationReleased) OR reservationReleased=:no) AND (attribute_not_exists(evidence.reservationReleased) OR evidence.reservationReleased=:no)',{}, dict({':no':{'BOOL':False}},**({':owner':{'S':resource_owner}}if resource_owner else {})))),
 {'Update':{'TableName':ctl.claims.table,'Key':{'pk':{'S':old['pk']}},'ConditionExpression':expression,'UpdateExpression':'SET #gen=:gen','ExpressionAttributeNames':n,'ExpressionAttributeValues':v}},
 {'Put':{'TableName':ctl.claims.table,'Item':{k:encoded(v)for k,v in row.items()},'ConditionExpression':'attribute_not_exists(pk)'}}]
 ctl.claims.ddb.transact_write_items(TransactItems=actions,ClientRequestToken=sha(op.encode())[:36])
 return row,True
def update(ctl,item,phase,extra):
 op=operation_id(item);v={':phase':{'S':phase},':extra':encoded(extra),':sha':{'S':item['transport']['sha256']}}
 ctl.claims.ddb.update_item(TableName=ctl.claims.table,Key={'pk':{'S':'direct-owner-generation#'+op}},ConditionExpression='transportSha256=:sha',UpdateExpression='SET #phase=:phase, observation=:extra',ExpressionAttributeNames={'#phase':'phase'},ExpressionAttributeValues=v)
def discover_terminal(ctl,config,item,now):
 folder=Path(config['stateDirectory'])/operation_id(item);folder.mkdir(parents=True,exist_ok=True)
 cache=folder/'terminal-probe.json'
 if cache.exists()and now-json.loads(cache.read_text())['at']<60:return None
 cache.write_text(json.dumps({'at':now}))
 t=json.loads(checked(item['transport']));target=item['originalBlock']['resourceAttemptId']
 import importlib.util
 rr=config['outputResolver'];checked(rr);spec=importlib.util.spec_from_file_location('actual_owner_output_resolver',rr['path']);resolver=importlib.util.module_from_spec(spec);spec.loader.exec_module(resolver)
 bound=resolver.from_transport(item['transport']);need(bound['resourceAttemptId']==target and bound['blockIndex']==item['blockIndex'],'Exact source-derived output identity');prefix=bound['prefix']
 listed=ctl.store.s3.list_objects_v2(Bucket=ctl.store.bucket,Prefix=prefix,MaxKeys=2)
 rows=listed.get('Contents',[])
 if not rows:return None
 need(len(rows)==1 and not listed.get('IsTruncated'),'Ambiguous generation terminal index')
 key=rows[0]['Key'];q=ctl.store.s3.get_object(Bucket=ctl.store.bucket,Key=key);b=q['Body'].read(8*1024*1024+1)
 need(len(b)<=8*1024*1024 and q.get('VersionId')not in(None,'','null'),'Bounded immutable terminal')
 need(key.endswith(sha(b)+'.json'),'Content-addressed terminal index');x=json.loads(b)
 need(x['resourceAttemptId']==target and x['blockIndex']==item['blockIndex'],'Exact terminal child')
 if t.get('ownerProducerBinding'):
  need(x.get('contract',{}).get('sha256')==t['contract']['sha256'],'Exact owner successor terminal contract')
  claimed=proof(ctl,x['claim']);need(claimed['claim']['attemptId']==t['attemptId']and claimed['block']['runIds']==t['runIds'],'Exact existing parent and ordered runs')
 elif 'claim'in x:need(x['claim']==t['claimProjection'],'Exact terminal generation claim')
 else:
  refs=[r for r in x['files']if r['path'].endswith('/ISSUE-INTENT.json')]
  need(len(refs)==1,'Exact EC2 stage intent');intent=proof(ctl,refs[0]);need(intent['claimRef']==t['claimProjection'],'Exact EC2 terminal generation claim')
 state=x['unitState'];need('MainPID=0'in state and any(s in state for s in('ActiveState=inactive','ActiveState=failed')),'Owner process not physically closed')
 return {'ref':{'bucket':ctl.store.bucket,'key':key,'versionId':q['VersionId'],'sha256':sha(b),'bytes':len(b)},'outcomeRows':x.get('outcomeRows'),'summary':x.get('summary'),'transportExitCode':x.get('transportExitCode',x.get('commandExitCode')),'allChildrenDrained':True,'accepted':False}

def reconcile(ctl,config,item,adapter,now,allow_dispatch):
 op=operation_id(item);old=readrow(ctl,'direct-owner-generation#'+op)
 if old:
  need(old.get('transportSha256')==item['transport']['sha256'],'Existing operation binding')
  retained=old.get('observed')
  if old.get('phase')=='terminal'and old.get('executionClosed')is True and retained and retained.get('allChildrenDrained')is True:
   return {'operationId':op,'state':'terminal-owner-evidence-adopted','evidence':retained['ref'],'scientificAcceptanceAsserted':False}
  observed=discover_terminal(ctl,config,item,now)
  if observed:
   update(ctl,item,'terminal',{'executionClosed':True,'observed':observed,'scientificAcceptanceAsserted':False})
   return {'operationId':op,'state':'terminal-adopted','evidence':observed['ref'],'scientificAcceptanceAsserted':False}
  if item.get('terminalEvidence'):
   terminal=drained(ctl,item['terminalEvidence'])
   update(ctl,item,'terminal',{'executionClosed':True,'source':item['terminalEvidence']['ref'],'scientificAcceptanceAsserted':False})
   return {'operationId':op,'state':'terminal-adopted','scientificAcceptanceAsserted':False}
  return {'operationId':op,'state':old['phase'],'automaticRetry':False}
 # An earlier exact owner continuation always takes precedence, even when
 # ROOT has not created its own auxiliary operation row.
 observed=discover_terminal(ctl,config,item,now)
 if observed:return {'operationId':op,'state':'existing-owner-terminal-adopted-no-send','evidence':observed['ref'],'scientificAcceptanceAsserted':False}
 # Packaging does not authorize any new hosted call.
 if config.get('holdNewHostedDispatch',True):return {'operationId':op,'state':'pending-hosted-funding'}
 if not config.get('publicationOwnershipEstablished',False):return {'operationId':op,'state':'awaiting-explicit-owner-publication-handoff'}
 if not allow_dispatch or now+6300>=DEADLINE:return {'operationId':op,'state':'stop-or-finite-runway'}
 row,created=claimed_generation(ctl,config,item,now)
 if not created:return {'operationId':op,'state':'existing-generation-adopted-no-send'}
 folder=Path(config['stateDirectory'])/op;folder.mkdir(parents=True,exist_ok=True)
 marker=folder/'publication-attempted.json'
 with marker.open('xb')as f:f.write(json.dumps({'transport':item['transport'],'operationId':op}).encode());f.flush();os.fsync(f.fileno())
 fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 # Native call acquires CAPACITY's existing mailbox lock and exact prior-version
 # CAS. EC2 call sends the original stage/run/collect body once, with finite timeout.
 result=adapter.publish_transport(ctl,item['transport'],now)
 rr=ctl.store.put('state/direct-owner-generations/'+op+'/publication.json',{'operationId':op,'transport':item['transport'],'result':result,'issuedAt':int(now),'accepted':False})
 update(ctl,item,'issued',{'publication':rr,'scientificAcceptanceAsserted':False})
 return {'operationId':op,'state':'issued','receipt':rr,'scientificAcceptanceAsserted':False}
def tick(ctl,config,now,allow_dispatch=True):
 import importlib.util
 r=config['adapter'];checked(r);s=importlib.util.spec_from_file_location('owner_generation_adapter',r['path']);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
 cache=Path(config['outputDirectory'])/'EMITTED.json'
 if cache.exists():
  bundle=json.loads(cache.read_text());need(bundle['batch']==config['batch']and bundle['lineage']==config['lineage'],'Immutable producer inputs');items=bundle['operations']
 else:
  items=a.build(ctl,config)
  for item in items:
   item['generation']=json.loads(a.checked(config['lineage']))['generation'];item['priorDrain']=config['priorDrain'][str(item['blockIndex'])]
  a.save(cache,{'kind':'goalspec-owner-generation-descriptors-v1','batch':config['batch'],'lineage':config['lineage'],'operations':items,'financialWritesPerformed':False,'scientificAcceptanceAsserted':False})
 reports=[]
 for item in items:
  try:reports.append(reconcile(ctl,config,item,a,now,allow_dispatch))
  except Exception as e:reports.append({'operationId':operation_id(item),'state':'retained-error-no-retry','errorType':type(e).__name__,'error':str(e),'automaticRetry':False})
 return {'kind':'goalspec-owner-generation-producer-tick-v1','observedAt':now,'operations':reports,'newHostedDispatchHeld':config.get('holdNewHostedDispatch',True),'ledgerOwner':'execution-budget-rpc-production01-run01','ledgerWritesPerformed':False,'scientificAcceptanceAsserted':False}
