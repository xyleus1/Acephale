from __future__ import annotations

import copy
import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_split_guard import load_guard, verify_observation
from acephale.predictor_serving import validate_native_lora_serving
from acephale.training_data import BASE, hashed
from acephale.training_lora import PARITY_GATE, serving_weights_hash

SOURCE = "a" * 40
ROOT = Path(__file__).resolve().parents[3]


def qualified_fixture():
    probe = {"schemaVersion": 1, "kind": "acephale-lora-serving-probe", "inputTokenIds": [10, 20, 30],
             "binaryTokenIds": {"zero": 15, "one": 16}, "referenceLogprobs": {"zero": -1e-7, "one": -1e-7},
             "referenceConditionalOneProbability": 0.5, "topTokenId": 42, "gate": PARITY_GATE, "nativeTaskAccuracyMeasured": False}
    artifact = {"schemaVersion": 2, "kind": "acephale-trained-predictor", "storageMode": "unmerged_lora", "base": BASE,
                "baseReceiptHash": hash_v1("receipt"), "baseWeightsHash": hash_v1("base"), "adapterHash": hash_v1("adapter"),
                "adapterStorageDtype": "float32", "runtimeLoraDtype": "bfloat16", "servingProbeHash": hash_v1(probe),
                "tokenizerHash": hash_v1("tokenizer"), "chatTemplateHash": hash_v1("template"), "trainingManifestHash": hash_v1("manifest"),
                "weightFitFamilies": ["fit"], "calibrationFamilies": ["cal"], "protocol": "rank_binary_v1", "binaryTokenIds": probe["binaryTokenIds"]}
    artifact["servingWeightsHash"] = serving_weights_hash(artifact)
    artifact["servedModel"] = "acephale-predictor-" + artifact["servingWeightsHash"][:12]
    artifact = hashed(artifact)
    predictor = {"servedModel": artifact["servedModel"], "weightsHash": artifact["servingWeightsHash"], "trainedPredictor": artifact}
    prior = {"sourceCommit": SOURCE, "observedAt": "2026-11-13T00:59:00Z", "hashAlgorithm": "sha256-rfc8785-v1",
             "provider": {"instanceId": "i-0123456789abcdef0"}, "modelFiles": {"predictor": {"artifact": artifact, "servingProbe": probe}},
             "containers": {role: {"id": char * 64, "imageId": "sha256:" + "e" * 64, "commandHash": hash_v1([role]),
                 "startedAt": "2026-11-13T00:00:00Z", "modelMountReadOnly": True} for role, char in (("actor", "b"), ("predictor", "c"))}}
    deployment = {"observed": True, "sourceCommit": SOURCE, "evidenceHash": hash_v1(prior), "predictor": predictor}
    binding = {"schemaVersion": 1, "artifact": artifact, "probe": probe, "deployment": deployment, "inventory": prior}
    response = {"model": artifact["servedModel"], "usage": {"prompt_tokens": 3, "completion_tokens": 1}, "choices": [{
        "prompt_token_ids": [10, 20, 30], "token_ids": [42], "logprobs": {"top_logprobs": [{"token_id:15": -1e-7, "token_id:16": -1e-7}]}}]}
    container = prior["containers"]["predictor"]
    receipt = hashed({"version": 1, "kind": "acephale-native-lora-serving-qualification", "artifactHash": artifact["contentHash"],
        "servingProbeHash": artifact["servingProbeHash"], "servingWeightsHash": artifact["servingWeightsHash"], "baseReceiptHash": artifact["baseReceiptHash"],
        "containerId": container["id"], "containerStartedAt": container["startedAt"], "commandHash": container["commandHash"], "imageId": container["imageId"],
        "inventoryObservedAt": prior["observedAt"], "inventoryEvidenceHash": deployment["evidenceHash"], "sourceCommit": SOURCE, "servedModel": artifact["servedModel"],
        "probeStartedAtUnixMs": 1794531600000, "probeCompletedAtUnixMs": 1794531601000,
        "gate": PARITY_GATE, "observedTopTokenId": 42, "observedLogprobs": {"zero": -1e-7, "one": -1e-7},
        "observedConditionalOneProbability": 0.5, "conditionalProbabilityDifference": 0,
        "inputTokenIdsHash": hash_v1(probe["inputTokenIds"]), "responseHash": hash_v1(response), "passed": True,
        "nativeTaskAccuracyMeasured": False, "limitation": "One probe checks loading and numerical compatibility, not model quality"})
    inventory = copy.deepcopy(prior)
    inventory.update(observationStartedAt="2026-11-13T01:00:02Z", observedAt="2026-11-13T01:01:00Z",
                     nativeLoraQualification={"version": 1, "binding": binding, "response": response, "receipt": receipt})
    return {"predictor": predictor, "inventory": inventory, "sourceCommit": SOURCE}


