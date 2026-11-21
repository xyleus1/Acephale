"""Verify actual AWS component outputs through retained original scientific validators.
No provider, model, journal, claim, or resource mutation is performed by this CLI.
"""
from __future__ import annotations
import argparse, ast, contextlib, hashlib, importlib.util, json, math, os, pathlib, re, sys, types
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path, PurePosixPath
import zipfile

SCIENCE="5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
REMAINING={"seed29/replay":"replay","seed29/analysis":"analysis","seed17/opportunity":"opportunity",
 "seed29/opportunity":"opportunity","development/1":"native-segment","development/2":"native-segment",
 "heldout/1":"native-segment","heldout/2":"native-segment","heldout/selection":"heldout-selection"}
HERE=Path(__file__).resolve().parent
CURRENT_SCIENCE_ROOT='/srv/acephale/workspaces/operator/science-source'
SERVING_ARTIFACTS_ROOT='/srv/acephale/artifacts'
NUMERICAL_SOURCE={'path': '/srv/acephale/workspaces/review/scientific-closure-02/numerical_policy_binding_aws.py', 'sha256': 'ca02ccb4c0101b1e84ba211cb962e5d97166287533cb2e952d76c125440a65e6'}
HARDWARE_HELPER={'path': '/srv/acephale/workspaces/operator/cloud-serving-01/hardware_compatibility.py', 'sha256': '4236b62074112b538311ba20957684af1f3819a342302052a36cf7c25239494b'}

ORIGINAL_JOBS = {'seed29/replay': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/seed29-replay.json', 'sha256': '790531dc317572154a4fcda8b530a30328447a598fe8c874b352a3cad8296218'}, 'seed29/analysis': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/seed29-analysis.json', 'sha256': '1b291c9838138ef26c93e2ff3194ebd2e4bb7d7079ede723ebf4d34fed6e23e8'}, 'seed17/opportunity': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/seed17-opportunity.json', 'sha256': '2eaa27c17c261b03754f90e8fb94aa918e4063847217668023742130ab1a6ac5'}, 'seed29/opportunity': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/seed29-opportunity.json', 'sha256': '136c41fd354eed7104a4de97852a1e3c719a62c2f54c5fb07dd44bb5cdc00c2a'}, 'development/1': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/development-1.json', 'sha256': 'a89aaec1a48e210be1a15c133a0f8c62929c6874d44d7adf25b60ff2b311a62d'}, 'development/2': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/development-2.json', 'sha256': 'febc683311c7bf0a8950c351dc298cb7acfe030cfee4b3d8be25b048ffc240f7'}, 'heldout/selection': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/heldout-selection.json', 'sha256': '12e63d171d043dcaa853455e75948a93c2463197927eb399259a1da2a3a4b752'}, 'heldout/1': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/heldout-1.json', 'sha256': 'd69cf6bcdaeb398c8397510b09e1868f4afe7c5cf440751c627adc4411f25fba'}, 'heldout/2': {'path': '/srv/acephale/workspaces/report/continuation-03/jobs/heldout-2.json', 'sha256': 'ffd3ae2b2bae15f5a25273235bbb646329377ce2367ac5900ab65f26127b83bd'}}
SCIENTIFIC_MODULES = {'research/acephale/src/acephale/__init__.py': 'ef8af3489e45a13b432024034ab32cd869be72134595c4378c297cf84a7e61bf', 'research/acephale/src/acephale/adapters/__init__.py': 'a012682b57fbb3c17d8c97a67dbe5b11291f065ec2a0edc9c3c8134660089e50', 'research/acephale/src/acephale/adapters/step_gateway.py': 'fa8804e2e54a0ebe22286f80e5e05256d855fedae16636c834280f7e6726c032', 'research/acephale/src/acephale/adapters/tau.py': '0cf5445897f44cec4fc8cddd6a518ca48b6b154e29113bb06f6c57840479e774', 'research/acephale/src/acephale/adapters/tau_external_agent.py': '82d0d37d4867b9bab094fc18c5990f546b5df4b5a1cee88dc3f7865e78ab85eb', 'research/acephale/src/acephale/adapters/tau_snapshot.py': '2cdc4d8d2f5c11fbc9c0167699d5aae5ed390a476ed1ea82673c64559a5ea8d0', 'research/acephale/src/acephale/annotation_review.py': 'c9009eb61bbcf990396579e054778c064937e34f477011ed8f3920ca07f7bba6', 'research/acephale/src/acephale/artifact_export.py': 'ba1794170ecdb0982bd6140aaf124951a65c85f3b1c449ae136db24bbdd8ddd6', 'research/acephale/src/acephale/binding.py': '50f6018c93908a52422e0a3afc3963be0d5af2db625e870009541a19d7b27475', 'research/acephale/src/acephale/contracts_v1.py': '97278a1e78f7fe1eda41983116f69082de7b5622587808d621c348bedd61da5e', 'research/acephale/src/acephale/corpus.py': '3b795d21c0407dfc27a1fd4ba1edbdd39a861f34ac06276f17f33a9a95295795', 'research/acephale/src/acephale/corpus_audit.py': '7a47186d5ade4888cc4b03ac5376e187e1643c189f8f828201d4a29311dcec20', 'research/acephale/src/acephale/custom_native_tasks.py': 'd8cf1323eaa03f3405594525f62a0d3b8a8a893394e5acb47e53b2c109cc93c0', 'research/acephale/src/acephale/experiment_runner.py': '407da9c3c2d031aa7c4510079fb9572c454fa15d28937b4d8dc99627b30f9c35', 'research/acephale/src/acephale/fixtures.py': 'ecba85799e999949bdc1fc1b450d29d0964e33d0c2a6789d42b39abc5d06de8b', 'research/acephale/src/acephale/goals.py': 'e6e1f1b458bc54983961d2ba8456f6bd48258323e9a31bab5b5cc61ff7d49867', 'research/acephale/src/acephale/infra_admission.py': 'b6367cf0291286acecfd75a82ce9b0fef02e1b78b29bd7bf8a73d8d0a2f3f804', 'research/acephale/src/acephale/infra_calibration.py': '05177f97f724a89d26876f6994eb01bbb7566dcee4dd7a2c4ff33086c349d6f4', 'research/acephale/src/acephale/infra_cli.py': '96a7d9dbaeace8a06760e952e9a54dcc5838266f652847ff32ae1b194dec9b43', 'research/acephale/src/acephale/infra_data.py': '5cec82162e4b8b71111db6ff8f0a74db8cf0358a797bec648e43600ee2607f2d', 'research/acephale/src/acephale/infra_evaluation.py': '68cbe1e854c925f14c0b70cacdf91d261c6dc3c921914291ab964e289c4910f2', 'research/acephale/src/acephale/infra_fairness.py': 'd83a0f5af3af15f36d20ed45fe1ada0b13af1d006f7f3d2980050bc5b0805b83', 'research/acephale/src/acephale/infra_import_fresh.py': '177565bcb9c7d3bce923f5916efb40a7afa14186bd124c5ca663572e67522add', 'research/acephale/src/acephale/infra_native_profile.py': '79b937f276d11980f54c531f64e5059f5757c80749b0c9f599ec86a86b16a8f8', 'research/acephale/src/acephale/infra_native_runner.py': 'b3805efb03f820bb7ad0f8bbc1512e24e94bcbcbb450d51b54e146379b7eb3e6', 'research/acephale/src/acephale/infra_prepare_native.py': 'e5602f4ff0d8909caf35d41513437438c74a39ff0b58b8e724ffabc1be90ff04', 'research/acephale/src/acephale/infra_replay.py': '39b3d5b2a4548d0877085a007c06407c1ebae661ef4769bd0ac7f60af59affae', 'research/acephale/src/acephale/infra_split_guard.py': '25e11aff64fa2013cf5b09441b0e2c45b12e3d9268d4c32c93594634d7c53c56', 'research/acephale/src/acephale/live_design.py': '525e21ceb45bfa0d32cf28dd3ab3683e62741c64245073285fc43e8613f49780', 'research/acephale/src/acephale/native_common.py': 'f987a03bf4bb352c17ff4e677aaafc0e4216efa18344cc12a1c1c3bd1dea1cd8', 'research/acephale/src/acephale/native_pilot.py': 'b3a0627b90fdeea39f6c95631240092e9cac51d2764375ef7c91ba41bd73e7ee', 'research/acephale/src/acephale/native_review.py': 'f57b02913062d1595ce9e83e612d911b4c0ab6e8a9e5df107880e3a9852b3af0', 'research/acephale/src/acephale/native_study.py': '84425e4a3adbb98ff80db8f8a82897ca898b81d1a287a879b09eacb9017e6f4c', 'research/acephale/src/acephale/patterns.py': '786d93187e362af64222019aa7fe00be30293791b83ca1ad0ceabe74721cbf23', 'research/acephale/src/acephale/predictor_serving.py': 'ebdfff6858d63c6966012cd24de31d0a8c8facf3dfbcaf8072870437368aea9a', 'research/acephale/src/acephale/replay.py': 'fc195203cf205a1d15e1df0eee125dd8f90375a090bf78018933a1afdae706f1', 'research/acephale/src/acephale/replay_receipt.py': '1d46fd9eb4b306d7df531025d18c477814392f98a361ec03b53f96780b4a6a40', 'research/acephale/src/acephale/schemas.py': '9613845bf8cc3d259fa6200479a892d703b290ece33b613d2e4434b7174f25b6', 'research/acephale/src/acephale/score_semantics.py': '64b9441c2205694a14b4370da5154a858b6de56039cdadccefbc4f94bdc6db5b', 'research/acephale/src/acephale/splits.py': 'ac8266532376dc392f11a79c7d693bc1de47de6052e59a1d4ee1ac7d7a967825', 'research/acephale/src/acephale/storage.py': 'eb5884bd038377242edaf3b4b5ee9298654a85c0f85b76e2f3e22ed4432acdbd', 'research/acephale/src/acephale/training.py': '2b61416aef9c2f8b0e6e3959f1ba0a4dea92142ce17e597992531d5be0d4dbdd', 'research/acephale/src/acephale/training_cli.py': '8f80fd21b77691eeeffad84bb776fcbfcbd51b7cf488abcb35b8999426751e51', 'research/acephale/src/acephale/training_container.py': 'afc889a7a5fe0ccfed427b3d6f1301b98a752c3003c75b66d54a648b9152bc2b', 'research/acephale/src/acephale/training_data.py': '8d3711048eb35b4ae8e773d21201c385cbb3ecb4a008280faba365e0a114eedf', 'research/acephale/src/acephale/training_kernels.py': '5b00046d19b92756df6780739273b260f526913d2c8b5beefe9187fe1eb35542', 'research/acephale/src/acephale/training_lora.py': '923b1e647d06e9a07ed204670db71e161698e8a2bf1cefab8157c71e0565cdd3', 'research/acephale/src/acephale/training_precision.py': 'ae6ac47f711e3c67ec7e9f6f542e3143d033853be7abb4af5c86e379533a08c8', 'research/acephale/src/acephale/training_profile.py': 'ad713f89e7a501b40c1218a32aaf6b38fd78aa7ffb2803648c55a6e6be5a9ca8', 'research/acephale/src/acephale/windows_process.py': '6a3acf4d6b6deab571ffce5d431b163784c2026e4a99dffb25d756e89a7fd20f'}
ORIGINAL_SOURCES = {'unit_lifecycle.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_lifecycle.py', 'sha256': '3a7a3d22da41e0ff0e6743430bed4ccdf12e532466b1f4cd6bc8cc15ec3ac190'}, 'unit_native_stage_owner.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_native_stage_owner.py', 'sha256': 'b338a63ac44d5e9ee1e8041eac59ac785c41e1679a94bbdaa41c667e38de16a6'}, 'unit_replay_verification.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_replay_verification.py', 'sha256': '490ae2e310e9ea193090fd421c2d62de8c6fe1f4b942084bc4236eba77d28896'}, 'serving_precision.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/serving_precision.py', 'sha256': 'c0f75e2c4cbb8a4c7b686a8632363a71bbd37d9e2cce7c4796036afb4b4c47bd'}, 'numerical_policy_binding.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/numerical_policy_binding.py', 'sha256': '9fdccf0c1009e8f6a6231133acc339a9bee0f5b46424b2db302c43b203bfe34e'}, 'unit_output_verification.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_output_verification.py', 'sha256': 'f0740557d5ede17a61c9bd18985bf9281e848582715b3ecfae3dc31f895938af'}, 'unit_selection.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/evaluation-only-restart-55/unit_selection.py', 'sha256': '3e32fa0760b76a1043b15064111feac3f80ec9f0497897a22fce1ade5dbe424d'}, 'freeze_target_heldout.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/phase2-orchestration/freeze_target_heldout.py', 'sha256': 'a7b71e945796bb88ab3cfbdaa94943216f4dc7e538c875fa867c186fe4421673'}, 'prepare_downstream.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/phase2-orchestration/prepare_downstream.py', 'sha256': '3a2d708bf0316da960607a2dac97564f9adcd2a2b169ca50fa5d7a001eb679ec'}, 'prepare_training_inputs.py': {'path': '/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/phase2-orchestration/prepare_training_inputs.py', 'sha256': 'd5199d6bb9eb45aa91e94c042d28b52172f7bc8220006d639d7f0662165cdc05'}}

