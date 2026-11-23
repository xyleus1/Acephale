"""Two-phase native package preparation. No claim, reserve, worker, or model calls."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,tarfile,time
ROOT=Path("/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-native-operation-03")
SCIENCE="5a36a8b3835820fe65b3615ead31fb6fb7bc9672"
PINS={
 "worker":("/REQUIRED_BINDINGS/research-root/workspaces/rescue/execution/corrective-native-credentials-01/native_worker.py","579dbc997c5339d3182fa0c52929237543a0beadf81bfc3a00b90a1d1c0d9c57"),
 "publisher":("/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-profile-controller-01/publish_profile.py","7824089c8b92b4147385c50d6f2eca2f4ad81dd3132731f47e2d65f3045c3b03"),
 "guard":("/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-native-path-03/native_guard.py","d3c5a068cb3be51b521180b69f4542f56cf1d2002f03ca30541e3eeb1578fe31"),
 "observer":("/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-host-observation-03/host_observation.py","ca3034334730136fa5789eb76f50412e647e225618735d3436511efe2f704b87"),
 "sampler":("/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-host-observation-03/host_heartbeat.py","bff1975170a737c3fb3d8a07bfb781aeee322e4729d95da5a5beb4fcc4cb4806"),
}
UNITS={"development/1":29,"development/2":17,"heldout/1":17,"heldout/2":29}
def need(v,m):
 if not v:raise ValueError(m)
def digest(b):return hashlib.sha256(b).hexdigest()
def clean(r):return {k:r[k]for k in("path","sha256")}
def checked(r):
 p=Path(r["path"]);need(p.is_absolute()and p.is_file()and not p.is_symlink()and digest(p.read_bytes())==r["sha256"],"Pinned file "+str(p));return p
def read(r):return json.loads(checked(r).read_bytes().decode("utf-8-sig"))
def ref(p):return {"path":str(Path(p)),"sha256":digest(Path(p).read_bytes())}
def pin(name):p,h=PINS[name];r={"path":p,"sha256":h};checked(r);return r
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
 with p.open("x",encoding="utf-8")as f:json.dump(v,f,sort_keys=True,indent=2,allow_nan=False);f.write("\n");f.flush();os.fsync(f.fileno())
 return ref(p)
def same(a,b):return clean(a)==clean(b)
def newout(output):
 p=Path(output);need(p.is_absolute()and p.is_relative_to("/REQUIRED_BINDINGS/research-root/workspaces")and not p.exists(),"New isolated AWS output");p.mkdir(parents=True);return p
def prepare_binding(value,output):
 need(value["kind"]=="acephale-corrective-native-operation-binding-v1","Binding input kind")
 unit=value["unitId"];need(unit in UNITS,"Original unit");seed=UNITS[unit]
 config=read(value["profileWorkerConfiguration"]);op=read(value["profileOperation"]);owner=read(op["ownerReady"])
 need(same(owner["configuration"],value["profileWorkerConfiguration"]),"Operation/config binding")
 need(config["unitId"]=="corrective/seed"+str(seed)+"/opportunity"and op["unitId"]==config["unitId"],"Own current profile transport")
 need(op["attemptId"]==config["attemptId"]and config["instanceId"]==op["expectedCanonical"]["instanceId"],"Current host/owner")
 transport=copy.deepcopy(config["transport"]);observation=transport["linuxObservation"]
 need(same(observation["source"],pin("observer"))and same(observation["inputs"]["sampler"],pin("sampler")),"Exercised observer/sampler")
 need(config["hardDeadline"]==1795413600 and config["phaseDeadline"]<=1795411800,"Original finite horizon")
 template=read(value["nativeTemplate"]);need(template["inputs"]["unitId"]==unit and template["predictorTrainingSeed"]==seed,"Native template identity")
 attempt="corrective-"+unit.replace("/","-")+"-20261122-01";operation=attempt
 outputroot="/REQUIRED_BINDINGS/research-root/artifacts/"+attempt
 obsroot="/run/acephale-corrective-observation/seed"+str(seed)+"/"+attempt
 observation["inputs"]["outputRoot"]=obsroot
 output=newout(output)
 transport_ref=save(output/"transport.json",transport)
 binding={"kind":"acephale-corrective-native-host-binding-v1","unitId":unit,"seed":seed,"attemptId":attempt,"operationId":operation,
 "profileWorkerConfiguration":clean(value["profileWorkerConfiguration"]),"profileOperation":clean(value["profileOperation"]),
 "nativeTemplate":clean(value["nativeTemplate"]),"transport":transport_ref,"outputRoot":outputroot,"hostStatusFile":outputroot+"/qualified-guard",
 "observationOutputRoot":obsroot,"resourceAttemptId":config["resourceAttemptId"],"instanceId":config["instanceId"],
 "hardDeadline":config["hardDeadline"],"phaseDeadline":config["phaseDeadline"],"freshObservationOccursOnWorker":True,
 "templateAndLeaseAreExistingProtectedInputs":True,"manifestProvenanceComesFromNewNativeGuard":True,
 "sampledHealthAsserted":False}
 binding_ref=save(output/"BINDING.json",binding)
 result={"kind":"acephale-corrective-native-host-binding-ready-v1","hostObservationBinding":binding_ref,
 "hostStatusFile":binding["hostStatusFile"],"transport":transport_ref,"binding":binding_ref,"workerActivated":False}
 save(output/"READY.json",result);return result
def validate_profile(p,profile_ref,b,prepared):
 need(p["kind"]=="acephale-corrective-profile-ready-v1"and p["profileValid"]is True and p["seed"]==b["seed"],"Actual own profile required")
 need(same(p["configuration"],b["profileWorkerConfiguration"]),"Actual successful profile worker binding")
 need(same(prepared["evidence"]["profileEvidence"],profile_ref),"Segment binds actual profile READY")
 terminal=read(p["terminal"]);receipt=read(p["profileReceipt"]);a=read(p["opportunity"])
 need(terminal["completed"]is True and terminal["ownedProcessesDrained"]is True and terminal["result"]["completed"]is True,"Actual completed drained profile")
 need(terminal["attemptId"]==p["attemptId"]and terminal["resourceAttemptId"]==b["resourceAttemptId"]and terminal["instanceId"]==b["instanceId"],"Same host profile lineage")
 need(receipt["closed"]is True and receipt["readyForAggregation"]is True and a["version"]==2 and 10<=a["sampleCount"]<=80,"Original opportunity minimum")
 need(all(k in p["rawIndex"]for k in("bucket","key","versionId","sha256")),"Durable actual raw index")
 return terminal
def compose(value,b,prepared,profile):
 unit=b["unitId"];stage,number=unit.split("/");number=int(number);count=18 if stage=="development"else 48
 need(prepared["kind"]=="acephale-corrective-native-inputs-ready-v1"and prepared["operation"]=="segment"and prepared["originalSemanticUnit"]==unit,"Actual original segment READY")
 need(prepared["predictorTrainingSeed"]==b["seed"]and len(prepared["originalRunIds"])==count and len(set(prepared["originalRunIds"]))==count,"Whole original segment")
 need(same(prepared["evidence"]["hostObservationBinding"],value["binding"]),"Prepared host input binding")
 validate_profile(profile,value["profileReady"],b,prepared)
 original=read(b["profileWorkerConfiguration"]);op=read(b["profileOperation"]);config=copy.deepcopy(original)
 experiment=read(prepared["experiment"]);native=read(prepared["configuration"])
 need([x["runId"]for x in native["runs"]]==prepared["originalRunIds"]and native["stage"]==stage,"Executed original order/stage")
 need(native.get("splitGuardPath") and native.get("otlpBaseUrl"),"Original qualified guard and telemetry preserved")
 need(len(experiment["stages"])==1 and experiment["stages"][0]["id"]=="native","Whole native experiment")
 maximum=experiment["maximumSeconds"];need(type(maximum)is int and 0<maximum<=28800,"Finite native experiment")
 need(experiment["deadline"]<=b["hardDeadline"]-300 and time.time()+maximum+360<min(experiment["deadline"],b["phaseDeadline"]-180),"Full current native window must fit")
 environment={**original["environment"],**prepared["environment"]}
 need(environment["ACEPHALE_HOST_STATUS_FILE"]==b["hostStatusFile"],"Worker guard status matches prepared binding")
 need(environment["ACEPHALE_BUDGET_RPC_PARTICIPANT"]==prepared["correctiveParticipantId"]and prepared["correctiveParticipantId"]==b["attemptId"]+":segment-"+str(number),"Exact RPC participant")
 need(environment["ACEPHALE_BUDGET_RPC_SHA256"]=="a4b05b6f3b97189a8f478b6bf6bfb75ee88fa4c61aa54e2dd9ff7a12bbedb730","Existing production04")
 need("register02.mjs"in environment["NODE_OPTIONS"],"Existing RPC preload required")
 need(not any("WAIVER"in k for k in environment),"No native guard waiver")
 config.update(kind="acephale-corrective-native-worker-v1",unitId="corrective/"+unit,attemptId=b["attemptId"],
 inputSha256=value["preparedSegment"]["sha256"],outputRoot=b["outputRoot"],experiment=clean(prepared["experiment"]),
 experimentOutput=str(Path(prepared["experiment"]["path"]).parent/"run"),guardSource=pin("guard"),environment=environment,
 transport=read(b["transport"]),outputPrefix="workers/"+b["resourceAttemptId"]+"/"+b["attemptId"])
 config["admission"]["value"].update(mode="native",stageId="corrective-"+unit.replace("/","-"),
 experimentPath=prepared["experiment"]["path"],experimentSha256=prepared["experiment"]["sha256"],
 preparationSha256=prepared["preparation"]["sha256"])
 # Original admission remains bound to the same genuine qualification occurrence and serving plan.
 need(same(config["qualificationTerminal"],prepared["evidence"]["qualificationEvidence"]),"Same current qualification")
 sources=[clean(x)for x in original["sourceFiles"]if x["path"]!=original["guardSource"]["path"]]
 sources.extend([pin("guard"),ref(Path(PINS["guard"][0]).with_name("phase_admission.py")),clean(prepared["evidence"]["nativeRunner"]),clean(prepared["evidence"]["nativeRpcTelemetry"])])
 config["sourceFiles"]=list({x["path"]:x for x in sources}.values())
 return config,op,maximum
def bootstrap(delivery,archive,config,confref,command,systemdmax,existing_files):
 return """from pathlib import Path
