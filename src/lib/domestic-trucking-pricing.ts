import { tierRank } from "./security-sop";

export type DomesticMode = "FTL" | "LTL" | "PARTIAL" | "DRAYAGE";
export type EquipmentType = "DRY_VAN" | "REEFER" | "FLATBED" | "STEP_DECK" | "BOX_TRUCK" | "CONTAINER_DRAYAGE" | "UNKNOWN";
export type YesNoUnknown = "YES" | "NO" | "UNKNOWN";
export type RequiredRateFieldStatus = "ready" | "missing" | "assumed" | "advisory";
export type DomesticMarketScope = "US_DOMESTIC" | "NON_US" | "UNKNOWN";
export type DomesticEligibilityStatus = "eligible" | "missing_info" | "not_domestic_trucking" | "needs_human_review";
export type DomesticRateSourceType = "mock" | "manual" | "live";
export type DomesticQuoteApprovalState = "draft" | "needs_approval" | "approved_internal" | "rejected" | "sent_disabled_v1";

export type Money = {
  amount: number;
  currency: string;
};

export type DomesticRateSource = {
  type: "inquiry";
  inquiryId: string;
  subject: string;
  customerName: string | null;
  customerEmail: string | null;
};

export type DomesticLocation = {
  input: string | null;
  label: string;
  isUnitedStates: boolean;
  isGenericCountryOnly: boolean;
  confidence: "explicit_country" | "state_or_zip" | "known_city" | "non_us" | "unknown";
  stateCode: string | null;
  lat: number | null;
  lon: number | null;
  reason: string;
};

export type DomesticRateRequest = {
  id: string;
  officeId: string | null;
  inquiryId: string;
  mode: DomesticMode | null;
  equipmentType: EquipmentType | null;
  origin: string | null;
  destination: string | null;
  originLocation: DomesticLocation;
  destinationLocation: DomesticLocation;
  marketScope: DomesticMarketScope;
  pickupWindow: string | null;
  deliveryWindow: string | null;
  commodity: string | null;
  weightKg: number | null;
  volumeCbm: number | null;
  handlingUnits: number | null;
  dimensions: string | null;
  hazmat: YesNoUnknown;
  hazmatDetails: string | null;
  temperatureControl: YesNoUnknown;
  temperatureRange: string | null;
  accessorials: string[];
  accessorialsKnown: boolean;
  contactEmail: string | null;
  contactCompany: string | null;
  references: string[];
  urgency: "asap" | "normal" | "flexible";
  specialInstructions: string | null;
  source: DomesticRateSource;
  // High-value tech-freight context (src/lib/security-sop.ts vocabulary).
  securityTier?: string | null;
  declaredValue?: number | null;
};

export type RequiredRateField = {
  key: string;
  label: string;
  status: RequiredRateFieldStatus;
  detail: string;
  blocking: boolean;
};

export type ProviderCredentialStatus = {
  providerCode: string;
  displayName: string;
  credentialState: "mocked" | "manual" | "missing" | "not_required";
  configured: boolean;
  sandboxMode: boolean;
  canQuote: boolean;
  canBook: false;
  canTender: false;
  notes: string;
};

export type DomesticRateOption = {
  id: string;
  providerCode: string;
  providerName: string;
  providerQuoteId: string;
  serviceLevel: string;
  mode: DomesticMode;
  equipmentType: EquipmentType;
  buyPrice: Money;
  transitDays: number | null;
  validUntil: string;
  confidence: "simulated" | "manual" | "provider";
  rateSource: DomesticRateSourceType;
  sourceLabel: string;
  provenance: string;
  selected: boolean;
  terms: string[];
  notes: string[];
  warnings: string[];
  canBook: false;
  canTender: false;
};

export type DomesticRateAuditLog = {
  requestId: string;
  inquiryId: string;
  officeId: string | null;
  providerCode: string;
  action: "validate_request" | "mock_quote_generated" | "manual_quote_placeholder" | "draft_quote_generated";
  source: "mock" | "manual" | "system_generated";
  provenance: string;
  noExternalAction: true;
  createdAt: string;
};

export type DomesticQuoteDraft = {
  status: "DRAFT_ONLY" | "BLOCKED";
  subject: string | null;
  body: string | null;
  selectedOptionId: string | null;
  buyPrice: Money | null;
  sellPrice: Money | null;
  expectedGrossProfit: Money | null;
  expectedMarginPct: number | null;
  approvalState: DomesticQuoteApprovalState;
  customerSendState: "sent_disabled_v1";
  approvedBy: string | null;
  approvedAt: string | null;
  selectedOptionProvenance: string | null;
  assumptions: string[];
  blockers: string[];
};

export type DomesticBrainContextSection = {
  key: string;
  label: string;
  status: "stub" | "ready";
  summary: string;
  sourceSlugs: string[];
};

export type DomesticBrainContext = {
  status: "STUB";
  sections: DomesticBrainContextSection[];
};

export type DomesticPricingAssessment = {
  inquiryId: string;
  eligible: boolean;
  eligibilityStatus: DomesticEligibilityStatus;
  marketScope: DomesticMarketScope;
  eligibilityLabel: string;
  eligibilityReasons: string[];
  rateRequest: DomesticRateRequest;
  requiredFields: RequiredRateField[];
  missingRequiredFields: RequiredRateField[];
  nextQuestions: string[];
  blockers: string[];
  providerCredentialStatuses: ProviderCredentialStatus[];
  rateOptions: DomesticRateOption[];
  quoteDraft: DomesticQuoteDraft;
  brainContext: DomesticBrainContext;
  approvalWarnings: string[];
  safetyLabels: string[];
  auditLogPreview: DomesticRateAuditLog[];
};

export type DomesticPricingInquiry = {
  id: string;
  officeId?: string | null;
  subject: string;
  fromEmail?: string | null;
  fromCompany?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  containerType?: string | null;
  containerCount?: number | null;
  packages?: number | null;
  dimensions?: string | null;
  dangerousGoods?: string | null;
  // First-class truck fields (preferred over containerType/parsedData guesses).
  equipmentType?: string | null;
  securityTier?: string | null;
  declaredValue?: number | null;
  commodityCategory?: string | null;
  commodity?: string | null;
  weight?: number | null;
  volume?: number | null;
  cargoReadyDate?: Date | string | null;
  parsedData?: string | null;
  rawEmailBody?: string | null;
  notes?: string | null;
  targetPrice?: number | null;
  targetCurrency?: string | null;
  company?: { name?: string | null } | null;
};

export interface DomesticRateProvider {
  code: string;
  displayName: string;
  credentialStatus(): ProviderCredentialStatus;
  supports(request: DomesticRateRequest): boolean;
  validateRequest(request: DomesticRateRequest): RequiredRateField[];
  normalizeResponse(response: unknown, request: DomesticRateRequest): DomesticRateOption[];
  getRequiredFields(request: DomesticRateRequest): RequiredRateField[];
  getQuote(request: DomesticRateRequest): DomesticRateOption[];
  sandboxMode(): boolean;
}

