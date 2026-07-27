import assert from "node:assert/strict";
import snapshotJson from "../src/lib/intel/research/generated/census-public-hardware-v1.json";
import {
  buildCensusPublicOriginCorridorWatch,
  buildChinaWestCoastCorridorWatch,
  buildOceanHardwareRoutingResearchBrief,
  selectCorridorWatchPrimaryGateway,
} from "../src/lib/intel/research/corridor-watch";
import type { CensusPublicHardwareSnapshot } from "../src/lib/intel/research/census-public-hardware";

const snapshot = snapshotJson as CensusPublicHardwareSnapshot;
const watch = buildChinaWestCoastCorridorWatch(snapshot);

assert.equal(watch.kind, "census_public_origin_corridor_watch");
assert.equal(watch.watchId, "origin:5700:west-coast-hardware:2026-05");
assert.equal(watch.originCountryCode, "5700");
assert.equal(watch.originCountryName, "China");
assert.equal(watch.asOfMonth, "2026-05");
assert.equal(watch.routeReadiness, "research_only");

assert.deepEqual(
  watch.completeYearOriginHistory.map((period) => period.year),
  [2021, 2022, 2023, 2024, 2025],
  "the watch retains five complete years and keeps current YTD separate"
);
assert.equal(watch.completeYearOriginHistory[0].basketComparable, false);
assert.equal(
  watch.completeYearOriginHistory[0].comparisonBasis,
  "incompatible_pre_2022_hs_basket"
);
for (const period of watch.completeYearOriginHistory.slice(1)) {
  assert.equal(period.basketComparable, true);
  assert.equal(period.comparisonBasis, "comparable_2022_hs_basket");
  assert.equal(period.californiaDestination.status, "observed");
  assert.equal(period.westCoastGateways.status, "observed");
}
assert.ok(
  watch.fixedBasketOriginHistory,
  "China watch includes the fixed core43 long-run slice"
);
assert.equal(watch.fixedBasketOriginHistory.basis, "fixed_core43");
assert.equal(
  watch.fixedBasketOriginHistory.basketId,
  "startup_production_hardware_core43_v1"
);
assert.equal(watch.fixedBasketOriginHistory.applicableHsCodeCount, 43);
assert.equal(watch.fixedBasketOriginHistory.startYear, 2010);
assert.deepEqual(
  watch.fixedBasketOriginHistory.completeYears.map((period) => period.year),
  Array.from({ length: 16 }, (_, index) => 2010 + index),
  "fixed core43 history keeps every complete year from 2010 through 2025"
);
const baselineHistory = watch.fixedBasketOriginHistory.completeYears[0];
assert.deepEqual(
  {
    year: baselineHistory.year,
    westCoastValueUsd:
      baselineHistory.westCoastGateways.metrics?.vesselValueUsd,
    westCoastOriginShareBps:
      baselineHistory.westCoastGateways.originShareBps,
    californiaValueUsd:
      baselineHistory.californiaDestination.metrics?.vesselValueUsd,
    californiaOriginShareBps:
      baselineHistory.californiaDestination.originShareBps,
  },
  {
    year: 2010,
    westCoastValueUsd: 45_360_375_377,
    westCoastOriginShareBps: 6_727,
    californiaValueUsd: 23_146_595_943,
    californiaOriginShareBps: 7_444,
  },
  "the 2010 baseline is derived from the captured official state and port files"
);
assert.deepEqual(
  {
    year: watch.fixedBasketOriginHistory.currentYtd.year,
    throughMonth: watch.fixedBasketOriginHistory.currentYtd.throughMonth,
    period: watch.fixedBasketOriginHistory.currentYtd.period,
  },
  {
    year: 2026,
    throughMonth: 5,
    period: "2026-05",
  },
  "the fixed-basket partial year is represented separately from complete years"
);
assert.deepEqual(
  {
    year: watch.currentYtd.year,
    throughMonth: watch.currentYtd.throughMonth,
    period: watch.currentYtd.period,
    periodKind: watch.currentYtd.periodKind,
    basketComparable: watch.currentYtd.basketComparable,
  },
  {
    year: 2026,
    throughMonth: 5,
    period: "2026-05",
    periodKind: "current_ytd",
    basketComparable: true,
  }
);

const westCoast = watch.currentYtd.westCoastGateways;
assert.equal(westCoast.status, "observed");
assert.equal(westCoast.scope, "west_coast_gateway");
assert.equal(westCoast.basis, "port_of_unlading");
assert.equal(westCoast.metrics?.vesselValueUsd, 8_890_123_614);
assert.equal(westCoast.originShareBps, 2_075);
assert.equal(westCoast.metrics?.containerizedShareBps, 9_774);

