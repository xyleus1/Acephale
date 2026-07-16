// Smoke test for the high-value security vocabulary, tier derivation, and
// SOP checklist template. Run: npx tsx scripts/security-sop.test.ts

import {
  COMMODITY_CATEGORY_VALUES,
  LOAD_SECURITY_CHECKLIST,
  SECURITY_TIER_VALUES,
  TRACKING_TYPE_VALUES,
  deriveSecurityTier,
  securityChecklistTemplate,
  tierRank,
} from "../src/lib/security-sop";

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

check("commodity categories are unique", unique(COMMODITY_CATEGORY_VALUES));
check("security tiers are unique", unique(SECURITY_TIER_VALUES));
check("tracking types are unique", unique(TRACKING_TYPE_VALUES));
check("checklist keys are unique", unique(LOAD_SECURITY_CHECKLIST.map((i) => i.key)));
check("tier ranks are ordered", tierRank("standard") < tierRank("elevated") && tierRank("elevated") < tierRank("high_value") && tierRank("high_value") < tierRank("critical"));
check("unknown tier ranks below standard", tierRank("bogus") < tierRank("standard") && tierRank(null) < tierRank("standard"));

// Tier derivation: max(value ladder, category floor); null with no signal.
check("no signal derives no suggestion", deriveSecurityTier({}) === null);
check("unknown category alone derives no suggestion", deriveSecurityTier({ commodityCategory: "furniture" }) === null);
check("GPU load with no value floors at elevated", deriveSecurityTier({ commodityCategory: "servers_gpu" }) === "elevated");
check("GPU load at $150k derives high_value", deriveSecurityTier({ commodityCategory: "servers_gpu", declaredValue: 150_000 }) === "high_value");
check("GPU load at $800k derives critical", deriveSecurityTier({ commodityCategory: "servers_gpu", declaredValue: 800_000 }) === "critical");
check("batteries floor at elevated even at low value", deriveSecurityTier({ commodityCategory: "batteries_un3480", declaredValue: 5_000 }) === "elevated");
check("non-tech follows the value ladder", deriveSecurityTier({ commodityCategory: "non_tech", declaredValue: 10_000 }) === "standard");
check("non-tech at $600k still derives critical", deriveSecurityTier({ commodityCategory: "non_tech", declaredValue: 600_000 }) === "critical");
check("value alone works without a category", deriveSecurityTier({ declaredValue: 120_000 }) === "high_value");
check("zero value is treated as no value signal", deriveSecurityTier({ declaredValue: 0 }) === null);

// Checklist template: standard = empty, higher tiers are supersets.
check("standard tier seeds no checklist", securityChecklistTemplate("standard").length === 0);
check("null tier seeds no checklist", securityChecklistTemplate(null).length === 0);
const elevated = securityChecklistTemplate("elevated").map((i) => i.key);
const highValue = securityChecklistTemplate("high_value").map((i) => i.key);
const critical = securityChecklistTemplate("critical").map((i) => i.key);
check("elevated tier has the base SOP items", elevated.length === 5 && elevated.includes("verified_phone_dispatch"));
check("high_value adds seal/CDL/no-drop items", highValue.length === 9 && highValue.includes("seal_applied"));
check("critical adds team/covert-tracker/route items", critical.length === LOAD_SECURITY_CHECKLIST.length);
check("higher tiers are supersets of lower tiers", elevated.every((k) => highValue.includes(k)) && highValue.every((k) => critical.includes(k)));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll security-sop checks passed");
