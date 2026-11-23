"""Read-only native export collection. No claims, reservations, dispatch, retries or science edits."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,sys
SOURCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
SCIENCE=Path('/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source')
VERIFIER=Path('/REQUIRED_BINDINGS/research-root/workspaces/root/corrective-telemetry-01/summarize_scheduler_events.py')
VERIFIER_SHA='5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358'
def need(v,m):
 if not v:raise ValueError(m)
def digest(b):return hashlib.sha256(b).hexdigest()
def raw(v):return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':digest(b),'bytes':len(b)}
def checked(r):
 p=Path(r['path']);need(p.is_absolute()and p.is_file()and not any(q.is_symlink()for q in(p,*p.parents)),'Regular exact input')
 b=p.read_bytes();need(digest(b)==r['sha256']and ('bytes'not in r or len(b)==r['bytes']),'Pinned input changed');return p
def read(r):return json.loads(checked(r).read_bytes())
def same(a,b):return a.get('path')==b.get('path')and a.get('sha256')==b.get('sha256')
def save_bytes(p,b):
 p=Path(p);need(p.is_absolute()and p.is_relative_to('/REQUIRED_BINDINGS/research-root/workspaces')and not any(q.is_symlink()for q in(p,*p.parents)),'Scoped isolated output')
 p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():need(p.read_bytes()==b,'Immutable collection artifact changed')
 else:
  with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 return ref(p)
def save(p,v):return save_bytes(p,raw(v))
def fetch(s3,r,bucket,*,pointer=False):
 if not pointer:need(all(r.get(k)for k in('key','versionId','sha256'))and type(r.get('bytes'))is int,'Exact version/hash/length required')
 response=s3.get_object(Bucket=r.get('bucket',bucket),Key=r['key'],**({'VersionId':r['versionId']}if r.get('versionId')else{}))
 b=response['Body'].read()
 need(pointer or digest(b)==r['sha256']and len(b)==r['bytes'],'Versioned export bytes changed')
 need(bool(response.get('VersionId')),'Versioned export required')
 return b,{'bucket':r.get('bucket',bucket),'key':r['key'],'versionId':response['VersionId'],'sha256':digest(b),'bytes':len(b)}
def verifier():
 need(digest(VERIFIER.read_bytes())==VERIFIER_SHA,'Original closed cohort verifier changed')
 package=SCIENCE/'research/acephale/src';sys.path.insert(0,str(package))
 spec=importlib.util.spec_from_file_location('_original_corrective_native_closed',VERIFIER)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def restore_export(s3,idx,root,bucket):
 rows={}
 for row in idx['files']:
  original=Path(row['path'])
  need(original.is_absolute()and '..'not in original.parts and '\\'not in str(original)and str(original)not in rows,'Unique literal absolute exported paths')
  target=root/'restored'/str(original).lstrip('/')
  need(target.is_relative_to(root/'restored'),'Export destination escaped')
  b,remote=fetch(s3,row,bucket);local=save_bytes(target,b);rows[str(original)]={**remote,**local,'originalPath':str(original)}
 return rows
def canonical_configuration(value,path):
 value=dict(value)
 for field in ('manifestPath','ledgerCheckpointPath','memoryPath','calibrationPath','opportunityPath','goalReliabilityPath','splitGuardPath','customTaskBundleDirectory','cohortReservationPath'):
  if value.get(field):value[field]=str((Path(path).parent/value[field]).resolve())
 return value
def collect_native(descriptor,output,now=None):
 if 'path'in descriptor and 'sha256'in descriptor:descriptor=read(descriptor)
 need(isinstance(descriptor,dict)and all(k in descriptor for k in('operation','configuration','preparation','originalSemanticUnit')),'Explicit owner operation/configuration/preparation/semantic unit required')
 op=read(descriptor['operation']);worker=read(descriptor['configuration']);preparation=read(descriptor['preparation'])
 semantic=descriptor['originalSemanticUnit'];need(semantic in('development/1','development/2','heldout/1','heldout/2'),'Original segment semantic unit')
 for key in('unitId','attemptId','inputSha256'):
  need(op[key]==worker[key],'Owner operation and worker differ: '+key)
 need(worker['unitId']=='corrective/'+semantic,'Corrective segment identity')
 need(worker['admission']['value']['preparationSha256']==descriptor['preparation']['sha256'],'Exact prepared segment')
 need(worker['environment']['ACEPHALE_BUDGET_RPC_PARTICIPANT']==worker['attemptId']+':segment-'+semantic[-1],'Exact original whole segment participant')
 bucket=worker['bucket'];prefix=worker['outputPrefix']
 import boto3
 s3=boto3.client('s3',region_name=descriptor.get('region','us-east-1'))
 try:pb,pr=fetch(s3,{'key':prefix+'/CURRENT-EXPORT.json'},bucket,pointer=True)
 except Exception as e:
  if getattr(e,'response',{}).get('Error',{}).get('Code')in('NoSuchKey','404'):
   return {'state':'awaiting-native-export','closed':False,'drained':False,'blockedReasons':['No current owner export'],'automaticRetry':False}
  raise
 ir=json.loads(pb);need(ir['key'].startswith(prefix+'/RAW-INDEX-'),'Owner exact export namespace')
 ib,ir=fetch(s3,ir,bucket);idx=json.loads(ib)
 need(idx['kind']=='acephale-corrective-profile-export-v1','Actual generic worker export schema')
 for key in('unitId','attemptId','inputSha256','resourceAttemptId','instanceId'):
  need(idx[key]==worker[key],'Exact export owner '+key)
 indexed={x['path']:x for x in idx['files']};need(len(indexed)==len(idx['files']),'Unique exported paths')
 tr=indexed[idx['terminal']['path']];need(tr['sha256']==idx['terminal']['sha256'],'Terminal present in actual export')
 tb,tr=fetch(s3,tr,bucket);terminal=json.loads(tb)
 need(terminal['kind']=='acephale-corrective-original-profile-terminal-v1','Actual generic worker terminal schema')
 if not same(terminal['configuration'],descriptor['configuration']):
  return {'state':'retained-predecessor-export','closed':False,'drained':bool(terminal.get('ownedProcessesDrained')),'rawIndex':ir,'terminal':tr,'blockedReasons':['Export belongs to predecessor configuration'],'automaticRetry':False}
 base=Path(output).resolve();need(base.is_relative_to('/REQUIRED_BINDINGS/research-root/workspaces')and str(base)!='/REQUIRED_BINDINGS/research-root/workspaces','Isolated collection output')
 root=base/ir['sha256'];rows=restore_export(s3,idx,root,bucket)
 save_bytes(root/'RAW-INDEX.json',ib);save(root/'INDEX.json',{'rawIndex':ir,'pointer':pr,'descriptor':descriptor})
 terminal_ref=rows[idx['terminal']['path']];result=terminal.get('result')or{}
 drained=idx.get('ownedProcessesDrained')is True and terminal.get('ownedProcessesDrained')is True and result.get('localOwnedProcessesDrained')is True
 common={'kind':'acephale-corrective-native-closed-result-v1','originalSemanticUnit':semantic,'unitId':worker['unitId'],'attemptId':worker['attemptId'],'participant':worker['environment']['ACEPHALE_BUDGET_RPC_PARTICIPANT'],'resourceAttemptId':worker['resourceAttemptId'],'instanceId':worker['instanceId'],'inputSha256':worker['inputSha256'],'operation':descriptor['operation'],'workerConfiguration':descriptor['configuration'],'preparation':descriptor['preparation'],'rawIndex':ir,'terminal':terminal_ref,'restoredRoot':str(root/'restored'),'originalExperimentOutput':worker['experimentOutput'],'drained':drained,'workerExecutionCompleted':terminal.get('completed')is True,'failure':terminal.get('failure'),'scientificAcceptanceAsserted':False,'automaticRetry':False,'historicalFailuresPreserved':True}
 original_root=Path(worker['experimentOutput'])
 receipts=[p for p in indexed if Path(p).name=='cohort-receipt.json'and Path(p).is_relative_to(original_root)]
 if not drained or len(receipts)!=1:
  disposition={**common,'closed':False,'state':'retained-native-terminal-without-closed-cohort','blockedReasons':(['Owned process drain not established']if not drained else[])+(['Exactly one actual native cohort receipt required']if len(receipts)!=1 else[])}
  rr=save(root/'TERMINAL-DISPOSITION.json',disposition);return {**disposition,'closedResult':rr}
 original_cohort=Path(receipts[0]).parent;cohort=Path(rows[receipts[0]]['path']).parent
 experiment=read(worker['experiment']);stages=experiment['stages']
 matched=[st for st in stages if original_cohort==original_root/st['id']/'artifacts'and '--config'in st['command']and '--upstream-root'in st['command']]
 need(len(matched)==1,'Cohort is exact original native experiment stage')
 argv=matched[0]['command'];need(argv.count('--config')==1,'Single original native config')
 planned_path=argv[argv.index('--config')+1];need(planned_path in rows,'Prepared native configuration exported')
 planned=read(rows[planned_path]);configuration=read(ref(cohort/'configuration.json'));manifest=read(ref(cohort/'manifest.json'))
 need(canonical_configuration(planned,planned_path)==configuration,'Original closed configuration differs from prepared stage')
 runs=configuration['runs'];ids=[x['runId']for x in runs];need(ids and len(set(ids))==len(ids),'Unique complete original run IDs')
 for run in runs:need(Path(run['runId']).name==run['runId']and '/'not in run['runId']and '\\'not in run['runId'],'Scoped original run identity')
 verifier_module=verifier();verified=verifier_module.summarize(cohort,SOURCE)
 receipt=read(ref(cohort/'cohort-receipt.json'))
 outcomes=[json.loads(x)for x in(cohort/'outcomes.jsonl').read_bytes().splitlines()]
 need([x['runId']for x in outcomes]==ids,'All original outcomes in exact serving order')
 per_run=[]
 for run,row in zip(runs,outcomes):
  path=cohort/(run['runId']+'.json');artifact=read(ref(path));need(artifact['record']==row,'Original per-run record/outcome mismatch')
  per_run.append(ref(path))
 summary=read(ref(cohort/'summary.json'));need(receipt['closed']is True and receipt['allDeclaredSlotsRetained']is True,'Original cohort closed retaining slots')
 def artifact(name,required=True):
  p=cohort/name
  if not p.exists():
   need(not required,'Required original artifact missing '+name);return None
  original_path=str(original_cohort/name);need(original_path in rows and rows[original_path]['sha256']==ref(p)['sha256'],'Artifact is exact exported member')
  return rows[original_path]
 scheduler_ref=save(root/'SCHEDULER-COUNTS.json',verified)
 closed={**common,'state':'native-closed','closed':True,'allDeclaredSlotsRetained':True,'cohortCompleted':receipt.get('completed')is True,'nativeRuntimeLogsComplete':verified['complete'],'cohortDirectory':str(cohort),'originalCohortDirectory':str(original_cohort),'cohortReceipt':artifact('cohort-receipt.json'),'configuration':artifact('configuration.json'),'manifest':artifact('manifest.json'),'design':artifact('design.json',False),'outcomes':artifact('outcomes.jsonl'),'originalSummary':artifact('summary.json'),'orderedRunIds':ids,'observedCount':len(outcomes),'perRunRecords':per_run,'schedulerCounts':scheduler_ref,'scope':{k:manifest.get(k)for k in('hardware','runtime','data','sourceCommit')},'blockedReasons':[]}
 closed_ref=save(root/'CLOSED-RESULT.json',closed)
 telemetry={'state':'awaiting-actual-provider-bindings','closedCohorts':[{'directory':str(cohort),'receipt':closed['cohortReceipt'],'rawIndex':ir,'terminal':terminal_ref,'originalReceiptPath':str(original_cohort/'cohort-receipt.json')}],'maximumTraces':16,'modelCalls':False}
 if not verified['complete']:telemetry['state']='closed-runtime-log-incomplete'
 if descriptor.get('telemetryBindings')and verified['complete']:
  bindings=dict(descriptor['telemetryBindings'])
  need(bindings['instanceId']==worker['instanceId']and bindings['resourceAttemptId']==worker['resourceAttemptId'],'Actual telemetry host binding')
  inp={**bindings,'kind':'acephale-native-telemetry-closure-input-v1','closedCohorts':telemetry['closedCohorts'],'nativeClosedResult':closed_ref}
  telemetry={'state':'input-ready','configuration':save(root/'TELEMETRY-INPUT.json',inp)}
 return {'state':'native-closed','closed':True,'drained':True,'closedResult':closed_ref,'rawIndex':ir,'terminal':terminal_ref,'cohortReceipt':closed['cohortReceipt'],'orderedRunIds':ids,'observedCount':len(outcomes),'workerExecutionCompleted':closed['workerExecutionCompleted'],'nativeRuntimeLogsComplete':verified['complete'],'blockedReasons':[],'telemetryRequest':telemetry,'automaticRetry':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--descriptor',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 d=Path(a.descriptor);print(json.dumps(collect_native(ref(d),a.output)))
