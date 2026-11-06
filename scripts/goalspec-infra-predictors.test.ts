import assert from "node:assert/strict";
import { test } from "node:test";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import { buildMemoryArtifact, type MemoryEpisode, type MemoryRun } from "../src/lib/goalspec/experience-memory";
import { compileInfraWorkflows } from "../src/lib/goalspec/infra-workflows";
import { InfraLocalPredictors, INFRA_PREDICTOR_CONTRACT_HASH } from "../services/goalspec-runtime/infra-predictors";
import { prepareInfraPredictorInput } from "../services/goalspec-runtime/infra-predictor-input";
import { INFRA_MODEL_PINS } from "../src/lib/goalspec/infra-manifest";

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
  const source = { path: "research/goalspec/runs/fixture-only/memory.json", sha256: hash("fixture") };
  const examples = [0, 1].map(index => {
    const orderId = `HISTORICAL-${index}`, runId = `train-${index}`;
    const prefix: MemoryEpisode["prefix"] = [
      { index: 0, role: "user", content: `Find delivery status. HISTORICAL_EPISODE_${index} ${"h".repeat(padding)}`, calls: [], callId: null, observation: null },
      { index: 1, role: "assistant", content: null, calls: [{ id: "lookup", tool: "get_user_details", arguments: { user_id: `old-user-${index}` } }], callId: null, observation: null },
      { index: 2, role: "tool", content: JSON.stringify({ order_id: orderId }), calls: [], callId: "lookup", observation: { order_id: orderId } },
    ];
    const run: MemoryRun = { id: runId, familyId: sameFamily ? "family-one" : `family-${index}`, stage: "v5-training", split: "train",
      scope, policyHash: hash("policy"), sourceFiles: [source], success: true, outcomeVerified: true, constraintViolations: 0,
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
  const body = { version: 1 as const, fittingFamilies: ["train"], validationFamilies: ["dev"], sourceDatasetHash: hash("dataset"),
    bins: [{ upper: 1, probability: 0.5, count: 10 }], provenance: { model: INFRA_MODEL_PINS.predictor,
      memoryHash: library.contentHash, condition: "neutral", predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH, candidateCompilerHash: compilerHash } };
  const calibration = { ...body, contentHash: hash(body) }, fake = model({});
  const options = { calibration, memory: library, expectedCandidateCompilerHash: compilerHash };
  assert.doesNotThrow(() => new InfraLocalPredictors(fake.port, options));
  assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, expectedCandidateCompilerHash: hash("old compiler") }), /not bound/);
  assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, expectedCandidateCompilerHash: undefined }), /not bound/);
  for (const change of [{ memoryHash: hash("other library") }, { predictorContractHash: hash("old prompt") },
    { model: { ...INFRA_MODEL_PINS.predictor, revision: "0".repeat(40) } }, { condition: "conditional" }]) {
    const changed = { ...body, provenance: { ...body.provenance, ...change } };
    assert.throws(() => new InfraLocalPredictors(fake.port, { ...options, calibration: { ...changed, contentHash: hash(changed) } }), /not bound/);
  }
  assert.equal(fake.requests.length, 0);
});

test("predictor drops oversized old evidence and memory while preserving policy, requirements, candidate IDs and exact binding paths", async () => {
  const current = frame(), events: Record<string, unknown>[] = [];
  const output = { action: "READ", scores: [{ candidateId: "candidate-order", probability: 0.9 }] };
  const fake = model(output);
  const predictors = new InfraLocalPredictors(fake.port, { memory: memory(4500), record: event => events.push(event) });
  assert.deepEqual(await predictors.rawRank(current, [candidate()], current.goals, new AbortController().signal), output);
  assert.ok(fake.tokenizerCounts[0] > 7168);
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
