import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyDeliveryFeedback,
  decodeStoredDeliveryFeedback,
  DELIVERY_FEEDBACK_CLASSIFICATION,
  encodeStoredDeliveryFeedback,
  senderProtectionDecision,
  senderProtectionRecoveryDecision,
  SENDER_PROTECTION_COOLDOWN_HOURS,
  SENDER_PROTECTION_WINDOW_HOURS,
  EMAIL_SUPPRESSION_REASONS,
  type DeliveryFeedback,
  type DeliveryFeedbackInput,
  type EmailSuppressionReason,
} from "@/lib/email-delivery-feedback";
import { UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";

type DeliveryDb = PrismaClient | Prisma.TransactionClient;

export type { EmailSuppressionReason };

export type DeliveryFeedbackSource = "GMAIL" | "GMAIL_IMAP";

export type RecordedDeliveryFeedback = {
  feedback: DeliveryFeedback;
  officeId: string;
  recipients: string[];
  suppressed: string[];
  senderPaused: boolean;
};

export type DeliveryFeedbackRouting =
  // The report answers a known thread, so its office is the thread's office.
  | { routed: true; officeId: string }
  // The report answers no known thread. The connecting office is provenance
  // only, so the offices that mailed the affected addresses from this mailbox
  // are looked up before anything is suppressed.
  | { routed: false; fallbackOfficeId: string };

// Unknown stored reasons still block sending; they are reported as MANUAL.
function storedSuppressionReason(value: string): EmailSuppressionReason {
  return (EMAIL_SUPPRESSION_REASONS as readonly string[]).includes(value)
    ? (value as EmailSuppressionReason)
    : "MANUAL";
}

function suppressionReasonFor(feedback: DeliveryFeedback): EmailSuppressionReason | null {
  if (feedback.kind === "BOUNCE") return feedback.permanent ? "BOUNCED" : null;
  if (feedback.kind === "COMPLAINT") return "COMPLAINED";
  if (feedback.kind === "OPT_OUT") return "OPTED_OUT";
  return null;
}

function parseAddressList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .flatMap((entry) => entry.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])
      .map((email) => email.toLowerCase());
  } catch {
    return [];
  }
}

// A DSN that names no recipient still refers to the message we sent in the
// same thread, so the last outbound recipients are the affected addresses.
async function threadOutboundRecipients(db: DeliveryDb, officeId: string, threadId: string) {
  const outbound = await db.emailMessage.findFirst({
    where: { officeId, threadId, direction: "OUTBOUND" },
    orderBy: { sentAt: "desc" },
    select: { toEmails: true, ccEmails: true },
  });
  return [...parseAddressList(outbound?.toEmails), ...parseAddressList(outbound?.ccEmails)];
}

