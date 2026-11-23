"""Prepare exact public export/parity commands from completed original reports. No estimator execution."""
from pathlib import Path
import argparse,hashlib,json
ROOT=Path(__file__).resolve().parent
EXPORTER={'path':'/REQUIRED_BINDINGS/research-root/workspaces/report/native-public-reproduction-01/export_native_reproduction.py','sha256':'7a056b0f5059179f6724ce3ac87e442bf431d9fa17d3aaf277875dd98dae29fd'}
PYTHON='/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/analysis5a/bin/python'
ENV={'LD_LIBRARY_PATH':'/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/python-root/local/lib'}
def need(v,m):
 if not v:raise ValueError(m)
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def read(r,parse=True):
 p=Path(r['path']);need(p.is_absolute(),'Absolute exact ref required');b=p.read_bytes()
 need(hashlib.sha256(b).hexdigest()==r['sha256'],'Pinned bytes differ')
 if 'bytes'in r:need(len(b)==r['bytes'],'Pinned length differs')
 return json.loads(b)if parse else b
def save(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);b=(json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
 with p.open('xb')as f:f.write(b)
 return ref(p)
def prepare(analyses,output):
 need(set(analyses)=={'development','heldout'},'Two actual original analysis READY refs required')
 read(EXPORTER,False);values={}
 for stage,count in (('development',36),('heldout',96)):
  ar=read(analyses[stage]);report=read(ar['nativeReport']);inp=read(ar['input']);read(ar['source'],False)
  need(report['stage']==stage and report['declaredSlots']==count,'Actual stage or denominator differs')
  need(inp['nativeReference']['cohorts'] and len(inp['nativeReference']['cohorts'])==2,'Two original closed cohort refs required')
  plan=read(inp['nativeReference']['plan']);ids=[r['runId']for r in plan['originalRuns']]
  need(len(ids)==count and len(set(ids))==count,'Exact complete original design required')
  values[stage]={'nativeReference':inp['nativeReference'],'analysisReport':ar['nativeReport'],'analysisProducer':ar['source']}
 out=Path(output);need(out.is_absolute()and not out.exists(),'New absolute planning directory required');out.mkdir()
 commands=[]
 for stage in ('development','heldout'):
  ir=save(out/(stage+'-inputs.json'),values[stage]);target=out/(stage+'-public');proof=out/'proofs'/stage;proof.mkdir(parents=True)
  commands.append({'stage':stage,'operation':'public-safe-export','inputs':ir,'source':EXPORTER,'env':ENV,'argv':[PYTHON,'-B',EXPORTER['path'],'--inputs',ir['path'],'--sha256',ir['sha256'],'--output',str(target)],'output':str(target),'statisticsExecuted':False})
  commands.append({'stage':stage,'operation':'single-original-public-reproduction-parity','env':ENV,'argv':[PYTHON,'-B',str(target/'reproduce_native.py'),'--input',str(target/'native-statistical-inputs.json'),'--expected',str(target/'original-numerical-sections.json'),'--output',str(proof/'reproduced.json')],'sourcePinFrom':str(target/'source-binding.json'),'output':str(proof/'reproduced.json'),'meaning':'One explicitly authorized reproduction check using unchanged original functions; not new scientific estimates or model work.'})
 plan={'kind':'corrective-native-public-export-plan-v1','analysisReadys':analyses,'commands':commands,'commandOrderRequired':True,'preparedOnly':True,'executed':False,'publicPublication':False,'noAutomaticRetry':True,'ordinaryPythonRequired':'No -I: unchanged reproduction sources use sibling module imports.'}
 rr=save(out/'COMMANDS.json',plan);return {'plan':rr,'commands':commands}
def main():
 p=argparse.ArgumentParser()
 for stage in ('development','heldout'):
  p.add_argument('--'+stage+'-ready',required=True);p.add_argument('--'+stage+'-sha256',required=True)
 p.add_argument('--output',required=True);a=p.parse_args()
 refs={s:{'path':getattr(a,s+'_ready'),'sha256':getattr(a,s+'_sha256')}for s in ('development','heldout')}
 print(json.dumps(prepare(refs,a.output)))
if __name__=='__main__':main()
