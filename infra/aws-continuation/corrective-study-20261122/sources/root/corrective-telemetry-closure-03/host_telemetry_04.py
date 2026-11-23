"""Fresh once-only telemetry metadata retry; original cohorts, selection and failed evidence are retained."""
from pathlib import Path
import importlib.util,json,hashlib
HERE=Path(__file__).resolve().parent
def need(x,m):
 if not x:raise ValueError(m)
def module(path):
 spec=importlib.util.spec_from_file_location('telemetry_retry_closure03',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def prepare_host(binding_ref,closed_refs,output):
 closure=module(HERE/'telemetry_closure.py')
 output=Path(output)/'prepared'
 need(output.name=='prepared'and output.parent.name.endswith('-receipt02'),'Explicit fresh telemetry retry directory')
 prior=output.parent.with_name(output.parent.name[:-len('-receipt02')])/'prepared'
 old_ready_ref=closure.ref(prior/'READY.json');old=closure.read(old_ready_ref)
 terminal=closure.read(closure.ref(prior/'worker-terminal.json'))
 need(terminal['status']=='failed'and terminal['envelope']==old['envelope']
      and terminal['failure']['message']=='Canonical immutable receipt differs'
      and 'sealed(proof)'in terminal['failure']['traceback']
      and terminal.get('retainedPartialFiles')==[],'Exact preserved pre-query metadata failure')
 c=closure.read(old['configuration']);binding=closure.read(binding_ref)
 for key in ('resourceAttemptId','instanceId'):need(binding[key]==c[key],'Original host binding unchanged')
 expected=c['lateManagedObservation']['closedResults']
 need(len(closed_refs)==len(expected)==2 and {r['sha256']for r in closed_refs}=={r['sha256']for r in expected},'Exact two actual closed cohorts unchanged')
 for r in closed_refs:closure.checked(r)
 need(not output.parent.exists(),'Fresh isolated retry namespace')
 output.parent.mkdir(parents=True)
 c=dict(c);c['operationId']=c['operationId']+'-receipt02'
 c['retainedPredecessorReady']=old_ready_ref;c['retainedPredecessorTerminal']=closure.ref(prior/'worker-terminal.json')
 cfg=closure.write(output.parent/'configuration.json',c)
 ready_ref=closure.prepare(cfg,output);ready=closure.read(ready_ref)
 before=closure.read(old['selection']);after=closure.read(ready['selection'])
 need(before['selected']==after['selected']and before['selectedTraceCount']==after['selectedTraceCount'],'Original deterministic trace selection unchanged')
 closure.write(output.parent/'RETRY-PREDECESSOR.json',{'priorReady':old_ready_ref,'priorTerminal':c['retainedPredecessorTerminal'],'currentReady':ready_ref,'selectedTraceIdsUnchanged':True,'scientificRerun':False,'modelCalls':False})
 return ready_ref
