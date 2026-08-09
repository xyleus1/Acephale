import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const commandMap = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-command-map.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"),
  "utf8",
);

assert.match(styles, /@media \(min-width: 1281px\)[\s\S]*grid-template-columns: minmax\(0, 2\.15fr\) minmax\(340px, 0\.78fr\)/, "wide layouts must give the map a larger share of the workspace");
assert.match(styles, /grid-template-rows: minmax\(0, 3\.1fr\) minmax\(168px, 0\.9fr\)/, "wide layouts must keep the map taller than the context rail");
assert.match(commandMap, /\.slice\(0, 4\)/, "supplier focus must stay limited to four locations");
assert.match(commandMap, /data-supplier-focus=\{supplierFocusRank \? "true" : undefined\}/, "focused supplier markers must expose a visual state");
assert.match(commandMap, /Supplier focus \$\{supplierFocusRank\}/, "focused supplier markers must remain identifiable to assistive technology");
assert.match(commandMap, /visibleMapObjects\.filter\(\(object\) => object\.kind === "factory"\)\.slice\(0, 1\)/, "supplier framing must retain the receiving factory as context");
assert.equal(commandMap.includes("right: 410"), false, "map fitting must not reserve space for retired floating panels");
assert.equal(commandMap.includes("left: 300"), false, "map fitting must use the full bounded viewport");
assert.match(commandMap, /selectedObject\.kind === "supplier" \? 5\.2 : 4\.8/, "selecting a supplier must zoom into its operating region");

console.log("Supply OS map focus contract passed.");
