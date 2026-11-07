import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame, GoalSet, Scope } from "../src/lib/acephale/contracts/generated";
import { InfraSession, expectedInfraSaving, type InfraSessionPolicy } from "../src/lib/acephale/infra-session";
import { SpeculationScheduler, SpeculativeCapacity } from "../src/lib/acephale/scheduler";

const scope: Scope = { tenantId: "office", principalId: "operator", authorizationVersion: "1", environmentVersion: "test", toolSchemaHash: hash({}) };
const frame = (boundary = 0, request = "Read the document"): ExecutionFrame => ({ schemaVersion: 1, runId: "run", boundary, scope,
  requestedObjective: request, policy: "read only", sources: { request, document: "current-id" }, snapshotId: "frozen",
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } });
const candidate = (): Candidate => ({ schemaVersion: 1, id: "candidate", invocation: { tool: "read", arguments: { id: "current-id" }, scope },
  bindings: [{ sourceId: "document", path: [] }], probability: 0.9, hop: 1, patternId: null });
const policy = (overrides: Partial<InfraSessionPolicy> = {}): InfraSessionPolicy => ({ arm: "acephale", memoryHash: hash({}), goalReliability: 1,
  opportunity: () => ({ toolMs: 1000, actorLeadMs: 1000, predictionMs: 0, schedulingMs: 0, validationMs: 0, contentionMs: 0 }),
  candidates: () => [candidate()], validateBinding: () => true,
  rank: async () => ({ action: "READ", scores: [{ candidateId: "candidate", probability: 0.9 }] }), ...overrides });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test("opportunity models overlap and rejects full reread overhead", () => {
  assert.equal(expectedInfraSaving(1, { toolMs: 100, actorLeadMs: 40, predictionMs: 20, schedulingMs: 1, validationMs: 5, contentionMs: 2 }), 11);
  assert.ok(expectedInfraSaving(1, { toolMs: 1, actorLeadMs: 100, predictionMs: 0, schedulingMs: 1, validationMs: 5, contentionMs: 0 }) < 0);
  assert.throws(() => expectedInfraSaving(NaN, { toolMs: 1, actorLeadMs: 1, predictionMs: 0, schedulingMs: 0, validationMs: 0, contentionMs: 0 }));
});
test("negative opportunity runs neither retrieval nor model prediction", async () => {
  let called = 0;
  const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async () => { called++; return 1; }, validate: async (_, prior) => prior }, () => {});
  const session = new InfraSession(scheduler, policy({ opportunity: () => ({ toolMs: 1, actorLeadMs: 100, predictionMs: 1, schedulingMs: 1, validationMs: 2, contentionMs: 0 }),
    candidates: () => { called++; return []; }, inferGoals: async () => { called++; return frame().goals; } }));
  session.observe(frame()); await session.settled(); assert.equal(called, 0); await session.close();
});
test("actor is not blocked by prediction and exact read is joined once", async () => {
  const predicted = deferred<void>(), read = deferred<string>(); let reads = 0, authoritative = 0;
  const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async () => { reads++; return read.promise; }, validate: async (_, prior) => prior }, () => {}, new SpeculativeCapacity(4));
  const session = new InfraSession(scheduler, policy({ rank: async () => { await predicted.promise; return { action: "READ", scores: [{ candidateId: "candidate", probability: 1 }] }; } }));
  assert.equal(session.observe(frame()), undefined); assert.equal(reads, 0);
  predicted.resolve(); await session.settled(); assert.equal(reads, 1);
  const result = session.authoritative(candidate().invocation, async () => { authoritative++; return "duplicate"; });
  read.resolve("verified"); assert.equal(await result, "verified"); assert.equal(authoritative, 0); await session.close();
});
test("new requirement fences a late prediction and unknown goals do not trigger repeated calls", async () => {
  const prediction = deferred<void>(); let reads = 0, goals = 0;
  const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async () => { reads++; return 1; }, validate: async (_, prior) => prior }, () => {});
  const session = new InfraSession(scheduler, policy({ rank: async () => { await prediction.promise; return { action: "READ", scores: [{ candidateId: "candidate", probability: 1 }] }; },
    inferGoals: async () => { goals++; return frame().goals; } }));
  session.observe(frame()); await new Promise(resolve => setImmediate(resolve));
  session.observe(frame(1)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(goals, 1);
  const closed = session.close(); prediction.resolve(); await closed; assert.equal(reads, 0);
});
test("ranking uses the same neutral candidate pool and rejects fabricated candidate IDs", async () => {
  const pools: string[] = []; let reads = 0;
  for (const arm of ["neutral_memory_prefetch", "acephale"] as const) {
    const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async () => { reads++; return 1; }, validate: async (_, prior) => prior }, () => {});
    const session = new InfraSession(scheduler, policy({ arm, candidates: input => { assert.equal(input.goals.hypotheses.length, 0); return [candidate()]; },
      rank: async (_, candidates) => { pools.push(hash(candidates)); return { action: "READ", scores: [{ candidateId: "fabricated", probability: 1 }] }; } }));
    session.observe(frame()); await session.settled(); await session.close();
  }
  assert.equal(pools[0], pools[1]); assert.equal(reads, 0);
});
test("mutation invalidates pending read and preserves native batch return", async () => {
  let readStarted = false;
  const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async (_, signal) => { readStarted = true;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); return "late"; }, validate: async (_, prior) => prior }, () => {});
  const session = new InfraSession(scheduler, policy()); session.observe(frame()); await session.settled(); assert.equal(readStarted, true);
  assert.deepEqual(await session.mutationBatch(async () => ["native", "batch"]), ["native", "batch"]); await session.close();
});

