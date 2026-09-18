import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { buildMemoryArtifact, type MemoryEpisode, type MemoryRun } from "../src/lib/goalspec/experience-memory";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest, type ModelResult } from "../src/lib/goalspec/model";
import type { Experience } from "../src/lib/goalspec/repository";
import { closedReplayEvents, createReplayWriter, loadReplayCohort, nextReadToolDistribution, NLL_EPSILON, predicateMetrics,
  publicPrefixSources, publicReplayMessages, REPLAY_ARMS, runPredictionReplay, sharedPoolDiagnostics,
  summarizePredictionReplay, type ReplayCohort, type ReplayPrediction } from "./goalspec-prediction-v3";
import { EXTENDED_VERSION, extendedRequestBound, MINI_MAXIMUM, requestedRevisions, runExtendedPredictionReplay,
  selectExtendedCohort, TEACHER_MAXIMUM } from "./goalspec-prediction-v3-extended";

const parameters = (field: string) => ({ type: "object", properties: { [field]: { type: "string" } }, required: [field], additionalProperties: false });
const tools = [
  { type: "function" as const, function: { name: "find_user_id_by_email", parameters: parameters("email") } },
  { type: "function" as const, function: { name: "get_user_details", parameters: parameters("user_id") } },
  { type: "function" as const, function: { name: "get_order_details", parameters: parameters("order_id") } },
  { type: "function" as const, function: { name: "cancel_pending_order", parameters: parameters("order_id") } },
  { type: "function" as const, function: { name: "calculate", parameters: parameters("expression") } },
];
const scope = { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools) };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });
const policy = "Locate the user's identity, then use only their own profile and orders. Do not disclose another user's information.";
const snapshotId = "frozen-replay-test";
const messages = [
  { role: "assistant", content: "Hello, how can I help?" },
  { role: "user", content: "Please find my account. My email is current@example.com." },
  { role: "assistant", content: null, tool_calls: [{ id: "email-call", name: "find_user_id_by_email", arguments: { email: "current@example.com" } }], raw_data: { hidden: "PRIVATE_RAW_DATA" } },
  { role: "tool", id: "email-call", content: '"current_1"' },
  { role: "assistant", content: null, tool_calls: [{ id: "profile-call", name: "get_user_details", arguments: { user_id: "current_1" } }] },
  { role: "tool", id: "profile-call", content: '{"user_id":"current_1","orders":["ORDER-1"]}' },
  { role: "assistant", content: "FUTURE_FINAL_MESSAGE" },
];

