import assert from "node:assert/strict";
import { test } from "node:test";
import { copy, hash } from "../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame } from "../src/lib/acephale/contracts/generated";
import { LocalChatModelPort, type InfraTokenLogprob } from "../src/lib/acephale/infra-model";
import { PREDICTOR_BASE, predictorModelIdentity, validateTrainedPredictor, type TrainedPredictorArtifact } from "../src/lib/acephale/predictor-artifact";
import { decodeBinaryRanking } from "../services/acephale-runtime/infra-binary-ranking";
import { InfraLocalPredictors, predictorContractHash, type InfraProbabilityCalibration } from "../services/acephale-runtime/infra-predictors";
import { compileGoalTrainingExample, compileRankTrainingExamples, trainingPartition, type TrainingSource, type GoalDraft } from "../services/acephale-runtime/infra-training-export";
import { historicalGoalSource } from "./acephale-training-export";
import { LEXICAL_MEMORY_RETRIEVAL_HASH } from "../src/lib/acephale/experience-memory";

const scope = { tenantId: "fixture", principalId: "fixture", authorizationVersion: "v1", environmentVersion: "v1", toolSchemaHash: hash("tools") };
const frame: ExecutionFrame = { schemaVersion: 1, runId: "fixture", boundary: 1, snapshotId: "frozen", scope,
  requestedObjective: "Read CURRENT", policy: "Read only", sources: { "requirement:0": "Read CURRENT", "observation:1": { id: "CURRENT" } },
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
const candidates: Candidate[] = Array.from({ length: 4 }, (_, index) => ({ schemaVersion: 1, id: `read-${index}`,
  invocation: { tool: `get_${index}`, arguments: { id: "CURRENT" }, scope }, probability: 0.5, bindings: [{ sourceId: "observation:1", path: ["id"] }], hop: 1, patternId: null }));
const goal: GoalDraft = { schemaVersion: 1, unknown: 0, hypotheses: [{ id: "read", objective: "Read CURRENT", probability: 1,
  sources: [{ sourceId: "requirement:0", path: [] }], constraints: [] }] };
const partitions = { weightFitFamilies: ["fit"], calibrationFamilies: ["cal"], developmentFamilies: ["dev"], testFamilies: ["test"] };
const source: TrainingSource = { id: "prefix", familyId: "fit", sourceSplit: "train", sourceDatasetHash: hash("dataset"),
  publicInputHash: hash("prefix"), compilerHash: hash("compiler"), tokenizerHash: hash("tokenizer"), chatTemplateHash: hash("template"), reviewHash: hash("review") };
function binary(text: string, probabilities: number[] = [0.2, 0.8, 0.9, 0.6]) {
  let bit = 0; const begin = text.indexOf("[");
  const logprobs: InfraTokenLogprob[] = [...text].map((token, index) => {
    const alternatives = index > begin && /^[01]$/.test(token) ? [
      { token: "0", bytes: [48], logprob: Math.log(1 - probabilities[bit]) },
      { token: "1", bytes: [49], logprob: Math.log(probabilities[bit++]) },
    ] : [{ token, bytes: [...Buffer.from(token)], logprob: -0.2 }];
    return { token, bytes: [...Buffer.from(token)], logprob: -0.2, alternatives };
  });
  return { text, logprobs };
}
function modelFixture(output = binary('{"action":"READ","hits":[0,1,1,1]}'), stream = false) {
  const bodies: { path: string; body: any }[] = [];
  let wireOverride: unknown;
  const port = new LocalChatModelPort({ baseUrl: "http://localhost:8000/v1", model: PREDICTOR_BASE.repository,
    inputBudget: 7168, contextWindow: 8192, maxOutputTokens: 1024, stream,
    fetch: (async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)); bodies.push({ path, body });
      if (path === "/tokenize") {
        // Deterministic tokenizer fixture only; production export calls the serving tokenizer.
        const count = Math.ceil(JSON.stringify(body.messages).length / 8);
        return Response.json({ count, max_model_len: 8192, tokens: Array(count).fill(1) });
      }
      const probabilities = { content: output.logprobs.map(({ alternatives, ...row }) => ({ ...row, top_logprobs: alternatives })) };
      if (!stream) return Response.json(wireOverride ?? { model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: output.text }, finish_reason: "stop", logprobs: probabilities }] });
      const events = [{ model: body.model, choices: [{ index: 0, delta: { content: output.text }, finish_reason: null, logprobs: probabilities }] },
        { model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
      return new Response(events.map(row => `data: ${JSON.stringify(row)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch });
  return { port, bodies, setWire: (value: unknown) => { wireOverride = value; } };
}
test("binary ranking uses observed pair-normalized logits and stable top-three IDs", () => {
  const result = decodeBinaryRanking(binary('{"action":"READ","hits":[0,1,1,1]}'), candidates);
  assert.deepEqual(result.scores.map(row => row.candidateId), ["read-2", "read-1", "read-3"]);
  assert.ok(Math.abs(result.scores[0].probability - 0.9) < 1e-12);
  assert.deepEqual(decodeBinaryRanking(binary('{"action":"READ","hits":[0,1,1,1]}'), candidates, true).scores.map(row => row.candidateId), candidates.map(row => row.id));
});
test("missing alternatives, partial coverage, merged binary tokens and inconsistent output fail closed", () => {
  const value = binary('{"action":"READ","hits":[0,1,1,1]}');
  for (const change of [
    (row: typeof value) => { row.logprobs.pop(); },
    (row: typeof value) => { row.logprobs.find(token => token.token === "0")!.alternatives.pop(); },
    (row: typeof value) => { row.logprobs.find(token => token.token === "0")!.bytes = [48, 44]; },
    (row: typeof value) => { row.text = row.text.replace('"READ"', '"NO_READ"'); },
  ]) { const changed = copy(value); change(changed); assert.throws(() => decodeBinaryRanking(changed, candidates)); }
  assert.throws(() => decodeBinaryRanking({ text: value.text }, candidates), /actual token/);
});
test("streaming and nonstreaming preserve requested token probabilities without changing actor settings", async () => {
  for (const stream of [false, true]) {
    const fake = modelFixture(undefined, stream);
    const result = await fake.port.complete({ id: "rank", messages: [{ role: "user", content: "fixture" }], maxOutputTokens: 1024, logprobTokenIds: [15, 16] });
    assert.equal(result.logprobs!.length, result.text.length);
    const request = fake.bodies.at(-1)!.body;
    assert.equal(request.logprobs, true); assert.deepEqual(request.logprob_token_ids, [15, 16]);
    assert.equal(request.temperature, 0); assert.deepEqual(request.chat_template_kwargs, { enable_thinking: false });
    assert.equal(request.return_tokens_as_token_ids, undefined);
  }
});
test("token probability protocol rejects empty, positive and malformed values", async () => {
  for (const content of [[], [{ token: "1", bytes: [49], logprob: 0.1, top_logprobs: [] }], [{ token: "1", bytes: [999], logprob: -1, top_logprobs: [] }]]) {
    const fake = modelFixture(); fake.setWire({ model: fake.port.model, choices: [{ index: 0, message: { role: "assistant", content: "1" }, finish_reason: "stop", logprobs: { content } }] });
    await assert.rejects(fake.port.complete({ id: "bad", messages: [{ role: "user", content: "fixture" }], maxOutputTokens: 1024, logprobTokenIds: [15, 16] }), /probabilit/);
  }
  const fake = modelFixture();
  await assert.rejects(fake.port.complete({ id: "bad", messages: [{ role: "user", content: "fixture" }], maxOutputTokens: 1024, logprobTokenIds: [15, 15] }), /bounded/);
  assert.equal(fake.bodies.length, 0);
});
test("binary predictor uses the production compiler and keeps legacy output protocol explicit", async () => {
  const fake = modelFixture();
  const predictor = new InfraLocalPredictors(fake.port, { predictionProtocol: "rank_binary_v1", binaryTokenIds: { zero: 15, one: 16 } });
  const decision = await predictor.rawRank(frame, candidates, frame.goals, new AbortController().signal);
  assert.deepEqual(decision.scores.map(row => row.candidateId), ["read-2", "read-1", "read-3"]);
  const request = fake.bodies.at(-1)!.body;
  assert.equal(request.response_format.json_schema.name, "rank_binary_v1");
  assert.deepEqual(request.logprob_token_ids, [15, 16]);
  assert.equal(new InfraLocalPredictors(modelFixture().port, { predictionProtocol: "rank_marginals_v2" }).profile.protocol, "rank_marginals_v2");
});
test("reviewed family selection provenance survives canonical calibration and runtime loading", () => {
  const profile = { predictionProtocol: "rank_binary_v1" as const, binaryTokenIds: { zero: 15, one: 16 } };
  const selectionBody = { version: 1, weightFitFamilies: ["fit"], calibrationFamilies: ["cal"], developmentFamilies: ["dev"],
    testFamilies: ["test"], sourceDesignReviewHash: hash("review"), partitionHash: hash("partition"), memoryHash: hash("memory") };
  const selection = { ...selectionBody, contentHash: hash(selectionBody) };
  const body = { version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const,
    predictionMode: "selected_candidates" as const, fittingFamilies: ["cal"], validationFamilies: ["dev"],
    sourceDatasetHash: hash("dataset"), bins: [{ upper: 1, probability: 0.5, count: 2 }],
    provenance: { model: predictorModelIdentity(profile), memoryHash: hash("memory"), condition: "neutral",
      predictorContractHash: predictorContractHash(profile), candidateCompilerHash: hash("compiler"), retrievalHash: LEXICAL_MEMORY_RETRIEVAL_HASH,
      reviewedSelection: selection } };
  const calibration = JSON.parse(JSON.stringify({ ...body, contentHash: hash(body) }));
  const runtime = new InfraLocalPredictors(modelFixture().port, { ...profile, calibration, expectedCandidateCompilerHash: hash("compiler") });
  assert.equal(runtime.contractHash, body.provenance.predictorContractHash);
  assert.equal(calibration.provenance.reviewedSelection.contentHash, hash(selectionBody));
});
test("training goal export uses the actual compiler, excludes target metadata and checks visible sources", async () => {
  const fake = modelFixture();
  const row = await compileGoalTrainingExample({ model: fake.port, frame, source, partitions,
    readTarget: async () => { assert.ok(fake.bodies.length > 0); return { draft: goal, annotationHash: hash("annotation"), annotationKind: "teacher_goal_annotation_v1" }; } });
  assert.ok(fake.bodies.every(row => row.path === "/tokenize"));
  assert.equal(row.compiledInputHash, hash(row.prompt)); assert.equal(JSON.parse(row.completion).revisionHash, undefined);
  assert.equal(row.promptTokens, Math.ceil(JSON.stringify(row.prompt).length / 8));
  const missing = copy(goal); missing.hypotheses[0]!.sources = [{ sourceId: "private_verdict", path: [] }];
  await assert.rejects(compileGoalTrainingExample({ model: fake.port, frame: { ...frame, sources: { ...frame.sources, private_verdict: "future" } }, source, partitions,
    readTarget: async () => ({ draft: missing, annotationHash: hash("annotation"), annotationKind: "teacher_goal_annotation_v1" }) }), /omitted/);
});
test("rank export never inserts missing gold calls and freezes one window before private label join", async () => {
  const fake = modelFixture(); let labelRead = false;
  const result = await compileRankTrainingExamples({ model: fake.port, frame, source, partitions,
    publicCandidates: current => { assert.equal(labelRead, false); assert.deepEqual(current, frame); return candidates; },
    conditioningGoals: goal, conditioningAnnotationHash: hash("annotation"), readTarget: async () => {
      assert.ok(fake.bodies.length >= 3); labelRead = true;
      return { checkpoint_id: "prefix", input_hash: source.publicInputHash, source: "observed-authoritative-next-decision", target_kind: "READ",
        next_invocations: [{ tool: "missing_gold", arguments: { hidden: "FUTURE_SENTINEL" } }], eligible_reads: [{ tool: "missing_gold", arguments: { hidden: "FUTURE_SENTINEL" } }] };
    } });
  assert.equal(result.length, 2); assert.deepEqual(result[0].candidateIds, result[1].candidateIds);
  for (const row of result) { assert.deepEqual(JSON.parse(row.completion), { action: "READ_UNCOVERED", hits: [0, 0, 0, 0] }); assert.ok(!JSON.stringify(row.prompt).includes("FUTURE_SENTINEL")); }
  assert.equal(fake.bodies.filter(row => row.path !== "/tokenize").length, 0);
  assert.throws(() => trainingPartition({ ...source, familyId: "test" }, partitions), /reassigned/);
  assert.throws(() => trainingPartition(source, { ...partitions, calibrationFamilies: ["fit"] }), /overlap/);
});
test("derived artifact identity binds fitting families and runtime rejects base calibration reuse", () => {
  const body = { schemaVersion: 1 as const, kind: "acephale-trained-predictor" as const, base: PREDICTOR_BASE,
    adapterHash: hash("adapter"), mergedWeightsHash: hash("weights"), tokenizerHash: hash("tokenizer"), chatTemplateHash: hash("template"),
    trainingManifestHash: hash("training"), weightFitFamilies: ["fit"], calibrationFamilies: ["cal"], protocol: "rank_binary_v1" as const,
    binaryTokenIds: { zero: 15, one: 16 }, servedModel: `acephale-predictor-${hash("weights").slice(0, 12)}` };
  const artifact: TrainedPredictorArtifact = { ...body, contentHash: hash(body) };
  assert.equal(validateTrainedPredictor(artifact).adapterHash, hash("adapter"));
  assert.notEqual(hash(predictorModelIdentity({ trainedPredictor: artifact })), hash(PREDICTOR_BASE));
  assert.notEqual(predictorContractHash({ trainedPredictor: artifact }), predictorContractHash());
  const contaminated = { ...body, calibrationFamilies: ["fit"] };
  assert.throws(() => validateTrainedPredictor({ ...contaminated, contentHash: hash(contaminated) }), /contamination/);
  const fake = modelFixture();
  assert.throws(() => new InfraLocalPredictors(fake.port, { trainedPredictor: artifact }), /Serving model/);
  const changed = copy(artifact); changed.adapterHash = hash("another"); assert.throws(() => validateTrainedPredictor(changed), /identity/);
  const calibrationBody = { version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const, predictionMode: "selected_candidates" as const,
    fittingFamilies: ["fit"], validationFamilies: ["dev"], sourceDatasetHash: hash("data"), bins: [{ upper: 1, probability: 0.5, count: 10 }] };
  const calibration: InfraProbabilityCalibration = { ...calibrationBody, contentHash: hash(calibrationBody) };
  const serving = new LocalChatModelPort({ baseUrl: "http://localhost:8000", model: artifact.servedModel });
  assert.throws(() => new InfraLocalPredictors(serving, { trainedPredictor: artifact, calibration }), /disjoint/);
});
test("historical goal conversion preserves public source and original annotation identity", () => {
  const prefix = { messages: [{ role: "user", content: "Read CURRENT" }], policy: "Read only", tools: [] }, draft = copy(goal);
  draft.hypotheses[0]!.sources = [{ sourceId: "checkpoint", path: ["messages", 0, "content"] }];
  const sourceHash = hash({ checkpoint: prefix });
  const original = { episode_id: "row", family_id: "fit", split: "train", requested_goals: { ...draft, revisionHash: sourceHash },
    visible_input_hash: sourceHash, annotation_status: "validated" };
  const wrapper = { checkpoint_id: "row", originalRow: original, originalHash: hash(original), sourceHash, goalDraft: draft };
  const converted = historicalGoalSource({ episode_id: "row", family_id: "fit", split: "train", visible_input_json: JSON.stringify(prefix) }, wrapper);
  assert.equal(converted.annotationHash, hash(wrapper)); assert.deepEqual(converted.frame.sources["event:historical_public_prefix"], prefix);
  assert.equal(converted.draft.hypotheses[0]!.sources[0].sourceId, "event:historical_public_prefix");
  assert.equal(wrapper.goalDraft.hypotheses[0]!.sources[0].sourceId, "checkpoint");
});
