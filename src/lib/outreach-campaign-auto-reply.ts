import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import Gpt56Client from "@/lib/gpt56-client";
import { upsertEmailSuppression } from "@/lib/email-delivery-events";
import { classifyDeliveryFeedback, recipientAuthoredBody } from "@/lib/email-delivery-feedback";
import { stripEmDashes } from "@/lib/no-em-dash";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailReconcileResult,
  type SupplierEmailSendResult,
} from "@/lib/supply-os/supplier-email-provider";
import {
  OUTREACH_REPLY_SYSTEM_PROMPT,
  type OutreachReplyContext,
  type OutreachReplyIntent,
} from "@/lib/outreach-campaign-reply-prompt";
import { isHumanReplyMessage } from "@/lib/outreach-campaign-copy";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { prisma } from "@/lib/prisma";

export const AUTO_REPLY_DEFAULT_LIMIT = 25;
export const AUTO_REPLY_MIN_CONFIDENCE = 0.7;
export const AUTO_REPLY_MAX_DRAFT_LENGTH = 1500;
export const AUTO_REPLY_MAX_THREAD_REPLIES = 3;

export type AutoReplyAction = "SENT" | "ESCALATED" | "SUPPRESSED" | "SKIPPED" | "FAILED";
const AUTO_REPLY_CLAIM_TIMEOUT_MS = 30 * 60 * 1000;
const AUTO_REPLY_PENDING_TIMEOUT_MS = 30 * 60 * 1000;
export type ReplyMode = "AUTO" | "DRAFT" | "OFF";

export type AutoReplyDecisionInput = {
  replyMode: ReplyMode;
  intent: string;
  confidence: number;
  needsHuman: boolean;
  reply: string | null | undefined;
  replyContext: OutreachReplyContext | null | undefined;
  priorAutoReplies?: number;
};

export type AutoReplyDecision = {
  action: AutoReplyAction;
  reason: string | null;
  draft: string | null;
};

function replyContextText(context: OutreachReplyContext | null | undefined) {
  return context ? JSON.stringify(context) : "";
}

function currencyAmounts(value: string) {
  return value.match(/(?:£|\$|€|GBP)\s?\d+(?:[.,]\d+)?/gi) ?? [];
}

function guardedDraft(reply: string, context: OutreachReplyContext) {
  const draft = stripEmDashes(reply);
  if (draft.length > AUTO_REPLY_MAX_DRAFT_LENGTH) return { draft, reason: "draft_guard" };
  const contextText = replyContextText(context);
  if (currencyAmounts(draft).some((amount) => !contextText.includes(amount))) {
    return { draft, reason: "draft_guard" };
  }
  return { draft, reason: null };
}

export function decideAutoReply(input: AutoReplyDecisionInput): AutoReplyDecision {
  const draft = typeof input.reply === "string" ? stripEmDashes(input.reply) : null;
  const intent = input.intent.toUpperCase();

  if (input.priorAutoReplies !== undefined && input.priorAutoReplies >= AUTO_REPLY_MAX_THREAD_REPLIES) {
    return { action: "ESCALATED", reason: "max_auto_replies", draft };
  }
  if (intent === "UNSUBSCRIBE") {
    return { action: "SUPPRESSED", reason: "unsubscribe", draft: null };
  }
  if (intent === "OUT_OF_OFFICE") {
    return { action: "SKIPPED", reason: "out_of_office", draft: null };
  }
  if (
    intent === "COMPLAINT"
    || intent === "NEGOTIATION"
    || intent === "OTHER"
    || input.needsHuman
    || input.confidence < AUTO_REPLY_MIN_CONFIDENCE
    || !draft?.trim()
  ) {
    return {
      action: "ESCALATED",
      reason: !draft?.trim() ? "missing_reply" : input.needsHuman ? "needs_human" : input.confidence < AUTO_REPLY_MIN_CONFIDENCE ? "low_confidence" : intent.toLowerCase(),
      draft,
    };
  }
  if (input.replyMode === "DRAFT") {
    return { action: "ESCALATED", reason: "draft_mode", draft };
  }
  if (input.replyMode !== "AUTO") {
    return { action: "SKIPPED", reason: "reply_mode_off", draft: null };
  }
  const context = input.replyContext;
  if (!context || !context.pitch.trim()) {
    return { action: "ESCALATED", reason: "no_reply_context", draft };
  }
  if (![
    "INTERESTED",
    "QUESTION",
    "NOT_NOW",
    "NOT_INTERESTED",
    "WRONG_PERSON",
  ].includes(intent)) {
    return { action: "ESCALATED", reason: "unsupported_intent", draft };
  }
  const guarded = guardedDraft(draft, context);
  if (guarded.reason) return { action: "ESCALATED", reason: guarded.reason, draft: guarded.draft };
  return { action: "SENT", reason: null, draft: guarded.draft };
}

export type OutreachReplyLlm = {
  classify(input: {
    system: string;
    user: string;
  }): Promise<{
    intent: OutreachReplyIntent;
    confidence: number;
    needsHuman: boolean;
    reason: string;
    reply: string | null;
  }>;
};

