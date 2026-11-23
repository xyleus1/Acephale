"""Source-bound genuine-guard native entry with unchanged RPC telemetry adapter."""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
SOURCE="5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
PINS={"infra_native_runner.py":"b3805efb03f820bb7ad0f8bbc1512e24e94bcbcbb450d51b54e146379b7eb3e6",
      "native_common.py":"f987a03bf4bb352c17ff4e677aaafc0e4216efa18344cc12a1c1c3bd1dea1cd8",
      "infra_split_guard.py":"25e11aff64fa2013cf5b09441b0e2c45b12e3d9268d4c32c93594634d7c53c56"}
RPC_SHA="8e595f6e4bbbcab95af27273c43ba62de8973f1d69eb8d44317e9992fb191db1"
FINANCIAL_SHA="9f9fde91a1a2cf59b807c8cef55df6ac48ddc88347b82c68d714e8aa632d13a1"
SCRIPT="scripts/acephale-infra-native.ts"
def require(value,message):
    if not value:raise ValueError(message)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def application_binding(path,digest):
    path=Path(path).resolve();require(sha(path)==digest,"Application binding changed")
    value=json.loads(path.read_bytes());root=Path(value["applicationSourceRoot"]).resolve();seen=set()
    for row in value["files"]:
        p=(root/row["path"]).resolve()
        require(p.is_relative_to(root) and row["path"] not in seen and sha(p)==row["sha256"],"Application source member changed")
        seen.add(row["path"])
    require(SCRIPT in seen and "services/acephale-runtime/financial_namespace.ts" in seen,"Pinned native and corrective financial source required")
    require(sha(root/"services/acephale-runtime/financial_namespace.ts")==FINANCIAL_SHA,"Corrective financial mapping changed")
    native=(root/SCRIPT).read_text()
    require("const guard = nativeSplitGuard(configuration, artifacts.manifest, resolve(configurationPath));" in native and "const nativeSplitGuard:" not in native,"Genuine nativeSplitGuard required")
    return root,value
class SourceRoutedSubprocess:
    """Only the original Node artifact validator is routed; source checks stay original."""
    def __init__(self,original,science,application,node):
        self.original,self.science,self.application,self.node=original,science,application,node
    def __getattr__(self,name):return getattr(self.original,name)
    def run(self,argv,**kwargs):
        if argv and argv[0]=="node":
            require(len(argv)==6 and argv[1:4]==["--import","tsx","-e"] and
                    "loadInfraNativeConfiguration(process.argv[1])" in argv[4] and
                    Path(kwargs["cwd"]).resolve()==self.science,"Unexpected native Node validation")
            argv=[self.node,*argv[1:]];kwargs={**kwargs,"cwd":self.application}
        return self.original.run(argv,**kwargs)
    def check_output(self,argv,**kwargs):
        if argv and argv[0]=="node":
            require(argv==["node","-p","process.versions.node"] and Path(kwargs["cwd"]).resolve()==self.science,"Unexpected native Node version command")
            argv=[self.node,*argv[1:]]
        return self.original.check_output(argv,**kwargs)
def configure_retained_task_paths():
    # The frozen collection configuration is retained byte-for-byte.
    # Translate only its exact historical filesystem reference, never task/tool/entity arguments.
    import acephale.custom_native_tasks as custom_tasks
    original_verify=custom_tasks.verify_custom_bundle
    def verify_retained(directory,upstream_root=None):
        if str(directory)==r'REQUIRED_BINDINGS_WORKSPACE\outputs\acephale-study-20261113\generated-native':
            directory=Path('/REQUIRED_BINDINGS/research-root/migration/raw/REQUIRED_BINDINGS_WORKSPACE/outputs/acephale-study-20261113/generated-native')
            require(sha(directory/'receipt.json')=='be60a406056e071d5aa7b0ba30627948192e6bb23d2b1ef8b538bbf8c934084b','Original migrated custom task receipt changed')
        return original_verify(directory,upstream_root)
    custom_tasks.verify_custom_bundle=verify_retained
