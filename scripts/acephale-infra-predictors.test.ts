import assert from "node:assert/strict";
import { test } from "node:test";
import { copy, hash } from "../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame, GoalSet } from "../src/lib/acephale/contracts/generated";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { buildMemoryArtifact, LEXICAL_MEMORY_RETRIEVAL_HASH, type MemoryEpisode, type MemoryRun } from "../src/lib/acephale/experience-memory";
import { compileInfraWorkflows } from "../src/lib/acephale/infra-workflows";
import { InfraLocalPredictors, INFRA_PREDICTOR_CONTRACT_HASH, validateInfraCalibration } from "../services/acephale-runtime/infra-predictors";
import { prepareInfraPredictorInput, infraRelevantGoalEvidence } from "../services/acephale-runtime/infra-predictor-input";
import { InfraPredictorCoordinator } from "../services/acephale-runtime/infra-predictor-coordinator";
import { INFRA_MODEL_PINS } from "../src/lib/acephale/infra-manifest";

const scope = { tenantId: "test-office", principalId: "test-user", authorizationVersion: "auth-v1", environmentVersion: "native-v1", toolSchemaHash: hash("tools") };
function frame(): ExecutionFrame {
  return { schemaVersion: 1, runId: "current", boundary: 3, snapshotId: "frozen-library", scope,
    policy: "CURRENT_POLICY Keep exact user constraints and authorization.", requestedObjective: "Find CURRENT-456 delivery status. Keep the requested date.",
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) },
    sources: { "requirement:1": "Find CURRENT-456 delivery status.", "requirement:2": "Keep the requested date.",
      "observation:9": { old: "OLDER_OBSERVATION", padding: "x".repeat(5000) },
      "observation:10": { order_id: "CURRENT-456", status: "shipped", current_evidence: true },
      _binding_events: [
        { seq: 0, kind: "tool_request", call_id: "profile", tool: "get_user_details", arguments: { user_id: "current-user" } },
        { seq: 1, kind: "tool_result", call_id: "profile", tool: "get_user_details", status: "success", result: { order_id: "CURRENT-456" } },
      ], _signatures: ["get_user_details:success"],
      private_verdict: "FUTURE_VERDICT_SENTINEL", referenceActions: "FUTURE_ACTION_SENTINEL" } };
}
function candidate(): Candidate {
  return { schemaVersion: 1, id: "candidate-order", invocation: { tool: "get_order_details", arguments: { order_id: "CURRENT-456" }, scope },
    probability: 0.9, hop: 1, patternId: null, bindings: [{ sourceId: "_binding_events", path: [1, "result", "order_id"] }] };
}
function memory(padding = 0, sameFamily = false) {
  const source = { path: "research/acephale/runs/fixture-only/memory.json", sha256: hash("fixture") };
  const examples = [0, 1].map(index => {
    const orderId = `HISTORICAL-${index}`, runId = `train-${index}`;
    const prefix: MemoryEpisode["prefix"] = [
      { index: 0, role: "user", content: `Find delivery status. HISTORICAL_EPISODE_${index} ${"h".repeat(padding)}`, calls: [], callId: null, observation: null },
      { index: 1, role: "assistant", content: null, calls: [{ id: "lookup", tool: "get_user_details", arguments: { user_id: `old-user-${index}` } }], callId: null, observation: null },
      { index: 2, role: "tool", content: JSON.stringify({ order_id: orderId }), calls: [], callId: "lookup", observation: { order_id: orderId } },
    ];
    const run: MemoryRun = { id: runId, familyId: sameFamily ? "family-one" : `family-${index}`, stage: "v5-training", split: "train",
      scope, policyHash: hash(frame().policy), sourceFiles: [source], success: true, outcomeVerified: true, constraintViolations: 0,
      termination: "user_stop", publicMessageCount: 4, episodeCount: 1 };
    const episode: MemoryEpisode = { id: `episode-${index}`, runId, boundary: 1, scope, prefixHash: hash(prefix), prefix,
      requirements: [prefix[0].content!], previousTool: "get_user_details", nextActions: [{ id: "order", tool: "get_order_details", arguments: { order_id: orderId } }],
      nextMessage: null, resultingObservations: [], argumentSources: [{ actionId: "order", argumentPath: ["order_id"],
        sources: [{ messageIndex: 2, path: ["observation", "order_id"], method: "exact" }] }], lesson: "Rebind the visible order ID; never copy the historical identifier." };
    return { run, episode };
  });
  return buildMemoryArtifact({ repositorySnapshotId: "frozen-library", sourceFiles: [source], runs: examples.map(row => row.run),
    episodes: examples.map(row => row.episode), misses: [] }, { profile: "v5" });
}
function model(output: unknown) {
  const requests: Record<string, unknown>[] = [], tokenizerCounts: number[] = [];
  let lastCount = 0;
  const port = new LocalChatModelPort({ baseUrl: "http://localhost", model: "Qwen/Qwen3.5-0.8B", inputBudget: 7168, contextWindow: 8192, maxOutputTokens: 1024, stream: false,
    fetch: (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/tokenize")) {
        // An explicit deterministic tokenizer fixture stresses compilation; this is not a Qwen token estimate.
        lastCount = JSON.stringify(body.messages).length;
        tokenizerCounts.push(lastCount);
        return Response.json({ count: lastCount, max_model_len: 8192, tokens: Array(lastCount).fill(1) });
      }
      requests.push(body);
      return Response.json({ model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
        usage: { prompt_tokens: lastCount, completion_tokens: 20, total_tokens: lastCount + 20 } });
    }) as typeof fetch });
  return { port, requests, tokenizerCounts };
}

