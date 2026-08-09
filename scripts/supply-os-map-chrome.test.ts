import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const commandMap = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"),
  "utf8",
);

assert.equal(commandMap.includes("ScaleControl"), false, "the map must not render a decorative distance ruler");
assert.equal(commandMap.includes("AttributionControl"), false, "the map must not render the intrusive attribution badge");
assert.equal(commandMap.includes("mapCredits"), false, "map data credits must not float over the map");
assert.equal(commandMap.includes("routePathSegment"), false, "route hit targets must not render as bottom-row buttons");
assert.equal(dashboard.includes("commandMapFooter"), false, "the redundant map legend must not float over the map");
assert.equal(styles.includes(".commandLegend"), false, "the removed map legend must not leave dead styling");
assert.match(dashboard, /className=\{styles\.mapDataSources\}/, "map data attribution must remain in the adjacent operations rail");
assert.match(dashboard, /openstreetmap\.org\/copyright/, "OpenStreetMap attribution must remain linked");
assert.match(dashboard, /carto\.com\/attributions/, "CARTO attribution must remain linked");
assert.match(dashboard, /openfreemap\.org/, "OpenFreeMap attribution must remain linked");
assert.equal(styles.includes("maplibregl-ctrl-attrib"), false, "dead attribution-control styling must be removed");

console.log("Supply OS map chrome contract passed.");
