import {
  composeAnswerDocument,
  dedupeAnswerSources,
  type AnswerDocument,
  type AnswerConfidence,
  type AnswerFact,
  type AnswerLimitation,
  type AnswerStatus,
} from "../answers/document";
import type { IntelSourceUse } from "../sources";

export const STARTUP_PRODUCTION_HARDWARE_BASKET = [
  { code: "8413", label: "Pumps for liquids", category: "factory_process", introducedYear: null },
  { code: "8414", label: "Air and vacuum pumps, compressors, and fans", category: "factory_process", introducedYear: null },
  { code: "8415", label: "Air-conditioning machinery", category: "factory_process", introducedYear: null },
  { code: "8418", label: "Refrigeration and freezing equipment", category: "factory_process", introducedYear: null },
  { code: "8419", label: "Thermal-treatment machinery", category: "factory_process", introducedYear: null },
  { code: "8421", label: "Centrifuges and filtering or purifying machinery", category: "factory_process", introducedYear: null },
  { code: "8422", label: "Cleaning, filling, sealing, and packing machinery", category: "factory_process", introducedYear: null },
  { code: "8428", label: "Lifting, handling, loading, and unloading machinery", category: "factory_process", introducedYear: null },
  { code: "8456", label: "Machine tools using laser or other material-removal processes", category: "factory_process", introducedYear: null },
  { code: "8457", label: "Machining centers and unit-construction machines", category: "factory_process", introducedYear: null },
  { code: "8458", label: "Lathes for removing metal", category: "factory_process", introducedYear: null },
  { code: "8459", label: "Drilling, boring, milling, and threading machine tools", category: "factory_process", introducedYear: null },
  { code: "8460", label: "Grinding, honing, lapping, and finishing machine tools", category: "factory_process", introducedYear: null },
  { code: "8461", label: "Planing, shaping, slotting, and broaching machine tools", category: "factory_process", introducedYear: null },
  { code: "8462", label: "Metal-forming machine tools and presses", category: "factory_process", introducedYear: null },
  { code: "8463", label: "Other machine tools for working metal without removal", category: "factory_process", introducedYear: null },
  { code: "8466", label: "Parts and accessories for machine tools", category: "factory_process", introducedYear: null },
  { code: "8477", label: "Machinery for working rubber or plastics", category: "factory_process", introducedYear: null },
  { code: "847950", label: "Industrial robots", category: "factory_process", introducedYear: null },
  { code: "8485", label: "Additive-manufacturing machines", category: "factory_process", introducedYear: 2022 },
  { code: "8486", label: "Semiconductor and flat-panel manufacturing equipment", category: "factory_process", introducedYear: null },
  { code: "8471", label: "Computers, servers, and data-processing machines", category: "compute_electronics", introducedYear: null },
  { code: "8473", label: "Parts and accessories for data-processing machines", category: "compute_electronics", introducedYear: null },
  { code: "8517", label: "Telephone, networking, and data-transmission equipment", category: "compute_electronics", introducedYear: null },
  { code: "8525", label: "Transmission apparatus and digital cameras", category: "compute_electronics", introducedYear: null },
  { code: "8526", label: "Radar, radio navigation, and remote-control apparatus", category: "compute_electronics", introducedYear: null },
  { code: "8528", label: "Monitors, projectors, and reception apparatus", category: "compute_electronics", introducedYear: null },
  { code: "8534", label: "Printed circuits", category: "compute_electronics", introducedYear: null },
  { code: "8541", label: "Semiconductor devices and photosensitive devices", category: "compute_electronics", introducedYear: null },
  { code: "8542", label: "Electronic integrated circuits", category: "compute_electronics", introducedYear: null },
  { code: "8543", label: "Electrical machines and apparatus with individual functions", category: "compute_electronics", introducedYear: null },
  { code: "8501", label: "Electric motors and generators", category: "power_control", introducedYear: null },
  { code: "8502", label: "Generating sets and rotary converters", category: "power_control", introducedYear: null },
  { code: "8504", label: "Transformers, static converters, and inductors", category: "power_control", introducedYear: null },
  { code: "8507", label: "Electric accumulators and batteries", category: "power_control", introducedYear: null },
  { code: "8536", label: "Low-voltage switching, protection, and connection apparatus", category: "power_control", introducedYear: null },
  { code: "8537", label: "Electrical control and distribution boards and panels", category: "power_control", introducedYear: null },
  { code: "8544", label: "Insulated wire, cable, and optical-fiber cable", category: "power_control", introducedYear: null },
  { code: "9018", label: "Medical, surgical, dental, and veterinary instruments", category: "medical_lab", introducedYear: null },
  { code: "9021", label: "Orthopedic appliances, prosthetics, and hearing aids", category: "medical_lab", introducedYear: null },
  { code: "9022", label: "X-ray and ionizing-radiation apparatus", category: "medical_lab", introducedYear: null },
  { code: "9027", label: "Physical and chemical analysis instruments", category: "medical_lab", introducedYear: null },
  { code: "9030", label: "Electrical measuring and checking instruments", category: "medical_lab", introducedYear: null },
  { code: "9031", label: "Other measuring and checking instruments", category: "medical_lab", introducedYear: null },
  { code: "8806", label: "Unmanned aircraft", category: "drones_aerospace", introducedYear: 2022 },
  { code: "8807", label: "Parts of aircraft, spacecraft, and unmanned aircraft", category: "drones_aerospace", introducedYear: 2022 },
] as const;