test("calibrated execution rejects stale compiler, model, prompt and memory identities before dispatch", () => {
  const library = memory(), compilerHash = hash("current candidate compiler");
  const body = { version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const, predictionMode: "selected_candidates" as const,
    fittingFamilies: ["train"], validationFamilies: ["dev"], sourceDatasetHash: hash("dataset"),
    bins: [{ upper: 1, probability: 0.5, count: 10 }], provenance: { model: INFRA_MODEL_PINS.predictor,
      memoryHash: library.contentHash, condition: "neutral", retrievalHash: LEXICAL_MEMORY_RETRIEVAL_HASH,
      predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH, candidateCompilerHash: compilerHash } };
  const calibration = { ...body, contentHash: hash(body) }, fake = model({});
  const options = { calibration, memory: library, expectedCandidateCompilerHash: compilerHash };
  assert.doesNotThrow(() => new InfraLocalPredictors(fake.port, options));
  assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, expectedCandidateCompilerHash: hash("old compiler") }), /not bound/);
  assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, expectedCandidateCompilerHash: undefined }), /not bound/);
  for (const change of [{ memoryHash: hash("other library") }, { predictorContractHash: hash("old prompt") }, { retrievalHash: hash("other retrieval") },
    { model: { ...INFRA_MODEL_PINS.predictor, revision: "0".repeat(40) } }, { condition: "conditional" }]) {
    const changed = { ...body, provenance: { ...body.provenance, ...change } };
    assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, calibration: { ...changed, contentHash: hash(changed) } }), /not bound/);
  }
  assert.equal(fake.requests.length, 0);
});

test("neutral and conditional predictions use independently fitted bins and reject absent or stale pairs before dispatch", async () => {
  const library = memory(), compilerHash = hash("current candidate compiler");
  const body = { version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const, predictionMode: "selected_candidates" as const,
    fittingFamilies: ["train"], validationFamilies: ["dev"], sourceDatasetHash: hash("dataset"),
    bins: [{ upper: 1, probability: 0.2, count: 10 }], provenance: { model: INFRA_MODEL_PINS.predictor,
      memoryHash: library.contentHash, condition: "neutral", retrievalHash: LEXICAL_MEMORY_RETRIEVAL_HASH,
      predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH, candidateCompilerHash: compilerHash } };
  const conditionalBody = { ...body, bins: [{ upper: 1, probability: 0.7, count: 10 }], provenance: { ...body.provenance, condition: "conditional" } };
  const pairedBody = { ...body, conditionalCalibration: { ...conditionalBody, contentHash: hash(conditionalBody) } };
  const calibration = { ...pairedBody, contentHash: hash(pairedBody) };
  const fake = model({ action: "READ", scores: [{ candidateId: "candidate-order", probability: 0.9 }] });
  const options = { calibration, memory: library, expectedCandidateCompilerHash: compilerHash };
  const current = frame(), signal = new AbortController().signal;
  const goals: GoalSet = { schemaVersion: 1, revisionHash: hash({}), unknown: 0, hypotheses: [{ id: "goal", objective: "Find order", probability: 1,
    sources: [{ sourceId: "requirement:1", path: [] }], constraints: [] }] };
  const predictor = new InfraLocalPredictors(fake.port, options);
  assert.equal((await predictor.rank(current, [candidate()], current.goals, signal)).scores[0].probability, 0.2);
  assert.equal((await predictor.rank(current, [candidate()], goals, signal)).scores[0].probability, 0.7);
  await assert.rejects(new InfraLocalPredictors(fake.port, { ...options, calibration: { ...body, contentHash: hash(body) } }).rank(current, [candidate()], goals, signal), /separate conditional/);
  assert.equal(fake.requests.length, 2);
  const multi = new InfraLocalPredictors(model({ action: "READ", scores: [{ candidateId: "candidate-order", probability: 0.9 },
    { candidateId: "candidate-second", probability: 0.8 }] }).port, options);
  const calibrated = await multi.rank(current, [candidate(), { ...candidate(), id: "candidate-second" }], goals, signal);
  assert.deepEqual(calibrated.scores.map(score => score.probability), [0.7, 0.7]);
  const staleBody = { ...conditionalBody, provenance: { ...conditionalBody.provenance, memoryHash: hash("other memory") } };
  const stalePair = { ...body, conditionalCalibration: { ...staleBody, contentHash: hash(staleBody) } };
  assert.throws(() => validateInfraCalibration({ ...stalePair, contentHash: hash(stalePair) }), /same frozen replay/);
});

