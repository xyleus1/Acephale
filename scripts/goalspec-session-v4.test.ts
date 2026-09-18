import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation } from "../src/lib/goalspec/contracts/generated";
import type { LocalController } from "../src/lib/goalspec/controller";
import { GoalSpecSessionV4, type V4SessionPolicy } from "../src/lib/goalspec/session-v4";
import { SpeculationScheduler, SpeculativeCapacity, type ReadExecutor } from "../src/lib/goalspec/scheduler";
import type { Predictors } from "../src/lib/goalspec/session";
import { updateGoalState, type GoalState } from "../src/lib/goalspec/goal-state";

const scope: Invocation["scope"] = { tenantId: "a", principalId: "u", authorizationVersion: "1", environmentVersion: "v4-test", toolSchemaHash: hash([]) };
function frame(boundary = 0): ExecutionFrame {
  return { schemaVersion: 1, runId: "v4-test", boundary, scope, snapshotId: "frozen", requestedObjective: "Read record A", policy: "Read only",
    sources: { "requirement:1": "Read record A", "observation:1": { id: "A" }, _binding_events: [] },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
}
const controller = { decide(_state: unknown, candidates: Candidate[]) {
  return { action: "read", rankedCandidateIds: candidates.map(candidate => candidate.id), exposeCandidateIds: candidates.map(candidate => candidate.id),
    artifactHash: hash([]), scores: { actionRead: 1, elapsedMs: 0, candidates: candidates.map(candidate => ({ candidateId: candidate.id,
      nextAction: 1, usefulWithin2: 1, readiness: 1, exposure: 1 })) } };
} } as unknown as LocalController;
function setup(policy: Partial<V4SessionPolicy> = {}, executor: Partial<ReadExecutor> = {}, predictors: Partial<Predictors> = {}) {
  let reads = 0, validations = 0, remote = 0;
  const events: Record<string, unknown>[] = [];
  const record = (event: unknown) => events.push(event as Record<string, unknown>);
  const scheduler = new SpeculationScheduler("v4-test", {
    eligible: invocation => invocation.tool === "lookup", read: async () => { reads++; return { value: "A" }; },
    validate: async (_invocation, observation) => { validations++; return observation; }, ...executor,
  }, record, new SpeculativeCapacity(4));
  const session = new GoalSpecSessionV4({ retrieve: async () => [], retrieveLocal: () => [] }, {
    inferGoals: async () => { remote++; return frame().goals; }, embed: async () => { throw new Error("Unexpected embedding"); },
    candidates: async () => { throw new Error("No remote candidate calls in v4"); }, bindPatterns: () => [], calibrated: () => false,
    validateArguments: (candidate, input) => candidate.invocation.arguments.id === (input.sources["observation:1"] as { id: string }).id,
    ...predictors,
  }, scheduler, record, { controller, inferGoals: false, exposeEvidence: true, query: input => input.requestedObjective,
    bindCurrent: input => [{ schemaVersion: 1, id: "candidate", invocation: { tool: "lookup", arguments: { id: (input.sources["observation:1"] as { id: string }).id }, scope },
      probability: .99, hop: 1, patternId: null, bindings: [{ sourceId: "observation:1", path: ["id"] }] }],
    nonMutating: invocation => invocation.tool === "lookup", countTokens: text => Math.ceil(text.length / 4),
    estimate: { toolMs: 100, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 }, ...policy });
  return { session, scheduler, events, counts: () => ({ reads, validations, remote }) };
}

test("v4 defaults abstain for cheap tools despite high next-action confidence", async () => {
  const state = setup({ estimate: { toolMs: 0, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    assert.equal(state.counts().reads, 0);
    assert.ok(state.events.some(event => event.reason === "abstained_or_nonpositive_utility"));
  } finally { await state.session.close(); }
});

test("v4 preserves a running read after unrelated evidence and promotes its exact invocation", async () => {
  let finish!: (value: { value: string }) => void;
  const state = setup({}, { read: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    const next = frame(1); next.sources["observation:unrelated"] = { other: "unchanged dependency" };
    await state.session.boundary(next, ["requirement:1"]);
    assert.equal(state.events.filter(event => event.type === "started").length, 1);
    finish({ value: "A" });
    const value = await state.scheduler.authoritative({ tool: "lookup", arguments: { id: "A" }, scope }, async () => { throw new Error("Duplicate execution"); });
    assert.deepEqual(value, { value: "A" });
    assert.equal(state.counts().validations, 1);
  } finally { await state.session.close(); }
});

test("v4 rereads changed dependencies and never exposes a validation failure", async () => {
  const state = setup({}, { validate: async () => { throw new Error("Ownership revoked"); } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    await new Promise(resolve => setImmediate(resolve));
    const next = frame(1); next.sources["observation:1"] = { id: "B" };
    const result = await state.session.boundary(next, ["requirement:1"]);
    assert.equal(result.evidence.length, 0);
    assert.ok(state.events.some(event => event.type === "invalidated" && (event.details as { reason: string }).reason === "binding_dependency_changed"));
  } finally { await state.session.close(); }
});

test("v4 does not wait for remote goals and fences their results after close", async () => {
  let release!: () => void;
  const state = setup({ inferGoals: true }, {}, { inferGoals: async () => {
    await new Promise<void>(resolve => { release = resolve; }); return frame().goals;
  } });
  await state.session.boundary(frame(), ["requirement:1"]);
  assert.equal(typeof release, "function");
  const closing = state.session.close(); release(); await closing;
  assert.equal(state.events.filter(event => event.type === "goal_state_updated").length, 0);
});

test("v4 learned scores cannot authorize writes and optional evidence has a strict token ceiling", async () => {
  const denied = setup({ bindCurrent: input => [{ schemaVersion: 1, id: "write", invocation: { tool: "send_money", arguments: { id: "A" }, scope: input.scope },
    bindings: [{ sourceId: "observation:1", path: ["id"] }], probability: 1, hop: 1, patternId: null }] });
  try { await denied.session.boundary(frame(), ["requirement:1"]); assert.equal(denied.counts().reads, 0); }
  finally { await denied.session.close(); }
  const large = setup({}, { read: async () => ({ text: "x".repeat(5000) }) });
  try {
    await large.session.boundary(frame(), ["requirement:1"]);
    await new Promise(resolve => setImmediate(resolve));
    const before = copy(frame(1));
    const result = await large.session.boundary(before, ["requirement:1"]);
    assert.equal(result.evidence.length, 0);
    assert.ok(large.events.some(event => event.type === "evidence_withheld" && event.reason === "optional_token_budget"));
    assert.deepEqual(before, frame(1));
  } finally { await large.session.close(); }
});

test("v4 missing artifact is an explicit abstention, not uncalibrated execution", async () => {
  const state = setup({ controller: undefined });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    assert.equal(state.counts().reads, 0);
    assert.ok(state.events.some(event => event.type === "controller_decision" && (event.decision as { reason: string }).reason === "controller_artifact_unavailable"));
  } finally { await state.session.close(); }
});

test("optional exposure budget measures the exact rendered actor block", async () => {
  const state = setup({ countTokens: text => text.includes("[VERIFIED PREFETCHED EVIDENCE]") ? 513 : 1 });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    await new Promise(resolve => setImmediate(resolve));
    const result = await state.session.boundary(frame(1), ["requirement:1"]);
    assert.equal(result.evidence.length, 0, "Small raw JSON does not imply that the wrapped actor input fits");
    assert.equal(state.counts().validations, 0, "Known oversized evidence cannot cause repeated full-query validation");
    assert.equal(result.actorContext.includes("[VERIFIED PREFETCHED EVIDENCE]"), false);
    assert.ok(state.events.some(event => event.type === "evidence_withheld" && event.tokens === 513));
  } finally { await state.session.close(); }
});

test("policy revocation cancels an otherwise byte-identical current binding before exposure", async () => {
  let allowed = true;
  const state = setup({}, { eligible: () => allowed });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    await new Promise(resolve => setImmediate(resolve));
    allowed = false;
    const result = await state.session.boundary(frame(1), ["requirement:1"]);
    assert.equal(result.evidence.length, 0);
    assert.equal(state.counts().validations, 0);
    assert.ok(state.events.some(event => event.type === "invalidated"));
  } finally { await state.session.close(); }
});

test("bounded exposure experiment can sample a NO_READ false negative and records conditional assignment", async () => {
  const abstaining = { decide(input: unknown, candidates: Candidate[]) {
    const result = controller.decide(input as never, candidates);
    return { ...result, action: "NO_READ", rankedCandidateIds: [], exposeCandidateIds: [] };
  } } as unknown as LocalController;
  const state = setup({ controller: abstaining, experiment: { seed: "controlled-test", exposureProbability: .3, maximumStarts: 1 },
    estimate: { toolMs: 0, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    const next = frame(1); next.sources["observation:1"] = { id: "B" };
    await state.session.boundary(next, ["requirement:1"]);
    assert.equal(state.counts().reads, 1, "Experiment starts remain bounded despite changing candidates");
    const assignment = state.events.find(event => event.type === "exposure_assignment")!;
    assert.equal(assignment.controllerAction, "NO_READ");
    assert.equal(assignment.propensity, .3);
    assert.equal(assignment.assignedGroupProbability, assignment.expose ? .3 : .7);
    assert.equal(assignment.outcomeAnalysis, "assignment_intent_to_treat");
    assert.equal(assignment.appliesTo, "exposure_if_ready_valid_and_within_context_budget");
    assert.ok(state.events.some(event => event.reason === "bounded_development_experiment"));
  } finally { await state.session.close(); }
});

test("delayed goals rebase to current public progress without another candidate model call", async () => {
  let finish!: () => void;
  const state = setup({ inferGoals: true, inferState: async (previous, input) => {
    await new Promise<void>(resolve => { finish = resolve; });
    return updateGoalState(previous, input, { schemaVersion: 1, unknown: 0, revisionHash: hash("inferred"), hypotheses: [{
      id: "current-request", objective: "Read record A", probability: 1, constraints: [], sources: [{ sourceId: "requirement:1", path: [] }],
    }] });
  } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    const next = frame(1);
    next.sources._binding_events = [
      { kind: "tool_request", call_id: "actual-read", tool: "lookup", arguments: { id: "A" } },
      { kind: "tool_result", call_id: "actual-read", tool: "lookup", status: "success", result: { id: "A" } },
    ];
    await state.session.boundary(next, ["requirement:1"]);
    finish(); await state.session.settlePredictions();
    const update = state.events.find(event => event.type === "goal_state_updated")!;
    assert.equal((update.state as GoalState).boundary, 1);
    assert.ok((update.state as GoalState).progress.some(progress => progress.callId === "actual-read"));
    assert.equal(state.events.filter(event => event.type === "prediction_cycle_started").length, 1);
  } finally { await state.session.close(); }
});

test("a generation-fenced goal is retried against a later boundary instead of marked finished", async () => {
  const releases: (() => void)[] = [];
  let calls = 0;
  const state = setup({ inferGoals: true, inferState: async (previous, input) => {
    calls++;
    await new Promise<void>(resolve => { releases.push(resolve); });
    return updateGoalState(previous, input, frame().goals);
  } });
  try {
    await state.session.boundary(frame(), ["requirement:1"]);
    await state.scheduler.mutationBatch(async () => {});
    releases[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, "Never restart a goal using a pre-mutation latest frame");
    await state.session.boundary(frame(1), ["requirement:1"]);
    assert.equal(calls, 2);
    releases[1](); await state.session.settlePredictions();
    assert.equal(state.events.filter(event => event.type === "goal_state_updated").length, 1);
  } finally { releases.forEach(release => release()); await state.session.close(); }
});

function assignmentSeed(expose: boolean) {
  const key = hash({ tool: "lookup", arguments: { id: "A" }, scope });
  for (let index = 0; index < 100; index++) {
    const seed = `wait-fixture-${index}`;
    const assigned = parseInt(hash([seed, "v4-test", key]).slice(0, 13), 16) / 0x10000000000000 < .5;
    if (assigned === expose) return seed;
  }
  throw new Error("Missing deterministic assignment fixture");
}
const experiment = (expose = true, waitMs = 25) => ({ seed: assignmentSeed(expose), exposureProbability: .5, maximumStarts: 1, waitMs });

test("development head start waits on identical admitted keys for expose and withhold assignments", async () => {
  const recordedKeys: string[][] = [];
  for (const expose of [true, false]) {
    const state = setup({ experiment: experiment(expose) }, { read: async () => {
      await new Promise(resolve => setImmediate(resolve)); return { value: "A" };
    } });
    const original = state.scheduler.waitForReads.bind(state.scheduler);
    state.scheduler.waitForReads = async (keys, maximumMs) => {
      assert.equal(maximumMs, 25); recordedKeys.push([...keys]); await original(keys, maximumMs);
    };
    try {
      const result = await state.session.boundary(frame(), ["requirement:1"]);
      assert.equal(result.evidence.length, expose ? 1 : 0);
      assert.equal(state.counts().validations, expose ? 1 : 0, "Only actually exposed evidence needs freshness validation");
      assert.equal(state.events.find(event => event.type === "exposure_assignment")?.expose, expose);
      assert.ok(state.events.some(event => event.type === "experimental_read_head_start" && event.assignmentIndependent === true));
    } finally { await state.session.close(); }
  }
  assert.equal(recordedKeys.length, 2);
  assert.deepEqual(recordedKeys[0], recordedKeys[1]);
});

test("default development wait is zero and a bounded timeout never awaits remote goals", async () => {
  const noWait = setup({ experiment: { seed: "zero-default", exposureProbability: .5, maximumStarts: 1 } });
  noWait.scheduler.waitForReads = async () => { throw new Error("Implicit eager waiting"); };
  try { await noWait.session.boundary(frame(), ["requirement:1"]); }
  finally { await noWait.session.close(); }
  let releaseRead!: () => void, releaseGoals!: () => void;
  const state = setup({ inferGoals: true, experiment: experiment(true, 1) }, { read: async () => {
    await new Promise<void>(resolve => { releaseRead = resolve; }); return { value: "A" };
  } }, { inferGoals: async () => {
    await new Promise<void>(resolve => { releaseGoals = resolve; }); return frame().goals;
  } });
  try {
    const result = await state.session.boundary(frame(), ["requirement:1"]);
    assert.equal(result.evidence.length, 0);
    assert.equal(typeof releaseRead, "function", "Read is still unresolved when actor resumes");
    assert.equal(typeof releaseGoals, "function", "Remote inference can remain unresolved when actor resumes");
    assert.equal(state.events.some(event => event.type === "prediction_cycle_completed"), false);
  } finally { releaseRead(); releaseGoals(); await state.session.close(); }
});

test("mutation during the head start fences the old frame and prevents validation", async () => {
  let release!: () => void, entered!: () => void;
  const readEntered = new Promise<void>(resolve => { entered = resolve; });
  const state = setup({ experiment: experiment(true, 250) }, { read: async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: "A" };
  } });
  try {
    const pending = state.session.boundary(frame(), ["requirement:1"]);
    await readEntered;
    const mutation = state.scheduler.mutationBatch(async () => {});
    release(); await mutation;
    const result = await pending;
    assert.deepEqual(result.evidence, []);
    assert.equal(result.actorContext, "");
    assert.equal(state.counts().validations, 0);
    assert.equal(state.events.some(event => event.type === "decision_context"), false);
  } finally { release?.(); await state.session.close(); }
});

test("a newer boundary supersedes an older boundary waiting for local reads", async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const state = setup({ experiment: experiment(true) });
  state.scheduler.waitForReads = async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
  };
  try {
    const old = state.session.boundary(frame(), ["requirement:1"]);
    await waiting;
    await new Promise(resolve => setImmediate(resolve));
    const fresh = await state.session.boundary(frame(1), ["requirement:1"]);
    release();
    const stale = await old;
    assert.equal(stale.evidence.length, 0);
    assert.equal(stale.actorContext, "");
    assert.equal(fresh.evidence.length, 1);
    assert.deepEqual(state.events.filter(event => event.type === "decision_context").map(event => (event.frame as ExecutionFrame).boundary), [1]);
  } finally { release?.(); await state.session.close(); }
});

test("a newer boundary during freshness validation blocks stale exposure before scheduler marks it exposed", async () => {
  let release!: () => void, entered!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const state = setup({ experiment: experiment(true) }, { validate: async (_invocation, observation) => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return observation;
  } });
  try {
    const old = state.session.boundary(frame(), ["requirement:1"]);
    await validating;
    await state.session.boundary(frame(1), ["requirement:1"]);
    release();
    const result = await old;
    assert.equal(result.actorContext, "");
    assert.equal(result.evidence.length, 0);
    assert.equal(state.events.some(event => event.type === "exposed"), false);
  } finally { release?.(); await state.session.close(); }
});

test("development head start rejects invalid bounds", () => {
  for (const waitMs of [-1, 251, Infinity, NaN]) {
    assert.throws(() => setup({ experiment: experiment(true, waitMs) }), /Invalid v4 exposure experiment/);
  }
});

test("controller telemetry uses measured scoring duration and leaves missing durations absent", async () => {
  const measured = setup({ controller: { decide(input: unknown, candidates: Candidate[]) {
    const result = controller.decide(input as never, candidates);
    return { ...result, scores: { ...result.scores, elapsedMs: 2.75 } };
  } } as LocalController });
  const missing = setup({ controller: undefined });
  try {
    await measured.session.boundary(frame(), ["requirement:1"]);
    const event = measured.events.find(event => event.type === "controller_decision")!;
    assert.equal(event.latencyMs, 2.75);
    assert.equal(event.latencySource, "controller_scores_elapsed_ms");
    await missing.session.boundary(frame(), ["requirement:1"]);
    assert.equal(Object.hasOwn(missing.events.find(event => event.type === "controller_decision")!, "latencyMs"), false);
  } finally { await measured.session.close(); await missing.session.close(); }
});
