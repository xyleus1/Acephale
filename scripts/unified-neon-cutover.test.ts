import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "../src/lib/password";
import { handleProcurementPost } from "../src/lib/procurement-route-handlers";
import {
  ProcurementDatabase,
  resolveProcurementCustomerId,
  submitProcurementRequest,
} from "../src/lib/procurement-workflow";

const prisma = new PrismaClient();

async function main() {
  const expectedPassword = process.env.UNIFIED_NEON_TEST_PASSWORD;
  const customerId = process.env.UNIFIED_NEON_TEST_CUSTOMER_ID;
  const workflowDatabaseUrl = process.env.WORKFLOW_DATABASE_TEST_URL;
  assert.ok(expectedPassword, "UNIFIED_NEON_TEST_PASSWORD is required");
  assert.ok(customerId, "UNIFIED_NEON_TEST_CUSTOMER_ID is required");
  assert.ok(workflowDatabaseUrl, "WORKFLOW_DATABASE_TEST_URL is required");

  const user = await prisma.user.findFirstOrThrow({
    where: { email: "mert@usederya.com" },
    include: {
      office: true,
      supplyWorkspaceMembers: {
        include: { workspace: { include: { company: true } } },
      },
    },
  });

  assert.equal(user.office.name, "Dreamz");
  assert.equal(user.role, "ADMIN");
  assert.equal(user.isActive, true);
  assert.equal(user.canViewWholeOffice, true);
  assert.equal(await verifyPassword(expectedPassword, user.passwordHash), true);
  assert.equal(user.supplyWorkspaceMembers.length, 1);

  const membership = user.supplyWorkspaceMembers[0];
  assert.ok(membership);
  assert.equal(membership.role, "OWNER");
  assert.equal(membership.isActive, true);
  assert.equal(membership.officeId, user.officeId);
  assert.equal(membership.workspace.officeId, user.officeId);
  assert.equal(membership.workspace.company.officeId, user.officeId);
  assert.equal(membership.workspace.name, "Dreamz");
  assert.equal(membership.workspace.status, "ACTIVE");
  assert.equal(membership.workspace.archivedAt, null);

  process.env.PROCUREMENT_CUSTOMER_MAP_JSON = JSON.stringify({
    [user.officeId]: customerId,
  });
  process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
  process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "test-webhook-secret";

  const workflowPrisma = new PrismaClient({ datasourceUrl: workflowDatabaseUrl });
  let webhookCount = 0;
  try {
    const dependencies = {
      session: async () => ({ userId: user.id, officeId: user.officeId }),
      resolveCustomerId: resolveProcurementCustomerId,
      submit: (resolvedCustomerId: string, request: Parameters<typeof submitProcurementRequest>[1]) => (
        submitProcurementRequest(resolvedCustomerId, request, {
          database: workflowPrisma as unknown as ProcurementDatabase,
          fetchImplementation: (async () => {
            webhookCount += 1;
            return new Response(null, { status: 204 });
          }) as typeof fetch,
        })
      ),
    };
    const body = {
      bomId: null,
      material: "Unified Neon login test material",
      specification: "Authenticated Office mapping contract",
      quantity: 1,
      unit: "unit",
      neededBy: "2026-09-30",
      requestContext: { schema_version: 1, source: { campaign: "UNIFIED_NEON_TEST" } },
      idempotencyKey: "unified-neon-authenticated-request",
    };
    const request = () => new Request("http://preview.test/api/procurement/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const created = await handleProcurementPost(request(), dependencies);
    assert.equal(created.status, 201);
    const createdPayload = await created.json() as { orderId: string };
    const rows = await workflowPrisma.$queryRawUnsafe<Array<{ customerId: string }>>(
      'SELECT customer_id::text AS "customerId" FROM orders WHERE id = $1::uuid',
      createdPayload.orderId,
    );
    assert.equal(rows[0]?.customerId, customerId);

    const duplicate = await handleProcurementPost(request(), dependencies);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { orderId: string }).orderId, createdPayload.orderId);
    assert.equal(webhookCount, 1);
  } finally {
    await workflowPrisma.$disconnect();
  }

  console.log("unified Neon login, Office mapping, and request test passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
