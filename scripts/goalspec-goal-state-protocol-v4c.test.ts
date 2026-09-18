import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { buildGoalState, goalStateContext, updateGoalState } from "../src/lib/goalspec/goal-state";
import { expandGoalSpanSnapshot, goalSpanContext, goalSpanSchema, literalSourceSpans, predictGoalStateDeltas } from "../src/lib/goalspec/goal-state-protocol-v4c";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest } from "../src/lib/goalspec/model";

const empty: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "empty" };
const frame = (text = "Find the cheapest flight from ATL to PHL. Do not use Basic Economy."): ExecutionFrame => ({
  schemaVersion: 1, runId: "span-protocol-test", boundary: 0, snapshotId: "fixture", requestedObjective: text,
  scope: { tenantId: "tenant", principalId: "actor", authorizationVersion: "a1", environmentVersion: "e1", toolSchemaHash: "tools" },
  sources: { "requirement:0": text }, policy: "Confirm writes; authorization is server-owned.", goals: empty,
});
const reply = (objective: string, spanIds = ["s0p0"]) => ({ set_active_goals: [{ objective, weight: 100, spanIds,
  constraints: [] as { text: string; spanIds: string[] }[] }], unknownWeight: 0, factDeltas: [] as any[] });
const initial = (current: ExecutionFrame, value = reply("Find the cheapest Economy flight.", ["s0p0", "s0p1"])) =>
  expandGoalSpanSnapshot(value, buildGoalState(current), current);
const config = { allocation: "development" as const, maximumAttemptMicrodollars: 4916 };
function mock(value: unknown, calls: ModelRequest[]): ModelPort {
  return { complete: async request => { calls.push(request); return { model: request.model, status: "completed", calls: [],
    text: JSON.stringify(value), refusals: [], continuation: [], usage: undefined }; } };
}

test("server spans preserve exact Unicode, decimal, date and identifier literals", () => {
  const text = "Name O’Connor, fare $1,000.25. Leave 2026-09-21;\nUse card_7252880.";
  const spans = literalSourceSpans("requirement:0", text, "s0", true);
  assert(spans.length >= 4);
  assert(spans.every(span => span.quote === text.slice(span.start, span.end)));
  assert(spans.some(span => span.quote.includes("$1,000.25")));
  assert(spans.some(span => span.quote.includes("2026-09-21")));
  assert(spans.some(span => span.quote.includes("O’Connor")));
});

test("source omission is recorded rather than confused with semantic requirement loss", () => {
  const original = frame(), previous = initial(original);
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Cancel instead." } };
  const events: Record<string, unknown>[] = [];
  const next = expandGoalSpanSnapshot(reply("Cancel the reservation instead.", ["s1p0"]), previous, current, event => events.push(event));
  assert.equal(next.active.length, 1);
  assert.equal(next.superseded.length, 1);
  assert.equal(next.superseded[0].reason, "interpretation_replaced");
  assert.deepEqual(events[0].omittedPriorSourceIds, ["requirement:0"]);
  assert.deepEqual(next.active[0].evidence.map(item => item.quote), ["Cancel instead."]);
});

test("all visible user history remains available and inferred goal prose is excluded", () => {
  const original = frame(), previous = initial(original, reply("INFERRED_ONLY_MARKER", ["s0p0"]));
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "My name is Nora.",
    "requirement:2": "The ZIP code is 97205.", "observation:3": "HIDDEN_TOOL_DATA" } };
  const context = goalSpanContext(previous, current), payload = JSON.stringify(context.payload);
  assert.deepEqual(context.sources.map(source => source.sourceId), ["requirement:0", "requirement:1", "requirement:2"]);
  assert(!payload.includes("INFERRED_ONLY_MARKER"));
  assert(!payload.includes("HIDDEN_TOOL_DATA"));
  assert(payload.includes("cheapest"));
  assert(payload.includes("97205"));
});

test("invalid aliases, model-written quotes and goal bookkeeping are rejected atomically", () => {
  const current = frame(), previous = buildGoalState(current);
  assert.throws(() => expandGoalSpanSnapshot(reply("Buy", ["s999p0"]), previous, current), /contract/);
  assert.throws(() => expandGoalSpanSnapshot({ ...reply("Buy"), retiredSources: [] }, previous, current), /contract/);
  const value = reply("Buy");
  Object.assign(value.set_active_goals[0], { quote: "I authorize a purchase" });
  assert.throws(() => expandGoalSpanSnapshot(value, previous, current), /contract/);
  assert.equal(previous.active.length, 0);
});

