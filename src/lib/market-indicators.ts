// Open-data market baseline for the US domestic trucking wedge.
// Keyless public feeds only: FRED (diesel, trucking PPI, freight TSI) and the
// FMCSA company census on Socrata (CA carrier-supply counts). Fetchers lean on
// Next's data cache with generous revalidate windows; every fetch fails soft so
// the pricing page never blocks on a third-party feed. Pure parsing/summary
// helpers are exported for DB-free tests. Full source catalog + raw pulls:
// .context/intelligence/ (workspace).

export type SeriesPoint = [date: string, value: number];

// FRED keyless CSV: "observation_date,SERIES\n1994-03-21,1.106\n…" ("." = missing).
export function parseFredCsv(text: string): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const value = Number(line.slice(comma + 1).trim());
    if (!Number.isFinite(value)) continue;
    out.push([date, value]);
  }
  return out;
}

export type IndicatorSummary = {
  value: number;
  asOf: string;
  yoyPct: number | null;
  ytdPct: number | null;
};

function pctChange(now: number, then: number): number | null {
  if (then === 0) return null;
  return 100 * (now / then - 1);
}

// Latest value + YoY (latest point in the same calendar month one year back —
// works for weekly and monthly series alike) + YTD (vs the year's first point).
export function summarizeSeries(series: SeriesPoint[]): IndicatorSummary | null {
  if (series.length === 0) return null;
  const [asOf, value] = series[series.length - 1];

  const priorMonth = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4, 7)}`;
  let prior: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const [date, v] = series[i];
    const month = date.slice(0, 7);
    if (month === priorMonth) {
      prior = v;
      break;
    }
    if (month < priorMonth) break;
  }

  const first = series.find(([date]) => date.slice(0, 4) === asOf.slice(0, 4)) ?? null;

  return {
    value,
    asOf,
    yoyPct: prior != null ? pctChange(value, prior) : null,
    ytdPct: first && first[0] !== asOf ? pctChange(value, first[1]) : null,
  };
}

export type MarketIndicator = {
  key: string;
  label: string;
  display: string;
  asOf: string | null;
  yoyPct: number | null;
  ytdPct: number | null;
  source: string;
};

export function formatIndicatorValue(value: number, unit: "usd_gal" | "index" | "count", decimals: number): string {
  if (unit === "usd_gal") return `$${value.toFixed(decimals)}/gal`;
  if (unit === "count") return Math.round(value).toLocaleString("en-US");
  return value.toFixed(decimals);
}

const FRED_INDICATORS = [
  { id: "GASDESW", key: "diesel_us", label: "US diesel", unit: "usd_gal", decimals: 2 },
  { id: "PCU4841214841212", key: "ppi_tl", label: "PPI · TL long-distance", unit: "index", decimals: 1 },
  { id: "TSIFRGHT", key: "tsi_freight", label: "Freight volume (TSI)", unit: "index", decimals: 1 },
] as const;

const FMCSA_BASE = "https://data.transportation.gov/resource/az4n-8mr2.json";
const CA_FORHIRE = "phy_state='CA' AND status_code='A' AND classdef like '%AUTHORIZED FOR HIRE%'";

const FMCSA_COUNTS = [
  {
    key: "ca_midsize",
    label: "CA for-hire · 5–100 trucks",
    where: `${CA_FORHIRE} AND power_units::number between 5 and 100`,
  },
  {
    key: "ca_hazmat_midsize",
    label: "CA hazmat · 5–100 trucks",
    where: `${CA_FORHIRE} AND hm_ind='Y' AND power_units::number between 5 and 100`,
  },
] as const;

const FRED_REVALIDATE_SECONDS = 6 * 60 * 60; // weekly/monthly series — 6h is plenty
const FMCSA_REVALIDATE_SECONDS = 24 * 60 * 60; // census refreshes ~monthly
const FETCH_TIMEOUT_MS = 8000;

async function fetchText(url: string, revalidate: number): Promise<string> {
  const res = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchFredIndicator(spec: (typeof FRED_INDICATORS)[number]): Promise<MarketIndicator | null> {
  const text = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${spec.id}`, FRED_REVALIDATE_SECONDS);
  const summary = summarizeSeries(parseFredCsv(text));
  if (!summary) return null;
  return {
    key: spec.key,
    label: spec.label,
    display: formatIndicatorValue(summary.value, spec.unit, spec.decimals),
    asOf: summary.asOf,
    yoyPct: summary.yoyPct,
    ytdPct: spec.key === "diesel_us" ? summary.ytdPct : null,
    source: `FRED ${spec.id}`,
  };
}

async function fetchFmcsaCount(spec: (typeof FMCSA_COUNTS)[number]): Promise<MarketIndicator | null> {
  const url = `${FMCSA_BASE}?$select=count(1) as n&$where=${encodeURIComponent(spec.where)}`;
  const text = await fetchText(url, FMCSA_REVALIDATE_SECONDS);
  const rows = JSON.parse(text) as Array<{ n?: string }>;
  const value = Number(rows[0]?.n);
  if (!Number.isFinite(value)) return null;
  return {
    key: spec.key,
    label: spec.label,
    display: formatIndicatorValue(value, "count", 0),
    asOf: null, // census snapshot — the portal does not date the extract
    yoyPct: null,
    ytdPct: null,
    source: "FMCSA census",
  };
}

export type MarketBaselineResult = {
  indicators: MarketIndicator[];
  failures: string[];
};

// Never throws — failed feeds are reported by name and simply omitted.
export async function fetchMarketBaseline(): Promise<MarketBaselineResult> {
  const jobs: Array<{ name: string; run: () => Promise<MarketIndicator | null> }> = [
    ...FRED_INDICATORS.map((spec) => ({ name: spec.label, run: () => fetchFredIndicator(spec) })),
    ...FMCSA_COUNTS.map((spec) => ({ name: spec.label, run: () => fetchFmcsaCount(spec) })),
  ];
  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const indicators: MarketIndicator[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) indicators.push(result.value);
    else failures.push(jobs[index].name);
  });
  return { indicators, failures };
}
