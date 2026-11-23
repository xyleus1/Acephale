"""Finite CPU analysis/private-paper continuation. No controller, model, ledger or claims."""
from pathlib import Path
import argparse,contextlib,datetime,fcntl,hashlib,importlib.util,json,os,signal,subprocess,time,traceback,zipfile
ROOT=Path(__file__).resolve().parent
ANALYSIS_PY=Path('/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/analysis5a/bin/python')
RENDER_PY=Path('/REQUIRED_BINDINGS/research-root/workspaces/root/paper-render-01/venv/bin/python')
OPS_PY=Path('/REQUIRED_BINDINGS/research-root/ops-venv/bin/python')
LIB='/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/python-root/local/lib'
def need(ok,msg):
 if not ok:raise ValueError(msg)
def raw(v):return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def digest(v):return hashlib.sha256(raw(v)).hexdigest()
def ref(p):
 p=Path(p).resolve();b=p.read_bytes();return {'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def read(r):
 p=Path(r['path']);need(p.is_absolute()and p.is_file()and '/REQUIRED_BINDINGS/research-root/shared/'not in str(p),'Immutable non-ledger file required')
 b=p.read_bytes();need(hashlib.sha256(b).hexdigest()==r['sha256'],'FileRef changed');return json.loads(b)
def check(r):read_bytes(r);return r
def read_bytes(r):
 p=Path(r['path']);need(p.is_absolute()and p.is_file()and '/REQUIRED_BINDINGS/research-root/shared/'not in str(p),'Immutable non-ledger file required')
 b=p.read_bytes();need(hashlib.sha256(b).hexdigest()==r['sha256'],'FileRef changed');return b
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);b=raw(v)
 if p.exists():need(p.read_bytes()==b,'Immutable output already differs');return ref(p)
 with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 return ref(p)
def module(r,name):
 check(r);spec=importlib.util.spec_from_file_location(name,r['path']);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
@contextlib.contextmanager
def lock(p):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('a+')as f:
  fcntl.flock(f,fcntl.LOCK_EX);yield
def source_refs(binding):
 value=read(binding);need(value['kind']=='acephale-corrective-private-continuation-source-v1','Source binding kind')
 sources=value['sources']
 for item in sources.values():check(item)
 need(sources['continuation']['sha256']==ref(__file__)['sha256'],'Caller source binding differs')
 return sources
def preparation_from_closed(closure):
 op=read(closure['operation']);owner=read(op['ownerReady'])
 pr=owner['preparedNative'];p=read(pr)
 need(closure['originalSemanticUnit']==p['originalSemanticUnit'],'Actual operation semantic unit differs')
 need(closure['orderedRunIds']==p['originalRunIds'],'Actual operation original order differs')
 need(read(closure['preparation'])==read(p['preparation']),'Actual operation original preparation differs')
 if 'workerConfiguration' in closure:
  need(closure['workerConfiguration']['sha256']==owner['configuration']['sha256'],'Actual worker configuration differs')
 return pr,p
def stage_binding(config,stage):
 need(stage in ('development','heldout'),'Stage')
 operation=Path(config['operationRoot']);closures=[];preparations=[];scopes=[]
 for number in (1,2):
  directory=operation/(stage+'-'+str(number))
  cp=directory/'COLLECTION.json'
  if not cp.exists():return None
  c=read(ref(cp))
  if c.get('closed')is not True or c.get('drained')is not True:return None
  closure=read(c['closedResult'])
  if read(closure['originalSummary']).get('startupFailure'):return None
  pr,p=preparation_from_closed(closure)
  need(closure['originalSemanticUnit']==stage+'/'+str(number),'Stage collection identity')
  need(read(closure['preparation'])==read(p['preparation']),'Original preparation pointer differs')
  closures.append(c['closedResult']);preparations.append(pr)
  env=p['environment']
  scopes.append({'path':env['ACEPHALE_CORRECTIVE_SCOPE_BINDING'],'sha256':env['ACEPHALE_CORRECTIVE_SCOPE_BINDING_SHA256']})
 need(scopes[0]['sha256']==scopes[1]['sha256'],'Explicit shared accounting/scope binding differs')
 reservation_ready=read(config['reservations'][stage])
 value={'kind':'acephale-corrective-closed-segments-analysis-v2','stage':stage,'closedSegments':closures,'nativePreparations':preparations,'reservation':reservation_ready['reservation'],'scopeBinding':scopes[0]}
 if stage=='heldout':
  need(config.get('heldoutSelection'),'Exact original frozen heldout selection required')
  value['heldoutSelection']=config['heldoutSelection']
 return value
def analysis_identity(value,sources):
 return digest({'inputs':value,'preparer':sources['analysisPreparer'],'originalAnalysis':sources['originalAnalysis']})
