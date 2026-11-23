"""Export safe native statistical rows and unchanged original reproduction sources.
This command performs no estimator/model/provider call and requires the existing computed report.
"""
import argparse, hashlib, importlib.util, json, os, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
ANALYSIS = Path("/REQUIRED_BINDINGS/research-root/workspaces/report/analysis-source-c8/research/acephale/src")
SCHEDULER = Path("/REQUIRED_BINDINGS/research-root/workspaces/report/native-statistics-interface-01/dependencies/summarize_scheduler_events.py")
RUNTIME = "5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
TEMPLATE_PINS = {
 "original_numeric.py":"146bfabc2af624c7edc767630cdd95e6ce9c65e04a002b72c128cf8cbfb32c47",
 "original_safe_rows.py":"5ed8162b1e3ad39a9d878af137792a2251df84139cfa2f573479cac150b09314",
 "original-source-binding.json":"fca793d7ff90e2714acbcfb0cc71e96e5cf86734f51f8e2c62553217f8abb6c0",
 "reproduce_native.py":"0eae2e13770ccc44886985aef7883d6beede37ec89270447f9649f49f1a9cbb1",
 "README.md":"0701b070cc898d6a66f89281419d144d9e7d91cbb00eacfcb518b90846feb588",
 "requirements.lock":"cd2d286b167c7a3f273a49450ec1b7496e5309590ecc3e785fc57b40a17a03ca"}
