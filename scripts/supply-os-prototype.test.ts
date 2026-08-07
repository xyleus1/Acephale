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
const engagementPlan = readFileSync(join(root, "src/lib/supply-os-engagement-plan.ts"), "utf8");
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
  "How should Derya help?",
  "Run the full supply chain, or choose one place to start.",
  "SUPPLY_CASE_STORAGE_KEY",
  "parseStoredSupplyCases",
  "serializeSupplyCases",
  "resolveSelectedSupplyCase",
  "buildSupplyEngagementPlan",
  "Customers",
  "Derya needs these 3 things",
  "What Derya takes over",
  "Operating network",
  "Customs handoff",
  "Checks before we commit",
  "Execution detail",
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
assert.match(generator, /engagementScope === \(generatedCase\.engagementScope \?\? "full_operation"\)/, "editing the engagement scope must disable stale saves");
assert.ok(
  generator.match(/engagementScope !== \(generatedCase\.engagementScope \?\? "full_operation"\)/g)?.length === 1,
  "saveAndOpen must independently reject a stale engagement scope",
);
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
assert.match(dashboard, /const latestCases = loadSupplyCases\(storageScope\)\.cases/, "dashboard scope saves must reload the current browser state");
assert.match(dashboard, /latestCases\.find\(\(candidate\) => candidate\.id === item\.id\) \?\? item/, "dashboard scope saves must merge onto the latest same-customer record");
assert.match(dashboard, /\{ \.\.\.latestItem, engagementScope, updatedAt:/, "scope saves must patch only the latest same-customer record");
assert.match(dashboard, /upsertSupplyCase\(latestCases, updated\)/, "dashboard coverage changes must preserve concurrent customer saves");
assert.match(dashboard, /persistSupplyCases\(storageScope, nextCases, updated\.id\)/, "dashboard coverage changes must survive reload");
assert.match(dashboard, /const selectedScope = dashboard\.engagementScope \?\? "full_operation"/, "the persisted case must remain the scope source of truth");
assert.match(dashboard, /if \(!onScopeChange\(scope\)\)/, "a failed scope save must not change the visible plan");
assert.match(dashboard, /domestic-regulatory-review/, "domestic cases must not show an import broker handoff");
assert.match(dashboard, /customs-scope-confirmation/, "unknown lanes must ask for locations before assigning a broker");

assert.match(dashboard, /directDistance > 500/, "map routes must wrap across the date line");
assert.match(dashboard, /role="img" aria-labelledby="supply-map-svg-title"/, "the route must expose one labeled map image");
assert.match(dashboard, /aria-pressed=\{item\.id === activeCase\?\.id\}/, "customer buttons must expose the active dashboard");
assert.match(dashboard, /aria-pressed=\{flow\.id === selectedFlow\?\.id\}/, "network-flow buttons must expose the active flow");
assert.match(dashboard, /flow\.id === selectedFlow\?\.id/, "the map must emphasize only the selected supply-chain flow");
assert.match(engagementPlan, /kind:\s*"inbound"/, "the engagement model must distinguish components entering production");
assert.match(engagementPlan, /kind:\s*"outbound"/, "the engagement model must distinguish finished goods leaving production");

for (const rawDetail of [
  "connectorGrid",
  "EvidenceLinks",
  "provider.request",
  "leg.quoteInputs",
  "leg.handoff",
  "invoiceGuidance.map",
  "supplierOptions.map",
  "Needs your input",
  "inputList",
  "leg.providers[0]",
  "brokerOptions[0]",
  "Expected cost",
  "summary.openCheckCount",
]) {
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
assert.ok(engagementPlan.length > 1000, "the customer engagement model must remain deterministic and explicit");
assert.ok(operatingPlan.length > 1000, "the operating-plan engine must remain intact");

console.log("supply OS split-page checks passed");
