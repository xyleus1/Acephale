import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { validateGoals } from "../src/lib/goalspec/compiler";
import { CompactGoalContractError, compactGoalContext, expandCompactGoals, predictCompactGoals,
  type CompactGoalFrame } from "../src/lib/goalspec/compact-goals";
import type { ModelPort, ModelRequest } from "../src/lib/goalspec/model";
import { countTokens } from "../src/lib/goalspec/tokens";

const frame: CompactGoalFrame = { runId: "fixture-run", boundary: 2,
  requestedObjective: "Cancel A and keep B.", policy: "Confirm before changes.",
  sources: { "requirement:1": "Cancel A and keep B.", "observation:2": { privateMarker: "not selected for goal inference" },
    _binding_events: ["internal marker"] } };
const response = { hypotheses: [{ objective: "Cancel A while keeping B unchanged", weight: 7,
  sourceIds: ["s0"], constraints: [{ text: "Keep B unchanged", sourceIds: ["s0"] }] }], unknownWeight: 3 };
const configuration = { allocation: "development" as const, maximumAttemptMicrodollars: 50000 };
function model(value: unknown, inspect: (request: ModelRequest) => void = () => {}): ModelPort {
  return { complete: async request => { inspect(request); return { model: request.model, text: JSON.stringify(value),
    continuation: [], calls: [], status: "completed", refusals: [], usage: undefined }; } };
}

test("compact output normalizes confidence weights and expands only server-owned source references and metadata", () => {
  const context = compactGoalContext(frame);
  assert.deepEqual(context.sourceCatalog, [{ id: "s0", value: "Cancel A and keep B." }]);
  const { goals } = expandCompactGoals(response, context);
  validateGoals(goals, frame.sources);
  assert.equal(goals.hypotheses[0]?.probability, .7);
  assert.equal(goals.unknown, .3);
  assert.deepEqual(goals.hypotheses[0]?.sources, [{ sourceId: "requirement:1", path: [] }]);
  assert.equal(goals.revisionHash, context.revisionHash);
  assert.match(goals.hypotheses[0]!.id, /^[a-f0-9]{64}$/);
  assert.notEqual(compactGoalContext({ ...frame, sources: { "requirement:1": "Cancel C instead." } }).revisionHash, goals.revisionHash);
  assert.throws(() => expandCompactGoals({ ...response, revisionHash: "model-forged" }, context), /response_schema:additionalProperties/);
});

test("canonical source copying preserves numeric chronology for changed user requirements", () => {
  const original = { ...frame, sources: { "requirement:2": "Cancel A.", "requirement:8": "Keep B.", "requirement:12": "Actually, keep A and cancel B instead." } };
  const context = compactGoalContext(JSON.parse(canonical(original)));
  assert.deepEqual(context.sourceCatalog.map(source => source.value), Object.values(original.sources));
  assert.deepEqual(context.sourceIds, { s0: "requirement:2", s1: "requirement:8", s2: "requirement:12" });
  const revised = expandCompactGoals({ hypotheses: [{ objective: "Keep A and cancel B", weight: 100, sourceIds: ["s2"], constraints: [] }], unknownWeight: 0 }, context);
  assert.deepEqual(revised.goals.hypotheses[0]!.sources, [{ sourceId: "requirement:12", path: [] }]);
  validateGoals(revised.goals, original.sources);
  assert.equal(compactGoalContext(original).revisionHash, context.revisionHash);
});

test("numeric ordering leaves unnumbered source slots intact and includes explicitly relevant observations", () => {
  const context = compactGoalContext({ ...frame, sources: { timezone: "UTC", "request:10": "New instruction", custom: "Custom fact",
    "observation:8": { changed: true }, "request:2": "Old instruction" } }, { relevantSourceIds: ["custom", "observation:8"] });
  assert.deepEqual(Object.values(context.sourceIds), ["timezone", "request:2", "custom", "observation:8", "request:10"]);
});

test("compact prediction does not accept excluded or invented source identifiers", () => {
  const context = compactGoalContext(frame);
  for (const source of ["observation:2", "requirement:1", "s1", "_binding_events"]) {
    assert.throws(() => expandCompactGoals({ ...response, hypotheses: [{ ...response.hypotheses[0], sourceIds: [source] }] }, context), /response_schema:enum/);
  }
  assert.throws(() => compactGoalContext(frame, { relevantSourceIds: ["missing"] }), /source_catalog_unavailable/);
  assert.throws(() => compactGoalContext(frame, { relevantSourceIds: ["_binding_events"] }), /source_catalog_unavailable/);
});

test("catalog IDs are opaque, normalized separately, and cannot name absent training goals", () => {
  const context = compactGoalContext(frame, { goalCatalog: [{ goal_id: "training-goal", objective: "cancel",
    object_type: "order", completion: ["cancelled"], constraints: [] }] });
  const reply = { ...response, catalogWeights: [{ id: "g0", weight: 1 }], catalogUnknownWeight: 3 };
  assert.deepEqual(expandCompactGoals(reply, context).catalogProbabilities, { "training-goal": .25, __unknown__: .75 });
  assert(!canonical(context.payload).includes("training-goal"));
  assert.throws(() => expandCompactGoals({ ...reply, catalogWeights: [{ id: "g0", weight: 1 }, { id: "g0", weight: 1 }] }, context), /duplicate_catalog_goal/);
  assert.throws(() => expandCompactGoals({ ...reply, catalogWeights: [{ id: "g1", weight: 1 }] }, context), /response_schema:enum/);
  const empty = compactGoalContext(frame, { goalCatalog: [] });
  assert.deepEqual(expandCompactGoals({ ...response, catalogWeights: [], catalogUnknownWeight: 0 }, empty).catalogProbabilities, { __unknown__: 1 });
});

