"""Read-only direct-result paper assembly. Never calls models or acceptance/ledger code."""
import argparse, datetime, hashlib, json, math, os, re, shutil, subprocess, zipfile
from pathlib import Path
BASE_SHA = "5ceb04fc8450282cb6d293e51ebf9616f4b0b9cdcc7565f848fa96692f4e5813"
REPORT_SOURCE_SHA = "30822e07abe90b7402ef73b990d49284a9c55f4fcb9a8a7e243a533d01fd5801"
PYTHON = "/REQUIRED_BINDINGS/04-python"
ASSEMBLER_SHA = "479ca4cc9d90be9c0e55058fb19578bdb5a6ba6bbf7619247bde379443ffceef"
RENDERER_SHA = "a96cc2aa0583dbf3383f1372d9344a20bb729fbef2bd4464bc96f6f0e81ef051"
EXPECTED_MANUSCRIPT = "db070e293521e6464a9b73af2ed02f73f487358f5e9e5e8c46313d75da0f4dfb"
FORMATTER_PATH = "/REQUIRED_BINDINGS/03-native_section.py"
FORMATTER_SHA = "efae1bd776fe86080b3ac391921dbe6dea6101ee6450ee4f0406ae52c24b77cc"
FINAL_FIDELITY_REF = {"path":"/REQUIRED_BINDINGS/01-final_native_fidelity_04.py","sha256":"8dde821c2ae225e85d5a7e2e62cff7ec21bfaae7ca89034ff7fefa11a4476d23"}
PREVIEW_REF = {"path":"/REQUIRED_BINDINGS/02-paper_review_previews.py","sha256":"7abd0644ac53c42f6a74177b3bf83c34d8b01956865d85a6d29c77e21c8c4157"}
def need(ok, msg):
    if not ok: raise ValueError(msg)
def sha(b): return hashlib.sha256(b).hexdigest()
def raw(v): return (json.dumps(v, sort_keys=True, indent=2, allow_nan=False)+"\n").encode()
def ref(p):
    p=Path(p);b=p.read_bytes()
    return {"path":str(p),"sha256":sha(b),"bytes":len(b)}
def read(r):
    need(isinstance(r,dict) and isinstance(r.get("path"),str), "Local immutable FileRef required")
    p=Path(r["path"])
    need(p.is_absolute() and ".." not in p.parts and not p.is_symlink() and not any(x.is_symlink() for x in p.parents), "Absolute regular nonsymlink source required")
    need(p.is_file() and p.stat().st_size<=64*1024*1024, "Missing or oversized immutable source")
    need("/REQUIRED_BINDINGS/05-shared" not in str(p) and p.name not in ("budget.jsonl","budget.lock"), "Live journal forbidden")
    b=p.read_bytes()
    need(sha(b)==r.get("sha256") and ("bytes" not in r or len(b)==r["bytes"]), "Immutable FileRef mismatch")
    return b
def relative(name):
    p=Path(name)
    need(not p.is_absolute() and ".." not in p.parts and str(p)==name and name not in ("","."), "Relative package path required")
    return name
def cell(v):
    if v is None:return "not supplied"
    if isinstance(v,bool):return str(v).lower()
    if isinstance(v,(dict,list)):v=json.dumps(v,allow_nan=False,sort_keys=True)
    return str(v).replace("|"," / ").replace("\n"," ")
def table(headers, rows):
    return "\n".join(["| "+" | ".join(headers)+" |","| "+" | ".join(["---"]*len(headers))+" |"]+["| "+" | ".join(cell(x)for x in r)+" |"for r in rows])
def pointer(v,p):
    need(p.startswith("/") or p=="", "JSON pointer required")
    for token in p.split("/")[1:]:
        token=token.replace("~1","/").replace("~0","~")
        v=v[int(token)] if isinstance(v,list) else v[token]
    need(v is None or isinstance(v,(str,bool,int,float,list,dict)), "Display pointer must address recorded JSON value")
    if isinstance(v,float):need(math.isfinite(v),"Finite recorded number required")
    return v
def no_completion(v):
    need(v.get("studyComplete") is False and v.get("scientificAcceptanceAsserted") is False and v.get("validationStatus")=="unvalidated", "Unsupported acceptance/completion assertion")
