import {
  STARTUP_HARDWARE_CATEGORY_LABELS,
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID,
  WEST_COAST_GATEWAY_DISTRICTS,
  type StartupHardwareCategory,
} from "./ocean-hardware";
import {
  validateCensusPublicHardwareSnapshot,
  type CensusPublicHardwareSnapshot,
  type CensusPublicMetricTotals,
  type CensusPublicOriginHistoryScopeSummary,
  type CensusPublicScopeSummary,
  type CensusPublicSourceFile,
} from "./census-public-hardware";
import {
  dedupeIntelSourceUses,
  type IntelSourceUse,
} from "../sources";

export type CorridorWatchObservationStatus = "observed" | "unavailable";
export type CorridorWatchRouteReadiness = "research_only";
export type CorridorWatchScope =
  | "california_destination"
  | "west_coast_gateway";

export type CorridorWatchVesselMetrics = {
  vesselValueUsd: number;
  vesselWeightKg: number;
  containerizedVesselValueUsd: number;
  containerizedVesselWeightKg: number;
  containerizedShareBps: number | null;
};

export type CorridorWatchScopeSignal = {
  status: CorridorWatchObservationStatus;
  scope: CorridorWatchScope;
  basis: "state_of_ultimate_destination" | "port_of_unlading";
  originShareBps: number | null;
  metrics: CorridorWatchVesselMetrics | null;
};

export type CorridorWatchOriginHistoryPoint = {
  year: number;
  period: string;
  basketComparable: boolean;
  comparisonBasis:
    | "comparable_2022_hs_basket"
    | "incompatible_pre_2022_hs_basket";
  californiaDestination: CorridorWatchScopeSignal;
  westCoastGateways: CorridorWatchScopeSignal;
};

export type CorridorWatchCurrentPeriod = {
  year: number;
  throughMonth: number;
  period: string;
  periodKind: "current_ytd";
  basketComparable: true;
  californiaDestination: CorridorWatchScopeSignal;
  westCoastGateways: CorridorWatchScopeSignal;
};

export type CorridorWatchFixedBasketHistoryPoint = {
  year: number;
  period: string;
  californiaDestination: CorridorWatchScopeSignal;
  westCoastGateways: CorridorWatchScopeSignal;
};

export type CorridorWatchFixedBasketCurrentPeriod = {
  year: number;
  throughMonth: number;
  period: string;
  periodKind: "current_ytd";
  californiaDestination: CorridorWatchScopeSignal;
  westCoastGateways: CorridorWatchScopeSignal;
};

export type CorridorWatchFixedBasketHistory = {
  basis: "fixed_core43";
  basketId: typeof STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID;
  applicableHsCodeCount: number;
  startYear: 2010;
  completeYears: CorridorWatchFixedBasketHistoryPoint[];
  currentYtd: CorridorWatchFixedBasketCurrentPeriod;
};

export type CorridorWatchGatewaySignal = {
  status: "observed";
  gatewayDistrictCode: string;
  gatewayDistrictLabel: string;
  originShareBps: number;
  metrics: CorridorWatchVesselMetrics;
};

export type CorridorWatchCategoryGatewaySignal = {
  status: "observed";
  gatewayDistrictCode: string;
  gatewayDistrictLabel: string;
  originShareBps: number;
  categoryShareBps: number;
  metrics: CorridorWatchVesselMetrics;
};

export type CorridorWatchCategorySignal = {
  status: "observed";
  category: StartupHardwareCategory;
  categoryLabel: string;
  originShareBps: number;
  unitValueUsdPerKg: number | null;
  researchPosture:
    | "primary_gateway_concentration"
    | "dual_gateway_comparison"
    | "distributed_observation";
  commercialCues: Array<
    "high_aggregate_weight_low_unit_value" | "high_unit_value"
  >;
  metrics: CorridorWatchVesselMetrics;
  observedPrimaryGateway: CorridorWatchCategoryGatewaySignal;
  comparisonGateways: CorridorWatchCategoryGatewaySignal[];
  gatewaySignals: CorridorWatchCategoryGatewaySignal[];
};

export type CorridorWatchSourceChecksum = {
  scope: CorridorWatchScope | "country_dictionary";
  period: string | null;
  fileName: string;
  sourceUrl: string;
  archiveSha256: string;
  fetchedAt: string;
  lastModified: string | null;
};

