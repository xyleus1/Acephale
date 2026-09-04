import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  campaignFollowUpSubject,
  humanReplyMessageFilter,
  normalizeCampaignFollowUps,
  planCampaignFollowUps,
  renderCampaignEmail,
  selectCampaignVariant,
  storedCampaignVariants,
  type CampaignFollowUpCandidate,
  type CampaignFollowUpSkipReason,
  type CampaignFollowUpStep,
  type CampaignPersonalization,
} from "@/lib/outreach-campaign-copy";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { SHARED_MAILBOX_POOL_FILTER } from "@/lib/email-account-pool";
import { utcDayBounds } from "@/lib/email-sender-pool-policy";
import { listSuppressedEmails } from "@/lib/email-delivery-events";
import {
  SENDER_PAUSED_ERROR,
  type SupplierEmailProvider,
  type SupplierEmailSendResult,
} from "@/lib/supply-os/supplier-email-provider";

type FollowUpDb = PrismaClient;
type FollowUpTx = Prisma.TransactionClient;

export const OUTREACH_FOLLOW_UP_RECLAIM_MINUTES = 30;
export const OUTREACH_UNKNOWN_DELIVERY_TIMEOUT_HOURS = 24;

type CapacityCampaign = { id: string; officeId: string; dailyCap: number };

export { humanReplyMessageFilter };

// Serializes first-touch and follow-up claims for one campaign inside the
// claiming transaction.
export async function lockOutreachCampaignClaims(tx: FollowUpTx, campaignId: string) {
  await tx.$queryRaw<Array<{ locked: number }>>`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${`outreach-campaign:${campaignId}`}, 0))
  `;
}

// Remaining sends under the campaign daily cap for the UTC day across both the
// first-touch and follow-up ledgers, including live QUEUED claims.
export async function outreachCampaignRemainingCapacity(tx: FollowUpTx, campaign: CapacityCampaign, now: Date) {
  const { start, end } = utcDayBounds(now);
  const scope = { officeId: campaign.officeId, campaignId: campaign.id };
  const sentToday = await tx.outreachCampaignSend.count({
    where: { ...scope, status: "SENT", sentAt: { gte: start, lt: end } },
  });
  const followUpsToday = await tx.outreachCampaignFollowUp.count({
    where: { ...scope, status: "SENT", sentAt: { gte: start, lt: end } },
  });
  const queuedSends = await tx.outreachCampaignSend.count({ where: { ...scope, status: "QUEUED" } });
  const queuedFollowUps = await tx.outreachCampaignFollowUp.count({ where: { ...scope, status: "QUEUED" } });
  return Math.max(0, campaign.dailyCap - sentToday - followUpsToday - queuedSends - queuedFollowUps);
}

export function outreachUnknownDeliveryExpired(createdAt: Date, now: Date) {
  return now.getTime() - createdAt.getTime() >= OUTREACH_UNKNOWN_DELIVERY_TIMEOUT_HOURS * 3_600_000;
}

// UNKNOWN ledger rows in either ledger whose sender reservation is still
// RESERVED. These keep a campaign ACTIVE so cron reconciliation can settle them.
export async function unresolvedOutreachCampaignDeliveries(
  db: FollowUpDb,
  campaign: { id: string; officeId: string },
) {
  const scope = { officeId: campaign.officeId, campaignId: campaign.id, status: "UNKNOWN", reservationId: { not: null } };
  const [sends, followUps] = await Promise.all([
    db.outreachCampaignSend.findMany({ where: scope, select: { reservationId: true } }),
    db.outreachCampaignFollowUp.findMany({ where: scope, select: { reservationId: true } }),
  ]);
  const reservationIds = [...sends, ...followUps]
    .map((row) => row.reservationId)
    .filter((value): value is string => typeof value === "string");
  if (!reservationIds.length) return 0;
  return db.emailSenderReservation.count({
    where: { officeId: campaign.officeId, id: { in: reservationIds }, status: "RESERVED" },
  });
}

export type CampaignFollowUpOutcome = {
  campaignId: string;
  recordId: string;
  recipient: string;
  step: number;
  state: "SENT" | "ALREADY_SENT" | "REJECTED" | "UNKNOWN" | "POOL_EXHAUSTED" | "SKIPPED";
  skipReason: CampaignFollowUpSkipReason | null;
  senderEmail: string | null;
  error: string | null;
};

