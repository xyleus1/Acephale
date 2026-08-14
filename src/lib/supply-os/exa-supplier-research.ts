import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  normalizeSupplierResearch,
  selectedSupplierResearchQueryVariant,
  supplierCompanyMatchesDomain,
  type EvidenceSource,
  type SupplierCandidateRole,
  type SupplierResearchQueryProfile,
  type SupplierResearchResult,
} from "./research";
import { isSupplierDiscoveryUrl } from "./supplier-discovery-url";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const MAX_RESULTS = 6;
const MAX_CONTENT_RESULTS = 3;
const MAX_SEARCH_RESPONSE_BYTES = 512_000;
const MAX_CONTENTS_RESPONSE_BYTES = 1_000_000;
const MAX_RECORD_TEXT = 12_000;
const MAX_RECORD_HIGHLIGHTS = 4_000;
const SEARCH_TIMEOUT_MS = 18_000;
const CONTENTS_TIMEOUT_MS = 24_000;
const TOTAL_TIMEOUT_MS = 45_000;

export type ExaResearchFailureCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_FAILURE"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "INVALID_STRUCTURED_RESPONSE";

export class ExaResearchError extends Error {
  readonly code: ExaResearchFailureCode;

  constructor(code: ExaResearchFailureCode) {
    super(code);
    this.name = "ExaResearchError";
    this.code = code;
  }
}

export type ExaSupplierResearchInput = {
  officeId: string;
  workspaceId: string;
  componentItemKey: string;
  componentName: string;
  manufacturer?: string;
  mpn?: string;
  specification?: string;
  targetCountry?: string;
  requestedQuantity?: number;
  requestedUnit?: string;
  sourceRegion?: string;
  deliveryLocation?: string;
  needByDate?: string;
  queryVariant?: string;
  queryCycle?: number;
  excludeDomains?: string[];
};

export type SupplierLeadValidationInput = ExaSupplierResearchInput;

type JsonRecord = Record<string, unknown>;

export type ExaSourceStatus = {
  id: string;
  status: string;
  errorTag: string | null;
  httpStatusCode: number | null;
  cacheState: string | null;
  cacheAgeHours: number | null;
};

export type ExaOfferProposal = {
  supplierName: string | null;
  supplierRole: string | null;
  companyIdentityEvidence: string | null;
  supplierRoleEvidence: string | null;
  productCapabilityEvidence: string | null;
  itemIdentity: string | null;
  manufacturer: string | null;
  mpn: string | null;
  priceAmount: number | null;
  currency: string | null;
  unitOfMeasure: string | null;
  packageQuantity: number | null;
  evidenceText: string | null;
};

export type ExaRetrievedRecord = {
  searchRank: number;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  status: ExaSourceStatus | null;
  publishedDate: string | null;
  text: string;
  highlights: string[];
  proposal: ExaOfferProposal | null;
  sourceTextHash: string;
};

export type OpenAiSupplierLeadProposal = ExaOfferProposal;

export type OpenAiRetrievedRecord = Omit<ExaRetrievedRecord, "status"> & {
  status: ExaSourceStatus;
};

type ExaCompletedRetrievalCapture = {
  provider: "EXA";
  freshnessPolicy: "FORCED_LIVE";
  stage?: "CONTENTS_COMPLETE";
  searchRequestId: string;
  contentsRequestId: string;
  searchHttpStatus: number;
  contentsHttpStatus: number;
  searchResponseHash: string;
  contentsResponseHash: string;
  retrievedAt: string;
  records: ExaRetrievedRecord[];
};

type ExaSearchOnlyRetrievalCapture = {
  provider: "EXA";
  freshnessPolicy: "FORCED_LIVE";
  stage: "SEARCH_ONLY";
  searchRequestId: string;
  contentsRequestId: null;
  searchHttpStatus: number;
  contentsHttpStatus: null;
  searchResponseHash: string;
  contentsResponseHash: null;
  retrievedAt: string;
  records: ExaRetrievedRecord[];
  failureCode: ExaResearchFailureCode;
};

export type ExaRetrievalCapture = ExaCompletedRetrievalCapture | ExaSearchOnlyRetrievalCapture;

export type OpenAiRetrievalCapture = {
  provider: "OPENAI";
  freshnessPolicy: "SERVER_RETRIEVED";
  stage?: "CONTENTS_COMPLETE";
  searchRequestId: string;
  contentsRequestId: string;
  searchHttpStatus: number;
  contentsHttpStatus: number;
  searchResponseHash: string;
  contentsResponseHash: string;
  retrievedAt: string;
  records: OpenAiRetrievedRecord[];
};

export type SupplierResearchRetrievalCapture = ExaRetrievalCapture | OpenAiRetrievalCapture;

export type PublicListingReceipt = {
  provider: "EXA";
  candidateId: string | null;
  itemKey: string;
  itemIdentity: string;
  manufacturer: string | null;
  mpn: string | null;
  amount: number;
  currency: string;
  unitOfMeasure: string;
  packageQuantity: number | null;
  sourceUrl: string;
  sourceTitle: string | null;
  evidenceExcerpt: string;
  sourceTextHash: string;
  searchRequestId: string;
  contentsRequestId: string;
  contentsResponseHash: string;
  retrievedAt: string;
  freshnessPolicy: "FORCED_LIVE";
  receiptHash: string;
};

type PublicSupplierLeadReceiptFields = {
  candidateId: string | null;
  itemKey: string;
  companyName: string;
  website: string;
  role: SupplierCandidateRole;
  productCapability: string;
  sourceUrl: string;
  sourceTitle: string | null;
  companyIdentityExcerpt: string;
  supplierRoleExcerpt: string;
  productCapabilityExcerpt: string;
  sourceTextHash: string;
  searchRequestId: string;
  contentsRequestId: string;
  contentsResponseHash: string;
  retrievedAt: string;
  receiptHash: string;
};

export type ExaPublicSupplierLeadReceipt = PublicSupplierLeadReceiptFields & {
  provider: "EXA";
  freshnessPolicy: "FORCED_LIVE";
};

export type OpenAiPublicSupplierLeadReceipt = PublicSupplierLeadReceiptFields & {
  provider: "OPENAI";
  freshnessPolicy: "SERVER_RETRIEVED";
};

export type PublicSupplierLeadReceipt = ExaPublicSupplierLeadReceipt | OpenAiPublicSupplierLeadReceipt;

export type SupplierLeadValidationDecisionCode =
  | "ACCEPTED"
  | "CAPTURE_SEARCH_ONLY"
  | "CAPTURE_PROVIDER_POLICY_INVALID"
  | "CAPTURE_SEARCH_HTTP_INVALID"
  | "CAPTURE_CONTENTS_HTTP_INVALID"
  | "CAPTURE_SEARCH_HASH_INVALID"
  | "CAPTURE_CONTENTS_HASH_INVALID"
  | "CAPTURE_RETRIEVED_AT_INVALID"
  | "CAPTURE_NO_RECORDS"
  | "PROPOSAL_MISSING"
  | "SOURCE_STATUS_NOT_FRESH"
  | "SOURCE_URL_INVALID"
  | "SOURCE_DOMAIN_DISALLOWED"
  | "COMPANY_MISSING"
  | "ROLE_INVALID"
  | "ITEM_IDENTITY_MISSING"
  | "ROLE_NOT_ALLOWED"
  | "COMPANY_DOMAIN_MISMATCH"
  | "SOURCE_HASH_MISMATCH"
  | "COMPANY_EXCERPT_NOT_VERBATIM"
  | "ROLE_EXCERPT_NOT_VERBATIM"
  | "CAPABILITY_EXCERPT_NOT_VERBATIM"
  | "CAPABILITY_PROFILE_MISMATCH"
  | "COMPANY_NAME_NOT_IN_EXCERPT"
  | "ROLE_NOT_EXPLICIT";

export type SupplierLeadValidationDecisionStage =
  | "CAPTURE"
  | "PROPOSAL"
  | "SOURCE"
  | "EVIDENCE"
  | "PROFILE"
  | "RESULT";

export type SupplierLeadValidationDecision = {
  code: SupplierLeadValidationDecisionCode;
  stage: SupplierLeadValidationDecisionStage;
  accepted: boolean;
  provider: SupplierResearchRetrievalCapture["provider"];
  itemKey: string;
  queryProfile: SupplierResearchQueryProfile;
  recordIndex: number | null;
  searchRank: number | null;
  sourceUrl: string | null;
  sourceHostname: string | null;
  proposedRole: SupplierCandidateRole | null;
};

export type PublicSupplierLeadEvaluation = {
  receipts: PublicSupplierLeadReceipt[];
  decisions: SupplierLeadValidationDecision[];
};

