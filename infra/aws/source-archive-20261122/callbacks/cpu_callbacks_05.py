"""Finite CPU callbacks inside the existing controller; no worker, model or ledger writes."""
import argparse,hashlib,importlib.util,json,os,signal,subprocess,sys,time
from pathlib import Path
HARD=1795413600
def need(ok,message):
 if not ok:raise ValueError(message)
def raw(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def sha(data):return hashlib.sha256(data).hexdigest()
def ref(path):
 p=Path(path);b=p.read_bytes();return {'path':str(p),'sha256':sha(b),'bytes':len(b)}
def checked(r):
 p=Path(r['path']);need(p.is_absolute()and p.is_file(),'Absolute existing CPU input')
 b=p.read_bytes();need(sha(b)==r['sha256']and('bytes'not in r or len(b)==r['bytes']),'CPU input changed: '+str(p));return b
def save(path,value):
 p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);b=raw(value)
 with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 return ref(p)
def module(r,name):
 checked(r);s=importlib.util.spec_from_file_location(name,r['path']);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def members(pgid):
 out=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    v=(p/'stat').read_text().rsplit(')',1)[1].split()
    if int(v[2])==pgid and v[0]!='Z':out.append(int(p.name))
   except(FileNotFoundError,ProcessLookupError,ValueError,IndexError):pass
 return out
def stop_group(pgid):
 for sig,seconds in [(signal.SIGTERM,5),(signal.SIGKILL,5)]:
  if not members(pgid):return []
  try:os.killpg(pgid,sig)
  except ProcessLookupError:pass
  until=time.monotonic()+seconds
  while members(pgid)and time.monotonic()<until:time.sleep(.05)
 return members(pgid)
def validate(command,config):
 need(command.get('automaticRetry')is False and command.get('workerCommands')is False and command.get('ledgerWrites')is False,'CPU only, no retry')
 need(command.get('validationStatus')=='unvalidated'and command.get('requiresExistingControllerLockAndExclusiveIntent')is True,'Existing controller lock required')
 need(type(command['timeoutSeconds'])is int and 1<=command['timeoutSeconds']<=config.get('maximumCpuSeconds',600),'Finite CPU runtime')
 need(isinstance(command['argv'],list)and all(isinstance(x,str)for x in command['argv']),'Exact CPU argv')
 catalog=config['allowedSources'];matches=[r for r in catalog if r['path']in command['argv']]
 need(len(matches)==1,'Exactly one pinned CPU entry');checked(matches[0])
 need(command['argv'][0]in config['allowedInterpreters'],'Pinned CPU interpreter')
 for r in command.get('inputPreconditions',[]):checked(r)
 env=command.get('environment',{})
 need(set(env)<=set(config.get('allowedEnvironment',[]))and all(isinstance(v,str)for v in env.values()),'Finite declared CPU environment')
 output=Path(command['outputRoot'])
 need(output.is_absolute()and any(output.resolve().is_relative_to(Path(p).resolve())for p in config['allowedOutputRoots']),'Isolated output root')
 need(not output.is_symlink(),'No redirected CPU output')
 return command
