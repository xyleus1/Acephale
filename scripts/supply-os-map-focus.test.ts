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

assert.match(styles, /@media \(min-width: 1281px\)[\s\S]*grid-template-columns: minmax\(0, 3\.4fr\) minmax\(300px, 0\.68fr\)/, "wide layouts must give the map a larger share of the workspace");
assert.match(styles, /grid-template-rows: minmax\(0, 4\.2fr\) minmax\(140px, 0\.7fr\)/, "wide layouts must keep the map taller than the context rail");
assert.match(commandMap, /\.slice\(0, 4\)/, "supplier focus must stay limited to four locations");
assert.match(commandMap, /data-supplier-focus=\{supplierFocusRank \? "true" : undefined\}/, "focused supplier markers must expose a visual state");
assert.match(commandMap, /Supplier focus \$\{supplierFocusRank\}/, "focused supplier markers must remain identifiable to assistive technology");
assert.match(commandMap, /activePanel === "suppliers"[\s\S]*supplierFocusObjects\.filter\(\(object\) => object\.kind === "supplier"\)/, "supplier framing must focus the ranked supplier shortlist");
assert.equal(commandMap.includes("right: 410"), false, "map fitting must not reserve space for retired floating panels");
assert.equal(commandMap.includes("left: 300"), false, "map fitting must use the full bounded viewport");
assert.match(commandMap, /object\.kind === "supplier"[\s\S]*?\? 6\.2/, "selecting a supplier must zoom into its operating region");

console.log("Supply OS map focus contract passed.");
