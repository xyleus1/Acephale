import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  campaignRowEligible,
  campaignSnapshotRowSendable,
  dedupeRecipients,
  excludeContactedRecipients,
  outreachCampaignContactedWhere,
  outreachCampaignReclaimBefore,
  renderCampaignEmail,
  selectCampaignVariant,
  storedCampaignVariants,
  type CampaignPersonalization,
} from "@/lib/outreach-campaign-copy";
import {
  lockOutreachCampaignClaims,
  outreachCampaignRemainingCapacity,
  outreachUnknownDeliveryExpired,
  OUTREACH_UNKNOWN_DELIVERY_TIMEOUT_HOURS,
  runOutreachCampaignFollowUps,
  settleOutreachReservationFailure,
  type CampaignFollowUpBatchResult,
} from "@/lib/outreach-campaign-follow-ups";
import {
  completeCampaignIfDone,
} from "@/lib/outreach-campaigns";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { logEmailTouch } from "@/lib/crm/email-touch";
import { utcDayBounds } from "@/lib/email-sender-pool-policy";
import { listSuppressedEmails, upsertEmailSuppression } from "@/lib/email-delivery-events";
import { suppressionSkipMessage } from "@/lib/email-delivery-feedback";
import {
  LiveRecipientGate,
  RECIPIENT_QUALITY_SUPPRESSION_SOURCE,
  recipientQualityDataFor,
  recipientQualityRefusal,
  type LiveRecipientCheck,
} from "@/lib/outreach-recipient-quality";
import { prisma } from "@/lib/prisma";
import {
  gmailSupplierEmailProvider,
  SENDER_PAUSED_ERROR,
  type SupplierEmailProvider,
  type SupplierEmailSendResult,
} from "@/lib/supply-os/supplier-email-provider";

type CampaignDb = PrismaClient;

