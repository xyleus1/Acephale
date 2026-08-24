import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSupplyCompanyResearch,
  toManualSupplyCompanyResearch,
} from "../src/lib/supply-os/company-profile";

const root = process.cwd();
const route = readFileSync(
  resolve(root, "src/app/api/supply-os/workspaces/[workspaceId]/company-profile/route.ts"),
  "utf8",
);
const dashboard = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);
const persistence = readFileSync(resolve(root, "src/lib/supply-os/customer-workspace.ts"), "utf8");

const claim = (value: string) => ({
  value,
  basis: "inferred" as const,
  confidence: "low" as const,
  sourceUrls: [],
});
const submitted = {
  status: "partial" as const,
  query: "manual input",
  researchedAt: "2026-08-24T12:00:00.000Z",
  company: {
    name: claim("Mert Manufacturing"),
    website: "https://mert.example",
    logoUrl: null,
    description: claim("Builds custom industrial assemblies."),
    industry: claim("Industrial manufacturing"),
    headquarters: claim("Long Beach, California", "official", "high", ["https://mert.example/about"]),
    locations: [{
      ...claim("Long Beach, California", "official", "high", ["https://mert.example/about"]),
      role: "headquarters" as const,
      coordinates: null,
    }],
    products: [],
    customerMarkets: [],
    likelyInputs: [claim("Aluminum")],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
  findings: [],
  evidence: [],
  warnings: [],
};

const parsed = parseSupplyCompanyResearch(submitted);
assert.ok(parsed);
const manual = toManualSupplyCompanyResearch(parsed, "2026-08-24T12:01:00.000Z");
assert.equal(manual.status, "partial");
assert.equal(manual.query, "Manual profile supplied by tenant");
assert.deepEqual(manual.evidence, []);
assert.deepEqual(manual.findings, []);
assert.equal(manual.company.website, submitted.company.website);
assert.equal(manual.company.headquarters?.value, "Long Beach, California");
assert.ok(manual.warnings.some((warning) => warning.includes("Not verified")));
assert.equal(manual.company.name.basis, "inferred");
assert.equal(manual.company.name.confidence, "low");
assert.deepEqual(manual.company.name.sourceUrls, []);
assert.equal(manual.company.likelyInputs[0]?.basis, "inferred");
assert.deepEqual(manual.company.likelyInputs[0]?.sourceUrls, []);
const manualClaims = [
  manual.company.name,
  manual.company.description,
  manual.company.industry,
  ...manual.company.locations,
  ...manual.company.products,
  ...manual.company.customerMarkets,
  ...manual.company.likelyInputs,
  ...manual.company.likelySourceRegions,
  ...manual.company.likelyDestinations,
];
for (const manualClaim of manualClaims) {
  assert.notEqual(manualClaim.basis, "official");
  assert.deepEqual(manualClaim.sourceUrls, []);
}

assert.equal(parseSupplyCompanyResearch({ ...submitted, company: { ...submitted.company, industry: null } }), null);

assert.match(route, /await requireSupplyWorkspace\(access, workspaceId, "edit"\)/);
assert.match(route, /parseSupplyCompanyResearch\(manualProfile\)/);
assert.match(route, /toManualSupplyCompanyResearch\(parsed\)/);
assert.match(route, /manualProfile === undefined/);
assert.match(route, /researchCompany\(/);
assert.match(route, /storeSupplyCompanyResearch\(\{ context: access, workspaceId, research \}\)/);
assert.match(route, /SupplyPersistenceError\("A valid manual company profile is required\."/);
assert.match(dashboard, /method: "POST"/);
assert.match(dashboard, /body: JSON\.stringify\(\{ manualProfile \}\)/);
assert.match(dashboard, /manualProfileWebsite/);
assert.match(dashboard, /manualProfileHeadquarters/);
assert.match(dashboard, /role: "headquarters"/);
assert.match(dashboard, /Enter profile/);
assert.match(persistence, /manual \? "OPERATOR_INPUT" : "official_website"/);
assert.match(persistence, /sourceUri: manual \? null/);

console.log("Supply OS company profile route checks passed.");
