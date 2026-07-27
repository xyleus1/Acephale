// Smoke test for the load pre-flight rule engine. Pure logic, no network/DB.
// Run: npx tsx scripts/load-check.test.ts

import {
  checkLoadIdea,
  coerceLoadIdea,
  EMPTY_LOAD_IDEA,
  estimateMiles,
  formatPreflightReport,
  hasOperationalLoadFacts,
  isLoadIdeaDecisionable,
  type BenchCarrier,
  type LoadIdea,
} from "../src/lib/intel/preflight/engine";
import { reviewedSourceUse } from "../src/lib/intel/sources";
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

function sourceIdsOf(result: ReturnType<typeof run>, id: string) {
  return result.findings.find((f) => f.id === id)?.sources.map((source) => source.sourceId) ?? [];
}

const LITHIUM_CARRIER: BenchCarrier = {
  id: "c1",
  name: "Golden State Secure",
  dotNumber: "3722188",
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

check(
  "description-only text is not treated as an operational load",
  !hasOperationalLoadFacts({
    ...EMPTY_LOAD_IDEA,
    description: "what model are you running",
  })
);
check(
  "a partial load cannot receive a decision-ready verdict",
  !isLoadIdeaDecisionable({
    ...EMPTY_LOAD_IDEA,
    origin: "Fremont, CA",
    description: "8 pallets of servers",
  })
);
check(
  "a lane plus cargo description is decisionable",
  isLoadIdeaDecisionable({
    ...EMPTY_LOAD_IDEA,
    origin: "Fremont, CA",
    destination: "Austin, TX",
    description: "8 pallets of servers",
  })
);

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
check("Friday pickup raises the weekend-dwell watch", severityOf(battery, "friday_pickup_dwell") === "watch");
check(
  "Friday dwell cites the dated CargoNet analysis and current FBI mitigation guidance",
  sourceIdsOf(battery, "friday_pickup_dwell").join() === "cargonet_friday_theft,fbi_cargo_theft"
);
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

// Restore the original equipment and calendar checks with claim-specific sources.
const heat = run({
  commodityCategory: "servers_gpu",
  origin: "San Jose, CA",
  destination: "Austin, TX",
  pickupDate: "2026-07-20",
});
check("summer desert crossing raises a storage-temperature risk", severityOf(heat, "desert_heat") === "risk");
check(
  "summer heat cites only the NWS heat guidance",
  sourceIdsOf(heat, "desert_heat").join() === "nws_desert_heat"
);

const julyHoliday = run({ declaredValue: 150_000, pickupDate: "2026-07-03" });
check("July 4 pickup raises the holiday theft window", severityOf(julyHoliday, "holiday_theft_window") === "risk");
check(
  "July 4 finding cites its exact advisory",
  sourceIdsOf(julyHoliday, "holiday_theft_window").join() === "cargonet_july_fourth"
);
const newYearHoliday = run({ declaredValue: 150_000, pickupDate: "2026-12-30" });
check("Dec 30 pickup falls in the New Year window", severityOf(newYearHoliday, "holiday_theft_window") === "risk");
check(
  "New Year finding cites the winter advisory",
  sourceIdsOf(newYearHoliday, "holiday_theft_window").join() === "cargonet_winter_holidays"
);
check(
  "winter advisory window does not extend before Dec 23 or after Jan 2",
  !ids(run({ declaredValue: 150_000, pickupDate: "2026-12-22" })).includes("holiday_theft_window") &&
    !ids(run({ declaredValue: 150_000, pickupDate: "2027-01-03" })).includes("holiday_theft_window")
);
const thanksgivingHoliday = run({ declaredValue: 150_000, pickupDate: "2025-11-25" });
check(
  "Thanksgiving uses the fourth Thursday analysis window",
  severityOf(thanksgivingHoliday, "holiday_theft_window") === "risk" &&
    sourceIdsOf(thanksgivingHoliday, "holiday_theft_window").join() === "cargonet_thanksgiving"
);
check(
  "mid-November pickup is outside every holiday window",
  !ids(run({ declaredValue: 150_000, pickupDate: "2026-11-10" })).includes("holiday_theft_window")
);

// isChina must not catch Taiwan.
check(
  "Taiwan-origin inbound does not raise the China finding",
  !ids(run({ inboundInternational: true, originCountry: "Taiwan, Province of China", commodityCategory: "networking" })).includes("china_301_uflpa")
);

// CARB TRU.
check(
  "reefer in CA raises CARB TRU risk",
  severityOf(run({ temperatureSensitive: true, origin: "Fremont, CA", destination: "Reno, NV" }), "carb_tru") === "risk"
);

const semicap = run({ commodityCategory: "semicap_tools" });
check("semicap raises a customer and OEM handling risk", severityOf(semicap, "semicap_whiteglove") === "risk");
check(
  "semicap handling cites the TI capital-equipment manual",
  sourceIdsOf(semicap, "semicap_whiteglove").join() === "ti_capital_equipment_shipping"
);
const openDeck = run({ commodityCategory: "test_instruments", equipmentType: "FLATBED" });
check("flatbed for instruments raises an OEM-approval risk", severityOf(openDeck, "open_deck_mismatch") === "risk");
check("fragile tech retains the dock and liftgate check", severityOf(openDeck, "dock_liftgate") === "watch");
check("dock finding cites the carrier's liftgate rule", sourceIdsOf(openDeck, "dock_liftgate").join() === "rl_liftgate");

// Broker-authority watch always present.
check("operating-authority watch is always present", ids(run({})).includes("broker_authority"));
check("every emitted finding has at least one exact source use", battery.findings.every((finding) => finding.sources.length > 0));

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
check(
  "coerce treats empty/junk money strings as missing, not zero",
  coerceLoadIdea({ declaredValue: "" }, COMMODITY_CATEGORY_VALUES, []).declaredValue === null &&
    coerceLoadIdea({ declaredValue: "$ ," }, COMMODITY_CATEGORY_VALUES, []).declaredValue === null
);
check("coerce nulls unknown equipment", coerced.equipmentType === null);
check("coerce parses money strings", coerced.declaredValue === 180_000);
check("coerce accepts boolean strings", coerced.temperatureSensitive === true);
check("coerce rejects negative numbers", coerced.transitDays === null);

// formatPreflightReport: notes carry blockers+risks with actions; report has sections.
const reportIdea: LoadIdea = {
  ...EMPTY_LOAD_IDEA,
  description: "Battery modules Fremont to Austin",
  commodityCategory: "batteries_un3480",
  origin: "Fremont, CA",
  destination: "Austin, TX",
  declaredValue: 180_000,
  weightLbs: 12_000,
};
const reportResult = checkLoadIdea(reportIdea, { carriers: [], now: NOW });
const { notes, report } = formatPreflightReport(reportIdea, reportResult);
check("notes lead with counts and tier", notes.startsWith("Pre-flight:") && notes.includes("high_value"));
check("notes include blocker titles with actions", notes.includes("✗") && notes.includes("→"));
check("notes exclude watch items", !notes.includes("Booking as broker of record"));
check("report has section headers", report.includes("BLOCKERS (") && report.includes("CARRIER BENCH"));
check("facts default to empty and stay out of the report", reportResult.facts.length === 0 && !report.includes("CITED FACTS"));
const withFacts = formatPreflightReport(reportIdea, {
  ...reportResult,
  facts: [
    {
      id: "hts-duty-8507",
      text: "HTS heading 8507 returned possible MFN rates; verify the full classification",
      sources: [reviewedSourceUse("usitc_hts")],
    },
  ],
  sources: [reviewedSourceUse("usitc_hts")],
});
check("cited facts render as a report section", withFacts.report.includes("CITED FACTS (1)") && withFacts.report.includes("• HTS heading 8507"));
check("persisted report appends a sources footer", withFacts.report.includes("SOURCES\n[1] Harmonized Tariff Schedule"));
check("report carries the facts line", report.includes("Declared value: $180,000") && report.includes("Weight: 12,000 lbs"));
check("report names the empty-bench state", report.includes("0 approved on the bench"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll load-check checks passed");
