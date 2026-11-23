"""Finite paper-only child. Uses already-computed analysis; never invokes an estimator."""
from pathlib import Path
import argparse,importlib.util,json,traceback
CONT={'path':'/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-report-continuation-02/continuation.py','sha256':'e19b5979fc1a5d71b1039f5f636c1def8fa2013196ee8b7697b2b9d3268741c1'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 import hashlib
 path=Path(CONT['path']);assert hashlib.sha256(path.read_bytes()).hexdigest()==CONT['sha256']
 spec=importlib.util.spec_from_file_location('finite_paper_io',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 ir={'path':a.inputs,'sha256':a.sha256};v=m.read(ir);root=Path(a.output);root.mkdir(parents=True,exist_ok=True)
 with m.lock(root/'LOCK'):
  done=root/'TERMINAL.json'
  if done.exists():print(json.dumps(m.read(m.ref(done))));return
  m.need(not(root/'RUN-INTENT.json').exists(),'Existing unresolved paper intent; reconcile instead of duplicate')
  m.save(root/'RUN-INTENT.json',{'inputs':ir,'source':m.ref(__file__),'statisticsInvoked':False})
  try:
   for r in v['sources'].values():m.check(r)
   argv=[str(m.RENDER_PY),'-I','-B',v['sources']['paper']['path'],'--inputs',a.inputs,'--sha256',a.sha256,'--output',str(root/'paper')]
   m.run_step(root,'final-private-paper',argv,timeout=1500)
   ready=m.read(m.ref(root/'paper/READY.json'))
   result={'state':'completed-private-final-candidate','returncode':0,'drained':True,'paper':m.ref(root/'paper/READY.json'),'pdf':ready['pdf'],'editable':ready['editable'],'statisticsInvoked':False,'publicPublication':False,'studyComplete':False,'rootReviewRequired':True}
  except BaseException as exc:
   er=m.save(root/'ERROR.json',{'errorType':type(exc).__name__,'message':str(exc),'traceback':traceback.format_exc(),'noAutomaticRetry':True})
   result={'state':'failed-retained','returncode':1,'drained':True,'error':er,'statisticsInvoked':False}
  m.save(done,result);print(json.dumps(result));raise SystemExit(result['returncode'])
if __name__=='__main__':main()
