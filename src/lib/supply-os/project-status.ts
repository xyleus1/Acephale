import "server-only";

import { isHumanReplyMessage } from "@/lib/outreach-campaign-copy";
import {
  campaignReplyDigest,
  listCampaignSummaries,
  type CampaignSummary,
} from "@/lib/outreach-campaigns";
import {
  loadLocalRfqMessages,
} from "@/lib/procurement-local-outreach";
import type { LocalRfqMessage } from "@/lib/procurement-local-outreach-model";
import {
  loadBulkRfqOrder,
  type BulkRfqOrder,
} from "@/lib/procurement-bulk-rfq";
import {
  loadProcurementOrderProgressFacts,
  type ProcurementOrderProgressFacts,
} from "@/lib/procurement-order-status";
import { readCampaignPlan } from "@/lib/procurement-campaign-class";
import { supplierReplyText } from "@/lib/procurement-inbound-triage";
import { prisma } from "@/lib/prisma";

export type ProjectStatusFacts = {
  kind: "sourcing" | "prospecting";
  key: string;
  leads: number;
  mailsSent: number;
  replies: number;
  activeThreads: number;
  succeeded: number;
  successLabel: string;
  goal: number | null;
  escalations: number;
};

export const POSITIVE_REPLY = /\b(happy to (chat|talk|meet|connect)|let'?s (schedule|set up|book|talk|meet)|(schedule|book|set up) a (call|meeting|demo)|send (me )?(a|your) (calendar|calendly|availability)|(i'?m|we'?re|we are|i am) interested|sounds (good|great|interesting)|yes,? (please|let'?s)|(ok|okay) to (meet|buy|proceed)|(we|i) (can|could) (supply|quote|provide|do (this|that))|quote (is )?attached|please find (our|the) (quote|offer|pricing)|move forward|go ahead)\b/i;

const NEGATIVE_REPLY = /\b(not interested|no thanks|unsubscribe|remove me|not a fit|no longer)\b/i;

export function isPositiveReply(body: string | null | undefined) {
  const text = supplierReplyText(body ?? "");
  return Boolean(text && POSITIVE_REPLY.test(text) && !NEGATIVE_REPLY.test(text));
}

export type ProjectStatusThreadFact = {
  latestMessageDirection: "INBOUND" | "OUTBOUND" | null;
  latestHumanInboundAt: Date | string | null;
  latestHumanInboundBody: string | null;
  latestOutboundAt: Date | string | null;
};