def prepare_dispatch(config,stage):
 """Source-only descriptor preparation; caller alone launches returned finite systemd command."""
 sources=source_refs(config['sourceBinding']);value=stage_binding(config,stage)
 if value is None:return {'stage':stage,'state':'waiting-actual-closed-segments','launch':False}
 base=config['baseDraftReady'];read(base)
 akey=analysis_identity(value,sources);out=Path(config['outputRoot']).resolve()
 adir=out/'analysis'/stage/akey
 value['analysisOutput']=str(adir/'result')
 prior=[]
 for other in ('development','heldout'):
  if other==stage:continue
  other_value=stage_binding(config,other)
  if other_value is not None:
   okey=analysis_identity(other_value,sources)
   prior.append({'stage':other,'directory':str(out/'analysis'/other/okey),'readyPath':str(out/'analysis'/other/okey/'result/READY/result.json')})
 inp={'kind':'acephale-corrective-analysis-paper-job-v1','stage':stage,'analysisInputs':value,'analysisKey':akey,'analysisDirectory':str(adir),'baseDraftReady':base,'sources':sources,'priorAnalysisCandidates':prior,'privateArchive':config.get('privateArchive'),'scope':'Private working artifact; ROOT final review owns acceptance/publication'}
 jid=digest(inp);job=out/'jobs'/stage/jid
 inp_ref=save(job/'INPUTS.json',inp)
 unit='acephale-corrective-paper-'+stage+'-'+jid[:12]
 argv=[str(OPS_PY),'-B',str(ROOT/'continuation.py'),'--inputs',inp_ref['path'],'--sha256',inp_ref['sha256'],'--output',str(job/'work')]
 desc={'kind':'acephale-finite-corrective-report-command-v1','stage':stage,'onceOnlyKey':stage+':'+jid,'analysisOnceOnlyKey':stage+':'+akey,'unit':unit,'argv':argv,'environment':{},'inputs':inp_ref,'source':sources['continuation'],'output':str(job/'work'),'restart':'no','runtimeMaxSeconds':3600,'timeoutStopSeconds':60,'nativeExecutionMustNotWait':True,
       'launchArgv':['systemd-run','--unit',unit,'--collect','--property=Restart=no','--property=RuntimeMaxSec=3600','--property=TimeoutStopSec=60','--']+argv}
 existing=(job/'INTENT.json').exists()
 save(job/'COMMAND.json',desc);intent=save(job/'INTENT.json',{'kind':'finite-cpu-job-intent-v1','command':ref(job/'COMMAND.json'),'inputs':inp_ref,'onceOnlyKey':desc['onceOnlyKey'],'noModelOrLedgerAction':True})
 return {'state':'prepared-existing-intent'if existing else'prepared-new-intent','launch':not existing,'intent':intent,'command':ref(job/'COMMAND.json'),**desc}
def run_step(root,name,argv,env=None,timeout=1800):
 directory=Path(root)/'steps'/name;directory.mkdir(parents=True,exist_ok=True)
 done=directory/'TERMINAL.json'
 if done.exists():
  v=read(ref(done));need(v['returncode']==0 and v['drained'],'Previous CPU step failed; retained without automatic retry')
  need(read(v['intent'])=={'argv':argv,'environment':env or{},'timeoutSeconds':timeout},'Existing CPU step identity differs');return v
 intent={'argv':argv,'environment':env or{},'timeoutSeconds':timeout}
 ip=directory/'INTENT.json'
 need(not ip.exists(),'CPU step intent exists without terminal; no duplicate execution')
 save(ip,intent)
 proc=None;start=time.time();timed=False
 with (directory/'stdout.log').open('xb')as stdout,(directory/'stderr.log').open('xb')as stderr:
  try:
   e=dict(os.environ);e.update(env or{})
   proc=subprocess.Popen(argv,stdout=stdout,stderr=stderr,env=e,start_new_session=True)
   try:rc=proc.wait(timeout=timeout)
   except subprocess.TimeoutExpired:
    timed=True;os.killpg(proc.pid,signal.SIGTERM)
    try:rc=proc.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);rc=proc.wait()
  except BaseException:
   if proc is not None and proc.poll()is None:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
   raise
 v={'returncode':rc,'drained':proc.poll()is not None,'timedOut':timed,'startedAt':start,'endedAt':time.time(),'stdout':ref(directory/'stdout.log'),'stderr':ref(directory/'stderr.log'),'intent':ref(ip)}
 save(done,v);need(rc==0 and not timed,'CPU step failed; original error/logs retained');return v
