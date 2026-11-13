"""Export unchanged LoRA bytes for explicitly qualified native vLLM serving."""

from __future__ import annotations

import json
import math
import re
import shutil
import struct
from pathlib import Path

from acephale.contracts_v1 import hash_v1
from acephale.training_data import BASE, file_inventory, hashed, verify_hashed, write_new

ARTIFACT_KEYS = {"schemaVersion", "kind", "storageMode", "base", "baseReceiptHash", "baseWeightsHash",
                 "adapterHash", "adapterStorageDtype", "runtimeLoraDtype", "servingWeightsHash", "servingProbeHash",
                 "tokenizerHash", "chatTemplateHash", "trainingManifestHash", "weightFitFamilies", "calibrationFamilies",
                 "protocol", "binaryTokenIds", "servedModel", "contentHash"}
PARITY_GATE = {"version": 1, "requireTopTokenMatch": True, "maximumConditionalProbabilityDifference": 0.01}
SERVING_SELECTION_RULE = "shortest_complete_neutral_weight_fit_prompt_v1"
ASSISTANT_GENERATION_SUFFIX = "<|im_start|>assistant\n<think>\n\n</think>\n\n"
SELECTION_KEYS = {"rule", "datasetManifestHash", "trainingManifestHash", "rowId", "familyId",
                  "promptHash", "promptTokens", "eligibleRows"}


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def base_weights_hash(receipt: dict) -> str:
    rows = sorted(receipt.get("files", []), key=lambda row: row["path"])
    weights = [row for row in rows if row["path"].endswith((".safetensors", ".safetensors.index.json"))
               or row["path"] == "config.json"]
    if not any(row["path"] == "config.json" for row in weights) or not any(row["path"].endswith(".safetensors") for row in weights):
        raise ValueError("Base snapshot requires actual weights and model configuration")
    return hash_v1(weights)


def serving_weights_hash(artifact: dict) -> str:
    return hash_v1({key: artifact[key] for key in
        ("base", "baseWeightsHash", "adapterHash", "adapterStorageDtype", "runtimeLoraDtype")})


def validate_lora_artifact(artifact: dict) -> dict:
    verify_hashed(artifact)
    if (set(artifact) != ARTIFACT_KEYS or artifact.get("schemaVersion") != 2
            or artifact.get("kind") != "acephale-trained-predictor" or artifact.get("base") != BASE
            or artifact.get("storageMode") != "unmerged_lora" or artifact.get("adapterStorageDtype") != "float32"
            or artifact.get("runtimeLoraDtype") != "bfloat16" or artifact.get("protocol") != "rank_binary_v1"):
        raise ValueError("Invalid unmerged predictor artifact contract")
    for key in ARTIFACT_KEYS:
        if key.endswith("Hash") and not re.fullmatch("[0-9a-f]{64}", str(artifact[key])):
            raise ValueError("Invalid unmerged predictor hash")
    ids = artifact["binaryTokenIds"]
    if (not isinstance(ids, dict) or set(ids) != {"zero", "one"}
            or any(type(value) is not int or value < 0 for value in ids.values()) or ids["zero"] == ids["one"]):
        raise ValueError("Distinct verified binary tokens required")
    seen = set()
    for key in ("weightFitFamilies", "calibrationFamilies"):
        values = artifact[key]
        if not isinstance(values, list) or not values:
            raise ValueError("Unmerged predictor requires fitting and calibration families")
        for family in values:
            if not isinstance(family, str) or not family or family in seen:
                raise ValueError("Unmerged predictor families overlap or repeat")
            seen.add(family)
    identity = serving_weights_hash(artifact)
    if artifact["servingWeightsHash"] != identity or artifact["servedModel"] != "acephale-predictor-" + identity[:12]:
        raise ValueError("Unmerged serving identity differs from base, adapter or runtime precision")
    return artifact