const california = watch.currentYtd.californiaDestination;
assert.equal(california.status, "observed");
assert.equal(california.scope, "california_destination");
assert.equal(california.basis, "state_of_ultimate_destination");
assert.equal(california.metrics?.vesselValueUsd, 4_270_933_570);
assert.equal(california.originShareBps, 2_168);
assert.notEqual(
  california.metrics?.vesselValueUsd,
  westCoast.metrics?.vesselValueUsd,
  "California destination and West Coast gateway values remain independent"
);

assert.equal(watch.currentGatewaySignals.length, 5);
assert.deepEqual(
  watch.currentGatewaySignals.slice(0, 2).map((gateway) => ({
    code: gateway.gatewayDistrictCode,
    value: gateway.metrics.vesselValueUsd,
    shareBps: gateway.originShareBps,
  })),
  [
    { code: "27", value: 6_288_288_132, shareBps: 7_073 },
    { code: "28", value: 1_922_324_725, shareBps: 2_162 },
  ]
);
assert.equal(watch.topTwoGatewayShareBps, 9_236);
assert.equal(
  watch.currentGatewaySignals.reduce(
    (sum, gateway) => sum + gateway.metrics.vesselValueUsd,
    0
  ),
  westCoast.metrics?.vesselValueUsd,
  "gateway signals reconcile to the China West Coast total"
);

assert.equal(watch.currentCategorySignals.length, 5);
assert.equal(watch.currentCategoryGatewaySegmentCount, 23);
assert.equal(
  watch.currentCategorySignals.reduce(
    (sum, category) => sum + category.gatewaySignals.length,
    0
  ),
  23,
  "category gateway nesting retains every positive China segment"
);
assert.equal(
  watch.currentCategorySignals.reduce(
    (sum, category) => sum + category.metrics.vesselValueUsd,
    0
  ),
  westCoast.metrics?.vesselValueUsd,
  "category signals reconcile to the China West Coast total"
);

const categoryPattern = Object.fromEntries(
  watch.currentCategorySignals.map((category) => [
    category.category,
    {
      observedPrimaryGateway:
        category.observedPrimaryGateway.gatewayDistrictCode,
      comparisonGateway:
        category.comparisonGateways[0]?.gatewayDistrictCode ?? null,
    },
  ])
);
assert.deepEqual(categoryPattern, {
  power_control: {
    observedPrimaryGateway: "27",
    comparisonGateway: "28",
  },
  factory_process: {
    observedPrimaryGateway: "27",
    comparisonGateway: "30",
  },
  compute_electronics: {
    observedPrimaryGateway: "27",
    comparisonGateway: null,
  },
  medical_lab: {
    observedPrimaryGateway: "27",
    comparisonGateway: "28",
  },
  drones_aerospace: {
    observedPrimaryGateway: "30",
    comparisonGateway: null,
  },
});

assert.deepEqual(
  Object.fromEntries(
    watch.currentCategorySignals.map((category) => [
      category.category,
      {
        researchPosture: category.researchPosture,
        commercialCues: category.commercialCues,
      },
    ])
  ),
  {
    power_control: {
      researchPosture: "dual_gateway_comparison",
      commercialCues: [],
    },
    factory_process: {
      researchPosture: "primary_gateway_concentration",
      commercialCues: ["high_aggregate_weight_low_unit_value"],
    },
    compute_electronics: {
      researchPosture: "primary_gateway_concentration",
      commercialCues: [],
    },
    medical_lab: {
      researchPosture: "dual_gateway_comparison",
      commercialCues: [],
    },
    drones_aerospace: {
      researchPosture: "primary_gateway_concentration",
      commercialCues: ["high_unit_value"],
    },
  },
  "category research posture uses aggregate commercial cues without inventing handling risk"
);

const changedRankingSignals = watch.currentGatewaySignals.map((gateway) => ({
  ...gateway,
  metrics: {
    ...gateway.metrics,
    vesselValueUsd:
      gateway.gatewayDistrictCode === "30"
        ? 9_000_000_000
        : gateway.metrics.vesselValueUsd,
  },
}));
assert.equal(
  selectCorridorWatchPrimaryGateway(changedRankingSignals)
    ?.gatewayDistrictCode,
  "30",
  "the primary gateway follows the largest observed value instead of a hard-coded district"
);

