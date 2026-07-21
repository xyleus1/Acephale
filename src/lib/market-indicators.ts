// Open-data market baseline for the US domestic trucking wedge.
// Keyless public feeds: BLS (long-distance truckload PPI) and the FMCSA
// company census on Socrata (CA carrier-supply counts). Key-gated free feeds
// (skipped silently when the env var is absent): EIA (California diesel,
// EIA_API_KEY) and US Census international trade (tech imports by HS code
// through the CA customs districts, CENSUS_API_KEY). FRED was dropped -
// fredgraph.csv rejects requests from Vercel's datacenter IPs. Fetchers lean
// on Next's data cache with generous revalidate windows; every fetch fails
// soft so the page never blocks on a third-party feed. Pure parsing/summary
// helpers are exported for DB-free tests. Full source catalog + raw pulls:
// .context/intelligence/ (workspace).

export type SeriesPoint = [date: string, value: number];

// BLS public API v1 (keyless, ~last 3 years, monthly). Rows arrive
// newest-first; period "M13" is the annual average, not a month.
export function parseBlsSeries(text: string): SeriesPoint[] {
  const parsed = JSON.parse(text) as {
    Results?: { series?: Array<{ data?: Array<{ year?: string; period?: string; value?: string }> }> };
  };
  const rows = parsed.Results?.series?.[0]?.data ?? [];
  const out: SeriesPoint[] = [];
  for (const row of rows) {
    if (!row.year || !row.period || !/^M(0[1-9]|1[0-2])$/.test(row.period)) continue;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    out.push([`${row.year}-${row.period.slice(1)}-01`, value]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
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

// Latest value + YoY (latest point in the same calendar month one year back -
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
    if (row.value == null || row.value === "") continue; // Number(null) is 0 - a null print is missing, not free fuel
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
// against the same month a year earlier. Pure - feed it parseCensusTable rows.
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

const SERIES_REVALIDATE_SECONDS = 6 * 60 * 60; // weekly/monthly series - 6h is plenty
const FMCSA_REVALIDATE_SECONDS = 24 * 60 * 60; // census refreshes ~monthly
const FETCH_TIMEOUT_MS = 8000;

async function fetchText(url: string, revalidate: number, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(timeoutMs),
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// BLS keyless v1 allows ~25 requests/day per IP - trivially within budget at
// one cached call per 6h.
const BLS_PPI_SERIES = "PCU484121484121"; // PPI, general freight trucking long-distance TL

async function fetchBlsPpi(): Promise<MarketIndicator | null> {
  const text = await fetchText(
    `https://api.bls.gov/publicAPI/v1/timeseries/data/${BLS_PPI_SERIES}`,
    SERIES_REVALIDATE_SECONDS
  );
  const summary = summarizeSeries(parseBlsSeries(text));
  if (!summary) return null;
  return {
    key: "ppi_tl",
    label: "TL rate index (PPI)",
    display: formatIndicatorValue(summary.value, "index", 1),
    asOf: summary.asOf.slice(0, 7),
    yoyPct: summary.yoyPct,
    ytdPct: null,
    source: `BLS ${BLS_PPI_SERIES}`,
  };
}

// ~2.5 years of weekly prints - enough history for YoY + YTD.
const EIA_SERIES_LENGTH = 130;

async function fetchEiaCaDiesel(apiKey: string): Promise<MarketIndicator | null> {
  const url =
    "https://api.eia.gov/v2/petroleum/pri/gnd/data/?" +
    `api_key=${encodeURIComponent(apiKey)}&frequency=weekly&data[0]=value` +
    "&facets[series][]=EMD_EPD2D_PTE_SCA_DPG" +
    `&sort[0][column]=period&sort[0][direction]=desc&length=${EIA_SERIES_LENGTH}`;
  const text = await fetchText(url, SERIES_REVALIDATE_SECONDS);
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
// Census range queries run 5-10s each - the default 8s timeout was exactly
// why the customs section died on Vercel while everything else rendered.
const CENSUS_TIMEOUT_MS = 25_000;

// Firing all six commodity queries at once gets throttled (silent failures);
// two at a time stays reliable. Cold total ~20s, then cached for 24h.
const CENSUS_CONCURRENCY = 2;

async function fetchCensusTechImports(apiKey: string): Promise<TechImportsSummary | null> {
  // Need latest published month + the same month a year earlier (~2-month
  // lag), so ~13 months back is enough - a narrower range keeps queries fast.
  const now = new Date();
  const from = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const codes = TECH_HS_CODES.map(([code]) => code);
  const tables: string[] = [];
  for (let i = 0; i < codes.length; i += CENSUS_CONCURRENCY) {
    const batch = await Promise.all(
      codes.slice(i, i + CENSUS_CONCURRENCY).map((code) => {
        const url =
          "https://api.census.gov/data/timeseries/intltrade/imports/hs?" +
          `get=DISTRICT,GEN_VAL_MO&I_COMMODITY=${code}` +
          `&time=${encodeURIComponent(`from ${from}`)}&key=${encodeURIComponent(apiKey)}`;
        return fetchText(url, CENSUS_REVALIDATE_SECONDS, CENSUS_TIMEOUT_MS);
      })
    );
    tables.push(...batch);
  }
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
    asOf: null, // census snapshot - the portal does not date the extract
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

// Never throws - failed feeds are reported by name and simply omitted.
// Key-gated feeds are skipped (not failed) when the env var is missing.
export async function fetchMarketBaseline(): Promise<MarketBaselineResult> {
  const eiaKey = process.env.EIA_API_KEY;
  const censusKey = process.env.CENSUS_API_KEY;

  const jobs: Array<{ name: string; run: () => Promise<MarketIndicator | null> }> = [
    ...(eiaKey ? [{ name: "CA diesel (EIA)", run: () => fetchEiaCaDiesel(eiaKey) }] : []),
    { name: "TL rate index (BLS)", run: fetchBlsPpi },
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

  // CA diesel reads better next to US diesel - keep the fuel pair adjacent.
  indicators.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return { indicators, customs: customsResult.summary, failures };
}

const ORDER = ["diesel_ca", "ppi_tl", "ca_midsize", "ca_hazmat_midsize"];
