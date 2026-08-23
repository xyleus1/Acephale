import "server-only";

import { getValidAccessToken } from "@/lib/gmail-oauth";
import { prisma } from "@/lib/prisma";
import {
  getProcurementCommunicationMessages,
  getProcurementVendorConversationRef,
  type ProcurementVendorConversationRef,
} from "@/lib/procurement-workflow";
import { findProcurementCaseById } from "@/lib/supply-os/procurement-case-persistence";
import { SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  MAX_PROCUREMENT_CONVERSATION_MESSAGES,
  boundProcurementConversationMessages,
  procurementConversationEmailAddresses,
  procurementConversationFromGmailThread,
  procurementConversationParticipantEmails,
  resolveProcurementVendorConversation,
  type GmailConversationMessage,
  type GmailConversationThread,
  type ProcurementConversation,
  type ProcurementVendorConversationArgs,
} from "@/lib/procurement-conversation-model";

const MAX_CONNECTED_ACCOUNTS = 10;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonEmails(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

async function gmailJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null) as T | null;
}

async function gmailAnchor(accessToken: string, reference: string) {
  const direct = await gmailJson<GmailConversationMessage>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(reference)}?format=full`,
    accessToken,
  );
  if (direct?.id && direct.threadId) return direct;
  const query = new URLSearchParams({ q: `rfc822msgid:${reference}`, maxResults: "1" });
  const found = await gmailJson<{ messages?: Array<{ id: string; threadId: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`,
    accessToken,
  );
  const candidate = found?.messages?.[0];
  if (!candidate?.id) return null;
  return gmailJson<GmailConversationMessage>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(candidate.id)}?format=full`,
    accessToken,
  );
}

function unavailable(reason: string): ProcurementConversation {
  return {
    available: false,
    source: "NONE",
    sourceUrl: null,
    accountEmail: null,
    messages: [],
    unavailableReason: reason,
  };
}

async function localConversation(
  officeId: string,
  reference: ProcurementVendorConversationRef,
) {
  if (!reference.gmailMessageId || !reference.contactEmail) return null;
  const anchor = await prisma.emailMessage.findFirst({
    where: {
      thread: { officeId },
      OR: [
        { gmailMessageId: reference.gmailMessageId },
        { externalId: reference.gmailMessageId },
      ],
    },
    select: { threadId: true },
  });
  if (!anchor) return null;
  const thread = await prisma.emailThread.findFirst({
    where: { id: anchor.threadId, officeId },
    select: {
      externalThreadId: true,
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: MAX_PROCUREMENT_CONVERSATION_MESSAGES,
        select: {
          id: true,
          direction: true,
          fromEmail: true,
          fromName: true,
          toEmails: true,
          ccEmails: true,
          subject: true,
          bodyText: true,
          sentAt: true,
          account: { select: { email: true } },
        },
      },
    },
  });
  if (!thread) return null;
  const normalizedContact = reference.contactEmail.toLowerCase();
  const related = thread.messages.filter((message) => {
    const fromEmail = message.fromEmail.toLowerCase();
    const recipients = [
      ...jsonEmails(message.toEmails).flatMap((entry) => procurementConversationEmailAddresses(entry)),
      ...jsonEmails(message.ccEmails).flatMap((entry) => procurementConversationEmailAddresses(entry)),
    ];
    return fromEmail === normalizedContact
      || (message.direction === "OUTBOUND" && recipients.includes(normalizedContact));
  });
  if (!related.length) return null;
  const accountEmail = related.find((message) => message.account?.email)?.account?.email ?? null;
  const messages = boundProcurementConversationMessages(related
    .sort((left, right) => left.sentAt.valueOf() - right.sentAt.valueOf() || left.id.localeCompare(right.id))
    .map((message) => ({
      id: message.id,
      direction: message.fromEmail.toLowerCase() === normalizedContact ? "INBOUND" : "OUTBOUND",
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: jsonEmails(message.toEmails),
      ccEmails: jsonEmails(message.ccEmails),
      subject: message.subject,
      body: message.bodyText ?? "",
      sentAt: message.sentAt.toISOString(),
      truncated: false,
    })));
  return {
    available: true,
    source: "DERYA_EMAIL_RECORD" as const,
    sourceUrl: accountEmail && thread.externalThreadId
      ? `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(thread.externalThreadId)}`
      : null,
    accountEmail,
    messages,
    unavailableReason: null,
  } satisfies ProcurementConversation;
}

type ProcurementVendorConversationDependencies = {
  communicationMessages?: typeof getProcurementCommunicationMessages;
  conversationReference?: typeof getProcurementVendorConversationRef;
  compatibilityConversation?: (
    args: ProcurementVendorConversationArgs,
    reference: ProcurementVendorConversationRef,
  ) => Promise<ProcurementConversation>;
};

async function compatibilityConversation(
  args: ProcurementVendorConversationArgs,
  reference: ProcurementVendorConversationRef,
) {
  if (!reference.gmailMessageId) return unavailable("No supplier contact receipt is recorded for this manufacturer.");
  if (!reference.contactEmail) return unavailable("The workflow has no verified supplier email to bind to this thread.");
  const gmailMessageId = reference.gmailMessageId;
  const contactEmail = reference.contactEmail;

  const stored = await localConversation(args.officeId, reference);
  if (stored) return stored;

  const accounts = await prisma.emailAccount.findMany({
    where: {
      officeId: args.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CONNECTED_ACCOUNTS,
    select: { id: true, email: true },
  });
  const candidates = await Promise.all(accounts.map(async (account) => {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(account.id);
    } catch {
      return null;
    }
    let anchor: GmailConversationMessage | null = null;
    try {
      anchor = await gmailAnchor(accessToken, gmailMessageId);
    } catch {
      return null;
    }
    if (!anchor?.threadId || !procurementConversationParticipantEmails(anchor).includes(contactEmail)) return null;
    let thread: GmailConversationThread | null = null;
    try {
      thread = await gmailJson<GmailConversationThread>(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(anchor.threadId)}?format=full`,
        accessToken,
      );
    } catch {
      return null;
    }
    if (!thread) return null;
    const messages = procurementConversationFromGmailThread(thread, contactEmail, account.email);
    if (!messages.length) return null;
    return {
      available: true,
      source: "CONNECTED_GMAIL",
      sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(account.email)}/#all/${encodeURIComponent(thread.id)}`,
      accountEmail: account.email,
      messages,
      unavailableReason: null,
    } satisfies ProcurementConversation;
  }));
  const connected = candidates.find((candidate) => candidate !== null);
  if (connected) return connected;
  return unavailable("Contact is recorded, but the sending Gmail inbox is not connected to this Derya office.");
}

