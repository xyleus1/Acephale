import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/app/dashboard/supply-os/page.tsx",
  "src/app/dashboard/supply-os/supply-os-operating-shell.tsx",
  "src/lib/supply-os/legacy-route-map.ts",
  "public/supply-os/demo/vector3dhd-amr.jpg",
];

for (const file of requiredFiles) {
  assert.equal(existsSync(join(root, file)), true, `Production Supply OS boundary is missing: ${file}`);
}

const page = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");

assert.match(page, /SupplyOsOperatingShell/, "Supply OS route must render the operating shell");
assert.match(middleware, /\/dashboard\/supply-os/, "Dashboard routing must retain the Supply OS destination");

console.log("Supply OS deployment boundary passed.");
