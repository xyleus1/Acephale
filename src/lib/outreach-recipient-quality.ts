// Product-wide recipient quality gate for outbound campaigns. Every campaign,
// for every office and company, passes its audience through the same two
// layers: a static layer at planning time (pure, no network) so the reviewer
// approves a pruned list, and a live layer right before a provider send (MX
// plus the optional mailbox verifier) so an address that decayed since
// research never reaches a mailbox. Nothing here is company specific.

import { promises as dns } from "node:dns";
import { isFreeMailAddress } from "@/lib/batch-review";
import { registrableDomain } from "@/lib/leadgen/extract";
import {
  DISPOSABLE_PROVIDERS,
  emailSyntaxValid,
  mailboxVerifierFromEnv,
  placeholderEmailReason,
  usableMxRecords,
  verifyEmail,
  type EmailVerification,
  type EmailVerdict,
  type MailboxVerifier,
  type VerifyOptions,
} from "@/lib/leadgen/verify";

// Part of every campaign revision hash. Bumping it makes an already-approved
// draft stale so it is re-planned through the newer gate before it can start.
export const RECIPIENT_QUALITY_GATE_VERSION = "recipient-gate-2026-09-v1";

// At most this many recipients per company domain in one campaign. Free-mail domains are
// exempt because they say nothing about the company.
export const CAMPAIGN_MAX_RECIPIENTS_PER_DOMAIN = 3;

// Paid mailbox checks one campaign batch may spend before the rest of the
// batch falls back to the free checks (syntax, placeholder, disposable, MX).
export const OUTREACH_SEND_VERIFICATION_BUDGET = 60;

export const RECIPIENT_QUALITY_BLOCKS = [
  "INVALID_SYNTAX",
  "PLACEHOLDER_ADDRESS",
  "DISPOSABLE_DOMAIN",
  "UNDELIVERABLE",
  "NO_MX",
  "DOMAIN_CONCENTRATION",
] as const;

export type RecipientQualityBlock = (typeof RECIPIENT_QUALITY_BLOCKS)[number];

// Caveats on rows that stay sendable. They are tallied for the reviewer so a
// list built without organisation evidence is visible before approval.
export const RECIPIENT_QUALITY_WARNINGS = [
  "UNCONFIRMED_MAILBOX",
  "DOMAIN_MISMATCH",
  "NO_ORGANIZATION_EVIDENCE",
] as const;

export type RecipientQualityWarning = (typeof RECIPIENT_QUALITY_WARNINGS)[number];

export type RecipientQualityVerdict =
  | { blocked: false; warnings: string[]; caveats: RecipientQualityWarning[] }
  | { blocked: true; reason: RecipientQualityBlock; detail: string };

const WARNING_LABELS: Record<RecipientQualityWarning, string> = {
  UNCONFIRMED_MAILBOX: "not confirmed deliverable at research time",
  DOMAIN_MISMATCH: "email domain differs from the company domain",
  NO_ORGANIZATION_EVIDENCE: "no website, domain, or source URL on the row",
};

const BLOCK_LABELS: Record<RecipientQualityBlock, string> = {
  INVALID_SYNTAX: "invalid email syntax",
  PLACEHOLDER_ADDRESS: "placeholder or template address",
  DISPOSABLE_DOMAIN: "disposable mailbox provider",
  UNDELIVERABLE: "mailbox verified undeliverable",
  NO_MX: "domain accepts no mail",
  DOMAIN_CONCENTRATION: `more than ${CAMPAIGN_MAX_RECIPIENTS_PER_DOMAIN} recipients at one company domain`,
};

export function describeRecipientQualityBlock(reason: RecipientQualityBlock, detail?: string) {
  const label = BLOCK_LABELS[reason];
  return detail && detail !== label ? `${label} (${detail})` : label;
}

