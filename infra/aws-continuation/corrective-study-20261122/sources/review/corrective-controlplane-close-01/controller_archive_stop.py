"""Exact controller archive/self-stop callable. Import and validation have no cloud side effects."""
import argparse,fcntl,hashlib,json,os,pathlib,subprocess,time
BUCKET='REQUIRED_BINDINGS_ARTIFACT_BUCKET'
INSTANCE='REQUIRED_BINDINGS_INSTANCE'
VOLUME='REQUIRED_BINDINGS_STORAGE'
PROJECT='acephale-aws-20261121'
BASE=pathlib.Path('/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-controlplane-close-01')
PREFIX='audit/parallel-rescue-20261121/ROOT/corrective-controlplane-close-01/'
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),default=str)+'\n').encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def validate(ref,v,now):
 need(isinstance(ref.get('sha256'),str) and len(ref['sha256'])==64,'exact byte-pinned drained receipt; raw bytes verified by fetch')
 need(v.get('kind')=='root-corrective-controlplane-drained-exported-v1','genuine drained receipt kind')
 need(v.get('controllerInstanceId')==INSTANCE and v.get('controllerVolumeId')==VOLUME,'exact controller target')
 need(all(v.get(x)is True for x in ['controllerDrained','rpcDrained','exportsVerified']),'actual drain/export flags')
 need(isinstance(v.get('earliestFinalStopAt'),(int,float)),'explicit earliest stop')
 need(now>=v['earliestFinalStopAt'],'final stop window not yet eligible')
 need(v.get('generation')=='corrective-20261122-01'and v.get('earlyStopAuthorizedByRoot')is True and isinstance(v.get('rootFinalPublicationMarker'),dict),'fresh corrective ROOT publication authority required')
 for key in ['exportManifest','rpcTerminal','rpcCheckpoint']:
  need(isinstance(v.get(key),dict),'missing genuine '+key)
 need(isinstance(v.get('cleanupMarkers'),list)and len(v['cleanupMarkers'])==4,'exact four cleanup completion refs')
 need(v.get('studyNamespaceArchive',{}).get('complete')is True and v['studyNamespaceArchive'].get('readbackVerified')is True and v['studyNamespaceArchive'].get('unchangedDuringArchive')is True,'private complete study namespace archive')
 need(v.get('efsRootCoverage',{}).get('policyRestored')is True and v['efsRootCoverage'].get('temporaryAccessRemoved')is True,'temporary EFS access fully restored')
 need(len(v.get('currentResourceCompletions',[]))==2,'exact current resource retirement proofs')
 return v
