import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/supply-os/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const caseModel = readFileSync(join(root, "src/lib/supply-os-case-model.ts"), "utf8");
const operatingPlan = readFileSync(join(root, "src/lib/supply-os-operating-plan.ts"), "utf8");
const dashboardLayout = readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8");
const source = `${page}\n${dashboardPage}\n${workspace}\n${styles}\n${caseModel}\n${operatingPlan}`;

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
  "buildSupplyOperatingPlan",
  "Movement scope",
  "Current conditions",
  "Port and customs plan",
  "Door-to-door execution",
  "Official integration paths, not active connections",
  "Quote blockers",
  "Modeled USD range",
  "Connection required",
  "Supplier search briefs",
  "Open checks",
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
assert.match(dashboardPage, /className=\{styles\.pageFrame\}/, "the Supply OS surface must escape dashboard padding without exposing the page background");
assert.match(workspace, /prompt\.trim\(\) === activeCase\.sourcePrompt/, "editing the prompt must disable stale dashboard saves");
assert.match(workspace, /setPrompt\(nextCase\.sourcePrompt\)/, "a generated case must normalize the composer to its saved source prompt");
assert.match(workspace, /directDistance > 500/, "map routes must wrap across the date line instead of crossing the wrong ocean");
assert.match(workspace, /movement\.pathSegmentIds/, "the visible route must follow movement-scoped connected segments");
assert.match(workspace, /window\.addEventListener\("storage"/, "saved dashboards must refresh across browser tabs");
assert.match(workspace, /parseStoredSupplyCases\(readBrowserStorage\(storageKey\)\)/, "saving must merge against the latest browser state");
assert.match(workspace, /prefers-reduced-motion: reduce/, "scripted scrolling must respect reduced-motion preferences");
assert.match(workspace, /role="region" aria-labelledby="supplier-search-title" tabIndex=\{0\}/, "the supplier table scroll region must be keyboard reachable");
assert.match(workspace, /role="region" aria-labelledby="execution-plan-title" tabIndex=\{0\}/, "the execution table scroll region must be keyboard reachable");
assert.match(workspace, /role="img" aria-labelledby="supply-map-svg-title"/, "the modeled route must expose one labeled map image");
assert.match(workspace, /className=\{styles\.mapNode\}[\s\S]*role="button"[\s\S]*tabIndex=\{0\}[\s\S]*aria-label=\{`Inspect \$\{node\.label\}`\}/, "map nodes must expose labeled keyboard-operable controls");
assert.match(workspace, /onClick=\{\(\) => setSelectedNodeId\(node\.id\)\}/, "map nodes must open the matching inspector on click");
assert.match(workspace, /event\.key === "Enter" \|\| event\.key === " "/, "map nodes must support Enter and Space activation");
assert.match(workspace, /className=\{styles\.mapNodeHitArea\}[\s\S]*r=\{22\}/, "map nodes must expose a 44 by 44 interaction target");
assert.match(workspace, /data-label="Provider candidates"/, "execution rows must preserve mobile field labels");
assert.match(workspace, /aria-pressed=\{item\.id === activeCase\?\.id\}/, "saved dashboards must expose the active case to assistive technology");
assert.match(workspace, /aria-pressed=\{movement\.movementId === selectedMovement\?\.movementId\}/, "movement buttons must expose the selected lane");
assert.match(workspace, /data-movement-id=\{movement\?\.movementId\}/, "derived plan sections must stay scoped to the selected movement");
assert.match(workspace, /activeSegmentIds\.has\(segment\.id\)/, "the map must emphasize only the selected movement path");
assert.match(workspace, /isPublicSourceUrl\(source\.url\)/, "internal integration requirements must not render as broken public links");
assert.match(workspace, /Request: \{provider\.request\}/, "provider rows must show the exact quote or booking request");
assert.match(workspace, /Quote inputs: \{leg\.quoteInputs\.join/, "execution legs must show the inputs needed for a real quote");
assert.equal(styles.includes(".mapSvg"), true, "generated cases need a scoped map surface");
assert.equal(styles.includes("@media (max-width: 1040px)"), true, "case dashboard needs a tablet layout");
assert.equal(styles.includes("@media (max-width: 560px)"), true, "case dashboard needs a mobile layout");
assert.equal(
  dashboardLayout.includes('<NavLink href="/dashboard/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>'),
  true,
  "dashboard sidebar must link to the authenticated Supply OS workspace",
);

console.log("supply OS case-flow checks passed");
