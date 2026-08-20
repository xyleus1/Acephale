import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const preview = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-opportunities-preview.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-opportunities-preview.module.css"), "utf8");

assert.match(dashboard, /activePanel === "scenarios"[\s\S]*<SupplyOsOpportunitiesPreview/);
assert.doesNotMatch(dashboard, /OpportunityScenarioWorkbench|Run scenario/);
assert.match(preview, /<h2 id="opportunities-preview-title">Not active<\/h2>/);
assert.match(preview, /Verified baselines and alternatives are not available/);
assert.match(preview, /Impact estimates stay hidden until cost or transit evidence is verified/);

for (const title of ["Supplier change", "Route change", "Order change"]) {
  assert.match(preview, new RegExp(`title: "${title}"`), `missing ${title} preview`);
}

for (const measure of ["Cost impact", "Transit impact", "Margin impact"]) {
  assert.match(preview, new RegExp(`measure: "${measure}"`), `missing ${measure} preview`);
}

assert.match(preview, />Current</);
assert.match(preview, />Alternative</);
assert.doesNotMatch(preview, /%|\$\d|<button/, "the inactive preview must not invent impact values or actions");

for (const selector of [".preview", ".cardGrid", ".card", ".swapRow", ".impactRow", ".boundary"]) {
  assert.equal(styles.includes(selector), true, `opportunity preview is missing ${selector}`);
}

assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.cardGrid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
assert.equal(`${dashboard}\n${preview}\n${styles}`.includes("\u2014"), false, "opportunity preview must not contain em dashes");

console.log("Supply OS opportunity preview contract passed.");
