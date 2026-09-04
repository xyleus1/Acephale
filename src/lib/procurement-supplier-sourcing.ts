import "server-only";

import { randomUUID } from "node:crypto";
import {
  extractEmails,
  extractLinks,
  htmlToText,
  registrableDomain,
} from "@/lib/leadgen/extract";
import { defaultFetcher, scoreEmailUsefulness, type PageFetcher } from "@/lib/leadgen/harvest";
import { verifyEmail, type EmailVerification } from "@/lib/leadgen/verify";
import { stripEmDashes } from "@/lib/no-em-dash";
import { loadBulkRfqOrder, type BulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import {
  advanceProcurementOrderStatus,
  reconcileProcurementOrderStatus,
} from "@/lib/procurement-order-status";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";
import {
  selectSupplierDomainProposers,
  type SupplierDomainProposal,
  type SupplierDomainProposer,
} from "@/lib/supply-os/supplier-domain-discovery";
import {
  classifySupplierSourcingCategory,
  qualifySupplierSite,
  supplierSourcingQueries,
  supplierSourcingQueryRounds,
  type SupplierSourcingCategory,
} from "@/lib/supply-os/supplier-sourcing-category";

// A sourcing wave adds qualified suppliers to an existing request. Discovery
// proposes domains, this module fetches each site itself, keeps only sites that
// publish the capability the category requires, verifies the address, and loads
// the survivors as researched vendors with their evidence. Nothing here sends
// mail: outreach stays on the bulk RFQ path behind its own confirmation.

export const SOURCING_WAVE_MAX_TARGET = 120;
const MAX_CRAWLED_PAGES = 4;
const MAX_TEXT_PER_SITE = 60_000;
const MAX_PROPOSAL_ROUNDS = 12;
const MAX_EMPTY_ROUNDS = 3;
const CRAWL_CONCURRENCY = 4;
// Checking the clock between calls is not enough, because one web search or one
// slow site can outlast the whole slice on its own. Every external call is also
// capped, and never allowed past the wave deadline.
// One high context web search answers in roughly 60 to 100 seconds, so a cap
// below that aborted every discovery call and the wave added nobody.
export const MAX_DISCOVERY_CALL_MS = 130_000;
const MAX_CRAWL_CALL_MS = 45_000;
const MAX_VERIFY_CALL_MS = 15_000;

class CallExpired extends Error {}

async function boundedCall<T>(work: () => Promise<T>, budgetMs: number): Promise<T> {
  if (budgetMs <= 0) throw new CallExpired("No time left for this call.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CallExpired("The call outlasted its budget.")), budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const CRAWL_PATH_HINTS = [
  "contact",
  "quote",
  "rfq",
  "capabilit",
  "about",
  "services",
  "manufactur",
  "process",
];

export type SourcingWaveRejection = {
  domain: string;
  reason: string;
};

export type SourcingWaveAddition = {
  vendorId: string;
  name: string;
  domain: string;
  website: string;
  contactEmail: string;
  matched: string[];
};

export type SourcingWaveResult = {
  orderId: string;
  material: string;
  category: string;
  target: number;
  added: number;
  additions: SourcingWaveAddition[];
  examined: number;
  rejected: SourcingWaveRejection[];
  queriesUsed: string[];
  discoveryExhausted: boolean;
  // The search phrase round this wave started on, and the one a continuation
  // should start on. Without carrying this forward every queued slice repeated
  // the first phrases, every proposal was already known, and the wave stopped
  // after one slice.
  startRound: number;
  nextRound: number;
  // Set when the wave stopped on its time budget with work still left, so the
  // caller knows the remainder is worth queueing.
  timedOut: boolean;
  // Discovery providers that failed during this wave, kept for the audit trail.
  providerFailures: string[];
  // Suppliers that qualified but could not be stored because the database
  // itself was failing. The slice stops on the first one, so the caller retries
  // the same work instead of counting qualified suppliers as rejected.
  persistenceFailures: string[];
};

export type SupplierSourcingErrorCode = "not_found" | "unsupported_category" | "discovery_unavailable";

export class SupplierSourcingError extends Error {
  constructor(
    message: string,
    readonly code: SupplierSourcingErrorCode,
  ) {
    super(message);
    this.name = "SupplierSourcingError";
  }
}

// What kinds of failure a wave can report. The wording is fixed, because a
// driver message carries schema, host, role, and connection detail that an
// operator does not need and an API result should never repeat.
const FAILURE_CLASSES = [
  { test: /connection pool|too many connections|connection terminated|connection closed|econnreset|econnrefused|etimedout|socket|server has closed/i, reason: "the database connection failed", transient: true },
  { test: /permission denied|not authorized|insufficient privilege|must be owner/i, reason: "the database refused the write", transient: true },
  { test: /rate limit|429|quota/i, reason: "a provider limit was reached", transient: true },
  { test: /timed out|timeout|aborted/i, reason: "the call ran out of time", transient: true },
  // A schema mismatch is about the deployment, not about this supplier, so it
  // must stop the slice rather than reject every supplier the wave qualified.
  { test: /does not exist|undefined column|undefined table|unknown column|no such (?:column|table)/i, reason: "the database schema did not match", transient: true },
  { test: /duplicate key|unique constraint/i, reason: "the supplier is already stored", transient: false },
  // Only failures that depend on the values this supplier supplied.
  { test: /value too long|invalid input syntax|out of range|numeric field overflow|violates check constraint|violates foreign key constraint|violates not-null constraint/i, reason: "the database rejected the row", transient: false },
] as const;

function classifyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return FAILURE_CLASSES.find((entry) => entry.test.test(message)) ?? null;
}

/**
 * A short, fixed reason for an unexpected failure, for the audit trail and for
 * the operator command. Only the class of failure is reported, never the
 * driver text, so nothing about the schema or the connection leaks into an API
 * result, a queued payload, or a log line.
 */
export function failureReason(error: unknown) {
  const classified = classifyFailure(error);
  if (classified) return classified.reason;
  const name = error instanceof Error ? stripEmDashes(error.name).replace(/[^A-Za-z]/g, "").slice(0, 40) : "";
  return name ? `an unexpected ${name}` : "an unexpected failure";
}

/**
 * Whether a failure is about the database or a provider rather than about this
 * one row. A shared dependency will fail the same way for every supplier in the
 * slice, so the wave stops and the work is retried instead of turning each
 * qualified supplier into a rejection and burning the search phrases.
 */
export function failureIsTransient(error: unknown) {
  const classified = classifyFailure(error);
  // An unrecognized failure is treated as transient, because abandoning
  // qualified suppliers is the more expensive mistake.
  return classified ? classified.transient : true;
}

// Reads the failure reason off a sourcing error by shape rather than by class,
// so a caller loaded through a different module instance still classifies the
// failure instead of treating it as an unexpected one.
export function supplierSourcingErrorCode(error: unknown): SupplierSourcingErrorCode | null {
  if (!(error instanceof Error) || error.name !== "SupplierSourcingError") return null;
  if (!("code" in error)) return null;
  const { code } = error;
  if (code === "not_found" || code === "unsupported_category" || code === "discovery_unavailable") {
    return code;
  }
  return null;
}

type ExistingVendorRow = {
  website: string | null;
  contactEmail: string | null;
};

function cleanName(value: string) {
  return stripEmDashes(value).replace(/\s+/g, " ").trim().slice(0, 160);
}

function companyNameFromSite(args: { title: string; domain: string }) {
  // Page titles read "Company | what they do", so the first usable segment is
  // the company. Taking the shortest one picks the tagline instead, which is how
  // earlier waves ended up greeting suppliers by their slogan.
  const title = args.title
    .split(/[|\-–:•]/)
    .map((part) => part.trim())
    .find((part) => part.length > 2 && !/^home$/i.test(part)) ?? "";
  const cleaned = cleanName(title)
    .replace(/\b(welcome to|official (?:site|website))\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length >= 3 && cleaned.length <= 80) return cleaned;
  const label = args.domain.split(".").at(0) ?? args.domain;
  return cleanName(label.replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()));
}

