import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateSupplyCase, type SupplyCompanyResearch } from "../src/lib/supply-os-case-model";
import { buildSupplyCommandMap } from "../src/lib/supply-os-command-map";
import type { SupplyOptimizationModel } from "../src/lib/supply-os-optimization-engine";

const researchedAt = "2026-08-07T12:00:00.000Z";
const sourceUrl = "https://example.gov/aluminum-freight-benchmark";
const research: SupplyCompanyResearch = {
  status: "partial",
  query: "Aluminum processor in Texas",
  researchedAt,
  company: {
    name: claim("Example Metals", "official", ["https://example.com"]),
    website: "https://example.com",
    logoUrl: null,
    description: claim("Cuts aluminum plate in Austin.", "official", ["https://example.com"]),
    industry: claim("Metals processing", "inferred", []),
    headquarters: null,
    locations: [],
    products: [],
    customerMarkets: [],
    likelyInputs: [],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
  findings: [
    {
      title: "Wisconsin to Texas aluminum transport costs increased",
      detail: "The cited public benchmark dated August 5, 2026 shows a higher comparison for this corridor.",
      implication: "Request a current carrier quote and compare an alternate consolidation point before tendering.",
      basis: "public",
      confidence: "medium",
      sourceUrls: [sourceUrl],
    },
    {
      title: "Unverified market rumor",
      detail: "Aluminum might be delayed.",
      implication: "Do not act on this.",
      basis: "inferred",
      confidence: "low",
      sourceUrls: [],
    },
  ],
  evidence: [{
    url: sourceUrl,
    title: "Public freight benchmark",
    sourceType: "public_source",
    accessedAt: researchedAt,
  }],
  warnings: [],
};

function claim(value: string, basis: "official" | "public" | "inferred", sourceUrls: string[]) {
  return { value, basis, confidence: sourceUrls.length ? "high" as const : "low" as const, sourceUrls };
}

const dashboard = generateSupplyCase(
  "Example Metals moves aluminum from Wisconsin to Austin, Texas.",
  new Date(researchedAt),
  "full_operation",
  research,
);
const model: SupplyOptimizationModel = {
  profile: "Metals processor",
  networkSummary: "Aluminum moves from Wisconsin to Texas.",
  nodes: [
    {
      id: "wisconsin-supplier",
      sequence: 1,
      kind: "supplier_cluster",
      label: "Wisconsin aluminum supply",
      location: "Wisconsin, United States",
      coordinates: { latitude: 44.5, longitude: -89.5 },
      basis: "inferred",
      confidence: "low",
      detail: "Source to confirm.",
      cargo: "Aluminum plate",
      confirmNext: "Confirm supplier and origin.",
      qualificationTargets: [],
    },
    {
      id: "texas-factory",
      sequence: 2,
      kind: "processing_site",
      label: "Austin factory",
      location: "Austin, Texas, United States",
      coordinates: { latitude: 30.2672, longitude: -97.7431 },
      basis: "official",
      confidence: "high",
      detail: "Receiving site.",
      cargo: "Aluminum plate",
      confirmNext: "Confirm receiving hours.",
      qualificationTargets: [],
    },
  ],
  edges: [{
    id: "wisconsin-texas",
    fromNodeId: "wisconsin-supplier",
    toNodeId: "texas-factory",
    stage: "inbound",
    mode: "Truck",
    cargo: "Aluminum plate",
    basis: "inferred",
    confidence: "low",
    detail: "Domestic truck lane.",
  }],
  actions: [],
  workspaces: [],
  customerSegments: [],
  assumptions: [],
};

const map = buildSupplyCommandMap(model, dashboard);
assert.equal(map.insights.length, 1, "only a sourced and route-relevant signal should reach the map");
assert.equal(map.insights[0]?.sourceLabel, "Public freight benchmark");
assert.equal(map.insights[0]?.severity, "watch");
assert.equal(map.insights[0]?.routeId, "route:wisconsin-texas");

const dashboardSource = readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");
const mapSource = readFileSync("src/app/dashboard/supply-os/supply-os-command-map.tsx", "utf8");
assert.doesNotMatch(dashboardSource, /Routes and providers are candidates/);
assert.match(dashboardSource, /routeNeedsFlowChart/);
assert.doesNotMatch(mapSource, /NavigationControl/);
assert.doesNotMatch(mapSource, />Open lane</);

console.log("supply-os evidence insight checks passed");