function dateValue(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function activeThread(fact: ProjectStatusThreadFact, now: Date) {
  const inboundAt = dateValue(fact.latestHumanInboundAt);
  const outboundAt = dateValue(fact.latestOutboundAt);
  if (!inboundAt) return false;
  const unanswered = !outboundAt || outboundAt <= inboundAt;
  const answeredRecently = Boolean(
    outboundAt
      && outboundAt > inboundAt
      && outboundAt >= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
  );
  return unanswered || answeredRecently;
}

export function reduceSourcingProjectStatus(input: {
  key: string;
  progress: ProcurementOrderProgressFacts;
  threads: readonly ProjectStatusThreadFact[];
  goal?: number | null;
}): ProjectStatusFacts {
  return {
    kind: "sourcing",
    key: input.key,
    leads: input.progress.vendors,
    mailsSent: input.progress.contacted,
    replies: input.threads.filter((thread) => dateValue(thread.latestHumanInboundAt)).length,
    activeThreads: input.threads.filter((thread) => activeThread(thread, new Date())).length,
    succeeded: input.progress.quoted,
    successLabel: "quotes in",
    goal: input.goal ?? null,
    escalations: 0,
  };
}

export function reduceProspectingProjectStatus(input: {
  key: string;
  campaigns: readonly Pick<CampaignSummary, "total" | "sent" | "followUpsSent">[];
  replies: readonly { body: string | null; active: boolean }[];
}): ProjectStatusFacts {
  return {
    kind: "prospecting",
    key: input.key,
    leads: input.campaigns.reduce((total, campaign) => total + campaign.total, 0),
    mailsSent: input.campaigns.reduce((total, campaign) => total + campaign.sent + campaign.followUpsSent, 0),
    replies: input.replies.length,
    activeThreads: input.replies.filter((reply) => reply.active).length,
    succeeded: input.replies.filter((reply) => isPositiveReply(reply.body)).length,
    successLabel: "positive replies",
    goal: null,
    escalations: 0,
  };
}

function humanInbound(message: LocalRfqMessage) {
  return message.direction === "INBOUND" && isHumanReplyMessage({
    deliveryKind: message.deliveryKind ?? null,
    classification: message.classification ?? null,
  });
}

function sourcingThreadFacts(messages: readonly LocalRfqMessage[]): ProjectStatusThreadFact[] {
  const byThread = new Map<string, LocalRfqMessage[]>();
  for (const message of messages) {
    const bucket = byThread.get(message.threadId) ?? [];
    bucket.push(message);
    byThread.set(message.threadId, bucket);
  }
  return [...byThread.values()].map((thread) => {
    const ordered = [...thread].sort((left, right) => (
      new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime()
    ));
    const latest = ordered.at(-1);
    const latestInbound = [...ordered].reverse().find(humanInbound);
    const latestOutbound = [...ordered].reverse().find((message) => message.direction === "OUTBOUND");
    const latestMessageDirection: ProjectStatusThreadFact["latestMessageDirection"] =
      latest?.direction === "INBOUND" || latest?.direction === "OUTBOUND"
        ? latest.direction
        : null;
    return {
      latestMessageDirection,
      latestHumanInboundAt: latestInbound?.sentAt ?? null,
      latestHumanInboundBody: latestInbound?.body ?? null,
      latestOutboundAt: latestOutbound?.sentAt ?? null,
    };
  }).filter((thread) => thread.latestHumanInboundAt);
}

async function storedQuoteGoal(officeId: string, orderId: string) {
  const jobs = await prisma.backgroundJob.findMany({
    where: { officeId, type: "PROCUREMENT_SOURCING_WAVE" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { payload: true },
  });
  for (const job of jobs) {
    const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload as Record<string, unknown>
      : {};
    const entries = Array.isArray(payload.plan) ? payload.plan : [];
    if (!entries.some((entry) => (
      entry && typeof entry === "object" && !Array.isArray(entry)
      && (entry as Record<string, unknown>).orderId === orderId
    ))) continue;
    return readCampaignPlan(payload.campaign)?.quoteGoal ?? null;
  }
  return null;
}

function emptyProjectStatus(kind: "sourcing" | "prospecting", key: string): ProjectStatusFacts {
  return {
    kind,
    key,
    leads: 0,
    mailsSent: 0,
    replies: 0,
    activeThreads: 0,
    succeeded: 0,
    successLabel: kind === "sourcing" ? "quotes in" : "positive replies",
    goal: null,
    escalations: 0,
  };
}

async function loadSourcingStatus(officeId: string, key: string) {
  let order: BulkRfqOrder | null = null;
  try {
    order = await loadBulkRfqOrder(key);
  } catch {
    return null;
  }
  if (!order || order.officeId !== officeId) return null;
  const [progress, messages, goal] = await Promise.all([
    loadProcurementOrderProgressFacts({
      orderId: order.orderId,
      officeId,
    }),
    loadLocalRfqMessages(officeId, order.orderId),
    storedQuoteGoal(officeId, order.orderId),
  ]);
  if (!progress) return emptyProjectStatus("sourcing", key);
  return reduceSourcingProjectStatus({
    key,
    progress,
    threads: sourcingThreadFacts(messages),
    goal,
  });
}

async function loadProspectingStatus(officeId: string, key: string) {
  const project = await prisma.researchProject.findFirst({
    where: { id: key, officeId },
    select: { id: true },
  });
  if (!project) return null;
  const campaigns = (await listCampaignSummaries(officeId, [
    "DRAFT",
    "ACTIVE",
    "PAUSED",
    "COMPLETED",
    "CANCELLED",
  ])).filter((campaign) => campaign.list.projectId === key);
  const digest = await campaignReplyDigest({
    officeId,
    campaignIds: campaigns.map((campaign) => campaign.id),
    limit: 100_000,
  });
  const replies = campaigns.flatMap((campaign) => digest.replies
      .filter((reply) => reply.campaignId === campaign.id)
      .map((reply) => ({
        body: reply.snippet,
        active: !reply.answered || Boolean(
          reply.answeredAt
            && reply.answeredAt >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        ),
      })));
  return reduceProspectingProjectStatus({ key, campaigns, replies });
}

export async function loadProjectStatusFacts(args: {
  officeId: string;
  kind: "sourcing" | "prospecting";
  key: string;
}) {
  if (args.kind === "sourcing") return loadSourcingStatus(args.officeId, args.key);
  return loadProspectingStatus(args.officeId, args.key);
}
