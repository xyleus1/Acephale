import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");

assert.match(dashboard, /activePanel === "scenarios"[\s\S]*<OpportunityScenarioWorkbench/);
assert.match(dashboard, /Supply, logistics, production, and network scenarios/);

for (const scenario of ["Supply", "Logistics", "Production", "Network"]) {
  assert.match(dashboard, new RegExp(`label: "${scenario}"`), `missing ${scenario} scenario play`);
}

for (const field of [
  "Current condition",
  "Change to test",
  "Inputs required",
  "Scenario output",
  "Measure",
  "Decision",
  "Evidence state",
  "Approval",
]) {
  assert.equal(dashboard.includes(field), true, `scenario workspace is missing ${field}`);
}

assert.match(dashboard, /onClick=\{\(\) => \{[\s\S]*setPlayedPlayId\(selectedPlay\.id\)/);
assert.match(dashboard, /Human decision required before any external action/);
assert.match(dashboard, /No supplier, booking, filing, or spend action is approved/);
assert.match(dashboard, /function productionCopy[\s\S]*replace\(\/\\bassembly\\b\/gi, "production"\)/);

for (const selector of [
  ".scenarioWorkbench",
  ".scenarioPlayList",
  ".scenarioDraft",
  ".scenarioRunButton",
  ".scenarioOutput",
  ".scenarioComparison",
  ".scenarioOutcomeGrid",
  ".scenarioBoundary",
]) {
  assert.equal(styles.includes(selector), true, `scenario workspace is missing ${selector}`);
}

assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.scenarioWorkbenchBody \{[\s\S]*display: block/);
assert.equal(`${dashboard}\n${styles}`.includes("\u2014"), false, "scenario workspace must not contain em dashes");

console.log("Supply OS opportunity scenario contract passed.");
