"""Reporting-only mixed-scope amendment; original estimators and raw artifacts remain unchanged."""
import argparse,copy,hashlib,importlib.util,inspect,json,os,types
from pathlib import Path
BASE=Path('/REQUIRED_BINDINGS/research-root/workspaces/report/native-statistics-interface-01/aggregate_native.py')
BASE_SHA='f26c9f62080b3bdaadeb2da8087afb5998cb5fc11ccbac6ac57998615a9e0a9a'
def load():
 assert hashlib.sha256(BASE.read_bytes()).hexdigest()==BASE_SHA
 spec=importlib.util.spec_from_file_location('sealed_native_callback',BASE)
 api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
 m,_=api.load_original()
 return api,m
def scope_metadata(api,m,reference):
 rows=[];globals_seen=[];domain_schemas={};blocks={}
 for rr in reference['cohorts']:
  receipt=json.loads(api.read(rr));directory=Path(rr['path']).parent
  index={r['path']:r['sha256']for r in receipt['files']}
  cr={'path':str(directory/'configuration.json'),'sha256':index['configuration.json']}
  mr={'path':str(directory/'manifest.json'),'sha256':index['manifest.json']}
  c=json.loads(api.read(cr));manifest=json.loads(api.read(mr))
  data=copy.deepcopy(manifest['data']);protocol=copy.deepcopy(manifest['protocol'])
  data.pop('calibrationHash');protocol.pop('scheduleHash')
  raw={'sourceCommit':manifest['sourceCommit'],'actor':manifest['actor'],'data':data,'protocol':protocol,'taskBundleHash':c['taskBundleHash'],'runtime':manifest['runtime'],'hardware':manifest['hardware']}
  raw_hash=m.scope(manifest,c['taskBundleHash'])
  assert raw_hash==m.hash_v1(raw)
  shared=copy.deepcopy(raw);shared.pop('runtime');shared.pop('hardware');schema=shared['data'].pop('toolSchemaHash')
  globals_seen.append(shared)
  ids=[]
  for run in c['runs']:
   block=blocks.setdefault(run['pairedBlockId'],[])
   block.append({'runId':run['runId'],'arm':run['arm'],'rawScopeHash':raw_hash})
   domain_schemas.setdefault(run['domain'],set()).add(schema);ids.append(run['runId'])
  rows.append({'cohortReceipt':rr,'configuration':cr,'manifest':mr,'rawScope':raw,'rawScopeHash':raw_hash,'originalRunIds':ids})
 assert globals_seen and all(v==globals_seen[0]for v in globals_seen),'Global model/data/protocol/source/task-bundle mismatch'
 assert all(len(v)==1 for v in domain_schemas.values()),'Tool schema differs within a domain'
 for block,items in blocks.items():
  assert len(items)==3 and len({r['runId']for r in items})==3
  assert {r['arm']for r in items}=={'base','neutral_memory_prefetch','acephale'}
  assert len({r['rawScopeHash']for r in items})==1,'Within-paired-block original scope mismatch'
 return {'kind':'acephale-explicit-mixed-native-reporting-scopes-v1','rawScopes':rows,'globalCommonFields':globals_seen[0],'domainToolSchemaHashes':{k:next(iter(v))for k,v in domain_schemas.items()},'withinPairedBlockScopeEquality':True,'hardwareHomogeneityAsserted':False,'runtimeImageHomogeneityAsserted':False,'timingValidityUnchanged':True}
def amended_function(api,m,reference,binding):
 exact={str(Path(r['cohortReceipt']['path']).resolve()):r for r in binding['rawScopes']}
 def verify_scope(receipt_path,manifest,config,plan):
  row=exact[str(Path(receipt_path).resolve())]
  return plan.get('scopeHash') is None and m.scope(manifest,config['taskBundleHash'])==row['rawScopeHash'] and plan['mixedScopeBindingHash']==m.hash_v1(binding)
 original=inspect.getsource(m.native_report)
 before="require(config['stage'] == plan['stage'] and scope(manifest, config['taskBundleHash']) == plan['scopeHash'], 'Native scope differs from frozen complete cohort')"
 after="require(config['stage'] == plan['stage'] and verify_amended_scope(receipt_path, manifest, config, plan), 'Native scope differs from explicit amended reporting binding')"
 assert original.count(before)==1
 changed=original.replace(before,after)
 assert changed.replace(after,before)==original
 g=dict(m.native_report.__globals__);g['ROOT']=BASE.parent/'dependencies';g['verify_amended_scope']=verify_scope
 exec(compile(changed,str(Path(__file__).resolve())+':original-native-report-with-one-scope-gate','exec'),g)
 assert g['report_trials'] is m.report_trials and g['safe_native_row'] is m.safe_native_row and g['_paired_interval'] is m._paired_interval and g['summarize_costs'] is m.summarize_costs
 return g['native_report'],{'originalFunctionSourceSha256':hashlib.sha256(original.encode()).hexdigest(),'amendedFunctionSourceSha256':hashlib.sha256(changed.encode()).hexdigest(),'onlyChangedStatement':{'before':before,'after':after},'originalEstimatorsUnchanged':True}
def main():
 p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);args=p.parse_args()
 api,m=load();value=json.loads(api.read({'path':args.inputs,'sha256':args.sha256}))
 reference=api.validate_reference(m,value)
 assert value['scopeAmendmentAuthority']=='ROOT-reporting-only-mixed-scope-amendment-20261122'
 binding=scope_metadata(api,m,reference);assert binding==value['scopeAmendment']
 plan=json.loads(api.read(reference['plan']));assert plan['scopeHash']is None and plan['mixedScopeBindingHash']==m.hash_v1(binding)
 out=Path(args.output);assert out.is_absolute()and not out.exists()and not any(p.is_symlink()for p in out.parents)
 function,derivation=amended_function(api,m,reference,binding);inputs={};metrics=function(reference,inputs)
 for path,digest in inputs.items():api.read({'path':path,'sha256':digest})
 out.mkdir(parents=True);api.write(out/'native-report.json',api.raw(metrics));api.write(out/'raw-scope-binding.json',api.raw(binding));api.write(out/'reporting-amendment.json',api.raw(derivation))
 result={'kind':'acephale-direct-original-native-analysis-output-v1','validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'studyComplete':False,'modelsCalled':False,'liveLedgerOpened':False,'canonicalClaimsMutated':False,'originalStatisticalEstimatorsUnchanged':True,'outerScopeGateAmended':True,'originalNativeReportStatusMeaning':'Complete original slot/evidence coverage only, not qualified or canonical acceptance.','input':api.ref(args.inputs),'source':api.ref(__file__),'sealedParentCallback':api.ref(BASE),'nativeReport':api.ref(out/'native-report.json'),'scopeBinding':api.ref(out/'raw-scope-binding.json'),'derivation':api.ref(out/'reporting-amendment.json'),'sourceInputs':inputs,'sourcePins':api.PINS,'protocolAmendments':value['protocolAmendments'],'recordedCostScope':'Provider-usage ledger evidence, not invoice reconciliation.','latencyValidity':'Original rules unchanged; invalid rows excluded, no homogeneous hardware/timing assertion.'}
 api.write(out/'READY/result.json',api.raw(result))
 print(json.dumps({'ready':api.ref(out/'READY/result.json'),'nativeReport':api.ref(out/'native-report.json')}))
if __name__=='__main__':main()
