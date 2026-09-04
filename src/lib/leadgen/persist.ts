import type { Prisma, PrismaClient } from "@prisma/client";
import { isRoleEmail } from "./extract";
import type { LeadCandidate } from "./harvest";
import type { EmailVerification } from "./verify";

export type LeadRecord = {
  candidate: LeadCandidate;
  verifications: EmailVerification[];
};

type LeadDiscoveryRecord = LeadRecord & {
  persisted?: boolean;
  companyId?: string | null;
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
  client: PrismaClient;
  runId?: string;
  profileSlug?: string;
  runCounters?: {
    queriesUsed: number;
    pagesFetched: number;
    candidatesFound: number;
    providerStats: Prisma.InputJsonValue;
  };
  /** Only persist candidates at or above this fit score. */
  minScore?: number;
  /** Only persist addresses at or above this verification confidence. */
  minEmailConfidence?: number;
  now?: Date;
};

export type LeadGenRunCounters = {
  queriesUsed: number;
  pagesFetched: number;
  candidatesFound: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  skipped: number;
  providerStats: Prisma.InputJsonValue;
};

export async function recordLeadDiscoveries(
  client: PrismaClient,
  options: {
    officeId: string;
    runId?: string;
    campaignTag: string;
    profileSlug: string;
    records: readonly LeadDiscoveryRecord[];
    now?: Date;
    minScore?: number;
    minEmailConfidence?: number;
  },
) {
  const now = options.now ?? new Date();
  const minScore = options.minScore ?? 50;
  const minEmailConfidence = options.minEmailConfidence ?? 55;
  for (const record of options.records) {
    const { candidate } = record;
    const emailsFound = candidate.emails.length;
    const usableContact = record.verifications.some(
      (verification) =>
        verification.verdict !== "undeliverable" && verification.confidence >= minEmailConfidence,
    );
    const bestVerification = [...record.verifications].sort((a, b) => b.confidence - a.confidence)[0];
    const persisted = record.persisted ?? (candidate.fit.score >= minScore && usableContact);
    const skipReason = persisted
      ? null
      : candidate.fit.score < minScore
        ? "below_fit_score"
        : !usableContact
          ? "no_usable_email"
          : "research_row_not_persisted";
    await client.leadDiscovery.create({
      data: {
        officeId: options.officeId,
        runId: options.runId ?? null,
        companyId: record.companyId ?? null,
        companyName: candidate.companyName.slice(0, 180),
        domain: candidate.domain,
        provider: candidate.discoveryProvider ?? "unknown",
        engine: candidate.discoveryEngine ?? "unknown",
        rank: candidate.discoveryRank ?? 0,
        query: candidate.discoveredVia,
        sourceUrl: candidate.discoverySourceUrl ?? candidate.website,
        campaignTag: options.campaignTag,
        profileSlug: options.profileSlug,
        segmentKey: candidate.segmentKey,
        fitScore: candidate.fit.score,
        fitTier: candidate.fit.tier,
        emailsFound,
        contactFound: emailsFound > 0,
        usableContact,
        bestEmailVerdict: bestVerification?.verdict ?? null,
        bestEmailConfidence: bestVerification?.confidence ?? null,
        persisted,
        skipReason,
        discoveredAt: now,
      },
    });
  }
}

export async function createLeadGenRun(
  client: PrismaClient,
  input: {
    officeId: string;
    profileSlug: string;
    campaignTag: string;
    workspaceId?: string | null;
    startedAt?: Date;
  },
) {
  return client.leadGenRun.create({
    data: {
      officeId: input.officeId,
      profileSlug: input.profileSlug,
      campaignTag: input.campaignTag,
      workspaceId: input.workspaceId ?? null,
      startedAt: input.startedAt ?? new Date(),
      providerStats: {},
    },
  });
}

