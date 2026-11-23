"""Source-only, finite post-close EFS root coverage helper. No import-time AWS actions."""
import copy,hashlib,json,os,pathlib,subprocess,time
FS='REQUIRED_BINDINGS_STORAGE'
ACCOUNT='REQUIRED_BINDINGS_ACCOUNT'
REGION='us-east-1'
BUCKET='REQUIRED_BINDINGS_ARTIFACT_BUCKET'
ROLE='REQUIRED_BINDINGS_ARN'
FSARN='REQUIRED_BINDINGS_ARN'+REGION+':'+ACCOUNT+':file-system/'+FS
PROJECT='acephale-aws-20261121'
PURPOSE='corrective-readonly-root-archive'
QUEUE=pathlib.Path('/REQUIRED_BINDINGS/research-root/shared/execution-budget-rpc01/production04-corrective')
BASE=pathlib.Path('/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-efs-root-archive-01')
def need(x,message):
 if not x:raise RuntimeError(message)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def same_policy(a,b):return json.loads(a)==json.loads(b)
def read_ref(r,s3):
 need(r.get('bucket')==BUCKET and all(r.get(k)for k in('key','versionId','sha256'))and type(r.get('bytes'))is int,'exact private versioned reference')
 b=s3.get_object(Bucket=BUCKET,Key=r['key'],VersionId=r['versionId'])['Body'].read()
 need(len(b)==r['bytes']and sha(b)==r['sha256'],'immutable evidence changed')
 return b
def temporary_policy(original,aparn):
 need(aparn.startswith('REQUIRED_BINDINGS_ARN'+REGION+':'+ACCOUNT+':access-point/fsap-'),'exact local temporary AP ARN')
 p=json.loads(original);need(type(p.get('Statement'))is list,'existing policy statements')
 need(not any(x.get('Sid')=='CorrectiveReadOnlyRootArchive'for x in p['Statement']),'existing unexpected root archive statement')
 p['Statement'].append({'Sid':'CorrectiveReadOnlyRootArchive','Effect':'Allow','Principal':{'AWS':ROLE},'Action':'elasticfilesystem:ClientMount','Resource':FSARN,'Condition':{'StringEquals':{'elasticfilesystem:AccessPointArn':aparn},'Bool':{'aws:SecureTransport':'true','elasticfilesystem:AccessedViaMountTarget':'true'}}})
 check=copy.deepcopy(p);check['Statement'].pop();need(check==json.loads(original),'existing policy changed')
 return json.dumps(p,sort_keys=True,separators=(',',':'))
def inventory_root(mount):
 entries=[]
 for p in sorted(mount.iterdir(),key=lambda x:x.name):
  st=p.lstat();entries.append({'name':p.name,'directory':p.is_dir()and not p.is_symlink(),'symlink':p.is_symlink(),'uid':st.st_uid,'gid':st.st_gid,'mode':oct(st.st_mode&0o7777),'size':st.st_size})
 known=[x for x in entries if x['name']=='study']
 need(len(known)==1 and known[0]['directory'],'known /study is absent or not a literal directory; retain filesystem')
 return entries,all(x['name']=='study'for x in entries)
def run_command(argv):
 r=subprocess.run(argv,capture_output=True,text=True,timeout=120)
 need(r.returncode==0,'bounded operating-system operation failed: '+repr(argv[:2])+' '+r.stderr[-2000:])
 return r.stdout
def verify_drained(context,s3):
 for service in('acephale-continuation-controller.service','goalspec-budget-rpc-production01.service'):
  state=dict(x.split('=',1)for x in run_command(['systemctl','show',service,'--property=MainPID,ControlPID,ActiveState']).splitlines()if'='in x)
  need(state.get('MainPID')=='0'and state.get('ControlPID','0')=='0'and state.get('ActiveState')in('inactive','failed'),'actual controlplane must already be drained')
 terminal_bytes=read_ref(context['originalRpcTerminal'],s3)
 need((QUEUE/'TERMINAL.json').read_bytes()==terminal_bytes,'current production04 original terminal binding')
 t=json.loads(terminal_bytes);need(not t.get('error')and not t.get('closeError')and t.get('activeSessions')==[]and t.get('activeParticipants')==[],'original RPC terminal is not cleanly closed')
 need(not pathlib.Path('/REQUIRED_BINDINGS/research-root/shared/budget.jsonl.lock').exists(),'journal owner remains active')
 read_ref(context['rootAuthority'],s3)
 need(context.get('queueRoot')==str(QUEUE),'current queue only')
 return context['originalRpcTerminal']['sha256']
