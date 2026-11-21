import unittest,tempfile,os,json,copy,time,sys,io
from pathlib import Path
from unittest.mock import Mock,patch
import boto3
from botocore.exceptions import ClientError
from botocore.validate import validate_parameters
import allocate_root as a,node_agent as n,prepare_root as p
class FakeS3:
 class exceptions:ClientError=ClientError
 def __init__(self):self.data={}
 def put_object(self,**kw):
  k=kw['Key'];b=kw['Body']
  if k in self.data and kw.get('IfNoneMatch'):raise ClientError({'Error':{'Code':'PreconditionFailed'}},'PutObject')
  self.data[k]=b;return {'VersionId':'v1'}
 def get_object(self,**kw):return {'Body':io.BytesIO(self.data[kw['Key']]),'VersionId':'v1'}
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.now=int(time.time())
  self.saved=p.HERE
  for f in a.HERE.iterdir():
   if f.is_file() and f.suffix in('.py','.json'):(self.root/f.name).write_bytes(f.read_bytes())
  p.HERE=self.root;self.c=p.build(self.now+43200,self.now)
 def tearDown(self):p.HERE=self.saved;self.temp.cleanup()
 def test_sdk(self):
  sm=boto3.client('sagemaker',region_name='us-east-1')
  validate_parameters(self.c['createRequest'],sm.meta.service_model.operation_model('CreateCluster').input_shape)
  s=boto3.client('scheduler',region_name='us-east-1')
  validate_parameters(self.c['cleanupSchedule'],s.meta.service_model.operation_model('CreateSchedule').input_shape)
 def test_json(self):self.assertEqual(json.loads(a.raw({})),{});self.assertEqual(json.loads(self.c['cleanupSchedule']['Target']['Input']),{'ClusterName':a.NAME})
 def test_deadline(self):
  self.c['deadline']=self.now+43201
  with self.assertRaises(ValueError):a.validate(self.c,self.now)
 def test_hardware(self):
  self.c['createRequest']['InstanceGroups'][1]['InstanceCount']=2
  with self.assertRaises(ValueError):a.validate(self.c,self.now)
 def test_ami(self):
  self.c['createRequest']['InstanceGroups'][1]['ImageId']='ami-wrong'
  with self.assertRaises(ValueError):a.validate(self.c,self.now)
 def test_network(self):
  self.c['createRequest']['VpcConfig']['Subnets']=['subnet-other']
  with self.assertRaises(ValueError):a.validate(self.c,self.now)
 def test_science(self):
  self.c['scientificDispatchAllowed']=True
  with self.assertRaises(ValueError):a.validate(self.c,self.now)
 def test_schedule(self):
  s=Mock();s.get_schedule.return_value=self.c['cleanupSchedule'];a.ensure_schedule(s,self.c);s.create_schedule.assert_not_called()
  s.get_schedule.return_value={**self.c['cleanupSchedule'],'State':'DISABLED'}
  with self.assertRaises(ValueError):a.ensure_schedule(s,self.c)
 def test_observe_absent(self):
  s=Mock();s.exceptions.ClientError=ClientError;s.describe_cluster.side_effect=ClientError({'Error':{'Code':'ResourceNotFound'}},'DescribeCluster')
  self.assertIsNone(a.observe(s,self.c))
 def test_reserve_atomic(self):
  rows={'coordinator':{'pk':'coordinator','sourceCommit':a.SCIENCE,'executionEnabled':True,'stopRequested':False,'hardDeadline':a.GLOBAL},'coordinator#capacity-v1':{'pk':'coordinator#capacity-v1','sourceCommit':a.SCIENCE,'studyComplete':False,'stopRequested':True,'hardDeadline':a.GLOBAL}}
  db=Mock();db.get_item.side_effect=lambda **k:{'Item':a.typed(rows[k['Key']['pk']['S']])}if k['Key']['pk']['S']in rows else {}
  a.reserve(db,self.c,'0'*64);tx=db.transact_write_items.call_args.kwargs['TransactItems'];self.assertEqual(len(tx),7)
  self.assertEqual(tx[2]['Update']['ExpressionAttributeValues'][':a']['N'],'500000000')
  self.assertEqual(tx[0]['Put']['Item']['scientificUnitClaimed'],{'BOOL':False})
  self.assertEqual(tx[-1]['ConditionCheck']['Key']['pk']['S'],'unit#seed29/replay')
 def test_existing_hold(self):
  db=Mock();db.get_item.return_value={'Item':a.typed({'configurationSha256':'0'*64,'reservedMicrousd':a.HOLD})}
  a.reserve(db,self.c,'0'*64);db.transact_write_items.assert_not_called()
 def test_existing_intent_never_recreate(self):
  sm=Mock();sm.meta=boto3.client('sagemaker',region_name='us-east-1').meta
  cl={'sagemaker':sm,'dynamodb':Mock(),'s3':FakeS3(),'scheduler':Mock(),'cloudformation':Mock()}
  cl['cloudformation'].describe_stacks.return_value={'Stacks':[{'StackStatus':'CREATE_COMPLETE'}]}
  with patch.object(a,'reserve',return_value={'status':'create-submitting'}),patch.object(a,'ensure_schedule'),patch.object(a,'observe',return_value=None),patch.object(a.subprocess,'run',return_value=Mock(returncode=0)):
   out=a.allocate(cl,self.c,'0'*64,self.root/'c')
  self.assertFalse(out['automaticCreateRetry']);sm.create_cluster.assert_not_called()
 def command(self):
  node='i-'+'a'*17;deadline=self.now+100
  command={'kind':'acephale-hyperpod-node-command-v1','resourceAttemptId':n.ATTEMPT,'nodeId':node,'sequence':1,'argv':[sys.executable,'-c','print(7)'],'cwd':str(self.root),'timeoutSeconds':2,'environment':{}}
  index={'kind':'acephale-hyperpod-node-command-index-v1','resourceAttemptId':n.ATTEMPT,'nodeId':node,'sequence':1,'deadline':deadline,'command':{'key':'state/'+n.ATTEMPT+'/commands/'+node+'/1.json','versionId':'v1','sha256':n.sha(n.raw(command))}}
  return node,command,index
 def test_real_child_and_no_repeat(self):
  node,c,i=self.command();s=FakeS3()
  with patch.object(n,'BASE',self.root/'state'),patch.dict(os.environ,{'ACEPHALE_HYPERPOD_DEADLINE':str(i['deadline'])}):
   (self.root/'state').mkdir()
   out=n.execute(s,i,c,node);self.assertEqual(out['exitCode'],0);self.assertTrue(out['ownedProcessGroupDrained'])
   with patch.object(n.subprocess,'Popen',side_effect=AssertionError('replay')):self.assertTrue(n.execute(s,i,c,node)['retained'])
 def test_unknown_no_repeat(self):
  node,c,i=self.command();work=self.root/'state'/'00001';work.mkdir(parents=True);(work/'intent.json').write_bytes(n.raw({'index':i,'commandSha256':n.sha(n.raw(c)),'nodeId':node}))
  with patch.object(n,'BASE',self.root/'state'),patch.dict(os.environ,{'ACEPHALE_HYPERPOD_DEADLINE':str(i['deadline'])}),patch.object(n.subprocess,'Popen',side_effect=AssertionError('replay')):
   self.assertFalse(n.execute(FakeS3(),i,c,node)['resultPresent'])
 def test_foreign_node(self):
  node,c,i=self.command()
  with patch.dict(os.environ,{'ACEPHALE_HYPERPOD_DEADLINE':str(i['deadline'])}),self.assertRaises(ValueError):n.validate(i,c,'i-'+'b'*17,self.now)
 def test_timeout_drain(self):
  node,c,i=self.command();c['argv']=[sys.executable,'-c','import time;time.sleep(15)'];c['timeoutSeconds']=1
  with patch.object(n,'BASE',self.root/'state'),patch.dict(os.environ,{'ACEPHALE_HYPERPOD_DEADLINE':str(i['deadline'])}):
   (self.root/'state').mkdir();out=n.execute(FakeS3(),i,c,node);self.assertTrue(out['timedOut']);self.assertTrue(out['ownedProcessGroupDrained']);self.assertNotEqual(out['exitCode'],0)
if __name__=='__main__':unittest.main()
