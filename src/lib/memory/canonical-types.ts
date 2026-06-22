export const CANONICAL_MEMORY_TYPES = [
  "company",
  "contact",
  "activity",
  "rfq",
  "job",
  "email_thread",
  "email_message",
  "job_document",
  "strategy_assessment",
  "agent_proposal",
  "customer_note",
  "market_update",
  "market_signal",
  "product_decision",
  "code_reference",
  "personal_note",
] as const;

export type CanonicalMemoryType = typeof CANONICAL_MEMORY_TYPES[number];

export const MEMORY_SOURCE_TYPES = [
  "CRM",
  "GMAIL",
  "WHATSAPP",
  "GOOGLE_SHEETS",
  "INQUIRY",
  "JOB",
  "DOCUMENT",
  "STRATEGY",
  "AGENT",
  "SYSTEM",
  "MARKET",
  "PRODUCT",
  "CODE",
  "PERSONAL",
] as const;

export type CanonicalMemorySourceType = typeof MEMORY_SOURCE_TYPES[number];

const CANONICAL_SET = new Set<string>(CANONICAL_MEMORY_TYPES);
const SOURCE_SET = new Set<string>(MEMORY_SOURCE_TYPES);

const LEGACY_CANONICAL_TYPE_MAP: Record<string, CanonicalMemoryType> = {
  strategy_decision: "strategy_assessment",
};

const CANONICAL_LABELS: Record<CanonicalMemoryType, string> = {
  company: "Company",
  contact: "Contact",
  activity: "Activity",
  rfq: "RFQ",
  job: "Job",
  email_thread: "Email thread",
  email_message: "Email message",
  job_document: "Job document",
  strategy_assessment: "Strategy assessment",
  agent_proposal: "Agent proposal",
  customer_note: "Customer note",
  market_update: "Market update",
  market_signal: "Market signal",
  product_decision: "Product decision",
  code_reference: "Code reference",
  personal_note: "Personal note",
};

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizeCanonicalType(value: string | null | undefined): string {
  const normalized = normalizeKey(value);
  return LEGACY_CANONICAL_TYPE_MAP[normalized] ?? normalized;
}

export function canonicalTypesForSearch(values: Array<string | null | undefined>) {
  const normalized = values.map(normalizeCanonicalType).filter(Boolean);
  const aliases = Object.entries(LEGACY_CANONICAL_TYPE_MAP)
    .filter(([, target]) => normalized.includes(target))
    .map(([legacy]) => legacy);
  return [...new Set([...normalized, ...aliases])];
}

export function isAllowedCanonicalType(value: string | null | undefined): value is CanonicalMemoryType {
  return CANONICAL_SET.has(normalizeCanonicalType(value));
}

export function assertCanonicalType(value: string | null | undefined): CanonicalMemoryType {
  const normalized = normalizeCanonicalType(value);
  if (!CANONICAL_SET.has(normalized)) {
    throw new Error(`Unknown memory canonicalType "${value ?? ""}". Add it to CANONICAL_MEMORY_TYPES before writing it.`);
  }
  return normalized as CanonicalMemoryType;
}

export function isLegacyCanonicalType(value: string | null | undefined) {
  return normalizeKey(value) in LEGACY_CANONICAL_TYPE_MAP;
}

export function getCanonicalTypeLabel(value: string | null | undefined) {
  const normalized = normalizeCanonicalType(value);
  return CANONICAL_LABELS[normalized as CanonicalMemoryType] ?? (normalized || "Unknown");
}

export function normalizeSourceType(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function isAllowedSourceType(value: string | null | undefined): value is CanonicalMemorySourceType {
  return SOURCE_SET.has(normalizeSourceType(value));
}