import boto3,hashlib,json,tarfile,io,subprocess,os
s3=boto3.client('s3',region_name='us-east-1')
def get(r):
 data=s3.get_object(Bucket=r['bucket'],Key=r['key'],VersionId=r['versionId'])['Body'].read()
 assert hashlib.sha256(data).hexdigest()==r['sha256'];return data
"""+"D="+repr(delivery)+"\nA="+repr(archive)+"\nC="+repr(config)+"\n"+"""
assert Path('/sys/devices/virtual/dmi/id/board_asset_tag').read_text().strip()==C['instanceId']
assert not Path(C['outputRoot']).exists() and not Path(C['experimentOutput']).exists()
for r in """+repr(existing_files)+""":
 p=Path(r['path']);assert p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==r['sha256']
 if str(p).startswith('/run/'):
  st=p.stat();assert st.st_uid==0 and not st.st_mode&0o022
obs=Path(C['transport']['linuxObservation']['inputs']['outputRoot'])
assert not obs.exists()
for p in reversed([obs.parent,*obs.parent.parents]):
 if str(p).startswith('/run/acephale-corrective-observation'):
  p.mkdir(exist_ok=True,mode=0o700);st=p.stat();assert st.st_uid==0 and not st.st_mode&0o022 and not p.is_symlink()
