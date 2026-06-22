import { z } from "zod";
import {
  MARKET_SIGNAL_CATEGORIES,
  MARKET_SIGNAL_SEVERITIES,
  type MarketSignalCategory,
} from "./source-registry";
import {
  extractCleanEvidenceText,
  hasCategorySpecificEvidence,
  isCleanLaneCandidate,
  sanitizeMarketMarkdown,
} from "./content-hygiene";

export const MarketSignalCandidateSchema = z.object({
  category: z.enum(MARKET_SIGNAL_CATEGORIES as [MarketSignalCategory, ...MarketSignalCategory[]]),
  severity: z.enum(MARKET_SIGNAL_SEVERITIES),
  confidence: z.number().min(0).max(1),
  affectedModes: z.array(z.string()).default([]),
  affectedOrigins: z.array(z.string()).default([]),
  affectedDestinations: z.array(z.string()).default([]),
  affectedPorts: z.array(z.string()).default([]),
  affectedLanes: z.array(z.string()).default([]),
  affectedCarriers: z.array(z.string()).default([]),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  summary: z.string().min(1),
  operatorImplication: z.string().nullable().optional(),
  pricingImplication: z.string().nullable().optional(),
  customerImpact: z.string().nullable().optional(),
  recommendedActions: z.array(z.string()).default([]),
  sourceRefs: z.array(z.string()).default([]),
  evidenceExcerpt: z.string().nullable().optional(),
});

export type MarketSignalCandidate = z.infer<typeof MarketSignalCandidateSchema>;

type ExtractInput = {
  title?: string | null;
  content: string;
  defaultCategory?: MarketSignalCategory;
  defaultAffectedModes?: string[];
  sourceRefs?: string[];
  publishedAt?: Date | string | null;
};

const CATEGORY_TERMS: Record<MarketSignalCategory, string[]> = {
  rate: ["rate", "rates", "spot", "freight rate", "gri", "surcharge", "bunker", "price", "pricing", "index"],
  port_disruption: ["port", "terminal", "congestion", "berth", "closure", "blank sailing", "delay", "queue"],
  customs: ["customs", "inspection", "clearance", "tariff", "duty", "border"],
  carrier_advisory: ["carrier", "line", "blank sailing", "service change", "advisory", "schedule"],
  weather: ["storm", "typhoon", "hurricane", "weather", "flood", "wind"],
  labor: ["strike", "labor", "union", "walkout", "industrial action"],
  geopolitical: ["war", "sanction", "red sea", "suez", "panama", "geopolitical", "security"],
  capacity: ["capacity", "space", "equipment", "container shortage", "vessel", "rollover"],
  compliance: ["compliance", "regulation", "emissions", "documentation", "license", "sanctions"],
};

const MODE_TERMS: Array<[string, string[]]> = [
  ["ocean", ["ocean", "sea", "container", "fcl", "lcl", "vessel", "blank sailing", "port"]],
  ["air", ["air", "airfreight", "airport", "belly cargo"]],
  ["road", ["road", "truck", "trucking", "border", "driver"]],
  ["rail", ["rail", "train"]],
];

const LOCATION_TERMS: Array<[string, string[]]> = [
  ["China", ["china", "cn", "shanghai", "ningbo", "shenzhen", "yantian", "qingdao", "xiamen"]],
  ["Asia", ["asia", "far east", "china", "shanghai", "ningbo", "shenzhen", "yantian"]],
  ["Northern Europe", ["northern europe", "hamburg", "rotterdam", "antwerp", "bremerhaven", "felixstowe"]],
  ["Europe", ["europe", "eu", "hamburg", "rotterdam", "antwerp", "germany", "netherlands", "uk"]],
  ["Turkey", ["turkey", "turkiye", "istanbul", "izmir", "mersin"]],
  ["United States", ["united states", "usa", "us", "new york", "los angeles", "long beach", "savannah"]],
  ["Red Sea", ["red sea", "suez"]],
  ["Panama", ["panama canal", "panama"]],
];