def ap_identity(v,token):
 need(v['FileSystemId']==FS and v['ClientToken']==token and v['RootDirectory'].get('Path')=='/'and 'CreationInfo'not in v['RootDirectory'],'exact existing root AP; no directory creation')
 need(v['PosixUser'].get('Uid')==1000 and v['PosixUser'].get('Gid')==1000 and not v['PosixUser'].get('SecondaryGids') and set(v['PosixUser']).issubset({'Uid','Gid','SecondaryGids'}),'non-root original study identity')
 tags={x['Key']:x['Value']for x in v.get('Tags',[])}
 need(tags.get('Project')==PROJECT and tags.get('ArchivePurpose')==PURPOSE,'exact temporary AP tags')
 return v
def listed_ap(efs,ap):
 return [v for page in efs.get_paginator('describe_access_points').paginate(FileSystemId=FS)for v in page['AccessPoints']if v['AccessPointId']==ap]
def wait_ap(efs,ap,token,want_absent=False):
 until=time.time()+120
 while time.time()<until:
  try:
   rows=listed_ap(efs,ap)
   if want_absent and not rows:return None
   need(len(rows)==1,'single AP')
   v=ap_identity(rows[0],token)
   if not want_absent and v['LifeCycleState']=='available':return v
   need(v['LifeCycleState']in('creating','available','deleting'),'unexpected AP lifecycle')
  except efs.exceptions.AccessPointNotFound:
   if want_absent:return None
   raise
  time.sleep(2)
 raise RuntimeError('bounded temporary AP state wait expired')
