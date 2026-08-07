import assert from "node:assert/strict";
import { extractLogoFromHtml, normalizeCompanyResearch } from "../src/lib/supply-os-company-research";
import { generateSupplyCase, parseStoredSupplyCases, serializeSupplyCases } from "../src/lib/supply-os-case-model";

const official = "https://www.aon3d.com/about/";
const products = "https://www.aon3d.com/";
const researchedAt = "2026-08-06T12:00:00.000Z";
const raw = {
  status: "verified",
  company: {
    name: claim("AON3D", "official", "high", [official]),
    website: "https://www.aon3d.com/",
    logoUrl: "https://unverified.example/logo.png",
    description: claim("Industrial additive-manufacturing hardware, software, and materials company.", "official", "high", [official]),
    industry: claim("Industrial additive manufacturing", "official", "high", [official]),
    headquarters: claim("Montreal, Quebec, Canada", "official", "high", [official]),
    locations: [
      {
        ...claim("Montreal, Quebec, Canada", "official", "high", [official]),
        role: "manufacturing",
        coordinates: { latitude: 45.5019, longitude: -73.5674 },
      },
      {
        ...claim("United States", "official", "medium", [official]),
        role: "customer_market",
        coordinates: { latitude: 39.8283, longitude: -98.5795 },
      },
    ],
    products: [claim("Hylo industrial 3D printer", "official", "high", [products])],
    customerMarkets: [claim("Aerospace and manufacturing", "official", "high", [products])],
    likelyInputs: [claim("motion-control components", "inferred", "medium", [])],
    likelySourceRegions: [claim("China", "inferred", "low", [])],
    likelyDestinations: [claim("United States", "inferred", "medium", [])],
  },
  findings: [{
    title: "Large industrial hardware",
    detail: "The company sells production-ready industrial printers.",
    implication: "Inbound components and outbound machine delivery both warrant discovery.",
    basis: "official",
    confidence: "high",
    sourceUrls: [products],
  }],
  evidence: [
    { url: official, title: "About AON3D", sourceType: "official_website" },
    { url: products, title: "AON3D products", sourceType: "official_website" },
    { url: "https://unverified.example/story", title: "Unverified", sourceType: "public_source" },
  ],
  warnings: ["Source countries and customer shipment destinations are hypotheses until AON3D confirms them."],
};

function claim(value: string, basis: "official" | "public" | "inferred", confidence: "high" | "medium" | "low", sourceUrls: string[]) {
  return { value, basis, confidence, sourceUrls };
}

const logo = extractLogoFromHtml(
  '<html><head><link rel="icon" href="/favicon.png"><script type="application/ld+json">{"logo":"/brand/aon3d.svg"}</script></head></html>',
  "https://www.aon3d.com/about/",
);
assert.equal(logo, "https://www.aon3d.com/brand/aon3d.svg");
assert.equal(
  extractLogoFromHtml('<meta name="twitter:image" content="https://unverified.example/logo.png">', official),
  null,
  "official-page logo discovery must not turn a third-party URL into client-loaded content",
);

const research = normalizeCompanyResearch({
  raw,
  query: "AON3D",
  researchedAt,
  webSourceUrls: [official, products],
  homepage: { url: "https://www.aon3d.com/", logoUrl: "https://www.aon3d.com/brand/aon3d.svg" },
});

assert.equal(research.status, "verified");
assert.equal(research.company.name.value, "AON3D");
assert.equal(research.company.logoUrl, "https://www.aon3d.com/brand/aon3d.svg", "cross-domain model logos must be rejected");
assert.equal(research.evidence.length, 2, "only provider-attributed web sources may survive normalization");
assert.equal(research.company.likelyInputs[0]?.basis, "inferred");
assert.deepEqual(research.company.likelyInputs[0]?.sourceUrls, []);

const dashboard = generateSupplyCase("AON3D, https://www.aon3d.com", new Date(researchedAt), "full_operation", research);
assert.equal(dashboard.companyName, "AON3D");
assert.equal(dashboard.research?.company.website, "https://www.aon3d.com/");
assert.equal(dashboard.company.sourcingNeeds[0]?.status, "verify", "research hypotheses must not become confirmed operating facts");
assert.equal(dashboard.company.sourceRegions[0]?.status, "verify");
assert.equal(dashboard.company.destinations[0]?.status, "verify");
const productionNode = dashboard.routeNodes.find((node) => node.kind === "headquarters");
assert.deepEqual(productionNode?.coordinates, { latitude: 45.5019, longitude: -73.5674 });

const compactFallback = generateSupplyCase(
  "Company: AON3D Located: Montreal, Quebec, Canada Production: Montreal, Quebec, Canada AON3D makes industrial printers. Sources: motion controls from Shenzhen, China Ships to: Detroit, Michigan",
  new Date(researchedAt),
);
assert.equal(compactFallback.company.headquarters.value, "Montreal, Quebec, Canada");
assert.equal(compactFallback.company.productionSite?.value, "Montreal, Quebec, Canada");

const restored = parseStoredSupplyCases(serializeSupplyCases([dashboard]));
assert.equal(restored[0]?.research?.evidence.length, 2, "version 1 browser saves must retain optional research provenance");

console.log("supply OS company research checks passed");
