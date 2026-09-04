import "server-only";

import { Prisma } from "@prisma/client";
import { GMAIL_APP_PASSWORD_PROVIDER } from "@/lib/gmail-app-password";
import {
  spotCheckSample,
  summarizeRecipientQuality,
  type RecipientQualitySummary,
} from "@/lib/batch-review";
import {
  asciiCampaignSenderDisplayName,
  campaignBlockers,
  campaignStatusBlocker,
  campaignEmailFieldKey,
  campaignDefaultName,
  campaignFollowUpBlockers,
  normalizeCampaignFollowUps,
  type CampaignFollowUpStep,
  campaignPersonalization,
  campaignActivationTransitionWhere,
  excludeContactedRecipients,
  campaignPersonalizationMap,
  campaignRevisionHash,
  campaignRevisionMatches,
  campaignRowEligible,
  campaignSampleRecipients,
  campaignSendCountsAsAttempt,
  campaignSnapshotOutstandingRecordIds,
  dedupeRecipients,
  campaignReplyCounts,
  humanReplyMessageFilter,
  isHumanReplyMessage,
  outreachCampaignContactedWhere,
  normalizeResearchListQuery,
  normalizeCampaignExcludeEmails,
  normalizeCampaignSenderDisplayName,
  normalizeCampaignVariants,
  renderCampaignEmail,
  selectCampaignVariant,
  storedCampaignVariants,
  type CampaignVariant,
  type CampaignStatus,
} from "@/lib/outreach-campaign-copy";
import { listEmailSenderPoolAccounts } from "@/lib/email-sender-pool";
import { listSuppressedEmails } from "@/lib/email-delivery-events";
import { utcDayBounds } from "@/lib/email-sender-pool-policy";
import {
  outstandingCampaignFollowUps,
  unresolvedOutreachCampaignDeliveries,
} from "@/lib/outreach-campaign-follow-ups";
import { prisma } from "@/lib/prisma";
import { validateResearchFields, type ResearchRecordData } from "@/lib/research-lists";

type CampaignFilters = {
  countries?: string[];
  segments?: string[];
  segmentField?: string;
  excludeEmails?: string[];
};

export type CampaignSpotCheckItem = {
  id: string;
  email: string;
  company: string | null;
  country: string | null;
  position: number;
  pick: "head" | "spot";
  subject: string;
  body: string;
};

type CampaignRecord = {
  id: string;
  status: string;
  data: ResearchRecordData;
  createdAt: Date;
};

type ResearchListForCampaign = {
  id: string;
  slug: string;
  name: string;
  fields: Prisma.JsonValue;
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
  senderDisplayName: string | null;
  senderRotation: boolean;
  variants: Prisma.JsonValue | null;
  dailyCap: number;
  audienceTotal: number;
  audienceRecordIds: Prisma.JsonValue | null;
  audiencePersonalization: Prisma.JsonValue | null;
  followUps: Prisma.JsonValue | null;
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
  renderedBody: string;
  senderEmail: string | null;
  senderDisplayName: string | null;
  followUps: CampaignFollowUpStep[];
  // Bounded review evidence for the whole audience: a seeded spread of
  // rendered emails plus deterministic quality counts. Approving the proposal
  // approves every eligible row, not only the rows shown.
  spotCheck: CampaignSpotCheckItem[];
  audienceQuality: RecipientQualitySummary;
  // Campaign id the spot check variants were selected for. Variant assignment
  // is keyed by campaign id, so a plan made before the draft existed must be
  // re-rendered against the saved draft id when variants are in play.
  spotCheckCampaignId: string | null;
  senderRotation: boolean;
  poolCapacityToday: number;
  alreadyContactedElsewhere: number;
  variants: CampaignVariant[] | null;
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
  senderDisplayName?: string | null;
  senderRotation?: boolean;
  variants?: readonly CampaignVariant[] | null;
  companyField?: string;
  createdByUserId?: string;
  followUps?: unknown;
  excludeEmails?: unknown;
  campaignId?: string;
};

function campaignFilters(input: {
  countries?: string[];
  segments?: string[];
  segmentField?: string;
  excludeEmails?: unknown;
}): CampaignFilters {
  const excludeEmails = normalizeCampaignExcludeEmails(input.excludeEmails);
  return {
    countries: input.countries,
    segments: input.segments,
    segmentField: input.segmentField,
    ...(excludeEmails.length ? { excludeEmails } : {}),
  };
}

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
    ...(Array.isArray(object.excludeEmails) && object.excludeEmails.length
      ? { excludeEmails: normalizeCampaignExcludeEmails(object.excludeEmails) }
      : {}),
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

