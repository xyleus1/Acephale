import json
CLAIM = json.loads('{"path": "/srv/acephale/workspaces/operator/funded-serial00-01/CLAIMED-SERIAL05-02.json", "sha256": "c3e25cee3bc64ec7be3fb106d5d6ad6162797b71b10657ff02ac6cc1aad9eda5", "bytes": 10888, "bucket": "example-study-artifacts", "key": "audit/parallel-rescue-20261121/operator/funded-serial00-01/objects/c3e25cee3bc64ec7be3fb106d5d6ad6162797b71b10657ff02ac6cc1aad9eda5/CLAIMED-SERIAL05-02.json", "versionId": "EXAMPLE_IMMUTABLE_VERSION"}')
TARGET = 'rescue-notebook-fleet-04-use1-g8'
SEQUENCE = 11
PREFIX = 'seed17-development-block00-serial05'
import pathlib,json,hashlib,boto3,tarfile,io,os,subprocess,time
P=pathlib.Path;s=boto3.client('s3');B='example-study-artifacts';A=TARGET
def fetch(r):
 z=s.get_object(Bucket=r.get('bucket',B),Key=r['key'],VersionId=r['versionId']);v=z['Body'].read();assert hashlib.sha256(v).hexdigest()==r['sha256']
 if 'bytes'in r:assert len(v)==r['bytes']
 return v
claimed=json.loads(fetch(CLAIM))
packageReady=claimed['ready'];assert claimed['claimed'] is True and claimed['contract']==packageReady['contract']
contract=json.loads(fetch(claimed['ready']['contract']));assert contract['mailboxSequence']==SEQUENCE and contract['targetResourceAttemptId']==A
assert claimed['block']['runIds']==contract['firstBlockRunIds']==packageReady['runIds']
assert claimed['block']['resourceAttemptId']==A
delivery=json.loads(fetch(claimed['ready']['delivery']));archive=fetch(claimed['ready']['archive'])
rows=delivery if isinstance(delivery,list)else delivery['files'];assert len(rows)==packageReady['fileCount']
assert len({r['path']for r in rows})==packageReady['fileCount']
root=P('/srv/acephale/artifacts/'+PREFIX+'-dispatch01');root.mkdir(parents=True,exist_ok=False)
(root/'CLAIMED-BLOCK01.json').write_text(json.dumps(claimed));(root/'DISPATCH-CONTRACT-BLOCK01.json').write_text(json.dumps(contract));(root/'DELIVERY-BLOCK01.json').write_text(json.dumps(delivery))
installed=[]
with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz')as tf:
 members=[m for m in tf.getmembers()if m.isfile()]
 assert all(m.isfile()or m.isdir()for m in tf.getmembers())
 used=set()
 for row in rows:
  dst=P(row['path']);assert dst.is_absolute()and str(dst).startswith('/srv/acephale/')and '..'not in dst.parts
  assert str(dst)!='/srv/acephale/shared/budget.jsonl'and not str(dst).startswith('/srv/acephale/shared/')
  matches=[m for m in members if m.name in [str(dst),str(dst).lstrip('/'),row.get('member'),row.get('archivePath')]]
  assert len(matches)==1,(row['path'],'archive member binding');member=matches[0];assert member.name not in used;used.add(member.name)
  raw=tf.extractfile(member).read();assert hashlib.sha256(raw).hexdigest()==row['sha256']and len(raw)==row['bytes']
  assert not any(p.is_symlink()for p in(dst,*dst.parents))
  if dst.exists():assert dst.is_file()and dst.read_bytes()==raw,('different existing file',str(dst))
  else:
   dst.parent.mkdir(parents=True,exist_ok=True);fd=os.open(dst,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),member.mode&0o755 or 0o644)
  installed.append({'path':str(dst),'sha256':row['sha256'],'bytes':len(raw)})