function frame(runId: string, boundary: number, prefixLength: number): ExecutionFrame {
  const prefix = publicReplayMessages(messages.slice(0, prefixLength));
  return { schemaVersion: 1, runId, boundary, scope, snapshotId, policy,
    requestedObjective: prefix.filter(message => message.role === "user").map(message => message.content).join("\n"),
    sources: publicPrefixSources(prefix), goals: emptyGoals() };
}
function memory() {
  const file = { path: "fixture/training.json", sha256: hash("training") };
  const run: MemoryRun = { id: "historical-train", familyId: "historical-family", stage: "v1-training", split: "train", scope,
    policyHash: hash(policy), sourceFiles: [file], success: false, outcomeVerified: true,
    constraintViolations: 0, termination: "user_stop", publicMessageCount: 3, episodeCount: 1 };
  const prefix: MemoryEpisode["prefix"] = [
    { index: 0, role: "assistant", content: "Hello", calls: [], callId: null, observation: null },
    { index: 1, role: "user", content: "Find my account using past@example.com", calls: [], callId: null, observation: null },
  ];
  const episode: MemoryEpisode = { id: "historical-episode", runId: run.id, boundary: 0, scope, prefixHash: hash(prefix), prefix,
    requirements: [prefix[1].content!], previousTool: "__start__",
    nextActions: [{ id: "historical-call", tool: "find_user_id_by_email", arguments: { email: "past@example.com" } }],
    nextMessage: null, resultingObservations: [], argumentSources: [{ actionId: "historical-call", argumentPath: ["email"],
      sources: [{ messageIndex: 1, path: ["content"], method: "substring" }] }], lesson: "Failed example. Historical values cannot bind current entities." };
  return buildMemoryArtifact({ repositorySnapshotId: snapshotId, sourceFiles: [file], runs: [run], episodes: [episode], misses: [] });
}
function patterns(): Experience[] {
  return [{ id: "profile-after-identity", familyId: "training-family", text: "Find user profile after authenticating identity", split: "train",
    embedding: Array(1536).fill(0), pattern: { schemaVersion: 1, id: "profile-pattern", scope, snapshotId, verificationTier: "native_verified",
      prefix: ["find_user_id_by_email:success"], tool: "get_user_details",
      binding: { expression: { kind: "object", fields: { user_id: { kind: "reference", reference: {
        source: "result", tool: "find_user_id_by_email", occurrence: 1, path: [] } } } }, examples: 3, total_examples: 3, language_version: 1 },
      dataDependencies: ["find_user_id_by_email"], policyPrerequisites: [], observedOrdering: [], branches: [], successes: 3, failures: 0 } }];
}
function chain(events: unknown[]) {
  let previousHash = "0".repeat(64);
  return events.map((event, sequence) => { const body = { sequence, previousHash, event }, row = { body, hash: hash(body) };
    previousHash = row.hash; return canonical(row); }).join("\n") + "\n";
}
function diskFixture(options: { failed?: boolean; zero?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-replay-v3-"));
  const runs = [{ runId: "base-fixture", arm: "base", domain: "retail", tools }, { runId: "excluded-fixture", arm: "goalspec", domain: "retail", tools }];
  const manifest = { schemaVersion: 1, runtimeVersion: "v3", snapshotId, heldoutFamilies: ["evaluation-family"], runs };
  const artifact = memory(), records = patterns();
  const frameCount = options.zero ? 0 : options.failed ? 1 : 3;
  const frames = [frame("base-fixture", 0, 2), frame("base-fixture", 1, 4), frame("base-fixture", 2, 6)].slice(0, frameCount);
  const events: unknown[] = [{ type: "research_manifest", manifestHash: hash(manifest), runtimeVersion: "goalspec-v3",
    memoryHash: artifact.contentHash, snapshotHash: hash(records), runs: runs.map(run => ({ id: run.runId, arm: run.arm })) },
    { type: "service_started" }, ...frames.map(value => ({ runId: "base-fixture", event: { type: "execution_frame", frame: value } })), { type: "service_closed" }];
  const nativeMessages = options.zero ? [] : options.failed ? messages.slice(0, 2) : messages;
  const sources: Record<string, unknown> = {
    "service-manifest.json": manifest,
    "design.json": { trials: [{ arm: "base", family: "evaluation-family" }, { arm: "goalspec", family: "evaluation-family" }] },
    "public-contexts.json": { "base-fixture": { capturedBeforeExecution: true, policy, tools } },
    "base-fixture.json": { record: { runId: "base-fixture", success: false }, simulation: { messages: nativeMessages,
      task: { secret: "HIDDEN_TASK_LABEL" }, reward_info: { reason: "HIDDEN_EVALUATOR_LABEL" } }, finalDatabase: { secret: "HIDDEN_FINAL_DATABASE" } },
    "memory.json": artifact, "records.json": records,
  };
  for (const [file, value] of Object.entries(sources)) writeFileSync(join(directory, file), JSON.stringify(value));
  writeFileSync(join(directory, "events.jsonl"), chain(events));
  const paths = { runDirectory: directory, closedEventsPath: join(directory, "events.jsonl"), memoryPath: join(directory, "memory.json"), recordsPath: join(directory, "records.json") };
  return { directory, paths, events, frames, sources, load: () => loadReplayCohort(paths), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function reply(text: unknown): ModelResult {
  return { model: RESEARCH_MODELS.candidate, continuation: [], calls: [], text: JSON.stringify(text), status: "completed", refusals: [], usage: undefined };
}
function stubModel(handler?: (request: ModelRequest, index: number) => ModelResult | Promise<ModelResult>) {
  const requests: ModelRequest[] = [];
  const model: ModelPort = { async complete(request) {
    requests.push(copy(request));
    if (handler) return handler(request, requests.length - 1);
    if (request.responseFormat?.name === "compact_goals_v2") return reply({ hypotheses: [
      { objective: "Find the user's account", weight: 100, sourceIds: ["s0"], constraints: [] }], unknownWeight: 0 });
    const units = JSON.parse(String((request.input[0] as { content: string }).content)) as { id: string; text: string }[];
    const sourceUnits = units.filter(unit => unit.id.startsWith("source:")).map(unit => JSON.parse(unit.text) as { sourceId: string; current: unknown });
    const identity = sourceUnits.find(unit => unit.current === "current_1");
    const source = identity ?? sourceUnits.find(unit => String(unit.current).includes("current@example.com"))!;
    return reply({ candidates: [{ tool: identity ? "get_user_details" : "find_user_id_by_email",
      arguments: identity ? { user_id: "current_1" } : { email: "current@example.com" }, sourceIds: [source.sourceId], confidence: 90 }] });
  } };
  return { model, requests };
}
function onlyFirst(cohort: ReplayCohort) { return { ...cohort, checkpoints: cohort.checkpoints.slice(0, 1) }; }

test("closed event provenance rejects an active stream and hash corruption", () => {
  assert.throws(() => closedReplayEvents(chain([{ type: "research_manifest" }])), /closed/);
  const text = chain([{ type: "research_manifest" }, { type: "service_closed" }]);
  assert.equal(closedReplayEvents(text).length, 2);
  assert.throws(() => closedReplayEvents(text.replace("service_closed", "service_changed")), /hash chain/);
});

test("loader selects all base checkpoints, skips the fixed greeting, and discards hidden fields", () => {
  const fixture = diskFixture();
  try {
    const cohort = fixture.load();
    assert.deepEqual(cohort.baseRunIds, ["base-fixture"]); assert.equal(cohort.excludedArmRuns, 1);
    assert.equal(cohort.checkpoints.length, 3);
    assert.deepEqual(cohort.checkpoints.map(checkpoint => checkpoint.decisionKind), ["read_only", "read_only", "message"]);
    assert.equal(cohort.checkpoints[0].actual![0].tool, "find_user_id_by_email");
    assert.equal(cohort.checkpoints[1].actual![0].arguments.user_id, "current_1");
    const serialized = canonical(cohort.checkpoints);
    for (const marker of ["PRIVATE_RAW_DATA", "HIDDEN_TASK_LABEL", "HIDDEN_EVALUATOR_LABEL", "HIDDEN_FINAL_DATABASE", "FUTURE_FINAL_MESSAGE"]) assert.ok(!serialized.includes(marker));
  } finally { fixture.cleanup(); }
});

test("loader rejects changed public observations, future source injection and wrong manifest", () => {
  const fixture = diskFixture();
  try {
    const changed = copy(fixture.events) as Record<string, unknown>[];
    const nested = changed[3].event as { frame: ExecutionFrame };
    nested.frame.sources["observation:3"] = "foreign_user";
    writeFileSync(fixture.paths.closedEventsPath, chain(changed));
    assert.throws(fixture.load, /visible prefix/);
    nested.frame.sources = copy(fixture.frames[1].sources); nested.frame.sources.future = "SECRET_FUTURE";
    writeFileSync(fixture.paths.closedEventsPath, chain(changed));
    assert.throws(fixture.load, /visible prefix/);
    changed[0].manifestHash = hash("another manifest");
    writeFileSync(fixture.paths.closedEventsPath, chain(changed));
    assert.throws(fixture.load, /another manifest/);
  } finally { fixture.cleanup(); }
});

test("pure calculate decisions are separate from writes and outside read-prediction accuracy", () => {
  const fixture = diskFixture();
  try {
    const native = JSON.parse(readFileSync(join(fixture.directory, "base-fixture.json"), "utf8"));
    native.simulation.messages[6] = { role: "assistant", content: null, tool_calls: [{ id: "math", name: "calculate", arguments: { expression: "1+1" } }] };
    writeFileSync(join(fixture.directory, "base-fixture.json"), JSON.stringify(native));
    assert.equal(fixture.load().checkpoints[2].decisionKind, "other_tool");
  } finally { fixture.cleanup(); }
});

test("missing actor response and zero-checkpoint runs remain visible without model calls", async () => {
  for (const settings of [{ failed: true }, { zero: true }]) {
    const fixture = diskFixture(settings), stub = stubModel();
    try {
      const cohort = fixture.load(), rows = await runPredictionReplay(cohort, { model: stub.model, maximumAttemptMicrodollars: 2500 });
      assert.equal(rows.length, 1); assert.equal(rows[0].checkpoint.actual, null); assert.equal(stub.requests.length, 0);
      assert.ok(rows[0].predictions.every(prediction => prediction.status === "unavailable"));
      const summary = summarizePredictionReplay(rows);
      assert.equal(summary.arms.stateless.unscorableDecisions, 1); assert.equal(summary.arms.stateless.scoredDecisions, 0);
      assert.equal(summary.arms.stateless.readOnly.top1ToolAccuracy, null);
    } finally { fixture.cleanup(); }
  }
});

test("retained native setup and stage failures require immutable outcome provenance and remain unscorable", async () => {
  for (const termination of ["service_startup_error", "slot_setup_or_telemetry_error", "stage_abort"]) {
    const fixture = diskFixture({ zero: true }), stub = stubModel();
    try {
      const record = { runId: "base-fixture", arm: "base", domain: "retail", familyId: "evaluation-family", success: false,
        officialReward: null, termination, serviceReadyBeforeTrial: false, studyId: "fixture-study", studyStage: "development" };
      const native = { record, ...(termination === "slot_setup_or_telemetry_error" ? { retainedSlotFailure: { remainingDeclaredSlotsContinue: true } } : {}),
        ...(termination === "stage_abort" ? { retainedStageFailure: true, notRetried: true } : {}) };
      const artifactPath = join(fixture.directory, termination === "stage_abort" ? "base-fixture-stage-abort.json" : "base-fixture.json");
      writeFileSync(artifactPath, JSON.stringify(native));
      if (termination === "stage_abort") {
        rmSync(join(fixture.directory, "base-fixture.json"));
        const designPath = join(fixture.directory, "design.json"), design = JSON.parse(readFileSync(designPath, "utf8"));
        writeFileSync(designPath, JSON.stringify({ ...design, designHash: "fixture-design", studyStage: "development" }));
        writeFileSync(join(fixture.directory, "stage-abort.json"), JSON.stringify({ studyId: "fixture-study", studyStage: "development",
          designHash: "fixture-design", stageAborted: true, allDeclaredSlotsRetained: true, notRetried: true }));
      }
      const outcomes = [record, { ...record, runId: "excluded-fixture", arm: "goalspec" }];
      writeFileSync(join(fixture.directory, "outcomes.jsonl"), outcomes.map(row => JSON.stringify(row)).join("\n") + "\n");
      const cohort = fixture.load(), rows = await runPredictionReplay(cohort, { model: stub.model, maximumAttemptMicrodollars: 2500 });
      assert.equal(rows.length, 1); assert.equal(rows[0].checkpoint.decisionKind, "no_checkpoint");
      assert.match(rows[0].checkpoint.unavailableReason!, /without_public_trace/);
      assert.equal(rows[0].checkpoint.frameHash, null); assert.equal(rows[0].checkpoint.actual, null); assert.equal(stub.requests.length, 0);
      assert.ok(cohort.sourceFiles.some(file => file.path.endsWith("outcomes.jsonl")));
      native.record.success = true; writeFileSync(artifactPath, JSON.stringify(native));
      assert.throws(fixture.load, /differs from immutable outcome/);
      native.record.success = false; writeFileSync(artifactPath, JSON.stringify(native));
      writeFileSync(join(fixture.directory, "outcomes.jsonl"), JSON.stringify(record) + "\n");
      assert.throws(fixture.load, /every declared outcome/);
    } finally { fixture.cleanup(); }
  }
});

test("selected replay manifest states exact chosen IDs without falsely claiming the complete parent cohort", () => {
  const fixture = diskFixture();
  try {
    const cohort = onlyFirst(fixture.load()), output = join(fixture.directory, "subset-output");
    createReplayWriter(output, cohort);
    const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.checkpointIds, cohort.checkpoints.map(checkpoint => checkpoint.id));
    assert.match(manifest.checkpointSelection, /budget-limited subset/);
    assert.ok(!manifest.checkpointSelection.includes("all declared"));
  } finally { fixture.cleanup(); }
});

test("prediction requests obey pinned model, output cap, replay allocation and reservation contract", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const cohort = fixture.load(), original = canonical(cohort.checkpoints);
    const rows = await runPredictionReplay(cohort, { model: stub.model, maximumAttemptMicrodollars: 2500 });
    assert.equal(stub.requests.length, 10, "Three candidate requests per checkpoint plus one cached goal request");
    for (const request of stub.requests) {
      assert.equal(request.model, "gpt-4.1-mini-2025-04-14"); assert.equal(request.maxOutputTokens, 1024);
      assert.equal(request.retries, 0); assert.equal(request.allocation, "replay"); assert.equal(request.maximumAttemptMicrodollars, 2500);
      assert.equal(request.tools, undefined);
    }
    assert.ok(rows.every(row => row.predictions.find(prediction => prediction.arm === "paste")!.modelRequests === 0));
    assert.equal(rows[1].predictions.find(prediction => prediction.arm === "goalspec")!.goalCacheHit, true);
    assert.equal(canonical(cohort.checkpoints), original);
  } finally { fixture.cleanup(); }
});

