import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const commandMap = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"),
  "utf8",
);

assert.equal(commandMap.includes("ScaleControl"), false, "the map must not render a decorative distance ruler");
assert.equal(commandMap.includes("AttributionControl"), false, "the map must not render the intrusive attribution badge");
assert.match(commandMap, /className=\{styles\.mapCredits\}/, "quiet map credits must replace MapLibre control chrome");
assert.match(commandMap, /openstreetmap\.org\/copyright/, "OpenStreetMap attribution must remain linked");
assert.match(commandMap, /basemapCredit/, "the visible tile-provider credit must follow the active basemap");
assert.match(styles, /\.mapCredits\s*\{[\s\S]*top: 12px;[\s\S]*left: 14px;/, "credits must stay clear of the map's bottom edge");
assert.equal(styles.includes("maplibregl-ctrl-attrib"), false, "dead attribution-control styling must be removed");

console.log("Supply OS map chrome contract passed.");
