"""Read-only direct-result reporting. Never accepts a scientific unit or opens a live ledger."""
from pathlib import Path
import argparse, ast, collections, hashlib, importlib.util, json, os, re

HERE=Path(__file__).resolve().parent
CANONICAL={'path':'/REQUIRED_BINDINGS/02-disposition_02.py','sha256':'19a098e98e999fe804d7f455a43739c19d9a5a7dde01187c57048c62c5f8bd56'}
RENDERER={'path':'/REQUIRED_BINDINGS/01-render_public_summary.py','sha256':'d38524e5239530580d52972857ed114ba128038c491a04759a0cb14d6660429d'}
DEV_SHA='f6f39258eea0e0251095380a34971d9a31918324e1eef91b7502493921886be9'
TARGET_SHA='fae4aa952715445caeca51f4207080661b730c67426a0757e53ae9dc3f8ccd29'
SELECTOR_SHA='a7b71e945796bb88ab3cfbdaa94943216f4dc7e538c875fa867c186fe4421673'
RAW20_SHA='8a3ba44c99e2a1c1c13238949b8b2a512abe5fc6b9ca8155b9405ad773acfae7'
IDENTITY=('runId','pairedBlockId','domain','taskId','familyId','trial','seed','predictorTrainingSeed','arm','armOrder','maxBoundaries')
MAX_BYTES=64*1024*1024

def need(v,m):
    if not v: raise ValueError(m)
def sha(b): return hashlib.sha256(b).hexdigest()
def raw(v): return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def parse(b):
    def bad(v): raise ValueError('Nonfinite JSON number: '+v)
    return json.loads(b,parse_constant=bad)
def ref(p):
    p=Path(p);b=p.read_bytes()
    return {'path':str(p),'sha256':sha(b),'bytes':len(b)}

class Inputs:
    def __init__(self): self.files={};self.provenance=[]
    def read(self,r,retain=True):
        need(isinstance(r,dict) and re.fullmatch('[0-9a-f]{64}',r.get('sha256','')),'Exact SHA-256 FileRef required')
        if 'path' in r:
            p=Path(r['path'])
            need(p.is_absolute() and '..' not in p.parts and not any(q.is_symlink()for q in (p,*p.parents)) and p.is_file(),'Regular absolute immutable input required')
            need(p.name not in ('budget.jsonl','budget.jsonl.lock') and not str(p).startswith('/REQUIRED_BINDINGS/03-shared'),'Live ledger paths are not reporting inputs')
            need(p.stat().st_size<=MAX_BYTES,'Input too large')
            b=p.read_bytes()
        else:
            need(all(r.get(k)for k in ('bucket','key','versionId')) and r['versionId']!='null','Exact S3 object version required')
            need(not r['key'].endswith(('/budget.jsonl','/budget.jsonl.lock')),'Live journal is not a report')
            import boto3
            response=boto3.client('s3').get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])
            need(response['ContentLength']<=MAX_BYTES,'Input too large')
            b=response['Body'].read(MAX_BYTES+1)
            need(response.get('VersionId')==r['versionId'],'S3 version differs')
        need(len(b)<=MAX_BYTES and sha(b)==r['sha256'],'Input bytes differ from pinned SHA')
        if 'bytes'in r: need(len(b)==r['bytes'],'Input byte count differs')
        if retain:
            self.files.setdefault('evidence/'+r['sha256']+'.bin',b)
            if r not in self.provenance:self.provenance.append(r)
        return b
    def json(self,r):return parse(self.read(r))
    def jsonl(self,r):return [parse(line)for line in self.read(r).splitlines()if line.strip()]

def canonical(configuration,inputs):
    source=inputs.read(CANONICAL)
    spec=importlib.util.spec_from_file_location('original_incomplete_disposition',CANONICAL['path'])
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    files,sidecar=module.build(inputs.json(configuration))
    need(sidecar['studyComplete'] is False and len(sidecar['units'])==12,'Original incomplete disposition required')
    need(all(sidecar['units'][u]['state']=='accepted'for u in ('export','seed17/replay','seed17/analysis')),'Three original accepted components must remain accepted')
    return files,sidecar

