import assert from "node:assert/strict";
import { generateSupplyCase } from "../src/lib/supply-os-case-model";
import { buildSupplyCommandMap } from "../src/lib/supply-os-command-map";
import {
  buildSupplyOptimizationModel,
  type SupplyOptimizationModel,
} from "../src/lib/supply-os-optimization-engine";

const dashboard = generateSupplyCase(
  "A metals processor in Ferndale, Michigan buys certified aluminum plate from Southern Ontario and sells cut material to Detroit manufacturers.",
  new Date("2026-08-07T12:00:00.000Z"),
);

const model: SupplyOptimizationModel = {
  profile: "Metals service center and processor",
  networkSummary: "Certified aluminum plate moves from Ontario into a Ferndale processor and then to Detroit customers.",
  nodes: [
    {
      id: "supplier-ontario",
      sequence: 1,
      kind: "supplier_cluster",
      label: "Southern Ontario plate supply",
      location: "Hamilton and Southern Ontario",
      coordinates: { latitude: 43.2557, longitude: -79.8711 },
      basis: "inferred",
      confidence: "low",
      detail: "Alternate plate inventory close to the Michigan operation.",
      cargo: "Certified aluminum plate",
      confirmNext: "Confirm alloy, origin, mill certification, availability, and delivered cost.",
      qualificationTargets: [{
        name: "Samuel Service Center Canada",
        fit: "Canadian service-center network with aluminum plate capability.",
        url: "https://www.samuelservicecenter.com/en/service-center-products/aluminum",
      }],
    },
    {
      id: "factory-ferndale",
      sequence: 2,
      kind: "processing_site",
      label: "Ferndale processing site",
      location: "Ferndale, Michigan, United States",
      coordinates: { latitude: 42.4606, longitude: -83.1346 },
      basis: "official",
      confidence: "high",
      detail: "Receive plate, cut to size, retain certifications, and release customer orders.",
      cargo: "Aluminum plate and cut material",
      confirmNext: "Connect purchase orders, inventory, and outbound order history.",
      qualificationTargets: [],
    },
    {
      id: "customers-detroit",
      sequence: 3,
      kind: "customer_cluster",
      label: "Detroit manufacturing customers",
      location: "Detroit manufacturing corridor",
      coordinates: { latitude: 42.3314, longitude: -83.0458 },
      basis: "inferred",
      confidence: "medium",
      detail: "Machine shops and advanced manufacturers buying cut plate.",
      cargo: "Cut aluminum plate",
      confirmNext: "Confirm ship-to ZIP codes, order size, and delivery windows.",
      qualificationTargets: [],
    },
  ],
  edges: [
    {
      id: "ontario-ferndale",
      fromNodeId: "supplier-ontario",
      toNodeId: "factory-ferndale",
      stage: "inbound",
      mode: "Cross-border truck or LTL",
      cargo: "Certified aluminum plate",
      basis: "inferred",
      confidence: "low",
      detail: "Truck through the Windsor-Detroit border corridor.",
    },
    {
      id: "ferndale-detroit",
      fromNodeId: "factory-ferndale",
      toNodeId: "customers-detroit",
      stage: "outbound",
      mode: "Local truck or LTL",
      cargo: "Cut aluminum plate",
      basis: "inferred",
      confidence: "medium",
      detail: "Local delivery after cutting and certification release.",
    },
  ],
  actions: [
    {
      id: "source-control",
      priority: 1,
      workstreamId: "procurement",
      title: "Qualify the source",
      currentCondition: "Source is inferred.",
      recommendation: "Confirm capability and commercial scope.",
      decision: "Approve the source shortlist.",
      requiredInput: "SKU and supplier file",
      measure: "Approved source coverage",
    },
    {
      id: "lane-control",
      priority: 3,
      workstreamId: "shipment_planning",
      title: "Quote the lane",
      currentCondition: "The lane has no live quote.",
      recommendation: "Compare local and national carriers on one scope.",
      decision: "Approve the tender list.",
      requiredInput: "Addresses, dimensions, weight, and dates",
      measure: "All-in cost and delivery reliability",
    },
    {
      id: "customs-control",
      priority: 4,
      workstreamId: "customs",
      title: "Pre-clear the crossing",
      currentCondition: "The broker is not assigned.",
      recommendation: "Build the entry packet and obtain broker acceptance.",
      decision: "Approve the broker.",
      requiredInput: "Invoice, classification, origin, and parties",
      measure: "Pre-arrival acceptance",
    },
    {
      id: "delivery-control",
      priority: 5,
      workstreamId: "fulfillment",
      title: "Set the delivery rule",
      currentCondition: "Delivery constraints are unknown.",
      recommendation: "Match the service to the receiving requirement.",
      decision: "Approve the delivery service.",
      requiredInput: "Ship-to and appointment details",
      measure: "On-time delivery",
    },
  ],
  workspaces: [],
  customerSegments: [],
  assumptions: [],
};

