import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// Canonical JSON v1 uses RFC 8785 ordering/number serialization and UTF-8.
// The shared wire profile bounds numbers to the exactly representable integer range.
// No Date, undefined, sparse arrays, prototype fields, or silently coerced values.
export function canonical(value: unknown): string {
  const active = new Set<object>();
  function string(v: string) {
    if (Array.from(v).some(c => { const code = c.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) throw new Error("Unpaired Unicode surrogate");
    return JSON.stringify(v);
  }
  function encode(v: unknown): string {
    if (typeof v === "string") return string(v);
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return JSON.stringify(v);
    if (typeof v !== "object" || v === null || active.has(v)) throw new Error("Expected acyclic JSON");
    active.add(v);
    try {
      if (Array.isArray(v)) {
        if (Object.keys(v).length !== v.length) throw new Error("Sparse or augmented array");
        return `[${v.map(encode).join(",")}]`;
      }
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("Expected JSON object");
      const record = v as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(k => `${string(k)}:${encode(record[k])}`).join(",")}}`;
    } finally { active.delete(v); }
  }
  return encode(value);
}

export function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function copy<T>(value: T): T { return JSON.parse(canonical(value)) as T; }
