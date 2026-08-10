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
const procurement = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-procurement-workspace.tsx"), "utf8");
const researchRoute = readFileSync(resolve(root, "src/app/api/supply-os/supplier-research/route.ts"), "utf8");

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
assert.match(dashboard, /procurementRequest[\s\S]*AtlasProcurementWorkspace/);
assert.match(dashboard, /sourceMap=\{sourceMapContext[\s\S]*SupplyOsCommandMap/);
assert.match(workbench, /Show source/);
assert.match(workbench, /Hide map/);
assert.match(workbench, /New sourcing request/);
assert.match(workbench, /Sourcing queue/);
assert.match(workbench, /Start procurement/);
assert.doesNotMatch(workbench, /<th>On hand<\/th>|<th>Allocated<\/th>|<th>Inbound<\/th>|<th>Projected<\/th>/);
assert.doesNotMatch(workbench, /inventoryRailList/);
assert.match(procurement, /Approved source library/);
assert.match(procurement, /Manufacturer catalogs/);
assert.match(procurement, /Open web discovery/);
assert.match(procurement, /Price<\/th><th>Delivery<\/th><th>Quality/);
assert.match(procurement, /Send to logistics/);
assert.match(procurement, /\/api\/supply-os\/supplier-research/);
assert.match(procurement, /Live public web research is running/);
assert.match(procurement, /View source/);
assert.match(procurement, /Modeled[\s\S]*Sourced[\s\S]*Unknown/);
assert.match(procurement, /No purchase order, supplier contact, booking, or spend was created/);
assert.match(researchRoute, /getSession/);
assert.match(researchRoute, /ResearchRateLimiter/);
assert.match(researchRoute, /searchComponentSuppliers/);
assert.match(researchRoute, /cache-control/);
assert.doesNotMatch(researchRoute, /body\?\.officeId|body\["officeId"\]/);
assert.doesNotMatch(workbench, /approved supplier|live quote|supplier contacted/i);

console.log("Supply OS Atlas inventory and sourcing workflow contract passed.");
