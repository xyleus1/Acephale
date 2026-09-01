import "server-only";

import { Prisma } from "@prisma/client";
import {
  campaignBlockers,
  campaignDefaultName,
  campaignRevisionHash,
  campaignRevisionMatches,
  campaignRowEligible,
  campaignSampleRecipients,
  renderCampaignEmail,
  type CampaignStatus,
} from "@/lib/outreach-campaign-copy";
import { listEmailSenderPoolAccounts } from "@/lib/email-sender-pool";
import { utcDayBounds } from "@/lib/email-sender-pool-policy";
import { prisma } from "@/lib/prisma";
import { validateResearchFields, type ResearchRecordData } from "@/lib/research-lists";

type CampaignFilters = {
  countries?: string[];
  segments?: string[];
  segmentField?: string;
};

type CampaignRecord = {
  id: string;
  status: string;
  data: ResearchRecordData;
  createdAt: Date;
};

type CampaignWithList = {
  id: string;
  officeId: string;
  name: string;
  listId: string;
  status: string;
  subject: string;
  bodyTemplate: string;
  emailField: string;
  companyField: string | null;
  countryField: string | null;
  rowStatuses: Prisma.JsonValue;
  filters: Prisma.JsonValue | null;
  senderAccountId: string | null;
  dailyCap: number;
  audienceTotal: number;
  audienceRecordIds: Prisma.JsonValue | null;
  revisionHash: string | null;
  approvedAt: Date | null;
  list: {
    id: string;
    slug: string;
    name: string;
    fields: Prisma.JsonValue;
  };
};

export type CampaignPlan = {
  list: { name: string; slug: string };
  eligible: number;
  alreadySent: number;
  remaining: number;
  missingEmail: number;
  filters: CampaignFilters;
  dailyCap: number;
  audienceTotal: number;
  revisionHash: string;
  mailboxesAvailable: number;
  emailField: string;
  sampleRecipients: Array<{
    id: string;
    email: string;
    company: string | null;
    country: string | null;
  }>;
  subject: string;
  sampleBody: string;
  senderEmail: string | null;
  blockers: string[];
};

export type PlanOutreachCampaignInput = {
  officeId: string;
  list: string;
  statuses?: string[];
  countries?: string[];
  segments?: string[];
  segmentField?: string;
  emailField?: string;
  countryField?: string;
  subject: string;
  bodyTemplate: string;
  dailyCap?: number;
  campaignName?: string;
  senderAccountId?: string | null;
  companyField?: string;
  createdByUserId?: string;
};

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function filtersFromJson(value: Prisma.JsonValue | null): CampaignFilters {
  const object = jsonObject(value);
  return {
    countries: Array.isArray(object.countries)
      ? object.countries.filter((item): item is string => typeof item === "string")
      : undefined,
    segments: Array.isArray(object.segments)
      ? object.segments.filter((item): item is string => typeof item === "string")
      : undefined,
    segmentField: typeof object.segmentField === "string" ? object.segmentField : undefined,
  };
}

function recordRow(record: CampaignRecord) {
  return { status: record.status, data: record.data };
}

function renderRow(
  data: ResearchRecordData,
  input: { emailField: string; companyField?: string | null; countryField?: string | null },
) {
  return {
    company: input.companyField ? data[input.companyField] : data.company,
    country: input.countryField ? data[input.countryField] : data.country,
    email: data[input.emailField],
  };
}

async function loadCampaign(officeId: string, campaignId: string): Promise<CampaignWithList> {
  const campaign = await prisma.outreachCampaign.findFirst({
    where: { id: campaignId, officeId },
    select: {
      id: true,
      officeId: true,
      name: true,
      listId: true,
      status: true,
      subject: true,
      bodyTemplate: true,
      emailField: true,
      companyField: true,
      countryField: true,
      rowStatuses: true,
      filters: true,
      senderAccountId: true,
      dailyCap: true,
      audienceTotal: true,
      audienceRecordIds: true,
      revisionHash: true,
      approvedAt: true,
      list: { select: { id: true, slug: true, name: true, fields: true } },
    },
  });
  if (!campaign) throw new Error("Outreach campaign not found.");
  return campaign;
}

