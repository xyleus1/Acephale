import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateSupplyCase } from "../src/lib/supply-os-case-model";
import {
  buildSupplyOperatingPlan,
  type SupplyCostRange,
  type SupplyMovementPlan,
} from "../src/lib/supply-os-operating-plan";

const fixedNow = new Date("2026-08-06T12:00:00.000Z");

function everyProviderId(movement: SupplyMovementPlan): string[] {
  return movement.executionPlan.legs.flatMap((leg) => leg.providers.map((candidate) => candidate.id));
}

function everyCost(movement: SupplyMovementPlan): SupplyCostRange[] {
  return [
    ...movement.executionPlan.legs.flatMap((leg) => leg.costRange ? [leg.costRange] : []),
    ...(movement.executionPlan.total ? [movement.executionPlan.total] : []),
  ];
}

function assertNoImportWorkflow(movement: SupplyMovementPlan): void {
  assert.equal(movement.customsPlan.importRequired, false);
  assert.deepEqual(movement.customsPlan.workflow, []);
  assert.deepEqual(movement.customsPlan.brokerOptions, []);
  assert.deepEqual(movement.customsPlan.connectorIds, []);
}

function assertEvidenceResolves(movement: SupplyMovementPlan): void {
  const evidenceIds = new Set(movement.evidenceRefs.map((reference) => reference.id));
  const referencedIds = [
    ...movement.portOptions.flatMap((port) => port.evidenceRefIds),
    ...movement.customsPlan.workflow.flatMap((step) => step.evidenceRefIds),
    ...movement.customsPlan.invoiceGuidance.flatMap((item) => item.evidenceRefIds),
  ];
  for (const id of referencedIds) {
    assert.equal(evidenceIds.has(id), true, `${movement.movementId} has unresolved evidence id ${id}`);
  }
  for (const reference of movement.evidenceRefs) {
    assert.match(reference.url, /^https:\/\//);
    assert.equal(reference.status, "verify");
  }
}

const matrixCase = generateSupplyCase(
  "Company: Matrix Robotics\nLocated: Austin, Texas\nSources: servo motors from Shenzhen, China and Germany\nShips to: Detroit, Michigan and Nashville, Tennessee",
  fixedNow,
);
const matrixPlan = buildSupplyOperatingPlan(matrixCase);

assert.equal(matrixPlan.movements.length, 4, "two sources by two destinations must produce four movement plans");
assert.equal(new Set(matrixPlan.movements.map((movement) => movement.movementId)).size, 4);

const routeSegments = new Map(matrixCase.route.segments.map((segment) => [segment.id, segment]));
const routeNodes = new Map(matrixCase.route.nodes.map((node) => [node.id, node]));
const allPathSets = new Set<string>();
for (const movement of matrixPlan.movements) {
  assert.ok(movement.source, "a complete matrix movement must retain its source");
  assert.ok(movement.receivingGateway, "a complete matrix movement must retain its receiving gateway");
  assert.ok(movement.destination, "a complete matrix movement must retain its destination");
  assert.ok(movement.pathSegmentIds.length >= 3);
  assert.equal(new Set(movement.pathSegmentIds).size, movement.pathSegmentIds.length);
  allPathSets.add([...movement.pathSegmentIds].sort().join("|"));

  const pickup = movement.pathSegmentIds
    .map((id) => routeSegments.get(id))
    .find((segment) => segment?.toNodeId === movement.originGateway.nodeId);
  assert.equal(pickup?.fromNodeId, movement.source?.nodeId, "pickup cannot borrow a source from another lane");

  const linehaul = movement.pathSegmentIds
    .map((id) => routeSegments.get(id))
    .find((segment) => segment?.fromNodeId === movement.originGateway.nodeId);
  assert.equal(linehaul?.toNodeId, movement.receivingGateway?.nodeId, "linehaul cannot borrow a gateway from another lane");

  const lastSegment = movement.pathSegmentIds
    .map((id) => routeSegments.get(id))
    .find((segment) => segment?.toNodeId === movement.destination?.nodeId);
  assert.ok(lastSegment, "movement must terminate at its own destination");
  assert.equal(routeNodes.get(lastSegment?.fromNodeId ?? "")?.kind, "customs");
}
assert.equal(allPathSets.size, 4, "each matrix movement must have a distinct path segment set");

const shenzhenNashville = matrixPlan.movements.find((movement) =>
  movement.source?.label === "Shenzhen, China" && movement.destination?.label === "Nashville, Tennessee"
);
assert.ok(shenzhenNashville);
assert.deepEqual(
  shenzhenNashville.portOptions.map((port) => port.port),
  ["Port of Savannah", "Port of Charleston", "Ports of Los Angeles and Long Beach"],
  "a Southeast movement needs explicit gateway alternatives, not one generic port row",
);

const europeToDetroitCase = generateSupplyCase(
  "Company: Rhine Robotics\nLocated: Detroit, Michigan\nSources: servo motors from Germany\nShips to: Detroit, Michigan",
  fixedNow,
);
const europeToDetroitMovement = buildSupplyOperatingPlan(europeToDetroitCase).movements[0];
assert.ok(europeToDetroitMovement);
assert.deepEqual(
  europeToDetroitMovement.portOptions.map((port) => ({ rank: port.rank, port: port.port })),
  [
    { rank: 1, port: "Port of New York and New Jersey" },
    { rank: 2, port: "Port of Savannah" },
  ],
  "a Europe-to-Midwest movement must exercise the NY/NJ-specific gateway ranking",
);

const explicitAirCase = generateSupplyCase(
  "Company: Air Components\nLocated: Detroit, Michigan\nSources: precision parts from Germany by air freight\nShips to: Detroit, Michigan",
  fixedNow,
);
const explicitAirMovement = buildSupplyOperatingPlan(explicitAirCase).movements[0];
assert.ok(explicitAirMovement);
assert.equal(explicitAirMovement.scope, "import");
assert.deepEqual(explicitAirMovement.portOptions, []);
assert.equal(explicitAirMovement.executionPlan.scenario?.equipment, "Air cargo unitization and chargeable weight to confirm");
assert.deepEqual(
  explicitAirMovement.executionPlan.legs.map((leg) => leg.type),
  ["origin_pickup", "origin_handling", "international_linehaul", "border_clearance", "destination_handling", "last_mile"],
);
assert.equal(explicitAirMovement.executionPlan.legs.find((leg) => leg.type === "international_linehaul")?.mode, "Air freight");
assertRoadProviderRequestsUseLegEndpoints(explicitAirMovement);
for (const candidate of explicitAirMovement.executionPlan.legs.find((leg) => leg.type === "international_linehaul")?.providers ?? []) {
  assert.match(candidate.request, /airport-to-airport linehaul only/i);
  assert.match(candidate.request, /Exclude pickup, origin warehouse handling, destination breakdown, handling and storage, customs, and final recovery/i);
  assert.match(candidate.request, /replace, not duplicate/i);
}
const explicitAirText = [
  ...explicitAirMovement.executionPlan.legs.flatMap((leg) => [leg.mode, leg.instruction, ...leg.providers.flatMap((candidate) => [candidate.provider, candidate.service, candidate.request])]),
  ...explicitAirMovement.intelligenceChecks.flatMap((check) => [check.title, check.question, ...check.sourceRequirements.map((source) => source.label)]),
].join(" ");
assert.doesNotMatch(explicitAirText, /Maersk|CMA CGM|Hapag-Lloyd|Ocean Freight|Ocean FCL|vessel|40HC|port drayage/i);
assert.equal(explicitAirMovement.evidenceRefs.some((reference) => ["maersk-schedules", "cma-schedules", "hapag-schedules"].includes(reference.id)), false);

const allocatedSourceCase = generateSupplyCase(
  "Company: Allocation Robotics\nLocated: Austin, Texas\nSources: servo motors and aluminum housings from Shenzhen, China and Germany\nShips to: Detroit, Michigan",
  fixedNow,
);
const allocatedSourcePlan = buildSupplyOperatingPlan(allocatedSourceCase);
assert.equal(allocatedSourcePlan.movements.length, 2);
for (const movement of allocatedSourcePlan.movements) {
  assert.ok(
    movement.quoteBlockers.some((blocker) => blocker.id.endsWith("blocker-source-allocation")),
    `${movement.movementId} must block quoting until a commodity is assigned to its source`,
  );
  assert.deepEqual(
    movement.intelligenceChecks[0]?.commodities,
    ["Commodity allocation to this source must be confirmed"],
    `${movement.movementId} must not borrow every case commodity`,
  );
}

const zeroMovementCase = generateSupplyCase("Please map this supply chain.", fixedNow);
const zeroMovementPlan = buildSupplyOperatingPlan(zeroMovementCase);
assert.deepEqual(zeroMovementPlan.movements, [], "missing source and destination facts must not fabricate a movement");
assert.equal(zeroMovementPlan.caseId, zeroMovementCase.id);
assert.equal(zeroMovementPlan.generatedAt, fixedNow.toISOString());
assert.ok(zeroMovementPlan.customsConnectors.length > 0, "the empty fallback must retain connector evaluation metadata");
assert.equal(zeroMovementPlan.status, "verify", "an empty plan cannot claim modeled status");

const allProviderIds = matrixPlan.movements.flatMap(everyProviderId);
assert.equal(new Set(allProviderIds).size, allProviderIds.length, "provider records must be movement scoped");
for (const movement of matrixPlan.movements) {
  const originId = movement.originGateway.nodeId;
  assert.ok(everyProviderId(movement).every((id) => id.startsWith(originId)), "provider ids must remain on their movement");
}

const firstMatrixTotal = matrixPlan.movements[0]?.executionPlan.total;
const secondMatrixTotal = matrixPlan.movements[1]?.executionPlan.total;
assert.ok(firstMatrixTotal && secondMatrixTotal);
const secondLowBefore = secondMatrixTotal.low;
firstMatrixTotal.low += 1;
assert.equal(secondMatrixTotal.low, secondLowBefore, "cost objects must not be shared across movements");

const unknownCase = generateSupplyCase(
  "Company: Unknown Source Robotics\nLocated: Austin, Texas\nSources: motors from Atlantis\nShips to: Detroit, Michigan",
  fixedNow,
);
const unknownMovement = buildSupplyOperatingPlan(unknownCase).movements[0];
assert.ok(unknownMovement);
assert.equal(unknownMovement.geographyKnown, false);
assert.deepEqual(unknownMovement.portOptions, []);
assert.equal(unknownMovement.executionPlan.total, null);
assert.match(unknownMovement.executionPlan.totalLabel, /withheld/i);

const mixedLocationCase = generateSupplyCase(
  "Company: Mixed Foods\nLocated: Germany\nSources: soybeans from China and Brazil\nShips to: Germany and Poland",
  fixedNow,
);
const mixedLocationPlan = buildSupplyOperatingPlan(mixedLocationCase);
assert.equal(mixedLocationPlan.movements.length, 4, "partially normalized location lists must retain every requested lane");
assert.deepEqual(
  new Set(mixedLocationPlan.movements.flatMap((movement) => movement.source?.label ? [movement.source.label] : [])),
  new Set(["China", "Brazil"]),
);
assert.deepEqual(
  new Set(mixedLocationPlan.movements.flatMap((movement) => movement.destination?.label ? [movement.destination.label] : [])),
  new Set(["Germany", "Poland"]),
);
assert.ok(
  mixedLocationPlan.movements.filter((movement) => movement.source?.label === "Brazil" || movement.destination?.label === "Poland")
    .every((movement) => !movement.geographyKnown && movement.executionPlan.total === null),
);

const northKoreaCase = generateSupplyCase(
  "Company: Restricted Geography Test\nLocated: Germany\nSources: components from North Korea\nShips to: Germany",
  fixedNow,
);
const northKoreaMovement = buildSupplyOperatingPlan(northKoreaCase).movements[0];
assert.ok(northKoreaMovement);
assert.equal(northKoreaMovement.geographyKnown, false);
assert.equal(northKoreaMovement.executionPlan.total, null);
assert.doesNotMatch(
  northKoreaMovement.executionPlan.legs.flatMap((leg) => [leg.from, leg.to]).join(" "),
  /South Korea|Busan/,
);

const domesticCase = generateSupplyCase(
  "Company: Delta Robotics\nLocated: Shanghai\nSources: motors from Shenzhen\nShips to: Shanghai",
  fixedNow,
);
const domesticMovement = buildSupplyOperatingPlan(domesticCase).movements[0];
assert.ok(domesticMovement);
assert.equal(domesticMovement.scope, "domestic");
assertNoImportWorkflow(domesticMovement);
assert.ok(domesticMovement.executionPlan.total);

const intraEuCase = generateSupplyCase(
  "Company: Rhine Robotics\nLocated: Germany\nSources: motors from Germany\nShips to: Netherlands",
  fixedNow,
);
const intraEuMovement = buildSupplyOperatingPlan(intraEuCase).movements[0];
assert.ok(intraEuMovement);
assert.equal(intraEuMovement.scope, "intra_eu");
assertNoImportWorkflow(intraEuMovement);
assert.ok(intraEuMovement.executionPlan.total);

const chinaUsCase = generateSupplyCase(
  "Company: Atlas Robotics\nLocated: Austin, Texas\nSources: servo motors from Shenzhen, China\nShips to: Detroit, Michigan",
  fixedNow,
);
const chinaUsPlan = buildSupplyOperatingPlan(chinaUsCase);
const chinaUsMovement = chinaUsPlan.movements[0];
assert.ok(chinaUsMovement);
assert.equal(chinaUsMovement.scope, "import");
assert.equal(chinaUsMovement.geographyKnown, true);
assert.equal(chinaUsMovement.customsPlan.importRequired, true);
assert.equal(chinaUsMovement.executionPlan.scenario?.equipment, "1 x 40HC");
assert.equal(chinaUsMovement.executionPlan.scenario?.cargoProfile, "Standard non-hazardous general cargo");
assert.match(chinaUsMovement.executionPlan.scenario?.exclusions ?? "", /Duties, taxes/);

assert.ok(chinaUsMovement.portOptions.length >= 2);
assert.deepEqual(chinaUsMovement.portOptions.map((port) => port.rank), [1, 2, 3]);
assert.equal(chinaUsMovement.portOptions[0]?.port, "Port of Los Angeles");
assert.equal(chinaUsMovement.portOptions[1]?.port, "Port of Long Beach");

const workflowText = chinaUsMovement.customsPlan.workflow
  .flatMap((step) => [step.title, step.owner, step.gate, step.output])
  .join(" ");
assert.match(workflowText, /Direct importer-broker POA/i);
assert.match(workflowText, /licensed_broker/i);
assert.match(workflowText, /only on a real authenticated callback/i);
assert.equal(chinaUsPlan.customsConnectors[0]?.name, "Zonos", "pre-entry connector priority must start with Zonos");
assert.ok(chinaUsPlan.customsConnectors.some((connector) => connector.name === "Digicust" && /must not label an AI result entry-ready/i.test(connector.approvalBoundary)));
assert.ok(chinaUsMovement.customsPlan.invoiceGuidance.some((row) => /HS-6 candidates and alternatives/i.test(row.instruction)));

const commodityCheck = chinaUsMovement.intelligenceChecks.find((check) => check.title === "Commodity availability and disruption");
const gatewayCheck = chinaUsMovement.intelligenceChecks.find((check) => check.title === "Gateway and terminal conditions");
assert.deepEqual(commodityCheck?.relatedNodeIds, [chinaUsMovement.source?.nodeId]);
assert.deepEqual(gatewayCheck?.relatedNodeIds, [chinaUsMovement.receivingGateway?.nodeId]);
assert.ok(chinaUsMovement.intelligenceChecks.every((check) => /^Unknown\./.test(check.currentFinding)));

const expectedLegTypes = [
  "origin_pickup",
  "origin_handling",
  "international_linehaul",
  "border_clearance",
  "destination_handling",
  "drayage",
  "inland_transport",
  "last_mile",
];
assert.deepEqual(chinaUsMovement.executionPlan.legs.map((leg) => leg.type), expectedLegTypes);
assert.deepEqual(chinaUsMovement.executionPlan.legs.map((leg) => leg.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
const chinaUsLinehaul = chinaUsMovement.executionPlan.legs.find((leg) => leg.type === "international_linehaul");
assert.ok(chinaUsLinehaul?.providers.some((candidate) => candidate.provider === "DHL Global Forwarding" && /Ocean Freight FCL/.test(candidate.service)));
assert.ok(chinaUsLinehaul?.providers.some((candidate) => candidate.provider === "Maersk" && /TP6 candidate/.test(candidate.service)));
assert.doesNotMatch(
  chinaUsLinehaul?.providers.find((candidate) => candidate.provider === "DHL Global Forwarding")?.request ?? "",
  /door offer/i,
  "a port-to-port linehaul provider must not request overlapping door-to-door coverage",
);

const providerNames = new Set(chinaUsMovement.executionPlan.legs.flatMap((leg) => leg.providers.map((candidate) => candidate.provider)));
for (const expected of [
  "DHL Global Forwarding",
  "Maersk",
  "CMA CGM",
  "Hapag-Lloyd",
  "Dray Alliance carrier network",
  "IMC Logistics",
  "RoadOne IntermodaLogistics",
  "J.B. Hunt Intermodal",
  "Schneider",
  "DSV Road",
]) {
  assert.equal(providerNames.has(expected), true, `missing expected provider ${expected}`);
}

const total = chinaUsMovement.executionPlan.total;
assert.ok(total);
assert.equal(total.currency, "USD");
assert.ok(total.low >= 0);
assert.ok(total.high >= total.low);
assert.ok(total.exclusions.includes("Duties and taxes"));
const legLow = chinaUsMovement.executionPlan.legs.reduce((sum, leg) => sum + (leg.costRange?.low ?? 0), 0);
const legHigh = chinaUsMovement.executionPlan.legs.reduce((sum, leg) => sum + (leg.costRange?.high ?? 0), 0);
assert.equal(total.low, legLow);
assert.equal(total.high, legHigh);

const soybeanCase = generateSupplyCase(
  "Company: Prairie Foods\nLocated: Chicago, Illinois\nSources: soybeans from China\nShips to: Detroit, Michigan",
  fixedNow,
);
const soybeanMovement = buildSupplyOperatingPlan(soybeanCase).movements[0];
assert.ok(soybeanMovement);
const soybeanSources = soybeanMovement.intelligenceChecks.flatMap((check) => check.sourceRequirements);
assert.equal(soybeanSources.some((source) => source.id === "usda-export-sales"), false);
assert.ok(soybeanSources.some((source) => source.id.endsWith("-local-agriculture") && /China official agricultural/i.test(source.label)));

const usSoybeanCase = generateSupplyCase(
  "Company: US Foods\nLocated: Detroit, Michigan\nSources: soybeans from Chicago, Illinois\nShips to: Detroit, Michigan",
  fixedNow,
);
const usSoybeanMovement = buildSupplyOperatingPlan(usSoybeanCase).movements[0];
assert.ok(usSoybeanMovement);
assert.ok(usSoybeanMovement.intelligenceChecks
  .flatMap((check) => check.sourceRequirements)
  .some((source) => source.id === "usda-export-sales"));

const regressionFailures: string[] = [];

function checkRegression(name: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    regressionFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

checkRegression("ocean import legs hand off without overlapping coverage", () => {
  const drayage = chinaUsMovement.executionPlan.legs.find((leg) => leg.type === "drayage");
  const inland = chinaUsMovement.executionPlan.legs.find((leg) => leg.type === "inland_transport");
  const lastMile = chinaUsMovement.executionPlan.legs.find((leg) => leg.type === "last_mile");
  assert.ok(drayage, "ocean import plan needs an explicit drayage leg");
  assert.ok(inland, "ocean import plan needs an explicit inland leg");
  assert.ok(lastMile, "ocean import plan needs an explicit last-mile leg");
  assert.equal(inland.from, drayage.to, "inland transport must start at the drayage handoff, not again at the port");
  assert.equal(lastMile.from, inland.to, "last mile must start where inland transport ends");
  assert.notEqual(inland.to, chinaUsMovement.destination?.label, "inland transport cannot already end at final delivery when a separate last-mile leg is priced");
});

const portLocalCase = generateSupplyCase(
  "Company: Local Importer\nLocated: Los Angeles, California\nSources: components from Shenzhen, China\nShips to: Los Angeles, California",
  fixedNow,
);
const portLocalMovement = buildSupplyOperatingPlan(portLocalCase).movements[0];
assert.ok(portLocalMovement);

checkRegression("port-local imports skip duplicate hub-to-hub inland coverage", () => {
  const drayage = portLocalMovement.executionPlan.legs.find((leg) => leg.type === "drayage");
  const inland = portLocalMovement.executionPlan.legs.find((leg) => leg.type === "inland_transport");
  const lastMile = portLocalMovement.executionPlan.legs.find((leg) => leg.type === "last_mile");
  assert.ok(drayage);
  assert.equal(inland, undefined, "a destination local to its receiving port must not add a second hub-to-hub inland charge");
  assert.ok(lastMile);
  assert.equal(lastMile.from, drayage.to, "local final mile must start at the port recovery handoff");
  assertRoadProviderRequestsUseLegEndpoints(portLocalMovement);
});

const europeImportCase = generateSupplyCase(
  "Company: Europe Importer\nLocated: Netherlands\nSources: parts from Shenzhen, China\nShips to: Netherlands",
  fixedNow,
);
const europeImportMovement = buildSupplyOperatingPlan(europeImportCase).movements[0];
assert.ok(europeImportMovement);
assert.equal(europeImportMovement.scope, "import");

checkRegression("non-US imports exclude US-only execution providers", () => {
  const providerNames = new Set(
    europeImportMovement.executionPlan.legs.flatMap((leg) => leg.providers.map((candidate) => candidate.provider)),
  );
  for (const usOnlyProvider of [
    "Dray Alliance carrier network",
    "IMC Logistics",
    "RoadOne IntermodaLogistics",
    "J.B. Hunt Intermodal",
    "Schneider",
    "Livingston International",
  ]) {
    assert.equal(providerNames.has(usOnlyProvider), false, `${usOnlyProvider} must not be proposed for a Netherlands import`);
  }
  assert.equal(
    europeImportMovement.evidenceRefs.some((reference) => reference.id === "fmcsa-qcmobile"),
    false,
    "a Netherlands import must not use FMCSA as its destination-carrier authority source",
  );
});

function assertGroundMovementReachesDelivery(movement: SupplyMovementPlan): void {
  const providerText = movement.executionPlan.legs
    .flatMap((leg) => [leg.mode, ...leg.providers.flatMap((candidate) => [candidate.provider, candidate.service])])
    .join(" ");
  assert.doesNotMatch(
    providerText,
    /Maersk|CMA CGM|Hapag-Lloyd|Ocean Freight|Ocean FCL|vessel/i,
    `${movement.scope} movement must not use ocean providers or services`,
  );
  assert.equal(
    movement.executionPlan.legs.at(-1)?.to,
    movement.destination?.label,
    `${movement.scope} movement must include delivery to the stated destination`,
  );
  const intelligenceText = movement.intelligenceChecks
    .flatMap((check) => [check.title, check.question, ...check.sourceRequirements.map((source) => source.label)])
    .join(" ");
  assert.doesNotMatch(
    intelligenceText,
    /Maersk|CMA CGM|Hapag-Lloyd|vessel|40HC|port drayage/i,
    `${movement.scope} intelligence must use ground-mode checks`,
  );
}

function assertRoadProviderRequestsUseLegEndpoints(movement: SupplyMovementPlan): void {
  const roadLegTypes = new Set(["domestic_linehaul", "international_linehaul", "inland_transport", "last_mile"]);
  const roadLegs = movement.executionPlan.legs.filter((item) => roadLegTypes.has(item.type));
  const providerIds = roadLegs.flatMap((leg) => leg.providers.map((candidate) => candidate.id));
  assert.equal(new Set(providerIds).size, providerIds.length, "road provider IDs must be unique across execution legs");
  for (const leg of roadLegs) {
    const lane = `from ${leg.from} to ${leg.to}`;
    for (const candidate of leg.providers) {
      assert.ok(
        candidate.request.includes(lane),
        `${candidate.provider} request for ${leg.id} must name its exact ordered lane ${lane}`,
      );
    }
  }
}

checkRegression("domestic and intra-EU plans use ground providers and reach final delivery", () => {
  assertGroundMovementReachesDelivery(domesticMovement);
  assertGroundMovementReachesDelivery(intraEuMovement);
  assertRoadProviderRequestsUseLegEndpoints(domesticMovement);
  assertRoadProviderRequestsUseLegEndpoints(intraEuMovement);
});

checkRegression("ocean linehaul provider requests stay inside the priced leg", () => {
  assertRoadProviderRequestsUseLegEndpoints(chinaUsMovement);
});

const mexicoUsCase = generateSupplyCase(
  "Company: Mexico Parts\nLocated: Austin, Texas\nSources: parts from Mexico\nShips to: Detroit, Michigan",
  fixedNow,
);
const mexicoUsMovement = buildSupplyOperatingPlan(mexicoUsCase).movements[0];
assert.ok(mexicoUsMovement);
assert.equal(mexicoUsMovement.scope, "import");

checkRegression("Mexico-US road plans exclude port execution artifacts", () => {
  assert.deepEqual(mexicoUsMovement.portOptions, [], "a land-border movement must not rank the border crossing as a port");
  assert.equal(
    mexicoUsMovement.executionPlan.legs.some((leg) => leg.type === "drayage" || leg.type === "destination_handling"),
    false,
    "a land-border movement must not include port drayage or destination-terminal legs",
  );
  const executionText = mexicoUsMovement.executionPlan.legs
    .flatMap((leg) => [leg.mode, leg.instruction, ...leg.providers.map((candidate) => candidate.service)])
    .join(" ");
  assert.doesNotMatch(executionText, /port drayage|terminal handling|ocean FCL|vessel/i);
  const crossBorderLeg = mexicoUsMovement.executionPlan.legs.find((leg) => leg.mode === "Cross-border truck");
  assert.ok(crossBorderLeg, "Mexico-US movement needs a cross-border truck leg");
  assert.notEqual(crossBorderLeg.from, crossBorderLeg.to, "cross-border linehaul cannot start and end at the same crossing");
  assertRoadProviderRequestsUseLegEndpoints(mexicoUsMovement);
  const intelligenceText = mexicoUsMovement.intelligenceChecks
    .flatMap((check) => [check.title, check.question, ...check.sourceRequirements.map((source) => source.label)])
    .join(" ");
  assert.doesNotMatch(intelligenceText, /Maersk|CMA CGM|Hapag-Lloyd|vessel|40HC|port drayage/i);
});

const usMexicoCase = generateSupplyCase(
  "Company: Southbound Parts\nLocated: Mexico\nSources: automotive components from Austin, Texas\nShips to: Mexico",
  fixedNow,
);
const usMexicoMovement = buildSupplyOperatingPlan(usMexicoCase).movements[0];
assert.ok(usMexicoMovement);

checkRegression("US-Mexico road plans use the border in both directions", () => {
  const crossBorderLeg = usMexicoMovement.executionPlan.legs.find((leg) => leg.mode === "Cross-border truck");
  assert.ok(crossBorderLeg);
  assert.match(crossBorderLeg.from, /^Laredo border crossing export side$/);
  assert.match(crossBorderLeg.to, /^Laredo border crossing import side$/);
  assert.doesNotMatch(
    usMexicoMovement.executionPlan.legs.flatMap((leg) => [leg.from, leg.to]).join(" "),
    /Port Houston/,
  );
  assertRoadProviderRequestsUseLegEndpoints(usMexicoMovement);
});

const hazardousCase = generateSupplyCase(
  "Company: Battery Co\nLocated: Austin, Texas\nSources: lithium batteries from Shenzhen, China\nShips to: Detroit, Michigan",
  fixedNow,
);
const hazardousMovement = buildSupplyOperatingPlan(hazardousCase).movements[0];
assert.ok(hazardousMovement);

checkRegression("hazardous cargo withholds the standard non-hazardous numeric total", () => {
  assert.ok(
    hazardousMovement.quoteBlockers.some((blocker) => blocker.id.endsWith("blocker-dangerous-goods")),
    "hazardous cargo must retain its dangerous-goods blocker",
  );
  assert.equal(
    hazardousMovement.executionPlan.total,
    null,
    "numeric total must remain withheld until dangerous-goods classification and carrier acceptance are confirmed",
  );
});

const sulfuricAcidCase = generateSupplyCase(
  "Company: Acid Co\nLocated: Austin, Texas\nSources: sulfuric acid from Shenzhen, China\nShips to: Detroit, Michigan",
  fixedNow,
);
const sulfuricAcidMovement = buildSupplyOperatingPlan(sulfuricAcidCase).movements[0];
assert.ok(sulfuricAcidMovement);
checkRegression("named hazardous commodities also withhold numeric totals", () => {
  assert.equal(sulfuricAcidMovement.executionPlan.total, null);
  assert.equal(sulfuricAcidMovement.executionPlan.scenario?.status, "verify");
});

const sanFranciscoCase = generateSupplyCase(
  "Company: Bay Robotics\nLocated: San Francisco Bay Area\nSources: servo motors from Germany\nShips to: San Francisco Bay Area",
  fixedNow,
);
const sanFranciscoMovement = buildSupplyOperatingPlan(sanFranciscoCase).movements[0];
assert.ok(sanFranciscoMovement);
checkRegression("supported US destinations use structured US customs territory", () => {
  assert.equal(sanFranciscoMovement.customsPlan.connectorIds.includes("customs4trade"), false);
  assert.equal(sanFranciscoMovement.customsPlan.brokerOptions.some((broker) => broker.firm === "Livingston International"), true);
  assert.equal(sanFranciscoMovement.evidenceRefs.some((reference) => reference.id === "fmcsa-qcmobile"), true);
  assert.equal(sanFranciscoMovement.evidenceRefs.some((reference) => reference.id === "cbp-h350722"), true);
});

checkRegression("unconnected dependencies keep worst-status aggregation connection-bound", () => {
  assert.deepEqual(
    { movement: chinaUsMovement.status, plan: chinaUsPlan.status },
    { movement: "connection_required", plan: "connection_required" },
  );
});

for (const movement of [
  ...matrixPlan.movements,
  unknownMovement,
  ...mixedLocationPlan.movements,
  northKoreaMovement,
  domesticMovement,
  intraEuMovement,
  chinaUsMovement,
  portLocalMovement,
  soybeanMovement,
  usSoybeanMovement,
  europeImportMovement,
  explicitAirMovement,
  mexicoUsMovement,
  usMexicoMovement,
  hazardousMovement,
  sulfuricAcidMovement,
  sanFranciscoMovement,
]) {
  assertEvidenceResolves(movement);
  for (const cost of everyCost(movement)) {
    assert.equal(cost.currency, "USD");
    assert.equal(Number.isFinite(cost.low), true);
    assert.equal(Number.isFinite(cost.high), true);
    assert.ok(cost.low >= 0);
    assert.ok(cost.high >= cost.low);
    assert.equal(cost.status, "modeled");
  }
}

const moduleSource = readFileSync(new URL("../src/lib/supply-os-operating-plan.ts", import.meta.url), "utf8");
const testSource = readFileSync(new URL(import.meta.url), "utf8");
assert.equal(moduleSource.includes("\u2014"), false, "operating-plan module must not contain U+2014");
assert.equal(testSource.includes("\u2014"), false, "operating-plan test must not contain U+2014");

assert.deepEqual(
  regressionFailures,
  [],
  `operating-plan regressions:\n${regressionFailures.map((failure) => `- ${failure}`).join("\n")}`,
);

console.log("supply-os-operating-plan.test.ts passed");
