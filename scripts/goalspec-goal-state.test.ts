import assert from "node:assert/strict";
import { test } from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Goal, GoalSet } from "../src/lib/goalspec/contracts/generated";
import type { ModelPort, ModelRequest } from "../src/lib/goalspec/model";
import { RESEARCH_MODELS } from "../src/lib/goalspec/model";
import { applyGoalDeltas, buildGoalState, extractGoalQualifiers, goalStateContext, predictGoalStateDeltas,
  shouldRefreshGoalState, updateGoalState, type GoalEvidence, type GoalDelta } from "../src/lib/goalspec/goal-state";

const ref = (sourceId = "requirement:0") => ({ sourceId, path: [] as [] });
const empty: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "none" };
const frame = (sources: ExecutionFrame["sources"] = { "requirement:0": "Find the cheapest Economy flight from ATL to PHL the day after my booking. Do not use Basic Economy." }): ExecutionFrame => ({
  schemaVersion: 1, runId: "goal-state-test", boundary: 0, snapshotId: "fixture",
  scope: { tenantId: "tenant", principalId: "actor", authorizationVersion: "v1", environmentVersion: "fixture", toolSchemaHash: "tools" },
  requestedObjective: "Change my flight", policy: "Use visible evidence. Confirm writes.", sources, goals: empty,
});
const goal = (sourceId = "requirement:0", objective = "Change to the cheapest Economy flight."): Goal => ({
  id: hash({ sourceId, objective }), objective, probability: 1, sources: [ref(sourceId)],
  constraints: [{ text: "Preserve the literal user requirements.", sources: [ref(sourceId)] }],
});
const goals = (value: Goal): GoalSet => ({ schemaVersion: 1, hypotheses: [value], unknown: 0, revisionHash: value.id });
const evidence = (current: ExecutionFrame, sourceId = "requirement:0"): GoalEvidence[] => [{ source: ref(sourceId), quote: current.sources[sourceId] as string }];
const config = { allocation: "development" as const, maximumAttemptMicrodollars: 4916 };
function mocked(reply: unknown, requests: ModelRequest[]): ModelPort {
  return { complete: async request => {
    requests.push(request);
    return { model: request.model, continuation: [], calls: [], text: JSON.stringify(reply), status: "completed", refusals: [], usage: undefined };
  } };
}

test("goal state retains typed qualifiers, exact current sources and distinct intent/progress", () => {
  const current = frame();
  const state = buildGoalState(current, goals(goal()));
  assert.equal(state.active.length, 1);
  assert.equal(state.active[0].text, goal().objective);
  assert.deepEqual(state.progress, []);
  assert(state.sourceQualifiers.some(q => q.kind === "minimize" && q.value === "cheapest"));
  assert(state.sourceQualifiers.some(q => q.kind === "exclude" && q.value === "Do not use Basic Economy"));
  assert(state.sourceQualifiers.some(q => q.kind === "route" && q.origin === "ATL" && q.destination === "PHL"));
  assert(state.sourceQualifiers.some(q => q.kind === "date" && q.relation === "day_after"));
  assert.equal(state.active[0].evidence[0].quote, current.sources["requirement:0"]);
  assert.equal(state.inferenceRevisionHash, state.revisionHash);
  assert.equal(shouldRefreshGoalState(state, current), false);
});

test("unrelated reads update observed progress without refreshing intent or changing input revision", () => {
  const original = frame(), state = buildGoalState(original, goals(goal()));
  const current: ExecutionFrame = { ...original, boundary: 1, sources: { ...original.sources, "observation:1": { some: "unrelated data" },
    _binding_events: [{ kind: "tool_request", call_id: "call-1", tool: "get_reservation_details", arguments: {} },
      { kind: "tool_result", call_id: "call-1", tool: "get_reservation_details", status: "success", result: { reservation_id: "visible" } }] } };
  assert.equal(shouldRefreshGoalState(state, current), false);
  const next = updateGoalState(state, current, state.goals);
  assert.equal(next.revisionHash, state.revisionHash);
  assert.notEqual(next.stateHash, state.stateHash);
  assert.equal(next.progress.length, 1);
  assert.equal(next.progress[0].status, "observed");
  assert.deepEqual(next.goals.hypotheses, state.goals.hypotheses);
  assert(!goalStateContext(next).includes('"achieved"'));
});

