import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import type { EvidenceSource, SupplierCandidate, SupplierResearchResult } from "./research";
import type { SupplyAccessContext } from "./persistence";
import {
  parseStoredSupplierResearchRetrievalCapture,
  validatePublicSupplierLeadReceipts,
  type SupplierLeadValidationInput,
} from "./exa-supplier-research";
import {
  GUILD_SOURCING_LINES,
  type GuildSourcingClassification,
  type GuildSourcingLine,
} from "./guild-sourcing-items";

export const GUILD_SUPPLIER_CAMPAIGN_KEY = "guild-procurement" as const;
export const GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM = 3;
export const GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM = 5;
export const GUILD_SUPPLIER_CAMPAIGN_QUEUE_BATCH = 6;
export const GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP = 48;
export const SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP = 72;
export const GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE = 9;
export const GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS = 12;
export const GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE = "2026-09-30";
export const GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION = "Austin, TX, United States";
export const GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS = [
  "exact-identity",
  "official-catalog",
  "capability-qa",
] as const;

const CAMPAIGN_CAPABILITY_KEY = "research.supplier_campaign";
const RESEARCH_CAPABILITY_KEY = "research.supplier_candidates";
const CAMPAIGN_DSL_NAME = "guild_continuous_supplier_research";
const ATTEMPT_DSL_NAME = "queued_supplier_research_child";
const AGGREGATE_DSL_NAME = "guild_supplier_research_aggregate";
const CAMPAIGN_SCOPE_VERSION = 3;
const CAMPAIGN_RECONCILIATION_LEASE_MS = 2 * 60_000;
const RETRYABLE_FAILURE_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_FAILURE",
  "INVALID_STRUCTURED_RESPONSE",
  "PERSISTENCE_FAILURE",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "WORKER_INTERRUPTED",
]);
const OPERATOR_BLOCKING_FAILURE_CODES = new Set(["MISSING_CONFIGURATION", "PROVIDER_AUTHENTICATION_FAILED", "ACCESS_REVOKED"]);

type JsonRecord = Record<string, unknown>;

export type SupplierResearchProvider = "EXA" | "OPENAI";