const BRAIN_SOURCE_SLUGS = {
  rfqFields: "sops/domestic-trucking-rfq-fields",
  product: "product/domestic-trucking-instant-pricing",
  bridge: "product/domestic-pricing-brain-bridge",
  providerMatrix: "research/domestic-trucking-pricing/provider-matrix",
  rateProviderLandscape: "research/rate-provider-landscape/domestic-trucking-instant-pricing-answer",
  turkeyUsLane: "research/turkey-us-trade/turkey-us-lane-answer",
  partnerVendorCandidates: "research/partner-radar/partner-vendor-candidates-answer",
  webIntelContext: "product/rfq-web-intelligence-context-answer",
  rfqBrainContext: "product/rfq-brain-context-panel",
  productBridge: "product/product-brain-bridge",
};

const V1_SAFETY_LABELS = [
  "Draft only",
  "Not sent",
  "Not booked",
  "Human approval required",
  "Mock/manual rates only",
  "No live provider API connected",
];

const US_STATE_POINTS: Record<string, { code: string; label: string; lat: number; lon: number }> = {
  AL: { code: "AL", label: "Alabama", lat: 32.8067, lon: -86.7911 },
  AK: { code: "AK", label: "Alaska", lat: 61.3707, lon: -152.4044 },
  AZ: { code: "AZ", label: "Arizona", lat: 33.7298, lon: -111.4312 },
  AR: { code: "AR", label: "Arkansas", lat: 34.9697, lon: -92.3731 },
  CA: { code: "CA", label: "California", lat: 36.1162, lon: -119.6816 },
  CO: { code: "CO", label: "Colorado", lat: 39.0598, lon: -105.3111 },
  CT: { code: "CT", label: "Connecticut", lat: 41.5978, lon: -72.7554 },
  DE: { code: "DE", label: "Delaware", lat: 39.3185, lon: -75.5071 },
  FL: { code: "FL", label: "Florida", lat: 27.7663, lon: -81.6868 },
  GA: { code: "GA", label: "Georgia", lat: 33.0406, lon: -83.6431 },
  HI: { code: "HI", label: "Hawaii", lat: 21.0943, lon: -157.4983 },
  ID: { code: "ID", label: "Idaho", lat: 44.2405, lon: -114.4788 },
  IL: { code: "IL", label: "Illinois", lat: 40.3495, lon: -88.9861 },
  IN: { code: "IN", label: "Indiana", lat: 39.8494, lon: -86.2583 },
  IA: { code: "IA", label: "Iowa", lat: 42.0115, lon: -93.2105 },
  KS: { code: "KS", label: "Kansas", lat: 38.5266, lon: -96.7265 },
  KY: { code: "KY", label: "Kentucky", lat: 37.6681, lon: -84.6701 },
  LA: { code: "LA", label: "Louisiana", lat: 31.1695, lon: -91.8678 },
  ME: { code: "ME", label: "Maine", lat: 44.6939, lon: -69.3819 },
  MD: { code: "MD", label: "Maryland", lat: 39.0639, lon: -76.8021 },
  MA: { code: "MA", label: "Massachusetts", lat: 42.2302, lon: -71.5301 },
  MI: { code: "MI", label: "Michigan", lat: 43.3266, lon: -84.5361 },
  MN: { code: "MN", label: "Minnesota", lat: 45.6945, lon: -93.9002 },
  MS: { code: "MS", label: "Mississippi", lat: 32.7416, lon: -89.6787 },
  MO: { code: "MO", label: "Missouri", lat: 38.4561, lon: -92.2884 },
  MT: { code: "MT", label: "Montana", lat: 46.9219, lon: -110.4544 },
  NE: { code: "NE", label: "Nebraska", lat: 41.1254, lon: -98.2681 },
  NV: { code: "NV", label: "Nevada", lat: 38.3135, lon: -117.0554 },
  NH: { code: "NH", label: "New Hampshire", lat: 43.4525, lon: -71.5639 },
  NJ: { code: "NJ", label: "New Jersey", lat: 40.2989, lon: -74.5210 },
  NM: { code: "NM", label: "New Mexico", lat: 34.8405, lon: -106.2485 },
  NY: { code: "NY", label: "New York", lat: 42.1657, lon: -74.9481 },
  NC: { code: "NC", label: "North Carolina", lat: 35.6301, lon: -79.8064 },
  ND: { code: "ND", label: "North Dakota", lat: 47.5289, lon: -99.7840 },
  OH: { code: "OH", label: "Ohio", lat: 40.3888, lon: -82.7649 },
  OK: { code: "OK", label: "Oklahoma", lat: 35.5653, lon: -96.9289 },
  OR: { code: "OR", label: "Oregon", lat: 44.5720, lon: -122.0709 },
  PA: { code: "PA", label: "Pennsylvania", lat: 40.5908, lon: -77.2098 },
  RI: { code: "RI", label: "Rhode Island", lat: 41.6809, lon: -71.5118 },
  SC: { code: "SC", label: "South Carolina", lat: 33.8569, lon: -80.9450 },
  SD: { code: "SD", label: "South Dakota", lat: 44.2998, lon: -99.4388 },
  TN: { code: "TN", label: "Tennessee", lat: 35.7478, lon: -86.6923 },
  TX: { code: "TX", label: "Texas", lat: 31.0545, lon: -97.5635 },
  UT: { code: "UT", label: "Utah", lat: 40.1500, lon: -111.8624 },
  VT: { code: "VT", label: "Vermont", lat: 44.0459, lon: -72.7107 },
  VA: { code: "VA", label: "Virginia", lat: 37.7693, lon: -78.1700 },
  WA: { code: "WA", label: "Washington", lat: 47.4009, lon: -121.4905 },
  WV: { code: "WV", label: "West Virginia", lat: 38.4912, lon: -80.9545 },
  WI: { code: "WI", label: "Wisconsin", lat: 44.2685, lon: -89.6165 },
  WY: { code: "WY", label: "Wyoming", lat: 42.7560, lon: -107.3025 },
};

const US_STATE_NAMES = Object.fromEntries(Object.values(US_STATE_POINTS).map((state) => [state.label.toUpperCase(), state.code]));

