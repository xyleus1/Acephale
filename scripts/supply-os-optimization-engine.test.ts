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
  const expectedWorkstreams = expectedProfile === "Aerospace and defense hardware company"
    ? ["procurement", "supplier_outreach", "procurement", "shipment_planning", "supplier_outreach", "customs", "shipment_planning", "fulfillment"]
    : ["procurement", "supplier_outreach", "shipment_planning", "customs", "fulfillment"];
  assert.equal(profileModel.actions.length, expectedWorkstreams.length);
  assert.deepEqual(profileModel.actions.map((action) => action.workstreamId), expectedWorkstreams);
  assert.ok(profileModel.actions.every((action) => action.measure), "every recommendation needs a measurable operating outcome");
}

const odysResearch: SupplyCompanyResearch = {
  ...noxResearch,
  query: "Odys Aviation",
  company: {
    ...noxResearch.company,
    name: claim("Odys Aviation", "official", "high", ["https://www.odysaviation.com/"]),
    website: "https://www.odysaviation.com/",
    description: claim(
      "Odys designs hybrid VTOL aircraft and high-speed generators for defense, logistics, energy, and passenger missions.",
      "official",
      "high",
      ["https://www.odysaviation.com/"],
    ),
    industry: claim("Advanced aircraft and hybrid propulsion", "official", "high", ["https://www.odysaviation.com/"]),
    headquarters: claim("Long Beach, California", "public", "medium", ["https://example.com/odys-public"]),
    locations: [{
      ...claim("Long Beach, California", "public", "medium", ["https://example.com/odys-public"]),
      role: "assembly",
      coordinates: { latitude: 33.7701, longitude: -118.1937 },
    }],
    products: [
      claim("Laila hybrid VTOL aircraft", "official", "high", ["https://www.odysaviation.com/"]),
      claim("Hybrid power systems", "official", "high", ["https://www.odysaviation.com/"]),
    ],
    customerMarkets: [
      claim("Defense and logistics", "official", "high", ["https://www.odysaviation.com/"]),
      claim("Oman, Fiji, and European demonstration programs", "public", "medium", ["https://example.com/odys-public"]),
    ],
    likelyInputs: [
      claim("power electronics and SiC inverters", "inferred", "medium", []),
      claim("composite structures and machined flight hardware", "inferred", "medium", []),
      claim("avionics and mission systems", "inferred", "medium", []),
    ],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
  findings: [
    {
      title: "International propulsion partnership",
      detail: "A United Kingdom power-electronics partner supports the hybrid propulsion system.",
      implication: "Build-critical electronics need part-level continuity and an international inbound lane.",
      basis: "public",
      confidence: "high",
      sourceUrls: ["https://example.com/odys-public"],
    },
    {
      title: "Program demand needs gating",
      detail: "The public order picture distinguishes firm aircraft demand from provisional interest.",
      implication: "Long-lead commitments should follow named program and configuration gates.",
      basis: "public",
      confidence: "high",
      sourceUrls: ["https://example.com/odys-public"],
    },
  ],
  evidence: [
    {
      url: "https://www.odysaviation.com/",
      title: "Odys Aviation",
      sourceType: "official_website",
      accessedAt: researchedAt,
    },
    {
      url: "https://example.com/odys-public",
      title: "Odys public program evidence",
      sourceType: "public_source",
      accessedAt: researchedAt,
    },
  ],
};

const odysModel = buildSupplyOptimizationModel(
  generateSupplyCase("Odys Aviation", new Date(researchedAt), "full_operation", odysResearch),
);
assert.equal(odysModel.profile, "Advanced aircraft and propulsion OEM");
assert.ok(odysModel.nodes.some((node) => /UK|United Kingdom|European propulsion/i.test(`${node.label} ${node.location}`)));
assert.ok(odysModel.nodes.some((node) => /Oman|GCC/i.test(`${node.label} ${node.location}`)));
assert.ok(odysModel.nodes.some((node) => /Fiji|Pacific/i.test(`${node.label} ${node.location}`)));
assert.ok(odysModel.nodes.some((node) => /Europe/i.test(`${node.label} ${node.location}`)));
assert.deepEqual(odysModel.actions.map((action) => action.title), [
  "Control the critical BOM below Tier 1",
  "Gate supplier commitments against validated program demand",
  "Pre-kit every aircraft by serial number and station",
  "Separate prototype freight from production shipsets",
  "Gate flight-critical suppliers for production readiness",
  "Create part-level customs and export passports",
  "Choose gateways and factory lanes on variability, not rate alone",
  "Stage deployment spares before aircraft delivery",
]);
assert.ok(odysModel.actions.every((action) => action.measure));

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

const montrealResearch: SupplyCompanyResearch = {
  ...noxResearch,
  company: {
    ...noxResearch.company,
    name: claim("AON3D", "official", "high", ["https://www.aon3d.com/"]),
    website: "https://www.aon3d.com/",
    description: claim("AON3D builds industrial additive manufacturing systems.", "official", "high", ["https://www.aon3d.com/"]),
    industry: claim("Industrial additive manufacturing", "official", "high", ["https://www.aon3d.com/"]),
    headquarters: claim("Montreal", "official", "high", ["https://www.aon3d.com/"]),
    locations: [{
      ...claim("Montreal", "official", "high", ["https://www.aon3d.com/"]),
      role: "assembly",
      coordinates: null,
    }],
    likelySourceRegions: [],
    likelyDestinations: [],
  },
};
const montrealModel = buildSupplyOptimizationModel(
  generateSupplyCase("AON3D", new Date(researchedAt), "full_operation", montrealResearch),
);
assert.deepEqual(
  montrealModel.nodes.find((node) => node.kind === "processing_site")?.coordinates,
  { latitude: 45.5019, longitude: -73.5674 },
  "a verified Montreal label must remain drawable when the research provider omits coordinates",
);
assert.ok(montrealModel.edges.length > 0, "known factory geography must not discard every connected lane");

const phoenixCase = generateSupplyCase(
  "Company: Acme Robotics\nLocated: Phoenix, Arizona\nProduction: Phoenix, Arizona\nIndustrial robotics manufacturer\nNeeds: controls and machined components\nSources: Tulsa, Oklahoma\nShips to: Los Angeles, California",
  new Date(researchedAt),
);
const phoenixModel = buildSupplyOptimizationModel(phoenixCase);
assert.deepEqual(
  phoenixModel.nodes.find((node) => node.kind === "processing_site")?.coordinates,
  { latitude: 33.4484, longitude: -112.074 },
);
assert.ok(
  phoenixModel.edges.every((edge) => /truck|ltl/i.test(edge.mode)),
  "known domestic endpoints must not inherit an international profile mode",
);

console.log("supply OS optimization engine checks passed");
