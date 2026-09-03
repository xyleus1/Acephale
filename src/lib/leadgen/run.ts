import {
  createCascadingSearchProvider,
  dedupeByDomain,
  parseSearchResults,
  searchUrl,
  type SearchEngine,
  type SearchHit,
} from "./search";
import { buildQueryPlan, type LeadGenQuery } from "./query-plan";
import { defaultFetcher, harvestSite, type LeadCandidate, type PageFetcher } from "./harvest";
import type { DirectoryRow } from "./directory";
import { scoreLead } from "./score";
import { verifyEmails, type EmailVerification, type VerifyOptions } from "./verify";
import {
  signalsFromProductFocus,
  type LeadGenProfile,
} from "./profile";

const DEFAULT_MAX_QUERIES = 60;
const DEFAULT_MAX_PAGES = 300;
const DEFAULT_BUDGET_MS = 240_000;

export type ProspectingDraft = {
  objective: string;
  segments: string[];
  regions: string[];
  productFocus: string;
  projectName: string;
  listSlug: string;
  notes: string;
  rowTarget: number;
};

export type ProspectingSearchResult = {
  hits: readonly SearchHit[];
  pagesFetched: number;
  providersUsed?: readonly string[];
};

export type ProspectingSearch = (
  query: LeadGenQuery,
  options?: { maxPagesRemaining?: number },
) => Promise<readonly SearchHit[] | ProspectingSearchResult>;

export type ProspectingBatchCandidate = {
  candidate: LeadCandidate;
  verifications: EmailVerification[];
  region: string | null;
  directoryRow?: DirectoryRow;
};

export type ProspectingBatchStats = {
  queriesUsed: number;
  pagesFetched: number;
  candidatesFound: number;
  providerStats?: Record<string, {
    queries: number;
    hits: number;
    candidates: number;
    withContact: number;
    deliverableLikely: number;
  }>;
};

export type ProspectingBatchResult = {
  candidates: ProspectingBatchCandidate[];
  stats: ProspectingBatchStats;
  nextQueryOffset: number;
  exhausted: boolean;
};

export function profileFromProspectingDraft(draft: ProspectingDraft): LeadGenProfile {
  const signals = signalsFromProductFocus({
    productFocus: draft.productFocus,
    segments: draft.segments,
  });
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
    positiveSignals: signals.positive,
    negativeSignals: signals.negative,
    globalQueries: false,
  };
}

const SEARCH_ENGINES: readonly Extract<SearchEngine, "duckduckgo" | "brave">[] = ["duckduckgo", "brave"];
const DOCUMENT_SHAPES = new Set<LeadGenQuery["shape"]>([
  "doc_pdf_directory",
  "doc_spreadsheet_directory",
  "doc_office_directory",
  "exhibitor_list",
  "association_members",
]);

function isDocumentHit(hit: SearchHit, query: LeadGenQuery) {
  let pathname = "";
  try {
    pathname = new URL(hit.url).pathname.toLowerCase();
  } catch {
    return DOCUMENT_SHAPES.has(query.shape);
  }
  return DOCUMENT_SHAPES.has(query.shape)
    || /\.(pdf|xls|xlsx|doc|docx|csv|tsv)$/.test(pathname);
}

function selectSearchHits(searchHits: readonly SearchHit[], query: LeadGenQuery) {
  const documentUrls = new Set<string>();
  const documentHits: SearchHit[] = [];
  for (const hit of searchHits) {
    if (!isDocumentHit(hit, query) || documentUrls.has(hit.url)) continue;
    documentUrls.add(hit.url);
    documentHits.push(hit);
  }
  const nonDocumentHits = dedupeByDomain(searchHits.filter((hit) => !isDocumentHit(hit, query)));
  return [...documentHits, ...nonDocumentHits].sort((a, b) => a.rank - b.rank);
}

function candidateFromDirectoryRow(
  profile: LeadGenProfile,
  row: DirectoryRow,
  query: LeadGenQuery,
  hit: SearchHit,
): ProspectingBatchCandidate {
  const domain = row.domain ?? "";
  const fit = scoreLead(profile, {
    companyName: row.companyName,
    domain,
    pageText: row.rawLine,
    segmentKey: query.segmentKey,
    emailCount: row.emails.length,
    hasPhone: row.phones.length > 0,
  });
  const candidate: LeadCandidate = {
    domain,
    website: row.domain ? `https://${row.domain}` : row.sourceUrl,
    companyName: row.companyName,
    city: row.city,
    emails: row.emails,
    phones: row.phones,
    segmentKey: query.segmentKey,
    fit,
    evidence: [{
      url: row.sourceUrl,
      kind: "directory",
      emails: row.emails,
      phones: row.phones,
    }],
    discoveredVia: query.query,
    discoveryProvider: hit.provider ?? providerNameForHit(hit),
    discoveryEngine: hit.engine,
    discoveryRank: hit.rank,
    discoverySourceUrl: row.sourceUrl || hit.url,
    harvestedAt: new Date().toISOString(),
  };
  return { candidate, directoryRow: row, verifications: [], region: query.region };
}

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
  {
    const maxPagesRemaining = options?.maxPagesRemaining;
    if (maxPagesRemaining === 0) return { hits: [], pagesFetched: 0 };
    const provider = createCascadingSearchProvider({ serperApiKey: process.env.SERPER_API_KEY });
    const result = provider.searchWithStats
      ? await provider.searchWithStats(query.query, { maxPagesRemaining })
      : { hits: await provider.search(query.query, { maxPagesRemaining }), pagesFetched: 0, providersUsed: [] };
    return {
      hits: result.hits,
      pagesFetched: result.pagesFetched,
      providersUsed: result.providersUsed,
    };
  };