export type CorridorWatchEvidenceRequirement = {
  id:
    | "foreign_origin_port"
    | "actual_us_discharge_port"
    | "shipment_endpoints"
    | "shipment_route"
    | "carrier_service"
    | "sailing_schedule"
    | "transit_reliability"
    | "freight_rate"
    | "cargo_handling"
    | "company_shipment";
  status: "unavailable";
  reason: string;
};

export type CensusPublicOriginCorridorWatch = {
  kind: "census_public_origin_corridor_watch";
  watchId: string;
  asOfMonth: string;
  generatedAt: string;
  originCountryCode: string;
  originCountryName: string;
  routeReadiness: CorridorWatchRouteReadiness;
  completeYearOriginHistory: CorridorWatchOriginHistoryPoint[];
  fixedBasketOriginHistory: CorridorWatchFixedBasketHistory | null;
  currentYtd: CorridorWatchCurrentPeriod;
  currentGatewaySignals: CorridorWatchGatewaySignal[];
  currentCategorySignals: CorridorWatchCategorySignal[];
  currentCategoryGatewaySegmentCount: number;
  topTwoGatewayShareBps: number | null;
  dataAvailability: {
    aggregateOriginHistory: CorridorWatchObservationStatus;
    currentCategoryGatewaySegments: CorridorWatchObservationStatus;
    californiaDestinationSignal: CorridorWatchObservationStatus;
    foreignOriginPort: "unavailable";
    companyShipmentRecords: "unavailable";
    portToPortLanes: "unavailable";
    freightRates: "unavailable";
    carrierServices: "unavailable";
    transitTimeReliability: "unavailable";
  };
  requiredEvidence: CorridorWatchEvidenceRequirement[];
  sources: IntelSourceUse[];
  sourceChecksums: CorridorWatchSourceChecksum[];
  limitations: string[];
};

export type OceanHardwareRoutingResearchFinding = {
  id:
    | "origin_share"
    | "gateway_concentration"
    | "california_destination"
    | "category_gateway_pattern";
  status: CorridorWatchObservationStatus;
  statement: string;
};

export type OceanHardwareRoutingResearchBrief = {
  kind: "ocean_hardware_routing_research_brief";
  title: string;
  asOfMonth: string;
  originCountryCode: string;
  originCountryName: string;
  routeReadiness: "research_only";
  status: "partial";
  findings: OceanHardwareRoutingResearchFinding[];
  categoryResearch: Array<{
    category: StartupHardwareCategory;
    categoryLabel: string;
    observedPrimaryGateway: {
      gatewayDistrictCode: string;
      gatewayDistrictLabel: string;
      vesselValueUsd: number;
      categoryShareBps: number;
    };
    comparisonGateways: Array<{
      gatewayDistrictCode: string;
      gatewayDistrictLabel: string;
      vesselValueUsd: number;
      categoryShareBps: number;
    }>;
  }>;
  requiredEvidence: CorridorWatchEvidenceRequirement[];
  sources: IntelSourceUse[];
  sourceChecksums: CorridorWatchSourceChecksum[];
  limitations: string[];
};

const GATEWAY_LABELS = new Map<string, string>(
  WEST_COAST_GATEWAY_DISTRICTS.map((district) => [
    district.code,
    district.label,
  ])
);

