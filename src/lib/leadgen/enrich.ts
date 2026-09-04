// Named-contact enrichment for discovered company domains. Public harvesting
// finds companies and role inboxes; an enricher (Hunter) adds the people with
// buying authority. Ranking is deterministic so a batch is reproducible and a
// provider outage only means "no named contacts", never a lost company.

import { createHunterEnricher } from "./hunter";
import type { EmailVerification } from "./verify";

export type EnrichedContact = {
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  seniority: "junior" | "senior" | "executive" | null;
  department: string | null;
  decisionMaker: boolean;
  /** Provider estimate, 0..100, that the address is correct. */
  confidence: number;
  /** Provider-side verification, when it ran. */
  verificationStatus: "valid" | "accept_all" | "unknown" | "invalid" | null;
  linkedin: string | null;
  phone: string | null;
  sourceUrls: string[];
  provider: string;
  enrichedAt: string;
};

export type ContactEnricherUsage = {
  provider: string;
  /** Provider calls made; the provider bills only calls returning results. */
  calls: number;
  /** Calls that returned at least one contact (what the provider bills). */
  billable: number;
  contacts: number;
  failures: number;
  /** Provider reported the plan quota is used up (HTTP 429). */
  exhausted: boolean;
};

export type ContactEnricher = {
  name: string;
  /** Named people at the domain, unranked. Empty when nothing is known. */
  enrichDomain(domain: string): Promise<EnrichedContact[]>;
  usage(): ContactEnricherUsage;
};

export const DEFAULT_CONTACTS_PER_COMPANY = 3;

const DEPARTMENT_WEIGHT: Record<string, number> = {
  procurement: 30,
  executive: 25,
  management: 20,
  operations: 20,
  finance: 8,
  sales: 5,
};

const SENIORITY_WEIGHT: Record<string, number> = {
  executive: 20,
  senior: 10,
  junior: 0,
};

export function contactPriority(contact: EnrichedContact): number {
  let score = 0;
  if (contact.decisionMaker) score += 40;
  score += DEPARTMENT_WEIGHT[contact.department ?? ""] ?? 0;
  score += SENIORITY_WEIGHT[contact.seniority ?? ""] ?? 0;
  score += Math.round(contact.confidence * 0.3);
  if (contact.verificationStatus === "valid") score += 15;
  if (contact.fullName) score += 10;
  if (contact.position) score += 5;
  return score;
}

/**
 * Drops unusable rows (no name, provider says invalid) and orders the rest by
 * buying authority, then confidence, then email for a stable order.
 */
export function rankEnrichedContacts(
  contacts: readonly EnrichedContact[],
  limit = DEFAULT_CONTACTS_PER_COMPANY,
): EnrichedContact[] {
  const seen = new Set<string>();
  return contacts
    .filter((contact) => contact.email.trim() && contact.fullName && contact.verificationStatus !== "invalid")
    .map((contact) => ({ ...contact, email: contact.email.trim().toLowerCase() }))
    .sort((left, right) =>
      contactPriority(right) - contactPriority(left)
      || right.confidence - left.confidence
      || left.email.localeCompare(right.email))
    .filter((contact) => {
      if (seen.has(contact.email)) return false;
      seen.add(contact.email);
      return true;
    })
    .slice(0, Math.max(0, limit));
}

export type PrimaryContact = {
  name: string | null;
  title: string | null;
  email: string | null;
  verification: EmailVerification | null;
};

/**
 * The person a research row should show: the best enriched contact whose
 * address did not verify as undeliverable, else the first usable public email.
 * When every address is undeliverable the row keeps the company but no email,
 * so a campaign audience never picks up an address known to bounce.
 */
export function selectPrimaryContact(input: {
  contacts?: readonly EnrichedContact[];
  emails: readonly string[];
  verifications: readonly EmailVerification[];
}): PrimaryContact {
  const byEmail = new Map(input.verifications.map((verification) => [verification.email, verification]));
  const usable = (email: string) => byEmail.get(email.toLowerCase())?.verdict !== "undeliverable";
  const named = (input.contacts ?? []).find((contact) => usable(contact.email));
  if (named) {
    return {
      name: named.fullName,
      title: named.position,
      email: named.email,
      verification: byEmail.get(named.email.toLowerCase()) ?? null,
    };
  }
  const email = input.emails.find(usable) ?? null;
  const rejected = input.emails[0];
  return {
    name: null,
    title: null,
    email,
    verification: email
      ? byEmail.get(email.toLowerCase()) ?? null
      : rejected ? byEmail.get(rejected.toLowerCase()) ?? null : null,
  };
}

/**
 * Fresh enricher built from `HUNTER_API_KEY`; null when unset. Each call
 * returns a new adapter with its own memo, usage counters and exhausted flag,
 * so a quota response in one batch cannot silence the next one.
 */
export function contactEnricherFromEnv(): ContactEnricher | null {
  const apiKey = process.env.HUNTER_API_KEY?.trim();
  return apiKey ? createHunterEnricher({ apiKey }) : null;
}