def execute(intent_path,expected):
 intent=json.loads(checked({'path':intent_path,'sha256':expected}));command=intent['command'];config=intent['configuration'];validate(command,config)
 state=Path(intent_path).parent;now=time.time()
 need(now+command['timeoutSeconds']+15<min(HARD,intent['hardDeadline']),'CPU child deadline')
 save(state/'started.json',{'startedAt':now,'pid':os.getpid(),'intentSha256':expected,'validationStatus':'unvalidated'})
 proc=None;code=None;failure=None;timed_out=False;remaining=[]
 try:
  with(state/'stdout.log').open('xb')as so,(state/'stderr.log').open('xb')as se:
   proc=subprocess.Popen(command['argv'],cwd=command['cwd'],env={**os.environ,**command.get('environment',{})},stdout=so,stderr=se,start_new_session=True)
   save(state/'child.json',{'pid':proc.pid,'pgid':proc.pid,'startedAt':time.time(),'argv':command['argv'],'intentSha256':expected})
   try:code=proc.wait(timeout=command['timeoutSeconds'])
   except subprocess.TimeoutExpired:timed_out=True;remaining=stop_group(proc.pid);code=proc.wait(timeout=5)
   remaining=stop_group(proc.pid)
 except Exception as exc:
  failure={'type':type(exc).__name__,'error':str(exc)}
  if proc is not None:
   remaining=stop_group(proc.pid)
   try:code=proc.wait(timeout=5)
   except subprocess.TimeoutExpired:pass
 result={'kind':'root-direct-cpu-terminal-v1','intentSha256':expected,'operationId':command['operationId'],'exitCode':code,'timedOut':timed_out,'failure':failure,'ownedGroupDrained':not remaining,'remainingPids':remaining,'finishedAt':time.time(),'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'studyComplete':False,'automaticRetry':False}
 for name in ['stdout.log','stderr.log']:
  if(state/name).exists():result[name]=ref(state/name)
 save(state/'terminal.json',result)
 return 0 if code==0 and not failure and not timed_out and not remaining else 1
def reconcile(ctl,config,command,now,allow_dispatch=True):
 validate(command,config);identity=sha(raw(command));op=command['operationId'];need(len(op)<=160 and all(c.isalnum()or c in'-_'for c in op),'Finite CPU operation id')
 folder=Path(config['stateDirectory'])/identity;folder.mkdir(parents=True,exist_ok=True);terminal=folder/'terminal.json';intent=folder/'intent.json'
 descriptor=folder/'command.json'
 if descriptor.exists():need(json.loads(descriptor.read_text())==command,'CPU command cannot be rebound')
 else:save(descriptor,command)
 if terminal.exists():
  outcome=json.loads(terminal.read_text());need(intent.exists()and outcome['intentSha256']==ref(intent)['sha256'],'CPU terminal lineage')
  published=folder/'published-terminal.json'
  if published.exists():rr=json.loads(published.read_text())
  else:
   rr=ctl.store.put('state/direct-cpu-operations/'+identity+'/terminal.json',outcome);save(published,rr)
  return {'operationId':op,'state':'completed'if outcome['exitCode']==0 and outcome['ownedGroupDrained']and not outcome['failure']and not outcome['timedOut']else'terminal-failure-retained','terminal':ref(terminal),'publishedTerminal':rr,'outputRoot':command['outputRoot'],'automaticRetry':False}
 if intent.exists():
  need(json.loads(intent.read_text())['command']==command,'Exclusive CPU intent changed')
  return {'operationId':op,'state':'issued-or-ambiguous-no-repeat','intent':ref(intent),'automaticRetry':False}
 if not allow_dispatch or now+command['timeoutSeconds']+15>=HARD:return {'operationId':op,'state':'stop-or-deadline'}
 need(not Path(command['outputRoot']).exists(),'Existing CPU output needs explicit terminal adoption')
 # This auxiliary operation never claims a scientific unit or opens the financial journal.
 from boto3.dynamodb.types import TypeSerializer
 ser=TypeSerializer()
 request={'pk':'direct-controller-cpu#'+identity,'operationId':op,'commandSha256':identity,'phase':'intent','hardDeadline':HARD,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False}
 ctl.claims.ddb.transact_write_items(TransactItems=[
 {'ConditionCheck':{'TableName':ctl.claims.table,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:source AND executionEnabled=:yes AND stopRequested=:no AND hardDeadline>:now','ExpressionAttributeValues':{':source':{'S':ctl.controller_source_sha256},':yes':{'BOOL':True},':no':{'BOOL':False},':now':{'N':str(int(now))}}}},
 {'Put':{'TableName':ctl.claims.table,'Item':{k:ser.serialize(v)for k,v in request.items()},'ConditionExpression':'attribute_not_exists(pk)'}}],ClientRequestToken=identity[:36])
 ir=save(intent,{'command':command,'configuration':config,'hardDeadline':HARD,'controllerSourceSha256':ctl.controller_source_sha256,'scientificAcceptanceAsserted':False})
 # Intent fsync precedes Popen. Crash/unknown outcome is retained, never retried.
 args=[sys.executable,'-B',str(Path(__file__).resolve()),'--execute',ir['path'],'--sha256',ir['sha256']]
 with(folder/'wrapper.stdout').open('xb')as so,(folder/'wrapper.stderr').open('xb')as se:
  p=subprocess.Popen(args,cwd=str(folder),stdout=so,stderr=se,start_new_session=True)
 save(folder/'launch.json',{'pid':p.pid,'startedAt':time.time(),'intent':ir,'controllerSourceSha256':ctl.controller_source_sha256})
 return {'operationId':op,'state':'issued-existing-cpu-entry','pid':p.pid,'intent':ir,'workerCommands':False,'ledgerWrites':False}
def successful_output(observation,relative):
 if observation['state']!='completed':return None
 p=Path(observation['outputRoot'])/relative
 need(p.is_file(),'Completed CPU command omitted '+relative)
 return ref(p)
def tick(ctl,config,now,allow_dispatch=True,owner_state=None):
 states=[];collection_states=[];dynamic_commands=[]
 if config.get('collectionAdapter'):
  a=module(config['collectionAdapter'],'root_existing_owner_collection')
  observed={}
  def walk(v):
   if isinstance(v,dict):
    if v.get('operationId')and v.get('evidence')and v.get('state')in('terminal-adopted','existing-owner-terminal-adopted-no-send','terminal-owner-evidence-adopted'):observed[v['operationId']]=v['evidence']
    for x in v.values():walk(x)
   elif isinstance(v,list):
    for x in v:walk(x)
  walk(owner_state or {})
  for cohort in config.get('collections',[]):
   active=[]
   for block in cohort['expectedBlocks']:
    index=block.get('exactIndex')or observed.get(block.get('operationId'))
    if not index:break
    active.append({k:v for k,v in block.items()if k not in('exactIndex','operationId')}|{'indexRef':index,'allChildrenDrained':True})
   if len(active)!=len(cohort['expectedBlocks']):
    collection_states.append({'seed':cohort['configuration']['seed'],'state':'awaiting-exact-owner-terminal-handles','actualBoundBlocks':len(active),'expectedBlocks':len(cohort['expectedBlocks'])});continue
   command=a.prepare(cohort['configuration'],{'blocks':active,'ownerLineage':cohort['ownerLineage']});dynamic_commands.append(command)
   collection_states.append({'seed':cohort['configuration']['seed'],'state':'collection-data-ready','operationId':command['operationId']})
 out={'kind':'root-direct-cpu-callback-tick-v1','observedAt':now,'operations':states,'validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'studyComplete':False}
 known={sha(raw(c)):c for c in config.get('preparedCommands',[])+dynamic_commands}
 for p in sorted(Path(config['stateDirectory']).glob('*/command.json')):
  need(len(known)<64,'Finite CPU callback inventory');c=json.loads(p.read_text())
  if (p.parent/'intent.json').exists():known.setdefault(sha(raw(c)),c)
 for command in known.values():
  try:states.append(reconcile(ctl,config,command,now,allow_dispatch))
  except Exception as e:states.append({'operationId':command.get('operationId'),'state':'retained-error-no-retry','errorType':type(e).__name__,'error':str(e)})
 out['collections']=collection_states
 closed=[]
 current_collection_ids={s['operationId']for s in collection_states if s['state']=='collection-data-ready'}
 for s in states:
  if s['state']=='completed'and s['operationId']in current_collection_ids:
   receipt=successful_output(s,'COLLECTION.json');v=json.loads(checked(receipt));closed.append({'seed':v['seed'],'receipt':v['receipt'],'activeGenerationManifest':v['activeGenerationManifest']})
 future=config.get('future')
 if future:
  f=module(future['source'],'root_original_future_callback');fc=json.loads(checked(future['configuration']))
  if closed:fc['closedCohorts']=closed
  context=sha(raw({k:fc.get(k)for k in('closedCohorts','workRoot','selectorConfiguration')}))
  # Adopt only explicit same-controller terminal receipts; never infer completion from output paths.
  for s in states:
   prior=next((c for c in known.values()if c['operationId']==s['operationId']),{})
   if prior.get('futureContext')!=context:continue
   if s['state']=='completed'and s['operationId'].startswith('combine-'):fc['combinedInput']=successful_output(s,'COMBINED-INPUT.json')
   if s['state']=='completed'and s['operationId'].startswith('select-'):fc['selectionResult']={k:successful_output(s,n)for k,n in [('selection','selection.json'),('segments','segments.json'),('schedule','selected-schedule.json')]}
  prepared=f.prepare_future(ctl,fc,now=now);out['future']=prepared
  for command in prepared.get('preparedCpuCommands',[]):
   command['futureContext']=context
   try:states.append(reconcile(ctl,config,command,now,allow_dispatch))
   except Exception as e:states.append({'operationId':command.get('operationId'),'state':'retained-error-no-retry','errorType':type(e).__name__,'error':str(e)})
 return out
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--execute',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();raise SystemExit(execute(a.execute,a.sha256))
