from __future__ import annotations

import json
from copy import deepcopy

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_calibration import fit_calibration
from acephale.infra_cli import main
from acephale.infra_data import publish_bundle, read_jsonl
from acephale.infra_fairness import compare_predictor_replays
from acephale.storage import file_hash
from acephale.training_data import BASE


def seal(value):
    body = {key: item for key, item in value.items() if key != "contentHash"}
    return {**body, "contentHash": hash_v1(body)}


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def write_rows(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def fixture(tmp_path):
    families = {"weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"], "developmentFamilies": ["dev"], "testFamilies": ["test"]}
    proposal = seal({"schemaVersion": 1, "kind": "acephale-candidate-only-family-partition", **families})
    review = seal({"kind": "acephale-source-family-review", "reviewer": {"kind": "assistant_source_design"},
                   "humanAnnotationLabelReview": False, "historicalAPIGenExcluded": True, "partitionProposalHash": proposal["contentHash"]})
    partition = seal({**proposal, "executionAuthorized": True, "evaluationEligible": True, "efficacyClaimAllowed": False,
                      "review": {"status": "completed", "reviewerKind": "assistant_source_design", "humanAnnotationLabelReview": False,
                                 "sourceDesignReviewHash": review["contentHash"]}})
    for name, value in (("partition.json", proposal), ("source-design-review.json", review), ("approved.json", partition)):
        write(tmp_path / name, value)
    public, labels, predictions = [], [], []
    for family, split in (("fit", "train"), ("cal", "train"), ("dev", "development")):
        for index in range(2):
            key = family + str(index)
            value = {"policy": "Read only", "events": [], "sources": [], "tools": [{"name": "get", "side_effects": "read_only", "cacheable": True,
                      "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"], "additionalProperties": False}}]}
            scope = {"tenant_id": "research", "principal_id": "actor", "authorization_revision": "auth"}
            public.append({"checkpoint_id": key, "input_hash": hash_v1(value), "family_id": family, "split": split, "input": value,
                           "scope": scope, "environment_version": "env", "tool_schema_hash": "a" * 64})
            labels.append({"checkpoint_id": key, "input_hash": hash_v1(value), "eligible_reads": [{"tool": "get", "arguments": {"id": "yes"}}]})
            candidates = [{"id": item, "invocation": {"tool": "get", "arguments": {"id": item}, "scope": {
                "tenantId": "research", "principalId": "actor", "authorizationVersion": "auth", "environmentVersion": "env", "toolSchemaHash": "a" * 64}}} for item in ("yes", "no")]
            pool_hash = hash_v1(candidates)
            dispatched = {"type": "model_dispatch", "requestId": key, "model": BASE["repository"], "inputHash": hash_v1([key, "base"]),
                          "compiledMessagesHash": hash_v1([key, "messages"]), "compiledTokenIdsHash": hash_v1([key, "tokens"]),
                          "requestContractHash": hash_v1("contract"), "inputTokens": 100, "omittedGroups": [], "selectedMessageIndexes": [0, 1], "compilerVersion": "acephale-local-input-v1"}
            events = [{"type": "infra_candidate_window", "poolHash": pool_hash, "windowHash": pool_hash, "candidateIds": ["yes", "no"]},
                      {"type": "infra_predictor_input", "candidatePoolHash": pool_hash, "candidateWindowHash": pool_hash, "preparedHash": hash_v1([key, "prepared"])},
                      dispatched,
                      {"type": "infra_predictor_compiled", "compiledMessagesHash": dispatched["compiledMessagesHash"], "inputHash": dispatched["inputHash"], "inputTokens": 100, "preparedHash": hash_v1([key, "prepared"])},
                      {"type": "model_completed", "requestId": key, "model": BASE["repository"], "inputHash": dispatched["inputHash"], "timing": {"totalMs": 12}}]
            predictions.append({"checkpoint_id": key, "input_hash": hash_v1(value), "family_id": family, "split": split, "status": "completed",
                                "candidates": candidates, "orderedCandidatePoolHash": pool_hash, "candidatePanel": ["yes", "no"], "panelHash": hash_v1(["no", "yes"]),
                                "neutral": {"action": "READ", "scores": [{"candidateId": "yes", "probability": .8}, {"candidateId": "no", "probability": .2}]},
                                "audit": seal({"version": 1, "events": events, "rowWallMs": 13})})
    bundle = tmp_path / "bundle"
    dataset = publish_bundle(bundle, {"public.jsonl": public, "labels.jsonl": labels})
    selection = seal({"version": 1, "kind": "weight_fit", "sourceDatasetHash": dataset["bundle_hash"],
                      "partitionHash": partition["contentHash"], "partitionSourceSha256": file_hash(tmp_path / "approved.json"),
                      "partitionProposalHash": proposal["contentHash"], "partitionProposalSourceSha256": file_hash(tmp_path / "partition.json"),
                      "sourceDesignReviewHash": review["contentHash"], "sourceDesignReviewSha256": file_hash(tmp_path / "source-design-review.json"), **families})
    memory = seal({"runs": [{"familyId": "fit", "split": "train"}], "familySelection": selection})
    write(tmp_path / "memory.json", memory)
    model_base = {"version": 2, "kind": "uncalibrated_prediction_replay", "probabilitySemantics": "independent_next_batch_hit", "executionAllowed": False,
                  "memoryHash": memory["contentHash"], "predictorContractHash": "a" * 64, "candidateCompilerHash": "b" * 64, "retrievalHash": "c" * 64,
                  "sourceDatasetHash": dataset["bundle_hash"], "predictionMode": "fixed_panel", "inferGoals": False, "partition": "calibration",
                  "predictionProtocol": "rank_binary_v1", "binaryTokenIds": {"zero": 15, "one": 16}, "compilerAuditVersion": 1,
                  "panelSelection": "first_three_common_compiler_candidates_before_goal_inference_v1", "selection": "family-partition-round-robin-v1",
                  "limit": 100, "rowIds": [row["checkpoint_id"] for row in predictions], "episodic": None,
                  "serving": {"contextWindow": 8192, "inputBudget": 7168, "outputCap": 1024, "temperature": 0, "topP": 1, "seed": 0, "stream": True, "enableThinking": False}}
    runs = {}
    for name in ("base_binary", "lora_17", "lora_29"):
        path = tmp_path / name
        path.mkdir()
        model = deepcopy(BASE)
        served = BASE["repository"]
        if name != "base_binary":
            weights = hash_v1(name)
            artifact = seal({"schemaVersion": 1, "kind": "acephale-trained-predictor", "base": BASE,
                             "protocol": "rank_binary_v1", "binaryTokenIds": {"zero": 15, "one": 16},
                             "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"], "adapterHash": hash_v1([name, "adapter"]),
                             "mergedWeightsHash": weights, "tokenizerHash": hash_v1("tokenizer"), "chatTemplateHash": hash_v1("template"),
                             "trainingManifestHash": hash_v1([name, "training"]), "servedModel": "acephale-predictor-" + weights[:12]})
            model["trainedPredictor"] = artifact
            served = artifact["servedModel"]
        write(path / "manifest.json", seal({**model_base, "model": model}))
        rows = deepcopy(predictions)
        for row in rows:
            for event in row["audit"]["events"]:
                if "model" in event:
                    event["model"] = served
                if "inputHash" in event:
                    event["inputHash"] = hash_v1([row["checkpoint_id"], served])
            row["audit"] = seal(row["audit"])
        write_rows(path / "predictions.jsonl", rows)
        write(path / "receipt.json", {"declared": 6, "completed": 6, "failed": 0, "liveActorExecuted": False, "toolExecutionPerformed": False})
        runs[name] = path
    return bundle, runs, tmp_path / "approved.json", tmp_path / "memory.json"


