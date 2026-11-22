"""Publish completed CPU report artifacts; no worker, ledger or scientific actions."""
import argparse,concurrent.futures,hashlib,json,os
from pathlib import Path
import boto3
def sha(b):return hashlib.sha256(b).hexdigest()
def ref(p):
 b=p.read_bytes();return {'path':str(p),'sha256':sha(b),'bytes':len(b)}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--inputs',required=True);ap.add_argument('--sha256',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
 b=Path(a.inputs).read_bytes();assert sha(b)==a.sha256;spec=json.loads(b);out=Path(a.output);assert not out.exists()
 for r in spec['requiredReady']:
  assert sha(Path(r['path']).read_bytes())==r['sha256']
 files=[]
 for root in spec['roots']:
  p=Path(root);assert p.is_dir() and not p.is_symlink()
  files.extend(x for x in p.rglob('*') if x.is_file() and not x.is_symlink())
 assert len(files)==len({str(p)for p in files}) and len(files)<=5000
 s3=boto3.client('s3')
 def publish(p):
  r=ref(p);key=spec['prefix']+'/objects/'+r['sha256']+'/'+p.name
  try:v=s3.put_object(Bucket=spec['bucket'],Key=key,Body=p.read_bytes(),IfNoneMatch='*')['VersionId']
  except s3.exceptions.ClientError as e:
   if e.response['Error']['Code'] not in ('PreconditionFailed','412'):raise
   q=s3.get_object(Bucket=spec['bucket'],Key=key);assert sha(q['Body'].read())==r['sha256'];v=q['VersionId']
  return dict(r,bucket=spec['bucket'],key=key,versionId=v)
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:refs=list(pool.map(publish,files))
 out.mkdir(parents=True);value={'kind':'root-heldout-cpu-artifacts-published-v1','artifacts':refs,'artifactCount':len(refs),'input':ref(Path(a.inputs)),'scientificAcceptanceAsserted':False,'studyComplete':False,'authorizesGpuStop':False}
 p=out/'READY.json';p.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n');rr=publish(p)
 print(json.dumps({'ready':rr,'artifactCount':len(refs)}))
if __name__=='__main__':main()
