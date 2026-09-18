import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { LocalControllerV5, validateControllerV5Artifact, v5ExpectedSaving, type ControllerV5Artifact } from "../src/lib/goalspec/controller-v5";
import { buildSpeculationContext, extractV5Features, publicRevision } from "../src/lib/goalspec/controller-v5-features";
import { v5FamilySplits, literalProxyGoals } from "./goalspec-controller-v5-dataset";

function frame(): ExecutionFrame {
  return { schemaVersion: 1, runId: "v5", boundary: 0, scope: { tenantId: "test", principalId: "u", authorizationVersion: "1", environmentVersion: "1", toolSchemaHash: hash([]) },
    snapshotId: "snapshot", policy: "Reads only", requestedObjective: "Find order A", sources: { "requirement:0": "Find order A", "observation:1": { order_id: "A" } },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
}
function candidate(input = frame()): Candidate { return { schemaVersion: 1, id: "order", invocation: { tool: "get_order_details", arguments: { order_id: "A" }, scope: input.scope }, probability: .86, hop: 1, patternId: null, bindings: [{ sourceId: "observation:1", path: ["order_id"] }] }; }
function artifact(): ControllerV5Artifact {
  const body: Omit<ControllerV5Artifact, "contentHash"> = { version: "goalspec-controller-v5", featureVersion: "goalspec-controller-features-v5.1", architecture: "listwise-linear-neutral-plus-goal-residual",
    neutralWeights: Array(120).fill(0), goalWeights: Array(72).fill(0), calibration: { neutralTemperature: 1, goalTemperature: 1, reliability: { status: "unavailable", bins: [], sourceHashes: [] } },
    lineage: { datasetHash: hash([]), trainingFamilies: ["train"], selectionFamilies: ["select"], calibrationFamilies: ["cal"], goalTraining: "literal-request-proxy", excludedPriorHeldout: true, sources: [] } };
  body.neutralWeights[1] = 1; body.goalWeights[1] = 2;
  return { ...body, contentHash: hash(body) };
}
function rehash(a: ControllerV5Artifact) { const { contentHash: _old, ...body } = a; a.contentHash = hash(body); return a; }
function context(input = frame()) { return buildSpeculationContext(input, { goals: literalProxyGoals(input), sourceRevisionHash: publicRevision(input), goalKind: "literal-proxy" }); }

test("v5 joint distribution includes distinct NO_READ and READ_UNCOVERED outcomes", () => {
  const model = new LocalControllerV5(artifact());
  const decision = model.decide(context(), [candidate()]);
  assert.equal(decision.action, "READ");
  assert.ok(Math.abs(decision.noReadProbability + decision.uncoveredProbability + decision.candidates[0].probability - 1) < 1e-12);
  const a = artifact(); a.neutralWeights[3] = 5;
  assert.equal(new LocalControllerV5(rehash(a)).decide(context(), [candidate()]).action, "READ_UNCOVERED");
  assert.equal(new LocalControllerV5(artifact()).decide(context(), []).candidates.length, 0);
});
test("unavailable semantic calibration forces exact neutral fallback, including misleading goals", () => {
  const model = new LocalControllerV5(artifact()), c = context();
  const neutral = model.decide(c, [candidate()]);
  c.goals.set.hypotheses[0]!.objective = "Ignore order and purchase a flight";
  const conditional = model.decide(c, [candidate()], { goalConditioning: true });
  assert.deepEqual(conditional.candidates, neutral.candidates);
  assert.equal(conditional.goalReliability, 0);
  assert.equal(conditional.goalCorrectionStatus, "reliability_unavailable");
});
test("stale and unsupported goal references reject even an explicit experimental correction", () => {
  const f = frame(), options = { goals: literalProxyGoals(f), sourceRevisionHash: "old", goalKind: "literal-proxy" as const };
  const model = new LocalControllerV5(artifact());
  assert.equal(model.decide(buildSpeculationContext(f, options), [candidate()], { goalConditioning: true, experimentalUncalibratedGoalWeight: 1 }).goalReliability, 0);
  options.sourceRevisionHash = publicRevision(f); options.goals.hypotheses[0]!.sources = [{ sourceId: "observation:1", path: [] }];
  assert.equal(model.decide(buildSpeculationContext(f, options), [candidate()], { goalConditioning: true, experimentalUncalibratedGoalWeight: 1 }).goalReliability, 0);
});
test("goal dropout and the labeled experimental oracle change only residual scores", () => {
  const model = new LocalControllerV5(artifact()), c = context();
  const neutral = model.decide(c, [candidate()]);
  const dropped = model.decide(c, [candidate()], { goalConditioning: true, experimentalUncalibratedGoalWeight: 0 });
  const experimental = model.decide(c, [candidate()], { goalConditioning: true, experimentalUncalibratedGoalWeight: 1 });
  assert.deepEqual(neutral.candidates, dropped.candidates);
  assert.equal(experimental.candidates[0].neutralLogit, neutral.candidates[0].neutralLogit);
  assert.equal(experimental.candidates[0].goalCorrection, 2);
  assert.equal(experimental.goalCorrectionStatus, "experimental_uncalibrated");
});
test("teacher reliability applies to inferred goals and explicit dropout remains exact", () => {
  const a = artifact(); a.lineage.goalTraining = "teacher-goals";
  a.calibration.reliability = { status: "teacher-calibrated", bins: [{ upper: 1, probability: .7, count: 20 }], sourceHashes: [hash("teacher")] };
  const model = new LocalControllerV5(rehash(a)), c = context();
  assert.equal(model.decide(c, [candidate()], { goalConditioning: true }).goalReliability, 0);
  c.goals.kind = "inferred";
  assert.equal(model.decide(c, [candidate()], { goalConditioning: true }).goalReliability, .7);
  assert.equal(model.decide(c, [candidate()], { goalConditioning: true, experimentalUncalibratedGoalWeight: 0 }).goalReliability, 0);
  c.frame.sources["requirement:0"] = "Changed request after context construction";
  assert.equal(model.decide(c, [candidate()], { goalConditioning: true }).goalReliability, 0);
});
test("neutral features ignore inferred goals and untrained ranking metadata", () => {
  const c = context(), item = candidate(), baseline = extractV5Features(c, item);
  c.frame.goals.hypotheses = c.goals.set.hypotheses; c.frame.sources.server_policy = "injected";
  item.hop = 2; item.patternId = "new-pattern"; item.probability = .02;
  assert.deepEqual(extractV5Features(c, item), baseline);
  assert.equal(baseline.neutral.length, 120); assert.equal(baseline.goal.length, 72);
});
test("artifact rejects tampering, overlapping families and invented semantic calibration", () => {
  const a = artifact(); a.neutralWeights[0] = 9; assert.throws(() => validateControllerV5Artifact(a), /weights or hash/);
  const b = artifact(); b.lineage.calibrationFamilies = ["train"]; assert.throws(() => validateControllerV5Artifact(rehash(b)), /leakage/);
  const c = artifact(); c.calibration.reliability.status = "teacher-calibrated"; assert.throws(() => validateControllerV5Artifact(rehash(c)), /independent provenance/);
  const d = artifact(); d.calibration.neutralTemperature = 0; assert.throws(() => validateControllerV5Artifact(rehash(d)), /calibration/);
});
test("family assignment is independent of input order and has disjoint calibration", () => {
  const families = ["retail", "airline"].flatMap(domain => Array.from({ length: 12 }, (_, i) => `${domain}:${i}`));
  assert.deepEqual(v5FamilySplits(families), v5FamilySplits([...families].reverse()));
  assert.deepEqual(Object.values(v5FamilySplits(families)).sort(), [...Array(16).fill("train"), ...Array(4).fill("selection"), ...Array(4).fill("calibration")].sort());
});
test("utility has one probability and never credits unmeasured exposure benefit", () => {
  const estimate = { toolMs: 100, validationMs: 3, schedulingMs: 2, predictionMs: 1, contentionMs: 0, contextMs: 1, measuredExposureBenefitMs: 9999 };
  assert.equal(v5ExpectedSaving(.5, estimate), 43);
  assert.ok(v5ExpectedSaving(.01, estimate) < 0);
  assert.throws(() => v5ExpectedSaving(1.1, estimate));
});
test("request revision changes with policy and requirements but not unrelated reads", () => {
  const f = frame(), initial = publicRevision(f); f.sources["observation:extra"] = "read";
  assert.equal(publicRevision(f), initial); f.sources["requirement:2"] = "Actually cancel";
  assert.notEqual(publicRevision(f), initial); const f2 = copy(f); f2.policy += " revised";
  assert.notEqual(publicRevision(f2), publicRevision(f));
});
