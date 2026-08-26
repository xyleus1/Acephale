import assert from "node:assert/strict";
import {
  handleProcurementReplyDraft,
  handleProcurementReplySend,
  type ProcurementReplyDraftDependencies,
  type ProcurementReplySendDependencies,
} from "../src/lib/procurement-route-handlers";
import { ProcurementReplyDraftError } from "../src/lib/procurement-reply-draft";
import type { ProcurementConversation } from "../src/lib/procurement-conversation-model";
import { ProcurementWorkflowError, type ProcurementOrderDetail } from "../src/lib/procurement-workflow";
import { SupplyPersistenceError } from "../src/lib/supply-os/persistence";

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
    session: async () => ({ userId: "user-a", officeId: "office-a", role: "ADMIN", canViewWholeOffice: true }),
    resolveCustomerId: async () => customerId,
    getRequest: async () => order,
    conversation: async () => conversation,
    saveFileDraft: async () => { throw new Error("saveFileDraft must not run unless request files were asked for."); },
    draft: async (input) => ({
      recipient: input.vendor.contact?.email ?? "",
      subject: "Re: RFQ",
      body: "Thanks. We will review the data package.",
      sourceMessageId,
    }),
    ...overrides,
  };
}

function sendDependencies(overrides: Partial<ProcurementReplySendDependencies> = {}): ProcurementReplySendDependencies {
  return {
    session: async () => ({ userId: "user-a", officeId: "office-a", role: "ADMIN", canViewWholeOffice: true }),
    resolveCustomerId: async () => customerId,
    getRequest: async () => order,
    conversation: async () => conversation,
    send: async (input) => ({
      state: "SENT",
      accountEmail: input.conversation.accountEmail ?? "mert@example.com",
      recipient: input.input.recipient,
      providerMessageId: "gmail-message-1",
      providerThreadId: "gmail-thread-1",
      sourceUrl: "https://mail.google.com/mail/u/mert@example.com/#sent/gmail-thread-1",
      sentAt: "2026-08-22T12:00:00.000Z",
      alreadySent: false,
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

  let fileDraftInput: Parameters<ProcurementReplyDraftDependencies["saveFileDraft"]>[0] | null = null;
  const fileDraft = await handleProcurementReplyDraft(
    request({ sourceMessageId, withRequestFiles: true }),
    orderId,
    vendorId,
    dependencies({
      draft: async () => { throw new Error("The generated draft path must not run for a file delivery draft."); },
      saveFileDraft: async (input) => {
        fileDraftInput = input;
        return {
          state: "DRAFT",
          orderId,
          vendorId,
          sourceMessageId,
          recipient: "sfielding@bacircuits.com",
          subject: "Re: RFQ",
          body: "The technical package is attached.",
          attachments: [{ documentId: "doc-1", name: "spec.png", mimeType: "image/png", size: 2048 }],
          withheld: [],
          savedAt: "2026-08-25T00:00:00.000Z",
        };
      },
    }),
  );
  assert.equal(fileDraft.status, 200);
  const savedDraft = (await responseJson(fileDraft)).draft as { state: string; attachments: unknown[] };
  assert.equal(savedDraft.state, "DRAFT", "A file delivery draft must be reported as a draft, never as sent.");
  assert.equal(savedDraft.attachments.length, 1);
  assert.equal(fileDraftInput?.sourceMessageId, sourceMessageId);
  assert.equal(fileDraftInput?.recipient, "sfielding@bacircuits.com");
  assert.equal(fileDraftInput?.context.officeId, "office-a");

  const draftScopeFailure = await handleProcurementReplyDraft(
    request({ sourceMessageId, withRequestFiles: true }),
    orderId,
    vendorId,
    dependencies({
      saveFileDraft: async () => { throw new SupplyPersistenceError("No safe files.", "conflict"); },
    }),
  );
  assert.equal(draftScopeFailure.status, 409);

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

  let sendResolvedCustomer = false;
  const anonymousSend = await handleProcurementReplySend(request({
    confirmed: true,
    sourceMessageId,
    recipient: "sfielding@bacircuits.com",
    subject: "Re: RFQ",
    body: "Thank you.",
  }), orderId, vendorId, sendDependencies({
    session: async () => null,
    resolveCustomerId: async () => { sendResolvedCustomer = true; return customerId; },
  }));
  assert.equal(anonymousSend.status, 401);
  assert.equal(sendResolvedCustomer, false, "Anonymous sends must stop before customer resolution.");

  const unconfirmedSend = await handleProcurementReplySend(request({
    confirmed: false,
    sourceMessageId,
    recipient: "sfielding@bacircuits.com",
    subject: "Re: RFQ",
    body: "Thank you.",
  }), orderId, vendorId, sendDependencies());
  assert.equal(unconfirmedSend.status, 400, "Supplier delivery must require an exact confirmation flag.");

  let sendInput: Parameters<ProcurementReplySendDependencies["send"]>[0] | null = null;
  const sent = await handleProcurementReplySend(request({
    confirmed: true,
    sourceMessageId,
    recipient: "sfielding@bacircuits.com",
    subject: "Re: RFQ",
    body: "Thank you.",
  }), orderId, vendorId, sendDependencies({
    conversation: async (input) => {
      assert.deepEqual(input, { officeId: "office-a", customerId, orderId, vendorId });
      return conversation;
    },
    send: async (input) => {
      sendInput = input;
      return {
        state: "SENT",
        accountEmail: "mert@example.com",
        recipient: input.input.recipient,
        providerMessageId: "gmail-message-1",
        providerThreadId: "gmail-thread-1",
        sourceUrl: "https://mail.google.com/mail/u/mert@example.com/#sent/gmail-thread-1",
        sentAt: "2026-08-22T12:00:00.000Z",
        alreadySent: false,
      };
    },
  }));
  assert.equal(sent.status, 200);
  assert.equal(sendInput?.context.officeId, "office-a");
  assert.equal(sendInput?.context.role, "ADMIN");
  assert.equal(sendInput?.input.sourceMessageId, sourceMessageId);
  assert.equal(sendInput?.input.attachmentDocumentIds, undefined);

  let attachedSendInput: Parameters<ProcurementReplySendDependencies["send"]>[0] | null = null;
  const sentWithFiles = await handleProcurementReplySend(request({
    confirmed: true,
    sourceMessageId,
    recipient: "sfielding@bacircuits.com",
    subject: "Re: RFQ",
    body: "The package is attached.",
    attachmentDocumentIds: ["doc-1", "doc-2"],
  }), orderId, vendorId, sendDependencies({
    send: async (input) => {
      attachedSendInput = input;
      return {
        state: "SENT",
        accountEmail: "mert@example.com",
        recipient: input.input.recipient,
        providerMessageId: "gmail-message-2",
        providerThreadId: "gmail-thread-1",
        sourceUrl: "https://mail.google.com/mail/u/mert@example.com/#sent/gmail-thread-1",
        sentAt: "2026-08-22T12:05:00.000Z",
        alreadySent: false,
      };
    },
  }));
  assert.equal(sentWithFiles.status, 200);
  assert.deepEqual(attachedSendInput?.input.attachmentDocumentIds, ["doc-1", "doc-2"]);

  const conflictedSend = await handleProcurementReplySend(request({
    confirmed: true,
    sourceMessageId,
    recipient: "sfielding@bacircuits.com",
    subject: "Re: RFQ",
    body: "Thank you.",
  }), orderId, vendorId, sendDependencies({
    send: async () => { throw new SupplyPersistenceError("Delivery unresolved.", "conflict"); },
  }));
  assert.equal(conflictedSend.status, 409);

  console.log("Procurement reply route behavior passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
