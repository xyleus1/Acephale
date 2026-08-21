import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseMarketLane } from "@/lib/market-intelligence/lane-validation";

const DEFAULT_EVIDENCE_FRESH_DAYS = 180;

export type EvidenceSource = {
  url: string;
  title?: string;
  sourceType: "OFFICIAL" | "PUBLIC" | "QUOTE" | "AUTHORITY";
};

export type EvidenceEnvelope<T> = {
  value: T | null;
  state: "SUPPORTED" | "PARTIAL" | "INFERRED" | "UNKNOWN";
  confidence: number | null;
  sources: EvidenceSource[];
  observedAt: string | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type SupplierCandidateRole =
  | "MANUFACTURER"
  | "DISTRIBUTOR"
  | "PRODUCER"
  | "PROCESSOR"
  | "EXPORTER"
  | "TRADER"
  | "SERVICE_PROVIDER";
export type ProviderRole = "TRUCK_CARRIER" | "CUSTOMS_BROKER" | "FREIGHT_FORWARDER" | "OCEAN_CARRIER" | "AIR_CARRIER" | "THREE_PL";

export type SupplierCandidate = {
  id: string;
  officeId: string;
  workspaceId: string;
  componentItemKey: string;
  companyName: string;
  website: string | null;
  roles: SupplierCandidateRole[];
  country: EvidenceEnvelope<string>;
  facility: EvidenceEnvelope<string>;
  productCapability: EvidenceEnvelope<string>;
  price: EvidenceEnvelope<number>;
  currency: EvidenceEnvelope<string>;
  unitOfMeasure: EvidenceEnvelope<string>;
  minimumOrderQuantity: EvidenceEnvelope<number>;
  leadTimeDays: EvidenceEnvelope<number>;
  sourceUrls: string[];
  status: "UNSUPPORTED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  approvedByUserId: string | null;
  approvedAt: string | null;
  cautions: string[];
};

export type SupplierResearchResult = {
  candidates: SupplierCandidate[];
  sources: EvidenceSource[];
  degraded: boolean;
  warnings: string[];
};

export type SupplierResearchQueryProfile =
  | "MATERIAL_STOCK"
  | "BRANDED_COTS"
  | "GENERIC_COTS"
  | "CUSTOM_FABRICATION"
  | "CALIBRATED_INSTRUMENT"
  | "ASSEMBLY_SERVICE"
  | "PACKAGING"
  | "INSPECTION_SERVICE";

export type SupplierResearchQueryVariantId =
  | "exact-identity"
  | "official-catalog"
  | "capability-qa";

export type SupplierResearchQueryInput = {
  componentName: string;
  manufacturer?: string;
  mpn?: string;
  specification?: string;
  targetCountry?: string;
  sourceRegion?: string;
  deliveryLocation?: string;
  queryVariant?: string;
  queryCycle?: number;
  excludeDomains?: string[];
  requiredProvider?: "EXA" | "OPENAI";
};

export type SupplierResearchQueryVariant = {
  id: SupplierResearchQueryVariantId;
  query: string;
};

export type SupplierResearchQueryPlan = {
  profile: SupplierResearchQueryProfile;
  variants: SupplierResearchQueryVariant[];
};

export type ProviderCandidate = {
  id: string;
  officeId: string;
  workspaceId: string;
  role: ProviderRole;
  companyName: string;
  sourceUrls: string[];
  qualifications: Record<string, EvidenceEnvelope<string>>;
};

type RawCandidate = Record<string, unknown>;

function record(value: unknown): RawCandidate {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawCandidate : {};
}

function text(value: unknown, max = 1_000) {
  return typeof value === "string" ? value.replace(/\u2014/g, " - ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function supplierResearchQueryProfile(input: SupplierResearchQueryInput): SupplierResearchQueryProfile {
  const componentIdentity = text([
    input.componentName,
    input.manufacturer,
    input.mpn,
  ].filter(Boolean).join(" "), 1_000).toLowerCase();
  const productIdentity = text([
    input.componentName,
    input.manufacturer,
    input.mpn,
    input.specification,
  ].filter(Boolean).join(" "), 2_000).toLowerCase();
  if (/\b(first[- ]article inspection|inspection service|metrology service)\b/.test(componentIdentity)) {
    return "INSPECTION_SERVICE";
  }
  if (/\b(shipping protection|packaging|shipping case|antistatic bag|humidity indicator|transit case|custom foam)\b/.test(productIdentity)) {
    return "PACKAGING";
  }
  if (/\b(harness (?:assembl|assembled)|cable assembl|wire harness|build[- ]to[- ]print|pin[- ]to[- ]pin|continuity test)\b/.test(productIdentity)) {
    return "ASSEMBLY_SERVICE";
  }
  if (/\b(pt100|rtd|resistance temperature detector|strain gauges?|accelerometer|calibration certificate|calibrated sensor)\b/.test(productIdentity)) {
    return "CALIBRATED_INSTRUMENT";
  }
  if (/\b(printed circuit board|pcb carrier|machined enclosure|laser[- ]etched|nameplate|engraved plate)\b/.test(productIdentity)) {
    return "CUSTOM_FABRICATION";
  }
  if (
    text(input.manufacturer)
    || text(input.mpn)
    || /\b(3m|scotch[- ]weld|dowsil|dp\d{2,}|rtv\s*\d{3,})\b/.test(productIdentity)
  ) {
    return "BRANDED_COTS";
  }
  if (
    /\b(sheet|plate|angle|extrusion|laminate|bar stock|machining stock|cut[- ]to[- ]size|sawn blanks?)\b/.test(productIdentity)
    && /\b(aluminum|aluminium|steel|stainless|g10|fr-4|fr4|glass[- ]epoxy|metal)\b/.test(productIdentity)
  ) {
    return "MATERIAL_STOCK";
  }
  if (/\b(machined|machining|released drawing|fabricat|anodiz|custom[- ]made)\b/.test(productIdentity)) {
    return "CUSTOM_FABRICATION";
  }
  if (/\b(first[- ]article|as9102|metrology|measurement report|dimensional inspection|inspection service)\b/.test(productIdentity)) {
    return "INSPECTION_SERVICE";
  }
  return "GENERIC_COTS";
}

const QUERY_PROFILE_TERMS: Record<SupplierResearchQueryProfile, { roles: string; quality: string }> = {
  MATERIAL_STOCK: {
    roles: "manufacturer mill distributor service center stockist processor cut to size",
    quality: "material certificate lot traceability dimensional inspection",
  },
  BRANDED_COTS: {
    roles: "manufacturer official product authorized distributor catalog",
    quality: "certificate of conformance manufacturer datasheet lot traceability",
  },
  GENERIC_COTS: {
    roles: "manufacturer distributor official product catalog supplier",
    quality: "certificate of conformance manufacturer datasheet lot traceability",
  },
  CUSTOM_FABRICATION: {
    roles: "contract manufacturer machine shop fabricator CNC build to print",
    quality: "material certificate dimensional inspection certificate of conformance",
  },
  CALIBRATED_INSTRUMENT: {
    roles: "manufacturer distributor instrumentation supplier calibration laboratory",
    quality: "calibration certificate ISO 17025 serial number datasheet",
  },
  ASSEMBLY_SERVICE: {
    roles: "contract manufacturer harness assembler cable assembly build to print",
    quality: "continuity test pin to pin report insulation inspection",
  },
  PACKAGING: {
    roles: "industrial packaging supplier custom foam case manufacturer distributor",
    quality: "packaging compliance certificate material specification",
  },
  INSPECTION_SERVICE: {
    roles: "first article inspection service metrology dimensional inspection AS9102",
    quality: "signed measurement report nonconformance disposition calibration traceability",
  },
};

function boundedQuery(parts: Array<string | null | undefined>) {
  return text(parts.filter(Boolean).join(" "), 1_200);
}

function splitSupplierRequirement(value: string) {
  const marker = /(?:\.|\|)\s*Supplier (?:deliverable|QA):\s*/i.exec(value);
  if (!marker || marker.index === undefined) return { product: value.trim(), quality: "" };
  return {
    product: value.slice(0, marker.index).trim(),
    quality: value.slice(marker.index + marker[0].length).trim(),
  };
}

export function buildSupplierResearchQueryPlan(input: SupplierResearchQueryInput): SupplierResearchQueryPlan {
  const profile = supplierResearchQueryProfile(input);
  const terms = QUERY_PROFILE_TERMS[profile];
  const componentName = text(input.componentName, 240);
  const manufacturer = text(input.manufacturer, 180);
  const mpn = text(input.mpn, 180);
  const specification = splitSupplierRequirement(text(input.specification, 1_000));
  const geography = text(input.sourceRegion, 180).toLowerCase() === "any region"
    ? text(input.targetCountry, 120) || text(input.deliveryLocation, 240)
    : text(input.sourceRegion, 180) || text(input.targetCountry, 120) || text(input.deliveryLocation, 240);
  const queryCycle = Number.isInteger(input.queryCycle) && Number(input.queryCycle) >= 0 && Number(input.queryCycle) <= 2
    ? Number(input.queryCycle)
    : 0;
  const explorationTerms = [
    null,
    "regional supplier RFQ contact alternate source",
    "specialty supplier quality capability contract source",
  ][queryCycle];
  const excludedDomains = Array.isArray(input.excludeDomains)
    ? [...new Set(input.excludeDomains.flatMap((value) => {
      const normalized = text(value, 253).toLowerCase().replace(/^www\./, "");
      return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized) ? [normalized] : [];
    }))].slice(0, 8)
    : [];
  const exclusions = excludedDomains.length ? excludedDomains.map((domain) => `-site:${domain}`).join(" ") : null;
  const exactIdentity = boundedQuery([
    mpn,
    manufacturer,
    componentName,
    specification.product,
    terms.roles,
    explorationTerms,
    exclusions,
    geography ? `source region ${geography}` : null,
  ]);
  const officialCatalog = boundedQuery([
    mpn,
    manufacturer,
    componentName,
    specification.product,
    "official company product catalog datasheet request quote",
    terms.roles,
    explorationTerms,
    exclusions,
  ]);
  const capabilityQa = boundedQuery([
    componentName,
    specification.product,
    terms.roles,
    terms.quality,
    specification.quality ? `required supplier evidence ${specification.quality}` : null,
    explorationTerms,
    exclusions,
    geography ? `serving ${geography}` : null,
  ]);
  return {
    profile,
    variants: [
      { id: "exact-identity", query: exactIdentity },
      { id: "official-catalog", query: officialCatalog },
      { id: "capability-qa", query: capabilityQa },
    ],
  };
}

export function selectedSupplierResearchQueryVariant(input: SupplierResearchQueryInput) {
  const plan = buildSupplierResearchQueryPlan(input);
  const selected = input.queryVariant
    ? plan.variants.find((variant) => variant.id === input.queryVariant) ?? null
    : plan.variants[0] ?? null;
  return { plan, selected };
}

const COMMON_MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "com.au", "com.br", "com.cn", "com.mx", "co.jp", "co.kr", "co.nz", "co.za",
]);
const COMPANY_LEGAL_SUFFIXES = new Set([
  "co", "company", "corp", "corporation", "gmbh", "inc", "incorporated", "llc", "ltd", "limited", "plc", "sa",
]);
const COMPANY_CONNECTOR_WORDS = new Set(["and", "of", "the"]);
const GENERIC_COMPANY_DOMAIN_LABELS = new Set([
  "distribution", "distributor", "global", "group", "industrial", "industries", "manufacturer", "manufacturing",
  "solutions", "supplier", "supplies", "supply", "systems", "technologies", "technology",
]);
const COMPANY_DOMAIN_ALIASES = new Map<string, readonly string[]>([
  ["rscomponents", ["rsonline"]],
  ["hbk", ["hbkworld"]],
]);