export type CampaignFollowUpBatchResult = {
  steps: number;
  attempted: number;
  sent: number;
  alreadySent: number;
  rejected: number;
  unknown: number;
  skipped: number;
  outstanding: number;
  poolExhausted: boolean;
  outcomes: CampaignFollowUpOutcome[];
};

export type FollowUpCampaign = {
  id: string;
  officeId: string;
  subject: string;
  senderAccountId: string | null;
  senderDisplayName: string | null;
  dailyCap: number;
  followUps: Prisma.JsonValue | null;
  variants?: Prisma.JsonValue | null;
  audiencePersonalization: Record<string, CampaignPersonalization>;
};

// Follow-ups reply in the recipient's own thread, so the implied "Re:" subject
// must come from the variant that recipient actually received.
export function followUpInitialSubject(campaign: FollowUpCampaign, recordId: string) {
  const variant = selectCampaignVariant({
    campaignId: campaign.id,
    recordId,
    variants: storedCampaignVariants(campaign.variants ?? null),
  });
  return variant?.subject ?? campaign.subject;
}

export function emptyFollowUpResult(steps = 0): CampaignFollowUpBatchResult {
  return {
    steps,
    attempted: 0,
    sent: 0,
    alreadySent: 0,
    rejected: 0,
    unknown: 0,
    skipped: 0,
    outstanding: 0,
    poolExhausted: false,
    outcomes: [],
  };
}

export function outreachFollowUpIdempotencyKey(campaignId: string, recordId: string, step: number) {
  return `outreach-campaign:${campaignId}:${recordId}:follow-up:${step}`;
}

export function outreachFollowUpRfcMessageId(campaignId: string, recordId: string, step: number) {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "-");
  return `<outreach-${clean(campaignId.slice(0, 8))}-${clean(recordId)}-f${step}@derya.ai>`;
}

export function outreachFollowUpInReplyTo(campaignId: string, recordId: string, step: number) {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "-");
  return step <= 1
    ? `<outreach-${clean(campaignId.slice(0, 8))}-${clean(recordId)}@derya.ai>`
    : outreachFollowUpRfcMessageId(campaignId, recordId, step - 1);
}

export function outreachFollowUpRequestHash(input: {
  campaignId: string;
  recordId: string;
  step: number;
  recipient: string;
  subject: string;
  body: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type OutreachReservationFailureSettlement =
  | { kind: "RELEASE_CLAIM" }
  | { kind: "UNKNOWN"; reservationId: string; senderEmail: string }
  | { kind: "REJECTED" };

// How a claimed ledger row settles when the sender pool refuses a reservation.
// Capacity failures release the claim so the row is retried once the pool has
// room. Every other failure must leave a durable outcome, or the row would be
// reclaimed and refused again on every run and the campaign never completes:
// an open reservation for this key becomes an UNKNOWN row that reconciliation
// settles from the provider, and a terminal conflict becomes REJECTED.
export async function settleOutreachReservationFailure(
  db: FollowUpDb,
  input: { officeId: string; idempotencyKey: string; code: string },
): Promise<OutreachReservationFailureSettlement> {
  if (
    input.code === "POOL_EXHAUSTED"
    || input.code === "POOL_EMPTY"
    // A paused or disconnected pinned mailbox is a wait for that mailbox, not a
    // terminal refusal of this recipient.
    || input.code === "SENDER_UNAVAILABLE"
  ) return { kind: "RELEASE_CLAIM" };
  if (input.code === "DELIVERY_UNCERTAIN") {
    const open = await db.emailSenderReservation.findFirst({
      where: { officeId: input.officeId, idempotencyKey: input.idempotencyKey, status: "RESERVED" },
      select: { id: true, account: { select: { email: true } } },
    });
    if (open) return { kind: "UNKNOWN", reservationId: open.id, senderEmail: open.account.email };
  }
  return { kind: "REJECTED" };
}

export function outreachFollowUpReclaimBefore(now: Date) {
  return new Date(now.getTime() - OUTREACH_FOLLOW_UP_RECLAIM_MINUTES * 60_000);
}

export function renderFollowUpEmail(input: {
  step: CampaignFollowUpStep;
  campaignSubject: string;
  personalization: CampaignPersonalization;
}) {
  const initial = renderCampaignEmail({
    subject: input.campaignSubject,
    bodyTemplate: "",
    row: input.personalization,
  });
  const rendered = renderCampaignEmail({
    subject: input.step.subject ?? "",
    bodyTemplate: input.step.bodyTemplate,
    row: input.personalization,
  });
  return {
    subject: campaignFollowUpSubject({ ...input.step, subject: rendered.subject || null }, initial.subject),
    body: rendered.body,
  };
}

async function repliedThreadIds(db: FollowUpDb, officeId: string, threadIds: readonly string[]) {
  if (!threadIds.length) return new Set<string>();
  const inbound = await db.emailMessage.groupBy({
    by: ["threadId"],
    where: humanReplyMessageFilter(officeId, threadIds),
    _count: { _all: true },
  });
  return new Set(inbound.map((row) => row.threadId));
}

async function threadReplied(db: FollowUpDb, officeId: string, threadId: string | null) {
  if (!threadId) return false;
  const replied = await repliedThreadIds(db, officeId, [threadId]);
  return replied.has(threadId);
}

async function loadSequenceState(db: FollowUpDb, campaign: FollowUpCampaign, now: Date) {
  await db.outreachCampaignFollowUp.deleteMany({
    where: {
      officeId: campaign.officeId,
      campaignId: campaign.id,
      status: "QUEUED",
      createdAt: { lt: outreachFollowUpReclaimBefore(now) },
    },
  });
  const sends = await db.outreachCampaignSend.findMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id, status: "SENT", sentAt: { not: null } },
    select: { recordId: true, recipient: true, sentAt: true, senderEmail: true, localThreadId: true, providerThreadId: true },
  });
  const followUps = await db.outreachCampaignFollowUp.findMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id },
    select: { recordId: true, step: true, status: true, sentAt: true },
  });
  const replied = await repliedThreadIds(
    db,
    campaign.officeId,
    sends.map((send) => send.localThreadId).filter((id): id is string => Boolean(id)),
  );
  // Persisted office-scoped suppressions (from synced bounces, complaints,
  // opt-outs, or operators) end the sequence for that recipient.
  const suppressions = await listSuppressedEmails(campaign.officeId, sends.map((send) => send.recipient), db);
  const bounced = new Set<string>();
  const suppressed = new Set<string>();
  for (const [email, reason] of suppressions) {
    (reason === "BOUNCED" ? bounced : suppressed).add(email);
  }
  return { sends, followUps, replied, bounced, suppressed };
}

