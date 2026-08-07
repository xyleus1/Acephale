import assert from "node:assert/strict";
import {
  archiveSupplyCase,
  generateSupplyCase,
  parseStoredSupplyCases,
  resolveSelectedSupplyCase,
  SAMPLE_SUPPLY_CASE_PROMPT,
  serializeSupplyCases,
  SUPPLY_CASE_SCHEMA_VERSION,
  SUPPLY_CASE_STORAGE_KEY,
  upsertSupplyCase,
  validateSupplyCaseDashboard,
  type SupplyCaseDashboard,
} from "../src/lib/supply-os-case-model";

const fixedNow = new Date("2026-08-06T12:00:00.000Z");
const complete = generateSupplyCase(SAMPLE_SUPPLY_CASE_PROMPT, fixedNow);

assert.equal(SUPPLY_CASE_SCHEMA_VERSION, 1);
assert.equal(SUPPLY_CASE_STORAGE_KEY, "derya:supply-case-dashboards:v1");
assert.equal(complete.companyName, "Atlas Robotics");
assert.equal(complete.companyLocation, "Austin, Texas");
assert.equal(complete.companyDescription, "Robotics");
assert.deepEqual(complete.sourceRegions, ["Shenzhen, China"]);
assert.deepEqual(complete.destinations, ["Detroit, Michigan", "Nashville, Tennessee"]);
assert.deepEqual(complete.sourcingNeeds, ["servo motors", "machine-vision cameras", "aluminum housings"]);
assert.equal(complete.status, "verify");
assert.equal(complete.generatedAt, fixedNow.toISOString());
assert.equal(complete.sourcePrompt, SAMPLE_SUPPLY_CASE_PROMPT);
assert.match(complete.summary.primaryLane, /Shenzhen, China to Detroit, Michigan/);
assert.equal(complete.openQuestions.length, 1, "a complete company description still needs shipment details");
assert.match(complete.bestNextStep, /expected volume/i);

assert.equal(complete.shippingOptions.length, 3);
assert.deepEqual(
  complete.shippingOptions.map((option) => option.provider),
  ["DHL Global Forwarding", "Kuehne+Nagel", "DSV"],
);
for (const option of complete.shippingOptions) {
  assert.equal(option.status, "verify");
  assert.equal(option.indicativeCost, "Live quote required");
  assert.match(option.basis, /Indicative modeled option only/);
}
assert.ok(complete.supplierOptions.length >= 3);
assert.ok(complete.customsChecks.some((check) => /classification/i.test(check.label)));
assert.ok(complete.risks.some((risk) => risk.title === "US-bound China tariff exposure"));
assert.ok(complete.risks.some((risk) => /Section 301/.test(risk.check)));

const nodeIds = new Set(complete.routeNodes.map((node) => node.id));
assert.equal(nodeIds.size, complete.routeNodes.length, "route node ids must be unique");
for (const segment of complete.routeSegments) {
  assert.equal(nodeIds.has(segment.fromNodeId), true, `missing from node for ${segment.id}`);
  assert.equal(nodeIds.has(segment.toNodeId), true, `missing to node for ${segment.id}`);
}
for (const destination of complete.routeNodes.filter((node) => node.kind === "destination")) {
  const customsSegment = complete.routeSegments.find((segment) => segment.toNodeId === destination.id);
  assert.ok(customsSegment, `destination ${destination.id} needs an inbound segment`);
  const customsNode = complete.routeNodes.find((node) => node.id === customsSegment.fromNodeId);
  assert.equal(customsNode?.kind, "customs", "customs must sit before final delivery");
  assert.ok(
    complete.routeSegments.some((segment) => segment.toNodeId === customsNode?.id),
    "the customs checkpoint must follow a receiving gateway",
  );
}
assert.ok(
  complete.routeNodes.some((node) => node.kind === "receiving_gateway" && node.label === "Port of Los Angeles and Long Beach"),
  "an Asia-to-Detroit model should use a plausible Pacific gateway",
);