// Blocks that describe the address itself rather than this campaign, so the
// office never has to rediscover them on the next list.
export function recipientQualityBlockIsPermanent(reason: RecipientQualityBlock) {
  return reason === "PLACEHOLDER_ADDRESS"
    || reason === "DISPOSABLE_DOMAIN"
    || reason === "UNDELIVERABLE"
    || reason === "NO_MX";
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function storedVerdict(data: Record<string, unknown> | undefined): EmailVerdict | null {
  const value = text(data?.email_verdict).toLowerCase();
  return value === "deliverable_likely" || value === "risky" || value === "undeliverable" || value === "unknown"
    ? value
    : null;
}

// A stored verdict describes the address the row carried when it was
// verified. When the row's address has since been edited to another mailbox,
// the verdict is not about the recipient we are about to mail and is dropped;
// the rest of the row (company, website, evidence) still applies.
export function recipientQualityDataFor(
  data: Record<string, unknown> | undefined,
  emailField: string | null | undefined,
  recipient: string,
): Record<string, unknown> | undefined {
  if (!data) return data;
  const field = emailField?.trim() || "email";
  const rowEmail = text(data[field]).toLowerCase();
  if (!rowEmail || rowEmail === recipient.trim().toLowerCase()) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "email_verdict"));
}

function companyDomainOf(data: Record<string, unknown> | undefined): string | null {
  const source = text(data?.domain) || text(data?.website);
  if (!source) return null;
  const domain = registrableDomain(source);
  return domain.includes(".") ? domain : null;
}

function hasOrganisationEvidence(data: Record<string, unknown> | undefined) {
  if (!data) return false;
  if (text(data.website) || text(data.domain)) return true;
  const evidence = data.evidence_urls;
  if (Array.isArray(evidence)) return evidence.some((url) => text(url).length > 0);
  return text(evidence).length > 0;
}