function groundedGoals(input: ExecutionFrame): GoalSet {
  if (!input.sources.document || !input.sources.details) return input.goals;
  return { schemaVersion: 1, unknown: 0, revisionHash: hash({}), hypotheses: [{ id: "read", probability: 1,
    objective: `Read ${input.sources.document}`, sources: [{ sourceId: "document", path: [] }],
    constraints: [{ text: "Use the visible deadline", sources: [{ sourceId: "details", path: ["deadline"] }] }] }] };
}
const goalFrame = (boundary: number, document = "current-id", deadline = "today"): ExecutionFrame => {
  const input = frame(boundary); input.sources.document = document; input.sources.details = { deadline, unrelated: "old" }; return input;
};
function goalScheduler() {
  return new SpeculationScheduler("run", { eligible: () => true, read: async () => "unused", validate: async (_, prior) => prior }, () => {});
}
test("goal cache refreshes changed hypothesis and constraint paths, not unrelated read values", async () => {
  let calls = 0;
  const session = new InfraSession(goalScheduler(), policy({ candidates: () => [], rank: async () => ({ action: "NO_READ", scores: [] }),
    inferGoals: async input => { calls++; return groundedGoals(input); } }));
  session.observe(goalFrame(0)); await session.settled(); assert.equal(calls, 1);
  const unrelated = goalFrame(1); unrelated.sources.other_read = "new"; unrelated.sources.details = { deadline: "today", unrelated: "changed" };
  session.observe(unrelated); await session.settled(); assert.equal(calls, 1);
  session.observe(goalFrame(2, "new-id")); await session.settled(); assert.equal(calls, 2);
  session.observe(goalFrame(3, "new-id", "tomorrow")); await session.settled(); assert.equal(calls, 3);
  const missing = goalFrame(4, "new-id", "tomorrow"); delete missing.sources.details;
  session.observe(missing); await session.settled(); assert.equal(calls, 4);
  await session.mutationBatch(async () => undefined);
  session.observe(goalFrame(5)); await session.settled(); assert.equal(calls, 5);
  await session.close();
});
test("late goal result is fenced when a referenced value changed, then refreshed from the latest frame", async () => {
  const release = deferred<GoalSet>(); let calls = 0; const records: Record<string, unknown>[] = [];
  const session = new InfraSession(goalScheduler(), policy({ candidates: () => [], rank: async () => ({ action: "NO_READ", scores: [] }),
    inferGoals: async input => { calls++; return calls === 1 ? release.promise : groundedGoals(input); } }), event => records.push(event));
  const first = goalFrame(0); session.observe(first); await new Promise(resolve => setImmediate(resolve));
  session.observe(goalFrame(1, "new-id", "tomorrow")); release.resolve(groundedGoals(first));
  await session.settled(); assert.equal(calls, 2);
  assert.equal(records.filter(event => event.type === "infra_goals_stale").length, 1);
  const ready = records.filter(event => event.type === "infra_goals_ready"); assert.equal(ready.length, 1);
  assert.equal((ready[0].goals as GoalSet).hypotheses[0]!.objective, "Read new-id");
  await session.close();
});
test("late goal result remains valid across unrelated public reads", async () => {
  const release = deferred<GoalSet>(); let calls = 0; const records: Record<string, unknown>[] = [];
  const session = new InfraSession(goalScheduler(), policy({ candidates: () => [], rank: async () => ({ action: "NO_READ", scores: [] }),
    inferGoals: async () => { calls++; return release.promise; } }), event => records.push(event));
  const first = goalFrame(0); session.observe(first); await new Promise(resolve => setImmediate(resolve));
  const later = goalFrame(1); later.sources.other_read = "new"; session.observe(later); release.resolve(groundedGoals(first));
  await session.settled(); assert.equal(calls, 1); assert.equal(records.filter(event => event.type === "infra_goals_ready").length, 1);
  await session.close();
});
test("changed goal sources are invalidated even while speculative opportunity is disabled", async () => {
  let available = true, calls = 0;
  const session = new InfraSession(goalScheduler(), policy({ candidates: () => [], rank: async () => ({ action: "NO_READ", scores: [] }),
    opportunity: () => ({ toolMs: available ? 1000 : 0, actorLeadMs: 1000, predictionMs: 0, schedulingMs: 0, validationMs: 1, contentionMs: 0 }),
    inferGoals: async input => { calls++; return groundedGoals(input); } }));
  session.observe(goalFrame(0)); await session.settled(); assert.equal(calls, 1);
  available = false; session.observe(goalFrame(1, "new-id")); await session.settled(); assert.equal(calls, 1);
  available = true; session.observe(goalFrame(2, "new-id")); await session.settled(); assert.equal(calls, 2);
  await session.close();
});

test("one ranking per checkpoint reads current goals at dispatch and admits multiple high-probability reads", async () => {
  const queued = deferred<void>(), goalsReady = deferred<GoalSet>(); let ranks = 0, reads = 0;
  const input = goalFrame(0), second = candidate(); second.id = "candidate-2"; second.invocation.arguments.id = "second";
  const scheduler = new SpeculationScheduler("run", { eligible: () => true, read: async () => { reads++; return "ready"; }, validate: async (_, prior) => prior }, () => {});
  const session = new InfraSession(scheduler, policy({ candidates: () => [candidate(), second], inferGoals: () => goalsReady.promise,
    rank: async (_, __, ___, ____, latest) => {
      ranks++; await queued.promise; assert.equal(latest?.().hypotheses[0]?.objective, "Read current-id");
      return { action: "READ", scores: [{ candidateId: "candidate", probability: 0.9 }, { candidateId: "candidate-2", probability: 0.8 }] };
    } }));
  session.observe(input); await new Promise(resolve => setImmediate(resolve));
  goalsReady.resolve(groundedGoals(input)); await new Promise(resolve => setImmediate(resolve)); queued.resolve();
  await session.settled(); assert.equal(ranks, 1); assert.equal(reads, 2); await session.close();
});
