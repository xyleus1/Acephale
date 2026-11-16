// Synthetic local integration fixture. No provider or model network request is allowed.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [ledgerPath, directory] = process.argv.slice(2);
const port = JSON.parse(readFileSync(process.env.ACEPHALE_NATIVE_BUDGET_PORT, "utf8"));
const original = p => import(pathToFileURL(join(port.frozenRoot, p)).href);
const { hash } = await original("src/lib/acephale/canonical.ts");
const { DurableBudget } = await original("services/acephale-runtime/durable-budget.ts");
const analysisBudget=await import(pathToFileURL(join(port.analysisRoot,"services/acephale-runtime/durable-budget.ts")).href);
assert.equal(analysisBudget.DurableBudget,DurableBudget);
const { BudgetLedger: FrozenLedger } = await original("src/lib/acephale/budget.ts");
const { runInfraNativeService, writeInfraLedgerCheckpoint, infraNativeToolsHash } = await original("scripts/acephale-infra-native.ts");
const { attachInfraHostedWorkers, validateInfraHosted } = await original("services/acephale-runtime/infra-hosted-workers.ts");
const base = JSON.parse(readFileSync(ledgerPath + ".policy-v3.json", "utf8"));
let owner = new DurableBudget(ledgerPath);
const retained = owner.ledger.snapshot(); owner.close();
// The original financial implementation still rejects this same retained history.
const old = new FrozenLedger(undefined, retained.map(({id,...row}) => [id,row]), base.policy.allocationsMicrodollars);
assert.throws(() => old.reserve("old-ceiling", "training", 500000), /Protected study ceiling/);
const checkpoint = join(directory, "native-checkpoint.json");
await writeInfraLedgerCheckpoint(ledgerPath, checkpoint);
const tools = [{type:"function",function:{name:"list_all_airports",parameters:{type:"object",properties:{},additionalProperties:false}}}];
const configuration = {version:1,stage:"collection",manifestPath:"manifest.json",ledgerCheckpointPath:"native-checkpoint.json",
  actorBaseUrl:"http://localhost:8000",snapshotId:"synthetic-memory",stream:false,maximumLifetimeSeconds:30,
  taskBundleHash:hash("synthetic-tasks"),hosted:{allocation:"training",maxCostMicrodollarsPerRun:500000,maxSteps:2,maxErrors:1,timeoutSeconds:30},
  runs:[{runId:"synthetic",taskId:"synthetic-task",familyId:"train",domain:"airline",arm:"base",seed:0,maxBoundaries:2,tools}]};
const manifest=JSON.parse(readFileSync(join(port.frozenRoot,"research/acephale/examples/infra-manifest-v2.fixture.json"),"utf8"));
manifest.data.environmentRevision="2174a603f6d014ef94473ffa95957f6ce27100db";
manifest.data.toolSchemaHash=infraNativeToolsHash(configuration.runs);
manifest.protocol.scheduleHash=hash(configuration.runs);
manifest.budgets.ledgerCheckpointHash=hash(JSON.parse(readFileSync(checkpoint,"utf8")));
Object.assign(manifest.budgets,{budgetPolicyHash:base.policyHash,budgetAmendmentHash:base.contentHash,infrastructureMicrodollars:35000000,totalCeilingMicrodollars:1000000000});
writeFileSync(join(directory,"manifest.json"),JSON.stringify(manifest));
writeFileSync(join(directory,"config.json"),JSON.stringify(configuration));
const calls=[];
globalThis.fetch=async (url)=>{
  const parsed=new URL(String(url)); assert.equal(parsed.origin,"http://127.0.0.1:8009");
  calls.push(parsed.pathname);
  const payload=parsed.pathname==="/next"?null:parsed.pathname==="/status"?{closed:true}:{};
  return new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}});
};
const result=await runInfraNativeService(join(directory,"config.json"),join(directory,"native-output"),
  {gatewayUrl:"http://127.0.0.1:8009",gatewayToken:"x".repeat(32),budgetDirectory:directory});
assert.equal(result.aborted,false); assert.ok(calls.includes("/ready"));
owner=new DurableBudget(ledgerPath);
assert.equal(owner.ledger.snapshot().find(row=>row.id==="infra:synthetic").actual,0);
assert.deepEqual(owner.ledger.snapshot().filter(row=>retained.some(old=>old.id===row.id)),retained);
// Exercise original hosted-worker prompts, models, per-trial caps and unknown charges.
const requests=[];let count=0;
const hosted={allocation:"training",maxCostMicrodollarsPerRun:500000,maxSteps:2,maxErrors:1,timeoutSeconds:30};
const workers=attachInfraHostedWorkers([{runId:"accounting",worker:{async decision(){},async close(){}}}],hosted,owner.ledger,()=>{},
  (trial,allocation)=>({model:{async complete(request){
    requests.push(request);trial.reserve(request.id,allocation,100);
    if(++count===2)throw new Error("synthetic unknown transport");
    trial.settle(request.id,25);
    return {model:request.model,continuation:[],calls:[],text:"synthetic",status:"completed",refusals:[]};
  }},embed:async()=>[]}));
const boundary={policy:"synthetic unchanged native policy",tools:[],messages:[{role:"user",content:"hello"}]};
await workers[1].worker.decision(boundary,"first");
await assert.rejects(workers[2].worker.decision(boundary,"unknown"),/synthetic unknown/);
for(const worker of workers)await worker.worker.close();
assert.deepEqual(requests.map(r=>r.model),["gpt-4.1-mini-2025-04-14","gpt-5.4-2026-03-05"]);
assert.deepEqual(requests.map(r=>r.maxOutputTokens),[1024,4096]);assert.ok(requests.every(r=>r.retries===0&&r.instructions===boundary.policy));
assert.equal(owner.ledger.snapshot().find(row=>row.id==="infra:accounting").actual,undefined);
assert.deepEqual(owner.ledger.snapshot().filter(row=>row.parentId==="infra:accounting"&&row.actual===undefined).map(row=>row.maximum),[100]);
assert.throws(()=>validateInfraHosted({...hosted,allocation:"contingency"},"collection"),/allocation/);
assert.throws(()=>owner.ledger.reserveChild("infra:accounting","over-trial",500001),/Trial budget/);
assert.throws(()=>owner.ledger.reserve("unowned-infra","infrastructure",1),/cannot reserve/);
owner.close();
assert.equal(resolve(ledgerPath),resolve(directory,"budget.jsonl"));
console.log(JSON.stringify({actualFrozenNativeServicePassed:true,originalCeilingRejectionObserved:true,
  hostedLimitsAndUnknownAccountingPreserved:true,networkOrPaidCalls:0}));