def test_post_probe_qualification_requires_actual_same_process_and_numerical_evidence(tmp_path):
    valid = qualified_fixture()
    expected = valid["inventory"]["nativeLoraQualification"]["receipt"]["contentHash"]
    assert validate_native_lora_serving(valid["predictor"], valid["inventory"], SOURCE) == expected
    edits = [
        lambda v: v["inventory"].pop("nativeLoraQualification"),
        lambda v: v["inventory"].update(observationStartedAt="2026-11-13T00:59:01Z"),
        lambda v: v["inventory"]["containers"]["predictor"].update(id="f" * 64),
        lambda v: v["inventory"]["containers"]["predictor"].update(commandHash="f" * 64),
        lambda v: v["inventory"]["containers"]["actor"].update(imageId="sha256:" + "f" * 64),
        lambda v: v["inventory"]["containers"]["predictor"].update(startedAt="2026-11-13T00:30:00Z"),
        lambda v: v["inventory"].update(sourceCommit="f" * 40),
        lambda v: v["inventory"]["provider"].update(instanceId="i-other"),
        lambda v: v["inventory"]["nativeLoraQualification"]["receipt"].update(passed=False),
        lambda v: v["inventory"]["nativeLoraQualification"]["response"]["choices"][0].update(token_ids=[43]),
        lambda v: v["inventory"]["nativeLoraQualification"]["response"].update(model="Qwen/Qwen3.5-0.8B"),
        lambda v: v["inventory"]["nativeLoraQualification"]["binding"]["probe"].update(inputTokenIds=[99]),
    ]
    cases = [{**valid, "accepted": True}]
    for edit in edits:
        value = copy.deepcopy(valid)
        edit(value)
        with pytest.raises((ValueError, KeyError, TypeError)):
            validate_native_lora_serving(value["predictor"], value["inventory"], SOURCE)
        cases.append({**value, "accepted": False})
    # A fresh checksum cannot turn a failed numerical or timing check into admission.
    for edit in (
        lambda p: p["response"]["choices"][0].update(token_ids=[43]),
        lambda p: p["response"]["choices"][0].update(prompt_token_ids=[99]),
        lambda p: p["receipt"].update(passed=1),
        lambda p: p["receipt"].update(probeCompletedAtUnixMs=1794531720000),
        lambda p: (p["response"]["choices"][0]["logprobs"]["top_logprobs"][0].update({"token_id:15": -3, "token_id:16": -2}),
                   p["receipt"].update(observedLogprobs={"zero": -3, "one": -2}, observedConditionalOneProbability=0.7310585786300049,
                                       conditionalProbabilityDifference=0.2310585786300049)),
    ):
        value = copy.deepcopy(valid)
        proof = value["inventory"]["nativeLoraQualification"]
        edit(proof)
        proof["receipt"]["responseHash"] = hash_v1(proof["response"])
        proof["receipt"] = hashed({key: item for key, item in proof["receipt"].items() if key != "contentHash"})
        with pytest.raises((ValueError, KeyError, TypeError)):
            validate_native_lora_serving(value["predictor"], value["inventory"], SOURCE)
        cases.append({**value, "accepted": False})
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(cases))
    script = """
const fs=require('node:fs'), assert=require('node:assert/strict');
const {validateNativeLoraServing}=require('./src/lib/acephale/predictor-serving-qualification.ts');
const {hash}=require('./src/lib/acephale/canonical.ts');
const {validateParityBinding,verifyParityResponse}=await import('./infra/acephale-infra-v1/lambda-operator/serving-parity.mjs');
const cases=JSON.parse(fs.readFileSync(process.argv[1]));
for (const row of cases) {
  let accepted=false; try { accepted=!!validateNativeLoraServing(row.predictor,row.inventory,row.sourceCommit); } catch {}
  assert.equal(accepted,row.accepted);
}
const proof=cases[0].inventory.nativeLoraQualification;
const identity=validateParityBinding(proof.binding,cases[0].sourceCommit,hash);
const timing=Object.fromEntries(['probeStartedAtUnixMs','probeCompletedAtUnixMs'].map(k=>[k,proof.receipt[k]]));
assert.deepEqual(verifyParityResponse(proof.response,proof.binding.artifact,proof.binding.probe,identity,hash,timing),proof.receipt);
"""
    result = subprocess.run(["node", "--import", "tsx", "-e", "(async()=>{" + script + "})()", str(path)],
                            cwd=ROOT, text=True, capture_output=True, timeout=30, check=False)
    assert result.returncode == 0, result.stdout + result.stderr


def test_base_and_legacy_merged_profiles_do_not_gain_a_new_requirement():
    assert validate_native_lora_serving({"servedModel": "base"}, {}, SOURCE) is None
    assert validate_native_lora_serving({"trainedPredictor": {"schemaVersion": 1}}, {}, SOURCE) is None