export type CampaignBatchRow = {
  id: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type CampaignBatchSend = {
  campaignId: string;
  recordId: string;
  recipient: string;
  state: "SENT" | "ALREADY_SENT" | "REJECTED" | "UNKNOWN" | "POOL_EXHAUSTED";
  senderEmail: string | null;
  variantKey: string | null;
  error: string | null;
};

export type CampaignBatchResult = {
  campaignId: string;
  attempted: number;
  sent: number;
  alreadySent: number;
  rejected: number;
  unknown: number;
  rerouted: number;
  // Recipients the pre-send quality gate refused this run (a subset of
  // `rejected`) and the paid verifier calls it spent.
  pruned: number;
  verificationChecks: number;
  verifierExhausted: boolean;
  poolExhausted: boolean;
  blocked?: "NOT_ACTIVE" | "DAILY_CAP" | "NO_SENDER" | "NO_AUDIENCE";
  outcomes: CampaignBatchSend[];
  followUps?: CampaignFollowUpBatchResult;
};

export function outreachCampaignBatchLimit(limit: number | undefined, dailyCap: number, sentToday: number) {
  return Math.max(0, Math.min(limit ?? dailyCap, dailyCap - sentToday));
}

export function outreachCampaignUtcDayBounds(now: Date) {
  return utcDayBounds(now);
}

export function selectOutreachCampaignRows(input: {
  rows: readonly CampaignBatchRow[];
  sentRecordIds?: ReadonlySet<string>;
  audienceRecordIds?: ReadonlySet<string>;
  statuses: readonly string[];
  countries?: readonly string[];
  segments?: readonly string[];
  emailField: string;
  countryField?: string;
  segmentField?: string;
  limit: number;
}) {
  return [...input.rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .filter((row) => !input.audienceRecordIds || input.audienceRecordIds.has(row.id))
    .filter((row) => !input.sentRecordIds?.has(row.id))
    .filter((row) => campaignRowEligible({
      row: { status: row.status, data: row.data },
      statuses: input.statuses,
      countries: input.countries,
      segments: input.segments,
      emailField: input.emailField,
      countryField: input.countryField,
      segmentField: input.segmentField,
    }))
    .slice(0, input.limit);
}

export function selectOutreachCampaignSnapshotRows(input: {
  rows: readonly CampaignBatchRow[];
  audienceRecordIds: readonly string[];
  audiencePersonalization: Readonly<Record<string, CampaignPersonalization>>;
  sentRecordIds?: ReadonlySet<string>;
  statuses: readonly string[];
  emailField: string;
  companyField?: string | null;
  countryField?: string | null;
  limit?: number;
}) {
  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  return input.audienceRecordIds
    .map((recordId) => {
      const row = rowsById.get(recordId);
      const personalization = input.audiencePersonalization[recordId];
      if (!row || !personalization) return null;
      return {
        ...row,
        data: {
          email: personalization.email,
          company: personalization.company,
          country: personalization.country,
          [input.emailField]: personalization.email,
          ...(input.companyField ? { [input.companyField]: personalization.company } : {}),
          ...(input.countryField ? { [input.countryField]: personalization.country } : {}),
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => campaignSnapshotRowSendable({
      row,
      statuses: input.statuses,
      personalization: input.audiencePersonalization[row.id],
    }))
    .filter((row) => !input.sentRecordIds?.has(row.id))
    .slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);
}

export function outreachCampaignStatusAllowsSend(status: string | null | undefined) {
  return status === "ACTIVE";
}

export function outreachCampaignRunNowLimitValid(limit: unknown, dailyCap: number) {
  return typeof limit === "number"
    && Number.isFinite(limit)
    && Number.isInteger(limit)
    && limit >= 1
    && limit <= dailyCap;
}

export function outreachCampaignIdempotencyKey(campaignId: string, recordId: string) {
  return `outreach-campaign:${campaignId}:${recordId}`;
}

export function outreachCampaignRequestHash(input: {
  campaignId: string;
  recordId: string;
  recipient: string;
  subject: string;
  body: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function outreachCampaignRfcMessageId(campaignId: string, recordId: string) {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "-");
  return `<outreach-${clean(campaignId.slice(0, 8))}-${clean(recordId)}@derya.ai>`;
}

export { outreachCampaignReclaimBefore };

export function outreachCampaignClaimLimit(
  limit: number | undefined,
  dailyCap: number,
  sentToday: number,
  queuedToday: number,
) {
  return Math.max(0, Math.min(limit ?? dailyCap, dailyCap - sentToday - queuedToday));
}

// Rows worth verifying this run: never more than the cap capacity the claim
// can still take, so a campaign parked at its daily cap does not buy DNS and
// verifier checks for recipients it cannot claim today. The claim transaction
// re-reads capacity under the campaign lock, so this bound is an upper limit,
// not the enforcement.
export function outreachCampaignVerificationLimit(
  limit: number | undefined,
  dailyCap: number,
  remainingCapacity: number,
) {
  return Math.max(0, Math.min(limit ?? dailyCap, remainingCapacity));
}

export function outreachCampaignReconcileState(state: "SENT" | "NOT_FOUND" | "UNKNOWN") {
  return state === "SENT" ? "SENT" as const : "UNKNOWN" as const;
}

export function outreachCampaignDeliveryOutcome(
  result: SupplierEmailSendResult,
) {
  if (result.state === "SENT") {
    return { state: "SENT" as const, releaseReservation: false };
  }
  if (result.state === "REJECTED") {
    return { state: "REJECTED" as const, releaseReservation: true, error: result.error };
  }
  return { state: "UNKNOWN" as const, releaseReservation: false, error: result.error };
}

// A mailbox paused by sender protection between the reservation and the
// provider call has not reached the recipient yet. A rotated first touch is
// not tied to that mailbox, so it moves to another ready one once per run; a
// pinned campaign keeps its operator-chosen mailbox and waits for the resume.
export function outreachCampaignPausedSenderAction(input: {
  error: string;
  rotated: boolean;
  rerouted: boolean;
}): "SETTLE" | "REROUTE" | "WAIT" {
  if (input.error !== SENDER_PAUSED_ERROR) return "SETTLE";
  return input.rotated && !input.rerouted ? "REROUTE" : "WAIT";
}

export function outreachCampaignReservationOutcome(code: string) {
  // A mailbox paused by sender protection can send again once it is resumed, so
  // it defers this recipient like a capacity shortage instead of rejecting it.
  if (code === "POOL_EXHAUSTED" || code === "POOL_EMPTY" || code === "SENDER_UNAVAILABLE") {
    return { state: "POOL_EXHAUSTED" as const, poolExhausted: true };
  }
  return { state: "REJECTED" as const, poolExhausted: false };
}

type LoadedCampaign = {
  id: string;
  officeId: string;
  status: string;
  subject: string;
  bodyTemplate: string;
  emailField: string;
  countryField: string | null;
  rowStatuses: Prisma.JsonValue;
  filters: Prisma.JsonValue | null;
  senderAccountId: string | null;
  senderDisplayName: string | null;
  senderRotation: boolean;
  variants: Prisma.JsonValue | null;
  dailyCap: number;
  listId: string;
  companyField: string | null;
  audienceRecordIds: Prisma.JsonValue | null;
  audiencePersonalization: Prisma.JsonValue | null;
  revisionHash: string | null;
  followUps?: Prisma.JsonValue | null;
};

function jsonStrings(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonPersonalization(value: Prisma.JsonValue | null): Record<string, CampaignPersonalization> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const object = item as Record<string, unknown>;
    if (typeof object.email !== "string") return [];
    return [[id, {
      email: object.email,
      company: typeof object.company === "string" ? object.company : null,
      country: typeof object.country === "string" ? object.country : null,
    }]];
  }));
}

async function recordSent(
  db: CampaignDb,
  input: {
    officeId: string;
    campaignId: string;
    recordId: string;
    recipient: string;
    senderEmail: string;
    accountId: string;
    reservationId: string;
    subject: string;
    body: string;
    rfcMessageId: string;
    providerMessageId: string;
    providerThreadId: string;
    sentAt: Date;
    variantKey: string | null;
  },
) {
  let localThreadId: string | null = null;
  let localMessageId: string | null = null;
  await db.$transaction(async (tx) => {
    const existing = await tx.emailMessage.findFirst({
      where: {
        thread: { officeId: input.officeId },
        OR: [{ gmailMessageId: input.providerMessageId }, { externalId: input.rfcMessageId }],
      },
      select: { id: true, threadId: true },
    });
    localThreadId = existing?.threadId ?? null;
    localMessageId = existing?.id ?? null;
    if (!localMessageId) {
      const thread = await tx.emailThread.create({
        data: {
          officeId: input.officeId,
          subject: input.subject.slice(0, 180),
          participants: JSON.stringify([input.senderEmail, input.recipient]),
          externalThreadId: input.providerThreadId,
          lastMessageAt: input.sentAt,
          messageCount: 1,
        },
        select: { id: true },
      });
      localThreadId = thread.id;
      const message = await tx.emailMessage.create({
        data: {
          threadId: thread.id,
          accountId: input.accountId,
          officeId: input.officeId,
          externalId: input.rfcMessageId,
          gmailMessageId: input.providerMessageId,
          rfcMessageId: input.rfcMessageId,
          direction: "OUTBOUND",
          fromEmail: input.senderEmail,
          toEmails: JSON.stringify([input.recipient]),
          subject: input.subject.slice(0, 180),
          bodyText: input.body,
          sentAt: input.sentAt,
        },
        select: { id: true },
      });
      localMessageId = message.id;
    }
    await tx.emailSenderReservation.updateMany({
      where: {
        id: input.reservationId,
        officeId: input.officeId,
        accountId: input.accountId,
        status: "RESERVED",
      },
      data: {
        status: "RECORDED",
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId,
        messageId: localMessageId,
      },
    });
    await tx.outreachCampaignSend.upsert({
      where: { campaignId_recordId: { campaignId: input.campaignId, recordId: input.recordId } },
      create: {
        officeId: input.officeId,
        campaignId: input.campaignId,
        recordId: input.recordId,
        recipient: input.recipient,
        status: "SENT",
        senderEmail: input.senderEmail,
        variantKey: input.variantKey,
        reservationId: input.reservationId,
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId,
        sentAt: input.sentAt,
      },
      update: {
        officeId: input.officeId,
        recipient: input.recipient,
        status: "SENT",
        senderEmail: input.senderEmail,
        variantKey: input.variantKey,
        reservationId: input.reservationId,
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId,
        error: null,
        sentAt: input.sentAt,
      },
    });
    await tx.outreachCampaign.updateMany({
      where: { id: input.campaignId, officeId: input.officeId },
      data: { lastRunAt: input.sentAt },
    });
  });
  if (localThreadId && localMessageId) {
    await logEmailTouch({
      officeId: input.officeId,
      threadId: localThreadId,
      messageId: localMessageId,
      direction: "OUTBOUND",
      fromEmail: input.senderEmail,
      toEmails: [input.recipient],
      subject: input.subject,
      snippet: input.body,
      sentAt: input.sentAt,
    });
  }
}

async function recordOutcome(
  db: CampaignDb,
  input: {
    officeId: string;
    campaignId: string;
    recordId: string;
    recipient: string;
    status: "REJECTED" | "UNKNOWN";
    senderEmail: string;
    variantKey: string | null;
    error: string;
    reservationId: string;
  },
) {
  await db.outreachCampaignSend.upsert({
    where: { campaignId_recordId: { campaignId: input.campaignId, recordId: input.recordId } },
    create: {
      officeId: input.officeId,
      campaignId: input.campaignId,
      recordId: input.recordId,
      recipient: input.recipient,
      status: input.status,
      senderEmail: input.senderEmail,
      variantKey: input.variantKey,
      reservationId: input.reservationId,
      error: input.error,
    },
    update: {
      officeId: input.officeId,
      recipient: input.recipient,
      status: input.status,
      senderEmail: input.senderEmail,
      variantKey: input.variantKey,
      reservationId: input.reservationId,
      error: input.error,
    },
  });
}

function result(campaignId: string): CampaignBatchResult {
  return {
    campaignId,
    attempted: 0,
    sent: 0,
    alreadySent: 0,
    rejected: 0,
    unknown: 0,
    rerouted: 0,
    pruned: 0,
    verificationChecks: 0,
    verifierExhausted: false,
    poolExhausted: false,
    outcomes: [],
  };
}

async function reconcileUnknownCampaignSends(
  db: CampaignDb,
  campaign: LoadedCampaign,
  provider: SupplierEmailProvider,
  now: Date,
  release: typeof releaseEmailSenderReservation,
) {
  const unknowns = await db.outreachCampaignSend.findMany({
    where: {
      officeId: campaign.officeId,
      campaignId: campaign.id,
      status: "UNKNOWN",
      reservationId: { not: null },
    },
    select: {
      id: true,
      recordId: true,
      recipient: true,
      senderEmail: true,
      reservationId: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const send of unknowns) {
    if (!send.reservationId || !send.senderEmail) continue;
    const reservation = await db.emailSenderReservation.findUnique({
      where: { id: send.reservationId, officeId: campaign.officeId, status: "RESERVED" },
      select: { accountId: true, createdAt: true },
    });
    if (!reservation) continue;
    const receipt = await provider.reconcile({
      officeId: campaign.officeId,
      accountId: reservation.accountId,
      senderEmail: send.senderEmail,
      rfcMessageId: outreachCampaignRfcMessageId(campaign.id, send.recordId),
    });
    if (receipt.state === "NOT_FOUND" && outreachUnknownDeliveryExpired(send.updatedAt, now)) {
      await release({ officeId: campaign.officeId, reservationId: send.reservationId });
      await db.outreachCampaignSend.updateMany({
        where: { id: send.id, officeId: campaign.officeId, status: "UNKNOWN" },
        data: { status: "REJECTED", error: `Delivery was not confirmed within ${OUTREACH_UNKNOWN_DELIVERY_TIMEOUT_HOURS} hours.` },
      });
      continue;
    }
    if (receipt.state !== "SENT") continue;
    const personalization = jsonPersonalization(campaign.audiencePersonalization)[send.recordId];
    if (!personalization) continue;
    const recipient = personalization.email.trim().toLowerCase();
    const variant = selectCampaignVariant({
      campaignId: campaign.id,
      recordId: send.recordId,
      variants: storedCampaignVariants(campaign.variants),
    });
    const email = renderCampaignEmail({
      subject: variant?.subject ?? campaign.subject,
      bodyTemplate: variant?.bodyTemplate ?? campaign.bodyTemplate,
      row: personalization,
    });
    await recordSent(db, {
      officeId: campaign.officeId,
      campaignId: campaign.id,
      recordId: send.recordId,
      recipient,
      senderEmail: send.senderEmail,
      accountId: reservation.accountId,
      reservationId: send.reservationId,
      subject: email.subject,
      body: email.body,
      rfcMessageId: outreachCampaignRfcMessageId(campaign.id, send.recordId),
      providerMessageId: receipt.providerMessageId,
      providerThreadId: receipt.providerThreadId,
      sentAt: reservation.createdAt,
      variantKey: variant?.key ?? null,
    });
  }
}

function campaignRowRecipient(campaign: LoadedCampaign, row: CampaignBatchRow) {
  return String(row.data[campaign.emailField] ?? "").trim().toLowerCase();
}

// Suppressed recipients (bounced, complained, opted out, or manually blocked
// for this office) are recorded as REJECTED before any claim, so they never
// take a daily-cap slot or reach the sender pool. Returns the sendable rows.
async function rejectSuppressedCampaignRows(
  db: CampaignDb,
  campaign: LoadedCampaign,
  rows: CampaignBatchRow[],
  output: CampaignBatchResult,
) {
  const suppressed = await listSuppressedEmails(
    campaign.officeId,
    rows.map((row) => campaignRowRecipient(campaign, row)),
    db,
  );
  if (!suppressed.size) return rows;
  const blocked = rows.filter((row) => suppressed.has(campaignRowRecipient(campaign, row)));
  if (!blocked.length) return rows;
  const existing = await db.outreachCampaignSend.findMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: { in: blocked.map((row) => row.id) } },
    select: { recordId: true },
  });
  const handled = new Set(existing.map((row) => row.recordId));
  const fresh = blocked.filter((row) => !handled.has(row.id));
  if (fresh.length) {
    await db.outreachCampaignSend.createMany({
      data: fresh.map((row) => {
        const recipient = campaignRowRecipient(campaign, row);
        const reason = suppressed.get(recipient);
        return {
          officeId: campaign.officeId,
          campaignId: campaign.id,
          recordId: row.id,
          recipient,
          status: "REJECTED",
          error: reason ? suppressionSkipMessage(reason) : suppressionSkipMessage("MANUAL"),
        };
      }),
      skipDuplicates: true,
    });
    for (const row of fresh) {
      const recipient = campaignRowRecipient(campaign, row);
      const reason = suppressed.get(recipient);
      output.rejected += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "REJECTED",
        senderEmail: null,
        variantKey: null,
        error: reason ? suppressionSkipMessage(reason) : suppressionSkipMessage("MANUAL"),
      });
    }
  }
  const blockedIds = new Set(blocked.map((row) => row.id));
  return rows.filter((row) => !blockedIds.has(row.id));
}