def original_table(inputs):
    source=inputs.read(RENDERER).decode()
    functions=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)and n.name=='table']
    need(len(functions)==1,'Exact original table formatter required')
    # Only the original pure formatter is loaded; completed-study verifier/prose are not called.
    namespace={};exec(compile(ast.Module(body=functions,type_ignores=[]),RENDERER['path'],'exec'),namespace)
    return namespace['table']

def declared(r,expected_sha,count,seeds,inputs):
    need(r['sha256']==expected_sha,'Frozen current-study segment receipt required')
    value=inputs.json(r)
    need(value['kind']=='acephale-native-paired-serving-segments-v1' and value['declaredRuns']==count,'Original declared size differs')
    need([s['predictorTrainingSeed']for s in value['segments']]==seeds,'Original serving-group order differs')
    rows=[row for segment in value['segments']for row in segment['runs']]
    ids=[row['runId']for row in rows]
    need(len(ids)==len(set(ids))==count and ids==value['executionRunIds'],'Original execution IDs differ')
    need(set(ids)==set(value['originalRunIds']) and len(value['originalRunIds'])==count,'Original full ID set differs')
    return value,{r['runId']:r for r in rows}

def selected(value,target,lookup,inputs):
    if value is None:return None,{},'not-produced'
    need(set(value)=={'selection','segments','schedule','producerSource'},'Exact selector artifact group required')
    need(value['producerSource']['sha256']==SELECTOR_SHA,'Original selector source required')
    inputs.read(value['producerSource'])
    selection=inputs.json(value['selection']);segments=inputs.json(value['segments']);schedule=inputs.json(value['schedule'])
    need(selection['kind']=='acephale-development-only-heldout-selection-v1','Original selector receipt required')
    need(selection['developmentOnly']is True and selection['heldoutOutcomesRead']is False and selection['newTrialIdentitiesGenerated']is False and selection['withinBlockArmOrderChanged']is False,'Selection protocol differs')
    ids=selection['selectedRunIds'];need(isinstance(ids,list)and len(ids)==len(set(ids))and set(ids)<=set(lookup),'Selected IDs outside frozen target or duplicated')
    need(selection['developmentSlots']==36 and selection['dispatchEligibleSize']is bool(ids),'Recorded selection size differs')
    need(ids==[x for x in target['originalRunIds']if x in set(ids)],'Selected original order differs')
    need(schedule==[lookup[x]for x in ids],'Selected schedule identities differ')
    families={lookup[x]['familyId']for x in ids}
    need(all({r['runId']for r in lookup.values()if r['familyId']==f}<=set(ids)for f in families),'Partial selected family is not original selection')
    expected=[{'number':i+1,'predictorTrainingSeed':s['predictorTrainingSeed'],'runs':[r for r in s['runs']if r['runId']in set(ids)]}for i,s in enumerate(target['segments'])] if ids else []
    need(segments['segments']==expected and segments['originalRunIds']==ids and segments['declaredRuns']==len(ids)and segments['pairedBlocks']==len(ids)//3,'Selected segment order/count differs')
    need(segments['executionRunIds']==[r['runId']for s in expected for r in s['runs']],'Selected execution order differs')
    need(segments['originalScheduleSha256']==value['schedule']['sha256'] and selection['segmentsReceiptHash']==segments['contentHash'] and selection['scheduleHash']==segments['originalScheduleHash'],'Selected artifact hash linkage differs')
    omitted=[x for x in target['originalRunIds']if x not in set(ids)]
    need(selection['omittedTargetRunIds']==omitted and segments['targetOmittedRunIds']==omitted,'Omitted target IDs differ')
    return {'selection':selection,'segments':segments,'schedule':schedule,'sourceRefs':value},{x:lookup[x]for x in ids},'zero-selected-terminal'if not ids else'selected'

def build(value):
    need(value.get('kind')=='acephale-direct-unvalidated-report-inputs-v1','Exact reporting input kind required')
    need(value.get('studyComplete')is False and value.get('scientificAcceptanceAsserted')is False,'Completion/acceptance assertions are unsupported')
    required={'kind','studyComplete','scientificAcceptanceAsserted','canonicalConfiguration','developmentSegments','heldoutTargetSegments','collections','selection','financialReport','financialMissingReason','reports','raw20Evidence'}
    optional={'ownerResultCollection','financialAsOfEvidence','financialReportMissingReason'}
    value=dict(value)
    if 'financialReportMissingReason' in value:
        need(isinstance(value['financialReportMissingReason'],str) and bool(value['financialReportMissingReason'].strip()),'Financial missing-reason alias must be explicit text')
        if 'financialMissingReason' not in value:value['financialMissingReason']=value['financialReportMissingReason']
    need(required<=set(value) and set(value)<=required|optional,'Unexpected or missing reporting inputs')
    inputs=Inputs()
    owner_collection=inputs.json(value['ownerResultCollection']) if value.get('ownerResultCollection') else None
    if owner_collection is not None:
        need(owner_collection.get('kind')=='root-complete-original-heldout-export-collection-v1' and owner_collection.get('scientificAcceptanceAsserted') is False and owner_collection.get('studyComplete') is False,'Exact unvalidated owner collection required')
        heldout_collections=[c for c in value['collections']if c.get('stage')=='heldout']
        need(len(heldout_collections)==1 and heldout_collections[0]['outcomes']['sha256']==owner_collection['outcomes']['sha256'],'Owner collection must bind the reported heldout rows')
    if value.get('financialAsOfEvidence'):inputs.read(value['financialAsOfEvidence'])
    accepted_files,sidecar=canonical(value['canonicalConfiguration'],inputs)
    dev,dev_lookup=declared(value['developmentSegments'],DEV_SHA,36,[29,17],inputs)
    target,target_lookup=declared(value['heldoutTargetSegments'],TARGET_SHA,96,[17,29],inputs)
    selection,held_lookup,selection_status=selected(value['selection'],target,target_lookup,inputs)
    need(value['raw20Evidence']['sha256']==RAW20_SHA,'Retained final raw20 evidence required')
    raw20=inputs.json(value['raw20Evidence'])
    need(raw20['actualCompletedRows']==7 and raw20['actualMeasuredFailedRows']==12 and raw20['censoredOriginalRows']==[2]and raw20['minimumCompletedRequired']==10 and raw20['canonicalAcceptanceChanged']is False,'Original failed raw20 disposition differs')
    observed={'development':{},'heldout':{}};collections_out=[]
    for col in value['collections']:
        need(set(col)=={'stage','outcomes','provenance','receipts','ownerDisposition','predecessors','costs'},'Exact owner collection fields required')
        stage=col['stage'];need(stage in observed,'Unknown native stage')
        lookup=dev_lookup if stage=='development'else held_lookup
        need(stage!='heldout'or selection is not None,'Heldout outcomes require actual original selection')
        rows=inputs.jsonl(col['outcomes']);ids=[]
        for row in rows:
            rid=row.get('runId');need(rid in lookup and rid not in observed[stage],'Unknown or duplicate active original run ID')
            need(all(row.get(k)==lookup[rid][k]for k in IDENTITY),'Original native slot assignment changed')
            observed[stage][rid]={'outcome':row,'source':col['outcomes'],'sourceLine':len(ids)+1}
            ids.append(rid)
        provenance=inputs.json(col['provenance']);receipts=inputs.json(col['receipts'])
        need(isinstance(receipts,list),'Owner receipt-inputs list required')
        for r in receipts:inputs.json(r)
        owner=inputs.json(col['ownerDisposition'])if col['ownerDisposition']else None
        predecessors=[{'source':r,'copiedFile':'evidence/'+r['sha256']+'.bin'}for r in col['predecessors']]
        for r in col['predecessors']:inputs.read(r)
        costs=[{'source':r,'recordedValues':inputs.json(r)}for r in col['costs']]
        collections_out.append({'stage':stage,'sourceOrderRunIds':ids,'sources':col,'ownerDisposition':owner,'costs':costs,'predecessors':predecessors,'receiptCount':len(receipts),'rawProvenanceCopied':True})
    if selection is not None: need(set(observed['development'])==set(dev_lookup),'Selection requires all original development IDs represented')
    slots={}
    for stage,design,lookup in [('development',dev,dev_lookup),('heldout',selection['segments']if selection else None,held_lookup)]:
        if design is None:slots[stage]=None;continue
        execution={rid:i for i,rid in enumerate(design['executionRunIds'])}
        slots[stage]=[{'runId':rid,'originalOrdinal':i,'executionOrdinal':execution[rid],'originalAssignment':lookup[rid],
            'presence':'recorded'if rid in observed[stage]else'missing',
            'preSlotAbort':observed[stage].get(rid,{}).get('outcome',{}).get('termination')=='stage_aborted_before_slot',
            'record':observed[stage].get(rid)}for i,rid in enumerate(design['originalRunIds'])]
    finance=inputs.json(value['financialReport'])if value['financialReport']else None
    need(finance is not None or isinstance(value['financialMissingReason'],str)and bool(value['financialMissingReason'].strip()),'Missing financial snapshot needs explicit reason')
    reports=[]
    for r in value['reports']:
        need(set(r)=={'unitId','label','artifact','producerSource'}and r['unitId']in sidecar['units'],'Exact original computed report binding required')
        inputs.read(r['producerSource']);body=inputs.read(r['artifact'])
        reports.append({**r,'recordedValues':parse(body),'copiedFile':'evidence/'+r['artifact']['sha256']+'.bin','statisticsRecomputed':False})
    missing={stage:None if rows is None else[r['runId']for r in rows if r['presence']=='missing']for stage,rows in slots.items()}
    pre_slot={stage:None if rows is None else[r['runId']for r in rows if r['preSlotAbort']]for stage,rows in slots.items()}
    result={'kind':'acephale-direct-unvalidated-report-v1','validationStatus':'unvalidated','scientificAcceptanceAsserted':False,
        'studyComplete':False,'reportStatus':'incomplete-direct-unvalidated','reportPrepared':True,'completionMarkerProduced':False,
        'authorizesControllerTermination':False,'canonicalDisposition':sidecar,'acceptedValuesCopied':True,
        'canonicalConfiguration':value['canonicalConfiguration'],'developmentDesign':dev,'heldoutTargetDesign':target,
        'heldoutSelectionStatus':selection_status,'selectedHeldout':selection,'originalSlots':slots,'collections':collections_out,
        'completeness':{'developmentExpectedRuns':36,'developmentRepresentedIds':len(observed['development']),
            'heldoutTargetRuns':96,'heldoutTargetFamilies':len({r['familyId']for r in target_lookup.values()}),
            'selectedHeldoutRuns':None if selection is None else len(held_lookup),
            'heldoutRepresentedIds':len(observed['heldout']),'missingOriginalRunIds':missing,'preSlotAbortRunIds':pre_slot,
            'financialSnapshotAvailable':finance is not None,'selectionAvailable':selection is not None},
        'raw20Disposition':raw20,'raw20MinimumGatePassed':False,
        'financialAccounting':{'source':value['financialReport'],'recordedValues':finance,'missingReason':value['financialMissingReason']if finance is None else None,
            'liveLedgerOpened':False,'fundingApprovalAsserted':False,'unknownCostsReplacedWithZero':False},
        'originalComputedReports':reports,'statisticsRecomputed':False,'modelsCalled':False,'claimsMutated':False,
        'limitations':['Direct execution and parallel block/cache amendments do not establish frozen-protocol acceptance or comparable timing.',
          'Recorded row presence and success flags are not independently verified task rewards. Pre-slot aborts remain distinct from measured failures.',
          'Invalid/unobserved timing, censoring, unknown charges, and predecessor records remain unchanged; no pooled latency or new estimate is produced.',
          'Original target declares eight families and 96 arm-runs; actual selected IDs come only from the supplied original selector artifacts.',
          'Predictor seed is confounded with weight-group time and preassigned variant/trial seed; no causal seed comparison.',
          'The original complete-study assembler/verifier and hardcoded qualification narrative are not invoked by this wrapper.'],
        'inputProvenance':inputs.provenance}
    # Optional provenance is retained without presenting an as-of snapshot as a final report.
    for key in ('ownerResultCollection','financialAsOfEvidence','financialReportMissingReason'):
        if key in value:result[key]=value[key]
    if 'financialAsOfEvidence' in value:
        result['financialAccounting']['asOfEvidence']=value['financialAsOfEvidence']
        result['financialAccounting']['asOfEvidenceIsFinalFinancialReport']=False
    table=original_table(inputs)
    lines=['# Direct-result report: UNVALIDATED and incomplete','',
        '**studyComplete=false; scientificAcceptanceAsserted=false.** Canonical accepted results remain separate. This is a reporting artifact, not a scheduling, financial or acceptance authority.','',
        '## Original twelve-unit disposition']
    table(lines,['Unit','Canonical disposition','Reason'],[[u,r['state'],r['reason']]for u,r in sidecar['units'].items()])
    lines+=['','## Direct native evidence coverage']
    table(lines,['Stage','Original target rows','Selected rows','Recorded IDs','Missing IDs'],[
        ['Development',36,36,len(observed['development']),len(missing['development'])],
        ['Heldout',96,'not selected yet'if selection is None else len(held_lookup),len(observed['heldout']),'unknown until selection'if selection is None else len(missing['heldout'])]])
    lines+=['','Selection status: '+selection_status+'. An absent selection is not a zero-selected result.',
        'The raw20 profile retains 7 completed, 12 measured read-miss failures and 1 censored interruption. The original minimum of 10 failed. Read misses are not task-failure labels.','']
    for stage,rows in slots.items():
        lines+=['## '+stage+' original slots','']
        if rows is None:lines+=['No actual heldout selection artifact supplied. Target IDs are retained in report.json; no selected outcomes are invented.',''];continue
        table(lines,['Original ordinal','Execution ordinal','Run ID','Evidence state','Recorded termination','Timing validity','Unknown provider charge'],[
            [r['originalOrdinal'],r['executionOrdinal'],r['runId'],'pre-slot abort'if r['preSlotAbort']else r['presence'],
             (r['record']or{}).get('outcome',{}).get('termination','not recorded'),
             (r['record']or{}).get('outcome',{}).get('measuredTimingValid','unobserved'),
             (r['record']or{}).get('outcome',{}).get('unknownProviderCharge','unknown')]for r in rows])
    lines+=['','## Original computed reports','']
    for r in reports:lines.append('- '+r['unitId']+' / '+r['label']+': ['+r['artifact']['sha256']+']('+r['copiedFile']+'); original values copied, no recalculation.')
    lines+=['','## Financial snapshot','', 'Owner-produced immutable report copied without opening the ledger.'if finance is not None else 'Missing: '+value['financialMissingReason'],
        'Unknown costs and unresolved reservations remain as recorded. Configuration is not API-funding approval.','','## Limitations','']
    lines+=['- '+x for x in result['limitations']]
    files={**{'canonical/'+n:b for n,b in accepted_files.items()},**inputs.files,'report.json':raw(result),'report.md':('\n'.join(lines)+'\n').encode()}
    return files,result

def main():
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    source={'path':a.inputs,'sha256':a.sha256};v=Inputs().json(source)
    files,result=build(v);out=Path(a.output)
    need(out.is_absolute()and'..'not in out.parts and not out.exists()and not any(x.is_symlink()for x in out.parents),'New isolated absolute output required')
    out.mkdir(parents=True)
    for name,body in files.items():
        dest=out/name;dest.parent.mkdir(parents=True,exist_ok=True)
        with dest.open('xb')as f:f.write(body);f.flush();os.fsync(f.fileno())
    binding={'kind':'acephale-direct-report-output-binding-v1','source':ref(__file__),'inputs':source,'files':[ref(out/n)for n in sorted(files)],
        'validationStatus':'unvalidated','studyComplete':False,'scientificAcceptanceAsserted':False}
    ready=out/'READY';ready.mkdir()
    with (ready/'result.json').open('xb')as f:f.write(raw({**binding,'report':ref(out/'report.json'),'completeness':result['completeness'],'heldoutSelectionStatus':result['heldoutSelectionStatus']}));f.flush();os.fsync(f.fileno())
    for path in (ready,out,out.parent):
        fd=os.open(path,os.O_RDONLY);os.fsync(fd);os.close(fd)
    print(json.dumps({'result':ref(ready/'result.json'),'validationStatus':'unvalidated','studyComplete':False,'scientificAcceptanceAsserted':False}))
if __name__=='__main__':main()
