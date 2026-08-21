import assert from "node:assert/strict";
import {
  boundProcurementConversationMessages,
  procurementConversationFromGmailThread,
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
assert.deepEqual(normalized.map((message) => ({ id: message.id, direction: message.direction })), [
  { id: "message-1", direction: "INBOUND" },
  { id: "message-2", direction: "OUTBOUND" },
]);

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

console.log("Procurement conversation normalization and bounds passed.");
