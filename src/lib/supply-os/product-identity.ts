export type ProductIdentityItem = {
  itemKey: string;
  externalId?: string | null;
  sku?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  name: string;
  description?: string | null;
};

export type ProductIdentityAlias = {
  aliasType: "EXTERNAL_ID" | "SKU" | "GTIN" | "NAME";
  aliasValue: string;
  canonicalItemKey: string;
  approved: boolean;
};

export type ProductIdentityQuery = {
  externalId?: string | null;
  sku?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  name?: string | null;
  description?: string | null;
};

export type ProductIdentityVectorCandidate = {
  itemKey: string;
  similarity: number;
};

export type ProductIdentityResolution = {
  status: "RESOLVED" | "REVIEW_REQUIRED" | "UNRESOLVED";
  method: "EXTERNAL_ID_OR_SKU" | "MANUFACTURER_MPN" | "GTIN_OR_ALIAS" | "LEXICAL" | "VECTOR_PROPOSAL" | "NONE";
  itemKey: string | null;
  candidates: Array<{ itemKey: string; score: number; reason: string }>;
  reason: string;
};

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function words(value: string | null | undefined) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [])].sort();
}

function trigramSet(value: string) {
  const padded = `  ${value}  `;
  const set = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) set.add(padded.slice(index, index + 3));
  return set;
}

function trigramSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  const a = trigramSet(left);
  const b = trigramSet(right);
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function lexicalScore(query: ProductIdentityQuery, item: ProductIdentityItem) {
  const queryText = normalized(`${query.name ?? ""} ${query.description ?? ""}`);
  const itemText = normalized(`${item.name} ${item.description ?? ""}`);
  const trigram = trigramSimilarity(queryText, itemText);
  const queryWords = words(`${query.name ?? ""} ${query.description ?? ""}`);
  const itemWords = new Set(words(`${item.name} ${item.description ?? ""}`));
  const tokenOverlap = queryWords.length ? queryWords.filter((word) => itemWords.has(word)).length / queryWords.length : 0;
  return Number((trigram * 0.65 + tokenOverlap * 0.35).toFixed(6));
}

function uniqueMatch(items: ProductIdentityItem[], predicate: (item: ProductIdentityItem) => boolean) {
  return items.filter(predicate).sort((left, right) => left.itemKey.localeCompare(right.itemKey));
}

function exactResult(method: ProductIdentityResolution["method"], matches: ProductIdentityItem[], reason: string): ProductIdentityResolution | null {
  if (!matches.length) return null;
  if (matches.length === 1) {
    return { status: "RESOLVED", method, itemKey: matches[0]!.itemKey, candidates: [{ itemKey: matches[0]!.itemKey, score: 1, reason }], reason };
  }
  return {
    status: "REVIEW_REQUIRED",
    method,
    itemKey: null,
    candidates: matches.map((item) => ({ itemKey: item.itemKey, score: 1, reason })),
    reason: `${reason} matched more than one canonical item. A human must resolve the collision.`,
  };
}

export function resolveProductIdentity(args: {
  query: ProductIdentityQuery;
  items: ProductIdentityItem[];
  aliases?: ProductIdentityAlias[];
  vectorCandidates?: ProductIdentityVectorCandidate[];
}): ProductIdentityResolution {
  const items = [...args.items].sort((left, right) => left.itemKey.localeCompare(right.itemKey));
  const queryExternal = normalized(args.query.externalId);
  const querySku = normalized(args.query.sku);
  const direct = exactResult(
    "EXTERNAL_ID_OR_SKU",
    uniqueMatch(items, (item) => Boolean(
      (queryExternal && normalized(item.externalId) === queryExternal)
      || (querySku && normalized(item.sku) === querySku),
    )),
    "Exact ERP external ID or SKU",
  );
  if (direct) return direct;

  const manufacturer = normalized(args.query.manufacturer);
  const mpn = normalized(args.query.mpn);
  if (manufacturer && mpn) {
    const match = exactResult(
      "MANUFACTURER_MPN",
      uniqueMatch(items, (item) => normalized(item.manufacturer) === manufacturer && normalized(item.mpn) === mpn),
      "Exact manufacturer and MPN",
    );
    if (match) return match;
  }

  const gtin = normalized(args.query.gtin);
  if (gtin) {
    const match = exactResult("GTIN_OR_ALIAS", uniqueMatch(items, (item) => normalized(item.gtin) === gtin), "Exact GTIN");
    if (match) return match;
  }
  const aliasValues = [queryExternal, querySku, gtin, normalized(args.query.name)].filter(Boolean);
  const aliasMatches = [...new Set((args.aliases ?? [])
    .filter((alias) => alias.approved && aliasValues.includes(normalized(alias.aliasValue)))
    .map((alias) => alias.canonicalItemKey))]
    .sort()
    .flatMap((itemKey) => items.filter((item) => item.itemKey === itemKey));
  const alias = exactResult("GTIN_OR_ALIAS", aliasMatches, "Approved alias");
  if (alias) return alias;

  const lexical = items
    .map((item) => ({ itemKey: item.itemKey, score: lexicalScore(args.query, item), reason: "Full-text and trigram candidate" }))
    .filter((candidate) => candidate.score >= 0.55)
    .sort((left, right) => right.score - left.score || left.itemKey.localeCompare(right.itemKey))
    .slice(0, 8);
  if (lexical.length) {
    return {
      status: "REVIEW_REQUIRED",
      method: "LEXICAL",
      itemKey: null,
      candidates: lexical,
      reason: "Lexical similarity can nominate candidates but cannot publish a merge or BOM relationship.",
    };
  }

  const vectors = [...(args.vectorCandidates ?? [])]
    .filter((candidate) => Number.isFinite(candidate.similarity) && candidate.similarity >= 0.7 && items.some((item) => item.itemKey === candidate.itemKey))
    .sort((left, right) => right.similarity - left.similarity || left.itemKey.localeCompare(right.itemKey))
    .slice(0, 8)
    .map((candidate) => ({ itemKey: candidate.itemKey, score: candidate.similarity, reason: "Optional Postgres vector proposal" }));
  if (vectors.length) {
    return {
      status: "REVIEW_REQUIRED",
      method: "VECTOR_PROPOSAL",
      itemKey: null,
      candidates: vectors,
      reason: "Vector similarity is an unresolved-description aid only. A human must approve the identity decision.",
    };
  }

  return { status: "UNRESOLVED", method: "NONE", itemKey: null, candidates: [], reason: "No deterministic product identity match was found." };
}

export function canPublishIdentityResolution(resolution: ProductIdentityResolution) {
  return resolution.status === "RESOLVED" && Boolean(resolution.itemKey)
    && ["EXTERNAL_ID_OR_SKU", "MANUFACTURER_MPN", "GTIN_OR_ALIAS"].includes(resolution.method);
}