export type StartupHardwareHsCode = (typeof STARTUP_PRODUCTION_HARDWARE_BASKET)[number]["code"];
export type StartupHardwareCategory = (typeof STARTUP_PRODUCTION_HARDWARE_BASKET)[number]["category"];

export const STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET_ID =
  "startup_production_hardware_core43_v1" as const;
export const STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET =
  STARTUP_PRODUCTION_HARDWARE_BASKET.filter(
    (entry) => entry.introducedYear == null
  );
export const STARTUP_PRODUCTION_HARDWARE_CORE43_CODES =
  STARTUP_PRODUCTION_HARDWARE_CORE43_BASKET.map((entry) => entry.code);

export const STARTUP_HARDWARE_CATEGORY_LABELS: Record<StartupHardwareCategory, string> = {
  factory_process: "Factory and process equipment",
  compute_electronics: "Compute and electronics",
  power_control: "Power and control",
  medical_lab: "Medical and lab equipment",
  drones_aerospace: "Drones and aerospace",
};

export const DEFAULT_HARDWARE_BASKET_EXCLUSIONS = [
  "Broad commodity inputs and raw materials",
  "General road vehicles and mobility equipment",
] as const;

export type OceanHardwareGeographyScope = "california_destination" | "west_coast_gateway";
export type OceanHardwareObjective = "process_optimization" | "startup_support" | "lead_generation";
export type OceanHardwareMode = "vessel" | "air";

export const WEST_COAST_GATEWAY_DISTRICTS = [
  { code: "25", label: "San Diego, CA" },
  { code: "27", label: "Los Angeles, CA" },
  { code: "28", label: "San Francisco, CA" },
  { code: "29", label: "Columbia-Snake, OR" },
  { code: "30", label: "Seattle, WA" },
] as const;

const WEST_COAST_GATEWAY_CODES = new Set<string>(WEST_COAST_GATEWAY_DISTRICTS.map((district) => district.code));
const BASKET_BY_CODE = new Map<string, (typeof STARTUP_PRODUCTION_HARDWARE_BASKET)[number]>(
  STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => [entry.code, entry])
);

export type OceanHardwareResearchWindow = {
  completeYears: number[];
  currentYtdYear: number;
  ytdThroughMonth: number;
  fromMonth: string;
  throughMonth: string;
};

export type OceanHardwareResearchRequest = {
  question: string;
  geographyScope: OceanHardwareGeographyScope;
  geographyLabel: string;
  geographyExplanation: string;
  window: OceanHardwareResearchWindow;
  originScope: "all_countries";
  modes: ["vessel", "air"];
  basketId: "startup_production_hardware_v1";
  hsCodes: StartupHardwareHsCode[];
  objectives: OceanHardwareObjective[];
  exclusions: string[];
};

export type CreateOceanHardwareResearchRequestInput = {
  question: string;
  asOfMonth: string;
  geographyScope?: OceanHardwareGeographyScope;
  westCoastBasis?: "customs_entry_district" | "port_of_unlading";
  objectives?: readonly OceanHardwareObjective[];
};

export type OceanHardwareImportRow = {
  id: string;
  period: string;
  hsCode: StartupHardwareHsCode;
  originCountryCode: string;
  originCountryName: string;
  geographyBasis: "destination_state" | "customs_district";
  destinationState: string | null;
  customsDistrictCode: string | null;
  customsDistrictName: string | null;
  vesselValueUsd: number | null;
  vesselWeightKg: number | null;
  airValueUsd: number | null;
  airWeightKg: number | null;
  sources: IntelSourceUse[];
};

export type ManualObservedCompanyEvidence = {
  id: string;
  companyName: string;
  companyLocation: string | null;
  observationType: "bill_of_lading" | "company_profile" | "provider_directory";
  observedRole: "importer" | "consignee" | "notify_party" | "unknown";
  shipmentDate: string | null;
  supplierName: string | null;
  originCountry: string | null;
  productDescription: string | null;
  hsCodes: string[];
  arrivalPort: string | null;
  weightKg: number | null;
  containerCount: number | null;
  billOfLadingNumber: string | null;
  reviewedAt: string;
  companyQualification: "not_assessed";
  leadQualification: "not_assessed";
  caveats: string[];
  sources: IntelSourceUse[];
};

export type OceanHardwareCoverage = {
  status: AnswerStatus;
  aggregateData: "complete" | "partial" | "unavailable";
  companyEvidence: "manual_sample" | "unavailable";
  airCompanyEvidence: "manual_sample" | "unavailable";
  missingData: string[];
  notes: string[];
  sources: IntelSourceUse[];
};

export type DeriveOceanHardwareCoverageInput = {
  aggregateData: OceanHardwareCoverage["aggregateData"];
  hasCompanyEvidence: boolean;
  hasAirCompanyEvidence?: boolean;
  missingData: readonly string[];
  notes: readonly string[];
  sources: readonly IntelSourceUse[];
};

export type DeriveOceanHardwareAggregateDataInput = {
  requestedQueryCount: number;
  successfulQueryCount: number;
};

export type OceanHardwareModeTotals = {
  vesselValueUsd: number | null;
  vesselWeightKg: number | null;
  airValueUsd: number | null;
  airWeightKg: number | null;
};

export type OceanHardwareRollupCoverage = {
  rowCount: number;
  observedHsCodes: StartupHardwareHsCode[];
  expectedHsCodeCount: number;
  originCountryCount: number;
};

