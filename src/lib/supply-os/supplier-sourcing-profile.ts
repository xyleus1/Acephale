import { createHash } from "node:crypto";

import {
  classifySupplierSourcingCategory,
  RETAIL_DISQUALIFIERS,
  SUPPLIER_QUOTING_RULE,
  type SupplierCapabilityRule,
  type SupplierSourcingCategory,
  type SupplierSourcingCategoryKey,
} from "@/lib/supply-os/supplier-sourcing-category";

export type SourcingProfileEnrichment = {
  queries: string[];
  synonyms: string[];
  disqualifierTerms: string[];
};

const GENERIC_TERMS = new Set([
  "custom",
  "manufacturer",
  "manufacturing",
  "producer",
  "production",
  "supplier",
  "factory",
  "company",
  "pcs",
  "piece",
  "pieces",
  "unit",
  "units",
  "part",
  "parts",
  "product",
  "products",
]);

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "or",
  "the",
  "to",
  "with",
]);

const UNITS = new Set([
  "cm",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "lb",
  "lbs",
  "liter",
  "liters",
  "l",
  "m",
  "mm",
  "meter",
  "meters",
  "pcs",
  "piece",
  "pieces",
  "unit",
  "units",
]);

const GENERIC_REGIONS = [
  "United States",
  "Germany",
  "United Kingdom",
  "Turkey",
  "Poland",
  "Italy",
  "China",
  "India",
  "Mexico",
  "Canada",
] as const;

const BASE_QUERY_TEMPLATES = [
  (material: string) => `${material} manufacturer request a quote`,
  (material: string) => `${material} contract manufacturer OEM`,
  (material: string) => `${material} producer factory direct`,
  (material: string) => `custom ${material} manufacturing capability`,
  (material: string) => `${material} supplier production capacity`,
  (material: string) => `${material} OEM manufacturer quote`,
  (material: string) => `${material} wholesale manufacturer`,
  (material: string) => `${material} manufacturing company RFQ`,
] as const;

const SOURCING_CATEGORY_KEY_PATTERN = /^[a-z0-9:-]+$/i;

export function isSourcingCategoryKey(value: unknown): value is SupplierSourcingCategoryKey {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 80
    && SOURCING_CATEGORY_KEY_PATTERN.test(value);
}

export function sourcingCategoryKeySlug(phrase: string) {
  const normalized = phrase
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (slug) return slug;
  return `x${createHash("sha256").update(phrase).digest("hex").slice(0, 12)}`;
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function phraseTokens(material: string) {
  return tokens(material).filter((token) => {
    if (/^\d+$/.test(token)) return false;
    if (UNITS.has(token)) return false;
    return !STOPWORDS.has(token);
  });
}

function filteredProductTerms(value: string | null | undefined) {
  return phraseTokens(value ?? "")
    .filter((token) => token.length >= 3 && !GENERIC_TERMS.has(token));
}

function productTerms(
  material: string,
  specification: string | null | undefined,
  notes: string | null | undefined,
  enrichment: SourcingProfileEnrichment | null | undefined,
) {
  const terms = [...new Set(filteredProductTerms(material))].slice(0, 6);
  if (terms.length < 2) {
    for (const value of [specification, notes]) {
      for (const term of filteredProductTerms(value)) {
        if (!terms.includes(term)) terms.push(term);
        if (terms.length >= 6) break;
      }
      if (terms.length >= 6) break;
    }
  }
  for (const synonym of enrichment?.synonyms ?? []) {
    const normalized = tokens(synonym).filter((token) => token.length >= 3).join(" ");
    if (normalized && !terms.includes(normalized)) terms.push(normalized);
    if (terms.length >= 14) break;
  }
  return terms;
}

function cleanMaterialPhrase(material: string, specification: string | null | undefined) {
  const materialTokens = phraseTokens(material);
  const phrase = [...materialTokens];
  const genericish = materialTokens.length < 2
    || materialTokens.every((token) => GENERIC_TERMS.has(token));
  if (genericish) {
    phrase.push(...filteredProductTerms(specification).slice(0, 4));
  }
  return phrase.join(" ").slice(0, 60).trim();
}

function wholeWordRule(label: string, term: string): SupplierCapabilityRule {
  return { label, pattern: new RegExp(`\\b${escaped(term)}\\b`, "i") };
}

function extractRegion(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  const listed = GENERIC_REGIONS.find((region) => normalized.toLowerCase().includes(region.toLowerCase()));
  if (listed) return listed;
  const first = normalized.split(",")[0]?.trim();
  return first && /[A-Za-z]{3,}/.test(first) ? first.slice(0, 80) : null;
}

function regionsFor(input: {
  deliveryLocation?: string | null;
  targetCountry?: string | null;
}) {
  const selected = extractRegion(input.targetCountry) ?? extractRegion(input.deliveryLocation);
  const values = selected ? [selected, ...GENERIC_REGIONS] : [...GENERIC_REGIONS];
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()].slice(0, 10);
}