def projection(report):
    c=report["completeness"]
    rows={}
    for stage,slots in report["originalSlots"].items():
        rows[stage]=None if slots is None else []
        for slot in slots or []:
            outcome=(slot.get("record") or {}).get("outcome",{})
            fields=("reward","constraintViolations","termination","terminationBeforeHostGuard","success","measuredTimingValid","hostInterrupted","providerCalls","authoritativeCalls","speculativeCalls","usefulSpeculativeCalls","billedUsd","unknownProviderCharge","latencyMs","totalTrialSeconds")
            rows[stage].append({"runId":slot["runId"],"originalOrdinal":slot["originalOrdinal"],"executionOrdinal":slot["executionOrdinal"],"assignment":slot["originalAssignment"],"presence":slot["presence"],"preSlotAbort":slot["preSlotAbort"],"recordedFields":{k:outcome[k]for k in fields if k in outcome}})
    return {"kind":"acephale-paper-direct-evidence-projection-v1","studyComplete":False,"scientificAcceptanceAsserted":False,"validationStatus":"unvalidated","canonicalUnits":report["canonicalDisposition"]["units"],"canonicalCounts":report["canonicalDisposition"]["unitCounts"],"claimObservationStarted":report["canonicalDisposition"]["claimObservation"]["startedAt"],"claimObservationFinished":report["canonicalDisposition"]["claimObservation"]["finishedAt"],"coverage":c,"heldoutSelectionStatus":report["heldoutSelectionStatus"],"originalSlots":rows,"raw20":{"completed":report["raw20Disposition"]["actualCompletedRows"],"measuredReadMisses":report["raw20Disposition"]["actualMeasuredFailedRows"],"censoredOrdinals":report["raw20Disposition"]["censoredOriginalRows"],"minimumRequired":report["raw20Disposition"]["minimumCompletedRequired"],"minimumGatePassed":report["raw20MinimumGatePassed"]},"financialSnapshotAvailable":c["financialSnapshotAvailable"],"executionClosureVerified":False,"executionClosureStatus":"not assessed by paper renderer; owner drain/export proofs remain separate"}
