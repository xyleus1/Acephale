import { resolvePredictorProfile } from "./predictor-artifact";
import Ajv2020 from "ajv/dist/2020";
import schema from "./contracts/infra-manifest-v2.schema.json";
import { canonical, copy, hash } from "./canonical";
import type { InfraExperimentManifestV2 } from "./contracts/infra-manifest-v2.generated";

export type { InfraExperimentManifestV2 } from "./contracts/infra-manifest-v2.generated";
export const INFRA_MODEL_PINS = {
  actor: { repository: "Qwen/Qwen3.5-9B", revision: "c202236235762e1c871ad0ccb60c8ee5ba337b9a" },
  predictor: { repository: "Qwen/Qwen3.5-0.8B", revision: "2fc06364715b967f1860aea9cf38778875588b17" },
  predictorCapacityAblation: { repository: "Qwen/Qwen3.5-2B", revision: "15852e8c16360a2fea060d615a32b45270f8a8fc" },
  image: "vllm/vllm-openai:v0.32.0@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34",
} as const;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

export function validateInfraManifest(value: unknown): asserts value is InfraExperimentManifestV2 {
  canonical(value);
  if (!validate(value)) throw new Error(`Invalid infra manifest: ${JSON.stringify(validate.errors)}`);
  const manifest = value as unknown as InfraExperimentManifestV2;
  if (manifest.actor.repository !== INFRA_MODEL_PINS.actor.repository || manifest.actor.revision !== INFRA_MODEL_PINS.actor.revision
    || manifest.predictor.repository !== INFRA_MODEL_PINS.predictor.repository || manifest.predictor.revision !== INFRA_MODEL_PINS.predictor.revision
    || manifest.runtime.imageDigest !== INFRA_MODEL_PINS.image) throw new Error("Unexpected model or runtime pin; create an explicit new experiment profile");
  for (const [role, model] of [["actor", manifest.actor], ["predictor", manifest.predictor]] as const) {
    if (model.inputBudget + model.outputCap > model.contextWindow) throw new Error(`${role} budget exceeds serving context`);
  }
  if (manifest.actor.contextWindow !== 32768 || manifest.actor.inputBudget !== 28672 || manifest.actor.outputCap !== 4096
    || manifest.predictor.contextWindow !== 8192 || manifest.predictor.inputBudget !== 7168 || manifest.predictor.outputCap !== 1024) throw new Error("Unexpected initial experiment context limits");
  if (manifest.actor.trainedPredictor || manifest.actor.predictionProtocol || manifest.actor.binaryTokenIds) throw new Error("Actor weights and protocol cannot be changed by predictor training");
  const profile = resolvePredictorProfile(manifest.predictor);
  if (profile.trainedPredictor) {
    const artifact = profile.trainedPredictor;
    if (manifest.predictor.servedModel !== artifact.servedModel || manifest.predictor.weightsHash !== artifact.mergedWeightsHash
      || manifest.predictor.tokenizerHash !== artifact.tokenizerHash || manifest.predictor.chatTemplateHash !== artifact.chatTemplateHash) throw new Error("Manifest serving identity differs from trained predictor artifact");
    if ([...artifact.weightFitFamilies, ...artifact.calibrationFamilies].some(family => !manifest.data.trainingFamilies.includes(family)
      || manifest.data.developmentFamilies.includes(family) || manifest.data.heldoutFamilies.includes(family))) throw new Error("Trained predictor family provenance crosses experiment partitions");
  }
  const families = new Set<string>();
  for (const split of [manifest.data.trainingFamilies, manifest.data.developmentFamilies, manifest.data.heldoutFamilies]) {
    for (const family of split) {
      if (families.has(family)) throw new Error("Family contamination between experiment splits");
      families.add(family);
    }
  }
  if (manifest.budgets.infrastructureMicrodollars > manifest.budgets.trancheMicrodollars) throw new Error("Infrastructure allocation exceeds the tranche");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Invalid manifest date");
}

export function freezeInfraManifest(value: unknown) {
  validateInfraManifest(value);
  const manifest = copy(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    Object.values(item).forEach(freeze); Object.freeze(item);
  };
  freeze(manifest);
  return { manifest, contentHash: hash(manifest) };
}
