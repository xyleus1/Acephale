import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");

assert.match(shell, /id: "scenarios", shortLabel: "Opportunities"/);
assert.match(shell, /activePanel=\{activePanel\}/);
assert.match(dashboard, /scenarios: \{[\s\S]*defaultInspector: "optimization"/);
assert.match(dashboard, /SupplyOsOpportunitiesPreview/);
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx")), false);
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx")), false);

console.log("Supply OS scenario viewport contract passed.");
