export const SUPPLY_CSV_KINDS = [
  "locations",
  "items",
  "bom",
  "inventory",
  "demand",
  "purchase_orders",
  "supplier_terms",
  "compliance_records",
] as const;

export type SupplyCsvKind = (typeof SUPPLY_CSV_KINDS)[number];
export type SupplyCsvBundle = Partial<Record<SupplyCsvKind, string>>;
export type SupplyCsvColumnMappings = Partial<Record<SupplyCsvKind, Record<string, string>>>;

export type SupplyPartsCsvIssue = {
  file: "parts";
  row: number;
  field?: string;
  severity: "error";
  code: "missing_header" | "malformed_row" | "missing_value" | "invalid_number" | "identity_collision";
  message: string;
};

export type AdaptedSupplyPartsCsv = {
  files: Pick<SupplyCsvBundle, "locations" | "items" | "demand">;
  issues: SupplyPartsCsvIssue[];
};

export type SupplyCsvIssue = {
  file: SupplyCsvKind;
  row: number;
  field?: string;
  severity: "error" | "warning";
  code:
    | "missing_header"
    | "duplicate_header"
    | "malformed_row"
    | "missing_value"
    | "duplicate_id"
    | "broken_reference"
    | "bom_cycle"
    | "invalid_number"
    | "invalid_unit"
    | "invalid_date"
    | "invalid_coordinate"
    | "stale_inventory"
    | "identity_collision";
  message: string;
};

export type SupplyLocationInput = {
  locationKey: string;
  externalId?: string;
  name: string;
  kind: string;
  addressLine?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number | string;
  longitude?: number | string;
  timezone?: string;
  sourceRefs?: unknown;
};

export type SupplyItemInput = {
  itemKey: string;
  externalId?: string;
  sku?: string;
  manufacturer?: string;
  mpn?: string;
  gtin?: string;
  approvedAliases: string[];
  name: string;
  description?: string;
  category?: string;
  itemType: string;
  unitOfMeasure: string;
  complianceTags: string[];
  metadata?: unknown;
  sourceRefs?: unknown;
  request?: {
    source: "PARTS_CSV";
    rawQuantity: string | null;
    quantity: number | null;
    unitOfMeasure: string | null;
    supplierDeliverable: string | null;
    deliveryLocation: string | null;
    needByDate: string | null;
  };
};

export type SupplyBomLineInput = {
  parentItemKey: string;
  componentItemKey: string;
  quantity: number | string | null;
  unitOfMeasure: string;
  scrapRate: number | string | null;
  makeOrBuy?: "MAKE" | "BUY";
  isOptional: boolean;
  alternativeGroup?: string;
  revision?: string;
  bomStatus?: string;
  sourceSystem?: string;
  bomExternalId?: string;
  effectiveAt?: string;
  lineNumber?: number;
  bomSourceRefs?: unknown;
  sourceRefs?: unknown;
};

export type SupplyInventoryInput = {
  positionKey: string;
  itemKey: string;
  locationKey: string;
  lotNumber?: string;
  unitOfMeasure: string;
  quantityOnHand: number | string | null;
  quantityAllocated: number | string | null;
  quantityInTransit: number | string | null;
  quantityOnOrder: number | string | null;
  expectedReceiptAt?: string;
  asOf: string;
  sourceRefs?: unknown;
};

export type SupplyDemandInput = {
  demandKey: string;
  itemKey: string;
  locationKey?: string;
  sourceType: string;
  externalId?: string;
  quantity: number | string | null;
  unitOfMeasure: string;
  dueAt: string;
  priority: number | null;
  status?: string;
  sourceRefs?: unknown;
};

export type SupplyPurchaseOrderInput = {
  purchaseOrderKey: string;
  lineKey: string;
  itemKey: string;
  locationKey?: string;
  supplierName?: string;
  quantity: number | null;
  unitOfMeasure: string;
  expectedAt?: string;
  status?: string;
};

export type SupplySupplierTermInput = {
  termKey: string;
  itemKey: string;
  supplierName: string;
  supplierWebsite?: string;
  supplierRole?: "MANUFACTURER" | "DISTRIBUTOR";
  countryCode?: string;
  facility?: string;
  price: number | null;
  currency?: string;
  minimumOrderQuantity: number | null;
  leadTimeDays: number | null;
  isCurrent?: boolean;
  availableQuantity?: number | null;
  availableAt?: string;
  evidenceUrl?: string;
  observedAt?: string;
};

export type SupplyComplianceRecordInput = {
  recordKey: string;
  itemKey: string;
  authority: string;
  standard?: string;
  authorizationReference?: string;
  integrationConstraints?: string;
  evidenceUrl?: string;
  observedAt?: string;
  reviewState: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED" | "BLOCKED";
};

export type SupplySnapshotSupplierTermInput = {
  termKey: string;
  itemKey: string;
  facilityKey?: string;
  supplierKey: string;
  supplierName: string;
  isCurrent: boolean;
  unitOfMeasure: string;
  currency?: string;
  unitPrice: string | null;
  modeledFreightPerUnit: string | null;
  evidencedDutyPerUnit: string | null;
  dutyEvidenceRefs?: unknown;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
  availableQuantity: string | null;
  availableAt?: string;
  evidenceRefs?: unknown;
  sourceRefs?: unknown;
};

export type SupplySnapshotFccProfileInput = {
  itemKey: string;
  moduleAuthorization: string;
  moduleAuthorizationEvidenceRefs?: unknown;
  hostIntegrationConstraints?: unknown;
  labeling: string;
  labelingEvidenceRefs?: unknown;
  rfExposure: string;
  rfExposureEvidenceRefs?: unknown;
  testing: string;
  testingEvidenceRefs?: unknown;
  testingGaps?: unknown;
  reviewRequirements?: unknown;
  blockedReasons?: unknown;
  sourceRefs?: unknown;
};

export type SupplySnapshotMediaAssetInput = {
  mediaKey: string;
  itemKey?: string;
  locationKey?: string;
  kind: string;
  url: string;
  sourceUrl: string;
  sourcePageUrl?: string;
  creator?: string;
  license?: string;
  attribution?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  isPrimary: boolean;
  capturedAt?: string;
};

export type NormalizedSupplyCsvBundle = {
  schemaVersion: 2;
  locations: SupplyLocationInput[];
  items: SupplyItemInput[];
  bom: SupplyBomLineInput[];
  inventory: SupplyInventoryInput[];
  demand: SupplyDemandInput[];
  purchaseOrders: SupplyPurchaseOrderInput[];
  supplierTerms: SupplySupplierTermInput[];
  complianceRecords: SupplyComplianceRecordInput[];
  issues: SupplyCsvIssue[];
  snapshotMetadata?: unknown;
  snapshotSupplierTerms?: SupplySnapshotSupplierTermInput[];
  fccProfiles?: SupplySnapshotFccProfileInput[];
  mediaAssets?: SupplySnapshotMediaAssetInput[];
};