def require(v,message):
    if not v:raise ValueError(message)
def sha(path):
    with Path(path).open("rb") as stream:return hashlib.file_digest(stream,"sha256").hexdigest()
def checked(ref):
    require(type(ref) is dict and set(ref)=={"path","sha256"},"exact FileRef")
    p=Path(ref["path"])
    require(p.is_absolute() and p.is_file() and not any(x.is_symlink() for x in (p,*p.parents)),"absolute nonsymlink artifact")
    require(re.fullmatch(r"[a-f0-9]{64}",ref["sha256"]) is not None and sha(p)==ref["sha256"],"artifact bytes changed")
    return p
def ref(path):
    p=Path(path);return {"path":str(p),"sha256":sha(p)}
def read(path):return json.loads(Path(path).read_text())
def finite(value):return type(value) in (int,float) and math.isfinite(value)

def load_module(name, source, functions=None):
    path=checked(source)
    old=sys.modules.get(name)
    require(old is None,"verifier alias already loaded: "+name)
    if functions is None:
        spec=importlib.util.spec_from_file_location(name,path)
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module
        spec.loader.exec_module(module)
    else:
        # Original function bodies and source locations are retained exactly.
        tree=ast.parse(path.read_text());selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in functions]
        require({n.name for n in selected}==set(functions),"exact original function set")
        module=types.ModuleType(name);module.__file__=str(path)
        module.__dict__.update(Path=Path,PurePosixPath=PurePosixPath,json=json,hashlib=hashlib,
          zipfile=zipfile,Decimal=Decimal,ROUND_CEILING=ROUND_CEILING,ROUND_FLOOR=ROUND_FLOOR)
        sys.modules[name]=module
        exec(compile(ast.Module(body=selected,type_ignores=[]),str(path),"exec"),module.__dict__)
    require(sha(path)==source["sha256"],"verifier source changed during import")
    return module


