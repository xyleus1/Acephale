"""Explicit consumption of closed calibration bytes under a separately qualified AWS owner.
No historical numerical equivalence, replay, grading, calibration fitting, or claim write.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,math,os,re,signal,sys,time

SCIENCE="5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
RAW=Path("/srv/acephale/migration/raw")
SOURCE_REFS={'pathProjection': {'path': '/srv/acephale/workspaces/review/scientific-closure-02/path_projection.py', 'sha256': '20dba410747597ba49f46effb268b460de529cd1f48c8e439d4e8d16a4069cbf'}, 'originalSources': {'path': '/srv/acephale/workspaces/review/scientific-closure-02/original-sources.json', 'sha256': '406bd34757eb470a1ccd56ce0a4bd5681b079c53d8786d0fd878095b86659c80'}, 'executionContract': {'path': '/srv/acephale/workspaces/operator/cloud-replay-02/aws_execution_contract.py', 'sha256': 'a862dc659bf48ef0e337790630b99b7592444f26dce1c83da0255fe910c53328'}, 'provider': {'path': '/srv/acephale/workspaces/operator/cloud-replay-02/aws_replay_provider.py', 'sha256': '843ed8e4e12311befe442da4f72c2a4666e48659fc1f78aff573178884c4a313'}, 'servingProbe': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/serving_probe_aws.py', 'sha256': 'f9cced978506b2e170cc9f7ad0839bc4c6c353e4d32dbf5c2ca7b4a20a430008'}, 'rawProbe': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/host_probe_aws.py', 'sha256': '25b6c53dfdd6c9c23ba403bbe5f5aefe935bc6b5193ad182bb845248b9958049'}, 'closure': {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/closure03/closure_adapter.py', 'sha256': '1c7563b90c507b38815b19b64938cd6389555c1be55a0728cbd4c9affa22d0be'}, 'observationHelper': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/replay_evidence_02.py', 'sha256': 'ac7d42724d8e80bb6182bee30c154aa6f55e47bf3789b60c9daf8e2b8e6352c7'}, 'originalAdoption': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_adoption.py', 'sha256': 'c0bd0439cc24c94d12b251c417ba89a784e63aa428f5a345de8f79a421db43c3'}}
IMPORTED={'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-continuation-47/seed17-cpu-recovery-06/owner/projection-recovery-01/component.json', 'sha256': '647f23466bed49876e0901dda865c121e62e13916d83a3792ddbeccbfd7e511f'}
IMPORTED_REPLAY={'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-continuation-47/closed-e47-components-01/components/seed17-replay.json', 'sha256': 'a7a0dd7e1027390823631fb50d1043865a7b42f46060101e3c4e57390a9e0639'}
MAXIMUM_SECONDS=300

def need(value,message):
    if not value:raise ValueError(message)
def finite(v):return type(v) in (int,float) and math.isfinite(v)
def sha(path):
    with Path(path).open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def ref(path):return {"path":str(Path(path)),"sha256":sha(path)}
def checked(r):
    need(type(r) is dict and set(r)=={"path","sha256"} and type(r["path"]) is str and re.fullmatch("[a-f0-9]{64}",r["sha256"]) is not None,"exact FileRef")
    p=Path(r["path"])
    need(p.is_absolute() and p.is_file() and not any(q.is_symlink() for q in (p,*p.parents)) and sha(p)==r["sha256"],"unchanged absolute regular file")
    return p
def read(r):return json.loads(checked(r).read_text())
def write(path,value):
    p=Path(path);need(p.is_absolute() and not p.exists() and not any(q.is_symlink() for q in (p,*p.parents)),"new regular output")
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("x") as f:json.dump(value,f,indent=2,allow_nan=False);f.write("\n");f.flush();os.fsync(f.fileno())
    return ref(p)
def load(name,r):
    path=checked(r);prior=sys.modules.get(name)
    if prior is not None:need(Path(prior.__file__)==path and ref(path)==r,"no foreign module origin");return prior
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:sys.modules.pop(name,None);raise
    checked(r);return module
def source_check():
    for r in SOURCE_REFS.values():checked(r)
def mapped(r):
    need(type(r) is dict and set(r)=={"path","sha256"} and re.match(r"^C:[/\\]Users[/\\]apexs[/\\]",r["path"]) is not None,"exact retained Windows path")
    path=RAW/r["path"].replace(":","").replace("\\","/")
    need(".." not in path.parts and path.is_relative_to(RAW),"retained raw path mapping")
    result={"path":str(path),"sha256":r["sha256"]};checked(result);return result
def snapshot(r,expected,closure):
    p=checked(r);stat=p.stat()
    need(stat.st_uid==0 and stat.st_mode&0o022==0,"root-owned immutable claim observation")
    v=read(r)
    need(v.get("kind")=="acephale-aws-observed-dependency-claim-v1" and v.get("table")=="acephale-aws-20261121"
      and v.get("region")=="us-east-1" and v.get("consistentRead") is True and finite(v.get("observedAt")) and v["observedAt"]>0,"actual strong dependency observation")
    raw=v["rawItem"]
    need(type(raw) is dict and hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()==v.get("rawItemSha256"),"observed raw claim bytes")
    row={k:closure.decode_claim_attribute(x) for k,x in raw.items()}
    need(row==v.get("item") and row.get("pk")=="unit#"+expected and row.get("status")=="succeeded"
      and row.get("permanent") is True and row.get("sourceCommit")==SCIENCE,"same permanent succeeded scientific dependency")
    need(type(row.get("attemptId")) is str and re.fullmatch("[A-Za-z0-9_-]{8,128}",row["attemptId"]),"exact permanent attempt")
    return row
def qualified_target(row,attempt):
    need(type(row) is dict and set(row)=={"path","key","sha256","versionId","bytes"},"exact versioned qualified artifact")
    path=Path(row["path"])
    need(path.is_absolute() and ".." not in path.parts and (path.is_relative_to(Path("/srv/acephale/attempts")/attempt)
      or path.is_relative_to(Path("/srv/acephale/runs")/attempt)),"exact historical attempt output roots")
    need(row["versionId"] not in (None,"","null") and type(row["bytes"]) is int and 0<=row["bytes"]<=16*1024**3
      and re.fullmatch("[a-f0-9]{64}",row["sha256"]),"immutable qualified artifact version, hash and length")
    need(row["key"]=="results/seed29-replay/"+attempt+"/artifacts/"+path.relative_to("/srv/acephale").as_posix(),"original path-bound worker export key")
    return path

def _qualified_preparation(history):
 """Read actual exported phase-zero proof without changing accepted component outputs."""
 context=json.loads(checked(history['verificationContext']).read_text())
 worker=json.loads(checked(history['workerResult']).read_text())
 need(context['unitId']==worker['unitId']=='seed29/replay' and context['unitAttemptId']==worker['attemptId'] and context['inputSha256']==worker['inputSha256'],'Exact historical replay owner identity')
 need(worker.get('completed')is True and type(worker.get('exitCode'))is int and worker['exitCode']==0 and worker.get('allChildrenDrained')is True,'Actual completed replay before qualified preparation reuse')
 rows=worker['durableArtifacts'];by_path={r['path']:r for r in rows};need(len(by_path)==len(rows),'Unique original durable outputs')
 attempt_root=Path('/srv/acephale/attempts')/context['unitAttemptId']
 need(context.get('attemptOutput')==str(attempt_root) and context.get('runRoot')==str(Path('/srv/acephale/runs')/context['unitAttemptId']) and context.get('occurrenceId')=='seed29-01','Exact original replay output roots and occurrence')
 phase=attempt_root/'00-current-qualified-inputs'
 def exported(path):
  p=Path(path);row=by_path.get(str(p));need(row is not None,'Qualified proof is an actual durable worker artifact')
  qualified_target(row,worker['attemptId']);r={'path':str(p),'sha256':row['sha256']};checked(r);need(p.stat().st_size==row['bytes'],'Actual durable qualified proof length');return r
 receipt=exported(phase/'preparation.json');value=json.loads(checked(receipt).read_text())
 need(value.get('kind')=='acephale-aws-current-qualified-preparation-v1' and value.get('unitId')=='seed29/replay' and value.get('unitAttemptId')==context['unitAttemptId'] and value.get('resourceAttemptId')==context['resourceAttemptId'],'Original qualified preparation identity')
 need(value.get('qualificationOwner')==context['currentQualification'] and value.get('originalScientificStepsChanged')is False and value.get('originalExportReclaimed')is False,'Original current qualification lineage without reclaimed export')
 current=exported(phase/'current-numerical-context.json');need(current==value['currentContext'],'Exact original current numerical context')
 numeric=json.loads(checked(current).read_text())
 for key in ('unitId','unitAttemptId','resourceAttemptId','instanceId','inputSha256','runRoot','currentQualification','servingProjection'):
  need(numeric.get(key)==context.get(key),'Actual original qualified context '+key)
 names=('manifest.json','profile.json','native.json','guard.json','deployment.json','inventory.json','preparation.json')
 directory=Path(context['runRoot'])/'downstream'/context['occurrenceId']/'qualified'
 qualified=[exported(directory/name)for name in names];need(value['qualifiedFiles']==qualified,'Exact original complete qualified output map')
 companion=exported(Path(context['runRoot'])/'downstream'/context['occurrenceId']/'numerical-policy/qualified.json');need(companion==value['qualifiedCompanion'],'Actual original qualified companion')
 phases=value['operationalPhaseReceipts'];need(len(phases)==3,'All three original qualified preparation processes')
 projection=exported(value['projection']['path']);checkpoint=exported(value['checkpoint']['path'])
 need(projection==value['projection']==context['servingProjection'] and checkpoint==value['checkpoint'],'Actual exported projection and original checkpoint')
 files=[receipt,current,projection,checkpoint,companion,*qualified]
 for row,label,maximum in zip(phases,('checkpoint-process','qualified-process','companion-process'),(90,300,90)):
  dispatch=exported(phase/label/'dispatch.json');result=exported(phase/label/'result.json');need(row=={'dispatch':dispatch,'result':result},'Original exact phase-zero owner paths')
  need(any(x.get('dispatch')==dispatch and x.get('result')==result for x in worker['operationalPreparationPhases']),'Exact actual worker-owned phase-zero process')
  a=json.loads(checked(dispatch).read_text());b=json.loads(checked(result).read_text())
  for key,expected in [('unitId','seed29/replay'),('attemptId',context['unitAttemptId']),('leaseId',context['resourceAttemptId']),('instanceId',context['instanceId']),('inputSha256',context['inputSha256'])]:need(a.get(key)==b.get(key)==expected,'Actual phase-zero process identity')
  need(a.get('automaticRetry')is False and b.get('completed')is True and type(b.get('exitCode'))is int and b['exitCode']==0 and b.get('drained')is True and b.get('localOwnedProcessesDrained')is True and b.get('gateCalls',0)>=2 and a.get('maximumSeconds')==b.get('maximumSeconds')==maximum and a['command']==b['argv'] and a.get('cwd')==b.get('cwd'),'Original bounded successfully drained qualified preparation')
  files.extend([dispatch,result])
 return {'kind':'acephale-aws-reused-replay-qualified-preparation-evidence-v1','receipt':receipt,'currentContext':current,'qualifiedCompanion':companion,'qualifiedFiles':qualified,'operationalPhaseReceipts':phases,'acceptedComponentOutputsChanged':False,'files':files}

def qualified_preparation(dependency,history,closure):
    need(type(history) is dict and set(history)=={"componentClosure","verificationContext","workerResult","succeededClaim"},"exact historical replay proof")
    claim=snapshot(history["succeededClaim"],"seed29/replay",closure)
    worker=read(history["workerResult"]);component=read(history["componentClosure"]);context=read(history["verificationContext"])
    need(claim.get("resultSha256")==history["workerResult"]["sha256"] and claim.get("resultKey")=="results/seed29-replay/"+claim["attemptId"]+"/result.json","historical permanent replay result bytes")
    need(worker.get("kind")=="acephale-aws-unit-worker-result-v1" and worker.get("componentClosure")==history["componentClosure"]
      and component.get("kind")=="acephale-aws-component-closure-v1" and component.get("context")==history["verificationContext"]
      and component.get("sourceCommit")==SCIENCE and component.get("scientificProtocolChanged") is False
      and all(component.get(k) is True for k in ("originalValidatorsPassed","allDeclaredOutputsPresent","allProcessesDrained","failedTrialsRetained")),"exact accepted replay component")
    for value in (worker,component):
        need(value.get("unitId")=="seed29/replay" and value.get("attemptId")==claim["attemptId"] and value.get("inputSha256")==claim["inputSha256"],"historical replay attempt/input")
    need(context.get("unitId")=="seed29/replay" and context.get("unitAttemptId")==claim["attemptId"] and context.get("inputSha256")==claim["inputSha256"]
      and context.get("resourceAttemptId")==claim["leaseId"] and context.get("instanceId")==claim["instanceId"]
      and context.get("currentQualification",{}).get("sha256")==claim["qualificationSha256"],"historical replay qualification/resource owner")
    proof=_qualified_preparation(history)
    need(dependency.get("qualifiedPreparation")==proof,"explicit actual phase-zero proof; accepted component outputs unchanged")
    refs=[*history.values(),*proof["files"]]
    need(all(r in dependency["files"] for r in refs),"complete declared restored qualified proof closure")
    by_name={Path(r["path"]).name:r for r in proof["qualifiedFiles"]}
    return by_name["manifest.json"],by_name["native.json"],refs


def verify_dependency(dependency,expected,closure):
    need(dependency.get("kind")=="acephale-aws-restored-dependency-v1" and dependency.get("unitId")==expected
      and expected in ("seed17/analysis","seed29/analysis") and type(dependency.get("imported")) is bool,"exact restored original analysis")
    claim=snapshot(dependency["succeededClaim"],expected,closure)
    component=read(dependency["component"]);outputs=dependency["outputs"]
    need(type(outputs) is dict and all(k in outputs for k in ("calibration","goalReliability")),"original named calibration outputs")
    for r in outputs.values():checked(r)
    files=dependency.get("files")
    need(type(files) is list and 0<len(files)<=50000 and all(r in files for r in [dependency["component"],dependency["succeededClaim"],*outputs.values()]),"complete declared dependency closure")
    refs=[dependency["component"],dependency["succeededClaim"],*outputs.values()]
    if dependency["imported"]:
        need(expected=="seed17/analysis" and dependency["component"]==IMPORTED and claim.get("imported") is True
          and claim.get("componentSha256")==IMPORTED["sha256"],"exact retained seed17 accepted component")
        need(component.get("id")==expected and component.get("status")=="closed","original imported closure")
        projected={k:mapped(r) for k,r in component["outputs"].items()}
        need(projected==outputs,"every original imported output uses exact raw path and bytes")
        mappings=[{"original":component["outputs"][k],"restored":r} for k,r in projected.items()]
        need(dependency.get("originalPathMappings")==mappings,"explicit original path lineage")
        replay=read(IMPORTED_REPLAY)
        need(component.get("predecessors",{}).get("seed17/replay")==IMPORTED_REPLAY["sha256"],"original replay predecessor unchanged")
        manifest_ref=mapped(replay["outputs"]["qualifiedManifest"])
        native_ref=mapped(replay["outputs"]["qualifiedNative"])
        numerical_ref=outputs["derivation"]
        numerical=read(numerical_ref)
        need(numerical.get("currentServingClaimed") is False and numerical.get("freshNumericalObservationClaimed") is False
          and numerical.get("scientificOutputsModified") is False and numerical.get("failedPredictionRowsRetained") is True
          and all(mapped(numerical["outputs"][k])==outputs[k] for k in ("calibration","goalReliability")),"retained offline derivation remains historical")
        replay_numeric=mapped(numerical["replayNumericalCompanion"])
        refs.extend([IMPORTED_REPLAY,manifest_ref,native_ref,numerical_ref,replay_numeric])
        historical={"provider":"lambda","sourceOwner":numerical["originalServingOwner"],"analysisOwner":component["ownerId"],
          "numericalPolicyHash":numerical["numericalPolicyHash"],"tunedConfigSha256":numerical["tunedConfigSha256"],
          "originalReplayComponent":IMPORTED_REPLAY,"originalNumericalEvidence":numerical_ref,"originalReplayCompanion":replay_numeric}
    else:
        need(expected=="seed29/analysis" and claim.get("imported") is not True,"new succeeded seed29 analysis only")
        history=dependency.get("history")
        need(type(history) is dict and set(history)=={"componentClosure","verificationContext","workerResult","succeededClaim"}
          and history["componentClosure"]==dependency["component"] and history["succeededClaim"]==dependency["succeededClaim"],"exact current succeeded proof chain")
        for r in history.values():checked(r)
        worker=read(history["workerResult"]);context=read(history["verificationContext"])
        need(claim.get("resultSha256")==history["workerResult"]["sha256"] and claim.get("resultKey")=="results/seed29-analysis/"+claim["attemptId"]+"/result.json","permanent result bytes and location")
        need(worker.get("kind")=="acephale-aws-unit-worker-result-v1" and worker.get("completed") is True
          and type(worker.get("exitCode")) is int and worker["exitCode"]==0 and worker.get("allChildrenDrained") is True
          and worker.get("componentClosure")==dependency["component"],"actual successful drained worker closure")
        identity={"unitId":expected,"attemptId":claim["attemptId"],"inputSha256":claim["inputSha256"]}
        need(all(all(v.get(k)==x for k,x in identity.items()) for v in (worker,component)),"same closed attempt/input")
        need(component.get("kind")=="acephale-aws-component-closure-v1" and component.get("sourceCommit")==SCIENCE
          and all(component.get(k) is True for k in ("originalValidatorsPassed","allDeclaredOutputsPresent","allProcessesDrained","failedTrialsRetained"))
          and component.get("scientificProtocolChanged") is False and component.get("context")==history["verificationContext"]
          and component.get("receiptAuthor")==SOURCE_REFS["closure"],"accepted original analysis verifier provenance")
        checked(component["receiptAuthor"])
        need(component.get("outputs")==outputs==context.get("outputs") and context.get("unitId")==expected
          and context.get("unitAttemptId")==claim["attemptId"] and context.get("inputSha256")==claim["inputSha256"]
          and context.get("job")==closure.ORIGINAL_JOBS[expected] and context.get("resourceAttemptId")==claim.get("leaseId")==component.get("resourceAttemptId")
          and context.get("instanceId")==claim.get("instanceId")==component.get("instanceId"),"exact retained CPU analysis identity and outputs")
        durable=worker.get("durableArtifacts");need(type(durable) is list and durable,"actual durable artifacts")
        for r in [dependency["component"],history["verificationContext"],*outputs.values()]:
            rows=[x for x in durable if x.get("path")==r["path"]]
            need(len(rows)==1 and rows[0].get("sha256")==r["sha256"] and rows[0].get("versionId") not in (None,"","null")
              and rows[0].get("bytes")==checked(r).stat().st_size and type(rows[0].get("key")) is str and bool(rows[0]["key"]),"exact restored versioned output")
        previous=context["historicalReplay"];need(component.get("historicalReplayDependency")==previous,"analysis retains original GPU dependency")
        replay_context=read(previous["verificationContext"]);replay=read(previous["componentClosure"])
        need(replay.get("context")==previous["verificationContext"] and replay.get("unitId")=="seed29/replay"
          and replay_context.get("outputs")==replay.get("outputs") and replay.get("originalValidatorsPassed") is True,"closed replay numerical lineage")
        manifest_ref,native_ref,qualified_refs=qualified_preparation(dependency,previous,closure)
        refs.extend(qualified_refs)
        numerical_ref=outputs["numericalCompanion"];numerical=read(numerical_ref)
        need(numerical_ref==replay["outputs"]["numericalCompanion"],"analysis uses exact retained replay companion")
        historical={"provider":"aws","analysisOwner":{"leaseId":claim["leaseId"],"instanceId":claim["instanceId"]},
          "sourceOwner":{"leaseId":replay_context["resourceAttemptId"],"instanceId":replay_context["instanceId"]},
          "numericalPolicyHash":numerical["numericalPolicyHash"],"tunedConfigSha256":numerical["tunedConfigSha256"],
          "originalNumericalEvidence":numerical_ref,"replayProof":previous}
        refs.extend([*history.values(),*previous.values(),manifest_ref,native_ref])
    manifest=read(manifest_ref);native=read(native_ref)
    need(manifest.get("sourceCommit")==SCIENCE,"original qualified scientific source")
    refs.extend([manifest_ref,native_ref,numerical_ref])
    return outputs,historical,manifest,native,refs
def compatible_science(outputs,historical_manifest,historical_native,current_manifest,current_native,hash_value):
    need(historical_manifest["actor"]==current_manifest["actor"] and historical_manifest["predictor"]==current_manifest["predictor"],"entire frozen dual-model identities/settings unchanged")
    need(historical_native.get("stream",True)==current_native.get("stream",True),"original stream mode unchanged")
    need(historical_manifest["protocol"]==current_manifest["protocol"],"original inference protocol unchanged")
    need(historical_manifest["data"]==current_manifest["data"],"entire original scientific data scope unchanged")
    for name in ("calibration","goalReliability"):
        value=read(outputs[name])
        need(value.get("contentHash")==hash_value({k:v for k,v in value.items() if k!="contentHash"}),"sealed original scientific output")
        model=value["provenance"]["model"]
        need(set(model)=={"repository","revision","trainedPredictor"} and model=={k:current_manifest["predictor"][k] for k in model},"calibration belongs to the exact qualified predictor")
    return {"actorAndPredictorUnchanged":True,"inferenceProtocolUnchanged":True,"streamModeUnchanged":True,"dataScopeUnchanged":True,
      "historicalHardware":historical_manifest["hardware"],"currentHardware":current_manifest["hardware"],
      "historicalRuntime":historical_manifest["runtime"],"currentRuntime":current_manifest["runtime"],
      "numericalEquivalenceAsserted":False,"originalFullCrossHardwareScopeEqualityClaimed":False}
def run(args):
    source_check()
    context_ref={"path":args.context,"sha256":args.context_sha256};dependency_ref={"path":args.dependency,"sha256":args.dependency_sha256}
    context=read(context_ref);dependency=read(dependency_ref)
    load("path_projection",SOURCE_REFS["pathProjection"])
    closure=load("aws_calibration_closure",SOURCE_REFS["closure"])
    wrapper=read(SOURCE_REFS["originalSources"]);need(type(wrapper.get("sources")) is dict,"original source map wrapper")
    binding=wrapper["sources"];unit=context["unitId"]
    need(unit in closure.REMAINING and closure.REMAINING[unit] in ("opportunity","native-segment")
      and context["job"]==closure.ORIGINAL_JOBS[unit] and context["sourceCommit"]==SCIENCE,"only exact original six native/opportunity jobs")
    job=read(context["job"]);occurrence=context["occurrenceId"]
    need(job["occurrenceId"]==occurrence and re.fullmatch("seed(17|29)-0[12]",occurrence) is not None,"original occurrence")
    need(context["unitAttemptId"]!=context["resourceAttemptId"] and re.fullmatch("[A-Za-z0-9_-]{8,128}",context["unitAttemptId"])
      and re.fullmatch("[a-f0-9]{64}",context["inputSha256"]) and finite(context["hardDeadline"]) and time.time()<context["hardDeadline"],"current finite exact scientific identity")
    root=Path(context["runRoot"]);output=Path(args.output)
    need(root.is_absolute() and root.is_dir() and output.is_absolute() and output.is_relative_to(root)
      and not output.exists() and not any(p.is_symlink() for p in (output,*output.parents)),"fresh output under current run root")
    adoption_path=output.with_name(output.stem+"-adoption.json");need(not adoption_path.exists(),"fresh adoption provenance")
    outputs,historical,old_manifest,old_native,refs=verify_dependency(dependency,occurrence[:6]+"/analysis",closure)
    precision,current_refs=closure.current_numerical_inputs(context,binding)
    load("aws_execution_contract",SOURCE_REFS["executionContract"]);provider=load("aws_calibration_provider",SOURCE_REFS["provider"])
    probe=load("aws_calibration_probe",SOURCE_REFS["servingProbe"]);raw=load("aws_calibration_host_probe",SOURCE_REFS["rawProbe"])
    transport=load("aws_calibration_observation",SOURCE_REFS["observationHelper"])
    provider_config=read(context["providerConfiguration"])
    with closure.original_modules(binding,context["scienceSourceDirectory"],precision) as modules:
        qualified=root/"downstream"/occurrence/"numerical-policy/qualified.json"
        current=modules.numerical.check_companion(root,occurrence,qualified)
        need(current["stage"]=="qualified" and current["leaseId"]==context["resourceAttemptId"] and current["instanceId"]==context["instanceId"],"actual current qualified companion")
        local=root/"downstream"/occurrence/"qualified"
        current_manifest_ref=ref(local/"manifest.json");current_native_ref=ref(local/"native.json")
        compatibility=compatible_science(outputs,old_manifest,old_native,read(current_manifest_ref),read(current_native_ref),sys.modules["path_projection"].hash_value)
        observation=transport.observation(context,provider_config,modules,probe,raw,provider)
        modules.numerical.check_observation(modules.numerical.load(root,occurrence),observation)
        adoption={"kind":"acephale-aws-calibration-consumption-adoption-v1","unitId":unit,"unitAttemptId":context["unitAttemptId"],
          "resourceAttemptId":context["resourceAttemptId"],"instanceId":context["instanceId"],"sourceCommit":SCIENCE,
          "context":context_ref,"dependency":dependency_ref,"originalArtifacts":{k:outputs[k] for k in ("calibration","goalReliability")},
          "historical":historical,"currentQualification":context["currentQualification"],"currentQualifiedCompanion":ref(qualified),
          "currentManifest":current_manifest_ref,"currentNative":current_native_ref,"currentNumericalPolicyHash":current["numericalPolicyHash"],
          "currentTunedConfigSha256":current["tunedConfigSha256"],"currentObservation":observation,"compatibility":compatibility,
          "historicalOutputsRewritten":False,"historicalOwnerRelabeled":False,"numericalEquivalenceAsserted":False,
          "originalCrossOwnerAdoptionVerifierClaimed":False,"replayRerun":False,"calibrationRerun":False,
          "newClaimWritten":False,"ordinaryNativeConfigurationValidationRequired":True,
          "closedDependencyAcceptanceReused":True,"closedDependencyValidatorsRerun":False,
          "files":[*refs,*current_refs,context_ref,dependency_ref,context["providerConfiguration"],current_manifest_ref,current_native_ref],
          "receiptAuthor":ref(__file__)}
        adoption_ref=write(adoption_path,adoption)
        label="aws-calibration-consumption-"+hashlib.sha256(context["unitAttemptId"].encode()).hexdigest()[:32]
        companion=modules.numerical.companion(root,occurrence,label,
          [checked(outputs["calibration"]),checked(outputs["goalReliability"]),checked(adoption_ref)],
          observation=observation,parents=[qualified])
        modules.numerical.check_companion(root,occurrence,companion)
    verify_dependency(dependency,occurrence[:6]+"/analysis",closure);closure.current_numerical_inputs(context,binding)
    for r in [context_ref,dependency_ref,*refs]:checked(r)
    source_check()
    return write(output,{"kind":"acephale-aws-calibration-adoption-helper-v1","completed":True,
      "unitId":unit,"unitAttemptId":context["unitAttemptId"],"resourceAttemptId":context["resourceAttemptId"],
      "instanceId":context["instanceId"],"context":context_ref,"dependency":dependency_ref,
      "calibrationCompanion":ref(companion),"adoptionReceipt":adoption_ref,
      "calibration":outputs["calibration"],"goalReliability":outputs["goalReliability"],
      "originalArtifactsChanged":False,"numericalEquivalenceAsserted":False,"scientificExecutionPerformed":False})
def main():
    ap=argparse.ArgumentParser()
    for key in ("context","context-sha256","dependency","dependency-sha256","output"):ap.add_argument("--"+key,required=True)
    args=ap.parse_args()
    def expired(*unused):raise TimeoutError("Calibration adoption operational maximum")
    prior=signal.signal(signal.SIGALRM,expired);signal.alarm(MAXIMUM_SECONDS)
    try:print(json.dumps(run(args)))
    finally:signal.alarm(0);signal.signal(signal.SIGALRM,prior)
if __name__=="__main__":main()