// Offices that wrote to any of the affected addresses from this mailbox. One
// office is a unique origin; several offices, or none, mean the report cannot
// be attributed from outbound history alone.
export async function resolveUnroutedFeedbackOffices(
  db: DeliveryDb,
  input: { accountId: string | null; recipients: readonly string[] },
): Promise<string[]> {
  const wanted = new Set(input.recipients.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@")));
  if (!input.accountId || wanted.size === 0) return [];
  const outbound = await db.emailMessage.findMany({
    where: {
      accountId: input.accountId,
      direction: "OUTBOUND",
      OR: [...wanted].flatMap((email) => [
        { toEmails: { contains: email, mode: "insensitive" as const } },
        { ccEmails: { contains: email, mode: "insensitive" as const } },
      ]),
    },
    select: { toEmails: true, ccEmails: true, thread: { select: { officeId: true } } },
  });
  const offices = new Set<string>();
  for (const message of outbound) {
    const addressed = [...parseAddressList(message.toEmails), ...parseAddressList(message.ccEmails)];
    if (!addressed.some((email) => wanted.has(email))) continue;
    offices.add(message.thread.officeId);
  }
  return [...offices].sort();
}

async function senderProtectionWindow(
  db: DeliveryDb,
  input: { accountId: string; now: Date },
): Promise<{ sent: number; permanentBounces: number; complaints: number }> {
  const since = new Date(input.now.getTime() - SENDER_PROTECTION_WINDOW_HOURS * 3_600_000);
  const [sent, permanentBounces, complaints] = await Promise.all([
    db.emailMessage.count({
      where: { accountId: input.accountId, direction: "OUTBOUND", sentAt: { gte: since } },
    }),
    db.emailDeliveryEvent.count({
      where: { accountId: input.accountId, kind: "BOUNCE", permanent: true, occurredAt: { gte: since } },
    }),
    db.emailDeliveryEvent.count({
      where: { accountId: input.accountId, kind: "COMPLAINT", occurredAt: { gte: since } },
    }),
  ]);
  return { sent, permanentBounces, complaints };
}

export async function applySenderProtection(
  db: DeliveryDb,
  // `newEvidence` false means this call carries no bounce or complaint the
  // mailbox has not already been judged on, so an existing pause keeps its own
  // time and a retry cannot postpone recovery.
  input: { accountId: string; now: Date; newEvidence?: boolean },
): Promise<{ paused: boolean; reason: string | null }> {
  const window = await senderProtectionWindow(db, input);
  const decision = senderProtectionDecision(window);
  if (!decision.pause) return { paused: false, reason: null };
  // New evidence restates an existing pause with the current reason and time.
  // That is what tells recovery its measurement is stale: recovery resumes
  // against the pause it judged, so a mailbox that crossed the threshold again
  // while recovery was measuring a clean window would otherwise be resumed on
  // that stale judgement.
  //
  // The restate is attempted first, so a recovery landing between the two
  // writes leaves the mailbox paused either way: either the restate wins and
  // recovery's guard is stale, or the restate finds the mailbox already
  // resumed and the pause below applies to it afresh.
  if (input.newEvidence ?? true) {
    const restated = await db.emailAccount.updateMany({
      where: { id: input.accountId, sendPausedAt: { not: null } },
      data: { sendPausedAt: input.now, sendPausedReason: decision.reason },
    });
    // The return value says whether this report is what took the mailbox out
    // of the pool, so a restated pause is not reported as a new one.
    if (restated.count > 0) return { paused: false, reason: decision.reason };
  }
  const paused = await db.emailAccount.updateMany({
    where: { id: input.accountId, sendPausedAt: null },
    data: { sendPausedAt: input.now, sendPausedReason: decision.reason },
  });
  return { paused: paused.count > 0, reason: decision.reason };
}

export async function upsertEmailSuppression(
  db: DeliveryDb,
  input: {
    officeId: string;
    email: string;
    reason: EmailSuppressionReason;
    source: string;
    detail: string | null;
    evidenceMessageId: string | null;
    accountId: string | null;
  },
) {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return null;
  return db.emailSuppression.upsert({
    where: { officeId_email: { officeId: input.officeId, email } },
    create: {
      officeId: input.officeId,
      email,
      reason: input.reason,
      source: input.source,
      detail: input.detail,
      evidenceMessageId: input.evidenceMessageId,
      accountId: input.accountId,
    },
    update: {
      reason: input.reason,
      source: input.source,
      detail: input.detail,
      evidenceMessageId: input.evidenceMessageId,
      accountId: input.accountId,
    },
  });
}

// Persists one feedback message: the event, the suppressions it implies, and
// the sender check. Every step is idempotent, and `EmailMessage.deliveryKind`
// is written last so a message whose classification says delivery feedback but
// whose deliveryKind is still null is known to need another attempt.
export async function recordDeliveryFeedback(
  db: DeliveryDb,
  input: {
    routing: DeliveryFeedbackRouting;
    accountId: string | null;
    messageId: string;
    threadId: string;
    occurredAt: Date;
    source: DeliveryFeedbackSource;
    feedback: DeliveryFeedback;
    now?: Date;
  },
): Promise<RecordedDeliveryFeedback> {
  const now = input.now ?? new Date();
  const needsRecipients = input.feedback.kind === "BOUNCE" || input.feedback.kind === "COMPLAINT";
  const recipients = input.feedback.recipients.length || !needsRecipients || !input.routing.routed
    ? input.feedback.recipients
    : await threadOutboundRecipients(db, input.routing.officeId, input.threadId);
  const detail = input.feedback.detail || null;

  // An unthreaded report suppresses only when exactly one office mailed the
  // affected addresses from this mailbox. With several candidate offices, or
  // none, the event is parked on the connecting office for manual routing and
  // no office-scoped suppression is written.
  const originOfficeIds = input.routing.routed
    ? [input.routing.officeId]
    : await resolveUnroutedFeedbackOffices(db, { accountId: input.accountId, recipients });
  const suppressionOfficeIds = originOfficeIds.length === 1 ? originOfficeIds : [];
  const officeId = suppressionOfficeIds[0]
    ?? (input.routing.routed ? input.routing.officeId : input.routing.fallbackOfficeId);

  // Only the call that writes the event carries evidence the mailbox has not
  // been judged on. Insertion decides that, so two concurrent copies of one
  // report cannot both claim it and postpone recovery between them.
  const storedHere = await db.emailDeliveryEvent
    .create({
      data: {
        officeId,
        accountId: input.accountId,
        messageId: input.messageId,
        kind: input.feedback.kind,
        permanent: input.feedback.permanent,
        recipients: JSON.stringify(recipients),
        detail,
        occurredAt: input.occurredAt,
      },
    })
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return false;
      throw error;
    });

  const reason = suppressionReasonFor(input.feedback);
  const suppressed: string[] = [];
  if (reason) {
    for (const suppressionOfficeId of suppressionOfficeIds) {
      for (const email of recipients) {
        const row = await upsertEmailSuppression(db, {
          officeId: suppressionOfficeId,
          email,
          reason,
          source: input.source,
          detail,
          evidenceMessageId: input.messageId,
          accountId: input.accountId,
        });
        if (row && !suppressed.includes(row.email)) suppressed.push(row.email);
      }
    }
  }

  let senderPaused = false;
  const affectsSender = input.accountId
    && ((input.feedback.kind === "BOUNCE" && input.feedback.permanent) || input.feedback.kind === "COMPLAINT");
  if (affectsSender && input.accountId) {
    const protection = await applySenderProtection(db, {
      accountId: input.accountId,
      now,
      newEvidence: storedHere,
    });
    senderPaused = protection.paused;
  }

  await db.emailMessage.updateMany({
    where: { id: input.messageId },
    data: { deliveryKind: input.feedback.kind },
  });

  return { feedback: input.feedback, officeId, recipients, suppressed, senderPaused };
}

