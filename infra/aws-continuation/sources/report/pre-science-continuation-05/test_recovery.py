from pathlib import Path
import unittest,json,hashlib,copy,tempfile,shutil,importlib.util,sys,ast
D=Path(__file__).parent;P=D/'continuation.py'
s=importlib.util.spec_from_file_location('gen03',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
A=json.loads((D/'authority-template.json').read_text());FAILED=json.loads((D/'previous-result.json').read_text());SUB=json.loads((D/'original-submission.json').read_text());E=json.loads((D/'retained-evidence.json').read_text())
class TestRecovery(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'root';shutil.copytree(D/'fixtures',self.root)
  self.old=(m.ROOT,m.checked,m.s3_json,m.read);m.ROOT=self.root
  def checked(r):
   p=self.root/Path(r['path']).relative_to('/srv/acephale')
   if not p.exists():p=Path(r['path'])
   self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),r['sha256']);return p
  m.checked=checked;m.s3_json=lambda s,r:copy.deepcopy(FAILED if r==A['previousFailedResult']else SUB)
  m.read=lambda r:copy.deepcopy(E)if r==A['retainedEvidence']else json.loads(checked(r).read_text())
 def tearDown(self):
  m.ROOT,m.checked,m.s3_json,m.read=self.old;self.tmp.cleanup()
 def test_actual_retained_failure(self):self.assertEqual(m.original_evidence(A,None)[0],SUB)
 def test_real_json_serialization(self):self.assertEqual(json.loads(m.raw({'x':1})),{'x':1})
 def test_one_completed_row_rejects(self):
  p=self.root/'attempts'/m.ATTEMPT/'01-prepare/prepared/run/profile/artifacts/measurement-0000.json';v=json.loads(p.read_text());v['status']='completed';p.write_text(json.dumps(v))
  with self.assertRaises((ValueError,AssertionError)):m.original_evidence(A,None)
 def test_prefix_rejects(self):
  p=self.root/'attempts'/m.ATTEMPT/'01-prepare/prepared/run/profile/artifacts/prefix-0.json';p.write_text('{}')
  with self.assertRaises(ValueError):m.original_evidence(A,None)
 def test_live_lock_rejects(self):
  (self.root/'shared').mkdir();(self.root/'shared/budget.jsonl.lock').write_text('owner')
  with self.assertRaises(ValueError):m.original_evidence(A,None)
 def test_reuses_admitted_preparation_bytes_without_recreation(self):
  target=self.root/'attempts'/m.ATTEMPT/'operational-generations/04/prepared'
  before={p.name:p.read_bytes()for p in target.iterdir()if p.is_file()}
  result=m.recover_metadata(A,{'path':str(m.AUTHORITY_PATH),'sha256':'0'*64},self.root/'unused-new-generation')
  self.assertEqual(before,{p.name:p.read_bytes()for p in target.iterdir()if p.is_file()})
  self.assertEqual(result['sha256'],hashlib.sha256(before['preparation.json']).hexdigest())
  self.assertFalse((target/'run').exists())
 def test_existing_profile_output_rejects(self):
  target=self.root/'attempts'/m.ATTEMPT/'operational-generations/04/prepared/run';target.mkdir()
  with self.assertRaises(ValueError):m.recover_metadata(A,{},self.root/'unused')
 def test_evidence_namespace_is_operational_only(self):
  source=(D/'worker.py').read_text()
  self.assertIn("hexdigest()[:32]+'-op05'",source)
  self.assertIn("'occurrenceId':job['occurrenceId']",source)
  self.assertIn("previous_preparation=work/'operational-generations/04/prepared'",source)
 def test_input_output_companions_use_fresh_operational_namespace(self):
  paths=m.numerical_evidence_paths({'runRoot':'/run','occurrenceId':'seed17-01'},A)
  self.assertEqual([str(p)for p in paths],['/run/downstream/seed17-01/numerical-policy/'+A['operationalStageId']+'-'+kind+'.json'for kind in('inputs','outputs')])
  self.assertTrue(all('-op05-'in str(p)for p in paths))
 def test_owner_transaction(self):
  tx=m.activation_transaction(A,{'path':str(m.AUTHORITY_PATH),'sha256':'0'*64})
  unit=tx[1]['Update'];self.assertIn('operationalContinuation=:parent',unit['ConditionExpression']);self.assertEqual(unit['ExpressionAttributeValues'][':hash']['S'],m.PREVIOUS_FAILED)
  self.assertIn('attribute_not_exists(pk) OR',tx[2]['Put']['ConditionExpression'])
 def test_worker_no_preparation_command(self):
  tree=ast.parse((D/'worker.py').read_text());f=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='execute')
  calls=[n for n in ast.walk(f)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='run_command']
  source=ast.get_source_segment((D/'worker.py').read_text(),f)
  self.assertNotIn("'--authority'",source);self.assertIn("retained=work/'operational-generations/02/preparation-completion-process'",source)
if __name__=='__main__':unittest.main()
