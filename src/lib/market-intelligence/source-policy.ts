import { prisma } from "@/lib/prisma";
import type { MarketIntelligenceSourceDefinition } from "./source-registry";

const BLOCKED_URL_PATTERNS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/subscribe\b/i,
  /\/account\b/i,
  /\/checkout\b/i,
  /paywall/i,
];

const BLOCKED_TEXT_PATTERNS = [
  /sign in to continue/i,
  /subscribe to continue/i,
  /login required/i,
  /paywall/i,
  /enable javascript/i,
];

export function domainFromUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeDomain(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
}

export function sourceAllowedDomains(source: MarketIntelligenceSourceDefinition) {
  const domains = new Set(source.allowedDomains.map(normalizeDomain).filter(Boolean));
  const sourceUrlDomain = domainFromUrl(source.url);
  const homepageDomain = domainFromUrl(source.homepage ?? null);
  if (sourceUrlDomain) domains.add(sourceUrlDomain);
  if (homepageDomain) domains.add(homepageDomain);
  return [...domains];
}

export function isUrlAllowedBySource(url: string, source: MarketIntelligenceSourceDefinition) {
  const domain = domainFromUrl(url);
  if (!domain) return false;
  const allowed = sourceAllowedDomains(source);
  if (allowed.length === 0) return source.fetchType === "manual";
  if (!allowed.some((allowedDomain) => domain === allowedDomain || domain.endsWith(`.${allowedDomain}`))) return false;
  const path = (() => {
    try { return new URL(url).pathname; } catch { return ""; }
  })();
  const matches = (patterns: string[] | undefined) => (patterns ?? []).some((pattern) => {
    try { return new RegExp(pattern, "i").test(path); } catch { return path.toLowerCase().includes(pattern.toLowerCase()); }
  });
  if (matches(source.blockedPathPatterns)) return false;
  if ((source.allowedPathPatterns ?? []).length > 0 && !matches(source.allowedPathPatterns)) return false;
  return true;
}

export function isBlockedMarketUrl(url: string | null | undefined) {
  return BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url ?? ""));
}

export function isBlockedMarketContent(text: string | null | undefined) {
  const sample = (text ?? "").slice(0, 5000);
  return BLOCKED_TEXT_PATTERNS.some((pattern) => pattern.test(sample));
}

export function sourceRunLimits(source: MarketIntelligenceSourceDefinition) {
  const envResults = Number(process.env.MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN);
  const envPages = Number(process.env.MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN);
  return {
    maxResults: Math.max(1, Math.min(100, Math.floor(Number.isFinite(envResults) ? envResults : source.maxResultsPerRun))),
    maxPages: Math.max(1, Math.min(100, Math.floor(Number.isFinite(envPages) ? envPages : source.maxPagesPerRun))),
  };
}

export function assertCanUseFirecrawlSource(source: MarketIntelligenceSourceDefinition) {
  if (source.fetchType !== "firecrawl_search" && source.fetchType !== "firecrawl_scrape") return;
  const domains = sourceAllowedDomains(source);
  if (domains.length === 0) {
    throw new Error(`Firecrawl source ${source.id} has no allowedDomains/homepage/url. Broad web ingestion is blocked.`);
  }
}

export function validateMarketSourceDefinition(source: MarketIntelligenceSourceDefinition) {
  const issues: string[] = [];
  const allowed = sourceAllowedDomains(source);
  if (!source.id.trim()) issues.push("missing id");
  if (!source.name.trim()) issues.push("missing name");
  if (source.fetchType !== "manual" && !source.url) issues.push("non-manual source missing url");
  if ((source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape") && allowed.length === 0) {
    issues.push("firecrawl source has no allowed domains");
  }
  if (source.url && isBlockedMarketUrl(source.url)) issues.push("source url matches blocked URL pattern");
  if (source.allowedDomains.some((domain) => ["google.com", "bing.com", "duckduckgo.com", "yahoo.com"].includes(normalizeDomain(domain)))) {
    issues.push("search-engine domains are not acceptable source allow-lists");
  }
  if ((source.blockedPathPatterns ?? []).some((pattern) => !pattern.trim())) issues.push("empty blocked path pattern");
  if ((source.allowedPathPatterns ?? []).some((pattern) => !pattern.trim())) issues.push("empty allowed path pattern");
  if (source.maxPagesPerRun > 25) issues.push("maxPagesPerRun is too high for controlled market ingestion");
  if (source.maxResultsPerRun > 25) issues.push("maxResultsPerRun is too high for controlled market ingestion");
  return {
    sourceId: source.id,
    ok: issues.length === 0,
    allowedDomains: allowed,
    issues,
  };
}

export function listSourcePolicyIssues(sources: MarketIntelligenceSourceDefinition[]) {
  return sources.map(validateMarketSourceDefinition).filter((row) => !row.ok);
}

export function filterAllowedFirecrawlUrls(urls: string[], source: MarketIntelligenceSourceDefinition) {
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url) => !isBlockedMarketUrl(url))
    .filter((url) => isUrlAllowedBySource(url, source));
}

export async function getMarketSourceQualityStats(input: {
  officeId: string;
  sourceObjectIds?: string[];
}) {
  const sourceObjectIds = input.sourceObjectIds ?? [];
  const signals = await prisma.marketSignal.findMany({
    where: {
      officeId: input.officeId,
      ...(sourceObjectIds.length ? { sourceObjectId: { in: sourceObjectIds } } : {}),
    },
    select: {
      id: true,
      sourceObjectId: true,
      sourceObject: { select: { title: true, sourceExternalId: true } },
      feedback: { select: { feedbackKind: true } },
      impactReviews: { select: { status: true } },
    },
    take: 1000,
  }).catch(() => []);

  return signals.map((signal) => {
    const feedbackKinds = signal.feedback.map((feedback) => feedback.feedbackKind);
    const statuses = signal.impactReviews.map((review) => review.status);
    return {
      marketSignalId: signal.id,
      sourceObjectId: signal.sourceObjectId,
      sourceLabel: signal.sourceObject?.title ?? signal.sourceObject?.sourceExternalId ?? signal.id,
      usefulFeedbackCount: feedbackKinds.filter((kind) => kind === "useful").length,
      wrongLinkFeedbackCount: feedbackKinds.filter((kind) => kind === "wrong_link").length,
      irrelevantFeedbackCount: feedbackKinds.filter((kind) => kind === "irrelevant").length,
      dismissedCount: statuses.filter((status) => status === "dismissed").length,
      actionedCount: statuses.filter((status) => status === "actioned").length,
      duplicateFeedbackCount: feedbackKinds.filter((kind) => kind === "duplicate").length,
    };
  });
}
