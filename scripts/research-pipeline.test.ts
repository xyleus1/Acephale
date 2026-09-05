import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  derivePipeline,
  pipelineReplyReceivedAt,
  selectPipelineOperations,
  type PipelineRow,
} from "@/lib/research-pipeline";
import { researchRecordStageWhere } from "@/lib/research-record-stages";

const rows: PipelineRow[] = Array.from({ length: 11 }, (_, index) => ({
  id: String(index + 1),
  data: {
    country: ["TR", "TR", "DE", "DE", "US", "NL", "PL", "FR", "IT", "ES", "SE"][index],
    fit_verdict: index < 6 ? "target" : index < 9 ? "not_target" : "unknown",
    email: index < 8 ? `person${index}@example.com` : null,
    phone: index < 5 ? "+90 555 123 4567" : null,
    email_verdict: index < 3 ? "deliverable_likely" : "unknown",
  },
}));

const result = derivePipeline(
  rows,
  new Set(["1", "2", "3"]),
  new Set(["1", "2"]),
  new Set(["1"]),
  new Set(["2"]),
  [{
    status: "RUNNING",
    exhausted: false,
    autoContinue: true,
    rowsCreated: 10,
    rowTarget: 100,
    lastBackgroundRunAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    rejectedBeforePersist: 4,
  }],
);

assert.equal(result.funnel.found, 11);
assert.equal(result.funnel.target, 6);
assert.equal(result.funnel.notTarget, 3);
assert.equal(result.funnel.unscreened, 2);
assert.equal(result.funnel.withEmail, 8);
assert.equal(result.funnel.deliverable, 3);
assert.equal(result.funnel.withPhone, 5);
assert.equal(result.funnel.sent, 3);
assert.equal(result.funnel.replied, 2);
assert.equal(result.funnel.positive, 1);
assert.equal(result.funnel.bounced, 1);
assert.deepEqual(result.sources.slice(0, 2), [{ label: "DE", rows: 2 }, { label: "TR", rows: 2 }]);
assert.ok(result.sources.some((source) => source.label === "Other"));
assert.equal(result.live.target, 100);
assert.equal(result.live.activeJobs, 1);
assert.equal(result.live.lastBatchAt, "2026-01-01T00:00:00.000Z");
assert.equal(result.live.rejectedBeforePersist, 4);
assert.ok(result.sankey.links.every((link) => link.value > 0));
const linkedNodes = new Set(result.sankey.links.flatMap((link) => [link.source, link.target]));
assert.ok(result.sankey.nodes.every((_, index) => linkedNodes.has(index)));
assert.equal(result.actions.unscreened, 2);
assert.equal(result.replies.length, 0);

