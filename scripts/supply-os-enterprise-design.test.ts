import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const commandModel = readFileSync(join(root, "src/lib/supply-os-command-model.ts"), "utf8");
const source = `${workspace}\n${styles}\n${commandModel}`;

for (const required of [
  "Supply Command",
  "Priority queue",
  "Movement dossier",
  "Evidence ledger",
  "Global supply graph",
  "Supplier intelligence",
  "Source network",
  "Transport decision",
  "Operational chronology",
  "Operating policy",
  "Modeled workspace",
  "No live AIS, GPS, carrier, customs, or port feed is connected",
  "WORLD_MAP_LAND_PATHS",
  ".commandLayout",
  ".mapWorkspace",
  ".intelligenceRail",
  ".recordDossier",
  ".quoteDecision",
  ".procurementEmpty",
  ".policyMatrix",
]) {
  assert.equal(source.includes(required), true, `enterprise Supply OS is missing: ${required}`);
}

for (const interaction of [
  "setScenario",
  "setSelectedMovementId",
  "setFiltersOpen",
  "setNetworkLayers",
  "setSelectedSupplierId",
  "setApprovedQuoteId",
  "resolveMovementAssessment",
  "resolveMovementOwnedRecord",
  "originCountryForMovement",
  "procurementProfileForMovement",
  "setMode",
  "setPermissions",
  "setZoom",
  "Watch creation is not connected in this prototype",
  "Export is not connected in this prototype",
  'setView("procurement")',
]) {
  assert.equal(workspace.includes(interaction), true, `enterprise Supply OS control is missing: ${interaction}`);
}

for (const forbidden of ["prisma", "use server", "fetch(", "!important", "\u2014"]) {
  assert.equal(source.includes(forbidden), false, `enterprise Supply OS must not contain: ${forbidden}`);
}

console.log("enterprise Supply OS design checks passed");
