import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS,
  customerProcurementAttentionHints,
  customerProcurementAttentionReason,
  customerProcurementContactSummary,
  customerProcurementEvidenceSummary,
  customerProcurementPhase,
  customerProcurementProgress,
  customerProcurementPublicPriceSummary,
  customerProcurementQuoteSummary,
  customerProcurementResearchEmail,
  customerProcurementResearchComplete,
  customerProcurementStatusLabel,
  startCustomerProcurementPolling,
} from "../src/lib/supply-os/customer-procurement-status";

const workbench = readFileSync("src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx", "utf8");
const guidedWorkspace = readFileSync("src/app/dashboard/supply-os/supply-os-customer-procurement-workspace.tsx", "utf8");
const dashboard = readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");
const operatingShell = readFileSync("src/app/dashboard/supply-os/supply-os-operating-shell.tsx", "utf8");
const campaignRoute = readFileSync("src/app/api/supply-os/supplier-research/campaigns/route.ts", "utf8");
const researchPersistence = readFileSync("src/lib/supply-os/sourcing-research-persistence.ts", "utf8");

assert.doesNotMatch(workbench, /GUILD2|guild2|sourceCampaign=GUILD2|Source 38 lines|GUILD-027|GUILD-039/);
assert.doesNotMatch(guidedWorkspace, /GUILD2|guild2/);
assert.match(campaignRoute, /status: 410/);
assert.doesNotMatch(campaignRoute, /pollGuildSupplierResearchCampaign|GUILD_SUPPLIER_CAMPAIGN_KEY/);
assert.doesNotMatch(researchPersistence, /system:guild-procurement|demoSourcingWorkspace/);
assert.match(workbench, /Start sourcing/);
assert.match(workbench, /Resolve blocker/);
assert.doesNotMatch(guidedWorkspace, /if \(!result\.workflowWakeRequested\)/);
assert.match(guidedWorkspace, /Request<\/span>/);
assert.match(guidedWorkspace, /Research<\/span>/);
assert.match(guidedWorkspace, /Compare<\/span>/);
assert.match(guidedWorkspace, /Procure<\/span>/);
assert.doesNotMatch(guidedWorkspace, /Bourne|Neon|Gmail/);
assert.match(guidedWorkspace, /customerProcurementAttentionReason\(detail\.progress\)/);
assert.match(guidedWorkspace, /customerProcurementAttentionHints\(item\.specification\)/);
assert.match(guidedWorkspace, /Open Context/);
assert.match(guidedWorkspace, /detail\.status === "needs_attention" \? \(/);
assert.match(dashboard, /onOpenContext=\{onOpenContext\}/);
assert.match(operatingShell, /onOpenContext=\{\(\) => selectPanel\("context"\)\}/);

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
assert.equal(
  customerProcurementAttentionReason("Missing STL measurement units and a confirmed PCB surface finish."),
  "Missing STL measurement units and a confirmed PCB surface finish.",
);
assert.equal(
  customerProcurementAttentionReason("Worker exception: database timeout in Bourne"),
  "The request could not continue. Correct the missing or conflicting details in Context, then confirm a new sourcing request.",
);
assert.equal(
  customerProcurementAttentionReason("Order received from dashboard"),
  "The request could not continue. Correct the missing or conflicting details in Context, then confirm a new sourcing request.",
);
assert.equal(
  customerProcurementProgress("needs_attention", 0, "Needs attention: Missing STL units."),
  "Missing STL units.",
);
assert.equal(
  customerProcurementAttentionReason("Blocked: PCB finish must be confirmed."),
  "PCB finish must be confirmed.",
);
for (const unsafeReason of [
  null,
  "   ",
  "Additional information is required.",
  "See https://internal.example/request/123",
  '{"error":"supplier worker failed"}',
  "Failure 71a31ebe-2db3-4347-9945-a7a4b91f38d2",
]) {
  assert.equal(
    customerProcurementAttentionReason(unsafeReason),
    "The request could not continue. Correct the missing or conflicting details in Context, then confirm a new sourcing request.",
  );
}
assert.equal(customerProcurementAttentionReason(`Missing ${"detail ".repeat(80)}`).length, 320);
assert.deepEqual(customerProcurementAttentionHints(
  "Task 1: PCBA surface finish requires clarification between leaded HASL and ENIG. Task 2: STL measurement unit is unspecified.",
), [
  "Split this combined request into one sourcing request per item or manufacturing process.",
  "Task 1: PCBA surface finish requires clarification between leaded HASL and ENIG.",
  "Task 2: STL measurement unit is unspecified.",
]);
assert.deepEqual(customerProcurementAttentionHints(null), []);
assert.deepEqual(customerProcurementAttentionHints("The request contains a complete specification."), []);
const repeatedHints = customerProcurementAttentionHints(
  "The finish is unspecified. The finish is unspecified. Quantity is unknown. Tolerance is missing. Material is not provided.",
);
assert.deepEqual(repeatedHints, [
  "The finish is unspecified.",
  "Quantity is unknown.",
  "Tolerance is missing.",
]);
const longHint = customerProcurementAttentionHints(`${"Background ".repeat(40)}The measurement unit is unspecified.`)[0];
assert.ok(longHint?.startsWith("... "));
assert.ok(longHint && longHint.length <= 244);
assert.deepEqual(customerProcurementEvidenceSummary({
  summary: "Internal Neon details are hidden.",
  evidence: ["Public supplier capability page"],
}), ["Public supplier capability page"]);
assert.deepEqual(customerProcurementEvidenceSummary({
  qualification: { status: "CANDIDATE", summary: "POTENTIAL MATCH - GAPS REMAIN" },
  evidence: ["Exact DP420NS Black 50 mL Duo-Pak product page"],
}), ["Exact DP420NS Black 50 mL Duo-Pak product page"]);
assert.equal(customerProcurementQuoteSummary(null), "Not received");
assert.equal(customerProcurementQuoteSummary({ amount: 1250, currency: "usd", unit: "lot" }), "USD 1,250 / lot");
assert.equal(customerProcurementResearchEmail({ identity: { email: " Info@Example.com " } }), "info@example.com");
assert.equal(customerProcurementResearchEmail({ notes: "Email fake@example.com" }), null);
assert.equal(customerProcurementResearchEmail({ draft: { email: "draft@example.com" } }), null);
assert.equal(customerProcurementPublicPriceSummary({
  public_listing: { price: 46.18, currency: "usd", unit: "each" },
}), "USD 46.18 / each");
assert.equal(customerProcurementPublicPriceSummary({
  evidence: ["Public listing: $48.60 at quantity 6; $41.98 at quantity 12."],
}), "Public listing: $48.60 at quantity 6; $41.98 at quantity 12.");
assert.equal(customerProcurementPublicPriceSummary({ draft: { body: "Offer $1.00 in the draft." } }), null);
assert.equal(customerProcurementPublicPriceSummary({ quantity: { amount: 4, unit: "units" } }), null);
assert.deepEqual(customerProcurementContactSummary({ name: "Ada", email: "ada@example.com", phone: null }), {
  primary: "Ada",
  secondary: "ada@example.com",
});
assert.deepEqual(customerProcurementContactSummary(null, { contact: { email: "sales@example.com" } }), {
  primary: "Public research contact",
  secondary: "sales@example.com",
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
