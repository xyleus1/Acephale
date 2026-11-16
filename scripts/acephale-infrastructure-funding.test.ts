import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { budgetPolicyPath } from "../services/acephale-runtime/budget-policy";
import { frozenApiProjection, infrastructureFundingPath } from "../services/acephale-runtime/infrastructure-funding";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { amendBudgetPolicy } from "./acephale-budget-policy";
import { addInfrastructureFunding, extendInfrastructureFunding } from "./acephale-infrastructure-funding";
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

test("separate funding preserves old bytes and expands only the infrastructure owner",()=>{
  const f=fixture(); try {
    const originals=[f.ledger,f.slice,budgetPolicyPath(f.ledger,2),budgetPolicyPath(f.ledger,3)].map(path=>[path,readFileSync(path)] as const);
    const funding=authorize(f);
    assert.throws(()=>awsBudget({...f.request,sliceLedgerPath:join(f.directory,"wrong-slice.json"),operation:"inspect"}),/funding slice/);
    for(const [path,bytes] of originals) assert.deepEqual(readFileSync(path),bytes);
    assert.throws(()=>authorize(f),/EEXIST/);
    const infra=new DurableBudget(f.ledger,{infrastructureOwner:true});
    assert.equal(infra.ledger.totalCeilingMicrodollars,1_100_000_000);
    assert.equal(infra.ledger.allocations.infrastructure,300_000_000);
    assert.equal(infra.infrastructureFunding?.contentHash,funding.contentHash);
    assert.deepEqual({...infra.ledger.allocations,infrastructure:200_000_000},f.base.policy.allocationsMicrodollars);
    assert.throws(()=>infra.validateManifestPolicy({infrastructureMicrodollars:300_000_000,
      budgetPolicyHash:f.base.policyHash,budgetAmendmentHash:f.base.contentHash}),/differs/); infra.close();
    const result=awsBudget({...f.request,operation:"reserve",reservationId:"lambda-infra:00000000-0000-0000-0000-000000000001",
      maximumMicrodollars:20_696_000,requireNewReservation:true});
    assert.equal(result.infrastructureMicrodollars,212_497_503);
    assert.equal(result.infrastructureFundingSupplementHash,funding.contentHash);
    assert.equal(result.frozenProjectedNonContingencyMicrodollars,516_497_503);
    const frozen=new DurableBudget(f.ledger);
    assert.equal(frozen.ledger.totalCeilingMicrodollars,1_000_000_000);
    assert.equal(frozen.ledger.remaining("infrastructure"),0);
    frozen.ledger.reserveMany([{id:"native-development",allocation:"development",maximum:1_000_000}]);
    frozen.ledger.reserveChild("native-development","native-child",200);
    frozen.ledger.settle("native-child",50); frozen.ledger.finishParent("native-development");
    assert.equal(frozen.ledger.snapshot().find(row=>row.id==="retained-gpu-unknown")?.actual,undefined);
    assert.throws(()=>frozen.ledger.reserve("no-extra-infra","infrastructure",1),/exhausted/); frozen.close();
  } finally {f.close();}
});

test("funding rejects changed identities, retained journal history and revised financial claims",()=>{
  const f=fixture(); try {
    const funding=authorize(f);
    for(const change of [
      {baseBudgetPolicyHash:"f".repeat(64)}, {infrastructurePlanHash:"f".repeat(64)},
      {effectiveFinancialCeilingsChanged:false}, {authorizedAt:"2026-01-01T00:00:00Z"},
      {policy:{...funding.policy,effectiveInfrastructureMicrodollars:400_000_000}},
      {baselineEntries:[{id:"missing",allocation:"infrastructure",maximum:1}]},
    ]) {
      const {contentHash:_,...body}={...funding,...change};
      writeFileSync(infrastructureFundingPath(f.ledger),canonical({...body,contentHash:hash(body)}));
      assert.throws(()=>new DurableBudget(f.ledger,{infrastructureOwner:true}),/funding/i);
    }
  } finally {f.close();}
});

test("GPU reservation preserves the declared frozen API headroom before any new journal entry",()=>{
  const f=fixture(); try {
    const funding=authorize(f), owner=new DurableBudget(f.ledger,{infrastructureOwner:true});
    const snapshot=owner.ledger.snapshot();
    const projection=frozenApiProjection(snapshot,20_696_000,owner.policy!,funding);
    assert.equal(projection.frozenApiHeadroomMicrodollars,303_000_000);
    assert.throws(()=>frozenApiProjection(snapshot,540_000_000,owner.policy!,funding),/headroom/);
    assert.throws(()=>frozenApiProjection([...snapshot,{id:"old-dev",allocation:"development",maximum:55_000_001}],0,owner.policy!,funding),/unchanged allocation/);
    owner.ledger.reserveMany([
      {id:"large-prior-training",allocation:"training",maximum:98_000_000},
      {id:"prior-preparation",allocation:"preparation",maximum:100_000_000},
      {id:"prior-development",allocation:"development",maximum:55_000_000},
      {id:"prior-heldout",allocation:"heldout",maximum:112_000_000},
      {id:"prior-replay",allocation:"replay",maximum:65_000_000},
    ]); owner.close();
    const before=readFileSync(f.ledger);
    assert.throws(()=>awsBudget({...f.request,operation:"reserve",reservationId:"lambda-infra:00000000-0000-0000-0000-000000000002",
      maximumMicrodollars:60_000_000,requireNewReservation:true}),/headroom/);
    assert.deepEqual(readFileSync(f.ledger),before);
  } finally {f.close();}
});