// Static layer: decided from the row alone, identical at planning and send.
export function recipientQualityVerdict(input: {
  email: string;
  data?: Record<string, unknown>;
}): RecipientQualityVerdict {
  const email = input.email.trim().toLowerCase();
  if (!emailSyntaxValid(email)) {
    return { blocked: true, reason: "INVALID_SYNTAX", detail: BLOCK_LABELS.INVALID_SYNTAX };
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (DISPOSABLE_PROVIDERS.has(domain)) {
    return { blocked: true, reason: "DISPOSABLE_DOMAIN", detail: domain };
  }
  const placeholder = placeholderEmailReason(email);
  if (placeholder) {
    return { blocked: true, reason: "PLACEHOLDER_ADDRESS", detail: placeholder };
  }
  const verdict = storedVerdict(input.data);
  if (verdict === "undeliverable") {
    return { blocked: true, reason: "UNDELIVERABLE", detail: "research verdict undeliverable" };
  }
  const warnings: string[] = [];
  const caveats: RecipientQualityWarning[] = [];
  if (verdict === "risky" || verdict === "unknown") {
    warnings.push("mailbox not confirmed deliverable at research time");
    caveats.push("UNCONFIRMED_MAILBOX");
  }
  const companyDomain = companyDomainOf(input.data);
  if (companyDomain && !isFreeMailAddress(email) && registrableDomain(domain) !== companyDomain) {
    warnings.push(`email domain ${registrableDomain(domain)} differs from company domain ${companyDomain}`);
    caveats.push("DOMAIN_MISMATCH");
  }
  if (!hasOrganisationEvidence(input.data)) {
    warnings.push(WARNING_LABELS.NO_ORGANIZATION_EVIDENCE);
    caveats.push("NO_ORGANIZATION_EVIDENCE");
  }
  return { blocked: false, warnings, caveats };
}

export type RecipientQualityPruneCounts = {
  total: number;
  reasons: Array<{ reason: RecipientQualityBlock; count: number }>;
  examples: string[];
  // Rows kept in the audience that carry a caveat, by caveat.
  caveats: Array<{ warning: RecipientQualityWarning; count: number }>;
};

export function emptyPruneCounts(): RecipientQualityPruneCounts {
  return { total: 0, reasons: [], examples: [], caveats: [] };
}

export function addKeptRecipientCaveats(counts: RecipientQualityPruneCounts, caveats: readonly RecipientQualityWarning[]) {
  for (const warning of caveats) {
    const entry = counts.caveats.find((item) => item.warning === warning);
    if (entry) entry.count += 1;
    else counts.caveats.push({ warning, count: 1 });
  }
  counts.caveats.sort((left, right) => right.count - left.count || left.warning.localeCompare(right.warning));
}

export function addPrunedRecipient(
  counts: RecipientQualityPruneCounts,
  input: { email: string; reason: RecipientQualityBlock },
) {
  counts.total += 1;
  const entry = counts.reasons.find((item) => item.reason === input.reason);
  if (entry) entry.count += 1;
  else counts.reasons.push({ reason: input.reason, count: 1 });
  counts.reasons.sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
  if (counts.examples.length < 5) counts.examples.push(input.email.trim().toLowerCase());
}

// Tallies caveats over the audience the reviewer will actually approve, so
// suppressed or already-contacted rows do not inflate the counts.
export function tallyKeptRecipientCaveats<T>(
  counts: RecipientQualityPruneCounts,
  rows: readonly T[],
  recipientOf: (row: T) => { email: string; data?: Record<string, unknown> },
) {
  for (const row of rows) {
    const verdict = recipientQualityVerdict(recipientOf(row));
    if (!verdict.blocked) addKeptRecipientCaveats(counts, verdict.caveats);
  }
}

export function recipientQualityPruneLines(counts: RecipientQualityPruneCounts) {
  const lines: string[] = [];
  if (counts.total === 0) {
    lines.push("Pruned before review: none, every eligible row passed the recipient quality gate.");
  } else {
    const reasons = counts.reasons
      .map((entry) => `${entry.count} ${describeRecipientQualityBlock(entry.reason)}`)
      .join("; ");
    lines.push(`Pruned before review: ${counts.total} recipient${counts.total === 1 ? "" : "s"} removed (${reasons}).`);
    if (counts.examples.length) lines.push(`Pruned examples: ${counts.examples.join(", ")}.`);
  }
  if (counts.caveats.length) {
    const caveats = counts.caveats
      .map((entry) => `${entry.count} ${WARNING_LABELS[entry.warning]}`)
      .join("; ");
    lines.push(`Kept with caveats: ${caveats}. Strike recipients you cannot place, or tighten the list before approving.`);
  }
  return lines;
}

// Keeps the first N recipients per company domain in the given order. Both
// halves are returned so the planner can report what it dropped.
export function capRecipientsPerDomain<T>(input: {
  rows: readonly T[];
  recipientOf: (row: T) => string;
  max?: number;
}): { kept: T[]; dropped: T[] } {
  const max = input.max ?? CAMPAIGN_MAX_RECIPIENTS_PER_DOMAIN;
  const seen = new Map<string, number>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const row of input.rows) {
    const email = input.recipientOf(row).trim().toLowerCase();
    const domain = registrableDomain(email.slice(email.lastIndexOf("@") + 1));
    if (!domain || isFreeMailAddress(email)) {
      kept.push(row);
      continue;
    }
    const count = seen.get(domain) ?? 0;
    if (count >= max) {
      dropped.push(row);
      continue;
    }
    seen.set(domain, count + 1);
    kept.push(row);
  }
  return { kept, dropped };
}

export type LiveRecipientCheck = {
  verifier?: MailboxVerifier | null;
  resolveMx?: VerifyOptions["resolveMx"];
  // A and AAAA lookup for a domain that publishes no MX record, which RFC 5321
  // treats as an implicit MX on the host itself. Injectable for tests.
  resolveAddress?: (domain: string) => Promise<string[]>;
  budget?: number;
};

