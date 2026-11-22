"""Adopt two already-issued heldout operations; run only original CPU result callbacks."""
import importlib.util,hashlib,json,time
from pathlib import Path
import boto3
BASE={'path':'/REQUIRED_BINDINGS/01-cpu_callbacks_05.py','sha256':'fa1d0585209d7c393a86fc2ab0c9af3083eee22f989da80ee14e1b6553fce8b1'}
def loadbase():
 p=Path(BASE['path']);assert hashlib.sha256(p.read_bytes()).hexdigest()==BASE['sha256']
 sp=importlib.util.spec_from_file_location('existing_original_cpu_callbacks',p);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
def immutable(b,p,x):
 if p.exists():assert json.loads(p.read_text())==x;return b.ref(p)
 return b.save(p,x)
def ready_ref(b,state,name):
 if state['state']!='completed':return None
 return b.successful_output(state,name)
def tick(ctl,config,now,allow_dispatch=True,owner_state=None):
 b=loadbase();out=b.tick(ctl,config,now,allow_dispatch,owner_state);hc=config.get('heldoutPostprocess')
 if not hc:return out
 spec=json.loads(b.checked(hc));folder=Path(spec['stateDirectory']);folder.mkdir(parents=True,exist_ok=True)
 manifest=json.loads(b.checked(spec['dispatchManifest']));assert len(manifest['segments'])==2 and manifest['totalOriginalRunIds']==96
 bindings=[];s3=boto3.client('s3');pending=[];operations=[]
 for n,segment in enumerate(manifest['segments'],1):
  b.checked(segment['claim']);b.checked(segment['contract']);b.checked(segment['dispatchReceipt'])
  marker=folder/('segment-'+str(n)+'-export.json')
  if marker.exists():ir=json.loads(marker.read_text())
  else:
   prefix=segment['expectedRawIndexPrefix'];assert prefix.startswith('workers/'+segment['resourceAttemptId']+'/unvalidated/')
   q=s3.list_objects_v2(Bucket=spec['bucket'],Prefix=prefix,MaxKeys=3);items=q.get('Contents',[])
   if not items:pending.append({'unitId':segment['unitId'],'commandId':segment['commandId'],'state':'awaiting-owner-terminal-export'});continue
   assert len(items)==1 and not q.get('IsTruncated'),'Ambiguous owner terminal export retained'
   key=items[0]['Key'];r=s3.get_object(Bucket=spec['bucket'],Key=key);data=r['Body'].read();digest=b.sha(data)
   assert key.endswith('RAW-INDEX-'+digest+'.json')
   index=json.loads(data);u=index['unitState']
   assert index['resourceAttemptId']==segment['resourceAttemptId'] and str(u.get('MainPID'))=='0' and u.get('ActiveState') in ('inactive','failed') and u.get('SubState') in ('dead','exited','failed')
   assert any(f['path']==segment['runRoot']+'/cohort-receipt.json' for f in index['files'])
   ir={'bucket':spec['bucket'],'key':key,'versionId':r['VersionId'],'sha256':digest,'bytes':len(data)};immutable(b,marker,ir)
  bindings.append({'segmentNumber':n,'resourceAttemptId':segment['resourceAttemptId'],'runRoot':segment['runRoot'],'runIds':segment['originalRunIds'],'indexRef':ir,'claim':segment['claim'],'contract':segment['contract'],'dispatchReceipt':segment['dispatchReceipt'],'commandId':segment['commandId']})
 out['heldoutPostprocess']={'pending':pending,'boundTerminalExports':len(bindings),'operations':operations,'scientificAcceptanceAsserted':False,'studyComplete':False}
 if len(bindings)!=2:return out
 inputs=dict(spec['collectionInputs'],segments=bindings);ir=immutable(b,folder/'COLLECTION-INPUTS.json',inputs)
 def stage(name,source,interpreter,inputs_ref,output,environment=None):
  command={'operationId':'heldout-'+name+'-01','argv':[interpreter,'-I','-B',source['path'],'--inputs',inputs_ref['path'],'--sha256',inputs_ref['sha256'],'--output',output],'cwd':str(folder),'environment':environment or {},'outputRoot':output,'timeoutSeconds':600,'inputPreconditions':[inputs_ref,source],'automaticRetry':False,'workerCommands':False,'ledgerWrites':False,'validationStatus':'unvalidated','requiresExistingControllerLockAndExclusiveIntent':True}
  state=b.reconcile(ctl,config,command,now,allow_dispatch);operations.append(state);return state
 root=Path(spec['outputRoot']);env={'LD_LIBRARY_PATH':'/REQUIRED_BINDINGS/02-lib'}
 c=stage('collect',spec['collector'],spec['opsPython'],ir,str(root/'collection'))
 cr=ready_ref(b,c,'COLLECTION.json')
 if not cr:return out
 pi=immutable(b,folder/'ANALYSIS-PREPARATION-INPUTS.json',{'collection':cr,'analysisSource':spec['analysisSource']})
 p=stage('prepare-analysis',spec['analysisPreparer'],spec['analysisPython'],pi,str(root/'analysis-inputs'),env)
 ar=ready_ref(b,p,'ANALYSIS-INPUTS.json')
 if not ar:return out
 a=stage('analyze',spec['analysisSource'],spec['analysisPython'],ar,str(root/'analysis'),env)
 analysis=ready_ref(b,a,'READY/result.json')
 if not analysis:return out
 directSpec=dict(spec['reportPreparation'],phase='direct',collection=cr,heldoutAnalysis=analysis)
 di=immutable(b,folder/'DIRECT-PREPARATION-INPUTS.json',directSpec)
 dp=stage('prepare-direct-report',spec['reportPreparer'],spec['opsPython'],di,str(root/'direct-inputs'))
 dri=ready_ref(b,dp,'INPUTS.json')
 if not dri:return out
 dr=stage('direct-report',spec['directReporter'],spec['opsPython'],dri,str(root/'direct-report'))
 drr=ready_ref(b,dr,'READY/result.json')
 if not drr:return out
 paperSpec=dict(spec['reportPreparation'],phase='paper',directReport=drr,collection=cr,heldoutAnalysis=analysis)
 ppi=immutable(b,folder/'PAPER-PREPARATION-INPUTS.json',paperSpec)
 pp=stage('prepare-paper',spec['reportPreparer'],spec['opsPython'],ppi,str(root/'paper-inputs'))
 pri=ready_ref(b,pp,'INPUTS.json')
 if not pri:return out
 pr=stage('render-paper',spec['paperAssembler'],spec['paperPython'],pri,str(root/'paper'))
 final=ready_ref(b,pr,'READY/result.json')
 if final:
  out['heldoutPostprocess']['artifactPrepared']=final
  publishInput=immutable(b,folder/'PUBLISH-INPUTS.json',{'bucket':spec['bucket'],'prefix':spec['publishPrefix'],'requiredReady':[analysis,drr,final],'roots':[str(root/'analysis'),str(root/'direct-report'),str(root/'paper')]})
  pub=stage('publish-report-artifacts',spec['publisher'],spec['opsPython'],publishInput,str(root/'published'))
  published=ready_ref(b,pub,'READY.json')
  if published:out['heldoutPostprocess']['durableReportArtifacts']=published
 return out