const REQUIRED_EVIDENCE: CorridorWatchEvidenceRequirement[] = [
  {
    id: "foreign_origin_port",
    status: "unavailable",
    reason:
      "A foreign loading port is required before the observed U.S. gateway pattern can become a port-to-port lane.",
  },
  {
    id: "actual_us_discharge_port",
    status: "unavailable",
    reason:
      "The exact U.S. discharge port and terminal are required because Census district labels group multiple ports.",
  },
  {
    id: "shipment_endpoints",
    status: "unavailable",
    reason:
      "The origin pickup point and final U.S. delivery location are required to compare complete origin and inland legs.",
  },
  {
    id: "shipment_route",
    status: "unavailable",
    reason:
      "Shipment-level bills of lading are required to verify actual port pairs, transshipment, and routing frequency.",
  },
  {
    id: "carrier_service",
    status: "unavailable",
    reason:
      "Current carrier schedules and service strings are required to test feasible routings.",
  },
  {
    id: "sailing_schedule",
    status: "unavailable",
    reason:
      "Current sailing dates, frequency, cutoff rules, and transshipment details are required before a service comparison.",
  },
  {
    id: "transit_reliability",
    status: "unavailable",
    reason:
      "Observed transit times, rollover, and delay records are required before comparing service reliability.",
  },
  {
    id: "freight_rate",
    status: "unavailable",
    reason:
      "Current freight rates and accessorials are required before making a commercial routing decision.",
  },
  {
    id: "cargo_handling",
    status: "unavailable",
    reason:
      "Exact commodity, HS classification, dimensions, weight, equipment, dangerous-goods state, and handling constraints are required.",
  },
  {
    id: "company_shipment",
    status: "unavailable",
    reason:
      "Licensed company-level shipment evidence is required before identifying or qualifying leads.",
  },
];

const LIMITATIONS = [
  "West Coast gateway data uses U.S. port-of-unlading districts. It does not identify the foreign loading port, carrier service, or full port-to-port route.",
  "California destination data uses state of ultimate destination. It is independent from gateway data and cannot be joined to a specific West Coast district.",
  "Category-gateway signals are monthly Census aggregates by origin country and hardware category, not shipment records or company records.",
  "The current 46-code basket includes three HS groups introduced in 2022. The fixed 43-code long-run series excludes those groups so complete years remain comparable.",
  "All Census values are nominal customs value and are not adjusted for inflation.",
  "Current-year values are year to date and must not be compared with complete years as though the periods were equal.",
] as const;

function basisPoints(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000);
}

function vesselMetrics(
  totals: Pick<
    CensusPublicMetricTotals,
    | "vesselValueUsd"
    | "vesselWeightKg"
    | "containerizedVesselValueUsd"
    | "containerizedVesselWeightKg"
  >
): CorridorWatchVesselMetrics {
  return {
    vesselValueUsd: totals.vesselValueUsd,
    vesselWeightKg: totals.vesselWeightKg,
    containerizedVesselValueUsd: totals.containerizedVesselValueUsd,
    containerizedVesselWeightKg: totals.containerizedVesselWeightKg,
    containerizedShareBps: basisPoints(
      totals.containerizedVesselValueUsd,
      totals.vesselValueUsd
    ),
  };
}

function unitValueUsdPerKg(metrics: CorridorWatchVesselMetrics): number | null {
  if (metrics.vesselWeightKg <= 0) return null;
  return metrics.vesselValueUsd / metrics.vesselWeightKg;
}

function scopeSignal(
  scope: CensusPublicScopeSummary,
  countryCode: string
): CorridorWatchScopeSignal {
  const country = scope.countries.find(
    (candidate) => candidate.countryCode === countryCode
  );
  if (!country) {
    return {
      status: "unavailable",
      scope: scope.scope,
      basis: scope.basis,
      originShareBps: null,
      metrics: null,
    };
  }
  return {
    status: "observed",
    scope: scope.scope,
    basis: scope.basis,
    originShareBps: basisPoints(
      country.totals.vesselValueUsd,
      scope.totals.vesselValueUsd
    ),
    metrics: vesselMetrics(country.totals),
  };
}

function originHistoryScopeSignal(
  scope: CensusPublicOriginHistoryScopeSummary
): CorridorWatchScopeSignal {
  return {
    status: "observed",
    scope: scope.scope,
    basis: scope.basis,
    originShareBps: basisPoints(
      scope.originTotals.vesselValueUsd,
      scope.totals.vesselValueUsd
    ),
    metrics: vesselMetrics(scope.originTotals),
  };
}

function sourceUse(
  scope: Pick<CensusPublicScopeSummary, "scope" | "source">,
  period: string
): IntelSourceUse {
  return {
    sourceId: "census_trade_downloads",
    sourceUrl: scope.source.dataUrl,
    displayName:
      scope.scope === "california_destination"
        ? `State Imports HS6, ${period}`
        : `Port Imports HS6, ${period}`,
    asOf: period,
    fetchedAt: scope.source.fetchedAt,
    reviewedAt: null,
    integritySha256: scope.source.archiveSha256,
  };
}