def adapter_inventory(directory: Path, specification: dict) -> dict:
    """Check stored dtype and every A/B target without loading GPU dependencies."""
    from acephale.training import TARGET_SUFFIXES

    config = _read(directory / "adapter_config.json")
    targets = specification.get("targets", [])
    if (not targets or len(targets) != len(set(targets)) or set(config.get("target_modules", [])) != TARGET_SUFFIXES
            or {target.rsplit(".", 1)[-1] for target in targets} != TARGET_SUFFIXES
            or config.get("r") != 16 or config.get("lora_alpha") != 32 or config.get("lora_dropout") != 0.05
            or config.get("bias") != "none" or config.get("use_dora") is not False or config.get("use_rslora") is not False
            or config.get("modules_to_save") or config.get("rank_pattern") or config.get("alpha_pattern")):
        raise ValueError("Adapter configuration differs from the pinned all-target LoRA recipe")
    path = directory / "adapter_model.safetensors"
    with path.open("rb") as stream:
        size_bytes = stream.read(8)
        if len(size_bytes) != 8:
            raise ValueError("Truncated adapter tensor header")
        header_size = struct.unpack("<Q", size_bytes)[0]
        if not 2 <= header_size <= 16_000_000:
            raise ValueError("Invalid adapter tensor header size")
        header = json.loads(stream.read(header_size))
    expected = {"base_model.model." + target + ".lora_" + side + ".weight" for target in targets for side in ("A", "B")}
    tensors = {key: row for key, row in header.items() if key != "__metadata__"}
    if set(tensors) != expected:
        raise ValueError("Stored adapter does not cover every trained A/B target exactly")
    offset, parameters = 0, 0
    for name, row in sorted(tensors.items(), key=lambda item: item[1]["data_offsets"][0]):
        shape, bounds = row.get("shape"), row.get("data_offsets")
        if (row.get("dtype") != "F32" or not isinstance(shape, list) or len(shape) != 2
                or any(type(value) is not int or value < 1 for value in shape)
                or shape[0 if ".lora_A." in name else 1] != 16
                or bounds != [offset, offset + math.prod(shape) * 4]):
            raise ValueError("Adapter tensors must retain exact contiguous FP32 rank-16 storage")
        offset = bounds[1]
        parameters += math.prod(shape)
    if path.stat().st_size != 8 + header_size + offset or parameters != specification.get("trainableCount"):
        raise ValueError("Adapter byte extent or trained parameter count differs")
    return {"tensorCount": len(tensors), "targetCount": len(targets), "parameterCount": parameters,
            "storageDtype": "float32", "targets": sorted(targets)}


def _conditional_one(zero: float, one: float) -> float:
    maximum = max(zero, one)
    return math.exp(one - maximum) / (math.exp(zero - maximum) + math.exp(one - maximum))


def validate_serving_probe(probe: dict, artifact: dict) -> dict:
    version = probe.get("schemaVersion")
    if (hash_v1(probe) != artifact["servingProbeHash"] or type(version) is not int or version not in {1, 2}
            or probe.get("kind") != "acephale-lora-serving-probe" or probe.get("binaryTokenIds") != artifact["binaryTokenIds"]
            or probe.get("gate") != PARITY_GATE or probe.get("nativeTaskAccuracyMeasured") is not False):
        raise ValueError("Serving probe identity or predeclared gate changed")
    ids, logs = probe.get("inputTokenIds"), probe.get("referenceLogprobs")
    if (not isinstance(ids, list) or not 1 <= len(ids) <= (256 if version == 1 else 7168)
            or any(type(item) is not int or item < 0 for item in ids)
            or type(probe.get("topTokenId")) is not int or probe["topTokenId"] < 0
            or not isinstance(logs, dict) or set(logs) != {"zero", "one"}
            or any(type(value) not in {int, float} or not math.isfinite(value) or value > 0 for value in logs.values())):
        raise ValueError("Finite binary logprob and exact input-token probe required")
    probability = probe.get("referenceConditionalOneProbability")
    if (type(probability) not in {int, float} or not math.isfinite(probability)
            or abs(probability - _conditional_one(logs["zero"], logs["one"])) > 1e-12):
        raise ValueError("Serving probe conditional probability is inconsistent")
    if version == 2:
        selection = probe.get("selection", {})
        if (probe.get("inputHash") != hash_v1(ids) or set(selection) != SELECTION_KEYS
                or selection.get("rule") != SERVING_SELECTION_RULE
                or selection.get("trainingManifestHash") != artifact["trainingManifestHash"]
                or any(not re.fullmatch("[a-f0-9]{64}", str(selection.get(key, "")))
                       for key in ("datasetManifestHash", "trainingManifestHash", "promptHash"))
                or not isinstance(selection.get("rowId"), str) or not selection["rowId"]
                or selection.get("familyId") not in artifact["weightFitFamilies"]
                or type(selection.get("promptTokens")) is not int or selection["promptTokens"] != len(ids)
                or type(selection.get("eligibleRows")) is not int or selection["eligibleRows"] < 1):
            raise ValueError("Complete serving probe requires exact fitting-prompt selection provenance")
    return probe


