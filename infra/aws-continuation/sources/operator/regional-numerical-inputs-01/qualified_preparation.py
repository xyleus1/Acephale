"""Explicit operational preparation before an original frozen scientific job.

No scientific claim, provider mutation, model call or journal write is performed
by this module itself. The original checkpoint/qualified CLI run as separately
owned commands supplied by the reviewed worker.
"""
from pathlib import Path
import argparse, copy, hashlib, importlib.util, json, os, sys

SCIENCE='5a36a8b3835820fe65b3615ead31fb6fb7bc9672'
QUALIFIED = {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/prepare_qualified_predictor.py', 'sha256': '593ba52ff53e65d8e400c66ef078eda778a3805a13b6379ece44df49001c57a8'}
PROJECTION = {'path': '/srv/acephale/workspaces/report/cloud-controller-01/serving_projection.py', 'sha256': 'ffed2d66cbb452c2423a438a2c744ca05f5cf2cfc5aab49ce97c153eda1caf41'}
NUMERICAL = {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/closure02/closure_adapter.py', 'sha256': '1f6035beb63571a879bf6ed1d5350f7b079ac6b7a2fcf5bb3c328bf19a6b4714'}
BASE = {'path': '/srv/acephale/workspaces/report/cloud-qualified-inputs-01/input-base.json', 'sha256': 'daff3089f6878d71de1267f5a9c562b3b23980f50cca2b28066b17a928932cd1'}
CONTRACTS = {'path': '/srv/acephale/workspaces/operator/science-source/research/acephale/src/acephale/contracts_v1.py', 'sha256': '97278a1e78f7fe1eda41983116f69082de7b5622587808d621c348bedd61da5e'}
CHECKPOINT = {'path': '/srv/acephale/workspaces/operator/science-source/scripts/acephale-infra-native.ts', 'sha256': 'b177f74239c36432d90aa515efe4172c6bdd236bc304b302e80c2c96d06e5454'}
SCIENCE_ROOT='/srv/acephale/workspaces/operator/science-source'
JOURNAL='/srv/acephale/shared/budget.jsonl'
NAMES=('manifest.json','profile.json','native.json','guard.json','deployment.json','inventory.json','preparation.json')

def need(value,message):
 if not value: raise ValueError(message)
def ref(path):
 p=Path(path)
 with p.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
 return {'path':str(p),'sha256':digest}
def checked(row):
 need(type(row) is dict and set(row)=={'path','sha256'},'Exact FileRef')
 p=Path(row['path']);need(p.is_absolute() and p.is_file() and not any(x.is_symlink() for x in (p,*p.parents)),'Regular absolute source or evidence')
 need(ref(p)==row,'Exact source/evidence bytes')
 return p
def read(row):return json.loads(checked(row).read_text())
def write(path,value):
 p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('x') as stream:json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
def module(name,row):
 p=checked(row);prior=sys.modules.get(name)
 need(prior is None,'Fresh operational helper module required')
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);sys.modules[name]=m
 try:spec.loader.exec_module(m)
 except BaseException:sys.modules.pop(name,None);raise
 return m

def prepare(inp,submission,bindings,work,environment,cwd,gate,owner,run_command):
 spec=inp['qualificationPreparation']
 need(spec['inputBase']==BASE and spec['qualifiedProducer']==QUALIFIED and spec['projectionSource']==PROJECTION and spec['numericalAdapter']==NUMERICAL,'Exact reviewed preparation sources')
 need(spec['checkpointSource']==CHECKPOINT and spec['contractsSource']==CONTRACTS,'Original checkpoint and canonicalizer')
 for row in (BASE,QUALIFIED,PROJECTION,NUMERICAL,CHECKPOINT,CONTRACTS):checked(row)
 need(str(cwd)==SCIENCE_ROOT and bindings['scienceSourceDirectory']==SCIENCE_ROOT,'Exact current frozen science checkout')
 need(submission['journalOwnerRequired'] is True,'Original current checkpoint requires global journal owner')
 current=read(spec['qualificationOwner']);served=current['result'];deployment=read(current['deployment'])
 need(current.get('operationalSourceCorrection')==spec.get('operationalSourceCorrection'),'Exact explicit operational source correction or direct qualification')
 need(current.get('operationalResume')==spec.get('operationalResume'),'Exact independently reviewed operational resume provenance')
 need(current.get('diagnosticPhaseResume')==spec.get('diagnosticPhaseResume'),'Exact independently reviewed distinct diagnostic phase provenance')
 need(current.get('completed') is True and current.get('ownedProcessesDrained') is True and current.get('failureType') is None and current.get('drainErrors')==[],'Actual completed and drained operational qualification')
 need(served.get('completed') is True and served.get('sourceCommit')==SCIENCE and served.get('originalNumericalGateUnchanged') is True,'Original serving qualification completed')
 need(served['leaseId']==submission['resourceAttemptId'] and served['instanceId']==submission['instanceId'] and deployment['hardDeadline']==submission['hardDeadline'],'Exact current resource identity')
 job=read(inp['job']);occurrence=job['occurrenceId'];seed=job.get('predictorTrainingSeed',served['seed'])
 need(served['occurrenceId']==occurrence and served['seed']==seed,'Actual qualified original seed/occurrence')
 root=Path(bindings['runRoot']);need(root.parent==Path('/srv/acephale/runs') and root.name==submission['unitAttemptId'] and not root.exists(),'Fresh per-scientific-attempt run root')
 phase=Path(work)/'00-current-qualified-inputs';phase.mkdir(exist_ok=False)
 gate()
 projection=module('aws_current_serving_projection',PROJECTION)
 try:
  projection_ref=projection.materialize({'kind':'acephale-aws-serving-projection-input-v1','qualificationOwner':spec['qualificationOwner'],'actualPrecisionSource':served['actualPrecisionSource'],'hardwareBinding':served['hardwareBinding'],'deployment':current['deployment'],'occurrenceId':occurrence,'runRoot':str(root),'contractsSource':CONTRACTS})
 finally:sys.modules.pop('aws_current_serving_projection',None)
 gate()
 context={'kind':'acephale-aws-current-numerical-context-v1','unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'inputSha256':submission['inputSha256'],'attemptOutput':str(work),'scienceSourceDirectory':SCIENCE_ROOT,'currentQualification':spec['qualificationOwner'],'currentPrecisionSource':served['actualPrecisionSource'],'hardwareBinding':served['hardwareBinding'],'servingProjection':projection_ref,'runRoot':str(root),'resourceAttemptId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'occurrenceId':occurrence,'hardDeadline':submission['hardDeadline']}
 context_path=phase/'current-numerical-context.json';write(context_path,context)
 checkpoint=root/'downstream/checkpoints'/('qualified-'+occurrence+'.json');checkpoint.parent.mkdir(parents=True)
 node=bindings['nodeExecutable'];python=bindings['analysisPython']
 argv=[node,'--import','tsx','scripts/acephale-infra-native.ts','checkpoint',JOURNAL,str(checkpoint)]
 receipts=[run_command(argv,cwd=cwd,environment=environment,maximum_seconds=90,hard_deadline=submission['hardDeadline'],output=phase/'checkpoint-process',gate=gate,owner=owner)]
 checked(ref(checkpoint))
 config={**read(BASE),'currentContext':ref(context_path),'occurrenceId':occurrence,'predictorTrainingSeed':seed,'ledgerCheckpointPath':str(checkpoint),'experimentId':'acephale-e29-qualified-'+occurrence}
 configuration=phase/'qualified-configuration.json';write(configuration,config)
 output=root/'downstream'/occurrence/'qualified'
 receipts.append(run_command([python,QUALIFIED['path'],'--configuration',str(configuration),'--output',str(output)],cwd=cwd,environment=environment,maximum_seconds=300,hard_deadline=submission['hardDeadline'],output=phase/'qualified-process',gate=gate,owner=owner))
 for name in NAMES:checked(ref(output/name))
 companion=root/'downstream'/occurrence/'numerical-policy/qualified.json'
 receipts.append(run_command([python,str(Path(__file__).resolve()),'companion','--context',str(context_path),'--context-sha256',ref(context_path)['sha256'],'--qualified-directory',str(output)],cwd=cwd,environment=environment,maximum_seconds=90,hard_deadline=submission['hardDeadline'],output=phase/'companion-process',gate=gate,owner=owner))
 checked(ref(companion));gate()
 updated={**bindings,'currentNumericalContextPath':str(context_path),'predictorProfilePath':str(output/'profile.json'),'qualifiedNativeConfigurationPath':str(output/'native.json'),'qualifiedDirectory':str(output),'leaseId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'runtimeImageId':served['runtimeImageId'],'runtimeContainerId':served['runtimeContainerId']}
 receipt={'kind':'acephale-aws-current-qualified-preparation-v1','unitId':submission['unitId'],'unitAttemptId':submission['unitAttemptId'],'resourceAttemptId':submission['resourceAttemptId'],'qualificationOwner':spec['qualificationOwner'],'currentContext':ref(context_path),'projection':projection_ref,'checkpoint':ref(checkpoint),'qualifiedFiles':[ref(output/n) for n in NAMES],'qualifiedCompanion':ref(companion),'operationalPhaseReceipts':[{'dispatch':r['dispatch'],'result':r['result']} for r in receipts],'originalScientificStepsChanged':False,'originalExportReclaimed':False}
 write(phase/'preparation.json',receipt)
 return updated,context,receipts,ref(phase/'preparation.json')

def companion(context_ref,output):
 context=read(context_ref);output=Path(output)
 need(output==Path(context['runRoot'])/'downstream'/context['occurrenceId']/'qualified','Original qualified output layout')
 parent=str(checked(NUMERICAL).parent);sys.path.insert(0,parent)
 try:
  adapter=module('aws_qualified_companion_admission',NUMERICAL)
  precision,_=adapter.current_numerical_inputs(context,adapter.ORIGINAL_SOURCES)
  with adapter.original_modules(adapter.ORIGINAL_SOURCES,context['scienceSourceDirectory'],precision) as modules:
   path=modules.numerical.companion(context['runRoot'],context['occurrenceId'],'qualified',[output/n for n in NAMES])
  adapter.current_numerical_inputs(context,adapter.ORIGINAL_SOURCES)
  return ref(path)
 finally:
  sys.modules.pop('aws_qualified_companion_admission',None);sys.path.remove(parent)

def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['companion']);p.add_argument('--context',required=True);p.add_argument('--context-sha256',required=True);p.add_argument('--qualified-directory',required=True)
 a=p.parse_args();print(json.dumps(companion({'path':a.context,'sha256':a.context_sha256},a.qualified_directory)))
if __name__=='__main__':main()
