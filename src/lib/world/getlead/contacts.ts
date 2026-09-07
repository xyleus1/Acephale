import { normalizeDomain } from "../normalize";
import type { PrismaClient } from "../../../generated/world-client";
import type { Prisma } from "../../../generated/world-client";
import { mergeSourceRecords } from "../merge";
import { normalizeGetleadContactCompany } from "../sources/getlead";
import type { GetleadContactRow } from "./client";

const FREEMAIL_FAMILIES = [
  "gmail",
  "yahoo",
  "hotmail",
  "outlook",
  "live",
  "icloud",
  "aol",
  "rediffmail",
  "163",
  "qq",
  "libero",
  "gmx",
  "web.de",
  "yandex",
  "mail.ru",
  "comcast",
  "telefonica",
  "tiscali",
  "wanadoo",
  "orange",
  "free.fr",
  "protonmail",
  "msn",
  "me.com",
  "btinternet",
  "sky.com",
  "virgin",
  "ymail",
  "googlemail",
] as const;

function emailParts(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 && at < normalized.length - 1
    ? { email: normalized, domain: normalized.slice(at + 1) }
    : { email: normalized, domain: "" };
}

export function classifyMailbox(email: string, companyDomain: string | null | undefined) {
  const { domain } = emailParts(email);
  const normalizedMailbox = normalizeDomain(domain) ?? domain;
  const normalizedCompany = companyDomain ? normalizeDomain(companyDomain) : null;
  if (normalizedCompany && normalizedMailbox === normalizedCompany) return "company" as const;
  const firstLabel = normalizedMailbox.split(".")[0] ?? "";
  if (FREEMAIL_FAMILIES.some((family) => normalizedMailbox === family || firstLabel === family)) {
    return "freemail" as const;
  }
  return "other_domain" as const;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function role(row: GetleadContactRow) {
  return [text(row.seniority), text(row.department)].filter(Boolean).join("/") || null;
}

function fullName(row: GetleadContactRow) {
  const value = text(row.full_name);
  if (value) return value;
  const fallback = [text(row.first), text(row.last)].filter(Boolean).join(" ");
  return fallback || null;
}

export async function ingestGetleadContacts(args: {
  client: PrismaClient;
  rows: GetleadContactRow[];
  jobId: string;
  loadRunId?: string;
  batchSize?: number;
}) {
  const candidates: Array<{
    row: GetleadContactRow;
    sourceRecordId: string;
    email: string;
    mailboxDomain: string;
  }> = [];
  let skipped = 0;

  for (const row of args.rows) {
    const email = text(row.email);
    const normalizedEmail = email ? emailParts(email).email : "";
    const mailboxDomain = email ? normalizeDomain(emailParts(email).domain) ?? emailParts(email).domain : "";
    const record = normalizeGetleadContactCompany(row);
    if (!normalizedEmail || !mailboxDomain || !record) {
      skipped += 1;
      continue;
    }
    const data = {
      ...record,
      loadRunId: args.loadRunId,
    };
    const sourceRecord = await args.client.worldSourceRecord.upsert({
      where: {
        source_sourceRecordId: {
          source: record.source,
          sourceRecordId: record.sourceRecordId,
        },
      },
      create: {
        source: data.source,
        sourceRecordId: data.sourceRecordId,
        loadRunId: data.loadRunId,
        name: data.name,
        nameNormalized: data.nameNormalized,
        nameMatchable: data.nameMatchable,
        domain: data.domain,
        lei: data.lei,
        country: data.country,
        region: data.region,
        city: data.city,
        postalCode: data.postalCode,
        addressLine: data.addressLine,
        legalIds: data.legalIds ?? undefined,
        industryCodes: data.industryCodes ?? undefined,
        isManufacturer: data.isManufacturer,
        manufacturerEvidence: data.manufacturerEvidence ?? undefined,
        sizeBand: data.sizeBand,
        foundedYear: data.foundedYear,
        linkedinUrl: data.linkedinUrl,
        website: data.website,
        entityStatus: data.entityStatus,
        payload: data.payload,
      },
      update: {
        loadRunId: data.loadRunId,
        name: data.name,
        nameNormalized: data.nameNormalized,
        nameMatchable: data.nameMatchable,
        domain: data.domain,
        country: data.country,
        region: data.region,
        city: data.city,
        postalCode: data.postalCode,
        addressLine: data.addressLine,
        legalIds: data.legalIds ?? undefined,
        industryCodes: data.industryCodes ?? undefined,
        isManufacturer: data.isManufacturer,
        manufacturerEvidence: data.manufacturerEvidence ?? undefined,
        sizeBand: data.sizeBand,
        foundedYear: data.foundedYear,
        linkedinUrl: data.linkedinUrl,
        website: data.website,
        entityStatus: data.entityStatus,
        payload: data.payload,
      },
    });
    candidates.push({ row, sourceRecordId: sourceRecord.sourceRecordId, email: normalizedEmail, mailboxDomain });
  }

  await mergeSourceRecords({
    client: args.client,
    source: "getlead",
    batchSize: args.batchSize ?? 2_000,
  });

  const companyIds = new Set<string>();
  let contactsCreated = 0;
  let contactsUpdated = 0;
  for (const candidate of candidates) {
    const sourceRecord = await args.client.worldSourceRecord.findUnique({
      where: {
        source_sourceRecordId: {
          source: "getlead",
          sourceRecordId: candidate.sourceRecordId,
        },
      },
      select: { companyId: true },
    });
    if (!sourceRecord?.companyId) {
      skipped += 1;
      continue;
    }
    companyIds.add(sourceRecord.companyId);
    const row = candidate.row;
    const contactData = {
      companyId: sourceRecord.companyId,
      email: candidate.email,
      emailStatus: "smtp_valid",
      fullName: fullName(row),
      title: text(row.title),
      role: role(row),
      source: "getlead",
      verifiedAt: dateValue(row.email_verified_at),
      sourceUpdatedAt: dateValue(row.source_updated),
      phone: text(row.phone),
      countryCode: text(row.country_code)?.toUpperCase() ?? null,
      mailboxDomain: candidate.mailboxDomain,
      payload: { ...row, jobId: args.jobId } as Prisma.InputJsonValue,
    };
    const existing = await args.client.worldContact.findFirst({
      where: {
        email: {
          equals: candidate.email,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    if (existing) {
      await args.client.worldContact.update({ where: { id: existing.id }, data: contactData });
      contactsUpdated += 1;
    } else {
      await args.client.worldContact.create({ data: contactData });
      contactsCreated += 1;
    }
  }

  return {
    companiesLinked: companyIds.size,
    contactsCreated,
    contactsUpdated,
    skipped,
  };
}
