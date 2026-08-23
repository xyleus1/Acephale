import "server-only";

import PostalMime, { type Address, type Mailbox } from "postal-mime";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { classifyInboundEmail } from "@/lib/email-classifier";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { logEmailTouch } from "@/lib/crm/email-touch";
import { emailWorkflowLabelKeys } from "@/lib/email-workflow-labels";
import { gmailImapClient, GMAIL_APP_PASSWORD_PROVIDER, readGmailAppPasswordAccount } from "@/lib/gmail-app-password";
import { imapMessageExternalId, imapThreadExternalId } from "@/lib/imap-identifiers";
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
  autoInquiries: number;
  autoLinked: number;
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

export async function syncGmailAppPasswordAccountInternal(input: {
  accountId: string;
  officeId: string;
  relatedToMessageId?: string | null;
}): Promise<ImapSyncResult | { error: string }> {
  const account = await prisma.emailAccount.findFirst({
    where: {
      id: input.accountId,
      officeId: input.officeId,
      provider: GMAIL_APP_PASSWORD_PROVIDER,
      isActive: true,
    },
  });
  if (!account) return { error: "Active Gmail app-password account not found." };

  let credentials;
  try {
    credentials = readGmailAppPasswordAccount(account);
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "Encrypted account credential is unavailable." };
  }

  const client = gmailImapClient(credentials);
  let messages: Array<{ uid: number; source?: Buffer; internalDate?: Date | string }> = [];
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    const since = account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - 10 * 60 * 1000)
      : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);
    const matches = await client.search(input.relatedToMessageId
      ? {
          or: [
            { header: { "In-Reply-To": input.relatedToMessageId } },
            { header: { References: input.relatedToMessageId } },
            { header: { "Message-ID": input.relatedToMessageId } },
          ],
        }
      : { since }, { uid: true });
    const uids = (matches || []).slice(-(input.relatedToMessageId ? 50 : MAX_MESSAGES_PER_SYNC));
    if (uids.length) {
      messages = await client.fetchAll(
        uids,
        { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true },
        { uid: true },
      );
    }
  } catch {
    return { error: "IMAP sync failed. Verify the app password and Gmail IMAP access." };
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
    else client.close();
  }

  let processed = 0;
  let created = 0;
  const touchedThreadIds = new Set<string>();

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

    const externalId = imapMessageExternalId(account.id, parsed.messageId, message.source);
    const existing = await prisma.emailMessage.findUnique({ where: { externalId } });
    if (existing) {
      touchedThreadIds.add(existing.threadId);
      continue;
    }

    const from = flattenAddresses(parsed.from)[0] ?? null;
    const to = flattenAddresses(parsed.to).map((address) => address.address).filter(Boolean);
    const cc = flattenAddresses(parsed.cc).map((address) => address.address).filter(Boolean);
    const fromEmail = from?.address?.trim().toLowerCase() || "unknown";
    const subject = parsed.subject?.trim() || "(no subject)";
    const body = (parsed.text || "").trim().slice(0, 50_000);
    const direction = fromEmail === account.email.toLowerCase() ? "OUTBOUND" : "INBOUND";
    const sentAt = validDate(parsed.date, validDate(message.internalDate, new Date()));
    const threadExternalId = imapThreadExternalId({
      accountId: account.id,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      subject,
    });

    let classification: string | null = null;
    let classificationReason: string | null = null;
    let jobId: string | null = null;
    let inquiryId: string | null = null;
    if (direction === "INBOUND") {
      try {
        const result = await classifyInboundEmail({
          subject,
          fromEmail,
          bodyText: body,
          officeId: account.officeId,
        });
        classification = result.kind;
        classificationReason = result.reason;
        jobId = result.matchJobId ?? null;
        inquiryId = result.matchInquiryId ?? null;
      } catch {
        // Store the message even when classification is unavailable.
      }
    }

    let thread = await prisma.emailThread.findFirst({
      where: { officeId: account.officeId, externalThreadId: threadExternalId },
    });
    if (!thread) {
      thread = await prisma.emailThread.create({
        data: {
          officeId: account.officeId,
          subject,
          participants: JSON.stringify(Array.from(new Set([fromEmail, ...to, ...cc]))),
          externalThreadId: threadExternalId,
          jobId,
          inquiryId,
          lastMessageAt: sentAt,
        },
      });
    } else if (!thread.jobId && !thread.inquiryId && (jobId || inquiryId)) {
      await prisma.emailThread.updateMany({
        where: { id: thread.id, officeId: account.officeId },
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
    const createdMessage = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        accountId: account.id,
        externalId,
        rfcMessageId: parsed.messageId?.trim() || null,
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
        classificationAt: classification ? new Date() : null,
      },
    });

    await prisma.emailThread.updateMany({
      where: { id: thread.id, officeId: account.officeId },
      data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
    });
    touchedThreadIds.add(thread.id);
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
    const memoryObject = await ingestKnowledgeObject({
      officeId: account.officeId,
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
    await recordMemoryEvent({
      officeId: account.officeId,
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
    await logEmailTouch({
      officeId: account.officeId,
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

  await prisma.emailAccount.updateMany({
    where: { id: account.id, officeId: account.officeId },
    data: { lastSyncAt: new Date() },
  });
  await enqueueBackgroundJob({
    officeId: account.officeId,
    type: "PREWARM_OPEN_SOURCING",
    payload: { officeId: account.officeId },
    dedupeKey: `prewarm-open-sourcing:${account.officeId}`,
  }).catch(() => null);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/settings/email");
  return {
    ok: true,
    processed,
    created,
    threadsTouched: touchedThreadIds.size,
    autoInquiries: 0,
    autoLinked: 0,
  };
}
