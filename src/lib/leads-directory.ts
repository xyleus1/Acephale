import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const LEAD_PAGE_SIZE = 50;

export type LeadContactRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: string | null;
  emailVerdict: string | null;
  emailConfidence: number | null;
  mxHost: string | null;
};

export type LeadCompanyRow = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  city: string | null;
  priority: string;
  stage: string;
  source: string;
  fitScore: number | null;
  fitTier: string | null;
  segments: string[];
  evidenceUrls: string[];
  discoveredVia: string | null;
  harvestedAt: string | null;
  updatedAt: Date;
  contacts: LeadContactRow[];
};

export type LeadDirectoryFilters = {
  query?: string;
  source?: string;
  priority?: string;
  page?: number;
};

export type LeadDirectory = {
  rows: LeadCompanyRow[];
  total: number;
  contactTotal: number;
  page: number;
  pageCount: number;
  sources: Array<{ value: string; count: number }>;
};

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, limit);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Harvested URLs are untrusted, so only http and https links reach an href. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asSafeUrlList(value: unknown, limit: number): string[] {
  return asStringList(value, limit * 2)
    .map((item) => safeHttpUrl(item))
    .filter((item): item is string => item !== null)
    .slice(0, limit);
}

function companyWhere(officeId: string, filters: LeadDirectoryFilters): Prisma.CompanyWhereInput {
  const query = filters.query?.trim();
  const source = filters.source?.trim();
  const priority = filters.priority?.trim().toLowerCase();
  return {
    officeId,
    ...(source ? { crmSource: source } : {}),
    ...(priority && priority !== "all" ? { crmPriority: priority } : {}),
    ...(query
      ? {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { domain: { contains: query, mode: "insensitive" as const } },
          { lane: { contains: query, mode: "insensitive" as const } },
          { contacts: { some: { email: { contains: query, mode: "insensitive" as const } } } },
        ],
      }
      : {}),
  };
}

export async function loadLeadDirectory(
  officeId: string,
  filters: LeadDirectoryFilters = {},
): Promise<LeadDirectory> {
  const where = companyWhere(officeId, filters);
  const page = Math.max(1, filters.page ?? 1);

  const [total, contactTotal, sourceGroups, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.contact.count({ where: { company: where, email: { not: null } } }),
    prisma.company.groupBy({
      by: ["crmSource"],
      where: { officeId },
      _count: { _all: true },
      orderBy: { _count: { crmSource: "desc" } },
      take: 12,
    }),
    prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        website: true,
        domain: true,
        lane: true,
        crmPriority: true,
        crmStage: true,
        crmSource: true,
        sourceRefs: true,
        updatedAt: true,
        contacts: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            title: true,
            status: true,
            sourceRefs: true,
          },
          orderBy: { createdAt: "asc" },
          take: 5,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      skip: (page - 1) * LEAD_PAGE_SIZE,
      take: LEAD_PAGE_SIZE,
    }),
  ]);

  const rows: LeadCompanyRow[] = companies.map((company) => {
    const refs = asRecord(company.sourceRefs);
    return {
      id: company.id,
      name: company.name,
      website: safeHttpUrl(company.website),
      domain: company.domain,
      city: company.lane,
      priority: company.crmPriority,
      stage: company.crmStage,
      source: company.crmSource,
      fitScore: asNumber(refs.fitScore),
      fitTier: asString(refs.fitTier),
      segments: asStringList(refs.matchedSegments, 4),
      evidenceUrls: asSafeUrlList(refs.evidenceUrls, 4),
      discoveredVia: asString(refs.discoveredVia),
      harvestedAt: asString(refs.harvestedAt),
      updatedAt: company.updatedAt,
      contacts: company.contacts.map((contact) => {
        const contactRefs = asRecord(contact.sourceRefs);
        return {
          id: contact.id,
          fullName: contact.fullName,
          email: contact.email,
          phone: contact.phone,
          title: contact.title,
          status: contact.status,
          emailVerdict: asString(contactRefs.emailVerdict),
          emailConfidence: asNumber(contactRefs.emailConfidence),
          mxHost: asString(contactRefs.mxHost),
        };
      }),
    };
  });

  return {
    rows,
    total,
    contactTotal,
    page,
    pageCount: Math.max(1, Math.ceil(total / LEAD_PAGE_SIZE)),
    sources: sourceGroups.map((group) => ({ value: group.crmSource, count: group._count._all })),
  };
}

export type LeadExportRow = {
  company: string;
  website: string;
  city: string;
  fitScore: string;
  fitTier: string;
  segments: string;
  source: string;
  contactName: string;
  email: string;
  phone: string;
  emailVerdict: string;
  emailConfidence: string;
  evidence: string;
};

export async function loadLeadExportRows(
  officeId: string,
  filters: LeadDirectoryFilters = {},
  limit = 5000,
): Promise<LeadExportRow[]> {
  const companies = await prisma.company.findMany({
    where: companyWhere(officeId, filters),
    select: {
      name: true,
      website: true,
      lane: true,
      crmSource: true,
      sourceRefs: true,
      contacts: {
        select: { fullName: true, email: true, phone: true, sourceRefs: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  const rows: LeadExportRow[] = [];
  for (const company of companies) {
    const refs = asRecord(company.sourceRefs);
    const base = {
      company: company.name,
      website: company.website ?? "",
      city: company.lane ?? "",
      fitScore: asNumber(refs.fitScore)?.toString() ?? "",
      fitTier: asString(refs.fitTier) ?? "",
      segments: asStringList(refs.matchedSegments, 6).join(" | "),
      source: company.crmSource,
      evidence: asStringList(refs.evidenceUrls, 4).join(" | "),
    };
    if (company.contacts.length === 0) {
      rows.push({
        ...base,
        contactName: "",
        email: "",
        phone: "",
        emailVerdict: "",
        emailConfidence: "",
      });
      continue;
    }
    for (const contact of company.contacts) {
      const contactRefs = asRecord(contact.sourceRefs);
      rows.push({
        ...base,
        contactName: contact.fullName,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        emailVerdict: asString(contactRefs.emailVerdict) ?? "",
        emailConfidence: asNumber(contactRefs.emailConfidence)?.toString() ?? "",
      });
    }
  }
  return rows;
}