export type ExaSupplierResearchResult = SupplierResearchResult & {
  retrieval: ExaRetrievalCapture;
  publicListingReceipts: PublicListingReceipt[];
  publicSupplierLeadReceipts: PublicSupplierLeadReceipt[];
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ExaDependencies = {
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, max = 1_000) {
  return typeof value === "string"
    ? value.replace(/\u2014/g, " - ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function sourceClaim(value: unknown, max = 1_500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dbRepresentableAmount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Number.isSafeInteger(value * 1_000_000) ? value : null;
}

function exactNumericTextValue(value: string) {
  const plain = value.replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(plain)) return null;
  const parsed = Number(plain);
  return dbRepresentableAmount(parsed) === null ? null : parsed;
}

function publicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase();
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
    if (
      !hostname
      || hostname === "localhost"
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || isIP(unwrappedHostname) !== 0
    ) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function sameUrl(left: unknown, right: unknown) {
  const a = publicUrl(left);
  const b = publicUrl(right);
  return Boolean(a && b && a === b);
}

function bindContentResults(args: {
  requestedUrls: string[];
  results: JsonRecord[];
  statuses: ExaSourceStatus[];
}) {
  const bindings = new Map<number, number>();
  const consumedResults = new Set<number>();

  for (const [requestIndex, requestedUrl] of args.requestedUrls.entries()) {
    const idMatches = args.results.flatMap((candidate, resultIndex) => (
      sameUrl(candidate.id, requestedUrl) ? [resultIndex] : []
    ));
    if (idMatches.length > 1) return null;
    const resultIndex = idMatches[0];
    if (resultIndex === undefined) continue;
    if (consumedResults.has(resultIndex)) return null;
    bindings.set(requestIndex, resultIndex);
    consumedResults.add(resultIndex);
  }

  for (const [requestIndex, requestedUrl] of args.requestedUrls.entries()) {
    if (bindings.has(requestIndex)) continue;
    const urlMatches = args.results.flatMap((candidate, resultIndex) => (
      !consumedResults.has(resultIndex) && sameUrl(candidate.url, requestedUrl) ? [resultIndex] : []
    ));
    if (urlMatches.length > 1) return null;
    const resultIndex = urlMatches[0];
    if (resultIndex === undefined) continue;
    bindings.set(requestIndex, resultIndex);
    consumedResults.add(resultIndex);
  }

  const boundResults = args.requestedUrls.map((requestedUrl, requestIndex) => {
    const status = args.statuses.find((candidate) => sameUrl(candidate.id, requestedUrl));
    const resultIndex = bindings.get(requestIndex);
    if (status?.status === "success" && resultIndex === undefined) return undefined;
    return resultIndex === undefined ? null : args.results[resultIndex];
  });
  return boundResults.some((result) => result === undefined)
    ? null
    : boundResults as Array<JsonRecord | null>;
}

function boundedJsonValue(value: unknown, max = 4_000) {
  try {
    return JSON.stringify(value).length <= max;
  } catch {
    return false;
  }
}

function parseStatus(value: unknown): ExaSourceStatus | null {
  const raw = record(value);
  const id = text(raw.id, 2_000);
  const status = text(raw.status, 80).toLowerCase();
  if (!id || !status || !boundedJsonValue(value)) return null;
  const error = record(raw.error);
  const statusCode = raw.httpStatusCode ?? error.httpStatusCode;
  const cacheValue = text(raw.cacheState ?? raw.cacheStatus ?? raw.source, 80).toLowerCase();
  return {
    id,
    status,
    errorTag: text(raw.errorTag ?? error.tag, 120) || null,
    httpStatusCode: typeof statusCode === "number" && Number.isInteger(statusCode)
      ? statusCode
      : null,
    cacheState: cacheValue || (raw.cached === true ? "cached" : null),
    cacheAgeHours: typeof raw.cacheAgeHours === "number" && Number.isFinite(raw.cacheAgeHours)
      ? raw.cacheAgeHours
      : null,
  };
}

function parseProposal(value: unknown): ExaOfferProposal | null {
  let rawValue = value;
  if (typeof rawValue === "string") {
    try {
      rawValue = JSON.parse(rawValue);
    } catch {
      return null;
    }
  }
  const raw = record(rawValue);
  if (!Object.keys(raw).length || !boundedJsonValue(raw, 8_000)) return null;
  const nullableText = (candidate: unknown, max: number) => text(candidate, max) || null;
  const nullablePositiveNumber = (candidate: unknown) => dbRepresentableAmount(candidate);
  return {
    supplierName: nullableText(raw.supplierName, 180),
    supplierRole: nullableText(raw.supplierRole, 40),
    companyIdentityEvidence: sourceClaim(raw.companyIdentityEvidence, 1_000) || null,
    supplierRoleEvidence: sourceClaim(raw.supplierRoleEvidence, 1_000) || null,
    productCapabilityEvidence: sourceClaim(raw.productCapabilityEvidence, 1_000) || null,
    itemIdentity: nullableText(raw.itemIdentity, 500),
    manufacturer: nullableText(raw.manufacturer, 180),
    mpn: nullableText(raw.mpn, 180),
    priceAmount: nullablePositiveNumber(raw.priceAmount),
    currency: nullableText(raw.currency, 20),
    unitOfMeasure: nullableText(raw.unitOfMeasure, 80),
    packageQuantity: nullablePositiveNumber(raw.packageQuantity),
    evidenceText: sourceClaim(raw.evidenceText, 1_500) || null,
  };
}

function normalizedIdentity(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function identityWords(value: string) {
  return value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [] as string[];
}

const GENERIC_IDENTITY_WORDS = new Set([
  "a", "an", "and", "as", "at", "blank", "blanks", "by", "cut", "for", "from", "general",
  "in", "internal", "into", "item", "main", "nominal", "of", "on", "or", "part", "parts",
  "per", "piece", "pieces", "procurement", "request", "requested", "stock", "supplier", "system",
  "the", "to", "with", "without", "released", "drawing", "drawings", "customer", "specified",
  "supplier", "deliverable", "material", "certificate", "certificates", "certification", "conformance",
  "showing", "heat", "lot", "trace", "traceability", "datasheet", "report", "reports", "inspection",
  "documentation", "number", "identification", "technical", "batch", "date", "code", "remaining",
  "safety", "digital", "digitally", "against", "bom", "signed", "record", "records", "approval",
  "serial", "serialization", "actual", "measured", "tooling", "process", "quality", "fabrication",
]);

function requiredIdentityTerms(input: ExaSupplierResearchInput) {
  const meaningful = (value: string) => (
    value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu) ?? [] as string[]
  ).filter((word) => word.length >= 2 && !GENERIC_IDENTITY_WORDS.has(word));
  const specificationWords = meaningful(input.specification ?? "");
  const componentWords = meaningful(input.componentName);
  const specificationSet = new Set(specificationWords);
  const componentIdentifierContext = componentWords.flatMap((word, index) => (
    /\d/.test(word) ? componentWords.slice(index, index + 3) : []
  ));
  const sharedComponentTerms = componentWords.filter((word) => specificationSet.has(word));
  const baseTerms = specificationWords.length ? specificationWords : componentWords;
  return [...new Set([...baseTerms, ...componentIdentifierContext, ...sharedComponentTerms])];
}

function requiredDimensionPhrases(input: ExaSupplierResearchInput) {
  const identity = `${input.componentName} ${input.specification ?? ""}`;
  return [...new Set((identity.match(/\b\d+(?:[.,]\d+)?\s*(?:mm|cm|inches|inch|in|gauge|ga|mil|um)\b/gi) ?? [])
    .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase()))];
}

function exactSourceExcerpt(source: string, claimed: string) {
  if (!source || !claimed) return null;
  const directIndex = source.indexOf(claimed);
  if (directIndex >= 0) return source.slice(directIndex, directIndex + claimed.length);
  const normalizedClaim = claimed.replace(/\s+/gu, " ").trim();
  if (!normalizedClaim) return null;
  let normalizedSource = "";
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  let inWhitespace = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) {
      if (!normalizedSource || inWhitespace) {
        if (inWhitespace && rawEnds.length) rawEnds[rawEnds.length - 1] = index + 1;
        continue;
      }
      normalizedSource += " ";
      rawStarts.push(index);
      rawEnds.push(index + 1);
      inWhitespace = true;
      continue;
    }
    normalizedSource += character;
    rawStarts.push(index);
    rawEnds.push(index + 1);
    inWhitespace = false;
  }
  const normalizedIndex = normalizedSource.indexOf(normalizedClaim);
  if (normalizedIndex < 0) return null;
  const rawStart = rawStarts[normalizedIndex];
  const rawEnd = rawEnds[normalizedIndex + normalizedClaim.length - 1];
  return rawStart === undefined || rawEnd === undefined ? null : source.slice(rawStart, rawEnd);
}

function containsWord(haystack: string, needle: string) {
  return identityWords(haystack).includes(needle.toLowerCase());
}

function containsPhrase(haystack: string, needle: string) {
  const sourceWords = identityWords(haystack);
  const requestedWords = identityWords(needle);
  if (!requestedWords.length || requestedWords.length > sourceWords.length) return false;
  return sourceWords.some((_, index) => requestedWords.every((word, offset) => sourceWords[index + offset] === word));
}

function containsDimensionPhrase(haystack: string, needle: string) {
  const tokens = (value: string) => value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\binches?\b/g, "in")
    .match(/\d+(?:\.\d+)?|[\p{L}]+/gu) ?? [];
  const sourceTokens = tokens(haystack);
  const requestedTokens = tokens(needle);
  if (!requestedTokens.length || requestedTokens.length > sourceTokens.length) return false;
  return sourceTokens.some((_, index) => requestedTokens.every((token, offset) => sourceTokens[index + offset] === token));
}

function containsIdentityTerm(haystack: string, term: string) {
  if (/\d|\./.test(term)) return containsDimensionPhrase(haystack, term);
  const singular = (word: string) => {
    if (/[^s]ies$/u.test(word)) return `${word.slice(0, -3)}y`;
    if (/(?:sses|shes|ches|xes|zes)$/u.test(word)) return word.slice(0, -2);
    return /[^s]s$/u.test(word) ? word.slice(0, -1) : word;
  };
  const sourceWords = identityWords(haystack).map(singular);
  const termWords = identityWords(term).map(singular);
  if (!termWords.length || termWords.length > sourceWords.length) return false;
  return sourceWords.some((_, index) => termWords.every((word, offset) => sourceWords[index + offset] === word));
}

function containsAmount(source: string, amount: number) {
  const values = source.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return values.some((value) => exactNumericTextValue(value) === amount);
}

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(value: string) {
  return value.trim().split(/\s+/u).map(regexEscape).join("\\s+");
}

function identityOccurrences(source: string, identity: string) {
  const words = identityWords(identity);
  if (!words.length) return [];
  const pattern = new RegExp(words.map(regexEscape).join("[^\\p{L}\\p{N}]+"), "giu");
  return [...source.matchAll(pattern)].flatMap((match) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = start > 0 ? source[start - 1] ?? "" : "";
    const after = end < source.length ? source[end] ?? "" : "";
    return (!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))
      ? [{ start, end }]
      : [];
  });
}

