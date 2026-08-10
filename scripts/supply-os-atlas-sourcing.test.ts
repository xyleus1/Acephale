import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATLAS_ROBOTICS_INVENTORY,
  atlasInventorySummary,
  projectedAvailable,
  shortageQuantity,
} from "../src/lib/supply-os/atlas-robotics-inventory";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const workbench = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx"), "utf8");

assert.ok(ATLAS_ROBOTICS_INVENTORY.length >= 10, "the Atlas fixture should resemble a useful robotics component inventory");
assert.equal(new Set(ATLAS_ROBOTICS_INVENTORY.map((item) => item.sku)).size, ATLAS_ROBOTICS_INVENTORY.length, "inventory SKUs must be unique");
assert.ok(ATLAS_ROBOTICS_INVENTORY.every((item) => item.quantityPerRobot > 0 && item.onHand >= 0 && item.allocated >= 0 && item.confirmedInbound >= 0));
assert.ok(ATLAS_ROBOTICS_INVENTORY.every((item) => projectedAvailable(item) >= 0));

const shortages = ATLAS_ROBOTICS_INVENTORY.filter((item) => shortageQuantity(item) > 0);
assert.ok(shortages.length >= 4, "the demo needs multiple actionable shortages");
assert.ok(shortages.every((item) => item.candidates.length >= 2), "each shortage needs a basic candidate comparison");
assert.ok(shortages.every((item) => item.candidates.every((candidate) => (
  candidate.leadTimeDays > 0
  && candidate.minimumOrderQuantity > 0
  && candidate.modeledUnitCostUsd > 0
  && Number.isFinite(candidate.coordinates.longitude)
  && Number.isFinite(candidate.coordinates.latitude)
))));

const summary = atlasInventorySummary();
assert.equal(summary.itemCount, ATLAS_ROBOTICS_INVENTORY.length);
assert.equal(summary.shortageCount, shortages.length);
assert.ok(summary.buildableWithInbound < summary.demandUnits, "the fixture should expose a real build constraint");

assert.match(dashboard, /activePanel === "materials"[\s\S]*AtlasInventoryWorkspace/);
assert.match(dashboard, /activePanel === "materials" && selectedInventoryItem[\s\S]*AtlasSourcingInspector/);
assert.match(dashboard, /sourceMap=\{sourceMapContext[\s\S]*SupplyOsCommandMap/);
assert.match(workbench, /Show source/);
assert.match(workbench, /Hide map/);
assert.match(workbench, /<th>On hand<\/th>/);
assert.match(workbench, /<th>Allocated<\/th>/);
assert.match(workbench, /<th>Inbound<\/th>/);
assert.match(workbench, /<th>Projected<\/th>/);
assert.doesNotMatch(workbench, /inventoryRailList/);
assert.match(workbench, /Start sourcing/);
assert.match(workbench, /Prepare approval/);
assert.match(workbench, /Awaiting approval/);
assert.match(workbench, /No supplier has been contacted or approved/);
assert.doesNotMatch(workbench, /approved supplier|live quote|supplier contacted/i);

console.log("Supply OS Atlas inventory and sourcing workflow contract passed.");