def test_qualified_guard_admits_only_declared_base_and_adapter_pair_with_current_commands(tmp_path):
    value = qualified_fixture()
    manifest = json.loads((ROOT / "research/acephale/examples/infra-manifest-v2.fixture.json").read_text())
    manifest["sourceCommit"] = SOURCE
    manifest["predictor"].update(value["predictor"])
    artifact = value["predictor"]["trainedPredictor"]
    manifest["predictor"].update(tokenizerHash=artifact["tokenizerHash"], chatTemplateHash=artifact["chatTemplateHash"])
    manifest["data"]["trainingFamilies"] = ["fit", "cal"]
    value["predictor"] = manifest["predictor"]
    value["inventory"]["nativeLoraQualification"]["binding"]["deployment"]["predictor"] = manifest["predictor"]
    configuration = {"manifestPath": "manifest.json", "splitGuardPath": "guard.json", "actorBaseUrl": "http://127.0.0.1:18000",
                     "predictorBaseUrl": "http://127.0.0.1:18001/v1", "otlpBaseUrl": "http://127.0.0.1:14318"}
    guard = {"version": 1, "configurationPath": "configuration.json", "sshDestination": "ubuntu@trusted-gpu", "sshPort": 22,
             "expectedInstanceId": "i-0123456789abcdef0", "localPorts": {"actor": 18000, "predictor": 18001, "otlp": 14318},
             "maximumLifetimeSeconds": 60, "deploymentPath": "deployment.json", "inventoryEvidencePath": "inventory.json"}
    deployment = {**manifest, "observed": True, "evidenceHash": hash_v1(value["inventory"])}
    for name, item in (("configuration", configuration), ("guard", guard), ("deployment", deployment), ("manifest", manifest), ("inventory", value["inventory"])):
        (tmp_path / (name + ".json")).write_text(json.dumps(item))
    _, provenance = load_guard(tmp_path / "guard.json")
    assert provenance["nativeLoraQualificationHash"] == value["inventory"]["nativeLoraQualification"]["receipt"]["contentHash"]
    remote = {"instanceId": guard["expectedInstanceId"], "otlpListening": True,
              "containers": {role: {**item, "running": True} for role, item in provenance["servingContainers"].items()},
              "actor": {"data": [{"id": manifest["actor"]["servedModel"]}]}, "predictor": {"data": [{"id": BASE["repository"]}, {"id": value["predictor"]["servedModel"]}]}}
    local = {role: remote[role] for role in ("actor", "predictor")}
    verify_observation(provenance, remote, local)
    for edit in (lambda r: r["predictor"]["data"].pop(), lambda r: r["predictor"]["data"].append({"id": "unapproved"}),
                 lambda r: r["containers"]["predictor"].update(commandHash="f" * 64)):
        changed = copy.deepcopy(remote)
        edit(changed)
        with pytest.raises(ValueError):
            verify_observation(provenance, changed, local)
    status = {"healthy": True, "state": "healthy", "networkConnected": True, "heartbeatSequence": 1,
              "observedAtUnixMs": int(time.time() * 1000), "maxStatusAgeMs": 3000, "endpointProvenanceHash": hash_v1(provenance),
              "manifestHash": hash_v1(manifest), "remoteInstanceId": guard["expectedInstanceId"]}
    (tmp_path / "0000000000000001.json").write_text(json.dumps(status))
    script = """
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {nativeSplitGuard,predictionSplitGuard}=require('./services/acephale-runtime/infra-split-guard.ts');
const dir=process.argv[1], read=name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json')));
assert(nativeSplitGuard(read('configuration'),read('manifest'),path.join(dir,'configuration.json'))());
assert.throws(()=>nativeSplitGuard({...read('configuration'),splitGuardPath:undefined},read('manifest'),path.join(dir,'configuration.json')));
const profile={trainedPredictor:read('manifest').predictor.trainedPredictor}, configPath=path.join(dir,'configuration.json');
assert(predictionSplitGuard(profile,read('configuration').predictorBaseUrl,configPath)());
assert.throws(()=>predictionSplitGuard(profile,read('configuration').predictorBaseUrl));
assert.throws(()=>predictionSplitGuard(profile,'http://127.0.0.1:19999',configPath));
"""
    result = subprocess.run(["node", "--import", "tsx", "-e", script, str(tmp_path)], cwd=ROOT, text=True,
                            capture_output=True, timeout=30, check=False, env={**os.environ, "ACEPHALE_HOST_STATUS_FILE": str(tmp_path)})
    assert result.returncode == 0, result.stdout + result.stderr
    value["inventory"].pop("nativeLoraQualification")
    (tmp_path / "inventory.json").write_text(json.dumps(value["inventory"]))
    deployment["evidenceHash"] = hash_v1(value["inventory"])
    (tmp_path / "deployment.json").write_text(json.dumps(deployment))
    with pytest.raises(ValueError, match="qualification"):
        load_guard(tmp_path / "guard.json")
