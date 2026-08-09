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
  const mapped = legacySupplyOsDestination(pathname, "?source=bookmark");
  assert.ok(mapped, `${pathname} should enter Supply OS`);
  const url = new URL(mapped, "https://derya.test");
  assert.equal(url.pathname, "/dashboard/supply-os");
  assert.equal(url.searchParams.get("panel"), panel);
  assert.equal(url.searchParams.get("source"), "bookmark");
  assert.equal(url.searchParams.get("legacyPath"), pathname);
}

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
