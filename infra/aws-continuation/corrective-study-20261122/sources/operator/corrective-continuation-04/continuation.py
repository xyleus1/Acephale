"""Same-controller corrective continuation; no independent writer or scientific retry."""
from pathlib import Path
import hashlib,json,os,time,importlib.util,sys
def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def checked(r):
 p=Path(r['path']);b=p.read_bytes();need(p.is_absolute()and not p.is_symlink()and sha(b)==r['sha256'],'Exact current source/input '+str(p));return b
def read(r):return json.loads(checked(r))
def ref(p):return {'path':str(p),'sha256':sha(Path(p).read_bytes())}
def write(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);b=(json.dumps(v,sort_keys=True,indent=2,default=str)+'\n').encode()
 if p.exists():need(p.read_bytes()==b,'Immutable continuation result changed');return ref(p)
 with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 return ref(p)
def module(r,name):
 checked(r);s=importlib.util.spec_from_file_location(name,r['path']);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def get(s3,r,bucket):
 x=s3.get_object(Bucket=r.get('bucket',bucket),Key=r['key'],**({'VersionId':r['versionId']}if r.get('versionId')else{}));b=x['Body'].read()
 need(not r.get('sha256')or sha(b)==r['sha256'],'Exact exported bytes');need(not r.get('bytes')or len(b)==r['bytes'],'Exact exported length')
 return b,{'bucket':r.get('bucket',bucket),'key':r['key'],'versionId':x['VersionId'],'sha256':sha(b),'bytes':len(b)}
def cached_profile_ready(path,w,op,ir,tr,row):
 if not Path(path).is_file():return None
 rr=ref(path);value=read(rr)
 need(row.get('attemptId')==op['attemptId']and row.get('inputSha256')==op['inputSha256']and row.get('currentProfileReady')==rr and row.get('profileValid')is True and row.get('directExecutionCompleted')is True,'Exact adopted cached profile owner')
 need(value.get('kind')=='acephale-corrective-profile-ready-v1'and value.get('profileValid')is True and value.get('unitId')==op['unitId']and value.get('attemptId')==op['attemptId']and value.get('seed')==w['seed'],'Exact cached profile identity')
 need(value.get('rawIndex')==ir and value.get('configuration')==w['configuration']and value.get('preparation')==w['preparation'],'Exact cached immutable export/configuration')
 need(all(value['terminal'].get(k)==v for k,v in tr.items()),'Exact cached terminal version/hash')
 return {'seed':w['seed'],'state':'profile-ready','ready':rr,'cachedExactImmutableExport':True}
