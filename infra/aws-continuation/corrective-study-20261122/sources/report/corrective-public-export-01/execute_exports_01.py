ANALYSIS_REFS={"development":{"path":"/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-report-continuation-02/outputs/analysis/development/0a62f2065a44c59eb97cc4d94314fb5c6f495f73f21e9361e704408bc6b74240/result/READY/result.json","sha256":"c2645f75bd4842487b8e1764befaf3631f220398ce692a1e4d5f0c27c541546c"},"heldout":{"path":"/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-report-continuation-02/outputs/analysis/heldout/d88519d913084db2b000aeabe85124c49b6aeb58fc2304fdbb800d1ee2d8a743/result/READY/result.json","sha256":"8fe244d8f917e8fb4c619227def24eb4f8bb390e9a78e8273e913d89c7181853"}}
from pathlib import Path
import json,hashlib,importlib.util,os,subprocess,time,datetime,signal
base=Path('/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-public-export-01/executed-final-01')
src=Path('/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-public-export-01/prepare_exports.py')
assert hashlib.sha256(src.read_bytes()).hexdigest()=='7b60f4aec5fa43739da48ea289dde0cbb8ad94b321dc6694c9c7307dce9cbecf'
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x') as f:json.dump(v,f,sort_keys=True,indent=2);f.write('\n')
 return ref(p)
assert not base.exists(),'Execution directory already exists; adopt existing receipts, never rerun'
s=importlib.util.spec_from_file_location('export_plan',src);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
prepared=m.prepare(ANALYSIS_REFS,str(base));plan=json.loads(Path(prepared['plan']['path']).read_text())
save(base/'RUN-INTENT.json',{'kind':'corrective-public-export-execution-v1','analysisReadys':ANALYSIS_REFS,'plan':prepared['plan'],'preparer':ref(src),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'modelsInvoked':False,'oneOriginalParityPerStage':True,'publicationAuthorized':False})
terminals=[]
for i,c in enumerate(plan['commands']):
 d=base/'execution'/('%02d-%s-%s'%(i,c['stage'],c['operation']));d.mkdir(parents=True)
 ir=save(d/'INTENT.json',{'command':c,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 env=dict(os.environ);env.update(c.get('env',{}));start=time.time();error=None
 with (d/'stdout.log').open('xb')as out,(d/'stderr.log').open('xb')as err:
  try:
   child=subprocess.Popen(c['argv'],env=env,stdout=out,stderr=err,start_new_session=True);rc=child.wait(timeout=600)
  except subprocess.TimeoutExpired:
   error='original-export-or-parity-command-timeout';os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   rc=-1
 try:os.killpg(child.pid,0);drained=False
 except ProcessLookupError:drained=True
 tr=save(d/'TERMINAL.json',{'returncode':rc,'drained':drained,'intent':ir,'startedAt':start,'endedAt':time.time(),'error':error,'stdout':ref(d/'stdout.log'),'stderr':ref(d/'stderr.log'),'output':c['output']})
 terminals.append(tr)
 if rc or not drained:
  save(base/'FAILED.json',{'failedCommand':c,'terminal':tr,'completedCommands':terminals,'automaticRetry':False})
  print(json.dumps({'state':'failed','terminal':tr},ensure_ascii=True));raise SystemExit(1)
exports={}
for stage in ('development','heldout'):
 pub=base/(stage+'-public');files=sorted(x for x in pub.rglob('*')if x.is_file());assert len(files)==9,(stage,len(files))
 exports[stage]={'directory':str(pub),'files':[ref(p)for p in files],'parityOutput':ref(base/'proofs'/stage/'reproduced.json')}
rr=save(base/'READY.json',{'kind':'corrective-public-export-and-original-parity-ready-v1','state':'complete','analysisReadys':ANALYSIS_REFS,'plan':prepared['plan'],'terminals':terminals,'exports':exports,'ordinaryPythonWithoutIsolatedMode':True,'parityChecksPerStage':1,'modelsInvoked':False,'publicPublication':False,'originalReportsUnmodified':True})
print(json.dumps({'state':'complete','ready':rr,'exports':{k:v['directory']for k,v in exports.items()}},ensure_ascii=True))
