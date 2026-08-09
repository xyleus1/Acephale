import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSupplyOsPanel, supplyOsPanelHref } from "../src/lib/supply-os/panel-routing";

assert.equal(normalizeSupplyOsPanel(undefined), "materials");
assert.equal(normalizeSupplyOsPanel("garbage"), "materials");
assert.equal(normalizeSupplyOsPanel("suppliers"), "suppliers");
assert.equal(normalizeSupplyOsPanel("tracking"), "tracking");

assert.equal(
  supplyOsPanelHref("https://derya.test/dashboard/supply-os?present=0", "scenarios"),
  "/dashboard/supply-os?present=0&panel=scenarios",
  "panel navigation should preserve unrelated query state",
);
assert.equal(
  supplyOsPanelHref("https://derya.test/dashboard/supply-os?panel=tracking#cost", "materials"),
  "/dashboard/supply-os#cost",
  "the default Materials panel should use the canonical URL without a redundant query",
);

const shell = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"),
  "utf8",
);
assert.match(shell, /window\.history\.pushState/);
assert.match(shell, /window\.addEventListener\("popstate", syncPanelFromUrl\)/);
assert.match(shell, /window\.removeEventListener\("popstate", syncPanelFromUrl\)/);

console.log("Supply OS shell routing contract passed.");
