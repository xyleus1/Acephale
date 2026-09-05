import OpenAI from "openai";
import { DERYA_AI_MODEL } from "@/lib/gpt56-client";
import { registrableDomain } from "./extract";

export type EntityType =
  | "producer"
  | "scrap_supplier"
  | "trader"
  | "processor"
  | "logistics"
  | "equipment"
  | "company"
  | "association"
  | "media_data"
  | "government_academic"
  | "other";

export type QualificationBrief = {
  objective: string;
  segments: string[];
  regions: string[];
  productFocus: string;
  notes: string;
};

export type QualificationInput = {
  id: string;
  companyName: string;
  domain: string;
  website: string;
  country: string | null;
  pageExcerpt: string;
  evidenceUrls: string[];
};

export type QualificationResult = {
  id: string;
  entityType: EntityType;
  isTarget: boolean;
  sizeSignal: "large" | "small" | "unknown";
  displayName: string;
  reason: string;
  confidence: number;
  source: "rule" | "model" | "fallback";
};

export type CandidateQualifier = (
  brief: QualificationBrief,
  inputs: QualificationInput[],
  options?: { deadlineAt?: number; now?: () => number },
) => Promise<QualificationResult[]>;

export const KNOWN_NON_COMPANY_DOMAINS: Record<string, EntityType> = {
  "tradeindia.com": "media_data",
  "tradekey.com": "media_data",
  "go4worldbusiness.com": "media_data",
  "globalsources.com": "media_data",
  "alibaba.com": "media_data",
  "indiamart.com": "media_data",
  "exportersindia.com": "media_data",
  "europages.com": "media_data",
  "europages.co.uk": "media_data",
  "kompass.com": "media_data",
  "yellowpages.com": "media_data",
  "thomasnet.com": "media_data",
  "iqsdirectory.com": "media_data",
  "importgenius.com": "media_data",
  "trademo.com": "media_data",
  "panjiva.com": "media_data",
  "volza.com": "media_data",
  "zauba.com": "media_data",
  "ibisworld.com": "media_data",
  "researchandmarkets.com": "media_data",
  "techsciresearch.com": "media_data",
  "factmr.com": "media_data",
  "marketresearch.com": "media_data",
  "statista.com": "media_data",
  "kenresearch.com": "media_data",
  "mordorintelligence.com": "media_data",
  "grandviewresearch.com": "media_data",
  "steelorbis.com": "media_data",
  "steelonthenet.com": "media_data",
  "steel.directory": "media_data",
  "scrapmonster.com": "media_data",
  "recycleinme.com": "media_data",
  "recyclinginternational.com": "media_data",
  "letsrecycle.com": "media_data",
  "recyclingproductnews.com": "media_data",
  "recyclingtoday.com": "media_data",
  "metalbulletin.com": "media_data",
  "fastmarkets.com": "media_data",
  "argusmedia.com": "media_data",
  "spglobal.com": "media_data",
  "steelprices.co.uk": "media_data",
  "scribd.com": "media_data",
  "wikipedia.org": "media_data",
  "linkedin.com": "media_data",
  "facebook.com": "media_data",
  "instagram.com": "media_data",
  "youtube.com": "media_data",
  "yahoo.com": "media_data",
  "google.com": "media_data",
  "bing.com": "media_data",
  "amazon.com": "media_data",
  "ebay.com": "media_data",
  "dnb.com": "media_data",
  "zoominfo.com": "media_data",
  "crunchbase.com": "media_data",
  "bloomberg.com": "media_data",
  "reuters.com": "media_data",
  "worldsteel.org": "association",
  "eurofer.eu": "association",
  "eurometal.net": "association",
  "bir.org": "association",
  "metallics.org": "association",
  "steel.org": "association",
  "aist.org": "association",
  "isri.org": "association",
  "recycledmaterials.org": "association",
  "bdsv.org": "association",
  "wvstahl.de": "association",
  "federacciai.it": "association",
  "assofermet.it": "association",
  "iima.org": "association",
  "bmra.org.uk": "association",
  "uksteel.org": "association",
  "fedecom.it": "association",
  "worldbank.org": "government_academic",
  "imf.org": "government_academic",
  "oecd.org": "government_academic",
  "europa.eu": "government_academic",
  "epa.gov": "government_academic",
  "usgs.gov": "government_academic",
  "globalenergymonitor.org": "government_academic",
  "gem.wiki": "government_academic",
  "ecoinvent.org": "government_academic",
  "cambridge.org": "government_academic",
  "degruyter.com": "government_academic",
  "degruyterbrill.com": "government_academic",
  "sciencedirect.com": "government_academic",
  "springer.com": "government_academic",
  "researchgate.net": "government_academic",
};