def after_rpc_close(context,output_root,archive_tree,publish_file,publish_json):
 """Called by the hash-bound finalizer only after its complete original RPC close/export gates."""
 import boto3
 s3=boto3.client('s3',region_name=REGION);efs=boto3.client('efs',region_name=REGION)
 terminal_sha=verify_drained(context,s3)
 out=pathlib.Path(output_root).resolve();need(out.is_relative_to('/REQUIRED_BINDINGS/research-root/workspaces')and out.name=='efs-root-coverage','isolated exact helper output')
 out.mkdir(parents=True,exist_ok=True);result_path=out/'RESULT.json'
 if result_path.exists():
  prior=json.loads(result_path.read_bytes());need(prior['originalRpcTerminal']==context['originalRpcTerminal'],'same close evidence')
  need(prior['policyRestored']and prior['temporaryAccessRemoved'],'retained incomplete cleanup requires exact administrative adoption')
  return prior
 need(not(out/'STARTED.json').exists(),'retained incomplete root archive requires exact administrative adoption; no automatic retry')
 with(out/'STARTED.json').open('xb')as f:f.write(raw({'originalRpcTerminal':context['originalRpcTerminal'],'rootAuthority':context['rootAuthority']}))
 expected=(BASE/'original-filesystem-policy.json').read_bytes()
 binding=json.loads((BASE/'ORIGINAL-POLICY-BINDING.json').read_bytes());need(sha(expected)==binding['sha256'],'sealed original policy changed')
 current=efs.describe_file_system_policy(FileSystemId=FS)['Policy']
 need(same_policy(current,expected.decode()),'original filesystem policy changed; no mutation')
 original_path=out/'ORIGINAL-POLICY.json';original_path.write_text(current);original_ref=publish_file(original_path)
 token=sha((FS+':'+terminal_sha+':root-readonly-v1').encode())
 tags=[{'Key':'Project','Value':PROJECT},{'Key':'ArchivePurpose','Value':PURPOSE},{'Key':'RpcTerminalSha256','Value':terminal_sha}]
 publish_json('EFS-ROOT-AP-INTENT.json',{'fileSystemId':FS,'clientToken':token,'posixUser':{'Uid':1000,'Gid':1000},'rootDirectory':{'Path':'/'},'tags':tags,'readOnly':True,'rootAccess':False})
 mount=out/'mount';mount.mkdir(mode=0o700);need(not any(mount.iterdir()),'empty isolated mountpoint')
 ap=None;temporary=None;mounted=False;policy_changed=False;archive=None;entries=[];coverage=False;error=None;cleanup_errors=[];policy_restored=True;ap_removed=True
 try:
  verify_drained(context,s3)
  ap_removed=False
  ap=ap_identity(efs.create_access_point(ClientToken=token,FileSystemId=FS,PosixUser={'Uid':1000,'Gid':1000},RootDirectory={'Path':'/'},Tags=tags),token);ap_removed=False
  publish_json('EFS-ROOT-AP-CREATED.json',ap)
  ap=wait_ap(efs,ap['AccessPointId'],token)
  temporary=temporary_policy(current,ap['AccessPointArn'])
  need(same_policy(efs.describe_file_system_policy(FileSystemId=FS)['Policy'],current),'policy changed before exact replacement')
  publish_json('EFS-ROOT-POLICY-INTENT.json',{'original':original_ref,'temporary':json.loads(temporary),'clientWriteGranted':False,'clientRootAccessGranted':False})
  policy_changed=True;policy_restored=False
  efs.put_file_system_policy(FileSystemId=FS,Policy=temporary,BypassPolicyLockoutSafetyCheck=False)
  need(same_policy(efs.describe_file_system_policy(FileSystemId=FS)['Policy'],temporary),'temporary policy readback')
  run_command(['mount','-t','efs','-o','ro,tls,iam,accesspoint='+ap['AccessPointId'],FS+':/',str(mount)]);mounted=True
  info=[x.split()for x in pathlib.Path('/proc/self/mountinfo').read_text().splitlines()if len(x.split())>6 and x.split()[4]==str(mount)]
  need(len(info)==1 and 'ro'in info[0][5].split(','),'actual readonly mount required')
  entries,coverage=inventory_root(mount)
  publish_json('EFS-ROOT-INVENTORY.json',{'fileSystemId':FS,'accessPointId':ap['AccessPointId'],'rootDirectory':'/','posixUser':{'Uid':1000,'Gid':1000},'mountReadOnly':True,'entries':entries,'onlyKnownProjectStudyRoot':coverage})
  source=mount if coverage else mount/'study'
  scope={'fileSystemId':FS,'rootDirectory':'/'if coverage else'/study','filesystemRootCoverage':coverage,'unrelatedRootEntriesPreserved':[x['name']for x in entries if x['name']!='study'],'readOnly':True,'temporaryAccessPoint':ap['AccessPointId'],'originalRpcTerminal':context['originalRpcTerminal']}
  archive=archive_tree(source,'efs-root-private'if coverage else'efs-known-study-private',scope)
  need(archive.get('complete')is True and archive.get('readbackVerified')is True and archive.get('unchangedDuringArchive')is True and type(archive.get('entryCount'))is int,'complete immutable archive proof required')
  for key in('archive','manifest'):need(all(archive[key].get(x)for x in('bucket','key','versionId','sha256'))and type(archive[key].get('bytes'))is int,'versioned private archive and manifest')
  entries_after,coverage_after=inventory_root(mount);need(entries_after==entries and coverage_after==coverage,'root inventory changed while drained')
 except Exception as exc:error=type(exc).__name__+': '+str(exc)
 finally:
  mounted=any(len(x.split())>6 and x.split()[4]==str(mount) for x in pathlib.Path('/proc/self/mountinfo').read_text().splitlines())
  if mounted:
   try:run_command(['umount',str(mount)]);mounted=False
   except Exception as exc:cleanup_errors.append('unmount: '+str(exc))
  if policy_changed:
   try:
    observed=efs.describe_file_system_policy(FileSystemId=FS)['Policy']
    need(same_policy(observed,temporary)or same_policy(observed,current),'policy changed independently; refuse overwrite')
    if not same_policy(observed,current):efs.put_file_system_policy(FileSystemId=FS,Policy=current,BypassPolicyLockoutSafetyCheck=False)
    need(same_policy(efs.describe_file_system_policy(FileSystemId=FS)['Policy'],current),'original policy restoration readback');policy_restored=True
   except Exception as exc:cleanup_errors.append('policy restore: '+str(exc))
  if ap is not None and not mounted and policy_restored:
   try:
    rows=listed_ap(efs,ap['AccessPointId']);need(len(rows)==1,'single temporary AP before deletion');ap_identity(rows[0],token)
    efs.delete_access_point(AccessPointId=ap['AccessPointId']);wait_ap(efs,ap['AccessPointId'],token,True);ap_removed=True
   except efs.exceptions.AccessPointNotFound:ap_removed=True
   except Exception as exc:cleanup_errors.append('temporary AP removal: '+str(exc))
 proof={'kind':'acephale-drained-efs-root-archive-proof-v1','originalRpcTerminal':context['originalRpcTerminal'],'rootAuthority':context['rootAuthority'],'fileSystemId':FS,'originalPolicy':original_ref,'entries':entries,'archive':archive,'filesystemRootCoverage':coverage and error is None,'retainFilesystem':not(coverage and error is None and not cleanup_errors),'policyRestored':policy_restored,'temporaryAccessRemoved':ap_removed,'error':error,'cleanupErrors':cleanup_errors,'noFileSystemDataWrites':True,'noClientRootAccessGranted':True}
 proofref=publish_json('EFS-ROOT-COVERAGE-PROOF.json',proof)
 result={'state':'completed'if error is None and not cleanup_errors else'failed','proof':proofref,'filesystemRootCoverage':proof['filesystemRootCoverage'],'retainFilesystem':proof['retainFilesystem'],'policyRestored':policy_restored,'temporaryAccessRemoved':ap_removed,'originalRpcTerminal':context['originalRpcTerminal']}
 result_path.write_bytes(raw(result))
 need(error is None and not cleanup_errors,'EFS root coverage failed; retained proof '+json.dumps(result))
 return result