test("predictor drops oversized old evidence and memory while preserving policy, requirements, candidate IDs and exact binding paths", async () => {
  const current = frame(), events: Record<string, unknown>[] = [];
  const output = { action: "READ", scores: [{ candidateId: "candidate-order", probability: 0.9 }] };
  const fake = model(output);
  const predictors = new InfraLocalPredictors(fake.port, { memory: memory(4500), record: event => events.push(event) });
  assert.deepEqual(await predictors.rawRank(current, [candidate()], current.goals, new AbortController().signal), output);
  assert.ok(fake.tokenizerCounts.some(count => count > 7168));
  assert.ok(fake.tokenizerCounts.at(-1)! <= 7168);
  assert.equal(fake.requests.length, 1);
  const sent = JSON.stringify(fake.requests[0].messages);
  for (const value of ["CURRENT_POLICY", "Find CURRENT-456 delivery status.", "Keep the requested date.", "candidate-order", "CURRENT-456", "current_evidence"]) assert.ok(sent.includes(value));
  assert.ok(!sent.includes("FUTURE_VERDICT_SENTINEL") && !sent.includes("FUTURE_ACTION_SENTINEL"));
  assert.ok(!sent.includes("OLDER_OBSERVATION"));
  const mandatory = JSON.parse((fake.requests[0].messages as { content: string }[])[1].content);
  assert.deepEqual(mandatory.candidates[0], { id: "candidate-order", tool: "get_order_details", arguments: { order_id: "CURRENT-456" }, bindings: candidate().bindings });
  assert.ok(!("scope" in mandatory.candidates[0]));
  assert.ok(mandatory.sources.some((source: Record<string, unknown>) => source.sourceId === "_binding_events" && hash(source.path) === hash([1, "result", "order_id"]) && source.value === "CURRENT-456"));
  const compiled = events.find(event => event.type === "infra_predictor_compiled")!;
  assert.ok((compiled.omitted as string[]).includes("source:observation:9"));
  assert.ok((compiled.omitted as string[]).some(id => id.startsWith("memory:episode:")));
  assert.match(String(compiled.inputHash), /^[a-f0-9]{64}$/);
  assert.equal(INFRA_PREDICTOR_CONTRACT_HASH.length, 64);
  assert.equal(events.find(event => event.type === "infra_candidate_window")!.tokenizerCalls, 1);
});

test("goal references are checked against selected context, not merely historical frame visibility", async () => {
  const current = frame();
  current.sources["observation:9"] = { old: "x".repeat(10000) };
  const goals: GoalSet = { schemaVersion: 1, revisionHash: hash({}), unknown: 0, hypotheses: [{ id: "goal", objective: "Find order status", probability: 1,
    sources: [{ sourceId: "observation:9", path: ["old"] }], constraints: [] }] };
  const fake = model(goals);
  await assert.rejects(new InfraLocalPredictors(fake.port, {}).inferGoals(current, new AbortController().signal), /omitted/);
  goals.hypotheses[0]!.sources = [{ sourceId: "requirement:1", path: [] }];
  const accepted = await new InfraLocalPredictors(model(goals).port, {}).inferGoals(current, new AbortController().signal);
  assert.equal(accepted.hypotheses[0]!.objective, "Find order status");
});

