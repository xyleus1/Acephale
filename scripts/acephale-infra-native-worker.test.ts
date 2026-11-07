import assert from "node:assert/strict";
import { test } from "node:test";
import { hash } from "../src/lib/acephale/canonical";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { InfraSession, type InfraSessionPolicy } from "../src/lib/acephale/infra-session";
import { SpeculationScheduler, SpeculativeCapacity, type RuntimeEvent } from "../src/lib/acephale/scheduler";
import type { Candidate, Scope } from "../src/lib/acephale/contracts/generated";
import { InfraNativeBoundaryWorker, infraNativeFrame } from "../services/acephale-runtime/infra-native-worker";
import { NativeGateway, NativeReadExecutor } from "../services/acephale-runtime/gateway-client";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import type { PublicBoundary } from "../services/acephale-runtime/actor";
import { infraNativePublicCheckpointInput } from "../services/acephale-runtime/infra-actor-event";
import { buildMemoryArtifact, type MemoryMessage } from "../src/lib/acephale/experience-memory";
import { extractCausalMemoryMisses } from "../src/lib/acephale/causal-memory";

const tools: PublicBoundary["tools"] = [
  { type: "function", function: { name: "get_user_details", parameters: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"], additionalProperties: false } } },
  { type: "function", function: { name: "calculate", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } } },
  { type: "function", function: { name: "update_reservation_flights", parameters: { type: "object", properties: {} } } },
];
const scope: Scope = { tenantId: "custom-tau-airline", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools) };
const configuration = { runId: "infra-native-fixture", scope, snapshotId: "frozen", maxBoundaries: 3, seed: 0 };
const publicBoundary: PublicBoundary = { policy: "Pinned native policy", tools, messages: [{ role: "user", content: "My user ID is user_current." }] };
const candidate: Candidate = { schemaVersion: 1, id: "profile", invocation: { tool: "get_user_details", arguments: { user_id: "user_current" }, scope },
  probability: 0.99, bindings: [{ sourceId: "requirement:0", path: [] }], hop: 1, patternId: null };
const profileCall = { id: "actual-profile", type: "function" as const, function: { name: "get_user_details", arguments: '{"user_id":"user_current"}' } };
const mathCall = { id: "actual-math", type: "function" as const, function: { name: "calculate", arguments: '{"expression":"2+2"}' } };
const writeCall = { id: "actual-write", type: "function" as const, function: { name: "update_reservation_flights", arguments: "{}" } };
const modelName = "Qwen/Qwen3.5-9B";

function actor(calls = [profileCall], beforeReturn: () => Promise<void> = async () => {}) {
  const received: Record<string, unknown>[] = [];
  const port = new LocalChatModelPort({ baseUrl: "http://localhost:8000", model: modelName, stream: false,
    fetch: (async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith("/tokenize")) return Response.json({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) });
      received.push(body); await beforeReturn();
      return Response.json({ model: modelName, choices: [{ index: 0, message: { role: "assistant", content: calls.length ? null : "done",
        ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 } });
    }) as typeof fetch });
  return { port, received };
}