function explicitIdentityPriceRelation(value: string) {
  const relation = value.trim();
  if (/^[|,:=()[\]/*#\s-]*$/u.test(relation)) return true;
  return /^[|,:=()[\]/*#\s-]*(?:(?:is\s+)?(?:listed|offered|available|priced)\s+(?:for|at)|(?:unit\s+)?price(?:\s+is)?|costs?|for|at)[|,:=()[\]/*#\s-]*$/iu.test(relation);
}

const ISO_4217_CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);

function isIsoCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value) && ISO_4217_CURRENCIES.has(value);
}

function boundPriceTupleWindow(source: string, amount: number, currency: string, unit: string, itemIdentity: string) {
  const matches = [...source.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)];
  for (const match of matches) {
    const value = match[0];
    const parsed = exactNumericTextValue(value);
    if (parsed !== amount) continue;
    const index = match.index ?? 0;
    const delimiters = [". ", ".\n", "\n", "; "];
    const starts = delimiters.map((delimiter) => {
      const found = source.lastIndexOf(delimiter, index - 1);
      return found < 0 ? -1 : found + delimiter.length - 1;
    });
    const sentenceStart = Math.max(...starts);
    const ends = delimiters.map((delimiter) => source.indexOf(delimiter, index + value.length)).filter((candidate) => candidate >= 0);
    const sentenceEnd = ends.length ? Math.min(...ends) + 1 : source.length;
    const rowWindow = source.slice(sentenceStart + 1, sentenceEnd).trim();
    const identityPrefix = source.slice(Math.max(0, sentenceStart + 1 - 500), sentenceStart + 1);
    const rowBeforeAmount = source.slice(sentenceStart + 1, index);
    const bridgeRowStartsWithTuple = new RegExp(
      `^[\\s|>*#:[\\]()-]*(?:${regexEscape(currency)}\\s*(?:[:=]\\s*)?)?$`,
      "iu",
    ).test(rowBeforeAmount);
    const bridgeAcrossSingleNewline = sentenceStart >= 0
      && source[sentenceStart] === "\n"
      && /\b(?:for|at|price|cost|costs|priced)\s*$/iu.test(identityPrefix)
      && bridgeRowStartsWithTuple;
    const priorDelimiters = [". ", ".\n", "\n", "; "];
    const priorStarts = priorDelimiters.map((delimiter) => {
      const found = source.lastIndexOf(delimiter, sentenceStart - 1);
      return found < 0 ? -1 : found + delimiter.length - 1;
    });
    const priorStart = Math.max(...priorStarts);
    const window = bridgeAcrossSingleNewline
      ? source.slice(priorStart + 1, sentenceEnd).trim()
      : rowWindow;
    const amountPattern = regexEscape(value);
    const currencyPattern = `\\b${regexEscape(currency)}\\b`;
    const unitPattern = phrasePattern(unit);
    const tuple = new RegExp(
      `(?:${currencyPattern}\\s*(?:[:=]\\s*)?${amountPattern}|${amountPattern}\\s*${currencyPattern})\\s*(?:/\\s*|per\\s+)?${unitPattern}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    const tupleMatch = tuple.exec(window);
    if (!tupleMatch || tupleMatch.index === undefined) continue;
    const identityMatch = identityOccurrences(window.slice(0, tupleMatch.index), itemIdentity).at(-1);
    if (!identityMatch || !explicitIdentityPriceRelation(window.slice(identityMatch.end, tupleMatch.index))) continue;
    return window;
  }
  return null;
}

function successfulFreshStatus(status: ExaSourceStatus | null, sourceUrl?: string) {
  if (!status || status.status !== "success") return false;
  if (sourceUrl && !sameUrl(status.id, sourceUrl)) return false;
  if (status.errorTag) return false;
  if (status.httpStatusCode !== null && (status.httpStatusCode < 200 || status.httpStatusCode >= 300)) return false;
  if (status.cacheAgeHours !== null && status.cacheAgeHours > 0) return false;
  if (status.cacheState && /cache|stale/.test(status.cacheState)) return false;
  return true;
}

function plausibleServerRetrievedAt(value: string, now = new Date()) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime() + 5 * 60_000;
}

function receiptBase(receipt: Omit<PublicListingReceipt, "candidateId" | "receiptHash">) {
  return {
    provider: receipt.provider,
    itemKey: receipt.itemKey,
    itemIdentity: receipt.itemIdentity,
    manufacturer: receipt.manufacturer,
    mpn: receipt.mpn,
    amount: receipt.amount,
    currency: receipt.currency,
    unitOfMeasure: receipt.unitOfMeasure,
    packageQuantity: receipt.packageQuantity,
    sourceUrl: receipt.sourceUrl,
    sourceTitle: receipt.sourceTitle,
    evidenceExcerpt: receipt.evidenceExcerpt,
    sourceTextHash: receipt.sourceTextHash,
    searchRequestId: receipt.searchRequestId,
    contentsRequestId: receipt.contentsRequestId,
    contentsResponseHash: receipt.contentsResponseHash,
    retrievedAt: receipt.retrievedAt,
    freshnessPolicy: receipt.freshnessPolicy,
  };
}

export function publicListingReceiptHash(receipt: Omit<PublicListingReceipt, "candidateId" | "receiptHash">) {
  return hash(JSON.stringify(receiptBase(receipt)));
}

const SUPPLIER_ROLES = new Set<SupplierCandidateRole>([
  "MANUFACTURER",
  "DISTRIBUTOR",
  "PRODUCER",
  "PROCESSOR",
  "EXPORTER",
  "TRADER",
  "SERVICE_PROVIDER",
]);

function supplierRole(value: unknown): SupplierCandidateRole | null {
  const proposed = text(value, 60).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliases: Record<string, SupplierCandidateRole> = {
    AUTHORIZED_DISTRIBUTOR: "DISTRIBUTOR",
    STOCKING_DISTRIBUTOR: "DISTRIBUTOR",
    STOCKIST: "DISTRIBUTOR",
    SERVICE_CENTER: "DISTRIBUTOR",
    METAL_SERVICE_CENTER: "DISTRIBUTOR",
    INDUSTRIAL_SUPPLIER: "DISTRIBUTOR",
    PACKAGING_SUPPLIER: "DISTRIBUTOR",
    MACHINE_SHOP: "PROCESSOR",
    CNC_MACHINE_SHOP: "PROCESSOR",
    FABRICATOR: "PROCESSOR",
    FABRICATION_SHOP: "PROCESSOR",
    HARNESS_ASSEMBLER: "SERVICE_PROVIDER",
    WIRE_HARNESS_ASSEMBLER: "SERVICE_PROVIDER",
    CABLE_ASSEMBLY_SERVICE: "SERVICE_PROVIDER",
    PACKAGING_SERVICE: "SERVICE_PROVIDER",
    INSPECTION_LABORATORY: "SERVICE_PROVIDER",
    CALIBRATION_LABORATORY: "SERVICE_PROVIDER",
    METROLOGY_LABORATORY: "SERVICE_PROVIDER",
  };
  const role = (aliases[proposed] ?? proposed) as SupplierCandidateRole;
  return SUPPLIER_ROLES.has(role) ? role : null;
}

function roleAllowedForInput(input: ExaSupplierResearchInput, role: SupplierCandidateRole) {
  return input.componentItemKey.startsWith("request:")
    || input.componentItemKey.startsWith("GUILD-")
    || role === "MANUFACTURER"
    || role === "DISTRIBUTOR";
}

const ROLE_EVIDENCE_PATTERNS: Record<SupplierCandidateRole, RegExp> = {
  MANUFACTURER: /\b(?:manufacturer|manufacturing company|contract manufactur\w*|manufactures?|maker|build[- ]to[- ]print|machine shop|fabricator|fabrication shop|cable assembl\w*|wire harness assembl\w*|case manufacturer)\b/i,
  DISTRIBUTOR: /\b(?:distributor|distribution company|distributes?|supplier|stockist|service center|stocks?|sells?|industrial supply|packaging supplier)\b/i,
  PRODUCER: /\b(?:producer|produces?|mill|converter)\b/i,
  PROCESSOR: /\b(?:processor|processing company|material processing|processes?|service center|machine shop|fabricator|fabrication shop|cnc machining|cut[- ]to[- ]size)\b/i,
  EXPORTER: /\b(?:exporter|exports?|export supplier)\b/i,
  TRADER: /\b(?:trader|trading company|trades?|industrial trading)\b/i,
  SERVICE_PROVIDER: /\b(?:service provider|inspection service|inspection company|inspection laboratory|metrology lab(?:oratory)?|testing laboratory|calibration laboratory|harness assembl\w*|cable assembl\w*|wire harness assembl\w*|custom packaging|packaging service)\b/i,
};

function explicitRoleEvidence(value: string, role: SupplierCandidateRole) {
  return ROLE_EVIDENCE_PATTERNS[role].test(value)
    && !/\b(?:does not|do not|is not|are not|never|no longer|not currently)\b.{0,60}\b(?:manufactur|distribut|produc|process|export|trad|service|inspect|metrology|laborator)\w*\b/i.test(value);
}

function explicitMaterialRoleEvidence(value: string, role: SupplierCandidateRole) {
  if (explicitRoleEvidence(value, role)) return true;
  if (/\b(?:does not|do not|is not|are not|never|no longer|not currently)\b.{0,60}\b(?:stockist|service center)\b/i.test(value)) {
    return false;
  }
  if (role === "DISTRIBUTOR") return /\b(?:metal\s+)?(?:stockist|service center)\b/i.test(value);
  if (role === "PROCESSOR") return /\b(?:metal\s+)?service center\b/i.test(value);
  return false;
}

function containsAnyIdentityTerm(value: string, terms: string[]) {
  return terms.some((term) => containsIdentityTerm(value, term));
}

function requestedTerms(value: string, vocabulary: readonly string[]) {
  return vocabulary.filter((term) => containsIdentityTerm(value, term));
}

const MATERIAL_TERMS = [
  "aluminum", "aluminium", "stainless", "steel", "g10", "fr-4", "fr4", "glass epoxy", "nylon", "peek", "silicone", "epdm", "polyethylene",
] as const;
const MATERIAL_FORM_TERMS = [
  "sheet", "plate", "angle", "extrusion", "laminate", "bar stock", "machining stock", "blank", "foam",
] as const;
const MATERIAL_GRADE_TERMS = [
  "6061-t6", "6061-t651", "5052-h32", "a2", "304", "g10", "fr-4", "fr4",
] as const;
const MATERIAL_GRADE_LABELS: Record<(typeof MATERIAL_GRADE_TERMS)[number], string> = {
  "6061-t6": "6061-T6",
  "6061-t651": "6061-T651",
  "5052-h32": "5052-H32",
  a2: "A2",
  "304": "304",
  g10: "G10",
  "fr-4": "FR-4",
  fr4: "FR-4",
};
const CUSTOM_PROCESS_TERMS = [
  "machining", "machined", "cnc", "fabrication", "fabricator", "build to print", "laser etched", "engraving", "anodizing", "printed circuit board",
] as const;
const CUSTOM_FABRICATION_PRODUCT_TERMS = [
  "rail", "enclosure", "carrier", "nameplate", "printed circuit board", "pcb",
] as const;
const GENERIC_PRODUCT_TERMS = [
  "isolator", "mount", "fastener", "screw", "washer", "locknut", "nut", "threaded insert", "epoxy", "adhesive", "solvent", "isopropyl alcohol", "primer", "topcoat",
  "wire", "cable", "sleeve", "sleeving", "heat shrink", "connector", "standoff", "insert", "strap", "edge trim", "thermal pad", "lacquer", "cap", "plug",
] as const;
const GENERIC_QUALIFIER_TERMS = [
  "vibration", "silicone", "elastomer", "stainless", "304", "a2", "socket head", "m3", "m4", "m5", "passivated",
  "flat", "prevailing torque", "helical thread", "high purity", "99 percent", "electronics grade", "corrosion resistant",
  "epoxy", "aluminum compatible", "polyurethane", "matte", "22 awg", "18 awg", "stranded copper", "etfe", "600 v",
  "2 conductor", "twisted", "shielded", "fluoropolymer", "printable", "thermal transfer", "braided",
  "expandable", "dual wall", "adhesive lined", "3:1", "circular", "multipole", "metallic shell", "positive locking",
  "nylon", "peek", "tinned copper", "grounding", "ring terminal", "epdm",
  "electrically insulating", "torque seal", "witness", "antistatic", "dust cover",
  "polyolefin",
] as const;
const GENERIC_QUALIFIER_ALTERNATIVES = [
  ["a2", "304"],
  ["fluoropolymer", "polyolefin"],
  ["nylon", "peek"],
  ["silicone", "epdm"],
  ["torque seal", "witness"],
] as const;

function containsMaterialGrade(value: string, grade: (typeof MATERIAL_GRADE_TERMS)[number]) {
  const normalizedGrade = grade.replace(/[^a-z0-9]+/g, "");
  if (normalizedGrade === "fr4") return /\bfr\s*[-/]?\s*4\b/i.test(value);
  const words = identityWords(value).map((word) => word.replace(/[^a-z0-9]+/g, ""));
  if (words.includes(normalizedGrade)) return true;
  const alloyTemper = normalizedGrade.match(/^(\d{4})([th]\d+)$/);
  if (!alloyTemper) return words.includes(normalizedGrade === "fr4" ? "fr4" : normalizedGrade);
  const [, alloy, temper] = alloyTemper;
  const alloyIndexes = words.flatMap((word, index) => (
    word === alloy || word === `al${alloy}` ? [index] : []
  ));
  const temperIndexes = words.flatMap((word, index) => word === temper ? [index] : []);
  return alloyIndexes.some((alloyIndex) => temperIndexes.some((temperIndex) => {
    const first = Math.min(alloyIndex, temperIndex);
    const last = Math.max(alloyIndex, temperIndex);
    if (last - first > 6) return false;
    return !words.slice(first + 1, last).some((word) => /^\d{4}$/.test(word) && word !== alloy);
  }));
}

function requestedMaterialMatch(requested: string, capabilityExcerpt: string) {
  const materials = requestedTerms(requested, MATERIAL_TERMS);
  if (!materials.length) return null;
  if (materials.includes("stainless")) {
    return containsIdentityTerm(capabilityExcerpt, "stainless") ? "stainless steel" : null;
  }
  if (materials.includes("aluminum") || materials.includes("aluminium")) {
    return containsIdentityTerm(capabilityExcerpt, "aluminum") || containsIdentityTerm(capabilityExcerpt, "aluminium")
      ? "aluminum"
      : null;
  }
  const material = materials.find((term) => containsIdentityTerm(capabilityExcerpt, term));
  if (!material) return null;
  if (material === "fr4") return "FR-4";
  if (material === "fr-4") return "FR-4";
  if (material === "g10") return "G10";
  return material;
}

function materialStockCapability(requested: string, capabilityExcerpt: string) {
  const requiresFlameRetardantFr4 = /\bflame[- ]retardant\b/i.test(requested)
    && /\bfr[- ]?4\b/i.test(requested);
  if (requiresFlameRetardantFr4 && !containsMaterialGrade(capabilityExcerpt, "fr-4")) return null;
  const material = requestedMaterialMatch(requested, capabilityExcerpt);
  const requestedForms = requestedTerms(requested, MATERIAL_FORM_TERMS);
  const form = requestedForms.find((term) => containsIdentityTerm(capabilityExcerpt, term));
  const requestedGrades = MATERIAL_GRADE_TERMS.filter((grade) => containsMaterialGrade(requested, grade));
  const grade = requestedGrades.find((candidate) => containsMaterialGrade(capabilityExcerpt, candidate));
  if (!material || !form || (requestedGrades.length > 0 && !grade)) return null;
  const parts = [grade ? MATERIAL_GRADE_LABELS[grade] : null, material, form];
  const seen = new Set<string>();
  return parts.filter((part): part is string => {
    if (!part) return false;
    const normalized = normalizedIdentity(part);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).join(" ");
}

type RequestedNumericRange = { minimum: number; maximum: number; unit: string };

function requestedNumericRanges(value: string): RequestedNumericRange[] {
  return [...value.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(?:to|through|[-–])\s*(\d+(?:\.\d+)?)\s*(awg|mm|contacts?|shore\s*a)\b/g)]
    .map((match) => ({
      minimum: Math.min(Number(match[1]), Number(match[2])),
      maximum: Math.max(Number(match[1]), Number(match[2])),
      unit: (match[3] ?? "").replace(/\s+/g, " ").replace(/^contact$/, "contacts"),
    }))
    .filter((range) => Number.isFinite(range.minimum) && Number.isFinite(range.maximum) && Boolean(range.unit));
}

function capabilitySupportsNumericRange(value: string, range: RequestedNumericRange) {
  const unitPattern = range.unit === "contacts" ? "contacts?" : range.unit === "shore a" ? "shore\\s*a" : regexEscape(range.unit);
  const measurements = [...value.toLowerCase().matchAll(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:[- ]\\s*)?${unitPattern}\\b`, "g"))];
  return measurements.some((match) => {
    const measurement = Number(match[1]);
    return Number.isFinite(measurement) && measurement >= range.minimum && measurement <= range.maximum;
  });
}

function requiredStandaloneDimensions(value: string, ranges: RequestedNumericRange[]) {
  return (value.toLowerCase().match(/\b\d+(?:\.\d+)?\s*(?:awg|v|mm|in|inch|inches|percent|%)\b/g) ?? []).filter((dimension) => {
    const match = dimension.match(/(\d+(?:\.\d+)?)\s*([a-z%]+)/);
    if (!match) return true;
    const amount = Number(match[1]);
    const unit = match[2] === "contact" ? "contacts" : match[2];
    return !ranges.some((range) => range.unit === unit && range.maximum === amount);
  });
}

function supportsRequestedFabricationProcesses(requested: string, capabilityExcerpt: string) {
  const checks: Array<[boolean, RegExp]> = [
    [/\b(?:machin(?:ed|ing)?|cnc)\b/i.test(requested), /\b(?:machin\w*|cnc)\b/i],
    [/\bfabricat\w*\b/i.test(requested), /\bfabricat\w*\b/i],
    [/\bbuild[- ]to[- ]print\b/i.test(requested), /\bbuild[- ]to[- ]print\b/i],
    [/\blaser[- ]etched\b/i.test(requested), /\b(?:laser[- ]etch\w*|engrave\w*)\b/i],
    [/\bengraving\b/i.test(requested), /\b(?:engrave\w*|laser[- ]etch\w*)\b/i],
    [/\banodiz\w*\b/i.test(requested), /\banodiz\w*\b/i],
    [/\bprinted circuit board\b/i.test(requested), /\b(?:printed circuit board|pcb)\b/i],
  ];
  return checks.every(([required, pattern]) => !required || pattern.test(capabilityExcerpt));
}

function supportsPackagingProducts(requested: string, capabilityExcerpt: string) {
  const checks: Array<[boolean, RegExp]> = [
    [/\bfoam\b/i.test(requested), /\bfoam\b/i],
    [/\bantistatic bags?\b/i.test(requested), /\b(?:(?:anti[- ]?static|esd)\s+bags?|bags?\s+(?:for\s+)?(?:anti[- ]?static|esd))\b/i],
    [/\bhumidity indicators?\b/i.test(requested), /\bhumidity\s+(?:indicators?|cards?)\b/i],
    [/\bshipping cases?\b/i.test(requested), /\b(?:shipping|transit|transport)\s+cases?\b/i],
  ];
  return checks.some(([required]) => required) && checks.every(([required, pattern]) => !required || pattern.test(capabilityExcerpt));
}

function supportedProductCapability(
  input: ExaSupplierResearchInput,
  itemIdentity: string,
  capabilityExcerpt: string,
) {
  if (/\b(?:does not|do not|never|no longer|not currently)\b.{0,60}\b(?:manufactur|distribut|suppl|stock|offer|provid|fabricat|machin|process|assembl|calibrat|inspect|sell)\w*\b/i.test(capabilityExcerpt)) {
    return null;
  }
  const productSpecification = (input.specification ?? "").split(/\.\s*Supplier (?:QA|deliverable):/i)[0] ?? "";
  const requested = `${input.componentName} ${input.manufacturer ?? ""} ${input.mpn ?? ""} ${productSpecification}`;
  const { plan } = selectedSupplierResearchQueryVariant(input);
  if (plan.profile === "MATERIAL_STOCK") return materialStockCapability(requested, capabilityExcerpt);
  if (!/\b(?:manufactur|distribut|suppl|stock|offer|provid|fabricat|machin|process|assembl|calibrat|inspect|metrology|measur|test(?:ing)? laborator|sell|lists?|specializ|service center|produc|export|trad)\w*\b/i.test(capabilityExcerpt)) {
    return null;
  }
  const permitsBrandedEquivalent = plan.profile === "BRANDED_COTS" && /\bor equivalent\b/i.test(productSpecification);
  if (input.manufacturer && !containsPhrase(itemIdentity, input.manufacturer) && !permitsBrandedEquivalent) return null;
  if (input.mpn && !containsPhrase(itemIdentity, input.mpn) && !permitsBrandedEquivalent) return null;
  if (plan.profile === "BRANDED_COTS") {
    if (!containsIdentityTerm(capabilityExcerpt, itemIdentity)) return null;
    const brandTerms = requestedTerms(requested, ["3m", "scotch-weld", "dowsil"]);
    const identifiers = (requested.toLowerCase().match(/\b(?:[a-z]+\d+[a-z0-9.-]*|\d+[a-z]+[a-z0-9.-]*|\d{4,})\b/g) ?? [])
      .filter((term) => !/^(?:600v|2026)$/.test(term));
    const exactBrandMatch = (!brandTerms.length || brandTerms.every((term) => containsIdentityTerm(capabilityExcerpt, term)))
      && (!identifiers.length || identifiers.every((term) => containsIdentityTerm(capabilityExcerpt, term)))
    if (exactBrandMatch) return itemIdentity;
    if (!/\bor equivalent\b/i.test(productSpecification)) return null;
    if (/\bdp\s*420\b|\bscotch[- ]weld\b/i.test(requested)) {
      return containsIdentityTerm(capabilityExcerpt, "two-part")
        && containsIdentityTerm(capabilityExcerpt, "structural epoxy")
        && /\broom[- ]temperature\s+(?:cur\w*|cure)\b/i.test(capabilityExcerpt)
        ? itemIdentity
        : null;
    }
    if (/\bdowsil\b|\b3145\b/i.test(requested)) {
      return containsIdentityTerm(capabilityExcerpt, "silicone")
        && containsAnyIdentityTerm(capabilityExcerpt, ["adhesive", "sealant"])
        && containsIdentityTerm(capabilityExcerpt, "neutral-cure")
        && containsIdentityTerm(capabilityExcerpt, "electronics-grade")
        ? itemIdentity
        : null;
    }
    return null;
  }
  if (plan.profile === "CUSTOM_FABRICATION") {
    const materials = requestedTerms(requested, MATERIAL_TERMS);
    const grades = requestedTerms(requested, MATERIAL_GRADE_TERMS);
    const productClasses = requestedTerms(requested, CUSTOM_FABRICATION_PRODUCT_TERMS);
    const dimensions = requested.toLowerCase().match(/\b\d+(?:\.\d+)?\s*(?:mm|in|inch|inches)\b/g) ?? [];
    return requestedTerms(requested, CUSTOM_PROCESS_TERMS).length > 0
      && productClasses.length > 0
      && containsAnyIdentityTerm(capabilityExcerpt, productClasses)
      && supportsRequestedFabricationProcesses(requested, capabilityExcerpt)
      && (!materials.length || containsAnyIdentityTerm(capabilityExcerpt, materials))
      && grades.every((term) => containsIdentityTerm(capabilityExcerpt, term))
      && dimensions.every((dimension) => containsDimensionPhrase(capabilityExcerpt, dimension))
      ? capabilityExcerpt
      : null;
  }
  if (plan.profile === "CALIBRATED_INSTRUMENT") {
    const instruments = requestedTerms(requested, [
      "pt100", "rtd", "resistance temperature detector", "strain gauge", "accelerometer",
    ]);
    const instrumentRequest = `${input.componentName} ${productSpecification}`;
    const qualifiers = requestedTerms(instrumentRequest, [
      "3-wire", "adhesive", "surface mount", "aluminum compatible", "triaxial", "low voltage",
    ]);
    const dimensions = instrumentRequest.toLowerCase().match(/\b\d+(?:\.\d+)?\s*(?:ohm|v|mv|hz|khz)\b/g) ?? [];
    const mountingAlternatives = ["adhesive", "surface mount"].filter((term) => qualifiers.includes(term));
    const aluminumCompatibilityRequested = qualifiers.includes("aluminum compatible");
    const lowVoltageRequested = qualifiers.includes("low voltage");
    const requiredQualifiers = qualifiers.filter((term) => !mountingAlternatives.includes(term) && term !== "aluminum compatible" && term !== "low voltage");
    return instruments.length > 0
      && containsAnyIdentityTerm(capabilityExcerpt, instruments)
      && requiredQualifiers.every((term) => containsIdentityTerm(capabilityExcerpt, term))
      && (!aluminumCompatibilityRequested || (/\baluminum\b/i.test(capabilityExcerpt) && /\b(?:compatib|compensat|self[- ]temperature|use\s+on)\w*/i.test(capabilityExcerpt)))
      && (!lowVoltageRequested || /\b(?:low[- ]voltage|iepe|\d+(?:\.\d+)?\s*m?v\s*\/\s*g)\b/i.test(capabilityExcerpt))
      && (mountingAlternatives.length < 2 || mountingAlternatives.some((term) => containsIdentityTerm(capabilityExcerpt, term)))
      && dimensions.every((dimension) => containsDimensionPhrase(capabilityExcerpt, dimension))
      ? capabilityExcerpt
      : null;
  }
  if (plan.profile === "ASSEMBLY_SERVICE") {
    return /\b(?:wire|cable|data acquisition)?\s*harness\b/i.test(capabilityExcerpt)
      && /\b(?:assembl|build to print|continuity test|pin to pin)\w*\b/i.test(capabilityExcerpt)
      ? capabilityExcerpt
      : null;
  }
  if (plan.profile === "PACKAGING") {
    return supportsPackagingProducts(`${input.componentName} ${productSpecification}`, capabilityExcerpt) ? capabilityExcerpt : null;
  }
  if (plan.profile === "INSPECTION_SERVICE") {
    return /\b(?:first[- ]article|inspection|metrology|measurement|dimensional)\b/i.test(capabilityExcerpt)
      && /\b(?:inspect\w*|metrology|measur\w*|as9102|first[- ]article\s+report)\b/i.test(capabilityExcerpt)
      ? capabilityExcerpt
      : null;
  }
  const requestedProduct = `${input.componentName} ${input.manufacturer ?? ""} ${input.mpn ?? ""} ${productSpecification}`;
  const productTerms = requestedTerms(requestedProduct, GENERIC_PRODUCT_TERMS);
  const qualifiers = requestedTerms(requestedProduct, GENERIC_QUALIFIER_TERMS);
  const numericRanges = requestedNumericRanges(requestedProduct);
  const requestedAlternativeGroups = GENERIC_QUALIFIER_ALTERNATIVES
    .map((group) => group.filter((term) => qualifiers.includes(term)))
    .filter((group) => group.length > 1);
  const alternativeTerms = new Set<string>(requestedAlternativeGroups.flat());
  const requiredQualifiers = qualifiers.filter((term) => !alternativeTerms.has(term) && !/\bto\b/.test(term));
  const requestedDimensions = requiredStandaloneDimensions(requestedProduct, numericRanges);
  return productTerms.length > 0
    && containsAnyIdentityTerm(capabilityExcerpt, productTerms)
    && qualifiers.length > 0
    && requiredQualifiers.every((term) => containsIdentityTerm(capabilityExcerpt, term))
    && requestedAlternativeGroups.every((group) => group.some((term) => containsIdentityTerm(capabilityExcerpt, term)))
    && numericRanges.every((range) => capabilitySupportsNumericRange(capabilityExcerpt, range))
    && requestedDimensions.every((dimension) => containsDimensionPhrase(capabilityExcerpt, dimension))
    ? capabilityExcerpt
    : null;
}