function sourceChecksum(
  scope: CorridorWatchScope,
  period: string,
  source: CensusPublicSourceFile
): CorridorWatchSourceChecksum {
  return {
    scope,
    period,
    fileName: source.fileName,
    sourceUrl: source.dataUrl,
    archiveSha256: source.archiveSha256,
    fetchedAt: source.fetchedAt,
    lastModified: source.lastModified,
  };
}

function dedupeSourceChecksums(
  checksums: CorridorWatchSourceChecksum[]
): CorridorWatchSourceChecksum[] {
  const seen = new Set<string>();
  return checksums.filter((checksum) => {
    const key = `${checksum.scope}|${checksum.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countryDictionarySourceUse(
  snapshot: CensusPublicHardwareSnapshot
): IntelSourceUse {
  return {
    sourceId: "census_schedule_c",
    sourceUrl: snapshot.countryDictionarySource.dataUrl,
    displayName: "Schedule C country code file",
    asOf: snapshot.countryDictionarySource.lastModified
      ? new Date(snapshot.countryDictionarySource.lastModified)
          .toISOString()
          .slice(0, 10)
      : null,
    fetchedAt: snapshot.countryDictionarySource.fetchedAt,
    reviewedAt: null,
    integritySha256: snapshot.countryDictionarySource.archiveSha256,
  };
}

function countryDictionaryChecksum(
  snapshot: CensusPublicHardwareSnapshot
): CorridorWatchSourceChecksum {
  return {
    scope: "country_dictionary",
    period: null,
    fileName: "country3.txt",
    sourceUrl: snapshot.countryDictionarySource.dataUrl,
    archiveSha256: snapshot.countryDictionarySource.archiveSha256,
    fetchedAt: snapshot.countryDictionarySource.fetchedAt,
    lastModified: snapshot.countryDictionarySource.lastModified,
  };
}

function compareByVesselValue<
  T extends { metrics: CorridorWatchVesselMetrics },
>(left: T, right: T): number {
  return (
    right.metrics.vesselValueUsd - left.metrics.vesselValueUsd
  );
}

export function selectCorridorWatchPrimaryGateway(
  signals: readonly CorridorWatchGatewaySignal[]
): CorridorWatchGatewaySignal | null {
  return signals.reduce<CorridorWatchGatewaySignal | null>(
    (primary, signal) =>
      primary == null ||
      signal.metrics.vesselValueUsd > primary.metrics.vesselValueUsd
        ? signal
        : primary,
    null
  );
}

function originNameFor(
  snapshot: CensusPublicHardwareSnapshot,
  countryCode: string
): string | null {
  for (const period of [...snapshot.periods].reverse()) {
    for (const scope of [
      period.westCoastGateways,
      period.californiaDestination,
    ]) {
      const country = scope.countries.find(
        (candidate) => candidate.countryCode === countryCode
      );
      if (country) return country.countryName;
    }
  }
  return null;
}

export function buildCensusPublicOriginCorridorWatch(
  snapshotInput: CensusPublicHardwareSnapshot,
  input: { originCountryCode: string }
): CensusPublicOriginCorridorWatch {
  const snapshot = validateCensusPublicHardwareSnapshot(snapshotInput);
  const originCountryCode = input.originCountryCode.trim();
  if (!/^\d{4}$/.test(originCountryCode)) {
    throw new Error("Corridor watch origin country code must use four digits");
  }
  const originCountryName = originNameFor(snapshot, originCountryCode);
  if (!originCountryName) {
    throw new Error(
      `Corridor watch origin country ${originCountryCode} is unavailable`
    );
  }

  const periods = [...snapshot.periods].sort((left, right) =>
    left.period.localeCompare(right.period)
  );
  const completeYearOriginHistory = periods
    .filter((period) => period.periodKind === "complete_year")
    .map((period): CorridorWatchOriginHistoryPoint => {
      const year = Number(period.period.slice(0, 4));
      const basketComparable = year >= 2022;
      return {
        year,
        period: period.period,
        basketComparable,
        comparisonBasis: basketComparable
          ? "comparable_2022_hs_basket"
          : "incompatible_pre_2022_hs_basket",
        californiaDestination: scopeSignal(
          period.californiaDestination,
          originCountryCode
        ),
        westCoastGateways: scopeSignal(
          period.westCoastGateways,
          originCountryCode
        ),
      };
    });
  const fixedBasketSlice = snapshot.originHistorySlices.find(
    (slice) => slice.originCountryCode === originCountryCode
  );
  const fixedBasketOriginHistory = fixedBasketSlice
    ? (() => {
        const completeYears = fixedBasketSlice.periods
          .filter((period) => period.periodKind === "complete_year")
          .map(
            (period): CorridorWatchFixedBasketHistoryPoint => ({
              year: Number(period.period.slice(0, 4)),
              period: period.period,
              californiaDestination: originHistoryScopeSignal(
                period.californiaDestination
              ),
              westCoastGateways: originHistoryScopeSignal(
                period.westCoastGateways
              ),
            })
          );
        const currentHistoryPeriod = fixedBasketSlice.periods.find(
          (period) => period.period === snapshot.asOfMonth
        );
        if (
          !currentHistoryPeriod ||
          currentHistoryPeriod.periodKind !== "current_ytd"
        ) {
          throw new Error(
            `Corridor watch origin ${originCountryCode} fixed-basket current period is unavailable`
          );
        }
        const [fixedCurrentYear, fixedCurrentMonth] =
          currentHistoryPeriod.period.split("-").map(Number);
        return {
          basis: "fixed_core43" as const,
          basketId: fixedBasketSlice.basketId,
          applicableHsCodeCount: fixedBasketSlice.applicableHsCodeCount,
          startYear: fixedBasketSlice.startYear,
          completeYears,
          currentYtd: {
            year: fixedCurrentYear,
            throughMonth: fixedCurrentMonth,
            period: currentHistoryPeriod.period,
            periodKind: "current_ytd" as const,
            californiaDestination: originHistoryScopeSignal(
              currentHistoryPeriod.californiaDestination
            ),
            westCoastGateways: originHistoryScopeSignal(
              currentHistoryPeriod.westCoastGateways
            ),
          },
        };
      })()
    : null;
  const current = periods.find(
    (period) => period.period === snapshot.asOfMonth
  );
  if (!current) {
    throw new Error("Corridor watch current Census period is unavailable");
  }

  const originSegments =
    snapshot.currentWestCoastCorridors.positiveVesselSegments.filter(
      (segment) => segment.countryCode === originCountryCode
    );
  const originSegmentTotals = originSegments.reduce(
    (totals, segment) => ({
      vesselValueUsd: totals.vesselValueUsd + segment.vesselValueUsd,
      vesselWeightKg: totals.vesselWeightKg + segment.vesselWeightKg,
      containerizedVesselValueUsd:
        totals.containerizedVesselValueUsd +
        segment.containerizedVesselValueUsd,
      containerizedVesselWeightKg:
        totals.containerizedVesselWeightKg +
        segment.containerizedVesselWeightKg,
    }),
    {
      vesselValueUsd: 0,
      vesselWeightKg: 0,
      containerizedVesselValueUsd: 0,
      containerizedVesselWeightKg: 0,
    }
  );
  const currentWestCoastCountry = current.westCoastGateways.countries.find(
    (country) => country.countryCode === originCountryCode
  );
  if (currentWestCoastCountry) {
    for (const metric of [
      "vesselValueUsd",
      "vesselWeightKg",
      "containerizedVesselValueUsd",
      "containerizedVesselWeightKg",
    ] as const) {
      if (originSegmentTotals[metric] !== currentWestCoastCountry.totals[metric]) {
        throw new Error(
          `Corridor watch origin ${originCountryCode} ${metric} does not reconcile to its current West Coast country total`
        );
      }
    }
  } else if (originSegments.length > 0) {
    throw new Error(
      `Corridor watch origin ${originCountryCode} has segments without a current country rollup`
    );
  }
  const originWestCoastTotal = originSegmentTotals.vesselValueUsd;
  const gatewayGroups = new Map<
    string,
    Omit<CorridorWatchGatewaySignal, "originShareBps">
  >();
  for (const segment of originSegments) {
    const existing = gatewayGroups.get(segment.gatewayDistrictCode);
    const aggregate = {
      vesselValueUsd:
        (existing?.metrics.vesselValueUsd ?? 0) + segment.vesselValueUsd,
      vesselWeightKg:
        (existing?.metrics.vesselWeightKg ?? 0) + segment.vesselWeightKg,
      containerizedVesselValueUsd:
        (existing?.metrics.containerizedVesselValueUsd ?? 0) +
        segment.containerizedVesselValueUsd,
      containerizedVesselWeightKg:
        (existing?.metrics.containerizedVesselWeightKg ?? 0) +
        segment.containerizedVesselWeightKg,
    };
    gatewayGroups.set(segment.gatewayDistrictCode, {
      status: "observed",
      gatewayDistrictCode: segment.gatewayDistrictCode,
      gatewayDistrictLabel:
        GATEWAY_LABELS.get(segment.gatewayDistrictCode) ??
        `District ${segment.gatewayDistrictCode}`,
      metrics: vesselMetrics(aggregate),
    });
  }
  const currentGatewaySignals = [...gatewayGroups.values()]
    .map(
      (signal): CorridorWatchGatewaySignal => ({
        ...signal,
        originShareBps:
          basisPoints(
            signal.metrics.vesselValueUsd,
            originWestCoastTotal
          ) ?? 0,
      })
    )
    .sort(compareByVesselValue);

  const currentCategorySignals = (
    Object.keys(
      STARTUP_HARDWARE_CATEGORY_LABELS
    ) as StartupHardwareCategory[]
  ).flatMap((category): CorridorWatchCategorySignal[] => {
    const categorySegments = originSegments.filter(
      (segment) => segment.category === category
    );
    if (categorySegments.length === 0) return [];
    const categoryTotals = categorySegments.reduce(
      (totals, segment) => ({
        vesselValueUsd: totals.vesselValueUsd + segment.vesselValueUsd,
        vesselWeightKg: totals.vesselWeightKg + segment.vesselWeightKg,
        containerizedVesselValueUsd:
          totals.containerizedVesselValueUsd +
          segment.containerizedVesselValueUsd,
        containerizedVesselWeightKg:
          totals.containerizedVesselWeightKg +
          segment.containerizedVesselWeightKg,
      }),
      {
        vesselValueUsd: 0,
        vesselWeightKg: 0,
        containerizedVesselValueUsd: 0,
        containerizedVesselWeightKg: 0,
      }
    );
    const gatewaySignals = categorySegments
      .map(
        (segment): CorridorWatchCategoryGatewaySignal => ({
          status: "observed",
          gatewayDistrictCode: segment.gatewayDistrictCode,
          gatewayDistrictLabel:
            GATEWAY_LABELS.get(segment.gatewayDistrictCode) ??
            `District ${segment.gatewayDistrictCode}`,
          originShareBps:
            basisPoints(segment.vesselValueUsd, originWestCoastTotal) ?? 0,
          categoryShareBps:
            basisPoints(
              segment.vesselValueUsd,
              categoryTotals.vesselValueUsd
            ) ?? 0,
          metrics: vesselMetrics(segment),
        })
      )
      .sort(compareByVesselValue);
    const metrics = vesselMetrics(categoryTotals);
    const observedPrimaryGateway = gatewaySignals[0];
    const comparisonGateways = gatewaySignals.slice(1).filter(
      (gateway) =>
        gateway.categoryShareBps >= 1_000 &&
        gateway.metrics.vesselValueUsd >= 50_000_000
    );
    const unitValue = unitValueUsdPerKg(metrics);
    const commercialCues: CorridorWatchCategorySignal["commercialCues"] = [];
    if (
      metrics.vesselWeightKg >= 100_000_000 &&
      unitValue != null &&
      unitValue <= 6
    ) {
      commercialCues.push("high_aggregate_weight_low_unit_value");
    }
    if (
      metrics.vesselValueUsd >= 100_000_000 &&
      unitValue != null &&
      unitValue >= 50
    ) {
      commercialCues.push("high_unit_value");
    }
    return [
      {
        status: "observed",
        category,
        categoryLabel: STARTUP_HARDWARE_CATEGORY_LABELS[category],
        originShareBps:
          basisPoints(categoryTotals.vesselValueUsd, originWestCoastTotal) ??
          0,
        unitValueUsdPerKg: unitValue,
        researchPosture:
          observedPrimaryGateway.categoryShareBps >= 8_000
            ? "primary_gateway_concentration"
            : comparisonGateways.length > 0
              ? "dual_gateway_comparison"
              : "distributed_observation",
        commercialCues,
        metrics,
        observedPrimaryGateway,
        comparisonGateways,
        gatewaySignals,
      },
    ];
  }).sort(compareByVesselValue);

  const sourceScopes = periods.flatMap((period) => [
    {
      scope: period.californiaDestination,
      scopeName: "california_destination" as const,
      period: period.period,
    },
    {
      scope: period.westCoastGateways,
      scopeName: "west_coast_gateway" as const,
      period: period.period,
    },
  ]);
  const fixedBasketSourceScopes = fixedBasketSlice
    ? fixedBasketSlice.periods.flatMap((period) => [
        {
          scope: period.californiaDestination,
          scopeName: "california_destination" as const,
          period: period.period,
        },
        {
          scope: period.westCoastGateways,
          scopeName: "west_coast_gateway" as const,
          period: period.period,
        },
      ])
    : [];
  const sources = dedupeIntelSourceUses([
    ...sourceScopes.map(({ scope, period }) => sourceUse(scope, period)),
    ...fixedBasketSourceScopes.map(({ scope, period }) =>
      sourceUse(scope, period)
    ),
    countryDictionarySourceUse(snapshot),
  ]);
  const sourceChecksums = dedupeSourceChecksums([
    ...sourceScopes.map(({ scope, scopeName, period }) =>
      sourceChecksum(scopeName, period, scope.source)
    ),
    ...fixedBasketSourceScopes.map(({ scope, scopeName, period }) =>
      sourceChecksum(scopeName, period, scope.source)
    ),
    countryDictionaryChecksum(snapshot),
  ]);
  const topTwoGatewayShareBps =
    currentGatewaySignals.length === 0
      ? null
      : basisPoints(
          currentGatewaySignals
            .slice(0, 2)
            .reduce(
              (sum, signal) => sum + signal.metrics.vesselValueUsd,
              0
            ),
          originWestCoastTotal
        );
  const [currentYear, currentMonth] = snapshot.asOfMonth
    .split("-")
    .map(Number);
  const currentYtd: CorridorWatchCurrentPeriod = {
    year: currentYear,
    throughMonth: currentMonth,
    period: snapshot.asOfMonth,
    periodKind: "current_ytd",
    basketComparable: true,
    californiaDestination: scopeSignal(
      current.californiaDestination,
      originCountryCode
    ),
    westCoastGateways: scopeSignal(
      current.westCoastGateways,
      originCountryCode
    ),
  };

  return {
    kind: "census_public_origin_corridor_watch",
    watchId: `origin:${originCountryCode}:west-coast-hardware:${snapshot.asOfMonth}`,
    asOfMonth: snapshot.asOfMonth,
    generatedAt: snapshot.generatedAt,
    originCountryCode,
    originCountryName,
    routeReadiness: "research_only",
    completeYearOriginHistory,
    fixedBasketOriginHistory,
    currentYtd,
    currentGatewaySignals,
    currentCategorySignals,
    currentCategoryGatewaySegmentCount: originSegments.length,
    topTwoGatewayShareBps,
    dataAvailability: {
      aggregateOriginHistory: completeYearOriginHistory.some(
        (period) =>
          period.californiaDestination.status === "observed" ||
          period.westCoastGateways.status === "observed"
      ) ||
        fixedBasketOriginHistory != null
        ? "observed"
        : "unavailable",
      currentCategoryGatewaySegments:
        originSegments.length > 0 ? "observed" : "unavailable",
      californiaDestinationSignal: currentYtd.californiaDestination.status,
      foreignOriginPort: "unavailable",
      companyShipmentRecords: "unavailable",
      portToPortLanes: "unavailable",
      freightRates: "unavailable",
      carrierServices: "unavailable",
      transitTimeReliability: "unavailable",
    },
    requiredEvidence: REQUIRED_EVIDENCE.map((evidence) => ({ ...evidence })),
    sources,
    sourceChecksums,
    limitations: [...LIMITATIONS],
  };
}

export function buildChinaWestCoastCorridorWatch(
  snapshot: CensusPublicHardwareSnapshot
): CensusPublicOriginCorridorWatch {
  return buildCensusPublicOriginCorridorWatch(snapshot, {
    originCountryCode: "5700",
  });
}

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatPercent(bps: number | null): string {
  return bps == null ? "unavailable" : `${(bps / 100).toFixed(2)}%`;
}

export function buildOceanHardwareRoutingResearchBrief(
  watch: CensusPublicOriginCorridorWatch
): OceanHardwareRoutingResearchBrief {
  const westCoast = watch.currentYtd.westCoastGateways;
  const california = watch.currentYtd.californiaDestination;
  const firstGateway = watch.currentGatewaySignals[0];
  const secondGateway = watch.currentGatewaySignals[1];
  const findings: OceanHardwareRoutingResearchFinding[] = [
    {
      id: "origin_share",
      status: westCoast.status,
      statement:
        westCoast.status === "observed" && westCoast.metrics
          ? `${watch.originCountryName} accounts for ${formatPercent(
              westCoast.originShareBps
            )} of observed West Coast hardware vessel value in ${
              watch.asOfMonth
            }, or ${formatUsd(westCoast.metrics.vesselValueUsd)}.`
          : `${watch.originCountryName} West Coast origin value is unavailable for ${watch.asOfMonth}.`,
    },
    {
      id: "gateway_concentration",
      status:
        firstGateway && secondGateway ? "observed" : "unavailable",
      statement:
        firstGateway && secondGateway
          ? `${firstGateway.gatewayDistrictLabel} and ${secondGateway.gatewayDistrictLabel} account for ${formatPercent(
              watch.topTwoGatewayShareBps
            )} of observed ${watch.originCountryName} West Coast hardware vessel value.`
          : "Two observed gateway signals are not available.",
    },
    {
      id: "california_destination",
      status: california.status,
      statement:
        california.status === "observed" && california.metrics
          ? `California ultimate-destination records show ${formatUsd(
              california.metrics.vesselValueUsd
            )} from ${watch.originCountryName}, ${formatPercent(
              california.originShareBps
            )} of the California hardware vessel total. This is independent from gateway observations.`
          : `${watch.originCountryName} California ultimate-destination value is unavailable for ${watch.asOfMonth}.`,
    },
    {
      id: "category_gateway_pattern",
      status:
        watch.currentCategorySignals.length > 0 ? "observed" : "unavailable",
      statement:
        watch.currentCategorySignals.length > 0
          ? `${watch.currentCategoryGatewaySegmentCount} positive category-gateway segments support category-specific gateway research.`
          : "Category-gateway observations are unavailable.",
    },
  ];
  return {
    kind: "ocean_hardware_routing_research_brief",
    title: `${watch.originCountryName} to U.S. West Coast hardware routing research`,
    asOfMonth: watch.asOfMonth,
    originCountryCode: watch.originCountryCode,
    originCountryName: watch.originCountryName,
    routeReadiness: "research_only",
    status: "partial",
    findings,
    categoryResearch: watch.currentCategorySignals.map((category) => ({
      category: category.category,
      categoryLabel: category.categoryLabel,
      observedPrimaryGateway: {
        gatewayDistrictCode:
          category.observedPrimaryGateway.gatewayDistrictCode,
        gatewayDistrictLabel:
          category.observedPrimaryGateway.gatewayDistrictLabel,
        vesselValueUsd:
          category.observedPrimaryGateway.metrics.vesselValueUsd,
        categoryShareBps:
          category.observedPrimaryGateway.categoryShareBps,
      },
      comparisonGateways: category.comparisonGateways.map((gateway) => ({
        gatewayDistrictCode: gateway.gatewayDistrictCode,
        gatewayDistrictLabel: gateway.gatewayDistrictLabel,
        vesselValueUsd: gateway.metrics.vesselValueUsd,
        categoryShareBps: gateway.categoryShareBps,
      })),
    })),
    requiredEvidence: watch.requiredEvidence.map((evidence) => ({
      ...evidence,
    })),
    sources: watch.sources.map((source) => ({ ...source })),
    sourceChecksums: watch.sourceChecksums.map((source) => ({ ...source })),
    limitations: [...watch.limitations],
  };
}
