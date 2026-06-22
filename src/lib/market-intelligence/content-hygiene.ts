import type { MarketIntelligenceSourceDefinition } from "./source-registry";

export const MARKET_CONTENT_PAGE_TYPES = [
  "article",
  "advisory",
  "press_release",
  "rate_update",
  "regulatory_update",
  "index_page",
  "navigation_page",
  "unknown",
] as const;

export type MarketContentPageType = typeof MARKET_CONTENT_PAGE_TYPES[number];

export const SIGNAL_ELIGIBLE_PAGE_TYPES: MarketContentPageType[] = [
  "article",
  "advisory",
  "press_release",
  "rate_update",
  "regulatory_update",
];

export const MIN_SIGNAL_CONTENT_QUALITY_SCORE = 60;

const SOCIAL_OR_UTILITY_DOMAINS = [
  "facebook.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "threads.net",
  "flickr.com",
  "mailto:",
  "tel:",
];

const BOILERPLATE_MARKERS = [
  "open navigation",
  "toggles navigation",
  "closecloses current item",
  "links to documents section",
  "links to interactive map",
  "share to various sites",
  "copies url link",
  "newsletter",
  "subscribe",
  "cookie",
  "breadcrumb",
  "skip to content",
  "accessibility",
  "search box",
  "privacy policy",
  "copyright",
  "all rights reserved",
  "related posts",
  "read more",
  "view more",
];

const FREIGHT_TERMS = [
  "freight",
  "cargo",
  "container",
  "port",
  "terminal",
  "carrier",
  "vessel",
  "berth",
  "customs",
  "rates",
  "surcharge",
  "capacity",
  "blank sailing",
  "congestion",
  "truck",
  "rail",
  "ocean",
  "air cargo",
  "shipment",
  "logistics",
];

const RATE_TERMS = ["rate", "rates", "spot rates", "freight rates", "index", "surcharge", "gri", "capacity", "blank sailings"];
const PORT_DISRUPTION_TERMS = ["delay", "delays", "congestion", "closure", "terminal", "labor", "berth", "vessel queue", "truck gate", "disruption"];
const REGULATORY_TERMS = ["customs", "tariff", "duty", "regulation", "compliance", "inspection", "clearance", "csms", "fmc", "cbp"];
const ADVISORY_TERMS = ["advisory", "service update", "service change", "customer advisory", "alert", "notice"];

export type MarketContentHygieneInput = {
  title?: string | null;
  content: string;
  url?: string | null;
  source?: Pick<MarketIntelligenceSourceDefinition,
    "id" | "sourceCategory" | "requirePublishedDate" | "articleUrlPatterns" | "indexUrlPatterns"
  > | null;
  publishedAt?: Date | string | null;
};

export type MarketContentQualityResult = {
  pageType: MarketContentPageType;
  contentQualityScore: number;
  eligibleForSignals: boolean;
  extractionStatus: "signal_eligible" | "rejected_low_quality";
  rejectionReason: string | null;
  reasons: string[];
  metrics: {
    bodyLength: number;
    paragraphCount: number;
    uniqueSentenceCount: number;
    freightKeywordCount: number;
    linkCount: number;
    socialOrUtilityLinkCount: number;
    boilerplateLineCount: number;
    lineCount: number;
    linkToTextRatio: number;
    socialOrFooterRatio: number;
    hasPublishedDate: boolean;
    hasArticleUrlPattern: boolean;
    hasIndexUrlPattern: boolean;
  };
  sanitizedText: string;
  evidenceText: string;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lower(value: string | null | undefined) {
  return normalize(value).toLowerCase();
}

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

function countIncludes(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term)).length;
}

function domainOrScheme(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) return trimmed.split(":")[0] + ":";
  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function isSocialOrUtilityUrl(value: string | null | undefined) {
  const target = domainOrScheme(value ?? "");
  if (!target) return false;
  return SOCIAL_OR_UTILITY_DOMAINS.some((domain) => target === domain || target.endsWith(`.${domain}`) || target.startsWith(domain));
}

