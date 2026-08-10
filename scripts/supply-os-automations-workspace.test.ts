import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSupplyOsPanel, supplyOsPanelHref } from "../src/lib/supply-os/panel-routing";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const automations = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-automations.tsx"), "utf8");
const automationStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-automations.module.css"), "utf8");
const commandMap = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"), "utf8");
const productTwin = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-product-twin.tsx"), "utf8");

assert.equal(normalizeSupplyOsPanel("automations"), "automations");
assert.equal(
  supplyOsPanelHref("https://derya.test/dashboard/supply-os?present=0", "automations"),
  "/dashboard/supply-os?present=0&panel=automations",
);
assert.match(shell, /id: "automations", shortLabel: "Automations"/);
assert.match(shell, /data-panel-id=\{panel\.id\}/);
assert.match(shell, /nav\.scrollTo\(\{ left: buttonEnd - nav\.clientWidth \}\)/);
assert.match(dashboard, /activePanel === "automations"[\s\S]*<SupplyOsAutomations/);

for (const label of [
  "Complete bill of lading",
  "Find suppliers",
  "Request freight rates",
  "Check customs documents",
  "Watch transport exceptions",
]) {
  assert.equal(automations.includes(label), true, `automation workspace is missing ${label}`);
}

assert.match(automations, /fetch\("\/api\/supply-os\/automations\/chat"/);
assert.match(automations, /aria-label="Automation instruction"/);
assert.match(automations, /aria-label="Automation drafts"/);
assert.match(automations, /<i>Draft<\/i>/);
assert.equal(automations.includes("Automation chat"), false);
assert.equal(automations.includes("Browser draft."), false);
assert.equal(automations.includes("What should this workflow do?"), false);
assert.equal(automations.includes("Nothing has been activated or sent"), false);
assert.equal(automations.includes("New draft"), false);
assert.equal(automations.includes("function draftName"), false);
assert.equal(automations.includes("function draftSteps"), false);
assert.match(automationStyles, /grid-template-columns: minmax\(0, 1\.65fr\) minmax\(340px, 0\.9fr\)/);
assert.match(automationStyles, /@media \(max-width: 720px\)[\s\S]*\.workspace \{[\s\S]*display: block/);

for (const source of [dashboard, commandMap, productTwin]) {
  assert.equal(source.includes("Boxes"), false, "Supply OS must not reuse the generic Boxes icon");
}

assert.equal(`${shell}\n${dashboard}\n${automations}\n${automationStyles}`.includes("\u2014"), false);

console.log("Supply OS automations workspace contract passed.");
