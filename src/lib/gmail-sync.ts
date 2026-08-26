"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { requireEmailAccountAdminSession } from "./email-account-access";
import { getValidAccessToken } from "./gmail-oauth";
import { classifyInboundEmail } from "./email-classifier";
import { classifyEmailAttachments } from "./doc-classify";
import { enqueueBackgroundJob } from "./background-jobs";
import { ingestKnowledgeObject } from "./memory/ingest-object";
import { recordMemoryEvent } from "./memory/record-event";
import { DERYA_LOAD_RFQ_INBOX_EMAILS, getDeryaLoadRfqInbox, isDeryaLoadRfqInbox } from "./derya-inboxes";
import { emailWorkflowLabelKeys } from "./email-workflow-labels";
import { logEmailTouch } from "./crm/email-touch";
import {
  buildGmailBackfillWindows,
  buildRecentGmailSyncQuery,
  GMAIL_BACKFILL_THREADS_PER_WINDOW,
} from "./gmail-sync-windows";
import { GMAIL_APP_PASSWORD_PROVIDER } from "./gmail-app-password";
import { routeInboundMail, UNROUTED_MAIL_THREAD_MARKER } from "./inbound-mail-routing";
import { syncGmailAppPasswordAccountInternal } from "./imap-sync";

// Sync envelope: how many threads max we'll touch in one run, and how far back
// to look. Each thread is one Gmail API call regardless of how many messages
// it contains, so we can be generous. Message dedupe by externalId means
// re-scanning old threads is cheap (one HEAD-style check each).
const RECENT_THREAD_FETCH_LIMIT = 500;
const PAGE_SIZE = 100;
const BACKFILL_DEDUPE_DAYS = 7;

type GmailSyncResult = {
  ok: true;
  processed: number;
  created: number;
  threadsTouched: number;
  autoInquiries: number;
  autoLinked: number;
  unrouted?: number;
  backfillQueued?: number;
  backfillSkipped?: number;
};

type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    headers: { name: string; value: string }[];
    parts?: GmailMessage["payload"][];
    body?: { data?: string; size?: number };
    mimeType?: string;
  };
};
type GmailThread = { id: string; messages?: GmailMessage[] };

function header(headers: { name: string; value: string }[], name: string): string | null {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm, "base64").toString("utf-8");
}

type AttachmentMeta = { filename: string; mimeType: string; size: number; attachmentId: string };

function extractAttachments(payload: any, out: AttachmentMeta[] = []): AttachmentMeta[] {
  if (!payload) return out;
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: payload.body.size ?? 0,
      attachmentId: payload.body.attachmentId,
    });
  }
  if (payload.parts?.length) {
    for (const p of payload.parts) extractAttachments(p, out);
  }
  return out;
}

function extractPlainBody(payload: GmailMessage["payload"]): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts?.length) {
    for (const p of payload.parts) {
      const t = extractPlainBody(p);
      if (t) return t;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

async function listThreadIds(accessToken: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(Math.min(PAGE_SIZE, max - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break;
    const json: { threads?: { id: string }[]; nextPageToken?: string } = await res.json();
    for (const t of json.threads ?? []) ids.push(t.id);
    if (!json.nextPageToken || (json.threads ?? []).length === 0) break;
    pageToken = json.nextPageToken;
  }
  return ids;
}

async function fetchThread(accessToken: string, threadId: string): Promise<GmailThread | null> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as GmailThread;
}

export async function syncEmailAccount(accountId: string): Promise<
  | GmailSyncResult
  | { error: string }
> {
  await requireEmailAccountAdminSession();
  // The mailbox pool is shared, so the sync runs against the mailbox itself and
  // files mail under the office that owns each thread.
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, isActive: true },
    select: { provider: true, officeId: true },
  });
  if (!account) return { error: "Active email account not found" };
  const result = account.provider === GMAIL_APP_PASSWORD_PROVIDER
    ? await syncGmailAppPasswordAccountInternal({ accountId, officeId: account.officeId })
    : await _syncEmailAccountInternal({ accountId, officeId: account.officeId });
  if ("error" in result) return result;
  if (account.provider !== "GMAIL") return result;
  const backfill = await enqueueGmailBackfillJobsForAccount({ accountId, officeId: account.officeId });
  return { ...result, backfillQueued: backfill.queued, backfillSkipped: backfill.skipped };
}

