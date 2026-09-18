import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { actorDecision, compileActorInput, nativeInput, type ActorRuntime, type PublicBoundary, type NativeMessage } from "../services/goalspec-runtime/actor";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { compileUnits } from "../src/lib/goalspec/compiler";
import { countTokens } from "../src/lib/goalspec/tokens";
import { providerFailure, type ModelPort, type ModelRequest } from "../src/lib/goalspec/model";
import type { EvidenceEnvelope, ExecutionFrame } from "../src/lib/goalspec/contracts/generated";

const boundary: PublicBoundary = {
  policy: "Follow the domain policy. Use function calls for actions and ordinary text for messages.",
  tools: [{ type: "function", function: { name: "lookup", description: "Read the current record.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } } }],
  messages: [
    { role: "user", content: "Find record 42." },
    { role: "assistant", tool_calls: [{ id: "real-call", name: "lookup", arguments: { id: "42" } }],
      raw_data: { goalspecContinuation: [
        { type: "reasoning", id: "reasoning-item", summary: [], encrypted_content: "opaque-test-continuation" },
        { type: "message", role: "assistant", id: "commentary-item", status: "completed", phase: "commentary",
          content: [{ type: "output_text", text: "Checking the record.", annotations: [] }] },
        { type: "function_call", id: "provider-item", call_id: "real-call", name: "lookup", arguments: '{"id":"42"}' },
      ] } },
    { role: "tool", id: "real-call", content: '{"id":"42","status":"open"}' },
    { role: "user", content: "Tell me its status." },
  ],
};
const frame: ExecutionFrame = { schemaVersion: 1, runId: "actor-v3", boundary: 1,
  scope: { tenantId: "test", principalId: "test", authorizationVersion: "1", environmentVersion: "1", toolSchemaHash: hash(boundary.tools) },
  snapshotId: "test", policy: boundary.policy, requestedObjective: "Tell me its status.", sources: { "requirement:0": "Find record 42." },
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
const configuration: Omit<ModelRequest, "input" | "instructions" | "tools"> = { id: "actor-v3:actor", model: "gpt-5.4-2026-03-05",
  reasoning: "medium", maxOutputTokens: 4096, allocation: "development", maximumAttemptMicrodollars: 1, retries: 0 };

test("full-fit actor compilation preserves causal protocol and exact greedy compiler metadata", () => {
  const expected = { input: nativeInput(boundary.messages), instructions: boundary.policy,
    tools: boundary.tools.map(tool => ({ type: "function", ...tool.function, strict: false })) };
  const groups = [
    { id: "history:0:0", value: boundary.messages.slice(0, 1), mandatory: true, priority: 0 },
    { id: "history:1:2", value: boundary.messages.slice(1, 3), mandatory: true, priority: 1 },
    { id: "history:3:3", value: boundary.messages.slice(3), mandatory: true, priority: 3 },
  ];
  const reference = compileUnits(groups, values => canonical({ ...expected, input: nativeInput(values.flat()) }), 32640, countTokens);
  const compiled = compileActorInput(boundary);
  assert.deepEqual(compiled, { ...expected, metadata: { compilerVersion: reference.compilerVersion,
    inputHash: reference.inputHash, tokens: reference.tokens, selected: ["policy", "tools", ...reference.selected], omitted: [] } });
  assert.deepEqual(compiled.input.slice(1, 4), boundary.messages[1]!.raw_data!.goalspecContinuation);
  assert.equal((compiled.input[4] as { call_id: string }).call_id, "real-call");
});

test("changing runtime context follows an identical policy, tools and causal history prefix", () => {
  const base = compileActorInput(boundary);
  for (const context of ["[INFERRED GOALS]\nfirst", "[INFERRED GOALS]\nsecond\n\n[HISTORICAL WORKFLOW EXAMPLES]\nexample"]) {
    const current = compileActorInput(boundary, context);
    assert.equal(current.instructions, base.instructions);
    assert.deepEqual(current.tools, base.tools);
    assert.deepEqual(current.input.slice(0, -1), base.input);
    assert.deepEqual(current.input.at(-1), { role: "developer", content: context });
    assert(current.metadata.selected.includes("goals_and_verified_evidence"));
  }
  assert.deepEqual(compileActorInput(boundary, ""), base);
});

test("base and both lossless runtime arms dispatch identical requests with no empty context message", async () => {
  const requests: ModelRequest[] = [];
  const model: ModelPort = { async complete(request) {
    requests.push(request);
    return { model: request.model, continuation: [], calls: [], text: "Record 42 is open.", status: "completed", refusals: [], usage: undefined };
  } };
  const runtime = { boundary: async () => ({ actorContext: "" }) } as unknown as ActorRuntime;
  for (const arm of [undefined, runtime, runtime]) {
    const response = await actorDecision(boundary, frame, model, configuration, arm);
    assert.equal(response.content, "Record 42 is open.");
    assert.equal(response.tool_calls, null);
    assert.equal(response.raw_data.goalspecActorContext, undefined);
    assert.equal(response.raw_data.goalspecVerifiedEvidence, undefined);
  }
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(requests[1], requests[2]);
  assert.equal(requests[0]!.maxOutputTokens, 4096);
  assert.equal(requests[0]!.reasoning, "medium");
});

test("only exposed typed evidence is snapshotted before model latency, never fabricated as a tool result", async () => {
  const observation = { user_id: "observed-user" };
  const envelope: EvidenceEnvelope = { schemaVersion: 1, id: "verified-read", invocation: { tool: "lookup", arguments: { id: "42" }, scope: frame.scope },
    observation, observationHash: hash(observation), observedAt: 10, validatedAt: 11, validation: "fresh", physicalCalls: 1 };
  const runtime = (actorContext: string) => ({ boundary: async () => ({ actorContext, evidence: [envelope] }) }) as unknown as ActorRuntime;
  const model: ModelPort = { complete: async request => {
    observation.user_id = "changed-after-dispatch";
    return { model: request.model, continuation: [], calls: [], text: "Done.", status: "completed", refusals: [], usage: undefined };
  } };
  const response = await actorDecision(boundary, frame, model, configuration, runtime("[VERIFIED PREFETCHED EVIDENCE]\nobserved-user"));
  assert.deepEqual(response.raw_data.goalspecVerifiedEvidence![0]!.observation, { user_id: "observed-user" });
  assert.equal(response.raw_data.goalspecVerifiedEvidence![0]!.observationHash, hash({ user_id: "observed-user" }));
  const replay = nativeInput([{ role: "assistant", raw_data: response.raw_data }]);
  assert.equal(replay.length, 1);
  assert.equal((replay[0] as { role: string }).role, "developer");
  const hidden = await actorDecision(boundary, frame, model, configuration, runtime(""));
  assert.equal(hidden.raw_data.goalspecVerifiedEvidence, undefined);
  assert.equal(hidden.raw_data.goalspecActorContext, undefined);
});

test("early evidence survives the next boundary as the exact historical developer item, with provenance", async () => {
  const requests: ModelRequest[] = [];
  const continuation = [{ type: "message" as const, role: "assistant" as const, id: "final-item", status: "completed" as const,
    phase: "final_answer" as const, content: [{ type: "output_text" as const, text: "Record 42 is open.", annotations: [] }] }];
  const model: ModelPort = { async complete(request) {
    requests.push(request);
    return { model: request.model, continuation, calls: [], text: "Record 42 is open.", status: "completed", refusals: [], usage: undefined };
  } };
  const runtime = { boundary: async () => ({ actorContext: "[VERIFIED PREFETCHED EVIDENCE]\nRecord 42 was open." }) } as unknown as ActorRuntime;
  const first = await actorDecision(boundary, frame, model, configuration, runtime);
  const stored = first.raw_data.goalspecActorContext!;
  assert.equal(stored.boundary, frame.boundary);
  assert.equal(stored.scopeHash, hash(frame.scope));
  assert.equal(stored.snapshotId, frame.snapshotId);
  assert.equal(stored.version, 1);
  assert(stored.text.includes("historical evidence, not a fresh observation"));
  assert(stored.text.includes("never proves a mutation succeeded"));
  assert.deepEqual(requests[0]!.input.at(-1), { role: "developer", content: stored.text });
  const history: NativeMessage = { role: "assistant", content: first.content, tool_calls: first.tool_calls, raw_data: first.raw_data };
  const next = { ...boundary, messages: [...boundary.messages, history, { role: "user" as const, content: "What was its observed status?" }] };
  await actorDecision(next, { ...frame, boundary: frame.boundary + 1 }, model, { ...configuration, id: "next" });
  assert.deepEqual(requests[1]!.input.slice(0, requests[0]!.input.length), requests[0]!.input);
  assert.deepEqual(requests[1]!.input.slice(requests[0]!.input.length, -1), continuation);
  assert.equal(requests[1]!.input.filter(item => "role" in item && item.role === "developer").length, 1);
  assert.equal(requests[1]!.input.filter(item => "type" in item && item.type === "function_call_output").length, 1);
  assert.throws(() => nativeInput([{ ...history, raw_data: { ...history.raw_data,
    goalspecActorContext: { ...stored, scopeHash: "invalid" } } }]), /historical actor context/);
});

test("interleaved runtime boundaries keep each saved context attached to its own provenance", async () => {
  let releaseFirst!: (context: { actorContext: string }) => void;
  const delayed = new Promise<{ actorContext: string }>(resolve => { releaseFirst = resolve; });
  const runtime = { boundary: async (current: ExecutionFrame) => current.runId === "delayed" ? delayed : { actorContext: "second-only evidence" } } as unknown as ActorRuntime;
  const model: ModelPort = { complete: async request => ({ model: request.model, continuation: [], calls: [], text: "Done.", status: "completed", refusals: [], usage: undefined }) };
  const pending = actorDecision(boundary, { ...frame, runId: "delayed", boundary: 8, snapshotId: "first-snapshot" }, model, configuration, runtime);
  const second = await actorDecision(boundary, { ...frame, runId: "second", boundary: 9, snapshotId: "second-snapshot" }, model, configuration, runtime);
  releaseFirst({ actorContext: "first-only evidence" });
  const first = await pending;
  assert.equal(first.raw_data.goalspecActorContext!.snapshotId, "first-snapshot");
  assert.equal(first.raw_data.goalspecActorContext!.boundary, 8);
  assert(first.raw_data.goalspecActorContext!.text.includes("first-only evidence"));
  assert(!first.raw_data.goalspecActorContext!.text.includes("second-only evidence"));
  assert.equal(second.raw_data.goalspecActorContext!.snapshotId, "second-snapshot");
  assert.equal(second.raw_data.goalspecActorContext!.boundary, 9);
});

test("actor tool responses retain original call IDs and opaque continuation without exposing commentary", async () => {
  const continuation = boundary.messages[1]!.raw_data!.goalspecContinuation!;
  const response = await actorDecision(boundary, frame, { complete: async () => ({ model: configuration.model,
    continuation, calls: [{ id: "real-call", name: "lookup", arguments: { id: "42" } }], text: "Checking the record.",
    status: "completed", refusals: [], usage: undefined }) }, configuration);
  assert.equal(response.content, null);
  assert.deepEqual(response.tool_calls, [{ id: "real-call", name: "lookup", arguments: { id: "42" }, requestor: "assistant" }]);
  assert.deepEqual(response.raw_data.goalspecContinuation, continuation);
});

test("actual SDK failure subclasses and request IDs survive safe diagnostics without private payloads", () => {
  const headers = new Headers({ "x-request-id": "req_safe_example", authorization: "private header" });
  const rate = new OpenAI.RateLimitError(429, { message: "private body", code: "rate_limit_exceeded" }, "private message", headers);
  const result = providerFailure(rate);
  assert.equal(result.errorType, "Error");
  assert.equal(result.errorClass, "RateLimitError");
  assert.equal(result.requestId, "req_safe_example");
  assert.equal(result.status, 429);
  const cause = Object.assign(new TypeError("private connection detail"), { cause: Object.assign(new Error("private socket"), { code: "ECONNRESET" }) });
  const connection = providerFailure(new OpenAI.APIConnectionError({ cause }));
  assert.equal(connection.errorClass, "APIConnectionError");
  assert.equal(connection.status, null);
  assert.equal(connection.causeCode, "ECONNRESET");
  assert.equal(connection.causeType, "TypeError");
  assert.equal(providerFailure(new OpenAI.APIConnectionTimeoutError()).errorClass, "APIConnectionTimeoutError");
  assert(!JSON.stringify([result, connection]).includes("private"));
  assert.equal(providerFailure({ requestID: "sk-proj-sensitive", status: Infinity }).requestId, null);
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(providerFailure(cyclic).causeCode, null);
});