const europeToMidwest = generateSupplyCase(
  "Company: Rhine Robotics\nLocated: Detroit\nSources: servo motors from Germany\nShips to: Detroit",
  fixedNow,
);
assert.ok(
  europeToMidwest.routeNodes.some((node) => node.kind === "receiving_gateway" && node.label === "Port of New York and New Jersey"),
  "a Europe-to-Detroit model should not be forced through Los Angeles",
);

const missing = generateSupplyCase("Please map this supply chain.", fixedNow);
assert.equal(missing.status, "needs_confirmation");
assert.equal(missing.companyName, null);
assert.equal(missing.companyLocation, null);
assert.deepEqual(missing.sourceRegions, []);
assert.deepEqual(missing.destinations, []);
assert.equal(missing.company.name.status, "needs_confirmation");
assert.equal(missing.company.headquarters.status, "needs_confirmation");
assert.equal(missing.company.industry.status, "needs_confirmation");
assert.ok(missing.company.sourcingNeeds.every((need) => need.status === "verify"));
assert.ok(missing.routeNodes.some((node) => node.id === "source-needed" && node.status === "needs_confirmation"));
assert.ok(missing.routeNodes.some((node) => node.id === "destination-needed" && node.status === "needs_confirmation"));
assert.ok(missing.openQuestions.includes("What is the company name?"));
assert.ok(missing.openQuestions.includes("Which supplier cities or countries should be evaluated?"));
assert.equal(missing.customsChecks[0]?.label, "Customs scope to confirm");

const naturalLanguage = generateSupplyCase(
  "Nova Medical is a medtech company based in Boston. It sources sterile packaging from Germany and ships devices to New York.",
  fixedNow,
);
assert.equal(naturalLanguage.companyName, "Nova Medical");
assert.equal(naturalLanguage.companyLocation, "Boston");
assert.equal(naturalLanguage.companyDescription, "Medical devices");
assert.deepEqual(naturalLanguage.sourcingNeeds, ["sterile packaging"]);
assert.deepEqual(naturalLanguage.sourceRegions, ["Germany"]);
assert.deepEqual(naturalLanguage.destinations, ["New York and New Jersey"]);

const placeholderLanguage = generateSupplyCase(
  "Atlas Robotics builds warehouse robots in Austin. It needs motors, LiDAR, batteries, and aluminum enclosures from China and Malaysia, then ships finished systems across the US and Germany.",
  fixedNow,
);
assert.equal(placeholderLanguage.companyLocation, "Austin");
assert.deepEqual(placeholderLanguage.sourcingNeeds, ["motors", "LiDAR", "batteries", "aluminum enclosures"]);
assert.deepEqual(placeholderLanguage.sourceRegions, ["China", "Malaysia"]);
assert.deepEqual(placeholderLanguage.destinations, ["United States", "Germany"]);

const tentativeDestination = generateSupplyCase("Acme builds robots. It might ship to Detroit.", fixedNow);
assert.deepEqual(tentativeDestination.destinations, ["Detroit, Michigan"]);

const needsToSource = generateSupplyCase(
  "Acme Robotics builds robots in Austin. It needs to source motors from China and ships to Detroit.",
  fixedNow,
);
assert.deepEqual(needsToSource.sourcingNeeds, ["motors"]);
assert.deepEqual(needsToSource.sourceRegions, ["China"]);

const commaSeparatedNarrative = generateSupplyCase(
  "Acme Robotics is based in Austin, sources motors from Shenzhen, and ships to Detroit.",
  fixedNow,
);
assert.equal(commaSeparatedNarrative.companyLocation, "Austin");
assert.deepEqual(commaSeparatedNarrative.sourceRegions, ["Shenzhen, China"]);
assert.deepEqual(commaSeparatedNarrative.destinations, ["Detroit, Michigan"]);

const boundarySafeLocation = generateSupplyCase(
  "Company: Hoosier Robotics\nLocated: Chicago\nSources: servo motors from Germany\nShips to: Indiana",
  fixedNow,
);
assert.deepEqual(boundarySafeLocation.destinations, ["Indiana"]);

