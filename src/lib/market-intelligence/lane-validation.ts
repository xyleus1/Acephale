export type MarketLocationType =
  | "port"
  | "country"
  | "region"
  | "chokepoint"
  | "market";

export type MarketLocationDefinition = {
  label: string;
  type: MarketLocationType;
  lat: number;
  lng: number;
  aliases: string[];
};

export type MarketLane = {
  from: MarketLocationDefinition;
  to: MarketLocationDefinition;
  label: string;
};

const SOCIAL_OR_UTILITY_TERMS = [
  "facebook.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "threads.net",
  "mailto:",
  "tel:",
];

export const BOILERPLATE_LANE_DENYLIST = [
  "Welcome",
  "Countdown",
  "Updates",
  "Update",
  "Messaging Service",
  "Technical Corrections",
  "Section",
  "Address Performance",
  "Drawback Bond Validations",
  "Electronic Export",
  "ACE CATAIR Error",
  "Official Website",
  "Main Content",
  "Search",
  "News",
  "Archive",
] as const;

export const MARKET_LOCATION_REGISTRY: MarketLocationDefinition[] = [
  { label: "Shanghai", type: "port", lat: 31.23, lng: 121.47, aliases: ["shanghai", "port of shanghai"] },
  { label: "Ningbo", type: "port", lat: 29.87, lng: 121.55, aliases: ["ningbo", "ningbo-zhoushan", "ningbo zhoushan"] },
  { label: "Shenzhen", type: "port", lat: 22.54, lng: 114.06, aliases: ["shenzhen", "yantian", "shekou"] },
  { label: "Singapore", type: "port", lat: 1.29, lng: 103.85, aliases: ["singapore", "port of singapore"] },
  { label: "Hamburg", type: "port", lat: 53.55, lng: 9.99, aliases: ["hamburg", "port of hamburg"] },
  { label: "Rotterdam", type: "port", lat: 51.92, lng: 4.48, aliases: ["rotterdam", "port of rotterdam"] },
  { label: "Antwerp", type: "port", lat: 51.22, lng: 4.4, aliases: ["antwerp", "antwerpen", "port of antwerp"] },
  { label: "Los Angeles", type: "port", lat: 33.74, lng: -118.26, aliases: ["los angeles", "port of los angeles", "la port"] },
  { label: "Long Beach", type: "port", lat: 33.75, lng: -118.2, aliases: ["long beach", "port of long beach", "polb"] },
  { label: "New York", type: "port", lat: 40.68, lng: -74.04, aliases: ["new york", "new york/new jersey", "ny/nj", "port of new york"] },
  { label: "Savannah", type: "port", lat: 32.08, lng: -81.09, aliases: ["savannah", "port of savannah"] },
  { label: "Istanbul", type: "port", lat: 41.01, lng: 28.97, aliases: ["istanbul", "port of istanbul"] },
  { label: "Mersin", type: "port", lat: 36.8, lng: 34.63, aliases: ["mersin", "port of mersin"] },

  { label: "Suez Canal", type: "chokepoint", lat: 30.45, lng: 32.35, aliases: ["suez", "suez canal"] },
  { label: "Panama Canal", type: "chokepoint", lat: 9.08, lng: -79.68, aliases: ["panama canal", "panama"] },
  { label: "Strait of Hormuz", type: "chokepoint", lat: 26.56, lng: 56.25, aliases: ["strait of hormuz", "hormuz"] },
  { label: "Bab el-Mandeb", type: "chokepoint", lat: 12.58, lng: 43.33, aliases: ["bab el-mandeb", "bab el mandeb", "mandeb"] },
  { label: "Strait of Malacca", type: "chokepoint", lat: 3.0, lng: 101.0, aliases: ["strait of malacca", "malacca"] },
  { label: "Bosporus", type: "chokepoint", lat: 41.12, lng: 29.07, aliases: ["bosporus", "bosphorus"] },
  { label: "Dardanelles", type: "chokepoint", lat: 40.15, lng: 26.4, aliases: ["dardanelles"] },
  { label: "Strait of Gibraltar", type: "chokepoint", lat: 35.96, lng: -5.6, aliases: ["strait of gibraltar", "gibraltar"] },
  { label: "English Channel", type: "chokepoint", lat: 50.2, lng: -1.6, aliases: ["english channel", "channel"] },
  { label: "Cape of Good Hope", type: "chokepoint", lat: -34.36, lng: 18.47, aliases: ["cape of good hope", "cape route"] },
  { label: "Red Sea", type: "chokepoint", lat: 20.2, lng: 38.2, aliases: ["red sea"] },

  { label: "China", type: "country", lat: 35.8, lng: 103.8, aliases: ["china", "cn", "mainland china"] },
  { label: "US", type: "country", lat: 39.5, lng: -98.35, aliases: ["us", "u.s.", "usa", "u.s.a.", "united states", "united states of america"] },
  { label: "Turkey", type: "country", lat: 39.0, lng: 35.2, aliases: ["turkey", "turkiye", "türkiye"] },
  { label: "Asia", type: "region", lat: 34, lng: 95, aliases: ["asia", "far east", "apac"] },
  { label: "Europe", type: "region", lat: 50.8, lng: 10.4, aliases: ["europe", "eu"] },
  { label: "Northern Europe", type: "region", lat: 54.4, lng: 9.9, aliases: ["northern europe", "north europe"] },
  { label: "North America", type: "region", lat: 43, lng: -100, aliases: ["north america"] },
  { label: "Global Ocean", type: "market", lat: 5, lng: -30, aliases: ["global ocean", "ocean", "global ocean market"] },
  { label: "Global Market", type: "market", lat: 8, lng: 0, aliases: ["global", "global market", "worldwide"] },
];