export { RECIPIENT_QUALITY_SUPPRESSION_SOURCE };

// The product-wide recipient quality gate, run on the rows about to be claimed:
// static checks, the domain's MX, and the mailbox verifier within the batch
// budget. Refused rows are recorded as REJECTED so they never take a slot, and
// refusals that describe the address itself are suppressed for the office so
// no later campaign rediscovers them. The gate sees the current list row
// underneath the approved snapshot, so a verdict stored after approval counts,
// unless the row's address was edited away from the approved recipient.
async function rejectUnqualifiedCampaignRows(
  db: CampaignDb,
  campaign: LoadedCampaign,
  rows: CampaignBatchRow[],
  researchData: ReadonlyMap<string, Record<string, unknown>>,
  gate: LiveRecipientGate,
  output: CampaignBatchResult,
) {
  if (!rows.length) return rows;
  const refused: Array<{ row: CampaignBatchRow; recipient: string; error: string; permanent: boolean; detail: string }> = [];
  for (const row of rows) {
    const recipient = campaignRowRecipient(campaign, row);
    const outcome = await gate.check(row, recipient, {
      ...recipientQualityDataFor(researchData.get(row.id), campaign.emailField, recipient),
      ...row.data,
    });
    if (outcome.ok) continue;
    refused.push({ row, recipient, ...recipientQualityRefusal(outcome) });
  }
  output.verificationChecks = gate.paidChecks;
  output.verifierExhausted = gate.verifierExhausted();
  if (!refused.length) return rows;
  const existing = await db.outreachCampaignSend.findMany({
    where: { officeId: campaign.officeId, campaignId: campaign.id, recordId: { in: refused.map((item) => item.row.id) } },
    select: { recordId: true },
  });
  const handled = new Set(existing.map((item) => item.recordId));
  const fresh = refused.filter((item) => !handled.has(item.row.id));
  if (fresh.length) {
    // Suppression is written before the terminal ledger row: the ledger row is
    // what marks the record handled, so a failed suppression write leaves the
    // row unhandled and the next run repeats the check (and the suppression)
    // instead of silently keeping the address eligible for other campaigns.
    for (const item of fresh) {
      if (!item.permanent) continue;
      await upsertEmailSuppression(db, {
        officeId: campaign.officeId,
        email: item.recipient,
        reason: "UNDELIVERABLE",
        source: RECIPIENT_QUALITY_SUPPRESSION_SOURCE,
        detail: item.detail,
        evidenceMessageId: null,
        accountId: null,
      });
    }
    await db.outreachCampaignSend.createMany({
      data: fresh.map((item) => ({
        officeId: campaign.officeId,
        campaignId: campaign.id,
        recordId: item.row.id,
        recipient: item.recipient,
        status: "REJECTED",
        error: item.error,
      })),
      skipDuplicates: true,
    });
    for (const item of fresh) {
      output.rejected += 1;
      output.pruned += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: item.row.id,
        recipient: item.recipient,
        state: "REJECTED",
        senderEmail: null,
        variantKey: null,
        error: item.error,
      });
    }
  }
  const refusedIds = new Set(refused.map((item) => item.row.id));
  return rows.filter((row) => !refusedIds.has(row.id));
}

