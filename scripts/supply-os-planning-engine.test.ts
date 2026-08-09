import assert from "node:assert/strict";
import {
  runSupplyPlanningEngine,
  type PlanningCanonicalInput,
  type PlanningScenarioRequest,
} from "../src/lib/supply-os/planning-engine";

function fixture(): PlanningCanonicalInput {
  return {
    snapshotId: "snapshot-1",
    snapshotHash: "snapshot-hash-1",
    snapshotPublishedAt: "2026-08-08T00:00:00.000Z",
    productItemKey: "ROBOT",
    items: [
      { itemKey: "ROBOT", name: "Robot", itemType: "PRODUCT", unitOfMeasure: "EA" },
      { itemKey: "DRIVE", name: "Drive assembly", itemType: "SUBASSEMBLY", unitOfMeasure: "EA" },
      { itemKey: "MOTOR", name: "Motor", itemType: "COMPONENT", unitOfMeasure: "EA" },
      { itemKey: "RADIO", name: "Radio", itemType: "COMPONENT", unitOfMeasure: "EA", requiresFccReview: true },
      { itemKey: "RADIO-ALT", name: "Alternate radio", itemType: "COMPONENT", unitOfMeasure: "EA", requiresFccReview: true },
      { itemKey: "BOLT", name: "Bolt", itemType: "COMPONENT", unitOfMeasure: "EA" },
      { itemKey: "GUARD", name: "Optional guard", itemType: "COMPONENT", unitOfMeasure: "EA" },
    ],
    bomLines: [
      { lineKey: "1", parentItemKey: "ROBOT", componentItemKey: "DRIVE", quantity: 2, unitOfMeasure: "EA", scrapRate: 0, isOptional: false },
      { lineKey: "2", parentItemKey: "ROBOT", componentItemKey: "RADIO", quantity: 1, unitOfMeasure: "EA", scrapRate: 0, isOptional: false },
      { lineKey: "3", parentItemKey: "ROBOT", componentItemKey: "GUARD", quantity: 99, unitOfMeasure: "EA", scrapRate: 0, isOptional: true },
      { lineKey: "4", parentItemKey: "DRIVE", componentItemKey: "MOTOR", quantity: 1, unitOfMeasure: "EA", scrapRate: 0, isOptional: false },
      { lineKey: "5", parentItemKey: "DRIVE", componentItemKey: "RADIO", quantity: 0.5, unitOfMeasure: "EA", scrapRate: 0, isOptional: false },
      { lineKey: "6", parentItemKey: "DRIVE", componentItemKey: "BOLT", quantity: 4, unitOfMeasure: "EA", scrapRate: 0.25, isOptional: false },
    ],
    inventory: [
      { positionKey: "motor", itemKey: "MOTOR", facilityKey: "F1", unitOfMeasure: "EA", onHand: 100, allocated: 0, inTransit: 0, onOrder: 0, expectedReceiptAt: null },
      { positionKey: "radio", itemKey: "RADIO", facilityKey: "F1", unitOfMeasure: "EA", onHand: 12, allocated: 0, inTransit: 0, onOrder: 0, expectedReceiptAt: null },
      { positionKey: "radio-alt", itemKey: "RADIO-ALT", facilityKey: "F1", unitOfMeasure: "EA", onHand: 20, allocated: 0, inTransit: 0, onOrder: 0, expectedReceiptAt: null },
      { positionKey: "bolt", itemKey: "BOLT", facilityKey: "F1", unitOfMeasure: "EA", onHand: 100, allocated: 0, inTransit: 0, onOrder: 0, expectedReceiptAt: null },
      { positionKey: "drive", itemKey: "DRIVE", facilityKey: "F1", unitOfMeasure: "EA", onHand: 0, allocated: 0, inTransit: 0, onOrder: 0, expectedReceiptAt: null },
    ],
    demands: [
      { demandKey: "D1", itemKey: "ROBOT", facilityKey: "F1", quantity: 5, unitOfMeasure: "EA", dueAt: "2026-08-20T00:00:00.000Z", priority: 1, status: "OPEN" },
      { demandKey: "D2", itemKey: "ROBOT", facilityKey: "F1", quantity: 5, unitOfMeasure: "EA", dueAt: "2026-09-01T00:00:00.000Z", priority: 1, status: "OPEN" },
    ],
    supplierTerms: [
      { termKey: "motor-current", itemKey: "MOTOR", facilityKey: "F1", supplierKey: "S1", supplierName: "Supplier 1", isCurrent: true, unitOfMeasure: "EA", currency: "USD", unitPrice: 10, modeledFreightPerUnit: 1, evidencedDutyPerUnit: 0.5, dutyEvidenceRefs: ["duty-motor"], leadTimeMinDays: 2, leadTimeMaxDays: 4, availableQuantity: 0, availableAt: "2026-08-12T00:00:00.000Z", evidenceRefs: ["term-motor"] },
      { termKey: "radio-current", itemKey: "RADIO", facilityKey: "F1", supplierKey: "S1", supplierName: "Supplier 1", isCurrent: true, unitOfMeasure: "EA", currency: "USD", unitPrice: 20, modeledFreightPerUnit: 2, evidencedDutyPerUnit: 1, dutyEvidenceRefs: ["duty-radio"], leadTimeMinDays: 8, leadTimeMaxDays: 12, availableQuantity: 0, availableAt: "2026-08-25T00:00:00.000Z", evidenceRefs: ["term-radio"] },
      { termKey: "radio-alt", itemKey: "RADIO", facilityKey: "F1", supplierKey: "S2", supplierName: "Supplier 2", isCurrent: false, unitOfMeasure: "EA", currency: "USD", unitPrice: 22, modeledFreightPerUnit: 3, evidencedDutyPerUnit: 1, dutyEvidenceRefs: ["duty-radio-alt"], leadTimeMinDays: 3, leadTimeMaxDays: 5, availableQuantity: 8, availableAt: "2026-08-15T00:00:00.000Z", evidenceRefs: ["term-radio-alt"] },
      { termKey: "radio-alt-item", itemKey: "RADIO-ALT", facilityKey: "F1", supplierKey: "S3", supplierName: "Supplier 3", isCurrent: true, unitOfMeasure: "EA", currency: "USD", unitPrice: 18, modeledFreightPerUnit: 2, evidencedDutyPerUnit: 1, dutyEvidenceRefs: ["duty-radio-alt-item"], leadTimeMinDays: 4, leadTimeMaxDays: 6, availableQuantity: 0, availableAt: "2026-08-15T00:00:00.000Z", evidenceRefs: ["term-radio-alt-item"] },
      { termKey: "bolt-current", itemKey: "BOLT", facilityKey: "F1", supplierKey: "S2", supplierName: "Supplier 2", isCurrent: true, unitOfMeasure: "EA", currency: "USD", unitPrice: 1, modeledFreightPerUnit: 0.1, evidencedDutyPerUnit: 0.05, dutyEvidenceRefs: ["duty-bolt"], leadTimeMinDays: 1, leadTimeMaxDays: 2, availableQuantity: 0, availableAt: "2026-08-10T00:00:00.000Z", evidenceRefs: ["term-bolt"] },
      { termKey: "drive-assembled", itemKey: "DRIVE", facilityKey: "F1", supplierKey: "S4", supplierName: "Assembly Supplier", isCurrent: false, unitOfMeasure: "EA", currency: "USD", unitPrice: 40, modeledFreightPerUnit: 4, evidencedDutyPerUnit: 2, dutyEvidenceRefs: ["duty-drive"], leadTimeMinDays: 3, leadTimeMaxDays: 5, availableQuantity: 20, availableAt: "2026-08-15T00:00:00.000Z", evidenceRefs: ["term-drive"] },
    ],
    equivalenceRules: [
      { ruleKey: "radio-approved", fromItemKey: "RADIO", toItemKey: "RADIO-ALT", action: "REPLACE", status: "APPROVED", constraints: null, evidenceRefs: ["eq-approved"] },
      { ruleKey: "radio-draft", fromItemKey: "RADIO", toItemKey: "RADIO-ALT", action: "REPLACE", status: "DRAFT", constraints: null, evidenceRefs: ["eq-draft"] },
      { ruleKey: "radio-remove", fromItemKey: "RADIO", toItemKey: null, action: "REMOVE", status: "APPROVED", constraints: null, evidenceRefs: ["eq-remove"] },
    ],
    fccProfiles: [
      { itemKey: "RADIO", moduleAuthorization: "EVIDENCED", moduleAuthorizationEvidenceRefs: ["fcc-radio"], hostIntegrationConstraints: [], labeling: "EVIDENCED", labelingEvidenceRefs: ["label-radio"], rfExposure: "EVIDENCED", rfExposureEvidenceRefs: ["rf-radio"], testing: "EVIDENCED", testingEvidenceRefs: ["test-radio"], testingGaps: [], reviewRequirements: [], blockedReasons: [] },
      { itemKey: "RADIO-ALT", moduleAuthorization: "EVIDENCED", moduleAuthorizationEvidenceRefs: ["fcc-radio-alt"], hostIntegrationConstraints: [], labeling: "EVIDENCED", labelingEvidenceRefs: ["label-radio-alt"], rfExposure: "EVIDENCED", rfExposureEvidenceRefs: ["rf-radio-alt"], testing: "EVIDENCED", testingEvidenceRefs: ["test-radio-alt"], testingGaps: [], reviewRequirements: [], blockedReasons: [] },
    ],
  };
}