async function eligibleRecords(campaign: CampaignWithList, useSnapshot = false) {
  validateResearchFields(campaign.list.fields);
  const statuses = jsonStrings(campaign.rowStatuses);
  const filters = filtersFromJson(campaign.filters);
  const audienceRecordIds = jsonStrings(campaign.audienceRecordIds);
  const records = await prisma.researchRecord.findMany({
    where: {
      officeId: campaign.officeId,
      listId: campaign.listId,
      ...(useSnapshot && audienceRecordIds.length ? { id: { in: audienceRecordIds } } : {}),
    },
    select: { id: true, status: true, data: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const selected = useSnapshot && audienceRecordIds.length
    ? records
    : records.filter((record) => campaignRowEligible({
    row: recordRow({
      ...record,
      data: record.data as ResearchRecordData,
    }),
    statuses,
    countries: filters.countries,
    segments: filters.segments,
    emailField: campaign.emailField,
    countryField: campaign.countryField ?? undefined,
    segmentField: filters.segmentField,
    }));
  return {
    filters,
    records: useSnapshot && audienceRecordIds.length
      ? audienceRecordIds.map((id) => selected.find((record) => record.id === id)).filter((record): record is typeof selected[number] => Boolean(record))
      : selected,
  };
}

async function senderDetails(senderAccountId: string | null) {
  const mailboxes = await listEmailSenderPoolAccounts();
  let email: string | null = null;
  if (senderAccountId) {
    const account = await prisma.emailAccount.findUnique({
      where: { id: senderAccountId },
      select: { email: true },
    });
    email = account?.email ?? null;
  }
  return { email, mailboxesAvailable: mailboxes.length };
}

export async function planOutreachCampaign(input: PlanOutreachCampaignInput): Promise<CampaignPlan> {
  const list = await prisma.researchList.findFirst({
    where: {
      officeId: input.officeId,
      OR: [{ slug: input.list }, { name: input.list }],
    },
    select: { id: true, slug: true, name: true, fields: true },
  });
  if (!list) throw new Error("Research list not found.");
  const fields = validateResearchFields(list.fields);
  const emailField = input.emailField ?? fields.find((field) => field.type === "email")?.key ?? "email";
  if (!fields.some((field) => field.key === emailField)) {
    throw new Error("Email field is not in the list definition.");
  }
  const records = await prisma.researchRecord.findMany({
    where: { officeId: input.officeId, listId: list.id },
    select: { id: true, status: true, data: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const statuses = input.statuses?.length ? input.statuses : ["new", "reviewed"];
  const filters = {
    countries: input.countries,
    segments: input.segments,
    segmentField: input.segmentField,
  };
  const eligible = records.filter((record) => campaignRowEligible({
    row: recordRow({ ...record, data: record.data as ResearchRecordData }),
    statuses,
    countries: input.countries,
    segments: input.segments,
    emailField,
    countryField: input.countryField,
    segmentField: input.segmentField,
  }));
  const missingEmail = records.filter((record) => {
    const data = record.data as Record<string, unknown>;
    return !String(data[emailField] ?? "").trim();
  }).length;
  const draft = await prisma.outreachCampaign.findFirst({
    where: { officeId: input.officeId, listId: list.id, status: "DRAFT" },
    select: { id: true },
  });
  const alreadySent = draft
    ? await prisma.outreachCampaignSend.count({
      where: { officeId: input.officeId, campaignId: draft.id, status: "SENT", recordId: { in: eligible.map((record) => record.id) } },
    })
    : 0;
  const subject = input.subject ?? "";
  const bodyTemplate = input.bodyTemplate ?? "";
  const sample = eligible[0]
    ? renderCampaignEmail({
      subject,
      bodyTemplate,
      row: renderRow(eligible[0].data as ResearchRecordData, {
        emailField,
        companyField: input.companyField,
        countryField: input.countryField,
      }),
    }).body.slice(0, 400)
    : "";
  const dailyCap = input.dailyCap ?? 40;
  const sender = await senderDetails(input.senderAccountId ?? null);
  const revisionHash = campaignRevisionHash({
    subject,
    bodyTemplate,
    emailField,
    rowStatuses: statuses,
    filters,
    dailyCap,
    senderAccountId: input.senderAccountId ?? null,
    audienceRecordIds: eligible.map((record) => record.id),
  });
  const sampleRecipients = campaignSampleRecipients({
    rows: eligible.map((record) => ({ id: record.id, data: record.data as Record<string, unknown> })),
    emailField,
    companyField: input.companyField,
    countryField: input.countryField,
  });
  return {
    list: { name: list.name, slug: list.slug },
    eligible: eligible.length,
    alreadySent,
    remaining: Math.max(0, eligible.length - alreadySent),
    missingEmail,
    audienceTotal: eligible.length,
    revisionHash,
    filters,
    dailyCap,
    subject: renderCampaignEmail({ subject, bodyTemplate, row: {} }).subject,
    sampleBody: sample,
    senderEmail: sender.email,
    mailboxesAvailable: sender.mailboxesAvailable,
    emailField,
    sampleRecipients,
    blockers: campaignBlockers({
      eligible: eligible.length,
      mailboxesAvailable: sender.mailboxesAvailable,
      senderPinned: Boolean(input.senderAccountId),
      subject,
      bodyTemplate,
      dailyCap,
    }),
  };
}

export async function saveDraftCampaign(input: PlanOutreachCampaignInput & {
  listId?: string;
}) {
  const list = await prisma.researchList.findFirst({
    where: {
      officeId: input.officeId,
      ...(input.listId ? { id: input.listId } : { OR: [{ slug: input.list }, { name: input.list }] }),
    },
    select: { id: true, fields: true },
  });
  if (!list) throw new Error("Research list not found.");
  const fields = validateResearchFields(list.fields);
  const emailField = input.emailField ?? fields.find((field) => field.type === "email")?.key ?? "email";
  if (!fields.some((field) => field.key === emailField)) throw new Error("Email field is not in the list definition.");
  const existing = await prisma.outreachCampaign.findFirst({
    where: { officeId: input.officeId, listId: list.id, status: "DRAFT" },
    select: { id: true },
  });
  let name = input.campaignName?.trim() || `Outreach: ${input.list}`;
  if (!input.campaignName?.trim() && !existing) {
    const taken = await prisma.outreachCampaign.findMany({
      where: { officeId: input.officeId, name: { startsWith: name } },
      select: { name: true },
    });
    const takenNames = new Set(taken.map((campaign) => campaign.name));
    name = campaignDefaultName(name, takenNames);
  }
  const records = await prisma.researchRecord.findMany({
    where: { officeId: input.officeId, listId: list.id },
    select: { id: true, status: true, data: true, createdAt: true },
  });
  const filters = {
    countries: input.countries,
    segments: input.segments,
    segmentField: input.segmentField,
  };
  const audienceRecordIds = records.filter((record) => campaignRowEligible({
    row: recordRow({ ...record, data: record.data as ResearchRecordData }),
    statuses: input.statuses?.length ? input.statuses : ["new", "reviewed"],
    countries: input.countries,
    segments: input.segments,
    emailField,
    countryField: input.countryField,
    segmentField: input.segmentField,
  })).map((record) => record.id);
  const audienceTotal = audienceRecordIds.length;
  const revisionHash = campaignRevisionHash({
    subject: input.subject,
    bodyTemplate: input.bodyTemplate,
    emailField,
    rowStatuses: input.statuses?.length ? input.statuses : ["new", "reviewed"],
    filters,
    dailyCap: input.dailyCap ?? 40,
    senderAccountId: input.senderAccountId ?? null,
    audienceRecordIds,
  });
  const data = {
    name,
    subject: input.subject,
    bodyTemplate: input.bodyTemplate,
    emailField,
    companyField: input.companyField ?? null,
    countryField: input.countryField ?? null,
    rowStatuses: (input.statuses?.length ? input.statuses : ["new", "reviewed"]) as Prisma.InputJsonValue,
    filters: filters as Prisma.InputJsonValue,
    audienceTotal,
    audienceRecordIds: audienceRecordIds as Prisma.InputJsonValue,
    revisionHash,
    dailyCap: input.dailyCap ?? 40,
    senderAccountId: input.senderAccountId ?? null,
    createdByUserId: input.createdByUserId ?? null,
  };
  const campaign = existing
    ? await prisma.outreachCampaign.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.outreachCampaign.create({
      data: { officeId: input.officeId, listId: list.id, ...data },
      select: { id: true },
    });
  return { id: campaign.id, revisionHash };
}

export async function activateCampaign(input: { officeId: string; campaignId: string; userId: string | null; expectedRevisionHash?: string }) {
  const campaign = await loadCampaign(input.officeId, input.campaignId);
  const { records, filters } = await eligibleRecords(campaign);
  const currentRevisionHash = campaignRevisionHash({
    subject: campaign.subject,
    bodyTemplate: campaign.bodyTemplate,
    emailField: campaign.emailField,
    rowStatuses: jsonStrings(campaign.rowStatuses),
    filters,
    dailyCap: campaign.dailyCap,
    senderAccountId: campaign.senderAccountId,
    audienceRecordIds: records.map((record) => record.id),
  });
  if (
    !campaignRevisionMatches(input.expectedRevisionHash, campaign.revisionHash)
    || currentRevisionHash !== campaign.revisionHash
  ) {
    return { activated: false, blockers: ["This campaign changed after it was proposed. Plan it again."] };
  }
  const sender = await senderDetails(campaign.senderAccountId);
  const blockers = campaignBlockers({
    eligible: records.length,
    mailboxesAvailable: sender.mailboxesAvailable,
    senderPinned: Boolean(campaign.senderAccountId),
    subject: campaign.subject,
    bodyTemplate: campaign.bodyTemplate,
    dailyCap: campaign.dailyCap,
  });
  if (blockers.length) return { activated: false, blockers };
  const updated = await prisma.outreachCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "ACTIVE",
      approvedByUserId: input.userId,
      approvedAt: campaign.approvedAt ?? new Date(),
      startedAt: campaign.approvedAt ? undefined : new Date(),
      audienceTotal: records.length,
      audienceRecordIds: records.map((record) => record.id) as Prisma.InputJsonValue,
    },
    select: { id: true, status: true },
  });
  return { activated: true, blockers: [], campaign: updated };
}

export async function pauseCampaign(input: { officeId: string; campaignId: string }) {
  return prisma.outreachCampaign.updateMany({
    where: { id: input.campaignId, officeId: input.officeId, status: "ACTIVE" },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}

export async function resumeCampaign(input: { officeId: string; campaignId: string }) {
  return prisma.outreachCampaign.updateMany({
    where: { id: input.campaignId, officeId: input.officeId, status: "PAUSED", approvedAt: { not: null } },
    data: { status: "ACTIVE", pausedAt: null },
  });
}

export async function cancelCampaign(input: { officeId: string; campaignId: string }) {
  return prisma.outreachCampaign.updateMany({
    where: { id: input.campaignId, officeId: input.officeId, status: { in: ["DRAFT", "ACTIVE", "PAUSED"] } },
    data: { status: "CANCELLED" },
  });
}

export type CampaignSummary = {
  id: string;
  name: string;
  status: CampaignStatus;
  list: { name: string; slug: string };
  total: number;
  sent: number;
  sentToday: number;
  rejected: number;
  unknown: number;
  replies: number;
  dailyCap: number;
  senderEmail: string | null;
  lastRunAt: Date | null;
};

export async function listCampaignSummaries(
  officeId: string,
  statuses: readonly CampaignStatus[] = ["ACTIVE", "PAUSED"],
): Promise<CampaignSummary[]> {
  try {
    const campaigns = await prisma.outreachCampaign.findMany({
      where: { officeId, status: { in: [...statuses] } },
      select: {
        id: true,
        name: true,
        status: true,
        audienceTotal: true,
        dailyCap: true,
        senderAccountId: true,
        lastRunAt: true,
        list: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (campaigns.length === 0) return [];
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const sends = await prisma.outreachCampaignSend.groupBy({
      by: ["campaignId", "status"],
      where: { officeId, campaignId: { in: campaignIds } },
      _count: { _all: true },
    });
    const { start, end } = utcDayBounds(new Date());
    const sentToday = await prisma.outreachCampaignSend.groupBy({
      by: ["campaignId"],
      where: { officeId, campaignId: { in: campaignIds }, status: "SENT", sentAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    const localThreads = await prisma.outreachCampaignSend.findMany({
      where: { officeId, campaignId: { in: campaignIds }, status: "SENT", localThreadId: { not: null } },
      select: { campaignId: true, localThreadId: true },
    });
    const threadToCampaign = new Map(localThreads.map((row) => [row.localThreadId as string, row.campaignId]));
    const replies = threadToCampaign.size
      ? await prisma.emailMessage.groupBy({
        by: ["threadId"],
        where: { officeId, direction: "INBOUND", threadId: { in: [...threadToCampaign.keys()] } },
        _count: { _all: true },
      })
      : [];
    const mailboxes = await listEmailSenderPoolAccounts();
    const senderEmails = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox.email]));
    return campaigns.map((campaign) => {
      const counts = new Map(sends.filter((row) => row.campaignId === campaign.id).map((row) => [row.status, row._count._all]));
      const replyCount = replies
        .filter((row) => threadToCampaign.get(row.threadId) === campaign.id)
        .reduce((sum, row) => sum + row._count._all, 0);
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status as CampaignStatus,
        list: campaign.list,
        total: campaign.audienceTotal,
        sent: counts.get("SENT") ?? 0,
        sentToday: sentToday.find((row) => row.campaignId === campaign.id)?._count._all ?? 0,
        rejected: counts.get("REJECTED") ?? 0,
        unknown: counts.get("UNKNOWN") ?? 0,
        replies: replyCount,
        dailyCap: campaign.dailyCap,
        senderEmail: campaign.senderAccountId ? senderEmails.get(campaign.senderAccountId) ?? null : null,
        lastRunAt: campaign.lastRunAt,
      };
    });
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
    if (code === "P2021" || code === "P2022") {
      console.error("Outreach campaign summary unavailable: campaign schema is not ready.");
      return [];
    }
    throw error;
  }
}

export async function completeCampaignIfDone(input: { officeId: string; campaignId: string }) {
  const campaign = await loadCampaign(input.officeId, input.campaignId);
  if (campaign.status !== "ACTIVE") return { completed: false };
  const { records } = await eligibleRecords(campaign, true);
  const attemptedIds = new Set((await prisma.outreachCampaignSend.findMany({
    where: { officeId: input.officeId, campaignId: input.campaignId },
    select: { recordId: true },
  })).map((row) => row.recordId));
  const unsentEligible = records.filter((record) => !attemptedIds.has(record.id));
  if (unsentEligible.length > 0) return { completed: false };
  await prisma.outreachCampaign.updateMany({
    where: { id: input.campaignId, officeId: input.officeId, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return { completed: true };
}
