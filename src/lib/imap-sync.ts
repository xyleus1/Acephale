import "server-only";

import PostalMime, { type Address, type Mailbox } from "postal-mime";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { classifyInboundEmail } from "@/lib/email-classifier";
import {
  classifyDeliveryFeedback,
  DELIVERY_FEEDBACK_CLASSIFICATION,
  encodeStoredDeliveryFeedback,
} from "@/lib/email-delivery-feedback";
import {
  deliveryFeedbackNeedsRecovery,
  recordDeliveryFeedback,
  recoverLegacyDeliveryFeedback,
  recoverUnfinishedDeliveryFeedback,
  type DeliveryFeedbackRouting,
} from "@/lib/email-delivery-events";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { logEmailTouch } from "@/lib/crm/email-touch";
import {
  DEMO_EMAIL_CLASSIFICATION,
  DEMO_EMAIL_THREAD_MARKER,
  isDemoEmailMessageId,
} from "@/lib/email-demo-markers";
import { emailWorkflowLabelKeys } from "@/lib/email-workflow-labels";
import { gmailImapClient, GMAIL_APP_PASSWORD_PROVIDER, readGmailAppPasswordAccount } from "@/lib/gmail-app-password";
import { imapMessageExternalId, imapThreadExternalId } from "@/lib/imap-identifiers";
import { routeInboundMail, UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";
import { ingestKnowledgeObject } from "@/lib/memory/ingest-object";
import { recordMemoryEvent } from "@/lib/memory/record-event";

const FIRST_SYNC_DAYS = 7;
const MAX_MESSAGES_PER_SYNC = 200;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export type ImapSyncResult = {
  ok: true;
  processed: number;
  created: number;
  threadsTouched: number;
  unrouted: number;
  autoInquiries: number;
  autoLinked: number;
  targetedMailboxesSearched?: Array<"INBOX" | "ALL" | "JUNK">;
  targetedMailboxesMatched?: Array<"INBOX" | "ALL" | "JUNK">;
};

export type ImapSyncDependencies = {
  db: typeof prisma;
  readCredentials: typeof readGmailAppPasswordAccount;
  createClient: typeof gmailImapClient;
  classifyInbound: typeof classifyInboundEmail;
  recordDelivery: typeof recordDeliveryFeedback;
  recoverDelivery: typeof recoverUnfinishedDeliveryFeedback;
  recoverLegacyDelivery: typeof recoverLegacyDeliveryFeedback;
  ingestMemory: typeof ingestKnowledgeObject;
  recordMemory: typeof recordMemoryEvent;
  logTouch: typeof logEmailTouch;
  enqueueJob: typeof enqueueBackgroundJob;
  revalidate: (path: string) => void;
  now: () => Date;
};

const defaultDependencies: ImapSyncDependencies = {
  db: prisma,
  readCredentials: readGmailAppPasswordAccount,
  createClient: gmailImapClient,
  classifyInbound: classifyInboundEmail,
  recordDelivery: recordDeliveryFeedback,
  recoverDelivery: recoverUnfinishedDeliveryFeedback,
  recoverLegacyDelivery: recoverLegacyDeliveryFeedback,
  ingestMemory: ingestKnowledgeObject,
  recordMemory: recordMemoryEvent,
  logTouch: logEmailTouch,
  enqueueJob: enqueueBackgroundJob,
  revalidate: revalidatePath,
  now: () => new Date(),
};

function flattenAddresses(value: Address | Address[] | undefined): Mailbox[] {
  const addresses = !value ? [] : Array.isArray(value) ? value : [value];
  return addresses.flatMap((address) => (
    "group" in address && address.group ? address.group : [address as Mailbox]
  ));
}

function attachmentSize(content: ArrayBuffer | Uint8Array | string) {
  if (typeof content === "string") return Buffer.byteLength(content);
  return content.byteLength;
}

function validDate(value: string | Date | undefined, fallback: Date) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type TargetedMailboxKind = "INBOX" | "ALL" | "JUNK";

function targetedMailboxCandidates(mailboxes: Array<{ path: string; specialUse?: string | null }>) {
  const candidates: Array<{ kind: TargetedMailboxKind; path: string }> = [];
  const add = (kind: TargetedMailboxKind, mailbox: { path: string } | undefined) => {
    if (!mailbox || candidates.some((candidate) => candidate.path === mailbox.path)) return;
    candidates.push({ kind, path: mailbox.path });
  };

  add("INBOX", mailboxes.find((mailbox) => mailbox.path.toLowerCase() === "inbox") ?? { path: "INBOX" });
  add("ALL", mailboxes.find((mailbox) => mailbox.specialUse === "\\All"
    || mailbox.specialUse?.toLowerCase() === "\\all")
    ?? mailboxes.find((mailbox) => /(^|\/)all mail$/i.test(mailbox.path)));
  add("JUNK", mailboxes.find((mailbox) => mailbox.specialUse === "\\Junk"
    || mailbox.specialUse?.toLowerCase() === "\\junk")
    ?? mailboxes.find((mailbox) => /(^|\/)(spam|junk)$/i.test(mailbox.path)));

  return candidates;
}

export async function syncGmailAppPasswordAccountInternal(input: {
  accountId: string;
  officeId: string;
  relatedToMessageId?: string | null;
  skipClassification?: boolean;
  demoObservation?: boolean;
  exactMessageIdOnly?: boolean;
}, dependencies: ImapSyncDependencies = defaultDependencies): Promise<ImapSyncResult | { error: string }> {
  const account = await dependencies.db.emailAccount.findFirst({
    where: {
      id: input.accountId,
      provider: GMAIL_APP_PASSWORD_PROVIDER,
      isActive: true,
    },
  });
  if (!account) return { error: "Active Gmail app-password account not found." };

  let credentials;
  try {
    credentials = dependencies.readCredentials(account);
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "Encrypted account credential is unavailable." };
  }

  const client = dependencies.createClient(credentials);
  const exactTargetMessageId = input.demoObservation && input.exactMessageIdOnly
    ? input.relatedToMessageId || null
    : null;
  let messages: Array<{
    uid: number;
    source?: Buffer;
    internalDate?: Date | string;
    targetedMailboxKind?: TargetedMailboxKind;
  }> = [];
  const targetedMailboxesSearched = new Set<TargetedMailboxKind>();
  const targetedMailboxesMatched = new Set<TargetedMailboxKind>();
  try {
    await client.connect();
    const since = account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - 10 * 60 * 1000)
      : new Date(dependencies.now().getTime() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);
    const targetedDemoSearch = Boolean(input.demoObservation && input.relatedToMessageId);
    const searchMailboxes: Array<{ kind: TargetedMailboxKind; path: string }> = exactTargetMessageId
      ? targetedMailboxCandidates(await client.list())
      : [{ kind: "INBOX", path: "INBOX" }];
    let fallbackError: unknown = null;
    const discoverSpecialUseMailboxes = async () => {
      try {
        for (const mailbox of targetedMailboxCandidates(await client.list())) {
          if (!searchMailboxes.some((candidate) => candidate.path === mailbox.path)) {
            searchMailboxes.push(mailbox);
          }
        }
      } catch (caught) {
        fallbackError ??= caught;
      }
    };

    for (let mailboxIndex = 0; mailboxIndex < searchMailboxes.length; mailboxIndex++) {
      const mailbox = searchMailboxes[mailboxIndex];
      try {
        await client.mailboxOpen(mailbox.path, { readOnly: true });
        if (input.relatedToMessageId) targetedMailboxesSearched.add(mailbox.kind);
        const matches = await client.search(input.relatedToMessageId
          ? exactTargetMessageId
            ? { header: { "Message-ID": exactTargetMessageId } }
            : {
              or: [
                { header: { "In-Reply-To": input.relatedToMessageId } },
                { header: { References: input.relatedToMessageId } },
                { header: { "Message-ID": input.relatedToMessageId } },
              ],
            }
          : { since }, { uid: true });
        const uids = (matches || []).slice(-(input.relatedToMessageId ? 50 : MAX_MESSAGES_PER_SYNC));
        if (!uids.length) {
          if (mailbox.kind === "INBOX" && targetedDemoSearch && !exactTargetMessageId) {
            await discoverSpecialUseMailboxes();
          }
          continue;
        }
        const fetched = await client.fetchAll(
          uids,
          { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true },
          { uid: true },
        );
        if (!fetched.length) {
          fallbackError ??= new Error("IMAP message was unavailable after search.");
          if (mailbox.kind === "INBOX" && targetedDemoSearch && !exactTargetMessageId) {
            await discoverSpecialUseMailboxes();
          }
          continue;
        }
        messages.push(...fetched.map((message) => ({
          ...message,
          targetedMailboxKind: input.relatedToMessageId ? mailbox.kind : undefined,
        })));
        if (!exactTargetMessageId) break;
      } catch (caught) {
        if (mailbox.kind === "INBOX" || exactTargetMessageId) throw caught;
        fallbackError ??= caught;
      }
    }
    if (!messages.length && fallbackError) throw fallbackError;
  } catch {
    return { error: "IMAP sync failed. Verify the app password and Gmail IMAP access." };
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
    else client.close();
  }

  let processed = 0;
  let created = 0;
  let unrouted = 0;
  let operationalMessages = 0;
  const touchedThreadIds = new Set<string>();
  const routedOfficeIds = new Set<string>();

  for (const message of messages.sort((a, b) => a.uid - b.uid)) {
    if (!message.source) continue;
    processed++;

    let parsed;
    try {
      parsed = await PostalMime.parse(message.source, {
        attachmentEncoding: "arraybuffer",
        maxNestingDepth: 40,
        maxHeadersSize: 256 * 1024,
        maxRfc822NestingDepth: 4,
      });
    } catch {
      continue;
    }

    const from = flattenAddresses(parsed.from)[0] ?? null;
    const to = flattenAddresses(parsed.to).map((address) => address.address).filter(Boolean);
    const cc = flattenAddresses(parsed.cc).map((address) => address.address).filter(Boolean);
    const fromEmail = from?.address?.trim().toLowerCase() || "unknown";
    const subject = parsed.subject?.trim() || "(no subject)";
    const parsedMessageId = parsed.messageId?.trim() || null;
    if (exactTargetMessageId && parsedMessageId !== exactTargetMessageId) continue;
    if (message.targetedMailboxKind) targetedMailboxesMatched.add(message.targetedMailboxKind);
    let correlatedDemoDelivery = false;
    if (!input.demoObservation && parsedMessageId && isDemoEmailMessageId(parsedMessageId)) {
      const plannedDelivery = await dependencies.db.supplyExecutionEvent.findFirst({
        where: {
          officeId: account.officeId,
          eventType: "DEMO_EMAIL_DELIVERY_PLANNED",
          status: "PLANNED",
          payload: { path: ["intendedMessageId"], equals: parsedMessageId },
        },
        select: { payload: true },
      });
      const planned = jsonRecord(plannedDelivery?.payload);
      correlatedDemoDelivery = planned.receiverAccountId === account.id
        && String(planned.sender ?? "").toLowerCase() === fromEmail
        && String(planned.recipient ?? "").toLowerCase() === account.email.toLowerCase()
        && to.map((address) => address.toLowerCase()).includes(account.email.toLowerCase())
        && planned.subject === subject
        && planned.intendedMessageId === parsedMessageId;
    }
    const demoMessage = Boolean(input.demoObservation) || correlatedDemoDelivery;
    if (!demoMessage) operationalMessages++;
    const externalId = imapMessageExternalId(account.id, parsed.messageId, message.source);
    const existing = await dependencies.db.emailMessage.findUnique({ where: { externalId } });
    if (existing) {
      if (demoMessage) {
        await dependencies.db.emailMessage.updateMany({
          where: { id: existing.id },
          data: {
            classification: DEMO_EMAIL_CLASSIFICATION,
            classificationReason: "Protected test-only connected email capability message.",
            classificationAt: dependencies.now(),
          },
        });
        await dependencies.db.emailThread.updateMany({
          where: { id: existing.threadId },
          data: {
            hiddenAt: dependencies.now(),
            autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
          },
        });
      }
      // A feedback message whose suppression or sender check failed after the
      // message itself was stored is completed on the next sync.
      if (!demoMessage && deliveryFeedbackNeedsRecovery(existing)) {
        const feedback = classifyDeliveryFeedback({
          fromEmail,
          subject,
          bodyText: (parsed.text || "").trim().slice(0, 50_000),
          headers: parsed.headers.map((header) => ({ name: header.key, value: header.value })),
          ownAddresses: [account.email],
        });
        const storedThread = await dependencies.db.emailThread.findFirst({
          where: { id: existing.threadId },
          select: { officeId: true, autoLinkSkipReason: true },
        });
        if (feedback && storedThread) {
          await dependencies.recordDelivery(dependencies.db, {
            routing: storedThread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER
              ? { routed: false, fallbackOfficeId: account.officeId }
              : { routed: true, officeId: storedThread.officeId },
            accountId: account.id,
            messageId: existing.id,
            threadId: existing.threadId,
            occurredAt: existing.sentAt,
            source: "GMAIL_IMAP",
            feedback,
            now: dependencies.now(),
          }).catch(() => null);
        }
      }
      touchedThreadIds.add(existing.threadId);
      continue;
    }

    const body = (parsed.text || "").trim().slice(0, 50_000);
    const direction = fromEmail === account.email.toLowerCase() ? "OUTBOUND" : "INBOUND";
    const sentAt = validDate(parsed.date, validDate(message.internalDate, dependencies.now()));
    const threadExternalId = imapThreadExternalId({
      accountId: account.id,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      subject,
    });

    const routing = demoMessage
      ? null
      : await routeInboundMail(dependencies.db, {
        accountId: account.id,
        externalThreadId: threadExternalId,
        rfcMessageId: parsedMessageId,
        inReplyTo: parsed.inReplyTo?.trim() || null,
        references: Array.isArray(parsed.references)
          ? parsed.references
          : typeof parsed.references === "string"
            ? parsed.references.split(/\s+/)
            : [],
        subject,
        fromEmail,
      });
    const unroutedMessage = Boolean(routing && !routing.routed);
    if (unroutedMessage) unrouted++;
    // A shared mailbox has no owning customer, so mail that answers no known
    // thread is parked on the connecting office as hidden, admin-only mail.
    const targetOfficeId = routing?.routed ? routing.officeId : account.officeId;
    const feedbackRouting: DeliveryFeedbackRouting = routing?.routed
      ? { routed: true, officeId: routing.officeId }
      : { routed: false, fallbackOfficeId: account.officeId };

    // Bounces, complaints, auto-replies, and opt-outs are recognised
    // deterministically and never reach the AI classifier.
    const deliveryFeedback = direction === "INBOUND" && !demoMessage
      ? classifyDeliveryFeedback({
        fromEmail,
        subject,
        bodyText: body,
        headers: parsed.headers.map((header) => ({ name: header.key, value: header.value })),
        ownAddresses: [account.email],
      })
      : null;

    let classification: string | null = demoMessage
      ? DEMO_EMAIL_CLASSIFICATION
      : deliveryFeedback
        ? DELIVERY_FEEDBACK_CLASSIFICATION
        : null;
    let classificationReason: string | null = demoMessage
      ? "Protected test-only connected email capability message."
      : deliveryFeedback
        ? encodeStoredDeliveryFeedback(deliveryFeedback)
        : null;
    let jobId: string | null = null;
    let inquiryId: string | null = null;
    if (direction === "INBOUND" && !input.skipClassification && !demoMessage && !unroutedMessage && !deliveryFeedback) {
      try {
        const result = await dependencies.classifyInbound({
          subject,
          fromEmail,
          bodyText: body,
          officeId: targetOfficeId,
        });
        classification = result.kind;
        classificationReason = result.reason;
        jobId = result.matchJobId ?? null;
        inquiryId = result.matchInquiryId ?? null;
      } catch {
        // Store the message even when classification is unavailable.
      }
    }

    let thread = await dependencies.db.emailThread.findFirst({
      where: { officeId: targetOfficeId, externalThreadId: threadExternalId },
    });
    if (!thread) {
      thread = await dependencies.db.emailThread.create({
        data: {
          officeId: targetOfficeId,
          subject,
          participants: JSON.stringify(Array.from(new Set([fromEmail, ...to, ...cc]))),
          externalThreadId: threadExternalId,
          jobId,
          inquiryId,
          lastMessageAt: sentAt,
          hiddenAt: demoMessage || unroutedMessage ? dependencies.now() : null,
          autoLinkSkipReason: demoMessage
            ? DEMO_EMAIL_THREAD_MARKER
            : unroutedMessage
              ? UNROUTED_MAIL_THREAD_MARKER
              : null,
        },
      });
    } else if (demoMessage) {
      await dependencies.db.emailThread.updateMany({
        where: { id: thread.id, officeId: targetOfficeId },
        data: {
          hiddenAt: dependencies.now(),
          autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
        },
      });
    } else if (!thread.jobId && !thread.inquiryId && (jobId || inquiryId)) {
      await dependencies.db.emailThread.updateMany({
        where: { id: thread.id, officeId: targetOfficeId },
        data: { jobId, inquiryId },
      });
      thread.jobId = jobId;
      thread.inquiryId = inquiryId;
    }

    const attachments = parsed.attachments.map((attachment) => ({
      name: attachment.filename || "attachment",
      mimeType: attachment.mimeType,
      size: attachmentSize(attachment.content),
    }));
    const createdMessage = await dependencies.db.emailMessage.create({
      data: {
        threadId: thread.id,
        accountId: account.id,
        officeId: targetOfficeId,
        externalId,
        rfcMessageId: parsedMessageId,
        direction,
        fromEmail,
        fromName: from?.name?.trim() || null,
        toEmails: JSON.stringify(to),
        ccEmails: cc.length ? JSON.stringify(cc) : null,
        subject,
        bodyText: body,
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        sentAt,
        classification,
        classificationReason,
        classificationAt: classification ? dependencies.now() : null,
      },
    });
    if (deliveryFeedback) {
      await dependencies.recordDelivery(dependencies.db, {
        routing: feedbackRouting,
        accountId: account.id,
        messageId: createdMessage.id,
        threadId: thread.id,
        occurredAt: sentAt,
        source: "GMAIL_IMAP",
        feedback: deliveryFeedback,
        now: dependencies.now(),
      }).catch(() => null);
    }

    await dependencies.db.emailThread.updateMany({
      where: { id: thread.id, officeId: targetOfficeId },
      data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
    });
    touchedThreadIds.add(thread.id);
    if (!unroutedMessage && !demoMessage) routedOfficeIds.add(targetOfficeId);
    created++;

    const workflowLabels = emailWorkflowLabelKeys({
      kind: classification,
      jobId: thread.jobId,
      inquiryId: thread.inquiryId,
    });
    const sourceExternalId = `gmail-imap:message:${createdMessage.id}`;
    const payload = {
      messageId: createdMessage.id,
      threadId: thread.id,
      externalId,
      direction,
      fromEmail,
      fromName: from?.name?.trim() || null,
      subject,
      sentAt,
      classification,
      classificationReason,
      workflowLabels,
      attachments,
    };
    // Unrouted mail belongs to no customer, so it never enters office memory.
    if (!demoMessage && !unroutedMessage) {
      const memoryObject = await dependencies.ingestMemory({
        officeId: targetOfficeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: GMAIL_APP_PASSWORD_PROVIDER },
        canonicalType: "email_message",
        title: subject,
        text: [subject, fromEmail, from?.name, body.slice(0, 8_000)].filter(Boolean).join("\n"),
        entityType: "email_message",
        entityId: createdMessage.id,
        jobId: thread.jobId,
        inquiryId: thread.inquiryId,
        emailThreadId: thread.id,
        emailMessageId: createdMessage.id,
        occurredAt: sentAt,
        payload,
        provenance: {
          source: "gmail_imap",
          operation: "message_ingest",
          path: "src/lib/imap-sync.ts",
          function: "syncGmailAppPasswordAccountInternal",
          sourceRecordId: createdMessage.id,
          sourceExternalId: externalId,
        },
      }).catch(() => null);
      await dependencies.recordMemory({
        officeId: targetOfficeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: GMAIL_APP_PASSWORD_PROVIDER },
        objectId: memoryObject?.id ?? null,
        eventType: "gmail_imap.message.ingested",
        entityType: "email_message",
        entityId: createdMessage.id,
        occurredAt: sentAt,
        payloadVersion: 1,
        payload,
        provenance: {
          source: "gmail_imap",
          operation: "message_ingest",
          path: "src/lib/imap-sync.ts",
          function: "syncGmailAppPasswordAccountInternal",
          sourceRecordId: createdMessage.id,
          sourceExternalId: externalId,
        },
        idempotencyKey: `gmail-imap:message:${createdMessage.id}:ingested`,
      }).catch(() => null);
      await dependencies.logTouch({
        officeId: targetOfficeId,
        threadId: thread.id,
        messageId: createdMessage.id,
        direction,
        fromEmail,
        toEmails: to,
        subject,
        snippet: body || null,
        sentAt,
      });
    }
  }

  // Feedback rows whose persistence failed on an earlier sync are outside the
  // fetch window by now, so they are completed from the database instead.
  if (!input.demoObservation) {
    await dependencies.recoverDelivery(dependencies.db, {
      accountId: account.id,
      accountEmail: account.email,
      fallbackOfficeId: account.officeId,
      source: "GMAIL_IMAP",
      now: dependencies.now(),
    }).catch(() => null);
    await dependencies.recoverLegacyDelivery(dependencies.db, {
      accountId: account.id,
      accountEmail: account.email,
      fallbackOfficeId: account.officeId,
      source: "GMAIL_IMAP",
      now: dependencies.now(),
    }).catch(() => null);
  }

  if (!input.demoObservation && (messages.length === 0 || operationalMessages > 0)) {
    await dependencies.db.emailAccount.updateMany({
      where: { id: account.id },
      data: { lastSyncAt: dependencies.now() },
    });
    // Sourcing prewarm belongs to the offices the synced mail was routed to.
    for (const officeId of routedOfficeIds.size > 0 ? routedOfficeIds : new Set([account.officeId])) {
      await dependencies.enqueueJob({
        officeId,
        type: "PREWARM_OPEN_SOURCING",
        payload: { officeId },
        dedupeKey: `prewarm-open-sourcing:${officeId}`,
      }).catch(() => null);
    }
  }

  dependencies.revalidate("/dashboard");
  dependencies.revalidate("/dashboard/rfq");
  dependencies.revalidate("/dashboard/inbox");
  dependencies.revalidate("/dashboard/jobs");
  dependencies.revalidate("/dashboard/settings/email");
  return {
    ok: true,
    processed,
    created,
    threadsTouched: touchedThreadIds.size,
    unrouted,
    autoInquiries: 0,
    autoLinked: 0,
    ...(input.relatedToMessageId ? {
      targetedMailboxesSearched: Array.from(targetedMailboxesSearched),
      targetedMailboxesMatched: Array.from(targetedMailboxesMatched),
    } : {}),
  };
}
