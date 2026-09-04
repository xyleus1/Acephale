import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  listDueProcurementWakeCandidatesFromDatabase,
  procurementCustomerIdsFromServerMetadata,
  ProcurementWorkflowError,
  reconcileProcurementWorkflowWakes,
} from "../src/lib/procurement-workflow";
import { GET as reconcileRoute } from "../src/app/api/cron/procurement-workflow/route";

const customerA = "11111111-1111-4111-8111-111111111111";
const customerB = "22222222-2222-4222-8222-222222222222";
const orderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orderB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orderC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

assert.deepEqual(
  procurementCustomerIdsFromServerMetadata(JSON.stringify({
    "office-a": customerA,
    "office-a-copy": customerA,
    "office-b": customerB,
  })),
  [customerA, customerB],
);
for (const invalidMapping of ["", "[]", "{}", JSON.stringify({ "office-a": "invalid" })]) {
  assert.throws(
    () => procurementCustomerIdsFromServerMetadata(invalidMapping),
    (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
  );
}

type Candidate = { customerId: string; orderId: string };

class ReconciliationDatabase {
  candidates: Candidate[] = [
    { customerId: customerA, orderId: orderA },
    { customerId: customerA, orderId: orderB },
    { customerId: customerB, orderId: orderC },
  ];
  claimed = new Set([orderC]);
  listValues: unknown[] = [];
  claimValues: unknown[][] = [];

  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    const sql = query.replace(/\s+/g, " ").trim();
    if (sql.includes("FROM procurement_api_idempotency AS claim")) {
      this.listValues = values;
      assert.match(sql, /orders\.status = 'new'/);
      assert.match(sql, /claim\.updated_at <= now\(\) - interval '30 seconds'/);
      return this.candidates.slice(0, Number(values[1])) as T;
    }
    if (sql.includes('SELECT id::text AS "orderId", status FROM orders')) {
      const candidate = this.candidates.find((value) => value.orderId === values[0] && value.customerId === values[1]);
      return (candidate ? [{ orderId: candidate.orderId, status: "new" }] : []) as T;
    }
    throw new Error(`Unexpected reconciliation query: ${sql}`);
  }

  async $executeRawUnsafe(query: string, ...values: unknown[]) {
    const sql = query.replace(/\s+/g, " ").trim();
    assert.match(sql, /^UPDATE procurement_api_idempotency AS claim/);
    assert.match(sql, /orders\.status = 'new'/);
    this.claimValues.push(values);
    const orderId = String(values[1]);
    if (this.claimed.has(orderId)) return 0;
    this.claimed.add(orderId);
    return 1;
  }
}

async function main() {
  const listDatabase = new ReconciliationDatabase();
  const bounded = await listDueProcurementWakeCandidatesFromDatabase(
    listDatabase,
    [customerA, customerA, customerB],
    200,
  );
  assert.equal(bounded.length, 3);
  assert.deepEqual(listDatabase.listValues, [`${customerA},${customerB}`, 25]);
  await assert.rejects(
    listDueProcurementWakeCandidatesFromDatabase(listDatabase, ["invalid"]),
    (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "configuration",
  );

  const database = new ReconciliationDatabase();
  const priorUrl = process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
  const priorSecret = process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
  const priorWorkflowOwner = process.env.PROCUREMENT_WORKFLOW_OWNER;
  process.env.BOURNE_WORKFLOW_WEBHOOK_URL = "https://bourne.example.test/workflow";
  process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = "reconciliation-secret";
  process.env.PROCUREMENT_WORKFLOW_OWNER = "bourne";
  const webhookOrders: string[] = [];
  let activeFetches = 0;
  let maxActiveFetches = 0;
  try {
    const fetchImplementation = (async (_url: string | URL | Request, init?: RequestInit) => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer reconciliation-secret");
      const payload = JSON.parse(String(init?.body)) as { orderId: string; customerId: string; event: string };
      webhookOrders.push(payload.orderId);
      assert.equal(payload.event, "procurement.request.created");
      assert([customerA, customerB].includes(payload.customerId));
      activeFetches -= 1;
      return new Response(null, { status: payload.orderId === orderB ? 503 : 204 });
    }) as typeof fetch;
    const priorWarn = console.warn;
    console.warn = () => undefined;
    try {
      const result = await reconcileProcurementWorkflowWakes({
        database,
        fetchImplementation,
        rawCustomerMapping: JSON.stringify({ "office-a": customerA, "office-b": customerB }),
        limit: 3,
        concurrency: 2,
      });
      assert.deepEqual(result, {
        candidates: 3,
        claimed: 2,
        delivered: 1,
        failed: 1,
        skipped: 1,
      });
    } finally {
      console.warn = priorWarn;
    }
    assert.deepEqual(webhookOrders.sort(), [orderA, orderB].sort());
    assert(maxActiveFetches <= 2);
    assert.equal(database.claimValues.length, 3);
  } finally {
    if (priorUrl === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_URL;
    else process.env.BOURNE_WORKFLOW_WEBHOOK_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET;
    else process.env.BOURNE_WORKFLOW_WEBHOOK_SECRET = priorSecret;
    if (priorWorkflowOwner === undefined) delete process.env.PROCUREMENT_WORKFLOW_OWNER;
    else process.env.PROCUREMENT_WORKFLOW_OWNER = priorWorkflowOwner;
  }

  const defaultOwnerDatabase = {
    async $queryRawUnsafe() {
      throw new Error("default-owner reconciliation must not query");
    },
    async $executeRawUnsafe() {
      throw new Error("default-owner reconciliation must not execute");
    },
  };
  delete process.env.PROCUREMENT_WORKFLOW_OWNER;
  assert.deepEqual(
    await reconcileProcurementWorkflowWakes({ database: defaultOwnerDatabase }),
    { candidates: 0, claimed: 0, delivered: 0, failed: 0, skipped: 0 },
  );
  if (priorWorkflowOwner === undefined) delete process.env.PROCUREMENT_WORKFLOW_OWNER;
  else process.env.PROCUREMENT_WORKFLOW_OWNER = priorWorkflowOwner;

  const priorCronSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const missingSecret = await reconcileRoute(new Request("https://app.derya.ai/api/cron/procurement-workflow"));
  assert.equal(missingSecret.status, 503);
  process.env.CRON_SECRET = "cron-secret";
  const unauthorized = await reconcileRoute(new Request("https://app.derya.ai/api/cron/procurement-workflow", {
    headers: { authorization: "Bearer wrong-secret" },
  }));
  assert.equal(unauthorized.status, 401);
  if (priorCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = priorCronSecret;

  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(
    vercel.crons?.find((cron) => cron.path === "/api/cron/procurement-workflow"),
    { path: "/api/cron/procurement-workflow", schedule: "*/5 * * * *" },
  );
  console.log("Procurement wake reconciliation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
