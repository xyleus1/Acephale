import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { DurableBudget as NativeBudget } from "../services/acephale-runtime/native-financial-budget";
import { budgetPolicyPath } from "../services/acephale-runtime/budget-policy";
import { frozenApiProjection, infrastructureFundingPath } from "../services/acephale-runtime/infrastructure-funding";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { amendBudgetPolicy } from "./acephale-budget-policy";
import { addInfrastructureFunding, extendInfrastructureFunding, continueEvaluationFunding, completeEvaluationFunding, fundEvaluationOperations } from "./acephale-infrastructure-funding";
import { awsBudget } from "./acephale-aws-budget";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "acephale-funding-")), ledger = join(directory, "budget.jsonl"), slice = join(directory, "slice.json");
  let owner = new DurableBudget(ledger);
  owner.ledger.reserve("prior-infrastructure", "infrastructure", 25_000_000);
  owner.ledger.reserve("retained-model-unknown", "training", 1_000_000); owner.close();
  const plan = { studyLedgerPath: ledger, infrastructureLedgerPath: slice };
  const value = { schemaVersion: 2, provider: "lambda", plan, planHash: hash(plan), priorGpuHours: 0,
    leases: [{ id: "old", status: "terminated", instanceId: "old-instance", reservedHours: 10,
      reservedUsd: 25, reservedComputeUsd: 20 }], overheads: [], trainingWindows: [{ reservedSeconds: 7200 }] };
  writeFileSync(slice, canonical(value));
  amendBudgetPolicy(ledger, slice, "2026-11-13T00:00:00Z", 2);
  const base = amendBudgetPolicy(ledger, slice, "2026-11-13T08:00:00Z", 3);
  owner = new DurableBudget(ledger);
  owner.ledger.reserve("retained-gpu-unknown", "infrastructure", 166_801_503);
  const entries = owner.ledger.snapshot(); owner.close();
  value.leases.push({ id: "unknown", status: "launch_unknown", instanceId: null as unknown as string,
    reservedHours: 61.5, reservedUsd: 166.801503, reservedComputeUsd: 122.285002 });
  writeFileSync(slice, canonical(value));
  const checkpointPath = join(directory, "original-checkpoint.json");
  const checkpoint = {version:1,ledgerPathHash:hash(ledger),entriesHash:hash(entries),entries};
  writeFileSync(checkpointPath,canonical(checkpoint));
  const request = {provider:"lambda" as const,ledgerPath:ledger,checkpointPath,checkpointHash:hash(checkpoint),
    sliceLedgerPath:slice,deploymentHash:hash(plan)};
  awsBudget({...request,operation:"bind"});
  return {directory,ledger,slice,value,base,request,close(){
    if (!resolve(directory).startsWith(resolve(tmpdir())+sep)) throw new Error("Unsafe fixture path");
    rmSync(directory,{recursive:true,force:true});
  }};
}
const authorize = (f: ReturnType<typeof fixture>) => addInfrastructureFunding(f.ledger,f.slice,"2026-11-15T00:00:00Z",
  "Explicit user instruction: continue necessary training and evaluation.",()=>"b".repeat(40));


function priorFunding(f:ReturnType<typeof fixture>) {
  authorize(f);
  for (const [fn,date] of [[extendInfrastructureFunding,"2026-11-16T07:00:00Z"],
    [continueEvaluationFunding,"2026-11-16T09:00:00Z"],[completeEvaluationFunding,"2026-11-16T17:00:00Z"]] as const) {
    fn(f.ledger,f.slice,date,"Retain all prior holds under the user continuation instruction.",()=>"c".repeat(40));
  }
}
const finance=(f:ReturnType<typeof fixture>)=>fundEvaluationOperations(f.ledger,f.slice,"2026-11-16T20:00:00Z",
  "Operator-selected bounded allowance under broad necessary-resource authorization.",()=>"d".repeat(40));
