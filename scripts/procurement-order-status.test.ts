import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProcurementOrderStatus,
  nextProcurementOrderStatus,
} from "../src/lib/procurement-order-status";
import { procurementResearchMode } from "../src/lib/procurement-research-mode";

test("nextProcurementOrderStatus advances only along the sourcing ladder", () => {
  assert.equal(nextProcurementOrderStatus("new", "supplier_discovered"), "researching");
  assert.equal(nextProcurementOrderStatus("new", "rfq_sent"), "sourcing");
  assert.equal(nextProcurementOrderStatus("new", "quote_recorded"), "awaiting_order_approval");
  assert.equal(nextProcurementOrderStatus("researching", "supplier_discovered"), null);
  assert.equal(nextProcurementOrderStatus("awaiting_shortlist_approval", "rfq_sent"), "sourcing");
  assert.equal(nextProcurementOrderStatus("sourcing", "supplier_discovered"), null);
  assert.equal(nextProcurementOrderStatus("awaiting_order_approval", "rfq_sent"), null);

  for (const current of ["ordered", "cancelled", "needs_attention", null, ""]) {
    assert.equal(nextProcurementOrderStatus(current, "quote_recorded"), null);
  }
});

test("advanceProcurementOrderStatus calls the tenant scoped SQL boundary", async () => {
  const calls: unknown[][] = [];
  const database = {
    async $queryRawUnsafe<T>(query: string, ...values: unknown[]) {
      calls.push([query, ...values]);
      return [{ status: "sourcing" }] as T;
    },
  };

  assert.equal(
    await advanceProcurementOrderStatus({
      customerId: "customer-id",
      orderId: "order-id",
      event: "rfq_sent",
    }, { database }),
    "sourcing",
  );
  assert.match(String(calls[0]?.[0]), /advance_order_status/);
  assert.deepEqual(calls[0]?.slice(1), [
    "customer-id",
    "order-id",
    "sourcing",
  ]);
});

test("advanceProcurementOrderStatus swallows database failures", async () => {
  const database = {
    async $queryRawUnsafe() {
      throw new Error("database unavailable");
    },
  };
  const priorWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(
      await advanceProcurementOrderStatus({
        customerId: "customer-id",
        orderId: "order-id",
        event: "quote_recorded",
      }, { database }),
      null,
    );
  } finally {
    console.warn = priorWarn;
  }
});

test("procurementResearchMode follows the workflow owner unless explicitly configured", () => {
  const priorMode = process.env.PROCUREMENT_RESEARCH_MODE;
  const priorOwner = process.env.PROCUREMENT_WORKFLOW_OWNER;
  try {
    delete process.env.PROCUREMENT_RESEARCH_MODE;
    delete process.env.PROCUREMENT_WORKFLOW_OWNER;
    assert.equal(procurementResearchMode(), "derya");

    process.env.PROCUREMENT_WORKFLOW_OWNER = "bourne";
    assert.equal(procurementResearchMode(), "bourne");

    process.env.PROCUREMENT_RESEARCH_MODE = "derya";
    assert.equal(procurementResearchMode(), "derya");
  } finally {
    if (priorMode === undefined) delete process.env.PROCUREMENT_RESEARCH_MODE;
    else process.env.PROCUREMENT_RESEARCH_MODE = priorMode;
    if (priorOwner === undefined) delete process.env.PROCUREMENT_WORKFLOW_OWNER;
    else process.env.PROCUREMENT_WORKFLOW_OWNER = priorOwner;
  }
});
