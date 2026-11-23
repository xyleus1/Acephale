"""Unarmed exact-two corrective worker retirement; called only by the existing controller."""
import contextlib,fcntl,hashlib,importlib.util,json,os,pathlib,subprocess,time
BASE_PATH='/REQUIRED_BINDINGS/research-root/workspaces/review/heldout-post-export-cleanup-01/watch_once_04.py'
BASE_SHA='21e82c159d7d1e0c2fffd852e8b3d7c9521bc336598071a45c025d37b79786a0'
BUCKET='REQUIRED_BINDINGS_ARTIFACT_BUCKET'
ROOT=pathlib.Path('/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-post-export-cleanup-01')
EXPECTED={
 'REQUIRED_BINDINGS_RESOURCE':{'instanceId':'REQUIRED_BINDINGS_INSTANCE','volumeId':'REQUIRED_BINDINGS_STORAGE','configurationSha256':'2f166a5572c6d98faed17b4dc24ff9007df100d8a768e98ab5a76d1cca530971','semantics':['development/2','heldout/1'],'unitId':'corrective/heldout/1','unitAttemptId':'corrective-heldout-1-20261122-01'},
 'REQUIRED_BINDINGS_RESOURCE':{'instanceId':'REQUIRED_BINDINGS_INSTANCE','volumeId':'REQUIRED_BINDINGS_STORAGE','configurationSha256':'9aed22c2e552dcf99c3ca9122dca2b4e0271cd1ae19c586efded0407be36a43d','semantics':['development/1','heldout/2'],'unitId':'corrective/heldout/2','unitAttemptId':'corrective-heldout-2-20261122-01'}}
ACTIONS=['stop','archive-encrypted-disk','terminate-stopped','delete-archived-volume']
def need(v,m):
 if not v:raise ValueError(m)
def digest(b):return hashlib.sha256(b).hexdigest()
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),default=str)+'\n').encode()
def identity(r):return tuple(r.get(k)for k in ('bucket','key','versionId','path','sha256','bytes'))
def same(a,b):return a.get('sha256')==b.get('sha256') and a.get('bytes')==b.get('bytes') and (a.get('path')==b.get('path') if 'path'in a and 'path'in b else all(a.get(k)==b.get(k)for k in ('bucket','key','versionId')))
def load_ref(r,s3=None,versioned=False):
 need(isinstance(r,dict)and isinstance(r.get('sha256'),str)and isinstance(r.get('bytes'),int),'exact byte/hash reference')
 if 'bucket'in r:
  need(r['bucket']==BUCKET and r.get('versionId') and r.get('key'),'owned versioned reference')
  if s3 is None:
   import boto3
   s3=boto3.client('s3',region_name='us-east-1')
  b=s3.get_object(Bucket=BUCKET,Key=r['key'],VersionId=r['versionId'])['Body'].read()
 else:
  need(not versioned,'versioned ROOT authorization required')
  p=pathlib.Path(r['path']).resolve();need(p.is_relative_to('/REQUIRED_BINDINGS/research-root/workspaces')or p.is_relative_to('/REQUIRED_BINDINGS/research-root/state'),'retained controller artifact path')
  b=p.read_bytes()
 need(len(b)==r['bytes']and digest(b)==r['sha256'],'exact immutable bytes')
 return json.loads(b)
def validate_authority(a,now):
 need(a.get('kind')=='acephale-corrective-two-resource-retirement-ready-v1'and a.get('retirementAuthorized')is True,'explicit ROOT retirement authorization')
 need(a.get('scientificAcceptanceAsserted')is False,'retirement is not scientific acceptance')
 need(a.get('all132OriginalSlotsRetained')is True and a.get('requiredCpuArtifactProcessingCompleted')is True,'all132 and required CPU processing proved')
 need(a.get('actions')==ACTIONS and a.get('targets')==EXPECTED,'exact two resources/actions')
 need(float(a['notBefore'])<=now<=float(a['notAfter'])<=1795413600,'finite authorized window')
 need(set(a.get('hosts',{}))==set(EXPECTED),'both explicit host closures')
 need(isinstance(a.get('requiredCpuArtifactRefs'),list)and a['requiredCpuArtifactRefs'],'actual required CPU artifact references')
 return a
