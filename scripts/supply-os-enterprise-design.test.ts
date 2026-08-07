import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const generator = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-generator.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const source = `${dashboard}\n${generator}\n${styles}`;

for (const required of [
  ".customerBrowser",
  ".customerList",
  ".caseDashboard",
  ".engagementSection",
  ".scopeSelector",
  ".workstreamRail",
  ".planGrid",
  ".mapPanel",
  ".workstreamDetail",
  ".executionDetail",
  ".decisionGrid",
  ".summaryPanel",
  ".generatorMain",
  ".generatorCard",
  ".reviewPanel",
  "What Derya takes over",
  "Operating network",
  "Derya needs these 3 things",
  "This case is a scoping plan.",
]) {
  assert.equal(source.includes(required), true, `simplified customer dashboard is missing: ${required}`);
}

for (const forbidden of [
  "radial-gradient",
  "linear-gradient",
  "drop-shadow(",
  "transition: all",
  "!important",
  "\u2014",
  "summaryStrip",
  "conditionGrid",
  "connectorGrid",
  "executionTable",
  "riskGrid",
  "customsList",
  "Supplier search briefs",
  "Official integration paths",
  "Modeled USD range",
  "Expected cost",
  "Broker to qualify",
  "Recommended plan",
  "Door-to-door plan",
  "Current finding",
  "Freshness target",
  "Needs your input",
  ".inputList",
]) {
  assert.equal(source.includes(forbidden), false, `simplified dashboard must not contain: ${forbidden}`);
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

assert.ok(colorTokens.size <= 20, `Supply OS palette drifted to ${colorTokens.size} explicit colors`);
for (const token of colorTokens) {
  if (token.startsWith("#")) {
    assert.equal(approvedHexColors.has(token.toLowerCase()), true, `Supply OS contains an unapproved color: ${token}`);
  } else {
    assert.fail(`Supply OS should not need an explicit RGB color: ${token}`);
  }
}

assert.equal(/box-shadow:\s*0\s+0/.test(styles), false, "Supply OS must not use decorative outer glows");
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
assert.equal(
  globals.includes('[role="button"]:not(:where(.supply-os-workspace [role="button"])):focus-visible'),
  true,
  "global role-button focus styling must continue excluding Supply OS",
);

const topBarStyles = styles.slice(styles.indexOf(".topBar {"), styles.indexOf(".brandBlock {"));
assert.equal(topBarStyles.includes("position: sticky"), false, "Supply OS must not place a second sticky bar behind the app header");

const tabletStyles = styles.slice(styles.indexOf("@media (max-width: 1040px)"), styles.indexOf("@media (max-width: 760px)"));
for (const rule of [".main", "padding: 20px", ".workstreamRail", "grid-template-columns"]) {
  assert.equal(tabletStyles.includes(rule), true, `tablet layout is missing: ${rule}`);
}

const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 560px)"), styles.indexOf("@media (prefers-reduced-motion"));
for (const rule of [".topBar", ".customerButton", ".composerFooter", "flex-direction: column"]) {
  assert.equal(mobileStyles.includes(rule), true, `mobile layout is missing: ${rule}`);
}

assert.equal(styles.includes("overflow-x: auto"), true, "lane selectors must scroll locally on narrow screens");

console.log("simplified Supply OS design checks passed");
