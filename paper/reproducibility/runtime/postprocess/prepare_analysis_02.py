"""Prepare original heldout analysis inputs from exact restored receipts only."""
import argparse,hashlib,importlib.util,json,os
from pathlib import Path
def sha(b):return hashlib.sha256(b).hexdigest()
def raw(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':sha(b),'bytes':len(b)}
def read(r):
 b=Path(r['path']).read_bytes();assert sha(b)==r['sha256'];return json.loads(b)
def save(p,x):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('xb') as f:f.write(raw(x));f.flush();os.fsync(f.fileno())
 return ref(p)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--inputs',required=True);ap.add_argument('--sha256',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
 spec=read({'path':a.inputs,'sha256':a.sha256});collection=read(spec['collection']);out=Path(a.output);assert not out.exists()
 assert collection['allChildrenDrained'] and collection['ownerExecutionClosed'] and not collection['missingRunIds'] and not collection['duplicateRunIds']
 source=spec['analysisSource'];assert sha(Path(source['path']).read_bytes())==source['sha256']
 ms=importlib.util.spec_from_file_location('original_amended_native_analysis',source['path']);m=importlib.util.module_from_spec(ms);ms.loader.exec_module(m)
 api,original=m.load();rows=read(collection['originalRunRows']);receipts=read(collection['receiptInputs'])
 reference={'cohorts':receipts,'heldoutSelection':collection['selection']}
 binding=m.scope_metadata(api,original,reference)
 plan={'version':1,'stage':'heldout','originalRuns':rows,'runs':rows,'originalScheduleHash':original.hash_v1(rows),'scopeHash':None,'mixedScopeBindingHash':original.hash_v1(binding)}
 out.mkdir(parents=True);reference['plan']=save(out/'plan.json',plan)
 value={'kind':'acephale-original-native-analysis-inputs-v1','validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'studyComplete':False,'nativeReference':reference,'scopeAmendmentAuthority':'ROOT-reporting-only-mixed-scope-amendment-20261122','scopeAmendment':binding,'protocolAmendments':[{'kind':'explicit-original-whole-segment-computational-resource-amendment','evidence':collection['scopeAmendment'],'originalModelsDataToolsRunIdsAndOrderUnchanged':True,'actualPerHostScopeProvenanceRetained':True}],'ownerCollection':spec['collection']}
 api.validate_reference(original,value)
 inputs=save(out/'ANALYSIS-INPUTS.json',value);ready=save(out/'READY.json',{'kind':'original-heldout-analysis-inputs-ready-v1','inputs':inputs,'analysisSource':source,'collection':spec['collection'],'statisticsComputed':False,'modelsCalled':False})
 print(json.dumps({'ready':ready,'inputs':inputs}))
if __name__=='__main__':main()
