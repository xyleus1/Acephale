// Hunter.io Domain Search. One GET per company domain returning up to ten
// personal (named) addresses with position, seniority, department and the
// decision-maker flag. Hunter bills a request only when it returns at least one
// result, so probing a domain we know nothing about is free. Empty and
// unsupported-domain answers are a normal `[]`; HTTP or payload problems throw
// so the caller can count the failure and continue without named contacts.

import type { ContactEnricher, ContactEnricherUsage, EnrichedContact } from "./enrich";

export const HUNTER_DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/domain-search";
const DEFAULT_TIMEOUT_MS = 12_000;
/** Free-plan ceiling for limit + offset; also enough people per company. */
const RESULT_LIMIT = 10;
const MEMO_LIMIT = 5_000;
const MAX_SOURCES = 5;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HunterEnricherOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
};

export class ContactEnricherError extends Error {
  readonly code: "http" | "payload" | "timeout" | "network" | "exhausted";
  readonly status: number | null;
  constructor(code: ContactEnricherError["code"], message: string, status: number | null = null) {
    super(message);
    this.name = "ContactEnricherError";
    this.code = code;
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function seniority(value: unknown): EnrichedContact["seniority"] {
  return value === "junior" || value === "senior" || value === "executive" ? value : null;
}

function verificationStatus(value: unknown): EnrichedContact["verificationStatus"] {
  return value === "valid" || value === "accept_all" || value === "unknown" || value === "invalid" ? value : null;
}

export function parseHunterDomainSearch(payload: unknown, enrichedAt: Date): EnrichedContact[] {
  const data = record(record(payload).data);
  if (!("emails" in data)) throw new ContactEnricherError("payload", "unexpected domain-search payload");
  const emails = Array.isArray(data.emails) ? data.emails : [];
  const contacts: EnrichedContact[] = [];
  for (const raw of emails) {
    const item = record(raw);
    const email = text(item.value)?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (item.type === "generic") continue;
    const firstName = text(item.first_name);
    const lastName = text(item.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
    const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(100, Math.round(item.confidence)))
      : 0;
    const sources = Array.isArray(item.sources) ? item.sources : [];
    const sourceUrls = sources
      .map((source) => text(record(source).uri))
      .filter((uri): uri is string => Boolean(uri))
      .slice(0, MAX_SOURCES);
    contacts.push({
      email,
      fullName,
      firstName,
      lastName,
      position: text(item.position) ?? text(item.position_raw),
      seniority: seniority(item.seniority),
      department: text(item.department)?.toLowerCase() ?? null,
      decisionMaker: item.decision_maker === true,
      confidence,
      verificationStatus: verificationStatus(record(item.verification).status),
      linkedin: text(item.linkedin),
      phone: text(item.phone_number),
      sourceUrls,
      provider: "hunter",
      enrichedAt: enrichedAt.toISOString(),
    });
  }
  return contacts;
}

export function createHunterEnricher(options: HunterEnricherOptions): ContactEnricher {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const memo = new Map<string, Promise<EnrichedContact[]>>();
  const usage: ContactEnricherUsage = {
    provider: "hunter",
    calls: 0,
    billable: 0,
    contacts: 0,
    failures: 0,
    exhausted: false,
  };

  async function request(domain: string): Promise<EnrichedContact[]> {
    if (usage.exhausted) throw new ContactEnricherError("exhausted", "plan quota used up", 429);
    usage.calls += 1;
    const params = new URLSearchParams({
      domain,
      type: "personal",
      limit: String(RESULT_LIMIT),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${HUNTER_DOMAIN_SEARCH_URL}?${params.toString()}`, {
        method: "GET",
        headers: { "X-API-KEY": options.apiKey, accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      usage.failures += 1;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ContactEnricherError(aborted ? "timeout" : "network", aborted ? "timed out" : "network error");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429) {
      usage.failures += 1;
      usage.exhausted = true;
      throw new ContactEnricherError("exhausted", "plan quota used up", 429);
    }
    if (!response.ok) {
      usage.failures += 1;
      throw new ContactEnricherError("http", `http ${response.status}`, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      usage.failures += 1;
      throw new ContactEnricherError("payload", "response was not json");
    }
    let contacts: EnrichedContact[];
    try {
      contacts = parseHunterDomainSearch(payload, now());
    } catch (error) {
      usage.failures += 1;
      throw error;
    }
    if (contacts.length) usage.billable += 1;
    usage.contacts += contacts.length;
    return contacts;
  }

  return {
    name: "hunter",
    async enrichDomain(domain) {
      const key = domain.trim().toLowerCase();
      if (!key) return [];
      const cached = memo.get(key);
      if (cached) return cached;
      const pending = request(key);
      if (memo.size >= MEMO_LIMIT) memo.clear();
      memo.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        memo.delete(key);
        throw error;
      }
    },
    usage: () => ({ ...usage }),
  };
}
