// Email deliverability screening. Outbound SMTP is not available from every
// runtime, so verification is layered: syntax, disposable and free-provider
// checks, domain alignment, then a live MX lookup when DNS is reachable. When a
// mailbox verifier (Bouncer) is configured it runs after those free checks and
// its SMTP-level verdict overrides the heuristic score; when it is missing,
// fails, or answers "unknown", the heuristic verdict stands so callers never
// lose a candidate to a provider outage.

import { promises as dns } from "node:dns";
import { createBouncerVerifier, fetchBouncerCredits } from "./bouncer";
import { emailDomain, isRoleEmail, registrableDomain } from "./extract";

export type EmailVerdict = "deliverable_likely" | "risky" | "undeliverable" | "unknown";

export type EmailVerification = {
  email: string;
  verdict: EmailVerdict;
  confidence: number;
  isRole: boolean;
  hasMx: boolean | null;
  mxHost: string | null;
  isFreeProvider: boolean;
  domainMatchesCompany: boolean;
  reasons: string[];
  /** Set when a mailbox verifier produced the final verdict. */
  provider?: MailboxVerdict | null;
};

export type MailboxStatus = "deliverable" | "risky" | "undeliverable" | "unknown";

export type MailboxVerdict = {
  provider: string;
  status: MailboxStatus;
  reason: string;
  score: number | null;
  acceptAll: boolean | null;
  disposable: boolean | null;
  free: boolean | null;
  role: boolean | null;
  disabled: boolean | null;
  fullMailbox: boolean | null;
  checkedAt: string;
};

export type MailboxVerifierUsage = {
  provider: string;
  calls: number;
  cached: number;
  failures: number;
  /** Provider reported no credits left (HTTP 402). */
  exhausted: boolean;
};

export type MailboxVerifier = {
  name: string;
  verify(email: string): Promise<MailboxVerdict>;
  usage(): MailboxVerifierUsage;
};

// Dot-atom local part (no leading, trailing or consecutive dots) at a domain of
// LDH labels (no leading or trailing hyphen, no empty label) ending in an
// alphabetic TLD. Shared by discovery, the campaign planner and the send gate.
export const EMAIL_SYNTAX =
  /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

export function emailSyntaxValid(email: string) {
  const normalized = email.trim();
  return normalized.length <= 254 && normalized.indexOf("@") <= 64 && EMAIL_SYNTAX.test(normalized);
}

export const FREE_PROVIDERS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yandex.com", "yandex.com.tr",
  "mynet.com", "windowslive.com", "icloud.com", "live.com", "msn.com", "superonline.com",
  "ttmail.com", "mail.ru", "gmx.com", "aol.com",
]);

export const DISPOSABLE_PROVIDERS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com",
  "sharklasers.com", "trashmail.com", "getnada.com", "temp-mail.org",
]);

export const PLACEHOLDER_LOCAL_PARTS = new Set([
  "email", "eposta", "mail", "adres", "ornek", "example", "test", "yourname", "isim",
  "someone", "name", "firstname", "lastname", "user", "username", "sample", "demo",
  "your-email", "youremail", "your.email", "emailaddress", "e-mail", "xxx", "asdf",
  "noemail", "none", "null", "n-a", "unknown",
]);

// Domains that only ever appear in templates, documentation, and scraped form
// placeholders. Several of them resolve (example.com publishes a Null MX), so
// an MX lookup alone does not catch them. Real organisations and mailbox
// providers never belong here: a hit suppresses the address office-wide.
export const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.net", "example.org", "example.edu", "example.co.uk", "example.de",
  "domain.tld", "yourdomain.com", "yourcompany.com", "yoursite.com", "yourwebsite.com",
  "companyname.com", "emailaddress.com", "mail.example", "placeholder.com", "adres.com",
  "sirket.com", "firma.com", "ornek.com", "eposta.com", "mailinator.test", "localhost.com",
]);