def run(drained_ref,snapshot_timeout=3600):
 import boto3
 s3=boto3.client('s3');ec2=boto3.client('ec2',region_name='us-east-1')
 def fetch(ref):
  need(ref.get('bucket')==BUCKET and all(ref.get(x)for x in ['key','versionId','sha256']),'exact immutable FileRef')
  z=s3.get_object(Bucket=BUCKET,Key=ref['key'],VersionId=ref['versionId'])['Body'].read()
  need(sha(z)==ref['sha256'] and len(z)==int(ref.get('bytes',len(z))),'artifact byte/hash binding');return z
 def verify_stream(ref):
  need(ref.get('bucket')==BUCKET and all(ref.get(x)for x in ['key','versionId','sha256']),'exact immutable archive ref')
  body=s3.get_object(Bucket=BUCKET,Key=ref['key'],VersionId=ref['versionId'])['Body'];h=hashlib.sha256();n=0
  for chunk in iter(lambda:body.read(1048576),b''):h.update(chunk);n+=len(chunk)
  need(h.hexdigest()==ref['sha256']and n==ref['bytes'],'archive streamed version/hash verification')
 z=fetch(drained_ref);v=json.loads(z);validate(drained_ref,v,time.time())
 for key in ['exportManifest','rpcTerminal','rpcCheckpoint']:fetch(v[key])
 authority=json.loads(fetch(v['rootFinalPublicationMarker']))
 need(authority.get('kind')=='root-corrective-final-publication-ready-v1'and authority.get('generation')=='corrective-20261122-01'and authority.get('publicationComplete')is True and authority.get('shutdownAuthorized')is True and authority.get('scientificAcceptanceAsserted')is False,'actual current ROOT authority')
 for key in ('archive','manifest'):verify_stream(v['studyNamespaceArchive'][key])
 fetch(v['efsRootCoverage']['proof'])
 markers=[json.loads(fetch(r))for r in v['cleanupMarkers']]
 need(any(m.get('originalVolumesAbsent')==12 and m.get('instancesTerminated')==12 and m.get('encryptedWholeDiskArchivesRetained')==12 for m in markers),'actual idle12 retirement')
 need(any(m.get('observedAbsentCount')==18 and m.get('originalRequestedCount')==18 for m in markers),'actual Notebook18 absence')
 need(any(m.get('retired')==2 and m.get('snapshotsRetained')==2 and m.get('controllerAndRPCPreserved')is True for m in markers),'actual heldout2 retirement')
 need(any(m.get('kind')=='acephale-corrective-two-resource-retirement-complete-v1'and m.get('snapshotsRetained')==2 and m.get('controllerAndRpcUntouched')is True and m.get('budgetHoldsAndAcceptanceUnchanged')is True for m in markers),'actual current two-resource completion')
 for r in v['currentResourceCompletions']:
  m=json.loads(fetch(r));need(m.get('encryptedArchiveRetained')is True and m.get('originalInstanceTerminated')is True and m.get('originalVolumeAbsent')is True,'actual current encrypted disk retirement')
 root=BASE/'runs'/drained_ref['sha256'];root.mkdir(parents=True,exist_ok=True)
 lock=open(root/'exclusive.lock','a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def publish(name,value):
  p=root/name;rp=root/(name+'.ref.json')
  if p.exists():need(rp.exists(),'ambiguous unpublished intent');return json.loads(rp.read_text())
  b=raw(value)
  with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
  key=PREFIX+'objects/'+sha(b)+'/'+name;r=s3.put_object(Bucket=BUCKET,Key=key,Body=b,ContentType='application/json')
  out=dict(bucket=BUCKET,key=key,versionId=r['VersionId'],sha256=sha(b),bytes=len(b));rp.write_bytes(raw(out));return out
 def state():
  i=ec2.describe_instances(InstanceIds=[INSTANCE])['Reservations'][0]['Instances'][0]
  tags={x['Key']:x['Value']for x in i.get('Tags',[])}
  need(tags.get('Project')==PROJECT,'controller provider project')
  need([x['Ebs']['VolumeId']for x in i['BlockDeviceMappings']]==[VOLUME],'exact controller attached disk')
  return i
 def drained_units():
  for unit in ['acephale-continuation-controller.service','goalspec-budget-rpc-production01.service']:
   p=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ControlPID','-p','ActiveState'],check=True,text=True,capture_output=True)
   q=dict(x.split('=',1)for x in p.stdout.splitlines()if'='in x)
   need(q.get('MainPID')=='0' and q.get('ControlPID','0')=='0' and q.get('ActiveState')in ['inactive','failed'],'physical controller/RPC drain before archive')
 try:
  state();drained_units();volume=ec2.describe_volumes(VolumeIds=[VOLUME])['Volumes'][0]
  need(volume['Encrypted']is True and len(volume['Attachments'])==1 and volume['Attachments'][0]['InstanceId']==INSTANCE,'encrypted controller disk attachment')
  if(root/'SNAPSHOT-RESPONSE.json').exists():snapshot=json.loads((root/'SNAPSHOT-RESPONSE.json').read_text())
  else:
   hits=ec2.describe_snapshots(OwnerIds=['self'],Filters=[{'Name':'tag:SourceVolumeId','Values':[VOLUME]},{'Name':'tag:ControlplaneDrainSha256','Values':[drained_ref['sha256']]}])['Snapshots']
   need(len(hits)<=1,'one exact archive')
   if hits:snapshot=hits[0]
   else:
    need(not(root/'SNAPSHOT-INTENT.json').exists(),'ambiguous existing create must be adopted, never resubmitted')
    publish('SNAPSHOT-INTENT.json',dict(at=time.time(),drained=drained_ref,instanceId=INSTANCE,volumeId=VOLUME,retention='preserve until explicit evidence-retention decision'))
    os.sync()
    snapshot=ec2.create_snapshot(VolumeId=VOLUME,Description='Preserved final Acephale controller journal/source/evidence',TagSpecifications=[{'ResourceType':'snapshot','Tags':[{'Key':'Project','Value':PROJECT},{'Key':'ArchivePurpose','Value':'retained-whole-disk-evidence'},{'Key':'SourceVolumeId','Value':VOLUME},{'Key':'SourceInstanceId','Value':INSTANCE},{'Key':'ControlplaneDrainSha256','Value':drained_ref['sha256']}]}])
   publish('SNAPSHOT-RESPONSE.json',snapshot)
  end=time.time()+snapshot_timeout
  while time.time()<end:
   snap=ec2.describe_snapshots(SnapshotIds=[snapshot['SnapshotId']])['Snapshots'][0]
   tags={x['Key']:x['Value']for x in snap.get('Tags',[])}
   need(snap['VolumeId']==VOLUME and snap['Encrypted']is True and snap['OwnerId']=='REQUIRED_BINDINGS_ACCOUNT' and tags.get('ControlplaneDrainSha256')==drained_ref['sha256'],'exact encrypted archive')
   need(snap['State']!='error','archive error preserves running controller')
   if snap['State']=='completed':break
   time.sleep(30)  # Own exclusive intent lock only; no controller, allocator, or ledger lock.
  else:raise RuntimeError('Archive wait expired; controller retained')
  archived=publish('ARCHIVE-COMPLETED.json',dict(at=time.time(),snapshot=snap,drained=drained_ref,retained=True))
  drained_units();i=state();need(i['State']['Name']in ['running','pending','stopping','stopped'],'reversible stop state')
  if(root/'STOP-RESPONSE.json').exists():return json.loads((root/'STOP-RESPONSE.json.ref.json').read_text())
  if i['State']['Name']in ['stopping','stopped']:
   need((root/'STOP-INTENT.json').exists(),'only adopt own prior stop');response={'adoptedState':i['State']['Name']}
  else:
   need(not(root/'STOP-INTENT.json').exists(),'ambiguous own stop intent requires external adoption')
   publish('STOP-INTENT.json',dict(at=time.time(),instanceId=INSTANCE,drained=drained_ref,archive=archived,stopOnly=True,terminateOrDeletePermitted=False))
   response=ec2.stop_instances(InstanceIds=[INSTANCE])
  return publish('STOP-RESPONSE.json',dict(at=time.time(),response=response,stopOnly=True,physicalStopMustBeObservedExternally=True))
 finally:fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--drained-ref-json',required=True)
 args=parser.parse_args();print(json.dumps(run(json.loads(pathlib.Path(args.drained_ref_json).read_text()))),flush=True)
