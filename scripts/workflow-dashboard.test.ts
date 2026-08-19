import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import {
  createProcurementRequest,
  createProcurementRequestInDatabase,
  listProcurementRequestsFromDatabase,
  normalizeProcurementVendor,
  ProcurementDatabase,
  procurementCustomerIdFromServerMetadata,
  ProcurementWorkflowError,
  requestBourneWorkflowWake,
  submitProcurementRequest,
} from "../src/lib/procurement-workflow";
import { handleProcurementWake } from "../src/lib/procurement-route-handlers";

const customerA = "11111111-1111-4111-8111-111111111111";
const customerB = "22222222-2222-4222-8222-222222222222";

assert.deepEqual(normalizeProcurementVendor({
  id: "vendor-1",
  name: "Supplier One",
  website: "https://example.com",
  contact: { name: "Ada Buyer", email: "ada@example.com", phone: "+1 555 0100" },
  status: "shortlisted",
  research: { source: "public" },
  quote: { amount: 100 },
}), {
  id: "vendor-1",
  name: "Supplier One",
  website: "https://example.com/",
  contact: { name: "Ada Buyer", email: "ada@example.com", phone: "+1 555 0100" },
  status: "shortlisted",
  research: { source: "public" },
  quote: { amount: 100 },
});
assert.equal(normalizeProcurementVendor({
  contact: { name: " ", email: "", phone: "  " },
}), null, "A vendor without a valid id should be rejected.");
assert.equal(normalizeProcurementVendor({ id: "vendor-2", contact: { name: " ", email: "", phone: "  " } })?.contact, null);
assert.equal(normalizeProcurementVendor({ id: "vendor-3" })?.contact, null);

assert.equal(
  procurementCustomerIdFromServerMetadata("office-a", JSON.stringify({ "office-a": customerA })),
  customerA,
);
assert.throws(
  () => procurementCustomerIdFromServerMetadata("office-b", JSON.stringify({ "office-a": customerA })),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);
assert.throws(
  () => procurementCustomerIdFromServerMetadata("office-a", JSON.stringify({ "office-a": "not-a-uuid" })),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);
assert.throws(
  () => procurementCustomerIdFromServerMetadata("office-a", ""),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);
assert.throws(
  () => procurementCustomerIdFromServerMetadata("office-a", "{"),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);
assert.throws(
  () => procurementCustomerIdFromServerMetadata("office-a", "[]"),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);

type State = {
  customers: Set<string>;
  boms: Map<string, { customerId: string }>;
  orders: Map<string, { customerId: string; status: string }>;
  idempotency: Map<string, { requestHash: string; orderId: string | null; retryWakeReady: boolean }>;
  sequence: number;
};

function copyState(state: State): State {
  return {
    customers: new Set(state.customers),
    boms: new Map(state.boms),
    orders: new Map(state.orders),
    idempotency: new Map(Array.from(state.idempotency, ([key, value]) => [key, { ...value }])),
    sequence: state.sequence,
  };
}

class FakeProcurementDatabase implements ProcurementDatabase {
  state: State = {
    customers: new Set([customerA, customerB]),
    boms: new Map(),
    orders: new Map(),
    idempotency: new Map(),
    sequence: 0,
  };
  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  private key(customerId: unknown, idempotencyKey: unknown) {
    return `${String(customerId)}:${String(idempotencyKey)}`;
  }

  async $transaction<T>(operation: (transaction: ProcurementDatabase) => Promise<T>): Promise<T> {
    this.events.push("transaction:begin");
    const transaction = new FakeProcurementDatabase(this.events);
    transaction.state = copyState(this.state);
    try {
      const result = await operation(transaction);
      this.state = transaction.state;
      this.events.push("transaction:commit");
      return result;
    } catch (error) {
      this.events.push("transaction:rollback");
      throw error;
    }
  }

  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    const sql = query.replace(/\s+/g, " ").trim();

    if (sql.startsWith("SELECT id::text AS id FROM customers")) {
      return (this.state.customers.has(String(values[0])) ? [{ id: String(values[0]) }] : []) as T;
    }

