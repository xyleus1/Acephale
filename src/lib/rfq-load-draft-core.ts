export const RFQ_LOAD_FIELD_LABELS = {
  companyName: "Customer",
  title: "Deal name",
  cadence: "Frequency",
  type: "Job type",
  origin: "Origin",
  destination: "Destination",
  mode: "Mode",
  incoterms: "Incoterms",
  commodity: "Commodity",
  quantity: "Quantity",
  quantityUnit: "Quantity unit",
  weight: "Weight",
  volume: "Volume",
  packages: "Packages",
  dimensions: "Dimensions",
  containerCount: "Container count",
  containerType: "Container type",
  stackable: "Stackable",
  topLoad: "Top load",
  dangerousGoods: "Dangerous goods",
  customsBy: "Customs by",
  equipmentType: "Equipment",
  commodityCategory: "Commodity category",
  declaredValue: "Declared value",
  declaredValueCurrency: "Declared currency",
  securityTier: "Security tier",
  trackingType: "Tracking",
  teamDriversRequired: "Team drivers",
  targetPrice: "Target price",
  targetCurrency: "Target currency",
  targetPriceStatus: "Target status",
  targetPriceSource: "Target note",
  currency: "Currency",
  notes: "Notes",
} as const;

export type RfqLoadFieldKey = keyof typeof RFQ_LOAD_FIELD_LABELS;
export type RfqLoadSourceKind = "rfq" | "proposed_load" | "prior_load" | "default";

export type RfqLoadFieldSource = {
  kind: RfqLoadSourceKind;
  label: string;
  detail?: string | null;
  reference?: string | null;
  jobId?: string | null;
};

export type RfqLoadReviewValues = {
  companyId?: string | null;
  companyName: string;
  title: string;
  cadence: string;
  type: string;
  origin: string;
  destination: string;
  mode: string;
  incoterms: string;
  commodity: string;
  quantity: number | null;
  quantityUnit: string;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  dimensions: string;
  containerCount: number | null;
  containerType: string;
  stackable: string;
  topLoad: string;
  dangerousGoods: string;
  customsBy: string;
  equipmentType: string;
  commodityCategory: string;
  declaredValue: number | null;
  declaredValueCurrency: string;
  securityTier: string;
  trackingType: string;
  teamDriversRequired: string;
  targetPrice: number | null;
  targetCurrency: string;
  targetPriceStatus: string;
  targetPriceSource: string;
  currency: string;
  notes: string;
};

export type RfqLoadDraftRecord = Partial<Record<RfqLoadFieldKey, string | number | null | undefined>> & {
  id?: string | null;
  reference?: string | null;
  updatedAt?: Date | string | null;
};

export type RfqLoadDraftMergeInput = {
  rfq: RfqLoadDraftRecord;
  proposedLoad?: RfqLoadDraftRecord | null;
  priorLoad?: RfqLoadDraftRecord | null;
  companyId?: string | null;
  companyName?: string | null;
};

const UNKNOWN_FIELDS = new Set<RfqLoadFieldKey>([
  "stackable",
  "topLoad",
  "dangerousGoods",
  "customsBy",
  "targetPriceStatus",
  "teamDriversRequired",
]);

const PRIOR_CARRY_FIELDS = new Set<RfqLoadFieldKey>([
  "cadence",
  "type",
  "origin",
  "destination",
  "mode",
  "incoterms",
  "commodity",
  "quantity",
  "quantityUnit",
  "weight",
  "volume",
  "packages",
  "dimensions",
  "containerCount",
  "containerType",
  "stackable",
  "topLoad",
  "dangerousGoods",
  "customsBy",
  "currency",
  // Security/equipment carry from prior loads; declaredValue deliberately
  // does NOT (same principle as target price - never silently assume value).
  "equipmentType",
  "commodityCategory",
  "securityTier",
  "trackingType",
  "teamDriversRequired",
]);

const DEFAULTS: Pick<
  RfqLoadReviewValues,
  | "cadence"
  | "type"
  | "targetCurrency"
  | "targetPriceStatus"
  | "currency"
  | "stackable"
  | "topLoad"
  | "dangerousGoods"
  | "customsBy"
  | "declaredValueCurrency"
  | "teamDriversRequired"