export type LiveRecipientOutcome<T> =
  | { row: T; email: string; ok: true; verification: EmailVerification | null; warnings: string[] }
  | { row: T; email: string; ok: false; reason: RecipientQualityBlock; detail: string };

// Source stamped on the office-scoped suppression written when the live gate
// refuses an address for a reason that describes the address itself.
export const RECIPIENT_QUALITY_SUPPRESSION_SOURCE = "RECIPIENT_QUALITY_GATE";

export type RecipientQualityRefusal = {
  // Operator-facing ledger message.
  error: string;
  // Suppression detail, without the ledger wording.
  detail: string;
  // Whether the refusal should be persisted as an UNDELIVERABLE suppression.
  permanent: boolean;
};

// One wording for every outbound path (campaign first touch, follow-up, bulk
// RFQ) so the ledger, the reviewer, and the suppression table agree.
export function recipientQualityRefusal(outcome: { reason: RecipientQualityBlock; detail: string }): RecipientQualityRefusal {
  const detail = describeRecipientQualityBlock(outcome.reason, outcome.detail);
  return {
    error: `Recipient skipped: ${detail}.`,
    detail,
    permanent: recipientQualityBlockIsPermanent(outcome.reason),
  };
}

function liveBlock(verification: EmailVerification): { reason: RecipientQualityBlock; detail: string } | null {
  if (verification.verdict !== "undeliverable") return null;
  if (verification.hasMx === false) return { reason: "NO_MX", detail: verification.reasons.join(", ") || BLOCK_LABELS.NO_MX };
  return {
    reason: "UNDELIVERABLE",
    detail: verification.provider
      ? `${verification.provider.provider}: ${verification.provider.reason || verification.provider.status}`
      : verification.reasons.join(", ") || BLOCK_LABELS.UNDELIVERABLE,
  };
}

type MxRecord = { exchange: string; priority: number };

type MxOutcome =
  | { kind: "records"; records: MxRecord[] }
  // The authoritative answer is that the domain takes no mail: Null MX, or
  // the name does not exist, or it has neither MX nor an address record.
  | { kind: "none"; detail: string }
  // The resolver could not answer (timeout, SERVFAIL, refused). Not evidence
  // about the address, so the row is neither blocked nor suppressed.
  | { kind: "unavailable" };

type DnsResolveAddress = NonNullable<LiveRecipientCheck["resolveAddress"]>;

// Name does not exist at all.
const NXDOMAIN_CODES = new Set(["ENOTFOUND", "NXDOMAIN"]);
// Name exists but has no record of the requested type.
const NODATA_CODES = new Set(["ENODATA"]);

function dnsErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

async function defaultResolveAddress(domain: string) {
  const lookups = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  const addresses = lookups.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (addresses.length) return addresses;
  const failures = lookups.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const nxdomain = failures.find((result) => NXDOMAIN_CODES.has(dnsErrorCode(result.reason)));
  if (nxdomain) throw nxdomain.reason;
  const other = failures.find((result) => !NODATA_CODES.has(dnsErrorCode(result.reason)));
  if (other) throw other.reason;
  return [];
}

// RFC 5321 fallback: a domain without an MX record is still a mail domain
// when its name resolves to an address, so only a domain with neither is
// treated as taking no mail.
async function implicitMxOutcome(domain: string, resolveAddress: DnsResolveAddress): Promise<MxOutcome> {
  try {
    const addresses = await resolveAddress(domain);
    return addresses.length
      ? { kind: "records", records: [{ exchange: domain, priority: 0 }] }
      : { kind: "none", detail: `${domain} publishes no MX and no address record` };
  } catch (error) {
    const code = dnsErrorCode(error);
    return NXDOMAIN_CODES.has(code) || NODATA_CODES.has(code)
      ? { kind: "none", detail: `${domain} publishes no MX and no address record` }
      : { kind: "unavailable" };
  }
}

