// Smoke test for the open-data market baseline parsing/summary helpers.
// Pure logic only - no network. Run: npx tsx scripts/market-indicators.test.ts

import {
  buildCensusSourceUsesByCommodity,
  formatIndicatorValue,
  formatUsdCompact,
  parseBlsSeries,
  parseCensusTable,
  parseEiaSeries,
  summarizeSeries,
  summarizeTechImports,
  type CensusPoint,
  type SeriesPoint,
} from "../src/lib/intel/market/indicators";
import { reviewedSourceUse } from "../src/lib/intel/sources";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

// parseBlsSeries: newest-first monthly rows -> chronological; M13 (annual avg) skipped.
const blsJson = JSON.stringify({
  Results: {
    series: [
      {
        data: [
          { year: "2026", period: "M06", value: "204.622" },
          { year: "2026", period: "M05", value: "203.944" },
          { year: "2025", period: "M13", value: "999" },
          { year: "2025", period: "M06", value: "168.4" },
          { year: "2025", period: "M07", value: "not-a-number" },
        ],
      },
    ],
  },
});
const bls = parseBlsSeries(blsJson);
check("bls parses monthly rows only", bls.length === 3);
check("bls skips the M13 annual average", !bls.some(([, v]) => v === 999));
check("bls sorts chronologically with month-first dates", bls[0][0] === "2025-06-01" && bls[2][1] === 204.622);
check("bls tolerates empty payload", parseBlsSeries("{}").length === 0);
check(
  "bls series yoy works through summarizeSeries",
  Math.abs(summarizeSeries(bls)!.yoyPct! - (100 * (204.622 / 168.4 - 1))) < 0.001
);

// summarizeSeries: YoY matches same calendar month a year back; YTD vs first point of the year.
const series: SeriesPoint[] = [
  ["2025-07-14", 3.807],
  ["2025-07-21", 3.9],
  ["2026-01-05", 3.477],
  ["2026-07-13", 4.796],
];
const summary = summarizeSeries(series);
check("summary exists", summary !== null);
check("latest value + date", summary!.value === 4.796 && summary!.asOf === "2026-07-13");
// YoY prior = latest 2025-07 point (3.9): 4.796/3.9 - 1 = 22.97%
check("yoy uses latest point of the prior-year month", Math.abs(summary!.yoyPct! - 22.974) < 0.01);
// YTD first 2026 point = 3.477: +37.9%
check("ytd uses first point of the current year", Math.abs(summary!.ytdPct! - 37.935) < 0.01);

const noPrior = summarizeSeries([["2026-06-01", 100], ["2026-07-01", 110]]);
check("yoy null when no prior-year month exists", noPrior!.yoyPct === null);
check("ytd computed within a single year", Math.abs(noPrior!.ytdPct! - 10) < 0.001);

const single = summarizeSeries([["2026-07-01", 100]]);
check("single point: yoy and ytd both null", single!.yoyPct === null && single!.ytdPct === null);

check("empty series summarizes to null", summarizeSeries([]) === null);

// Monthly series with an exact prior-year month.
const monthly = summarizeSeries([
  ["2025-06-01", 170.7],
  ["2025-07-01", 171.0],
  ["2026-06-01", 207.237],
]);
check("monthly yoy exact month match", Math.abs(monthly!.yoyPct! - (100 * (207.237 / 170.7 - 1))) < 0.001);

// Display formatting.
check("usd/gal format", formatIndicatorValue(4.796, "usd_gal", 2) === "$4.80/gal");
check("index format", formatIndicatorValue(207.237, "index", 1) === "207.2");
check("count format", formatIndicatorValue(12074, "count", 0) === "12,074");
check("compact billions", formatUsdCompact(1_240_000_000) === "$1.24B");
check("compact hundreds of millions", formatUsdCompact(543_839_378) === "$544M");
check("compact single millions", formatUsdCompact(9_400_000) === "$9.4M");
check("compact thousands", formatUsdCompact(87_400) === "$87k");

