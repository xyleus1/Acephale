import "server-only";

import type {
  NormalizedSupplyCsvBundle,
  SupplyBomLineInput,
  SupplyComplianceRecordInput,
  SupplyDemandInput,
  SupplyInventoryInput,
  SupplyItemInput,
  SupplyLocationInput,
  SupplyPurchaseOrderInput,
  SupplySupplierTermInput,
} from "./csv-import";
import {
  SupplyConnectorError,
  connectorRecord,
  type SupplyConnectorAdapter,
  type SupplyConnectorCursor,
  type SupplyConnectorRuntime,
} from "./connector-contract";

const DEFAULT_PATHS = {
  locations: "/api/v1/locations",
  items: "/api/v1/items",
  bom: "/api/v1/bom",
  inventory: "/api/v1/inventory",
  demand: "/api/v1/demand",
  purchaseOrders: "/api/v1/purchase-orders",
  supplierTerms: "/api/v1/supplier-terms",
  complianceRecords: "/api/v1/compliance-records",
} as const;

type ResourceName = keyof typeof DEFAULT_PATHS;
type AdapterConfig = {
  tokenUrl: string;
  scope: string | null;
  resourcePaths: Record<ResourceName, string | null>;
};

type ResourcePage = {
  data: unknown[];
  nextCursor: string | null;
  syncToken: string | null;
  sourceVersion: string | null;
};

const MAX_PAGES = 100;
const MAX_RECORDS_PER_RESOURCE = 50_000;

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.replace(/\u2014/g, " - ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 500) {
  return text(value, max) || undefined;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateText(value: unknown) {
  const raw = text(value, 120);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
    if (["false", "no", "0"].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function sourceKey(value: Record<string, unknown>, preferred: string, index: number) {
  return text(value[preferred] ?? value.externalId ?? value.id, 180) || `${preferred}-${index + 1}`;
}

function normalizedUnit(value: unknown) {
  return text(value, 40).toUpperCase() || "EA";
}

function publicEndpoint(value: unknown, label: string) {
  const raw = text(value, 2_048);
  if (!raw) throw new SupplyConnectorError("MAPPING_INVALID", `${label} is required.`);
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
    return url.toString();
  } catch {
    throw new SupplyConnectorError("MAPPING_INVALID", `${label} must be an HTTPS URL or an absolute path.`);
  }
}

function parseConfig(value: unknown): AdapterConfig {
  const input = connectorRecord(value);
  const rawPaths = connectorRecord(input.resourcePaths);
  const resourcePaths = Object.fromEntries(
    Object.entries(DEFAULT_PATHS).map(([key, fallback]) => {
      const configured = rawPaths[key];
      if (configured === null || configured === false) return [key, null];
      return [key, publicEndpoint(configured ?? fallback, `${key} resource path`)];
    }),
  ) as AdapterConfig["resourcePaths"];
  if (!resourcePaths.locations || !resourcePaths.items) {
    throw new SupplyConnectorError("MAPPING_INVALID", "Locations and items resource paths are required.");
  }
  return {
    tokenUrl: publicEndpoint(input.tokenUrl ?? "/oauth/token", "OAuth token URL"),
    scope: nullableText(input.scope, 500) ?? null,
    resourcePaths,
  };
}

function credentials(secretRef: string) {
  const raw = process.env[secretRef];
  if (!raw) throw new SupplyConnectorError("AUTH_FAILED", "Connector credentials are not configured.");
  try {
    const parsed = connectorRecord(JSON.parse(raw));
    const clientId = text(parsed.clientId, 500);
    const clientSecret = text(parsed.clientSecret, 2_000);
    if (!clientId || !clientSecret) throw new Error("missing");
    return { clientId, clientSecret };
  } catch {
    throw new SupplyConnectorError("AUTH_FAILED", "Connector credentials are invalid.");
  }
}

function resolvedUrl(baseUrl: string, path: string) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new SupplyConnectorError("MAPPING_INVALID", "Connector endpoints must use HTTPS.");
  }
  return url;
}