export function configuredSupplierResearchProvider(
  environment: { EXA_API_KEY?: string; OPENAI_API_KEY?: string } = {
    EXA_API_KEY: process.env.EXA_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
): SupplierResearchProvider | null {
  if (environment.EXA_API_KEY?.trim()) return "EXA";
  if (environment.OPENAI_API_KEY?.trim()) return "OPENAI";
  return null;
}

export function supplierResearchProviderFromInput(value: unknown): SupplierResearchProvider | null {
  const provider = record(value).requiredProvider;
  return provider === "EXA" || provider === "OPENAI" ? provider : null;
}

export type SupplierResearchCampaignRequest = {
  campaignKey?: typeof GUILD_SUPPLIER_CAMPAIGN_KEY;
};

export type SupplierResearchCampaignAttempt = {
  id: string;
  status: string;
  input: unknown;
  output: unknown;
  error: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
  failedAt?: Date | string | null;
};

export type SupplierResearchCampaignAggregateRun = {
  id: string;
  status: "SUCCEEDED";
  input: SupplierResearchAggregateInput;
  output: SupplierResearchResult;
  error: null;
  createdAt: string;
  completedAt: string;
  failedAt: null;
  updatedAt: string;
};

export type SupplierResearchAggregateInput = {
  componentItemKey: string;
  componentName: string;
  manufacturer: null;
  mpn: null;
  specification: string;
  targetCountry: string | null;
  requestText: string;
  requestedQuantity: number;
  requestedUnit: string;
  sourceRegion: string | null;
  deliveryLocation: string;
  needByDate: string;
  campaignId: string;
  campaignKey: typeof GUILD_SUPPLIER_CAMPAIGN_KEY;
  campaignItemKey: string;
  campaignArtifactKind: "AGGREGATE";
  campaignAttemptCount: number;
  campaignTerminalAttemptCount: number;
  campaignAttemptWatermark: string;
  requiredProvider: SupplierResearchProvider;
};

export type SupplierResearchCampaignItemState =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "RETRY_WAIT"
  | "COMPLETE"
  | "BLOCKED"
  | "CLARIFICATION_REQUIRED"
  | "REQUIREMENT_ONLY";

export type SupplierResearchCampaignItem = {
  componentItemKey: string;
  lineNumber: string;
  name: string;
  classification: GuildSourcingClassification;
  state: SupplierResearchCampaignItemState;
  leadCount: number;
  attemptCount: number;
  activeRunId: string | null;
  aggregateRunId: string | null;
  aggregateRun: SupplierResearchCampaignAggregateRun | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  blocker: string | null;
  targetMinimum: number;
  retainedMaximum: number;
};

export type SupplierResearchCampaignStatus = {
  id: string;
  campaignKey: typeof GUILD_SUPPLIER_CAMPAIGN_KEY;
  workspaceId: string;
  status: string;
  state: "RUNNING" | "RETRY_WAIT" | "DAILY_CAP" | "COMPLETE" | "FAILED";
  blocker: string | null;
  targetMinimum: number;
  retainedMaximum: number;
  totalLines: 40;
  searchableLines: 38;
  completedLines: number;
  leadCount: number;
  progressPercent: number;
  queuedAttempts: number;
  runningAttempts: number;
  retryWaitingLines: number;
  totals: {
    items: 40;
    supplierSearchable: 38;
    targetMet: number;
    needsClarification: 1;
    requirementOnly: 1;
    queued: number;
    running: number;
    backingOff: number;
  };
  daily: {
    campaignAttemptsUsed: number;
    campaignAttemptCap: number;
    officeAttemptsUsed: number;
    officeAttemptCap: number;
  };
  items: SupplierResearchCampaignItem[];
  retryAfterMs: number;
  updatedAt: string;
};

export type SupplierResearchCampaignResponse = {
  campaign: SupplierResearchCampaignStatus;
  queued: number;
  reused: boolean;
};

export type SupplierResearchCampaignStatusResponse = {
  campaign: SupplierResearchCampaignStatus | null;
};

export type SupplierResearchCampaignQueuePlan = {
  itemKey: string;
  attemptNumber: number;
  queryVariant: (typeof GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS)[number];
  input: Prisma.InputJsonObject;
};

type PersistedAggregate = SupplierResearchCampaignAggregateRun & {
  inputHash?: string;
  outputHash?: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type CampaignReconciliationLease = {
  token: string;
  expiresAt: string;
};

function reconciliationLease(value: unknown): CampaignReconciliationLease | null {
  const lease = record(record(value).reconciliationLease);
  return typeof lease.token === "string" && typeof lease.expiresAt === "string"
    ? { token: lease.token, expiresAt: lease.expiresAt }
    : null;
}

function hasReconciliationLease(value: unknown, token: string) {
  return reconciliationLease(value)?.token === token;
}

export function shouldPersistGuildSupplierResearchAggregate(args: {
  latestAttemptCount: number;
  latestTerminalAttemptCount: number;
  latestOutputHash: string | null;
  incomingAttemptCount: number;
  incomingTerminalAttemptCount: number;
  incomingOutputHash: string;
}) {
  if (args.latestAttemptCount > args.incomingAttemptCount) return false;
  if (
    args.latestAttemptCount === args.incomingAttemptCount
    && args.latestTerminalAttemptCount > args.incomingTerminalAttemptCount
  ) return false;
  return args.latestOutputHash !== args.incomingOutputHash;
}

function guildSupplierResearchCampaignScope(requiredProvider: SupplierResearchProvider) {
  return {
    scopeVersion: CAMPAIGN_SCOPE_VERSION,
    campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
    requiredProvider,
    targetMinimum: GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
    retainedMaximum: GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
    needByDate: GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
    deliveryLocation: GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
    lines: GUILD_SOURCING_LINES.map((line) => ({
      item: line.item,
      sku: line.sku,
      name: line.name,
      classification: line.classification,
      specification: line.specification,
      quantity: line.quantity,
      unit: line.unit,
      requirement: line.requirement,
      deliverable: line.deliverable,
    })),
  };
}

export function guildSupplierResearchCampaignRevision(requiredProvider: SupplierResearchProvider = "EXA") {
  return digest(guildSupplierResearchCampaignScope(requiredProvider)).slice(0, 24);
}

export function guildSupplierResearchCampaignIdempotencyKey(requiredProvider: SupplierResearchProvider = "EXA") {
  return `supplier-campaign:${GUILD_SUPPLIER_CAMPAIGN_KEY}:${guildSupplierResearchCampaignRevision(requiredProvider)}`;
}

export function guildSupplierResearchCampaignGenerationKey(
  generation: number,
  requiredProvider: SupplierResearchProvider = "EXA",
) {
  return generation > 1
    ? `${guildSupplierResearchCampaignIdempotencyKey(requiredProvider)}:generation:${generation}`
    : guildSupplierResearchCampaignIdempotencyKey(requiredProvider);
}

export function campaignGenerationFromIdempotencyKey(
  value: string | null | undefined,
  requiredProvider: SupplierResearchProvider = "EXA",
) {
  if (!value) return null;
  const base = guildSupplierResearchCampaignIdempotencyKey(requiredProvider);
  if (value === base) return 1;
  const match = value.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:generation:(\\d+)$`));
  const generation = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(generation) && generation >= 2 ? generation : null;
}

function campaignIdentity(value: { input: unknown; idempotencyKey: string | null }) {
  const requiredProvider = supplierResearchProviderFromInput(value.input);
  if (!requiredProvider) return null;
  const generation = campaignGenerationFromIdempotencyKey(value.idempotencyKey, requiredProvider);
  return generation === null ? null : { requiredProvider, generation };
}

export function guildSupplierResearchCampaignScopeExpired(now = new Date()) {
  const expiresAt = new Date(`${GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE}T23:59:59.999Z`);
  return Number.isNaN(expiresAt.getTime()) || now.getTime() > expiresAt.getTime();
}

function publicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || isIP(hostname)) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function supplierCandidateDomain(value: unknown) {
  const website = publicUrl(record(value).website);
  if (!website) return null;
  return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
}

function domainsOverlap(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function normalizedCompanyIdentity(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
    : "";
}

function campaignItemKey(attempt: SupplierResearchCampaignAttempt) {
  const input = record(attempt.input);
  const explicit = typeof input.campaignItemKey === "string" ? input.campaignItemKey.trim().toUpperCase() : "";
  if (/^GUILD-\d{3}$/.test(explicit)) return explicit;
  const component = typeof input.componentItemKey === "string" ? input.componentItemKey.trim().toUpperCase() : "";
  const normalized = component.replace(/^REQUEST:/, "");
  return /^GUILD-\d{3}$/.test(normalized) ? normalized : null;
}

function candidateScore(value: unknown) {
  const candidate = record(value);
  const productCapability = record(candidate.productCapability);
  const sourceCount = Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.length : 0;
  const roleCount = Array.isArray(candidate.roles) ? candidate.roles.length : 0;
  return sourceCount * 3 + roleCount + (productCapability.state === "SUPPORTED" ? 20 : 0);
}

function normalizedCandidateId(line: GuildSourcingLine, domain: string) {
  const slug = domain.replace(/[^a-z0-9]+/g, "-").slice(0, 130);
  return `guild-${line.item}-${slug}-${digest(domain).slice(0, 10)}`;
}

function evidenceSource(value: unknown): EvidenceSource | null {
  const source = record(value);
  const url = publicUrl(source.url);
  if (!url) return null;
  const sourceType = source.sourceType;
  if (!["OFFICIAL", "PUBLIC", "QUOTE", "AUTHORITY"].includes(String(sourceType))) return null;
  return {
    url,
    ...(typeof source.title === "string" && source.title.trim() ? { title: source.title.trim().slice(0, 500) } : {}),
    sourceType: sourceType as EvidenceSource["sourceType"],
  };
}

export function aggregateGuildSupplierResearchLine(
  line: GuildSourcingLine,
  attempts: SupplierResearchCampaignAttempt[],
): SupplierResearchResult {
  const choices: Array<{ domain: string; candidate: SupplierCandidate; score: number }> = [];
  const sourceByUrl = new Map<string, EvidenceSource>();
  const warnings = new Set<string>();
  for (const attempt of attempts
    .filter((value) => campaignItemKey(value) === line.sku && value.status === "SUCCEEDED")
    .sort((left, right) => (asDate(left.createdAt)?.getTime() ?? 0) - (asDate(right.createdAt)?.getTime() ?? 0) || left.id.localeCompare(right.id))) {
    const output = record(attempt.output);
    const attemptInput = record(attempt.input);
    for (const sourceValue of Array.isArray(output.sources) ? output.sources : []) {
      const source = evidenceSource(sourceValue);
      if (source) sourceByUrl.set(source.url, { ...source, sourceType: "PUBLIC" });
    }
    for (const warning of Array.isArray(output.warnings) ? output.warnings : []) {
      if (typeof warning === "string" && warning.trim()) warnings.add(warning.trim().slice(0, 500));
    }
    const capture = parseStoredSupplierResearchRetrievalCapture(output.retrieval);
    const requiredProvider = supplierResearchProviderFromInput(attemptInput);
    if (!capture || capture.stage === "SEARCH_ONLY" || !requiredProvider || capture.provider !== requiredProvider) continue;
    const validatedReceipts = validatePublicSupplierLeadReceipts(
      attemptInput as unknown as SupplierLeadValidationInput,
      capture,
    );
    const validatedReceiptByCandidateId = new Map(validatedReceipts.flatMap((receipt) => {
      const stored = Array.isArray(output.publicSupplierLeadReceipts)
        ? output.publicSupplierLeadReceipts.map(record).find((candidate) => (
            candidate.receiptHash === receipt.receiptHash
            && candidate.sourceUrl === receipt.sourceUrl
            && candidate.itemKey === receipt.itemKey
            && candidate.provider === receipt.provider
            && candidate.freshnessPolicy === receipt.freshnessPolicy
          ))
        : null;
      return stored && typeof stored.candidateId === "string" ? [[stored.candidateId, receipt] as const] : [];
    }));
    for (const candidateValue of Array.isArray(output.candidates) ? output.candidates : []) {
      const raw = record(candidateValue);
      if (
        raw.status !== "REVIEW_REQUIRED"
        || typeof raw.companyName !== "string"
        || typeof raw.officeId !== "string"
        || !raw.officeId.trim()
        || typeof raw.workspaceId !== "string"
        || !raw.workspaceId.trim()
      ) continue;
      const rawCandidateId = typeof raw.id === "string" ? raw.id : "";
      const receipt = validatedReceiptByCandidateId.get(rawCandidateId);
      if (!receipt || receipt.itemKey !== attemptInput.componentItemKey) continue;
      if (normalizedCompanyIdentity(raw.companyName) !== normalizedCompanyIdentity(receipt.companyName)) continue;
      if (!Array.isArray(raw.roles) || !raw.roles.includes(receipt.role)) continue;
      const rawCapability = record(raw.productCapability);
      if (rawCapability.state !== "SUPPORTED" || rawCapability.value !== receipt.productCapability) continue;
      const domain = supplierCandidateDomain(raw);
      if (!domain || !domainsOverlap(domain, new URL(receipt.website).hostname.toLowerCase().replace(/^www\./, ""))) continue;
      const sourceUrls = [...new Set((Array.isArray(raw.sourceUrls) ? raw.sourceUrls : []).flatMap((value) => {
        const url = publicUrl(value);
        return url ? [url] : [];
      }))].sort();
      if (!sourceUrls.includes(receipt.sourceUrl) || !sourceByUrl.has(receipt.sourceUrl)) continue;
      const source = sourceByUrl.get(receipt.sourceUrl)!;
      const unknownEnvelope = {
        value: null,
        state: "UNKNOWN" as const,
        confidence: null,
        sources: [],
        observedAt: null,
        freshness: "UNKNOWN" as const,
      };
      const candidate = {
        id: normalizedCandidateId(line, domain),
        officeId: raw.officeId,
        workspaceId: raw.workspaceId,
        componentItemKey: line.sku,
        companyName: receipt.companyName,
        website: receipt.website,
        roles: [receipt.role],
        country: unknownEnvelope,
        facility: unknownEnvelope,
        productCapability: {
          value: receipt.productCapability,
          state: "SUPPORTED",
          confidence: 1,
          sources: [source],
          observedAt: receipt.retrievedAt,
          freshness: "UNKNOWN",
        },
        price: unknownEnvelope,
        currency: unknownEnvelope,
        unitOfMeasure: unknownEnvelope,
        minimumOrderQuantity: unknownEnvelope,
        leadTimeDays: unknownEnvelope,
        sourceUrls: [receipt.sourceUrl],
        status: "REVIEW_REQUIRED",
        approvedByUserId: null,
        approvedAt: null,
        cautions: ["Public-page supplier lead. Commercial terms require supplier confirmation."],
      } as SupplierCandidate;
      const score = candidateScore(candidate);
      const companyIdentity = normalizedCompanyIdentity(candidate.companyName);
      const existingIndex = choices.findIndex((choice) => (
        domainsOverlap(choice.domain, domain)
        || normalizedCompanyIdentity(choice.candidate.companyName) === companyIdentity
      ));
      if (existingIndex < 0) {
        choices.push({ domain, candidate, score });
      } else if (score > choices[existingIndex].score) {
        choices[existingIndex] = { domain, candidate, score };
      }
    }
  }
  const retained = choices
    .sort((left, right) => right.score - left.score || left.domain.localeCompare(right.domain))
    .slice(0, GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM);
  const sources = [...sourceByUrl.values()];
  const candidates = retained.map((choice) => choice.candidate);
  return {
    candidates,
    sources: sources.sort((left, right) => left.url.localeCompare(right.url)),
    degraded: candidates.length < GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
    warnings: [...warnings].sort(),
  };
}

function deterministicJitterMs(itemKey: string, attemptCount: number, baseMs: number) {
  const hash = createHash("sha256").update(`${itemKey}:${attemptCount}`).digest();
  return Math.floor((hash.readUInt16BE(0) / 65_535) * Math.min(5 * 60_000, baseMs * 0.05));
}

export function campaignRetryDelayMs(itemKey: string, completedAttemptCount: number) {
  const base = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];
  const selected = base[Math.min(base.length - 1, Math.max(0, completedAttemptCount - 1))];
  return Math.min(24 * 60 * 60_000, selected + deterministicJitterMs(itemKey, completedAttemptCount, selected));
}

function lastFailureCode(attempt: SupplierResearchCampaignAttempt | undefined) {
  if (!attempt || attempt.status !== "FAILED") return null;
  const message = typeof record(attempt.error).message === "string" ? String(record(attempt.error).message) : "";
  return message.match(/^([A-Z][A-Z0-9_]+):/)?.[1] ?? "UNCLASSIFIED_FAILURE";
}

function lineAttempts(line: GuildSourcingLine, attempts: SupplierResearchCampaignAttempt[]) {
  return attempts
    .filter((attempt) => campaignItemKey(attempt) === line.sku)
    .sort((left, right) => (asDate(left.createdAt)?.getTime() ?? 0) - (asDate(right.createdAt)?.getTime() ?? 0) || left.id.localeCompare(right.id));
}

function terminalAttemptTime(attempt: SupplierResearchCampaignAttempt | undefined) {
  return attempt
    ? (asDate(attempt.completedAt) ?? asDate(attempt.failedAt) ?? asDate(attempt.updatedAt))?.getTime() ?? 0
    : 0;
}

function latestSuccessfulAttemptTime(attempts: SupplierResearchCampaignAttempt[]) {
  return attempts.reduce((latest, attempt) => attempt.status === "SUCCEEDED"
    ? Math.max(latest, terminalAttemptTime(attempt))
    : latest, 0);
}

function nextAttemptDate(line: GuildSourcingLine, attempts: SupplierResearchCampaignAttempt[]) {
  const terminal = attempts.filter((attempt) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status));
  const last = terminal.at(-1);
  const completedAt = last ? asDate(last.completedAt) ?? asDate(last.failedAt) ?? asDate(last.updatedAt) : null;
  if (!completedAt || !last) return null;
  return new Date(completedAt.getTime() + campaignRetryDelayMs(line.sku, terminal.length));
}

export function guildSupplierResearchAttemptInput(args: {
  line: GuildSourcingLine;
  campaignId: string;
  attemptNumber: number;
  requiredProvider: SupplierResearchProvider;
  excludeDomains?: string[];
}) {
  const queryVariant = GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS[(args.attemptNumber - 1) % GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS.length];
  const excludeDomains = [...new Set((args.excludeDomains ?? []).flatMap((value) => {
    const normalized = value.trim().toLowerCase().replace(/^www\./, "");
    return normalized && !isIP(normalized) && /^[a-z0-9.-]+$/.test(normalized) ? [normalized] : [];
  }))].slice(0, 8);
  return {
    componentItemKey: `request:${args.line.sku.toLowerCase()}`,
    componentName: args.line.name,
    manufacturer: null,
    mpn: null,
    specification: `${args.line.specification}. Supplier QA: ${args.line.deliverable}.`,
    targetCountry: "United States",
    requestText: `${args.line.requirement} of ${args.line.name}. ${args.line.specification}. Supplier QA: ${args.line.deliverable}.`,
    requestedQuantity: args.line.quantity,
    requestedUnit: args.line.unit,
    sourceRegion: "Any region",
    deliveryLocation: GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
    needByDate: GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
    campaignId: args.campaignId,
    campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
    campaignItemKey: args.line.sku,
    queryVariant,
    queryVariantIndex: (args.attemptNumber - 1) % GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS.length,
    queryCycle: Math.min(2, Math.floor((args.attemptNumber - 1) / GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS.length)),
    excludeDomains,
    requiredProvider: args.requiredProvider,
    attemptNumber: args.attemptNumber,
  } satisfies Prisma.InputJsonObject;
}

export function planGuildSupplierResearchQueue(args: {
  campaignId: string;
  requiredProvider: SupplierResearchProvider;
  attempts: SupplierResearchCampaignAttempt[];
  aggregates?: PersistedAggregate[];
  now?: Date;
  campaignAttemptsRemaining: number;
  officeAttemptsRemaining: number;
  batchSize?: number;
  allowTerminalRetry?: boolean;
}): SupplierResearchCampaignQueuePlan[] {
  const now = args.now ?? new Date();
  const latestAggregates = latestAggregatesByItem(args.aggregates ?? []);
  const candidates = GUILD_SOURCING_LINES.flatMap((line) => {
    if (line.classification !== "SUPPLIER_SEARCH" || line.quantity === null || line.unit === null) return [];
    const attempts = lineAttempts(line, args.attempts);
    const aggregate = aggregateGuildSupplierResearchLine(line, attempts);
    const persistedAggregate = latestAggregates.get(line.sku) ?? null;
    const persistedOutput = persistedAggregate?.output ?? aggregate;
    if (persistedOutput.candidates.length >= GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM) return [];
    if (attempts.some((attempt) => ["QUEUED", "RUNNING"].includes(attempt.status))) return [];
    const terminalAttempts = attempts.filter((attempt) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status));
    const last = terminalAttempts.at(-1);
    const failureCode = lastFailureCode(last);
    const currentOperatorBlock = Boolean(failureCode
      && OPERATOR_BLOCKING_FAILURE_CODES.has(failureCode)
      && terminalAttemptTime(last) >= latestSuccessfulAttemptTime(attempts));
    if (currentOperatorBlock && !args.allowTerminalRetry) return [];
    if (
      failureCode
      && !RETRYABLE_FAILURE_CODES.has(failureCode)
      && !OPERATOR_BLOCKING_FAILURE_CODES.has(failureCode)
    ) return [];
    if (last?.status === "CANCELLED" && !args.allowTerminalRetry) return [];
    if (terminalAttempts.length >= GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE) return [];
    const dueAt = nextAttemptDate(line, attempts);
    const terminalRetry = currentOperatorBlock || last?.status === "CANCELLED";
    if (dueAt && dueAt.getTime() > now.getTime() && !(args.allowTerminalRetry && terminalRetry)) return [];
    const attemptNumber = attempts.length + 1;
    const input = guildSupplierResearchAttemptInput({
      line,
      campaignId: args.campaignId,
      attemptNumber,
      requiredProvider: args.requiredProvider,
      excludeDomains: persistedOutput.candidates.flatMap((candidate) => {
        const domain = supplierCandidateDomain(candidate);
        return domain ? [domain] : [];
      }),
    });
    return [{
      line,
      terminalRetry,
      lastAttemptAt: asDate(attempts.at(-1)?.createdAt),
      attemptNumber,
      queryVariant: input.queryVariant,
      input,
    }];
  });
  const limit = Math.max(0, Math.min(
    Math.trunc(args.batchSize ?? GUILD_SUPPLIER_CAMPAIGN_QUEUE_BATCH),
    Math.trunc(args.campaignAttemptsRemaining),
    Math.trunc(args.officeAttemptsRemaining),
  ));
  return candidates
    .sort((left, right) => Number(right.terminalRetry) - Number(left.terminalRetry)
      || left.attemptNumber - right.attemptNumber
      || (left.lastAttemptAt?.getTime() ?? 0) - (right.lastAttemptAt?.getTime() ?? 0)
      || left.line.item.localeCompare(right.line.item))
    .slice(0, limit)
    .map(({ line, attemptNumber, queryVariant, input }) => ({ itemKey: line.sku, attemptNumber, queryVariant, input }));
}

function aggregateAttemptWatermark(
  line: GuildSourcingLine,
  attempts: SupplierResearchCampaignAttempt[],
) {
  const relevant = lineAttempts(line, attempts);
  const terminal = relevant.filter((attempt) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status));
  return {
    attemptCount: relevant.length,
    terminalAttemptCount: terminal.length,
    watermark: digest(relevant.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      updatedAt: asDate(attempt.updatedAt)?.toISOString() ?? null,
      terminalAt: terminalAttemptTime(attempt),
    }))),
  };
}

function aggregateInput(
  line: GuildSourcingLine,
  campaignId: string,
  requiredProvider: SupplierResearchProvider,
  attemptWatermark: ReturnType<typeof aggregateAttemptWatermark>,
): SupplierResearchAggregateInput {
  if (line.quantity === null || line.unit === null) throw new Error("A supplier-searchable GUILD line requires quantity and unit.");
  return {
    componentItemKey: line.sku,
    componentName: line.name,
    manufacturer: null,
    mpn: null,
    specification: `${line.specification}. Supplier QA: ${line.deliverable}.`,
    targetCountry: "United States",
    requestText: `${line.requirement} of ${line.name}. ${line.specification}. Supplier QA: ${line.deliverable}.`,
    requestedQuantity: line.quantity,
    requestedUnit: line.unit,
    sourceRegion: "Any region",
    deliveryLocation: GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
    needByDate: GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
    campaignId,
    campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
    campaignItemKey: line.sku,
    campaignArtifactKind: "AGGREGATE",
    campaignAttemptCount: attemptWatermark.attemptCount,
    campaignTerminalAttemptCount: attemptWatermark.terminalAttemptCount,
    campaignAttemptWatermark: attemptWatermark.watermark,
    requiredProvider,
  };
}

function latestAggregatesByItem(aggregates: PersistedAggregate[]) {
  const latest = new Map<string, PersistedAggregate>();
  for (const aggregate of [...aggregates].sort((left, right) => {
    const leftInput = record(left.input);
    const rightInput = record(right.input);
    const attemptDelta = Number(leftInput.campaignAttemptCount ?? 0) - Number(rightInput.campaignAttemptCount ?? 0);
    const terminalDelta = Number(leftInput.campaignTerminalAttemptCount ?? 0) - Number(rightInput.campaignTerminalAttemptCount ?? 0);
    return attemptDelta || terminalDelta || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  })) {
    const itemKey = typeof record(aggregate.input).campaignItemKey === "string" ? String(record(aggregate.input).campaignItemKey) : "";
    if (/^GUILD-\d{3}$/.test(itemKey)) latest.set(itemKey, aggregate);
  }
  return latest;
}

export function projectGuildSupplierResearchCampaign(args: {
  campaign: { id: string; workspaceId: string; status: string; updatedAt: Date | string };
  attempts: SupplierResearchCampaignAttempt[];
  aggregates?: PersistedAggregate[];
  campaignAttemptsUsed: number;
  officeAttemptsUsed: number;
  now?: Date;
}): SupplierResearchCampaignStatus {
  const now = args.now ?? new Date();
  const latestAggregates = latestAggregatesByItem(args.aggregates ?? []);
  const items: SupplierResearchCampaignItem[] = GUILD_SOURCING_LINES.map((line) => {
    const attempts = lineAttempts(line, args.attempts);
    const persistedAggregate = latestAggregates.get(line.sku) ?? null;
    const persistedOutput = persistedAggregate?.output ?? null;
    const active = attempts.find((attempt) => ["RUNNING", "QUEUED"].includes(attempt.status)) ?? null;
    const last = attempts.at(-1);
    const failureCode = lastFailureCode(last);
    const terminalAttempts = attempts.filter((attempt) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.status));
    const exhausted = terminalAttempts.length >= GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE;
    const operatorBlocked = failureCode ? OPERATOR_BLOCKING_FAILURE_CODES.has(failureCode) : false;
    const nonRetryableFailure = last?.status === "FAILED" && (!failureCode || !RETRYABLE_FAILURE_CODES.has(failureCode));
    const cancelled = last?.status === "CANCELLED";
    const targetMet = (persistedOutput?.candidates.length ?? 0) >= GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM;
    const retryEligible = line.classification === "SUPPLIER_SEARCH"
      && !targetMet
      && !active
      && !operatorBlocked
      && !nonRetryableFailure
      && !cancelled
      && !exhausted
      && terminalAttempts.length > 0;
    const retryAt = retryEligible ? nextAttemptDate(line, attempts) : null;
    let state: SupplierResearchCampaignItemState;
    let blocker: string | null = null;
    if (line.classification === "CLARIFICATION_REQUIRED") {
      state = "CLARIFICATION_REQUIRED";
      blocker = "Quantity and unit must be confirmed before supplier research.";
    } else if (line.classification === "REQUIREMENT_ONLY") {
      state = "REQUIREMENT_ONLY";
      blocker = "This line is a documentation requirement applied to supplier awards, not a supplier search.";
    } else if (targetMet) {
      state = "COMPLETE";
    } else if (active?.status === "RUNNING") {
      state = "RUNNING";
    } else if (active?.status === "QUEUED") {
      state = "QUEUED";
    } else if (failureCode === "MISSING_CONFIGURATION") {
      state = "BLOCKED";
      blocker = "Supplier research provider configuration is unavailable.";
    } else if (failureCode === "PROVIDER_AUTHENTICATION_FAILED") {
      state = "BLOCKED";
      blocker = "Supplier research provider authentication failed. Rotate or correct the provider credential before retrying.";
    } else if (failureCode === "ACCESS_REVOKED") {
      state = "BLOCKED";
      blocker = "Supplier research workspace access was revoked. Restore edit access before retrying.";
    } else if (nonRetryableFailure) {
      state = "BLOCKED";
      blocker = `Supplier research stopped after ${failureCode ?? "a non-retryable provider failure"}. Manual review is required.`;
    } else if (cancelled) {
      state = "BLOCKED";
      blocker = "Supplier research was cancelled. Manual retry is required.";
    } else if (exhausted) {
      state = "BLOCKED";
      blocker = `Supplier research reached the ${GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE}-attempt limit without three validated leads.`;
    } else if (retryAt && retryAt.getTime() > now.getTime()) {
      state = "RETRY_WAIT";
    } else {
      state = "PENDING";
    }
    return {
      componentItemKey: line.sku,
      lineNumber: line.item,
      name: line.name,
      classification: line.classification,
      state,
      leadCount: persistedOutput?.candidates.length ?? 0,
      attemptCount: attempts.length,
      activeRunId: active?.id ?? null,
      aggregateRunId: persistedAggregate?.id ?? null,
      aggregateRun: persistedAggregate ?? null,
      nextAttemptAt: retryAt?.toISOString() ?? null,
      lastAttemptAt: asDate(last?.createdAt)?.toISOString() ?? null,
      lastErrorCode: failureCode,
      blocker,
      targetMinimum: GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
      retainedMaximum: GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
    };
  });
  const searchable = items.filter((item) => item.classification === "SUPPLIER_SEARCH");
  const completed = searchable.filter((item) => item.state === "COMPLETE").length;
  const queued = searchable.filter((item) => item.state === "QUEUED").length;
  const running = searchable.filter((item) => item.state === "RUNNING").length;
  const retryWaiting = searchable.filter((item) => item.state === "RETRY_WAIT").length;
  const blocked = searchable.filter((item) => item.state === "BLOCKED");
  const capped = args.campaignAttemptsUsed >= GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP
    || args.officeAttemptsUsed >= SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP;
  const complete = completed === 38;
  const expired = guildSupplierResearchCampaignScopeExpired(now);
  const persistedFailure = args.campaign.status === "FAILED";
  const operatorFailure = blocked.some((item) => item.lastErrorCode && OPERATOR_BLOCKING_FAILURE_CODES.has(item.lastErrorCode));
  const noRemainingWork = completed + blocked.length === searchable.length && !running && !queued && !retryWaiting;
  const failed = persistedFailure || expired || operatorFailure || noRemainingWork;
  const state = complete ? "COMPLETE" : failed ? "FAILED" : capped ? "DAILY_CAP" : running || queued ? "RUNNING" : retryWaiting ? "RETRY_WAIT" : "RUNNING";
  const blocker = expired
    ? `Supplier research scope expired after ${GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE}. Create a new request with a valid need-by date.`
    : blocked[0]?.blocker ?? (persistedFailure ? "Supplier research campaign failed. Manual retry is required." : null);
  const futureRetryTimes = searchable.flatMap((item) => item.state === "RETRY_WAIT" && item.nextAttemptAt
    ? [new Date(item.nextAttemptAt).getTime()]
    : []);
  const untilNext = futureRetryTimes.length ? Math.max(1_000, Math.min(...futureRetryTimes) - now.getTime()) : 60_000;
  const retryAfterMs = running || queued ? 2_500 : Math.min(60_000, untilNext);
  const updatedTimes = [asDate(args.campaign.updatedAt)?.getTime() ?? 0, ...args.attempts.map((attempt) => asDate(attempt.updatedAt)?.getTime() ?? 0)];
  return {
    id: args.campaign.id,
    campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
    workspaceId: args.campaign.workspaceId,
    status: complete ? "SUCCEEDED" : failed ? "FAILED" : args.campaign.status,
    state,
    blocker,
    targetMinimum: GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
    retainedMaximum: GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
    totalLines: 40,
    searchableLines: 38,
    completedLines: completed,
    leadCount: searchable.reduce((total, item) => total + item.leadCount, 0),
    progressPercent: Math.round((completed / 38) * 100),
    queuedAttempts: queued,
    runningAttempts: running,
    retryWaitingLines: retryWaiting,
    totals: {
      items: 40,
      supplierSearchable: 38,
      targetMet: completed,
      needsClarification: 1,
      requirementOnly: 1,
      queued,
      running,
      backingOff: retryWaiting,
    },
    daily: {
      campaignAttemptsUsed: args.campaignAttemptsUsed,
      campaignAttemptCap: GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP,
      officeAttemptsUsed: args.officeAttemptsUsed,
      officeAttemptCap: SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP,
    },
    items,
    retryAfterMs,
    updatedAt: new Date(Math.max(...updatedTimes, ...[...latestAggregates.values()].map((aggregate) => asDate(aggregate.updatedAt)?.getTime() ?? 0))).toISOString(),
  };
}

type CampaignDatabaseState = {
  campaign: { id: string; workspaceId: string; status: string; updatedAt: Date; input: unknown };
  campaignAncestryIds: string[];
  attempts: SupplierResearchCampaignAttempt[];
  aggregates: PersistedAggregate[];
  campaignAttemptsUsed: number;
  officeAttemptsUsed: number;
};

type LockedCampaignRow = {
  id: string;
  status: string;
  output: unknown;
};

function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function loadCampaignDatabaseState(args: {
  campaign: CampaignDatabaseState["campaign"];
  officeId: string;
  now: Date;
  includeAttemptOutputs?: boolean;
}): Promise<CampaignDatabaseState> {
  const { prisma } = await import("@/lib/prisma");
  const dayStart = utcDayStart(args.now);
  const ancestryRows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE "campaignAncestry" AS (
      SELECT "id", "parentRunId"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.campaign.id}
        AND "officeId" = ${args.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      UNION ALL
      SELECT parent."id", parent."parentRunId"
      FROM "SupplyCapabilityRun" parent
      JOIN "campaignAncestry" child ON child."parentRunId" = parent."id"
      WHERE parent."officeId" = ${args.officeId}
        AND parent."workspaceId" = ${args.campaign.workspaceId}
        AND parent."capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND parent."dslName" = ${CAMPAIGN_DSL_NAME}
    )
    SELECT "id" FROM "campaignAncestry" LIMIT 51
  `;
  const campaignAncestryIds = ancestryRows.map((row) => row.id);
  if (campaignAncestryIds.length > 50) {
    throw new Error("Supplier research campaign ancestry is too deep.");
  }
  if (!campaignAncestryIds.includes(args.campaign.id)) {
    throw new Error("Supplier research campaign ancestry could not be resolved.");
  }
  type AttemptRow = SupplierResearchCampaignAttempt;
  type AggregateRow = {
    id: string;
    status: string;
    input: unknown;
    inputHash: string;
    output: unknown;
    outputHash: string | null;
    error: unknown;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    failedAt: Date | null;
  };
  const attemptPromise = args.includeAttemptOutputs
    ? prisma.$queryRaw<AttemptRow[]>`
        SELECT "id", "status", "input", "output", "error", "createdAt", "updatedAt", "completedAt", "failedAt"
        FROM (
          SELECT "id", "status", "input", "output", "error", "createdAt", "updatedAt", "completedAt", "failedAt",
            ROW_NUMBER() OVER (PARTITION BY ("input"->>'campaignItemKey') ORDER BY "createdAt" DESC, "id" DESC) AS "attemptRank"
          FROM "SupplyCapabilityRun"
          WHERE "officeId" = ${args.officeId}
            AND "workspaceId" = ${args.campaign.workspaceId}
            AND "parentRunId" IN (${Prisma.join(campaignAncestryIds)})
            AND "capabilityKey" = ${RESEARCH_CAPABILITY_KEY}
            AND "dslName" = ${ATTEMPT_DSL_NAME}
        ) AS "rankedAttempts"
        WHERE "attemptRank" <= ${GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE + 1}
        ORDER BY "createdAt" ASC, "id" ASC
      `
    : prisma.$queryRaw<Omit<AttemptRow, "output">[]>`
        SELECT "id", "status", "input", "error", "createdAt", "updatedAt", "completedAt", "failedAt"
        FROM (
          SELECT "id", "status", "input", "error", "createdAt", "updatedAt", "completedAt", "failedAt",
            ROW_NUMBER() OVER (PARTITION BY ("input"->>'campaignItemKey') ORDER BY "createdAt" DESC, "id" DESC) AS "attemptRank"
          FROM "SupplyCapabilityRun"
          WHERE "officeId" = ${args.officeId}
            AND "workspaceId" = ${args.campaign.workspaceId}
            AND "parentRunId" IN (${Prisma.join(campaignAncestryIds)})
            AND "capabilityKey" = ${RESEARCH_CAPABILITY_KEY}
            AND "dslName" = ${ATTEMPT_DSL_NAME}
        ) AS "rankedAttempts"
        WHERE "attemptRank" <= ${GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE + 1}
        ORDER BY "createdAt" ASC, "id" ASC
      `;
  const [attemptRows, aggregateRows, campaignAttemptsUsed, officeAttemptsUsed] = await Promise.all([
    attemptPromise,
    prisma.$queryRaw<AggregateRow[]>`
      SELECT DISTINCT ON (("input"->>'campaignItemKey'))
        "id", "status", "input", "inputHash", "output", "outputHash", "error", "createdAt", "updatedAt", "completedAt", "failedAt"
      FROM "SupplyCapabilityRun"
      WHERE "officeId" = ${args.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "parentRunId" IN (${Prisma.join(campaignAncestryIds)})
        AND "capabilityKey" = ${RESEARCH_CAPABILITY_KEY}
        AND "dslName" = ${AGGREGATE_DSL_NAME}
        AND "status" = 'SUCCEEDED'
        AND ("input"->>'campaignItemKey') ~ '^GUILD-[0-9]{3}$'
      ORDER BY
        ("input"->>'campaignItemKey'),
        CASE WHEN "input"->>'campaignAttemptCount' ~ '^[0-9]+$' THEN ("input"->>'campaignAttemptCount')::int ELSE 0 END DESC,
        CASE WHEN "input"->>'campaignTerminalAttemptCount' ~ '^[0-9]+$' THEN ("input"->>'campaignTerminalAttemptCount')::int ELSE 0 END DESC,
        "createdAt" DESC,
        "id" DESC
      LIMIT 38
    `,
    prisma.supplyCapabilityRun.count({
      where: {
        officeId: args.officeId,
        workspaceId: args.campaign.workspaceId,
        parentRunId: { in: campaignAncestryIds },
        capabilityKey: RESEARCH_CAPABILITY_KEY,
        dslName: ATTEMPT_DSL_NAME,
        createdAt: { gte: dayStart },
      },
    }),
    prisma.supplyCapabilityRun.count({
      where: {
        officeId: args.officeId,
        capabilityKey: RESEARCH_CAPABILITY_KEY,
        dslName: { in: ["interactive_supplier_research", ATTEMPT_DSL_NAME] },
        createdAt: { gte: dayStart },
      },
    }),
  ]);
  const attempts: SupplierResearchCampaignAttempt[] = attemptRows.map((attempt) => ({
    ...attempt,
    output: "output" in attempt ? attempt.output : null,
  }));
  return {
    campaign: args.campaign,
    campaignAncestryIds,
    attempts,
    aggregates: aggregateRows.map((aggregate) => ({
      ...aggregate,
      status: "SUCCEEDED" as const,
      input: aggregate.input as unknown as SupplierResearchAggregateInput,
      output: aggregate.output as unknown as SupplierResearchResult,
      error: null,
      createdAt: aggregate.createdAt.toISOString(),
      updatedAt: aggregate.updatedAt.toISOString(),
      completedAt: (aggregate.completedAt ?? aggregate.createdAt).toISOString(),
      failedAt: null,
      inputHash: aggregate.inputHash,
      outputHash: aggregate.outputHash ?? undefined,
    })),
    campaignAttemptsUsed,
    officeAttemptsUsed,
  };
}

async function acquireCampaignReconciliationLease(args: {
  context: SupplyAccessContext;
  campaign: CampaignDatabaseState["campaign"];
  now: Date;
}) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(async (tx) => {
    const [campaign] = await tx.$queryRaw<LockedCampaignRow[]>`
      SELECT "id", "status", "output"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.campaign.id}
        AND "officeId" = ${args.context.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      FOR UPDATE
    `;
    if (!campaign || campaign.status !== "RUNNING") return null;
    const activeLease = reconciliationLease(campaign.output);
    const activeLeaseExpiresAt = asDate(activeLease?.expiresAt);
    if (activeLeaseExpiresAt && activeLeaseExpiresAt.getTime() > args.now.getTime()) return null;
    const token = randomUUID();
    const output = {
      ...record(campaign.output),
      reconciliationLease: {
        token,
        expiresAt: new Date(args.now.getTime() + CAMPAIGN_RECONCILIATION_LEASE_MS).toISOString(),
      },
    } satisfies Prisma.InputJsonObject;
    await tx.supplyCapabilityRun.update({
      where: { id: campaign.id },
      data: { output },
      select: { id: true },
    });
    return token;
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function releaseCampaignReconciliationLease(args: {
  context: SupplyAccessContext;
  campaign: CampaignDatabaseState["campaign"];
  token: string;
  now: Date;
  failureMessage?: string;
}) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(async (tx) => {
    const [campaign] = await tx.$queryRaw<LockedCampaignRow[]>`
      SELECT "id", "status", "output"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.campaign.id}
        AND "officeId" = ${args.context.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      FOR UPDATE
    `;
    if (!campaign || campaign.status !== "RUNNING" || !hasReconciliationLease(campaign.output, args.token)) return false;
    const output = { ...record(campaign.output) };
    delete output.reconciliationLease;
    if (args.failureMessage) {
      output.reconciliationFailure = { message: args.failureMessage, recordedAt: args.now.toISOString() };
    } else {
      delete output.reconciliationFailure;
    }
    await tx.supplyCapabilityRun.update({
      where: { id: campaign.id },
      data: { output: Object.keys(output).length ? output as Prisma.InputJsonObject : Prisma.DbNull },
      select: { id: true },
    });
    return true;
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function transitionCampaignWithReconciliationLease(args: {
  context: SupplyAccessContext;
  campaign: CampaignDatabaseState["campaign"];
  token: string;
  now: Date;
  status: "SUCCEEDED" | "FAILED";
  output?: Prisma.InputJsonObject;
  errorMessage?: string;
}) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(async (tx) => {
    const [campaign] = await tx.$queryRaw<LockedCampaignRow[]>`
      SELECT "id", "status", "output"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.campaign.id}
        AND "officeId" = ${args.context.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      FOR UPDATE
    `;
    if (!campaign || campaign.status !== "RUNNING" || !hasReconciliationLease(campaign.output, args.token)) return false;
    if (args.status === "SUCCEEDED" && !args.output) throw new Error("Completed supplier research campaign requires output.");
    await tx.supplyCapabilityRun.updateMany({
      where: {
        officeId: args.context.officeId,
        workspaceId: args.campaign.workspaceId,
        parentRunId: campaign.id,
        capabilityKey: RESEARCH_CAPABILITY_KEY,
        dslName: ATTEMPT_DSL_NAME,
        status: "QUEUED",
      },
      data: {
        status: "CANCELLED",
        cancelledAt: args.now,
        error: { message: "CAMPAIGN_TERMINAL: Supplier research attempt was cancelled when its campaign ended." },
      },
    });
    await tx.supplyCapabilityRun.update({
      where: { id: campaign.id },
      data: args.status === "SUCCEEDED"
        ? {
            status: "SUCCEEDED",
            output: args.output,
            outputHash: digest(args.output),
            completedAt: args.now,
          }
        : {
            status: "FAILED",
            output: Prisma.DbNull,
            error: { message: args.errorMessage ?? "CAMPAIGN_BLOCKED: Supplier research has no retryable work." },
            failedAt: args.now,
          },
      select: { id: true },
    });
    return true;
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function persistChangedAggregates(args: {
  context: SupplyAccessContext;
  state: CampaignDatabaseState;
  now: Date;
  reconciliationToken: string;
}) {
  const { prisma } = await import("@/lib/prisma");
  const requiredProvider = supplierResearchProviderFromInput(args.state.campaign.input);
  if (!requiredProvider) throw new Error("Supplier research campaign has no pinned provider.");
  const current = latestAggregatesByItem(args.state.aggregates);
  for (const line of GUILD_SOURCING_LINES) {
    if (line.classification !== "SUPPLIER_SEARCH") continue;
    const relevantAttempts = lineAttempts(line, args.state.attempts);
    if (!relevantAttempts.some((attempt) => attempt.status === "SUCCEEDED") && !current.has(line.sku)) continue;
    const output = aggregateGuildSupplierResearchLine(line, args.state.attempts);
    const outputHash = digest(output);
    const attemptWatermark = aggregateAttemptWatermark(line, args.state.attempts);
    const input = aggregateInput(line, args.state.campaign.id, requiredProvider, attemptWatermark);
    const inputHash = digest(input);
    const idempotencyKey = `guild:${args.state.campaign.id}:${line.sku}:aggregate:${attemptWatermark.watermark.slice(0, 16)}:${outputHash.slice(0, 16)}`;
    await prisma.$transaction(async (tx) => {
      const [parent] = await tx.$queryRaw<LockedCampaignRow[]>`
        SELECT "id", "status", "output"
        FROM "SupplyCapabilityRun"
        WHERE "id" = ${args.state.campaign.id}
          AND "officeId" = ${args.context.officeId}
          AND "workspaceId" = ${args.state.campaign.workspaceId}
          AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
          AND "dslName" = ${CAMPAIGN_DSL_NAME}
        FOR UPDATE
      `;
      if (!parent || parent.status !== "RUNNING" || !hasReconciliationLease(parent.output, args.reconciliationToken)) return;
      await tx.$queryRaw<Array<{ advisoryLock: string }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-aggregate:${args.context.officeId}:${args.state.campaign.workspaceId}:${guildSupplierResearchCampaignRevision(requiredProvider)}:${line.sku}`}, 0))::text AS "advisoryLock"
      `;
      const [latest] = await tx.$queryRaw<Array<{ input: unknown; outputHash: string | null }>>`
        SELECT "input", "outputHash"
        FROM "SupplyCapabilityRun"
        WHERE "officeId" = ${args.context.officeId}
          AND "workspaceId" = ${args.state.campaign.workspaceId}
          AND "parentRunId" IN (${Prisma.join(args.state.campaignAncestryIds)})
          AND "capabilityKey" = ${RESEARCH_CAPABILITY_KEY}
          AND "dslName" = ${AGGREGATE_DSL_NAME}
          AND "status" = 'SUCCEEDED'
          AND "input"->>'campaignItemKey' = ${line.sku}
        ORDER BY
          CASE WHEN "input"->>'campaignAttemptCount' ~ '^[0-9]+$' THEN ("input"->>'campaignAttemptCount')::int ELSE 0 END DESC,
          CASE WHEN "input"->>'campaignTerminalAttemptCount' ~ '^[0-9]+$' THEN ("input"->>'campaignTerminalAttemptCount')::int ELSE 0 END DESC,
          "createdAt" DESC,
          "id" DESC
        LIMIT 1
      `;
      const latestInput = record(latest?.input);
      if (!shouldPersistGuildSupplierResearchAggregate({
        latestAttemptCount: typeof latestInput.campaignAttemptCount === "number" ? latestInput.campaignAttemptCount : 0,
        latestTerminalAttemptCount: typeof latestInput.campaignTerminalAttemptCount === "number" ? latestInput.campaignTerminalAttemptCount : 0,
        latestOutputHash: latest?.outputHash ?? null,
        incomingAttemptCount: attemptWatermark.attemptCount,
        incomingTerminalAttemptCount: attemptWatermark.terminalAttemptCount,
        incomingOutputHash: outputHash,
      })) return;
      const existing = await tx.supplyCapabilityRun.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: args.state.campaign.workspaceId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) return;
      const queued = await tx.supplyCapabilityRun.create({
        data: {
          officeId: args.context.officeId,
          workspaceId: args.state.campaign.workspaceId,
          invokedByUserId: args.context.userId,
          parentRunId: args.state.campaign.id,
          capabilityKey: RESEARCH_CAPABILITY_KEY,
          capabilityVersion: "1",
          dslName: AGGREGATE_DSL_NAME,
          dslVersion: "1",
          input: input as unknown as Prisma.InputJsonObject,
          inputHash,
          idempotencyKey,
        },
        select: { id: true },
      });
      await tx.supplyCapabilityRun.update({
        where: { id: queued.id },
        data: { status: "RUNNING", startedAt: args.now },
      });
      await tx.supplyCapabilityRun.update({
        where: { id: queued.id },
        data: {
          status: "SUCCEEDED",
          output: output as unknown as Prisma.InputJsonObject,
          outputHash,
          completedAt: args.now,
        },
      });
    }, { maxWait: 5_000, timeout: 15_000 });
  }
}

async function reconcileCampaign(args: {
  context: SupplyAccessContext;
  campaign: CampaignDatabaseState["campaign"];
  now: Date;
  allowTerminalRetry?: boolean;
}) {
  const { prisma } = await import("@/lib/prisma");
  const requiredProvider = supplierResearchProviderFromInput(args.campaign.input);
  if (!requiredProvider) throw new Error("Supplier research campaign has no pinned provider.");
  const persistence = await import("./sourcing-research-persistence") as unknown as {
    enqueueSourcingResearchCampaignBatch: (args: {
      context: SupplyAccessContext;
      workspaceId: string;
      parentRunId: string;
      reconciliationToken: string;
      work: Array<{ input: Prisma.InputJsonValue; idempotencyKey: string }>;
      campaignDailyCap: number;
      officeDailyCap: number;
      maxActive: number;
      now: Date;
    }) => Promise<{ queued: number }>;
  };
  const reconciliationToken = await acquireCampaignReconciliationLease(args);
  if (!reconciliationToken) {
    const current = await prisma.supplyCapabilityRun.findFirst({
      where: {
        id: args.campaign.id,
        officeId: args.context.officeId,
        workspaceId: args.campaign.workspaceId,
        capabilityKey: CAMPAIGN_CAPABILITY_KEY,
        dslName: CAMPAIGN_DSL_NAME,
      },
      select: { id: true, workspaceId: true, status: true, updatedAt: true, input: true },
    });
    if (!current) throw new Error("Supplier research campaign was not found during reconciliation.");
    const state = await loadCampaignDatabaseState({ campaign: current, officeId: args.context.officeId, now: args.now });
    return { campaign: projectGuildSupplierResearchCampaign({ ...state, now: args.now }), queued: 0 };
  }

  try {
    if (guildSupplierResearchCampaignScopeExpired(args.now)) {
      const blocker = `CAMPAIGN_SCOPE_EXPIRED: Supplier research scope expired after ${GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE}.`;
      await transitionCampaignWithReconciliationLease({
        context: args.context,
        campaign: args.campaign,
        token: reconciliationToken,
        now: args.now,
        status: "FAILED",
        errorMessage: blocker,
      });
      const state = await loadCampaignDatabaseState({
        campaign: { ...args.campaign, status: "FAILED", updatedAt: args.now },
        officeId: args.context.officeId,
        now: args.now,
      });
      return { campaign: projectGuildSupplierResearchCampaign({ ...state, now: args.now }), queued: 0 };
    }

    let state = await loadCampaignDatabaseState({
      campaign: args.campaign,
      officeId: args.context.officeId,
      now: args.now,
      includeAttemptOutputs: true,
    });
    await persistChangedAggregates({
      context: args.context,
      state,
      now: args.now,
      reconciliationToken,
    });
    state = await loadCampaignDatabaseState({ campaign: args.campaign, officeId: args.context.officeId, now: args.now });
    const plan = planGuildSupplierResearchQueue({
      campaignId: args.campaign.id,
      requiredProvider,
      attempts: state.attempts,
      aggregates: state.aggregates,
      now: args.now,
      campaignAttemptsRemaining: GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP - state.campaignAttemptsUsed,
      officeAttemptsRemaining: SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP - state.officeAttemptsUsed,
      batchSize: Math.max(
        0,
        GUILD_SUPPLIER_CAMPAIGN_QUEUE_BATCH
          - state.attempts.filter((attempt) => ["QUEUED", "RUNNING"].includes(attempt.status)).length,
      ),
      allowTerminalRetry: args.allowTerminalRetry,
    });
    const enqueued = await persistence.enqueueSourcingResearchCampaignBatch({
      context: args.context,
      workspaceId: args.campaign.workspaceId,
      parentRunId: args.campaign.id,
      reconciliationToken,
      work: plan.map((work) => ({
        input: work.input,
        idempotencyKey: `guild:${args.campaign.id}:${work.itemKey}:attempt:${work.attemptNumber}`,
      })),
      campaignDailyCap: GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP,
      officeDailyCap: SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP,
      maxActive: GUILD_SUPPLIER_CAMPAIGN_QUEUE_BATCH,
      now: args.now,
    });
    const queued = enqueued.queued;
    state = await loadCampaignDatabaseState({ campaign: args.campaign, officeId: args.context.officeId, now: args.now });
    let projected = projectGuildSupplierResearchCampaign({ ...state, now: args.now });
    if (projected.state === "COMPLETE") {
      const output = {
        campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
        requiredProvider,
        completedLines: projected.completedLines,
        leadCount: projected.leadCount,
        aggregateRunIds: projected.items.flatMap((item) => item.aggregateRunId ? [item.aggregateRunId] : []),
      } satisfies Prisma.InputJsonObject;
      const completed = await transitionCampaignWithReconciliationLease({
        context: args.context,
        campaign: args.campaign,
        token: reconciliationToken,
        now: args.now,
        status: "SUCCEEDED",
        output,
      });
      if (!completed) throw new Error("Supplier research campaign reconciliation lease was lost before completion.");
      projected = { ...projected, status: "SUCCEEDED", state: "COMPLETE" };
    } else if (projected.state === "FAILED") {
      const failed = await transitionCampaignWithReconciliationLease({
        context: args.context,
        campaign: args.campaign,
        token: reconciliationToken,
        now: args.now,
        status: "FAILED",
        errorMessage: `CAMPAIGN_BLOCKED: ${projected.blocker ?? "Supplier research has no retryable work."}`,
      });
      if (!failed) throw new Error("Supplier research campaign reconciliation lease was lost before failure could be saved.");
      projected = { ...projected, status: "FAILED", state: "FAILED" };
    } else {
      const released = await releaseCampaignReconciliationLease({
        context: args.context,
        campaign: args.campaign,
        token: reconciliationToken,
        now: args.now,
      });
      if (!released) throw new Error("Supplier research campaign reconciliation lease was lost before release.");
    }
    return { campaign: projected, queued };
  } catch (error) {
    await releaseCampaignReconciliationLease({
      context: args.context,
      campaign: args.campaign,
      token: reconciliationToken,
      now: args.now,
      failureMessage: "CAMPAIGN_RECONCILIATION_RETRY: Supplier research campaign reconciliation will retry.",
    }).catch(() => false);
    throw error;
  }
}

async function campaignWorkspace(context: SupplyAccessContext) {
  const persistence = await import("./sourcing-research-persistence") as unknown as {
    guildSourcingSystemWorkspace: (context: SupplyAccessContext, mode: "view" | "edit") => Promise<{ id: string }>;
  };
  return persistence.guildSourcingSystemWorkspace(context, "edit");
}

async function findCampaignWorkspace(context: SupplyAccessContext) {
  const persistence = await import("./sourcing-research-persistence") as unknown as {
    findGuildSourcingSystemWorkspace: (context: SupplyAccessContext) => Promise<{ id: string } | null>;
  };
  return persistence.findGuildSourcingSystemWorkspace(context);
}

export async function startOrResumeGuildSupplierResearchCampaign(args: {
  context: SupplyAccessContext;
  now?: Date;
}): Promise<SupplierResearchCampaignResponse> {
  const configuredProvider = configuredSupplierResearchProvider();
  if (!configuredProvider) {
    const { SupplyConnectorError } = await import("./connector-contract");
    throw new SupplyConnectorError(
      "CONNECTOR_DISABLED",
      "Bulk supplier research requires an EXA or OpenAI public-page validation provider.",
    );
  }
  const { prisma } = await import("@/lib/prisma");
  const now = args.now ?? new Date();
  if (guildSupplierResearchCampaignScopeExpired(now)) {
    const { SupplyPersistenceError } = await import("./persistence");
    throw new SupplyPersistenceError(
      `The GUILD supplier research scope expired after ${GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE}. Create a request with a valid need-by date.`,
      "conflict",
    );
  }
  const workspace = await campaignWorkspace(args.context);
  const selected = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-campaign-generation:${args.context.officeId}:${workspace.id}:${GUILD_SUPPLIER_CAMPAIGN_KEY}`}, 0))::text AS "advisoryLock"
    `;
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-office-provider-budget:${args.context.officeId}`}, 0))::text AS "advisoryLock"
    `;
    const campaignRows = await tx.$queryRaw<Array<{
      id: string;
      officeId: string;
      workspaceId: string;
      capabilityKey: string;
      dslName: string | null;
      status: string;
      updatedAt: Date;
      idempotencyKey: string | null;
      input: unknown;
    }>>`
      SELECT "id", "officeId", "workspaceId", "capabilityKey", "dslName", "status", "updatedAt", "idempotencyKey", "input"
      FROM "SupplyCapabilityRun"
      WHERE "officeId" = ${args.context.officeId}
        AND "workspaceId" = ${workspace.id}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      ORDER BY "createdAt" DESC, "id" DESC
      FOR UPDATE
    `;
    const validRows = campaignRows.flatMap((campaign) => {
      const identity = campaignIdentity(campaign);
      return identity ? [{ campaign, ...identity }] : [];
    });
    const reusable = validRows.find((entry) => ["QUEUED", "RUNNING", "SUCCEEDED"].includes(entry.campaign.status)) ?? null;
    if (reusable) {
      return {
        campaign: reusable.campaign,
        generation: reusable.generation,
        requiredProvider: reusable.requiredProvider,
        reused: true,
      };
    }
    const providerRows = validRows.filter((entry) => entry.requiredProvider === configuredProvider);
    const generation = Math.max(0, ...providerRows.map((entry) => entry.generation)) + 1;
    if (generation > GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS) {
      const { SupplyPersistenceError } = await import("./persistence");
      throw new SupplyPersistenceError(
        `Supplier research reached the ${GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS}-generation manual retry limit. Review the blocked lines before creating a revised campaign scope.`,
        "conflict",
      );
    }
    for (const superseded of campaignRows) {
      await tx.supplyCapabilityRun.updateMany({
        where: {
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          parentRunId: superseded.id,
          capabilityKey: RESEARCH_CAPABILITY_KEY,
          dslName: ATTEMPT_DSL_NAME,
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          error: { message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research attempt belongs to a superseded campaign scope." },
        },
      });
      if (!["QUEUED", "RUNNING"].includes(superseded.status)) continue;
      await tx.supplyCapabilityRun.update({
        where: { id: superseded.id },
        data: superseded.status === "QUEUED"
          ? {
              status: "CANCELLED",
              cancelledAt: now,
              error: { message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research campaign scope was replaced." },
            }
          : {
              status: "FAILED",
              output: Prisma.DbNull,
              failedAt: now,
              error: { message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research campaign scope was replaced." },
            },
        select: { id: true },
      });
    }
    const input = guildSupplierResearchCampaignScope(configuredProvider) satisfies Prisma.InputJsonObject;
    const latest = providerRows[0]?.campaign ?? null;
    const queued = await tx.supplyCapabilityRun.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: workspace.id,
        invokedByUserId: args.context.userId,
        parentRunId: latest?.id ?? null,
        capabilityKey: CAMPAIGN_CAPABILITY_KEY,
        capabilityVersion: String(CAMPAIGN_SCOPE_VERSION),
        dslName: CAMPAIGN_DSL_NAME,
        dslVersion: String(CAMPAIGN_SCOPE_VERSION),
        input,
        inputHash: digest(input),
        idempotencyKey: guildSupplierResearchCampaignGenerationKey(generation, configuredProvider),
      },
      select: { id: true },
    });
    const campaign = await tx.supplyCapabilityRun.update({
      where: { id: queued.id },
      data: { status: "RUNNING", startedAt: now },
      select: { id: true, officeId: true, workspaceId: true, capabilityKey: true, dslName: true, status: true, updatedAt: true, idempotencyKey: true, input: true },
    });
    return { campaign, generation, requiredProvider: configuredProvider, reused: false };
  }, { maxWait: 5_000, timeout: 15_000 });
  const campaign = selected.campaign;
  if (campaign.status === "SUCCEEDED") {
    const state = await loadCampaignDatabaseState({ campaign, officeId: args.context.officeId, now });
    return { campaign: projectGuildSupplierResearchCampaign({ ...state, now }), queued: 0, reused: true };
  }
  const selectedProviderConfigured = selected.requiredProvider === "EXA"
    ? Boolean(process.env.EXA_API_KEY?.trim())
    : Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!selectedProviderConfigured) {
    const { SupplyConnectorError } = await import("./connector-contract");
    throw new SupplyConnectorError(
      "CONNECTOR_DISABLED",
      `The active supplier research campaign is pinned to ${selected.requiredProvider}, but that provider is not configured.`,
    );
  }
  const result = await reconcileCampaign({
    context: args.context,
    campaign,
    now,
    allowTerminalRetry: !selected.reused && selected.generation > 1,
  });
  return { ...result, reused: selected.reused };
}

export async function pollGuildSupplierResearchCampaign(args: {
  context: SupplyAccessContext;
  now?: Date;
}): Promise<SupplierResearchCampaignStatus | null> {
  const { prisma } = await import("@/lib/prisma");
  const now = args.now ?? new Date();
  const workspace = await findCampaignWorkspace(args.context);
  if (!workspace) return null;
  const campaignRows = await prisma.supplyCapabilityRun.findMany({
    where: {
      officeId: args.context.officeId,
      workspaceId: workspace.id,
      capabilityKey: CAMPAIGN_CAPABILITY_KEY,
      dslName: CAMPAIGN_DSL_NAME,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, workspaceId: true, status: true, updatedAt: true, officeId: true, capabilityKey: true, idempotencyKey: true, input: true },
  });
  const campaign = campaignRows
    .flatMap((row) => {
      const identity = campaignIdentity(row);
      return identity ? [{ row, ...identity }] : [];
    })[0]?.row ?? null;
  if (!campaign || campaign.officeId !== args.context.officeId || campaign.capabilityKey !== CAMPAIGN_CAPABILITY_KEY) return null;
  const state = await loadCampaignDatabaseState({ campaign, officeId: args.context.officeId, now });
  return projectGuildSupplierResearchCampaign({ ...state, now });
}

async function failCampaignWithoutActiveReconciliation(args: {
  campaign: { id: string; officeId: string; workspaceId: string };
  now: Date;
  message: string;
}) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$transaction(async (tx) => {
    const [campaign] = await tx.$queryRaw<LockedCampaignRow[]>`
      SELECT "id", "status", "output"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.campaign.id}
        AND "officeId" = ${args.campaign.officeId}
        AND "workspaceId" = ${args.campaign.workspaceId}
        AND "capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
        AND "dslName" = ${CAMPAIGN_DSL_NAME}
      FOR UPDATE
    `;
    if (!campaign || campaign.status !== "RUNNING") return false;
    const leaseExpiresAt = asDate(reconciliationLease(campaign.output)?.expiresAt);
    if (leaseExpiresAt && leaseExpiresAt.getTime() > args.now.getTime()) return false;
    await tx.supplyCapabilityRun.updateMany({
      where: {
        officeId: args.campaign.officeId,
        workspaceId: args.campaign.workspaceId,
        parentRunId: campaign.id,
        capabilityKey: RESEARCH_CAPABILITY_KEY,
        dslName: ATTEMPT_DSL_NAME,
        status: "QUEUED",
      },
      data: {
        status: "CANCELLED",
        cancelledAt: args.now,
        error: { message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research attempt belongs to an inactive campaign." },
      },
    });
    await tx.supplyCapabilityRun.update({
      where: { id: campaign.id },
      data: {
        status: "FAILED",
        output: Prisma.DbNull,
        error: { message: args.message },
        failedAt: args.now,
      },
      select: { id: true },
    });
    return true;
  }, { maxWait: 5_000, timeout: 15_000 });
}

function isWorkspaceAccessFailure(error: unknown) {
  return error instanceof Error
    && error.name === "SupplyPersistenceError"
    && ["forbidden", "not_found"].includes(String((error as Error & { code?: unknown }).code ?? ""));
}

export async function advanceSupplierResearchCampaigns(options: { limit?: number; now?: Date } = {}) {
  const { prisma } = await import("@/lib/prisma");
  const now = options.now ?? new Date();
  const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 10)));
  const campaigns = await prisma.supplyCapabilityRun.findMany({
    where: {
      capabilityKey: CAMPAIGN_CAPABILITY_KEY,
      dslName: CAMPAIGN_DSL_NAME,
      status: "RUNNING",
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      officeId: true,
      workspaceId: true,
      status: true,
      updatedAt: true,
      idempotencyKey: true,
      input: true,
      invokedBy: {
        select: { id: true, officeId: true, role: true, canViewWholeOffice: true, isActive: true },
      },
    },
  });
  let queued = 0;
  let completed = 0;
  let failed = 0;
  for (const campaign of campaigns) {
    if (!campaignIdentity(campaign)) {
      const transitioned = await failCampaignWithoutActiveReconciliation({
        campaign,
        now,
        message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research campaign scope was replaced by a newer revision.",
      });
      failed += Number(transitioned);
      continue;
    }
    if (!campaign.invokedBy?.isActive || campaign.invokedBy.officeId !== campaign.officeId) {
      const transitioned = await failCampaignWithoutActiveReconciliation({
        campaign,
        now,
        message: "ACCESS_REVOKED: Supplier research campaign requester no longer has access.",
      });
      failed += Number(transitioned);
      continue;
    }
    try {
      const context = {
        officeId: campaign.officeId,
        userId: campaign.invokedBy.id,
        role: campaign.invokedBy.role,
        canViewWholeOffice: campaign.invokedBy.canViewWholeOffice,
      } satisfies SupplyAccessContext;
      const { requireSupplyWorkspace } = await import("./persistence");
      await requireSupplyWorkspace(context, campaign.workspaceId, "edit");
      const result = await reconcileCampaign({
        context,
        campaign,
        now,
      });
      queued += result.queued;
      if (result.campaign.state === "COMPLETE") {
        completed += 1;
      } else if (result.campaign.state === "FAILED") {
        failed += 1;
      }
    } catch (error) {
      if (isWorkspaceAccessFailure(error)) {
        await failCampaignWithoutActiveReconciliation({
          campaign,
          now,
          message: "ACCESS_REVOKED: Supplier research campaign requester can no longer edit this workspace.",
        });
      }
      console.error("Supplier research campaign reconciliation failed", {
        campaignId: campaign.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      failed += 1;
    }
  }
  return { scanned: campaigns.length, queued, completed, failed };
}
