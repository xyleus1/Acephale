"""Invoke only the original native statistical routine on a complete owner cohort.
No canonical acceptance, model execution, ledger access, or default missing-data fill.
"""
import argparse, hashlib, importlib.util, json, os, sys, types
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPORT_ROOT=Path("/REQUIRED_BINDINGS/research-root/workspaces/report/report-source-aws-02")
ANALYSIS_ROOT=Path("/REQUIRED_BINDINGS/research-root/workspaces/report/analysis-source-c8/research/acephale/src")
RAW_ROOT=Path("/REQUIRED_BINDINGS/research-root/migration/raw/REQUIRED_BINDINGS_WORKSPACE/outputs/acephale-staged-study-20261113")
PINS={
 str(REPORT_ROOT/"assemble_study_report_20261115.py"):"eb5575ebf94ba75ef9ead44b09170a631e59ae140d70d3e52e6fa09aa8a86c2e",
 str(REPORT_ROOT/"report_path_view.py"):"5151343b1be6fc5de882d1821abc42872adbbb217b19427a66b45da77a87c432",
 str(REPORT_ROOT/"historical-report-path-map.json"):"324d7108ad10c147c9361957a0ba5b13a645259599f046b939857cb3e489953a",
 str(ANALYSIS_ROOT/"acephale/infra_evaluation.py"):"68cbe1e854c925f14c0b70cacdf91d261c6dc3c921914291ab964e289c4910f2",
 str(ANALYSIS_ROOT/"acephale/native_common.py"):"f987a03bf4bb352c17ff4e677aaafc0e4216efa18344cc12a1c1c3bd1dea1cd8",
 str(HERE/"dependencies/summarize_scheduler_events.py"):"5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358",
 str(RAW_ROOT/"paired-development-weight-groups-01/segments.json"):"f6f39258eea0e0251095380a34971d9a31918324e1eef91b7502493921886be9",
 str(RAW_ROOT/"paired-heldout-target-weight-groups-01/segments.json"):"fae4aa952715445caeca51f4207080661b730c67426a0757e53ae9dc3f8ccd29",
}
def need(x,m):
 if not x:raise ValueError(m)
def read(r):
 p=Path(r["path"]);need(p.is_absolute() and ".."not in p.parts and p.is_file() and not any(x.is_symlink()for x in(p,*p.parents)),"Regular immutable source required")
 need(p.stat().st_size<64*1024*1024 and "/REQUIRED_BINDINGS/research-root/shared/"not in str(p),"No live ledger or oversized input")
 b=p.read_bytes();need(hashlib.sha256(b).hexdigest()==r["sha256"],"FileRef SHA mismatch");return b
def raw(v):return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
def ref(p):
 b=Path(p).read_bytes();return {"path":str(p),"sha256":hashlib.sha256(b).hexdigest(),"bytes":len(b)}
