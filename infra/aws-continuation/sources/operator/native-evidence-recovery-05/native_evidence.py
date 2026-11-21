"""AWS native phase evidence transport. Original scientific validators and export bodies remain exact."""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, os, signal, sys, time, types
from pathlib import Path

SCIENCE="5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
SOURCE_REFS={'pathProjection': {'path': '/srv/acephale/workspaces/review/scientific-closure-02/path_projection.py', 'sha256': '20dba410747597ba49f46effb268b460de529cd1f48c8e439d4e8d16a4069cbf'}, 'originalSources': {'path': '/srv/acephale/workspaces/review/scientific-closure-02/original-sources.json', 'sha256': '406bd34757eb470a1ccd56ce0a4bd5681b079c53d8786d0fd878095b86659c80'}, 'executionContract': {'path': '/srv/acephale/workspaces/operator/cloud-replay-02/aws_execution_contract.py', 'sha256': 'a862dc659bf48ef0e337790630b99b7592444f26dce1c83da0255fe910c53328'}, 'provider': {'path': '/srv/acephale/workspaces/operator/cloud-replay-02/aws_replay_provider.py', 'sha256': '843ed8e4e12311befe442da4f72c2a4666e48659fc1f78aff573178884c4a313'}, 'servingProbe': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/serving_probe_aws.py', 'sha256': 'f9cced978506b2e170cc9f7ad0839bc4c6c353e4d32dbf5c2ca7b4a20a430008'}, 'rawProbe': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/host_probe_aws.py', 'sha256': '25b6c53dfdd6c9c23ba403bbe5f5aefe935bc6b5193ad182bb845248b9958049'}, 'closure': {'path': '/srv/acephale/workspaces/operator/regional-numerical-inputs-01/closure03/closure_adapter.py', 'sha256': '1c7563b90c507b38815b19b64938cd6389555c1be55a0728cbd4c9affa22d0be'}, 'observationHelper': {'path': '/srv/acephale/workspaces/review/replay-evidence-01/replay_evidence_02.py', 'sha256': 'ac7d42724d8e80bb6182bee30c154aa6f55e47bf3789b60c9daf8e2b8e6352c7'}, 'nativeGuard': {'path': '/srv/acephale/workspaces/report/cloud-controller-09/native_guard.py', 'sha256': '04f2f01001e622635b2561c43173ee19a667f6bd8391d1359fab84da6902c522'}, 'phaseAdmission': {'path': '/srv/acephale/workspaces/report/cloud-controller-09/phase_admission.py', 'sha256': 'e2764aec07f87c1c175f0471a92f62b19be2fa82c3c30c3973db59e1fa5641dc'}, 'originalExport': {'path': '/srv/acephale/workspaces/review/native-evidence-01/original_native_export.py', 'sha256': '5f1dab39d9f00352ff515b82cdf3b9710d826e832514ac7b347c9e1a29aabe6f'}, 'originalOwner': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_native_stage_owner.py', 'sha256': 'b338a63ac44d5e9ee1e8041eac59ac785c41e1679a94bbdaa41c667e38de16a6'}}
UNITS={"seed17/opportunity":"opportunity","seed29/opportunity":"opportunity",
       "development/1":"native","development/2":"native","heldout/1":"native","heldout/2":"native"}

def require(value,message):
    if not value:raise ValueError(message)

def sha(path):
    path=Path(path)
    require(path.is_absolute() and path.is_file() and not any(p.is_symlink() for p in (path,*path.parents)),"Absolute regular unlinked evidence required")
    with path.open("rb") as stream:return hashlib.file_digest(stream,"sha256").hexdigest()

def ref(path):return {"path":str(Path(path)),"sha256":sha(path)}
def checked(value):
    require(type(value) is dict and set(value)=={"path","sha256"},"Exact FileRef required")
    path=Path(value["path"]);require(sha(path)==value["sha256"],"Evidence bytes changed: "+str(path));return path
