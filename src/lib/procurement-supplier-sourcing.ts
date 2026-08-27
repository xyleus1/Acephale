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
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";
import {
  selectSupplierDomainProposers,
  type SupplierDomainProposer,
} from "@/lib/supply-os/supplier-domain-discovery";
import {
  classifySupplierSourcingCategory,
  qualifySupplierSite,
  supplierSourcingQueries,
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
const CRAWL_CONCURRENCY = 4;

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
};

export class SupplierSourcingError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "unsupported_category" | "discovery_unavailable",
  ) {
    super(message);
    this.name = "SupplierSourcingError";
  }
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
  proposers?: readonly SupplierDomainProposer[];
  fetchPage?: PageFetcher;
  verify?: typeof verifyEmail;
  loadOrder?: typeof loadBulkRfqOrder;
  loadExistingKeys?: typeof existingVendorKeys;
  insertVendor?: typeof insertSourcedVendor;
}): Promise<SourcingWaveResult> {
  const order = await (input.loadOrder ?? loadBulkRfqOrder)(input.orderId);
  if (!order) throw new SupplierSourcingError("The sourcing request was not found.", "not_found");
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
  };

  for (let round = 0; round < MAX_PROPOSAL_ROUNDS && result.added < target; round += 1) {
    const queries = supplierSourcingQueries(category, round, 2);
    const proposals: Array<{ domain: string; url: string; via: string }> = [];
    for (const query of queries) {
      for (const proposer of proposers) {
        const found = await proposer.propose({
          query,
          limit: Math.min(25, Math.max(8, (target - result.added) * 2)),
          excludeDomains: [...seenDomains].slice(-400),
        });
        if (!found.length) continue;
        result.queriesUsed.push(`${proposer.name}: ${query}`);
        for (const proposal of found) {
          if (seenDomains.has(proposal.domain)) continue;
          seenDomains.add(proposal.domain);
          proposals.push(proposal);
        }
        break;
      }
    }
    if (!proposals.length) {
      result.discoveryExhausted = true;
      break;
    }

    const queue = [...proposals];
    const crawled: Array<{ site: CrawledSupplierSite; via: string }> = [];
    const failures: SourcingWaveRejection[] = [];
    await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          const site = await crawlSupplierSite(next.url, fetchPage);
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
      const qualification = qualifySupplierSite(category, site);
      if (qualification.state === "REJECTED") {
        result.rejected.push({ domain: site.domain, reason: qualification.reason });
        continue;
      }
      let accepted: { email: string; verification: EmailVerification } | null = null;
      for (const email of site.emails.slice(0, 4)) {
        if (usedEmails.has(email)) continue;
        const verification = await verify(email, { companyDomain: site.domain });
        if (verification.verdict === "deliverable_likely") {
          accepted = { email, verification };
          break;
        }
      }
      if (!accepted) {
        result.rejected.push({ domain: site.domain, reason: "no published address passed deliverability screening" });
        continue;
      }
      const vendorId = await insertVendor({
        order,
        category,
        site,
        contactEmail: accepted.email,
        verification: accepted.verification,
        matched: qualification.matched,
        discoveredVia: via,
      });
      if (!vendorId) {
        result.rejected.push({ domain: site.domain, reason: "the supplier is already on this request" });
        continue;
      }
      usedEmails.add(accepted.email);
      result.added += 1;
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
