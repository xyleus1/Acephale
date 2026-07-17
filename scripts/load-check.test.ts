// Smoke test for the load pre-flight rule engine. Pure logic, no network/DB.
// Run: npx tsx scripts/load-check.test.ts

import {
  checkLoadIdea,
  coerceLoadIdea,
  EMPTY_LOAD_IDEA,
  estimateMiles,
  type BenchCarrier,
  type LoadIdea,
} from "../src/lib/load-check";
import { COMMODITY_CATEGORY_VALUES } from "../src/lib/security-sop";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

const NOW = new Date("2026-07-16T12:00:00Z");

function run(partial: Partial<LoadIdea>, carriers: BenchCarrier[] = []) {
  return checkLoadIdea({ ...EMPTY_LOAD_IDEA, ...partial }, { carriers, now: NOW });
}

function ids(result: ReturnType<typeof run>) {
  return result.findings.map((f) => f.id);
}

function severityOf(result: ReturnType<typeof run>, id: string) {
  return result.findings.find((f) => f.id === id)?.severity ?? null;
}

const LITHIUM_CARRIER: BenchCarrier = {
  id: "c1",
  name: "Golden State Secure",
  hazmatCertified: true,
  lithiumCapable: true,
  teamDrivers: true,
  airRide: true,
  reeferCapable: false,
  equipmentTypes: ["DRY_VAN"],
  serviceStates: ["CA", "TX", "AZ", "NV"],
  cargoLimit: 500_000,
  cargoInsuranceExpiry: "2027-01-01T00:00:00Z",
};

// The flagship scenario: standalone lithium batteries, CA -> TX, $180k, Friday pickup.
const battery = run({
  commodityCategory: "batteries_un3480",
  origin: "Fremont, CA",
  destination: "Austin, TX",
  declaredValue: 180_000,
  pickupDate: "2026-07-17", // a Friday
  weightLbs: 12_000,
});
check("UN3480 raises the fully-regulated blocker", severityOf(battery, "un3480_fully_regulated") === "blocker");
check("value >100k raises insurance risk", severityOf(battery, "value_over_100k") === "risk");
check("CA lane + high value raises theft-corridor risk", severityOf(battery, "ca_theft_corridor") === "risk");
check("Friday pickup raises weekend-dwell watch", severityOf(battery, "friday_pickup_dwell") === "watch");
check("security tier derives to high_value", battery.securityTier === "high_value");
check("states resolved from free-text locations", battery.originState === "CA" && battery.destState === "TX");
check("no bench carrier -> risk when bench is empty", severityOf(battery, "no_bench_carrier") === "risk");
check("blockers sort first", battery.findings[0].severity === "blocker");

const batteryWithBench = run(
  {
    commodityCategory: "batteries_un3480",
    origin: "Fremont, CA",
    destination: "Austin, TX",
    declaredValue: 180_000,
  },
  [LITHIUM_CARRIER]
);
check("qualified lithium carrier matches", batteryWithBench.carrierMatch.matched.length === 1);
check("no bench-carrier finding when one matches", !ids(batteryWithBench).includes("no_bench_carrier"));

const batteryWrongBench = run(
  { commodityCategory: "batteries_un3480", origin: "Fremont, CA", destination: "Austin, TX" },
  [{ ...LITHIUM_CARRIER, lithiumCapable: false }]
);
check("non-lithium carrier does not match a UN3480 load", severityOf(batteryWrongBench, "no_bench_carrier") === "blocker");

// Damaged batteries are forbidden outright.
check(
  "damaged/recalled batteries are a blocker",
  severityOf(run({ commodityCategory: "batteries_un3481", batteriesDamagedOrRecalled: true }), "damaged_batteries_forbidden") === "blocker"
);

// Defense hardware parks.
check("defense/space load parks as ITAR blocker", severityOf(run({ defenseOrSpace: true }), "itar_park") === "blocker");

// GPU export screening only fires when export-bound.
check("GPU domestic-only has no export finding", !ids(run({ commodityCategory: "servers_gpu" })).includes("gpu_export_screen"));
check(
  "GPU export-bound raises EAR risk",
  severityOf(run({ commodityCategory: "servers_gpu", exportBound: true }), "gpu_export_screen") === "risk"
);