v=json.loads(get(D));app=Path(v['applicationRoot']);created=False
if not app.exists():
 app.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run(['git','clone','--shared','--no-hardlinks',v['cleanScienceRoot'],str(app)],check=True,capture_output=True);created=True
if not(app/'node_modules').exists():(app/'node_modules').symlink_to(Path(v['cleanScienceRoot'])/'node_modules',target_is_directory=True)
expected={str(Path(r['path'])).lstrip('/'):r for r in v['files']}
assert len(expected)==len(v['files'])
seen=set()
with tarfile.open(fileobj=io.BytesIO(get(A)),mode='r|gz')as t:
 for member in t:
  assert member.isfile()and member.name in expected and member.name not in seen
  r=expected[member.name];seen.add(member.name)
  p=Path(r['path']);assert p.is_absolute()and p.is_relative_to('/REQUIRED_BINDINGS/research-root')and not p.is_relative_to('/REQUIRED_BINDINGS/research-root/shared')and '..'not in p.parts
  assert not any(x.is_symlink()for x in(p,*p.parents))
  data=t.extractfile(member).read();assert hashlib.sha256(data).hexdigest()==r['sha256']
  if p.exists()and hashlib.sha256(p.read_bytes()).hexdigest()!=r['sha256']:
   assert created and p.is_relative_to(app),'Existing unequal protected file: '+str(p)
  if not p.exists()or hashlib.sha256(p.read_bytes()).hexdigest()!=r['sha256']:
   p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+'.stage-'+str(os.getpid()))
   with tmp.open('xb')as f:f.write(data);f.flush();os.fsync(f.fileno())
   os.chmod(tmp,0o644);os.replace(tmp,p)