function fill(f:ReturnType<typeof fixture>) {
  const owner=new DurableBudget(f.ledger,{infrastructureOwner:true});
  owner.ledger.reserveMany([
    {id:"retained-extra-infrastructure",allocation:"infrastructure",maximum:338_198_497},
    {id:"retained-preparation",allocation:"preparation",maximum:100_000_000},
    {id:"retained-training",allocation:"training",maximum:98_000_000},
    {id:"retained-development",allocation:"development",maximum:55_000_000},
    {id:"retained-heldout",allocation:"heldout",maximum:111_000_000},
    {id:"retained-replay",allocation:"replay",maximum:65_000_000},
  ]); owner.close();
}
test("funding5 creates only its authority and keeps full parents and protected API allocations",()=>{
  const f=fixture();try {
    priorFunding(f);
    const files=[f.ledger,f.slice,budgetPolicyPath(f.ledger,2),budgetPolicyPath(f.ledger,3),
      ...([1,2,3,4] as const).map(v=>infrastructureFundingPath(f.ledger,v))];
    const before=files.map(p=>[p,readFileSync(p)] as const);
    const value=finance(f);assert.equal(value.version,5);assert.equal(value.policy.maximumNewLeases,16);
    assert.equal(value.policy.maximumSessionHours,8);assert.equal(value.policy.maximumHourlyUsd,1.99);
    assert.deepEqual([value.policy.effectiveTotalMicrodollars,value.policy.effectiveInfrastructureMicrodollars,
      value.policy.effectiveComputeMicrodollars,value.policy.effectiveAssociatedMicrodollars],[1350000000,550000000,415000000,135000000]);
    for(const [p,bytes] of before)assert.deepEqual(readFileSync(p),bytes);
    assert.throws(()=>finance(f),/EEXIST/);
    fill(f);
    const owner=new NativeBudget(f.ledger);assert.equal(owner.ledger.totalCeilingMicrodollars,1350000000);
    assert.deepEqual({...owner.ledger.allocations,infrastructure:200000000},f.base.policy.allocationsMicrodollars);
    const projection=frozenApiProjection(owner.ledger.snapshot(),20_696_000,f.base,value);
    assert.equal(projection.frozenApiHeadroomMicrodollars,303000000);
    assert.equal(projection.frozenNonContingencyCeilingMicrodollars,1285000000);
    assert.equal(projection.originalFrozenTotalCeilingMicrodollars,1000000000);
    assert.equal(projection.nativeBudgetPort,"acephale-infrastructure-aware-native-budget-v1");
    assert.throws(()=>frozenApiProjection(owner.ledger.snapshot(),100000000,f.base,value),/headroom/);
    assert.throws(()=>owner.ledger.reserve("forbidden-infra","infrastructure",1),/cannot reserve/);
    assert.throws(()=>owner.ledger.reserveMany([{id:"forbidden-infra","allocation":"infrastructure",maximum:1}]),/cannot reserve/);
    owner.ledger.reserveMany([{id:"protected-dev",allocation:"development",maximum:65000000},
      {id:"protected-held",allocation:"heldout",maximum:238000000}]);
    owner.ledger.reserveChild("protected-dev","actual-request",4000);owner.ledger.settle("actual-request",1000);
    owner.ledger.finishParent("protected-dev");
    assert.throws(()=>owner.ledger.reserveChild("protected-held","over-trial",238000001),/Trial budget/);
    assert.equal(owner.ledger.snapshot().find(r=>r.id==="retained-gpu-unknown")?.actual,undefined);
    owner.close();
  }finally{f.close();}
});
test("native financial port is explicit and rejects absent or modified v5 authority",()=>{
  const f=fixture();try{
    priorFunding(f);assert.throws(()=>new NativeBudget(f.ledger),/exact funding v5/);
    const funding=finance(f);
    for(const change of [{parentFundingHash:"f".repeat(64)},{parentFundingSha256:"f".repeat(64)},
      {policy:{...funding.policy,frozenApiHeadroomMicrodollars:1}},
      {policy:{...funding.policy,effectiveInfrastructureMicrodollars:551000000}},
      {policy:{...funding.policy,nativeBudgetPort:"other"}}]){
      const {contentHash:_,...body}={...funding,...change};
      writeFileSync(infrastructureFundingPath(f.ledger,5),canonical({...body,contentHash:hash(body)}));
      assert.throws(()=>new NativeBudget(f.ledger),/funding/i);
    }
  }finally{f.close();}
});
test("actual frozen native service consumes only the pinned operational budget port",{skip:!process.env.ACEPHALE_FROZEN_RUNTIME || !process.env.ACEPHALE_FROZEN_ANALYSIS_ROOT},async()=>{
  const f=fixture();try{
    priorFunding(f);finance(f);fill(f);
    const root=resolve(fileURLToPath(new URL("..",import.meta.url))), frozen=resolve(process.env.ACEPHALE_FROZEN_RUNTIME!);
    const loader=join(root,"scripts/acephale-native-budget-port.mjs");
    const loaderModule=await import(pathToFileURL(loader).href);
    const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
    const manifest={version:1,profile:loaderModule.PROFILE,frozenSourceCommit:loaderModule.FROZEN_COMMIT,
      frozenRoot:frozen,analysisRoot:resolve(process.env.ACEPHALE_FROZEN_ANALYSIS_ROOT!),analysisSourceCommit:loaderModule.ANALYSIS_COMMIT,
      analysisTargetPath:join(resolve(process.env.ACEPHALE_FROZEN_ANALYSIS_ROOT!),"services/acephale-runtime/durable-budget.ts"),analysisTargetSha256:loaderModule.FROZEN_BUDGET_SHA,
      operatorRoot:root,operatorSourceCommit:"d".repeat(40),
      targetPath:join(frozen,"services/acephale-runtime/durable-budget.ts"),targetSha256:loaderModule.FROZEN_BUDGET_SHA,
      modelContractsChanged:false,originalJournalRewritten:false,
      files:Object.fromEntries(loaderModule.FINANCIAL_FILES.map((p:string)=>[p,sha(join(root,p))]))};
    const path=join(f.directory,"port.json");writeFileSync(path,JSON.stringify(manifest));
    const env={...process.env,ACEPHALE_NATIVE_BUDGET_PORT:path,ACEPHALE_NATIVE_BUDGET_PORT_SHA256:sha(path),
      NODE_OPTIONS:`--import=${pathToFileURL(loader).href}`,OPENAI_API_KEY:"synthetic-unused-test-key"};
    const child=spawnSync(process.execPath,["--import","tsx","scripts/fixtures/native-financial-port.mjs",f.ledger,f.directory],
      {cwd:root,env,encoding:"utf8",timeout:120000});
    assert.equal(child.status,0,child.stdout+child.stderr);
    assert.match(child.stdout,/actualFrozenNativeServicePassed/);
    for(const change of [{targetSha256:"f".repeat(64)},{targetPath:join(frozen,"src/lib/acephale/infra-model.ts")},
      {frozenSourceCommit:"f".repeat(40)},{analysisTargetPath:join(frozen,"src/lib/acephale/infra-model.ts")},{files:{...manifest.files,"src/lib/acephale/budget.ts":"f".repeat(64)}}]){
      writeFileSync(path,JSON.stringify({...manifest,...change}));
      const invalid=spawnSync(process.execPath,["--import","tsx","-e","throw Error('unreachable')"],
        {cwd:root,env:{...env,ACEPHALE_NATIVE_BUDGET_PORT_SHA256:sha(path)},encoding:"utf8",timeout:15000});
      assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Budget port/);assert.doesNotMatch(invalid.stderr,/Error: unreachable/);
    }
  }finally{f.close();}
});
