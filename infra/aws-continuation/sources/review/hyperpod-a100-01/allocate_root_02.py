"""Root-only one-shot HyperPod acquisition and autonomous finite cleanup."""
import argparse,hashlib,json,os,time,subprocess,datetime
from pathlib import Path
import boto3
from botocore.config import Config
from boto3.dynamodb.types import TypeSerializer,TypeDeserializer
HERE=Path(__file__).parent;STATE=Path('/srv/acephale/state/hyperpod-a100-01')
TABLE='acephale-aws-20261121';BUCKET=TABLE+'-971290362335';REGION='us-east-1'
ATTEMPT='hyperpod-a100-01';NAME='acephale-hyperpod-a100-01';PK='resource#'+ATTEMPT
STACK='arn:aws:cloudformation:us-east-1:971290362335:stack/acephale-hyperpod-a100-network-01/84de3140-e5ed-11f1-8178-0affd97f998d'
SCIENCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672';GLOBAL=1795837626
CAP=200000000000;HOLD=500000000
UNIT='acephale-preclaim-hyperpod-a100-cleanup.service'
def need(x,m):
 if not x:raise ValueError(m)
def raw(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def typed(x):return {k:TypeSerializer().serialize(v)for k,v in x.items()}
def decode(x):return {k:TypeDeserializer().deserialize(v)for k,v in x.items()}if x else None
def get(db,key):return db.get_item(TableName=TABLE,Key={'pk':{'S':key}},ConsistentRead=True).get('Item')
def checked(ref):
 p=Path(ref['path']);need(p.is_absolute()and p.is_file()and not any(q.is_symlink()for q in(p,*p.parents))and sha(p.read_bytes())==ref['sha256'],'Exact root-approved artifact');return p
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.exists():need(path.read_bytes()==data,'Immutable state differs');return
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def condition(key,row):
 if row is None:return {'TableName':TABLE,'Key':{'pk':{'S':key}},'ConditionExpression':'attribute_not_exists(pk)'}
 names={};vals={};parts=[]
 for i,(k,v)in enumerate(sorted(row.items())):names['#k'+str(i)]=k;vals[':v'+str(i)]=v;parts.append('#k'+str(i)+'=:v'+str(i))
 return {'TableName':TABLE,'Key':{'pk':{'S':key}},'ConditionExpression':' AND '.join(parts),'ExpressionAttributeNames':names,'ExpressionAttributeValues':vals}
def validate(c,now):
 need(c['kind']=='acephale-root-hyperpod-allocation-v1'and c['rootApproved']is True and c['resourceAttemptId']==ATTEMPT,'Explicit root exact allocation')
 need(c['region']==REGION and c['networkStackArn']==STACK and c['reservedMicrousd']==HOLD,'Fixed region/network/gross reservation')
 need(type(c['issuedAt'])is int and type(c['deadline'])is int and c['issuedAt']<c['deadline']<=min(c['issuedAt']+43200,1795413600,GLOBAL),'Fixed <=12h and user deadline')
 q=c['createRequest'];need(q['ClusterName']==NAME and q['NodeRecovery']=='None'and q['Orchestrator']=={'Slurm':{}},'Exact nonrecovering Slurm cluster')
 need(set(q)=={'ClusterName','InstanceGroups','VpcConfig','Orchestrator','NodeRecovery','Tags'},'No automatic scaling/patch/continuous/alternate capacity')
 groups=q['InstanceGroups'];need(len(groups)==2,'Only one head and one GPU host')
 expected=[('controller','ml.c5.xlarge','Controller'),('a100-compute','ml.p4d.24xlarge','Compute')]
 for g,(name,typ,kind)in zip(groups,expected):
  need(g['InstanceGroupName']==name and g['InstanceType']==typ and g['InstanceCount']==1 and g['SlurmConfig']['NodeType']==kind,'Exact fixed host groups')
  need(g['ExecutionRole']=='arn:aws:iam::971290362335:role/AcephaleHyperPodA100Execution01','Exact node role')
  need(set(g)<= {'InstanceGroupName','InstanceType','InstanceCount','ExecutionRole','SlurmConfig','InstanceStorageConfigs','LifeCycleConfig','ImageId'},'No replacement/patch/alternate capacity')
  need(g['LifeCycleConfig']==c['lifecycle'],'Pinned managed OnInitComplete agent')
  need(g['ImageId']=='ami-0b875b649935d7957','Exact observed Amazon HyperPod managed image')
 tags={x['Key']:x['Value']for x in q['Tags']};need(tags['Project']==TABLE and tags['ResourceAttemptId']==ATTEMPT and tags['HardDeadline']==str(c['deadline'])and tags['ScientificDispatchAllowed']=='false','Actual resource authority tags')
 need(c['scientificDispatchAllowed']is False,'Allocation grants no science')
 need(q['VpcConfig']=={'SecurityGroupIds':['sg-09da29843ffd52111'],'Subnets':['subnet-065dcca5edf1e4ba7']},'Exact isolated first AZ network')
 need(c['lifecycle']['SourceS3Uri']=='s3://sagemaker-acephale-hyperpod-971290362335-us-east-1/lifecycle/hyperpod-a100-01/' and c['lifecycle']['OnInitComplete']=='on-init-complete.sh','Exact lifecycle authority prefix')
 for ref in c['files']:checked(ref)
 return c
def reserve(db,c,config_sha):
 old=decode(get(db,PK))
 if old:
  need(old.get('configurationSha256')==config_sha and old.get('reservedMicrousd')==HOLD,'Same permanent resource intent');return old
 coord=get(db,'coordinator');d=decode(coord);need(d and d.get('sourceCommit')==SCIENCE and d.get('executionEnabled')is True and d.get('stopRequested')is False and d.get('hardDeadline')==GLOBAL,'Sole live scientific coordinator')
 gate=get(db,'coordinator#capacity-v1');g=decode(gate);need(g and g.get('studyComplete')is False and g.get('sourceCommit')==SCIENCE and g.get('hardDeadline')==GLOBAL,'Study incomplete')
 claim=get(db,'unit#seed29/replay');cl=decode(claim);need(cl is None or(cl.get('status')=='queued'and 'attemptId'not in cl),'No prior permanent replay assignment')
 r={'pk':PK,'kind':'acephale-hyperpod-capacity-reservation-v1','provider':'sagemaker-hyperpod','attemptId':ATTEMPT,'region':REGION,'clusterName':NAME,'configurationSha256':config_sha,'requestSha256':sha(raw(c['createRequest'])),'reservedMicrousd':HOLD,'deadline':c['deadline'],'createdAt':c['issuedAt'],'status':'reserved','scientificUnitClaimed':False,'sourceCommit':SCIENCE}
 tx=[{'Put':{'TableName':TABLE,'Item':typed(r),'ConditionExpression':'attribute_not_exists(pk)'}},{'Put':{'TableName':TABLE,'Item':typed({'pk':'capacity#hyperpod-intent#seed29/replay','resourceAttemptId':ATTEMPT,'configurationSha256':config_sha,'automaticRetry':False,'scientificClaimCreated':False}),'ConditionExpression':'attribute_not_exists(pk)'}},
 {'Update':{'TableName':TABLE,'Key':{'pk':{'S':'budget'}},'UpdateExpression':'ADD reservedMicrousd :a','ConditionExpression':'attribute_exists(pk) AND creditLimitMicrousd=:limit AND legacyHoldsReleased=:false AND reservedMicrousd<=:room','ExpressionAttributeValues':typed({':a':HOLD,':limit':CAP,':false':False,':room':CAP-HOLD})}},
 {'Update':{'TableName':TABLE,'Key':{'pk':{'S':'capacity#reservation-total-v1'}},'UpdateExpression':'ADD reservedMicrousd :a','ConditionExpression':'attribute_not_exists(reservedMicrousd) OR reservedMicrousd<=:room','ExpressionAttributeValues':typed({':a':HOLD,':room':CAP-HOLD})}},
 *[{'ConditionCheck':condition(k,v)}for k,v in [('coordinator',coord),('coordinator#capacity-v1',gate),('unit#seed29/replay',claim)]]]
 db.transact_write_items(TransactItems=tx,ClientRequestToken=config_sha[:32]);return r
def ensure_schedule(scheduler,c):
 expected=c['cleanupSchedule'];need(expected['ScheduleExpression']=='at('+datetime.datetime.fromtimestamp(c['deadline'],datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')+')' and expected['Target']['RoleArn']=='arn:aws:iam::971290362335:role/AcephaleHyperPodA100Cleanup01','Cleanup exact fixed deadline and role');need(json.loads(expected['Target']['Input'])=={'ClusterName':NAME},'Exact valid JSON cleanup target')
 need(expected['Target']['Arn']=='arn:aws:scheduler:::aws-sdk:sagemaker:deleteCluster'and expected['State']=='ENABLED'and expected['FlexibleTimeWindow']=={'Mode':'OFF'},'Independent enabled hard delete')
 try:actual=scheduler.get_schedule(Name=expected['Name'],GroupName='default')
 except scheduler.exceptions.ResourceNotFoundException:
  scheduler.create_schedule(**expected);actual=scheduler.get_schedule(Name=expected['Name'],GroupName='default')
 for k in ('ScheduleExpression','ScheduleExpressionTimezone','Target','State','FlexibleTimeWindow','ActionAfterCompletion'):need(actual[k]==expected[k],'Actual independent cleanup schedule differs: '+k)
 return actual
def observe(sm,c):
 try:x=sm.describe_cluster(ClusterName=NAME)
 except sm.exceptions.ClientError as e:
  if e.response['Error']['Code']in('ResourceNotFound','ResourceNotFoundException'):return None
  raise
 need(x['ClusterName']==NAME,'Exact named cluster')
 tags={z['Key']:z['Value']for z in sm.list_tags(ResourceArn=x['ClusterArn'])['Tags']}
 need(tags.get('Project')==TABLE and tags.get('ResourceAttemptId')==ATTEMPT and tags.get('HardDeadline')==str(c['deadline']),'Actual provider cluster belongs to exact attempt')
 expected={g['InstanceGroupName']:(g['InstanceType'],g['InstanceCount'])for g in c['createRequest']['InstanceGroups']}
 need({g['InstanceGroupName']:(g['InstanceType'],g['TargetCount'])for g in x['InstanceGroups']}==expected,'Actual fixed whole-host group identities')
 return x
def allocate(clients,c,config_sha,path):
 validate(c,time.time());need(time.time()+10800<c['deadline'],'At least original3h bootstrap remains')
 db=clients['dynamodb'];sm=clients['sagemaker']
 from botocore.validate import validate_parameters
 validate_parameters(c['createRequest'],sm.meta.service_model.operation_model('CreateCluster').input_shape)
 r=reserve(db,c,config_sha)
 lifecycle_file=checked(c['lifecycleSource']);payload=lifecycle_file.read_bytes();lc=c['lifecycle'];bucket,key=lc['SourceS3Uri'][5:].split('/',1);key=key.rstrip('/')+'/'+lc['OnInitComplete']
 try:clients['s3'].put_object(Bucket=bucket,Key=key,Body=payload,IfNoneMatch='*',ChecksumAlgorithm='SHA256')
 except clients['s3'].exceptions.ClientError as e:
  if e.response['Error']['Code']not in('PreconditionFailed','412'):raise
 actual=clients['s3'].get_object(Bucket=bucket,Key=key);need(sha(actual['Body'].read())==c['lifecycleSource']['sha256'],'Actual immutable lifecycle bytes before create')
 ensure_schedule(clients['scheduler'],c)
 need(subprocess.run(['systemctl','is-active','--quiet',UNIT]).returncode==0,'Autonomous cluster/network cleanup installed and active before create')
 stack=clients['cloudformation'].describe_stacks(StackName=STACK)['Stacks'][0];need(stack['StackStatus']=='CREATE_COMPLETE','Actual isolated network available')
 if r['status']!='reserved':return {'status':'existing-permanent-intent','provider':observe(sm,c),'automaticCreateRetry':False}
 need(observe(sm,c)is None,'No preexisting same-name cluster')
 # This permanent state is written BEFORE the one non-idempotent provider call.
 db.update_item(TableName=TABLE,Key={'pk':{'S':PK}},UpdateExpression='SET #s=:sub, createSubmittedAt=:now',ConditionExpression='#s=:reserved AND configurationSha256=:sha',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues=typed({':sub':'create-submitting',':now':int(time.time()),':reserved':'reserved',':sha':config_sha}))
 try:
  out=sm.create_cluster(**c['createRequest'])
 except Exception as error:
  write(STATE/'create-uncertain-02.json',raw({'kind':'acephale-hyperpod-create-uncertain-v1','errorType':type(error).__name__,'message':str(error)[:2000],'automaticRetry':False}))
  raise
 db.update_item(TableName=TABLE,Key={'pk':{'S':PK}},UpdateExpression='SET #s=:state, clusterArn=:arn',ConditionExpression='configurationSha256=:sha AND #s=:sub',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues=typed({':state':'creating',':arn':out['ClusterArn'],':sha':config_sha,':sub':'create-submitting'}))
 write(STATE/'create-result.json',raw(out));return out
def watch(clients,c):
 validate(c,time.time());s3=clients['s3'];sm=clients['sagemaker'];cf=clients['cloudformation']
 while True:
  now=int(time.time())
  try:
   node=observe(sm,c);row={'observedAt':now,'cluster':node,'deadline':c['deadline'],'region':REGION}
   if now>=c['deadline']:
    if node is not None:
     if node['ClusterStatus']!='Deleting':row['deleteRequested']=sm.delete_cluster(ClusterName=NAME)
    else:
     try:stack=cf.describe_stacks(StackName=STACK)['Stacks'][0]
     except cf.exceptions.ClientError as e:
      if 'does not exist'in str(e):stack=None
      else:raise
     if stack is None or stack['StackStatus']=='DELETE_COMPLETE':
      row['clusterAbsent']=True;row['networkAbsent']=True
      s3.put_object(Bucket=BUCKET,Key='workers/'+ATTEMPT+'/cleanup-complete.json',Body=raw(row),ChecksumAlgorithm='SHA256');return
     need(stack['StackId']==STACK,'Exact isolated network identity')
     if stack['StackStatus']!='DELETE_IN_PROGRESS':row['networkDeleteRequested']=cf.delete_stack(StackName=STACK)
   s3.put_object(Bucket=BUCKET,Key='workers/'+ATTEMPT+'/lifecycle/'+str(now)+'.json',Body=json.dumps(row,default=str,sort_keys=True).encode(),ChecksumAlgorithm='SHA256')
  except Exception as e:print(json.dumps({'observedAt':now,'errorType':type(e).__name__,'message':str(e)[:2000]}),flush=True)
  time.sleep(30)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--configuration',required=True);ap.add_argument('--sha256',required=True);ap.add_argument('--mode',choices=['check','reserve','allocate','watch'],required=True);a=ap.parse_args()
 need(os.geteuid()==0,'Root controller operation only');p=Path(a.configuration);need(sha(p.read_bytes())==a.sha256,'Exact root approved configuration');c=validate(json.loads(p.read_text()),time.time())
 session=boto3.Session(region_name=REGION);clients={n:session.client(n,config=Config(retries={'total_max_attempts':1},connect_timeout=10,read_timeout=60))for n in('dynamodb','sagemaker','scheduler','cloudformation','s3')}
 if a.mode=='check':print(json.dumps({'checked':True,'provider':observe(clients['sagemaker'],c)},default=str))
 elif a.mode=='reserve':print(json.dumps(reserve(clients['dynamodb'],c,a.sha256),default=str))
 elif a.mode=='allocate':print(json.dumps(allocate(clients,c,a.sha256,p),default=str))
 else:watch(clients,c)
if __name__=='__main__':main()