function supplierLeadReceiptBase(receipt: Omit<PublicSupplierLeadReceipt, "candidateId" | "receiptHash">) {
  return {
    provider: receipt.provider,
    itemKey: receipt.itemKey,
    companyName: receipt.companyName,
    website: receipt.website,
    role: receipt.role,
    productCapability: receipt.productCapability,
    sourceUrl: receipt.sourceUrl,
    sourceTitle: receipt.sourceTitle,
    companyIdentityExcerpt: receipt.companyIdentityExcerpt,
    supplierRoleExcerpt: receipt.supplierRoleExcerpt,
    productCapabilityExcerpt: receipt.productCapabilityExcerpt,
    sourceTextHash: receipt.sourceTextHash,
    searchRequestId: receipt.searchRequestId,
    contentsRequestId: receipt.contentsRequestId,
    contentsResponseHash: receipt.contentsResponseHash,
    retrievedAt: receipt.retrievedAt,
    freshnessPolicy: receipt.freshnessPolicy,
  };
}

export function publicSupplierLeadReceiptHash(receipt: Omit<PublicSupplierLeadReceipt, "candidateId" | "receiptHash">) {
  return hash(JSON.stringify(supplierLeadReceiptBase(receipt)));
}

function supplierLeadDecisionSource(value: unknown) {
  const normalized = publicUrl(value);
  if (!normalized) return { sourceUrl: null, sourceHostname: null };
  const parsed = new URL(normalized);
  parsed.search = "";
  parsed.hash = "";
  return {
    sourceUrl: parsed.toString(),
    sourceHostname: parsed.hostname.toLowerCase(),
  };
}

