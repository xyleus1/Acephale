import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, copy, hash } from "../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame } from "../src/lib/acephale/contracts/generated";
import { LocalChatModelPort, type InfraTokenLogprob } from "../src/lib/acephale/infra-model";
import { PREDICTOR_BASE, predictorModelIdentity, validateTrainedPredictor, type TrainedPredictorArtifact } from "../src/lib/acephale/predictor-artifact";
import { decodeBinaryRanking } from "../services/acephale-runtime/infra-binary-ranking";
import { InfraLocalPredictors, predictorContractHash, type InfraProbabilityCalibration } from "../services/acephale-runtime/infra-predictors";
import { compileGoalTrainingExample, compileRankTrainingExamples, compileNativeTrainingExamples, planNativeTrainingExport, trainingPartition, type TrainingSource, type GoalDraft } from "../services/acephale-runtime/infra-training-export";
import { annotationGoalDraft, bindTeacherDraft, type InfraAnnotationInput } from "../services/acephale-runtime/infra-goal-annotation";
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
  const body = { version: 3 as const, probabilitySemantics: "next_batch_invocation_membership" as const,
    rawScoreSemantics: "autoregressive_binary_conditional" as const, calibratedScoreSemantics: "empirical_next_batch_membership" as const,
    predictionMode: "selected_candidates" as const, fittingFamilies: ["cal"], validationFamilies: ["dev"],
    sourceDatasetHash: hash("dataset"), bins: [{ upper: 1, probability: 0.5, count: 2 }],
    provenance: { model: predictorModelIdentity(profile), memoryHash: hash("memory"), condition: "neutral",
      predictorContractHash: predictorContractHash(profile), candidateCompilerHash: hash("compiler"), retrievalHash: LEXICAL_MEMORY_RETRIEVAL_HASH,
      reviewedSelection: selection } };
  const calibration = JSON.parse(JSON.stringify({ ...body, contentHash: hash(body) }));
  const runtime = new InfraLocalPredictors(modelFixture().port, { ...profile, calibration, expectedCandidateCompilerHash: hash("compiler") });
  assert.equal(runtime.contractHash, body.provenance.predictorContractHash);
  assert.equal(calibration.provenance.reviewedSelection.contentHash, hash(selectionBody));
  const { rawScoreSemantics: _raw, calibratedScoreSemantics: _calibrated, ...legacyBody } = body;
  const legacy = { ...legacyBody, version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const };
  assert.throws(() => new InfraLocalPredictors(modelFixture().port, { ...profile,
    calibration: { ...legacy, contentHash: hash(legacy) }, expectedCandidateCompilerHash: hash("compiler") }), /raw score semantics/);
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
  const calibrationBody = { version: 3 as const, probabilitySemantics: "next_batch_invocation_membership" as const,
    rawScoreSemantics: "autoregressive_binary_conditional" as const, calibratedScoreSemantics: "empirical_next_batch_membership" as const, predictionMode: "selected_candidates" as const,
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

function nativeAnnotationFixture() {
  const input = { policy: frame.policy, tools: [], events: [], sources: [
    { id: "policy", kind: "policy", value: frame.policy },
    { id: "requirement:0", kind: "user", value: frame.requestedObjective },
    { id: "observation:1", kind: "observation", value: { id: "CURRENT", items: [{ "a/b": "VALUE" }] } },
  ] };
  const publicInput: InfraAnnotationInput = { checkpoint_id: source.id, input_hash: hash(input), request_revision: "request-1", input };
  const annotation = bindTeacherDraft({ unknown_probability: 0, goals: [{ action: "retrieve", object_type: "record",
    objective: "Read CURRENT", confidence: 1, sources: [{ source_id: "requirement:0", pointer: "" }],
    constraints: [{ text: "Use the current value", sources: [{ source_id: "observation:1", pointer: "/items/0/a~1b" }] },
      { text: "Read only", sources: [{ source_id: "policy", pointer: "" }] }],
  }] }, publicInput, input.sources.map(row => row.id));
  return { publicInput, annotation, nativeSource: { ...source, publicInputHash: publicInput.input_hash },
    nativeFrame: { ...frame, sources: Object.fromEntries(input.sources.map(row => [row.id, row.value])) } };
}

test("native teacher output produces matched ranking examples and a grounded goal target", async () => {
  const { publicInput, annotation, nativeSource, nativeFrame } = nativeAnnotationFixture(), fake = modelFixture();
  let labelsRead = false;
  const examples = await compileNativeTrainingExamples({ model: fake.port, source: nativeSource, partitions, frame: nativeFrame,
    annotation, publicInput, publicCandidates: () => { assert.equal(labelsRead, false); return candidates; }, readTarget: async () => {
      labelsRead = true;
      return { checkpoint_id: source.id, input_hash: publicInput.input_hash, source: "observed-authoritative-next-decision", target_kind: "READ",
        next_invocations: [{ tool: "get_0", arguments: { id: "CURRENT" } }], eligible_reads: [{ tool: "get_0", arguments: { id: "CURRENT" } }] };
    } });
  assert.deepEqual(examples.map(row => [row.task, row.condition]), [["rank_binary", "neutral"], ["rank_binary", "conditional"], ["goal", null]]);
  assert.equal(examples[0].candidateWindowHash, examples[1].candidateWindowHash);
  assert.deepEqual(examples[0].candidateIds, examples[1].candidateIds);
  assert.equal(examples[0].completion, examples[1].completion);
  assert.ok(examples.every(row => row.provenance.exportProtocol === "native-multitask-v2"));
  assert.equal(examples[1].provenance.annotationHash, hash(annotation));
  const target = JSON.parse(examples[2].completion);
  assert.deepEqual(target.hypotheses[0].constraints[0].sources[0], { sourceId: "observation:1", path: ["items", 0, "a/b"] });
  assert.deepEqual(target.hypotheses[0].constraints[1].sources[0], { sourceId: "policy", path: [] });
  assert.equal(target.revisionHash, undefined);
  assert.ok(!JSON.stringify(examples[2].prompt).includes("Use the current value"));
  assert.ok(fake.bodies.every(row => row.path === "/tokenize"));
  await assert.rejects(compileGoalTrainingExample({ model: fake.port, source: nativeSource, partitions,
    frame: { ...nativeFrame, sources: { ...nativeFrame.sources, policy: "Different policy" } },
    readTarget: async () => { throw new Error("Must reject before reading annotation"); } }), /Policy source differs/);
});

test("native annotation conversion rejects stale, malformed and unsupported source bindings", () => {
  const { publicInput, annotation } = nativeAnnotationFixture();
  for (const mutate of [
    (row: typeof annotation) => { row.request_revision = "stale"; },
    (row: typeof annotation) => { row.input_hash = hash("different"); },
    (row: typeof annotation) => { row.goals[0].sources[0].source_id = "private_verdict"; },
    (row: typeof annotation) => { row.goals[0].sources[0].value_hash = hash("changed"); },
    (row: typeof annotation) => { row.goals[0].constraints[0].sources[0].pointer = "/items/01/a~1b"; },
    (row: typeof annotation) => { row.goals[0].constraints[0].sources[0].pointer = "/items/0/a~2b"; },
  ]) { const changed = copy(annotation); mutate(changed); assert.throws(() => annotationGoalDraft(changed, publicInput)); }
  assert.throws(() => annotationGoalDraft({ ...annotation, goalDraft: goal }, publicInput));
  assert.throws(() => annotationGoalDraft(annotation, { ...publicInput, input: { ...publicInput.input, policy: "changed" } }));
});

test("native recompilation preserves original teacher labels across a verified dataset extension", async () => {
  const { publicInput, annotation, nativeSource, nativeFrame } = nativeAnnotationFixture();
  const original = canonical(annotation), fake = modelFixture();
  const mergedDatasetHash = hash("new aggregate with auxiliary development, unchanged original public prefixes");
  const examples = await compileNativeTrainingExamples({ model: fake.port,
    source: { ...nativeSource, sourceDatasetHash: mergedDatasetHash }, partitions, frame: nativeFrame,
    annotation, publicInput, publicCandidates: () => candidates,
    readTarget: async () => ({ checkpoint_id: source.id, input_hash: publicInput.input_hash,
      source: "observed-authoritative-next-decision", target_kind: "READ",
      next_invocations: [{ tool: "get_0", arguments: { id: "CURRENT" } }], eligible_reads: [{ tool: "get_0", arguments: { id: "CURRENT" } }] }) });
  assert.equal(examples.length, 3);
  assert.ok(examples.every(row => row.provenance.sourceDatasetHash === mergedDatasetHash && row.provenance.publicInputHash === publicInput.input_hash));
  assert.equal(examples[1].provenance.annotationHash, hash(annotation));
  assert.equal(examples[2].provenance.annotationHash, hash(annotation));
  assert.equal(canonical(annotation), original);
});

test("missing native annotations and incomplete conditioning cannot silently export neutral examples", async () => {
  const { publicInput, nativeSource, nativeFrame } = nativeAnnotationFixture(), fake = modelFixture();
  const options = { model: fake.port, source: nativeSource, partitions, frame: nativeFrame, publicCandidates: () => candidates,
    readTarget: async () => { throw new Error("Private target must not be reached"); } };
  await assert.rejects(compileNativeTrainingExamples({ ...options, publicInput, annotation: undefined }), /annotation/);
  await assert.rejects(compileRankTrainingExamples({ ...options, conditioningAnnotationHash: hash("annotation") }), /both goals/);
  assert.equal(fake.bodies.length, 0);
});

test("native export separates selected fit triplets from declared neutral evaluation and excluded holdout", () => {
  const fit = Array.from({ length: 101 }, (_, index) => ({ checkpoint_id: `fit-${index}`, family_id: "fit", split: "train" }));
  const rows = [...fit, { checkpoint_id: "cal-1", family_id: "cal", split: "train" },
    { checkpoint_id: "dev-1", family_id: "dev", split: "development" }, { checkpoint_id: "test-1", family_id: "test", split: "test" }];
  const selection = { fittingCheckpointIds: fit.slice(0, 100).map(row => row.checkpoint_id), neutralOnlyPartitions: ["calibration", "development"] as ("calibration" | "development")[] };
  const planned = planNativeTrainingExport(rows, partitions, selection);
  assert.equal(planned.get("fit-0"), "multitask"); assert.equal(planned.get("fit-100"), "unselected_fit");
  assert.equal(planned.get("cal-1"), "neutral"); assert.equal(planned.get("dev-1"), "neutral");
  assert.equal(planned.get("test-1"), "heldout_excluded");
  for (const replacement of ["dev-1", "test-1", "absent"]) {
    assert.throws(() => planNativeTrainingExport(rows, partitions, { ...selection, fittingCheckpointIds: [replacement, ...selection.fittingCheckpointIds.slice(1)] }), /absent or outside/);
  }
  assert.throws(() => planNativeTrainingExport(rows, partitions, { ...selection, neutralOnlyPartitions: [] }), /explicit neutral/);
});