// China inbound: 301 + UFLPA + exam buffer + ISF.
const inbound = run({
  commodityCategory: "networking",
  inboundInternational: true,
  originCountry: "China",
  origin: "Los Angeles, CA",
  destination: "San Jose, CA",
});
check("china inbound raises 301/UFLPA risk", severityOf(inbound, "china_301_uflpa") === "risk");
check("inbound raises CBP exam buffer risk", severityOf(inbound, "cbp_exam_buffer") === "risk");
check("networking inbound raises FCC watch", severityOf(inbound, "fcc_import") === "watch");
check("CA intrastate raises AB5 watch", severityOf(inbound, "ab5_intrastate") === "watch");

// Value ladder.
check("value >250k is a blocker until insurance verified", severityOf(run({ declaredValue: 400_000 }), "value_over_250k") === "blocker");
check("tech with no value raises missing-value risk", severityOf(run({ commodityCategory: "servers_gpu" }), "declared_value_missing") === "risk");

// Weight.
check("48k lbs cargo is an overweight blocker", severityOf(run({ weightLbs: 48_000 }), "overweight") === "blocker");
check("43k lbs cargo is an axle-margin watch", severityOf(run({ weightLbs: 43_000 }), "weight_axle_margin") === "watch");

// Transit math: LA -> Dallas is ~1,250 road-adjusted miles from centroids.
const rush = run({ origin: "Los Angeles, CA", destination: "Dallas, TX", transitDays: 1 });
check("impossible transit is a blocker", severityOf(rush, "transit_impossible") === "blocker");
const teamLane = run({ origin: "Los Angeles, CA", destination: "Dallas, TX", transitDays: 2 });
check("tight transit requires team drivers", severityOf(teamLane, "team_required") === "risk");
check(
  "team requirement flows into carrier matching",
  teamLane.carrierMatch.requirements.some((r) => r.key === "team")
);

// Desert heat: fragile tech, July, interstate CA->TX, no temp control.
const heat = run({
  commodityCategory: "servers_gpu",
  origin: "San Jose, CA",
  destination: "Austin, TX",
  pickupDate: "2026-07-20",
});
check("summer desert crossing raises heat risk", severityOf(heat, "desert_heat") === "risk");

// Holiday window.
check(
  "July 4th pickup raises the holiday theft window",
  severityOf(run({ declaredValue: 150_000, pickupDate: "2026-07-03" }), "holiday_theft_window") === "risk"
);

// CARB TRU.
check(
  "reefer in CA raises CARB TRU risk",
  severityOf(run({ temperatureSensitive: true, origin: "Fremont, CA", destination: "Reno, NV" }), "carb_tru") === "risk"
);

// Semicap white-glove + open-deck mismatch.
check("semicap raises white-glove risk", severityOf(run({ commodityCategory: "semicap_tools" }), "semicap_whiteglove") === "risk");
check(
  "flatbed for instruments raises mismatch risk",
  severityOf(run({ commodityCategory: "test_instruments", equipmentType: "FLATBED" }), "open_deck_mismatch") === "risk"
);

// Broker-authority watch always present.
check("operating-authority watch is always present", ids(run({})).includes("broker_authority"));

// estimateMiles sanity: LA to Dallas centroids ≈ 1,240 ± 150 road miles.
const miles = estimateMiles({ lat: 34.0522, lon: -118.2437 }, { lat: 32.7767, lon: -96.797 });
check("estimateMiles is in a sane range", miles != null && miles > 1_100 && miles < 1_600);

// coerceLoadIdea: strings, junk enums, money strings.
const coerced = coerceLoadIdea(
  {
    commodityCategory: "servers_gpu",
    equipmentType: "HOVERCRAFT",
    declaredValue: "$180,000",
    weightLbs: 12000,
    temperatureSensitive: "true",
    pickupDate: "2026-08-01",
    transitDays: -3,
  },
  COMMODITY_CATEGORY_VALUES,
  ["DRY_VAN"]
);
check("coerce keeps valid commodity", coerced.commodityCategory === "servers_gpu");
check("coerce nulls unknown equipment", coerced.equipmentType === null);
check("coerce parses money strings", coerced.declaredValue === 180_000);
check("coerce accepts boolean strings", coerced.temperatureSensitive === true);
check("coerce rejects negative numbers", coerced.transitDays === null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll load-check checks passed");
