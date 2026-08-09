import assert from "node:assert/strict";
import {
  originCountryForMovement,
  procurementProfileForMovement,
  resolveMovementAssessment,
  resolveMovementOwnedRecord,
  SUPPLY_MOVEMENT_ORIGIN_COUNTRIES,
} from "../src/lib/supply-os-command-model";

const assessments = [
  { id: "ex-101", movementId: "po-1048", title: "Broker hold" },
  { id: "ex-102", movementId: "po-1037", title: "Invoice revision" },
  { id: "ex-103", movementId: "po-1064", title: "Rate watch" },
];

assert.equal(
  resolveMovementAssessment("po-1037", "ex-101", assessments)?.id,
  "ex-102",
  "a movement must not inherit the selected exception from another movement",
);
assert.equal(
  resolveMovementAssessment("po-1061", "ex-101", assessments),
  null,
  "a movement without an exception must use its own neutral assessment",
);

assert.equal(
  procurementProfileForMovement("po-1048")?.lane,
  "Yantian / Long Beach / Austin",
  "PO-1048 must use its Yantian decision set",
);
assert.equal(
  procurementProfileForMovement("po-1064")?.lane,
  "Shanghai / Oakland / Austin",
  "PO-1064 must use its Shanghai decision set",
);
assert.equal(
  procurementProfileForMovement("po-1052"),
  null,
  "movements without quote evidence must show an honest empty state",
);

const approvedQuotes = [
  { id: "blueharbor", movementId: "po-1048", partner: "BlueHarbor Logistics" },
  { id: "pacific-oakland", movementId: "po-1064", partner: "Pacific Bridge Logistics" },
];
assert.equal(
  resolveMovementOwnedRecord("po-1048", "blueharbor", approvedQuotes)?.partner,
  "BlueHarbor Logistics",
  "an approved quote must resolve for its own movement",
);
assert.equal(
  resolveMovementOwnedRecord("po-1064", "blueharbor", approvedQuotes),
  null,
  "an approved quote must not unlock execution for another movement",
);
assert.equal(resolveMovementOwnedRecord("po-1048", null, approvedQuotes), null);

assert.deepEqual(
  SUPPLY_MOVEMENT_ORIGIN_COUNTRIES,
  {
    "po-1048": "China",
    "po-1052": "Malaysia",
    "po-1037": "Mexico",
    "po-1061": "United States",
    "po-1064": "China",
    "po-1029": "Netherlands",
  },
  "each modeled movement must retain its actual country of origin",
);
assert.equal(originCountryForMovement("unknown"), "Unknown");

console.log("supply OS command model checks passed");
