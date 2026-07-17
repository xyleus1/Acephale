// Open-data market baseline for the US domestic trucking wedge.
// Keyless public feeds: FRED (diesel, trucking PPI, freight TSI) and the FMCSA
// company census on Socrata (CA carrier-supply counts). Key-gated free feeds
// (skipped silently when the env var is absent): EIA (California diesel,
// EIA_API_KEY) and US Census international trade (tech imports by HS code
// through the CA customs districts, CENSUS_API_KEY). Fetchers lean on Next's
// data cache with generous revalidate windows; every fetch fails soft so the
// pricing page never blocks on a third-party feed. Pure parsing/summary
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

// $543,839,378 -> "$544M"; $1,240,000,000 -> "$1.24B"
export function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e8) return `$${Math.round(value / 1e6)}M`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${Math.round(value)}`;
}

// EIA API v2 JSON -> chronological series. Rows arrive newest-first with
// string values; non-finite rows are dropped.
export function parseEiaSeries(text: string): SeriesPoint[] {
  const parsed = JSON.parse(text) as { response?: { data?: Array<{ period?: string; value?: unknown }> } };
  const rows = parsed.response?.data ?? [];
  const out: SeriesPoint[] = [];
  for (const row of rows) {
    if (!row.period || !/^\d{4}-\d{2}-\d{2}$/.test(row.period)) continue;
    if (row.value == null || row.value === "") continue; // Number(null) is 0 — a null print is missing, not free fuel
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    out.push([row.period, value]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

export type CensusPoint = {
  district: string;
  commodity: string;
  time: string; // "2026-03"
  value: number;
};

// Census trade API returns an array-of-arrays with a header row; columns are
// resolved by name so `get=` ordering never matters.
export function parseCensusTable(text: string): CensusPoint[] {
  const parsed = JSON.parse(text) as string[][];
  if (!Array.isArray(parsed) || parsed.length < 2) return [];
  const header = parsed[0];
  const districtIdx = header.indexOf("DISTRICT");
  const valueIdx = header.indexOf("GEN_VAL_MO");
  const commodityIdx = header.indexOf("I_COMMODITY");
  const timeIdx = header.indexOf("time");
  if (districtIdx < 0 || valueIdx < 0 || commodityIdx < 0 || timeIdx < 0) return [];
  const out: CensusPoint[] = [];
  for (const row of parsed.slice(1)) {
    const value = Number(row[valueIdx]);
    if (!Number.isFinite(value)) continue;
    out.push({ district: row[districtIdx], commodity: row[commodityIdx], time: row[timeIdx], value });
  }
  return out;
}

export const TECH_HS_CODES = [
  ["8471", "Computers & servers"],
  ["8542", "Semiconductors"],
  ["8517", "Networking gear"],
  ["8507", "Batteries"],
  ["8486", "Semicap equipment"],
  ["9027", "Instruments"],
] as const;

// CA customs districts: San Diego (25), Los Angeles (27), San Francisco (28).
export const CA_CUSTOMS_DISTRICTS = ["25", "27", "28"];

export type TechImportsSummary = {
  latestMonth: string;
  totalValue: number;
  totalYoyPct: number | null;
  byCommodity: Array<{ code: string; label: string; value: number; yoyPct: number | null }>;
};

// Aggregate CA-district tech imports for the newest month present, with YoY
// against the same month a year earlier. Pure — feed it parseCensusTable rows.
export function summarizeTechImports(points: CensusPoint[]): TechImportsSummary | null {
  const ca = points.filter((p) => CA_CUSTOMS_DISTRICTS.includes(p.district));
  if (ca.length === 0) return null;
  const latestMonth = ca.reduce((max, p) => (p.time > max ? p.time : max), ca[0].time);
  const priorMonth = `${Number(latestMonth.slice(0, 4)) - 1}${latestMonth.slice(4)}`;

  const sumBy = (month: string, code?: string) =>
    ca.reduce((sum, p) => (p.time === month && (!code || p.commodity === code) ? sum + p.value : sum), 0);
  const hasMonth = (month: string) => ca.some((p) => p.time === month);

  const total = sumBy(latestMonth);
  const priorTotal = hasMonth(priorMonth) ? sumBy(priorMonth) : null;

  const byCommodity = TECH_HS_CODES
    .map(([code, label]) => {
      const value = sumBy(latestMonth, code);
      const prior = priorTotal != null ? sumBy(priorMonth, code) : null;
      return {
        code,
        label,
        value,
        yoyPct: prior != null && prior > 0 ? 100 * (value / prior - 1) : null,
      };
    })
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    latestMonth,
    totalValue: total,
    totalYoyPct: priorTotal != null && priorTotal > 0 ? 100 * (total / priorTotal - 1) : null,
    byCommodity,
  };
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

// ~2.5 years of weekly prints — enough history for YoY + YTD.
const EIA_SERIES_LENGTH = 130;

async function fetchEiaCaDiesel(apiKey: string): Promise<MarketIndicator | null> {
  const url =
    "https://api.eia.gov/v2/petroleum/pri/gnd/data/?" +
    `api_key=${encodeURIComponent(apiKey)}&frequency=weekly&data[0]=value` +
    "&facets[series][]=EMD_EPD2D_PTE_SCA_DPG" +
    `&sort[0][column]=period&sort[0][direction]=desc&length=${EIA_SERIES_LENGTH}`;
  const text = await fetchText(url, FRED_REVALIDATE_SECONDS);
  const summary = summarizeSeries(parseEiaSeries(text));
  if (!summary) return null;
  return {
    key: "diesel_ca",
    label: "CA diesel",
    display: formatIndicatorValue(summary.value, "usd_gal", 2),
    asOf: summary.asOf,
    yoyPct: summary.yoyPct,
    ytdPct: summary.ytdPct,
    source: "EIA EMD_EPD2D_PTE_SCA_DPG",
  };
}

const CENSUS_REVALIDATE_SECONDS = 24 * 60 * 60; // monthly stats, ~2-month publication lag

async function fetchCensusTechImports(apiKey: string): Promise<TechImportsSummary | null> {
  const from = `${new Date().getFullYear() - 1}-01`;
  const tables = await Promise.all(
    TECH_HS_CODES.map(([code]) => {
      const url =
        "https://api.census.gov/data/timeseries/intltrade/imports/hs?" +
        `get=DISTRICT,GEN_VAL_MO&I_COMMODITY=${code}` +
        `&time=${encodeURIComponent(`from ${from}`)}&key=${encodeURIComponent(apiKey)}`;
      return fetchText(url, CENSUS_REVALIDATE_SECONDS);
    })
  );
  return summarizeTechImports(tables.flatMap(parseCensusTable));
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
  customs: TechImportsSummary | null;
  failures: string[];
};

// Never throws — failed feeds are reported by name and simply omitted.
// Key-gated feeds are skipped (not failed) when the env var is missing.
export async function fetchMarketBaseline(): Promise<MarketBaselineResult> {
  const eiaKey = process.env.EIA_API_KEY;
  const censusKey = process.env.CENSUS_API_KEY;

  const jobs: Array<{ name: string; run: () => Promise<MarketIndicator | null> }> = [
    ...FRED_INDICATORS.map((spec) => ({ name: spec.label, run: () => fetchFredIndicator(spec) })),
    ...(eiaKey ? [{ name: "CA diesel (EIA)", run: () => fetchEiaCaDiesel(eiaKey) }] : []),
    ...FMCSA_COUNTS.map((spec) => ({ name: spec.label, run: () => fetchFmcsaCount(spec) })),
  ];

  const [settled, customsResult] = await Promise.all([
    Promise.allSettled(jobs.map((job) => job.run())),
    censusKey
      ? fetchCensusTechImports(censusKey).then(
          (summary) => ({ summary, failed: false }),
          () => ({ summary: null, failed: true })
        )
      : Promise.resolve({ summary: null, failed: false }),
  ]);

  const indicators: MarketIndicator[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) indicators.push(result.value);
    else failures.push(jobs[index].name);
  });
  if (customsResult.failed) failures.push("CA tech imports (Census)");

  // CA diesel reads better next to US diesel — keep the fuel pair adjacent.
  indicators.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return { indicators, customs: customsResult.summary, failures };
}

const ORDER = ["diesel_us", "diesel_ca", "ppi_tl", "tsi_freight", "ca_midsize", "ca_hazmat_midsize"];
