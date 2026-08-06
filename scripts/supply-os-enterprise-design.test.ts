import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const source = `${workspace}\n${styles}`;

for (const required of [
  "Network operations",
  "Active movements",
  "Network layers",
  "Map filters",
  "Search supplier, port, or PO",
  "Scenario data, no live AIS or GPS",
  "Modeled network, not live tracking or AIS",
  "selectedMovementId",
  "WORLD_MAP_LAND_PATHS",
  ".controlTower",
  ".mapToolbar",
  ".mapFilters",
  ".mapInspector",
  ".movementTimeline",
]) {
  assert.equal(source.includes(required), true, `enterprise Supply OS is missing: ${required}`);
}

for (const interaction of [
  "setSelectedMovementId",
  "setFiltersOpen",
  "setNetworkLayers",
  "setZoom",
  "setLayer",
]) {
  assert.equal(workspace.includes(interaction), true, `enterprise Supply OS control is missing: ${interaction}`);
}

for (const forbidden of ["prisma", "use server", "fetch(", "!important", "\u2014"]) {
  assert.equal(source.includes(forbidden), false, `enterprise Supply OS must not contain: ${forbidden}`);
}

console.log("enterprise Supply OS design checks passed");
