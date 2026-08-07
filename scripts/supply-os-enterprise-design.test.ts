import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const generator = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-generator.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const workstreamShell = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workstream-shell.tsx"), "utf8");
const workstreamStyles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workstream.module.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const source = `${dashboard}\n${generator}\n${styles}\n${workstreamShell}\n${workstreamStyles}`;

for (const required of [
  ".customerBrowser",
  ".caseDashboard",
  ".scopeBar",
  ".operatingBrief",
  ".networkWorkspace",
  ".networkStageList",
  ".networkInspector",
  ".qualificationTargets",
  ".optimizationList",
  ".optimizationRow",
  ".workspaceLink",
  ".kickoffStrip",
  ".evidenceGrid",
  ".generatorMain",
  ".researchMethod",
  "Operating network",
  "Where Derya can improve the operation",
  "Current condition",
  "Recommended change",
  "Decision to make",
  "Input required",
  "Open {workspace.shortLabel} workspace",
  "Routes are operating hypotheses.",
  "Inferred candidates, not known relationships.",
  "Execution workspace reserved",
]) {
  assert.equal(source.includes(required), true, `Supply OS action surface is missing: ${required}`);
}

for (const forbidden of [
  "radial-gradient",
  "linear-gradient",
  "drop-shadow(",
  "transition: all",
  "!important",
  "\u2014",
  ".companyLogo",
  "text-decoration: underline",
  "box-shadow: inset",
  "Supply Command",
  "Modeled workspace",
  "Decision support only",
  "Official integration paths",
  "Modeled USD range",
  "Expected cost",
]) {
  assert.equal(source.includes(forbidden), false, `Supply OS must not contain: ${forbidden}`);
}

const paletteSource = `${styles}\n${workstreamStyles}`;
const colorTokens = new Set([
  ...(paletteSource.match(/#[0-9a-fA-F]{6}/g) ?? []),
  ...(paletteSource.match(/rgba?\([^)]*\)/g) ?? []),
]);
const approvedHexColors = new Set([
  "#172027",
  "#29485c",
  "#3f4c55",
  "#416557",
  "#6d7880",
  "#825f2f",
  "#8a4545",
  "#aeb7bd",
  "#bac3c8",
  "#d5dadd",
  "#d6dcdf",
  "#dce7ed",
  "#dfe4e6",
  "#edf2f5",
  "#eef1f2",
  "#f2f4f5",
  "#f7f8f8",
  "#ffffff",
]);

assert.ok(colorTokens.size <= 18, `Supply OS palette drifted to ${colorTokens.size} explicit colors`);
for (const token of colorTokens) {
  if (token.startsWith("#")) {
    assert.equal(approvedHexColors.has(token.toLowerCase()), true, `Supply OS contains an unapproved color: ${token}`);
  } else {
    assert.fail(`Supply OS should not need an explicit RGB color: ${token}`);
  }
}

assert.equal(/box-shadow:\s*0\s+0/.test(paletteSource), false, "Supply OS must not use decorative outer glows");
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

const topBarStyles = styles.slice(styles.indexOf(".topBar {"), styles.indexOf(".topBarActions {"));
assert.equal(topBarStyles.includes("position: sticky"), false, "Supply OS must not place a second sticky bar behind the app header");

const desktopNetwork = styles.slice(styles.indexOf(".networkWorkspace {"), styles.indexOf(".networkStageList {"));
for (const rule of ["grid-template-columns: 230px minmax(420px, 1fr) 300px", "min-height: 520px"]) {
  assert.equal(desktopNetwork.includes(rule), true, `desktop network workspace is missing: ${rule}`);
}

const tabletStyles = styles.slice(styles.indexOf("@media (max-width: 980px)"), styles.indexOf("@media (max-width: 680px)"));
for (const rule of [".networkWorkspace", ".networkStageList", "overflow-x: auto", ".optimizationRow summary"]) {
  assert.equal(tabletStyles.includes(rule), true, `tablet layout is missing: ${rule}`);
}

const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 680px)"), styles.indexOf("@media (prefers-reduced-motion"));
for (const rule of [".topBar", ".customerButton", ".composerFooter", "flex-direction: column-reverse"]) {
  assert.equal(mobileStyles.includes(rule), true, `mobile layout is missing: ${rule}`);
}

assert.equal(styles.includes("overflow-x: auto"), true, "network stages must scroll locally on narrow screens");

console.log("Supply OS enterprise design checks passed");