def load_original():
 for p,s in PINS.items():read({"path":p,"sha256":s})
 sys.path.insert(0,str(REPORT_ROOT))
 p=REPORT_ROOT/"assemble_study_report_20261115.py"
 spec=importlib.util.spec_from_file_location("pinned_original_native_report",p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 need(Path(m.report_trials.__code__.co_filename)==ANALYSIS_ROOT/"acephale/infra_evaluation.py","Exact statistical import origin")
 need(Path(m.summarize_costs.__code__.co_filename)==ANALYSIS_ROOT/"acephale/native_common.py","Exact cost-summary import origin")
 # Native-report code is unchanged. Relocate only its sole ROOT dependency lookup.
 g=dict(m.native_report.__globals__);g["ROOT"]=HERE/"dependencies"
 f=types.FunctionType(m.native_report.__code__,g,m.native_report.__name__,m.native_report.__defaults__,m.native_report.__closure__)
 need(f.__code__ is m.native_report.__code__,"Original native statistical body retained")
 return m,f
def validate_reference(m,value):
 need(value.get("kind")=="acephale-original-native-analysis-inputs-v1","Input kind")
 need(value.get("validationStatus")=="unvalidated" and value.get("scientificAcceptanceAsserted")is False and value.get("studyComplete")is False,"No qualification/completion assertion")
 reference=value["nativeReference"];plan=json.loads(read(reference["plan"]))
 stage=plan.get("stage");need(stage in("development","heldout"),"Original stage")
 rows=plan["originalRuns"];ids=[r["runId"]for r in rows]
 need(len(ids)==len(set(ids))and ids,"Full nonempty original plan; zero-selected uses disposition report")
 name="paired-development-weight-groups-01"if stage=="development"else"paired-heldout-target-weight-groups-01"
 frozen=json.loads(read({"path":str(RAW_ROOT/name/"segments.json"),"sha256":PINS[str(RAW_ROOT/name/"segments.json")]}))
 assignments={r["runId"]:r for segment in frozen["segments"]for r in segment["runs"]}
 fields=("runId","pairedBlockId","domain","taskId","familyId","trial","seed","predictorTrainingSeed","arm","armOrder","maxBoundaries")
 need(all(r["runId"]in assignments and all(r.get(k)==assignments[r["runId"]].get(k)for k in fields)for r in rows),"Original family/seed/arm/trial assignments required")
 if stage=="development":
  need(ids==frozen["originalRunIds"]and len(ids)==36,"Exact original 36 development IDs/order")
 else:
  selected=json.loads(read(reference["heldoutSelection"]))
  need(selected.get("developmentOnly")is True and selected.get("heldoutOutcomesRead")is False,"Original development-only selection")
  need(ids==selected["selectedRunIds"]and set(ids)<=set(frozen["originalRunIds"]),"Actual selected original heldout IDs/order")
  need(len(ids)<=96,"Actual frozen eight-family target")
 need(isinstance(reference["cohorts"],list)and reference["cohorts"],"Actual closed cohort receipts required")
 for r in reference["cohorts"]:read(r)
 return reference
def write(p,b):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("xb")as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
 p=argparse.ArgumentParser();p.add_argument("--inputs");p.add_argument("--sha256");p.add_argument("--output");p.add_argument("--check-import",action="store_true");a=p.parse_args()
 m,function=load_original()
 if a.check_import:
  print(json.dumps({"importVerified":True,"originalNativeReportCodeObjectReused":True,"statisticsExecuted":False,"modelsCalled":False,"sourcePins":PINS}));return
 need(all([a.inputs,a.sha256,a.output]),"Explicit inputs SHA/output required")
 value=json.loads(read({"path":a.inputs,"sha256":a.sha256}));reference=validate_reference(m,value)
 out=Path(a.output);need(out.is_absolute()and".."not in out.parts and not out.exists()and not any(x.is_symlink()for x in out.parents),"Fresh isolated output required")
 inputs={};metrics=function(reference,inputs)
 # Recheck immutable originals after computation; no existing result is overwritten.
 for path,digest in inputs.items():read({"path":path,"sha256":digest})
 for path,digest in PINS.items():read({"path":path,"sha256":digest})
 out.mkdir(parents=True)
 write(out/"native-report.json",raw(metrics))
 wrapper={"kind":"acephale-direct-original-native-analysis-output-v1","validationStatus":"unvalidated","scientificAcceptanceAsserted":False,"studyComplete":False,"canonicalClaimsMutated":False,"modelsCalled":False,"liveLedgerOpened":False,"originalStatisticalFunctionsUnchanged":True,"originalNativeReportStatusMeaning":"complete original slot/evidence coverage only; not canonical accepted component","input":ref(a.inputs),"source":ref(__file__),"sourcePins":PINS,"sourceInputs":inputs,"nativeReport":ref(out/"native-report.json"),"protocolAmendments":value.get("protocolAmendments",[]),"latencyValidity":"exact original safe_native_row/report_trials rules; invalid timings excluded"}
 write(out/"READY/result.json",raw(wrapper))
 for q in(out/"READY",out,out.parent):
  fd=os.open(q,os.O_RDONLY);os.fsync(fd);os.close(fd)
 print(json.dumps({"ready":ref(out/"READY/result.json"),"nativeReport":ref(out/"native-report.json"),"validationStatus":"unvalidated","scientificAcceptanceAsserted":False,"studyComplete":False}))
if __name__=="__main__":main()
