import { createHash } from "node:crypto";

export const MAX_PROCUREMENT_CONVERSATION_MESSAGES = 100;
export const MAX_PROCUREMENT_CONVERSATION_MESSAGE_BODY = 50_000;
export const MAX_PROCUREMENT_CONVERSATION_BODY = 400_000;
// How far a filed copy of an answer may sit from the delivery record that sent
// it when neither side names the message id they share.
const DELIVERED_REPLY_FILING_WINDOW_MS = 60 * 60 * 1_000;

type GmailPayload = {
  headers?: Array<{ name: string; value: string }>;
  parts?: GmailPayload[];
  body?: { data?: string; size?: number };
  mimeType?: string;
};

export type GmailConversationMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPayload;
};

export type GmailConversationThread = {
  id: string;
  messages?: GmailConversationMessage[];
};

export type ProcurementConversationMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  body: string;
  sentAt: string;
  truncated: boolean;
  // The RFC id the message was sent under, kept so an answer already on the
  // thread can be told from one only a delivery record holds. Provider ids stay
  // out of a transcript, which is why this is the only id carried here.
  rfcMessageId?: string | null;
};

export type ProcurementLedgerConversationMessage = {
  id: string;
  provider: string;
  accountEmail: string;
  providerMessageId: string;
  providerThreadId: string | null;
  rfcMessageId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyTruncated: boolean;
  sentAt: string;
};

export type ProcurementConversation = {
  available: boolean;
  source: "BOURNE_LEDGER" | "CONNECTED_GMAIL" | "DERYA_EMAIL_RECORD" | "NONE";
  sourceUrl: string | null;
  accountEmail: string | null;
  messages: ProcurementConversationMessage[];
  unavailableReason: string | null;
  // Addresses the thread itself vouches for: a colleague, helpdesk, or
  // ticketing sender that answered on a thread where we mailed the supplier's
  // recorded address. Left absent by sources that cannot establish it.
  attributedSenders?: string[];
};

// A reply is answerable when the supplier's own recorded address wrote it, or
// when the conversation attributes the sender to that address from the outbound
// mail on its own thread. Operator input never widens this: the attribution is
// derived from what we sent, so a stranger on the thread stays unanswerable.
export function procurementSupplierSenderVouched(args: {
  conversation: ProcurementConversation;
  contactEmail: string | null;
  senderEmail: string;
}) {
  const sender = args.senderEmail.trim().toLowerCase();
  if (!sender) return false;
  if (args.conversation.source === "BOURNE_LEDGER") return true;
  const expected = args.contactEmail?.trim().toLowerCase() ?? "";
  if (expected && sender === expected) return true;
  return (args.conversation.attributedSenders ?? [])
    .some((email) => email.trim().toLowerCase() === sender);
}

export type ProcurementConversationMergeCandidate = {
  message: ProcurementConversationMessage;
  providerMessageId?: string | null;
  rfcMessageId?: string | null;
};

export type ProcurementVendorConversationArgs = {
  officeId: string;
  customerId: string;
  orderId: string;
  vendorId: string;
};

type ProcurementVendorConversationResolver<TReference> = {
  communicationMessages: (
    customerId: string,
    orderId: string,
    vendorId: string,
  ) => Promise<ProcurementLedgerConversationMessage[] | null>;
  conversationReference: (
    customerId: string,
    orderId: string,
    vendorId: string,
  ) => Promise<TReference | null>;
  compatibilityConversation: (
    args: ProcurementVendorConversationArgs,
    reference: TReference,
  ) => Promise<ProcurementConversation>;
};