test("replay source IDs and full arrays survive compilation without renumbering", () => {
  const current = frame();
  current.sources = { "event:1": "Find CURRENT-456 delivery status.", "event:3": "Keep the requested date.",
    "event:10": { values: [{ id: "first" }, { id: "second" }, { id: "CURRENT-456" }] }, _binding_events: [], _signatures: [] };
  const bound = candidate(); bound.bindings = [{ sourceId: "event:10", path: ["values", 2, "id"] }];
  const prepared = prepareInfraPredictorInput(current, { role: "candidate", instruction: "rank", candidates: [bound], goals: current.goals });
  const mandatory = JSON.parse(prepared.messages[1].content!);
  assert.deepEqual(mandatory.sources.find((source: { sourceId: string }) => source.sourceId === "event:10").value, current.sources["event:10"]);
  assert.deepEqual(mandatory.candidates[0].bindings, bound.bindings);
  assert.ok(mandatory.sources.some((source: { sourceId: string }) => source.sourceId === "event:1"));
  assert.ok(mandatory.sources.some((source: { sourceId: string }) => source.sourceId === "event:3"));
  assert.equal(prepared.preparedHash, prepareInfraPredictorInput(copy(current), { role: "candidate", instruction: "rank", candidates: [bound], goals: current.goals }).preparedHash);
});

test("latest complete evidence and required bindings cannot be silently truncated to fit", async () => {
  const current = frame(); current.sources["observation:10"] = { hugeCurrentEvidence: "x".repeat(10000) };
  const fake = model({ action: "NO_READ", scores: [] });
  await assert.rejects(new InfraLocalPredictors(fake.port, {}).rawRank(current, [candidate()], current.goals, new AbortController().signal), /Mandatory actor input exceeds/);
  assert.equal(fake.requests.length, 0);
  const invalid = candidate(); invalid.bindings = [{ sourceId: "referenceActions", path: [] }];
  assert.throws(() => prepareInfraPredictorInput(frame(), { role: "candidate", instruction: "rank", candidates: [invalid] }), /non-public/);
});

