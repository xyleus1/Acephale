"""Bind exact final host closures to unchanged original telemetry selection and query."""
from pathlib import Path
import importlib.util,json
HERE=Path(__file__).resolve().parent
def module():
 s=importlib.util.spec_from_file_location('late_telemetry_closure',HERE/'telemetry_closure.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def prepare_host(binding_ref,closed_result_refs,output):
 m=module();b=m.read(binding_ref)
 m.need(b['kind']=='acephale-corrective-telemetry-host-binding-v1','Exact corrective host binding')
 m.need(len(closed_result_refs)==2,'Both final host cohorts required')
 rows=[];seen=set()
 for cr in closed_result_refs:
  c=m.read(cr)
  m.need(c['kind']=='acephale-corrective-native-closed-result-v1' and c['closed'] is True and c['drained'] is True and c['allDeclaredSlotsRetained'] is True,'Closed and drained actual cohort required')
  m.need(c['resourceAttemptId']==b['resourceAttemptId'] and c['instanceId']==b['instanceId'],'Exact host closure required')
  m.need(c['originalSemanticUnit'] not in seen,'Duplicate host segment');seen.add(c['originalSemanticUnit'])
  rows.append({'directory':c['cohortDirectory'],'receipt':c['cohortReceipt'],'rawIndex':c['rawIndex'],'terminal':c['terminal'],'originalReceiptPath':str(Path(c['originalCohortDirectory'])/'cohort-receipt.json')})
 m.need(seen==set(b['expectedSemanticUnits']),'Last original host segment has not closed')
 config={k:b[k] for k in ('operationId','providerLease','providerReceipt','servingReceipt','resourceAttemptId','instanceId','sourceDirectory','occurrenceId','bucket','region','pythonExecutable')}
 config.update(kind='acephale-native-telemetry-closure-input-v1',closedCohorts=rows,lateManagedObservation={'expectedSemanticUnits':b['expectedSemanticUnits'],'closedResults':closed_result_refs},hostBinding=binding_ref)
 out=Path(output);m.need(not out.exists(),'Fresh output root');out.mkdir(parents=True)
 cfg=m.write(out/'configuration.json',config)
 return m.prepare(cfg,out/'prepared')
