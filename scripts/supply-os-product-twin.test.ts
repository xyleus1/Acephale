import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const page = readFileSync(resolve(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const shellStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const commandMap = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"), "utf8");
const twin = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx"), "utf8");
const twinStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.module.css"), "utf8");
const sharedWorkspace = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-shared-workspace.tsx"), "utf8");
const intelligence = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-decision-intelligence.tsx"), "utf8");
const productPhoto = readFileSync(resolve(root, "public/supply-os/demo/vector3dhd-amr.jpg"));
const surface = `${page}\n${shell}\n${shellStyles}\n${twin}\n${twinStyles}\n${sharedWorkspace}\n${intelligence}`;

assert.match(page, /SupplyOsOperatingShell/, "the authenticated Supply OS route must render the operating shell");
assert.match(page, /session\.officeId/, "the shell must keep office-scoped persistence context");
assert.match(page, /session\.userId/, "browser-local compatibility state must remain user scoped");
assert.match(shell, /: "materials"/, "materials must be the default operating panel");

for (const panel of ["materials", "scenarios", "logistics"]) {
  assert.match(shell, new RegExp(`id: "${panel}"`), `the integrated shell is missing the ${panel} panel`);
}

for (const retiredPanel of ["fulfillment", "tracking"]) {
  assert.doesNotMatch(shell, new RegExp(`id: "${retiredPanel}"`), `the retired ${retiredPanel} panel must stay out of navigation`);
}

assert.match(shell, /SupplyOsDashboardWorkspace/, "the existing logistics and customs map must remain available inside Supply OS");
assert.doesNotMatch(shell, /SteelSupplierFinder|SupplyOsSnapshotTwin|TrackingAndCostPanel/, "domain changes must not mount separate full-page tools");
assert.match(dashboard, /DOMAIN_CONFIG/, "domain engines must feed one continuous operating workspace");
assert.match(commandMap, /commandMap\.insights/, "sourced intelligence must appear in the continuous map context");
assert.match(dashboard, /scenarios/, "opportunity mode must remain available inside the continuous workspace");
assert.match(dashboard, /\/supply-os\/demo\/vector3dhd-amr\.jpg/, "the materials dossier must use a project-owned real robotics photo");
assert.match(dashboard, /PattyK33/, "the product image must identify its creator");
assert.match(dashboard, /CC BY-SA 4\.0/, "the product image must carry its exact license");
assert.match(dashboard, /PRODUCT_MEDIA\.sourcePage/, "the product image must retain a source-page provenance link");
assert.match(twin, /href=\{attribution\.href\}/, "the rendered attribution must link to the recorded source page");
assert.deepEqual([...productPhoto.subarray(0, 3)], [0xff, 0xd8, 0xff], "the bundled product photo must be a valid JPEG asset");
assert.ok(productPhoto.byteLength > 100_000, "the bundled product photo must not be an empty placeholder");

for (const copy of [
  "AMR-240 warehouse robot",
  "BOM",
  "Buildable now",
  "Current-plan shortages",
  "Buy assembled vision module",
  "Qualify alternate camera source",
  "Evidence",
  "Approval required",
]) {
  assert.match(twin, new RegExp(copy), `the product twin is missing: ${copy}`);
}

assert.match(twin, /Math\.min\(\.\.\.BOM_ITEMS/, "buildability must be calculated from BOM constraints");
assert.match(twin, /url\.protocol === "https:"/, "remote image sources must be restricted to HTTPS");
assert.match(dashboard, /Modeled, not a live quote/, "tracking fixtures must not imply live execution");
assert.match(twin, /Demo only\. Nothing is approved or live\./, "product fixtures must keep their action boundary explicit");
assert.match(shellStyles, /prefers-reduced-motion: reduce/, "shell animation must respect reduced motion");
assert.match(sharedWorkspace, /\/api\/supply-os\/workspaces/, "shared controls must use the authenticated workspace API");
assert.match(sharedWorkspace, /\/imports/, "shared controls must stage versioned imports");
assert.match(sharedWorkspace, /\/publish/, "shared controls must require explicit publish");
assert.match(sharedWorkspace, /published snapshots are office-scoped/, "the UI must explain the shared persistence boundary");
assert.match(sharedWorkspace, /local or illustrative data/, "the UI must disclose remaining compatibility state");
assert.match(intelligence, /where: \{[\s\S]*officeId,/, "decision intelligence must remain office scoped");
assert.match(intelligence, /No quote or action is approved\./, "market signals must remain advisory evidence");

for (const forbidden of ["\u2014", "linear-gradient", "radial-gradient", "drop-shadow("]) {
  assert.equal(surface.includes(forbidden), false, `the Supply OS visual surface must not contain ${forbidden}`);
}

console.log("Supply OS product twin contract passed.");
