import assert from "node:assert/strict";
import { test } from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { buildGoalState, goalStateContext, updateGoalState } from "../src/lib/goalspec/goal-state";
import { expandGoalStateProtocol, goalStateProtocolContext, predictGoalStateDeltas } from "../src/lib/goalspec/goal-state-protocol-v4";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest } from "../src/lib/goalspec/model";

const empty: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "empty" };
const frame = (text = "Find the cheapest Economy flight from ATL to PHL the day after my booking."): ExecutionFrame => ({
  schemaVersion: 1, runId: "protocol-test", boundary: 0, snapshotId: "fixture", requestedObjective: text,
  scope: { tenantId: "tenant", principalId: "actor", authorizationVersion: "a1", environmentVersion: "e1", toolSchemaHash: "tools" },
  sources: { "requirement:0": text }, policy: "Confirm writes; do not infer authorization.", goals: empty,
});
const cite = (sourceId: string, quote: string) => ({ sourceId, quote });
const objective = (text: string, sourceId = "s0", quote = text, weight = 100) => ({ objective: text, weight,
  evidence: [cite(sourceId, quote)], constraints: [] as { text: string; evidence: ReturnType<typeof cite>[] }[] });
const reply = (goals: ReturnType<typeof objective>[]) => ({ set_active_goals: goals, unknownWeight: 0,
  retiredSources: [] as { sourceId: string; evidence: ReturnType<typeof cite>[] }[], factDeltas: [] as any[] });
const config = { allocation: "development" as const, maximumAttemptMicrodollars: 4916 };
const initial = (current: ExecutionFrame) => expandGoalStateProtocol(reply([objective(current.sources["requirement:0"] as string)]), buildGoalState(current), current);
function mocked(value: unknown, requests: ModelRequest[]): ModelPort {
  return { complete: async request => {
    requests.push(request);
    return { model: request.model, status: "completed", text: JSON.stringify(value), calls: [], continuation: [], refusals: [], usage: undefined };
  } };
}

test("six successive complete replacements never accumulate competing goals", () => {
  let current = frame("Please cancel booking A."), state = initial(current);
  for (let index = 1; index <= 6; index++) {
    const text = `Replace my previous request: find flight option ${index}.`;
    current = { ...current, boundary: index, sources: { ...current.sources, [`requirement:${index}`]: text } };
    const pending = updateGoalState(state, current, state.goals), nextReply = reply([objective(text, `s${index}`)]);
    nextReply.retiredSources.push({ sourceId: `s${index - 1}`, evidence: [cite(`s${index}`, text)] });
    state = expandGoalStateProtocol(nextReply, pending, current);
    assert.equal(state.active.length, 1);
    assert.equal(state.goals.hypotheses.length, 1);
    assert.equal(state.superseded.length, index);
    assert.equal(state.goals.hypotheses[0]?.probability, 1);
    assert.equal(state.goals.unknown, 0);
  }
});

test("a replacement cannot silently drop an earlier requested source", () => {
  const original = frame("Keep the passenger name Nora unchanged."), state = initial(original);
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Move the flight to the next day." } };
  const value = reply([objective("Move the flight to the next day.", "s1")]);
  const before = hash(state);
  assert.throws(() => expandGoalStateProtocol(value, state, current), /omitted without retirement/);
  assert.equal(hash(state), before);
  value.set_active_goals[0].constraints.push({ text: "Keep passenger Nora unchanged.", evidence: [cite("s0", "passenger name Nora unchanged")] });
  const next = expandGoalStateProtocol(value, state, current);
  assert.equal(next.active.length, 1);
  assert.equal(next.goals.hypotheses[0]?.constraints[0].text, "Keep passenger Nora unchanged.");
});

test("retirement needs changed user evidence; invented quotes and historical tool evidence are rejected", () => {
  const original = frame("Cancel booking A."), state = initial(original);
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Exchange instead.",
    "observation:1": "Cancel booking A." } };
  const value = reply([objective("Exchange instead.", "s1")]);
  value.retiredSources.push({ sourceId: "s0", evidence: [cite("s0", "Cancel booking A.")] });
  assert.throws(() => expandGoalStateProtocol(value, state, current), /changed user evidence/);
  value.retiredSources[0].evidence = [cite("s1", "I confirmed the exchange")];
  assert.throws(() => expandGoalStateProtocol(value, state, current), /literal user span/);
  value.retiredSources[0].evidence = [cite("s1", "Exchange instead.")];
  value.set_active_goals[0].evidence = [cite("observation:1", "Cancel booking A.")];
  assert.throws(() => expandGoalStateProtocol(value, state, current), /contract/);
});