    if (sql.startsWith("INSERT INTO procurement_api_idempotency")) {
      const key = this.key(values[0], values[1]);
      if (this.state.idempotency.has(key)) return [] as T;
      const row = { requestHash: String(values[2]), orderId: null, retryWakeReady: false };
      this.state.idempotency.set(key, row);
      return [{ requestHash: row.requestHash, orderId: null }] as T;
    }

    if (sql.includes("FROM procurement_api_idempotency")) {
      const row = this.state.idempotency.get(this.key(values[0], values[1]));
      return (row ? [{ requestHash: row.requestHash, orderId: row.orderId }] : []) as T;
    }

    if (sql.includes('SELECT id::text AS "orderId", status FROM orders')) {
      const order = this.state.orders.get(String(values[0]));
      return (order && order.customerId === values[1]
        ? [{ orderId: String(values[0]), status: order.status }]
        : []) as T;
    }

    if (sql.startsWith("SELECT id::text AS id FROM bill_of_materials")) {
      const bom = this.state.boms.get(String(values[0]));
      return (bom && bom.customerId === values[1] ? [{ id: String(values[0]) }] : []) as T;
    }

    if (sql.startsWith("INSERT INTO bill_of_materials")) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++this.state.sequence).padStart(12, "0")}`;
      this.state.boms.set(id, { customerId: String(values[0]) });
      return [{ id }] as T;
    }

    if (sql.startsWith("INSERT INTO orders")) {
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++this.state.sequence).padStart(12, "0")}`;
      this.state.orders.set(id, { customerId: String(values[0]), status: "new" });
      assert.equal(values[7], undefined, "Status must be fixed in SQL, not supplied by browser input.");
      assert(sql.includes("'new'"));
      assert(sql.includes("'Order received from dashboard'"));
      return [{ orderId: id, status: "new" }] as T;
    }

    throw new Error(`Unexpected query in fake database: ${sql}`);
  }

  async $executeRawUnsafe(query: string, ...values: unknown[]) {
    const sql = query.replace(/\s+/g, " ").trim();
    assert(sql.startsWith("UPDATE procurement_api_idempotency"));
    const key = this.key(values[0], values[1]);
    const row = this.state.idempotency.get(key);
    if (sql.includes("SET order_id")) {
      if (!row || row.requestHash !== values[3]) return 0;
      row.orderId = String(values[2]);
      return 1;
    }
    if (!row || row.requestHash !== values[2] || row.orderId !== values[3] || !row.retryWakeReady) return 0;
    row.retryWakeReady = false;
    return 1;
  }
}

async function main() {
  const validInput = procurementRequestSchema.parse({
    bomId: null,
    material: "6061-T651 aluminum plate",
    specification: "6.35 mm nominal, precision-sawn blanks",
    lineItemPreferences: { schema_version: 1 },
    quantity: 10,
    unit: "blanks",
    neededBy: "2026-09-30",
    notes: "Internal equipment-deck plate stock",
    requestContext: { schema_version: 1, logistics: { destination: null } },
    idempotencyKey: "tenant-123-request-456",
  });

  const unauthenticatedWake = await handleProcurementWake(
    "33333333-3333-4333-8333-333333333333",
    {
      session: async () => null,
      resolveCustomerId: async () => customerA,
      wake: async () => ({ claimed: true, workflowWakeRequested: true }),
    },
  );
  assert.equal(unauthenticatedWake.status, 401);

  let observedWake: { customerId: string; orderId: string } | null = null;
  const authenticatedWake = await handleProcurementWake(
    "33333333-3333-4333-8333-333333333333",
    {
      session: async () => ({ userId: "user-a", officeId: "office-a" }),
      resolveCustomerId: async (session) => {
        assert.equal(session.officeId, "office-a");
        return customerA;
      },
      wake: async (customerId, orderId) => {
        observedWake = { customerId, orderId };
        return { claimed: true, workflowWakeRequested: true };
      },
    },
  );
  assert.equal(authenticatedWake.status, 202);
  assert.deepEqual(observedWake, {
    customerId: customerA,
    orderId: "33333333-3333-4333-8333-333333333333",
  });

const priorWorkflowDatabaseUrl = process.env.WORKFLOW_DATABASE_URL;
try {
  const invalidDatabaseUrls = [
    undefined,
    "not-a-url",
    "https://dashboard_api@example.test/neondb?sslmode=require",
    "postgresql://owner@example.test/neondb?sslmode=require",
    "postgresql://dashboard_api@example.test/neondb",
  ];
  for (const databaseUrl of invalidDatabaseUrls) {
    if (databaseUrl === undefined) delete process.env.WORKFLOW_DATABASE_URL;
    else process.env.WORKFLOW_DATABASE_URL = databaseUrl;
    await assert.rejects(
      createProcurementRequest(customerA, validInput),
      (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
    );
  }
} finally {
  if (priorWorkflowDatabaseUrl === undefined) delete process.env.WORKFLOW_DATABASE_URL;
  else process.env.WORKFLOW_DATABASE_URL = priorWorkflowDatabaseUrl;
}

assert(!procurementRequestSchema.safeParse({ ...validInput, quantity: 0 }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, unit: "" }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, neededBy: "2026-02-30" }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, requestContext: [] }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, status: "ordered" }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, customer_id: customerB }).success);
assert(!procurementRequestSchema.safeParse({ ...validInput, bomId: null, material: "" }).success);