// Cron-callable version that skips the session check. Caller must already
// have authorized via the cron secret.
export async function syncEmailAccountInternal(accountId: string, officeId: string): Promise<
  | GmailSyncResult
  | { error: string }
> {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, isActive: true },
    select: { provider: true },
  });
  if (!account) return { error: "Active email account not found" };
  if (account.provider === GMAIL_APP_PASSWORD_PROVIDER) {
    return syncGmailAppPasswordAccountInternal({ accountId, officeId });
  }
  return _syncEmailAccountInternal({ accountId, officeId });
}

export async function syncEmailAccountWindowInternal(input: {
  accountId: string;
  officeId: string;
  query: string;
  threadFetchLimit?: number;
  skipClassification?: boolean;
  demoObservation?: boolean;
  exactMessageIdOnly?: boolean;
}): Promise<
  | GmailSyncResult
  | { error: string }
> {
  const account = await prisma.emailAccount.findFirst({
    where: { id: input.accountId, isActive: true },
    select: { provider: true },
  });
  if (!account) return { error: "Active email account not found" };
  if (account.provider === GMAIL_APP_PASSWORD_PROVIDER) {
    const relatedToMessageId = input.query.match(/rfc822msgid:\s*(.+)$/i)?.[1]?.trim() || null;
    return syncGmailAppPasswordAccountInternal({
      accountId: input.accountId,
      officeId: input.officeId,
      relatedToMessageId,
      skipClassification: input.skipClassification,
      demoObservation: input.demoObservation,
      exactMessageIdOnly: input.exactMessageIdOnly,
    });
  }
  return _syncEmailAccountInternal({
    accountId: input.accountId,
    officeId: input.officeId,
    query: input.query,
    threadFetchLimit: input.threadFetchLimit ?? GMAIL_BACKFILL_THREADS_PER_WINDOW,
  });
}

async function _syncEmailAccountInternal({
  accountId,
  // The caller's office no longer decides ownership: mailboxes are shared and
  // each message is filed under the office that owns its thread.
  officeId: _officeId,
  query = buildRecentGmailSyncQuery(),
  threadFetchLimit = RECENT_THREAD_FETCH_LIMIT,
}: {
  accountId: string;
  officeId: string;
  query?: string;
  threadFetchLimit?: number;
}): Promise<
  | GmailSyncResult
  | { error: string }
