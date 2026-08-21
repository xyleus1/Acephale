import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const logisticsStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");

assert.match(shell, /className=\{`\$\{styles\.shell\} supply-os-workspace`\}/);
assert.doesNotMatch(shell, /shortLabel: "Fulfillment"|shortLabel: "Tracking"/);
assert.doesNotMatch(shell, /liveMapDot|Network map available/);
assert.match(shell, /shortLabel: "Opportunities", inactive: true/);
assert.match(dashboard, /<SupplyOsOpportunitiesPreview \/>/);
assert.match(shell, /className=\{styles\.operatingBrand\}/);
assert.match(shell, /<strong>Derya<\/strong>/);
assert.doesNotMatch(shell, /Build release|Supplier award|Landed cost/);
assert.doesNotMatch(dashboard, /ListChecks/);
assert.doesNotMatch(dashboard, /model\.actions\.length\} priorities/);
assert.doesNotMatch(dashboard, /<h2>\{model\.profile\}<\/h2>/);
assert.doesNotMatch(dashboard, /Priorities <small>\{model\.actions\.length\}<\/small>/);
assert.doesNotMatch(logisticsStyles, /\.optimizationInspector \.inspectorHeader/);
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx")), false);
assert.equal(existsSync(resolve(root, "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx")), false);

console.log("Supply OS operations UI contract passed.");