test("future action labels and hidden artifact fields never reach models or shared-pool ranking", async () => {
  const fixture = diskFixture(), first = stubModel(), second = stubModel();
  try {
    const cohort = onlyFirst(fixture.load()), changed = copy(cohort);
    changed.checkpoints[0].actual = [{ id: "future", tool: "cancel_pending_order", arguments: { order_id: "FUTURE_LABEL_SENTINEL" } }];
    changed.checkpoints[0].decisionKind = "write_only";
    const originalRows = await runPredictionReplay(cohort, { model: first.model, maximumAttemptMicrodollars: 2500 });
    const changedRows = await runPredictionReplay(changed, { model: second.model, maximumAttemptMicrodollars: 2500 });
    const contents = (requests: ModelRequest[]) => requests.map(({ input, instructions, responseFormat }) => ({ input, instructions, responseFormat }));
    assert.deepEqual(contents(first.requests), contents(second.requests));
    assert.deepEqual(originalRows[0].sharedPool, changedRows[0].sharedPool);
    for (const marker of ["FUTURE_LABEL_SENTINEL", "PRIVATE_RAW_DATA", "HIDDEN_TASK_LABEL", "HIDDEN_EVALUATOR_LABEL", "HIDDEN_FINAL_DATABASE", "FUTURE_FINAL_MESSAGE"]) assert.ok(!canonical(contents(first.requests)).includes(marker));
  } finally { fixture.cleanup(); }
});

