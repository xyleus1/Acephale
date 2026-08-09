import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};

assert.match(shell, /from "motion\/react"/);
assert.match(shell, /<MotionConfig reducedMotion="user"/);
assert.match(shell, /className=\{styles\.operatingSidebar\}/);
assert.match(shell, /aria-label="Supply OS navigation"/);
assert.match(shell, /shortLabel: "Network map"/);
assert.match(shell, /onClick=\{\(\) => selectPanel\("logistics"\)\}/);
assert.match(shell, /activePanel === "logistics"/);
assert.match(shell, /<SupplyOsDashboardWorkspace storageScope=\{storageScope\} presentationMode=\{false\} \/>/);
assert.ok(packageJson.dependencies?.motion, "Motion must be a production dependency");
assert.doesNotMatch(shell, />Deal Desk<|>Incoming RFQs<|>CRM<|>Outreach<|>Intel</);
assert.match(dashboard, /generateSupplyCase\(SAMPLE_SUPPLY_CASE_PROMPT, ILLUSTRATIVE_NETWORK_DATE/);
assert.match(dashboard, />Illustrative network</);
assert.doesNotMatch(dashboard, /href="\/dashboard\/supply-os\/new"/);

console.log("Supply OS sidebar and network-map contract passed.");
