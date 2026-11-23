"""Read-only corrective closure prerequisites; no mutation, old campaign or time fallback."""
import hashlib,json,pathlib,subprocess,time
BUCKET='REQUIRED_BINDINGS_ARTIFACT_BUCKET'
WORK=pathlib.Path('/REQUIRED_BINDINGS/research-root/workspaces')
GENERATION='corrective-20261122-01'
UNITS={'development/1':18,'development/2':18,'heldout/1':48,'heldout/2':48}
def need(v,m):
 if not v:raise ValueError(m)
def same(a,b):return isinstance(a.get('path'),str)and isinstance(a.get('sha256'),str)and len(a['sha256'])==64 and type(a.get('bytes'))is int and all(a.get(k)==b.get(k)for k in ('path','sha256','bytes'))
def local(ref):
 p=pathlib.Path(ref['path']);b=p.read_bytes()
 need(hashlib.sha256(b).hexdigest()==ref['sha256']and len(b)==ref['bytes'],'local proof binding '+str(p));return b
def fetch(ref):
 import boto3
 need(ref.get('bucket')==BUCKET and all(ref.get(k)for k in ('key','versionId','sha256'))and type(ref.get('bytes'))is int,'versioned current proof required')
 need(ref['bytes']<=134217728,'JSON proof exceeds bounded reader; use verify_blob for large artifacts')
 response=boto3.client('s3').get_object(Bucket=BUCKET,Key=ref['key'],VersionId=ref['versionId'])
 h=hashlib.sha256();parts=[];n=0
 for b in iter(lambda:response['Body'].read(1048576),b''):h.update(b);n+=len(b);parts.append(b)
 need(h.hexdigest()==ref['sha256']and n==ref['bytes'],'version/hash proof mismatch')
 b=b''.join(parts)
 if ref.get('path'):need(local(ref)==b,'local versus immutable proof differs')
 return b
def document(ref):return json.loads(fetch(ref))
def verify_blob(ref):
 import boto3
 need(ref.get('bucket')==BUCKET and all(ref.get(k)for k in ('key','versionId','sha256'))and type(ref.get('bytes'))is int,'versioned artifact ref')
 body=boto3.client('s3').get_object(Bucket=BUCKET,Key=ref['key'],VersionId=ref['versionId'])['Body'];h=hashlib.sha256();n=0
 for b in iter(lambda:body.read(1048576),b''):h.update(b);n+=len(b)
 need(h.hexdigest()==ref['sha256']and n==ref['bytes'],'artifact streamed readback')

def observed(path,suffix):
 p=WORK/path;rp=p.with_suffix('.ref.json')if suffix=='.ref.json'else pathlib.Path(str(p)+suffix)
 r=json.loads(rp.read_bytes());need(p.read_bytes()==fetch(r),'completion marker local/version mismatch '+str(p));return r,json.loads(p.read_bytes())
def physical(unit):
 need(isinstance(unit,str)and unit.startswith('acephale-')and '/'not in unit,'actual paper unit name')
 v=dict(x.split('=',1)for x in subprocess.check_output(['systemctl','show',unit,'-p','MainPID','-p','ControlPID','-p','ActiveState','-p','InvocationID'],text=True).splitlines()if '='in x)
 need(v.get('MainPID')=='0'and v.get('ControlPID','0')=='0'and v.get('ActiveState')in ('inactive','failed'),'actual final paper group remains active');return v
def original_local_ref(ref):
 # RUN-INTENT records the original input as path+SHA. Derive length only after exact local byte identity.
 if isinstance(ref,dict)and set(ref)=={'path','sha256'}:
  p=pathlib.Path(ref['path']);b=p.read_bytes()
  need(hashlib.sha256(b).hexdigest()==ref['sha256'],'original local input hash differs')
  return {**ref,'bytes':len(b)}
 return ref
def paper(proof):
 need(set(proof)=={'command','intent','runIntent','terminal','stepTerminal'},'explicit current paper proof fields')
 c,i,ri,t,st=(document(proof[k])for k in ('command','intent','runIntent','terminal','stepTerminal'))
 need(c.get('kind')=='acephale-final-paper-only-command-v1'and c.get('statisticsInvoked')is False and c.get('publicPublication')is False,'original current private paper command')
 need(same(i['command'],proof['command'])and i['onceOnlyKey']==c['onceOnlyKey']and i.get('statisticsInvoked')is False,'outer command intent lineage')
 need(same(original_local_ref(ri['inputs']),c['inputs'])and same(ri['source'],c['source'])and ri.get('statisticsInvoked')is False,'actual runner input/source intent lineage')
 local(c['inputs']);local(c['source'])
 need(t.get('state')=='completed-private-final-candidate'and t.get('returncode')==0 and t.get('drained')is True and t.get('statisticsInvoked')is False and t.get('publicPublication')is False and t.get('rootReviewRequired')is True,'actual successful current private terminal')
 need(st.get('returncode')==0 and st.get('drained')is True and not st.get('timedOut'),'actual current rendering step drained')
 out=pathlib.Path(c['output'])
 need(proof['terminal']['path']==str(out/'TERMINAL.json')and proof['runIntent']['path']==str(out/'RUN-INTENT.json')and proof['stepTerminal']['path']==str(out/'steps/final-private-paper/TERMINAL.json'),'current output terminal locations')
 need(proof['command']['path']==str(out.parent/'COMMAND.json')and proof['intent']['path']==str(out.parent/'INTENT.json'),'actual current job command/intent locations')
 for key in ('intent','stdout','stderr'):local(st[key])
 for key in ('paper','pdf','editable'):local(t[key])
 return physical(c['unit'])