// True for a stored message the parser recognised whose persistence did not
// finish, so a later sync of the same provider message completes it.
export function deliveryFeedbackNeedsRecovery(message: { classification: string | null; deliveryKind: string | null }) {
  return message.classification === DELIVERY_FEEDBACK_CLASSIFICATION && message.deliveryKind === null;
}

export const DELIVERY_FEEDBACK_RECOVERY_BATCH = 50;

// Completes stored feedback messages whose persistence never finished, from
// the database alone. Sync windows only revisit recent provider messages, so
// this runs once per mailbox sync and does not depend on the message being
// fetched again. The feedback is read back from classificationReason; rows
// stored before that encoding are re-parsed from the stored body.
//
// For these rows classificationAt is the time of the last attempt. The batch
// takes the least recently attempted rows and every row that does not finish
// is stamped, so a row that keeps failing or cannot be decoded moves to the
// back of the queue instead of occupying the batch on every sync.
export async function recoverUnfinishedDeliveryFeedback(
  db: DeliveryDb,
  input: {
    accountId: string;
    accountEmail: string;
    fallbackOfficeId: string;
    source: DeliveryFeedbackSource;
    now?: Date;
  },
): Promise<{ pending: number; completed: number }> {
  const now = input.now ?? new Date();
  const pending = await db.emailMessage.findMany({
    where: {
      accountId: input.accountId,
      classification: DELIVERY_FEEDBACK_CLASSIFICATION,
      deliveryKind: null,
    },
    orderBy: [{ classificationAt: { sort: "asc", nulls: "first" } }, { sentAt: "asc" }],
    take: DELIVERY_FEEDBACK_RECOVERY_BATCH,
    select: {
      id: true,
      threadId: true,
      sentAt: true,
      fromEmail: true,
      subject: true,
      bodyText: true,
      classificationReason: true,
      thread: { select: { officeId: true, autoLinkSkipReason: true } },
    },
  });
  let completed = 0;
  for (const message of pending) {
    const feedback = decodeStoredDeliveryFeedback(message.classificationReason)
      ?? classifyDeliveryFeedback({
        fromEmail: message.fromEmail,
        subject: message.subject ?? "",
        bodyText: message.bodyText ?? "",
        headers: [],
        ownAddresses: [input.accountEmail],
      });
    let finished = false;
    if (feedback) {
      try {
        await recordDeliveryFeedback(db, {
          routing: message.thread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER
            ? { routed: false, fallbackOfficeId: input.fallbackOfficeId }
            : { routed: true, officeId: message.thread.officeId },
          accountId: input.accountId,
          messageId: message.id,
          threadId: message.threadId,
          occurredAt: message.sentAt,
          source: input.source,
          feedback,
          now,
        });
        completed++;
        finished = true;
      } catch {
        // Stamped below and retried on a later sync; deliveryKind stays null.
      }
    }
    if (!finished) {
      await db.emailMessage.updateMany({
        where: { id: message.id },
        data: { classificationAt: now },
      }).catch(() => null);
    }
  }
  return { pending: pending.length, completed };
}