test("supplement writer retains unknown launches but rejects active work",()=>{
  const f=fixture(); try {
    f.value.leases[1].status="active"; writeFileSync(f.slice,canonical(f.value));
    assert.throws(()=>authorize(f),/closed or retained unknown/);
  } finally {f.close();}
});

test("remaining-stage projection fits the observed retained balances without releasing holds",()=>{
  const f=fixture(); try {
    const funding=authorize(f);
    const entries=[
      {id:"retained-preparation",allocation:"preparation" as const,maximum:41_903_897},
      {id:"retained-development",allocation:"development" as const,maximum:21_297_341},
      {id:"retained-heldout",allocation:"heldout" as const,maximum:111_883_904},
      {id:"retained-replay",allocation:"replay" as const,maximum:12_540_687},
      {id:"retained-training",allocation:"training" as const,maximum:5_922_048},
      {id:"retained-infrastructure",allocation:"infrastructure" as const,maximum:191_801_503},
    ];
    const before=canonical(entries);
    const result=frozenApiProjection(entries,20_696_000,f.base,funding);
    assert.equal(result.frozenProjectedNonContingencyMicrodollars,709_045_380);
    assert.equal(result.frozenApiHeadroomMicrodollars,303_000_000);
    assert.equal(canonical(entries),before);
    assert.deepEqual(funding.policy.frozenApiPlanMicrodollars,{preparation:0,training:0,development:65_000_000,heldout:238_000_000,replay:0});
  } finally {f.close();}
});

const extend = (f: ReturnType<typeof fixture>) => extendInfrastructureFunding(f.ledger,f.slice,"2026-11-16T07:00:00Z",
  "Explicit continuation: one evaluation-only lease, up to six hours; retain all unknown holds.",()=>"c".repeat(40));

test("second funding is append-only and protects the frozen API reader",()=>{
  const f=fixture(); try {
    const parent=authorize(f);
    const originals=[f.ledger,f.slice,budgetPolicyPath(f.ledger,3),infrastructureFundingPath(f.ledger)].map(path=>[path,readFileSync(path)] as const);
    const extension=extend(f);
    assert.equal(extension.version,2); assert.equal(extension.parentFundingHash,parent.contentHash);
    for(const [path,bytes] of originals) assert.deepEqual(readFileSync(path),bytes);
    assert.throws(()=>extend(f),/EEXIST/);
    const infra=new DurableBudget(f.ledger,{infrastructureOwner:true});
    assert.equal(infra.ledger.totalCeilingMicrodollars,1_120_000_000);
    assert.equal(infra.ledger.allocations.infrastructure,320_000_000);
    assert.equal(infra.ledger.allocations.contingency,65_000_000);
    assert.equal(infra.infrastructureFunding?.contentHash,extension.contentHash);
    assert.deepEqual({...infra.ledger.allocations,infrastructure:200_000_000},f.base.policy.allocationsMicrodollars);
    const projection=frozenApiProjection(infra.ledger.snapshot(),15_522_000,f.base,extension);
    assert.equal(projection.frozenApiHeadroomMicrodollars,303_000_000); infra.close();
    const frozen=new DurableBudget(f.ledger);
    assert.equal(frozen.ledger.totalCeilingMicrodollars,1_000_000_000);
    assert.equal(frozen.ledger.allocations.infrastructure,200_000_000);
    assert.equal(frozen.ledger.snapshot().find(row=>row.id==="retained-gpu-unknown")?.actual,undefined); frozen.close();
  } finally {f.close();}
});

test("second funding rejects missing parent, active leases, changed ancestry and revised caps",()=>{
  const f=fixture(); try {
    assert.throws(()=>extend(f),/original funding/);
    authorize(f);
    f.value.leases[1].status="active"; writeFileSync(f.slice,canonical(f.value));
    assert.throws(()=>extend(f),/closed or retained unknown/);
    f.value.leases[1].status="launch_unknown"; writeFileSync(f.slice,canonical(f.value));
    const extension=extend(f);
    for(const change of [
      {parentFundingHash:"f".repeat(64)}, {parentFundingSha256:"f".repeat(64)},
      {authorizedAt:"2026-11-14T00:00:00Z"},
      {policy:{...extension.policy,effectiveInfrastructureMicrodollars:321_000_000}},
      {baselineEntries:extension.baselineEntries.filter(row=>row.id!=="retained-gpu-unknown")},
    ]) {
      const {contentHash:_,...body}={...extension,...change};
      writeFileSync(infrastructureFundingPath(f.ledger,2),canonical({...body,contentHash:hash(body)}));
      assert.throws(()=>new DurableBudget(f.ledger,{infrastructureOwner:true}),/funding/i);
    }
  } finally {f.close();}
});