def current_numerical_inputs(context, binding):
    """Prove the hardware-only precision derivative and explicit current serving projection."""
    import path_projection
    require(context["scienceSourceDirectory"] == CURRENT_SCIENCE_ROOT, "exact current scientific source root")
    owner_ref=context["currentQualification"];owner=read(checked(owner_ref))
    require(owner.get("kind")=="acephale-aws-operational-qualification-owner-v1"
      and owner.get("completed") is True and owner.get("ownedProcessesDrained") is True
      and owner.get("failureType") is None and owner.get("drainErrors")==[]
      and owner.get("scientificUnitClaimed") is False, "actual successful operational qualification owner")
    result=owner.get("result")
    require(type(result) is dict and result.get("kind")=="acephale-aws-original-serving-qualification-v1"
      and result.get("completed") is True and result.get("sourceCommit")==SCIENCE
      and result.get("originalNumericalGateUnchanged") is True
      and result.get("originalScientificUnitsChanged") is False
      and result.get("scientificUnitClaimed") is False, "actual original serving qualification result")
    require(all(result.get(k)==v for k,v in
      {"leaseId":context["resourceAttemptId"],"instanceId":context["instanceId"],"occurrenceId":context["occurrenceId"]}.items()),
      "qualification belongs to current owner and original occurrence")
    precision_ref=context["currentPrecisionSource"];hardware_ref=context["hardwareBinding"]
    require(result.get("actualPrecisionSource")==precision_ref and result.get("hardwareBinding")==hardware_ref
      and owner.get("deployment")==result.get("deployment"), "qualification source and deployment refs")
    hardware=read(checked(hardware_ref));association_ref=hardware["association"];association=read(checked(association_ref))
    deployment_ref=owner["deployment"];deployment=read(checked(deployment_ref))
    require(deployment.get("kind")=="acephale-aws-current-deployment-v1"
      and deployment.get("schemaVersion")==1 and deployment.get("authorityStatus")=="active"
      and deployment.get("purpose")=="operational_qualification_only" and deployment.get("sourceCommit")==SCIENCE
      and deployment.get("association")==association_ref, "exact active qualification deployment")
    identity={"leaseId":context["resourceAttemptId"],"instanceId":context["instanceId"],"hardDeadline":context["hardDeadline"]}
    require(all(all(value.get(k)==v for k,v in identity.items()) for value in (hardware,association,deployment))
      and association.get("schemaVersion")==1 and association.get("provider")=="aws"
      and association.get("accountId")=="971290362335" and association.get("region") in ("us-east-1","us-east-2","us-west-2")
      and association.get("controllerInstanceId")=="i-044c091a163a723bc"
      and association.get("attemptId")==context["resourceAttemptId"] and association.get("scientificUnitClaimed") is False
      and deployment.get("resourceAttemptId")==context["resourceAttemptId"], "current AWS association identity")
    helper=load_module("aws_closure_hardware_compatibility",HARDWARE_HELPER)
    try:
        profile=helper.profile_from_binding(hardware)
        require(association.get("instanceType")==profile["instanceType"],"hardware instance type association")
        expected=helper.derive_precision(checked(binding["serving_precision.py"]).read_bytes(),profile["gpuNameContains"])
        require(checked(precision_ref).read_bytes()==expected,"exact two-assignment hardware precision derivative")
    finally:
        sys.modules.pop("aws_closure_hardware_compatibility",None)
    checked(HARDWARE_HELPER)
    root=Path(context["runRoot"]).resolve();occurrence=context["occurrenceId"]
    projection_ref=context["servingProjection"];projection_path=checked(projection_ref)
    require(projection_path==root/("aws-serving-projection-"+occurrence+".json"),"exact serving projection origin")
    projection=read(projection_path)
    require(projection.get("kind")=="acephale-aws-serving-projection-v1"
      and projection.get("qualificationOwner")==owner_ref and projection.get("actualPrecisionSource")==precision_ref
      and projection.get("hardwareBinding")==hardware_ref and projection.get("deployment")==deployment_ref
      and projection.get("originalWindowsCompletion") is False,"explicit current serving projection")
    completion_ref=projection["servingCompleted"];completion_path=checked(completion_ref)
    serving=root/("serving-"+occurrence+"-stage")/"verified/serving"
    require(completion_path==serving/"serving-completed.json","exact projected serving completion path")
    expected_body={**result,"awsProjection":{"kind":"acephale-aws-serving-completion-projection-v1",
      "qualificationOwner":owner_ref,"originalWindowsCompletion":False}}
    expected_completion={**expected_body,"contentHash":path_projection.hash_value(expected_body)}
    require(read(completion_path)==expected_completion,"current completion is exact sealed qualified result projection")
    remote_ref=projection["remoteOwnerConfiguration"];remote_path=checked(remote_ref)
    require(remote_path==root/"remote-owner-config.json"
      and all(read(remote_path).get(k)==v for k,v in identity.items()),"current remote owner identity")
    rows=projection.get("copies");require(type(rows) is list and rows,"actual projected source copies")
    refs=[owner_ref,precision_ref,hardware_ref,association_ref,deployment_ref,projection_ref,
      completion_ref,remote_ref,HARDWARE_HELPER,NUMERICAL_SOURCE]
    copied={}
    for row in rows:
        require(type(row) is dict and set(row)=={"source","destination"},"exact source/destination copy record")
        source=checked(row["source"]);destination=checked(row["destination"])
        require(destination.is_relative_to(root) and destination not in copied
          and row["source"]["sha256"]==row["destination"]["sha256"],"unique same-byte serving copy inside run root")
        copied[destination]=row["source"];refs.extend((row["source"],row["destination"]))
    expected_copies={}
    remote_base=PurePosixPath(SERVING_ARTIFACTS_ROOT+"/serving-"+occurrence)
    for name in ("numericalPolicy","effectiveCompose","tunedConfig","numericalAttestation","diagnosticReceipt"):
        remote=PurePosixPath(result[name+"Path"])
        require(remote.is_absolute() and ".." not in remote.parts and remote.is_relative_to(remote_base),"exact original serving archive source")
        expected_copies[serving/str(remote.relative_to(remote_base))]={"path":str(remote),"sha256":result[name+"Sha256"]}
    for name,relative in (("inventory","inventory-after/inventory-evidence.json"),("deployment","inventory-after/observed-deployment.json")):
        expected_copies[serving/relative]={"path":result[name+"Path"],"sha256":result[name+"Sha256"]}
    expected_copies[root/("serving-"+occurrence+"-stage")/"verified/qualification/native-lora-proof.json"]={
      "path":result["proofPath"],"sha256":result["proofSha256"]}
    diagnostic=read(checked({"path":result["diagnosticReceiptPath"],"sha256":result["diagnosticReceiptSha256"]}))
    for variant in ("baseline","configured"):
        remote=PurePosixPath(diagnostic[variant+"ReportPath"])
        require(remote.is_absolute() and ".." not in remote.parts and remote.is_relative_to(remote_base),"exact original diagnostic source")
        expected_copies[serving/str(remote.relative_to(remote_base))]={"path":str(remote),"sha256":diagnostic[variant+"ReportSha256"]}
    require(all(copied.get(path)==source for path,source in expected_copies.items()),"complete exact numerical source-to-archive mapping")
    for source in refs:checked(source)
    return precision_ref,refs

@contextlib.contextmanager
def original_modules(binding, science_root, precision_source=None):
    root=Path(science_root).resolve();library=root/"research/acephale/src"
    require(library.is_dir(),"actual frozen scientific Python tree")
    for relative,digest in SCIENTIFIC_MODULES.items():checked({"path":str(root/relative),"sha256":digest})
    for name,module in list(sys.modules.items()):
        if name=="acephale" or name.startswith("acephale."):
            require(False,"scientific modules must load fresh in isolated verifier process")
    old_path=list(sys.path);old_modules=set(sys.modules)
    names=("unit_lifecycle","unit_native_stage_owner","unit_replay_verification",
           "serving_precision","numerical_policy_binding","aws_original_output_verification","aws_original_selection",
           "prepare_downstream","prepare_training_inputs","aws_original_selector")
    try:
        sys.path.insert(0,str(library))
        load_module("unit_lifecycle",binding["unit_lifecycle.py"],["require"])
        owner=load_module("unit_native_stage_owner",binding["unit_native_stage_owner.py"],["require","read","sha","verify_completion","slot_accounting"])
        replay=load_module("unit_replay_verification",binding["unit_replay_verification.py"])
        precision=load_module("serving_precision",precision_source or binding["serving_precision.py"])
        numerical=load_module("numerical_policy_binding",NUMERICAL_SOURCE)
        output=load_module("aws_original_output_verification",binding["unit_output_verification.py"])
        selection=load_module("aws_original_selection",binding["unit_selection.py"],["remaining_from_report","validate_selection","verify_export"])
        selection.__dict__.update(require=require,read=read,ref=ref,checked=checked)
        yield types.SimpleNamespace(owner=owner,replay=replay,precision=precision,numerical=numerical,output=output,selection=selection)
        for name,module in list(sys.modules.items()):
            if name=="acephale" or name.startswith("acephale."):
                path=getattr(module,"__file__",None)
                if path:
                    absolute=Path(path).resolve();require(absolute.is_relative_to(library),"foreign scientific module origin")
                    relative=absolute.relative_to(root).as_posix()
                    require(relative in SCIENTIFIC_MODULES and sha(absolute)==SCIENTIFIC_MODULES[relative],"changed scientific module bytes")
    finally:
        sys.path[:]=old_path
        for name in list(sys.modules):
            if name not in old_modules and (name in names or name=="acephale" or name.startswith("acephale.")):
                sys.modules.pop(name,None)

