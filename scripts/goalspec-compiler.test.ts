import assert from "node:assert/strict";
import { test } from "node:test";
import { compileActorInput, nativeInput, type NativeMessage } from "../services/goalspec-runtime/actor";
import { compileUnits, predictorSourceSections } from "../src/lib/goalspec/compiler";
import { ContractPredictors, exactTextValue } from "../src/lib/goalspec/predictors";
import { hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame } from "../src/lib/goalspec/contracts/generated";

const frame: ExecutionFrame = { schemaVersion: 1, runId: "compiler-fixture", boundary: 1,
  scope: { tenantId: "t", principalId: "p", authorizationVersion: "a", environmentVersion: "e", toolSchemaHash: "s" },
  snapshotId: "fixture", policy: "Required policy", requestedObjective: "Find my account",
  sources: { "requirement:0": "My email is alice@example.test. Please find my account.",
    "observation:2": { id: "older", description: "Large older observation. ".repeat(15_000) },
    "observation:4": { current: true }, _binding_events: [{ seq: 0, kind: "tool_result", result: "Large duplicated history. ".repeat(15_000) }], _signatures: ["lookup:success"] },
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };

test("actor compiler drops complete older protocol batches and retains current evidence and all user requirements", () => {
  const messages: NativeMessage[] = [
    { role: "user", content: "My current requirement" },
    { role: "assistant", tool_calls: [{ id: "old-call", name: "lookup", arguments: {} }], raw_data: { goalspecContinuation: [
      { type: "reasoning", id: "old-reasoning", summary: [] }, { type: "function_call", call_id: "old-call", name: "lookup", arguments: "{}" },
    ] } },
    { role: "tool", id: "old-call", content: "old result ".repeat(4_000) },
    { role: "user", content: "Keep this additional requirement" },
    { role: "assistant", tool_calls: [{ id: "current-call", name: "lookup", arguments: {} }], raw_data: { goalspecContinuation: [
      { type: "reasoning", id: "current-reasoning", summary: [] }, { type: "function_call", call_id: "current-call", name: "lookup", arguments: "{}" },
    ] } },
    { role: "tool", id: "current-call", content: "latest evidence" },
  ];
  const context = "[INFERRED GOALS]\n[]\n\n[VERIFIED PREFETCHED EVIDENCE]\n[]\n\n[HISTORICAL WORKFLOW EXAMPLES]\n" + "optional examples ".repeat(2_000);
  const result = compileActorInput({ messages, policy: "policy", tools: [] }, context, 600);
  assert(result.metadata.omitted.includes("history:1:2"));
  assert(result.metadata.omitted.includes("historical_workflow_examples"));
  assert(result.metadata.tokens <= 600);
  const serialized = JSON.stringify(result.input);
  assert(!serialized.includes("old-call"));
  assert(serialized.includes("current-reasoning"));
  assert(serialized.includes("current-call"));
  assert(serialized.includes("additional requirement"));
  assert.equal(result.instructions, "policy");
  assert(JSON.stringify(result.input.at(-1)).includes("VERIFIED PREFETCHED EVIDENCE"));
  assert.deepEqual(result, compileActorInput({ messages, policy: "policy", tools: [] }, context, 600));
  assert.throws(() => compileActorInput({ messages: [{ role: "user", content: "required ".repeat(10_000) }], policy: "policy", tools: [] }, "", 100), /Mandatory context/);
  assert.throws(() => compileActorInput({ messages: [{ role: "tool", id: "invented", content: "evidence" }], policy: "policy", tools: [] }), /matching/);
  assert.throws(() => nativeInput([{ role: "assistant", tool_calls: [{ id: "pending", name: "lookup", arguments: {} }] }]), /Unresolved/);
});

