import assert from "node:assert/strict";
import {
  draftProcurementSupplierReply,
  ProcurementReplyDraftError,
} from "../src/lib/procurement-reply-draft";
import type { ProcurementConversation } from "../src/lib/procurement-conversation-model";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "sourcing",
  progress: null,
  neededBy: "2026-10-10",
  quantity: 100,
  unit: "finished units",
  material: "Printed Circuit Board Assembly (PCBA)",
  specification: "4-layer FR-4, 1.0 mm, black solder mask, white silkscreen",
  requestContext: {},
  approvalRequestedAt: null,
  decisionSnapshot: null,
  vendors: [],
  updatedAt: "2026-08-22T00:00:00.000Z",
} satisfies ProcurementOrderDetail;

const vendor = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Bay Area Circuits",
  website: "https://bacircuits.com/",
  contact: { name: null, email: "support@bacircuits.com", phone: null },
  contacted: true,
  responseCount: 1,
  status: "shortlisted",
  research: {},
  quote: null,
} satisfies ProcurementOrderVendor;

const conversation = {
  available: true,
  source: "BOURNE_LEDGER",
  sourceUrl: "https://mail.google.com/",
  accountEmail: "mert@example.com",
  unavailableReason: null,
  messages: [
    {
      id: "outbound-1",
      direction: "OUTBOUND",
      fromEmail: "mert@example.com",
      fromName: "Mert",
      toEmails: ["support@bacircuits.com"],
      ccEmails: [],
      subject: "[RFQ 24cb31bd] Turnkey 4-layer PCBA",
      body: "Please quote 100 finished units. Technical files will follow after initial capability confirmation.",
      sentAt: "2026-08-19T09:04:33.000Z",
      truncated: false,
    },
    {
      id: "inbound-1",
      direction: "INBOUND",
      fromEmail: "sfielding@bacircuits.com",
      fromName: "Spencer Fielding",
      toEmails: ["mert@example.com"],
      ccEmails: [],
      subject: "Re: [RFQ 24cb31bd] Turnkey 4-layer PCBA",
      body: "Please send me the data, and I can work on your quote.",
      sentAt: "2026-08-19T17:15:20.000Z",
      truncated: false,
    },
  ],
} satisfies ProcurementConversation;

async function main() {
  let capturedSystem = "";
  let capturedPrompt = "";
  const draft = await draftProcurementSupplierReply({
    order,
    vendor,
    conversation,
    generateText: async ({ system, prompt }) => {
      capturedSystem = system;
      capturedPrompt = prompt;
      return "Hi Spencer,\n\nThank you. As noted in the request, we will provide the technical data after initial capability confirmation. Please first confirm support for the stated board and turnkey requirements.\n\nBest,\nMert\nDerya Supply Chain";
    },
  });

  assert.deepEqual(draft, {
    recipient: "sfielding@bacircuits.com",
    subject: "Re: [RFQ 24cb31bd] Turnkey 4-layer PCBA",
    body: "Hi Spencer,\n\nThank you. As noted in the request, we will provide the technical data after initial capability confirmation. Please first confirm support for the stated board and turnkey requirements.\n\nBest,\nMert\nDerya Supply Chain",
    sourceMessageId: "inbound-1",
  });
  assert.match(capturedSystem, /Do not claim that files are attached, sent, available, reviewed, or approved/);
  assert.match(capturedSystem, /preserve any file-sharing condition or sequence/);
  assert.match(capturedSystem, /Do not invent internal review, approval, readiness, availability, or timing/);
  assert.doesNotMatch(capturedSystem, /say they are under internal review/);
  assert.match(capturedSystem, /Do not accept commercial terms/);
  assert.match(capturedPrompt, /Quantity: 100 finished units/);
  assert.match(capturedPrompt, /Please send me the data/);
  assert.doesNotMatch(draft.body, /\u2014/);

  const prefixed = await draftProcurementSupplierReply({
    order,
    vendor,
    conversation: {
      ...conversation,
      messages: conversation.messages.map((message) => message.direction === "INBOUND"
        ? { ...message, subject: "Technical data request" }
        : message),
    },
    generateText: async () => "Thank you.\n\nBest,\nMert\nDerya Supply Chain",
  });
  assert.equal(prefixed.subject, "Re: Technical data request");

  const helpdeskPrefixed = await draftProcurementSupplierReply({
    order,
    vendor,
    conversation: {
      ...conversation,
      messages: conversation.messages.map((message) => message.direction === "INBOUND"
        ? { ...message, subject: "[Bay Area Circuits] Re: Re: [RFQ 24cb31bd] Turnkey 4-layer PCBA \u2014 100 finished units" }
        : message),
    },
    generateText: async () => "Thank you.\n\nBest,\nMert\nDerya Supply Chain",
  });
  assert.equal(helpdeskPrefixed.subject, "Re: [RFQ 24cb31bd] Turnkey 4-layer PCBA - 100 finished units");
  assert.doesNotMatch(helpdeskPrefixed.subject, /\u2014/);
  await assert.rejects(
    draftProcurementSupplierReply({
      order,
      vendor,
      conversation,
      expectedSourceMessageId: "older-inbound",
      generateText: async () => "unused",
    }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "conflict" && /newer supplier message/i.test(error.message),
  );

  const compatibilityConversation = {
    ...conversation,
    source: "DERYA_EMAIL_RECORD" as const,
    messages: [
      ...conversation.messages,
      {
        ...conversation.messages[1],
        id: "unrelated-inbound",
        fromEmail: "colleague@example.com",
        sentAt: "2026-08-19T18:15:20.000Z",
      },
    ],
  };
  const compatibilityDraft = await draftProcurementSupplierReply({
    order,
    vendor: { ...vendor, contact: { ...vendor.contact, email: "sfielding@bacircuits.com" } },
    conversation: compatibilityConversation,
    generateText: async () => "Thank you.\n\nBest,\nMert\nDerya Supply Chain",
  });
  assert.equal(compatibilityDraft.sourceMessageId, "inbound-1", "Compatibility drafts must ignore inbound senders that do not match the supplier contact.");
  await assert.rejects(
    draftProcurementSupplierReply({
      order,
      vendor: { ...vendor, contact: null },
      conversation: compatibilityConversation,
      generateText: async () => "unused",
    }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "conflict" && /sender could not be verified/i.test(error.message),
  );

  const boundedDraft = await draftProcurementSupplierReply({
    order,
    vendor,
    conversation,
    generateText: async () => `\`\`\`text\n${Array.from({ length: 200 }, (_, index) => `word${index + 1}`).join(" ")}\n\`\`\``,
  });
  assert.equal(boundedDraft.body.split(/\s+/).length, 160);
  assert.doesNotMatch(boundedDraft.body, /```/);

  await assert.rejects(
    draftProcurementSupplierReply({
      order,
      vendor,
      conversation: { ...conversation, messages: conversation.messages.slice(0, 1) },
      generateText: async () => "unused",
    }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "conflict",
  );
  await assert.rejects(
    draftProcurementSupplierReply({
      order,
      vendor,
      conversation,
      generateText: async () => "",
    }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "unavailable",
  );
  const savedApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    draftProcurementSupplierReply({ order, vendor, conversation }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "configuration",
  );
  if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedApiKey;
  await assert.rejects(
    draftProcurementSupplierReply({
      order,
      vendor,
      conversation,
      generateText: async () => { throw new Error("provider unavailable"); },
    }),
    (error: unknown) => error instanceof ProcurementReplyDraftError && error.code === "unavailable",
  );

  console.log("Procurement supplier reply draft contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
