import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { legacySupplyOsDestination } from "../src/lib/supply-os/legacy-route-map";

const expectedPanels = new Map([
  ["/dashboard/crm", "materials"],
  ["/dashboard/crm/companies/company-1", "materials"],
  ["/dashboard/rfq", "materials"],
  ["/dashboard/rfq/inquiry-1", "materials"],
  ["/dashboard/outreach", "materials"],
  ["/dashboard/intel", "scenarios"],
  ["/dashboard/intel/load", "scenarios"],
  ["/dashboard/intelligence", "scenarios"],
  ["/dashboard/brain", "scenarios"],
  ["/dashboard/pricing", "scenarios"],
  ["/dashboard/reports", "scenarios"],
  ["/dashboard/jobs/job-1", "logistics"],
  ["/dashboard/loads", "logistics"],
  ["/dashboard/carriers/carrier-1", "logistics"],
  ["/dashboard/domestic-pricing", "logistics"],
  ["/dashboard/inbox", "tracking"],
  ["/dashboard/activity", "tracking"],
  ["/dashboard/supply-os/new", "materials"],
  ["/dashboard/supply-os/workstreams/procurement", "materials"],
  ["/dashboard/supply-os/workstreams/supplier-outreach", "materials"],
  ["/dashboard/supply-os/workstreams/shipment-planning", "logistics"],
  ["/dashboard/supply-os/workstreams/customs", "logistics"],
  ["/dashboard/supply-os/workstreams/fulfillment", "fulfillment"],
]);

for (const [pathname, panel] of expectedPanels) {
  const mapped = legacySupplyOsDestination(pathname, "?source=bookmark&present=1&case=local-demo");
  assert.ok(mapped, `${pathname} should enter Supply OS`);
  const url = new URL(mapped, "https://derya.test");
  assert.equal(url.pathname, "/dashboard/supply-os");
  assert.equal(url.searchParams.get("panel"), panel);
  assert.equal(url.searchParams.get("source"), "bookmark");
  assert.equal(url.searchParams.get("legacyPath"), pathname);
  assert.equal(url.searchParams.has("present"), false);
  assert.equal(url.searchParams.has("case"), false);
}

const optimizationEngine = readFileSync(resolve(process.cwd(), "src/lib/supply-os-optimization-engine.ts"), "utf8");
assert.doesNotMatch(optimizationEngine, /\/dashboard\/supply-os\/workstreams\//, "new links must target tenant-backed Supply OS panels directly");
assert.doesNotMatch(optimizationEngine, /[?&]present=1/, "new links must not restore presentation mode");
const dashboardSource = readFileSync(resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
assert.doesNotMatch(dashboardSource, /loadSupplyCases|SUPPLY_CASE_STORAGE_KEY/, "the active dashboard must not load customer records from browser storage");
assert.doesNotMatch(dashboardSource, /href=\{\{\s*pathname:\s*workspace\.route/, "workstream links must not carry browser-only customer identifiers");

for (const preserved of [
  "/dashboard/supply-os",
  "/dashboard/admin",
  "/dashboard/settings/email",
  "/dashboard/customer-portal",
]) {
  assert.equal(legacySupplyOsDestination(preserved), null, `${preserved} must remain a utility surface`);
}

const middleware = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
assert.match(middleware, /req\.method === "GET" \|\| req\.method === "HEAD"/);
assert.match(middleware, /legacySupplyOsDestination\(pathname, req\.nextUrl\.search\)/);
const researchPage = readFileSync(resolve(process.cwd(), "src/app/dashboard/supply-os/page.tsx"), "utf8");
assert.match(researchPage, /initialResearchQuery/);
assert.match(researchPage, /initialResearchStatus/);
assert.match(researchPage, /initialResearchPage/);
assert.match(researchPage, /validResearchStatuses/);
const prospectSource = readFileSync(resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-prospects.tsx"), "utf8");
assert.match(prospectSource, /initialQuery/);
assert.match(prospectSource, /initialStatus/);
assert.match(prospectSource, /initialPage/);

const retiredPageStubs = new Map([
  ["src/app/dashboard/page.tsx", "materials"],
  ["src/app/dashboard/activity/page.tsx", "tracking"],
  ["src/app/dashboard/brain/page.tsx", "scenarios"],
  ["src/app/dashboard/carriers/page.tsx", "logistics"],
  ["src/app/dashboard/carriers/[carrierId]/page.tsx", "logistics"],
  ["src/app/dashboard/crm/page.tsx", "materials"],
  ["src/app/dashboard/domestic-pricing/page.tsx", "logistics"],
  ["src/app/dashboard/inbox/page.tsx", "tracking"],
  ["src/app/dashboard/outreach/page.tsx", "materials"],
  ["src/app/dashboard/pricing/page.tsx", "scenarios"],
  ["src/app/dashboard/reports/page.tsx", "scenarios"],
  ["src/app/dashboard/search/page.tsx", "materials"],
]);

for (const [file, panel] of retiredPageStubs) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  assert.match(source, /redirectLegacyOperatorSurface/);
  assert.match(source, new RegExp(`redirectLegacyOperatorSurface\\("${panel}"\\)`));
  assert.doesNotMatch(source, /@\/components|@\/lib\/prisma|requireSession|<main|<section/);
}

console.log("Supply OS legacy route cutover contract passed.");