function organizationDomainLabel(value: string) {
  const url = normalizeUrl(value);
  if (!url) return "";
  const parts = new URL(url).hostname.replace(/^www\./, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const suffix = parts.slice(-2).join(".");
  const label = COMMON_MULTI_LABEL_SUFFIXES.has(suffix) ? parts.at(-3) : parts.at(-2);
  return (label ?? "").replace(/[^a-z0-9]+/g, "");
}

export function supplierCompanyMatchesDomain(companyName: string, sourceUrl: string) {
  const domainLabel = organizationDomainLabel(sourceUrl);
  if (domainLabel.length < 2 || GENERIC_COMPANY_DOMAIN_LABELS.has(domainLabel)) return false;
  const companyTokens = text(companyName, 180).toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => (
    token.length >= 2 && !COMPANY_LEGAL_SUFFIXES.has(token) && !COMPANY_CONNECTOR_WORDS.has(token)
  )) ?? [];
  if (!companyTokens.length) return false;
  const companyDomainLabels = new Set<string>();
  let leadingPrefix = "";
  for (const token of companyTokens) {
    leadingPrefix += token;
    if (leadingPrefix.length >= 2) companyDomainLabels.add(leadingPrefix);
  }
  const firstTokenWithTailInitials = `${companyTokens[0]}${companyTokens.slice(1).map((token) => token[0]).join("")}`;
  if (firstTokenWithTailInitials.length >= 2) companyDomainLabels.add(firstTokenWithTailInitials);
  for (const alias of COMPANY_DOMAIN_ALIASES.get(companyTokens.join("")) ?? []) companyDomainLabels.add(alias);
  return companyDomainLabels.has(domainLabel);
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameDomain(left: string, right: string) {
  try {
    const a = new URL(left).hostname.replace(/^www\./, "").toLowerCase();
    const b = new URL(right).hostname.replace(/^www\./, "").toLowerCase();
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

function validObservedAt(value: unknown, now = new Date()) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + 5 * 60_000) return null;
  return date.toISOString();
}

export function evidenceFreshness(observedAt: string | null, now = new Date(), maxAgeDays = DEFAULT_EVIDENCE_FRESH_DAYS) {
  if (!observedAt) return "UNKNOWN" as const;
  const timestamp = new Date(observedAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000) return "UNKNOWN" as const;
  return now.getTime() - timestamp <= maxAgeDays * 86_400_000 ? "FRESH" as const : "STALE" as const;
}

function citedSources(value: unknown, allowed: Map<string, EvidenceSource>) {
  if (!Array.isArray(value)) return [];
  const urls = [...new Set(value.flatMap((entry) => {
    const url = normalizeUrl(entry);
    return url && allowed.has(url) ? [url] : [];
  }))];
  return urls.map((url) => allowed.get(url)!);
}

function envelope<T>(args: {
  raw: unknown;
  parse: (value: unknown) => T | null;
  allowed: Map<string, EvidenceSource>;
  now: Date;
  maxAgeDays?: number;
  trustClaimedObservedAt?: boolean;
}): EvidenceEnvelope<T> {
  const raw = record(args.raw);
  const value = args.parse(raw.value);
  const sources = citedSources(raw.sourceUrls, args.allowed);
  const requestedState = text(raw.state).toUpperCase();
  let state: EvidenceEnvelope<T>["state"] = ["SUPPORTED", "PARTIAL", "INFERRED", "UNKNOWN"].includes(requestedState)
    ? requestedState as EvidenceEnvelope<T>["state"]
    : value === null ? "UNKNOWN" : "PARTIAL";
  if (state === "SUPPORTED" && !sources.length) state = "PARTIAL";
  if (value === null) state = "UNKNOWN";
  const observedAt = args.trustClaimedObservedAt === false ? null : validObservedAt(raw.observedAt, args.now);
  const rawConfidence = typeof raw.confidence === "number" ? raw.confidence : null;
  const confidence = rawConfidence === null ? null : Math.max(0, Math.min(1, rawConfidence));
  return { value, state, confidence, sources, observedAt, freshness: evidenceFreshness(observedAt, args.now, args.maxAgeDays) };
}

const stringValue = (value: unknown) => text(value) || null;
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function slug(value: string, index: number) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized ? `${normalized}-${index + 1}` : `candidate-${index + 1}`;
}