const PORT_TERMS = ["Shanghai", "Ningbo", "Shenzhen", "Yantian", "Qingdao", "Hamburg", "Rotterdam", "Antwerp", "Bremerhaven", "Istanbul", "Mersin", "Los Angeles", "Long Beach", "New York", "Savannah"];

const CARRIER_TERMS = ["Maersk", "MSC", "CMA CGM", "Hapag-Lloyd", "ONE", "Evergreen", "COSCO", "OOCL", "Yang Ming", "ZIM", "Turkish Cargo", "DHL", "FedEx", "UPS"];

function lower(value: string) {
  return value.toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function countTerms(text: string, terms: string[]) {
  return terms.filter((term) => termMatches(text, term)).length;
}

function termMatches(text: string, term: string) {
  const normalized = term.toLowerCase();
  if (normalized.length <= 3 || /^[a-z]{2,3}$/.test(normalized)) {
    return new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }
  return text.includes(normalized);
}

function detectCategory(text: string, fallback: MarketSignalCategory) {
  const scored = MARKET_SIGNAL_CATEGORIES
    .map((category) => ({ category, score: countTerms(text, CATEGORY_TERMS[category]) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score
    ? { category: scored[0].category, score: scored[0].score }
    : { category: fallback, score: countTerms(text, CATEGORY_TERMS[fallback]) };
}

function detectSeverity(text: string): typeof MARKET_SIGNAL_SEVERITIES[number] {
  if (/\b(closed|closure|strike|war|sanction|critical|halt|suspended|severe|emergency)\b/.test(text)) return "critical";
  if (/\b(surge|jump|sharp|high|major|significant|reroute|disruption|congestion)\b/.test(text)) return "high";
  if (/\b(rise|rising|delay|pressure|moderate|tight|watch)\b/.test(text)) return "medium";
  return "low";
}

function detectModes(text: string) {
  return MODE_TERMS.filter(([, terms]) => terms.some((term) => termMatches(text, term))).map(([mode]) => mode);
}

function detectLocations(text: string) {
  return LOCATION_TERMS.filter(([, terms]) => terms.some((term) => termMatches(text, term))).map(([location]) => location);
}

function detectNamed(text: string, names: string[]) {
  const source = lower(text);
  return names.filter((name) => source.includes(lower(name)));
}

function detectLanes(text: string, locations: string[]) {
  const lanes: string[] = [];
  const direct = text.match(/\b([A-Z][A-Za-z .-]{2,24})\s+(?:to|->|→)\s+([A-Z][A-Za-z .-]{2,24})\b/g) ?? [];
  for (const lane of direct) lanes.push(lane.replace(/\s+to\s+/i, " -> ").replace(/→/g, "->").replace(/\s*->\s*/g, " -> "));
  if (/asia[-\s]?europe|far east[-\s]?europe|china[-\s]?europe|\bcn\s*[-→>]+\s*eu\b/i.test(text)) {
    lanes.push("China -> Northern Europe");
  }
  if (locations.includes("China") && (locations.includes("Europe") || locations.includes("Northern Europe"))) {
    lanes.push("China -> Northern Europe");
  }
  if (locations.includes("Turkey") && locations.includes("Europe")) {
    lanes.push("Turkey -> Europe");
  }
  return unique(lanes).filter(isCleanLaneCandidate).slice(0, 8);
}

function firstSentence(text: string, fallback: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  const sentence = compact.match(/^(.{40,240}?[.!?])\s/)?.[1] ?? compact.slice(0, 220);
  return sentence || fallback;
}

function implication(category: MarketSignalCategory, severity: string, laneLabel: string) {
  if (category === "rate") {
    return {
      operator: `Review active ${laneLabel} quotes before sending customer pricing.`,
      pricing: "Refresh buy rates and margin guardrails before committing sell prices.",
      customer: severity === "high" || severity === "critical" ? "Customers on affected lanes may need revised pricing or validity language." : "Customers on affected lanes may face changed quote validity.",
    };
  }
  if (category === "port_disruption" || category === "weather" || category === "labor") {
    return {
      operator: `Check ETD/ETA and pending bookings on ${laneLabel}.`,
      pricing: "Add delay risk and validity review before quoting affected routes.",
      customer: "Customers may need proactive delay or routing caveats.",
    };
  }
  if (category === "customs" || category === "compliance") {
    return {
      operator: "Check documents and customs ownership before promising clearance timing.",
      pricing: "Protect margin for possible inspection, documentation, or compliance cost.",
      customer: "Customers may need updated document asks or compliance caveats.",
    };
  }
  return {
    operator: `Check active RFQs/jobs that overlap ${laneLabel}.`,
    pricing: "Treat the signal as review context before sending price externally.",
    customer: "Customers on affected lanes may need updated expectations.",
  };
}

function confidence(text: string, category: MarketSignalCategory, modes: string[], locations: string[], lanes: string[]) {
  const score = 0.42
    + Math.min(0.2, countTerms(text, CATEGORY_TERMS[category]) * 0.04)
    + Math.min(0.16, modes.length * 0.08)
    + Math.min(0.16, locations.length * 0.04)
    + Math.min(0.12, lanes.length * 0.06);
  return Math.max(0.35, Math.min(0.92, Number(score.toFixed(2))));
}

export function extractMarketSignals(input: ExtractInput): MarketSignalCandidate[] {
  const title = input.title?.trim() || "Market intelligence update";
  const evidenceText = extractCleanEvidenceText({ title, content: input.content, publishedAt: input.publishedAt });
  const sanitizedContent = sanitizeMarketMarkdown(input.content);
  const combined = `${title}\n${sanitizedContent}`.trim();
  const text = lower(combined);
  if (text.length < 280) return [];
  const categoryResult = detectCategory(text, input.defaultCategory ?? "rate");
  const category = categoryResult.category;
  if (categoryResult.score <= 0 || !hasCategorySpecificEvidence(category, evidenceText)) return [];
  const severity = detectSeverity(text);
  const affectedModes = unique([...detectModes(text), ...(input.defaultAffectedModes ?? [])]);
  const locations = unique(detectLocations(text));
  const affectedPorts = unique(detectNamed(combined, PORT_TERMS));
  const affectedCarriers = unique(detectNamed(combined, CARRIER_TERMS));
  const affectedLanes = detectLanes(combined, locations);
  const affectedOrigins = locations.filter((location) => !["Europe", "Northern Europe", "United States"].includes(location)).slice(0, 8);
  const affectedDestinations = locations.filter((location) => ["Europe", "Northern Europe", "United States"].includes(location)).slice(0, 8);
  const laneLabel = affectedLanes[0] ?? ([affectedOrigins[0], affectedDestinations[0]].filter(Boolean).join(" -> ") || "affected lanes");
  const signalConfidence = confidence(text, category, affectedModes, locations, affectedLanes);
  if (signalConfidence < 0.55) return [];
  if (affectedModes.length === 0 && affectedPorts.length === 0 && affectedLanes.length === 0 && affectedCarriers.length === 0) return [];
  const implications = implication(category, severity, laneLabel);
  const sourceRefs = input.sourceRefs ?? [];
  const candidate = MarketSignalCandidateSchema.parse({
    category,
    severity,
    confidence: signalConfidence,
    affectedModes,
    affectedOrigins,
    affectedDestinations,
    affectedPorts,
    affectedLanes,
    affectedCarriers,
    effectiveFrom: input.publishedAt ? new Date(input.publishedAt) : new Date(),
    effectiveTo: null,
    summary: firstSentence(combined, title),
    operatorImplication: implications.operator,
    pricingImplication: implications.pricing,
    customerImpact: implications.customer,
    recommendedActions: [
      "Find active RFQs on affected lanes",
      "Re-run strategy before sending customer quote",
      "Warn operator in morning brief",
    ],
    sourceRefs,
    evidenceExcerpt: firstSentence(evidenceText, title),
  });

  return [candidate];
}
