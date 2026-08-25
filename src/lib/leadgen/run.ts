import { dedupeByDomain, parseSearchResults, searchUrl, type SearchEngine, type SearchHit } from "./search";
import { buildQueryPlan, type LeadGenQuery } from "./query-plan";
import { defaultFetcher, harvestSite, type LeadCandidate, type PageFetcher } from "./harvest";
import { verifyEmails, type EmailVerification, type VerifyOptions } from "./verify";
import {
  GENERIC_STEEL_ORE_NEGATIVE_SIGNALS,
  GENERIC_STEEL_ORE_POSITIVE_SIGNALS,
  type LeadGenProfile,
} from "./profile";

const DEFAULT_MAX_QUERIES = 24;
const DEFAULT_MAX_PAGES = 60;
const DEFAULT_BUDGET_MS = 240_000;

export type ProspectingDraft = {
  objective: string;
  segments: string[];
  regions: string[];
  productFocus: string;
  listSlug: string;
  notes: string;
};

export type ProspectingSearchResult = {
  hits: readonly SearchHit[];
  pagesFetched: number;
};

export type ProspectingSearch = (
  query: LeadGenQuery,
  options?: { maxPagesRemaining?: number },
) => Promise<readonly SearchHit[] | ProspectingSearchResult>;

export type ProspectingBatchCandidate = {
  candidate: LeadCandidate;
  verifications: EmailVerification[];
  region: string | null;
};

export type ProspectingBatchStats = {
  queriesUsed: number;
  pagesFetched: number;
  candidatesFound: number;
};

export type ProspectingBatchResult = {
  candidates: ProspectingBatchCandidate[];
  stats: ProspectingBatchStats;
  nextQueryOffset: number;
  exhausted: boolean;
};

export function profileFromProspectingDraft(draft: ProspectingDraft): LeadGenProfile {
  const segments = draft.segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => ({
      key: `prospect_segment_${index + 1}`,
      label: segment,
      keywords: [segment],
      weight: Math.max(0.55, 1 - index * 0.05),
    }));
  return {
    slug: "context-prospecting",
    customerName: "Prospecting",
    offering: draft.productFocus.trim(),
    segments,
    regions: draft.regions.map((region) => region.trim()).filter(Boolean),
    directorySeeds: [],
    positiveSignals: GENERIC_STEEL_ORE_POSITIVE_SIGNALS,
    negativeSignals: GENERIC_STEEL_ORE_NEGATIVE_SIGNALS,
  };
}

const SEARCH_ENGINES: readonly SearchEngine[] = ["duckduckgo", "brave"];

export async function searchProspectingQuery(
  query: LeadGenQuery,
  fetchPage: PageFetcher = defaultFetcher,
  maxPages = SEARCH_ENGINES.length,
): Promise<ProspectingSearchResult> {
  let pagesFetched = 0;
  for (const engine of SEARCH_ENGINES) {
    if (pagesFetched >= maxPages) break;
    const page = await fetchPage(searchUrl(engine, query.query));
    pagesFetched += 1;
    if (!page || page.status !== 200 || !page.body) continue;
    const hits = parseSearchResults(page.body, engine);
    if (hits.length) return { hits, pagesFetched };
  }
  return { hits: [], pagesFetched };
}

export const defaultProspectingSearch: ProspectingSearch = async (query, options) =>
  searchProspectingQuery(query, defaultFetcher, options?.maxPagesRemaining ?? SEARCH_ENGINES.length);

export async function runProspectingBatch(args: {
  profile: LeadGenProfile;
  queryOffset?: number;
  maxQueries?: number;
  maxPages?: number;
  budgetMs?: number;
  search: ProspectingSearch;
  fetchPage: PageFetcher;
  resolveMx?: VerifyOptions["resolveMx"];
}): Promise<ProspectingBatchResult> {
  const maxQueries = Math.min(DEFAULT_MAX_QUERIES, Math.max(1, Math.floor(args.maxQueries ?? DEFAULT_MAX_QUERIES)));
  const maxPages = Math.min(DEFAULT_MAX_PAGES, Math.max(1, Math.floor(args.maxPages ?? DEFAULT_MAX_PAGES)));
  const budgetMs = Math.max(1_000, Math.min(DEFAULT_BUDGET_MS, Math.floor(args.budgetMs ?? DEFAULT_BUDGET_MS)));
  const plan = buildQueryPlan(args.profile);
  const start = Math.max(0, Math.min(plan.length, Math.floor(args.queryOffset ?? 0)));
  const deadline = Date.now() + budgetMs;
  const candidates: ProspectingBatchCandidate[] = [];
  const seenDomains = new Set<string>();
  const stats = { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 };

  for (let queryIndex = start; queryIndex < plan.length && stats.queriesUsed < maxQueries; queryIndex += 1) {
    if (Date.now() >= deadline) break;
    const query = plan[queryIndex]!;
    const searchResult = await args.search(query, { maxPagesRemaining: maxPages - stats.pagesFetched });
    let searchHits: readonly SearchHit[];
    if (Array.isArray(searchResult)) {
      searchHits = searchResult as readonly SearchHit[];
    } else {
      const structuredResult = searchResult as ProspectingSearchResult;
      searchHits = structuredResult.hits;
      stats.pagesFetched += structuredResult.pagesFetched;
    }
    const hits = dedupeByDomain(searchHits);
    stats.queriesUsed += 1;
    for (const hit of hits) {
      if (Date.now() >= deadline || stats.pagesFetched >= maxPages) break;
      if (seenDomains.has(hit.domain)) continue;
      seenDomains.add(hit.domain);
      const candidate = await harvestSite(args.profile, `https://${hit.domain}`, {
        fetcher: async (url) => {
          if (Date.now() >= deadline || stats.pagesFetched >= maxPages) return null;
          stats.pagesFetched += 1;
          return args.fetchPage(url);
        },
        segmentKey: query.segmentKey,
        discoveredVia: query.query,
      });
      if (!candidate || candidate.fit.tier === "reject") continue;
      const verifications = await verifyEmails(candidate.emails, {
        companyDomain: candidate.domain,
        resolveMx: args.resolveMx,
      });
      candidates.push({ candidate, verifications, region: query.region });
      stats.candidatesFound += 1;
    }
    if (Date.now() >= deadline || stats.pagesFetched >= maxPages) break;
  }

  const nextQueryOffset = Math.min(plan.length, start + stats.queriesUsed);
  return {
    candidates,
    stats,
    nextQueryOffset,
    exhausted: nextQueryOffset >= plan.length,
  };
}
