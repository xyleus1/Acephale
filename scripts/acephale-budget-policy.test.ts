import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { BUDGET_POLICY_V2, BUDGET_POLICY_V3, budgetPolicyPath } from "../services/acephale-runtime/budget-policy";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { amendBudgetPolicy } from "./acephale-budget-policy";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "acephale-budget-policy-"));
  const ledger = join(directory, "budget.jsonl"), slicePath = join(directory, "slice.json");
  const owner = new DurableBudget(ledger);
  owner.ledger.reserve("old-infrastructure", "infrastructure", 25_000_000);
  owner.ledger.reserve("unknown-training", "training", 5_000_000);
  owner.close();
  const plan = { studyLedgerPath: ledger, infrastructureLedgerPath: slicePath };
  const slice = { schemaVersion: 2, provider: "lambda", plan, planHash: hash(plan), priorGpuHours: 0,
    leases: [{ status: "terminated", reservedHours: 10 }], overheads: [], trainingWindows: [{ reservedSeconds: 7200 }] };
  writeFileSync(slicePath, canonical(slice));
  return { ledger, slicePath, slice, close() {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture path");
    rmSync(directory, { recursive: true, force: true });
  } };
}

test("approved rebalance preserves original bytes, reservations and protected contingency", () => {
  const f = fixture();
  try {
    const before = readFileSync(f.ledger), sliceBefore = readFileSync(f.slicePath);
    const amendment = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z");
    assert.deepEqual(readFileSync(f.ledger), before);
    assert.deepEqual(readFileSync(f.slicePath), sliceBefore);
    const owner = new DurableBudget(f.ledger);
    assert.equal(owner.ledger.remaining("infrastructure"), 25_000_000);
    assert.equal(owner.ledger.remaining("training"), 25_000_000);
    assert.equal(owner.ledger.allocations.contingency, 65_000_000);
    assert.equal(owner.ledger.snapshot().find(row => row.id === "unknown-training")?.actual, undefined);
    assert.throws(() => owner.validateManifestPolicy({ infrastructureMicrodollars: 35_000_000 }), /differs/);
    owner.validateManifestPolicy({ infrastructureMicrodollars: 50_000_000,
      budgetPolicyHash: amendment.policyHash, budgetAmendmentHash: amendment.contentHash });
    owner.ledger.reserveMany([{ id: "new-infrastructure", allocation: "infrastructure", maximum: 25_000_000 }]);
    assert.throws(() => owner.ledger.reserve("excess", "infrastructure", 1), /exhausted/);
    owner.close();
    assert(readFileSync(f.ledger).subarray(0, before.length).equals(before));
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z"), /Closed original/);
  } finally { f.close(); }
});

test("policy tampering and dropped historical entries fail closed", () => {
  const f = fixture();
  try {
    const amendment = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z");
    for (const changed of [
      { ...amendment, policy: { ...BUDGET_POLICY_V2, totalMicrodollars: 600_000_000 } },
      { ...amendment, baselineEntries: [{ id: "missing", allocation: "training", maximum: 1 }] },
    ]) {
      const { contentHash: _, ...body } = changed;
      writeFileSync(budgetPolicyPath(f.ledger), canonical({ ...body, contentHash: hash(body) }));
      assert.throws(() => new DurableBudget(f.ledger), /amendment/);
    }
  } finally { f.close(); }
});

test("amendment requires closed work and cannot reduce an allocation below commitments", () => {
  const f = fixture();
  try {
    f.slice.leases[0].status = "active";
    writeFileSync(f.slicePath, canonical(f.slice));
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z"), /Closed original/);
    f.slice.leases[0].status = "terminated";
    writeFileSync(f.slicePath, canonical(f.slice));
    const owner = new DurableBudget(f.ledger);
    owner.ledger.reserve("prior-training", "training", 30_000_000); owner.close();
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z"), /exhausted/);
  } finally { f.close(); }
});

test("v3 appends to the original v2 chain and preserves unresolved reservations", () => {
  const f = fixture();
  try {
    const parent = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z");
    const originals = [f.ledger, f.slicePath, budgetPolicyPath(f.ledger)].map(path => [path, readFileSync(path)] as const);
    const amended = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:24:00Z", 3);
    assert.equal(amended.parentAmendmentHash, parent.contentHash);
    assert.deepEqual(amended.policy, BUDGET_POLICY_V3);
    for (const [path, bytes] of originals) assert.deepEqual(readFileSync(path), bytes);
    const owner = new DurableBudget(f.ledger);
    assert.equal(owner.policy?.version, 3);
    assert.equal(owner.ledger.totalCeilingMicrodollars, 1_000_000_000);
    assert.equal(owner.ledger.allocations.contingency, 65_000_000);
    assert.equal(owner.ledger.snapshot().find(row => row.id === "unknown-training")?.actual, undefined);
    owner.ledger.reserve("additional-infra", "infrastructure", 175_000_000);
    assert.throws(() => owner.ledger.reserve("extra-infra", "infrastructure", 1), /exhausted/);
    owner.close();
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:25:00Z", 3), /Closed original/);
  } finally { f.close(); }
});

test("v3 rejects missing parents, changed chains and active work", () => {
  const f = fixture();
  try {
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:24:00Z", 3), /Closed original/);
    amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z");
    f.slice.leases[0].status = "active";
    writeFileSync(f.slicePath, canonical(f.slice));
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:24:00Z", 3), /Closed original/);
    f.slice.leases[0].status = "terminated";
    writeFileSync(f.slicePath, canonical(f.slice));
    const amendment = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:24:00Z", 3);
    const { contentHash: _, ...body } = { ...amendment, parentAmendmentHash: "f".repeat(64) };
    writeFileSync(budgetPolicyPath(f.ledger, 3), canonical({ ...body, contentHash: hash(body) }));
    assert.throws(() => new DurableBudget(f.ledger), /parent chain/);
  } finally { f.close(); }
});

test("v3 cannot reseal invalid v2 training windows", () => {
  const f = fixture();
  try {
    const parent = amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T00:00:00Z");
    writeFileSync(f.slicePath, canonical({ ...f.slice, trainingWindows: [...f.slice.trainingWindows,
      { reservedSeconds: 901, trainingKind: "smoke", budgetAmendmentHash: parent.contentHash }] }));
    assert.throws(() => amendBudgetPolicy(f.ledger, f.slicePath, "2026-11-13T08:24:00Z", 3), /Parent training allowance/);
  } finally { f.close(); }
});