// Walks the unhandled audience in run-sized chunks until `limit` sendable rows
// are found, so suppressed and unqualified rows are recorded as REJECTED
// without occupying a slot of the run budget or the daily cap.
async function selectSendableCampaignRows(
  db: CampaignDb,
  campaign: LoadedCampaign,
  candidates: CampaignBatchRow[],
  researchData: ReadonlyMap<string, Record<string, unknown>>,
  limit: number,
  output: CampaignBatchResult,
  gate: LiveRecipientGate,
) {
  const sendable: CampaignBatchRow[] = [];
  const chunk = Math.max(1, limit);
  for (let offset = 0; offset < candidates.length && sendable.length < limit; offset += chunk) {
    const page = candidates.slice(offset, offset + chunk);
    const unsuppressed = await rejectSuppressedCampaignRows(db, campaign, page, output);
    const rows = await rejectUnqualifiedCampaignRows(db, campaign, unsuppressed, researchData, gate, output);
    sendable.push(...rows.slice(0, limit - sendable.length));
  }
  return sendable;
}

async function claimOutreachCampaignRows(
  db: CampaignDb,
  campaign: LoadedCampaign,
  records: CampaignBatchRow[],
  requestedLimit: number | undefined,
  now: Date,
) {
  const claim = () => db.$transaction(async (tx) => {
    await tx.outreachCampaignSend.deleteMany({
      where: {
        officeId: campaign.officeId,
        campaignId: campaign.id,
        status: "QUEUED",
        createdAt: { lt: outreachCampaignReclaimBefore(now) },
      },
    });
    await lockOutreachCampaignClaims(tx, campaign.id);
    const sends = await tx.outreachCampaignSend.findMany({
      where: { officeId: campaign.officeId, campaignId: campaign.id },
      select: { recordId: true, status: true },
    });
    const remaining = await outreachCampaignRemainingCapacity(tx, campaign, now);
    const claimLimit = Math.max(0, Math.min(requestedLimit ?? campaign.dailyCap, remaining));
    const handled = new Set(sends.map((send) => send.recordId));
    const contacted = await tx.outreachCampaignSend.findMany({
      where: outreachCampaignContactedWhere({
        officeId: campaign.officeId,
        campaignId: campaign.id,
        now,
      }),
      select: { recipient: true },
    });
    const candidates = dedupeRecipients({
      rows: excludeContactedRecipients({
        rows: records.filter((record) => !handled.has(record.id)),
        recipientOf: (record) => String(record.data[campaign.emailField] ?? ""),
        contacted: new Set(contacted.map((send) => send.recipient.trim().toLowerCase())),
      }),
      recipientOf: (record) => String(record.data[campaign.emailField] ?? ""),
    }).slice(0, claimLimit);
    if (!candidates.length) return [];
    await tx.outreachCampaignSend.createMany({
      data: candidates.map((row) => ({
        officeId: campaign.officeId,
        campaignId: campaign.id,
        recordId: row.id,
        recipient: String(row.data[campaign.emailField] ?? "").trim().toLowerCase(),
        status: "QUEUED",
        variantKey: selectCampaignVariant({
          campaignId: campaign.id,
          recordId: row.id,
          variants: storedCampaignVariants(campaign.variants),
        })?.key ?? null,
      })),
    });
    return candidates;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await claim();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      if (error.code === "P2002") return [];
      if (error.code === "P2034") {
        if (attempt === 0) continue;
        return [];
      }
      throw error;
    }
  }
  return [];
}

