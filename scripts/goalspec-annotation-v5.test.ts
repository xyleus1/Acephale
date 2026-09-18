import assert from "node:assert/strict";
import { test } from "node:test";
import { annotateRow, annotationContext, agreementLabel, selectAnnotationInputs, validateAnnotation,
  type AnnotationInput, type AtomicAnnotation, type AtomicAgreement } from "./goalspec-annotation-v5";
import { hash } from "../src/lib/goalspec/canonical";
import { buildSpeculationContext } from "../src/lib/goalspec/controller-v5-features";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest } from "../src/lib/goalspec/model";

function input(familyId = "retail:train-a", boundary = 0, split = "train"): AnnotationInput {
  const frame: ExecutionFrame = { schemaVersion: 1, runId: `run-${familyId}`, boundary, snapshotId: "train-snapshot",
    scope: { tenantId: "retail", principalId: "actor", authorizationVersion: "v1", environmentVersion: "v1", toolSchemaHash: "tools" },
    requestedObjective: "Return order #123 to original Visa.", policy: "Request confirmation before writes.",
    sources: { "requirement:0": "Return order #123 to original Visa." },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
  const context = buildSpeculationContext(frame);
  return { groupId: hash([frame.runId, boundary]), familyId, split, runId: frame.runId, cohort: "local-training-fixture", boundary,
    prefixHash: hash([boundary]), frameHash: hash(frame), originalSnapshotId: frame.snapshotId, frame,
    publicInputHash: context.publicInputHash, sourceRevisionHash: context.requestRevisionHash, annotationPolicy: "public requested-only" };
}
const manifest = (rows: AnnotationInput[]) => ({ version: "goalspec-controller-dataset-v5",
  sourcePolicy: "prior-v4-train-families-only-no-confirmation-cohorts", splits: Object.fromEntries(rows.map(row => [row.familyId, row.split])), sources: [], codeSources: [] });
const annotation: AtomicAnnotation = { requestedGoal: "Return #123 to original Visa", ambiguous: false,
  atoms: [{ id: "a0", kind: "objective", status: "active", text: "Return order #123 to original Visa", spanIds: ["s0p0"] }] };
const agreement: AtomicAgreement = { goalMatches: true, ambiguous: false, unsupportedPrediction: false, stalePrediction: false,
  atoms: [{ id: "a0", covered: true, contradicted: false }], reason: "Explicit requested order and refund method are represented." };

test("family stratification and internal reliability split precede labels and exclude selection/calibration", () => {
  const rows = ["retail:a", "retail:b", "airline:c", "airline:d"].flatMap(family => Array.from({ length: 3 }, (_, i) => input(family, i)));
  rows.push(input("retail:selection", 0, "selection"), input("airline:calibration", 0, "calibration"));
  const selected = selectAnnotationInputs(rows, manifest(rows), 8);
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map(row => row.familyId)).size, 4);
  assert(selected.every(row => row.split === "train"));
  assert.equal(new Set(selected.filter(row => row.reliabilitySplit === "calibration").map(row => row.familyId)).size, 2);
  assert.deepEqual(selectAnnotationInputs([...rows].reverse(), manifest(rows), 8), selected);
  assert.throws(() => selectAnnotationInputs(rows, manifest(rows), 13), /Insufficient/);
});

test("future cohort, duplicate, source-revision and family-split changes fail closed", () => {
  const row = input();
  assert.throws(() => selectAnnotationInputs([{ ...row, cohort: "confirmation" }], manifest([row]), 1), /Confirmation/);
  assert.throws(() => selectAnnotationInputs([row, row], manifest([row]), 1), /Duplicate/);
  assert.throws(() => selectAnnotationInputs([{ ...row, sourceRevisionHash: hash("other") }], manifest([row]), 1), /identity/);
  assert.throws(() => selectAnnotationInputs([{ ...row, split: "train" }], { ...manifest([row]), splits: { [row.familyId]: "selection" } }, 1), /split/);
});

test("blind annotation context excludes actual actions, prior predicted goals and private state", () => {
  const row = input(), context = annotationContext(row);
  assert(!JSON.stringify(context.payload).includes("groupId"));
  assert(!JSON.stringify(context.payload).includes("initialDatabase"));
  assert.equal(context.spans.spans[0].quote, row.frame.sources["requirement:0"]);
  validateAnnotation(annotation, context.spans.spans.map(span => span.id));
  assert.throws(() => validateAnnotation({ ...annotation, atoms: [{ ...annotation.atoms[0], spanIds: ["future"] }] }, ["s0p0"]), /Invalid/);
  assert.throws(() => validateAnnotation({ ...annotation, atoms: [annotation.atoms[0], annotation.atoms[0]] }, ["s0p0"]), /Invalid/);
});

test("agreement requires all atoms and treats uncertainty as conservative nonagreement", () => {
  assert.equal(agreementLabel(annotation, agreement), 1);
  assert.equal(agreementLabel(annotation, { ...agreement, ambiguous: true }), 0);
  assert.equal(agreementLabel(annotation, { ...agreement, stalePrediction: true }), 0);
  assert.equal(agreementLabel(annotation, { ...agreement, atoms: [{ id: "a0", covered: false, contradicted: false }] }), 0);
  assert.throws(() => agreementLabel(annotation, { ...agreement, atoms: [] }), /every annotation/);
  assert.throws(() => agreementLabel(annotation, { ...agreement, atoms: [agreement.atoms[0], agreement.atoms[0]] }), /every annotation/);
});

test("mocked pilot blinds teacher before prediction then grades top1 under exact caps", async () => {
  const requests: ModelRequest[] = [];
  const model: ModelPort = { async complete(request) {
    requests.push(request);
    const reply = request.id.endsWith(":blind") ? annotation : request.id.endsWith(":agreement") ? agreement : {
      set_active_goals: [{ objective: annotation.requestedGoal, weight: 1, spanIds: ["s0p0"], constraints: [] }], unknownWeight: 0, factDeltas: [] };
    return { model: request.model, continuation: [], calls: [], text: JSON.stringify(reply), status: "completed", refusals: [], usage: undefined };
  } };
  const result = await annotateRow({ ...input(), reliabilitySplit: "train" }, model);
  assert.equal(result.agreement.label, 1);
  assert.equal(result.annotation.blindedToPrediction, true);
  assert.deepEqual(requests.map(request => request.model), [RESEARCH_MODELS.teacher, RESEARCH_MODELS.goal, RESEARCH_MODELS.teacher]);
  assert.deepEqual(requests.map(request => request.maxOutputTokens), [4096, 1024, 4096]);
  assert(requests.every(request => request.retries === 0 && request.allocation === "preparation"));
  assert(!JSON.stringify(requests[0].input).includes("candidate"));
  assert(JSON.stringify(requests[2].input).includes("candidate"));
});

test("failed predictions retain checkpoint and blind annotation with missing agreement masked", async () => {
  let calls = 0;
  const model: ModelPort = { async complete(request) {
    calls++;
    if (request.model === RESEARCH_MODELS.goal) throw new Error("Simulated provider failure");
    return { model: request.model, continuation: [], calls: [], text: JSON.stringify(annotation), status: "completed", refusals: [], usage: undefined };
  } };
  const row = input(), result = await annotateRow({ ...row, reliabilitySplit: "calibration" }, model);
  assert.equal(calls, 2); assert.equal(result.groupId, row.groupId); assert.equal(result.prediction.status, "failed");
  assert.equal(result.annotation.status, "completed"); assert.equal(result.agreement.status, "unavailable"); assert.equal(result.agreement.label, null);
});
