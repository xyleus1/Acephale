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
import {
  procurementReplyFacts,
  supplierInboundNotice,
  supplierInboundKind,
  triageSupplierInbound,
  type ProcurementReplyFacts,
} from "@/lib/procurement-inbound-triage";
import { readCampaignPlan } from "@/lib/procurement-campaign-class";
import { isPositiveReply } from "@/lib/supply-os/positive-reply";
import { prisma } from "@/lib/prisma";
import { OTHER_PROJECT } from "@/lib/supply-os/prospect-project";
import { getProcurementRequest } from "@/lib/procurement-workflow";

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
  escalatedThreadIds: string[];
};

export { isPositiveReply };

export type ProjectStatusThreadFact = {
  threadId: string;
  latestMessageDirection: "INBOUND" | "OUTBOUND" | null;
  latestHumanInboundAt: Date | string | null;
  latestHumanInboundSubject: string | null;
  latestHumanInboundBody: string | null;
  latestOutboundAt: Date | string | null;
  latestInboundAt?: Date | string | null;
  latestInboundSubject?: string | null;
  latestInboundBody?: string | null;
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
  facts: ProcurementReplyFacts;
  goal?: number | null;
}): ProjectStatusFacts {
  const escalatedThreadIds = input.threads
    .filter((thread) => {
      const inboundAt = dateValue(thread.latestInboundAt ?? thread.latestHumanInboundAt);
      const outboundAt = dateValue(thread.latestOutboundAt);
      if (!inboundAt || (outboundAt && outboundAt > inboundAt)) return false;
      const triage = triageSupplierInbound({
        subject: thread.latestInboundSubject ?? thread.latestHumanInboundSubject,
        body: thread.latestInboundBody ?? thread.latestHumanInboundBody ?? "",
        facts: input.facts,
        bestEffort: true,
      });
      return triage.kind === "BOUNCE"
        || triage.kind === "WRONG_RECIPIENT"
        || triage.decision === "NEEDS_HUMAN";
    })
    .map((thread) => thread.threadId);
  return {
    kind: "sourcing",
    key: input.key,
    leads: input.progress.companies,
    mailsSent: input.progress.contacted,
    replies: input.threads.filter((thread) => dateValue(thread.latestHumanInboundAt)).length,
    activeThreads: input.threads.filter((thread) => activeThread(thread, new Date())).length,
    succeeded: input.progress.quoted,
    successLabel: "quotes in",
    goal: input.goal ?? null,
    escalations: escalatedThreadIds.length,
    escalatedThreadIds,
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
    escalatedThreadIds: [],
  };
}

export function campaignsForProspectingProject<T extends { list: { projectId: string | null } }>(
  campaigns: readonly T[],
  key: string,
): T[] {
  return campaigns.filter((campaign) => (
    key === OTHER_PROJECT
      ? campaign.list.projectId === null
      : campaign.list.projectId === key
  ));
}

function humanInbound(message: LocalRfqMessage) {
  return message.direction === "INBOUND" && isHumanReplyMessage({
    deliveryKind: message.deliveryKind ?? null,
    classification: message.classification ?? null,
  });
}

export function sourcingThreadFacts(messages: readonly LocalRfqMessage[]): ProjectStatusThreadFact[] {
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
    const latestInbound = [...ordered].reverse().find((message) => (
      humanInbound(message)
      && !supplierInboundNotice(message.subject ?? "", message.body)
    ));
    const latestOutbound = [...ordered].reverse().find((message) => message.direction === "OUTBOUND");
    const latestTriageInbound = [...ordered].reverse().find((message) => (
      message.direction === "INBOUND"
      && (
        supplierInboundKind(message.subject ?? "", message.body) === "BOUNCE"
        || !supplierInboundNotice(message.subject ?? "", message.body)
      )
    ));
    const latestMessageDirection: ProjectStatusThreadFact["latestMessageDirection"] =
      latest?.direction === "INBOUND" || latest?.direction === "OUTBOUND"
        ? latest.direction
        : null;
    return {
      threadId: thread[0]?.threadId ?? "",
      latestMessageDirection,
      latestHumanInboundAt: latestInbound?.sentAt ?? null,
      latestHumanInboundSubject: latestInbound?.subject ?? null,
      latestHumanInboundBody: latestInbound?.body ?? null,
      latestOutboundAt: latestOutbound?.sentAt ?? null,
      latestInboundAt: latestTriageInbound?.sentAt ?? null,
      latestInboundSubject: latestTriageInbound?.subject ?? null,
      latestInboundBody: latestTriageInbound?.body ?? null,
    };
  }).filter((thread) => thread.latestHumanInboundAt || thread.latestInboundAt);
}

export function storedQuoteGoalFromJobs(
  jobs: readonly { payload: unknown }[],
  sourceWorkspaceId: string | null,
) {
  if (!sourceWorkspaceId) return null;
  for (const job of jobs) {
    const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload as Record<string, unknown>
      : {};
    if (payload.workspaceId !== sourceWorkspaceId) continue;
    return readCampaignPlan(payload.campaign)?.quoteGoal ?? null;
  }
  return null;
}

export async function storedQuoteGoal(officeId: string, sourceWorkspaceId: string | null) {
  if (!sourceWorkspaceId) return null;
  const job = await prisma.backgroundJob.findFirst({
    where: {
      officeId,
      type: "PROCUREMENT_SOURCING_WAVE",
      payload: { path: ["workspaceId"], equals: sourceWorkspaceId },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  return job ? storedQuoteGoalFromJobs([job], sourceWorkspaceId) : null;
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
    escalatedThreadIds: [],
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
  const [progress, messages, goal, request] = await Promise.all([
    loadProcurementOrderProgressFacts({
      orderId: order.orderId,
      officeId,
    }),
    loadLocalRfqMessages(officeId, order.orderId),
    storedQuoteGoal(officeId, order.sourceWorkspaceId),
    getProcurementRequest(order.customerId, order.orderId),
  ]);
  if (!progress) return emptyProjectStatus("sourcing", key);
  return reduceSourcingProjectStatus({
    key,
    progress,
    threads: sourcingThreadFacts(messages),
    facts: procurementReplyFacts(request ?? {
      material: order.material,
      quantity: Number(order.quantity),
      unit: order.unit,
      neededBy: order.neededBy,
      specification: order.specification,
      requestContext: {},
    }),
    goal,
  });
}

async function loadProspectingStatus(officeId: string, key: string) {
  const project = key === OTHER_PROJECT
    ? await prisma.researchList.findFirst({
        where: { officeId, projectId: null },
        select: { id: true },
      })
    : await prisma.researchProject.findFirst({
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
  ]));
  const projectCampaigns = campaignsForProspectingProject(campaigns, key);
  const digest = await campaignReplyDigest({
    officeId,
    campaignIds: projectCampaigns.map((campaign) => campaign.id),
    limit: 100_000,
  });
  const replies = projectCampaigns.flatMap((campaign) => digest.replies
      .filter((reply) => reply.campaignId === campaign.id)
      .map((reply) => ({
        body: reply.snippet,
        active: !reply.answered || Boolean(
          reply.answeredAt
            && reply.answeredAt >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        ),
      })));
  return reduceProspectingProjectStatus({ key, campaigns: projectCampaigns, replies });
}

export async function loadProjectStatusFacts(args: {
  officeId: string;
  kind: "sourcing" | "prospecting";
  key: string;
}) {
  if (args.kind === "sourcing") return loadSourcingStatus(args.officeId, args.key);
  return loadProspectingStatus(args.officeId, args.key);
}
