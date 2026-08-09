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
  latitude?: number;
  longitude?: number;
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
};

export type SupplyBomLineInput = {
  parentItemKey: string;
  componentItemKey: string;
  quantity: number | null;
  unitOfMeasure: string;
  scrapRate: number | null;
  makeOrBuy?: "MAKE" | "BUY";
  isOptional: boolean;
  alternativeGroup?: string;
};

export type SupplyInventoryInput = {
  positionKey: string;
  itemKey: string;
  locationKey: string;
  lotNumber?: string;
  unitOfMeasure: string;
  quantityOnHand: number | null;
  quantityAllocated: number | null;
  quantityInTransit: number | null;
  quantityOnOrder: number | null;
  asOf: string;
};

export type SupplyDemandInput = {
  demandKey: string;
  itemKey: string;
  locationKey?: string;
  sourceType: string;
  externalId?: string;
  quantity: number | null;
  unitOfMeasure: string;
  dueAt: string;
  priority: number | null;
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
  items: ["item_key", "external_id", "sku", "manufacturer", "mpn", "gtin", "approved_aliases", "name", "description", "category", "item_type", "unit", "compliance_tags"],
  bom: ["parent_item_key", "component_item_key", "quantity", "unit", "scrap_rate", "make_or_buy", "is_optional", "alternative_group"],
  inventory: ["position_key", "item_key", "location_key", "lot_number", "unit", "on_hand", "allocated", "in_transit", "on_order", "as_of"],
  demand: ["demand_key", "item_key", "location_key", "source_type", "external_id", "quantity", "unit", "due_at", "priority"],
  purchase_orders: ["purchase_order_key", "line_key", "item_key", "location_key", "supplier_name", "quantity", "unit", "expected_at", "status"],
  supplier_terms: ["term_key", "item_key", "supplier_name", "supplier_website", "supplier_role", "country_code", "facility", "price", "currency", "moq", "lead_time_days", "evidence_url", "observed_at"],
  compliance_records: ["record_key", "item_key", "authority", "standard", "authorization_reference", "integration_constraints", "evidence_url", "observed_at", "review_state"],
};

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