const missingCustomerDatabase = new FakeProcurementDatabase();
missingCustomerDatabase.state.customers.delete(customerA);
await assert.rejects(
  createProcurementRequestInDatabase(missingCustomerDatabase, customerA, validInput),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
);
assert.equal(missingCustomerDatabase.state.orders.size, 0);

const database = new FakeProcurementDatabase();
const first = await createProcurementRequestInDatabase(database, customerA, validInput);
assert.equal(first.status, "new");
assert.equal(first.created, true);
assert.equal(database.state.orders.size, 1);

const duplicate = await createProcurementRequestInDatabase(database, customerA, validInput);
assert.equal(duplicate.orderId, first.orderId);
assert.equal(duplicate.created, false);
assert.equal(duplicate.retryWake, false);
assert.equal(database.state.orders.size, 1, "A duplicate key must not create a second order.");

const listQueryValues: unknown[][] = [];
const listDatabase = {
  async $queryRawUnsafe<T>(_query: string, ...values: unknown[]): Promise<T> {
    listQueryValues.push(values);
    return [{
      id: first.orderId,
      status: "new",
      progress: "Order received from dashboard",
      neededBy: "2026-09-30",
      quantity: "10",
      unit: "blanks",
      material: "6061-T651 aluminum plate",
      specification: "6.35 mm nominal, precision-sawn blanks",
      requestContext: { source: { source_sku: "GUILD2-001" } },
      updatedAt: "2026-08-18T20:00:00.000Z",
    }] as T;
  },
  async $executeRawUnsafe() {
    return 0;
  },
};
const listed = await listProcurementRequestsFromDatabase(listDatabase, customerA, 75, "GUILD2");
assert.deepEqual(listQueryValues, [[customerA, 50, "GUILD2"]], "List reads must remain customer-scoped, campaign-filtered, and capped at 50 rows.");
assert.equal(listed[0]?.requestContext.source instanceof Object, true);
assert.equal((listed[0]?.requestContext.source as Record<string, unknown>).source_sku, "GUILD2-001");

await assert.rejects(
  createProcurementRequestInDatabase(database, customerA, { ...validInput, quantity: 11 }),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "conflict",
);

const foreignBom = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
database.state.boms.set(foreignBom, { customerId: customerB });
await assert.rejects(
  createProcurementRequestInDatabase(database, customerA, {
    ...validInput,
    bomId: foreignBom,
    material: undefined,
    idempotencyKey: "foreign-bom-attempt",
  }),
  (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "not_found",
);
assert(!database.state.idempotency.has(`${customerA}:foreign-bom-attempt`), "A failed transaction must release its idempotency claim.");

const priorWebhookUrl = process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
const priorWebhookSecret = process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";
const webhookDatabase = new FakeProcurementDatabase();
const successFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  webhookDatabase.events.push("webhook");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-webhook-secret");
  const payload = JSON.parse(String(init?.body));
  assert.equal(payload.event, "procurement.request.created");
  assert.equal(payload.customerId, customerA);
  return new Response(null, { status: 204 });
}) as typeof fetch;
const submitted = await submitProcurementRequest(customerA, {
  ...validInput,
  idempotencyKey: "webhook-order",
}, { database: webhookDatabase, fetchImplementation: successFetch });
assert.equal(submitted.workflowWakeRequested, true);
assert(webhookDatabase.events.indexOf("transaction:commit") < webhookDatabase.events.indexOf("webhook"));