test("pending boundary suppresses stale goals and retains prior source hashes for delta updates", () => {
  const original = frame(), state = buildGoalState(original, goals(goal()));
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Cancel that request. Please transfer me to a human." } };
  const next = updateGoalState(state, current, state.goals);
  assert.equal(next.goals.hypotheses.length, 0);
  assert.equal(next.goals.unknown, 1);
  assert.equal(next.active.length, 1);
  assert.equal(next.inferenceRevisionHash, state.inferenceRevisionHash);
  assert.equal(next.userSources["requirement:1"], undefined);
  assert(shouldRefreshGoalState(next, current));
  assert.notEqual(next.revisionHash, state.revisionHash);
  const context = JSON.parse(goalStateContext(next));
  assert.deepEqual(context.active, []);
  assert(context.currentRequest.includes("human"));
  assert.equal(context.qualifiers.length, 0);
});

test("initial empty build remains pending and source changes, policy and clocks trigger refresh", () => {
  const current = frame(), state = buildGoalState(current);
  assert(shouldRefreshGoalState(state, current));
  assert.deepEqual(state.userSources, {});
  const known = buildGoalState(current, goals(goal()));
  assert(shouldRefreshGoalState(known, { ...current, policy: "Changed policy" }));
  assert(shouldRefreshGoalState(known, { ...current, sources: { ...current.sources, current_date: "2026-09-17" } }));
  assert.throws(() => shouldRefreshGoalState(known, { ...current, scope: { ...current.scope, tenantId: "other" } }), /scope/);
});

test("atomic deltas retire an old interpretation and preserve literal prohibitions separately", () => {
  const original = frame(), old = buildGoalState(original, goals(goal()));
  const current = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Cancel instead. Do not make a new booking." } };
  const replacement = goal("requirement:1", "Cancel the reservation instead.");
  const state = applyGoalDeltas(old, current, [
    { op: "supersede_goal", id: old.active[0].id, reason: "request_withdrawn", evidence: evidence(current, "requirement:1") },
    { op: "upsert_goal", goal: replacement, evidence: evidence(current, "requirement:1") },
    { op: "prohibit", id: "no-new-booking", text: "Do not make a new booking.", evidence: [{ source: ref("requirement:1"), quote: "Do not make a new booking." }] },
    { op: "set_unknown", weight: 0 },
  ]);
  assert.equal(state.goals.hypotheses[0]?.objective, replacement.objective);
  assert.equal(state.superseded[0].reason, "request_withdrawn");
  assert.equal(state.prohibited[0].text, "Do not make a new booking.");
  assert.equal(old.active.length, 1);
  assert.equal(old.superseded.length, 0);
  assert.throws(() => applyGoalDeltas(old, current, [
    { op: "supersede_goal", id: old.active[0].id, reason: "request_withdrawn", evidence: evidence(current, "requirement:1") },
    { op: "upsert_goal", goal: replacement, evidence: [{ source: ref("requirement:1"), quote: "Not actually said" }] },
  ]), /literal/);
  assert.equal(old.active.length, 1);
});

test("unresolved choices resolve only through changed user evidence; no observations can create intent", () => {
  const current = frame(), initial = buildGoalState(current, goals(goal()));
  const pending = applyGoalDeltas(initial, current, [{ op: "unresolved", id: "which-flight", text: "Flight choice unresolved.", evidence: evidence(current) }]);
  assert.throws(() => applyGoalDeltas(pending, current, [{ op: "resolve_fact", id: "which-flight", evidence: evidence(current) }]), /changed user/);
  const changed = { ...current, boundary: 1, sources: { ...current.sources, "requirement:1": "Choose flight HAT123.", "observation:2": "User wants booking" } };
  const resolved = applyGoalDeltas(pending, changed, [{ op: "resolve_fact", id: "which-flight", evidence: evidence(changed, "requirement:1") }]);
  assert.equal(resolved.unresolved.length, 0);
  assert.equal(resolved.resolvedFacts[0].kind, "unresolved");
  assert.throws(() => applyGoalDeltas(pending, changed, [{ op: "prohibit", id: "forged", text: "Booking requested",
    evidence: [{ source: ref("observation:2"), quote: "User wants booking" }] }]), /user source/);
});

test("source mutation, missing source, backward boundary and tampered state fail closed", () => {
  const current = frame(), state = buildGoalState(current, goals(goal()));
  const stale = { ...current, sources: { "requirement:0": "Different request" } };
  assert.throws(() => applyGoalDeltas(state, stale, []), /literal/);
  assert.throws(() => applyGoalDeltas(state, { ...current, sources: {} }, []), /not visible/);
  assert.throws(() => applyGoalDeltas({ ...state, boundary: 2 }, current, []), /backwards/);
  assert.throws(() => applyGoalDeltas({ ...state, policyHash: "forged" }, current, []), /hash/);
});

