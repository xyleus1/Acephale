import assert from "node:assert/strict";
import fs from "node:fs";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import {
  GUILD2_BULK_CONCURRENCY,
  GUILD2_PROCUREMENT_PLAN,
  guild2ActiveProcurementOrders,
  guild2ProcurementEvidenceSummary,
  guild2ProcurementIdempotencyKey,
  guild2ProcurementLine,
  guild2ProcurementRequest,
  guild2ProcurementSourceSku,
  mergeGuild2ProcurementOrderDetail,
  restoreGuild2ProcurementOrders,
  runWithBoundedConcurrency,
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
assert.match(workbench, /scrollIntoView/);
assert.match(workbench, /Approval required in Bourne Inbox/);
assert.match(workbench, /selectedGuild2Order\.vendors\.map/);
assert.doesNotMatch(workbench, /dashboard\/workflow\?orderId/);
assert.match(workbench, /workflowWakeRequested/);
assert.match(workbench, /response\.status === 201/);
assert.match(workbench, /Needs trigger: queued for scheduled pickup/);
assert.match(workbench, /Source 38 lines/);
assert.match(workbench, /GUILD-027 is skipped/);
assert.match(workbench, /GUILD-039 remains an award documentation requirement/);
assert.match(workbench, /disabled=\{!guild2InventoryReady \|\| guild2BulkState === "running"\}/);
assert.doesNotMatch(dashboard, /\/api\/supply-os\/external-sourcing\/guild2/);
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
  status: "shortlisted",
  research: { summary: "Evidence" },
  quote: null,
};
const mergedOrder = mergeGuild2ProcurementOrderDetail(queuedOrder, {
  id: queuedOrder.orderId!,
  status: "awaiting_shortlist_approval",
  progress: "Shortlist ready",
  requestContext: {},
  vendors: [vendor],
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

async function main() {
  const emptyProcessed: string[] = [];
  await runWithBoundedConcurrency([], async (value: string) => {
    emptyProcessed.push(value);
  });
  assert.deepEqual(emptyProcessed, []);
  await assert.rejects(runWithBoundedConcurrency(["one"], async () => undefined, 0));
  await assert.rejects(runWithBoundedConcurrency(["one"], async () => undefined, 1.5));

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
