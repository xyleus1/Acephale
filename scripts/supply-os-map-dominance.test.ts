import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shellStyles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"),
  "utf8",
);
const logisticsStyles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"),
  "utf8",
);

assert.match(
  shellStyles,
  /\.panelStage\s*\{[\s\S]*?padding: 24px 28px 28px;/,
  "desktop workspace edges must not waste map area",
);
assert.match(
  logisticsStyles,
  /\.commandMapStage\s*\{[\s\S]*?gap: 12px;[\s\S]*?padding: 12px;/,
  "the map stage must use compact internal spacing",
);
assert.match(
  logisticsStyles,
  /@media \(min-width: 1281px\)[\s\S]*?grid-template-columns: minmax\(0, 3\.4fr\) minmax\(300px, 0\.68fr\);/,
  "wide layouts must make the map visibly dominant over the dossier",
);
assert.match(
  logisticsStyles,
  /@media \(min-width: 1281px\)[\s\S]*?grid-template-rows: minmax\(0, 4\.2fr\) minmax\(140px, 0\.7fr\);/,
  "wide layouts must keep the execution rail subordinate to the map",
);

console.log("Supply OS map dominance contract passed.");
