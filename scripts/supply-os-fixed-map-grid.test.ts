import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");

assert.match(
  dashboard,
  /<section className=\{styles\.mapPanel\}[\s\S]*<SupplyOsCommandMap[\s\S]*<\/section>/,
  "the map must remain inside one bounded map panel",
);
assert.equal(dashboard.includes("commandMapFooter"), false, "the bounded map must not contain floating legend chrome");
assert.match(styles, /grid-template-areas:\s*"map inspector"\s*"context inspector"/);
assert.match(styles, /grid-template-columns: minmax\(0, 2\.6fr\) minmax\(300px, 0\.75fr\)/);
assert.match(
  styles,
  /@media \(max-width: 1280px\)[\s\S]*grid-template-columns: minmax\(0, 2\.6fr\) minmax\(300px, 0\.75fr\)/,
  "the bounded map must retain the majority of the workspace at compact desktop widths",
);
assert.match(styles, /grid-template-rows: minmax\(0, 3\.8fr\) minmax\(140px, 0\.72fr\)/);
assert.match(styles, /\.mapPanel\s*\{[\s\S]*grid-area: map;[\s\S]*border-radius: 16px/);
assert.match(styles, /\.routeRail\s*\{[\s\S]*grid-area: context/);
assert.match(styles, /\.commandInspector\s*\{[\s\S]*grid-area: inspector/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*grid-template-areas:\s*"map"\s*"context"\s*"inspector"/);
assert.match(styles, /Dedicated Logistics surface/);

console.log("Supply OS fixed map-grid contract passed.");
