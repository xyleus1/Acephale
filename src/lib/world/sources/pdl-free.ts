import { classifyManufacturer } from "../manufacturing";
import { normalizeCompanyName, normalizeCountry, normalizeDomain } from "../normalize";
import type { NormalizedSourceRecord } from "../records";
import type { Prisma } from "../../../generated/world-client";

export const PDL_FREE_SOURCE = "pdl_free";
export const downloadHint = "People Data Labs free company dataset: https://www.peopledatalabs.com/free-dataset";

function value(row: Record<string, unknown>, key: string) {
  const raw = row[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string") return raw.trim() || null;
  return null;
}

export function parsePdlFreeRow(row: Record<string, unknown>): NormalizedSourceRecord | null {
  const sourceRecordId = value(row, "id");
  const name = value(row, "name");
  if (!sourceRecordId || !name) return null;
  const industry = value(row, "industry");
  const classification = classifyManufacturer({ industryLabels: industry ? [industry] : [] });
  const founded = Number.parseInt(value(row, "founded") ?? "", 10);
  return {
    source: PDL_FREE_SOURCE,
    sourceRecordId,
    name,
    nameNormalized: normalizeCompanyName(name),
    domain: normalizeDomain(value(row, "website")),
    lei: null,
    country: normalizeCountry(value(row, "country")),
    region: value(row, "region"),
    city: value(row, "locality"),
    postalCode: null,
    addressLine: null,
    legalIds: { pdl_id: sourceRecordId },
    industryCodes: industry ? { labels: [industry] } : null,
    isManufacturer: classification.isManufacturer,
    manufacturerEvidence: classification.evidence,
    sizeBand: value(row, "size"),
    foundedYear: Number.isFinite(founded) ? founded : null,
    linkedinUrl: value(row, "linkedin_url"),
    website: value(row, "website"),
    entityStatus: null,
    payload: row as Prisma.InputJsonValue,
  };
}
