import { NextRequest, NextResponse } from "next/server";
import { Prisma, UserRole } from "@prisma/client";
import { normalizeLoginEmail } from "@/lib/login-code";
import { readBoundedText, boundedText } from "@/lib/ops-input";
import { opsSecretAuthorized } from "@/lib/ops-secret";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/research-lists";
import {
  campaignFollowUpBlockers,
  normalizeCampaignFollowUps,
  resolveCampaignOffice,
} from "@/lib/outreach-campaign-copy";
import {
  activateCampaign,
  CAMPAIGN_STATUSES_ALL,
  campaignRecipientFeedback,
  campaignReplyDigest,
  listCampaignSummaries,
  planOutreachCampaign,
  saveDraftCampaign,
  setCampaignFollowUps,
} from "@/lib/outreach-campaigns";
import {
  outreachCampaignRunNowLimitValid,
  runOutreachCampaignBatch,
} from "@/lib/outreach-campaign-send";
import { listEmailSenderPoolAccounts } from "@/lib/email-sender-pool";
import { SHARED_MAILBOX_POOL_FILTER } from "@/lib/email-account-pool";
import { senderProtectionWindow } from "@/lib/email-delivery-events";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH_LIMIT = 50;

type CampaignOpsBody = {
  action?: unknown;
  officeId?: unknown;
  officeSlug?: unknown;
  list?: unknown;
  senderMailbox?: unknown;
  senderRotation?: unknown;
  senderDisplayName?: unknown;
  emailField?: unknown;
  companyField?: unknown;
  countryField?: unknown;
  segmentField?: unknown;
  statuses?: unknown;
  countries?: unknown;
  segments?: unknown;
  dailyCap?: unknown;
  campaignName?: unknown;
  subject?: unknown;
  body?: unknown;
  variants?: unknown;
  followUps?: unknown;
  campaignId?: unknown;
  revisionHash?: unknown;
  approvedByEmail?: unknown;
  confirm?: unknown;
  limit?: unknown;
};

function isPrismaError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    || (error instanceof Error && error.constructor.name.startsWith("PrismaClient"));
}

function boundedStringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const bounded = boundedText(item, max);
    return bounded ? [bounded] : [];
  });
}

async function resolveOffice(value: unknown) {
  const officeIdentifier = boundedText(value, 120);
  if (!officeIdentifier) throw new Error("officeSlug is required.");
  const selected = { id: true, name: true } as const;
  const byId = await prisma.office.findUnique({
    where: { id: officeIdentifier },
    select: selected,
  });
  if (byId) return byId;
  const byName = await prisma.office.findMany({
    where: { name: { equals: officeIdentifier, mode: "insensitive" } },
    select: selected,
    orderBy: { id: "asc" },
  });
  const candidates = [...byName];
  let cursor: string | undefined;
  while (true) {
    const offices = await prisma.office.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      select: selected,
      orderBy: { id: "asc" },
      take: 500,
    });
    candidates.push(...offices);
    if (offices.length < 500) break;
    cursor = offices[offices.length - 1]?.id;
  }
  return resolveCampaignOffice({
    identifier: officeIdentifier,
    offices: candidates,
    slugify,
  });
}

function variantsInput(value: unknown) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error("variants must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each variant must be an object.");
    }
    const variant = item as Record<string, unknown>;
    const unexpectedKeys = Object.keys(variant).filter(
      (key) => !["key", "subject", "body", "bodyTemplate"].includes(key),
    );
    if (unexpectedKeys.length > 0) {
      throw new Error(`Campaign variant ${index + 1} has unsupported fields.`);
    }
    return {
      key: typeof variant.key === "string" ? variant.key : "",
      subject: typeof variant.subject === "string" ? variant.subject : "",
      bodyTemplate: typeof variant.body === "string"
        ? variant.body
        : typeof variant.bodyTemplate === "string" ? variant.bodyTemplate : "",
    };
  });
}

function followUpsInput(value: unknown, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one follow-up step is required.");
  }
  const normalized = normalizeCampaignFollowUps(value);
  if (normalized.length !== value.length) {
    throw new Error("Every follow-up step must have an integer waitDays and a body.");
  }
  return normalized;
}