assert seen==set(expected)
for r in v['files']:assert hashlib.sha256(Path(r['path']).read_bytes()).hexdigest()==r['sha256']
"""+"subprocess.run("+repr(["systemd-run","--unit=acephale-"+config["attemptId"],"--property=RuntimeMaxSec="+str(systemdmax),"--property=TimeoutStopSec=180","--property=KillMode=control-group","--property=Restart=no",*command])+",check=True)\nprint(json.dumps({'issued':True,'configurationSha256':"+repr(confref["sha256"])+"}))\n"
def financial_lineage_runtime_files(lineage_ref):
 """Exact runtime reads performed by financial_namespace.context; no ledger open."""
 lineage=read(lineage_ref)
 need(lineage["kind"]=="acephale-corrective-native-financial-lineage-v1","Financial lineage kind")
 receipts=lineage["closedCohortReceipts"]
 need(isinstance(receipts,list)and receipts,"Declared predecessor receipts required")
 required=[clean(lineage_ref)]
 for receipt_ref in receipts:
  receipt_path=checked(receipt_ref)
  receipt=read(receipt_ref)
  members=[row for row in receipt["files"]if row.get("path")=="configuration.json"]
  need(len(members)==1,"Exact predecessor configuration member required")
  target=receipt_path.parent/"configuration.json"
  need(target.is_absolute()and target.is_relative_to("/REQUIRED_BINDINGS/research-root/workspaces")
       and not any(p.is_symlink()for p in(target,*target.parents)),
       "Safe predecessor configuration sibling required")
  member={"path":str(target),"sha256":members[0]["sha256"]}
  checked(member)
  required.extend([clean(receipt_ref),member])
 unique={}
 for item in required:
  need(item["path"]not in unique or unique[item["path"]]==item,"Conflicting required predecessor file")
  unique[item["path"]]=item
 return list(unique.values())

def package(value,output):
 need(value["kind"]=="acephale-corrective-native-package-input-v1","Package input kind")
 b=read(value["binding"]);prepared=read(value["preparedSegment"]);profile=read(value["profileReady"])
 config,baseop,maximum=compose(value,b,prepared,profile)
 output=newout(output);worker=pin("worker");publisher=pin("publisher")
 config['childCredentials']={'source': {'path': '/REQUIRED_BINDINGS/research-root/workspaces/report/full-dag-controller-02/child_credentials.py', 'sha256': '363a2a7460bccc9dad45cfc8398640bd62eb548f1942edf116e13220fa6a621a'}, 'secret': {'arn': 'REQUIRED_RESOURCE_ARN', 'versionId': 'd9cef044-4f0e-45e5-b4d4-38993fc4a51f', 'jsonKeys': ['OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID']}}
 config['sourceFiles'].append(config['childCredentials']['source'])
 config['sourceFiles'].append(worker)
 configref=save(output/"worker-configuration.json",config)
 command=["/REQUIRED_BINDINGS/research-root/ops-venv/bin/python","-B",worker["path"],"--configuration",configref["path"],"--sha256",configref["sha256"]]
 contract=save(output/"CONTRACT.json",{"command":command,"configuration":configref,"originalExperiment":prepared["experiment"],"automaticRetry":False})
 owner=save(output/"OWNER-READY.json",{"command":command,"configuration":configref,"contract":contract,"preparedNative":value["preparedSegment"],"profileReady":value["profileReady"]})
 claim={"pk":"unit#"+config["unitId"],"unitId":config["unitId"],"attemptId":config["attemptId"],"inputSha256":config["inputSha256"],
 "resourceAttemptId":b["resourceAttemptId"],"instanceId":b["instanceId"],"hardDeadline":b["hardDeadline"],"sourceCommit":SCIENCE,
 "permanent":True,"status":"running","validationStatus":"unvalidated","scientificAcceptanceAsserted":False,
 "scientificUnitOriginalName":b["unitId"],"originalRunIds":prepared["originalRunIds"],"historicalFailurePreserved":True}
 intent=save(output/"CLAIM-INTENT.json",{"claim":claim,"contract":contract,"ready":owner})
 # Read-only closure walk: no shared ledger, credentials, model tensors, or environments enter delivery.
 files={};seen=set();historical=[];existing=[]
 def add(r,strict=True):
  p=Path(r["path"])
  if not p.exists():
   if strict:raise ValueError("Required delivery file missing: "+str(p))
   historical.append(r);return
  if not p.is_file()or p.is_symlink():return
  if not p.is_relative_to("/REQUIRED_BINDINGS/research-root")or p.is_relative_to("/REQUIRED_BINDINGS/research-root/shared"):return
  if p.suffix in(".safetensors",".pt",".bin")or any(x in str(p)for x in("/node_modules/","/.git/","/locked-environments-02/")):return
  actual=ref(p)
  if actual["sha256"]!=r["sha256"]:
   if strict:raise ValueError("Required delivery identity: "+str(p))
   historical.append(r);return
  files[str(p)]=actual
 def scan(v):
  if isinstance(v,dict):
   if isinstance(v.get("path"),str)and isinstance(v.get("sha256"),str)and v["path"].startswith("/REQUIRED_BINDINGS/research-root/"):
    add(v,False);p=Path(v["path"])
    if str(p)in files and p.suffix==".json"and str(p)not in seen and p.stat().st_size<16_000_000:
     seen.add(str(p))
     try:scan(json.loads(p.read_bytes().decode("utf-8-sig")))
     except (ValueError,UnicodeError):pass
    return  # FileRef identity is atomic; never reinterpret its path as current unpinned bytes.
   for x in v.values():scan(x)
  elif isinstance(v,list):
   for x in v:scan(x)
  elif isinstance(v,str)and v.startswith("/REQUIRED_BINDINGS/research-root/")and Path(v).is_file():add(ref(v),False)
 for v in(config,prepared,profile,b):scan(v)
 template=read(b["nativeTemplate"]);scan(template)
 for r in financial_lineage_runtime_files(prepared["evidence"]["financialLineage"]):add(r)
 for r in config["sourceFiles"]:add(r)
 for r in template["workerPackagingMustMirrorSourceClosure"]:
  # Node binary and readonly original checkout already restored: verify at worker, do not repack.
  if "/bin/node" in r["path"]:existing.append(clean(r))
  else:add(r)
 for key in("experiment","preparation","configuration","guard","manifest","cohortPlan","cohortReservation"):add(prepared[key])
 for p in Path(prepared["experiment"]["path"]).parent.rglob("*"):
  if p.is_file()and not p.is_symlink():add(ref(p))
 appbinding=read(prepared["evidence"]["applicationSourceBinding"]);app=Path(appbinding["applicationSourceRoot"])
 for r in appbinding["files"]:add({"path":str(app/r["path"]),"sha256":r["sha256"]})
 for r in value.get("additionalRuntimeFiles",[]):add(r)
 for p in output.glob("*.json"):add(ref(p))
 oi=config["transport"]["linuxObservation"]["inputs"]
 existing.extend(clean(oi[k])for k in("configurationTemplate","relayReceipt"))
 # The original protected template's lease/identity inputs remain on the proven profile host.
 delivery=save(output/"DELIVERY.json",{"files":list(files.values()),"applicationRoot":str(app),
 "applicationBinding":prepared["evidence"]["applicationSourceBinding"],"cleanScienceRoot":config["sourceDirectory"],
 "existingWorkerFiles":existing,"historicalReferencesNotRestaged":historical})
 archive=output/"payload.tgz"
 with tarfile.open(archive,"w:gz")as tar:
  for name in sorted(files):tar.add(name,arcname=name.lstrip("/"),recursive=False)
 import boto3
 s3=boto3.client("s3",region_name="us-east-1")
 def upload(p):
  data=Path(p).read_bytes();h=digest(data);key="REQUIRED_ARTIFACT_KEY_PREFIX/report/corrective-native-operation-02/objects/"+h+"/"+Path(p).name
  response=s3.put_object(Bucket=config["bucket"],Key=key,Body=data)
  return {"bucket":config["bucket"],"key":key,"versionId":response["VersionId"],"sha256":h,"bytes":len(data)}
 ar=upload(archive);dr=upload(delivery["path"])
 script=bootstrap(dr,ar,config,configref,command,maximum+300,existing)
 compile(script,"native-worker-admission","exec")
 pub=save(output/"publication.json",{"operationId":b["operationId"],"instanceId":b["instanceId"],"region":baseop["publisher"].get("region","us-east-1"),
 "publicationDirectory":str(output/"publication"),"workerAdmissionScript":script,"archive":ar,"delivery":dr})
 previous=value.get("previousOwner",{"unitId":profile["unitId"],"attemptId":profile["attemptId"],"terminal":profile["terminal"]})
 pt=read(previous["terminal"]);need(pt["attemptId"]==previous["attemptId"]and pt["ownedProcessesDrained"]is True,"Actual previous resource owner drain")
 dependencies=[{"unitId":profile["unitId"],"equals":{"attemptId":profile["attemptId"],"directExecutionCompleted":True,"profileValid":True,"currentProfileReady":value["profileReady"]}}]
 if previous["attemptId"]!=profile["attemptId"]:
  dependencies.append({"unitId":previous["unitId"],"equals":{"attemptId":previous["attemptId"],"directExecutionCompleted":True}})
 dependencies.extend(value.get("dependencies",[]))
 operation={"kind":"goalspec-direct-owner-ready-operation-v1","owner":"EXECUTION","operationId":b["operationId"],
 "unitId":config["unitId"],"attemptId":b["attemptId"],"inputSha256":config["inputSha256"],"hardDeadline":b["hardDeadline"],
 "automaticScientificRetry":False,"validationStatus":"unvalidated","scientificAcceptanceAsserted":False,
 "transport":"existing-owner-publisher","providerMutation":False,"newReservation":False,"fundingClass":"hosted-funded",
 "requiredRunwaySeconds":maximum+360,"publicationMaximumSeconds":60,"ownerReady":owner,"payloadSource":worker,"ownerClaimIntent":intent,
 "resource":baseop["resource"],"previousResourceOwner":previous["attemptId"],
 "priorDrainEvidence":[{"ref":previous["terminal"],"equals":{"attemptId":previous["attemptId"]},"drained":["ownedProcessesDrained"]}],
 "dependencies":dependencies,"journalOwnerRequired":False,"publisher":{"source":publisher,"operation":"publish-existing-command",
 "argv":["/REQUIRED_BINDINGS/research-root/ops-venv/bin/python",publisher["path"],"--configuration",pub["path"],"--sha256",pub["sha256"]],"cwd":str(Path(publisher["path"]).parent)},
 "expectedCanonical":{"resourceAttemptId":b["resourceAttemptId"],"instanceId":b["instanceId"]},
 "originalSemanticUnit":b["unitId"],"originalRunIds":prepared["originalRunIds"],"cohortReservation":prepared["cohortReservation"],
 "profileReady":value["profileReady"],"genericWorkerWireKindsPreserved":True,
 "terminalKind":"acephale-corrective-original-profile-terminal-v1","exportKind":"acephale-corrective-profile-export-v1"}
 opref=save(output/"OPERATION.json",operation)
 result={"kind":"acephale-corrective-native-operation-ready-v1","operation":opref,"configuration":configref,
 "preparedSegment":value["preparedSegment"],"profileReady":value["profileReady"],"binding":value["binding"],"archive":ar,"delivery":dr,
 "publicationConfiguration":pub,"originalRunIds":prepared["originalRunIds"],"fileCount":len(files),"workerCommandIssued":False,"ledgerAccessed":False,"claimWritten":False}
 save(output/"READY.json",result);return result
def main():
 p=argparse.ArgumentParser();p.add_argument("--inputs",required=True);p.add_argument("--sha256",required=True);p.add_argument("--output",required=True)
 a=p.parse_args();v=read({"path":a.inputs,"sha256":a.sha256})
 f=prepare_binding if v.get("kind")=="acephale-corrective-native-operation-binding-v1"else package
 r=f(v,a.output);print(json.dumps({"ready":ref(Path(a.output)/"READY.json"),"result":r}))
if __name__=="__main__":main()