> {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId },
  });
  if (!account) return { error: "Account not found" };
  if (account.provider !== "GMAIL") return { error: "Only Gmail sync is implemented" };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(accountId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token refresh failed" };
  }

  const threadIds = await listThreadIds(accessToken, query, threadFetchLimit);

  let processed = 0;
  let created = 0;
  let unrouted = 0;
  const touchedThreadDbIds: string[] = [];
  const routedThreadDbIds: string[] = [];
  const routedOfficeIds = new Set<string>();

  for (const tid of threadIds) {
    const thread = await fetchThread(accessToken, tid);
    if (!thread || !thread.messages || thread.messages.length === 0) continue;

    // Find or stub our local EmailThread for this Gmail thread. Mailboxes are a
    // shared pool, so a thread is found by provider identity and its own office
    // decides ownership.
    let localThread = await prisma.emailThread.findFirst({
      where: { externalThreadId: tid },
      orderBy: { lastMessageAt: "desc" },
    });

    // Sort messages chronologically.
    const messages = [...thread.messages].sort(
      (a, b) => parseInt(a.internalDate) - parseInt(b.internalDate)
    );

    for (const msg of messages) {
      const headers = msg.payload.headers;
      const fromRaw = header(headers, "From") ?? "";
      const subject = header(headers, "Subject") ?? "(no subject)";
      const dateStr = header(headers, "Date");
      const messageIdHdr = header(headers, "Message-ID");
      const toRaw = header(headers, "To") ?? "";
      const sentAt = dateStr ? new Date(dateStr) : new Date(parseInt(msg.internalDate));

      const externalId = messageIdHdr ?? msg.id;

      // Skip if already in DB. Messages sent from the app are persisted by
      // gmail-send with gmailMessageId but a null externalId, so match on
      // either key or every outbound email would re-ingest as a duplicate.
      const existing =
        (await prisma.emailMessage.findUnique({ where: { externalId } })) ??
        (await prisma.emailMessage.findFirst({ where: { gmailMessageId: msg.id } }));
      if (existing) {
        if (!existing.externalId) {
          await prisma.emailMessage.update({ where: { id: existing.id }, data: { externalId } }).catch(() => {});
        }
        // If we don't have a local thread yet, adopt from existing message.
        if (!localThread) {
          localThread = await prisma.emailThread.findFirst({
            where: { id: existing.threadId },
          });
          // Backfill externalThreadId so future syncs map directly.
          if (localThread && !localThread.externalThreadId) {
            await prisma.emailThread.updateMany({
              where: { id: localThread.id, officeId: localThread.officeId },
              data: { externalThreadId: tid },
            });
            localThread.externalThreadId = tid;
          }
        }
        continue;
      }
      processed++;

      const fromMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/);
      const fromEmail = fromMatch ? fromMatch[1] : fromRaw;
      const fromName = fromRaw.includes("<") ? fromRaw.split("<")[0].trim().replace(/^"|"$/g, "") : null;
      const direction = fromEmail.toLowerCase() === account.email.toLowerCase() ? "OUTBOUND" : "INBOUND";
      const body = extractPlainBody(msg.payload);
      const attachments = extractAttachments(msg.payload);

      const routing = localThread
        ? localThread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER
          // Follow-ups keep the unrouted state of the thread they belong to.
          ? { routed: false as const }
          : { routed: true as const, officeId: localThread.officeId }
        : await routeInboundMail(prisma, {
          accountId: account.id,
          externalThreadId: tid,
          rfcMessageId: messageIdHdr,
          inReplyTo: header(headers, "In-Reply-To") ?? null,
          references: (header(headers, "References") ?? "").split(/\s+/).filter(Boolean),
          subject,
          fromEmail,
        });
      const unroutedMessage = !routing.routed;
      // A shared mailbox has no owning customer, so mail that answers no known
      // thread is parked on the connecting office as hidden, admin-only mail.
      const targetOfficeId = routing.routed ? routing.officeId : account.officeId;
      if (unroutedMessage) unrouted++;

      // Per-message classification (lightweight; AI may match an existing job/inquiry).
      let classificationLabel: string | null = null;
      let classificationReason: string | null = null;
      let classifiedMatchJobId: string | null = null;
      let classifiedMatchInquiryId: string | null = null;
      if (direction === "INBOUND" && !unroutedMessage) {
        try {
          const cls = await classifyInboundEmail({
            subject, fromEmail, bodyText: body, officeId: targetOfficeId,
          });
          classificationLabel = cls.kind;
          classificationReason = cls.reason;
          if (cls.matchJobId) classifiedMatchJobId = cls.matchJobId;
          if (cls.matchInquiryId) classifiedMatchInquiryId = cls.matchInquiryId;
        } catch {
          // ignore - message still gets stored
        }
      }

      // Create the thread on first inserted message.
      if (!localThread) {
        localThread = await prisma.emailThread.create({
          data: {
            officeId: targetOfficeId,
            subject,
            participants: JSON.stringify([fromEmail, account.email]),
            externalThreadId: tid,
            jobId: classifiedMatchJobId,
            inquiryId: classifiedMatchInquiryId,
            lastMessageAt: sentAt,
            hiddenAt: unroutedMessage ? new Date() : null,
            autoLinkSkipReason: unroutedMessage ? UNROUTED_MAIL_THREAD_MARKER : null,
          },
        });
      } else if (!localThread.jobId && !localThread.inquiryId && (classifiedMatchJobId || classifiedMatchInquiryId)) {
        // Adopt link from this message if the thread isn't yet linked.
        await prisma.emailThread.updateMany({
          where: { id: localThread.id, officeId: targetOfficeId },
          data: { jobId: classifiedMatchJobId, inquiryId: classifiedMatchInquiryId },
        });
        localThread.jobId = classifiedMatchJobId;
        localThread.inquiryId = classifiedMatchInquiryId;
      }

      const createdMessage = await prisma.emailMessage.create({
        data: {
          threadId: localThread.id,
          accountId: account.id,
          officeId: targetOfficeId,
          externalId,
          gmailMessageId: msg.id,
          rfcMessageId: messageIdHdr,
          direction,
          fromEmail,
          fromName,
          toEmails: JSON.stringify(toRaw ? [toRaw] : []),
          subject,
          bodyText: body.slice(0, 50000),
          attachments: attachments.length > 0 ? JSON.stringify(attachments) : null,
          sentAt,
          classification: classificationLabel,
          classificationReason,
          classificationAt: classificationLabel ? new Date() : null,
        },
      });
      const workflowLabels = emailWorkflowLabelKeys({
        kind: classificationLabel,
        jobId: localThread.jobId,
        inquiryId: localThread.inquiryId,
      });
      const deryaInbox = getDeryaLoadRfqInbox(account.email);
      const sourceExternalId = `gmail:message:${createdMessage.id}`;
      const messagePayload = {
        messageId: createdMessage.id,
        threadId: localThread.id,
        gmailThreadId: tid,
        gmailMessageId: msg.id,
        externalId,
        direction,
        fromEmail,
        fromName,
        subject,
        sentAt,
        classification: classificationLabel,
        classificationReason,
        workflowLabels,
        deryaInbox: deryaInbox ? { email: deryaInbox.email, owner: deryaInbox.owner, role: deryaInbox.role } : null,
        attachments,
      };
      const memoryObject = unroutedMessage ? null : await ingestKnowledgeObject({
        officeId: targetOfficeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: "GMAIL", deryaLoadRfqInbox: isDeryaLoadRfqInbox(account.email) },
        canonicalType: "email_message",
        title: subject,
        text: [subject, fromEmail, fromName, body.slice(0, 8000)].filter(Boolean).join("\n"),
        entityType: "email_message",
        entityId: createdMessage.id,
        jobId: localThread.jobId,
        inquiryId: localThread.inquiryId,
        emailThreadId: localThread.id,
        emailMessageId: createdMessage.id,
        occurredAt: sentAt,
        payload: messagePayload,
        provenance: {
          source: "gmail",
          operation: "message_ingest",
          path: "src/lib/gmail-sync.ts",
          function: "syncEmailAccountInternal",
          sourceRecordId: createdMessage.id,
          sourceExternalId: externalId,
        },
      }).catch(() => null);
      if (!unroutedMessage) await recordMemoryEvent({
        officeId: targetOfficeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: "GMAIL", deryaLoadRfqInbox: isDeryaLoadRfqInbox(account.email) },
        objectId: memoryObject?.id ?? null,
        eventType: "gmail.message.ingested",
        entityType: "email_message",
        entityId: createdMessage.id,
        occurredAt: sentAt,
        payloadVersion: 1,
        payload: messagePayload,
        provenance: {
          source: "gmail",
          operation: "message_ingest",
          path: "src/lib/gmail-sync.ts",
          function: "syncEmailAccountInternal",
          sourceRecordId: createdMessage.id,
          sourceExternalId: externalId,
        },
        idempotencyKey: `gmail:message:${createdMessage.id}:ingested`,
      }).catch(() => null);
      await prisma.emailThread.updateMany({
        where: { id: localThread.id, officeId: targetOfficeId },
        data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
      });
      // CRM touch: resolve the counterparty and log an EMAIL activity.
      // Never throws - CRM logging must not break sync.
      // Unrouted mail belongs to no customer, so it never enters office memory.
      if (!unroutedMessage) {
        await logEmailTouch({
          officeId: targetOfficeId,
          threadId: localThread.id,
          messageId: createdMessage.id,
          direction,
          fromEmail,
          toEmails: toRaw ? [toRaw] : [],
          subject,
          snippet: body || null,
          sentAt,
        });
        routedOfficeIds.add(targetOfficeId);
      }
      created++;
    }

    if (localThread && !touchedThreadDbIds.includes(localThread.id)) {
      touchedThreadDbIds.push(localThread.id);
      if (localThread.autoLinkSkipReason !== UNROUTED_MAIL_THREAD_MARKER) {
        routedThreadDbIds.push(localThread.id);
      }
    }
  }

  // Mail is ingested and classified only - it never auto-creates RFQs. Both
  // the mail funnel and the Meta lead funnel land in Google Sheets, and the
  // sheet sync is the single automated source of new Inquiries. Operators can
  // still promote a thread manually from the inbox ("Create RFQ from thread").

  // Pre-warm supplier-offer summaries out-of-band. This is AI-heavy work; it
  // should not live inside the Gmail sync request.
  const prewarmOfficeIds = routedOfficeIds.size > 0
    ? Array.from(routedOfficeIds)
    : [account.officeId];
  for (const prewarmOfficeId of prewarmOfficeIds) {
    await enqueueBackgroundJob({
      officeId: prewarmOfficeId,
      type: "PREWARM_OPEN_SOURCING",
      payload: { officeId: prewarmOfficeId },
      dedupeKey: `prewarm-open-sourcing:${prewarmOfficeId}`,
    }).catch(() => null);
  }

  // Auto-classify any new email attachments into JobDocuments on linked jobs.
  // Limited to active (non-DELIVERED) jobs that received new messages this run.
  const jobsTouched = await prisma.job.findMany({
    where: {
      officeId: { in: prewarmOfficeIds },
      status: { notIn: ["DELIVERED", "CANCELLED"] },
      OR: [
        { emailThreads: { some: { id: { in: routedThreadDbIds } } } },
        { inquiry: { emailThreads: { some: { id: { in: routedThreadDbIds } } } } },
      ],
    },
    select: { id: true, officeId: true },
    take: 30,
  });
  for (const j of jobsTouched) {
    try { await classifyEmailAttachments({ jobId: j.id, officeId: j.officeId }); } catch {}
  }

  await prisma.emailAccount.updateMany({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/settings/email");
  return {
    ok: true,
    processed,
    created,
    threadsTouched: touchedThreadDbIds.length,
    unrouted,
    // Mail never auto-creates RFQs anymore; fields kept for result-shape compat.
    autoInquiries: 0,
    autoLinked: 0,
  };
}

export async function enqueueGmailBackfillJobsForAccount(input: {
  accountId: string;
  officeId: string;
}): Promise<{ queued: number; skipped: number }> {
  const windows = buildGmailBackfillWindows();
  const recentDoneCutoff = new Date(Date.now() - BACKFILL_DEDUPE_DAYS * 24 * 60 * 60 * 1000);
  let queued = 0;
  let skipped = 0;

  for (const window of windows) {
    const dedupeKey = `gmail-backfill:${input.accountId}:${window.label}`;
    const existing = await prisma.backgroundJob.findFirst({
      where: {
        officeId: input.officeId,
        type: "GMAIL_SYNC_WINDOW",
        dedupeKey,
        OR: [
          { status: { in: ["QUEUED", "RUNNING"] } },
          { status: "DONE", completedAt: { gte: recentDoneCutoff } },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await enqueueBackgroundJob({
      officeId: input.officeId,
      type: "GMAIL_SYNC_WINDOW",
      payload: {
        accountId: input.accountId,
        officeId: input.officeId,
        label: window.label,
        after: window.after,
        before: window.before,
        query: window.query,
        threadFetchLimit: GMAIL_BACKFILL_THREADS_PER_WINDOW,
      },
      dedupeKey,
      maxAttempts: 3,
    });
    queued++;
  }

  return { queued, skipped };
}

export async function syncDeryaLoadRfqInboxes(): Promise<
  | {
      ok: true;
      requested: string[];
      missing: string[];
      accounts: number;
      created: number;
      threadsTouched: number;
      autoInquiries: number;
      autoLinked: number;
      backfillQueued: number;
      backfillSkipped: number;
      results: Array<{ email: string; ok: boolean; created?: number; threadsTouched?: number; autoInquiries?: number; autoLinked?: number; backfillQueued?: number; backfillSkipped?: number; error?: string }>;
    }
  | { error: string }
> {
  const session = await requireEmailAccountAdminSession();
  const accounts = await prisma.emailAccount.findMany({
    where: {
      // Mailboxes are one shared pool, so these inboxes are found globally.
      provider: "GMAIL",
      isActive: true,
      OR: DERYA_LOAD_RFQ_INBOX_EMAILS.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
    },
    orderBy: { email: "asc" },
  });
  const connected = new Set(accounts.map((account) => account.email.toLowerCase()));
  const missing = DERYA_LOAD_RFQ_INBOX_EMAILS.filter((email) => !connected.has(email));

  const results: Array<{ email: string; ok: boolean; created?: number; threadsTouched?: number; autoInquiries?: number; autoLinked?: number; backfillQueued?: number; backfillSkipped?: number; error?: string }> = [];
  for (const account of accounts) {
    try {
      const result = await _syncEmailAccountInternal({ accountId: account.id, officeId: session.officeId });
      if ("error" in result) {
        results.push({ email: account.email, ok: false, error: result.error });
      } else {
        const backfill = await enqueueGmailBackfillJobsForAccount({ accountId: account.id, officeId: session.officeId });
        results.push({
          email: account.email,
          ok: true,
          created: result.created,
          threadsTouched: result.threadsTouched,
          autoInquiries: result.autoInquiries,
          autoLinked: result.autoLinked,
          backfillQueued: backfill.queued,
          backfillSkipped: backfill.skipped,
        });
      }
    } catch (e) {
      results.push({ email: account.email, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ok: true,
    requested: DERYA_LOAD_RFQ_INBOX_EMAILS,
    missing,
    accounts: accounts.length,
    created: results.reduce((sum, item) => sum + (item.created ?? 0), 0),
    threadsTouched: results.reduce((sum, item) => sum + (item.threadsTouched ?? 0), 0),
    autoInquiries: results.reduce((sum, item) => sum + (item.autoInquiries ?? 0), 0),
    autoLinked: results.reduce((sum, item) => sum + (item.autoLinked ?? 0), 0),
    backfillQueued: results.reduce((sum, item) => sum + (item.backfillQueued ?? 0), 0),
    backfillSkipped: results.reduce((sum, item) => sum + (item.backfillSkipped ?? 0), 0),
    results,
  };
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  await requireEmailAccountAdminSession();
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { isActive: false, sendEnabled: false, isDefaultSender: false },
  });
  revalidatePath("/dashboard/settings/email");
  revalidatePath("/dashboard/settings/connected-emails");
  revalidatePath("/dashboard/inbox");
}

// Re-enable a paused account: sync resumes and its threads reappear in the inbox.
export async function resumeEmailAccount(accountId: string): Promise<void> {
  await requireEmailAccountAdminSession();
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { isActive: true },
  });
  revalidatePath("/dashboard/settings/email");
  revalidatePath("/dashboard/settings/connected-emails");
  revalidatePath("/dashboard/inbox");
}

// Re-run classification over already-synced messages.
export async function reclassifyMessages(args: { onlyUnclassified?: boolean; limit?: number } = {}): Promise<{ ok: true; processed: number; relinked: number; autoInquiries: number } | { error: string }> {
  const session = await requireSession();
  const limit = args.limit ?? 100;

  const where: any = {
    direction: "INBOUND",
    account: { officeId: session.officeId },
  };
  if (args.onlyUnclassified) where.classification = null;

  const messages = await prisma.emailMessage.findMany({
    where,
    include: { thread: true },
    orderBy: { sentAt: "desc" },
    take: limit,
  });

  let processed = 0;
  let relinked = 0;

  for (const m of messages) {
    if (!m.bodyText && !m.subject) continue;
    try {
      const cls = await classifyInboundEmail({
        subject: m.subject ?? "",
        fromEmail: m.fromEmail,
        bodyText: m.bodyText ?? "",
        officeId: session.officeId,
      });
      processed++;

      await prisma.emailMessage.updateMany({
        where: { id: m.id, thread: { officeId: session.officeId } },
        data: {
          classification: cls.kind,
          classificationReason: cls.reason,
          classificationAt: new Date(),
        },
      });

      if (m.thread && !m.thread.jobId && !m.thread.inquiryId) {
        if (cls.matchJobId) {
          await prisma.emailThread.updateMany({
            where: { id: m.thread.id, officeId: session.officeId },
            data: { jobId: cls.matchJobId },
          });
          relinked++;
        } else if (cls.matchInquiryId) {
          await prisma.emailThread.updateMany({
            where: { id: m.thread.id, officeId: session.officeId },
            data: { inquiryId: cls.matchInquiryId },
          });
          relinked++;
        }
      }
    } catch {
      // skip on error, keep going
    }
  }

  // Reclassification only relabels messages and links threads to EXISTING
  // inquiries/jobs - it never creates new RFQs from mail.
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/jobs");
  return { ok: true, processed, relinked, autoInquiries: 0 };
}
