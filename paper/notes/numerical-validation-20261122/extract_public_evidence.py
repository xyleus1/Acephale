"""Export a whitelist of recorded diagnostic evidence; no model or statistic is computed.

The input is the retained numerical-validation-note-02 integration-inputs JSON.
Its private operational fields are intentionally excluded. Full raw evidence is
access-controlled; this projection is not a release of prompts or cloud records.
"""
from pathlib import Path
import argparse,hashlib,json

def projection(value, input_sha256):
    assert value["kind"] == "acephale-paper-numerical-validation-successor-v2"
    current = value["betaKktCandidate"]
    keep = ("index","adapterState","cacheIntent","requestHash","responseHash",
            "zero","one","logitDifference","conditionalOneProbability",
            "absoluteProbabilityDifference","topTokenId","passedOriginalGate","cachedTokens")
    public_names = {"comparison-first.json","comparison-republished.json",
                    "image-layer-manifest.json","image-receipt.json",
                    "runtime-route-first.json","runtime-route-evidence.json",
                    "query-plan.json","input-binding.json","kkt-ready.md",
                    "qk-decode-route-note.md"}
    public_names.update(f"{kind}-{index}.json" for kind in ("request","response","result") for index in range(4))
    inherited_names = {"baseline-response.json","baseline-recovery.json",
                       "candidate-comparison.json","hf-reference.json",
                       "mechanism-note.md","mechanism-source-evidence.json"}
    sources = [
        {"label": prefix + row["name"], "sha256":row["sha256"], "bytes":row["bytes"]}
        for prefix, rows, selected in (
            ("session03/",value["allCurrentInputReferences"],public_names),
            ("earlier/",value["inheritedInputReferences"],inherited_names))
        for row in rows if row["name"] in selected
    ]
    return {
        "kind":"public-single-probe-numerical-diagnostic-v1",
        "status":"failed numerical gate; no official qualification or scientific acceptance",
        "preservedPaperCommit":value["preservedPaperCommit"],
        "privateIntegrationSourceSha256":input_sha256,
        "referenceProbability":value["referenceProbability"],
        "originalGate":value["originalGate"],
        "baseline":{"completedSequence":False,"repeated":False,
            "recordedProbability":value["baseline"]["recordedNumeric"]["conditionalOneProbability"],
            "recordedAbsoluteDifference":value["baseline"]["recordedNumeric"]["absoluteProbabilityDifference"]},
        "earlierBetaOnlyAdapterRows":[{key:row[key] for key in keep} for row in value["earlierBetaOnlyCandidate"]["adapterRows"]],
        "betaKktRows":[{key:row[key] for key in keep} for row in current["rows"]],
        "earlierHfReference":{"recordedProbability":value["earlierHfReference"]["adapterProbability"],
            "recordedAbsoluteDifference":value["earlierHfReference"]["recordedAbsoluteDifference"],
            "scope":"reference-only; does not qualify serving"},
        "comparisonPublicationsByteIdentical":current["comparisonVersionsByteIdentical"],
        "sourceChanges":[{"filename":Path(row["path"]).name,
            "originalSha256":row["originalSha256"],"candidateSha256":row["patchedSha256"]}
            for row in value["provenance"]["changedFiles"]],
        "baseImageDigest":value["provenance"]["baseImageId"],
        "candidateImageDigest":value["provenance"]["imageId"],
        "nativeExtensionSha256":value["provenance"]["nativeExtensionSha256"],
        "nativeExtensionUnchanged":value["provenance"]["nativeExtensionUnchanged"],
        "recordedServingSettings":{"modelDtype":"bfloat16","loraDtype":"bfloat16",
            "maxModelLength":8192,"maxSequences":1,"logprobsMode":"raw_logprobs","maxLoraRank":16},
        "runtimeRoute":{"selectedPrefill":"FlashInfer GDN","selection":"auto","headDimension":128,
            "patchedTritonKktExercisedOnSelectedPrefill":False,"tokenSpeculativeConfig":None,
            "perKernelRequestTracePresent":False,
            "inferenceLimit":"No evidence here that corrected KKT mathematics is ineffective"},
        "cacheStateObserved":None,"cacheHitEstablished":False,
        "diagnosticHandback":{"observedUtc":value["handback"]["observedUtc"],
            "ownerReleased":True,"diagnosticProcessesDrained":True,
            "originalPredictorRestored":True,"actorUnchanged":True,"scientificDispatchAuthorized":False,
            "retainedReceiptSha256":value["handback"]["source"]["sha256"]},
        "interpretationLimits":value["interpretationLimits"],
        "probabilitiesRecomputed":False,"statisticsRecomputed":False,"modelCalls":0,
        "sourceDigests":sources,
        "digestConventions":{"sourceDigests":"SHA256 of original file bytes",
            "requestHashAndResponseHash":"SHA256 of RFC 8785 canonical JSON"}
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--input",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    raw=args.input.read_bytes()
    expected_sha256="7cbd7bedf7ac52247c2799bb7a5e7d9368b95ee48ec64c443946110bb53ff4e4"
    actual_sha256=hashlib.sha256(raw).hexdigest()
    if actual_sha256 != expected_sha256:
        raise SystemExit("Input SHA256 mismatch: expected reviewed snapshot " + expected_sha256 + "; got " + actual_sha256)
    result=projection(json.loads(raw),actual_sha256)
    content=(json.dumps(result,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
    with args.output.open("xb") as output:output.write(content)

if __name__=="__main__":
    main()