export type FollowUpSenderAccount = {
  accountId: string;
  // READY: in the sender pool. PAUSED: sender protection paused it, an operator
  // resumes it, so the step waits. DISABLED: an operator removed it from the
  // sender pool, so the step cannot leave from this mailbox.
  state: "READY" | "PAUSED" | "DISABLED";
};

const SENDER_STATE_RANK: Record<FollowUpSenderAccount["state"], number> = { READY: 0, PAUSED: 1, DISABLED: 2 };

// A follow-up continues the recipient's thread, so it must leave from the
// mailbox that sent the first touch. Pinned campaigns already name it; rotated
// campaigns recover it from the first-touch ledger. Mailboxes are one pool for
// the whole app, so the lookup is by email, not by the campaign's office.
export async function followUpSenderAccounts(
  db: FollowUpDb,
  campaign: Pick<FollowUpCampaign, "senderAccountId">,
  sends: readonly { recordId: string; senderEmail: string | null }[],
) {
  const byRecord = new Map<string, FollowUpSenderAccount>();
  if (campaign.senderAccountId) {
    for (const send of sends) byRecord.set(send.recordId, { accountId: campaign.senderAccountId, state: "READY" });
    return byRecord;
  }
  const normalize = (email: string) => email.trim().toLowerCase();
  const rawEmails = sends.map((send) => send.senderEmail?.trim()).filter((email): email is string => Boolean(email));
  const emails = [...new Set([...rawEmails, ...rawEmails.map(normalize)])];
  if (!emails.length) return byRecord;
  const accounts = await db.emailAccount.findMany({
    where: { ...SHARED_MAILBOX_POOL_FILTER, email: { in: emails } },
    select: { id: true, email: true, sendEnabled: true, sendPausedAt: true },
  });
  const byEmail = new Map<string, FollowUpSenderAccount>();
  for (const account of accounts) {
    const state: FollowUpSenderAccount["state"] = !account.sendEnabled ? "DISABLED" : account.sendPausedAt ? "PAUSED" : "READY";
    const key = normalize(account.email);
    const current = byEmail.get(key);
    // The same address can be connected more than once; prefer a usable row,
    // then a resumable one, regardless of query order.
    if (!current || SENDER_STATE_RANK[state] < SENDER_STATE_RANK[current.state]) byEmail.set(key, { accountId: account.id, state });
  }
  for (const send of sends) {
    const account = byEmail.get(normalize(send.senderEmail ?? ""));
    if (account) byRecord.set(send.recordId, account);
  }
  return byRecord;
}