async function resolveResearchList(officeId: string, query: string): Promise<ResearchListForCampaign> {
  const normalizedQuery = normalizeResearchListQuery(query);
  const exactSlug = await prisma.researchList.findFirst({
    where: { officeId, slug: normalizedQuery },
    select: { id: true, slug: true, name: true, fields: true },
  });
  if (exactSlug) return exactSlug;

  const exactNameMatches = await prisma.researchList.findMany({
    where: { officeId, name: normalizedQuery },
    select: { id: true, slug: true, name: true, fields: true },
    take: 2,
  });
  if (exactNameMatches.length > 1) {
    throw new Error("Research list query is ambiguous. Use an exact slug.");
  }
  if (exactNameMatches[0]) return exactNameMatches[0];

  const insensitiveSlugMatches = await prisma.researchList.findMany({
    where: { officeId, slug: { equals: normalizedQuery, mode: "insensitive" } },
    select: { id: true, slug: true, name: true, fields: true },
    take: 2,
  });
  if (insensitiveSlugMatches.length > 1) {
    throw new Error("Research list query is ambiguous. Use an exact slug.");
  }
  if (insensitiveSlugMatches[0]) return insensitiveSlugMatches[0];

  const insensitiveNameMatches = await prisma.researchList.findMany({
    where: { officeId, name: { equals: normalizedQuery, mode: "insensitive" } },
    select: { id: true, slug: true, name: true, fields: true },
    take: 2,
  });
  if (insensitiveNameMatches.length > 1) {
    throw new Error("Research list query is ambiguous. Use an exact slug.");
  }
  if (insensitiveNameMatches[0]) return insensitiveNameMatches[0];

  const availableLists = await prisma.researchList.findMany({
    where: { officeId },
    select: { slug: true },
    orderBy: { slug: "asc" },
    take: 10,
  });
  const availableSlugs = availableLists.map((list) => list.slug).join(", ");
  throw new Error(`Research list not found. Available lists: ${availableSlugs || "none"}`);
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
      senderDisplayName: true,
      senderRotation: true,
      variants: true,
      dailyCap: true,
      audienceTotal: true,
      audienceRecordIds: true,
      audiencePersonalization: true,
      followUps: true,
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
    excludeEmails: filters.excludeEmails,
    }));
  return {
    filters,
    records: useSnapshot && audienceRecordIds.length
      ? audienceRecordIds
        .map((id) => selected.find((record) => record.id === id))
        .filter((record): record is typeof selected[number] => Boolean(record))
      : selected,
  };
}

async function senderDetails(senderAccountId: string | null, requestedDisplayName: string | null) {
  const mailboxes = await listEmailSenderPoolAccounts();
  let email: string | null = null;
  let mailboxDisplayName: string | null = null;
  let provider: string | null = null;
  if (senderAccountId) {
    const account = await prisma.emailAccount.findUnique({
      where: { id: senderAccountId },
      select: { email: true, displayName: true, provider: true },
    });
    email = account?.email ?? null;
    mailboxDisplayName = account?.displayName ?? null;
    provider = account?.provider ?? null;
  }
  const requested = normalizeCampaignSenderDisplayName(requestedDisplayName);
  const isAppPassword = provider === GMAIL_APP_PASSWORD_PROVIDER;
  const candidate = requested ?? (isAppPassword ? normalizeCampaignSenderDisplayName(mailboxDisplayName) : null);
  const displayName = isAppPassword ? candidate : asciiCampaignSenderDisplayName(candidate);
  return {
    email,
    displayName,
    mailboxesAvailable: mailboxes.length,
    poolCapacityToday: mailboxes.reduce(
      (total, mailbox) => total + Math.max(0, mailbox.dailySendLimit - mailbox.sentToday - mailbox.reservedToday),
      0,
    ),
  };
}