const LOCATION_BY_ALIAS = new Map<string, MarketLocationDefinition>();
for (const location of MARKET_LOCATION_REGISTRY) {
  LOCATION_BY_ALIAS.set(normalizeComparable(location.label), location);
  for (const alias of location.aliases) LOCATION_BY_ALIAS.set(normalizeComparable(alias), location);
}

function normalizeComparable(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bu\.?\s*s\.?\s*a\.?\b/g, "usa")
    .replace(/\bu\.?\s*s\.?\b/g, "us")
    .replace(/\bcn\b/g, "china")
    .replace(/\beu\b/g, "europe")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function marketLocationAliases() {
  return [...LOCATION_BY_ALIAS.keys()].sort((a, b) => b.length - a.length);
}

export function rejectBoilerplateLaneCandidate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const text = normalizeComparable(raw);
  if (!text) return true;
  if (raw.length > 140) return true;
  if (/https?:\/\//i.test(raw) || /\b(mailto|tel):/i.test(raw)) return true;
  if (SOCIAL_OR_UTILITY_TERMS.some((term) => raw.toLowerCase().includes(term.replace(":", "")))) return true;
  if (["facebook", "flickr", "instagram", "twitter", "xlinks", "linkedin", "youtube", "tiktok", "threads"].some((term) => raw.toLowerCase().includes(term))) return true;
  if (BOILERPLATE_LANE_DENYLIST.some((term) => new RegExp(`\\b${escapeRegex(normalizeComparable(term))}\\b`, "i").test(text))) return true;
  if (/\b(menu|breadcrumb|subscribe|newsletter|privacy|copyright|archive|search|share|follow)\b/i.test(text)) return true;
  return false;
}

export function normalizeMarketLocation(value: string | null | undefined): MarketLocationDefinition | null {
  if (rejectBoilerplateLaneCandidate(value)) return null;
  const comparable = normalizeComparable(value);
  if (!comparable) return null;
  const exact = LOCATION_BY_ALIAS.get(comparable);
  if (exact) return exact;
  const foundAlias = marketLocationAliases().find((alias) => {
    if (alias.length <= 2 && !["us", "cn", "eu"].includes(alias)) return false;
    return new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(comparable);
  });
  return foundAlias ? LOCATION_BY_ALIAS.get(foundAlias) ?? null : null;
}

export function isKnownFreightLocation(value: string | null | undefined) {
  return Boolean(normalizeMarketLocation(value));
}

function splitLane(value: string) {
  const normalized = value.replace(/→/g, "->").replace(/\s+to\s+/i, " -> ");
  const parts = normalized.split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? parts as [string, string] : null;
}

export function parseMarketLane(value: string | null | undefined): MarketLane | null {
  const text = String(value ?? "").trim();
  if (rejectBoilerplateLaneCandidate(text)) return null;
  if (!/(?:->|→|\bto\b)/i.test(text)) return null;
  const parts = splitLane(text);
  if (!parts) return null;
  const from = normalizeMarketLocation(parts[0]);
  const to = normalizeMarketLocation(parts[1]);
  if (!from || !to || from.label === to.label) return null;
  return { from, to, label: `${from.label} -> ${to.label}` };
}

export function isValidMarketLane(value: string | null | undefined) {
  return Boolean(parseMarketLane(value));
}

export function normalizeMarketLane(value: string | null | undefined) {
  return parseMarketLane(value)?.label ?? null;
}

export function detectKnownMarketLocations(text: string | null | undefined) {
  const comparable = normalizeComparable(text);
  if (!comparable) return [];
  const found = new Map<string, MarketLocationDefinition>();
  for (const alias of marketLocationAliases()) {
    if (alias.length <= 2 && !["us", "cn", "eu"].includes(alias)) continue;
    if (new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(comparable)) {
      const location = LOCATION_BY_ALIAS.get(alias);
      if (location) found.set(location.label, location);
    }
  }
  return [...found.values()];
}

export function classifyMarketAffectedEntity(value: string | null | undefined):
  | { kind: "lane"; label: string; from: MarketLocationDefinition; to: MarketLocationDefinition }
  | { kind: "location"; label: string; locationType: MarketLocationType; location: MarketLocationDefinition }
  | { kind: "rejected"; label: string; reason: string } {
  const raw = String(value ?? "").trim();
  const lane = parseMarketLane(raw);
  if (lane) return { kind: "lane", label: lane.label, from: lane.from, to: lane.to };
  const location = normalizeMarketLocation(raw);
  if (location) return { kind: "location", label: location.label, locationType: location.type, location };
  return {
    kind: "rejected",
    label: raw,
    reason: rejectBoilerplateLaneCandidate(raw) ? "boilerplate_or_chrome" : "unknown_freight_location",
  };
}
