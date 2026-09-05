import { classifyManufacturer } from "../manufacturing";
import { normalizeCompanyName } from "../normalize";
import type { NormalizedSourceRecord } from "../records";

export const COMPANIES_HOUSE_SOURCE = "companies_house";
export const downloadHint = "Companies House BasicCompanyDataAsOneFile: http://download.companieshouse.gov.uk/en_output.html";

function value(row: Record<string, string>, key: string) {
  return row[key]?.trim() || null;
}

function foundedYear(valueToParse: string | null) {
  const match = valueToParse?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? Number(match[3]) : null;
}

export function parseCompaniesHouseRow(row: Record<string, string>): NormalizedSourceRecord | null {
  const sourceRecordId = value(row, "CompanyNumber");
  const name = value(row, "CompanyName");
  if (!sourceRecordId || !name) return null;
  const ukSic = ["1", "2", "3", "4"]
    .map((index) => value(row, `SICCode.SicText_${index}`)?.match(/^\s*(\d{5})\b/)?.[1] ?? null)
    .filter((code): code is string => Boolean(code));
  const classification = classifyManufacturer({ ukSic });
  return {
    source: COMPANIES_HOUSE_SOURCE,
    sourceRecordId,
    name,
    nameNormalized: normalizeCompanyName(name),
    domain: null,
    lei: null,
    country: "GB",
    region: value(row, "RegAddress.County"),
    city: value(row, "RegAddress.PostTown"),
    postalCode: value(row, "RegAddress.PostCode"),
    addressLine: value(row, "RegAddress.AddressLine1"),
    legalIds: { companies_house: sourceRecordId },
    industryCodes: { uk_sic: ukSic },
    isManufacturer: classification.isManufacturer,
    manufacturerEvidence: classification.evidence,
    sizeBand: null,
    foundedYear: foundedYear(value(row, "IncorporationDate")),
    linkedinUrl: null,
    website: null,
    entityStatus: value(row, "CompanyStatus"),
    payload: row,
  };
}