export type OceanHardwareYearRollup = {
  year: number;
  periodKind: "complete_year" | "current_ytd";
  throughMonth: number;
  totals: OceanHardwareModeTotals;
  coverage: OceanHardwareRollupCoverage;
  sources: IntelSourceUse[];
};

export type OceanHardwareCategoryRollup = {
  category: StartupHardwareCategory;
  label: string;
  totals: OceanHardwareModeTotals;
  rowCount: number;
  hsCodes: StartupHardwareHsCode[];
  sources: IntelSourceUse[];
};

export type OceanHardwareCountryRollup = {
  countryCode: string;
  countryName: string;
  totals: OceanHardwareModeTotals;
  rowCount: number;
  sources: IntelSourceUse[];
};

export type OceanHardwareGeographyRollup = {
  geographyKey: string;
  geographyLabel: string;
  geographyBasis: "destination_state" | "customs_district" | "port_of_unlading";
  totals: OceanHardwareModeTotals;
  rowCount: number;
  sources: IntelSourceUse[];
};

export type OceanHardwareGatewayCorridorRollup = {
  period: string;
  category: StartupHardwareCategory;
  categoryLabel: string;
  countryCode: string;
  countryName: string;
  gatewayDistrictCode: string;
  gatewayDistrictLabel: string;
  vesselValueUsd: number;
  vesselWeightKg: number;
  containerizedVesselValueUsd: number;
  containerizedVesselWeightKg: number;
  sources: IntelSourceUse[];
};

export type OceanHardwareResearchReport = {
  document: AnswerDocument;
  request: OceanHardwareResearchRequest;
  coverage: OceanHardwareCoverage;
  totals: OceanHardwareModeTotals;
  years: OceanHardwareYearRollup[];
  categories: OceanHardwareCategoryRollup[];
  countries: OceanHardwareCountryRollup[];
  geographies: OceanHardwareGeographyRollup[];
  currentCategories: OceanHardwareCategoryRollup[];
  currentCountries: OceanHardwareCountryRollup[];
  currentGeographies: OceanHardwareGeographyRollup[];
  currentGatewayCorridors: OceanHardwareGatewayCorridorRollup[];
  observedCompanies: ManualObservedCompanyEvidence[];
};

export type OceanHardwarePrecomputedRollups = {
  totals: OceanHardwareModeTotals;
  years: OceanHardwareYearRollup[];
  categories: OceanHardwareCategoryRollup[];
  countries: OceanHardwareCountryRollup[];
  geographies: OceanHardwareGeographyRollup[];
  currentCategories: OceanHardwareCategoryRollup[];
  currentCountries: OceanHardwareCountryRollup[];
  currentGeographies: OceanHardwareGeographyRollup[];
  currentGatewayCorridors: OceanHardwareGatewayCorridorRollup[];
  sources: IntelSourceUse[];
};

export type ComposeOceanHardwareResearchReportInput = {
  request: OceanHardwareResearchRequest;
  rows?: readonly OceanHardwareImportRow[];
  precomputedRollups?: OceanHardwarePrecomputedRollups;
  observedCompanies?: readonly ManualObservedCompanyEvidence[];
  coverage: OceanHardwareCoverage;
  generatedAt: string;
  sources?: readonly IntelSourceUse[];
};

export function deriveOceanHardwareAggregateData(
  input: DeriveOceanHardwareAggregateDataInput
): OceanHardwareCoverage["aggregateData"] {
  if (
    !Number.isInteger(input.requestedQueryCount) ||
    !Number.isInteger(input.successfulQueryCount) ||
    input.requestedQueryCount < 0 ||
    input.successfulQueryCount < 0 ||
    input.successfulQueryCount > input.requestedQueryCount
  ) {
    throw new Error("Ocean hardware query counts must be non-negative integers with successes no greater than requests");
  }
  if (input.requestedQueryCount === 0 || input.successfulQueryCount === 0) {
    return "unavailable";
  }
  return input.successfulQueryCount === input.requestedQueryCount ? "complete" : "partial";
}

export function deriveOceanHardwareCoverage(
  input: DeriveOceanHardwareCoverageInput
): OceanHardwareCoverage {
  const hasAirCompanyEvidence = input.hasAirCompanyEvidence ?? false;
  const hasAnyEvidence =
    input.aggregateData !== "unavailable" ||
    input.hasCompanyEvidence ||
    hasAirCompanyEvidence;
  const status: AnswerStatus = !hasAnyEvidence
    ? "blocked"
    : input.aggregateData === "complete" && input.missingData.length === 0
      ? "complete"
      : "partial";

  return {
    status,
    aggregateData: input.aggregateData,
    companyEvidence: input.hasCompanyEvidence ? "manual_sample" : "unavailable",
    airCompanyEvidence: hasAirCompanyEvidence ? "manual_sample" : "unavailable",
    missingData: [...input.missingData],
    notes: [...input.notes],
    sources: dedupeAnswerSources(input.sources),
  };
}

