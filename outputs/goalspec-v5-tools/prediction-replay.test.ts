import assert from "node:assert/strict";
import { test } from "node:test";
import { annotateCheckpoint, rankCheckpoint, scoreDecision, selectReplayCheckpoints } from "./prediction-replay";
import { hash } from "../../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest } from "../../src/lib/goalspec/model";
import { LocalControllerV5 } from "../../src/lib/goalspec/controller-v5";
import { V5_FEATURE_VERSION, V5_GOAL_DIMENSION, V5_NEUTRAL_DIMENSION } from "../../src/lib/goalspec/controller-v5-features";

function row(id = "a", domain = "retail", family = "retail:test") {
  const request = "Return order_id #A1 without an exchange.";
  return { id: hash(id), runId: id, familyId: family, domain, boundary: 0, eventHash: hash(id), frameError: null, tools: [],
    frame: { schemaVersion: 1, runId: id, boundary: 0, snapshotId: "test", policy: "Public policy",
      scope: { tenantId: "test", principalId: "test", authorizationVersion: "test", environmentVersion: "test", toolSchemaHash: hash([]) },
      sources: { "requirement:0": request, _binding_events: [], _signatures: [] }, requestedObjective: request,
      goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } } } as any;
}
function fakeModel(malformed = false) {
  const requests: ModelRequest[] = [];
  const model: ModelPort = { complete: async request => {
    requests.push(request);
    let text: string;
    if (request.id.endsWith(":blind")) {
      assert(!JSON.stringify(request.input).includes('"hypotheses"'));
      text = JSON.stringify({ requestedGoal: "Return #A1 without exchange", ambiguous: false,
        atoms: [{ id: "a0", kind: "objective", status: "active", text: "Return #A1 without exchange", spanIds: ["s0p0"] }] });
    } else if (request.id.endsWith(":prediction")) text = JSON.stringify({ set_active_goals: [
      { objective: "Inspect #A1", weight: 2, spanIds: ["s0p0"], constraints: [] },
      { objective: "Return #A1 without exchange", weight: 1, spanIds: ["s0p0"], constraints: [] }], unknownWeight: 0, factDeltas: [] });
    else text = JSON.stringify({ assessments: [1, 2].map(rank => ({ rank: malformed ? 1 : rank,
      agreement: { goalMatches: rank === 2, ambiguous: false, unsupportedPrediction: false, stalePrediction: false,
        atoms: [{ id: "a0", covered: rank === 2, contradicted: false }], reason: "Synthetic complete-request comparison" } })) });
    return { model: request.model, status: "completed", calls: [], refusals: [], text, continuation: [], usage: undefined };
  } };
  return { model, requests };
}
test("balanced deterministic selection ignores validation and future success labels", () => {
  const rows = ["retail", "airline"].flatMap(domain => Array.from({ length: 12 }, (_, index) =>
    ({ ...row(`${domain}-${index}`, domain, `${domain}:family${index % 3}`), futureOutcome: index % 2 === 0 })));
  const selected = selectReplayCheckpoints(rows);
  assert.equal(selected.length, 16);
  assert.equal(selected.filter(item => item.domain === "retail").length, 8);
  assert.equal(new Set(selected.map(item => item.familyId)).size, 6);
  const changed = rows.map(item => ({ ...item, futureOutcome: !item.futureOutcome, frameError: "invalid-must-not-replace" }));
  assert.deepEqual(selectReplayCheckpoints(changed).map(item => item.id), selected.map(item => item.id));
});
test("blind teacher and independent all-rank grade can distinguish GoalTop1 and Top3", async () => {
  const fake = fakeModel(), output = await annotateCheckpoint(row(), fake.model);
  assert.deepEqual(fake.requests.map(request => request.model), [RESEARCH_MODELS.teacher, RESEARCH_MODELS.goal, RESEARCH_MODELS.teacher]);
  assert.equal(output.goalTop1, false); assert.equal(output.goalTop3, true); assert.equal(output.grades?.length, 2);
  assert.equal(output.sourceGrounded, true); assert.deepEqual(output.failures, []);
  assert(fake.requests.every(request => request.allocation === "replay" && request.retries === 0));
});
test("malformed all-rank grading stays masked without replacing the selected prefix", async () => {
  const output = await annotateCheckpoint(row(), fakeModel(true).model);
  assert.equal(output.goals?.hypotheses.length, 2); assert.equal(output.goalTop1, null); assert.equal(output.goalTop3, null);
  assert.equal(output.failures[0]?.stage, "agreement");
});
test("same-pool probabilities expose uncovered and NO_READ losses without a fake exact-answer mass", () => {
  const checkpoint = row(), candidate = { id: "c", invocation: { tool: "get_order_details", arguments: { order_id: "#A1" }, scope: checkpoint.frame.scope } } as any;
  const decision = { action: "NO_READ", noReadProbability: .5, uncoveredProbability: .2,
    candidates: [{ candidateId: "c", probability: .3 }], rankedCandidateIds: ["c"] } as any;
  const miss = scoreDecision(checkpoint, [candidate], decision, [{ tool: "get_order_details", arguments: { order_id: "#OTHER" } }]);
  assert.equal(miss.poolCovered, false); assert.equal(miss.exactTop1, false); assert.equal(miss.exactLossFloored, true);
  assert.equal(miss.categoryNllNats, -Math.log(.2)); assert.equal(miss.toolSetNllNats, -Math.log(.3));
  const none = scoreDecision(checkpoint, [candidate], decision, []);
  assert.equal(none.noReadCorrect, true); assert.equal(none.categoryNllNats, -Math.log(.5));
  assert.equal(scoreDecision(checkpoint, [], null, []).noReadCorrect, false);
});
test("shuffled primary preserves donor provenance and eight controls retain identical candidates", async () => {
  const body = { version: "goalspec-controller-v5", featureVersion: V5_FEATURE_VERSION, architecture: "listwise-linear-neutral-plus-goal-residual",
    neutralWeights: Array(V5_NEUTRAL_DIMENSION).fill(0), goalWeights: Array(V5_GOAL_DIMENSION).fill(.01),
    calibration: { neutralTemperature: 1, goalTemperature: 1, reliability: { status: "unavailable", bins: [], sourceHashes: [] } },
    lineage: { datasetHash: hash([]), trainingFamilies: ["train"], selectionFamilies: ["select"], calibrationFamilies: ["calibration"],
      goalTraining: "none", excludedPriorHeldout: true, sources: [] } };
  const controller = new LocalControllerV5({ ...body, contentHash: hash(body) });
  const target = row(), donor = row("donor", "airline", "airline:donor");
  donor.frame.requestedObjective = donor.frame.sources["requirement:0"] = "Book a flight to SEA.";
  const targetAnnotation = await annotateCheckpoint(target, fakeModel().model);
  const donorAnnotation = { ...targetAnnotation, id: donor.id, goals: { ...targetAnnotation.goals!, revisionHash: hash("donor") } };
  const candidate = { schemaVersion: 1, id: "candidate", invocation: { tool: "get_order_details", arguments: { order_id: "#A1" }, scope: target.frame.scope },
    probability: .8, hop: 1, patternId: null, bindings: [{ sourceId: "requirement:0", path: [] }] };
  const pool = { frame: target.frame, candidates: [candidate], memory: undefined, workflows: [], poolHash: hash([candidate]) } as any;
  const predictions = rankCheckpoint(target, pool, targetAnnotation, { row: donor, annotation: donorAnnotation }, controller);
  assert.equal(predictions.length, 8);
  assert(predictions.every(item => item.decision.candidates[0]?.candidateId === "candidate"));
  assert.equal(predictions.find(item => item.ranker === "shuffled-goal")?.contextRejection, "stale_goal_revision");
  assert.equal(predictions.find(item => item.ranker === "shuffled-goal")?.decision.goalReliability, 0);
  assert.equal(predictions.find(item => item.ranker === "shuffled-feature-corruption")?.analysisOnly, true);
});

