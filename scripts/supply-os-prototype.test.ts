import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const legacyPage = readFileSync(join(root, "src/app/supply-os/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const generatorPage = readFileSync(join(root, "src/app/dashboard/supply-os/new/page.tsx"), "utf8");
const dashboard = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const generator = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-generator.tsx"), "utf8");
const storage = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-storage.ts"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const caseModel = readFileSync(join(root, "src/lib/supply-os-case-model.ts"), "utf8");
const operatingPlan = readFileSync(join(root, "src/lib/supply-os-operating-plan.ts"), "utf8");
const dashboardLayout = readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8");
const uiSource = `${legacyPage}\n${dashboardPage}\n${generatorPage}\n${dashboard}\n${generator}\n${storage}\n${styles}`;

for (const forbidden of ["prisma", "use server", "fetch(", "#063a2d", "#0d3b2e", "\u2014", "!important"]) {
  assert.equal(uiSource.includes(forbidden), false, `Supply OS UI must not contain: ${forbidden}`);
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
  "Official integration paths, not active connections",
  "Supplier search briefs",
  "Quote inputs:",
  "Request: {provider.request}",
]) {
  assert.equal(dashboard.includes(removedCopy), false, `removed Supply OS detail returned: ${removedCopy}`);
}

for (const required of [
  "New customer",
  "Customer dashboards",
  "supply-case-prompt",
  "Build case",
  "Save and open dashboard",
  "Review before saving",
  "SUPPLY_CASE_STORAGE_KEY",
  "parseStoredSupplyCases",
  "serializeSupplyCases",
  "resolveSelectedSupplyCase",
  "buildSupplyOperatingPlan",
  "Customers",
  "Supply map",
  "Recommended plan",
  "Door-to-door plan",
  "Customs",
  "Risks to verify",
  "WORLD_MAP_LAND_PATHS",
]) {
  assert.equal(uiSource.includes(required), true, `Supply OS split flow is missing: ${required}`);
}

assert.equal(legacyPage.includes('redirect("/dashboard/supply-os"'), true, "legacy Supply OS URL must redirect into the app");

for (const page of [dashboardPage, generatorPage]) {
  assert.match(page, /requireSession/, "each Supply OS page must require an authenticated session");
  assert.match(page, /session\.officeId/, "each Supply OS page must scope storage by officeId");
  assert.match(page, /session\.userId/, "each Supply OS page must scope storage by userId");
  assert.match(page, /className=\{styles\.pageFrame\}/, "each Supply OS page must preserve the full-width frame");
}

assert.equal(dashboard.includes("supply-case-prompt"), false, "the dashboard page must not contain the customer generator");
assert.equal(dashboard.includes("What should Derya map?"), false, "the dashboard page must not repeat the generation prompt");
assert.equal(generator.includes("function CaseDashboard("), false, "the generator page must not render the operational dashboard");
assert.equal(generator.includes("customerBrowser"), false, "the generator page must not render the saved-customer browser");
assert.match(dashboard, /href="\/dashboard\/supply-os\/new"/, "the dashboard must link to a separate customer generator page");
assert.match(generator, /href="\/dashboard\/supply-os"/, "the generator must link back to saved customer dashboards");

assert.match(generator, /prompt\.trim\(\) === generatedCase\.sourcePrompt/, "editing a generated prompt must disable stale saves");
assert.match(generator, /loadSupplyCases\(storageScope\)\.cases/, "saving must merge against the latest browser state");
assert.match(generator, /persistSupplyCases\(storageScope, nextCases, generatedCase\.id\)/, "saving must persist both the case list and selected case");
assert.ok(
  generator.indexOf("persistSupplyCases(storageScope, nextCases, generatedCase.id)") < generator.indexOf('router.push("/dashboard/supply-os")'),
  "the selected case must be persisted before dashboard navigation",
);
assert.match(generator, /if \(!persistSupplyCases[\s\S]*return;/, "failed browser storage must block navigation");
assert.match(storage, /serializeSupplyCases\(cases\)/, "stored dashboards must retain the v1 serializer");
assert.match(storage, /previousCases[\s\S]*previousSelected[\s\S]*return false;/, "a failed selected-case write must roll back the partial save");
assert.match(storage, /filter\(\(item\) => !item\.archivedAt\)/, "archived dashboards must stay out of the customer browser");
assert.match(storage, /b\.updatedAt\.localeCompare\(a\.updatedAt\)/, "saved dashboards must be newest first");
assert.match(dashboard, /window\.addEventListener\("storage"/, "saved dashboards must refresh across browser tabs");

assert.match(dashboard, /directDistance > 500/, "map routes must wrap across the date line");
assert.match(dashboard, /movement\?\.pathSegmentIds/, "the map must stay scoped to the selected movement");
assert.match(dashboard, /role="img" aria-labelledby="supply-map-svg-title"/, "the route must expose one labeled map image");
assert.match(dashboard, /className=\{styles\.mapNode\}[\s\S]*role="button"[\s\S]*tabIndex=\{0\}[\s\S]*aria-label=\{`Inspect \$\{node\.label\}`\}/, "map nodes must be keyboard operable");
assert.match(dashboard, /event\.key === "Enter" \|\| event\.key === " "/, "map nodes must support Enter and Space");
assert.match(dashboard, /className=\{styles\.mapNodeHitArea\}[\s\S]*r=\{22\}/, "map nodes must expose a 44px target");
assert.match(styles, /\.mapNode:focus-visible[\s\S]*stroke-width:\s*3/, "keyboard-focused map nodes must have a visible focus indicator");
assert.match(dashboard, /aria-pressed=\{item\.id === activeCase\?\.id\}/, "customer buttons must expose the active dashboard");
assert.match(dashboard, /aria-pressed=\{movement\.movementId === selectedMovement\?\.movementId\}/, "movement buttons must expose the active lane");
assert.match(dashboard, /data-movement-id=\{selectedMovement\?\.movementId\}/, "the plan must stay movement scoped");
assert.match(dashboard, /activeSegmentIds\.has\(segment\.id\)/, "the map must emphasize only the selected movement path");

for (const rawDetail of ["connectorGrid", "EvidenceLinks", "provider.request", "leg.quoteInputs", "leg.handoff", "invoiceGuidance.map", "supplierOptions.map", "Needs your input", "inputList"]) {
  assert.equal(dashboard.includes(rawDetail), false, `customer dashboard must not expose raw planning detail: ${rawDetail}`);
}

assert.equal(styles.includes(".mapSvg"), true, "saved dashboards need a scoped map surface");
assert.equal(styles.includes("@media (max-width: 1040px)"), true, "dashboard needs a tablet layout");
assert.equal(styles.includes("@media (max-width: 560px)"), true, "dashboard needs a mobile layout");
assert.equal(
  dashboardLayout.includes('<NavLink href="/dashboard/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>'),
  true,
  "dashboard sidebar must link to Supply OS",
);

assert.ok(caseModel.length > 1000, "the stored case model must remain intact");
assert.ok(operatingPlan.length > 1000, "the operating-plan engine must remain intact");

console.log("supply OS split-page checks passed");
