// Email deliverability screening. Outbound SMTP is not available from every
// runtime, so verification is layered: syntax, disposable and free-provider
// checks, domain alignment, then a live MX lookup when DNS is reachable. A
// paid mailbox verifier can be layered on later without changing callers.

import { promises as dns } from "node:dns";
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
};

const SYNTAX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/;

const FREE_PROVIDERS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yandex.com", "yandex.com.tr",
  "mynet.com", "windowslive.com", "icloud.com", "live.com", "msn.com", "superonline.com",
  "ttmail.com", "mail.ru", "gmx.com", "aol.com",
]);

const DISPOSABLE_PROVIDERS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com",
  "sharklasers.com", "trashmail.com", "getnada.com", "temp-mail.org",
]);

const PLACEHOLDER_LOCAL_PARTS = new Set([
  "email", "eposta", "mail", "adres", "ornek", "example", "test", "yourname", "isim",
]);

export type VerifyOptions = {
  /** Injectable for tests. Defaults to a real MX lookup. */
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  /** Domain of the company the address was found on. */
  companyDomain?: string;
};

export async function verifyEmail(email: string, options: VerifyOptions = {}): Promise<EmailVerification> {
  const normalized = email.trim().toLowerCase();
  const reasons: string[] = [];
  const domain = emailDomain(normalized);
  const isRole = isRoleEmail(normalized);
  const localPart = normalized.split("@")[0] ?? "";
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
  };

  if (!SYNTAX.test(normalized)) {
    return { ...base, verdict: "undeliverable", reasons: ["invalid syntax"] };
  }
  if (DISPOSABLE_PROVIDERS.has(domain)) {
    return { ...base, verdict: "undeliverable", reasons: ["disposable provider"] };
  }
  if (PLACEHOLDER_LOCAL_PARTS.has(localPart)) {
    return { ...base, verdict: "undeliverable", reasons: ["placeholder address"] };
  }

  const resolver = options.resolveMx ?? ((value: string) => dns.resolveMx(value));
  let hasMx: boolean | null = null;
  let mxHost: string | null = null;
  try {
    const records = await resolver(domain);
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

  return { ...base, verdict, confidence, hasMx: true, mxHost, reasons };
}

export async function verifyEmails(
  emails: readonly string[],
  options: VerifyOptions & { concurrency?: number } = {},
): Promise<EmailVerification[]> {
  const concurrency = options.concurrency ?? 8;
  const queue = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
  const results: EmailVerification[] = [];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results.push(await verifyEmail(next, options));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  return results;
}
