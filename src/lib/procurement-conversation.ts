import "server-only";

import { UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";
import { prisma } from "@/lib/prisma";
import { localRfqVendorConversation } from "@/lib/procurement-local-outreach";
import { localRfqConversationFor } from "@/lib/procurement-local-outreach-model";
import { deliveredSupplierReplyMessages } from "@/lib/procurement-reply-record";
import {
  getProcurementCommunicationMessages,
  getProcurementVendorConversationRef,
  getProcurementWorkflowAccount,
  type ProcurementVendorConversationRef,
  type ProcurementWorkflowAccountLookup,
} from "@/lib/procurement-workflow";
import { findProcurementCaseById } from "@/lib/supply-os/procurement-case-persistence";
import { SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  MAX_PROCUREMENT_CONVERSATION_MESSAGES,
  boundProcurementConversationMessages,
  mergeDeliveredSupplierReplies,
  mergeProcurementConversationMessages,
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
  args: ProcurementVendorConversationArgs,
  reference: ProcurementVendorConversationRef,
  getWorkflowAccount: ProcurementWorkflowAccountLookup,
) {
  if (!reference.gmailMessageId || !reference.contactEmail) return null;
  const workflowAccount = await getWorkflowAccount({
    customerId: args.customerId,
    officeId: args.officeId,
  });
  if (!workflowAccount) return null;
  const anchors = await prisma.emailMessage.findMany({
    where: {
      thread: {
        officeId: args.officeId,
        companyId: workflowAccount.companyId,
        hiddenAt: null,
        OR: [
          { autoLinkSkipReason: null },
          { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
        ],
      },
      OR: [
        { gmailMessageId: reference.gmailMessageId },
        { externalId: reference.gmailMessageId },
      ],
    },
    take: 3,
    select: { threadId: true, account: { select: { email: true } } },
  });
  const routedAnchors = [...new Map(anchors.flatMap((anchor) => {
    const accountEmail = anchor.account?.email.trim().toLowerCase();
    return accountEmail
      ? [[`${anchor.threadId}\u0000${accountEmail}`, { threadId: anchor.threadId, accountEmail }] as const]
      : [];
  })).values()];
  if (routedAnchors.length !== 1) return null;
  const [anchor] = routedAnchors;
  const thread = await prisma.emailThread.findFirst({
    where: {
      id: anchor.threadId,
      officeId: args.officeId,
      companyId: workflowAccount.companyId,
      hiddenAt: null,
      OR: [
        { autoLinkSkipReason: null },
        { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
      ],
      messages: {
        some: { account: { email: { equals: anchor.accountEmail, mode: "insensitive" } } },
      },
    },
    select: {
      externalThreadId: true,
      messages: {
        where: { account: { email: { equals: anchor.accountEmail, mode: "insensitive" } } },
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
          rfcMessageId: true,
          account: { select: { email: true } },
        },
      },
    },
  });
  if (!thread) return null;
  // The thread is read with the same attribution rule the office RFQ ledger
  // uses, so a shop answering from a colleague, a helpdesk or a ticketing
  // address is part of its own conversation here too. Reading it any narrower
  // left such a thread with our sends only, which no pass can answer.
  const rows = [...thread.messages]
    .sort((left, right) => left.sentAt.valueOf() - right.sentAt.valueOf() || left.id.localeCompare(right.id))
    .map((message) => ({
      id: message.id,
      threadId: anchor.threadId,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: jsonEmails(message.toEmails),
      ccEmails: jsonEmails(message.ccEmails),
      subject: message.subject,
      body: message.bodyText ?? "",
      sentAt: message.sentAt.toISOString(),
      accountEmail: message.account?.email ?? null,
      externalThreadId: thread.externalThreadId,
      // Only a real RFC id, never the account scoped external id a sync may put
      // there, since a wrong id would read as a different message.
      rfcMessageId: message.rfcMessageId,
    }));
  return localRfqConversationFor(rows, reference.contactEmail);
}

async function localProviderThreadMessages(args: {
  officeId: string;
  companyId: string;
  accountEmail: string;
  externalThreadId: string;
}) {
  const threads = await prisma.emailThread.findMany({
    where: {
      officeId: args.officeId,
      companyId: args.companyId,
      externalThreadId: args.externalThreadId,
      hiddenAt: null,
      OR: [
        { autoLinkSkipReason: null },
        { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
      ],
      messages: {
        some: { account: { email: { equals: args.accountEmail, mode: "insensitive" } } },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 2,
    select: {
      messages: {
        where: { account: { email: { equals: args.accountEmail, mode: "insensitive" } } },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
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
          gmailMessageId: true,
          rfcMessageId: true,
          externalId: true,
        },
      },
    },
  });
  if (threads.length !== 1) return [];
  return threads[0]!.messages.map((message) => ({
    providerMessageId: message.gmailMessageId,
    rfcMessageId: message.rfcMessageId ?? message.externalId,
    message: {
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
      rfcMessageId: message.rfcMessageId,
    },
  }));
}

type ProcurementVendorConversationDependencies = {
  communicationMessages?: typeof getProcurementCommunicationMessages;
  conversationReference?: typeof getProcurementVendorConversationRef;
  compatibilityConversation?: (
    args: ProcurementVendorConversationArgs,
    reference: ProcurementVendorConversationRef,
  ) => Promise<ProcurementConversation>;
  getWorkflowAccount?: ProcurementWorkflowAccountLookup;
};

async function compatibilityConversation(
  args: ProcurementVendorConversationArgs,
  reference: ProcurementVendorConversationRef,
  getWorkflowAccount: ProcurementWorkflowAccountLookup,
) {
  if (!reference.contactEmail) return unavailable("The workflow has no verified supplier email to bind to this thread.");
  if (!reference.gmailMessageId) {
    // Campaign sends are recorded in the office email ledger even when the
    // workflow receipt column cannot be written, so read that ledger first.
    const sent = await localRfqVendorConversation(args.officeId, args.orderId, reference.contactEmail);
    return sent ?? unavailable("No supplier contact receipt is recorded for this manufacturer.");
  }
  const gmailMessageId = reference.gmailMessageId;
  const contactEmail = reference.contactEmail;

  const stored = await localConversation(args, reference, getWorkflowAccount);
  // An anchored thread holding only our own sends cannot be answered, and the
  // supplier's reply may well sit on another thread of the same request, so the
  // office ledger is still read before settling for a transcript with no
  // supplier message in it.
  if (stored?.messages.some((message) => message.direction === "INBOUND")) return stored;

  const sentByReference = await localRfqVendorConversation(args.officeId, args.orderId, contactEmail);
  if (sentByReference?.messages.some((message) => message.direction === "INBOUND")) return sentByReference;
  if (stored) return stored;
  if (sentByReference) return sentByReference;

  const { getValidAccessToken } = await import("@/lib/gmail-oauth");
  // tenant-scope:ignore EmailAccount is shared provider provenance, not mailbox tenancy; the routed office/order/vendor reference is proven before this mailbox lookup.
  const accounts = await prisma.emailAccount.findMany({
    where: {
      // Mailboxes are one shared pool, so the sending mailbox can belong to any office.
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
  const connected = candidates.flatMap((candidate) => candidate ? [candidate] : []);
  if (connected.length === 1) return connected[0]!;
  if (connected.length > 1) {
    return unavailable("The supplier message reference resolves to more than one shared mailbox and is ambiguous.");
  }
  return unavailable("Contact is recorded, but the sending Gmail inbox is not connected to this Derya office.");
}

export async function procurementVendorConversation(
  args: ProcurementVendorConversationArgs,
  dependencies: ProcurementVendorConversationDependencies = {},
) {
  const getWorkflowAccount = dependencies.getWorkflowAccount ?? getProcurementWorkflowAccount;
  const communicationMessages = dependencies.communicationMessages ?? getProcurementCommunicationMessages;
  const ledgerMessages = await communicationMessages(args.customerId, args.orderId, args.vendorId);
  const resolved = await resolveProcurementVendorConversation(args, {
    communicationMessages: async () => ledgerMessages,
    conversationReference:
      dependencies.conversationReference ?? getProcurementVendorConversationRef,
    compatibilityConversation: dependencies.compatibilityConversation ?? ((input, reference) => (
      compatibilityConversation(input, reference, getWorkflowAccount)
    )),
  });
  const threaded = await withLedgerThread(args, resolved, ledgerMessages, getWorkflowAccount);
  return withDeliveredReplies(args, threaded);
}

async function withLedgerThread(
  args: ProcurementVendorConversationArgs,
  resolved: ProcurementConversation,
  ledgerMessages: Awaited<ReturnType<typeof getProcurementCommunicationMessages>>,
  getWorkflowAccount: ProcurementWorkflowAccountLookup,
) {
  if (resolved.source !== "BOURNE_LEDGER" || !ledgerMessages?.length) return resolved;
  const providerThread = [...ledgerMessages].reverse().find((message) => (
    message.provider === "GMAIL" && message.accountEmail && message.providerThreadId
  ));
  if (!providerThread?.providerThreadId) return resolved;
  const workflowAccount = await getWorkflowAccount({
    customerId: args.customerId,
    officeId: args.officeId,
  });
  if (!workflowAccount) return resolved;
  const localMessages = await localProviderThreadMessages({
    officeId: args.officeId,
    companyId: workflowAccount.companyId,
    accountEmail: providerThread.accountEmail,
    externalThreadId: providerThread.providerThreadId,
  });
  if (!localMessages.length) return resolved;
  const ledgerById = new Map(ledgerMessages.map((message) => [message.id, message]));
  const merged = mergeProcurementConversationMessages(resolved.messages.map((message) => {
    const ledger = ledgerById.get(message.id);
    return {
      message,
      providerMessageId: ledger?.providerMessageId,
      rfcMessageId: ledger?.rfcMessageId,
    };
  }), localMessages);
  return {
    ...resolved,
    messages: merged,
  };
}

async function withDeliveredReplies(
  args: ProcurementVendorConversationArgs,
  conversation: ProcurementConversation,
): Promise<ProcurementConversation> {
  if (!conversation.available) return conversation;
  return mergeDeliveredSupplierReplies(conversation, await deliveredSupplierReplyMessages(args));
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
          rfcMessageId: true,
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
      rfcMessageId: message.rfcMessageId,
    }))),
    unavailableReason: flattened.length ? null : "The connected thread has no stored messages.",
  } satisfies ProcurementConversation;
}