def collect_profile(ctl,config,w):
 op=read(w['operation']);worker=read(w['configuration']);prefix=worker['outputPrefix'];s3=ctl.store.s3
 try:p,pref=get(s3,{'key':prefix+'/CURRENT-EXPORT.json'},ctl.store.bucket)
 except Exception as e:
  if getattr(e,'response',{}).get('Error',{}).get('Code')in('NoSuchKey','404'):return {'seed':w['seed'],'state':'awaiting-original-profile-export'}
  raise
 ir=json.loads(p);ib,ir=get(s3,ir,ctl.store.bucket);idx=json.loads(ib)
 need(idx['unitId']==op['unitId']and idx['attemptId']==op['attemptId']and idx['inputSha256']==op['inputSha256'],'Same exact corrective profile export')
 rows={r['path']:r for r in idx['files']};need(len(rows)==len(idx['files']),'Unique exported paths')
 tr=rows[idx['terminal']['path']];need(tr['sha256']==idx['terminal']['sha256'],'Terminal included in exact export')
 tb,tr=get(s3,tr,ctl.store.bucket);terminal=json.loads(tb)
 if terminal['configuration']!=w['configuration']:return {'seed':w['seed'],'state':'retained-predecessor-export','predecessor':tr}
 out=Path(config['collectionRoot'])/('seed'+str(w['seed']))/ir['sha256']
 if (out/'PROFILE-READY.json').is_file():
  cached=cached_profile_ready(out/'PROFILE-READY.json',w,op,ir,tr,ctl.claims.decoded('unit#'+op['unitId']))
  if cached is not None:return cached
 out.mkdir(parents=True,exist_ok=True)
 write(out/'INDEX.json',{'rawIndex':ir,'pointer':pref,'configuration':w['configuration']})
 for r in idx['files']:
  original=Path(r['path']);need(original.is_absolute()and '..'not in original.parts,'Literal owner export path')
  target=out/'restored'/str(original).lstrip('/')
  need(target.is_relative_to('/REQUIRED_BINDINGS/research-root')and not any(x.is_symlink()for x in(target,*target.parents)),'Protected output destination')
  b,_=get(s3,r,ctl.store.bucket)
  if target.exists():need(target.read_bytes()==b,'Existing exact owner evidence changed')
  else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
 result=terminal.get('result')or{}
 if not terminal.get('completed'):
  return {'seed':w['seed'],'state':'retained-original-profile-failure','rawIndex':ir,'terminal':tr,'childCreated':result.get('childCreated'),'failure':terminal.get('failure'),'automaticRetry':False}
 need(terminal['ownedProcessesDrained']is True and result.get('completed')is True and result.get('localOwnedProcessesDrained')is True,'Original successful profile physically drained')
 original_eroot=Path(worker['experimentOutput']);eroot=out/'restored'/str(original_eroot).lstrip('/');pr=ref(eroot/'profile/artifacts/receipt.json');mr=ref(eroot/'profile/artifacts/measurements.json');ar=ref(eroot/'aggregate/artifacts/opportunity.json')
 for rr in(pr,mr,ar):
  original_path='/'+str(Path(rr['path']).relative_to(out/'restored'));need(original_path in rows and rows[original_path]['sha256']==rr['sha256'],'Actual profile artifact bound by export')
 pv=read(pr);a=read(ar);need(pv.get('closed')is True and pv.get('readyForAggregation')is True,'Original profile closed for aggregation')
 measured=read(mr);am=read({'path':'/REQUIRED_BINDINGS/research-root/workspaces/report/opportunity-prospective-01/prepared/AMENDMENT.json','sha256':'ae6efb454683fb92afe1e4b04442826f0f469bd23111976d636934d0ab803b34'})
 need(pv.get('declared')==80 and pv.get('completed',0)+pv.get('failed',0)==80 and measured.get('rowIds')==am['rowIds'] and len(measured.get('rows',[]))==80,'All original predeclared80 slots retained including failed rows')
 need(a.get('version')==2 and a.get('sampleCount',0)>=10,'Unchanged original opportunity minimum')
 prepared=read(w['preparation'])
 v={'kind':'acephale-corrective-profile-ready-v1','seed':w['seed'],'unitId':op['unitId'],'attemptId':op['attemptId'],'opportunity':ar,'measurements':mr,'profileReceipt':pr,'terminal':{**tr,'path':str(out/'restored'/str(Path(idx['terminal']['path'])).lstrip('/'))},'rawIndex':ir,'preparation':w['preparation'],'configuration':w['configuration'],'restoredRoot':str(out/'restored'),'originalExperimentOutput':str(original_eroot),'applicationSourceBinding':prepared['applicationSourceBinding'],'actualQualification':prepared['qualificationTerminal'],'profileValid':True,'historicalFailuresPreserved':True,'scientificAcceptanceAsserted':False}
 ready=write(out/'PROFILE-READY.json',v);row=ctl.claims.decoded('unit#'+op['unitId'])
 if row.get('currentProfileReady')!=ready:
  from boto3.dynamodb.types import TypeSerializer
  sv=TypeSerializer().serialize
  ctl.claims.ddb.update_item(TableName=ctl.claims.table,Key={'pk':{'S':'unit#'+op['unitId']}},ConditionExpression='attemptId=:a AND inputSha256=:i AND directControllerOperation.operationId=:o AND directControllerOperation.descriptorSha256=:h',UpdateExpression='SET directExecutionCompleted=:yes, profileValid=:yes, currentProfileReady=:r, operationalState=:state',ExpressionAttributeValues={':a':{'S':op['attemptId']},':i':{'S':op['inputSha256']},':o':{'S':op['operationId']},':h':{'S':w['operation']['sha256']},':yes':{'BOOL':True},':r':sv(ready),':state':{'S':'original-profile-complete-and-drained'}})
 return {'seed':w['seed'],'state':'profile-ready','ready':ready}
def tick(controller,config,now=None,allow_dispatch=True):
 now=time.time()if now is None else now
 need(config['hardDeadline']==1795413600,'Exact corrective finite horizon')
 h=module(config['ownerHandler'],'corrective_existing_owner')
 outputs=[];profiles=[]
 for w in config['profiles']:
  try:
   outputs.append(h.reconcile_one(controller,config['ownerConfiguration'],w['operation'],now,allow_dispatch))
   profiles.append(collect_profile(controller,config,w))
  except Exception as e:profiles.append({'seed':w['seed'],'state':'retained-integration-error','errorType':type(e).__name__,'error':str(e),'automaticRetry':False})
 next_result={'state':'waiting-original-profile-results'}
 if config.get('nativeBridge'):
  m=module(config['nativeBridge']['source'],'corrective_native_continuation')
  next_result=m.tick(controller,config['nativeBridge'],profiles,now=now,allow_dispatch=allow_dispatch)
 value={'kind':'acephale-corrective-continuation-tick-v1','observedAt':now,'operations':outputs,'profiles':profiles,'native':next_result,'scientificAcceptanceAsserted':False,'studyComplete':False,'automaticScientificRetry':False}
 p=Path(config['stateRoot'])/'LAST.json';p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(value,sort_keys=True,indent=2,default=str)+'\n');os.replace(tmp,p)
 return value
