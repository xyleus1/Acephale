// Pre-flight fact enrichment: after the deterministic rule engine runs, pull
// REAL numbers from free government sources so the report cites data a generic
// chatbot can't - actual MFN duty rates + Section 301 markers (USITC HTS),
// citable classification precedent (CBP CROSS rulings), and the matched
// carriers' actual insurance filings (FMCSA L&I). Every fetch is cached and
// fail-soft: enrichment can only ADD facts, never block or break a check.
// Pure parsers are exported for DB-free tests.

import { fetchIntelSourceText } from "../fetch";
import type { BenchCarrier, IntelFact, LoadCheckResult, LoadIdea } from "./engine";

// ── Commodity → HTS heading + CROSS search term ─────────────────────────────
const COMMODITY_TRADE_MAP: Record<string, { hts4: string; crossTerm: string }> = {
  servers_gpu: { hts4: "8471", crossTerm: "GPU server" },
  semicap_tools: { hts4: "8486", crossTerm: "semiconductor manufacturing equipment" },
  networking: { hts4: "8517", crossTerm: "network switch" },
  batteries_un3480: { hts4: "8507", crossTerm: "lithium-ion battery" },
  batteries_un3481: { hts4: "8507", crossTerm: "lithium-ion battery" },
  robotics: { hts4: "8479", crossTerm: "industrial robot" },
  test_instruments: { hts4: "9027", crossTerm: "laboratory instrument" },
  medical_devices: { hts4: "9018", crossTerm: "medical device" },
};

// Section 301 chapter-99 headings → list labels. Historical rates; the action
// copy hedges because several were modified in the 2024-25 review.
const S301_HEADINGS: Array<[RegExp, string]> = [
  [/9903\.88\.0?1/, "List 1 marker"],
  [/9903\.88\.0?2/, "List 2 marker"],
  [/9903\.88\.0?3/, "List 3 marker"],
  [/9903\.88\.0?4/, "List 3 marker"],
  [/9903\.88\.15/, "List 4A marker"],
  [/9903\.91\.\d{2}/, "2024-25 review action"],
];

// ── Pure parsers (fixture-tested) ───────────────────────────────────────────

export type HtsDutySummary = {
  hts4: string;
  rates: string[]; // distinct MFN "general" rates seen under the heading
  s301: string[]; // matched Section 301 list labels from footnotes
};

export function parseHtsEntries(text: string, hts4: string): HtsDutySummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rates = new Set<string>();
  const s301 = new Set<string>();
  for (const row of parsed as Array<{ htsno?: string | null; general?: string | null; footnotes?: unknown }>) {
    if (!row.htsno || !row.htsno.startsWith(hts4)) continue;
    const general = row.general?.trim();
    if (general) rates.add(general);
    // Footnote shape is undocumented - scan its JSON for chapter-99 headings.
    const footnoteText = row.footnotes ? JSON.stringify(row.footnotes) : "";
    for (const [pattern, label] of S301_HEADINGS) {
      if (pattern.test(footnoteText)) s301.add(label);
    }
  }
  if (rates.size === 0 && s301.size === 0) return null;
  return { hts4, rates: [...rates].slice(0, 4), s301: [...s301] };
}

export type CrossRuling = {
  number: string;
  subject: string;
  date: string; // YYYY-MM-DD
};

