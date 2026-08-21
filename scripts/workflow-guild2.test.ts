import assert from "node:assert/strict";
import fs from "node:fs";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import {
  GUILD2_BULK_CONCURRENCY,
  GUILD2_PROCUREMENT_POLL_INTERVAL_MS,
  GUILD2_PROCUREMENT_PLAN,
  guild2ActiveProcurementOrders,
  guild2CustomerProcurementProgress,
  guild2CustomerProcurementStatusLabel,
  guild2ProcurementEvidenceSummary,
  guild2ProcurementContactSummary,
  guild2ProcurementIdempotencyKey,
  guild2ProcurementLine,
  guild2ProcurementPhase,
  guild2ProcurementQuoteSummary,
  guild2ProcurementRequest,
  guild2ProcurementResearchComplete,
  guild2ProcurementSourceSku,
  mergeGuild2ProcurementOrderDetail,
  restoreGuild2ProcurementOrders,
  runWithBoundedConcurrency,
  sourceGuild2ProcurementAndOpen,
  startGuild2ProcurementPolling,
  type Guild2ProcurementOrderState,
} from "../src/lib/supply-os/guild2-procurement";
import { GUILD2_SOURCING_ITEMS, GUILD_SOURCING_ITEMS } from "../src/lib/supply-os/guild-sourcing-items";

assert.equal(GUILD_SOURCING_ITEMS.length, 40);
assert.equal(GUILD2_SOURCING_ITEMS.length, 40);
assert.equal(GUILD2_PROCUREMENT_PLAN.all.length, 40);
assert.equal(GUILD2_PROCUREMENT_PLAN.searchable.length, 38);
assert.deepEqual(GUILD2_PROCUREMENT_PLAN.blocked.map((line) => line.sku), ["GUILD-027"]);
assert.deepEqual(GUILD2_PROCUREMENT_PLAN.documentation.map((line) => line.sku), ["GUILD-039"]);
assert.equal(GUILD2_PROCUREMENT_PLAN.ready, true);
assert.equal(GUILD2_PROCUREMENT_POLL_INTERVAL_MS, 7_000);
assert.deepEqual(
  GUILD2_PROCUREMENT_PLAN.all.map((line) => line.sourceSku),
  GUILD2_SOURCING_ITEMS.map((item) => item.sku),
);

const requests = GUILD2_PROCUREMENT_PLAN.searchable.map(guild2ProcurementRequest);
assert.equal(requests.length, 38);
assert(requests.every((request) => procurementRequestSchema.safeParse(request).success));
assert.equal(new Set(requests.map((request) => request.idempotencyKey)).size, 38);
assert(requests.every((request) => request.idempotencyKey.startsWith("guild2-procurement:v1:GUILD2-")));
assert(requests.every((request) => request.notes?.startsWith("[BOURNE TEST] GUILD2-")));
assert(requests.every((request) => !Object.hasOwn(request, "customerId") && !Object.hasOwn(request, "status")));
assert.equal(guild2ProcurementLine("GUILD2-001")?.sku, "GUILD-001");
assert.equal(guild2ProcurementLine("GUILD2-999"), null);
assert.equal(guild2ProcurementPhase("new", 0), "researching");
assert.equal(guild2ProcurementPhase("researching", 0), "researching");
assert.equal(guild2ProcurementPhase("needs_attention", 2), "attention");
assert.equal(guild2ProcurementPhase("cancelled", 0), "attention");
assert.equal(guild2ProcurementPhase("awaiting_shortlist_approval", 0), "compare");
assert.equal(guild2ProcurementPhase("sourcing", 2), "compare");
assert.equal(guild2ProcurementPhase("awaiting_order_approval", 2), "procure");
assert.equal(guild2ProcurementPhase("ordered", 2), "procure");
assert.equal(guild2ProcurementResearchComplete("needs_attention", 0), false);
assert.equal(guild2ProcurementResearchComplete("researching", 1), true);
assert.equal(guild2ProcurementResearchComplete("awaiting_shortlist_approval", 0), true);
assert.throws(() => guild2ProcurementRequest(GUILD2_PROCUREMENT_PLAN.blocked[0]!));
assert.throws(() => guild2ProcurementRequest(GUILD2_PROCUREMENT_PLAN.documentation[0]!));
assert.equal(
  guild2ProcurementIdempotencyKey(GUILD2_PROCUREMENT_PLAN.searchable[0]!),
  guild2ProcurementIdempotencyKey(GUILD2_PROCUREMENT_PLAN.searchable[0]!),
);

