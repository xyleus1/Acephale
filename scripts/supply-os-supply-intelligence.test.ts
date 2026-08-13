import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supplySupplierKey, supplySupplierKeyWithDomainConflict } from "../src/lib/supply-os/supply-intelligence-persistence";

const observedAt = "2026-08-11T12:00:00.000Z";
const source = "https://supplier.example/catalog/part-1";
const envelope = (value: unknown, sourceUrl = source, at = observedAt) => ({
  value,
  state: "SUPPORTED",
  freshness: "FRESH",
  sources: [{ url: sourceUrl, sourceType: "OFFICIAL" }],
  observedAt: at,
});

const candidate = {
  companyName: "Example Components, Inc.",
  website: "https://supplier.example/",
  country: envelope("United States"),
  price: envelope(12.5),
  currency: envelope("USD"),
  unitOfMeasure: envelope("piece"),
};

assert.equal(supplySupplierKey(candidate), supplySupplierKey({ ...candidate, companyName: "  EXAMPLE components inc " }), "supplier identity must ignore punctuation and case");
assert.notEqual(supplySupplierKey({ ...candidate, companyName: "华为" }), supplySupplierKey({ ...candidate, companyName: "小米" }), "non-Latin supplier names must remain distinct");
assert.equal(supplySupplierKey({ ...candidate, website: null }), supplySupplierKey(candidate), "discovering a website later must not split one supplier profile");
const baseSupplierKey = supplySupplierKey(candidate);
assert.equal(supplySupplierKeyWithDomainConflict({ baseKey: baseSupplierKey, incomingDomain: "supplier.example", existingDomain: null }), baseSupplierKey, "later website discovery must enrich the base profile");
assert.equal(supplySupplierKeyWithDomainConflict({ baseKey: baseSupplierKey, incomingDomain: null, existingDomain: "supplier.example" }), baseSupplierKey, "a missing incoming domain must not split a known profile");
assert.equal(supplySupplierKeyWithDomainConflict({ baseKey: baseSupplierKey, incomingDomain: "supplier.example", existingDomain: "supplier.example" }), baseSupplierKey, "the same known domain must reuse a profile");
const conflictingDomainKey = supplySupplierKeyWithDomainConflict({ baseKey: baseSupplierKey, incomingDomain: "different.example", existingDomain: "supplier.example" });
assert.notEqual(conflictingDomainKey, baseSupplierKey, "same-name suppliers with conflicting known domains must not merge");
assert.equal(conflictingDomainKey, supplySupplierKeyWithDomainConflict({ baseKey: baseSupplierKey, incomingDomain: "different.example", existingDomain: "supplier.example" }), "domain conflict disambiguation must be deterministic");

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260812000100_supply_intelligence_profiles/migration.sql", import.meta.url), "utf8");
const sourcingRoute = readFileSync(new URL("../src/app/api/supply-os/supplier-research/route.ts", import.meta.url), "utf8");
const procurement = readFileSync(new URL("../src/lib/supply-os/procurement-case-persistence.ts", import.meta.url), "utf8");
const intelligencePersistence = readFileSync(new URL("../src/lib/supply-os/supply-intelligence-persistence.ts", import.meta.url), "utf8");

for (const model of ["SupplySupplierProfile", "SupplyProfileFact", "SupplyBenchmarkSeries", "SupplyPriceObservation"]) {
  assert.match(schema, new RegExp(`model ${model} \\{`));
  assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
}
assert.match(migration, /SupplyProfileFact_append_only_guard/);
assert.match(migration, /SupplyPriceObservation_append_only_guard/);
assert.match(sourcingRoute, /workspaceId \? supplyIntelligenceProfile\(context, workspaceId\) : null/);
assert.match(sourcingRoute, /listProcurementCasesForResearchRuns\(context, page\.runs\.map\(\(run\) => run\.id\), workspaceId\)/);
assert.match(procurement, /researchWorkspace\(accessContext, args\.researchRunId, "edit"\)/);
assert.match(procurement, /!qualityVerificationPassed\(qualityPlan\)/);
assert.match(procurement, /!qualityVerificationPassed\(approvedQualityPlan\)/);
assert.match(intelligencePersistence, /parseStoredSupplierResearchRetrievalCapture/);
assert.match(intelligencePersistence, /validateExaPublicListingReceipts/);
assert.match(intelligencePersistence, /validatePublicSupplierLeadReceipts/);
assert.match(intelligencePersistence, /stored\.provider === receipt\.provider/);
assert.match(intelligencePersistence, /stored\.freshnessPolicy === receipt\.freshnessPolicy/);
assert.match(intelligencePersistence, /if \(!leadReceipt && !listingReceipts\.length\) continue;/, "unsupported search-only rows must not become durable supplier profiles");
assert.match(intelligencePersistence, /const roles = leadReceipt \? \[leadReceipt\.role\] : \[\];/, "only a server-rebuilt lead receipt may add a durable supplier role");
assert.match(intelligencePersistence, /observationType: "PUBLIC_LIST_PRICE"/);
assert.match(intelligencePersistence, /sourceType: "MANAGED_PUBLIC_RETRIEVAL"/);
assert.doesNotMatch(intelligencePersistence, /record\(candidate\.price\).*supplyPriceObservation/s, "ordinary provider claims must not create durable price observations");
assert.match(intelligencePersistence, /supplyProfileFact\.count/);
assert.match(intelligencePersistence, /supplySupplierProfile\.count/);

console.log("Supply OS customer profile, supplier universe, and price trust contract passed.");