export function evaluatePublicSupplierLeadReceipts(
  input: SupplierLeadValidationInput,
  capture: SupplierResearchRetrievalCapture,
): PublicSupplierLeadEvaluation {
  const receipts: PublicSupplierLeadReceipt[] = [];
  const decisions: SupplierLeadValidationDecision[] = [];
  const { plan } = selectedSupplierResearchQueryVariant(input);
  const materialStockRequest = plan.profile === "MATERIAL_STOCK";
  const decision = (args: {
    code: SupplierLeadValidationDecisionCode;
    stage: SupplierLeadValidationDecisionStage;
    accepted?: boolean;
    recordIndex?: number;
    source?: ExaRetrievedRecord | OpenAiRetrievedRecord;
    proposedRole?: SupplierCandidateRole | null;
  }): SupplierLeadValidationDecision => {
    const sanitized = supplierLeadDecisionSource(args.source?.sourceUrl);
    return {
      code: args.code,
      stage: args.stage,
      accepted: args.accepted ?? false,
      provider: capture.provider,
      itemKey: input.componentItemKey,
      queryProfile: plan.profile,
      recordIndex: args.recordIndex ?? null,
      searchRank: args.source?.searchRank ?? null,
      sourceUrl: sanitized.sourceUrl,
      sourceHostname: sanitized.sourceHostname,
      proposedRole: args.proposedRole ?? null,
    };
  };
  const rejectCapture = (
    code: SupplierLeadValidationDecisionCode,
  ): PublicSupplierLeadEvaluation => ({
    receipts,
    decisions: [decision({ code, stage: "CAPTURE" })],
  });

  if (capture.stage === "SEARCH_ONLY") return rejectCapture("CAPTURE_SEARCH_ONLY");
  if (!(
    (capture.provider === "EXA" && capture.freshnessPolicy === "FORCED_LIVE")
    || (capture.provider === "OPENAI" && capture.freshnessPolicy === "SERVER_RETRIEVED")
  )) return rejectCapture("CAPTURE_PROVIDER_POLICY_INVALID");
  if (capture.searchHttpStatus < 200 || capture.searchHttpStatus >= 300) {
    return rejectCapture("CAPTURE_SEARCH_HTTP_INVALID");
  }
  if (capture.contentsHttpStatus < 200 || capture.contentsHttpStatus >= 300) {
    return rejectCapture("CAPTURE_CONTENTS_HTTP_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(capture.searchResponseHash)) {
    return rejectCapture("CAPTURE_SEARCH_HASH_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(capture.contentsResponseHash)) {
    return rejectCapture("CAPTURE_CONTENTS_HASH_INVALID");
  }
  if (!plausibleServerRetrievedAt(capture.retrievedAt)) {
    return rejectCapture("CAPTURE_RETRIEVED_AT_INVALID");
  }
  if (!capture.records.length) return rejectCapture("CAPTURE_NO_RECORDS");

  for (const [recordIndex, source] of capture.records.entries()) {
    if (!source.proposal) {
      decisions.push(decision({ code: "PROPOSAL_MISSING", stage: "PROPOSAL", recordIndex, source }));
      continue;
    }
    if (!successfulFreshStatus(source.status, source.sourceUrl)) {
      decisions.push(decision({ code: "SOURCE_STATUS_NOT_FRESH", stage: "SOURCE", recordIndex, source }));
      continue;
    }
    const sourceUrl = publicUrl(source.sourceUrl);
    const companyName = text(source.proposal.supplierName, 180);
    const role = supplierRole(source.proposal.supplierRole);
    const itemIdentity = text(source.proposal.itemIdentity, 500);
    const sourceBody = [source.text, ...source.highlights].filter(Boolean).join("\n");
    if (!sourceUrl) {
      decisions.push(decision({ code: "SOURCE_URL_INVALID", stage: "SOURCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!isSupplierDiscoveryUrl(sourceUrl)) {
      decisions.push(decision({ code: "SOURCE_DOMAIN_DISALLOWED", stage: "SOURCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!companyName) {
      decisions.push(decision({ code: "COMPANY_MISSING", stage: "PROPOSAL", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!role) {
      decisions.push(decision({ code: "ROLE_INVALID", stage: "PROPOSAL", recordIndex, source }));
      continue;
    }
    if (!itemIdentity) {
      decisions.push(decision({ code: "ITEM_IDENTITY_MISSING", stage: "PROPOSAL", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!roleAllowedForInput(input, role)) {
      decisions.push(decision({ code: "ROLE_NOT_ALLOWED", stage: "PROFILE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!supplierCompanyMatchesDomain(companyName, sourceUrl)) {
      decisions.push(decision({ code: "COMPANY_DOMAIN_MISMATCH", stage: "SOURCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (source.sourceTextHash !== hash(sourceBody)) {
      decisions.push(decision({ code: "SOURCE_HASH_MISMATCH", stage: "SOURCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    const companyIdentityExcerpt = exactSourceExcerpt(sourceBody, text(source.proposal.companyIdentityEvidence, 1_000));
    const supplierRoleExcerpt = exactSourceExcerpt(sourceBody, text(source.proposal.supplierRoleEvidence, 1_000));
    const productCapabilityExcerpt = exactSourceExcerpt(sourceBody, text(source.proposal.productCapabilityEvidence, 1_000));
    const productCapability = productCapabilityExcerpt
      ? supportedProductCapability(input, itemIdentity, productCapabilityExcerpt)
      : null;
    if (!companyIdentityExcerpt) {
      decisions.push(decision({ code: "COMPANY_EXCERPT_NOT_VERBATIM", stage: "EVIDENCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!supplierRoleExcerpt) {
      decisions.push(decision({ code: "ROLE_EXCERPT_NOT_VERBATIM", stage: "EVIDENCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!productCapabilityExcerpt) {
      decisions.push(decision({ code: "CAPABILITY_EXCERPT_NOT_VERBATIM", stage: "EVIDENCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!productCapability) {
      decisions.push(decision({ code: "CAPABILITY_PROFILE_MISMATCH", stage: "PROFILE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!containsPhrase(companyIdentityExcerpt, companyName)) {
      decisions.push(decision({ code: "COMPANY_NAME_NOT_IN_EXCERPT", stage: "EVIDENCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    if (!(materialStockRequest
      ? explicitMaterialRoleEvidence(supplierRoleExcerpt, role)
      : explicitRoleEvidence(supplierRoleExcerpt, role))) {
      decisions.push(decision({ code: "ROLE_NOT_EXPLICIT", stage: "EVIDENCE", recordIndex, source, proposedRole: role }));
      continue;
    }
    const common = {
      itemKey: input.componentItemKey,
      companyName,
      website: new URL(sourceUrl).origin,
      role,
      productCapability,
      sourceUrl,
      sourceTitle: source.sourceTitle,
      companyIdentityExcerpt,
      supplierRoleExcerpt,
      productCapabilityExcerpt,
      sourceTextHash: source.sourceTextHash,
      searchRequestId: capture.searchRequestId,
      contentsRequestId: capture.contentsRequestId,
      contentsResponseHash: capture.contentsResponseHash,
      retrievedAt: capture.retrievedAt,
    };
    if (capture.provider === "EXA") {
      const base: Omit<ExaPublicSupplierLeadReceipt, "candidateId" | "receiptHash"> = {
        provider: "EXA",
        ...common,
        freshnessPolicy: "FORCED_LIVE",
      };
      receipts.push({ ...base, candidateId: null, receiptHash: publicSupplierLeadReceiptHash(base) });
    } else {
      const base: Omit<OpenAiPublicSupplierLeadReceipt, "candidateId" | "receiptHash"> = {
        provider: "OPENAI",
        ...common,
        freshnessPolicy: "SERVER_RETRIEVED",
      };
      receipts.push({ ...base, candidateId: null, receiptHash: publicSupplierLeadReceiptHash(base) });
    }
    decisions.push(decision({
      code: "ACCEPTED",
      stage: "RESULT",
      accepted: true,
      recordIndex,
      source,
      proposedRole: role,
    }));
  }
  return { receipts, decisions };
}

export function validatePublicSupplierLeadReceipts(
  input: SupplierLeadValidationInput,
  capture: SupplierResearchRetrievalCapture,
) {
  return evaluatePublicSupplierLeadReceipts(input, capture).receipts;
}

export function validateExaPublicSupplierLeadReceipts(
  input: ExaSupplierResearchInput,
  capture: ExaRetrievalCapture,
) {
  return validatePublicSupplierLeadReceipts(input, capture).filter(
    (receipt): receipt is ExaPublicSupplierLeadReceipt => receipt.provider === "EXA",
  );
}

export function validateExaPublicListingReceipts(
  input: ExaSupplierResearchInput,
  capture: ExaRetrievalCapture,
) {
  if (capture.stage === "SEARCH_ONLY") return [];
  if (
    capture.provider !== "EXA"
    || capture.freshnessPolicy !== "FORCED_LIVE"
    || capture.searchHttpStatus < 200 || capture.searchHttpStatus >= 300
    || capture.contentsHttpStatus < 200 || capture.contentsHttpStatus >= 300
    || !/^[a-f0-9]{64}$/.test(capture.searchResponseHash)
    || !/^[a-f0-9]{64}$/.test(capture.contentsResponseHash)
  ) return [];
  if (!plausibleServerRetrievedAt(capture.retrievedAt)) return [];
  const requestedMpn = text(input.mpn, 180);
  const requestedManufacturer = text(input.manufacturer, 180);
  const identityTerms = requiredIdentityTerms(input);
  const dimensionPhrases = requiredDimensionPhrases(input);
  const receipts: PublicListingReceipt[] = [];
  for (const source of capture.records) {
    const proposal = source.proposal;
    if (!proposal || !successfulFreshStatus(source.status, source.sourceUrl)) continue;
    const sourceUrl = publicUrl(source.sourceUrl);
    const itemIdentity = text(proposal.itemIdentity, 500);
    const evidenceClaim = text(proposal.evidenceText, 1_500);
    const sourceBody = [source.text, ...source.highlights].filter(Boolean).join("\n");
    if (source.sourceTextHash !== hash(sourceBody)) continue;
    const evidenceExcerpt = exactSourceExcerpt(sourceBody, evidenceClaim);
    const currency = text(proposal.currency, 20).toUpperCase();
    const unitOfMeasure = text(proposal.unitOfMeasure, 80);
    const amount = proposal.priceAmount;
    if (!sourceUrl || !isSupplierDiscoveryUrl(sourceUrl) || !itemIdentity || !evidenceExcerpt || evidenceExcerpt.length > 1_000 || amount === null || dbRepresentableAmount(amount) === null) continue;
    if (!containsPhrase(evidenceExcerpt, itemIdentity)) continue;
    if (!isIsoCurrency(currency) || !containsWord(evidenceExcerpt, currency)) continue;
    if (!unitOfMeasure || !containsPhrase(evidenceExcerpt, unitOfMeasure)) continue;
    const tupleWindow = boundPriceTupleWindow(evidenceExcerpt, amount, currency, unitOfMeasure, itemIdentity);
    if (!tupleWindow || !containsPhrase(tupleWindow, itemIdentity)) continue;
    if (proposal.packageQuantity !== null && (dbRepresentableAmount(proposal.packageQuantity) === null || !containsAmount(tupleWindow, proposal.packageQuantity))) continue;
    const proposedManufacturer = text(proposal.manufacturer, 180);
    const proposedMpn = text(proposal.mpn, 180);
    if (proposedManufacturer && !containsPhrase(tupleWindow, proposedManufacturer)) continue;
    if (proposedMpn && !containsPhrase(tupleWindow, proposedMpn)) continue;
    if (requestedManufacturer) {
      if (!containsPhrase(itemIdentity, requestedManufacturer)) continue;
      if (proposedManufacturer && normalizedIdentity(proposedManufacturer) !== normalizedIdentity(requestedManufacturer)) continue;
    }
    if (requestedMpn) {
      if (proposedMpn && normalizedIdentity(proposedMpn) !== normalizedIdentity(requestedMpn)) continue;
      if (!containsPhrase(itemIdentity, requestedMpn)) continue;
    } else {
      if (!identityTerms.length) continue;
      if (!identityTerms.every((term) => containsIdentityTerm(itemIdentity, term))) continue;
      if (!dimensionPhrases.every((phrase) => containsDimensionPhrase(itemIdentity, phrase))) continue;
    }
    const base: Omit<PublicListingReceipt, "candidateId" | "receiptHash"> = {
      provider: "EXA",
      itemKey: input.componentItemKey,
      itemIdentity,
      manufacturer: requestedManufacturer || proposedManufacturer || null,
      mpn: requestedMpn || proposedMpn || null,
      amount,
      currency,
      unitOfMeasure,
      packageQuantity: proposal.packageQuantity,
      sourceUrl,
      sourceTitle: source.sourceTitle,
      evidenceExcerpt,
      sourceTextHash: source.sourceTextHash,
      searchRequestId: capture.searchRequestId,
      contentsRequestId: capture.contentsRequestId,
      contentsResponseHash: capture.contentsResponseHash,
      retrievedAt: capture.retrievedAt,
      freshnessPolicy: "FORCED_LIVE",
    };
    receipts.push({ ...base, candidateId: null, receiptHash: publicListingReceiptHash(base) });
  }
  return receipts;
}

export function parseStoredExaRetrievalCapture(value: unknown): ExaRetrievalCapture | null {
  const raw = record(value);
  if (raw.provider !== "EXA" || raw.freshnessPolicy !== "FORCED_LIVE") return null;
  const searchRequestId = text(raw.searchRequestId, 220);
  const searchHttpStatus = typeof raw.searchHttpStatus === "number" && Number.isInteger(raw.searchHttpStatus) ? raw.searchHttpStatus : null;
  const searchResponseHash = text(raw.searchResponseHash, 64);
  const retrievedAt = text(raw.retrievedAt, 40);
  if (
    !searchRequestId || searchHttpStatus === null || !/^[a-f0-9]{64}$/.test(searchResponseHash)
    || !plausibleServerRetrievedAt(retrievedAt) || !Array.isArray(raw.records) || raw.records.length > MAX_RESULTS
  ) return null;
  const records: ExaRetrievedRecord[] = [];
  for (const valueRecord of raw.records) {
    const source = record(valueRecord);
    const searchRank = typeof source.searchRank === "number" && Number.isInteger(source.searchRank) && source.searchRank >= 1 && source.searchRank <= MAX_RESULTS
      ? source.searchRank
      : null;
    const sourceId = text(source.sourceId, 2_000);
    const sourceUrl = publicUrl(source.sourceUrl);
    const sourceTitle = text(source.sourceTitle, 500) || null;
    const status = source.status === null ? null : parseStatus(source.status);
    const publishedDate = text(source.publishedDate, 80) || null;
    const sourceText = typeof source.text === "string" && source.text.length <= MAX_RECORD_TEXT ? source.text : null;
    const highlights = Array.isArray(source.highlights)
      ? source.highlights.flatMap((entry) => typeof entry === "string" ? [entry] : []).slice(0, 12)
      : [];
    const proposal = source.proposal === null ? null : parseProposal(source.proposal);
    const sourceTextHash = text(source.sourceTextHash, 64);
    if (
      searchRank === null || !sourceId || !sourceUrl || sourceText === null
      || (status !== null && !sameUrl(status.id, sourceUrl))
      || highlights.join("\n").length > MAX_RECORD_HIGHLIGHTS || !/^[a-f0-9]{64}$/.test(sourceTextHash)
      || hash([sourceText, ...highlights].join("\n")) !== sourceTextHash
    ) return null;
    records.push({ searchRank, sourceId, sourceUrl, sourceTitle, status, publishedDate, text: sourceText, highlights, proposal, sourceTextHash });
  }
  if (new Set(records.map((candidate) => candidate.sourceUrl)).size !== records.length) return null;
  if (raw.stage === "SEARCH_ONLY") {
    const failureCode = text(raw.failureCode, 80);
    if (
      raw.contentsRequestId !== null || raw.contentsHttpStatus !== null || raw.contentsResponseHash !== null
      || failureCode !== "PROVIDER_TIMEOUT"
      || records.some((source) => source.status !== null || source.text || source.highlights.length || source.proposal !== null)
    ) return null;
    return {
      provider: "EXA",
      freshnessPolicy: "FORCED_LIVE",
      stage: "SEARCH_ONLY",
      searchRequestId,
      contentsRequestId: null,
      searchHttpStatus,
      contentsHttpStatus: null,
      searchResponseHash,
      contentsResponseHash: null,
      retrievedAt,
      records,
      failureCode,
    };
  }
  const contentsRequestId = text(raw.contentsRequestId, 220);
  const contentsHttpStatus = typeof raw.contentsHttpStatus === "number" && Number.isInteger(raw.contentsHttpStatus) ? raw.contentsHttpStatus : null;
  const contentsResponseHash = text(raw.contentsResponseHash, 64);
  if (
    !contentsRequestId || contentsHttpStatus === null || !/^[a-f0-9]{64}$/.test(contentsResponseHash)
  ) return null;
  return {
    provider: "EXA",
    freshnessPolicy: "FORCED_LIVE",
    searchRequestId,
    contentsRequestId,
    searchHttpStatus,
    contentsHttpStatus,
    searchResponseHash,
    contentsResponseHash,
    retrievedAt,
    records,
  };
}

export function parseStoredOpenAiRetrievalCapture(value: unknown): OpenAiRetrievalCapture | null {
  const raw = record(value);
  if (
    raw.provider !== "OPENAI"
    || raw.freshnessPolicy !== "SERVER_RETRIEVED"
    || (raw.stage !== undefined && raw.stage !== "CONTENTS_COMPLETE")
  ) return null;
  const searchRequestId = text(raw.searchRequestId, 220);
  const contentsRequestId = text(raw.contentsRequestId, 220);
  const searchHttpStatus = typeof raw.searchHttpStatus === "number" && Number.isInteger(raw.searchHttpStatus)
    ? raw.searchHttpStatus
    : null;
  const contentsHttpStatus = typeof raw.contentsHttpStatus === "number" && Number.isInteger(raw.contentsHttpStatus)
    ? raw.contentsHttpStatus
    : null;
  const searchResponseHash = text(raw.searchResponseHash, 64);
  const contentsResponseHash = text(raw.contentsResponseHash, 64);
  const retrievedAt = text(raw.retrievedAt, 40);
  if (
    !searchRequestId || !contentsRequestId
    || searchHttpStatus === null || searchHttpStatus < 200 || searchHttpStatus >= 300
    || contentsHttpStatus === null || contentsHttpStatus < 200 || contentsHttpStatus >= 300
    || !/^[a-f0-9]{64}$/.test(searchResponseHash)
    || !/^[a-f0-9]{64}$/.test(contentsResponseHash)
    || !plausibleServerRetrievedAt(retrievedAt)
    || !Array.isArray(raw.records) || raw.records.length > MAX_RESULTS
  ) return null;
  const records: OpenAiRetrievedRecord[] = [];
  for (const valueRecord of raw.records) {
    const source = record(valueRecord);
    const searchRank = typeof source.searchRank === "number" && Number.isInteger(source.searchRank) && source.searchRank >= 1 && source.searchRank <= MAX_RESULTS
      ? source.searchRank
      : null;
    const sourceId = text(source.sourceId, 2_000);
    const sourceUrl = publicUrl(source.sourceUrl);
    const sourceTitle = text(source.sourceTitle, 500) || null;
    const status = parseStatus(source.status);
    const publishedDate = text(source.publishedDate, 80) || null;
    const sourceText = typeof source.text === "string" && source.text.length <= MAX_RECORD_TEXT ? source.text : null;
    const highlights = Array.isArray(source.highlights)
      ? source.highlights.flatMap((entry) => typeof entry === "string" ? [entry] : []).slice(0, 12)
      : [];
    const proposal = source.proposal === null ? null : parseProposal(source.proposal);
    const sourceTextHash = text(source.sourceTextHash, 64);
    if (
      searchRank === null || !sourceId || !sourceUrl || !status || sourceText === null
      || !sameUrl(status.id, sourceUrl)
      || highlights.join("\n").length > MAX_RECORD_HIGHLIGHTS
      || !/^[a-f0-9]{64}$/.test(sourceTextHash)
      || hash([sourceText, ...highlights].join("\n")) !== sourceTextHash
    ) return null;
    records.push({ searchRank, sourceId, sourceUrl, sourceTitle, status, publishedDate, text: sourceText, highlights, proposal, sourceTextHash });
  }
  if (new Set(records.map((candidate) => candidate.sourceUrl)).size !== records.length) return null;
  // OpenAI page retrieval is server-owned, so its batch hash is defined over
  // this canonical record shape and can be revalidated after JSONB storage.
  // Exa keeps its legacy raw-provider response hash, which is not derivable
  // from the normalized records and therefore remains on the legacy path.
  if (hash(JSON.stringify(records)) !== contentsResponseHash) return null;
  return {
    provider: "OPENAI",
    freshnessPolicy: "SERVER_RETRIEVED",
    ...(raw.stage === "CONTENTS_COMPLETE" ? { stage: "CONTENTS_COMPLETE" as const } : {}),
    searchRequestId,
    contentsRequestId,
    searchHttpStatus,
    contentsHttpStatus,
    searchResponseHash,
    contentsResponseHash,
    retrievedAt,
    records,
  };
}

export function parseStoredSupplierResearchRetrievalCapture(value: unknown): SupplierResearchRetrievalCapture | null {
  const provider = record(value).provider;
  if (provider === "EXA") return parseStoredExaRetrievalCapture(value);
  if (provider === "OPENAI") return parseStoredOpenAiRetrievalCapture(value);
  return null;
}

export function parseStoredPublicListingReceipt(value: unknown) {
  const raw = record(value);
  if (raw.provider !== "EXA" || raw.freshnessPolicy !== "FORCED_LIVE") return null;
  const candidateId = text(raw.candidateId, 220) || null;
  const itemKey = text(raw.itemKey, 180);
  const itemIdentity = text(raw.itemIdentity, 500);
  const manufacturer = text(raw.manufacturer, 180) || null;
  const mpn = text(raw.mpn, 180) || null;
  const amount = dbRepresentableAmount(raw.amount);
  const rawCurrency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
  const currency = rawCurrency;
  const unitOfMeasure = text(raw.unitOfMeasure, 80);
  const packageQuantity = raw.packageQuantity === null
    ? null
    : dbRepresentableAmount(raw.packageQuantity);
  const sourceUrl = publicUrl(raw.sourceUrl);
  const sourceTitle = text(raw.sourceTitle, 500) || null;
  const evidenceExcerpt = sourceClaim(raw.evidenceExcerpt, 1_000);
  const sourceTextHash = text(raw.sourceTextHash, 64);
  const searchRequestId = text(raw.searchRequestId, 220);
  const contentsRequestId = text(raw.contentsRequestId, 220);
  const contentsResponseHash = text(raw.contentsResponseHash, 64);
  const retrievedAt = text(raw.retrievedAt, 40);
  const receiptHash = text(raw.receiptHash, 64);
  if (
    !itemKey || !itemIdentity || amount === null || !isIsoCurrency(currency) || !unitOfMeasure
    || !sourceUrl || !evidenceExcerpt || !/^[a-f0-9]{64}$/.test(sourceTextHash)
    || !searchRequestId || !contentsRequestId || !/^[a-f0-9]{64}$/.test(contentsResponseHash)
    || !plausibleServerRetrievedAt(retrievedAt) || !/^[a-f0-9]{64}$/.test(receiptHash)
  ) return null;
  const tupleWindow = boundPriceTupleWindow(evidenceExcerpt, amount, currency, unitOfMeasure, itemIdentity);
  if (!tupleWindow || !containsPhrase(tupleWindow, itemIdentity)) return null;
  const base: Omit<PublicListingReceipt, "candidateId" | "receiptHash"> = {
    provider: "EXA",
    itemKey,
    itemIdentity,
    manufacturer,
    mpn,
    amount,
    currency,
    unitOfMeasure,
    packageQuantity,
    sourceUrl,
    sourceTitle,
    evidenceExcerpt,
    sourceTextHash,
    searchRequestId,
    contentsRequestId,
    contentsResponseHash,
    retrievedAt,
    freshnessPolicy: "FORCED_LIVE",
  };
  return publicListingReceiptHash(base) === receiptHash
    ? { ...base, candidateId, receiptHash } satisfies PublicListingReceipt
    : null;
}

async function readBoundedJson(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ExaResearchError("PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ExaResearchError("PROVIDER_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let bodyText: string;
  try {
    bodyText = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  }
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  }
  return { value, responseHash: hash(bodyText) };
}

async function exaRequest(args: {
  url: string;
  body: JsonRecord;
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  deadlineAt: number;
}) {
  const controller = new AbortController();
  const remainingMs = args.deadlineAt - Date.now();
  if (remainingMs <= 0) throw new ExaResearchError("PROVIDER_TIMEOUT");
  const timeout = setTimeout(() => controller.abort(), Math.min(args.timeoutMs, remainingMs));
  try {
    const response = await args.fetchImpl(args.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": args.apiKey },
      body: JSON.stringify(args.body),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ExaResearchError("PROVIDER_AUTHENTICATION_FAILED");
      }
      if (response.status === 429) throw new ExaResearchError("PROVIDER_RATE_LIMITED");
      throw new ExaResearchError("PROVIDER_FAILURE");
    }
    const parsed = await readBoundedJson(response, args.maxBytes);
    return { ...parsed, status: response.status };
  } catch (error) {
    if (error instanceof ExaResearchError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ExaResearchError("PROVIDER_TIMEOUT");
    }
    throw new ExaResearchError("PROVIDER_FAILURE");
  } finally {
    clearTimeout(timeout);
  }
}

const OFFER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "supplierName", "supplierRole", "companyIdentityEvidence", "supplierRoleEvidence",
    "productCapabilityEvidence", "itemIdentity", "manufacturer", "mpn", "priceAmount",
    "currency", "unitOfMeasure", "packageQuantity", "evidenceText",
  ],
  properties: {
    supplierName: { type: ["string", "null"] },
    supplierRole: { type: ["string", "null"] },
    companyIdentityEvidence: { type: ["string", "null"] },
    supplierRoleEvidence: { type: ["string", "null"] },
    productCapabilityEvidence: { type: ["string", "null"] },
    itemIdentity: { type: ["string", "null"] },
    manufacturer: { type: ["string", "null"] },
    mpn: { type: ["string", "null"] },
    priceAmount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    unitOfMeasure: { type: ["string", "null"] },
    packageQuantity: { type: ["number", "null"] },
    evidenceText: { type: ["string", "null"] },
  },
} as const;

function resultCompanyName(sourceUrl: string) {
  // Exa search results are public listing sources, not seller-identity proof.
  // A page can mention a manufacturer without that company selling the item.
  return new URL(sourceUrl).hostname.replace(/^www\./, "").slice(0, 180);
}

function unknownEnvelope() {
  return { value: null, state: "UNKNOWN", confidence: null, sourceUrls: [], observedAt: null };
}

function supportedEnvelope(value: unknown, sourceUrl: string) {
  return { value, state: "SUPPORTED", confidence: 1, sourceUrls: [sourceUrl], observedAt: null };
}

function buildRawCandidates(
  capture: ExaRetrievalCapture,
  listingReceipts: PublicListingReceipt[],
  leadReceipts: PublicSupplierLeadReceipt[],
) {
  return capture.records.flatMap((source) => {
    if (!successfulFreshStatus(source.status, source.sourceUrl)) return [];
    const proposal = source.proposal;
    const leadReceipt = leadReceipts.find((candidate) => candidate.sourceUrl === source.sourceUrl) ?? null;
    const listingReceipt = listingReceipts.find((candidate) => candidate.sourceUrl === source.sourceUrl) ?? null;
    const companyName = leadReceipt?.companyName ?? resultCompanyName(source.sourceUrl);
    return [{
      id: source.sourceId,
      companyName,
      website: leadReceipt?.website ?? new URL(source.sourceUrl).origin,
      roles: leadReceipt ? [leadReceipt.role] : [],
      country: unknownEnvelope(),
      facility: unknownEnvelope(),
      productCapability: leadReceipt
        ? supportedEnvelope(leadReceipt.productCapability, source.sourceUrl)
        : listingReceipt
          ? supportedEnvelope(listingReceipt.itemIdentity, source.sourceUrl)
        : proposal?.itemIdentity
          ? { value: proposal.itemIdentity, state: "PARTIAL", confidence: null, sourceUrls: [source.sourceUrl], observedAt: null }
          : unknownEnvelope(),
      price: listingReceipt ? supportedEnvelope(listingReceipt.amount, source.sourceUrl) : unknownEnvelope(),
      currency: listingReceipt ? supportedEnvelope(listingReceipt.currency, source.sourceUrl) : unknownEnvelope(),
      unitOfMeasure: listingReceipt ? supportedEnvelope(listingReceipt.unitOfMeasure, source.sourceUrl) : unknownEnvelope(),
      minimumOrderQuantity: unknownEnvelope(),
      leadTimeDays: unknownEnvelope(),
      sourceUrls: [source.sourceUrl],
      cautions: leadReceipt
        ? ["Forced-live public supplier evidence. Operator qualification and RFQ confirmation remain required."]
        : listingReceipt
          ? ["Forced-live public listing capture. Supplier identity, role, qualification, and RFQ confirmation remain required."]
        : ["No exact forced-live price tuple survived evidence validation."],
    }];
  });
}

type SelectedSearchResult = {
  result: JsonRecord;
  index: number;
  url: string;
  id: string;
};

function retainSearchDiscovery(args: {
  input: ExaSupplierResearchInput;
  searchRequestId: string;
  searchHttpStatus: number;
  searchResponseHash: string;
  selectedResults: SelectedSearchResult[];
  failure: ExaResearchError;
  retrievedAt: string;
}): ExaSupplierResearchResult {
  const records = args.selectedResults.map((source) => ({
    searchRank: source.index + 1,
    sourceId: source.id,
    sourceUrl: source.url,
    sourceTitle: text(source.result.title, 500) || null,
    status: null,
    publishedDate: text(source.result.publishedDate, 80) || null,
    text: "",
    highlights: [],
    proposal: null,
    sourceTextHash: hash(""),
  } satisfies ExaRetrievedRecord));
  const capture: ExaSearchOnlyRetrievalCapture = {
    provider: "EXA",
    freshnessPolicy: "FORCED_LIVE",
    stage: "SEARCH_ONLY",
    searchRequestId: args.searchRequestId,
    contentsRequestId: null,
    searchHttpStatus: args.searchHttpStatus,
    contentsHttpStatus: null,
    searchResponseHash: args.searchResponseHash,
    contentsResponseHash: null,
    retrievedAt: args.retrievedAt,
    records,
    failureCode: args.failure.code,
  };
  const raw = {
    candidates: records.map((source) => ({
      id: source.sourceId,
      companyName: resultCompanyName(source.sourceUrl),
      website: new URL(source.sourceUrl).origin,
      roles: [],
      country: unknownEnvelope(),
      facility: unknownEnvelope(),
      productCapability: unknownEnvelope(),
      price: unknownEnvelope(),
      currency: unknownEnvelope(),
      unitOfMeasure: unknownEnvelope(),
      minimumOrderQuantity: unknownEnvelope(),
      leadTimeDays: unknownEnvelope(),
      sourceUrls: [source.sourceUrl],
      cautions: ["Public search found this page, but product fit, supplier role, price, and availability still require verification."],
    })),
    warnings: [],
  };
  const sources: EvidenceSource[] = records.map((source) => ({
    url: source.sourceUrl,
    title: source.sourceTitle ?? undefined,
    sourceType: "PUBLIC",
  }));
  const normalized = normalizeSupplierResearch({
    officeId: args.input.officeId,
    workspaceId: args.input.workspaceId,
    componentItemKey: args.input.componentItemKey,
    raw,
    providerSources: sources,
    now: new Date(args.retrievedAt),
    trustClaimedObservedAt: false,
  });
  const warning = args.failure.code === "PROVIDER_TIMEOUT"
    ? "Live content validation timed out. Public supplier pages from discovery were retained, but company identity, supplier role, product fit, price, and availability remain unverified."
    : "Live page verification failed. Public supplier pages from discovery were retained, but product fit, price, and availability remain unverified.";
  return {
    ...normalized,
    degraded: true,
    warnings: [...normalized.warnings, warning],
    retrieval: capture,
    publicListingReceipts: [],
    publicSupplierLeadReceipts: [],
  };
}

export async function searchExaComponentSuppliers(
  input: ExaSupplierResearchInput,
  dependencies: ExaDependencies,
): Promise<ExaSupplierResearchResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const deadlineAt = Date.now() + TOTAL_TIMEOUT_MS;
  const querySelection = selectedSupplierResearchQueryVariant(input);
  if (!querySelection.selected) throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  const query = querySelection.selected.query;
  const search = await exaRequest({
    url: EXA_SEARCH_URL,
    apiKey: dependencies.apiKey,
    fetchImpl,
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxBytes: MAX_SEARCH_RESPONSE_BYTES,
    deadlineAt,
    body: { query, type: "auto", numResults: MAX_RESULTS, moderation: true },
  });
  const searchBody = record(search.value);
  const searchRequestId = text(searchBody.requestId, 220);
  const searchResults = Array.isArray(searchBody.results) ? searchBody.results.map(record) : [];
  const selectedResults: SelectedSearchResult[] = searchResults.flatMap((result, index) => {
    const url = publicUrl(result.url);
    const id = text(result.id, 2_000) || url;
    return url && id && isSupplierDiscoveryUrl(url) ? [{ result, index, url, id }] : [];
  }).filter((candidate, index, candidates) => candidates.findIndex((other) => other.url === candidate.url) === index).slice(0, MAX_RESULTS);
  if (!searchRequestId || !selectedResults.length) throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  const contentResultsToRetrieve = selectedResults.filter((candidate, index, candidates) => {
    const hostname = new URL(candidate.url).hostname.replace(/^www\./, "").toLowerCase();
    return candidates.findIndex((other) => {
      const otherHostname = new URL(other.url).hostname.replace(/^www\./, "").toLowerCase();
      return hostname === otherHostname || hostname.endsWith(`.${otherHostname}`) || otherHostname.endsWith(`.${hostname}`);
    }) === index;
  }).slice(0, MAX_CONTENT_RESULTS);
  const highlightQuery = text([
    `Exact requested item: ${input.componentName}`,
    input.manufacturer ? `manufacturer ${input.manufacturer}` : null,
    input.mpn ? `part number ${input.mpn}` : null,
    input.specification ? `specification ${input.specification}` : null,
    "current price with explicit ISO currency and exact unit or package basis",
  ].filter(Boolean).join(". "), 1_200);
  let contents: Awaited<ReturnType<typeof exaRequest>>;
  try {
    contents = await exaRequest({
      url: EXA_CONTENTS_URL,
      apiKey: dependencies.apiKey,
      fetchImpl,
      timeoutMs: CONTENTS_TIMEOUT_MS,
      maxBytes: MAX_CONTENTS_RESPONSE_BYTES,
      deadlineAt,
      body: {
        urls: contentResultsToRetrieve.map((result) => result.url),
        text: { maxCharacters: MAX_RECORD_TEXT, verbosity: "standard", includeSections: ["header", "body", "metadata"] },
        highlights: { query: highlightQuery, maxCharacters: MAX_RECORD_HIGHLIGHTS },
        summary: {
          query: `${highlightQuery}. Return null for every value not printed by this exact page. supplierRole must be one canonical value: MANUFACTURER, DISTRIBUTOR, PRODUCER, PROCESSOR, EXPORTER, TRADER, or SERVICE_PROVIDER. Map a machine shop or fabricator to PROCESSOR. Map a harness assembler, packaging service, calibration laboratory, or inspection service to SERVICE_PROVIDER. Map a stockist, service center, or packaging supplier to DISTRIBUTOR. companyIdentityEvidence must be one verbatim excerpt that names the company operating this source domain. supplierRoleEvidence must be one verbatim excerpt that explicitly states the supplier role in normal company language such as manufacturer, distributor, supplier, stockist, service center, machine shop, fabricator, harness assembler, packaging supplier, calibration laboratory, or inspection service. productCapabilityEvidence must be one verbatim excerpt that states the requested item or capability. The role and capability excerpts do not need to repeat the company name after companyIdentityEvidence binds the page. If the request says or equivalent, accept only an exact branded item or a functional equivalent whose excerpt states every critical product and performance qualifier. evidenceText must be one verbatim excerpt that contains the exact item identity, amount, ISO currency code, and unit or package basis.`,
          schema: OFFER_SCHEMA,
        },
        maxAgeHours: 0,
        livecrawlTimeout: 15_000,
      },
    });
  } catch (error) {
    if (!(error instanceof ExaResearchError) || error.code !== "PROVIDER_TIMEOUT") throw error;
    return retainSearchDiscovery({
      input,
      searchRequestId,
      searchHttpStatus: search.status,
      searchResponseHash: search.responseHash,
      selectedResults,
      failure: error,
      retrievedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
  }
  const contentsBody = record(contents.value);
  const contentsRequestId = text(contentsBody.requestId, 220);
  const contentResults = Array.isArray(contentsBody.results) ? contentsBody.results.map(record) : [];
  const statuses = Array.isArray(contentsBody.statuses) ? contentsBody.statuses.map(parseStatus).filter((status): status is ExaSourceStatus => Boolean(status)) : [];
  const hasExactStatusCoverage = contentResultsToRetrieve.every((result) => (
    statuses.filter((status) => sameUrl(status.id, result.url)).length === 1
  ));
  const boundContentResults = bindContentResults({
    requestedUrls: contentResultsToRetrieve.map((result) => result.url),
    results: contentResults,
    statuses,
  });
  if (!contentsRequestId || !hasExactStatusCoverage || !boundContentResults) {
    throw new ExaResearchError("INVALID_STRUCTURED_RESPONSE");
  }
  const retrievedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const records = contentResultsToRetrieve.flatMap((searchResult, index) => {
    const content = boundContentResults[index];
    const status = statuses.find((candidate) => sameUrl(candidate.id, searchResult.url)) ?? null;
    const contentText = typeof content?.text === "string" ? content.text : "";
    const highlights = Array.isArray(content?.highlights)
      ? content.highlights.flatMap((value) => typeof value === "string" ? [value] : []).slice(0, 12)
      : [];
    if (contentText.length > MAX_RECORD_TEXT || highlights.join("\n").length > MAX_RECORD_HIGHLIGHTS) {
      throw new ExaResearchError("PROVIDER_RESPONSE_TOO_LARGE");
    }
    return [{
      searchRank: searchResult.index + 1,
      sourceId: searchResult.id,
      sourceUrl: searchResult.url,
      sourceTitle: text(content?.title ?? searchResult.result.title, 500) || null,
      status,
      // Provider publication dates are captured for display only. They never
      // control observation freshness or the server-owned retrieval time.
      publishedDate: text(content?.publishedDate ?? searchResult.result.publishedDate, 80) || null,
      text: contentText,
      highlights,
      proposal: parseProposal(content?.summary),
      sourceTextHash: hash([contentText, ...highlights].join("\n")),
    } satisfies ExaRetrievedRecord];
  });
  const capture: ExaRetrievalCapture = {
    provider: "EXA",
    freshnessPolicy: "FORCED_LIVE",
    searchRequestId,
    contentsRequestId,
    searchHttpStatus: search.status,
    contentsHttpStatus: contents.status,
    searchResponseHash: search.responseHash,
    contentsResponseHash: contents.responseHash,
    retrievedAt,
    records,
  };
  const receipts = validateExaPublicListingReceipts(input, capture);
  const leadReceipts = validateExaPublicSupplierLeadReceipts(input, capture);
  const raw = { candidates: buildRawCandidates(capture, receipts, leadReceipts), warnings: [] };
  const sources: EvidenceSource[] = records.map((source) => ({
    url: source.sourceUrl,
    title: source.sourceTitle ?? undefined,
    sourceType: "PUBLIC",
  }));
  const normalized = normalizeSupplierResearch({
    officeId: input.officeId,
    workspaceId: input.workspaceId,
    componentItemKey: input.componentItemKey,
    raw,
    providerSources: sources,
    validatedSupplierLeadSourceUrls: leadReceipts.map((receipt) => receipt.sourceUrl),
    now: new Date(retrievedAt),
    trustClaimedObservedAt: false,
  });
  const boundReceipts = receipts.flatMap((receipt) => {
    const candidate = normalized.candidates.find((value) => value.sourceUrls.includes(receipt.sourceUrl));
    return candidate ? [{ ...receipt, candidateId: candidate.id }] : [];
  });
  const boundLeadReceipts = leadReceipts.flatMap((receipt) => {
    const candidate = normalized.candidates.find((value) => value.sourceUrls.includes(receipt.sourceUrl));
    return candidate ? [{ ...receipt, candidateId: candidate.id }] : [];
  });
  const warnings = [
    ...normalized.warnings,
    ...records.flatMap((source) => successfulFreshStatus(source.status, source.sourceUrl) ? [] : [`Exa could not force-live retrieve ${source.sourceUrl}.`]),
    ...(boundReceipts.length ? [] : ["No exact forced-live public price tuple survived evidence validation."]),
  ];
  return {
    ...normalized,
    degraded: normalized.degraded || !records.some((source) => successfulFreshStatus(source.status, source.sourceUrl)),
    warnings,
    retrieval: capture,
    publicListingReceipts: boundReceipts,
    publicSupplierLeadReceipts: boundLeadReceipts,
  };
}