function mergeSuppressed(persisted: ReadonlySet<string>, extra: ReadonlySet<string> | undefined) {
  if (!extra?.size) return persisted;
  return new Set([...persisted, ...extra]);
}

export async function outstandingCampaignFollowUps(
  db: FollowUpDb,
  campaign: FollowUpCampaign,
  now: Date,
  suppressedRecipients?: ReadonlySet<string>,
) {
  const steps = normalizeCampaignFollowUps(campaign.followUps);
  if (!steps.length) return 0;
  const state = await loadSequenceState(db, campaign, now);
  return planCampaignFollowUps({
    steps,
    sends: state.sends,
    followUps: state.followUps,
    repliedThreadIds: state.replied,
    suppressedRecipients: mergeSuppressed(state.suppressed, suppressedRecipients),
    bouncedRecipients: state.bounced,
    now,
  }).outstanding;
}

async function recordSkips(
  db: FollowUpDb,
  campaign: FollowUpCampaign,
  skips: readonly { recordId: string; recipient: string; step: number; reason: CampaignFollowUpSkipReason }[],
  now: Date,
) {
  if (!skips.length) return;
  await db.outreachCampaignFollowUp.createMany({
    data: skips.map((skip) => ({
      officeId: campaign.officeId,
      campaignId: campaign.id,
      recordId: skip.recordId,
      step: skip.step,
      recipient: skip.recipient,
      status: "SKIPPED",
      skipReason: skip.reason,
      dueAt: now,
    })),
    skipDuplicates: true,
  });
}

const claimKey = (row: { recordId: string; step: number }) => `${row.recordId}:${row.step}`;