assert.deepEqual(watch.dataAvailability, {
  aggregateOriginHistory: "observed",
  currentCategoryGatewaySegments: "observed",
  californiaDestinationSignal: "observed",
  foreignOriginPort: "unavailable",
  companyShipmentRecords: "unavailable",
  portToPortLanes: "unavailable",
  freightRates: "unavailable",
  carrierServices: "unavailable",
  transitTimeReliability: "unavailable",
});
assert.equal(watch.requiredEvidence.length, 10);
assert.equal(
  watch.requiredEvidence.every((evidence) => evidence.status === "unavailable"),
  true
);
assert.equal(watch.sources.length, 35);
assert.equal(watch.sourceChecksums.length, 35);
assert.equal(
  watch.sources.every((source) =>
    /^[a-f0-9]{64}$/.test(source.integritySha256 ?? "")
  ),
  true,
  "every watch source includes a captured archive checksum"
);
assert.equal(
  watch.sourceChecksums.every((source) =>
    /^[a-f0-9]{64}$/.test(source.archiveSha256)
  ),
  true
);
assert.equal(
  new Set(
    watch.sourceChecksums.map(
      (source) => `${source.scope}:${source.period ?? "dictionary"}`
    )
  ).size,
  35,
  "source checksums preserve separate state, gateway, and dictionary evidence"
);

assert.deepEqual(
  buildCensusPublicOriginCorridorWatch(snapshot, {
    originCountryCode: "5700",
  }),
  watch,
  "the China wrapper delegates to the generic origin watch"
);
const vietnamWatch = buildCensusPublicOriginCorridorWatch(snapshot, {
  originCountryCode: "5520",
});
assert.equal(vietnamWatch.originCountryName, "Vietnam");
assert.equal(
  vietnamWatch.fixedBasketOriginHistory,
  null,
  "the China-only long-run slice is not silently applied to another origin"
);
assert.equal(vietnamWatch.sources.length, 13);
assert.equal(
  vietnamWatch.requiredEvidence
    .find((evidence) => evidence.id === "shipment_endpoints")
    ?.reason.includes("Chinese"),
  false,
  "generic origin watches keep shipment evidence copy origin-neutral"
);
assert.throws(
  () =>
    buildCensusPublicOriginCorridorWatch(snapshot, {
      originCountryCode: "CN",
    }),
  /must use four digits/
);
assert.throws(
  () =>
    buildCensusPublicOriginCorridorWatch(snapshot, {
      originCountryCode: "9999",
    }),
  /is unavailable/
);
assert.throws(
  () =>
    buildChinaWestCoastCorridorWatch({
      ...snapshot,
      schemaVersion: 3,
    } as unknown as CensusPublicHardwareSnapshot),
  /Unsupported Census public hardware snapshot schema/,
  "the builder validates the complete snapshot before deriving a watch"
);

const brief = buildOceanHardwareRoutingResearchBrief(watch);
assert.equal(brief.kind, "ocean_hardware_routing_research_brief");
assert.equal(brief.title, "China to U.S. West Coast hardware routing research");
assert.equal(brief.routeReadiness, "research_only");
assert.equal(brief.status, "partial");
assert.equal(brief.findings.length, 4);
assert.equal(brief.categoryResearch.length, 5);
assert.equal(
  brief.findings.some(
    (finding) =>
      finding.id === "gateway_concentration" &&
      finding.statement.includes("92.36%")
  ),
  true
);
assert.equal(
  brief.findings.some(
    (finding) =>
      finding.id === "california_destination" &&
      finding.statement.includes("independent from gateway observations")
  ),
  true
);
assert.equal(
  JSON.stringify(brief).includes("observedPrimaryGateway"),
  true
);
assert.doesNotMatch(
  JSON.stringify(brief),
  /\b(best|recommended route)\b/i,
  "research output never upgrades observed gateway volume into a routing recommendation"
);
assert.deepEqual(brief.requiredEvidence, watch.requiredEvidence);
assert.deepEqual(brief.sourceChecksums, watch.sourceChecksums);
assert.notEqual(
  brief.requiredEvidence,
  watch.requiredEvidence,
  "the brief does not expose the watch's mutable array references"
);

console.log(
  JSON.stringify({
    ok: true,
    origin: watch.originCountryName,
    asOfMonth: watch.asOfMonth,
    currentSegmentCount: watch.currentCategoryGatewaySegmentCount,
    westCoastVesselValueUsd: westCoast.metrics?.vesselValueUsd,
    topTwoGatewayShareBps: watch.topTwoGatewayShareBps,
  })
);