def test_same_reserved_calibration_for_base_and_both_trained_seeds(tmp_path):
    bundle, runs, partition, memory = fixture(tmp_path)
    results = [fit_calibration(bundle, path, partitions_path=partition, memory_path=memory)[0] for path in runs.values()]
    assert all(row["fittingFamilies"] == ["cal"] and row["validationFamilies"] == ["dev"] for row in results)
    assert all(row["bins"] == results[0]["bins"] for row in results)
    assert len({row["provenance"]["reviewedSelection"]["contentHash"] for row in results}) == 1
    legacy, _, _ = fit_calibration(bundle, runs["base_binary"])
    assert legacy["fittingFamilies"] == ["cal", "fit"]
    with pytest.raises(ValueError, match="both partition"):
        fit_calibration(bundle, runs["base_binary"], partitions_path=partition)


def test_reviewed_selector_rejects_trained_family_disagreement(tmp_path):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = runs["lora_17"] / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    artifact = manifest["model"]["trainedPredictor"]
    artifact["calibrationFamilies"] = ["other"]
    manifest["model"]["trainedPredictor"] = seal(artifact)
    write(path, seal(manifest))
    with pytest.raises(ValueError, match="disagrees"):
        fit_calibration(bundle, runs["lora_17"], partitions_path=partition, memory_path=memory)