const US_CITY_POINTS: Record<string, { label: string; stateCode: string; lat: number; lon: number }> = {
  "ATLANTA": { label: "Atlanta, GA", stateCode: "GA", lat: 33.7490, lon: -84.3880 },
  "BALTIMORE": { label: "Baltimore, MD", stateCode: "MD", lat: 39.2904, lon: -76.6122 },
  "BOSTON": { label: "Boston, MA", stateCode: "MA", lat: 42.3601, lon: -71.0589 },
  "CHARLESTON": { label: "Charleston, SC", stateCode: "SC", lat: 32.7765, lon: -79.9311 },
  "CHARLOTTE": { label: "Charlotte, NC", stateCode: "NC", lat: 35.2271, lon: -80.8431 },
  "CHICAGO": { label: "Chicago, IL", stateCode: "IL", lat: 41.8781, lon: -87.6298 },
  "COLUMBUS": { label: "Columbus, OH", stateCode: "OH", lat: 39.9612, lon: -82.9988 },
  "DALLAS": { label: "Dallas, TX", stateCode: "TX", lat: 32.7767, lon: -96.7970 },
  "DENVER": { label: "Denver, CO", stateCode: "CO", lat: 39.7392, lon: -104.9903 },
  "DETROIT": { label: "Detroit, MI", stateCode: "MI", lat: 42.3314, lon: -83.0458 },
  "HOUSTON": { label: "Houston, TX", stateCode: "TX", lat: 29.7604, lon: -95.3698 },
  "INDIANAPOLIS": { label: "Indianapolis, IN", stateCode: "IN", lat: 39.7684, lon: -86.1581 },
  "JACKSONVILLE": { label: "Jacksonville, FL", stateCode: "FL", lat: 30.3322, lon: -81.6557 },
  "KANSAS CITY": { label: "Kansas City, MO", stateCode: "MO", lat: 39.0997, lon: -94.5786 },
  "LAREDO": { label: "Laredo, TX", stateCode: "TX", lat: 27.5036, lon: -99.5076 },
  "LAS VEGAS": { label: "Las Vegas, NV", stateCode: "NV", lat: 36.1699, lon: -115.1398 },
  "LONG BEACH": { label: "Long Beach, CA", stateCode: "CA", lat: 33.7701, lon: -118.1937 },
  "LOS ANGELES": { label: "Los Angeles, CA", stateCode: "CA", lat: 34.0522, lon: -118.2437 },
  "MEMPHIS": { label: "Memphis, TN", stateCode: "TN", lat: 35.1495, lon: -90.0490 },
  "MIAMI": { label: "Miami, FL", stateCode: "FL", lat: 25.7617, lon: -80.1918 },
  "NASHVILLE": { label: "Nashville, TN", stateCode: "TN", lat: 36.1627, lon: -86.7816 },
  "NEW YORK": { label: "New York, NY", stateCode: "NY", lat: 40.7128, lon: -74.0060 },
  "NEWARK": { label: "Newark, NJ", stateCode: "NJ", lat: 40.7357, lon: -74.1724 },
  "NORFOLK": { label: "Norfolk, VA", stateCode: "VA", lat: 36.8508, lon: -76.2859 },
  "OAKLAND": { label: "Oakland, CA", stateCode: "CA", lat: 37.8044, lon: -122.2712 },
  "PHOENIX": { label: "Phoenix, AZ", stateCode: "AZ", lat: 33.4484, lon: -112.0740 },
  "PORTLAND": { label: "Portland, OR", stateCode: "OR", lat: 45.5152, lon: -122.6784 },
  "SALT LAKE CITY": { label: "Salt Lake City, UT", stateCode: "UT", lat: 40.7608, lon: -111.8910 },
  "SAN DIEGO": { label: "San Diego, CA", stateCode: "CA", lat: 32.7157, lon: -117.1611 },
  "SAVANNAH": { label: "Savannah, GA", stateCode: "GA", lat: 32.0809, lon: -81.0912 },
  "SEATTLE": { label: "Seattle, WA", stateCode: "WA", lat: 47.6062, lon: -122.3321 },
  "TACOMA": { label: "Tacoma, WA", stateCode: "WA", lat: 47.2529, lon: -122.4443 },
};

const NON_US_MARKERS = [
  "TURKEY", "TURKIYE", "TÜRKIYE", "ISTANBUL", "KONYA", "MERSIN", "ALIAGA", "GIRESUN",
  "GERMANY", "HAMBURG", "BERLIN", "CHINA", "SHENZHEN", "SHENZEN", "SHANGHAI", "JIANGSU",
  "ITALY", "ANCONA", "PORTUGAL", "LISBON", "MEXICO", "GUADALAJARA", "BULGARIA", "VARNA",
  "DENMARK", "SKAGEN", "JORDAN", "AKABA", "SAUDI", "JEDDAH", "DJIBOUTI", "BRAZIL", "GEORGIA",
  "VENEZUELA", "PUERTO CABELLO", "CANADA", "TORONTO", "MONTREAL", "VANCOUVER",
];

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeParsedData(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readParsedString(parsed: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = cleanString(parsed[key]);
    if (value) return value;
  }
  return null;
}

function readParsedArray(parsed: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value.map(cleanString).filter((item): item is string => Boolean(item));
    }
    const asString = cleanString(value);
    if (asString) return asString.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
  return null;
}