// Inbound rows stored before the parser existed (or before the parser learned
// a provider's format) carry an AI classification and no deliveryKind, so a
// bounce among them counts as a human reply and its address is never
// suppressed. Only rows that look like provider reports are revisited: daemon
// senders and delivery-failure subjects within the lookback window.
export const LEGACY_FEEDBACK_LOOKBACK_DAYS = 90;
const LEGACY_FEEDBACK_SENDER_PREFIXES = ["mailer-daemon", "postmaster", "mail-daemon", "maildaemon"];
const LEGACY_FEEDBACK_SUBJECT_TERMS = [
  "delivery status notification",
  "undeliverable",
  "undelivered",
  "mail delivery failed",
  "mail delivery failure",
  "delivery failure",
  "failure notice",
  "returned to sender",
];

export function legacyDeliveryFeedbackWhere(input: { accountId: string; since: Date }): Prisma.EmailMessageWhereInput {
  return {
    accountId: input.accountId,
    direction: "INBOUND",
    deliveryKind: null,
    sentAt: { gte: input.since },
    AND: [
      // SQL `<>` drops NULL rows, so unclassified rows are listed explicitly.
      { OR: [{ classification: null }, { classification: { not: DELIVERY_FEEDBACK_CLASSIFICATION } }] },
      {
        OR: [
          ...LEGACY_FEEDBACK_SENDER_PREFIXES.map((prefix) => ({
            fromEmail: { startsWith: prefix, mode: "insensitive" as const },
          })),
          ...LEGACY_FEEDBACK_SUBJECT_TERMS.map((term) => ({
            subject: { contains: term, mode: "insensitive" as const },
          })),
        ],
      },
    ],
  };
}