const PAGE_WORDS = [
  "contact us",
  "home page",
  "startseite",
  "impressum",
  "willkommen",
  "chi siamo",
  "about us",
  "homepage",
  "contact",
  "welcome",
  "about",
  "home",
];

const ENTITY_TYPES = new Set<EntityType>([
  "producer",
  "scrap_supplier",
  "trader",
  "processor",
  "logistics",
  "equipment",
  "company",
  "association",
  "media_data",
  "government_academic",
  "other",
]);

const NON_TARGET_TYPES = new Set<EntityType>(["association", "media_data", "government_academic", "other"]);

const QUALIFICATION_INSTRUCTIONS = [
  "You classify companies found by public web research for a B2B prospecting brief.",
  "For each candidate decide what kind of entity the website belongs to and whether it is a real target for the brief.",
  "Judge from the candidate fields only. Do not invent facts. When the page text is thin, use the domain and company name and lower your confidence.",
  "Entity types:",
  "- producer: a steel mill, integrated plant, or primary metals producer that makes raw, semi-finished, or basic steel products.",
  "- scrap_supplier: a scrap metal merchant, recycler, yard, shredder operator, or exporter that collects and sells ferrous scrap.",
  "- trader: a metals trading, distribution, or stockholding company that buys from producers and sells to industrial users, often across borders.",
  "- processor: a downstream manufacturer, fabricator, re-roller, service center, or value-added processor.",
  "- logistics: a port, terminal, shipping line, freight forwarder, stevedore, or logistics provider.",
  "- equipment: a machinery, equipment, technology, software, or engineering vendor.",
  "- company: any other real operating business that sells goods or services and does not fit the categories above.",
  "- association: an industry association, chamber, federation, institute, standards body, or trade fair.",
  "- media_data: a news site, magazine, market data or price platform, market research publisher, B2B marketplace, directory, or listing site.",
  "- government_academic: a government body, regulator, university, research institute, or NGO.",
  "- other: pages that are not an operating company at all, such as personal pages, parked domains, or unrelated content.",
  "association, media_data, government_academic, and other are never targets, regardless of keywords.",
  "Any other entity type can be a target, but only when the company's actual role matches what the brief asks for. A brief asking for scrap suppliers is not served by a mill; a brief asking for steel traders is not served by a service center; a brief asking for fabricators is served by a processor.",
  "Respect explicit size and scope exclusions in the brief: when the brief asks for large producers, a processor or a mill of clearly small scale is not a target; when the brief asks for scrap shippers of several thousand tons, a local scrap yard with no export or bulk signal may still be a target if it could plausibly aggregate that volume, but a tiny neighborhood dealer is not.",
  "sizeSignal is large when the text shows multi-million-ton capacity, a stock listing, a multinational footprint, or many plants; small when it shows a single small shop, a local yard, or a family workshop; otherwise unknown.",
  "displayName is the clean legal or trading name of the company, without page words like Home, Welcome, About us, Contact, or taglines. If the name cannot be determined, use the domain without its suffix.",
  "reason is one short sentence, at most 160 characters, grounded in the candidate fields, with no em dash.",
  "Never use the U+2014 em dash character anywhere in the output.",
].join("\n");

const QUALIFICATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "entityType", "isTarget", "sizeSignal", "displayName", "reason", "confidence"],
        properties: {
          id: { type: "string" },
          entityType: {
            type: "string",
            enum: [
              "producer",
              "scrap_supplier",
              "trader",
              "processor",
              "logistics",
              "equipment",
              "company",
              "association",
              "media_data",
              "government_academic",
              "other",
            ],
          },
          isTarget: { type: "boolean" },
          sizeSignal: { type: "string", enum: ["large", "small", "unknown"] },
          displayName: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

function hostOf(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/^www\./, "").split("/")[0] ?? "";
  }
}

function pageWordKey(value: string) {
  return value.toLowerCase().replace(/[\s|:._-]+/g, " ").trim();
}