function parseMonth(value: string, label: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must use YYYY-MM`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`${label} must contain a valid month`);
  return { year, month };
}

export function buildOceanHardwareResearchWindow(asOfMonth: string): OceanHardwareResearchWindow {
  const { year, month } = parseMonth(asOfMonth, "Research asOfMonth");
  const completeYears = Array.from({ length: 5 }, (_, index) => year - 5 + index);
  return {
    completeYears,
    currentYtdYear: year,
    ytdThroughMonth: month,
    fromMonth: `${completeYears[0]}-01`,
    throughMonth: asOfMonth,
  };
}

export function oceanHardwareGeographySemantics(
  scope: OceanHardwareGeographyScope,
  westCoastBasis: "customs_entry_district" | "port_of_unlading" = "customs_entry_district"
): {
  label: string;
  explanation: string;
} {
  if (scope === "california_destination") {
    return {
      label: "California destination",
      explanation:
        "California destination data describes the reported destination state. It does not prove which customs gateway handled the shipment or which California company bought it.",
    };
  }
  if (westCoastBasis === "port_of_unlading") {
    return {
      label: "West Coast ports of unlading",
      explanation:
        "West Coast data describes ports of unlading within the San Diego, Los Angeles, San Francisco, Columbia-Snake, and Seattle customs districts. It does not prove the importer or final destination is on the West Coast.",
    };
  }
  return {
    label: "West Coast customs gateways",
    explanation:
      "West Coast gateway data describes entry through the San Diego, Los Angeles, San Francisco, Columbia-Snake, or Seattle customs districts. It does not prove the importer or final destination is on the West Coast.",
  };
}

export function createOceanHardwareResearchRequest(
  input: CreateOceanHardwareResearchRequestInput
): OceanHardwareResearchRequest {
  const question = input.question.trim();
  if (!question) throw new Error("Research question cannot be empty");
  const geographyScope = input.geographyScope ?? "california_destination";
  const geography = oceanHardwareGeographySemantics(
    geographyScope,
    input.westCoastBasis
  );
  const objectives = [...(input.objectives ?? ["process_optimization", "startup_support", "lead_generation"])] as OceanHardwareObjective[];
  return {
    question,
    geographyScope,
    geographyLabel: geography.label,
    geographyExplanation: geography.explanation,
    window: buildOceanHardwareResearchWindow(input.asOfMonth),
    originScope: "all_countries",
    modes: ["vessel", "air"],
    basketId: "startup_production_hardware_v1",
    hsCodes: STARTUP_PRODUCTION_HARDWARE_BASKET.map((entry) => entry.code),
    objectives: [...new Set(objectives)],
    exclusions: [...DEFAULT_HARDWARE_BASKET_EXCLUSIONS],
  };
}

function finiteNonNegative(value: number | null, label: string): void {
  if (value != null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be a finite non-negative number or null`);
  }
}

function validateRow(row: OceanHardwareImportRow): void {
  if (!row.id.trim()) throw new Error("Ocean hardware row id cannot be empty");
  parseMonth(row.period, `Row ${row.id} period`);
  if (!BASKET_BY_CODE.has(row.hsCode)) throw new Error(`Row ${row.id} has an unknown hardware HS code`);
  if (!row.originCountryCode.trim() || !row.originCountryName.trim()) {
    throw new Error(`Row ${row.id} needs an origin country code and name`);
  }
  if (row.geographyBasis === "destination_state") {
    if (!row.destinationState || row.customsDistrictCode || row.customsDistrictName) {
      throw new Error(`Row ${row.id} must carry destination-state geography only`);
    }
  } else if (!row.customsDistrictCode || !row.customsDistrictName || row.destinationState) {
    throw new Error(`Row ${row.id} must carry customs-district geography only`);
  }
  finiteNonNegative(row.vesselValueUsd, `Row ${row.id} vessel value`);
  finiteNonNegative(row.vesselWeightKg, `Row ${row.id} vessel weight`);
  finiteNonNegative(row.airValueUsd, `Row ${row.id} air value`);
  finiteNonNegative(row.airWeightKg, `Row ${row.id} air weight`);
}

function rowIsInRequest(row: OceanHardwareImportRow, request: OceanHardwareResearchRequest): boolean {
  const { year, month } = parseMonth(row.period, `Row ${row.id} period`);
  const inCompleteYear = request.window.completeYears.includes(year);
  const inCurrentYtd = year === request.window.currentYtdYear && month <= request.window.ytdThroughMonth;
  if (!inCompleteYear && !inCurrentYtd) return false;
  if (!request.hsCodes.includes(row.hsCode)) return false;
  const basketEntry = BASKET_BY_CODE.get(row.hsCode);
  if (basketEntry?.introducedYear != null && year < basketEntry.introducedYear) return false;
  if (request.geographyScope === "california_destination") {
    return row.geographyBasis === "destination_state" && row.destinationState?.toUpperCase() === "CA";
  }
  return (
    row.geographyBasis === "customs_district" &&
    row.customsDistrictCode != null &&
    WEST_COAST_GATEWAY_CODES.has(row.customsDistrictCode)
  );
}

function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function totalsFor(rows: readonly OceanHardwareImportRow[]): OceanHardwareModeTotals {
  return {
    vesselValueUsd: sumNullable(rows.map((row) => row.vesselValueUsd)),
    vesselWeightKg: sumNullable(rows.map((row) => row.vesselWeightKg)),
    airValueUsd: sumNullable(rows.map((row) => row.airValueUsd)),
    airWeightKg: sumNullable(rows.map((row) => row.airWeightKg)),
  };
}

function sourcesFor(rows: readonly { sources: IntelSourceUse[] }[]): IntelSourceUse[] {
  return dedupeAnswerSources(rows.flatMap((row) => row.sources));
}

function expectedHsCodesForYear(year: number, request: OceanHardwareResearchRequest): StartupHardwareHsCode[] {
  return request.hsCodes.filter((code) => {
    const introducedYear = BASKET_BY_CODE.get(code)?.introducedYear;
    return introducedYear == null || introducedYear <= year;
  });
}

