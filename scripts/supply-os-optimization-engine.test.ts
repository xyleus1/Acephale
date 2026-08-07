import assert from "node:assert/strict";
import { generateSupplyCase, type SupplyCompanyResearch } from "../src/lib/supply-os-case-model";
import {
  buildSupplyOptimizationModel,
  SUPPLY_OPTIMIZATION_WORKSPACES,
  supplyOptimizationWorkspace,
} from "../src/lib/supply-os-optimization-engine";

const researchedAt = "2026-08-07T12:00:00.000Z";
const noxResearch: SupplyCompanyResearch = {
  status: "partial",
  query: "do nox metals",
  researchedAt,
  company: {
    name: claim("NOX METALS", "official", "high", ["https://noxmetals.co/"]),
    website: "https://noxmetals.co/",
    logoUrl: null,
    description: claim(
      "Nox Metals cuts 6061, 7075, 7050, and 5000-series aluminum plate to size from Detroit, MI.",
      "official",
      "high",
      ["https://noxmetals.co/"],
    ),
    industry: claim("Metals processing and distribution", "inferred", "medium", []),
    headquarters: claim("1350 Jarvis St, Ferndale, MI, 48220, US", "official", "high", ["https://noxmetals.co/"]),
    locations: [{
      ...claim("1350 Jarvis St, Ferndale, MI, 48220, US", "official", "high", ["https://noxmetals.co/"]),
      role: "headquarters",
      coordinates: { latitude: 42.4606, longitude: -83.1346 },
    }],
    products: [claim("Aluminum plate cut to size", "official", "high", ["https://noxmetals.co/"])],
    customerMarkets: [claim("Aerospace", "official", "medium", ["https://noxmetals.co/"])],
    likelyInputs: [
      claim("mill-sourced aluminum plate / block", "inferred", "medium", []),
      claim("steel or specialty-alloy stock to confirm", "inferred", "low", []),
      claim("protective packaging materials", "inferred", "medium", []),
    ],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
  findings: [],
  evidence: [{
    url: "https://noxmetals.co/",
    title: "NOX METALS",
    sourceType: "official_website",
    accessedAt: researchedAt,
  }],
  warnings: [],
};

function claim(
  value: string,
  basis: "official" | "public" | "inferred",
  confidence: "high" | "medium" | "low",
  sourceUrls: string[],
) {
  return { value, basis, confidence, sourceUrls };
}

const nox = generateSupplyCase("do nox metals", new Date(researchedAt), "full_operation", noxResearch);
const model = buildSupplyOptimizationModel(nox);

assert.equal(model.profile, "Metals service center and processor");
assert.equal(model.nodes.filter((node) => node.kind === "supplier_cluster").length, 3);
assert.equal(model.nodes.filter((node) => node.kind === "processing_site").length, 1);
assert.equal(model.nodes.filter((node) => node.kind === "customer_cluster").length, 2);
assert.equal(model.edges.filter((edge) => edge.stage === "inbound").length, 3);
assert.equal(model.edges.filter((edge) => edge.stage === "outbound").length, 2);
assert.ok(model.nodes.some((node) => node.label.includes("Domestic aerospace plate mills")));
assert.ok(model.nodes.some((node) => node.label.includes("Great Lakes service-center")));
assert.ok(model.nodes.some((node) => node.location.includes("Southern Ontario")));
assert.ok(model.nodes.some((node) => node.location.includes("Detroit manufacturing corridor")));
assert.ok(model.nodes.some((node) => node.label.includes("National aerospace")));
assert.equal(model.nodes.find((node) => node.kind === "processing_site")?.basis, "official");
assert.ok(model.edges.every((edge) => edge.basis === "inferred"), "unobserved movements must stay inferred");
const millTargets = model.nodes.find((node) => node.label.includes("Domestic aerospace plate mills"))?.qualificationTargets ?? [];
assert.deepEqual(millTargets.map((target) => target.name), [
  "Arconic Davenport Works",
  "Constellium Ravenswood",
  "Kaiser Aluminum Trentwood",
]);
assert.ok(millTargets.every((target) => target.url?.startsWith("https://")));
assert.ok(model.nodes.every((node) => Array.isArray(node.qualificationTargets)));

assert.deepEqual(model.actions.map((action) => action.workstreamId), [
  "procurement",
  "supplier_outreach",
  "shipment_planning",
  "customs",
  "fulfillment",
]);
assert.match(model.actions[0]?.title ?? "", /grade-by-grade source matrix/i);
assert.match(model.actions[0]?.currentCondition ?? "", /6061\/7075\/7050|critical grades/i);
assert.match(model.actions[3]?.recommendation ?? "", /melt and cast|HTS|origin/i);
assert.ok(model.actions.every((action) => action.decision && action.requiredInput));

assert.equal(SUPPLY_OPTIMIZATION_WORKSPACES.length, 5);
assert.equal(supplyOptimizationWorkspace("shipment-planning")?.id, "shipment_planning");
assert.equal(supplyOptimizationWorkspace("unknown"), null);

const explicit = generateSupplyCase(
  "Atlas Robotics builds robots in Austin, Texas. It sources motors from Shenzhen, China and ships robots to Detroit, Michigan.",
  new Date(researchedAt),
);
const explicitModel = buildSupplyOptimizationModel(explicit);
assert.equal(explicitModel.nodes.filter((node) => node.kind === "supplier_cluster").length, 1);
assert.equal(explicitModel.nodes.find((node) => node.kind === "supplier_cluster")?.basis, "customer_stated");
assert.equal(explicitModel.nodes.filter((node) => node.kind === "customer_cluster").length, 1);
assert.equal(explicitModel.nodes.find((node) => node.kind === "customer_cluster")?.basis, "customer_stated");
assert.ok(explicitModel.edges.every((edge) => edge.basis === "customer_stated"));
assert.ok(explicitModel.nodes.every((node) => node.qualificationTargets.length === 0));

const profileCases = [
  ["AON3D makes industrial additive manufacturing printers in Montreal.", "Industrial additive-manufacturing company"],
  ["Atlas builds autonomous warehouse robots in Austin.", "Robotics and industrial hardware manufacturer"],
  ["Orbital Forge builds satellite and defense avionics in Los Angeles.", "Aerospace and defense hardware company"],
  ["MedSight builds clinical diagnostic medical devices in Boston.", "Medical-device manufacturer"],
  ["PolyLab makes specialty resin and chemical coatings in Houston.", "Chemical and advanced-materials company"],
  ["RoadCell builds EV automotive components in Detroit.", "Automotive and mobility manufacturer"],
  ["Fixture Works builds industrial equipment in Cleveland.", "Industrial hardware company"],
] as const;

for (const [prompt, expectedProfile] of profileCases) {
  const profileModel = buildSupplyOptimizationModel(generateSupplyCase(prompt, new Date(researchedAt)));
  assert.equal(profileModel.profile, expectedProfile, `${prompt} should select the right operating profile`);
  assert.equal(profileModel.actions.length, 5);
  assert.deepEqual(profileModel.actions.map((action) => action.workstreamId), [
    "procurement",
    "supplier_outreach",
    "shipment_planning",
    "customs",
    "fulfillment",
  ]);
}

const publicResearch: SupplyCompanyResearch = {
  ...noxResearch,
  company: {
    ...noxResearch.company,
    locations: [{
      ...claim("Ferndale, Michigan", "public", "medium", ["https://example.com/public-source"]),
      role: "headquarters",
      coordinates: { latitude: 42.4606, longitude: -83.1346 },
    }],
    likelySourceRegions: [claim("Ontario, Canada", "public", "medium", ["https://example.com/public-source"])],
    likelyDestinations: [claim("California", "public", "medium", ["https://example.com/public-source"])],
  },
};
const publicModel = buildSupplyOptimizationModel(
  generateSupplyCase("Nox Metals", new Date(researchedAt), "full_operation", publicResearch),
);
assert.equal(publicModel.nodes.find((node) => node.kind === "supplier_cluster")?.basis, "public");
assert.equal(publicModel.nodes.find((node) => node.kind === "customer_cluster")?.basis, "public");
assert.equal(publicModel.nodes.find((node) => node.kind === "processing_site")?.basis, "public");
assert.ok(publicModel.edges.every((edge) => edge.basis === "inferred"), "public endpoints do not prove an observed route");

console.log("supply OS optimization engine checks passed");