const requests: PlanningScenarioRequest[] = [
  { scenarioKey: "current", family: "current_purchasing_plan" },
  { scenarioKey: "alternate", family: "alternate_supplier", itemKey: "RADIO", supplierTermKey: "radio-alt" },
  { scenarioKey: "assembled", family: "assembled_subassembly", subassemblyItemKey: "DRIVE", supplierTermKey: "drive-assembled" },
  { scenarioKey: "substitute", family: "approved_equivalence", equivalenceRuleKey: "radio-approved" },
  { scenarioKey: "remove", family: "approved_equivalence", equivalenceRuleKey: "radio-remove" },
  { scenarioKey: "unapproved", family: "approved_equivalence", equivalenceRuleKey: "radio-draft" },
];

const output = runSupplyPlanningEngine(fixture(), requests);
const current = output.scenarios.find((scenario) => scenario.scenarioKey === "current")!;
const alternate = output.scenarios.find((scenario) => scenario.scenarioKey === "alternate")!;
const assembled = output.scenarios.find((scenario) => scenario.scenarioKey === "assembled")!;
const substitute = output.scenarios.find((scenario) => scenario.scenarioKey === "substitute")!;
const remove = output.scenarios.find((scenario) => scenario.scenarioKey === "remove")!;
const unapproved = output.scenarios.find((scenario) => scenario.scenarioKey === "unapproved")!;