def select_serving_prompt(dataset: Path, manifest: dict, specification: dict, tokenizer) -> tuple[list[int], dict]:
    """Select using public prompt metadata only; never tokenize a completion."""
    from acephale.training_data import load_partition

    eligible = [row for row in load_partition(dataset, "weight_fit")
                if row["partition"] == "weight_fit" and row["task"] == "rank_binary" and row["condition"] == "neutral"]
    if not eligible:
        raise ValueError("A complete neutral fitting prompt is required for serving qualification")
    row = min(eligible, key=lambda item: (item["promptTokens"], item["id"]))
    rendered = tokenizer.apply_chat_template(row["prompt"], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    ids = tokenizer.encode(rendered, add_special_tokens=False)
    if (not rendered.endswith(ASSISTANT_GENERATION_SUFFIX) or len(ids) != row["promptTokens"]
            or not 1 <= len(ids) <= 7168 or any(type(token) is not int or token < 0 for token in ids)
            or hash_v1(row["prompt"]) != row["compiledInputHash"] or row["familyId"] not in manifest["weightFitFamilies"]):
        raise ValueError("Serving probe must retain the complete exact fitting prompt and assistant generation prefix")
    return ids, {"rule": SERVING_SELECTION_RULE, "datasetManifestHash": manifest["contentHash"],
                 "trainingManifestHash": specification["contentHash"], "rowId": row["id"], "familyId": row["familyId"],
                 "promptHash": row["compiledInputHash"], "promptTokens": len(ids), "eligibleRows": len(eligible)}


def export_unmerged(dataset: Path, model_path: Path, run: Path, output: Path, lease_path: Path) -> dict:
    from acephale.storage import file_hash
    from acephale.training import (
        PROBE_CONTEXT,
        _load_model,
        _probe_logits,
        _verify_probe_context,
        tokenizer_identity,
        training_versions,
        validate_training_lease,
        verify_base,
    )
    from acephale.training_data import verify_dataset

    manifest = verify_dataset(dataset)
    lease = validate_training_lease(lease_path)
    base_receipt = verify_base(model_path)
    training_versions()
    receipt = verify_hashed(_read(run / "receipt.json"))
    specification = verify_hashed(_read(run / "training-specification.json"))
    if (not manifest["calibrationFamilies"] or receipt.get("status") != "completed"
            or receipt.get("trainingManifestHash") != manifest["contentHash"]
            or receipt.get("specificationHash") != specification["contentHash"]
            or specification.get("datasetManifestHash") != manifest["contentHash"]
            or specification.get("baseReceiptHash") != hash_v1(base_receipt)
            or receipt.get("frozenBeforeHash") != receipt.get("frozenAfterHash")
            or receipt.get("adapterBeforeHash") == receipt.get("adapterAfterHash")
            or type(receipt.get("gradientChecks")) is not int or receipt["gradientChecks"] < 1
            or file_inventory(run / "adapter") != receipt["adapterFiles"]
            or file_hash(run / "reload-probe.pt") != receipt["probeHash"]
            or tokenizer_identity(model_path) != (manifest["tokenizerHash"], manifest["chatTemplateHash"])):
        raise ValueError("Only unchanged, isolated, dataset-bound training can be exported")
    tensors = adapter_inventory(run / "adapter", specification)
    import torch
    from peft import PeftModel

    probe = torch.load(run / "reload-probe.pt", map_location="cpu", weights_only=True)
    _verify_probe_context(probe, specification)
    base, tokenizer = _load_model(model_path)
    from acephale.training_precision import require_training_precision

    require_training_precision(base, specification)
    model = PeftModel.from_pretrained(base, run / "adapter", is_trainable=False, local_files_only=True).eval()
    reloaded = _probe_logits(model, probe["input_ids"].to("cuda"))
    torch.testing.assert_close(reloaded, probe["logits"], rtol=0.02, atol=0.03)
    if not torch.isfinite(reloaded).all():
        raise ValueError("Reloaded adapter produced nonfinite logits")
    serving_ids, selection = select_serving_prompt(dataset, manifest, specification, tokenizer)
    serving_logits = _probe_logits(model, torch.tensor([serving_ids], dtype=torch.long, device="cuda"))
    if not torch.isfinite(serving_logits).all():
        raise ValueError("Complete serving prompt produced nonfinite logits")
    logprobs = torch.log_softmax(serving_logits[0], dim=-1)
    logs = {key: logprobs[token].item() for key, token in receipt["binaryTokenIds"].items()}
    serving_probe = {"schemaVersion": 2, "kind": "acephale-lora-serving-probe",
        "inputTokenIds": serving_ids, "inputHash": hash_v1(serving_ids), "selection": selection,
        "binaryTokenIds": receipt["binaryTokenIds"],
        "referenceLogprobs": logs, "referenceConditionalOneProbability": _conditional_one(logs["zero"], logs["one"]),
        "topTokenId": serving_logits[0].argmax().item(), "gate": PARITY_GATE, "nativeTaskAccuracyMeasured": False}
    artifact = {"schemaVersion": 2, "kind": "acephale-trained-predictor", "storageMode": "unmerged_lora", "base": BASE,
        "baseReceiptHash": hash_v1(base_receipt), "baseWeightsHash": base_weights_hash(base_receipt),
        "adapterHash": hash_v1(receipt["adapterFiles"]), "adapterStorageDtype": "float32", "runtimeLoraDtype": "bfloat16",
        "servingProbeHash": hash_v1(serving_probe), "tokenizerHash": manifest["tokenizerHash"],
        "chatTemplateHash": manifest["chatTemplateHash"], "trainingManifestHash": specification["contentHash"],
        "weightFitFamilies": manifest["weightFitFamilies"], "calibrationFamilies": manifest["calibrationFamilies"],
        "protocol": "rank_binary_v1", "binaryTokenIds": receipt["binaryTokenIds"]}
    artifact["servingWeightsHash"] = serving_weights_hash(artifact)
    artifact["servedModel"] = "acephale-predictor-" + artifact["servingWeightsHash"][:12]
    artifact = validate_lora_artifact(hashed(artifact))
    validate_serving_probe(serving_probe, artifact)
    if validate_training_lease(lease_path) != lease:
        raise ValueError("Training lease changed during export")
    output.mkdir(parents=True, exist_ok=False)
    shutil.copytree(run / "adapter", output / "adapter")
    if file_inventory(output / "adapter") != receipt["adapterFiles"]:
        raise ValueError("Copied adapter bytes changed")
    documents = {"predictor.json": artifact, "training-manifest.json": specification, "dataset-manifest.json": manifest,
        "training-receipt.json": receipt, "base-receipt.json": base_receipt, "serving-probe.json": serving_probe,
        "verification.json": hashed({"artifactHash": artifact["contentHash"], "receiptHash": receipt["contentHash"],
            "adapterFiles": receipt["adapterFiles"], "adapterTensors": tensors, "probeContext": PROBE_CONTEXT,
            "reloadMaximumLogitError": (reloaded - probe["logits"]).abs().max().item(),
            "reload": {"atol": 0.03, "rtol": 0.02, "referenceMaximumAbsolute": probe["logits"].abs().max().item(), "allClose": True},
            "merged": False, "vllmQualificationRequired": True, "vllmQualificationPassed": False,
            "nativeTaskSuccessMeasured": False})}
    for name, document in documents.items():
        write_new(output / name, document)
    verify_unmerged_export(output)
    return artifact


def verify_unmerged_export(directory: Path) -> dict:
    """Validate storage and PyTorch reload evidence; this does not admit a server."""
    from acephale.training import _verify_probe_context, tokenizer_identity

    artifact = validate_lora_artifact(_read(directory / "predictor.json"))
    specification = verify_hashed(_read(directory / "training-manifest.json"))
    dataset = verify_hashed(_read(directory / "dataset-manifest.json"))
    receipt = verify_hashed(_read(directory / "training-receipt.json"))
    verification = verify_hashed(_read(directory / "verification.json"))
    base_receipt = _read(directory / "base-receipt.json")
    _verify_probe_context({"context": verification.get("probeContext")}, specification)
    if (specification.get("base") != BASE or dataset.get("base") != BASE
            or {key: base_receipt.get(key) for key in BASE} != BASE or base_receipt.get("role") != "predictor"
            or artifact["baseReceiptHash"] != hash_v1(base_receipt)
            or specification.get("baseReceiptHash") != artifact["baseReceiptHash"]
            or artifact["baseWeightsHash"] != base_weights_hash(base_receipt)
            or artifact["trainingManifestHash"] != specification["contentHash"]
            or specification.get("datasetManifestHash") != dataset["contentHash"]
            or receipt.get("status") != "completed" or receipt.get("trainingManifestHash") != dataset["contentHash"]
            or receipt.get("specificationHash") != specification["contentHash"]
            or receipt.get("frozenBeforeHash") != receipt.get("frozenAfterHash")
            or receipt.get("adapterBeforeHash") == receipt.get("adapterAfterHash")
            or type(receipt.get("gradientChecks")) is not int or receipt["gradientChecks"] < 1
            or any(artifact[key] != dataset.get(key) for key in ("weightFitFamilies", "calibrationFamilies", "tokenizerHash", "chatTemplateHash"))
            or artifact["binaryTokenIds"] != receipt.get("binaryTokenIds")
            or verification.get("artifactHash") != artifact["contentHash"] or verification.get("receiptHash") != receipt["contentHash"]):
        raise ValueError("Unmerged export provenance chain is inconsistent")
    files = file_inventory(directory / "adapter")
    if (files != receipt.get("adapterFiles") or files != verification.get("adapterFiles")
            or hash_v1(files) != artifact["adapterHash"]
            or adapter_inventory(directory / "adapter", specification) != verification.get("adapterTensors")
            or tokenizer_identity(directory / "adapter") != (artifact["tokenizerHash"], artifact["chatTemplateHash"])):
        raise ValueError("Unmerged adapter or tokenizer bytes differ from training")
    tolerance = verification.get("reload", {})
    error, reference = verification.get("reloadMaximumLogitError"), tolerance.get("referenceMaximumAbsolute")
    if (tolerance.get("atol") != 0.03 or tolerance.get("rtol") != 0.02 or tolerance.get("allClose") is not True
            or any(type(value) not in {int, float} or not math.isfinite(value) or value < 0 for value in (error, reference))
            or error > 0.03 + 0.02 * reference or verification.get("merged") is not False
            or verification.get("vllmQualificationRequired") is not True or verification.get("vllmQualificationPassed") is not False
            or verification.get("nativeTaskSuccessMeasured") is not False):
        raise ValueError("Unmerged export lacks unchanged strict reload evidence or misstates server qualification")
    serving_probe = validate_serving_probe(_read(directory / "serving-probe.json"), artifact)
    if serving_probe["schemaVersion"] == 2:
        selection = serving_probe["selection"]
        if (selection["datasetManifestHash"] != dataset["contentHash"]
                or selection["eligibleRows"] > dataset["counts"]["weight_fit"]):
            raise ValueError("Complete serving probe selection differs from the retained fitting dataset")
    return artifact