def validate_closed(v,resource,semantic):
 x=EXPECTED[resource];count=18 if semantic.startswith('development/')else 48
 need(v.get('kind')=='acephale-corrective-native-closed-result-v1','original corrected collector output')
 need(v.get('closed')is True and v.get('drained')is True and v.get('allDeclaredSlotsRetained')is True,'actual closed/drained retained cohort')
 need(v.get('resourceAttemptId')==resource and v.get('instanceId')==x['instanceId']and v.get('originalSemanticUnit')==semantic,'exact host semantic lineage')
 need(v.get('unitId')=='corrective/'+semantic and v.get('attemptId')=='corrective-'+semantic.replace('/','-')+'-20261122-01','exact corrective attempt')
 ids=v.get('orderedRunIds',[])
 need(len(ids)==count and len(set(ids))==count and v.get('observedCount')==count,'all original segment slots')
 need(v.get('scientificAcceptanceAsserted')is False,'acceptance unchanged')
 return ids
def controller_lock_owned():
 lock=pathlib.Path('/REQUIRED_BINDINGS/research-root/state/continuation-controller.lock')
 st=lock.stat();pid=os.getpid();owned=False
 for line in pathlib.Path('/proc/locks').read_text().splitlines():
  p=line.split()
  if len(p)>6 and p[1]=='FLOCK'and p[3]=='WRITE'and p[4]==str(pid)and p[5].split(':')[-1]==str(st.st_ino):owned=True
 need(owned,'must run inside existing controller holding its original lifetime lock')
 current=subprocess.run(['systemctl','show','acephale-continuation-controller.service','--property=MainPID','--value'],check=True,capture_output=True,text=True,timeout=10).stdout.strip()
 need(current==str(pid),'same active controller process')