function setup(options: { mixed?: boolean; denied?: boolean; noCandidates?: boolean } = {}) {
  const events: RuntimeEvent[] = [], records: Record<string, unknown>[] = [];
  const timeline: Record<string, unknown>[] = [];
  let physicalReads = 0, validations = 0;
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  const observation = { content: JSON.stringify({ user_id: "user_current", reservations: [] }), error: false };
  gateway.read = async <T>() => { physicalReads++; return { lease: "initial", observation } as T; };
  gateway.request = async <T>() => { validations++; if (options.denied) throw new Error("Lease revoked"); return { lease: "refreshed", observation } as T; };
  const reads = new NativeReadExecutor(gateway, configuration.runId, scope, new Set(["get_user_details"]), new NativeReadPolicy("airline", scope));
  const scheduler = new SpeculationScheduler(configuration.runId, reads, event => { events.push(event); timeline.push(event); }, new SpeculativeCapacity(4));
  let predictionBlocked = false;
  const policy: InfraSessionPolicy = { arm: "neutral_memory_prefetch", memoryHash: "a".repeat(64), goalReliability: 0,
    opportunity: () => ({ toolMs: 1000, actorLeadMs: 1000, predictionMs: 0, schedulingMs: 0, validationMs: 1, contentionMs: 0 }),
    candidates: () => options.noCandidates ? [] : [candidate], validateBinding: () => true,
    rank: async (_frame, candidates) => {
      predictionBlocked = true;
      await new Promise(resolve => setTimeout(resolve, 5));
      predictionBlocked = false;
      return candidates.length ? { action: "READ", scores: [{ candidateId: "profile", probability: 0.99 }] } : { action: "NO_READ", scores: [] };
    } };
  const record = (event: Record<string, unknown>) => { records.push(event); timeline.push(event); };
  const runtime = new InfraSession(scheduler, policy, record);
  let dispatchedDuringPrediction = false;
  const model = actor([mathCall, profileCall, ...(options.mixed ? [writeCall] : [])], async () => {
    dispatchedDuringPrediction = predictionBlocked;
    await runtime.settled(); await scheduler.waitForReads([hash(candidate.invocation)], 100);
  });
  const worker = new InfraNativeBoundaryWorker(configuration, model.port, record, runtime, reads);
  return { worker, scheduler, runtime, events, records, timeline, model, counts: () => ({ physicalReads, validations, dispatchedDuringPrediction }) };
}

test("local native worker starts actor without waiting for prediction and stages exact real-call lease", async () => {
  const fixture = setup();
  try {
    const response = await fixture.worker.decision(publicBoundary, "one");
    assert.deepEqual(response._acephalePromotions, { "actual-profile": "refreshed" });
    assert.deepEqual(response.tool_calls?.map(call => call.name), ["calculate", "get_user_details"]);
    assert.deepEqual(fixture.counts(), { physicalReads: 1, validations: 1, dispatchedDuringPrediction: true });
    assert.equal(fixture.events.filter(event => event.type === "authoritative_started").length, 0);
    assert.ok(!JSON.stringify(fixture.model.received).includes("refreshed"));
    const generated = fixture.timeline.findIndex(event => event.type === "actor_generated");
    const promoted = fixture.timeline.findIndex(event => event.type === "promotion_requested");
    assert.ok(generated >= 0 && promoted > generated);
    const event = fixture.timeline[generated];
    assert.equal(event.runId, configuration.runId); assert.equal(event.checkpoint, 0); assert.equal(event.boundaryId, "one");
    assert.equal(event.actorInputHash, response.raw_data.acephaleCompiler.inputHash);
    assert.equal(event.actorInputHashKind, "compiled_model_input");
    assert.equal(event.publicInputHash, hash(infraNativePublicCheckpointInput(configuration.runId, "one", publicBoundary)));
    const { _acephalePromotions: _, ...normalized } = response;
    void _;
    assert.equal(event.actorResponseHash, hash(normalized));
    assert.deepEqual(event.toolCalls, response.tool_calls?.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })));
  } finally { await fixture.worker.close(); }
});

test("mixed mutation/read batch preserves native calls and stages no speculative result", async () => {
  const fixture = setup({ mixed: true });
  try {
    const response = await fixture.worker.decision(publicBoundary, "one");
    assert.deepEqual(response._acephalePromotions, {});
    assert.deepEqual(response.tool_calls?.map(call => call.id), ["actual-math", "actual-profile", "actual-write"]);
    assert.equal(fixture.counts().validations, 0);
    assert.ok(fixture.records.some(event => event.type === "infra_native_mutation_barrier"));
    assert.equal(fixture.events.filter(event => event.type === "promotion_requested").length, 0);
  } finally { await fixture.worker.close(); }
});

test("missing or rejected freshness lease falls back to Python without fabricated physical execution", async () => {
  for (const options of [{ denied: true }, { noCandidates: true }]) {
    const fixture = setup(options);
    try {
      const response = await fixture.worker.decision(publicBoundary, "one");
      assert.deepEqual(response._acephalePromotions, {});
      assert.equal(response.tool_calls?.[1].id, "actual-profile");
      assert.equal(fixture.events.filter(event => event.type === "authoritative_started").length, 0);
      assert.ok(fixture.records.some(event => event.type === "infra_native_fallback_deferred_to_python"));
    } finally { await fixture.worker.close(); }
  }
});