function allowedSupplierRoles(componentItemKey: string): readonly SupplierCandidateRole[] {
  return componentItemKey.startsWith("request:")
    ? ["MANUFACTURER", "DISTRIBUTOR", "PRODUCER", "PROCESSOR", "EXPORTER", "TRADER", "SERVICE_PROVIDER"]
    : ["MANUFACTURER", "DISTRIBUTOR"];
}

export function normalizeSupplierResearch(args: {
  officeId: string;
  workspaceId: string;
  componentItemKey: string;
  raw: unknown;
  providerSources: EvidenceSource[];
  validatedSupplierLeadSourceUrls?: string[];
  now?: Date;
  trustClaimedObservedAt?: boolean;
}): SupplierResearchResult {
  const now = args.now ?? new Date();
  const allowed = new Map(args.providerSources.flatMap((source) => {
    const url = normalizeUrl(source.url);
    return url ? [[url, { ...source, url }] as const] : [];
  }));
  const raw = record(args.raw);
  const validatedSupplierLeadSources = new Set((args.validatedSupplierLeadSourceUrls ?? []).flatMap((value) => {
    const url = normalizeUrl(value);
    return url && allowed.has(url) ? [url] : [];
  }));
  const rows = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates = rows.flatMap((value, index) => {
    const candidate = record(value);
    const companyName = text(candidate.companyName, 180);
    const sourceUrls = citedSources(candidate.sourceUrls, allowed).map((source) => source.url);
    if (!companyName || !sourceUrls.length) return [];
    const requestedWebsite = normalizeUrl(candidate.website);
    const officialSources = sourceUrls.filter((url) => allowed.get(url)?.sourceType === "OFFICIAL");
    const validatedLeadSources = sourceUrls.filter((url) => validatedSupplierLeadSources.has(url));
    const identitySources = [...officialSources, ...validatedLeadSources];
    const website = requestedWebsite && identitySources.some((url) => sameDomain(url, requestedWebsite))
      ? requestedWebsite
      : officialSources[0] ?? (validatedLeadSources[0] ? new URL(validatedLeadSources[0]).origin : null);
    const allowedRoles = allowedSupplierRoles(args.componentItemKey);
    const roles = [...new Set((Array.isArray(candidate.roles) ? candidate.roles : [])
      .map((role) => text(role).toUpperCase())
      .filter((role): role is SupplierCandidateRole => allowedRoles.includes(role as SupplierCandidateRole)))].sort();
    const common = { allowed, now, trustClaimedObservedAt: args.trustClaimedObservedAt };
    const country = envelope({ raw: candidate.country, parse: stringValue, ...common });
    const facility = envelope({ raw: candidate.facility, parse: stringValue, ...common });
    const productCapability = envelope({ raw: candidate.productCapability, parse: stringValue, ...common });
    const price = envelope({ raw: candidate.price, parse: numberValue, ...common, maxAgeDays: 60 });
    const currency = envelope({ raw: candidate.currency, parse: stringValue, ...common, maxAgeDays: 60 });
    const unitOfMeasure = envelope({ raw: candidate.unitOfMeasure, parse: stringValue, ...common, maxAgeDays: 60 });
    const minimumOrderQuantity = envelope({ raw: candidate.minimumOrderQuantity, parse: numberValue, ...common, maxAgeDays: 60 });
    const leadTimeDays = envelope({ raw: candidate.leadTimeDays, parse: numberValue, ...common, maxAgeDays: 60 });
    const supported = Boolean(website && roles.length && productCapability.state === "SUPPORTED" && productCapability.sources.length);
    return [{
      id: slug(companyName, index),
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      componentItemKey: args.componentItemKey,
      companyName,
      website,
      roles,
      country,
      facility,
      productCapability,
      price,
      currency,
      unitOfMeasure,
      minimumOrderQuantity,
      leadTimeDays,
      sourceUrls,
      status: supported ? "REVIEW_REQUIRED" : "UNSUPPORTED",
      approvedByUserId: null,
      approvedAt: null,
      cautions: [...new Set((Array.isArray(candidate.cautions) ? candidate.cautions : []).map((item) => text(item, 400)).filter(Boolean))].sort(),
    } satisfies SupplierCandidate];
  }).sort((left, right) => left.companyName.localeCompare(right.companyName) || left.id.localeCompare(right.id));
  return {
    candidates,
    sources: [...allowed.values()].sort((left, right) => left.url.localeCompare(right.url)),
    degraded: allowed.size === 0 || candidates.length === 0,
    warnings: allowed.size === 0
      ? ["No attributable public sources were returned. No supplier candidates were accepted."]
      : candidates.length === 0
        ? ["No candidate survived source and identity filtering."]
        : [],
  };
}

