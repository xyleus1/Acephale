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
} from "./fixtures/legacy-supply-os/guild2-procurement";
import {
  createProcurementRequestInDatabase,
  getProcurementCommunicationMessagesFromDatabase,
  getProcurementRequestFromDatabase,
  getProcurementVendorConversationRefFromDatabase,
  listDueProcurementWakeCandidatesFromDatabase,
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
    return /permission denied|is not a table/i.test(message);
  });
}

async function main() {
  const ownerUrl = requiredEnvironment("WORKFLOW_DATABASE_OWNER_URL");
  const configuredDashboardUrl = requiredEnvironment("WORKFLOW_DATABASE_URL");
  const configuredUrl = new URL(configuredDashboardUrl);
  assert.equal(configuredUrl.username, "dashboard_api");
  assert.match(configuredUrl.searchParams.get("sslmode") ?? "", /^(require|verify-ca|verify-full)$/);
  const dashboardUrl = process.env.WORKFLOW_DATABASE_TEST_URL?.trim() || configuredDashboardUrl;
  const bourneUrl = requiredEnvironment("WORKFLOW_BOURNE_TEST_URL");

  const app = new PrismaClient();
  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  const dashboard = new PrismaClient({ datasourceUrl: dashboardUrl });
  const concurrentDashboard = new PrismaClient({ datasourceUrl: dashboardUrl });
  const bourne = new PrismaClient({ datasourceUrl: bourneUrl });
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
    const companyA = await app.company.create({ data: { officeId, name: "Customer A" } });
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
    const companyB = await app.company.create({ data: { officeId: officeBId, name: "Customer B" } });
    await owner.$executeRawUnsafe(
      "INSERT INTO \"CompanyWorkflowAccount\" (id, office_id, company_id, name) VALUES ($1::uuid, $2, $3, $4), ($5::uuid, $6, $7, $8)",
      customerA,
      officeId,
      companyA.id,
      "Customer A",
      customerB,
      officeBId,
      companyB.id,
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
    const createdItemContext = await owner.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT count(*) AS count
      FROM "CompanyContext" context
      JOIN "Item" item ON item.id = context."itemId"
      WHERE item.customer_id = $1::uuid
        AND context.kind = 'NOTE'
        AND context.payload->>'source' = 'bill_of_materials compatibility view'
    `, customerA);
    assert.equal(Number(createdItemContext[0]?.count), 1, "Soft item guidance must become item-scoped Context.");
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
      const dueBeforeRetry = await listDueProcurementWakeCandidatesFromDatabase(
        workflowDatabase,
        [customerA],
        10,
      );
      assert.deepEqual(dueBeforeRetry, [{ customerId: customerA, orderId: created.orderId }]);
      const retry = await retryProcurementWorkflowWake(customerA, created.orderId, {
        database: workflowDatabase,
        fetchImplementation: wake,
      });
      assert.deepEqual(retry, { claimed: true, workflowWakeRequested: true });
      assert.deepEqual(
        await listDueProcurementWakeCandidatesFromDatabase(workflowDatabase, [customerA], 10),
        [],
        "A claimed wake must leave the reconciliation queue until its durable retry window expires.",
      );
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
      JSON.stringify({ contact_name: "Lin Vendor", email: "lin@example.com", contact_phone: "+1 555 0102" }),
    );
    const ledgerVendorRows = await owner.$queryRawUnsafe<Array<{ id: string }>>(
      "INSERT INTO order_vendors (order_id, name, status) VALUES ($1::uuid, $2, $3) RETURNING id::text AS id",
      created.orderId,
      "Ledger-only supplier",
      "shortlisted",
    );
    const ledgerVendorId = ledgerVendorRows[0]?.id;
    assert(ledgerVendorId);
    await bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id,
        order_id,
        vendor_id,
        provider,
        account_email,
        counterparty_email,
        provider_message_id,
        provider_thread_id,
        rfc_message_id,
        direction,
        from_email,
        from_name,
        to_emails,
        cc_emails,
        subject,
        body_text,
        body_truncated,
        attachments,
        sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com', 'ledger@example.com',
        'gmail-outbound', 'gmail-thread', '<outbound@example.test>', 'OUTBOUND',
        'buyer@example.com', 'Buyer', '["ledger@example.com"]'::jsonb, '[]'::jsonb,
        'RFQ', 'Please quote', false, '[]'::jsonb, '2026-08-21T01:00:00.000Z'
      ), (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com', 'ledger@example.com',
        'gmail-inbound', 'gmail-thread', '<inbound@example.test>', 'INBOUND',
        'ledger@example.com', 'Ledger supplier', '["buyer@example.com"]'::jsonb, '[]'::jsonb,
        'Re: RFQ', 'Quote attached', true, '[{"filename":"quote.pdf","mimeType":"application/pdf"}]'::jsonb,
        '2026-08-21T02:00:00.000Z'
      )
    `, customerA, created.orderId, ledgerVendorId);
    const bourneLedgerRows = await bourne.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*) AS count FROM procurement_communication_messages WHERE customer_id = $1::uuid AND order_id = $2::uuid AND vendor_id = $3::uuid",
      customerA,
      created.orderId,
      ledgerVendorId,
    );
    assert.equal(Number(bourneLedgerRows[0]?.count), 2);
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'other-supplier@example.com', 'invalid-participant', 'OUTBOUND',
        'buyer@example.com', '["ledger@example.com"]'::jsonb, now()
      )
    `, customerA, created.orderId, ledgerVendorId));
    const directionalVendorRows = await owner.$queryRawUnsafe<Array<{ id: string; name: string }>>(`
      INSERT INTO order_vendors (order_id, name, status)
      VALUES
        ($1::uuid, 'Outbound-only supplier', 'shortlisted'),
        ($1::uuid, 'Inbound-only supplier', 'shortlisted')
      RETURNING id::text AS id, name
    `, created.orderId);
    const directionalVendors = new Map(directionalVendorRows.map((vendor) => [vendor.name, vendor.id]));
    const outboundOnlyVendorId = directionalVendors.get("Outbound-only supplier");
    const inboundOnlyVendorId = directionalVendors.get("Inbound-only supplier");
    assert(outboundOnlyVendorId);
    assert(inboundOnlyVendorId);
    await bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, provider_thread_id,
        direction, from_email, to_emails, body_text, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'outbound-only@example.com', 'outbound-only-message', 'outbound-only-thread',
        'OUTBOUND', 'buyer@example.com', '["outbound-only@example.com"]'::jsonb,
        $4, '2026-08-21T03:00:00.000Z'
      )
    `, customerA, created.orderId, outboundOnlyVendorId, "x".repeat(50_001));
    await bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, provider_thread_id,
        direction, from_email, to_emails, body_text, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'inbound-only@example.com', 'inbound-only-message', 'inbound-only-thread',
        'INBOUND', 'inbound-only@example.com', '["buyer@example.com"]'::jsonb,
        'Supplier response', '2026-08-21T04:00:00.000Z'
      )
    `, customerA, created.orderId, inboundOnlyVendorId);
    const canonicalSupplierLinks = await owner.$queryRawUnsafe<Array<{
      supplierCount: bigint;
      companySupplierCount: bigint;
      linkedOrderSupplierCount: bigint;
    }>>(`
      SELECT
        (SELECT count(*) FROM "Supplier" WHERE "officeId" = $2) AS "supplierCount",
        (SELECT count(*) FROM "CompanySupplier" WHERE "companyId" = $3) AS "companySupplierCount",
        (SELECT count(*) FROM "OrderSupplier" WHERE order_id = $1::uuid AND supplier_registry_id IS NOT NULL)
          AS "linkedOrderSupplierCount"
    `, created.orderId, officeId, companyA.id);
    assert.deepEqual(canonicalSupplierLinks.map((row) => ({
      supplierCount: Number(row.supplierCount),
      companySupplierCount: Number(row.companySupplierCount),
      linkedOrderSupplierCount: Number(row.linkedOrderSupplierCount),
    })), [{ supplierCount: 6, companySupplierCount: 6, linkedOrderSupplierCount: 6 }]);
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
    assert.deepEqual(vendorsByName.get("Ledger-only supplier")?.contact, {
      name: null,
      email: "ledger@example.com",
      phone: null,
    });
    assert.equal(vendorsByName.get("Example supplier")?.contacted, true);
    assert.equal(vendorsByName.get("Nested contact supplier")?.contacted, false);
    assert.equal(vendorsByName.get("Ledger-only supplier")?.contacted, true);
    assert.equal(vendorsByName.get("Outbound-only supplier")?.contacted, true);
    assert.equal(vendorsByName.get("Inbound-only supplier")?.contacted, false);
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
    assert.deepEqual(
      await getProcurementVendorConversationRefFromDatabase(
        workflowDatabase,
        customerA,
        created.orderId,
        ledgerVendorId,
      ),
      {
        vendorId: ledgerVendorId,
        vendorName: "Ledger-only supplier",
        contactEmail: "ledger@example.com",
        gmailMessageId: "gmail-outbound",
      },
    );
    const ledgerMessages = await getProcurementCommunicationMessagesFromDatabase(
      workflowDatabase,
      customerA,
      created.orderId,
      ledgerVendorId,
    );
    assert(ledgerMessages);
    assert.deepEqual(ledgerMessages.map(({ id: _id, ...message }) => message), [
      {
        provider: "GMAIL",
        accountEmail: "buyer@example.com",
        providerThreadId: "gmail-thread",
        direction: "OUTBOUND",
        fromEmail: "buyer@example.com",
        fromName: "Buyer",
        toEmails: ["ledger@example.com"],
        ccEmails: [],
        subject: "RFQ",
        bodyText: "Please quote",
        bodyTruncated: false,
        sentAt: "2026-08-21T01:00:00.000Z",
      },
      {
        provider: "GMAIL",
        accountEmail: "buyer@example.com",
        providerThreadId: "gmail-thread",
        direction: "INBOUND",
        fromEmail: "ledger@example.com",
        fromName: "Ledger supplier",
        toEmails: ["buyer@example.com"],
        ccEmails: [],
        subject: "Re: RFQ",
        bodyText: "Quote attached",
        bodyTruncated: true,
        sentAt: "2026-08-21T02:00:00.000Z",
      },
    ]);
    assert.equal(ledgerMessages.every((message) => /^[a-f0-9]{64}$/.test(message.id)), true);
    assert.doesNotMatch(JSON.stringify(ledgerMessages), /gmail-outbound|gmail-inbound/);
    const boundedBodyMessages = await getProcurementCommunicationMessagesFromDatabase(
      workflowDatabase,
      customerA,
      created.orderId,
      outboundOnlyVendorId,
    );
    assert.equal(boundedBodyMessages?.length, 1);
    assert.equal(boundedBodyMessages?.[0]?.bodyText?.length, 50_000);
    assert.equal(boundedBodyMessages?.[0]?.bodyTruncated, true);
    assert.deepEqual(
      await getProcurementCommunicationMessagesFromDatabase(
        workflowDatabase,
        customerB,
        created.orderId,
        ledgerVendorId,
      ),
      [],
      "A foreign customer must not read supplier communication rows.",
    );
    assert.equal("gmail_message_id" in detail, false);
    assert.equal("lease_owner" in detail, false);
    assert.equal("gmail_message_id" in (detail.vendors[0] ?? {}), false);
    const customerAOrders = await listProcurementRequestsFromDatabase(workflowDatabase, customerA);
    assert.equal(customerAOrders.length, 2);
    assert(customerAOrders.some((order) => order.id === created.orderId));
    const listedCreatedOrder = customerAOrders.find((order) => order.id === created.orderId);
    assert.equal(listedCreatedOrder?.supplierCount, 6);
    assert.equal(listedCreatedOrder?.contactedCount, 3);
    assert.equal(listedCreatedOrder?.responseCount, 3);
    assert(!customerAOrders.some((order) => order.id === customerScopedDuplicate.orderId));
    assert.equal(await getProcurementRequestFromDatabase(workflowDatabase, customerB, created.orderId), null);

    const sameCustomerOtherOrders = await owner.$queryRawUnsafe<Array<{ id: string }>>(`
      SELECT id::text AS id
      FROM orders
      WHERE customer_id = $1::uuid
        AND id <> $2::uuid
      ORDER BY id
      LIMIT 1
    `, customerA, created.orderId);
    const sameCustomerOtherOrderId = sameCustomerOtherOrders[0]?.id;
    assert(sameCustomerOtherOrderId);
    const sameCustomerOtherVendorRows = await owner.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO order_vendors (order_id, name, status)
      VALUES ($1::uuid, 'Same-customer other-order supplier', 'shortlisted')
      RETURNING id::text AS id
    `, sameCustomerOtherOrderId);
    const sameCustomerOtherVendorId = sameCustomerOtherVendorRows[0]?.id;
    assert(sameCustomerOtherVendorId);
    const foreignVendorRows = await owner.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO order_vendors (order_id, name, status)
      VALUES ($1::uuid, 'Foreign-customer supplier', 'shortlisted')
      RETURNING id::text AS id
    `, customerScopedDuplicate.orderId);
    const foreignVendorId = foreignVendorRows[0]?.id;
    assert(foreignVendorId);
    assert.deepEqual(
      await getProcurementCommunicationMessagesFromDatabase(
        workflowDatabase,
        customerA,
        created.orderId,
        sameCustomerOtherVendorId,
      ),
      [],
      "A vendor from another order must not read this order's transcript.",
    );
    assert.deepEqual(
      await getProcurementCommunicationMessagesFromDatabase(
        workflowDatabase,
        customerA,
        sameCustomerOtherOrderId,
        ledgerVendorId,
      ),
      [],
      "An order must not read a transcript through a vendor attached elsewhere.",
    );
    assert.deepEqual(
      await getProcurementCommunicationMessagesFromDatabase(
        workflowDatabase,
        customerB,
        customerScopedDuplicate.orderId,
        ledgerVendorId,
      ),
      [],
      "A foreign tenant's valid order must not weaken vendor scoping.",
    );
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'ledger@example.com', 'wrong-customer-message', 'OUTBOUND',
        'buyer@example.com', '["ledger@example.com"]'::jsonb, now()
      )
    `, customerB, created.orderId, ledgerVendorId));
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'other-order@example.com', 'wrong-order-message', 'OUTBOUND',
        'buyer@example.com', '["other-order@example.com"]'::jsonb, now()
      )
    `, customerA, created.orderId, sameCustomerOtherVendorId));
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'foreign@example.com', 'gmail-outbound', 'OUTBOUND',
        'buyer@example.com', '["foreign@example.com"]'::jsonb, now()
      )
    `, customerB, customerScopedDuplicate.orderId, foreignVendorId));
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', E'\tbuyer@example.com\t',
        'ledger@example.com', 'tabbed-account-message', 'OUTBOUND',
        'buyer@example.com', '["ledger@example.com"]'::jsonb, now()
      )
    `, customerA, created.orderId, ledgerVendorId));
    await assert.rejects(() => bourne.$executeRawUnsafe(`
      INSERT INTO procurement_communication_messages (
        customer_id, order_id, vendor_id, provider, account_email,
        counterparty_email, provider_message_id, direction, from_email,
        to_emails, sent_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com',
        'ledger@example.com', E'\nnewline-message\n', 'OUTBOUND',
        'buyer@example.com', '["ledger@example.com"]'::jsonb, now()
      )
    `, customerA, created.orderId, ledgerVendorId));

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
      "INSERT INTO procurement_communication_messages (customer_id, order_id, vendor_id, provider, account_email, counterparty_email, provider_message_id, direction, from_email, to_emails, sent_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'GMAIL', 'buyer@example.com', 'ledger@example.com', 'blocked', 'OUTBOUND', 'buyer@example.com', '[]'::jsonb, now())",
      customerA,
      created.orderId,
      ledgerVendorId,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "UPDATE procurement_communication_messages SET subject = 'Blocked' WHERE customer_id = $1::uuid",
      customerA,
    ));
    await permissionDenied(() => dashboard.$executeRawUnsafe(
      "DELETE FROM procurement_communication_messages WHERE customer_id = $1::uuid",
      customerA,
    ));
    await permissionDenied(() => bourne.$executeRawUnsafe(
      "UPDATE procurement_communication_messages SET subject = 'Blocked' WHERE customer_id = $1::uuid",
      customerA,
    ));
    await permissionDenied(() => bourne.$executeRawUnsafe(
      "DELETE FROM procurement_communication_messages WHERE customer_id = $1::uuid",
      customerA,
    ));
    await permissionDenied(() => bourne.$executeRawUnsafe(
      "TRUNCATE procurement_communication_messages",
    ));
    await permissionDenied(() => app.$queryRawUnsafe(
      "SELECT customer_id FROM procurement_communication_messages LIMIT 1",
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
    await app.office.deleteMany({ where: { id: { in: [officeId, officeBId] } } }).catch(() => undefined);
    await Promise.all([
      app.$disconnect(),
      owner.$disconnect(),
      dashboard.$disconnect(),
      concurrentDashboard.$disconnect(),
      bourne.$disconnect(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
