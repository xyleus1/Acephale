import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const adapter = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx"), "utf8");
const twin = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.module.css"), "utf8");

assert.match(shell, /id: "scenarios", shortLabel: "Opportunities"/);
assert.match(shell, /activePanel=\{activePanel\}/);
assert.match(dashboard, /scenarios: \{[\s\S]*defaultInspector: "optimization"/);
assert.match(adapter, /view\?: "materials" \| "scenarios"/);
assert.match(adapter, /<SupplyOsProductTwin[^>]+view=\{view\}/);
assert.match(twin, /data-view=\{view\}/);
assert.match(styles, /\.twin\[data-view="scenarios"\] \.identityStrip/);
assert.match(styles, /\.twin\[data-view="scenarios"\] \.graphPanel/);
assert.match(styles, /\.twin\[data-view="scenarios"\] \.scenarioSection \{\s+order: 1;/);

console.log("Supply OS scenario viewport contract passed.");