function pickCrawlLinks(html: string, baseUrl: string) {
  const base = registrableDomain(baseUrl);
  const scored: Array<{ link: string; rank: number }> = [];
  for (const link of extractLinks(html, baseUrl)) {
    if (registrableDomain(link) !== base) continue;
    const rank = CRAWL_PATH_HINTS.findIndex((hint) => link.toLowerCase().includes(hint));
    if (rank < 0) continue;
    if (scored.some((entry) => entry.link === link)) continue;
    scored.push({ link, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).slice(0, MAX_CRAWLED_PAGES - 1).map((entry) => entry.link);
}

// A quotation reaches a manufacturer fastest through its quoting desk, so an
// address published for RFQs outranks the general sales or info inbox.
const QUOTING_INBOXES = ["rfq", "quote", "quotes", "quoting", "estimating", "estimates", "engineering"];

function scoreQuotingInbox(email: string, companyDomain: string) {
  const local = email.split("@").at(0)?.toLowerCase() ?? "";
  const bonus = QUOTING_INBOXES.some((inbox) => local === inbox || local.startsWith(`${inbox}.`)) ? 8 : 0;
  return scoreEmailUsefulness(email, companyDomain) + bonus;
}

export type CrawledSupplierSite = {
  domain: string;
  website: string;
  companyName: string;
  text: string;
  emails: string[];
  sourceUrls: string[];
};

export async function crawlSupplierSite(
  url: string,
  fetchPage: PageFetcher = defaultFetcher,
): Promise<CrawledSupplierSite | null> {
  const home = await fetchPage(url);
  if (!home || home.status >= 400 || !home.body) return null;
  const domain = registrableDomain(home.url);
  if (!domain) return null;
  const pages = [home];
  if (!home.isPdf) {
    for (const link of pickCrawlLinks(home.body, home.url)) {
      const page = await fetchPage(link);
      if (page && page.status < 400 && page.body) pages.push(page);
    }
  }
  let text = "";
  const emails = new Set<string>();
  for (const page of pages) {
    const pageText = page.isPdf ? page.body : htmlToText(page.body);
    text = `${text}\n${pageText}`.slice(0, MAX_TEXT_PER_SITE);
    for (const email of extractEmails(page.isPdf ? page.body : `${page.body}\n${pageText}`)) {
      emails.add(email.toLowerCase());
    }
  }
  const titleMatch = home.isPdf ? null : /<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.body);
  return {
    domain,
    website: home.url,
    companyName: companyNameFromSite({ title: titleMatch?.[1] ? htmlToText(titleMatch[1]) : "", domain }),
    text,
    emails: [...emails]
      .filter((email) => !/\.(png|jpe?g|gif|svg|webp)$/i.test(email))
      .sort((a, b) => scoreQuotingInbox(b, domain) - scoreQuotingInbox(a, domain)),
    sourceUrls: pages.map((page) => page.url).slice(0, MAX_CRAWLED_PAGES),
  };
}

async function existingVendorKeys(orderId: string) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<ExistingVendorRow[]>(`
    SELECT
      order_vendors.website AS "website",
      COALESCE(
        order_vendors.contact_email,
        order_vendors.email,
        to_jsonb(order_vendors)->'contact'->>'email',
        to_jsonb(order_vendors)->'research'->>'contact_email'
      ) AS "contactEmail"
    FROM order_vendors
    WHERE order_vendors.order_id = $1::uuid
  `, orderId);
  const domains = new Set<string>();
  const emails = new Set<string>();
  for (const row of rows) {
    const domain = row.website ? registrableDomain(row.website) : "";
    if (domain) domains.add(domain);
    const email = row.contactEmail?.trim().toLowerCase() ?? "";
    if (email.includes("@")) {
      emails.add(email);
      const emailDomainValue = registrableDomain(email.split("@").at(1) ?? "");
      if (emailDomainValue) domains.add(emailDomainValue);
    }
  }
  return { domains, emails };
}

