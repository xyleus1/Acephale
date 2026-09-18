import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation, Json, Scope } from "../src/lib/goalspec/contracts/generated";
import type { ModelPort } from "../src/lib/goalspec/model";
import { GoalSpecSession, type SessionPolicy } from "../src/lib/goalspec/session";
import { SpeculationScheduler, SpeculativeCapacity } from "../src/lib/goalspec/scheduler";
import { NativeGateway, NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { NativeBoundaryWorker } from "../services/goalspec-runtime/worker";
import type { PublicBoundary } from "../services/goalspec-runtime/actor";

const scope: Scope = { tenantId: "custom-tau-airline", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash([]) };
function frame(): ExecutionFrame {
  return { schemaVersion: 1, runId: "integration", scope: copy(scope), snapshotId: "frozen", boundary: 0,
    requestedObjective: "Find my booking", policy: "Pinned native policy", sources: { "requirement:0": "My user ID is user_current.", _binding_events: [] },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
}
function candidate(tool = "get_user_details", args: Record<string, Json> = { user_id: "user_current" }): Candidate {
  return { schemaVersion: 1, id: hash([tool, args]), invocation: { tool, arguments: args, scope: copy(scope) },
    probability: 0.97, bindings: [{ sourceId: "requirement:0", path: [] }], hop: 1, patternId: null };
}
const policy = (): SessionPolicy => ({ version: "v3", exposeEvidence: true, inferGoals: false, predictCandidates: true,
  query: value => value.requestedObjective, eagerWaitMs: 10, maxCandidateCalls: 2,
  estimate: { toolMs: 0, validationMs: 1, schedulingMs: 1, exposedPredictionMs: 0, actorRoundMs: 1000 } });

test("a denied high-confidence deterministic candidate cannot suppress model proposals in either session branch", async () => {
  for (const v3 of [false, true]) {
    let modelCalls = 0;
    const reads: Invocation[] = [], denied = candidate("get_reservation_details", { reservation_id: "handy" });
    const scheduler = new SpeculationScheduler("integration", {
      eligible: query => query.tool === "get_user_details",
      read: async query => { reads.push(query); return { user_id: "user_current", reservations: [] }; },
      validate: async (_query, observation) => observation,
    }, () => {}, new SpeculativeCapacity(2));
    const session = new GoalSpecSession({ retrieve: async () => [], retrieveLocal: () => [] }, {
      inferGoals: async () => frame().goals, embed: async () => [1], bindPatterns: () => [denied],
      calibrated: values => values.some(value => value.probability >= 0.8), validateArguments: () => true,
      candidates: async () => { modelCalls++; return [candidate()]; },
    }, scheduler, () => {}, v3 ? policy() : undefined);
    try {
      await session.boundary(frame(), ["requirement:0"]);
      await session.settlePredictions(); await nextTurn();
      assert.equal(modelCalls, 1, `Denied .97 proposal must not calibrate the ${v3 ? "v3" : "legacy"} pool`);
      assert.deepEqual(reads.map(query => query.tool), ["get_user_details"]);
    } finally { await session.close(); }
  }
});

test("optional non-mutating history classification retains observed reads across calculate, not writes", async () => {
  for (const [hook, lastTool, wantedReads] of [[true, "calculate", 0], [false, "calculate", 1], [true, "update_reservation_flights", 1]] as const) {
    const current = frame(); current.sources._binding_events = [
      { kind: "tool_request", call_id: "profile", tool: "get_user_details", arguments: { user_id: "user_current" } },
      { kind: "tool_result", call_id: "profile", tool: "get_user_details", status: "success", result: { user_id: "user_current", reservations: [] } },
      { kind: "tool_request", call_id: "later", tool: lastTool, arguments: { expression: "2+2" } },
      { kind: "tool_result", call_id: "later", tool: lastTool, status: "success", result: "4.0" },
    ];
    let reads = 0;
    const scheduler = new SpeculationScheduler("integration", { eligible: query => query.tool === "get_user_details",
      read: async () => { reads++; return { user_id: "user_current", reservations: [] }; }, validate: async (_query, result) => result,
    }, () => {}, new SpeculativeCapacity(2));
    const session = new GoalSpecSession({ retrieve: async () => [], retrieveLocal: () => [] }, {
      inferGoals: async () => current.goals, embed: async () => [1], bindPatterns: () => [candidate()],
      calibrated: values => values.some(value => value.probability >= 0.8), validateArguments: () => true, candidates: async () => [],
    }, scheduler, () => {}, { ...policy(), predictCandidates: false,
      ...(hook ? { nonMutating: (query: Invocation) => ["get_user_details", "calculate"].includes(query.tool) } : {}) });
    try {
      await session.boundary(current, ["requirement:0"]); await session.settlePredictions();
      assert.equal(reads, wantedReads);
    } finally { await session.close(); }
  }
});

test("native executor separates pure effects from speculative eligibility and preserves legacy defaults", () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  const reads = new NativeReadExecutor(gateway, "integration", scope, new Set(["get_user_details"]), new NativeReadPolicy("airline", scope));
  const math: Invocation = { tool: "calculate", arguments: { expression: "2+2" }, scope };
  assert.equal(reads.nonMutating(math), false, "No current pinned frame yet");
  reads.updateFrame(frame());
  assert.equal(reads.nonMutating(math), true);
  assert.equal(reads.eligible(math), false);
  assert.equal(reads.nonMutating({ ...math, scope: { ...scope, principalId: "other" } }), false);
  assert.equal(reads.nonMutating({ ...math, tool: "unknown_tool" }), false);
  const legacy = new NativeReadExecutor(gateway, "legacy", scope, new Set(["get_user_details"]));
  assert.equal(legacy.nonMutating(math), false);
  assert.equal(legacy.nonMutating(candidate().invocation), true);
});

test("worker preserves pure/read batches but promotes only eligible reads; any mutation fences the batch", async () => {
  for (const mixedMutation of [false, true]) {
    const toolDefinitions: PublicBoundary["tools"] = [
      { type: "function", function: { name: "get_user_details", parameters: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"] } } },
      { type: "function", function: { name: "calculate", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } } },
      { type: "function", function: { name: "update_reservation_flights", parameters: { type: "object", properties: {} } } },
    ];
    const ownScope = { ...scope, toolSchemaHash: hash(toolDefinitions) };
    const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
    const envelope = { content: JSON.stringify({ user_id: "user_current", reservations: [] }), error: false };
    let physicalReads = 0, refreshes = 0;
    gateway.read = async <T>() => { physicalReads++; return { lease: "read-lease", observation: envelope } as T; };
    gateway.request = async <T>() => { refreshes++; return { lease: "verified-lease", observation: envelope } as T; };
    const reads = new NativeReadExecutor(gateway, "integration", ownScope, new Set(["get_user_details"]), new NativeReadPolicy("airline", ownScope));
    const events: { type: string; details: Record<string, string | number | boolean> }[] = [];
    const scheduler = new SpeculationScheduler("integration", reads, event => events.push(event), new SpeculativeCapacity(2));
    const actorCalls = [{ id: "math", name: "calculate", arguments: { expression: "2+2" } },
      { id: "profile", name: "get_user_details", arguments: { user_id: "user_current" } },
      ...(mixedMutation ? [{ id: "write", name: "update_reservation_flights", arguments: {} }] : [])];
    const model: ModelPort = { async complete(request) { return { model: request.model, text: "", calls: actorCalls, continuation: [],
      status: "completed", refusals: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }; } };
    const worker = new NativeBoundaryWorker({ runId: "integration", scope: ownScope, snapshotId: "frozen", allocation: "development",
      maximumAttemptMicrodollars: 1, maxBoundaries: 1 }, model, () => {}, {
      scheduler, close: () => scheduler.close(), async boundary(current) {
        const proposal = candidate(); proposal.invocation.scope = ownScope;
        const keys = scheduler.admit([proposal]); await scheduler.waitForReads(keys, 50);
        return { frame: current, evidence: [], actorContext: "" };
      },
    }, reads);
    try {
      const response = await worker.decision({ tools: toolDefinitions, policy: "Native airline policy",
        messages: [{ role: "user", content: "My user ID is user_current." }] }, "boundary");
      assert.deepEqual(response._goalspecPromotions, mixedMutation ? {} : { profile: "verified-lease" });
      assert.equal(physicalReads, 1);
      assert.equal(refreshes, mixedMutation ? 0 : 1);
      assert.equal(events.filter(event => event.type === "invalidated" && event.details.reason === "native_mixed_or_mutating_batch").length, mixedMutation ? 1 : 0);
      assert.equal(events.filter(event => event.type === "promotion_requested").length, mixedMutation ? 0 : 1,
        "Calculate must never enter read promotion or produce a fabricated observation");
      assert.equal(events.filter(event => event.type === "authoritative_started").length, 0);
    } finally { await worker.close(); }
  }
});
