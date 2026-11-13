"""Admit native LoRA only after numerical qualification and a new host observation."""
from __future__ import annotations

import math
from datetime import datetime

from acephale.contracts_v1 import hash_v1
from acephale.training_lora import PARITY_GATE, validate_lora_artifact, validate_serving_probe


def _time(value):
    if not isinstance(value, str):
        raise ValueError("Qualification requires observed timestamps")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Qualification timestamps require a timezone")
    return parsed.timestamp() * 1000


def _require(value):
    if not value:
        raise ValueError("Native LoRA qualification does not match the current observed serving process")


def validate_native_lora_serving(predictor: dict, inventory: dict, source_commit: str) -> str | None:
    artifact = predictor.get("trainedPredictor", {})
    if artifact.get("schemaVersion") != 2:
        return None
    validate_lora_artifact(artifact)
    proof = inventory.get("nativeLoraQualification", {})
    _require(set(proof) == {"version", "binding", "response", "receipt"} and type(proof.get("version")) is int and proof["version"] == 1)
    binding, response, receipt = (proof[key] for key in ("binding", "response", "receipt"))
    prior, deployment, probe = (binding[key] for key in ("inventory", "deployment", "probe"))
    validate_serving_probe(probe, artifact)
    _require(hash_v1(probe["gate"]) == hash_v1(PARITY_GATE))
    _require(binding.get("schemaVersion") == 1 and hash_v1(binding["artifact"]) == hash_v1(artifact)
             and deployment.get("observed") is True and deployment.get("evidenceHash") == hash_v1(prior)
             and all(value.get("sourceCommit") == source_commit for value in (inventory, prior, deployment))
             and hash_v1(deployment["predictor"]) == hash_v1(predictor))
    for observation in (prior, inventory):
        model = observation["modelFiles"]["predictor"]
        _require(hash_v1(model["artifact"]) == hash_v1(artifact) and hash_v1(model["servingProbe"]) == artifact["servingProbeHash"])
    _require(hash_v1(prior["provider"]) == hash_v1(inventory["provider"]))
    for role in ("actor", "predictor"):
        previous, current = prior["containers"][role], inventory["containers"][role]
        _require(current.get("modelMountReadOnly") is True and all(previous.get(key) == current.get(key)
                 for key in ("id", "imageId", "commandHash", "startedAt")))
    container = inventory["containers"]["predictor"]
    expected = {"version": 1, "kind": "acephale-native-lora-serving-qualification", "artifactHash": artifact["contentHash"],
        "servingProbeHash": artifact["servingProbeHash"], "servingWeightsHash": artifact["servingWeightsHash"],
        "baseReceiptHash": artifact["baseReceiptHash"], "containerId": container["id"], "containerStartedAt": container["startedAt"],
        "commandHash": container["commandHash"], "imageId": container["imageId"], "inventoryObservedAt": prior["observedAt"],
        "inventoryEvidenceHash": deployment["evidenceHash"], "sourceCommit": source_commit, "servedModel": artifact["servedModel"],
        "gate": PARITY_GATE, "passed": True, "nativeTaskAccuracyMeasured": False,
        "inputTokenIdsHash": hash_v1(probe["inputTokenIds"]), "responseHash": hash_v1(response)}
    _require(all(hash_v1(receipt.get(key)) == hash_v1(value) for key, value in expected.items())
             and receipt.get("contentHash") == hash_v1({key: value for key, value in receipt.items() if key != "contentHash"}))
    start, end = receipt.get("probeStartedAtUnixMs"), receipt.get("probeCompletedAtUnixMs")
    _require(type(start) is int and type(end) is int and _time(prior["observedAt"]) <= start <= end
             <= _time(inventory.get("observationStartedAt")) <= _time(inventory["observedAt"]))
    rows = response.get("choices", [])
    _require(response.get("model") == artifact["servedModel"] and len(rows) == 1
             and response.get("usage", {}).get("prompt_tokens") == len(probe["inputTokenIds"])
             and response.get("usage", {}).get("completion_tokens") == 1)
    row = rows[0]
    _require(row.get("prompt_token_ids") == probe["inputTokenIds"] and row.get("token_ids") == [probe["topTokenId"]]
             and receipt.get("observedTopTokenId") == probe["topTokenId"])
    logs = row.get("logprobs", {}).get("top_logprobs", [])
    _require(len(logs) == 1)
    values = {key: logs[0].get("token_id:" + str(identifier)) for key, identifier in probe["binaryTokenIds"].items()}
    _require(all(type(value) in {int, float} and math.isfinite(value) and value <= 0 for value in values.values())
             and receipt.get("observedLogprobs") == values)
    maximum = max(values.values())
    probability = math.exp(values["one"] - maximum) / sum(math.exp(value - maximum) for value in values.values())
    difference = abs(probability - probe["referenceConditionalOneProbability"])
    _require(difference <= 0.01 and all(type(receipt.get(key)) in {int, float} and math.isfinite(receipt[key])
             and abs(receipt[key] - value) <= 1e-12 for key, value in
             (("observedConditionalOneProbability", probability), ("conditionalProbabilityDifference", difference))))
    return receipt["contentHash"]
