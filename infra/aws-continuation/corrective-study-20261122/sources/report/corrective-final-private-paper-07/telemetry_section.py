"""Copy final host-telemetry proof status; never change native rows or statistics."""
from pathlib import Path
import hashlib,json
EXPECTED={'17':{'development/2','heldout/1'},'29':{'development/1','heldout/2'}}
def need(v,m):
 if not v:raise ValueError(m)
def read(r):
 p=Path(r['path']);b=p.read_bytes()
 need(p.is_absolute() and hashlib.sha256(b).hexdigest()==r['sha256'],'Pinned local proof changed')
 return json.loads(b)
def remote(r):
 import subprocess
 need(all(r.get(k) for k in ('bucket','key','versionId','sha256')),'Versioned archived proof required')
 # Use the existing AWS administrative interpreter; the pinned PDF environment
 # intentionally does not install boto3 or change dependency versions.
 script="import boto3,hashlib,json,sys; r=json.load(sys.stdin); v=boto3.client('s3',region_name='us-east-1').get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId']); b=v['Body'].read(); assert hashlib.sha256(b).hexdigest()==r['sha256'] and len(b)==r['bytes']; print(json.dumps(json.loads(b),ensure_ascii=True))"
 result=subprocess.run(['/REQUIRED_BINDINGS/research-root/ops-venv/bin/python','-B','-c',script],input=json.dumps(r),capture_output=True,text=True,timeout=45)
 need(result.returncode==0,'Versioned archived proof fetch failed: '+result.stderr)
 return json.loads(result.stdout)
def completed_proof(v,t,r,host):
 need(v['kind']=='acephale-native-telemetry-closure-verified-v1' and v['state']=='completed','Completed original verification required')
 need(v['artifactExportVerified'] is True and t['status']=='completed','Completed actual export required')
 need(t['envelope']==r['envelope'] and t['instanceId']==r['instanceId'] and t['operationId']==r['operationId'],'Terminal lineage differs')
 need(v['archive']==t['archive'] and v['archiveReceipt']==t['archiveReceipt'],'Archived provenance differs')
 original=v['originalVerification']
 need(original['localExportVerified'] is True and original['verificationScope']=='whole_archive_and_each_retained_file' and original['archiveSha256']==v['archive']['sha256'],'Original whole archive verification missing')
 need(original['instanceId']==host['instanceId'] and original['leaseId']==host['resourceAttemptId'],'Verified archive host differs')
 need(v['telemetryRequirementsSatisfied'] is not True or original['selectedTraceCount']>0,'Trace completeness contradicts selected count')
 return {'requirementsSatisfied':v['telemetryRequirementsSatisfied'] is True,'selectedTraceCount':original['selectedTraceCount'],'actualNativeTraceEvidenceCount':original['actualNativeTraceEvidenceCount'],'originalVerification':original,'archive':v['archive'],'archiveReceipt':v['archiveReceipt']}
def build(host_inputs,analyses):
 need(set(host_inputs)=={'17','29'} and set(analyses)=={'development','heldout'},'Both final hosts and original 36/96 analyses required')
 closed={};reports={}
 for stage,count in [('development',36),('heldout',96)]:
  ar=read(analyses[stage]);report=read(ar['nativeReport'])
  need(report['stage']==stage and report['declaredSlots']==count,'Original complete stage analysis required')
  need(ar['originalStatisticalEstimatorsUnchanged'] is True,'Original statistics required')
  inp=read(ar['input']);owner=read(inp['ownerCollection'])
  for cr in owner['sourceClosedSegments']:
   c=read(cr);need(c['closed'] is True and c['drained'] is True and c['allDeclaredSlotsRetained'] is True,'Actual closed segment required')
   need(not read(c['originalSummary']).get('startupFailure'),'Global startup failure is not completed evaluation')
   semantic=c['originalSemanticUnit'];need(semantic not in closed,'Duplicate original segment')
   closed[semantic]=(cr,c)
  reports[stage]=ar['nativeReport']
 need(set(closed)==set().union(*EXPECTED.values()),'All four original corrected segments required')
 rows={}
 for seed in ('17','29'):
  supplied=host_inputs[seed]
  if 'verified' in supplied:
   v=read(supplied['verified']);rr=v['ready'];r=read(rr);tr=v['terminal'];t=remote(tr)
  else:
   need(set(supplied)=={'ready','failedTerminal'},'Explicit final failed proof required')
   rr=supplied['ready'];r=read(rr);tr=supplied['failedTerminal'];t=remote(tr);v=None
   need(t['status']=='failed' and t['envelope']==r['envelope'] and t['instanceId']==r['instanceId'] and t['operationId']==r['operationId'],'Exact final failure required')
  cfg=read(r['configuration']);binding=read(cfg['hostBinding'])
  need(binding['instanceId']==r['instanceId'] and set(binding['expectedSemanticUnits'])==EXPECTED[seed],'Original host identity differs')
  refs=cfg['lateManagedObservation']['closedResults']
  need({x['sha256'] for x in refs}=={closed[k][0]['sha256'] for k in EXPECTED[seed]},'Telemetry and statistical cohorts differ')
  for semantic in EXPECTED[seed]:
   c=closed[semantic][1]
   need(c['instanceId']==binding['instanceId'] and c['resourceAttemptId']==binding['resourceAttemptId'],'Statistical cohort host differs')
  row={'ready':rr,'terminal':tr,'hostBinding':cfg['hostBinding'],'originalClosedResults':refs,'scientificAcceptanceAsserted':False}
  if v is None:
   row.update(state='failed',requirementsSatisfied=False,failure=t.get('failure'),retainedFailureTerminal=t)
  else:
   proof=completed_proof(v,t,r,binding)
   managed=remote(t['managedObservation'])
   need(managed['kind']=='acephale-late-managed-serving-observation-v1' and managed['instanceId']==binding['instanceId'] and managed['leaseId']==binding['resourceAttemptId'] and managed['readOnlyHostObservation'] is True and managed['modelCalls'] is False,'Actual late managed observation required')
   row.update(state='completed',verified=supplied['verified'],managedObservation=t['managedObservation'],queryConfiguration=t['queryConfiguration'],observedAt=managed['observedAt'],**proof)
  rows[seed]=row
 passed=all(row['requirementsSatisfied'] for row in rows.values())
 phrases=[]
 for seed,row in rows.items():
  if row['state']=='failed':
   phrases.append('Predictor-seed '+seed+' host telemetry closure failed; its exact failure and retained partial evidence remain in the companion provenance.')
  elif row['requirementsSatisfied']:
   phrases.append('Predictor-seed '+seed+' host telemetry archive passed the original archive/member verification and selected-trace coverage checks ('+str(row['selectedTraceCount'])+' selected traces; '+str(row['actualNativeTraceEvidenceCount'])+' recorded native trace evidence items).')
  else:
   phrases.append('Predictor-seed '+seed+' host archive export was verified, but selected-trace coverage did not satisfy the original telemetry requirement.')
 paragraph=' '.join(phrases)+' These late read-only observations follow both original cohorts on each host. They do not change recorded measuredTimingValid flags, native outcomes, latency inclusion, or the original statistical results. Recorded hosted usage remains distinct from invoice reconciliation. Telemetry verification alone does not establish benchmark validity or speculative efficacy.'
 return {'kind':'acephale-final-private-paper-telemetry-evidence-v1','hosts':rows,'telemetryRequirementsSatisfied':passed,'originalReports':reports,'statisticsRecomputed':False,'nativeTimingFlagsChanged':False,'studyComplete':False,'paragraph':paragraph}