test("compiled workflow memory binds current observations and rejects incompatible scopes and snapshots", () => {
  const compiled = compileInfraWorkflows(memory(), { get_order_details: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"], additionalProperties: false } });
  assert.ok(compiled.records.length > 0, "At least one symbolic workflow must be mined from two independent families");
  const current = frame(), candidates = compiled.bind(current);
  assert.ok(candidates.some(candidate => candidate.invocation.tool === "get_order_details" && candidate.invocation.arguments.order_id === "CURRENT-456"));
  assert.ok(!JSON.stringify(candidates).includes("HISTORICAL-"));
  assert.deepEqual(compiled.bind({ ...current, scope: { ...current.scope, principalId: "other" } }), []);
  assert.deepEqual(compiled.bind({ ...current, snapshotId: "other" }), []);
  assert.equal(compileInfraWorkflows(memory(0, true), { get_order_details: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } }).records.length, 0);
});

test("independent next-batch hit scores may total more than one and fixed panels require every score", async () => {
  const current = frame(), first = candidate(), second = { ...candidate(), id: "candidate-second" };
  const decision = { action: "READ", scores: [{ candidateId: first.id, probability: 0.9 }, { candidateId: second.id, probability: 0.8 }] };
  const fake = model(decision), predictor = new InfraLocalPredictors(fake.port, {}), signal = new AbortController().signal;
  assert.deepEqual(await predictor.rawRank(current, [first, second], current.goals, signal), decision);
  assert.deepEqual(await predictor.rawRankPanel(current, [first, second], current.goals, signal), decision);
  const missing = new InfraLocalPredictors(model({ action: "NO_READ", scores: [] }).port, {});
  await assert.rejects(missing.rawRankPanel(current, [first, second], current.goals, signal));
  const abstention = { ...decision, action: "NO_READ" };
  assert.deepEqual(await new InfraLocalPredictors(model(abstention).port, {}).rawRankPanel(current, [first, second], current.goals, signal), abstention);
});

test("neutral and goal-conditioned ranking use the same bounded tokenizer-selected candidate window", async () => {
  const current = frame(), events: Record<string, unknown>[] = [], fake = model({ action: "NO_READ", scores: [] });
  const predictor = new InfraLocalPredictors(fake.port, { record: event => events.push(event) });
  const pool = Array.from({ length: 128 }, (_, index) => ({ ...candidate(), id: `candidate-${index}` }));
  const goals: GoalSet = { schemaVersion: 1, revisionHash: hash({}), unknown: 0, hypotheses: [{ id: "goal", objective: "Find order", probability: 1,
    sources: [{ sourceId: "requirement:1", path: [] }], constraints: [] }] };
  await predictor.rawRank(current, pool, current.goals, new AbortController().signal);
  await predictor.rawRank(current, pool, goals, new AbortController().signal);
  const windows = events.filter(event => event.type === "infra_candidate_window");
  assert.equal(windows.length, 2); assert.equal(windows[0].windowHash, windows[1].windowHash);
  assert.deepEqual(windows[0].candidateIds, windows[1].candidateIds);
  assert.ok((windows[0].candidateIds as string[]).length > 0 && (windows[0].candidateIds as string[]).length < 128);
  assert.equal(fake.requests.length, 2);
  assert.ok(Number(windows[0].tokenizerCalls) <= Math.ceil(Math.log2(pool.length)) + 2);
});

test("predictor coordinator prioritizes pending rankings, removes cancelled jobs and drains active work", async () => {
  const coordinator = new InfraPredictorCoordinator(), order: string[] = [], signal = new AbortController().signal;
  let release!: () => void;
  const active = coordinator.run("ranking", signal, async () => { order.push("active"); await new Promise<void>(resolve => { release = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  const goal = coordinator.run("goal", signal, async () => { order.push("goal"); });
  const rank = coordinator.run("ranking", signal, async () => { order.push("ranking"); });
  const cancel = new AbortController();
  const cancelled = coordinator.run("ranking", cancel.signal, async () => { order.push("cancelled"); });
  cancel.abort(); const rejection = assert.rejects(cancelled);
  release(); await Promise.all([active, goal, rank, rejection]);
  assert.deepEqual(order, ["active", "ranking", "goal"]);
});

test("idle lower-priority goals yield to ranking prepared in the same event-loop turn", async () => {
  const coordinator = new InfraPredictorCoordinator(), order: string[] = [], signal = new AbortController().signal;
  const goal = coordinator.run("goal", signal, async () => { order.push("goal"); });
  const rank = Promise.resolve().then(() => coordinator.run("ranking", signal, async () => { order.push("ranking"); }));
  await Promise.all([goal, rank]); assert.deepEqual(order, ["ranking", "goal"]);
});

test("a queued ranking resolves the latest valid goals when its job is dispatched", async () => {
  const coordinator = new InfraPredictorCoordinator(), signal = new AbortController().signal;
  let release!: () => void;
  const active = coordinator.run("ranking", signal, () => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const current = frame(), fake = model({ action: "NO_READ", scores: [] });
  let latest = current.goals;
  const predictor = new InfraLocalPredictors(fake.port, { coordinator });
  const pool = [candidate()];
  const ranking = predictor.rawRank(current, pool, current.goals, signal, () => latest);
  pool[0].id = "MUTATED_AFTER_QUEUE"; current.requestedObjective = "MUTATED_AFTER_QUEUE";
  latest = { schemaVersion: 1, revisionHash: hash({}), unknown: 0, hypotheses: [{ id: "fresh", objective: "Find order", probability: 1,
    sources: [{ sourceId: "requirement:1", path: [] }], constraints: [] }] };
  release(); await Promise.all([active, ranking]);
  const mandatory = JSON.parse((fake.requests[0].messages as { content: string }[])[1].content);
  assert.equal(mandatory.goals.hypotheses[0].id, "fresh");
  assert.equal(mandatory.candidates[0].id, "candidate-order"); assert.notEqual(mandatory.objective, "MUTATED_AFTER_QUEUE");
});

test("goal refresh projection notices public task state while ignoring unrelated read payloads", () => {
  const original = frame(), initial = infraRelevantGoalEvidence(original), changed = copy(original);
  (changed.sources._binding_events as Record<string, unknown>[]).push({ kind: "tool_result", tool: "search_documents", result: { title: "unrelated new title" } });
  assert.deepEqual(infraRelevantGoalEvidence(changed), initial);
  (changed.sources._binding_events as Record<string, unknown>[]).push({ kind: "tool_result", tool: "get_order_details", result: { status: "cancelled" } });
  assert.notDeepEqual(infraRelevantGoalEvidence(changed), initial);
  const discovered = copy(original);
  (discovered.sources._binding_events as Record<string, unknown>[]).push({ kind: "tool_result", tool: "find_user_id_by_email", status: "success", result: "user_current" });
  assert.notDeepEqual(infraRelevantGoalEvidence(discovered), initial);
  const orders = copy(original);
  (orders.sources._binding_events as Record<string, unknown>[]).push({ kind: "tool_result", tool: "get_user_details", status: "success",
    result: { user_id: "user_current", orders: ["order_current"] } });
  assert.notDeepEqual(infraRelevantGoalEvidence(orders), initial);
  const arbitrary = copy(original);
  (arbitrary.sources._binding_events as Record<string, unknown>[]).push({ kind: "tool_result", tool: "fetch_document", result: { arbitrary_id: "unrelated", text: "do something" } });
  assert.deepEqual(infraRelevantGoalEvidence(arbitrary), initial);
});