export type NormalizeSupplyCsvOptions = {
  columnMappings?: SupplyCsvColumnMappings;
  now?: Date;
  staleInventoryAfterDays?: number;
};

type CsvRecord = Record<string, string> & { __row: string };
type ParseResult = { rows: string[][]; rowNumbers: number[]; issues: Omit<SupplyCsvIssue, "file">[] };

const UNIT_ALIASES: Record<string, string> = {
  EACH: "EA",
  PCS: "EA",
  PC: "EA",
  UNITS: "EA",
  UNIT: "EA",
  KGS: "KG",
  KILOGRAM: "KG",
  KILOGRAMS: "KG",
  LBS: "LB",
  POUNDS: "LB",
  TONNE: "MT",
  TONNES: "MT",
  LITER: "L",
  LITERS: "L",
  METERS: "M",
  METRES: "M",
  PALLETS: "PALLET",
  BOXES: "BOX",
  SETS: "SET",
};

const VALID_UNITS = new Set([
  "EA", "KG", "G", "LB", "OZ", "MT", "L", "ML", "M", "CM", "MM", "M2", "M3",
  "FT", "IN", "BOX", "PALLET", "SET", "ROLL", "HOUR", "DAY",
]);

const REQUIRED_HEADERS: Record<SupplyCsvKind, readonly string[][]> = {
  locations: [["location_key", "location_code", "external_id"], ["name", "location_name"]],
  items: [["item_key", "sku", "external_id"], ["name", "item_name", "description"], ["unit", "unit_of_measure", "uom"]],
  bom: [["parent_item_key", "parent_sku"], ["component_item_key", "component_sku"], ["quantity", "qty_per"], ["unit", "unit_of_measure", "uom"]],
  inventory: [["position_key", "inventory_id"], ["item_key", "sku"], ["location_key", "location_code"], ["unit", "unit_of_measure", "uom"], ["as_of", "snapshot_at"]],
  demand: [["demand_key", "demand_id", "order_id"], ["item_key", "sku"], ["quantity", "required_quantity"], ["unit", "unit_of_measure", "uom"], ["due_at", "need_by"]],
  purchase_orders: [["purchase_order_key", "po_number"], ["line_key", "line_number"], ["item_key", "sku"], ["quantity", "ordered_quantity"], ["unit", "unit_of_measure", "uom"]],
  supplier_terms: [["term_key", "supplier_term_id"], ["item_key", "sku"], ["supplier_name", "supplier"]],
  compliance_records: [["record_key", "compliance_id"], ["item_key", "sku"], ["authority"]],
};

const TEMPLATE_HEADERS: Record<SupplyCsvKind, readonly string[]> = {
  locations: ["location_key", "external_id", "name", "kind", "address", "city", "region", "postal_code", "country_code", "latitude", "longitude"],
  items: ["item_key", "external_id", "sku", "manufacturer", "mpn", "gtin", "approved_aliases", "name", "description", "category", "item_type", "unit", "compliance_tags", "request_source", "request_raw_quantity", "request_quantity", "request_unit", "request_supplier_deliverable", "request_delivery_location", "request_need_by_date"],
  bom: ["parent_item_key", "component_item_key", "quantity", "unit", "scrap_rate", "make_or_buy", "is_optional", "alternative_group"],
  inventory: ["position_key", "item_key", "location_key", "lot_number", "unit", "on_hand", "allocated", "in_transit", "on_order", "as_of"],
  demand: ["demand_key", "item_key", "location_key", "source_type", "external_id", "quantity", "unit", "due_at", "priority"],
  purchase_orders: ["purchase_order_key", "line_key", "item_key", "location_key", "supplier_name", "quantity", "unit", "expected_at", "status"],
  supplier_terms: ["term_key", "item_key", "supplier_name", "supplier_website", "supplier_role", "country_code", "facility", "price", "currency", "moq", "lead_time_days", "evidence_url", "observed_at"],
  compliance_records: ["record_key", "item_key", "authority", "standard", "authorization_reference", "integration_constraints", "evidence_url", "observed_at", "review_state"],
};

const PARTS_TEMPLATE_HEADERS = [
  "Item",
  "Procurement description",
  "Example specification",
  "Qty",
  "Supplier deliverable / QA",
] as const;

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function issue(
  issues: SupplyCsvIssue[],
  file: SupplyCsvKind,
  row: number,
  code: SupplyCsvIssue["code"],
  message: string,
  field?: string,
  severity: SupplyCsvIssue["severity"] = "error",
) {
  issues.push({ file, row, field, severity, code, message });
}

function parseCsvRows(input: string): ParseResult {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const issues: ParseResult["issues"] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let physicalRow = 1;
  let recordStartRow = 1;

  const finishRow = () => {
    row.push(field);
    if (row.some((value) => value.trim())) {
      rows.push(row.map((value) => value.trim()));
      rowNumbers.push(recordStartRow);
    }
    row = [];
    field = "";
    fieldStarted = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (!quoted && fieldStarted && field.trim()) {
        issues.push({ row: physicalRow, field: String(row.length + 1), severity: "error", code: "malformed_row", message: "Unexpected quote inside an unquoted CSV field." });
        field += character;
      } else {
        quoted = !quoted;
        fieldStarted = true;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
      fieldStarted = false;
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
      physicalRow += 1;
      recordStartRow = physicalRow;
      continue;
    }
    if (character === "\n") physicalRow += 1;
    field += character;
    fieldStarted = true;
  }

  if (quoted) {
    issues.push({ row: recordStartRow, severity: "error", code: "malformed_row", message: "CSV row has an unclosed quoted field." });
  }
  if (field.length || row.length) finishRow();
  return { rows, rowNumbers, issues };
}

function mappedHeader(canonical: string, mapping: Record<string, string> | undefined) {
  return normalizeHeader(mapping?.[canonical] ?? canonical);
}

