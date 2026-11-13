import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {LocalChatModelPort} from '/app/src/lib/acephale/infra-model.ts';
import {InfraTelemetry} from '/app/services/acephale-runtime/infra-telemetry.ts';
import {binaryRankingSchema, decodeBinaryRanking} from '/app/services/acephale-runtime/infra-binary-ranking.ts';
import {hash} from '/app/src/lib/acephale/canonical.ts';
import {validateTrainedPredictor} from '/app/src/lib/acephale/predictor-artifact.ts';
import {parityRequest, validateParityBinding, verifyParityResponse} from './serving-parity.mjs';

const [output, deadlineText, sourceCommit, bindingPath] = process.argv.slice(2);
const deadline = Number(deadlineText) * 1000;
assert(output?.startsWith('/artifacts/qualification-') && Number.isFinite(deadline) && deadline > Date.now());
assert(/^[a-f0-9]{40}$/.test(sourceCommit));
let binding, parityIdentity;
if (bindingPath) {
  assert(bindingPath.startsWith('/artifacts/') && !bindingPath.split('/').includes('..'));
  binding = JSON.parse(await readFile(bindingPath, 'utf8'));
  validateTrainedPredictor(binding.artifact);
  parityIdentity = validateParityBinding(binding, sourceCommit, hash);
}
const predictorModel = binding?.artifact.servedModel ?? 'Qwen/Qwen3.5-0.8B';
const signal = AbortSignal.timeout(Math.max(1, Math.floor(deadline - Date.now() - 5000)));
const runId = output.split('/').at(-1);
const telemetry = await InfraTelemetry.create(output, 'http://alloy:4318');
const observations = {kind:'infrastructure-protocol-qualification', nativeBenchmarkScore:false, sourceCommit, runId};
const actor = new LocalChatModelPort({baseUrl:'http://actor:8000/v1',model:'Qwen/Qwen3.5-9B',record:telemetry.record});
const predictor = new LocalChatModelPort({baseUrl:'http://predictor:8000/v1',model:predictorModel,contextWindow:8192,inputBudget:7168,maxOutputTokens:1024,record:telemetry.record});
async function json(url, body) {
  const response = await fetch(url, {signal, ...(body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(`Qualification HTTP ${response.status}: ${new URL(url).pathname}`);
  return response.json();
}
const messages = [{role:'system',content:'This is an infrastructure protocol check. Call read_fixture exactly once with key health. After the tool returns healthy:true, answer READY without calling any tool again.'}, {role:'user',content:'Use read_fixture to read health now.'}];
const tools = [{type:'function',function:{name:'read_fixture',description:'Read the named local infrastructure fixture.',parameters:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:['health']}},required:['key']}}}];
try {
  await telemetry.span('serving_qualification', runId, {purpose:'infrastructure-only'}, async () => {
    const first = await actor.complete({id:runId+':actor-tool',messages,tools,maxOutputTokens:4096,signal,seed:17});
    assert.equal(first.calls.length,1); assert.equal(first.calls[0].name,'read_fixture'); assert.deepEqual(first.calls[0].arguments,{key:'health'});
    assert(first.calls[0].id && first.usage);
    observations.actorTool = first;
    const tokens = await Promise.all(['0','1'].map(prompt => json('http://predictor:8000/tokenize',{model:predictorModel,prompt,add_special_tokens:false})));
    assert(tokens.every(row => row.count===1 && row.tokens.length===1)); assert.notEqual(tokens[0].tokens[0],tokens[1].tokens[0]);
    observations.binaryTokenIds = {zero:tokens[0].tokens[0],one:tokens[1].tokens[0]};
    if (binding) {
      assert.deepEqual(observations.binaryTokenIds,binding.artifact.binaryTokenIds);
      const probeStartedAtUnixMs = Date.now();
      const response = await json('http://predictor:8000/v1/completions',parityRequest(binding.artifact,binding.probe));
      const probeCompletedAtUnixMs = Date.now();
      await writeFile(output+'/native-lora-probe-response.json',JSON.stringify(response,null,2)+'\n',{flag:'wx',mode:0o600});
      observations.nativeLoraQualification = verifyParityResponse(response,binding.artifact,binding.probe,parityIdentity,hash,
        {probeStartedAtUnixMs,probeCompletedAtUnixMs});
      observations.nativeLoraProof = {version:1,binding,response,receipt:observations.nativeLoraQualification};
    }
    const started = Date.now();
    const [continued, binary] = await Promise.all([
      actor.complete({id:runId+':actor-continuation',messages:[...messages,first.continuation,{role:'tool',tool_call_id:first.calls[0].id,content:'{"healthy":true}'}],tools,maxOutputTokens:4096,signal,seed:17}),
      predictor.complete({id:runId+':predictor-binary',messages:[{role:'system',content:'Protocol qualification only. Return exactly the requested JSON object, without commentary.'},{role:'user',content:'Return {"action":"READ","hits":[1,0]}.'}],maxOutputTokens:1024,signal,seed:17,responseFormat:{name:'qualification_binary',strict:true,schema:binaryRankingSchema(2)},logprobTokenIds:tokens.map(row=>row.tokens[0])})
    ]);
    assert.equal(continued.calls.length,0); assert.match(continued.text,/READY/); assert(continued.usage && binary.usage);
    observations.actorContinuation = continued;
    observations.predictorBinary = binary;
    observations.binaryDecoded = decodeBinaryRanking(binary,[{id:'fixture-health'},{id:'fixture-other'}],true);
    assert.deepEqual(JSON.parse(binary.text),{action:'READ',hits:[1,0]});
    observations.concurrentInferenceElapsedMs = Date.now()-started;
  });
} finally { await telemetry.close(); }
observations.telemetry = telemetry.exportSummary();
assert.equal(observations.telemetry.failed,0);
assert.equal(observations.telemetry.shutdownFailed,false);
assert.equal(observations.telemetry.observabilityStatus,"no_failures_observed");
assert(observations.telemetry.tracesAccepted>0 && observations.telemetry.metricsAccepted>0);
await writeFile(output+'/protocol-observation.json',JSON.stringify({...observations,protocolPassed:true,backendQualificationPending:true},null,2)+'\n',{flag:'wx',mode:0o600});
const traceId = hash(runId).slice(0,32);
let backendEvidence;
for (let attempt=0; attempt<12 && Date.now()<deadline-5000; attempt++) {
  try {
    const trace = await json('http://tempo:3200/api/traces/'+traceId);
    const metric = await json('http://prometheus:9090/api/v1/query?query=acephale_runtime_spans_total');
    const logs = await json('http://loki:3100/loki/api/v1/query_range?query='+encodeURIComponent('{job="acephale"} |= "serving_qualification"')+'&limit=20');
    const grafana = await json('http://grafana:3000/api/health');
    assert(metric.data?.result?.length>0 && logs.data?.result?.length>0 && grafana.database==='ok');
    backendEvidence = {traceId,trace,metric,logs,grafana}; break;
  } catch (error) {
    if (attempt===11 || signal.aborted) throw error;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
assert(backendEvidence);
observations.backendEvidence = backendEvidence;
observations.passed = true;
if (observations.nativeLoraQualification) {
  await writeFile(output+'/native-lora-qualification.json',JSON.stringify(observations.nativeLoraQualification,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(output+'/native-lora-proof.json',JSON.stringify(observations.nativeLoraProof,null,2)+'\n',{flag:'wx',mode:0o600});
}
await writeFile(output+'/qualification.json',JSON.stringify(observations,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true,output,traceId,actorToolCallId:observations.actorTool.calls[0].id,telemetry:observations.telemetry,nativeBenchmarkScore:false}));
