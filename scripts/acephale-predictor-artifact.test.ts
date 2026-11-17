import assert from "node:assert/strict";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { copy, hash } from "../src/lib/acephale/canonical";
import schema from "../src/lib/acephale/contracts/infra-manifest-v2.schema.json";
import { PREDICTOR_BASE, predictorModelIdentity, predictorServingWeightsHash, validateTrainedPredictor,
  type TrainedPredictorArtifact } from "../src/lib/acephale/predictor-artifact";

function artifact() {
  const weights = { base: PREDICTOR_BASE, baseWeightsHash: hash("base"), adapterHash: hash("adapter"),
    adapterStorageDtype: "float32" as const, runtimeLoraDtype: "bfloat16" as const };
  const servingWeightsHash = hash(weights);
  const body = { schemaVersion: 2 as const, kind: "acephale-trained-predictor" as const,
    storageMode: "unmerged_lora" as const, ...weights, servingWeightsHash, baseReceiptHash: hash("base receipt"),
    servingProbeHash: hash("probe"), tokenizerHash: hash("tokenizer"), chatTemplateHash: hash("template"),
    trainingManifestHash: hash("fit receipt"), weightFitFamilies: ["fit"], calibrationFamilies: ["cal"],
    protocol: "rank_binary_v1" as const, binaryTokenIds: { zero: 15, one: 16 },
    servedModel: `acephale-predictor-${servingWeightsHash.slice(0, 12)}` };
  return { ...body, contentHash: hash(body) };
}
function reseal(value: Record<string, unknown>): TrainedPredictorArtifact {
  const { contentHash: _old, ...body } = value;
  return { ...body, contentHash: hash(body) } as unknown as TrainedPredictorArtifact;
}
const validateSchema = new Ajv2020({ strict: true }).compile({ $defs: schema.$defs, $ref: "#/$defs/TrainedPredictorArtifact" });

test("native LoRA identity keeps base, adapter storage, runtime precision and probe explicit", () => {
  const value = artifact();
  assert.equal(validateSchema(value), true);
  assert.deepEqual(validateTrainedPredictor(value), value);
  assert.equal(predictorServingWeightsHash(value), value.servingWeightsHash);
  assert.equal(Object.hasOwn(value, "mergedWeightsHash"), false);
  assert.deepEqual(predictorModelIdentity({ trainedPredictor: value }), { ...PREDICTOR_BASE, trainedPredictor: value });
});

test("rehashing a changed base, adapter or compute precision cannot preserve serving identity", () => {
  for (const change of [
    { baseWeightsHash: hash("foreign base") }, { adapterHash: hash("foreign adapter") },
    { adapterStorageDtype: "bfloat16" }, { runtimeLoraDtype: "float16" },
    { servedModel: `acephale-predictor-${hash("foreign alias").slice(0, 12)}` },
  ]) assert.throws(() => validateTrainedPredictor(reseal({ ...artifact(), ...change })));
});

test("native LoRA cannot masquerade as merged weights or cross fitting partitions", () => {
  for (const change of [
    { mergedWeightsHash: hash("invented merged weights") }, { schemaVersion: 1 },
    { storageMode: "merged" }, { servingProbeHash: "missing" }, { weightFitFamilies: ["cal"] },
    { binaryTokenIds: { zero: 15, one: 15 } },
  ]) assert.throws(() => validateTrainedPredictor(reseal({ ...artifact(), ...change })));
  const missing = copy(artifact()) as unknown as Record<string, unknown>;
  delete missing.servingProbeHash;
  assert.equal(validateSchema(missing), false);
  assert.throws(() => validateTrainedPredictor(reseal(missing)), /fields/);
});

test("legacy merged identity remains a distinct valid version", () => {
  const value = artifact();
  const body = { schemaVersion: 1 as const, kind: value.kind, base: value.base, adapterHash: value.adapterHash,
    mergedWeightsHash: hash("merged"), tokenizerHash: value.tokenizerHash, chatTemplateHash: value.chatTemplateHash,
    trainingManifestHash: value.trainingManifestHash, weightFitFamilies: value.weightFitFamilies,
    calibrationFamilies: value.calibrationFamilies, protocol: value.protocol, binaryTokenIds: value.binaryTokenIds,
    servedModel: `acephale-predictor-${hash("merged").slice(0, 12)}` };
  const legacy = { ...body, contentHash: hash(body) };
  assert.equal(validateSchema(legacy), true);
  assert.deepEqual(validateTrainedPredictor(legacy), legacy);
  assert.equal(predictorServingWeightsHash(legacy), legacy.mergedWeightsHash);
  assert.notEqual(hash(predictorModelIdentity({ trainedPredictor: legacy })), hash(predictorModelIdentity({ trainedPredictor: value })));
});
