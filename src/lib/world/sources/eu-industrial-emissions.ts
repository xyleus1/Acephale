import { classifyManufacturer } from "../manufacturing";
import { normalizeCompanyName, normalizeCountry, normalizeDomain } from "../normalize";
import type { NormalizedSourceRecord } from "../records";

export const EU_INDUSTRIAL_EMISSIONS_SOURCE = "eu_industrial_emissions";
export const downloadHint = "EEA Industrial Reporting database tabular downloads: https://industry.eea.europa.eu/download";
export const aggregateKey = (record: NormalizedSourceRecord) => record.sourceRecordId;

function value(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const candidate = row[key]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function values(row: Record<string, string>, keys: string[]) {
  return keys
    .flatMap((key) => (row[key] ?? "").split(/[;,|]/))
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

function leadingCode(valueToCheck: string | null) {
  return valueToCheck?.match(/^\s*(\d+)/)?.[1] ?? null;
}

const MANUFACTURING_EPRTR_SECTORS = new Set(["2", "3", "4", "6", "8", "9"]);
const MANUFACTURING_IED_CHAPTERS = new Set(["2", "3", "4", "6"]);

export function parseEuIndustrialEmissionsRow(row: Record<string, string>): NormalizedSourceRecord | null {
  const sourceRecordId = value(row, [
    "FacilityInspireId",
    "facilityInspireId",
    "InstallationInspireId",
    "installationInspireId",
    "facilityId",
    "installationId",
    "id",
  ]);
  const name = value(row, ["facilityName", "FacilityName", "installationName", "name"]);
  if (!sourceRecordId || !name) return null;
  const nace = values(row, ["NACE", "NACECode", "naceCode", "nace"]);
  const activity = values(row, [
    "mainActivity",
    "MainActivity",
    "IEDAnnexIMainActivity",
    "EPRTRAnnexIMainActivity",
  ]);
  const eprtrActivity = value(row, ["EPRTRAnnexIMainActivity"]);
  const eprtrSectorCode = leadingCode(value(row, ["EPRTR_SectorCode"])) ?? leadingCode(eprtrActivity);
  const eprtrSectorName = value(row, ["EPRTR_SectorName"]);
  const iedActivity = value(row, ["IEDAnnexIMainActivity"]);
  const classification = classifyManufacturer({
    nace,
  });
  const manufacturerEvidence = classification.evidence.map(({ value: evidenceValue }) => ({
    source: EU_INDUSTRIAL_EMISSIONS_SOURCE,
    kind: "activity",
    value: evidenceValue,
  }));
  if (eprtrSectorCode && MANUFACTURING_EPRTR_SECTORS.has(eprtrSectorCode)) {
    manufacturerEvidence.push({
      source: EU_INDUSTRIAL_EMISSIONS_SOURCE,
      kind: "eprtr_sector",
      value: [eprtrSectorCode, eprtrSectorName].filter(Boolean).join(" "),
    });
  }
  if (iedActivity) {
    const iedChapter = leadingCode(iedActivity);
    if (iedChapter && MANUFACTURING_IED_CHAPTERS.has(iedChapter)) {
      manufacturerEvidence.push({
        source: EU_INDUSTRIAL_EMISSIONS_SOURCE,
        kind: "ied_activity",
        value: iedActivity,
      });
    }
  }
  const website = value(row, ["website", "Website", "facilityWebsite"]);
  const industryCodes = {
    nace,
    activity,
    eprtr_sector: eprtrSectorCode ? [eprtrSectorCode] : [],
  };
  return {
    source: EU_INDUSTRIAL_EMISSIONS_SOURCE,
    sourceRecordId,
    name,
    nameNormalized: normalizeCompanyName(name),
    nameMatchable: false,
    domain: website ? normalizeDomain(website) : null,
    lei: null,
    country: normalizeCountry(value(row, ["countryCode", "CountryCode", "countryName", "CountryName"])),
    region: value(row, ["region", "Region"]),
    city: value(row, ["city", "City", "City_of_Facility"]),
    postalCode: value(row, ["postal", "postalCode", "PostalCode", "postcode"]),
    addressLine: value(row, ["street", "Street", "address", "Address"]),
    legalIds: { eu_industrial_emissions: sourceRecordId },
    industryCodes,
    isManufacturer: classification.isManufacturer || manufacturerEvidence.length > 0,
    manufacturerEvidence,
    sizeBand: null,
    foundedYear: null,
    linkedinUrl: null,
    website,
    entityStatus: value(row, ["installationStatus", "facilityStatus", "status"]),
    payload: row,
  };
}