async function claimFollowUps(
  db: FollowUpDb,
  campaign: FollowUpCampaign,
  candidates: readonly CampaignFollowUpCandidate[],
  limit: number | undefined,
  now: Date,
) {
  if (!candidates.length) return [];
  try {
    return await db.$transaction(async (tx) => {
      await lockOutreachCampaignClaims(tx, campaign.id);
      const remaining = await outreachCampaignRemainingCapacity(tx, campaign, now);
      const existing = await tx.outreachCampaignFollowUp.findMany({
        where: {
          officeId: campaign.officeId,
          campaignId: campaign.id,
          recordId: { in: candidates.map((candidate) => candidate.recordId) },
        },
        select: { recordId: true, step: true, status: true },
      });
      const claimLimit = Math.max(0, Math.min(limit ?? campaign.dailyCap, remaining));
      const taken = new Set(existing.map(claimKey));
      const claimable = candidates
        .filter((candidate) => !taken.has(claimKey(candidate)))
        .slice(0, claimLimit);
      if (!claimable.length) return [];
      await tx.outreachCampaignFollowUp.createMany({
        data: claimable.map((candidate) => ({
          officeId: campaign.officeId,
          campaignId: campaign.id,
          recordId: candidate.recordId,
          step: candidate.step,
          recipient: candidate.recipient,
          status: "QUEUED",
          dueAt: candidate.dueAt,
        })),
      });
      return claimable;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return [];
    throw error;
  }
}

async function recordFollowUpSent(
  db: FollowUpDb,
  input: {
    campaign: FollowUpCampaign;
    candidate: CampaignFollowUpCandidate;
    senderEmail: string;
    accountId: string;
    reservationId: string;
    subject: string;
    body: string;
    rfcMessageId: string;
    providerMessageId: string;
    providerThreadId: string;
    sentAt: Date;
  },
) {
  const { campaign, candidate } = input;
  await db.$transaction(async (tx) => {
    const existing = await tx.emailMessage.findFirst({
      where: {
        thread: { officeId: campaign.officeId },
        OR: [{ gmailMessageId: input.providerMessageId }, { externalId: input.rfcMessageId }],
      },
      select: { id: true, threadId: true },
    });
    let localThreadId = existing?.threadId ?? candidate.localThreadId;
    let localMessageId = existing?.id ?? null;
    if (!localMessageId) {
      if (localThreadId) {
        const updated = await tx.emailThread.updateMany({
          where: { id: localThreadId, officeId: campaign.officeId },
          data: { lastMessageAt: input.sentAt, messageCount: { increment: 1 } },
        });
        if (updated.count === 0) localThreadId = null;
      }
      if (!localThreadId) {
        const thread = await tx.emailThread.create({
          data: {
            officeId: campaign.officeId,
            subject: input.subject.slice(0, 180),
            participants: JSON.stringify([input.senderEmail, candidate.recipient]),
            externalThreadId: input.providerThreadId,
            lastMessageAt: input.sentAt,
            messageCount: 1,
          },
          select: { id: true },
        });
        localThreadId = thread.id;
      }
      const message = await tx.emailMessage.create({
        data: {
          threadId: localThreadId,
          accountId: input.accountId,
          officeId: campaign.officeId,
          externalId: input.rfcMessageId,
          gmailMessageId: input.providerMessageId,
          rfcMessageId: input.rfcMessageId,
          direction: "OUTBOUND",
          fromEmail: input.senderEmail,
          toEmails: JSON.stringify([candidate.recipient]),
          subject: input.subject.slice(0, 180),
          bodyText: input.body,
          sentAt: input.sentAt,
        },
        select: { id: true },
      });
      localMessageId = message.id;
    }
    await tx.emailSenderReservation.updateMany({
      where: { id: input.reservationId, officeId: campaign.officeId, accountId: input.accountId, status: "RESERVED" },
      data: {
        status: "RECORDED",
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId,
        messageId: localMessageId,
      },
    });
    await tx.outreachCampaignFollowUp.updateMany({
      where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: candidate.recordId, step: candidate.step },
      data: {
        status: "SENT",
        recipient: candidate.recipient,
        senderEmail: input.senderEmail,
        reservationId: input.reservationId,
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId,
        error: null,
        sentAt: input.sentAt,
      },
    });
    await tx.outreachCampaign.updateMany({
      where: { id: campaign.id, officeId: campaign.officeId },
      data: { lastRunAt: input.sentAt },
    });
  });
}

async function reconcileUnknownFollowUps(
  db: FollowUpDb,
  campaign: FollowUpCampaign,
  steps: readonly CampaignFollowUpStep[],
  provider: SupplierEmailProvider,
  now: Date,
  release: typeof releaseEmailSenderReservation,
) {
  const unknowns = await db.outreachCampaignFollowUp.findMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id, status: "UNKNOWN", reservationId: { not: null } },
    select: { recordId: true, step: true, recipient: true, senderEmail: true, reservationId: true, localThreadId: true, providerThreadId: true, dueAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const row of unknowns) {
    if (!row.reservationId || !row.senderEmail) continue;
    const reservation = await db.emailSenderReservation.findUnique({
      where: { id: row.reservationId, officeId: campaign.officeId, status: "RESERVED" },
      select: { accountId: true, createdAt: true },
    });
    if (!reservation) continue;
    const rfcMessageId = outreachFollowUpRfcMessageId(campaign.id, row.recordId, row.step);
    const receipt = await provider.reconcile({
      officeId: campaign.officeId,
      accountId: reservation.accountId,
      senderEmail: row.senderEmail,
      rfcMessageId,
    });
    if (receipt.state === "NOT_FOUND" && outreachUnknownDeliveryExpired(row.updatedAt, now)) {
      await release({ officeId: campaign.officeId, reservationId: row.reservationId });
      await db.outreachCampaignFollowUp.updateMany({
        where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: row.recordId, step: row.step, status: "UNKNOWN" },
        data: { status: "REJECTED", error: `Delivery was not confirmed within ${OUTREACH_UNKNOWN_DELIVERY_TIMEOUT_HOURS} hours.` },
      });
      continue;
    }
    if (receipt.state !== "SENT") continue;
    const step = steps[row.step - 1];
    const personalization = campaign.audiencePersonalization[row.recordId];
    if (!step || !personalization) continue;
    const email = renderFollowUpEmail({ step, campaignSubject: followUpInitialSubject(campaign, row.recordId), personalization });
    await recordFollowUpSent(db, {
      campaign,
      candidate: {
        recordId: row.recordId,
        recipient: row.recipient,
        step: row.step,
        dueAt: row.dueAt,
        previousSentAt: row.dueAt,
        localThreadId: row.localThreadId,
        providerThreadId: row.providerThreadId,
      },
      senderEmail: row.senderEmail,
      accountId: reservation.accountId,
      reservationId: row.reservationId,
      subject: email.subject,
      body: email.body,
      rfcMessageId,
      providerMessageId: receipt.providerMessageId,
      providerThreadId: receipt.providerThreadId,
      // The reservation was taken immediately before the original delivery
      // attempt, so the next step waits from delivery, not from recovery.
      sentAt: reservation.createdAt,
    });
  }
}