function coverageForRows(
  rows: readonly OceanHardwareImportRow[],
  year: number,
  request: OceanHardwareResearchRequest
): OceanHardwareRollupCoverage {
  return {
    rowCount: rows.length,
    observedHsCodes: [...new Set(rows.map((row) => row.hsCode))].sort(),
    expectedHsCodeCount: expectedHsCodesForYear(year, request).length,
    originCountryCount: new Set(rows.map((row) => row.originCountryCode)).size,
  };
}

function buildYearRollups(
  rows: readonly OceanHardwareImportRow[],
  request: OceanHardwareResearchRequest
): OceanHardwareYearRollup[] {
  const years = [
    ...request.window.completeYears.map((year) => ({ year, periodKind: "complete_year" as const, throughMonth: 12 })),
    {
      year: request.window.currentYtdYear,
      periodKind: "current_ytd" as const,
      throughMonth: request.window.ytdThroughMonth,
    },
  ];
  return years.map((spec) => {
    const yearRows = rows.filter((row) => Number(row.period.slice(0, 4)) === spec.year);
    return {
      ...spec,
      totals: totalsFor(yearRows),
      coverage: coverageForRows(yearRows, spec.year, request),
      sources: sourcesFor(yearRows),
    };
  });
}

function buildCategoryRollups(rows: readonly OceanHardwareImportRow[]): OceanHardwareCategoryRollup[] {
  return (Object.keys(STARTUP_HARDWARE_CATEGORY_LABELS) as StartupHardwareCategory[]).map((category) => {
    const categoryRows = rows.filter((row) => BASKET_BY_CODE.get(row.hsCode)?.category === category);
    return {
      category,
      label: STARTUP_HARDWARE_CATEGORY_LABELS[category],
      totals: totalsFor(categoryRows),
      rowCount: categoryRows.length,
      hsCodes: [...new Set(categoryRows.map((row) => row.hsCode))].sort(),
      sources: sourcesFor(categoryRows),
    };
  });
}

function compareTotals(a: OceanHardwareModeTotals, b: OceanHardwareModeTotals): number {
  return (b.vesselValueUsd ?? b.airValueUsd ?? -1) - (a.vesselValueUsd ?? a.airValueUsd ?? -1);
}

function buildCountryRollups(rows: readonly OceanHardwareImportRow[]): OceanHardwareCountryRollup[] {
  const groups = new Map<string, OceanHardwareImportRow[]>();
  for (const row of rows) {
    const key = `${row.originCountryCode}|${row.originCountryName}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, countryRows]) => {
      const [countryCode, countryName] = key.split("|");
      return {
        countryCode,
        countryName,
        totals: totalsFor(countryRows),
        rowCount: countryRows.length,
        sources: sourcesFor(countryRows),
      };
    })
    .sort((a, b) => compareTotals(a.totals, b.totals) || a.countryName.localeCompare(b.countryName));
}

function buildGeographyRollups(rows: readonly OceanHardwareImportRow[]): OceanHardwareGeographyRollup[] {
  const groups = new Map<string, OceanHardwareImportRow[]>();
  for (const row of rows) {
    const key =
      row.geographyBasis === "destination_state"
        ? `state:${row.destinationState}`
        : `district:${row.customsDistrictCode}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, geographyRows]) => {
      const first = geographyRows[0];
      return {
        geographyKey: key,
        geographyLabel:
          first.geographyBasis === "destination_state"
            ? `${first.destinationState} destination`
            : first.customsDistrictName ?? first.customsDistrictCode ?? "Unknown district",
        geographyBasis: first.geographyBasis,
        totals: totalsFor(geographyRows),
        rowCount: geographyRows.length,
        sources: sourcesFor(geographyRows),
      };
    })
    .sort((a, b) => compareTotals(a.totals, b.totals) || a.geographyLabel.localeCompare(b.geographyLabel));
}

