import assert from "node:assert/strict";
import {
  CUSTOMER_PROCUREMENT_CAMPAIGN,
  customerProcurementMatchesWorkspace,
  customerProcurementRequest,
  type CustomerProcurementListItem,
} from "../src/lib/supply-os/customer-procurement";
import { procurementRequestSchema } from "../src/lib/procurement-contract";

const draft = {
  productName: "Printed Circuit Board Assembly (PCBA)",
  quantity: 100,
  unit: "finished units",
  manufacturer: null,
  partNumber: null,
  specification: "68.4 x 21.6 mm, 4-layer FR-4 S1000H Tg150, turnkey assembly",
  sourceRegion: "Any region",
  deliveryLocation: "Austin, TX, United States",
  needByDate: "2026-09-30",
};

const first = customerProcurementRequest({
  requestId: "request-123",
  requestText: "Source the PCBA and save supplier evidence.",
  draft,
  workspaceId: "workspace-a",
  companyName: "Dreamz",
});
const retry = customerProcurementRequest({
  requestId: "request-123",
  requestText: "Source the PCBA and save supplier evidence.",
  draft,
  workspaceId: "workspace-a",
  companyName: "Dreamz",
});

assert(procurementRequestSchema.safeParse(first).success);
assert.equal(first.idempotencyKey, retry.idempotencyKey, "the same saved request must create at most one order");
assert.equal(first.requestContext.source.campaign, CUSTOMER_PROCUREMENT_CAMPAIGN);
assert.equal(first.requestContext.source.workspace_id, "workspace-a");
assert.equal(first.requestContext.logistics.destination, "Austin, TX, United States");
assert.equal(Object.hasOwn(first, "customerId"), false);
assert.equal(Object.hasOwn(first, "status"), false);
assert.equal(Object.hasOwn(first, "progress"), false);
assert.equal(Object.hasOwn(first, "lease_owner"), false);
assert.equal(Object.hasOwn(first, "quote"), false);

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "researching",
  progress: "Searching",
  neededBy: "2026-09-30",
  quantity: 100,
  unit: "finished units",
  material: "PCBA",
  specification: "4-layer FR-4",
  requestContext: {
    source: {
      campaign: CUSTOMER_PROCUREMENT_CAMPAIGN,
      workspace_id: "workspace-a",
      company_name: "Dreamz",
    },
  },
  updatedAt: "2026-08-18T00:00:00.000Z",
} satisfies CustomerProcurementListItem;

assert.equal(customerProcurementMatchesWorkspace(order, "workspace-a", "Dreamz"), true);
assert.equal(customerProcurementMatchesWorkspace(order, "workspace-b", "Dreamz"), false);
assert.equal(customerProcurementMatchesWorkspace({
  ...order,
  requestContext: { source: { campaign: "GUILD2", workspace_id: "workspace-a" } },
}, "workspace-a", "Dreamz"), false);

console.log("Customer procurement Bourne bridge checks passed.");
