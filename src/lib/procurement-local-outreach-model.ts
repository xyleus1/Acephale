import {
  MAX_PROCUREMENT_CONVERSATION_MESSAGES,
  boundProcurementConversationMessages,
  procurementConversationEmailAddresses,
  type ProcurementConversation,
} from "@/lib/procurement-conversation-model";
import { supplierBounceText } from "@/lib/procurement-inbound-triage";

export const LOCAL_RFQ_MESSAGE_LIMIT = 4_000;
export const LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER = 1_000;
export const LOCAL_RFQ_BATCH_ORDER_LIMIT = 50;

export type LocalRfqMessage = {
  id: string;
  threadId: string;
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
  deliveryKind?: string | null;
  classification?: string | null;
  rfcMessageId?: string | null;
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

// A delivery notice is the mail system speaking, not the supplier, so it never
// counts as an answer: doing so would both invent a response and cancel the
// follow up that a failed delivery should provoke.
// Bounce wording is read with the same rule inbound triage uses, so a provider
// that reports the failure from its own address is caught either way.
const DELIVERY_SYSTEM_SENDER = /^(mailer-daemon|mail-daemon|postmaster)@/i;

function deliveryNotice(message: LocalRfqMessage) {
  return DELIVERY_SYSTEM_SENDER.test(normalize(message.fromEmail))
    || supplierBounceText(message.subject ?? "", message.body);
}

// Our own mail is not a supplier answering, and a pooled mailbox that has no
// account row still writes its address on everything it sends, so a synced copy
// of our own send cannot be read as a reply.
function ourEmails(messages: LocalRfqMessage[]) {
  return new Set(messages.flatMap((message) => [
    normalize(message.accountEmail),
    message.direction === "OUTBOUND" ? normalize(message.fromEmail) : "",
  ]).filter(Boolean));
}

function contactsByThread(messages: LocalRfqMessage[]) {
  const byThread = new Map<string, Set<string>>();
  for (const message of messages) {
    if (message.direction !== "OUTBOUND") continue;
    const bucket = byThread.get(message.threadId) ?? new Set<string>();
    for (const recipient of recipientEmails(message)) bucket.add(recipient);
    byThread.set(message.threadId, bucket);
  }
  return byThread;
}

// A supplier answers from whatever address its shop uses: a colleague, a
// helpdesk, a ticketing system. The addresses we mailed on that same thread are
// the only claim on such a reply, so it is attributed to the ones sharing the
// sender's domain, or to the single address we mailed there when a forwarder
// answers from elsewhere. A thread we mailed to several unrelated addresses
// attributes nothing, because the reply could belong to any of them.
function attributedContacts(
  message: LocalRfqMessage,
  contacts: Map<string, Set<string>>,
  accountEmails: Set<string>,
): string[] {
  const sender = normalize(message.fromEmail);
  if (!sender || accountEmails.has(sender) || deliveryNotice(message)) return [];
  const onThread = [...(contacts.get(message.threadId) ?? [])]
    .filter((email) => !accountEmails.has(email));
  if (!onThread.length) return [];
  const domain = sender.split("@")[1] ?? "";
  const sameDomain = domain ? onThread.filter((email) => email.endsWith(`@${domain}`)) : [];
  if (sameDomain.length) return sameDomain;
  return onThread.length === 1 ? onThread : [];
}

// The workflow database receipt column is read-only for the dashboard role, so
// supplier contact is also derived from the office's own sent RFQ records.
export function summarizeLocalRfqOutreach(messages: LocalRfqMessage[]): LocalRfqOutreach {
  const contacted = new Set<string>();
  const responded = new Set<string>();
  // One supplier answering from two addresses, or on two threads, is one
  // response, so the count keys on the addresses we mailed rather than on who
  // happened to type the reply.
  const respondents = new Set<string>();
  const accountEmails = ourEmails(messages);
  const contacts = contactsByThread(messages);
  for (const message of messages) {
    if (message.direction === "OUTBOUND") {
      for (const recipient of recipientEmails(message)) contacted.add(recipient);
      continue;
    }
    const sender = normalize(message.fromEmail);
    if (!sender || accountEmails.has(sender) || deliveryNotice(message)) continue;
    // The sender stays in the set as well, so a supplier row recorded under the
    // address that actually wrote to us keeps matching.
    const attributed = attributedContacts(message, contacts, accountEmails);
    for (const email of attributed) responded.add(email);
    responded.add(sender);
    respondents.add(attributed.length ? [...attributed].sort().join(",") : sender);
  }
  return {
    contacted: contacted.size,
    responded: respondents.size,
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

// The one rule that decides which messages on our own threads belong to a
// supplier, so every reader of a local thread, the office RFQ ledger and a
// single anchored thread alike, attributes a colleague or helpdesk reply the
// same way instead of each keeping its own narrower rule.
export type LocalRfqThreadAttribution = {
  relatedIds: Set<string>;
  inboundIds: Set<string>;
  attributedSenders: string[];
};

export function attributeLocalRfqThread(
  messages: readonly LocalRfqMessage[],
  contactEmail: string,
): LocalRfqThreadAttribution {
  const contact = normalize(contactEmail);
  const relatedIds = new Set<string>();
  const inboundIds = new Set<string>();
  const attributedSenders = new Set<string>();
  if (!contact) return { relatedIds, inboundIds, attributedSenders: [] };
  const list = [...messages];
  const accountEmails = ourEmails(list);
  const contacts = contactsByThread(list);
  for (const message of list) {
    if (message.direction === "OUTBOUND") {
      if (recipientEmails(message).includes(contact)) relatedIds.add(message.id);
      continue;
    }
    const sender = normalize(message.fromEmail);
    if (sender === contact) {
      relatedIds.add(message.id);
      inboundIds.add(message.id);
      continue;
    }
    if (!attributedContacts(message, contacts, accountEmails).includes(contact)) continue;
    relatedIds.add(message.id);
    inboundIds.add(message.id);
    attributedSenders.add(sender);
  }
  return { relatedIds, inboundIds, attributedSenders: [...attributedSenders] };
}

export function localRfqConversationFor(
  messages: LocalRfqMessage[],
  contactEmail: string,
): ProcurementConversation | null {
  const contact = normalize(contactEmail);
  if (!contact) return null;
  const attribution = attributeLocalRfqThread(messages, contact);
  const related = messages
    .filter((message) => attribution.relatedIds.has(message.id))
    .slice(-MAX_PROCUREMENT_CONVERSATION_MESSAGES);
  if (!related.length) return null;
  // Answering such a reply means answering the address that wrote it, so the
  // conversation states which senders its own threads attribute to this
  // supplier rather than leaving the send path to guess.
  const attributedSenders = attribution.attributedSenders
    .filter((sender) => related.some((message) => normalize(message.fromEmail) === sender));
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
      direction: attribution.inboundIds.has(message.id) ? "INBOUND" : "OUTBOUND",
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt,
      truncated: false,
      // Only a real RFC id, never an account scoped external id, since a wrong
      // id would read as a different message when deliveries are matched.
      rfcMessageId: message.rfcMessageId ?? null,
    }))),
    unavailableReason: null,
    attributedSenders,
  } satisfies ProcurementConversation;
}
