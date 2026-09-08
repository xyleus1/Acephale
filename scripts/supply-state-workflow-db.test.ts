import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  getProcurementRequestFromDatabase,
  getProcurementWorkflowAccount,
  normalizeProcurementVendor,
  procurementCustomerIdFromServerMetadata,
  procurementCustomerIdsFromServerMetadata,
  procurementOfficeIdFromServerMetadata,
  procurementWorkflowDatabase,
  ProcurementWorkflowError,
} from "../src/lib/procurement-workflow";
import { readProcurementOrderState } from "../src/lib/supply-os/state-runtime/readers/procurement-order";

const customerA = "11111111-1111-4111-8111-111111111111";
const customerB = "22222222-2222-4222-8222-222222222222";
const exactMapping = JSON.stringify({ "office-a": customerA, "office-b": customerB });

async function vendorRegistryLinkContract() {
  const orderId = "33333333-3333-4333-8333-333333333333";
  const vendorId = "44444444-4444-4444-8444-444444444444";
  const supplierRegistryId = "55555555-5555-4555-8555-555555555555";
  let orderQuery = "";
  const request = await getProcurementRequestFromDatabase({
    $queryRawUnsafe: async <T>(query: string) => {
      if (query.includes("to_regclass('public.procurement_communication_messages')")) {
        return [{ available: false }] as T;
      }
      orderQuery = query;
      return [{
        id: orderId,
        status: "sourcing",
        progress: null,
        neededBy: null,
        quantity: 10,
        unit: "units",
        material: "Test material",
        specification: null,
        requestContext: {},
        approvalRequestedAt: null,
        decisionSnapshot: null,
        vendors: [{
          id: vendorId,
          supplierRegistryId,
          name: "Exact Supplier",
          website: "https://supplier.example.test",
          contact: { name: null, email: "quotes@supplier.example.test", phone: null },
          contacted: true,
          responseCount: 0,
          status: "shortlisted",
          research: {},
          quote: null,
        }],
        updatedAt: "2026-08-27T12:00:00.000Z",
      }] as T;
    },
    $executeRawUnsafe: async () => 0,
  }, customerA, orderId);
  assert(request);
  assert.match(orderQuery, /'supplierRegistryId',\s*to_jsonb\(order_vendors\)->>'supplier_registry_id'/);
  assert.equal(request.vendors[0]?.supplierRegistryId, supplierRegistryId);
  assert.equal(normalizeProcurementVendor({ id: vendorId, supplierRegistryId: "not-a-uuid" })?.supplierRegistryId, null);

  const compiled = await readProcurementOrderState({
    scope: {
      type: "procurement_request",
      officeId: "office-a",
      companyId: "company-a",
      customerId: customerA,
      orderId,
    },
    objective: "Compile the canonical vendor link.",
  }, {
    resolveOfficeId: () => "office-a",
    findWorkflowAccount: async () => ({ id: customerA, officeId: "office-a", companyId: "company-a" }),
    getRequest: async () => request,
    getConversation: async () => ({
      available: true,
      unavailableReason: null,
      source: "BOURNE_LEDGER",
      vendor: { id: vendorId, name: "Exact Supplier", contactEmail: "quotes@supplier.example.test" },
      messages: [],
    }),
    findDraftTasks: async () => [],
    findContextDocuments: async () => [],
    findWorkspace: async () => null,
  } as never);
  const current = compiled.currentState.procurementRequest as {
    vendors: Array<{ supplierRegistryId: string | null }>;
  };
  assert.equal(current.vendors[0]?.supplierRegistryId, supplierRegistryId);
}

