import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const commandMap = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"), "utf8");
const generator = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-generator.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const workstreamShell = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workstream-shell.tsx"), "utf8");
const workstreamStyles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workstream.module.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const designSystem = readFileSync(join(root, "src/app/design-system.css"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const source = `${dashboard}\n${commandMap}\n${generator}\n${styles}\n${workstreamShell}\n${workstreamStyles}`;

for (const required of [
  ".commandWorkspace",
  ".commandHeader",
  ".commandMapStage",
  ".commandMap",
  ".mapMarker",
  ".mapHoverCard",
  ".routeRail",
  ".commandInspector",
  ".inspectorContacts",
  ".inspectorChecks",
  ".commandMapFooter",
  "Provider contacts",
  "Supplier candidates",
  "Open checks",
  "Next action",
  "Open {workspace.shortLabel}",
  "Carrier shortlist",
  "Modeled, not a live quote",
  "Execution workspace reserved",
]) {
  assert.equal(source.includes(required), true, `Supply OS command surface is missing: ${required}`);
}

for (const removedSurface of [
  "customerBrowser",
  "operatingBrief",
  "optimizationList",
  "kickoffStrip",
  "evidenceGrid",
  "WORLD_MAP_LAND_PATHS",
  "mapSvg",
]) {
  assert.equal(dashboard.includes(removedSurface), false, `legacy dashboard surface returned: ${removedSurface}`);
}

for (const forbidden of [
  "radial-gradient",
  "linear-gradient",
  "drop-shadow(",
  "transition: all",
  "!important",
  "\u2014",
  ".companyLogo",
  "text-decoration: underline",
  "box-shadow: inset",
  "Supply Command",
  "Modeled workspace",
  "Decision support only",
  "Official integration paths",
  "Modeled USD range",
  "Expected cost",
]) {
  assert.equal(source.includes(forbidden), false, `Supply OS must not contain: ${forbidden}`);
}

for (const dependency of [
  '"maplibre-gl"',
  '"@vis.gl/react-maplibre"',
  '"lucide-react"',
  '"@radix-ui/react-dropdown-menu"',
  '"@radix-ui/react-tabs"',
  '"@radix-ui/react-tooltip"',
  '"recharts"',
]) {
  assert.equal(packageJson.includes(dependency), true, `Supply OS is missing maintained UI dependency: ${dependency}`);
}
assert.match(commandMap, /@vis\.gl\/react-maplibre/, "map rendering must come from React MapLibre");
assert.match(commandMap, /lucide-react/, "map symbols must come from Lucide");
assert.match(commandMap, /@radix-ui\/react-tooltip/, "map controls must use an accessible tooltip primitive");
assert.match(dashboard, /@radix-ui\/react-dropdown-menu/, "customer and scope menus must use an accessible dropdown primitive");
assert.match(dashboard, /@radix-ui\/react-tabs/, "object detail and optimization analysis must use an accessible tabs primitive");
assert.match(dashboard, /from "recharts"/, "operating flows and cost ranges must use a maintained chart library");
assert.match(dashboard, /<Sankey/, "the inspector must visualize supplier-to-factory flow");
assert.match(commandMap, /<Source id="supply-routes" type="geojson"/, "route geometry must render inside the maintained MapLibre map");
assert.match(commandMap, /<Layer[\s\S]*id="supply-route-core"/, "the map must render a visible connected route layer");
assert.match(commandMap, /routeDirectionMarker/, "route corridors must show repeated directional markers");
assert.match(commandMap, /offset=\{markerOffset\(object\.kind\)\}/, "movement and customs markers must remain separately selectable");
assert.match(styles, /maplibregl-canvas:focus-visible/, "the interactive map canvas needs a visible keyboard focus state");
assert.match(commandMap, /basemaps\.cartocdn\.com\/gl\/positron-gl-style\/style\.json/, "the live map needs the maintained CARTO Positron basemap");
assert.match(commandMap, /carto-raster/, "the live map needs a low-dependency raster fallback");
assert.match(commandMap, /id=\{ROUTE_HIT_LAYER_ID\}/, "route geometry must expose a dedicated hit layer");
assert.match(commandMap, /"line-width": 24/, "route geometry needs a forgiving pointer hit target");
assert.match(commandMap, /canvas\.style\.cursor = routeId \? "pointer" : ""/, "clickable routes must advertise pointer interaction");
assert.match(styles, /\.routePathSegment \{[^}]*height: 24px/s, "curved route segments need a forgiving direct hit target");
assert.match(styles, /\.routePathSegment \{[^}]*cursor: pointer/s, "curved route segments must advertise pointer interaction");
assert.equal(commandMap.includes("WEBGL_lose_context"), false, "capability detection must not explicitly discard a browser graphics context");
assert.match(dashboard, /alignOffset=\{3[0-9]{2}\}/, "the coverage menu must open clear of the right-side inspector");
assert.match(dashboard, /avoidCollisions=\{false\}/, "coverage-menu positioning must not be pulled back over the inspector");
assert.match(dashboard, /<Tabs\.Trigger value="optimization">Priorities/, "the inspector must expose the optimization analysis");
assert.match(dashboard, /analysisPriorityList/, "the inspector must keep the ranked priority list");
assert.match(dashboard, /companyNameHint\(dashboard\.sourcePrompt\)/, "saved SEO taglines must collapse back to the researched company name");
assert.match(dashboard, /function companyLogoUrl/, "saved dashboards must reject obvious hero and customer images as company logos");
assert.match(dashboard, /contact\.phone/, "local carrier cards must expose official phone contacts when available");
assert.match(dashboard, /contact\.proximity/, "carrier candidates must explain which endpoint they are near");

for (const token of [
  "--ds-canvas: #f7f8f7",
  "--ds-surface: #ffffff",
  "--ds-surface-selected: #eaf0f2",
  "--ds-ink: #1b1d1c",
  "--ds-navy: #29485c",
  "--ds-decision: #a76b45",
  "--ds-radius-control: 10px",
  "--ds-radius-panel: 14px",
  "--ds-radius-workspace: 16px",
  'font-family: "Instrument Sans"',
]) {
  assert.equal(designSystem.includes(token), true, `app design system is missing: ${token}`);
}
assert.match(styles, /\.workspace \.commandCenter \{[^}]*border-radius: 16px/s, "command workspace must use the approved 16px geometry");
assert.match(styles, /\.workspace \.routeRail,[\s\S]*border-radius: 14px/s, "map overlays must use the approved 14px geometry");
assert.equal(styles.includes("linear-gradient"), false, "Supply OS must not use decorative gradients");
assert.equal(dashboard.includes("supply-os-workspace"), true, "dashboard needs a stable root for global style isolation");
assert.equal(generator.includes("supply-os-workspace"), true, "generator needs a stable root for global style isolation");
for (const control of ["button", "textarea"]) {
  assert.equal(
    globals.includes(`${control}:not(:where(.supply-os-workspace ${control}))`),
    true,
    `legacy global ${control} rules must exclude Supply OS`,
  );
}
assert.equal(globals.includes(":not(.supply-os-workspace"), false, "Supply OS exclusions must not raise global specificity");

const fixedViewport = styles.slice(styles.indexOf(".commandWorkspace {"), styles.indexOf(".presentationWorkspace {"));
for (const rule of ["height: calc(100dvh - 56px)", "display: grid", "overflow: hidden"]) {
  assert.equal(fixedViewport.includes(rule), true, `fixed command viewport is missing: ${rule}`);
}
const mapStage = styles.slice(styles.indexOf(".commandMapStage {"), styles.indexOf(".commandMap {"));
assert.equal(mapStage.includes("overflow: hidden"), true, "map stage must not create document scrolling");
assert.match(styles, /\.routeRail,[\s\S]*\.commandInspector[\s\S]*position: absolute/, "network rail and inspector must overlay the map");
assert.match(styles, /\.commandMapFooter[\s\S]*position: absolute/, "status strip must stay inside the map viewport");

const compactStyles = styles.slice(styles.indexOf("@media (max-width: 1180px)"), styles.indexOf("@media (max-width: 900px)"));
for (const rule of [".routeRail", ".commandInspector", ".commandMapFooter"]) {
  assert.equal(compactStyles.includes(rule), true, `compact command layout is missing: ${rule}`);
}

const tabletStyles = styles.slice(styles.indexOf("@media (max-width: 900px)"), styles.lastIndexOf("@media (max-width: 680px)"));
for (const rule of [".routeRail", ".commandInspector", ".routeRailList"]) {
  assert.equal(tabletStyles.includes(rule), true, `tablet command layout is missing: ${rule}`);
}

const mobileStyles = styles.slice(styles.lastIndexOf("@media (max-width: 680px)"));
for (const rule of [".commandWorkspace", ".commandHeader", ".routeRail", ".commandInspector", ".commandMapFooter"]) {
  assert.equal(mobileStyles.includes(rule), true, `mobile command layout is missing: ${rule}`);
}

console.log("Supply OS enterprise design checks passed");
