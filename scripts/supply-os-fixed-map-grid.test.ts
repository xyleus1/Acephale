import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");

assert.match(
  dashboard,
  /<section className=\{styles\.mapPanel\}[\s\S]*<SupplyOsCommandMap[\s\S]*<footer className=\{styles\.commandMapFooter\}/,
  "the map and legend must share one bounded map panel",
);
assert.match(styles, /grid-template-areas:\s*"map inspector"\s*"context inspector"/);
assert.match(styles, /grid-template-columns: minmax\(0, 1\.85fr\) minmax\(360px, 0\.9fr\)/);
assert.match(
  styles,
  /@media \(max-width: 1280px\)[\s\S]*grid-template-columns: minmax\(0, 1\.8fr\) minmax\(320px, 0\.9fr\)/,
  "the bounded map must retain the majority of the workspace at compact desktop widths",
);
assert.match(styles, /grid-template-rows: minmax\(0, 2\.35fr\) minmax\(190px, 1fr\)/);
assert.match(styles, /\.mapPanel\s*\{[\s\S]*grid-area: map;[\s\S]*border-radius: 16px/);
assert.match(styles, /\.routeRail\s*\{[\s\S]*grid-area: context/);
assert.match(styles, /\.commandInspector\s*\{[\s\S]*grid-area: inspector/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*grid-template-areas:\s*"map"\s*"context"\s*"inspector"/);
assert.match(styles, /Dedicated Logistics surface/);

console.log("Supply OS fixed map-grid contract passed.");