function defaultLlm(): OutreachReplyLlm {
  return {
    async classify(input) {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
      const client = new Gpt56Client({ apiKey });
      const result = await client.messages.create({
        model: "gpt-5.6",
        max_tokens: 900,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      });
      const block = result.content.find((item) => item.type === "text");
      if (!block || block.type !== "text") throw new Error("LLM returned no text.");
      const parsed: unknown = JSON.parse(block.text.trim());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LLM returned invalid JSON.");
      const value = parsed as Record<string, unknown>;
      const intents = new Set<string>([
        "INTERESTED", "QUESTION", "NOT_NOW", "NOT_INTERESTED", "WRONG_PERSON",
        "UNSUBSCRIBE", "NEGOTIATION", "COMPLAINT", "OUT_OF_OFFICE", "OTHER",
      ]);
      if (
        typeof value.intent !== "string"
        || !intents.has(value.intent)
        || typeof value.confidence !== "number"
        || value.confidence < 0
        || value.confidence > 1
        || typeof value.needsHuman !== "boolean"
        || typeof value.reason !== "string"
        || (value.reply !== null && typeof value.reply !== "string")
      ) {
        throw new Error("LLM response failed validation.");
      }
      return {
        intent: value.intent as OutreachReplyIntent,
        confidence: value.confidence,
        needsHuman: value.needsHuman,
        reason: value.reason,
        reply: value.reply as string | null,
      };
    },
  };
}

type AutoReplyDb = PrismaClient;

type CampaignCandidate = {
  campaign: {
    id: string;
    officeId: string;
    name: string;
    listId: string;
    status: string;
    replyMode: string;
    replyContext: Prisma.JsonValue | null;
    senderDisplayName: string | null;
    audiencePersonalization: Prisma.JsonValue | null;
    emailField: string;
    companyField: string | null;
    countryField: string | null;
  };
  send: {
    recordId: string;
    recipient: string;
    senderEmail: string | null;
    providerThreadId: string | null;
    localThreadId: string;
  };
  thread: {
    id: string;
    subject: string;
    externalThreadId: string | null;
    messages: Array<{
      id: string;
      accountId: string | null;
      direction: string;
      fromEmail: string;
      fromName: string | null;
      toEmails: string;
      subject: string | null;
      bodyText: string | null;
      sentAt: Date;
      rfcMessageId: string | null;
      deliveryKind: string | null;
      classification: string | null;
    }>;
  };
  inbound: CampaignCandidate["thread"]["messages"][number];
  existingReply?: {
    id: string;
    action: string;
    claimedAt: Date | null;
    draft?: string | null;
    rfcMessageId: string | null;
    reservationId: string | null;
  };
};

function asRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function replyContextFromJson(value: Prisma.JsonValue | null) {
  const object = asRecord(value);
  return typeof object.pitch === "string" && object.pitch.trim()
    ? object as unknown as OutreachReplyContext
    : null;
}

function audiencePersonalizationFor(value: Prisma.JsonValue | null, recordId: string) {
  const item = asRecord(value)[recordId];
  return item && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown>
    : {};
}

function recipientExtraFields(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return typeof value === "string"
      && value.trim()
      && (normalized.includes("name") || normalized.includes("town") || normalized.includes("county"));
  }));
}

function formatThread(messages: CampaignCandidate["thread"]["messages"]) {
  return messages
    .slice()
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .slice(-10)
    .map((message) => {
      const sender = message.fromName?.trim() || message.fromEmail;
      const body = (message.bodyText ?? "").slice(0, 4000);
      return `From: ${sender} / Date: ${message.sentAt.toISOString()} / ${body}`;
    })
    .join("\n\n");
}

function llmUserContent(input: {
  context: OutreachReplyContext;
  senderDisplayName: string | null;
  recipient: Record<string, unknown>;
  messages: CampaignCandidate["thread"]["messages"];
}) {
  return [
    "CAMPAIGN CONTEXT",
    JSON.stringify({ ...input.context, senderDisplayName: input.senderDisplayName }),
    "",
    "RECIPIENT",
    JSON.stringify(input.recipient),
    "",
    "THREAD",
    formatThread(input.messages),
  ].join("\n");
}

