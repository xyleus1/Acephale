import assert from 'node:assert/strict';
import test from 'node:test';
import {hash} from '../../../src/lib/acephale/canonical.ts';
import {validateTrainedPredictor} from '../../../src/lib/acephale/predictor-artifact.ts';
import {parityRequest, validateParityBinding, verifyParityResponse} from './serving-parity.mjs';

const source = 'c'.repeat(40);
const timing = {probeStartedAtUnixMs:Date.parse('2026-11-13T01:00:00Z'),probeCompletedAtUnixMs:Date.parse('2026-11-13T01:00:01Z')};
function fixture() {
  const probe = {schemaVersion:1,kind:'acephale-lora-serving-probe',inputTokenIds:[10,20,30],binaryTokenIds:{zero:15,one:16},
    referenceLogprobs:{zero:-3,one:-3},referenceConditionalOneProbability:0.5,topTokenId:42,
    gate:{version:1,requireTopTokenMatch:true,maximumConditionalProbabilityDifference:0.01},nativeTaskAccuracyMeasured:false};
  const body = {schemaVersion:2,kind:'acephale-trained-predictor',storageMode:'unmerged_lora',
    base:{repository:'Qwen/Qwen3.5-0.8B',revision:'2fc06364715b967f1860aea9cf38778875588b17'},baseReceiptHash:hash('receipt'),
    baseWeightsHash:hash('base'),adapterHash:hash('adapter'),adapterStorageDtype:'float32',runtimeLoraDtype:'bfloat16',
    servingProbeHash:hash(probe),tokenizerHash:hash('tokenizer'),chatTemplateHash:hash('template'),trainingManifestHash:hash('manifest'),
    weightFitFamilies:['fit'],calibrationFamilies:['cal'],protocol:'rank_binary_v1',binaryTokenIds:probe.binaryTokenIds};
  body.servingWeightsHash = hash(Object.fromEntries(['base','baseWeightsHash','adapterHash','adapterStorageDtype','runtimeLoraDtype'].map(key=>[key,body[key]])));
  body.servedModel = 'acephale-predictor-'+body.servingWeightsHash.slice(0,12);
  const artifact = {...body,contentHash:hash(body)};
  validateTrainedPredictor(artifact);
  const inventory = {sourceCommit:source,observedAt:'2026-11-13T00:59:00Z',modelFiles:{predictor:{artifact,servingProbe:probe}},containers:{predictor:{
    id:'d'.repeat(64),startedAt:'2026-11-13T00:00:00Z',commandHash:hash('command'),imageId:'sha256:'+'e'.repeat(64),modelMountReadOnly:true}}};
  const deployment = {observed:true,sourceCommit:source,evidenceHash:hash(inventory),predictor:{
    trainedPredictor:artifact,weightsHash:artifact.servingWeightsHash,servedModel:artifact.servedModel}};
  const binding = {schemaVersion:1,artifact,probe,inventory,deployment};
  const response = {model:artifact.servedModel,usage:{prompt_tokens:3,completion_tokens:1},choices:[{
    prompt_token_ids:[10,20,30],token_ids:[42],logprobs:{top_logprobs:[{'token_id:15':-3,'token_id:16':-3}]}}]};
  return {binding,response};
}

test('native LoRA probe binds exact IDs, derived alias, immutable artifact and observed container',()=>{
  const {binding,response}=fixture(), identity=validateParityBinding(binding,source,hash);
  const request=parityRequest(binding.artifact,binding.probe);
  assert.deepEqual(request.prompt,binding.probe.inputTokenIds);
  assert.deepEqual(request.logprob_token_ids,[15,16]);
  assert.equal(request.model,binding.artifact.servedModel);
  assert.equal(request.add_special_tokens,false); assert.equal(request.return_token_ids,true);
  const receipt=verifyParityResponse(response,binding.artifact,binding.probe,identity,hash,timing);
  const {contentHash,...body}=receipt;
  assert.equal(contentHash,hash(body)); assert.equal(receipt.passed,true);
  assert.equal(receipt.nativeTaskAccuracyMeasured,false); assert.equal(receipt.conditionalProbabilityDifference,0);
  assert.equal(receipt.containerId,binding.inventory.containers.predictor.id);
});

