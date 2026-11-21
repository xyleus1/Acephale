"""Root-authorized versioned S3 transport for one HyperPod node; no automatic command replay."""
import hashlib,json,os,re,signal,subprocess,time,socket
from pathlib import Path
import boto3
from botocore.config import Config
BUCKET='acephale-aws-20261121-971290362335'
ATTEMPT='hyperpod-a100-01'
BASE=Path('/opt/acephale-hyperpod-agent/state')
def raw(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def need(v,m):
 if not v:raise ValueError(m)
def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def node_id():
 p=Path('/sys/devices/virtual/dmi/id/board_asset_tag')
 x=p.read_text().strip()
 need(re.fullmatch(r'i-[a-f0-9]{17}',x),'Actual HyperPod node DMI ID')
 return x
def get(s3,key,version=None):
 args={'Bucket':BUCKET,'Key':key}
 if version:args['VersionId']=version
 q=s3.get_object(**args);return q['Body'].read(),q.get('VersionId')
def put(s3,key,data,immutable=True):
 args={'Bucket':BUCKET,'Key':key,'Body':data,'ChecksumAlgorithm':'SHA256'}
 if immutable:args['IfNoneMatch']='*'
 try:return s3.put_object(**args)
 except s3.exceptions.ClientError as e:
  if e.response['Error']['Code']not in('PreconditionFailed','412'):raise
  old,_=get(s3,key);need(old==data,'Immutable remote evidence differs');return {'existing':True}
def validate(index,command,node,now):
 need(index.get('kind')=='acephale-hyperpod-node-command-index-v1'and index.get('resourceAttemptId')==ATTEMPT and index.get('nodeId')==node,'Exact node command authority')
 need(type(index.get('sequence'))is int and 0<index['sequence']<100000,'Finite unique command sequence')
 need(type(index.get('deadline'))is int and now<index['deadline']<=int(os.environ['ACEPHALE_HYPERPOD_DEADLINE']),'Live root command deadline within fixed provider lease')
 ref=index['command'];need(ref['key'].startswith('state/'+ATTEMPT+'/commands/'+node+'/')and re.fullmatch('[a-f0-9]{64}',ref['sha256'])and ref.get('versionId')not in(None,'','null'),'Exact protected versioned command')
 need(command.get('kind')=='acephale-hyperpod-node-command-v1'and command.get('resourceAttemptId')==ATTEMPT and command.get('nodeId')==node and command.get('sequence')==index['sequence'],'Same command identity')
 argv=command['argv'];need(type(argv)is list and 0<len(argv)<=128 and all(type(x)is str and '\0'not in x for x in argv)and argv[0].startswith('/'),'Explicit absolute argv; no shell expansion')
 need(type(command['timeoutSeconds'])is int and 0<command['timeoutSeconds']<=43200 and now+command['timeoutSeconds']+30<=index['deadline'],'Finite command plus drain fits authority')
 need(type(command['cwd'])is str and command['cwd'].startswith('/')and Path(command['cwd']).is_dir(),'Existing exact cwd')
 need(type(command.get('environment',{}))is dict and all(type(k)is str and type(v)is str and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k)for k,v in command.get('environment',{}).items()),'Explicit command environment')
 return argv
