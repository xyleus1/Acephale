import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"),
  "utf8",
);
const twin = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx"),
  "utf8",
);
const twinStyles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.module.css"),
  "utf8",
);
const dashboard = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);
const logisticsStyles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"),
  "utf8",
);

assert.match(shell, /className=\{`\$\{styles\.shell\} supply-os-workspace`\}/);
assert.match(shell, /shortLabel: "Tracking"/);
assert.match(shell, /className=\{styles\.operatingBrand\}/);
assert.match(shell, /<strong>Derya<\/strong>/);
assert.match(twin, /Approval required/);
assert.doesNotMatch(shell, /Build release|Supplier award|Landed cost/);
assert.doesNotMatch(dashboard, /ListChecks/);
assert.doesNotMatch(dashboard, /model\.actions\.length\} priorities/);
assert.match(
  logisticsStyles,
  /\.optimizationInspector \.inspectorHeader \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/,
);

assert.match(twin, /import \{ AnimatePresence, motion \} from "motion\/react"/);
assert.match(twin, /layoutId="supply-os-tree-selection"/);
assert.match(twin, /layoutId="supply-os-graph-selection"/);
assert.match(twin, /<AnimatePresence mode="wait" initial=\{false\}>/);
assert.match(twin, /transition=\{\{ duration: 0\.16/);
assert.match(twinStyles, /@media \(prefers-reduced-motion: reduce\)/);

console.log("Supply OS operations UI contract passed.");