function readYesNoUnknown(value: unknown): YesNoUnknown {
  if (typeof value === "boolean") return value ? "YES" : "NO";
  const text = cleanString(value)?.toUpperCase();
  if (!text) return "UNKNOWN";
  if (["YES", "Y", "TRUE", "REEFER", "TEMP", "TEMPERATURE_CONTROLLED"].includes(text)) return "YES";
  if (["NO", "N", "FALSE", "NONE", "DRY", "AMBIENT"].includes(text)) return "NO";
  return "UNKNOWN";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeLocationText(value: string | null | undefined) {
  return cleanString(value)?.toUpperCase().replace(/[.]/g, "").replace(/\s+/g, " ") ?? "";
}

function locationFromState(stateCode: string, input: string, confidence: DomesticLocation["confidence"]): DomesticLocation {
  const state = US_STATE_POINTS[stateCode];
  return {
    input,
    label: input || state.label,
    isUnitedStates: true,
    isGenericCountryOnly: false,
    confidence,
    stateCode: state.code,
    lat: state.lat,
    lon: state.lon,
    reason: `Matched ${state.label}.`,
  };
}

function classifyDomesticLocation(value: string | null | undefined): DomesticLocation {
  const input = cleanString(value);
  const normalized = normalizeLocationText(value);
  if (!input || !normalized) {
    return {
      input: null,
      label: "Missing",
      isUnitedStates: false,
      isGenericCountryOnly: false,
      confidence: "unknown",
      stateCode: null,
      lat: null,
      lon: null,
      reason: "Missing city/state/ZIP.",
    };
  }

  if (/^(USA|US|UNITED STATES|UNITED STATES OF AMERICA)$/.test(normalized)) {
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: true,
      confidence: "explicit_country",
      stateCode: null,
      lat: 39.8283,
      lon: -98.5795,
      reason: "Country-only USA is not enough for rating; need city/state/ZIP.",
    };
  }

  if (NON_US_MARKERS.some((marker) => new RegExp(`\\b${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized))) {
    return {
      input,
      label: input,
      isUnitedStates: false,
      isGenericCountryOnly: false,
      confidence: "non_us",
      stateCode: null,
      lat: null,
      lon: null,
      reason: "Location matches a non-US geography.",
    };
  }

  const cityHit = Object.entries(US_CITY_POINTS).find(([city]) => new RegExp(`\\b${city}\\b`).test(normalized));
  if (cityHit) {
    const [, city] = cityHit;
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: false,
      confidence: "known_city",
      stateCode: city.stateCode,
      lat: city.lat,
      lon: city.lon,
      reason: `Matched ${city.label}.`,
    };
  }

  const stateCodeHit = Object.keys(US_STATE_POINTS).find((code) => new RegExp(`(^|[,\\s])${code}($|[,\\s])`).test(normalized));
  if (stateCodeHit) return locationFromState(stateCodeHit, input, "state_or_zip");

  const stateNameHit = Object.keys(US_STATE_NAMES).find((stateName) => new RegExp(`\\b${stateName}\\b`).test(normalized));
  if (stateNameHit) return locationFromState(US_STATE_NAMES[stateNameHit], input, "state_or_zip");

  if (/\b\d{5}(?:-\d{4})?\b/.test(normalized)) {
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: false,
      confidence: "state_or_zip",
      stateCode: null,
      lat: 39.8283,
      lon: -98.5795,
      reason: "Matched US ZIP format; map point is approximate until city/state is known.",
    };
  }

  return {
    input,
    label: input,
    isUnitedStates: false,
    isGenericCountryOnly: false,
    confidence: "unknown",
    stateCode: null,
    lat: null,
    lon: null,
    reason: "Need an explicit US city/state/ZIP.",
  };
}

function classifyMarketScope(originLocation: DomesticLocation, destinationLocation: DomesticLocation): DomesticMarketScope {
  if (
    originLocation.isUnitedStates
    && destinationLocation.isUnitedStates
    && !originLocation.isGenericCountryOnly
    && !destinationLocation.isGenericCountryOnly
  ) {
    return "US_DOMESTIC";
  }
  if (originLocation.confidence === "non_us" || destinationLocation.confidence === "non_us") return "NON_US";
  if (originLocation.isGenericCountryOnly || destinationLocation.isGenericCountryOnly) return "UNKNOWN";
  return "UNKNOWN";
}

function normalizeMode(mode: string | null | undefined, containerType: string | null | undefined): DomesticMode | null {
  const text = cleanString(mode)?.toUpperCase();
  const equipment = cleanString(containerType)?.toUpperCase();
  if (!text) return null;
  if (text.includes("DRAY")) return "DRAYAGE";
  if (text.includes("LTL")) return "LTL";
  if (text.includes("PARTIAL")) return "PARTIAL";
  if (text.includes("FTL") || text.includes("TRUCK") || text.includes("ROAD")) {
    if (equipment?.includes("LTL")) return "LTL";
    return "FTL";
  }
  return null;
}

function normalizeEquipment(containerType: string | null | undefined, parsed: Record<string, unknown>): EquipmentType | null {
  const fromParsed = readParsedString(parsed, "equipmentType", "equipment_type", "truckEquipment", "truck_equipment");
  const text = cleanString(fromParsed ?? containerType)?.toUpperCase();
  if (!text) return null;
  if (text.includes("REEFER") || text.includes("REFRIG") || text.includes("TEMP")) return "REEFER";
  if (text.includes("FLAT")) return "FLATBED";
  if (text.includes("STEP")) return "STEP_DECK";
  if (text.includes("BOX")) return "BOX_TRUCK";
  if (text.includes("DRY") || text.includes("VAN") || text.includes("53")) return "DRY_VAN";
  if (text.includes("20") || text.includes("40") || text.includes("CONTAINER")) return "CONTAINER_DRAYAGE";
  if (text.includes("LTL")) return "UNKNOWN";
  return null;
}

function extractUrgency(subject: string, notes: string | null | undefined, parsed: Record<string, unknown>): "asap" | "normal" | "flexible" {
  const parsedUrgency = cleanString(parsed.urgency)?.toLowerCase();
  if (parsedUrgency === "asap" || parsedUrgency === "normal" || parsedUrgency === "flexible") return parsedUrgency;
  const text = `${subject} ${notes ?? ""}`.toLowerCase();
  if (/\b(asap|urgent|rush|today|same day)\b/.test(text)) return "asap";
  if (/\b(flexible|no rush|when possible)\b/.test(text)) return "flexible";
  return "normal";
}

function extractAccessorials(parsed: Record<string, unknown>, notes: string | null | undefined) {
  const parsedAccessorials = readParsedArray(parsed, "accessorials", "accessorialRequirements", "accessorial_requirements");
  if (parsedAccessorials) {
    return { accessorials: parsedAccessorials, known: true };
  }
  const explicitNone = readYesNoUnknown(parsed.accessorialsKnown ?? parsed.accessorials_known);
  if (explicitNone === "YES") return { accessorials: [], known: true };

  const text = notes?.toLowerCase() ?? "";
  const detected = [
    /\bliftgate\b/.test(text) ? "liftgate" : null,
    /\bresidential\b/.test(text) ? "residential" : null,
    /\bappointment\b/.test(text) ? "appointment" : null,
    /\binside delivery\b/.test(text) ? "inside delivery" : null,
    /\blimited access\b/.test(text) ? "limited access" : null,
  ].filter((item): item is string => Boolean(item));
  if (detected.length > 0) return { accessorials: detected, known: true };
  if (/\b(no accessorial|no liftgate|dock to dock|business dock)\b/.test(text)) return { accessorials: [], known: true };
  return { accessorials: [], known: false };
}

function buildRateRequest(inquiry: DomesticPricingInquiry): DomesticRateRequest {
  const parsed = safeParsedData(inquiry.parsedData);
  const mode = normalizeMode(inquiry.mode, inquiry.containerType);
  // The first-class equipment column wins over containerType/parsedData guesses.
  const equipmentType =
    (inquiry.equipmentType ? normalizeEquipment(inquiry.equipmentType, {}) : null)
    ?? normalizeEquipment(inquiry.containerType, parsed);
  const origin = cleanString(inquiry.origin);
  const destination = cleanString(inquiry.destination);
  const originLocation = classifyDomesticLocation(origin);
  const destinationLocation = classifyDomesticLocation(destination);
  const marketScope = classifyMarketScope(originLocation, destinationLocation);
  const accessorials = extractAccessorials(parsed, inquiry.notes);
  const parsedTemperature = readYesNoUnknown(parsed.temperatureControl ?? parsed.temperature_control ?? parsed.reefer);
  const temperatureControl = equipmentType === "REEFER" ? "YES" : parsedTemperature;
  const pickupWindow = formatDate(inquiry.cargoReadyDate) ?? readParsedString(parsed, "pickupWindow", "pickup_window", "pickupDate", "pickup_date");
  const deliveryWindow = readParsedString(parsed, "deliveryWindow", "delivery_window", "deliveryDate", "delivery_date");
  const hazmat = readYesNoUnknown(inquiry.dangerousGoods);
  const references = [
    cleanString(readParsedString(parsed, "reference", "referenceNumber", "reference_number")),
    cleanString(inquiry.subject),
    inquiry.id,
  ].filter((item): item is string => Boolean(item));

  return {
    id: `domestic-rate-request:${inquiry.id}`,
    officeId: inquiry.officeId ?? null,
    inquiryId: inquiry.id,
    mode,
    equipmentType,
    origin,
    destination,
    originLocation,
    destinationLocation,
    marketScope,
    pickupWindow,
    deliveryWindow,
    commodity: cleanString(inquiry.commodity),
    weightKg: cleanNumber(inquiry.weight),
    volumeCbm: cleanNumber(inquiry.volume),
    handlingUnits: cleanNumber(inquiry.packages ?? inquiry.containerCount),
    dimensions: cleanString(inquiry.dimensions),
    hazmat,
    hazmatDetails: readParsedString(parsed, "hazmatDetails", "hazmat_details", "unNumber", "un_number", "msds"),
    temperatureControl,
    temperatureRange: readParsedString(parsed, "temperatureRange", "temperature_range"),
    accessorials: accessorials.accessorials,
    accessorialsKnown: accessorials.known,
    contactEmail: cleanString(inquiry.fromEmail),
    contactCompany: cleanString(inquiry.company?.name ?? inquiry.fromCompany),
    references,
    urgency: extractUrgency(inquiry.subject, inquiry.notes, parsed),
    specialInstructions: cleanString(readParsedString(parsed, "specialInstructions", "special_instructions") ?? inquiry.notes) ?? "None stated",
    securityTier: cleanString(inquiry.securityTier),
    declaredValue: cleanNumber(inquiry.declaredValue),
    source: {
      type: "inquiry",
      inquiryId: inquiry.id,
      subject: inquiry.subject,
      customerName: cleanString(inquiry.company?.name ?? inquiry.fromCompany),
      customerEmail: cleanString(inquiry.fromEmail),
    },
  };
}

function requiredField(key: string, label: string, ready: boolean, detailReady: string, detailMissing: string, blocking = true): RequiredRateField {
  return {
    key,
    label,
    status: ready ? "ready" : "missing",
    detail: ready ? detailReady : detailMissing,
    blocking: !ready && blocking,
  };
}

export function detectDomesticTruckingMissingFields(request: DomesticRateRequest): RequiredRateField[] {
  const fields: RequiredRateField[] = [
    requiredField("origin", "Pickup origin", Boolean(request.origin), request.origin ?? "", "Need pickup city/ZIP/address."),
    requiredField("destination", "Delivery destination", Boolean(request.destination), request.destination ?? "", "Need delivery city/ZIP/address."),
    requiredField(
      "us_pickup",
      "US pickup location",
      request.originLocation.isUnitedStates && !request.originLocation.isGenericCountryOnly,
      request.originLocation.reason,
      request.originLocation.isGenericCountryOnly ? "Need pickup city/state/ZIP, not just USA." : request.originLocation.reason,
    ),
    requiredField(
      "us_delivery",
      "US delivery location",
      request.destinationLocation.isUnitedStates && !request.destinationLocation.isGenericCountryOnly,
      request.destinationLocation.reason,
      request.destinationLocation.isGenericCountryOnly ? "Need delivery city/state/ZIP, not just USA." : request.destinationLocation.reason,
    ),
    requiredField("mode", "Truckload mode", Boolean(request.mode), request.mode ?? "", "Set Road, FTL, LTL, partial, or drayage."),
    requiredField("equipment", "Equipment type", Boolean(request.equipmentType), request.equipmentType ?? "", "Need dry van, reefer, flatbed, box truck, or drayage basis."),
    requiredField("pickup_window", "Pickup window", Boolean(request.pickupWindow), request.pickupWindow ?? "", "Need pickup date or window."),
    requiredField("commodity", "Commodity", Boolean(request.commodity), request.commodity ?? "", "Need commodity description."),
    requiredField("weight", "Weight", Boolean(request.weightKg && request.weightKg > 0), request.weightKg ? `${request.weightKg} kg` : "", "Need shipment weight."),
    requiredField(
      "handling_units",
      "Pallets/pieces or dimensions",
      Boolean((request.handlingUnits && request.handlingUnits > 0) || request.dimensions || (request.volumeCbm && request.volumeCbm > 0)),
      [request.handlingUnits ? `${request.handlingUnits} units` : null, request.dimensions, request.volumeCbm ? `${request.volumeCbm} cbm` : null].filter(Boolean).join(" / "),
      "Need pallet/piece count, dimensions, or volume.",
    ),
    requiredField("hazmat", "Hazmat yes/no", request.hazmat !== "UNKNOWN", request.hazmat, "Need explicit hazmat yes/no."),
    requiredField(
      "temperature_control",
      "Temperature control yes/no",
      request.temperatureControl !== "UNKNOWN",
      request.temperatureControl === "YES" ? request.temperatureRange ?? "Temperature controlled" : "No temperature control",
      "Need explicit temperature-control yes/no.",
    ),
    requiredField(
      "accessorials",
      "Accessorials yes/no",
      request.accessorialsKnown,
      request.accessorials.length ? request.accessorials.join(", ") : "No accessorials stated",
      "Need explicit accessorial requirements or none.",
    ),
    requiredField(
      "contact",
      "Customer contact",
      Boolean(request.contactEmail || request.contactCompany),
      request.contactEmail ?? request.contactCompany ?? "",
      "Need a customer contact.",
    ),
    {
      key: "delivery_window",
      label: "Delivery window",
      status: request.deliveryWindow ? "ready" : "advisory",
      detail: request.deliveryWindow ?? "Not required for V1 benchmark, but live providers may ask for it.",
      blocking: false,
    },
    {
      key: "urgency",
      label: "Urgency",
      status: request.urgency === "normal" ? "assumed" : "ready",
      detail: request.urgency,
      blocking: false,
    },
    {
      key: "special_instructions",
      label: "Special instructions",
      status: request.specialInstructions && request.specialInstructions !== "None stated" ? "ready" : "assumed",
      detail: request.specialInstructions ?? "None stated",
      blocking: false,
    },
    {
      key: "reference",
      label: "Reference number",
      status: request.references.length > 0 ? "ready" : "advisory",
      detail: request.references[0] ?? "No shipper reference.",
      blocking: false,
    },
  ];

  if (request.hazmat === "YES" && !request.hazmatDetails) {
    fields.push({
      key: "hazmat_details",
      label: "Hazmat details",
      status: "missing",
      detail: "Need UN number, class, packing group, or MSDS reference before quoting hazmat.",
      blocking: true,
    });
  }

  if (request.temperatureControl === "YES" && !request.temperatureRange) {
    fields.push({
      key: "temperature_range",
      label: "Temperature range",
      status: "missing",
      detail: "Need temperature range for reefer or temperature-controlled freight.",
      blocking: true,
    });
  }

  return fields;
}

function estimateLaneMiles(request: DomesticRateRequest) {
  const text = `${request.origin ?? ""}|${request.destination ?? ""}`.toUpperCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 9973;
  return 180 + (hash % 1800);
}

function roundTo(value: number, increment: number) {
  return Math.round(value / increment) * increment;
}

function roundUpTo(value: number, increment: number) {
  return Math.ceil(value / increment) * increment;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

class MockDomesticRateProvider implements DomesticRateProvider {
  code = "mock_domestic_market";
  displayName = "Mock Domestic Market";

  credentialStatus(): ProviderCredentialStatus {
    return {
      providerCode: this.code,
      displayName: this.displayName,
      credentialState: "mocked",
      configured: true,
      sandboxMode: true,
      canQuote: true,
      canBook: false,
      canTender: false,
      notes: "Deterministic Tier 0 benchmark. No external provider, credential, booking, or tendering.",
    };
  }

  supports(request: DomesticRateRequest) {
    return Boolean(request.mode) && request.marketScope === "US_DOMESTIC";
  }

  validateRequest(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request).filter((field) => field.blocking);
  }

  normalizeResponse(response: unknown, request: DomesticRateRequest) {
    if (Array.isArray(response)) return response as DomesticRateOption[];
    return this.getQuote(request);
  }

  getRequiredFields(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request);
  }

  sandboxMode() {
    return true;
  }

  getQuote(request: DomesticRateRequest): DomesticRateOption[] {
    if (!this.supports(request) || this.validateRequest(request).length > 0 || !request.mode || !request.equipmentType) return [];

    const miles = estimateLaneMiles(request);
    const weightLb = (request.weightKg ?? 0) * 2.20462;
    const unitCount = Math.max(1, request.handlingUnits ?? 1);
    const modeFactor = request.mode === "LTL" ? 0.58 : request.mode === "DRAYAGE" ? 0.42 : request.mode === "PARTIAL" ? 0.76 : 1;
    const base = request.mode === "LTL" ? 185 : request.mode === "DRAYAGE" ? 410 : 725;
    const linehaul = miles * (request.mode === "LTL" ? 1.12 : request.mode === "DRAYAGE" ? 1.35 : 2.18) * modeFactor;
    const fuel = linehaul * 0.21;
    const handling = unitCount * (request.mode === "LTL" ? 22 : 12);
    const weightCharge = weightLb * (request.mode === "LTL" ? 0.045 : 0.012);
    const accessorialCharge = request.accessorials.length * 85;
    const hazmatCharge = request.hazmat === "YES" ? 175 : 0;
    const tempCharge = request.temperatureControl === "YES" ? 250 + miles * 0.18 : 0;
    const urgencyCharge = request.urgency === "asap" ? 240 : request.urgency === "flexible" ? -85 : 0;
    const buy = Math.max(225, roundTo(base + linehaul + fuel + handling + weightCharge + accessorialCharge + hazmatCharge + tempCharge + urgencyCharge, 5));
    const transit = Math.max(1, Math.ceil(miles / 520));
    const suffix = Math.abs(estimateLaneMiles(request) * 17 + Math.round(weightLb)).toString(36).toUpperCase();

    return [
      {
        id: `mock-standard-${request.inquiryId}`,
        providerCode: this.code,
        providerName: this.displayName,
        providerQuoteId: `SIM-STD-${suffix}`,
        serviceLevel: "Standard benchmark",
        mode: request.mode,
        equipmentType: request.equipmentType,
        buyPrice: { amount: buy, currency: "USD" },
        transitDays: transit,
        validUntil: addDays(7),
        confidence: "simulated",
        rateSource: "mock",
        sourceLabel: "Mock/sandbox deterministic benchmark",
        provenance: "system_generated:mock_domestic_market:v1",
        selected: false,
        terms: [
          "Internal benchmark only.",
          "Subject to carrier availability, final accessorials, and human approval.",
          "No provider credential, booking, tender, or external API call was used.",
        ],
        notes: [
          "Generated from deterministic lane-mile and shipment-fact heuristics.",
          "Use for operator comparison and draft economics only.",
        ],
        warnings: ["Simulated benchmark only.", "Human approval required before any customer quote."],
        canBook: false,
        canTender: false,
      },
      {
        id: `mock-expedited-${request.inquiryId}`,
        providerCode: this.code,
        providerName: this.displayName,
        providerQuoteId: `SIM-EXP-${suffix}`,
        serviceLevel: request.urgency === "flexible" ? "Balanced capacity benchmark" : "Expedited capacity benchmark",
        mode: request.mode,
        equipmentType: request.equipmentType,
        buyPrice: { amount: roundUpTo(buy * 1.14 + 95, 5), currency: "USD" },
        transitDays: Math.max(1, transit - 1),
        validUntil: addDays(3),
        confidence: "simulated",
        rateSource: "mock",
        sourceLabel: "Mock/sandbox deterministic benchmark",
        provenance: "system_generated:mock_domestic_market:v1",
        selected: false,
        terms: [
          "Internal benchmark only.",
          "Expedited capacity premium is simulated.",
          "No provider credential, booking, tender, or external API call was used.",
        ],
        notes: [
          "Generated from deterministic lane-mile and shipment-fact heuristics.",
          "Use for operator comparison and draft economics only.",
        ],
        warnings: ["Simulated capacity premium.", "No live provider credential was used."],
        canBook: false,
        canTender: false,
      },
    ];
  }
}

class ManualDomesticRateProvider implements DomesticRateProvider {
  code = "manual_buy_rate";
  displayName = "Manual Buy Rate";

  credentialStatus(): ProviderCredentialStatus {
    return {
      providerCode: this.code,
      displayName: this.displayName,
      credentialState: "manual",
      configured: true,
      sandboxMode: false,
      canQuote: true,
      canBook: false,
      canTender: false,
      notes: "Operator-entered buy rates are allowed, but V1 does not persist or tender them automatically.",
    };
  }

  supports(request: DomesticRateRequest) {
    return Boolean(request.mode) && request.marketScope === "US_DOMESTIC";
  }

  validateRequest(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request).filter((field) => field.blocking);
  }

  normalizeResponse() {
    return [];
  }

  getRequiredFields(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request);
  }

  getQuote(): DomesticRateOption[] {
    return [];
  }

  sandboxMode() {
    return false;
  }
}

const PROVIDERS: DomesticRateProvider[] = [
  new MockDomesticRateProvider(),
  new ManualDomesticRateProvider(),
];

function futureProviderCredentialStatuses(): ProviderCredentialStatus[] {
  return [
    {
      providerCode: "truckstop",
      displayName: "Truckstop",
      credentialState: "missing",
      configured: false,
      sandboxMode: true,
      canQuote: false,
      canBook: false,
      canTender: false,
      notes: "API discovery target only. No credential is configured or read in V1.",
    },
    {
      providerCode: "dat_freight_and_analytics",
      displayName: "DAT Freight & Analytics",
      credentialState: "missing",
      configured: false,
      sandboxMode: true,
      canQuote: false,
      canBook: false,
      canTender: false,
      notes: "Market intelligence target only. No live request is made in V1.",
    },
  ];
}

function buildQuoteDraft(request: DomesticRateRequest, options: DomesticRateOption[], blockers: string[]): DomesticQuoteDraft {
  if (blockers.length > 0 || options.length === 0) {
    return {
      status: "BLOCKED",
      subject: null,
      body: null,
      selectedOptionId: null,
      buyPrice: null,
      sellPrice: null,
      expectedGrossProfit: null,
      expectedMarginPct: null,
      approvalState: "needs_approval",
      customerSendState: "sent_disabled_v1",
      approvedBy: null,
      approvedAt: null,
      selectedOptionProvenance: null,
      assumptions: [],
      blockers: blockers.length ? blockers : ["No domestic rate option is available."],
    };
  }

  const selected = options.reduce((best, option) => option.buyPrice.amount < best.buyPrice.amount ? option : best, options[0]);
  const minGrossProfit = selected.mode === "LTL" ? 125 : 250;
  const sellAmount = roundUpTo(Math.max(selected.buyPrice.amount * 1.18, selected.buyPrice.amount + minGrossProfit), 5);
  const grossProfit = sellAmount - selected.buyPrice.amount;
  const marginPct = sellAmount > 0 ? Number(((grossProfit / sellAmount) * 100).toFixed(1)) : null;
  const route = `${request.origin ?? "Origin"} to ${request.destination ?? "Destination"}`;
  const customer = request.source.customerName ?? request.source.customerEmail ?? "there";
  const subject = `Draft quote - Domestic trucking - ${route}`;
  const assumptions = [
    "Draft only. Do not send without human approval.",
    "Rate is subject to equipment availability, carrier acceptance, and final accessorial confirmation.",
    "Fuel, standard linehaul, and normal pickup/delivery handling are included in this V1 estimate.",
    "Duties, storage, detention, insurance, and unusual site access are excluded unless explicitly added.",
  ];
  const body = [
    `Hello ${customer},`,
    "",
    "Draft domestic trucking quote below. This is not approved for sending yet.",
    "",
    `Route: ${route}`,
    `Mode/equipment: ${selected.mode} / ${selected.equipmentType}`,
    `Service basis: ${selected.providerName} - ${selected.serviceLevel}`,
    selected.transitDays ? `Indicative transit: ${selected.transitDays} day${selected.transitDays === 1 ? "" : "s"}` : null,
    `Sell price: USD ${sellAmount.toLocaleString()}`,
    "",
    "Assumptions:",
    ...assumptions.map((item) => `- ${item}`),
    "",
    "Internal: approve margin, source evidence, and customer-facing wording before release.",
  ].filter((line): line is string => line !== null).join("\n");

  return {
    status: "DRAFT_ONLY",
    subject,
    body,
    selectedOptionId: selected.id,
    buyPrice: selected.buyPrice,
    sellPrice: { amount: sellAmount, currency: selected.buyPrice.currency },
    expectedGrossProfit: { amount: grossProfit, currency: selected.buyPrice.currency },
    expectedMarginPct: marginPct,
    approvalState: "needs_approval",
    customerSendState: "sent_disabled_v1",
    approvedBy: null,
    approvedAt: null,
    selectedOptionProvenance: selected.provenance,
    assumptions,
    blockers: [],
  };
}

function buildBrainContext(): DomesticBrainContext {
  return {
    status: "STUB",
    sections: [
      {
        key: "customer_preferences",
        label: "Customer preferences",
        status: "stub",
        summary: "No live GBrain retrieval yet. Future bridge should pull exact customer preferences with source records.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.rfqBrainContext, BRAIN_SOURCE_SLUGS.productBridge],
      },
      {
        key: "lane_notes",
        label: "Lane notes",
        status: "stub",
        summary: "No persisted lane memory is read in V1. Use this slot for prior quotes, route constraints, and risk notes later.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.turkeyUsLane, BRAIN_SOURCE_SLUGS.bridge],
      },
      {
        key: "provider_reliability",
        label: "Provider reliability",
        status: "stub",
        summary: "Tier 0 uses mock/manual providers only. Tier 1 provider discovery is documented but not connected.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.rateProviderLandscape, BRAIN_SOURCE_SLUGS.providerMatrix],
      },
      {
        key: "web_intelligence",
        label: "Web intelligence",
        status: "stub",
        summary: "Future RFQ panel can show proposed web intelligence with confidence, freshness, and source URLs beside product truth.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.webIntelContext, BRAIN_SOURCE_SLUGS.partnerVendorCandidates],
      },
      {
        key: "rfq_sop",
        label: "RFQ field SOP",
        status: "ready",
        summary: "Required-field checks mirror the domestic trucking RFQ field SOP.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.rfqFields],
      },
    ],
  };
}

function deriveEligibilityStatus(
  modeEligible: boolean,
  request: DomesticRateRequest,
  blockingFields: RequiredRateField[],
): DomesticEligibilityStatus {
  if (!modeEligible) return "not_domestic_trucking";
  if (request.marketScope === "NON_US") return "not_domestic_trucking";
  if (request.marketScope === "UNKNOWN" || blockingFields.length > 0) return "missing_info";
  if (
    request.hazmat === "YES"
    || request.temperatureControl === "YES"
    || request.accessorials.length > 0
    // High-value security tiers never auto-rate: SOP + carrier fit come first.
    || tierRank(request.securityTier) >= tierRank("high_value")
  ) {
    return "needs_human_review";
  }
  return "eligible";
}

function nextQuestionForField(field: RequiredRateField) {
  const questions: Record<string, string> = {
    origin: "What is the pickup address or pickup city/state/ZIP?",
    destination: "What is the delivery address or delivery city/state/ZIP?",
    us_pickup: "Can you confirm the pickup city/state/ZIP in the United States?",
    us_delivery: "Can you confirm the delivery city/state/ZIP in the United States?",
    mode: "Is this FTL, LTL, partial truckload, or drayage?",
    equipment: "What equipment is required: dry van, reefer, flatbed, box truck, or drayage chassis?",
    pickup_window: "What pickup date or pickup appointment window should we rate against?",
    commodity: "What commodity should be declared for the carrier quote?",
    weight: "What is the shipment weight?",
    handling_units: "How many pallets, pieces, or handling units, and what are the dimensions?",
    hazmat: "Is the freight hazmat? If yes, provide UN number, class, packing group, and MSDS.",
    temperature_control: "Does this need temperature control? If yes, what temperature range?",
    accessorials: "Are any accessorials needed: liftgate, residential, appointment, inside delivery, or limited access?",
    contact: "Who is the customer contact for pickup/delivery clarifications?",
    hazmat_details: "For hazmat freight, what are the UN number, class, packing group, and MSDS reference?",
    temperature_range: "What temperature range should the reefer or temperature-controlled move maintain?",
  };
  return questions[field.key] ?? `Please confirm ${field.label.toLowerCase()}.`;
}

function buildNextQuestions(requiredFields: RequiredRateField[], request: DomesticRateRequest, eligibilityStatus: DomesticEligibilityStatus) {
  const questions = requiredFields
    .filter((field) => field.blocking)
    .map(nextQuestionForField);

  if (eligibilityStatus === "needs_human_review") {
    if (request.hazmat === "YES" && request.hazmatDetails) {
      questions.push("Have ops reviewed the hazmat details and carrier handling restrictions?");
    }
    if (request.temperatureControl === "YES" && request.temperatureRange) {
      questions.push("Have ops confirmed reefer availability and temperature tolerance before quoting?");
    }
    if (request.accessorials.length > 0) {
      questions.push("Have ops confirmed accessorial charges and site constraints with the carrier or customer?");
    }
  }

  return Array.from(new Set(questions)).slice(0, 8);
}

function buildAuditLogPreview(request: DomesticRateRequest, rateOptions: DomesticRateOption[], quoteDraft: DomesticQuoteDraft): DomesticRateAuditLog[] {
  const createdAt = new Date().toISOString();
  const logs: DomesticRateAuditLog[] = [
    {
      requestId: request.id,
      inquiryId: request.inquiryId,
      officeId: request.officeId,
      providerCode: "system",
      action: "validate_request",
      source: "system_generated",
      provenance: "src/lib/domestic-trucking-pricing.ts:detectDomesticTruckingMissingFields",
      noExternalAction: true,
      createdAt,
    },
  ];

  for (const option of rateOptions) {
    logs.push({
      requestId: request.id,
      inquiryId: request.inquiryId,
      officeId: request.officeId,
      providerCode: option.providerCode,
      action: option.rateSource === "manual" ? "manual_quote_placeholder" : "mock_quote_generated",
      source: option.rateSource === "manual" ? "manual" : "mock",
      provenance: option.provenance,
      noExternalAction: true,
      createdAt,
    });
  }

  if (quoteDraft.status === "DRAFT_ONLY") {
    logs.push({
      requestId: request.id,
      inquiryId: request.inquiryId,
      officeId: request.officeId,
      providerCode: "system",
      action: "draft_quote_generated",
      source: "system_generated",
      provenance: quoteDraft.selectedOptionProvenance ?? "system_generated:draft_only_quote:v1",
      noExternalAction: true,
      createdAt,
    });
  }

  return logs;
}

export function isDomesticTruckingEligible(mode: string | null | undefined, origin?: string | null, destination?: string | null) {
  if (!normalizeMode(mode, null)) return false;
  if (origin === undefined && destination === undefined) return true;
  return classifyMarketScope(classifyDomesticLocation(origin), classifyDomesticLocation(destination)) === "US_DOMESTIC";
}

export function assessDomesticTruckingPricing(inquiry: DomesticPricingInquiry): DomesticPricingAssessment {
  const request = buildRateRequest(inquiry);
  const modeEligible = Boolean(request.mode);
  const eligible = modeEligible && request.marketScope === "US_DOMESTIC";
  const requiredFields = detectDomesticTruckingMissingFields(request);
  const missingRequiredFields = requiredFields.filter((field) => field.status === "missing");
  const blockingFields = requiredFields.filter((field) => field.blocking);
  const eligibilityStatus = deriveEligibilityStatus(modeEligible, request, blockingFields);
  const blockers = [
    !modeEligible ? "RFQ mode is not domestic trucking. Set mode to Road, FTL, LTL, partial, or drayage before rating." : null,
    modeEligible && request.marketScope === "NON_US" ? "Domestic trucking V1 is US-only. This lane is not US pickup to US delivery." : null,
    modeEligible && request.marketScope === "UNKNOWN" ? "Domestic trucking V1 needs explicit US pickup and delivery city/state/ZIP before rating." : null,
    ...blockingFields.map((field) => field.detail),
  ].filter((item): item is string => Boolean(item));
  const rawRateOptions = eligible && blockingFields.length === 0
    ? PROVIDERS.flatMap((provider) => provider.getQuote(request))
    : [];
  const quoteDraft = buildQuoteDraft(request, rawRateOptions, blockers);
  const rateOptions = rawRateOptions.map((option) => ({
    ...option,
    selected: option.id === quoteDraft.selectedOptionId,
  }));
  const nextQuestions = buildNextQuestions(requiredFields, request, eligibilityStatus);

  return {
    inquiryId: inquiry.id,
    eligible,
    eligibilityStatus,
    marketScope: request.marketScope,
    eligibilityLabel: eligible
      ? "US domestic trucking candidate"
      : modeEligible
        ? request.marketScope === "NON_US" ? "Suppressed: not a US domestic lane" : "Needs US pickup and delivery"
        : "Not a trucking RFQ",
    eligibilityReasons: eligible
      ? [`Mode normalized to ${request.mode}.`, "Pickup and delivery are both recognized as US locations."]
      : modeEligible
        ? [request.originLocation.reason, request.destinationLocation.reason]
        : ["Only Road, FTL, LTL, partial, and drayage RFQs use this V1 rate path."],
    rateRequest: request,
    requiredFields,
    missingRequiredFields,
    nextQuestions,
    blockers,
    providerCredentialStatuses: [
      ...PROVIDERS.map((provider) => provider.credentialStatus()),
      ...futureProviderCredentialStatuses(),
    ],
    rateOptions,
    quoteDraft,
    brainContext: buildBrainContext(),
    approvalWarnings: [
      ...(tierRank(request.securityTier) >= tierRank("high_value")
        ? [
            `Security tier "${request.securityTier}": high-value SOP applies — vetted carrier + security checklist before any quote or dispatch.`,
          ]
        : []),
      "Draft only: no customer email is sent.",
      "No booking, carrier tender, or provider side effect exists in V1.",
      "Human approval is required before customer-facing use.",
    ],
    safetyLabels: V1_SAFETY_LABELS,
    auditLogPreview: buildAuditLogPreview(request, rateOptions, quoteDraft),
  };
}