test("stateless receives no memory; Salesforce receives memory with unknown goals", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const rows = await runPredictionReplay(onlyFirst(fixture.load()), { model: stub.model, maximumAttemptMicrodollars: 2500 });
    const candidateRequests = stub.requests.filter(request => request.responseFormat?.name === "read_candidates_v2");
    const stateless = String((candidateRequests[0].input[0] as { content: string }).content);
    const salesforce = String((candidateRequests[1].input[0] as { content: string }).content);
    assert.ok(!stateless.includes("episodic-memory:")); assert.ok(salesforce.includes("episodic-memory:"));
    assert.ok(!stateless.includes("past@example.com")); assert.ok(salesforce.includes("past@example.com"));
    assert.deepEqual(rows[0].predictions.find(prediction => prediction.arm === "salesforce")!.goals, emptyGoals());
  } finally { fixture.cleanup(); }
});

test("historical entity values and missing identity prerequisites cannot become predictions", async () => {
  const fixture = diskFixture();
  try {
    for (const historical of [true, false]) {
      const stub = stubModel(request => request.responseFormat?.name === "compact_goals_v2" ? reply({ hypotheses: [], unknownWeight: 100 })
        : reply({ candidates: [{ tool: historical ? "find_user_id_by_email" : "get_user_details",
          arguments: historical ? { email: "past@example.com" } : { user_id: "current_1" }, sourceIds: ["s0"], confidence: 99 }] }));
      const cohort = onlyFirst(fixture.load());
      if (!historical) {
        const checkpoint = cohort.checkpoints[0]; checkpoint.frame!.sources["requirement:1"] = String(checkpoint.frame!.sources["requirement:1"]) + " User ID current_1.";
        checkpoint.frame!.requestedObjective += " User ID current_1."; checkpoint.frameHash = hash(checkpoint.frame);
      }
      const rows = await runPredictionReplay(cohort, { model: stub.model, maximumAttemptMicrodollars: 2500 });
      for (const arm of ["stateless", "salesforce"] as const) {
        const prediction = rows[0].predictions.find(item => item.arm === arm)!;
        assert.equal(prediction.candidates.length, 0);
        assert.equal(prediction.rejected[0].reason, historical ? "current_argument_binding_or_schema" : "native_policy_prerequisite");
      }
    }
  } finally { fixture.cleanup(); }
});

test("malformed, incomplete and refused replies remain failed predictions with explicit denominators", async () => {
  const fixture = diskFixture();
  try {
    for (const mode of ["malformed", "incomplete", "refusal"] as const) {
      const stub = stubModel(() => mode === "malformed" ? { ...reply({}), text: "bad-json" }
        : mode === "incomplete" ? { ...reply({ candidates: [] }), status: "incomplete" }
          : { ...reply({ candidates: [] }), refusals: ["fixture refusal"] });
      const rows = await runPredictionReplay(onlyFirst(fixture.load()), { model: stub.model, maximumAttemptMicrodollars: 2500 });
      const summary = summarizePredictionReplay(rows);
      assert.equal(summary.arms.stateless.failedPredictions, 1); assert.equal(summary.arms.stateless.readOnlyDecisions, 1);
      assert.equal(summary.arms.stateless.readOnly.top1FullArgumentAccuracy, 0);
      assert.ok(rows[0].predictions.find(prediction => prediction.arm === "stateless")!.failureCode);
    }
  } finally { fixture.cleanup(); }
});