SECTIONS = ("nativeCompletionAndLiveLatency","knownConstraintCleanPairedDifferences","evaluatorInclusiveLatency","additionalArmMetrics","predictorSeedTrialCounts")
def raw(value): return (json.dumps(value,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
def digest(data): return hashlib.sha256(data).hexdigest()
def ref(path):
 path=Path(path);data=path.read_bytes()
 return {"path":str(path),"sha256":digest(data),"bytes":len(data)}
def checked(value,parse=True):
 p=Path(value["path"]);b=p.read_bytes()
 if not p.is_absolute() or digest(b)!=value["sha256"] or ("bytes"in value and len(b)!=value["bytes"]):raise ValueError("Immutable source bytes differ")
 return json.loads(b) if parse else b
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def privacy(data):
 for marker in (b"/srv/",b"s3://",b"arn:aws:",b"REQUIRED_AWS_ACCOUNT_ID",b"http://127.",b"SecretAccessKey",b"AccessKeyId"):
  if marker in data:raise ValueError("Private operational metadata in public export")
def build(inputs,output):
 report=checked(inputs["analysisReport"]);checked(inputs["analysisProducer"],False)
 if report["stage"]not in("development","heldout"):raise ValueError("Original native stage required")
 if "collection"in inputs:
  collection=checked(inputs["collection"])
  if not collection.get("ownerExecutionClosed") or collection.get("missingRunIds") or collection.get("duplicateRunIds"):raise ValueError("Complete original closed collection required")
  receipts=checked(collection["receiptInputs"]);original=checked(collection["originalRunRows"])
  selected=checked(collection["selection"])["selectedRunIds"]
  if [x["runId"]for x in original]!=selected:raise ValueError("Original selected order changed")
 else:
  reference=inputs["nativeReference"];receipts=reference["cohorts"];plan=checked(reference["plan"]);original=plan["originalRuns"]
 ids=[x["runId"]for x in original]
 if len(ids)!=len(set(ids)) or report["declaredSlots"]!=len(ids):raise ValueError("Original declared denominator changed")
 templates={name:checked({"path":str(TEMPLATES/name),"sha256":sha},False)for name,sha in TEMPLATE_PINS.items()}
 checked({"path":str(SCHEDULER),"sha256":"5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358"},False)
 checked({"path":str(ANALYSIS/"acephale/contracts_v1.py"),"sha256":"97278a1e78f7fe1eda41983116f69082de7b5622587808d621c348bedd61da5e"},False)
 sys.path.insert(0,str(ANALYSIS))
 from acephale.contracts_v1 import hash_v1
 scheduler=load(SCHEDULER,"original_reproduction_scheduler")
 safe=load(TEMPLATES/"original_safe_rows.py","original_reproduction_safe_rows")
 slots={x["runId"]:x for x in original};rows={};scopes=[];sources=[]
 for rr in receipts:
  receipt=checked(rr);root=Path(rr["path"]).parent
  event_summary=scheduler.summarize(root,RUNTIME)
  observed={x["runId"]:x for x in event_summary["rows"]}
  indexed={x["path"]:x["sha256"]for x in receipt["files"]}
  def member(name,parse=True):return checked({"path":str(root/name),"sha256":indexed[name]},parse)
  config=member("configuration.json");manifest=member("manifest.json")
  for row in [json.loads(x)for x in member("outcomes.jsonl",False).splitlines()]:
   rid=row["runId"]
   if rid not in slots or rid in rows:raise ValueError("Missing/duplicate/unselected native slot")
   rows[rid]=safe.safe_native_row(slots[rid],row,member(rid+".json"),observed[rid])
  sources.append({"cohortReceiptSha256":rr["sha256"],"runtimeEventsSha256":event_summary["runtimeEventsSha256"]})
  scopes.append(manifest)
 if set(rows)!=set(ids):raise ValueError("Every selected slot, including failures, must be retained")
 if {(x["cohortReceiptSha256"],x["runtimeEventsSha256"])for x in report["sources"]}!={(x["cohortReceiptSha256"],x["runtimeEventsSha256"])for x in sources}:raise ValueError("Original computed report refers to other cohort evidence")
 actor_hash=hash_v1(scopes[0]["actor"]);memory_hash=scopes[0]["data"]["memoryHash"]
 if any(hash_v1(x["actor"])!=actor_hash or x["data"]["memoryHash"]!=memory_hash for x in scopes):raise ValueError("Original actor/frozen memory identity changed")
 public={"schemaVersion":1,"validationStatus":"unvalidated","scientificAcceptanceAsserted":False,"studyComplete":False,
  "stage":report["stage"],"rows":[rows[x]for x in ids],"actorConfigHash":actor_hash,"memorySnapshotHash":memory_hash,
  "annotationReview":scopes[0]["protocol"].get("annotationReview"),"originalComputedReportSha256":inputs["analysisReport"]["sha256"],
  "originalProducerSha256":inputs["analysisProducer"]["sha256"],"originalCohortSources":sources,
  "statisticsRecomputedByExporter":False,"modelsCalled":False,
  "scope":"Safe sufficient statistical rows produced by unchanged original preprocessing; no prompts/task/customer content."}
 expected={k:report[k]for k in SECTIONS}
 out=Path(output)
 if not out.is_absolute() or out.exists():raise ValueError("New absolute output directory required")
 out.mkdir(parents=True);files=[]
 for name,data in {**templates,"native-statistical-inputs.json":raw(public),"original-numerical-sections.json":raw(expected)}.items():
  privacy(data);p=out/name
  with p.open("xb")as f:f.write(data);f.flush();os.fsync(f.fileno())
  files.append({"path":name,"sha256":digest(data),"bytes":len(data)})
 binding={"schemaVersion":1,"validationStatus":"unvalidated","scientificAcceptanceAsserted":False,"studyComplete":False,
  "originalComputedReportSha256":inputs["analysisReport"]["sha256"],"originalProducerSha256":inputs["analysisProducer"]["sha256"],
  "originalSelectedCount":len(ids),"allOriginalIdsAndFailuresRetained":True,"originalPreprocessingSourceSha256":"eb5575ebf94ba75ef9ead44b09170a631e59ae140d70d3e52e6fa09aa8a86c2e",
  "originalSchedulerSourceSha256":"5f761066d3f5d46b8248d0f2067444f98d6cc2599b26c41b6221c0612db07358",
  "statisticsExecutedByExporter":False,"files":files}
 b=raw(binding);privacy(b);(out/"source-binding.json").write_bytes(b)
 return {"directory":str(out),"binding":ref(out/"source-binding.json"),"files":[ref(out/x["path"])for x in files],
         "statisticsExecuted":False,"scientificAcceptanceAsserted":False}
def main():
 p=argparse.ArgumentParser();p.add_argument("--inputs",required=True);p.add_argument("--sha256",required=True);p.add_argument("--output",required=True);a=p.parse_args()
 print(json.dumps(build(checked({"path":a.inputs,"sha256":a.sha256}),a.output)))
if __name__=="__main__":main()