test('native LoRA binding rejects substituted artifact, probe, inventory, source or mount',()=>{
  for (const edit of [
    b=>{b.artifact.adapterStorageDtype='bfloat16';},
    b=>{b.probe.inputTokenIds[0]=99;},
    b=>{b.inventory.containers.predictor.commandHash=hash('other command');},
    b=>{b.deployment.sourceCommit='f'.repeat(40);},
    b=>{b.deployment.predictor.weightsHash=hash('base');},
    b=>{b.inventory.containers.predictor.modelMountReadOnly=false;b.deployment.evidenceHash=hash(b.inventory);},
  ]) {
    const {binding}=fixture(); edit(binding);
    assert.throws(()=>validateParityBinding(binding,source,hash));
  }
});

test('native LoRA cross-engine gate rejects token, alias, usage and probability mismatches',()=>{
  for (const edit of [
    r=>{r.model='Qwen/Qwen3.5-0.8B';},
    r=>{r.choices[0].prompt_token_ids[0]=99;},
    r=>{r.choices[0].token_ids=[43];},
    r=>{r.usage.prompt_tokens=4;},
    r=>{r.choices[0].logprobs.top_logprobs[0]['token_id:16']=-2;},
    r=>{r.choices[0].logprobs.top_logprobs[0]['token_id:16']=NaN;},
    r=>{delete r.choices[0].logprobs.top_logprobs[0]['token_id:16'];},
  ]) {
    const {binding,response}=fixture(), identity=validateParityBinding(binding,source,hash); edit(response);
    assert.throws(()=>verifyParityResponse(response,binding.artifact,binding.probe,identity,hash,timing));
  }
});

test('native LoRA probability comparison is stable for very small vocabulary probabilities',()=>{
  const {binding,response}=fixture(), identity=validateParityBinding(binding,source,hash);
  response.choices[0].logprobs.top_logprobs[0]={'token_id:15':-10000,'token_id:16':-10000};
  assert.equal(verifyParityResponse(response,binding.artifact,binding.probe,identity,hash,timing).observedConditionalOneProbability,0.5);
});

test('complete-prompt probe keeps the unchanged numerical gate and rejects altered selection',()=>{
  function complete() {
    const {binding}=fixture();
    const ids=Array.from({length:300},(_,index)=>index);
    Object.assign(binding.probe,{schemaVersion:2,inputTokenIds:ids,inputHash:hash(ids),selection:{
      rule:'shortest_complete_neutral_weight_fit_prompt_v1',datasetManifestHash:hash('dataset'),
      trainingManifestHash:binding.artifact.trainingManifestHash,rowId:'fit:neutral',familyId:'fit',
      promptHash:hash('prompt'),promptTokens:300,eligibleRows:24}});
    function reseal() {
      binding.artifact.servingProbeHash=hash(binding.probe);
      const {contentHash,...body}=binding.artifact;
      binding.artifact.contentHash=hash(body);
      binding.deployment.evidenceHash=hash(binding.inventory);
    }
    reseal();
    return {binding,reseal};
  }
  const {binding}=complete();
  assert.equal(validateParityBinding(binding,source,hash).servingProbeHash,hash(binding.probe));
  assert.equal(parityRequest(binding.artifact,binding.probe).prompt.length,300);
  for (const edit of [
    p=>{p.inputHash=hash('other');},p=>{p.selection.familyId='cal';},p=>{p.selection.promptTokens=256;},
    p=>{p.selection.trainingManifestHash=hash('other');},p=>{p.selection.eligibleRows=0;},
    p=>{p.selection.rule='select_by_output';},
  ]) {
    const value=complete();edit(value.binding.probe);value.reseal();
    assert.throws(()=>validateParityBinding(value.binding,source,hash));
  }
});