def check(publication_authority=None,now=None):
 now=time.time()if now is None else float(now)
 out=dict(ready=False,blockedReasons=[],cleanupMarkers=[],currentResourceCompletions=[],rootFinalPublicationMarker=publication_authority,earliestFinalStopAt=None,finalArtifacts={},paperProof={},paperPhysicalState=None,closedResults={})
 if publication_authority is None:out['blockedReasons'].append('await explicit current ROOT publication authority');return out
 try:
  a=document(publication_authority)
  need(a.get('kind')=='root-corrective-final-publication-ready-v1'and a.get('generation')==GENERATION,'current corrective publication authority only')
  need(a.get('publicationComplete')is True and a.get('scientificAcceptanceAsserted')is False and a.get('currentCorrectiveSlotsRetained')==132,'publication is not scientific qualification')
  need(type(a.get('notBefore'))in (int,float)and type(a.get('notAfter'))in (int,float)and a['notBefore']<=now<=a['notAfter']<=1795413600,'explicit current publication/stop window')
  need(a.get('shutdownAuthorized')is True,'explicit current final shutdown authorization')
  out['earliestFinalStopAt']=a['notBefore']
  need(set(a['closedResults'])==set(UNITS),'four exact corrective cohorts')
  ids=[]
  for unit,count in UNITS.items():
   r=a['closedResults'][unit];v=document(r)
   need(v.get('kind')=='acephale-corrective-native-closed-result-v1'and v.get('closed')is True and v.get('drained')is True and v.get('allDeclaredSlotsRetained')is True,'actual closed/drained native result')
   need(v.get('originalSemanticUnit')==unit and v.get('unitId')=='corrective/'+unit and v.get('observedCount')==count and len(v['orderedRunIds'])==count,'current unit/count binding')
   need(v.get('scientificAcceptanceAsserted')is False,'do not infer scientific acceptance')
   ids.extend(v['orderedRunIds']);out['closedResults'][unit]=r
  need(len(ids)==len(set(ids))==132,'all132 exact unique slots retained')
  specs=[
   ('review/acquisition-retirement-03/archive-retire/RETIREMENT-COMPLETE.json','.ref.json',lambda v:v.get('originalVolumesAbsent')==12 and v.get('instancesTerminated')==12 and v.get('encryptedWholeDiskArchivesRetained')==12 and v.get('requestSha256')=='c6bc5fd53fa284beac673b7c52de898ff6a415bfa26a6cd395be87acb3da2b27'),
   ('review/notebook-storage-retirement-01/ALL-NOTEBOOKS-ABSENT.json','.ref.json',lambda v:v.get('observedAbsentCount')==18 and v.get('originalRequestedCount')==18 and v.get('authoritativeS3AndSnapshotsRetained')is True),
   ('review/heldout-post-export-cleanup-01/ALL-COMPLETE.json','.ref',lambda v:v.get('retired')==2 and v.get('snapshotsRetained')==2 and v.get('controllerAndRPCPreserved')is True),
   ('review/corrective-post-export-cleanup-01/ALL-COMPLETE.json','.ref',lambda v:v.get('kind')=='acephale-corrective-two-resource-retirement-complete-v1'and v.get('snapshotsRetained')==2 and v.get('controllerAndRpcUntouched')is True and v.get('budgetHoldsAndAcceptanceUnchanged')is True and len(v.get('resources',[]))==2 and all(r.get('state')=='completed'for r in v['resources']))]
  for path,suffix,predicate in specs:
   r,v=observed(path,suffix);need(predicate(v),'actual cleanup completion '+path);out['cleanupMarkers'].append(r)
  for name in ('corrective-heldout-1','corrective-heldout-2'):
   r,v=observed('review/corrective-post-export-cleanup-01/'+name+'/COMPLETE.json','.ref')
   need(v.get('encryptedArchiveRetained')is True and v.get('originalInstanceTerminated')is True and v.get('originalVolumeAbsent')is True and v.get('ledgerAndAcceptanceUnchanged')is True and bool(v.get('snapshotId')),'actual current resource retirement proof')
   out['currentResourceCompletions'].append(r)
  need(set(a['artifactRefs'])=={'pdf','archive','manifest','githubReadback'},'exact final delivery and GitHub readback refs')
  for key,r in a['artifactRefs'].items():verify_blob(r);out['finalArtifacts'][key]=r
  github=document(a['artifactRefs']['githubReadback'])
  need(github.get('publicationComplete')is True and github.get('readbackVerified')is True and github.get('generation')==GENERATION and isinstance(github.get('commit'),str)and len(github['commit'])==40,'actual current GitHub readback proof')
  out['paperPhysicalState']=paper(a['paperProof']);out['paperProof']=a['paperProof']
  out['ready']=True
 except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError)as e:out['blockedReasons'].append(type(e).__name__+': '+str(e))
 return out
