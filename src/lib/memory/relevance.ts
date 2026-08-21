import { normalizeCanonicalType, normalizeSourceType } from "./canonical-types";

export function tokenizeMemoryQuery(query: string | null | undefined) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_@.+-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function compactMemoryText(text: string | null | undefined, max = 420) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1)).trimEnd()}...` : compact;
}

export function excerptAroundQuery(text: string | null | undefined, query: string | null | undefined, max = 420) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!compact) return "";
  const q = query?.trim().toLowerCase();
  const tokens = tokenizeMemoryQuery(query);
  const lower = compact.toLowerCase();
  const hitIndex = q && lower.includes(q)
    ? lower.indexOf(q)
    : tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (hitIndex == null || hitIndex < 0 || compact.length <= max) return compactMemoryText(compact, max);
  const start = Math.max(0, hitIndex - Math.floor(max / 3));
  const end = Math.min(compact.length, start + max);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

export function textMatchScore(text: string | null | undefined, query: string | null | undefined) {
  const value = String(text ?? "").toLowerCase();
  const q = query?.trim().toLowerCase();
  if (!value || !q) return 0;
  let score = value.includes(q) ? 55 : 0;
  const tokens = tokenizeMemoryQuery(q);
  if (tokens.length === 0) return score;
  const matched = tokens.filter((token) => value.includes(token));
  score += matched.length * 12;
  if (matched.length === tokens.length) score += 18;
  return score;
}

export function recencyBoost(date: Date | string | null | undefined, now = new Date()) {
  if (!date) return 0;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return 0;
  const days = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
  if (days <= 7) return 24;
  if (days <= 30) return 18;
  if (days <= 90) return 12;
  if (days <= 365) return 6;
  return 1;
}

export function canonicalTypeBoost(canonicalType: string | null | undefined) {
  switch (normalizeCanonicalType(canonicalType)) {
    case "strategy_assessment":
      return 18;
    case "job":
    case "rfq":
      return 14;
    case "email_message":
    case "email_thread":
    case "job_document":
    case "company_document":
      return 10;
    case "company":
    case "contact":
      return 6;
    default:
      return 3;
  }
}

export function sourceTypeBoost(sourceType: string | null | undefined) {
  switch (normalizeSourceType(sourceType)) {
    case "STRATEGY":
      return 14;
    case "JOB":
    case "INQUIRY":
      return 12;
    case "GMAIL":
    case "WHATSAPP":
    case "GOOGLE_SHEETS":
      return 10;
    case "DOCUMENT":
    case "AGENT":
      return 8;
    default:
      return 4;
  }
}

export function entityScopeBoost(args: {
  companyId?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  resultCompanyId?: string | null;
  resultJobId?: string | null;
  resultInquiryId?: string | null;
  resultEntityType?: string | null;
  resultEntityId?: string | null;
}) {
  let score = 0;
  if (args.companyId && args.resultCompanyId === args.companyId) score += 24;
  if (args.jobId && args.resultJobId === args.jobId) score += 32;
  if (args.inquiryId && args.resultInquiryId === args.inquiryId) score += 28;
  if (args.entityType && args.entityId && args.resultEntityType === args.entityType && args.resultEntityId === args.entityId) {
    score += 36;
  }
  return score;
}