export async function procurementVendorConversation(
  args: ProcurementVendorConversationArgs,
  dependencies: ProcurementVendorConversationDependencies = {},
) {
  return resolveProcurementVendorConversation(args, {
    communicationMessages:
      dependencies.communicationMessages ?? getProcurementCommunicationMessages,
    conversationReference:
      dependencies.conversationReference ?? getProcurementVendorConversationRef,
    compatibilityConversation:
      dependencies.compatibilityConversation ?? compatibilityConversation,
  });
}

function taskThreadId(task: unknown) {
  const result = object(object(task).result);
  return text(result.localThreadId) || null;
}

function connectedMessageIds(procurementCase: Record<string, unknown>) {
  const ids: string[] = [];
  const quoteResult = object(object(procurementCase.quoteCycle).result);
  for (const reply of Array.isArray(quoteResult.connectedReplies) ? quoteResult.connectedReplies : []) {
    const id = text(object(reply).localMessageId);
    if (id) ids.push(id);
  }
  const purchaseResult = object(object(procurementCase.purchaseAction).result);
  for (const reply of Array.isArray(purchaseResult.connectedAcknowledgmentReplies)
    ? purchaseResult.connectedAcknowledgmentReplies
    : []) {
    const id = text(object(reply).localMessageId);
    if (id) ids.push(id);
  }
  return ids;
}

export async function historicalProcurementConversation(
  context: SupplyAccessContext,
  caseId: string,
) {
  const procurementCase = await findProcurementCaseById(context, caseId);
  if (!procurementCase) throw new SupplyPersistenceError("Procurement case was not found.", "not_found");
  const caseRecord = object(procurementCase);
  const threadIds = [
    taskThreadId(caseRecord.supplierEmailAction),
    taskThreadId(caseRecord.purchaseOrderEmailAction),
    taskThreadId(caseRecord.purchaseOrderFollowUpAction),
  ].filter((value): value is string => Boolean(value));
  const localMessageIds = connectedMessageIds(caseRecord);
  if (localMessageIds.length) {
    const messageThreads = await prisma.emailMessage.findMany({
      where: { id: { in: localMessageIds }, thread: { officeId: context.officeId } },
      select: { threadId: true },
    });
    threadIds.push(...messageThreads.map((message) => message.threadId));
  }
  const uniqueThreadIds = [...new Set(threadIds)];
  if (!uniqueThreadIds.length) return unavailable("No connected email thread is recorded for this supplier workstream.");
  const threads = await prisma.emailThread.findMany({
    where: { id: { in: uniqueThreadIds }, officeId: context.officeId },
    select: {
      externalThreadId: true,
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: MAX_PROCUREMENT_CONVERSATION_MESSAGES,
        select: {
          id: true,
          direction: true,
          fromEmail: true,
          fromName: true,
          toEmails: true,
          ccEmails: true,
          subject: true,
          bodyText: true,
          sentAt: true,
          account: { select: { email: true } },
        },
      },
    },
  });
  const flattened = threads.flatMap((thread) => thread.messages).sort((left, right) => (
    left.sentAt.valueOf() - right.sentAt.valueOf() || left.id.localeCompare(right.id)
  ));
  const accountEmail = flattened.find((message) => message.account?.email)?.account?.email ?? null;
  const externalThreadId = threads.find((thread) => thread.externalThreadId)?.externalThreadId ?? null;
  return {
    available: flattened.length > 0,
    source: "DERYA_EMAIL_RECORD",
    sourceUrl: accountEmail && externalThreadId
      ? `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(externalThreadId)}`
      : null,
    accountEmail,
    messages: boundProcurementConversationMessages(flattened.map((message) => ({
      id: message.id,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: jsonEmails(message.toEmails),
      ccEmails: jsonEmails(message.ccEmails),
      subject: message.subject,
      body: message.bodyText ?? "",
      sentAt: message.sentAt.toISOString(),
      truncated: false,
    }))),
    unavailableReason: flattened.length ? null : "The connected thread has no stored messages.",
  } satisfies ProcurementConversation;
}
