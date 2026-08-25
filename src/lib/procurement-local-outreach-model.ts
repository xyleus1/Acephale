import {
  MAX_PROCUREMENT_CONVERSATION_MESSAGES,
  boundProcurementConversationMessages,
  procurementConversationEmailAddresses,
  type ProcurementConversation,
} from "@/lib/procurement-conversation-model";

export const LOCAL_RFQ_MESSAGE_LIMIT = 4_000;
export const LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER = 1_000;
export const LOCAL_RFQ_BATCH_ORDER_LIMIT = 50;

export type LocalRfqMessage = {
  id: string;
  direction: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  body: string;
  sentAt: string;
  accountEmail: string | null;
  externalThreadId: string | null;
};

export type LocalRfqOutreach = {
  contacted: number;
  responded: number;
  contactedEmails: string[];
  respondedEmails: string[];
};

export function rfqSubjectReferenceToken(orderId: string) {
  return orderId.slice(0, 8).toLowerCase();
}

export function rfqSubjectReference(orderId: string) {
  return `[RFQ ${orderId.slice(0, 8)}]`;
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function recipientEmails(message: LocalRfqMessage) {
  return [...message.toEmails, ...message.ccEmails]
    .flatMap((entry) => procurementConversationEmailAddresses(entry))
    .map((entry) => normalize(entry))
    .filter(Boolean);
}

// The workflow database receipt column is read-only for the dashboard role, so
// supplier contact is also derived from the office's own sent RFQ records.
export function summarizeLocalRfqOutreach(messages: LocalRfqMessage[]): LocalRfqOutreach {
  const contacted = new Set<string>();
  const responded = new Set<string>();
  const accountEmails = new Set(messages.map((message) => normalize(message.accountEmail)).filter(Boolean));
  for (const message of messages) {
    if (message.direction === "OUTBOUND") {
      for (const recipient of recipientEmails(message)) contacted.add(recipient);
      continue;
    }
    const sender = normalize(message.fromEmail);
    if (sender && !accountEmails.has(sender)) responded.add(sender);
  }
  return {
    contacted: contacted.size,
    responded: responded.size,
    contactedEmails: [...contacted],
    respondedEmails: [...responded],
  };
}

export const EMPTY_LOCAL_RFQ_OUTREACH: LocalRfqOutreach = {
  contacted: 0,
  responded: 0,
  contactedEmails: [],
  respondedEmails: [],
};

export function summarizeLocalRfqOutreachByOrder(
  messages: LocalRfqMessage[],
  orderIds: string[],
): Map<string, LocalRfqOutreach> {
  const referenceToOrder = new Map(orderIds.map((orderId) => [
    rfqSubjectReference(orderId).toLowerCase(),
    orderId,
  ]));
  const grouped = new Map<string, LocalRfqMessage[]>();
  for (const message of messages) {
    const subject = normalize(message.subject);
    for (const [reference, orderId] of referenceToOrder) {
      if (!subject.includes(reference)) continue;
      const bucket = grouped.get(orderId);
      if (bucket) bucket.push(message);
      else grouped.set(orderId, [message]);
    }
  }
  return new Map(orderIds.map((orderId) => [
    orderId,
    summarizeLocalRfqOutreach(grouped.get(orderId) ?? []),
  ]));
}

export function overlayRequestOutreach<T extends { contactedCount: number; responseCount: number }>(
  request: T,
  outreach: LocalRfqOutreach,
): T {
  return {
    ...request,
    contactedCount: Math.max(request.contactedCount, outreach.contacted),
    responseCount: Math.max(request.responseCount, outreach.responded),
  };
}

export function overlayVendorOutreach<T extends {
  contacted: boolean;
  responseCount: number;
  contact: { email: string | null } | null;
}>(vendor: T, outreach: LocalRfqOutreach): T {
  const email = normalize(vendor.contact?.email);
  if (!email) return vendor;
  return {
    ...vendor,
    contacted: vendor.contacted || outreach.contactedEmails.includes(email),
    responseCount: Math.max(vendor.responseCount, outreach.respondedEmails.includes(email) ? 1 : 0),
  };
}

export function localRfqConversationFor(
  messages: LocalRfqMessage[],
  contactEmail: string,
): ProcurementConversation | null {
  const contact = normalize(contactEmail);
  if (!contact) return null;
  const related = messages.filter((message) => (
    normalize(message.fromEmail) === contact
    || (message.direction === "OUTBOUND" && recipientEmails(message).includes(contact))
  )).slice(-MAX_PROCUREMENT_CONVERSATION_MESSAGES);
  if (!related.length) return null;
  const accountEmail = related.find((message) => message.accountEmail)?.accountEmail ?? null;
  const externalThreadId = related.find((message) => message.externalThreadId)?.externalThreadId ?? null;
  return {
    available: true,
    source: "DERYA_EMAIL_RECORD",
    sourceUrl: accountEmail && externalThreadId
      ? `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(externalThreadId)}`
      : null,
    accountEmail,
    messages: boundProcurementConversationMessages(related.map((message) => ({
      id: message.id,
      direction: normalize(message.fromEmail) === contact ? "INBOUND" : "OUTBOUND",
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt,
      truncated: false,
    }))),
    unavailableReason: null,
  } satisfies ProcurementConversation;
}
