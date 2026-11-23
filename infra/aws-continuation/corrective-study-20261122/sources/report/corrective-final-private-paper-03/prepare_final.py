"""Prepare one finite paper-only render after existing 36/96 analysis and final host proofs."""
from pathlib import Path
import argparse,hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parent
def need(v,m):
 if not v:raise ValueError(m)
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def read(r):
 p=Path(r['path']);need(ref(p)['sha256']==r['sha256'],'Pinned input differs');return json.loads(p.read_bytes())
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);b=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
 if p.exists():need(p.read_bytes()==b,'Immutable output differs')
 else:
  with p.open('xb') as f:f.write(b)
 return ref(p)
def load(r,name):
 read_source=Path(r['path']);need(ref(read_source)['sha256']==r['sha256'],'Pinned source differs')
 s=importlib.util.spec_from_file_location(name,read_source);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def prepare(config):
 c=load(config['continuationSource'],'existing_continuation02');cfg=c.read(config['continuationConfiguration'])
 sources=c.source_refs(cfg['sourceBinding']);analyses={}
 for stage in ('development','heldout'):
  value=c.stage_binding(cfg,stage)
  if value is None:return {'launch':False,'state':'waiting-real-closed-'+stage}
  key=c.analysis_identity(value,sources);p=Path(cfg['outputRoot'])/'analysis'/stage/key/'result/READY/result.json'
  if not p.exists():return {'launch':False,'state':'waiting-existing-original-analysis-'+stage}
  ar=c.read(c.ref(p));need(ar['source']['sha256']==sources['originalAnalysis']['sha256'],'Original estimator identity differs')
  analyses[stage]=c.ref(p)
 telemetry={}
 for seed in ('17','29'):
  root=Path(cfg['operationRoot'])/('telemetry-seed'+seed)/'prepared';vp=root/'VERIFIED.json';rp=root/'READY.json';tp=root/'worker-terminal.json'
  if vp.exists():telemetry[seed]={'verified':ref(vp)};continue
  if not rp.exists() or not tp.exists():return {'launch':False,'state':'waiting-final-host-telemetry-'+seed}
  t=read(ref(tp))
  if t.get('status')!='failed':return {'launch':False,'state':'waiting-original-archive-verification-'+seed}
  r=read(ref(rp))
  import boto3
  response=boto3.client('s3',region_name=r['region']).get_object(Bucket=r['bucket'],Key=r['terminalKey'])
  b=response['Body'].read();need(b==tp.read_bytes(),'Retained failed terminal differs from published bytes')
  tr={'bucket':r['bucket'],'key':r['terminalKey'],'versionId':response['VersionId'],'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
  telemetry[seed]={'ready':ref(rp),'failedTerminal':tr}
 sources={**sources,'paper':config['paperSource'],'telemetry':config['telemetrySource']}
 for sr in sources.values():c.check(sr)
 value={'kind':'acephale-corrective-private-paper-input-v1','baseDraftReady':cfg['baseDraftReady'],'analyses':analyses,'sources':sources,'stage':'heldout','finalTelemetry':telemetry}
 c.check(config['renderRunner']);key=c.digest({'paperInputs':value,'renderRunner':config['renderRunner']});job=Path(config['outputRoot'])/key;ir=save(job/'INPUTS.json',value)
 argv=[str(c.OPS_PY),'-B',config['renderRunner']['path'],'--inputs',ir['path'],'--sha256',ir['sha256'],'--output',str(job/'work')]
 unit='acephale-final-private-paper-'+key[:12]
 command={'kind':'acephale-final-paper-only-command-v1','onceOnlyKey':'final-paper:'+key,'unit':unit,'argv':argv,'source':config['renderRunner'],'inputs':ir,'output':str(job/'work'),'statisticsInvoked':False,'publicPublication':False,'launchArgv':['systemd-run','--unit',unit,'--collect','--property=Restart=no','--property=RuntimeMaxSec=1800','--property=TimeoutStopSec=60','--']+argv}
 existing=(job/'INTENT.json').exists();save(job/'COMMAND.json',command);save(job/'INTENT.json',{'command':ref(job/'COMMAND.json'),'onceOnlyKey':command['onceOnlyKey'],'statisticsInvoked':False})
 return {'launch':not existing,'state':'prepared-existing-intent' if existing else 'prepared-new-intent',**command}
def main():
 p=argparse.ArgumentParser();p.add_argument('--configuration',required=True);p.add_argument('--sha256',required=True);a=p.parse_args()
 print(json.dumps(prepare(read({'path':a.configuration,'sha256':a.sha256}))))
if __name__=='__main__':main()
