export type MarketSignalCategory =
  | "rate"
  | "port_disruption"
  | "customs"
  | "carrier_advisory"
  | "weather"
  | "labor"
  | "geopolitical"
  | "capacity"
  | "compliance";

export type MarketFetchType = "rss" | "html" | "manual" | "firecrawl_search" | "firecrawl_scrape";

export type MarketSourceCategory =
  | "official"
  | "carrier"
  | "port"
  | "regulatory"
  | "rate_index"
  | "media"
  | "research"
  | "competitor"
  | "misc";

export type MarketSourceTrustLevel =
  | "OFFICIAL"
  | "PARTNER"
  | "INDUSTRY"
  | "NEWS"
  | "MANUAL"
  | "INTERNAL"
  | "TRUSTED"
  | "EXTERNAL"
  | "LOW";

export type MarketIntelligenceSourceDefinition = {
  id: string;
  name: string;
  sourceType: "MARKET";
  trustLevel: MarketSourceTrustLevel;
  url: string | null;
  homepage?: string | null;
  sourceCategory: MarketSourceCategory;
  allowedDomains: string[];
  fetchType: MarketFetchType;
  defaultCategory: MarketSignalCategory;
  defaultCategories: MarketSignalCategory[];
  defaultAffectedModes: string[];
  maxResultsPerRun: number;
  maxPagesPerRun: number;
  enabled: boolean;
  allowedPathPatterns?: string[];
  blockedPathPatterns?: string[];
  requirePublishedDate?: boolean;
  articleUrlPatterns?: string[];
  indexUrlPatterns?: string[];
  notes?: string | null;
  termsPolicyNotes?: string | null;
};

export const MARKET_SIGNAL_CATEGORIES: MarketSignalCategory[] = [
  "rate",
  "port_disruption",
  "customs",
  "carrier_advisory",
  "weather",
  "labor",
  "geopolitical",
  "capacity",
  "compliance",
];

export const MARKET_SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;