function header(payload: GmailPayload | undefined, name: string) {
  return payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function mergeContentIdentity(message: ProcurementConversationMessage) {
  return [
    message.direction,
    message.fromEmail.trim().toLowerCase(),
    message.subject ?? "",
    message.body,
    message.sentAt,
  ].join("\u0000");
}

function mergeExternalIdentities(candidate: ProcurementConversationMergeCandidate) {
  return [
    candidate.providerMessageId ? `provider:${candidate.providerMessageId}` : null,
    candidate.rfcMessageId ? `rfc:${candidate.rfcMessageId}` : null,
  ].filter((value): value is string => Boolean(value));
}

export function mergeProcurementConversationMessages(
  primary: ProcurementConversationMergeCandidate[],
  additions: ProcurementConversationMergeCandidate[],
) {
  const external = new Set(primary.flatMap(mergeExternalIdentities));
  const content = new Set(primary.map((candidate) => mergeContentIdentity(candidate.message)));
  const merged = [...primary];
  for (const candidate of additions) {
    const externalKeys = mergeExternalIdentities(candidate);
    const contentKey = mergeContentIdentity(candidate.message);
    if (externalKeys.some((key) => external.has(key)) || content.has(contentKey)) continue;
    merged.push(candidate);
    externalKeys.forEach((key) => external.add(key));
    content.add(contentKey);
  }
  return boundProcurementConversationMessages(merged
    .map((candidate) => candidate.message)
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.id.localeCompare(right.id)));
}

function plainBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const body = plainBody(part);
    if (body) return body;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return "";
}

export function procurementConversationEmailAddresses(value: string | null) {
  if (!value) return [];
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0].toLowerCase());
}

function displayName(value: string | null) {
  if (!value || !value.includes("<")) return null;
  const name = value.split("<")[0]?.trim().replace(/^"|"$/g, "");
  return name || null;
}

function gmailMessageTime(message: GmailConversationMessage) {
  const date = header(message.payload, "Date");
  const parsedHeader = date ? new Date(date) : null;
  if (parsedHeader && !Number.isNaN(parsedHeader.valueOf())) return parsedHeader.toISOString();
  const parsedInternal = message.internalDate ? new Date(Number(message.internalDate)) : null;
  return parsedInternal && !Number.isNaN(parsedInternal.valueOf())
    ? parsedInternal.toISOString()
    : new Date(0).toISOString();
}

function opaqueGmailMessageId(providerMessageId: string) {
  return createHash("sha256")
    .update(`gmail\u0000${providerMessageId}`)
    .digest("hex");
}

export function procurementConversationParticipantEmails(message: GmailConversationMessage) {
  return [
    ...procurementConversationEmailAddresses(header(message.payload, "From")),
    ...procurementConversationEmailAddresses(header(message.payload, "To")),
    ...procurementConversationEmailAddresses(header(message.payload, "Cc")),
  ];
}

export function boundProcurementConversationMessages(messages: ProcurementConversationMessage[]) {
  const bounded: ProcurementConversationMessage[] = [];
  const selected = messages.slice(-MAX_PROCUREMENT_CONVERSATION_MESSAGES);
  let used = 0;
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const message = selected[index]!;
    const remaining = Math.max(0, MAX_PROCUREMENT_CONVERSATION_BODY - used);
    const limit = Math.min(MAX_PROCUREMENT_CONVERSATION_MESSAGE_BODY, remaining);
    const body = message.body.slice(0, limit);
    bounded.unshift({ ...message, body, truncated: message.truncated || body.length < message.body.length });
    used += body.length;
    if (used >= MAX_PROCUREMENT_CONVERSATION_BODY) break;
  }
  return bounded;
}

export function procurementConversationFromGmailThread(
  thread: GmailConversationThread,
  contactEmail: string,
  accountEmail: string,
): ProcurementConversationMessage[] {
  const normalizedContact = contactEmail.toLowerCase();
  const normalizedAccount = accountEmail.toLowerCase();
  const messages = (thread.messages ?? [])
    .filter((message) => {
      const fromEmail = procurementConversationEmailAddresses(header(message.payload, "From"))[0]?.toLowerCase() ?? "";
      return procurementConversationParticipantEmails(message).includes(normalizedContact)
        && (fromEmail === normalizedContact || fromEmail === normalizedAccount);
    })
    .sort((left, right) => gmailMessageTime(left).localeCompare(gmailMessageTime(right)))
    .map((message) => {
      const rawFrom = header(message.payload, "From");
      const fromEmail = procurementConversationEmailAddresses(rawFrom)[0] ?? rawFrom?.trim() ?? "Unknown sender";
      return {
        id: opaqueGmailMessageId(message.id),
        direction: fromEmail.toLowerCase() === normalizedContact ? "INBOUND" as const : "OUTBOUND" as const,
        fromEmail,
        fromName: displayName(rawFrom),
        toEmails: procurementConversationEmailAddresses(header(message.payload, "To")),
        ccEmails: procurementConversationEmailAddresses(header(message.payload, "Cc")),
        subject: header(message.payload, "Subject"),
        body: plainBody(message.payload),
        sentAt: gmailMessageTime(message),
        truncated: false,
        rfcMessageId: header(message.payload, "Message-ID"),
      };
    });
  return boundProcurementConversationMessages(messages);
}

