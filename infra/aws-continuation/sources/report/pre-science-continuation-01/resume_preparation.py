"""Resume only the unexecuted qualified-input suffix; retain the original checkpoint."""
from pathlib import Path
import importlib.util,json
def core():
 path=Path(__file__).with_name('continuation.py')
 spec=importlib.util.spec_from_file_location('same_attempt_continuation',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def prepare(inp,submission,bindings,work,environment,cwd,gate,owner,run_command):
 c=core();a=c.authority(inp['operationalContinuation']['authority']);c.need(c.ref(__file__)==a['resumePreparation'],'Exact resumed preparation source')
 c.need(submission['unitAttemptId']==c.ATTEMPT and submission['inputSha256']==c.INPUT and str(work)==str(c.ROOT/'attempts'/c.ATTEMPT),'Original logical work root')
 m=c.read(a['sourceMap']);old={'path':'/srv/acephale/workspaces/operator/cloud-native-worker-02/qualified_preparation.py','sha256':'d04695c78576c5ae7ef4c84066d3b0325017030c73532b0f6f36b0f3f72772fd'}
 original=c.load('regional_qualified_preparation',c.mapped(m,old))
 spec=inp['qualificationPreparation']
 for key,value in [('inputBase',original.BASE),('qualifiedProducer',original.QUALIFIED),('projectionSource',original.PROJECTION),('numericalAdapter',original.NUMERICAL),('checkpointSource',original.CHECKPOINT),('contractsSource',original.CONTRACTS)]:
  c.need(spec[key]==value,'Exact approved remaining preparation '+key);c.checked(value)
 oldphase=Path(work)/'00-current-qualified-inputs';phase=Path(work)/'operational-generations/01/current-qualified-inputs';phase.mkdir(exist_ok=False)
 context=c.read(a['context']);configuration=c.read(a['qualifiedConfiguration']);checkpoint=c.checked(a['checkpoint'])
 c.need(configuration['currentContext']==a['context'] and configuration['ledgerCheckpointPath']==str(checkpoint),'Original configuration/context/checkpoint unchanged')
 c.need(context['unitId']==c.UNIT and context['unitAttemptId']==c.ATTEMPT and context['inputSha256']==c.INPUT and context['resourceAttemptId']==c.RESOURCE and context['instanceId']==c.INSTANCE,'Exact retained current context')
 c.need(context['currentQualification']==spec['qualificationOwner'],'Same actual completed qualification')
 root=Path(bindings['runRoot']);occurrence=context['occurrenceId'];c.need(root==c.ROOT/'runs'/c.ATTEMPT and occurrence=='seed17-01','Original run/occurrence')
 output=root/'downstream'/occurrence/'qualified';c.need(not output.exists(),'Failed producer output must still be absent')
 checkpoint_result=c.read(a['checkpointResult']);c.need(checkpoint_result['completed']is True and checkpoint_result['exitCode']==0 and checkpoint_result['drained']is True,'Reused actual original checkpoint process')
 receipts=[{**checkpoint_result,'dispatch':a['checkpointDispatch'],'result':a['checkpointResult']}];gate()
 receipts.append(run_command([bindings['analysisPython'],original.QUALIFIED['path'],'--configuration',a['qualifiedConfiguration']['path'],'--output',str(output)],cwd=cwd,environment=environment,maximum_seconds=300,hard_deadline=submission['hardDeadline'],output=phase/'qualified-process',gate=gate,owner=owner))
 for name in original.NAMES:c.checked(c.ref(output/name))
 companion=root/'downstream'/occurrence/'numerical-policy/qualified.json'
 receipts.append(run_command([bindings['analysisPython'],c.mapped(m,old)['path'],'companion','--context',a['context']['path'],'--context-sha256',a['context']['sha256'],'--qualified-directory',str(output)],cwd=cwd,environment=environment,maximum_seconds=90,hard_deadline=submission['hardDeadline'],output=phase/'companion-process',gate=gate,owner=owner))
 c.checked(c.ref(companion));gate()
 served=c.read(spec['qualificationOwner'])['result']
 updated={**bindings,'currentNumericalContextPath':a['context']['path'],'predictorProfilePath':str(output/'profile.json'),'qualifiedNativeConfigurationPath':str(output/'native.json'),'qualifiedDirectory':str(output),'leaseId':submission['resourceAttemptId'],'instanceId':submission['instanceId'],'runtimeImageId':served['runtimeImageId'],'runtimeContainerId':served['runtimeContainerId']}
 receipt={'kind':'acephale-aws-current-qualified-preparation-v1','unitId':c.UNIT,'unitAttemptId':c.ATTEMPT,'resourceAttemptId':c.RESOURCE,'qualificationOwner':spec['qualificationOwner'],'currentContext':a['context'],'projection':context['servingProjection'],'checkpoint':a['checkpoint'],'qualifiedFiles':[c.ref(output/n)for n in original.NAMES],'qualifiedCompanion':c.ref(companion),'operationalPhaseReceipts':[{'dispatch':r['dispatch'],'result':r['result']}for r in receipts],'originalScientificStepsChanged':False,'originalExportReclaimed':False,'operationalContinuation':inp['operationalContinuation']['authority'],'checkpointReused':True,'checkpointRepeated':False}
 path=oldphase/'preparation.json';c.write(path,receipt)
 return updated,context,receipts,c.ref(path)
