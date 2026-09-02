import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { facilityMatchesVerifiedBase } from "../src/lib/supply-os/facility-verification";
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
  customerProcurementVendorStateLabel,
  CUSTOMER_PROCUREMENT_MAX_CONSECUTIVE_FAILURES,
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
assert.match(workbench, /Review shortlist/);
assert.match(guidedWorkspace, /Supplier results did not load/);
assert.match(guidedWorkspace, /Retry refresh/);
assert.doesNotMatch(guidedWorkspace, /if \(!result\.workflowWakeRequested\)/);
assert.match(guidedWorkspace, /Request<\/span>/);
assert.match(guidedWorkspace, /Research<\/span>/);
assert.match(guidedWorkspace, /Compare<\/span>/);
assert.match(guidedWorkspace, /Procure<\/span>/);
assert.doesNotMatch(guidedWorkspace, /Bourne|Neon|Gmail/);
assert.match(guidedWorkspace, /customerProcurementAttentionReason\(detail\.progress\)/);
assert.match(guidedWorkspace, /customerProcurementAttentionHints\(item\.specification\)/);
assert.match(guidedWorkspace, /Open Chat/);
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
  customerProcurementProgress("awaiting_shortlist_approval", 0),
  "The supplier shortlist is ready for review.",
);
assert.equal(
  customerProcurementProgress("awaiting_shortlist_approval", 4),
  "4 supplier candidates are ready for review.",
);
assert.equal(
  customerProcurementVendorStateLabel({ contacted: false, responseCount: 0, quote: null }),
  "No contact receipt",
);
assert.equal(
  customerProcurementVendorStateLabel({ contacted: true, responseCount: 0, quote: null }),
  "Contact recorded",
);
assert.equal(
  customerProcurementVendorStateLabel({ contacted: true, responseCount: 2, quote: null }),
  "Replied",
);
assert.equal(
  customerProcurementVendorStateLabel({ contacted: false, responseCount: 0, quote: { price: 12 } }),
  "Quote received",
);
assert.match(guidedWorkspace, /customerProcurementVendorStateLabel\(vendor\)/);
assert.doesNotMatch(guidedWorkspace, /vendorStatusLabel/);

const verifiedBase = {
  label: "Northwind Robotics base, Detroit, MI, US",
  city: "Detroit",
};
const operatingSite = { id: "processing-site", kind: "factory" as const };
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Northwind Robotics operating site", location: "Detroit, MI" }, verifiedBase),
  true,
);
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Northwind Robotics operating site", location: "Austin, TX" }, verifiedBase),
  false,
);
// A second factory in the saved base city is a different site and stays unverified.
assert.equal(
  facilityMatchesVerifiedBase({ id: "source-detroit-castings-1", kind: "factory", label: "Detroit Castings plant", location: "Detroit, MI" }, verifiedBase),
  false,
);
// The generated label carries the company name, not facility identity, so it cannot confirm a conflicting address.
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Northwind Robotics base operating site", location: "Austin, TX" }, verifiedBase),
  false,
);
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Detroit Robotics operating site", location: "Austin, TX" }, verifiedBase),
  false,
);
assert.equal(
  facilityMatchesVerifiedBase({ id: "distribution-1", kind: "distribution", label: "Third party warehouse", location: "Detroit, MI" }, verifiedBase),
  false,
);
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Operating site", location: "Detroit, MI" }, null),
  false,
);
assert.equal(
  facilityMatchesVerifiedBase({ ...operatingSite, label: "Operating site", location: "Detroit, MI" }, { label: "Base", city: null }),
  false,
);
assert.match(dashboard, /facilityMatchesVerifiedBase\(object, verifiedFacility\)/);
assert.match(dashboard, /Verified operating base/);
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

  const approvalSchedule: Array<{ callback: () => void; delay: number }> = [];
  const approvalObserved: string[] = [];
  const stopApproval = startCustomerProcurementPolling({
    initialStatus: "awaiting_shortlist_approval",
    load: async () => ({ status: "awaiting_shortlist_approval" }),
    onDetail: (detail) => approvalObserved.push(detail.status),
    onError: (error) => { throw error; },
    schedule: (callback, delay) => {
      approvalSchedule.push({ callback, delay });
      return approvalSchedule.length;
    },
    cancel: () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(approvalObserved, ["awaiting_shortlist_approval"]);
  assert.equal(approvalSchedule.length, 1, "an approval state must keep polling for its detail");
  stopApproval();

  const failureSchedule: Array<{ callback: () => void; delay: number }> = [];
  const failures: string[] = [];
  let attempts = 0;
  const stopFailing = startCustomerProcurementPolling({
    initialStatus: "ordered",
    load: async () => {
      attempts += 1;
      throw new Error(`load ${attempts} failed`);
    },
    onDetail: () => undefined,
    onError: (error) => failures.push(error instanceof Error ? error.message : "unknown"),
    schedule: (callback, delay) => {
      failureSchedule.push({ callback, delay });
      return failureSchedule.length;
    },
    cancel: () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, ["load 1 failed"]);
  for (let retry = 0; retry < CUSTOMER_PROCUREMENT_MAX_CONSECUTIVE_FAILURES; retry += 1) {
    const next = failureSchedule.shift();
    assert.ok(next, "a failed load must schedule a retry until the retry budget runs out");
    next.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(attempts, CUSTOMER_PROCUREMENT_MAX_CONSECUTIVE_FAILURES + 1);
  assert.equal(failureSchedule.length, 0, "retries must stop once the failure budget is spent");
  stopFailing();

  const recoverySchedule: Array<{ callback: () => void; delay: number }> = [];
  const recovered: string[] = [];
  let recoveryAttempts = 0;
  const stopRecovering = startCustomerProcurementPolling({
    initialStatus: "awaiting_shortlist_approval",
    load: async () => {
      recoveryAttempts += 1;
      if (recoveryAttempts === 1) throw new Error("first load failed");
      return { status: "awaiting_shortlist_approval" };
    },
    onDetail: (detail) => recovered.push(detail.status),
    onError: () => undefined,
    schedule: (callback, delay) => {
      recoverySchedule.push({ callback, delay });
      return recoverySchedule.length;
    },
    cancel: () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(recovered, []);
  recoverySchedule.shift()?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(recovered, ["awaiting_shortlist_approval"], "a failed load must recover on the next tick");
  assert.equal(recoverySchedule.length, 1, "a recovered approval state keeps polling");
  stopRecovering();

  console.log("Customer procurement workflow boundary checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
