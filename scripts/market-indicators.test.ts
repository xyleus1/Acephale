// Smoke test for the open-data market baseline parsing/summary helpers.
// Pure logic only — no network. Run: npx tsx scripts/market-indicators.test.ts

import {
  formatIndicatorValue,
  parseFredCsv,
  summarizeSeries,
  type SeriesPoint,
} from "../src/lib/market-indicators";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

// parseFredCsv: header skipped, "." missing values dropped, garbage ignored.
const csv = [
  "observation_date,GASDESW",
  "2025-07-14,3.807",
  "2025-08-11,.",
  "not-a-date,9.99",
  "2026-01-05,3.477",
  "2026-07-13,4.796",
].join("\n");
const parsed = parseFredCsv(csv);
check("parses valid rows only", parsed.length === 3);
check("keeps chronological values", parsed[0][0] === "2025-07-14" && parsed[2][1] === 4.796);
check("empty input parses to empty", parseFredCsv("observation_date,X\n").length === 0);

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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll market-indicator checks passed");
