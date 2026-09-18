import assert from "node:assert/strict";
import { test } from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import { SpeculationScheduler, SpeculativeCapacity, ReadAuthorizationDeniedError, type ReadExecutor } from "../src/lib/goalspec/scheduler";
import type { Candidate, Invocation, Json } from "../src/lib/goalspec/contracts/generated";
import { DERYA_EPOCH_CONTRACT_HASH, DERYA_EPOCH_TABLES, epochsEqual, validateEpochOptions, type EpochReuseReceipt } from "../src/lib/goalspec-adapters/derya-epochs";
import { deryaToolResult } from "../src/lib/goalspec-adapters/derya-read-executor";

const invocation: Invocation = { tool: "lookup", arguments: {}, scope: { tenantId: "office", principalId: "user", authorizationVersion: "auth", environmentVersion: "v5", toolSchemaHash: "schema" } };
const candidate: Candidate = { schemaVersion: 1, id: "read", invocation, probability: 1, bindings: [], hop: 1, patternId: null };
test("authoritative projection envelopes are checked before the app receives a typed result", () => {
  assert.deepEqual(deryaToolResult({ ok: true, result: null }), { ok: true, result: null });
  assert.deepEqual(deryaToolResult({ ok: false, error: "Job not found" }), { ok: false, error: "Job not found" });
  const malformed: Json[] = [null, [], {}, { ok: true }, { ok: false, error: 4 }];
  for (const value of malformed) assert.throws(() => deryaToolResult(value), /invalid tool envelope/);
});
function scheduler(overrides: Partial<ReadExecutor>) {
  return new SpeculationScheduler("denial", { eligible: () => true, read: async () => ({ value: 1 }), validate: async (_, previous) => previous, ...overrides }, () => {}, new SpeculativeCapacity());
}
test("typed denial is terminal after exposure validation and cannot call native fallback", async () => {
  const s = scheduler({ validateFreshness: async () => ({ status: "denied", reason: "revoked" }) });
  const keys = s.admit([candidate]); await s.waitForReads(keys, 250);
  assert.deepEqual(await s.evidenceAtBoundary(), []);
  let fallback = 0;
  await assert.rejects(s.authoritative(invocation, async () => { fallback++; return {}; }), ReadAuthorizationDeniedError);
  assert.equal(fallback, 0); await s.close();
});
test("denied initial read and empty denial reason remain terminal", async () => {
  for (const overrides of [
    { read: async () => { throw new ReadAuthorizationDeniedError("revoked"); } },
    { validateFreshness: async () => ({ status: "denied" as const, reason: "" }) },
  ]) {
    const s = scheduler(overrides); s.admit([candidate]);
    await assert.rejects(s.authoritative(invocation, async () => { assert.fail("native fallback executed"); }), ReadAuthorizationDeniedError);
    await s.close();
  }
});
test("stale proof permits fresh guarded execution; arbitrary observation status is not a proof", async () => {
  const stale = scheduler({ validateFreshness: async () => ({ status: "stale" }) });
  stale.admit([candidate]); assert.deepEqual(await stale.authoritative(invocation, async () => ({ fresh: true })), { fresh: true }); await stale.close();
  const legacy = scheduler({ validate: async () => ({ status: "denied", businessStatus: true }) });
  legacy.admit([candidate]); assert.deepEqual(await legacy.authoritative(invocation, async () => null), { status: "denied", businessStatus: true }); await legacy.close();
});
test("reuse requires pinned evidence and measured performance gates", () => {
  const receipt: EpochReuseReceipt = { version: 1, contractHash: DERYA_EPOCH_CONTRACT_HASH, coverageHash: "a".repeat(64), incarnation: "test", allowedTools: ["search_jobs"],
    equivalenceEvidenceHash: "b".repeat(64), performanceEvidenceHash: "c".repeat(64), equivalencePassed: true,
    validationSamples: 100, writerSamples: 100, validationP95Ms: 2, fullReadP95Ms: 3, writerOverheadRatio: .04 };
  validateEpochOptions({ mode: "off" }); validateEpochOptions({ mode: "shadow" });
  validateEpochOptions({ mode: "verified-reuse", receipt, trustedReceiptHash: hash(receipt) });
  for (const patch of [{ writerOverheadRatio: .051 }, { validationP95Ms: 4 }, { contractHash: "old" }, { validationSamples: 0 }, { equivalencePassed: false }]) {
    const invalid = { ...receipt, ...patch } as EpochReuseReceipt;
    assert.throws(() => validateEpochOptions({ mode: "verified-reuse", receipt: invalid, trustedReceiptHash: hash(invalid) }), /requires pinned/);
  }
  assert.throws(() => validateEpochOptions({ mode: "verified-reuse", receipt, trustedReceiptHash: "changed" }), /requires pinned/);
});
test("every get_job dependency and incarnation are necessary, unrelated tables only over-invalidate", () => {
  const snapshot = { incarnation: "one", coverageHash: "coverage", contractHash: DERYA_EPOCH_CONTRACT_HASH, counters: Object.fromEntries(DERYA_EPOCH_TABLES.map(t => [t, "1"])) };
  assert(epochsEqual(snapshot, snapshot, "get_job"));
  for (const table of DERYA_EPOCH_TABLES) assert(!epochsEqual(snapshot, { ...snapshot, counters: { ...snapshot.counters, [table]: "2" } }, "get_job"));
  assert(epochsEqual(snapshot, { ...snapshot, counters: { ...snapshot.counters, EmailMessage: "2" } }, "search_jobs"));
  assert(!epochsEqual(snapshot, { ...snapshot, incarnation: "two" }, "search_jobs"));
  assert(!epochsEqual(snapshot, { ...snapshot, coverageHash: "changed" }, "search_jobs"));
});