const commandMap = buildSupplyCommandMap(model, dashboard);

assert.equal(commandMap.routes.length, 2, "every modeled movement needs a map route");
assert.equal(commandMap.objects.filter((object) => object.kind === "movement").length, 2);
assert.equal(commandMap.objects.filter((object) => object.kind === "customs").length, 1);

const customs = commandMap.objects.find((object) => object.kind === "customs");
assert.equal(customs?.label, "Windsor-Detroit customs");
assert.equal(customs?.status, "unassigned");
assert.deepEqual(customs?.contacts.map((contact) => contact.name), ["Farrow", "Livingston International"]);
assert.deepEqual(customs?.checks.map((check) => check.label), [
  "Customs broker",
  "HTS and country of origin",
  "Commercial invoice",
  "Pre-arrival acceptance",
]);

const inboundMovement = commandMap.objects.find((object) => object.id === "movement:ontario-ferndale");
assert.deepEqual(inboundMovement?.contacts.map((contact) => contact.name), [
  "Challenger Motor Freight",
  "Universal Logistics",
  "Old Dominion Freight Line",
  "DHL Global Forwarding",
  "Uber Freight",
  "Schneider",
  "J.B. Hunt",
  "ArcBest",
]);
assert.equal(inboundMovement?.statusLabel, "Lane to quote");
assert.equal(inboundMovement?.priority?.id, "lane-control");
assert.equal(inboundMovement?.rateEstimate?.distanceMiles > 150, true);
assert.equal(inboundMovement?.rateEstimate?.low < (inboundMovement?.rateEstimate?.high ?? 0), true);

const supplier = commandMap.objects.find((object) => object.id === "node:supplier-ontario");
assert.equal(supplier?.statusLabel, "Inferred, verify");
assert.equal(supplier?.contacts[0]?.name, "Samuel Service Center Canada");
assert.equal(supplier?.workstreamId, "procurement");

const factory = commandMap.objects.find((object) => object.id === "node:factory-ferndale");
assert.equal(factory?.statusLabel, "Official evidence");
assert.deepEqual(factory?.contacts.map((contact) => contact.name), [
  "Universal Logistics",
  "Old Dominion Freight Line",
  "Uber Freight",
]);

const usMexicoModel: SupplyOptimizationModel = {
  ...model,
  nodes: [
    {
      ...model.nodes[0],
      id: "supplier-monterrey",
      label: "Monterrey component supply",
      location: "Monterrey, Mexico",
      coordinates: { latitude: 25.6866, longitude: -100.3161 },
    },
    {
      ...model.nodes[1],
      id: "factory-laredo",
      label: "Laredo receiving site",
      location: "Laredo, Texas, United States",
      coordinates: { latitude: 27.5306, longitude: -99.4803 },
    },
  ],
  edges: [{
    ...model.edges[0],
    id: "monterrey-laredo",
    fromNodeId: "supplier-monterrey",
    toNodeId: "factory-laredo",
  }],
};
const usMexicoMap = buildSupplyCommandMap(usMexicoModel, dashboard);
const usMexicoCustoms = usMexicoMap.objects.find((object) => object.kind === "customs");
assert.equal(usMexicoCustoms?.label, "U.S.-Mexico customs");
assert.equal(usMexicoCustoms?.statusLabel, "Broker not assigned");
assert.deepEqual(usMexicoCustoms?.contacts.map((contact) => contact.name), [
  "DHL Global Forwarding",
  "Expeditors",
]);
const usMexicoMovement = usMexicoMap.objects.find((object) => object.kind === "movement");
assert.deepEqual(usMexicoMovement?.contacts.map((contact) => contact.name), [
  "DHL Global Forwarding",
  "Uber Freight",
  "Schneider",
  "J.B. Hunt",
  "ArcBest",
]);