// parseEiaSeries: newest-first strings -> chronological numeric series.
const eiaJson = JSON.stringify({
  response: {
    data: [
      { period: "2026-07-13", value: "6.126" },
      { period: "2026-07-06", value: "6.101" },
      { period: "bad", value: "1" },
      { period: "2026-06-29", value: null },
    ],
  },
});
const eia = parseEiaSeries(eiaJson);
check("eia parses valid rows chronologically", eia.length === 2 && eia[0][0] === "2026-07-06" && eia[1][1] === 6.126);
check("eia tolerates empty payload", parseEiaSeries("{}").length === 0);

// parseCensusTable: header-row table resolved by column name.
const censusJson = JSON.stringify([
  ["DIST_NAME", "GEN_VAL_MO", "DISTRICT", "I_COMMODITY", "time"],
  ["LOS ANGELES, CA", "543839378", "27", "8542", "2026-03"],
  ["SAN FRANCISCO, CA", "100000000", "28", "8542", "2026-03"],
  ["HOUSTON, TX", "999", "53", "8542", "2026-03"],
  ["LOS ANGELES, CA", "not-a-number", "27", "8471", "2026-03"],
]);
const censusPoints = parseCensusTable(censusJson);
check("census parses numeric rows", censusPoints.length === 3);
check("census keeps district + commodity", censusPoints[0].district === "27" && censusPoints[0].commodity === "8542");
check("census tolerates missing header", parseCensusTable(JSON.stringify([["A", "B"]])).length === 0);

// summarizeTechImports: CA-district filter, latest month, YoY per code + total.
const importPoints: CensusPoint[] = [
  { district: "27", commodity: "8542", time: "2025-03", value: 400 },
  { district: "28", commodity: "8542", time: "2025-03", value: 100 },
  { district: "27", commodity: "8471", time: "2025-03", value: 200 },
  { district: "27", commodity: "8542", time: "2026-03", value: 550 },
  { district: "28", commodity: "8542", time: "2026-03", value: 110 },
  { district: "27", commodity: "8471", time: "2026-03", value: 300 },
  { district: "53", commodity: "8542", time: "2026-03", value: 99999 }, // non-CA, ignored
  { district: "27", commodity: "8542", time: "2026-02", value: 1 }, // older month, ignored in latest
];
const imports = summarizeTechImports(importPoints);
check("imports latest month detected", imports!.latestMonth === "2026-03");
check("imports total sums CA districts only", imports!.totalValue === 960);
check("imports total yoy", Math.abs(imports!.totalYoyPct! - (100 * (960 / 700 - 1))) < 0.001);
check(
  "imports sorted by value with per-code yoy",
  imports!.byCommodity[0].code === "8542" &&
    Math.abs(imports!.byCommodity[0].yoyPct! - 32) < 0.001 &&
    imports!.byCommodity[1].code === "8471" &&
    Math.abs(imports!.byCommodity[1].yoyPct! - 50) < 0.001
);
check("imports empty when no CA rows", summarizeTechImports([{ district: "53", commodity: "8542", time: "2026-03", value: 5 }]) === null);

const censusSourcesByCommodity = buildCensusSourceUsesByCommodity([
  { code: "8471", source: reviewedSourceUse("census_trade", "https://api.census.gov/data?I_COMMODITY=8471") },
  { code: "8542", source: reviewedSourceUse("census_trade", "https://api.census.gov/data?I_COMMODITY=8542") },
]);
check(
  "each Census commodity keeps only its exact query source",
  censusSourcesByCommodity["8471"].length === 1 &&
    censusSourcesByCommodity["8471"][0].sourceUrl.endsWith("I_COMMODITY=8471") &&
    censusSourcesByCommodity["8542"].length === 1 &&
    censusSourcesByCommodity["8542"][0].sourceUrl.endsWith("I_COMMODITY=8542")
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll market-indicator checks passed");
