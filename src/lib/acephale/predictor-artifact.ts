import { canonical, copy, hash } from "./canonical";

export const PREDICTOR_BASE = { repository: "Qwen/Qwen3.5-0.8B", revision: "2fc06364715b967f1860aea9cf38778875588b17" } as const;
export type PredictorProtocol = "rank_marginals_v2" | "rank_binary_v1";
export interface BinaryTokenIds { zero: number; one: number }
export interface TrainedPredictorArtifact {
  schemaVersion: 1; kind: "acephale-trained-predictor"; base: { repository: string; revision: string };
  adapterHash: string; mergedWeightsHash: string; tokenizerHash: string; chatTemplateHash: string;
  trainingManifestHash: string; weightFitFamilies: string[]; calibrationFamilies: string[];
  protocol: "rank_binary_v1"; binaryTokenIds: BinaryTokenIds; servedModel: string; contentHash: string;
}
export interface PredictorProfile {
  trainedPredictor?: TrainedPredictorArtifact;
  predictionProtocol?: PredictorProtocol;
  binaryTokenIds?: BinaryTokenIds;
}
export function validateBinaryTokenIds(ids: BinaryTokenIds | undefined): asserts ids is BinaryTokenIds {
  if (!ids || !Number.isSafeInteger(ids.zero) || !Number.isSafeInteger(ids.one) || ids.zero < 0 || ids.one < 0
    || ids.zero === ids.one || Object.keys(ids).sort().join(",") !== "one,zero") throw new Error("Distinct verified binary tokenizer IDs required");
}
export function validateTrainedPredictor(value: TrainedPredictorArtifact): TrainedPredictorArtifact {
  canonical(value);
  const keys = ["schemaVersion", "kind", "base", "adapterHash", "mergedWeightsHash", "tokenizerHash", "chatTemplateHash", "trainingManifestHash",
    "weightFitFamilies", "calibrationFamilies", "protocol", "binaryTokenIds", "servedModel", "contentHash"];
  if (!value || hash(Object.keys(value).sort()) !== hash(keys.sort())) throw new Error("Unexpected trained predictor artifact fields");
  if (!value || value.schemaVersion !== 1 || value.kind !== "acephale-trained-predictor" || hash(value.base) !== hash(PREDICTOR_BASE)
    || value.protocol !== "rank_binary_v1") throw new Error("Invalid trained predictor base or protocol");
  const { contentHash, ...body } = value;
  if (hash(body) !== contentHash || [value.adapterHash, value.mergedWeightsHash, value.tokenizerHash, value.chatTemplateHash,
    value.trainingManifestHash, contentHash].some(item => !/^[a-f0-9]{64}$/.test(item))) throw new Error("Invalid trained predictor artifact identity");
  validateBinaryTokenIds(value.binaryTokenIds);
  const seen = new Set<string>();
  for (const list of [value.weightFitFamilies, value.calibrationFamilies]) {
    if (!Array.isArray(list) || !list.length) throw new Error("Trained predictor requires fitting and calibration families");
    for (const family of list) {
      if (typeof family !== "string" || !family || seen.has(family)) throw new Error("Trained predictor family contamination");
      seen.add(family);
    }
  }
  if (value.servedModel !== `acephale-predictor-${value.mergedWeightsHash.slice(0, 12)}`) throw new Error("Trained predictor served name must identify derived weights");
  return copy(value);
}
export function resolvePredictorProfile(value: PredictorProfile = {}) {
  const artifact = value.trainedPredictor ? validateTrainedPredictor(value.trainedPredictor) : undefined;
  const protocol = value.predictionProtocol ?? artifact?.protocol ?? "rank_marginals_v2";
  if (!["rank_marginals_v2", "rank_binary_v1"].includes(protocol) || artifact && protocol !== artifact.protocol) throw new Error("Predictor protocol does not match trained weights");
  const binaryTokenIds = value.binaryTokenIds ?? artifact?.binaryTokenIds;
  if (protocol === "rank_binary_v1") validateBinaryTokenIds(binaryTokenIds);
  else if (binaryTokenIds) throw new Error("Binary token IDs require the binary predictor protocol");
  if (artifact && hash(binaryTokenIds) !== hash(artifact.binaryTokenIds)) throw new Error("Binary token IDs differ from trained tokenizer identity");
  return { protocol: protocol as PredictorProtocol, binaryTokenIds, trainedPredictor: artifact };
}
export interface PredictorModelIdentity { repository: string; revision: string; trainedPredictor?: TrainedPredictorArtifact }
export function predictorModelIdentity(value: PredictorProfile = {}): PredictorModelIdentity {
  const profile = resolvePredictorProfile(value);
  return { ...PREDICTOR_BASE, ...(profile.trainedPredictor ? { trainedPredictor: profile.trainedPredictor } : {}) };
}
export function validatePredictorModelIdentity(value: PredictorModelIdentity): PredictorModelIdentity {
  if (!value || hash(value) !== hash(predictorModelIdentity(value))) throw new Error("Invalid complete predictor model identity");
  return copy(value);
}
