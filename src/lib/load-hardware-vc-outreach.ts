import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  HARDWARE_VC_CAMPAIGN_REVIEWED_AT,
  HARDWARE_VC_CAMPAIGN_TAG,
  HARDWARE_VC_OUTREACH_CAMPAIGN,
  hardwareVcCampaignCounts,
  hardwareVcCampaignNotes,
  linkedinPeopleSearchUrl,
  type HardwareVcOutreachChannel,
  type HardwareVcOutreachTarget,
} from "@/lib/hardware-vc-outreach-campaign";
import { dateKeyToUtcDate, outreachCalendar } from "@/lib/crm-outreach";

const ELIGIBLE_STATUSES = new Set([null, "not_contacted", "queued"]);
const BOOKFACE_URL = "https://bookface.ycombinator.com/";

type CampaignLoadResult = {
  createdContacts: number;
  reusedContacts: number;
  queued: Record<HardwareVcOutreachChannel, number>;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function jsonObject(value: unknown): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function contactKey(companyId: string, fullName: string): string {
  return `${companyId}:${fullName.trim().toLowerCase()}`;
}

function targetTags(target: HardwareVcOutreachTarget): string[] {
  return target.kind === "hardware_vc"
    ? ["hardware_vc", "portfolio_intro", HARDWARE_VC_CAMPAIGN_TAG]
    : ["hardware_company", "freight_prospect", HARDWARE_VC_CAMPAIGN_TAG];
}

function targetContactData(target: HardwareVcOutreachTarget, companyId: string) {
  return {
    companyId,
    fullName: target.name,
    title: target.title,
    status: "queued",
    importance: target.importance,
    category: target.kind === "hardware_vc" ? "personally_important" : "startup",
    relationshipType: target.kind === "hardware_vc" ? "investor" : "buyer",
    leverageLevel: "high",
    relationshipStrength: "unknown",
    outreachChannel: target.channel,
    ownerLabel: "Mert",
    linkedinUrl:
      target.channel === "bookface" ? null : linkedinPeopleSearchUrl(target),
    bookfaceUrl: target.channel === "bookface" ? BOOKFACE_URL : null,
    notes: hardwareVcCampaignNotes(target),
    tags: targetTags(target) as Prisma.InputJsonValue,
    sourceRefs: {
      campaign: HARDWARE_VC_CAMPAIGN_TAG,
      officialSourceUrl: target.sourceUrl,
      reviewedAt: HARDWARE_VC_CAMPAIGN_REVIEWED_AT,
    } as Prisma.InputJsonValue,
  };
}

export async function loadHardwareVcOutreachCampaign(
  officeId: string,
  now: Date = new Date(),
): Promise<CampaignLoadResult> {
  const expected = hardwareVcCampaignCounts();
  if (
    HARDWARE_VC_OUTREACH_CAMPAIGN.length !== 112 ||
    expected.bookface !== 20 ||
    expected.linkedin !== 30 ||
    expected.email < 30
  ) {
    throw new Error(
      "Hardware outreach campaign must contain 20 Bookface companies, 30 LinkedIn companies, and at least 30 email VCs.",
    );
  }

  const calendar = outreachCalendar(now);
  const weekStart = dateKeyToUtcDate(calendar.weekStartKey);
  const today = dateKeyToUtcDate(calendar.todayKey);
  const companyNames = [...new Set(
    HARDWARE_VC_OUTREACH_CAMPAIGN.map((target) => target.company),
  )];
  const targetByCompany = new Map(
    HARDWARE_VC_OUTREACH_CAMPAIGN.map((target) => [target.company, target]),
  );

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${HARDWARE_VC_CAMPAIGN_TAG}:${officeId}`}, 0)
      )
    `;
    await tx.$executeRaw`
      LOCK TABLE "Company", "Contact" IN SHARE ROW EXCLUSIVE MODE
    `;

    const initialCompanies = await tx.company.findMany({
      where: { officeId, name: { in: companyNames } },
      select: {
        id: true,
        name: true,
        website: true,
        crmTags: true,
        sourceRefs: true,
      },
    });
    const initialCompanyNames = new Set(initialCompanies.map((company) => company.name));
    const missingCompanies = companyNames.filter((name) => !initialCompanyNames.has(name));

    if (missingCompanies.length > 0) {
      await tx.company.createMany({
        data: missingCompanies.map((name) => {
          const target = targetByCompany.get(name);
          if (!target) throw new Error(`Missing campaign company definition for ${name}.`);
          return {
            officeId,
            name,
            website: target.website,
            crmCategory: target.kind === "hardware_vc" ? "investor" : "prospect",
            crmStage: "prospect",
            crmPriority: "high",
            relationshipStrength: "unknown",
            crmSource: "web_research",
            crmTags: targetTags(target) as Prisma.InputJsonValue,
            sourceRefs: {
              campaign: HARDWARE_VC_CAMPAIGN_TAG,
              officialSourceUrl: target.sourceUrl,
              reviewedAt: HARDWARE_VC_CAMPAIGN_REVIEWED_AT,
            } as Prisma.InputJsonValue,
          };
        }),
        skipDuplicates: true,
      });
    }

    const companies = await tx.company.findMany({
      where: { officeId, name: { in: companyNames } },
      select: {
        id: true,
        name: true,
        website: true,
        crmTags: true,
        sourceRefs: true,
      },
    });
    if (companies.length !== companyNames.length) {
      throw new Error("Could not resolve every hardware company and VC inside this office.");
    }

    const companyByName = new Map(companies.map((company) => [company.name, company]));
    for (const company of companies) {
      const target = targetByCompany.get(company.name);
      if (!target) continue;
      const tags = [...new Set([
        ...stringArray(company.crmTags),
        ...targetTags(target),
      ])];
      const updatedCompany = await tx.company.updateMany({
        where: { id: company.id, officeId },
        data: {
          website: company.website ?? target.website,
          crmCategory: target.kind === "hardware_vc" ? "investor" : "prospect",
          crmStage: "prospect",
          crmPriority: "high",
          crmTags: tags as Prisma.InputJsonValue,
          sourceRefs: {
            ...jsonObject(company.sourceRefs),
            campaign: HARDWARE_VC_CAMPAIGN_TAG,
            officialSourceUrl: target.sourceUrl,
            reviewedAt: HARDWARE_VC_CAMPAIGN_REVIEWED_AT,
          } as Prisma.InputJsonValue,
        },
      });
      if (updatedCompany.count !== 1) {
        throw new Error(`Could not update ${company.name} inside this office.`);
      }
    }

    const companyIds = companies.map((company) => company.id);
    const targetNames = HARDWARE_VC_OUTREACH_CAMPAIGN.map((target) => target.name);
    const existingContacts = await tx.contact.findMany({
      where: {
        companyId: { in: companyIds },
        fullName: { in: targetNames, mode: "insensitive" },
        company: { officeId },
      },
      select: {
        id: true,
        companyId: true,
        fullName: true,
        title: true,
        status: true,
        email: true,
        linkedinUrl: true,
        bookfaceUrl: true,
        phone: true,
        notes: true,
        ownerLabel: true,
        tags: true,
        sourceRefs: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const existingByKey = new Map<string, (typeof existingContacts)[number]>();
    const duplicateKeys = new Set<string>();
    for (const contact of existingContacts) {
      const key = contactKey(contact.companyId, contact.fullName);
      if (existingByKey.has(key)) duplicateKeys.add(key);
      else existingByKey.set(key, contact);
    }
    if (duplicateKeys.size > 0) {
      throw new Error(
        "Duplicate matching campaign contacts already exist. Merge them in CRM before loading this campaign.",
      );
    }

    const protectedContacts = HARDWARE_VC_OUTREACH_CAMPAIGN.flatMap((target) => {
      const company = companyByName.get(target.company);
      if (!company) return [target.name];
      const existing = existingByKey.get(contactKey(company.id, target.name));
      return existing && !ELIGIBLE_STATUSES.has(existing.status)
        ? [`${target.name} (${existing.status})`]
        : [];
    });
    if (protectedContacts.length > 0) {
      throw new Error(
        `These people already have protected CRM status: ${protectedContacts.join(", ")}. Review them before re-queueing.`,
      );
    }

    const missingTargets = HARDWARE_VC_OUTREACH_CAMPAIGN.filter((target) => {
      const company = companyByName.get(target.company);
      return company && !existingByKey.has(contactKey(company.id, target.name));
    });
    if (missingTargets.length > 0) {
      await tx.contact.createMany({
        data: missingTargets.map((target) => {
          const company = companyByName.get(target.company);
          if (!company) throw new Error(`Company not found for ${target.name}.`);
          return targetContactData(target, company.id);
        }),
      });
    }

    for (const target of HARDWARE_VC_OUTREACH_CAMPAIGN) {
      const company = companyByName.get(target.company);
      if (!company) throw new Error(`Company not found for ${target.name}.`);
      const existing = existingByKey.get(contactKey(company.id, target.name));
      if (!existing) continue;
      const notes = existing.notes?.includes(HARDWARE_VC_CAMPAIGN_TAG)
        ? existing.notes
        : [existing.notes, hardwareVcCampaignNotes(target)]
            .filter(Boolean)
            .join("\n\n");
      const updatedContact = await tx.contact.updateMany({
        where: {
          id: existing.id,
          company: { officeId },
        },
        data: {
          title: existing.title ?? target.title,
          status: "queued",
          importance: target.importance,
          category:
            target.kind === "hardware_vc" ? "personally_important" : "startup",
          relationshipType: target.kind === "hardware_vc" ? "investor" : "buyer",
          leverageLevel: "high",
          outreachChannel: target.channel,
          ownerLabel: existing.ownerLabel ?? "Mert",
          linkedinUrl:
            existing.linkedinUrl ??
            (target.channel === "bookface" ? null : linkedinPeopleSearchUrl(target)),
          bookfaceUrl:
            existing.bookfaceUrl ??
            (target.channel === "bookface" ? BOOKFACE_URL : null),
          notes,
          tags: [...new Set([
            ...stringArray(existing.tags),
            ...targetTags(target),
          ])] as Prisma.InputJsonValue,
          sourceRefs: {
            ...jsonObject(existing.sourceRefs),
            campaign: HARDWARE_VC_CAMPAIGN_TAG,
            officialSourceUrl: target.sourceUrl,
            reviewedAt: HARDWARE_VC_CAMPAIGN_REVIEWED_AT,
          } as Prisma.InputJsonValue,
        },
      });
      if (updatedContact.count !== 1) {
        throw new Error(`Could not update ${target.name} inside this office.`);
      }
    }

    const campaignContacts = await tx.contact.findMany({
      where: {
        companyId: { in: companyIds },
        fullName: { in: targetNames, mode: "insensitive" },
        company: { officeId },
      },
      select: {
        id: true,
        companyId: true,
        fullName: true,
      },
    });
    const campaignContactByKey = new Map(
      campaignContacts.map((contact) => [
        contactKey(contact.companyId, contact.fullName),
        contact,
      ]),
    );
    const contactIdsByChannel: Record<HardwareVcOutreachChannel, string[]> = {
      bookface: [],
      linkedin: [],
      email: [],
    };
    for (const target of HARDWARE_VC_OUTREACH_CAMPAIGN) {
      const company = companyByName.get(target.company);
      if (!company) throw new Error(`Company not found for ${target.name}.`);
      const contact = campaignContactByKey.get(contactKey(company.id, target.name));
      if (!contact) throw new Error(`Contact not found after loading ${target.name}.`);
      contactIdsByChannel[target.channel].push(contact.id);
    }
    const campaignContactIds = Object.values(contactIdsByChannel).flat();
    if (new Set(campaignContactIds).size !== HARDWARE_VC_OUTREACH_CAMPAIGN.length) {
      throw new Error(
        "Hardware outreach campaign did not resolve to the expected unique CRM contacts.",
      );
    }

    const currentPlans = await tx.outreachPlanItem.findMany({
      where: {
        officeId,
        weekStart,
        contactId: { in: campaignContactIds },
      },
      select: { id: true, contactId: true, status: true },
    });
    const completedTargetIds = currentPlans
      .filter((plan) => plan.status === "REACHED_OUT")
      .map((plan) => plan.contactId);
    if (completedTargetIds.length > 0) {
      throw new Error(
        "At least one campaign target was already reached this week. Review the completed rows before reloading.",
      );
    }

    await tx.outreachPlanItem.updateMany({
      where: {
        officeId,
        status: "TODAY",
        contact: { company: { officeId } },
      },
      data: { status: "WEEKLY", scheduledFor: null },
    });

    const existingPlanContactIds = new Set(currentPlans.map((plan) => plan.contactId));
    const channelByContactId = new Map<string, HardwareVcOutreachChannel>();
    for (const channel of Object.keys(contactIdsByChannel) as HardwareVcOutreachChannel[]) {
      for (const contactId of contactIdsByChannel[channel]) {
        channelByContactId.set(contactId, channel);
      }
    }
    const newPlanContactIds = campaignContactIds.filter(
      (contactId) => !existingPlanContactIds.has(contactId),
    );
    if (newPlanContactIds.length > 0) {
      await tx.outreachPlanItem.createMany({
        data: newPlanContactIds.map((contactId) => ({
          officeId,
          contactId,
          weekStart,
          channel: channelByContactId.get(contactId) ?? "email",
          status: "TODAY",
          scheduledFor: today,
        })),
      });
    }
    for (const channel of Object.keys(contactIdsByChannel) as HardwareVcOutreachChannel[]) {
      await tx.outreachPlanItem.updateMany({
        where: {
          officeId,
          weekStart,
          contactId: { in: contactIdsByChannel[channel] },
          status: { in: ["WEEKLY", "TODAY", "SKIPPED"] },
        },
        data: {
          channel,
          status: "TODAY",
          scheduledFor: today,
        },
      });
    }

    const queuedPlans = await tx.outreachPlanItem.findMany({
      where: {
        officeId,
        weekStart,
        contactId: { in: campaignContactIds },
        status: "TODAY",
      },
      select: { channel: true },
    });
    const queued: Record<HardwareVcOutreachChannel, number> = {
      bookface: 0,
      linkedin: 0,
      email: 0,
    };
    for (const plan of queuedPlans) {
      if (plan.channel === "bookface" || plan.channel === "linkedin" || plan.channel === "email") {
        queued[plan.channel] += 1;
      }
    }
    if (
      queued.bookface !== 20 ||
      queued.linkedin !== 30 ||
      queued.email !== expected.email
    ) {
      throw new Error(
        "Today's hardware outreach queue failed the company and VC channel verification.",
      );
    }

    return {
      createdContacts: missingTargets.length,
      reusedContacts: HARDWARE_VC_OUTREACH_CAMPAIGN.length - missingTargets.length,
      queued,
    };
  }, {
    maxWait: 10_000,
    timeout: 60_000,
  });
}
