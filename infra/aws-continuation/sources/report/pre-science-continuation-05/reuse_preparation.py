"""Reuse verified completed phase zero and adoption; perform no scientific or journal calls."""
from pathlib import Path
import importlib.util,json
def core():
 path=Path(__file__).with_name('continuation.py');spec=importlib.util.spec_from_file_location('same_attempt_metadata_continuation',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def receipt(c,pair):
 value=c.read(pair['result']);c.checked(pair['dispatch'])
 c.need(value.get('completed')is True and type(value.get('exitCode'))is int and value['exitCode']==0 and all(value.get(k)is True for k in ('drained','localOwnedProcessesDrained','providerWatcherDrained')),'Actual completed retained process')
 return {**value,**pair}
def prepare(inp,submission,bindings,work,environment,cwd,gate,owner,run_command):
 c=core();a=c.authority(inp['operationalContinuation']['authority']);c.need(c.ref(__file__)==a['resumePreparation'],'Exact reuse-only preparation source')
 c.need(submission['unitAttemptId']==c.ATTEMPT and submission['inputSha256']==c.INPUT and str(work)==str(c.ROOT/'attempts'/c.ATTEMPT),'Original logical work root')
 gate();phase=Path(work)/'00-current-qualified-inputs';p=phase/'preparation.json';prepared=c.read(c.ref(p))
 c.need(prepared.get('operationalContinuation')=={'path':'/srv/acephale/artifacts/seed17-opportunity-continuation-01.json','sha256':'038f0a1cfd5987f586509602875744b7be0e405ee702fb0ae32d9d05c33c42ca'} and prepared.get('checkpointReused')is True and prepared.get('checkpointRepeated')is False,'Actual previous completed preparation')
 c.need(prepared['checkpoint']==a['checkpoint']and prepared['currentContext']==a['context']and prepared['qualificationOwner']==inp['qualificationPreparation']['qualificationOwner'],'Exact unchanged original checkpoint/context/qualification')
 for r in [prepared['checkpoint'],prepared['currentContext'],prepared['projection'],prepared['qualifiedCompanion'],*prepared['qualifiedFiles']]:c.checked(r)
 context=c.read(prepared['currentContext']);output=Path(bindings['runRoot'])/'downstream/seed17-01/qualified'
 c.need({r['path']for r in prepared['qualifiedFiles']}=={str(output/n)for n in ('manifest.json','profile.json','native.json','guard.json','deployment.json','inventory.json','preparation.json')},'All original qualified files unchanged')
 phases=prepared['operationalPhaseReceipts'];c.need(len(phases)==3,'Three original actual completed processes')
 receipts=[receipt(c,x)for x in phases]
 served=c.read(inp['qualificationPreparation']['qualificationOwner'])['result']
 updated={**bindings,'currentNumericalContextPath':a['context']['path'],'predictorProfilePath':str(output/'profile.json'),'qualifiedNativeConfigurationPath':str(output/'native.json'),'qualifiedDirectory':str(output),'leaseId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'runtimeImageId':served['runtimeImageId'],'runtimeContainerId':served['runtimeContainerId']}
 gate();return updated,context,receipts,c.ref(p)
def reuse_adoption(inp,submission,bindings,work,gate,current_context):
 c=core();a=c.authority(inp['operationalContinuation']['authority']);gate()
 p=Path(bindings['runRoot'])/'calibration-adoption-receipt.json';value=c.read(c.ref(p))
 ctx=c.ref(Path(work)/'calibration-adoption-context.json');dep=c.ref(Path(work)/'analysis-dependency.json')
 c.need(value.get('kind')=='acephale-aws-calibration-adoption-helper-v1'and value.get('completed')is True and value.get('numericalEquivalenceAsserted')is False and value.get('originalArtifactsChanged')is False and value.get('scientificExecutionPerformed')is False,'Actual original completed adoption')
 c.need(value.get('context')==ctx and value.get('dependency')==dep and all(value.get(k)==submission[k]for k in ('unitId','unitAttemptId','resourceAttemptId','instanceId')),'Exact retained adoption identity')
 c.need(all(value.get(k)==inp['calibrationAdoption']['dependency']['outputs'][k]for k in ('calibration','goalReliability')),'Unchanged calibration and reliability')
 for r in (value['adoptionReceipt'],value['calibrationCompanion']):c.checked(r)
 current_context['calibrationCompanion']=value['calibrationCompanion'];current_context['calibrationAdoption']=value['adoptionReceipt'];current_context['calibrationAdoptionHelper']=c.ref(p)
 root=Path(work)/'calibration-adoption-process';result=receipt(c,{'dispatch':c.ref(root/'dispatch.json'),'result':c.ref(root/'result.json')});gate()
 return {**result,'adoptionReceipt':c.ref(p)}
