import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import type { LocalControllerV5 } from "../src/lib/goalspec/controller-v5";
import { GoalSpecSessionV5, type V5SessionPolicy } from "../src/lib/goalspec/session-v5";
import { SpeculationScheduler, SpeculativeCapacity, type ReadExecutor } from "../src/lib/goalspec/scheduler";
const scope = { tenantId: "a", principalId: "u", authorizationVersion: "1", environmentVersion: "v5", toolSchemaHash: hash([]) };
function frame(boundary = 0): ExecutionFrame { return { schemaVersion: 1, runId: "v5", boundary, scope, snapshotId: "frozen", policy: "Read only",
  requestedObjective: "Read order A", sources: { "requirement:0": "Read order A", "observation:1": { id: "A" }, _binding_events: [] },
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } }; }
function candidate(f = frame()): Candidate { return { schemaVersion: 1, id: "A", invocation: { tool: "lookup", arguments: { id: (f.sources["observation:1"] as { id: string }).id }, scope },
  probability: .86, hop: 1, patternId: null, bindings: [{ sourceId: "observation:1", path: ["id"] }] }; }
const controller = { decide(_context: unknown, candidates: Candidate[]) { return {
  action: candidates.length ? "READ" : "READ_UNCOVERED", noReadProbability: 0, uncoveredProbability: Number(!candidates.length),
  goalReliability: 0, goalCorrectionStatus: "reliability_unavailable", elapsedMs: 0,
  rankedCandidateIds: candidates.slice(0, 3).map(item => item.id),
  candidates: candidates.map(item => ({ candidateId: item.id, probability: 1, neutralLogit: 1, goalCorrection: 0 })) }; } } as unknown as LocalControllerV5;