test("matched-temperature residual diagnostic changes no weights, memory, pool or primary calibration", async () => {
  const body = { version: "goalspec-controller-v5", featureVersion: V5_FEATURE_VERSION, architecture: "listwise-linear-neutral-plus-goal-residual",
    neutralWeights: Array.from({ length: V5_NEUTRAL_DIMENSION }, (_, index) => (index % 5 - 2) / 5),
    goalWeights: Array.from({ length: V5_GOAL_DIMENSION }, (_, index) => (index % 3 - 1) / 10),
    calibration: { neutralTemperature: 1, goalTemperature: .75,
      reliability: { status: "teacher-calibrated", bins: [{ upper: 1, probability: .5, count: 20 }], sourceHashes: [hash("labels")] } },
    lineage: { datasetHash: hash([]), trainingFamilies: ["train"], selectionFamilies: ["select"], calibrationFamilies: ["calibration"],
      goalTraining: "teacher-goals", excludedPriorHeldout: true, sources: [] } };
  const controller = new LocalControllerV5({ ...body, contentHash: hash(body) }), checkpoint = row();
  const annotation = await annotateCheckpoint(checkpoint, fakeModel().model);
  const candidates = ["#A1", "#B2"].map((order_id, index) => ({ schemaVersion: 1, id: `candidate-${index}`,
    invocation: { tool: "get_order_details", arguments: { order_id }, scope: checkpoint.frame.scope },
    probability: .4, hop: 1, patternId: null, bindings: [{ sourceId: "requirement:0", path: [] }] }));
  const pool = { frame: checkpoint.frame, candidates, memory: undefined, workflows: [], poolHash: hash(candidates) } as any;
  const inputSnapshot = JSON.stringify([controller.artifact, pool, annotation]);
  const predictions = rankCheckpoint(checkpoint, pool, annotation, { row: checkpoint, annotation }, controller);
  const neutral = predictions.find(item => item.ranker === "matched-temperature-neutral")!;
  const full = predictions.find(item => item.ranker === "matched-temperature-full-goal")!;
  assert.equal(neutral.appliedTemperature, .75); assert.equal(full.appliedTemperature, .75);
  assert.equal(predictions.find(item => item.ranker === "neutral-active-memory")!.appliedTemperature, 1);
  assert.equal(predictions.find(item => item.ranker === "full-goal")!.appliedTemperature, .75);
  assert.equal(full.decision.goalReliability, .5); assert.equal(neutral.decision.goalReliability, 0);
  assert.equal(neutral.contextHash, full.contextHash);
  assert.deepEqual(neutral.calibrationOverride, full.calibrationOverride);
  assert.equal(neutral.calibrationOverride!.weightsHash, hash([body.neutralWeights, body.goalWeights]));
  assert.equal(neutral.calibrationOverride!.candidatePoolHash, hash(candidates));
  assert.equal(neutral.calibrationOverride!.memoryHash, hash(null));
  assert.equal(neutral.calibrationOverride!.workflowsHash, hash([]));
  for (const variant of [neutral, full]) {
    const [a, b] = variant.decision.candidates;
    const expectedLogOdds = (a!.neutralLogit + a!.goalCorrection - b!.neutralLogit - b!.goalCorrection) / .75;
    assert.ok(Math.abs(Math.log(a!.probability / b!.probability) - expectedLogOdds) < 1e-10);
    assert.equal(variant.analysisOnly, true);
  }
  assert.equal(JSON.stringify([controller.artifact, pool, annotation]), inputSnapshot);
});