const PLACEHOLDER_TLDS = new Set(["example", "test", "invalid", "localhost", "local", "internal", "lan"]);

// Error-tracker DSNs (`<32 hex>@o123.ingest.sentry.io`, `<hex>@sentry-next.wixpress.com`)
// match the email pattern when a page's scripts are scraped. The key, not the
// domain, identifies them: a 32+ character hex local part is never a mailbox.
const GENERATED_TOKEN_LOCAL_PART = /^[0-9a-f]{32,}$/;

// Both the address and the domain are inspected so the same rule serves the
// discovery scoring, the campaign planner, and the pre-send gate.
export function placeholderEmailReason(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return "invalid syntax";
  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (PLACEHOLDER_LOCAL_PARTS.has(localPart)) return "placeholder address";
  if (GENERATED_TOKEN_LOCAL_PART.test(localPart)) return "generated token, not a mailbox";
  if (PLACEHOLDER_DOMAINS.has(domain)) return "placeholder domain";
  const tld = domain.split(".").pop() ?? "";
  if (PLACEHOLDER_TLDS.has(tld)) return "reserved domain";
  if (/(?:^|\.)(?:example|placeholder|yourdomain|yourcompany)\./.test(domain)) return "placeholder domain";
  return null;
}

// RFC 7505: a single MX record whose exchange is "." (or empty) declares that
// the domain accepts no mail at all.
export function usableMxRecords<T extends { exchange: string; priority: number }>(records: readonly T[]) {
  return records.filter((record) => {
    const exchange = record.exchange.trim().replace(/\.$/, "");
    return exchange.length > 0;
  });
}

export type VerifyOptions = {
  /** Injectable for tests. Defaults to a real MX lookup. */
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** Domain of the company the address was found on. */
  companyDomain?: string;
  /**
   * Mailbox verifier consulted after the free checks. `undefined` builds one
   * from `BOUNCER_API_KEY` for this call; `null` disables it. Batch callers
   * should pass one shared instance so memo and usage cover the batch.
   */
  verifier?: MailboxVerifier | null;
};

/**
 * Fresh verifier built from `BOUNCER_API_KEY`; null when unset. Each call
 * returns a new adapter with its own memo, usage counters and exhausted flag,
 * so a quota response in one batch cannot silence the next one.
 */
export function mailboxVerifierFromEnv(): MailboxVerifier | null {
  const apiKey = process.env.BOUNCER_API_KEY?.trim();
  return apiKey ? createBouncerVerifier({ apiKey }) : null;
}

export async function mailboxVerifierCreditsFromEnv() {
  const apiKey = process.env.BOUNCER_API_KEY?.trim();
  return apiKey ? { provider: "bouncer", ...await fetchBouncerCredits({ apiKey }) } : null;
}

function applyMailboxVerdict(heuristic: EmailVerification, verdict: MailboxVerdict): EmailVerification {
  const reasons = [...heuristic.reasons];
  const tag = `${verdict.provider}: ${verdict.status} (${verdict.reason})`;
  switch (verdict.status) {
    case "deliverable": {
      reasons.push(tag);
      const confidence = Math.max(heuristic.confidence, verdict.score ?? 90);
      return { ...heuristic, verdict: "deliverable_likely", confidence: Math.min(99, confidence), reasons, provider: verdict };
    }
    case "undeliverable": {
      reasons.push(tag);
      return { ...heuristic, verdict: "undeliverable", confidence: Math.min(heuristic.confidence, 5), reasons, provider: verdict };
    }
    case "risky": {
      reasons.push(tag);
      if (verdict.acceptAll) reasons.push("accept-all domain, mailbox existence cannot be confirmed");
      if (verdict.disabled) reasons.push("mailbox disabled");
      if (verdict.fullMailbox) reasons.push("mailbox full");
      // Never reaches the deliverable threshold; a low provider score also drops
      // it under the persistence floor so weak accept-all guesses stay out.
      const confidence = Math.min(59, verdict.score ?? 45);
      return { ...heuristic, verdict: "risky", confidence, reasons, provider: verdict };
    }
    case "unknown":
    default:
      reasons.push(`${verdict.provider}: unknown (${verdict.reason}), heuristic verdict kept`);
      return { ...heuristic, reasons, provider: verdict };
  }
}