export async function runOutreachCampaignFollowUps(input: {
  db: FollowUpDb;
  campaign: FollowUpCampaign;
  provider: SupplierEmailProvider;
  now: Date;
  limit?: number;
  pauseMs?: number;
  suppressedRecipients?: ReadonlySet<string>;
  reserve?: typeof reserveEmailSender;
  release?: typeof releaseEmailSenderReservation;
  statusAllowsSend: (status: string | null | undefined) => boolean;
}): Promise<CampaignFollowUpBatchResult> {
  const { db, campaign, now } = input;
  const steps = normalizeCampaignFollowUps(campaign.followUps);
  const output = emptyFollowUpResult(steps.length);
  if (!steps.length) return output;
  const stepStatus = async () => (await db.outreachCampaign.findFirst({
    where: { id: campaign.id, officeId: campaign.officeId },
    select: { status: true },
  }))?.status;
  if (!input.statusAllowsSend(await stepStatus())) return output;
  await reconcileUnknownFollowUps(db, campaign, steps, input.provider, now, input.release ?? releaseEmailSenderReservation);
  const state = await loadSequenceState(db, campaign, now);
  const plan = planCampaignFollowUps({
    steps,
    sends: state.sends,
    followUps: state.followUps,
    repliedThreadIds: state.replied,
    suppressedRecipients: mergeSuppressed(state.suppressed, input.suppressedRecipients),
    bouncedRecipients: state.bounced,
    now,
  });
  await recordSkips(db, campaign, plan.skips, now);
  output.skipped = plan.skips.length;
  output.outstanding = plan.outstanding;
  for (const skip of plan.skips) {
    output.outcomes.push({
      campaignId: campaign.id,
      recordId: skip.recordId,
      recipient: skip.recipient,
      step: skip.step,
      state: "SKIPPED",
      skipReason: skip.reason,
      senderEmail: null,
      error: null,
    });
  }
  const claimed = await claimFollowUps(db, campaign, plan.due, input.limit, now);
  if (!claimed.length) return output;
  const senderAccounts = await followUpSenderAccounts(db, campaign, state.sends);
  const reserveSender = input.reserve ?? reserveEmailSender;
  const releaseReservation = input.release ?? releaseEmailSenderReservation;
  const dropQueued = (candidate: CampaignFollowUpCandidate) => db.outreachCampaignFollowUp.deleteMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: candidate.recordId, step: candidate.step, status: "QUEUED" },
  });
  const recordOutcome = (candidate: CampaignFollowUpCandidate, data: { status: "REJECTED" | "UNKNOWN"; senderEmail?: string; reservationId?: string; error: string }) =>
    db.outreachCampaignFollowUp.updateMany({
      where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: candidate.recordId, step: candidate.step },
      data,
    });
  const skipClaimed = async (candidate: CampaignFollowUpCandidate, skipReason: CampaignFollowUpSkipReason) => {
    await db.outreachCampaignFollowUp.updateMany({
      where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: candidate.recordId, step: candidate.step, status: "QUEUED" },
      data: { status: "SKIPPED", skipReason },
    });
    output.skipped += 1;
    output.outcomes.push({
      campaignId: campaign.id,
      recordId: candidate.recordId,
      recipient: candidate.recipient,
      step: candidate.step,
      state: "SKIPPED",
      skipReason,
      senderEmail: null,
      error: null,
    });
  };
  const queue = [...claimed];
  const claimedKeys = new Set(queue.map(claimKey));
  let pending = plan.due.filter((candidate) => !claimedKeys.has(claimKey(candidate)));
  const blockedAccounts = new Set<string>();
  let backfill = true;
  // A rotated campaign releases the claim of a recipient whose mailbox is paused
  // or at capacity, then refills the freed slot from the remaining due
  // recipients on mailboxes that have not refused in this run, so blocked
  // recipients at the front of the plan cannot starve the rest. Each refilled
  // recipient that defers blocks one more mailbox, so the chain is bounded by
  // the number of distinct first-touch mailboxes, and every refill goes through
  // claimFollowUps so the daily cap still applies.
  const deferRotated = async (candidate: CampaignFollowUpCandidate) => {
    const account = senderAccounts.get(candidate.recordId);
    if (account) blockedAccounts.add(account.accountId);
    if (!backfill) return;
    pending = pending.filter((next) => {
      const nextAccount = senderAccounts.get(next.recordId);
      return !nextAccount || !blockedAccounts.has(nextAccount.accountId);
    });
    const [next] = await claimFollowUps(db, campaign, pending, 1, now);
    if (!next) {
      backfill = false;
      return;
    }
    pending = pending.filter((row) => claimKey(row) !== claimKey(next));
    queue.push(next);
  };
  let processed = 0;
  const releaseUnprocessedClaims = async () => {
    for (const candidate of queue.slice(processed)) await dropQueued(candidate);
  };
  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!input.statusAllowsSend(await stepStatus())) {
      await releaseUnprocessedClaims();
      break;
    }
    processed += 1;
    const step = steps[candidate.step - 1];
    const personalization = campaign.audiencePersonalization[candidate.recordId];
    if (!step || !personalization) {
      await dropQueued(candidate);
      continue;
    }
    const email = renderFollowUpEmail({ step, campaignSubject: followUpInitialSubject(campaign, candidate.recordId), personalization });
    const base = {
      campaignId: campaign.id,
      recordId: candidate.recordId,
      recipient: candidate.recipient,
      step: candidate.step,
      skipReason: null,
    };
    const idempotencyKey = outreachFollowUpIdempotencyKey(campaign.id, candidate.recordId, candidate.step);
    const senderAccount = senderAccounts.get(candidate.recordId);
    if (!senderAccount || senderAccount.state === "DISABLED") {
      const error = senderAccount
        ? "The mailbox that sent the first touch is no longer enabled for sending."
        : "The mailbox that sent the first touch is no longer connected.";
      await recordOutcome(candidate, { status: "REJECTED", error });
      output.rejected += 1;
      output.outcomes.push({ ...base, state: "REJECTED", senderEmail: null, error });
      continue;
    }
    // A follow-up stays on the first-touch mailbox so the recipient keeps one
    // thread, so a paused mailbox defers it instead of rerouting it. A reply
    // that arrived meanwhile ends the sequence right away rather than waiting.
    const deferPaused = async (error: string): Promise<"CONTINUE" | "STOP"> => {
      if (await threadReplied(db, campaign.officeId, candidate.localThreadId)) {
        await skipClaimed(candidate, "REPLIED");
        return "CONTINUE";
      }
      await dropQueued(candidate);
      output.outcomes.push({ ...base, state: "POOL_EXHAUSTED", senderEmail: null, error });
      if (!campaign.senderAccountId) {
        await deferRotated(candidate);
        return "CONTINUE";
      }
      output.poolExhausted = true;
      await releaseUnprocessedClaims();
      return "STOP";
    };
    if (senderAccount.state === "PAUSED") {
      if (await deferPaused("The mailbox that sent the first touch is paused by sender protection.") === "STOP") break;
      continue;
    }
    const reservation = await reserveSender({
      officeId: campaign.officeId,
      idempotencyKey,
      requestHash: outreachFollowUpRequestHash({
        campaignId: campaign.id,
        recordId: candidate.recordId,
        step: candidate.step,
        recipient: candidate.recipient,
        subject: email.subject,
        body: email.body,
      }),
      accountId: senderAccount.accountId,
      now,
    });
    if (!("ok" in reservation)) {
      const settlement = await settleOutreachReservationFailure(db, { officeId: campaign.officeId, idempotencyKey, code: reservation.code });
      if (settlement.kind === "RELEASE_CLAIM") {
        await dropQueued(candidate);
        output.outcomes.push({ ...base, state: "POOL_EXHAUSTED", senderEmail: null, error: reservation.error });
        // A rotated campaign threads each recipient through its own first-touch
        // mailbox, so one exhausted or paused mailbox only defers its recipients.
        if (!campaign.senderAccountId) {
          await deferRotated(candidate);
          continue;
        }
        output.poolExhausted = true;
        await releaseUnprocessedClaims();
        break;
      }
      if (settlement.kind === "UNKNOWN") {
        await recordOutcome(candidate, {
          status: "UNKNOWN",
          senderEmail: settlement.senderEmail,
          reservationId: settlement.reservationId,
          error: reservation.error,
        });
        output.unknown += 1;
        output.outcomes.push({ ...base, state: "UNKNOWN", senderEmail: settlement.senderEmail, error: reservation.error });
        continue;
      }
      await recordOutcome(candidate, { status: "REJECTED", error: reservation.error });
      output.rejected += 1;
      output.outcomes.push({ ...base, state: "REJECTED", senderEmail: null, error: reservation.error });
      continue;
    }
    output.attempted += 1;
    if (reservation.completed) {
      await db.outreachCampaignFollowUp.updateMany({
        where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: candidate.recordId, step: candidate.step, status: "QUEUED" },
        data: {
          status: "SENT",
          senderEmail: reservation.senderEmail,
          reservationId: reservation.reservationId,
          providerMessageId: reservation.providerMessageId,
          providerThreadId: reservation.providerThreadId ?? candidate.providerThreadId,
          localThreadId: reservation.localThreadId ?? candidate.localThreadId,
          error: null,
          sentAt: reservation.sentAt ?? now,
        },
      });
      output.alreadySent += 1;
      output.outcomes.push({ ...base, state: "ALREADY_SENT", senderEmail: reservation.senderEmail, error: null });
      continue;
    }
    if (!input.statusAllowsSend(await stepStatus())) {
      await releaseReservation({ officeId: campaign.officeId, reservationId: reservation.reservationId });
      await dropQueued(candidate);
      await releaseUnprocessedClaims();
      break;
    }
    if (await threadReplied(db, campaign.officeId, candidate.localThreadId)) {
      await releaseReservation({ officeId: campaign.officeId, reservationId: reservation.reservationId });
      await skipClaimed(candidate, "REPLIED");
      continue;
    }
    // Suppression synced after planning (bounce, complaint, opt-out) is checked
    // once more after the reservation so the planning snapshot cannot go stale
    // while earlier candidates in this run were being sent.
    const lateSuppression = (await listSuppressedEmails(campaign.officeId, [candidate.recipient], db)).get(candidate.recipient);
    if (lateSuppression) {
      await releaseReservation({ officeId: campaign.officeId, reservationId: reservation.reservationId });
      await skipClaimed(candidate, lateSuppression === "BOUNCED" ? "BOUNCED" : "SUPPRESSED");
      continue;
    }
    const rfcMessageId = outreachFollowUpRfcMessageId(campaign.id, candidate.recordId, candidate.step);
    const receipt: SupplierEmailSendResult = await input.provider.send({
      officeId: campaign.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.senderEmail,
      recipient: candidate.recipient,
      subject: email.subject,
      body: email.body,
      rfcMessageId,
      providerThreadId: candidate.providerThreadId,
      inReplyToRfcMessageId: outreachFollowUpInReplyTo(campaign.id, candidate.recordId, candidate.step),
      senderDisplayName: campaign.senderDisplayName,
    });
    if (receipt.state === "SENT") {
      await recordFollowUpSent(db, {
        campaign,
        candidate,
        senderEmail: reservation.senderEmail,
        accountId: reservation.accountId,
        reservationId: reservation.reservationId,
        subject: email.subject,
        body: email.body,
        rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
        sentAt: now,
      });
      output.sent += 1;
      output.outcomes.push({ ...base, state: "SENT", senderEmail: reservation.senderEmail, error: null });
    } else if (receipt.state === "REJECTED") {
      await releaseReservation({ officeId: campaign.officeId, reservationId: reservation.reservationId });
      if (receipt.error === SENDER_PAUSED_ERROR) {
        if (await deferPaused(receipt.error) === "STOP") break;
        continue;
      }
      await recordOutcome(candidate, { status: "REJECTED", senderEmail: reservation.senderEmail, reservationId: reservation.reservationId, error: receipt.error });
      output.rejected += 1;
      output.outcomes.push({ ...base, state: "REJECTED", senderEmail: reservation.senderEmail, error: receipt.error });
    } else {
      await recordOutcome(candidate, { status: "UNKNOWN", senderEmail: reservation.senderEmail, reservationId: reservation.reservationId, error: receipt.error });
      output.unknown += 1;
      output.outcomes.push({ ...base, state: "UNKNOWN", senderEmail: reservation.senderEmail, error: receipt.error });
    }
    if ((input.pauseMs ?? 400) > 0) await new Promise((resolve) => setTimeout(resolve, input.pauseMs ?? 400));
  }
  // Sends, late skips, rejections, and released claims all changed the ledger
  // this run, so the reported outstanding count is re-read from it.
  output.outstanding = await outstandingCampaignFollowUps(db, campaign, now, input.suppressedRecipients);
  return output;
}
