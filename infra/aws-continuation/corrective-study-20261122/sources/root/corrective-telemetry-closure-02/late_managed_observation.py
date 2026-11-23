"""Late, read-only managed serving observation from actual closed native work."""
from pathlib import Path
import hashlib,json,time
def need(v,m):
 if not v:raise ValueError(m)
def checked(r):
 p=Path(r['path']);b=p.read_bytes()
 need(p.is_absolute() and p.is_file() and not any(q.is_symlink() for q in(p,*p.parents)),'Regular pinned input')
 need(hashlib.sha256(b).hexdigest()==r['sha256'] and len(b)==r['bytes'],'Pinned bytes differ')
 return json.loads(b)
def materialize(plan_path,configuration,helper,output):
 plan=json.loads(Path(plan_path).read_bytes())
 need(plan['kind']=='acephale-late-managed-observation-plan-v1','Explicit late observation plan')
 need(set(plan['expectedSemanticUnits']) in ({'development/1','heldout/2'},{'development/2','heldout/1'}),'Exact final host segment pair')
 need(len(plan['closedResults'])==2,'Both original host cohorts must be closed')
 seen=set()
 for row in plan['closedResults']:
  value=checked(row['closedResult'])
  need(value['kind']=='acephale-corrective-native-closed-result-v1' and value['closed'] is True and value['drained'] is True and value['allDeclaredSlotsRetained'] is True,'Actual closed and drained cohort required')
  need(value['resourceAttemptId']==configuration['leaseId'] and value['instanceId']==configuration['instanceId'],'Closed cohort host differs')
  need(value['originalSemanticUnit'] not in seen,'Duplicate closed cohort');seen.add(value['originalSemanticUnit'])
  need(row['terminal']['sha256']==value['terminal']['sha256'],'Actual terminal reference changed')
  terminal=checked(row['terminal'])
  need(terminal['ownedProcessesDrained'] is True and all(terminal.get(k)==value.get(k) for k in ('unitId','attemptId','inputSha256','resourceAttemptId','instanceId')),'Actual exact terminal drain required')
 need(seen==set(plan['expectedSemanticUnits']),'Host final segments incomplete')
 serving=helper.sealed(helper.checked_file(configuration,'servingReceipt'))
 need(serving['completed'] is True and all(serving[k]==configuration[k] for k in ('sourceCommit','leaseId','instanceId')),'Current serving qualification required')
 inventory=helper.read(serving['inventoryPath'])
 need(helper.sha(serving['inventoryPath'])==serving['inventorySha256'],'Original post-probe inventory changed')
 ids=helper.docker(['ps','--no-trunc','--format','{{.ID}}']).splitlines()
 need(len(ids)==len(set(ids))==9,'All nine actual running roles required')
 rows=json.loads(helper.docker(['inspect',*ids]));expected={}
 for row in rows:
  role=row['Config'].get('Labels',{}).get('com.docker.compose.service')
  need(role in helper.SERVICES and role not in expected,'Unique actual role')
  expected[role]=helper.container_identity(row)
 helper.inspect_containers(expected)
 for role,key in (('actor','actorContainerId'),('predictor','predictorContainerId'),('acephale-runtime','runtimeContainerId')):
  need(expected[role]['id']==serving[key],'Qualified serving process changed')
 for role in ('actor','predictor'):
  need(expected[role]=={k:inventory['containers'][role][k] for k in ('id','imageId','startedAt','commandHash')},'Qualified model identity changed')
 result={'kind':'acephale-late-managed-serving-observation-v1','sourceCommit':configuration['sourceCommit'],
  'leaseId':configuration['leaseId'],'instanceId':configuration['instanceId'],'hardDeadline':configuration['hardDeadline'],
  'observedAt':time.time(),'servingOwnershipConfirmed':True,'temporaryWorkDrained':True,'drainConfirmed':False,
  'servingSourceCommit':configuration['sourceCommit'],'serviceContainers':expected,
  'closedResults':plan['closedResults'],'expectedSemanticUnits':sorted(seen),
  'readOnlyHostObservation':True,'modelCalls':False,'cleanupPerformed':False,'scientificAcceptanceAsserted':False}
 p=Path(output)
 with p.open('xb') as f:f.write((json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
 p.chmod(0o600)
 return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