test("budget/provider failures are retained without opening a ledger or copying sensitive exception text", async () => {
  const fixture = diskFixture();
  try {
    const stub = stubModel(() => { throw Object.assign(new Error("SECRET_REQUEST_BODY"), { code: "BUDGET_EXHAUSTED" }); });
    const rows = await runPredictionReplay(onlyFirst(fixture.load()), { model: stub.model, maximumAttemptMicrodollars: 2500 });
    assert.equal(rows[0].predictions.find(prediction => prediction.arm === "stateless")!.failureCode, "BUDGET_EXHAUSTED");
    assert.ok(!canonical(rows).includes("SECRET_REQUEST_BODY"));
    assert.equal(rows[0].predictions.filter(prediction => prediction.status === "failed").length, 3);
  } finally { fixture.cleanup(); }
});

test("PASTE predicts symbolic current arguments and cannot reuse a historical scalar", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const rows = await runPredictionReplay(fixture.load(), { model: stub.model, maximumAttemptMicrodollars: 2500 });
    const paste = rows[1].predictions.find(prediction => prediction.arm === "paste")!;
    assert.equal(paste.candidates.length, 1); assert.equal(paste.candidates[0].invocation.arguments.user_id, "current_1");
    assert.equal(paste.candidates[0].patternId, "profile-pattern"); assert.equal(paste.modelRequests, 0);
  } finally { fixture.cleanup(); }
});

test("read-only metrics exclude writes and mixed batches and label binary smoothed NLL", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const rows = await runPredictionReplay(onlyFirst(fixture.load()), { model: stub.model, maximumAttemptMicrodollars: 2500 });
    const original = rows[0], write = copy(original), mixed = copy(original), message = copy(original);
    write.checkpoint.decisionKind = "write_only"; write.checkpoint.actual = [{ id: "w", tool: "cancel_pending_order", arguments: { order_id: "ORDER-1" } }];
    mixed.checkpoint.decisionKind = "mixed"; mixed.checkpoint.actual!.push(...write.checkpoint.actual);
    message.checkpoint.decisionKind = "message"; message.checkpoint.actual = [];
    const summary = summarizePredictionReplay([original, write, mixed, message]);
    const stateless = summary.arms.stateless;
    assert.equal(stateless.readOnlyDecisions, 1); assert.equal(stateless.scoredDecisions, 4);
    assert.equal(stateless.writeOnlyDecisions, 1); assert.equal(stateless.mixedDecisions, 1); assert.equal(stateless.messageDecisions, 1);
    assert.equal(stateless.readOnly.top1FullArgumentAccuracy, 1); assert.equal(stateless.allDecisions.readPrecision, 0.5);
    assert.match(summary.scoring.nll, /not true conditional entropy/);
    assert.equal(predicateMetrics(0, true).probability, NLL_EPSILON);
    assert.equal(predicateMetrics(1, false).probability, 1 - NLL_EPSILON);
    assert.ok(Number.isFinite(stateless.allDecisions.binaryReadPredicateNllNats));
  } finally { fixture.cleanup(); }
});

test("shared ranking controls receive every candidate in one identical label-blind pool", () => {
  const candidate = (tool: string, args: Record<string, string>): Candidate => ({ schemaVersion: 1, id: hash([tool, args]),
    invocation: { tool, arguments: args, scope }, probability: 0.9, bindings: [{ sourceId: "requirement:1", path: [] }], hop: 1, patternId: null });
  const predictions: ReplayPrediction[] = REPLAY_ARMS.map((arm, index) => ({ arm, status: "completed",
    candidates: [candidate(index % 2 ? "get_user_details" : "find_user_id_by_email", index % 2 ? { user_id: "current_1" } : { email: "current@example.com" })],
    rejected: [], failure: null, failureCode: null, goals: emptyGoals(), modelRequests: 0, goalCacheHit: false, elapsedMs: 0, events: [] }));
  const control = sharedPoolDiagnostics(predictions, frame("base-fixture", 0, 2), patterns(), null);
  assert.equal(control.candidates.length, 2);
  for (const ranking of Object.values(control.rankings)) assert.deepEqual(ranking.map(row => row.candidateId).sort(), control.candidates.map(row => row.id).sort());
  const reversed = sharedPoolDiagnostics([...predictions].reverse(), frame("base-fixture", 0, 2), patterns(), null);
  assert.deepEqual(control, reversed);
});

