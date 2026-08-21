import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  handleProcurementDetail,
  handleProcurementList,
  handleProcurementPost,
} from "../src/lib/procurement-route-handlers";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import {
  GUILD2_PROCUREMENT_PLAN,
  guild2ProcurementRequest,
  runWithBoundedConcurrency,
} from "../src/lib/supply-os/guild2-procurement";
import {
  createProcurementRequestInDatabase,
  getProcurementRequestFromDatabase,
  getProcurementVendorConversationRefFromDatabase,
  listProcurementRequestsFromDatabase,
  ProcurementWorkflowError,
  resolveProcurementCustomerId,
  retryProcurementWorkflowWake,
  submitProcurementRequest,
} from "../src/lib/procurement-workflow";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function permissionDenied(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return /permission denied/i.test(message);
  });
}

async function main() {
  const ownerUrl = requiredEnvironment("WORKFLOW_DATABASE_OWNER_URL");
  const configuredDashboardUrl = requiredEnvironment("WORKFLOW_DATABASE_URL");
  const configuredUrl = new URL(configuredDashboardUrl);
  assert.equal(configuredUrl.username, "dashboard_api");
  assert.match(configuredUrl.searchParams.get("sslmode") ?? "", /^(require|verify-ca|verify-full)$/);
  const dashboardUrl = process.env.WORKFLOW_DATABASE_TEST_URL?.trim() || configuredDashboardUrl;

  const app = new PrismaClient();
  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  const dashboard = new PrismaClient({ datasourceUrl: dashboardUrl });
  const concurrentDashboard = new PrismaClient({ datasourceUrl: dashboardUrl });
  const suffix = Date.now().toString(36);
  const officeId = `procurement-db-${suffix}`;
  const userId = `procurement-user-${suffix}`;
  const officeBId = `procurement-db-b-${suffix}`;
  const userBId = `procurement-user-b-${suffix}`;
  const customerA = randomUUID();
  const customerB = randomUUID();
  const foreignBom = randomUUID();
  process.env.PROCUREMENT_CUSTOMER_MAP_JSON = JSON.stringify({
    [officeId]: customerA,
    [officeBId]: customerB,
  });

  try {
    await app.office.create({ data: { id: officeId, name: `Procurement DB ${suffix}` } });
    await app.user.create({
      data: {
        id: userId,
        officeId,
        email: `procurement-db-${suffix}@example.test`,
        passwordHash: "not-used",
        fullName: "Procurement test",
        role: "ADMIN",
        isActive: true,
        canViewWholeOffice: true,
      },
    });
    await app.office.create({ data: { id: officeBId, name: `Procurement DB B ${suffix}` } });
    await app.user.create({
      data: {
        id: userBId,
        officeId: officeBId,
        email: `procurement-db-b-${suffix}@example.test`,
        passwordHash: "not-used",
        fullName: "Procurement test B",
        role: "ADMIN",
        isActive: true,
        canViewWholeOffice: true,
      },
    });
    await owner.$executeRawUnsafe(
      "INSERT INTO customers (id, name, procurement_preferences) VALUES ($1::uuid, $2, '{}'::jsonb), ($3::uuid, $4, '{}'::jsonb)",
      customerA,
      "Customer A",
      customerB,
      "Customer B",
    );
    await owner.$executeRawUnsafe(
      "INSERT INTO bill_of_materials (id, customer_id, material, specification, procurement_preferences) VALUES ($1::uuid, $2::uuid, $3, $4, '{}'::jsonb)",
      foreignBom,
      customerB,
      "Foreign material",
      "Foreign specification",
    );

    assert.equal(
      await resolveProcurementCustomerId({ userId, officeId }),
      customerA,
      "Customer identity must come from the authenticated Office mapping.",
    );

    const input = procurementRequestSchema.parse({
      bomId: null,
      material: "6061-T651 aluminum plate",
      specification: "6.35 mm nominal, precision-sawn blanks",
      lineItemPreferences: { schema_version: 1 },
      quantity: 10,
      unit: "blanks",
      neededBy: "2026-09-30",
      notes: "Database contract",
      requestContext: { schema_version: 1, logistics: { destination: null } },
      idempotencyKey: `db-contract-${suffix}`,
    });

    const workflowDatabase = dashboard as unknown as import("../src/lib/procurement-workflow").ProcurementDatabase;
    const created = await createProcurementRequestInDatabase(workflowDatabase, customerA, input);
    assert.equal(created.status, "new");
    assert.equal(created.created, true);
    const duplicate = await createProcurementRequestInDatabase(workflowDatabase, customerA, input);
    assert.equal(duplicate.orderId, created.orderId);
    assert.equal(duplicate.created, false);
    const count = await owner.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*) AS count FROM orders WHERE customer_id = $1::uuid",
      customerA,
    );
    assert.equal(Number(count[0]?.count), 1);
    const customerScopedDuplicate = await createProcurementRequestInDatabase(workflowDatabase, customerB, input);
    assert.notEqual(customerScopedDuplicate.orderId, created.orderId);
    assert.equal(customerScopedDuplicate.created, true);

    await owner.$executeRawUnsafe(
      "UPDATE procurement_api_idempotency SET updated_at = now() - interval '31 seconds' WHERE customer_id = $1::uuid AND order_id = $2::uuid",
      customerA,
      created.orderId,
    );
    const priorRetryWebhookUrl = process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
    const priorRetryWebhookSecret = process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
    process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
    process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";
    let retryWebhookCount = 0;
    try {
      const wake = (async () => {
        retryWebhookCount += 1;
        return new Response(null, { status: 204 });
      }) as typeof fetch;
      const retry = await retryProcurementWorkflowWake(customerA, created.orderId, {
        database: workflowDatabase,
        fetchImplementation: wake,
      });
      assert.deepEqual(retry, { claimed: true, workflowWakeRequested: true });
      const boundedRetry = await retryProcurementWorkflowWake(customerA, created.orderId, {
        database: workflowDatabase,
        fetchImplementation: wake,
      });
      assert.deepEqual(boundedRetry, { claimed: false, workflowWakeRequested: false });
      assert.equal(retryWebhookCount, 1, "Wake retries must be customer-scoped and durably rate limited.");
      await assert.rejects(
        retryProcurementWorkflowWake(customerB, created.orderId, {
          database: workflowDatabase,
          fetchImplementation: wake,
        }),
        (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "not_found",
      );
    } finally {
      if (priorRetryWebhookUrl === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
      else process.env.BOURNE_WORKFLOW_WEBHOOK_URL = priorRetryWebhookUrl;
      if (priorRetryWebhookSecret === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
      else process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = priorRetryWebhookSecret;
    }

    const priorConcurrentWebhookUrl = process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
    const priorConcurrentWebhookSecret = process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
    process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
    process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";
    let concurrentWebhookCount = 0;
    try {
      const concurrentInput = {
        ...input,
        idempotencyKey: `concurrent-${suffix}`,
        notes: "Concurrent double-click contract",
      };
      const wake = (async () => {
        concurrentWebhookCount += 1;
        return new Response(null, { status: 204 });
      }) as typeof fetch;
      const [left, right] = await Promise.all([
        submitProcurementRequest(customerA, concurrentInput, {
          database: workflowDatabase,
          fetchImplementation: wake,
        }),
        submitProcurementRequest(customerA, concurrentInput, {
          database: concurrentDashboard as unknown as import("../src/lib/procurement-workflow").ProcurementDatabase,
          fetchImplementation: wake,
        }),
      ]);
      assert.equal(left.orderId, right.orderId);
      assert.deepEqual([left.created, right.created].sort(), [false, true]);
      assert.equal(concurrentWebhookCount, 1, "Concurrent duplicate clicks must issue one wake.");
      const concurrentCount = await owner.$queryRawUnsafe<Array<{ count: bigint }>>(`
        SELECT count(*) AS count
        FROM procurement_api_idempotency
        WHERE customer_id = $1::uuid
          AND idempotency_key = $2
          AND order_id IS NOT NULL
      `, customerA, concurrentInput.idempotencyKey);
      assert.equal(Number(concurrentCount[0]?.count), 1);
    } finally {
      if (priorConcurrentWebhookUrl === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
      else process.env.BOURNE_WORKFLOW_WEBHOOK_URL = priorConcurrentWebhookUrl;
      if (priorConcurrentWebhookSecret === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
      else process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = priorConcurrentWebhookSecret;
    }

    await assert.rejects(
      createProcurementRequestInDatabase(workflowDatabase, customerA, {
        ...input,
        bomId: foreignBom,
        material: undefined,
        idempotencyKey: `foreign-bom-${suffix}`,
      }),
      (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "not_found",
    );

    await owner.$executeRawUnsafe(
      "INSERT INTO order_vendors (order_id, name, website, contact_name, contact_email, contact_phone, status, research, quote, gmail_message_id) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)",
      created.orderId,
      "Example supplier",
      "https://example.com",
      "Ada Buyer",
      "ada@example.com",
      "+1 555 0100",
      "shortlisted",
      JSON.stringify({ source: "public" }),
      JSON.stringify({ amount: 100 }),
      "must-not-leak",
    );
    await owner.$executeRawUnsafe(
      "INSERT INTO order_vendors (order_id, name, contact, identity, status) VALUES ($1::uuid, $2, $3::jsonb, '{}'::jsonb, $4), ($1::uuid, $5, '{}'::jsonb, $6::jsonb, $4)",
      created.orderId,
      "Nested contact supplier",
      JSON.stringify({ name: "Grace Seller", email: "grace@example.com", phone: "+1 555 0101" }),
      "shortlisted",
      "Identity contact supplier",
      JSON.stringify({ contact_name: "Lin Vendor", contact_email: "lin@example.com", contact_phone: "+1 555 0102" }),
    );
    const detail = await getProcurementRequestFromDatabase(workflowDatabase, customerA, created.orderId);
    assert(detail);
    const vendorsByName = new Map(detail.vendors.map((vendor) => [vendor.name, vendor]));
    assert.deepEqual(vendorsByName.get("Example supplier")?.contact, {
      name: "Ada Buyer",
      email: "ada@example.com",
      phone: "+1 555 0100",
    });
    assert.deepEqual(vendorsByName.get("Nested contact supplier")?.contact, {
      name: "Grace Seller",
      email: "grace@example.com",
      phone: "+1 555 0101",
    });
    assert.deepEqual(vendorsByName.get("Identity contact supplier")?.contact, {
      name: "Lin Vendor",
      email: "lin@example.com",
      phone: "+1 555 0102",
    });
    assert.equal(vendorsByName.get("Example supplier")?.contacted, true);
    assert.equal(vendorsByName.get("Nested contact supplier")?.contacted, false);
    const exampleSupplierId = vendorsByName.get("Example supplier")?.id;
    assert(exampleSupplierId);
    assert.deepEqual(
      await getProcurementVendorConversationRefFromDatabase(
        workflowDatabase,
        customerA,
        created.orderId,
        exampleSupplierId,
      ),
      {
        vendorId: exampleSupplierId,
        vendorName: "Example supplier",
        contactEmail: "ada@example.com",
        gmailMessageId: "must-not-leak",
      },
    );
    assert.equal(
      await getProcurementVendorConversationRefFromDatabase(
        workflowDatabase,
        customerB,
        created.orderId,
        exampleSupplierId,
      ),
      null,
      "A foreign customer must not resolve the supplier message reference.",
    );
    assert.equal("gmail_message_id" in detail, false);
    assert.equal("lease_owner" in detail, false);
    assert.equal("gmail_message_id" in (detail.vendors[0] ?? {}), false);
    const customerAOrders = await listProcurementRequestsFromDatabase(workflowDatabase, customerA);
    assert.equal(customerAOrders.length, 2);
    assert(customerAOrders.some((order) => order.id === created.orderId));
    const listedCreatedOrder = customerAOrders.find((order) => order.id === created.orderId);
    assert.equal(listedCreatedOrder?.supplierCount, 3);
    assert.equal(listedCreatedOrder?.contactedCount, 1);
    assert.equal(listedCreatedOrder?.responseCount, 1);
    assert(!customerAOrders.some((order) => order.id === customerScopedDuplicate.orderId));
    assert.equal(await getProcurementRequestFromDatabase(workflowDatabase, customerB, created.orderId), null);

    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE orders SET status = 'ordered' WHERE id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE orders SET approval_requested_at = now() WHERE id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE orders SET progress = 'tampered', lease_owner = 'browser', decision_snapshot = '{}'::jsonb, gmail_thread_id = 'browser' WHERE id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE order_vendors SET quote = '{}'::jsonb WHERE order_id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE order_vendors SET status = 'ordered', research = '{}'::jsonb, gmail_message_id = 'browser' WHERE order_id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "INSERT INTO order_vendors (order_id, name, status) VALUES ($1::uuid, 'Blocked', 'shortlisted')",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "DELETE FROM orders WHERE id = $1::uuid",
      created.orderId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "TRUNCATE orders",
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE customers SET name = 'Blocked' WHERE id = $1::uuid",
      customerA,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE bill_of_materials SET material = 'Blocked' WHERE id = $1::uuid",
      foreignBom,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "DELETE FROM procurement_api_idempotency WHERE customer_id = $1::uuid",
      customerA,
    ));

    process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
    process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";
    const priorWarn = console.warn;
    console.warn = () => undefined;
    try {
      const webhookFailure = await submitProcurementRequest(customerA, {
        ...input,
        idempotencyKey: `webhook-failure-${suffix}`,
      }, {
        database: workflowDatabase,
        fetchImplementation: (async () => {
          throw new Error("expected webhook failure");
        }) as typeof fetch,
      });
      assert.equal(webhookFailure.status, "new");
      const persisted = await owner.$queryRawUnsafe<Array<{ count: bigint }>>(
        "SELECT count(*) AS count FROM orders WHERE id = $1::uuid AND status = 'new'",
        webhookFailure.orderId,
      );
      assert.equal(Number(persisted[0]?.count), 1);
    } finally {
      console.warn = priorWarn;
    }

    let previewWebhookCount = 0;
    const previewFetch = (async () => {
      previewWebhookCount += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const sessionA = { userId, officeId };
    const sessionB = { userId: userBId, officeId: officeBId };
    const authenticatedDependencies = {
      session: async () => sessionA,
      resolveCustomerId: resolveProcurementCustomerId,
      submit: (customerId: string, request: typeof input) => submitProcurementRequest(
        customerId,
        request,
        { database: workflowDatabase, fetchImplementation: previewFetch },
      ),
      list: (customerId: string, limit = 50, sourceCampaign?: string, filters = {}) => (
        listProcurementRequestsFromDatabase(workflowDatabase, customerId, limit, sourceCampaign, filters)
      ),
    };
    const previewInput = {
      ...input,
      idempotencyKey: `authenticated-preview-${suffix}`,
    };
    const unauthenticated = await handleProcurementPost(
      new Request("http://preview.test/api/procurement/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(previewInput),
      }),
      { ...authenticatedDependencies, session: async () => null },
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal((await handleProcurementList({
      ...authenticatedDependencies,
      session: async () => null,
    })).status, 401);
    assert.equal((await handleProcurementDetail(created.orderId, {
      session: async () => null,
      resolveCustomerId: resolveProcurementCustomerId,
      getRequest: (customerId: string, orderId: string) => getProcurementRequestFromDatabase(
        workflowDatabase,
        customerId,
        orderId,
      ),
    })).status, 401);

    const malformed = await handleProcurementPost(
      new Request("http://preview.test/api/procurement/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      authenticatedDependencies,
    );
    assert.equal(malformed.status, 400);

    const oversized = await handleProcurementPost(
      new Request("http://preview.test/api/procurement/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...previewInput, notes: "x".repeat(65_000) }),
      }),
      authenticatedDependencies,
    );
    assert.equal(oversized.status, 413);

    for (const [code, expectedStatus] of [
      ["forbidden", 403],
      ["not_found", 404],
      ["conflict", 409],
      ["configuration", 409],
      ["unavailable", 503],
    ] as const) {
      const routeFailure = await handleProcurementList({
        ...authenticatedDependencies,
        resolveCustomerId: async () => {
          throw new ProcurementWorkflowError("Expected route failure.", code);
        },
      });
      assert.equal(routeFailure.status, expectedStatus);
    }
    assert.equal((await handleProcurementList({
      ...authenticatedDependencies,
      resolveCustomerId: async () => {
        throw new Error("Unexpected route failure.");
      },
    })).status, 500);

    const previewRequest = () => new Request("http://preview.test/api/procurement/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(previewInput),
    });
    const previewCreated = await handleProcurementPost(previewRequest(), authenticatedDependencies);
    assert.equal(previewCreated.status, 201);
    const previewPayload = await previewCreated.json() as { orderId: string; workflowWakeRequested: boolean };
    assert.equal(previewPayload.workflowWakeRequested, true);
    assert.equal(previewWebhookCount, 1);
    assert(!JSON.stringify(previewPayload).includes("postgresql://"));
    assert(!JSON.stringify(previewPayload).includes("bourne.example.test"));

    const previewDetail = await handleProcurementDetail(previewPayload.orderId, {
      session: async () => sessionA,
      resolveCustomerId: resolveProcurementCustomerId,
      getRequest: (customerId: string, orderId: string) => getProcurementRequestFromDatabase(
        workflowDatabase,
        customerId,
        orderId,
      ),
    });
    assert.equal(previewDetail.status, 200);
    const previewDetailPayload = await previewDetail.json() as { id: string };
    assert.equal(previewDetailPayload.id, previewPayload.orderId);

    const previewDuplicate = await handleProcurementPost(previewRequest(), authenticatedDependencies);
    assert.equal(previewDuplicate.status, 200);
    assert.equal((await previewDuplicate.json() as { orderId: string }).orderId, previewPayload.orderId);
    assert.equal(previewWebhookCount, 1, "An idempotent retry must not issue a second wake.");

    const rejectedControlledFields = await handleProcurementPost(
      new Request("http://preview.test/api/procurement/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...previewInput, customerId: customerB, status: "ordered", leaseOwner: "browser" }),
      }),
      authenticatedDependencies,
    );
    assert.equal(rejectedControlledFields.status, 400);

    const listA = await handleProcurementList(authenticatedDependencies);
    assert.equal(listA.status, 200);
    const listAPayload = await listA.json() as { requests: Array<{ id: string }> };
    assert(listAPayload.requests.some((order) => order.id === previewPayload.orderId));
    assert(!listAPayload.requests.some((order) => order.id === customerScopedDuplicate.orderId));

    const detailDenied = await handleProcurementDetail(
      previewPayload.orderId,
      {
        session: async () => sessionB,
        resolveCustomerId: resolveProcurementCustomerId,
        getRequest: (customerId: string, orderId: string) => getProcurementRequestFromDatabase(
          workflowDatabase,
          customerId,
          orderId,
        ),
      },
    );
    assert.equal(detailDenied.status, 404);

    const customerBPreview = await handleProcurementPost(previewRequest(), {
      ...authenticatedDependencies,
      session: async () => sessionB,
    });
    assert.equal(customerBPreview.status, 201);
    assert.notEqual((await customerBPreview.json() as { orderId: string }).orderId, previewPayload.orderId);
    assert.equal(previewWebhookCount, 2, "The same durable key is independent for each authenticated customer.");

    const customerBGuildOrder = await createProcurementRequestInDatabase(
      workflowDatabase,
      customerB,
      guild2ProcurementRequest(GUILD2_PROCUREMENT_PLAN.searchable[0]!),
    );

    const guildOrderIds = new Set<string>();
    await runWithBoundedConcurrency(GUILD2_PROCUREMENT_PLAN.searchable, async (line) => {
      const response = await handleProcurementPost(
        new Request("http://preview.test/api/procurement/requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(guild2ProcurementRequest(line)),
        }),
        authenticatedDependencies,
      );
      assert.equal(response.status, 201);
      guildOrderIds.add((await response.json() as { orderId: string }).orderId);
    });
    assert.equal(guildOrderIds.size, 38);
    assert.equal(previewWebhookCount, 40, "Each of the 38 new searchable orders must receive one wake attempt.");

    await runWithBoundedConcurrency(GUILD2_PROCUREMENT_PLAN.searchable, async (line) => {
      const response = await handleProcurementPost(
        new Request("http://preview.test/api/procurement/requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(guild2ProcurementRequest(line)),
        }),
        authenticatedDependencies,
      );
      assert.equal(response.status, 200);
      assert(guildOrderIds.has((await response.json() as { orderId: string }).orderId));
    });
    assert.equal(previewWebhookCount, 40, "Retrying all 38 lines must not issue another wake.");

    const guildRows = await owner.$queryRawUnsafe<Array<{ lineId: string }>>(`
      SELECT request_context->'source'->>'line_id' AS "lineId"
      FROM orders
      WHERE customer_id = $1::uuid
        AND request_context->'source'->>'campaign' = 'GUILD2'
    `, customerA);
    assert.equal(guildRows.length, 38);
    assert(!guildRows.some((row) => row.lineId === "GUILD-027" || row.lineId === "GUILD-039"));

    const filteredGuildOrders = await listProcurementRequestsFromDatabase(
      workflowDatabase,
      customerA,
      50,
      "GUILD2",
    );
    assert.equal(filteredGuildOrders.length, 38);
    assert(filteredGuildOrders.every((order) => (
      (order.requestContext.source as Record<string, unknown> | undefined)?.campaign === "GUILD2"
    )));
    assert.equal(
      (await listProcurementRequestsFromDatabase(workflowDatabase, customerB, 50, "GUILD2"))[0]?.id,
      customerBGuildOrder.orderId,
      "Campaign filtering must not weaken customer isolation.",
    );
    assert(!filteredGuildOrders.some((order) => order.id === customerBGuildOrder.orderId));
    const filteredRoute = await handleProcurementList(authenticatedDependencies, {
      sourceCampaign: "GUILD2",
      activeOnly: true,
    });
    assert.equal(filteredRoute.status, 200);
    assert.equal(((await filteredRoute.json()) as { requests: unknown[] }).requests.length, 38);
    let invalidCampaignListCalls = 0;
    assert.equal(
      (await handleProcurementList({
        ...authenticatedDependencies,
        list: async () => {
          invalidCampaignListCalls += 1;
          return [];
        },
      }, { sourceCampaign: "GUILD2!" })).status,
      400,
    );
    assert.equal(invalidCampaignListCalls, 0);
    assert.equal(
      (await handleProcurementList({
        ...authenticatedDependencies,
        list: async () => {
          invalidCampaignListCalls += 1;
          return [];
        },
      }, { sourceWorkspaceId: "bad workspace" })).status,
      400,
    );
    assert.equal(invalidCampaignListCalls, 0);

    const clientSource = await readFile("src/app/dashboard/workflow/procurement-workflow.tsx", "utf8");
    assert(!clientSource.includes("WORKFLOW_DATABASE_URL"));
    assert(!clientSource.includes("BOURNE_WORKFLOW_WEBHOOK_URL"));
    assert(!clientSource.includes("BOURNE_WORKFLOW_WEBHOOK_SECRET"));
    assert(!clientSource.includes("PROCUREMENT_CUSTOMER_MAP_JSON"));
    console.log("Procurement workflow database contract passed.");
  } finally {
    await owner.$executeRawUnsafe("DELETE FROM customers WHERE id IN ($1::uuid, $2::uuid)", customerA, customerB).catch(() => undefined);
    await app.office.deleteMany({ where: { id: { in: [officeId, officeBId] } } }).catch(() => undefined);
    await Promise.all([
      app.$disconnect(),
      owner.$disconnect(),
      dashboard.$disconnect(),
      concurrentDashboard.$disconnect(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