const DEFAULT_SOURCES: MarketIntelligenceSourceDefinition[] = [
  {
    id: "manual-market-intel",
    name: "Manual Market Intelligence",
    sourceType: "MARKET",
    trustLevel: "MANUAL",
    url: null,
    homepage: null,
    sourceCategory: "misc",
    allowedDomains: [],
    fetchType: "manual",
    defaultCategory: "rate",
    defaultCategories: ["rate"],
    defaultAffectedModes: [],
    maxResultsPerRun: 10,
    maxPagesPerRun: 10,
    enabled: true,
    notes: "Manual operator-provided market intelligence.",
    termsPolicyNotes: "Operator-entered source. Confirm external rights before pasting restricted material.",
  },
  {
    id: "cbp-csms",
    name: "CBP Cargo Systems Messaging Service",
    sourceType: "MARKET",
    trustLevel: "OFFICIAL",
    url: "https://www.cbp.gov/trade/automated/cargo-systems-messaging-service",
    homepage: "https://www.cbp.gov/trade/automated/cargo-systems-messaging-service",
    sourceCategory: "regulatory",
    allowedDomains: ["cbp.gov", "content.govdelivery.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "customs",
    defaultCategories: ["customs", "compliance"],
    defaultAffectedModes: ["ocean", "air", "road", "rail"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled: false,
    articleUrlPatterns: ["/trade/automated/cargo-systems-messaging-service/.+", "content.govdelivery.com/.+"],
    indexUrlPatterns: ["/trade/automated/cargo-systems-messaging-service/?$"],
    notes: "Official CBP CSMS trade and ACE messaging. Use for customs/compliance advisories.",
    termsPolicyNotes: "Official public government source. Keep ingestion limited to CBP/govdelivery domains.",
  },
  {
    id: "fmc-news-advisories",
    name: "Federal Maritime Commission News and Advisories",
    sourceType: "MARKET",
    trustLevel: "OFFICIAL",
    url: "https://www.fmc.gov/news-and-advisories/",
    homepage: "https://www.fmc.gov/",
    sourceCategory: "regulatory",
    allowedDomains: ["fmc.gov"],
    fetchType: "firecrawl_scrape",
    defaultCategory: "compliance",
    defaultCategories: ["compliance", "carrier_advisory", "geopolitical"],
    defaultAffectedModes: ["ocean"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 3,
    enabled: false,
    notes: "Official US maritime regulator news and industry advisories.",
    termsPolicyNotes: "Official public government source. Do not infer customer-specific compliance advice without review.",
  },
  {
    id: "maersk-news-advisories",
    name: "Maersk News and Advisories",
    sourceType: "MARKET",
    trustLevel: "INDUSTRY",
    url: "https://www.maersk.com/news",
    homepage: "https://www.maersk.com/",
    sourceCategory: "carrier",
    allowedDomains: ["maersk.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "carrier_advisory",
    defaultCategories: ["carrier_advisory", "capacity", "rate", "geopolitical"],
    defaultAffectedModes: ["ocean"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled: false,
    notes: "Carrier-operated advisories, news, service changes, and rate announcements.",
    termsPolicyNotes: "Public carrier source. Treat as carrier perspective and verify against customer shipment context.",
  },
  {
    id: "port-of-los-angeles-latest-news",
    name: "Port of Los Angeles Latest News",
    sourceType: "MARKET",
    trustLevel: "OFFICIAL",
    url: "https://portoflosangeles.org/news/latest-news",
    homepage: "https://portoflosangeles.org/",
    sourceCategory: "port",
    allowedDomains: ["portoflosangeles.org"],
    fetchType: "firecrawl_scrape",
    defaultCategory: "port_disruption",
    defaultCategories: ["port_disruption", "capacity", "geopolitical"],
    defaultAffectedModes: ["ocean", "road", "rail"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 3,
    enabled: false,
    articleUrlPatterns: ["/news/latest-news/.+", "/news/.+20\\d{2}"],
    indexUrlPatterns: ["/news/latest-news/?$"],
    notes: "Official Port of Los Angeles news and cargo updates.",
    termsPolicyNotes: "Official public port source. Prefer direct source URL over media reposts.",
  },
  {
    id: "port-of-long-beach-news",
    name: "Port of Long Beach News and Press",
    sourceType: "MARKET",
    trustLevel: "OFFICIAL",
    url: "https://polb.com/port-info/news-and-press/",
    homepage: "https://polb.com/",
    sourceCategory: "port",
    allowedDomains: ["polb.com"],
    fetchType: "firecrawl_scrape",
    defaultCategory: "port_disruption",
    defaultCategories: ["port_disruption", "capacity", "geopolitical"],
    defaultAffectedModes: ["ocean", "road", "rail"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 3,
    enabled: false,
    allowedPathPatterns: ["/port-info/news-and-press"],
    articleUrlPatterns: ["/port-info/news-and-press/.+-\\d{2}-\\d{2}-20\\d{2}/?$"],
    indexUrlPatterns: ["/port-info/news-and-press/?$"],
    notes: "Official Port of Long Beach news articles and press releases.",
    termsPolicyNotes: "Official public port source. Keep claims tied to source date and affected terminals/lanes.",
  },
  {
    id: "drewry-world-container-index",
    name: "Drewry World Container Index",
    sourceType: "MARKET",
    trustLevel: "INDUSTRY",
    url: "https://www.drewry.co.uk/supply-chain-advisors/world-container-index-weekly-update/container-shipping1",
    homepage: "https://www.drewry.co.uk/",
    sourceCategory: "rate_index",
    allowedDomains: ["drewry.co.uk"],
    fetchType: "firecrawl_scrape",
    defaultCategory: "rate",
    defaultCategories: ["rate", "capacity"],
    defaultAffectedModes: ["ocean"],
    maxResultsPerRun: 3,
    maxPagesPerRun: 2,
    enabled: false,
    notes: "Industry rate-index source for container market direction.",
    termsPolicyNotes: "Public page only. Do not scrape subscriber-only Drewry content or reproduce paid methodology.",
  },
  {
    id: "xeneta-market-updates",
    name: "Xeneta XSI-C and Market Updates",
    sourceType: "MARKET",
    trustLevel: "INDUSTRY",
    url: "https://www.xeneta.com/news",
    homepage: "https://www.xeneta.com/",
    sourceCategory: "rate_index",
    allowedDomains: ["xeneta.com", "xsi.xeneta.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "rate",
    defaultCategories: ["rate", "capacity"],
    defaultAffectedModes: ["ocean", "air"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled: false,
    notes: "Xeneta market updates and XSI-C related rate context.",
    termsPolicyNotes: "Use public pages only. Do not scrape login/subscriber rate data.",
  },
  {
    id: "freightwaves-maritime",
    name: "FreightWaves Maritime and Container News",
    sourceType: "MARKET",
    trustLevel: "NEWS",
    url: "https://www.freightwaves.com/news/category/news/maritime/container",
    homepage: "https://www.freightwaves.com/",
    sourceCategory: "media",
    allowedDomains: ["freightwaves.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "capacity",
    defaultCategories: ["capacity", "rate", "geopolitical", "port_disruption", "labor", "compliance"],
    defaultAffectedModes: ["ocean", "road", "rail", "air"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled: false,
    notes: "Freight media context. Useful for broad market awareness, not operational truth.",
    termsPolicyNotes: "Media source. Treat as context and prefer official/carrier/port confirmation for action.",
  },
  {
    id: "journal-of-commerce-container-shipping",
    name: "Journal of Commerce Container Shipping News",
    sourceType: "MARKET",
    trustLevel: "NEWS",
    url: "https://www.joc.com/maritime/container-shipping-news",
    homepage: "https://www.joc.com/",
    sourceCategory: "media",
    allowedDomains: ["joc.com"],
    fetchType: "firecrawl_search",
    defaultCategory: "capacity",
    defaultCategories: ["capacity", "rate", "port_disruption", "carrier_advisory", "geopolitical"],
    defaultAffectedModes: ["ocean", "road", "rail"],
    maxResultsPerRun: 5,
    maxPagesPerRun: 5,
    enabled: false,
    notes: "Journal of Commerce container shipping analysis and news. Some pages may be subscriber-gated.",
    termsPolicyNotes: "Media/subscription source. Only ingest public snippets/pages; skip sign-in, free-trial, and subscribe flows.",
  },
];

function isCategory(value: unknown): value is MarketSignalCategory {
  return typeof value === "string" && MARKET_SIGNAL_CATEGORIES.includes(value as MarketSignalCategory);
}

function isFetchType(value: unknown): value is MarketFetchType {
  return value === "rss" || value === "html" || value === "manual" || value === "firecrawl_search" || value === "firecrawl_scrape";
}

function isSourceCategory(value: unknown): value is MarketSourceCategory {
  return typeof value === "string" && ["official", "carrier", "port", "regulatory", "rate_index", "media", "research", "competitor", "misc"].includes(value);
}

function trustLevel(value: unknown, fallback: MarketSourceTrustLevel = "EXTERNAL"): MarketSourceTrustLevel {
  return value === "OFFICIAL" || value === "PARTNER" || value === "INDUSTRY" || value === "NEWS" || value === "MANUAL" ||
    value === "INTERNAL" || value === "TRUSTED" || value === "EXTERNAL" || value === "LOW"
    ? value
    : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim().toLowerCase() : "").filter(Boolean)
    : [];
}

function categoryArray(value: unknown, fallback: MarketSignalCategory): MarketSignalCategory[] {
  const categories = Array.isArray(value)
    ? value.filter(isCategory)
    : [];
  return categories.length ? [...new Set(categories)] : [fallback];
}

function patternArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function intValue(value: unknown, fallback: number, max: number) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.floor(number))) : fallback;
}

function fromUnknown(value: unknown): MarketIntelligenceSourceDefinition | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const fetchType = isFetchType(row.fetchType) ? row.fetchType : null;
  const defaultCategory = isCategory(row.defaultCategory) ? row.defaultCategory : null;
  if (!id || !name || !fetchType || !defaultCategory) return null;
  return {
    id,
    name,
    sourceType: "MARKET",
    trustLevel: trustLevel(row.trustLevel),
    url: typeof row.url === "string" && row.url.trim() ? row.url.trim() : null,
    homepage: typeof row.homepage === "string" && row.homepage.trim() ? row.homepage.trim() : null,
    sourceCategory: isSourceCategory(row.sourceCategory) ? row.sourceCategory : "misc",
    allowedDomains: stringArray(row.allowedDomains),
    fetchType,
    defaultCategory,
    defaultCategories: categoryArray(row.defaultCategories, defaultCategory),
    defaultAffectedModes: stringArray(row.defaultAffectedModes),
    maxResultsPerRun: intValue(row.maxResultsPerRun, 10, 100),
    maxPagesPerRun: intValue(row.maxPagesPerRun, 20, 100),
    enabled: row.enabled === true,
    allowedPathPatterns: patternArray(row.allowedPathPatterns),
    blockedPathPatterns: patternArray(row.blockedPathPatterns),
    requirePublishedDate: row.requirePublishedDate === true,
    articleUrlPatterns: patternArray(row.articleUrlPatterns),
    indexUrlPatterns: patternArray(row.indexUrlPatterns),
    notes: typeof row.notes === "string" ? row.notes : null,
    termsPolicyNotes: typeof row.termsPolicyNotes === "string" ? row.termsPolicyNotes : null,
  };
}

export function getMarketIntelligenceSourceRegistry() {
  const envSources = process.env.MARKET_INTELLIGENCE_SOURCES_JSON;
  if (!envSources) return DEFAULT_SOURCES;
  try {
    const parsed = JSON.parse(envSources);
    const configured = Array.isArray(parsed)
      ? parsed.map(fromUnknown).filter((source): source is MarketIntelligenceSourceDefinition => Boolean(source))
      : [];
    const ids = new Set<string>();
    return [...configured, ...DEFAULT_SOURCES].filter((source) => {
      if (ids.has(source.id)) return false;
      ids.add(source.id);
      return true;
    });
  } catch {
    return DEFAULT_SOURCES;
  }
}

export function getMarketIntelligenceSource(id: string | null | undefined) {
  const sourceId = id?.trim();
  return getMarketIntelligenceSourceRegistry().find((source) => source.id === sourceId) ?? DEFAULT_SOURCES[0];
}