// Re-parses report-looking legacy rows from their stored body. A recognised
// row is first re-labelled as stored delivery feedback (so a failure after
// that point is finished by recoverUnfinishedDeliveryFeedback), then
// persisted. Rows the parser does not recognise are stamped so they move to
// the back of the queue like unfinished rows do.
export async function recoverLegacyDeliveryFeedback(
  db: DeliveryDb,
  input: {
    accountId: string;
    accountEmail: string;
    fallbackOfficeId: string;
    source: DeliveryFeedbackSource;
    now?: Date;
  },
): Promise<{ pending: number; completed: number }> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - LEGACY_FEEDBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const pending = await db.emailMessage.findMany({
    where: legacyDeliveryFeedbackWhere({ accountId: input.accountId, since }),
    orderBy: [{ classificationAt: { sort: "asc", nulls: "first" } }, { sentAt: "asc" }],
    take: DELIVERY_FEEDBACK_RECOVERY_BATCH,
    select: {
      id: true,
      threadId: true,
      sentAt: true,
      fromEmail: true,
      subject: true,
      bodyText: true,
      thread: { select: { officeId: true, autoLinkSkipReason: true } },
    },
  });
  let completed = 0;
  for (const message of pending) {
    const feedback = classifyDeliveryFeedback({
      fromEmail: message.fromEmail,
      subject: message.subject ?? "",
      bodyText: message.bodyText ?? "",
      headers: [],
      ownAddresses: [input.accountEmail],
    });
    if (!feedback) {
      await db.emailMessage.updateMany({
        where: { id: message.id },
        data: { classificationAt: now },
      }).catch(() => null);
      continue;
    }
    try {
      await db.emailMessage.updateMany({
        where: { id: message.id, deliveryKind: null },
        data: {
          classification: DELIVERY_FEEDBACK_CLASSIFICATION,
          classificationReason: encodeStoredDeliveryFeedback(feedback),
          classificationAt: now,
        },
      });
      await recordDeliveryFeedback(db, {
        routing: message.thread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER
          ? { routed: false, fallbackOfficeId: input.fallbackOfficeId }
          : { routed: true, officeId: message.thread.officeId },
        accountId: input.accountId,
        messageId: message.id,
        threadId: message.threadId,
        occurredAt: message.sentAt,
        source: input.source,
        feedback,
        now,
      });
      completed++;
    } catch {
      // Once re-labelled, the unfinished-feedback sweep retries persistence.
    }
  }
  return { pending: pending.length, completed };
}

// Convenience for the sync paths: classify, and persist only when the message
// is delivery feedback. Returns null for ordinary human mail.
export async function captureDeliveryFeedback(
  db: DeliveryDb,
  input: Omit<DeliveryFeedbackInput, "ownAddresses"> & {
    routing: DeliveryFeedbackRouting;
    accountId: string | null;
    accountEmail: string;
    messageId: string;
    threadId: string;
    occurredAt: Date;
    source: DeliveryFeedbackSource;
    now?: Date;
  },
): Promise<RecordedDeliveryFeedback | null> {
  const feedback = classifyDeliveryFeedback({
    fromEmail: input.fromEmail,
    subject: input.subject,
    bodyText: input.bodyText,
    headers: input.headers,
    ownAddresses: [input.accountEmail],
  });
  if (!feedback) return null;
  return recordDeliveryFeedback(db, {
    routing: input.routing,
    accountId: input.accountId,
    messageId: input.messageId,
    threadId: input.threadId,
    occurredAt: input.occurredAt,
    source: input.source,
    feedback,
    now: input.now,
  });
}

export type SuppressionLookupDb = {
  emailSuppression: {
    findMany: (args: {
      where: { officeId: string; email: { in: string[] } };
      select: { email: true; reason: true };
    }) => Promise<Array<{ email: string; reason: string }>>;
  };
};

export async function listSuppressedEmails(
  officeId: string,
  emails: readonly string[],
  db: SuppressionLookupDb = prisma,
): Promise<Map<string, EmailSuppressionReason>> {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@")))];
  if (!normalized.length) return new Map();
  const rows = await db.emailSuppression.findMany({
    where: { officeId, email: { in: normalized } },
    select: { email: true, reason: true },
  });
  return new Map(rows.map((row) => [row.email, storedSuppressionReason(row.reason)]));
}