def read(path):return json.loads(Path(path).read_text())
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    require(not any(p.is_symlink() for p in (path.parent,*path.parent.parents)),"Unlinked output directory")
    with path.open("x") as f:json.dump(value,f,indent=2,allow_nan=False);f.write("\n");f.flush();os.fsync(f.fileno())
def load(name,row):
    path=checked(row);require(name not in sys.modules,"Fresh module alias required")
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:sys.modules.pop(name,None);raise
    require(Path(module.__file__)==path and sha(path)==row["sha256"],"Exact loaded helper bytes/origin")
    return module
def finite(value):return type(value) in (int,float) and math.isfinite(value)
def source_check():
    for row in SOURCE_REFS.values():checked(row)

def operational_stage(context):
    stage="native-"+hashlib.sha256(context["unitAttemptId"].encode()).hexdigest()[:32]
    authority_ref=context.get("operationalContinuation")
    if not authority_ref or authority_ref.get("path")!="/srv/acephale/artifacts/seed17-opportunity-continuation-05.json":return stage
    p=checked(authority_ref);st=p.stat();a=read(p)
    parent={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-04.json","sha256":"29ddf1473ed480dd20ea5eeffd7f9d8b7359c11079f0cb6b1b8f6de1311f1ecf"}
    require(st.st_uid==0 and st.st_mode&0o022==0 and a.get("approved")is True and a.get("authorityStatus")=="active"
      and a.get("kind")=="acephale-aws-pre-science-operational-continuation-v1"and a.get("generation")=="05"and a.get("parentAuthority")==parent,"Exact root evidence-namespace authority")
    prior=read(checked(parent))
    for key in ("unitId","unitAttemptId","resourceAttemptId","instanceId","inputSha256","sourceCommit","hardDeadline"):
        require(a.get(key)==prior.get(key)==context.get(key),"Same permanent evidence assignment "+key)
    require(a["unitId"]=="seed17/opportunity"and a["unitAttemptId"]=="unit-b8dae1aff90e4b838cb08b973c6e6ec6"
      and a.get("priorNativeEvidenceFailedBeforeProfile")is True and a.get("retainedAdmittedPreparation")is True
      and a.get("scientificSettingsChanged")is False and a.get("scientificAttemptReissued")is False
      and a.get("originalFailureReclaimed")is False,"Operational namespace only; no new scientific attempt")
    failure=a.get("previousFailedResult",{})
    require(failure.get("key")=="results/seed17-opportunity/unit-b8dae1aff90e4b838cb08b973c6e6ec6/operational-generations/04/result.json"
      and failure.get("sha256")=="f32f0700abf0fb594a15ffe62596b012471884892a5aab4aa3bcc37e173e4e2a"
      and failure.get("versionId")=="LVBOzNPy8Fo8C1Pm_.5cPzReJLl_hUac","Actual retained failed generation04")
    require(a.get("nativeEvidenceSource")==ref(Path(__file__))and a.get("operationalStageId")==stage+"-op05","Exact source and explicit fresh operational stage")
    return stage+"-op05"

def identities(context,configuration,closure):
    unit=context["unitId"];require(unit in UNITS,"Original six native scientific units only")
    require(context["sourceCommit"]==SCIENCE and context["unitAttemptId"]!=context["resourceAttemptId"],"Separate immutable scientific/resource identity")
    require(type(context["unitAttemptId"]) is str and context["unitAttemptId"],"Actual unit attempt")
    require(type(context["inputSha256"]) is str and len(context["inputSha256"])==64 and all(c in "0123456789abcdef" for c in context["inputSha256"]),"Exact execution input digest")
    require(finite(context["hardDeadline"]) and time.time()<context["hardDeadline"]-30,"Live unchanged hard deadline")
    require(context["job"]==closure.ORIGINAL_JOBS[unit],"Exact frozen original job")
    job=read(checked(context["job"]))
    require(job["unitId"]==unit and job["sourceCommit"]==SCIENCE and job["automaticRetry"] is False
            and job["occurrenceId"]==context["occurrenceId"],"Original job and occurrence")
    root=Path(context["runRoot"]);attempt=Path(context["attemptOutput"])
    require(root.is_absolute() and root.is_dir() and attempt.is_absolute() and attempt.is_dir(),"Actual absolute run and attempt roots")
    require(not any(p.is_symlink() for q in (root,attempt) for p in (q,*q.parents)),"No linked owner roots")
    experiment=checked(context["nativeExperiment"]);preparation=checked(context["nativePreparation"])
    require(experiment.name=="experiment.json" and preparation==experiment.with_name("preparation.json")
            and experiment.is_relative_to(attempt),"Exact current original prepared files")
    value=configuration["value"]
    stage=operational_stage(context)
    expected={"kind":"acephale-aws-native-stage-owner-v1","mode":UNITS[unit],"stageId":stage,
      "sourceDirectory":context["scienceSourceDirectory"],"sourceCommit":SCIENCE,
      "leaseId":context["resourceAttemptId"],"instanceId":context["instanceId"],"hardDeadline":context["hardDeadline"],
      "occurrenceId":context["occurrenceId"],"experimentPath":str(experiment),"experimentSha256":context["nativeExperiment"]["sha256"],
      "preparationSha256":context["nativePreparation"]["sha256"],"originalStudyJournalPath":"/srv/acephale/shared/budget.jsonl",
      "exclusiveOriginalJournalOwnership":True}
    require(all(type(value.get(k)) is type(v) and value[k]==v for k,v in expected.items()),"Exact actual native owner configuration")
    require(configuration["lease"]=={"id":context["resourceAttemptId"],"instanceId":context["instanceId"],"deadline":context["hardDeadline"]},"Exact actual lease")
    require(finite(value["phaseDeadline"]) and value["phaseDeadline"]<=context["hardDeadline"],"Original finite native phase deadline")
    require(all(Path(value[k]).is_absolute() for k in ("runnerPython","nodeExecutable")),"Explicit original executables")
    checked(configuration["servingUnitPlan"])
    checked(context["providerConfiguration"]);checked(context["calibrationCompanion"])
    require(context["nativeGuardSource"]["sha256"]==SOURCE_REFS["nativeGuard"]["sha256"],"Exact original guard adapter")
    checked(context["nativeGuardSource"])
    require(sha(Path(context["nativeGuardSource"]["path"]).with_name("phase_admission.py"))==SOURCE_REFS["phaseAdmission"]["sha256"],"Exact adjacent original admission module")
    return root,attempt,experiment,value,job

def phase_identity(context,dispatch,result):
    expected={"unitId":context["unitId"],"attemptId":context["unitAttemptId"],"leaseId":context["resourceAttemptId"],
      "instanceId":context["instanceId"],"sourceCommit":SCIENCE,"inputSha256":context["inputSha256"]}
    require(dispatch.get("kind")=="acephale-aws-owned-process-dispatch-v1"
            and result.get("kind")=="acephale-aws-owned-process-result-v1","Actual owned process receipts")
    require(all(dispatch.get(k)==v and result.get(k)==v for k,v in expected.items()),"Actual phase ownership")
    require(dispatch.get("automaticRetry") is False and result.get("childCreated") is True
      and type(result.get("exitCode")) is int and result["exitCode"]==0
      and result.get("completed") is True and result.get("drained") is True
      and result.get("localOwnedProcessesDrained") is True and result.get("providerWatcherDrained") is True
      and result.get("failure") is None,"Actual successful created/drained phase")
    require(dispatch.get("command")==result.get("argv") and dispatch.get("cwd")==result.get("cwd")==context["scienceSourceDirectory"],"Exact phase command/cwd agreement")
    require(type(result.get("gateCalls")) is int and result["gateCalls"]>=2,"Fresh provider boundaries")
    require(all(finite(x) for x in (dispatch.get("startedAt"),result.get("startedAt"),result.get("finishedAt"),result.get("maximumSeconds"))),"Finite actual phase evidence")
    require(result["startedAt"]<=dispatch["startedAt"]<=result["finishedAt"]<=time.time()
      and result["finishedAt"]<context["hardDeadline"] and 0<result["maximumSeconds"]<=28800,"Actual bounded phase timing")
    for row in result["logs"]:checked(row)

def admission_evidence(context,configuration_ref,value):
    refs=context["ownerAdmission"];dispatch=read(checked(refs["dispatch"]));result=read(checked(refs["result"]))
    phase_identity(context,dispatch,result)
    expected=[value["runnerPython"],"-B",context["nativeGuardSource"]["path"],"plan","--input",configuration_ref["path"],"--output",context["guardAdmission"]["path"]]
    require(dispatch["command"]==expected,"Exact original native plan admission command")
    admission=read(checked(context["guardAdmission"]))
    require(admission.get("kind")=="acephale-aws-public-native-admission-v1"
      and admission.get("guardFunctionsUnchanged") is True and admission.get("actualCurrentAWSOwnershipExternal") is True
      and admission.get("sourceDirectory")==context["scienceSourceDirectory"],"Actual original guard admission")
    require(finite(admission["maximumSeconds"]) and 0<admission["maximumSeconds"]<=28800
      and finite(admission["deadline"]) and admission["deadline"]<=context["hardDeadline"]
      and admission["phaseDeadline"]==value["phaseDeadline"],"Original guard bounds")
    return admission,[refs["dispatch"],refs["result"],context["guardAdmission"],context["nativeGuardSource"]]

def scientific_evidence(context,value,admission,dispatch_ref,result_ref,before):
    dispatch=read(checked(dispatch_ref));result=read(checked(result_ref));phase_identity(context,dispatch,result)
    experiment=Path(value["experimentPath"])
    require(dispatch["command"]==[value["runnerPython"],"-m","acephale.experiment_runner","--manifest",str(experiment),"--output",str(experiment.parent/"run")],"Exact original experiment argv")
    require(result["maximumSeconds"]==admission["maximumSeconds"] and dispatch["maximumSeconds"]==admission["maximumSeconds"],"Unchanged original scientific maximum")
    require(result.get("guardStarted") is True and result.get("guardHealthVerified") is True
      and result.get("guardDrained") is True and result.get("guardDrainErrors")==[],"Actual original public guard lifetime and drain")
    require(finite(before["finishedAt"]) and before["finishedAt"]<=dispatch["startedAt"],"Before observation precedes actual science")
    guard_ref=ref(checked(result_ref).with_name("guard-dispatch.json"));guard=read(checked(guard_ref))
    require(guard.get("kind")=="acephale-aws-public-guard-dispatch-v1" and guard.get("source")==context["nativeGuardSource"]
      and guard.get("admission")==context["guardAdmission"] and guard.get("automaticRetry") is False,"Exact actual guard source/admission")
    for key in ("unitId","attemptId","leaseId","instanceId","sourceCommit","inputSha256"):
        require(guard.get(key)==dispatch[key],"Guard belongs to same original scientific phase")
    require(finite(guard["startedAt"]) and guard["startedAt"]<=dispatch["startedAt"],"Guard started before science")
    return result,[dispatch_ref,result_ref,guard_ref]

def previous_evidence(context_ref,configuration_ref,directory):
    helper_ref=ref(directory/"before-helper-receipt.json");helper=read(checked(helper_ref))
    require(helper.get("kind")=="acephale-aws-native-evidence-helper-v1" and helper.get("completed") is True
      and helper.get("mode")=="before" and helper.get("context")==context_ref and helper.get("configuration")==configuration_ref
      and helper.get("scientificProtocolChanged") is False,"Exact successful before helper")
    before_ref=helper["observation"];require(before_ref["path"]==str(directory/"owner/before.json"),"Exact retained before observation")
    before=read(checked(before_ref))
    require(before.get("kind")=="acephale-aws-native-before-v1" and before.get("context")==context_ref
      and before.get("configuration")==configuration_ref,"Before observation exact context")
    checked(helper["inputCompanion"]);checked(helper["nativeOwnerConfiguration"])
    require(read(checked(helper["guardBefore"]))==before["observation"],"Exact retained original before observation")
    return before,helper,helper_ref

def plan_from_experiment(context,value,job,closure):
    from acephale.experiment_runner import Experiment,verify_inputs
    from acephale.training_data import verify_hashed
    path=checked(context["nativeExperiment"]);raw=read(path);experiment=Experiment.model_validate(raw)
    verify_inputs({name:Path(item.path) for name,item in experiment.inputs.items()},experiment)
    prepared=verify_hashed(read(checked(context["nativePreparation"])))
    native=read(path.with_name("configuration.json"))
    plan={"experimentPath":path,"raw":raw,"experiment":experiment}
    if value["mode"]=="native":
        ids=closure.original_ids(context,job)
        require(prepared["runIds"]==ids and [r["runId"] for r in native["runs"]]==ids,"Exact original native run IDs/order")
        plan.update(runIds=ids,native=native)
    return plan

def opportunity_identity(context,plan,measurements):
    ids=context["unitScientificIds"]
    require(type(ids) is list and ids and len(ids)==len(set(ids)),"Original unique opportunity row IDs")
    require(plan.get("rowIds")==ids and measurements.get("rowIds")==ids
      and measurements.get("profilePlanHash")==plan.get("contentHash"),"Original profile/measurement row IDs and plan binding")

def native_outputs(context,value,modules,plan,owner_dir,result,phase_refs,before_ref,after_path,export):
    completion=modules.owner.verify_completion(plan)
    if value["mode"]=="opportunity":
        from acephale.training_data import verify_hashed
        profile=plan["experimentPath"].parent/"run/profile/artifacts"
        profile_plan=verify_hashed(read(profile/"profile-plan.json"))
        measurements=verify_hashed(read(profile/"measurements.json"))
        opportunity_identity(context,profile_plan,measurements)
    accounting=modules.owner.slot_accounting(plan) if value["mode"]=="native" else None
    if accounting is not None:
        require(not accounting["missing"] and not accounting["malformedLines"] and not accounting["unexpectedIds"],"Original native outcomes omitted or replaced")
    owner={"kind":"acephale-aws-native-phase-aggregation-v1","status":"completed","stageId":value["stageId"],
      "unitId":context["unitId"],"attemptId":context["unitAttemptId"],"leaseId":context["resourceAttemptId"],"instanceId":context["instanceId"],
      "sourceCommit":SCIENCE,"inputSha256":context["inputSha256"],"localOwnedProcessesDrained":True,"dispatchBlocked":False,
      "experimentCompletionHash":completion,"originalSlotAccounting":accounting,"phaseReceipts":phase_refs,
      "beforeHelperReceipt":before_ref,"afterObservation":ref(after_path),"actualGuardExitCode":result.get("guardExitCode"),
      "singleOriginalOuterExitClaimed":False,"originalWindowsReceiptFabricated":False,"scientificProtocolChanged":False}
    # The original exporter inventories the closed owner evidence and complete prepared tree.
    # As in the original owner, the final result is created after the archive is verified.
    write(owner_dir/"owned-process-drain.json",{"kind":"acephale-aws-native-owned-process-drain-aggregation-v1",
      "unitId":context["unitId"],"attemptId":context["unitAttemptId"],"leaseId":context["resourceAttemptId"],
      "instanceId":context["instanceId"],"localOwnedProcessesDrained":result["localOwnedProcessesDrained"],
      "guardDrained":result["guardDrained"],"providerWatcherDrained":result["providerWatcherDrained"],
      "actualPhaseReceipts":phase_refs,"singleOriginalOuterExitClaimed":False})
    receipt=export.export_local(owner_dir,plan["experimentPath"].parent)
    owner.update(localExportVerified=receipt["localExportVerified"],localExport=ref(owner_dir.with_suffix(".export.json")),archive=ref(owner_dir.with_suffix(".zip")))
    write(owner_dir/"result.json",owner)
    outputs={"nativeOwnerConfiguration":ref(owner_dir/"configuration.json"),"nativeExperiment":context["nativeExperiment"],
      "preparation":context["nativePreparation"],"experimentCompletion":ref(plan["experimentPath"].parent/"run/completion.json"),
      "guardBefore":ref(owner_dir/"guard-before.json"),"guardAfter":ref(owner_dir/"guard-after.json"),
      "ownedProcessDrain":ref(owner_dir/"owned-process-drain.json"),
      "ownerReceipt":ref(owner_dir/"result.json"),"archive":ref(owner_dir.with_suffix(".zip")),
      "localVerification":ref(owner_dir.with_suffix(".export.json"))}
    if value["mode"]=="native":
        outputs["cohortReceipt"]=ref(plan["experimentPath"].parent/"run/native/artifacts/cohort-receipt.json")
        outputs["nativeSummary"]=ref(plan["experimentPath"].parent/"run/native/artifacts/summary.json")
    else:
        outputs["profilePlan"]=ref(plan["experimentPath"].parent/"run/profile/artifacts/profile-plan.json")
        outputs["measurements"]=ref(plan["experimentPath"].parent/"run/profile/artifacts/measurements.json")
        outputs["opportunity"]=ref(plan["experimentPath"].parent/"run/aggregate/artifacts/opportunity.json")
    modules.output.verify_native_archive({"outputs":outputs},plan["experimentPath"].parent)
    return outputs

def run(args):
    source_check()
    context_ref={"path":args.context,"sha256":args.context_sha256};configuration_ref={"path":args.native_configuration,"sha256":args.configuration_sha256}
    context=read(checked(context_ref));configuration=read(checked(configuration_ref))
    load("path_projection",SOURCE_REFS["pathProjection"])
    closure=load("aws_native_closure",SOURCE_REFS["closure"])
    original=read(checked(SOURCE_REFS["originalSources"]));require(type(original.get("sources")) is dict,"Exact original source map wrapper")
    binding=original["sources"]
    root,attempt,experiment,value,job=identities(context,configuration,closure)
    directory=checked(configuration_ref).parent/"native-evidence";owner_dir=directory/"owner"
    require(directory.is_relative_to(attempt) and Path(args.output)==directory/(args.mode+"-helper-receipt.json") and not Path(args.output).exists(),"Exact fresh current native evidence output")
    admission,admission_refs=admission_evidence(context,configuration_ref,value)
    precision,refs=closure.current_numerical_inputs(context,binding)
    load("aws_execution_contract",SOURCE_REFS["executionContract"])
    provider=load("aws_replay_provider",SOURCE_REFS["provider"])
    probe=load("aws_native_serving_probe",SOURCE_REFS["servingProbe"]);raw=load("aws_native_host_probe",SOURCE_REFS["rawProbe"])
    observation_helper=load("aws_native_observation_transport",SOURCE_REFS["observationHelper"])
    exporter=load("aws_original_native_export",SOURCE_REFS["originalExport"])
    provider_config=read(checked(context["providerConfiguration"]))
    with closure.original_modules(binding,context["scienceSourceDirectory"],precision) as modules:
        plan=plan_from_experiment(context,value,job,closure)
        qualified=root/"downstream"/context["occurrenceId"]/"numerical-policy/qualified.json"
        calibration=checked(context["calibrationCompanion"])
        modules.numerical.check_companion(root,context["occurrenceId"],qualified)
        modules.numerical.check_companion(root,context["occurrenceId"],calibration)
        if args.mode=="before":
            require(not owner_dir.exists(),"No previous native evidence")
            require(time.time()<value["phaseDeadline"],"Original scientific phase expired")
            write(owner_dir/"configuration.json",value)
            inputs=modules.numerical.companion(root,context["occurrenceId"],value["stageId"]+"-inputs",
              [owner_dir/"configuration.json",*[experiment.with_name(n) for n in ("experiment.json","preparation.json","configuration.json","manifest.json")]],
              parents=[qualified,calibration])
            modules.numerical.check_companion(root,context["occurrenceId"],inputs)
            observed=observation_helper.observation(context,provider_config,modules,probe,raw,provider)
            write(owner_dir/"guard-before.json",observed)
            write(owner_dir/"before.json",{"kind":"acephale-aws-native-before-v1","context":context_ref,"configuration":configuration_ref,"observation":observed,"finishedAt":time.time()})
            write(owner_dir/"admission-provenance.json",{"kind":"acephale-aws-native-admission-provenance-v1","configuration":configuration_ref,"actualAdmission":admission_refs,"job":context["job"],"providerConfiguration":context["providerConfiguration"],"inputCompanion":ref(inputs)})
            result={"mode":"before","observation":ref(owner_dir/"before.json"),"inputCompanion":ref(inputs),"nativeOwnerConfiguration":ref(owner_dir/"configuration.json"),"guardBefore":ref(owner_dir/"guard-before.json")}
        else:
            before,prior,prior_ref=previous_evidence(context_ref,configuration_ref,directory)
            require(read(checked(prior["nativeOwnerConfiguration"]))==value,"Native owner configuration unchanged")
            modules.numerical.check_companion(root,context["occurrenceId"],checked(prior["inputCompanion"]))
            phase,phase_refs=scientific_evidence(context,value,admission,{"path":args.phase_dispatch,"sha256":args.phase_dispatch_sha256},{"path":args.phase_result,"sha256":args.phase_result_sha256},before)
            provider.validate_provider(provider_config)
            observed=observation_helper.observation(context,provider_config,modules,probe,raw,provider,prior=before["observation"]["serviceContainers"])
            after=owner_dir/"after.json";write(after,observed)
            write(owner_dir/"guard-after.json",observed)
            write(owner_dir/"scientific-phase-provenance.json",{"kind":"acephale-aws-native-phase-provenance-v1","actualPhaseReceipts":phase_refs,"beforeHelperReceipt":prior_ref,"actualOwnerAdmission":admission_refs})
            outputs=native_outputs(context,value,modules,plan,owner_dir,phase,phase_refs,prior_ref,after,exporter)
            companion=modules.numerical.companion(root,context["occurrenceId"],value["stageId"]+"-outputs",
              [experiment.parent/"run/completion.json",owner_dir/"result.json",after],observation=observed,parents=[checked(prior["inputCompanion"])])
            outputs["numericalCompanion"]=ref(companion)
            modules.numerical.check_companion(root,context["occurrenceId"],companion)
            result={"mode":"complete","outputs":outputs,"observation":ref(after),"beforeHelperReceipt":prior_ref,"originalCompletionVerifierPassed":True,"originalArchiveVerifierPassed":True,"originalNumericalChecksPassed":True}
        closure.current_numerical_inputs(context,binding)
    source_check();checked(context_ref);checked(configuration_ref);identities(context,configuration,closure)
    write(args.output,{"kind":"acephale-aws-native-evidence-helper-v1","completed":True,"unitId":context["unitId"],
      "attemptId":context["unitAttemptId"],"leaseId":context["resourceAttemptId"],"instanceId":context["instanceId"],
      "context":context_ref,"configuration":configuration_ref,"scientificProtocolChanged":False,
      "scientificExecutionPerformed":False,"originalWindowsReceiptFabricated":False,**result})
    return ref(args.output)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=["before","complete"],required=True)
    for name in ("context","context-sha256","native-configuration","configuration-sha256","output"):parser.add_argument("--"+name,required=True)
    for name in ("phase-dispatch","phase-dispatch-sha256","phase-result","phase-result-sha256"):parser.add_argument("--"+name)
    args=parser.parse_args()
    require(args.mode!="complete" or all(getattr(args,k) for k in ("phase_dispatch","phase_dispatch_sha256","phase_result","phase_result_sha256")),"Actual scientific dispatch/result refs required")
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError("Finite native evidence helper expired")))
    signal.alarm(300)
    try:print(json.dumps(run(args),allow_nan=False))
    finally:signal.alarm(0)
if __name__=="__main__":main()