function isPrismaUnique(error: unknown) {
  return (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    || (error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function normalizedSubject(subject: string) {
  const clean = stripEmDashes(subject).replace(/[\r\n\t]+/g, " ").trim();
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function requestHash(input: {
  campaignId: string;
  inboundMessageId: string;
  recipient: string;
  subject: string;
  body: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function freshRfcMessageId(campaignId: string, inboundMessageId: string) {
  const digest = createHash("sha256").update(`${campaignId}:${inboundMessageId}`).digest("hex").slice(0, 32);
  return `<outreach-reply-${digest}@derya.ai>`;
}

function senderAccountFor(candidate: CampaignCandidate) {
  const outbound = candidate.thread.messages
    .filter((message) => message.direction === "OUTBOUND" && message.accountId)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
  return {
    accountId: outbound?.accountId ?? null,
    senderEmail: candidate.send.senderEmail ?? outbound?.fromEmail ?? null,
  };
}

function isEngineInboundMessage(
  message: CampaignCandidate["thread"]["messages"][number],
  ownAddresses: readonly string[],
) {
  return message.direction === "INBOUND"
    && !ownAddresses.some((address) => address.trim().toLowerCase() === message.fromEmail.trim().toLowerCase())
    && isHumanReplyMessage(message);
}

async function candidateRows(
  db: AutoReplyDb,
  limit: number,
  now: Date,
  campaignId?: string,
  officeId?: string,
): Promise<CampaignCandidate[]> {
  const campaigns = await db.outreachCampaign.findMany({
    where: {
      ...(campaignId ? { id: campaignId } : {}),
      ...(officeId ? { officeId } : {}),
      replyMode: { not: "OFF" },
      status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] },
      sends: { some: { status: "SENT", localThreadId: { not: null } } },
    },
    select: {
      id: true,
      officeId: true,
      name: true,
      listId: true,
      status: true,
      replyMode: true,
      replyContext: true,
      senderDisplayName: true,
      audiencePersonalization: true,
      emailField: true,
      companyField: true,
      countryField: true,
    },
  });
  const candidates: CampaignCandidate[] = [];
  for (const campaign of campaigns) {
    const sends = await db.outreachCampaignSend.findMany({
      where: {
        officeId: campaign.officeId,
        campaignId: campaign.id,
        status: "SENT",
        localThreadId: { not: null },
      },
      select: {
        recordId: true,
        recipient: true,
        senderEmail: true,
        providerThreadId: true,
        localThreadId: true,
      },
    });
    const threadIds = sends.map((send) => send.localThreadId).filter((id): id is string => Boolean(id));
    if (!threadIds.length) continue;
    const threads = await db.emailThread.findMany({
      where: { officeId: campaign.officeId, id: { in: threadIds } },
      select: {
        id: true,
        subject: true,
        externalThreadId: true,
        messages: {
          orderBy: { sentAt: "asc" },
          select: {
            id: true,
            accountId: true,
            direction: true,
            fromEmail: true,
            fromName: true,
            toEmails: true,
            subject: true,
            bodyText: true,
            sentAt: true,
            rfcMessageId: true,
            deliveryKind: true,
            classification: true,
          },
        },
      },
    });
    const existingReplies = await db.outreachCampaignReply.findMany({
      where: {
        officeId: campaign.officeId,
        threadId: { in: threadIds },
      },
      select: {
        id: true,
        threadId: true,
        inboundMessageId: true,
        action: true,
        claimedAt: true,
        draft: true,
        rfcMessageId: true,
        reservationId: true,
      },
    });
    const existingByThread = new Map<string, typeof existingReplies>();
    for (const reply of existingReplies) {
      const threadReplies = existingByThread.get(reply.threadId) ?? [];
      threadReplies.push(reply);
      existingByThread.set(reply.threadId, threadReplies);
    }
    const existingByInbound = new Map(existingReplies.map((reply) => [reply.inboundMessageId, reply]));
    const byThread = new Map(threads.map((thread) => [thread.id, thread]));
    for (const send of sends) {
      if (!send.localThreadId) continue;
      const thread = byThread.get(send.localThreadId);
      if (!thread) continue;
      const latest = thread.messages.at(-1);
      if (!latest) continue;
      const ownAddresses = thread.messages
        .filter((message) => message.direction === "OUTBOUND")
        .map((message) => message.fromEmail);
      const inbound = thread.messages
        .filter((message) => {
          if (!isEngineInboundMessage(message, ownAddresses)) return false;
          const feedback = classifyDeliveryFeedback({
            subject: message.subject ?? thread.subject,
            fromEmail: message.fromEmail,
            bodyText: message.bodyText ?? "",
            headers: [],
            ownAddresses,
          });
          return !feedback || feedback.kind === "OPT_OUT";
        })
        .at(-1);
      if (!inbound || inbound.id !== latest.id) continue;
      const existingReply = existingByInbound.get(inbound.id);
      const threadBlocked = (existingByThread.get(thread.id) ?? []).some((reply) =>
        reply.action === "PENDING"
        || reply.action === "RECONCILING"
        || (reply.action === "CLAIMED"
          && reply.claimedAt
          && now.getTime() - reply.claimedAt.getTime() < AUTO_REPLY_CLAIM_TIMEOUT_MS),
      );
      if (threadBlocked) continue;
      if (existingReply && (
        existingReply.action !== "CLAIMED"
        || (existingReply.claimedAt && now.getTime() - existingReply.claimedAt.getTime() < AUTO_REPLY_CLAIM_TIMEOUT_MS)
      )) continue;
      if (inbound.sentAt > now) continue;
      candidates.push({
        campaign,
        send: { ...send, localThreadId: send.localThreadId },
        thread,
        inbound,
        ...(existingReply ? { existingReply } : {}),
      });
    }
  }
  candidates.sort((a, b) => a.inbound.sentAt.getTime() - b.inbound.sentAt.getTime());
  return candidates.slice(0, limit);
}

async function recordOutcome(
  db: AutoReplyDb,
  candidate: ClaimedCandidate,
  outcome: {
    action: string;
    intent: string;
    confidence: number;
    reason?: string | null;
    draft?: string | null;
    sentMessageId?: string | null;
    providerMessageId?: string | null;
    sentAt?: Date | null;
  },
) {
  return db.outreachCampaignReply.updateMany({
    where: {
      id: candidate.claimId,
      officeId: candidate.campaign.officeId,
      inboundMessageId: candidate.inbound.id,
      action: "CLAIMED",
      claimedAt: candidate.claimToken,
    },
    data: {
      action: outcome.action,
      intent: outcome.intent,
      confidence: outcome.confidence,
      reason: outcome.reason ?? null,
      draft: outcome.draft ?? null,
      sentMessageId: outcome.sentMessageId ?? null,
      providerMessageId: outcome.providerMessageId ?? null,
      sentAt: outcome.sentAt ?? null,
      claimedAt: null,
    },
  });
}

async function recordClaimedOutcome(
  result: AutoReplyRunResult,
  db: AutoReplyDb,
  candidate: ClaimedCandidate,
  item: AutoReplyItem,
) {
  const written = await recordOutcome(db, candidate, item);
  if (written.count === 1) {
    incrementResult(result, item);
  } else {
    incrementResult(result, {
      ...item,
      action: "SKIPPED",
      reason: "claimed",
    });
  }
}

async function updateClaimedWithResult(
  result: AutoReplyRunResult,
  db: AutoReplyDb,
  candidate: ClaimedCandidate,
  item: AutoReplyItem,
  data: Prisma.OutreachCampaignReplyUpdateManyMutationInput,
) {
  const updated = await db.outreachCampaignReply.updateMany({
    where: {
      id: candidate.claimId,
      officeId: candidate.campaign.officeId,
      action: "CLAIMED",
      claimedAt: candidate.claimToken,
    },
    data,
  });
  incrementResult(result, updated.count === 1 ? item : {
    ...item,
    action: "SKIPPED",
    reason: "claimed",
  });
  return updated.count;
}

type ClaimedCandidate = CampaignCandidate & { claimId: string; claimToken: Date };

async function persistSentMessage(
  db: AutoReplyDb,
  candidate: ClaimedCandidate,
  input: {
    accountId: string;
    senderEmail: string;
    recipient: string;
    subject: string;
    body: string;
    rfcMessageId: string;
    providerMessageId: string;
    providerThreadId: string;
    reservationId: string;
    sentAt: Date;
    intent: string;
    confidence: number;
    draft: string;
  },
) {
  return db.$transaction(async (tx) => {
    const message = await tx.emailMessage.create({
      data: {
        threadId: candidate.thread.id,
        accountId: input.accountId,
        officeId: candidate.campaign.officeId,
        externalId: input.rfcMessageId,
        gmailMessageId: input.providerMessageId,
        rfcMessageId: input.rfcMessageId,
        direction: "OUTBOUND",
        fromEmail: input.senderEmail,
        toEmails: JSON.stringify([input.recipient]),
        subject: input.subject,
        bodyText: input.body,
        sentAt: input.sentAt,
      },
      select: { id: true },
    });
    await tx.emailThread.updateMany({
      where: { id: candidate.thread.id, officeId: candidate.campaign.officeId },
      data: { lastMessageAt: input.sentAt, messageCount: { increment: 1 } },
    });
    await tx.emailSenderReservation.updateMany({
      where: {
        id: input.reservationId,
        officeId: candidate.campaign.officeId,
        accountId: input.accountId,
        status: "RESERVED",
      },
      data: {
        status: "RECORDED",
        providerMessageId: input.providerMessageId,
        providerThreadId: input.providerThreadId,
        localThreadId: candidate.thread.id,
        messageId: message.id,
      },
    });
    await tx.outreachCampaignReply.updateMany({
      where: {
        id: candidate.claimId,
        officeId: candidate.campaign.officeId,
        action: { in: ["CLAIMED", "PENDING", "RECONCILING"] },
      },
      data: {
        action: "SENT",
        intent: input.intent,
        confidence: input.confidence,
        draft: input.draft,
        sentMessageId: message.id,
        providerMessageId: input.providerMessageId,
        sentAt: input.sentAt,
        claimedAt: null,
        pendingAt: null,
      },
    });
    return message.id;
  });
}

async function reconcilePendingReplies(
  db: AutoReplyDb,
  provider: SupplierEmailProvider,
  release: typeof releaseEmailSenderReservation,
  now: Date,
  officeId?: string,
) {
  const pending = await db.outreachCampaignReply.findMany({
    where: { ...(officeId ? { officeId } : {}), action: { in: ["PENDING", "RECONCILING"] } },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: {
      id: true,
      officeId: true,
      campaignId: true,
      threadId: true,
      inboundMessageId: true,
      intent: true,
      confidence: true,
      rfcMessageId: true,
      reservationId: true,
      draft: true,
      createdAt: true,
      action: true,
      claimedAt: true,
      pendingAt: true,
    },
  });
  for (const row of pending) {
    const staleReconciliation = row.action === "RECONCILING"
      && (!row.claimedAt || now.getTime() - row.claimedAt.getTime() >= AUTO_REPLY_CLAIM_TIMEOUT_MS);
    if (row.action === "RECONCILING" && !staleReconciliation) continue;
    const claimed = await db.outreachCampaignReply.updateMany({
      where: row.action === "PENDING"
        ? { id: row.id, officeId: row.officeId, action: "PENDING" }
        : { id: row.id, officeId: row.officeId, action: "RECONCILING", claimedAt: row.claimedAt },
      data: { action: "RECONCILING", claimedAt: now },
    });
    if (claimed.count !== 1) continue;
    if (!row.rfcMessageId || !row.reservationId) {
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: { action: "FAILED", reason: "pending_incomplete", claimedAt: null, pendingAt: null },
      });
      continue;
    }
    const reservation = await db.emailSenderReservation.findFirst({
      where: { id: row.reservationId, officeId: row.officeId },
      select: { id: true, accountId: true, account: { select: { id: true, email: true } } },
    });
    const accountId = reservation?.accountId;
    const senderEmail = reservation?.account.email;
    if (!reservation || !accountId || !senderEmail) {
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: { action: "FAILED", reason: "pending_incomplete", claimedAt: null, pendingAt: null },
      });
      continue;
    }
    let receipt: SupplierEmailReconcileResult;
    try {
      receipt = await provider.reconcile({ officeId: row.officeId, accountId, senderEmail, rfcMessageId: row.rfcMessageId });
    } catch (error) {
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: {
          action: "PENDING",
          reason: error instanceof Error ? error.message.slice(0, 300) : "reconcile_failed",
          claimedAt: null,
        },
      });
      continue;
    }
    if (receipt.state === "NOT_FOUND") {
      if (row.pendingAt && now.getTime() - row.pendingAt.getTime() >= AUTO_REPLY_PENDING_TIMEOUT_MS) {
        await release({ officeId: row.officeId, reservationId: reservation.id });
        await db.outreachCampaignReply.updateMany({
          where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
          data: { action: "FAILED", reason: "delivery_unconfirmed", claimedAt: null, pendingAt: null },
        });
      } else {
        await db.outreachCampaignReply.updateMany({
          where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
          data: { action: "PENDING", claimedAt: null },
        });
      }
      continue;
    }
    if (receipt.state !== "SENT") {
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: { action: "PENDING", reason: receipt.error?.slice(0, 300) ?? null, claimedAt: null },
      });
      continue;
    }
    const campaign = await db.outreachCampaign.findFirst({
      where: { id: row.campaignId, officeId: row.officeId },
      select: {
        id: true,
        officeId: true,
        name: true,
        listId: true,
        status: true,
        replyMode: true,
        replyContext: true,
        senderDisplayName: true,
        audiencePersonalization: true,
        emailField: true,
        companyField: true,
        countryField: true,
      },
    });
    const send = await db.outreachCampaignSend.findFirst({
      where: { officeId: row.officeId, campaignId: row.campaignId, localThreadId: row.threadId, status: "SENT" },
      select: { recordId: true, recipient: true, senderEmail: true, providerThreadId: true, localThreadId: true },
    });
    const thread = await db.emailThread.findFirst({
      where: { officeId: row.officeId, id: row.threadId },
      select: {
        id: true,
        subject: true,
        externalThreadId: true,
        messages: {
          orderBy: { sentAt: "asc" },
          select: {
            id: true,
            accountId: true,
            direction: true,
            fromEmail: true,
            fromName: true,
            toEmails: true,
            subject: true,
            bodyText: true,
            sentAt: true,
            rfcMessageId: true,
            deliveryKind: true,
            classification: true,
          },
        },
      },
    });
    const inbound = thread?.messages.find((message) => message.id === row.inboundMessageId);
    if (!campaign || !send || !thread || !inbound) {
      await db.emailSenderReservation.updateMany({
        where: { id: reservation.id, officeId: row.officeId, status: "RESERVED" },
        data: {
          status: "RECORDED",
          providerMessageId: receipt.providerMessageId,
          providerThreadId: receipt.providerThreadId,
          localThreadId: thread?.id ?? null,
        },
      });
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: {
          action: "SENT",
          providerMessageId: receipt.providerMessageId,
          sentAt: now,
          claimedAt: null,
          pendingAt: null,
        },
      });
      continue;
    }
    const candidate = {
      campaign,
      send: { ...send, localThreadId: send.localThreadId ?? row.threadId },
      thread,
      inbound,
      claimId: row.id,
      claimToken: now,
    } as ClaimedCandidate;
    try {
      await persistSentMessage(db, candidate, {
        accountId,
        senderEmail,
        recipient: inbound.fromEmail,
        subject: normalizedSubject(thread.subject),
        body: row.draft ?? "",
        rfcMessageId: row.rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
        reservationId: reservation.id,
        sentAt: now,
        intent: row.intent,
        confidence: row.confidence,
        draft: row.draft ?? "",
      });
    } catch (error) {
      if (isPrismaUnique(error)) {
        const existingMessage = await db.emailMessage.findFirst({
          where: { officeId: row.officeId, rfcMessageId: row.rfcMessageId },
          select: { id: true, gmailMessageId: true, sentAt: true },
        });
        if (existingMessage) {
          await db.emailSenderReservation.updateMany({
            where: { id: reservation.id, officeId: row.officeId },
            data: {
              status: "RECORDED",
              providerMessageId: receipt.providerMessageId,
              providerThreadId: receipt.providerThreadId,
              localThreadId: row.threadId,
              messageId: existingMessage.id,
            },
          });
          await db.outreachCampaignReply.updateMany({
            where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
            data: {
              action: "SENT",
              sentMessageId: existingMessage.id,
              providerMessageId: receipt.providerMessageId,
              sentAt: existingMessage.sentAt ?? now,
              claimedAt: null,
              pendingAt: null,
            },
          });
          continue;
        }
      }
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "RECONCILING" },
        data: {
          action: "PENDING",
          reason: error instanceof Error ? error.message.slice(0, 300) : "persist_pending",
          claimedAt: null,
        },
      });
    }
  }
}

