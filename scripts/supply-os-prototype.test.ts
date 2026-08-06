import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/supply-os/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const prototype = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-workspace.module.css"), "utf8");
const dashboardLayout = readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8");
const source = page + "\n" + dashboardPage + "\n" + prototype + "\n" + styles;

for (const forbidden of ["prisma", "use server", "fetch(", "#063a2d", "#0d3b2e"]) {
  assert.equal(source.includes(forbidden), false, "Supply OS prototype must not contain " + forbidden);
}

for (const required of [
  "Overview",
  "Supply map",
  "Suppliers",
  "Quote room",
  "Execution",
  "Control",
  "Prototype data only",
  "No messages, bookings, filings, posts, or external writes occur",
  "WORLD_MAP_LAND_PATHS",
  "Natural Earth 1:110m geography",
  "Modeled network, not live tracking",
  "approvedQuoteId",
]) {
  assert.equal(source.includes(required), true, "prototype is missing: " + required);
}

assert.equal(source.includes("\u2014"), false, "prototype must not contain an em dash");
assert.equal(styles.includes("!important"), false, "Supply OS must not add another global specificity workaround");
assert.equal(page.includes('redirect("/dashboard/supply-os"'), true, "legacy Supply OS URL must redirect into the app");
assert.equal(styles.includes(".mapFigure svg"), true, "map SVG must be styled inside the Supply OS module");
assert.equal(styles.includes("@media (max-width: 720px)"), true, "prototype needs a mobile layout");
assert.equal(
  dashboardLayout.includes('<NavLink href="/dashboard/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>'),
  true,
  "dashboard sidebar must link to the authenticated Supply OS workspace",
);

console.log("supply OS prototype checks passed");