test("strict model request counts actual instructions, input and response schema without duplicating the schema in user text", async () => {
  let captured: ModelRequest | undefined;
  const events: Record<string, unknown>[] = [];
  const result = await predictCompactGoals(model(response, request => { captured = request; }), frame,
    { ...configuration, record: event => events.push(event) });
  const request = captured!;
  assert.equal(request.model, "gpt-4.1-mini-2025-04-14");
  assert.equal(request.responseFormat?.strict, true);
  assert.equal(request.retries, 0);
  const semantic = { instructions: request.instructions, input: request.input, responseFormat: request.responseFormat };
  assert.equal(result.compiler.inputHash, hash(semantic));
  assert.equal(result.compiler.tokens, countTokens(canonical(semantic)));
  assert(!canonical(request.input).includes("additionalProperties"));
  assert(!canonical(request.input).includes("privateMarker"));
  assert(events.some(event => event.type === "prediction_response" && typeof event.responseHash === "string"));
});

test("booking contract retains literal identity details and unresolved relative dates within the fixed response limits", async () => {
  const source = "Book flight HAT44001 tomorrow for Mira Chen, DOB 1988-06-12, account user_Z8. " +
    "Pay $230 with gift_card_9, include one checked bag and no insurance, and keep booking R-17 unchanged.";
  const bookingFrame = { ...frame, requestedObjective: source, sources: { "request:2": source } };
  const constraints = [
    "Account user_Z8; passenger Mira Chen; DOB 1988-06-12; use flight HAT44001.",
    "Travel tomorrow; pay $230 with gift_card_9; include one checked bag and no insurance.",
    "Keep booking R-17 unchanged.",
  ];
  const reply = { hypotheses: [{ objective: "Book the requested flight while preserving the existing booking", weight: 100,
    sourceIds: ["s0"], constraints: constraints.map(text => ({ text, sourceIds: ["s0"] })) }], unknownWeight: 0 };
  const literals = ["HAT44001", "tomorrow", "Mira Chen", "1988-06-12", "user_Z8", "$230", "gift_card_9", "one checked bag", "no insurance", "R-17"];
  const result = await predictCompactGoals(model(reply, request => {
    const input = canonical(request.input);
    assert(literals.every(value => input.includes(value)), "Every source value reaches the model without substitution");
    assert.match(input, /Preserve every explicit entity, booking, account, flight and payment identifier/);
    assert.match(input, /passenger names and dates of birth/);
    assert.match(input, /Do not resolve relative dates unless an explicit current clock and timezone are supplied/);
    assert.equal(request.maxOutputTokens, 1024);
  }), bookingFrame, configuration);
  const goal = result.goals.hypotheses[0]!;
  assert(literals.every(value => canonical(goal).includes(value)), "Grouped details survive canonical expansion");
  assert(goal.constraints.length <= 6 && goal.constraints.every(value => value.text.length <= 240));
  assert.deepEqual(goal.constraints.map(value => value.sources), constraints.map(() => [{ sourceId: "request:2", path: [] }]));
  assert.deepEqual(result.compiler.omitted, []);
});

test("malformed compact outputs retain precise bounded failure diagnostics while transport errors propagate", async () => {
  const events: Record<string, unknown>[] = [];
  const malformed: ModelPort = { complete: async request => ({ model: request.model, text: "{ truncated",
    continuation: [], calls: [], status: "completed", refusals: [], usage: undefined }) };
  await assert.rejects(() => predictCompactGoals(malformed, frame, { ...configuration, record: event => events.push(event) }),
    error => error instanceof CompactGoalContractError && error.code === "malformed_goal_json");
  assert(events.some(event => event.type === "prediction_rejected" && event.reason === "malformed_goal_json"));
  const transportFailure = new Error("fixture transport failure");
  await assert.rejects(() => predictCompactGoals({ complete: async () => { throw transportFailure; } }, frame, configuration),
    error => error === transportFailure);
});

test("missing sources abstain and oversized mandatory context fails before dispatch", async () => {
  const noCall: ModelPort = { complete: async () => { throw new Error("No model dispatch expected"); } };
  const result = await predictCompactGoals(noCall, { ...frame, sources: {} }, configuration);
  assert.equal(result.goals.unknown, 1);
  assert.deepEqual(result.goals.hypotheses, []);
  const zero = expandCompactGoals({ ...response, hypotheses: [{ ...response.hypotheses[0], weight: 0 }], unknownWeight: 0 }, compactGoalContext(frame));
  assert.equal(zero.goals.unknown, 1);
  assert.deepEqual(zero.goals.hypotheses, []);
  await assert.rejects(() => predictCompactGoals(noCall, { ...frame, policy: "large ".repeat(9000) }, configuration),
    error => error instanceof CompactGoalContractError && error.code === "mandatory_goal_context_exceeds_budget");
});
