export const SOURCING_REQUIRED_FIELDS = [
  "productName",
  "quantity",
  "unit",
  "technicalIdentity",
  "deliveryLocation",
  "needByDate",
] as const;

export type SourcingRequiredField = (typeof SOURCING_REQUIRED_FIELDS)[number];

export type SourcingRequestDraft = {
  productName: string | null;
  quantity: number | null;
  unit: string | null;
  manufacturer: string | null;
  partNumber: string | null;
  specification: string | null;
  sourceRegion: string | null;
  deliveryLocation: string | null;
  needByDate: string | null;
};

export type SourcingConversationMessage = {
  role: "operator" | "derya";
  body: string;
};

export type SourcingIntakeResult = {
  draft: SourcingRequestDraft;
  missingFields: SourcingRequiredField[];
  readyForResearch: boolean;
  reply: string;
};

export const EMPTY_SOURCING_REQUEST_DRAFT: SourcingRequestDraft = {
  productName: null,
  quantity: null,
  unit: null,
  manufacturer: null,
  partNumber: null,
  specification: null,
  sourceRegion: null,
  deliveryLocation: null,
  needByDate: null,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u2014/g, "-").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || null;
}

function cleanDate(value: unknown) {
  const normalized = cleanText(value, 10);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? null : normalized;
}

export function normalizeSourcingRequestDraft(value: unknown): SourcingRequestDraft {
  const raw = record(value);
  const quantity = typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && raw.quantity > 0
    ? raw.quantity
    : null;
  return {
    productName: cleanText(raw.productName, 240),
    quantity,
    unit: cleanText(raw.unit, 40),
    manufacturer: cleanText(raw.manufacturer, 180),
    partNumber: cleanText(raw.partNumber, 180),
    specification: cleanText(raw.specification, 1_000),
    sourceRegion: cleanText(raw.sourceRegion, 180),
    deliveryLocation: cleanText(raw.deliveryLocation, 240),
    needByDate: cleanDate(raw.needByDate),
  };
}

export function mergeSourcingRequestDraft(
  current: SourcingRequestDraft,
  extracted: SourcingRequestDraft,
): SourcingRequestDraft {
  return {
    productName: extracted.productName ?? current.productName,
    quantity: extracted.quantity ?? current.quantity,
    unit: extracted.unit ?? current.unit,
    manufacturer: extracted.manufacturer ?? current.manufacturer,
    partNumber: extracted.partNumber ?? current.partNumber,
    specification: extracted.specification ?? current.specification,
    sourceRegion: extracted.sourceRegion ?? current.sourceRegion,
    deliveryLocation: extracted.deliveryLocation ?? current.deliveryLocation,
    needByDate: extracted.needByDate ?? current.needByDate,
  };
}

export function missingSourcingFields(draft: SourcingRequestDraft): SourcingRequiredField[] {
  const missing: SourcingRequiredField[] = [];
  if (!draft.productName) missing.push("productName");
  if (!draft.quantity) missing.push("quantity");
  if (!draft.unit) missing.push("unit");
  if (!draft.partNumber && !draft.specification) missing.push("technicalIdentity");
  if (!draft.deliveryLocation) missing.push("deliveryLocation");
  if (!draft.needByDate) missing.push("needByDate");
  return missing;
}

export function sourcingRequestStorageKey(args: {
  storageScope: string;
  dashboardId: string;
  workspaceId?: string | null;
}) {
  return `derya:supply-os:${args.storageScope}:${args.dashboardId}:${args.workspaceId ?? "demo"}:sourcing-requests:v1`;
}

export function shouldLoadSourcingHistory(args: {
  workspaceId?: string | null;
  demoCompanyId?: string | null;
}) {
  return Boolean(args.workspaceId) || args.demoCompanyId !== null;
}

const FIELD_QUESTIONS: Record<SourcingRequiredField, string> = {
  productName: "the exact item or material",
  quantity: "the quantity",
  unit: "the unit of measure",
  technicalIdentity: "a part number, grade, standard, or technical specification",
  deliveryLocation: "the delivery city, port, or country",
  needByDate: "the required delivery date",
};

export function sourcingQuestionFor(missingFields: SourcingRequiredField[]) {
  if (!missingFields.length) return "The request has enough detail for public supplier research.";
  const facts = missingFields.map((field) => FIELD_QUESTIONS[field]);
  const joined = facts.length === 1
    ? facts[0]
    : `${facts.slice(0, -1).join(", ")}, and ${facts.at(-1)}`;
  return `Before I search, provide ${joined}.`;
}