export async function planOutreachCampaign(input: PlanOutreachCampaignInput): Promise<CampaignPlan> {
  if (input.senderRotation === true && input.senderAccountId) {
    throw new Error("Pick either a sender mailbox or rotation, not both.");
  }
  const list = await resolveResearchList(input.officeId, input.list);
  const fields = validateResearchFields(list.fields);
  const emailField = campaignEmailFieldKey(fields, input.emailField);
  const variants = normalizeCampaignVariants(input.variants);
  const campaignSubject = variants?.[0]?.subject ?? input.subject;
  const campaignBodyTemplate = variants?.[0]?.bodyTemplate ?? input.bodyTemplate;
  if (!fields.some((field) => field.key === emailField)) {
    throw new Error("Email field is not in the list definition.");
  }
  const records = await prisma.researchRecord.findMany({
    where: { officeId: input.officeId, listId: list.id },
    select: { id: true, status: true, data: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const statuses = input.statuses?.length ? input.statuses : ["new", "reviewed"];
  const filters = campaignFilters(input);
  const eligible = dedupeRecipients({
    rows: records.filter((record) => campaignRowEligible({
      row: recordRow({ ...record, data: record.data as ResearchRecordData }),
      statuses,
      countries: input.countries,
      segments: input.segments,
      emailField,
      countryField: input.countryField,
      segmentField: input.segmentField,
      excludeEmails: filters.excludeEmails,
    })),
    recipientOf: (record) => String((record.data as Record<string, unknown>)[emailField] ?? ""),
  });
  const draft = await prisma.outreachCampaign.findFirst({
    where: { officeId: input.officeId, listId: list.id, status: "DRAFT" },
    select: { id: true },
  });
  const now = new Date();
  const contactedElsewhere = await prisma.outreachCampaignSend.findMany({
    where: outreachCampaignContactedWhere({
      officeId: input.officeId,
      campaignId: draft?.id,
      now,
    }),
    select: { recipient: true },
  });
  const eligibleWithoutContacted = excludeContactedRecipients({
    rows: eligible,
    recipientOf: (record) => String((record.data as Record<string, unknown>)[emailField] ?? ""),
    contacted: new Set(contactedElsewhere.map((send) => send.recipient.trim().toLowerCase())),
  });
  const alreadyContactedElsewhere = eligible.length - eligibleWithoutContacted.length;
  const missingEmail = records.filter((record) => {
    const data = record.data as Record<string, unknown>;
    return !String(data[emailField] ?? "").trim();
  }).length;
  const alreadySent = draft
    ? await prisma.outreachCampaignSend.count({
      where: {
        officeId: input.officeId,
        campaignId: draft.id,
        status: "SENT",
        recordId: { in: eligibleWithoutContacted.map((record) => record.id) },
      },
    })
    : 0;
  const previewRow = eligibleWithoutContacted[0] ? renderRow(eligibleWithoutContacted[0].data as ResearchRecordData, {
    emailField,
    companyField: input.companyField,
    countryField: input.countryField,
  }) : {};
  const renderedSample = renderCampaignEmail({
    subject: campaignSubject,
    bodyTemplate: campaignBodyTemplate,
    row: previewRow,
  });
  const sample = eligibleWithoutContacted[0] ? renderedSample.body.slice(0, 400) : "";
  const dailyCap = input.dailyCap ?? 40;
  const senderDisplayName = normalizeCampaignSenderDisplayName(input.senderDisplayName);
  const followUps = normalizeCampaignFollowUps(input.followUps);
  const sender = await senderDetails(input.senderRotation ? null : input.senderAccountId ?? null, senderDisplayName);
  const revisionHash = campaignRevisionHash({
    subject: campaignSubject,
    bodyTemplate: campaignBodyTemplate,
    emailField,
    rowStatuses: statuses,
    filters,
    dailyCap,
    senderAccountId: input.senderRotation ? null : input.senderAccountId ?? null,
    senderRotation: input.senderRotation === true,
    senderDisplayName,
    variants,
    audienceRecordIds: eligibleWithoutContacted.map((record) => record.id),
    audiencePersonalization: campaignPersonalizationMap({
      rows: eligibleWithoutContacted.map((record) => ({ id: record.id, data: record.data as Record<string, unknown> })),
      emailField,
      companyField: input.companyField,
      countryField: input.countryField,
    }),
    followUps,
  });
  const eligibleRows = eligibleWithoutContacted.map((record) => ({ id: record.id, data: record.data as Record<string, unknown> }));
  const sampleRecipients = campaignSampleRecipients({
    rows: eligibleRows,
    emailField,
    companyField: input.companyField,
    countryField: input.countryField,
  });
  const recipientOf = (row: { id: string; data: Record<string, unknown> }) => ({
    id: row.id,
    ...campaignPersonalization({
      data: row.data,
      emailField,
      companyField: input.companyField,
      countryField: input.countryField,
    }),
  });
  const spotCheckCampaignId = input.campaignId ?? draft?.id ?? null;
  const spotCheck = spotCheckSample(eligibleRows, { seed: revisionHash }).map((pick) => {
    const recipient = recipientOf(pick.item);
    const variant = spotCheckCampaignId && variants
      ? selectCampaignVariant({ campaignId: spotCheckCampaignId, recordId: pick.item.id, variants })
      : null;
    const rendered = renderCampaignEmail({
      subject: variant?.subject ?? campaignSubject,
      bodyTemplate: variant?.bodyTemplate ?? campaignBodyTemplate,
      row: renderRow(pick.item.data as ResearchRecordData, {
        emailField,
        companyField: input.companyField,
        countryField: input.countryField,
      }),
    });
    return { ...recipient, position: pick.position, pick: pick.pick, subject: rendered.subject, body: rendered.body };
  });
  const audienceQuality = summarizeRecipientQuality(eligibleRows.map(recipientOf));
  return {
    list: { name: list.name, slug: list.slug },
    eligible: eligibleWithoutContacted.length,
    alreadySent,
    remaining: Math.max(0, eligibleWithoutContacted.length - alreadySent),
    missingEmail,
    audienceTotal: eligibleWithoutContacted.length,
    revisionHash,
    filters,
    dailyCap,
    subject: eligibleWithoutContacted[0] ? renderedSample.subject : campaignSubject,
    sampleBody: sample,
    renderedBody: renderedSample.body,
    senderEmail: sender.email,
    senderDisplayName: sender.displayName,
    senderRotation: input.senderRotation === true,
    poolCapacityToday: sender.poolCapacityToday,
    alreadyContactedElsewhere,
    variants,
    mailboxesAvailable: sender.mailboxesAvailable,
    emailField,
    sampleRecipients,
    followUps,
    spotCheck,
    audienceQuality,
    spotCheckCampaignId,
    blockers: [
      ...campaignBlockers({
        eligible: eligibleWithoutContacted.length,
        mailboxesAvailable: sender.mailboxesAvailable,
        poolCapacityToday: sender.poolCapacityToday,
        senderPinned: Boolean(input.senderAccountId),
        senderRotation: input.senderRotation === true,
        subject: campaignSubject,
        bodyTemplate: campaignBodyTemplate,
        dailyCap,
        variants,
      }),
      ...campaignFollowUpBlockers(followUps),
    ],
  };
}

export async function saveDraftCampaign(input: PlanOutreachCampaignInput & {
  listId?: string;
}) {
  if (input.senderRotation === true && input.senderAccountId) {
    throw new Error("Pick either a sender mailbox or rotation, not both.");
  }
  const variants = normalizeCampaignVariants(input.variants);
  const campaignSubject = variants?.[0]?.subject ?? input.subject;
  const campaignBodyTemplate = variants?.[0]?.bodyTemplate ?? input.bodyTemplate;
  const list = input.listId
    ? await prisma.researchList.findFirst({
        where: { officeId: input.officeId, id: input.listId },
        select: { id: true, slug: true, name: true, fields: true },
      })
    : await resolveResearchList(input.officeId, input.list);
  if (!list) throw new Error("Research list not found.");
  const fields = validateResearchFields(list.fields);
  const emailField = campaignEmailFieldKey(fields, input.emailField);
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const filters = campaignFilters(input);
  const eligibleRecords = dedupeRecipients({
    rows: records.filter((record) => campaignRowEligible({
      row: recordRow({ ...record, data: record.data as ResearchRecordData }),
      statuses: input.statuses?.length ? input.statuses : ["new", "reviewed"],
      countries: input.countries,
      segments: input.segments,
      emailField,
      countryField: input.countryField,
      segmentField: input.segmentField,
      excludeEmails: filters.excludeEmails,
    })),
    recipientOf: (record) => String((record.data as Record<string, unknown>)[emailField] ?? ""),
  });
  const now = new Date();
  const contactedElsewhere = await prisma.outreachCampaignSend.findMany({
    where: outreachCampaignContactedWhere({
      officeId: input.officeId,
      campaignId: existing?.id,
      now,
    }),
    select: { recipient: true },
  });
  const audienceRecordIds = excludeContactedRecipients({
    rows: eligibleRecords,
    recipientOf: (record) => String((record.data as Record<string, unknown>)[emailField] ?? ""),
    contacted: new Set(contactedElsewhere.map((send) => send.recipient.trim().toLowerCase())),
  }).map((record) => record.id);
  const audiencePersonalization = campaignPersonalizationMap({
    rows: records
      .filter((record) => audienceRecordIds.includes(record.id))
      .map((record) => ({ id: record.id, data: record.data as Record<string, unknown> })),
    emailField,
    companyField: input.companyField,
    countryField: input.countryField,
  });
  const audienceTotal = audienceRecordIds.length;
  const followUps = normalizeCampaignFollowUps(input.followUps);
  const revisionHash = campaignRevisionHash({
    subject: campaignSubject,
    bodyTemplate: campaignBodyTemplate,
    emailField,
    rowStatuses: input.statuses?.length ? input.statuses : ["new", "reviewed"],
    filters,
    dailyCap: input.dailyCap ?? 40,
    senderAccountId: input.senderRotation ? null : input.senderAccountId ?? null,
    senderRotation: input.senderRotation === true,
    senderDisplayName: normalizeCampaignSenderDisplayName(input.senderDisplayName),
    variants,
    audienceRecordIds,
    audiencePersonalization,
    followUps,
  });
  const data = {
    name,
    subject: campaignSubject,
    bodyTemplate: campaignBodyTemplate,
    emailField,
    companyField: input.companyField ?? null,
    countryField: input.countryField ?? null,
    rowStatuses: (input.statuses?.length ? input.statuses : ["new", "reviewed"]) as Prisma.InputJsonValue,
    filters: filters as Prisma.InputJsonValue,
    audienceTotal,
    audienceRecordIds: audienceRecordIds as Prisma.InputJsonValue,
    audiencePersonalization: audiencePersonalization as Prisma.InputJsonValue,
    followUps: followUps.length ? (followUps as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    revisionHash,
    dailyCap: input.dailyCap ?? 40,
    senderAccountId: input.senderRotation ? null : input.senderAccountId ?? null,
    senderDisplayName: normalizeCampaignSenderDisplayName(input.senderDisplayName),
    senderRotation: input.senderRotation === true,
    variants: variants ? variants as Prisma.InputJsonValue : Prisma.DbNull,
    createdByUserId: input.createdByUserId ?? null,
  };
  let campaign = existing
    ? await prisma.outreachCampaign.updateMany({
      where: { id: existing.id, officeId: input.officeId, status: "DRAFT" },
      data,
    }).then((result) => result.count > 0 ? { id: existing.id } : null)
    : null;
  if (!campaign) {
    const taken = await prisma.outreachCampaign.findMany({
      where: { officeId: input.officeId, name: { startsWith: name } },
      select: { name: true },
    });
    name = campaignDefaultName(name, new Set(taken.map((item) => item.name)));
    campaign = await prisma.outreachCampaign.create({
      data: { officeId: input.officeId, listId: list.id, ...data, name },
      select: { id: true },
    });
  }
  return { id: campaign.id, revisionHash };
}

export const CAMPAIGN_CLAIM_LOST_BLOCKER =
  "This approval was no longer the active claim on the proposal when the campaign was about to start. Nothing changed.";

class ClaimLostError extends Error {}

/**
 * Starts a DRAFT campaign. When `finalize` is given it runs in the same transaction as the
 * DRAFT to ACTIVE write and must confirm the caller still owns the approval (returning false
 * rolls the activation back), so a released or expired claim can never start a campaign.
 */
export async function activateCampaign(input: {
  officeId: string;
  campaignId: string;
  userId: string | null;
  expectedRevisionHash?: string;
  finalize?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}) {
  const campaign = await loadCampaign(input.officeId, input.campaignId);
  const statusBlocker = campaignStatusBlocker(campaign.status);
  if (statusBlocker) return { activated: false, blockers: [statusBlocker] };
  // Activate from the approved snapshot: recomputing would rerun office-wide dedupe
  // and spuriously invalidate the approved revision. Send-time status checks and
  // personalization in the revision hash still protect delivery.
  const { records, filters } = await eligibleRecords(campaign, true);
  const variants = normalizeCampaignVariants(campaign.variants);
  const audiencePersonalization = campaignPersonalizationMap({
    rows: records.map((record) => ({ id: record.id, data: record.data as Record<string, unknown> })),
    emailField: campaign.emailField,
    companyField: campaign.companyField ?? undefined,
    countryField: campaign.countryField ?? undefined,
  });
  const followUps = normalizeCampaignFollowUps(campaign.followUps);
  const currentRevisionHash = campaignRevisionHash({
    subject: campaign.subject,
    bodyTemplate: campaign.bodyTemplate,
    emailField: campaign.emailField,
    rowStatuses: jsonStrings(campaign.rowStatuses),
    filters,
    dailyCap: campaign.dailyCap,
    senderAccountId: campaign.senderAccountId,
    senderRotation: campaign.senderRotation,
    senderDisplayName: campaign.senderDisplayName,
    variants,
    audienceRecordIds: records.map((record) => record.id),
    audiencePersonalization,
    followUps,
  });
  if (
    !campaignRevisionMatches(input.expectedRevisionHash, campaign.revisionHash)
    || currentRevisionHash !== campaign.revisionHash
  ) {
    return { activated: false, blockers: ["This campaign changed after it was proposed. Plan it again."] };
  }
  const sender = await senderDetails(
    campaign.senderRotation ? null : campaign.senderAccountId,
    campaign.senderDisplayName,
  );
  const blockers = [
    ...campaignBlockers({
      eligible: records.length,
      mailboxesAvailable: sender.mailboxesAvailable,
      poolCapacityToday: sender.poolCapacityToday,
      senderPinned: Boolean(campaign.senderAccountId),
      senderRotation: campaign.senderRotation,
      subject: campaign.subject,
      bodyTemplate: campaign.bodyTemplate,
      dailyCap: campaign.dailyCap,
      variants,
    }),
    ...campaignFollowUpBlockers(followUps),
  ];
  if (blockers.length) return { activated: false, blockers };
  const now = new Date();
  let updated: { count: number };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const written = await tx.outreachCampaign.updateMany({
        where: campaignActivationTransitionWhere({
          officeId: input.officeId,
          campaignId: campaign.id,
          revisionHash: campaign.revisionHash,
        }),
        data: {
          status: "ACTIVE",
          approvedByUserId: input.userId,
          approvedAt: now,
          startedAt: now,
          audienceTotal: records.length,
          audienceRecordIds: records.map((record) => record.id) as Prisma.InputJsonValue,
          audiencePersonalization: audiencePersonalization as Prisma.InputJsonValue,
        },
      });
      if (written.count > 0 && input.finalize && !(await input.finalize(tx))) throw new ClaimLostError();
      return written;
    });
  } catch (error) {
    if (error instanceof ClaimLostError) return { activated: false, blockers: [CAMPAIGN_CLAIM_LOST_BLOCKER] };
    throw error;
  }
  if (updated.count === 0) {
    const current = await prisma.outreachCampaign.findFirst({ where: { id: campaign.id, officeId: input.officeId }, select: { status: true } });
    const blocker = current ? campaignStatusBlocker(current.status) : "This campaign no longer exists. Plan a new campaign.";
    return { activated: false, blockers: [blocker ?? "This campaign changed after it was proposed. Plan it again."] };
  }
  return { activated: true, blockers: [], campaign: { id: campaign.id, status: "ACTIVE" } };
}

export async function setCampaignFollowUps(input: {
  officeId: string;
  campaignId: string;
  followUps: readonly CampaignFollowUpStep[];
  approvedByUserId: string;
}) {
  if (!input.followUps.length) throw new Error("At least one follow-up step is required.");
  const followUps = normalizeCampaignFollowUps(input.followUps);
  if (followUps.length !== input.followUps.length) {
    throw new Error("Every follow-up step must have an integer waitDays and a body.");
  }
  const blockers = campaignFollowUpBlockers(followUps);
  if (blockers.length) throw new Error(blockers[0]);
  const campaign = await loadCampaign(input.officeId, input.campaignId);
  const { records, filters } = await eligibleRecords(campaign, true);
  const variants = normalizeCampaignVariants(campaign.variants);
  const audiencePersonalization = campaignPersonalizationMap({
    rows: records.map((record) => ({ id: record.id, data: record.data as Record<string, unknown> })),
    emailField: campaign.emailField,
    companyField: campaign.companyField ?? undefined,
    countryField: campaign.countryField ?? undefined,
  });
  const revisionHash = campaignRevisionHash({
    subject: campaign.subject,
    bodyTemplate: campaign.bodyTemplate,
    emailField: campaign.emailField,
    rowStatuses: jsonStrings(campaign.rowStatuses),
    filters,
    dailyCap: campaign.dailyCap,
    senderAccountId: campaign.senderAccountId,
    senderRotation: campaign.senderRotation,
    senderDisplayName: campaign.senderDisplayName,
    variants,
    audienceRecordIds: records.map((record) => record.id),
    audiencePersonalization,
    followUps,
  });
  const update = () => prisma.$transaction(async (tx) => {
    const existingFollowUp = await tx.outreachCampaignFollowUp.findFirst({
      where: { officeId: input.officeId, campaignId: input.campaignId },
      select: { id: true },
    });
    if (existingFollowUp) {
      return {
        updated: false as const,
        reason: "FOLLOW_UPS_ALREADY_IN_FLIGHT" as const,
        revisionHash: null,
      };
    }
    const updated = await tx.outreachCampaign.updateMany({
      where: {
        id: input.campaignId,
        officeId: input.officeId,
        status: { in: ["DRAFT", "ACTIVE", "PAUSED"] },
      },
      data: {
        followUps: followUps as Prisma.InputJsonValue,
        revisionHash,
      },
    });
    return updated.count > 0
      ? { updated: true as const, revisionHash }
      : { updated: false as const, reason: "CAMPAIGN_NOT_EDITABLE" as const, revisionHash: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await update();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
      if (attempt === 1) {
        return { updated: false as const, reason: "TRANSACTION_CONFLICT" as const, revisionHash: null };
      }
    }
  }
  return { updated: false as const, reason: "TRANSACTION_CONFLICT" as const, revisionHash: null };
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
  return prisma.$transaction(async (tx) => {
    const updated = await tx.outreachCampaign.updateMany({
      where: { id: input.campaignId, officeId: input.officeId, status: { in: ["DRAFT", "ACTIVE", "PAUSED"] } },
      data: { status: "CANCELLED" },
    });
    if (updated.count > 0) {
      await tx.outreachCampaignSend.deleteMany({
        where: {
          officeId: input.officeId,
          campaignId: input.campaignId,
          status: "QUEUED",
          reservationId: null,
        },
      });
    }
    return updated;
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
  followUpSteps: number;
  followUpsSent: number;
  followUpsSkipped: number;
  dailyCap: number;
  senderEmail: string | null;
  senderRotation: boolean;
  mailboxesAvailable: number;
  poolCapacityToday: number;
  variants: Array<{ key: string; sent: number; replies: number }>;
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
        senderRotation: true,
        variants: true,
        lastRunAt: true,
        followUps: true,
        list: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (campaigns.length === 0) return [];
    const followUpCounts = await prisma.outreachCampaignFollowUp.groupBy({
      by: ["campaignId", "status"],
      where: { officeId, campaignId: { in: campaigns.map((campaign) => campaign.id) } },
      _count: { _all: true },
    });
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const sends = await prisma.outreachCampaignSend.groupBy({
      by: ["campaignId", "status", "variantKey"],
      where: { officeId, campaignId: { in: campaignIds } },
      _count: { _all: true },
    });
    const { start, end } = utcDayBounds(new Date());
    // sentToday reports everything that consumed the campaign daily cap today:
    // first touches and follow-ups share the same cap.
    const todayScope = { officeId, campaignId: { in: campaignIds }, status: "SENT", sentAt: { gte: start, lt: end } };
    const [firstTouchesToday, followUpsToday] = await Promise.all([
      prisma.outreachCampaignSend.groupBy({ by: ["campaignId"], where: todayScope, _count: { _all: true } }),
      prisma.outreachCampaignFollowUp.groupBy({ by: ["campaignId"], where: todayScope, _count: { _all: true } }),
    ]);
    const sentToday = new Map<string, number>();
    for (const row of [...firstTouchesToday, ...followUpsToday]) {
      sentToday.set(row.campaignId, (sentToday.get(row.campaignId) ?? 0) + row._count._all);
    }
    const localThreads = await prisma.outreachCampaignSend.findMany({
      where: { officeId, campaignId: { in: campaignIds }, status: "SENT", localThreadId: { not: null } },
      select: { campaignId: true, localThreadId: true, variantKey: true },
    });
    const threadToCampaign = new Map(localThreads.map((row) => [
      row.localThreadId as string,
      { campaignId: row.campaignId, variantKey: row.variantKey },
    ]));
    const replies = threadToCampaign.size
      ? await prisma.emailMessage.groupBy({
        by: ["threadId"],
        // Delivery feedback is excluded because bounces and auto-replies arrive
        // as inbound messages on the same thread.
        where: humanReplyMessageFilter(officeId, [...threadToCampaign.keys()]),
        _count: { _all: true },
      })
      : [];
    const replyCounts = campaignReplyCounts({
      replies: replies.map((reply) => ({ threadId: reply.threadId, count: reply._count._all })),
      threadToCampaign,
    });
    const mailboxes = await listEmailSenderPoolAccounts();
    const senderEmails = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox.email]));
    const poolCapacityToday = mailboxes.reduce(
      (total, mailbox) => total + Math.max(0, mailbox.dailySendLimit - mailbox.sentToday - mailbox.reservedToday),
      0,
    );
    return campaigns.map((campaign) => {
      const campaignSends = sends.filter((row) => row.campaignId === campaign.id);
      const counts = new Map<string, number>();
      for (const row of campaignSends) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + row._count._all);
      }
      const variants = storedCampaignVariants(campaign.variants);
      const followUps = new Map(followUpCounts.filter((row) => row.campaignId === campaign.id).map((row) => [row.status, row._count._all]));
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status as CampaignStatus,
        list: campaign.list,
        total: campaign.audienceTotal,
        sent: counts.get("SENT") ?? 0,
        sentToday: sentToday.get(campaign.id) ?? 0,
        rejected: counts.get("REJECTED") ?? 0,
        unknown: counts.get("UNKNOWN") ?? 0,
        replies: replyCounts.totals.get(campaign.id) ?? 0,
        followUpSteps: normalizeCampaignFollowUps(campaign.followUps).length,
        followUpsSent: followUps.get("SENT") ?? 0,
        followUpsSkipped: followUps.get("SKIPPED") ?? 0,
        dailyCap: campaign.dailyCap,
        senderEmail: campaign.senderAccountId ? senderEmails.get(campaign.senderAccountId) ?? null : null,
        senderRotation: campaign.senderRotation,
        mailboxesAvailable: mailboxes.length,
        poolCapacityToday,
        variants: variants.map((variant) => ({
          key: variant.key,
          sent: campaignSends
            .filter((row) => row.status === "SENT" && row.variantKey === variant.key)
            .reduce((sum, row) => sum + row._count._all, 0),
          replies: replyCounts.variants.get(`${campaign.id}:${variant.key}`) ?? 0,
        })),
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

export const CAMPAIGN_STATUSES_ALL = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;

export async function campaignRecipientFeedback(input: {
  officeId: string;
  campaignIds: readonly string[];
}) {
  const buckets = new Map<string, { bounced: number; complained: number; optedOut: number; blocked: number }>();
  for (const campaignId of input.campaignIds) {
    buckets.set(campaignId, { bounced: 0, complained: 0, optedOut: 0, blocked: 0 });
  }
  if (!input.campaignIds.length) return buckets;
  const sends = await prisma.outreachCampaignSend.findMany({
    where: { officeId: input.officeId, campaignId: { in: [...input.campaignIds] }, status: "SENT" },
    select: { campaignId: true, recipient: true },
  });
  const suppressions = await listSuppressedEmails(input.officeId, sends.map((send) => send.recipient));
  const counted = new Set<string>();
  for (const send of sends) {
    const email = send.recipient.trim().toLowerCase();
    const key = `${send.campaignId}:${email}`;
    if (counted.has(key)) continue;
    counted.add(key);
    const reason = suppressions.get(email);
    const bucket = buckets.get(send.campaignId);
    if (!reason || !bucket) continue;
    if (reason === "BOUNCED") bucket.bounced += 1;
    else if (reason === "COMPLAINED") bucket.complained += 1;
    else if (reason === "OPTED_OUT") bucket.optedOut += 1;
    else bucket.blocked += 1;
  }
  return buckets;
}

export async function campaignReplyDigest(input: {
  officeId: string;
  campaignIds: readonly string[];
  limit?: number;
}) {
  const counts = new Map<string, {
    replyThreads: number;
    answered: number;
    awaitingAnswer: number;
    autoReplies: number;
    bounces: number;
    optOuts: number;
    complaints: number;
  }>();
  for (const campaignId of input.campaignIds) {
    counts.set(campaignId, {
      replyThreads: 0,
      answered: 0,
      awaitingAnswer: 0,
      autoReplies: 0,
      bounces: 0,
      optOuts: 0,
      complaints: 0,
    });
  }
  if (!input.campaignIds.length) return { counts, replies: [] };
  const sends = await prisma.outreachCampaignSend.findMany({
    where: {
      officeId: input.officeId,
      campaignId: { in: [...input.campaignIds] },
      status: "SENT",
      localThreadId: { not: null },
    },
    select: { campaignId: true, recipient: true, variantKey: true, localThreadId: true },
  });
  const threadToCampaign = new Map(
    sends.map((send) => [
      send.localThreadId as string,
      { campaignId: send.campaignId, recipient: send.recipient, variantKey: send.variantKey },
    ]),
  );
  if (!threadToCampaign.size) return { counts, replies: [] };
  const threadIds = [...threadToCampaign.keys()];
  const [inbound, outbound] = await Promise.all([
    prisma.emailMessage.findMany({
      where: {
        officeId: input.officeId,
        threadId: { in: threadIds },
        direction: "INBOUND",
      },
      select: {
        threadId: true,
        fromEmail: true,
        fromName: true,
        subject: true,
        bodyText: true,
        sentAt: true,
        deliveryKind: true,
        classification: true,
      },
      orderBy: { sentAt: "asc" },
    }),
    prisma.emailMessage.findMany({
      where: {
        officeId: input.officeId,
        threadId: { in: threadIds },
        direction: "OUTBOUND",
      },
      select: { threadId: true, sentAt: true },
    }),
  ]);
  const inboundByThread = new Map<string, typeof inbound>();
  for (const message of inbound) {
    const threadMessages = inboundByThread.get(message.threadId) ?? [];
    threadMessages.push(message);
    inboundByThread.set(message.threadId, threadMessages);
  }
  const latestOutbound = new Map<string, Date>();
  for (const message of outbound) {
    const previous = latestOutbound.get(message.threadId);
    if (!previous || message.sentAt > previous) latestOutbound.set(message.threadId, message.sentAt);
  }
  const feedbackThreads = new Set<string>();
  for (const message of inbound) {
    const campaign = threadToCampaign.get(message.threadId);
    if (!campaign || !message.deliveryKind) continue;
    const key = `${message.threadId}:${message.deliveryKind}`;
    if (feedbackThreads.has(key)) continue;
    feedbackThreads.add(key);
    const campaignCounts = counts.get(campaign.campaignId);
    if (!campaignCounts) continue;
    if (message.deliveryKind === "AUTO_REPLY") campaignCounts.autoReplies += 1;
    else if (message.deliveryKind === "BOUNCE") campaignCounts.bounces += 1;
    else if (message.deliveryKind === "OPT_OUT") campaignCounts.optOuts += 1;
    else if (message.deliveryKind === "COMPLAINT") campaignCounts.complaints += 1;
  }
  const replies = [];
  for (const [threadId, campaign] of threadToCampaign) {
    const latestInbound = [...(inboundByThread.get(threadId) ?? [])]
      .filter(isHumanReplyMessage)
      .at(-1);
    if (!latestInbound) continue;
    const campaignCounts = counts.get(campaign.campaignId);
    if (!campaignCounts) continue;
    campaignCounts.replyThreads += 1;
    const answeredAt = latestOutbound.get(threadId);
    const replyAnsweredAt = answeredAt && answeredAt > latestInbound.sentAt ? answeredAt : null;
    const answered = replyAnsweredAt !== null;
    if (answered) campaignCounts.answered += 1;
    else campaignCounts.awaitingAnswer += 1;
    replies.push({
      campaignId: campaign.campaignId,
      threadId,
      recipient: campaign.recipient,
      fromEmail: latestInbound.fromEmail,
      fromName: latestInbound.fromName,
      subject: latestInbound.subject,
      variantKey: campaign.variantKey,
      receivedAt: latestInbound.sentAt,
      answered,
      answeredAt: replyAnsweredAt,
      snippet: (latestInbound.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    });
  }
  replies.sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
  const limit = input.limit ?? 100;
  return { counts, replies: replies.slice(0, limit) };
}

export async function completeCampaignIfDone(input: { officeId: string; campaignId: string }) {
  const campaign = await loadCampaign(input.officeId, input.campaignId);
  if (campaign.status !== "ACTIVE") return { completed: false };
  const { records } = await eligibleRecords(campaign, true);
  const audienceRecordIds = jsonStrings(campaign.audienceRecordIds);
  const audiencePersonalization = jsonObject(campaign.audiencePersonalization);
  if (!audienceRecordIds.length || !Object.keys(audiencePersonalization).length) {
    return { completed: false };
  }
  const attemptedIds = new Set((await prisma.outreachCampaignSend.findMany({
    where: { officeId: input.officeId, campaignId: input.campaignId },
    select: { recordId: true, status: true },
  })).filter((row) => campaignSendCountsAsAttempt(row.status)).map((row) => row.recordId));
  const now = new Date();
  const contactedElsewhere = await prisma.outreachCampaignSend.findMany({
    where: outreachCampaignContactedWhere({
      officeId: input.officeId,
      campaignId: input.campaignId,
      now,
    }),
    select: { recipient: true },
  });
  const unsentEligible = campaignSnapshotOutstandingRecordIds({
    rows: records,
    audienceRecordIds,
    audiencePersonalization,
    statuses: jsonStrings(campaign.rowStatuses),
    attemptedRecordIds: attemptedIds,
    blockedRecipients: new Set(contactedElsewhere.map((row) => row.recipient.trim().toLowerCase())),
  });
  if (unsentEligible.length > 0) return { completed: false };
  const unresolved = await unresolvedOutreachCampaignDeliveries(prisma, { id: campaign.id, officeId: campaign.officeId });
  if (unresolved > 0) return { completed: false };
  const outstandingFollowUps = await outstandingCampaignFollowUps(prisma, {
    id: campaign.id,
    officeId: campaign.officeId,
    subject: campaign.subject,
    senderAccountId: campaign.senderAccountId,
    senderDisplayName: campaign.senderDisplayName,
    dailyCap: campaign.dailyCap,
    followUps: campaign.followUps,
    audiencePersonalization: {},
  }, new Date());
  if (outstandingFollowUps > 0) return { completed: false };
  const updated = await prisma.outreachCampaign.updateMany({
    where: {
      id: input.campaignId,
      officeId: input.officeId,
      status: "ACTIVE",
      ...(campaign.revisionHash !== null ? { revisionHash: campaign.revisionHash } : {}),
    },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return updated.count > 0 ? { completed: true } : { completed: false };
}
