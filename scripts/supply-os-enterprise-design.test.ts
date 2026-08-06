import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
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

const colorTokens = new Set([
  ...(styles.match(/#[0-9a-fA-F]{6}/g) ?? []),
  ...(styles.match(/rgba?\([^)]*\)/g) ?? []),
]);
const approvedHexColors = new Set([
  "#0f1316",
  "#111518",
  "#11171a",
  "#14191d",
  "#191f23",
  "#222a2f",
  "#242b2f",
  "#262d31",
  "#2b343a",
  "#3c474e",
  "#717b82",
  "#789487",
  "#92a7b2",
  "#a7afb4",
  "#bd9255",
  "#cf6e74",
  "#e8ebed",
]);
const approvedRgbFamilies = new Set([
  "0,0,0",
  "20,25,29",
  "43,52,58",
  "60,71,78",
  "120,148,135",
  "146,167,178",
  "148,160,166",
  "189,146,85",
  "207,110,116",
]);

assert.ok(colorTokens.size <= 65, `enterprise Supply OS palette has drifted to ${colorTokens.size} color tokens`);
for (const token of colorTokens) {
  if (token.startsWith("#")) {
    assert.equal(approvedHexColors.has(token.toLowerCase()), true, `enterprise Supply OS contains an unapproved color: ${token}`);
    continue;
  }

  const rgbFamily = token.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)?.slice(1).join(",");
  assert.equal(approvedRgbFamilies.has(rgbFamily ?? ""), true, `enterprise Supply OS contains an unapproved color family: ${token}`);
}
assert.equal(styles.includes("radial-gradient"), false, "enterprise Supply OS must not use decorative radial highlights");
assert.equal(styles.includes("drop-shadow("), false, "enterprise Supply OS must not use glowing map treatments");
assert.equal(/box-shadow:\s*0\s+0/.test(styles), false, "enterprise Supply OS must not use decorative outer glows");
assert.equal(workspace.includes("className={styles.mapToolRail}"), false, "map mode controls must not be duplicated in a tool rail");
assert.equal(workspace.includes("className={styles.mapScopePlate}"), false, "map scope must not repeat the page context");
assert.equal(styles.includes(".mapToolRail"), false, "removed map controls must not leave dead styling behind");
assert.equal(styles.includes(".mapScopePlate"), false, "removed map scope must not leave dead styling behind");
assert.match(
  workspace,
  /<details className=\{styles\.evidenceLedger\}>\s*<summary>Evidence ledger/,
  "the command dossier evidence ledger must remain collapsed by default",
);
assert.equal(workspace.includes("supply-os-workspace"), true, "Supply OS needs a stable root scope for global style isolation");
for (const control of ["button", "input", "select", "textarea"]) {
  if (workspace.includes(`<${control}`)) {
    assert.equal(
      globals.includes(`${control}:not(:where(.supply-os-workspace ${control}))`),
      true,
      `legacy global ${control} rules must exclude Supply OS`,
    );
  }
}
assert.equal(globals.includes(":not(.supply-os-workspace"), false, "Supply OS exclusions must not increase global selector specificity");
assert.equal(
  globals.includes('[role="button"]:not(:where(.supply-os-workspace [role="button"])):focus-visible'),
  true,
  "global role-button focus styling must not override Supply OS map focus states",
);
for (const leakingSelector of [
  /^input,\s*select/m,
  /^select(?:\s*\{|,|:focus)/m,
  /^textarea(?:\s*\{|,|:focus)/m,
  /^button(?:,|:disabled|:hover|:active|:focus-visible)/m,
  /^input::placeholder/m,
]) {
  assert.equal(leakingSelector.test(globals), false, `generic global control selector still leaks into Supply OS: ${leakingSelector}`);
}
assert.equal(styles.includes(".workspace button:focus-visible"), true, "Supply OS must keep a neutral keyboard focus treatment");

const tabletStyles = styles.slice(styles.lastIndexOf("@media (max-width: 1040px)"), styles.indexOf("@media (max-width: 900px)"));
for (const requiredTabletRule of [".commandLayout", "flex-direction: column", ".commandMap", ".intelligenceRail"]) {
  assert.equal(tabletStyles.includes(requiredTabletRule), true, `tablet Supply OS stacking is missing: ${requiredTabletRule}`);
}

console.log("enterprise Supply OS design checks passed");