const unknownCityState = generateSupplyCase(
  "Company: Lake Robotics\nLocated: Austin\nSources: motors from Germany\nShips to: Cleveland, Ohio",
  fixedNow,
);
assert.deepEqual(unknownCityState.destinations, ["Cleveland, Ohio"]);

const mixedKnownAndUnresolvedLocations = generateSupplyCase(
  "Company: Mixed Foods\nLocated: Germany\nSources: soybeans from China and Brazil\nShips to: Germany and Poland",
  fixedNow,
);
assert.deepEqual(mixedKnownAndUnresolvedLocations.sourceRegions, ["China", "Brazil"]);
assert.deepEqual(mixedKnownAndUnresolvedLocations.destinations, ["Germany", "Poland"]);
assert.equal(
  mixedKnownAndUnresolvedLocations.company.sourceRegions.find((region) => region.value === "Brazil")?.status,
  "needs_confirmation",
);
assert.equal(
  mixedKnownAndUnresolvedLocations.company.destinations.find((destination) => destination.value === "Poland")?.status,
  "needs_confirmation",
);
assert.ok(mixedKnownAndUnresolvedLocations.openQuestions.some((question) => /Brazil/.test(question)));
assert.ok(mixedKnownAndUnresolvedLocations.openQuestions.some((question) => /Poland/.test(question)));

const northKoreaLocation = generateSupplyCase(
  "Company: Restricted Geography Test\nLocated: Germany\nSources: components from North Korea\nShips to: Germany",
  fixedNow,
);
assert.deepEqual(northKoreaLocation.sourceRegions, ["North Korea"]);
assert.equal(northKoreaLocation.company.sourceRegions[0]?.status, "needs_confirmation");
assert.equal(northKoreaLocation.routeNodes.some((node) => /South Korea|Busan/.test(node.label)), false);
assert.ok(northKoreaLocation.openQuestions.some((question) => /North Korea/.test(question)));

const domesticChina = generateSupplyCase(
  "Company: Delta Robotics\nLocated: Shanghai\nSources: motors from Shenzhen\nShips to: Shanghai",
  fixedNow,
);
assert.equal(domesticChina.routeNodes.some((node) => node.kind === "customs"), false);
assert.equal(domesticChina.routeSegments.some((segment) => segment.label === "Customs entry"), false);
assert.equal(domesticChina.customsChecks[0]?.label, "Domestic movement confirmation");
assert.ok(domesticChina.routeNodes.some((node) => node.kind === "origin_gateway" && node.label === "Origin hub near Shenzhen, China"));
assert.ok(domesticChina.shippingOptions.every((option) => option.mode === "Road, to confirm"));

const mexicoToDetroit = generateSupplyCase(
  "Company: Border Robotics\nLocated: Detroit\nSources: motors from Mexico\nShips to: Detroit",
  fixedNow,
);
assert.ok(
  mexicoToDetroit.routeNodes.some((node) => node.kind === "receiving_gateway" && node.label === "Laredo border crossing"),
);
assert.ok(
  mexicoToDetroit.routeSegments.some((segment) => segment.label === "Cross-border road freight" && segment.mode === "road"),
);
assert.ok(mexicoToDetroit.shippingOptions.every((option) => option.mode === "Road, to confirm"));

const austinToMexico = generateSupplyCase(
  "Company: Southbound Parts\nLocated: Mexico\nSources: automotive components from Austin, Texas\nShips to: Mexico",
  fixedNow,
);
assert.ok(
  austinToMexico.routeNodes.some((node) => node.kind === "origin_gateway" && node.label === "Laredo border crossing"),
  "US-to-Mexico road freight must not detour through the source's default ocean gateway",
);
assert.ok(
  austinToMexico.routeNodes.some((node) => node.kind === "receiving_gateway" && node.label === "Laredo border crossing"),
);
assert.ok(
  austinToMexico.routeSegments.some((segment) => segment.label === "Cross-border road freight" && segment.mode === "road"),
);