export type AutoReplyItem = {
  campaignId: string;
  threadId: string;
  inboundMessageId: string;
  intent: string;
  confidence: number;
  action: AutoReplyAction | "PENDING";
  reason: string | null;
  draft: string | null;
  sentMessageId?: string | null;
  providerMessageId?: string | null;
};

export type AutoReplyRunResult = {
  examined: number;
  sent: number;
  escalated: number;
  suppressed: number;
  skipped: number;
  failed: number;
  items: AutoReplyItem[];
};

function emptyResult(): AutoReplyRunResult {
  return { examined: 0, sent: 0, escalated: 0, suppressed: 0, skipped: 0, failed: 0, items: [] };
}

function incrementResult(result: AutoReplyRunResult, item: AutoReplyItem) {
  if (item.action !== "PENDING") {
    result[item.action.toLowerCase() as "sent" | "escalated" | "suppressed" | "skipped" | "failed"] += 1;
  }
  result.items.push(item);
}

function optOutWording(value: string) {
  return /\bunsubscribe\b|\bremove me\b|\bstop emailing\b|\bdo not contact\b|\btake me off\b/i.test(value);
}

async function retrySuppressionPersistence(db: AutoReplyDb, officeId: string | undefined) {
  const rows = await db.outreachCampaignReply.findMany({
    where: {
      ...(officeId ? { officeId } : {}),
      action: "SENT",
      reason: "suppression_retry",
    },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { id: true, officeId: true, inboundMessageId: true },
  });
  for (const row of rows) {
    const inbound = await db.emailMessage.findFirst({
      where: { id: row.inboundMessageId, officeId: row.officeId, direction: "INBOUND" },
      select: { fromEmail: true },
    });
    if (!inbound?.fromEmail) continue;
    try {
      await upsertEmailSuppression(db, {
        officeId: row.officeId,
        email: inbound.fromEmail,
        reason: "OPTED_OUT",
        source: "outreach-auto-reply",
        detail: "Recipient was not interested.",
        evidenceMessageId: row.inboundMessageId,
        accountId: null,
      });
      await db.outreachCampaignReply.updateMany({
        where: { id: row.id, officeId: row.officeId, action: "SENT", reason: "suppression_retry" },
        data: { reason: null },
      });
    } catch {
      continue;
    }
  }
}

