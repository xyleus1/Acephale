import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);
const commandMap = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"),
  "utf8",
);

assert.match(dashboard, /materials: \["factory"/,
  "Supply must select the factory as its default map subject");
assert.match(dashboard, /suppliers: \["supplier"/,
  "Suppliers must select a supplier as its default map subject");
assert.match(dashboard, /scenarios: \["customer"/,
  "Opportunities must select customer demand as its default map subject");
assert.match(dashboard, /logistics: \["movement"/,
  "Logistics must select an active movement as its default map subject");
assert.match(dashboard, /tracking: \["movement"/,
  "Tracking must select an active movement as its default map subject");
assert.match(commandMap, /const focusActivePanel = useCallback/,
  "the map must expose one deterministic camera operation for tab changes");
assert.match(commandMap, /focusActivePanel\(true\)/,
  "selecting a tab must animate the camera to its operating context");
assert.match(commandMap, /activePanel === "materials"[\s\S]*object\.kind === "factory"/,
  "Supply camera focus must use factory coordinates");
assert.match(commandMap, /activePanel === "scenarios"[\s\S]*object\.kind === "customer"/,
  "Opportunity camera focus must use customer coordinates");
assert.match(commandMap, /focusRoute\(object\.edgeId/,
  "selecting a movement must frame its route instead of a meaningless midpoint");

console.log("Supply OS panel map-focus contract passed.");
