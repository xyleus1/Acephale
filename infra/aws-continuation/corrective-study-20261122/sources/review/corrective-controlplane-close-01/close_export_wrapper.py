"""Finite finalizer wrapper. Staging/import never stops services or invokes providers."""
import argparse,fcntl,hashlib,importlib.util,json,os,pathlib,subprocess,tarfile,time,traceback
BASE=pathlib.Path('/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-controlplane-close-01')
BUCKET='REQUIRED_BINDINGS_ARTIFACT_BUCKET'
CONTROLLER='acephale-continuation-controller.service'
RPC='goalspec-budget-rpc-production01.service'
CONTROLLER_LOCK='/REQUIRED_BINDINGS/research-root/state/continuation-controller.lock'
QUEUE=pathlib.Path('/REQUIRED_BINDINGS/research-root/shared/execution-budget-rpc01/production04-corrective')
JOURNAL=pathlib.Path('/REQUIRED_BINDINGS/research-root/shared/budget.jsonl')
FINAL_DEADLINE=1795413600
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),default=str)+'\n').encode()
def digest_file(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def bound(ref):
 p=pathlib.Path(ref['path']);need(p.is_file(),'missing bound source '+str(p));need(digest_file(p)==ref['sha256'] and p.stat().st_size==int(ref['bytes']),'source/config binding changed '+str(p));return p
def module(name,ref):
 p=bound(ref);s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def unit(name):
 z=subprocess.check_output(['systemctl','show',name,'-p','MainPID','-p','ControlPID','-p','ActiveState','-p','InvocationID'],text=True)
 return dict(x.split('=',1)for x in z.splitlines()if'='in x)
def physically_drained(name):
 v=unit(name);need(v.get('MainPID')=='0' and v.get('ControlPID','0')=='0' and v.get('ActiveState')in ['inactive','failed'],'physical service not drained '+name);return v
def identity(name,source,configuration):
 v=unit(name);need(int(v['MainPID'])>0,'expected live owned service '+name)
 for ref in [source,configuration]:bound(ref)
 argv=pathlib.Path('/proc/'+v['MainPID']+'/cmdline').read_bytes().decode().split('\0')
 need(source['path']in argv and configuration['path']in argv and configuration['sha256']in argv,'actual service source/config CAS '+name)
 v['argv']=argv;v['startTicks']=pathlib.Path('/proc/'+v['MainPID']+'/stat').read_text().split(') ',1)[1].split()[19];return v
def queue_drained(queue=QUEUE):
 queue=pathlib.Path(queue);paths=sorted(queue.glob('*.request.json'));names=[p.name for p in paths]
 opened=set();closed=set();errors=0
 for p in paths:
  q=json.loads(p.read_text());request_id=p.name[:-13];response=queue/(request_id+'.result.json')
  need(q.get('id')==request_id and isinstance(q.get('sessionId'),str),'RPC request identity malformed '+p.name)
  need(response.is_file(),'RPC missing response '+request_id)
  r=json.loads(response.read_text())
  need(r.get('id')==request_id and type(r.get('ok'))is bool and r.get('pending')is not True,'RPC pending/unknown response '+request_id)
  if r['ok']:
   if q.get('action')=='open':opened.add(q['sessionId'])
   elif q.get('action')=='close':closed.add(q['sessionId'])
  else:errors+=1
 need(names==sorted(p.name for p in queue.glob('*.request.json')),'RPC request set changed during observation')
 need(not(opened-closed),'RPC active sessions '+','.join(sorted(opened-closed)))
 need(not(closed-opened),'RPC close lacks successful original open')
 return dict(at=time.time(),queueRoot=str(queue),requestCount=len(paths),completedErrorCount=errors,successfulOpens=len(opened),successfulCloses=len(closed),activeSessions=[],missingOrPendingResponses=[])
def run(activation_path):
 import boto3
 ap=pathlib.Path(activation_path);a=json.loads(ap.read_text());need(a.get('kind')=='root-corrective-controlplane-finalizer-activation-v1'and a.get('approved')is True,'explicit owner activation')
 end=min(float(a['hardDeadline']),FINAL_DEADLINE);need(time.time()<end-600,'finite original controller lease reserve')
 prereq=module('prerequisites',a['prerequisites']);helper=module('archive_helper',a['helper']);tree=module('tree_archive',a['treeArchive']);efs=module('efs_root',a['efsRootHelper'])
 need(a.get('generation')=='corrective-20261122-01'and isinstance(a.get('publicationAuthority'),dict),'explicit current corrective activation and ROOT authority')
 for r in a.get('efsSourceFiles',[]):bound(r)
 for key in ['controllerSource','controllerConfiguration','rpcSource','rpcConfiguration']:bound(a[key])
 root=BASE/'finalizer-runs'/digest_file(ap);root.mkdir(parents=True,exist_ok=True);own=open(root/'finalizer.lock','a+');fcntl.flock(own,fcntl.LOCK_EX|fcntl.LOCK_NB)
 s3=boto3.client('s3');prefix='audit/parallel-rescue-20261121/ROOT/corrective-controlplane-close-01/'+root.name+'/'
 def publish_file(p):
  p=pathlib.Path(p);before=p.stat();h=digest_file(p);size=before.st_size;key=prefix+'objects/'+h+'/'+p.name
  if size<4*1024**3:
   with p.open('rb')as f:r=s3.put_object(Bucket=BUCKET,Key=key,Body=f,Metadata={'sha256':h})
  else:
   upload=s3.create_multipart_upload(Bucket=BUCKET,Key=key,Metadata={'sha256':h});parts=[]
   try:
    with p.open('rb')as f:
     number=1
     for b in iter(lambda:f.read(64*1024*1024),b''):
      part=s3.upload_part(Bucket=BUCKET,Key=key,UploadId=upload['UploadId'],PartNumber=number,Body=b);parts.append(dict(ETag=part['ETag'],PartNumber=number));number+=1
    r=s3.complete_multipart_upload(Bucket=BUCKET,Key=key,UploadId=upload['UploadId'],MultipartUpload=dict(Parts=parts))
   except Exception:
    try:s3.abort_multipart_upload(Bucket=BUCKET,Key=key,UploadId=upload['UploadId'])
    except Exception:pass
    raise
  need((p.stat().st_size,p.stat().st_mtime_ns)==(before.st_size,before.st_mtime_ns),'file changed during exact export '+str(p))
  ref=dict(bucket=BUCKET,key=key,versionId=r['VersionId'],sha256=h,bytes=size)
  response=s3.get_object(Bucket=BUCKET,Key=key,VersionId=r['VersionId']);check=hashlib.sha256();count=0
  for b in iter(lambda:response['Body'].read(1024*1024),b''):check.update(b);count+=len(b)
  need(check.hexdigest()==h and count==size,'export version/hash readback '+str(p));return ref
 def publish(name,value):
  p=root/name
  if not p.exists():
   with p.open('xb')as f:f.write(raw(value));f.flush();os.fsync(f.fileno())
  refpath=root/(name+'.ref.json')
  if refpath.exists():return json.loads(refpath.read_text())
  ref=publish_file(p);refpath.write_bytes(raw(ref));return ref
 def export_ref(ref):
  if ref is None:return None
  if 'path'in ref:return publish_file(bound(ref))
  need(ref.get('bucket')==BUCKET and all(ref.get(k)for k in ['key','versionId','sha256']),'genuine immutable external proof')
  return ref
 locked=None;last=None
 try:
  if(root/'CONTROLPLANE-DRAINED-EXPORTED.json.ref.json').exists():
   return helper.run(json.loads((root/'CONTROLPLANE-DRAINED-EXPORTED.json.ref.json').read_text()),snapshot_timeout=max(1,min(3600,end-time.time()-300)))
  while time.time()<end-600:
   check=prereq.check(a['publicationAuthority'])
   if check['ready']:break
   if check['blockedReasons']!=last:print('WAIT',json.dumps(check['blockedReasons']),flush=True);last=check['blockedReasons']
   time.sleep(30)
  else:raise RuntimeError('Final publication prerequisites did not complete before original lease reserve')
  ready_ref=publish('PREREQUISITES-OBSERVED.json',check)
  current=identity(CONTROLLER,a['controllerSource'],a['controllerConfiguration'])
  rpc_identity=identity(RPC,a['rpcSource'],a['rpcConfiguration'])
  need(prereq.check(a['publicationAuthority'])['ready'],'publication gate changed before final close')
  queue_before=queue_drained()
  publish('RPC-DRAIN-OBSERVED-BEFORE.json',queue_before)
  publish('CONTROLLER-STOP-INTENT.json',dict(at=time.time(),identity=current,ready=ready_ref,activationSha256=digest_file(ap)))
  need(identity(CONTROLLER,a['controllerSource'],a['controllerConfiguration'])==current,'controller identity changed before stop')
  subprocess.run(['systemctl','stop',CONTROLLER],check=True)
  controller_state=physically_drained(CONTROLLER)
  locked=open(CONTROLLER_LOCK,'a+');fcntl.flock(locked,fcntl.LOCK_EX|fcntl.LOCK_NB)
  need(identity(RPC,a['rpcSource'],a['rpcConfiguration'])==rpc_identity,'RPC identity changed before original close')
  queue_under_lock=queue_drained()
  publish('RPC-DRAIN-OBSERVED-UNDER-LOCK.json',queue_under_lock)
  need(not(root/'RPC-STOP-INTENT.json').exists(),'existing close intent requires exact adoption, never blind restart')
  publish('RPC-STOP-INTENT.json',dict(at=time.time(),identity=rpc_identity,queueRoot=str(QUEUE),journalPath=str(JOURNAL)))
  subprocess.run(['systemctl','stop',RPC],check=True)
  rpc_state=physically_drained(RPC)
  terminal_path=QUEUE/'TERMINAL.json';need(terminal_path.is_file(),'original RPC terminal missing')
  terminal=json.loads(terminal_path.read_text())
  need(not terminal.get('error')and not terminal.get('closeError')and terminal.get('activeSessions')==[]and terminal.get('activeParticipants')==[],'genuine original owner close failed/not drained')
  need(not pathlib.Path(str(JOURNAL)+'.lock').exists(),'original journal writer lock still present')
  pointer_path=pathlib.Path(str(JOURNAL)+'.checkpoint-pointer.json');pointer=json.loads(pointer_path.read_text())
  name=pointer['checkpointFile'];need(pathlib.Path(name).name==name and name.startswith('budget.jsonl.checkpoint.v1.'),'exact original checkpoint pointer')
  checkpoint_path=JOURNAL.parent/name;need(digest_file(checkpoint_path)==pointer['sha256'],'original close checkpoint pointer hash')
  checkpoint=json.loads(checkpoint_path.read_text());journal_sha=digest_file(JOURNAL)
  need(int(checkpoint['prefixBytes'])==JOURNAL.stat().st_size and checkpoint['prefixSha256']==journal_sha,'closed journal full prefix/checkpoint consistency')
  terminal_ref=publish_file(terminal_path);pointer_ref=publish_file(pointer_path);checkpoint_ref=publish_file(checkpoint_path);journal_ref=publish_file(JOURNAL)
  artifact_refs={k:export_ref(v)for k,v in check['finalArtifacts'].items()}
  artifact_refs['rootFinalPublicationMarker']=export_ref(check['rootFinalPublicationMarker'])
  artifact_refs['paperProof']={k:export_ref(v)for k,v in check['paperProof'].items()}
  def archive_tree(source,label,scope):
   return tree.archive_tree(source,label,scope,root/'private-tree-archives',publish_file,publish)
  context=dict(controllerState=controller_state,rpcState=rpc_state,queueRoot=str(QUEUE),journalPath=str(JOURNAL),originalRpcTerminal=terminal_ref,originalCheckpoint=checkpoint_ref,originalJournal=journal_ref,rootAuthority=a['publicationAuthority'],fileSystemId='REQUIRED_BINDINGS_STORAGE',accessPointId='REQUIRED_BINDINGS_STORAGE')
  # Both original owners are physically drained; no new writer is created.
  study_archive=archive_tree(JOURNAL.parent,'mounted-study-private',dict(fileSystemId=context['fileSystemId'],accessPointId=context['accessPointId'],rootDirectory='/study',filesystemRootCoverage=False,originalRpcTerminal=terminal_ref))
  efs_coverage=efs.after_rpc_close(context,root/'efs-root-coverage',archive_tree,publish_file,publish)
  need(efs_coverage.get('policyRestored')is True and efs_coverage.get('temporaryAccessRemoved')is True,'temporary EFS access/policy must be fully restored before self-stop')
  source_paths=[bound(a[k])for k in ['controllerSource','controllerConfiguration','rpcSource','rpcConfiguration','prerequisites','helper','treeArchive','efsRootHelper']]+[bound(r)for r in a.get('efsSourceFiles',[])]+[ap,pathlib.Path(__file__)]
  for ref in a.get('additionalSourceFiles',[]):source_paths.append(bound(ref))
  archive_path=root/'controller-state-source.tar.gz';excluded=[]
  def state_filter(info):
   parts=pathlib.PurePosixPath(info.name).parts
   sensitive=any(x.lower()in ['.aws','credentials','secrets','.env']or x.lower().endswith('.pem')for x in parts)
   if info.issym()or info.islnk()or sensitive:excluded.append(info.name);return None
   return info
  with tarfile.open(archive_path,'w:gz',compresslevel=2)as tf:
   tf.add('/REQUIRED_BINDINGS/research-root/state',arcname='state',recursive=True,filter=state_filter)
   for index,p in enumerate(source_paths):tf.add(p,arcname='source/'+str(index)+'-'+p.name,recursive=False)
  state_ref=publish_file(archive_path)
  manifest=publish('PRIVATE-FINAL-EXPORT-MANIFEST.json',dict(at=time.time(),originalRpcTerminal=terminal_ref,originalCheckpointPointer=pointer_ref,originalCheckpoint=checkpoint_ref,originalJournal=journal_ref,stateAndBoundSourceArchive=state_ref,studyNamespaceArchive=study_archive,efsRootCoverage=efs_coverage,excludedStatePaths=excluded,finalArtifacts=artifact_refs,cleanupMarkers=check['cleanupMarkers'],currentResourceCompletions=check['currentResourceCompletions'],currentClosedResults=check['closedResults'],wholeControllerDiskArchiveRequiredBeforeStop=True,scientificAcceptance=False,newLedgerWriterCreated=False))
  drained=publish('CONTROLPLANE-DRAINED-EXPORTED.json',dict(kind='root-corrective-controlplane-drained-exported-v1',generation='corrective-20261122-01',at=time.time(),controllerInstanceId=helper.INSTANCE,controllerVolumeId=helper.VOLUME,controllerDrained=True,rpcDrained=True,exportsVerified=True,controllerState=controller_state,rpcState=rpc_state,exportManifest=manifest,rpcTerminal=terminal_ref,rpcCheckpoint=checkpoint_ref,studyNamespaceArchive=study_archive,efsRootCoverage=efs_coverage,cleanupMarkers=check['cleanupMarkers'],currentResourceCompletions=check['currentResourceCompletions'],earliestFinalStopAt=check['earliestFinalStopAt'],rootFinalPublicationMarker=artifact_refs['rootFinalPublicationMarker'],earlyStopAuthorizedByRoot=artifact_refs['rootFinalPublicationMarker']is not None,scientificAcceptance=False))
  fcntl.flock(locked,fcntl.LOCK_UN);locked.close();locked=None
  remaining=end-time.time()-300;need(remaining>0,'original lease reserve exhausted before archive')
  return helper.run(drained,snapshot_timeout=min(3600,remaining))
 except Exception as e:
  try:publish('FINALIZER-FAILURE.json',dict(at=time.time(),error=str(e),traceback=traceback.format_exc(),noScientificRetry=True,noAutomaticRpcRestart=True))
  except Exception:pass
  raise
 finally:
  if locked is not None:fcntl.flock(locked,fcntl.LOCK_UN);locked.close()
  fcntl.flock(own,fcntl.LOCK_UN);own.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--activation-json',required=True);args=p.parse_args()
 print(json.dumps(run(args.activation_json)),flush=True)

