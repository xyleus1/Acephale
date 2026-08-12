import assert from "node:assert/strict";
import {
  customerDomain,
  normalizeCustomerWebsite,
  parseSupplyCompanyResearch,
} from "../src/lib/supply-os/company-profile";
import { generateSupplyCase } from "../src/lib/supply-os-case-model";

assert.equal(normalizeCustomerWebsite("guildai.co"), "https://guildai.co/");
assert.equal(normalizeCustomerWebsite("http://www.guildai.co/about?ref=test#team"), "https://www.guildai.co/about");
assert.equal(normalizeCustomerWebsite("http://localhost:3000"), null);
assert.equal(normalizeCustomerWebsite("http://127.0.0.1:3000"), null);
assert.equal(normalizeCustomerWebsite("http://192.168.1.2"), null);
assert.equal(normalizeCustomerWebsite("https://user:pass@guildai.co"), null);
assert.equal(normalizeCustomerWebsite("fcc.gov"), "https://fcc.gov/");
assert.equal(normalizeCustomerWebsite("fdic.gov"), "https://fdic.gov/");
assert.equal(customerDomain("https://www.guildai.co/"), "guildai.co");

const researchedAt = "2026-08-11T18:00:00.000Z";
const claim = (value: string, basis: "official" | "public" | "inferred" = "official") => ({
  value,
  basis,
  confidence: "high" as const,
  sourceUrls: basis === "inferred" ? [] : ["https://www.guildai.co/"],
});
const research = {
  status: "verified",
  query: "GUILD, https://www.guildai.co/",
  researchedAt,
  company: {
    name: claim("GUILD"),
    website: "https://www.guildai.co/",
    logoUrl: null,
    description: claim("Defense manufacturing contractor."),
    industry: claim("Defense and aerospace manufacturing"),
    headquarters: null,
    locations: [],
    products: [claim("Aerospace precision parts")],
    customerMarkets: [claim("Government and defense companies")],
    likelyInputs: [claim("Precision metals", "inferred")],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
  findings: [],
  evidence: [{
    url: "https://www.guildai.co/",
    title: "GUILD",
    sourceType: "official_website",
    accessedAt: researchedAt,
  }],
  warnings: ["Supplier and lane details require customer confirmation."],
};

assert.deepEqual(parseSupplyCompanyResearch(research), research);
assert.equal(parseSupplyCompanyResearch({ ...research, company: { name: "GUILD" } }), null);
assert.equal(parseSupplyCompanyResearch({ ...research, researchedAt: "not-a-date" }), null);
const dashboard = generateSupplyCase(research.query, new Date(researchedAt), "full_operation", research);
assert.equal(dashboard.companyName, "GUILD");
assert.equal(dashboard.research?.company.website, "https://www.guildai.co/");
assert.equal(dashboard.sourcePrompt.includes("Atlas Robotics"), false);

console.log("Supply OS company creation checks passed.");
