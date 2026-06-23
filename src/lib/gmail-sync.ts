"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { getValidAccessToken } from "./gmail-oauth";
import { classifyInboundEmail } from "./email-classifier";
import { autoCreateInquiryFromThread } from "./thread-actions";
import { ensureProposedJobsForOpenInquiries } from "./job-actions";
import { classifyEmailAttachments } from "./doc-classify";
import { enqueueBackgroundJob } from "./background-jobs";
import { ingestKnowledgeObject } from "./memory/ingest-object";
import { recordMemoryEvent } from "./memory/record-event";

// Sync envelope: how many threads max we'll touch in one run, and how far back
// to look. Each thread is one Gmail API call regardless of how many messages
// it contains, so we can be generous. Message dedupe by externalId means
// re-scanning old threads is cheap (one HEAD-style check each).
const THREAD_FETCH_LIMIT = 500;
const PAGE_SIZE = 100;
// Always sweep at least the last year on every sync — users want their full
// inbox visible, not just what arrived since last sync.
const SYNC_WINDOW = "newer_than:365d";
// After sync, run AI auto-inquiry on this many unlinked threads.
const AUTO_INQUIRY_LIMIT = 60;

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
  | { ok: true; processed: number; created: number; threadsTouched: number; autoInquiries: number; autoLinked: number }
  | { error: string }
> {
  const session = await requireSession();
  return _syncEmailAccountInternal({ accountId, officeId: session.officeId });
}

// Cron-callable version that skips the session check. Caller must already
// have authorized via the cron secret.
export async function syncEmailAccountInternal(accountId: string, officeId: string): Promise<
  | { ok: true; processed: number; created: number; threadsTouched: number; autoInquiries: number; autoLinked: number }
  | { error: string }
> {
  return _syncEmailAccountInternal({ accountId, officeId });
}

async function _syncEmailAccountInternal({ accountId, officeId }: { accountId: string; officeId: string }): Promise<
  | { ok: true; processed: number; created: number; threadsTouched: number; autoInquiries: number; autoLinked: number }
  | { error: string }