function providerNameForHit(hit: SearchHit) {
  if (hit.engine === "serper" || hit.provider === "serper") return "serper";
  if (hit.engine === "jsonl" || hit.provider === "jsonl") return "jsonl";
  if (hit.engine === "duckduckgo" || hit.engine === "brave" || hit.engine === "bing") {
    return `html:${hit.engine}`;
  }
  return hit.provider ?? "unknown";
}

function providersForSearchResult(
  searchResult: readonly SearchHit[] | ProspectingSearchResult,
  hits: readonly SearchHit[],
) {
  if ("providersUsed" in searchResult && searchResult.providersUsed?.length) {
    return searchResult.providersUsed;
  }
  return [...new Set(hits.map(providerNameForHit))];
}

export async function runProspectingBatch(args: {
  profile: LeadGenProfile;
  queryOffset?: number;
  maxQueries?: number;
  maxPages?: number;
  maxDirectoryRowsPerDocument?: number;
  budgetMs?: number;
  search: ProspectingSearch;
  fetchPage: PageFetcher;
  resolveMx?: VerifyOptions["resolveMx"];
}): Promise<ProspectingBatchResult> {
  const maxQueries = Math.min(DEFAULT_MAX_QUERIES, Math.max(1, Math.floor(args.maxQueries ?? DEFAULT_MAX_QUERIES)));
  const maxPages = Math.min(DEFAULT_MAX_PAGES, Math.max(1, Math.floor(args.maxPages ?? DEFAULT_MAX_PAGES)));
  const maxDirectoryRowsPerDocument = Math.max(0, Math.floor(args.maxDirectoryRowsPerDocument ?? 500));
  const budgetMs = Math.max(1_000, Math.min(DEFAULT_BUDGET_MS, Math.floor(args.budgetMs ?? DEFAULT_BUDGET_MS)));
  const plan = buildQueryPlan(args.profile);
  const start = Math.max(0, Math.min(plan.length, Math.floor(args.queryOffset ?? 0)));
  const deadline = Date.now() + budgetMs;
  const candidates: ProspectingBatchCandidate[] = [];
  const seenDomains = new Set<string>();
  const seenDocumentUrls = new Set<string>();
  const stats: ProspectingBatchStats = {
    queriesUsed: 0,
    pagesFetched: 0,
    candidatesFound: 0,
    providerStats: {},
  };

  const providerStatsFor = (provider: string) => {
    const providerStats = stats.providerStats ?? (stats.providerStats = {});
    providerStats[provider] ??= {
      queries: 0,
      hits: 0,
      candidates: 0,
      withContact: 0,
      deliverableLikely: 0,
    };
    return providerStats[provider]!;
  };

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
    for (const provider of providersForSearchResult(searchResult, searchHits)) providerStatsFor(provider).queries += 1;
    for (const hit of searchHits) providerStatsFor(providerNameForHit(hit)).hits += 1;
    const hits = selectSearchHits(searchHits, query);
    stats.queriesUsed += 1;
    for (const hit of hits) {
      if (Date.now() >= deadline || stats.pagesFetched >= maxPages) break;
      const documentHit = isDocumentHit(hit, query);
      if (documentHit) {
        if (seenDocumentUrls.has(hit.url)) continue;
        seenDocumentUrls.add(hit.url);
      } else {
        if (seenDomains.has(hit.domain)) continue;
        seenDomains.add(hit.domain);
      }
      const harvested = await harvestSite(args.profile, documentHit ? hit.url : `https://${hit.domain}`, {
        fetcher: async (url) => {
          if (Date.now() >= deadline || stats.pagesFetched >= maxPages) return null;
          stats.pagesFetched += 1;
          return args.fetchPage(url);
        },
        segmentKey: query.segmentKey,
        discoveredVia: query.query,
        discoveryProvider: hit.provider ?? providerNameForHit(hit),
        discoveryEngine: hit.engine,
        discoveryRank: hit.rank,
        discoverySourceUrl: hit.url,
        directoryMode: documentHit,
        directoryRegions: args.profile.regions,
      });
      if (!harvested) continue;
      if (Array.isArray(harvested)) {
        for (const row of harvested.slice(0, maxDirectoryRowsPerDocument)) {
          if (Date.now() >= deadline) break;
          const directoryCandidate = candidateFromDirectoryRow(args.profile, row, query, hit);
          if (directoryCandidate.candidate.fit.tier === "reject") continue;
          directoryCandidate.verifications = await verifyEmails(row.emails, {
            companyDomain: row.domain ?? undefined,
            resolveMx: args.resolveMx,
          });
          candidates.push(directoryCandidate);
          stats.candidatesFound += 1;
          const providerStats = providerStatsFor(providerNameForHit(hit));
          providerStats.candidates += 1;
          if (directoryCandidate.candidate.emails.length > 0) providerStats.withContact += 1;
          if (directoryCandidate.verifications.some((item) => item.verdict === "deliverable_likely")) providerStats.deliverableLikely += 1;
        }
        continue;
      }
      if (harvested.fit.tier === "reject") continue;
      const verifications = await verifyEmails(harvested.emails, {
        companyDomain: harvested.domain,
        resolveMx: args.resolveMx,
      });
      candidates.push({ candidate: harvested, verifications, region: query.region });
      stats.candidatesFound += 1;
      const providerStats = providerStatsFor(providerNameForHit(hit));
      providerStats.candidates += 1;
      if (harvested.emails.length > 0) providerStats.withContact += 1;
      if (verifications.some((item) => item.verdict === "deliverable_likely")) providerStats.deliverableLikely += 1;
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
