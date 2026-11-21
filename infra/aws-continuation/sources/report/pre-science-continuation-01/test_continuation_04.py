from pathlib import Path
import ast,copy,importlib.util,json,tempfile,types,unittest
from unittest.mock import patch
D=Path(__file__).parent;F=D/'fixtures'
sp=importlib.util.spec_from_file_location('continuation',D/'continuation.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.failed=json.loads((F/'failed.json').read_text());self.sub=json.loads((F/'submission.json').read_text());self.inp=json.loads((F/'input.json').read_text())
  self.a={**json.loads((F/'selected-refs.json').read_text()),'failedResult':{'key':m.PREFIX+'/result.json','sha256':m.FAILED},'submission':{'key':'submission','sha256':'x'},'hardDeadline':self.sub['hardDeadline'],'controllerSource':{'path':'/reviewed/controller.py','sha256':'c'*64}}
  self.docs={self.a[k]['path']:json.loads((F/(k+'.json')).read_text())for k in ('checkpointResult','checkpointDispatch','context','qualifiedConfiguration','failedProcess')}
 def evidence(self):
  def checked(r):return F/'failedStderr.log'if r==self.a['failedStderr']else Path(r['path'])
  with patch.object(m,'s3_json',side_effect=lambda _,r:self.failed if r==self.a['failedResult']else self.sub),patch.object(m,'checked',side_effect=checked),patch.object(m,'read',side_effect=lambda r:self.docs[r['path']]),patch.object(Path,'exists',return_value=False),patch.object(Path,'rglob',return_value=iter(())),patch.object(m.os.path,'lexists',return_value=False):
   return m.original_evidence(self.a,object())
 def test_actual_failed_phase_and_checkpoint(self):
  s,f=self.evidence();self.assertEqual(s['unitAttemptId'],m.ATTEMPT);self.assertEqual(len(f['durableArtifacts']),25)
 def test_failed_measurement_cannot_resume(self):
  self.failed['durableArtifacts'].append({'path':str(m.ROOT/'attempts'/m.ATTEMPT/'02-measure-and-aggregate/process/dispatch.json'),'sha256':'x'})
  with self.assertRaisesRegex(ValueError,'No original scientific'):self.evidence()
 def test_undrained_child_cannot_resume(self):
  self.docs[self.a['failedProcess']['path']]['drained']=False
  with self.assertRaisesRegex(ValueError,'ownership/drain'):self.evidence()
 def test_wrong_failure_phase_rejects(self):
  self.docs[self.a['failedProcess']['path']]['exitCode']=0
  with self.assertRaisesRegex(ValueError,'qualified producer failed'):self.evidence()
 def test_failed_checkpoint_never_repeated(self):
  self.docs[self.a['checkpointResult']['path']]['completed']=False
  with self.assertRaisesRegex(ValueError,'successful checkpoint'):self.evidence()
 def test_atomic_reopen_never_replaces_assignment_or_stop_flags(self):
  t=m.activation_transaction(self.a,{'path':'/authority','sha256':'a'*64});self.assertEqual([next(iter(x))for x in t],['ConditionCheck','Update','Put'])
  u=t[1]['Update'];self.assertIn('attribute_not_exists(operationalContinuation)',u['ConditionExpression']);self.assertIn('resultSha256=:hash',u['ConditionExpression'])
  self.assertNotIn('attemptId=',u['UpdateExpression']);self.assertNotIn('capacityEnabled',str(t));self.assertNotIn('stopRequested=',u['UpdateExpression'])
 def test_other_owner_is_atomically_excluded(self):
  p=m.activation_transaction(self.a,{'path':'/authority','sha256':'a'*64})[2]['Put']
  self.assertEqual(p['ConditionExpression'],'attribute_not_exists(pk) OR (unitId=:unit AND attemptId=:attempt AND permanentUntilObservedDrain=:yes)')
  self.assertEqual(p['ExpressionAttributeValues'][':attempt'],{'S':m.ATTEMPT})
 def test_existing_generation_never_reexecutes(self):
  tmp=tempfile.TemporaryDirectory(dir=D);self.addCleanup(tmp.cleanup);root=Path(tmp.name);(root/'attempts'/m.ATTEMPT/'operational-generations/01').mkdir(parents=True)
  with patch.object(m,'ROOT',root),patch.object(m,'original_evidence',return_value=(self.sub,self.failed)),patch.object(m,'source_map',return_value={}),patch.object(m,'claim_gate',return_value={}):
   with self.assertRaises(FileExistsError):m.execute(self.a,{},None,None)
 def test_input_substitution_exact_and_original_unchanged(self):
  mapping=m.read(m.MAP);original=copy.deepcopy(self.inp)
  a={'runner':{'path':'/runner','sha256':'1'*64},'resumePreparation':{'path':'/resume','sha256':'2'*64},'sourceMap':m.MAP}
  with patch.object(m,'ref',return_value={'path':'/authority','sha256':'3'*64}):out=m.project_input(self.inp,a,mapping)
  self.assertEqual(self.inp,original);self.assertEqual(out['job'],original['job']);self.assertEqual(out['bindings'],original['bindings']);self.assertEqual(out['environment'],original['environment']);self.assertEqual(out['unitScientificIds'],original['unitScientificIds'])
  self.assertEqual(out['qualificationPreparation']['workerHelper'],a['resumePreparation'])
 def test_worker_execute_scientific_body_unchanged(self):
  mapping=m.read(m.MAP);r=next(x for x in mapping['sourceMap']if x['original']['path'].endswith('/worker.py'))
  def functions(p):return{n.name:ast.dump(n,include_attributes=False)for n in ast.parse(Path(p).read_text()).body if isinstance(n,ast.FunctionDef)}
  self.assertEqual(functions(r['original']['path']),functions(r['replacement']['path']))
 def test_prepare_suffix_has_no_checkpoint_or_projection_dispatch(self):
  s=(D/'resume_preparation.py').read_text();tree=ast.parse(s);calls=[n for n in ast.walk(tree)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='run_command']
  self.assertEqual(len(calls),2);self.assertNotIn('.materialize(',s);self.assertNotIn("'checkpoint',",s)
 def test_generation_result_cannot_relabel_original_worker(self):
  route={'authority':{'path':'/a','sha256':'a'*64},'worker':{'sha256':'b'*64}}
  r={'operationalContinuation':route['authority'],'operationalExecutionGeneration':'01','originalFailedResultSha256':m.FAILED,'originalInputSha256':m.INPUT,'workerSha256':'wrong'}
  with self.assertRaisesRegex(ValueError,'Actual executing'):m.verify_result(r,route)
 def test_result_pending_does_not_invoke_original_launcher(self):
  p=D.parent/'full-dag-controller-07/controller.py';sp=importlib.util.spec_from_file_location('current_controller',p);c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
  ctl=c.Controller.__new__(c.Controller);ctl.replay_journal_boundary=lambda s:None
  ctl.operational_route=lambda s:(None,{'key':m.RESULT_KEY})
  class Missing(Exception):response={'Error':{'Code':'NoSuchKey'}}
  class Store:
   def get(self,*a):raise Missing()
  ctl.store=Store();ctl.ensure_dispatch=lambda _:self.fail('Original launcher must never repeat after approved generation')
  self.assertTrue(ctl.collect(self.sub)['awaitingApprovedOperationalGeneration'])

 def test_actual_prepare_suffix_reuses_checkpoint_and_calls_only_two_children(self):
  sp=importlib.util.spec_from_file_location('resume_preparation',D/'resume_preparation.py');p=importlib.util.module_from_spec(sp);sp.loader.exec_module(p)
  mapping=m.read(m.MAP);old=self.inp['qualificationPreparation']['workerHelper'];replacement=m.mapped(mapping,old)
  original=m.load('real_regional_preparation_fixture',replacement)
  tmp=tempfile.TemporaryDirectory(dir=D);self.addCleanup(tmp.cleanup);root=Path(tmp.name);work=root/'attempts'/m.ATTEMPT;phase=work/'00-current-qualified-inputs';phase.mkdir(parents=True);(work/'operational-generations/01').mkdir(parents=True)
  run=root/'runs'/m.ATTEMPT;checkpoint=run/'downstream/checkpoints/qualified-seed17-01.json';checkpoint.parent.mkdir(parents=True);checkpoint.write_text('{"originalCheckpoint":true}')
  old_bytes=checkpoint.read_bytes();ccontext=copy.deepcopy(self.docs[self.a['context']['path']]);ccontext['runRoot']=str(run)
  cfg=copy.deepcopy(self.docs[self.a['qualifiedConfiguration']['path']]);contextpath=phase/'current-numerical-context.json';contextpath.write_text(json.dumps(ccontext));configpath=phase/'qualified-configuration.json';cfg['currentContext']=m.ref(contextpath);cfg['ledgerCheckpointPath']=str(checkpoint);configpath.write_text(json.dumps(cfg))
  crpath=phase/'checkpoint-result.json';crpath.write_text(json.dumps(self.docs[self.a['checkpointResult']['path']]))
  a={**self.a,'resumePreparation':m.ref(D/'resume_preparation.py'),'sourceMap':m.MAP,'context':m.ref(contextpath),'qualifiedConfiguration':m.ref(configpath),'checkpoint':m.ref(checkpoint),'checkpointResult':m.ref(crpath)}
  authority_ref={'path':'/authority','sha256':'a'*64}
  with patch.object(m,'ref',wraps=m.ref):inp=m.project_input(self.inp,{**a,'runner':m.ref(D/'continuation.py')},mapping) if False else copy.deepcopy(self.inp)
  spec=inp['qualificationPreparation']
  for k in ('qualifiedProducer','numericalAdapter'):spec[k]=m.mapped(mapping,spec[k])
  inp['operationalContinuation']={'authority':authority_ref}
  bindings={**self.inp['bindings'],'runRoot':str(run)}
  calls=[]
  def command(argv,**kw):
   calls.append(argv);d=kw['output'];d.mkdir()
   if '--output'in argv:
    out=Path(argv[argv.index('--output')+1]);out.mkdir(parents=True)
    for n in original.NAMES:(out/n).write_text('{}')
   else:
    comp=run/'downstream/seed17-01/numerical-policy/qualified.json';comp.parent.mkdir(parents=True);comp.write_text('{}')
   for n in ('dispatch.json','result.json'):(d/n).write_text('{}')
   return {'dispatch':m.ref(d/'dispatch.json'),'result':m.ref(d/'result.json')}
  realread=m.read;realchecked=m.checked
  def read(r):
   if r==spec['qualificationOwner']:return {'result':{'runtimeImageId':'retained-image','runtimeContainerId':'retained-container'}}
   return json.loads(Path(r['path']).read_text())
  def checked(r):
   if str(r['path']).startswith(str(root)):return realchecked(r)
   return Path(r['path'])
  with patch.object(p,'core',return_value=m),patch.object(m,'ROOT',root),patch.object(m,'authority',return_value=a),patch.object(m,'load',return_value=original),patch.object(m,'read',side_effect=read),patch.object(m,'checked',side_effect=checked):
   updated,context,receipts,receipt=p.prepare(inp,self.sub,bindings,work,{},Path(bindings['scienceSourceDirectory']),lambda:None,{},command)
  self.assertEqual(len(calls),2);self.assertEqual(calls[0][1],original.QUALIFIED['path']);self.assertEqual(calls[1][2],'companion')
  self.assertEqual(checkpoint.read_bytes(),old_bytes);self.assertEqual(receipts[0],{**self.docs[self.a['checkpointResult']['path']],'dispatch':a['checkpointDispatch'],'result':a['checkpointResult']});self.assertTrue(Path(receipt['path']).is_file())


 def test_exact_closure_cli_source_replaced(self):
  mapping=m.read(m.MAP);a={'runner':{'path':'/r','sha256':'1'*64},'resumePreparation':{'path':'/p','sha256':'2'*64},'sourceMap':m.MAP}
  with patch.object(m,'ref',return_value={'path':'/authority','sha256':'3'*64}):out=m.project_input(self.inp,a,mapping)
  old=self.inp['closureValidator']['source'];new=m.mapped(mapping,old)
  self.assertNotIn(old['path'],out['closureValidator']['argv']);self.assertEqual(out['closureValidator']['argv'].count(new['path']),1)
 def test_clean_worker_import_from_actual_pinned_parent(self):
  import subprocess,os
  code="import importlib.util,json;from pathlib import Path;s=importlib.util.spec_from_file_location('r',"+repr(str(D/'continuation.py'))+");m=importlib.util.module_from_spec(s);s.loader.exec_module(m);x=m.read(m.MAP);c=next(v for v in x['addedFiles']if Path(v['path']).name=='controller.py');m.load('controller',c);w=next(v['replacement']for v in x['sourceMap']if v['original']['path'].endswith('/worker.py'));z=m.load('native_clean',w);assert z.__file__==w['path'];print('actual-clean-import-ok')"
  env={k:v for k,v in os.environ.items()if k!='PYTHONPATH'}
  p=subprocess.run(['/srv/acephale/ops-venv/bin/python','-B','-c',code],cwd=D,env=env,capture_output=True,text=True,timeout=15)
  self.assertEqual(p.returncode,0,p.stderr);self.assertIn('actual-clean-import-ok',p.stdout)
 def test_post_initial_gate_does_not_read_journal_owner(self):
  from boto3.dynamodb.types import TypeSerializer
  ser=TypeSerializer();ar={'path':'/a','sha256':'a'*64}
  claim={'status':'running','permanent':True,'attemptId':m.ATTEMPT,'inputSha256':m.INPUT,'leaseId':m.RESOURCE,'instanceId':m.INSTANCE,'operationalContinuation':ar}
  class Ddb:
   calls=[]
   def get_item(self,**kw):
    self.calls.append(kw['Key']['pk']['S']);return {'Item':{k:ser.serialize(v)for k,v in claim.items()}}
  d=Ddb()
  with patch.object(m,'ref',return_value=ar):m.claim_gate(d,self.a)
  self.assertEqual(d.calls,['unit#'+m.UNIT])
 def test_initial_gate_rejects_unrelated_journal_owner(self):
  from boto3.dynamodb.types import TypeSerializer
  ser=TypeSerializer();ar={'path':'/a','sha256':'a'*64}
  claim={'status':'running','permanent':True,'attemptId':m.ATTEMPT,'inputSha256':m.INPUT,'leaseId':m.RESOURCE,'instanceId':m.INSTANCE,'operationalContinuation':ar}
  class Ddb:
   def get_item(self,**kw):
    value=claim if kw['Key']['pk']['S'].startswith('unit#')else {'unitId':'other','attemptId':'other','permanentUntilObservedDrain':True}
    return {'Item':{k:ser.serialize(v)for k,v in value.items()}}
  with patch.object(m,'ref',return_value=ar),self.assertRaisesRegex(ValueError,'journal owner'):m.claim_gate(Ddb(),self.a,require_journal=True)
 def test_generation_parent_entries_durable_before_execute(self):
  import os
  tmp=tempfile.TemporaryDirectory(dir=D);self.addCleanup(tmp.cleanup);work=Path(tmp.name);path=work/'operational-generations/01';events=[]
  real=m.os.fsync
  def sync(fd):events.append(os.readlink('/proc/self/fd/'+str(fd)));real(fd)
  with patch.object(m.os,'fsync',side_effect=sync):m.mkdir_generation(path);m.write(path/'executed.json',{'started':True})
  self.assertEqual(events[:2],[str(path.parent),str(work)]);self.assertEqual(events[-1],str(path))
  tree=ast.parse((D/'continuation.py').read_text());n=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='execute');text=ast.get_source_segment((D/'continuation.py').read_text(),n)
  self.assertLess(text.index('mkdir_generation(generation)'),text.index("write(generation/'executed.json'"));self.assertLess(text.index("write(generation/'executed.json'"),text.index('worker.execute('))

if __name__=='__main__':unittest.main(verbosity=2)