function isPageWord(value: string) {
  return PAGE_WORDS.includes(pageWordKey(value));
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: "\"" };
  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (match, hex: string | undefined, decimal: string | undefined) => {
      const code = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return Number.isFinite(code)
        && code >= 0
        && code <= 0x10ffff
        && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : match;
    });
}

function stripPageWordEdges(value: string) {
  let result = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pageWord of PAGE_WORDS) {
      const pattern = new RegExp(`^${pageWord.replace(/ /g, "\\s+")}(?:\\s+|$)`, "i");
      if (pattern.test(result)) {
        result = result.replace(pattern, "").trim();
        changed = true;
      }
      const suffixPattern = new RegExp(`(?:\\s+|^)${pageWord.replace(/ /g, "\\s+")}$`, "i");
      if (suffixPattern.test(result)) {
        result = result.replace(suffixPattern, "").trim();
        changed = true;
      }
    }
  }
  return result;
}

function domainDisplayName(domain: string) {
  const registrable = registrableDomain(domain);
  const label = registrable.split(".")[0] ?? "";
  return label
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

export function cleanCompanyName(name: string, domain: string): string {
  const decoded = decodeEntities(name).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const parts = decoded.split(/\s*(?:\||:|\u2013|\u2014|\s-\s)\s*/).map((part) => stripPageWordEdges(part)).filter(Boolean);
  let cleaned = parts.find((part) => !isPageWord(part)) ?? "";
  cleaned = stripPageWordEdges(cleaned).replace(/^[|:,\s-]+|[|:,\s-]+$/g, "").trim();
  return cleaned || domainDisplayName(domain);
}

function institutionalDomain(domain: string) {
  const host = hostOf(domain);
  return (
    host.endsWith(".gov") ||
    host.includes(".gov.") ||
    host.endsWith(".gc.ca") ||
    host.endsWith(".edu") ||
    host.includes(".edu.") ||
    host.endsWith(".mil") ||
    host.includes(".mil.") ||
    host.endsWith(".int") ||
    host.includes(".int.") ||
    /\.ac\.[a-z]{2,}$/i.test(host)
  );
}

function resultForRule(input: QualificationInput, entityType: EntityType, reason: string): QualificationResult {
  return {
    id: input.id,
    entityType,
    isTarget: false,
    sizeSignal: "unknown",
    displayName: cleanCompanyName(input.companyName, input.domain),
    reason,
    confidence: 1,
    source: "rule",
  };
}

function knownNonCompanyDomainType(value: string): EntityType | null {
  const host = hostOf(value);
  const labels = host.split(".").filter(Boolean);
  for (let start = 0; start <= labels.length - 2; start += 1) {
    const knownType = KNOWN_NON_COMPANY_DOMAINS[labels.slice(start).join(".")];
    if (knownType) return knownType;
  }
  return null;
}

export function classifyByRule(input: QualificationInput): QualificationResult | null {
  const displayName = cleanCompanyName(input.companyName, input.domain);
  const domain = registrableDomain(input.domain);
  if (institutionalDomain(input.domain)) {
    return resultForRule(input, "government_academic", "Government, academic, or international domain.");
  }
  const knownType = knownNonCompanyDomainType(input.domain);
  if (knownType) {
    return resultForRule(input, knownType, `Known ${knownType.replace("_", " ")} domain, not a target company.`);
  }
  if (!displayName && !domain) {
    return resultForRule(input, "other", "No company identity was found.");
  }
  return null;
}

function fallbackResult(input: QualificationInput, reason = "model returned no verdict"): QualificationResult {
  return {
    id: input.id,
    entityType: "other",
    isTarget: true,
    sizeSignal: "unknown",
    displayName: input.companyName.trim(),
    reason,
    confidence: 0,
    source: "fallback",
  };
}

function modelResult(input: QualificationInput, value: unknown): QualificationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id !== input.id) return null;
  const entityType = ENTITY_TYPES.has(item.entityType as EntityType) ? item.entityType as EntityType : "other";
  const sizeSignal = item.sizeSignal === "large" || item.sizeSignal === "small" ? item.sizeSignal : "unknown";
  const reason = typeof item.reason === "string"
    ? item.reason.replace(/\u2014/g, "-").trim().slice(0, 160)
    : "Model classified this candidate.";
  const rawName = typeof item.displayName === "string" ? item.displayName.trim() : "";
  const displayName = cleanCompanyName(rawName, input.domain);
  const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
    ? Math.max(0, Math.min(1, item.confidence))
    : 0;
  return {
    id: input.id,
    entityType,
    isTarget: !NON_TARGET_TYPES.has(entityType) && item.isTarget === true,
    sizeSignal,
    displayName,
    reason,
    confidence,
    source: "model",
  };
}

