// Pre-flight fact enrichment: after the deterministic rule engine runs, pull
// REAL numbers from free government sources so the report cites data a generic
// chatbot can't — actual MFN duty rates + Section 301 markers (USITC HTS),
// citable classification precedent (CBP CROSS rulings), and the matched
// carriers' actual insurance filings (FMCSA L&I). Every fetch is cached and
// fail-soft: enrichment can only ADD facts, never block or break a check.
// Pure parsers are exported for DB-free tests.

import type { BenchCarrier, LoadCheckResult, LoadIdea } from "@/lib/load-check";

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
  [/9903\.88\.0?1/, "List 1 (25%)"],
  [/9903\.88\.0?2/, "List 2 (25%)"],
  [/9903\.88\.0?3/, "List 3 (25%)"],
  [/9903\.88\.0?4/, "List 3 (25%)"],
  [/9903\.88\.15/, "List 4A (7.5%)"],
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
    // Footnote shape is undocumented — scan its JSON for chapter-99 headings.
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
// be about a seed spreader that merely mentions a battery — require at least
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
  type: string; // e.g. "BIPD/Primary", "Cargo"
  insurer: string;
  coverageUsd: number | null; // max_cov_amount arrives in $ thousands
  cancelEffective: string | null; // MM/DD/YYYY as filed
};

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
      type: typeof row.mod_col_1 === "string" ? row.mod_col_1 : "unknown",
      insurer: typeof row.name_company === "string" ? row.name_company : "unknown insurer",
      coverageUsd: Number.isFinite(amountK) && amountK > 0 ? amountK * 1000 : null,
      cancelEffective: typeof row.cancl_effective_date === "string" ? row.cancl_effective_date : null,
    };
  });
}

// A cancellation only warrants a warning when it lands soon — L&I rows carry
// far-future term dates in the same column.
export function cancellationWarning(filing: LiFiling, now: Date): string | null {
  if (!filing.cancelEffective) return null;
  const match = filing.cancelEffective.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const at = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  const days = Math.round((at - now.getTime()) / 86_400_000);
  if (days < 0 || days > 60) return null;
  return `⚠ cancellation effective ${filing.cancelEffective} (${days}d) filed — re-verify before dispatch`;
}

// ── Cached fetchers ─────────────────────────────────────────────────────────

const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

async function fetchText(url: string, revalidate: number, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(timeoutMs),
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function htsDutyFact(hts4: string, chinaOrigin: boolean): Promise<string | null> {
  const text = await fetchText(`https://hts.usitc.gov/reststop/search?keyword=${hts4}`, WEEK, 15_000);
  const summary = parseHtsEntries(text, hts4);
  if (!summary) return null;
  const rates = summary.rates.length > 0 ? summary.rates.join(" / ") : "n/a";
  let line = `Duty, HTS ${hts4}: MFN ${rates} (USITC HTS)`;
  if (chinaOrigin) {
    if (summary.s301.length > 2) {
      // Heading-level scan hits several lists across subheadings — the exact
      // one depends on the 8/10-digit classification.
      const pcts = [...new Set(summary.s301.map((label) => label.match(/\(([^)]+)\)/)?.[1]).filter(Boolean))];
      line += `; China origin → Section 301 exposure across subheadings (${pcts.join(" / ")}) — the exact list depends on the full classification, verify current rate`;
    } else if (summary.s301.length > 0) {
      line += `; China origin → Section 301 ${summary.s301.join(", ")} — verify current rate, several changed in the 2024-25 review`;
    } else {
      line += `; no Section 301 marker in the HTS footnotes for this heading — verify with the broker of record`;
    }
  }
  return line;
}

async function crossRulingFact(term: string): Promise<string | null> {
  const url = `https://rulings.cbp.gov/api/search?term=${encodeURIComponent(term)}&collection=ALL&pageSize=10&sortBy=DATE_DESC`;
  const tokens = term.split(/\s+/).filter((word) => word.length >= 3);
  const ruling = parseCrossRulings(await fetchText(url, WEEK), tokens);
  if (!ruling) return null;
  return `Classification precedent: CBP ruling ${ruling.number} (${ruling.date}) — “${ruling.subject}” — rulings.cbp.gov/ruling/${ruling.number}`;
}

async function liInsuranceFact(carrier: { name: string; dotNumber: string }, now: Date): Promise<string | null> {
  const dot = carrier.dotNumber.replace(/\D/g, "").padStart(8, "0");
  if (!/^\d{8}$/.test(dot)) return null;
  const url = `https://data.transportation.gov/resource/qh9u-swkp.json?dot_number=${dot}&$limit=10`;
  const filings = parseLiFilings(await fetchText(url, DAY));
  if (filings.length === 0) return `${carrier.name}: no insurance filings found under DOT ${carrier.dotNumber} in FMCSA L&I — verify with the producer`;
  const parts = filings.slice(0, 3).map((filing) => {
    const amount = filing.coverageUsd != null ? `$${Math.round(filing.coverageUsd / 1000)}k` : "amount n/a";
    const warn = cancellationWarning(filing, now);
    return `${filing.type} ${amount} w/ ${filing.insurer}${warn ? ` ${warn}` : ""}`;
  });
  return `${carrier.name} (FMCSA L&I): ${parts.join("; ")}`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

// Returns fact lines to attach to the pre-flight result. Fail-soft per fact.
export async function enrichLoadCheck(
  idea: LoadIdea,
  result: LoadCheckResult,
  matchedCarriers: Array<Pick<BenchCarrier, "name" | "dotNumber">>,
  now: Date
): Promise<string[]> {
  const trade = idea.commodityCategory ? COMMODITY_TRADE_MAP[idea.commodityCategory] : undefined;
  const chinaOrigin = Boolean(
    idea.originCountry && idea.originCountry.toLowerCase().includes("china") && !idea.originCountry.toLowerCase().includes("taiwan")
  );

  const jobs: Array<Promise<string | null>> = [];
  if (trade && idea.inboundInternational) jobs.push(htsDutyFact(trade.hts4, chinaOrigin));
  if (trade && (idea.inboundInternational || idea.exportBound)) jobs.push(crossRulingFact(trade.crossTerm));
  for (const carrier of matchedCarriers.slice(0, 3)) {
    if (carrier.dotNumber) jobs.push(liInsuranceFact({ name: carrier.name, dotNumber: carrier.dotNumber }, now));
  }
  if (jobs.length === 0) return [];

  const settled = await Promise.allSettled(jobs);
  return settled
    .map((entry) => (entry.status === "fulfilled" ? entry.value : null))
    .filter((line): line is string => Boolean(line));
}
