import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import type { Candidate } from "../src/lib/goalspec/contracts/generated";
import type { PublicBoundary } from "../services/goalspec-runtime/actor";
import type { ReadExecutor } from "../src/lib/goalspec/scheduler";
import { measureNativePair } from "./goalspec-infra-native-profile";

const boundary: PublicBoundary = { policy: "Read", tools: [{ type: "function", function: { name: "get_user_details", parameters: { type: "object" } } }],
  messages: [{ role: "user", content: "Read U1" }] };
const candidate: Candidate = { schemaVersion: 1, id: "unchanged-candidate", probability: 0.5, hop: 1, patternId: null,
  bindings: [{ sourceId: "requirement:0", path: [] }], invocation: { tool: "get_user_details", arguments: { user_id: "U1" },
    scope: { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1", environmentVersion: "pin", toolSchemaHash: hash(boundary.tools) } } };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const response = (inputHash = "same", tool = "get_user_details") => ({ tool_calls: [{ id: "actual-id", name: tool, arguments: { user_id: "U1" } }],
  raw_data: { goalspecCompiler: { inputHash } } }) as any;

test("native pair measures actual read and validation, keeps IDs and alternates order", async () => {
  for (const ordinal of [0, 1]) {
    const order: string[] = [];
    const executor: ReadExecutor = { eligible: () => true, read: async () => { order.push("read"); await delay(2); return { user_id: "U1" }; },
      validate: async (_, previous) => { order.push("refresh"); await delay(2); return previous; } };
    const measured = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal, seed: 0,
      executor, signal: AbortSignal.timeout(1000), actor: async suffix => { order.push(suffix); await delay(suffix === "concurrent" ? 40 : 2); return response(); },
      prediction: async () => { order.push("prediction"); await delay(2); return { actual: true }; } });
    assert.equal(measured.status, "completed");
    assert.equal(order[0], ordinal === 0 ? "baseline" : "concurrent");
    assert.equal(measured.candidate.id, candidate.id);
    assert.equal(measured.actor_baseline.result.tool_calls[0].id, "actual-id");
    assert.equal(order.filter(item => item === "read").length, 1);
    assert.equal(order.filter(item => item === "refresh").length, 1);
    assert.equal(Object.keys(measured.spans).length, 6);
    for (const [key, span] of Object.entries(measured.spans) as [string, any][]) {
      if (key !== "contentionMs") { assert.ok(span.clockId); assert.ok(span.endMs > span.startMs); }
    }
  }
});

test("native profile drains a slow read after actor failure and preserves the failure", async () => {
  let drained = false;
  const measured = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal: 1, seed: 0, signal: AbortSignal.timeout(1000),
    executor: { eligible: () => true, read: async () => { await delay(30); drained = true; return { id: "U1" }; }, validate: async (_, prior) => prior },
    actor: async () => { await delay(5); throw new Error("actor failed"); }, prediction: async () => ({}) });
  assert.equal(drained, true); assert.equal(measured.status, "failed");
  assert.equal(measured.errorType, "native_component_failure"); assert.match(measured.error, /actor failed/);
});

test("native profile rejects changed actor inputs and missing freshness validation without default timings", async () => {
  const executor: ReadExecutor = { eligible: () => true, read: async () => ({ id: "U1" }), validate: async () => { throw new Error("stale native lease"); } };
  const measured = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal: 0, seed: 0, executor,
    signal: AbortSignal.timeout(1000), actor: async () => response(), prediction: async () => ({}) });
  assert.equal(measured.status, "failed"); assert.equal(measured.spans.validationMs, undefined);
  executor.validate = async (_, prior) => prior;
  const changed = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal: 0, seed: 0, executor,
    signal: AbortSignal.timeout(1000), actor: async suffix => response(suffix), prediction: async () => ({}) });
  assert.equal(changed.status, "failed"); assert.match(changed.error, /input changed/);
});

test("native paired negative contention remains failed rather than a zero cost", async () => {
  const measured = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal: 0, seed: 0,
    executor: { eligible: () => true, read: async () => ({}), validate: async (_, prior) => prior }, signal: AbortSignal.timeout(1000),
    actor: async suffix => { await delay(suffix === "baseline" ? 40 : 1); return response(); }, prediction: async () => ({}) });
  assert.equal(measured.status, "failed"); assert.equal(measured.errorType, "paired_contention_unresolved_negative_excess");
  assert.equal(measured.spans.contentionMs.method, "paired_difference");
});

test("native profiling rejects a mixed mutation batch even when it contains the measured read", async () => {
  const measured = await measureNativePair({ boundary, candidate, checkpointId: "point", ordinal: 0, seed: 0,
    executor: { eligible: () => true, read: async () => ({}), validate: async (_, prior) => prior }, signal: AbortSignal.timeout(1000),
    nonMutating: invocation => invocation.tool === candidate.invocation.tool,
    actor: async suffix => {
      await delay(suffix === "concurrent" ? 40 : 1);
      const result = response(); result.tool_calls.push({ id: "mutation-id", name: "cancel_order", arguments: {} }); return result;
    }, prediction: async () => ({}) });
  assert.equal(measured.status, "failed"); assert.equal(measured.errorType, "actor_did_not_request_profiled_read");
});
