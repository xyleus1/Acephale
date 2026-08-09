import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const map = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"), "utf8");
const shellStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const logisticsStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");

assert.match(
  shell,
  /<SupplyOsDashboardWorkspace[\s\S]*activePanel=\{activePanel\}[\s\S]*\/>/,
  "every domain must drive the same mounted workspace",
);
assert.doesNotMatch(shell, /key=\{activePanel\}/, "domain changes must not remount the workspace");
assert.doesNotMatch(
  shell,
  /activePanel === "(?:materials|logistics|fulfillment|scenarios|tracking)"\s*\?\s*\(/,
  "domain changes must not swap page-sized components",
);
assert.doesNotMatch(shell, /SteelSupplierFinder|SupplyOsSnapshotTwin|TrackingAndCostPanel/);
assert.match(dashboard, /const DOMAIN_CONFIG: Record<SupplyOsPanel/);
assert.match(dashboard, /data-domain=\{activePanel\}/);
assert.match(dashboard, /data-embedded=\{!presentationMode\}/);
assert.match(map, /data-domain=\{activePanel\}/);
assert.match(map, /line-dasharray/);
assert.match(shellStyles, /\.panelStage\s*\{[\s\S]*overflow: hidden/);
assert.doesNotMatch(dashboard, /<header className=\{styles\.commandHeader\}>/, "the workspace must not duplicate the persistent company ribbon");
assert.doesNotMatch(dashboard, /aria-label="Network coverage"/, "network counts must not consume a second header row");
assert.match(logisticsStyles, /\.commandCenter\s*\{[\s\S]*grid-template-rows: minmax\(0, 1fr\);/, "removing the duplicate ribbon must return its height to the workspace");

console.log("Supply OS continuous-layout contract passed.");