async function insertSourcedVendor(args: {
  order: BulkRfqOrder;
  category: SupplierSourcingCategory;
  site: CrawledSupplierSite;
  contactEmail: string;
  verification: EmailVerification;
  matched: string[];
  discoveredVia: string;
}) {
  const vendorId = randomUUID();
  const research = {
    source: "derya sourcing wave",
    category: args.category.key,
    categoryLabel: args.category.label,
    discoveredVia: args.discoveredVia,
    sourceUrls: args.site.sourceUrls,
    capabilityEvidence: args.matched,
    alternateEmails: args.site.emails.filter((email) => email !== args.contactEmail).slice(0, 5),
    contact_email: args.contactEmail,
    emailVerification: {
      verdict: args.verification.verdict,
      confidence: args.verification.confidence,
      hasMx: args.verification.hasMx,
      isRole: args.verification.isRole,
      domainMatchesCompany: args.verification.domainMatchesCompany,
    },
    discoveredAt: new Date().toISOString(),
  };
  // Re-checking the domain inside the insert keeps two concurrent waves, or a
  // retried run, from loading the same supplier twice.
  const inserted = await procurementWorkflowDatabase().$executeRawUnsafe(
    `
      INSERT INTO order_vendors (
        id, customer_id, order_id, name, website, contact_email, status, research, created_at, updated_at
      )
      SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'researched', $7::jsonb, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM order_vendors existing
        WHERE existing.order_id = $3::uuid
          AND (
            lower(coalesce(existing.contact_email, existing.email, '')) = lower($6)
            OR existing.website ILIKE $8
          )
      )
    `,
    vendorId,
    args.order.customerId,
    args.order.orderId,
    cleanName(args.site.companyName),
    args.site.website,
    args.contactEmail,
    JSON.stringify(research),
    `%${args.site.domain}%`,
  );
  return inserted > 0 ? vendorId : null;
}