let active = 0;
let maximumActive = 0;
const processed: string[] = [];

const workbench = fs.readFileSync("src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx", "utf8");
const guidedWorkspace = fs.readFileSync("src/app/dashboard/supply-os/supply-os-customer-procurement-workspace.tsx", "utf8");
const workspaceStyles = fs.readFileSync("src/app/dashboard/supply-os/supply-os-logistics.module.css", "utf8");
const procurementHelpers = fs.readFileSync("src/lib/supply-os/guild2-procurement.ts", "utf8");
const dashboard = fs.readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");
const environment = fs.readFileSync(".env.example", "utf8");

assert.match(workbench, /fetch\("\/api\/procurement\/requests\?sourceCampaign=GUILD2"/);
assert.match(workbench, /7_000/);
assert.match(workbench, /runWithBoundedConcurrency\(active/);
assert.match(workbench, /restoreGuild2ProcurementOrders/);
assert.match(procurementHelpers, /requestContext/);
assert.match(procurementHelpers, /guild2ProcurementSourceSku/);
assert.match(procurementHelpers, /restoredFromList/);
assert.match(workbench, /View results/);
assert.match(workbench, /onOpenGuild2Procurement/);
assert.match(guidedWorkspace, /Request<\/span>/);
assert.match(guidedWorkspace, /Research<\/span>/);
assert.match(guidedWorkspace, /Compare<\/span>/);
assert.match(guidedWorkspace, /Procure<\/span>/);
assert.match(guidedWorkspace, /Shortlist under review/);
assert.match(guidedWorkspace, /detail\.vendors\.map/);
assert.match(guidedWorkspace, /GUILD2_PROCUREMENT_POLL_INTERVAL_MS/);
assert.doesNotMatch(guidedWorkspace, /Bourne|Neon|Gmail/);
assert.doesNotMatch(guidedWorkspace, /\{detail\.progress/);
assert.match(workspaceStyles, /\.procurementSourceLog > li > span:first-child/);
assert.match(workspaceStyles, /\.procurementSourceLog > li > div/);
assert.doesNotMatch(workspaceStyles, /\.procurementSourceLog > li > span \{/);
assert.doesNotMatch(workbench, /dashboard\/workflow\?orderId/);
assert.match(workbench, /workflowWakeRequested/);
assert.match(workbench, /response\.status === 201/);
assert.match(workbench, /Queued for processing/);
assert.match(guidedWorkspace, /automaticStartRetryRef/);
assert.match(guidedWorkspace, /Start sourcing/);
assert.doesNotMatch(guidedWorkspace, /Sourcing started/);
assert.doesNotMatch(workbench, /Bourne procurement queue|Approval required in Bourne Inbox/);
assert.doesNotMatch(workbench, /guild2Order\.progress/);
assert.match(workbench, /Source 38 lines/);
assert.match(workbench, /GUILD-027 is skipped/);
assert.match(workbench, /GUILD-039 remains an award documentation requirement/);
assert.match(workbench, /disabled=\{!guild2InventoryReady \|\| guild2BulkState === "running"\}/);
assert.doesNotMatch(dashboard, /\/api\/supply-os\/external-sourcing\/guild2/);
assert.match(dashboard, /!procurementRequest && !customerProcurementRequest/);
assert.doesNotMatch(environment, /WORKFLOW_AGENT_TRIGGER_/);
assert.equal((environment.match(/^WORKFLOW_DATABASE_URL=/gm) ?? []).length, 1);

const queuedOrder: Guild2ProcurementOrderState = {
  orderId: "11111111-1111-4111-8111-111111111111",
  status: "new",
  progress: "Queued",
  error: null,
  workflowWakeRequested: true,
  vendors: [],
};
assert.equal(guild2ProcurementSourceSku({ source: { source_sku: "GUILD2-001" } }), "GUILD2-001");
assert.equal(guild2ProcurementSourceSku({}), null);
assert.equal(guild2ProcurementSourceSku({ source: [] }), null);
assert.equal(guild2ProcurementSourceSku({ source: { source_sku: 1 } }), null);
assert.equal(guild2ProcurementSourceSku({ source: { source_sku: "GUILD2-999" } }), null);
assert.equal(guild2CustomerProcurementStatusLabel("researching"), "Researching suppliers");
assert.equal(guild2CustomerProcurementStatusLabel("awaiting_shortlist_approval"), "Shortlist review");
assert.equal(guild2CustomerProcurementStatusLabel("internal_worker_state"), "In progress");
assert.equal(guild2CustomerProcurementProgress("new", 0), "Request received. Supplier research has not started yet.");
assert.equal(guild2CustomerProcurementProgress("researching", 1), "1 supplier candidate is being verified.");
assert.equal(guild2CustomerProcurementProgress("awaiting_shortlist_approval", 1), "1 supplier candidate is ready for review.");
assert.equal(guild2CustomerProcurementProgress("awaiting_shortlist_approval", 4), "4 supplier candidates are ready for review.");
assert.doesNotMatch(
  Object.values({
    new: guild2CustomerProcurementProgress("new", 0),
    researching: guild2CustomerProcurementProgress("researching", 0),
    review: guild2CustomerProcurementProgress("awaiting_shortlist_approval", 4),
    sourcing: guild2CustomerProcurementProgress("sourcing", 4),
    orderReview: guild2CustomerProcurementProgress("awaiting_order_approval", 4),
    ordered: guild2CustomerProcurementProgress("ordered", 4),
    attention: guild2CustomerProcurementProgress("needs_attention", 0),
    cancelled: guild2CustomerProcurementProgress("cancelled", 0),
  }).join(" "),
  /Bourne|Neon|Gmail/i,
);

const restoredOrders = restoreGuild2ProcurementOrders({
  "GUILD2-001": { ...queuedOrder, status: "submitting", workflowWakeRequested: true },
}, [
  { id: "newest", status: "researching", progress: "Newest", requestContext: { source: { source_sku: "GUILD2-002" } } },
  { id: "older", status: "new", progress: "Older", requestContext: { source: { source_sku: "GUILD2-002" } } },
  { id: "ignored", status: "new", progress: null, requestContext: { source: { source_sku: "OTHER-001" } } },
  { id: "submitting", status: "new", progress: null, requestContext: { source: { source_sku: "GUILD2-001" } } },
]);
assert.equal(restoredOrders["GUILD2-001"]?.status, "submitting");
assert.equal(restoredOrders["GUILD2-002"]?.orderId, "newest");
assert.equal(restoredOrders["GUILD2-002"]?.progress, "Newest");
assert.equal(restoredOrders["GUILD2-002"]?.workflowWakeRequested, null);
assert.deepEqual(restoredOrders["GUILD2-002"]?.vendors, []);
assert.equal(Object.hasOwn(restoredOrders, "OTHER-001"), false);

const restoredAfterCancellation = restoreGuild2ProcurementOrders({}, [
  { id: "cancelled", status: "cancelled", progress: null, requestContext: { source: { source_sku: "GUILD2-003" } } },
  { id: "active", status: "researching", progress: "Working", requestContext: { source: { source_sku: "GUILD2-003" } } },
]);
assert.equal(restoredAfterCancellation["GUILD2-003"]?.orderId, "active");

const vendor = {
  id: "vendor-1",
  name: "Supplier One",
  website: "https://example.com",
  contact: null,
  contacted: false,
  status: "shortlisted",
  research: { summary: "Evidence" },
  quote: null,
};
const mergedOrder = mergeGuild2ProcurementOrderDetail(queuedOrder, {
  id: queuedOrder.orderId!,
  status: "awaiting_shortlist_approval",
  progress: "Shortlist ready",
  requestContext: {},
  neededBy: "2026-09-30",
  quantity: 4,
  unit: "blanks",
  material: "6061-T6 sheet",
  specification: "2.0 mm",
  approvalRequestedAt: null,
  decisionSnapshot: null,
  vendors: [vendor],
  updatedAt: "2026-08-18T00:00:00.000Z",
});
assert.equal(mergedOrder.workflowWakeRequested, true);
assert.equal(mergedOrder.status, "awaiting_shortlist_approval");
assert.deepEqual(mergedOrder.vendors, [vendor]);

const activeOrders = guild2ActiveProcurementOrders({
  new: queuedOrder,
  researching: { ...queuedOrder, status: "researching" },
  sourcing: { ...queuedOrder, status: "sourcing" },
  approval: { ...queuedOrder, status: "awaiting_shortlist_approval" },
  completed: { ...queuedOrder, status: "ordered" },
  missing: { ...queuedOrder, orderId: null },
});
assert.deepEqual(activeOrders.map(([key]) => key), ["new", "researching", "sourcing"]);

const longEvidence = "x".repeat(220);
assert.deepEqual(guild2ProcurementEvidenceSummary({
  unrelated: "ignored after two preferred values",
  evidence: ["same", "same", 7, true],
  summary: longEvidence,
}), [longEvidence.slice(0, 180), "same"]);
assert.deepEqual(guild2ProcurementEvidenceSummary({ a: { b: { c: "too deep" } } }), []);
assert.deepEqual(guild2ProcurementEvidenceSummary({
  summary: "Bourne run details are internal.",
  evidence: ["Public supplier capability page"],
}), ["Public supplier capability page"]);
assert.equal(guild2ProcurementQuoteSummary(null), "Not received");
assert.equal(guild2ProcurementQuoteSummary({ amount: 1250, currency: "usd", unit: "lot" }), "USD 1,250 / lot");
assert.equal(guild2ProcurementQuoteSummary({ quote_reference: "RFQ-12" }), "Received: RFQ-12");
assert.deepEqual(guild2ProcurementContactSummary({ name: "Ada", email: "ada@example.com", phone: null }), {
  primary: "Ada",
  secondary: "ada@example.com",
});
assert.deepEqual(guild2ProcurementContactSummary({ name: null, email: null, phone: "+1 555 0100" }), {
  primary: "Not identified",
  secondary: "+1 555 0100",
});
assert.deepEqual(guild2ProcurementContactSummary(null), {
  primary: "Not identified",
  secondary: "No contact saved",
});

async function main() {
  const emptyProcessed: string[] = [];
  await runWithBoundedConcurrency([], async (value: string) => {
    emptyProcessed.push(value);
  });
  assert.deepEqual(emptyProcessed, []);
  await assert.rejects(runWithBoundedConcurrency(["one"], async () => undefined, 0));
  await assert.rejects(runWithBoundedConcurrency(["one"], async () => undefined, 1.5));

  let openedOrder: Guild2ProcurementOrderState | null = null;
  const sourcedOrder = await sourceGuild2ProcurementAndOpen(
    async () => queuedOrder,
    (order) => { openedOrder = order; },
  );
  assert.equal(sourcedOrder, queuedOrder);
  assert.equal(openedOrder, queuedOrder);
  openedOrder = null;
  const missingOrder = await sourceGuild2ProcurementAndOpen(
    async () => null,
    (order) => { openedOrder = order; },
  );
  assert.equal(missingOrder, null);
  assert.equal(openedOrder, null);

  const scheduled: Array<{ callback: () => void; delay: number; handle: number }> = [];
  const cancelledHandles: number[] = [];
  const polledStatuses: string[] = [];
  const pollingErrors: unknown[] = [];
  const statuses = ["researching", "ordered"];
  let loadCount = 0;
  const stopPolling = startGuild2ProcurementPolling({
    initialStatus: "new",
    load: async () => {
      loadCount += 1;
      return { status: statuses.shift() ?? "ordered" };
    },
    onDetail: (detail) => polledStatuses.push(detail.status),
    onError: (error) => pollingErrors.push(error),
    schedule: (callback, delay) => {
      const handle = scheduled.length + 1;
      scheduled.push({ callback, delay, handle });
      return handle;
    },
    cancel: (handle) => cancelledHandles.push(handle as number),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(loadCount, 1);
  assert.deepEqual(polledStatuses, ["researching"]);
  assert.equal(pollingErrors.length, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delay, GUILD2_PROCUREMENT_POLL_INTERVAL_MS);
  scheduled.shift()?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(loadCount, 2);
  assert.deepEqual(polledStatuses, ["researching", "ordered"]);
  assert.equal(scheduled.length, 0);
  stopPolling();
  assert.deepEqual(cancelledHandles, []);

  let releaseSlowLoad: ((detail: { status: string }) => void) | null = null;
  let slowLoadCount = 0;
  const slowScheduled: Array<() => void> = [];
  const stopSlowPolling = startGuild2ProcurementPolling({
    initialStatus: "new",
    load: () => {
      slowLoadCount += 1;
      return new Promise<{ status: string }>((resolve) => { releaseSlowLoad = resolve; });
    },
    onDetail: () => undefined,
    onError: () => undefined,
    schedule: (callback) => {
      slowScheduled.push(callback);
      return slowScheduled.length;
    },
    cancel: () => undefined,
  });
  assert.equal(slowLoadCount, 1);
  assert.equal(slowScheduled.length, 0);
  releaseSlowLoad?.({ status: "researching" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(slowScheduled.length, 1);
  const slowTick = slowScheduled.shift();
  slowTick?.();
  slowTick?.();
  assert.equal(slowLoadCount, 2);
  stopSlowPolling();

  let recoveryAttempts = 0;
  const recoveryErrors: unknown[] = [];
  const recoveryScheduled: Array<() => void> = [];
  const recoveredStatuses: string[] = [];
  const stopRecoveryPolling = startGuild2ProcurementPolling({
    initialStatus: "researching",
    load: async () => {
      recoveryAttempts += 1;
      if (recoveryAttempts === 1) throw new Error("temporary failure");
      return { status: "ordered" };
    },
    onDetail: (detail) => recoveredStatuses.push(detail.status),
    onError: (error) => recoveryErrors.push(error),
    schedule: (callback) => {
      recoveryScheduled.push(callback);
      return recoveryScheduled.length;
    },
    cancel: () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(recoveryErrors.length, 1);
  assert.equal(recoveryScheduled.length, 1);
  recoveryScheduled.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(recoveryAttempts, 2);
  assert.deepEqual(recoveredStatuses, ["ordered"]);
  assert.equal(recoveryScheduled.length, 0);
  stopRecoveryPolling();

  await runWithBoundedConcurrency(GUILD2_PROCUREMENT_PLAN.searchable, async (line) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    processed.push(line.sourceSku);
    active -= 1;
  });
  assert.equal(processed.length, 38);
  assert.equal(new Set(processed).size, 38);
  assert(maximumActive <= GUILD2_BULK_CONCURRENCY);
  console.log("GUILD2 procurement workflow boundary checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