export function approveSupplierCandidate(args: {
  candidate: SupplierCandidate;
  officeId: string;
  workspaceId: string;
  reviewerUserId: string;
  approvedAt?: Date;
}): SupplierCandidate {
  const candidate = args.candidate;
  if (candidate.officeId !== args.officeId || candidate.workspaceId !== args.workspaceId) {
    throw new Error("Supplier candidate is outside the active office or workspace.");
  }
  if (candidate.status !== "REVIEW_REQUIRED" || !candidate.website || !candidate.roles.length) {
    throw new Error("Unsupported supplier candidates cannot become approved suppliers.");
  }
  if (candidate.productCapability.state !== "SUPPORTED" || !candidate.productCapability.sources.length) {
    throw new Error("Supplier product capability lacks attributable evidence.");
  }
  if (candidate.productCapability.freshness === "STALE") {
    throw new Error("Supplier product capability evidence is stale and must be refreshed.");
  }
  return { ...candidate, status: "APPROVED", approvedByUserId: args.reviewerUserId, approvedAt: (args.approvedAt ?? new Date()).toISOString() };
}

const PROVIDER_REQUIREMENTS: Record<ProviderRole, readonly string[]> = {
  TRUCK_CARRIER: ["operating_authority", "insurance", "service_area"],
  CUSTOMS_BROKER: ["broker_license", "jurisdiction"],
  FREIGHT_FORWARDER: ["forwarder_authority", "mode_capability"],
  OCEAN_CARRIER: ["carrier_identity", "service_route"],
  AIR_CARRIER: ["carrier_identity", "service_route"],
  THREE_PL: ["legal_identity", "service_scope", "subcontractor_controls"],
};