def build(value):
    need(value.get("kind")=="acephale-paper-direct-assembly-inputs-v1","Input kind")
    no_completion(value)
    need(value["baseSourceManifest"]["sha256"]==BASE_SHA,"Exact retained source manifest required")
    base=json.loads(read(value["baseSourceManifest"]))
    ready=json.loads(read(value["reportReady"]));no_completion(ready)
    need(ready.get("kind")=="acephale-direct-report-output-binding-v1" and ready["source"]["sha256"]==REPORT_SOURCE_SHA,"Reviewed direct-report producer required")
    read(ready["source"])
    report=json.loads(read(ready["report"]));no_completion(report)
    need(report["statisticsRecomputed"] is False and report["claimsMutated"] is False and report["modelsCalled"] is False,"Reporting-only input required")
    root=Path(value["reportReady"]["path"]).parent.parent
    files={}
    for r in ready["files"]:
        p=Path(r["path"]);name=p.relative_to(root).as_posix()
        relative(name);files["evidence/direct-report/"+name]=read(r)
    need(files.get("evidence/direct-report/report.json")==read(ready["report"]),"Report belongs to exact READY file set")
    files["evidence/direct-report/READY/result.json"]=read(value["reportReady"])
    files["evidence/direct-report-inputs.json"]=read(ready["inputs"])
    files["reproduce/direct_report.py"]=read(ready["source"])
    files["evidence/base-source-manifest.json"]=read(value["baseSourceManifest"])
    files["reproduce/paper_assembly.py"]=Path(__file__).read_bytes()
    for row in base["files"]:
        name=relative(row["relativePath"]);files["editable/paper/"+name]=read(row["source"])
    old=files["editable/paper/manuscript.md"]
    need(sha(old)==EXPECTED_MANUSCRIPT,"Exact retained manuscript required")
    need(sha(files["editable/paper/rendering/assemble.py"])==ASSEMBLER_SHA and sha(files["editable/paper/rendering/render.py"])==RENDERER_SHA,"Exact existing render sources required")
    reportProjection=projection(report);c=report["completeness"];canonical=report["canonicalDisposition"]
    files["editable/paper/current-report/recorded-state.json"]=raw(reportProjection)
    # Literal source pointers copy existing computed values; no formulas or analysis are run.
    displays=[];computed={r["artifact"]["sha256"]:r for r in report["originalComputedReports"]}
    for item in value.get("analysisDisplays",[]):
        need(item["sourceSha256"]in computed,"Requested computed analysis artifact is missing")
        original=computed[item["sourceSha256"]]
        vals=[{"label":f["label"],"pointer":f["pointer"],"value":pointer(original["recordedValues"],f["pointer"])}for f in item["fields"]]
        displays.append({"label":item["label"],"estimand":item["estimand"],"sourceSha256":item["sourceSha256"],"producerSha256":original["producerSource"]["sha256"],"fields":vals})
    files["editable/paper/current-report/copied-analysis-values.json"]=raw(displays)

    # Presentation-only replacement. All report/evidence extraction above is unchanged.
    formatter_ref = {"path": FORMATTER_PATH, "sha256": FORMATTER_SHA}
    formatter_bytes = read(formatter_ref)
    files["reproduce/native_section.py"] = formatter_bytes
    files["reproduce/final_native_fidelity_03.py"] = read(FINAL_FIDELITY_REF)
    files["reproduce/paper_review_previews.py"] = read(PREVIEW_REF)
    final_fidelity = None
    formatter_namespace = {}
    exec(compile(formatter_bytes, FORMATTER_PATH, "exec"), formatter_namespace)
    heldout_reports = [r for r in computed.values()
                       if isinstance(r.get("recordedValues"), dict)
                       and r["recordedValues"].get("stage") == "heldout"]
    need(len(heldout_reports) <= 1, "Unique original heldout computed report required")
    selected = c.get("selectedHeldoutRuns")
    slots = report.get("originalSlots", {}).get("heldout")
    missing = c.get("missingOriginalRunIds", {}).get("heldout")
    covered = (isinstance(selected, int) and not isinstance(selected, bool)
               and selected >= 0 and isinstance(slots, list)
               and len(slots) == selected and missing == []
               and c.get("heldoutRepresentedIds") == selected
               and all(s.get("presence") == "recorded" and not s.get("preSlotAbort") for s in slots))
    heldout_accounted = False
    text = old.decode("utf-8")
    need(text.count("### 5.3 Held-out evaluation") == 1 and
         text.count("## 6. Limitations") == 1, "Exact current manuscript seams required")
    if heldout_reports:
        original = heldout_reports[0]
        actual = original["recordedValues"]
        need(covered and actual.get("status") == "closed" and
             actual.get("declaredSlots") == selected,
             "Original heldout report must account for the actual selected slots")
        direct_inputs = json.loads(files["evidence/direct-report-inputs.json"])
        need(isinstance(direct_inputs.get("ownerResultCollection"), dict),
             "Final original collection reference required for source-bound presentation")
        fidelity_namespace = {"__name__":"_paper_final_fidelity","__file__":FINAL_FIDELITY_REF["path"]}
        exec(compile(files["reproduce/final_native_fidelity_03.py"], FINAL_FIDELITY_REF["path"], "exec"), fidelity_namespace)
        final_fidelity = fidelity_namespace["build"]({
            "collection": direct_inputs["ownerResultCollection"],
            "analysisReport": original["artifact"],
            "analysisProducer": original["producerSource"]})
        files["editable/paper/current-report/final-native-evaluated-path-public.json"] = raw(final_fidelity)
        files["evidence/final-native-evaluated-path-public.json"] = raw(final_fidelity)
        partial = r"(?m)^A separate ongoing held-out log snapshot at 17:51:50 UTC[^\n]*$"
        need(len(re.findall(partial, text)) == 1, "Exact dated partial fidelity paragraph required")
        replacement = final_fidelity["presentation"]["finalHeldoutParagraph"] + (
            " Full final source-bound counts, declared versus recorded seed identities, "
            "retained failures and audit unknowns accompany the "
            "[final evaluated-path evidence](current-report/final-native-evaluated-path-public.json).")
        text = re.sub(partial, lambda match: replacement, text)
        heldout_accounted = True
        section = "### 5.3 Held-out evaluation\n\n" + formatter_namespace["render_native_section"](actual)
        left = text.index("### 5.3 Held-out evaluation")
        right = text.index("## 6. Limitations", left)
        text = text[:left] + section + "\n" + text[right:]
        banner_start = text.index("**Draft:")
        banner_end = text.index("\n\n## Abstract", banner_start)
        banner = ("**Exploratory results - UNVALIDATED.** The retained prediction results, "
                  "36 development runs and all " + str(selected) + " selected held-out arm-runs "
                  "are accounted for in the supplied result artifacts, including retained failures. "
                  "The original opportunity coverage gates remain failed; qualified-study completion "
                  "and full-benchmark acceptance are not asserted.")
        text = text[:banner_start] + banner + text[banner_end:]
        pending = "Held-out evaluation remains pending."
        need(text.count(pending) == 1, "Exact pending abstract sentence required")
        text = text.replace(pending, "The held-out analysis accounts for all " + str(selected)
            + " selected arm-runs; the original reward, constraint-clean and tool-call estimates "
              "are reported separately in Section 5.3.")
    coverage_rows = [
        ["Development", c.get("developmentExpectedRuns"), c.get("developmentRepresentedIds"),
         len(c["missingOriginalRunIds"]["development"])],
        ["Heldout", selected, c.get("heldoutRepresentedIds"),
         None if missing is None else len(missing)]]
    section = "\n".join([
        "### 5.4 Source-bound coverage and limitations", "",
        "**UNVALIDATED; qualified study incomplete.** The tables use immutable original reports. "
        "Recorded failures and censoring remain in their original slots; no trial was replaced "
        "or score recomputed for this paper.", "",
        table(["Stage", "Declared / selected slots", "Represented IDs", "Missing IDs"], coverage_rows), "",
        "The direct-report snapshot retains original ID and execution order, predecessor evidence, "
        "raw opportunity outcomes and copied statistical source artifacts. Source-linked JSON files "
        "accompany the editable manuscript. Row coverage is separate from valid timing, owner "
        "drain/export closure and scientific acceptance.", "",
        "The opportunity minimum-size failures remain unchanged. Report generation neither opens "
        "the budget ledger nor certifies invoices, releases reservations or authorizes termination. "
        "Recorded hosted usage excludes GPU charges and does not prove a cash debit.", "",
        "[Current copied state](current-report/recorded-state.json); "
        "[copied original analysis values](current-report/copied-analysis-values.json).", ""])
    text = text.replace("## 6. Limitations", section + "\n## 6. Limitations")
    files["editable/paper/manuscript.md"]=text.encode("utf-8")
    files["editable/paper/current-report/README.md"]=b"Current evidence is a source-bound snapshot, not an acceptance or termination receipt. Full private evidence and reproduction inputs are stored beside this editable paper. All unchanged earlier metadata retain their original dates.\n"
    files["inputs.json"]=raw(value)
    files["README.md"]=b"# Working paper: incomplete and UNVALIDATED\n\nThis private AWS evidence bundle includes the editable paper, retained figures, exact copied result files and producer sources, renderer inputs and output PDF. Historical assets keep their original provenance. Private operational refs remain in evidence/ and inputs.json; perform a separate privacy projection before public redistribution. No ledger/model/statistical job ran in this build. A new result requires a new immutable direct report and a new output directory. Owner closure and canonical acceptance are separate from this bundle.\n\nReproduce on the existing AWS environment: python -B reproduce/paper_assembly.py --inputs /absolute/original-inputs.json --sha256 <exact input SHA256> --output /new/output. The original FileRefs must still exist byte-exact; no latest-generation discovery or retries are performed. Existing plot source files only reproduce previously computed values. Additional original analyses must be run by the authorized owner and supplied as immutable computed reports; analysisDisplays selects literal JSON pointers only.\n"
    status={"kind":"acephale-direct-working-paper-artifact-status-v1","artifactPrepared":False,"reportPrepared":True,"validationStatus":"unvalidated","studyComplete":False,"scientificAcceptanceAsserted":False,"canonicalCounts":canonical["unitCounts"],"directCoverage":c,"ownerExecutionClosure":{"verified":False,"status":"not assessed by renderer","evidence":value.get("ownerClosure")},"authorizesControllerTermination":False,"statisticsRecomputed":False,"modelsCalled":False,"originalAnalysesCopied":list(computed),"analysisDisplayCount":len(displays),"selectedHeldoutSlotsAccounted":heldout_accounted,"nativeSectionFormatter":formatter_ref,"finalNativePathFidelity":None if final_fidelity is None else {"publicSha256":sha(raw(final_fidelity)),"source":FINAL_FIDELITY_REF,"relativePath":"editable/paper/current-report/final-native-evaluated-path-public.json","originalSelectedCount":final_fidelity["originalSelectedCount"]},"missingAnalysisReasons":value["missingAnalysisReasons"]}
    need(isinstance(value["missingAnalysisReasons"],list),"Explicit missing analysis list")
    if value.get("ownerClosure") is not None:files["evidence/owner-closure.json"]=read(value["ownerClosure"])
    return files,status