export async function runProcurementSupplierSourcingWave(input: {
  orderId: string;
  target: number;
  // A wave runs inside a serverless invocation, so it stops cleanly at this
  // moment and lets the caller queue the remainder instead of being killed.
  deadlineAt?: number | null;
  startRound?: number | null;
  proposers?: readonly SupplierDomainProposer[];
  fetchPage?: PageFetcher;
  verify?: typeof verifyEmail;
  loadOrder?: typeof loadBulkRfqOrder;
  loadExistingKeys?: typeof existingVendorKeys;
  insertVendor?: typeof insertSourcedVendor;
  advanceStatus?: typeof advanceProcurementOrderStatus;
  reconcileStatus?: typeof reconcileProcurementOrderStatus;
}): Promise<SourcingWaveResult> {
  const advanceStatus = input.advanceStatus ?? advanceProcurementOrderStatus;
  const reconcileStatus = input.reconcileStatus ?? reconcileProcurementOrderStatus;
  const order = await (input.loadOrder ?? loadBulkRfqOrder)(input.orderId);
  if (!order) throw new SupplierSourcingError("The sourcing request was not found.", "not_found");
  const reconciledStatus = await reconcileStatus({
    customerId: order.customerId,
    orderId: order.orderId,
    officeId: order.officeId,
  });
  const category = classifySupplierSourcingCategory({
    material: order.material,
    specification: order.specification,
    notes: order.notes,
  });
  if (!category) {
    throw new SupplierSourcingError(
      "This request does not match a supported sourcing category, so a supplier wave would have no capability gate.",
      "unsupported_category",
    );
  }
  const proposers = selectSupplierDomainProposers({ proposers: input.proposers });
  if (!proposers.length) {
    throw new SupplierSourcingError("Supplier discovery is not configured for this environment.", "discovery_unavailable");
  }
  const target = Math.min(SOURCING_WAVE_MAX_TARGET, Math.max(1, Math.trunc(input.target)));
  const fetchPage = input.fetchPage ?? defaultFetcher;
  const verify = input.verify ?? verifyEmail;
  const insertVendor = input.insertVendor ?? insertSourcedVendor;
  const existing = await (input.loadExistingKeys ?? existingVendorKeys)(order.orderId);
  const seenDomains = new Set(existing.domains);
  const usedEmails = new Set(existing.emails);
  let statusAdvanceRequested = reconciledStatus !== null
    || existing.domains.size > 0
    || existing.emails.size > 0;
  const result: SourcingWaveResult = {
    orderId: order.orderId,
    material: order.material,
    category: category.key,
    target,
    added: 0,
    additions: [],
    examined: 0,
    rejected: [],
    queriesUsed: [],
    discoveryExhausted: false,
    startRound: 0,
    nextRound: 0,
    timedOut: false,
    providerFailures: [],
    persistenceFailures: [],
  };

  const outOfTime = () => typeof input.deadlineAt === "number" && Date.now() >= input.deadlineAt;
  // How long a single call may take: its own cap, and never past the deadline.
  const callBudget = (cap: number) => typeof input.deadlineAt === "number"
    ? Math.min(cap, input.deadlineAt - Date.now())
    : cap;

  const totalRounds = supplierSourcingQueryRounds(category, 2);
  const startRound = Math.max(0, Math.trunc(input.startRound ?? 0));
  result.startRound = startRound;
  result.nextRound = startRound;
  let emptyRounds = 0;

  for (let step = 0; step < MAX_PROPOSAL_ROUNDS && result.added < target; step += 1) {
    const round = startRound + step;
    if (round >= totalRounds) {
      // Every curated phrase for this category has been searched.
      result.discoveryExhausted = true;
      break;
    }
    if (outOfTime()) {
      result.timedOut = true;
      break;
    }
    const queries = supplierSourcingQueries(category, round, 2);
    const proposals: Array<{ domain: string; url: string; via: string }> = [];
    // A round whose phrases were not all searched must not be skipped by the
    // continuation, so the cursor only moves once the round is fully searched.
    let roundSearched = true;
    for (const query of queries) {
      if (outOfTime()) {
        result.timedOut = true;
        roundSearched = false;
        break;
      }
      // A phrase counts as searched when some provider answered, even with an
      // empty list. A phrase every provider failed on was never searched.
      let answered = false;
      for (const proposer of proposers) {
        // One failing discovery provider, for example an exhausted search API
        // quota, must not end the wave while another provider still answers.
        let found: SupplierDomainProposal[] = [];
        try {
          found = await boundedCall(() => proposer.propose({
            query,
            limit: Math.min(25, Math.max(8, (target - result.added) * 2)),
            excludeDomains: [...seenDomains].slice(-400),
          }), callBudget(MAX_DISCOVERY_CALL_MS));
        } catch (error) {
          if (error instanceof CallExpired) result.timedOut = true;
          result.providerFailures.push(proposer.name);
          continue;
        }
        answered = true;
        if (!found.length) continue;
        result.queriesUsed.push(`${proposer.name}: ${query}`);
        for (const proposal of found) {
          if (seenDomains.has(proposal.domain)) continue;
          seenDomains.add(proposal.domain);
          proposals.push(proposal);
        }
        break;
      }
      if (!answered) roundSearched = false;
    }
    if (roundSearched) result.nextRound = round + 1;
    if (!proposals.length) {
      // One search that returns nothing new is normal once a request already
      // holds hundreds of domains, so the wave moves on to the next phrases and
      // only gives up after several barren rounds in a row.
      emptyRounds += 1;
      if (emptyRounds >= MAX_EMPTY_ROUNDS) {
        result.discoveryExhausted = true;
        break;
      }
      continue;
    }
    emptyRounds = 0;

    const queue = [...proposals];
    const crawled: Array<{ site: CrawledSupplierSite; via: string }> = [];
    const failures: SourcingWaveRejection[] = [];
    await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        if (outOfTime()) {
          result.timedOut = true;
          return;
        }
        const next = queue.shift();
        if (!next) return;
        try {
          const site = await boundedCall(
            () => crawlSupplierSite(next.url, fetchPage),
            callBudget(MAX_CRAWL_CALL_MS),
          );
          if (!site) {
            failures.push({ domain: next.domain, reason: "the public site could not be read" });
            continue;
          }
          crawled.push({ site, via: next.via });
        } catch {
          failures.push({ domain: next.domain, reason: "the public site could not be read" });
        }
      }
    }));
    result.examined += proposals.length;
    result.rejected.push(...failures);

    for (const { site, via } of crawled) {
      if (result.added >= target) break;
      if (outOfTime()) {
        result.timedOut = true;
        break;
      }
      const qualification = qualifySupplierSite(category, site);
      if (qualification.state === "REJECTED") {
        result.rejected.push({ domain: site.domain, reason: qualification.reason });
        continue;
      }
      let accepted: { email: string; verification: EmailVerification } | null = null;
      for (const email of site.emails.slice(0, 4)) {
        if (usedEmails.has(email)) continue;
        let verification: EmailVerification;
        try {
          verification = await boundedCall(
            () => verify(email, { companyDomain: site.domain }),
            callBudget(MAX_VERIFY_CALL_MS),
          );
        } catch (error) {
          if (error instanceof CallExpired) result.timedOut = true;
          continue;
        }
        if (verification.verdict === "deliverable_likely") {
          accepted = { email, verification };
          break;
        }
      }
      if (!accepted) {
        result.rejected.push({ domain: site.domain, reason: "no published address passed deliverability screening" });
        continue;
      }
      // A single row that will not save, a name the column cannot hold or a
      // pool that has no connection left, used to throw away the whole wave
      // including the suppliers it had already qualified, so the failure is
      // recorded against that supplier and the wave keeps going.
      let vendorId: string | null;
      try {
        vendorId = await insertVendor({
          order,
          category,
          site,
          contactEmail: accepted.email,
          verification: accepted.verification,
          matched: qualification.matched,
          discoveredVia: via,
        });
      } catch (error) {
        const reason = failureReason(error);
        result.rejected.push({
          domain: site.domain,
          reason: `the supplier could not be saved: ${reason}`,
        });
        // A row the database will never accept belongs to that supplier alone.
        // A database that is down belongs to every supplier in the slice, so
        // the wave stops, keeps its cursor where the slice started, and says so,
        // otherwise the continuation would spend fresh search phrases on
        // suppliers this slice had already qualified and never saved.
        if (failureIsTransient(error)) {
          result.persistenceFailures.push(site.domain);
          result.nextRound = startRound;
          return result;
        }
        continue;
      }
      if (!vendorId) {
        result.rejected.push({ domain: site.domain, reason: "the supplier is already on this request" });
        continue;
      }
      usedEmails.add(accepted.email);
      result.added += 1;
      // The first supplier saved is the moment the request is visibly being
      // researched; the status write is idempotent, so a later wave is a no-op.
      if (result.added === 1 && !statusAdvanceRequested) {
        statusAdvanceRequested = true;
        await advanceStatus({
          customerId: order.customerId,
          orderId: order.orderId,
          event: "supplier_discovered",
        });
      }
      result.additions.push({
        vendorId,
        name: cleanName(site.companyName),
        domain: site.domain,
        website: site.website,
        contactEmail: accepted.email,
        matched: qualification.matched,
      });
    }
  }

  return result;
}