const retryKey = `${customerA}:webhook-order`;
const retryRow = webhookDatabase.state.idempotency.get(retryKey);
assert(retryRow);
retryRow.retryWakeReady = true;
const retried = await submitProcurementRequest(customerA, {
  ...validInput,
  idempotencyKey: "webhook-order",
}, { database: webhookDatabase, fetchImplementation: successFetch });
assert.equal(retried.created, false);
assert.equal(retried.retryWake, true);
assert.equal(retried.workflowWakeRequested, true);
assert.equal(webhookDatabase.state.orders.size, 1, "A recovery wake must reuse the original order.");
assert.equal(webhookDatabase.events.filter((event) => event === "webhook").length, 2);

const boundedRetry = await submitProcurementRequest(customerA, {
  ...validInput,
  idempotencyKey: "webhook-order",
}, { database: webhookDatabase, fetchImplementation: successFetch });
assert.equal(boundedRetry.retryWake, false);
assert.equal(boundedRetry.workflowWakeRequested, false);
assert.equal(webhookDatabase.events.filter((event) => event === "webhook").length, 2, "Recovery wakes must be rate-limited durably.");

retryRow.retryWakeReady = true;
const progressedOrder = webhookDatabase.state.orders.get(submitted.orderId);
assert(progressedOrder);
progressedOrder.status = "researching";
const progressedDuplicate = await submitProcurementRequest(customerA, {
  ...validInput,
  idempotencyKey: "webhook-order",
}, { database: webhookDatabase, fetchImplementation: successFetch });
assert.equal(progressedDuplicate.retryWake, false);
assert.equal(progressedDuplicate.workflowWakeRequested, false);
assert.equal(webhookDatabase.events.filter((event) => event === "webhook").length, 2, "An active order must never receive a recovery wake.");