def write(p,b):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("xb")as f:f.write(b);f.flush();os.fsync(f.fileno())
def main():
    p=argparse.ArgumentParser();p.add_argument("--inputs",required=True);p.add_argument("--sha256",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    value=json.loads(read({"path":a.inputs,"sha256":a.sha256}));files,status=build(value)
    out=Path(a.output)
    need(out.is_absolute() and ".."not in out.parts and not out.exists() and not any(x.is_symlink()for x in out.parents),"New isolated output required")
    out.mkdir(parents=True)
    for name,b in files.items():write(out/relative(name),b)
    source=out/"editable/paper";assembled=out/"assembled";rendered=out/"rendered"
    commands=[[PYTHON,"-B",str(source/"rendering/assemble.py"),"--source",str(source),"--output",str(assembled)],[PYTHON,"-B",str(source/"rendering/render.py"),"--source",str(assembled),"--output",str(rendered)]]
    for n,argv in enumerate(commands):
        r=subprocess.run(argv,capture_output=True,timeout=180)
        write(out/("command-%02d.json"%n),raw({"argv":argv,"returncode":r.returncode,"stdout":r.stdout.decode(errors="replace"),"stderr":r.stderr.decode(errors="replace")}))
        need(r.returncode==0,"Existing assembly/render failed; output retained")
    import fitz
    pdf=rendered/"acephale-working-manuscript.pdf";doc=fitz.open(pdf);violations=[]
    for n,page in enumerate(doc):
        for block in page.get_text("blocks"):
            x0,y0,x1,y1=block[:4]
            if x0<0 or y0<0 or x1>page.rect.width+0.5 or y1>page.rect.height+0.5:violations.append({"page":n+1,"bbox":[x0,y0,x1,y1]})
    need(not violations,"PDF page-bound violation")
    write(out/"page-bounds.json",raw({"pages":len(doc),"violations":violations,"visualReviewPerformed":False}))
    preview_namespace = {"__name__":"_paper_review_previews","__file__":PREVIEW_REF["path"]}
    exec(compile(read(PREVIEW_REF), PREVIEW_REF["path"], "exec"), preview_namespace)
    review = preview_namespace["write_review_previews"](pdf, out/"review-previews")
    status["reviewPreviews"] = {"manifest":ref(out/"review-previews/manifest.json"),
        "source":PREVIEW_REF,"allPagesRepresented":review["allPagesRepresented"],
        "keyPages":review["keyPages"],"heldoutSectionPages":review["heldoutSectionPages"]}
    status.update({"artifactPrepared":True,"pdf":ref(pdf),"pages":len(doc),"editableManifest":{n:sha(b)for n,b in files.items()if n.startswith("editable/")},"input":ref(a.inputs),"source":ref(__file__),"createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"visualReviewPerformed":False})
    write(out/"artifact-status.json",raw(status))
    with zipfile.ZipFile(out/"editable-and-evidence.zip","x",zipfile.ZIP_DEFLATED)as z:
        for q in sorted(out.rglob("*")):
            if q.is_file() and q.name!="editable-and-evidence.zip" and not q.name.startswith("page-"):z.write(q,q.relative_to(out))
    ready={**status,"bundle":ref(out/"editable-and-evidence.zip"),"files":[ref(q)for q in sorted(out.rglob("*"))if q.is_file()]}
    write(out/"READY/result.json",raw(ready))
    for d in (out/"READY",out,out.parent):
        fd=os.open(d,os.O_RDONLY);os.fsync(fd);os.close(fd)
    print(json.dumps({"ready":ref(out/"READY/result.json"),"pdf":ref(pdf),"bundle":ref(out/"editable-and-evidence.zip"),"pages":len(doc),"studyComplete":False,"scientificAcceptanceAsserted":False}))
if __name__=="__main__":main()