function compactUsd(value: number | null): string {
  if (value == null) return "Unavailable";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}k`;
  return `$${value.toFixed(0)}`;
}

function valueFact(
  id: string,
  label: string,
  value: number | null,
  period: string,
  detail: string,
  sources: IntelSourceUse[],
  confidence: AnswerConfidence
): AnswerFact {
  return {
    id,
    label,
    value,
    displayValue: compactUsd(value),
    unit: "USD",
    period,
    detail,
    confidence: value == null ? "not_assessed" : confidence,
    sources,
  };
}

function describeLoadedPeriods(years: readonly OceanHardwareYearRollup[]): string {
  const labels = years
    .filter((year) => year.coverage.rowCount > 0)
    .map((year) =>
      year.periodKind === "current_ytd"
        ? `${year.year} YTD through month ${String(year.throughMonth).padStart(2, "0")}`
        : String(year.year)
    );
  if (labels.length === 0) return "No official aggregate periods are loaded.";
  return `Aggregate rows are loaded for ${labels.join(", ")}. Their completeness is governed by the report coverage status and limitations.`;
}

function validateObservedCompany(evidence: ManualObservedCompanyEvidence): void {
  if (!evidence.id.trim() || !evidence.companyName.trim()) {
    throw new Error("Observed company evidence needs an id and company name");
  }
  if (Number.isNaN(new Date(evidence.reviewedAt).getTime())) {
    throw new Error(`Observed company ${evidence.id} needs a valid reviewedAt date`);
  }
  finiteNonNegative(evidence.weightKg, `Observed company ${evidence.id} weight`);
  finiteNonNegative(evidence.containerCount, `Observed company ${evidence.id} container count`);
}

function validateModeTotals(totals: OceanHardwareModeTotals, label: string): void {
  finiteNonNegative(totals.vesselValueUsd, `${label} vessel value`);
  finiteNonNegative(totals.vesselWeightKg, `${label} vessel weight`);
  finiteNonNegative(totals.airValueUsd, `${label} air value`);
  finiteNonNegative(totals.airWeightKg, `${label} air weight`);
}

function cloneModeTotals(totals: OceanHardwareModeTotals): OceanHardwareModeTotals {
  return { ...totals };
}

function clonePrecomputedRollups(
  rollups: OceanHardwarePrecomputedRollups,
  request: OceanHardwareResearchRequest
): OceanHardwarePrecomputedRollups {
  validateModeTotals(rollups.totals, "Precomputed total");
  const requestedYears = new Set([
    ...request.window.completeYears,
    request.window.currentYtdYear,
  ]);
  const seenYears = new Set<number>();
  const years = rollups.years.map((year) => {
    if (!requestedYears.has(year.year) || seenYears.has(year.year)) {
      throw new Error(`Precomputed year ${year.year} is outside the request or duplicated`);
    }
    seenYears.add(year.year);
    validateModeTotals(year.totals, `Precomputed year ${year.year}`);
    return {
      ...year,
      totals: cloneModeTotals(year.totals),
      coverage: {
        ...year.coverage,
        observedHsCodes: [...year.coverage.observedHsCodes],
      },
      sources: dedupeAnswerSources(year.sources),
    };
  });
  const cloneCategories = (categories: OceanHardwareCategoryRollup[]) =>
    categories.map((category) => {
      validateModeTotals(category.totals, `Precomputed category ${category.category}`);
      return {
        ...category,
        totals: cloneModeTotals(category.totals),
        hsCodes: [...category.hsCodes],
        sources: dedupeAnswerSources(category.sources),
      };
    });
  const cloneCountries = (countries: OceanHardwareCountryRollup[]) =>
    countries.map((country) => {
      validateModeTotals(country.totals, `Precomputed country ${country.countryCode}`);
      return {
        ...country,
        totals: cloneModeTotals(country.totals),
        sources: dedupeAnswerSources(country.sources),
      };
    });
  const cloneGeographies = (geographies: OceanHardwareGeographyRollup[]) =>
    geographies.map((geography) => {
      validateModeTotals(geography.totals, `Precomputed geography ${geography.geographyKey}`);
      return {
        ...geography,
        totals: cloneModeTotals(geography.totals),
        sources: dedupeAnswerSources(geography.sources),
      };
    });
  const currentGatewayCorridors = rollups.currentGatewayCorridors.map((corridor) => {
    if (
      corridor.period !== request.window.throughMonth ||
      !STARTUP_HARDWARE_CATEGORY_LABELS[corridor.category] ||
      !/^\d{4}$/.test(corridor.countryCode) ||
      !corridor.countryName.trim() ||
      !WEST_COAST_GATEWAY_CODES.has(corridor.gatewayDistrictCode) ||
      !corridor.gatewayDistrictLabel.trim()
    ) {
      throw new Error("Precomputed gateway corridor has invalid dimensions");
    }
    for (const [label, value] of [
      ["vessel value", corridor.vesselValueUsd],
      ["vessel weight", corridor.vesselWeightKg],
      ["containerized vessel value", corridor.containerizedVesselValueUsd],
      ["containerized vessel weight", corridor.containerizedVesselWeightKg],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Precomputed gateway corridor ${label} must be a safe non-negative integer`);
      }
    }
    if (
      corridor.vesselValueUsd === 0 ||
      corridor.containerizedVesselValueUsd > corridor.vesselValueUsd ||
      corridor.containerizedVesselWeightKg > corridor.vesselWeightKg
    ) {
      throw new Error("Precomputed gateway corridor has invalid vessel metrics");
    }
    return {
      ...corridor,
      sources: dedupeAnswerSources(corridor.sources),
    };
  });
  if (
    request.geographyScope === "california_destination" &&
    currentGatewayCorridors.length > 0
  ) {
    throw new Error("California destination reports cannot include gateway corridors");
  }
  const corridorTuples = currentGatewayCorridors.map(
    (corridor) =>
      `${corridor.category}:${corridor.countryCode}:${corridor.gatewayDistrictCode}`
  );
  if (new Set(corridorTuples).size !== corridorTuples.length) {
    throw new Error("Precomputed gateway corridor tuples must be unique");
  }
  return {
    totals: cloneModeTotals(rollups.totals),
    years,
    categories: cloneCategories(rollups.categories),
    countries: cloneCountries(rollups.countries),
    geographies: cloneGeographies(rollups.geographies),
    currentCategories: cloneCategories(rollups.currentCategories),
    currentCountries: cloneCountries(rollups.currentCountries),
    currentGeographies: cloneGeographies(rollups.currentGeographies),
    currentGatewayCorridors,
    sources: dedupeAnswerSources(rollups.sources),
  };
}

function totalsForYears(
  years: readonly OceanHardwareYearRollup[],
  selectedYears: ReadonlySet<number>
): OceanHardwareModeTotals {
  const selected = years.filter((year) => selectedYears.has(year.year));
  return {
    vesselValueUsd: sumNullable(selected.map((year) => year.totals.vesselValueUsd)),
    vesselWeightKg: sumNullable(selected.map((year) => year.totals.vesselWeightKg)),
    airValueUsd: sumNullable(selected.map((year) => year.totals.airValueUsd)),
    airWeightKg: sumNullable(selected.map((year) => year.totals.airWeightKg)),
  };
}