test("categorical next-tool transform uses the full schema with max deduplication and fixed uniform smoothing", () => {
  const candidate = (tool: string, probability: number) => ({ invocation: { tool }, probability }) as Candidate;
  const distribution = nextReadToolDistribution([candidate("a", 0.8), candidate("a", 0.4), candidate("b", 0.2)], ["c", "a", "b"]);
  assert.deepEqual(Object.keys(distribution), ["a", "b", "c"]);
  assert.equal(distribution.a, (1 - NLL_EPSILON) * 0.8 + NLL_EPSILON / 3);
  assert.equal(distribution.c, NLL_EPSILON / 3);
  assert.ok(Math.abs(Object.values(distribution).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.deepEqual(nextReadToolDistribution([], ["a", "b"]), { a: 0.5, b: 0.5 });
  assert.deepEqual(nextReadToolDistribution([candidate("a", 0)], ["a", "b"]), { a: 0.5, b: 0.5 });
  assert.throws(() => nextReadToolDistribution([candidate("private_future_tool", 1)], ["a", "b"]), /Invalid next-tool candidate/);
});

test("categorical next-tool cross entropy scores failed abstentions uniformly and reports signed PASTE reduction", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const rows = await runPredictionReplay(onlyFirst(fixture.load()), { model: stub.model, maximumAttemptMicrodollars: 2500 });
    const row = rows[0], target = row.checkpoint.actual![0].tool;
    assert.deepEqual(row.checkpoint.readToolSchemaNames, ["find_user_id_by_email", "get_order_details", "get_user_details"]);
    const paste = row.predictions.find(prediction => prediction.arm === "paste")!;
    paste.candidates = []; paste.status = "failed";
    const summary = summarizePredictionReplay(rows), k = row.checkpoint.readToolSchemaNames.length;
    assert.ok(Math.abs(summary.arms.paste.readOnly.nextToolCrossEntropyNats! - Math.log(k)) < 1e-12);
    const expected = -Math.log(nextReadToolDistribution(row.predictions[0].candidates, row.checkpoint.readToolSchemaNames)[target]);
    assert.equal(summary.arms.stateless.readOnly.nextToolCrossEntropyNats, expected);
    assert.ok(Math.abs(summary.arms.stateless.readOnly.crossEntropyReductionVsPasteNats! - (Math.log(k) - expected)) < 1e-12);
    assert.equal(summary.arms.paste.readOnly.crossEntropyReductionVsPasteNats, 0);
    assert.match(summary.scoring.nextToolCrossEntropy, /not full-action likelihood or true conditional entropy/);
    const changed = copy(rows); changed[0].checkpoint.actual![0].tool = "get_order_details";
    assert.deepEqual(changed[0].checkpoint.readToolSchemaNames, row.checkpoint.readToolSchemaNames);
    assert.deepEqual(changed[0].sharedPool, row.sharedPool);
    assert.ok(summarizePredictionReplay(changed).arms.stateless.readOnly.crossEntropyReductionVsPasteNats! < 0);
  } finally { fixture.cleanup(); }
});

test("immutable replay output records source/compiler hashes, failures and a verifiable hash chain", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    const cohort = onlyFirst(fixture.load()), output = join(fixture.directory, "output"), writer = createReplayWriter(output, cohort);
    await runPredictionReplay(cohort, { model: stub.model, maximumAttemptMicrodollars: 2500, emit: writer.emit, record: writer.record });
    writer.finish();
    const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
    const row = JSON.parse(readFileSync(join(output, "predictions.jsonl"), "utf8"));
    const completion = JSON.parse(readFileSync(join(output, "completion.json"), "utf8"));
    assert.equal(hash(row.body), row.hash); assert.equal(completion.tailHash, row.hash); assert.equal(completion.rows, 1);
    assert.ok(manifest.codeHash); assert.ok(manifest.codeSources.length >= 10); assert.ok(completion.modelEvents > 0);
    assert.throws(() => createReplayWriter(output, cohort)); assert.throws(writer.finish, /incomplete/);
    assert.throws(() => writer.record({ type: "late" }), /closed/);
  } finally { fixture.cleanup(); }
});

function semanticModel(inspect: (request: ModelRequest) => void = () => {}, failure?: "annotation" | "goal" | "grading") {
  return stubModel(request => {
    inspect(request);
    if (request.model === RESEARCH_MODELS.teacher) {
      const annotation = request.id.startsWith("annotation:");
      if (failure === (annotation ? "annotation" : "grading")) throw new Error("fixture teacher failure");
      const email = JSON.stringify(request.input).includes("other@example.com") ? "other@example.com" : "current@example.com";
      const value = annotation ? { unknown: false, objective: `Find my account using ${email}`,
        evidence: [{ sourceId: "request:0", quote: "find my account" }],
        requirements: [{ text: `Use ${email}`, sourceId: "request:0", quote: email }] } : { matches: [true, false] };
      return { ...reply(value), model: request.model };
    }
    if (request.responseFormat?.name === "compact_goals_v2") {
      if (failure === "goal") throw new Error("fixture goal failure");
      return reply({ hypotheses: [{ objective: "Find my account", weight: 100, sourceIds: ["s0"], constraints: [] }], unknownWeight: 0 });
    }
    return reply({ candidates: [] });
  });
}

test("extended budget counts all seven comparisons, one shared neutral predictor, annotations and semantic graders", () => {
  const fixture = diskFixture();
  try {
    const bound = extendedRequestBound(fixture.load());
    assert.equal(bound.checkpoints, 3); assert.equal(bound.revisions, 1);
    assert.equal(bound.miniRequests, 19); assert.equal(bound.teacherRequests, 2);
    assert.equal(bound.maximumTotalMicrodollars, 19 * MINI_MAXIMUM + 2 * TEACHER_MAXIMUM);
  } finally { fixture.cleanup(); }
});