assert.deepEqual(current.buildableQuantityByDemandDate.map((row) => row.buildableQuantity), [5, 1], "shared radio demand across BOM levels must constrain later builds");
assert.equal(current.buildableUnits, 6, "multi-level BOM buildability must allocate shared components once");
assert.equal(current.earliestAffectedDemand?.demandKey, "D2", "the first shortage date must be explicit");
assert.ok(current.shortages.some((row) => row.demandKey === "D2" && row.itemKey === "RADIO" && row.shortageQuantity === 8));
assert.ok(current.materialCost! > 0 && current.modeledFreight! > 0 && current.evidencedDutyEstimate! > 0);
assert.equal(current.netAvailableInventory.find((row) => row.itemKey === "RADIO")?.netAvailable, 12);
assert.equal(current.fcc.status, "evidence_complete");

assert.equal(alternate.buildableUnits, 10, "an evidenced alternate supplier must improve dated coverage when capacity arrives in time");
assert.equal(assembled.buildableUnits, 10, "buying the assembled subassembly must replace its selected child requirements");
assert.equal(assembled.netAvailableInventory.some((row) => row.itemKey === "MOTOR"), false, "assembled replacement must not retain replaced child demand");
assert.equal(substitute.buildableUnits, 10, "an approved substitute must replace the constrained component");
assert.equal(remove.buildableUnits, 10, "an approved removal rule must remove the selected component requirement");
assert.equal(unapproved.blocked, true, "an unapproved substitute must be rejected");
assert.match(unapproved.complianceBlockers.join(" "), /not approved/i);
assert.equal(output.recommendationOrder.at(-1), "unapproved", "blocked scenarios must rank last");

