import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { ResearchService } from "../services/goalspec-runtime/service";
import { NativeBoundaryWorker } from "../services/goalspec-runtime/worker";
import type { NativeGateway } from "../services/goalspec-runtime/gateway-client";
import { assertResearchHostReady } from "../services/goalspec-runtime/provider";
import { hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, GoalSet, Invocation } from "../src/lib/goalspec/contracts/generated";
import type { ModelResult } from "../src/lib/goalspec/model";
import type { Experience, ExperienceRepository } from "../src/lib/goalspec/repository";
import { SpeculationScheduler, SpeculativeCapacity, type ReadExecutor, type RuntimeEvent } from "../src/lib/goalspec/scheduler";
import { GoalSpecSession, type Predictors } from "../src/lib/goalspec/session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function beforeNextTurn<T>(promise: Promise<T>, message: string): Promise<T> {
  const pending = Symbol("pending");
  const result = await Promise.race([promise, nextTurn().then(() => pending)]);
  assert.notEqual(result, pending, message);
  return result as T;
}
async function remainsPending(promise: Promise<unknown>, message: string) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  assert.equal(settled, false, message);
}

const scope: Invocation["scope"] = { tenantId: "test-tenant", principalId: "test-user",
  authorizationVersion: "1", environmentVersion: "fixture-v2", toolSchemaHash: hash([]) };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });
const knownGoals = (): GoalSet => ({ schemaVersion: 1, unknown: 0, revisionHash: hash({}),
  hypotheses: [{ id: "goal", objective: "Find the requested account", probability: 1,
    sources: [{ sourceId: "user", path: [] }], constraints: [] }] });
const frame = (boundary = 0, observation = boundary): ExecutionFrame => ({ schemaVersion: 1,
  runId: "v2-session-test", boundary, scope, requestedObjective: "Find my account",
  policy: "Only authorized reads", snapshotId: "fixture", sources: { user: "Find my account", observation },
  goals: emptyGoals() });
const invocation = (id: string): Invocation => ({ tool: "lookup", arguments: { id }, scope });
const candidate = (id: string): Candidate => ({ schemaVersion: 1, id, invocation: invocation(id),
  probability: 0.9, bindings: [], hop: 1, patternId: null });