test("budget-limited checkpoint selection is deterministic and independent of action labels", () => {
  const fixture = diskFixture();
  try {
    const cohort = fixture.load(), budget = 7 * MINI_MAXIMUM + 2 * TEACHER_MAXIMUM;
    const first = selectExtendedCohort(cohort, budget);
    assert.equal(first.cohort.checkpoints.length, 1); assert.equal(first.selection.omittedCheckpointIds.length, 2);
    assert.equal(first.selection.method, "sha256_checkpoint_id_order");
    const expected = [...cohort.checkpoints].sort((a, b) => hash([EXTENDED_VERSION, a.id]).localeCompare(hash([EXTENDED_VERSION, b.id])))[0];
    assert.equal(first.cohort.checkpoints[0].id, expected.id);
    const changed = copy(cohort); changed.checkpoints.forEach(checkpoint => { checkpoint.actual = []; checkpoint.decisionKind = "message"; });
    assert.deepEqual(selectExtendedCohort(changed, budget).selection, first.selection);
    assert.throws(() => selectExtendedCohort(cohort, budget - 1), /cannot fund even one/);
  } finally { fixture.cleanup(); }
});

test("teacher prefix-only references freeze before any predictor and semantic goal grading remains separate", async () => {
  const fixture = diskFixture(); let frozen = false;
  const model = semanticModel(request => {
    assert.equal(request.allocation, "replay");
    if (request.model === RESEARCH_MODELS.teacher) {
      assert.equal(request.maxOutputTokens, 4096); assert.equal(request.maximumAttemptMicrodollars, TEACHER_MAXIMUM);
      if (request.id.startsWith("annotation:")) {
        assert.equal(frozen, false);
        const text = JSON.stringify(request.input);
        for (const forbidden of ["HIDDEN_TASK_LABEL", "current_1", "get_user_details", "FUTURE_FINAL_MESSAGE", "rankedGoals"]) assert.ok(!text.includes(forbidden));
      } else { assert.equal(frozen, true); assert.ok(JSON.stringify(request.input).includes("complete active user objective")); }
    } else { assert.equal(frozen, true); assert.equal(request.maxOutputTokens, 1024); }
  });
  try {
    const cohort = fixture.load(), result = await runExtendedPredictionReplay(cohort, { model: model.model, maximumAttemptMicrodollars: MINI_MAXIMUM,
      freezeAnnotations: (references, referenceHash) => { assert.equal(hash(references), referenceHash); assert.equal(references.length, 1); frozen = true; } });
    assert.equal(result.rows.length, 3); assert.equal(result.rows[0].predictions.length, 8);
    assert.deepEqual(result.summary.requestedArms, ["stateless", "paste", "paste_memory", "goalspec_no_episodic", "goalspec", "oracle_goals", "shuffled_goals"]);
    assert.equal(result.summary.goalTop1, 1); assert.equal(result.summary.goalTop3, 1); assert.equal(result.summary.checkpointWeighted.scored, 3);
    assert.equal(result.summary.scoredRevisions, 1); assert.match(result.summary.label, /teacher-referenced/);
    assert.ok(model.requests.length <= extendedRequestBound(cohort).maximumRequests);
  } finally { fixture.cleanup(); }
});

test("missing annotations/grades are unmeasured but failed goal predictions count as semantic misses", async () => {
  const fixture = diskFixture();
  try {
    for (const failure of ["annotation", "goal", "grading"] as const) {
      const model = semanticModel(() => {}, failure);
      const result = await runExtendedPredictionReplay(onlyFirst(fixture.load()), { model: model.model, maximumAttemptMicrodollars: MINI_MAXIMUM, freezeAnnotations: () => {} });
      if (failure === "goal") {
        assert.equal(result.summary.failedGoalPredictions, 1); assert.equal(result.summary.scoredRevisions, 1); assert.equal(result.summary.goalTop1, 0);
      } else {
        assert.equal(result.summary.scoredRevisions, 0); assert.equal(result.summary.goalTop1, null); assert.equal(result.summary.missingAnnotationOrGrade, 1);
      }
    }
  } finally { fixture.cleanup(); }
});

test("identical visible goal revisions reuse annotation while remapping actual current source identifiers", async () => {
  const fixture = diskFixture(), model = semanticModel();
  try {
    const cohort = onlyFirst(fixture.load()), second = copy(cohort.checkpoints[0]);
    second.id = "same-visible-request-other-run"; second.runId = "second-run"; second.frame!.runId = second.runId;
    const requirement = second.frame!.sources["requirement:1"]; delete second.frame!.sources["requirement:1"];
    second.frame!.sources["requirement:9"] = requirement; second.frameHash = hash(second.frame); cohort.checkpoints.push(second);
    assert.equal(requestedRevisions(cohort).length, 1);
    const result = await runExtendedPredictionReplay(cohort, { model: model.model, maximumAttemptMicrodollars: MINI_MAXIMUM, freezeAnnotations: () => {} });
    const goals = result.rows[1].predictions.find(prediction => prediction.arm === "goalspec")!.goals;
    assert.equal(goals.hypotheses[0]?.sources[0].sourceId, "requirement:9");
    assert.equal(model.requests.filter(request => request.id.startsWith("annotation:")).length, 1);
  } finally { fixture.cleanup(); }
});

