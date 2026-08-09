import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");

assert.match(
  dashboard,
  /<section className=\{styles\.mapPanel\}[\s\S]*<SupplyOsCommandMap[\s\S]*<footer className=\{styles\.commandMapFooter\}/,
  "the map and legend must share one bounded map panel",
);
assert.match(styles, /grid-template-areas:\s*"map inspector"\s*"context inspector"/);
assert.match(styles, /grid-template-columns: minmax\(0, 1\.85fr\) minmax\(340px, 0\.9fr\)/);
assert.match(
  styles,
  /@media \(max-width: 1180px\)[\s\S]*grid-template-columns: minmax\(0, 1\.85fr\) minmax\(260px, 0\.9fr\)/,
  "the bounded map must retain the majority of the workspace at compact desktop widths",
);
assert.match(styles, /grid-template-rows: minmax\(0, 2\.35fr\) minmax\(188px, 1fr\)/);
assert.match(styles, /\.mapPanel\s*\{[\s\S]*grid-area: map;[\s\S]*border-radius: 16px/);
assert.match(styles, /\.commandMapStage > \.routeRail\s*\{[\s\S]*grid-area: context/);
assert.match(styles, /\.commandMapStage > \.commandInspector\s*\{[\s\S]*grid-area: inspector/);
assert.match(styles, /Domains change content, never panel geometry/);

console.log("Supply OS fixed map-grid contract passed.");
