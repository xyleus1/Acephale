import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/lib/goalspec/canonical";
import { buildSpeculationContext } from "../src/lib/goalspec/controller-v5-features";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { joinV5TeacherRow, verifyV5TeacherContinuation, verifyV5TeacherHistory } from "./goalspec-controller-v5-teacher-join";
function fixture() {
  const frame: ExecutionFrame = { schemaVersion: 1, runId: "source", boundary: 0, scope: { tenantId: "a", principalId: "u", authorizationVersion: "1", environmentVersion: "1", toolSchemaHash: hash([]) },
    snapshotId: "frozen", policy: "Read only", requestedObjective: "Read A", sources: { "requirement:0": "Read A", "observation:1": { id: "A" } },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
  const context = buildSpeculationContext(frame), source = { groupId: hash("group"), familyId: "retail:train", split: "train", runId: "source",
    boundary: 0, cohort: "local-training", frameHash: hash(frame), prefixHash: hash("prefix"), context, candidates: [], targets: [0], actual: [], actualRead: false };
  const annotation: any = { ...source, sourceRevisionHash: context.requestRevisionHash, publicInputHash: context.publicInputHash, reliabilitySplit: "train",
    goals: { schemaVersion: 1, hypotheses: [{ id: "goal", objective: "Read A", probability: .8, sources: [{ sourceId: "requirement:0", path: [] }], constraints: [] }], unknown: .2, revisionHash: hash("goal") },
    prediction: { status: "completed", model: "gpt-4.1-mini-2025-04-14" },
    annotation: { status: "completed", teacherModel: "gpt-5.4-2026-03-05", publicInputHash: context.publicInputHash,
      futureInformation: false, requestedGoalOnly: true, blindedToPrediction: true },
    agreement: { status: "completed", label: 1, independentTeacherModel: "gpt-5.4-2026-03-05", publicInputHash: context.publicInputHash } };
  const declaration = { groupId: source.groupId, familyId: source.familyId, frameHash: source.frameHash, prefixHash: source.prefixHash,
    publicInputHash: context.publicInputHash, reliabilitySplit: "train" };
  return { source, annotation, declaration };
}
test("teacher join binds exact current public prefixes and retains independent disagreement labels", () => {
  const f = fixture(), joined = joinV5TeacherRow(f.source, f.annotation, f.declaration)!;
  assert.equal(joined.goalAgreement, 1); assert.equal(joined.context.goals.kind, "inferred");
  assert.equal(joined.features[0].neutral.length, 120); assert.equal(joined.features[0].goal.length, 72);
  f.annotation.agreement.label = 0; assert.equal(joinV5TeacherRow(f.source, f.annotation, f.declaration)!.goalAgreement, 0);
});
test("missing annotations and explicit unknown goals remain masked", () => {
  const f = fixture(); f.annotation.agreement.status = "failed"; f.annotation.agreement.label = null;
  assert.equal(joinV5TeacherRow(f.source, f.annotation, f.declaration), null);
  f.annotation.agreement.status = "completed"; f.annotation.agreement.label = 0; f.annotation.goals = f.source.context.frame.goals;
  assert.equal(joinV5TeacherRow(f.source, f.annotation, f.declaration), null);
});
test("teacher join rejects heldout/future/source mismatch instead of silently excluding it", () => {
  for (const defect of ["family", "future", "hash", "scope"]) {
    const f = fixture();
    if (defect === "family") f.source.split = "calibration";
    if (defect === "future") f.annotation.annotation.futureInformation = true;
    if (defect === "hash") f.annotation.publicInputHash = hash("other");
    if (defect === "scope") f.annotation.goals.hypotheses[0].sources = [{ sourceId: "observation:1", path: [] }];
    assert.throws(() => joinV5TeacherRow(f.source, f.annotation, f.declaration), /permitted|provenance|revision|source-grounded/);
  }
});

function continuationFixture() {
  const first = fixture(), second = fixture();
  second.annotation.groupId = hash("second group"); second.declaration.groupId = second.annotation.groupId;
  const complete = JSON.parse(JSON.stringify(second.annotation));
  second.annotation.goals = null; second.annotation.prediction.status = "failed";
  second.annotation.annotation.status = "failed"; second.annotation.annotation.value = null;
  second.annotation.agreement.status = "failed"; second.annotation.agreement.label = null;
  const body = { sequence: 0, previousHash: "0".repeat(64), event: { type: "model_attempt", id: `v5-annotation:${first.annotation.groupId}:prediction`, costMicrodollars: 5 } };
  const events = [{ body, hash: hash(body) }], version = "goalspec-v5-never-dispatched-annotation-continuation-v1";
  const plan = { version, originalCount: 2, originalPlanSha256: hash("original plan"),
    continuation: [{ ordinal: 1, groupId: second.annotation.groupId }], retainedAttemptedOrdinals: [0],
    audit: { finalHash: events[0].hash, events: 1, knownCostMicrodollars: 5, attemptedGroupIds: [first.annotation.groupId] } };
  const summary = { version, historyPreserved: true, originalPlanSha256: plan.originalPlanSha256, retained: 2,
    resumed: 1, originalAttemptedRowsRetained: 1, originallyNeverDispatched: 1 };
  return { plan, summary, originalPlan: { selected: [first.declaration, second.declaration] }, prior: [first.annotation, second.annotation],
    resumed: [complete], combined: [JSON.parse(JSON.stringify(first.annotation)), complete], events };
}
test("teacher continuation keeps previously attempted rows and accepts only never-dispatched replacements", () => {
  const f = continuationFixture();
  assert.doesNotThrow(() => verifyV5TeacherContinuation(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.events));
  f.combined[0].agreement.label = 0;
  assert.throws(() => verifyV5TeacherContinuation(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.events), /attempted annotation row changed/);
});
test("teacher continuation rejects altered event history and incomplete ordinal coverage", () => {
  for (const defect of ["chain", "coverage", "attempted", "identity"]) {
    const f = continuationFixture();
    if (defect === "chain") f.events[0].body.event.costMicrodollars = 6;
    if (defect === "coverage") f.plan.continuation[0].ordinal = 0;
    if (defect === "attempted") f.plan.audit.attemptedGroupIds.push(f.prior[1].groupId);
    if (defect === "identity") f.combined[1].frameHash = hash("changed frame");
    assert.throws(() => verifyV5TeacherContinuation(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.events), /chain mismatch|attempt audit mismatch|checkpoint identity|attempted annotation row changed/);
  }
});

function historyFixture() {
  const f = continuationFixture(), third = fixture();
  third.annotation.groupId = hash("third group"); third.declaration.groupId = third.annotation.groupId;
  const thirdComplete = JSON.parse(JSON.stringify(third.annotation));
  third.annotation.goals = null; third.annotation.prediction.status = "failed";
  third.annotation.annotation.status = "failed"; third.annotation.annotation.value = null;
  third.annotation.agreement.status = "failed"; third.annotation.agreement.label = null;
  const originalPlan = { version: "goalspec-train-annotation-v5", selected: [...f.originalPlan.selected, third.declaration] };
  const initial = [...f.prior, third.annotation], middle = [f.prior[0], JSON.parse(JSON.stringify(f.resumed[0])), third.annotation];
  middle[1].agreement.status = "failed"; middle[1].agreement.label = null;
  const failedBody = { sequence: 0, previousHash: "0".repeat(64), event: { type: "model_attempt_failed",
    id: `v5-annotation:${middle[1].groupId}:agreement`, model: "gpt-5.4-2026-03-05", reservationRetained: true } };
  const failedEvents = [{ body: failedBody, hash: hash(failedBody) }];
  const unknown = [{ id: failedBody.event.id, model: failedBody.event.model, maximumMicrodollars: 81920 }];
  const firstAudit = { ...f.plan.audit, physicalRequestIds: [f.events[0].body.event.id], uncertainRequests: [], unknownMaximumMicrodollars: 0 };
  const secondAudit = { finalHash: failedEvents[0].hash, events: 1, attemptedGroupIds: [middle[1].groupId], knownCostMicrodollars: 0,
    physicalRequestIds: [failedBody.event.id], uncertainRequests: unknown, unknownMaximumMicrodollars: 81920 };
  const middlePlan = { ...f.plan, original: "/history/original", originalCount: 3, continuation: [{ ordinal: 1, groupId: middle[1].groupId }, { ordinal: 2, groupId: third.annotation.groupId }] };
  const middleSummary = { ...f.summary, retained: 3, resumed: 2, originallyNeverDispatched: 2 };
  const plan = { ...f.plan, version: "goalspec-v5-never-dispatched-annotation-continuation-v2", original: "/history/original", previousDirectory: "/history/middle", originalCount: 3,
    continuation: [{ ordinal: 2, groupId: third.annotation.groupId }], retainedAttemptedOrdinals: [0, 1],
    history: [{ directory: "/history/original", audit: firstAudit }, { directory: "/history/middle", audit: secondAudit }],
    audit: { attemptedGroupIds: [middle[0].groupId, middle[1].groupId], physicalRequests: 2, knownCostMicrodollars: 5,
      uncertainRequests: unknown, unknownMaximumMicrodollars: 81920 } };
  const summary = { ...f.summary, version: plan.version, retained: 3, originalAttemptedRowsRetained: 2 };
  const stages = [{ directory: "/history/original", plan: originalPlan, summary: {}, annotations: initial, events: f.events, resumed: [] },
    { directory: "/history/middle", plan: middlePlan, summary: middleSummary, annotations: middle, events: failedEvents, resumed: middle.slice(1) }];
  return { plan, summary, originalPlan, stages, prior: middle, combined: [...middle.slice(0, 2), thirdComplete], resumed: [thirdComplete] };
}
test("chained teacher continuations preserve an uncertain attempted agreement and union all historical attempts", () => {
  const f = historyFixture();
  assert.doesNotThrow(() => verifyV5TeacherHistory(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.stages));
  assert.equal(f.combined[1].agreement.label, null);
  f.combined[1] = { ...f.combined[1], agreement: { ...f.combined[1].agreement, status: "completed", label: 1 } };
  assert.throws(() => verifyV5TeacherHistory(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.stages), /attempted annotation row changed/);
});
test("chained teacher continuations reject duplicate history, altered unknown attempts and lost rows", () => {
  for (const defect of ["history", "unknown", "attempt", "lost"]) {
    const f = historyFixture();
    if (defect === "history") f.stages[1].directory = f.stages[0].directory;
    if (defect === "unknown") f.plan.audit.unknownMaximumMicrodollars = 0;
    if (defect === "attempt") f.plan.audit.attemptedGroupIds.pop();
    if (defect === "lost") f.stages[1].annotations = f.stages[1].annotations.slice(1);
    assert.throws(() => verifyV5TeacherHistory(f.plan, f.summary, f.originalPlan, f.combined, f.prior, f.resumed, f.stages), /history|audit mismatch|denominator/);
  }
});
