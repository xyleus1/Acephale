import assert from "node:assert/strict";
import {
  handleProcurementReplyDraft,
  type ProcurementReplyDraftDependencies,
} from "../src/lib/procurement-route-handlers";
import { ProcurementReplyDraftError } from "../src/lib/procurement-reply-draft";
import type { ProcurementConversation } from "../src/lib/procurement-conversation-model";
import { ProcurementWorkflowError, type ProcurementOrderDetail } from "../src/lib/procurement-workflow";

const orderId = "11111111-1111-4111-8111-111111111111";
const vendorId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const sourceMessageId = "inbound-message-1";

const order = {
  id: orderId,
  status: "sourcing",
  progress: null,
  neededBy: "2026-10-10",
  quantity: 100,
  unit: "units",
  material: "Printed Circuit Board Assembly (PCBA)",
  specification: "4-layer FR-4",
  requestContext: {},
  approvalRequestedAt: null,
  decisionSnapshot: null,
  vendors: [{
    id: vendorId,
    name: "Bay Area Circuits",
    website: "https://bacircuits.com/",
    contact: { name: null, email: "sfielding@bacircuits.com", phone: null },
    contacted: true,
    responseCount: 1,
    status: "shortlisted",
    research: {},
    quote: null,
  }],
  updatedAt: "2026-08-22T00:00:00.000Z",
} satisfies ProcurementOrderDetail;

const conversation = {
  available: true,
  source: "BOURNE_LEDGER",
  sourceUrl: null,
  accountEmail: "mert@example.com",
  messages: [{
    id: sourceMessageId,
    direction: "INBOUND",
    fromEmail: "sfielding@bacircuits.com",
    fromName: "Spencer Fielding",
    toEmails: ["mert@example.com"],
    ccEmails: [],
    subject: "Re: RFQ",
    body: "Please send the data.",
    sentAt: "2026-08-19T17:15:20.000Z",
    truncated: false,
  }],
  unavailableReason: null,
} satisfies ProcurementConversation;

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://test.local/api/procurement/reply", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<ProcurementReplyDraftDependencies> = {}): ProcurementReplyDraftDependencies {
  return {
    session: async () => ({ userId: "user-a", officeId: "office-a" }),
    resolveCustomerId: async () => customerId,
    getRequest: async () => order,
    conversation: async () => conversation,
    draft: async (input) => ({
      recipient: input.vendor.contact?.email ?? "",
      subject: "Re: RFQ",
      body: "Thanks. We will review the data package.",
      sourceMessageId,
    }),
    ...overrides,
  };
}

async function responseJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

async function main() {
  let resolvedSession = false;
  const anonymous = await handleProcurementReplyDraft(request({ sourceMessageId }), orderId, vendorId, dependencies({
    session: async () => null,
    resolveCustomerId: async () => { resolvedSession = true; return customerId; },
  }));
  assert.equal(anonymous.status, 401);
  assert.equal(resolvedSession, false, "Anonymous requests must stop before customer resolution.");

  const malformed = await handleProcurementReplyDraft(request({ sourceMessageId: "" }), orderId, vendorId, dependencies());
  assert.equal(malformed.status, 400);

  const oversized = await handleProcurementReplyDraft(
    request({ sourceMessageId }, { "content-length": "64001" }),
    orderId,
    vendorId,
    dependencies(),
  );
  assert.equal(oversized.status, 413);

  let draftInput: Parameters<ProcurementReplyDraftDependencies["draft"]>[0] | null = null;
  const success = await handleProcurementReplyDraft(request({ sourceMessageId }), orderId, vendorId, dependencies({
    conversation: async (input) => {
      assert.deepEqual(input, { officeId: "office-a", customerId, orderId, vendorId });
      return conversation;
    },
    draft: async (input) => {
      draftInput = input;
      return {
        recipient: "sfielding@bacircuits.com",
        subject: "Re: RFQ",
        body: "Thanks. We will review the data package.",
        sourceMessageId,
      };
    },
  }));
  assert.equal(success.status, 200);
  assert.equal(draftInput?.expectedSourceMessageId, sourceMessageId);
  assert.equal(((await responseJson(success)).draft as { recipient: string }).recipient, "sfielding@bacircuits.com");

  const missing = await handleProcurementReplyDraft(request({ sourceMessageId }), orderId, vendorId, dependencies({
    getRequest: async () => null,
  }));
  assert.equal(missing.status, 404);

  for (const [error, status] of [
    [new ProcurementReplyDraftError("Stale message.", "conflict"), 409],
    [new ProcurementReplyDraftError("Draft provider unavailable.", "unavailable"), 503],
    [new ProcurementWorkflowError("Forbidden.", "forbidden"), 403],
    [new ProcurementWorkflowError("Workflow unavailable.", "unavailable"), 503],
    [new Error("unexpected"), 500],
  ] as const) {
    const failed = await handleProcurementReplyDraft(request({ sourceMessageId }), orderId, vendorId, dependencies({
      draft: async () => { throw error; },
    }));
    assert.equal(failed.status, status);
  }

  console.log("Procurement reply route behavior passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
