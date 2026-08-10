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
  "Inventory and sourcing must select the factory as its default map subject");
assert.match(dashboard, /fulfillment: \["customer"/,
  "Fulfillment must select customer demand as its default map subject");
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
assert.match(commandMap, /activePanel === "materials"[\s\S]*object\.kind === "supplier"[\s\S]*fitCoordinates\(\[supplier\.coordinates, facility\.coordinates\]/,
  "Inventory and sourcing source map must frame the selected supplier and facility together");
assert.match(commandMap, /activePanel === "fulfillment"[\s\S]*object\.kind === "customer"/,
  "Fulfillment camera focus must use customer coordinates");
assert.match(commandMap, /activePanel === "scenarios"[\s\S]*object\.kind === "customer"/,
  "Opportunity camera focus must use customer coordinates");
assert.match(commandMap, /focusRoute\(object\.edgeId/,
  "selecting a movement must frame its route instead of a meaningless midpoint");
assert.equal(
  commandMap.includes("mapRef.current?.loaded()) focusActivePanel(true)"),
  false,
  "tab camera commands must not be dropped while map sources are still loading",
);
assert.equal(
  commandMap.includes("|| !mapRef.current?.loaded()"),
  false,
  "object camera commands must not require every tile and source to be fully loaded",
);

console.log("Supply OS panel map-focus contract passed.");
