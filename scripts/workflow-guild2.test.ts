import assert from "node:assert/strict";
import fs from "node:fs";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import {
  GUILD2_BULK_CONCURRENCY,
  GUILD2_PROCUREMENT_PLAN,
  guild2ProcurementIdempotencyKey,
  guild2ProcurementLine,
  guild2ProcurementRequest,
  runWithBoundedConcurrency,
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
const dashboard = fs.readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");
const environment = fs.readFileSync(".env.example", "utf8");

assert.match(workbench, /fetch\("\/api\/procurement\/requests"/);
assert.match(workbench, /7_000/);
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
