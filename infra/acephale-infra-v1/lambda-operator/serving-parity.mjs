import assert from 'node:assert/strict';

const gate = {version:1, requireTopTokenMatch:true, maximumConditionalProbabilityDifference:0.01};
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const logprob = value => typeof value === 'number' && Number.isFinite(value) && value <= 0;
const conditionalOne = (zero, one) => {
  const maximum = Math.max(zero, one);
  return Math.exp(one - maximum) / (Math.exp(zero - maximum) + Math.exp(one - maximum));
};

/** Bind a small cross-engine sanity probe to an observed container, never to a renamed base model. */
export function validateParityBinding(binding, sourceCommit, hash) {
  const {artifact, probe, deployment, inventory} = binding;
  assert.equal(binding.schemaVersion, 1);
  assert.equal(artifact.schemaVersion, 2); assert.equal(artifact.storageMode, 'unmerged_lora');
  const {contentHash, ...body} = artifact;
  assert.equal(contentHash, hash(body));
  assert.equal(artifact.adapterStorageDtype, 'float32'); assert.equal(artifact.runtimeLoraDtype, 'bfloat16');
  assert.equal(artifact.servingWeightsHash, hash(Object.fromEntries(['base','baseWeightsHash','adapterHash','adapterStorageDtype','runtimeLoraDtype'].map(key => [key,artifact[key]]))));
  assert.equal(artifact.servedModel, 'acephale-predictor-' + artifact.servingWeightsHash.slice(0,12));
  assert.equal(hash(probe), artifact.servingProbeHash);
  assert.equal(probe.schemaVersion,1); assert.equal(probe.kind,'acephale-lora-serving-probe');
  assert.deepEqual(probe.gate,gate); assert.equal(probe.nativeTaskAccuracyMeasured,false);
  assert(Array.isArray(probe.inputTokenIds) && probe.inputTokenIds.length >= 1 && probe.inputTokenIds.length <= 256 && probe.inputTokenIds.every(integer));
  assert(integer(probe.topTokenId));
  assert.deepEqual(probe.binaryTokenIds,artifact.binaryTokenIds);
  assert.deepEqual(Object.keys(probe.binaryTokenIds).sort(),['one','zero']);
  assert(Object.values(probe.binaryTokenIds).every(integer)); assert.notEqual(probe.binaryTokenIds.zero,probe.binaryTokenIds.one);
  assert.deepEqual(Object.keys(probe.referenceLogprobs).sort(),['one','zero']);
  assert(Object.values(probe.referenceLogprobs).every(logprob));
  assert(Number.isFinite(probe.referenceConditionalOneProbability));
  assert(Math.abs(probe.referenceConditionalOneProbability-conditionalOne(probe.referenceLogprobs.zero,probe.referenceLogprobs.one))<=1e-12);
  assert.equal(deployment.observed,true); assert.equal(deployment.sourceCommit,sourceCommit);
  assert.equal(inventory.sourceCommit,sourceCommit); assert.equal(deployment.evidenceHash,hash(inventory));
  assert.equal(hash(deployment.predictor.trainedPredictor),hash(artifact));
  assert.equal(deployment.predictor.weightsHash,artifact.servingWeightsHash);
  assert.equal(deployment.predictor.servedModel,artifact.servedModel);
  assert.equal(hash(inventory.modelFiles.predictor.artifact),hash(artifact));
  assert.equal(hash(inventory.modelFiles.predictor.servingProbe),hash(probe));
  const container = inventory.containers.predictor;
  assert(sha(container.id) && sha(container.commandHash) && /^sha256:[a-f0-9]{64}$/.test(container.imageId));
  assert(Number.isFinite(Date.parse(container.startedAt)) && Number.isFinite(Date.parse(inventory.observedAt)));
  assert.equal(container.modelMountReadOnly,true);
  return {artifactHash:artifact.contentHash,servingProbeHash:artifact.servingProbeHash,
    servingWeightsHash:artifact.servingWeightsHash,baseReceiptHash:artifact.baseReceiptHash,
    containerId:container.id,containerStartedAt:container.startedAt,commandHash:container.commandHash,imageId:container.imageId,
    inventoryObservedAt:inventory.observedAt,
    inventoryEvidenceHash:deployment.evidenceHash,sourceCommit,servedModel:artifact.servedModel};
}

/** vLLM 0.32 accepts exact prompt IDs and returns requested vocabulary logprobs. */
export function parityRequest(artifact, probe) {
  return {model:artifact.servedModel,prompt:probe.inputTokenIds,add_special_tokens:false,
    max_tokens:1,temperature:0,top_p:1,seed:17,stream:false,ignore_eos:true,
    logprobs:1,logprob_token_ids:[probe.binaryTokenIds.zero,probe.binaryTokenIds.one],
    return_token_ids:true,return_tokens_as_token_ids:true};
}

export function verifyParityResponse(response, artifact, probe, identity, hash, timing) {
  assert(Number.isSafeInteger(timing?.probeStartedAtUnixMs) && Number.isSafeInteger(timing?.probeCompletedAtUnixMs));
  assert(Date.parse(identity.inventoryObservedAt)<=timing.probeStartedAtUnixMs
    && timing.probeStartedAtUnixMs<=timing.probeCompletedAtUnixMs);
  assert.equal(response.model,artifact.servedModel);
  assert(Array.isArray(response.choices) && response.choices.length===1);
  const row = response.choices[0];
  assert.deepEqual(row.prompt_token_ids,probe.inputTokenIds);
  assert.deepEqual(row.token_ids,[probe.topTokenId]);
  assert.equal(response.usage.prompt_tokens,probe.inputTokenIds.length); assert.equal(response.usage.completion_tokens,1);
  assert(Array.isArray(row.logprobs.top_logprobs) && row.logprobs.top_logprobs.length===1);
  const observed = row.logprobs.top_logprobs[0];
  const zero = observed['token_id:'+probe.binaryTokenIds.zero], one = observed['token_id:'+probe.binaryTokenIds.one];
  assert(logprob(zero) && logprob(one));
  const probability = conditionalOne(zero,one), difference=Math.abs(probability-probe.referenceConditionalOneProbability);
  assert(difference<=gate.maximumConditionalProbabilityDifference,'Cross-engine binary probability gate failed');
  const body = {version:1,kind:'acephale-native-lora-serving-qualification',...identity,...timing,
    gate,observedTopTokenId:row.token_ids[0],observedLogprobs:{zero,one},observedConditionalOneProbability:probability,
    conditionalProbabilityDifference:difference,inputTokenIdsHash:hash(probe.inputTokenIds),responseHash:hash(response),
    passed:true,nativeTaskAccuracyMeasured:false,limitation:'One probe checks loading and numerical compatibility, not model quality'};
  return {...body,contentHash:hash(body)};
}
