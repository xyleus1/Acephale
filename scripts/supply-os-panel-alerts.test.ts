import assert from "node:assert/strict";
import type { CustomerProcurementListItem } from "../src/lib/supply-os/customer-procurement";
import { chatPanelAlert, sourcingPanelAlert } from "../src/lib/supply-os/panel-alerts";

function request(overrides: Partial<CustomerProcurementListItem>): CustomerProcurementListItem {
  return {
    id: "order-1",
    material: "Steel coil",
    quantity: 10,
    unit: "tons",
    status: "sourcing",
    neededBy: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    vendorCount: 0,
    contactedCount: 0,
    responseCount: 0,
    quoteCount: 0,
    ...overrides,
  } as CustomerProcurementListItem;
}

assert.equal(chatPanelAlert(null, null), null);

assert.equal(
  chatPanelAlert(
    { lastAgentMessageAt: "2026-08-01T00:00:00.000Z", openQuestions: 0, pendingActions: 0 },
    "2026-08-02T00:00:00.000Z",
  ),
  null,
  "an agent reply older than the last visit is not an alert",
);

assert.deepEqual(
  chatPanelAlert(
    { lastAgentMessageAt: "2026-08-03T00:00:00.000Z", openQuestions: 2, pendingActions: 1 },
    "2026-08-02T00:00:00.000Z",
  ),
  {
    count: 2,
    label: "2 questions waiting on you",
    latestAt: "2026-08-03T00:00:00.000Z",
  },
  "open questions outrank pending actions",
);

assert.deepEqual(
  chatPanelAlert(
    { lastAgentMessageAt: "2026-08-03T00:00:00.000Z", openQuestions: 0, pendingActions: 0 },
    null,
  ),
  {
    count: 1,
    label: "New chat reply",
    latestAt: "2026-08-03T00:00:00.000Z",
  },
);

assert.equal(sourcingPanelAlert([], null), null);

assert.equal(
  sourcingPanelAlert(
    [request({ updatedAt: "2026-08-01T00:00:00.000Z" })],
    "2026-08-02T00:00:00.000Z",
  ),
  null,
  "requests untouched since the last visit are not an alert",
);

assert.deepEqual(
  sourcingPanelAlert(
    [
      request({ id: "a", status: "needs_attention", updatedAt: "2026-08-03T00:00:00.000Z" }),
      request({ id: "b", status: "awaiting_order_approval", updatedAt: "2026-08-04T00:00:00.000Z" }),
    ],
    "2026-08-02T00:00:00.000Z",
  ),
  {
    count: 1,
    label: "1 sourcing request needs attention",
    latestAt: "2026-08-04T00:00:00.000Z",
  },
  "blocked requests outrank approvals and carry the newest timestamp",
);

assert.deepEqual(
  sourcingPanelAlert(
    [request({ status: "sourcing", responseCount: 3, updatedAt: "2026-08-05T00:00:00.000Z" })],
    "2026-08-02T00:00:00.000Z",
  ),
  {
    count: 1,
    label: "1 sourcing request with supplier replies",
    latestAt: "2026-08-05T00:00:00.000Z",
  },
);

console.log("Supply OS panel alert contract passed.");