def phase_evidence(context):
    rows=context["scientificPhaseReceipts"]
    require(type(rows) is list and rows,"actual scientific phase receipts required")
    seen=set();refs=[]
    for row in rows:
        dispatch=read(checked(row["dispatch"]));result=read(checked(row["result"]))
        require(dispatch["kind"]=="acephale-aws-owned-process-dispatch-v1" and result["kind"]=="acephale-aws-owned-process-result-v1","actual AWS owner receipts")
        for key,expected in (("unitId",context["unitId"]),("attemptId",context["unitAttemptId"]),
          ("leaseId",context["resourceAttemptId"]),("instanceId",context["instanceId"]),
          ("inputSha256",context["inputSha256"]),("sourceCommit",SCIENCE)):
            require(dispatch.get(key)==result.get(key)==expected,"phase identity "+key)
        require(dispatch["automaticRetry"] is False and result["childCreated"] is True,"actual nonretried child")
        require(dispatch["command"]==result["argv"] and dispatch["cwd"]==result["cwd"],"exact executed command")
        require(result["completed"] is True and result["exitCode"]==0 and result["drained"] is True and result["localOwnedProcessesDrained"] is True,"phase did not complete and drain")
        require(type(result["gateCalls"]) is int and result["gateCalls"]>=2,"before and after provider gates")
        require(finite(result["startedAt"]) and finite(result["finishedAt"]) and result["startedAt"]<=result["finishedAt"]<=context["hardDeadline"],"phase timing")
        require(finite(result["maximumSeconds"]) and 0<result["maximumSeconds"]<=28800,"finite original phase bound")
        require(row["result"]["path"] not in seen,"duplicate phase result")
        seen.add(row["result"]["path"]);refs.extend([row["dispatch"],row["result"]])
        for item in result["logs"]:checked(item);refs.append(item)
    return refs

COMPLETION_HELPER={'path': '/srv/acephale/workspaces/operator/opportunity-preparation-completion-01/complete_preparation.py', 'sha256': 'f3628d8c0f791ea6fc4df53a2927077093dc5382a3fe19923fc6c5307111f530'}

