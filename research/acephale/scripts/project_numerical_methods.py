"""Copy numerical-method observations from a closed study, without scoring it.

Use the reviewed run's publication and numerical-provenance readers. This is a
separate attachment: it does not modify frozen reports or their publication policy.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

OCCURRENCES = ("seed17-01", "seed29-01", "seed17-02", "seed29-02")
NATIVE_STAGES = {
    "seed17-01": ("opportunity",),
    "seed29-01": ("opportunity", "development"),
    "seed17-02": ("development", "heldout"),
    "seed29-02": ("heldout",),
}
GATE = {
    "version": 1,
    "requireTopTokenMatch": True,
    "maximumConditionalProbabilityDifference": 0.01,
}
NOTES = [
    "These are serving qualification observations, not task accuracy or live latency scores.",
    "Each occurrence requests baseline three times, then split_k1 three times; proof uses configured index zero.",
    "Cache order is requested cold, warm, cold using salt domains A, A, B; intent does not establish a cache hit.",
    "Every configured request must pass the unchanged top-token and 0.01 probability gate.",
    "Only the predictor's standard vLLM SHRINK split_k setting changes to one; actor, weights and reference stay fixed.",
    "Attestation observes the installed standard resolver in the same image and container, not an engine kernel trace.",
    "These observations do not establish determinism or the cause of historical numerical failures.",
    "Raw prompts, token arrays, responses, private paths and host identifiers are excluded.",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Regular source file required")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_reviewed(name, path, expected):
    require(sha(path) == expected, "Reviewed reader source changed")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def diagnostic_projection(reader, value, variant):
    require(value.get("kind") == "acephale-fixed-serving-parity-diagnostic-v1"
            and value.get("variant") == variant and value.get("fixedRequestCount") == 3
            and value.get("selectedProofIndex") == 0 and value.get("originalGate") == GATE
            and value.get("deterministicExecutionProven") is False
            and value.get("benchmarkAccuracyMeasured") is False,
            "Fixed diagnostic protocol changed")
    rows = value["rows"]
    require(type(rows) is list and len(rows) == 3, "All three fixed observations required")
    projected = []
    for index, (row, intent) in enumerate(zip(rows, ("cold_requested", "warm_requested", "cold_requested"), strict=True)):
        require(type(row["index"]) is int and row["index"] == index
                and row["cacheIntent"] == intent, "Fixed diagnostic order changed")
        passed = reader.boolean(row["passed"])
        require((passed and row["gateFailure"] is None) or
                (not passed and row["gateFailure"] == "Cross-engine binary probability gate failed"),
                "Non-numerical failure cannot be a diagnostic result")
        probability = reader.rate(row["observedConditionalOneProbability"])
        difference = reader.rate(row["conditionalProbabilityDifference"])
        require(passed == (difference <= GATE["maximumConditionalProbabilityDifference"]),
                "Stored pass flag and numerical difference disagree")
        if passed:
            receipt = row["receipt"]
            require(receipt.get("passed") is True and receipt.get("gate") == GATE
                    and receipt.get("responseHash") == row["responseHash"]
                    and receipt.get("observedConditionalOneProbability") == probability
                    and receipt.get("conditionalProbabilityDifference") == difference,
                    "Stored diagnostic values differ from the original qualification receipt")
        else:
            require(row["receipt"] is None, "Failed numerical probe cannot have a passing receipt")
        observed = reader.boolean(row["cacheTokenCountObserved"])
        cached = reader.count(row["cachedTokens"]) if observed else None
        require(observed or row["cachedTokens"] is None, "Missing cache telemetry cannot imply zero")
        projected.append({
            "index": index, "cacheIntent": intent, "passed": passed,
            "observedConditionalOneProbability": probability,
            "conditionalProbabilityDifference": difference,
            "cachedTokens": cached, "cacheTokenCountObserved": observed,
        })
    all_passed = reader.boolean(value["allPassed"])
    require(all_passed == all(row["passed"] for row in projected)
            and (variant != "split_k1" or all_passed), "Configured observations must all pass")
    return {"variant": variant, "allPassed": all_passed, "rows": projected}


def occurrence_projection(reader, numerical, root, occurrence, identity, consumed):
    def get(path):
        value = reader.read(path)
        consumed[path] = sha(path)
        return value

    phase = occurrence.replace("-", "_")
    phase_path = root / "downstream/phase-receipts" / (phase + ".json")
    checkpoint_path = root / "successor-sequence" / (phase + ".closed.json")
    receipt, checkpoint = get(phase_path), get(checkpoint_path)
    require(receipt.get("kind") == "acephale-evaluation-successor-phase-v1"
            and receipt.get("completed") is True and receipt.get("optimizerRerun") is False
            and receipt.get("phase") == checkpoint.get("phase") == phase
            and Path(checkpoint["receiptPath"]).resolve() == phase_path.resolve()
            and checkpoint["receiptSha256"] == consumed[phase_path],
            "Actual closed occurrence checkpoint required")
    for value in (receipt, checkpoint):
        require(all(value[key] == identity[key] for key in ("leaseId", "instanceId")),
                "Occurrence belongs to another study")
    binding = numerical.load(root, occurrence)
    require(all(binding[key] == identity[key] for key in ("leaseId", "instanceId")),
            "Serving binding belongs to another study")
    consumed.update({Path(path): digest for path, digest in binding["files"].items()})
    companions = sorted((root / "downstream" / occurrence / "numerical-policy").glob("*.json"))
    expected_stages = {"qualified"}
    if occurrence.endswith("-01"):
        expected_stages.update(("replay", "calibration"))
    expected_stages.update(f"{stage}-{occurrence}-{suffix}" for stage in NATIVE_STAGES[occurrence]
                           for suffix in ("inputs", "outputs"))
    require({path.stem for path in companions} == expected_stages,
            "Every declared numerical companion, including native inputs and outputs, is required")
    evidence = {Path(row["path"]).resolve(): row["sha256"] for row in receipt["evidence"]}
    companion_rows = []
    for path in companions:
        require(evidence.get(path.resolve()) == sha(path),
                "Numerical companion is not bound by the closed occurrence")
        value = numerical.check_companion(root, occurrence, path)
        require(value.get("frozenScientificOutputsModified") is False
                and value.get("diagnosticResponsesUsedAsReplayOrCalibration") is False,
                "Diagnostic and scientific outputs must remain separate")
        consumed[path] = sha(path)
        consumed.update({Path(name): digest for name, digest in value["files"].items()})
        companion_rows.append({"stage": path.stem, "sha256": consumed[path],
                               "contentHash": reader.hexadecimal(64)(value["contentHash"])})
    completed_path = root / f"serving-{occurrence}-stage/verified/serving/serving-completed.json"
    completed = get(completed_path)
    diagnostic_path = numerical.archived(root, occurrence, completed["diagnosticReceiptPath"])
    diagnostic = get(diagnostic_path)
    observations = []
    for key, variant in (("baseline", "baseline"), ("configured", "split_k1")):
        path = numerical.archived(root, occurrence, diagnostic[key + "ReportPath"])
        value = get(path)
        require(consumed[path] == diagnostic[key + "ReportSha256"], "Diagnostic report changed")
        observations.append({"reportSha256": consumed[path], **diagnostic_projection(reader, value, variant)})
    hashes = {key: reader.hexadecimal(64)(binding[key]) for key in (
        "numericalPolicyHash", "effectiveComposeSha256", "tunedConfigSha256",
        "numericalAttestationSha256", "diagnosticReceiptSha256", "baseSourceComposeSha256",
    )}
    return {"occurrence": occurrence, **hashes,
            "phaseReceiptSha256": consumed[phase_path], "checkpointSha256": consumed[checkpoint_path],
            "companions": companion_rows, "diagnostics": observations}


def project(reader, numerical, publication, reader_hashes):
    root = reader.RUN_ROOT.resolve()
    policy = reader.policy()
    report, consumed = reader.verify_closed_run(root, policy, reader.scientific_hash())
    manifest_path = publication / "publication-manifest.json"
    manifest = reader.read(manifest_path)
    consumed[manifest_path] = sha(manifest_path)
    require(manifest["sourceReportSha256"] == consumed[root / policy["reportRelativePath"]]
            and manifest["sourceReportContentHash"] == report["contentHash"]
            and manifest["allowlistSha256"] == reader.POLICY_SHA
            and manifest["projectorSha256"] == reader_hashes["aggregateProjectorSha256"],
            "Publication belongs to another closed report or projection")
    files = manifest["files"]
    require(len(files) == 2 and {row["path"] for row in files}
            == {"aggregate-results.json", "methods-and-limitations.md"},
            "Original aggregate publication manifest required")
    for row in files:
        path = publication / row["path"]
        require(sha(path) == row["sha256"], "Published aggregate file changed")
        consumed[path] = row["sha256"]
    identity_path = root / "successor-sequence/execution-result.json"
    identity = reader.read(identity_path)
    consumed[identity_path] = sha(identity_path)
    occurrences = [occurrence_projection(reader, numerical, root, occurrence, identity, consumed)
                   for occurrence in OCCURRENCES]
    result = {
        "kind": "acephale-public-numerical-methods-v1",
        "sourceReportSha256": manifest["sourceReportSha256"],
        "sourceReportContentHash": manifest["sourceReportContentHash"],
        "publicationManifestSha256": consumed[manifest_path],
        "readerSources": reader_hashes, "originalGate": GATE,
        "requestsPerVariant": 3, "selectedProofIndex": 0,
        "occurrences": occurrences, "notes": NOTES,
        "scoresRecomputed": False, "modelCallsPerformed": False,
    }
    require(all(sha(path) == digest for path, digest in consumed.items()),
            "Closed inputs changed during extraction")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projector", type=Path, required=True)
    parser.add_argument("--projector-sha256", required=True)
    parser.add_argument("--binding-sha256", required=True)
    parser.add_argument("--precision-sha256", required=True)
    parser.add_argument("--publication", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), "Attachment destination must be new")
    sys.dont_write_bytecode = True
    reader = load_reviewed("aggregate_projection", args.projector, args.projector_sha256)
    # This reader verifies the frozen checkout before importing any scientific code.
    reader.scientific_hash()
    sys.path.insert(0, str(reader.ANALYSIS_ROOT / "research/acephale/src"))
    root = reader.RUN_ROOT.resolve()
    load_reviewed("serving_precision", root / "serving_precision.py", args.precision_sha256)
    numerical = load_reviewed("numerical_policy_binding", root / "numerical_policy_binding.py", args.binding_sha256)
    hashes = {"aggregateProjectorSha256": args.projector_sha256,
              "numericalBindingReaderSha256": args.binding_sha256,
              "numericalPrecisionSourceSha256": args.precision_sha256}
    value = project(reader, numerical, args.publication.resolve(), hashes)
    for path, expected in ((args.projector, args.projector_sha256),
                           (root / "serving_precision.py", args.precision_sha256),
                           (root / "numerical_policy_binding.py", args.binding_sha256)):
        require(sha(path) == expected, "Reviewed reader changed during extraction")
    data = (json.dumps(value, indent=2, allow_nan=False) + "\n").encode()
    manifest = {"extractorSha256": sha(__file__),
                "sourcePublicationManifestSha256": value["publicationManifestSha256"],
                "files": [{"path": "numerical-methods.json", "sha256": hashlib.sha256(data).hexdigest()}]}
    args.output.mkdir(parents=False, exist_ok=False)
    with (args.output / "numerical-methods.json").open("xb") as stream:
        stream.write(data)
    with (args.output / "numerical-methods-manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"files": 2, "scoresRecomputed": False, "modelCallsPerformed": False}))


if __name__ == "__main__":
    main()
