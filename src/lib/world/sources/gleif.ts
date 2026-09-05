import { normalizeCompanyName, normalizeCountry } from "../normalize";
import type { NormalizedSourceRecord } from "../records";

export const GLEIF_SOURCE = "gleif";
export const downloadHint = "Latest GLEIF file list: https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest";

function value(row: Record<string, string>, key: string) {
  return row[key]?.trim() || null;
}

export function parseGleifRow(row: Record<string, string>): NormalizedSourceRecord | null {
  const lei = value(row, "LEI");
  const name = value(row, "Entity.LegalName");
  if (!lei || !name) return null;
  const registrationStatus = value(row, "Registration.RegistrationStatus");
  const entityStatus = value(row, "Entity.EntityStatus");
  return {
    source: GLEIF_SOURCE,
    sourceRecordId: lei,
    name,
    nameNormalized: normalizeCompanyName(name),
    domain: null,
    lei,
    country: normalizeCountry(value(row, "Entity.LegalAddress.Country")),
    region: value(row, "Entity.LegalAddress.Region"),
    city: value(row, "Entity.LegalAddress.City"),
    postalCode: value(row, "Entity.LegalAddress.PostalCode"),
    addressLine: value(row, "Entity.LegalAddress.FirstAddressLine"),
    legalIds: { lei },
    industryCodes: null,
    isManufacturer: false,
    manufacturerEvidence: null,
    sizeBand: null,
    foundedYear: null,
    linkedinUrl: null,
    website: null,
    entityStatus: [entityStatus, registrationStatus].filter(Boolean).join("/") || null,
    payload: row,
  };
}

export function extractGleifLatestCsvUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const fullFile = (first as { full_file?: unknown }).full_file;
  if (!fullFile || typeof fullFile !== "object") return null;
  const url = (fullFile as { csv?: unknown }).csv;
  if (!url || typeof url !== "object") return null;
  const value = (url as { url?: unknown }).url;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function resolveGleifLatestCsvUrl() {
  const response = await fetch("https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest");
  if (!response.ok) throw new Error(`GLEIF latest file lookup failed with HTTP ${response.status}`);
  return extractGleifLatestCsvUrl(await response.json());
}