def ensure_analysis(inp):
 directory=Path(inp['analysisDirectory']);directory.mkdir(parents=True,exist_ok=True)
 with lock(directory/'LOCK'):
  ready=directory/'result/READY/result.json'
  if ready.exists():
   v=read(ref(ready));need(v['source']['sha256']==inp['sources']['originalAnalysis']['sha256'],'Existing estimator source differs')
   need(read(ref(directory/'PREPARATION-INPUT.json'))==inp['analysisInputs'],'Cached analysis preparation differs')
   prepared=read(ref(directory/'prepared/READY.json'));need(v['input']['sha256']==prepared['inputs']['sha256'],'Cached report input differs')
   check(v['nativeReport']);return ref(ready)
  if (directory/'ERROR.json').exists():raise ValueError('Prior analysis error retained; no automatic retry')
  try:
   ir=save(directory/'PREPARATION-INPUT.json',inp['analysisInputs'])
   prep=directory/'prepared/READY.json'
   if not prep.exists():
    run_step(directory,'prepare',[str(ANALYSIS_PY),'-I','-B',inp['sources']['analysisPreparer']['path'],'--inputs',ir['path'],'--sha256',ir['sha256'],'--output',str(directory/'prepared')],{'LD_LIBRARY_PATH':LIB})
   pr=read(ref(prep));command=read(pr['command'])
   need(command['source']['sha256']==inp['sources']['originalAnalysis']['sha256'],'Original estimator command source differs')
   run_step(directory,'original-analysis',command['argv'],command['environment'])
   v=read(ref(ready));check(v['nativeReport'])
   save(directory/'ANALYSIS-CLOSED.json',{'ready':ref(ready),'modelsCalled':False,'originalStatisticsOnly':True})
   return ref(ready)
  except BaseException as exc:
   save(directory/'ERROR.json',{'errorType':type(exc).__name__,'message':str(exc),'traceback':traceback.format_exc(),'statisticsMustNotAutomaticallyRetry':True})
   raise
def run(inputs_ref,output):
 inp=read(inputs_ref);need(inp['kind']=='acephale-corrective-analysis-paper-job-v1','Job kind')
 for r in inp['sources'].values():check(r)
 need(inp['sources']['continuation']['sha256']==ref(__file__)['sha256'],'Worker source changed')
 root=Path(output).resolve();root.mkdir(parents=True,exist_ok=True)
 with lock(root/'LOCK'):
  if (root/'TERMINAL.json').exists():return read(ref(root/'TERMINAL.json'))
  need(not(root/'RUN-INTENT.json').exists(),'Worker intent exists; no duplicate process')
  save(root/'RUN-INTENT.json',{'inputs':inputs_ref,'source':ref(__file__),'modelsCalled':False})
  try:
   current=ensure_analysis(inp);analyses={inp['stage']:current}
   for prior in inp['priorAnalysisCandidates']:
    path=Path(prior['readyPath'])
    if path.exists():analyses[prior['stage']]=ref(path)
   pi=save(root/'PAPER-INPUT.json',{'kind':'acephale-corrective-private-paper-input-v1','baseDraftReady':inp['baseDraftReady'],'analyses':analyses,'sources':inp['sources'],'stage':inp['stage']})
   run_step(root,'private-paper',[str(RENDER_PY),'-I','-B',inp['sources']['paper']['path'],'--inputs',pi['path'],'--sha256',pi['sha256'],'--output',str(root/'paper')],timeout=1200)
   paper=read(ref(root/'paper/READY.json'))
   result={'kind':'acephale-corrective-analysis-paper-result-v1','analysisResults':analyses,'paper':ref(root/'paper/READY.json'),'pdf':paper['pdf'],'editable':paper['editable'],'studyComplete':False,'scientificAcceptanceAsserted':False,'rootFinalReviewRequired':True,'publicPublication':False,'nativeExecutionBlocked':False,'allOwnedCpuChildrenDrained':True}
   save(root/'READY.json',result)
   if inp.get('privateArchive'):
    import boto3
    z=root/'private-working-artifacts.zip'
    with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED)as archive:
     for p in sorted((root/'paper').rglob('*')):
      if p.is_file():archive.write(p,Path('paper')/p.relative_to(root/'paper'))
     archive.write(root/'READY.json','READY.json')
    cfg=inp['privateArchive'];s3=boto3.client('s3',region_name=cfg.get('region','us-east-1'));objs=[]
    for p in (z,root/'READY.json'):
     rr=ref(p);key=cfg['prefix'].rstrip('/')+'/'+rr['sha256']+'/'+p.name
     v=s3.put_object(Bucket=cfg['bucket'],Key=key,Body=p.read_bytes());objs.append({**rr,'bucket':cfg['bucket'],'key':key,'versionId':v.get('VersionId')})
    save(root/'PRIVATE-ARCHIVE.json',{'privateOnly':True,'objects':objs})
   terminal={'state':'completed-private-artifact','returncode':0,'drained':True,'ready':ref(root/'READY.json')}
  except BaseException as exc:
   save(root/'ERROR.json',{'errorType':type(exc).__name__,'message':str(exc),'traceback':traceback.format_exc(),'noAutomaticAnalysisRetry':True})
   terminal={'state':'failed-retained','returncode':1,'drained':True,'error':ref(root/'ERROR.json')}
  save(root/'TERMINAL.json',terminal);return terminal
def main():
 p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 r=run({'path':a.inputs,'sha256':a.sha256},a.output);print(json.dumps(r));raise SystemExit(r['returncode'])
if __name__=='__main__':main()
