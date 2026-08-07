import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspace = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const caseModel = readFileSync(join(root, "src/lib/supply-os-case-model.ts"), "utf8");
const operatingPlan = readFileSync(join(root, "src/lib/supply-os-operating-plan.ts"), "utf8");
const source = `${workspace}\n${styles}\n${caseModel}\n${operatingPlan}`;

for (const required of [
  ".caseBuilder",
  ".savedSection",
  ".caseDashboard",
  ".summaryStrip",
  ".movementPanel",
  ".movementSelector",
  ".conditionGrid",
  ".portRankList",
  ".customsPlanGrid",
  ".workflowList",
  ".connectorGrid",
  ".executionTable",
  ".executionSummary",
  ".blockerGrid",
  ".primaryGrid",
  ".mapPanel",
  ".routeBrief",
  ".dataSection",
  ".tableWrap",
  ".riskGrid",
  ".customsList",
  "Demo data",
  "Door-to-door execution",
  "Amounts are deterministic demo fixtures.",
  "Supplier profiles, rates, transit times, risks, and customs checks are indicative.",
]) {
  assert.equal(source.includes(required), true, `enterprise case dashboard is missing: ${required}`);
}

for (const forbidden of [
  "radial-gradient",
  "linear-gradient",
  "drop-shadow(",
  "transition: all",
  "!important",
  "\u2014",
  "VIEWS",
  "setView(",
  "Generate briefing",
  "Add watch",
]) {
  assert.equal(source.includes(forbidden), false, `enterprise case dashboard must not contain: ${forbidden}`);
}

const colorTokens = new Set([
  ...(styles.match(/#[0-9a-fA-F]{6}/g) ?? []),
  ...(styles.match(/rgba?\([^)]*\)/g) ?? []),
]);
const approvedHexColors = new Set([
  "#0f1316",
  "#111518",
  "#14191d",
  "#191f23",
  "#222a2f",
  "#242b2f",
  "#2b343a",
  "#3c474e",
  "#7b858c",
  "#789487",
  "#92a7b2",
  "#a7afb4",
  "#bd9255",
  "#cf6e74",
  "#e8ebed",
]);

assert.ok(colorTokens.size <= 24, `enterprise Supply OS palette drifted to ${colorTokens.size} explicit colors`);
for (const token of colorTokens) {
  if (token.startsWith("#")) {
    assert.equal(approvedHexColors.has(token.toLowerCase()), true, `Supply OS contains an unapproved color: ${token}`);
  } else {
    assert.fail(`Supply OS should not need an explicit RGB color: ${token}`);
  }
}

assert.equal(/box-shadow:\s*0\s+0/.test(styles), false, "Supply OS must not use decorative outer glows");
assert.equal(workspace.includes("supply-os-workspace"), true, "Supply OS needs a stable root for global style isolation");
for (const control of ["button", "textarea"]) {
  assert.equal(
    globals.includes(`${control}:not(:where(.supply-os-workspace ${control}))`),
    true,
    `legacy global ${control} rules must exclude Supply OS`,
  );
}
assert.equal(globals.includes(":not(.supply-os-workspace"), false, "Supply OS exclusions must not raise global specificity");
assert.equal(
  globals.includes('[role="button"]:not(:where(.supply-os-workspace [role="button"])):focus-visible'),
  true,
  "global role-button focus styling must continue excluding Supply OS",
);
const topBarStyles = styles.slice(styles.indexOf(".topBar {"), styles.indexOf(".brandBlock {"));
assert.equal(topBarStyles.includes("position: sticky"), false, "Supply OS must not place a second sticky bar behind the app header");

const tabletStyles = styles.slice(styles.indexOf("@media (max-width: 1040px)"), styles.indexOf("@media (max-width: 760px)"));
for (const rule of [".primaryGrid", "grid-template-columns: 1fr", ".routeBrief", ".summaryStrip"]) {
  assert.equal(tabletStyles.includes(rule), true, `tablet case layout is missing: ${rule}`);
}

const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 560px)"), styles.indexOf("@media (prefers-reduced-motion"));
for (const rule of [".composerFooter", "flex-direction: column", ".savedGrid", "grid-auto-flow: column", ".tableWrap"]) {
  if (rule === ".tableWrap") {
    assert.equal(styles.includes(".tableWrap") && styles.includes("overflow-x: auto"), true, "wide data tables need local scrolling");
  } else {
    assert.equal(mobileStyles.includes(rule), true, `mobile case layout is missing: ${rule}`);
  }
}

console.log("enterprise Supply OS case-dashboard design checks passed");