export function composeOceanHardwareResearchReport(
  input: ComposeOceanHardwareResearchReportInput
): OceanHardwareResearchReport {
  if (input.coverage.status === "complete" && input.coverage.missingData.length > 0) {
    throw new Error("Complete ocean hardware coverage cannot list missing data");
  }

  if (input.rows && input.precomputedRollups) {
    throw new Error("Ocean hardware report accepts raw rows or precomputed rollups, not both");
  }
  if (!input.rows && !input.precomputedRollups) {
    throw new Error("Ocean hardware report needs raw rows or precomputed rollups");
  }

  const inputRows = input.rows ?? [];
  const rowIds = new Set<string>();
  for (const row of inputRows) {
    validateRow(row);
    if (rowIds.has(row.id)) throw new Error(`Duplicate ocean hardware row id: ${row.id}`);
    rowIds.add(row.id);
  }
  const observedCompanies = (input.observedCompanies ?? []).map((evidence) => {
    validateObservedCompany(evidence);
    return {
      ...evidence,
      hsCodes: [...evidence.hsCodes],
      caveats: [...evidence.caveats],
      sources: dedupeAnswerSources(evidence.sources),
    };
  });
  if (new Set(observedCompanies.map((evidence) => evidence.id)).size !== observedCompanies.length) {
    throw new Error("Observed company evidence ids must be unique");
  }

  const rows = inputRows
    .filter((row) => rowIsInRequest(row, input.request))
    .map((row) => ({ ...row, sources: dedupeAnswerSources(row.sources) }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.hsCode.localeCompare(b.hsCode) || a.id.localeCompare(b.id));
  const computed = input.precomputedRollups
    ? clonePrecomputedRollups(input.precomputedRollups, input.request)
    : null;
  const years = computed?.years ?? buildYearRollups(rows, input.request);
  const categories = computed?.categories ?? buildCategoryRollups(rows);
  const countries = computed?.countries ?? buildCountryRollups(rows);
  const geographies = computed?.geographies ?? buildGeographyRollups(rows);
  const currentRows = rows.filter(
    (row) => Number(row.period.slice(0, 4)) === input.request.window.currentYtdYear
  );
  const currentCategories = computed?.currentCategories ?? buildCategoryRollups(currentRows);
  const currentCountries = computed?.currentCountries ?? buildCountryRollups(currentRows);
  const currentGeographies = computed?.currentGeographies ?? buildGeographyRollups(currentRows);
  const currentGatewayCorridors = computed?.currentGatewayCorridors ?? [];
  const totals = computed?.totals ?? totalsFor(rows);
  const aggregateSources = computed?.sources ?? sourcesFor(rows);
  const observedCompanySources = sourcesFor(observedCompanies);
  const completePeriod = `${input.request.window.completeYears[0]}-${input.request.window.completeYears.at(-1)}`;
  const ytdPeriod = `${input.request.window.currentYtdYear}-01 through ${input.request.window.throughMonth}`;
  const completeYearSet = new Set(input.request.window.completeYears);
  const completeRows = rows.filter((row) => completeYearSet.has(Number(row.period.slice(0, 4))));
  const ytdRows = currentRows;
  const completeSources = computed
    ? dedupeAnswerSources(
        computed.years
          .filter((year) => completeYearSet.has(year.year))
          .flatMap((year) => year.sources)
      )
    : sourcesFor(completeRows);
  const ytdSources = computed
    ? dedupeAnswerSources(
        computed.years
          .filter((year) => year.year === input.request.window.currentYtdYear)
          .flatMap((year) => year.sources)
      )
    : sourcesFor(ytdRows);
  const completeTotals = computed
    ? totalsForYears(computed.years, completeYearSet)
    : totalsFor(completeRows);
  const ytdTotals = computed
    ? totalsForYears(computed.years, new Set([input.request.window.currentYtdYear]))
    : totalsFor(ytdRows);
  const aggregateFactConfidence: AnswerConfidence =
    input.coverage.aggregateData === "complete"
      ? "high"
      : input.coverage.aggregateData === "partial"
        ? "medium"
        : "not_assessed";
  const partialAggregateDetail =
    input.coverage.aggregateData === "partial"
      ? " This is a sum of loaded aggregate rows, not a claim that every requested partition or period is complete."
      : "";

  const facts: AnswerFact[] = [
    valueFact(
      "complete_years_vessel_value",
      "Vessel import value, five complete years",
      completeTotals.vesselValueUsd,
      completePeriod,
      `Sum across the defined startup production-hardware proxy basket. Vessel and air values are not combined.${partialAggregateDetail}`,
      completeSources,
      aggregateFactConfidence
    ),
    valueFact(
      "current_ytd_vessel_value",
      "Vessel import value, current YTD",
      ytdTotals.vesselValueUsd,
      ytdPeriod,
      `Current-year vessel value through the latest month included in the request.${partialAggregateDetail}`,
      ytdSources,
      aggregateFactConfidence
    ),
    valueFact(
      "current_ytd_air_value",
      "Air import value, current YTD",
      ytdTotals.airValueUsd,
      ytdPeriod,
      `Current-year air value is shown separately to expose the company-level ocean-data gap.${partialAggregateDetail}`,
      ytdSources,
      aggregateFactConfidence
    ),
    {
      id: "observed_company_count",
      label: "Manually observed companies",
      value: observedCompanies.length,
      displayValue: String(observedCompanies.length),
      unit: "companies",
      period: null,
      detail: "Observed records are examples, not a complete importer census or a qualified startup lead list.",
      confidence: observedCompanies.length > 0 ? "medium" : "not_assessed",
      sources: observedCompanySources,
    },
  ];

  const limitations: AnswerLimitation[] = [
    {
      id: "geography_semantics",
      title: "Geography is a filter, not a company identity claim",
      detail: input.request.geographyExplanation,
      impact: "Do not infer importer location or final destination from a customs gateway, and do not infer gateway from destination-state data.",
      sources: aggregateSources,
    },
    {
      id: "proxy_basket",
      title: "The 46-code basket is a defined proxy",
      detail:
        "It covers production machinery, compute and electronics, power and control, medical and lab equipment, and drones and aerospace. Broad commodity inputs and general mobility equipment are excluded by default.",
      impact: "Totals must be labeled as this proxy basket, not all hardware bought or produced by startups.",
      sources: aggregateSources,
    },
    {
      id: "observed_company_sample",
      title: "Company evidence is manually observed and incomplete",
      detail:
        "Public provider pages and manual bill-of-lading research can identify examples, but they do not provide a complete, automated company-level dataset in this report.",
      impact: "Do not treat observed companies as verified startups, qualified leads, or the full importer population.",
      sources: observedCompanySources,
    },
    ...input.coverage.missingData.map((detail, index) => ({
      id: `coverage_gap_${index + 1}`,
      title: "Data coverage gap",
      detail,
      impact: "The answer remains partial until this gap is filled or explicitly accepted.",
      sources: dedupeAnswerSources(input.coverage.sources),
    })),
  ];

  const statusLabel = input.coverage.status === "complete" ? "Complete" : input.coverage.status === "blocked" ? "Blocked" : "Partial";
  const requestedWindow = `${input.request.window.completeYears[0]}-${input.request.window.completeYears.at(-1)} plus ${input.request.window.currentYtdYear} YTD through month ${String(input.request.window.ytdThroughMonth).padStart(2, "0")}`;
  const summary = `${statusLabel} research report for ${input.request.geographyLabel}. Requested window: ${requestedWindow}. ${describeLoadedPeriods(years)} Vessel and air measures remain separate, and the report uses the defined 46-code startup production-hardware proxy.`;

  const document = composeAnswerDocument({
    question: input.request.question,
    intent: "ocean_hardware_research",
    status: input.coverage.status,
    title: `U.S. hardware imports: ${input.request.geographyLabel}`,
    scope: {
      geographicBasis: input.request.geographyScope,
      geographyLabel: input.request.geographyLabel,
      fromMonth: input.request.window.fromMonth,
      throughMonth: input.request.window.throughMonth,
      transportModes: [...input.request.modes],
      commodityBasket: input.request.basketId,
      notes: [
        input.request.geographyExplanation,
        "HS 8485, 8806, and 8807 are not treated as available series before 2022.",
        "The 2021 proxy is not directly comparable with 2022 and later because the HS 2022 revision introduced headings 8485, 8806, and 8807, and this report does not backcast predecessor codes.",
        ...input.request.exclusions.map((exclusion) => `Excluded: ${exclusion}.`),
        ...input.coverage.notes,
      ],
    },
    summary,
    facts,
    findings: [],
    sections: [
      {
        id: "direct_answer",
        title: "Direct answer",
        description: summary,
        kind: "summary",
        factIds: [],
        findingIds: [],
        limitationIds: [],
      },
      {
        id: "key_metrics",
        title: "Key metrics",
        description: "Official aggregate trade values with vessel and air kept separate.",
        kind: "metrics",
        factIds: facts.map((fact) => fact.id),
        findingIds: [],
        limitationIds: [],
      },
      {
        id: "coverage_and_limits",
        title: "Coverage and limitations",
        description: "What this dataset can and cannot support.",
        kind: "limitations",
        factIds: [],
        findingIds: [],
        limitationIds: limitations.map((limitation) => limitation.id),
      },
      {
        id: "source_ledger",
        title: "Sources and methodology",
        description: "Exact source uses aggregated from report rows and manual observations.",
        kind: "sources",
        factIds: [],
        findingIds: [],
        limitationIds: [],
      },
    ],
    limitations,
    generatedAt: input.generatedAt,
    sources: dedupeAnswerSources([
      ...(input.sources ?? []),
      ...input.coverage.sources,
      ...aggregateSources,
      ...observedCompanySources,
    ]),
  });

  return {
    document,
    request: {
      ...input.request,
      window: { ...input.request.window, completeYears: [...input.request.window.completeYears] },
      modes: [...input.request.modes],
      hsCodes: [...input.request.hsCodes],
      objectives: [...input.request.objectives],
      exclusions: [...input.request.exclusions],
    },
    coverage: {
      ...input.coverage,
      missingData: [...input.coverage.missingData],
      notes: [...input.coverage.notes],
      sources: dedupeAnswerSources(input.coverage.sources),
    },
    totals,
    years,
    categories,
    countries,
    geographies,
    currentCategories,
    currentCountries,
    currentGeographies,
    currentGatewayCorridors,
    observedCompanies: observedCompanies.sort((a, b) =>
      (b.shipmentDate ?? "").localeCompare(a.shipmentDate ?? "") || a.companyName.localeCompare(b.companyName)
    ),
  };
}