export async function resumeSenderAccount(accountId: string, db: DeliveryDb = prisma) {
  const updated = await db.emailAccount.updateMany({
    where: { id: accountId, sendPausedAt: { not: null } },
    data: { sendPausedAt: null, sendPausedReason: null },
  });
  return updated.count > 0;
}

export type SenderRecoveryResult = {
  scanned: number;
  resumed: { id: string; email: string; pausedReason: string | null }[];
  held: { id: string; email: string; reason: string; eligibleAt: string }[];
};

export const SENDER_RECOVERY_SCAN_LIMIT = 50;
// One page of paused mailboxes per 15 minutes, so a scheduled pass and the next
// one do not read the same page.
export const SENDER_RECOVERY_ROTATION_MS = 15 * 60_000;

// Sender protection pauses a mailbox but nothing ever lifted the pause, so one
// bad day of bounces removed a mailbox from the pool for good and the shared
// pool shrank until no supplier conversation could be answered at all. Every
// paused mailbox whose cooldown has passed is judged again on the current
// window and resumed when it reads clean.
export async function recoverPausedSenderAccounts(
  input: { now: Date; limit?: number },
  db: DeliveryDb = prisma,
): Promise<SenderRecoveryResult> {
  const limit = input.limit ?? SENDER_RECOVERY_SCAN_LIMIT;
  // Only mailboxes past the cooldown are read, so a fleet paused all at once
  // does not spend the scan on mailboxes that cannot be resumed yet.
  const where = {
    isActive: true,
    sendEnabled: true,
    sendPausedAt: {
      not: null,
      lte: new Date(input.now.getTime() - SENDER_PROTECTION_COOLDOWN_HOURS * 3_600_000),
    },
  };
  // Held mailboxes keep their pause time, so reading the oldest page every
  // pass would let the same unhealthy mailboxes starve every mailbox behind
  // them. The page rotates with the clock instead, so a fleet larger than one
  // scan is covered across passes.
  const eligible = await db.emailAccount.count({ where });
  const pages = Math.max(1, Math.ceil(eligible / limit));
  const page = Math.floor(input.now.getTime() / SENDER_RECOVERY_ROTATION_MS) % pages;
  const paused = await db.emailAccount.findMany({
    where,
    orderBy: [{ sendPausedAt: "asc" }, { id: "asc" }],
    skip: page * limit,
    take: limit,
    select: { id: true, email: true, sendPausedAt: true, sendPausedReason: true },
  });
  const result: SenderRecoveryResult = { scanned: paused.length, resumed: [], held: [] };
  for (const account of paused) {
    if (!account.sendPausedAt) continue;
    const window = await senderProtectionWindow(db, { accountId: account.id, now: input.now });
    const decision = senderProtectionRecoveryDecision({
      pausedAt: account.sendPausedAt,
      now: input.now,
      ...window,
    });
    if (!decision.resume) {
      result.held.push({
        id: account.id,
        email: account.email,
        reason: decision.reason,
        eligibleAt: decision.eligibleAt.toISOString(),
      });
      continue;
    }
    // The pause timestamp is part of the guard, so a mailbox paused again
    // between the read and this write keeps its newer pause instead of being
    // resumed on a judgement made about the older one. Disabling the mailbox
    // mid scan is an operator decision, and it holds too: resuming would clear
    // the pause and put the mailbox back in the pool the moment the operator
    // re-enabled it, without protection having judged it.
    const updated = await db.emailAccount.updateMany({
      where: { id: account.id, isActive: true, sendEnabled: true, sendPausedAt: account.sendPausedAt },
      data: { sendPausedAt: null, sendPausedReason: null },
    });
    if (updated.count > 0) {
      result.resumed.push({ id: account.id, email: account.email, pausedReason: account.sendPausedReason });
      continue;
    }
    result.held.push({
      id: account.id,
      email: account.email,
      reason: "Paused again, or taken out of the pool, while this pass was resuming it.",
      eligibleAt: new Date(input.now.getTime() + SENDER_PROTECTION_COOLDOWN_HOURS * 3_600_000).toISOString(),
    });
  }
  return result;
}