def _base():
 p=pathlib.Path(BASE_PATH);need(digest(p.read_bytes())==BASE_SHA,'pinned prior retirement state machine')
 spec=importlib.util.spec_from_file_location('original_post_export_cleanup',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 m.ROOT=ROOT;m.P='audit/parallel-rescue-20261121/ROOT/corrective-post-export-cleanup-01/'
 m.VOLUMES={x['instanceId']:x['volumeId']for x in EXPECTED.values()}
 return m
def verify_export(m,closed):
 idx=load_ref(closed['rawIndex'],m.S,True)
 for k in ('instanceId','resourceAttemptId','unitId','attemptId','inputSha256'):need(idx[k]==closed[k],'raw export identity '+k)
 need(idx.get('ownedProcessesDrained')is True,'raw export physical drain')
 count=0;total=0
 for f in idx['files']:
  need(f['bucket']==BUCKET and f.get('versionId')and f['key'].startswith('workers/'+closed['resourceAttemptId']+'/'),'owned immutable raw export')
  response=m.S.get_object(Bucket=BUCKET,Key=f['key'],VersionId=f['versionId']);h=hashlib.sha256();size=0
  while True:
   b=response['Body'].read(1024*1024)
   if not b:break
   size+=len(b);h.update(b)
  need(size==f['bytes']and h.hexdigest()==f['sha256'],'complete versioned raw member');count+=1;total+=size
 terminal=load_ref(closed['terminal'],m.S)
 need(terminal.get('ownedProcessesDrained')is True and (terminal.get('result')or{}).get('localOwnedProcessesDrained')is True,'genuine terminal child drain')
 return {'rawIndex':closed['rawIndex'],'verifiedFiles':count,'verifiedBytes':total}
def validate_telemetry_lineage(ready,c,t,h,x):
 need(ready.get('instanceId')==x['instanceId']and c.get('instanceId')==x['instanceId'],'actual telemetry ready host')
 resource=next(k for k,v in EXPECTED.items()if v==x)
 need(c.get('resourceAttemptId')==resource,'actual telemetry resource')
 late=c.get('lateManagedObservation')or{}
 need(set(late.get('expectedSemanticUnits',[]))==set(x['semantics']),'both final host semantics in telemetry')
 expected=h['closedResults']
 refs=late.get('closedResults',[])
 need(len(refs)==2 and all(any(same(r,v)for r in refs)for v in expected.values()),'telemetry bound to exact two current closed results')
 need(same(t.get('envelope')or{},ready.get('envelope')or{})and t.get('operationId')==ready.get('operationId'),'actual telemetry terminal/envelope lineage')
def verify_telemetry(m,h,x):
 v=load_ref(h['telemetryResult'],m.S);t=load_ref(v['terminal'],m.S,True)
 need(t.get('instanceId')==x['instanceId'],'telemetry actual host')
 ready=load_ref(v.get('ready')or h['telemetryReady'],m.S);cfg=load_ref(ready['configuration'],m.S)
 validate_telemetry_lineage(ready,cfg,t,h,x)
 if v.get('state')=='completed':
  need(v.get('kind')=='acephale-native-telemetry-closure-verified-v1'and v.get('artifactExportVerified')is True and t.get('status')=='completed','actual original telemetry verifier completed')
  for k in ('archive','archiveReceipt'):
   f=v[k];need(f['bucket']==BUCKET,'owned telemetry archive');r=m.S.get_object(Bucket=BUCKET,Key=f['key'],VersionId=f['versionId']);b=r['Body'].read();need(digest(b)==f['sha256']and len(b)==f['bytes'],'immutable telemetry export')
 else:
  need(v.get('state')=='failed'and t.get('status')!='completed'and h.get('preservedTelemetryFailureAcceptedForRetirement')is True,'preserved actual telemetry failure explicitly accepted by ROOT')
  f=h['telemetryFailureArchive'];need(f['bucket']==BUCKET,'owned failure archive');r=m.S.get_object(Bucket=BUCKET,Key=f['key'],VersionId=f['versionId']);b=r['Body'].read();need(digest(b)==f['sha256']and len(b)==f['bytes'],'failed telemetry evidence archived')
 return {'result':h['telemetryResult'],'terminal':v['terminal'],'state':v['state'],'requirementsSatisfied':v.get('telemetryRequirementsSatisfied',False)}
def tick(configuration_ref,authorization_ref,now=None):
 """One bounded state-machine step. No loops, sleeps, service stops, budget writes, or activation."""
 now=time.time()if now is None else now
 if authorization_ref is None:return {'state':'blocked','blockedReasons':['ROOT retirement authorization not supplied'],'actions':[]}
 c=load_ref(configuration_ref);need(c.get('kind')=='acephale-corrective-two-resource-retirement-configuration-v1'and c.get('targets')==EXPECTED,'exact staged configuration')
 need(c.get('source',{}).get('sha256')==digest(pathlib.Path(__file__).read_bytes()),'exact prepared adapter source')
 a=validate_authority(load_ref(authorization_ref,versioned=True),now)
 controller_lock_owned();m=_base();ROOT.mkdir(parents=True,exist_ok=True)
 with open(ROOT/'adapter.lock','a+')as own:
  fcntl.flock(own,fcntl.LOCK_EX|fcntl.LOCK_NB)
  need(not(ROOT/'AUTHORITY.json').exists()or same(json.loads((ROOT/'AUTHORITY.json').read_text())['authorization'],authorization_ref),'one exact retirement authority')
  m.put('AUTHORITY.json',{'authorization':authorization_ref,'configuration':configuration_ref})
  for ref in a['requiredCpuArtifactRefs']:load_ref(ref,m.S,True)
  all_ids=[];closures={};hosts=a['hosts']
  for resource,x in EXPECTED.items():
   h=hosts[resource];need(set(h['closedResults'])==set(x['semantics']),'exact two native cohorts')
   closures[resource]={}
   for semantic in x['semantics']:
    v=load_ref(h['closedResults'][semantic],m.S);all_ids+=validate_closed(v,resource,semantic);closures[resource][semantic]=v
  need(len(all_ids)==132 and len(set(all_ids))==132,'all132 original IDs exactly once')
  def ownership(seg):
   resource=seg['resourceAttemptId'];x=EXPECTED[resource];h=hosts[resource];last=closures[resource][x['semantics'][1]]
   unit=m.item('unit#'+x['unitId']);r=m.item('resource#'+resource)
   need(unit and unit.get('attemptId')==x['unitAttemptId']and unit.get('directExecutionCompleted')is True,'same actual final heldout owner closed')
   need(unit.get('inputSha256')==last['inputSha256']and same(unit.get('currentNativeReady')or{},h['closedResults'][x['semantics'][1]]),'exact final closed result adopted')
   op=load_ref(last['operation'],m.S);need(op.get('attemptId')==x['unitAttemptId']and op.get('inputSha256')==last['inputSha256'],'actual final operation')
   expected=h['finalOwner'];need(unit.get('inputSha256')==expected['inputSha256']and (unit.get('directControllerOperation')or{}).get('descriptorSha256')==expected['descriptorSha256'],'exact actual owner descriptor')
   need(r and r.get('attemptId')==resource and r.get('scientificUnitAttemptId')==x['unitAttemptId']and r.get('scientificUnitClaimed')is True,'current resource ownership fence')
   if r.get('instanceId')is not None:need(r['instanceId']==x['instanceId'],'resource physical identity')
   return {'unit':unit,'resource':r}
  prior_instance=m.instance
  def instance(seg):
   r=prior_instance(seg);x=EXPECTED[seg['resourceAttemptId']];tags={t['Key']:t['Value']for t in r['Tags']}
   need(tags.get('LeaseId')==seg['resourceAttemptId']and tags.get('CapacityConfigSha256')==x['configurationSha256']and tags.get('HardStopEpoch')=='1795413600','exact current allocation lease')
   if r['State']['Name']!='terminated':need(all(e['Ebs'].get('DeleteOnTermination')is False for e in r['BlockDeviceMappings']),'preserve archive-before-delete')
   return r
  def transition(action):
   controller_lock_owned();validate_authority(a,time.time());handles=[]
   try:
    for p in ('/REQUIRED_BINDINGS/research-root/workspaces/rescue/capacity/cleanup-transition.lock','/REQUIRED_BINDINGS/research-root/workspaces/rescue/capacity/allocator.lock'):
     f=open(p,'a+');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
    return action()
   finally:
    for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
  m.ownership=ownership;m.instance=instance;m.transition=transition;m.cpu_publication_drained=lambda:bool(a['requiredCpuArtifactProcessingCompleted'])
  results=[]
  for resource,x in EXPECTED.items():
   seg={'resourceAttemptId':resource,**x};name=x['unitId'].replace('/','-');folder=ROOT/name
   if (folder/'COMPLETE.json').exists():
    results.append({'resourceAttemptId':resource,'state':'completed','receipt':json.loads((folder/'COMPLETE.json.ref').read_text())});continue
   ownership(seg);instance(seg)
   if (folder/'CLOSURE.json').exists():proof=json.loads((folder/'CLOSURE.json').read_text())
   else:
    exports=[verify_export(m,v)for v in closures[resource].values()];telemetry=verify_telemetry(m,hosts[resource],x)
    proof={'kind':'acephale-corrective-two-cohort-resource-closure-v1','resourceAttemptId':resource,'instanceId':x['instanceId'],'authorization':authorization_ref,'closedResults':hosts[resource]['closedResults'],'versionedExports':exports,'telemetry':telemetry,'all132OriginalSlotsRetained':True,'canonicalAcceptanceAsserted':False,'budgetHoldsUnchanged':True}
    m.put(name+'/CLOSURE.json',proof)
   need(same(proof['authorization'],authorization_ref),'closure same ROOT authorization')
   # Original snapshot intent+API execute once under allocator lock; pending snapshots return immediately.
   snapshot_phase=(folder/'STOP-RESPONSE.json').exists()and not(folder/'SNAPSHOT-RESPONSE.json').exists()
   done=transition(lambda:m.step(seg,proof))if snapshot_phase else m.step(seg,proof)
   results.append({'resourceAttemptId':resource,'state':'completed'if done else'pending'})
  if all(x['state']=='completed'for x in results):m.put('ALL-COMPLETE.json',{'kind':'acephale-corrective-two-resource-retirement-complete-v1','authorization':authorization_ref,'resources':results,'snapshotsRetained':2,'controllerAndRpcUntouched':True,'budgetHoldsAndAcceptanceUnchanged':True})
  return {'state':'completed'if all(x['state']=='completed'for x in results)else'pending','resources':results,'controllerAndRpcUntouched':True}
if __name__=='__main__':raise SystemExit('Prepare-only module: existing controller invokes tick with actual immutable ROOT authorization.')
