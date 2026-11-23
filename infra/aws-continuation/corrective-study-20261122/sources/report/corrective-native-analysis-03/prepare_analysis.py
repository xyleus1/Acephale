"""Prepare immutable corrective native analysis inputs; never compute statistics here."""
from pathlib import Path
import argparse,copy,hashlib,importlib.util,json,os
R=Path("/REQUIRED_BINDINGS/research-root/workspaces")
ANALYSIS=R/"report/native-statistics-interface-02/aggregate_mixed_scope.py"
ANALYSIS_SHA="9b985a76b36d19ea101f7cf27eb5b7455763d1a594e6195d39c1ab6eea97ebef"
PYTHON=R/"report/locked-environments-02/analysis5a/bin/python"
UNITS={"development":((1,29,18),(2,17,18)),"heldout":((1,17,48),(2,29,48))}
def require(x,m):
 if not x:raise ValueError(m)
def ref(p):
 p=Path(p).resolve();b=p.read_bytes();return {"path":str(p),"sha256":hashlib.sha256(b).hexdigest(),"bytes":len(b)}
def load():
 require(ref(ANALYSIS)["sha256"]==ANALYSIS_SHA,"Original statistical callback changed")
 spec=importlib.util.spec_from_file_location("_original_native_analysis",ANALYSIS)
 wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
 api,original=wrapper.load();return wrapper,api,original
def read(api,r):return json.loads(api.read(r))
def write(p,value):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("xb")as stream:stream.write((json.dumps(value,sort_keys=True,indent=2,allow_nan=False)+"\n").encode());stream.flush();os.fsync(stream.fileno())
 return ref(p)
PATH_FIELDS=("manifestPath","ledgerCheckpointPath","memoryPath","calibrationPath","opportunityPath","goalReliabilityPath","splitGuardPath","customTaskBundleDirectory","cohortReservationPath")
def canonical_configuration(value,configuration_path):
 result=copy.deepcopy(value)
 for field in PATH_FIELDS:
  if result.get(field):
   result[field]=str((Path(configuration_path).parent/result[field]).resolve())
 return result