function records(
  file: SupplyCsvKind,
  input: string | undefined,
  issues: SupplyCsvIssue[],
  mapping: Record<string, string> | undefined,
): CsvRecord[] {
  if (!input?.trim()) return [];
  const parsed = parseCsvRows(input);
  parsed.issues.forEach((value) => issue(issues, file, value.row, value.code, value.message, value.field, value.severity));
  const [rawHeaders, ...rows] = parsed.rows;
  if (!rawHeaders) return [];
  const headers = rawHeaders.map(normalizeHeader);
  const seenHeaders = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) issue(issues, file, parsed.rowNumbers[0] ?? 1, "missing_header", `Column ${index + 1} has no header.`);
    else if (seenHeaders.has(header)) issue(issues, file, parsed.rowNumbers[0] ?? 1, "duplicate_header", `Duplicate header: ${header}.`, header);
    else seenHeaders.add(header);
  });

  for (const aliases of REQUIRED_HEADERS[file]) {
    const mapped = aliases.map((alias) => mappedHeader(alias, mapping));
    if (!mapped.some((header) => seenHeaders.has(header))) {
      issue(issues, file, parsed.rowNumbers[0] ?? 1, "missing_header", `Missing required header. Expected one of: ${aliases.join(", ")}.`, aliases[0]);
    }
  }

  return rows.map((values, index) => {
    const rowNumber = parsed.rowNumbers[index + 1] ?? index + 2;
    if (values.length !== headers.length) {
      issue(issues, file, rowNumber, "malformed_row", `CSV row has ${values.length} fields but the header has ${headers.length}.`);
    }
    const record = { __row: String(rowNumber) } as CsvRecord;
    headers.forEach((header, column) => {
      record[header] = values[column]?.trim() ?? "";
    });
    return record;
  });
}

function first(record: CsvRecord, mapping: Record<string, string> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const header = mappedHeader(key, mapping);
    const value = record[header]?.trim();
    if (value) return value;
  }
  return "";
}

function optional(value: string) {
  return value || undefined;
}

function required(
  record: CsvRecord,
  file: SupplyCsvKind,
  field: string,
  issues: SupplyCsvIssue[],
  mapping: Record<string, string> | undefined,
  ...keys: string[]
) {
  const value = first(record, mapping, ...keys);
  if (!value) issue(issues, file, Number(record.__row), "missing_value", `${field} is required.`, field);
  return value;
}

function numberValue(args: {
  record: CsvRecord;
  file: SupplyCsvKind;
  field: string;
  keys: string[];
  issues: SupplyCsvIssue[];
  mapping: Record<string, string> | undefined;
  required?: boolean;
  positive?: boolean;
}): number | null {
  const raw = first(args.record, args.mapping, ...args.keys);
  if (!raw) {
    if (args.required) issue(args.issues, args.file, Number(args.record.__row), "missing_value", `${args.field} is required.`, args.field);
    return null;
  }
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0 || (args.positive && value <= 0)) {
    issue(args.issues, args.file, Number(args.record.__row), "invalid_number", `${args.field} must be ${args.positive ? "a positive" : "a non-negative"} number.`, args.field);
    return null;
  }
  return value;
}

function booleanValue(value: string) {
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function enumValue<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized as T) ? normalized as T : undefined;
}

function dateValue(args: {
  record: CsvRecord;
  file: SupplyCsvKind;
  field: string;
  value: string;
  issues: SupplyCsvIssue[];
  required?: boolean;
}): string | undefined {
  if (!args.value) {
    if (args.required) issue(args.issues, args.file, Number(args.record.__row), "missing_value", `${args.field} is required.`, args.field);
    return undefined;
  }
  const parsed = new Date(args.value);
  if (Number.isNaN(parsed.getTime())) {
    issue(args.issues, args.file, Number(args.record.__row), "invalid_date", `${args.field} must be a valid date.`, args.field);
    return undefined;
  }
  return parsed.toISOString();
}

function unitValue(
  record: CsvRecord,
  file: SupplyCsvKind,
  issues: SupplyCsvIssue[],
  mapping: Record<string, string> | undefined,
) {
  const raw = required(record, file, "unit", issues, mapping, "unit", "unit_of_measure", "uom").trim().toUpperCase();
  const unit = UNIT_ALIASES[raw] ?? raw;
  if (unit && !VALID_UNITS.has(unit)) {
    issue(issues, file, Number(record.__row), "invalid_unit", `Unsupported unit: ${raw}.`, "unit");
  }
  return unit;
}

function coordinateValue(
  record: CsvRecord,
  file: SupplyCsvKind,
  field: "latitude" | "longitude",
  issues: SupplyCsvIssue[],
  mapping: Record<string, string> | undefined,
  aliases: string[],
) {
  const raw = first(record, mapping, ...aliases);
  if (!raw) return undefined;
  const max = field === "latitude" ? 90 : 180;
  const signed = Number(raw);
  if (!Number.isFinite(signed) || signed < -max || signed > max) {
    issue(issues, file, Number(record.__row), "invalid_coordinate", `${field} must be between ${-max} and ${max}.`, field);
    return undefined;
  }
  return signed;
}

