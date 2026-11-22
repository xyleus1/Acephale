/workspace/acephale/ops-venv/bin/python - <<'PY'
from pathlib import Path
import json,hashlib,boto3,time
D=Path('/workspace/acephale/workspaces/operator/heldout-checkpoint-projection-01');D.mkdir(exist_ok=True)
P=Path('/workspace/acephale/workspaces/operator/rpc-heldout-transition-01/budget.jsonl.checkpoint.v1.36739.901009b92ff9b3faeb1b47fa611824a1a7dddf3d174615a48191db6e1dac2da9.json')
M=Path('/workspace/acephale/workspaces/root/heldout-finance-20261122-01/ORIGINAL-OWNER-SNAPSHOT.json')
R=Path('/workspace/acephale/workspaces/root/heldout-finance-20261122-01/ORIGINAL-COHORT-RESERVATION.json')
h=lambda b:hashlib.sha256(b).hexdigest()
canon=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
x=json.loads(P.read_text());m=json.loads(M.read_text());r=json.loads(R.read_text());policy=m['metadata']['policy']
assert h(P.read_bytes())=='56e3570a211f22f71948cc9dd2fc3b4fe37620290b4b49b2c4bebe558d213cbb'
assert h(canon(x['entries']).encode())==x['entriesHash']
assert x['journalPathHash']==r['ledgerPathHash']
entries=[dict(id=k,**v) for k,v in x['entries']]
entries_hash=h(canon(entries).encode())
wanted={z['runId'] for z in r['plan']['runs']}
by={z['id']:z for z in entries}
assert len(wanted)==96
for run in wanted:
 row=by['infra:'+run]
 assert row['allocation']=='heldout' and row['maximum']==1250000 and 'actual' not in row
 assert not any(z.get('parentId')=='infra:'+run for z in entries)
value={'version':1,'ledgerPathHash':x['journalPathHash'],'entriesHash':entries_hash,'entries':entries,'budgetPolicyHash':policy['policyHash'],'budgetAmendmentHash':policy['contentHash']}
assert value['budgetPolicyHash']=='c58230aaa05f76984f6b26a5acb509bfea89b67fef9f15db918594039d1e6354'
assert value['budgetAmendmentHash']=='f491027279bde0f1860bce1ff2ad9665dbaa819149ded508033b71a69e9a93e5'
def save(p,v):
 raw=(canon(v)+'\n').encode()
 if p.exists(): assert p.read_bytes()==raw
 else:
  with p.open('xb') as f:f.write(raw)
 return {'path':str(p),'sha256':h(raw),'bytes':len(raw)}
cp=D/'checkpoint.json';ref=save(cp,value)
s3=boto3.client('s3');bucket='EXAMPLE_ARTIFACT_BUCKET'
def pub(p,ref):
 key='audit/parallel-rescue-20261121/ROOT/heldout-checkpoint-projection-01/objects/'+ref['sha256']+'/'+p.name
 try:v=s3.put_object(Bucket=bucket,Key=key,Body=p.read_bytes(),IfNoneMatch='*')['VersionId']
 except s3.exceptions.ClientError as e:
  if e.response['Error']['Code'] not in ['PreconditionFailed','ConditionalRequestConflict']:raise
  q=s3.get_object(Bucket=bucket,Key=key);assert h(q['Body'].read())==ref['sha256'];v=q['VersionId']
 return dict(ref,bucket=bucket,key=key,versionId=v)
ref=pub(cp,ref); receipt={'kind':'original-owner-checkpoint-schema-projection-v1','checkpoint':ref,'sourceOwnerCloseCheckpoint':{'path':str(P),'sha256':h(P.read_bytes())},'policyMetadataSource':{'path':str(M),'sha256':h(M.read_bytes())},'reservation':{'path':str(R),'sha256':h(R.read_bytes())},'originalProjectionSource':'scripts/acephale-infra-cohort.ts:21-23','reservationValuesIdentical':True,'entryShapeProjection':'durable map pairs to original ledger.snapshot rows with id field','entriesHashMatchesReservedEntriesHash':entries_hash==r['reservedEntriesHash'],'all96ReservedParentsUnconsumed':True,'newLedgerWriter':False,'ledgerMutation':False,'originalExporterInvoked':False}
rp=D/'READY.json'; rr=pub(rp,save(rp,receipt)); print(json.dumps({'checkpoint':ref,'ready':rr,'entries':len(x['entries'])}))

PY