async function accessToken(runtime: SupplyConnectorRuntime, config: AdapterConfig) {
  const fetcher = runtime.fetcher ?? fetch;
  const secret = credentials(runtime.secretRef);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: secret.clientId,
    client_secret: secret.clientSecret,
  });
  if (config.scope) body.set("scope", config.scope);
  let response: Response;
  try {
    response = await fetcher(resolvedUrl(runtime.baseUrl, config.tokenUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SupplyConnectorError("SOURCE_UNAVAILABLE", "The connector authentication endpoint did not respond.", true);
  }
  if (response.status === 429) throw new SupplyConnectorError("RATE_LIMITED", "The connector authentication endpoint rate limited the request.", true);
  if (!response.ok) throw new SupplyConnectorError("AUTH_FAILED", "The client system rejected the connector credentials.");
  const payload = connectorRecord(await response.json().catch(() => null));
  const token = text(payload.access_token, 8_000);
  if (!token) throw new SupplyConnectorError("AUTH_FAILED", "The authentication response did not contain an access token.");
  return token;
}

async function resourcePage(args: {
  runtime: SupplyConnectorRuntime;
  token: string;
  path: string;
  cursor: string | null;
}): Promise<ResourcePage> {
  const fetcher = args.runtime.fetcher ?? fetch;
  const url = resolvedUrl(args.runtime.baseUrl, args.path);
  if (args.cursor) url.searchParams.set("cursor", args.cursor);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${args.token}`, accept: "application/json", "x-trace-id": args.runtime.traceId },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SupplyConnectorError("SOURCE_UNAVAILABLE", "The client system did not respond.", true);
  }
  if (response.status === 401 || response.status === 403) throw new SupplyConnectorError("AUTH_FAILED", "The client system rejected the connector token.");
  if (response.status === 429) throw new SupplyConnectorError("RATE_LIMITED", "The client system rate limited the connector.", true);
  if (!response.ok) throw new SupplyConnectorError("SOURCE_UNAVAILABLE", `The client system returned HTTP ${response.status}.`, response.status >= 500);
  const payload = await response.json().catch(() => null);
  if (Array.isArray(payload)) return { data: payload, nextCursor: null, syncToken: null, sourceVersion: response.headers.get("etag") };
  const object = connectorRecord(payload);
  if (!Array.isArray(object.data)) throw new SupplyConnectorError("MAPPING_INVALID", "A connector resource response did not contain a data array.");
  return {
    data: object.data,
    nextCursor: nullableText(object.nextCursor, 1_000) ?? null,
    syncToken: nullableText(object.syncToken, 1_000) ?? null,
    sourceVersion: nullableText(object.sourceVersion, 500) ?? response.headers.get("etag"),
  };
}

async function pullResource(runtime: SupplyConnectorRuntime, token: string, path: string | null) {
  if (!path) return { records: [] as unknown[], syncToken: null as string | null, sourceVersion: null as string | null };
  const records: unknown[] = [];
  let cursor: string | null = null;
  let syncToken: string | null = null;
  let sourceVersion: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await resourcePage({ runtime, token, path, cursor });
    records.push(...page.data);
    if (records.length > MAX_RECORDS_PER_RESOURCE) {
      throw new SupplyConnectorError("VALIDATION_FAILED", "A connector resource exceeded the 50,000 record safety limit.");
    }
    syncToken = page.syncToken ?? syncToken;
    sourceVersion = page.sourceVersion ?? sourceVersion;
    if (!page.nextCursor) return { records, syncToken, sourceVersion };
    if (page.nextCursor === cursor) throw new SupplyConnectorError("MAPPING_INVALID", "A connector resource repeated its pagination cursor.");
    cursor = page.nextCursor;
  }
  throw new SupplyConnectorError("VALIDATION_FAILED", "A connector resource exceeded the 100 page safety limit.");
}

function locations(rows: unknown[]): SupplyLocationInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      locationKey: sourceKey(row, "locationKey", index),
      externalId: nullableText(row.externalId ?? row.id, 180),
      name: text(row.name, 300),
      kind: text(row.kind, 80).toUpperCase() || "UNKNOWN",
      addressLine: nullableText(row.addressLine ?? row.address, 500),
      city: nullableText(row.city, 180),
      region: nullableText(row.region, 180),
      postalCode: nullableText(row.postalCode, 80),
      countryCode: nullableText(row.countryCode, 2)?.toUpperCase(),
      latitude: numberOrNull(row.latitude) ?? undefined,
      longitude: numberOrNull(row.longitude) ?? undefined,
    };
  });
}

function items(rows: unknown[]): SupplyItemInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      itemKey: sourceKey(row, "itemKey", index),
      externalId: nullableText(row.externalId ?? row.id, 180),
      sku: nullableText(row.sku, 180),
      manufacturer: nullableText(row.manufacturer, 240),
      mpn: nullableText(row.mpn ?? row.partNumber, 240),
      gtin: nullableText(row.gtin, 80),
      approvedAliases: Array.isArray(row.approvedAliases) ? row.approvedAliases.map((value) => text(value, 180)).filter(Boolean) : [],
      name: text(row.name, 300),
      description: nullableText(row.description, 2_000),
      category: nullableText(row.category, 180),
      itemType: text(row.itemType, 80).toUpperCase() || "COMPONENT",
      unitOfMeasure: normalizedUnit(row.unitOfMeasure ?? row.unit),
      complianceTags: Array.isArray(row.complianceTags) ? row.complianceTags.map((value) => text(value, 180)).filter(Boolean) : [],
    };
  });
}

function bom(rows: unknown[]): SupplyBomLineInput[] {
  return rows.map((raw) => {
    const row = connectorRecord(raw);
    return {
      parentItemKey: text(row.parentItemKey, 180),
      componentItemKey: text(row.componentItemKey, 180),
      quantity: numberOrNull(row.quantity),
      unitOfMeasure: normalizedUnit(row.unitOfMeasure ?? row.unit),
      scrapRate: numberOrNull(row.scrapRate),
      isOptional: booleanValue(row.isOptional),
      alternativeGroup: nullableText(row.alternativeGroup, 180),
    };
  });
}

function inventory(rows: unknown[]): SupplyInventoryInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      positionKey: sourceKey(row, "positionKey", index),
      itemKey: text(row.itemKey, 180),
      locationKey: text(row.locationKey, 180),
      lotNumber: nullableText(row.lotNumber, 180),
      unitOfMeasure: normalizedUnit(row.unitOfMeasure ?? row.unit),
      quantityOnHand: numberOrNull(row.quantityOnHand),
      quantityAllocated: numberOrNull(row.quantityAllocated),
      quantityInTransit: numberOrNull(row.quantityInTransit),
      quantityOnOrder: numberOrNull(row.quantityOnOrder),
      asOf: dateText(row.asOf) ?? "",
    };
  });
}

function demand(rows: unknown[]): SupplyDemandInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      demandKey: sourceKey(row, "demandKey", index),
      itemKey: text(row.itemKey, 180),
      locationKey: nullableText(row.locationKey, 180),
      sourceType: text(row.sourceType, 100) || "CLIENT_API",
      externalId: nullableText(row.externalId ?? row.id, 180),
      quantity: numberOrNull(row.quantity),
      unitOfMeasure: normalizedUnit(row.unitOfMeasure ?? row.unit),
      dueAt: dateText(row.dueAt ?? row.needBy) ?? "",
      priority: numberOrNull(row.priority),
    };
  });
}

function purchaseOrders(rows: unknown[]): SupplyPurchaseOrderInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      purchaseOrderKey: sourceKey(row, "purchaseOrderKey", index),
      lineKey: text(row.lineKey, 180) || String(index + 1),
      itemKey: text(row.itemKey, 180),
      locationKey: nullableText(row.locationKey, 180),
      supplierName: nullableText(row.supplierName, 300),
      quantity: numberOrNull(row.quantity),
      unitOfMeasure: normalizedUnit(row.unitOfMeasure ?? row.unit),
      expectedAt: dateText(row.expectedAt),
      status: nullableText(row.status, 80),
    };
  });
}

function supplierTerms(rows: unknown[]): SupplySupplierTermInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    return {
      termKey: sourceKey(row, "termKey", index),
      itemKey: text(row.itemKey, 180),
      supplierName: text(row.supplierName, 300),
      supplierWebsite: nullableText(row.supplierWebsite, 2_048),
      supplierRole: ["MANUFACTURER", "DISTRIBUTOR"].includes(text(row.supplierRole).toUpperCase())
        ? text(row.supplierRole).toUpperCase() as "MANUFACTURER" | "DISTRIBUTOR"
        : undefined,
      countryCode: nullableText(row.countryCode, 2)?.toUpperCase(),
      facility: nullableText(row.facilityKey ?? row.facility, 180),
      price: numberOrNull(row.unitPrice ?? row.price),
      currency: nullableText(row.currency, 3)?.toUpperCase(),
      minimumOrderQuantity: numberOrNull(row.minimumOrderQuantity ?? row.moq),
      leadTimeDays: numberOrNull(row.leadTimeDays),
      isCurrent: booleanValue(row.isCurrent, true),
      availableQuantity: numberOrNull(row.availableQuantity),
      availableAt: dateText(row.availableAt),
      evidenceUrl: nullableText(row.evidenceUrl, 2_048),
      observedAt: dateText(row.observedAt),
    };
  });
}

function complianceRecords(rows: unknown[]): SupplyComplianceRecordInput[] {
  return rows.map((raw, index) => {
    const row = connectorRecord(raw);
    const state = text(row.reviewState, 80).toUpperCase();
    return {
      recordKey: sourceKey(row, "recordKey", index),
      itemKey: text(row.itemKey, 180),
      authority: text(row.authority, 180),
      standard: nullableText(row.standard, 300),
      authorizationReference: nullableText(row.authorizationReference, 300),
      integrationConstraints: nullableText(row.integrationConstraints, 2_000),
      evidenceUrl: nullableText(row.evidenceUrl, 2_048),
      observedAt: dateText(row.observedAt),
      reviewState: ["EVIDENCE_COMPLETE", "REVIEW_REQUIRED", "BLOCKED"].includes(state)
        ? state as SupplyComplianceRecordInput["reviewState"]
        : "REVIEW_REQUIRED",
    };
  });
}

function validateNormalized(normalized: NormalizedSupplyCsvBundle) {
  const errors: NormalizedSupplyCsvBundle["issues"] = [];
  const locationKeys = new Set<string>();
  normalized.locations.forEach((location, index) => {
    if (!location.locationKey || !location.name) errors.push({ file: "locations", row: index + 1, severity: "error", code: "missing_value", message: "Location key and name are required." });
    if (locationKeys.has(location.locationKey)) errors.push({ file: "locations", row: index + 1, severity: "error", code: "duplicate_id", message: `Duplicate location key ${location.locationKey}.` });
    locationKeys.add(location.locationKey);
  });
  const itemKeys = new Set<string>();
  normalized.items.forEach((item, index) => {
    if (!item.itemKey || !item.name || !item.unitOfMeasure) errors.push({ file: "items", row: index + 1, severity: "error", code: "missing_value", message: "Item key, name, and unit are required." });
    if (itemKeys.has(item.itemKey)) errors.push({ file: "items", row: index + 1, severity: "error", code: "duplicate_id", message: `Duplicate item key ${item.itemKey}.` });
    itemKeys.add(item.itemKey);
  });
  normalized.inventory.forEach((position, index) => {
    if (!itemKeys.has(position.itemKey) || !locationKeys.has(position.locationKey)) errors.push({ file: "inventory", row: index + 1, severity: "error", code: "broken_reference", message: "Inventory references an unknown item or location." });
    if (!position.asOf) errors.push({ file: "inventory", row: index + 1, severity: "error", code: "invalid_date", message: "Inventory as-of timestamp is required." });
  });
  normalized.demand.forEach((requirement, index) => {
    if (!itemKeys.has(requirement.itemKey) || (requirement.locationKey && !locationKeys.has(requirement.locationKey))) errors.push({ file: "demand", row: index + 1, severity: "error", code: "broken_reference", message: "Demand references an unknown item or location." });
    if (requirement.quantity === null || requirement.quantity < 0) errors.push({ file: "demand", row: index + 1, severity: "error", code: "invalid_number", message: "Demand quantity must be zero or greater." });
    if (!requirement.dueAt) errors.push({ file: "demand", row: index + 1, severity: "error", code: "invalid_date", message: "Demand due timestamp is required." });
  });
  normalized.supplierTerms.forEach((term, index) => {
    if (!term.supplierName || !itemKeys.has(term.itemKey)) errors.push({ file: "supplier_terms", row: index + 1, severity: "error", code: "broken_reference", message: "Supplier term requires a supplier name and known item." });
  });
  normalized.issues = errors;
  if (!normalized.locations.length || !normalized.items.length || errors.length) {
    throw new SupplyConnectorError("VALIDATION_FAILED", `Connector validation failed with ${errors.length || 1} issue${errors.length === 1 ? "" : "s"}.`);
  }
}

async function pull(runtime: SupplyConnectorRuntime) {
  const config = parseConfig(runtime.config);
  const token = await accessToken(runtime, config);
  const results = {} as Record<ResourceName, Awaited<ReturnType<typeof pullResource>>>;
  for (const name of Object.keys(DEFAULT_PATHS) as ResourceName[]) {
    results[name] = await pullResource(runtime, token, config.resourcePaths[name]);
  }
  const normalized: NormalizedSupplyCsvBundle = {
    schemaVersion: 2,
    locations: locations(results.locations.records),
    items: items(results.items.records),
    bom: bom(results.bom.records),
    inventory: inventory(results.inventory.records),
    demand: demand(results.demand.records),
    purchaseOrders: purchaseOrders(results.purchaseOrders.records),
    supplierTerms: supplierTerms(results.supplierTerms.records),
    complianceRecords: complianceRecords(results.complianceRecords.records),
    issues: [],
  };
  validateNormalized(normalized);
  const observedAt = new Date().toISOString();
  const syncToken = Object.values(results).map((result) => result.syncToken).find(Boolean) ?? null;
  const sourceVersion = Object.values(results).map((result) => result.sourceVersion).find(Boolean) ?? null;
  const outputCursor: SupplyConnectorCursor = syncToken ? { syncToken } : { completedAt: observedAt };
  return {
    normalized,
    outputCursor,
    observedAt,
    sourceVersion,
  };
}

export const customRestV1Adapter: SupplyConnectorAdapter = {
  key: "CUSTOM_REST_V1",
  version: "1.0.0",
  validateConfig: parseConfig,
  async testConnection(runtime) {
    const config = parseConfig(runtime.config);
    const token = await accessToken(runtime, config);
    const page = await resourcePage({ runtime, token, path: config.resourcePaths.locations!, cursor: null });
    return { sourceVersion: page.sourceVersion };
  },
  pull,
};
