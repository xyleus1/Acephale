import type { SupplyCompanyResearch } from "@/lib/supply-os-case-model";

export const MANUAL_SUPPLY_COMPANY_PROFILE_QUERY = "Manual profile supplied by tenant";
export const MANUAL_SUPPLY_COMPANY_PROFILE_WARNING =
  "Manually supplied by tenant. Not verified against public sources.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isClaim(value: unknown) {
  if (!isRecord(value)) return false;
  return typeof value.value === "string"
    && ["official", "public", "inferred"].includes(String(value.basis))
    && ["high", "medium", "low"].includes(String(value.confidence))
    && Array.isArray(value.sourceUrls)
    && value.sourceUrls.every((source) => typeof source === "string");
}

export function parseSupplyCompanyResearch(value: unknown): SupplyCompanyResearch | null {
  if (!isRecord(value) || !isRecord(value.company)) return null;
  const company = value.company;
  if (
    !["verified", "partial"].includes(String(value.status))
    || typeof value.query !== "string"
    || typeof value.researchedAt !== "string"
    || Number.isNaN(Date.parse(value.researchedAt))
    || !isClaim(company.name)
    || typeof company.website !== "string"
    || !isClaim(company.description)
    || !isClaim(company.industry)
    || !Array.isArray(company.locations)
    || !Array.isArray(company.products)
    || !Array.isArray(company.customerMarkets)
    || !Array.isArray(company.likelyInputs)
    || !Array.isArray(company.likelySourceRegions)
    || !Array.isArray(company.likelyDestinations)
    || !Array.isArray(value.findings)
    || !Array.isArray(value.evidence)
    || !Array.isArray(value.warnings)
  ) return null;
  return value as SupplyCompanyResearch;
}

function manualClaim(value: string) {
  return {
    value,
    basis: "inferred" as const,
    confidence: "low" as const,
    sourceUrls: [],
  };
}

export function toManualSupplyCompanyResearch(
  research: SupplyCompanyResearch,
  researchedAt = new Date().toISOString(),
): SupplyCompanyResearch {
  return {
    status: "partial",
    query: MANUAL_SUPPLY_COMPANY_PROFILE_QUERY,
    researchedAt,
    company: {
      name: manualClaim(research.company.name.value),
      website: research.company.website,
      logoUrl: null,
      description: manualClaim(research.company.description.value),
      industry: manualClaim(research.company.industry.value),
      headquarters: research.company.headquarters
        ? manualClaim(research.company.headquarters.value)
        : null,
      locations: research.company.locations.map((location) => ({
        ...manualClaim(location.value),
        role: location.role,
        coordinates: location.coordinates,
      })),
      products: research.company.products.map((product) => manualClaim(product.value)),
      customerMarkets: research.company.customerMarkets.map((market) => manualClaim(market.value)),
      likelyInputs: research.company.likelyInputs.map((input) => manualClaim(input.value)),
      likelySourceRegions: research.company.likelySourceRegions.map((region) => manualClaim(region.value)),
      likelyDestinations: research.company.likelyDestinations.map((destination) => manualClaim(destination.value)),
    },
    findings: [],
    evidence: [],
    warnings: [MANUAL_SUPPLY_COMPANY_PROFILE_WARNING],
  };
}

export function isManualSupplyCompanyResearch(research: SupplyCompanyResearch) {
  return research.query === MANUAL_SUPPLY_COMPANY_PROFILE_QUERY
    && research.warnings.includes(MANUAL_SUPPLY_COMPANY_PROFILE_WARNING);
}

export function normalizeCustomerWebsite(value: string | null | undefined) {
  const input = value?.trim();
  if (!input) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase();
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number) ?? null;
    const privateIpv4 = Boolean(ipv4 && (
      ipv4.some((part) => part > 255)
      || ipv4[0] === 10
      || ipv4[0] === 127
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168)
    ));
    const normalizedHost = host.replace(/^\[|\]$/g, "");
    const privateIpv6 = normalizedHost.includes(":") && (
      normalizedHost === "::1"
      || normalizedHost.startsWith("fc")
      || normalizedHost.startsWith("fd")
      || normalizedHost.startsWith("fe80:")
    );
    if (
      !["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
      || !host
      || host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || host.endsWith(".test")
      || host.endsWith(".invalid")
      || host.endsWith(".example")
      || privateIpv4
      || privateIpv6
    ) return null;
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    if (url.pathname === "") url.pathname = "/";
    return url.toString();
  } catch {
    return null;
  }
}

export function customerDomain(website: string) {
  return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
}