test("immutable host publications ignore unfinished writes and reject a broken newest heartbeat", () => {
  const directory = mkdtempSync(join(process.env.TEMP ?? ".", "goalspec-host-publication-"));
  const previous = process.env.GOALSPEC_HOST_STATUS_FILE;
  const now = 1_800_000_000_000;
  const healthy = { healthy: true, state: "healthy", networkConnected: true, observedAtUnixMs: now, maxStatusAgeMs: 3000 };
  const publish = (sequence: number, value: unknown) => writeFileSync(join(directory, `${String(sequence).padStart(16, "0")}.json`), JSON.stringify(value), { flag: "wx" });
  process.env.GOALSPEC_HOST_STATUS_FILE = directory;
  try {
    assert.throws(() => assertResearchHostReady(now), /unavailable/);
    publish(1, { ...healthy, heartbeatSequence: 1 });
    writeFileSync(join(directory, "0000000000000002.next"), "{");
    assert.doesNotThrow(() => assertResearchHostReady(now));
    publish(2, { ...healthy, heartbeatSequence: 2, observedAtUnixMs: now - 3001 });
    assert.throws(() => assertResearchHostReady(now), /stale/);
    publish(3, { ...healthy, heartbeatSequence: 3 });
    assert.doesNotThrow(() => assertResearchHostReady(now));
    publish(4, { ...healthy, heartbeatSequence: 1 });
    assert.throws(() => assertResearchHostReady(now), /unavailable/);
    publish(5, { ...healthy, heartbeatSequence: 5, healthy: false, state: "degraded" });
    assert.throws(() => assertResearchHostReady(now), /host/i);
    writeFileSync(join(directory, "0000000000000006.json"), "{");
    assert.throws(() => assertResearchHostReady(now), /unavailable/);
  } finally {
    if (previous === undefined) delete process.env.GOALSPEC_HOST_STATUS_FILE;
    else process.env.GOALSPEC_HOST_STATUS_FILE = previous;
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
});

function setup(overrides: Partial<Predictors> = {}, executor: Partial<ReadExecutor> = {},
  capacity = new SpeculativeCapacity(1), repository: ExperienceRepository = { retrieve: async () => [] }) {
  const events: RuntimeEvent[] = [];
  const reads: Invocation[] = [];
  const scheduler = new SpeculationScheduler("v2-session-test", {
    eligible: value => value.tool === "lookup",
    read: async value => { reads.push(value); return { fresh: true }; },
    validate: async (_, observation) => observation,
    ...executor,
  }, event => events.push(event), capacity, 60_000);
  const session = new GoalSpecSession(repository, {
    inferGoals: async () => emptyGoals(), embed: async () => [1], bindPatterns: () => [],
    candidates: async () => [], calibrated: () => true, validateArguments: () => true,
    ...overrides,
  }, scheduler);
  return { session, scheduler, events, reads, capacity };
}

test("actor boundary proceeds while goal and embedding requests remain pending; goals cross only a later boundary", async () => {
  const goals = deferred<GoalSet>(), embedding = deferred<number[]>();
  const { session } = setup({ inferGoals: () => goals.promise, embed: () => embedding.promise });
  try {
    const first = await beforeNextTurn(session.boundary(frame(), ["user"]), "Actor boundary waited for prediction");
    assert.equal(first.frame.goals.unknown, 1);
    goals.resolve(knownGoals()); embedding.resolve([1]);
    await session.settlePredictions();
    assert.equal(first.frame.goals.unknown, 1, "Completed prediction mutated previously returned actor context");
    const second = await session.boundary(frame(1), ["user"]);
    assert.equal(second.frame.goals.hypotheses[0]?.objective, "Find the requested account");
  } finally { goals.resolve(emptyGoals()); embedding.resolve([1]); await session.close(); }
});

test("grounded fallback starts a physical read while goals remain pending and adopts goals only at a later boundary", async () => {
  const goals = deferred<GoalSet>(), readStarted = deferred<void>();
  const stages: string[] = [];
  const grounded: Candidate = { ...candidate("visible-account"), bindings: [{ sourceId: "account", path: ["id"] }] };
  const input = frame();
  input.sources.account = { id: "visible-account" };
  const { session } = setup({
    inferGoals: () => { stages.push("goal_requested"); return goals.promise; },
    embed: async () => { stages.push("embedded"); return [1]; },
    calibrated: () => false,
    candidates: async visible => {
      stages.push("candidate_requested");
      assert.equal(visible.goals.unknown, 1, "Fallback must accept the still-unknown goal frame");
      return [grounded];
    },
    validateArguments: (proposal, visible) => proposal.invocation.arguments.id
      === (visible.sources.account as { id: string }).id,
  }, {
    read: async value => {
      assert.equal(value.arguments.id, "visible-account");
      stages.push("physical_read"); readStarted.resolve();
      return { id: value.arguments.id, current: true };
    },
  }, undefined, { retrieve: async () => { stages.push("retrieved"); return []; } });
  try {
    const first = await beforeNextTurn(session.boundary(input, ["user"]), "Actor waited for the pending goal lane");
    assert.equal(first.frame.goals.unknown, 1);
    await beforeNextTurn(readStarted.promise, "Physical read queued behind the unresolved goal prediction");
    assert.ok(stages.includes("embedded") && stages.includes("retrieved") && stages.includes("candidate_requested"));
    assert.equal(stages.filter(stage => stage === "goal_requested").length, 1);
    await remainsPending(session.settlePredictions(), "Cycle detached its pending goal lane after starting the read");
    goals.resolve(knownGoals());
    await session.settlePredictions();
    assert.equal(first.frame.goals.unknown, 1, "Late goals mutated an actor context already returned");
    const second = await session.boundary({ ...input, boundary: 1 }, ["user"]);
    assert.equal(second.frame.goals.hypotheses[0]?.objective, "Find the requested account");
    assert.deepEqual(second.evidence.map(value => value.invocation.arguments.id), ["visible-account"]);
  } finally { goals.resolve(emptyGoals()); await session.close(); }
});

test("goal rejection preserves grounded candidate reads and drains the candidate lane plus its physical read", async () => {
  const goals = deferred<GoalSet>(), proposals = deferred<Candidate[]>(), candidateStarted = deferred<void>();
  const read = deferred<null>(), readStarted = deferred<void>();
  const grounded: Candidate = { ...candidate("visible-account"), bindings: [{ sourceId: "account", path: ["id"] }] };
  const input = frame();
  input.sources.account = { id: "visible-account" };
  const { session, capacity } = setup({
    inferGoals: () => goals.promise,
    calibrated: () => false,
    candidates: async visible => {
      assert.equal(visible.goals.unknown, 1);
      candidateStarted.resolve(); return proposals.promise;
    },
    validateArguments: (proposal, visible) => proposal.invocation.arguments.id
      === (visible.sources.account as { id: string }).id,
  }, {
    read: value => {
      assert.equal(value.arguments.id, "visible-account");
      readStarted.resolve(); return read.promise;
    },
  });
  try {
    const first = await beforeNextTurn(session.boundary(input, ["user"]), "Actor waited for goal/candidate prediction");
    assert.equal(first.frame.goals.unknown, 1);
    await beforeNextTurn(candidateStarted.promise, "Candidate lane waited for the pending goal prediction");
    goals.reject(new Error("controlled goal rejection"));
    const settling = session.settlePredictions();
    await remainsPending(settling, "Rejected goal detached the unresolved candidate response");
    proposals.resolve([grounded]);
    await beforeNextTurn(readStarted.promise, "Goal rejection prevented an otherwise grounded physical read");
    await settling;
    assert.equal(capacity.used, 1);
    const firstClose = session.close(), secondClose = session.close();
    await remainsPending(firstClose, "Close detached the candidate lane's physical read");
    await remainsPending(secondClose, "Repeated close failed to join the physical read drain");
    read.resolve(null);
    await Promise.all([firstClose, secondClose]);
    assert.equal(capacity.used, 0);
  } finally { goals.resolve(emptyGoals()); proposals.resolve([]); read.resolve(null); await session.close(); }
});

test("a candidate response for a replaced visible frame cannot admit late reads", async () => {
  const old = deferred<Candidate[]>(), started = deferred<void>();
  let calls = 0;
  const { session, reads } = setup({ calibrated: () => false, candidates: async () => {
    if (++calls === 1) { started.resolve(); return old.promise; }
    return [candidate("current")];
  } });
  try {
    await session.boundary(frame(), ["user"]); await started.promise;
    await beforeNextTurn(session.boundary(frame(1), ["user"]), "New actor boundary waited for the older candidate");
    old.resolve([candidate("stale")]); await session.settlePredictions();
    await nextTurn();
    assert.deepEqual(reads.map(value => value.arguments.id), ["current"]);
  } finally { old.resolve([]); await session.close(); }
});

test("observed patterns do not suppress fallback and unchanged retrieval scope reuses frozen memory", async () => {
  let fallbackCalls = 0, retrievalCalls = 0;
  const { session, reads } = setup({ bindPatterns: () => [candidate("old")],
    calibrated: candidates => candidates.length > 0,
    candidates: async () => { fallbackCalls++; return [candidate("new")]; },
  }, {}, undefined, { retrieve: async () => { retrievalCalls++; return []; } });
  const observedFrame = (boundary: number) => {
    const value = frame(boundary);
    value.sources._binding_events = [
      { kind: "tool_request", call_id: "old-call", tool: "lookup", arguments: { id: "old" } },
      { kind: "tool_result", call_id: "old-call", status: "success", content: { id: "old" } },
    ];
    return value;
  };
  try {
    await session.boundary(observedFrame(0), ["user"]); await session.settlePredictions(); await nextTurn();
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(reads.map(value => value.arguments.id), ["new"]);
    await session.boundary(observedFrame(1), ["user"]); await session.settlePredictions();
    assert.equal(fallbackCalls, 2);
    assert.equal(retrievalCalls, 1);
  } finally { await session.close(); }
});

test("mutation generation fences an in-flight candidate and the next changed frame can predict afresh", async () => {
  const old = deferred<Candidate[]>(), started = deferred<void>();
  let calls = 0;
  const { session, scheduler, reads } = setup({ calibrated: () => false, candidates: async () => {
    if (++calls === 1) { started.resolve(); return old.promise; }
    return [candidate("after-mutation")];
  } });
  try {
    await session.boundary(frame(), ["user"]); await started.promise;
    const generation = scheduler.generation;
    assert.equal(await scheduler.mutationBatch(async () => "mutated"), "mutated");
    assert.ok(scheduler.generation > generation);
    old.resolve([candidate("before-mutation")]); await session.settlePredictions();
    assert.equal(reads.length, 0);
    await session.boundary(frame(1), ["user"]); await session.settlePredictions(); await nextTurn();
    assert.deepEqual(reads.map(value => value.arguments.id), ["after-mutation"]);
  } finally { old.resolve([]); await session.close(); }
});

test("a rejected goal request does not detach the still-running embedding from session close", async () => {
  const goals = deferred<GoalSet>(), embedding = deferred<number[]>();
  let goalCalls = 0;
  const { session } = setup({ inferGoals: () => { goalCalls++; return goals.promise; }, embed: () => embedding.promise });
  try {
    await session.boundary(frame(), ["user"]);
    goals.reject(new Error("controlled goal rejection"));
    const changed = frame(1);
    changed.requestedObjective = "Find another account";
    changed.sources.user = changed.requestedObjective;
    await session.boundary(changed, ["user"]);
    await nextTurn();
    assert.equal(goalCalls, 1, "A replacement cycle overlapped the rejected cycle's unfinished embedding");
    const closing = session.close();
    await remainsPending(closing, "Session close detached the pending embedding after the goal failed");
    embedding.resolve([1]); await closing;
  } finally { goals.resolve(emptyGoals()); embedding.resolve([1]); await session.close(); }
});

test("all concurrent session close callers wait for both predictor and scheduler work", async () => {
  const goals = deferred<GoalSet>(), read = deferred<null>();
  const { session, scheduler, capacity } = setup({ inferGoals: () => goals.promise }, { read: () => read.promise });
  try {
    await session.boundary(frame(), ["user"]);
    scheduler.admit([candidate("pending-read")]);
    await nextTurn();
    const first = session.close(), second = session.close();
    await remainsPending(first, "First close did not await managed work");
    await remainsPending(second, "Repeated close returned before scheduler drain");
    goals.resolve(emptyGoals());
    await remainsPending(second, "Repeated close waited only for the predictor");
    read.resolve(null); await Promise.all([first, second]);
    assert.equal(capacity.used, 0);
    assert.deepEqual(scheduler.admit([candidate("late")]), []);
  } finally { goals.resolve(emptyGoals()); read.resolve(null); await session.close(); }
});

test("unrelated authoritative work proceeds while speculative capacity and prediction are occupied", async () => {
  const prediction = deferred<GoalSet>(), read = deferred<null>();
  const { session, scheduler, capacity } = setup({ inferGoals: () => prediction.promise }, { read: () => read.promise });
  try {
    await session.boundary(frame(), ["user"]); scheduler.admit([candidate("prefetch")]);
    await nextTurn(); assert.equal(capacity.used, 1);
    assert.equal(await beforeNextTurn(scheduler.authoritative(invocation("actor"), async () => "authoritative"),
      "An unrelated authoritative invocation queued behind speculative work"), "authoritative");
  } finally { prediction.resolve(emptyGoals()); read.resolve(null); await session.close(); }
});

test("boundary exposure awaits current authorization and discards validation crossed by a mutation", async () => {
  const validation = deferred<{ current: boolean }>(), started = deferred<void>();
  const { session, scheduler } = setup({}, { validate: async () => { started.resolve(); return validation.promise; } });
  try {
    scheduler.admit([candidate("ready")]); await nextTurn();
    const boundary = session.boundary(frame(), ["user"]); await started.promise;
    await remainsPending(boundary, "Unvalidated evidence crossed the actor boundary");
    const mutation = scheduler.mutationBatch(async () => "mutated");
    validation.resolve({ current: true });
    assert.deepEqual((await boundary).evidence, []);
    assert.equal(await mutation, "mutated");
  } finally { validation.resolve({ current: true }); await session.close(); }
});

test("service close drains other workers before propagating a close failure", async () => {
  const slow = deferred<void>();
  const service = new ResearchService({} as NativeGateway);
  service.register("failure", { decision: async () => ({}), close: async () => { throw new Error("controlled close rejection"); } });
  service.register("slow", { decision: async () => ({}), close: () => slow.promise });
  const closing = service.close();
  try {
    await remainsPending(closing, "Service released ownership while a sibling worker still drained");
    slow.resolve(); await assert.rejects(closing, /controlled close rejection/);
  } finally { slow.resolve(); await closing.catch(() => {}); }
});

test("worker close waits for its in-flight actor decision and rejects subsequent decisions", async () => {
  const response = deferred<ModelResult>(), started = deferred<void>();
  const worker = new NativeBoundaryWorker({ runId: "worker-close", scope, snapshotId: "fixture",
    allocation: "development", maximumAttemptMicrodollars: 1, maxBoundaries: 2 }, {
    complete: async () => { started.resolve(); return response.promise; },
  }, () => {});
  const result: ModelResult = { model: "gpt-5.4-2026-03-05", text: "done", continuation: [], calls: [],
    status: "completed", refusals: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const boundary = { policy: "p", messages: [{ role: "user" as const, content: "task" }], tools: [] };
  const decision = worker.decision(boundary, "first");
  try {
    await started.promise;
    const closing = worker.close();
    await remainsPending(closing, "Worker close returned before its actor response completed");
    await assert.rejects(worker.decision(boundary, "second"), /unavailable/);
    response.resolve(result); assert.equal((await decision).content, "done"); await closing;
  } finally { response.resolve(result); await decision; await worker.close(); }
});

for (const dimension of ["scope", "snapshot"] as const) {
  test(`completed goals do not cross a changed ${dimension} while replacement goals remain pending`, async () => {
    const replacement = deferred<GoalSet>();
    let goalCalls = 0;
    const { session } = setup({ inferGoals: () => ++goalCalls === 1
      ? Promise.resolve(knownGoals()) : replacement.promise });
    try {
      await session.boundary(frame(0, 0), ["user"]);
      await session.settlePredictions();
      const cached = await session.boundary(frame(1, 0), ["user"]);
      assert.equal(cached.frame.goals.hypotheses[0]?.objective, "Find the requested account");
      assert.equal(goalCalls, 1);
      const changed = frame(2, 0);
      if (dimension === "scope") changed.scope = { ...scope, tenantId: "other-tenant" };
      else changed.snapshotId = "other-snapshot";
      const pending = await beforeNextTurn(session.boundary(changed, ["user"]), "Refreshing goals blocked the actor");
      assert.equal(pending.frame.goals.unknown, 1, "Completed goals leaked into the changed context");
      assert.deepEqual(pending.frame.goals.hypotheses, []);
      assert.equal(goalCalls, 2, "Changed context reused the old goal cache");
      await remainsPending(session.settlePredictions(), "Replacement goal prediction was not retained");
      const fresh = knownGoals();
      const hypothesis = fresh.hypotheses[0];
      assert.ok(hypothesis);
      hypothesis.objective = "Find the account in the refreshed context";
      replacement.resolve(fresh);
      await session.settlePredictions();
      assert.equal(pending.frame.goals.unknown, 1, "Replacement completion mutated a returned actor frame");
      const adopted = await session.boundary({ ...changed, boundary: 3 }, ["user"]);
      assert.equal(adopted.frame.goals.hypotheses[0]?.objective, "Find the account in the refreshed context");
      assert.equal(goalCalls, 2);
    } finally { replacement.resolve(emptyGoals()); await session.close(); }
  });

  test(`historical examples do not cross a changed ${dimension} while replacement retrieval is pending`, async () => {
    const replacement = deferred<Experience[]>();
    let retrievals = 0;
    const record: Experience = { id: "old-example", familyId: "training-family", text: "training", embedding: [1], split: "train",
      pattern: { schemaVersion: 1, id: "pattern", scope, snapshotId: "fixture", verificationTier: "native_verified",
        prefix: [], tool: "old-context-private-example", binding: {}, dataDependencies: [], policyPrerequisites: [],
        observedOrdering: [], branches: [], successes: 1, failures: 0 } };
    const { session } = setup({}, {}, new SpeculativeCapacity(1), { retrieve: async () =>
      ++retrievals === 1 ? [record] : replacement.promise });
    try {
      await session.boundary(frame(), ["user"]); await session.settlePredictions();
      const same = await session.boundary(frame(1, 0), ["user"]);
      assert.match(same.actorContext, /old-context-private-example/);
      const changed = frame(2, 0);
      if (dimension === "scope") changed.scope = { ...scope, tenantId: "other-tenant" };
      else changed.snapshotId = "other-snapshot";
      const next = await beforeNextTurn(session.boundary(changed, ["user"]), "Replacement retrieval blocked actor context");
      assert.doesNotMatch(next.actorContext, /old-context-private-example/);
      await nextTurn();
      assert.equal(retrievals, 2, "Changed scope/snapshot failed to start a fresh retrieval");
    } finally { replacement.resolve([]); await session.close(); }
  });
}

test("host dispatch gate rejects stale, offline and malformed heartbeat records without provider calls", () => {
  const directory = mkdtempSync(join(process.cwd(), "research/goalspec/runs/test-host-status-v2-"));
  const path = join(directory, "status.json");
  const previous = process.env.GOALSPEC_HOST_STATUS_FILE;
  const now = 1_800_000_000_000;
  const healthy = { schemaVersion: 1, healthy: true, state: "healthy", networkConnected: true,
    observedAtUnixMs: now, maxStatusAgeMs: 3000 };
  process.env.GOALSPEC_HOST_STATUS_FILE = path;
  try {
    writeFileSync(path, JSON.stringify(healthy));
    assert.doesNotThrow(() => assertResearchHostReady(now));
    for (const [label, changes] of Object.entries({
      stale: { observedAtUnixMs: now - 3001 }, future: { observedAtUnixMs: now + 1001 },
      offline: { networkConnected: false }, degraded: { healthy: false, state: "degraded" },
      nonnumericTimestamp: { observedAtUnixMs: "not-a-number" }, stringTimestamp: { observedAtUnixMs: String(now) },
      nonnumericAge: { maxStatusAgeMs: "not-a-number" }, stringHealthy: { healthy: "true" },
      nullTimestamp: { observedAtUnixMs: null }, negativeAge: { maxStatusAgeMs: -1 },
    })) {
      writeFileSync(path, JSON.stringify({ ...healthy, ...changes }));
      assert.throws(() => assertResearchHostReady(now), /host/i, `Host status accepted ${label}`);
    }
    writeFileSync(path, "{");
    assert.throws(() => assertResearchHostReady(now), /unavailable/);
    unlinkSync(path);
    assert.throws(() => assertResearchHostReady(now), /unavailable/);
  } finally {
    if (previous === undefined) delete process.env.GOALSPEC_HOST_STATUS_FILE;
    else process.env.GOALSPEC_HOST_STATUS_FILE = previous;
    try { unlinkSync(path); } catch { /* The missing-file case removed this fixture already. */ }
    rmdirSync(directory);
  }
});