export async function runOutreachCampaignAutoReplies(opts: {
  limit?: number;
  now?: Date;
  db?: PrismaClient;
  llm?: OutreachReplyLlm;
  provider?: SupplierEmailProvider;
  campaignId?: string;
  officeId?: string;
  reserve?: typeof reserveEmailSender;
  release?: typeof releaseEmailSenderReservation;
}): Promise<AutoReplyRunResult> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? AUTO_REPLY_DEFAULT_LIMIT, 100));
  const result = emptyResult();
  const llm = opts.llm ?? defaultLlm();
  const provider = opts.provider ?? gmailSupplierEmailProvider;
  const reserve = opts.reserve ?? reserveEmailSender;
  const release = opts.release ?? releaseEmailSenderReservation;
  await retrySuppressionPersistence(db, opts.officeId);
  await reconcilePendingReplies(db, provider, release, now, opts.officeId);
  const candidates = await candidateRows(db, limit, now, opts.campaignId, opts.officeId);

  for (const candidateBase of candidates) {
    result.examined += 1;
    let candidate = candidateBase as ClaimedCandidate;
    try {
      const claimed = await db.outreachCampaignReply.create({
        data: {
          officeId: candidate.campaign.officeId,
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 0,
          action: "CLAIMED",
          reason: null,
          claimedAt: now,
        },
        select: { id: true },
      });
      candidate = { ...candidate, claimId: claimed.id, claimToken: now };
    } catch (error) {
      if (isPrismaUnique(error)) {
        if (!candidate.existingReply) {
          incrementResult(result, {
            campaignId: candidate.campaign.id,
            threadId: candidate.thread.id,
            inboundMessageId: candidate.inbound.id,
            intent: "OTHER",
            confidence: 0,
            action: "SKIPPED",
            reason: "claimed",
            draft: null,
          });
          continue;
        }
        const existingReply = candidate.existingReply;
        const reclaimed = await db.outreachCampaignReply.updateMany({
          where: {
            id: existingReply.id,
            officeId: candidate.campaign.officeId,
            action: "CLAIMED",
            claimedAt: existingReply.claimedAt,
          },
          data: { action: "CLAIMED", reason: null, claimedAt: now },
        });
        if (reclaimed.count !== 1) {
          incrementResult(result, {
            campaignId: candidate.campaign.id,
            threadId: candidate.thread.id,
            inboundMessageId: candidate.inbound.id,
            intent: "OTHER",
            confidence: 0,
            action: "SKIPPED",
            reason: "claimed",
            draft: null,
          });
          continue;
        }
        candidate = { ...candidate, claimId: existingReply.id, claimToken: now };
        if (existingReply.rfcMessageId && existingReply.reservationId) {
          const pending = await db.outreachCampaignReply.updateMany({
            where: {
              id: candidate.claimId,
              officeId: candidate.campaign.officeId,
              action: "CLAIMED",
            },
            data: {
              action: "PENDING",
              reason: "delivery_uncertain",
              draft: existingReply.draft ?? null,
              pendingAt: now,
              claimedAt: null,
            },
          });
          if (pending.count === 1) {
            const item = {
              campaignId: candidate.campaign.id,
              threadId: candidate.thread.id,
              inboundMessageId: candidate.inbound.id,
              intent: "OTHER",
              confidence: 0,
              action: "PENDING" as const,
              reason: "delivery_uncertain",
              draft: existingReply.draft ?? null,
            };
            incrementResult(result, item);
          }
          continue;
        }
      }
      else throw error;
    }

    try {
      const inboundText = recipientAuthoredBody(candidate.inbound.bodyText ?? "");
      const feedback = classifyDeliveryFeedback({
        subject: candidate.inbound.subject ?? candidate.thread.subject,
        fromEmail: candidate.inbound.fromEmail,
        bodyText: candidate.inbound.bodyText ?? "",
        headers: [],
        ownAddresses: candidate.thread.messages.filter((message) => message.direction === "OUTBOUND").map((message) => message.fromEmail),
      });
      if (feedback && ["BOUNCE", "AUTO_REPLY", "COMPLAINT"].includes(feedback.kind)) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 1,
          action: "SKIPPED" as const,
          reason: "delivery_feedback",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      if (feedback?.kind === "OPT_OUT" || optOutWording(inboundText)) {
        try {
          await upsertEmailSuppression(db, {
            officeId: candidate.campaign.officeId,
            email: candidate.inbound.fromEmail,
            reason: "OPTED_OUT",
            source: "outreach-auto-reply",
            detail: "Recipient asked not to be contacted.",
            evidenceMessageId: candidate.inbound.id,
            accountId: senderAccountFor(candidate).accountId,
          });
        } catch {
          const item = {
            campaignId: candidate.campaign.id,
            threadId: candidate.thread.id,
            inboundMessageId: candidate.inbound.id,
            intent: "UNSUBSCRIBE",
            confidence: 1,
            action: "FAILED" as const,
            reason: "suppression_failed",
            draft: null,
          };
          await updateClaimedWithResult(result, db, candidate, item, {
            reason: "suppression_retry",
            claimedAt: null,
          });
          continue;
        }
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "UNSUBSCRIBE",
          confidence: 1,
          action: "SUPPRESSED" as const,
          reason: "unsubscribe",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      const context = replyContextFromJson(candidate.campaign.replyContext);
      if (!context) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 1,
          action: "ESCALATED" as const,
          reason: "no_reply_context",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      const priorAutoReplies = await db.outreachCampaignReply.count({
        where: {
          officeId: candidate.campaign.officeId,
          threadId: candidate.thread.id,
          action: { in: ["SENT", "PENDING", "RECONCILING"] },
        },
      });
      if (priorAutoReplies >= AUTO_REPLY_MAX_THREAD_REPLIES) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 1,
          action: "ESCALATED" as const,
          reason: "max_auto_replies",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      const sender = senderAccountFor(candidate);
      if (!sender.accountId || !sender.senderEmail) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 1,
          action: "ESCALATED" as const,
          reason: "sender_unavailable",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      const account = await db.emailAccount.findFirst({
        where: { id: sender.accountId, email: sender.senderEmail },
        select: { id: true, email: true, isActive: true, sendEnabled: true, sendPausedAt: true },
      });
      if (!account?.isActive || !account.sendEnabled || account.sendPausedAt) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: "OTHER",
          confidence: 1,
          action: "ESCALATED" as const,
          reason: "sender_unavailable",
          draft: null,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }

      const personalization = audiencePersonalizationFor(candidate.campaign.audiencePersonalization, candidate.send.recordId);
      const record = await db.researchRecord.findFirst({
        where: { id: candidate.send.recordId, officeId: candidate.campaign.officeId, listId: candidate.campaign.listId },
        select: { data: true },
      });
      const data = asRecord(record?.data as Prisma.JsonValue | null);
      const classification: Awaited<ReturnType<OutreachReplyLlm["classify"]>> = await llm.classify({
        system: OUTREACH_REPLY_SYSTEM_PROMPT,
        user: llmUserContent({
          context,
          senderDisplayName: candidate.campaign.senderDisplayName,
          recipient: {
            email: personalization.email ?? candidate.send.recipient,
            company: personalization.company ?? (typeof data[candidate.campaign.companyField ?? "company"] === "string" ? data[candidate.campaign.companyField ?? "company"] : null),
            country: personalization.country ?? (typeof data[candidate.campaign.countryField ?? "country"] === "string" ? data[candidate.campaign.countryField ?? "country"] : null),
            ...recipientExtraFields(data),
          },
          messages: candidate.thread.messages,
        }),
      });
      const decision = decideAutoReply({
        replyMode: candidate.campaign.replyMode === "DRAFT" ? "DRAFT" : "AUTO",
        intent: classification.intent,
        confidence: classification.confidence,
        needsHuman: classification.needsHuman,
        reply: classification.reply,
        replyContext: context,
        priorAutoReplies,
      });
      if (decision.action !== "SENT") {
        if (decision.action === "SUPPRESSED") {
          try {
            await upsertEmailSuppression(db, {
              officeId: candidate.campaign.officeId,
              email: candidate.inbound.fromEmail,
              reason: "OPTED_OUT",
              source: "outreach-auto-reply",
              detail: classification.reason,
              evidenceMessageId: candidate.inbound.id,
              accountId: sender.accountId,
            });
          } catch {
            const item = {
              campaignId: candidate.campaign.id,
              threadId: candidate.thread.id,
              inboundMessageId: candidate.inbound.id,
              intent: classification.intent,
              confidence: classification.confidence,
              action: "FAILED" as const,
              reason: "suppression_failed",
              draft: decision.draft,
            };
            await updateClaimedWithResult(result, db, candidate, item, {
              reason: "suppression_retry",
              claimedAt: null,
            });
            continue;
          }
        }
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: decision.action,
          reason: decision.reason,
          draft: decision.draft,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      const subject = normalizedSubject(candidate.thread.subject);
      const body = decision.draft ?? "";
      const reservation = await reserve({
        officeId: candidate.campaign.officeId,
        accountId: sender.accountId,
        idempotencyKey: `outreach-auto-reply:${candidate.inbound.id}`,
        requestHash: requestHash({
          campaignId: candidate.campaign.id,
          inboundMessageId: candidate.inbound.id,
          recipient: candidate.inbound.fromEmail,
          subject,
          body,
        }),
        now,
      });
      const rfcMessageId = candidate.existingReply?.rfcMessageId
        ?? freshRfcMessageId(candidate.campaign.id, candidate.inbound.id);
      if (!("ok" in reservation)) {
        const uncertainReservationId = reservation.reservationId ?? candidate.existingReply?.reservationId;
        if (
          reservation.code === "DELIVERY_UNCERTAIN"
          && uncertainReservationId
        ) {
          const item = {
            campaignId: candidate.campaign.id,
            threadId: candidate.thread.id,
            inboundMessageId: candidate.inbound.id,
            intent: classification.intent,
            confidence: classification.confidence,
            action: "PENDING" as const,
            reason: "delivery_uncertain",
            draft: body,
          };
          await updateClaimedWithResult(result, db, candidate, item, {
            action: "PENDING",
            reason: item.reason,
            draft: body,
            rfcMessageId,
            reservationId: uncertainReservationId,
            pendingAt: now,
            claimedAt: null,
          });
          continue;
        }
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: "ESCALATED" as const,
          reason: "sender_capacity",
          draft: body,
        };
        await recordClaimedOutcome(result, db, candidate, item);
        continue;
      }
      if (reservation.completed) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: "PENDING" as const,
          reason: "reservation_completed",
          draft: body,
        };
        await updateClaimedWithResult(result, db, candidate, item, {
          action: "PENDING",
          reason: item.reason,
          draft: body,
          rfcMessageId,
          reservationId: reservation.reservationId,
          pendingAt: now,
          claimedAt: null,
        });
        continue;
      }
      let prepared: { count: number };
      try {
        prepared = await db.outreachCampaignReply.updateMany({
          where: { id: candidate.claimId, officeId: candidate.campaign.officeId, action: "CLAIMED", claimedAt: candidate.claimToken },
          data: { rfcMessageId, reservationId: reservation.reservationId },
        });
      } catch (error) {
        await release({
          officeId: candidate.campaign.officeId,
          reservationId: reservation.reservationId,
        });
        throw error;
      }
      if (prepared.count !== 1) {
        if (!reservation.completed) {
          await release({
            officeId: candidate.campaign.officeId,
            reservationId: reservation.reservationId,
          });
        }
        incrementResult(result, {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: "SKIPPED",
          reason: "claimed",
          draft: body,
        });
        continue;
      }
      let receipt: SupplierEmailSendResult;
      try {
        receipt = await provider.send({
          officeId: candidate.campaign.officeId,
          accountId: reservation.accountId,
          senderEmail: reservation.senderEmail,
          recipient: candidate.inbound.fromEmail,
          subject,
          body,
          rfcMessageId,
          providerThreadId: candidate.thread.externalThreadId ?? candidate.send.providerThreadId,
          inReplyToRfcMessageId: candidate.inbound.rfcMessageId,
          senderDisplayName: candidate.campaign.senderDisplayName,
        });
      } catch (error) {
        receipt = { state: "UNKNOWN", error: error instanceof Error ? error.message : "provider_failed" };
      }
      if (receipt.state !== "SENT") {
        if (receipt.state === "REJECTED") {
          await release({ officeId: candidate.campaign.officeId, reservationId: reservation.reservationId });
        }
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: receipt.state === "UNKNOWN" ? "PENDING" as const : "FAILED" as const,
          reason: receipt.state === "UNKNOWN" ? null : receipt.error.slice(0, 300),
          draft: body,
        };
        await updateClaimedWithResult(result, db, candidate, item, {
          action: item.action,
          intent: item.intent,
          confidence: item.confidence,
          reason: item.reason,
          draft: body,
          rfcMessageId,
          reservationId: reservation.reservationId,
          pendingAt: item.action === "PENDING" ? now : null,
          claimedAt: null,
        });
        continue;
      }
      try {
        const sentMessageId = await persistSentMessage(db, candidate, {
          accountId: reservation.accountId,
          senderEmail: reservation.senderEmail,
          recipient: candidate.inbound.fromEmail,
          subject,
          body,
          rfcMessageId,
          providerMessageId: receipt.providerMessageId,
          providerThreadId: receipt.providerThreadId,
          reservationId: reservation.reservationId,
          sentAt: now,
          intent: classification.intent,
          confidence: classification.confidence,
          draft: body,
        });
        if (classification.intent === "NOT_INTERESTED") {
          try {
            await upsertEmailSuppression(db, {
              officeId: candidate.campaign.officeId,
              email: candidate.inbound.fromEmail,
              reason: "OPTED_OUT",
              source: "outreach-auto-reply",
              detail: "Recipient was not interested.",
              evidenceMessageId: candidate.inbound.id,
              accountId: reservation.accountId,
            });
          } catch {
            const markedForRetry = await db.outreachCampaignReply.updateMany({
              where: {
                id: candidate.claimId,
                officeId: candidate.campaign.officeId,
                action: "SENT",
              },
              data: { reason: "suppression_retry" },
            });
            const item = {
              campaignId: candidate.campaign.id,
              threadId: candidate.thread.id,
              inboundMessageId: candidate.inbound.id,
              intent: classification.intent,
              confidence: classification.confidence,
              action: "SENT" as const,
              reason: "suppression_failed",
              draft: body,
              sentMessageId,
              providerMessageId: receipt.providerMessageId,
            };
            incrementResult(result, markedForRetry.count === 1 ? item : {
              ...item,
              action: "SKIPPED",
              reason: "claimed",
            });
            continue;
          }
        }
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: "SENT" as const,
          reason: null,
          draft: body,
          sentMessageId,
          providerMessageId: receipt.providerMessageId,
        };
        incrementResult(result, item);
      } catch (error) {
        const item = {
          campaignId: candidate.campaign.id,
          threadId: candidate.thread.id,
          inboundMessageId: candidate.inbound.id,
          intent: classification.intent,
          confidence: classification.confidence,
          action: "PENDING" as const,
          reason: error instanceof Error ? error.message.slice(0, 300) : "recording_failed",
          draft: body,
        };
        await updateClaimedWithResult(result, db, candidate, item, {
          action: "PENDING",
          reason: "persist_pending",
          draft: body,
          rfcMessageId,
          reservationId: reservation.reservationId,
          pendingAt: now,
          claimedAt: null,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : "auto_reply_failed";
      try {
        await db.outreachCampaignReply.updateMany({
          where: {
            id: candidate.claimId,
            officeId: candidate.campaign.officeId,
            inboundMessageId: candidate.inbound.id,
            action: "CLAIMED",
          },
          data: { action: "FAILED", reason, claimedAt: null },
        });
      } catch {
        // Keep processing the remaining candidates if recording the failure also fails.
      }
      incrementResult(result, {
        campaignId: candidate.campaign.id,
        threadId: candidate.thread.id,
        inboundMessageId: candidate.inbound.id,
        intent: "OTHER",
        confidence: 0,
        action: "FAILED",
        reason,
        draft: null,
      });
    }
  }
  return result;
}