export function createOpenAiQualifier(options: { client?: OpenAI; model?: string; batchSize?: number } = {}): CandidateQualifier {
  const batchSize = Math.min(15, Math.max(1, Math.floor(options.batchSize ?? 15)));
  const client = options.client ?? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 20_000,
    maxRetries: 1,
  });
  return async (brief, inputs, qualificationOptions) => {
    const results: QualificationResult[] = [];
    const now = qualificationOptions?.now ?? Date.now;
    for (let offset = 0; offset < inputs.length; offset += batchSize) {
      const batch = inputs.slice(offset, offset + batchSize);
      const remaining = qualificationOptions?.deadlineAt === undefined
        ? Number.POSITIVE_INFINITY
        : qualificationOptions.deadlineAt - now();
      if (remaining < 5_000) {
        results.push(...inputs.slice(offset).map((input) => fallbackResult(input, "qualification skipped: batch out of time")));
        break;
      }
      if (!process.env.OPENAI_API_KEY) {
        results.push(...batch.map((input) => fallbackResult(input)));
        continue;
      }
      try {
        const response = await client.responses.create({
          model: options.model ?? DERYA_AI_MODEL,
          instructions: QUALIFICATION_INSTRUCTIONS,
          input: JSON.stringify({
            brief,
            candidates: batch.map((input) => ({ ...input, pageExcerpt: input.pageExcerpt.slice(0, 1_500) })),
          }),
          text: {
            format: {
              type: "json_schema",
              name: "lead_candidate_qualification",
              strict: true,
              schema: QUALIFICATION_RESPONSE_SCHEMA,
            },
          },
          store: false,
        }, qualificationOptions?.deadlineAt === undefined
          ? undefined
          : { timeout: Math.min(20_000, remaining - 2_000) });
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(response.output_text);
        } catch {
          parsed = null;
        }
        const modelResults = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as { results?: unknown }).results
          : null;
        const byId = new Map(
          Array.isArray(modelResults)
            ? modelResults.map((item) => {
                const id = item && typeof item === "object" && !Array.isArray(item)
                  ? (item as Record<string, unknown>).id
                  : null;
                return typeof id === "string" ? [id, item] as const : null;
              }).filter((item): item is readonly [string, unknown] => Boolean(item))
            : [],
        );
        results.push(...batch.map((input) => modelResult(input, byId.get(input.id)) ?? fallbackResult(input)));
      } catch {
        results.push(...batch.map((input) => fallbackResult(input)));
      }
    }
    return results;
  };
}

export async function qualifyCandidates(
  brief: QualificationBrief,
  inputs: QualificationInput[],
  qualifier: CandidateQualifier,
  options?: { deadlineAt?: number; now?: () => number },
): Promise<Map<string, QualificationResult>> {
  const results = new Map<string, QualificationResult>();
  const remaining: QualificationInput[] = [];
  for (const input of inputs) {
    const ruleResult = classifyByRule(input);
    if (ruleResult) results.set(input.id, ruleResult);
    else remaining.push(input);
  }
  if (!remaining.length) return results;
  let modelResults: QualificationResult[] = [];
  try {
    modelResults = await qualifier(brief, remaining, options);
  } catch {
    modelResults = remaining.map((input) => fallbackResult(input));
  }
  const byId = new Map(modelResults.filter((result) => remaining.some((input) => input.id === result.id)).map((result) => [result.id, result]));
  for (const input of remaining) {
    const result = byId.get(input.id) ?? fallbackResult(input);
    results.set(input.id, {
      ...result,
      id: input.id,
      isTarget: result.source === "model"
        ? !NON_TARGET_TYPES.has(result.entityType) && result.isTarget
        : result.isTarget,
      displayName: result.displayName.trim() ? result.displayName : cleanCompanyName(input.companyName, input.domain),
    });
  }
  return results;
}
