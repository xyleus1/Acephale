import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const page = readFileSync(resolve(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const shellStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const commandMap = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"), "utf8");
const sharedWorkspace = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-shared-workspace.tsx"), "utf8");
const intelligence = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-decision-intelligence.tsx"), "utf8");
const surface = `${page}\n${shell}\n${shellStyles}\n${dashboard}\n${sharedWorkspace}\n${intelligence}`;

assert.match(page, /SupplyOsOperatingShell/, "the authenticated Supply OS route must render the operating shell");
assert.match(page, /session\.officeId/, "the shell must keep office-scoped persistence context");
assert.match(page, /session\.userId/, "browser-local request state must remain user scoped");
assert.match(shell, /: "materials"/, "materials must be the default operating panel");

for (const panel of ["materials", "scenarios", "logistics"]) {
  assert.match(shell, new RegExp(`id: "${panel}"`), `the integrated shell is missing the ${panel} panel`);
}

for (const retiredPanel of ["fulfillment", "tracking"]) {
  assert.doesNotMatch(shell, new RegExp(`id: "${retiredPanel}"`), `the retired ${retiredPanel} panel must stay out of navigation`);
}

assert.match(shell, /SupplyOsDashboardWorkspace/, "the logistics and customs map must remain available inside Supply OS");
assert.doesNotMatch(shell, /SupplyOsSnapshotTwin|SupplyOsProductTwin|TrackingAndCostPanel/, "authenticated customer workspaces must not mount synthetic product twins");
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx")), false, "the compiled product fixture must stay out of production source");
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx")), false, "the fallback snapshot adapter must stay out of production source");
assert.match(dashboard, /DOMAIN_CONFIG/, "domain engines must feed one continuous operating workspace");
assert.match(commandMap, /commandMap\.insights/, "sourced intelligence must appear in the continuous map context");
assert.match(dashboard, /scenarios/, "opportunity mode must remain available inside the continuous workspace");
assert.doesNotMatch(dashboard, /PRODUCT_MEDIA|vector3dhd-amr|Product reference/, "the customer dossier must not inject an unrelated product image");
assert.match(dashboard, /Modeled, not a live quote/, "tracking models must not imply live execution");
assert.match(shellStyles, /prefers-reduced-motion: reduce/, "shell animation must respect reduced motion");
assert.match(sharedWorkspace, /\/api\/supply-os\/workspaces/, "shared controls must use the authenticated workspace API");
assert.match(sharedWorkspace, /\/imports/, "shared controls must stage versioned imports");
assert.match(sharedWorkspace, /\/publish/, "shared controls must require explicit publish");
assert.match(sharedWorkspace, /published snapshots are office-scoped/, "the UI must explain the shared persistence boundary");
assert.match(sharedWorkspace, /without a published snapshot stay empty/, "the UI must fail closed when customer inventory has not been published");
assert.match(intelligence, /where: \{[\s\S]*officeId,/, "decision intelligence must remain office scoped");
assert.match(intelligence, /No quote or action is approved\./, "market signals must remain advisory evidence");

for (const forbidden of ["\u2014", "linear-gradient", "radial-gradient", "drop-shadow("]) {
  assert.equal(surface.includes(forbidden), false, `the Supply OS visual surface must not contain ${forbidden}`);
}

console.log("Supply OS product data boundary contract passed.");