test("public native frame preserves actual observations and excludes private or derived metadata", () => {
  const history: PublicBoundary = { ...publicBoundary, messages: [...publicBoundary.messages,
    { role: "assistant", content: null, tool_calls: [{ id: "prior", name: "get_user_details", arguments: { user_id: "user_current" } }],
      raw_data: { acephaleActorContext: { version: 1, boundary: 0, scopeHash: "a".repeat(64), snapshotId: "frozen", text: "PRIVATE_SENTINEL" } } },
    { role: "tool", id: "prior", content: '{"user_id":"user_current","reservations":[]}' },
  ] };
  const frame = infraNativeFrame(history, configuration, 1);
  assert.equal(frame.requestedObjective, "My user ID is user_current.");
  assert.deepEqual(frame.sources["observation:2"], { user_id: "user_current", reservations: [] });
  assert.ok(!JSON.stringify(frame).includes("PRIVATE_SENTINEL"));
  assert.equal((frame.sources._binding_events as unknown[]).length, 2);
});

test("native worker rejects schema drift and checkpoint replay before a model request", async () => {
  const model = actor([]), worker = new InfraNativeBoundaryWorker({ ...configuration, maxBoundaries: 1 }, model.port, () => {});
  try {
    await assert.rejects(worker.decision({ ...publicBoundary, tools: [] }, "bad"), /schema changed/);
    assert.equal(model.received.length, 0);
    const response = await worker.decision(publicBoundary, "one");
    assert.equal(response.content, "done");
    await assert.rejects(worker.decision(publicBoundary, "two"), /budget exhausted/);
    assert.equal(model.received.length, 1);
  } finally { await worker.close(); }
});

test("close cancels active actor request, drains ownership, and fences the response", async () => {
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const model = new LocalChatModelPort({ baseUrl: "http://localhost", model: modelName, stream: false,
    fetch: (async (input, init) => {
      if (String(input).endsWith("/tokenize")) return Response.json({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) });
      started();
      return await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }) as typeof fetch });
  const worker = new InfraNativeBoundaryWorker(configuration, model, () => {});
  const active = assert.rejects(worker.decision(publicBoundary, "one"), /cancelled/);
  await dispatched;
  await worker.close(); await active;
  await assert.rejects(worker.decision(publicBoundary, "two"), /unavailable/);
  await worker.close();
});

test("paired local actors receive the same request bytes regardless of speculative arm", async () => {
  const speculative = setup();
  const baseModel = actor([mathCall, profileCall]);
  const base = new InfraNativeBoundaryWorker(configuration, baseModel.port, () => {});
  try {
    const [withPrefetch, withoutPrefetch] = await Promise.all([speculative.worker.decision(publicBoundary, "one"), base.decision(publicBoundary, "one")]);
    assert.deepEqual(speculative.model.received, baseModel.received);
    assert.deepEqual(withPrefetch.tool_calls, withoutPrefetch.tool_calls);
    assert.deepEqual(withoutPrefetch._acephalePromotions, {});
    assert.deepEqual(withPrefetch._acephalePromotions, { "actual-profile": "refreshed" });
  } finally { await speculative.worker.close(); await base.close(); }
});

