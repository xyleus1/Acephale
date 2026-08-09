import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const paths = [
  "src/app/layout.tsx",
  "src/app/dashboard/layout.tsx",
  "src/app/dashboard/supplier-finder/steel-supplier-finder.tsx",
  "src/app/dashboard/supply-os/page.tsx",
  "src/app/dashboard/supply-os/supply-os-command-map.tsx",
  "src/app/dashboard/supply-os/supply-os-dashboard.tsx",
  "src/app/dashboard/supply-os/supply-os-decision-intelligence.tsx",
  "src/app/dashboard/supply-os/supply-os-operating-shell.tsx",
  "src/app/dashboard/supply-os/supply-os-product-twin.tsx",
  "src/app/dashboard/supply-os/supply-os-shared-workspace.tsx",
  "src/app/dashboard/supply-os/supply-os-snapshot-twin.tsx",
] as const;

const sources = new Map(paths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]));
const surface = [...sources.values()].join("\n");

for (const phrase of [
  "Products, inventory, sourcing, and execution",
  "Product, inventory, and sourcing model",
  "Operator surface",
  "Network online",
  "Open the live map",
  "Quantity-backed assembly graph",
  "Evidence and boundaries",
  "Canonical read model",
  "Office data plane",
  "Compatibility panels",
  "Procurement intelligence",
  "Public search brief",
  "Candidate bench",
  "Reliability gate",
  "Optimization priorities",
  "Company analysis",
  "Operating model",
]) {
  assert.equal(surface.includes(phrase), false, `visible product copy restored a banned phrase: ${phrase}`);
}

const shell = sources.get("src/app/dashboard/supply-os/supply-os-operating-shell.tsx") ?? "";
for (const structure of ["description:", "mapShortcut", "mapButton", "OPERATIONS_RIBBON", "focusBanner"]) {
  assert.equal(shell.includes(structure), false, `the Supply OS shell restored a redundant UI structure: ${structure}`);
}

assert.equal(surface.includes("\u2014"), false, "visible product source must not contain an em dash");

console.log("Product copy policy passed.");
