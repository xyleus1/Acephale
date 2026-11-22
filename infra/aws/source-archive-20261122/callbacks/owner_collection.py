"""Invoke the original owner collector for an explicit six-block terminal mapping."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
def need(x,m):
 if not x:raise ValueError(m)
def raw(v):return(json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def ref(p):
 p=Path(p);b=p.read_bytes();return{'path':str(p),'sha256':sha(b),'bytes':len(b)}
def checked(r):
 p=Path(r['path']);b=p.read_bytes();need(sha(b)==r['sha256'],'Immutable collector input changed');return json.loads(b)
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);b=raw(v)
 if p.exists():need(p.read_bytes()==b,'Immutable collection input collision')
 else:
  with p.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 return ref(p)
def prepare(config,active):
 original=checked(config['originalRegistry']);checked(config['collectorManifest'])
 need(type(config['seed'])is int and config['seed']in(17,29),'Original cohort seed')
 source=checked(original['originalPartitions']);segment='development-2'if config['seed']==17 else'development-1';blocks=source[segment]['blocks']
 need([b['blockIndex']for b in active['blocks']]==[b['blockIndex']for b in blocks],'Every original block once, in order')
 selected=[];mapping=[]
 for base,chosen,block in zip(original['blocks'],active['blocks'],blocks,strict=True):
  need(base['blockIndex']==chosen['blockIndex']==block['blockIndex'],'Original block index')
  need(chosen['originalRunIds']==block['runIds'],'Original ordered run identities')
  need(chosen['allChildrenDrained']is True,'Terminal process drain required')
  ir=chosen['indexRef'];need(all(ir.get(k)for k in('bucket','key','versionId','sha256')),'Exact immutable terminal index')
  need(chosen['resourceAttemptId']==base['resourceAttemptId'],'Owner must explicitly rebind any resource transfer')
  need(isinstance(chosen['runRoot'],str)and chosen['runRoot'].startswith('/srv/acephale/'),'Actual generation run root')
  row=dict(base,runRoot=chosen['runRoot'],indexRef=ir);selected.append(row);mapping.append({'blockIndex':block['blockIndex'],'indexRef':ir})
 identity=sha(raw({'configuration':config,'active':active}));out=Path(config['preparedRoot'])/identity
 registry=save(out/'REGISTRY.json',dict(original,blocks=selected,originalRegistryLineage=config['originalRegistry']))
 active_ref=save(out/'ACTIVE-GENERATIONS.json',{'kind':'root-owner-selected-closed-cohort-generations-v1','seed':config['seed'],'blocks':mapping,'ownerLineage':active['ownerLineage'],'scientificAcceptanceAsserted':False})
 inputs=save(out/'INPUTS.json',{'configuration':config,'registry':registry,'activeGenerationManifest':active_ref,'originalRunIds':[r for b in blocks for r in b['runIds']]})
 output=out/'result'
 argv=[config['python'],'-B',str(Path(__file__).resolve()),'--inputs',inputs['path'],'--sha256',inputs['sha256'],'--output',str(output)]
 return {'operationId':'collect-'+str(config['seed'])+'-'+identity,'argv':argv,'cwd':str(out),'environment':{},'timeoutSeconds':600,'outputRoot':str(output),'inputPreconditions':[inputs,registry,active_ref,config['collectorSource'],config['collectorManifest'],config['originalRegistry']],'requiresExistingControllerLockAndExclusiveIntent':True,'automaticRetry':False,'workerCommands':False,'ledgerWrites':False,'validationStatus':'unvalidated'}
def execute(inputs,expected,output):
 p=Path(inputs);need(sha(p.read_bytes())==expected,'Exact collection input');v=json.loads(p.read_text());c=v['configuration'];out=Path(output);out.mkdir(parents=True,exist_ok=False)
 need(ref(c['collectorSource']['path'])['sha256']==c['collectorSource']['sha256'],'Original collector source')
 checked(c['collectorManifest']);checked(v['registry'])
 command=[c['python'],'-B',c['collectorSource']['path'],'--registry',v['registry']['path']]
 # Original producer writes its own immutable snapshot. No outcome is reconstructed here.
 with(out/'collector.stdout').open('xb')as so,(out/'collector.stderr').open('xb')as se:
  result=subprocess.run(command,cwd=str(Path(c['collectorSource']['path']).parent),stdout=so,stderr=se,timeout=550)
 need(result.returncode==0,'Original collector failed; retain stdout/stderr and do not rerun')
 lines=[json.loads(x)for x in(out/'collector.stdout').read_text().splitlines()if x.startswith('{')]
 need(lines and 'report'in lines[-1],'Original collector did not return an actual report')
 report_ref=lines[-1]['report'];report=checked(report_ref)
 need(report['observedRunCount']==len(v['originalRunIds'])and report['missingRunIds']==[],'No partial cohort can advance selection')
 directory=Path(report_ref['path']).parent
 rows=[json.loads(x)for x in(directory/'outcomes.jsonl').read_text().splitlines()if x.strip()]
 need([r['runId']for r in rows]==v['originalRunIds'],'Original collector returned changed order/IDs')
 provenance=json.loads((directory/'raw-provenance.json').read_text());selected=checked(v['activeGenerationManifest'])['blocks']
 need([(x['blockIndex'],x['indexRef'])for x in provenance]==[(x['blockIndex'],x['indexRef'])for x in selected],'Collector snapshot differs from explicit owner generations')
 save(out/'COLLECTION.json',{'kind':'root-original-owner-collector-completed-v1','seed':c['seed'],'receipt':report_ref,'activeGenerationManifest':v['activeGenerationManifest'],'collectorSource':c['collectorSource'],'inputs':ref(p),'originalRunCount':len(rows),'allOriginalSlotsRetained':True,'scientificAcceptanceAsserted':False,'selectionPerformed':False})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args();execute(a.inputs,a.sha256,a.output)