const failureDatabase = new FakeProcurementDatabase();
const priorWarn = console.warn;
console.warn = () => undefined;
try {
  const failingFetch = (async () => {
    failureDatabase.events.push("webhook");
    throw new Error("network failure");
  }) as typeof fetch;
  const result = await submitProcurementRequest(customerA, {
    ...validInput,
    idempotencyKey: "failed-webhook-order",
  }, { database: failureDatabase, fetchImplementation: failingFetch });
  assert.equal(result.status, "new");
  assert.equal(result.workflowWakeRequested, true);
  assert.equal(failureDatabase.state.orders.size, 1, "Webhook failure must not roll back the committed order.");

  delete process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
  let missingSecretFetchCalled = false;
  const missingSecretRequested = await requestBourneWorkflowWake(
    { orderId: result.orderId, customerId: customerA },
    (async () => {
      missingSecretFetchCalled = true;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  );
  assert.equal(missingSecretRequested, false);
  assert.equal(missingSecretFetchCalled, false);
  process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";

  process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "http://insecure.example.test/workflow";
  let insecureFetchCalled = false;
  const insecureRequested = await requestBourneWorkflowWake(
    { orderId: result.orderId, customerId: customerA },
    (async () => {
      insecureFetchCalled = true;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  );
  assert.equal(insecureRequested, false);
  assert.equal(insecureFetchCalled, false);
} finally {
  console.warn = priorWarn;
  if (priorWebhookUrl === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
  else process.env.BOURNE_WORKFLOW_WEBHOOK_URL = priorWebhookUrl;
  if (priorWebhookSecret === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
  else process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = priorWebhookSecret;
}

const routeSource = await readFile("src/app/api/procurement/requests/route.ts", "utf8");
const detailRouteSource = await readFile("src/app/api/procurement/requests/[orderId]/route.ts", "utf8");
const wakeRouteSource = await readFile("src/app/api/procurement/requests/[orderId]/wake/route.ts", "utf8");
const handlerSource = await readFile("src/lib/procurement-route-handlers.ts", "utf8");
const workflowSource = await readFile("src/lib/procurement-workflow.ts", "utf8");
const clientSource = await readFile("src/app/dashboard/workflow/procurement-workflow.tsx", "utf8");
const provisioningSql = await readFile("scripts/sql/procurement-dashboard-api.sql", "utf8");

assert(handlerSource.includes("if (!session)"), "Procurement handlers must reject unauthenticated requests.");
assert(routeSource.includes("handleProcurementPost"), "POST must use the authenticated procurement handler.");
assert(detailRouteSource.includes("handleProcurementDetail"), "Detail must use the authenticated procurement handler.");
assert(wakeRouteSource.includes("handleProcurementWake"), "Wake retries must use the authenticated procurement handler.");
assert(workflowSource.includes("claim.updated_at <= now() - interval '30 seconds'"), "Wake retries must be durably rate limited.");
assert(workflowSource.includes("orders.status = 'new'"), "Wake retries must only target queued orders.");
assert(workflowSource.includes("AND orders.customer_id = $2::uuid"), "Order detail reads must scope by customer.");
assert(workflowSource.includes('orders.request_context AS "requestContext"'), "Order lists must restore stored request context.");
assert(workflowSource.includes("limit = 50"), "The recent order list must cover all 38 GUILD2 sourcing lines.");
assert(workflowSource.includes("AND customer_id = $2::uuid"), "BOM reads must scope by customer.");
assert(workflowSource.includes("AbortSignal.timeout(3_000)"), "The webhook must use a short timeout.");
assert(handlerSource.includes("request.body.getReader()"), "The API must enforce its request limit against streamed bytes.");
assert(clientSource.includes("Evidence"), "Supplier evidence must be visible in the request detail table.");
assert(clientSource.includes("slice(0, 180)"), "Supplier evidence text must be bounded before rendering.");
assert(!clientSource.includes("WORKFLOW_DATABASE_URL"));
assert(!clientSource.includes("BOURNE_WORKFLOW_WEBHOOK_URL"));
assert(!clientSource.includes("BOURNE_WORKFLOW_WEBHOOK_SECRET"));
assert(!clientSource.includes("lease_owner"));
assert(!clientSource.includes("gmail"));
assert(!clientSource.includes("customer_id"));
assert(provisioningSql.includes("CREATE ROLE dashboard_api LOGIN NOINHERIT"));
assert(provisioningSql.includes("ALTER ROLE dashboard_api NOINHERIT"));
assert(!provisioningSql.includes("NOSUPERUSER"), "Managed Neon owners cannot alter the SUPERUSER flag.");
assert(!provisioningSql.includes("NOREPLICATION"), "Managed Neon owners cannot alter the REPLICATION flag.");
assert(!provisioningSql.includes("NOBYPASSRLS"), "Managed Neon owners cannot alter the BYPASSRLS flag.");
assert(provisioningSql.includes("rolsuper"));
assert(provisioningSql.includes("rolcreatedb"));
assert(provisioningSql.includes("rolcreaterole"));
assert(provisioningSql.includes("rolinherit"));
assert(provisioningSql.includes("rolreplication"));
assert(provisioningSql.includes("rolbypassrls"));
assert(provisioningSql.includes("pg_auth_members"));
assert(provisioningSql.includes("GRANT SELECT (id) ON customers TO dashboard_api"));
assert(provisioningSql.includes("GRANT UPDATE (order_id, updated_at) ON procurement_api_idempotency"));
assert(!/GRANT\s+UPDATE(?:\s*\([^)]*\))?\s+ON\s+orders\b/i.test(provisioningSql));
assert(!/GRANT\s+(?:[^;]*,\s*)?UPDATE(?:\s*\([^)]*\))?\s+ON\s+order_vendors\b/i.test(provisioningSql));
assert(!/GRANT\s+INSERT(?:\s*\([^)]*\))?\s+ON\s+order_vendors\b/i.test(provisioningSql));

console.log("Procurement workflow contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
