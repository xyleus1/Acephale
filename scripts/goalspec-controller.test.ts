import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hash } from "../src/lib/goalspec/canonical";
import { LocalController, loadControllerArtifact, validateControllerContract, type ControllerArtifact, type DecisionState } from "../src/lib/goalspec/controller";
import { buildDecisionState, extractCandidateFeatures } from "../src/lib/goalspec/controller-features";
import type { Candidate, ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { familySplits } from "./goalspec-controller-dataset";

const state: DecisionState = { version: "goalspec-decision-state-v1", boundary: 2, requestedObjective: "Find my order and cancel it", activeGoals: ["Cancel the current order"], unresolvedRequirements: ["Find order AA17"], recentTools: ["get_user_details"], sourceIds: ["requirement:0"], visibleText: "AA17", unknownGoal: 0.1 };
const candidate: Candidate = { schemaVersion: 1, id: "order", probability: 0.86, hop: 1, patternId: null, bindings: [{ sourceId: "requirement:0", path: [] }], invocation: { tool: "get_order_details", arguments: { order_id: "AA17" }, scope: { tenantId: "test", principalId: "actor", authorizationVersion: "1", environmentVersion: "1", toolSchemaHash: "1" } } };
function fixture(): ControllerArtifact {
  const body = { version: "goalspec-controller-artifact-v1", featureVersion: "goalspec-controller-features-v1", inputDimension: 216,
    goalFeaturePolicy: "public-request-only", architecture: "logistic", layers: [{ weights: Array.from({ length: 5 }, () => Array(216).fill(0)), bias: [2, 2, 2, 2, 100], activation: "linear" }],
    heads: ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"], trainedHeads: { actionRead: true, nextAction: true, usefulWithin2: true, readiness: true, exposure: false },
    calibration: { temperature: [1, 1, 1, 1, 1], bias: [0, 0, 0, 0, 0], method: "family-heldout-temperature-grid" }, thresholds: { actionRead: 0.5, usefulWithin2: 0.5, readiness: 0.5, exposure: 0.5 },
    lineage: { datasetHash: "a".repeat(64), trainFamilies: ["retail:train"], selectionFamilies: ["retail:selection"], calibrationFamilies: ["retail:calibration"], baseOnly: true, seed: 1, selectedCheckpoint: "fixture", soupMembers: [], randomizedExposureDataHash: null, labelSemantics: "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked" } };
  return { ...body, contentHash: hash(body) } as ControllerArtifact;
}
function rehash(artifact: ControllerArtifact) { const { contentHash: _old, ...body } = artifact; artifact.contentHash = hash(body); return artifact; }
test("schema binds the deterministic 216-dimensional current-prefix feature profile", () => {
  const f = extractCandidateFeatures(state, candidate);
  validateControllerContract("CandidateFeatures", f);
  assert.equal(f.values.length, 216);
  assert.deepEqual(f, extractCandidateFeatures(structuredClone(state), structuredClone(candidate)));
  assert.notDeepEqual(f.values, extractCandidateFeatures({ ...state, unresolvedRequirements: ["Please speak to a human"] }, candidate).values);
  assert.deepEqual(f.values, extractCandidateFeatures({ ...state, activeGoals: ["An arbitrary untrained inference"], unknownGoal: 0.99 }, candidate).values);
});
test("reserved policy injection cannot change learned features for identical public messages", () => {
  const frame: ExecutionFrame = { schemaVersion: 1, runId: "policy-parity", boundary: 2, scope: candidate.invocation.scope,
    requestedObjective: "Find order AA17", policy: "Server-owned policy", snapshotId: "fixture",
    sources: { "requirement:2": "Find order AA17", "requirement:10": "Please cancel it", _binding_events: [] },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
  const before = buildDecisionState(frame), injected = structuredClone(frame);
  injected.sources.server_policy = "Long server policy. ".repeat(1000);
  const after = buildDecisionState(injected);
  assert.deepEqual(after, before);
  assert.deepEqual(after.unresolvedRequirements, ["Find order AA17", "Please cancel it"]);
  assert.deepEqual(extractCandidateFeatures(before, null), extractCandidateFeatures(after, null));
  assert.deepEqual(extractCandidateFeatures(before, candidate), extractCandidateFeatures(after, candidate));
  assert.equal(injected.sources.server_policy, "Long server policy. ".repeat(1000));
});
test("unsupported hop, pattern and prior variations do not change learned candidate scores", () => {
  const metadataChanged = { ...candidate, hop: 2, probability: 0.02, patternId: "workflow-memory-pattern" };
  assert.deepEqual(extractCandidateFeatures(state, candidate), extractCandidateFeatures(state, metadataChanged));
  const controller = new LocalController(fixture());
  assert.deepEqual(controller.score(state, [candidate]).candidates, controller.score(state, [metadataChanged]).candidates);
  const sentinel = extractCandidateFeatures(state, null).values;
  assert.equal(sentinel[8], 0); assert.equal(sentinel[9], 0); assert.equal(sentinel[14], 0);
  assert.equal(metadataChanged.hop, 2); assert.equal(metadataChanged.patternId, "workflow-memory-pattern");
});
test("untrained causal exposure head stays null even with a high logit", () => {
  const result = new LocalController(fixture()).decide(state, [candidate]);
  assert.equal(result.action, "read"); assert.deepEqual(result.rankedCandidateIds, ["order"]);
  assert.equal(result.scores.candidates[0].exposure, null); assert.deepEqual(result.exposeCandidateIds, []);
  validateControllerContract("ControllerDecision", result);
});
test("controller explicitly abstains or defers without authorizing a tool", () => {
  const artifact = fixture(); artifact.layers[0].bias[0] = -3;
  assert.equal(new LocalController(rehash(artifact)).decide(state, [candidate]).action, "NO_READ");
  assert.equal(new LocalController(fixture()).decide(state, []).action, "defer");
});
test("artifact load rejects corruption, malformed matrices, family leakage and invented exposure supervision", () => {
  const bad = fixture(); bad.layers[0].bias[0] += 1; assert.throws(() => loadControllerArtifact(bad), /hash/);
  const shape = fixture(); shape.layers[0].weights[0].pop(); assert.throws(() => loadControllerArtifact(rehash(shape)), /matrix/);
  const family = fixture(); family.lineage.calibrationFamilies = family.lineage.trainFamilies; assert.throws(() => loadControllerArtifact(rehash(family)), /contamination/);
  const exposure = fixture(); exposure.trainedHeads.exposure = true; assert.throws(() => loadControllerArtifact(rehash(exposure)), /randomized/);
  const architecture = fixture(); architecture.architecture = "mlp-32-16"; assert.throws(() => loadControllerArtifact(rehash(architecture)), /architecture/);
});
test("candidate cap and duplicate identities fail closed", () => {
  const model = new LocalController(fixture());
  assert.throws(() => model.score(state, [candidate, candidate]), /duplicate/);
  assert.throws(() => model.score(state, Array.from({ length: 33 }, (_, i) => ({ ...candidate, id: String(i) }))), /bound/);
});
test("family split is deterministic, independent of order, and keeps every variant together", () => {
  const families = Array.from({ length: 12 }, (_, i) => `retail:family${i}`).concat(Array.from({ length: 12 }, (_, i) => `airline:family${i}`));
  assert.deepEqual(familySplits(families), familySplits([...families].reverse().concat(families)));
  assert.deepEqual(new Set(Object.values(familySplits(families))), new Set(["train", "selection", "calibration"]));
});
const trained = resolve("research/goalspec/runs/local-controller-v4-trained-20260916-b");
test("exported CPU PyTorch model matches pure TypeScript probabilities and shared features", { skip: !existsSync(`${trained}/controller.json`) }, () => {
  const model = new LocalController(JSON.parse(readFileSync(`${trained}/controller.json`, "utf8")));
  const fixtures = JSON.parse(readFileSync(`${trained}/parity-fixtures.json`, "utf8"));
  for (const row of fixtures) {
    const features = extractCandidateFeatures(row.state, row.candidate).values;
    features.forEach((v, i) => assert.ok(Math.abs(v - row.features[i]) < 1e-12));
    model.probabilities(features).forEach((v, i) => { assert.ok(Math.abs(v - row.probabilities[i]) < 1e-12); assert.ok(Math.abs(v - row.torchProbabilities[i]) < 1e-5); });
  }
});