// mustMatch: DATE_DESC search matches full ruling text, so the newest hit can
// be about a seed spreader that merely mentions a battery - require at least
// one term token in the SUBJECT before citing a ruling as precedent.
export function parseCrossRulings(text: string, mustMatch?: string[]): CrossRuling | null {
  let parsed: { rulings?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  for (const ruling of parsed.rulings ?? []) {
    if (ruling.operationallyRevoked === true) continue;
    if (Array.isArray(ruling.revokedBy) && ruling.revokedBy.length > 0) continue;
    if (Array.isArray(ruling.modifiedBy) && ruling.modifiedBy.length > 0) continue;
    const number = typeof ruling.rulingNumber === "string" ? ruling.rulingNumber : null;
    const subject = typeof ruling.subject === "string" ? ruling.subject : "";
    if (!number) continue;
    if (mustMatch && mustMatch.length > 0) {
      const haystack = subject.toLowerCase();
      if (!mustMatch.some((token) => haystack.includes(token.toLowerCase()))) continue;
    }
    const date = typeof ruling.rulingDate === "string" ? ruling.rulingDate.slice(0, 10) : "";
    return { number, subject: subject.slice(0, 110), date };
  }
  return null;
}

export type LiFiling = {
  formCode: string;
  type: string; // e.g. "BIPD/Primary", "Cargo"
  insurer: string;
  policyNumber: string | null;
  transactionDate: string | null;
  effectiveDate: string | null;
  coverageUsd: number | null; // max_cov_amount arrives in $ thousands
  cancelEffective: string | null; // MM/DD/YYYY as filed
};

export type LiDatasetFreshness = {
  dataAsOf: string | null;
  catalogRowsUpdatedAt: string | null;
  discontinued: boolean;
  conflictingSignals: boolean;
};

export function parseLiDatasetFreshness(text: string): LiDatasetFreshness {
  let parsed: { rowsUpdatedAt?: unknown; description?: unknown };
  try {
    parsed = JSON.parse(text) as { rowsUpdatedAt?: unknown; description?: unknown };
  } catch {
    return { dataAsOf: null, catalogRowsUpdatedAt: null, discontinued: false, conflictingSignals: false };
  }

  const rowsUpdatedSeconds = Number(parsed.rowsUpdatedAt);
  const catalogRowsUpdatedAt = Number.isFinite(rowsUpdatedSeconds) && rowsUpdatedSeconds > 0
    ? new Date(rowsUpdatedSeconds * 1000).toISOString().slice(0, 10)
    : null;
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const refreshMatch = description.match(/last refreshed on\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const declaredLastRefresh = refreshMatch
    ? `${refreshMatch[3]}-${refreshMatch[1]}-${refreshMatch[2]}`
    : null;
  const discontinued = /will no longer be updated/i.test(description);
  return {
    dataAsOf: declaredLastRefresh ?? catalogRowsUpdatedAt,
    catalogRowsUpdatedAt,
    discontinued,
    conflictingSignals: Boolean(
      discontinued &&
      declaredLastRefresh &&
      catalogRowsUpdatedAt &&
      catalogRowsUpdatedAt > declaredLastRefresh
    ),
  };
}

export function parseLiFilings(text: string): LiFiling[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return (parsed as Array<Record<string, unknown>>).map((row) => {
    const amountK = Number(row.max_cov_amount);
    return {
      formCode: typeof row.ins_form_code === "string" ? row.ins_form_code : "unknown",
      type: typeof row.mod_col_1 === "string" ? row.mod_col_1 : "unknown",
      insurer: typeof row.name_company === "string" ? row.name_company : "unknown insurer",
      policyNumber: typeof row.policy_no === "string" ? row.policy_no : null,
      transactionDate: typeof row.trans_date === "string" ? row.trans_date : null,
      effectiveDate: typeof row.effective_date === "string" ? row.effective_date : null,
      coverageUsd: Number.isFinite(amountK) && amountK > 0 ? amountK * 1000 : null,
      cancelEffective: typeof row.cancl_effective_date === "string" ? row.cancl_effective_date : null,
    };
  });
}

function fmcsaDate(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  return Number.isNaN(timestamp) ? null : timestamp;
}

export type LiFilingStatus = "active" | "pending" | "inactive" | "unknown";

export function liFilingStatus(filing: LiFiling, now: Date): LiFilingStatus {
  const effectiveAt = fmcsaDate(filing.effectiveDate);
  const cancelAt = fmcsaDate(filing.cancelEffective);
  if (effectiveAt == null) return "unknown";
  if (effectiveAt > now.getTime()) return "pending";
  if (cancelAt != null && cancelAt <= now.getTime()) return "inactive";
  return "active";
}

export function selectActiveLiFilings(filings: readonly LiFiling[], now: Date): LiFiling[] {
  const latestByPolicy = new Map<string, LiFiling>();
  for (const filing of filings) {
    const key = [filing.formCode, filing.policyNumber ?? "", filing.type, filing.insurer].join("|");
    const current = latestByPolicy.get(key);
    const currentTransaction = current ? fmcsaDate(current.transactionDate) ?? 0 : -1;
    const nextTransaction = fmcsaDate(filing.transactionDate) ?? 0;
    if (!current || nextTransaction >= currentTransaction) latestByPolicy.set(key, filing);
  }
  return [...latestByPolicy.values()].filter((filing) => liFilingStatus(filing, now) === "active");
}

// A cancellation only warrants a warning when it lands soon - L&I rows carry
// far-future term dates in the same column.
export function cancellationWarning(filing: LiFiling, now: Date): string | null {
  const at = fmcsaDate(filing.cancelEffective);
  if (at == null) return null;
  const days = Math.round((at - now.getTime()) / 86_400_000);
  if (days < 0 || days > 60) return null;
  return `⚠ cancellation effective ${filing.cancelEffective} (${days}d) filed - re-verify before dispatch`;
}

// ── Cached fetchers ─────────────────────────────────────────────────────────

async function htsDutyFact(hts4: string, chinaOrigin: boolean): Promise<IntelFact | null> {
  const sourceUrl = `https://hts.usitc.gov/reststop/search?keyword=${encodeURIComponent(hts4)}`;
  const response = await fetchIntelSourceText({
    sourceId: "usitc_hts",
    requestUrl: sourceUrl,
    sourceUrl,
    timeoutMs: 15_000,
  });
  const summary = parseHtsEntries(response.text, hts4);
  if (!summary) return null;
  const rates = summary.rates.join(" / ");
  let line = rates
    ? `HTS heading ${hts4} returned possible MFN rates ${rates}; the exact duty requires an 8 or 10 digit classification`
    : `HTS heading ${hts4} returned chapter-99 markers but no usable MFN rate`;
  if (chinaOrigin) {
    if (summary.s301.length > 0) {
      line += `; China-origin subheadings include ${summary.s301.join(", ")}, but this heading scan does not establish applicability or the current surcharge`;
    } else {
      line += "; no Section 301 marker appeared in this heading scan";
    }
  }
  line += "; verify the full classification and current rate with the broker of record";
  return {
    id: `hts-duty-${hts4}`,
    text: line,
    sources: [{
      sourceId: response.sourceId,
      sourceUrl: response.sourceUrl,
      asOf: null,
      fetchedAt: response.fetchedAt,
      reviewedAt: response.reviewedAt,
    }],
  };
}

async function crossRulingFact(term: string): Promise<IntelFact | null> {
  const requestUrl = `https://rulings.cbp.gov/api/search?term=${encodeURIComponent(term)}&collection=ALL&pageSize=10&sortBy=DATE_DESC`;
  const response = await fetchIntelSourceText({
    sourceId: "cbp_cross",
    requestUrl,
    sourceUrl: `https://rulings.cbp.gov/search?term=${encodeURIComponent(term)}`,
  });
  const tokens = term.split(/\s+/).filter((word) => word.length >= 3);
  const ruling = parseCrossRulings(response.text, tokens);
  if (!ruling) return null;
  return {
    id: `cbp-ruling-${ruling.number}`,
    text: `Classification precedent: CBP ruling ${ruling.number} (${ruling.date}) - “${ruling.subject}” - rulings.cbp.gov/ruling/${ruling.number}`,
    sources: [{
      sourceId: response.sourceId,
      sourceUrl: `https://rulings.cbp.gov/ruling/${encodeURIComponent(ruling.number)}`,
      asOf: ruling.date || null,
      fetchedAt: response.fetchedAt,
      reviewedAt: response.reviewedAt,
    }],
  };
}

async function liInsuranceFact(carrier: { name: string; dotNumber: string }, now: Date): Promise<IntelFact | null> {
  const dot = carrier.dotNumber.replace(/\D/g, "").padStart(8, "0");
  if (!/^\d{8}$/.test(dot)) return null;
  const sourceUrl = `https://data.transportation.gov/resource/qh9u-swkp.json?dot_number=${dot}&$limit=1000`;
  const [response, metadataResponse] = await Promise.all([
    fetchIntelSourceText({
      sourceId: "fmcsa_li",
      requestUrl: sourceUrl,
      sourceUrl,
    }),
    fetchIntelSourceText({
      sourceId: "fmcsa_li",
      requestUrl: "https://data.transportation.gov/api/views/qh9u-swkp",
      sourceUrl: "https://data.transportation.gov/api/views/qh9u-swkp",
    }).catch(() => null),
  ]);
  const filings = parseLiFilings(response.text);
  const activeFilings = selectActiveLiFilings(filings, now);
  const pendingCount = filings.filter((filing) => liFilingStatus(filing, now) === "pending").length;
  const freshness = metadataResponse
    ? parseLiDatasetFreshness(metadataResponse.text)
    : { dataAsOf: null, catalogRowsUpdatedAt: null, discontinued: false, conflictingSignals: false };
  const freshnessNote = freshness.conflictingSignals
    ? `FMCSA's catalog says this file stopped refreshing after ${freshness.dataAsOf}, although its catalog rows changed on ${freshness.catalogRowsUpdatedAt}; treat it as potentially stale and verify in FMCSA L&I before dispatch`
    : freshness.discontinued
      ? `FMCSA's catalog says this file stopped refreshing after ${freshness.dataAsOf ?? "an unspecified date"}; verify in FMCSA L&I before dispatch`
      : freshness.dataAsOf
        ? `dataset as of ${freshness.dataAsOf}`
        : "dataset date unavailable; verify in FMCSA L&I before dispatch";
  const filingText =
    activeFilings.length === 0
      ? `${carrier.name}: no active filing could be identified in the returned FMCSA L&I history for DOT ${carrier.dotNumber}${pendingCount > 0 ? `; ${pendingCount} future-effective filing(s) do not prove current coverage` : ""} - verify with the producer and FMCSA L&I`
      : `${carrier.name} (FMCSA L&I): ${activeFilings
          .slice(0, 3)
          .map((filing) => {
            const amount = filing.coverageUsd != null ? `$${Math.round(filing.coverageUsd / 1000)}k` : "amount n/a";
            const warn = cancellationWarning(filing, now);
            return `${filing.type} ${amount} w/ ${filing.insurer}${warn ? ` ${warn}` : ""}`;
          })
          .join("; ")}`;
  const text = `${filingText}. ${freshnessNote}.`;
  return {
    id: `fmcsa-li-${dot}`,
    text,
    sources: [
      {
        sourceId: response.sourceId,
        sourceUrl: response.sourceUrl,
        asOf: freshness.dataAsOf,
        fetchedAt: response.fetchedAt,
        reviewedAt: response.reviewedAt,
      },
      ...(metadataResponse
        ? [{
            sourceId: metadataResponse.sourceId,
            sourceUrl: metadataResponse.sourceUrl,
            asOf: freshness.catalogRowsUpdatedAt,
            fetchedAt: metadataResponse.fetchedAt,
            reviewedAt: metadataResponse.reviewedAt,
          }]
        : []),
    ],
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

// Returns fact lines to attach to the pre-flight result. Fail-soft per fact.
export async function enrichLoadCheck(
  idea: LoadIdea,
  result: LoadCheckResult,
  matchedCarriers: Array<Pick<BenchCarrier, "name" | "dotNumber">>,
  now: Date
): Promise<IntelFact[]> {
  const trade = idea.commodityCategory ? COMMODITY_TRADE_MAP[idea.commodityCategory] : undefined;
  const chinaOrigin = Boolean(
    idea.originCountry && idea.originCountry.toLowerCase().includes("china") && !idea.originCountry.toLowerCase().includes("taiwan")
  );

  const jobs: Array<Promise<IntelFact | null>> = [];
  if (trade && idea.inboundInternational) jobs.push(htsDutyFact(trade.hts4, chinaOrigin));
  if (trade && (idea.inboundInternational || idea.exportBound)) jobs.push(crossRulingFact(trade.crossTerm));
  for (const carrier of matchedCarriers.slice(0, 3)) {
    if (carrier.dotNumber) jobs.push(liInsuranceFact({ name: carrier.name, dotNumber: carrier.dotNumber }, now));
  }
  if (jobs.length === 0) return [];

  const settled = await Promise.allSettled(jobs);
  return settled
    .map((entry) => (entry.status === "fulfilled" ? entry.value : null))
    .filter((fact): fact is IntelFact => Boolean(fact));
}
