import { hash } from "./canonical";
import { validateTrainedPredictor } from "./predictor-artifact";

const gate = { version: 1, requireTopTokenMatch: true, maximumConditionalProbabilityDifference: 0.01 };
const time = (value: unknown) => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const finiteLog = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value <= 0;
function requireProof(value: unknown): asserts value {
  if (!value) throw new Error("Native LoRA qualification does not match the current observed serving process");
}

/** Mirror Python predictor_serving; proof records a real request, then a new process observation. */
export function validateNativeLoraServing(predictor: Record<string, any>, inventory: Record<string, any>, sourceCommit: string): string | undefined {
  const artifact = predictor.trainedPredictor;
  if (artifact?.schemaVersion !== 2) return undefined;
  validateTrainedPredictor(artifact);
  const proof = inventory.nativeLoraQualification ?? {};
  requireProof(Object.keys(proof).sort().join() === "binding,receipt,response,version" && proof.version === 1);
  const { binding, response, receipt } = proof, { inventory: prior, deployment, probe } = binding;
  requireProof(hash(probe) === artifact.servingProbeHash && probe.schemaVersion === 1 && probe.kind === "acephale-lora-serving-probe"
    && hash(probe.binaryTokenIds) === hash(artifact.binaryTokenIds) && hash(probe.gate) === hash(gate) && probe.nativeTaskAccuracyMeasured === false
    && Array.isArray(probe.inputTokenIds) && probe.inputTokenIds.length > 0 && probe.inputTokenIds.length <= 256
    && probe.inputTokenIds.every((id: unknown) => Number.isSafeInteger(id) && Number(id) >= 0) && Number.isSafeInteger(probe.topTokenId) && probe.topTokenId >= 0);
  const conditionalOne = (zero: number, one: number) => { const max = Math.max(zero, one); return Math.exp(one - max) / (Math.exp(zero - max) + Math.exp(one - max)); };
  requireProof(Object.keys(probe.referenceLogprobs).sort().join() === "one,zero" && Object.values(probe.referenceLogprobs).every(finiteLog)
    && Number.isFinite(probe.referenceConditionalOneProbability)
    && Math.abs(probe.referenceConditionalOneProbability - conditionalOne(probe.referenceLogprobs.zero, probe.referenceLogprobs.one)) <= 1e-12);
  requireProof(binding.schemaVersion === 1 && hash(binding.artifact) === hash(artifact) && deployment.observed === true
    && deployment.evidenceHash === hash(prior) && [inventory, prior, deployment].every(value => value.sourceCommit === sourceCommit)
    && hash(deployment.predictor) === hash(predictor));
  for (const observation of [prior, inventory]) {
    const model = observation.modelFiles.predictor;
    requireProof(hash(model.artifact) === hash(artifact) && hash(model.servingProbe) === artifact.servingProbeHash);
  }
  requireProof(hash(prior.provider) === hash(inventory.provider));
  for (const role of ["actor", "predictor"]) {
    const previous = prior.containers[role], current = inventory.containers[role];
    requireProof(current.modelMountReadOnly === true && ["id", "imageId", "commandHash", "startedAt"].every(key => previous[key] === current[key]));
  }
  const container = inventory.containers.predictor;
  const expected = { version: 1, kind: "acephale-native-lora-serving-qualification", artifactHash: artifact.contentHash,
    servingProbeHash: artifact.servingProbeHash, servingWeightsHash: artifact.servingWeightsHash, baseReceiptHash: artifact.baseReceiptHash,
    containerId: container.id, containerStartedAt: container.startedAt, commandHash: container.commandHash, imageId: container.imageId,
    inventoryObservedAt: prior.observedAt, inventoryEvidenceHash: deployment.evidenceHash, sourceCommit, servedModel: artifact.servedModel,
    gate, passed: true, nativeTaskAccuracyMeasured: false, inputTokenIdsHash: hash(probe.inputTokenIds), responseHash: hash(response) };
  const { contentHash, ...receiptBody } = receipt;
  requireProof(Object.entries(expected).every(([key, value]) => hash(receipt[key] ?? null) === hash(value)) && contentHash === hash(receiptBody));
  const start = receipt.probeStartedAtUnixMs, end = receipt.probeCompletedAtUnixMs;
  requireProof(Number.isSafeInteger(start) && Number.isSafeInteger(end) && time(prior.observedAt) <= start && start <= end
    && end <= time(inventory.observationStartedAt) && time(inventory.observationStartedAt) <= time(inventory.observedAt));
  requireProof(response.model === artifact.servedModel && response.choices?.length === 1
    && response.usage?.prompt_tokens === probe.inputTokenIds.length && response.usage?.completion_tokens === 1);
  const row = response.choices[0], logs = row.logprobs?.top_logprobs;
  requireProof(hash(row.prompt_token_ids ?? null) === hash(probe.inputTokenIds) && hash(row.token_ids ?? null) === hash([probe.topTokenId])
    && receipt.observedTopTokenId === probe.topTokenId && logs?.length === 1);
  const zero = logs[0][`token_id:${probe.binaryTokenIds.zero}`], one = logs[0][`token_id:${probe.binaryTokenIds.one}`];
  requireProof(finiteLog(zero) && finiteLog(one) && hash(receipt.observedLogprobs) === hash({ zero, one }));
  const probability = conditionalOne(zero, one), difference = Math.abs(probability - probe.referenceConditionalOneProbability);
  requireProof(difference <= 0.01 && Number.isFinite(receipt.observedConditionalOneProbability) && Number.isFinite(receipt.conditionalProbabilityDifference)
    && Math.abs(receipt.observedConditionalOneProbability - probability) <= 1e-12 && Math.abs(receipt.conditionalProbabilityDifference - difference) <= 1e-12);
  return contentHash;
}