const domesticModel: SupplyOptimizationModel = {
  ...model,
  nodes: [model.nodes[1], model.nodes[2]],
  edges: [{
    ...model.edges[1],
    fromNodeId: "factory-ferndale",
    toNodeId: "customers-detroit",
  }],
};
const domesticMap = buildSupplyCommandMap(domesticModel, dashboard);
assert.equal(domesticMap.objects.some((object) => object.kind === "customs"), false);
assert.deepEqual(
  domesticMap.objects.find((object) => object.id === "node:factory-ferndale")?.contacts.map((contact) => contact.name),
  ["Universal Logistics", "Old Dominion Freight Line", "Uber Freight"],
  "a domestic operating site must not receive an irrelevant customs broker",
);

const chinaOceanModel: SupplyOptimizationModel = {
  ...model,
  nodes: [
    {
      ...model.nodes[0],
      id: "supplier-shenzhen",
      label: "Shenzhen component supply",
      location: "Shenzhen, China",
      coordinates: { latitude: 22.5431, longitude: 114.0579 },
      basis: "public",
      qualificationTargets: [],
    },
    {
      ...model.nodes[2],
      id: "distribution-los-angeles",
      kind: "distribution",
      label: "Los Angeles distribution",
      location: "Los Angeles, California, United States",
      coordinates: { latitude: 34.0522, longitude: -118.2437 },
      basis: "customer_stated",
    },
  ],
  edges: [{
    ...model.edges[0],
    id: "shenzhen-los-angeles",
    fromNodeId: "supplier-shenzhen",
    toNodeId: "distribution-los-angeles",
    mode: "Ocean freight",
  }],
};
const chinaOceanMap = buildSupplyCommandMap(chinaOceanModel, dashboard);
assert.deepEqual(chinaOceanMap.routes[0]?.segments.map((segment) => segment.mode), [
  "road",
  "ocean",
  "customs",
  "road",
]);
assert.match(chinaOceanMap.routes[0]?.segments[1]?.fromLabel ?? "", /Yantian Port/);
assert.match(chinaOceanMap.routes[0]?.segments[2]?.toLabel ?? "", /Customs release/);
assert.equal(chinaOceanMap.objects.find((object) => object.id === "node:supplier-shenzhen")?.statusLabel, "Public evidence");
const losAngelesDistribution = chinaOceanMap.objects.find((object) => object.id === "node:distribution-los-angeles");
assert.equal(losAngelesDistribution?.kind, "distribution");
assert.equal(losAngelesDistribution?.statusLabel, "Customer input");
assert.deepEqual(losAngelesDistribution?.contacts.map((contact) => contact.name), [
  "Port X Logistics",
  "Dependable Supply Chain Services",
  "Uber Freight",
]);
assert.equal(
  chinaOceanMap.objects.find((object) => object.kind === "customs")?.label,
  "U.S. import clearance",
);
assert.deepEqual(
  chinaOceanMap.objects.find((object) => object.kind === "movement")?.contacts.map((contact) => contact.name),
  [
    "Port X Logistics",
    "Dependable Supply Chain Services",
    "DHL Global Forwarding",
    "Maersk",
    "MSC",
    "CMA CGM",
    "Kuehne+Nagel",
    "Expeditors",
  ],
  "an ocean movement must not include domestic truck capacity or a Canada-only broker",
);

const ukUsModel: SupplyOptimizationModel = {
  ...model,
  nodes: [
    {
      ...model.nodes[0],
      id: "supplier-birmingham",
      label: "UK propulsion electronics",
      location: "Birmingham, United Kingdom",
      coordinates: { latitude: 52.4862, longitude: -1.8904 },
      qualificationTargets: [],
    },
    model.nodes[1],
  ],
  edges: [{
    ...model.edges[0],
    id: "birmingham-ferndale",
    fromNodeId: "supplier-birmingham",
    toNodeId: "factory-ferndale",
    mode: "Priority air freight",
  }],
};
const ukUsMap = buildSupplyCommandMap(ukUsModel, dashboard);
assert.deepEqual(ukUsMap.routes[0]?.segments.map((segment) => segment.mode), [
  "road",
  "air",
  "customs",
  "road",
]);
assert.equal(ukUsMap.objects.find((object) => object.kind === "customs")?.label, "International customs handoff");
assert.deepEqual(
  ukUsMap.objects.find((object) => object.kind === "customs")?.contacts.map((contact) => contact.name),
  ["DHL Global Forwarding", "Expeditors"],
);

