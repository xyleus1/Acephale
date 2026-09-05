import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProcurementOrderStatus,
  nextProcurementOrderStatus,
  procurementOrderProgressEventForFacts,
  reconcileProcurementOrderStatus,
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

test("procurementOrderProgressEventForFacts chooses the furthest persisted fact", () => {
  assert.equal(
    procurementOrderProgressEventForFacts({ vendors: 1, companies: 1, contacted: 1, quoted: 1 }),
    "quote_recorded",
  );
  assert.equal(
    procurementOrderProgressEventForFacts({ vendors: 1, companies: 1, contacted: 1, quoted: 0 }),
    "rfq_sent",
  );
  assert.equal(
    procurementOrderProgressEventForFacts({ vendors: 1, companies: 1, contacted: 0, quoted: 0 }),
    "supplier_discovered",
  );
  assert.equal(
    procurementOrderProgressEventForFacts({ vendors: 0, companies: 0, contacted: 0, quoted: 0 }),
    null,
  );
});

test("reconcileProcurementOrderStatus advances once from persisted facts", async () => {
  for (const [facts, event] of [
    [{ vendors: 1, companies: 1, contacted: 0, quoted: 0 }, "supplier_discovered"],
    [{ vendors: 1, companies: 1, contacted: 1, quoted: 0 }, "rfq_sent"],
    [{ vendors: 1, companies: 1, contacted: 1, quoted: 1 }, "quote_recorded"],
    [{ vendors: 0, companies: 0, contacted: 0, quoted: 0 }, null],
  ] as const) {
    const calls: unknown[] = [];
    const database = {
      async $queryRawUnsafe<T>(_query: string, ...values: unknown[]) {
        calls.push(values);
        return [facts] as T;
      },
    };
    const advances: unknown[] = [];
    const result = await reconcileProcurementOrderStatus({
      customerId: "customer-id",
      orderId: "order-id",
      officeId: "office-id",
    }, {
      database,
      countRecordedSends: async () => 0,
      advance: async (args) => {
        advances.push(args);
        return "sourcing";
      },
    });
    assert.deepEqual(calls, [["order-id"]]);
    assert.equal(result, event === null ? null : "sourcing");
    assert.deepEqual(
      advances,
      event === null
        ? []
        : [{
          customerId: "customer-id",
          orderId: "order-id",
          event,
        }],
    );
  }
});

test("reconcileProcurementOrderStatus uses recorded send reservations as contact evidence", async () => {
  const advances: unknown[] = [];
  const result = await reconcileProcurementOrderStatus({
    customerId: "customer-id",
    orderId: "order-id",
    officeId: "office-id",
  }, {
    database: {
      async $queryRawUnsafe() {
        return [{ vendors: 1, companies: 1, contacted: 0, quoted: 0 }];
      },
    },
    countRecordedSends: async (officeId, orderId) => {
      assert.equal(officeId, "office-id");
      assert.equal(orderId, "order-id");
      return 1;
    },
    advance: async (args) => {
      advances.push(args);
      return "sourcing";
    },
  });
  assert.equal(result, "sourcing");
  assert.deepEqual(advances, [{
    customerId: "customer-id",
    orderId: "order-id",
    event: "rfq_sent",
  }]);
});

test("reconcileProcurementOrderStatus swallows database failures", async () => {
  const priorWarn = console.warn;
  console.warn = () => undefined;
  try {
    const database = {
      async $queryRawUnsafe() {
        throw new Error("database unavailable");
      },
    };
    assert.equal(
      await reconcileProcurementOrderStatus({
        customerId: "customer-id",
        orderId: "order-id",
        officeId: "office-id",
      }, { database }),
      null,
    );
  } finally {
    console.warn = priorWarn;
  }
});

test("reconcileProcurementOrderStatus swallows recorded reservation failures", async () => {
  const priorWarn = console.warn;
  console.warn = () => undefined;
  try {
    const advances: unknown[] = [];
    assert.equal(
      await reconcileProcurementOrderStatus({
        customerId: "customer-id",
        orderId: "order-id",
        officeId: "office-id",
      }, {
        database: {
          async $queryRawUnsafe() {
            return [{ vendors: 1, companies: 1, contacted: 0, quoted: 0 }];
          },
        },
        countRecordedSends: async () => {
          throw new Error("app database unavailable");
        },
        advance: async (args) => {
          advances.push(args);
          return "sourcing";
        },
      }),
      null,
    );
    assert.deepEqual(advances, []);
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