function markdownLinks(markdown: string) {
  return [...markdown.matchAll(/\[[^\]]{0,180}\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
}

function patternMatches(value: string | null | undefined, patterns: string[] | undefined) {
  const target = value ?? "";
  return (patterns ?? []).some((pattern) => {
    if (!pattern.trim()) return false;
    try {
      return new RegExp(pattern, "i").test(target);
    } catch {
      return target.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

function hasDateLikeUrl(url: string | null | undefined) {
  return /(?:20\d{2}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]20\d{2})/.test(url ?? "");
}

function genericIndexPath(url: string | null | undefined) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
    return /\/(news|latest-news|news-and-press|press|press-releases|advisories|updates|blog|articles)$/.test(path);
  } catch {
    return false;
  }
}

function lineIsBoilerplate(line: string) {
  const text = lower(line);
  if (!text) return true;
  if (BOILERPLATE_MARKERS.some((marker) => text.includes(marker))) return true;
  if (
    ["facebook", "flickr", "instagram", "twitter", "linkedin", "youtube", "tiktok", "threads"].some((marker) => text.includes(marker)) &&
    ["link", "share", "follow", "page", "account"].some((marker) => text.includes(marker))
  ) return true;
  if (/^(facebook|flickr|instagram|twitter|x|linkedin|youtube|tiktok|share|search|menu|close|open navigation)\b/i.test(line.trim())) return true;
  const links = markdownLinks(line);
  if (links.some(isSocialOrUtilityUrl)) return true;
  const lineWords = words(line).length;
  if (links.length >= 2 && lineWords < links.length * 8) return true;
  return false;
}

export function detectBoilerplateOrChrome(markdown: string) {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const boilerplateLines = lines.filter(lineIsBoilerplate);
  const text = lower(markdown);
  return {
    lineCount: lines.length,
    boilerplateLineCount: boilerplateLines.length,
    boilerplateRatio: lines.length ? boilerplateLines.length / lines.length : 0,
    markerCount: countIncludes(text, BOILERPLATE_MARKERS),
    markers: BOILERPLATE_MARKERS.filter((marker) => text.includes(marker)),
  };
}

export function detectSocialOrFooterDominatedContent(markdown: string) {
  const links = markdownLinks(markdown);
  const socialOrUtilityLinkCount = links.filter(isSocialOrUtilityUrl).length;
  const textLength = normalize(markdown).length;
  const linkToTextRatio = textLength ? links.join(" ").length / textLength : 0;
  const socialOrFooterRatio = links.length ? socialOrUtilityLinkCount / links.length : 0;
  return {
    linkCount: links.length,
    socialOrUtilityLinkCount,
    linkToTextRatio,
    socialOrFooterRatio,
    dominated: socialOrUtilityLinkCount >= 3 || socialOrFooterRatio >= 0.35 || linkToTextRatio >= 0.35,
  };
}

export function sanitizeMarketMarkdown(markdown: string) {
  const withoutImages = markdown.replace(/!\[[^\]]*]\([^)]+\)/g, " ");
  const withoutSocialLinks = withoutImages.replace(/\[([^\]]{0,180})\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    if (isSocialOrUtilityUrl(url)) return " ";
    const cleanLabel = normalize(label);
    return cleanLabel || " ";
  });
  const withoutBareSocialUrls = withoutSocialLinks.replace(/(?:https?:\/\/|mailto:|tel:)[^\s)]+/gi, (url) => isSocialOrUtilityUrl(url) ? " " : url);
  const lines = withoutBareSocialUrls
    .split(/\r?\n/)
    .map((line) => line.replace(/[#>*_`~]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !lineIsBoilerplate(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractCleanEvidenceText(input: MarketContentHygieneInput | string) {
  const content = typeof input === "string" ? input : input.content;
  const title = typeof input === "string" ? "" : normalize(input.title);
  const sanitized = sanitizeMarketMarkdown(content);
  return [title, sanitized].filter(Boolean).join("\n\n").replace(/\s+\n/g, "\n").trim();
}

export function isCleanLaneCandidate(value: string | null | undefined) {
  const text = normalize(value);
  const textLower = text.toLowerCase();
  if (!text || text.length > 120) return false;
  if (SOCIAL_OR_UTILITY_DOMAINS.some((domain) => textLower.includes(domain.replace(":", "")))) return false;
  if (["facebook", "flickr", "instagram", "twitter", "linkedin", "youtube", "tiktok", "threads"].some((marker) => textLower.includes(marker))) return false;
  if (/\b(facebook|flickr|instagram|twitter|linkedin|youtube|tiktok|threads|share|links?)\b/i.test(text)) return false;
  if (/\b(cargo|affected|especially|reports?|operators?|customers?|rates?|surcharges?|pricing|published|advisory)\b/i.test(text)) return false;
  if (/https?:\/\//i.test(text) || /\b(mailto|tel):/i.test(text)) return false;
  if (!/(?:->|→|\bto\b)/i.test(text)) return false;
  const [left = "", right = ""] = text.split(/\s*(?:->|→|\bto\b)\s*/i);
  if (words(left).length === 0 || words(right).length === 0) return false;
  if (words(left).length > 3 || words(right).length > 3) return false;
  return true;
}

export function classifyMarketContentPageType(input: MarketContentHygieneInput): MarketContentPageType {
  const title = lower(input.title);
  const content = input.content ?? "";
  const text = lower(content);
  const url = input.url ?? "";
  const clean = lower(sanitizeMarketMarkdown(content));
  const chrome = detectBoilerplateOrChrome(content);
  const social = detectSocialOrFooterDominatedContent(content);
  const hasArticlePattern = patternMatches(url, input.source?.articleUrlPatterns) || hasDateLikeUrl(url);
  const hasIndexPattern = patternMatches(url, input.source?.indexUrlPatterns) || genericIndexPath(url);

  if (hasIndexPattern && !hasArticlePattern) return "index_page";
  if (social.dominated || chrome.boilerplateRatio >= 0.45 || chrome.markerCount >= 4) return "navigation_page";
  if (/(press release|news release|announces|announcement)/i.test(`${title} ${clean}`)) return "press_release";
  if (countIncludes(clean, ADVISORY_TERMS) >= 1) return "advisory";
  if (countIncludes(clean, RATE_TERMS) >= 2) return "rate_update";
  if (input.source?.sourceCategory === "regulatory" || countIncludes(clean, REGULATORY_TERMS) >= 2) return "regulatory_update";
  if (hasArticlePattern || input.publishedAt) return "article";
  if (/^(news|news & press|latest news|press|updates)$/i.test(title)) return "index_page";
  if (text.length < 500) return "unknown";
  return "article";
}

export function scoreMarketContentQuality(input: MarketContentHygieneInput): MarketContentQualityResult {
  const sanitizedText = sanitizeMarketMarkdown(input.content);
  const evidenceText = extractCleanEvidenceText(input);
  const cleanLower = lower(evidenceText);
  const pageType = classifyMarketContentPageType(input);
  const paragraphs = sanitizedText.split(/\n{1,}/).map((part) => part.trim()).filter((part) => words(part).length >= 6);
  const sentenceCandidates = evidenceText.split(/[.!?]\s+/).map((part) => normalize(part)).filter((part) => words(part).length >= 6);
  const uniqueSentences = new Set(sentenceCandidates.map((part) => part.toLowerCase()));
  const chrome = detectBoilerplateOrChrome(input.content);
  const social = detectSocialOrFooterDominatedContent(input.content);
  const freightKeywordCount = countIncludes(cleanLower, FREIGHT_TERMS);
  const titleWords = words(input.title ?? "");
  const hasPublishedDate = Boolean(input.publishedAt && !Number.isNaN(new Date(input.publishedAt).getTime()));
  const hasArticleUrlPattern = patternMatches(input.url, input.source?.articleUrlPatterns) || hasDateLikeUrl(input.url);
  const hasIndexUrlPattern = patternMatches(input.url, input.source?.indexUrlPatterns) || genericIndexPath(input.url);

  const reasons: string[] = [];
  let score = 0;
  score += titleWords.length >= 5 && !/^(news|news & press|latest news|press|updates)$/i.test(normalize(input.title)) ? 12 : 3;
  score += hasPublishedDate ? 10 : 0;
  score += Math.min(18, Math.floor(sanitizedText.length / 120));
  score += Math.min(12, paragraphs.length * 3);
  score += Math.min(14, freightKeywordCount * 2);
  score += Math.min(12, uniqueSentences.size * 2);
  score += hasArticleUrlPattern ? 10 : 0;
  if (SIGNAL_ELIGIBLE_PAGE_TYPES.includes(pageType)) score += 8;
  if (hasIndexUrlPattern || pageType === "index_page") score -= 25;
  if (pageType === "navigation_page") score -= 30;
  if (social.dominated) score -= 25;
  if (chrome.boilerplateRatio >= 0.35) score -= 15;
  if (social.linkToTextRatio >= 0.25) score -= 10;
  if (input.source?.requirePublishedDate && !hasPublishedDate) score -= 15;

  if (!SIGNAL_ELIGIBLE_PAGE_TYPES.includes(pageType)) reasons.push(`page_type_${pageType}`);
  if (score < MIN_SIGNAL_CONTENT_QUALITY_SCORE) reasons.push(`content_quality_below_${MIN_SIGNAL_CONTENT_QUALITY_SCORE}`);
  if (social.dominated) reasons.push("social_or_link_dominated");
  if (chrome.boilerplateRatio >= 0.35) reasons.push("boilerplate_or_chrome_heavy");
  if (input.source?.requirePublishedDate && !hasPublishedDate) reasons.push("missing_published_date");
  if (evidenceText.length < 280) reasons.push("insufficient_clean_body_text");

  const contentQualityScore = Math.max(0, Math.min(100, Math.round(score)));
  const eligibleForSignals = reasons.length === 0;
  return {
    pageType,
    contentQualityScore,
    eligibleForSignals,
    extractionStatus: eligibleForSignals ? "signal_eligible" : "rejected_low_quality",
    rejectionReason: eligibleForSignals ? null : reasons[0] ?? "rejected_low_quality",
    reasons,
    metrics: {
      bodyLength: sanitizedText.length,
      paragraphCount: paragraphs.length,
      uniqueSentenceCount: uniqueSentences.size,
      freightKeywordCount,
      linkCount: social.linkCount,
      socialOrUtilityLinkCount: social.socialOrUtilityLinkCount,
      boilerplateLineCount: chrome.boilerplateLineCount,
      lineCount: chrome.lineCount,
      linkToTextRatio: Number(social.linkToTextRatio.toFixed(3)),
      socialOrFooterRatio: Number(social.socialOrFooterRatio.toFixed(3)),
      hasPublishedDate,
      hasArticleUrlPattern,
      hasIndexUrlPattern,
    },
    sanitizedText,
    evidenceText,
  };
}

export function isSignalEligibleContent(input: MarketContentHygieneInput) {
  const quality = scoreMarketContentQuality(input);
  return {
    eligible: quality.eligibleForSignals,
    reason: quality.rejectionReason,
    quality,
  };
}

export function hasCategorySpecificEvidence(category: string, evidenceText: string) {
  const text = lower(evidenceText);
  if (category === "rate") return countIncludes(text, RATE_TERMS) >= 1;
  if (category === "port_disruption") return countIncludes(text, PORT_DISRUPTION_TERMS) >= 1;
  if (category === "customs" || category === "compliance") return countIncludes(text, REGULATORY_TERMS) >= 1;
  if (category === "carrier_advisory") return countIncludes(text, ADVISORY_TERMS) >= 1 || /\b(carrier|service|schedule)\b/i.test(text);
  if (category === "weather") return /\b(storm|weather|hurricane|typhoon|flood|wind)\b/i.test(text);
  if (category === "labor") return /\b(strike|labor|union|walkout|industrial action)\b/i.test(text);
  if (category === "geopolitical") return /\b(sanction|war|security|suez|red sea|panama|hormuz)\b/i.test(text);
  if (category === "capacity") return /\b(capacity|space|equipment|container shortage|vessel|blank sailing|rollover)\b/i.test(text);
  return false;
}
