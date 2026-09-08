import { NextRequest, NextResponse } from "next/server";
import { opsSecretAuthorized } from "@/lib/ops-secret";
import { prisma } from "@/lib/prisma";
import {
  CAMPAIGN_STATUSES_ALL,
  campaignRecipientFeedback,
  campaignReplyDigest,
  listCampaignSummaries,
} from "@/lib/outreach-campaigns";
import { summarizeProcurementRequests } from "@/lib/procurement-workflow";
import {
  buildOpsPortfolioReport,
  type OpsPortfolioMatch,
  type OpsPortfolioOfficeInput,
} from "@/lib/ops-portfolio";

export const runtime = "nodejs";

function queryValue(request: NextRequest, name: string) {
  const value = request.nextUrl.searchParams.get(name)?.trim();
  return value ? value.slice(0, 120) : null;
}

async function loadOfficePortfolio(office: {
  id: string;
  name: string;
  createdAt: Date;
}): Promise<OpsPortfolioOfficeInput> {
  const [
    companiesTotal,
    companies,
    workflowAccounts,
    researchLists,
    emailThreadTotal,
    inboundMessages,
    outboundMessages,
    summaries,
  ] = await Promise.all([
    prisma.company.count({ where: { officeId: office.id } }),
    prisma.company.findMany({
      where: { officeId: office.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 50,
    }),
    prisma.companyWorkflowAccount.findMany({
      where: { officeId: office.id },
      select: { id: true, companyId: true, name: true, company: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.researchList.findMany({
      where: { officeId: office.id },
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.emailThread.count({ where: { officeId: office.id } }),
    prisma.emailMessage.count({ where: { thread: { officeId: office.id }, direction: "INBOUND" } }),
    prisma.emailMessage.count({ where: { thread: { officeId: office.id }, direction: "OUTBOUND" } }),
    listCampaignSummaries(office.id, CAMPAIGN_STATUSES_ALL),
  ]);

  const listIds = researchLists.map((list) => list.id);
  const campaignIds = summaries.map((summary) => summary.id);
  const [recordCounts, digest, feedback, autoReplyCounts] = await Promise.all([
    listIds.length
      ? prisma.researchRecord.groupBy({
        by: ["listId", "status"],
        where: { officeId: office.id, listId: { in: listIds } },
        _count: { _all: true },
      })
      : Promise.resolve([]),
    campaignReplyDigest({ officeId: office.id, campaignIds }),
    campaignRecipientFeedback({ officeId: office.id, campaignIds }),
    campaignIds.length
      ? prisma.outreachCampaignReply.groupBy({
        by: ["campaignId", "action"],
        where: { officeId: office.id, campaignId: { in: campaignIds } },
        _count: { _all: true },
      })
      : Promise.resolve([]),
  ]);

  const countsByList = new Map<string, { total: number; byStatus: Record<string, number> }>();
  for (const row of recordCounts) {
    const counts = countsByList.get(row.listId) ?? { total: 0, byStatus: {} };
    counts.total += row._count._all;
    counts.byStatus[row.status] = (counts.byStatus[row.status] ?? 0) + row._count._all;
    countsByList.set(row.listId, counts);
  }
  const autoRepliesByCampaign = new Map<string, {
    sent: number;
    escalated: number;
    suppressed: number;
    skipped: number;
    failed: number;
  }>();
  for (const row of autoReplyCounts) {
    const counts = autoRepliesByCampaign.get(row.campaignId) ?? {
      sent: 0,
      escalated: 0,
      suppressed: 0,
      skipped: 0,
      failed: 0,
    };
    if (
      row.action === "SENT"
      || row.action === "ESCALATED"
      || row.action === "SUPPRESSED"
      || row.action === "SKIPPED"
      || row.action === "FAILED"
    ) {
      counts[row.action.toLowerCase() as "sent" | "escalated" | "suppressed" | "skipped" | "failed"] = row._count._all;
    }
    autoRepliesByCampaign.set(row.campaignId, counts);
  }

  const procurement = await Promise.all(workflowAccounts.map(async (account) => {
    try {
      const summary = await summarizeProcurementRequests(account.id);
      return {
        customerId: account.id,
        companyName: account.company.name,
        ...summary,
      };
    } catch {
      return { customerId: account.id, error: "unavailable" as const };
    }
  }));

  return {
    office: {
      id: office.id,
      name: office.name,
      createdAt: office.createdAt.toISOString(),
    },
    companies,
    companiesTotal,
    workflowAccounts: workflowAccounts.map((account) => ({
      id: account.id,
      companyId: account.companyId,
      companyName: account.company.name,
      name: account.name,
    })),
    researchLists: researchLists.map((list) => ({
      ...list,
      records: countsByList.get(list.id) ?? { total: 0, byStatus: {} },
    })),
    campaigns: summaries.map((summary) => {
      const replyCounts = digest.counts.get(summary.id);
      const feedbackCounts = feedback.get(summary.id);
      return {
        id: summary.id,
        name: summary.name,
        status: summary.status,
        replyMode: summary.replyMode,
        listId: summary.listId,
        sends: {
          total: summary.total,
          sent: summary.sent,
          rejected: summary.rejected,
        },
        followUps: {
          total: summary.followUpSteps,
          sent: summary.followUpsSent,
          skipped: summary.followUpsSkipped,
        },
        replies: {
          threads: replyCounts?.replyThreads ?? 0,
          answered: replyCounts?.answered ?? 0,
          awaitingAnswer: replyCounts?.awaitingAnswer ?? 0,
          autoReplies: replyCounts?.autoReplies ?? 0,
          bounces: Math.max(feedbackCounts?.bounced ?? 0, replyCounts?.bounces ?? 0),
          optOuts: Math.max(feedbackCounts?.optedOut ?? 0, replyCounts?.optOuts ?? 0),
          complaints: Math.max(feedbackCounts?.complained ?? 0, replyCounts?.complaints ?? 0),
        },
        autoReplyLedger: autoRepliesByCampaign.get(summary.id) ?? {
          sent: 0,
          escalated: 0,
          suppressed: 0,
          skipped: 0,
          failed: 0,
        },
      };
    }),
    emailThreads: {
      total: emailThreadTotal,
      inbound: inboundMessages,
      outbound: outboundMessages,
    },
    procurement,
  };
}

export async function GET(request: NextRequest) {
  if (!opsSecretAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const officeQuery = queryValue(request, "office");
    const searchQuery = queryValue(request, "q");
    const offices = await prisma.office.findMany({
      where: officeQuery
        ? {
            OR: [
              { id: officeQuery },
              { name: { equals: officeQuery, mode: "insensitive" } },
            ],
          }
        : undefined,
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    const officeIds = offices.map((office) => office.id);
    const officeData = await Promise.all(offices.map(loadOfficePortfolio));
    let matches: OpsPortfolioMatch[] | undefined;
    if (searchQuery && officeIds.length) {
      const officeScope = { in: officeIds };
      const [officeMatches, companyMatches, listMatches, campaignMatches, workflowMatches] = await Promise.all([
        prisma.office.findMany({
          where: { id: officeScope, name: { contains: searchQuery, mode: "insensitive" } },
          select: { id: true, name: true },
        }),
        prisma.company.findMany({
          where: { officeId: officeScope, name: { contains: searchQuery, mode: "insensitive" } },
          select: { id: true, name: true, office: { select: { id: true, name: true } } },
        }),
        prisma.researchList.findMany({
          where: {
            officeId: officeScope,
            OR: [
              { name: { contains: searchQuery, mode: "insensitive" } },
              { slug: { contains: searchQuery, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, office: { select: { id: true, name: true } } },
        }),
        prisma.outreachCampaign.findMany({
          where: { officeId: officeScope, name: { contains: searchQuery, mode: "insensitive" } },
          select: { id: true, name: true, office: { select: { id: true, name: true } } },
        }),
        prisma.companyWorkflowAccount.findMany({
          where: {
            officeId: officeScope,
            OR: [
              { name: { contains: searchQuery, mode: "insensitive" } },
              { company: { name: { contains: searchQuery, mode: "insensitive" } } },
            ],
          },
          select: { id: true, name: true, company: { select: { name: true } }, office: { select: { id: true, name: true } } },
        }),
      ]);
      matches = [
        ...officeMatches.map((office) => ({ kind: "office" as const, officeId: office.id, officeName: office.name, id: office.id, name: office.name })),
        ...companyMatches.map((company) => ({ kind: "company" as const, officeId: company.office.id, officeName: company.office.name, id: company.id, name: company.name })),
        ...listMatches.map((list) => ({ kind: "list" as const, officeId: list.office.id, officeName: list.office.name, id: list.id, name: list.name })),
        ...campaignMatches.map((campaign) => ({ kind: "campaign" as const, officeId: campaign.office.id, officeName: campaign.office.name, id: campaign.id, name: campaign.name })),
        ...workflowMatches.map((account) => ({ kind: "workflowAccount" as const, officeId: account.office.id, officeName: account.office.name, id: account.id, name: account.name || account.company.name })),
      ];
    }
    return NextResponse.json(buildOpsPortfolioReport({
      generatedAt: new Date().toISOString(),
      offices: officeData,
      ...(matches ? { matches } : {}),
    }));
  } catch {
    return NextResponse.json({ error: "Portfolio report unavailable." }, { status: 500 });
  }
}
