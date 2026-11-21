from pathlib import Path
import ast,hashlib,importlib.util,json,sys,tempfile,types,unittest,boto3,time
D=Path('/srv/acephale/workspaces/operator/regional-numerical-inputs-01')
SOURCE_MAP=json.loads((D/'source-map.json').read_text())
def load(p,name):
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
sys.path.insert(0,str(D/'closure02'))
fixture_source=Path('/srv/acephale/workspaces/review/scientific-closure-03/test_contract.py').read_text()
fixture_class=next(n for n in ast.parse(fixture_source).body if isinstance(n,ast.ClassDef) and n.name=='CurrentNumerical')
fixture_text=ast.get_source_segment(fixture_source,fixture_class)
cases=[]
class Regions(unittest.TestCase):
 def test_exact_source_reversals(self):
  for row in json.loads((D/'derivation.json').read_text()):
   a=Path(row['original']['path']).read_bytes();b=Path(row['replacement']['path']).read_bytes()
   if 'exactReplacement' in row:
    old,new=row['exactReplacement'];self.assertEqual(b.replace(new.encode(),old.encode()),a)
   else:
    for old,new,count in reversed(row['literalReplacements']):b=b.replace(new.encode(),old.encode())
    self.assertEqual(a,b)
 def run_region(self,n,region,accept,wrong=None,parent=False):
  p=Path('/srv/acephale/workspaces/review/scientific-closure-'+n+'/closure_adapter.py')if parent else D/('closure'+n)/'closure_adapter.py'
  c=load(p,'test_closure_'+n+str(parent));ns={'c':c,'unittest':unittest,'tempfile':tempfile,'Path':Path,'json':json,'sys':sys}
  text=fixture_text.replace('region="us-east-1"','region='+repr(region))
  exec(text,ns);obj=ns['CurrentNumerical']('test_valid_current_identity_precision_reaches_projection');obj.setUp()
  try:
   ctx,_=obj.fixture()
   if wrong:ctx[wrong]='wrong-current-value'
   if accept:
    with self.assertRaises(KeyError)as x:c.current_numerical_inputs(ctx,c.ORIGINAL_SOURCES)
    self.assertEqual(str(x.exception),"'servingProjection'")
   else:
    with self.assertRaises(ValueError):c.current_numerical_inputs(ctx,c.ORIGINAL_SOURCES)
  finally:obj.tearDown()
  cases.append({'closure':n,'region':region,'parent':parent,'wrong':wrong,'acceptedUntilProjection':accept})
 def test_three_approved_regions(self):
  for n in ('02','03'):
   for r in ('us-east-1','us-east-2','us-west-2'):
    with self.subTest(n=n,r=r):self.run_region(n,r,True)
 def test_unknown_regions_reject(self):
  for n in ('02','03'):
   for r in ('us-west-1','eu-west-1',''):
    with self.subTest(n=n,r=r):self.run_region(n,r,False)
 def test_actual_failure_shape_parent_rejects_ohio(self):
  for n in ('02','03'):self.run_region(n,'us-east-2',False,parent=True)
 def test_identity_gates_still_reject(self):
  for n in ('02','03'):
   for key in ('resourceAttemptId','instanceId','hardDeadline','occurrenceId'):
    with self.subTest(n=n,key=key):self.run_region(n,'us-east-2',False,wrong=key)
 def test_all_transitive_helper_function_bodies_unchanged(self):
  for row in SOURCE_MAP['sourceMap'][2:]:
   a=ast.parse(Path(row['original']['path']).read_text());b=ast.parse(Path(row['replacement']['path']).read_text())
   fun=lambda t:{x.name:ast.dump(x,include_attributes=False)for x in t.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef))}
   self.assertEqual(fun(a),fun(b))
 def test_producer_sibling_mapper(self):
  m=load(D/'prepare_qualified_predictor.py','test_producer')
  self.assertEqual(Path(m.NUMERICAL_ADAPTER['path']).parent,Path(m.PATH_MAPPER['path']).parent)
  m.checked_ref(m.NUMERICAL_ADAPTER);m.checked_ref(m.PATH_MAPPER)
 def test_worker_exact_new_quiet_helper_pins(self):
  sys.path.insert(0,str(D))
  try:
   w=load(D/'worker.py','test_worker_region_pins')
   for name in ('NATIVE_EVIDENCE_SOURCE','CALIBRATION_ADOPTION_SOURCE'):
    r=getattr(w,name);self.assertEqual(hashlib.sha256(Path(r['path']).read_bytes()).hexdigest(),r['sha256'])
   self.assertEqual(w.NATIVE_EVIDENCE_SOURCE,SOURCE_MAP['sourceMap'][4]['replacement'])
   self.assertEqual(w.CALIBRATION_ADOPTION_SOURCE,SOURCE_MAP['sourceMap'][5]['replacement'])
  finally:sys.path.pop(0)
if __name__=='__main__':
 started=time.time();result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Regions))
 receipt={'kind':'acephale-aws-regional-numerical-tests-v1','testsRun':result.testsRun,'regionIdentityCases':cases,'failures':len(result.failures),'errors':len(result.errors),'passed':result.wasSuccessful(),'elapsedSeconds':time.time()-started,'providerCalls':False,'scientificExecutionPerformed':False}
 (D/'tests-result.json').write_text(json.dumps(receipt,indent=2)+'\n')
 raise SystemExit(0 if result.wasSuccessful()else 1)
