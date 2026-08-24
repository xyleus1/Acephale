import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { isRoleEmail } from "./extract";
import type { LeadCandidate } from "./harvest";
import type { EmailVerification } from "./verify";

export type LeadRecord = {
  candidate: LeadCandidate;
  verifications: EmailVerification[];
};

export type PersistLeadsResult = {
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  skipped: number;
};

export type PersistLeadsOptions = {
  officeId: string;
  campaignTag: string;
  client?: PrismaClient;
  /** Only persist candidates at or above this fit score. */
  minScore?: number;
  /** Only persist addresses at or above this verification confidence. */
  minEmailConfidence?: number;
  now?: Date;
};

function contactNameForEmail(email: string, companyName: string) {
  const local = email.split("@")[0] ?? "";
  if (isRoleEmail(email)) return `${companyName} ${local}`.trim();
  const parts = local
    .split(/[._-]+/)
    .filter((part) => part.length > 1 && !/^\d+$/.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return parts.length ? parts.join(" ") : `${companyName} ${local}`.trim();
}

export async function persistLeads(
  records: readonly LeadRecord[],
  options: PersistLeadsOptions,
): Promise<PersistLeadsResult> {
  const client = options.client ?? defaultPrisma;
  const minScore = options.minScore ?? 50;
  const minEmailConfidence = options.minEmailConfidence ?? 55;
  const now = options.now ?? new Date();

  const result: PersistLeadsResult = {
    companiesCreated: 0,
    companiesUpdated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    skipped: 0,
  };

  for (const record of records) {
    const { candidate } = record;
    const usableEmails = record.verifications.filter(
      (verification) =>
        verification.verdict !== "undeliverable" && verification.confidence >= minEmailConfidence,
    );

    if (candidate.fit.score < minScore || usableEmails.length === 0) {
      result.skipped += 1;
      continue;
    }

    const name = candidate.companyName.slice(0, 180);
    const sourceRefs: Prisma.InputJsonValue = {
      campaign: options.campaignTag,
      website: candidate.website,
      discoveredVia: candidate.discoveredVia,
      harvestedAt: candidate.harvestedAt,
      fitScore: candidate.fit.score,
      fitTier: candidate.fit.tier,
      matchedSegments: candidate.fit.matchedSegments,
      matchedSignals: candidate.fit.matchedSignals.slice(0, 12),
      evidenceUrls: candidate.evidence.map((item) => item.url).slice(0, 8),
    };
    const tags: Prisma.InputJsonValue = [
      options.campaignTag,
      `fit_${candidate.fit.tier.toLowerCase()}`,
      ...candidate.fit.matchedSegments,
    ];

    const existing = await client.company.findUnique({
      where: { officeId_name: { officeId: options.officeId, name } },
      select: { id: true },
    });

    const companyData = {
      domain: candidate.domain,
      website: candidate.website,
      crmCategory: "prospect",
      crmStage: existing ? undefined : "new",
      crmPriority: candidate.fit.tier === "A" ? "high" : candidate.fit.tier === "B" ? "medium" : "low",
      crmSource: options.campaignTag,
      crmNotes: `Fit ${candidate.fit.score}/100 (${candidate.fit.tier}). Segments: ${
        candidate.fit.matchedSegments.join(", ") || "unclassified"
      }. City: ${candidate.city ?? "unknown"}.`,
      lane: candidate.city,
      sourceRefs,
      crmTags: tags,
    };

    const company = existing
      ? await client.company.update({ where: { id: existing.id }, data: companyData, select: { id: true } })
      : await client.company.create({
        data: { officeId: options.officeId, name, ...companyData, crmStage: "new" },
        select: { id: true },
      });
    if (existing) result.companiesUpdated += 1;
    else result.companiesCreated += 1;

    for (const verification of usableEmails.slice(0, 5)) {
      const fullName = contactNameForEmail(verification.email, name);
      const existingContact = await client.contact.findFirst({
        where: { companyId: company.id, email: verification.email },
        select: { id: true },
      });

      const contactData = {
        fullName,
        email: verification.email,
        phone: candidate.phones[0] ?? null,
        title: isRoleEmail(verification.email) ? "Company inbox" : null,
        relationshipType: "buyer",
        importance: candidate.fit.tier === "A" ? "high" : "medium",
        status: "not_contacted",
        outreachChannel: "email",
        leverageLevel: "medium",
        location: candidate.city,
        notes: `Verification: ${verification.verdict} (${verification.confidence}%). MX ${
          verification.mxHost ?? "none"
        }. ${verification.reasons.join("; ")}`,
        tags: tags,
        sourceRefs: {
          ...(sourceRefs as Record<string, unknown>),
          emailVerdict: verification.verdict,
          emailConfidence: verification.confidence,
          mxHost: verification.mxHost,
          verifiedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      };

      if (existingContact) {
        await client.contact.update({ where: { id: existingContact.id }, data: contactData });
        result.contactsUpdated += 1;
      } else {
        await client.contact.create({ data: { companyId: company.id, ...contactData } });
        result.contactsCreated += 1;
      }
    }
  }

  return result;
}