export async function runOutreachCampaignBatch(input: {
  officeId: string;
  campaignId: string;
  limit?: number;
  provider?: SupplierEmailProvider;
  now?: Date;
  pauseMs?: number;
  db?: CampaignDb;
  reserve?: typeof reserveEmailSender;
  release?: typeof releaseEmailSenderReservation;
  complete?: typeof completeCampaignIfDone;
  recipientCheck?: LiveRecipientCheck;
}): Promise<CampaignBatchResult> {
  const db = input.db ?? prisma;
  const campaign = await db.outreachCampaign.findFirst({
    where: { id: input.campaignId, officeId: input.officeId },
    select: {
      id: true,
      officeId: true,
      status: true,
      subject: true,
      bodyTemplate: true,
      emailField: true,
      countryField: true,
      companyField: true,
      rowStatuses: true,
      filters: true,
      senderAccountId: true,
      senderDisplayName: true,
      senderRotation: true,
      variants: true,
      dailyCap: true,
      listId: true,
      audienceRecordIds: true,
      audiencePersonalization: true,
      revisionHash: true,
      followUps: true,
    },
  }) as LoadedCampaign | null;
  if (!campaign) throw new Error("Outreach campaign not found.");
  const output = result(campaign.id);
  const now = input.now ?? new Date();
  await db.outreachCampaign.updateMany({
    where: { id: input.campaignId, officeId: input.officeId },
    data: { lastRunAt: now },
  });
  if (!outreachCampaignStatusAllowsSend(campaign.status)) return { ...output, blocked: "NOT_ACTIVE" };
  const audienceRecordIds = jsonStrings(campaign.audienceRecordIds);
  const audiencePersonalization = jsonPersonalization(campaign.audiencePersonalization);
  if (!audienceRecordIds.length || !Object.keys(audiencePersonalization).length) {
    return { ...output, blocked: "NO_AUDIENCE" };
  }
  if (!campaign.senderAccountId && !campaign.senderRotation) return { ...output, blocked: "NO_SENDER" };
  const sendProvider = input.provider ?? gmailSupplierEmailProvider;
  const reserveSender = input.reserve ?? reserveEmailSender;
  const releaseReservation = input.release ?? releaseEmailSenderReservation;
  await reconcileUnknownCampaignSends(db, campaign, sendProvider, now, releaseReservation);
  const records = await db.researchRecord.findMany({
    where: {
      officeId: input.officeId,
      listId: campaign.listId,
      ...(audienceRecordIds.length
        ? { id: { in: audienceRecordIds } }
        : {}),
    },
    select: { id: true, status: true, data: true, createdAt: true },
  }) as CampaignBatchRow[];
  // Every record that already has a ledger row (sent, rejected, unknown, or
  // claimed) is excluded before the daily-cap slice, so later runs page into
  // the rest of the audience instead of re-reading the first rows every day.
  const handledRecords = await db.outreachCampaignSend.findMany({
    where: { officeId: input.officeId, campaignId: campaign.id },
    select: { recordId: true },
  });
  const rows = selectOutreachCampaignSnapshotRows({
    rows: records,
    audienceRecordIds,
    audiencePersonalization,
    sentRecordIds: new Set(handledRecords.map((row) => row.recordId)),
    statuses: jsonStrings(campaign.rowStatuses),
    emailField: campaign.emailField,
    companyField: campaign.companyField,
    countryField: campaign.countryField,
  });
  const runFollowUps = (consumed: number) => runOutreachCampaignFollowUps({
    db,
    campaign: {
      id: campaign.id,
      officeId: campaign.officeId,
      subject: campaign.subject,
      senderAccountId: campaign.senderAccountId,
      senderDisplayName: campaign.senderDisplayName,
      dailyCap: campaign.dailyCap,
      followUps: campaign.followUps ?? null,
      variants: campaign.variants,
      emailField: campaign.emailField,
      audiencePersonalization,
    },
    provider: sendProvider,
    now,
    limit: input.limit === undefined ? undefined : Math.max(0, input.limit - consumed),
    pauseMs: input.pauseMs,
    reserve: reserveSender,
    release: releaseReservation,
    recipientCheck: input.recipientCheck,
    statusAllowsSend: outreachCampaignStatusAllowsSend,
  });
  const researchData = new Map(records.map((record) => [record.id, record.data]));
  const verificationLimit = outreachCampaignVerificationLimit(
    input.limit,
    campaign.dailyCap,
    await outreachCampaignRemainingCapacity(db, campaign, now),
  );
  const sendableRows = verificationLimit > 0
    ? await selectSendableCampaignRows(
      db,
      campaign,
      rows,
      researchData,
      verificationLimit,
      output,
      new LiveRecipientGate(input.recipientCheck),
    )
    : [];
  const claimedRows = sendableRows.length
    ? await claimOutreachCampaignRows(db, campaign, sendableRows, input.limit, now)
    : [];
  if (claimedRows.length === 0) {
    const { start, end } = utcDayBounds(now);
    const sentToday = await db.outreachCampaignSend.count({
      where: { officeId: input.officeId, campaignId: campaign.id, status: "SENT", sentAt: { gte: start, lt: end } },
    });
    const followUps = await runFollowUps(0);
    output.followUps = followUps;
    output.verifierExhausted = output.verifierExhausted || followUps.verifierExhausted;
    await (input.complete ?? completeCampaignIfDone)({
      officeId: input.officeId,
      campaignId: input.campaignId,
    });
    return { ...output, blocked: sentToday >= campaign.dailyCap ? "DAILY_CAP" : undefined };
  }
  // Claims this run will no longer attempt go back to the ledger immediately
  // instead of holding cap capacity until the reclaim window passes.
  const releaseClaimsFrom = async (index: number) => {
    const recordIds = claimedRows.slice(index).map((row) => row.id);
    if (!recordIds.length) return;
    await db.outreachCampaignSend.deleteMany({
      where: {
        officeId: input.officeId,
        campaignId: campaign.id,
        recordId: { in: recordIds },
        status: "QUEUED",
      },
    });
  };
  const reroutedRecords = new Set<string>();
  for (let index = 0; index < claimedRows.length; index += 1) {
    const row = claimedRows[index];
    const current = await db.outreachCampaign.findFirst({
      where: { id: campaign.id, officeId: input.officeId },
      select: { status: true },
    });
    if (!outreachCampaignStatusAllowsSend(current?.status)) {
      await releaseClaimsFrom(index);
      break;
    }
    const data = row.data;
    const recipient = String(data[campaign.emailField] ?? "").trim().toLowerCase();
    const variant = selectCampaignVariant({
      campaignId: campaign.id,
      recordId: row.id,
      variants: storedCampaignVariants(campaign.variants),
    });
    const email = renderCampaignEmail({
      subject: variant?.subject ?? campaign.subject,
      bodyTemplate: variant?.bodyTemplate ?? campaign.bodyTemplate,
      row: {
        company: campaign.companyField ? data[campaign.companyField] : data.company,
        country: campaign.countryField ? data[campaign.countryField] : data.country,
        email: data[campaign.emailField],
      },
    });
    const requestHash = outreachCampaignRequestHash({
      campaignId: campaign.id,
      recordId: row.id,
      recipient,
      subject: email.subject,
      body: email.body,
    });
    const idempotencyKey = outreachCampaignIdempotencyKey(campaign.id, row.id);
    const reservation = await reserveSender({
      officeId: input.officeId,
      idempotencyKey,
      requestHash,
      ...(campaign.senderRotation ? {} : { accountId: campaign.senderAccountId ?? undefined }),
      now,
    });
    if (!("ok" in reservation)) {
      const reservationOutcome = outreachCampaignReservationOutcome(reservation.code);
      if (reservationOutcome.poolExhausted) {
        output.outcomes.push({
          campaignId: campaign.id,
          recordId: row.id,
          recipient,
          state: reservationOutcome.state,
          senderEmail: null,
          variantKey: variant?.key ?? null,
          error: reservation.error,
        });
        output.poolExhausted = true;
        await releaseClaimsFrom(index);
        break;
      }
      // A non-capacity refusal settles the claim in the ledger; leaving it
      // QUEUED would only have it reclaimed and refused again next run.
      const settlement = await settleOutreachReservationFailure(db, { officeId: input.officeId, idempotencyKey, code: reservation.code });
      if (settlement.kind === "UNKNOWN") {
        await recordOutcome(db, {
          officeId: input.officeId,
          campaignId: campaign.id,
          recordId: row.id,
          recipient,
          status: "UNKNOWN",
          senderEmail: settlement.senderEmail,
          error: reservation.error,
          reservationId: settlement.reservationId,
          variantKey: variant?.key ?? null,
        });
        output.unknown += 1;
        output.outcomes.push({
          campaignId: campaign.id,
          recordId: row.id,
          recipient,
          state: "UNKNOWN",
          senderEmail: settlement.senderEmail,
          variantKey: variant?.key ?? null,
          error: reservation.error,
        });
        continue;
      }
      await db.outreachCampaignSend.updateMany({
        where: { officeId: input.officeId, campaignId: campaign.id, recordId: row.id, status: "QUEUED" },
        data: { status: "REJECTED", error: reservation.error, variantKey: variant?.key ?? null },
      });
      output.rejected += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "REJECTED",
        senderEmail: null,
        variantKey: variant?.key ?? null,
        error: reservation.error,
      });
      continue;
    }
    output.attempted += 1;
    if (reservation.completed) {
      await db.outreachCampaignSend.updateMany({
        where: {
          officeId: input.officeId,
          campaignId: campaign.id,
          recordId: row.id,
          status: "QUEUED",
        },
        data: {
          status: "SENT",
          senderEmail: reservation.senderEmail,
          reservationId: reservation.reservationId,
          providerMessageId: reservation.providerMessageId,
          providerThreadId: reservation.providerThreadId,
          localThreadId: reservation.localThreadId,
          error: null,
          variantKey: variant?.key ?? null,
          sentAt: reservation.sentAt ?? now,
        },
      });
      output.alreadySent += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "ALREADY_SENT",
        senderEmail: reservation.senderEmail,
        variantKey: variant?.key ?? null,
        error: null,
      });
      continue;
    }
    await db.outreachCampaignSend.updateMany({
      where: {
        officeId: input.officeId,
        campaignId: campaign.id,
        recordId: row.id,
        status: "QUEUED",
      },
      data: { reservationId: reservation.reservationId },
    });
    const beforeSend = await db.outreachCampaign.findFirst({
      where: { id: campaign.id, officeId: input.officeId },
      select: { status: true },
    });
    if (!outreachCampaignStatusAllowsSend(beforeSend?.status)) {
      await releaseReservation({ officeId: input.officeId, reservationId: reservation.reservationId });
      await releaseClaimsFrom(index);
      break;
    }
    // A bounce, complaint, or opt-out synced while this batch was running is
    // honoured here, after the reservation and before the provider call, so
    // the pre-batch suppression snapshot cannot go stale mid-run.
    const lateSuppression = (await listSuppressedEmails(input.officeId, [recipient], db)).get(recipient);
    if (lateSuppression) {
      await releaseReservation({ officeId: input.officeId, reservationId: reservation.reservationId });
      const error = suppressionSkipMessage(lateSuppression);
      await db.outreachCampaignSend.updateMany({
        where: { officeId: input.officeId, campaignId: campaign.id, recordId: row.id, status: "QUEUED" },
        data: { status: "REJECTED", error, variantKey: variant?.key ?? null },
      });
      output.rejected += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "REJECTED",
        senderEmail: null,
        variantKey: variant?.key ?? null,
        error,
      });
      continue;
    }
    const rfcMessageId = outreachCampaignRfcMessageId(campaign.id, row.id);
    const receipt: SupplierEmailSendResult = await sendProvider.send({
      officeId: input.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.senderEmail,
      recipient,
      subject: email.subject,
      body: email.body,
      rfcMessageId,
      senderDisplayName: campaign.senderDisplayName,
    });
    if (receipt.state === "SENT") {
      await recordSent(db, {
        officeId: input.officeId,
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        senderEmail: reservation.senderEmail,
        reservationId: reservation.reservationId,
        accountId: reservation.accountId,
        subject: email.subject,
        body: email.body,
        rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
        sentAt: now,
        variantKey: variant?.key ?? null,
      });
      output.sent += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "SENT",
        senderEmail: reservation.senderEmail,
        variantKey: variant?.key ?? null,
        error: null,
      });
    } else if (receipt.state === "REJECTED") {
      await releaseReservation({ officeId: input.officeId, reservationId: reservation.reservationId });
      const pausedAction = outreachCampaignPausedSenderAction({
        error: receipt.error,
        rotated: campaign.senderRotation,
        rerouted: reroutedRecords.has(row.id),
      });
      if (pausedAction === "REROUTE") {
        // The released reservation is re-reserved under the same idempotency
        // key; the pool filter excludes the paused mailbox, so the retry lands
        // on another ready mailbox or reports the pool as exhausted.
        reroutedRecords.add(row.id);
        output.rerouted += 1;
        index -= 1;
        continue;
      }
      if (pausedAction === "WAIT") {
        output.outcomes.push({
          campaignId: campaign.id,
          recordId: row.id,
          recipient,
          state: "POOL_EXHAUSTED",
          senderEmail: reservation.senderEmail,
          variantKey: variant?.key ?? null,
          error: receipt.error,
        });
        output.poolExhausted = true;
        await releaseClaimsFrom(index);
        break;
      }
      await recordOutcome(db, {
        officeId: input.officeId,
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        status: "REJECTED",
        senderEmail: reservation.senderEmail,
        error: receipt.error,
        reservationId: reservation.reservationId,
        variantKey: variant?.key ?? null,
      });
      output.rejected += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "REJECTED",
        senderEmail: reservation.senderEmail,
        variantKey: variant?.key ?? null,
        error: receipt.error,
      });
    } else {
      await recordOutcome(db, {
        officeId: input.officeId,
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        status: "UNKNOWN",
        senderEmail: reservation.senderEmail,
        error: receipt.error,
        reservationId: reservation.reservationId,
        variantKey: variant?.key ?? null,
      });
      output.unknown += 1;
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: "UNKNOWN",
        senderEmail: reservation.senderEmail,
        variantKey: variant?.key ?? null,
        error: receipt.error,
      });
    }
    if ((input.pauseMs ?? 400) > 0) await new Promise((resolve) => setTimeout(resolve, input.pauseMs ?? 400));
  }
  if (!output.poolExhausted) {
    const followUps = await runFollowUps(claimedRows.length);
    output.followUps = followUps;
    output.verifierExhausted = output.verifierExhausted || followUps.verifierExhausted;
  }
  await (input.complete ?? completeCampaignIfDone)({
    officeId: input.officeId,
    campaignId: input.campaignId,
  });
  return output;
}