export async function finishLeadGenRun(
  client: PrismaClient,
  input: {
    officeId: string;
    runId: string;
    status: "COMPLETED" | "FAILED";
    counters: LeadGenRunCounters;
    finishedAt?: Date;
    error?: string | null;
  },
) {
  return client.leadGenRun.updateMany({
    where: { id: input.runId, officeId: input.officeId },
    data: {
      status: input.status,
      finishedAt: input.finishedAt ?? new Date(),
      queriesUsed: input.counters.queriesUsed,
      pagesFetched: input.counters.pagesFetched,
      candidatesFound: input.counters.candidatesFound,
      companiesCreated: input.counters.companiesCreated,
      companiesUpdated: input.counters.companiesUpdated,
      contactsCreated: input.counters.contactsCreated,
      skipped: input.counters.skipped,
      providerStats: input.counters.providerStats,
      error: input.error ?? null,
    },
  });
}

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
  const client = options.client;
  const minScore = options.minScore ?? 50;
  const minEmailConfidence = options.minEmailConfidence ?? 55;
  const now = options.now ?? new Date();
  if (options.runId) {
    const run = await client.leadGenRun.findFirst({
      where: { id: options.runId, officeId: options.officeId },
      select: { id: true },
    });
    if (!run) throw new Error("Lead generation run does not belong to this office.");
  }

  const result: PersistLeadsResult = {
    companiesCreated: 0,
    companiesUpdated: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    skipped: 0,
  };

  const discoveryRecords: LeadDiscoveryRecord[] = records.map((record) => ({ ...record, persisted: false }));
  for (const [recordIndex, record] of records.entries()) {
    const { candidate } = record;
    const usableEmails = record.verifications.filter(
      (verification) =>
        verification.verdict !== "undeliverable" && verification.confidence >= minEmailConfidence,
    );
    const bestVerification = [...record.verifications].sort((a, b) => b.confidence - a.confidence)[0];
    const skipReason = candidate.fit.score < minScore
      ? "below_fit_score"
      : usableEmails.length === 0
        ? "no_usable_email"
        : null;
    let companyId: string | null = null;
    const sourceRefs: Prisma.InputJsonValue = {
      campaign: options.campaignTag,
      website: candidate.website,
      discoveredVia: candidate.discoveredVia,
      provider: candidate.discoveryProvider ?? "unknown",
      engine: candidate.discoveryEngine ?? "unknown",
      rank: candidate.discoveryRank ?? 0,
      sourceUrl: candidate.discoverySourceUrl ?? candidate.website,
      harvestedAt: candidate.harvestedAt,
      fitScore: candidate.fit.score,
      fitTier: candidate.fit.tier,
      matchedSegments: candidate.fit.matchedSegments,
      matchedSignals: candidate.fit.matchedSignals.slice(0, 12),
      evidenceUrls: candidate.evidence.map((item) => item.url).slice(0, 8),
    };

    if (skipReason) {
      result.skipped += 1;
      continue;
    }

    const name = candidate.companyName.slice(0, 180);
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
    companyId = company.id;
    discoveryRecords[recordIndex]!.persisted = true;
    discoveryRecords[recordIndex]!.companyId = companyId;
    if (existing) result.companiesUpdated += 1;
    else result.companiesCreated += 1;

    for (const verification of usableEmails.slice(0, 5)) {
      const enriched = candidate.contacts?.find((contact) => contact.email === verification.email) ?? null;
      const fullName = enriched?.fullName ?? contactNameForEmail(verification.email, name);
      const existingContact = await client.contact.findFirst({
        where: { companyId: company.id, email: verification.email },
        select: { id: true },
      });

      const contactData = {
        fullName,
        email: verification.email,
        phone: enriched?.phone ?? candidate.phones[0] ?? null,
        title: enriched?.position ?? (isRoleEmail(verification.email) ? "Company inbox" : null),
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
          ...(verification.provider
            ? {
              mailboxProvider: verification.provider.provider,
              mailboxStatus: verification.provider.status,
              mailboxReason: verification.provider.reason,
              mailboxScore: verification.provider.score,
              mailboxCheckedAt: verification.provider.checkedAt,
            }
            : {}),
          ...(enriched
            ? {
              enrichmentProvider: enriched.provider,
              enrichmentConfidence: enriched.confidence,
              enrichmentSeniority: enriched.seniority,
              enrichmentDepartment: enriched.department,
              enrichmentDecisionMaker: enriched.decisionMaker,
              enrichmentSourceUrls: enriched.sourceUrls,
              enrichedAt: enriched.enrichedAt,
            }
            : {}),
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

  await recordLeadDiscoveries(client, {
    officeId: options.officeId,
    runId: options.runId,
    campaignTag: options.campaignTag,
    profileSlug: options.profileSlug ?? "unknown",
    records: discoveryRecords,
    now,
    minScore,
    minEmailConfidence,
  });

  if (options.runId && options.runCounters) {
    await client.leadGenRun.updateMany({
      where: { id: options.runId, officeId: options.officeId },
      data: {
        queriesUsed: options.runCounters.queriesUsed,
        pagesFetched: options.runCounters.pagesFetched,
        candidatesFound: options.runCounters.candidatesFound,
        companiesCreated: result.companiesCreated,
        companiesUpdated: result.companiesUpdated,
        contactsCreated: result.contactsCreated,
        skipped: result.skipped,
        providerStats: options.runCounters.providerStats,
      },
    });
  }

  return result;
}