test("predictors omit entire old sources, preserve current pointer IDs, and restrict goals to relevant sources", async () => {
  const events: Record<string, unknown>[] = [];
  const requests: string[] = [];
  const predictors = new ContractPredictors({ complete: async request => {
    requests.push(JSON.stringify(request.input));
    const goal = request.responseFormat?.name === "requested_goals_v2" || request.instructions.includes("requested-goal");
    return { model: request.model, continuation: [], calls: [], status: "completed", refusals: [], usage: undefined,
      text: JSON.stringify(goal ? { hypotheses: [], unknownWeight: 1 } : { candidates: [] }) };
  } }, async () => [], { lookup: { type: "object", properties: {} } }, "development", 1, event => events.push(event as Record<string, unknown>));
  await predictors.inferGoals(frame, ["requirement:0"]);
  assert(!requests[0].includes("Large older observation"));
  assert(!requests[0].includes("current\\\":true"));
  await predictors.candidates(frame, []);
  assert(!requests[1].includes("Large older observation"));
  assert(!requests[1].includes("Large duplicated history"));
  assert(requests[1].includes("observation:4"));
  const compiled = events.filter(event => Array.isArray(event.selected));
  assert((compiled[1].omitted as string[]).includes("source:observation:2"));
  assert((compiled[1].omitted as string[]).includes("source:_binding_events"));
  assert((compiled[1].selected as string[]).includes("source:observation:4"));
  assert((compiled[1].tokens as number) <= 8192);
  assert.equal((frame.sources._binding_events as unknown[]).length, 1);
  const grouped = { ...frame, sources: { "requirement:0": "keep", "tool:5:0:hash": { a: 1 }, "tool:5:1:hash": { b: 2 } } };
  assert(predictorSourceSections(grouped, "candidate").every(section => section.mandatory));
});

test("literal source extraction binds complete emails and numeric tokens while rejecting fragments and guesses", () => {
  const predictors = new ContractPredictors({ complete: async () => { throw new Error("No model in grounding test"); } }, async () => [],
    { find_user_id_by_email: { type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false } }, "development", 1, () => {});
  const candidate: Candidate = { schemaVersion: 1, id: "c", invocation: { scope: frame.scope, tool: "find_user_id_by_email", arguments: { email: "alice@example.test" } },
    probability: 1, bindings: [{ sourceId: "requirement:0", path: [] }], hop: 1, patternId: null };
  assert(predictors.validateArguments(candidate, frame));
  for (const email of ["bob@example.test", "example.test", "alice@example", "ice@example.test", "Alice@example.test"]) {
    assert(!predictors.validateArguments({ ...candidate, invocation: { ...candidate.invocation, arguments: { email } } }, frame), email);
  }
  assert(exactTextValue("Give me 12 results.", "12"));
  assert(!exactTextValue("Give me 123 results.", "12"));
  assert(!exactTextValue("Give me 12.5 results.", "12"));
  assert(!exactTextValue("a+alice@example.test", "alice@example.test"));
});

test("generic compiler renders selected units in causal order while preferring recent optional evidence", () => {
  const result = compileUnits([
    { id: "old", value: "old".repeat(50), mandatory: false, priority: 0 },
    { id: "user", value: "required", mandatory: true },
    { id: "recent", value: "recent", mandatory: false, priority: 1 },
  ], values => values.join("|"), 20, text => text.length);
  assert.deepEqual(result.selected, ["user", "recent"]);
  assert.deepEqual(result.omitted, ["old"]);
  assert.equal(result.text, "required|recent");
});

test("invalid prediction contracts fail closed while provider budget errors remain fatal", async () => {
  const records: unknown[] = [];
  let response = "broken JSON";
  const predictors = new ContractPredictors({ complete: async request => ({ model: request.model,
    continuation: [], calls: [], status: "completed", refusals: [], usage: undefined, text: response }) },
    async () => [], { lookup: { type: "object", properties: {}, additionalProperties: false } }, "development", 1, event => records.push(event));
  assert.equal((await predictors.inferGoals(frame, ["requirement:0"])).unknown, 1);
  response = '[{"id":"fabricated"}]';
  assert.deepEqual(await predictors.candidates(frame, []), []);
  assert.equal(records.filter(event => (event as { type?: string }).type === "prediction_rejected").length, 2);
  const fatal = new ContractPredictors({ complete: async () => { throw new Error("Budget exhausted"); } },
    async () => [], {}, "development", 1, () => {});
  await assert.rejects(fatal.inferGoals(frame, ["requirement:0"]), /Budget exhausted/);
});