def execute(s3,index,command,node):
 argv=validate(index,command,node,time.time());seq=index['sequence'];work=BASE/f'{seq:05d}';work.mkdir(mode=0o700,exist_ok=True)
 intent=work/'intent.json';key='workers/'+ATTEMPT+'/'+node+f'/commands/{seq:05d}/'
 bound={'index':index,'commandSha256':sha(raw(command)),'nodeId':node}
 if intent.exists():
  need(intent.read_bytes()==raw(bound),'Command sequence cannot be rebound')
  # A durable intent without a result is UNKNOWN, including after a crash before Popen.
  if (work/'result.json').exists():put(s3,key+'result.json',(work/'result.json').read_bytes())
  return {'retained':True,'sequence':seq,'resultPresent':(work/'result.json').exists()}
 atomic(intent,raw(bound));put(s3,key+'intent.json',intent.read_bytes())
 started=time.time();out=work/'stdout.log';err=work/'stderr.log';errors=[];timed=False
 with out.open('xb')as so,err.open('xb')as se:
  child=subprocess.Popen(argv,cwd=command['cwd'],env={**os.environ,**command.get('environment',{})},stdout=so,stderr=se,start_new_session=True)
  try:code=child.wait(timeout=command['timeoutSeconds'])
  except subprocess.TimeoutExpired:
   timed=True;os.killpg(child.pid,signal.SIGTERM)
   try:code=child.wait(timeout=15)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait(timeout=15)
  try:os.killpg(child.pid,0)
  except ProcessLookupError:drained=True
  else:
   os.killpg(child.pid,signal.SIGKILL);time.sleep(.2)
   try:os.killpg(child.pid,0);drained=False
   except ProcessLookupError:drained=True
 refs=[]
 for file in(out,err):
  data=file.read_bytes();r=put(s3,key+file.name,data);refs.append({'key':key+file.name,'sha256':sha(data),'bytes':len(data),'versionId':r.get('VersionId')})
 result={'kind':'acephale-hyperpod-owned-command-result-v1','resourceAttemptId':ATTEMPT,'nodeId':node,'sequence':seq,'commandSha256':bound['commandSha256'],'startedAt':started,'finishedAt':time.time(),'exitCode':code,'timedOut':timed,'ownedProcessGroupDrained':drained,'logs':refs,'scientificSuccessAsserted':False}
 atomic(work/'result.json',raw(result));put(s3,key+'result.json',raw(result));return result
def main():
 need(os.geteuid()==0,'Dedicated root lifecycle agent');BASE.mkdir(parents=True,exist_ok=True,mode=0o700);node=node_id()
 s3=boto3.client('s3',region_name='us-east-1',config=Config(retries={'total_max_attempts':1},connect_timeout=10,read_timeout=30))
 rc=Path('/opt/ml/config/resource_config.json');data=rc.read_bytes()if rc.is_file()else b''
 def probe(argv):
  try:
   r=subprocess.run(argv,capture_output=True,text=True,timeout=20)
   return {'argv':argv,'exitCode':r.returncode,'stdout':r.stdout[:12000],'stderr':r.stderr[:2000]}
  except Exception as e:return {'argv':argv,'error':str(e)[:1000]}
 metadata={'osRelease':Path('/etc/os-release').read_text(),'glibc':probe(['/usr/bin/getconf','GNU_LIBC_VERSION']),'docker':probe(['/usr/bin/docker','version','--format','{{json .Server}}']),'gpu':probe(['/usr/bin/nvidia-smi','--query-gpu=uuid,name,driver_version,memory.total','--format=csv,noheader']),'managedImageReleaseVersion':None,'managedImageReleaseVersionAuthority':'DescribeClusterNode required; not inferred from OS'}
 boot={'basicRuntime':metadata,'kind':'acephale-hyperpod-node-bootstrap-v1','resourceAttemptId':ATTEMPT,'nodeId':node,'hostname':socket.gethostname(),'resourceConfigSha256':sha(data),'resourceConfig':json.loads(data)if data else None,'agentSha256':sha(Path(__file__).read_bytes()),'observedAt':time.time(),'scientificDispatchAuthorized':False}
 bootpath=BASE/'boot.json'
 if not bootpath.exists():atomic(bootpath,raw(boot))
 put(s3,'workers/'+ATTEMPT+'/'+node+'/boot.json',bootpath.read_bytes())
 while time.time()<int(os.environ['ACEPHALE_HYPERPOD_DEADLINE']):
  try:
   data,_=get(s3,'state/'+ATTEMPT+'/commands/'+node+'/index.json');index=json.loads(data);ref=index['command'];payload,_=get(s3,ref['key'],ref['versionId']);need(sha(payload)==ref['sha256'],'Exact command payload bytes');execute(s3,index,json.loads(payload),node)
  except Exception as e:print(json.dumps({'transportError':type(e).__name__,'message':str(e)[:500]}),flush=True)
  time.sleep(15)
if __name__=='__main__':main()
