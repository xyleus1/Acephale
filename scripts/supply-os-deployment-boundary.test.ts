import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/app/dashboard/supply-os/page.tsx",
  "src/app/dashboard/supply-os/supply-os-operating-shell.tsx",
  "src/lib/supply-os/legacy-route-map.ts",
  "public/supply-os/demo/vector3dhd-amr.jpg",
  "prisma/migrations/20260812000100_supply_intelligence_profiles/migration.sql",
];

for (const file of requiredFiles) {
  assert.equal(existsSync(join(root, file)), true, `Production Supply OS boundary is missing: ${file}`);
}

const page = readFileSync(join(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
const migration = readFileSync(
  join(root, "prisma/migrations/20260812000100_supply_intelligence_profiles/migration.sql"),
  "utf8",
);
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  buildCommand?: string;
  crons?: Array<{ path?: string; schedule?: string }>;
};

assert.match(page, /SupplyOsOperatingShell/, "Supply OS route must render the operating shell");
assert.match(middleware, /\/dashboard\/supply-os/, "Dashboard routing must retain the Supply OS destination");
assert.equal(vercel.buildCommand, undefined, "routine application builds must not run database migrations");
assert.deepEqual(
  vercel.crons?.find((cron) => cron.path === "/api/cron/supply-os-connectors"),
  { path: "/api/cron/supply-os-connectors", schedule: "10 * * * *" },
  "the schema rollout must preserve the Supply OS connector cron",
);
assert.match(
  migration,
  /^BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';/,
  "the additive schema migration must set bounded production locks inside a transaction",
);
assert.match(migration, /CREATE TABLE "SupplySupplierProfile"/);
assert.match(migration, /CREATE TABLE "SupplyProfileFact"/);
assert.match(migration, /CREATE TABLE "SupplyBenchmarkSeries"/);
assert.match(migration, /CREATE TABLE "SupplyPriceObservation"/);
assert.match(
  migration,
  /CREATE TRIGGER "SupplyProfileFact_append_only_guard"[\s\S]*CREATE TRIGGER "SupplyPriceObservation_append_only_guard"[\s\S]*COMMIT;\s*$/,
  "profile facts and price observations must be append-only before the migration commits",
);
console.log("Supply OS deployment boundary passed.");