test("omitted facts persist and only explicit changed user evidence resolves them", () => {
  const original = frame("Do not buy insurance. I have not chosen a flight."), value = reply("Find a flight without insurance.");
  const noFactsSchema = goalSpanSchema(goalSpanContext(buildGoalState(original), original)) as any;
  assert.equal(noFactsSchema.properties.factDeltas.items.anyOf, undefined);
  value.factDeltas = [{ op: "prohibit", text: "Do not buy insurance.", spanIds: ["s0p0"] },
    { op: "unresolved", text: "Flight choice unresolved.", spanIds: ["s0p1"] }];
  const previous = initial(original, value);
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Choose HAT123." } };
  const nextValue = reply("Choose HAT123 without insurance.", ["s0p0", "s1p0"]);
  const omitted = expandGoalSpanSnapshot(nextValue, previous, current);
  assert.equal(omitted.prohibited.length, 1);
  assert.equal(omitted.unresolved.length, 1);
  assert.equal(omitted.resolvedFacts.length, 0);
  const alias = goalSpanContext(previous, current).facts.find(fact => fact.kind === "unresolved")!.alias;
  const currentSchema = goalSpanSchema(goalSpanContext(previous, current)) as any;
  const resolution = currentSchema.properties.factDeltas.items.anyOf[1];
  assert(resolution.properties.factId.enum.includes(alias));
  assert.deepEqual(resolution.properties.spanIds.items.enum, ["s1p0"]);
  const unchangedSchema = goalSpanSchema(goalSpanContext(previous, original)) as any;
  assert.equal(unchangedSchema.properties.factDeltas.items.anyOf, undefined);
  nextValue.factDeltas = [{ op: "resolve_fact", factId: alias, spanIds: ["s0p1"] }];
  assert.throws(() => expandGoalSpanSnapshot(nextValue, previous, current), /contract/);
  nextValue.factDeltas[0].spanIds = ["s1p0"];
  const resolved = expandGoalSpanSnapshot(nextValue, previous, current);
  assert.equal(resolved.unresolved.length, 0);
  assert.equal(resolved.prohibited.length, 1);
  assert.equal(resolved.resolvedFacts.length, 1);
});

test("selecting an identity clause does not expose obsolete route or negation qualifiers", () => {
  const original = frame("My name is Nora. Do not exchange. Travel ATL to PHL.");
  const previous = initial(original, reply("Preserve the booking.", ["s0p0", "s0p1", "s0p2"]));
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Exchange instead. Travel PHL to ATL next day." } };
  const value = reply("Exchange Nora's booking to travel PHL to ATL next day.", ["s0p0", "s1p0", "s1p1"]);
  let next = expandGoalSpanSnapshot(value, previous, current);
  next = updateGoalState(next, { ...current, boundary: 2, sources: { ...current.sources, "observation:2": "unrelated" } }, next.goals);
  const context = JSON.parse(goalStateContext(next));
  assert(!context.qualifiers.some((item: any) => item.kind === "exclude" && item.value.includes("exchange")));
  assert(!context.qualifiers.some((item: any) => item.kind === "route" && item.origin === "ATL"));
  assert(context.qualifiers.some((item: any) => item.kind === "route" && item.origin === "PHL"));
});

test("literal acknowledgment retains probability and does not call the model", async () => {
  const original = frame(), value = reply("Find the cheapest Economy flight.", ["s0p0", "s0p1"]);
  value.set_active_goals[0].weight = 90; value.unknownWeight = 10;
  const previous = initial(original, value), calls: ModelRequest[] = [];
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Yes, please." } };
  const next = await predictGoalStateDeltas(mock({}, calls), updateGoalState(previous, current, previous.goals), current, config);
  assert.equal(calls.length, 0);
  assert.equal(next.goals.hypotheses[0]?.probability, 0.9);
  assert(Math.abs(next.goals.unknown - 0.1) < 1e-12);
});

test("bounded snapshot dispatch records all selected sources and response hashes with no retries", async () => {
  const current = frame(), previous = buildGoalState(current), calls: ModelRequest[] = [], events: Record<string, unknown>[] = [];
  const value = reply("Find the cheapest Economy flight.", ["s0p0", "s0p1"]);
  const next = await predictGoalStateDeltas(mock(value, calls), previous, current, { ...config, record: event => events.push(event) });
  assert.equal(next.active.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, RESEARCH_MODELS.goal);
  assert.equal(calls[0].maxOutputTokens, 1024);
  assert.equal(calls[0].retries, 0);
  assert.deepEqual(events.find(event => event.type === "goal_delta_request")?.selectedSources, ["requirement:0"]);
  assert.deepEqual(events.find(event => event.type === "goal_delta_request")?.omittedSources, []);
  assert(events.some(event => event.type === "goal_delta_response" && typeof event.responseHash === "string"));
  await assert.rejects(predictGoalStateDeltas(mock(value, calls), previous, current, { ...config, inputLimit: 256 }), /budget/);
  assert.equal(calls.length, 1);
});