claimed.setdefault('exactCommand',contract['command']);assert contract['command']==claimed['exactCommand'];assert contract['timeoutSeconds']==6000
journal=P('/srv/acephale/shared/budget.jsonl');assert journal.stat().st_ino==17113617401157895978
meta=json.loads(P('/opt/ml/metadata/resource-metadata.json').read_text());assert meta['ResourceArn']==contract['notebookArn']
receipt={'at':time.time(),'resourceAttemptId':A,'notebookArn':meta['ResourceArn'],'claim':CLAIM,'contract':claimed['ready']['contract'],'archive':claimed['ready']['archive'],'files':installed,'exactCommand':contract['command'],'sharedJournalCopied':False,'scientificClaimAlreadyOwnedByExecution':True,'qualificationPassed':False}
body=(json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode();h=hashlib.sha256(body).hexdigest();(root/'staging-receipt.json').write_bytes(body);k='workers/'+A+'/unvalidated/'+PREFIX+'/staging-'+h+'.json';z=s.put_object(Bucket=B,Key=k,Body=body,IfNoneMatch='*');print('STAGED_ORIGINAL_COMMAND',json.dumps({'sha256':h,'key':k,'versionId':z['VersionId'],'fileCount':len(installed),'at':time.time()}),flush=True)
child=subprocess.Popen(contract['command'],cwd=contract['cwd'])
unit=next(x.split('=',1)[1]for x in contract['command']if x.startswith('--unit='))
deadline=time.time()+10;state=''
while time.time()<deadline:
 state=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ActiveState','-p','SubState'],capture_output=True,text=True).stdout
 if any(x.startswith('MainPID=')and x!='MainPID=0'for x in state.splitlines())or child.poll()is not None:break
 time.sleep(.25)
started={'at':time.time(),'resourceAttemptId':A,'claim':CLAIM,'contract':claimed['ready']['contract'],'transportChildPid':child.pid,'unit':unit,'unitState':state,'exactCommand':contract['command'],'qualificationPassed':False}
raw=(json.dumps(started,sort_keys=True,indent=2)+'\n').encode();h=hashlib.sha256(raw).hexdigest();(root/'process-started.json').write_bytes(raw);key='workers/'+A+'/unvalidated/'+PREFIX+'/STARTED-'+h+'.json';z=s.put_object(Bucket=B,Key=key,Body=raw,IfNoneMatch='*')
print('ACTUAL_PROCESS_STARTED',json.dumps({'key':key,'versionId':z['VersionId'],'sha256':h,'transportChildPid':child.pid,'unitState':state}),flush=True)
try:code=child.wait(timeout=contract['timeoutSeconds'])
except subprocess.TimeoutExpired:
 child.terminate();child.wait(timeout=30);raise
state=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ActiveState','-p','SubState'],capture_output=True,text=True).stdout
journal=subprocess.run(['journalctl','-u',unit,'--no-pager','-o','cat'],capture_output=True,text=True).stdout
(root/'terminal-unit.json').write_text(json.dumps({'at':time.time(),'unit':unit,'state':state,'transportExitCode':code,'journal':journal}))
try:
 assert 'MainPID=0'in state and 'ActiveState=inactive'in state,('unit not drained',state)
 def outputpath(argv):return P(argv[argv.index('--output')+1])
 roots={'attempt':outputpath(contract['command']),'run':outputpath(contract['nativeCommand']),'transport':root}
 files=[]
 for label,r in roots.items():
  for p in sorted(r.rglob('*')):
   if not p.is_file():continue
   assert not p.is_symlink();v=p.read_bytes();h=hashlib.sha256(v).hexdigest()
   key='workers/'+A+'/unvalidated/'+PREFIX+'/raw/'+label+'/'+str(p.relative_to(r))+'/'+h
   z=s.put_object(Bucket=B,Key=key,Body=v,IfNoneMatch='*')
   files.append({'path':str(p),'bucket':B,'key':key,'versionId':z['VersionId'],'sha256':h,'bytes':len(v)})
 summarypath=roots['run']/'summary.json';outpath=roots['run']/'outcomes.jsonl'
 summary=json.loads(summarypath.read_text())if summarypath.exists()else None
 outcomes=[json.loads(x)for x in outpath.read_text().splitlines()if x]if outpath.exists()else []
 idx={'kind':'acephale-native-development-block-collected-v1','resourceAttemptId':A,'blockIndex':contract['blockIndex'],'at':time.time(),'claim':CLAIM,'contract':claimed['ready']['contract'],'unitState':state,'files':files,'summary':summary,'outcomeRows':len(outcomes),'transportExitCode':code,'scientificRerun':False,'qualificationPassed':False,'executionOwnsDisposition':True}
 raw=(json.dumps(idx,sort_keys=True,indent=2)+'\n').encode();h=hashlib.sha256(raw).hexdigest();key='workers/'+A+'/unvalidated/'+PREFIX+'/RAW-INDEX-'+h+'.json'
 z=s.put_object(Bucket=B,Key=key,Body=raw,IfNoneMatch='*');ref={'bucket':B,'key':key,'versionId':z['VersionId'],'sha256':h,'bytes':len(raw)}
 (root/'raw-index-ref.json').write_text(json.dumps(ref))
 print('RAW_COLLECTION',json.dumps({'ref':ref,'files':len(files),'summary':summary,'outcomes':outcomes}),flush=True)
except Exception as e:
 (root/'publication-error.json').write_text(json.dumps({'at':time.time(),'type':type(e).__name__,'message':str(e),'scientificRerun':False}))
 raise
raise SystemExit(code)
