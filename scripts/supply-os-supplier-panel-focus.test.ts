import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboard = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);

assert.match(
  dashboard,
  /if \(activePanel === "suppliers"\) \{[\s\S]*object\.kind === "supplier"[\s\S]*setSelectedObjectId\(supplier\.id\)/,
  "opening the Suppliers panel must select supplier context instead of leaving the factory selected",
);

console.log("Supply OS supplier panel focus contract passed.");
