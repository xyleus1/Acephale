import { createHash } from "node:crypto";

export const MAX_PROCUREMENT_CONVERSATION_MESSAGES = 100;
export const MAX_PROCUREMENT_CONVERSATION_MESSAGE_BODY = 50_000;
export const MAX_PROCUREMENT_CONVERSATION_BODY = 400_000;

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
};

export type ProcurementLedgerConversationMessage = {
  id: string;
  provider: string;
  accountEmail: string;
  providerThreadId: string | null;
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