function stringList(value: string) {
  return [...new Set(value.split(/[|;]/).map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function publicUrl(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function duplicateIssues(
  file: SupplyCsvKind,
  values: Array<{ key: string; row: number }>,
  issues: SupplyCsvIssue[],
) {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.key.trim().toLowerCase();
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      continue;
    }
    issue(issues, file, value.row, "duplicate_id", `Duplicate key: ${value.key}.`);
  }
}

function identityCollisionIssues(items: SupplyItemInput[], rows: CsvRecord[], issues: SupplyCsvIssue[]) {
  const indexes: Array<[string, (item: SupplyItemInput) => string | undefined]> = [
    ["external_id", (item) => item.externalId],
    ["sku", (item) => item.sku],
    ["gtin", (item) => item.gtin],
  ];
  for (const [field, select] of indexes) {
    const owners = new Map<string, string>();
    items.forEach((item, index) => {
      const value = select(item)?.trim().toLowerCase();
      if (!value) return;
      const owner = owners.get(value);
      if (owner && owner !== item.itemKey) {
        issue(issues, "items", Number(rows[index]?.__row ?? 0), "identity_collision", `${field} ${select(item)} is assigned to both ${owner} and ${item.itemKey}.`, field);
      } else owners.set(value, item.itemKey);
    });
  }
  const mpnOwners = new Map<string, string>();
  items.forEach((item, index) => {
    if (!item.manufacturer || !item.mpn) return;
    const value = `${item.manufacturer.trim().toLowerCase()}::${item.mpn.trim().toLowerCase()}`;
    const owner = mpnOwners.get(value);
    if (owner && owner !== item.itemKey) {
      issue(issues, "items", Number(rows[index]?.__row ?? 0), "identity_collision", `manufacturer + mpn is assigned to both ${owner} and ${item.itemKey}.`, "mpn");
    } else mpnOwners.set(value, item.itemKey);
  });
}

function bomCycleIssues(bom: SupplyBomLineInput[], rows: CsvRecord[], issues: SupplyCsvIssue[]) {
  const edges = new Map<string, Array<{ target: string; row: number }>>();
  bom.forEach((line, index) => {
    const targets = edges.get(line.parentItemKey) ?? [];
    targets.push({ target: line.componentItemKey, row: Number(rows[index]?.__row ?? 0) });
    edges.set(line.parentItemKey, targets);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (itemKey: string, path: string[]): boolean => {
    if (visiting.has(itemKey)) {
      issue(issues, "bom", 0, "bom_cycle", `BOM cycle detected: ${[...path, itemKey].join(" -> ")}.`);
      return true;
    }
    if (visited.has(itemKey)) return false;
    visiting.add(itemKey);
    for (const edge of [...(edges.get(itemKey) ?? [])].sort((a, b) => a.target.localeCompare(b.target))) {
      if (visit(edge.target, [...path, itemKey])) return true;
    }
    visiting.delete(itemKey);
    visited.add(itemKey);
    return false;
  };
  for (const itemKey of [...edges.keys()].sort()) if (visit(itemKey, [])) break;
}

function sortBy<T>(rows: T[], select: (value: T) => string) {
  return rows.sort((left, right) => select(left).localeCompare(select(right)));
}

export function detectSupplyCsvKind(input: string): SupplyCsvKind | null {
  const parsed = parseCsvRows(input);
  const headers = new Set((parsed.rows[0] ?? []).map(normalizeHeader));
  const matches = SUPPLY_CSV_KINDS.filter((kind) => REQUIRED_HEADERS[kind].every((aliases) => aliases.some((alias) => headers.has(alias))));
  return matches.length === 1 ? matches[0]! : null;
}

export function supplyCsvTemplate(kind: SupplyCsvKind) {
  return `${TEMPLATE_HEADERS[kind].join(",")}\n`;
}

export function supplyPartsCsvTemplate() {
  return `${PARTS_TEMPLATE_HEADERS.join(",")}\n`;
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvText(headers: readonly string[], rows: string[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

const PARTS_COUNT_UNITS = new Set([
  "assembly", "assemblies", "blank", "blanks", "cartridge", "cartridges", "mount", "mounts", "pc", "pcs",
  "piece", "pieces", "sheet", "sheets", "tube", "tubes", "unit", "units",
]);

function canonicalPartsUnit(raw: string) {
  const cleaned = raw.trim().toLowerCase().replace(/[.,;:]+$/g, "");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (["total", "assorted", "mating", "nominal"].includes(token)) continue;
    if (PARTS_COUNT_UNITS.has(token)) return "EA";
    if (["package", "packages", "pair", "pairs", "kit", "kits", "lot", "lots", "set", "sets"].includes(token)) return "SET";
    const upper = token.toUpperCase();
    const canonical = UNIT_ALIASES[upper] ?? upper;
    if (VALID_UNITS.has(canonical)) return canonical;
  }
  return tokens.includes("assorted") ? "EA" : null;
}

function parsePartsQuantity(rawQuantity: string, explicitUnit: string) {
  const raw = rawQuantity.trim();
  if (!raw || /^as\s+req(?:uired)?\.?$/i.test(raw)) {
    return { rawQuantity: raw || null, quantity: null, unitOfMeasure: canonicalPartsUnit(explicitUnit) };
  }
  const match = raw.match(/^((?:\d{1,3}(?:,\d{3})+)|(?:\d+))(?:\.(\d+))?\b\s*(.*)$/);
  if (!match) return { rawQuantity: raw, quantity: null, unitOfMeasure: canonicalPartsUnit(explicitUnit) };
  const quantity = Number(`${match[1]!.replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`);
  return {
    rawQuantity: raw,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unitOfMeasure: canonicalPartsUnit(explicitUnit) ?? canonicalPartsUnit(match[3] ?? "") ?? ((match[3] ?? "").trim() ? null : "EA"),
  };
}

/**
 * Adapts one operator-facing parts list into the existing normalized snapshot
 * contract. Procurement tables often contain a human quantity such as
 * "300 m total" and omit delivery facts. The request metadata stays attached
 * to the item until an operator supplies the remaining sourcing fields.
 */
export function adaptSupplyPartsCsv(input: string): AdaptedSupplyPartsCsv {
  const parsed = parseCsvRows(input);
  const issues: SupplyPartsCsvIssue[] = parsed.issues.map((value) => ({
    file: "parts",
    row: value.row,
    field: value.field,
    severity: "error",
    code: "malformed_row",
    message: value.message,
  }));
  const [rawHeaders, ...rawRows] = parsed.rows;
  const headers = (rawHeaders ?? []).map(normalizeHeader);
  const headerRow = parsed.rowNumbers[0] ?? 1;
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!headerIndex.has(header)) headerIndex.set(header, index);
  });
  const aliases = {
    itemKey: ["item_key", "sku", "part_number", "item"],
    name: ["name", "item_name", "procurement_description", "description"],
    specification: ["specification", "spec", "technical_specification", "example_specification"],
    quantity: ["quantity", "qty", "required_quantity"],
    unit: ["unit", "uom", "unit_of_measure"],
    locationKey: ["location_key", "delivery_location_key", "ship_to_key"],
    deliveryLocation: ["delivery_location", "location_name", "ship_to"],
    needByDate: ["need_by_date", "need_by", "required_date"],
    manufacturer: ["manufacturer", "maker"],
    mpn: ["mpn", "manufacturer_part_number"],
    category: ["category"],
    supplierDeliverable: ["supplier_deliverable", "supplier_deliverable_qa", "supplier_qa", "qa_deliverable"],
    countryCode: ["country_code", "country"],
  } as const;
  const requiredHeaders: Array<[keyof typeof aliases, string]> = [
    ["itemKey", "item_key"],
    ["name", "name"],
    ["quantity", "quantity"],
  ];
  for (const [key, label] of requiredHeaders) {
    if (!aliases[key].some((candidate) => headerIndex.has(candidate))) {
      issues.push({
        file: "parts",
        row: headerRow,
        field: label,
        severity: "error",
        code: "missing_header",
        message: `Missing required header: ${label}.`,
      });
    }
  }
  if (!rawHeaders) {
    issues.push({
      file: "parts",
      row: 1,
      severity: "error",
      code: "missing_header",
      message: "The parts CSV has no header row.",
    });
  }

  const value = (row: string[], key: keyof typeof aliases) => {
    for (const candidate of aliases[key]) {
      const index = headerIndex.get(candidate);
      if (index === undefined) continue;
      const found = row[index]?.trim();
      if (found) return found;
    }
    return "";
  };
  const requireValue = (row: string[], rowNumber: number, key: keyof typeof aliases, label: string) => {
    const found = value(row, key);
    if (!found) {
      issues.push({
        file: "parts",
        row: rowNumber,
        field: label,
        severity: "error",
        code: "missing_value",
        message: `${label} is required.`,
      });
    }
    return found;
  };

  const locationRows = new Map<string, string[]>();
  const itemRows: string[][] = [];
  const demandRows: string[][] = [];
  rawRows.forEach((row, index) => {
    const rowNumber = parsed.rowNumbers[index + 1] ?? index + 2;
    if (row.length !== headers.length) {
      issues.push({
        file: "parts",
        row: rowNumber,
        severity: "error",
        code: "malformed_row",
        message: `CSV row has ${row.length} fields but the header has ${headers.length}.`,
      });
    }
    const itemKey = requireValue(row, rowNumber, "itemKey", "item_key");
    const name = requireValue(row, rowNumber, "name", "name");
    const rawQuantity = value(row, "quantity");
    const parsedQuantity = parsePartsQuantity(rawQuantity, value(row, "unit"));
    const locationKey = value(row, "locationKey");
    const locationName = value(row, "deliveryLocation");
    const needByDate = value(row, "needByDate");
    if (rawQuantity && parsedQuantity.quantity === null && !/^as\s+req(?:uired)?\.?$/i.test(rawQuantity)) {
      issues.push({
        file: "parts",
        row: rowNumber,
        field: "quantity",
        severity: "error",
        code: "invalid_number",
        message: "quantity must begin with a positive number or use 'As req.'.",
      });
    }
    if (!itemKey || !name || issues.some((entry) => entry.row === rowNumber && entry.field === "quantity")) return;

    const existingLocation = locationKey && locationName ? locationRows.get(locationKey.toLowerCase()) : undefined;
    if (existingLocation && existingLocation[2] !== locationName) {
      issues.push({
        file: "parts",
        row: rowNumber,
        field: "location_key",
        severity: "error",
        code: "identity_collision",
        message: `location_key ${locationKey} is assigned to both ${existingLocation[2]} and ${locationName}.`,
      });
    } else if (locationKey && locationName && !existingLocation) {
      locationRows.set(locationKey.toLowerCase(), [locationKey, "", locationName, "DELIVERY", "", "", "", "", value(row, "countryCode"), "", ""]);
    }

    const specification = value(row, "specification");
    const supplierDeliverable = value(row, "supplierDeliverable");
    const description = [specification, supplierDeliverable ? `Supplier deliverable: ${supplierDeliverable}` : ""].filter(Boolean).join(" | ");
    itemRows.push([
      itemKey,
      "",
      itemKey,
      value(row, "manufacturer"),
      value(row, "mpn"),
      "",
      "",
      name,
      description,
      value(row, "category"),
      "COMPONENT",
      parsedQuantity.unitOfMeasure ?? "EA",
      "",
      "PARTS_CSV",
      parsedQuantity.rawQuantity ?? "",
      parsedQuantity.quantity === null ? "" : String(parsedQuantity.quantity),
      parsedQuantity.unitOfMeasure ?? "",
      supplierDeliverable,
      locationName,
      needByDate,
    ]);
    if (parsedQuantity.quantity !== null && parsedQuantity.unitOfMeasure && needByDate) {
      demandRows.push([
        `parts:${itemKey}:${rowNumber}`,
        itemKey,
        locationKey && locationName ? locationKey : "",
        "CSV_PARTS_LIST",
        "",
        String(parsedQuantity.quantity),
        parsedQuantity.unitOfMeasure,
        needByDate,
        "",
      ]);
    }
  });

  return {
    files: {
      locations: csvText(TEMPLATE_HEADERS.locations, [...locationRows.values()]),
      items: csvText(TEMPLATE_HEADERS.items, itemRows),
      demand: csvText(TEMPLATE_HEADERS.demand, demandRows),
    },
    issues,
  };
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = jsonRecord(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function mergeSourceRefs(...values: unknown[]) {
  const refs = values.flatMap((value) => value === undefined || value === null
    ? []
    : Array.isArray(value) ? value : [value]);
  if (!refs.length) return undefined;
  const unique = new Map(refs.map((value) => [stableJson(value), value]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function mergeMetadata(base: unknown, overlay: unknown) {
  const baseRecord = jsonRecord(base);
  const overlayRecord = jsonRecord(overlay);
  if (baseRecord || overlayRecord) return { ...(baseRecord ?? {}), ...(overlayRecord ?? {}) };
  return overlay ?? base;
}

function overlayDefined<T extends object>(base: T, overlay: T): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}

function mergeRows<T>(
  base: T[],
  overlay: T[],
  keyOf: (value: T) => string,
  merge: (baseValue: T, overlayValue: T) => T = (_baseValue, overlayValue) => overlayValue,
) {
  const byKey = new Map(base.map((value) => [keyOf(value), value]));
  for (const value of overlay) {
    const key = keyOf(value);
    const prior = byKey.get(key);
    byKey.set(key, prior ? merge(prior, value) : value);
  }
  return [...byKey.values()].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

/**
 * Expands an immutable published snapshot with one parts-list import. Existing
 * rows are copied into the new draft, while imported item facts replace the
 * prior facts only for the same stable itemKey.
 */
export function mergeSupplyPartsIntoSnapshot(
  base: NormalizedSupplyCsvBundle,
  parts: NormalizedSupplyCsvBundle,
  sourceName: string,
): NormalizedSupplyCsvBundle {
  if (parts.items.some((item) => item.request?.source !== "PARTS_CSV")) {
    throw new Error("Parts snapshot merge accepts only PARTS_CSV items.");
  }

  const importSourceRef = { source: "CSV", sourceName };
  const locations = mergeRows(
    base.locations,
    parts.locations.map((location) => ({
      ...location,
      sourceRefs: mergeSourceRefs(location.sourceRefs, importSourceRef),
    })),
    (location) => location.locationKey,
    (prior, imported) => ({
      ...overlayDefined(prior, imported),
      sourceRefs: mergeSourceRefs(prior.sourceRefs, imported.sourceRefs),
    }),
  );
  const items = mergeRows(
    base.items,
    parts.items.map((item) => ({
      ...item,
      sourceRefs: mergeSourceRefs(item.sourceRefs, importSourceRef),
    })),
    (item) => item.itemKey,
    (prior, imported) => ({
      ...overlayDefined(prior, imported),
      approvedAliases: [...new Set([...prior.approvedAliases, ...imported.approvedAliases])].sort(),
      complianceTags: [...new Set([...prior.complianceTags, ...imported.complianceTags])].sort(),
      metadata: mergeMetadata(prior.metadata, imported.metadata),
      sourceRefs: mergeSourceRefs(prior.sourceRefs, imported.sourceRefs),
      request: imported.request ?? prior.request,
      unitOfMeasure: imported.request?.unitOfMeasure ?? prior.unitOfMeasure,
      sku: prior.sku ?? imported.sku,
      itemType: prior.itemType,
    }),
  );
  const bom = mergeRows(
    base.bom,
    parts.bom.map((line) => ({ ...line, sourceRefs: mergeSourceRefs(line.sourceRefs, importSourceRef) })),
    (line) => `${line.parentItemKey}\0${line.revision ?? "1"}\0${line.lineNumber ?? ""}\0${line.componentItemKey}\0${line.alternativeGroup ?? ""}`,
    (prior, imported) => ({
      ...overlayDefined(prior, imported),
      bomSourceRefs: mergeSourceRefs(prior.bomSourceRefs, imported.bomSourceRefs),
      sourceRefs: mergeSourceRefs(prior.sourceRefs, imported.sourceRefs),
    }),
  );
  const inventory = mergeRows(
    base.inventory,
    parts.inventory.map((position) => ({ ...position, sourceRefs: mergeSourceRefs(position.sourceRefs, importSourceRef) })),
    (position) => position.positionKey,
    (prior, imported) => ({
      ...overlayDefined(prior, imported),
      sourceRefs: mergeSourceRefs(prior.sourceRefs, imported.sourceRefs),
    }),
  );
  const demand = mergeRows(
    base.demand,
    parts.demand.map((line) => ({ ...line, sourceRefs: mergeSourceRefs(line.sourceRefs, importSourceRef) })),
    (line) => line.demandKey,
    (prior, imported) => ({
      ...overlayDefined(prior, imported),
      sourceRefs: mergeSourceRefs(prior.sourceRefs, imported.sourceRefs),
    }),
  );
  const purchaseOrders = mergeRows(
    base.purchaseOrders,
    parts.purchaseOrders,
    (line) => `${line.purchaseOrderKey}\0${line.lineKey}`,
  );
  const supplierTerms = mergeRows(base.supplierTerms, parts.supplierTerms, (term) => term.termKey);
  const complianceRecords = mergeRows(base.complianceRecords, parts.complianceRecords, (record) => record.recordKey);
  const snapshotSupplierTerms = mergeRows(base.snapshotSupplierTerms ?? [], parts.snapshotSupplierTerms ?? [], (term) => term.termKey);
  const fccProfiles = mergeRows(base.fccProfiles ?? [], parts.fccProfiles ?? [], (profile) => profile.itemKey);
  const mediaAssets = mergeRows(base.mediaAssets ?? [], parts.mediaAssets ?? [], (asset) => asset.mediaKey);

  const itemKeys = new Set(items.map((item) => item.itemKey));
  const locationKeys = new Set(locations.map((location) => location.locationKey));
  const requireItem = (itemKey: string, owner: string) => {
    if (!itemKeys.has(itemKey)) throw new Error(`${owner} references missing item ${itemKey}.`);
  };
  const requireLocation = (locationKey: string | undefined, owner: string) => {
    if (locationKey && !locationKeys.has(locationKey)) throw new Error(`${owner} references missing location ${locationKey}.`);
  };
  bom.forEach((line) => {
    requireItem(line.parentItemKey, "BOM");
    requireItem(line.componentItemKey, "BOM");
  });
  inventory.forEach((position) => {
    requireItem(position.itemKey, "Inventory");
    requireLocation(position.locationKey, "Inventory");
  });
  demand.forEach((line) => {
    requireItem(line.itemKey, "Demand");
    requireLocation(line.locationKey, "Demand");
  });
  purchaseOrders.forEach((line) => {
    requireItem(line.itemKey, "Purchase order");
    requireLocation(line.locationKey, "Purchase order");
  });
  supplierTerms.forEach((term) => requireItem(term.itemKey, "Supplier term"));
  complianceRecords.forEach((record) => requireItem(record.itemKey, "Compliance record"));
  snapshotSupplierTerms.forEach((term) => {
    requireItem(term.itemKey, "Snapshot supplier term");
    requireLocation(term.facilityKey, "Snapshot supplier term");
  });
  fccProfiles.forEach((profile) => requireItem(profile.itemKey, "FCC profile"));
  mediaAssets.forEach((asset) => {
    if (asset.itemKey) requireItem(asset.itemKey, "Media asset");
    requireLocation(asset.locationKey, "Media asset");
  });

  return {
    schemaVersion: 2,
    locations,
    items,
    bom,
    inventory,
    demand,
    purchaseOrders,
    supplierTerms,
    complianceRecords,
    issues: [...base.issues, ...parts.issues].sort((left, right) => left.file.localeCompare(right.file) || left.row - right.row || (left.field ?? "").localeCompare(right.field ?? "") || left.code.localeCompare(right.code)),
    snapshotMetadata: mergeMetadata(base.snapshotMetadata, parts.snapshotMetadata),
    snapshotSupplierTerms,
    fccProfiles,
    mediaAssets,
  };
}

export function normalizeSupplyCsvBundle(
  bundle: SupplyCsvBundle,
  options: NormalizeSupplyCsvOptions = {},
): NormalizedSupplyCsvBundle {
  const issues: SupplyCsvIssue[] = [];
  const mapping = options.columnMappings ?? {};
  const now = options.now ?? new Date();
  const staleAfterDays = options.staleInventoryAfterDays ?? 90;

  const locationRecords = records("locations", bundle.locations, issues, mapping.locations);
  const locations = locationRecords.map((record) => ({
    locationKey: required(record, "locations", "location_key", issues, mapping.locations, "location_key", "location_code", "external_id"),
    externalId: optional(first(record, mapping.locations, "external_id")),
    name: required(record, "locations", "name", issues, mapping.locations, "name", "location_name"),
    kind: (first(record, mapping.locations, "kind", "location_type") || "UNKNOWN").toUpperCase(),
    addressLine: optional(first(record, mapping.locations, "address", "address_line")),
    city: optional(first(record, mapping.locations, "city")),
    region: optional(first(record, mapping.locations, "region", "state", "province")),
    postalCode: optional(first(record, mapping.locations, "postal_code", "zip")),
    countryCode: optional(first(record, mapping.locations, "country_code", "country")?.toUpperCase()),
    latitude: coordinateValue(record, "locations", "latitude", issues, mapping.locations, ["latitude", "lat"]),
    longitude: coordinateValue(record, "locations", "longitude", issues, mapping.locations, ["longitude", "lng", "lon"]),
  }));

  const itemRecords = records("items", bundle.items, issues, mapping.items);
  const items = itemRecords.map((record) => ({
    itemKey: required(record, "items", "item_key", issues, mapping.items, "item_key", "sku", "external_id"),
    externalId: optional(first(record, mapping.items, "external_id")),
    sku: optional(first(record, mapping.items, "sku")),
    manufacturer: optional(first(record, mapping.items, "manufacturer", "maker")),
    mpn: optional(first(record, mapping.items, "mpn", "manufacturer_part_number")),
    gtin: optional(first(record, mapping.items, "gtin", "barcode")),
    approvedAliases: stringList(first(record, mapping.items, "approved_aliases", "aliases")),
    name: required(record, "items", "name", issues, mapping.items, "name", "item_name", "description"),
    description: optional(first(record, mapping.items, "description")),
    category: optional(first(record, mapping.items, "category")),
    itemType: (first(record, mapping.items, "item_type", "type") || "COMPONENT").toUpperCase(),
    unitOfMeasure: unitValue(record, "items", issues, mapping.items),
    complianceTags: stringList(first(record, mapping.items, "compliance_tags")),
    request: first(record, mapping.items, "request_source") === "PARTS_CSV" ? {
      source: "PARTS_CSV" as const,
      rawQuantity: optional(first(record, mapping.items, "request_raw_quantity")) ?? null,
      quantity: numberValue({ record, file: "items", field: "request_quantity", keys: ["request_quantity"], issues, mapping: mapping.items, positive: true }),
      unitOfMeasure: optional(first(record, mapping.items, "request_unit")) ?? null,
      supplierDeliverable: optional(first(record, mapping.items, "request_supplier_deliverable")) ?? null,
      deliveryLocation: optional(first(record, mapping.items, "request_delivery_location")) ?? null,
      needByDate: optional(first(record, mapping.items, "request_need_by_date")) ?? null,
    } : undefined,
  }));

  const bomRecords = records("bom", bundle.bom, issues, mapping.bom);
  const bom = bomRecords.map((record) => ({
    parentItemKey: required(record, "bom", "parent_item_key", issues, mapping.bom, "parent_item_key", "parent_sku"),
    componentItemKey: required(record, "bom", "component_item_key", issues, mapping.bom, "component_item_key", "component_sku"),
    quantity: numberValue({ record, file: "bom", field: "quantity", keys: ["quantity", "qty_per"], issues, mapping: mapping.bom, required: true, positive: true }),
    unitOfMeasure: unitValue(record, "bom", issues, mapping.bom),
    scrapRate: numberValue({ record, file: "bom", field: "scrap_rate", keys: ["scrap_rate"], issues, mapping: mapping.bom }),
    makeOrBuy: enumValue(first(record, mapping.bom, "make_or_buy"), ["MAKE", "BUY"] as const),
    isOptional: booleanValue(first(record, mapping.bom, "is_optional", "optional")),
    alternativeGroup: optional(first(record, mapping.bom, "alternative_group")),
  }));

  const inventoryRecords = records("inventory", bundle.inventory, issues, mapping.inventory);
  const inventory = inventoryRecords.map((record) => {
    const asOf = dateValue({ record, file: "inventory", field: "as_of", value: first(record, mapping.inventory, "as_of", "snapshot_at"), issues, required: true }) ?? "";
    if (asOf && now.getTime() - new Date(asOf).getTime() > staleAfterDays * 86_400_000) {
      issue(issues, "inventory", Number(record.__row), "stale_inventory", `Inventory timestamp is older than ${staleAfterDays} days.`, "as_of");
    }
    return {
      positionKey: required(record, "inventory", "position_key", issues, mapping.inventory, "position_key", "inventory_id"),
      itemKey: required(record, "inventory", "item_key", issues, mapping.inventory, "item_key", "sku"),
      locationKey: required(record, "inventory", "location_key", issues, mapping.inventory, "location_key", "location_code"),
      lotNumber: optional(first(record, mapping.inventory, "lot_number", "lot")),
      unitOfMeasure: unitValue(record, "inventory", issues, mapping.inventory),
      quantityOnHand: numberValue({ record, file: "inventory", field: "on_hand", keys: ["on_hand", "quantity_on_hand"], issues, mapping: mapping.inventory }),
      quantityAllocated: numberValue({ record, file: "inventory", field: "allocated", keys: ["allocated", "quantity_allocated"], issues, mapping: mapping.inventory }),
      quantityInTransit: numberValue({ record, file: "inventory", field: "in_transit", keys: ["in_transit", "quantity_in_transit"], issues, mapping: mapping.inventory }),
      quantityOnOrder: numberValue({ record, file: "inventory", field: "on_order", keys: ["on_order", "quantity_on_order"], issues, mapping: mapping.inventory }),
      asOf,
    };
  });

  const demandRecords = records("demand", bundle.demand, issues, mapping.demand);
  const demand = demandRecords.map((record) => ({
    demandKey: required(record, "demand", "demand_key", issues, mapping.demand, "demand_key", "demand_id", "order_id"),
    itemKey: required(record, "demand", "item_key", issues, mapping.demand, "item_key", "sku"),
    locationKey: optional(first(record, mapping.demand, "location_key", "location_code")),
    sourceType: first(record, mapping.demand, "source_type") || "ERP",
    externalId: optional(first(record, mapping.demand, "external_id", "order_id")),
    quantity: numberValue({ record, file: "demand", field: "quantity", keys: ["quantity", "required_quantity"], issues, mapping: mapping.demand, required: true, positive: true }),
    unitOfMeasure: unitValue(record, "demand", issues, mapping.demand),
    dueAt: dateValue({ record, file: "demand", field: "due_at", value: first(record, mapping.demand, "due_at", "need_by"), issues, required: true }) ?? "",
    priority: numberValue({ record, file: "demand", field: "priority", keys: ["priority"], issues, mapping: mapping.demand }),
  }));

  const poRecords = records("purchase_orders", bundle.purchase_orders, issues, mapping.purchase_orders);
  const purchaseOrders = poRecords.map((record) => ({
    purchaseOrderKey: required(record, "purchase_orders", "purchase_order_key", issues, mapping.purchase_orders, "purchase_order_key", "po_number"),
    lineKey: required(record, "purchase_orders", "line_key", issues, mapping.purchase_orders, "line_key", "line_number"),
    itemKey: required(record, "purchase_orders", "item_key", issues, mapping.purchase_orders, "item_key", "sku"),
    locationKey: optional(first(record, mapping.purchase_orders, "location_key", "location_code")),
    supplierName: optional(first(record, mapping.purchase_orders, "supplier_name", "supplier")),
    quantity: numberValue({ record, file: "purchase_orders", field: "quantity", keys: ["quantity", "ordered_quantity"], issues, mapping: mapping.purchase_orders, required: true, positive: true }),
    unitOfMeasure: unitValue(record, "purchase_orders", issues, mapping.purchase_orders),
    expectedAt: dateValue({ record, file: "purchase_orders", field: "expected_at", value: first(record, mapping.purchase_orders, "expected_at", "expected_date"), issues }),
    status: optional(first(record, mapping.purchase_orders, "status")?.toUpperCase()),
  }));

  const supplierRecords = records("supplier_terms", bundle.supplier_terms, issues, mapping.supplier_terms);
  const supplierTerms = supplierRecords.map((record) => {
    const websiteRaw = first(record, mapping.supplier_terms, "supplier_website", "website");
    const evidenceRaw = first(record, mapping.supplier_terms, "evidence_url", "source_url");
    if (websiteRaw && !publicUrl(websiteRaw)) issue(issues, "supplier_terms", Number(record.__row), "malformed_row", "supplier_website must be a public HTTP URL.", "supplier_website");
    if (evidenceRaw && !publicUrl(evidenceRaw)) issue(issues, "supplier_terms", Number(record.__row), "malformed_row", "evidence_url must be a public HTTP URL.", "evidence_url");
    return {
      termKey: required(record, "supplier_terms", "term_key", issues, mapping.supplier_terms, "term_key", "supplier_term_id"),
      itemKey: required(record, "supplier_terms", "item_key", issues, mapping.supplier_terms, "item_key", "sku"),
      supplierName: required(record, "supplier_terms", "supplier_name", issues, mapping.supplier_terms, "supplier_name", "supplier"),
      supplierWebsite: publicUrl(websiteRaw),
      supplierRole: enumValue(first(record, mapping.supplier_terms, "supplier_role", "role"), ["MANUFACTURER", "DISTRIBUTOR"] as const),
      countryCode: optional(first(record, mapping.supplier_terms, "country_code", "country")?.toUpperCase()),
      facility: optional(first(record, mapping.supplier_terms, "facility")),
      price: numberValue({ record, file: "supplier_terms", field: "price", keys: ["price", "unit_price"], issues, mapping: mapping.supplier_terms }),
      currency: optional(first(record, mapping.supplier_terms, "currency")?.toUpperCase()),
      minimumOrderQuantity: numberValue({ record, file: "supplier_terms", field: "moq", keys: ["moq", "minimum_order_quantity"], issues, mapping: mapping.supplier_terms }),
      leadTimeDays: numberValue({ record, file: "supplier_terms", field: "lead_time_days", keys: ["lead_time_days", "lead_time"], issues, mapping: mapping.supplier_terms }),
      evidenceUrl: publicUrl(evidenceRaw),
      observedAt: dateValue({ record, file: "supplier_terms", field: "observed_at", value: first(record, mapping.supplier_terms, "observed_at", "captured_at"), issues }),
    };
  });

  const complianceRows = records("compliance_records", bundle.compliance_records, issues, mapping.compliance_records);
  const complianceRecords = complianceRows.map((record) => {
    const evidenceRaw = first(record, mapping.compliance_records, "evidence_url", "source_url");
    if (evidenceRaw && !publicUrl(evidenceRaw)) issue(issues, "compliance_records", Number(record.__row), "malformed_row", "evidence_url must be a public HTTP URL.", "evidence_url");
    return {
      recordKey: required(record, "compliance_records", "record_key", issues, mapping.compliance_records, "record_key", "compliance_id"),
      itemKey: required(record, "compliance_records", "item_key", issues, mapping.compliance_records, "item_key", "sku"),
      authority: required(record, "compliance_records", "authority", issues, mapping.compliance_records, "authority"),
      standard: optional(first(record, mapping.compliance_records, "standard", "rule")),
      authorizationReference: optional(first(record, mapping.compliance_records, "authorization_reference", "authorization")),
      integrationConstraints: optional(first(record, mapping.compliance_records, "integration_constraints", "constraints")),
      evidenceUrl: publicUrl(evidenceRaw),
      observedAt: dateValue({ record, file: "compliance_records", field: "observed_at", value: first(record, mapping.compliance_records, "observed_at", "reviewed_at"), issues }),
      reviewState: enumValue(first(record, mapping.compliance_records, "review_state", "status"), ["EVIDENCE_COMPLETE", "REVIEW_REQUIRED", "BLOCKED"] as const) ?? "REVIEW_REQUIRED",
    };
  });

  duplicateIssues("locations", locations.map((value, index) => ({ key: value.locationKey, row: Number(locationRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("items", items.map((value, index) => ({ key: value.itemKey, row: Number(itemRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("inventory", inventory.map((value, index) => ({ key: value.positionKey, row: Number(inventoryRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("demand", demand.map((value, index) => ({ key: value.demandKey, row: Number(demandRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("purchase_orders", purchaseOrders.map((value, index) => ({ key: `${value.purchaseOrderKey}::${value.lineKey}`, row: Number(poRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("supplier_terms", supplierTerms.map((value, index) => ({ key: value.termKey, row: Number(supplierRecords[index]?.__row ?? 0) })), issues);
  duplicateIssues("compliance_records", complianceRecords.map((value, index) => ({ key: value.recordKey, row: Number(complianceRows[index]?.__row ?? 0) })), issues);
  identityCollisionIssues(items, itemRecords, issues);

  const itemKeys = new Set(items.map((item) => item.itemKey));
  const locationKeys = new Set(locations.map((location) => location.locationKey));
  const checkItem = (file: SupplyCsvKind, row: number, key: string, field = "item_key") => {
    if (key && !itemKeys.has(key)) issue(issues, file, row, "broken_reference", `Unknown item: ${key}.`, field);
  };
  const checkLocation = (file: SupplyCsvKind, row: number, key: string | undefined) => {
    if (key && !locationKeys.has(key)) issue(issues, file, row, "broken_reference", `Unknown location: ${key}.`, "location_key");
  };
  bom.forEach((line, index) => {
    const row = Number(bomRecords[index]?.__row ?? 0);
    checkItem("bom", row, line.parentItemKey, "parent_item_key");
    checkItem("bom", row, line.componentItemKey, "component_item_key");
  });
  inventory.forEach((position, index) => {
    const row = Number(inventoryRecords[index]?.__row ?? 0);
    checkItem("inventory", row, position.itemKey);
    checkLocation("inventory", row, position.locationKey);
  });
  demand.forEach((line, index) => {
    const row = Number(demandRecords[index]?.__row ?? 0);
    checkItem("demand", row, line.itemKey);
    checkLocation("demand", row, line.locationKey);
  });
  purchaseOrders.forEach((line, index) => {
    const row = Number(poRecords[index]?.__row ?? 0);
    checkItem("purchase_orders", row, line.itemKey);
    checkLocation("purchase_orders", row, line.locationKey);
  });
  supplierTerms.forEach((line, index) => checkItem("supplier_terms", Number(supplierRecords[index]?.__row ?? 0), line.itemKey));
  complianceRecords.forEach((line, index) => checkItem("compliance_records", Number(complianceRows[index]?.__row ?? 0), line.itemKey));
  bomCycleIssues(bom, bomRecords, issues);

  sortBy(locations, (value) => value.locationKey);
  sortBy(items, (value) => value.itemKey);
  sortBy(bom, (value) => `${value.parentItemKey}\0${value.componentItemKey}\0${value.alternativeGroup ?? ""}`);
  sortBy(inventory, (value) => value.positionKey);
  sortBy(demand, (value) => value.demandKey);
  sortBy(purchaseOrders, (value) => `${value.purchaseOrderKey}\0${value.lineKey}`);
  sortBy(supplierTerms, (value) => value.termKey);
  sortBy(complianceRecords, (value) => value.recordKey);
  issues.sort((left, right) => left.file.localeCompare(right.file) || left.row - right.row || (left.field ?? "").localeCompare(right.field ?? "") || left.code.localeCompare(right.code));

  return { schemaVersion: 2, locations, items, bom, inventory, demand, purchaseOrders, supplierTerms, complianceRecords, issues };
}