export function parseSourcingProfileEnrichment(value: unknown): SourcingProfileEnrichment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["queries", "synonyms", "disqualifierTerms"] as const;
  const parsed = {} as SourcingProfileEnrichment;
  for (const key of keys) {
    if (!Array.isArray(record[key])) return null;
    const entries = record[key] as unknown[];
    if (entries.some((entry) => typeof entry !== "string")) return null;
    const strings = entries as string[];
    parsed[key] = strings
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= 80 && !entry.includes("\u2014"))
      .slice(0, 8);
  }
  return parsed;
}

export function deriveSupplierSourcingCategory(input: {
  material: string;
  specification?: string | null;
  notes?: string | null;
  deliveryLocation?: string | null;
  targetCountry?: string | null;
  enrichment?: SourcingProfileEnrichment | null;
}): SupplierSourcingCategory | null {
  const materialPhrase = cleanMaterialPhrase(input.material, input.specification);
  const terms = productTerms(
    input.material,
    input.specification,
    input.notes,
    input.enrichment,
  );
  if (!phraseTokens(input.material).some((token) => /[a-z]/i.test(token) && token.length >= 3)) return null;
  if (!materialPhrase || !terms.length) return null;

  const productPattern = new RegExp(`\\b(?:${terms.map(escaped).join("|")})\\b`, "i");
  const productDepth: SupplierCapabilityRule = {
    label: "product depth",
    pattern: productPattern,
    test: (text) => terms.filter((term) => new RegExp(`\\b${escaped(term)}\\b`, "i").test(text)).length >= 2,
  };
  const enrichmentDisqualifiers = (input.enrichment?.disqualifierTerms ?? [])
    .slice(0, 8)
    .map((term) => wholeWordRule(`enrichment disqualifier: ${term}`, term));

  return {
    key: `derived:${sourcingCategoryKeySlug(materialPhrase)}`,
    source: "derived",
    label: `${materialPhrase} sourcing`,
    request: new RegExp(terms.map(escaped).join("|"), "i"),
    queries: [
      ...BASE_QUERY_TEMPLATES.map((template) => template(materialPhrase)),
      ...(input.enrichment?.queries ?? []).slice(0, 8),
    ].filter((query, index, all) => all.indexOf(query) === index),
    regions: regionsFor(input),
    requiredAll: [
      { label: "product match", pattern: productPattern },
      {
        label: "manufacturing identity",
        pattern: /\b(manufactur(?:er|ing|e)|producer|factory|production|oem|contract manufactur|fabricat(?:ion|e|or))\b/i,
      },
    ],
    requiredAny: [
      SUPPLIER_QUOTING_RULE,
      {
        label: "quality system",
        pattern: /\b(iso ?9001|iso ?14001|iso ?13485|as9100|iatf ?16949|ce marked|certif(?:ied|ication))\b/i,
      },
      {
        label: "production scale",
        pattern: /\b(prototype|low volume|high volume|production run|capacity|lead time|moq|minimum order)\b/i,
      },
      {
        label: "export and logistics",
        pattern: /\b(export|worldwide shipping|incoterms?|fob|exw|containers?)\b/i,
      },
      productDepth,
    ],
    requiredAnyHits: 2,
    disqualifiers: [...RETAIL_DISQUALIFIERS, ...enrichmentDisqualifiers],
  };
}

export function resolveSupplierSourcingCategory(input: {
  material: string;
  specification?: string | null;
  notes?: string | null;
  deliveryLocation?: string | null;
  targetCountry?: string | null;
  enrichment?: SourcingProfileEnrichment | null;
}): SupplierSourcingCategory | null {
  const curated = classifySupplierSourcingCategory(input);
  if (curated) return { ...curated, source: "curated" };
  return deriveSupplierSourcingCategory(input);
}
