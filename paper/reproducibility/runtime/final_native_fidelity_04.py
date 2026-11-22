"""Read-only final native evidence projection; copies original statistics, never runs models or estimators."""
import argparse, collections, hashlib, json, os
from pathlib import Path

def raw(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def checked(ref, parse=True):
    path = Path(ref["path"])
    if not path.is_absolute() or not path.is_file():
        raise ValueError("Required immutable artifact is missing")
    data = path.read_bytes()
    if sha(data) != ref["sha256"] or ("bytes" in ref and len(data) != ref["bytes"]):
        raise ValueError("Artifact bytes differ from supplied immutable reference")
    return json.loads(data) if parse else data

def file_ref(path):
    path = Path(path); data = path.read_bytes()
    return {"path": str(path), "sha256": sha(data), "bytes": len(data)}

def identity(expected, observed):
    if len(expected) != len(set(expected)) or expected != observed:
        raise ValueError("Original selected run IDs/order are not exactly preserved")

def selected_public_rows(expected_ids, rows):
    observed_ids = [row["runId"] for row in rows]
    if (len(expected_ids) != len(set(expected_ids)) or
            len(observed_ids) != len(set(observed_ids)) or
            len(expected_ids) != len(observed_ids) or
            set(expected_ids) != set(observed_ids)):
        raise ValueError("Missing, duplicate or foreign selected run ID in derived public rows")
    by_id = {row["runId"]: row for row in rows}
    return [by_id[run_id] for run_id in expected_ids]

def inspect_cohorts(receipts, expected_ids, expected_rows):
    all_rows, blocks, totals, estimates = [], [], collections.Counter(), collections.Counter()
    checkpoint_keys, rejected_keys = collections.Counter(), collections.Counter()
    models, suffixes = collections.Counter(), collections.Counter()
    for ordinal, receipt_ref in enumerate(receipts):
        receipt = checked(receipt_ref)
        if receipt.get("closed") is not True:
            raise ValueError("Owner cohort is not closed")
        root = Path(receipt_ref["path"]).parent
        members = {x["path"]: x["sha256"] for x in receipt["files"]}
        if len(members) != len(receipt["files"]):
            raise ValueError("Duplicate cohort artifact paths")
        def member(name, parse=True):
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts or name not in members:
                raise ValueError("Unbound cohort artifact")
            return checked({"path": str(root / relative), "sha256": members[name]}, parse)
        config = member("configuration.json")
        manifest = member("manifest.json")
        outcomes = [json.loads(x) for x in member("outcomes.jsonl", False).splitlines()]
        runs = config["runs"]
        identity([x["runId"] for x in runs], [x["runId"] for x in outcomes])
        arms = {x["runId"]: x["arm"] for x in runs}
        event_bytes = member("service/events.jsonl", False)
        event_counts, block_suffixes = collections.Counter(), collections.Counter()
        for line in event_bytes.splitlines():
            event = json.loads(line); kind = event.get("type")
            event_counts[kind] += 1; totals[kind] += 1
            if kind in ("model_dispatch", "model_completed"):
                request = event["requestId"]; suffix = request.rsplit(":", 1)[-1]
                key = kind + ":" + suffix
                suffixes[key] += 1; block_suffixes[key] += 1
                if kind == "model_dispatch":
                    models[event.get("model", "unknown")] += 1
            if kind in ("infra_checkpoint", "infra_opportunity_rejected"):
                if arms.get(event["runId"]) not in ("neutral_memory_prefetch", "acephale"):
                    raise ValueError("Prefetch event has no declared prefetch arm")
                key = (event["runId"], event["checkpoint"])
                (checkpoint_keys if kind == "infra_checkpoint" else rejected_keys)[key] += 1
            if kind == "infra_opportunity_rejected":
                estimates[json.dumps(event["estimate"], sort_keys=True, allow_nan=False)] += 1
        for declared, outcome in zip(runs, outcomes):
            saved = member(outcome["runId"] + ".json")
            if saved.get("record") != outcome:
                raise ValueError("Saved per-run record differs from original outcome")
            for key in ("runId", "arm", "armOrder", "domain", "familyId", "taskId", "trial", "seed", "predictorTrainingSeed", "pairedBlockId"):
                if key in declared and outcome.get(key) != declared[key]:
                    raise ValueError("Scientific run identity differs from executed configuration")
            verdict = saved.get("verdict") or {}
            audit = verdict.get("constraintAudit") or {}
            simulation = saved.get("simulation") or {}
            public = {key: outcome.get(key) for key in (
                "runId", "arm", "armOrder", "domain", "familyId", "taskId", "trial",
                "seed", "predictorTrainingSeed", "pairedBlockId", "success", "termination",
                "nativeTermination", "constraintViolations", "serviceDrainSucceeded",
                "budget_terminated", "providerCalls", "authoritativeCalls", "speculativeCalls",
                "unknownProviderCharge", "knownUsageSubtotalUsd", "measuredTimingValid")}
            public.update(declaredActorSeed=declared.get("seed"),
                          declaredTrial=declared.get("trial"),
                          recordedActorSeed=outcome.get("seed"),
                          nativeSimulationSeed=simulation.get("seed"),
                          nativeSimulationTrial=simulation.get("trial"),
                          officialReward=verdict.get("officialReward"),
                          evaluationValid=verdict.get("evaluationValid"),
                          rewardPassed=verdict.get("passed"),
                          constraintAuditStatus=audit.get("status"),
                          constraintAuditComplete=audit.get("completeMultisetCoverage"),
                          savedArtifactSha256=members[outcome["runId"] + ".json"],
                          recordedTimingEvidence={key: outcome.get(key) for key in ("hostGuardConfigured", "hostHealthStatus", "unvalidatedHostGuardWaiver", "measuredTimingValid", "validated", "qualificationAsserted", "unvalidatedAnalysisEligible", "unvalidatedObservedTimingAvailable", "serviceReadyBeforeTrial")},
                          hostHealthSamples=[{key: sample.get(key) for key in ("phase", "healthy", "reason")} for sample in outcome.get("hostHealthSamples", [])])
            all_rows.append(public)
        hardware = manifest.get("hardware", {})
        runtime = manifest.get("runtime", {})
        blocks.append({"cohortOrdinal": ordinal, "runIds": [x["runId"] for x in outcomes],
            "cohortReceiptSha256": receipt_ref["sha256"], "runtimeEventsSha256": sha(event_bytes),
            "configurationSha256": members["configuration.json"], "manifestSha256": members["manifest.json"],
            "eventCounts": dict(event_counts), "requestIdsBySuffix": dict(block_suffixes),
            "episodicEmbeddingsConfigured": bool(config.get("episodicEmbeddingsPath")),
            "shadowPrediction": bool(config.get("shadowPrediction", False)),
            "hardware": {k: hardware.get(k) for k in ("provider", "instanceType", "cpu", "gpu", "gpuCount", "gpuMemoryBytes", "ramBytes", "driver")},
            "runtime": {k: runtime.get(k) for k in ("actorImageId", "predictorImageId", "node", "python", "toolParser")},
            "sourceCommit": manifest.get("sourceCommit"),
            "seedIdentities": [{k: row.get(k) for k in ("runId", "declaredActorSeed", "recordedActorSeed", "nativeSimulationSeed", "declaredTrial", "nativeSimulationTrial", "predictorTrainingSeed")} for row in all_rows if row["runId"] in arms],
            "knownNativeSeedMismatches": [row["runId"] for row in all_rows if row["runId"] in arms and row["nativeSimulationSeed"] is not None and row["nativeSimulationSeed"] != row["declaredActorSeed"]],
            "unknownNativeSimulationSeedRows": sum(row["nativeSimulationSeed"] is None for row in all_rows if row["runId"] in arms)})
    execution_ids = [row["runId"] for row in all_rows]
    all_rows = selected_public_rows(expected_ids, all_rows)
    identity(expected_ids, [x["runId"] for x in expected_rows])
    by_id = {x["runId"]: x for x in expected_rows}
    for row in all_rows:
        original = by_id[row["runId"]]
        for key in ("arm", "armOrder", "domain", "familyId", "taskId", "trial", "seed", "predictorTrainingSeed", "pairedBlockId"):
            if key in original and row.get(key) != original[key]:
                raise ValueError("Selected plan identity differs from actual record")
    per_arm = {}
    for row in all_rows:
        arm = per_arm.setdefault(row["arm"], {"recorded": 0, "runtimeSuccess": 0,
            "evaluationValid": 0, "savedRewardOne": 0, "savedRewardZero": 0,
            "unknownReward": 0, "knownConstraintViolations": 0, "unknownConstraintRows": 0,
            "validTimingRows": 0, "knownSpeculativeCalls": 0, "unknownSpeculationRows": 0,
            "unknownProviderChargeRows": 0})
        arm["recorded"] += 1
        arm["runtimeSuccess"] += row["success"] is True
        arm["evaluationValid"] += row["evaluationValid"] is True
        arm["savedRewardOne"] += row["officialReward"] == 1 and row["evaluationValid"] is True
        arm["savedRewardZero"] += row["officialReward"] == 0 and row["evaluationValid"] is True
        arm["unknownReward"] += row["officialReward"] is None or row["evaluationValid"] is not True
        value = row["constraintViolations"]
        arm["knownConstraintViolations"] += value if type(value) is int else 0
        arm["unknownConstraintRows"] += type(value) is not int
        arm["validTimingRows"] += row["measuredTimingValid"] is True
        value = row["speculativeCalls"]
        arm["knownSpeculativeCalls"] += value if type(value) is int else 0
        arm["unknownSpeculationRows"] += type(value) is not int
        arm["unknownProviderChargeRows"] += row["unknownProviderCharge"] is True
    return {"rows": all_rows, "perArmCounts": per_arm, "cohorts": blocks,
        "executionOrderProvenance": {
            "concatenatedOriginalCohortRunIds": execution_ids,
            "perCohortOrderValidatedAgainstExecutedConfiguration": True,
            "derivedPublicRowOrder": "original-selected-run-ids",
            "rawOutcomeOrderChanged": False},
        "eventCounts": dict(totals), "localRequestIdsBySuffix": dict(suffixes),
        "localDispatchModels": dict(models),
        "allPrefetchCheckpointKeysRejected": checkpoint_keys == rejected_keys,
        "exactRecordedOpportunityEstimates": [{"estimate": json.loads(k), "eventCount": n} for k, n in estimates.items()]}

def build(inputs):
    collection = checked(inputs["collection"])
    if collection.get("kind") != "root-complete-original-heldout-export-collection-v1":
        raise ValueError("Expected original heldout export collection")
    for key in ("ownerExecutionClosed", "allChildrenDrained", "rawRowsUnchanged"):
        if collection.get(key) is not True:
            raise ValueError("Required owner closure evidence is missing: " + key)
    if collection.get("scientificAcceptanceAsserted") is not False or collection.get("studyComplete") is not False:
        raise ValueError("Unsupported qualified/full-study completion assertion")
    if collection.get("missingRunIds") or collection.get("duplicateRunIds"):
        raise ValueError("Incomplete or duplicate original selected coverage")
    selection = checked(collection["selection"])
    expected_ids = selection["selectedRunIds"]
    expected_rows = checked(collection["originalRunRows"])
    if collection["originalSelectedCount"] != len(expected_ids) or collection["observedCount"] != len(expected_ids):
        raise ValueError("Selected/observed counts differ")
    receipts = checked(collection["receiptInputs"])
    evidence = inspect_cohorts(receipts, expected_ids, expected_rows)
    copied_report = checked(inputs["analysisReport"])
    checked(inputs["analysisProducer"], False)
    if copied_report.get("stage") != "heldout" or copied_report.get("declaredSlots") != len(expected_ids):
        raise ValueError("Original analysis does not cover this heldout selection")
    expected_sources = {(x["cohortReceiptSha256"], x["runtimeEventsSha256"]) for x in evidence["cohorts"]}
    actual_sources = {(x["cohortReceiptSha256"], x["runtimeEventsSha256"]) for x in copied_report["sources"]}
    if actual_sources != expected_sources:
        raise ValueError("Original analysis is not bound to these exact cohort event logs")
    evidence.update(schemaVersion=1, title="Final direct-unvalidated heldout scientific evidence",
        validationStatus="unvalidated", scientificAcceptanceAsserted=False, studyComplete=False,
        directSelectedExecutionClosed=True, originalSelectedRunIds=expected_ids,
        originalSelectedCount=len(expected_ids), statisticsRecomputed=False, modelCallsPerformed=False,
        copiedOriginalAnalysis=copied_report,
        sourceHashes={k: inputs[k]["sha256"] for k in ("collection", "analysisReport", "analysisProducer")},
        gateSource={"repositoryRelativePath":"src/lib/acephale/infra-session.ts",
            "sha256":"df3c8273572a130f4d35654247e6e25ac030ed3c6ab4f4e9263613f21f44ebbe",
            "lines":"16-22,115-130"},
        limitations=["Direct-unvalidated execution coverage is distinct from canonical scientific acceptance.",
            "Original failed opportunity requirements are unchanged.",
            "Saved reward, runtime success and constraint-clean success are distinct.",
            "Unknown audits/costs and all original failure/censor records are retained.",
            "Original statistical estimates and intervals are copied, not recomputed.",
            "Declared/recorded actor seed and saved native simulation seed/trial are separate fields; null simulation trials are not filled. Predictor training seed remains nominal configuration, with no inference efficacy claim when never invoked.",
            "Predictor training seed, native trial seed, task variant and weight-group time may be confounded; original joint-consistency denominators/nulls are copied unchanged.",
            "Provider-usage-derived recorded model costs are not reconciled invoices or cash debits."])
    counts = evidence["localRequestIdsBySuffix"]
    dispatch = evidence["eventCounts"].get("model_dispatch", 0)
    actor = counts.get("model_dispatch:actor", 0)
    auxiliary = counts.get("model_dispatch:goals", 0) + counts.get("model_dispatch:candidates", 0)
    rejected = evidence["eventCounts"].get("infra_opportunity_rejected", 0)
    checkpoints = evidence["eventCounts"].get("infra_checkpoint", 0)
    gate_all = evidence["allPrefetchCheckpointKeysRejected"]
    paragraph = (f"The closed {len(expected_ids)}-run heldout export records {dispatch} local model dispatches: "
        f"{actor} actor calls and {auxiliary} auxiliary goal/candidate calls. It records "
        f"{rejected} opportunity rejections across {checkpoints} prefetch-arm checkpoints. ")
    if gate_all and dispatch == actor and auxiliary == 0:
        paragraph += ("Every recorded prefetch checkpoint returned at the original perfect-predictor opportunity gate "
            "before memory retrieval, goal inference or ranking. The native arms were nominal configurations "
            "executing demand-only actor behavior; these outcomes do not measure auxiliary-predictor efficacy. ")
    else:
        paragraph += "The complete event counts above, rather than the earlier partial snapshot, define the evaluated path. "
    if not any(x["episodicEmbeddingsConfigured"] for x in evidence["cohorts"]):
        paragraph += "No cohort configured episodic embeddings/vector retrieval. "
    paragraph += "The original timing-validity flags, failures, censoring and constraint-audit unknowns remain unchanged."
    evidence["presentation"] = {"finalHeldoutParagraph": paragraph,
        "replacesDatedPartialHeldoutSnapshot": True, "canonicalAcceptanceAsserted": False}
    invalid = [row for row in evidence["rows"] if row["measuredTimingValid"] is not True]
    reason_rows = collections.Counter()
    unknown_reasons = 0
    for row in invalid:
        reasons = {sample.get("reason") for sample in row["hostHealthSamples"] if isinstance(sample.get("reason"), str)}
        reason_rows.update(reasons)
        unknown_reasons += not reasons
    evidence["recordedTimingInvalidity"] = {"invalidOrUnknownTimingRows": len(invalid),
        "rowsByVerbatimSampleReason": dict(reason_rows), "rowsWithoutRecordedReason": unknown_reasons,
        "reasonCountsAreRowsNotSamples": True,
        "source": {"file": "infra_native_runner.py", "sha256": "cefd5f311822ca08387c433d9a4c96cf02e9b3df7d12aa74d3e431c74791d135", "lines": "43-51"},
        "sourceMeaning": "The missing-guard-only branch preserves host_guard_not_configured as unobserved host health and measuredTimingValid=false; it does not waive a configured stale/down guard."}
    if reason_rows:
        evidence["presentation"]["finalHeldoutParagraph"] += " Recorded timing-invalidity sample reason codes: " + ", ".join(sorted(reason_rows)) + "."
    data = raw(evidence)
    for marker in (b"/srv/", b"s3://", b"arn:aws:", b"AWS_ACCOUNT_ID", b"http://127.", b"SecretAccessKey", b"AccessKeyId"):
        if marker in data:
            raise ValueError("Public projection contains private operational metadata")
    return evidence

def write_new(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(raw(value)); stream.flush(); os.fsync(stream.fileno())
    return file_ref(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True); parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True); args = parser.parse_args()
    inputs = checked({"path": args.inputs, "sha256": args.sha256})
    evidence = build(inputs)
    output = Path(args.output)
    if not output.is_absolute() or output.exists():
        raise ValueError("Output must be a new absolute directory")
    output.mkdir(parents=True)
    public = write_new(output / "final-native-evaluated-path-public.json", evidence)
    ready = {"kind": "final-native-scientific-reporting-qa-v1", "validationStatus": "unvalidated",
        "scientificAcceptanceAsserted": False, "studyComplete": False,
        "modelCallsPerformed": False, "statisticsRecomputed": False,
        "inputs": file_ref(args.inputs), "source": file_ref(__file__),
        "finalNativePathFidelity": {"publicFile": public, **evidence["presentation"]}}
    result = write_new(output / "READY/result.json", ready)
    print(json.dumps({"result": result, "publicFile": public}))

if __name__ == "__main__":
    main()