const intraEuropeanUnion = generateSupplyCase(
  "Company: Rhine Robotics\nLocated: Germany\nSources: motors from Germany\nShips to: Netherlands",
  fixedNow,
);
assert.equal(intraEuropeanUnion.routeNodes.some((node) => node.kind === "customs"), false);
assert.ok(intraEuropeanUnion.routeSegments.some((segment) => segment.label === "Intra-EU freight"));
assert.equal(intraEuropeanUnion.customsChecks[0]?.label, "Domestic movement confirmation");

const unresolvedLane = generateSupplyCase(
  "Company: Midwest Robotics\nLocated: Cleveland, Ohio\nSources: motors from Columbus, Ohio\nShips to: Cleveland, Ohio",
  fixedNow,
);
assert.equal(unresolvedLane.routeNodes.some((node) => node.kind === "customs"), false);
assert.ok(unresolvedLane.routeSegments.some((segment) => segment.label === "Freight mode to confirm" && segment.mode === "to_confirm"));
assert.equal(unresolvedLane.customsChecks[0]?.label, "Customs scope to confirm");
assert.ok(unresolvedLane.shippingOptions.every((option) => option.mode === "Mode to confirm"));

const chinaToGermany = generateSupplyCase(
  "Company: Berlin Robotics\nLocated: Germany\nSources: motors from China\nShips to: Germany",
  fixedNow,
);
assert.ok(chinaToGermany.risks.some((risk) => risk.title === "China origin and trade-policy exposure"));
assert.equal(chinaToGermany.risks.some((risk) => /Section 301/.test(risk.check)), false);
assert.equal(chinaToGermany.customsChecks.some((check) => check.needed.includes("Customs bond status")), false);

const explicitAirCase = generateSupplyCase(
  "Company: Air Components\nLocated: Detroit, Michigan\nSources: precision parts from Germany by air freight\nShips to: Detroit, Michigan",
  fixedNow,
);
assert.ok(explicitAirCase.routeSegments.some((segment) => segment.mode === "air" && segment.label === "International air freight"));
assert.ok(explicitAirCase.routeNodes.some((node) => node.kind === "origin_gateway" && /Air cargo gateway near Germany/.test(node.label)));
assert.ok(explicitAirCase.routeNodes.some((node) => node.kind === "receiving_gateway" && /Air cargo gateway near Detroit/.test(node.label)));
assert.ok(explicitAirCase.shippingOptions.every((option) => option.mode === "Air freight"));
assert.equal(explicitAirCase.routeNodes.some((node) => /Port of|Port Houston|ocean/i.test(node.label)), false);
assert.equal(validateSupplyCaseDashboard(explicitAirCase), true);
assert.deepEqual(parseStoredSupplyCases(serializeSupplyCases([explicitAirCase])), [explicitAirCase]);

const airCargoProductCase = generateSupplyCase(
  "Company: CargoBox makes air cargo containers\nLocated: Austin, Texas\nSources: aluminum housings from China\nShips to: Austin, Texas",
  fixedNow,
);
assert.equal(
  airCargoProductCase.routeSegments.some((segment) => segment.mode === "air"),
  false,
  "an air-cargo product description must not silently select air freight as the transport mode",
);

const industryCases: Array<[string, string]> = [
  ["Orbital Works builds aerospace avionics.", "Aerospace and defense"],
  ["Care Tools makes medical devices.", "Medical devices"],
  ["Auto Forge manufactures automotive components.", "Automotive and industrial manufacturing"],
  ["Resin Labs produces specialty chemicals.", "Chemicals"],
  ["Copper Loop processes metals and minerals.", "Metals and minerals"],
  ["Circuit House builds electronics and circuit boards.", "Electronics"],
  ["Motion Works builds robotics for warehouses.", "Robotics"],
];
for (const [prompt, expectedIndustry] of industryCases) {
  assert.equal(generateSupplyCase(prompt, fixedNow).companyDescription, expectedIndustry);
}