const phoenixModel: SupplyOptimizationModel = {
  ...model,
  nodes: [
    {
      ...model.nodes[0],
      id: "supplier-tulsa",
      label: "Tulsa component supplier",
      location: "Tulsa, Oklahoma, United States",
      coordinates: { latitude: 36.154, longitude: -95.9928 },
      qualificationTargets: [],
    },
    {
      ...model.nodes[1],
      id: "factory-phoenix",
      label: "Phoenix assembly site",
      location: "Phoenix, Arizona, United States",
      coordinates: { latitude: 33.4484, longitude: -112.074 },
    },
  ],
  edges: [{
    ...model.edges[0],
    id: "tulsa-phoenix",
    fromNodeId: "supplier-tulsa",
    toNodeId: "factory-phoenix",
    mode: "Dedicated truck or LTL",
  }],
};
const phoenixMap = buildSupplyCommandMap(phoenixModel, dashboard);
const phoenixMovement = phoenixMap.objects.find((object) => object.kind === "movement");
assert.deepEqual(phoenixMovement?.contacts.slice(0, 4).map((contact) => contact.name), [
  "Melton Truck Lines",
  "Stewart Transport",
  "Knight Transportation",
  "Swift Transportation",
]);
assert.equal(phoenixMovement?.contacts[1]?.phone, "(602) 242-1800");
assert.match(phoenixMovement?.contacts[1]?.location ?? "", /Phoenix/);
assert.equal(phoenixMovement?.contacts.some((contact) => contact.name === "ArcBest"), true);
assert.equal(phoenixMap.routes[0]?.rateEstimate?.sourceLabel, "2026 ATRI operating-cost benchmark");
assert.deepEqual(phoenixMap.routes[0]?.segments.map((segment) => segment.mode), ["road"]);

const aon3dDemo = generateSupplyCase([
  "Company: AON3D",
  "Located: Montreal, Quebec, Canada",
  "Production: Montreal, Quebec, Canada",
  "Needs: motion controls, industrial electronics, heaters, fabricated frames, machined parts, and service inventory",
  "Sources: Shenzhen, China and Southern Ontario",
  "Ships to: Detroit, Michigan and Germany",
  "AON3D builds industrial 3D printers and material systems.",
].join("\n"), new Date("2026-08-07T12:00:00.000Z"));
const aon3dModel = buildSupplyOptimizationModel(aon3dDemo);
const aon3dMap = buildSupplyCommandMap(aon3dModel, aon3dDemo);
const aon3dSegmentModes = new Set(aon3dMap.routes.flatMap((route) => route.segments.map((segment) => segment.mode)));
assert.equal(aon3dDemo.companyName, "AON3D");
assert.equal(aon3dModel.nodes.filter((node) => node.kind === "supplier_cluster").length, 2);
assert.equal(aon3dModel.nodes.filter((node) => node.kind === "customer_cluster").length, 2);
assert.equal(aon3dMap.routes.length, 4);
assert.deepEqual([...aon3dSegmentModes].sort(), ["air", "customs", "ocean", "road"]);
assert.equal(aon3dMap.routes.flatMap((route) => route.segments).length >= 10, true);
for (const route of aon3dMap.routes) {
  const customsSegment = route.segments.find((segment) => segment.mode === "customs");
  if (!customsSegment) continue;
  const customsObject = aon3dMap.objects.find((object) => object.id === `customs:${route.edgeId}`);
  assert.deepEqual(customsObject?.coordinates, customsSegment.to);
}

const taiwanModel: SupplyOptimizationModel = {
  ...model,
  nodes: [
    {
      ...model.nodes[0],
      id: "supplier-taiwan",
      label: "Taiwan electronics supplier",
      location: "Taoyuan, Taiwan",
      coordinates: { latitude: 25.012, longitude: 121.2148 },
      qualificationTargets: [],
    },
    {
      ...model.nodes[1],
      id: "factory-montreal",
      label: "Montreal production site",
      location: "Montreal, Quebec, Canada",
      coordinates: { latitude: 45.5019, longitude: -73.5674 },
    },
  ],
  edges: [{
    ...model.edges[0],
    id: "taiwan-montreal",
    fromNodeId: "supplier-taiwan",
    toNodeId: "factory-montreal",
    mode: "Ocean freight",
  }],
};
const taiwanMap = buildSupplyCommandMap(taiwanModel, dashboard);
assert.equal(taiwanMap.routes[0]?.segments[0]?.toLabel, "Port of Kaohsiung, confirm terminal");
assert.equal(taiwanMap.routes[0]?.segments[1]?.mode, "ocean");

console.log("Supply OS command map checks passed");
