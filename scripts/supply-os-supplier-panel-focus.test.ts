import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboard = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-dashboard.tsx"),
  "utf8",
);

assert.match(
  dashboard,
  /materials: \{[\s\S]*objectKinds: \["supplier", "factory", "distribution"\]/,
  "inventory and sourcing must include supplier candidates beside internal stock locations",
);
assert.match(
  dashboard,
  /fulfillment: \{[\s\S]*objectKinds: \["factory", "distribution", "customer", "movement"\]/,
  "fulfillment must connect allocation points to customer delivery movements",
);

console.log("Supply OS inventory, sourcing, and fulfillment contract passed.");
