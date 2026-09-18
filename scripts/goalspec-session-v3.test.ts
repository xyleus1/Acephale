import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { bindCurrentSources, expectedSavingMs } from "../src/lib/goalspec/current-bindings";
import { GoalSpecSession, type Predictors, type SessionPolicy } from "../src/lib/goalspec/session";
import { SpeculationScheduler, SpeculativeCapacity, type ReadExecutor } from "../src/lib/goalspec/scheduler";
import type { Candidate, ExecutionFrame, GoalSet, Invocation } from "../src/lib/goalspec/contracts/generated";

const scope: Invocation["scope"] = { tenantId: "tenant", principalId: "principal", authorizationVersion: "1",
  environmentVersion: "fixture-v3", toolSchemaHash: hash([]) };
const tools = { lookup: { type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"], additionalProperties: false } };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) });
function frame(value = "current-user", boundary = 0): ExecutionFrame {
  return { schemaVersion: 1, runId: "v3-session", boundary, scope: copy(scope), snapshotId: "frozen",
    requestedObjective: `Find user ID ${value}`, policy: "Only authorized reads", goals: emptyGoals(),
    sources: { "requirement:1": `Find user ID ${value}`, _binding_events: [], _signatures: [] } };
}
function candidate(value = "current-user", tool = "lookup"): Candidate {
  return { schemaVersion: 1, id: hash([tool, value]), invocation: { tool, arguments: { user_id: value }, scope: copy(scope) },
    probability: 0.95, bindings: [{ sourceId: "requirement:1", path: [] }], hop: 1, patternId: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
const basePolicy = (): SessionPolicy => ({ version: "v3", exposeEvidence: true, inferGoals: false, predictCandidates: false,
  query: input => input.requestedObjective, eagerWaitMs: 50, maxCandidateCalls: 2,
  estimate: { toolMs: 0, validationMs: 1, schedulingMs: 1, exposedPredictionMs: 0, actorRoundMs: 1000 },
  bindCurrent: input => bindCurrentSources(input, tools) });
function setup(options: { policy?: Partial<SessionPolicy>; predictors?: Partial<Predictors>; executor?: Partial<ReadExecutor> } = {}) {
  const reads: Invocation[] = [], validations: Invocation[] = [], records: unknown[] = [];
  let goalCalls = 0, candidateCalls = 0, embeddingCalls = 0;
  const scheduler = new SpeculationScheduler("v3-session", {
    eligible: invocation => invocation.tool === "lookup",
    read: async invocation => { reads.push(invocation); return { user_id: invocation.arguments.user_id, verified: "database" }; },
    validate: async (invocation, observation) => { validations.push(invocation); return observation; },
    ...options.executor,
  }, event => records.push(event), new SpeculativeCapacity(2), 10000);
  const session = new GoalSpecSession({ retrieve: async () => { throw new Error("V3 must not fetch embeddings to retrieve local patterns"); }, retrieveLocal: () => [] }, {
    inferGoals: async () => { goalCalls++; return emptyGoals(); },
    embed: async () => { embeddingCalls++; throw new Error("Unexpected embedding call"); },
    bindPatterns: () => [], candidates: async () => { candidateCalls++; return []; },
    calibrated: candidates => candidates.some(value => value.probability >= 0.8),
    validateArguments: (proposal, input) => proposal.invocation.arguments.user_id === String(input.sources["requirement:1"]).split(" ").at(-1),
    ...options.predictors,
  }, scheduler, event => records.push(event), { ...basePolicy(), ...options.policy });
  return { session, scheduler, reads, validations, records, counts: () => ({ goalCalls, candidateCalls, embeddingCalls }) };
}

test("current scalar binding preserves exact values and abstains on ambiguity or complex schemas", () => {
  const current = frame(), before = canonical(current);
  assert.deepEqual(bindCurrentSources(current, tools)[0].invocation.arguments, { user_id: "current-user" });
  assert.equal(canonical(current), before);
  current.sources["requirement:2"] = "User ID other-user";
  assert.deepEqual(bindCurrentSources(current, tools), []);
  const nested = { lookup: { type: "object", properties: { user_id: { type: "string" }, action: { type: "string" } }, required: ["user_id", "action"] } };
  assert.deepEqual(bindCurrentSources(frame(), nested), []);
});

test("field labels require a complete word and historical records are not current entity sources", () => {
  const current = frame(); current.sources = { "requirement:1": "Please verify my user identity", _binding_events: [] };
  assert.deepEqual(bindCurrentSources(current, tools), [], "The word identity cannot bind user_id=entity");
  current.sources = { "requirement:1": "Help with my account", "historical:episode": { user_id: "past-user" }, _binding_events: [] };
  assert.deepEqual(bindCurrentSources(current, tools), [], "Historical example fields cannot bind a current argument");
});

test("eager exposure performs and validates a real read before returning compact evidence", async () => {
  const state = setup();
  try {
    const input = frame(), before = canonical(input), result = await state.session.boundary(input, ["requirement:1"]);
    assert.equal(state.reads.length, 1); assert.equal(state.validations.length, 1);
    assert.equal(result.evidence.length, 1); assert.ok(result.actorContext.includes('"verified":"database"'));
    assert.equal(canonical(input), before);
    assert.ok(Object.keys(result.frame.sources).some(key => key.startsWith("prefetch:")));
    await state.session.settlePredictions();
    assert.deepEqual(state.counts(), { goalCalls: 0, candidateCalls: 0, embeddingCalls: 0 });
  } finally { await state.session.close(); }
});

test("real validation failure suppresses evidence even after a completed read", async () => {
  const state = setup({ executor: { validate: async () => { throw new Error("ownership changed"); } } });
  try {
    const result = await state.session.boundary(frame(), ["requirement:1"]);
    assert.equal(state.reads.length, 1); assert.equal(result.evidence.length, 0);
    assert.equal(result.actorContext, "");
  } finally { await state.session.close(); }
});

test("writes from any candidate source are denied before execution", async () => {
  const state = setup({ policy: { bindCurrent: () => [candidate("current-user", "update_user")] } });
  try {
    const result = await state.session.boundary(frame(), ["requirement:1"]);
    await state.session.settlePredictions();
    assert.equal(state.reads.length, 0); assert.equal(result.evidence.length, 0);
  } finally { await state.session.close(); }
});

test("paper-based lossless policies keep actor context empty and exact matching calls promote completed reads", async () => {
  for (const predictCandidates of [false, true]) {
    const state = setup({ policy: { exposeEvidence: false, predictCandidates,
      estimate: { toolMs: 200, validationMs: 1, schedulingMs: 1, exposedPredictionMs: 0, actorRoundMs: 0 } } });
    let fallback = 0;
    try {
      const result = await state.session.boundary(frame(), ["requirement:1"]);
      await state.session.settlePredictions(); await nextTurn();
      assert.equal(result.actorContext, ""); assert.deepEqual(result.evidence, []);
      const observed = await state.scheduler.authoritative(candidate().invocation, async () => { fallback++; return null; });
      assert.deepEqual(observed, { user_id: "current-user", verified: "database" });
      assert.equal(fallback, 0); assert.equal(state.reads.length, 1);
    } finally { await state.session.close(); }
  }
});

test("unprofitable cheap tools abstain from execution and candidate API calls", async () => {
  const state = setup({ policy: { exposeEvidence: false, predictCandidates: true, bindCurrent: () => [],
    estimate: { toolMs: 0, validationMs: 8, schedulingMs: 1, exposedPredictionMs: 0, actorRoundMs: 1000 } } });
  try {
    const result = await state.session.boundary(frame(), ["requirement:1"]);
    await state.session.settlePredictions();
    assert.equal(state.counts().candidateCalls, 0); assert.equal(state.reads.length, 0); assert.equal(result.actorContext, "");
    assert.ok(state.records.some(record => (record as { type: string }).type === "prediction_skipped"));
  } finally { await state.session.close(); }
  assert.ok(expectedSavingMs(0.9, { toolMs: 200, validationMs: 8, schedulingMs: 1, exposedPredictionMs: 2, actorRoundMs: 0 }, false) > 0);
  assert.throws(() => expectedSavingMs(2, basePolicy().estimate, true), /Invalid/);
});

test("new evidence can trigger two bounded dependency hops while exposing at most two observations", async () => {
  const state = setup({ policy: { bindCurrent: input => {
    const prefetched = Object.keys(input.sources).filter(key => key.startsWith("prefetch:")).length;
    return [{ ...candidate(), id: `hop-${prefetched}`, invocation: { ...candidate().invocation, arguments: { user_id: "current-user", level: prefetched } } }];
  } } });
  try {
    const result = await state.session.boundary(frame(), ["requirement:1"]);
    assert.equal(result.evidence.length, 2);
    assert.deepEqual(result.evidence.map(entry => entry.invocation.arguments.level), [0, 1]);
    assert.ok(state.reads.length <= 3, "The background follow-up may start after the two exposed hops");
  } finally { await state.session.close(); }
});

test("already observed exact reads are not repeated", async () => {
  const current = frame(); current.sources._binding_events = [
    { seq: 0, kind: "tool_request", call_id: "existing", tool: "lookup", arguments: { user_id: "current-user" } },
    { seq: 1, kind: "tool_result", call_id: "existing", tool: "lookup", status: "success", result: { user_id: "current-user" } },
  ];
  const state = setup();
  try {
    const result = await state.session.boundary(current, ["requirement:1"]); await state.session.settlePredictions();
    assert.equal(state.reads.length, 0); assert.deepEqual(result.evidence, []);
  } finally { await state.session.close(); }
});

test("a pending model candidate cannot cross a later mutation generation", async () => {
  const pending = deferred<Candidate[]>(), started = deferred<void>();
  const state = setup({ policy: { bindCurrent: () => [], predictCandidates: true }, predictors: {
    calibrated: () => false, candidates: () => { started.resolve(); return pending.promise; },
  } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]); await started.promise;
    await state.scheduler.mutationBatch(async () => undefined);
    pending.resolve([candidate()]); await state.session.settlePredictions();
    assert.equal(state.reads.length, 0);
    assert.ok(state.records.some(record => (record as { type: string }).type === "prediction_discarded"));
  } finally { pending.resolve([]); await state.session.close(); }
});

test("a pending model candidate cannot cross changed source requirements", async () => {
  const pending = deferred<Candidate[]>(); let calls = 0;
  const state = setup({ policy: { bindCurrent: () => [], predictCandidates: true }, predictors: {
    calibrated: () => false, candidates: () => ++calls === 1 ? pending.promise : Promise.resolve([]),
  } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    await state.session.boundary(frame("new-user", 1), ["requirement:1"]);
    pending.resolve([candidate()]); await state.session.settlePredictions();
    assert.equal(state.reads.length, 0);
  } finally { pending.resolve([]); await state.session.close(); }
});

test("eager waits fence a stale read when another boundary supersedes its sources", async () => {
  const read = deferred<null>(), started = deferred<void>();
  const state = setup({ executor: { read: async invocation => {
    if (invocation.arguments.user_id === "current-user") { started.resolve(); return read.promise; }
    return { user_id: "new-user" };
  } } });
  try {
    const first = state.session.boundary(frame(), ["requirement:1"]); await started.promise;
    const second = state.session.boundary(frame("new-user", 1), ["requirement:1"]);
    read.resolve(null);
    const [old, current] = await Promise.all([first, second]);
    assert.deepEqual(old.evidence, []);
    assert.ok(current.evidence.every(entry => entry.invocation.arguments.user_id === "new-user"));
  } finally { read.resolve(null); await state.session.close(); }
});
