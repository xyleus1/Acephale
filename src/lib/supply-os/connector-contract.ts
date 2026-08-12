import type { NormalizedSupplyCsvBundle } from "./csv-import";

export const SUPPLY_CONNECTOR_ERROR_CODES = [
  "AUTH_FAILED",
  "RATE_LIMITED",
  "SOURCE_UNAVAILABLE",
  "MAPPING_INVALID",
  "VALIDATION_FAILED",
  "SYNC_IN_PROGRESS",
  "CONNECTOR_DISABLED",
] as const;

export type SupplyConnectorErrorCode = (typeof SUPPLY_CONNECTOR_ERROR_CODES)[number];

export class SupplyConnectorError extends Error {
  constructor(
    public readonly code: SupplyConnectorErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "SupplyConnectorError";
  }
}

export type SupplyConnectorCursor = Record<string, string | number | boolean | null>;

export type SupplyConnectorPullResult = {
  normalized: NormalizedSupplyCsvBundle;
  outputCursor: SupplyConnectorCursor | null;
  observedAt: string;
  sourceVersion: string | null;
};

export type SupplyConnectorRuntime = {
  installationId: string;
  baseUrl: string;
  secretRef: string;
  config: Record<string, unknown>;
  inputCursor: SupplyConnectorCursor | null;
  traceId: string;
  fetcher?: typeof fetch;
};

export type SupplyConnectorAdapter = {
  key: string;
  version: string;
  validateConfig(config: unknown): Record<string, unknown>;
  testConnection(runtime: SupplyConnectorRuntime): Promise<{ sourceVersion: string | null }>;
  pull(runtime: SupplyConnectorRuntime): Promise<SupplyConnectorPullResult>;
};

export function connectorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