def validate_collection(api,m,stage,collection,reservation):
 require(stage in UNITS and reservation["plan"]["stage"]==stage,"Original stage required")
 body={k:v for k,v in reservation.items()if k!="contentHash"}
 require(reservation.get("contentHash")==m.hash_v1(body),"Actual original immutable reservation required")
 plan=reservation["plan"];expected_count=36 if stage=="development"else 96
 require(plan["version"]==1 and len(plan["originalRuns"])==len(plan["runs"])==expected_count,"Complete frozen cohort denominator required")
 require(plan["originalScheduleHash"]==m.hash_v1(plan["originalRuns"]),"Original row order hash changed")
 require({r["runId"]:r for r in plan["originalRuns"]}=={r["runId"]:r for r in plan["runs"]},"Original/serving row membership changed")
 require(len({r["runId"]for r in plan["runs"]})==expected_count,"Duplicate original native IDs")
 require(collection["allChildrenDrained"]is True and collection["ownerExecutionClosed"]is True and not collection["missingRunIds"] and not collection["duplicateRunIds"],"Actually closed and drained owner collection required")
 receipts=read(api,collection["receiptInputs"]);require(len(receipts)==2,"Exactly two original whole-segment receipts required")
 require([len(x)for x in plan["segments"]]==[expected_count//2]*2,"Whole18/48 original segments required")
 scopes=[];allids=[]
 for position,(rr,unit)in enumerate(zip(receipts,UNITS[stage])):
  receipt=read(api,rr);directory=Path(rr["path"]).parent
  require(Path(rr["path"]).name=="cohort-receipt.json"and receipt["stage"]==stage and receipt["closed"]is True and receipt["allDeclaredSlotsRetained"]is True,"Closed original receipt with failures retained required")
  files={x["path"]:x["sha256"]for x in receipt["files"]}
  require(len(files)==len(receipt["files"]),"Duplicate receipt member")
  members={}
  for name in ("configuration.json","manifest.json","outcomes.jsonl"):
   require(name in files,"Missing original native artifact")
   member={"path":str(directory/name),"sha256":files[name]}
   data=api.read(member);members[name]=(member,json.loads(data)if name!="outcomes.jsonl"else[json.loads(x)for x in data.splitlines()if x])
  config=members["configuration.json"][1];manifest=members["manifest.json"][1];outcomes=members["outcomes.jsonl"][1]
  expected=plan["segments"][position];byid={r["runId"]:r for r in plan["runs"]}
  require(config["stage"]==stage and config["runs"]==[byid[i]for i in expected],"Original whole-segment construction/order changed")
  require([x["runId"]for x in outcomes]==expected,"Every original slot must be retained in original segment order, including failures/censoring")
  require(receipt["configurationHash"]==m.hash_v1(config)and receipt["manifestHash"]==m.hash_v1(manifest),"Receipt configuration/manifest identity changed")
  allids.extend(expected);scopes.append({"receipt":rr,"configuration":members["configuration.json"][0],"manifest":members["manifest.json"][0],"configurationValue":config,"manifestValue":manifest})
 require(allids==[r["runId"]for r in plan["runs"]],"Serving order changed")
 require(collection["observedCount"]==expected_count,"Owner collection count differs")
 return plan,receipts,scopes
def prepare_collection(value,output):
 require(value["kind"]=="acephale-corrective-native-analysis-binding-v1","Input kind")
 wrapper,api,m=load();stage=value["stage"];collection=read(api,value["collection"]);reservation=read(api,value["reservation"])
 plan,receipts,scopes=validate_collection(api,m,stage,collection,reservation)
 require(read(api,collection["reservation"])==reservation,"Collector used a different reservation")
 scope_binding=read(api,value["scopeBinding"])
 require(scope_binding["kind"]=="acephale-corrective-native-scope-binding-v1","Exact approved operational scope binding required")
 require(len(value["nativePreparations"])==2,"Both actual corrective source preparations required")
 evidence=[]
 for index,(pr,unit,current)in enumerate(zip(value["nativePreparations"],UNITS[stage],scopes)):
  p=read(api,pr);number,seed,count=unit
  require(p["kind"]=="acephale-corrective-native-inputs-ready-v1"and p["originalSemanticUnit"]==f"{stage}/{number}"and p["predictorTrainingSeed"]==seed,"Current corrective source preparation identity required")
  require(p["correctiveParticipantId"]==f"corrective-{stage}-{number}-20261122-01:segment-{number}","Distinct corrective financial attempt required")
  require(p["originalRunIds"]==plan["segments"][index],"Corrective preparation changed original scientific IDs/order")
  require(canonical_configuration(read(api,p["configuration"]),p["configuration"]["path"])==current["configurationValue"]and read(api,p["manifest"])==current["manifestValue"],"Previous-generation or changed native outputs cannot substitute for corrective execution")
  require(read(api,p["cohortPlan"])==plan and read(api,p["cohortReservation"])==reservation,"Native execution bound a different actual reservation")
  for key in ("qualificationEvidence","profileEvidence","financialLineage","nativeRunner","hostObservationBinding"):
   api.read(p["evidence"][key])
  expected=scope_binding["stages"][stage]["segments"][index]
  require(expected["predictorTrainingSeed"]==seed and expected["runIds"]==p["originalRunIds"]and m.scope(current["manifestValue"],current["configurationValue"]["taskBundleHash"])==expected["observedScopeHash"],"Actual qualified worker scope not covered by explicit amendment")
  evidence.append({"sourcePreparation":pr,"originalSemanticUnit":p["originalSemanticUnit"],"correctiveParticipantId":p["correctiveParticipantId"],"actualRuntime":current["manifestValue"]["runtime"],"actualHardware":current["manifestValue"]["hardware"],"qualifiedProfileAndObservation":{k:p["evidence"][k]for k in ("qualificationEvidence","profileEvidence","hostObservationBinding")},"outcomeStatusReclassified":False})
 reference={"cohorts":receipts}
 if stage=="heldout":
  reference["heldoutSelection"]=value["heldoutSelection"]
  require(read(api,collection["selection"])==read(api,value["heldoutSelection"]),"Frozen selected heldout identity changed")
 binding=wrapper.scope_metadata(api,m,reference)
 derived=copy.deepcopy(plan);derived["scopeHash"]=None;derived["mixedScopeBindingHash"]=m.hash_v1(binding)
 output=Path(output).resolve();require(not output.exists(),"New analysis input directory required")
 output.mkdir(parents=True);reference["plan"]=write(output/"plan.json",derived)
 inputs={"kind":"acephale-original-native-analysis-inputs-v1","validationStatus":"unvalidated","scientificAcceptanceAsserted":False,"studyComplete":False,"nativeReference":reference,
 "scopeAmendmentAuthority":"ROOT-reporting-only-mixed-scope-amendment-20261122","scopeAmendment":binding,
 "protocolAmendments":[{"kind":"explicit-corrective-whole-segment-operational-scope-binding","evidence":value["scopeBinding"],"originalModelsDataToolsRunIdsAndOrderUnchanged":True,"rawPerSegmentScopesRetained":True}],
 "ownerCollection":value["collection"],"correctiveExecutionEvidence":evidence,"priorResultsPreservedSeparately":value.get("priorResults",[])}
 api.validate_reference(m,inputs)
 artifact=write(output/"ANALYSIS-INPUTS.json",inputs)
 requested=Path(value["analysisOutput"]).resolve();require(not requested.exists()and requested!=output,"New separate original analysis output required")
 command={"argv":[str(PYTHON),"-I","-B",str(ANALYSIS),"--inputs",artifact["path"],"--sha256",artifact["sha256"],"--output",str(requested)],
 "environment":{"LD_LIBRARY_PATH":str(R/"report/locked-environments-02/python-root/local/lib")},"source":ref(ANALYSIS),"inputs":artifact,"output":str(requested),"executed":False,"onceOnlyKey":stage+":"+artifact["sha256"]}
 write(output/"COMMAND.json",command)
 ready={"kind":"acephale-corrective-original-native-analysis-input-ready-v1","stage":stage,"declaredSlots":len(plan["runs"]),"inputs":artifact,"command":ref(output/"COMMAND.json"),"analysisSource":ref(ANALYSIS),"source":ref(Path(__file__)),"originalEstimatorPins":api.PINS,
 "statisticsComputed":False,"modelsCalled":False,"ledgerOpened":False,"canonicalAcceptanceAsserted":False,
 "failureDenominators":"All original slots, failed/censored/unknown rows unchanged; no favorable subset or zero fill.",
 "timingValidity":"Original per-row timing flags/reasons unchanged; cross-hardware timing homogeneity is not asserted.",
 "outputContract":["READY/result.json","native-report.json","raw-scope-binding.json","reporting-amendment.json"]}
 write(output/"READY.json",ready);return ready
def closed_collection(api,value):
 stage=value["stage"];require(stage in UNITS,"Original stage")
 require(len(value["closedSegments"])==len(value["nativePreparations"])==2,"Two ordered actual whole-segment closures required")
 closed=[];receipts=[];ids=[]
 for index,(cr,pr,unit) in enumerate(zip(value["closedSegments"],value["nativePreparations"],UNITS[stage])):
  c=read(api,cr);number,seed,count=unit
  require(c.get("kind")=="acephale-corrective-native-closed-result-v1","Actual corrective collector result required")
  require(c.get("closed")is True and c.get("drained")is True and c.get("allDeclaredSlotsRetained")is True,"Original closed/drained slot coverage required")
  require(c["originalSemanticUnit"]==f"{stage}/{number}" and c["participant"]==f"corrective-{stage}-{number}-20261122-01:segment-{number}","Corrective unit/participant mismatch")
  require(read(api,c["preparation"])==read(api,read(api,pr)["preparation"]),"Collector original preparation differs from executed corrective READY")
  require(len(c["orderedRunIds"])==c["observedCount"]==count and len(set(c["orderedRunIds"]))==count,"Missing/duplicate whole-segment slots")
  for k in ("operation","workerConfiguration","terminal","configuration","manifest","outcomes","originalSummary","cohortReceipt","schedulerCounts"):
   api.read(c[k])
  require(c["rawIndex"].get("sha256") and c["rawIndex"].get("versionId"),"Immutable raw-export identity required")
  receipt=read(api,c["cohortReceipt"]);require(receipt.get("closed")is True and receipt.get("allDeclaredSlotsRetained")is True,"Original receipt closure required")
  directory=Path(c["cohortReceipt"]["path"]).parent
  files={row["path"]:row["sha256"]for row in receipt["files"]}
  for field,name in (("configuration","configuration.json"),("manifest","manifest.json"),("outcomes","outcomes.jsonl"),("originalSummary","summary.json")):
   require(Path(c[field]["path"]).resolve()==directory/name and c[field]["sha256"]==files[name],"Collector artifact differs from original receipt member")
  rows=read(api,c["configuration"])["runs"]
  require([x["runId"]for x in rows]==c["orderedRunIds"],"Collector order differs from actual configuration")
  receipts.append(c["cohortReceipt"]);ids.extend(c["orderedRunIds"]);closed.append(c)
 require(len(set(ids))==len(ids),"Duplicate IDs across original segments")
 return {"allChildrenDrained":True,"ownerExecutionClosed":True,"missingRunIds":[],"duplicateRunIds":[],"observedCount":len(ids),"reservation":value["reservation"],"selection":value.get("heldoutSelection"),"originalServingRunIds":ids,"sourceClosedSegments":value["closedSegments"],"workerExecutionCompleted":[x["workerExecutionCompleted"]for x in closed],"cohortCompleted":[x["cohortCompleted"]for x in closed],"nativeRuntimeLogsComplete":[x["nativeRuntimeLogsComplete"]for x in closed],"scientificAcceptanceAsserted":False,"studyComplete":False},receipts

def prepare(value,output):
 if value.get("kind")=="acephale-corrective-native-analysis-binding-v1":
  return prepare_collection(value,output)
 require(value.get("kind")=="acephale-corrective-closed-segments-analysis-v2","Input kind")
 wrapper,api,m=load()
 collection,receipts=closed_collection(api,value)
 output=Path(output).resolve();require(not output.exists(),"New isolated output required")
 output.mkdir(parents=True)
 collection["receiptInputs"]=write(output/"closure-inputs/receipt-inputs.json",receipts)
 collection_ref=write(output/"closure-inputs/COLLECTION.json",collection)
 args=dict(value);args["kind"]="acephale-corrective-native-analysis-binding-v1";args["collection"]=collection_ref
 result=prepare_collection(args,output/"analysis-inputs")
 result={**result,"ownerClosedSegments":value["closedSegments"],"derivedCollection":collection_ref,"analysisPreparation":ref(output/"analysis-inputs/READY.json"),"collectionFlagsPreserved":{"workerExecutionCompleted":collection["workerExecutionCompleted"],"cohortCompleted":collection["cohortCompleted"],"nativeRuntimeLogsComplete":collection["nativeRuntimeLogsComplete"]}}
 write(output/"READY.json",result)
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument("--inputs",required=True);p.add_argument("--sha256",required=True);p.add_argument("--output",required=True);a=p.parse_args()
 wrapper,api,m=load();value=read(api,{"path":a.inputs,"sha256":a.sha256})
 result=prepare(value,a.output);print(json.dumps({"ready":ref(Path(a.output)/"READY.json"),"statisticsComputed":False}))
if __name__=="__main__":main()
