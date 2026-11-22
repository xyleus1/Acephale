"""Prepare reporting-only input files from immutable completed owner artifacts."""
import argparse,copy,hashlib,json,os
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
 spec=read({'path':a.inputs,'sha256':a.sha256});out=Path(a.output);assert not out.exists();out.mkdir(parents=True)
 if spec['phase']=='direct':
  value=read(spec['directTemplate']);old=value.get('collections',[]);predecessors=[]
  for c in old:
   predecessors.extend([c[k] for k in ('outcomes','provenance','receipts','ownerDisposition') if c.get(k)]);predecessors.extend(c.get('costs',[]))
  collections=[]
  for n,report in enumerate(spec['developmentReports']):
   read(report);d=Path(report['path']).parent
   collections.append({'stage':'development','outcomes':ref(d/'outcomes.jsonl'),'provenance':ref(d/'raw-provenance.json'),'receipts':ref(d/'receipt-inputs.json'),'ownerDisposition':None,'predecessors':predecessors if n==0 else [],'costs':[ref(d/'observed-cost-subset.json')]})
  heldout=read(spec['collection'])
  collections.append({'stage':'heldout','outcomes':heldout['outcomes'],'provenance':heldout['provenance'],'receipts':heldout['receiptInputs'],'ownerDisposition':None,'predecessors':[],'costs':[]})
  value['collections']=collections;value['selection']=spec['selection'];value['financialReport']=None
  value['financialReportMissingReason']='Final original-owner post-heldout financial snapshot has not been supplied; recorded per-run usage is retained and is not a reconciled invoice.'
  for unit,label,rr in [('development/2','Both original development seeds:36 arm-runs',spec['developmentAnalysis']),('heldout/2','Both original selected heldout segments',spec['heldoutAnalysis'])]:
   r=read(rr);value['reports'].append({'unitId':unit,'label':label,'artifact':r['nativeReport'],'producerSource':r['source']})
  value['ownerResultCollection']=spec['collection'];value['financialAsOfEvidence']=spec.get('financialAsOfEvidence')
  result=save(out/'INPUTS.json',value)
 else:
  assert spec['phase']=='paper';value=read(spec['paperTemplate']);value['reportReady']=spec['directReport'];value['ownerClosure']=None
  value['missingAnalysisReasons']=['Canonical qualified-study closure remains incomplete; direct research results do not erase the original opportunity minimum-size failures.','Final owner-ledger/invoice reconciliation is not asserted by this report.']
  for label,rr in [('UNVALIDATED original development',spec['developmentAnalysis']),('UNVALIDATED selected heldout',spec['heldoutAnalysis'])]:
   r=read(rr);report=read(r['nativeReport']);fields=[{'label':'Declared original arm-runs','pointer':'/declaredSlots'}]
   for arm in ('base','neutral_memory_prefetch','acephale'):
    for key in ('successes','scheduled_trials','latency_samples','logical_calls','physical_calls'):
     if key in report.get('nativeCompletionAndLiveLatency',{}).get('arms',{}).get(arm,{}):fields.append({'label':arm+' '+key,'pointer':'/nativeCompletionAndLiveLatency/arms/'+arm+'/'+key})
    for key in ('knownConstraintCleanPass1','hostedUsage'):
     if key in report.get('additionalArmMetrics',{}).get(arm,{}):fields.append({'label':arm+' '+key,'pointer':'/additionalArmMetrics/'+arm+'/'+key})
   value.setdefault('analysisDisplays',[]).append({'label':label,'sourceSha256':r['nativeReport']['sha256'],'estimand':'Literal original native-report values; all failures retained, configured constraint results distinct from reward, invalid timings excluded. Joint actor/predictor-seed comparisons retain original confounding.','fields':fields})
  result=save(out/'INPUTS.json',value)
 ready=save(out/'READY.json',{'kind':'root-original-result-reporting-inputs-v1','phase':spec['phase'],'inputs':result,'modelsCalled':False,'statisticsRecomputed':False,'canonicalAcceptance':False})
 print(json.dumps({'ready':ready,'inputs':result}))
if __name__=='__main__':main()
