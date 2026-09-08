import { createHash, timingSafeEqual } from "node:crypto";
import type {
  SupplyStateDependency,
  SupplyWorldStatePacket,
} from "./types";

export type CanonicalSupplyStateValue =
  | null
  | boolean
  | number
  | string
  | CanonicalSupplyStateValue[]
  | { [key: string]: CanonicalSupplyStateValue };

export const MAX_SUPPLY_STATE_PACKET_BYTES = 128 * 1024;

export class SupplyStateCanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplyStateCanonicalizationError";
  }
}

function fail(path: string, message: string): never {
  throw new SupplyStateCanonicalizationError(`${path} ${message}`);
}

function decimalValue(value: object) {
  const constructorName = value.constructor?.name;
  if (constructorName !== "Decimal") return null;
  const serialized = String(value);
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(serialized)
    ? serialized
    : null;
}

function canonicalize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): CanonicalSupplyStateValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (typeof value === "function" || typeof value === "symbol") {
    return fail(path, "contains a value that JSON cannot represent.");
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) fail(path, "contains an invalid date.");
    return { $date: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail(path, "contains a cycle.");
    ancestors.add(value);
    try {
      return value.map((child, index) => canonicalize(child, `${path}[${index}]`, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!value || typeof value !== "object") return fail(path, "contains an unsupported value.");

  const decimal = decimalValue(value);
  if (decimal !== null) return { $decimal: decimal };

  if (ancestors.has(value)) fail(path, "contains a cycle.");
  ancestors.add(value);
  try {
    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      const toJSON = record.toJSON;
      if (typeof toJSON !== "function") fail(path, "contains a non-JSON object.");
      let serialized: unknown;
      try {
        serialized = toJSON.call(value);
      } catch {
        return fail(path, "could not be converted to JSON.");
      }
      return canonicalize(serialized, path, ancestors);
    }

    const output: Record<string, CanonicalSupplyStateValue> = {};
    for (const key of Object.keys(record).sort((left, right) => (
      left < right ? -1 : left > right ? 1 : 0
    ))) {
      const child = record[key];
      if (child === undefined) continue;
      output[key] = canonicalize(child, `${path}.${key}`, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeSupplyStateValue(value: unknown): CanonicalSupplyStateValue {
  return canonicalize(value, "Supply state value", new Set());
}

export function canonicalSupplyStateJson(value: unknown, maxBytes?: number) {
  const serialized = JSON.stringify(canonicalizeSupplyStateValue(value));
  if (maxBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new SupplyStateCanonicalizationError(
      `Supply state value exceeds the ${maxBytes} byte serialized limit.`,
    );
  }
  return serialized;
}

export function hashSupplyStateValue(value: unknown) {
  return createHash("sha256").update(canonicalSupplyStateJson(value)).digest("hex");
}

export function hashSupplyStateDependencies(dependencies: SupplyStateDependency[]) {
  const sourceManifest = dependencies
    .map((dependency) => ({
      key: dependency.key,
      source: dependency.source,
      entityType: dependency.entityType,
      entityRef: dependency.entityRef,
      version: dependency.version,
      valueHash: dependency.valueHash,
    }))
    .sort((left, right) => {
      const leftKey = `${left.key}\0${left.source}\0${left.entityType}\0${left.entityRef}`;
      const rightKey = `${right.key}\0${right.source}\0${right.entityType}\0${right.entityRef}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return hashSupplyStateValue(sourceManifest);
}

export function hashSupplyWorldStatePacket(packet: SupplyWorldStatePacket) {
  const { packetHash: _packetHash, ...hashInput } = packet;
  return hashSupplyStateValue(hashInput);
}

export function supplyStateHashesEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