> = {
  cadence: "",
  type: "FORWARDING",
  targetCurrency: "USD",
  targetPriceStatus: "UNKNOWN",
  currency: "USD",
  stackable: "UNKNOWN",
  topLoad: "UNKNOWN",
  dangerousGoods: "UNKNOWN",
  customsBy: "UNKNOWN",
  declaredValueCurrency: "USD",
  teamDriversRequired: "UNKNOWN",
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = normalizeString(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function hasMeaningfulDraftValue(field: RfqLoadFieldKey, value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  const text = normalizeString(value);
  if (!text) return false;
  if (UNKNOWN_FIELDS.has(field) && text.toUpperCase() === "UNKNOWN") return false;
  return true;
}

function sourceFor(kind: RfqLoadSourceKind, record: RfqLoadDraftRecord | null | undefined): RfqLoadFieldSource {
  if (kind === "rfq") return { kind, label: "RFQ/email" };
  if (kind === "proposed_load") {
    return {
      kind,
      label: "Proposed load",
      detail: record?.reference ? `From ${record.reference}` : null,
      reference: record?.reference ?? null,
      jobId: record?.id ?? null,
    };
  }
  if (kind === "prior_load") {
    return {
      kind,
      label: "Prior load",
      detail: record?.reference ? `Carried from ${record.reference}` : "Carried from prior load",
      reference: record?.reference ?? null,
      jobId: record?.id ?? null,
    };
  }
  return { kind, label: "Default" };
}

function pickField(
  field: RfqLoadFieldKey,
  input: RfqLoadDraftMergeInput,
): { value: string | number | null; source: RfqLoadFieldSource } {
  const proposed = input.proposedLoad;
  const prior = input.priorLoad;

  if (proposed && hasMeaningfulDraftValue(field, proposed[field])) {
    return { value: proposed[field] as string | number | null, source: sourceFor("proposed_load", proposed) };
  }
  if (hasMeaningfulDraftValue(field, input.rfq[field])) {
    return { value: input.rfq[field] as string | number | null, source: sourceFor("rfq", input.rfq) };
  }
  if (prior && PRIOR_CARRY_FIELDS.has(field) && hasMeaningfulDraftValue(field, prior[field])) {
    return { value: prior[field] as string | number | null, source: sourceFor("prior_load", prior) };
  }
  const fallback = (DEFAULTS as Partial<Record<RfqLoadFieldKey, string>>)[field] ?? "";
  return { value: fallback, source: sourceFor("default", null) };
}

export function mergeRfqLoadDraftValues(input: RfqLoadDraftMergeInput): {
  values: RfqLoadReviewValues;
  sources: Record<RfqLoadFieldKey, RfqLoadFieldSource>;
  carriedFromPrior: RfqLoadFieldKey[];
} {
  const sources = {} as Record<RfqLoadFieldKey, RfqLoadFieldSource>;
  const carriedFromPrior: RfqLoadFieldKey[] = [];

  function stringField(field: RfqLoadFieldKey): string {
    const picked = pickField(field, input);
    sources[field] = picked.source;
    if (picked.source.kind === "prior_load") carriedFromPrior.push(field);
    return normalizeString(picked.value);
  }

  function numberField(field: RfqLoadFieldKey): number | null {
    const picked = pickField(field, input);
    sources[field] = picked.source;
    if (picked.source.kind === "prior_load") carriedFromPrior.push(field);
    return normalizeNumber(picked.value);
  }

  const companyName = normalizeString(input.companyName);
  sources.companyName = companyName ? sourceFor("rfq", input.rfq) : sourceFor("default", null);

  const title = normalizeString(input.proposedLoad?.title) || normalizeString(input.rfq.title) || normalizeString(input.rfq.reference);
  sources.title = normalizeString(input.proposedLoad?.title)
    ? sourceFor("proposed_load", input.proposedLoad)
    : title
      ? sourceFor("rfq", input.rfq)
      : sourceFor("default", null);

  const values: RfqLoadReviewValues = {
    companyId: input.companyId ?? null,
    companyName,
    title,
    cadence: stringField("cadence"),
    type: stringField("type") || "FORWARDING",
    origin: stringField("origin"),
    destination: stringField("destination"),
    mode: stringField("mode"),
    incoterms: stringField("incoterms"),
    commodity: stringField("commodity"),
    quantity: numberField("quantity"),
    quantityUnit: stringField("quantityUnit"),
    weight: numberField("weight"),
    volume: numberField("volume"),
    packages: numberField("packages"),
    dimensions: stringField("dimensions"),
    containerCount: numberField("containerCount"),
    containerType: stringField("containerType"),
    stackable: stringField("stackable") || "UNKNOWN",
    topLoad: stringField("topLoad") || "UNKNOWN",
    dangerousGoods: stringField("dangerousGoods") || "UNKNOWN",
    customsBy: stringField("customsBy") || "UNKNOWN",
    equipmentType: stringField("equipmentType"),
    commodityCategory: stringField("commodityCategory"),
    declaredValue: numberField("declaredValue"),
    declaredValueCurrency: stringField("declaredValueCurrency") || "USD",
    securityTier: stringField("securityTier"),
    trackingType: stringField("trackingType"),
    teamDriversRequired: stringField("teamDriversRequired") || "UNKNOWN",
    targetPrice: numberField("targetPrice"),
    targetCurrency: stringField("targetCurrency") || "USD",
    targetPriceStatus: stringField("targetPriceStatus") || "UNKNOWN",
    targetPriceSource: stringField("targetPriceSource"),
    currency: stringField("currency") || "USD",
    notes: stringField("notes"),
  };

  return { values, sources, carriedFromPrior };
}

