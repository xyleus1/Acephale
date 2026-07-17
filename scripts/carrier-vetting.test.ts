// Smoke test for the carrier vetting vocabulary, checklist template, and
// deterministic approval gate. Run: npx tsx scripts/carrier-vetting.test.ts

import {
  CARRIER_CHECKLIST_STATUS_VALUES,
  CARRIER_VETTING_CHECKLIST,
  CARRIER_VETTING_STATUS_VALUES,
  carrierVettingGate,
  checklistTemplateForCarrier,
  insuranceExpiryState,
} from "../src/lib/carrier-vetting";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

check("vetting statuses are unique", unique(CARRIER_VETTING_STATUS_VALUES));
check("checklist statuses are unique", unique(CARRIER_CHECKLIST_STATUS_VALUES));
check("checklist keys are unique", unique(CARRIER_VETTING_CHECKLIST.map((i) => i.key)));
check(
  "every checklist item has a human label",
  CARRIER_VETTING_CHECKLIST.every((i) => i.label.trim().length > 0)
);

// Conditional items only apply when the capability is claimed.
const baseTemplate = checklistTemplateForCarrier({});
check(
  "base template excludes lithium + hazmat items",
  !baseTemplate.some((i) => i.key === "lithium_certs" || i.key === "hazmat_certs")
);
const lithiumTemplate = checklistTemplateForCarrier({ lithiumCapable: true });
check(
  "lithium carrier template includes lithium_certs but not hazmat_certs",
  lithiumTemplate.some((i) => i.key === "lithium_certs") && !lithiumTemplate.some((i) => i.key === "hazmat_certs")
);

// The gate: all required items must be passed or waived; any failed item blocks.
const requiredKeys = baseTemplate.filter((i) => i.required).map((i) => i.key);

const empty = carrierVettingGate({}, []);
check("empty checklist cannot approve", !empty.canApprove);
check("empty checklist reports every required item missing", JSON.stringify(empty.missing) === JSON.stringify(requiredKeys));
check("empty checklist reports no failures", empty.failed.length === 0);

const allPassed = carrierVettingGate({}, requiredKeys.map((key) => ({ key, status: "passed" })));
check("all required passed approves", allPassed.canApprove && allPassed.missing.length === 0);

const withWaived = carrierVettingGate(
  {},
  requiredKeys.map((key, idx) => ({ key, status: idx === 0 ? "waived" : "passed" }))
);
check("waived counts as satisfied for required items", withWaived.canApprove);

const withFailedOptional = carrierVettingGate(
  {},
  [...requiredKeys.map((key) => ({ key, status: "passed" })), { key: "authority_age", status: "failed" }]
);
check("a failed item blocks approval even when optional", !withFailedOptional.canApprove && withFailedOptional.failed.includes("authority_age"));

const pendingOptional = carrierVettingGate(
  {},
  [...requiredKeys.map((key) => ({ key, status: "passed" })), { key: "references", status: "pending" }]
);
check("a pending optional item does not block approval", pendingOptional.canApprove);

const lithiumMissing = carrierVettingGate({ lithiumCapable: true }, requiredKeys.map((key) => ({ key, status: "passed" })));
check(
  "lithium capability adds lithium_certs to the required set",
  !lithiumMissing.canApprove && lithiumMissing.missing.includes("lithium_certs")
);

// Insurance expiry state (now injected for determinism).
const now = new Date("2026-07-16T12:00:00Z");
check("no expiry date reads unknown", insuranceExpiryState(null, now) === "unknown");
check("garbage expiry reads unknown", insuranceExpiryState("not-a-date", now) === "unknown");
check("past expiry reads expired", insuranceExpiryState("2026-07-15T12:00:00Z", now) === "expired");
check("expiry inside 30 days reads expiring_soon", insuranceExpiryState("2026-08-01T00:00:00Z", now) === "expiring_soon");
check("expiry beyond 30 days reads ok", insuranceExpiryState("2026-12-01T00:00:00Z", now) === "ok");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll carrier-vetting checks passed");