function setup(overrides: Partial<V5SessionPolicy> = {}, executor: Partial<ReadExecutor> = {}) {
  let reads = 0, validations = 0, retrievals = 0;
  const events: any[] = [], record = (event: unknown) => events.push(event);
  const scheduler = new SpeculationScheduler("v5", { eligible: invocation => invocation.tool === "lookup",
    read: async () => { reads++; return { value: "A" }; }, validate: async (_invocation, value) => { validations++; return value; }, ...executor }, record, new SpeculativeCapacity(4));
  const session = new GoalSpecSessionV5({ retrieve: async () => [], retrieveLocal: () => { retrievals++; return []; } }, {
    inferGoals: async input => input.goals, embed: async () => { throw new Error("No embedding call"); },
    candidates: async () => { throw new Error("No unconditional remote prediction"); }, calibrated: () => false,
    bindPatterns: () => [], validateArguments: (item, input) => item.invocation.arguments.id === (input.sources["observation:1"] as { id: string }).id,
  }, scheduler, record, { controller, actorContext: "literal", goalConditioning: false, inferGoals: false, exposeEvidence: true,
    query: input => input.requestedObjective, bindCurrent: input => [candidate(input)], nonMutating: invocation => invocation.tool === "lookup",
    countTokens: text => Math.ceil(text.length / 4), estimate: { toolMs: 100, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 }, ...overrides });
  return { session, scheduler, events, counts: () => ({ reads, validations, retrievals }) };
}
test("v5 retrieves locally and uses current literal actor context without a remote candidate model", async () => {
  const s = setup();
  try {
    const result = await s.session.boundary(frame(), ["requirement:0"]);
    assert.equal(s.session.actorContextMode, "current-only");
    assert.ok(result.actorContext.includes("Read order A")); assert.ok(!result.actorContext.includes("INFERRED GOALS"));
    assert.equal(s.counts().retrievals, 1); assert.equal(s.counts().reads, 1);
    assert.equal(s.events.find(event => event.type === "candidate_prediction").reason, "positive_expected_reuse_utility");
  } finally { await s.session.close(); }
});
test("v5 policy rejection cannot be overruled by a learned score or fallback validator", async () => {
  const s = setup({ validateCurrent: () => false });
  try { await s.session.boundary(frame(), []); assert.equal(s.counts().reads, 0); }
  finally { await s.session.close(); }
  const denied = setup({ bindCurrent: f => [{ ...candidate(f), invocation: { ...candidate(f).invocation, tool: "write" } }] });
  try { await denied.session.boundary(frame(), []); assert.equal(denied.counts().reads, 0); }
  finally { await denied.session.close(); }
});
test("v5 cheap native tools suppress speculation and expensive fallback", async () => {
  let fallbackCalls = 0;
  const s = setup({ bindCurrent: () => [], uncoveredFallback: { maximumCalls: 2, predictorOverheadMs: 100, opportunityMs: .1,
    predict: async () => { fallbackCalls++; return []; } }, estimate: { toolMs: .1, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } });
  try { await s.session.boundary(frame(), []); await s.session.settlePredictions(); assert.equal(fallbackCalls, 0); assert.equal(s.counts().reads, 0); }
  finally { await s.session.close(); }
});
test("bounded uncovered fallback receives complete shared context and rejects invented entity values", async () => {
  let calls = 0;
  const s = setup({ bindCurrent: () => [], uncoveredFallback: { maximumCalls: 1, predictorOverheadMs: 1, opportunityMs: 100,
    predict: async context => { calls++; assert.equal(context.version, "goalspec-speculation-context-v5"); assert.deepEqual(context.frame.sources["observation:1"], { id: "A" });
      return [candidate(context.frame), { ...candidate(context.frame), id: "invented", invocation: { tool: "lookup", arguments: { id: "HISTORICAL" }, scope } }]; } } });
  try {
    await s.session.boundary(frame(), []); await s.session.settlePredictions();
    assert.equal(calls, 1); assert.equal(s.counts().reads, 1);
    const result = s.events.find(event => event.type === "uncovered_fallback_completed"); assert.equal(result.accepted, 1); assert.equal(result.rejected, 1);
  } finally { await s.session.close(); }
});
test("shutdown fences and drains an in-flight remote fallback", async () => {
  let finish!: (value: Candidate[]) => void;
  const s = setup({ bindCurrent: () => [], uncoveredFallback: { maximumCalls: 1, predictorOverheadMs: 1, opportunityMs: 100,
    predict: () => new Promise(resolve => { finish = resolve; }) } });
  await s.session.boundary(frame(), []); const closing = s.session.close(); finish([candidate()]); await closing;
  assert.equal(s.counts().reads, 0); assert.ok(!s.events.some(event => event.type === "uncovered_fallback_completed"));
});
test("unrelated read dependencies retain exact authoritative promotion", async () => {
  let finish!: (value: import("../src/lib/goalspec/contracts/generated").Json) => void;
  const s = setup({}, { read: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await s.session.boundary(frame(), []); const next = frame(1); next.sources["observation:other"] = "unchanged dependency";
    await s.session.boundary(next, []); finish({ value: "A" });
    const result = await s.scheduler.authoritative(candidate().invocation, async () => { throw new Error("Duplicate authoritative read"); });
    assert.deepEqual(result, { value: "A" }); assert.equal(s.counts().validations, 1);
    assert.equal(s.events.filter(event => event.type === "started").length, 1);
  } finally { await s.session.close(); }
});
test("goal-neutral binding validates by public proof rather than frame object identity", async () => {
  let bound: ExecutionFrame | undefined;
  const proof = (f: ExecutionFrame) => hash({ runId: f.runId, boundary: f.boundary, scope: f.scope, sources: f.sources, policy: f.policy });
  const s = setup({ bindCurrent: f => { bound = f; return [candidate(f)]; },
    validateCurrent: (_candidate, current) => { assert.ok(bound); assert.notEqual(bound, current); return proof(bound!) === proof(current); } });
  try { await s.session.boundary(frame(), []); assert.equal(s.counts().reads, 1); }
  finally { await s.session.close(); }
});
test("an async fallback accepts equivalent copied public sources but fences a changed request", async () => {
  let bound: ExecutionFrame | undefined;
  const proof = (f: ExecutionFrame) => hash({ runId: f.runId, boundary: f.boundary, scope: f.scope, sources: f.sources, policy: f.policy });
  const s = setup({ bindCurrent: f => { bound = f; return []; }, validateCurrent: (_candidate, current) => !!bound && proof(bound) === proof(current),
    uncoveredFallback: { maximumCalls: 1, opportunityMs: 100, predictorOverheadMs: 1, predict: async context => [candidate(context.frame)] } });
  try { await s.session.boundary(frame(), []); await s.session.settlePredictions(); assert.equal(s.counts().reads, 1); }
  finally { await s.session.close(); }
  let finish!: (value: Candidate[]) => void;
  const changed = setup({ bindCurrent: () => [], uncoveredFallback: { maximumCalls: 1, opportunityMs: 100, predictorOverheadMs: 1,
    predict: () => new Promise(resolve => { finish = resolve; }) } });
  try {
    await changed.session.boundary(frame(), []); const next = frame(1); next.sources["requirement:2"] = "Cancel that request";
    await changed.session.boundary(next, []); finish([candidate()]); await changed.session.settlePredictions(); assert.equal(changed.counts().reads, 0);
  } finally { await changed.session.close(); }
});
test("neutral and goal-conditioned proposals receive the same goal-neutral current binding frame", async () => {
  const seen: unknown[] = [];
  for (const goalConditioning of [false, true]) {
    const s = setup({ goalConditioning, actorContext: "none", bindCurrent: f => { seen.push(f.goals); return []; } });
    try { const result = await s.session.boundary(frame(), []); assert.equal(result.actorContext, ""); }
    finally { await s.session.close(); }
  }
  assert.deepEqual(seen[0], seen[1]);
});
