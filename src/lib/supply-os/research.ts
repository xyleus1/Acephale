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
  | "TRADER";
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
    ? ["MANUFACTURER", "DISTRIBUTOR", "PRODUCER", "PROCESSOR", "EXPORTER", "TRADER"]
    : ["MANUFACTURER", "DISTRIBUTOR"];
}

export function normalizeSupplierResearch(args: {
  officeId: string;
  workspaceId: string;
  componentItemKey: string;
  raw: unknown;
  providerSources: EvidenceSource[];
  now?: Date;
  trustClaimedObservedAt?: boolean;
}): SupplierResearchResult {
  const now = args.now ?? new Date();
  const allowed = new Map(args.providerSources.flatMap((source) => {
    const url = normalizeUrl(source.url);
    return url ? [[url, { ...source, url }] as const] : [];
  }));
  const raw = record(args.raw);
  const rows = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates = rows.flatMap((value, index) => {
    const candidate = record(value);
    const companyName = text(candidate.companyName, 180);
    const sourceUrls = citedSources(candidate.sourceUrls, allowed).map((source) => source.url);
    if (!companyName || !sourceUrls.length) return [];
    const requestedWebsite = normalizeUrl(candidate.website);
    const officialSources = sourceUrls.filter((url) => allowed.get(url)?.sourceType === "OFFICIAL");
    const website = requestedWebsite && officialSources.some((url) => sameDomain(url, requestedWebsite)) ? requestedWebsite : officialSources[0] ?? null;
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
