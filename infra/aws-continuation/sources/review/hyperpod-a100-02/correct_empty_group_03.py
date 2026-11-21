"""Exact empty P4de-group AZ correction; no new reservation or lease."""
import argparse,copy,hashlib,importlib.util,json,os,time
from pathlib import Path
import boto3
from botocore.config import Config
from botocore.validate import validate_parameters
ROOT=Path('/srv/acephale/workspaces/review/hyperpod-a100-02')
PARENT=ROOT/'allocate_root_02.py'
assert hashlib.sha256(PARENT.read_bytes()).hexdigest()=='0d1503b6e30126e4631d62d527cc94f3e060ef091087b69f34b14bbc354526c2'
sp=importlib.util.spec_from_file_location('original_allocate02',PARENT);parent=importlib.util.module_from_spec(sp);sp.loader.exec_module(parent)
ARN='arn:aws:sagemaker:us-east-1:971290362335:cluster/kr3n9vgo9x49'
ATTEMPT=parent.ATTEMPT;NAME=parent.NAME;validate=parent.validate
OLD='a10080-compute';NEW='a10080-compute-1c'
VPC={'SecurityGroupIds':['sg-09da29843ffd52111'],'Subnets':['subnet-0445902310e7f971d']}
CONFIG_SHA='fd91ee9a7ea7ccdf8da1d0bdf9bf6b1f1ed1c2df40e785db72504f2a6615d66f'
def need(x,m):
 if not x:raise ValueError(m)
def raw(x):return (json.dumps(x,sort_keys=True,default=str,allow_nan=False)+'\n').encode()
def observe(sm,c):
 try:x=sm.describe_cluster(ClusterName=NAME)
 except sm.exceptions.ClientError as e:
  if e.response['Error']['Code']in('ResourceNotFound','ResourceNotFoundException'):return None
  raise
 need(x['ClusterName']==NAME and x['ClusterArn']==ARN,'Exact original cluster')
 tags={z['Key']:z['Value']for z in sm.list_tags(ResourceArn=ARN)['Tags']}
 need(tags.get('Project')==parent.TABLE and tags.get('ResourceAttemptId')==ATTEMPT and tags.get('HardDeadline')==str(c['deadline']),'Original provider authority')
 groups={g['InstanceGroupName']:(g['InstanceType'],g['TargetCount'])for g in x['InstanceGroups']}
 head={'controller':('ml.c5.xlarge',1)}
 need(groups in [dict(head,**{OLD:('ml.p4de.24xlarge',1)}),dict(head,**{OLD:('ml.p4de.24xlarge',0)}),head,dict(head,**{NEW:('ml.p4de.24xlarge',1)})],'Only original, empty transition, or exact replacement; never both compute groups')
 for g in x['InstanceGroups']:
  need(g['ExecutionRole']==c['createRequest']['InstanceGroups'][0]['ExecutionRole'] and g['CurrentImageId']=='ami-0b875b649935d7957' and g['LifeCycleConfig']==c['lifecycle'],'Unchanged role/image/lifecycle')
  if g['InstanceGroupName']==NEW:need(g.get('OverrideVpcConfig')==VPC,'Exact corrected group private AZ')
 return x
def nodes(sm):
 r=sm.list_cluster_nodes(ClusterName=ARN)
 need(not r.get('NextToken'),'Unexpected node inventory pagination')
 return r['ClusterNodeSummaries']
def request_for(mode,c):
 if mode=='remove':return {'ClusterName':ARN,'InstanceGroupsToDelete':[OLD]}
 g=copy.deepcopy(c['createRequest']['InstanceGroups'][1]);g['InstanceGroupName']=NEW;g['OverrideVpcConfig']=VPC
 return {'ClusterName':ARN,'InstanceGroups':[g]}
def guarded(sm,c,mode):
 x=observe(sm,c);need(x is not None and x['ClusterStatus']=='InService','Stable InService before group mutation')
 ns=nodes(sm);need(len(ns)==1 and ns[0]['InstanceGroupName']=='controller' and ns[0]['InstanceId']=='i-05a41f2a83544097b' and ns[0]['InstanceStatus']['Status']=='Running','Only exact retained head; no compute Pending or Running')
 gs={g['InstanceGroupName']:g for g in x['InstanceGroups']}
 if mode=='remove':need(set(gs)=={'controller',OLD} and gs[OLD]['CurrentCount']==0 and gs[OLD]['TargetCount']==1,'Original empty group only')
 else:need(set(gs)=={'controller'} and not any(n['InstanceGroupName']!= 'controller' for n in ns),'Old group removed and all pending compute absent')
 return x,ns
def execute(mode):
 cfgpath=ROOT/'allocation-02.json';need(hashlib.sha256(cfgpath.read_bytes()).hexdigest()==CONFIG_SHA,'Immutable original allocation')
 c=validate(json.loads(cfgpath.read_text()),time.time());need(time.time()+10800<c['deadline'],'Same original bootstrap runway')
 sess=boto3.Session(region_name='us-east-1');opts=Config(retries={'total_max_attempts':1},connect_timeout=10,read_timeout=60);sm=sess.client('sagemaker',config=opts);db=sess.client('dynamodb',config=opts);s3=sess.client('s3',config=opts)
 need(os.geteuid()==0,'Root only')
 parent.ensure_schedule(sess.client('scheduler',config=opts),c)
 import subprocess
 need(subprocess.run(['systemctl','is-active','--quiet',parent.UNIT]).returncode==0,'Shared cleanup active')
 resource=parent.decode(parent.get(db,parent.PK));need(resource['configurationSha256']==CONFIG_SHA and resource['clusterArn']==ARN and resource['reservedMicrousd']==500000000 and resource['deadline']==c['deadline'] and resource['scientificUnitClaimed'] is False,'Unchanged permanent reservation')
 claim=parent.decode(parent.get(db,'unit#seed29/replay'));need(claim is None or(claim.get('status')=='queued'and 'attemptId'not in claim),'No scientific claim')
 observed,inventory=guarded(sm,c,mode);req=request_for(mode,c);validate_parameters(req,sm.meta.service_model.operation_model('UpdateCluster').input_shape)
 state=Path('/srv/acephale/state/hyperpod-a100-02');intent=state/('az-correction-'+mode+'-intent.json')
 need(not intent.exists(),'Prior mutation intent retained; explicit observation required, never automatic retry')
 evidence={'kind':'acephale-hyperpod-empty-group-az-correction-v1','phase':mode,'observedAt':time.time(),'request':req,'observedCluster':observed,'nodes':inventory,'configurationSha256':CONFIG_SHA,'reservedMicrousdUnchanged':500000000,'deadlineUnchanged':c['deadline'],'scientificClaimCreated':False}
 parent.write(intent,raw(evidence));s3.put_object(Bucket=parent.BUCKET,Key='audit/recovery-publication-review/hyperpod-a100-02/'+intent.name,Body=intent.read_bytes(),IfNoneMatch='*',ChecksumAlgorithm='SHA256')
 result=sm.update_cluster(**req)
 resultpath=state/('az-correction-'+mode+'-result.json');parent.write(resultpath,raw(result));s3.put_object(Bucket=parent.BUCKET,Key='audit/recovery-publication-review/hyperpod-a100-02/'+resultpath.name,Body=resultpath.read_bytes(),IfNoneMatch='*',ChecksumAlgorithm='SHA256');print(json.dumps(result,default=str))
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--phase',choices=['remove','add'],required=True);execute(a.parse_args().phase)