async function resolveMxOutcome(
  domain: string,
  resolveMx: NonNullable<VerifyOptions["resolveMx"]>,
  resolveAddress: DnsResolveAddress,
): Promise<MxOutcome> {
  try {
    const raw = await resolveMx(domain);
    const records = usableMxRecords(raw);
    if (records.length) return { kind: "records", records };
    // A record set that is only "." is Null MX (RFC 7505): explicit refusal.
    if (raw.length) return { kind: "none", detail: `${domain} publishes a Null MX record and does not accept email` };
    return implicitMxOutcome(domain, resolveAddress);
  } catch (error) {
    const code = dnsErrorCode(error);
    if (NXDOMAIN_CODES.has(code)) return { kind: "none", detail: `${domain} does not exist` };
    if (NODATA_CODES.has(code)) return implicitMxOutcome(domain, resolveAddress);
    return { kind: "unavailable" };
  }
}

// Holds the per-batch budget and the per-domain MX answers so a batch that is
// walked in several pages spends each lookup and each paid check once.
export class LiveRecipientGate {
  readonly budget: number;
  readonly verifier: MailboxVerifier | null;
  paidChecks = 0;
  budgetReached = false;
  private readonly resolveMx: NonNullable<VerifyOptions["resolveMx"]>;
  private readonly resolveAddress: DnsResolveAddress;
  private readonly mx = new Map<string, Promise<MxOutcome>>();

  constructor(check: LiveRecipientCheck = {}) {
    this.budget = Math.max(0, check.budget ?? OUTREACH_SEND_VERIFICATION_BUDGET);
    this.verifier = check.verifier === undefined ? mailboxVerifierFromEnv() : check.verifier;
    this.resolveMx = check.resolveMx ?? ((domain) => dns.resolveMx(domain));
    this.resolveAddress = check.resolveAddress ?? defaultResolveAddress;
  }

  private mxFor(domain: string) {
    let pending = this.mx.get(domain);
    if (!pending) {
      pending = resolveMxOutcome(domain, this.resolveMx, this.resolveAddress);
      this.mx.set(domain, pending);
    }
    return pending;
  }

  // Static verdict first, then the domain's MX, then the paid verifier for a
  // row research did not already confirm, while the budget lasts.
  async check<T>(row: T, email: string, data: Record<string, unknown> | undefined): Promise<LiveRecipientOutcome<T>> {
    const verdict = recipientQualityVerdict({ email, data });
    if (verdict.blocked) return { row, email, ok: false, reason: verdict.reason, detail: verdict.detail };
    const warnings = [...verdict.warnings];
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const mx = await this.mxFor(domain);
    if (mx.kind === "none") return { row, email, ok: false, reason: "NO_MX", detail: mx.detail };
    if (mx.kind === "unavailable") {
      warnings.push("mx lookup unavailable, sent unverified");
      return { row, email, ok: true, verification: null, warnings };
    }
    const confirmed = storedVerdict(data) === "deliverable_likely";
    const wantsPaid = !confirmed && this.verifier !== null;
    if (wantsPaid && this.paidChecks >= this.budget) this.budgetReached = true;
    const usePaid = wantsPaid && this.paidChecks < this.budget;
    if (usePaid) this.paidChecks += 1;
    let verification: EmailVerification | null = null;
    try {
      verification = await verifyEmail(email, {
        resolveMx: async () => mx.records,
        companyDomain: companyDomainOf(data) ?? undefined,
        verifier: usePaid ? this.verifier : null,
      });
    } catch {
      verification = null;
    }
    const block = verification ? liveBlock(verification) : null;
    if (block) return { row, email, ok: false, ...block };
    if (verification?.verdict === "risky") warnings.push("mailbox verdict risky");
    return { row, email, ok: true, verification, warnings };
  }
}