function expectConfigurationError(operation: () => unknown, message: RegExp) {
  assert.throws(operation, (error: unknown) => (
    error instanceof ProcurementWorkflowError
      && error.code === "configuration"
      && message.test(error.message)
  ));
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  operation: () => Promise<T> | T,
) {
  const prior = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await operation();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function databaseConfigurationContract() {
  await withEnvironment({
    WORKFLOW_DATABASE_URL: undefined,
    WORKFLOW_DATABASE_OWNER_URL: "postgresql://owner:secret@example.test/workflow?sslmode=require",
    WORKFLOW_BOURNE_TEST_URL: "postgresql://bourne:secret@example.test/workflow?sslmode=require",
    BOURNE_DATABASE_URL: "postgresql://bourne:secret@example.test/workflow?sslmode=require",
  }, () => {
    expectConfigurationError(
      () => procurementWorkflowDatabase(),
      /not configured/i,
    );
  });

  for (const url of [
    "postgresql://postgres:secret@example.test/workflow?sslmode=require",
    "postgresql://owner:secret@example.test/workflow?sslmode=require",
    "postgresql://bourne:secret@example.test/workflow?sslmode=require",
  ]) {
    await withEnvironment({ WORKFLOW_DATABASE_URL: url }, () => {
      expectConfigurationError(
        () => procurementWorkflowDatabase(),
        /dashboard_api role/i,
      );
    });
  }

  for (const url of [
    "postgresql://dashboard_api:secret@example.test/workflow",
    "postgresql://dashboard_api:secret@example.test/workflow?sslmode=prefer",
    "postgresql://dashboard_api:secret@example.test/workflow?sslmode=disable",
  ]) {
    await withEnvironment({ WORKFLOW_DATABASE_URL: url }, () => {
      expectConfigurationError(
        () => procurementWorkflowDatabase(),
        /require SSL/i,
      );
    });
  }

  await withEnvironment({
    WORKFLOW_DATABASE_URL: "https://dashboard_api:secret@example.test/workflow?sslmode=require",
  }, () => {
    expectConfigurationError(
      () => procurementWorkflowDatabase(),
      /configuration is invalid/i,
    );
  });

  for (const sslmode of ["require", "verify-ca", "verify-full"]) {
    await withEnvironment({
      NODE_ENV: "production",
      WORKFLOW_DATABASE_URL: `postgresql://dashboard_api:secret@example.test/workflow?sslmode=${sslmode}`,
    }, async () => {
      const client = procurementWorkflowDatabase() as unknown as { $disconnect(): Promise<void> };
      assert(client, `${sslmode} must be accepted for the dashboard_api role.`);
      await client.$disconnect();
    });
  }
}

async function tenantMappingContract() {
  assert.equal(procurementCustomerIdFromServerMetadata("office-a", exactMapping), customerA);
  assert.equal(procurementCustomerIdFromServerMetadata("office-b", exactMapping), customerB);
  assert.equal(procurementOfficeIdFromServerMetadata(customerA, exactMapping), "office-a");
  assert.equal(procurementOfficeIdFromServerMetadata(customerB, exactMapping), "office-b");
  assert.deepEqual(procurementCustomerIdsFromServerMetadata(exactMapping).sort(), [customerA, customerB].sort());

  let scopeQueries = 0;
  const workflowAccount = await getProcurementWorkflowAccount({
    officeId: "office-a",
    customerId: customerA,
    companyId: "company-a",
  }, {
    resolveOfficeId: (customerId) => procurementOfficeIdFromServerMetadata(customerId, exactMapping),
    database: {
      $queryRawUnsafe: async <T>(query: string, ...values: unknown[]) => {
        scopeQueries += 1;
        assert.match(query, /FROM procurement_customer_scope/);
        assert.deepEqual(values, [customerA, "office-a", "company-a"]);
        return [{ id: customerA, officeId: "office-a", companyId: "company-a" }] as unknown as T;
      },
    },
  });
  assert.deepEqual(workflowAccount, { id: customerA, officeId: "office-a", companyId: "company-a" });
  assert.equal(scopeQueries, 1);
  assert.equal(await getProcurementWorkflowAccount({
    officeId: "office-b",
    customerId: customerA,
    companyId: "company-a",
  }, {
    resolveOfficeId: (customerId) => procurementOfficeIdFromServerMetadata(customerId, exactMapping),
    database: {
      $queryRawUnsafe: async <T>() => {
        scopeQueries += 1;
        return [] as unknown as T;
      },
    },
  }), null);
  assert.equal(scopeQueries, 1, "A mapped-office mismatch must fail before workflow SQL.");

  expectConfigurationError(
    () => procurementCustomerIdFromServerMetadata("office-missing", exactMapping),
    /not mapped/i,
  );
  expectConfigurationError(
    () => procurementOfficeIdFromServerMetadata("33333333-3333-4333-8333-333333333333", exactMapping),
    /not mapped/i,
  );
  expectConfigurationError(
    () => procurementCustomerIdFromServerMetadata("office-a", JSON.stringify({ "office-a": "not-a-uuid" })),
    /mapping is invalid/i,
  );

  let requestReadCount = 0;
  await assert.rejects(
    readProcurementOrderState({
      scope: {
        type: "procurement_request",
        officeId: "office-a",
        companyId: "company-a",
        customerId: customerB,
        orderId: "44444444-4444-4444-8444-444444444444",
      },
      objective: "Compile a tenant-scoped request.",
    }, {
      resolveOfficeId: (customerId: string) => procurementOfficeIdFromServerMetadata(customerId, exactMapping),
      getRequest: async () => {
        requestReadCount += 1;
        return null;
      },
      getConversation: async () => ({
        available: false,
        unavailableReason: "not used",
        source: "NONE",
        vendor: { id: "unused", name: "Unused", contactEmail: null },
        messages: [],
      }),
      findDraftTasks: async () => [],
      findContextDocuments: async () => [],
    } as never),
    /does not match the state scope office/i,
  );
  assert.equal(requestReadCount, 0, "A mismatched tenant must fail before any workflow order read.");
}

async function sourceCredentialBoundaryContract() {
  const workflowSource = await readFile("src/lib/procurement-workflow.ts", "utf8");
  const conversationSource = await readFile("src/lib/procurement-conversation.ts", "utf8");
  async function typescriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }));
    return nested.flat();
  }
  const runtimeFiles = await typescriptFiles("src/lib/supply-os/state-runtime");
  const runtimeSource = (await Promise.all(runtimeFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const prohibitedName of [
    "WORKFLOW_DATABASE_OWNER_URL",
    "WORKFLOW_BOURNE_TEST_URL",
    "BOURNE_DATABASE_URL",
    "BOURNE_DATABASE_OWNER_URL",
  ]) {
    assert(!workflowSource.includes(prohibitedName), `${prohibitedName} must not be read by workflow runtime code.`);
    assert(!runtimeSource.includes(prohibitedName), `${prohibitedName} must not be read by state runtime code.`);
  }
  assert.match(workflowSource, /process\.env\.WORKFLOW_DATABASE_URL/);
  assert.match(workflowSource, /decodeURIComponent\(parsed\.username\) !== "dashboard_api"/);
  assert.match(workflowSource, /SSL_MODES\.has\(parsed\.searchParams\.get\("sslmode"\)/);
  assert.match(workflowSource, /FROM procurement_customer_scope/);
  assert(!runtimeSource.includes("companyWorkflowAccount"));
  assert(!conversationSource.includes('import { getValidAccessToken } from "@/lib/gmail-oauth"'));
  assert.match(conversationSource, /await import\("@\/lib\/gmail-oauth"\)/);
  const conversationModule = await import("../src/lib/procurement-conversation");
  assert.equal(typeof conversationModule.procurementVendorConversation, "function");
}

async function optionalDashboardLedgerPrivilegeContract() {
  const explicitTestUrl = process.env.WORKFLOW_DATABASE_TEST_URL?.trim();
  const hasDisposableRoleSet = Boolean(
    process.env.WORKFLOW_DATABASE_OWNER_URL?.trim()
      && process.env.WORKFLOW_BOURNE_TEST_URL?.trim(),
  );
  const testUrl = explicitTestUrl || (hasDisposableRoleSet ? process.env.WORKFLOW_DATABASE_URL?.trim() : undefined);
  if (!testUrl) {
    console.log(
      "Supply state workflow DB privilege audit skipped: no explicit test URL or disposable workflow role set is configured.",
    );
    return;
  }
  const parsed = new URL(testUrl);
  assert.equal(decodeURIComponent(parsed.username), "dashboard_api");
  assert.match(parsed.searchParams.get("sslmode") ?? "", /^(require|verify-ca|verify-full)$/);
  const database = new PrismaClient({ datasourceUrl: testUrl, log: [] });
  try {
    const rows = await database.$queryRawUnsafe<Array<{
      currentUser: string;
      ledger: string | null;
      customerScope: string | null;
      canSelect: boolean;
      canInsert: boolean;
      canUpdate: boolean;
      canDelete: boolean;
      canReadCustomerScope: boolean;
      canWriteCustomerScope: boolean;
    }>>(`
      SELECT
        current_user AS "currentUser",
        to_regclass('public.procurement_communication_messages')::text AS ledger,
        to_regclass('public.procurement_customer_scope')::text AS "customerScope",
        has_table_privilege(current_user, 'public.procurement_communication_messages', 'SELECT') AS "canSelect",
        has_table_privilege(current_user, 'public.procurement_communication_messages', 'INSERT') AS "canInsert",
        has_table_privilege(current_user, 'public.procurement_communication_messages', 'UPDATE') AS "canUpdate",
        has_table_privilege(current_user, 'public.procurement_communication_messages', 'DELETE') AS "canDelete",
        has_table_privilege(current_user, 'public.procurement_customer_scope', 'SELECT') AS "canReadCustomerScope",
        has_table_privilege(current_user, 'public.procurement_customer_scope', 'INSERT')
          OR has_table_privilege(current_user, 'public.procurement_customer_scope', 'UPDATE')
          OR has_table_privilege(current_user, 'public.procurement_customer_scope', 'DELETE')
          AS "canWriteCustomerScope"
    `);
    const row = rows[0];
    assert(row);
    assert.equal(row.currentUser, "dashboard_api");
    assert(row.ledger, "The disposable workflow database must include the communication ledger.");
    assert(row.customerScope, "The disposable workflow database must include the procurement customer scope view.");
    assert.equal(row.canSelect, true, "dashboard_api must be able to read the communication ledger.");
    assert.equal(row.canInsert, false, "dashboard_api must not insert communication ledger rows.");
    assert.equal(row.canUpdate, false, "dashboard_api must not update communication ledger rows.");
    assert.equal(row.canDelete, false, "dashboard_api must not delete communication ledger rows.");
    assert.equal(row.canReadCustomerScope, true, "dashboard_api must read exact procurement customer scope.");
    assert.equal(row.canWriteCustomerScope, false, "dashboard_api must not write procurement customer scope.");
  } finally {
    await database.$disconnect();
  }
}

async function main() {
  await vendorRegistryLinkContract();
  await databaseConfigurationContract();
  await tenantMappingContract();
  await sourceCredentialBoundaryContract();
  await optionalDashboardLedgerPrivilegeContract();
  console.log("Supply state workflow database boundary checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