> {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, officeId },
  });
  if (!account) return { error: "Account not found" };
  if (account.provider !== "GMAIL") return { error: "Only Gmail sync is implemented" };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(accountId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token refresh failed" };
  }

  // Sweep the last year on every sync. Per-message dedupe by externalId means
  // rescanning old threads is essentially free, and operators want their full
  // inbox available, not just deltas since the previous sync.
  const threadIds = await listThreadIds(accessToken, SYNC_WINDOW, THREAD_FETCH_LIMIT);

  let processed = 0;
  let created = 0;
  const touchedThreadDbIds: string[] = [];

  for (const tid of threadIds) {
    const thread = await fetchThread(accessToken, tid);
    if (!thread || !thread.messages || thread.messages.length === 0) continue;

    // Find or stub our local EmailThread for this Gmail thread.
    let localThread = await prisma.emailThread.findFirst({
      where: { officeId: account.officeId, externalThreadId: tid },
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

      // Skip if already in DB.
      const existing = await prisma.emailMessage.findUnique({ where: { externalId } });
      if (existing) {
        // If we don't have a local thread yet, adopt from existing message.
        if (!localThread) {
          localThread = await prisma.emailThread.findFirst({
            where: { id: existing.threadId, officeId: account.officeId },
          });
          // Backfill externalThreadId so future syncs map directly.
          if (localThread && !localThread.externalThreadId) {
            await prisma.emailThread.updateMany({
              where: { id: localThread.id, officeId: account.officeId },
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

      // Per-message classification (lightweight; AI may match an existing job/inquiry).
      let classificationLabel: string | null = null;
      let classificationReason: string | null = null;
      let classifiedMatchJobId: string | null = null;
      let classifiedMatchInquiryId: string | null = null;
      if (direction === "INBOUND") {
        try {
          const cls = await classifyInboundEmail({
            subject, fromEmail, bodyText: body, officeId: account.officeId,
          });
          classificationLabel = cls.kind;
          classificationReason = cls.reason;
          if (cls.matchJobId) classifiedMatchJobId = cls.matchJobId;
          if (cls.matchInquiryId) classifiedMatchInquiryId = cls.matchInquiryId;
        } catch {
          // ignore — message still gets stored
        }
      }

      // Create the thread on first inserted message.
      if (!localThread) {
        localThread = await prisma.emailThread.create({
          data: {
            officeId: account.officeId,
            subject,
            participants: JSON.stringify([fromEmail, account.email]),
            externalThreadId: tid,
            jobId: classifiedMatchJobId,
            inquiryId: classifiedMatchInquiryId,
            lastMessageAt: sentAt,
          },
        });
      } else if (!localThread.jobId && !localThread.inquiryId && (classifiedMatchJobId || classifiedMatchInquiryId)) {
        // Adopt link from this message if the thread isn't yet linked.
        await prisma.emailThread.updateMany({
          where: { id: localThread.id, officeId: account.officeId },
          data: { jobId: classifiedMatchJobId, inquiryId: classifiedMatchInquiryId },
        });
        localThread.jobId = classifiedMatchJobId;
        localThread.inquiryId = classifiedMatchInquiryId;
      }

      const createdMessage = await prisma.emailMessage.create({
        data: {
          threadId: localThread.id,
          accountId: account.id,
          externalId,
          gmailMessageId: msg.id,
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
        attachments,
      };
      const memoryObject = await ingestKnowledgeObject({
        officeId: account.officeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: "GMAIL" },
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
      await recordMemoryEvent({
        officeId: account.officeId,
        sourceType: "GMAIL",
        sourceExternalId,
        sourceLabel: account.email,
        sourceMetadata: { accountId: account.id, provider: "GMAIL" },
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
        where: { id: localThread.id, officeId: account.officeId },
        data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
      });
      created++;
    }

    if (localThread && !touchedThreadDbIds.includes(localThread.id)) {
      touchedThreadDbIds.push(localThread.id);
    }
  }

  // ── Auto-create Inquiries for unlinked freight-related threads ─────────────
  // After sync, walk the unlinked threads in this office and let AI synthesize
  // an Inquiry for each one that looks freight-related. Skips and remembers
  // non-freight threads so we don't re-ask on every sync.
  const unlinked = await prisma.emailThread.findMany({
    where: {
      officeId: account.officeId,
      jobId: null,
      inquiryId: null,
      autoLinkedAt: null,
      messages: { some: { direction: "INBOUND" } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: AUTO_INQUIRY_LIMIT,
    select: { id: true },
  });

  let autoInquiries = 0;
  let autoLinked = 0;
  for (const t of unlinked) {
    try {
      const r = await autoCreateInquiryFromThread(t.id);
      if ("ok" in r) {
        if (r.created) autoInquiries++;
        else if ("linkedInquiryId" in r || "linkedJobId" in r) autoLinked++;
      }
    } catch {
      // best-effort
    }
  }

  // Backfill PROPOSED jobs for any open inquiry that doesn't have one yet.
  await ensureProposedJobsForOpenInquiries(account.officeId);

  // Pre-warm supplier-offer summaries out-of-band. This is AI-heavy work; it
  // should not live inside the Gmail sync request.
  await enqueueBackgroundJob({
    officeId: account.officeId,
    type: "PREWARM_OPEN_SOURCING",
    payload: { officeId: account.officeId },
    dedupeKey: `prewarm-open-sourcing:${account.officeId}`,
  }).catch(() => null);

  // Auto-classify any new email attachments into JobDocuments on linked jobs.
  // Limited to active (non-DELIVERED) jobs that received new messages this run.
  const jobsTouched = await prisma.job.findMany({
    where: {
      officeId: account.officeId,
      status: { notIn: ["DELIVERED", "CANCELLED"] },
      OR: [
        { emailThreads: { some: { id: { in: touchedThreadDbIds } } } },
        { inquiry: { emailThreads: { some: { id: { in: touchedThreadDbIds } } } } },
      ],
    },
    select: { id: true },
    take: 30,
  });
  for (const j of jobsTouched) {
    try { await classifyEmailAttachments({ jobId: j.id, officeId: account.officeId }); } catch {}
  }

  await prisma.emailAccount.updateMany({
    where: { id: accountId, officeId: account.officeId },
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
    autoInquiries,
    autoLinked,
  };
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  const session = await requireSession();
  await prisma.emailAccount.update({
    where: { id: accountId, officeId: session.officeId },
    data: { isActive: false },
  });
  revalidatePath("/dashboard/settings/email");
  revalidatePath("/dashboard/inbox");
}

// Re-enable a paused account: sync resumes and its threads reappear in the inbox.
export async function resumeEmailAccount(accountId: string): Promise<void> {
  const session = await requireSession();
  await prisma.emailAccount.update({
    where: { id: accountId, officeId: session.officeId },
    data: { isActive: true },
  });
  revalidatePath("/dashboard/settings/email");
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

  // After reclassification, retry the auto-link/auto-inquiry pass on ALL
  // unlinked threads — including ones we previously skipped — so newly-created
  // inquiries get a chance to claim related threads (e.g. once a soybean
  // sourcing inquiry exists, the older soybean emails should now link to it).
  // Clear prior skip markers so the AI runs fresh.
  await prisma.emailThread.updateMany({
    where: { officeId: session.officeId, jobId: null, inquiryId: null },
    data: { autoLinkedAt: null, autoLinkSkipReason: null },
  });
  const unlinked = await prisma.emailThread.findMany({
    where: {
      officeId: session.officeId,
      jobId: null,
      inquiryId: null,
      messages: { some: { direction: "INBOUND" } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 40,
    select: { id: true },
  });
  let autoInquiries = 0;
  let autoLinked = 0;
  for (const t of unlinked) {
    try {
      const r = await autoCreateInquiryFromThread(t.id);
      if ("ok" in r) {
        if (r.created) autoInquiries++;
        else if ("linkedInquiryId" in r || "linkedJobId" in r) autoLinked++;
      }
    } catch {
      // best-effort
    }
  }

  // Backfill any open inquiry without a Job.
  await ensureProposedJobsForOpenInquiries(session.officeId);

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/jobs");
  return { ok: true, processed, relinked: relinked + autoLinked, autoInquiries };
}