def configure(source,commit,binding_path,binding_sha,node,*,process_factory=None):
    science=Path(source).resolve();node=str(Path(node).resolve())
    require(commit==SOURCE and Path(node).is_file(),"Exact original source and installed Node required")
    application,binding=application_binding(binding_path,binding_sha)
    package=science/"research/acephale/src";runtime=package/"acephale"
    for name,digest in PINS.items():require(sha(runtime/name)==digest,"Original native module changed: "+name)
    sys.path.insert(0,str(package))
    from acephale.experiment_runner import verify_source
    verify_source(science,SOURCE)
    from acephale import infra_native_runner as original
    configure_retained_task_paths()
    require(Path(original.__file__).resolve()==runtime/"infra_native_runner.py" and Path(original.ROOT).resolve()==science,"Native Python origin/root mismatch")
    for name,module in tuple(sys.modules.items()):
        filename=getattr(module,"__file__",None)
        if name.startswith("acephale") and filename:
            require(Path(filename).resolve().is_relative_to(package),"Foreign native Python module")
    helper=Path(__file__).with_name("rpc_service_telemetry.py")
    require(sha(helper)==RPC_SHA,"Exercised RPC telemetry source changed")
    spec=importlib.util.spec_from_file_location("_corrective_original_rpc_telemetry",helper)
    rpc=importlib.util.module_from_spec(spec);spec.loader.exec_module(rpc)
    real_subprocess=subprocess
    popen=process_factory or real_subprocess.Popen
    def service_process(argv,**kwargs):
        require(len(argv)==6 and argv[:4]==["node","--import","tsx",SCRIPT] and Path(kwargs["cwd"]).resolve()==science,"Only the original native service may be source-routed")
        # Revalidate immutable application members at the actual child boundary.
        application_binding(binding_path,binding_sha)
        return popen([node,"--import","tsx",str(application/SCRIPT),*argv[4:]],**{**kwargs,"cwd":application})
    original.subprocess=SourceRoutedSubprocess(real_subprocess,science,application,node)
    defaults=dict(original._run_cohort.__kwdefaults__)
    require(set(defaults)=={"process_factory","telemetry_factory"},"Original native dependency seam changed")
    defaults.update(process_factory=service_process,telemetry_factory=rpc.service_telemetry)
    original._run_cohort.__kwdefaults__=defaults
    # All original runner/executor/health/guard functions and code objects are retained.
    return original,{"applicationSourceRoot":str(application),"source":str(science),"sourceCommit":SOURCE,
                     "rpcTelemetrySha256":RPC_SHA,"originalModulePins":PINS,"nodeExecutable":node,
                     "runnerFunctionsChanged":False,"hostGuardWaiverApplied":False,"nativeSplitGuardBypassed":False}
def configure_upstream_imports(upstream_root):
    # Same verified operational recipe as corrective profile_entry788d; no dependency replacement.
    frozen_site=Path("/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-03/tau3/lib/python3.12/site-packages")
    upstream_source=Path(upstream_root).resolve()/"src"
    require(frozen_site.is_dir() and (upstream_source/"tau2").is_dir(),"Existing frozen native imports required")
    sys.path.append(str(frozen_site))
    sys.path.insert(0,str(upstream_source))
def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--application-binding",required=True);p.add_argument("--application-sha256",required=True);p.add_argument("--node",required=True)
    p.add_argument("source");p.add_argument("commit");p.add_argument("arguments",nargs=argparse.REMAINDER);a=p.parse_args(argv)
    require(os.environ.get("ACEPHALE_BUDGET_RPC_CONFIG") and os.environ.get("ACEPHALE_BUDGET_RPC_SHA256") and os.environ.get("ACEPHALE_BUDGET_RPC_PARTICIPANT"),"Actual shared RPC owner binding required")
    require(os.environ.get("ACEPHALE_CORRECTIVE_FINANCIAL_LINEAGE") and os.environ.get("ACEPHALE_CORRECTIVE_FINANCIAL_LINEAGE_SHA256"),"Corrective financial lineage required")
    require(os.environ.get("ACEPHALE_HOST_STATUS_FILE"),"Configured actual host observation required")
    require(a.arguments and a.arguments[0]=="--config","Unchanged native argument suffix required")
    require(a.arguments.count("--upstream-root")==1,"One original upstream root required")
    configure_upstream_imports(a.arguments[a.arguments.index("--upstream-root")+1])
    module,evidence=configure(a.source,a.commit,a.application_binding,a.application_sha256,a.node)
    from acephale.experiment_runner import verify_source
    try:return module.main(a.arguments)
    finally:verify_source(Path(a.source).resolve(),SOURCE)
if __name__=="__main__":raise SystemExit(main())