const replyResult = derivePipeline(rows, new Set(), new Set(), new Set(), new Set(), [], {
  replies: [{
    recordId: "1",
    company: "Example",
    receivedAt: "2026-01-01T00:00:00.000Z",
    bodyText: "  Hello\nthere  ",
    positive: true,
  }, {
    recordId: "2",
    company: "Later",
    receivedAt: "2026-01-02T00:00:00.000Z",
    bodyText: "Later reply",
    positive: false,
  }],
  actionInput: { purgeable: { duplicate: 2, non_company: 1, not_target: 3, below_floor: 4 } },
});
assert.deepEqual(replyResult.replies[0], {
  recordId: "2",
  company: "Later",
  receivedAt: "2026-01-02T00:00:00.000Z",
  snippet: "Later reply",
  positive: false,
});
assert.deepEqual(replyResult.replies[1], {
  recordId: "1",
  company: "Example",
  receivedAt: "2026-01-01T00:00:00.000Z",
  snippet: "Hello there",
  positive: true,
});
assert.deepEqual(replyResult.actions.purgeable, {
  duplicates: 2,
  nonCompanies: 1,
  notTarget: 3,
  belowFloor: 4,
});
const states = [
  { status: "PENDING" as const, autoContinue: false, exhausted: false, rowsCreated: 0, active: 1, paused: 0, finished: 0 },
  { status: "RUNNING" as const, autoContinue: false, exhausted: false, rowsCreated: 0, active: 1, paused: 0, finished: 0 },
  { status: "COMPLETED" as const, autoContinue: true, exhausted: false, rowsCreated: 1, active: 1, paused: 0, finished: 0 },
  { status: "FAILED" as const, autoContinue: true, exhausted: false, rowsCreated: 1, active: 1, paused: 0, finished: 0 },
  { status: "COMPLETED" as const, autoContinue: false, exhausted: false, rowsCreated: 1, active: 0, paused: 1, finished: 0 },
  { status: "FAILED" as const, autoContinue: false, exhausted: false, rowsCreated: 1, active: 0, paused: 1, finished: 0 },
  { status: "COMPLETED" as const, autoContinue: true, exhausted: true, rowsCreated: 1, active: 0, paused: 0, finished: 1 },
  { status: "COMPLETED" as const, autoContinue: true, exhausted: false, rowsCreated: 10, active: 0, paused: 0, finished: 1 },
  { status: "DISMISSED" as const, autoContinue: true, exhausted: false, rowsCreated: 0, active: 0, paused: 0, finished: 0 },
];
for (const state of states) {
  const stateResult = derivePipeline(rows, new Set(), new Set(), new Set(), new Set(), [{
    ...state,
    rowTarget: 10,
    lastBackgroundRunAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    rejectedBeforePersist: 0,
  }]);
  assert.equal(stateResult.live.activeJobs, state.active, state.status);
  assert.equal(stateResult.live.pausedJobs, state.paused, state.status);
  assert.equal(stateResult.live.finishedJobs, state.finished, state.status);
}
assert.deepEqual(researchRecordStageWhere("target"), { data: { path: ["fit_verdict"], equals: "target" } });
assert.deepEqual(researchRecordStageWhere("enriched"), {
  AND: [
    { data: { path: ["fit_verdict"], equals: "target" } },
    { data: { path: ["email"], string_contains: "@" } },
  ],
});
const verdictRows = [
  { id: "exact-target", data: { fit_verdict: "target" } },
  { id: "padded-target", data: { fit_verdict: " target " } },
] satisfies PipelineRow[];
const verdictResult = derivePipeline(
  verdictRows,
  new Set(),
  new Set(),
  new Set(),
  new Set(),
  [],
);
assert.equal(verdictResult.funnel.target, 1);
assert.equal(verdictResult.funnel.unscreened, 1);
const stageResult = derivePipeline(
  [
    { id: "short-email", data: { fit_verdict: "target", email: "x@y" } },
    { id: "fallback-verdict", data: { fit_verdict: "unverified" } },
  ],
  new Set(),
  new Set(),
  new Set(),
  new Set(),
  [],
);
assert.equal(stageResult.funnel.target, 1);
assert.equal(stageResult.funnel.unscreened, 1);
assert.equal(stageResult.funnel.withEmail, 1);
assert.equal(stageResult.stages.find((stage) => stage.key === "enriched")?.count, 1);
assert.deepEqual(researchRecordStageWhere("has_email"), {
  data: { path: ["email"], string_contains: "@" },
});
assert.deepEqual(researchRecordStageWhere("no_email"), {
  OR: [
    { data: { path: ["email"], equals: Prisma.AnyNull } },
    { NOT: { data: { path: ["email"], string_contains: "@" } } },
  ],
});
assert.equal(
  pipelineReplyReceivedAt(null, new Date("2026-01-01T00:00:00Z")),
  "2026-01-01T00:00:00.000Z",
);
assert.equal(
  pipelineReplyReceivedAt(new Date("2026-01-02T00:00:00Z"), new Date("2026-01-01T00:00:00Z")),
  "2026-01-02T00:00:00.000Z",
);

const operationSummary = selectPipelineOperations([
  { status: "FAILED" as const, createdAt: new Date("2026-01-04T00:00:00Z") },
  { status: "PENDING" as const, createdAt: new Date("2026-01-01T00:00:00Z") },
  { status: "RUNNING" as const, createdAt: new Date("2026-01-02T00:00:00Z") },
  { status: "PENDING" as const, createdAt: new Date("2026-01-03T00:00:00Z") },
  { status: "FAILED" as const, createdAt: new Date("2026-01-05T00:00:00Z") },
  { status: "RUNNING" as const, createdAt: new Date("2025-12-31T00:00:00Z") },
]);
assert.equal(operationSummary.pendingOperations, 4);
assert.deepEqual(
  operationSummary.operations.map((operation) => `${operation.status}:${operation.createdAt.toISOString()}`),
  [
    "PENDING:2026-01-03T00:00:00.000Z",
    "PENDING:2026-01-01T00:00:00.000Z",
    "RUNNING:2026-01-02T00:00:00.000Z",
    "RUNNING:2025-12-31T00:00:00.000Z",
    "FAILED:2026-01-05T00:00:00.000Z",
  ],
);

console.log("research pipeline: all assertions passed");