def preparation_completion_coverage(context,job,expected):
    authority_ref=context.get("operationalContinuation")
    if authority_ref is None:return expected
    fixed_root=Path("/srv/acephale/attempts/unit-b8dae1aff90e4b838cb08b973c6e6ec6")
    require(context["unitId"]=="seed17/opportunity" and context["unitAttemptId"]=="unit-b8dae1aff90e4b838cb08b973c6e6ec6"
      and Path(context["attemptOutput"])==fixed_root,"Only the exact preserved opportunity attempt")
    p=checked(authority_ref);stat=p.stat();a=read(p)
    require(p==Path("/srv/acephale/artifacts/seed17-opportunity-continuation-02.json")
      and stat.st_uid==0 and stat.st_mode&0o022==0,"Exact root generation02 authority")
    require(a.get("kind")=="acephale-aws-pre-science-operational-continuation-v1"
      and a.get("approved")is True and a.get("authorityStatus")=="active" and a.get("generation")=="02"
      and a.get("parentAuthority")=={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-01.json","sha256":"038f0a1cfd5987f586509602875744b7be0e405ee702fb0ae32d9d05c33c42ca"},"Explicit generation lineage")
    checked(a["parentAuthority"])
    for key,value in {"unitId":"seed17/opportunity","unitAttemptId":"unit-b8dae1aff90e4b838cb08b973c6e6ec6",
      "resourceAttemptId":"cap-7bbb0f23-5f46-4dca-848c-41f37ad02883","instanceId":"i-06e316e5f1954f51b",
      "inputSha256":"2d22c77ae0536d9257e329526b5c0e4cec0563ee96fdfb66e68179527ae5068d",
      "hardDeadline":1795336350,"sourceCommit":SCIENCE}.items():
        require(a.get(key)==context.get(key)==value,"Unchanged generation phase identity "+key)
    require(a.get("accountId")=="971290362335" and a.get("workerRegion")=="us-east-2"
      and all(a.get(k)is False for k in ("scientificMeasurementPreviouslyDispatched","scientificSettingsChanged","scientificAttemptReissued","originalFailureReclaimed")),"No prior measurements or new scientific attempt")
    require(a.get("preparationCompletion")==COMPLETION_HELPER,"Exact reviewed preparation helper");checked(COMPLETION_HELPER)
    require(context["job"]==ORIGINAL_JOBS["seed17/opportunity"] and read(checked(context["job"]))==job,"Exact original job")
    original=[(str(fixed_root/"01-prepare/process/dispatch.json"),str(fixed_root/"01-prepare/process/result.json")),
      (str(fixed_root/"02-measure-and-aggregate/process/dispatch.json"),str(fixed_root/"02-measure-and-aggregate/process/result.json"))]
    require(expected==original,"Exactly the original two opportunity phases")
    failed=read(checked({"path":original[0][1],"sha256":"cd461fb7264c0fff66aabafd0d2a3ad793241b97f45ad91d272d9d5a5e602071"}))
    checked({"path":original[0][0],"sha256":"62bc2f50fa232c8bf5d89c2a75daab302f8eca9e9af2ec2941c8488c7872a75a"})
    require(failed.get("completed")is False and failed.get("exitCode")==1 and failed.get("drained")is True
      and failed.get("localOwnedProcessesDrained")is True and failed.get("providerWatcherDrained")is True,"Preserved failed metadata phase drained")
    current=fixed_root/"operational-generations/02/preparation-completion-process"
    first=context["scientificPhaseReceipts"][0]
    require(first["dispatch"]["path"]==str(current/"dispatch.json") and first["result"]["path"]==str(current/"result.json"),"Exact new metadata child receipts")
    dispatch=read(checked(first["dispatch"]))
    configuration=fixed_root/"01-prepare/configuration.json"
    checked({"path":str(configuration),"sha256":"d0d87f1d12a8e6cfbc174140989e3f8b2a6e7332f774e113342574f172c7134d"})
    value=read(configuration)
    require(dispatch["command"]==[value["analysisPython"],COMPLETION_HELPER["path"],"--authority",authority_ref["path"],"--sha256",authority_ref["sha256"],
      "--configuration",str(configuration),"--output",str(fixed_root/"01-prepare/prepared")]
      and dispatch["cwd"]==value["sourceDirectory"] and dispatch["maximumSeconds"]==job["steps"][0]["preparer"]["maximumSeconds"],"Exact bounded metadata completion command")
    preparation=read(fixed_root/"01-prepare/prepared/preparation.json")
    require(preparation.get("operationalPreparationCompletion")==authority_ref
      and preparation.get("retainedPreparationPrefixUnchanged")is True and preparation.get("priorMeasurementExecuted")is False,"Truthful completed preparation lineage")
    return [(str(current/"dispatch.json"),str(current/"result.json")),*expected[1:]]


def operational_phase_coverage(context,job,expected):
    reference=context.get("operationalContinuation")
    if reference is None or reference["path"]!="/srv/acephale/artifacts/seed17-opportunity-continuation-03.json":
        return preparation_completion_coverage(context,job,expected)
    p=checked(reference);st=p.stat();a=read(p)
    parent={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-02.json","sha256":"c984ff38e987acda54b6032e265776a332f85067a26053255dc8fc190abec8ef"}
    require(st.st_uid==0 and st.st_mode&0o022==0 and a.get("kind")=="acephale-aws-pre-science-operational-continuation-v1"
      and a.get("authorityStatus")=="active" and a.get("approved")is True and a.get("generation")=="03" and a.get("parentAuthority")==parent,"Exact root third-generation authority")
    prior=read(checked(parent))
    for key in ("unitId","unitAttemptId","resourceAttemptId","instanceId","inputSha256","sourceCommit","hardDeadline"):
        require(a.get(key)==prior.get(key)==context.get(key),"Same permanent assignment and deadline "+key)
    require(a.get("unitAttemptId")=="unit-b8dae1aff90e4b838cb08b973c6e6ec6" and a.get("unitId")=="seed17/opportunity"
      and a.get("workerRegion")=="us-east-2" and a.get("accountId")=="971290362335"
      and a.get("recoveryNativePython")=="/srv/acephale/workspaces/report/locked-environments-03/tau3/bin/python"
      and a.get("priorProfileDispatched")is True and a.get("priorNativeModelRequestsDispatched")is False
      and a.get("failedPreModelMeasurementsRetained")==20 and a.get("scientificSettingsChanged")is False
      and a.get("scientificAttemptReissued")is False and a.get("originalFailureReclaimed")is False,"Only exact pre-model native environment repair")
    failure=a.get("previousFailedResult",{})
    require(failure.get("sha256")=="c39b25d023ffefebcb09cc9652eeb9a9a6a73241eca1720043255ffd171c72a3"
      and failure.get("key")=="results/seed17-opportunity/unit-b8dae1aff90e4b838cb08b973c6e6ec6/operational-generations/02/result.json"
      and failure.get("versionId")=="EkH5PbEpkiRhhLst59oe9lDV5RYMf5h1","Actual immutable generation02 failed result retained by root authority")
    oldcontext=dict(context);oldcontext["operationalContinuation"]=parent
    result=preparation_completion_coverage(oldcontext,job,expected)
    root=Path(context["attemptOutput"]);old=root/"01-prepare/prepared";new=root/"operational-generations/03/prepared"
    for name in ("manifest.json","configuration.json","guard.json"):
        require((new/name).is_file() and not any(x.is_symlink()for x in(new/name,*(new/name).parents))
          and (new/name).read_bytes()==(old/name).read_bytes(),"Unchanged original prepared "+name)
    previous=read(old/"experiment.json");current=read(new/"experiment.json")
    projected=json.loads(json.dumps(previous))
    require([x["id"]for x in projected["stages"]]==["profile","aggregate"],"Exact original opportunity stage order")
    projected["stages"][0]["command"][0]=a["recoveryNativePython"]
    command=projected["stages"][1]["command"];index=command.index("--measurements")+1
    require(command[index]==str(old/"run/profile/artifacts/measurements.json"),"Original aggregate input location")
    command[index]=str(new/"run/profile/artifacts/measurements.json")
    require(current==projected,"Only native Python and original aggregation output location may change")
    before=read(old/"preparation.json");after=read(new/"preparation.json")
    require(after.get("operationalPreparationRecovery")==reference,"Explicit metadata recovery receipt")
    clean={k:v for k,v in after.items()if k not in ("contentHash","experimentHash","operationalPreparationRecovery")}
    require(clean=={k:v for k,v in before.items()if k not in ("contentHash","experimentHash")},"All original preparation facts retained")
    return [result[0],(str(root/"operational-generations/03/02-measure-and-aggregate/process/dispatch.json"),
      str(root/"operational-generations/03/02-measure-and-aggregate/process/result.json"))]

def operational_phase_coverage04(context,job,expected):
    reference=context.get("operationalContinuation")
    if reference is None or reference["path"]!="/srv/acephale/artifacts/seed17-opportunity-continuation-04.json":
        return operational_phase_coverage(context,job,expected)
    p=checked(reference);st=p.stat();a=read(p)
    parent={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-03.json","sha256":"77120d7e815f4daa0b5f28a8e1112dacda6a330d79dc66e54f4afb0724a34301"}
    require(st.st_uid==0 and st.st_mode&0o022==0 and a.get("kind")=="acephale-aws-pre-science-operational-continuation-v1"
      and a.get("authorityStatus")=="active" and a.get("approved")is True and a.get("generation")=="04" and a.get("parentAuthority")==parent,"Exact root fourth-generation authority")
    prior=read(checked(parent))
    for key in ("unitId","unitAttemptId","resourceAttemptId","instanceId","inputSha256","sourceCommit","hardDeadline"):
        require(a.get(key)==prior.get(key)==context.get(key),"Same permanent assignment and deadline "+key)
    require(a.get("unitAttemptId")=="unit-b8dae1aff90e4b838cb08b973c6e6ec6" and a.get("unitId")=="seed17/opportunity"
      and a.get("workerRegion")=="us-east-2" and a.get("accountId")=="971290362335"
      and a.get("recoveryNativePython")=="/srv/acephale/workspaces/operator/native-profile-environment-04/venv/bin/python"
      and a.get("priorProfileDispatched")is True and a.get("priorNativeModelRequestsDispatched")is False
      and a.get("failedPreModelMeasurementsRetained")==20 and a.get("scientificSettingsChanged")is False
      and a.get("scientificAttemptReissued")is False and a.get("originalFailureReclaimed")is False,"Only exact pre-model native environment repair")
    failure=a.get("previousFailedResult",{})
    require(failure.get("sha256")=="729a17fd0d31f0d56ccf6a6878f4665b149ffe5af1d47e0b7f647d47255fdbec"
      and failure.get("key")=="results/seed17-opportunity/unit-b8dae1aff90e4b838cb08b973c6e6ec6/operational-generations/03/result.json"
      and failure.get("versionId")==".7emr8FHXn5h34BmHflEQJxVG6VkiOh.","Actual immutable generation03 failed result retained by root authority")
    oldcontext=dict(context);oldcontext["operationalContinuation"]={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-02.json","sha256":"c984ff38e987acda54b6032e265776a332f85067a26053255dc8fc190abec8ef"}
    result=preparation_completion_coverage(oldcontext,job,expected)
    root=Path(context["attemptOutput"]);old=root/"01-prepare/prepared";new=root/"operational-generations/04/prepared"
    for name in ("manifest.json","configuration.json","guard.json"):
        require((new/name).is_file() and not any(x.is_symlink()for x in(new/name,*(new/name).parents)),"Regular complete metadata graph "+name)
    require((new/"manifest.json").read_bytes()==(old/"manifest.json").read_bytes(),"Original inventory/manifest bytes unchanged")
    config=read(old/"configuration.json");projected_config=json.loads(json.dumps(config))
    projected_config["manifestPath"]=str(new/"manifest.json");projected_config["splitGuardPath"]=str(new/"guard.json")
    require(read(new/"configuration.json")==projected_config,"Only projected configuration file edges")
    guard=read(old/"guard.json");projected_guard=json.loads(json.dumps(guard));projected_guard["configurationPath"]=str(new/"configuration.json")
    require(read(new/"guard.json")==projected_guard,"Only projected guard configuration edge")
    previous=read(old/"experiment.json");current=read(new/"experiment.json")
    projected=json.loads(json.dumps(previous))
    require([x["id"]for x in projected["stages"]]==["profile","aggregate"],"Exact original opportunity stage order")
    projected["stages"][0]["command"][0]=a["recoveryNativePython"]
    command=projected["stages"][0]["command"];index=command.index("--config")+1
    require(command[index]==str(old/"configuration.json"),"Original profile configuration edge")
    command[index]=str(new/"configuration.json")
    replacements={str(old/name):ref(new/name)for name in ("manifest.json","configuration.json","guard.json")}
    for key,value in projected["inputs"].items():
        if value["path"]in replacements:projected["inputs"][key]=replacements[value["path"]]
    command=projected["stages"][1]["command"];index=command.index("--measurements")+1
    require(command[index]==str(old/"run/profile/artifacts/measurements.json"),"Original aggregate input location")
    command[index]=str(new/"run/profile/artifacts/measurements.json")
    require(current==projected,"Only operational interpreter and exact complete metadata path graph may change")
    before=read(old/"preparation.json");after=read(new/"preparation.json")
    require(after.get("operationalPreparationRecovery")==reference,"Explicit metadata recovery receipt")
    clean={k:v for k,v in after.items()if k not in ("contentHash","experimentHash","configurationHash","inputs","operationalPreparationRecovery")}
    require(clean=={k:v for k,v in before.items()if k not in ("contentHash","experimentHash","configurationHash","inputs")},"All original preparation facts retained")
    require(after["inputs"]==current["inputs"],"Preparation binds the exact projected input graph")
    relative="research/acephale/src/acephale/contracts_v1.py"
    contract=checked({"path":str(Path(CURRENT_SCIENCE_ROOT)/relative),"sha256":SCIENTIFIC_MODULES[relative]})
    tree=ast.parse(contract.read_text());functions=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ("canonical_v1","hash_v1")]
    require(len(functions)==2,"Exact original hash functions")
    import rfc8785
    namespace={"math":math,"hashlib":hashlib,"rfc8785":rfc8785}
    exec(compile(ast.Module(body=functions,type_ignores=[]),str(contract),"exec"),namespace)
    hash_v1=namespace["hash_v1"]
    require(after["configurationHash"]==hash_v1(projected_config)and after["experimentHash"]==hash_v1(current)
      and after["contentHash"]==hash_v1({k:v for k,v in after.items()if k!="contentHash"}),"Original hash functions bind projected configuration/experiment/preparation")

    return [result[0],(str(root/"operational-generations/04/02-measure-and-aggregate/process/dispatch.json"),
      str(root/"operational-generations/04/02-measure-and-aggregate/process/result.json"))]

def operational_phase_coverage05(context,job,expected):
    reference=context.get("operationalContinuation")
    if reference is None or reference.get("path")!="/srv/acephale/artifacts/seed17-opportunity-continuation-05.json":
        return operational_phase_coverage04(context,job,expected)
    p=checked(reference);st=p.stat();a=read(p)
    parent={"path":"/srv/acephale/artifacts/seed17-opportunity-continuation-04.json","sha256":"29ddf1473ed480dd20ea5eeffd7f9d8b7359c11079f0cb6b1b8f6de1311f1ecf"}
    require(st.st_uid==0 and st.st_mode&0o022==0 and a.get("kind")=="acephale-aws-pre-science-operational-continuation-v1"
      and a.get("approved")is True and a.get("authorityStatus")=="active"and a.get("generation")=="05"and a.get("parentAuthority")==parent,"Exact root generation05 namespace authority")
    prior=read(checked(parent))
    for key in ("unitId","unitAttemptId","resourceAttemptId","instanceId","inputSha256","sourceCommit","hardDeadline"):
        require(a.get(key)==prior.get(key)==context.get(key),"Same permanent namespace recovery assignment "+key)
    require(a["unitId"]=="seed17/opportunity"and a["unitAttemptId"]=="unit-b8dae1aff90e4b838cb08b973c6e6ec6"
      and a.get("priorNativeEvidenceFailedBeforeProfile")is True and a.get("retainedAdmittedPreparation")is True
      and a.get("scientificSettingsChanged")is False and a.get("scientificAttemptReissued")is False
      and a.get("originalFailureReclaimed")is False
      and a.get("operationalStageId")=="native-"+hashlib.sha256(a["unitAttemptId"].encode()).hexdigest()[:32]+"-op05","Only exact fresh evidence namespace")
    failure=a.get("previousFailedResult",{})
    require(failure.get("key")=="results/seed17-opportunity/unit-b8dae1aff90e4b838cb08b973c6e6ec6/operational-generations/04/result.json"
      and failure.get("sha256")=="f32f0700abf0fb594a15ffe62596b012471884892a5aab4aa3bcc37e173e4e2a"
      and failure.get("versionId")=="LVBOzNPy8Fo8C1Pm_.5cPzReJLl_hUac","Actual failed generation04 retained")
    retained=dict(context);retained["operationalContinuation"]=parent
    result=operational_phase_coverage04(retained,job,expected)
    root=Path(context["attemptOutput"])
    return [result[0],(str(root/"operational-generations/05/02-measure-and-aggregate/process/dispatch.json"),
      str(root/"operational-generations/05/02-measure-and-aggregate/process/result.json"))]

def phase_coverage(context,job):
    root=Path(context["attemptOutput"])
    require(root.is_absolute() and root.is_dir() and not any(p.is_symlink() for p in (root,*root.parents)),"actual attempt output")
    expected=[];previous=None
    for number,step in enumerate(job["steps"],1):
        directory=root/f'{number:02d}-{step["id"]}'
        if "preparer" in step:
            previous=directory/"prepared"
            owners=[directory/"process"]
        elif step.get("commandsArtifact"):
            require(previous is not None,"original command producer first")
            commands=read(previous/step["commandsArtifact"])["commands"]
            require([r["id"] for r in commands]==step["exactOrder"],"original command phase order")
            owners=[directory/r["id"] for r in commands]
        else:owners=[directory/"process"]
        expected.extend((str(owner/"dispatch.json"),str(owner/"result.json")) for owner in owners)
    expected=operational_phase_coverage05(context,job,expected)
    actual=[(r["dispatch"]["path"],r["result"]["path"]) for r in context["scientificPhaseReceipts"]]
    require(actual==expected,"all original phases exactly once in original order")

def verify_projection(lineage_ref, expected_original, projected_ref):
    from path_projection import transform
    value=read(checked(lineage_ref))
    require(value["kind"]=="acephale-aws-paired-receipt-path-projection-lineage-v1" and value["original"]==expected_original and value["derived"]==projected_ref,"exact original path-projection lineage")
    original=read(checked(expected_original));actual=read(checked(projected_ref))
    reconstructed,changes=transform(original,value["mappings"])
    require(actual==reconstructed and changes==value["changes"] and value["scientificFieldsChanged"] is False and value["originalBytesRewritten"] is False,"only paths and canonical receipt hash may change")

def original_ids(context,job):
    ids=list(context["unitScientificIds"])
    require(len(ids)==len(set(ids)),"unique original scientific IDs")
    if context["unitId"].startswith("development/"):
        require(ids==job["scientificSettings"]["runIds"],"original development IDs/order")
    elif context["unitId"].startswith("heldout/") and context["unitId"]!="heldout/selection":
        selected=read(checked(context["selectedSegments"]))
        parts=[p for p in selected["segments"] if p["predictorTrainingSeed"]==job["predictorTrainingSeed"]]
        require(len(parts)==1 and ids==[r["runId"] for r in parts[0]["runs"]],"exact frozen selected IDs")
        original=job["scientificSettings"]["runIds"]
        require(ids==[i for i in original if i in set(ids)],"heldout original identities/order")
        closure=read(checked(context["selectionClosure"]))
        require(closure["unitId"]=="heldout/selection" and closure["originalValidatorsPassed"] is True and closure["outputs"]["segments"]==context["selectedSegments"],"accepted actual selection provenance")
    return ids

def selection_verify(context,modules,binding):
    output={"outputs":context["outputs"]};root=Path(context["runRoot"])
    cfg=read(checked(output["outputs"]["selectionConfiguration"]))
    evidence=context["selectionInputs"]
    # This replaces Windows owner-location plumbing only; original sizing, arithmetic,
    # development failure accounting and exact archive verifiers run unchanged.
    for name in ("developmentSegments","targetSegments"):
        verify_projection(evidence[name+"Lineage"],evidence["original"+name[0].upper()+name[1:]],evidence[name])
    cohorts=[]
    for unit,key in (("development/1","development1Closure"),("development/2","development2Closure")):
        closed=read(checked(evidence[key]))
        require(closed["kind"]=="acephale-aws-component-closure-v1" and closed["unitId"]==unit and closed["originalValidatorsPassed"] is True and closed["failedTrialsRetained"] is True and closed["scientificProtocolChanged"] is False,"actual closed original development")
        cohorts.append(closed["outputs"]["cohortReceipt"]);checked(cohorts[-1])
    report=read(checked(output["outputs"]["budgetReport"]))
    remaining=modules.selection.remaining_from_report(report,238000000)
    expected={"sourceDirectory":context["scienceSourceDirectory"],"developmentSegmentsReceiptPath":evidence["developmentSegments"]["path"],
      "targetSegmentsReceiptPath":evidence["targetSegments"]["path"],"developmentCohortReceipts":cohorts,"remainingHeldoutMicrodollars":remaining}
    require(cfg==expected,"selection must use closed development and actual original budget arithmetic")
    # Imported selector definitions perform no preparation or dispatch here.
    selector_parent=Path(binding["freeze_target_heldout.py"]["path"]).parent
    sys.path.insert(0,str(selector_parent))
    parent=load_module("prepare_downstream",binding["prepare_downstream.py"],["require","schedule_segments"])
    from acephale.contracts_v1 import hash_v1
    from acephale.native_study import validate_schedule
    parent.__dict__.update(hash_v1=hash_v1,validate_schedule=validate_schedule)
    selector=load_module("aws_original_selector",binding["freeze_target_heldout.py"])
    result=modules.selection.validate_selection(selector,cfg,checked(output["outputs"]["selection"]).parent)
    modules.selection.verify_export(root,output)
    # Require budget/selection receipts to be members of independently checked actual phases.
    pairs={(r["dispatch"]["path"],r["result"]["path"]) for r in context["scientificPhaseReceipts"]}
    for label in ("budget","selection"):
        require((output["outputs"][label+"Dispatch"]["path"],output["outputs"][label+"Result"]["path"]) in pairs,"actual sizing/accounting execution receipts")
    return {"verified":True,"selectionHash":result["contentHash"],"outputArchiveVerified":True}


PARENT_CLOSURE_SOURCE={'path':'/srv/acephale/workspaces/review/scientific-closure-02/closure_adapter.py','sha256':'716988c9a4bebd275aaab7b14c8e107f623ec05e2c958092ef4314f61ec47a25'}

def decode_claim_attribute(value):
    require(type(value) is dict and len(value)==1,"exact DynamoDB AttributeValue")
    kind,item=next(iter(value.items()))
    if kind=="S":
        require(type(item) is str,"claim string");return item
    if kind=="BOOL":
        require(type(item) is bool,"claim boolean");return item
    if kind=="NULL":
        require(item is True,"claim null");return None
    if kind=="N":
        require(type(item) is str,"claim number")
        number=Decimal(item);require(number.is_finite(),"finite claim number")
        decoded=int(number) if number==number.to_integral_value() else float(number)
        require(type(decoded) is int or math.isfinite(decoded),"finite decoded claim number");return decoded
    if kind=="L":
        require(type(item) is list,"claim list");return [decode_claim_attribute(x) for x in item]
    if kind=="M":
        require(type(item) is dict and all(type(k) is str for k in item),"claim map")
        return {k:decode_claim_attribute(v) for k,v in item.items()}
    raise ValueError("Unsupported permanent claim attribute type")

def historical_replay_numerical_inputs(context,binding):
    """Read exact closed GPU replay evidence while retaining the distinct current CPU owner."""
    require(context["unitId"]=="seed29/analysis" and context["instanceId"]=="i-044c091a163a723bc",
      "historical replay bridge only for original seed29 analysis on the existing CPU controller")
    history=context["historicalReplay"]
    require(type(history) is dict and set(history)=={"componentClosure","verificationContext","workerResult","succeededClaim"},
      "exact observed historical replay dependency references")
    for item in history.values():checked(item)
    snapshot_path=checked(history["succeededClaim"]);status=snapshot_path.stat()
    require(status.st_uid==0 and status.st_mode&0o022==0,"root-owned non-writable observed claim")
    observed=read(snapshot_path)
    require(observed.get("kind")=="acephale-aws-observed-dependency-claim-v1"
      and observed.get("table")=="acephale-aws-20261121" and observed.get("region")=="us-east-1"
      and observed.get("consistentRead") is True and finite(observed.get("observedAt")) and observed["observedAt"]>0,
      "explicit actual strongly consistent dependency observation")
    raw=observed["rawItem"]
    require(type(raw) is dict and all(type(k) is str for k in raw),"exact raw permanent claim")
    raw_hash=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()
    require(raw_hash==observed.get("rawItemSha256"),"raw observed claim hash")
    claim={k:decode_claim_attribute(v) for k,v in raw.items()}
    require(claim==observed.get("item"),"decoded claim equals exact raw observed attributes")
    require(claim.get("pk")=="unit#seed29/replay" and claim.get("status")=="succeeded"
      and claim.get("permanent") is True and claim.get("sourceCommit")==SCIENCE,
      "actual permanent succeeded original replay dependency")
    worker=read(checked(history["workerResult"]));closure=read(checked(history["componentClosure"]))
    previous=read(checked(history["verificationContext"]))
    require(claim.get("resultSha256")==history["workerResult"]["sha256"]
      and type(claim.get("resultKey")) is str and bool(claim["resultKey"]),
      "permanent claim binds the actual worker result bytes")
    require(worker.get("kind")=="acephale-aws-unit-worker-result-v1" and worker.get("completed") is True
      and type(worker.get("exitCode")) is int and worker["exitCode"]==0 and worker.get("allChildrenDrained") is True
      and worker.get("componentClosure")==history["componentClosure"]
      and re.fullmatch(r"[a-f0-9]{64}",worker.get("workerSha256","")) is not None,
      "successful drained actual worker and exact component closure")
    identity={"unitId":"seed29/replay","attemptId":claim["attemptId"],"inputSha256":claim["inputSha256"]}
    require(all(all(v.get(k)==expected for k,expected in identity.items()) for v in (worker,closure)),
      "same permanent replay attempt and execution input")
    require(closure.get("kind")=="acephale-aws-component-closure-v1" and closure.get("sourceCommit")==SCIENCE
      and all(closure.get(k) is True for k in ("originalValidatorsPassed","allDeclaredOutputsPresent","allProcessesDrained","failedTrialsRetained"))
      and closure.get("scientificProtocolChanged") is False and closure.get("context")==history["verificationContext"],
      "actual original scientific replay closure and exact verification context")
    require(closure.get("receiptAuthor") in (PARENT_CLOSURE_SOURCE,ref(__file__)),
      "independently reviewed original closure author")
    checked(closure["receiptAuthor"]);checked(closure["originalSources"])
    require(read(checked(closure["originalSources"])).get("sources")==ORIGINAL_SOURCES,"same original scientific sources")
    require(previous.get("kind")=="acephale-aws-component-verification-context-v1"
      and previous.get("unitId")=="seed29/replay" and previous.get("unitAttemptId")==claim["attemptId"]
      and previous.get("inputSha256")==claim["inputSha256"] and previous.get("sourceCommit")==SCIENCE
      and previous.get("job")==ORIGINAL_JOBS["seed29/replay"],"exact historical replay context")
    require(previous.get("resourceAttemptId")==closure.get("resourceAttemptId")==claim.get("leaseId")
      and previous.get("instanceId")==closure.get("instanceId")==claim.get("instanceId")
      and previous.get("resourceAttemptId")!=context["resourceAttemptId"]
      and previous.get("instanceId")!=context["instanceId"],"historical GPU identity stays separate from current CPU")
    require(all(previous.get(k)==context.get(k) for k in ("runRoot","occurrenceId","scienceSourceDirectory"))
      and context["occurrenceId"]=="seed29-01","restore exact original replay root and occurrence")
    require(previous.get("currentQualification",{}).get("sha256")==claim.get("qualificationSha256"),
      "permanent claim pins original GPU qualification")
    historical_hardware=read(checked(previous["hardwareBinding"]))
    require(historical_hardware.get("association",{}).get("sha256")==claim.get("associationSha256"),
      "permanent claim pins original GPU association")
    require(closure.get("scientificPhaseReceipts")==previous.get("scientificPhaseReceipts")
      and closure.get("outputs")==previous.get("outputs")
      and closure.get("currentNumericalProjection")==previous.get("servingProjection"),
      "historical phase/output/numerical references agree")
    durable=worker.get("durableArtifacts")
    require(type(durable) is list and durable,"actual durable worker exports")
    for name in ("componentClosure","verificationContext"):
        item=history[name];matches=[r for r in durable if r.get("path")==item["path"]]
        require(len(matches)==1 and matches[0].get("sha256")==item["sha256"]
          and matches[0].get("versionId") not in (None,"","null")
          and type(matches[0].get("bytes")) is int and matches[0]["bytes"]==checked(item).stat().st_size
          and type(matches[0].get("key")) is str and bool(matches[0]["key"]),
          "exact versioned durable closure/context exports")
    require(type(closure.get("files")) is list and closure["files"],"retained original replay proof closure")
    for item in closure["files"]:checked(item)
    phase_coverage(previous,read(checked(previous["job"])))
    phase_refs=phase_evidence(previous)
    precision,refs=current_numerical_inputs(previous,binding)
    for item in history.values():checked(item)
    return precision,[*history.values(),closure["receiptAuthor"],closure["originalSources"],*closure["files"],*phase_refs,*refs]

def verify(context,binding):
    require(context["kind"]=="acephale-aws-component-verification-context-v1","context schema")
    unit_id=context["unitId"];require(unit_id in REMAINING,"only original nine remaining components")
    require(context["unitAttemptId"]!=context["resourceAttemptId"] and context["sourceCommit"]==SCIENCE,"separate exact scientific/resource identity")
    require(finite(context["hardDeadline"]),"finite original hard deadline")
    require(re.fullmatch(r"[a-f0-9]{64}",context["inputSha256"]) is not None,"actual execution input SHA")
    require(context["job"]==ORIGINAL_JOBS[unit_id],"exact original frozen job bytes/origin")
    job=read(checked(context["job"]))
    require(job["unitId"]==unit_id and job["sourceCommit"]==SCIENCE and job["unitKind"]==REMAINING[unit_id] and job["automaticRetry"] is False,"exact original job")
    require(sha(checked(context["executionInput"]))==context["inputSha256"],"actual prepared execution input")
    phase_coverage(context,job)
    phase_refs=phase_evidence(context)
    outputs=context["outputs"]
    require(type(outputs) is dict and outputs,"exact named original outputs")
    for item in outputs.values():checked(item)
    ids=original_ids(context,job)
    root=Path(context["runRoot"]).resolve()
    require(root.is_dir() and not any(p.is_symlink() for p in (root,*root.parents)),"real run root")
    require(context["occurrenceId"]==job.get("occurrenceId"),"original occurrence")
    lease={"id":context["resourceAttemptId"],"instanceId":context["instanceId"],"deadline":context["hardDeadline"]}
    runtime=types.SimpleNamespace(run_root=root,lease=lambda:lease)
    unit=types.SimpleNamespace(id=unit_id,kind=REMAINING[unit_id],scientific_ids=ids)
    # The unchanged verifier reads this explicitly labeled in-memory phase aggregation.
    # It is not an invented historical single-process receipt or backdated original exit.
    aggregate={"kind":"acephale-aws-verified-scientific-phase-aggregation-v1","unitId":unit_id,
      "exitCode":0,"completed":True,"localOwnedProcessesDrained":True,"phaseReceipts":context["scientificPhaseReceipts"],
      "singleOriginalOuterExitClaimed":False}
    precision_source=None;current_refs=[]
    historical="historicalReplay" in context
    if unit.kind!="heldout-selection":
        precision_source,current_refs=(historical_replay_numerical_inputs(context,binding) if historical else current_numerical_inputs(context,binding))
    else:require(not historical,"selection cannot borrow replay qualification")
    with original_modules(binding,context["scienceSourceDirectory"],precision_source) as modules:
        if unit.kind=="heldout-selection":
            proof=selection_verify(context,modules,binding)
        else:
            original_read=modules.output.read
            sentinel=str(root/".aws-verified-phase-aggregation-never-written")
            require(not Path(sentinel).exists(),"phase aggregation sentinel must not exist")
            modules.output.read=lambda path:aggregate if str(path)==sentinel else original_read(path)
            try:proof=modules.output.verify(runtime,unit,{"occurrenceId":context["occurrenceId"]},{"outputs":outputs},sentinel)
            finally:modules.output.read=original_read
            if unit.kind=="native-segment":
                from acephale.experiment_runner import Experiment
                experiment_path=checked(outputs["nativeExperiment"]);raw=read(experiment_path)
                plan={"experimentPath":experiment_path,"raw":raw,"experiment":Experiment.model_validate(raw),"runIds":ids,"native":read(experiment_path.with_name("configuration.json"))}
                require(checked(outputs["cohortReceipt"])==experiment_path.with_name("run")/"native/artifacts/cohort-receipt.json","actual original cohort receipt")
                actual=modules.owner.slot_accounting(plan)
                owner=read(checked(outputs["ownerReceipt"]))
                require(actual==owner["originalSlotAccounting"] and not actual["missing"] and not actual["malformedLines"] and not actual["unexpectedIds"],"recomputed original slot/failure retention")
    require(proof.get("verified") is True,"original verifiers must pass")
    for item in outputs.values():checked(item)
    phase_evidence(context)
    if unit.kind!="heldout-selection":
        (historical_replay_numerical_inputs(context,binding) if historical else current_numerical_inputs(context,binding))
    files={r["path"]:r for r in [*outputs.values(),*phase_refs,*current_refs,context["job"],context["executionInput"]]}
    return {"kind":"acephale-aws-component-closure-v1","unitId":unit_id,"attemptId":context["unitAttemptId"],
      "resourceAttemptId":context["resourceAttemptId"],"instanceId":context["instanceId"],"inputSha256":context["inputSha256"],
      "sourceCommit":SCIENCE,"originalValidatorsPassed":True,"allDeclaredOutputsPresent":True,
      "allProcessesDrained":True,"failedTrialsRetained":True,"scientificProtocolChanged":False,
      "singleOriginalOuterExitClaimed":False,"scientificPhaseReceipts":context["scientificPhaseReceipts"],
      "phaseCommandOriginAuthority":"reviewed-root-bound-worker-and-original-preparer-orchestration",
      "currentNumericalProjection":None if historical else context.get("servingProjection"),
      **({"historicalReplayDependency":context["historicalReplay"],"historicalNumericalProjection":read(checked(context["historicalReplay"]["verificationContext"]))["servingProjection"]} if historical else {}),
      "originalVerificationResult":proof,"outputs":outputs,"files":[files[k] for k in sorted(files)]}

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--context",required=True);ap.add_argument("--context-sha256",required=True)
    ap.add_argument("--sources",required=True);ap.add_argument("--sources-sha256",required=True);ap.add_argument("--output",required=True)
    a=ap.parse_args()
    cref={"path":a.context,"sha256":a.context_sha256};sref={"path":a.sources,"sha256":a.sources_sha256}
    context=read(checked(cref));binding=read(checked(sref))
    require(binding["kind"]=="acephale-aws-original-closure-source-binding-v1" and binding["sources"]==ORIGINAL_SOURCES,"exact pinned original source binding")
    for source in binding["sources"].values():checked(source)
    result=verify(context,binding["sources"])
    for source in binding["sources"].values():checked(source)
    result.update(context=cref,originalSources=sref,receiptAuthor=ref(__file__))
    out=Path(a.output);require(out.is_absolute() and out.parent.is_dir(),"existing absolute output parent")
    with out.open("x") as stream:json.dump(result,stream,indent=2,allow_nan=False);stream.write("\n");stream.flush();os.fsync(stream.fileno())
    print(json.dumps({"closure":ref(out),"originalValidatorsPassed":True}))
if __name__=="__main__":main()
