// Smoke test for the truckload quote flywheel vocabulary and pure economics.
// Run: npx tsx scripts/truckload-quotes.test.ts

import {
  CARRIER_BID_SOURCE_VALUES,
  CARRIER_BID_STATUS_VALUES,
  QUOTE_OUTCOME_REASON_VALUES,
  QUOTE_OUTCOME_VALUES,
  quoteEconomics,
  toCarrierBidRow,
} from "../src/lib/truckload-quote-fields";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

check("bid statuses are unique", unique(CARRIER_BID_STATUS_VALUES));
check("bid sources are unique", unique(CARRIER_BID_SOURCE_VALUES));
check("quote outcomes are unique", unique(QUOTE_OUTCOME_VALUES));
check("outcome reasons are unique", unique(QUOTE_OUTCOME_REASON_VALUES));
check("PENDING is the default outcome", QUOTE_OUTCOME_VALUES[0] === "PENDING");

// Economics: GP = sell - buy; margin over sell; $/mi over sell.
const full = quoteEconomics({ buyAmount: 2000, sellAmount: 2500, miles: 500 });
check("gross profit computed", full.grossProfit === 500);
check("margin computed over sell", full.marginPct === 20);
check("rate per mile computed over sell", full.ratePerMile === 5);

const noBuy = quoteEconomics({ sellAmount: 2500, miles: 500 });
check("missing buy leaves GP/margin null but keeps $/mi", noBuy.grossProfit === null && noBuy.marginPct === null && noBuy.ratePerMile === 5);

const noSell = quoteEconomics({ buyAmount: 2000 });
check("missing sell leaves everything null", noSell.grossProfit === null && noSell.marginPct === null && noSell.ratePerMile === null);

const zeroSell = quoteEconomics({ buyAmount: 100, sellAmount: 0, miles: 100 });
check("zero sell yields GP but no margin (no divide-by-zero)", zeroSell.grossProfit === -100 && zeroSell.marginPct === null);

const negMiles = quoteEconomics({ sellAmount: 1000, miles: -5 });
check("non-positive miles yields no $/mi", negMiles.ratePerMile === null);

const rounding = quoteEconomics({ buyAmount: 1000.005, sellAmount: 1333.337, miles: 3 });
check("amounts round to cents / tenth of a percent", rounding.grossProfit === 333.33 && rounding.marginPct === 25 && rounding.ratePerMile === 444.45);

// Row serializer keeps the vetting badge honest.
const row = toCarrierBidRow({
  id: "b1",
  carrierId: "c1",
  carrierName: "Golden State Secure",
  equipmentType: "DRY_VAN",
  totalAmount: 2450,
  ratePerMile: 4.9,
  transitDays: 1,
  source: "PHONE",
  status: "SELECTED",
  notes: null,
  createdAt: new Date("2026-07-16T10:00:00Z"),
  carrier: { vettingStatus: "approved" },
});
check("bid row serializes dates and vetting status", row.createdAt === "2026-07-16T10:00:00.000Z" && row.carrierVettingStatus === "approved");
check(
  "bid row without bench link has null vetting status",
  toCarrierBidRow({ ...row, createdAt: new Date(), carrier: null, carrierId: null }).carrierVettingStatus === null
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll truckload-quote checks passed");