test("facts have distinct schemas and stable short aliases; resolution is source grounded", () => {
  const original = frame("Do not buy insurance. I have not chosen a flight."), pending = buildGoalState(original);
  const value = reply([objective(original.sources["requirement:0"] as string)]);
  value.factDeltas = [
    { op: "prohibit", text: "Do not buy insurance.", evidence: [cite("s0", "Do not buy insurance.")] },
    { op: "unresolved", text: "Flight choice unresolved.", evidence: [cite("s0", "I have not chosen a flight.")] },
  ];
  const state = expandGoalStateProtocol(value, pending, original);
  const context = goalStateProtocolContext(state, original), alias = context.facts.find(item => item.kind === "unresolved")!.alias;
  assert(alias.length < 16);
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Choose HAT123. Still no insurance." } };
  assert.equal(goalStateProtocolContext(state, current).facts.find(item => item.kind === "unresolved")?.alias, alias);
  const nextValue = reply([objective("Choose HAT123 without insurance.", "s1", "Choose HAT123.")]);
  nextValue.set_active_goals[0].constraints = [{ text: "Do not buy insurance.", evidence: [cite("s0", "Do not buy insurance.")] }];
  nextValue.factDeltas = [{ op: "resolve_fact", factId: alias, evidence: [cite("s1", "Choose HAT123.")] }];
  const next = expandGoalStateProtocol(nextValue, state, current);
  assert.equal(next.unresolved.length, 0);
  assert.equal(next.prohibited.length, 1);
  assert.equal(next.resolvedFacts.length, 1);
  value.factDeltas[0].constraints = [];
  assert.throws(() => expandGoalStateProtocol(value, pending, original), /contract/);
});

test("current qualifiers come from active quoted evidence while pending qualifiers use latest request", () => {
  const original = frame("My name is Nora. Do not exchange. Travel ATL to PHL."), state = initial(original);
  const current = { ...original, boundary: 1, sources: { ...original.sources,
    "requirement:1": "Exchange it instead. Travel PHL to ATL on the next day." } };
  const value = reply([objective("Exchange and travel PHL to ATL on the next day.", "s1", "Travel PHL to ATL on the next day.")]);
  value.set_active_goals[0].constraints = [{ text: "Passenger Nora.", evidence: [cite("s0", "My name is Nora.")] }];
  const pending = updateGoalState(state, current, state.goals), next = expandGoalStateProtocol(value, pending, current);
  const readBoundary = { ...current, boundary: 2, sources: { ...current.sources, "observation:2": { result: "unrelated" } } };
  const afterRead = updateGoalState(next, readBoundary, next.goals);
  assert.deepEqual(afterRead.active[0].evidence, next.active[0].evidence);
  for (const candidate of [pending, next, afterRead]) {
    const context = JSON.parse(goalStateContext(candidate));
    assert(!context.qualifiers.some((item: any) => item.kind === "exclude" && item.value.includes("not exchange")));
    assert(!context.qualifiers.some((item: any) => item.kind === "route" && item.origin === "ATL"));
    assert(context.qualifiers.some((item: any) => item.kind === "route" && item.origin === "PHL" && item.destination === "ATL"));
  }
});

test("literal acknowledgments skip inference and preserve probability after a pending boundary", async () => {
  const original = frame(), state = initial(original), requests: ModelRequest[] = [];
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Yes, please." } };
  const pending = updateGoalState(state, current, state.goals);
  assert.equal(pending.goals.unknown, 1);
  const next = await predictGoalStateDeltas(mocked({}, requests), pending, current, config);
  assert.equal(requests.length, 0);
  assert.deepEqual(next.goals.hypotheses, state.goals.hypotheses);
  assert.equal(next.goals.unknown, 0);
  assert.equal(next.inferenceRevisionHash, next.revisionHash);
  assert.equal(next.userSources["requirement:1"], hash("Yes, please."));
});

test("policy-only changes preserve requested intent without dispatch", async () => {
  const original = frame(), state = initial(original), requests: ModelRequest[] = [];
  const current = { ...original, boundary: 1, policy: "Updated server policy, human approval required." };
  const pending = updateGoalState(state, current, state.goals);
  const next = await predictGoalStateDeltas(mocked({}, requests), pending, current, config);
  assert.equal(requests.length, 0);
  assert.deepEqual(next.goals.hypotheses, state.goals.hypotheses);
  assert.equal(next.goals.unknown, 0);
});

test("material qualifier changes call the fixed bounded model and normalize confidence", async () => {
  const original = frame("Find an Economy flight."), state = initial(original), requests: ModelRequest[] = [];
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Yes, the cheapest one." } };
  const value = reply([objective("Find the cheapest Economy flight.", "s0", "Economy flight", 75)]);
  value.set_active_goals[0].constraints.push({ text: "Choose the cheapest.", evidence: [cite("s1", "the cheapest one")] });
  value.unknownWeight = 25;
  const next = await predictGoalStateDeltas(mocked(value, requests), updateGoalState(state, current, state.goals), current, config);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, RESEARCH_MODELS.goal);
  assert.equal(requests[0].maxOutputTokens, 1024);
  assert.equal(requests[0].retries, 0);
  assert.equal(requests[0].responseFormat?.strict, true);
  assert.equal(next.goals.hypotheses[0]?.probability, 0.75);
  assert.equal(next.goals.unknown, 0.25);
});

test("invalid contracts and oversized mandatory context fail before changing state", async () => {
  const current = frame(), state = buildGoalState(current), requests: ModelRequest[] = [];
  const value = reply([objective(current.sources["requirement:0"] as string)]);
  value.set_active_goals = Array(4).fill(value.set_active_goals[0]);
  assert.throws(() => expandGoalStateProtocol(value, state, current), /contract/);
  await assert.rejects(predictGoalStateDeltas(mocked({}, requests), state, current, { ...config, inputLimit: 256 }), /budget/);
  assert.equal(requests.length, 0);
  await assert.rejects(predictGoalStateDeltas(mocked({ operations: [] }, requests), state, current, config), /contract/);
});
