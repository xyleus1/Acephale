"""Restore two exact owner-selected heldout cohort exports; never rerun or relabel."""
import argparse,concurrent.futures,hashlib,json,os
from pathlib import Path
import boto3
def sha(b):return hashlib.sha256(b).hexdigest()
def raw(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':sha(b),'bytes':len(b)}
def save(p,b):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():assert p.is_file() and not p.is_symlink() and p.read_bytes()==b,str(p)
 else:
  with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 return ref(p)
def read(r):
 b=Path(r['path']).read_bytes();assert sha(b)==r['sha256'];return json.loads(b)
def normalized_unit_state(value):
 if isinstance(value,dict):return dict(value)
 assert isinstance(value,str),'Unsupported exported unitState type'
 return dict(line.split('=',1) for line in value.splitlines() if '=' in line)
def drained(v):
 v=normalized_unit_state(v)
 return str(v.get('MainPID'))=='0' and v.get('ActiveState') in ('inactive','failed') and v.get('SubState') in ('dead','exited','failed')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--inputs',required=True);ap.add_argument('--sha256',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
 inputs=read({'path':a.inputs,'sha256':a.sha256});out=Path(a.output);assert out.is_absolute() and not out.exists()
 assert inputs['kind']=='root-two-original-heldout-exports-v1' and inputs['validationStatus']=='unvalidated'
 reservation=read(inputs['reservation']);plan=reservation['plan'];selected=read(inputs['selection']);ids=selected['selectedRunIds']
 serving_ids=[r['runId'] for r in plan['runs']]
 assert len(serving_ids)==len(set(serving_ids))==len(ids)==len(set(ids)) and set(serving_ids)==set(ids),'Selected and serving identities differ'
 assert [rid for segment_ids in plan['segments'] for rid in segment_ids]==serving_ids,'Original serving segment order differs'
 assert len(inputs['segments'])==len(plan['segments'])==2
 out.mkdir(parents=True);cache=out/'objects';s3=boto3.client('s3')
 def fetch(r):
  assert r['bucket']==inputs['bucket'] and r['versionId'] and len(r['sha256'])==64
  p=cache/r['sha256']
  b=p.read_bytes() if p.exists() else s3.get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])['Body'].read()
  assert sha(b)==r['sha256'] and ('bytes' not in r or len(b)==r['bytes'])
  save(p,b);return p
 receipts=[];provenance=[];allrows={};configrows={}
 for segment in inputs['segments']:
  n=segment['segmentNumber'];assert n in (1,2)
  expected=plan['segments'][n-1];assert segment['runIds']==expected
  index=json.loads(fetch(segment['indexRef']).read_text());assert index['resourceAttemptId']==segment['resourceAttemptId']
  assert drained(index['unitState']),'Raw export must attest physical drain'
  rows=index['files'];assert len(rows)==len({r['path'] for r in rows})
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:local=list(pool.map(fetch,rows))
  mapping={r['path']:(r,p) for r,p in zip(rows,local)}
  origin=segment['runRoot']+'/cohort-receipt.json';rr,rp=mapping[origin];receipt=json.loads(rp.read_text())
  assert receipt['closed'] is True and receipt['allDeclaredSlotsRetained'] is True and receipt['stage']=='heldout'
  dest=out/'cohorts'/('segment-'+str(n));save(dest/'cohort-receipt.json',rp.read_bytes())
  for member in receipt['files']:
   relative=Path(member['path']);assert not relative.is_absolute() and '..' not in relative.parts
   r,p=mapping[str(Path(segment['runRoot'])/relative)];assert r['sha256']==member['sha256'];save(dest/relative,p.read_bytes())
  outcomes=[json.loads(l) for l in (dest/'outcomes.jsonl').read_text().splitlines()]
  configuration=json.loads((dest/'configuration.json').read_text())
  assert [r['runId'] for r in outcomes]==expected and [r['runId'] for r in configuration['runs']]==expected
  for r in outcomes:assert r['runId'] not in allrows;allrows[r['runId']]=r
  for r in configuration['runs']:assert r['runId'] not in configrows;configrows[r['runId']]=r
  receipts.append(ref(dest/'cohort-receipt.json'));provenance.append({'segment':segment,'rawIndex':segment['indexRef'],'originalReceipt':rr,'materializedReceipt':receipts[-1],'rawFiles':rows})
 assert set(allrows)==set(configrows)==set(ids)
 for original in plan['runs']:
  actual=configrows[original['runId']];assert actual==original,'Original selected run construction changed'
 receiptInputs=save(out/'receipt-inputs.json',raw(receipts));provenanceRef=save(out/'SOURCE-PROVENANCE.json',raw(provenance))
 outcomeRef=save(out/'outcomes.jsonl',b''.join(raw(allrows[i]) for i in ids));runRows=save(out/'original-run-rows.json',raw([configrows[i] for i in ids]))
 result={'kind':'root-complete-original-heldout-export-collection-v1','validationStatus':'unvalidated','scientificAcceptanceAsserted':False,'studyComplete':False,'ownerExecutionClosed':True,'allChildrenDrained':True,'originalSelectedCount':len(ids),'observedCount':len(allrows),'missingRunIds':[],'duplicateRunIds':[],'receiptInputs':receiptInputs,'outcomes':outcomeRef,'provenance':provenanceRef,'originalRunRows':runRows,'selection':inputs['selection'],'reservation':inputs['reservation'],'scopeAmendment':inputs['scopeAmendment'],'inputs':ref(a.inputs),'collectionSource':ref(__file__),'rawRowsUnchanged':True,'originalServingRunIds':serving_ids,'derivedCollectionOrder':'original-selected-run-ids','automaticRetry':False}
 save(out/'COLLECTION.json',raw(result))
 published=[]
 for p in [out/'COLLECTION.json',out/'receipt-inputs.json',out/'SOURCE-PROVENANCE.json',out/'outcomes.jsonl',out/'original-run-rows.json']:
  r=ref(p);key=inputs['publishPrefix']+'/objects/'+r['sha256']+'/'+p.name
  try:v=s3.put_object(Bucket=inputs['bucket'],Key=key,Body=p.read_bytes(),IfNoneMatch='*')['VersionId']
  except s3.exceptions.ClientError as e:
   if e.response['Error']['Code'] not in ('PreconditionFailed','412'):raise
   q=s3.get_object(Bucket=inputs['bucket'],Key=key);assert sha(q['Body'].read())==r['sha256'];v=q['VersionId']
  published.append(dict(r,bucket=inputs['bucket'],key=key,versionId=v))
 save(out/'PUBLISHED.json',raw(published));print(json.dumps({'collection':ref(out/'COLLECTION.json'),'published':ref(out/'PUBLISHED.json'),'count':len(ids)}))
if __name__=='__main__':main()
