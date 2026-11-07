import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { BudgetLedger, heldoutSize, heldoutSizeFromLedger } from "../src/lib/acephale/budget";
import { compileInput, validateGoals } from "../src/lib/acephale/compiler";
import { SpeculationScheduler, SpeculativeCapacity, type ReadExecutor, type RuntimeEvent } from "../src/lib/acephale/scheduler";
import type { Candidate, Invocation } from "../src/lib/acephale/contracts/generated";
import { frequentContexts, resolveBinding } from "../src/lib/acephale/patterns";
import { parseArguments } from "../src/lib/acephale/model";

const invocation: Invocation = { tool: "lookup", arguments: { id: "current" }, scope: { tenantId: "a", principalId: "u", authorizationVersion: "1", environmentVersion: "fixture-v1", toolSchemaHash: "schema" } };
const candidate = (i = invocation): Candidate => ({ schemaVersion: 1, id: hash(i), invocation: i, probability: 0.8, bindings: [], hop: 1, patternId: null });
const events: RuntimeEvent[] = [];
function setup(executor: Partial<ReadExecutor> = {}, deadline = 500) {
  return new SpeculationScheduler("test", { eligible: i => i.tool === "lookup", read: async () => ({ found: 1 }), validate: async (_, value) => value, ...executor }, e => events.push(e), new SpeculativeCapacity(), deadline);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test("exact call joins work and rereads complete result", async () => {
  const initial = deferred<{ found: number }>(); let authoritative = 0; let validations = 0;
  const scheduler = setup({ read: () => initial.promise, validate: async () => { validations++; return { found: 2 }; } });
  assert.equal(scheduler.admit([candidate(), candidate()]).length, 1);
  const a = scheduler.authoritative(invocation, async () => { authoritative++; return {}; });
  const b = scheduler.authoritative(invocation, async () => { authoritative++; return {}; });
  initial.resolve({ found: 1 });
  assert.deepEqual(await a, { found: 2 }); assert.deepEqual(await b, { found: 2 });
  assert.equal(authoritative, 0); assert.equal(validations, 1);
  await scheduler.close();
});
test("timeout does not release capacity or start duplicate until settled", async () => {
  const initial = deferred<null>(); let duplicate = 0;
  const scheduler = setup({ read: () => initial.promise }, 5);
  scheduler.admit([candidate()]); await delay(15);
  const pending = scheduler.authoritative(invocation, async () => { duplicate++; return { fresh: true }; });
  await delay(5); assert.equal(duplicate, 0);
  initial.resolve(null); assert.deepEqual(await pending, { fresh: true }); assert.equal(duplicate, 1);
  await scheduler.close();
});
test("changed authorization fails closed on evidence exposure", async () => {
  const scheduler = setup({ validate: async () => { throw new Error("revoked"); } });
  scheduler.admit([candidate()]); await delay(1);
  assert.deepEqual(await scheduler.evidenceAtBoundary(), []);
  await scheduler.close();
});
test("late validation is fenced on shutdown", async () => {
  const check = deferred<{ secret: string }>();
  const scheduler = setup({ validate: () => check.promise });
  scheduler.admit([candidate()]); await delay(1);
  const boundary = scheduler.evidenceAtBoundary(); await delay(1);
  const close = scheduler.close(); check.resolve({ secret: "late" });
  assert.deepEqual(await boundary, []); await close;
  assert.equal(scheduler.admit([candidate()]).length, 0);
});
test("mutations invalidate pending evidence and preserve native batch", async () => {
  const scheduler = setup(); scheduler.admit([candidate()]); await delay(1);
  const result = await scheduler.mutationBatch(async () => {
    assert.equal(scheduler.admit([candidate()]).length, 0);
    return Promise.all([Promise.resolve("mutation"), scheduler.authoritative(invocation, async () => "native")]);
  });
  assert.deepEqual(result, ["mutation", "native"]);
  assert.deepEqual(await scheduler.evidenceAtBoundary(), []); await scheduler.close();
});
test("mutation waits for an authoritative promotion fallback to finish", async () => {
  const read = deferred<null>(); const fallback = deferred<null>(); let mutationStarted = false;
  const scheduler = setup({ read: () => read.promise });
  scheduler.admit([candidate()]);
  const authoritative = scheduler.authoritative(invocation, () => fallback.promise);
  const mutation = scheduler.mutationBatch(async () => { mutationStarted = true; return "mutated"; });
  read.resolve(null); await delay(2);
  assert.equal(mutationStarted, false);
  fallback.resolve(null); await authoritative;
  assert.equal(await mutation, "mutated"); await scheduler.close();
});
test("policy, per-run and global concurrency limits deny new reads", async () => {
  const pending = deferred<null>(); const capacity = new SpeculativeCapacity(1);
  const make = () => new SpeculationScheduler("run", { eligible: i => i.tool === "lookup", read: () => pending.promise, validate: async (_, v) => v }, () => {}, capacity);
  const a = make(), b = make();
  assert.equal(a.admit([candidate({ ...invocation, tool: "purchase" })]).length, 0);
  assert.equal(a.admit([candidate()]).length, 1); assert.equal(b.admit([candidate()]).length, 0);
  pending.resolve(null); await a.close(); await b.close(); assert.equal(capacity.used, 0);
});
test("different tenant cannot promote a matching argument", async () => {
  const scheduler = setup(); scheduler.admit([candidate()]);
  assert.equal(await scheduler.authoritative({ ...invocation, scope: { ...invocation.scope, tenantId: "b" } }, async () => "native"), "native");
  await scheduler.close();
});
test("context preserves mandatory sections and records omissions", () => {
  const result = compileInput([{ id: "policy", text: "keep", mandatory: true }, { id: "history", text: "x".repeat(100), mandatory: false }], 20, s => s.length);
  assert.deepEqual(result.selected, ["policy"]); assert.deepEqual(result.omitted, ["history"]);
  assert.throws(() => compileInput([{ id: "policy", text: "keep", mandatory: true }], 1, s => s.length));
});
test("source grounding rejects future and absent references", () => {
  const g = { schemaVersion: 1 as const, hypotheses: [{ id: "a", objective: "find", probability: 1, sources: [{ sourceId: "future", path: [] }], constraints: [] }], unknown: 0, revisionHash: "a" };
  assert.throws(() => validateGoals(g as never, {}), /not visible/);
});
test("budgets reserve concurrent attempts and protect infrastructure", () => {
  const ledger = new BudgetLedger(); ledger.reserve("a", "replay", 30_000_000);
  assert.throws(() => ledger.reserve("b", "replay", 1), /exhausted/);
  ledger.reserve("c", "infrastructure", 35_000_000); ledger.settle("a", 1);
  ledger.reserve("d", "replay", 2); assert.throws(() => ledger.settle("d", 3), /exceeded/);
  assert.equal(ledger.snapshot().find(r => r.id === "d")?.actual, 3);
  assert.deepEqual(heldoutSize([1], false), { allowance: 1.25, families: 16 });
  assert.deepEqual(heldoutSize([1], true), { allowance: 2.5, families: 8 });
});
test("heldout sizing retains old and unknown commitments without counting children twice", () => {
  const ledger = new BudgetLedger();
  ledger.reserve("old", "heldout", 100_000_000);
  ledger.reserveChild("old", "old/request", 10_000_000);
  assert.equal(ledger.remaining("heldout"), 140_000_000);
  assert.deepEqual(heldoutSizeFromLedger(ledger, [1], false), { allowance: 1.25, families: 8 });
  ledger.settle("old/request", 5_000_000); ledger.finishParent("old");
  assert.equal(ledger.remaining("heldout"), 235_000_000);
  assert.deepEqual(heldoutSize([1], false, 0), { allowance: 1.25, families: 0 });
  assert.throws(() => heldoutSize([1], false, 241), /remaining/);
});

test("canonical JSON rejects lossy coercion", () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  for (const value of [NaN, undefined, new Date(), [undefined]]) assert.throws(() => canonical(value));
  assert.throws(() => parseArguments("{")); assert.throws(() => parseArguments("[]"));
});
test("patterns count families and binding orders results by request", () => {
  assert.deepEqual(frequentContexts([["a", "b"], ["a", "c"]], ["same", "same"], 2, 2), []);
  assert.deepEqual(frequentContexts([["a", "b"], ["a", "c"]], ["one", "two"], 2, 2), [[[], [0, 1]], [["a"], [0, 1]]]);
  const events = [
    { seq: 1, kind: "tool_request", call_id: "1", tool: "search" },
    { seq: 2, kind: "tool_request", call_id: "2", tool: "search" },
    { seq: 3, kind: "tool_result", call_id: "2", tool: "search", status: "success", result: { id: "new" } },
    { seq: 4, kind: "tool_result", call_id: "1", tool: "search", status: "success", result: { id: "old" } },
  ];
  assert.equal(resolveBinding({ kind: "reference", reference: { source: "result", tool: "search", occurrence: 1, path: ["id"] } }, events, 4), "new");
  assert.throws(() => resolveBinding({ kind: "reference", reference: { source: "result", tool: "search", occurrence: 1, path: ["id"] } }, events, 2));
});
