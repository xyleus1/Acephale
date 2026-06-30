export type DomesticMode = "FTL" | "LTL" | "PARTIAL" | "DRAYAGE";
export type EquipmentType = "DRY_VAN" | "REEFER" | "FLATBED" | "STEP_DECK" | "BOX_TRUCK" | "CONTAINER_DRAYAGE" | "UNKNOWN";
export type YesNoUnknown = "YES" | "NO" | "UNKNOWN";
export type RequiredRateFieldStatus = "ready" | "missing" | "assumed" | "advisory";

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

export type DomesticRateRequest = {
  id: string;
  officeId: string | null;
  inquiryId: string;
  mode: DomesticMode | null;
  equipmentType: EquipmentType | null;
  origin: string | null;
  destination: string | null;
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
  warnings: string[];
  canBook: false;
  canTender: false;
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
  approvalState: "PENDING_HUMAN_APPROVAL";
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
  eligibilityLabel: string;
  eligibilityReasons: string[];
  rateRequest: DomesticRateRequest;
  requiredFields: RequiredRateField[];
  missingRequiredFields: RequiredRateField[];
  blockers: string[];
  providerCredentialStatuses: ProviderCredentialStatus[];
  rateOptions: DomesticRateOption[];
  quoteDraft: DomesticQuoteDraft;
  brainContext: DomesticBrainContext;
  approvalWarnings: string[];
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
  getQuote(request: DomesticRateRequest): DomesticRateOption[];
}

const BRAIN_SOURCE_SLUGS = {
  rfqFields: "sops/domestic-trucking-rfq-fields",
  product: "product/domestic-trucking-instant-pricing",
  bridge: "product/domestic-pricing-brain-bridge",
  providerMatrix: "research/domestic-trucking-pricing/provider-matrix",
};

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
  const equipmentType = normalizeEquipment(inquiry.containerType, parsed);
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
    origin: cleanString(inquiry.origin),
    destination: cleanString(inquiry.destination),
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
    return Boolean(request.mode);
  }

  validateRequest(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request).filter((field) => field.blocking);
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
    return Boolean(request.mode);
  }

  validateRequest(request: DomesticRateRequest) {
    return detectDomesticTruckingMissingFields(request).filter((field) => field.blocking);
  }

  getQuote() {
    return [];
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
      approvalState: "PENDING_HUMAN_APPROVAL",
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
    approvalState: "PENDING_HUMAN_APPROVAL",
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
        sourceSlugs: [BRAIN_SOURCE_SLUGS.bridge, BRAIN_SOURCE_SLUGS.product],
      },
      {
        key: "lane_notes",
        label: "Lane notes",
        status: "stub",
        summary: "No persisted lane memory is read in V1. Use this slot for prior quotes, route constraints, and risk notes later.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.bridge],
      },
      {
        key: "provider_reliability",
        label: "Provider reliability",
        status: "stub",
        summary: "Tier 0 uses mock/manual providers only. Tier 1 provider discovery is documented but not connected.",
        sourceSlugs: [BRAIN_SOURCE_SLUGS.providerMatrix],
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

export function isDomesticTruckingEligible(mode: string | null | undefined) {
  return Boolean(normalizeMode(mode, null));
}

export function assessDomesticTruckingPricing(inquiry: DomesticPricingInquiry): DomesticPricingAssessment {
  const request = buildRateRequest(inquiry);
  const eligible = Boolean(request.mode);
  const requiredFields = detectDomesticTruckingMissingFields(request);
  const missingRequiredFields = requiredFields.filter((field) => field.status === "missing");
  const blockingFields = requiredFields.filter((field) => field.blocking);
  const blockers = [
    !eligible ? "RFQ mode is not domestic trucking. Set mode to Road, FTL, LTL, partial, or drayage before rating." : null,
    ...blockingFields.map((field) => field.detail),
  ].filter((item): item is string => Boolean(item));
  const rateOptions = eligible && blockingFields.length === 0
    ? PROVIDERS.flatMap((provider) => provider.getQuote(request))
    : [];
  const quoteDraft = buildQuoteDraft(request, rateOptions, blockers);

  return {
    inquiryId: inquiry.id,
    eligible,
    eligibilityLabel: eligible ? "Domestic trucking candidate" : "Not a domestic trucking RFQ",
    eligibilityReasons: eligible
      ? [`Mode normalized to ${request.mode}.`]
      : ["Only Road, FTL, LTL, partial, and drayage RFQs use this V1 rate path."],
    rateRequest: request,
    requiredFields,
    missingRequiredFields,
    blockers,
    providerCredentialStatuses: [
      ...PROVIDERS.map((provider) => provider.credentialStatus()),
      ...futureProviderCredentialStatuses(),
    ],
    rateOptions,
    quoteDraft,
    brainContext: buildBrainContext(),
    approvalWarnings: [
      "Draft only: no customer email is sent.",
      "No booking, carrier tender, or provider side effect exists in V1.",
      "Human approval is required before customer-facing use.",
    ],
  };
}
