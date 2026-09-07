import { classifyManufacturer } from "../manufacturing";
import { normalizeCompanyName, normalizeCountry, normalizeDomain } from "../normalize";
import type { NormalizedSourceRecord } from "../records";
import type { GetleadCompanyRow, GetleadContactRow } from "../getlead/client";
import type { Prisma } from "../../../generated/world-client";

export const GETLEAD_SOURCE = "getlead";
export const downloadHint = "Getlead rows come from the authenticated API and are not a downloadable archive.";
export const GETLEAD_MANUFACTURING_CATEGORIES = new Set([
  "manufacturing",
  "industrial",
  "industrial automation",
  "metals & mining",
  "/business & industrial/metals & mining",
  "/business & industrial/industrial materials & equipment",
  "/business & industrial/manufacturing",
]);

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function labels(...values: unknown[]) {
  return values
    .flatMap((value) => text(value)?.split(/[,;|]/u) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function manufacturerEvidence(row: {
  categories?: unknown;
  keywords?: unknown;
  industry?: unknown;
}) {
  const categoryLabels = labels(row.categories);
  const rawLabels = labels(row.categories, row.keywords, row.industry);
  const industryLabels = rawLabels.map((label) => label.toLowerCase());
  const classification = classifyManufacturer({ industryLabels });
  const evidence = classification.evidence.map(({ kind, value }) => ({
    source: GETLEAD_SOURCE,
    kind,
    value,
  }));
  for (const category of categoryLabels) {
    if (GETLEAD_MANUFACTURING_CATEGORIES.has(category.toLowerCase())) {
      evidence.push({
        source: GETLEAD_SOURCE,
        kind: "industry_label",
        value: category,
      });
    }
  }
  return { isManufacturer: evidence.length > 0, evidence };
}

function foundedYear(value: unknown) {
  const match = text(value)?.match(/\b(\d{4})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

function normalizeCompany(args: {
  name: unknown;
  domain: unknown;
  country: unknown;
  city: unknown;
  region: unknown;
  postal: unknown;
  street: unknown;
  linkedinUrl: unknown;
  sizeBand: unknown;
  founded: unknown;
  status: unknown;
  categories: unknown;
  keywords: unknown;
  industry: unknown;
  payload: Record<string, unknown>;
}): NormalizedSourceRecord | null {
  const domain = normalizeDomain(text(args.domain));
  const name = text(args.name);
  if (!domain || !name) return null;
  const classification = manufacturerEvidence({
    categories: args.categories,
    keywords: args.keywords,
    industry: args.industry,
  });
  const categoryLabels = labels(args.categories, args.keywords, args.industry);
  return {
    source: GETLEAD_SOURCE,
    sourceRecordId: domain,
    name,
    nameNormalized: normalizeCompanyName(name),
    nameMatchable: true,
    domain,
    lei: null,
    country: normalizeCountry(text(args.country)),
    region: text(args.region),
    city: text(args.city),
    postalCode: text(args.postal),
    addressLine: text(args.street),
    legalIds: { getlead: domain },
    industryCodes: categoryLabels.length ? { labels: categoryLabels } : null,
    isManufacturer: classification.isManufacturer,
    manufacturerEvidence: classification.evidence,
    sizeBand: text(args.sizeBand),
    foundedYear: foundedYear(args.founded),
    linkedinUrl: text(args.linkedinUrl),
    website: `https://${domain}`,
    entityStatus: text(args.status),
    payload: args.payload as Prisma.InputJsonValue,
  };
}

export function normalizeGetleadCompany(row: GetleadCompanyRow): NormalizedSourceRecord | null {
  return normalizeCompany({
    name: row.name,
    domain: row.domain,
    country: row.country_code,
    city: row.city,
    region: row.region,
    postal: row.postal,
    street: row.street,
    linkedinUrl: row.linkedin_url,
    sizeBand: row.employee_band ?? row.employees,
    founded: row.founded,
    status: row.operating_status,
    categories: row.categories,
    keywords: row.keywords,
    industry: null,
    payload: row,
  });
}

export function normalizeGetleadContactCompany(row: GetleadContactRow): NormalizedSourceRecord | null {
  return normalizeCompany({
    name: row.company ?? row.company_name,
    domain: row.domain,
    country: row.country_code,
    city: row.locality,
    region: row.region,
    postal: null,
    street: null,
    linkedinUrl: row.company_linkedin_url,
    sizeBand: row.company_size ?? row.employees,
    founded: null,
    status: null,
    categories: row.company_categories,
    keywords: null,
    industry: row.company_industry ?? row.industry,
    payload: row,
  });
}
