import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260821000100_minimal_customer_procurement_schema/migration.sql"),
  "utf8",
);
const context = readFileSync(resolve(root, "src/lib/company-context.ts"), "utf8");
const officeExport = readFileSync(resolve(root, "scripts/export-office-cherry-pick.ts"), "utf8");
const officeImport = readFileSync(resolve(root, "scripts/import-office-cherry-pick.ts"), "utf8");
const databaseWorkflow = readFileSync(resolve(root, ".github/workflows/procurement-workflow-tests.yml"), "utf8");
const legacyVerification = readFileSync(resolve(root, "scripts/sql/minimal-schema-legacy-verify.sql"), "utf8");

for (const model of [
  "Item",
  "Supplier",
  "CompanySupplier",
  "CompanyContext",
  "CompanyWorkflowAccount",
  "ProcurementOrder",
  "OrderSupplier",
  "ProcurementRequestKey",
]) {
  assert.match(schema, new RegExp(`model ${model}\\b`), `${model} must be part of the canonical schema`);
}
for (const retired of ["CompanyDocument", "MarginProfile", "CrmOpportunity"]) {
  assert.doesNotMatch(schema, new RegExp(`model ${retired}\\b`), `${retired} must stay retired`);
  assert.match(migration, new RegExp(`DROP TABLE IF EXISTS "${retired}"`));
}

const contextModel = schema.match(/model CompanyContext[\s\S]*?\n\}/)?.[0] ?? "";
const officeModel = schema.match(/model Office[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(officeModel, /pricingTargetMarginPct\s+Float\?/);
assert.match(contextModel, /itemId\s+String\?/);
assert.match(contextModel, /description\s+String\?/);
assert.match(contextModel, /storageUrl\s+String\?/);
assert.match(contextModel, /markdown\s+String\?/);
assert.match(contextModel, /payload\s+Json\?/);
assert.match(migration, /ALTER TABLE customers RENAME TO "CompanyWorkflowAccount"/);
assert.match(migration, /ALTER TABLE "CompanyWorkflowAccount" ADD COLUMN IF NOT EXISTS updated_at/);
assert.match(migration, /ALTER TABLE bill_of_materials RENAME TO "Item"/);
assert.match(migration, /ALTER TABLE orders RENAME TO "ProcurementOrder"/);
assert.match(migration, /ALTER TABLE order_vendors RENAME TO "OrderSupplier"/);
assert.match(migration, /CREATE VIEW customers/);
assert.match(migration, /CREATE VIEW bill_of_materials/);
assert.match(migration, /CREATE VIEW orders/);
assert.match(migration, /CREATE VIEW order_vendors/);
assert.match(migration, /Imported from the retired item preference field/);
assert.match(migration, /min\("marginPercent"\) AS target_margin/);
assert.match(migration, /ALTER TABLE "Item" DROP COLUMN procurement_preferences/);
assert.match(migration, /ELSE entry\.url/);
assert.match(migration, /'legacy_doc_type', entry\."docType"/);
assert.match(migration, /minimal_context_safe_jsonb_20260821/);
assert.match(migration, /processing\.metadata->>'summary'/);
assert.match(migration, /processing\.metadata->>'error'/);
assert.match(migration, /company_context_scope_guard/);
assert.match(migration, /company_supplier_scope_guard/);
assert.match(migration, /procurement_order_scope_guard/);
assert.match(migration, /procurement_request_key_scope_guard/);
assert.match(migration, /minimal_legacy_workflow_grants_20260821/);
assert.match(migration, /SELECT \* FROM "ProcurementOrder"/);
assert.match(migration, /'citations', citation_data\.citations/);
assert.match(migration, /legacy_order_supplier_insert/);
assert.match(databaseWorkflow, /Rehearse populated legacy migration/);
assert.match(databaseWorkflow, /Verify office export and repeat import/);
assert.match(databaseWorkflow, /office export\/import round trip is not scoped and idempotent/);
assert.match(legacyVerification, /Bourne role grants or reliability columns were not preserved/);
assert.match(legacyVerification, /cross-company order was accepted/);

assert.match(context, /prisma\.companyContext/);
assert.match(context, /prisma\.item\.findFirst/);
assert.doesNotMatch(context, /prisma\.companyDocument/);
assert.match(officeExport, /items: items\.map/);
assert.match(officeExport, /companySuppliers: companySuppliers\.map/);
assert.match(officeImport, /const itemMap: IdMap/);
assert.match(officeImport, /itemId,/);
assert.match(officeImport, /function importedContextId/);
assert.match(officeImport, /existingByImportId/);
assert.match(officeImport, /contentHash: hasLiveStorage \? existing\?\.contentHash : hasUnavailableStorage \? null/);
assert.match(officeImport, /payload: \{ \.\.\.jsonObject\(row\.payload\), importSource \}/);
assert.match(context, /storageUrl: \{ startsWith: "metadata-only:\/\/" \}/);
assert.match(context, /payload: \{ path: \["importSource", "contentHash"\], equals: contentHash \}/);

for (const source of [schema, migration, context]) {
  assert.equal(source.includes("\u2014"), false, "Minimal schema files must not contain the forbidden character");
}

console.log("Minimal live database schema contract passed.");