assert.deepEqual(
  generateSupplyCase(SAMPLE_SUPPLY_CASE_PROMPT, fixedNow),
  complete,
  "the same prompt and clock must generate exactly the same dashboard",
);

assert.equal(validateSupplyCaseDashboard(complete), true);
const serialized = serializeSupplyCases([complete, naturalLanguage]);
assert.deepEqual(parseStoredSupplyCases(serialized), [complete, naturalLanguage]);
assert.deepEqual(parseStoredSupplyCases(null), []);
assert.deepEqual(parseStoredSupplyCases("not json"), []);
assert.deepEqual(parseStoredSupplyCases('{"schemaVersion":99,"cases":[]}'), []);
assert.deepEqual(parseStoredSupplyCases('{"schemaVersion":1,"cases":[{"id":"broken"}]}'), []);

const brokenRelationship = structuredClone(complete) as SupplyCaseDashboard;
brokenRelationship.route.segments[0].toNodeId = "missing-node";
brokenRelationship.routeSegments[0].toNodeId = "missing-node";
assert.equal(validateSupplyCaseDashboard(brokenRelationship), false);
assert.deepEqual(parseStoredSupplyCases(JSON.stringify({ schemaVersion: 1, cases: [brokenRelationship] })), []);

const invalidCoordinate = structuredClone(complete) as SupplyCaseDashboard;
invalidCoordinate.route.nodes[0].lat = Number.POSITIVE_INFINITY;
invalidCoordinate.routeNodes[0].lat = Number.POSITIVE_INFINITY;
assert.equal(validateSupplyCaseDashboard(invalidCoordinate), false);

const invalidCount = structuredClone(complete) as SupplyCaseDashboard;
invalidCount.summary.openCheckCount = -1;
assert.equal(validateSupplyCaseDashboard(invalidCount), false);

const duplicateNode = structuredClone(complete) as SupplyCaseDashboard;
duplicateNode.route.nodes.push(structuredClone(duplicateNode.route.nodes[0]));
duplicateNode.routeNodes.push(structuredClone(duplicateNode.routeNodes[0]));
assert.equal(validateSupplyCaseDashboard(duplicateNode), false);

const second = generateSupplyCase(
  "Company: Circuit House\nLocated: Chicago\nSources: circuit boards from Taiwan\nShips to: Austin",
  fixedNow,
);
const originalCases = [complete, second];
const updated = { ...complete, title: "Atlas Robotics sourcing review", updatedAt: "2026-08-07T12:00:00.000Z" };
const upserted = upsertSupplyCase(originalCases, updated);
assert.equal(upserted.length, 2);
assert.equal(upserted[0].title, "Atlas Robotics sourcing review");
assert.equal(upserted[1], second, "upsert must not replace an unrelated dashboard");
assert.equal(originalCases[0].title, "Atlas Robotics supply case", "upsert must not mutate its input");

const inserted = upsertSupplyCase([complete], second);
assert.deepEqual(inserted.map((item) => item.id), [second.id, complete.id]);

const archiveTime = new Date("2026-08-08T09:30:00.000Z");
const archived = archiveSupplyCase([complete, second], complete.id, archiveTime);
assert.equal(archived[0].archivedAt, archiveTime.toISOString());
assert.equal(archived[0].updatedAt, archiveTime.toISOString());
assert.equal(archived[1], second, "archive must leave unrelated dashboards untouched");
assert.equal(complete.archivedAt, undefined, "archive must not mutate its input");

assert.equal(resolveSelectedSupplyCase([complete, second], second.id)?.id, second.id);
assert.equal(resolveSelectedSupplyCase([archived[0], second], "missing")?.id, second.id);
assert.equal(resolveSelectedSupplyCase([archived[0]], "missing"), null);
assert.equal(resolveSelectedSupplyCase([], null), null);

console.log("supply OS case model checks passed");