const unknownFixture = fixture();
const unknownTerm = unknownFixture.supplierTerms.find((term) => term.termKey === "radio-alt")!;
unknownTerm.unitPrice = null;
unknownTerm.modeledFreightPerUnit = null;
unknownTerm.evidencedDutyPerUnit = null;
unknownTerm.dutyEvidenceRefs = [];
unknownTerm.leadTimeMinDays = null;
unknownTerm.leadTimeMaxDays = null;
unknownTerm.availableAt = null;
const unknownOutput = runSupplyPlanningEngine(unknownFixture, requests);
const unknownAlternate = unknownOutput.scenarios.find((scenario) => scenario.scenarioKey === "alternate")!;
assert.equal(unknownAlternate.materialCost, null);
assert.equal(unknownAlternate.modeledFreight, null);
assert.equal(unknownAlternate.evidencedDutyEstimate, null);
assert.equal(unknownAlternate.landedCost, null);
assert.equal(unknownAlternate.cashExposure, null);
assert.equal(unknownAlternate.leadTimeRange, null);
assert.equal(unknownAlternate.buildableUnits, null, "unknown supplier arrival must not silently become zero capacity");
assert.ok(unknownAlternate.unknowns.some((row) => row.code === "unit_price_unknown"));
assert.ok(unknownAlternate.unknowns.some((row) => row.code === "freight_unknown"));
assert.ok(unknownAlternate.unknowns.some((row) => row.code === "duty_unknown"));
assert.ok(unknownAlternate.unknowns.some((row) => row.code === "lead_time_unknown"));

const facilityFixture = fixture();
facilityFixture.demands = [{ demandKey: "F2-D1", itemKey: "ROBOT", facilityKey: "F2", quantity: 1, unitOfMeasure: "EA", dueAt: "2026-08-20T00:00:00.000Z", priority: 1, status: "OPEN" }];
const facilityResult = runSupplyPlanningEngine(facilityFixture, [{ scenarioKey: "current", family: "current_purchasing_plan" }]).scenarios[0]!;
assert.equal(facilityResult.buildableUnits, null, "inventory at another facility must not be silently transferred");
assert.ok(facilityResult.netAvailableInventory.every((row) => row.facilityKey === "F2" && row.netAvailable === null));

const fccBlockedFixture = fixture();
fccBlockedFixture.fccProfiles[0]!.blockedReasons = ["Module grant was withdrawn"];
const fccBlocked = runSupplyPlanningEngine(fccBlockedFixture, requests).scenarios.find((scenario) => scenario.scenarioKey === "current")!;
assert.equal(fccBlocked.fcc.status, "blocked");
assert.equal(fccBlocked.blocked, true, "FCC blocked evidence must reject the scenario");
assert.equal(JSON.stringify(fccBlocked).toLowerCase().includes("passes fcc"), false, "the engine must never claim a product passes FCC");

const cycleFixture = fixture();
cycleFixture.bomLines.push({ lineKey: "cycle", parentItemKey: "DRIVE", componentItemKey: "ROBOT", quantity: 1, unitOfMeasure: "EA", scrapRate: 0, isOptional: false });
assert.throws(() => runSupplyPlanningEngine(cycleFixture, requests), /cycle detected/i);

const unitFixture = fixture();
unitFixture.bomLines[0]!.unitOfMeasure = "KG";
assert.throws(() => runSupplyPlanningEngine(unitFixture, requests), /uses KG/i);

const reorderedFixture = fixture();
reorderedFixture.items.reverse();
reorderedFixture.bomLines.reverse();
reorderedFixture.inventory.reverse();
reorderedFixture.demands.reverse();
reorderedFixture.supplierTerms.reverse();
reorderedFixture.equivalenceRules.reverse();
reorderedFixture.fccProfiles.reverse();
const reordered = runSupplyPlanningEngine(reorderedFixture, [...requests].reverse());
assert.equal(reordered.normalizedInputHash, output.normalizedInputHash, "input row order must not change the normalized input hash");
assert.equal(reordered.deterministicOutputHash, output.deterministicOutputHash, "input row order must not change deterministic output");
assert.deepEqual(reordered.recommendationOrder, output.recommendationOrder);

console.log("Supply OS deterministic planning engine checks passed.");
