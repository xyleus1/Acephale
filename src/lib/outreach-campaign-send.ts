import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  campaignRowEligible,
  campaignSnapshotRowSendable,
  renderCampaignEmail,
  selectCampaignVariant,
  storedCampaignVariants,
  type CampaignPersonalization,
} from "@/lib/outreach-campaign-copy";
import {
  completeCampaignIfDone,
} from "@/lib/outreach-campaigns";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { logEmailTouch } from "@/lib/crm/email-touch";
import { utcDayBounds } from "@/lib/email-sender-pool-policy";
import { prisma } from "@/lib/prisma";
import {
  gmailSupplierEmailProvider,
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

export const OUTREACH_CAMPAIGN_RECLAIM_MINUTES = 30;

export type CampaignBatchResult = {
  campaignId: string;
  attempted: number;
  sent: number;
  alreadySent: number;
  rejected: number;
  unknown: number;
  poolExhausted: boolean;
  blocked?: "NOT_ACTIVE" | "DAILY_CAP" | "NO_SENDER" | "NO_AUDIENCE";
  outcomes: CampaignBatchSend[];
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
  limit: number;
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
    .slice(0, input.limit);
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

export function outreachCampaignReclaimBefore(now: Date) {
  return new Date(now.getTime() - OUTREACH_CAMPAIGN_RECLAIM_MINUTES * 60_000);
}

export function outreachCampaignClaimLimit(
  limit: number | undefined,
  dailyCap: number,
  sentToday: number,
  queuedToday: number,
) {
  return Math.max(0, Math.min(limit ?? dailyCap, dailyCap - sentToday - queuedToday));
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

export function outreachCampaignReservationOutcome(code: string) {
  if (code === "POOL_EXHAUSTED" || code === "POOL_EMPTY") {
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
  variants: Prisma.JsonValue | null;
  dailyCap: number;
  listId: string;
  companyField: string | null;
  audienceRecordIds: Prisma.JsonValue | null;
  audiencePersonalization: Prisma.JsonValue | null;
  revisionHash: string | null;
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
    poolExhausted: false,
    outcomes: [],
  };
}

async function reconcileUnknownCampaignSends(
  db: CampaignDb,
  campaign: LoadedCampaign,
  provider: SupplierEmailProvider,
  now: Date,
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
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const send of unknowns) {
    if (!send.reservationId || !send.senderEmail) continue;
    const reservation = await db.emailSenderReservation.findUnique({
      where: { id: send.reservationId, officeId: campaign.officeId, status: "RESERVED" },
      select: { accountId: true },
    });
    if (!reservation) continue;
    const receipt = await provider.reconcile({
      officeId: campaign.officeId,
      accountId: reservation.accountId,
      senderEmail: send.senderEmail,
      rfcMessageId: outreachCampaignRfcMessageId(campaign.id, send.recordId),
    });
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
      sentAt: now,
      variantKey: variant?.key ?? null,
    });
  }
}

async function claimOutreachCampaignRows(
  db: CampaignDb,
  campaign: LoadedCampaign,
  records: CampaignBatchRow[],
  requestedLimit: number | undefined,
  now: Date,
) {
  try {
    return await db.$transaction(async (tx) => {
    await tx.outreachCampaignSend.deleteMany({
      where: {
        officeId: campaign.officeId,
        campaignId: campaign.id,
        status: "QUEUED",
        createdAt: { lt: outreachCampaignReclaimBefore(now) },
      },
    });
    const sends = await tx.outreachCampaignSend.findMany({
      where: { officeId: campaign.officeId, campaignId: campaign.id },
      select: { recordId: true, status: true },
    });
    const { start, end } = utcDayBounds(now);
    const sentToday = await tx.outreachCampaignSend.count({
      where: {
        officeId: campaign.officeId,
        campaignId: campaign.id,
        status: "SENT",
        sentAt: { gte: start, lt: end },
      },
    });
    const queuedToday = sends.filter((send) => send.status === "QUEUED").length;
    const claimLimit = outreachCampaignClaimLimit(requestedLimit, campaign.dailyCap, sentToday, queuedToday);
    const handled = new Set(sends.map((send) => send.recordId));
    const candidates = records.filter((record) => !handled.has(record.id)).slice(0, claimLimit);
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
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return [];
    throw error;
  }
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
      variants: true,
      dailyCap: true,
      listId: true,
      audienceRecordIds: true,
      audiencePersonalization: true,
      revisionHash: true,
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
  if (!campaign.senderAccountId) return { ...output, blocked: "NO_SENDER" };
  const sendProvider = input.provider ?? gmailSupplierEmailProvider;
  await reconcileUnknownCampaignSends(db, campaign, sendProvider, now);
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
  const rows = selectOutreachCampaignSnapshotRows({
    rows: records,
    audienceRecordIds,
    audiencePersonalization,
    sentRecordIds: undefined,
    statuses: jsonStrings(campaign.rowStatuses),
    emailField: campaign.emailField,
    companyField: campaign.companyField,
    countryField: campaign.countryField,
    limit: input.limit ?? campaign.dailyCap,
  });
  const claimedRows = await claimOutreachCampaignRows(db, campaign, rows, input.limit, now);
  if (claimedRows.length === 0) {
    const { start, end } = utcDayBounds(now);
    const sentToday = await db.outreachCampaignSend.count({
      where: { officeId: input.officeId, campaignId: campaign.id, status: "SENT", sentAt: { gte: start, lt: end } },
    });
    await (input.complete ?? completeCampaignIfDone)({
      officeId: input.officeId,
      campaignId: input.campaignId,
    });
    return { ...output, blocked: sentToday >= campaign.dailyCap ? "DAILY_CAP" : undefined };
  }
  const reserveSender = input.reserve ?? reserveEmailSender;
  const releaseReservation = input.release ?? releaseEmailSenderReservation;
  for (const row of claimedRows) {
    const current = await db.outreachCampaign.findFirst({
      where: { id: campaign.id, officeId: input.officeId },
      select: { status: true },
    });
    if (!outreachCampaignStatusAllowsSend(current?.status)) break;
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
    const reservation = await reserveSender({
      officeId: input.officeId,
      idempotencyKey: outreachCampaignIdempotencyKey(campaign.id, row.id),
      requestHash,
      accountId: campaign.senderAccountId,
      now,
    });
    if (!("ok" in reservation)) {
      const reservationOutcome = outreachCampaignReservationOutcome(reservation.code);
      output.outcomes.push({
        campaignId: campaign.id,
        recordId: row.id,
        recipient,
        state: reservationOutcome.state,
        senderEmail: null,
        variantKey: variant?.key ?? null,
        error: reservation.error,
      });
      if (reservationOutcome.poolExhausted) {
        output.poolExhausted = true;
        break;
      }
      output.rejected += 1;
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
          variantKey: variant?.key ?? null,
          sentAt: now,
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
    const beforeSend = await db.outreachCampaign.findFirst({
      where: { id: campaign.id, officeId: input.officeId },
      select: { status: true },
    });
    if (!outreachCampaignStatusAllowsSend(beforeSend?.status)) {
      await releaseReservation({ officeId: input.officeId, reservationId: reservation.reservationId });
      await db.outreachCampaignSend.deleteMany({
        where: {
          officeId: input.officeId,
          campaignId: campaign.id,
          recordId: row.id,
          status: "QUEUED",
        },
      });
      break;
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
  await (input.complete ?? completeCampaignIfDone)({
    officeId: input.officeId,
    campaignId: input.campaignId,
  });
  return output;
}
