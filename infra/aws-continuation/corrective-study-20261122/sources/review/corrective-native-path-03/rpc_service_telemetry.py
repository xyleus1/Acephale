"""Read-only RPC-aware binding of original per-service telemetry. No ledger operations."""
import os,json,hashlib,re
from pathlib import Path
from acephale.native_common import ServiceTelemetry as OriginalServiceTelemetry
def _read(path):return json.loads(Path(path).read_text())
def _sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
class RpcServiceTelemetry(OriginalServiceTelemetry):
 def __init__(self,directory,manifest_hash):
  super().__init__(directory,manifest_hash)
  p=Path(os.environ['ACEPHALE_BUDGET_RPC_CONFIG']);expected=os.environ['ACEPHALE_BUDGET_RPC_SHA256']
  if not re.fullmatch('[a-f0-9]{64}',expected) or p.is_symlink() or _sha(p)!=expected:raise ValueError('RPC telemetry configuration changed')
  self.config=_read(p);self.config_sha=expected;self.participant=os.environ['ACEPHALE_BUDGET_RPC_PARTICIPANT']
  if self.config.get('kind')!='goalspec-original-budget-owner-v1' or self.config.get('mode')!='production' or self.config.get('sessionProtocol')!='per-instance-v1' or self.participant not in self.config['participants']:raise ValueError('RPC telemetry owner/participant mismatch')
  if Path(self.config['journalPath']).resolve()!=self.directory.resolve()/'budget.jsonl':raise ValueError('RPC telemetry original journal mismatch')
  self.queue=Path(self.config['queueRoot']);self.owner_refs={};self.session_refs={}
  self.before_requests={p.name for p in self.queue.glob('*.request.json')}
  self._owner()
 def _owner(self):
  if (self.queue/'TERMINAL.json').exists():raise ValueError('RPC telemetry owner ended')
  ready=_read(self.queue/'READY.json');begin=_read(self.queue/'BEGIN.json');lock=_read(self.directory/'budget.jsonl.lock')
  if ready.get('kind')!='goalspec-original-budget-owner-ready-v1' or ready.get('configSha256')!=self.config_sha or begin.get('configSha256')!=self.config_sha or ready.get('pid')!=begin.get('pid') or lock.get('pid')!=ready.get('pid') or ready.get('journalPath')!=self.config['journalPath'] or self.participant not in ready.get('participants',[]):raise ValueError('RPC telemetry active owner binding changed')
  for p in [self.queue/'READY.json',self.queue/'BEGIN.json',self.directory/'budget.jsonl.lock']:
   digest=_sha(p)
   if str(p)in self.owner_refs and self.owner_refs[str(p)]!=digest:raise ValueError('RPC telemetry owner identity changed')
   self.owner_refs[str(p)]=digest
  for path,digest in self.session_refs.items():
   if _sha(path)!=digest:raise ValueError('RPC telemetry session evidence changed')
  return ready
 def bind(self,pid):
  if self.path is not None:raise ValueError('Service telemetry already bound')
  ready=self._owner();sessions=[]
  for p in self.queue.glob('*.request.json'):
   if p.name in self.before_requests:continue
   q=_read(p)
   if q.get('participant')!=self.participant or q.get('action')!='open':continue
   r=self.queue/(q['id']+'.result.json')
   if not r.exists():continue
   value=_read(r)
   if value.get('ok')is True and value.get('id')==q['id'] and q.get('version')==2 and re.fullmatch('[a-f0-9-]{36}',q.get('sessionId','')):sessions.append((q,p,r))
  if len(sessions)!=1:raise ValueError('RPC telemetry requires one new successful participant session')
  q,request,response=sessions[0]
  self.session_refs={str(p):_sha(p)for p in [request,response]}
  candidates=[]
  for p in self.directory.glob('events-*.jsonl'):
   if p.name in self.before:continue
   matched=False
   with p.open('rb')as f:
    for line in f:
     if not line.endswith(b'\n'):break
     try:event=json.loads(line)['body']['event']
     except (ValueError,KeyError):continue
     if event.get('type')=='research_manifest' and event.get('manifestHash')==self.manifest_hash:matched=True
   if matched:candidates.append(p)
  if len(candidates)!=1:raise ValueError('RPC telemetry requires one new exact-configuration event chain')
  self.path=candidates[0];stat=self.path.stat();self.identity=(stat.st_dev,stat.st_ino)
  self.rpc_binding={'participant':self.participant,'sessionId':q['sessionId'],'workerNodePid':pid,'centralLedgerOwnerPid':ready['pid'],'sameProcessOwnershipAsserted':False,'eventPath':str(self.path),'configurationSha256':self.config_sha,'sessionEvidence':self.session_refs.copy(),'ownerEvidence':self.owner_refs.copy()}
  self._read()
  if not self.manifest_seen:raise ValueError('Service event log has no matching research manifest')
 def _read(self):
  self._owner()
  return super()._read()
def service_telemetry(directory,manifest_hash):
 if os.environ.get('ACEPHALE_BUDGET_RPC_CONFIG'):return RpcServiceTelemetry(directory,manifest_hash)
 return OriginalServiceTelemetry(directory,manifest_hash)