export async function verifyEmail(email: string, options: VerifyOptions = {}): Promise<EmailVerification> {
  const normalized = email.trim().toLowerCase();
  const reasons: string[] = [];
  const domain = emailDomain(normalized);
  const isRole = isRoleEmail(normalized);
  const isFreeProvider = FREE_PROVIDERS.has(domain);
  const companyDomain = options.companyDomain ? registrableDomain(options.companyDomain) : null;
  const domainMatchesCompany = companyDomain ? registrableDomain(domain) === companyDomain : false;

  const base: EmailVerification = {
    email: normalized,
    verdict: "unknown",
    confidence: 0,
    isRole,
    hasMx: null,
    mxHost: null,
    isFreeProvider,
    domainMatchesCompany,
    reasons,
    provider: null,
  };

  if (!emailSyntaxValid(normalized)) {
    return { ...base, verdict: "undeliverable", reasons: ["invalid syntax"] };
  }
  if (DISPOSABLE_PROVIDERS.has(domain)) {
    return { ...base, verdict: "undeliverable", reasons: ["disposable provider"] };
  }
  const placeholder = placeholderEmailReason(normalized);
  if (placeholder) {
    return { ...base, verdict: "undeliverable", reasons: [placeholder] };
  }

  const resolver = options.resolveMx ?? ((value: string) => dns.resolveMx(value));
  let hasMx: boolean | null = null;
  let mxHost: string | null = null;
  try {
    const records = usableMxRecords(await resolver(domain));
    const sorted = [...records].sort((a, b) => a.priority - b.priority);
    hasMx = sorted.length > 0;
    mxHost = sorted[0]?.exchange ?? null;
  } catch {
    hasMx = false;
    reasons.push("mx lookup failed");
  }

  if (!hasMx) {
    return { ...base, verdict: "undeliverable", hasMx: false, reasons: [...reasons, "no mx record"] };
  }

  let confidence = 55;
  if (domainMatchesCompany) {
    confidence += 20;
    reasons.push("address is on the company domain");
  }
  if (isRole) {
    confidence += 10;
    reasons.push("role inbox, monitored but not a named person");
  }
  if (isFreeProvider) {
    confidence -= 15;
    reasons.push("free mailbox provider");
  }

  confidence = Math.max(5, Math.min(95, confidence));
  const verdict: EmailVerdict = confidence >= 60 ? "deliverable_likely" : "risky";
  const heuristic: EmailVerification = { ...base, verdict, confidence, hasMx: true, mxHost, reasons };

  const verifier = options.verifier === undefined ? mailboxVerifierFromEnv() : options.verifier;
  if (!verifier) return heuristic;
  try {
    return applyMailboxVerdict(heuristic, await verifier.verify(normalized));
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { ...heuristic, reasons: [...reasons, `${verifier.name} unavailable (${message}), heuristic verdict kept`] };
  }
}

/** Paid verifier calls per company by default; the rest stay heuristic. */
export const DEFAULT_VERIFIER_LIMIT = 6;

export async function verifyEmails(
  emails: readonly string[],
  options: VerifyOptions & { concurrency?: number; verifierLimit?: number } = {},
): Promise<EmailVerification[]> {
  const concurrency = options.concurrency ?? 8;
  const queue = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
  const verifier = options.verifier === undefined ? mailboxVerifierFromEnv() : options.verifier;
  const paid = new Set(queue.slice(0, Math.max(0, options.verifierLimit ?? DEFAULT_VERIFIER_LIMIT)));
  const results: EmailVerification[] = [];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results.push(await verifyEmail(next, { ...options, verifier: paid.has(next) ? verifier : null }));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  return results;
}