export function qualifyProviderCandidate(candidate: ProviderCandidate) {
  const required = PROVIDER_REQUIREMENTS[candidate.role];
  const missing = required.filter((key) => {
    const evidence = candidate.qualifications[key];
    return !evidence || evidence.state !== "SUPPORTED" || !evidence.sources.length || evidence.freshness === "STALE";
  });
  return {
    status: missing.length ? "REVIEW_REQUIRED" as const : "EVIDENCE_COMPLETE" as const,
    missing,
    role: candidate.role,
  };
}

export type SupplyIntelligenceSignal = {
  id: string;
  kind: "CUSTOMS" | "TARIFF" | "CAPACITY" | "CONGESTION" | "DISRUPTION";
  affectedType: "COMPONENT" | "SUPPLIER_REGION" | "MOVEMENT";
  affectedKey: string;
  sourceUrl: string | null;
  observedAt: string | null;
};

export function filterRelevantSupplySignals(args: {
  signals: SupplyIntelligenceSignal[];
  componentKeys: Set<string>;
  supplierRegions: Set<string>;
  movementKeys: Set<string>;
}) {
  return args.signals.filter((signal) => {
    if (!normalizeUrl(signal.sourceUrl)) return false;
    if (signal.affectedType === "COMPONENT") return args.componentKeys.has(signal.affectedKey);
    if (signal.affectedType === "SUPPLIER_REGION") return args.supplierRegions.has(signal.affectedKey);
    if (!args.movementKeys.has(signal.affectedKey)) return false;
    if (signal.kind === "CUSTOMS" && !parseMarketLane(signal.affectedKey)) return false;
    return true;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const embedded = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) return privateAddress(embedded);
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0]! >= 224
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export async function assertPublicResearchUrl(value: string) {
  const normalized = normalizeUrl(value);
  if (!normalized) throw new Error("Research URL must be a public HTTP URL.");
  const url = new URL(normalized);
  if (isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("Research URL resolves to a private address.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("Research URL does not resolve exclusively to public addresses.");
  return url;
}

export function rejectsLoginOrPaywall(url: string, html: string) {
  const path = new URL(url).pathname.toLowerCase();
  const sample = html.slice(0, 100_000).toLowerCase();
  return /\b(login|sign[-_]?in|subscribe|paywall|account)\b/.test(path)
    || /(?:sign in to continue|subscribe to continue|subscriber-only|create an account to read|metered paywall)/i.test(sample);
}

export class ResearchRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {
    if (!Number.isInteger(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) throw new Error("Rate limit configuration is invalid.");
  }

  consume(key: string, now = Date.now()) {
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}
