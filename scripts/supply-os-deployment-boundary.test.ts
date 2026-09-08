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
const rfqMail = readFileSync(join(root, "src/lib/rfq-mail.ts"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
const prismaSchema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const appRoleSql = readFileSync(join(root, "scripts/sql/derya-app-role.sql"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const migration = readFileSync(
  join(root, "prisma/migrations/20260812000100_supply_intelligence_profiles/migration.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  buildCommand?: string;
  crons?: Array<{ path?: string; schedule?: string }>;
};

assert.match(page, /SupplyOsOperatingShell/, "Supply OS route must render the operating shell");
assert.match(middleware, /\/dashboard\/supply-os/, "Dashboard routing must retain the Supply OS destination");
assert.match(rfqMail, /https:\/\/app\.derya\.ai\/dashboard\/rfq\//, "RFQ links must use the product domain");
assert.doesNotMatch(rfqMail, /https:\/\/www\.derya\.ai\/dashboard\//, "Product links must not use the landing-page domain");
assert.match(envExample, /^NEXT_PUBLIC_APP_URL=/m, "The canonical application origin must be documented");
assert.equal(vercel.buildCommand, undefined, "routine application builds must not run database migrations");
assert.equal(
  vercel.crons?.some((cron) => cron.path === "/api/cron/pentest-demo"),
  false,
  "production must not recreate the retired pentest tenant",
);
assert.equal(
  packageJson.scripts?.build,
  "prisma generate && prisma generate --schema prisma/world/schema.prisma && next build",
  "the application build must not require migration-ledger privileges",
);
assert.equal(
  packageJson.scripts?.["deploy:migrations"],
  "prisma migrate deploy && prisma migrate status",
  "owner-driven migration deployment must remain an explicit command",
);
const prismaModels = [...prismaSchema.matchAll(/^model\s+(\w+)\s*\{/gm)]
  .map((match) => match[1])
  .sort();
const workerOwnedModels = new Set([
  "CompanyWorkflowAccount",
  "ProcurementOrder",
  "OrderSupplier",
  "ProcurementRequestKey",
]);
const applicationModels = prismaModels.filter((model) => !workerOwnedModels.has(model));
const appTableBlock = appRoleSql.match(/app_tables text\[\] := ARRAY\[([\s\S]*?)\n  \];/);
assert.ok(appTableBlock, "the application role must keep an explicit table allowlist");
const appRoleTables = [...appTableBlock[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(
  appRoleTables,
  applicationModels,
  "the derya_app allowlist must cover every application-owned Prisma model and nothing else",
);
for (const model of workerOwnedModels) {
  assert.match(
    appRoleSql,
    new RegExp(`'${model}'`),
    `${model} must remain on the explicit derya_app denylist`,
  );
}
assert.match(
  appRoleSql,
  /'procurement_communication_messages'/,
  "the application role must explicitly reject access to the Bourne communication ledger",
);
assert.deepEqual(
  vercel.crons?.find((cron) => cron.path === "/api/cron/supply-os-connectors"),
  { path: "/api/cron/supply-os-connectors", schedule: "10 * * * *" },
  "the schema rollout must preserve the Supply OS connector cron",
);
assert.deepEqual(
  vercel.crons?.find((cron) => cron.path === "/api/cron/procurement-workflow"),
  { path: "/api/cron/procurement-workflow", schedule: "*/5 * * * *" },
  "the production deployment must reconcile durable procurement wake requests",
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
