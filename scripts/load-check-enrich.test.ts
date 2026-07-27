// Smoke test for the pre-flight fact-enrichment parsers (fixtures captured
// from the live endpoints on 2026-07-17). Pure logic - no network.
// Run: npx tsx scripts/load-check-enrich.test.ts

import {
  cancellationWarning,
  liFilingStatus,
  parseCrossRulings,
  parseHtsEntries,
  parseLiDatasetFreshness,
  parseLiFilings,
  selectActiveLiFilings,
} from "../src/lib/intel/preflight/enrich";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

// HTS: header rows have general:null; child rows carry rates; footnotes may
// reference chapter-99 (Section 301) headings.
const htsJson = JSON.stringify([
  { htsno: "8471", general: null, footnotes: [] },
  { htsno: "8471.30.01.00", general: "Free", footnotes: [{ value: "See 9903.88.03." }] },
  { htsno: "8471.50.01.50", general: "Free", footnotes: [] },
  { htsno: "8542.31.00.00", general: "Free", footnotes: [] }, // different heading - ignored
]);
const hts = parseHtsEntries(htsJson, "8471");
check("hts filters to the requested heading", hts !== null && hts.rates.length === 1 && hts.rates[0] === "Free");
check("hts finds Section 301 markers in footnotes", hts!.s301.length === 1 && hts!.s301[0].includes("List 3"));
check("hts returns null on garbage", parseHtsEntries("not json", "8471") === null);
check("hts returns null when heading absent", parseHtsEntries(htsJson, "9027") === null);

// CROSS: newest-first; revoked rulings skipped.
const crossJson = JSON.stringify({
  rulings: [
    { rulingNumber: "N999999", subject: "revoked thing", rulingDate: "2026-05-01T00:00:00", revokedBy: ["H1"], operationallyRevoked: false },
    { rulingNumber: "N888888", subject: "modified server ruling", rulingDate: "2026-04-01T00:00:00", modifiedBy: ["N359764"] },
    {
      rulingNumber: "N359764",
      subject: "The classification, country of origin, and eligibility under the USMCA of an AI server rack",
      rulingDate: "2026-03-31T00:00:00",
      revokedBy: [],
      operationallyRevoked: false,
    },
  ],
});
const ruling = parseCrossRulings(crossJson);
check("cross skips revoked rulings", ruling !== null && ruling.number === "N359764");
check("cross skips modified rulings", !JSON.stringify(ruling).includes("N888888"));
check("cross trims the date", ruling!.date === "2026-03-31");
check("cross tolerates empty payload", parseCrossRulings("{}") === null);
check(
  "cross subject filter keeps on-topic rulings",
  parseCrossRulings(crossJson, ["server", "rack"])?.number === "N359764"
);
check("cross subject filter drops off-topic rulings", parseCrossRulings(crossJson, ["battery", "lithium"]) === null);

// L&I: amounts arrive in $ thousands; cancellation column also holds far-future term dates.
const liJson = JSON.stringify([
  {
    dot_number: "03722188",
    ins_form_code: "91X",
    mod_col_1: "BIPD/Primary",
    name_company: "AMERICAN MILLENNIUM",
    max_cov_amount: "750",
    policy_no: "CAL11859-01",
    trans_date: "01/10/2023",
    effective_date: "01/10/2032",
    cancl_effective_date: "01/10/2032",
  },
]);
const filings = parseLiFilings(liJson);
check("li parses filing type and insurer", filings.length === 1 && filings[0].type === "BIPD/Primary");
check("li converts thousands to USD", filings[0].coverageUsd === 750_000);
check(
  "li keeps policy lifecycle dates",
  filings[0].effectiveDate === "01/10/2032" && filings[0].transactionDate === "01/10/2023"
);
check("li tolerates garbage", parseLiFilings("nope").length === 0);

const liFreshness = parseLiDatasetFreshness(JSON.stringify({
  rowsUpdatedAt: 1784638872,
  description: "Note: This dataset was last refreshed on 05/14/2026 and will no longer be updated.",
}));
check("li freshness uses the catalog's declared data date", liFreshness.dataAsOf === "2026-05-14");
check(
  "li freshness flags conflicting catalog signals",
  liFreshness.catalogRowsUpdatedAt === "2026-07-21" && liFreshness.discontinued && liFreshness.conflictingSignals
);

// cancellationWarning: only near-term dates warn.
const now = new Date("2026-07-17T12:00:00Z");
const activeFiling = {
  ...filings[0],
  policyNumber: "ACTIVE-1",
  transactionDate: "07/01/2026",
  effectiveDate: "01/01/2026",
  cancelEffective: "08/10/2026",
};
const inactiveFiling = {
  ...filings[0],
  policyNumber: "OLD-1",
  transactionDate: "01/01/2025",
  effectiveDate: "01/01/2025",
  cancelEffective: "06/01/2026",
};
const supersededActiveFiling = {
  ...activeFiling,
  policyNumber: "CANCELLED-1",
  transactionDate: "01/01/2026",
  cancelEffective: null,
};
const laterCancellation = {
  ...inactiveFiling,
  policyNumber: "CANCELLED-1",
  transactionDate: "06/01/2026",
};
check("future-effective L&I history is pending, not active", liFilingStatus(filings[0], now) === "pending");
check("past-cancelled L&I history is inactive", liFilingStatus(inactiveFiling, now) === "inactive");
check("current effective L&I row is active", liFilingStatus(activeFiling, now) === "active");
check(
  "active filing selection excludes pending and cancelled history",
  selectActiveLiFilings([filings[0], inactiveFiling, activeFiling], now).map((filing) => filing.policyNumber).join() === "ACTIVE-1"
);
check(
  "a later cancellation supersedes an older active history row",
  selectActiveLiFilings([supersededActiveFiling, laterCancellation], now).length === 0
);
check("far-future term date does not warn", cancellationWarning(filings[0], now) === null);
check(
  "cancellation within 60 days warns",
  cancellationWarning({ ...filings[0], cancelEffective: "08/10/2026" }, now)?.includes("cancellation effective 08/10/2026") === true
);
check("past date does not warn", cancellationWarning({ ...filings[0], cancelEffective: "07/01/2026" }, now) === null);
check("unparseable date does not warn", cancellationWarning({ ...filings[0], cancelEffective: "2032-01-10" }, now) === null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll load-check-enrich checks passed");
