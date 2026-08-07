import assert from "node:assert/strict";
import {
  generateSupplyCase,
  SAMPLE_SUPPLY_CASE_PROMPT,
} from "../src/lib/supply-os-case-model";
import {
  buildSupplyEngagementPlan,
  SUPPLY_ENGAGEMENT_OPTIONS,
} from "../src/lib/supply-os-engagement-plan";

const fixedNow = new Date("2026-08-06T12:00:00.000Z");
const dashboard = generateSupplyCase(SAMPLE_SUPPLY_CASE_PROMPT, fixedNow);
const fullPlan = buildSupplyEngagementPlan(dashboard);

assert.equal(SUPPLY_ENGAGEMENT_OPTIONS.length, 5);
assert.equal(fullPlan.scope, "full_operation");
assert.match(fullPlan.headline, /hand Derya the whole supply chain/i);
assert.match(fullPlan.summary, /qualify suppliers/i);
assert.match(fullPlan.summary, /movement into Austin, Texas/i);
assert.match(fullPlan.summary, /deliver robots, spares, and replacement parts/i);
assert.equal(fullPlan.workstreams.length, 5);
assert.deepEqual(
  fullPlan.workstreams.map((workstream) => workstream.label),
  ["Find suppliers", "Coordinate suppliers", "Move components", "Clear customs", "Deliver finished goods"],
);
assert.ok(fullPlan.workstreams.every((workstream) => workstream.state === "owned"));
assert.equal(fullPlan.kickoffInputs.length, 3);
assert.match(fullPlan.kickoffNote, /retain the relationship/i);
assert.equal(fullPlan.executionSections.length, 2);

assert.deepEqual(
  fullPlan.flows.map((flow) => ({ kind: flow.kind, from: flow.from.label, to: flow.to.label })),
  [
    { kind: "inbound", from: "Shenzhen, China", to: "Austin, Texas" },
    { kind: "outbound", from: "Austin, Texas", to: "Detroit, Michigan" },
    { kind: "outbound", from: "Austin, Texas", to: "Nashville, Tennessee" },
  ],
  "the customer network must preserve the production handoff between components and finished goods",
);

const customsPlan = buildSupplyEngagementPlan(dashboard, "customs");
assert.match(customsPlan.headline, /start with customs preparation/i);
assert.match(customsPlan.summary, /licensed brokers/i);
assert.deepEqual(customsPlan.kickoffInputs, [
  "Product description, material, function, and HTS code if known",
  "Commercial value, country of origin, seller, buyer, and Incoterm",
  "Importer and broker details plus the expected entry date",
]);
assert.equal(customsPlan.workstreams.find((item) => item.id === "customs")?.state, "start_here");
assert.ok(
  customsPlan.workstreams.filter((item) => item.id !== "customs").every((item) => item.state === "available"),
);
assert.equal(customsPlan.executionSections.length, 1);
assert.equal(customsPlan.executionSections[0]?.label, "Clear customs");

const supplierPlan = buildSupplyEngagementPlan(dashboard, "supplier_sourcing");
assert.equal(supplierPlan.workstreams.find((item) => item.id === "supplier_sourcing")?.state, "start_here");
assert.equal(supplierPlan.workstreams.find((item) => item.id === "supplier_coordination")?.state, "available");
assert.match(supplierPlan.kickoffInputs[0], /target landed cost/i);
assert.match(supplierPlan.kickoffNote, /No supplier list is required/i);
assert.doesNotMatch(
  supplierPlan.workstreams.flatMap((item) => [item.outcome, ...item.steps]).join(" "),
  /DHL|Kuehne|DSV|Maersk|J\.B\. Hunt|Dray Alliance|Port Optimizer/,
  "customer coverage must not invent an awarded provider",
);

const inboundPlan = buildSupplyEngagementPlan(dashboard, "inbound_logistics");
assert.match(inboundPlan.kickoffInputs[0], /cargo-ready dates/i);
assert.match(inboundPlan.kickoffInputs[2], /Incoterm/i);

const deliveryPlan = buildSupplyEngagementPlan(dashboard, "finished_goods_delivery");
assert.match(deliveryPlan.kickoffInputs[0], /Pickup and delivery addresses/i);
assert.match(deliveryPlan.kickoffNote, /proof of delivery/i);

