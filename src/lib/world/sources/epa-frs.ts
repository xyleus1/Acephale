import { classifyManufacturer } from "../manufacturing";
import { normalizeCompanyName } from "../normalize";
import type { NormalizedSourceRecord } from "../records";

export const EPA_FRS_SOURCE = "epa_frs";
export const downloadHint = "EPA Facility Registry Service state and national single-file CSV downloads: https://www.epa.gov/frs/epa-frs-facilities-state-single-file-csv-download";

function value(row: Record<string, string>, key: string) {
  return row[key]?.trim() || null;
}

function codes(row: Record<string, string>, key: string) {
  return (value(row, key) ?? "")
    .split(/[;,|]/)
    .map((code) => code.trim())
    .filter(Boolean);
}

export function parseEpaFrsRow(row: Record<string, string>): NormalizedSourceRecord | null {
  const sourceRecordId = value(row, "REGISTRY_ID");
  const name = value(row, "PRIMARY_NAME");
  if (!sourceRecordId || !name) return null;
  const naics = codes(row, "NAICS_CODES");
  const sic = codes(row, "SIC_CODES");
  const classification = classifyManufacturer({ naics, sic });
  const manufacturerEvidence = classification.evidence.map(({ kind, value: evidenceValue }) => ({
    source: EPA_FRS_SOURCE,
    kind,
    value: evidenceValue,
  }));
  return {
    source: EPA_FRS_SOURCE,
    sourceRecordId,
    name,
    nameNormalized: normalizeCompanyName(name),
    nameMatchable: false,
    domain: null,
    lei: null,
    country: "US",
    region: value(row, "STATE_CODE"),
    city: value(row, "CITY_NAME"),
    postalCode: value(row, "POSTAL_CODE"),
    addressLine: value(row, "LOCATION_ADDRESS"),
    legalIds: { epa_frs: sourceRecordId },
    industryCodes: { naics, sic },
    isManufacturer: classification.isManufacturer,
    manufacturerEvidence,
    sizeBand: null,
    foundedYear: null,
    linkedinUrl: null,
    website: null,
    entityStatus: null,
    payload: row,
  };
}