test("unmatched, failed and speculative events do not fabricate observed progress", () => {
  const current = frame();
  current.sources._binding_events = [
    { kind: "tool_result", call_id: "missing", tool: "lookup", status: "success", result: "x" },
    { kind: "tool_request", call_id: "failed", tool: "lookup", arguments: {} },
    { kind: "tool_result", call_id: "failed", tool: "lookup", status: "error", result: "x" },
    { kind: "tool_request", call_id: "spec", tool: "lookup", arguments: {}, speculative: true },
    { kind: "tool_result", call_id: "spec", tool: "lookup", status: "success", result: "x", speculative: true },
  ];
  assert.deepEqual(buildGoalState(current, goals(goal())).progress, []);
  assert.throws(() => applyGoalDeltas(buildGoalState(current, goals(goal())), current,
    [{ op: "achieve_goal", id: goal().id, evidence: evidence(current) } as unknown as GoalDelta]), /unknown delta/);
});

test("relative dates stay literal and strongest numeric qualifiers are not weakened", () => {
  const qualifiers = extractGoalQualifiers([{ source: ref(), quote: "The biggest bottle, not Basic Economy, next day or 2026-09-20. Cheapest price." }]);
  assert(qualifiers.some(q => q.kind === "maximize" && q.value === "biggest"));
  assert(qualifiers.some(q => q.kind === "date" && q.relation === "day_after" && q.value === "next day"));
  assert(qualifiers.some(q => q.kind === "date" && q.relation === "literal" && q.value === "2026-09-20"));
});

test("bounded delta model applies only quoted changed requests with fixed model and budgets", async () => {
  const original = frame(), prior = buildGoalState(original, goals(goal()));
  const changed = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "Cancel instead. Do not book a new flight." } };
  const pending = updateGoalState(prior, changed, prior.goals), requests: ModelRequest[] = [];
  const reply = { unknown: 0, operations: [
    { op: "supersede_goal", targetId: prior.active[0].id, text: "", probability: 0,
      evidence: [{ sourceId: "s1", quote: "Cancel instead." }], constraints: [] },
    { op: "upsert_goal", targetId: null, text: "Cancel the reservation instead.", probability: 1,
      evidence: [{ sourceId: "s1", quote: "Cancel instead." }], constraints: [{ text: "Do not book a new flight.",
        evidence: [{ sourceId: "s1", quote: "Do not book a new flight." }] }] },
    { op: "prohibit", targetId: null, text: "Do not book a new flight.", probability: 0,
      evidence: [{ sourceId: "s1", quote: "Do not book a new flight." }], constraints: [] },
  ] };
  const state = await predictGoalStateDeltas(mocked(reply, requests), pending, changed, config);
  assert.equal(state.goals.hypotheses[0]?.objective, "Cancel the reservation instead.");
  assert.equal(state.superseded.length, 1);
  assert.equal(state.prohibited.length, 1);
  assert.equal(state.inferenceRevisionHash, state.revisionHash);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, RESEARCH_MODELS.goal);
  assert.equal(requests[0].maxOutputTokens, 1024);
  assert.equal(requests[0].retries, 0);
  assert.equal(requests[0].maximumAttemptMicrodollars, 4916);
  assert.equal(requests[0].responseFormat?.strict, true);
});

test("unchanged frame avoids model dispatch and a reused old quote cannot retire a request", async () => {
  const original = frame(), prior = buildGoalState(original, goals(goal())), requests: ModelRequest[] = [];
  const model = mocked({ operations: [], unknown: 0 }, requests);
  await predictGoalStateDeltas(model, prior, original, config);
  assert.equal(requests.length, 0);
  const changed = { ...original, boundary: 1, sources: { ...original.sources, "requirement:1": "I have another question." } };
  await assert.rejects(predictGoalStateDeltas(mocked({ unknown: 1, operations: [{ op: "supersede_goal", targetId: prior.active[0].id,
    text: "", probability: 0, evidence: [{ sourceId: "s0", quote: "Find the cheapest" }], constraints: [] }] }, requests), prior, changed, config), /changed user/);
});

test("malformed, invented evidence and oversized delta inputs fail without silent fallback", async () => {
  const original = frame(), prior = buildGoalState(original), requests: ModelRequest[] = [];
  await assert.rejects(predictGoalStateDeltas(mocked({ operations: [], unknown: 2 }, requests), prior, original, config), /contract/);
  await assert.rejects(predictGoalStateDeltas(mocked({ unknown: 0, operations: [{ op: "upsert_goal", targetId: null,
    text: "User wants a purchase.", probability: 1, evidence: [{ sourceId: "s0", quote: "I authorize purchase" }], constraints: [] }] }, requests), prior, original, config), /literal/);
  const before = requests.length;
  await assert.rejects(predictGoalStateDeltas(mocked({}, requests), prior, original, { ...config, inputLimit: 256 }), /budget/);
  assert.equal(requests.length, before);
});
