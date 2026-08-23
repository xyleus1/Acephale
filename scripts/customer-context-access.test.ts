import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  customerContextCanEditRole,
  selectCustomerContextMembership,
} from "../src/lib/customer-context-access";
import { projectCompanyContextProcurementActionForCustomer } from "../src/lib/supply-os/context-procurement";

const memberships = [
  { id: "membership-a", companyId: "company-a", role: "MEMBER" },
  { id: "membership-b", companyId: "company-b", role: "VIEWER" },
];

assert.deepStrictEqual(selectCustomerContextMembership(memberships, "company-a"), memberships[0]);
assert.deepStrictEqual(selectCustomerContextMembership(memberships, "company-b"), memberships[1]);
assert.strictEqual(selectCustomerContextMembership(memberships, "company-c"), null);
assert.strictEqual(customerContextCanEditRole("ADMIN"), true);
assert.strictEqual(customerContextCanEditRole("MEMBER"), true);
assert.strictEqual(customerContextCanEditRole("VIEWER"), false);
assert.strictEqual(customerContextCanEditRole("OWNER"), false);

const customerAction = projectCompanyContextProcurementActionForCustomer({
  id: "action-1",
  schemaVersion: 1,
  status: "CREATED",
  draft: {
    material: "Valve",
    specification: null,
    manufacturer: null,
    partNumber: null,
    quantity: 4,
    unit: "units",
    neededBy: null,
    deliveryLocation: null,
    notes: null,
  },
  citations: [],
  requestMessageId: "message-internal",
  requestBody: "Start procurement",
  requestCreatedAt: "2026-08-22T00:00:00.000Z",
  confirmationStartedAt: "2026-08-22T00:00:01.000Z",
  order: { id: "order-internal", status: "new", workflowWakeRequested: true },
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
});
assert.deepStrictEqual(customerAction.order, { status: "new" });
assert.equal("requestMessageId" in customerAction, false);
assert.equal(JSON.stringify(customerAction).includes("order-internal"), false);

const root = process.cwd();
const files = {
  schema: readFileSync(resolve(root, "prisma/schema.prisma"), "utf8"),
  migration: readFileSync(
    resolve(root, "prisma/migrations/20260822000300_customer_portal_context_access/migration.sql"),
    "utf8",
  ),
  access: readFileSync(resolve(root, "src/lib/customer-context-access.ts"), "utf8"),
  context: readFileSync(resolve(root, "src/lib/company-context.ts"), "utf8"),
  procurement: readFileSync(resolve(root, "src/lib/supply-os/context-procurement.ts"), "utf8"),
  page: readFileSync(resolve(root, "src/app/portal/procurement/page.tsx"), "utf8"),
  getRoute: readFileSync(
    resolve(root, "src/app/api/portal/procurement/[workspaceId]/context/route.ts"),
    "utf8",
  ),
  chatRoute: readFileSync(
    resolve(root, "src/app/api/portal/procurement/[workspaceId]/context/chat/route.ts"),
    "utf8",
  ),
  documentRoute: readFileSync(
    resolve(root, "src/app/api/portal/procurement/[workspaceId]/context/documents/route.ts"),
    "utf8",
  ),
  actionRoute: readFileSync(
    resolve(root, "src/app/api/portal/procurement/[workspaceId]/context/procurement/[actionId]/route.ts"),
    "utf8",
  ),
  migrationWorkflow: readFileSync(resolve(root, ".github/workflows/procurement-workflow-tests.yml"), "utf8"),
};

const companyContextModel = files.schema.match(/model CompanyContext[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(companyContextModel, /createdByPortalUserId\s+String\?/);
assert.match(companyContextModel, /customerVisible\s+Boolean\s+@default\(false\)/);
assert.match(companyContextModel, /CompanyContextCreatedByPortalUser/);
assert.match(files.migration, /FOREIGN KEY \("createdByPortalUserId"\)/);
assert.match(files.migration, /"customerVisible" BOOLEAN NOT NULL DEFAULT false/);
assert.match(files.migration, /CREATE OR REPLACE FUNCTION company_context_scope_guard\(\)/);
assert.match(files.migration, /CustomerPortalUser/);
assert.match(files.migration, /CompanyContext portal creator is outside the office scope/);
assert.match(files.migrationWorkflow, /20260822000300_customer_portal_context_access/);
assert.match(files.migrationWorkflow, /--file=prisma\/migrations\/20260822000300_customer_portal_context_access\/migration\.sql/);

assert.match(files.access, /officeId: access\.officeId/);
assert.match(files.access, /userId: access\.portalUserId/);
assert.match(files.access, /companyId: access\.companyId/);
assert.match(files.access, /isActive: true/);
assert.match(files.access, /company: \{ officeId: access\.officeId \}/);
assert.match(files.access, /mode === "edit" && !customerContextCanEditRole/);
assert.match(files.context, /companyContextVisibilityWhere\(context\)/);
assert.match(files.context, /companyContextActorData\(args\.context\)/);
assert.match(files.context, /createdByPortalUserId/);
assert.match(files.procurement, /companyContextVisibilityWhere\(args\.context\)/);
assert.match(files.procurement, /procurementCustomerIdFromServerMetadata\(args\.context\.officeId\)/);

for (const route of [files.getRoute, files.chatRoute, files.documentRoute, files.actionRoute]) {
  assert.match(route, /getCustomerPortalPrincipal/);
  assert.match(route, /resolveCustomerContextAccessForWorkspace/);
  assert.doesNotMatch(route, /getSession\(|requireSession\(/);
}
assert.match(files.context, /appendRateLimitedCustomerContextMessage/);
assert.match(files.context, /pg_advisory_xact_lock/);
assert.match(files.context, /CUSTOMER_CONTEXT_UPLOADS_PER_DAY = 40/);
assert.match(files.context, /CUSTOMER_CONTEXT_STORAGE_MAX_BYTES = 50 \* 1024 \* 1024/);
assert.match(files.chatRoute, /projectCompanyContextProcurementActionForCustomer/);
assert.match(files.getRoute, /projectCompanyContextProcurementActionForCustomer/);
assert.match(files.actionRoute, /projectCompanyContextProcurementActionForCustomer/);
assert.match(files.documentRoute, /reserveCustomerContextUploadRequest/);

assert.match(files.page, /requireCustomerPortalPrincipal/);
assert.match(files.page, /resolveCustomerContextWorkspace/);
assert.doesNotMatch(files.page, /requireCustomerPortalPreviewPrincipal/);

for (const source of Object.values(files)) {
  assert.equal(source.includes("\u2014"), false, "customer Context files must not contain the forbidden character");
}

console.log("Customer Context access contract passed.");
