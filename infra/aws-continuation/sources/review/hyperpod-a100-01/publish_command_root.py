"""Root-only single HyperPod command publication. This is metadata transport, not scientific admission."""
import argparse,hashlib,json,time,os,re
from pathlib import Path
import boto3
from botocore.config import Config
import node_agent as agent
ATTEMPT='hyperpod-a100-01';CLUSTER='acephale-hyperpod-a100-01';ARN='arn:aws:sagemaker:us-east-1:971290362335:cluster/xjn1fiplyh2o';DEADLINE=1795338770
def need(x,m):
 if not x:raise ValueError(m)
def body(x):return(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--node',required=True);ap.add_argument('--sequence',required=True,type=int);ap.add_argument('--command',required=True);ap.add_argument('--sha256',required=True);a=ap.parse_args()
 need(os.geteuid()==0,'Root controller transport only')
 need(re.fullmatch('i-[a-f0-9]{17}',a.node) and 0<a.sequence<100000,'Exact node and finite sequence')
 p=Path(a.command);need(p.is_absolute()and p.is_file()and not any(x.is_symlink()for x in(p,*p.parents)),'Regular root command file')
 payload=p.read_bytes();need(hashlib.sha256(payload).hexdigest()==a.sha256,'Exact reviewed command bytes')
 command=json.loads(payload);session=boto3.Session(region_name='us-east-1');cfg=Config(retries={'total_max_attempts':1},connect_timeout=10,read_timeout=30);sm=session.client('sagemaker',config=cfg);s3=session.client('s3',config=cfg)
 c=sm.describe_cluster(ClusterName=CLUSTER);need(c['ClusterArn']==ARN and c['ClusterStatus']in('Creating','InService'),'Exact live cluster')
 tags={x['Key']:x['Value']for x in sm.list_tags(ResourceArn=ARN)['Tags']};need(tags.get('ResourceAttemptId')==ATTEMPT and tags.get('HardDeadline')==str(DEADLINE),'Exact actual fixed authority')
 n=sm.describe_cluster_node(ClusterName=CLUSTER,NodeId=a.node)['NodeDetails'];need(n['InstanceId']==a.node and n['InstanceType']in('ml.c5.xlarge','ml.p4d.24xlarge'),'Actual provider node identity')
 bootkey='workers/'+ATTEMPT+'/'+a.node+'/boot.json';bootresponse=s3.get_object(Bucket=agent.BUCKET,Key=bootkey);boot=json.loads(bootresponse['Body'].read())
 need(boot['nodeId']==a.node and boot['resourceAttemptId']==ATTEMPT and boot['agentSha256']==hashlib.sha256(Path(agent.__file__).read_bytes()).hexdigest(),'Actual deployed bound node agent')
 prefix='state/'+ATTEMPT+'/commands/'+a.node+'/';key=prefix+f'{a.sequence:05d}.json'
 need(command['sequence']==a.sequence and command['nodeId']==a.node and command['resourceAttemptId']==ATTEMPT,'Exact command identity')
 need(command['timeoutSeconds']+time.time()+30<=DEADLINE,'Command fits fixed resource lease')
 # No overwrite/rebinding: root intentionally publishes one new sequence only.
 r=s3.put_object(Bucket=agent.BUCKET,Key=key,Body=payload,IfNoneMatch='*',ChecksumAlgorithm='SHA256')
 index={'kind':'acephale-hyperpod-node-command-index-v1','resourceAttemptId':ATTEMPT,'nodeId':a.node,'sequence':a.sequence,'deadline':DEADLINE,'command':{'key':key,'sha256':a.sha256,'versionId':r['VersionId']}}
 try:
  previous=s3.get_object(Bucket=agent.BUCKET,Key=prefix+'index.json');old=json.loads(previous['Body'].read())
 except s3.exceptions.ClientError as e:
  if e.response['Error']['Code']not in('NoSuchKey','404'):raise
  previous=None
 if previous:
  need(old['sequence']<a.sequence,'Never rebind/replay a published sequence')
  result=s3.get_object(Bucket=agent.BUCKET,Key='workers/'+ATTEMPT+'/'+a.node+f"/commands/{old['sequence']:05d}/result.json")
  done=json.loads(result['Body'].read());need(done['ownedProcessGroupDrained']is True,'Prior command drained; unknown cannot be superseded')
  result=s3.put_object(Bucket=agent.BUCKET,Key=prefix+'index.json',Body=body(index),IfMatch=previous['ETag'],ChecksumAlgorithm='SHA256')
 else:result=s3.put_object(Bucket=agent.BUCKET,Key=prefix+'index.json',Body=body(index),IfNoneMatch='*',ChecksumAlgorithm='SHA256')
 print(json.dumps({'index':index,'indexVersionId':result['VersionId'],'nodeProviderObservation':n},default=str))
if __name__=='__main__':main()
