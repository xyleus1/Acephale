import assert from "node:assert/strict";
import {
  boundProcurementConversationMessages,
  procurementConversationFromLedger,
  procurementConversationFromGmailThread,
  resolveProcurementVendorConversation,
  type ProcurementLedgerConversationMessage,
  type ProcurementConversationMessage,
} from "../src/lib/procurement-conversation-model";

function encoded(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function gmailMessage(index: number, contact = "supplier@example.com") {
  const inbound = index % 2 === 1;
  return {
    id: `message-${index}`,
    threadId: "thread-1",
    internalDate: String(index * 1_000),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: inbound ? `Supplier <${contact}>` : "Derya alias <purchasing@example.com>" },
        { name: "To", value: inbound ? "buyer@example.com" : contact },
        { name: "Subject", value: `Message ${index}` },
      ],
      body: { data: encoded(`Body ${index}`) },
    },
  };
}

const normalized = procurementConversationFromGmailThread({
  id: "thread-1",
  messages: [
    gmailMessage(2),
    gmailMessage(1),
    gmailMessage(3, "different@example.com"),
  ],
}, "supplier@example.com");
assert.deepEqual(normalized.map((message) => message.direction), ["INBOUND", "OUTBOUND"]);
assert.equal(normalized.every((message) => /^[a-f0-9]{64}$/.test(message.id)), true);
assert.equal(normalized.some((message) => message.id === "message-1" || message.id === "message-2"), false);

const baseMessage: Omit<ProcurementConversationMessage, "id" | "body" | "sentAt"> = {
  direction: "INBOUND",
  fromEmail: "supplier@example.com",
  fromName: "Supplier",
  toEmails: ["buyer@example.com"],
  ccEmails: [],
  subject: "Quote",
  truncated: false,
};
const longConversation = Array.from({ length: 110 }, (_, index) => ({
  ...baseMessage,
  id: `bounded-${index + 1}`,
  body: "x".repeat(50_001),
  sentAt: new Date(index * 1_000).toISOString(),
}));
const bounded = boundProcurementConversationMessages(longConversation);
assert.equal(bounded.length, 8, "The total transcript body must remain under 400,000 characters.");
assert.equal(bounded[0]?.id, "bounded-103", "When bounded, the transcript must retain the newest messages.");
assert.equal(bounded.at(-1)?.id, "bounded-110");
assert.equal(bounded.every((message) => message.body.length === 50_000 && message.truncated), true);

const ledgerConversation = procurementConversationFromLedger([
  {
    id: "opaque-inbound",
    provider: "GMAIL",
    accountEmail: "purchasing@example.com",
    providerThreadId: "thread-1",
    direction: "INBOUND",
    fromEmail: "supplier@example.com",
    fromName: "Supplier",
    toEmails: ["purchasing@example.com"],
    ccEmails: [],
    subject: "Re: RFQ",
    bodyText: "Quote attached",
    bodyTruncated: false,
    sentAt: "2026-08-21T02:00:00.000Z",
  },
  {
    id: "opaque-outbound",
    provider: "GMAIL",
    accountEmail: "purchasing@example.com",
    providerThreadId: "thread-1",
    direction: "OUTBOUND",
    fromEmail: "purchasing@example.com",
    fromName: "Derya",
    toEmails: ["supplier@example.com"],
    ccEmails: [],
    subject: "RFQ",
    bodyText: "Please quote",
    bodyTruncated: true,
    sentAt: "2026-08-21T01:00:00.000Z",
  },
]);
assert.deepEqual(ledgerConversation.map((message) => ({
  id: message.id,
  direction: message.direction,
  truncated: message.truncated,
})), [
  { id: "opaque-outbound", direction: "OUTBOUND", truncated: true },
  { id: "opaque-inbound", direction: "INBOUND", truncated: false },
]);

async function main() {
  const args = {
    officeId: "office-a",
    customerId: "11111111-1111-4111-8111-111111111111",
    orderId: "22222222-2222-4222-8222-222222222222",
    vendorId: "33333333-3333-4333-8333-333333333333",
  };
  const ledgerMessages: ProcurementLedgerConversationMessage[] = [{
    id: "0".repeat(64),
    provider: "GMAIL",
    accountEmail: "buyer@example.com",
    providerThreadId: "provider-thread",
    direction: "OUTBOUND",
    fromEmail: "buyer@example.com",
    fromName: "Buyer",
    toEmails: ["supplier@example.com"],
    ccEmails: [],
    subject: "RFQ",
    bodyText: "Please quote",
    bodyTruncated: false,
    sentAt: "2026-08-21T01:00:00.000Z",
  }];
  let referenceCalls = 0;
  let compatibilityCalls = 0;
  const fromLedger = await resolveProcurementVendorConversation(args, {
    communicationMessages: async () => ledgerMessages,
    conversationReference: async () => {
      referenceCalls += 1;
      return null;
    },
    compatibilityConversation: async () => {
      compatibilityCalls += 1;
      throw new Error("Compatibility fallback must not run when the ledger has messages.");
    },
  });
  assert.equal(fromLedger.source, "BOURNE_LEDGER");
  assert.equal(fromLedger.messages[0]?.id, "0".repeat(64));
  assert.equal(referenceCalls, 0, "A populated ledger must avoid the compatibility lookup.");
  assert.equal(compatibilityCalls, 0, "A populated ledger must avoid Gmail and local fallbacks.");

  const fallbackConversation = {
    available: true,
    source: "DERYA_EMAIL_RECORD" as const,
    sourceUrl: null,
    accountEmail: "buyer@example.com",
    messages: [],
    unavailableReason: null,
  };
  for (const emptyLedger of [null, []] as const) {
    referenceCalls = 0;
    compatibilityCalls = 0;
    const fallback = await resolveProcurementVendorConversation(args, {
      communicationMessages: async () => emptyLedger,
      conversationReference: async () => {
        referenceCalls += 1;
        return {
          vendorId: args.vendorId,
          vendorName: "Supplier",
          contactEmail: "supplier@example.com",
          gmailMessageId: "gmail-anchor",
        };
      },
      compatibilityConversation: async () => {
        compatibilityCalls += 1;
        return fallbackConversation;
      },
    });
    assert.deepEqual(fallback, fallbackConversation);
    assert.equal(referenceCalls, 1);
    assert.equal(compatibilityCalls, 1);
  }

  console.log("Procurement conversation normalization, bounds, and source precedence passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