def test_weight_fit_scores_cannot_change_reviewed_calibration(tmp_path):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = runs["base_binary"]
    before, _, _ = fit_calibration(bundle, path, partitions_path=partition, memory_path=memory)
    rows = read_jsonl(path / "predictions.jsonl")
    for row in rows:
        if row["family_id"] == "fit":
            for score in row["neutral"]["scores"]:
                score["probability"] = 1 - score["probability"]
    write_rows(path / "predictions.jsonl", rows)
    after, _, _ = fit_calibration(bundle, path, partitions_path=partition, memory_path=memory)
    assert before["bins"] == after["bins"]


@pytest.mark.parametrize("pool_available", [True, False])
def test_failed_before_dispatch_is_retained_without_claiming_verified_prompt(tmp_path, pool_available):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = runs["lora_17"]
    rows = read_jsonl(path / "predictions.jsonl")
    rows[-1]["status"] = "failed"
    rows[-1].pop("neutral")
    if not pool_available:
        for key in ("candidates", "candidatePanel", "panelHash", "orderedCandidatePoolHash"):
            rows[-1].pop(key)
    rows[-1]["audit"] = seal({"version": 1, "events": [], "rowWallMs": 3})
    write_rows(path / "predictions.jsonl", rows)
    write(path / "receipt.json", {"declared": 6, "completed": 5, "failed": 1, "liveActorExecuted": False, "toolExecutionPerformed": False})
    report, _ = compare_predictor_replays(bundle, runs, partition, memory)
    assert report["unverifiableFailedPromptCheckpoints"] == ["dev1"]
    assert report["allDevelopmentInputsVerified"] is False
    assert report["conditions"]["lora_17"]["declared_checkpoints"] == 2
    assert report["identical_candidate_panels"] is pool_available


@pytest.mark.parametrize("file,field,value", [("source-design-review.json", "partitionProposalHash", "f" * 64), ("approved.json", "calibrationFamilies", ["fit"]), ("memory.json", "runs", [{"familyId": "cal", "split": "train"}])])
def test_review_and_memory_changes_are_not_accepted_as_new_calibration_labels(tmp_path, file, field, value):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = tmp_path / file
    artifact = json.loads(path.read_text(encoding="utf-8"))
    artifact[field] = value
    write(path, seal(artifact))
    with pytest.raises(ValueError, match="review|family|memory"):
        fit_calibration(bundle, runs["base_binary"], partitions_path=partition, memory_path=memory)