test("training shadow records causal rankings before actor generation and leaves authoritative actor calls unchanged", async () => {
  const records: Record<string, unknown>[] = [], shadowModel = actor([profileCall], () => new Promise(resolve => setImmediate(resolve)));
  let shadowCalls = 0;
  const shadow = new InfraNativeBoundaryWorker(configuration, shadowModel.port, event => records.push(event), undefined, undefined,
    async () => { shadowCalls++; return { candidates: [candidate], decision: { action: "READ", scores: [{ candidateId: candidate.id, probability: 0.9 }] } }; });
  const baseModel = actor([profileCall]), base = new InfraNativeBoundaryWorker(configuration, baseModel.port, () => {});
  try {
    const withShadow = await shadow.decision(publicBoundary, "one"), withoutShadow = await base.decision(publicBoundary, "one");
    assert.equal(shadowCalls, 1); assert.deepEqual(shadowModel.received, baseModel.received);
    assert.deepEqual(withShadow.tool_calls, withoutShadow.tool_calls); assert.deepEqual(withShadow._acephalePromotions, {});
    const rank = records.findIndex(event => event.type === "infra_ranking"), generated = records.findIndex(event => event.type === "actor_generated");
    assert.ok(rank >= 0 && generated > rank); assert.equal(records[rank].mode, "shadow"); assert.equal(records[rank].executionAllowed, false);
    assert.equal(records[rank].publicInputHash, records[generated].publicInputHash);
    assert.equal(records[rank].frameHash, records[generated].frameHash);
  } finally { await shadow.close(); await base.close(); }
});

test("late shadow ranking is cancelled at actor generation and fenced while close drains it", async () => {
  const records: Record<string, unknown>[] = []; let release!: () => void; let predictionSignal: AbortSignal | undefined;
  const worker = new InfraNativeBoundaryWorker(configuration, actor([]).port, event => records.push(event), undefined, undefined,
    async (_, signal) => {
      predictionSignal = signal; await new Promise<void>(resolve => { release = resolve; });
      return { candidates: [candidate], decision: { action: "READ", scores: [{ candidateId: candidate.id, probability: 1 }] } };
    });
  const response = await worker.decision(publicBoundary, "one");
  assert.equal(response.content, "done"); assert.equal(predictionSignal?.aborted, true);
  let closed = false; const closing = worker.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
  release(); await closing;
  assert.equal(records.filter(event => event.type === "infra_ranking").length, 0);
  assert.equal(records.filter(event => event.type === "infra_shadow_prediction_fenced").length, 1);
});

test("real native worker event shapes join the sealed public checkpoint and normalized response in causal memory", async () => {
  const fixture = setup();
  try {
    const response = await fixture.worker.decision(publicBoundary, "one"); await fixture.worker.close();
    const events = [...fixture.timeline, { type: "infra_native_service_closed" }].map((event, sequence) => ({ ...event,
      sequence, processClockId: "fixture-process", monotonicNs: String(sequence) }));
    const source = { path: "research/acephale/runs/fixture/events.jsonl", sha256: hash(events) };
    const prefix: MemoryMessage[] = [{ index: 0, role: "user", content: publicBoundary.messages[0].content!, calls: [], callId: null, observation: null }];
    const actions = response.tool_calls!.map(call => ({ id: call.id, tool: call.name, arguments: call.arguments as Record<string, string> }));
    const memory = buildMemoryArtifact({ repositorySnapshotId: configuration.snapshotId, sourceFiles: [source], misses: [],
      runs: [{ id: configuration.runId, familyId: "training-family", stage: "v5-training", split: "train", scope, policyHash: hash(publicBoundary.policy),
        sourceFiles: [source], success: true, outcomeVerified: true, verificationTier: "native_verified", constraintViolations: 0,
        termination: "user_stop", publicMessageCount: 2, episodeCount: 1 }],
      episodes: [{ id: "episode", runId: configuration.runId, boundary: 0, scope, prefix, prefixHash: hash(prefix), requirements: [prefix[0].content!],
        previousTool: "__start__", nextActions: actions, nextMessage: null, resultingObservations: [], argumentSources: [], lesson: "fixture" }] }, { profile: "v5" });
    const input = infraNativePublicCheckpointInput(configuration.runId, "one", publicBoundary);
    const publicRows = [{ type: "public_checkpoint", ...input, inputHash: hash(input) },
      { type: "public_response", runId: configuration.runId, boundaryId: "one", response }];
    const misses = extractCausalMemoryMisses(memory, events, publicRows, source);
    assert.equal(misses.length, 1); assert.equal(misses[0].fullMatch, true); assert.equal(misses[0].admitted, true);
  } finally { await fixture.worker.close(); }
});