test("shuffled goals remain diagnostic prompt context and never fabricate current source references", async () => {
  const fixture = diskFixture(), model = semanticModel();
  try {
    const cohort = onlyFirst(fixture.load()), second = copy(cohort.checkpoints[0]);
    second.id = "other-visible-goal"; second.runId = "other-run"; second.familyId = "other-task-family"; second.frame!.runId = second.runId;
    second.frame!.sources["requirement:1"] = String(second.frame!.sources["requirement:1"]).replace("current@example.com", "other@example.com");
    second.frame!.requestedObjective = String(second.frame!.sources["requirement:1"]); second.frameHash = hash(second.frame); cohort.checkpoints.push(second);
    const result = await runExtendedPredictionReplay(cohort, { model: model.model, maximumAttemptMicrodollars: MINI_MAXIMUM, freezeAnnotations: () => {} });
    for (const row of result.rows) {
      const shuffled = row.predictions.find(prediction => prediction.arm === "shuffled_goals")!;
      assert.equal(shuffled.goalStatus, "deliberately_shuffled_context"); assert.deepEqual(shuffled.goals.hypotheses, []);
      assert.ok(shuffled.events.some(event => (event as { type?: string; insertedIntoCurrentSources?: boolean }).type === "shuffled_goal_context"
        && (event as { insertedIntoCurrentSources?: boolean }).insertedIntoCurrentSources === false));
      const expectedEmail = row.checkpoint.runId === "other-run" ? "other@example.com" : "current@example.com";
      assert.ok(shuffled.candidates.every(candidate => candidate.invocation.arguments.email === expectedEmail));
    }
  } finally { fixture.cleanup(); }
});

test("shuffled goals exclude donor revisions from another trial of the same task family", async () => {
  const fixture = diskFixture(), model = semanticModel();
  try {
    const cohort = onlyFirst(fixture.load()), repeated = copy(cohort.checkpoints[0]);
    repeated.id = "repeat-family-other-trial"; repeated.runId = "repeat-run"; repeated.frame!.runId = repeated.runId;
    repeated.frame!.sources["requirement:1"] = String(repeated.frame!.sources["requirement:1"]).replace("current@example.com", "other@example.com");
    repeated.frame!.requestedObjective = String(repeated.frame!.sources["requirement:1"]); repeated.frameHash = hash(repeated.frame); cohort.checkpoints.push(repeated);
    const result = await runExtendedPredictionReplay(cohort, { model: model.model, maximumAttemptMicrodollars: MINI_MAXIMUM, freezeAnnotations: () => {} });
    assert.equal(result.summary.shuffledUnavailableCheckpoints, 2);
    for (const row of result.rows) {
      const shuffled = row.predictions.find(prediction => prediction.arm === "shuffled_goals")!;
      assert.equal(shuffled.status, "failed"); assert.equal(shuffled.modelRequests, 0);
    }
  } finally { fixture.cleanup(); }
});

test("concurrent extended replay preserves the complete annotation freeze, shared responses and deterministic checkpoint emission", async () => {
  const fixture = diskFixture();
  try {
    const cohort = onlyFirst(fixture.load());
    cohort.checkpoints = Array.from({ length: 4 }, (_, index) => {
      const checkpoint = copy(cohort.checkpoints[0]);
      checkpoint.id = `parallel-${index}`; checkpoint.runId = `parallel-run-${index}`; checkpoint.familyId = `parallel-family-${index}`;
      checkpoint.frame!.runId = checkpoint.runId;
      checkpoint.frame!.sources["requirement:1"] = `${checkpoint.frame!.sources["requirement:1"]} Context ${index}.`;
      checkpoint.frame!.requestedObjective = String(checkpoint.frame!.sources["requirement:1"]); checkpoint.frameHash = hash(checkpoint.frame);
      return checkpoint;
    });
    let active = 0, peak = 0, annotationsFinished = 0, frozen = false;
    const stub = semanticModel(), model: ModelPort = { async complete(request) {
      const annotation = request.id.startsWith("annotation:");
      if (!annotation) assert.equal(frozen, true);
      active++; peak = Math.max(peak, active);
      try {
        await new Promise<void>(resolve => setImmediate(resolve));
        const result = await stub.model.complete(request); if (annotation) annotationsFinished++; return result;
      } finally { active--; }
    } };
    const emitted: string[] = [];
    const result = await runExtendedPredictionReplay(cohort, { model, concurrency: 4, maximumAttemptMicrodollars: MINI_MAXIMUM,
      freezeAnnotations: async rows => { assert.equal(rows.length, 4); assert.equal(annotationsFinished, 4); assert.equal(active, 0);
        await new Promise<void>(resolve => setImmediate(resolve)); frozen = true; },
      emit: async row => { await new Promise<void>(resolve => setImmediate(resolve)); emitted.push(row.checkpoint.id); } });
    assert.deepEqual(emitted, cohort.checkpoints.map(checkpoint => checkpoint.id));
    assert.equal(peak, 4); assert.equal(active, 0);
    assert.ok(stub.requests.length <= extendedRequestBound(cohort).maximumRequests);
    for (const row of result.rows) assert.equal(row.predictions.filter(prediction => ["paste_memory", "salesforce"].includes(prediction.arm))
      .reduce((sum, prediction) => sum + prediction.modelRequests, 0), 1);
    const sequential = semanticModel(), serial = await runExtendedPredictionReplay(cohort, { model: sequential.model, maximumAttemptMicrodollars: MINI_MAXIMUM, freezeAnnotations: () => {} });
    assert.equal(result.annotationsHash, serial.annotationsHash);
    assert.deepEqual(result.rows.map(row => row.predictions.map(prediction => [prediction.arm, prediction.status, prediction.candidates])),
      serial.rows.map(row => row.predictions.map(prediction => [prediction.arm, prediction.status, prediction.candidates])));
  } finally { fixture.cleanup(); }
});

test("concurrent plain GoalSpec replay rejects missing precomputed goals before any request", async () => {
  const fixture = diskFixture(), stub = stubModel();
  try {
    await assert.rejects(runPredictionReplay(fixture.load(), { model: stub.model, concurrency: 4, maximumAttemptMicrodollars: MINI_MAXIMUM }), /precomputed/);
    assert.equal(stub.requests.length, 0);
  } finally { fixture.cleanup(); }
});
