import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"),
  "utf8",
);
const shellStyles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"),
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
assert.match(shell, /aria-label="Workspace navigation"/);
assert.match(shell, /id: "logistics", shortLabel: "Logistics"/);
assert.match(shell, /id: "scenarios", shortLabel: "Opportunities"/);
assert.match(shell, /onClick=\{\(\) => selectPanel\(panel\.id\)\}/);
assert.match(shell, /activePanel=\{activePanel\}/);
assert.doesNotMatch(shell, /key=\{activePanel\}/);
assert.ok(packageJson.dependencies?.motion, "Motion must be a production dependency");
assert.doesNotMatch(shell, />Deal Desk<|>Incoming RFQs<|>CRM<|>Outreach<|>Intel</);
assert.doesNotMatch(shell, /Network online|Open the live map|Suppliers to factory to delivery/);
assert.doesNotMatch(shell, /Supply OS/, "the dashboard must not repeat the product name");
assert.doesNotMatch(shell, /navIcon|panel\.icon|LucideIcon|ActivePanelIcon/, "the workspace rail must stay text-only");
assert.doesNotMatch(shellStyles, /\.navIcon|\.sidebarHeading|\.sidebarMark/, "removed icon and product-heading styles must stay deleted");
assert.match(shellStyles, /@media \(max-width: 1020px\)[\s\S]*grid-template-columns: 190px minmax\(0, 1fr\)/, "medium layouts must keep readable section labels");
assert.doesNotMatch(shellStyles, /\.navCopy,[\s\S]*display: none/, "responsive layouts must not hide section labels");
assert.match(shellStyles, /@media \(max-width: 720px\)[\s\S]*grid-template-columns: repeat\(5, minmax\(48px, 1fr\)\)/, "mobile must retain five text navigation targets");
assert.match(dashboard, /generateSupplyCase\(SAMPLE_SUPPLY_CASE_PROMPT, ILLUSTRATIVE_NETWORK_DATE/);
assert.match(dashboard, />Demo</);
assert.doesNotMatch(dashboard, /href="\/dashboard\/supply-os\/new"/);

console.log("Supply OS sidebar and network-map contract passed.");