export function procurementConversationFromLedger(
  messages: ProcurementLedgerConversationMessage[],
): ProcurementConversationMessage[] {
  return boundProcurementConversationMessages(messages
    .slice()
    .sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.id.localeCompare(right.id))
    .map((message) => ({
      id: message.id,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      subject: message.subject,
      body: message.bodyText ?? "",
      sentAt: message.sentAt,
      truncated: message.bodyTruncated,
      rfcMessageId: message.rfcMessageId,
    })));
}

export function procurementConversationFromLedgerMessages(
  messages: ProcurementLedgerConversationMessage[],
): ProcurementConversation {
  const linked = messages.slice().reverse().find((message) => (
    message.provider === "GMAIL" && message.accountEmail && message.providerThreadId
  ));
  return {
    available: true,
    source: "BOURNE_LEDGER",
    sourceUrl: linked
      ? `https://mail.google.com/mail/u/${encodeURIComponent(linked.accountEmail)}/#all/${encodeURIComponent(linked.providerThreadId!)}`
      : null,
    accountEmail: linked?.accountEmail ?? messages.find((message) => message.accountEmail)?.accountEmail ?? null,
    messages: procurementConversationFromLedger(messages),
    unavailableReason: null,
  };
}

export type DeliveredSupplierReplyRecord = {
  id: string;
  input: unknown;
  result: unknown;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function trimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// The answers this request already delivered to one supplier, read from the
// delivery records rather than from a mailbox thread. A record missing the
// sender, the recipient, the delivery time or the text it carried cannot be
// placed in a transcript, so it is left out.
export function procurementDeliveredReplyCandidates(
  records: readonly DeliveredSupplierReplyRecord[],
): ProcurementConversationMergeCandidate[] {
  const candidates: ProcurementConversationMergeCandidate[] = [];
  for (const entry of records) {
    const message = recordOf(recordOf(entry.input).message);
    const result = recordOf(entry.result);
    const fromEmail = trimmed(message.senderEmail);
    const recipient = trimmed(message.recipient);
    const sentAt = trimmed(result.sentAt);
    const body = typeof message.body === "string" ? message.body : "";
    if (!fromEmail || !recipient || !sentAt || !body) continue;
    const rfcMessageId = trimmed(result.rfcMessageId) || null;
    const providerMessageId = trimmed(result.providerMessageId) || null;
    candidates.push({
      message: {
        id: rfcMessageId ?? entry.id,
        direction: "OUTBOUND",
        fromEmail,
        fromName: null,
        toEmails: [recipient],
        ccEmails: [],
        subject: trimmed(message.subject) || null,
        body,
        sentAt,
        truncated: false,
        rfcMessageId,
      },
      providerMessageId,
      rfcMessageId,
    });
  }
  return candidates;
}

// An answer the thread's own mailbox could not send leaves from a pooled
// mailbox, and the provider files it on that mailbox's thread instead of the
// supplier's, so reading the supplier thread alone shows the reply as
// unanswered and every later pass answers it again. Deliveries recorded for the
// supplier are merged back in whatever thread holds them.
export function mergeDeliveredSupplierReplies(
  conversation: ProcurementConversation,
  delivered: readonly ProcurementConversationMergeCandidate[],
): ProcurementConversation {
  if (!conversation.available || !delivered.length) return conversation;
  // A copy is recognized by the message id it was sent under, which the delivery
  // record and the thread both keep, because the two disagree about everything
  // else: a send reconciled hours after the provider accepted it records the
  // reconciliation time while the thread copy keeps the real one, so no window
  // around either time can tell a filed answer from a missing one.
  const sent = conversation.messages
    .filter((message) => message.direction === "OUTBOUND")
    .map((message) => ({
      body: message.body.trim(),
      at: Date.parse(message.sentAt),
      identities: new Set(mergeExternalIdentities({ message, rfcMessageId: message.rfcMessageId })),
    }));
  const nearest = delivered.map((candidate) => {
    const body = candidate.message.body.trim();
    const at = Date.parse(candidate.message.sentAt);
    const identities = mergeExternalIdentities({
      message: candidate.message,
      rfcMessageId: candidate.rfcMessageId,
    });
    return sent
      .map((message, copy) => ({
        copy,
        known: identities.some((identity) => message.identities.has(identity)),
        // Two messages that both carry an id and do not share one are different
        // answers, whatever they say, so only a copy or a delivery whose id the
        // thread never kept falls back on its text.
        guessed: (!identities.length || !message.identities.size)
          && message.body === body
          && Math.abs(message.at - at) <= DELIVERED_REPLY_FILING_WINDOW_MS,
        // A time neither side can be placed by leaves the copy last in line, so
        // it is taken only once the copies we can order have been paired.
        apart: Number.isNaN(at) || Number.isNaN(message.at)
          ? Number.POSITIVE_INFINITY
          : Math.abs(message.at - at),
      }))
      .filter((option) => option.known || option.guessed)
      .sort((left, right) => (
        Number(right.known) - Number(left.known)
        || left.apart - right.apart
        || left.copy - right.copy
      ));
  });
  const filedBy = new Array<number | null>(sent.length).fill(null);
  // Taking a copy from a delivery that has another one free pairs both, so a
  // delivery is refused only when every copy it could stand for is needed by a
  // delivery with nowhere else to go.
  const claim = (delivery: number, tried: Set<number>): boolean => {
    for (const option of nearest[delivery]) {
      if (tried.has(option.copy)) continue;
      tried.add(option.copy);
      const held = filedBy[option.copy];
      if (held === null || claim(held, tried)) {
        filedBy[option.copy] = delivery;
        return true;
      }
    }
    return false;
  };
  const filed = new Set<number>();
  // A delivery whose copy the thread names, then one with a copy beside it, are
  // settled before one whose nearest copy is far off, so when only one of two
  // identical answers can keep a copy it is the answer that copy was filed from.
  const rank = (delivery: number) => (
    nearest[delivery][0]?.known
      ? Number.NEGATIVE_INFINITY
      : nearest[delivery][0]?.apart ?? Number.POSITIVE_INFINITY
  );
  delivered
    .map((_, delivery) => delivery)
    .sort((left, right) => rank(left) - rank(right) || left - right)
    .forEach((delivery) => {
      if (claim(delivery, new Set())) filed.add(delivery);
    });
  const additions = delivered.filter((_, delivery) => !filed.has(delivery));
  if (!additions.length) return conversation;
  return {
    ...conversation,
    messages: mergeProcurementConversationMessages(
      conversation.messages.map((message) => ({ message, rfcMessageId: message.rfcMessageId })),
      [...additions],
    ),
  };
}

export async function resolveProcurementVendorConversation<TReference>(
  args: ProcurementVendorConversationArgs,
  resolver: ProcurementVendorConversationResolver<TReference>,
) {
  const ledgerMessages = await resolver.communicationMessages(
    args.customerId,
    args.orderId,
    args.vendorId,
  );
  if (ledgerMessages?.length) return procurementConversationFromLedgerMessages(ledgerMessages);
  const reference = await resolver.conversationReference(
    args.customerId,
    args.orderId,
    args.vendorId,
  );
  if (!reference) {
    return {
      available: false,
      source: "NONE",
      sourceUrl: null,
      accountEmail: null,
      messages: [],
      unavailableReason: "Supplier conversation not found.",
    } satisfies ProcurementConversation;
  }
  return resolver.compatibilityConversation(args, reference);
}
