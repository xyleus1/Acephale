import assert from "node:assert/strict";
import {
  boundProcurementConversationMessages,
  mergeDeliveredSupplierReplies,
  mergeProcurementConversationMessages,
  procurementDeliveredReplyCandidates,
  procurementConversationFromLedger,
  procurementConversationFromGmailThread,
  procurementSupplierSenderVouched,
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
    {
      id: "group-participant",
      threadId: "thread-1",
      internalDate: "4000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Colleague <colleague@example.com>" },
          { name: "To", value: "buyer@example.com" },
          { name: "Cc", value: "supplier@example.com" },
          { name: "Subject", value: "Internal follow-up" },
        ],
        body: { data: encoded("This message is not from the supplier.") },
      },
    },
  ],
}, "supplier@example.com", "purchasing@example.com");
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
    providerMessageId: "inbound-provider-1",
    providerThreadId: "thread-1",
    rfcMessageId: "<inbound-1@example.com>",
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
    providerMessageId: "outbound-provider-1",
    providerThreadId: "thread-1",
    rfcMessageId: "<outbound-1@example.com>",
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

const mergedConversation = mergeProcurementConversationMessages([{
  providerMessageId: "provider-outbound-1",
  rfcMessageId: "<outbound-1@example.com>",
  message: {
    ...baseMessage,
    id: "ledger-outbound",
    direction: "OUTBOUND",
    fromEmail: "buyer@example.com",
    toEmails: ["supplier@example.com"],
    subject: "Re: RFQ",
    body: "Confirmed.",
    sentAt: "2026-08-22T18:00:01.000Z",
  },
}], [{
  providerMessageId: "provider-outbound-1",
  rfcMessageId: "<outbound-1@example.com>",
  message: {
    ...baseMessage,
    id: "local-duplicate",
    direction: "OUTBOUND",
    fromEmail: "buyer@example.com",
    toEmails: ["supplier@example.com"],
    subject: "Re: RFQ",
    body: "Confirmed.",
    sentAt: "2026-08-22T18:00:00.000Z",
  },
}, {
  providerMessageId: "provider-inbound-2",
  rfcMessageId: "<inbound-2@example.com>",
  message: {
    ...baseMessage,
    id: "local-new-inbound",
    subject: "Re: RFQ",
    body: "One more question.",
    sentAt: "2026-08-22T18:05:00.000Z",
  },
}]);
assert.deepEqual(mergedConversation.map((message) => message.id), ["ledger-outbound", "local-new-inbound"]);
assert.equal(mergedConversation.at(-1)?.direction, "INBOUND");

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
    providerMessageId: "ledger-provider-1",
    providerThreadId: "provider-thread",
    rfcMessageId: "<ledger-1@example.com>",
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

  {
    // A shop answering from a colleague address is answerable only when the
    // conversation attributes that address to the supplier we mailed.
    const local = {
      available: true,
      source: "DERYA_EMAIL_RECORD" as const,
      sourceUrl: null,
      accountEmail: "desk@derya.ai",
      messages: [],
      unavailableReason: null,
      attributedSenders: ["mluna@mfg-one.com"],
    };
    assert.equal(
      procurementSupplierSenderVouched({
        conversation: local,
        contactEmail: "sales@mfg-one.com",
        senderEmail: "Mluna@MFG-One.com",
      }),
      true,
      "the attributed colleague address can be answered",
    );
    assert.equal(
      procurementSupplierSenderVouched({
        conversation: local,
        contactEmail: "sales@mfg-one.com",
        senderEmail: "sales@mfg-one.com",
      }),
      true,
      "the address we mailed can be answered",
    );
    assert.equal(
      procurementSupplierSenderVouched({
        conversation: local,
        contactEmail: "sales@mfg-one.com",
        senderEmail: "stranger@elsewhere.test",
      }),
      false,
      "an address the thread does not vouch for is never answered",
    );
    assert.equal(
      procurementSupplierSenderVouched({
        conversation: { ...local, attributedSenders: undefined },
        contactEmail: null,
        senderEmail: "mluna@mfg-one.com",
      }),
      false,
      "a source that establishes nothing vouches for nobody",
    );
  }

  {
    const supplierReply: ProcurementConversationMessage = {
      id: "inbound-1",
      direction: "INBOUND",
      fromEmail: "sales@supplier.test",
      fromName: "Supplier",
      toEmails: ["purchasing@example.com"],
      ccEmails: [],
      subject: "Re: RFQ",
      body: "Which finish do you need?",
      sentAt: "2026-08-30T09:00:00.000Z",
      truncated: false,
    };
    const conversation: ProcurementConversation = {
      available: true,
      source: "DERYA_EMAIL_RECORD",
      sourceUrl: null,
      accountEmail: "monica@outreachsavanna.co",
      messages: [supplierReply],
      unavailableReason: null,
    };
    const delivered = procurementDeliveredReplyCandidates([
      {
        id: "task-1",
        input: {
          message: {
            senderEmail: "pooled@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: {
          sentAt: "2026-08-30T10:00:00.000Z",
          rfcMessageId: "<answer-1@derya>",
          providerMessageId: "gmail-1",
        },
      },
      {
        id: "task-incomplete",
        input: { message: { senderEmail: "pooled@outreachsavanna.co", recipient: "sales@supplier.test" } },
        result: { sentAt: "2026-08-30T10:05:00.000Z" },
      },
    ]);
    assert.equal(delivered.length, 1, "a delivery record without the text it carried cannot join a transcript");
    const answered = mergeDeliveredSupplierReplies(conversation, delivered);
    assert.deepEqual(
      answered.messages.map((message) => message.direction),
      ["INBOUND", "OUTBOUND"],
      "an answer delivered from a pooled mailbox must read as answering the supplier thread",
    );
    assert.equal(answered.messages.at(-1)?.fromEmail, "pooled@outreachsavanna.co");

    const onOwnThread: ProcurementConversation = {
      ...conversation,
      messages: [
        supplierReply,
        {
          ...supplierReply,
          id: "outbound-1",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: "2026-08-30T10:00:03.000Z",
        },
      ],
    };
    assert.equal(
      mergeDeliveredSupplierReplies(onOwnThread, delivered).messages.length,
      2,
      "an answer already on the supplier thread must not be listed twice or counted as another chase",
    );
    assert.equal(
      mergeDeliveredSupplierReplies(
        { ...conversation, available: false, messages: [] },
        delivered,
      ).messages.length,
      0,
      "a conversation we cannot read stays unavailable",
    );

    // Every recorded delivery for the supplier is read, so the answer the thread
    // already shows arrives beside the one it does not.
    const repeated = procurementDeliveredReplyCandidates([
      {
        id: "task-1",
        input: {
          message: {
            senderEmail: "pooled@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: {
          sentAt: "2026-08-30T10:00:00.000Z",
          rfcMessageId: "<answer-1@derya>",
          providerMessageId: "gmail-1",
        },
      },
      {
        id: "task-2",
        input: {
          message: {
            senderEmail: "pooled@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: {
          sentAt: "2026-08-31T11:00:00.000Z",
          rfcMessageId: "<answer-2@derya>",
          providerMessageId: "gmail-2",
        },
      },
    ]);
    const askedTwice: ProcurementConversation = {
      ...onOwnThread,
      messages: [
        ...onOwnThread.messages,
        { ...supplierReply, id: "inbound-2", sentAt: "2026-08-31T09:00:00.000Z" },
      ],
    };
    assert.equal(
      mergeDeliveredSupplierReplies(askedTwice, repeated).messages.at(-1)?.direction,
      "OUTBOUND",
      "a supplier who repeats a question and gets the same answer again must read as answered",
    );

    // The same answer twice, twenty minutes apart, with the supplier's repeated
    // question between them: whichever of the two the thread filed, the other
    // one is the addition and neither is listed twice.
    const twiceInAnHour = procurementDeliveredReplyCandidates([
      {
        id: "task-early",
        input: {
          message: {
            senderEmail: "monica@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: {
          sentAt: "2026-08-31T10:00:00.000Z",
          rfcMessageId: "<answer-early@derya>",
          providerMessageId: "gmail-early",
        },
      },
      {
        id: "task-late",
        input: {
          message: {
            senderEmail: "pooled@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: {
          sentAt: "2026-08-31T10:20:00.000Z",
          rfcMessageId: "<answer-late@derya>",
          providerMessageId: "gmail-late",
        },
      },
    ]);
    const askedAgainSoon = (filedAt: string): ProcurementConversation => ({
      ...conversation,
      messages: [
        { ...supplierReply, id: "inbound-early", sentAt: "2026-08-31T09:50:00.000Z" },
        {
          ...supplierReply,
          id: "outbound-filed",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: filedAt,
        },
        { ...supplierReply, id: "inbound-late", sentAt: "2026-08-31T10:10:00.000Z" },
      ],
    });
    const earlyFiled = mergeDeliveredSupplierReplies(
      askedAgainSoon("2026-08-31T10:00:03.000Z"),
      twiceInAnHour,
    );
    assert.deepEqual(
      earlyFiled.messages.map((message) => message.direction),
      ["INBOUND", "OUTBOUND", "INBOUND", "OUTBOUND"],
      "the pooled answer sent after the second question must be the one merged in",
    );
    const lateFiled = mergeDeliveredSupplierReplies(
      askedAgainSoon("2026-08-31T10:20:03.000Z"),
      twiceInAnHour,
    );
    assert.deepEqual(
      lateFiled.messages.map((message) => message.direction),
      ["INBOUND", "OUTBOUND", "INBOUND", "OUTBOUND"],
      "the answer the thread already shows must not be added a second time",
    );
    assert.equal(
      lateFiled.messages.at(1)?.sentAt,
      "2026-08-31T10:00:00.000Z",
      "the missing earlier answer keeps its own place in the transcript",
    );

    // Both answers reached the thread, but the copy nearest the 10:00:10
    // delivery is the only copy the 10:30 delivery could ever stand for, so the
    // nearer pairing has to give it up rather than leave that delivery listed
    // again.
    const overlapping = procurementDeliveredReplyCandidates([
      {
        id: "task-near",
        input: {
          message: {
            senderEmail: "monica@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: { sentAt: "2026-08-31T10:00:10.000Z", rfcMessageId: "<answer-near@derya>" },
      },
      {
        id: "task-far",
        input: {
          message: {
            senderEmail: "monica@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: { sentAt: "2026-08-31T10:30:00.000Z", rfcMessageId: "<answer-far@derya>" },
      },
    ]);
    const bothFiled: ProcurementConversation = {
      ...conversation,
      messages: [
        { ...supplierReply, id: "inbound-first", sentAt: "2026-08-31T09:10:00.000Z" },
        {
          ...supplierReply,
          id: "outbound-early-copy",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: "2026-08-31T09:20:00.000Z",
        },
        {
          ...supplierReply,
          id: "outbound-late-copy",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: "2026-08-31T10:00:00.000Z",
        },
      ],
    };
    assert.equal(
      mergeDeliveredSupplierReplies(bothFiled, overlapping).messages.length,
      bothFiled.messages.length,
      "a delivery that can only stand for one copy must not be listed again for it",
    );

    // A send whose outcome was unknown records the time reconciliation settled
    // it, hours after the provider accepted it, while the copy on the thread
    // keeps the time it was really sent, so only the id they share can pair them.
    const reconciled = procurementDeliveredReplyCandidates([
      {
        id: "task-reconciled",
        input: {
          message: {
            senderEmail: "monica@outreachsavanna.co",
            recipient: "sales@supplier.test",
            subject: "Re: RFQ",
            body: "Anodized, 5,000 pieces, files attached.",
          },
        },
        result: { sentAt: "2026-08-31T16:00:00.000Z", rfcMessageId: "<answer-reconciled@derya>" },
      },
    ]);
    const filedLongBefore: ProcurementConversation = {
      ...conversation,
      messages: [
        { ...supplierReply, id: "inbound-first", sentAt: "2026-08-31T09:10:00.000Z" },
        {
          ...supplierReply,
          id: "outbound-copy",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: "2026-08-31T09:20:00.000Z",
          rfcMessageId: "<answer-reconciled@derya>",
        },
      ],
    };
    assert.equal(
      mergeDeliveredSupplierReplies(filedLongBefore, reconciled).messages.length,
      filedLongBefore.messages.length,
      "a delivery reconciled hours later must not duplicate the answer on the thread",
    );

    // An older answer that happens to read the same way is a different message,
    // so it cannot stand for a delivery the supplier's thread never filed.
    const olderSameText: ProcurementConversation = {
      ...conversation,
      messages: [
        {
          ...supplierReply,
          id: "outbound-old",
          direction: "OUTBOUND",
          fromEmail: "monica@outreachsavanna.co",
          toEmails: ["sales@supplier.test"],
          body: "Anodized, 5,000 pieces, files attached.",
          sentAt: "2026-08-20T08:00:00.000Z",
          rfcMessageId: "<answer-old@derya>",
        },
        { ...supplierReply, id: "inbound-again", sentAt: "2026-08-31T15:00:00.000Z" },
      ],
    };
    assert.equal(
      mergeDeliveredSupplierReplies(olderSameText, reconciled).messages.at(-1)?.direction,
      "OUTBOUND",
      "an older message repeating the text must not hide the answer that was delivered",
    );
  }

  console.log("Procurement conversation normalization, bounds, and source precedence passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
