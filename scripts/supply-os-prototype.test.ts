import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/supply-os/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const caseModel = readFileSync(join(root, "src/lib/supply-os-case-model.ts"), "utf8");
const dashboardLayout = readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8");
const source = `${page}\n${dashboardPage}\n${workspace}\n${styles}\n${caseModel}`;

for (const forbidden of ["prisma", "use server", "fetch(", "#063a2d", "#0d3b2e", "\u2014", "!important"]) {
  assert.equal(source.includes(forbidden), false, `Supply OS demo must not contain: ${forbidden}`);
}

for (const removedCopy of [
  "Supply Command",
  "Modeled workspace",
  "One operating picture for suppliers, freight, customs, cost, and delivery risk.",
  "Decision support only",
  "Global supply graph",
  "Movement dossier",
  "Evidence ledger",
  "Network event stream",
  "Operating policy",
  "Watch creation is not connected",
  "Export is not connected",
  "91%",
  "Last model run",
]) {
  assert.equal(workspace.includes(removedCopy), false, `removed Supply OS copy returned: ${removedCopy}`);
}

for (const required of [
  "What should Derya map?",
  "supply-case-prompt",
  "Build dashboard",
  "aria-live=\"polite\"",
  "resultsRef",
  "scrollIntoView",
  "Save dashboard",
  "Customer dashboards",
  "saved in this browser",
  "SUPPLY_CASE_STORAGE_KEY",
  "parseStoredSupplyCases",
  "serializeSupplyCases",
  "resolveSelectedSupplyCase",
  "Supplier search briefs",
  "Indicative shipping options",
  "Customs and risk checks",
  "Incomplete details stay marked for confirmation.",
  "Natural Earth geography",
  "WORLD_MAP_LAND_PATHS",
  "Needs confirmation",
]) {
  assert.equal(source.includes(required), true, `Supply OS case flow is missing: ${required}`);
}

assert.equal(page.includes('redirect("/dashboard/supply-os"'), true, "legacy Supply OS URL must redirect into the app");
assert.match(dashboardPage, /requireSession/, "the dashboard must derive browser storage scope from the authenticated session");
assert.match(dashboardPage, /session\.officeId/, "the browser storage scope must include officeId");
assert.match(dashboardPage, /session\.userId/, "the browser storage scope must include userId");
assert.match(workspace, /prompt\.trim\(\) === activeCase\.sourcePrompt/, "editing the prompt must disable stale dashboard saves");
assert.match(workspace, /setPrompt\(nextCase\.sourcePrompt\)/, "a generated case must normalize the composer to its saved source prompt");
assert.match(workspace, /directDistance > 500/, "map routes must wrap across the date line instead of crossing the wrong ocean");
assert.match(workspace, /primaryRouteSequence/, "the visible route sequence must follow connected route segments");
assert.match(workspace, /window\.addEventListener\("storage"/, "saved dashboards must refresh across browser tabs");
assert.match(workspace, /parseStoredSupplyCases\(readBrowserStorage\(storageKey\)\)/, "saving must merge against the latest browser state");
assert.match(workspace, /prefers-reduced-motion: reduce/, "scripted scrolling must respect reduced-motion preferences");
assert.match(workspace, /role="region" aria-labelledby="supplier-search-title" tabIndex=\{0\}/, "the supplier table scroll region must be keyboard reachable");
assert.match(workspace, /role="region" aria-labelledby="shipping-options-title" tabIndex=\{0\}/, "the shipping table scroll region must be keyboard reachable");
assert.match(workspace, /role="img" aria-labelledby="supply-map-svg-title"/, "the modeled route must expose one labeled map image");
assert.equal(workspace.includes('className={styles.mapNode}\n                  data-kind={node.kind}\n                  data-status={node.status}\n                  data-selected={isSelected}\n                  role="button"'), false, "SVG map marks must not masquerade as inaccessible buttons");
assert.match(workspace, /aria-pressed=\{item\.id === activeCase\?\.id\}/, "saved dashboards must expose the active case to assistive technology");
assert.match(workspace, /aria-pressed=\{selectedNodeId === node\.id\}/, "route buttons must expose the selected node");
assert.match(workspace, /aria-controls="supply-map-node-inspector"/, "route buttons must identify the node inspector they update");
assert.match(workspace, /className=\{styles\.srOnly\}>\{statusLabel\(node\.status\)\}/, "route status must not be color-only");
assert.equal(styles.includes(".mapSvg"), true, "generated cases need a scoped map surface");
assert.equal(styles.includes("@media (max-width: 1040px)"), true, "case dashboard needs a tablet layout");
assert.equal(styles.includes("@media (max-width: 560px)"), true, "case dashboard needs a mobile layout");
assert.equal(
  dashboardLayout.includes('<NavLink href="/dashboard/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>'),
  true,
  "dashboard sidebar must link to the authenticated Supply OS workspace",
);

console.log("supply OS case-flow checks passed");
