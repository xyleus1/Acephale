import assert from "node:assert/strict";
import { test } from "node:test";
import { annotateRequested, gradeRequested, predictCheckpoint, validateRequestedAnnotation,
  type ReplayCheckpoint, type PredictionRecord, type AnnotationRecord } from "../services/goalspec-runtime/prediction-replay";
import { hash } from "../src/lib/goalspec/canonical";
import type { ModelPort, ModelRequest } from "../src/lib/goalspec/model";
import type { GoalSet } from "../src/lib/goalspec/contracts/generated";

const visible = { policy: "Require confirmation before modifying orders.", sources: { "request:0": "Please cancel my pending order, leaving the other order unchanged." } };
const row: ReplayCheckpoint = { schemaVersion: "1.0.0", id: "checkpoint", trajectory_id: "episode", through_seq: 0,
  familyId: "retail:cancel", taskId: "task", domain: "retail", trial: 0, visible_input_hash: hash({}), requested_input_hash: hash(visible), requested_input: visible,
  pattern_goal_catalog: [{ goal_id: "training-cancel", objective: "cancel_pending_order", object_type: "retail", completion: ["endpoint from successful training"], constraints: [] }], catalog_hash: hash([]) };
const goals = { schemaVersion: 1 as const, hypotheses: [{ id: "cancel", objective: "Cancel the pending order and preserve the other order", probability: .9,
  sources: [{ sourceId: "request:0", path: [] as [] }], constraints: [{ text: "Leave other order unchanged", sources: [{ sourceId: "request:0", path: [] as [] }] }] }], unknown: .1, revisionHash: hash({}) } satisfies GoalSet;
const annotation = { unknown: false, objective: "Cancel only the pending order", evidence: [{ sourceId: "request:0", quote: "cancel my pending order" }],
  requirements: [{ text: "Preserve other order", sourceId: "request:0", quote: "leaving the other order unchanged" }] };
function model(response: unknown, inspect: (request: ModelRequest) => void = () => {}): ModelPort {
  return { complete: async request => { inspect(request); return { model: request.model, text: JSON.stringify(response), continuation: [], calls: [], status: "completed", refusals: [], usage: undefined }; } };
}

test("replay predictor pins mini, preserves source-grounded goals and separate training-category posterior", async () => {
  const compact = { hypotheses: [{ objective: goals.hypotheses[0].objective, weight: 9, sourceIds: ["s0"],
    constraints: [{ text: "Leave other order unchanged", sourceIds: ["s0"] }] }], unknownWeight: 1,
    catalogWeights: [{ id: "g0", weight: 8 }], catalogUnknownWeight: 2 };
  const result = await predictCheckpoint(row, model(compact, request => {
    assert.equal(request.model, "gpt-4.1-mini-2025-04-14");
    assert.equal(request.allocation, "replay");
    assert.equal(request.maxOutputTokens, 1024);
    assert.equal(request.retries, 0);
    assert.equal(request.responseFormat?.strict, true);
    assert.equal(request.responseFormat?.name, "compact_goals_v2");
    assert(!JSON.stringify(request.input).includes("revisionHash"));
    assert(!JSON.stringify(request.input).includes("training-cancel"));
  }));
  assert.equal(result.frozen.visible_input_hash, row.visible_input_hash);
  assert.equal(result.requested.requested_input_hash, row.requested_input_hash);
  assert.equal(result.requested.requested_goals.hypotheses[0]?.sources[0].sourceId, "request:0");
  assert.deepEqual(result.frozen.posterior.probabilities, { "training-cancel": .8, __unknown__: .2 });
  await assert.rejects(() => predictCheckpoint(row, model({ ...compact, catalogWeights: [{ id: "unseen-catalog-id", weight: 1 }] })), /response_schema:enum/);
});

test("teacher annotation receives only visible user messages and policy, with exact quoted provenance", async () => {
  const result = await annotateRequested(row, model(annotation, request => {
    assert.equal(request.model, "gpt-5.4-2026-03-05");
    assert.equal(request.allocation, "preparation");
    const input = JSON.stringify(request.input);
    assert(!input.includes("training-cancel"));
    assert(!input.includes("endpoint from successful training"));
    assert(!input.includes("episode"));
    assert(input.includes("cancel my pending order"));
  }));
  assert.equal(result.annotation?.requirements.length, 1);
  assert.throws(() => validateRequestedAnnotation({ ...annotation, evidence: [{ sourceId: "private", quote: "invisible" }] }, visible.sources), /not visible/);
  assert.throws(() => validateRequestedAnnotation({ ...annotation, evidence: [{ sourceId: "request:0", quote: "refund was completed" }] }, visible.sources), /not visible/);
});

test("requested matching retains unknown rank, counts prediction failures as misses and hashes references", async () => {
  const prediction: PredictionRecord = { id: row.id, requested_input_hash: row.requested_input_hash, model: "gpt-4.1-mini-2025-04-14", status: "completed", requested_goals: goals };
  const reference: AnnotationRecord = { requested_input_hash: row.requested_input_hash, status: "completed", annotation, model: "gpt-5.4-2026-03-05" };
  const result = await gradeRequested(row, prediction, reference, model({ matches: [true, true] }));
  assert.deepEqual(result.matches, [true, false]);
  assert.equal(result.prediction_hash, hash(prediction));
  assert.equal(result.annotation_hash, hash(reference));
  const failed = await gradeRequested(row, { ...prediction, status: "failed" }, reference, { complete: async () => { throw new Error("No grading request for a known failed prediction"); } });
  assert.deepEqual(failed.matches, [false]);
});