def test_comparison_scores_development_only_and_retains_failed_model_requests(tmp_path):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = runs["lora_17"]
    rows = read_jsonl(path / "predictions.jsonl")
    rows[-1]["status"] = "failed"
    rows[-1].pop("neutral")
    rows[-1]["audit"]["events"] = rows[-1]["audit"]["events"][:3]
    rows[-1]["audit"]["events"].append({"type": "model_failed", "code": "output_schema", "latencyMs": 12})
    rows[-1]["audit"] = seal(rows[-1]["audit"])
    write_rows(path / "predictions.jsonl", rows)
    write(path / "receipt.json", {"declared": 6, "completed": 5, "failed": 1, "liveActorExecuted": False, "toolExecutionPerformed": False})
    report, joined = compare_predictor_replays(bundle, runs, partition, memory)
    assert len(joined) == 6 and all(row["split"] == "development" for row in joined)
    assert report["conditions"]["lora_17"]["status_counts"] == {"completed": 1, "failed": 1}
    assert report["conditions"]["base_binary"]["declared_checkpoints"] == 2
    assert report["heldout_claim"] is False and report["developmentOnly"] is True
    assert report["unverifiableFailedPromptCheckpoints"] == []
    assert all(value["liveLatencyMeasured"] is False for value in report["replayTiming"].values())


@pytest.mark.parametrize("defect", ["protocol", "compiler", "row_order", "prompt", "tokens", "request", "omissions", "order", "audit", "missing_dispatch", "tokenizer"])
def test_comparison_rejects_cross_model_confounders(tmp_path, defect):
    bundle, runs, partition, memory = fixture(tmp_path)
    path = runs["lora_17"]
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    rows = read_jsonl(path / "predictions.jsonl")
    if defect == "protocol":
        manifest["predictionProtocol"] = "rank_marginals_v2"
    elif defect == "compiler":
        manifest["candidateCompilerHash"] = "f" * 64
    elif defect == "row_order":
        manifest["rowIds"].reverse()
    elif defect == "tokenizer":
        artifact = manifest["model"]["trainedPredictor"]
        artifact["tokenizerHash"] = "e" * 64
        manifest["model"]["trainedPredictor"] = seal(artifact)
    else:
        row = rows[-1]
        dispatch = row["audit"]["events"][2]
        if defect == "prompt":
            dispatch["compiledMessagesHash"] = "e" * 64
            row["audit"]["events"][3]["compiledMessagesHash"] = "e" * 64
        elif defect == "tokens":
            dispatch["compiledTokenIdsHash"] = "e" * 64
        elif defect == "request":
            dispatch["requestContractHash"] = "e" * 64
        elif defect == "omissions":
            dispatch["omittedGroups"] = ["memory:episode:omitted"]
        elif defect == "order":
            row["candidates"].reverse()
            row["candidatePanel"].reverse()
            row["orderedCandidatePoolHash"] = hash_v1(row["candidates"])
            for event in row["audit"]["events"][:2]:
                for key in ("poolHash", "windowHash", "candidatePoolHash", "candidateWindowHash"):
                    if key in event:
                        event[key] = row["orderedCandidatePoolHash"]
            row["audit"]["events"][0]["candidateIds"] = row["candidatePanel"]
        elif defect == "missing_dispatch":
            row["audit"]["events"].pop(2)
        row["audit"] = seal(row["audit"])
        if defect == "audit":
            row["audit"]["rowWallMs"] += 1
    write(path / "manifest.json", seal(manifest))
    write_rows(path / "predictions.jsonl", rows)
    with pytest.raises(ValueError):
        compare_predictor_replays(bundle, runs, partition, memory)


def test_comparison_cli_publishes_closed_development_result(tmp_path, capsys):
    bundle, runs, partition, memory = fixture(tmp_path)
    output = tmp_path / "comparison"
    arguments = ["compare-predictor-replays", "--bundle", str(bundle), "--partitions", str(partition), "--memory", str(memory), "--output", str(output)]
    for name, path in runs.items():
        arguments += ["--prediction", f"{name}={path}"]
    main(arguments)
    assert (output / "joined-panels.parquet").is_file()
    assert json.loads((output / "prediction-report.json").read_text(encoding="utf-8"))["developmentOnly"] is True
    with pytest.raises(FileExistsError):
        main(arguments)
    assert "bundle_hash" in capsys.readouterr().out