for (const option of SUPPLY_ENGAGEMENT_OPTIONS) {
  const scopedPlan = buildSupplyEngagementPlan(dashboard, option.id);
  assert.equal(scopedPlan.kickoffInputs.length, 3, `${option.id} needs one concise kickoff list`);
  if (option.id === "full_operation") {
    assert.ok(scopedPlan.workstreams.every((item) => item.state === "owned"));
    continue;
  }
  assert.equal(scopedPlan.workstreams.find((item) => item.id === option.id)?.state, "start_here");
  assert.ok(scopedPlan.workstreams.filter((item) => item.id !== option.id).every((item) => item.state === "available"));
}

const separateFactory = generateSupplyCase(
  "Atlas Robotics is based in San Francisco, California and manufactures warehouse robots in Austin, Texas. It sources servo motors from Shenzhen, China, then ships finished systems to Detroit, Michigan.",
  fixedNow,
);
assert.equal(separateFactory.companyLocation, "San Francisco, California");
assert.equal(separateFactory.productionLocation, "Austin, Texas");
assert.deepEqual(
  buildSupplyEngagementPlan(separateFactory).flows.map((flow) => ({ from: flow.from.label, to: flow.to.label })),
  [
    { from: "Shenzhen, China", to: "Austin, Texas" },
    { from: "Austin, Texas", to: "Detroit, Michigan" },
  ],
  "the operating network must use the factory rather than company headquarters",
);

const multipleSources = generateSupplyCase(
  "Multi Robotics builds robots in Austin, Texas. It sources servo motors and cameras from Shenzhen, China and Mexico, then ships finished systems to Detroit, Michigan.",
  fixedNow,
);
const multipleSourcePlan = buildSupplyEngagementPlan(multipleSources);
assert.equal(multipleSourcePlan.flows.filter((flow) => flow.kind === "inbound").length, 2);
for (const flow of multipleSourcePlan.flows.filter((item) => item.kind === "inbound")) {
  assert.match(flow.detail, /allocation .* is not confirmed/i, "multi-source cases must not assign every component to every source");
}

const domesticCustoms = generateSupplyCase(
  "Domestic Robotics builds robots in Detroit, Michigan. It sources motors from Detroit, Michigan and ships finished systems to Nashville, Tennessee.",
  fixedNow,
  "customs",
);
const domesticCustomsPlan = buildSupplyEngagementPlan(domesticCustoms);
assert.match(domesticCustomsPlan.summary, /No import broker workflow is assumed/i);
assert.match(domesticCustomsPlan.kickoffNote, /No import entry is modeled/i);
assert.equal(domesticCustomsPlan.workstreams.find((item) => item.id === "customs")?.label, "Confirm regulations");
assert.doesNotMatch(domesticCustomsPlan.kickoffInputs.join(" "), /Importer|broker/i);
assert.match(domesticCustomsPlan.headline, /domestic transport requirements/i);
assert.match(domesticCustomsPlan.scopeLabel, /domestic transport requirements/i);
assert.equal(domesticCustomsPlan.executionSections.length, 1);
assert.doesNotMatch(
  domesticCustomsPlan.executionSections.flatMap((section) => [section.summary, ...section.steps]).join(" "),
  /broker|customs preparation|customs release|supplier qualification|forwarder tender|delivery tracking/i,
);

const unknownCustoms = generateSupplyCase(
  "Early Robotics builds robots. It needs motors and may ship finished systems to customers.",
  fixedNow,
  "customs",
);
const unknownCustomsPlan = buildSupplyEngagementPlan(unknownCustoms);
assert.match(unknownCustomsPlan.summary, /determine whether an import entry/i);
assert.match(unknownCustomsPlan.kickoffInputs[0], /supplier, production, and delivery countries/i);
assert.equal(unknownCustomsPlan.workstreams.find((item) => item.id === "customs")?.label, "Confirm customs scope");
assert.match(unknownCustomsPlan.headline, /customs scope confirmation/i);
assert.equal(unknownCustomsPlan.executionSections.length, 1);
assert.doesNotMatch(
  unknownCustomsPlan.executionSections.flatMap((section) => [section.summary, ...section.steps]).join(" "),
  /broker approval|customs preparation|customs release|supplier qualification|forwarder tender|delivery tracking/i,
);

const incompleteDashboard = generateSupplyCase("Company: Early Robotics builds robots.", fixedNow);
const incompletePlan = buildSupplyEngagementPlan(incompleteDashboard);
assert.deepEqual(incompletePlan.flows, [], "a production network needs a known company site");
assert.match(incompletePlan.summary, /production site/i);

console.log("supply OS engagement-plan checks passed");
