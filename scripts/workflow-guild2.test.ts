import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS,
  customerProcurementContactSummary,
  customerProcurementEvidenceSummary,
  customerProcurementPhase,
  customerProcurementProgress,
  customerProcurementQuoteSummary,
  customerProcurementResearchComplete,
  customerProcurementStatusLabel,
  startCustomerProcurementPolling,
} from "../src/lib/supply-os/customer-procurement-status";

const workbench = readFileSync("src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx", "utf8");
const guidedWorkspace = readFileSync("src/app/dashboard/supply-os/supply-os-customer-procurement-workspace.tsx", "utf8");
const campaignRoute = readFileSync("src/app/api/supply-os/supplier-research/campaigns/route.ts", "utf8");
const researchPersistence = readFileSync("src/lib/supply-os/sourcing-research-persistence.ts", "utf8");

assert.doesNotMatch(workbench, /GUILD2|guild2|sourceCampaign=GUILD2|Source 38 lines|GUILD-027|GUILD-039/);
assert.doesNotMatch(guidedWorkspace, /GUILD2|guild2/);
assert.match(campaignRoute, /status: 410/);
assert.doesNotMatch(campaignRoute, /pollGuildSupplierResearchCampaign|GUILD_SUPPLIER_CAMPAIGN_KEY/);
assert.doesNotMatch(researchPersistence, /system:guild-procurement|demoSourcingWorkspace/);
assert.match(guidedWorkspace, /Request<\/span>/);
assert.match(guidedWorkspace, /Research<\/span>/);
assert.match(guidedWorkspace, /Compare<\/span>/);
assert.match(guidedWorkspace, /Procure<\/span>/);
assert.doesNotMatch(guidedWorkspace, /Bourne|Neon|Gmail/);

assert.equal(CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS, 7_000);
assert.equal(customerProcurementPhase("new", 0), "researching");
assert.equal(customerProcurementPhase("needs_attention", 2), "attention");
assert.equal(customerProcurementPhase("awaiting_shortlist_approval", 0), "compare");
assert.equal(customerProcurementPhase("ordered", 2), "procure");
assert.equal(customerProcurementResearchComplete("needs_attention", 0), false);
assert.equal(customerProcurementResearchComplete("researching", 1), true);
assert.equal(customerProcurementStatusLabel("researching"), "Researching suppliers");
assert.equal(customerProcurementStatusLabel("internal_worker_state"), "In progress");
assert.equal(customerProcurementProgress("new", 0), "Request received. Supplier research has not started yet.");
assert.equal(customerProcurementProgress("researching", 1), "1 supplier candidate is being verified.");
assert.deepEqual(customerProcurementEvidenceSummary({
  summary: "Internal Neon details are hidden.",
  evidence: ["Public supplier capability page"],
}), ["Public supplier capability page"]);
assert.equal(customerProcurementQuoteSummary(null), "Not received");
assert.equal(customerProcurementQuoteSummary({ amount: 1250, currency: "usd", unit: "lot" }), "USD 1,250 / lot");
assert.deepEqual(customerProcurementContactSummary({ name: "Ada", email: "ada@example.com", phone: null }), {
  primary: "Ada",
  secondary: "ada@example.com",
});

async function main() {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const statuses = ["researching", "ordered"];
  const observed: string[] = [];
  const stop = startCustomerProcurementPolling({
    initialStatus: "new",
    load: async () => ({ status: statuses.shift() ?? "ordered" }),
    onDetail: (detail) => observed.push(detail.status),
    onError: (error) => { throw error; },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    cancel: () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(observed, ["researching"]);
  assert.equal(scheduled[0]?.delay, CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS);
  scheduled.shift()?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(observed, ["researching", "ordered"]);
  stop();
  console.log("Customer procurement workflow boundary checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