export async function POST(request: NextRequest) {
  if (!opsSecretAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const text = await readBoundedText(request, MAX_BODY_BYTES);
  if (text === null) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  let body: CampaignOpsBody | null;
  try {
    body = JSON.parse(text) as CampaignOpsBody;
  } catch {
    body = null;
  }
  const action = boundedText(body?.action, 30);
  if (!action || !["mailboxes", "status", "replies", "plan", "approve", "followups", "run"].includes(action)) {
    return NextResponse.json({ error: "action must be mailboxes, status, replies, plan, approve, followups, or run." }, { status: 400 });
  }

  try {
    if (action === "mailboxes") {
      const mailboxes = await listEmailSenderPoolAccounts();
      const pausedAccounts = await prisma.emailAccount.findMany({
        where: {
          ...SHARED_MAILBOX_POOL_FILTER,
          sendEnabled: true,
          sendPausedAt: { not: null },
        },
        select: {
          id: true,
          email: true,
          provider: true,
          dailySendLimit: true,
          sendPausedAt: true,
          sendPausedReason: true,
        },
      });
      const now = new Date();
      const paused = await Promise.all(pausedAccounts.map(async (account) => ({
        id: account.id,
        email: account.email,
        provider: account.provider,
        dailySendLimit: account.dailySendLimit,
        pausedAt: account.sendPausedAt!.toISOString(),
        pausedReason: account.sendPausedReason,
        window: await senderProtectionWindow(prisma, { accountId: account.id, now }),
      })));
      return NextResponse.json({
        mailboxes: mailboxes.map((mailbox) => ({
          id: mailbox.id,
          email: mailbox.email,
          provider: mailbox.provider,
          dailySendLimit: mailbox.dailySendLimit,
          sentToday: mailbox.sentToday,
        })),
        paused,
      });
    }

    const office = await resolveOffice(body?.officeId ?? body?.officeSlug);
    if (action === "status") {
      const campaignId = boundedText(body?.campaignId, 120);
      const summaries = await listCampaignSummaries(office.id, CAMPAIGN_STATUSES_ALL);
      const scoped = campaignId ? summaries.filter((summary) => summary.id === campaignId) : summaries;
      const feedback = await campaignRecipientFeedback({
        officeId: office.id,
        campaignIds: scoped.map((summary) => summary.id),
      });
      return NextResponse.json({
        office: { id: office.id, name: office.name },
        campaigns: scoped.map((summary) => ({
          ...summary,
          feedback: feedback.get(summary.id) ?? { bounced: 0, complained: 0, optedOut: 0, blocked: 0 },
        })),
      });
    }
    if (action === "replies") {
      const campaignId = boundedText(body?.campaignId, 120);
      const summaries = await listCampaignSummaries(office.id, CAMPAIGN_STATUSES_ALL);
      const scoped = campaignId ? summaries.filter((summary) => summary.id === campaignId) : summaries;
      const requestedLimit = body?.limit;
      if (
        requestedLimit !== undefined
        && (typeof requestedLimit !== "number"
          || !Number.isInteger(requestedLimit)
          || requestedLimit < 1
          || requestedLimit > 500)
      ) {
        return NextResponse.json({ error: "limit must be an integer between 1 and 500." }, { status: 400 });
      }
      const digest = await campaignReplyDigest({
        officeId: office.id,
        campaignIds: scoped.map((summary) => summary.id),
        limit: requestedLimit,
      });
      const emptyCounts = {
        replyThreads: 0,
        answered: 0,
        awaitingAnswer: 0,
        autoReplies: 0,
        bounces: 0,
        optOuts: 0,
        complaints: 0,
      };
      return NextResponse.json({
        office: { id: office.id, name: office.name },
        campaigns: scoped.map((summary) => ({
          campaignId: summary.id,
          counts: digest.counts.get(summary.id) ?? emptyCounts,
        })),
        replies: digest.replies,
      });
    }
    if (action === "plan") {
      const senderMailbox = boundedText(body?.senderMailbox, 320);
      const senderRotation = body?.senderRotation === true;
      if (senderMailbox && senderRotation) {
        return NextResponse.json({ error: "Pick either a sender mailbox or rotation, not both." }, { status: 400 });
      }
      const mailboxes = await listEmailSenderPoolAccounts();
      const sender = senderMailbox
        ? mailboxes.find((mailbox) => mailbox.id === senderMailbox
          || mailbox.email.toLowerCase() === senderMailbox.toLowerCase())
        : null;
      if (!sender && !senderRotation) return NextResponse.json({ error: "Sender mailbox was not found in the shared sending pool." }, { status: 404 });
      const campaignInput = {
        officeId: office.id,
        list: boundedText(body?.list, 120) ?? "",
        emailField: boundedText(body?.emailField, 120),
        companyField: boundedText(body?.companyField, 120),
        countryField: boundedText(body?.countryField, 120),
        segmentField: boundedText(body?.segmentField, 120),
        statuses: boundedStringArray(body?.statuses, 120),
        countries: boundedStringArray(body?.countries, 120),
        segments: boundedStringArray(body?.segments, 120),
        senderAccountId: sender?.id ?? null,
        senderRotation,
        senderDisplayName: boundedText(body?.senderDisplayName, 160) ?? null,
        dailyCap: typeof body?.dailyCap === "number" ? body.dailyCap : undefined,
        campaignName: boundedText(body?.campaignName, 160),
        subject: typeof body?.subject === "string" ? body.subject : "",
        bodyTemplate: typeof body?.body === "string" ? body.body : "",
        variants: variantsInput(body?.variants),
        followUps: followUpsInput(body?.followUps, true),
      };
      const plan = await planOutreachCampaign(campaignInput);
      const campaign = await saveDraftCampaign({ ...campaignInput, emailField: plan.emailField });
      return NextResponse.json({ plan, campaignId: campaign.id, revisionHash: campaign.revisionHash });
    }

    const campaignId = boundedText(body?.campaignId, 100);
    if (!campaignId) return NextResponse.json({ error: "campaignId is required." }, { status: 400 });
    if (action === "approve") {
      if (body?.confirm !== "send outreach campaign") {
        return NextResponse.json({ error: "confirm must be exactly \"send outreach campaign\"." }, { status: 400 });
      }
      const revisionHash = boundedText(body?.revisionHash, 128);
      const approvedByEmail = boundedText(body?.approvedByEmail, 320);
      if (!revisionHash || !approvedByEmail) {
        return NextResponse.json({ error: "revisionHash and approvedByEmail are required." }, { status: 400 });
      }
      const user = await prisma.user.findFirst({
        where: {
          officeId: office.id,
          email: normalizeLoginEmail(approvedByEmail),
          role: UserRole.ADMIN,
          isActive: true,
        },
        select: { id: true },
      });
      if (!user) return NextResponse.json({ error: "Active ADMIN approver was not found in the office." }, { status: 403 });
      const result = await activateCampaign({
        officeId: office.id,
        campaignId,
        userId: user.id,
        expectedRevisionHash: revisionHash,
      });
      return NextResponse.json(result, { status: result.activated ? 200 : 409 });
    }
    if (action === "followups") {
      if (body?.confirm !== "approve outreach follow-ups") {
        return NextResponse.json({ error: "confirm must be exactly \"approve outreach follow-ups\"." }, { status: 400 });
      }
      const approvedByEmail = boundedText(body?.approvedByEmail, 320);
      if (!approvedByEmail) {
        return NextResponse.json({ error: "approvedByEmail is required." }, { status: 400 });
      }
      const user = await prisma.user.findFirst({
        where: {
          officeId: office.id,
          email: normalizeLoginEmail(approvedByEmail),
          role: UserRole.ADMIN,
          isActive: true,
        },
        select: { id: true },
      });
      if (!user) return NextResponse.json({ error: "Active ADMIN approver was not found in the office." }, { status: 403 });
      const followUps = followUpsInput(body?.followUps);
      if (!followUps) return NextResponse.json({ error: "At least one follow-up step is required." }, { status: 400 });
      const blockers = campaignFollowUpBlockers(followUps);
      if (blockers.length) return NextResponse.json({ error: blockers[0], blockers }, { status: 400 });
      const result = await setCampaignFollowUps({
        officeId: office.id,
        campaignId,
        followUps,
        approvedByUserId: user.id,
      });
      if (!result.updated) {
        if (result.reason === "FOLLOW_UPS_ALREADY_IN_FLIGHT") {
          return NextResponse.json({
            error: "Follow-up steps cannot be replaced once follow-ups have been queued or sent.",
            reason: result.reason,
          }, { status: 409 });
        }
        return NextResponse.json({
          error: "Outreach campaign is no longer editable.",
          reason: result.reason,
        }, { status: 409 });
      }
      return NextResponse.json(result);
    }

    const campaign = await prisma.outreachCampaign.findFirst({
      where: { id: campaignId, officeId: office.id },
      select: { dailyCap: true },
    });
    if (!campaign) return NextResponse.json({ error: "Outreach campaign not found." }, { status: 404 });
    if (body?.limit !== undefined && !outreachCampaignRunNowLimitValid(body.limit, campaign.dailyCap)) {
      return NextResponse.json({ error: `limit must be a finite integer between 1 and the campaign daily cap (${campaign.dailyCap}).` }, { status: 400 });
    }
    const effectiveLimit = Math.min(
      typeof body?.limit === "number" ? body.limit : campaign.dailyCap,
      MAX_BATCH_LIMIT,
    );
    const result = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId,
      limit: effectiveLimit,
    });
    return NextResponse.json({ ...result, limit: effectiveLimit });
  } catch (error) {
    if (error instanceof Error && !isPrismaError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Database operation failed." }, { status: 500 });
  }
}
