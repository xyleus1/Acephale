import type { ProcurementRequestInput } from "@/lib/procurement-contract";
import { GUILD_SOURCING_LINES, type GuildSourcingLine } from "./guild-sourcing-items";

export const GUILD2_PROCUREMENT_REVISION = "v1";
export const GUILD2_BULK_CONCURRENCY = 3;

export type Guild2ProcurementLine = GuildSourcingLine & {
  sourceSku: string;
};

export type Guild2ProcurementPlan = {
  all: Guild2ProcurementLine[];
  searchable: Guild2ProcurementLine[];
  blocked: Guild2ProcurementLine[];
  documentation: Guild2ProcurementLine[];
  ready: boolean;
};

function guild2Sku(line: GuildSourcingLine) {
  return line.sku.replace(/^GUILD-/, "GUILD2-");
}

export const GUILD2_PROCUREMENT_PLAN: Guild2ProcurementPlan = (() => {
  const all = GUILD_SOURCING_LINES.map((line) => ({ ...line, sourceSku: guild2Sku(line) }));
  const searchable = all.filter((line) => line.classification === "SUPPLIER_SEARCH");
  const blocked = all.filter((line) => line.classification === "CLARIFICATION_REQUIRED");
  const documentation = all.filter((line) => line.classification === "REQUIREMENT_ONLY");
  const ready = all.length === 40
    && searchable.length === 38
    && blocked.length === 1
    && blocked[0]?.sku === "GUILD-027"
    && documentation.length === 1
    && documentation[0]?.sku === "GUILD-039";
  return { all, searchable, blocked, documentation, ready };
})();

const linesBySourceSku = new Map(GUILD2_PROCUREMENT_PLAN.all.map((line) => [line.sourceSku, line]));

export function guild2ProcurementLine(sourceSku: string) {
  return linesBySourceSku.get(sourceSku) ?? null;
}

export function guild2ProcurementIdempotencyKey(line: Guild2ProcurementLine) {
  return `guild2-procurement:${GUILD2_PROCUREMENT_REVISION}:${line.sourceSku}`;
}

export function guild2ProcurementRequest(line: Guild2ProcurementLine): ProcurementRequestInput {
  if (line.classification !== "SUPPLIER_SEARCH" || line.quantity === null || !line.unit) {
    throw new Error(`${line.sku} is not a supplier-searchable line.`);
  }
  return {
    bomId: null,
    material: line.name,
    specification: line.specification,
    lineItemPreferences: {
      schema_version: 1,
      quality: {
        supplier_deliverable: line.deliverable,
      },
    },
    quantity: line.quantity,
    unit: line.unit,
    neededBy: "2026-09-30",
    notes: `[BOURNE TEST] ${line.sourceSku}: ${line.requirement}`,
    requestContext: {
      schema_version: 1,
      source: {
        system: "Derya Supply OS",
        campaign: "GUILD2",
        line_id: line.sku,
        source_sku: line.sourceSku,
      },
      logistics: {
        destination: "Austin, TX, United States",
      },
      supplier_deliverable: line.deliverable,
    },
    idempotencyKey: guild2ProcurementIdempotencyKey(line),
  };
}

export async function runWithBoundedConcurrency<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
  concurrency = GUILD2_BULK_CONCURRENCY,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer.");
  }
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      await worker(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
}
