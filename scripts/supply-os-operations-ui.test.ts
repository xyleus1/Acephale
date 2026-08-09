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

assert.match(shell, /className=\{`\$\{styles\.shell\} supply-os-workspace`\}/);
assert.match(shell, /<h2 id="supply-os-tracking-title">Tracking<\/h2>/);
assert.match(shell, /Approval required/);
assert.doesNotMatch(shell, /Build release|Supplier award|Landed cost/);

assert.match(twin, /import \{ AnimatePresence, motion \} from "motion\/react"/);
assert.match(twin, /layoutId="supply-os-tree-selection"/);
assert.match(twin, /layoutId="supply-os-graph-selection"/);
assert.match(twin, /<AnimatePresence mode="wait" initial=\{false\}>/);
assert.match(twin, /transition=\{\{ duration: 0\.16/);
assert.match(twinStyles, /@media \(prefers-reduced-motion: reduce\)/);

console.log("Supply OS operations UI contract passed.");
